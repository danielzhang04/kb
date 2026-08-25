import { describe, expect, it } from 'vitest';
import {
  FakePrRegistry, FixtureControlStore, FixtureOpsOutbox, OpsBypassRefused, ScheduleCasConflict,
  isFortyHex,
} from './p4FixtureServer.ts';

const HEAD_A = 'a'.repeat(40);
const HEAD_B = 'b'.repeat(40);
const HEAD_C = 'c'.repeat(40);

describe('FixtureOpsOutbox — publisher-only, idempotent, base-guarded', () => {
  it('appends only through the publisher and is idempotent on the key', () => {
    const outbox = new FixtureOpsOutbox(HEAD_A);
    const receipt = outbox.publishAsPublisher(
      { key: 'k1', purpose: 'learning-proposal', base: HEAD_A, payload: {} }, () => HEAD_B,
    );
    expect(receipt).toEqual({ mode: 'coordination', branch: 'ops', key: 'k1', commit: HEAD_B });
    expect(outbox.head()).toBe(HEAD_B);
    const replay = outbox.publishAsPublisher(
      { key: 'k1', purpose: 'learning-proposal', base: HEAD_A, payload: {} },
      () => { throw new Error('replay must not mint'); },
    );
    expect(replay).toEqual(receipt);
    expect(outbox.log()).toHaveLength(1);
  });

  it('refuses a stale base and audits it', () => {
    const outbox = new FixtureOpsOutbox(HEAD_A);
    expect(() => outbox.publishAsPublisher(
      { key: 'k2', purpose: 'schedule-mirror', base: HEAD_C, payload: {} }, () => HEAD_B,
    )).toThrow(OpsBypassRefused);
    expect(outbox.auditLog()).toEqual([{ kind: 'refused-stale-base', detail: 'k2 pinned ' + HEAD_C }]);
    expect(outbox.head()).toBe(HEAD_A);
  });

  it('refuses a direct append outside the publisher and audits it', () => {
    const outbox = new FixtureOpsOutbox(HEAD_A);
    expect(() => outbox.appendDirect(
      { key: 'k3', purpose: 'schedule-mirror', base: HEAD_A, payload: {} },
    )).toThrow(OpsBypassRefused);
    expect(outbox.auditLog()).toEqual([{ kind: 'refused-direct-write', detail: 'direct append of k3' }]);
    expect(outbox.log()).toHaveLength(0);
  });
});

describe('FixtureControlStore — CAS, one open batch, row-bounded watermark', () => {
  it('bumps per-row revision under CAS and conflicts on a stale expectation', () => {
    const store = new FixtureControlStore();
    const first = store.mutate('r', 0);
    expect(first.revision).toBe(1);
    expect(() => store.mutate('r', 0)).toThrow(ScheduleCasConflict);
    const second = store.mutate('r', 1);
    expect(second.revision).toBe(2);
  });

  it('opens exactly one batch and advances only covered rows on merge', () => {
    const store = new FixtureControlStore();
    store.mutate('a', 0);
    store.mutate('b', 0);
    store.mutate('c', 0);
    const batch = store.openMirrorBatch();
    expect(batch.coveredRowIds).toEqual(['a', 'b', 'c']);
    expect(() => store.openMirrorBatch()).toThrow(ScheduleCasConflict);

    // A fourth mutation while the batch is open is not covered.
    store.mutate('d', 0);
    expect(batch.coveredRowIds).not.toContain('d');

    const merge = 'd'.repeat(40);
    const advanced = store.confirmMirrorMerge(merge, '2026-08-25T07:00:00Z');
    expect(advanced).toEqual(['a', 'b', 'c']);

    const after = store.snapshot();
    const stamped = after.rows.filter((row) => row.mirroredAt === '2026-08-25T07:00:00Z').map((row) => row.id);
    expect(stamped).toEqual(['a', 'b', 'c']);
    expect(after.rows.find((row) => row.id === 'd')?.mirroredAt).toBeNull();

    // A second cycle advances the fourth mutation.
    const secondBatch = store.openMirrorBatch();
    expect(secondBatch.coveredRowIds).toEqual(['d']);
    const secondAdvanced = store.confirmMirrorMerge('e'.repeat(40), '2026-08-25T08:00:00Z');
    expect(secondAdvanced).toEqual(['d']);
  });

  it('refuses a non-hex merge commit', () => {
    const store = new FixtureControlStore();
    store.mutate('a', 0);
    store.openMirrorBatch();
    expect(() => store.confirmMirrorMerge('short', 't')).toThrow();
  });
});

describe('FakePrRegistry — one PR at a time, merge leaves Inbox', () => {
  it('opens against fixture main and merges to a 40-hex commit that leaves Inbox', () => {
    const registry = new FakePrRegistry();
    const pr = registry.open('p4/batch', ['agents/x.md', 'docs/proposals/learnings/r.md']);
    expect(pr.base).toBe('main');
    expect(pr.inInbox).toBe(true);
    expect(registry.openCount()).toBe(1);
    const merged = registry.merge(pr.id, () => 'f'.repeat(40));
    expect(isFortyHex(merged.mergeCommit)).toBe(true);
    expect(merged.inInbox).toBe(false);
    expect(registry.openCount()).toBe(0);
    // Idempotent merge.
    expect(registry.merge(pr.id, () => 'x')).toBe(merged);
  });
});
