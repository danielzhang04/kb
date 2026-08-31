// Dashboard v3 P4 section 3.5 — schedule mirror batch preparation and merge.
//
// The store owns the mirror revision; this module owns the batch: one open batch at a time, exact
// replay, a byte-identical watermark as a no-op that opens no PR, and a merge that is proven before
// it CAS-updates only the rows the batch actually covered. Every capability (store, mirror-file
// bytes, renderer process, merge proof) arrives as an injected port.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { sha256Hex } from '../shared/hashing.ts';
import type {
  ScheduleMirrorFilePort,
  ScheduleMirrorMergeProofPort,
  ScheduleMirrorRenderOutcome,
  ScheduleMirrorRendererPort,
  ScheduleMirrorRenderedPath,
  ScheduleMirrorRow,
  ScheduleMirrorSkippedRow,
  ScheduleMirrorStorePort,
} from './contracts.ts';
import {
  MAX_SCHEDULE_MIRROR_PATHS,
  SCHEDULE_MIRROR_BATCH_SCHEMA,
  isWatermarkUnchanged,
  scheduleMirrorBatchId,
} from './mirrorContracts.ts';
import type { ScheduleMirrorBatch, ScheduleMirrorWatermark } from './mirrorContracts.ts';
import { scheduleMirrorOperationKey } from '../write/durableManifest.ts';

export const SCHEDULE_MIRROR_SCRIPT = 'scripts/schedule_mirror.py';

/**
 * The mirrored-row field set, pinned in the order the renderer protocol carries it. The Python side
 * pins the same tuple; `tests/fixtures/dashboard-v3-p4-mirror-vectors.json` is consumed by both
 * suites so a one-sided edit fails a test rather than surfacing as `unknown-row-field` at runtime.
 */
export const MIRROR_ROW_FIELDS = ['id', 'name', 'schedule', 'agent', 'armed'] as const;

export interface ScheduleMirrorPrepareDeps {
  store: ScheduleMirrorStorePort;
  files: ScheduleMirrorFilePort;
  renderer: ScheduleMirrorRendererPort;
}

export interface ScheduleMirrorMergeDeps {
  store: ScheduleMirrorStorePort;
  merge: ScheduleMirrorMergeProofPort;
}

export type ScheduleMirrorPrepareResult =
  | { outcome: 'prepared'; batch: ScheduleMirrorBatch; skipped: ScheduleMirrorSkippedRow[] }
  | { outcome: 'replayed'; batch: ScheduleMirrorBatch }
  | { outcome: 'batch-open'; batch: ScheduleMirrorBatch }
  | { outcome: 'unchanged'; watermark: ScheduleMirrorWatermark; skipped?: ScheduleMirrorSkippedRow[] }
  | { outcome: 'rejected'; code: string; path: string | null };

export type ScheduleMirrorMergeResult =
  | { outcome: 'merged'; batch: ScheduleMirrorBatch; replayed?: true }
  | { outcome: 'no-open-batch' }
  | { outcome: 'stale-batch'; batch: ScheduleMirrorBatch }
  | { outcome: 'not-merged'; batch: ScheduleMirrorBatch }
  | { outcome: 'changed-batch'; batch: ScheduleMirrorBatch };

/** A full canonical snapshot of all mirror rows, order-independent and bounded to mirrored fields. */
export function scheduleMirrorSnapshotDigest(rows: readonly ScheduleMirrorRow[]): string {
  const canonical = [...rows]
    .map((row) => ({
      id: row.id, name: row.name, schedule: row.schedule,
      agent: row.agent, armed: row.armed, mirrorPath: row.mirrorPath,
    }))
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  return sha256Hex(`schedule-mirror-snapshot\u0000${JSON.stringify(canonical)}`);
}

export function createPythonScheduleMirrorRenderer(options: {
  repoRoot: string;
  runPython?: (args: string[], input: string) => string;
}): ScheduleMirrorRendererPort {
  const script = join(options.repoRoot, SCHEDULE_MIRROR_SCRIPT);
  const runPython = options.runPython ?? ((args: string[], input: string): string => {
    const argv = process.platform === 'win32' ? ['-3', ...args] : args;
    const command = process.platform === 'win32' ? 'py' : 'python3';
    // Mirror files are UTF-8; the console codepage must never decide how the payload is read back.
    return execFileSync(command, argv, {
      input, encoding: 'utf8', cwd: options.repoRoot,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
  });
  return {
    render: async (paths) => {
      const payload = JSON.stringify({
        paths: paths.map((entry) => ({
          path: entry.path,
          bytes: entry.bytes,
          rows: entry.rows.map((row) => Object.fromEntries(MIRROR_ROW_FIELDS.map((field) => [field, row[field]]))),
        })),
      });
      let stdout: string;
      try {
        stdout = runPython([script, '--render'], payload);
      } catch (error) {
        const captured = (error as { stdout?: string | Buffer }).stdout;
        if (captured === undefined) return { ok: false, code: 'renderer-failed', path: null };
        stdout = typeof captured === 'string' ? captured : captured.toString('utf8');
      }
      let decoded: unknown;
      try {
        decoded = JSON.parse(stdout);
      } catch {
        return { ok: false, code: 'renderer-invalid', path: null };
      }
      return decodeRenderOutcome(decoded);
    },
  };
}

function decodeRenderOutcome(value: unknown): ScheduleMirrorRenderOutcome {
  if (typeof value !== 'object' || value === null) return { ok: false, code: 'renderer-invalid', path: null };
  const record = value as Record<string, unknown>;
  if (record['ok'] !== true) {
    const code = typeof record['code'] === 'string' ? record['code'] : 'renderer-invalid';
    const path = typeof record['path'] === 'string' ? record['path'] : null;
    return { ok: false, code, path };
  }
  const paths = record['paths'];
  if (!Array.isArray(paths)) return { ok: false, code: 'renderer-invalid', path: null };
  const decoded: ScheduleMirrorRenderedPath[] = [];
  for (const entry of paths) {
    const row = entry as Record<string, unknown>;
    if (typeof row['path'] !== 'string' || typeof row['content'] !== 'string'
      || typeof row['digest'] !== 'string' || typeof row['changed'] !== 'boolean'
      || !Array.isArray(row['skipped'])) {
      return { ok: false, code: 'renderer-invalid', path: null };
    }
    const skipped: ScheduleMirrorSkippedRow[] = [];
    for (const candidate of row['skipped']) {
      const record = candidate as Record<string, unknown>;
      if (typeof record?.['id'] !== 'string' || typeof record['reason'] !== 'string'
        || !(record['name'] === null || typeof record['name'] === 'string')) {
        return { ok: false, code: 'renderer-invalid', path: null };
      }
      skipped.push({ id: record['id'], name: record['name'], reason: record['reason'] });
    }
    decoded.push({
      path: row['path'], content: row['content'], digest: row['digest'], changed: row['changed'], skipped,
    });
  }
  return { ok: true, paths: decoded };
}

export async function prepareScheduleMirrorBatch(
  deps: ScheduleMirrorPrepareDeps,
  options: { now: string },
): Promise<ScheduleMirrorPrepareResult> {
  const snapshot = await deps.store.readScheduleMirrorSnapshot();
  const target: ScheduleMirrorWatermark = {
    revision: snapshot.revision,
    digest: scheduleMirrorSnapshotDigest(snapshot.rows),
  };

  // At most one batch is open. New mutations advance the store watermark but never amend it. A
  // `failed` batch is not open — the next preparation supersedes it, so an abandoned batch cannot
  // wedge the mirror.
  const open = await deps.store.readOpenScheduleMirrorBatch();
  if (open && open.state !== 'merged' && open.state !== 'failed') {
    return isWatermarkUnchanged(open.targetWatermark, target)
      ? { outcome: 'replayed', batch: open }
      : { outcome: 'batch-open', batch: open };
  }

  const base = await deps.store.readMergedScheduleMirrorWatermark();
  if (isWatermarkUnchanged(base, target)) return { outcome: 'unchanged', watermark: target };

  const byPath = new Map<string, ScheduleMirrorRow[]>();
  for (const row of snapshot.rows) {
    const bucket = byPath.get(row.mirrorPath);
    if (bucket) bucket.push(row);
    else byPath.set(row.mirrorPath, [row]);
  }
  const ordered = [...byPath.keys()].sort();

  const inputs: Array<{ path: string; bytes: string; rows: ScheduleMirrorRow[] }> = [];
  for (const path of ordered) {
    inputs.push({
      path,
      bytes: await deps.files.readMirrorFile(path as ScheduleMirrorRow['mirrorPath']),
      rows: byPath.get(path) ?? [],
    });
  }

  const rendered = await deps.renderer.render(inputs);
  if (!rendered.ok) return { outcome: 'rejected', code: rendered.code, path: rendered.path };
  const skipped = rendered.paths.flatMap((entry) => entry.skipped);
  // The cap counts CHANGED files. A path the mirror left byte-identical is excluded before the cap,
  // so a fleet with more than 32 mirror files can still prepare a one-file batch.
  const changed = rendered.paths.filter((entry) => entry.changed);
  if (changed.length > MAX_SCHEDULE_MIRROR_PATHS) {
    return { outcome: 'rejected', code: 'too-many-changed-files', path: null };
  }
  const paths = changed.map((entry) => ({ path: entry.path, digest: entry.digest }));
  if (paths.length === 0) {
    // Nothing to mirror: the files already say what the store says. That is a landed mirror, so the
    // merged watermark advances and `unchanged` keeps exactly one meaning.
    await deps.store.recordScheduleMirrorUnchanged(target);
    return { outcome: 'unchanged', watermark: target, skipped };
  }

  const id = scheduleMirrorBatchId(target);
  const batch: ScheduleMirrorBatch = {
    schema: SCHEDULE_MIRROR_BATCH_SCHEMA,
    id,
    baseWatermark: base,
    targetWatermark: target,
    paths,
    state: 'prepared',
    operationKey: scheduleMirrorOperationKey(id),
    createdAt: options.now,
  };
  // The store CAS decides; the read above is only a fast path. A concurrent preparation that lost
  // the race learns it here, never by overwriting the winner's record.
  const committed = await deps.store.commitScheduleMirrorPreparation(batch);
  if (committed.outcome === 'batch-open') return { outcome: 'batch-open', batch: committed.batch };
  if (committed.outcome === 'replayed') return { outcome: 'replayed', batch: committed.batch };
  return { outcome: 'prepared', batch, skipped };
}

export async function mergeScheduleMirrorBatch(
  deps: ScheduleMirrorMergeDeps,
  options: { batchId: string; mergedAt: string },
): Promise<ScheduleMirrorMergeResult> {
  const open = await deps.store.readOpenScheduleMirrorBatch();
  if (!open) return { outcome: 'no-open-batch' };
  if (open.id !== options.batchId) return { outcome: 'stale-batch', batch: open };
  if (open.state === 'merged') return { outcome: 'merged', batch: open, replayed: true };

  const proof = await deps.merge.proveScheduleMirrorMerge(open);
  if (!proof.merged) return { outcome: 'not-merged', batch: open };
  const expected = new Map(open.paths.map((entry) => [entry.path, entry.digest]));
  if (proof.paths.length !== expected.size
    || proof.paths.some((entry) => expected.get(entry.path) !== entry.digest)) {
    return { outcome: 'changed-batch', batch: open };
  }

  const merged: ScheduleMirrorBatch = { ...open, state: 'merged', pr: proof.pr, mergedAt: options.mergedAt };
  await deps.store.applyScheduleMirrorMerge({ batch: merged, mirroredAt: options.mergedAt });
  return { outcome: 'merged', batch: merged };
}
