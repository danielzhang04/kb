/**
 * F4 — the scoped, hash-verified artifact download: the READ half.
 *
 * Deliberately free of every route/roster/workflow import so the two PRODUCERS of output links
 * (`agents/routes.ts`, `workflows/routes.ts`) can bind digests through `createOutputDigestReader`
 * without an import cycle. The roots map and the HTTP route live in `artifactFilesRoute.ts`.
 *
 * `entities/outputs.ts` has projected repository-file/artifact links since P2, but nothing ever served
 * them: the URL fell through `static/routes.ts`'s SPA not-found handler and returned `index.html` with
 * HTTP 200, so every "download the run's output" link in the product was dead while the suite stayed
 * green (it asserted the href string only).
 *
 * The rules this module exists to keep, in the order they are applied:
 *  1. SCOPE. The caller's `path` is re-validated with the SAME `safeRelativePath` predicate the
 *     projection used, against the SAME server-owned roots map (`orgs/<project>` for every project a
 *     declaration or workflow entry names). Caller input is never handed to `path.resolve`; the
 *     absolute path is `join(repoRoot, <already-validated relative path>)` and nothing else.
 *  2. OPACITY. Every scope refusal — absolute path, `..`, backslash, unknown root, missing file,
 *     symlink, directory, device — answers a single flat 404. The roots map is not enumerable through
 *     this route, so a caller cannot map the repository by probing it.
 *  3. NO SYMLINK TRAVERSAL — R7: OPEN FIRST, then verify the descriptor. Every check that decides
 *     whether these bytes may be served is made against the OPEN fd, never against a path that a second
 *     `openSync` would re-resolve:
 *       - `O_NOFOLLOW` where the platform defines it, so the open itself refuses a final-component
 *         symlink (POSIX).
 *       - `fstatSync(fd)` for regular-file-ness and the byte cap.
 *       - path identity against `realpathSync('/proc/self/fd/<fd>')` where procfs exists (Linux): the
 *         descriptor's OWN path, which no post-open swap of any component can change.
 *     RESIDUAL, WINDOWS: there is no fd -> path call, and `O_NOFOLLOW` is 0. The fallback re-checks
 *     `lstat`/`realpath` by path AFTER the open, which closes the swap-before-open window but not a swap
 *     landing between the open and that check. The backstop for that residual is the digest: the bytes
 *     are read from THIS descriptor and hashed, and the caller must present the digest the projection
 *     bound, so a substituted file cannot be served under the original link's authority. It can only
 *     cause a refusal.
 *  4. BOUNDED. A fixed 16 MiB cap, checked against the OPEN descriptor's own `fstat` (not a pre-open
 *     `stat`), so the size that is admitted is the size of the file being read.
 *  5. VERIFIED. The bytes are hashed and compared to the `sha256` the caller echoes back from the
 *     projection. A mismatch means the file changed under the link, and serving the new bytes under the
 *     old link's authority is exactly the substitution this parameter exists to stop.
 *
 * R6: the ROUTE renders `too-large` and a digest mismatch as the same flat 404 an out-of-scope path
 * gets, so the distinctions this module returns never reach a caller as an oracle; they are logged.
 */
import { closeSync, constants as fsConstants, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { sha256HexBytes } from '../shared/hashing.ts';
import { safeRelativePath } from '../entities/outputs.ts';
import type { OutputDigestReader } from '../entities/outputs.ts';

/** Fixed byte cap for one download. Not configurable: a cap an operator can raise is not a cap. */
export const ARTIFACT_DOWNLOAD_MAX_BYTES = 16 * 1024 * 1024;

export type ArtifactReadFailure = 'out-of-scope' | 'too-large';

export type ArtifactReadResult =
  | { ok: true; bytes: Buffer; digest: string }
  | { ok: false; reason: ArtifactReadFailure };

/** True when `path` sits under at least one server-owned root by the projection's own predicate. */
function inAnyRoot(path: string, roots: Record<string, string>): boolean {
  return Object.values(roots).some((root) => safeRelativePath(path, root));
}

/**
 * Read one in-scope artifact. Every rejection except the byte cap collapses to `out-of-scope` so the
 * caller cannot distinguish "wrong root" from "absent" from "symlink".
 */
/**
 * R7 — identity of the thing the descriptor is actually attached to.
 *
 * On a platform with `/proc/self/fd` this is decided from the fd alone, so it is immune to any rename or
 * symlink swap that lands after the open. Elsewhere (Windows, macOS) there is no fd -> path call and the
 * check falls back to the path: an `lstat` refusal of a final-component symlink plus the realpath
 * equality that catches an ancestor symlink. Both fallback reads happen AFTER the open, so the only
 * uncovered window is a swap landing inside it — and those bytes still come from this descriptor and are
 * still hashed, so the digest the caller must present refuses them.
 */
function descriptorIsExpectedFile(fd: number, absolute: string, repoRoot: string, path: string): boolean {
  const expected = join(realpathSync(resolve(repoRoot)), path.split('/').join(sep));
  try {
    // Linux: the descriptor's own path. No path component is re-resolved to reach it.
    return realpathSync(`/proc/self/fd/${fd}`) === expected;
  } catch {
    // No procfs. Fall through to the documented path-based residual.
  }
  if (lstatSync(absolute).isSymbolicLink()) return false;
  return realpathSync(absolute) === expected;
}

export function readArtifactBytes(repoRoot: string, path: string, roots: Record<string, string>): ArtifactReadResult {
  if (!inAnyRoot(path, roots)) return { ok: false, reason: 'out-of-scope' };
  // `path` is now proven relative, separator-clean and free of `.`/`..` segments, so this join cannot
  // escape repoRoot by string construction; the descriptor identity check below covers escape by symlink.
  const absolute = join(repoRoot, path);

  // O_NOFOLLOW is undefined on Windows; `descriptorIsExpectedFile` carries the portable half.
  const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
  let fd: number | null = null;
  try {
    fd = openSync(absolute, flags);
    const stat = fstatSync(fd);
    if (!stat.isFile()) return { ok: false, reason: 'out-of-scope' };
    if (!descriptorIsExpectedFile(fd, absolute, repoRoot, path)) return { ok: false, reason: 'out-of-scope' };
    if (stat.size > ARTIFACT_DOWNLOAD_MAX_BYTES) return { ok: false, reason: 'too-large' };
    const bytes = Buffer.allocUnsafe(stat.size);
    let read = 0;
    while (read < stat.size) {
      const chunk = readSync(fd, bytes, read, stat.size - read, read);
      if (chunk <= 0) break;
      read += chunk;
    }
    const exact = bytes.subarray(0, read);
    return { ok: true, bytes: exact, digest: sha256HexBytes(exact) };
  } catch {
    return { ok: false, reason: 'out-of-scope' };
  } finally {
    if (fd !== null) try { closeSync(fd); } catch { /* descriptor already gone */ }
  }
}

/**
 * The projection-time digest binder. Memoized per reader instance: `projectEventOutputRefs` walks up to
 * 250 events and dedupes only AFTER projecting, so the same artifact path is offered for hashing many
 * times per entity-detail request and must be hashed once.
 */
export function createOutputDigestReader(repoRoot: string, roots: Record<string, string>): OutputDigestReader {
  const seen = new Map<string, string | null>();
  return (path) => {
    const cached = seen.get(path);
    if (cached !== undefined) return cached;
    const read = readArtifactBytes(repoRoot, path, roots);
    const digest = read.ok ? read.digest : null;
    seen.set(path, digest);
    return digest;
  };
}
