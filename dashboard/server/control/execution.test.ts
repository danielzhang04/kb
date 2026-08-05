import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFileControlPlaneStore, createInMemoryControlPlaneStore, type ControlPlaneStore } from './store.ts';
import type { JsonObject } from './types.ts';
import type { PlanProposal, ProposalStage } from './proposal.ts';
import { proposalContentHash } from './proposal.ts';
import type { PolicyEnvironment } from './policy.ts';
import {
  AutomaticExecutionEngine,
  AutomaticExecutionError,
  canonicalStageResultHash,
  canonicalStageResultHashMatches,
  planRunWorktreePath,
  type AccountingAdapter,
  type AutomaticExecutionOptions,
  type ExecutionCancellationController,
  type ManagerAdapter,
  type ResultIntegrator,
  type WorkerAdapter,
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
    title: plan.title,
    proposalRef: createdProposal.value.proposalRef,
    proposalRevision: 1,
    expectedProposalHash: createdProposal.value.hash,
    managerRuntime: plan.manager.runtime,
    managerModel: plan.manager.model,
    managerAssignment: plan.manager.assignment,
    idempotencyKey: `launch-${createdProposal.value.proposalRef}`,
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
  workers: WorkerAdapter;
  results: ResultIntegrator;
  cancellation: ExecutionCancellationController;
  executionOrder: string[];
  integrationOrder: string[];
  worktreePaths: string[];
  removedPaths: string[];
  reservations: string[];
}

function fakes(overrides: { worker?: WorkerAdapter; accounting?: AccountingAdapter } = {}): Fakes {
  const executionOrder: string[] = [];
  const integrationOrder: string[] = [];
  const worktreePaths: string[] = [];
  const removedPaths: string[] = [];
  const reservations: string[] = [];
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
      return { ok: true, value: { reservationRef: `reservation:${input.attemptRef}`, replayed: false } };
    },
    async settle(input) { settled.add(input.operationKey); },
  };
  const workers: WorkerAdapter = overrides.worker ?? {
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
  return { worktrees, managers, accounting, workers, results, cancellation, executionOrder, integrationOrder, worktreePaths, removedPaths, reservations };
}

function engineOptions(store: ControlPlaneStore, fake: Fakes, root = join(tmpdir(), 'kb-auto-worktrees')): AutomaticExecutionOptions {
  return {
    store,
    policy,
    worktreeRoot: root,
    maxConcurrency: 1,
    budget: { maxAttempts: 3, maxInputTokens: 1_000, maxOutputTokens: 1_000, maxCostUsdMicros: 10_000 },
    worktrees: fake.worktrees,
    managers: fake.managers,
    workers: fake.workers,
    skills: {
      async resolve(input) { return { ok: true, skills: [...input.requested] }; },
    },
    accounting: fake.accounting,
    results: fake.results,
    cancellation: fake.cancellation,
  };
}

function passOutcome() {
  return {
    schema: 'kb.review-outcome/v1' as const, decision: 'pass' as const, summary: 'creator is safe',
    criteria: [{ criterionId: 'safety', verdict: 'pass' as const, findingIds: [] }], findings: [],
  };
}

function failOutcome() {
  return {
    schema: 'kb.review-outcome/v1' as const, decision: 'fail' as const, summary: 'creator needs changes',
    criteria: [{ criterionId: 'safety', verdict: 'fail' as const, findingIds: ['finding-1'] }],
    findings: [{ id: 'finding-1', criterionId: 'safety', severity: 'blocking' as const, summary: 'blocking defect', evidencePaths: [] }],
  };
}

function parkedOutcome() {
  return {
    schema: 'kb.review-outcome/v1' as const, decision: 'parked' as const, summary: 'cannot verify safely',
    criteria: [{ criterionId: 'safety', verdict: 'unverified' as const, findingIds: [] }], findings: [],
  };
}

function reviewFixture(input: {
  outcomes: Array<ReturnType<typeof passOutcome> | ReturnType<typeof failOutcome> | ReturnType<typeof parkedOutcome>>;
  maxCreatorReworks?: number;
  completionGate?: boolean;
  crashAfterIntegrationStage?: 'subject' | 'checker';
  checkerAttemptBaseCommit?: string;
}) {
  const store = createStore();
  const subject = stage('subject');
  const checker = stage('checker', ['subject']);
  checker.action = 'review:subject'; checker.workflowProfile = 'checker-readonly'; checker.scope = { read: ['dashboard'], write: [] };
  checker.artifacts = []; checker.checkpoints = [];
  checker.review = { subjectStageId: 'subject', maxCreatorReworks: input.maxCreatorReworks ?? 1, criteria: [{ id: 'safety', description: 'No unsafe changes.' }] };
  checker.assignment = { agentId: 'fyt-checker', declarationPath: 'agents/fyt-checker.md', declarationHash: 'c'.repeat(64),
    profileId: 'worker:codex:codex-safe', runtime: 'codex', model: 'codex-safe' };
  if (input.completionGate) checker.completionGate = { id: 'human-final', kind: 'approval', prompt: 'Approve reviewed creator output.', requiresReview: 'pass' };
  const release = stage('release', ['checker']);
  const plan = proposal([subject, checker, release]);
  const run = createApprovedRun(store, plan);
  const fake = fakes();
  const results = new Map<string, Awaited<ReturnType<ResultIntegrator['lookup']>>>();
  const integrations: Parameters<ResultIntegrator['integrate']>[0][] = [];
  const bases: Array<{ path: string; baseCommit?: string }> = [];
  const remaining = [...input.outcomes];
  let crashedAfterIntegration = false;
  fake.worktrees.ensure = async (worktree) => { bases.push({ path: worktree.path, baseCommit: worktree.baseCommit }); };
  fake.worktrees.inspect = async () => {
    const id = fake.executionOrder.at(-1) as string;
    return id === 'checker' ? { changed: [] } : { changed: [{ path: `dashboard/server/${id}.txt`, digest: 'b'.repeat(64) }] };
  };
  fake.workers = { async execute(worker) {
    const id = worker.action.startsWith('review:') ? 'checker' : worker.action.split(':')[1];
    fake.executionOrder.push(id);
    if (id === 'checker') {
      const reviewOutcome = remaining.shift();
      if (!reviewOutcome) throw new Error('unexpected checker invocation');
      return { state: 'succeeded' as const, summary: reviewOutcome.summary, usage: { inputTokens: 1, outputTokens: 1, costUsdMicros: 1 },
        artifacts: [], checkpoints: [], reviewOutcome };
    }
    return { state: 'succeeded' as const, summary: `${id} passed`, usage: { inputTokens: 1, outputTokens: 1, costUsdMicros: 1 },
      artifacts: [{ path: `dashboard/server/${id}.txt`, digest: 'b'.repeat(64) }], checkpoints: [`${id}-checked`] };
  } };
  fake.results = {
    async lookup(key) { return results.get(key.operationKey) ?? null; },
    async resolveBase(value) {
      const exact = value.dependencyResultOperationKeys?.at(-1)?.operationKey;
      const record = exact ? results.get(exact) : null;
      return record?.durability === 'canonical' ? record.integrationCommit : 'd'.repeat(40);
    },
    async integrate(value) {
      integrations.push(value);
      const isCreatorG2 = value.operationKey.endsWith(':subject:g2');
      const isCheckerG1 = value.operationKey.endsWith(':checker');
      const isCheckerG2 = value.operationKey.endsWith(':checker:g2');
      const stored = {
        summary: value.summary, artifacts: [...value.artifacts], changed: [...value.changed], checkpoints: [...value.checkpoints],
        ...(value.reviewOutcome ? { reviewOutcome: value.reviewOutcome } : {}), resultHash: value.resultHash, durability: 'canonical' as const,
        attemptBaseCommit: isCreatorG2 ? 'b'.repeat(40) : isCheckerG1 ? input.checkerAttemptBaseCommit ?? 'b'.repeat(40) : isCheckerG2 ? 'c'.repeat(40) : 'a'.repeat(40),
        integrationCommit: isCreatorG2 ? 'c'.repeat(40) : isCheckerG2 ? 'd'.repeat(40) : 'b'.repeat(40),
      };
      results.set(value.operationKey, stored);
      if (!crashedAfterIntegration && input.crashAfterIntegrationStage
        && value.operationKey === `result:${run.runRef}:${input.crashAfterIntegrationStage}`) {
        crashedAfterIntegration = true;
        throw new Error('simulated crash after canonical integration');
      }
      return { status: 'integrated' as const, resultHash: value.resultHash, durability: 'canonical' as const,
        attemptBaseCommit: stored.attemptBaseCommit, integrationCommit: stored.integrationCommit };
    },
  };
  const options = engineOptions(store, fake);
  options.assignedAgents = { resolve: (resolved) => ({ assignment: resolved.assignment, instructionMarkdown: 'checker instructions' }) };
  return { store, plan, run, fake, results, integrations, bases, engine: new AutomaticExecutionEngine(options) };
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
afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop() as string, { recursive: true, force: true });
});

describe('AutomaticExecutionEngine', () => {
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
          runState: detail.value.run.state,
          managerState: detail.value.sessions.find((session) =>
            session.sessionRef === detail.value.run.managerSessionRef)?.state,
        });
      },
    });
    expect(observed).toEqual([{ runState: 'running', managerState: 'running' }]);
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
        run: { state: 'waiting-human' },
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
        run: { state: 'waiting-human' },
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
        run: { state: 'waiting-human' },
        stages: [expect.objectContaining({ state: 'ready' })],
        sessions: [expect.objectContaining({ role: 'manager', state: 'interrupted' })],
      },
    });
  });

  it('accepts the historical omitted-review hash only for non-review payloads', () => {
    const payload = { summary: 'legacy result', artifacts: [], changed: [], checkpoints: [] };
    const legacyHash = canonicalStageResultHash(payload, 'legacy-non-review');
    expect(canonicalStageResultHashMatches(payload, legacyHash)).toBe(true);
    expect(canonicalStageResultHashMatches(payload, canonicalStageResultHash(payload))).toBe(true);
    expect(canonicalStageResultHashMatches({ ...payload, reviewOutcome: passOutcome() }, legacyHash)).toBe(false);
    expect(() => canonicalStageResultHash(
      { ...payload, reviewOutcome: passOutcome() },
      'legacy-non-review',
    )).toThrow(/cannot encode a review outcome/);
  });

  it('reconciles a canonical legacy non-review result without rerunning its worker', async () => {
    const store = createStore();
    const plan = proposal([stage('legacy-lookup')]);
    const run = createApprovedRun(store, plan);
    const fake = fakes();
    const payload = {
      summary: 'legacy stage complete',
      artifacts: [{ path: 'dashboard/server/legacy-lookup.txt', digest: 'b'.repeat(64) }],
      changed: [{ path: 'dashboard/server/legacy-lookup.txt', digest: 'b'.repeat(64) }],
      checkpoints: ['legacy-lookup-checked'],
    };
    fake.results.lookup = async () => ({
      ...payload,
      resultHash: canonicalStageResultHash(payload, 'legacy-non-review'),
      durability: 'canonical',
      attemptBaseCommit: 'a'.repeat(40),
      integrationCommit: 'b'.repeat(40),
    });
    const engine = new AutomaticExecutionEngine(engineOptions(store, fake));

    await expect(engine.runToBoundary({ subject: 'operator', runRef: run.runRef, proposal: plan }))
      .resolves.toMatchObject({ state: 'succeeded' });
    expect(fake.executionOrder).toEqual([]);
  });

  it('accepts a legacy hash receipt when resuming an in-progress canonical integration', async () => {
    const store = createStore();
    const plan = proposal([stage('legacy-resume')]);
    const run = createApprovedRun(store, plan);
    const fake = fakes();
    fake.results.integrate = async (input) => ({
      status: 'integrated',
      resultHash: canonicalStageResultHash({
        summary: input.summary,
        artifacts: input.artifacts,
        changed: input.changed,
        checkpoints: input.checkpoints,
      }, 'legacy-non-review'),
      durability: 'canonical',
      attemptBaseCommit: 'a'.repeat(40),
      integrationCommit: 'b'.repeat(40),
    });
    const engine = new AutomaticExecutionEngine(engineOptions(store, fake));

    await expect(engine.runToBoundary({ subject: 'operator', runRef: run.runRef, proposal: plan }))
      .resolves.toMatchObject({ state: 'succeeded' });
    expect(fake.executionOrder).toEqual(['legacy-resume']);
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

  it('never forwards an unvalidated direct-worker review outcome to result persistence', async () => {
    const store = createStore();
    const plan = proposal([stage('outcome')]);
    const run = createApprovedRun(store, plan);
    const fake = fakes();
    fake.workers = {
      async execute() {
        fake.executionOrder.push('outcome');
        return {
          state: 'succeeded', summary: 'worker claimed success', usage: { inputTokens: 1, outputTokens: 1, costUsdMicros: 1 },
          artifacts: [{ path: 'dashboard/server/outcome.txt', digest: 'b'.repeat(64) }], checkpoints: ['outcome-checked'],
          reviewOutcome: {
            schema: 'kb.review-outcome/v1', decision: 'pass', summary: 'sk-abcdefghijklmnopqrstuvwxyz1234567890',
            criteria: [{ criterionId: 'forged', verdict: 'pass', findingIds: [] }], findings: [],
          } as never,
        };
      },
    };
    const outcome = await new AutomaticExecutionEngine(engineOptions(store, fake))
      .runToBoundary({ subject: 'operator', runRef: run.runRef, proposal: plan });
    expect(outcome.state).toBe('failed');
    expect(fake.integrationOrder).toEqual([]);
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

  it('runs a checker against the committed creator generation and releases its accepted downstream', async () => {
    const store = createStore();
    const subject = stage('subject');
    const checker = stage('checker', ['subject']);
    checker.action = 'review:subject';
    checker.workflowProfile = 'checker-readonly';
    checker.scope = { read: ['dashboard'], write: [] };
    checker.artifacts = [];
    checker.checkpoints = [];
    checker.review = {
      subjectStageId: 'subject', maxCreatorReworks: 1,
      criteria: [{ id: 'safety', description: 'No unsafe changes.' }],
    };
    checker.assignment = {
      agentId: 'fyt-checker', declarationPath: 'agents/fyt-checker.md', declarationHash: 'c'.repeat(64),
      profileId: 'worker:codex:codex-safe', runtime: 'codex', model: 'codex-safe',
    };
    const downstream = stage('release', ['checker']);
    const plan = proposal([subject, checker, downstream]);
    const run = createApprovedRun(store, plan);
    const fake = fakes();
    const results = new Map<string, Awaited<ReturnType<ResultIntegrator['lookup']>>>();
    const seenContracts: unknown[] = [];
    fake.worktrees.inspect = async () => {
      const id = fake.executionOrder.at(-1) as string;
      return id === 'checker' ? { changed: [] } : { changed: [{ path: `dashboard/server/${id}.txt`, digest: 'b'.repeat(64) }] };
    };
    fake.workers = {
      async execute(input) {
        const id = input.action.startsWith('review:') ? 'checker' : input.action.split(':')[1];
        fake.executionOrder.push(id);
        if (id === 'checker') {
          seenContracts.push(input.reviewContract);
          return {
            state: 'succeeded', summary: 'checker passed', usage: { inputTokens: 1, outputTokens: 1, costUsdMicros: 1 },
            artifacts: [], checkpoints: [], reviewOutcome: {
              schema: 'kb.review-outcome/v1', decision: 'pass', summary: 'creator is safe',
              criteria: [{ criterionId: 'safety', verdict: 'pass', findingIds: [] }], findings: [],
            },
          };
        }
        return {
          state: 'succeeded', summary: `${id} passed`, usage: { inputTokens: 1, outputTokens: 1, costUsdMicros: 1 },
          artifacts: [{ path: `dashboard/server/${id}.txt`, digest: 'b'.repeat(64) }], checkpoints: [`${id}-checked`],
        };
      },
    };
    fake.results = {
      async lookup(input) { return results.get(input.operationKey) ?? null; },
      async resolveBase() { return 'd'.repeat(40); },
      async integrate(input) {
        const stored = {
          summary: input.summary, artifacts: [...input.artifacts], changed: [...input.changed], checkpoints: [...input.checkpoints],
          ...(input.reviewOutcome ? { reviewOutcome: input.reviewOutcome } : {}), resultHash: input.resultHash,
          durability: 'canonical' as const,
          attemptBaseCommit: input.operationKey.endsWith(':checker') || input.operationKey.endsWith(':g2') ? 'b'.repeat(40) : 'a'.repeat(40),
          integrationCommit: input.operationKey.endsWith(':g2') ? 'c'.repeat(40) : 'b'.repeat(40),
        };
        results.set(input.operationKey, stored);
        return { status: 'integrated' as const, resultHash: input.resultHash, durability: 'canonical' as const,
          attemptBaseCommit: stored.attemptBaseCommit, integrationCommit: stored.integrationCommit };
      },
    };
    const options = engineOptions(store, fake);
    options.assignedAgents = { resolve: (input) => ({ assignment: input.assignment, instructionMarkdown: 'checker instructions' }) };
    const engine = new AutomaticExecutionEngine(options);
    const outcome = await engine.runToBoundary({
      subject: 'operator', runRef: run.runRef, proposal: plan,
    });

    expect(outcome.state).toBe('succeeded');
    expect(fake.executionOrder).toEqual(['subject', 'checker', 'release']);
    expect(seenContracts).toEqual([{ review: checker.review }]);
    const detail = store.getRun('operator', run.runRef);
    expect(detail).toMatchObject({ ok: true, value: {
      reviewLoops: [{ state: 'passed', acceptedGenerationRef: expect.any(String) }],
      stageGenerations: [{ generation: 1, canonicalResultOperationKey: `result:${run.runRef}:subject`, resultCardRef: 'card-subject' }],
      attempts: expect.arrayContaining([expect.objectContaining({ stageRef: expect.any(String), reviewSubjectGenerationRef: expect.any(String) })]),
    } });
  });

  it('waits on one dedicated completion gate and releases only after its resolver accepts', async () => {
    const item = reviewFixture({ outcomes: [passOutcome()], completionGate: true });
    const waiting = await item.engine.runToBoundary({ subject: 'operator', runRef: item.run.runRef, proposal: item.plan });
    expect(waiting).toMatchObject({ state: 'waiting-human', waitingStageIds: ['checker'] });
    let detail = item.store.getRun('operator', item.run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    expect(detail.value.stages.find((stage) => stage.stageId === 'release')?.state).toBe('blocked');
    expect(detail.value.humanRequests).toHaveLength(1);
    expect(detail.value.sessions.find((session) => session.role === 'manager')?.state).toBe('running');
    const gate = detail.value.humanRequests[0];
    const receipt = detail.value.reviewReceipts[0]; const loop = detail.value.reviewLoops[0];
    const reviewStage = detail.value.stages.find((stage) => stage.stageId === 'checker') as NonNullable<typeof detail.value.stages[number]>;
    const subjectStage = detail.value.stages.find((stage) => stage.stageId === 'subject') as NonNullable<typeof detail.value.stages[number]>;
    expect(item.store.resolveReviewCompletionGate('operator', gate.requestRef, {
      expectedRequestRevision: gate.revision, expectedReceiptVersion: receipt.version, expectedLoopVersion: loop.version,
      expectedReviewStageVersion: reviewStage.version, expectedSubjectStageVersion: subjectStage.version,
      decision: 'approved', idempotencyKey: 'dedicated-gate-approve', response: 'Approved.',
    }).ok).toBe(true);
    const completed = await item.engine.runToBoundary({ subject: 'operator', runRef: item.run.runRef, proposal: item.plan });
    expect(completed.state).toBe('succeeded');
    expect(item.fake.executionOrder).toEqual(['subject', 'checker', 'release']);
    detail = item.store.getRun('operator', item.run.runRef);
    expect(detail.ok && detail.value.reviewReceipts).toHaveLength(1);
    expect(detail.ok && detail.value.humanRequests).toHaveLength(1);
  });

  it('reworks to g2 with generation-specific keys, bases, and accepted downstream release', async () => {
    const item = reviewFixture({ outcomes: [failOutcome(), passOutcome()], maxCreatorReworks: 1 });
    const outcome = await item.engine.runToBoundary({ subject: 'operator', runRef: item.run.runRef, proposal: item.plan });
    expect(outcome.state).toBe('succeeded');
    expect(item.fake.executionOrder).toEqual(['subject', 'checker', 'subject', 'checker', 'release']);
    expect(item.integrations.map((record) => [record.operationKey, record.canonicalCardRef])).toEqual(expect.arrayContaining([
      [`result:${item.run.runRef}:subject:g2`, null], [`result:${item.run.runRef}:checker:g2`, null],
    ]));
    // g1 checker and g2 creator both fork from g1's canonical integration; g2 checker forks from g2 creator.
    expect(item.bases.filter((item) => item.baseCommit === 'b'.repeat(40))).toHaveLength(2);
    expect(item.bases.filter((item) => item.baseCommit === 'c'.repeat(40))).toHaveLength(1);
    const detail = item.store.getRun('operator', item.run.runRef);
    expect(detail.ok && detail.value.stageGenerations.map((generation) => generation.generation)).toEqual([1, 2]);
    expect(detail.ok && detail.value.reviewReceipts.map((receipt) => receipt.outcome.decision)).toEqual(['fail', 'pass']);
  });

  it('parks an exhausted review exactly once without a generic intervention', async () => {
    const item = reviewFixture({ outcomes: [failOutcome()], maxCreatorReworks: 0 });
    const waiting = await item.engine.runToBoundary({ subject: 'operator', runRef: item.run.runRef, proposal: item.plan });
    expect(waiting.state).toBe('waiting-human');
    const first = item.store.getRun('operator', item.run.runRef);
    expect(first.ok && first.value.reviewLoops[0].state).toBe('parked');
    expect(first.ok && first.value.humanRequests).toHaveLength(1);
    expect(first.ok && first.value.humanRequests[0].kind).toBe('intervention');
    expect(first.ok && first.value.sessions.find((session) => session.role === 'manager')?.state).toBe('running');
    await item.engine.runToBoundary({ subject: 'operator', runRef: item.run.runRef, proposal: item.plan });
    const replay = item.store.getRun('operator', item.run.runRef);
    expect(replay.ok && replay.value.humanRequests).toHaveLength(1);
    expect(item.fake.executionOrder).toEqual(['subject', 'checker']);
  });

  it('retains the parser-parked intervention without creating a generic request on replay', async () => {
    const item = reviewFixture({ outcomes: [parkedOutcome()] });
    const waiting = await item.engine.runToBoundary({ subject: 'operator', runRef: item.run.runRef, proposal: item.plan });
    expect(waiting.state).toBe('waiting-human');
    const first = item.store.getRun('operator', item.run.runRef);
    expect(first.ok && first.value.reviewReceipts[0].state).toBe('parked');
    expect(first.ok && first.value.humanRequests).toHaveLength(1);
    await item.engine.runToBoundary({ subject: 'operator', runRef: item.run.runRef, proposal: item.plan });
    const replay = item.store.getRun('operator', item.run.runRef);
    expect(replay.ok && replay.value.humanRequests).toHaveLength(1);
    expect(item.fake.executionOrder).toEqual(['subject', 'checker']);
  });

  it('reconciles a canonical creator result after an integration-to-generation crash without rerunning the worker', async () => {
    const item = reviewFixture({ outcomes: [passOutcome()], crashAfterIntegrationStage: 'subject' });
    const completed = await item.engine.runToBoundary({ subject: 'operator', runRef: item.run.runRef, proposal: item.plan });
    expect(completed.state).toBe('succeeded');
    expect(item.fake.executionOrder.filter((id) => id === 'subject')).toHaveLength(1);
    const final = item.store.getRun('operator', item.run.runRef);
    expect(final.ok && final.value.stageGenerations).toHaveLength(1);
    expect(final.ok && final.value.reviewReceipts).toHaveLength(1);
    expect(final.ok && final.value.humanRequests).toHaveLength(0);
  });

  it('replays a canonical checker result after the terminal-to-receipt seam without rerunning the checker', async () => {
    const item = reviewFixture({ outcomes: [passOutcome()], crashAfterIntegrationStage: 'checker' });
    const completed = await item.engine.runToBoundary({ subject: 'operator', runRef: item.run.runRef, proposal: item.plan });
    expect(completed.state).toBe('succeeded');
    expect(item.fake.executionOrder.filter((id) => id === 'checker')).toHaveLength(1);
    const final = item.store.getRun('operator', item.run.runRef);
    expect(final.ok && final.value.reviewReceipts).toHaveLength(1);
    expect(final.ok && final.value.reviewLoops[0].state).toBe('passed');
    expect(final.ok && final.value.humanRequests).toHaveLength(0);
  });

  it('rejects a checker canonical result whose attempt base differs from its bound subject generation', async () => {
    const item = reviewFixture({ outcomes: [passOutcome()], checkerAttemptBaseCommit: 'e'.repeat(40) });
    const outcome = await item.engine.runToBoundary({ subject: 'operator', runRef: item.run.runRef, proposal: item.plan });
    expect(outcome.state).toBe('waiting-human');
    const detail = item.store.getRun('operator', item.run.runRef);
    expect(detail.ok && detail.value.reviewReceipts).toHaveLength(0);
    expect(detail.ok && detail.value.reviewLoops[0].state).toBe('checking');
    expect(detail.ok && detail.value.stages.find((stage) => stage.stageId === 'release')?.state).toBe('blocked');
  });

  it('records a terminal checker receipt while an unrelated open boundary keeps normal work paused', async () => {
    const item = reviewFixture({ outcomes: [passOutcome()] });
    let detail = item.store.getRun('operator', item.run.runRef);
    if (!detail.ok) throw new Error(detail.detail);
    const subject = detail.value.stages.find((stage) => stage.stageId === 'subject') as NonNullable<typeof detail.value.stages[number]>;
    const subjectAttempt = item.store.createAttempt('operator', subject.stageRef, { expectedStageVersion: subject.version, runtime: 'codex', model: 'codex-safe' });
    if (!subjectAttempt.ok) throw new Error(subjectAttempt.detail);
    const subjectSession = item.store.createWorkerSession('operator', subjectAttempt.value.attemptRef, { expectedAttemptVersion: subjectAttempt.value.version });
    if (!subjectSession.ok) throw new Error(subjectSession.detail);
    let current = item.store.getRun('operator', item.run.runRef); if (!current.ok) throw new Error(current.detail);
    let currentSubject = current.value.stages.find((stage) => stage.stageRef === subject.stageRef) as typeof subject;
    expect(item.store.transitionStage('operator', currentSubject.stageRef, currentSubject.version, 'running').ok).toBe(true);
    let currentAttempt = item.store.getRun('operator', item.run.runRef); if (!currentAttempt.ok) throw new Error(currentAttempt.detail);
    let creator = currentAttempt.value.attempts.find((attempt) => attempt.attemptRef === subjectAttempt.value.attemptRef) as typeof subjectAttempt.value;
    expect(item.store.transitionAttempt('operator', creator.attemptRef, creator.version, 'starting').ok).toBe(true);
    currentAttempt = item.store.getRun('operator', item.run.runRef); if (!currentAttempt.ok) throw new Error(currentAttempt.detail);
    creator = currentAttempt.value.attempts.find((attempt) => attempt.attemptRef === creator.attemptRef) as typeof creator;
    expect(item.store.transitionAttempt('operator', creator.attemptRef, creator.version, 'running').ok).toBe(true);
    let sessions = item.store.getRun('operator', item.run.runRef); if (!sessions.ok) throw new Error(sessions.detail);
    let creatorSession = sessions.value.sessions.find((session) => session.sessionRef === subjectSession.value.sessionRef) as typeof subjectSession.value;
    expect(item.store.transitionSession('operator', creatorSession.sessionRef, creatorSession.version, 'starting').ok).toBe(true);
    sessions = item.store.getRun('operator', item.run.runRef); if (!sessions.ok) throw new Error(sessions.detail);
    creatorSession = sessions.value.sessions.find((session) => session.sessionRef === creatorSession.sessionRef) as typeof creatorSession;
    expect(item.store.transitionSession('operator', creatorSession.sessionRef, creatorSession.version, 'running').ok).toBe(true);
    sessions = item.store.getRun('operator', item.run.runRef); if (!sessions.ok) throw new Error(sessions.detail);
    creatorSession = sessions.value.sessions.find((session) => session.sessionRef === creatorSession.sessionRef) as typeof creatorSession;
    expect(item.store.transitionSession('operator', creatorSession.sessionRef, creatorSession.version, 'completed').ok).toBe(true);
    currentAttempt = item.store.getRun('operator', item.run.runRef); if (!currentAttempt.ok) throw new Error(currentAttempt.detail);
    creator = currentAttempt.value.attempts.find((attempt) => attempt.attemptRef === creator.attemptRef) as typeof creator;
    expect(item.store.transitionAttempt('operator', creator.attemptRef, creator.version, 'succeeded').ok).toBe(true);
    current = item.store.getRun('operator', item.run.runRef); if (!current.ok) throw new Error(current.detail);
    currentSubject = current.value.stages.find((stage) => stage.stageRef === subject.stageRef) as typeof subject;
    const afterCreator = item.store.getRun('operator', item.run.runRef); if (!afterCreator.ok) throw new Error(afterCreator.detail);
    const generation = item.store.recordStageGeneration('operator', subject.stageRef, {
      expectedStageVersion: currentSubject.version, expectedAttemptVersion: afterCreator.value.attempts.find((attempt) => attempt.attemptRef === creator.attemptRef)!.version,
      expectedGeneration: 1, operationKey: `result:${item.run.runRef}:subject`, resultHash: 'a'.repeat(64), resultCardRef: subject.canonicalCardRef,
      baseCommit: 'a'.repeat(40), canonicalCommit: 'b'.repeat(40),
    });
    if (!generation.ok) throw new Error(generation.detail);
    current = item.store.getRun('operator', item.run.runRef); if (!current.ok) throw new Error(current.detail);
    currentSubject = current.value.stages.find((stage) => stage.stageRef === subject.stageRef) as typeof subject;
    expect(item.store.transitionStage('operator', subject.stageRef, currentSubject.version, 'succeeded').ok).toBe(true);
    current = item.store.getRun('operator', item.run.runRef); if (!current.ok) throw new Error(current.detail);
    const checker = current.value.stages.find((stage) => stage.stageId === 'checker') as typeof subject;
    expect(item.store.transitionStage('operator', checker.stageRef, checker.version, 'ready').ok).toBe(true);
    current = item.store.getRun('operator', item.run.runRef); if (!current.ok) throw new Error(current.detail);
    const readyChecker = current.value.stages.find((stage) => stage.stageRef === checker.stageRef) as typeof checker;
    const checkerAttempt = item.store.createAttempt('operator', readyChecker.stageRef, { expectedStageVersion: readyChecker.version, runtime: 'codex', model: 'codex-safe',
      reviewSubjectGenerationRef: generation.value.generationRef, reviewSubjectResultHash: 'a'.repeat(64), reviewSubjectCanonicalCommit: 'b'.repeat(40) });
    if (!checkerAttempt.ok) throw new Error(checkerAttempt.detail);
    const checkerSession = item.store.createWorkerSession('operator', checkerAttempt.value.attemptRef, { expectedAttemptVersion: checkerAttempt.value.version });
    if (!checkerSession.ok) throw new Error(checkerSession.detail);
    const advance = (kind: 'stage' | 'attempt' | 'session', ref: string, state: 'running' | 'starting' | 'completed' | 'succeeded') => {
      const now = item.store.getRun('operator', item.run.runRef); if (!now.ok) throw new Error(now.detail);
      if (kind === 'stage') return item.store.transitionStage('operator', ref, now.value.stages.find((value) => value.stageRef === ref)!.version, state as never);
      if (kind === 'attempt') return item.store.transitionAttempt('operator', ref, now.value.attempts.find((value) => value.attemptRef === ref)!.version, state as never);
      return item.store.transitionSession('operator', ref, now.value.sessions.find((value) => value.sessionRef === ref)!.version, state as never);
    };
    expect(advance('stage', readyChecker.stageRef, 'running').ok).toBe(true);
    expect(advance('attempt', checkerAttempt.value.attemptRef, 'starting').ok).toBe(true); expect(advance('attempt', checkerAttempt.value.attemptRef, 'running').ok).toBe(true);
    expect(advance('session', checkerSession.value.sessionRef, 'starting').ok).toBe(true); expect(advance('session', checkerSession.value.sessionRef, 'running').ok).toBe(true); expect(advance('session', checkerSession.value.sessionRef, 'completed').ok).toBe(true);
    expect(advance('attempt', checkerAttempt.value.attemptRef, 'succeeded').ok).toBe(true); expect(advance('stage', readyChecker.stageRef, 'succeeded').ok).toBe(true);
    const payload = { summary: 'creator is safe', artifacts: [], changed: [], checkpoints: [], reviewOutcome: passOutcome() };
    item.results.set(`result:${item.run.runRef}:checker`, { ...payload, resultHash: canonicalStageResultHash(payload), durability: 'canonical', attemptBaseCommit: 'b'.repeat(40), integrationCommit: 'c'.repeat(40) });
    const request = item.store.createHumanRequest('operator', item.run.runRef, { stageRef: null, kind: 'approval', title: 'unrelated boundary', prompt: 'Pause normal work.' });
    expect(request.ok).toBe(true);
    const runBefore = item.store.getRun('operator', item.run.runRef); if (!runBefore.ok) throw new Error(runBefore.detail);
    expect(item.store.transitionRun('operator', item.run.runRef, runBefore.value.run.version, 'waiting-human').ok).toBe(true);
    const outcome = await item.engine.runToBoundary({ subject: 'operator', runRef: item.run.runRef, proposal: item.plan });
    expect(outcome.state).toBe('waiting-human');
    const final = item.store.getRun('operator', item.run.runRef);
    expect(final.ok && final.value.reviewReceipts).toHaveLength(1);
    expect(final.ok && final.value.reviewLoops[0].state).toBe('passed');
    expect(final.ok && final.value.humanRequests).toHaveLength(1);
    expect(final.ok && final.value.humanRequests[0].requestRef).toBe(request.ok && request.value.requestRef);
    expect(item.fake.executionOrder).toEqual([]);
    expect(final.ok && final.value.stages.find((stage) => stage.stageId === 'release')?.state).toBe('blocked');
  });

  it('replays a persisted failed receipt through one rework route without rerunning its checker', async () => {
    const item = reviewFixture({ outcomes: [failOutcome(), passOutcome()], maxCreatorReworks: 1 });
    const record = item.store.recordReviewReceipt.bind(item.store);
    let faulted = false;
    item.store.recordReviewReceipt = ((...args: Parameters<ControlPlaneStore['recordReviewReceipt']>) => {
      const saved = record(...args);
      if (!faulted && saved.ok) {
        faulted = true;
        throw new Error('simulated crash after persisted review receipt');
      }
      return saved;
    }) as ControlPlaneStore['recordReviewReceipt'];
    const completed = await item.engine.runToBoundary({ subject: 'operator', runRef: item.run.runRef, proposal: item.plan });
    expect(completed.state).toBe('succeeded');
    expect(item.fake.executionOrder.filter((id) => id === 'checker')).toHaveLength(2);
    const final = item.store.getRun('operator', item.run.runRef);
    expect(final.ok && final.value.reviewReceipts).toHaveLength(2);
    expect(final.ok && final.value.generationSupersessions).toHaveLength(1);
    expect(final.ok && final.value.humanRequests).toHaveLength(0);
  });

  it('releases equal-priority roots deterministically while honoring bounded concurrency', async () => {
    const store = createStore();
    const plan = proposal([stage('b'), stage('a'), stage('c', ['a'])]);
    const run = createApprovedRun(store, plan);
    const fake = fakes();
    const engine = new AutomaticExecutionEngine(engineOptions(store, fake));

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
        run: { state: 'waiting-human' },
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
    const assertIntentPersisted = (): void => {
      const detail = store.getRun('operator', run.runRef);
      if (!detail.ok) throw new Error(detail.detail);
      expect(detail.value.run.state).toBe('stopping');
      expect(store.listEvents('operator', run.runRef)).toMatchObject({
        ok: true, value: expect.arrayContaining([expect.objectContaining({ summary: expect.stringContaining('cancellation requested') })]),
      });
    };
    fake.cancellation = {
      async cancelManager(input) { assertIntentPersisted(); signaled.push(`manager:${input.sessionRef}`); },
      async cancelWorker(input) { assertIntentPersisted(); signaled.push(`worker:${input.sessionRef}`); release(); },
    };
    const engine = new AutomaticExecutionEngine(engineOptions(store, fake));
    const running = engine.runToBoundary({ subject: 'operator', runRef: run.runRef, proposal: plan });
    await enteredPromise;

    const cancelled = await engine.cancelRun({
      subject: 'operator', runRef: run.runRef, idempotencyKey: 'cancel-live-run', reason: 'Operator requested stop.',
    });
    await running;

    expect(cancelled).toMatchObject({ state: 'stopped', interruptedSessionRefs: [], replayed: false });
    expect(signaled.map((value) => value.split(':')[0]).sort()).toEqual(['manager', 'worker']);
    expect(fake.integrationOrder).toEqual([]);
    expect(store.getRun('operator', run.runRef)).toMatchObject({
      ok: true,
      value: {
        run: { state: 'stopped' },
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
      value: { run: { state: 'stopped' }, stages: [{ state: 'stopped' }], attempts: [{ state: 'stopped' }] },
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
      value: { run: { state: 'stopped' }, stages: [{ state: 'stopped' }], sessions: [{ role: 'manager', state: 'stopped' }] },
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
        run: { state: 'interrupted' },
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
    expect(interrupted).toMatchObject({ ok: true, value: { run: { state: 'interrupted' }, attempts: [{ state: 'interrupted' }] } });
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
