/**
 * D3.2 — the PTY HOST process (shipped to run under the constrained fleet identity, registered as a
 * Windows scheduled task by the D3.1 human gate). This is the ONLY component in the design that ever
 * spawns `node-pty`. It listens on the authenticated local channel (a named pipe with a
 * peer-credential check + per-boot token — the pipe/server wiring lands with the D3.1 go-live gate),
 * and on a valid open-request from the daemon it spawns a shell PTY.
 *
 * Two invariants are load-bearing and asserted by the test suite:
 *
 *  1. **Explicit env allowlist.** The child shell's environment is built from a fixed ALLOWLIST of
 *     variable names — never `process.env` verbatim. Push credentials and the Claude Code OAuth token
 *     (`CLAUDE_CODE_OAUTH_TOKEN`, `GITHUB_TOKEN`, `GH_TOKEN`, `GIT_ASKPASS`, `ANTHROPIC_API_KEY`, …)
 *     are therefore excluded even when present in the host's own environment: a terminal opened here
 *     cannot `git push` with the fleet's stored credential, nor read the OAuth token out of its env.
 *     A denylist is enforced on top of the allowlist as defence-in-depth so a name can never leak even
 *     if a future edit widens the allowlist.
 *
 *  2. **Process-group tracking.** Every spawned PTY is tracked by session id, and a scoped stop kills
 *     that session's whole process group (node-pty's `kill()` terminates the ConPTY/child tree). A
 *     `stopAll()` reaps every live session — the D2.8 stop floor and a host shutdown both route through
 *     it, so no orphaned shell survives a fleet stop.
 *
 * The `node-pty` factory is injectable (`PtyFactory`, same DI shape as `VibeSpawner`) so the suite is
 * hermetic: no real `node-pty` native addon is loaded under test. The real default lazily loads
 * `node-pty` only when actually spawning — so this module type-checks and imports even in an
 * environment where the native ConPTY prebuild is not present (it is vendored/built at the D3.1 gate).
 */
import { createRequire } from 'node:module';
import { buildChildEnv, DEFAULT_ENV_ALLOWLIST } from '../control/childEnv.ts';

export {
  buildChildEnv,
  DEFAULT_ENV_ALLOWLIST,
  DENIED_ENV_FRAGMENTS,
  isDeniedEnvName,
} from '../control/childEnv.ts';

/** Options passed to the pty factory for one spawn. `env` is the ALREADY-allowlisted child env. */
export interface PtySpawnOptions {
  cwd: string;
  cols: number;
  rows: number;
  /** The fully-built, allowlisted child environment. Never `process.env` verbatim. */
  env: Record<string, string>;
  /** Terminal name (e.g. `xterm-color`). */
  name: string;
}

/** A minimal handle onto one spawned `node-pty` process — the subset the host drives. */
export interface PtyHandle {
  readonly pid: number;
  onData(cb: (chunk: string) => void): void;
  onExit(cb: (evt: { exitCode: number; signal?: number }) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  /** Kills the PTY and its child process group (ConPTY terminates the whole tree). */
  kill(signal?: string): void;
}

/** Spawns a shell PTY. Injected for hermetic tests — the real default lazily loads `node-pty`. */
export type PtyFactory = (file: string, args: string[], opts: PtySpawnOptions) => PtyHandle;

/**
 * Default factory: lazily `require('node-pty')` and spawn. `node-pty` is loaded ONLY here, ONLY when a
 * spawn actually happens — never at module import — so `host.ts` imports and type-checks fine without
 * the native addon present (the ConPTY prebuild is vendored/built at the D3.1 go-live gate). The
 * suite never reaches this path; it injects a fake factory.
 */
export const defaultPtyFactory: PtyFactory = (file, args, opts) => {
  const require = createRequire(import.meta.url);
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pty = require('node-pty') as {
    spawn(file: string, args: string[], options: Record<string, unknown>): {
      pid: number;
      onData(cb: (data: string) => void): void;
      onExit(cb: (e: { exitCode: number; signal?: number }) => void): void;
      write(data: string): void;
      resize(cols: number, rows: number): void;
      kill(signal?: string): void;
    };
  };
  const proc = pty.spawn(file, args, {
    name: opts.name,
    cols: opts.cols,
    rows: opts.rows,
    cwd: opts.cwd,
    env: opts.env,
  });
  return {
    pid: proc.pid,
    onData: (cb) => proc.onData(cb),
    onExit: (cb) => proc.onExit(cb),
    write: (data) => proc.write(data),
    resize: (cols, rows) => proc.resize(cols, rows),
    kill: (signal) => proc.kill(signal),
  };
};

/** A live, host-tracked PTY session. */
export interface PtySession {
  readonly sessionId: string;
  readonly handle: PtyHandle;
}

/** Dependencies for the host. Every field is hermetic-test-safe. */
export interface PtyHostDeps {
  ptyFactory?: PtyFactory;
  /** The host's own environment — the source the allowlist filters. Defaults to `process.env`. */
  parentEnv?: Record<string, string | undefined>;
  envAllowlist?: readonly string[];
  /** The shell to spawn. Defaults to the platform shell. */
  shell?: string;
  /** Terminal name passed to node-pty. Defaults to `xterm-color`. */
  termName?: string;
  /** Injectable session-id source; tests pin it for deterministic assertions. */
  sessionId?: () => string;
}

/**
 * A program to run in the PTY instead of the login shell, expressed as an ARGV ARRAY.
 *
 * Load-bearing: `file` and `args` stay separate all the way into `node-pty`. No caller composes a shell
 * command string, so nothing a request carries is ever re-parsed by a shell — the only way to influence
 * the child is to add an argv element, and every producer of one is server-side.
 */
export interface PtyCommand {
  file: string;
  args: readonly string[];
}

/** A request to open a PTY, as received from the daemon over the authenticated channel. */
export interface HostOpenRequest {
  requestId: string;
  cols: number;
  rows: number;
  cwd: string;
  /** Non-default program for this session (see {@link PtyCommand}). Absent = the login shell, no args. */
  command?: PtyCommand;
}

/** The PTY host: opens tracked sessions and reaps them by scope. */
export interface PtyHost {
  /** Spawn a shell PTY for `req`, tracked by session id. The child env is allowlist-filtered. */
  open(req: HostOpenRequest): PtySession;
  /** Scoped stop: kill this session's process group and forget it. Returns whether it existed. */
  stop(sessionId: string): boolean;
  /** Reap every live session (host shutdown / fleet STOP). */
  stopAll(): void;
  /** The ids of every currently-tracked session. */
  sessions(): string[];
}

function defaultShell(parentEnv: Record<string, string | undefined>): string {
  if (process.platform === 'win32') return parentEnv.ComSpec || parentEnv.COMSPEC || 'powershell.exe';
  return parentEnv.SHELL || '/bin/bash';
}

let sessionCounter = 0;

/**
 * Create a PTY host. Tracks every spawned session so a scoped `stop` kills exactly one session's
 * process group and `stopAll` reaps them all — no orphaned shells survive a stop.
 */
export function createPtyHost(deps: PtyHostDeps = {}): PtyHost {
  const factory = deps.ptyFactory ?? defaultPtyFactory;
  const parentEnv = deps.parentEnv ?? process.env;
  const allowlist = deps.envAllowlist ?? DEFAULT_ENV_ALLOWLIST;
  const shell = deps.shell ?? defaultShell(parentEnv);
  const termName = deps.termName ?? 'xterm-color';
  const nextId = deps.sessionId ?? (() => `pty-${Date.now()}-${(sessionCounter += 1)}`);

  const live = new Map<string, PtySession>();

  return {
    open(req) {
      const env = buildChildEnv(parentEnv, allowlist);
      // The env is built the SAME way for every session — a non-shell program (e.g. an agent-primed
      // `claude`) inherits exactly the allowlisted, denylist-scrubbed environment a plain shell does.
      const file = req.command ? req.command.file : shell;
      const args = req.command ? [...req.command.args] : [];
      const handle = factory(file, args, { cwd: req.cwd, cols: req.cols, rows: req.rows, env, name: termName });
      const sessionId = nextId();
      const session: PtySession = { sessionId, handle };
      live.set(sessionId, session);
      // A self-exit reaps its own tracking entry so `sessions()` never lists a dead shell.
      handle.onExit(() => {
        live.delete(sessionId);
      });
      return session;
    },
    stop(sessionId) {
      const session = live.get(sessionId);
      if (!session) return false;
      session.handle.kill(); // kills the whole ConPTY/child process group
      live.delete(sessionId);
      return true;
    },
    stopAll() {
      for (const session of live.values()) {
        session.handle.kill();
      }
      live.clear();
    },
    sessions() {
      return [...live.keys()];
    },
  };
}
