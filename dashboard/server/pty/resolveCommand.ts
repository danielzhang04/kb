/**
 * Resolve a bare command name to an ABSOLUTE executable path, using the CHILD's own PATH.
 *
 * WHY THIS EXISTS (live defect, 2026-08-04). "Run agent" / "Run workflow" spawned `{ file: 'claude' }`.
 * Plain shell tabs spawn `parentEnv.ComSpec`, which is already absolute (`C:\Windows\system32\cmd.exe`),
 * so they always worked — the two paths differed in a way no test could see, because the suite injects a
 * fake pty factory that never touches CreateProcess.
 *
 * node-pty's Windows ConPTY agent does NOT perform a PATHEXT search for a bare, extensionless name. A
 * real probe against this machine's node-pty:
 *
 *   pty.spawn('claude', ['--version'])                        → throws `File not found: `  (empty name)
 *   pty.spawn('C:\\Users\\danie\\.local\\bin\\claude.exe', …)  → exit 0, prints "2.1.222 (Claude Code)"
 *   pty.spawn('cmd.exe', ['/c','echo hi'])                     → exit 0
 *
 * `cmd.exe` resolving while `claude` does not is the tell: the extension is what makes CreateProcess's
 * PATH search succeed. `claude` is on PATH only as `claude.exe`, so the lookup never matched and the
 * failure surfaced as the audit ledger's uninformative `"File not found: "` with an EMPTY name.
 *
 * So we resolve server-side and hand node-pty a path it cannot fail to find.
 *
 * TWO PROPERTIES ARE LOAD-BEARING:
 *
 *  1. **Resolved against the CHILD env, not the daemon's.** The caller passes the already-allowlisted
 *     child environment (`buildChildEnv`). What we resolve is therefore exactly what the child process
 *     could itself have found — we can never hand it a path that only the daemon's richer PATH knows
 *     about. This introduces no new trust: the child's PATH is a filtered copy of the daemon's, and it
 *     was already the thing CreateProcess searched.
 *
 *  2. **No shell wrapper.** We never return a `cmd /c` construction. `file` and `args` stay separate
 *     argv elements all the way into node-pty (see `PtyCommand`), so nothing is ever re-parsed by a
 *     shell. Resolving a path preserves that property; wrapping would destroy it.
 *
 * Failure is CLOSED and NAMED: a missing command throws {@link CommandNotFoundError}, which the route
 * turns into a precise `claude-not-found-on-path` audit row and browser reason — never another empty
 * "File not found".
 */
import { statSync } from 'node:fs';
import path from 'node:path';

/** Thrown when a command name matches nothing on the child's PATH. Carries what was searched, so the
 *  audit row and the operator-facing error can both be specific instead of guessing. */
export class CommandNotFoundError extends Error {
  readonly command: string;
  /** How many PATH directories were searched — enough to tell "empty PATH" from "genuinely absent". */
  readonly searchedDirs: number;

  constructor(command: string, searchedDirs: number) {
    super(
      `command not found on the child's PATH: ${JSON.stringify(command)} ` +
        `(searched ${searchedDirs} PATH ${searchedDirs === 1 ? 'directory' : 'directories'})`,
    );
    this.name = 'CommandNotFoundError';
    this.command = command;
    this.searchedDirs = searchedDirs;
  }
}

/** Seams so the resolver is testable without touching this machine's filesystem or clock. */
export interface ResolveCommandDeps {
  /** True when `path` names an existing FILE. Defaults to a `statSync` probe. */
  fileExists?: (path: string) => boolean;
  /** Monotonic-enough clock for the cache TTL. Defaults to `Date.now`. */
  now?: () => number;
  /** Platform switch; defaults to `process.platform`. Only `win32` applies PATHEXT. */
  platform?: string;
}

/** PATHEXT fallback when the child env carries none. `.EXE` precedes the script extensions on purpose:
 *  CreateProcess cannot execute a `.CMD`/`.BAT` directly, so preferring a real executable keeps the
 *  no-shell-wrapper property intact whenever both exist. */
const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD';

/** How long a successful resolution stays cached. Short on purpose: long enough that a burst of spawns
 *  does not re-walk PATH, short enough that reinstalling or moving the CLI is picked up on its own. */
export const RESOLVE_CACHE_TTL_MS = 30_000;

interface CacheEntry { path: string; at: number }

const cache = new Map<string, CacheEntry>();

/** Drop every memoised resolution. Exported for tests and for any future "the CLI moved" invalidation. */
export function clearCommandPathCache(): void {
  cache.clear();
}

const defaultFileExists = (path: string): boolean => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

/** PATH, then Path — Windows env lookups are case-insensitive but our record keys are not.
 * The separator follows the EFFECTIVE platform (deps.platform), not the host: a win32-modeled
 * resolver on a posix host must still split `C:\bin;D:\bin` on `;`. */
function pathEntries(env: Record<string, string | undefined>, isWindows: boolean): string[] {
  const raw = env.PATH ?? env.Path ?? env.path ?? '';
  return raw.split(isWindows ? ';' : ':').map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}

/** The extensions to try, most-preferred first. `''` is always first so an explicit `foo.exe` wins. */
function extensions(env: Record<string, string | undefined>, isWindows: boolean): string[] {
  if (!isWindows) return [''];
  const raw = env.PATHEXT ?? env.PathExt ?? DEFAULT_PATHEXT;
  const exts = raw
    .split(';')
    .map((ext) => ext.trim())
    .filter((ext) => ext.length > 0)
    .map((ext) => (ext.startsWith('.') ? ext : `.${ext}`));
  return ['', ...exts];
}

/**
 * Resolve `command` to an absolute path using `env`'s own PATH (+ PATHEXT on Windows).
 *
 * An ALREADY-absolute command is verified rather than searched — with the PATHEXT variants tried too, so
 * an absolute extensionless name still resolves. Anything unresolvable throws {@link CommandNotFoundError}.
 *
 * Results are cached under a key that includes the PATH and PATHEXT actually used, so a changed
 * environment can never be served a stale answer.
 */
export function resolveCommandPath(
  command: string,
  env: Record<string, string | undefined>,
  deps: ResolveCommandDeps = {},
): string {
  const fileExists = deps.fileExists ?? defaultFileExists;
  const now = deps.now ?? Date.now;
  const isWindows = (deps.platform ?? process.platform) === 'win32';
  const platformPath = isWindows ? path.win32 : path.posix;

  const dirs = platformPath.isAbsolute(command) ? [] : pathEntries(env, isWindows);
  const exts = extensions(env, isWindows);

  const key = `${isWindows ? 'win' : 'posix'}\u0000${command}\u0000${dirs.join(platformPath.delimiter)}\u0000${exts.join(';')}`;
  const hit = cache.get(key);
  if (hit && now() - hit.at < RESOLVE_CACHE_TTL_MS) return hit.path;

  const remember = (path: string): string => {
    cache.set(key, { path, at: now() });
    return path;
  };

  if (platformPath.isAbsolute(command)) {
    for (const ext of exts) {
      const candidate = `${command}${ext}`;
      if (fileExists(candidate)) return remember(candidate);
    }
    throw new CommandNotFoundError(command, 0);
  }

  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = platformPath.join(dir, `${command}${ext}`);
      if (fileExists(candidate)) return remember(candidate);
    }
  }
  throw new CommandNotFoundError(command, dirs.length);
}
