import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrokerPersistence } from './broker.ts';
import { createSubjectBrokerPersistence } from './brokerStore.ts';
import {
  createInMemoryControlPlaneStore,
  type ControlPlaneStore,
} from './store.ts';
import { createExistingRootFileStoreHarnessForTest } from './test-fixtures/controlStore.ts';

const roots: string[] = [];
const fileStores = createExistingRootFileStoreHarnessForTest();
const createFileControlPlaneStore = fileStores.open;
afterEach(() => {
  fileStores.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function options() {
  let id = 0;
  let second = 0;
  return {
    newId: () => String(++id),
    now: () => new Date(Date.UTC(2026, 6, 18, 16, 0, second++)),
  };
}

function createRun(store: ControlPlaneStore, subject = 'alice') {
  const proposal = store.createProposalRevision(subject, {
    sourceComposerRef: `composer-${subject}`,
    sourceTurnId: `turn-${subject}`,
    title: 'Broker durability',
    // `createRun` proves its immutable provenance against the approved snapshot. This broker fixture
    // does not exercise compiler assignments, but it must still provide the minimal matching manager
    // and stage identity the store verifies.
    snapshot: {
      schema: 'kb.plan-proposal/v1', manager: {},
      stages: [{ id: 'build', title: 'Build', dependsOn: [] }],
    },
  });
  if (!proposal.ok) throw new Error(proposal.detail);
  const approved = store.decideProposal(subject, proposal.value.proposalRef, proposal.value.revision, {
    expectedHash: proposal.value.hash,
    expectedApprovalRevision: 0,
    decision: 'approved',
    idempotencyKey: `approve-${subject}`,
  });
  if (!approved.ok) throw new Error(approved.detail);
  const run = store.createRun(subject, {
    title: 'Broker run',
    proposalRef: approved.value.proposalRef,
    proposalRevision: approved.value.revision,
    expectedProposalHash: approved.value.hash,
    managerRuntime: 'claude',
    managerModel: 'claude-sonnet-5',
    idempotencyKey: `run-${subject}`,
    stages: [{ stageId: 'build', title: 'Build', dependsOn: [] }],
  });
  if (!run.ok) throw new Error(run.detail);
  return run.value;
}

function spec(run: ReturnType<typeof createRun>) {
  return {
    runRef: run.run.runRef,
    sessionRef: run.run.managerSessionRef,
    role: 'manager' as const,
    profileId: 'claude-manager-auto',
    approvedPrompt: 'Execute the immutable approved synthetic plan.',
  };
}

function enqueue(
  persistence: BrokerPersistence,
  input: Parameters<BrokerPersistence['enqueueSteering']>[0] & { checkpoint: string | null },
) {
  return persistence.enqueueSteering(input);
}

describe('subject-bound broker persistence', () => {
  it('atomically reserves a session, emits one event, and never projects broker-private state', () => {
    const store = createInMemoryControlPlaneStore(options());
    const run = createRun(store);
    const persistence = createSubjectBrokerPersistence(store, 'alice');
    const start = { spec: spec(run), idempotencyKey: 'start-1' };

    expect(persistence.reserveStart(start)).toEqual({ status: 'reserved', revision: 2 });
    expect(persistence.reserveStart(start)).toEqual({ status: 'reserved', revision: 2 });
    const detail = store.getRun('alice', run.run.runRef);
    expect(detail).toMatchObject({
      ok: true,
      value: { sessions: [{ state: 'running', version: 2 }] },
    });
    expect(JSON.stringify(detail)).not.toMatch(/brokerProfileId|brokerApprovedPrompt|brokerReceipts|brokerSteering/);
    expect(store.listEvents('alice', run.run.runRef)).toMatchObject({
      ok: true,
      value: [{ cursor: 1, kind: 'lifecycle', status: 'running', sessionRef: run.run.managerSessionRef }],
    });
    expect(() => createSubjectBrokerPersistence(store, 'bob').reserveStart(start)).toThrow(/not found/);
    expect(store.getRun('bob', run.run.runRef)).toMatchObject({ ok: false, reason: 'not-found' });
  });

  it('binds idempotency keys to exact content and keeps failed CAS receipts stable', () => {
    const store = createInMemoryControlPlaneStore(options());
    const run = createRun(store);
    const persistence = createSubjectBrokerPersistence(store, 'alice');
    const started = persistence.reserveStart({ spec: spec(run), idempotencyKey: 'start-1' });
    expect(started.status).toBe('reserved');
    expect(() => persistence.reserveStart({
      spec: { ...spec(run), approvedPrompt: 'Different approved prompt.' },
      idempotencyKey: 'start-1',
    })).toThrow(/idempotencyKey/);

    const stale = {
      runRef: run.run.runRef,
      sessionRef: run.run.managerSessionRef,
      instructionRef: 'instruction-stale',
      instruction: 'This must not become durable manager input.',
      checkpoint: null,
      expectedRevision: 1,
      idempotencyKey: 'steer-stale',
    };
    expect(enqueue(persistence, stale)).toEqual({ status: 'conflict', revision: 2 });
    expect(enqueue(persistence, stale)).toEqual({ status: 'conflict', revision: 2 });
    expect(store.listEvents('alice', run.run.runRef)).toMatchObject({ ok: true, value: [{ cursor: 1 }] });
  });
});

describe('durable checkpoint steering and lifecycle receipts', () => {
  it('consumes only global or matching checkpoint instructions and replays the exact receipt', () => {
    const store = createInMemoryControlPlaneStore(options());
    const run = createRun(store);
    const persistence = createSubjectBrokerPersistence(store, 'alice');
    const started = persistence.reserveStart({ spec: spec(run), idempotencyKey: 'start' });
    if (started.status !== 'reserved') throw new Error('expected reservation');

    expect(enqueue(persistence, {
      runRef: run.run.runRef, sessionRef: run.run.managerSessionRef,
      instructionRef: 'global', instruction: 'Apply at the next safe checkpoint.', checkpoint: null,
      expectedRevision: started.revision, idempotencyKey: 'steer-global',
    })).toEqual({ status: 'applied', revision: 3 });
    expect(enqueue(persistence, {
      runRef: run.run.runRef, sessionRef: run.run.managerSessionRef,
      instructionRef: 'global', instruction: 'Apply at the next safe checkpoint.', checkpoint: null,
      expectedRevision: 3, idempotencyKey: 'steer-global',
    })).toEqual({ status: 'duplicate', revision: 3 });
    expect(enqueue(persistence, {
      runRef: run.run.runRef, sessionRef: run.run.managerSessionRef,
      instructionRef: 'tests', instruction: 'Inspect the test output.', checkpoint: 'after-tests',
      expectedRevision: 3, idempotencyKey: 'steer-tests',
    })).toEqual({ status: 'applied', revision: 4 });
    expect(enqueue(persistence, {
      runRef: run.run.runRef, sessionRef: run.run.managerSessionRef,
      instructionRef: 'review', instruction: 'Summarize the review.', checkpoint: 'after-review',
      expectedRevision: 4, idempotencyKey: 'steer-review',
    })).toEqual({ status: 'applied', revision: 5 });

    const first = {
      runRef: run.run.runRef, sessionRef: run.run.managerSessionRef,
      checkpoint: 'after-tests', expectedRevision: 5, idempotencyKey: 'consume-tests',
    };
    expect(persistence.consumeSteering(first)).toEqual({
      status: 'applied', revision: 6,
      instructions: ['Apply at the next safe checkpoint.', 'Inspect the test output.'],
    });
    expect(persistence.consumeSteering({ ...first, expectedRevision: 6 })).toEqual({
      status: 'duplicate', revision: 6,
      instructions: ['Apply at the next safe checkpoint.', 'Inspect the test output.'],
    });
    expect(persistence.consumeSteering({
      runRef: run.run.runRef, sessionRef: run.run.managerSessionRef,
      checkpoint: 'after-review', expectedRevision: 6, idempotencyKey: 'consume-review',
    })).toEqual({ status: 'applied', revision: 7, instructions: ['Summarize the review.'] });
  });

  it('persists stop before completion and preserves conflict/inactive outcomes idempotently', () => {
    const store = createInMemoryControlPlaneStore(options());
    const run = createRun(store);
    const persistence = createSubjectBrokerPersistence(store, 'alice');
    const started = persistence.reserveStart({ spec: spec(run), idempotencyKey: 'start' });
    if (started.status !== 'reserved') throw new Error('expected reservation');
    const stop = {
      runRef: run.run.runRef, sessionRef: run.run.managerSessionRef,
      expectedRevision: started.revision, idempotencyKey: 'stop',
    };
    expect(persistence.requestStop(stop)).toEqual({ status: 'applied', revision: 3 });
    expect(persistence.requestStop({ ...stop, expectedRevision: 3 })).toEqual({ status: 'duplicate', revision: 3 });
    const staleComplete = {
      runRef: run.run.runRef, sessionRef: run.run.managerSessionRef,
      state: 'stopped' as const, detail: null, expectedRevision: 2, idempotencyKey: 'complete-stale',
    };
    expect(persistence.completeSession(staleComplete)).toEqual({ status: 'conflict', revision: 3 });
    expect(persistence.completeSession(staleComplete)).toEqual({ status: 'conflict', revision: 3 });
    expect(persistence.completeSession({ ...staleComplete, expectedRevision: 3, idempotencyKey: 'complete' }))
      .toEqual({ status: 'applied', revision: 4 });
    expect(persistence.completeSession({ ...staleComplete, expectedRevision: 4, idempotencyKey: 'after-terminal' }))
      .toEqual({ status: 'inactive', revision: 4 });
  });

  it('survives a file-store restart, normalizes ownership, then delivers queued steering after reservation recovery', () => {
    const root = mkdtempSync(join(tmpdir(), 'broker-store-'));
    roots.push(root);
    const clock = options();
    const first = createFileControlPlaneStore(root, clock);
    const run = createRun(first);
    const before = createSubjectBrokerPersistence(first, 'alice');
    const started = before.reserveStart({ spec: spec(run), idempotencyKey: 'start-before' });
    if (started.status !== 'reserved') throw new Error('expected reservation');
    expect(enqueue(before, {
      runRef: run.run.runRef, sessionRef: run.run.managerSessionRef,
      instructionRef: 'durable', instruction: 'Deliver after restart.', checkpoint: 'recovered',
      expectedRevision: started.revision, idempotencyKey: 'steer-before',
    })).toMatchObject({ status: 'applied', revision: 3 });

    const restarted = createFileControlPlaneStore(root, clock);
    expect(restarted.getRun('alice', run.run.runRef)).toMatchObject({
      ok: true, value: { sessions: [{ state: 'interrupted', version: 4 }] },
    });
    const after = createSubjectBrokerPersistence(restarted, 'alice');
    const recovered = after.reserveStart({ spec: spec(run), idempotencyKey: 'start-after' });
    expect(recovered).toEqual({ status: 'reserved', revision: 5 });
    expect(after.consumeSteering({
      runRef: run.run.runRef, sessionRef: run.run.managerSessionRef,
      checkpoint: 'recovered', expectedRevision: 5, idempotencyKey: 'consume-after',
    })).toEqual({ status: 'applied', revision: 6, instructions: ['Deliver after restart.'] });
  });

  it('fails atomically at the event bound without storing a phantom receipt', () => {
    const store = createInMemoryControlPlaneStore({ ...options(), maxEventsPerRun: 2 });
    const run = createRun(store);
    const persistence = createSubjectBrokerPersistence(store, 'alice');
    persistence.reserveStart({ spec: spec(run), idempotencyKey: 'start' });
    const event = {
      runRef: run.run.runRef, sessionRef: run.run.managerSessionRef,
      event: { kind: 'tool' as const, name: 'Read', status: 'succeeded' as const }, idempotencyKey: 'event-1',
    };
    persistence.appendEvent(event);
    expect(() => persistence.appendEvent({ ...event, idempotencyKey: 'event-2' })).toThrow(/event limit/);
    expect(store.listEvents('alice', run.run.runRef)).toMatchObject({ ok: true, value: [{ cursor: 1 }, { cursor: 2 }] });
    expect(() => persistence.appendEvent({ ...event, idempotencyKey: 'event-2' })).toThrow(/event limit/);
  });
});
