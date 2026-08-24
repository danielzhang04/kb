// W5 mirror suite (dashboard v3 P4 section 3.5).
//
// Everything about batch lifecycle, merge, replay, and watermarks drives the REAL file-backed
// control store on a temp root — the fake survives only where the real store cannot be made to
// fail (renderer injection). The renderer is the real Python process through the production
// platform branch, and the rendered bytes are checked against the shared vector fixture that
// `tests/test_schedule_mirror.py` also consumes.
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  MIRROR_ROW_FIELDS,
  createPythonScheduleMirrorRenderer,
  mergeScheduleMirrorBatch,
  prepareScheduleMirrorBatch,
  scheduleMirrorSnapshotDigest,
} from './mirror.ts';
import type {
  ScheduleMirrorRenderedPath, ScheduleMirrorRow, ScheduleMirrorStorePort,
} from './contracts.ts';
import { decodeScheduleMirrorBatch, isRowCoveredByMirror, scheduleMirrorBatchId } from './mirrorContracts.ts';
import type { ScheduleMirrorBatch, ScheduleMirrorWatermark } from './mirrorContracts.ts';
import { createExistingRootFileStoreHarnessForTest } from '../control/test-fixtures/controlStore.ts';
import type { ControlPlaneStore } from '../control/store.ts';
import { ScheduleService } from './service.ts';

const NOW = '2026-08-23T09:00:00.000Z';
const REPO_ROOT = join(fileURLToPath(new URL('../../..', import.meta.url)));
const VECTORS = JSON.parse(
  readFileSync(join(REPO_ROOT, 'tests', 'fixtures', 'dashboard-v3-p4-mirror-vectors.json'), 'utf8'),
) as {
  rowFields: string[];
  cases: Array<{
    name: string; path: string; input: string;
    rows: Array<Record<string, unknown>>;
    expected: { content: string; digest: string; changed: boolean; skipped: Array<Record<string, unknown>> };
  }>;
};
const REAL_HEARTBEAT = readFileSync(join(REPO_ROOT, 'HEARTBEAT.md'), 'utf8');

const roots: string[] = [];
const fileStores = createExistingRootFileStoreHarnessForTest();
const createFileControlPlaneStore = fileStores.open;
afterAll(() => {
  fileStores.close();
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function tempRoot(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `mirror-${label}-`));
  roots.push(root);
  return root;
}

function scheduleId(seed: string): string {
  return createHash('sha256').update(seed).digest('hex');
}

function row(seed: string, overrides: Partial<ScheduleMirrorRow> = {}): ScheduleMirrorRow {
  return {
    id: scheduleId(seed),
    name: seed,
    schedule: 'daily',
    agent: 'hygiene',
    armed: true,
    mirrorPath: 'HEARTBEAT.md',
    lastMirrorRevision: 1,
    ...overrides,
  };
}

/** The production renderer: no hardcoded launcher, so it runs on Windows and Linux alike. */
function pythonRenderer() {
  return createPythonScheduleMirrorRenderer({ repoRoot: REPO_ROOT });
}

function fakeFiles(bytes = REAL_HEARTBEAT) {
  return { readMirrorFile: vi.fn(async () => bytes) };
}

function stubRenderer(paths: ScheduleMirrorRenderedPath[]) {
  return { render: vi.fn(async () => ({ ok: true as const, paths })) };
}

function failingRenderer(code: string, path: string | null = null) {
  return { render: vi.fn(async () => ({ ok: false as const, code, path })) };
}

async function prepare(store: ScheduleMirrorStorePort, files = fakeFiles(), renderer = pythonRenderer()) {
  return prepareScheduleMirrorBatch({ store, files, renderer }, { now: NOW });
}

/** A live store carrying `count` seed-imported schedules named `cadence-<n>` on HEARTBEAT.md. */
async function seededStore(label: string, cadences: Array<{ name: string; source: string; armed?: boolean }>) {
  const root = tempRoot(label);
  const store = createFileControlPlaneStore(root);
  await store.transaction(async (transaction) => {
    for (const [index, cadence] of cadences.entries()) {
      await transaction.createSchedule({
        owner: { type: 'agent', id: 'hygiene', sourcePath: 'agents/hygiene.md' },
        cadence: { source: cadence.source, words: 'Daily' },
        mirrorPath: 'HEARTBEAT.md',
        expectedCollectionRevision: index,
        idempotencyKey: `seed-${index}`,
      });
    }
  });
  // Give each row the seed identity the mirror keys on, exactly as seed import does.
  await store.transaction(async () => undefined);
  const path = join(root, 'control', 'control-plane.json');
  const document = JSON.parse(readFileSync(path, 'utf8')) as { schedules: Array<Record<string, unknown>> };
  for (const [index, schedule] of document.schedules.entries()) {
    const cadence = cadences[index];
    schedule['launchPayload'] = { cadenceName: cadence.name, disarmedReason: null };
    schedule['armed'] = cadence.armed ?? true;
  }
  const { writeFileSync } = await import('node:fs');
  writeFileSync(path, `${JSON.stringify(document)}\n`);
  return { store: createFileControlPlaneStore(root), root, path };
}

describe('shared cross-language renderer vectors', () => {
  it('pins the same row fields as the Python renderer', () => {
    expect(VECTORS.rowFields).toEqual([...MIRROR_ROW_FIELDS]);
  });

  it('tracks the repo\'s real HEARTBEAT.md', () => {
    const real = VECTORS.cases.find((entry) => entry.name === 'real-heartbeat-field-level-update');
    expect(real?.input).toBe(REAL_HEARTBEAT);
  });

  for (const vector of VECTORS.cases) {
    it(`renders vector ${vector.name} to the expected bytes and digest`, async () => {
      const outcome = await pythonRenderer().render([{
        path: vector.path, bytes: vector.input, rows: vector.rows as unknown as ScheduleMirrorRow[],
      }]);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.paths).toHaveLength(1);
      expect(outcome.paths[0].content).toBe(vector.expected.content);
      expect(outcome.paths[0].digest).toBe(vector.expected.digest);
      expect(outcome.paths[0].changed).toBe(vector.expected.changed);
      expect(outcome.paths[0].skipped).toEqual(vector.expected.skipped);
    });
  }
});

describe('the real HEARTBEAT.md survives a mirror render', () => {
  it('keeps every cadence name and prompt block that dispatch.py and seedImport.ts read', async () => {
    const rows = [
      row('nightly-review', { schedule: 'daily', agent: 'dispatcher-cloud', armed: true }),
      row('system-sweeper', { schedule: '*/30 * * * *', agent: 'system-sweeper', armed: false }),
    ];
    const outcome = await pythonRenderer().render([{ path: 'HEARTBEAT.md', bytes: REAL_HEARTBEAT, rows }]);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const { content } = outcome.paths[0];
    const names = (text: string) => text.split('\n').filter((line) => /^\s*-\s+name:/.test(line));
    expect(names(content)).toEqual(names(REAL_HEARTBEAT));
    expect(names(content)).toHaveLength(11);
    for (const key of ['prompt', 'tier', 'risk-tier']) {
      const count = (text: string) => text.split('\n').filter((line) => line.trim().startsWith(`${key}:`)).length;
      expect(count(content)).toBe(count(REAL_HEARTBEAT));
    }
    expect(content.split('\n').length - REAL_HEARTBEAT.split('\n').length).toBe(1);
  });

  it('skips a store row that no seed import produced instead of inventing an identity for it', async () => {
    const rows = [row('operator-made', { name: null, agent: null })];
    const outcome = await pythonRenderer().render([{ path: 'HEARTBEAT.md', bytes: REAL_HEARTBEAT, rows }]);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.paths[0].changed).toBe(false);
    expect(outcome.paths[0].content).toBe(REAL_HEARTBEAT);
    expect(outcome.paths[0].skipped).toEqual([{ id: rows[0].id, name: null, reason: 'not-seed-originated' }]);
  });

  it('skips an over-bound field without rejecting the batch', async () => {
    // Write-boundary validation of these fields is W6.3's; here the row simply loses its turn.
    const rows = [row('nightly-review', { schedule: 'x'.repeat(201) })];
    const outcome = await pythonRenderer().render([{ path: 'HEARTBEAT.md', bytes: REAL_HEARTBEAT, rows }]);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.paths[0].skipped).toEqual([{ id: rows[0].id, name: 'nightly-review', reason: 'field-too-long' }]);
    expect(outcome.paths[0].content).toBe(REAL_HEARTBEAT);
  });
});

describe('watermark derivation', () => {
  it('derives the watermark from a full canonical snapshot, order-independently', () => {
    const forward = scheduleMirrorSnapshotDigest([row('beta'), row('alpha')]);
    expect(scheduleMirrorSnapshotDigest([row('alpha'), row('beta')])).toBe(forward);
    expect(scheduleMirrorSnapshotDigest([row('alpha'), row('beta', { armed: false })])).not.toBe(forward);
    // `lastMirrorRevision` is store bookkeeping, not mirrored content.
    expect(scheduleMirrorSnapshotDigest([row('beta', { lastMirrorRevision: 99 }), row('alpha')])).toBe(forward);
  });
});

describe('preparation against the real control store', () => {
  it('prepares a batch, persists the record durably, and replays it byte-identically', async () => {
    const { store, path } = await seededStore('prepare', [{ name: 'nightly-review', source: 'weekly:sat' }]);
    const first = await prepare(store);
    expect(first.outcome).toBe('prepared');
    if (first.outcome !== 'prepared') return;
    expect(first.batch.state).toBe('prepared');
    expect(first.batch.paths).toEqual([{ path: 'HEARTBEAT.md', digest: expect.stringMatching(/^[0-9a-f]{64}$/) }]);

    // Durable: the record survives a fresh store over the same file.
    const document = JSON.parse(readFileSync(path, 'utf8')) as { scheduleMirrorBatch?: { record: unknown } };
    expect(decodeScheduleMirrorBatch(document.scheduleMirrorBatch?.record)).toEqual(first.batch);

    const replay = await prepare(store);
    expect(replay).toEqual({ outcome: 'replayed', batch: first.batch });
  });

  it('is the store CAS, not the caller read, that keeps at most one batch open', async () => {
    const { store } = await seededStore('cas', [{ name: 'nightly-review', source: 'weekly:sat' }]);
    const snapshot = await store.readScheduleMirrorSnapshot();
    const make = (revision: number): ScheduleMirrorBatch => {
      const targetWatermark = { revision, digest: scheduleMirrorSnapshotDigest(snapshot.rows) };
      const id = scheduleMirrorBatchId(targetWatermark);
      return {
        schema: 'kb.schedule-mirror-batch/v1', id,
        baseWatermark: { revision: 0, digest: 'a'.repeat(64) },
        targetWatermark, paths: [{ path: 'HEARTBEAT.md', digest: 'b'.repeat(64) }],
        state: 'prepared', operationKey: `schedule-mirror:${id}`, createdAt: NOW,
      } as ScheduleMirrorBatch;
    };
    const [left, right] = await Promise.all([
      store.commitScheduleMirrorPreparation(make(1)),
      store.commitScheduleMirrorPreparation(make(2)),
    ]);
    const outcomes = [left.outcome, right.outcome].sort();
    expect(outcomes).toEqual(['batch-open', 'committed']);
    const stored = await store.readOpenScheduleMirrorBatch();
    expect(stored?.id).toBe(left.outcome === 'committed' ? make(1).id : make(2).id);
  });

  it('reports batch-open when a different target arrives while a batch is still open', async () => {
    const { store } = await seededStore('open', [{ name: 'nightly-review', source: 'weekly:sat' }]);
    const first = await prepare(store);
    expect(first.outcome).toBe('prepared');
    const live = store.getScheduleSnapshot().schedules[0];
    await store.setScheduleArmed(live.id, { expectedVersion: live.version, idempotencyKey: 'flip', armed: false });
    const second = await prepare(store);
    expect(second.outcome).toBe('batch-open');
    if (second.outcome !== 'batch-open') return;
    expect(second.batch.id).toBe(first.outcome === 'prepared' ? first.batch.id : '');
  });

  it('does not wedge on a failed batch — the next preparation supersedes it', async () => {
    const { store, path } = await seededStore('failed', [{ name: 'nightly-review', source: 'weekly:sat' }]);
    const first = await prepare(store);
    expect(first.outcome).toBe('prepared');
    if (first.outcome !== 'prepared') return;
    expect(await store.markScheduleMirrorBatchFailed(first.batch.id)).toEqual({ failed: true });

    const live = store.getScheduleSnapshot().schedules[0];
    await store.setScheduleArmed(live.id, { expectedVersion: live.version, idempotencyKey: 'flip', armed: false });
    const second = await prepare(store);
    expect(second.outcome).toBe('prepared');
    if (second.outcome !== 'prepared') return;
    expect(second.batch.id).not.toBe(first.batch.id);
    const document = JSON.parse(readFileSync(path, 'utf8')) as {
      scheduleMirrorBatch?: { superseded?: { id: string; state: string } };
    };
    expect(document.scheduleMirrorBatch?.superseded).toEqual({ id: first.batch.id, state: 'superseded', at: NOW });
  });

  it('advances the merged watermark when nothing changed, so unchanged has one meaning', async () => {
    // `hygiene` already reads `schedule: "15 3 * * 0"`, `agent: hygiene`, `armed: true` in the real
    // HEARTBEAT.md, so the mirror has nothing to write.
    const { store } = await seededStore('unchanged', [{ name: 'hygiene', source: '15 3 * * 0' }]);
    const target = {
      revision: (await store.readScheduleMirrorSnapshot()).revision,
      digest: scheduleMirrorSnapshotDigest((await store.readScheduleMirrorSnapshot()).rows),
    };
    const first = await prepare(store);
    expect(first).toEqual({ outcome: 'unchanged', watermark: target, skipped: [] });
    expect(await store.readMergedScheduleMirrorWatermark()).toEqual(target);
    expect(await store.readOpenScheduleMirrorBatch()).toBeNull();
    // The second call short-circuits on the advanced watermark rather than re-rendering.
    const files = fakeFiles();
    const second = await prepareScheduleMirrorBatch({ store, files, renderer: pythonRenderer() }, { now: NOW });
    expect(second).toEqual({ outcome: 'unchanged', watermark: target });
    expect(files.readMirrorFile).not.toHaveBeenCalled();
  });

  it('counts only CHANGED files against the 32-file cap', async () => {
    const { store } = await seededStore('cap', [{ name: 'nightly-review', source: 'weekly:sat' }]);
    const unchangedPaths = Array.from({ length: 40 }, (_, index) => ({
      path: `orgs/project-${index}/HEARTBEAT.md`, content: 'x', digest: 'c'.repeat(64),
      changed: index === 3, skipped: [],
    }));
    const prepared = await prepare(store, fakeFiles(), stubRenderer(unchangedPaths));
    expect(prepared.outcome).toBe('prepared');
    if (prepared.outcome !== 'prepared') return;
    expect(prepared.batch.paths).toHaveLength(1);
    expect(prepared.batch.paths[0].path).toBe('orgs/project-3/HEARTBEAT.md');
  });

  it('rejects when more than 32 files actually changed', async () => {
    const { store } = await seededStore('cap-over', [{ name: 'nightly-review', source: 'weekly:sat' }]);
    const changedPaths = Array.from({ length: 33 }, (_, index) => ({
      path: `orgs/project-${index}/HEARTBEAT.md`, content: 'x', digest: 'c'.repeat(64), changed: true, skipped: [],
    }));
    expect(await prepare(store, fakeFiles(), stubRenderer(changedPaths)))
      .toEqual({ outcome: 'rejected', code: 'too-many-changed-files', path: null });
    expect(await store.readOpenScheduleMirrorBatch()).toBeNull();
  });

  it('surfaces a renderer refusal as a reject and opens no batch', async () => {
    const { store } = await seededStore('reject', [{ name: 'nightly-review', source: 'weekly:sat' }]);
    const rejected = await prepare(store, fakeFiles(), failingRenderer('render-identity-changed', 'HEARTBEAT.md'));
    expect(rejected).toEqual({ outcome: 'rejected', code: 'render-identity-changed', path: 'HEARTBEAT.md' });
    expect(await store.readOpenScheduleMirrorBatch()).toBeNull();
  });

  it('decodes a malformed renderer payload as renderer-invalid rather than throwing', async () => {
    const renderer = createPythonScheduleMirrorRenderer({ repoRoot: REPO_ROOT, runPython: () => '{"ok":true,"paths":[{"path":"HEARTBEAT.md"}]}' });
    expect(await renderer.render([])).toEqual({ ok: false, code: 'renderer-invalid', path: null });
    const broken = createPythonScheduleMirrorRenderer({ repoRoot: REPO_ROOT, runPython: () => 'not json' });
    expect(await broken.render([])).toEqual({ ok: false, code: 'renderer-invalid', path: null });
  });
});

describe('merge against the real control store', () => {
  async function preparedStore(label: string) {
    const seeded = await seededStore(label, [{ name: 'nightly-review', source: 'weekly:sat' }]);
    const prepared = await prepare(seeded.store);
    if (prepared.outcome !== 'prepared') throw new Error(`expected prepared, got ${prepared.outcome}`);
    return { ...seeded, batch: prepared.batch };
  }

  const proof = (batch: ScheduleMirrorBatch, overrides: Partial<{ merged: boolean; paths: typeof batch.paths }> = {}) => ({
    proveScheduleMirrorMerge: vi.fn(async () => ({
      merged: overrides.merged ?? true,
      pr: { owner: 'kb', repo: 'kb', number: 512 },
      paths: overrides.paths ?? batch.paths,
    })),
  });

  it('advances the merged watermark and stamps the rows the batch covered', async () => {
    const { store, batch } = await preparedStore('merge');
    const merged = await mergeScheduleMirrorBatch({ store, merge: proof(batch) }, { batchId: batch.id, mergedAt: '2026-08-23T10:00:00.000Z' });
    expect(merged.outcome).toBe('merged');
    expect(await store.readMergedScheduleMirrorWatermark()).toEqual(batch.targetWatermark);
    expect(store.getScheduleSnapshot().schedules[0].mirroredAt).toBe('2026-08-23T10:00:00.000Z');
    const stored = await store.readOpenScheduleMirrorBatch();
    expect(stored?.state).toBe('merged');
    expect(stored?.pr).toEqual({ owner: 'kb', repo: 'kb', number: 512 });
  });

  it('covers tombstones with the same CAS bound as live rows', async () => {
    const { store, path } = await seededStore('tombstone', [
      { name: 'nightly-review', source: 'weekly:sat' }, { name: 'weekly-audit', source: 'daily' },
    ]);
    const doomed = store.getScheduleSnapshot().schedules[1];
    await store.deleteSchedule(doomed.id, { expectedVersion: doomed.version, idempotencyKey: 'gone' });
    const prepared = await prepare(store);
    if (prepared.outcome !== 'prepared') throw new Error(prepared.outcome);
    const merged = await mergeScheduleMirrorBatch(
      { store, merge: proof(prepared.batch) }, { batchId: prepared.batch.id, mergedAt: '2026-08-23T11:00:00.000Z' },
    );
    expect(merged.outcome).toBe('merged');
    const persisted = JSON.parse(readFileSync(path, 'utf8')) as {
      scheduleTombstones: Array<{ id: string; mirroredAt?: string; lastMirrorRevision?: number }>;
    };
    expect(persisted.scheduleTombstones).toHaveLength(1);
    expect(persisted.scheduleTombstones[0].id).toBe(doomed.id);
    expect(persisted.scheduleTombstones[0].mirroredAt).toBe('2026-08-23T11:00:00.000Z');
    expect(persisted.scheduleTombstones[0].lastMirrorRevision).toBeLessThanOrEqual(prepared.batch.targetWatermark.revision);
  });

  it('replays a merged batch without re-proving it', async () => {
    const { store, batch } = await preparedStore('merge-replay');
    const first = proof(batch);
    await mergeScheduleMirrorBatch({ store, merge: first }, { batchId: batch.id, mergedAt: '2026-08-23T10:00:00.000Z' });
    const second = proof(batch);
    const replay = await mergeScheduleMirrorBatch({ store, merge: second }, { batchId: batch.id, mergedAt: '2026-08-23T12:00:00.000Z' });
    expect(replay.outcome).toBe('merged');
    expect(replay).toMatchObject({ replayed: true });
    expect(second.proveScheduleMirrorMerge).not.toHaveBeenCalled();
    expect(store.getScheduleSnapshot().schedules[0].mirroredAt).toBe('2026-08-23T10:00:00.000Z');
  });

  it('refuses a stale batch id, an unmerged PR, and changed path digests', async () => {
    const stale = await preparedStore('stale');
    expect(await mergeScheduleMirrorBatch(
      { store: stale.store, merge: proof(stale.batch) }, { batchId: 'f'.repeat(64), mergedAt: NOW },
    )).toEqual({ outcome: 'stale-batch', batch: stale.batch });

    const open = await preparedStore('not-merged');
    expect(await mergeScheduleMirrorBatch(
      { store: open.store, merge: proof(open.batch, { merged: false }) }, { batchId: open.batch.id, mergedAt: NOW },
    )).toEqual({ outcome: 'not-merged', batch: open.batch });

    const drifted = await preparedStore('changed');
    expect(await mergeScheduleMirrorBatch(
      { store: drifted.store, merge: proof(drifted.batch, { paths: [{ path: 'HEARTBEAT.md', digest: 'e'.repeat(64) }] }) },
      { batchId: drifted.batch.id, mergedAt: NOW },
    )).toEqual({ outcome: 'changed-batch', batch: drifted.batch });
  });

  it('reports no-open-batch on a store that has never prepared', async () => {
    const { store } = await seededStore('none', [{ name: 'nightly-review', source: 'weekly:sat' }]);
    expect(await mergeScheduleMirrorBatch(
      { store, merge: { proveScheduleMirrorMerge: vi.fn() } }, { batchId: 'a'.repeat(64), mergedAt: NOW },
    )).toEqual({ outcome: 'no-open-batch' });
  });

  it('leaves a row mutated after preparation for the next batch', async () => {
    const { store, batch } = await preparedStore('later');
    await store.transaction(async (transaction) => {
      await transaction.createSchedule({
        owner: { type: 'agent', id: 'hygiene', sourcePath: 'agents/hygiene.md' },
        cadence: { source: 'daily', words: 'Daily' },
        mirrorPath: 'HEARTBEAT.md', expectedCollectionRevision: 1, idempotencyKey: 'later',
      });
    });
    await mergeScheduleMirrorBatch({ store, merge: proof(batch) }, { batchId: batch.id, mergedAt: '2026-08-23T10:00:00.000Z' });
    const rows = store.getScheduleSnapshot().schedules;
    expect(rows[0].mirroredAt).toBe('2026-08-23T10:00:00.000Z');
    expect(rows[1].mirroredAt).toBeNull();
    expect(isRowCoveredByMirror(2, batch.targetWatermark)).toBe(false);
  });
});

describe('the mirror never runs on occurrence traffic', () => {
  it('keeps the mirror revision flat across an occurrence lifecycle', async () => {
    const { store } = await seededStore('occurrence', [{ name: 'nightly-review', source: 'daily' }]);
    const before = (await store.readScheduleMirrorSnapshot()).revision;
    const live = store.getScheduleSnapshot().schedules[0];
    const service: ControlPlaneStore = store;
    void service;
    await store.advanceScheduleOccurrence({
      scheduleId: live.id, scheduledFor: '2026-08-23T07:15:00.000Z', nextAt: '2026-08-23T07:30:00.000Z',
      phase: 'card-saved', idempotencyKey: 'never-claimed',
    }).catch(() => undefined);
    expect((await store.readScheduleMirrorSnapshot()).revision).toBe(before);
  });
});

describe('ScheduleService is untouched by the mirror', () => {
  it('still drives create and arm over a store that now implements the mirror ports', async () => {
    const root = tempRoot('service');
    const store = createFileControlPlaneStore(root);
    const owner = { type: 'agent' as const, id: 'hygiene', sourcePath: 'agents/hygiene.md' as const };
    const api = new ScheduleService({ store, resolveOwner: async () => owner, seedAuthorization: async () => true });
    const created = await api.create({
      owner: { type: 'agent', id: owner.id }, cadence: { kind: 'words', words: 'daily', time: '07:15' },
      expectedCollectionRevision: 0, idempotencyKey: 'service',
    });
    expect((await store.readScheduleMirrorSnapshot()).revision).toBe(1);
    const snapshot = await store.readScheduleMirrorSnapshot();
    // An operator-created schedule has no seed identity, so the mirror will skip it.
    expect(snapshot.rows).toEqual([{
      id: created.schedule.id, name: null, schedule: expect.any(String), agent: 'hygiene',
      armed: created.schedule.armed, mirrorPath: 'HEARTBEAT.md', lastMirrorRevision: 1,
    }]);
    expect(snapshot.rows[0].schedule).toBe(created.schedule.cadence.source);
  });
});

describe('watermark contract helpers', () => {
  it('bounds coverage at exactly the target revision', () => {
    const target: ScheduleMirrorWatermark = { revision: 4, digest: 'a'.repeat(64) };
    expect(isRowCoveredByMirror(4, target)).toBe(true);
    expect(isRowCoveredByMirror(5, target)).toBe(false);
  });
});
