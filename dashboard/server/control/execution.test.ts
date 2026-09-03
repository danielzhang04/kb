import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryControlPlaneStore, type ControlPlaneStore } from './store.ts';
import { createExistingRootFileStoreHarnessForTest } from './test-fixtures/controlStore.ts';
import type { JsonObject } from './types.ts';
import type { PlanProposal, ProposalIterationGroup, ProposalStage } from './proposal.ts';
import { ARTIFACT_PRODUCING_REQUEST_KINDS, proposalContentHash } from './proposal.ts';
import type { PolicyEnvironment } from './policy.ts';
import {
  AutomaticExecutionEngine,
  AutomaticExecutionError,
  canonicalStageResultHash,
  planRunWorktreePath,
  type AccountingAdapter,
  type AutomaticExecutionOptions,
  type ExecutionBudget,
  type ExecutionCancellationController,
  type ExecutionUsage,
  type ManagerAdapter,
  type ResultIntegrator,
  type WorkerAdapter,
  type WorkerExecutionResult,
  type WorktreeAdapter,
} from './execution.ts';

const policy: PolicyEnvironment = {
  profiles: [
    { id: 'manager-claude', role: 'manager', runtime: 'claude', model: 'claude-opus', capabilities: ['read', 'emit-events'] },
    {
      id: 'worker-codex', role: 'worker', runtime: 'codex', model: 'codex-safe',
      capabilities: ['read', 'write-approved-scope', 'run-approved-commands', 'emit-events'],
    },
    {
      id: 'worker-claude', role: 'worker', runtime: 'claude', model: 'claude-sonnet',
      capabilities: ['read', 'write-approved-scope', 'run-approved-commands', 'emit-events'],
    },
  ],
  curatedSkills: new Set(['tests']),
  contractText: 'queues-for-me',
  governanceContents: {
    'CLAUDE.md': 'constitution',
    'governance/agent-rules.md': 'rules',
    'governance/risk-tiers.md': 'risk tiers',
    'orgs/kb-ops/contract.md': 'contract',
  },
};

function stage(id: string, dependsOn: string[] = []): ProposalStage {
  return {
    id,
    title: `Stage ${id}`,
    action: `test:${id}`,
    target: 'dashboard/server',
    workOrder: `Execute ${id}.`,
    riskTier: 'T2',
    dependsOn,
    worker: { runtime: 'codex', model: 'codex-safe' },
    requiredSkills: ['tests'],
    scope: { read: ['dashboard'], write: ['dashboard/server'] },
    artifacts: [{ id: `${id}-result`, path: `dashboard/server/${id}.txt`, description: `${id} output` }],
    checkpoints: [{ id: `${id}-checked`, label: `${id} verified` }],
    humanGates: [],
  };
}

function proposal(stages: ProposalStage[]): PlanProposal {
  return {
    schema: 'kb.plan-proposal/v1',
    proposalId: 'synthetic',
    project: 'kb-ops',
    title: 'Synthetic automatic run',
    summary: 'Low risk execution-engine acceptance.',
    manager: { runtime: 'claude', model: 'claude-opus', requiredSkills: [] },
    scope: { read: ['dashboard'], write: ['dashboard'] },
    governanceRefs: ['CLAUDE.md', 'governance/agent-rules.md', 'governance/risk-tiers.md', 'orgs/kb-ops/contract.md'],
    stages,
  };
}

let sequence = 0;
function createStore(): ControlPlaneStore {
  return createInMemoryControlPlaneStore({ newId: () => `id-${++sequence}` });
}

function createApprovedRun(store: ControlPlaneStore, plan: PlanProposal): { runRef: string; proposalRef: string } {
  const createdProposal = store.createProposalRevision('operator', {
    sourceComposerRef: 'composer-1',
    sourceTurnId: 'turn-1',
    title: plan.title,
    snapshot: plan as unknown as JsonObject,
  });
  expect(createdProposal.ok).toBe(true);
  if (!createdProposal.ok) throw new Error(createdProposal.detail);
  const approved = store.decideProposal('operator', createdProposal.value.proposalRef, 1, {
    expectedHash: createdProposal.value.hash,
    expectedApprovalRevision: 0,
    decision: 'approved',
    idempotencyKey: 'approve-1',
  });
  expect(approved.ok).toBe(true);
  const run = store.createRun('operator', {
      owner: { type: 'agent', id: 'grader', sourcePath: 'agents/grader.md' },
      executionHost: 'desktop',
    title: plan.title,
    proposalRef: createdProposal.value.proposalRef,
    proposalRevision: 1,
    expectedProposalHash: createdProposal.value.hash,
    managerRuntime: plan.manager.runtime,
    managerModel: plan.manager.model,
    managerAssignment: plan.manager.assignment,
    idempotencyKey: `launch-${createdProposal.value.proposalRef}`,
    iterationGroups: plan.iterationGroups,
    stages: plan.stages.map((item) => ({
      stageId: item.id,
      title: item.title,
      dependsOn: item.dependsOn,
      assignment: item.assignment,
      workflowProfile: item.workflowProfile,
      review: item.review,
      completionGate: item.completionGate,
    })),
  });
  expect(run.ok).toBe(true);
  if (!run.ok) throw new Error(run.detail);
  for (const item of run.value.stages) {
    const linked = store.linkStageCard('operator', item.stageRef, item.version, `card-${item.stageId}`);
    expect(linked.ok).toBe(true);
  }
  expect(run.value.run.proposalHash).toBe(proposalContentHash(plan));
  return { runRef: run.value.run.runRef, proposalRef: createdProposal.value.proposalRef };
}

interface Fakes {
  worktrees: WorktreeAdapter;
  managers: ManagerAdapter;
  accounting: AccountingAdapter;
  workers: FakeWorker;
  results: ResultIntegrator;
  cancellation: ExecutionCancellationController;
  executionOrder: string[];
  integrationOrder: string[];
  worktreePaths: string[];
  removedPaths: string[];
  reservations: string[];
  settlements: string[];
  reservationLimits: ExecutionBudget[];
}

/**
 * The engine now drives a two-phase `WorkerAdapter.begin` ([C-S5]); these fakes keep the one-shot
 * `execute` shape and `workerAdapter` lifts it into a launch whose receipt resolves before the result,
 * so every pre-existing case still exercises the same worker behaviour through the new port shape.
 */
export type WorkerExecuteInput = Parameters<WorkerAdapter['begin']>[0];
interface FakeWorker { execute(input: WorkerExecuteInput): Promise<WorkerExecutionResult> }
function workerAdapter(worker: FakeWorker): WorkerAdapter {
  return {
    begin(input) {
      const receipt = Promise.resolve({
        ok: true as const,
        value: {
          operationKey: input.operationKey, sessionId: `session-${input.attemptRef}`,
          attemptRef: input.attemptRef, revision: 1, boundAt: new Date(0).toISOString(), replayed: false,
        },
      });
      return { receipt, result: receipt.then(() => worker.execute(input)) };
    },
  };
}

function fakes(overrides: { worker?: FakeWorker; accounting?: AccountingAdapter } = {}): Fakes {
  const executionOrder: string[] = [];
  const integrationOrder: string[] = [];
  const worktreePaths: string[] = [];
  const removedPaths: string[] = [];
  const reservations: string[] = [];
  const settlements: string[] = [];
  const reservationLimits: ExecutionBudget[] = [];
  const settled = new Set<string>();
  const worktrees: WorktreeAdapter = {
    async ensure(input) { worktreePaths.push(input.path); },
    async inspect() {
      const id = executionOrder.at(-1) as string;
      return { changed: [{ path: `dashboard/server/${id}.txt`, digest: 'b'.repeat(64) }] };
    },
    async remove(input) { removedPaths.push(input.path); },
  };
  const managers: ManagerAdapter = { async ensure() {} };
  const accounting: AccountingAdapter = overrides.accounting ?? {
    async reserve(input) {
      reservations.push(input.operationKey);
      reservationLimits.push(input.limits);
      return { ok: true, value: { reservationRef: `reservation:${input.attemptRef}`, replayed: false } };
    },
    async settle(input) { settled.add(input.operationKey); settlements.push(input.operationKey); },
  };
  const workers: FakeWorker = overrides.worker ?? {
    async execute(input) {
      executionOrder.push(input.action.split(':')[1]);
      return {
        state: 'succeeded',
        summary: `${input.action} passed`,
        usage: { inputTokens: 10, outputTokens: 5, costUsdMicros: 100 },
        artifacts: [{ path: `${input.target}/${input.action.split(':')[1]}.txt`, digest: 'b'.repeat(64) }],
        checkpoints: [`${input.action.split(':')[1]}-checked`],
      };
    },
  };
  const results: ResultIntegrator = {
    async lookup() { return null; },
    async resolveBase() { return 'd'.repeat(40); },
    async integrate(input) {
      integrationOrder.push(input.stageId);
      return { status: 'integrated', resultHash: input.resultHash, durability: 'inactive' as const };
    },
  };
  const cancellation: ExecutionCancellationController = {
    async cancelManager() {},
    async cancelWorker() {},
  };
  return { worktrees, managers, accounting, workers, results, cancellation, executionOrder, integrationOrder,
    worktreePaths, removedPaths, reservations, settlements, reservationLimits };
}

interface LedgerRecord {
  reservationRef: string;
  limits: ExecutionBudget;
  state: 'active' | 'settled';
  usage: ExecutionUsage | null;
}

/**
 * Faithful in-memory stand-in for the file accounting adapter's arithmetic (see adapters.ts): an active
 * reservation holds its FULL limit against the window and occupies a concurrency slot until it settles,
 * and a settlement whose usage exceeds its own reservation's limits is refused exactly as `withinBudget`
 * refuses it — writing nothing, leaving the reservation active.
 */
function windowAccounting(window: ExecutionBudget, maxConcurrency = 1): { adapter: AccountingAdapter; records: LedgerRecord[] } {
  const records: LedgerRecord[] = [];
  const held = (record: LedgerRecord): ExecutionUsage => (record.state === 'settled' && record.usage
    ? record.usage
    : {
      inputTokens: record.limits.maxInputTokens,
      outputTokens: record.limits.maxOutputTokens,
      costUsdMicros: record.limits.maxCostUsdMicros,
    });
  const adapter: AccountingAdapter = {
    async reserve(input) {
      if (records.filter((item) => item.state === 'active').length >= maxConcurrency) {
        return { ok: false, reason: 'global concurrency limit reached' };
      }
      const projected = records.reduce((sum, record) => {
        const usage = held(record);
        return {
          inputTokens: sum.inputTokens + usage.inputTokens,
          outputTokens: sum.outputTokens + usage.outputTokens,
          costUsdMicros: sum.costUsdMicros + usage.costUsdMicros,
        };
      }, {
        inputTokens: input.limits.maxInputTokens,
        outputTokens: input.limits.maxOutputTokens,
        costUsdMicros: input.limits.maxCostUsdMicros,
      });
      if (projected.inputTokens > window.maxInputTokens
        || projected.outputTokens > window.maxOutputTokens
        || projected.costUsdMicros > window.maxCostUsdMicros) {
        return { ok: false, reason: 'global token or cost budget exhausted' };
      }
      const reservationRef = `reservation:${input.attemptRef}`;
      records.push({ reservationRef, limits: input.limits, state: 'active', usage: null });
      return { ok: true, value: { reservationRef, replayed: false } };
    },
    async settle(input) {
      const record = records.find((item) => item.reservationRef === input.reservationRef);
      if (!record) throw new Error('accounting reservation was not found');
      if (record.state === 'settled') return;
      if (input.usage.inputTokens > record.limits.maxInputTokens
        || input.usage.outputTokens > record.limits.maxOutputTokens
        || input.usage.costUsdMicros > record.limits.maxCostUsdMicros) {
        throw new Error('settlement exceeds its reserved limits');
      }
      record.state = 'settled';
      record.usage = input.usage;
    },
  };
  return { adapter, records };
}

// Per-suite worktree root. A fixed `tmpdir()/kb-auto-worktrees` was shared with the store/launch
// suites, so concurrent workers raced each other's directories under full-gate load.
const SUITE_WORKTREE_ROOT = mkdtempSync(join(tmpdir(), 'kb-auto-worktrees-execution-'));
// Removed once the suite ends: a per-run mkdtemp root with no cleanup leaks one temp tree per run.
afterAll(() => { rmSync(SUITE_WORKTREE_ROOT, { recursive: true, force: true }); });

function engineOptions(store: ControlPlaneStore, fake: Fakes, root = SUITE_WORKTREE_ROOT): AutomaticExecutionOptions {
  return {
    store,
    policy,
    worktreeRoot: root,
    maxConcurrency: 2,
    budget: { maxAttempts: 3, maxInputTokens: 1_000, maxOutputTokens: 1_000, maxCostUsdMicros: 10_000 },
    // Deliberately distinct from the window budget above so a reservation can only match one of them.
    attemptBudget: { maxAttempts: 1, maxInputTokens: 400, maxOutputTokens: 400, maxCostUsdMicros: 4_000 },
    worktrees: fake.worktrees,
    managers: fake.managers,
    workers: workerAdapter(fake.workers),
    skills: {
      async resolve(input) { return { ok: true, skills: [...input.requested] }; },
    },
    accounting: fake.accounting,
    results: fake.results,
    cancellation: fake.cancellation,
  };
}





function genericIterationGroup(maxCycles = 2): ProposalIterationGroup {
  return {
    iterationGroupId: 'draft-loop', goal: 'Produce an accepted draft.',
    participants: [
      { participantId: 'producer', stageRef: 'producer', role: 'contributor', perspective: 'Own the draft.', mandate: 'Produce and revise the draft.' },
      { participantId: 'judge', stageRef: 'judge', role: 'judge', perspective: 'Apply quality.', mandate: 'Pass only a complete draft.' },
    ],
    routes: [
      { routeId: 'to-judge', senderParticipantId: 'producer', recipientParticipantId: 'judge', requestKinds: ['review'], baseResolutionStageIds: ['producer'] },
      { routeId: 'to-producer', senderParticipantId: 'judge', recipientParticipantId: 'producer', requestKinds: ['rework'], baseResolutionStageIds: ['judge'] },
    ],
    activation: { seedParticipantId: 'producer', seedArtifactIds: ['draft'] }, initialStepId: 'review',
    schedule: [
      { stepId: 'review', routeId: 'to-judge', after: { stepId: 'rework', participantId: 'producer', verdict: 'fulfilled' }, cycle: 'next' },
      { stepId: 'rework', routeId: 'to-producer', after: { stepId: 'review', participantId: 'judge', verdict: 'fail' }, cycle: 'current' },
    ],
    artifacts: ['draft'], criteria: [{ id: 'quality', description: 'The draft is complete.' }],
    maxCycles, cycleUnit: 'One producer generation followed by one judge verdict.',
    terminalAuthorities: [{ participantId: 'judge', verdict: 'pass' }],
  };
}

function genericIterationPlan(maxCycles = 2): PlanProposal {
  const producer = stage('producer');
  producer.artifacts = [{ id: 'draft', path: 'dashboard/server/producer.txt', description: 'Draft.' }];
  const judge = stage('judge', ['producer']);
  judge.artifacts = []; judge.checkpoints = []; judge.scope = { read: ['dashboard'], write: [] };
  const release = stage('release', ['producer']);
  return { ...proposal([producer, judge, release]), iterationGroups: [genericIterationGroup(maxCycles)] };
}

function fanInIterationPlan(): PlanProposal {
  const producer = stage('producer');
  producer.artifacts = [{ id: 'draft', path: 'dashboard/server/producer.txt', description: 'Draft.' }];
  const peer = stage('peer', ['producer']);
  peer.artifacts = [{ id: 'peer-draft', path: 'dashboard/server/peer.txt', description: 'Peer contribution.' }];
  peer.checkpoints = [];
  const judge = stage('judge', ['producer']); judge.artifacts = []; judge.checkpoints = []; judge.scope = { read: ['dashboard'], write: [] };
  const release = stage('release', ['producer']);
  const group: ProposalIterationGroup = {
    iterationGroupId: 'fan-in-loop', goal: 'Accept the current producer and peer generations.',
    participants: [
      { participantId: 'producer', stageRef: 'producer', role: 'contributor', perspective: 'Own the draft.', mandate: 'Produce the draft.' },
      { participantId: 'peer', stageRef: 'peer', role: 'contributor', perspective: 'Challenge the draft.', mandate: 'Produce a current peer position.' },
      { participantId: 'judge', stageRef: 'judge', role: 'judge', perspective: 'Apply quality.', mandate: 'Judge every current peer.' },
    ],
    routes: [
      { routeId: 'to-peer', senderParticipantId: 'producer', recipientParticipantId: 'peer', requestKinds: ['delegate'], baseResolutionStageIds: ['producer'] },
      { routeId: 'peer-to-judge', senderParticipantId: 'peer', recipientParticipantId: 'judge', requestKinds: ['review'], baseResolutionStageIds: ['producer', 'peer'] },
      { routeId: 'to-producer', senderParticipantId: 'judge', recipientParticipantId: 'producer', requestKinds: ['rework'], baseResolutionStageIds: ['judge'] },
      { routeId: 'producer-to-judge', senderParticipantId: 'producer', recipientParticipantId: 'judge', requestKinds: ['review'], baseResolutionStageIds: ['producer', 'peer'] },
    ],
    activation: { seedParticipantId: 'producer', seedArtifactIds: ['draft'] }, initialStepId: 'peer-turn',
    schedule: [
      { stepId: 'peer-turn', routeId: 'to-peer', cycle: 'current' },
      { stepId: 'judge-a', routeId: 'peer-to-judge', after: { stepId: 'peer-turn', participantId: 'peer', verdict: 'fulfilled' }, cycle: 'current' },
      { stepId: 'producer-rework-a', routeId: 'to-producer', after: { stepId: 'judge-a', participantId: 'judge', verdict: 'fail' }, cycle: 'current' },
      { stepId: 'judge-b', routeId: 'producer-to-judge', after: { stepId: 'producer-rework-a', participantId: 'producer', verdict: 'fulfilled' }, cycle: 'next' },
      { stepId: 'producer-rework-b', routeId: 'to-producer', after: { stepId: 'judge-b', participantId: 'judge', verdict: 'fail' }, cycle: 'current' },
    ],
    artifacts: ['draft'], criteria: [{ id: 'quality', description: 'Every current contribution is complete.' }],
    maxCycles: 3, cycleUnit: 'One producer revision after peer review.', terminalAuthorities: [{ participantId: 'judge', verdict: 'pass' }],
  };
  return { ...proposal([producer, peer, judge, release]), iterationGroups: [group] };
}

function siblingIterationPlan(): PlanProposal {
  const iterationGroup = (prefix: 'a' | 'b'): ProposalIterationGroup => ({
    iterationGroupId: `${prefix}-loop`, goal: `Accept ${prefix} draft.`,
    participants: [
      { participantId: `${prefix}-producer`, stageRef: `${prefix}-producer`, role: 'contributor', perspective: 'Own the draft.', mandate: 'Produce the draft.' },
      { participantId: `${prefix}-judge`, stageRef: `${prefix}-judge`, role: 'judge', perspective: 'Apply quality.', mandate: 'Judge the draft.' },
    ],
    routes: [{
      routeId: `${prefix}-to-judge`, senderParticipantId: `${prefix}-producer`, recipientParticipantId: `${prefix}-judge`,
      requestKinds: ['review'], baseResolutionStageIds: [`${prefix}-producer`],
    }, {
      routeId: `${prefix}-to-producer`, senderParticipantId: `${prefix}-judge`, recipientParticipantId: `${prefix}-producer`,
      requestKinds: ['rework'], baseResolutionStageIds: [`${prefix}-judge`],
    }],
    activation: { seedParticipantId: `${prefix}-producer`, seedArtifactIds: [`${prefix}-draft`] },
    initialStepId: `${prefix}-review`,
    schedule: [{
      stepId: `${prefix}-review`, routeId: `${prefix}-to-judge`,
      after: { stepId: `${prefix}-rework`, participantId: `${prefix}-producer`, verdict: 'fulfilled' }, cycle: 'next',
    }, {
      stepId: `${prefix}-rework`, routeId: `${prefix}-to-producer`,
      after: { stepId: `${prefix}-review`, participantId: `${prefix}-judge`, verdict: 'fail' }, cycle: 'current',
    }],
    artifacts: [`${prefix}-draft`], criteria: [{ id: 'quality', description: 'The draft is complete.' }],
    maxCycles: prefix === 'a' ? 1 : 2, cycleUnit: 'One producer generation and judge verdict.',
    terminalAuthorities: [{ participantId: `${prefix}-judge`, verdict: 'pass' }],
  });
  const aProducer = stage('a-producer');
  aProducer.artifacts = [{ id: 'a-draft', path: 'dashboard/server/a-producer.txt', description: 'A draft.' }];
  const aJudge = stage('a-judge', ['a-producer']); aJudge.artifacts = []; aJudge.checkpoints = [];
  const bProducer = stage('b-producer');
  bProducer.artifacts = [{ id: 'b-draft', path: 'dashboard/server/b-producer.txt', description: 'B draft.' }];
  const bJudge = stage('b-judge', ['b-producer']); bJudge.artifacts = []; bJudge.checkpoints = [];
  const release = stage('release', ['a-producer', 'b-producer']);
  return {
    ...proposal([aProducer, aJudge, bProducer, bJudge, release]),
    maxConcurrency: 2,
    iterationGroups: [iterationGroup('a'), iterationGroup('b')],
  };
}

function coordinatorCrewIterationPlan(): PlanProposal {
  const coordinator = stage('coordinator');
  coordinator.artifacts = [{ id: 'draft', path: 'dashboard/server/coordinator.txt', description: 'Crew draft.' }];
  const specialist = stage('specialist', ['coordinator']);
  const release = stage('release', ['coordinator']);
  const group: ProposalIterationGroup = {
    iterationGroupId: 'crew-loop', goal: 'Complete the bounded specialist assignment.',
    participants: [
      { participantId: 'coordinator', stageRef: 'coordinator', role: 'coordinator', perspective: 'Own the goal.', mandate: 'Route and assess specialist work.' },
      { participantId: 'specialist', stageRef: 'specialist', role: 'contributor', perspective: 'Execute the bounded task.', mandate: 'Respond to delegate rework and check requests.' },
    ],
    routes: [
      { routeId: 'delegate-specialist', senderParticipantId: 'coordinator', recipientParticipantId: 'specialist', requestKinds: ['delegate'], baseResolutionStageIds: ['coordinator'] },
      { routeId: 'review-coordinator', senderParticipantId: 'specialist', recipientParticipantId: 'coordinator', requestKinds: ['review'], baseResolutionStageIds: ['specialist'] },
      { routeId: 'rework-specialist', senderParticipantId: 'coordinator', recipientParticipantId: 'specialist', requestKinds: ['rework'], baseResolutionStageIds: ['coordinator'] },
      { routeId: 'check-specialist', senderParticipantId: 'coordinator', recipientParticipantId: 'specialist', requestKinds: ['check'], baseResolutionStageIds: ['coordinator'] },
    ],
    activation: { seedParticipantId: 'coordinator', seedArtifactIds: ['draft'] }, initialStepId: 'delegate',
    schedule: [
      { stepId: 'delegate', routeId: 'delegate-specialist', cycle: 'current' },
      { stepId: 'coordinate', routeId: 'review-coordinator', after: { stepId: 'delegate', participantId: 'specialist', verdict: 'fulfilled' }, cycle: 'current' },
      { stepId: 'rework', routeId: 'rework-specialist', after: { stepId: 'coordinate', participantId: 'coordinator', verdict: 'fail' }, cycle: 'current' },
      { stepId: 'check', routeId: 'check-specialist', after: { stepId: 'rework', participantId: 'specialist', verdict: 'fulfilled' }, cycle: 'next' },
      { stepId: 'complete', routeId: 'review-coordinator', after: { stepId: 'check', participantId: 'specialist', verdict: 'fail' }, cycle: 'current' },
    ],
    artifacts: ['draft'], criteria: [{ id: 'quality', description: 'The crew result is complete.' }],
    maxCycles: 2, cycleUnit: 'One delegate rework and check traversal.',
    terminalAuthorities: [{ participantId: 'coordinator', verdict: 'complete' }],
  };
  return { ...proposal([coordinator, specialist, release]), iterationGroups: [group] };
}

function parallelIterationMixPlan(): PlanProposal {
  const pairProducer = stage('pair-producer');
  pairProducer.artifacts = [{ id: 'pair-draft', path: 'dashboard/server/pair-producer.txt', description: 'Pair draft.' }];
  const pairPeer = stage('pair-peer', ['pair-producer']);
  pairPeer.artifacts = []; pairPeer.checkpoints = []; pairPeer.scope = { read: ['dashboard'], write: [] };
  const judgeProducer = stage('judge-producer');
  judgeProducer.artifacts = [{ id: 'judge-draft', path: 'dashboard/server/judge-producer.txt', description: 'Judge draft.' }];
  const judge = stage('mix-judge', ['judge-producer']);
  judge.artifacts = []; judge.checkpoints = []; judge.scope = { read: ['dashboard'], write: [] };
  const coordinator = stage('mix-coordinator');
  coordinator.artifacts = [{ id: 'crew-draft', path: 'dashboard/server/mix-coordinator.txt', description: 'Crew draft.' }];
  const specialist = stage('mix-specialist', ['mix-coordinator']);
  const release = stage('release', ['pair-producer', 'judge-producer', 'mix-coordinator']);
  const pair: ProposalIterationGroup = {
    iterationGroupId: 'pair-loop', goal: 'Accept the pair draft.',
    participants: [
      { participantId: 'pair-producer', stageRef: 'pair-producer', role: 'contributor', perspective: 'Own the draft.', mandate: 'Produce the draft.' },
      { participantId: 'pair-peer', stageRef: 'pair-peer', role: 'peer', perspective: 'Check the draft.', mandate: 'Accept a complete draft.' },
    ],
    routes: [{
      routeId: 'pair-review', senderParticipantId: 'pair-producer', recipientParticipantId: 'pair-peer',
      requestKinds: ['review'], baseResolutionStageIds: ['pair-producer'],
    }],
    activation: { seedParticipantId: 'pair-producer', seedArtifactIds: ['pair-draft'] },
    initialStepId: 'pair-review', schedule: [{ stepId: 'pair-review', routeId: 'pair-review', cycle: 'next' }],
    artifacts: ['pair-draft'], criteria: [{ id: 'quality', description: 'The draft is complete.' }],
    maxCycles: 1, cycleUnit: 'One peer review.', terminalAuthorities: [{ participantId: 'pair-peer', verdict: 'accept' }],
  };
  const judged: ProposalIterationGroup = {
    iterationGroupId: 'judge-loop', goal: 'Pass the judged draft.',
    participants: [
      { participantId: 'judge-producer', stageRef: 'judge-producer', role: 'contributor', perspective: 'Own the draft.', mandate: 'Produce and revise the draft.' },
      { participantId: 'mix-judge', stageRef: 'mix-judge', role: 'judge', perspective: 'Apply quality.', mandate: 'Pass only a complete draft.' },
    ],
    routes: [
      { routeId: 'judge-review', senderParticipantId: 'judge-producer', recipientParticipantId: 'mix-judge', requestKinds: ['review'], baseResolutionStageIds: ['judge-producer'] },
      { routeId: 'judge-rework', senderParticipantId: 'mix-judge', recipientParticipantId: 'judge-producer', requestKinds: ['rework'], baseResolutionStageIds: ['mix-judge'] },
    ],
    activation: { seedParticipantId: 'judge-producer', seedArtifactIds: ['judge-draft'] }, initialStepId: 'judge-review',
    schedule: [
      { stepId: 'judge-review', routeId: 'judge-review', after: { stepId: 'judge-rework', participantId: 'judge-producer', verdict: 'fulfilled' }, cycle: 'next' },
      { stepId: 'judge-rework', routeId: 'judge-rework', after: { stepId: 'judge-review', participantId: 'mix-judge', verdict: 'fail' }, cycle: 'current' },
    ],
    artifacts: ['judge-draft'], criteria: [{ id: 'quality', description: 'The draft is complete.' }],
    maxCycles: 2, cycleUnit: 'One producer generation and judge verdict.',
    terminalAuthorities: [{ participantId: 'mix-judge', verdict: 'pass' }],
  };
  const coordinated: ProposalIterationGroup = {
    iterationGroupId: 'coordinator-loop', goal: 'Complete the coordinated assignment.',
    participants: [
      { participantId: 'mix-coordinator', stageRef: 'mix-coordinator', role: 'coordinator', perspective: 'Own the goal.', mandate: 'Coordinate the specialist.' },
      { participantId: 'mix-specialist', stageRef: 'mix-specialist', role: 'contributor', perspective: 'Execute the task.', mandate: 'Fulfill the delegated work.' },
    ],
    routes: [
      { routeId: 'coordinator-delegate', senderParticipantId: 'mix-coordinator', recipientParticipantId: 'mix-specialist', requestKinds: ['delegate'], baseResolutionStageIds: ['mix-coordinator'] },
      { routeId: 'coordinator-review', senderParticipantId: 'mix-specialist', recipientParticipantId: 'mix-coordinator', requestKinds: ['review'], baseResolutionStageIds: ['mix-specialist'] },
    ],
    activation: { seedParticipantId: 'mix-coordinator', seedArtifactIds: ['crew-draft'] }, initialStepId: 'coordinator-delegate',
    schedule: [
      { stepId: 'coordinator-delegate', routeId: 'coordinator-delegate', cycle: 'current' },
      { stepId: 'coordinator-review', routeId: 'coordinator-review', after: { stepId: 'coordinator-delegate', participantId: 'mix-specialist', verdict: 'fulfilled' }, cycle: 'next' },
    ],
    artifacts: ['crew-draft'], criteria: [{ id: 'quality', description: 'The coordinated result is complete.' }],
    maxCycles: 2, cycleUnit: 'One delegate and coordinator review.',
    terminalAuthorities: [{ participantId: 'mix-coordinator', verdict: 'complete' }],
  };
  return {
    ...proposal([pairProducer, pairPeer, judgeProducer, judge, coordinator, specialist, release]),
    maxConcurrency: 2,
    iterationGroups: [pair, judged, coordinated],
  };
}

function mixedKindIterationPlan(): PlanProposal {
  const producer = stage('producer');
  producer.artifacts = [{ id: 'draft', path: 'dashboard/server/producer.txt', description: 'Draft.' }];
  const judge = stage('judge', ['producer']);
  judge.artifacts = []; judge.checkpoints = []; judge.scope = { read: ['dashboard'], write: [] };
  const release = stage('release', ['producer']);
  const group: ProposalIterationGroup = {
    iterationGroupId: 'mixed-kind-loop', goal: 'Rework and then check the same participant.',
    participants: [
      { participantId: 'producer', stageRef: 'producer', role: 'contributor', perspective: 'Own the draft.', mandate: 'Rework and check the draft.' },
      { participantId: 'judge', stageRef: 'judge', role: 'judge', perspective: 'Apply quality.', mandate: 'Request the required rework.' },
    ],
    routes: [
      { routeId: 'review', senderParticipantId: 'producer', recipientParticipantId: 'judge', requestKinds: ['review'], baseResolutionStageIds: ['producer'] },
      { routeId: 'rework', senderParticipantId: 'judge', recipientParticipantId: 'producer', requestKinds: ['rework'], baseResolutionStageIds: ['judge'] },
      { routeId: 'check', senderParticipantId: 'judge', recipientParticipantId: 'producer', requestKinds: ['check'], baseResolutionStageIds: ['judge'] },
    ],
    activation: { seedParticipantId: 'producer', seedArtifactIds: ['draft'] }, initialStepId: 'review',
    schedule: [
      { stepId: 'review', routeId: 'review', cycle: 'current' },
      { stepId: 'rework', routeId: 'rework', after: { stepId: 'review', participantId: 'judge', verdict: 'fail' }, cycle: 'current' },
      { stepId: 'check', routeId: 'check', after: { stepId: 'rework', participantId: 'producer', verdict: 'fulfilled' }, cycle: 'next' },
    ],
    artifacts: ['draft'], criteria: [{ id: 'quality', description: 'The draft is complete.' }],
    maxCycles: 2, cycleUnit: 'One rework followed by one check.',
    terminalAuthorities: [{ participantId: 'producer', verdict: 'pass' }],
  };
  return { ...proposal([producer, judge, release]), iterationGroups: [group] };
}

function genericOutcome(
  contract: NonNullable<WorkerExecuteInput['iterationContract']>,
  verdict: 'accept' | 'fail' | 'pass' | 'fulfilled' | 'complete',
) {
  const findingId = `finding-${contract.request.cycle}`;
  return {
    schema: 'kb.iteration-outcome/v1' as const,
    requestRef: contract.request.requestRef,
    iterationLoopRef: contract.request.iterationLoopRef,
    participantId: contract.request.recipientParticipantId,
    cycle: contract.request.cycle,
    verdict,
    inputGenerationRefs: [...contract.request.inputGenerationRefs],
    criteria: verdict === 'fulfilled' ? [] : [{
      criterionId: 'quality', verdict: verdict === 'accept' || verdict === 'pass' || verdict === 'complete' ? 'pass' as const : 'fail' as const,
      findingIds: verdict === 'fail' ? [findingId] : [],
    }],
    findings: verdict === 'fail' ? [{
      findingId, criterionId: 'quality', severity: 'blocking' as const,
      summary: 'The draft needs another revision.', evidencePaths: [],
    }] : [],
    ...(verdict === 'complete' ? { resolvedFindingRefs: [...contract.request.unresolvedFindingRefs] } : {}),
    positions: [], recordedDissent: [],
    summary: verdict === 'fulfilled' ? 'The successor draft is committed.'
      : verdict === 'complete' ? 'The crew result is complete.'
        : verdict === 'accept' ? 'The peer accepts the draft.' : `The draft ${verdict === 'pass' ? 'passes' : 'fails'}.`,
  };
}

function genericIterationFixture(input: {
  judgeVerdicts?: Array<'fail' | 'pass'>;
  maxCycles?: number;
  stopBeforeJudgeTurn?: number;
  crashAfterIntegrationStage?: string;
  plan?: PlanProposal;
  turnVerdicts?: Record<string, 'accept' | 'fail' | 'pass' | 'fulfilled' | 'complete'
    | Array<'accept' | 'fail' | 'pass' | 'fulfilled' | 'complete'>>;
  artifactFailure?: 'missing' | 'empty' | 'irregular' | 'byte-identical';
  resolveBaseMissStage?: string;
  resolvedBaseCommit?: string;
  reservationRefusalAt?: number;
  maxConcurrency?: number;
  crashAfterIterationRequest?: boolean;
  store?: ControlPlaneStore;
} = {}) {
  const store = input.store ?? createStore();
  const plan = input.plan ?? genericIterationPlan(input.maxCycles ?? 2);
  const run = createApprovedRun(store, plan);
  const fake = fakes();
  if (input.reservationRefusalAt !== undefined) {
    const admitted = fake.accounting;
    let reserveCalls = 0;
    fake.accounting = {
      async reserve(value) {
        reserveCalls += 1;
        if (reserveCalls === input.reservationRefusalAt) {
          fake.reservations.push(value.operationKey);
          fake.reservationLimits.push(value.limits);
          return { ok: false, reason: 'iteration participant budget unavailable' };
        }
        return admitted.reserve(value);
      },
      async settle(value) { return admitted.settle(value); },
    };
  }
  const results = new Map<string, Awaited<ReturnType<ResultIntegrator['lookup']>>>();
  const workerInputs: WorkerExecuteInput[] = [];
  const integrations: Parameters<ResultIntegrator['integrate']>[0][] = [];
  const baseResolutions: Parameters<NonNullable<ResultIntegrator['resolveBase']>>[0][] = [];
  const ensuredBases: Array<{ path: string; baseCommit?: string }> = [];
  const verdicts = [...(input.judgeVerdicts ?? ['pass'])];
  const turnVerdicts = Object.fromEntries(Object.entries(input.turnVerdicts ?? {}).map(([stepId, verdict]) => [
    stepId, Array.isArray(verdict) ? [...verdict] : verdict,
  ])) as NonNullable<typeof input.turnVerdicts>;
  let judgeTurns = 0;
  let crashed = false;
  let canonicalHead: string | null = null;
  let requestCrashArmed = input.crashAfterIterationRequest ?? false;
  const recordIterationRequest = store.recordIterationRequest.bind(store);
  store.recordIterationRequest = ((...args: Parameters<ControlPlaneStore['recordIterationRequest']>) => {
    const recorded = recordIterationRequest(...args);
    if (recorded.ok && requestCrashArmed) {
      requestCrashArmed = false;
      throw new Error('simulated crash after generic iteration request persistence');
    }
    return recorded;
  }) as ControlPlaneStore['recordIterationRequest'];
  const worktreeRoot = mkdtempSync(join(tmpdir(), 'kb-task7-iteration-'));
  tempDirs.push(worktreeRoot);
  fake.worktrees.ensure = async (value) => {
    ensuredBases.push({ path: value.path, baseCommit: value.baseCommit });
    mkdirSync(value.path, { recursive: true });
    if (value.baseCommit) {
      for (const artifact of plan.stages.flatMap((candidate) => candidate.artifacts)) {
        const path = join(value.path, artifact.path);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, `pinned:${artifact.path}`, 'utf8');
      }
    }
  };
  fake.worktrees.inspect = async (value) => {
    const attemptRef = value.path.split(/[\\/]/).at(-1);
    const worker = [...workerInputs].reverse().find((candidate) => candidate.attemptRef === attemptRef);
    const proposalStage = worker?.proposalStage ?? plan.stages.find((candidate) => candidate.id === worker?.stageRef);
    const producingTurn = !worker?.iterationContract
      || ARTIFACT_PRODUCING_REQUEST_KINDS.has(worker.iterationContract.request.kind);
    return { changed: producingTurn
      ? (proposalStage?.artifacts ?? []).map((artifact) => ({ path: artifact.path, digest: 'b'.repeat(64) }))
      : [] };
  };
  fake.workers = {
    async execute(value) {
      workerInputs.push(value);
      fake.executionOrder.push(value.proposalStage?.id ?? value.action.split(':')[1]);
      const producingTurn = value.iterationContract !== undefined
        && ARTIFACT_PRODUCING_REQUEST_KINDS.has(value.iterationContract.request.kind);
      for (const artifact of value.proposalStage?.artifacts ?? []) {
        const path = join(value.worktreePath, artifact.path);
        mkdirSync(dirname(path), { recursive: true });
        if (!producingTurn || input.artifactFailure === undefined) {
          writeFileSync(path, `changed:${value.iterationContract?.request.requestRef ?? value.attemptRef}`, 'utf8');
        } else if (input.artifactFailure === 'missing') {
          rmSync(path, { force: true, recursive: true });
        } else if (input.artifactFailure === 'empty') {
          writeFileSync(path, '', 'utf8');
        } else if (input.artifactFailure === 'irregular') {
          rmSync(path, { force: true, recursive: true });
          mkdirSync(path, { recursive: true });
        }
      }
      if (!value.iterationContract) {
        return {
          state: 'succeeded', summary: `${value.proposalStage?.id ?? 'stage'} seed committed`,
          usage: { inputTokens: 1, outputTokens: 1, costUsdMicros: 1 },
          artifacts: value.proposalStage?.artifacts.map((artifact) => ({ path: artifact.path, digest: 'b'.repeat(64) })) ?? [],
          checkpoints: value.checkpoints.length > 0 ? [...value.checkpoints] : [],
        };
      }
      const stepId = value.iterationContract.request.stepId;
      const declared = stepId === undefined ? undefined : turnVerdicts[stepId];
      const declaredVerdict = Array.isArray(declared) ? declared.shift() : declared;
      if (declaredVerdict) {
        const iterationOutcome = genericOutcome(value.iterationContract, declaredVerdict);
        return {
          state: 'succeeded', summary: iterationOutcome.summary,
          usage: { inputTokens: 1, outputTokens: 1, costUsdMicros: 1 },
          artifacts: declaredVerdict === 'fulfilled'
            ? value.proposalStage?.artifacts.map((artifact) => ({ path: artifact.path, digest: 'b'.repeat(64) })) ?? []
            : [],
          checkpoints: declaredVerdict === 'fulfilled' && value.checkpoints.length > 0 ? [...value.checkpoints] : [],
          iterationOutcome,
        };
      }
      if (value.iterationContract.request.recipientParticipantId === 'judge') {
        judgeTurns += 1;
        if (input.stopBeforeJudgeTurn === judgeTurns) {
          return { state: 'waiting-human', summary: 'Judge paused.', usage: { inputTokens: 1, outputTokens: 1, costUsdMicros: 1 }, artifacts: [], checkpoints: [] };
        }
        const verdict = verdicts.shift();
        if (!verdict) throw new Error('unexpected judge turn');
        const iterationOutcome = genericOutcome(value.iterationContract, verdict);
        return { state: 'succeeded', summary: iterationOutcome.summary, usage: { inputTokens: 1, outputTokens: 1, costUsdMicros: 1 }, artifacts: [], checkpoints: [], iterationOutcome };
      }
      const iterationOutcome = genericOutcome(value.iterationContract, 'fulfilled');
      return {
        state: 'succeeded', summary: iterationOutcome.summary, usage: { inputTokens: 1, outputTokens: 1, costUsdMicros: 1 },
        artifacts: value.proposalStage?.artifacts.map((artifact) => ({ path: artifact.path, digest: 'b'.repeat(64) })) ?? [],
        checkpoints: value.checkpoints.length > 0 ? [...value.checkpoints] : [], iterationOutcome,
      };
    },
  };
  fake.results = {
    async lookup(value) { return results.get(value.operationKey) ?? null; },
    async resolveBase(value) {
      baseResolutions.push(value);
      if (value.stageId === input.resolveBaseMissStage) return null;
      if (value.dependencyStageIds.length === 0 || !value.dependencyResultOperationKeys
        || value.dependencyResultOperationKeys.length !== value.dependencyStageIds.length) return null;
      const records = value.dependencyResultOperationKeys.map((dependency) => results.get(dependency.operationKey));
      if (records.some((record) => record?.durability !== 'canonical')) return null;
      return input.resolvedBaseCommit ?? canonicalHead;
    },
    async integrate(value) {
      integrations.push(value);
      const ensured = ensuredBases.find((candidate) => candidate.path === value.worktreePath);
      const attemptBaseCommit = ensured?.baseCommit ?? 'a'.repeat(40);
      const integrationCommit = value.changed.length > 0
        ? integrations.length.toString(16).padStart(40, '0') : attemptBaseCommit;
      if (value.changed.length > 0) canonicalHead = integrationCommit;
      const stored = {
        summary: value.summary, artifacts: [...value.artifacts], changed: [...value.changed], checkpoints: [...value.checkpoints],
        ...(value.iterationOutcome ? { iterationOutcome: value.iterationOutcome } : {}),
        resultHash: value.resultHash, durability: 'canonical' as const, attemptBaseCommit, integrationCommit,
      };
      results.set(value.operationKey, stored);
      if (!crashed && input.crashAfterIntegrationStage === value.stageId) {
        crashed = true;
        throw new Error('simulated crash after generic canonical integration');
      }
      return { status: 'integrated' as const, resultHash: value.resultHash, durability: 'canonical' as const, attemptBaseCommit, integrationCommit };
    },
  };
  const options = engineOptions(store, fake, worktreeRoot);
  options.maxConcurrency = input.maxConcurrency ?? options.maxConcurrency;
  const engine = new AutomaticExecutionEngine(options);
  return { store, plan, run, fake, engine, results, workerInputs, integrations, baseResolutions, ensuredBases };
}

function fytPolicy(curatedSkills: string[]): PolicyEnvironment {
  return {
    ...policy,
    curatedSkills: new Set(curatedSkills),
    contractText: 'faceless-youtube queues-for-me; publication requires human approval',
    governanceContents: {
      'CLAUDE.md': 'constitution',
      'governance/agent-rules.md': 'rules',
      'governance/risk-tiers.md': 'risk tiers',
      'orgs/faceless-youtube/contract.md': 'fyt contract',
    },
  };
}

function fytProposal(requiredSkills: string[] = ['tests']): PlanProposal {
  const fytStage: ProposalStage = {
    ...stage('fyt'),
    target: 'orgs/faceless-youtube/output',
    requiredSkills,
    scope: { read: ['orgs/faceless-youtube'], write: ['orgs/faceless-youtube'] },
    artifacts: [{ id: 'fyt-result', path: 'orgs/faceless-youtube/output/fyt.txt', description: 'fyt output' }],
  };
  return {
    ...proposal([fytStage]),
    project: 'faceless-youtube',
    scope: { read: ['orgs/faceless-youtube'], write: ['orgs/faceless-youtube'] },
    governanceRefs: ['CLAUDE.md', 'governance/agent-rules.md', 'governance/risk-tiers.md', 'orgs/faceless-youtube/contract.md'],
  };
}

const tempDirs: string[] = [];
const fileStores = createExistingRootFileStoreHarnessForTest();
const createFileControlPlaneStore = fileStores.open;
afterEach(() => {
  fileStores.close();
  while (tempDirs.length > 0) rmSync(tempDirs.pop() as string, { recursive: true, force: true });
});

describe('AutomaticExecutionEngine', () => {
  it('selects the next participant only from the declared route and deterministic schedule', async () => {
    const item = genericIterationFixture({ judgeVerdicts: ['fail', 'pass'] });
    const outcome = await item.engine.runToBoundary({ subject: 'operator', runRef: item.run.runRef, proposal: item.plan });
    expect(outcome.state).toBe('succeeded');
    expect(item.fake.executionOrder).toEqual(['producer', 'judge', 'producer', 'judge', 'release']);
    const detail = item.store.getRun('operator', item.run.runRef);
    expect(detail.ok && detail.value.iterationRequests.map((request) => [request.stepId, request.routeId, request.recipientParticipantId]))
      .toEqual([['review', 'to-judge', 'judge'], ['rework', 'to-producer', 'producer'], ['review', 'to-judge', 'judge']]);
  });

  it('activates initialStepId only after the declared seed generation commits', async () => {
    const item = genericIterationFixture();
    const events: string[] = [];
    const record = item.store.recordStageGeneration.bind(item.store);
    const activate = item.store.activateIterationLoop.bind(item.store);
    item.store.recordStageGeneration = ((...args: Parameters<ControlPlaneStore['recordStageGeneration']>) => {
      const result = record(...args);
      if (result.ok) events.push(`committed:${result.value.generationRef}`);
      return result;
    }) as ControlPlaneStore['recordStageGeneration'];
    item.store.activateIterationLoop = ((...args: Parameters<ControlPlaneStore['activateIterationLoop']>) => {
      const detail = item.store.getRun('operator', item.run.runRef);
      expect(detail.ok && detail.value.stageGenerations.some((generation) =>
        generation.state === 'committed' && args[2].seedGenerationRefs.includes(generation.generationRef))).toBe(true);
      expect(Object.keys(args[2].artifactGenerationRefs)).toEqual(['draft']);
      events.push(`activated:${args[2].seedGenerationRefs[0]}`);
      return activate(...args);
    }) as ControlPlaneStore['activateIterationLoop'];
    await item.engine.runToBoundary({ subject: 'operator', runRef: item.run.runRef, proposal: item.plan });
    expect(events[0]?.startsWith('committed:')).toBe(true);
    expect(events[1]).toBe(`activated:${events[0]?.slice('committed:'.length)}`);
  });

  it('never schedules one participant stage through the DAG and iteration loop at the same time', async () => {
    const item = genericIterationFixture({ judgeVerdicts: ['fail', 'pass'] });
    const before = item.store.getRun('operator', item.run.runRef);
    expect(before.ok && before.value.stages.find((candidate) => candidate.stageId === 'judge')?.state).toBe('blocked');
    await item.engine.runToBoundary({ subject: 'operator', runRef: item.run.runRef, proposal: item.plan });
    expect(item.workerInputs.filter((input) => input.proposalStage?.id === 'producer' && input.iterationContract === undefined)).toHaveLength(1);
    expect(item.workerInputs.filter((input) => ['producer', 'judge'].includes(input.proposalStage?.id ?? '')
      && input.iterationContract !== undefined)).toHaveLength(3);
    expect(item.workerInputs.filter((input) => input.proposalStage?.id === 'judge' && input.iterationContract === undefined)).toHaveLength(0);
  });

  it('opens cycle one at activation while an awaiting seed remains at cycle zero', async () => {
    const item = genericIterationFixture();
    const before = item.store.getRun('operator', item.run.runRef);
    expect(before).toMatchObject({ ok: true, value: { iterationLoops: [{ state: 'awaiting-seed', cyclesUsed: 0 }] } });
    const opened: Array<{ state: string; cyclesUsed: number; currentStepId?: string }> = [];
    const activate = item.store.activateIterationLoop.bind(item.store);
    item.store.activateIterationLoop = ((...args: Parameters<ControlPlaneStore['activateIterationLoop']>) => {
      const result = activate(...args);
      if (result.ok) opened.push(result.value);
      return result;
    }) as ControlPlaneStore['activateIterationLoop'];
    await item.engine.runToBoundary({ subject: 'operator', runRef: item.run.runRef, proposal: item.plan });
    expect(opened).toEqual([expect.objectContaining({ state: 'awaiting-turn', cyclesUsed: 1, currentStepId: 'review' })]);
  });

  it('opens the next cycle only at a declared schedule step boundary', async () => {
    const item = genericIterationFixture({ judgeVerdicts: ['fail', 'pass'] });
    await item.engine.runToBoundary({ subject: 'operator', runRef: item.run.runRef, proposal: item.plan });
    const detail = item.store.getRun('operator', item.run.runRef);
    expect(detail.ok && detail.value.iterationRequests.map((request) => [request.stepId, request.cycle]))
      .toEqual([['review', 1], ['rework', 1], ['review', 2]]);
    expect(detail.ok && detail.value.iterationReceipts.map((receipt) => [receipt.verdict, receipt.cycle]))
      .toEqual([['fail', 1], ['fulfilled', 1], ['pass', 2]]);
  });

  it('runs a declared maxCycles above the legacy cap until semantic acceptance', async () => {
    const failures = Array.from({ length: 40 }, () => 'fail' as const);
    const item = genericIterationFixture({ judgeVerdicts: [...failures, 'pass'], maxCycles: 41 });
    const outcome = await item.engine.runToBoundary({ subject: 'operator', runRef: item.run.runRef, proposal: item.plan });
    expect(outcome.state).toBe('succeeded');
    const detail = item.store.getRun('operator', item.run.runRef);
    expect(detail.ok && detail.value.iterationLoops[0]).toMatchObject({ state: 'passed', cyclesUsed: 41 });
    expect(item.workerInputs.filter((turn) => turn.iterationContract?.request.recipientParticipantId === 'judge')).toHaveLength(41);
  }, 300_000);

  it('accepts an authorized terminal verdict at the declared bound without parking', async () => {
    const item = genericIterationFixture({ judgeVerdicts: ['pass'], maxCycles: 1 });
    await expect(item.engine.runToBoundary({ subject: 'operator', runRef: item.run.runRef, proposal: item.plan }))
      .resolves.toMatchObject({ state: 'succeeded' });
    const detail = item.store.getRun('operator', item.run.runRef);
    expect(detail).toMatchObject({ ok: true, value: {
      iterationLoops: [expect.objectContaining({ state: 'passed', cyclesUsed: 1 })],
      humanRequests: [],
    } });
  });

  it('parks before launching maxCycles plus one and preserves the complete unresolved residue', async () => {
    const item = genericIterationFixture({ judgeVerdicts: ['fail'], maxCycles: 1 });
    await expect(item.engine.runToBoundary({ subject: 'operator', runRef: item.run.runRef, proposal: item.plan }))
      .resolves.toMatchObject({ state: 'waiting-human' });
    const detail = item.store.getRun('operator', item.run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    const loop = detail.value.iterationLoops[0]!;
    expect(loop).toMatchObject({
      state: 'awaiting-park-gate', parkReason: 'exhausted', cyclesUsed: 1,
      unresolvedResidue: {
        unresolvedFindings: [expect.objectContaining({ findingId: 'finding-1', severity: 'blocking' })],
        requestRefs: detail.value.iterationRequests.map((request) => request.requestRef),
        receiptRefs: detail.value.iterationReceipts.map((receipt) => receipt.receiptRef),
        activeGenerationRefs: loop.activeGenerationRefs,
        nextRouteId: 'to-judge', cyclesUsed: 1, maxCycles: 1,
      },
    });
    expect(item.workerInputs.filter((turn) => turn.iterationContract?.request.recipientParticipantId === 'judge')).toHaveLength(1);
    expect(detail.value.humanRequests.filter((request) => request.gateKind === 'iteration-park')).toHaveLength(1);
  });

  it('keeps scheduling an unblocked sibling group after one group parks and settles after that gate resolves', async () => {
    const item = genericIterationFixture({
      plan: siblingIterationPlan(),
      turnVerdicts: {
        'a-review': 'fail', 'a-rework': 'fulfilled',
        'b-review': ['fail', 'pass'], 'b-rework': 'fulfilled',
      },
    });
    const input = { subject: 'operator', runRef: item.run.runRef, proposal: item.plan };

    await expect(item.engine.runToBoundary(input)).resolves.toMatchObject({ state: 'waiting-human' });
    const parked = item.store.getRun('operator', item.run.runRef);
    if (!parked.ok) throw new Error(parked.detail);
    const aLoop = parked.value.iterationLoops.find((loop) => loop.iterationGroupId === 'a-loop')!;
    const bLoop = parked.value.iterationLoops.find((loop) => loop.iterationGroupId === 'b-loop')!;
    const gate = parked.value.humanRequests.find((request) => request.requestRef === aLoop.interventionRef)!;
    const receipt = parked.value.iterationReceipts.find((candidate) => candidate.receiptRef === aLoop.lastReceiptRef)!;

    expect(aLoop).toMatchObject({ state: 'awaiting-park-gate', parkReason: 'exhausted', cyclesUsed: 1 });
    expect(gate).toMatchObject({ gateKind: 'iteration-park', state: 'open' });
    expect(bLoop).toMatchObject({ state: 'passed', cyclesUsed: 2 });
    expect(parked.value.iterationReceipts.filter((candidate) => candidate.iterationLoopRef === bLoop.iterationLoopRef)
      .map((candidate) => candidate.verdict)).toEqual(['fail', 'fulfilled', 'pass']);
    expect(parked.value.humanRequests.some((request) => request.kind === 'intervention'
      && request.gateKind === undefined)).toBe(false);

    const resolved = item.store.resolveIterationGate('operator', gate.requestRef, {
      expectedRequestRevision: gate.revision, expectedLoopVersion: aLoop.version,
      expectedReceiptVersion: receipt.version, decision: 'approved', operationKey: 'approve-a-exhaustion',
    });
    expect(resolved).toMatchObject({ ok: true, value: { loop: { state: 'passed' } } });
    await expect(item.engine.runToBoundary(input)).resolves.toMatchObject({ state: 'succeeded' });
  });

  it('runs pair judge and coordinator groups to their composite terminal state at concurrency two', async () => {
    const item = genericIterationFixture({
      plan: parallelIterationMixPlan(), maxConcurrency: 2,
      turnVerdicts: {
        'pair-review': 'accept',
        'judge-review': ['fail', 'pass'], 'judge-rework': 'fulfilled',
        'coordinator-delegate': 'fulfilled', 'coordinator-review': 'complete',
      },
    });
    await expect(item.engine.runToBoundary({ subject: 'operator', runRef: item.run.runRef, proposal: item.plan }))
      .resolves.toMatchObject({ state: 'succeeded' });
    const detail = item.store.getRun('operator', item.run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    expect(detail.value.iterationLoops.map((loop) => [loop.iterationGroupId, loop.state, loop.cyclesUsed]))
      .toEqual([
        ['pair-loop', 'passed', 1],
        ['judge-loop', 'passed', 2],
        ['coordinator-loop', 'passed', 2],
      ]);
    expect(detail.value.humanRequests).toEqual([]);
    for (const receipt of detail.value.iterationReceipts.filter((candidate) => candidate.verdict !== 'fulfilled')) {
      const request = detail.value.iterationRequests.find((candidate) => candidate.requestRef === receipt.requestRef)!;
      const pinnedRef = request.inputGenerationRefs[0]!;
      const pinned = detail.value.stageGenerations.find((generation) => generation.generationRef === pinnedRef)!;
      expect(receipt).toMatchObject({ baseCommit: pinned.baseCommit, canonicalCommit: pinned.canonicalCommit });
    }
  });

  it('parks before integration when any required rework artifact is missing empty irregular or byte-identical', async () => {
    for (const artifactFailure of ['missing', 'empty', 'irregular', 'byte-identical'] as const) {
      const item = genericIterationFixture({ judgeVerdicts: ['fail'], artifactFailure });
      await expect(item.engine.runToBoundary({ subject: 'operator', runRef: item.run.runRef, proposal: item.plan }))
        .resolves.toMatchObject({ state: 'waiting-human' });
      const detail = item.store.getRun('operator', item.run.runRef);
      expect(detail).toMatchObject({ ok: true, value: {
        iterationLoops: [expect.objectContaining({ state: 'awaiting-park-gate', parkReason: 'no-progress' })],
      } });
      expect(item.integrations.filter((record) => record.stageId === 'producer' && record.iterationContract)).toHaveLength(0);
    }
  });

  it('records no successor or supersession and makes zero integration calls on no progress', async () => {
    const item = genericIterationFixture({ judgeVerdicts: ['fail'], artifactFailure: 'byte-identical' });
    await item.engine.runToBoundary({ subject: 'operator', runRef: item.run.runRef, proposal: item.plan });
    const detail = item.store.getRun('operator', item.run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    expect(detail.value.stageGenerations.map((generation) => [generation.logicalStageId, generation.generation, generation.state]))
      .toEqual([['producer', 1, 'committed']]);
    expect(detail.value.generationSupersessions).toEqual([]);
    expect(item.integrations.filter((record) => record.stageId === 'producer' && record.iterationContract)).toEqual([]);
    expect(detail.value.iterationLoops[0]!.activeGenerationRefs).toEqual([detail.value.stageGenerations[0]!.generationRef]);
    expect(detail.value.attempts.find((attempt) => attempt.logicalGeneration === 2)).toMatchObject({ state: 'interrupted' });
  });

  it('mints one iteration-park gate with reason no-progress and full exhaustion-equivalent residue', async () => {
    const item = genericIterationFixture({ judgeVerdicts: ['fail'], artifactFailure: 'byte-identical' });
    await item.engine.runToBoundary({ subject: 'operator', runRef: item.run.runRef, proposal: item.plan });
    const detail = item.store.getRun('operator', item.run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    const loop = detail.value.iterationLoops[0]!;
    const attempted = detail.value.iterationRequests.at(-1)!;
    expect(detail.value.humanRequests.filter((request) => request.gateKind === 'iteration-park'))
      .toEqual([expect.objectContaining({ kind: 'approval', state: 'open' })]);
    expect(loop.unresolvedResidue).toMatchObject({
      unresolvedFindings: [expect.objectContaining({ findingId: 'finding-1' })],
      requestRefs: detail.value.iterationRequests.map((request) => request.requestRef),
      receiptRefs: detail.value.iterationReceipts.map((receipt) => receipt.receiptRef),
      activeGenerationRefs: loop.activeGenerationRefs,
      attemptedRequestRef: attempted.requestRef,
      attemptedOutcome: expect.objectContaining({ requestRef: attempted.requestRef, verdict: 'fulfilled' }),
      artifactSnapshots: [expect.objectContaining({
        path: 'dashboard/server/producer.txt', size: expect.any(Number), sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        byteIdentical: true,
      })],
      failureReason: expect.stringContaining('byte-identical'),
    });
  });

  it('reserves and settles the run token and cost windows for every participant turn', async () => {
    const item = genericIterationFixture({ judgeVerdicts: ['fail', 'pass'] });
    await item.engine.runToBoundary({ subject: 'operator', runRef: item.run.runRef, proposal: item.plan });
    const participants = item.workerInputs.filter((worker) => worker.iterationContract !== undefined);
    expect(participants.map((worker) => `reserve:${worker.attemptRef}`)
      .every((operationKey) => item.fake.reservations.includes(operationKey))).toBe(true);
    expect(participants.map((worker) => `settle:${worker.attemptRef}`)
      .every((operationKey) => item.fake.settlements.includes(operationKey))).toBe(true);
  });

  it('opens the existing fail-closed intervention and preserves loop state when budget reservation fails', async () => {
    const item = genericIterationFixture({ judgeVerdicts: ['fail'], reservationRefusalAt: 3 });
    await expect(item.engine.runToBoundary({ subject: 'operator', runRef: item.run.runRef, proposal: item.plan }))
      .resolves.toMatchObject({ state: 'waiting-human' });
    const detail = item.store.getRun('operator', item.run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    expect(detail.value.iterationLoops[0]).toMatchObject({ state: 'running-turn', currentStepId: 'rework' });
    expect(detail.value.iterationLoops[0]).not.toHaveProperty('parkReason');
    expect(detail.value.humanRequests).toContainEqual(expect.objectContaining({
      kind: 'intervention', prompt: 'iteration participant budget unavailable',
    }));
    const attempt = detail.value.attempts.find((candidate) => candidate.logicalGeneration === 2)!;
    expect(attempt.state).toBe('interrupted');
    expect(detail.value.sessions.find((session) => session.attemptRef === attempt.attemptRef)).toMatchObject({ state: 'interrupted' });
    expect(detail.value.generationSupersessions).toEqual([]);
  });

  it('routes a transient fenced base-resolution miss to fail-closed intervention without failing the run', async () => {
    const item = genericIterationFixture({ judgeVerdicts: ['fail'], resolveBaseMissStage: 'producer' });
    await expect(item.engine.runToBoundary({ subject: 'operator', runRef: item.run.runRef, proposal: item.plan }))
      .resolves.toMatchObject({ state: 'waiting-human' });
    const detail = item.store.getRun('operator', item.run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    expect(detail.value.run.lifecycle.kind).toBe('waiting-human');
    expect(detail.value.iterationLoops[0]).toMatchObject({ state: 'rework-queued', currentStepId: 'rework' });
    expect(detail.value.iterationLoops[0]).not.toHaveProperty('parkReason');
    expect(detail.value.attempts.find((attempt) => attempt.logicalGeneration === 2)).toMatchObject({ state: 'interrupted' });
    expect(detail.value.humanRequests).toContainEqual(expect.objectContaining({
      kind: 'intervention', prompt: expect.stringContaining('committed iteration dependency lineage is unavailable'),
    }));
    expect(detail.value.humanRequests.some((request) => request.gateKind === 'iteration-park')).toBe(false);
  });

  it('halts sibling groups when a transient base-resolution miss opens a run-wide intervention', async () => {
    const item = genericIterationFixture({
      plan: siblingIterationPlan(), resolveBaseMissStage: 'a-judge', maxConcurrency: 2,
      turnVerdicts: { 'b-review': 'pass' },
    });
    await expect(item.engine.runToBoundary({ subject: 'operator', runRef: item.run.runRef, proposal: item.plan }))
      .resolves.toMatchObject({ state: 'waiting-human' });
    const detail = item.store.getRun('operator', item.run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    expect(detail.value.iterationLoops.find((loop) => loop.iterationGroupId === 'a-loop'))
      .toMatchObject({ state: 'awaiting-turn', currentStepId: 'a-review' });
    expect(detail.value.iterationLoops.find((loop) => loop.iterationGroupId === 'b-loop'))
      .toMatchObject({ state: 'awaiting-turn', currentStepId: 'b-review', cyclesUsed: 1 });
    expect(item.workerInputs.filter((turn) => turn.iterationContract?.request.recipientParticipantId === 'b-judge')).toHaveLength(0);
    expect(item.workerInputs.some((turn) => turn.iterationContract?.request.recipientParticipantId === 'a-judge')).toBe(false);
    expect(detail.value.humanRequests).toContainEqual(expect.objectContaining({
      kind: 'intervention', prompt: expect.stringContaining('committed iteration dependency lineage is unavailable'),
    }));
  });

  it('pins every turn to the server-selected generation refs base commit and artifact hashes', async () => {
    const item = genericIterationFixture({ judgeVerdicts: ['fail', 'pass'] });
    await item.engine.runToBoundary({ subject: 'operator', runRef: item.run.runRef, proposal: item.plan });
    const detail = item.store.getRun('operator', item.run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    const iterationWorkers = item.workerInputs.filter((candidate) => candidate.iterationContract !== undefined);
    expect(iterationWorkers).toHaveLength(3);
    for (const worker of iterationWorkers) {
      const request = worker.iterationContract!.request;
      const durable = detail.value.iterationRequests.find((candidate) => candidate.requestRef === request.requestRef);
      expect(request).toEqual(durable);
      expect(request.inputGenerationRefs).toEqual(expect.arrayContaining(request.inputGenerationRefs));
      expect(request.baseCommit).toMatch(/^[a-f0-9]{40}$/);
      expect(request.artifactHashes).toEqual({ draft: 'b'.repeat(64) });
    }
  });

  it('records verdict lineage from pinned generation identity after the shared base advances', async () => {
    const advancedBase = 'f'.repeat(40);
    const item = genericIterationFixture({ judgeVerdicts: ['pass'], resolvedBaseCommit: advancedBase });
    const outcome = await item.engine.runToBoundary({ subject: 'operator', runRef: item.run.runRef, proposal: item.plan });
    const detail = item.store.getRun('operator', item.run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    expect(outcome, JSON.stringify(detail.value.humanRequests)).toMatchObject({ state: 'succeeded' });
    const request = detail.value.iterationRequests[0]!;
    const generation = detail.value.stageGenerations.find((candidate) =>
      request.inputGenerationRefs.includes(candidate.generationRef) && candidate.logicalStageId === 'producer')!;
    expect(request.baseCommit).toBe(advancedBase);
    expect(detail.value.iterationReceipts[0]).toMatchObject({
      inputGenerationRefs: [generation.generationRef],
      baseCommit: generation.baseCommit,
      canonicalCommit: generation.canonicalCommit,
    });
    expect(detail.value.humanRequests).toEqual([]);
  });

  it('resolves a verified canonical base for every fenced participant turn instead of the null unverified path', async () => {
    const item = genericIterationFixture({ judgeVerdicts: ['fail', 'pass'] });
    await item.engine.runToBoundary({ subject: 'operator', runRef: item.run.runRef, proposal: item.plan });
    const participantTurns = item.baseResolutions.filter((call) => call.stageId === 'producer' || call.stageId === 'judge');
    expect(participantTurns).toHaveLength(3);
    expect(participantTurns.every((call) => call.dependencyStageIds.length > 0
      && call.dependencyResultOperationKeys?.length === call.dependencyStageIds.length)).toBe(true);
    const iterationAttempts = item.workerInputs.filter((worker) => worker.iterationContract !== undefined);
    for (const worker of iterationAttempts) {
      const base = item.ensuredBases.find((candidate) => candidate.path.endsWith(worker.attemptRef))?.baseCommit;
      expect(base).toBe(worker.iterationContract!.request.baseCommit);
    }
  });

  it('pins a fan-in turn to the current generation of every peer and never generation one fallback', async () => {
    const item = genericIterationFixture({ plan: fanInIterationPlan(), judgeVerdicts: ['fail', 'pass'] });
    const outcome = await item.engine.runToBoundary({ subject: 'operator', runRef: item.run.runRef, proposal: item.plan });
    expect(outcome.state).toBe('succeeded');
    const judgeBases = item.baseResolutions.filter((call) => call.stageId === 'judge');
    expect(judgeBases).toHaveLength(2);
    expect(judgeBases[0].dependencyResultOperationKeys).toEqual([
      { stageId: 'producer', operationKey: `result:${item.run.runRef}:producer` },
      { stageId: 'peer', operationKey: expect.stringMatching(`^iteration-result:${item.run.runRef}:peer:`) },
    ]);
    expect(judgeBases[1].dependencyResultOperationKeys).toEqual([
      { stageId: 'producer', operationKey: expect.stringMatching(`^iteration-result:${item.run.runRef}:producer:`) },
      { stageId: 'peer', operationKey: expect.stringMatching(`^iteration-result:${item.run.runRef}:peer:`) },
    ]);
    expect(judgeBases[1].dependencyResultOperationKeys).not.toContainEqual({
      stageId: 'producer', operationKey: `result:${item.run.runRef}:producer`,
    });
  });

  it('creates one successor generation and one supersession for an artifact-producing turn', async () => {
    const item = genericIterationFixture({ judgeVerdicts: ['fail', 'pass'] });
    await item.engine.runToBoundary({ subject: 'operator', runRef: item.run.runRef, proposal: item.plan });
    const detail = item.store.getRun('operator', item.run.runRef);
    expect(detail.ok && detail.value.stageGenerations.map((generation) => [generation.logicalStageId, generation.generation, generation.state]))
      .toEqual([['producer', 1, 'committed'], ['producer', 2, 'committed']]);
    expect(detail.ok && detail.value.generationSupersessions).toEqual([expect.objectContaining({
      predecessorGenerationRef: detail.ok && detail.value.stageGenerations[0].generationRef,
      successorGenerationRef: detail.ok && detail.value.stageGenerations[1].generationRef,
    })]);
  });

  it('records fulfilled between rework and the next reviewing verdict', async () => {
    const item = genericIterationFixture({ judgeVerdicts: ['fail', 'pass'] });
    await item.engine.runToBoundary({ subject: 'operator', runRef: item.run.runRef, proposal: item.plan });
    const detail = item.store.getRun('operator', item.run.runRef);
    expect(detail.ok && detail.value.iterationReceipts.map((receipt) => receipt.verdict)).toEqual(['fail', 'fulfilled', 'pass']);
    const fulfilled = detail.ok && detail.value.iterationReceipts[1];
    expect(fulfilled).toMatchObject({ verdict: 'fulfilled', outputGenerationRefs: [expect.any(String)] });
    expect(detail.ok && detail.value.iterationReceipts[2].inputGenerationRefs).toEqual(fulfilled && fulfilled.outputGenerationRefs);
  });

  it('resumes a persisted request with no canonical result once using the same logical turn and operation identity', async () => {
    const item = genericIterationFixture({ crashAfterIterationRequest: true });
    const input = { subject: 'operator', runRef: item.run.runRef, proposal: item.plan };
    await expect(item.engine.runToBoundary(input)).rejects.toThrow('simulated crash after generic iteration request persistence');
    const crashed = item.store.getRun('operator', item.run.runRef);
    if (!crashed.ok) throw new Error(crashed.detail);
    const request = crashed.value.iterationRequests[0]!;
    expect(crashed.value.iterationReceipts).toEqual([]);
    expect(item.results.get(`iteration-result:${item.run.runRef}:judge:${request.requestRef}`)).toBeUndefined();

    const restarted = new AutomaticExecutionEngine(engineOptions(item.store, item.fake));
    await expect(restarted.runToBoundary(input)).resolves.toMatchObject({ state: 'succeeded' });
    const judgeTurns = item.workerInputs.filter((worker) => worker.proposalStage?.id === 'judge');
    expect(judgeTurns).toHaveLength(1);
    expect(judgeTurns[0]).toMatchObject({
      operationKey: `iteration-turn:${request.requestRef}`,
      iterationContract: { request },
    });
    expect(item.integrations.filter((record) => record.stageId === 'judge')).toEqual([
      expect.objectContaining({ operationKey: `iteration-result:${item.run.runRef}:judge:${request.requestRef}` }),
    ]);
  });

  it('allows recovery to create the normal successor attempt and session lineage', async () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'kb-task8-iteration-recovery-'));
    tempDirs.push(stateRoot);
    let ids = 0;
    const store = createFileControlPlaneStore(stateRoot, { newId: () => `persistent-${++ids}` });
    const item = genericIterationFixture({ crashAfterIterationRequest: true, store });
    const input = { subject: 'operator', runRef: item.run.runRef, proposal: item.plan };
    await expect(item.engine.runToBoundary(input)).rejects.toThrow('simulated crash after generic iteration request persistence');
    let detail = item.store.getRun('operator', item.run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    const stage = detail.value.stages.find((candidate) => candidate.stageId === 'judge')!;
    const proposalStage = item.plan.stages.find((candidate) => candidate.id === 'judge')!;
    const prepared = (item.engine as any).prepareAttempt(input, stage, proposalStage, policy, null);
    expect(prepared).not.toBeNull();
    const oldAttemptRef = prepared.attempt.attemptRef;
    const oldSessionRef = prepared.session.sessionRef;
    const restartedStore = createFileControlPlaneStore(stateRoot, { newId: () => `persistent-${++ids}` });
    const interrupted = restartedStore.getRun('operator', item.run.runRef);
    if (!interrupted.ok) throw new Error(interrupted.detail);
    const oldAttempt = interrupted.value.attempts.find((candidate) => candidate.attemptRef === oldAttemptRef)!;
    expect(oldAttempt).toMatchObject({ state: 'interrupted' });
    expect(interrupted.value.sessions.find((candidate) => candidate.sessionRef === oldSessionRef)).toMatchObject({ state: 'interrupted' });
    expect(interrupted.value.stages.find((candidate) => candidate.stageRef === stage.stageRef)).toMatchObject({ state: 'interrupted' });

    const restarted = new AutomaticExecutionEngine(engineOptions(restartedStore, item.fake));
    await expect(restarted.runToBoundary(input)).resolves.toMatchObject({ state: 'succeeded' });
    const recovered = restartedStore.getRun('operator', item.run.runRef);
    if (!recovered.ok) throw new Error(recovered.detail);
    const successor = recovered.value.attempts.find((candidate) => candidate.predecessorAttemptRef === oldAttempt.attemptRef)!;
    expect(recovered.value.attempts.find((candidate) => candidate.attemptRef === oldAttempt.attemptRef)).toMatchObject({ state: 'interrupted' });
    expect(successor).toMatchObject({ state: 'succeeded', logicalGeneration: oldAttempt.logicalGeneration });
    expect(recovered.value.sessions.filter((session) =>
      session.attemptRef === oldAttempt.attemptRef || session.attemptRef === successor.attemptRef)).toEqual([
      expect.objectContaining({ attemptRef: oldAttempt.attemptRef, state: 'interrupted' }),
      expect.objectContaining({ attemptRef: successor.attemptRef, state: 'completed' }),
    ]);
  });

  it('replays a canonical receipt and successor exactly once after restart', async () => {
    const item = genericIterationFixture({ crashAfterIterationRequest: true, judgeVerdicts: ['fail'] });
    const input = { subject: 'operator', runRef: item.run.runRef, proposal: item.plan };
    await expect(item.engine.runToBoundary(input)).rejects.toThrow('simulated crash after generic iteration request persistence');
    const beforeTurn = item.store.getRun('operator', item.run.runRef);
    if (!beforeTurn.ok) throw new Error(beforeTurn.detail);
    const stage = beforeTurn.value.stages.find((candidate) => candidate.stageId === 'judge')!;
    const proposalStage = item.plan.stages.find((candidate) => candidate.id === 'judge')!;
    const runtime = item.engine as any;
    const prepared = runtime.prepareAttempt(input, stage, proposalStage, policy, null);
    expect(prepared).not.toBeNull();
    const advanceIterationTurn = item.store.advanceIterationTurn.bind(item.store);
    let advanceCrashArmed = true;
    item.store.advanceIterationTurn = ((...args: Parameters<ControlPlaneStore['advanceIterationTurn']>) => {
      if (advanceCrashArmed) {
        advanceCrashArmed = false;
        throw new Error('simulated crash after canonical iteration receipt persistence');
      }
      return advanceIterationTurn(...args);
    }) as ControlPlaneStore['advanceIterationTurn'];
    await expect(runtime.executeAttemptUnsafe(input, prepared, policy))
      .rejects.toThrow('simulated crash after canonical iteration receipt persistence');

    const crashed = item.store.getRun('operator', item.run.runRef);
    if (!crashed.ok) throw new Error(crashed.detail);
    expect(crashed.value.run.lifecycle.kind).toBe('running');
    expect(crashed.value.iterationLoops[0]).toMatchObject({ state: 'failed', lastReceiptRef: crashed.value.iterationReceipts[0]?.receiptRef });
    expect(crashed.value.iterationReceipts).toEqual([expect.objectContaining({
      verdict: 'fail', baseCommit: 'a'.repeat(40), canonicalCommit: '1'.padStart(40, '0'),
    })]);
    const workerCalls = item.workerInputs.length;
    const integrationCalls = item.integrations.length;

    const restarted = new AutomaticExecutionEngine(engineOptions(item.store, item.fake)) as any;
    await expect(restarted.reconcileIterationRuntime(input)).resolves.toEqual([]);
    const once = item.store.getRun('operator', item.run.runRef);
    if (!once.ok) throw new Error(once.detail);
    const onceEvents = item.store.listEvents('operator', item.run.runRef);
    if (!onceEvents.ok) throw new Error(onceEvents.detail);
    const onceSnapshot = JSON.stringify({ detail: once.value, events: onceEvents.value });
    await expect(restarted.reconcileIterationRuntime(input)).resolves.toEqual([]);
    const twice = item.store.getRun('operator', item.run.runRef);
    if (!twice.ok) throw new Error(twice.detail);
    const twiceEvents = item.store.listEvents('operator', item.run.runRef);
    if (!twiceEvents.ok) throw new Error(twiceEvents.detail);
    expect(JSON.stringify({ detail: twice.value, events: twiceEvents.value })).toBe(onceSnapshot);
    expect(item.workerInputs).toHaveLength(workerCalls);
    expect(item.integrations).toHaveLength(integrationCalls);
    expect(twice.value.iterationReceipts).toHaveLength(1);
    expect(twice.value.iterationLoops[0]).toMatchObject({ state: 'rework-queued', currentStepId: 'rework' });
    expect(twice.value.attempts.filter((attempt) => attempt.logicalGeneration === 2)).toEqual([
      expect.objectContaining({ state: 'queued', predecessorAttemptRef: expect.any(String) }),
    ]);
    expect(twice.value.stageGenerations).toHaveLength(1);
    expect(twice.value.generationSupersessions).toEqual([]);
  });

  it('does not re-advance an iteration receipt whose declared successor is already queued', async () => {
    const item = genericIterationFixture({ crashAfterIterationRequest: true, judgeVerdicts: ['fail'] });
    const input = { subject: 'operator', runRef: item.run.runRef, proposal: item.plan };
    await expect(item.engine.runToBoundary(input)).rejects.toThrow('simulated crash after generic iteration request persistence');
    const beforeTurn = item.store.getRun('operator', item.run.runRef);
    if (!beforeTurn.ok) throw new Error(beforeTurn.detail);
    const stage = beforeTurn.value.stages.find((candidate) => candidate.stageId === 'judge')!;
    const proposalStage = item.plan.stages.find((candidate) => candidate.id === 'judge')!;
    const runtime = item.engine as any;
    const prepared = runtime.prepareAttempt(input, stage, proposalStage, policy, null);
    expect(prepared).not.toBeNull();
    const advanceIterationTurn = item.store.advanceIterationTurn.bind(item.store);
    let advanceCrashArmed = true;
    item.store.advanceIterationTurn = ((...args: Parameters<ControlPlaneStore['advanceIterationTurn']>) => {
      if (advanceCrashArmed) {
        advanceCrashArmed = false;
        throw new Error('simulated crash after canonical iteration receipt persistence');
      }
      return advanceIterationTurn(...args);
    }) as ControlPlaneStore['advanceIterationTurn'];
    await expect(runtime.executeAttemptUnsafe(input, prepared, policy))
      .rejects.toThrow('simulated crash after canonical iteration receipt persistence');

    const restarted = new AutomaticExecutionEngine(engineOptions(item.store, item.fake)) as any;
    await expect(restarted.reconcileIterationRuntime(input)).resolves.toEqual([]);
    const advanced = item.store.getRun('operator', item.run.runRef);
    if (!advanced.ok) throw new Error(advanced.detail);
    const receipt = advanced.value.iterationReceipts[0]!;
    const loop = advanced.value.iterationLoops[0]!;
    const events = item.store.listEvents('operator', item.run.runRef);
    if (!events.ok) throw new Error(events.detail);

    expect(restarted.routeIterationReceipt(input, receipt)).toBe('succeeded');
    const reentered = item.store.getRun('operator', item.run.runRef);
    const reenteredEvents = item.store.listEvents('operator', item.run.runRef);
    expect(reentered).toMatchObject({ ok: true, value: {
      iterationLoops: [expect.objectContaining({ state: 'rework-queued', version: loop.version })],
      iterationReceipts: [expect.objectContaining({ receiptRef: receipt.receiptRef })],
    } });
    expect(reentered.ok && reentered.value.iterationReceipts).toHaveLength(1);
    expect(reentered.ok && reentered.value.attempts.filter((attempt) => attempt.logicalGeneration === 2)).toHaveLength(1);
    expect(reenteredEvents).toEqual(events);
  });

  it('keeps an iteration park gate open across a file-store restart without replaying it', async () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'kb-task8-iteration-gate-'));
    tempDirs.push(stateRoot);
    let ids = 0;
    const store = createFileControlPlaneStore(stateRoot, { newId: () => `persistent-${++ids}` });
    const item = genericIterationFixture({
      plan: siblingIterationPlan(), store,
      turnVerdicts: {
        'a-review': 'fail', 'a-rework': 'fulfilled',
        'b-review': ['fail', 'pass'], 'b-rework': 'fulfilled',
      },
    });
    const input = { subject: 'operator', runRef: item.run.runRef, proposal: item.plan };
    await expect(item.engine.runToBoundary(input)).resolves.toMatchObject({ state: 'waiting-human' });
    const parked = store.getRun('operator', item.run.runRef);
    if (!parked.ok) throw new Error(parked.detail);
    const loop = parked.value.iterationLoops.find((candidate) => candidate.iterationGroupId === 'a-loop')!;
    expect(parked.value.iterationLoops.find((candidate) => candidate.iterationGroupId === 'b-loop'))
      .toMatchObject({ state: 'passed', cyclesUsed: 2 });
    const workerCalls = item.workerInputs.length;
    const receiptCount = parked.value.iterationReceipts.length;
    const supersessions = parked.value.generationSupersessions.length;

    const restartedStore = createFileControlPlaneStore(stateRoot, { newId: () => `persistent-${++ids}` });
    const restarted = new AutomaticExecutionEngine(engineOptions(restartedStore, item.fake));
    await expect(restarted.runToBoundary(input)).resolves.toMatchObject({ state: 'waiting-human' });
    const recovered = restartedStore.getRun('operator', item.run.runRef);
    if (!recovered.ok) throw new Error(recovered.detail);
    expect(recovered.value.run.lifecycle.kind).toBe('waiting-human');
    expect(recovered.value.iterationLoops.find((candidate) => candidate.iterationGroupId === 'a-loop'))
      .toMatchObject({ state: 'awaiting-park-gate', version: loop.version });
    expect(recovered.value.iterationLoops.find((candidate) => candidate.iterationGroupId === 'b-loop'))
      .toMatchObject({ state: 'passed', cyclesUsed: 2 });
    expect(recovered.value.humanRequests.filter((request) => request.gateKind === 'iteration-park' && request.state === 'open')).toHaveLength(1);
    expect(recovered.value.iterationReceipts).toHaveLength(receiptCount);
    expect(recovered.value.generationSupersessions).toHaveLength(supersessions);
    expect(item.workerInputs).toHaveLength(workerCalls);
  });

  it('replays an already integrated turn by operation key without a second worker call', async () => {
    const item = genericIterationFixture({ crashAfterIntegrationStage: 'judge' });
    const outcome = await item.engine.runToBoundary({ subject: 'operator', runRef: item.run.runRef, proposal: item.plan });
    expect(outcome.state).toBe('succeeded');
    expect(item.workerInputs.filter((worker) => worker.proposalStage?.id === 'judge')).toHaveLength(1);
    expect(item.integrations.filter((record) => record.stageId === 'judge')).toHaveLength(1);
    const detail = item.store.getRun('operator', item.run.runRef);
    expect(detail.ok && detail.value.iterationReceipts).toHaveLength(1);
    const workersBeforeRestart = item.workerInputs.length;
    const integrationsBeforeRestart = item.integrations.length;
    const restarted = new AutomaticExecutionEngine(engineOptions(item.store, item.fake)) as unknown as {
      reconcileIterationRuntime(input: { subject: string; runRef: string; proposal: PlanProposal }): Promise<string[]>;
    };
    await expect(restarted.reconcileIterationRuntime({ subject: 'operator', runRef: item.run.runRef, proposal: item.plan }))
      .resolves.toEqual([]);
    expect(item.workerInputs).toHaveLength(workersBeforeRestart);
    expect(item.integrations).toHaveLength(integrationsBeforeRestart);
  });

  it('keeps canonical operation keys collision-free across cycles for the same stage', async () => {
    const item = genericIterationFixture({ judgeVerdicts: ['fail', 'pass'] });
    await item.engine.runToBoundary({ subject: 'operator', runRef: item.run.runRef, proposal: item.plan });
    const detail = item.store.getRun('operator', item.run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    const judgeRequests = detail.value.iterationRequests.filter((request) => request.recipientParticipantId === 'judge');
    expect(item.integrations.filter((record) => record.stageId === 'judge').map((record) => record.operationKey))
      .toEqual(judgeRequests.map((request) => `iteration-result:${item.run.runRef}:judge:${request.requestRef}`));
    expect(new Set(item.integrations.map((record) => record.operationKey)).size).toBe(item.integrations.length);
  });

  it('runs a coordinator crew delegate rework and check route at its declared cycle boundary', async () => {
    const item = genericIterationFixture({
      plan: coordinatorCrewIterationPlan(),
      turnVerdicts: { delegate: 'fulfilled', coordinate: 'fail', rework: 'fulfilled', check: 'fail', complete: 'complete' },
    });
    await expect(item.engine.runToBoundary({ subject: 'operator', runRef: item.run.runRef, proposal: item.plan }))
      .resolves.toMatchObject({ state: 'succeeded' });
    const detail = item.store.getRun('operator', item.run.runRef);
    expect(detail.ok && detail.value.iterationRequests.map((request) => [request.stepId, request.kind, request.cycle]))
      .toEqual([['delegate', 'delegate', 1], ['coordinate', 'review', 1], ['rework', 'rework', 1], ['check', 'check', 2], ['complete', 'review', 2]]);
    expect(detail.ok && detail.value.iterationLoops[0]).toMatchObject({ state: 'passed', cyclesUsed: 2 });
    const specialistKeys = item.integrations.filter((record) => record.stageId === 'specialist').map((record) => record.operationKey);
    expect(new Set(specialistKeys).size).toBe(3);
  });

  it('keys a producing turn and the next mixed-kind turn by distinct durable request refs', async () => {
    const item = genericIterationFixture({
      plan: mixedKindIterationPlan(),
      turnVerdicts: { review: 'fail', rework: 'fulfilled', check: 'pass' },
    });
    await expect(item.engine.runToBoundary({ subject: 'operator', runRef: item.run.runRef, proposal: item.plan }))
      .resolves.toMatchObject({ state: 'succeeded' });
    const detail = item.store.getRun('operator', item.run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    const producerRequests = detail.value.iterationRequests.filter((request) => request.recipientParticipantId === 'producer');
    const producerKeys = item.integrations.filter((record) => record.stageId === 'producer' && record.iterationContract)
      .map((record) => record.operationKey);
    expect(producerKeys).toEqual(producerRequests.map((request) =>
      `iteration-result:${item.run.runRef}:producer:${request.requestRef}`));
    expect(new Set(producerKeys).size).toBe(2);
    expect(item.workerInputs.filter((worker) => worker.proposalStage?.id === 'producer' && worker.iterationContract)).toHaveLength(2);
  });

  it('never releases a downstream DAG stage from a nonterminal iteration verdict', async () => {
    const item = genericIterationFixture({ judgeVerdicts: ['fail', 'pass'], stopBeforeJudgeTurn: 2 });
    const outcome = await item.engine.runToBoundary({ subject: 'operator', runRef: item.run.runRef, proposal: item.plan });
    expect(outcome.state).toBe('waiting-human');
    const detail = item.store.getRun('operator', item.run.runRef);
    expect(detail.ok && detail.value.iterationReceipts.map((receipt) => receipt.verdict)).toEqual(['fail', 'fulfilled']);
    expect(detail.ok && detail.value.stages.find((candidate) => candidate.stageId === 'release')?.state).toBe('blocked');
    expect(item.fake.executionOrder).not.toContain('release');
  });

  it('acknowledges Manager startup only after durable Manager session and run state are running', async () => {
    const store = createStore();
    const plan = proposal([stage('manager-start-ack')]);
    const run = createApprovedRun(store, plan);
    const observed: Array<{ runState: string; managerState: string | undefined }> = [];
    const engine = new AutomaticExecutionEngine(engineOptions(store, fakes()));
    await engine.runToBoundary({
      subject: 'operator',
      runRef: run.runRef,
      proposal: plan,
      onManagerStarted: () => {
        const detail = store.getRun('operator', run.runRef);
        if (!detail.ok) throw new Error(detail.detail);
        observed.push({
          runState: detail.value.run.lifecycle.kind,
          managerState: detail.value.sessions.find((session) =>
            session.sessionRef === detail.value.run.managerSessionRef)?.state,
        });
      },
    });
    expect(observed).toEqual([{ runState: 'running', managerState: 'running' }]);
  });

  it('reserves every attempt against the PER-ATTEMPT budget, never the window budget', async () => {
    const store = createStore();
    const plan = proposal([stage('reserve-first'), stage('reserve-second', ['reserve-first'])]);
    const run = createApprovedRun(store, plan);
    const fake = fakes();
    const options = engineOptions(store, fake);
    await new AutomaticExecutionEngine(options).runToBoundary({
      subject: 'operator', runRef: run.runRef, proposal: plan,
    });
    expect(fake.executionOrder).toEqual(['reserve-first', 'reserve-second']);
    // Both reservations carry the attempt limits. Reserving the window ceiling instead is the live
    // multi-stage defect: the adapter would project the whole window against itself on stage two.
    expect(fake.reservationLimits).toEqual([options.attemptBudget, options.attemptBudget]);
    expect(fake.reservationLimits).not.toContainEqual(options.budget);
  });

  it('releases the accounting hold at its ceiling when a settlement is REFUSED, so the window keeps admitting work', async () => {
    const store = createStore();
    const plan = proposal([stage('settlement-overage')]);
    const run = createApprovedRun(store, plan);
    const fake = fakes();
    const options = engineOptions(store, fake);
    const ledger = windowAccounting(options.budget);
    options.accounting = ledger.adapter;
    options.workers = workerAdapter({
      // Reports more input tokens than this attempt reserved (cache-read tokens accumulate across a long
      // multi-turn session), so the accounting adapter refuses the settlement.
      async execute() {
        return {
          state: 'succeeded',
          summary: 'over the reserved ceiling',
          usage: { inputTokens: options.attemptBudget.maxInputTokens + 1, outputTokens: 5, costUsdMicros: 100 },
          artifacts: [], checkpoints: [],
        };
      },
    });
    await expect(new AutomaticExecutionEngine(options).runToBoundary({
      subject: 'operator', runRef: run.runRef, proposal: plan,
    })).resolves.toMatchObject({ state: 'waiting-human' });

    // Existing behaviour is unchanged: the attempt parks for a human with the overage as the prompt.
    const detail = store.getRun('operator', run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    expect(detail.value.run.lifecycle.kind).toBe('waiting-human');
    expect(detail.value.humanRequests.some((request) =>
      request.kind === 'intervention' && request.prompt.includes('settlement exceeds its reserved limits'))).toBe(true);

    // The reservation is terminal at its reserved ceiling — never left active holding the whole limit
    // (and, at maxConcurrency 1, the window's only slot) for the rest of the window.
    expect(ledger.records).toEqual([{
      reservationRef: expect.any(String),
      limits: options.attemptBudget,
      state: 'settled',
      usage: {
        inputTokens: options.attemptBudget.maxInputTokens,
        outputTokens: options.attemptBudget.maxOutputTokens,
        costUsdMicros: options.attemptBudget.maxCostUsdMicros,
      },
    }]);
    // So the same window still admits the next attempt.
    await expect(ledger.adapter.reserve({
      operationKey: 'reserve:after-overage', subject: 'operator', runRef: run.runRef,
      attemptRef: 'attempt-after-overage', limits: options.attemptBudget,
    })).resolves.toMatchObject({ ok: true });
  });

  it('contains failed Manager startup without terminalizing the resumable run or stage graph', async () => {
    const store = createStore();
    const plan = proposal([stage('manager-start-containment')]);
    const run = createApprovedRun(store, plan);
    const initial = store.getRun('operator', run.runRef);
    if (!initial.ok) throw new Error(initial.detail);
    const manager = initial.value.sessions.find((session) => session.sessionRef === initial.value.run.managerSessionRef);
    if (!manager) throw new Error('manager session missing');
    const starting = store.transitionSession('operator', manager.sessionRef, manager.version, 'starting');
    if (!starting.ok) throw new Error(starting.detail);
    const runningManager = store.transitionSession('operator', manager.sessionRef, starting.value.version, 'running');
    if (!runningManager.ok) throw new Error(runningManager.detail);
    const runningRun = store.transitionRun('operator', run.runRef, initial.value.run.version, 'running');
    if (!runningRun.ok) throw new Error(runningRun.detail);
    const waitingRun = store.transitionRun('operator', run.runRef, runningRun.value.version, 'waiting-human');
    if (!waitingRun.ok) throw new Error(waitingRun.detail);
    const fake = fakes();
    const cancelManager = vi.fn(async () => {});
    fake.cancellation.cancelManager = cancelManager;
    const engine = new AutomaticExecutionEngine(engineOptions(store, fake));
    await engine.containManagerStart({
      subject: 'operator', runRef: run.runRef, idempotencyKey: 'contain-manager-start-test',
    });
    expect(cancelManager).toHaveBeenCalledTimes(1);
    expect(store.getRun('operator', run.runRef)).toMatchObject({
      ok: true,
      value: {
        run: { lifecycle: { kind: 'waiting-human', deployPause: null } },
        stages: [expect.objectContaining({ state: 'ready' })],
        sessions: [expect.objectContaining({ role: 'manager', state: 'interrupted' })],
      },
    });
  });

  it('durably fences Manager startup before a hung adapter cancellation can race its completion', async () => {
    const store = createStore();
    const plan = proposal([stage('manager-start-crossing')]);
    const run = createApprovedRun(store, plan);
    const initial = store.getRun('operator', run.runRef);
    if (!initial.ok) throw new Error(initial.detail);
    const recovering = store.transitionRun('operator', run.runRef, initial.value.run.version, 'recovering');
    if (!recovering.ok) throw new Error(recovering.detail);
    let managerEntered!: () => void;
    let releaseManager!: () => void;
    let cancellationEntered!: () => void;
    let releaseCancellation!: () => void;
    const managerStarted = new Promise<void>((resolve) => { managerEntered = resolve; });
    const managerHeld = new Promise<void>((resolve) => { releaseManager = resolve; });
    const cancellationStarted = new Promise<void>((resolve) => { cancellationEntered = resolve; });
    const cancellationHeld = new Promise<void>((resolve) => { releaseCancellation = resolve; });
    const fake = fakes();
    fake.managers.ensure = async () => {
      managerEntered();
      await managerHeld;
    };
    fake.cancellation.cancelManager = async () => {
      cancellationEntered();
      await cancellationHeld;
    };
    const acknowledged = vi.fn();
    const engine = new AutomaticExecutionEngine(engineOptions(store, fake));
    const execution = engine.runToBoundary({
      subject: 'operator', runRef: run.runRef, proposal: plan, onManagerStarted: acknowledged,
    });
    await managerStarted;
    const beforeContainment = store.getRun('operator', run.runRef);
    if (!beforeContainment.ok) throw new Error(beforeContainment.detail);
    const waiting = store.transitionRun(
      'operator', run.runRef, beforeContainment.value.run.version, 'waiting-human',
    );
    if (!waiting.ok) throw new Error(waiting.detail);
    const containment = engine.containManagerStart({
      subject: 'operator', runRef: run.runRef, idempotencyKey: 'contain-crossing',
    });
    await cancellationStarted;
    expect(store.getRun('operator', run.runRef)).toMatchObject({
      ok: true,
      value: {
        run: { lifecycle: { kind: 'waiting-human', deployPause: null } },
        stages: [expect.objectContaining({ state: 'ready' })],
        sessions: [expect.objectContaining({ role: 'manager', state: 'interrupted' })],
      },
    });
    releaseManager();
    await expect(execution).resolves.toMatchObject({ state: 'waiting-human' });
    expect(acknowledged).not.toHaveBeenCalled();
    releaseCancellation();
    await containment;
    expect(store.getRun('operator', run.runRef)).toMatchObject({
      ok: true,
      value: {
        run: { lifecycle: { kind: 'waiting-human', deployPause: null } },
        stages: [expect.objectContaining({ state: 'ready' })],
        sessions: [expect.objectContaining({ role: 'manager', state: 'interrupted' })],
      },
    });
  });


  it('rejects a stored/proposal assignment mismatch before invoking an assigned-agent resolver', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kb-assignment-binding-'));
    tempDirs.push(root);
    const store = createFileControlPlaneStore(root, { newId: () => `id-${++sequence}` });
    const managerAssignment = {
      agentId: 'fyt-manager', declarationPath: 'agents/fyt-manager.md', declarationHash: 'a'.repeat(64),
      profileId: 'manager-claude', runtime: 'claude' as const, model: 'claude-opus',
    };
    const workerAssignment = {
      agentId: 'fyt-worker', declarationPath: 'agents/fyt-worker.md', declarationHash: 'b'.repeat(64),
      profileId: 'worker-codex', runtime: 'codex' as const, model: 'codex-safe',
    };
    const plan = {
      ...proposal([{ ...stage('assigned-binding'), assignment: workerAssignment }]),
      manager: { ...proposal([]).manager, assignment: managerAssignment },
    };
    const run = createApprovedRun(store, plan);
    const path = join(root, 'control', 'control-plane.json');
    const persisted = JSON.parse(readFileSync(path, 'utf8')) as { runs: Array<{ managerAssignment: { declarationHash: string } }> };
    persisted.runs[0].managerAssignment.declarationHash = 'c'.repeat(64);
    writeFileSync(path, `${JSON.stringify(persisted)}\n`, 'utf8');
    const resolver = { resolve: vi.fn() };
    const fake = fakes();
    const options = engineOptions(createFileControlPlaneStore(root), fake);
    options.assignedAgents = resolver;
    await expect(new AutomaticExecutionEngine(options).runToBoundary({ subject: 'operator', runRef: run.runRef, proposal: plan }))
      .rejects.toThrow(/manager assignment differs/);
    expect(resolver.resolve).not.toHaveBeenCalled();
  });

  it('passes only server-resolved assignment instructions to the manager and worker adapters', async () => {
    const store = createStore();
    const managerAssignment = {
      agentId: 'fyt-manager', declarationPath: 'agents/fyt-manager.md', declarationHash: 'a'.repeat(64),
      profileId: 'manager-claude', runtime: 'claude' as const, model: 'claude-opus',
    };
    const workerAssignment = {
      agentId: 'fyt-worker', declarationPath: 'agents/fyt-worker.md', declarationHash: 'b'.repeat(64),
      profileId: 'worker-codex', runtime: 'codex' as const, model: 'codex-safe',
    };
    const plan = {
      ...proposal([{ ...stage('assigned-pass'), assignment: workerAssignment }]),
      manager: { ...proposal([]).manager, assignment: managerAssignment },
    };
    const run = createApprovedRun(store, plan);
    const fake = fakes();
    const workerExecute = vi.fn(fake.workers.execute);
    fake.workers.execute = workerExecute;
    const managerEnsure = vi.fn(async () => {});
    fake.managers.ensure = managerEnsure;
    const resolver = {
      resolve: vi.fn((input: { assignment: typeof managerAssignment | typeof workerAssignment }) => ({
        assignment: input.assignment, instructionMarkdown: `# ${input.assignment.agentId}\nNo publication.`,
      })),
    };
    const options = engineOptions(store, fake);
    options.assignedAgents = resolver;
    await expect(new AutomaticExecutionEngine(options).runToBoundary({ subject: 'operator', runRef: run.runRef, proposal: plan })).resolves
      .toMatchObject({ state: 'succeeded' });
    expect(managerEnsure).toHaveBeenCalledWith(expect.objectContaining({
      assignment: managerAssignment, instructionMarkdown: '# fyt-manager\nNo publication.',
    }));
    expect(workerExecute).toHaveBeenCalledWith(expect.objectContaining({
      assignment: workerAssignment, instructionMarkdown: '# fyt-worker\nNo publication.',
    }));
    expect(resolver.resolve).toHaveBeenCalledTimes(2);
  });

  it('resolves every assigned node once before a stage policy boundary can mutate the store', async () => {
    const store = createStore();
    const managerAssignment = {
      agentId: 'fyt-manager', declarationPath: 'agents/fyt-manager.md', declarationHash: 'a'.repeat(64),
      profileId: 'manager-claude', runtime: 'claude' as const, model: 'claude-opus',
    };
    const workerAssignment = {
      agentId: 'fyt-worker', declarationPath: 'agents/fyt-worker.md', declarationHash: 'b'.repeat(64),
      profileId: 'worker-codex', runtime: 'codex' as const, model: 'codex-safe',
    };
    const plan = {
      ...proposal([
        { ...stage('boundary-a'), action: 'publish:external', assignment: workerAssignment },
        { ...stage('boundary-b', ['boundary-a']), assignment: workerAssignment },
      ]),
      manager: { ...proposal([]).manager, assignment: managerAssignment },
    };
    const run = createApprovedRun(store, plan);
    const order: string[] = [];
    const originalCreateRequest = store.createHumanRequest.bind(store);
    store.createHumanRequest = ((...args: Parameters<ControlPlaneStore['createHumanRequest']>) => {
      order.push('boundary');
      return originalCreateRequest(...args);
    }) as ControlPlaneStore['createHumanRequest'];
    const resolver = {
      resolve: vi.fn((input: { assignment: typeof managerAssignment | typeof workerAssignment }) => {
        order.push(`resolve:${input.assignment.agentId}`);
        return { assignment: input.assignment, instructionMarkdown: '# Bound declaration' };
      }),
    };
    const fake = fakes();
    const options = engineOptions(store, fake);
    options.assignedAgents = resolver;
    await expect(new AutomaticExecutionEngine(options).runToBoundary({ subject: 'operator', runRef: run.runRef, proposal: plan })).resolves
      .toMatchObject({ state: 'waiting-human' });
    expect(resolver.resolve).toHaveBeenCalledTimes(3);
    expect(order.slice(0, 3)).toEqual(['resolve:fyt-manager', 'resolve:fyt-worker', 'resolve:fyt-worker']);
    expect(order.indexOf('boundary')).toBeGreaterThan(2);
  });

  it('keeps the held Wave-A kb-ops policy when no per-project resolver is supplied', async () => {
    const store = createStore();
    const plan = proposal([stage('held-policy')]);
    const run = createApprovedRun(store, plan);
    const fake = fakes();
    const options = engineOptions(store, fake);
    const outcome = await new AutomaticExecutionEngine(options).runToBoundary({ subject: 'operator', runRef: run.runRef, proposal: plan });
    expect(outcome.state).toBe('succeeded');
  });

  it('proves the immutable proposal and graph binding before resolving a forged project policy', async () => {
    const store = createStore();
    const approved = proposal([stage('approved-kb-ops')]);
    const run = createApprovedRun(store, approved);
    const fake = fakes();
    const options = engineOptions(store, fake);
    const resolver = vi.fn(() => fytPolicy(['tests']));
    options.resolvePolicy = resolver;
    options.policyProject = 'kb-ops';

    // The FYT proposal is individually policy-safe, but it is not the immutable proposal attached to this
    // kb-ops run. It must not cause even a read of the FYT policy environment.
    await expect(new AutomaticExecutionEngine(options).runToBoundary({
      subject: 'operator', runRef: run.runRef, proposal: fytProposal(['tests']),
    })).rejects.toThrow('proposal does not match the immutable run hash');
    expect(resolver).not.toHaveBeenCalled();
    expect(fake.executionOrder).toEqual([]);
  });

  it('resolves one FYT policy snapshot and refuses a stage that only the held kb-ops curated set would allow', async () => {
    const store = createStore();
    const plan = fytProposal(['tests']);
    const run = createApprovedRun(store, plan);
    const fake = fakes();
    const options = engineOptions(store, fake);
    const resolver = vi.fn()
      .mockReturnValueOnce(fytPolicy([]))
      .mockReturnValueOnce(policy);
    options.resolvePolicy = resolver;
    options.policyProject = 'kb-ops';
    const outcome = await new AutomaticExecutionEngine(options).runToBoundary({ subject: 'operator', runRef: run.runRef, proposal: plan });
    expect(outcome.state).toBe('waiting-human');
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(resolver).toHaveBeenCalledWith('faceless-youtube');
    expect(fake.executionOrder).toEqual([]);
    const detail = store.getRun('operator', run.runRef);
    expect(detail.ok && detail.value.humanRequests.some((request) => request.prompt.includes('skill-not-curated:tests'))).toBe(true);
  });

  it('loads a fresh FYT policy for each run boundary, so a later policy change is observed', async () => {
    const store = createStore();
    const firstPlan = fytProposal(['tests']);
    const secondPlan = { ...fytProposal(['tests']), proposalId: 'synthetic-fyt-second' };
    const firstRun = createApprovedRun(store, firstPlan);
    const secondRun = createApprovedRun(store, secondPlan);
    const fake = fakes();
    fake.worktrees.inspect = async () => ({
      changed: [{ path: 'orgs/faceless-youtube/output/fyt.txt', digest: 'b'.repeat(64) }],
    });
    const options = engineOptions(store, fake);
    const resolver = vi.fn()
      .mockReturnValueOnce(fytPolicy(['tests']))
      .mockReturnValueOnce(fytPolicy([]));
    options.resolvePolicy = resolver;
    options.policyProject = 'kb-ops';
    const engine = new AutomaticExecutionEngine(options);

    await expect(engine.runToBoundary({ subject: 'operator', runRef: firstRun.runRef, proposal: firstPlan }))
      .resolves.toMatchObject({ state: 'succeeded' });
    await expect(engine.runToBoundary({ subject: 'operator', runRef: secondRun.runRef, proposal: secondPlan }))
      .resolves.toMatchObject({ state: 'waiting-human', waitingStageIds: ['fyt'] });
    expect(resolver).toHaveBeenCalledTimes(2);
    expect(resolver).toHaveBeenNthCalledWith(1, 'faceless-youtube');
    expect(resolver).toHaveBeenNthCalledWith(2, 'faceless-youtube');
  });

  it('snapshots a resolved policy before asynchronous manager work, isolating in-flight source mutation', async () => {
    const store = createStore();
    const plan = fytProposal(['tests']);
    const run = createApprovedRun(store, plan);
    const fake = fakes();
    fake.worktrees.inspect = async () => ({
      changed: [{ path: 'orgs/faceless-youtube/output/fyt.txt', digest: 'b'.repeat(64) }],
    });
    const source = fytPolicy(['tests']);
    fake.managers.ensure = async () => {
      source.curatedSkills.clear();
    };
    const options = engineOptions(store, fake);
    options.resolvePolicy = () => source;
    options.policyProject = 'kb-ops';

    await expect(new AutomaticExecutionEngine(options).runToBoundary({ subject: 'operator', runRef: run.runRef, proposal: plan }))
      .resolves.toMatchObject({ state: 'succeeded', completedStageIds: ['fyt'] });
    expect(fake.executionOrder).toEqual(['fyt']);
  });

  it('uses the FYT policy snapshot for manager profile admission before any stage can start', async () => {
    const store = createStore();
    const plan = fytProposal([]);
    const run = createApprovedRun(store, plan);
    const fake = fakes();
    const options = engineOptions(store, fake);
    options.resolvePolicy = () => ({ ...fytPolicy([]), profiles: fytPolicy([]).profiles.filter((profile) => profile.role !== 'manager') });
    await expect(new AutomaticExecutionEngine(options).runToBoundary({ subject: 'operator', runRef: run.runRef, proposal: plan }))
      .rejects.toThrow('manager is not a server-owned runtime profile');
    expect(fake.executionOrder).toEqual([]);
  });

  it('fails closed when the project resolver returns missing canonical policy anchors', async () => {
    const store = createStore();
    const plan = fytProposal([]);
    const run = createApprovedRun(store, plan);
    const fake = fakes();
    const options = engineOptions(store, fake);
    options.resolvePolicy = () => policy; // kb-ops environment, intentionally wrong for FYT
    await expect(new AutomaticExecutionEngine(options).runToBoundary({ subject: 'operator', runRef: run.runRef, proposal: plan }))
      .rejects.toThrow('project policy environment is incomplete');
    expect(fake.executionOrder).toEqual([]);
  });

  it('surfaces a resolver failure without starting a manager or worker', async () => {
    const store = createStore();
    const plan = fytProposal([]);
    const run = createApprovedRun(store, plan);
    const fake = fakes();
    const options = engineOptions(store, fake);
    options.resolvePolicy = () => { throw new Error('canonical policy read failed'); };

    await expect(new AutomaticExecutionEngine(options).runToBoundary({ subject: 'operator', runRef: run.runRef, proposal: plan }))
      .rejects.toThrow('project policy resolution failed: canonical policy read failed');
    expect(fake.executionOrder).toEqual([]);
  });

  it('refuses a different project when no server-owned policy resolver is configured', async () => {
    const store = createStore();
    const plan = fytProposal([]);
    const run = createApprovedRun(store, plan);
    const fake = fakes();

    await expect(new AutomaticExecutionEngine(engineOptions(store, fake)).runToBoundary({
      subject: 'operator', runRef: run.runRef, proposal: plan,
    })).rejects.toThrow('project policy resolver is required for this proposal project');
    expect(fake.executionOrder).toEqual([]);
  });

  it('executes a durable validated reroute without rewriting the approved stage policy or predecessor routing', async () => {
    const store = createStore();
    const plan = proposal([stage('rerouted')]);
    const run = createApprovedRun(store, plan);
    let detail = store.getRun('operator', run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    const publishing = store.transitionPublication('operator', run.runRef, detail.value.run.version, 'publishing');
    if (!publishing.ok) throw new Error(publishing.detail);
    const published = store.transitionPublication('operator', run.runRef, publishing.value.version, 'published');
    if (!published.ok) throw new Error(published.detail);
    detail = store.getRun('operator', run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    const sourceStage = detail.value.stages[0];
    const original = store.createAttempt('operator', sourceStage.stageRef, {
      expectedStageVersion: sourceStage.version, runtime: 'codex', model: 'codex-safe',
    });
    if (!original.ok) throw new Error(original.detail);
    const originalSession = store.createWorkerSession('operator', original.value.attemptRef, {
      expectedAttemptVersion: original.value.version,
    });
    if (!originalSession.ok) throw new Error(originalSession.detail);
    detail = store.getRun('operator', run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    const currentStage = detail.value.stages[0];
    const currentAttempt = detail.value.attempts.find((item) => item.attemptRef === original.value.attemptRef);
    if (!currentAttempt) throw new Error('attempt missing');
    const rerouted = store.rerouteStage('operator', currentStage.stageRef, {
      expectedStageVersion: currentStage.version,
      expectedAttemptRef: currentAttempt.attemptRef,
      expectedAttemptVersion: currentAttempt.version,
      runtime: 'claude', model: 'claude-sonnet', idempotencyKey: 'reroute-engine-1',
    });
    if (!rerouted.ok) throw new Error(rerouted.detail);
    const fake = fakes();
    fake.workers = {
      async execute(input) {
        expect(input.profile).toMatchObject({ id: 'worker-claude', runtime: 'claude', model: 'claude-sonnet' });
        expect(input.action).toBe('test:rerouted');
        expect(input.skills).toEqual(['tests']);
        fake.executionOrder.push('rerouted');
        return {
          state: 'succeeded', summary: 'rerouted passed', usage: { inputTokens: 2, outputTokens: 1, costUsdMicros: 3 },
          artifacts: [{ path: 'dashboard/server/rerouted.txt', digest: 'b'.repeat(64) }], checkpoints: ['rerouted-checked'],
        };
      },
    };
    const outcome = await new AutomaticExecutionEngine(engineOptions(store, fake)).runToBoundary({
      subject: 'operator', runRef: run.runRef, proposal: plan,
    });
    expect(outcome).toMatchObject({ state: 'succeeded', completedStageIds: ['rerouted'] });
    const after = store.getRun('operator', run.runRef);
    expect(after).toMatchObject({
      ok: true,
      value: {
        attempts: expect.arrayContaining([
          expect.objectContaining({ attemptRef: original.value.attemptRef, runtime: 'codex', model: 'codex-safe', state: 'stopped' }),
          expect.objectContaining({ attemptRef: rerouted.value.attempt.attemptRef, runtime: 'claude', model: 'claude-sonnet', state: 'succeeded' }),
        ]),
        sessions: expect.arrayContaining([
          expect.objectContaining({ sessionRef: originalSession.value.sessionRef, state: 'stopped' }),
        ]),
      },
    });
  });

  it('runs a synthetic two-stage DAG and integrates canonical results before dependent release', async () => {
    const store = createStore();
    const plan = proposal([stage('compile'), stage('verify', ['compile'])]);
    const run = createApprovedRun(store, plan);
    const fake = fakes();
    fake.workers = {
      async execute(input) {
        const id = input.action.split(':')[1];
        if (id === 'verify') expect(fake.integrationOrder).toEqual(['compile']);
        fake.executionOrder.push(id);
        return {
          state: 'succeeded', summary: `${id} passed`, usage: { inputTokens: 2, outputTokens: 1, costUsdMicros: 3 },
          artifacts: [{ path: `dashboard/server/${id}.txt`, digest: 'b'.repeat(64) }], checkpoints: [`${id}-checked`],
        };
      },
    };
    const engine = new AutomaticExecutionEngine(engineOptions(store, fake));

    const outcome = await engine.runToBoundary({ subject: 'operator', runRef: run.runRef, proposal: plan });

    expect(outcome).toMatchObject({ state: 'succeeded', startedStageIds: ['compile', 'verify'], completedStageIds: ['compile', 'verify'] });
    expect(fake.executionOrder).toEqual(['compile', 'verify']);
    expect(fake.integrationOrder).toEqual(['compile', 'verify']);
    expect(new Set(fake.worktreePaths).size).toBe(2);
    expect(fake.worktreePaths.every((path) => path.includes(run.runRef))).toBe(true);
    const detail = store.getRun('operator', run.runRef);
    expect(detail.ok && detail.value.stages.every((item) => item.state === 'succeeded')).toBe(true);
    expect(detail.ok && detail.value.sessions.every((item) => ['completed', 'failed', 'stopped', 'interrupted'].includes(item.state))).toBe(true);
  });

  // ---------------------------------------------------------------------------------------------
  // The fail-closed workflow-profile token. `execution.ts` forwards `stage.workflowProfile ?? input.proposal.profile ?? null`
  // to the worker adapter, and that `?? null` is the WHOLE engine-side guarantee: the adapter refuses
  // to spawn on a null or unknown profile (claudeWorkerAdapter.ts), so a null is what makes a
  // profile-less legacy proposal refuse instead of running uncapped. Nothing asserted on it before —
  // changing the fallback to `?? 'producer'` (the profile granting Bash/Read/Write/Edit) left the
  // entire suite green, so a maintainer "fixing" profile-less refusals by defaulting the profile
  // would have shipped unrestricted Bash with the suite applauding. These two tests are that alarm.
  // ---------------------------------------------------------------------------------------------
  it('forwards NULL as the workflow profile for a profile-less proposal (never a default)', async () => {
    const store = createStore();
    const plan = proposal([stage('uncapped')]);
    expect(plan.profile).toBeUndefined(); // the legacy shape this guard exists for
    const run = createApprovedRun(store, plan);
    const fake = fakes();
    const seen: (string | null)[] = [];
    fake.workers = {
      async execute(input) {
        seen.push(input.workflowProfile);
        fake.executionOrder.push('uncapped');
        return {
          state: 'succeeded', summary: 'ok', usage: { inputTokens: 1, outputTokens: 1, costUsdMicros: 1 },
          artifacts: [{ path: 'dashboard/server/uncapped.txt', digest: 'b'.repeat(64) }],
          checkpoints: ['uncapped-checked'],
        };
      },
    };

    await new AutomaticExecutionEngine(engineOptions(store, fake)).runToBoundary({
      subject: 'operator', runRef: run.runRef, proposal: plan,
    });

    // Strictly null. A string here — ANY string, including a "sensible default" — is the regression
    // this test exists to catch; `undefined` would fail too, since the adapter contract is
    // `string | null` and only an explicit null reaches its refusal branch.
    expect(seen).toEqual([null]);
    expect(seen[0]).not.toBe(undefined);
    expect(typeof seen[0]).not.toBe('string');
  });

  it('forwards the declared workflow profile verbatim when the proposal declares one', async () => {
    const store = createStore();
    const plan: PlanProposal = { ...proposal([stage('capped')]), profile: 'research' };
    const run = createApprovedRun(store, plan);
    const fake = fakes();
    const seen: (string | null)[] = [];
    fake.workers = {
      async execute(input) {
        seen.push(input.workflowProfile);
        fake.executionOrder.push('capped');
        return {
          state: 'succeeded', summary: 'ok', usage: { inputTokens: 1, outputTokens: 1, costUsdMicros: 1 },
          artifacts: [{ path: 'dashboard/server/capped.txt', digest: 'b'.repeat(64) }],
          checkpoints: ['capped-checked'],
        };
      },
    };

    await new AutomaticExecutionEngine(engineOptions(store, fake)).runToBoundary({
      subject: 'operator', runRef: run.runRef, proposal: plan,
    });

    // Verbatim: the engine must neither substitute nor widen the declared profile.
    expect(seen).toEqual(['research']);
  });


  it('prefers a server-compiled per-stage workflow profile over the proposal profile', async () => {
    const store = createStore();
    const capped = stage('checker-cap');
    capped.workflowProfile = 'checker-readonly';
    const plan: PlanProposal = { ...proposal([capped]), profile: 'research' };
    const run = createApprovedRun(store, plan);
    const fake = fakes();
    const seen: (string | null)[] = [];
    fake.workers = {
      async execute(input) {
        seen.push(input.workflowProfile);
        fake.executionOrder.push('checker-cap');
        return {
          state: 'succeeded', summary: 'ok', usage: { inputTokens: 1, outputTokens: 1, costUsdMicros: 1 },
          artifacts: [{ path: 'dashboard/server/checker-cap.txt', digest: 'b'.repeat(64) }], checkpoints: ['checker-cap-checked'],
        };
      },
    };

    await new AutomaticExecutionEngine(engineOptions(store, fake)).runToBoundary({
      subject: 'operator', runRef: run.runRef, proposal: plan,
    });

    expect(seen).toEqual(['checker-readonly']);
  });












  it('releases equal-priority roots deterministically while honoring bounded concurrency', async () => {
    const store = createStore();
    const plan = proposal([stage('b'), stage('a'), stage('c', ['a'])]);
    const run = createApprovedRun(store, plan);
    const fake = fakes();
    const options = engineOptions(store, fake);
    // This assertion is deliberately about a total release order, and the basic fake correlates
    // inspection with the most recently entered worker. Keep this one scheduling-order probe serial.
    options.maxConcurrency = 1;
    const engine = new AutomaticExecutionEngine(options);

    await engine.runToBoundary({ subject: 'operator', runRef: run.runRef, proposal: plan });

    expect(fake.executionOrder).toEqual(['a', 'b', 'c']);
  });

  it('persists explicit human gates and releases only after a revision-bound response', async () => {
    const store = createStore();
    const gated = stage('review');
    gated.humanGates = [{ id: 'approval', kind: 'approval', prompt: 'Approve the synthetic stage.' }];
    const plan = proposal([gated]);
    const run = createApprovedRun(store, plan);
    const fake = fakes();
    const engine = new AutomaticExecutionEngine(engineOptions(store, fake));

    const waiting = await engine.runToBoundary({ subject: 'operator', runRef: run.runRef, proposal: plan });
    expect(waiting.state).toBe('waiting-human');
    expect(fake.executionOrder).toEqual([]);
    const detail = store.getRun('operator', run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    expect(detail.value.humanRequests).toHaveLength(1);
    const request = detail.value.humanRequests[0];
    const response = store.respondHumanRequest('operator', request.requestRef, {
      expectedRevision: request.revision,
      decision: 'approved',
      idempotencyKey: 'gate-response',
      response: 'Approved.',
    });
    expect(response.ok).toBe(true);

    const completed = await engine.runToBoundary({ subject: 'operator', runRef: run.runRef, proposal: plan });
    expect(completed.state).toBe('succeeded');
    expect(fake.executionOrder).toEqual(['review']);
    expect(store.getRun('operator', run.runRef)).toMatchObject({ ok: true, value: { humanRequests: [{ state: 'resolved' }] } });
  });

  it('halts the whole run when a generic gate opens even if an independent sibling stage is ready', async () => {
    const store = createStore();
    const gated = stage('a-gated');
    gated.humanGates = [{ id: 'approval', kind: 'approval', prompt: 'Approve the gated stage.' }];
    const sibling = stage('b-sibling');
    const plan = proposal([gated, sibling]);
    const run = createApprovedRun(store, plan);
    const fake = fakes();
    const options = engineOptions(store, fake);
    options.maxConcurrency = 2;
    const engine = new AutomaticExecutionEngine(options);

    await expect(engine.runToBoundary({ subject: 'operator', runRef: run.runRef, proposal: plan }))
      .resolves.toMatchObject({ state: 'waiting-human' });

    expect(fake.executionOrder).toEqual([]);
    expect(store.getRun('operator', run.runRef)).toMatchObject({ ok: true, value: {
      run: { lifecycle: { kind: 'waiting-human', deployPause: null } },
      stages: expect.arrayContaining([
        expect.objectContaining({ stageId: 'a-gated', state: 'waiting-human' }),
        expect.objectContaining({ stageId: 'b-sibling', state: 'ready' }),
      ]),
      humanRequests: [expect.objectContaining({ kind: 'approval', state: 'open' })],
    } });
    const detail = store.getRun('operator', run.runRef);
    expect(detail.ok && detail.value.humanRequests[0]).not.toHaveProperty('gateKind');
  });

  it('does not claim run success when the Manager shutdown is unacknowledged', async () => {
    const store = createStore();
    const plan = proposal([stage('compile')]);
    const run = createApprovedRun(store, plan);
    const fake = fakes();
    fake.cancellation = {
      async cancelManager(input) {
        if (input.intent === 'run-complete') throw new Error('manager shutdown acknowledgement lost');
      },
      async cancelWorker() {},
    };
    const engine = new AutomaticExecutionEngine(engineOptions(store, fake));

    const outcome = await engine.runToBoundary({ subject: 'operator', runRef: run.runRef, proposal: plan });

    expect(outcome.state).toBe('waiting-human');
    expect(store.getRun('operator', run.runRef)).toMatchObject({
      ok: true,
      value: {
        run: { lifecycle: { kind: 'waiting-human', deployPause: null } },
        stages: [{ state: 'succeeded' }],
        sessions: expect.arrayContaining([expect.objectContaining({ role: 'manager', state: 'interrupted' })]),
        humanRequests: [{ kind: 'intervention', title: 'Manager shutdown needs intervention', state: 'open' }],
      },
    });
  });

  it('fails closed on accounting refusal without invoking a worker', async () => {
    const store = createStore();
    const plan = proposal([stage('expensive')]);
    const run = createApprovedRun(store, plan);
    const fake = fakes({
      accounting: {
        async reserve() { return { ok: false, reason: 'cost budget exhausted' }; },
        async settle() { throw new Error('must not settle'); },
      },
    });
    const engine = new AutomaticExecutionEngine(engineOptions(store, fake));

    const outcome = await engine.runToBoundary({ subject: 'operator', runRef: run.runRef, proposal: plan });

    expect(outcome.state).toBe('waiting-human');
    expect(fake.executionOrder).toEqual([]);
    expect(store.getRun('operator', run.runRef)).toMatchObject({
      ok: true,
      value: { attempts: [{ state: 'interrupted' }], humanRequests: [{ kind: 'intervention', state: 'open' }] },
    });
  });

  it('requires an approved decision for approval gates rather than treating a text response as approval', async () => {
    const store = createStore();
    const gated = stage('approve-only');
    gated.humanGates = [{ id: 'approval', kind: 'approval', prompt: 'Explicit approval required.' }];
    const plan = proposal([gated]);
    const run = createApprovedRun(store, plan);
    const fake = fakes();
    const engine = new AutomaticExecutionEngine(engineOptions(store, fake));
    await engine.runToBoundary({ subject: 'operator', runRef: run.runRef, proposal: plan });
    const detail = store.getRun('operator', run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    const request = detail.value.humanRequests[0];
    expect(store.respondHumanRequest('operator', request.requestRef, {
      expectedRevision: request.revision, decision: 'responded', idempotencyKey: 'text-only', response: 'Looks fine.',
    }).ok).toBe(true);

    const outcome = await engine.runToBoundary({ subject: 'operator', runRef: run.runRef, proposal: plan });

    expect(outcome.state).toBe('waiting-human');
    expect(fake.executionOrder).toEqual([]);
  });

  it('never lets an unrelated gate approval satisfy a declared spend authorization', async () => {
    const store = createStore();
    const plain = stage('plain');
    plain.humanGates = [{ id: 'g1-script', kind: 'approval', prompt: 'Approve the script.' }];
    const spending = stage('spending', ['plain']);
    spending.humanGates = [{ id: 'g2-plan', kind: 'approval', prompt: 'Approve the plan.', spendAuthorization: true }];
    const plan = proposal([plain, spending]);
    const run = createApprovedRun(store, plan);
    const fake = fakes();
    const engine = new AutomaticExecutionEngine(engineOptions(store, fake));

    const approve = (title: string, key: string) => {
      const detail = store.getRun('operator', run.runRef);
      if (!detail.ok) throw new Error(detail.detail);
      const request = detail.value.humanRequests.find((candidate) => candidate.title === title);
      if (!request) throw new Error(`missing human request ${title}`);
      expect(store.respondHumanRequest('operator', request.requestRef, {
        expectedRevision: request.revision, decision: 'approved', idempotencyKey: key, response: 'Approved.',
      }).ok).toBe(true);
    };

    // Pass 1: the first stage's own gate opens; nothing has run.
    expect((await engine.runToBoundary({ subject: 'operator', runRef: run.runRef, proposal: plan })).state).toBe('waiting-human');
    expect(fake.executionOrder).toEqual([]);

    // Approving g1 releases ONLY its own stage. The spending stage then opens its own gate and stays
    // parked: an approval recorded on another stage's gate is not this stage's spend authorization.
    approve('automatic:gate:plain:g1-script', 'approve-g1');
    expect((await engine.runToBoundary({ subject: 'operator', runRef: run.runRef, proposal: plan })).state).toBe('waiting-human');
    expect(fake.executionOrder).toEqual(['plain']);
    const parked = store.getRun('operator', run.runRef);
    if (!parked.ok) throw new Error(parked.detail);
    expect(parked.value.humanRequests.map((request) => [request.title, request.state])).toEqual([
      ['automatic:gate:plain:g1-script', 'resolved'],
      ['automatic:gate:spending:g2-plan', 'open'],
    ]);
    expect(parked.value.stages.find((item) => item.stageId === 'spending')?.state).toBe('waiting-human');

    // Only the spend gate's OWN recorded approval releases it — and it then clears policy rather than
    // hitting the hard spend refuse.
    approve('automatic:gate:spending:g2-plan', 'approve-g2');
    const completed = await engine.runToBoundary({ subject: 'operator', runRef: run.runRef, proposal: plan });
    expect(completed.state).toBe('succeeded');
    expect(fake.executionOrder).toEqual(['plain', 'spending']);
  });

  it('parks a declared spend stage for its own approval and never refuses it outright', async () => {
    const store = createStore();
    const spending = stage('spending');
    spending.humanGates = [{ id: 'g2-plan', kind: 'approval', prompt: 'Approve the plan.', spendAuthorization: true }];
    const plan = proposal([spending]);
    const run = createApprovedRun(store, plan);
    const fake = fakes();
    const engine = new AutomaticExecutionEngine(engineOptions(store, fake));

    const first = await engine.runToBoundary({ subject: 'operator', runRef: run.runRef, proposal: plan });
    expect(first.state).toBe('waiting-human');
    expect(fake.executionOrder).toEqual([]);
    const detail = store.getRun('operator', run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    // Approvable, not a governance-refusal: the declared gate is the surface, not a dead end.
    expect(detail.value.humanRequests).toMatchObject([{ kind: 'approval', title: 'automatic:gate:spending:g2-plan', state: 'open' }]);
    // A merely-responded decision is not an approval, so the spend stage must stay parked.
    const request = detail.value.humanRequests[0];
    expect(store.respondHumanRequest('operator', request.requestRef, {
      expectedRevision: request.revision, decision: 'responded', idempotencyKey: 'text-only', response: 'Seems fine.',
    }).ok).toBe(true);
    expect((await engine.runToBoundary({ subject: 'operator', runRef: run.runRef, proposal: plan })).state).toBe('waiting-human');
    expect(fake.executionOrder).toEqual([]);
  });

  // G4: the declared publication gate is the ONLY thing that can release a T3 `publish:` stage. Before
  // it existed such a stage recomputed `t3-content-bound-approval-required` on every pass and re-parked
  // forever, which is what made the gated pipeline's publish-private step unreachable.
  describe('declared publication (content-bound T3) gate', () => {
    function publishFixture(options: { declared: boolean }) {
      const store = createStore();
      const upstream = stage('verify-cut');
      const publish = stage('publish-private', ['verify-cut']);
      publish.action = 'publish:private-upload';
      publish.riskTier = 'T3';
      publish.workOrder = 'Upload the finished cut as private. Never flip it public.';
      publish.artifacts = [];
      publish.checkpoints = [];
      publish.humanGates = [{
        id: 'g4-publish-private',
        kind: 'approval',
        prompt: 'GATE 4 — approve the private upload.',
        ...(options.declared ? { publicationAuthorization: true } : {}),
      }];
      const plan = proposal([upstream, publish]);
      const run = createApprovedRun(store, plan);
      const executed: string[] = [];
      const fake = fakes({
        worker: {
          async execute(input) {
            executed.push(input.action);
            return {
              state: 'succeeded', summary: `${input.action} done`,
              usage: { inputTokens: 1, outputTokens: 1, costUsdMicros: 0 }, artifacts: [], checkpoints: [],
            };
          },
        },
      });
      fake.worktrees.inspect = async () => ({ changed: [] });
      const engine = new AutomaticExecutionEngine(engineOptions(store, fake));
      const approve = (title: string, key: string) => {
        const detail = store.getRun('operator', run.runRef);
        if (!detail.ok) throw new Error(detail.detail);
        const request = detail.value.humanRequests.find((candidate) => candidate.title === title);
        if (!request) throw new Error(`missing human request ${title}`);
        expect(store.respondHumanRequest('operator', request.requestRef, {
          expectedRevision: request.revision, decision: 'approved', idempotencyKey: key, response: 'Approved.',
        }).ok).toBe(true);
        return request;
      };
      const drive = () => engine.runToBoundary({ subject: 'operator', runRef: run.runRef, proposal: plan });
      return { store, plan, run, executed, approve, drive };
    }

    it('releases the publish stage on its own recorded approval, and shows the work order at decision time', async () => {
      const { store, run, executed, approve, drive } = publishFixture({ declared: true });

      // Pass 1: upstream runs, the publish stage parks on its declared gate with nothing executed.
      expect((await drive()).state).toBe('waiting-human');
      expect(executed).toEqual(['test:verify-cut']);
      const parked = store.getRun('operator', run.runRef);
      if (!parked.ok) throw new Error(parked.detail);
      const gate = parked.value.humanRequests.find((request) => request.title === 'automatic:gate:publish-private:g4-publish-private');
      expect(gate).toMatchObject({ kind: 'approval', state: 'open' });
      // The standing constraint on releasing a publication boundary: the approver must SEE the prose.
      expect(gate?.prompt).toContain('GATE 4 — approve the private upload.');
      expect(gate?.prompt).toContain('Upload the finished cut as private.');
      expect(gate?.prompt).toContain("stage 'publish-private'");
      expect(gate?.prompt).toContain('T3');

      // The approval recorded against that gate IS the content-bound T3 approval, so the stage releases.
      approve('automatic:gate:publish-private:g4-publish-private', 'approve-g4');
      const completed = await drive();
      expect(completed.state).toBe('succeeded');
      expect(executed).toEqual(['test:verify-cut', 'publish:private-upload']);
    });

    it('never releases a T3 publish stage whose gate does NOT declare publication authorization', async () => {
      const { store, run, executed, approve, drive } = publishFixture({ declared: false });

      expect((await drive()).state).toBe('waiting-human');
      approve('automatic:gate:publish-private:g4-publish-private', 'approve-plain-gate');

      // A plain approval clears the gate itself and then hits the untouched restricted-intent /
      // T3 boundaries: the stage re-parks on every pass and the publish action never runs.
      expect((await drive()).state).toBe('waiting-human');
      expect((await drive()).state).toBe('waiting-human');
      expect(executed).toEqual(['test:verify-cut']);
      const parked = store.getRun('operator', run.runRef);
      if (!parked.ok) throw new Error(parked.detail);
      expect(parked.value.humanRequests.map((request) => request.title)).toContain(
        'automatic:policy:publish-private:external-publication-intent-requires-human-approval',
      );
      // A gate without the flag carries only its authored prompt — no work order is disclosed.
      const plain = parked.value.humanRequests.find((request) => request.title === 'automatic:gate:publish-private:g4-publish-private');
      expect(plain?.prompt).toBe('GATE 4 — approve the private upload.');
    });

    it('never lets another stage\'s approval authorize a declared publication gate', async () => {
      // Stage-scoped, exactly like the spend gate: the release is keyed to the title of THIS stage's own
      // gate, so an approval recorded anywhere else leaves the publishing stage parked.
      const store = createStore();
      const script = stage('script');
      script.humanGates = [{ id: 'g1-script', kind: 'approval', prompt: 'Approve the script.' }];
      const publish = stage('publish-private', ['script']);
      publish.action = 'publish:private-upload';
      publish.riskTier = 'T3';
      publish.artifacts = []; publish.checkpoints = [];
      publish.humanGates = [{ id: 'g4-publish-private', kind: 'approval', prompt: 'Approve the upload.', publicationAuthorization: true }];
      const plan = proposal([script, publish]);
      const run = createApprovedRun(store, plan);
      const executed: string[] = [];
      const fake = fakes({
        worker: {
          async execute(input) {
            executed.push(input.action);
            return {
              state: 'succeeded', summary: 'done', usage: { inputTokens: 0, outputTokens: 0, costUsdMicros: 0 },
              artifacts: [], checkpoints: [],
            };
          },
        },
      });
      fake.worktrees.inspect = async () => ({ changed: [] });
      const engine = new AutomaticExecutionEngine(engineOptions(store, fake));
      const approve = (title: string, key: string) => {
        const detail = store.getRun('operator', run.runRef);
        if (!detail.ok) throw new Error(detail.detail);
        const request = detail.value.humanRequests.find((candidate) => candidate.title === title);
        if (!request) throw new Error(`missing human request ${title}`);
        expect(store.respondHumanRequest('operator', request.requestRef, {
          expectedRevision: request.revision, decision: 'approved', idempotencyKey: key, response: 'Approved.',
        }).ok).toBe(true);
      };
      const drive = () => engine.runToBoundary({ subject: 'operator', runRef: run.runRef, proposal: plan });

      expect((await drive()).state).toBe('waiting-human');
      expect(executed).toEqual([]);

      // Approving the SCRIPT gate releases only the script stage; the publish stage opens its own gate
      // and publishes nothing.
      approve('automatic:gate:script:g1-script', 'approve-g1');
      expect((await drive()).state).toBe('waiting-human');
      expect(executed).toEqual(['test:script']);
      const parked = store.getRun('operator', run.runRef);
      if (!parked.ok) throw new Error(parked.detail);
      expect(parked.value.humanRequests.map((request) => [request.title, request.state])).toEqual([
        ['automatic:gate:script:g1-script', 'resolved'],
        ['automatic:gate:publish-private:g4-publish-private', 'open'],
      ]);

      // Only its OWN recorded approval releases it.
      approve('automatic:gate:publish-private:g4-publish-private', 'approve-g4');
      expect((await drive()).state).toBe('succeeded');
      expect(executed).toEqual(['test:script', 'publish:private-upload']);
    });
  });

  it('contains adapter exceptions durably instead of leaving a running attempt wedged', async () => {
    const store = createStore();
    const plan = proposal([stage('adapter-failure')]);
    const run = createApprovedRun(store, plan);
    const fake = fakes();
    fake.worktrees = {
      async ensure() { throw new Error('worktree provisioning unavailable'); },
      async inspect() { return { changed: [] }; },
      async remove(input) { fake.removedPaths.push(input.path); },
    };
    const engine = new AutomaticExecutionEngine(engineOptions(store, fake));

    const outcome = await engine.runToBoundary({ subject: 'operator', runRef: run.runRef, proposal: plan });

    expect(outcome.state).toBe('waiting-human');
    const contained = store.getRun('operator', run.runRef);
    if (!contained.ok) throw new Error(contained.detail);
    expect(contained.value.stages).toMatchObject([{ state: 'waiting-human' }]);
    expect(contained.value.attempts).toMatchObject([{ state: 'interrupted' }]);
    expect(contained.value.sessions.find((item) => item.role === 'worker')).toMatchObject({ state: 'interrupted' });
    expect(contained.value.humanRequests).toMatchObject([{ kind: 'intervention', state: 'open' }]);
  });

  it('removes the attempt worktree once the attempt reaches a terminal state', async () => {
    const store = createStore();
    const plan = proposal([stage('cleanup')]);
    const run = createApprovedRun(store, plan);
    const fake = fakes({
      worker: {
        async execute() {
          return { state: 'failed', summary: 'stage failed', usage: { inputTokens: 0, outputTokens: 0, costUsdMicros: 0 }, artifacts: [], checkpoints: [] };
        },
      },
    });
    const engine = new AutomaticExecutionEngine(engineOptions(store, fake));

    const outcome = await engine.runToBoundary({ subject: 'operator', runRef: run.runRef, proposal: plan });

    expect(outcome.state).toBe('failed');
    expect(fake.worktreePaths).toHaveLength(1);
    expect(fake.removedPaths).toEqual(fake.worktreePaths);
  });

  it('does not wedge a terminal attempt when worktree cleanup fails or double-removes', async () => {
    const store = createStore();
    const plan = proposal([stage('cleanup-fail')]);
    const run = createApprovedRun(store, plan);
    const fake = fakes({
      worker: {
        async execute() {
          return { state: 'failed', summary: 'stage failed', usage: { inputTokens: 0, outputTokens: 0, costUsdMicros: 0 }, artifacts: [], checkpoints: [] };
        },
      },
    });
    let removeCalls = 0;
    fake.worktrees = {
      async ensure(input) { fake.worktreePaths.push(input.path); },
      async inspect() { return { changed: [] }; },
      async remove() { removeCalls += 1; throw new Error('worktree removal encountered an unexpected fault'); },
    };
    const engine = new AutomaticExecutionEngine(engineOptions(store, fake));

    const outcome = await engine.runToBoundary({ subject: 'operator', runRef: run.runRef, proposal: plan });

    expect(outcome.state).toBe('failed');
    expect(removeCalls).toBe(1);
    const detail = store.getRun('operator', run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    expect(detail.value.humanRequests).toEqual([]);
    const events = store.listEvents('operator', run.runRef);
    if (!events.ok) throw new Error(events.detail);
    expect(events.value.some((event) => (event.summary ?? '').includes('attempt worktree cleanup did not complete'))).toBe(true);
  });

  it('uses a stage-stable integration key so an ambiguous integration crash replays on a successor', async () => {
    const store = createStore();
    const plan = proposal([stage('integrate')]);
    const run = createApprovedRun(store, plan);
    const fake = fakes();
    const keys: string[] = [];
    let committed: Parameters<ResultIntegrator['integrate']>[0] | null = null;
    fake.results = {
      async lookup() {
        return committed && keys.length > 0
          ? {
              resultHash: committed.resultHash, summary: committed.summary, artifacts: committed.artifacts,
              changed: committed.changed, checkpoints: committed.checkpoints,
              durability: 'canonical' as const,
              attemptBaseCommit: 'a'.repeat(40), integrationCommit: 'b'.repeat(40),
            }
          : null;
      },
      async integrate(input) {
        keys.push(input.operationKey);
        committed = input;
        if (keys.length === 1) throw new Error('lost acknowledgement after canonical commit');
        return { status: 'replayed', resultHash: input.resultHash,
          durability: 'canonical' as const, attemptBaseCommit: 'a'.repeat(40), integrationCommit: 'b'.repeat(40) };
      },
    };
    const engine = new AutomaticExecutionEngine(engineOptions(store, fake));
    const waiting = await engine.runToBoundary({ subject: 'operator', runRef: run.runRef, proposal: plan });
    expect(waiting.state).toBe('waiting-human');
    const detail = store.getRun('operator', run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    const request = detail.value.humanRequests[0];
    expect(store.respondHumanRequest('operator', request.requestRef, {
      expectedRevision: request.revision, decision: 'approved', idempotencyKey: 'retry-integration', response: 'Reconcile.',
    }).ok).toBe(true);

    const completed = await engine.runToBoundary({ subject: 'operator', runRef: run.runRef, proposal: plan });

    expect(completed.state).toBe('succeeded');
    expect(keys).toHaveLength(1);
    const final = store.getRun('operator', run.runRef);
    expect(final.ok && final.value.attempts.map((item) => item.generation)).toEqual([1, 2]);
    expect(fake.executionOrder).toEqual(['integrate']);
  });

  it('parks a stranded canonical integration once with its accurate cause instead of spinning attempts', async () => {
    const store = createStore();
    const plan = proposal([stage('stranded')]);
    const run = createApprovedRun(store, plan);
    const fake = fakes();
    const payload = {
      summary: 'stranded stage complete',
      artifacts: [{ path: 'dashboard/server/stranded.txt', digest: 'b'.repeat(64) }],
      changed: [{ path: 'dashboard/server/stranded.txt', digest: 'b'.repeat(64) }],
      checkpoints: ['stranded-checked'],
    };
    const incompleteMessage = 'canonical integration incomplete (state: lineage-local): '
      + "lineage publication failed: fatal: transport 'file' not allowed";
    let incomplete = true;
    const lookups: string[] = [];
    fake.results.lookup = async (input) => {
      lookups.push(input.operationKey);
      if (incomplete) {
        const error = new Error(incompleteMessage) as Error & { canonicalIntegrationIncomplete?: boolean };
        error.canonicalIntegrationIncomplete = true;
        throw error;
      }
      return {
        ...payload,
        resultHash: canonicalStageResultHash(payload),
        durability: 'canonical',
        attemptBaseCommit: 'a'.repeat(40),
        integrationCommit: 'b'.repeat(40),
      };
    };
    const engine = new AutomaticExecutionEngine(engineOptions(store, fake));

    const first = await engine.runToBoundary({ subject: 'operator', runRef: run.runRef, proposal: plan });

    expect(first.state).toBe('waiting-human');
    const parked = store.getRun('operator', run.runRef);
    if (!parked.ok) throw new Error(parked.detail);
    expect(parked.value.humanRequests).toHaveLength(1);
    const request = parked.value.humanRequests[0];
    // Stage-stable title (no attemptRef), so a recurrence cannot stack byte-identical parks.
    expect(request.title).toBe('automatic:execution:stranded:canonical-integration-incomplete');
    expect(request.prompt).toBe(incompleteMessage);
    expect(request.prompt).not.toContain('identity differs');
    expect(parked.value.attempts).toHaveLength(1);
    // The stranded PRIOR integration is not an attempt failure: no worker, worktree or spend was burned.
    expect(fake.executionOrder).toEqual([]);
    expect(fake.worktreePaths).toEqual([]);
    expect(fake.reservations).toEqual([]);

    const second = await engine.runToBoundary({ subject: 'operator', runRef: run.runRef, proposal: plan });

    expect(second.state).toBe('waiting-human');
    const held = store.getRun('operator', run.runRef);
    if (!held.ok) throw new Error(held.detail);
    expect(held.value.humanRequests).toHaveLength(1);
    expect(held.value.attempts).toHaveLength(1);
    expect(lookups).toHaveLength(1);

    // Operator repairs the transport and clears the boundary; the NEXT lookup resumes the durable
    // integration and the stage completes without ever re-running its worker.
    incomplete = false;
    expect(store.respondHumanRequest('operator', request.requestRef, {
      expectedRevision: request.revision, decision: 'approved', idempotencyKey: 'repaired', response: 'Transport fixed.',
    }).ok).toBe(true);

    const completed = await engine.runToBoundary({ subject: 'operator', runRef: run.runRef, proposal: plan });

    expect(completed.state).toBe('succeeded');
    expect(fake.executionOrder).toEqual([]);
    expect(fake.integrationOrder).toEqual([]);
  });

  it('enforces one global worker slot across concurrent runs', async () => {
    const store = createStore();
    const firstPlan = proposal([stage('first')]);
    const secondPlan = { ...proposal([stage('second')]), proposalId: 'synthetic-two', title: 'Second run' };
    const first = createApprovedRun(store, firstPlan);
    const second = createApprovedRun(store, secondPlan);
    let release = (): void => {};
    let entered = (): void => {};
    const enteredPromise = new Promise<void>((resolveEntered) => { entered = resolveEntered; });
    const releasePromise = new Promise<void>((resolveRelease) => { release = resolveRelease; });
    const fake = fakes();
    fake.workers = {
      async execute(input) {
        fake.executionOrder.push(input.action.split(':')[1]);
        entered();
        await releasePromise;
        const id = input.action.split(':')[1];
        return {
          state: 'succeeded', summary: 'done', usage: { inputTokens: 1, outputTokens: 1, costUsdMicros: 1 },
          artifacts: [{ path: `dashboard/server/${id}.txt`, digest: 'b'.repeat(64) }], checkpoints: [`${id}-checked`],
        };
      },
    };
    const engine = new AutomaticExecutionEngine(engineOptions(store, fake));
    const firstRun = engine.runToBoundary({ subject: 'operator', runRef: first.runRef, proposal: firstPlan });
    await enteredPromise;

    const secondRun = engine.runToBoundary({ subject: 'operator', runRef: second.runRef, proposal: secondPlan });
    await Promise.resolve();
    expect(fake.executionOrder).toEqual(['first']);
    release();
    expect((await firstRun).state).toBe('succeeded');
    expect((await secondRun).state).toBe('succeeded');
    expect(fake.executionOrder).toEqual(['first', 'second']);
  });

  it('persists cancellation intent before stopping Manager and Worker adapters, then converges idempotently', async () => {
    const store = createStore();
    const plan = proposal([stage('first')]);
    const run = createApprovedRun(store, plan);
    const fake = fakes();
    let entered = (): void => {};
    let release = (): void => {};
    const enteredPromise = new Promise<void>((resolveEntered) => { entered = resolveEntered; });
    const releasePromise = new Promise<void>((resolveRelease) => { release = resolveRelease; });
    fake.workers = {
      async execute(input) {
        fake.executionOrder.push(input.action.split(':')[1]);
        entered();
        await releasePromise;
        return {
          state: 'succeeded', summary: 'cancelled before integration',
          usage: { inputTokens: 1, outputTokens: 1, costUsdMicros: 1 },
          artifacts: [], checkpoints: [],
        };
      },
    };
    const signaled: string[] = [];
    let workerCancellation: Parameters<ExecutionCancellationController['cancelWorker']>[0] | null = null;
    const assertIntentPersisted = (): void => {
      const detail = store.getRun('operator', run.runRef);
      if (!detail.ok) throw new Error(detail.detail);
      expect(detail.value.run.lifecycle.kind).toBe('stopping');
      expect(store.listEvents('operator', run.runRef)).toMatchObject({
        ok: true, value: expect.arrayContaining([expect.objectContaining({ summary: expect.stringContaining('cancellation requested') })]),
      });
    };
    fake.cancellation = {
      async cancelManager(input) { assertIntentPersisted(); signaled.push(`manager:${input.sessionRef}`); },
      async cancelWorker(input) {
        assertIntentPersisted();
        workerCancellation = input;
        signaled.push(`worker:${input.sessionRef}`);
        release();
      },
    };
    const engine = new AutomaticExecutionEngine(engineOptions(store, fake));
    const running = engine.runToBoundary({ subject: 'operator', runRef: run.runRef, proposal: plan });
    await enteredPromise;

    // Simulate a later iteration request becoming visible while this already-launched session is still
    // running. Cancellation must use the key carried by the session, never re-select from current Run data.
    const readRun = store.getRun.bind(store);
    store.getRun = ((...args: Parameters<ControlPlaneStore['getRun']>) => {
      const result = readRun(...args);
      if (!result.ok) return result;
      result.value.iterationLoops.push({
        iterationLoopRef: 'loop-newer', state: 'active', participants: [{ participantId: 'worker', stageRef: 'first' }],
      } as never);
      result.value.iterationRequests.push({
        iterationLoopRef: 'loop-newer', recipientParticipantId: 'worker', requestRef: 'request-newer',
      } as never);
      return result;
    }) as ControlPlaneStore['getRun'];

    const cancelled = await engine.cancelRun({
      subject: 'operator', runRef: run.runRef, idempotencyKey: 'cancel-live-run', reason: 'Operator requested stop.',
    });
    await running;

    expect(cancelled).toMatchObject({ state: 'stopped', interruptedSessionRefs: [], replayed: false });
    expect(signaled.map((value) => value.split(':')[0]).sort()).toEqual(['manager', 'worker']);
    const detailAfterCancel = readRun('operator', run.runRef);
    if (!detailAfterCancel.ok) throw new Error(detailAfterCancel.detail);
    const workerAttemptRef = detailAfterCancel.value.attempts[0]!.attemptRef;
    expect(workerCancellation).toMatchObject({
      attemptRef: workerAttemptRef,
      attemptOperationKey: `automatic-attempt:${workerAttemptRef}`,
    });
    expect(fake.integrationOrder).toEqual([]);
    expect(store.getRun('operator', run.runRef)).toMatchObject({
      ok: true,
      value: {
        run: { lifecycle: { kind: 'stopped', deployPause: null } },
        stages: [{ state: 'stopped' }],
        attempts: [{ state: 'stopped' }],
        sessions: expect.arrayContaining([expect.objectContaining({ state: 'stopped' })]),
      },
    });
    const replay = await engine.cancelRun({
      subject: 'operator', runRef: run.runRef, idempotencyKey: 'cancel-live-run', reason: 'Operator requested stop.',
    });
    expect(replay).toMatchObject({ state: 'stopped', replayed: true, stoppedSessionRefs: [] });
    expect(signaled).toHaveLength(2);
  });

  it('derives the original worker operation key when cancelling a legacy null-key session', async () => {
    const store = createStore();
    const plan = proposal([stage('legacy-cancel')]);
    const run = createApprovedRun(store, plan);
    const fake = fakes();
    let enter = (): void => {};
    let release = (): void => {};
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    const released = new Promise<void>((resolve) => { release = resolve; });
    fake.workers = {
      async execute() {
        enter();
        await released;
        return {
          state: 'failed', summary: 'cancelled',
          usage: { inputTokens: 0, outputTokens: 0, costUsdMicros: 0 }, artifacts: [], checkpoints: [],
        };
      },
    };
    let cancellation: Parameters<ExecutionCancellationController['cancelWorker']>[0] | null = null;
    fake.cancellation = {
      async cancelManager() {},
      async cancelWorker(input) { cancellation = input; release(); },
    };
    const engine = new AutomaticExecutionEngine(engineOptions(store, fake));
    const running = engine.runToBoundary({ subject: 'operator', runRef: run.runRef, proposal: plan });
    await entered;

    const readRun = store.getRun.bind(store);
    store.getRun = ((...args: Parameters<ControlPlaneStore['getRun']>) => {
      const result = readRun(...args);
      if (result.ok) {
        for (const session of result.value.sessions) {
          if (session.role === 'worker') session.attemptOperationKey = null;
        }
      }
      return result;
    }) as ControlPlaneStore['getRun'];
    await engine.cancelRun({
      subject: 'operator', runRef: run.runRef, idempotencyKey: 'cancel-legacy-null-key', reason: 'stop',
    });
    await running;

    const detail = readRun('operator', run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    const attemptRef = detail.value.attempts[0]!.attemptRef;
    expect(cancellation).toMatchObject({
      attemptRef,
      attemptOperationKey: `automatic-attempt:${attemptRef}`,
    });
  });

  it('derives the original worker operation key when executing a legacy null-key session', async () => {
    const store = createStore();
    const plan = proposal([stage('legacy-execute')]);
    const run = createApprovedRun(store, plan);
    const fake = fakes();
    const operationKeys: string[] = [];
    const execute = fake.workers.execute.bind(fake.workers);
    fake.workers.execute = async (input) => {
      operationKeys.push(input.operationKey);
      return execute(input);
    };
    const transitionSession = store.transitionSession.bind(store);
    store.transitionSession = ((...args: Parameters<ControlPlaneStore['transitionSession']>) => {
      const result = transitionSession(...args);
      if (result.ok && result.value.role === 'worker') result.value.attemptOperationKey = null;
      return result;
    }) as ControlPlaneStore['transitionSession'];

    const engine = new AutomaticExecutionEngine(engineOptions(store, fake));
    await expect(engine.runToBoundary({ subject: 'operator', runRef: run.runRef, proposal: plan }))
      .resolves.toMatchObject({ state: 'succeeded' });
    const detail = store.getRun('operator', run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    const attemptRef = detail.value.attempts[0]!.attemptRef;
    expect(operationKeys).toEqual([`automatic-attempt:${attemptRef}`]);
  });

  it('does not launch a Worker when cancellation arrives during asynchronous preparation', async () => {
    const store = createStore();
    const plan = proposal([stage('prepare-stop')]);
    const run = createApprovedRun(store, plan);
    const fake = fakes();
    let entered = (): void => {};
    let release = (): void => {};
    const enteredPromise = new Promise<void>((resolveEntered) => { entered = resolveEntered; });
    const releasePromise = new Promise<void>((resolveRelease) => { release = resolveRelease; });
    fake.cancellation = {
      async cancelManager() {},
      async cancelWorker() { release(); },
    };
    const options = engineOptions(store, fake);
    options.skills = {
      async resolve(input) {
        entered();
        await releasePromise;
        return { ok: true, skills: [...input.requested] };
      },
    };
    const engine = new AutomaticExecutionEngine(options);
    const running = engine.runToBoundary({ subject: 'operator', runRef: run.runRef, proposal: plan });
    await enteredPromise;

    const cancelled = await engine.cancelRun({
      subject: 'operator', runRef: run.runRef, idempotencyKey: 'cancel-during-preparation', reason: 'Stop before Worker launch.',
    });
    await running;

    expect(cancelled.state).toBe('stopped');
    expect(fake.executionOrder).toEqual([]);
    expect(fake.reservations).toEqual([]);
    expect(fake.integrationOrder).toEqual([]);
    expect(store.getRun('operator', run.runRef)).toMatchObject({
      ok: true,
      value: { run: { lifecycle: { kind: 'stopped', deployPause: null } }, stages: [{ state: 'stopped' }], attempts: [{ state: 'stopped' }] },
    });
  });

  it('converges cleanly when cancellation arrives while the Manager is starting', async () => {
    const store = createStore();
    const plan = proposal([stage('manager-stop')]);
    const run = createApprovedRun(store, plan);
    const fake = fakes();
    let entered = (): void => {};
    let release = (): void => {};
    const enteredPromise = new Promise<void>((resolveEntered) => { entered = resolveEntered; });
    const releasePromise = new Promise<void>((resolveRelease) => { release = resolveRelease; });
    fake.managers = {
      async ensure() {
        entered();
        await releasePromise;
      },
    };
    fake.cancellation = {
      async cancelManager() { release(); },
      async cancelWorker() {},
    };
    const engine = new AutomaticExecutionEngine(engineOptions(store, fake));
    const running = engine.runToBoundary({ subject: 'operator', runRef: run.runRef, proposal: plan });
    await enteredPromise;

    const cancelled = await engine.cancelRun({
      subject: 'operator', runRef: run.runRef, idempotencyKey: 'cancel-manager-start', reason: 'Stop while Manager starts.',
    });
    const outcome = await running;

    expect(cancelled.state).toBe('stopped');
    expect(outcome.state).toBe('stopping');
    expect(fake.executionOrder).toEqual([]);
    expect(store.getRun('operator', run.runRef)).toMatchObject({
      ok: true,
      value: { run: { lifecycle: { kind: 'stopped', deployPause: null } }, stages: [{ state: 'stopped' }], sessions: [{ role: 'manager', state: 'stopped' }] },
    });
  });

  it('marks unacknowledged cancellation as interrupted and creates an intervention boundary', async () => {
    const store = createStore();
    const plan = proposal([stage('second')]);
    const run = createApprovedRun(store, plan);
    const fake = fakes();
    let entered = (): void => {};
    let release = (): void => {};
    const enteredPromise = new Promise<void>((resolveEntered) => { entered = resolveEntered; });
    const releasePromise = new Promise<void>((resolveRelease) => { release = resolveRelease; });
    fake.workers = {
      async execute() {
        entered();
        await releasePromise;
        return { state: 'failed', summary: 'stopped', usage: { inputTokens: 0, outputTokens: 0, costUsdMicros: 0 }, artifacts: [], checkpoints: [] };
      },
    };
    fake.cancellation = {
      async cancelManager() {},
      async cancelWorker() { release(); throw new Error('worker stop acknowledgement lost'); },
    };
    const engine = new AutomaticExecutionEngine(engineOptions(store, fake));
    const running = engine.runToBoundary({ subject: 'operator', runRef: run.runRef, proposal: plan });
    await enteredPromise;

    const cancelled = await engine.cancelRun({
      subject: 'operator', runRef: run.runRef, idempotencyKey: 'cancel-uncertain', reason: 'Operator requested stop.',
    });
    await running;

    expect(cancelled.state).toBe('interrupted');
    expect(cancelled.interruptedSessionRefs).toHaveLength(1);
    expect(store.getRun('operator', run.runRef)).toMatchObject({
      ok: true,
      value: {
        run: { lifecycle: { kind: 'interrupted', deployPause: null } },
        stages: [{ state: 'interrupted' }],
        attempts: [{ state: 'interrupted' }],
        humanRequests: [{ kind: 'intervention', state: 'open' }],
      },
    });
  });

  it('rejects out-of-scope server-inspected changes and restricted credential intent', async () => {
    const store = createStore();
    const unsafePlan = proposal([stage('unsafe-diff')]);
    const unsafeRun = createApprovedRun(store, unsafePlan);
    const fake = fakes();
    fake.worktrees = {
      async ensure() {},
      async inspect() { return { changed: [{ path: 'governance/agent-rules.md', digest: 'b'.repeat(64) }] }; },
      async remove(input) { fake.removedPaths.push(input.path); },
    };
    const engine = new AutomaticExecutionEngine(engineOptions(store, fake));
    expect((await engine.runToBoundary({ subject: 'operator', runRef: unsafeRun.runRef, proposal: unsafePlan })).state).toBe('failed');
    expect(fake.integrationOrder).toEqual([]);

    // Restricted vocabulary in work-order PROSE is still stopped before execution, but as a
    // human-approvable boundary (not a permanent governance-refusal) — see the layered restrictedIntent
    // fix. The run halts at waiting-human either way; the boundary kind is what changed.
    const restricted = stage('restricted');
    restricted.workOrder = 'Read an API key and publish the release.';
    const restrictedPlan = proposal([restricted]);
    const restrictedRun = createApprovedRun(store, restrictedPlan);
    expect((await engine.runToBoundary({ subject: 'operator', runRef: restrictedRun.runRef, proposal: restrictedPlan })).state).toBe('waiting-human');
    const detail = store.getRun('operator', restrictedRun.runRef);
    expect(detail).toMatchObject({ ok: true, value: { humanRequests: [{ kind: 'approval' }] } });
  });

  it('recovers a crashed file-backed run with manager and worker successor generations', async () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'kb-auto-recovery-'));
    tempDirs.push(stateRoot);
    let ids = 0;
    const store = createFileControlPlaneStore(stateRoot, { newId: () => `persistent-${++ids}` });
    const plan = proposal([stage('recover')]);
    const run = createApprovedRun(store, plan);
    let detail = store.getRun('operator', run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    expect(store.transitionRun('operator', run.runRef, detail.value.run.version, 'running').ok).toBe(true);
    detail = store.getRun('operator', run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    const manager = detail.value.sessions.find((session) => session.role === 'manager') as NonNullable<typeof detail.value.sessions[number]>;
    const managerStarting = store.transitionSession('operator', manager.sessionRef, manager.version, 'starting');
    if (!managerStarting.ok) throw new Error(managerStarting.detail);
    expect(store.transitionSession('operator', manager.sessionRef, managerStarting.value.version, 'running').ok).toBe(true);
    detail = store.getRun('operator', run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    const root = detail.value.stages[0];
    const attempt = store.createAttempt('operator', root.stageRef, { expectedStageVersion: root.version, runtime: 'codex', model: 'codex-safe' });
    if (!attempt.ok) throw new Error(attempt.detail);
    const worker = store.createWorkerSession('operator', attempt.value.attemptRef, { expectedAttemptVersion: attempt.value.version });
    if (!worker.ok) throw new Error(worker.detail);
    detail = store.getRun('operator', run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    const runningStage = detail.value.stages[0];
    expect(store.transitionStage('operator', runningStage.stageRef, runningStage.version, 'running').ok).toBe(true);
    const startingAttempt = store.transitionAttempt('operator', attempt.value.attemptRef, worker.value.version + 1, 'starting');
    if (!startingAttempt.ok) throw new Error(startingAttempt.detail);
    expect(store.transitionAttempt('operator', attempt.value.attemptRef, startingAttempt.value.version, 'running').ok).toBe(true);
    const startingWorker = store.transitionSession('operator', worker.value.sessionRef, worker.value.version, 'starting');
    if (!startingWorker.ok) throw new Error(startingWorker.detail);
    expect(store.transitionSession('operator', worker.value.sessionRef, startingWorker.value.version, 'running').ok).toBe(true);

    const recoveredStore = createFileControlPlaneStore(stateRoot, { newId: () => `persistent-${++ids}` });
    const interrupted = recoveredStore.getRun('operator', run.runRef);
    expect(interrupted).toMatchObject({ ok: true, value: { run: { lifecycle: { kind: 'interrupted', deployPause: null } }, attempts: [{ state: 'interrupted' }] } });
    const fake = fakes();
    const engine = new AutomaticExecutionEngine(engineOptions(recoveredStore, fake, join(stateRoot, 'worktrees')));

    const outcome = await engine.runToBoundary({ subject: 'operator', runRef: run.runRef, proposal: plan });

    expect(outcome.state).toBe('succeeded');
    const final = recoveredStore.getRun('operator', run.runRef);
    if (!final.ok) throw new Error(final.detail);
    expect(final.value.run.managerGeneration).toBe(2);
    expect(final.value.attempts.map((item) => [item.generation, item.state, item.predecessorAttemptRef])).toEqual([
      [1, 'interrupted', null],
      [2, 'succeeded', final.value.attempts[0].attemptRef],
    ]);
    expect(fake.executionOrder).toEqual(['recover']);
  });

  it('rejects unsafe worktree planning and immutable-run hash mismatches', async () => {
    expect(() => planRunWorktreePath('relative', 'run-1')).toThrow(AutomaticExecutionError);
    expect(() => planRunWorktreePath(join(tmpdir(), 'worktrees'), '../escape')).toThrow(AutomaticExecutionError);
    const store = createStore();
    const plan = proposal([stage('bound')]);
    const run = createApprovedRun(store, plan);
    const fake = fakes();
    const engine = new AutomaticExecutionEngine(engineOptions(store, fake));
    const changed = { ...plan, summary: 'Changed after approval.' };
    await expect(engine.runToBoundary({ subject: 'operator', runRef: run.runRef, proposal: changed })).rejects.toThrow('immutable run hash');
    expect(fake.executionOrder).toEqual([]);
  });
});

// -------------------------------------------------------------------------------------------------
// restrictedIntent — layered per-field intent scan (regression for the self-lint-report false positive).
//
// The pre-PR-#58 self-lint def was permanently parked (`credential-handling-intent-is-forbidden`,
// a non-overridable governance-refusal) because its OWN prose safety rules quoted the prohibition
// vocabulary the scanner hunts. The layered fix keeps hard refusals for restricted vocabulary in the
// structured `action` id, but downgrades a match found only in `workOrder` prose to a human-approvable
// boundary: genuine in-prose directives are still stopped for a human before any worker runs, while a
// def stating its own safety rules parks for one review click instead of bricking.
// -------------------------------------------------------------------------------------------------

// Faithful reproduction of the pre-PR-#58 self-lint-report body (git 09e127a). Its work order states
// its own read-only safety rules using credential / secret / spend / publish vocabulary — all in prose,
// none in the `report:self-lint` action id.
const ORIGINAL_SELF_LINT_WORK_ORDER = [
  "# Self-lint report — read-only repository health scan",
  "",
  "Produce a **read-only** hygiene report on the `kb` repository. This is the Wave-A supervised live-fire",
  "target: a genuinely low-risk (T1), no-external-action cadence. You write exactly **one** report file and",
  "change nothing else.",
  "",
  "## Profile / capability note",
  "",
  "This definition names the server-owned `producer` profile (`Read`, `Glob`, `Grep`, `Write`, `Edit`,",
  "`Bash`). Use **only** `Read` / `Glob` / `Grep` to inspect the repo and a single `Write` to author the",
  "report. Do **not** edit, delete, move, or reformat any existing file; do **not** run any command that",
  "mutates the repo, the network, or any external system. The engine bounds accepted changes to this stage's",
  "write scope (derived from the `orgs/kb-ops/output` target) regardless of the tool cap — but the intent here",
  "is a pure scan-and-report.",
  "",
  "## What to scan (read-only)",
  "",
  "1. Stale or orphaned entries under `queue/` (cards in `working`/`inbox` with no recent activity).",
  "2. `dashboards/` and `ledgers/` freshness — obviously stale or malformed rows.",
  "3. Broken relative links in the top-level `_index.md` and `orgs/kb-ops/_index.md`.",
  "4. Any tracked file that looks like it holds a credential or an absolute local path that should not be",
  "   committed (report the path only — never echo a suspected secret's value).",
  "",
  "## Output",
  "",
  "Write the report to `orgs/kb-ops/output/self-lint-report-YYYY-MM-DD.md` (today's date). It MUST contain:",
  "",
  "- A one-paragraph summary (overall health: green / attention-needed).",
  "- A findings list: each finding is a file/area, a one-line description, and a suggested follow-up. If there",
  "  are no findings in a category, say so explicitly.",
  "- An **explicitly read-only** note confirming no files other than the report were changed.",
  "",
  "## Rules",
  "",
  "- Read-only outside the single report file. No external action, no network, no spend, no publish.",
  "- Never print or copy a suspected credential's value — report only the containing path.",
  "- If you cannot complete the scan, write a short report saying what blocked you and stop. Do not guess.",
].join('\n');

describe('AutomaticExecutionEngine restricted-intent scan', () => {
  async function runSingleStage(configure: (stage: ProposalStage) => void): Promise<{
    outcome: Awaited<ReturnType<AutomaticExecutionEngine['runToBoundary']>>;
    detail: Extract<ReturnType<ControlPlaneStore['getRun']>, { ok: true }>['value'];
    fake: ReturnType<typeof fakes>;
  }> {
    const store = createStore();
    const target = stage('intent');
    configure(target);
    const plan = proposal([target]);
    const run = createApprovedRun(store, plan);
    const fake = fakes();
    const engine = new AutomaticExecutionEngine(engineOptions(store, fake));
    const outcome = await engine.runToBoundary({ subject: 'operator', runRef: run.runRef, proposal: plan });
    const detail = store.getRun('operator', run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    return { outcome, detail: detail.value, fake };
  }

  it('does NOT hard-refuse a def whose prose safety rules quote restricted vocabulary (original self-lint wording)', async () => {
    const { outcome, detail, fake } = await runSingleStage((target) => {
      target.action = 'report:self-lint';
      target.title = 'Scan the repo for hygiene issues and write a read-only report';
      target.workOrder = ORIGINAL_SELF_LINT_WORK_ORDER;
    });
    // Stopped before execution, but as a human-approvable boundary — NOT a permanent governance-refusal.
    expect(outcome.state).toBe('waiting-human');
    expect(fake.executionOrder).toEqual([]);
    expect(detail.humanRequests).toHaveLength(1);
    expect(detail.humanRequests[0].kind).toBe('approval');
    expect(detail.humanRequests[0].kind).not.toBe('governance-refusal');
    expect(detail.humanRequests[0].prompt).toBe('credential-handling-language-requires-human-review');
  });

  it('still STOPS a genuine credential directive stated in work-order prose (human-approvable)', async () => {
    const { outcome, detail, fake } = await runSingleStage((target) => {
      target.action = 'code:sync-billing';
      target.workOrder = 'Read the value of the production API key and use it to authenticate to the billing service.';
    });
    expect(outcome.state).toBe('waiting-human');
    expect(fake.executionOrder).toEqual([]);
    expect(detail.humanRequests[0].kind).toBe('approval');
    expect(detail.humanRequests[0].prompt).toBe('credential-handling-language-requires-human-review');
  });

  it('still STOPS a genuine spending directive stated in work-order prose (human-approvable)', async () => {
    const { outcome, detail, fake } = await runSingleStage((target) => {
      target.action = 'code:acquire-domain';
      target.workOrder = 'Purchase the poyais.com domain and pay with the company credit card.';
    });
    expect(outcome.state).toBe('waiting-human');
    expect(fake.executionOrder).toEqual([]);
    expect(detail.humanRequests[0].kind).toBe('approval');
    expect(detail.humanRequests[0].prompt).toBe('spending-language-requires-human-review');
  });

  it('still STOPS a genuine publication directive stated in work-order prose (human-approvable)', async () => {
    const { outcome, detail, fake } = await runSingleStage((target) => {
      target.action = 'code:finalize-cut';
      target.workOrder = 'Upload the finished video and publish it publicly on the channel.';
    });
    expect(outcome.state).toBe('waiting-human');
    expect(fake.executionOrder).toEqual([]);
    expect(detail.humanRequests[0].kind).toBe('approval');
    expect(detail.humanRequests[0].prompt).toBe('external-publication-intent-requires-human-approval');
  });

  it('HARD-refuses restricted credential vocabulary in the structured action id (non-overridable)', async () => {
    // Namespace `code` clears classifyActionRisk, but the action NAME declares credential handling — a
    // deliberate, structured statement of intent that keeps the permanent governance-refusal.
    const { outcome, detail, fake } = await runSingleStage((target) => {
      target.action = 'code:read-credential-and-authenticate';
      target.workOrder = 'Execute the sync.';
    });
    expect(outcome.state).toBe('waiting-human');
    expect(fake.executionOrder).toEqual([]);
    expect(detail.humanRequests[0].kind).toBe('governance-refusal');
    expect(detail.humanRequests[0].prompt).toBe('credential-handling-intent-is-forbidden');
  });

  it('HARD-refuses restricted spending vocabulary in the structured action id (non-overridable)', async () => {
    const { outcome, detail, fake } = await runSingleStage((target) => {
      target.action = 'code:spend-remaining-budget';
      target.workOrder = 'Execute the task.';
    });
    expect(outcome.state).toBe('waiting-human');
    expect(fake.executionOrder).toEqual([]);
    expect(detail.humanRequests[0].kind).toBe('governance-refusal');
    expect(detail.humanRequests[0].prompt).toBe('real-spending-intent-is-forbidden');
  });

  it('allows an ordinary stage whose action and prose carry no restricted vocabulary', async () => {
    const { outcome, fake } = await runSingleStage((target) => {
      // Keep the action's second segment === the stage id so the fake worker's derived artifact
      // (`<segment>.txt`) matches the stage's declared artifact and the stage integrates cleanly.
      target.action = 'code:intent';
      target.workOrder = 'Reformat the module and add unit tests.';
    });
    expect(outcome.state).toBe('succeeded');
    expect(fake.executionOrder).toEqual(['intent']);
  });
});

/**
 * [C-S5] two-phase attempt start, at the engine boundary. The engine must await the attempt port's
 * start receipt BEFORE it projects `starting -> running`, and must never project `running` for a
 * receipt that refused. Both orderings are barriered, not timing-hopeful: the result half of the launch
 * only settles a macrotask after the receipt, so a projection that ran late would be visibly out of
 * order rather than racily green.
 */
describe('AutomaticExecutionEngine two-phase attempt start', () => {
  function recordAttemptTransitions(store: ControlPlaneStore, order: string[]): void {
    const original = store.transitionAttempt.bind(store);
    store.transitionAttempt = (subject, attemptRef, expectedVersion, state) => {
      order.push(`attempt:${state}`);
      return original(subject, attemptRef, expectedVersion, state);
    };
    const originalSession = store.transitionSession.bind(store);
    store.transitionSession = (subject, sessionRef, expectedVersion, state) => {
      // Scoped by ref: the Manager session legitimately reaches `running` before any worker attempt.
      order.push(`session:${state}:${sessionRef}`);
      return originalSession(subject, sessionRef, expectedVersion, state);
    };
  }

  it('projects starting -> running only after the start receipt resolves', async () => {
    const store = createStore();
    const plan = proposal([stage('receipt-order')]);
    const run = createApprovedRun(store, plan);
    const fake = fakes();
    const options = engineOptions(store, fake);
    const order: string[] = [];
    recordAttemptTransitions(store, order);
    let workerSessionRef = '';
    options.workers = {
      begin(input) {
        workerSessionRef = input.sessionRef;
        order.push('begin');
        const receipt = Promise.resolve({
          ok: true as const,
          value: {
            operationKey: input.operationKey, sessionId: 'session-receipt-order',
            attemptRef: input.attemptRef, revision: 3, boundAt: new Date(0).toISOString(), replayed: false,
          },
        }).then((value) => { order.push('receipt'); return value; });
        return {
          receipt,
          result: receipt.then(async () => {
            await new Promise((resolve) => { setTimeout(resolve, 0); });
            order.push('result');
            return {
              state: 'succeeded' as const, summary: 'done',
              usage: { inputTokens: 1, outputTokens: 1, costUsdMicros: 1 }, artifacts: [], checkpoints: [],
            };
          }),
        };
      },
    };

    const outcome = await new AutomaticExecutionEngine(options).runToBoundary({
      subject: 'operator', runRef: run.runRef, proposal: plan,
    });

    expect(outcome.state).toBe('succeeded');
    expect(order.indexOf('receipt')).toBeLessThan(order.indexOf('attempt:running'));
    expect(order.indexOf('receipt')).toBeLessThan(order.indexOf(`session:running:${workerSessionRef}`));
    expect(order.indexOf('attempt:running')).toBeLessThan(order.indexOf('result'));
    expect(order.filter((entry) => entry === 'attempt:starting' || entry === 'attempt:running'))
      .toEqual(['attempt:starting', 'attempt:running']);
    expect(order.indexOf('begin')).toBeLessThan(order.indexOf('receipt'));
  });

  it('never projects running when the start receipt refuses', async () => {
    const store = createStore();
    const plan = proposal([stage('receipt-refused')]);
    const run = createApprovedRun(store, plan);
    const fake = fakes();
    const options = engineOptions(store, fake);
    const order: string[] = [];
    recordAttemptTransitions(store, order);
    let workerSessionRef = '';
    options.workers = {
      begin(input) {
        workerSessionRef = input.sessionRef;
        return {
          receipt: Promise.resolve({
            ok: false as const, refusal: 'binding-conflict' as const,
            detail: 'operationKey already names a different approved attempt declaration',
          }),
          result: Promise.resolve({
            state: 'failed' as const,
            summary: 'claude attempt session start refused (binding-conflict)',
            usage: { inputTokens: 0, outputTokens: 0, costUsdMicros: 0 }, artifacts: [], checkpoints: [],
          }),
        };
      },
    };

    const outcome = await new AutomaticExecutionEngine(options).runToBoundary({
      subject: 'operator', runRef: run.runRef, proposal: plan,
    });

    expect(outcome.state).toBe('failed');
    expect(order).toContain('attempt:starting');
    expect(order).not.toContain('attempt:running');
    expect(order).not.toContain(`session:running:${workerSessionRef}`);
    const detail = store.getRun('operator', run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    expect(detail.value.attempts.map((attempt) => attempt.state)).toEqual(['failed']);
  });

  it('claims a rejecting launch.result when the receipt itself rejects', async () => {
    // M5: both halves exist the moment `begin` returns. When the receipt rejects, the engine's catch
    // synthesizes a failed result and nobody ever awaits `launch.result` — an unhandled rejection that
    // would take the daemon down. The engine claims it before its first await.
    const store = createStore();
    const plan = proposal([stage('result-orphan')]);
    const run = createApprovedRun(store, plan);
    const fake = fakes();
    const options = engineOptions(store, fake);
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled);
    options.workers = {
      begin() {
        return {
          receipt: Promise.reject(new Error('host receipt exploded')),
          // Rejects LATER than the receipt, exactly like a port whose result settles after the failure.
          result: new Promise((_resolve, reject) => {
            setTimeout(() => reject(new Error('orphaned attempt result')), 5);
          }),
        } as never;
      },
    };

    try {
      const outcome = await new AutomaticExecutionEngine(options).runToBoundary({
        subject: 'operator', runRef: run.runRef, proposal: plan,
      });
      expect(outcome.state).toBe('failed');
      // Two macrotask turns: long enough for the orphaned rejection to have been reported.
      await new Promise((resolve) => { setTimeout(resolve, 40); });
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
