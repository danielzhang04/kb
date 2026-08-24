// P4 section 3.3 / P4-C35: the composition-time repository pin. This is W0's ONE behavioral module
// and the only new P4 file permitted to spawn `git` — READ-ONLY `git remote get-url origin`, the
// fifth named exception in the section 3.2 capability table [P4-C40]. It exports a parsed VALUE, never
// a runner: `runGitRemoteGetUrl` is module-private, so no importer inherits a git capability.
import { execFileSync } from 'node:child_process';
import { isAbsolute, join } from 'node:path';
import { existsSync, statSync } from 'node:fs';

export interface RepositoryPin {
  readonly owner: string;
  readonly repo: string;
}

export class RepositoryPinError extends Error {
  readonly reason: 'missing' | 'ambiguous' | 'non-github' | 'unparseable' | 'root';
  constructor(reason: RepositoryPinError['reason'], detail: string) {
    super(`repository pin ${reason}: ${detail}`);
    this.name = 'RepositoryPinError';
    this.reason = reason;
  }
}

export const GIT_REMOTE_TIMEOUT_MS = 10_000;

/**
 * The single accepted remote grammar: `github.com[:/]<owner>/<repo>(.git)?`, HTTPS or SSH. Anything
 * else — another host, a nested path, a missing segment — refuses.
 */
const GITHUB_REMOTE = /^(?:https:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9][A-Za-z0-9._-]*)\/([A-Za-z0-9][A-Za-z0-9._-]*?)(?:\.git)?\/?$/;

export function parseGitHubRemote(remoteUrl: string): RepositoryPin {
  const trimmed = remoteUrl.trim();
  if (trimmed.length === 0) throw new RepositoryPinError('missing', 'empty remote url');
  const match = GITHUB_REMOTE.exec(trimmed);
  if (match === null) {
    const reason = /github\.com/i.test(trimmed) ? 'unparseable' : 'non-github';
    throw new RepositoryPinError(reason, `refused remote ${JSON.stringify(trimmed)}`);
  }
  return { owner: match[1]!, repo: match[2]! };
}

/** Injectable ONLY so the suite can drive the parser; production leaves it at the private default. */
export type GitRemoteReader = (coordinationRoot: string) => string;

function runGitRemoteGetUrl(coordinationRoot: string): string {
  return execFileSync('git', ['remote', 'get-url', 'origin'], {
    cwd: coordinationRoot, encoding: 'utf8', timeout: GIT_REMOTE_TIMEOUT_MS, windowsHide: true,
  });
}

/**
 * Runs the read exactly once against the composition-time coordination root and returns the parsed
 * pin. A missing `origin`, two `origin` URLs, a non-GitHub host, or an unparseable remote throws and
 * therefore fails composition [P4-C35].
 */
export function resolveRepositoryPin(
  coordinationRoot: string,
  readRemote: GitRemoteReader = runGitRemoteGetUrl,
): RepositoryPin {
  if (!isAbsolute(coordinationRoot)) {
    throw new RepositoryPinError('root', `coordination root must be absolute, got ${JSON.stringify(coordinationRoot)}`);
  }
  let raw: string;
  try {
    raw = readRemote(coordinationRoot);
  } catch (error: unknown) {
    throw new RepositoryPinError('missing', error instanceof Error ? error.message : String(error));
  }
  const urls = raw.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
  if (urls.length === 0) throw new RepositoryPinError('missing', 'no origin remote');
  if (urls.length > 1) throw new RepositoryPinError('ambiguous', `${urls.length} origin urls`);
  return parseGitHubRemote(urls[0]!);
}

/** Injectable directory probe so the composition check is testable without touching a real tree. */
export type DirectoryProbe = (path: string) => boolean;

function directoryExists(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}

/**
 * The one composition-time check P4 adds [P4-C39]: `coordinationRoot` must be absolute and must
 * contain a `queue/` directory. It is the existing `HttpSurfaceContext.repoRoot`, never
 * `resolveDurableRepoRoot()`; W6.1 wires this call at composition.
 */
export function assertCoordinationRoot(
  coordinationRoot: string,
  probe: DirectoryProbe = directoryExists,
): string {
  if (typeof coordinationRoot !== 'string' || coordinationRoot.length === 0 || !isAbsolute(coordinationRoot)) {
    throw new RepositoryPinError('root', `coordination root must be an absolute path, got ${JSON.stringify(coordinationRoot)}`);
  }
  if (!probe(join(coordinationRoot, 'queue'))) {
    throw new RepositoryPinError('root', `coordination root has no queue/ directory: ${coordinationRoot}`);
  }
  return coordinationRoot;
}
