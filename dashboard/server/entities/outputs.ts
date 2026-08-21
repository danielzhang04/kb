import type { OutputRef } from '../control/p2Contracts.ts';

export type OutputCandidate =
  | { kind: 'repository-file' | 'artifact'; label: string; rootId: string; path: string }
  | { kind: 'external-pr'; label: string; owner: string; repository: string; number: number };

function safeRelativePath(path: string, root: string): boolean {
  if (!path || !root || path.includes('\\') || path.startsWith('/') || /^[a-z]:/i.test(path)) return false;
  const parts = path.split('/');
  const rootParts = root.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..') || rootParts.some((part) => !part || part === '.' || part === '..')) return false;
  return path === root || path.startsWith(`${root}/`);
}

function safeName(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value);
}

export function projectOutputRef(candidate: OutputCandidate, roots: Record<string, string>): OutputRef {
  if (candidate.kind === 'external-pr') {
    if (!safeName(candidate.owner) || !safeName(candidate.repository) || !Number.isSafeInteger(candidate.number) || candidate.number < 1) throw new Error('unsafe-pr');
    return { kind: 'external-pr', label: candidate.label, owner: candidate.owner, repository: candidate.repository, number: candidate.number };
  }
  const root = roots[candidate.rootId];
  if (root === undefined || !safeRelativePath(candidate.path, root)) throw new Error('unsafe-output-path');
  return { kind: candidate.kind, label: candidate.label, path: candidate.path };
}

/** Links are built only from an already-projected closed output union. */
export function outputHref(output: OutputRef): string {
  if (output.kind === 'external-pr') return `https://github.com/${encodeURIComponent(output.owner)}/${encodeURIComponent(output.repository)}/pull/${output.number}`;
  return `/files?path=${encodeURIComponent(output.path)}`;
}
