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
import type { JsonObject } from './types.ts';

const roots: string[] = [];
const SOURCE = { sourceComposerRef: 'composer-1', sourceTurnId: 'turn-1' } as const;
const MANAGER_ASSIGNMENT = {
  agentId: 'fyt-runner', declarationPath: 'agents/fyt-runner.md', declarationHash: 'a'.repeat(64),
  profileId: 'claude:manager', runtime: 'claude' as const, model: 'claude-sonnet-5',
};
const BUILD_ASSIGNMENT = {
  agentId: 'fyt-builder', declarationPath: 'agents/fyt-builder.md', declarationHash: 'b'.repeat(64),
  profileId: 'codex:worker', runtime: 'codex' as const, model: 'gpt-5.6-sol',
};
const VERIFY_ASSIGNMENT = {
  agentId: 'fyt-verifier', declarationPath: 'agents/fyt-verifier.md', declarationHash: 'c'.repeat(64),
  profileId: 'claude:worker', runtime: 'claude' as const, model: 'claude-sonnet-5',
};
const CHECKER_REVIEW = {
  subjectStageId: 'build', maxCreatorReworks: 1,
  criteria: [{ id: 'grounded', description: 'Citations are grounded in the source material.' }],
};
const CHECKER_COMPLETION_GATE = {
  id: 'approve-check', kind: 'approval' as const, prompt: 'Approve the checker result.', requiresReview: 'pass' as const,
};
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

function createApprovedProposal(
  store: ControlPlaneStore,
  subject = 'alice',
  snapshot: JsonObject = {
    schema: 'kb.plan-proposal/v1', title: 'Synthetic workflow', manager: {}, stages: [
      { id: 'build', title: 'Build', dependsOn: [] }, { id: 'verify', title: 'Verify', dependsOn: ['build'] },
    ],
  },
) {
  const created = store.createProposalRevision(subject, {
    ...SOURCE,
    title: 'Synthetic workflow',
    snapshot,
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

function createAssignedRun(
  store: ControlPlaneStore,
  subject = 'alice',
  assignments = {
    manager: structuredClone(MANAGER_ASSIGNMENT), build: structuredClone(BUILD_ASSIGNMENT), verify: structuredClone(VERIFY_ASSIGNMENT),
  },
) {
  const proposal = createApprovedProposal(store, subject, {
    schema: 'kb.plan-proposal/v1',
    manager: { assignment: assignments.manager },
    stages: [
      { id: 'build', title: 'Build', dependsOn: [], assignment: assignments.build },
      { id: 'verify', title: 'Verify', dependsOn: ['build'], assignment: assignments.verify },
    ],
  });
  const created = store.createRun(subject, {
    title: 'Assigned synthetic run', proposalRef: proposal.proposalRef, proposalRevision: proposal.revision,
    expectedProposalHash: proposal.hash, managerRuntime: assignments.manager.runtime, managerModel: assignments.manager.model,
    managerAssignment: assignments.manager, idempotencyKey: 'launch-assigned',
    stages: [
      { stageId: 'build', title: 'Build', dependsOn: [], assignment: assignments.build },
      { stageId: 'verify', title: 'Verify', dependsOn: ['build'], assignment: assignments.verify },
    ],
  });
  if (!created.ok) throw new Error(created.detail);
  return created.value;
}

function checkerSnapshot(): JsonObject {
  return {
    schema: 'kb.plan-proposal/v1', manager: {}, stages: [
      { id: 'build', title: 'Build', dependsOn: [] },
      {
        id: 'check', title: 'Check', dependsOn: ['build'], action: 'review:source-grounding', assignment: VERIFY_ASSIGNMENT,
        workflowProfile: 'checker-readonly', review: structuredClone(CHECKER_REVIEW), completionGate: structuredClone(CHECKER_COMPLETION_GATE),
      },
    ],
  };
}

function checkerStages() {
  return [
    { stageId: 'build', title: 'Build', dependsOn: [] },
    {
      stageId: 'check', title: 'Check', dependsOn: ['build'], assignment: structuredClone(VERIFY_ASSIGNMENT),
      workflowProfile: 'checker-readonly', review: structuredClone(CHECKER_REVIEW), completionGate: structuredClone(CHECKER_COMPLETION_GATE),
    },
  ];
}

function createCheckerRun(store: ControlPlaneStore, subject = 'alice') {
  const proposal = createApprovedProposal(store, subject, checkerSnapshot());
  const created = store.createRun(subject, {
    title: 'Checker synthetic run', proposalRef: proposal.proposalRef, proposalRevision: proposal.revision,
    expectedProposalHash: proposal.hash, managerRuntime: 'claude', managerModel: 'claude-sonnet-5',
    idempotencyKey: 'launch-checker', stages: checkerStages(),
  });
  if (!created.ok) throw new Error(created.detail);
  return created.value;
}

function settleRetryPredecessor(
  store: ControlPlaneStore,
  subject = 'alice',
  factory: (store: ControlPlaneStore, subject: string) => ReturnType<typeof createRun> = createRun,
) {
  const created = factory(store, subject);
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
    const proposal = createApprovedProposal(store, 'alice', { manager: {}, stages: [{ id: 'build', title: 'Build', dependsOn: [] }] });
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

  it('copies only the exact approved assignment snapshot into a run and its stages', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const inputAssignments = {
      manager: structuredClone(MANAGER_ASSIGNMENT), build: structuredClone(BUILD_ASSIGNMENT), verify: structuredClone(VERIFY_ASSIGNMENT),
    };
    const created = createAssignedRun(store, 'alice', inputAssignments);
    expect(created.run.managerAssignment).toEqual(MANAGER_ASSIGNMENT);
    expect(created.stages).toEqual(expect.arrayContaining([
      expect.objectContaining({ stageId: 'build', assignment: BUILD_ASSIGNMENT }),
      expect.objectContaining({ stageId: 'verify', assignment: VERIFY_ASSIGNMENT }),
    ]));
    const detail = store.getRun('alice', created.run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    expect(detail.value.run.managerAssignment).toEqual(MANAGER_ASSIGNMENT);
    expect(detail.value.stages.find((stage) => stage.stageId === 'build')?.assignment).toEqual(BUILD_ASSIGNMENT);
    inputAssignments.manager.model = 'mutated-after-create';
    inputAssignments.build.model = 'mutated-after-create';
    const afterMutation = store.getRun('alice', created.run.runRef);
    if (!afterMutation.ok) throw new Error(afterMutation.detail);
    expect(afterMutation.value.run.managerAssignment).toEqual(MANAGER_ASSIGNMENT);
    expect(afterMutation.value.stages.find((stage) => stage.stageId === 'build')?.assignment).toEqual(BUILD_ASSIGNMENT);
  });

  it('round-trips immutable checker contract provenance and binds it into launch replay', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const proposal = createApprovedProposal(store, 'alice', checkerSnapshot());
    const input = {
      title: 'Checker run', proposalRef: proposal.proposalRef, proposalRevision: proposal.revision,
      expectedProposalHash: proposal.hash, managerRuntime: 'claude', managerModel: 'claude-sonnet-5',
      idempotencyKey: 'checker-launch-once', stages: checkerStages(),
    };
    const first = store.createRun('alice', input);
    if (!first.ok) throw new Error(first.detail);
    const checker = first.value.stages.find((stage) => stage.stageId === 'check');
    expect(checker).toMatchObject({
      workflowProfile: 'checker-readonly', review: CHECKER_REVIEW, completionGate: CHECKER_COMPLETION_GATE,
    });
    const callerReview = input.stages[1]?.review;
    if (!callerReview) throw new Error('checker review missing');
    callerReview.criteria[0]!.description = 'Mutated caller value.';
    const afterMutation = store.getRun('alice', first.value.run.runRef);
    if (!afterMutation.ok) throw new Error(afterMutation.detail);
    expect(afterMutation.value.stages.find((stage) => stage.stageId === 'check')).toMatchObject({
      review: CHECKER_REVIEW, completionGate: CHECKER_COMPLETION_GATE,
    });
    const exactReplay = store.createRun('alice', {
      ...input,
      stages: checkerStages(),
    });
    expect(exactReplay).toMatchObject({ ok: true, replayed: true });
    expect(store.createRun('alice', {
      ...input,
      stages: [{ ...checkerStages()[0] }, {
        ...checkerStages()[1], completionGate: { ...CHECKER_COMPLETION_GATE, prompt: 'Different approval prompt.' },
      }],
    })).toMatchObject({ ok: false, reason: 'idempotency-conflict' });
  });

  it('rejects checker contract omission, substitution, injection, and malformed combinations', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const proposal = createApprovedProposal(store, 'alice', checkerSnapshot());
    const base = {
      title: 'Checker provenance', proposalRef: proposal.proposalRef, proposalRevision: proposal.revision,
      expectedProposalHash: proposal.hash, managerRuntime: 'claude', managerModel: 'claude-sonnet-5',
    };
    expect(store.createRun('alice', {
      ...base, idempotencyKey: 'checker-omitted', stages: [checkerStages()[0], { ...checkerStages()[1], review: null, completionGate: null, workflowProfile: null }],
    })).toMatchObject({ ok: false, reason: 'conflict' });
    expect(store.createRun('alice', {
      ...base, idempotencyKey: 'checker-substituted', stages: [checkerStages()[0], {
        ...checkerStages()[1], review: { ...CHECKER_REVIEW, maxCreatorReworks: 2 },
      }],
    })).toMatchObject({ ok: false, reason: 'conflict' });
    expect(store.createRun('alice', {
      ...base, idempotencyKey: 'checker-injected', stages: [checkerStages()[0], {
        ...checkerStages()[1], review: { ...CHECKER_REVIEW, extra: true } as never,
      }],
    })).toMatchObject({ ok: false, reason: 'invalid' });
    expect(store.createRun('alice', {
      ...base, idempotencyKey: 'checker-wrong-profile', stages: [checkerStages()[0], {
        ...checkerStages()[1], workflowProfile: 'writer-profile',
      }],
    })).toMatchObject({ ok: false, reason: 'invalid' });
    expect(store.createRun('alice', {
      ...base, idempotencyKey: 'checker-gate-without-review', stages: [checkerStages()[0], {
        ...checkerStages()[1], review: null,
      }],
    })).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('refuses tampered or malformed assignment provenance before a run is created', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const proposal = createApprovedProposal(store, 'alice', {
      manager: { assignment: MANAGER_ASSIGNMENT }, stages: [{ id: 'build', title: 'Build', dependsOn: [], assignment: BUILD_ASSIGNMENT }],
    });
    const input = {
      title: 'Tampered assignment', proposalRef: proposal.proposalRef, proposalRevision: proposal.revision,
      expectedProposalHash: proposal.hash, managerRuntime: MANAGER_ASSIGNMENT.runtime, managerModel: MANAGER_ASSIGNMENT.model,
      managerAssignment: { ...MANAGER_ASSIGNMENT }, idempotencyKey: 'tampered-assignment',
      stages: [{ stageId: 'build', title: 'Build', dependsOn: [], assignment: { ...BUILD_ASSIGNMENT } }],
    };
    expect(store.createRun('alice', {
      ...input,
      managerAssignment: { ...MANAGER_ASSIGNMENT, declarationHash: 'd'.repeat(64) },
    })).toMatchObject({ ok: false, reason: 'conflict' });
    expect(store.createRun('alice', {
      ...input,
      stages: [{ ...input.stages[0], assignment: { ...BUILD_ASSIGNMENT, profileId: 'codex:other' } }],
    })).toMatchObject({ ok: false, reason: 'conflict' });
    expect(store.createRun('alice', {
      ...input,
      managerAssignment: { ...MANAGER_ASSIGNMENT, extra: 'nope' } as never,
    })).toMatchObject({ ok: false, reason: 'invalid' });
    expect(store.createRun('alice', {
      ...input,
      stages: [{ ...input.stages[0], title: 'Renamed build' }],
    })).toMatchObject({ ok: false, reason: 'invalid' });
    expect(store.createRun('alice', {
      ...input,
      stages: [{ ...input.stages[0], canonicalCardRef: 'card-injected' }],
    })).toMatchObject({ ok: false, reason: 'invalid' });
    const dependencyProposal = createApprovedProposal(store, 'alice', {
      manager: {}, stages: [
        { id: 'build', title: 'Build', dependsOn: [] }, { id: 'verify', title: 'Verify', dependsOn: ['build'] },
      ],
    });
    expect(store.createRun('alice', {
      title: 'Tampered dependencies', proposalRef: dependencyProposal.proposalRef, proposalRevision: dependencyProposal.revision,
      expectedProposalHash: dependencyProposal.hash, managerRuntime: 'claude', managerModel: 'claude-sonnet-5',
      idempotencyKey: 'tampered-dependencies',
      stages: [
        { stageId: 'build', title: 'Build', dependsOn: [] }, { stageId: 'verify', title: 'Verify', dependsOn: [] },
      ],
    })).toMatchObject({ ok: false, reason: 'invalid' });
    const incomplete = createApprovedProposal(store, 'alice', { manager: {}, stages: [{ id: 'build', title: 'Build', dependsOn: [] }] });
    expect(store.createRun('alice', {
      title: 'Missing approved stage', proposalRef: incomplete.proposalRef, proposalRevision: incomplete.revision,
      expectedProposalHash: incomplete.hash, managerRuntime: 'claude', managerModel: 'claude-sonnet-5',
      idempotencyKey: 'missing-approved-stage',
      stages: [
        { stageId: 'build', title: 'Build', dependsOn: [] },
        { stageId: 'verify', title: 'Verify', dependsOn: ['build'] },
      ],
    })).toMatchObject({ ok: false, reason: 'invalid' });
    const excessive = createApprovedProposal(store, 'alice', {
      manager: {}, stages: [
        { id: 'build', title: 'Build', dependsOn: [] }, { id: 'verify', title: 'Verify', dependsOn: ['build'] },
        { id: 'unexpected', title: 'Unexpected', dependsOn: [] },
      ],
    });
    expect(store.createRun('alice', {
      title: 'Extra approved stage', proposalRef: excessive.proposalRef, proposalRevision: excessive.revision,
      expectedProposalHash: excessive.hash, managerRuntime: 'claude', managerModel: 'claude-sonnet-5',
      idempotencyKey: 'extra-approved-stage',
      stages: [
        { stageId: 'build', title: 'Build', dependsOn: [] },
        { stageId: 'verify', title: 'Verify', dependsOn: ['build'] },
      ],
    })).toMatchObject({ ok: false, reason: 'invalid' });
    expect(store.listRuns('alice')).toEqual([]);
  });

  it('keeps assignment provenance in Retry and binds it into idempotency', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const predecessor = settleRetryPredecessor(store, 'alice', createAssignedRun);
    const input = {
      title: 'Assigned Retry', proposalRef: predecessor.run.proposalRef, proposalRevision: predecessor.run.proposalRevision,
      expectedProposalHash: predecessor.run.proposalHash, managerRuntime: MANAGER_ASSIGNMENT.runtime, managerModel: MANAGER_ASSIGNMENT.model,
      managerAssignment: structuredClone(MANAGER_ASSIGNMENT), idempotencyKey: 'assigned-retry',
      predecessorRunRef: predecessor.run.runRef, expectedPredecessorVersion: predecessor.run.version,
      stages: [
        { stageId: 'build', title: 'Build', dependsOn: [], assignment: structuredClone(BUILD_ASSIGNMENT) },
        { stageId: 'verify', title: 'Verify', dependsOn: ['build'], assignment: structuredClone(VERIFY_ASSIGNMENT) },
      ],
    };
    const successor = store.createRun('alice', input);
    expect(successor).toMatchObject({ ok: true, value: { run: { managerAssignment: MANAGER_ASSIGNMENT } } });
    expect(store.createRun('alice', input)).toMatchObject({ ok: true, replayed: true });
    expect(store.createRun('alice', {
      ...input,
      stages: [{ ...input.stages[0], assignment: { ...BUILD_ASSIGNMENT, declarationHash: 'd'.repeat(64) } }, input.stages[1]],
    })).toMatchObject({ ok: false, reason: 'idempotency-conflict' });
  });

  it('preserves checker contract provenance in Retry successors', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const predecessor = settleRetryPredecessor(store, 'alice', createCheckerRun);
    const input = {
      title: 'Checker Retry', proposalRef: predecessor.run.proposalRef, proposalRevision: predecessor.run.proposalRevision,
      expectedProposalHash: predecessor.run.proposalHash, managerRuntime: 'claude', managerModel: 'claude-sonnet-5',
      idempotencyKey: 'checker-retry', predecessorRunRef: predecessor.run.runRef, expectedPredecessorVersion: predecessor.run.version,
      stages: checkerStages(),
    };
    const successor = store.createRun('alice', input);
    if (!successor.ok) throw new Error(successor.detail);
    expect(successor.value.stages.find((stage) => stage.stageId === 'check')).toMatchObject({
      workflowProfile: 'checker-readonly', review: CHECKER_REVIEW, completionGate: CHECKER_COMPLETION_GATE,
    });
    expect(store.createRun('alice', input)).toMatchObject({ ok: true, replayed: true });
    expect(store.createRun('alice', {
      ...input,
      stages: [checkerStages()[0], { ...checkerStages()[1], completionGate: { ...CHECKER_COMPLETION_GATE, prompt: 'Changed.' } }],
    })).toMatchObject({ ok: false, reason: 'idempotency-conflict' });
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

  it('refuses to reroute an assigned stage while leaving legacy unassigned stages reroutable', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const assigned = createAssignedRun(store);
    expect(store.rerouteStage('alice', assigned.stages[0].stageRef, {
      expectedStageVersion: assigned.stages[0].version, expectedAttemptRef: 'attempt-expected', expectedAttemptVersion: 1,
      runtime: 'claude', model: 'claude-sonnet-5', idempotencyKey: 'reroute-assigned',
    })).toMatchObject({ ok: false, reason: 'invalid', detail: expect.stringContaining('assignment provenance is immutable') });
  });

  it('creates attempts for an assigned stage only with its resolved routing', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const assigned = createAssignedRun(store);
    const stage = assigned.stages.find((candidate) => candidate.stageId === 'build');
    if (!stage) throw new Error('assigned build stage missing');
    expect(store.createAttempt('alice', stage.stageRef, {
      expectedStageVersion: stage.version, runtime: 'claude', model: 'claude-sonnet-5',
    })).toMatchObject({ ok: false, reason: 'invalid', detail: expect.stringContaining('assigned stage provenance') });
    const afterRefusal = store.getRun('alice', assigned.run.runRef);
    if (!afterRefusal.ok) throw new Error(afterRefusal.detail);
    expect(afterRefusal.value.stages.find((candidate) => candidate.stageRef === stage.stageRef)).toMatchObject({
      version: stage.version, currentAttemptRef: null,
    });
    expect(store.createAttempt('alice', stage.stageRef, {
      expectedStageVersion: stage.version, runtime: BUILD_ASSIGNMENT.runtime, model: BUILD_ASSIGNMENT.model,
    })).toMatchObject({ ok: true, value: { runtime: BUILD_ASSIGNMENT.runtime, model: BUILD_ASSIGNMENT.model } });
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

  it('allows an assigned Manager successor only on its resolved runtime and model', () => {
    const store = createInMemoryControlPlaneStore(deterministicOptions());
    const created = createAssignedRun(store);
    const manager = created.sessions.find((session) => session.sessionRef === created.run.managerSessionRef);
    if (!manager) throw new Error('manager missing');
    const interrupted = store.transitionSession('alice', manager.sessionRef, manager.version, 'interrupted');
    if (!interrupted.ok) throw new Error(interrupted.detail);
    expect(store.createManagerSuccessor('alice', created.run.runRef, {
      expectedManagerGeneration: 1, runtime: 'codex', model: 'gpt-5.6-sol', idempotencyKey: 'assigned-manager-wrong',
    })).toMatchObject({ ok: false, reason: 'invalid' });
    const input = {
      expectedManagerGeneration: 1, runtime: MANAGER_ASSIGNMENT.runtime, model: MANAGER_ASSIGNMENT.model,
      idempotencyKey: 'assigned-manager-right',
    };
    expect(store.createManagerSuccessor('alice', created.run.runRef, input)).toMatchObject({
      ok: true, value: { runtime: MANAGER_ASSIGNMENT.runtime, model: MANAGER_ASSIGNMENT.model, generation: 2 },
    });
    expect(store.createManagerSuccessor('alice', created.run.runRef, input)).toMatchObject({ ok: true, replayed: true });
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
  it('migrates legacy persisted runs and stages without assignment fields to null', () => {
    const root = mkdtempSync(join(tmpdir(), 'control-store-'));
    roots.push(root);
    const first = createFileControlPlaneStore(root, deterministicOptions());
    const created = createRun(first);
    const path = join(root, 'control', 'control-plane.json');
    const legacy = JSON.parse(readFileSync(path, 'utf8')) as { runs: Array<Record<string, unknown>>; stages: Array<Record<string, unknown>> };
    delete legacy.runs[0].managerAssignment;
    for (const stage of legacy.stages) delete stage.assignment;
    writeFileSync(path, `${JSON.stringify(legacy)}\n`, 'utf8');

    const restarted = createFileControlPlaneStore(root, deterministicOptions());
    const detail = restarted.getRun('alice', created.run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    expect(detail.value.run.managerAssignment).toBeNull();
    expect(detail.value.stages.every((stage) => stage.assignment === null)).toBe(true);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({
      runs: [{ managerAssignment: null }], stages: [{ assignment: null }, { assignment: null }],
    });
  });

  it('migrates missing checker contract fields in active and quarantined legacy stage rows to null', () => {
    const root = mkdtempSync(join(tmpdir(), 'control-store-'));
    roots.push(root);
    const first = createFileControlPlaneStore(root, deterministicOptions());
    createRun(first);
    const path = join(root, 'control', 'control-plane.json');
    const document = JSON.parse(readFileSync(path, 'utf8')) as {
      runs: Array<Record<string, unknown>>;
      stages: Array<Record<string, unknown>>;
      quarantine: Array<Record<string, unknown>>;
    };
    document.quarantine.push({
      subject: 'archived', quarantinedAt: '2026-07-18T12:00:00.000Z', run: structuredClone(document.runs[0]),
      stages: structuredClone(document.stages), attempts: [], sessions: [], humanRequests: [], events: [],
    });
    for (const stage of [...document.stages, ...(document.quarantine[0].stages as Array<Record<string, unknown>>)]) {
      delete stage.workflowProfile;
      delete stage.review;
      delete stage.completionGate;
    }
    writeFileSync(path, `${JSON.stringify(document)}\n`, 'utf8');

    createFileControlPlaneStore(root, deterministicOptions());
    const migrated = JSON.parse(readFileSync(path, 'utf8')) as {
      stages: Array<Record<string, unknown>>;
      quarantine: Array<{ stages: Array<Record<string, unknown>> }>;
    };
    for (const stage of [...migrated.stages, ...migrated.quarantine[0].stages]) {
      expect(stage).toMatchObject({ workflowProfile: null, review: null, completionGate: null });
    }
  });

  it('fails closed for malformed present checker contracts in active and quarantined persisted rows', () => {
    const check = (location: 'active' | 'quarantine') => {
      const root = mkdtempSync(join(tmpdir(), 'control-store-'));
      roots.push(root);
      const first = createFileControlPlaneStore(root, deterministicOptions());
      createRun(first);
      const path = join(root, 'control', 'control-plane.json');
      const document = JSON.parse(readFileSync(path, 'utf8')) as {
        runs: Array<Record<string, unknown>>;
        stages: Array<Record<string, unknown>>;
        quarantine: Array<Record<string, unknown>>;
      };
      if (location === 'quarantine') {
        document.quarantine.push({
          subject: 'archived', quarantinedAt: '2026-07-18T12:00:00.000Z', run: structuredClone(document.runs[0]),
          stages: structuredClone(document.stages), attempts: [], sessions: [], humanRequests: [], events: [],
        });
        (document.quarantine[0].stages as Array<Record<string, unknown>>)[0].review = { subjectStageId: 'build' };
      } else {
        document.stages[0].workflowProfile = { injected: true };
      }
      writeFileSync(path, `${JSON.stringify(document)}\n`, 'utf8');
      expect(() => createFileControlPlaneStore(root, deterministicOptions())).toThrow('invalid control-plane checker contract provenance');
    };
    check('active');
    check('quarantine');
  });

  it('fails closed when persisted assignment provenance is present but malformed', () => {
    const root = mkdtempSync(join(tmpdir(), 'control-store-'));
    roots.push(root);
    const first = createFileControlPlaneStore(root, deterministicOptions());
    createRun(first);
    const path = join(root, 'control', 'control-plane.json');
    const document = JSON.parse(readFileSync(path, 'utf8')) as { runs: Array<Record<string, unknown>>; stages: Array<Record<string, unknown>> };
    document.runs[0].managerAssignment = { agentId: 'fyt-runner' };
    document.stages[0].assignment = 'not-an-assignment';
    writeFileSync(path, `${JSON.stringify(document)}\n`, 'utf8');
    expect(() => createFileControlPlaneStore(root, deterministicOptions())).toThrow('invalid control-plane assignment provenance');
  });

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
