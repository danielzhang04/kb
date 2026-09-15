import type { OutputRef } from '../control/p2Contracts.ts';
import type { OperationalEvent } from '../control/types.ts';
import { isDigestSha256 } from '../shared/hashing.ts';

/**
 * F4: binds the download digest at PROJECTION time. These projectors are pure (no repo root, no fs), so
 * the producer that already holds `ctx.repoRoot` supplies the reader — see
 * `control/artifactFiles.ts#createOutputDigestReader`. It returns null for a path that does not exist,
 * is not a regular file, is a symlink, or exceeds the download byte cap; such an output still projects
 * (the label stays visible) but carries no digest, so its link cannot be a download.
 */
export type OutputDigestReader = (repoRelativePath: string) => string | null;

export type OutputCandidate =
  | { kind: 'repository-file' | 'artifact'; label: string; rootId: string; path: string }
  | { kind: 'external-pr'; label: string; owner: string; repository: string; number: number };

/** Exported for F4: the download route re-applies THIS predicate, never a second implementation. */
export function safeRelativePath(path: string, root: string): boolean {
  if (!path || !root || path.includes('\\') || path.startsWith('/') || /^[a-z]:/i.test(path)) return false;
  const parts = path.split('/');
  const rootParts = root.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..') || rootParts.some((part) => !part || part === '.' || part === '..')) return false;
  return path === root || path.startsWith(`${root}/`);
}

function safeName(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value);
}

export function projectOutputRef(candidate: OutputCandidate, roots: Record<string, string>, readDigest?: OutputDigestReader): OutputRef {
  if (candidate.kind === 'external-pr') {
    if (!safeName(candidate.owner) || !safeName(candidate.repository) || !Number.isSafeInteger(candidate.number) || candidate.number < 1) throw new Error('unsafe-pr');
    return { kind: 'external-pr', label: candidate.label, owner: candidate.owner, repository: candidate.repository, number: candidate.number };
  }
  const root = roots[candidate.rootId];
  if (root === undefined || !safeRelativePath(candidate.path, root)) throw new Error('unsafe-output-path');
  const digest = readDigest?.(candidate.path);
  return isDigestSha256(digest)
    ? { kind: candidate.kind, label: candidate.label, path: candidate.path, digest }
    : { kind: candidate.kind, label: candidate.label, path: candidate.path };
}

/** Project only safe file-bearing public events; command/tool text never becomes a link. */
export function projectEventOutputRefs(events: readonly OperationalEvent[], roots: Record<string, string>, readDigest?: OutputDigestReader): OutputRef[] {
  const projected = new Map<string, OutputRef>();
  for (const event of [...events].sort((left, right) => right.cursor - left.cursor)) {
    if ((event.kind !== 'file' && event.kind !== 'diff') || !event.path) continue;
    for (const rootId of Object.keys(roots).sort()) {
      try {
        const output = projectOutputRef({ kind: 'repository-file', label: event.summary?.trim() || event.path.split('/').at(-1) || event.path, rootId, path: event.path }, roots, readDigest);
        if (output.kind === 'external-pr') continue;
        if (!projected.has(output.path)) projected.set(output.path, output);
        break;
      } catch {
        // Try the next server-owned root. No matching root means this event is not linkable.
      }
    }
  }
  return [...projected.values()];
}

/**
 * Links are built only from an already-projected closed output union.
 *
 * F4: file outputs point at the scoped, hash-verified download route (`control/artifactFiles.ts`). The
 * `sha256` the caller sends back is the digest bound HERE, over the bytes on disk at projection time —
 * the route re-hashes what it is about to send and refuses (409) if the two disagree, so a file that
 * changed between the page render and the click can never be served as the artifact that was shown.
 * A digest-less output (file absent, not regular, or over the cap) still links; the route answers 400
 * `digest-required` rather than serving unverified bytes.
 */
export function outputHref(output: OutputRef): string {
  if (output.kind === 'external-pr') return `https://github.com/${encodeURIComponent(output.owner)}/${encodeURIComponent(output.repository)}/pull/${output.number}`;
  const base = `/api/control/files?path=${encodeURIComponent(output.path)}`;
  return output.digest ? `${base}&sha256=${encodeURIComponent(output.digest)}` : base;
}
