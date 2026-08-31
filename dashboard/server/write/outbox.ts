import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { GitRunner } from './branch.ts';

export type CoordinationPublication = 'direct' | 'outbox';

export interface OutboxManifest {
  schema: 'kb.ops-outbox/v1';
  id: string;
  parent: string;
  commit: string;
  paths: string[];
  createdAt: string;
  bundleSha256: string;
}

export interface SpoolInput {
  repoRoot: string;
  spoolRoot: string;
  commit: string;
  paths: readonly string[];
  runGit: GitRunner;
  isCoordinationPath: (path: string) => boolean;
  now?: () => Date;
}

export type RecoveryInput = Omit<SpoolInput, 'commit' | 'paths'>;

const OUTBOX_ANCHOR = 'refs/kb-outbox/spooled';

export interface FsyncIo {
  platform: string;
  open(path: string): number;
  fsync(fd: number): void;
  close(fd: number): void;
}

const productionFsyncIo: FsyncIo = {
  platform: process.platform,
  open: (path) => openSync(path, 'r'),
  fsync: fsyncSync,
  close: closeSync,
};

export function fsyncPath(path: string, io: FsyncIo = productionFsyncIo): void {
  // The production outbox runs on Linux. Windows test/simulation filesystems may reject fsync with
  // EPERM even for ordinary files, and Windows is never the durable VM publication environment.
  if (io.platform === 'win32') return;
  const fd = io.open(path);
  try {
    io.fsync(fd);
  } finally {
    io.close(fd);
  }
}

function fsyncDirectory(path: string): void {
  fsyncPath(path);
}

/** The durable local spool root every `outbox` writer defaults to; the VM deployment mounts it. */
export const DEFAULT_OUTBOX_ROOT = '/var/lib/kb/state/outbox';

export function resolveCoordinationPublication(
  env: NodeJS.ProcessEnv = process.env,
): CoordinationPublication {
  const value = env.KB_COORDINATION_PUBLICATION ?? 'direct';
  if (value !== 'direct' && value !== 'outbox') {
    throw new Error(`unsupported coordination publication: ${value}`);
  }
  return value;
}

export async function spoolCoordinationCommit(input: SpoolInput): Promise<OutboxManifest> {
  if (!/^[0-9a-f]{40}$/.test(input.commit)) {
    throw new Error('outbox commit is not a full object id');
  }
  const parentRow = (await input.runGit(input.repoRoot, [
    'rev-list', '--parents', '-n', '1', input.commit,
  ])).trim().split(/\s+/);
  if (parentRow.length !== 2 || parentRow[0] !== input.commit) {
    throw new Error('outbox commit must have a single parent');
  }
  const parent = parentRow[1];
  if (!/^[0-9a-f]{40}$/.test(parent)) {
    throw new Error('outbox parent is not a full object id');
  }
  const paths = [...new Set(input.paths.map((path) => path.replace(/\\/g, '/')))].sort();
  const offending = paths.filter((path) => !input.isCoordinationPath(path));
  if (paths.length === 0 || offending.length > 0) {
    throw new Error(
      `outbox commit ${input.commit} contains a non-coordination path: ${offending.join(', ') || '(empty path set)'}`,
    );
  }
  const actualPaths = (await input.runGit(input.repoRoot, [
    'diff-tree', '--no-commit-id', '--name-only', '-r', '-z', input.commit,
  ])).split('\0').filter(Boolean).sort();
  if (JSON.stringify(actualPaths) !== JSON.stringify(paths)) {
    throw new Error('outbox manifest paths do not match the commit');
  }
  const id = input.commit;
  const ready = join(input.spoolRoot, 'ready');
  mkdirSync(ready, { recursive: true });
  const published = join(ready, `${id}.json`);
  if (existsSync(published)) {
    const existing = JSON.parse(readFileSync(published, 'utf8')) as OutboxManifest;
    if (existing.commit !== input.commit || JSON.stringify(existing.paths) !== JSON.stringify(paths)) {
      throw new Error('outbox id collision');
    }
    return Object.freeze(existing);
  }

  const bundleTmp = join(input.spoolRoot, `${id}.bundle.tmp`);
  const manifestTmp = join(input.spoolRoot, `${id}.json.tmp`);
  const readyBundle = join(ready, `${id}.bundle`);
  for (const orphan of [bundleTmp, manifestTmp, readyBundle]) {
    if (existsSync(orphan)) rmSync(orphan);
  }
  const itemRef = `refs/kb-outbox/items/${id}`;
  await input.runGit(input.repoRoot, ['update-ref', itemRef, input.commit]);
  try {
    await input.runGit(input.repoRoot, ['bundle', 'create', bundleTmp, `${parent}..${itemRef}`]);
  } finally {
    await input.runGit(input.repoRoot, ['update-ref', '-d', itemRef]);
  }
  fsyncPath(bundleTmp);
  const instant = (input.now ?? (() => new Date()))();
  if (!Number.isFinite(instant.getTime())) throw new Error('outbox timestamp is invalid');
  const createdAt = instant.toISOString();
  const bundleSha256 = createHash('sha256').update(readFileSync(bundleTmp)).digest('hex');
  const manifest: OutboxManifest = {
    schema: 'kb.ops-outbox/v1',
    id,
    parent,
    commit: input.commit,
    paths,
    createdAt,
    bundleSha256,
  };
  const canonicalManifest = JSON.stringify(manifest, Object.keys(manifest).sort())
    .replace(/[\u007f-\uffff]/g, (unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, '0')}`);
  writeFileSync(manifestTmp, `${canonicalManifest}\n`, { encoding: 'utf8', flag: 'wx' });
  fsyncPath(manifestTmp);
  renameSync(bundleTmp, readyBundle);
  renameSync(manifestTmp, published);
  fsyncDirectory(ready);
  return Object.freeze(manifest);
}

export async function recoverUnspooledCoordinationCommits(
  input: RecoveryInput,
): Promise<OutboxManifest[]> {
  const anchor = (await input.runGit(input.repoRoot, [
    'rev-parse', '--verify', OUTBOX_ANCHOR,
  ])).trim();
  if (!/^[0-9a-f]{40}$/.test(anchor)) throw new Error('outbox anchor is not initialized');
  const commits = (await input.runGit(input.repoRoot, [
    'rev-list', '--reverse', `${anchor}..HEAD`,
  ])).trim().split(/\r?\n/).filter(Boolean);
  const manifests: OutboxManifest[] = [];
  let previous = anchor;
  for (const commit of commits) {
    const raw = await input.runGit(input.repoRoot, [
      'diff-tree', '--no-commit-id', '--name-only', '-r', '-z', commit,
    ]);
    const paths = raw.split('\0').filter(Boolean);
    const manifest = await spoolCoordinationCommit({ ...input, commit, paths });
    await input.runGit(input.repoRoot, ['update-ref', OUTBOX_ANCHOR, commit, previous]);
    previous = commit;
    manifests.push(manifest);
  }
  return manifests;
}
