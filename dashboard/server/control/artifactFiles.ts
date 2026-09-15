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
 *  3. NO SYMLINK TRAVERSAL. The final component is `lstat`ed (never `stat`ed) and refused if it is a
 *     link, and the file is opened with `O_NOFOLLOW` where the platform defines it. Because this server
 *     also runs on Windows, where `pty/fdPinnedPaths.ts`'s `/proc/self/fd` openat walk cannot run, an
 *     ANCESTOR symlink is caught instead by requiring the real path to equal the real root joined with
 *     the requested relative path — any symlinked directory component changes that equality.
 *  4. BOUNDED. A fixed 16 MiB cap, checked against the OPEN descriptor's own `fstat` (not a pre-open
 *     `stat`), so the size that is admitted is the size of the file being read. Over the cap is 413,
 *     deliberately distinguished from 404: the path IS in scope and the operator needs to know the
 *     artifact is too large for this route, not be told it does not exist.
 *  5. VERIFIED. The bytes are hashed and compared to the `sha256` the caller echoes back from the
 *     projection. A mismatch is 409 with NO body — the file changed under the link, and serving the new
 *     bytes under the old link's authority is exactly the substitution this parameter exists to stop.
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
export function readArtifactBytes(repoRoot: string, path: string, roots: Record<string, string>): ArtifactReadResult {
  if (!inAnyRoot(path, roots)) return { ok: false, reason: 'out-of-scope' };
  // `path` is now proven relative, separator-clean and free of `.`/`..` segments, so this join cannot
  // escape repoRoot by string construction; the realpath equality below covers escape by symlink.
  const absolute = join(repoRoot, path);
  try {
    if (lstatSync(absolute).isSymbolicLink()) return { ok: false, reason: 'out-of-scope' };
    const realRoot = realpathSync(resolve(repoRoot));
    const realTarget = realpathSync(absolute);
    if (realTarget !== join(realRoot, path.split('/').join(sep))) return { ok: false, reason: 'out-of-scope' };
  } catch {
    return { ok: false, reason: 'out-of-scope' };
  }

  // O_NOFOLLOW is undefined on Windows; the lstat above is the portable half of the same refusal.
  const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
  let fd: number | null = null;
  try {
    fd = openSync(absolute, flags);
    const stat = fstatSync(fd);
    if (!stat.isFile()) return { ok: false, reason: 'out-of-scope' };
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
