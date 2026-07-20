import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ControlStoreLimitError,
  createFileControlPlaneStore,
  createInMemoryControlPlaneStore,
  proposalSnapshotHash,
} from './store.ts';
import type { ControlPlaneStore } from './store.ts';

const roots: string[] = [];
const SOURCE = { sourceComposerRef: 'composer-1', sourceTurnId: 'turn-1' } as const;
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function deterministicOptions() {
  let id = 0;
  let second = 0;
  return {
    newId: () => String(++id),
    now: () => new Date(Date.UTC(2026, 6, 18, 12, 0, second++)),
  };
}

function createApprovedProposal(store: ControlPlaneStore, subject = 'alice') {
  const created = store.createProposalRevision(subject, {
    ...SOURCE,
    title: 'Synthetic workflow',
    snapshot: { schema: 'kb.plan-proposal/v1', title: 'Synthetic workflow', stages: [{ id: 'build' }] },
  });
  if (!created.ok) throw new Error(created.detail);
  const approved = store.decideProposal(subject, created.value.proposalRef, created.value.revision, {
    expectedHash: created.value.hash,
    expectedApprovalRevision: 0,
    decision: 'approved',
    idempotencyKey: 'approval-1',
  });
  if (!approved.ok) throw new Error(approved.detail);
  return approved.value;
}

function createRun(store: ControlPlaneStore, subject = 'alice') {
  const proposal = createApprovedProposal(store, subject);
  const created = store.createRun(subject, {
    title: 'Synthetic run',
    proposalRef: proposal.proposalRef,
    proposalRevision: proposal.revision,
    expectedProposalHash: proposal.hash,
    managerRuntime: 'claude',
    managerModel: 'claude-sonnet-5',
    idempotencyKey: 'launch-synthetic',
    stages: [
      { stageId: 'build', title: 'Build', dependsOn: [] },
      { stageId: 'verify', title: 'Verify', dependsOn: ['build'] },
    ],
  });
  if (!created.ok) throw new Error(created.detail);
  return created.value;
}

function settleRetryPredecessor(store: ControlPlaneStore, subject = 'alice') {
  const created = createRun(store, subject);
  for (const stage of created.stages) {
    const linked = store.linkStageCard(subject, stage.stageRef, stage.version, `card-${stage.stageId}`);
    if (!linked.ok) throw new Error(linked.detail);
    const stopped = store.transitionStage(subject, stage.stageRef, linked.value.version, 'stopped');
    if (!stopped.ok) throw new Error(stopped.detail);
  }
  const manager = created.sessions.find((session) => session.sessionRef === created.run.managerSessionRef);
  if (!manager) throw new Error('manager missing');
  const stoppedManager = store.transitionSession(subject, manager.sessionRef, manager.version, 'stopped');
  if (!stoppedManager.ok) throw new Error(stoppedManager.detail);
  const publishing = store.transitionPublication(subject, created.run.runRef, created.run.version, 'publishing');
  if (!publishing.ok) throw new Error(publishing.detail);
  const published = store.transitionPublication(subject, created.run.runRef, publishing.value.version, 'published');
  if (!published.ok) throw new Error(published.detail);
  const failed = store.transitionRun(subject, created.run.runRef, published.value.version, 'failed');
  if (!failed.ok) throw new Error(failed.detail);
  const detail = store.getRun(subject, created.run.runRef);
  if (!detail.ok) throw new Error(detail.detail);
  return detail.value;
}

describe('proposal revision persistence', () => {
  it('creates subject-bound immutable hash chains and metadata-only listings', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const first = store.createProposalRevision('alice', {
      ...SOURCE,
      title: 'First',
      snapshot: { z: 1, nested: { b: true, a: null }, a: ['x', 2] },
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.hash).toBe(proposalSnapshotHash({ a: ['x', 2], nested: { a: null, b: true }, z: 1 }));
    expect(store.getProposalRevision('bob', first.value.proposalRef, 1)).toMatchObject({ ok: false, reason: 'not-found' });

    const stale = store.createProposalRevision('alice', {
      ...SOURCE,
      proposalRef: first.value.proposalRef,
      expectedPreviousHash: '0'.repeat(64),
      title: 'Second',
      snapshot: { version: 2 },
    });
    expect(stale).toMatchObject({ ok: false, reason: 'conflict' });
    const second = store.createProposalRevision('alice', {
      ...SOURCE,
      proposalRef: first.value.proposalRef,
      expectedPreviousHash: first.value.hash,
      title: 'Second',
      snapshot: { version: 2 },
    });
    expect(second.ok && second.value).toMatchObject({ revision: 2, previousHash: first.value.hash, approval: null });

    const listed = store.listProposalRevisions('alice');
    expect(listed.map((item) => item.revision)).toEqual([2, 1]);
    expect(JSON.stringify(listed)).not.toContain('snapshot');
    expect(store.listProposalRevisions('bob')).toEqual([]);
  });

  it('refuses non-JSON, oversized, and recognizable credential-bearing snapshots', () => {
    const store = createInMemoryControlPlaneStore();
    expect(store.createProposalRevision('alice', {
      ...SOURCE,
      title: 'Secret',
      snapshot: { workOrder: 'api_key=sk-abcdefghijklmnopqrstuvwxyz' },
    })).toMatchObject({ ok: false, reason: 'invalid' });
    expect(store.createProposalRevision('alice', {
      ...SOURCE,
      title: 'Huge',
      snapshot: { text: 'x'.repeat(512 * 1024) },
    })).toMatchObject({ ok: false, reason: 'limit' });
    expect(store.createProposalRevision('alice', {
      ...SOURCE,
      title: 'Bad number',
      snapshot: { value: Number.NaN },
    })).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('binds a single idempotent decision to the exact hash and approval revision', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const proposal = store.createProposalRevision('alice', { ...SOURCE, title: 'Review me', snapshot: { safe: true } });
    if (!proposal.ok) throw new Error(proposal.detail);
    const request = {
      expectedHash: proposal.value.hash,
      expectedApprovalRevision: 0 as const,
      decision: 'approved' as const,
      idempotencyKey: 'approve-once',
      note: 'Reviewed',
    };
    expect(store.decideProposal('alice', proposal.value.proposalRef, 1, { ...request, expectedHash: '0'.repeat(64) })).toMatchObject({
      ok: false,
      reason: 'conflict',
    });
    expect(store.decideProposal('alice', proposal.value.proposalRef, 1, request)).toMatchObject({ ok: true });
    expect(store.decideProposal('alice', proposal.value.proposalRef, 1, request)).toMatchObject({ ok: true, replayed: true });
    expect(store.decideProposal('alice', proposal.value.proposalRef, 1, { ...request, decision: 'rejected' })).toMatchObject({
      ok: false,
      reason: 'idempotency-conflict',
    });
    expect(store.listProposalRevisions('alice')[0]?.approval).not.toHaveProperty('idempotencyKey');
  });

  it('filters provenance by subject and Composer ref, while a fork mints a fresh unapproved proposal', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const approved = createApprovedProposal(store);
    const fork = store.createProposalRevision('alice', {
      sourceComposerRef: 'composer-fork',
      sourceTurnId: 'turn-fork-1',
      title: 'Forked proposal',
      snapshot: approved.snapshot,
    });
    if (!fork.ok) throw new Error(fork.detail);
    expect(fork.value).toMatchObject({
      sourceComposerRef: 'composer-fork',
      sourceTurnId: 'turn-fork-1',
      approval: null,
      revision: 1,
    });
    expect(fork.value.proposalRef).not.toBe(approved.proposalRef);
    expect(store.listProposalRevisionsForComposer('alice', 'composer-fork')).toEqual([
      expect.objectContaining({ proposalRef: fork.value.proposalRef, sourceTurnId: 'turn-fork-1' }),
    ]);
    expect(store.listProposalRevisionsForComposer('alice', SOURCE.sourceComposerRef)).toHaveLength(1);
    expect(store.listProposalRevisionsForComposer('bob', 'composer-fork')).toEqual([]);
  });
});

describe('run graph, attempts, and managed sessions', () => {
  it('replays an identical launch key and refuses key reuse with changed content', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const proposal = createApprovedProposal(store);
    const input = {
      title: 'Idempotent run', proposalRef: proposal.proposalRef, proposalRevision: proposal.revision,
      expectedProposalHash: proposal.hash, managerRuntime: 'claude', managerModel: 'claude-sonnet-5',
      idempotencyKey: 'launch-once', stages: [{ stageId: 'build', title: 'Build', dependsOn: [] }],
    };
    const first = store.createRun('alice', input);
    const replay = store.createRun('alice', input);
    expect(first.ok && replay.ok && replay.value.run.runRef).toBe(first.ok ? first.value.run.runRef : '');
    expect(replay).toMatchObject({ ok: true, replayed: true });
    expect(store.createRun('alice', { ...input, title: 'Changed' })).toMatchObject({ ok: false, reason: 'idempotency-conflict' });
  });

  it('tracks canonical publication phases with run-version CAS', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const created = createRun(store);
    expect(created.run.publicationState).toBe('pending');
    const publishing = store.transitionPublication('alice', created.run.runRef, created.run.version, 'publishing');
    expect(publishing.ok && publishing.value).toMatchObject({ publicationState: 'publishing', version: 2 });
    expect(store.transitionPublication('alice', created.run.runRef, created.run.version, 'published')).toMatchObject({
      ok: false, reason: 'conflict',
    });
    if (!publishing.ok) return;
    const published = store.transitionPublication('alice', created.run.runRef, publishing.value.version, 'published');
    expect(published.ok && published.value).toMatchObject({ publicationState: 'published', version: 3 });
    if (!published.ok) return;
    expect(store.transitionPublication('alice', created.run.runRef, published.value.version, 'pending')).toMatchObject({
      ok: false, reason: 'invalid',
    });
  });

  it('creates a Retry successor only from a published, fully quiescent predecessor bundle', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const first = settleRetryPredecessor(store);
    const successor = store.createRun('alice', {
      title: 'Retry run', proposalRef: first.run.proposalRef, proposalRevision: first.run.proposalRevision,
      expectedProposalHash: first.run.proposalHash, managerRuntime: 'claude', managerModel: 'claude-sonnet-5',
      idempotencyKey: 'retry-run-1', predecessorRunRef: first.run.runRef, expectedPredecessorVersion: first.run.version,
      stages: first.stages.map((stage) => ({ stageId: stage.stageId, title: stage.title, dependsOn: stage.dependsOn })),
    });
    expect(successor.ok && successor.value.run).toMatchObject({ predecessorRunRef: first.run.runRef, state: 'planned' });
    expect(store.createRun('alice', {
      title: 'Bad retry', proposalRef: first.run.proposalRef, proposalRevision: first.run.proposalRevision,
      expectedProposalHash: first.run.proposalHash, managerRuntime: 'claude', managerModel: 'claude-sonnet-5',
      idempotencyKey: 'retry-run-stale', predecessorRunRef: first.run.runRef, expectedPredecessorVersion: first.run.version - 1,
      stages: first.stages.map((stage) => ({ stageId: stage.stageId, title: stage.title, dependsOn: stage.dependsOn })),
    })).toMatchObject({ ok: false, reason: 'conflict' });
  });

  it('treats fully quiescent interrupted descendants as settled for Retry', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const created = createRun(store);
    for (const initial of created.stages) {
      const linked = store.linkStageCard('alice', initial.stageRef, initial.version, `card-${initial.stageId}`);
      if (!linked.ok) throw new Error(linked.detail);
      const attempt = store.createAttempt('alice', initial.stageRef, {
        expectedStageVersion: linked.value.version, runtime: 'codex', model: 'fixed',
      });
      if (!attempt.ok) throw new Error(attempt.detail);
      const session = store.createWorkerSession('alice', attempt.value.attemptRef, { expectedAttemptVersion: attempt.value.version });
      if (!session.ok) throw new Error(session.detail);
      const interruptedAttempt = store.transitionAttempt('alice', attempt.value.attemptRef, attempt.value.version + 1, 'interrupted');
      if (!interruptedAttempt.ok) throw new Error(interruptedAttempt.detail);
      const interruptedSession = store.transitionSession('alice', session.value.sessionRef, session.value.version, 'interrupted');
      if (!interruptedSession.ok) throw new Error(interruptedSession.detail);
      const current = store.getRun('alice', created.run.runRef);
      if (!current.ok) throw new Error(current.detail);
      const stage = current.value.stages.find((candidate) => candidate.stageRef === initial.stageRef);
      if (!stage) throw new Error('stage missing');
      const interruptedStage = store.transitionStage('alice', stage.stageRef, stage.version, 'interrupted');
      if (!interruptedStage.ok) throw new Error(interruptedStage.detail);
    }
    const current = store.getRun('alice', created.run.runRef);
    if (!current.ok) throw new Error(current.detail);
    const manager = current.value.sessions.find((session) => session.sessionRef === current.value.run.managerSessionRef);
    if (!manager) throw new Error('manager missing');
    const interruptedManager = store.transitionSession('alice', manager.sessionRef, manager.version, 'interrupted');
    if (!interruptedManager.ok) throw new Error(interruptedManager.detail);
    const publishing = store.transitionPublication('alice', created.run.runRef, current.value.run.version, 'publishing');
    if (!publishing.ok) throw new Error(publishing.detail);
    const published = store.transitionPublication('alice', created.run.runRef, publishing.value.version, 'published');
    if (!published.ok) throw new Error(published.detail);
    const interruptedRun = store.transitionRun('alice', created.run.runRef, published.value.version, 'interrupted');
    if (!interruptedRun.ok) throw new Error(interruptedRun.detail);

    const successor = store.createRun('alice', {
      title: 'Retry interrupted run', proposalRef: created.run.proposalRef, proposalRevision: created.run.proposalRevision,
      expectedProposalHash: created.run.proposalHash, managerRuntime: 'claude', managerModel: 'claude-sonnet-5',
      idempotencyKey: 'retry-interrupted-run', predecessorRunRef: created.run.runRef,
      expectedPredecessorVersion: interruptedRun.value.version,
      stages: created.stages.map((stage) => ({ stageId: stage.stageId, title: stage.title, dependsOn: stage.dependsOn })),
    });

    expect(successor).toMatchObject({ ok: true, value: { run: { predecessorRunRef: created.run.runRef, state: 'planned' } } });
  });

  it('refuses Retry while publication, canonical work, sessions, or Human Requests remain unresolved', () => {
    const retry = (store: ControlPlaneStore, predecessor: ReturnType<typeof createRun>, idempotencyKey: string) => store.createRun('alice', {
      title: 'Unsafe retry', proposalRef: predecessor.run.proposalRef, proposalRevision: predecessor.run.proposalRevision,
      expectedProposalHash: predecessor.run.proposalHash, managerRuntime: 'claude', managerModel: 'claude-sonnet-5',
      idempotencyKey, predecessorRunRef: predecessor.run.runRef, expectedPredecessorVersion: predecessor.run.version,
      stages: predecessor.stages.map((stage) => ({ stageId: stage.stageId, title: stage.title, dependsOn: stage.dependsOn })),
    });

    const unpublishedStore = createInMemoryControlPlaneStore(deterministicOptions());
    const unpublished = createRun(unpublishedStore);
    const unpublishedFailed = unpublishedStore.transitionRun('alice', unpublished.run.runRef, unpublished.run.version, 'failed');
    if (!unpublishedFailed.ok) throw new Error(unpublishedFailed.detail);
    expect(retry(unpublishedStore, { ...unpublished, run: unpublishedFailed.value }, 'retry-unpublished')).toMatchObject({
      ok: false, reason: 'invalid', detail: expect.stringContaining('publication'),
    });

    const activeStore = createInMemoryControlPlaneStore(deterministicOptions());
    const active = createRun(activeStore);
    const activePublishing = activeStore.transitionPublication('alice', active.run.runRef, active.run.version, 'publishing');
    if (!activePublishing.ok) throw new Error(activePublishing.detail);
    const activePublished = activeStore.transitionPublication('alice', active.run.runRef, activePublishing.value.version, 'published');
    if (!activePublished.ok) throw new Error(activePublished.detail);
    const activeFailed = activeStore.transitionRun('alice', active.run.runRef, activePublished.value.version, 'failed');
    if (!activeFailed.ok) throw new Error(activeFailed.detail);
    expect(retry(activeStore, { ...active, run: activeFailed.value }, 'retry-active')).toMatchObject({
      ok: false, reason: 'invalid', detail: expect.stringMatching(/card|stage|session/),
    });

    const requestedStore = createInMemoryControlPlaneStore(deterministicOptions());
    const requested = settleRetryPredecessor(requestedStore);
    const request = requestedStore.createHumanRequest('alice', requested.run.runRef, {
      kind: 'intervention', title: 'Reconcile first', prompt: 'Canonical work still needs review.',
    });
    if (!request.ok) throw new Error(request.detail);
    const current = requestedStore.getRun('alice', requested.run.runRef);
    if (!current.ok) throw new Error(current.detail);
    expect(retry(requestedStore, current.value, 'retry-requested')).toMatchObject({
      ok: false, reason: 'invalid', detail: expect.stringContaining('Human Request'),
    });
  });

  it('commits manager commands with generation CAS and durable idempotency before signaling', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const created = createRun(store);
    const input = {
      expectedRunVersion: created.run.version,
      expectedManagerGeneration: created.run.managerGeneration,
      idempotencyKey: 'manager-message-1',
      kind: 'message' as const,
      message: 'Continue at the next safe checkpoint.',
    };
    const first = store.recordManagerCommand('alice', created.run.runRef, input);
    expect(first.ok && first.value.event).toMatchObject({ kind: 'message', source: 'human', summary: input.message });
    expect(store.recordManagerCommand('alice', created.run.runRef, input)).toMatchObject({ ok: true, replayed: true });
    expect(store.recordManagerCommand('alice', created.run.runRef, { ...input, message: 'Different' })).toMatchObject({
      ok: false, reason: 'idempotency-conflict',
    });
    expect(store.recordManagerCommand('alice', created.run.runRef, {
      ...input, idempotencyKey: 'manager-stale', expectedManagerGeneration: 2,
    })).toMatchObject({ ok: false, reason: 'conflict' });
  });

  it('creates a run only from an exact approved revision and keeps listings metadata-only', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const unapproved = store.createProposalRevision('alice', { ...SOURCE, title: 'Pending', snapshot: { stages: [] } });
    if (!unapproved.ok) throw new Error(unapproved.detail);
    expect(store.createRun('alice', {
      title: 'No', proposalRef: unapproved.value.proposalRef, proposalRevision: 1,
      expectedProposalHash: unapproved.value.hash, managerRuntime: 'claude', managerModel: 'fixed',
      idempotencyKey: 'launch-unapproved',
      stages: [{ stageId: 'one', title: 'One', dependsOn: [] }],
    })).toMatchObject({ ok: false, reason: 'not-approved' });

    const created = createRun(store);
    expect(created.run).toMatchObject({ state: 'planned', managerGeneration: 1, proposalHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(created.stages.map((stage) => stage.state)).toEqual(['ready', 'blocked']);
    const linked = store.linkStageCard('alice', created.stages[0].stageRef, created.stages[0].version, 'card-build');
    expect(linked.ok && linked.value).toMatchObject({ canonicalCardRef: 'card-build', version: 2 });
    expect(store.linkStageCard('alice', created.stages[0].stageRef, created.stages[0].version, 'card-other')).toMatchObject({
      ok: false, reason: 'conflict',
    });
    expect(created.sessions).toHaveLength(1);
    expect(created.sessions[0]).toMatchObject({ role: 'manager', generation: 1, state: 'pending' });
    expect(store.getRun('bob', created.run.runRef)).toMatchObject({ ok: false, reason: 'not-found' });
    const listed = store.listRuns('alice');
    expect(listed[0]).toMatchObject({ stageCount: 2, sessionCount: 1, eventCount: 0 });
    expect(JSON.stringify(listed)).not.toContain('stages');
  });

  it('uses versions for lifecycle CAS and successor attempts instead of mutating terminal attempts', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const run = createRun(store);
    const stage = run.stages[0];
    expect(store.transitionStage('alice', stage.stageRef, 99, 'running')).toMatchObject({ ok: false, reason: 'conflict' });
    const runningStage = store.transitionStage('alice', stage.stageRef, 1, 'running');
    if (!runningStage.ok) throw new Error(runningStage.detail);
    const first = store.createAttempt('alice', stage.stageRef, {
      expectedStageVersion: runningStage.value.version,
      runtime: 'codex',
      model: 'gpt-5.6-sol',
    });
    if (!first.ok) throw new Error(first.detail);
    const worker = store.createWorkerSession('alice', first.value.attemptRef, { expectedAttemptVersion: first.value.version });
    expect(worker.ok && worker.value).toMatchObject({ role: 'worker', runtime: 'codex', model: 'gpt-5.6-sol' });
    const afterWorker = store.getRun('alice', run.run.runRef);
    if (!afterWorker.ok) throw new Error(afterWorker.detail);
    const attached = afterWorker.value.attempts[0];
    const failed = store.transitionAttempt('alice', attached.attemptRef, attached.version, 'failed');
    if (!failed.ok) throw new Error(failed.detail);
    expect(store.transitionAttempt('alice', failed.value.attemptRef, failed.value.version, 'running')).toMatchObject({ ok: false, reason: 'invalid' });
    const latestStage = store.getRun('alice', run.run.runRef);
    if (!latestStage.ok) throw new Error(latestStage.detail);
    const successor = store.createAttempt('alice', stage.stageRef, {
      expectedStageVersion: latestStage.value.stages[0].version,
      runtime: 'codex', model: 'gpt-5.6-sol',
    });
    expect(successor.ok && successor.value).toMatchObject({ generation: 2, predecessorAttemptRef: first.value.attemptRef });
  });

  it('atomically reroutes a never-started attempt and settles its superseded lineage', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const created = createRun(store);
    const stage = created.stages[0];
    const linked = store.linkStageCard('alice', stage.stageRef, stage.version, 'card-build');
    if (!linked.ok) throw new Error(linked.detail);
    const publishing = store.transitionPublication('alice', created.run.runRef, created.run.version, 'publishing');
    if (!publishing.ok) throw new Error(publishing.detail);
    const published = store.transitionPublication('alice', created.run.runRef, publishing.value.version, 'published');
    if (!published.ok) throw new Error(published.detail);
    const original = store.createAttempt('alice', stage.stageRef, {
      expectedStageVersion: linked.value.version,
      runtime: 'codex',
      model: 'gpt-5.6-sol',
    });
    if (!original.ok) throw new Error(original.detail);
    const originalSession = store.createWorkerSession('alice', original.value.attemptRef, {
      expectedAttemptVersion: original.value.version,
    });
    if (!originalSession.ok) throw new Error(originalSession.detail);
    const before = store.getRun('alice', created.run.runRef);
    if (!before.ok) throw new Error(before.detail);
    const currentStage = before.value.stages.find((item) => item.stageRef === stage.stageRef);
    const currentAttempt = before.value.attempts.find((item) => item.attemptRef === original.value.attemptRef);
    if (!currentStage || !currentAttempt) throw new Error('reroute source missing');
    const input = {
      expectedStageVersion: currentStage.version,
      expectedAttemptRef: currentAttempt.attemptRef,
      expectedAttemptVersion: currentAttempt.version,
      runtime: 'claude',
      model: 'claude-sonnet-5',
      idempotencyKey: 'reroute-build-1',
    };
    const rerouted = store.rerouteStage('alice', stage.stageRef, input);
    expect(rerouted).toMatchObject({
      ok: true,
      value: {
        stage: { currentAttemptRef: expect.any(String) },
        attempt: {
          generation: 2,
          predecessorAttemptRef: original.value.attemptRef,
          runtime: 'claude',
          model: 'claude-sonnet-5',
          state: 'queued',
        },
        session: {
          predecessorSessionRef: originalSession.value.sessionRef,
          runtime: 'claude',
          model: 'claude-sonnet-5',
          state: 'pending',
        },
      },
    });
    const after = store.getRun('alice', created.run.runRef);
    if (!after.ok) throw new Error(after.detail);
    expect(after.value.attempts.find((item) => item.attemptRef === original.value.attemptRef)).toMatchObject({
      runtime: 'codex', model: 'gpt-5.6-sol', state: 'stopped', version: 3,
    });
    expect(after.value.sessions.find((item) => item.sessionRef === originalSession.value.sessionRef)).toMatchObject({
      runtime: 'codex', model: 'gpt-5.6-sol', state: 'stopped', version: 2,
    });
    expect(store.rerouteStage('alice', stage.stageRef, input)).toMatchObject({ ok: true, replayed: true });
    expect(store.rerouteStage('alice', stage.stageRef, { ...input, model: 'claude-opus-4-8' })).toMatchObject({
      ok: false, reason: 'idempotency-conflict',
    });
  });

  it('rejects lifecycle edge skips, unmet dependencies, and premature run success', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const created = createRun(store);
    const root = created.stages.find((stage) => stage.stageId === 'build');
    const dependent = created.stages.find((stage) => stage.stageId === 'verify');
    if (!root || !dependent) throw new Error('stages missing');
    expect(store.transitionPublication('alice', created.run.runRef, created.run.version, 'published')).toMatchObject({
      ok: false, reason: 'invalid', detail: expect.stringContaining('pending->published'),
    });
    expect(store.transitionStage('alice', dependent.stageRef, dependent.version, 'running')).toMatchObject({
      ok: false, reason: 'invalid', detail: expect.stringContaining('blocked->running'),
    });
    const attempt = store.createAttempt('alice', root.stageRef, { expectedStageVersion: root.version, runtime: 'codex', model: 'fixed' });
    if (!attempt.ok) throw new Error(attempt.detail);
    expect(store.transitionAttempt('alice', attempt.value.attemptRef, attempt.value.version, 'running')).toMatchObject({
      ok: false, reason: 'invalid', detail: expect.stringContaining('queued->running'),
    });
    const worker = store.createWorkerSession('alice', attempt.value.attemptRef, { expectedAttemptVersion: attempt.value.version });
    if (!worker.ok) throw new Error(worker.detail);
    expect(store.transitionSession('alice', worker.value.sessionRef, worker.value.version, 'running')).toMatchObject({
      ok: false, reason: 'invalid', detail: expect.stringContaining('pending->running'),
    });
    const running = store.transitionRun('alice', created.run.runRef, created.run.version, 'running');
    if (!running.ok) throw new Error(running.detail);
    expect(store.transitionRun('alice', created.run.runRef, running.value.version, 'succeeded')).toMatchObject({
      ok: false, reason: 'invalid', detail: expect.stringContaining('descendant'),
    });
  });

  it('does not release waiting-human stage or run boundaries until the exact response is accepted', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const created = createRun(store);
    const stage = created.stages[0];
    const request = store.createHumanRequest('alice', created.run.runRef, {
      stageRef: stage.stageRef, kind: 'approval', title: 'Approve stage', prompt: 'Approve exact stage scope.',
    });
    if (!request.ok) throw new Error(request.detail);
    const stageWaiting = store.transitionStage('alice', stage.stageRef, stage.version, 'waiting-human');
    if (!stageWaiting.ok) throw new Error(stageWaiting.detail);
    const runWaiting = store.transitionRun('alice', created.run.runRef, created.run.version, 'waiting-human');
    if (!runWaiting.ok) throw new Error(runWaiting.detail);
    expect(store.transitionStage('alice', stage.stageRef, stageWaiting.value.version, 'ready')).toMatchObject({
      ok: false, reason: 'invalid', detail: expect.stringContaining('unresolved'),
    });
    expect(store.transitionRun('alice', created.run.runRef, runWaiting.value.version, 'running')).toMatchObject({
      ok: false, reason: 'invalid', detail: expect.stringContaining('unresolved'),
    });
    const rejected = store.respondHumanRequest('alice', request.value.requestRef, {
      expectedRevision: request.value.revision, decision: 'rejected', idempotencyKey: 'reject-stage',
    });
    if (!rejected.ok) throw new Error(rejected.detail);
    expect(store.transitionStage('alice', stage.stageRef, stageWaiting.value.version, 'ready')).toMatchObject({ ok: false, reason: 'invalid' });
    expect(store.transitionRun('alice', created.run.runRef, runWaiting.value.version, 'running')).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('persists run-wide cancellation intent before signaling and replays it exactly', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const created = createRun(store);
    const input = {
      expectedRunVersion: created.run.version,
      idempotencyKey: 'cancel-run-1',
      reason: 'Operator requested stop.',
    };
    const requested = store.requestRunCancellation('alice', created.run.runRef, input);
    expect(requested).toMatchObject({
      ok: true,
      value: { run: { state: 'stopping' }, event: { kind: 'lifecycle', source: 'human', status: 'waiting' } },
    });
    if (!requested.ok) throw new Error(requested.detail);
    expect(store.requestRunCancellation('alice', created.run.runRef, {
      ...input, expectedRunVersion: requested.value.run.version,
    })).toMatchObject({ ok: true, replayed: true });
    expect(store.requestRunCancellation('alice', created.run.runRef, {
      ...input, expectedRunVersion: requested.value.run.version, reason: 'Different reason.',
    })).toMatchObject({ ok: false, reason: 'idempotency-conflict' });
  });

  it('applies exact canonical reconciliation atomically without widening general lifecycle edges', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const created = createRun(store);
    for (const stage of created.stages) {
      const linked = store.linkStageCard('alice', stage.stageRef, stage.version, `card-${stage.stageId}`);
      if (!linked.ok) throw new Error(linked.detail);
      const attempt = store.createAttempt('alice', stage.stageRef, {
        expectedStageVersion: linked.value.version, runtime: 'codex', model: 'fixed',
      });
      if (!attempt.ok) throw new Error(attempt.detail);
      const session = store.createWorkerSession('alice', attempt.value.attemptRef, { expectedAttemptVersion: attempt.value.version });
      if (!session.ok) throw new Error(session.detail);
    }
    let detail = store.getRun('alice', created.run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    const reconcileRequired = store.transitionPublication('alice', created.run.runRef, detail.value.run.version, 'reconcile-required');
    if (!reconcileRequired.ok) throw new Error(reconcileRequired.detail);
    detail = store.getRun('alice', created.run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    const projections = detail.value.stages.map((stage) => {
      const attempt = detail.ok && detail.value.attempts.find((candidate) => candidate.attemptRef === stage.currentAttemptRef);
      const session = detail.ok && detail.value.sessions.find((candidate) => candidate.sessionRef === attempt?.managedSessionRef);
      if (!attempt || !session || !stage.canonicalCardRef) throw new Error('projection chain missing');
      return {
        stageRef: stage.stageRef,
        expectedStageVersion: stage.version,
        canonicalCardRef: stage.canonicalCardRef,
        state: 'succeeded' as const,
        attemptRef: attempt.attemptRef,
        expectedAttemptVersion: attempt.version,
        attemptState: 'succeeded' as const,
        sessionRef: session.sessionRef,
        expectedSessionVersion: session.version,
        sessionState: 'completed' as const,
      };
    });
    expect(store.reconcileCanonicalProjection('alice', created.run.runRef, {
      expectedRunVersion: reconcileRequired.value.version,
      expectedProposalHash: created.run.proposalHash,
      stages: projections.map((projection, index) => index === 0 ? { ...projection, sessionState: 'running' as const } : projection),
    })).toMatchObject({ ok: false, reason: 'invalid', detail: expect.stringContaining('tuple') });
    const reconciled = store.reconcileCanonicalProjection('alice', created.run.runRef, {
      expectedRunVersion: reconcileRequired.value.version,
      expectedProposalHash: created.run.proposalHash,
      stages: projections,
    });
    expect(reconciled).toMatchObject({
      ok: true,
      value: {
        run: { state: 'succeeded', publicationState: 'published' },
        stages: [{ state: 'succeeded' }, { state: 'succeeded' }],
        attempts: [{ state: 'succeeded' }, { state: 'succeeded' }],
      },
    });
    if (!reconciled.ok) throw new Error(reconciled.detail);
    expect(reconciled.value.sessions.every((session) => session.state === 'completed' || session.state === 'stopped')).toBe(true);
  });

  it('creates an idempotent generation-linked Manager successor only after the current head stops', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const created = createRun(store);
    const manager = created.sessions[0];
    expect(store.createManagerSuccessor('alice', created.run.runRef, {
      expectedManagerGeneration: 1, runtime: 'claude', model: 'next', idempotencyKey: 'recover-1',
    })).toMatchObject({ ok: false, reason: 'conflict' });
    const interrupted = store.transitionSession('alice', manager.sessionRef, manager.version, 'interrupted');
    if (!interrupted.ok) throw new Error(interrupted.detail);
    const input = { expectedManagerGeneration: 1, runtime: 'claude', model: 'next', idempotencyKey: 'recover-1' };
    const successor = store.createManagerSuccessor('alice', created.run.runRef, input);
    expect(successor.ok && successor.value).toMatchObject({ generation: 2, predecessorSessionRef: manager.sessionRef, state: 'pending' });
    expect(store.createManagerSuccessor('alice', created.run.runRef, input)).toMatchObject({ ok: true, replayed: true });
    expect(store.createManagerSuccessor('alice', created.run.runRef, { ...input, model: 'different' })).toMatchObject({
      ok: false, reason: 'idempotency-conflict',
    });
    expect(store.getRun('alice', created.run.runRef)).toMatchObject({
      ok: true,
      value: { run: { state: 'recovering', managerGeneration: 2, managerSessionRef: successor.ok ? successor.value.sessionRef : '' } },
    });
  });
});

describe('Human Requests and operational events', () => {
  it('revises open requests and commits one revision-bound idempotent response', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const run = createRun(store);
    const request = store.createHumanRequest('alice', run.run.runRef, {
      stageRef: run.stages[0].stageRef,
      kind: 'approval',
      title: 'Approve checkpoint',
      prompt: 'Review the diff',
    });
    if (!request.ok) throw new Error(request.detail);
    const revised = store.reviseHumanRequest('alice', request.value.requestRef, 1, 'Approve revised checkpoint', 'Review revision two');
    if (!revised.ok) throw new Error(revised.detail);
    expect(store.respondHumanRequest('alice', request.value.requestRef, {
      expectedRevision: 1, decision: 'approved', idempotencyKey: 'response-1',
    })).toMatchObject({ ok: false, reason: 'conflict' });
    const response = { expectedRevision: 2, decision: 'approved' as const, idempotencyKey: 'response-1', response: 'Looks good' };
    expect(store.respondHumanRequest('alice', request.value.requestRef, response)).toMatchObject({ ok: true, value: { state: 'resolved' } });
    expect(store.respondHumanRequest('alice', request.value.requestRef, response)).toMatchObject({ ok: true, replayed: true });
    expect(store.respondHumanRequest('alice', request.value.requestRef, { ...response, response: 'Different' })).toMatchObject({
      ok: false, reason: 'idempotency-conflict',
    });
    expect(store.reviseHumanRequest('alice', request.value.requestRef, 2, 'Again', 'No')).toMatchObject({ ok: false, reason: 'conflict' });
  });

  it('appends sanitized allowlisted events under globally monotonic cursors and replays by cursor', () => {
    const store = createInMemoryControlPlaneStore({ ...deterministicOptions(), maxEventsPerRun: 2 });
    const alice = createRun(store, 'alice');
    const bob = createRun(store, 'bob');
    const first = store.appendEvent('alice', alice.run.runRef, {
      kind: 'command', source: 'worker', stageRef: alice.stages[0].stageRef,
      command: 'deploy --api_key=sk-abcdefghijklmnopqrstuvwxyz', summary: 'started', status: 'running',
    });
    const other = store.appendEvent('bob', bob.run.runRef, { kind: 'lifecycle', source: 'system', summary: 'bob event' });
    const second = store.appendEvent('alice', alice.run.runRef, { kind: 'tool', source: 'manager', toolName: 'Read', status: 'success' });
    expect(first.ok && first.value.cursor).toBe(1);
    expect(other.ok && other.value.cursor).toBe(2);
    expect(second.ok && second.value.cursor).toBe(3);
    expect(first.ok && first.value.command).toContain('[redacted]');
    expect(store.listEvents('alice', alice.run.runRef, 1, 10)).toMatchObject({ ok: true, value: [{ cursor: 3 }] });
    expect(store.listEvents('bob', alice.run.runRef)).toMatchObject({ ok: false, reason: 'not-found' });
    expect(store.appendEvent('alice', alice.run.runRef, { kind: 'message', source: 'manager', summary: 'too many' })).toMatchObject({
      ok: false, reason: 'limit',
    });
  });
});

describe('durability, crash recovery, and retention', () => {
  it('atomically persists, then normalizes active crash residue once on restart', () => {
    const root = mkdtempSync(join(tmpdir(), 'control-store-'));
    roots.push(root);
    const clock = deterministicOptions();
    const first = createFileControlPlaneStore(root, clock);
    const created = createRun(first);
    const runRunning = first.transitionRun('alice', created.run.runRef, created.run.version, 'running');
    if (!runRunning.ok) throw new Error(runRunning.detail);
    const stageRunning = first.transitionStage('alice', created.stages[0].stageRef, created.stages[0].version, 'running');
    if (!stageRunning.ok) throw new Error(stageRunning.detail);
    const attempt = first.createAttempt('alice', stageRunning.value.stageRef, {
      expectedStageVersion: stageRunning.value.version, runtime: 'codex', model: 'fixed',
    });
    if (!attempt.ok) throw new Error(attempt.detail);
    const worker = first.createWorkerSession('alice', attempt.value.attemptRef, { expectedAttemptVersion: attempt.value.version });
    if (!worker.ok) throw new Error(worker.detail);
    const afterWorker = first.getRun('alice', created.run.runRef);
    if (!afterWorker.ok) throw new Error(afterWorker.detail);
    const currentAttempt = afterWorker.value.attempts.find((candidate) => candidate.attemptRef === attempt.value.attemptRef);
    if (!currentAttempt) throw new Error('attempt disappeared');
    const attemptStarting = first.transitionAttempt('alice', currentAttempt.attemptRef, currentAttempt.version, 'starting');
    if (!attemptStarting.ok) throw new Error(attemptStarting.detail);
    const attemptRunning = first.transitionAttempt('alice', attemptStarting.value.attemptRef, attemptStarting.value.version, 'running');
    if (!attemptRunning.ok) throw new Error(attemptRunning.detail);
    const workerStarting = first.transitionSession('alice', worker.value.sessionRef, worker.value.version, 'starting');
    if (!workerStarting.ok) throw new Error(workerStarting.detail);
    const workerRunning = first.transitionSession('alice', workerStarting.value.sessionRef, workerStarting.value.version, 'running');
    if (!workerRunning.ok) throw new Error(workerRunning.detail);
    const managerStarting = first.transitionSession('alice', created.sessions[0].sessionRef, created.sessions[0].version, 'starting');
    if (!managerStarting.ok) throw new Error(managerStarting.detail);
    const managerRunning = first.transitionSession('alice', managerStarting.value.sessionRef, managerStarting.value.version, 'running');
    if (!managerRunning.ok) throw new Error(managerRunning.detail);

    const path = join(root, 'control', 'control-plane.json');
    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ version: 1, nextEventCursor: 1 });
    expect(readdirSync(join(root, 'control')).filter((name) => name.endsWith('.tmp'))).toEqual([]);

    const restarted = createFileControlPlaneStore(root, clock);
    const recovered = restarted.getRun('alice', created.run.runRef);
    if (!recovered.ok) throw new Error(recovered.detail);
    expect(recovered.value.run.state).toBe('interrupted');
    expect(recovered.value.stages[0].state).toBe('interrupted');
    expect(recovered.value.attempts[0].state).toBe('interrupted');
    expect(recovered.value.sessions.map((session) => session.state)).toEqual(['interrupted', 'interrupted']);
    expect(restarted.listEvents('alice', created.run.runRef)).toMatchObject({
      ok: true,
      value: [{ cursor: 1, kind: 'lifecycle', status: 'interrupted' }],
    });
    createFileControlPlaneStore(root, clock);
    expect(restarted.listEvents('alice', created.run.runRef)).toMatchObject({ ok: true, value: [{ cursor: 1 }] });
  });

  it('requires an unchanged dry-run plan, quarantines without purging, and restores all records', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const created = createRun(store);
    store.appendEvent('alice', created.run.runRef, { kind: 'checkpoint', source: 'manager', checkpoint: 'safe boundary' });
    const runningPlan = store.dryRunQuarantine('alice', [created.run.runRef]);
    expect(runningPlan.ok && runningPlan.value.items[0].eligible).toBe(false);
    if (!runningPlan.ok) return;
    expect(store.quarantineRuns('alice', [created.run.runRef], runningPlan.value.planHash)).toMatchObject({ ok: false, reason: 'ineligible' });

    const interrupted = store.transitionRun('alice', created.run.runRef, created.run.version, 'interrupted');
    if (!interrupted.ok) throw new Error(interrupted.detail);
    for (const stage of created.stages) {
      const stopped = store.transitionStage('alice', stage.stageRef, stage.version, 'stopped');
      if (!stopped.ok) throw new Error(stopped.detail);
    }
    const managerStopped = store.transitionSession('alice', created.sessions[0].sessionRef, created.sessions[0].version, 'stopped');
    if (!managerStopped.ok) throw new Error(managerStopped.detail);
    const plan = store.dryRunQuarantine('alice', [created.run.runRef]);
    if (!plan.ok) throw new Error(plan.detail);
    expect(plan.value.items[0]).toMatchObject({ eligible: true, eventCount: 1, quarantinedAt: null });
    expect(store.quarantineRuns('alice', [created.run.runRef], runningPlan.value.planHash)).toMatchObject({ ok: false, reason: 'conflict' });
    expect(store.quarantineRuns('alice', [created.run.runRef], plan.value.planHash)).toMatchObject({ ok: true });
    expect(store.listRuns('alice')).toEqual([]);
    expect(store.inventory('alice')).toMatchObject({ activeRuns: [], quarantinedRuns: [{ runRef: created.run.runRef, eventCount: 1 }] });
    expect(store.getRun('alice', created.run.runRef)).toMatchObject({ ok: false, reason: 'not-found' });

    const restored = store.restoreRun('alice', created.run.runRef);
    expect(restored).toMatchObject({ ok: true, value: { stageCount: 2, sessionCount: 1, eventCount: 2 } });
    expect(store.listEvents('alice', created.run.runRef)).toMatchObject({
      ok: true,
      value: [{ cursor: 1, kind: 'checkpoint' }, { cursor: 2, summary: 'run restored from quarantine' }],
    });
    expect(store.inventory('alice').quarantinedRuns).toEqual([]);
  });

  it('requires every descendant to be settled and every Human Request to be resolved', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const created = createRun(store);
    const attempt = store.createAttempt('alice', created.stages[0].stageRef, { expectedStageVersion: 1, runtime: 'codex', model: 'fixed' });
    if (!attempt.ok) throw new Error(attempt.detail);
    const worker = store.createWorkerSession('alice', attempt.value.attemptRef, { expectedAttemptVersion: attempt.value.version });
    if (!worker.ok) throw new Error(worker.detail);
    const request = store.createHumanRequest('alice', created.run.runRef, {
      kind: 'review', title: 'Final review', prompt: 'Confirm retention is safe.',
    });
    if (!request.ok) throw new Error(request.detail);
    const stoppedRun = store.transitionRun('alice', created.run.runRef, created.run.version, 'stopped');
    if (!stoppedRun.ok) throw new Error(stoppedRun.detail);
    expect(store.dryRunQuarantine('alice', [created.run.runRef])).toMatchObject({
      ok: true, value: { items: [{ eligible: false }] },
    });

    const current = store.getRun('alice', created.run.runRef);
    if (!current.ok) throw new Error(current.detail);
    for (const stage of current.value.stages) {
      const stopped = store.transitionStage('alice', stage.stageRef, stage.version, 'stopped');
      if (!stopped.ok) throw new Error(stopped.detail);
    }
    for (const candidate of current.value.attempts) {
      const stopped = store.transitionAttempt('alice', candidate.attemptRef, candidate.version, 'stopped');
      if (!stopped.ok) throw new Error(stopped.detail);
    }
    for (const session of current.value.sessions) {
      if (session.sessionRef === worker.value.sessionRef) continue;
      const stopped = store.transitionSession('alice', session.sessionRef, session.version, 'stopped');
      if (!stopped.ok) throw new Error(stopped.detail);
    }
    const workerCurrent = store.getRun('alice', created.run.runRef);
    if (!workerCurrent.ok) throw new Error(workerCurrent.detail);
    const currentWorker = workerCurrent.value.sessions.find((session) => session.sessionRef === worker.value.sessionRef);
    if (!currentWorker) throw new Error('worker disappeared');

    expect(store.dryRunQuarantine('alice', [created.run.runRef])).toMatchObject({
      ok: true, value: { items: [{ eligible: false }] },
    });
    const workerStopped = store.transitionSession('alice', currentWorker.sessionRef, currentWorker.version, 'stopped');
    if (!workerStopped.ok) throw new Error(workerStopped.detail);
    expect(store.dryRunQuarantine('alice', [created.run.runRef])).toMatchObject({
      ok: true, value: { items: [{ eligible: false }] },
    });

    const responded = store.respondHumanRequest('alice', request.value.requestRef, {
      expectedRevision: request.value.revision,
      decision: 'approved',
      idempotencyKey: 'retention-review-approved',
    });
    if (!responded.ok) throw new Error(responded.detail);
    expect(store.dryRunQuarantine('alice', [created.run.runRef])).toMatchObject({
      ok: true, value: { items: [{ eligible: true }] },
    });
  });

  it('invalidates a dry-run when same-size bundle content changes without changing inventory counts', () => {
    const root = mkdtempSync(join(tmpdir(), 'control-store-retention-'));
    roots.push(root);
    const store = createFileControlPlaneStore(root, deterministicOptions());
    const created = createRun(store);
    store.appendEvent('alice', created.run.runRef, { kind: 'checkpoint', source: 'manager', checkpoint: 'alpha' });
    for (const stage of created.stages) {
      const stopped = store.transitionStage('alice', stage.stageRef, stage.version, 'stopped');
      if (!stopped.ok) throw new Error(stopped.detail);
    }
    const managerStopped = store.transitionSession('alice', created.sessions[0].sessionRef, created.sessions[0].version, 'stopped');
    if (!managerStopped.ok) throw new Error(managerStopped.detail);
    const runStopped = store.transitionRun('alice', created.run.runRef, created.run.version, 'stopped');
    if (!runStopped.ok) throw new Error(runStopped.detail);
    const plan = store.dryRunQuarantine('alice', [created.run.runRef]);
    if (!plan.ok) throw new Error(plan.detail);
    expect(plan.value.items[0]).toMatchObject({ eligible: true, eventCount: 1 });

    const path = join(root, 'control', 'control-plane.json');
    const document = JSON.parse(readFileSync(path, 'utf8')) as { events: Array<{ checkpoint: string }> };
    document.events[0].checkpoint = 'bravo';
    writeFileSync(path, `${JSON.stringify(document)}\n`, 'utf8');
    const fresh = store.dryRunQuarantine('alice', [created.run.runRef]);
    if (!fresh.ok) throw new Error(fresh.detail);
    expect(fresh.value.items[0]).toMatchObject({ eligible: true, eventCount: 1, estimatedBytes: plan.value.items[0].estimatedBytes });
    expect(fresh.value.planHash).not.toBe(plan.value.planHash);
    expect(store.quarantineRuns('alice', [created.run.runRef], plan.value.planHash)).toMatchObject({ ok: false, reason: 'conflict' });
  });

  it('enforces a hard document byte ceiling before replacing durable state', () => {
    const store = createInMemoryControlPlaneStore({ ...deterministicOptions(), maxDocumentBytes: 200 });
    expect(() => createApprovedProposal(store)).toThrow(ControlStoreLimitError);
  });
});
