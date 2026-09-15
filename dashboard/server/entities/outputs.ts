import type { OutputEntityRef, OutputRef } from '../control/p2Contracts.ts';
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

/**
 * R5: the projecting entity is stamped onto every file output here, at the only place that knows BOTH the
 * roots map a link was granted under and the entity those roots came from. `outputHref` puts it in the
 * URL and the download route re-derives the roots from it, so a link can never reach outside the projects
 * of the entity whose page rendered it. An entity-less file output still projects (the label stays
 * visible) but carries no download link.
 */
export function projectOutputRef(candidate: OutputCandidate, roots: Record<string, string>, readDigest?: OutputDigestReader, entity?: OutputEntityRef): OutputRef {
  if (candidate.kind === 'external-pr') {
    if (!safeName(candidate.owner) || !safeName(candidate.repository) || !Number.isSafeInteger(candidate.number) || candidate.number < 1) throw new Error('unsafe-pr');
    return { kind: 'external-pr', label: candidate.label, owner: candidate.owner, repository: candidate.repository, number: candidate.number };
  }
  const root = roots[candidate.rootId];
  if (root === undefined || !safeRelativePath(candidate.path, root)) throw new Error('unsafe-output-path');
  const digest = readDigest?.(candidate.path);
  const base = { kind: candidate.kind, label: candidate.label, path: candidate.path } as const;
  const withDigest = isDigestSha256(digest) ? { ...base, digest } : base;
  return entity ? { ...withDigest, entity: { type: entity.type, id: entity.id } } : withDigest;
}

/** Project only safe file-bearing public events; command/tool text never becomes a link. */
export function projectEventOutputRefs(events: readonly OperationalEvent[], roots: Record<string, string>, readDigest?: OutputDigestReader, entity?: OutputEntityRef): OutputRef[] {
  const projected = new Map<string, OutputRef>();
  for (const event of [...events].sort((left, right) => right.cursor - left.cursor)) {
    if ((event.kind !== 'file' && event.kind !== 'diff') || !event.path) continue;
    for (const rootId of Object.keys(roots).sort()) {
      try {
        const output = projectOutputRef({ kind: 'repository-file', label: event.summary?.trim() || event.path.split('/').at(-1) || event.path, rootId, path: event.path }, roots, readDigest, entity);
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
 * R5: the href also names the PROJECTING ENTITY. The route resolves that entity, repeats the check its
 * own read route performs, and builds the roots map from that entity's declared projects alone — so a
 * link is only ever redeemable for files the page that rendered it could itself have projected. The
 * project is deliberately NOT carried in the URL: the route derives it from the entity, so no part of the
 * scope decision is caller-supplied.
 *
 * A file output missing either half (no digest, or no projecting entity) yields a link the route refuses;
 * both UI call sites therefore render no link at all rather than a dead one.
 */
export function outputHref(output: OutputRef): string {
  if (output.kind === 'external-pr') return `https://github.com/${encodeURIComponent(output.owner)}/${encodeURIComponent(output.repository)}/pull/${output.number}`;
  const parts = [`path=${encodeURIComponent(output.path)}`];
  if (output.digest) parts.push(`sha256=${encodeURIComponent(output.digest)}`);
  if (output.entity) parts.push(`entityType=${encodeURIComponent(output.entity.type)}`, `entityId=${encodeURIComponent(output.entity.id)}`);
  return `/api/control/files?${parts.join('&')}`;
}
