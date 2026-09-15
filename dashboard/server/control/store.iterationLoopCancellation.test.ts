/**
 * Regression: stopping a run must not write a control-plane document that the store's own hydrate
 * validator then refuses.
 *
 * 2026-09-15 rehearsal, prod document copy (schema 4, 9 runs, 36 attempts). Run
 * run-971d5ba4-16e5-4010-895f-33e69122984a carries iteration loop
 * iteration-loop-f2149606-c5bd-456e-8e31-2c2354ecb161 in state `rework-queued`, whose turn-owner
 * (`progress-producer` -> stage `no-progress-producer`) had a QUEUED attempt
 * attempt-8d30181f-3efc-4d48-bd3f-409bee6b22c8. One POST .../manager/stop drove that attempt
 * queued -> stopped via execution.ts cancelRun. `validateIterationDurability` required the
 * rework-queued producer attempt to still be `queued`, so the very next load() -- and every load()
 * after it, including the one on daemon boot -- threw `invalid control-plane iteration loop state`.
 * The stop returned 409 automatic-stop-reconciliation-required, every control read returned 500, the
 * self-advertise beat failed, and the daemon crash-looped on the persisted bytes (rev 475 -> 482).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createExistingRootFileStoreHarnessForTest } from './test-fixtures/controlStore.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string =>
  readFileSync(resolve(here, '__fixtures__', 'dv3', name), 'utf8');

const RUN_REF = 'run-971d5ba4-16e5-4010-895f-33e69122984a';
const SUBJECT = 'operator';
const PRODUCER_ATTEMPT = 'attempt-8d30181f-3efc-4d48-bd3f-409bee6b22c8';
const REWORK_LOOP = 'iteration-loop-f2149606-c5bd-456e-8e31-2c2354ecb161';

const roots: string[] = [];
const fileStores = createExistingRootFileStoreHarnessForTest();

const seed = (name: string, source: string): string => {
  const root = mkdtempSync(join(tmpdir(), `${name}-`));
  roots.push(root);
  const path = join(root, 'control', 'control-plane.json');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, source.endsWith('\n') ? source : `${source}\n`, 'utf8');
  return root;
};

afterEach(() => {
  fileStores.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('cancelling a run with a rework-queued iteration loop', () => {
  it('keeps the prod document readable after the producer attempt is stopped', () => {
    const root = seed('cp-rev475', fixture('control-plane.prod-2026-09-06-rev475.json'));

    // 1. Hydrate the untouched prod document.
    const store = fileStores.open(root);
    expect(store.getRun(SUBJECT, RUN_REF).ok).toBe(true);

    const before = store.getRun(SUBJECT, RUN_REF);
    if (!before.ok) throw new Error('fixture run must load');
    const attempt = before.value.attempts.find((candidate) => candidate.attemptRef === PRODUCER_ATTEMPT);
    expect(attempt?.state).toBe('queued');
    expect(before.value.iterationLoops.find((loop) => loop.iterationLoopRef === REWORK_LOOP)?.state)
      .toBe('rework-queued');

    // 2. The exact write cancelRun performs on that attempt (execution.ts:1096-1102).
    const stopped = store.transitionAttempt(SUBJECT, PRODUCER_ATTEMPT, attempt?.version ?? 0, 'stopped');
    expect(stopped.ok).toBe(true);

    // 3. Reads must survive it -- this is the poisoning the incident produced.
    expect(store.getRun(SUBJECT, RUN_REF).ok).toBe(true);
    expect(store.listRuns(SUBJECT).map((run) => run.runRef)).toContain(RUN_REF);

    // 4. And so must a daemon restart re-hydrating the persisted bytes.
    const restarted = fileStores.restart(root);
    expect(restarted.getRun(SUBJECT, RUN_REF).ok).toBe(true);
    expect(restarted.listRuns(SUBJECT).map((run) => run.runRef)).toContain(RUN_REF);
  });

  it('hydrates the document the incident actually persisted (rev 482)', () => {
    const root = seed('cp-rev482', fixture('control-plane.prod-2026-09-15-rev482-poisoned.json'));
    const store = fileStores.open(root);
    const detail = store.getRun(SUBJECT, RUN_REF);
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;
    expect(detail.value.attempts.find((candidate) => candidate.attemptRef === PRODUCER_ATTEMPT)?.state)
      .toBe('stopped');
    // Every control read -- and the self-advertise beat -- goes through the same load().
    expect(store.listRuns(SUBJECT).map((run) => run.runRef)).toContain(RUN_REF);
  });

  // B1 (PR #188 review): the fix above widened validateIterationDurability's
  // terminatedProducerAttempt clause (store.ts:1572-1573) to accept the rework-queued producer
  // attempt in 'stopped', 'interrupted', OR 'failed' -- cancelRun (execution.ts) walks every
  // non-terminal attempt and can drive any of the three, and a crashed host can leave 'interrupted'
  // behind without cancelRun ever running. The test above only exercises 'stopped'; these two cover
  // the other states the widened clause names, on the same fixture and the same attempt, so a
  // revert back to the single-state check (store.ts:1575, dropping 'interrupted' and 'failed' from
  // the `.includes(...)` list) would fail here even though the 'stopped' case still passes.
  it.each(['interrupted', 'failed'] as const)(
    'keeps the prod document readable after the producer attempt is %s',
    (state) => {
      const root = seed(`cp-rev475-${state}`, fixture('control-plane.prod-2026-09-06-rev475.json'));

      const store = fileStores.open(root);
      const before = store.getRun(SUBJECT, RUN_REF);
      if (!before.ok) throw new Error('fixture run must load');
      const attempt = before.value.attempts.find((candidate) => candidate.attemptRef === PRODUCER_ATTEMPT);
      expect(attempt?.state).toBe('queued');

      const transitioned = store.transitionAttempt(SUBJECT, PRODUCER_ATTEMPT, attempt?.version ?? 0, state);
      expect(transitioned.ok).toBe(true);

      // Reads must survive it, same as the 'stopped' case above.
      expect(store.getRun(SUBJECT, RUN_REF).ok).toBe(true);
      expect(store.listRuns(SUBJECT).map((run) => run.runRef)).toContain(RUN_REF);

      // And so must a daemon restart re-hydrating the persisted bytes.
      const restarted = fileStores.restart(root);
      expect(restarted.getRun(SUBJECT, RUN_REF).ok).toBe(true);
      expect(restarted.listRuns(SUBJECT).map((run) => run.runRef)).toContain(RUN_REF);
    },
  );
});
