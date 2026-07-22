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

  it('refuses review stages before worker spawn until durable review-loop state exists', async () => {
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
    const execute = vi.fn(fake.workers.execute);
    fake.workers.execute = execute;
    const managerEnsure = vi.fn(fake.managers.ensure);
    const worktreeEnsure = vi.fn(fake.worktrees.ensure);
    const worktreeInspect = vi.fn(fake.worktrees.inspect);
    const worktreeRemove = vi.fn(fake.worktrees.remove);
    const reserve = vi.fn(fake.accounting.reserve);
    const settle = vi.fn(fake.accounting.settle);
    const resultLookup = vi.fn(fake.results.lookup);
    const resultBase = vi.fn(fake.results.resolveBase!);
    const resultIntegrate = vi.fn(fake.results.integrate);
    fake.managers.ensure = managerEnsure;
    fake.worktrees.ensure = worktreeEnsure;
    fake.worktrees.inspect = worktreeInspect;
    fake.worktrees.remove = worktreeRemove;
    fake.accounting.reserve = reserve;
    fake.accounting.settle = settle;
    fake.results.lookup = resultLookup;
    fake.results.resolveBase = resultBase;
    fake.results.integrate = resultIntegrate;
    const options = engineOptions(store, fake);
    const resolvePolicy = vi.fn(() => policy);
    const resolveAssignedAgent = vi.fn();
    const resolveSkills = vi.fn(options.skills.resolve);
    options.resolvePolicy = resolvePolicy;
    options.assignedAgents = { resolve: resolveAssignedAgent };
    options.skills = { resolve: resolveSkills };

    const engine = new AutomaticExecutionEngine(options);
    const outcome = await engine.runToBoundary({
      subject: 'operator', runRef: run.runRef, proposal: plan,
    });

    expect(outcome.state).toBe('waiting-human');
    expect(outcome.waitingStageIds).toEqual(['checker']);
    expect(resolvePolicy).not.toHaveBeenCalled();
    expect(resolveAssignedAgent).not.toHaveBeenCalled();
    expect(managerEnsure).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(worktreeEnsure).not.toHaveBeenCalled();
    expect(worktreeInspect).not.toHaveBeenCalled();
    expect(worktreeRemove).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
    expect(settle).not.toHaveBeenCalled();
    expect(resultLookup).not.toHaveBeenCalled();
    expect(resultBase).not.toHaveBeenCalled();
    expect(resultIntegrate).not.toHaveBeenCalled();
    expect(resolveSkills).not.toHaveBeenCalled();
    expect(fake.executionOrder).toEqual([]);
    const detail = store.getRun('operator', run.runRef);
    expect(detail).toMatchObject({ ok: true, value: {
      stages: [{ stageId: 'subject', state: 'ready' }, { stageId: 'checker', state: 'waiting-human' }, { stageId: 'release', state: 'blocked' }],
      humanRequests: [{ kind: 'governance-refusal', prompt: 'review-loop-durable-state-not-yet-available', state: 'open' }],
    } });
    await engine.runToBoundary({ subject: 'operator', runRef: run.runRef, proposal: plan });
    const replay = store.getRun('operator', run.runRef);
    expect(replay).toMatchObject({ ok: true, value: { humanRequests: [{ title: 'automatic:policy:checker:review-loop-durable-state-not-yet-available' }] } });
    expect(replay.ok && replay.value.humanRequests).toHaveLength(1);
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
