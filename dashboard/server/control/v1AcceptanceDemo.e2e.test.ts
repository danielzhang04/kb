/**
 * v1 launch acceptance — the demo path end to end against the REAL engine.
 *
 * Nothing about `AutomaticExecutionEngine`, the control-plane store, or the Fastify control routes is
 * mocked here. What is faked is only what a test cannot physically own: the session hosts (the worker
 * adapter), the git worktree/integrator plumbing, and the WebAuthn signature check. Every assertion
 * below is therefore a statement about shipped behaviour, not about a stub.
 *
 * Scenarios
 *   1. Parallel research -> dependent synthesis -> judge rejects cycle 1, passes cycle 2 (F1, F2).
 *   2. The completion gate: generic respond refused, unsigned resolve refused, T3 ceremony resolves once.
 *   3. The declared artifact downloads through GET /api/control/files with its bound digest (F4).
 *   4. Two independent runs on different topics, both complete, both artifacts downloadable.
 *   5. Recovery: a session dies mid-attempt with unknown physical state; resume does not re-run the
 *      predecessor whose canonical effect already landed.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { mintSession, type SessionConfig } from '../auth/session.ts';
import { makeSurfaceContext, registerWriteSurface } from '../http/surface.ts';
import { sha256HexBytes } from '../shared/hashing.ts';
import { serverOwnedOutputRoots } from './artifactFilesRoute.ts';
import { createOutputDigestReader } from './artifactFiles.ts';
import { projectOutputRef } from '../entities/outputs.ts';
import { createInMemoryControlPlaneStore, type ControlPlaneStore } from './store.ts';
import { ARTIFACT_PRODUCING_REQUEST_KINDS, proposalContentHash, validateServerCompiledPlanProposal } from './proposal.ts';
import type { PlanProposal } from './proposal.ts';
import type { JsonObject } from './types.ts';
import type { PolicyEnvironment } from './policy.ts';
import { buildApprovedAttemptDeclaration, buildWorkerPrompt } from './claudeWorkerAdapter.ts';
import { createCuratedContextResolver } from './adapters.ts';
import {
  AutomaticExecutionEngine,
  type AccountingAdapter,
  type AutomaticExecutionOptions,
  type CuratedContextResolver,
  type ManagerAdapter,
  type ResultIntegrator,
  type WorkerAdapter,
  type WorkerExecutionResult,
  type WorktreeAdapter,
} from './execution.ts';
import { loadWorkflowCompileEnvironment } from './environment.ts';
import { compileWorkflowDef } from '../workflows/compile.ts';
import { instantiateWorkflowDef, parseWorkflowDef } from '../workflows/defs.ts';
import { loadOrgDef } from '../workflows/orgDefSource.ts';

/**
 * The WebAuthn SIGNATURE check is the only part of the T3 ceremony a Fastify `inject` cannot produce, so
 * it is the only export stubbed. Mint, purpose binding, single-use consumption, expiry and origin all run
 * real — exactly as `routes.test.ts` does it.
 */
vi.mock('../auth/webauthn.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../auth/webauthn.ts')>();
  return { ...actual, verifyAssertion: async () => ({ verified: true }) };
});

const DEF_PATH = 'orgs/kb-ops/workflows/v1-acceptance-demo.md';
const SOURCE = loadOrgDef(DEF_PATH);
const KB_ROOT = SOURCE.origin.slice(0, SOURCE.origin.length - DEF_PATH.split('/').join(sep).length);
const ENVIRONMENT = loadWorkflowCompileEnvironment(KB_ROOT);

const SESSION: SessionConfig = { secret: Buffer.from('v1-acceptance-demo-secret-32-byte!'), ttlMs: 60_000 };
const ORIGIN = 'http://localhost:5317';
const CRED = { id: 'cred-1', publicKey: new Uint8Array([1]), counter: 0 };

const tempDirs: string[] = [];
afterAll(() => { for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true }); });
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

// ---------------------------------------------------------------------------------------------
// The compiled demo plan — the same path `compile.v1AcceptanceDemo.test.ts` proves, per topic.
// ---------------------------------------------------------------------------------------------

function compileDemo(topic: string): PlanProposal {
  const parsed = parseWorkflowDef(SOURCE.text, { knownProfiles: new Set(ENVIRONMENT.registry.workflowProfiles ?? []) });
  if (!parsed.ok) throw new Error(parsed.detail);
  const instantiated = instantiateWorkflowDef(parsed.value, { topic });
  if (!instantiated.ok) throw new Error(instantiated.detail);
  const compiled = compileWorkflowDef(instantiated.value, ENVIRONMENT);
  if (!compiled.ok) throw new Error(`${compiled.reason}: ${compiled.detail}`);
  const validated = validateServerCompiledPlanProposal(compiled.value, ENVIRONMENT.registry);
  if (!validated.ok) throw new Error(validated.detail);
  return validated.value;
}

/** A policy environment that admits exactly the runtimes/models the compiled demo plan names. */
function demoPolicy(plan: PlanProposal): PolicyEnvironment {
  const profiles: PolicyEnvironment['profiles'] = [{
    id: 'manager', role: 'manager', runtime: plan.manager.runtime as 'claude' | 'codex', model: plan.manager.model,
    capabilities: ['read', 'emit-events'],
  }];
  const seen = new Set<string>();
  for (const stage of plan.stages) {
    const key = `${stage.worker.runtime}/${stage.worker.model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    profiles.push({
      id: `worker-${seen.size}`, role: 'worker', runtime: stage.worker.runtime as 'claude' | 'codex', model: stage.worker.model,
      capabilities: ['read', 'write-approved-scope', 'run-approved-commands', 'emit-events'],
    });
  }
  return {
    profiles,
    curatedSkills: new Set(plan.stages.flatMap((stage) => stage.requiredSkills)),
    contractText: 'queues-for-me',
    governanceContents: Object.fromEntries(plan.governanceRefs.map((ref) => [ref, `governance:${ref}`])),
  };
}

let sequence = 0;
function launchRun(store: ControlPlaneStore, plan: PlanProposal): { runRef: string } {
  const created = store.createProposalRevision('operator', {
    sourceComposerRef: `composer-${++sequence}`, sourceTurnId: `turn-${sequence}`,
    title: plan.title, snapshot: plan as unknown as JsonObject,
  });
  if (!created.ok) throw new Error(created.detail);
  const approved = store.decideProposal('operator', created.value.proposalRef, 1, {
    expectedHash: created.value.hash, expectedApprovalRevision: 0, decision: 'approved',
    idempotencyKey: `approve-${created.value.proposalRef}`,
  });
  if (!approved.ok) throw new Error(approved.detail);
  const run = store.createRun('operator', {
    owner: { type: 'agent', id: 'grader', sourcePath: 'agents/grader.md' },
    executionHost: 'desktop',
    title: plan.title, proposalRef: created.value.proposalRef, proposalRevision: 1,
    expectedProposalHash: created.value.hash,
    managerRuntime: plan.manager.runtime, managerModel: plan.manager.model,
    managerAssignment: plan.manager.assignment,
    idempotencyKey: `launch-${created.value.proposalRef}`,
    iterationGroups: plan.iterationGroups,
    stages: plan.stages.map((item) => ({
      stageId: item.id, title: item.title, dependsOn: item.dependsOn, assignment: item.assignment,
      workflowProfile: item.workflowProfile, review: item.review, completionGate: item.completionGate,
    })),
  });
  if (!run.ok) throw new Error(run.detail);
  for (const item of run.value.stages) {
    const linked = store.linkStageCard('operator', item.stageRef, item.version, `card-${item.stageId}`);
    if (!linked.ok) throw new Error(linked.detail);
  }
  expect(run.value.run.proposalHash).toBe(proposalContentHash(plan));
  return { runRef: run.value.run.runRef };
}

// ---------------------------------------------------------------------------------------------
// Fake session hosts. The engine, store, prompt builder, routes and gates below are all real.
// ---------------------------------------------------------------------------------------------

type BeginInput = Parameters<WorkerAdapter['begin']>[0];

interface DemoHarness {
  store: ControlPlaneStore;
  plan: PlanProposal;
  runRef: string;
  engine: AutomaticExecutionEngine;
  repoRoot: string;
  /** Every `workers.begin` input, in order — one per fake session start. */
  starts: BeginInput[];
  integrations: Parameters<ResultIntegrator['integrate']>[0][];
  prompts: Map<string, string[]>;
}

interface HarnessOptions {
  topic: string;
  /** Marker text each researcher's canonical summary carries, keyed by stage id. */
  markers: Record<string, string>;
  /** Stage ids whose FIRST fake session start dies with unknown physical state. */
  dieOnce?: readonly string[];
  store?: ControlPlaneStore;
  repoRoot?: string;
  maxConcurrency?: number;
  curatedContext?: CuratedContextResolver;
}

/**
 * Builds the fixture repo the run writes into: a real `orgs/kb-ops/workflows/*.md`, which is the only
 * thing that puts `orgs/kb-ops` into the server-owned output roots the download route derives.
 */
function makeFixtureRepo(): string {
  const repoRoot = tempDir('v1-demo-repo-');
  mkdirSync(join(repoRoot, 'orgs', 'kb-ops', 'workflows'), { recursive: true });
  writeFileSync(join(repoRoot, 'orgs', 'kb-ops', 'workflows', 'v1-acceptance-demo.md'),
    '---\nid: v1-acceptance-demo\nproject: kb-ops\n---\n');
  writeFileSync(join(repoRoot, 'orgs', 'kb-ops', 'STATE.md'), '# kb-ops STATE\nThe v1 launch lane is open.\n');
  return repoRoot;
}

function harness(options: HarnessOptions): DemoHarness {
  const plan = compileDemo(options.topic);
  const store = options.store ?? createInMemoryControlPlaneStore({ newId: () => `id-${++sequence}` });
  const { runRef } = launchRun(store, plan);
  const repoRoot = options.repoRoot ?? makeFixtureRepo();
  const worktreeRoot = tempDir('v1-demo-worktrees-');

  const starts: BeginInput[] = [];
  const integrations: Parameters<ResultIntegrator['integrate']>[0][] = [];
  const prompts = new Map<string, string[]>();
  const results = new Map<string, Awaited<ReturnType<ResultIntegrator['lookup']>>>();
  const ensuredBases: Array<{ path: string; baseCommit?: string }> = [];
  const died = new Set<string>();
  let canonicalHead: string | null = null;
  let judgeTurns = 0;

  const artifactPathsFor = (stageId: string) =>
    plan.stages.find((stage) => stage.id === stageId)?.artifacts ?? [];

  const worktrees: WorktreeAdapter = {
    async ensure(input) {
      ensuredBases.push({ path: input.path, baseCommit: input.baseCommit });
      mkdirSync(input.path, { recursive: true });
      if (input.baseCommit) {
        for (const artifact of plan.stages.flatMap((stage) => stage.artifacts)) {
          const path = join(input.path, artifact.path);
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, `pinned:${artifact.path}`, 'utf8');
        }
      }
    },
    async inspect(input) {
      const attemptRef = input.path.split(/[\\/]/).at(-1);
      const start = [...starts].reverse().find((candidate) => candidate.attemptRef === attemptRef);
      const startedStage = start?.proposalStage?.id ?? start?.stageRef ?? '';
      if ((options.dieOnce ?? []).includes(startedStage) && !died.has(startedStage)) {
        died.add(startedStage);
        // The session host vanished mid-attempt: the worker was launched, and the server can no longer
        // determine what it physically did. This escapes the launch envelope, which is exactly the
        // condition the engine must contain as `interrupted` plus one intervention -- never a silent
        // failure, and never a second automatic attempt.
        throw new Error(`session host for ${startedStage} died with unknown physical state`);
      }
      const producing = !start?.iterationContract
        || ARTIFACT_PRODUCING_REQUEST_KINDS.has(start.iterationContract.request.kind);
      const declared = start?.proposalStage?.artifacts ?? [];
      return { changed: producing ? declared.map((artifact) => ({ path: artifact.path, digest: 'b'.repeat(64) })) : [] };
    },
    async remove() {},
  };

  const managers: ManagerAdapter = { async ensure() {} };

  const accounting: AccountingAdapter = {
    async reserve(input) { return { ok: true, value: { reservationRef: `reservation:${input.attemptRef}`, replayed: false } }; },
    async settle() {},
  };

  /** The fake session host: one `begin` per physical session start. */
  const workers: WorkerAdapter = {
    begin(input) {
      starts.push(input);
      const stageId = input.proposalStage?.id ?? input.stageRef;
      // The REAL production path: the shipped declaration builder over the engine's launch input, then
      // the shipped prompt builder over that declaration. Building the prompt straight from `input`
      // would skip `buildApprovedAttemptDeclaration`, which is exactly where a dropped field hides.
      const declaration = buildApprovedAttemptDeclaration(input, input.profile.runtime as 'claude' | 'codex', worktreeRoot);
      const prompt = buildWorkerPrompt({
        workOrder: declaration.workOrder,
        readScope: declaration.readScope,
        writeScope: declaration.writeScope,
        dependencyResults: declaration.dependencyResults,
        curatedContext: declaration.curatedContext,
        proposalStage: declaration.proposalStage,
        ...(declaration.iterationContract ? { iterationContract: declaration.iterationContract } : {}),
      });
      prompts.set(stageId, [...(prompts.get(stageId) ?? []), prompt]);

      const receipt = Promise.resolve({
        ok: true as const,
        value: {
          operationKey: input.operationKey, sessionId: `session-${input.attemptRef}`,
          attemptRef: input.attemptRef, revision: 1, boundAt: new Date(0).toISOString(), replayed: false,
        },
      });
      return { receipt, result: receipt.then(() => execute(input, stageId)) };
    },
  };

  async function execute(input: BeginInput, stageId: string): Promise<WorkerExecutionResult> {
    const contract = input.iterationContract;
    const producing = contract !== undefined && ARTIFACT_PRODUCING_REQUEST_KINDS.has(contract.request.kind);
    for (const artifact of artifactPathsFor(stageId)) {
      const path = join(input.worktreePath, artifact.path);
      mkdirSync(dirname(path), { recursive: true });
      const revision = producing ? 2 : 1;
      writeFileSync(path, `${JSON.stringify({
        topic: options.topic, sourcesListed: producing, revision,
        summary: `synthesis of ${Object.values(options.markers).join(' + ')}`,
      }, null, 2)}\n`, 'utf8');
    }
    const usage = { inputTokens: 1, outputTokens: 1, costUsdMicros: 1 };

    if (!contract) {
      // A plain stage turn: the researchers and the writer's seed generation.
      return {
        state: 'succeeded',
        summary: options.markers[stageId] ?? `${stageId} completed`,
        usage, artifacts: [], checkpoints: input.checkpoints.length > 0 ? [...input.checkpoints] : [],
      };
    }

    const judge = contract.request.recipientParticipantId === 'brief-judge';
    if (judge) judgeTurns += 1;
    // Cycle 1 rejects the planted `sourcesListed: false` defect; cycle 2 passes the exact successor.
    const verdict: 'fail' | 'pass' | 'fulfilled' = judge ? (judgeTurns === 1 ? 'fail' : 'pass') : 'fulfilled';
    const findingId = `missing-sources-c${contract.request.cycle}`;
    const outcome = {
      schema: 'kb.iteration-outcome/v1' as const,
      requestRef: contract.request.requestRef,
      iterationLoopRef: contract.request.iterationLoopRef,
      participantId: contract.request.recipientParticipantId,
      cycle: contract.request.cycle,
      verdict,
      inputGenerationRefs: [...contract.request.inputGenerationRefs],
      criteria: verdict === 'fulfilled' ? [] : [{
        criterionId: 'sources-listed',
        verdict: verdict === 'pass' ? 'pass' as const : 'fail' as const,
        findingIds: verdict === 'fail' ? [findingId] : [],
      }],
      findings: verdict === 'fail' ? [{
        findingId, criterionId: 'sources-listed', severity: 'blocking' as const,
        summary: 'sourcesListed is false and no sources array is present.', evidencePaths: [],
      }] : [],
      positions: [], recordedDissent: [],
      summary: verdict === 'fulfilled' ? 'The sourced successor brief is committed.'
        : verdict === 'pass' ? 'The successor lists its sources.' : 'The draft lists no sources.',
    };
    return {
      state: 'succeeded', summary: outcome.summary, usage, artifacts: [],
      checkpoints: verdict === 'fulfilled' && input.checkpoints.length > 0 ? [...input.checkpoints] : [],
      iterationOutcome: outcome,
    };
  }

  const resultIntegrator: ResultIntegrator = {
    async lookup(input) { return results.get(input.operationKey) ?? null; },
    async resolveBase(input) {
      if (input.dependencyStageIds.length === 0 || !input.dependencyResultOperationKeys
        || input.dependencyResultOperationKeys.length !== input.dependencyStageIds.length) return null;
      const records = input.dependencyResultOperationKeys.map((dep) => results.get(dep.operationKey));
      if (records.some((record) => record?.durability !== 'canonical')) return null;
      return canonicalHead;
    },
    async integrate(input) {
      integrations.push(input);
      const ensured = ensuredBases.find((candidate) => candidate.path === input.worktreePath);
      const attemptBaseCommit = ensured?.baseCommit ?? 'a'.repeat(40);
      const integrationCommit = input.changed.length > 0
        ? integrations.length.toString(16).padStart(40, '0') : attemptBaseCommit;
      // Every canonical integration advances the head, including a turn that changed no declared file:
      // the dependent's lineage resolution must still find a commit to base on.
      canonicalHead = integrationCommit;
      // The canonical effect on the real repo: the declared artifact lands where the download route
      // will look for it.
      for (const changed of input.changed) {
        const source = join(input.worktreePath, changed.path);
        const destination = join(repoRoot, changed.path);
        mkdirSync(dirname(destination), { recursive: true });
        try { writeFileSync(destination, readFileSync(source)); } catch { /* nothing produced */ }
      }
      results.set(input.operationKey, {
        summary: input.summary, artifacts: [...input.artifacts], changed: [...input.changed],
        checkpoints: [...input.checkpoints],
        ...(input.iterationOutcome ? { iterationOutcome: input.iterationOutcome } : {}),
        resultHash: input.resultHash, durability: 'canonical' as const, attemptBaseCommit, integrationCommit,
      });
      return {
        status: 'integrated' as const, resultHash: input.resultHash,
        durability: 'canonical' as const, attemptBaseCommit, integrationCommit,
      };
    },
  };

  const engineOptions: AutomaticExecutionOptions = {
    store, policy: demoPolicy(plan), worktreeRoot, maxConcurrency: options.maxConcurrency ?? plan.maxConcurrency ?? 2,
    budget: { maxAttempts: 8, maxInputTokens: 100_000, maxOutputTokens: 100_000, maxCostUsdMicros: 1_000_000 },
    attemptBudget: { maxAttempts: 2, maxInputTokens: 10_000, maxOutputTokens: 10_000, maxCostUsdMicros: 100_000 },
    worktrees, managers, workers, accounting,
    skills: { async resolve(input) { return { ok: true, skills: [...input.requested] }; } },
    results: resultIntegrator,
    cancellation: { async cancelManager() {}, async cancelWorker() {} },
    curatedContext: options.curatedContext ?? createCuratedContextResolver(repoRoot),
  };
  return {
    store, plan, runRef, repoRoot, starts, integrations, prompts,
    engine: new AutomaticExecutionEngine(engineOptions),
  };
}

function drive(demo: DemoHarness) {
  return demo.engine.runToBoundary({ subject: 'operator', runRef: demo.runRef, proposal: demo.plan });
}

/** Every non-success lifecycle summary the run recorded — the engine's own reason, never a guess. */
function failureSummaries(demo: DemoHarness): string[] {
  const listed = demo.store.listEvents('operator', demo.runRef, 0, 500);
  if (!listed.ok) throw new Error(listed.detail);
  return listed.value
    .filter((event) => event.status !== 'success')
    .map((event) => `${event.stageRef}:${event.status}:${event.summary ?? ''}`);
}

function detailOf(demo: DemoHarness) {
  const detail = demo.store.getRun('operator', demo.runRef);
  if (!detail.ok) throw new Error(detail.detail);
  return detail.value;
}

// ---------------------------------------------------------------------------------------------
// The control surface — real routes over the SAME store the engine just drove.
// ---------------------------------------------------------------------------------------------

function surface(store: ControlPlaneStore, repoRoot: string) {
  const auditRows: Record<string, unknown>[] = [];
  const stateRoot = tempDir('v1-demo-state-');
  const app = Fastify();
  registerWriteSurface(app, makeSurfaceContext({
    repoRoot, stateRoot, sessionConfig: SESSION, allowedOrigins: [ORIGIN],
    webAuthnConfig: () => ({ rpID: 'localhost', rpName: 'test', origin: ORIGIN }),
    credentials: () => [CRED],
    controlStore: store,
    appendAudit: (_root, event) => { auditRows.push(event as unknown as Record<string, unknown>); return { ts: new Date().toISOString(), ...event }; },
    appendAuditLocal: (_root, event) => { auditRows.push(event as unknown as Record<string, unknown>); return { ts: new Date().toISOString(), ...event }; },
  }));
  return { app, auditRows, token: mintSession('operator', SESSION).token };
}

function headers(token: string) {
  return { origin: ORIGIN, host: 'localhost:5317', authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

let openApps: FastifyInstance[] = [];
afterEach(async () => {
  for (const app of openApps) await app.close();
  openApps = [];
});

/**
 * DEFECT FOUND AND FIXED AT THE SOURCE (execution.ts:1873-1881 + :714-720): `restrictedIntent` parks a
 * stage whose work-order PROSE carries spending vocabulary, and `restrictedReleased` releases ONLY the
 * publication reason — a `spending-language-requires-human-review` park therefore re-mints on every
 * reconciliation pass and never clears, exactly as the engine's own comment says ("it re-parks on the
 * next pass... the def must be reworded"). The shipped demo def said "spend no money" in both researcher
 * work orders, so the v1 launch demo could not reach its first worker at all. The def was reworded
 * ("incur no cost"), which is the engine's documented remedy. This walker is the REGRESSION GUARD: it
 * would clear such gates and report them, and the scenario asserts it clears none. It never touches the
 * iteration completion gate, which is scenario 2's subject.
 */
async function walkPolicyGates(demo: DemoHarness): Promise<{ outcome: Awaited<ReturnType<typeof drive>>; policyGatesCleared: string[] }> {
  const policyGatesCleared: string[] = [];
  let outcome = await drive(demo);
  for (let guard = 0; guard < 12; guard += 1) {
    if (outcome.state !== 'waiting-human') break;
    const open = detailOf(demo).humanRequests.filter((request) =>
      request.state === 'open' && request.kind === 'approval' && request.title.startsWith('automatic:policy:'));
    if (open.length === 0) break;
    for (const request of open) {
      const responded = demo.store.respondHumanRequest('operator', request.requestRef, {
        expectedRevision: request.revision, decision: 'approved',
        idempotencyKey: `policy-${request.requestRef}`, response: 'Reviewed: read-only research, no spend.',
      });
      if (!responded.ok) throw new Error(responded.detail);
      policyGatesCleared.push(request.title);
    }
    outcome = await drive(demo);
  }
  return { outcome, policyGatesCleared };
}

/** Drives the demo through its policy gates to the iteration completion gate. */
async function driveToGate(topic: string, markers: Record<string, string>) {
  const demo = harness({ topic, markers });
  const { outcome, policyGatesCleared } = await walkPolicyGates(demo);
  return { demo, outcome, policyGatesCleared };
}

describe('v1 acceptance demo — parallel research, dependent synthesis, bounded judge cycle', () => {
  it('runs both researchers, feeds BOTH canonical summaries to the writer, and bounds the judge at 2 cycles', async () => {
    const markers = { 'researcher-a': 'MARKER-ALPHA-tailnet-history', 'researcher-b': 'MARKER-BETA-tailnet-impact' };
    const { demo, outcome, policyGatesCleared } = await driveToGate('tailnet-trust', markers);
    // No stage work order trips the restricted-intent scan, so no stage parks before execution.
    expect(policyGatesCleared).toEqual([]);

    // The run parks on the human completion gate, not on a failure.
    expect(outcome.state).toBe('waiting-human');

    // Both researchers ran, with no dependency between them.
    const startedStages = demo.starts.map((start) => start.proposalStage?.id ?? start.stageRef);
    expect(startedStages.filter((id) => id === 'researcher-a')).toHaveLength(1);
    expect(startedStages.filter((id) => id === 'researcher-b')).toHaveLength(1);

    // F2 — the writer's prompt carries BOTH predecessor canonical summaries under DEPENDENCY RESULTS.
    const writerPrompt = demo.prompts.get('writer')?.[0];
    expect(writerPrompt).toBeDefined();
    const depSection = writerPrompt!.slice(writerPrompt!.indexOf('DEPENDENCY RESULTS:'));
    expect(writerPrompt).toContain('DEPENDENCY RESULTS:');
    expect(depSection).toContain(markers['researcher-a']);
    expect(depSection).toContain(markers['researcher-b']);

    // F1 — the curated context arrives inside the inert boundary. kb-ops has no GOAL.md in the fixture
    // repo, so the STATE.md block is the frame that resolves.
    expect(writerPrompt).toContain('INERT CONTEXT BOUNDARY');
    expect(writerPrompt).toContain('PROJECT FRAME: STATE.md');

    // The judge failed cycle 1 and passed cycle 2; the loop stopped at 2, never reached 3.
    const detail = detailOf(demo);
    const loop = detail.iterationLoops[0];
    expect(loop.cyclesUsed).toBe(2);
    expect(loop.maxCycles).toBe(2);
    expect(loop.cyclesUsed).toBeLessThanOrEqual(loop.maxCycles);
    const verdicts = detail.iterationReceipts.map((receipt) => receipt.verdict);
    expect(verdicts).toEqual(['fail', 'fulfilled', 'pass']);
  });
});

// ---------------------------------------------------------------------------------------------
// Scenario 2 + 3 — the completion gate and the declared artifact.
// ---------------------------------------------------------------------------------------------

/** The completion gate the run is parked on, plus the exact CAS tuple a resolve must carry. */
function gateBinding(demo: DemoHarness) {
  const detail = detailOf(demo);
  const loop = detail.iterationLoops[0];
  const gate = detail.humanRequests.find((request) => request.requestRef === loop.completionGateRef);
  if (!gate) throw new Error('completion gate missing');
  const receipt = loop.lastReceiptRef === undefined ? null
    : detail.iterationReceipts.find((candidate) => candidate.receiptRef === loop.lastReceiptRef) ?? null;
  return {
    gate, loop,
    payload: {
      expectedGateRef: gate.requestRef,
      expectedGateKind: gate.gateKind ?? null,
      expectedParkReason: loop.parkReason ?? null,
      expectedRequestRevision: gate.revision,
      expectedLoopVersion: loop.version,
      expectedReceiptVersion: receipt?.version ?? null,
      expectedGenerationRefs: [...loop.activeGenerationRefs],
      decision: 'approved',
    } as Record<string, unknown>,
  };
}

/** The digest the SHIPPED outputs projection binds for a declared artifact, read off the real repo. */
function projectedArtifactDigest(repoRoot: string, path: string): string | undefined {
  const roots = serverOwnedOutputRoots(repoRoot);
  const projected = projectOutputRef(
    { kind: 'artifact', label: 'brief.json', rootId: 'kb-ops', path },
    roots, createOutputDigestReader(repoRoot, roots),
  );
  return projected.kind === 'external-pr' ? undefined : projected.digest;
}

function declaredArtifactPath(demo: DemoHarness): string {
  const path = demo.plan.stages.find((stage) => stage.id === 'writer')?.artifacts[0]?.path;
  if (!path) throw new Error('writer declares no artifact');
  return path;
}

describe('v1 acceptance demo — the human completion gate is a real T3 ceremony', () => {
  it('reserves the gate from generic respond, refuses an unsigned resolve, verifies once, refuses the replay', async () => {
    // Two runs in ONE store, so a ceremony minted for the first gate can be replayed against a SECOND
    // gate that is still open -- the only way to prove single-use consumption after the first closes.
    const store = createInMemoryControlPlaneStore({ newId: () => `id-${++sequence}` });
    const repoRoot = makeFixtureRepo();
    const demo = harness({ topic: 'gate-topic', store, repoRoot, markers: { 'researcher-a': 'MARKER-GATE-A', 'researcher-b': 'MARKER-GATE-B' } });
    expect((await walkPolicyGates(demo)).outcome.state).toBe('waiting-human');
    const other = harness({ topic: 'gate-topic-two', store, repoRoot, markers: { 'researcher-a': 'OTHER-A', 'researcher-b': 'OTHER-B' } });
    expect((await walkPolicyGates(other)).outcome.state).toBe('waiting-human');

    const { gate, payload } = gateBinding(demo);
    expect(gate.state).toBe('open');
    expect(gate.kind).toBe('approval');
    // A completion gate carries no `gateKind` (only park gates do), so the CAS tuple binds null.
    expect(gate.gateKind ?? null).toBeNull();
    expect(gate.title).toBe('Iteration completion: brief-review');

    const { app, auditRows, token } = surface(demo.store, demo.repoRoot);
    openApps.push(app);
    await app.ready();
    const authorizeRows = () => auditRows.filter((row) => row.action === 'control-iteration-gate-authorize');

    // (a) The generic human-response route refuses a reserved iteration gate.
    const generic = await app.inject({
      method: 'POST', url: `/api/control/human-requests/${gate.requestRef}/respond`, headers: headers(token),
      payload: { expectedRevision: gate.revision, decision: 'approved', idempotencyKey: 'generic-bypass' },
    });
    expect(generic.statusCode, generic.body).toBe(409);
    expect(generic.json()).toMatchObject({ error: 'iteration-gate-reserved' });

    // (b) The reserved route itself refuses a resolve carrying no assertion, and writes no T3 row.
    const unsigned = await app.inject({
      method: 'POST', url: `/api/control/iteration-gates/${gate.requestRef}/resolve`,
      headers: headers(token), payload: { ...payload, idempotencyKey: 'unsigned' },
    });
    expect(unsigned.statusCode, unsigned.body).toBe(403);
    expect(unsigned.json()).toEqual({ error: 'ceremony-invalid' });
    expect(authorizeRows()).toEqual([]);

    // (c) Mint the challenge and resolve with the (stubbed-verify) assertion over the server's tuple.
    const minted = await app.inject({
      method: 'POST', url: `/api/control/iteration-gates/${gate.requestRef}/challenge`,
      headers: headers(token), payload: { decision: 'approved' },
    });
    expect(minted.statusCode, minted.body).toBe(200);
    const body = minted.json() as { ceremonyId: string; challengeExpiresAt: string };
    const signed = { ceremonyId: body.ceremonyId, assertion: { id: CRED.id }, challengeExpiresAt: body.challengeExpiresAt };
    const resolvePayload = { ...payload, idempotencyKey: 'signed-completion', ...signed };

    const resolved = await app.inject({
      method: 'POST', url: `/api/control/iteration-gates/${gate.requestRef}/resolve`,
      headers: headers(token), payload: resolvePayload,
    });
    expect(resolved.statusCode, resolved.body).toBe(200);
    expect(authorizeRows()).toHaveLength(1);
    expect(authorizeRows()[0]).toMatchObject({ riskTier: 'T3', result: 'authorized:approved' });

    // (d) The identical request replayed is idempotent BY DESIGN (routes.ts:2209 short-circuits the
    // ceremony once the gate is `resolved`), so it returns the same 200 -- but it re-verifies nothing
    // and writes no second T3 row. Asserted explicitly rather than assumed to be a refusal.
    const idempotent = await app.inject({
      method: 'POST', url: `/api/control/iteration-gates/${gate.requestRef}/resolve`,
      headers: headers(token), payload: resolvePayload,
    });
    expect(idempotent.statusCode, idempotent.body).toBe(200);
    expect(idempotent.json()).toMatchObject({ replayed: true });
    expect(authorizeRows()).toHaveLength(1);

    // (e) Single use: the SAME ceremonyId replayed against a DIFFERENT, still-open gate is refused and
    // writes no T3 row. This is the assertion that fails if the challenge is ever made reusable.
    const otherGate = gateBinding(other);
    expect(otherGate.gate.state).toBe('open');
    const stolen = await app.inject({
      method: 'POST', url: `/api/control/iteration-gates/${otherGate.gate.requestRef}/resolve`,
      headers: headers(token),
      payload: { ...otherGate.payload, idempotencyKey: 'stolen-ceremony', ...signed },
    });
    expect(stolen.statusCode, stolen.body).toBe(403);
    expect(stolen.json()).toEqual({ error: 'ceremony-invalid' });
    expect(authorizeRows()).toHaveLength(1);
  });
});

describe('v1 acceptance demo — the declared artifact downloads by digest', () => {
  it('serves the exact bytes for the projected digest and refuses a tampered one', async () => {
    const { demo } = await driveToGate('artifact-topic', {
      'researcher-a': 'MARKER-ART-A', 'researcher-b': 'MARKER-ART-B',
    });
    const path = declaredArtifactPath(demo);
    const onDisk = readFileSync(join(demo.repoRoot, path));
    expect(onDisk.length).toBeGreaterThan(0);
    // The repaired successor is what landed: the planted defect is gone.
    expect(JSON.parse(onDisk.toString('utf8'))).toMatchObject({ sourcesListed: true, revision: 2 });

    const digest = projectedArtifactDigest(demo.repoRoot, path);
    expect(digest).toBe(sha256HexBytes(onDisk));

    const { app, token } = surface(demo.store, demo.repoRoot);
    openApps.push(app);
    await app.ready();
    const url = (sha: string) => `/api/control/files?path=${encodeURIComponent(path)}&sha256=${encodeURIComponent(sha)}`;

    const ok = await app.inject({ method: 'GET', url: url(digest!), headers: headers(token) });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.rawPayload.equals(onDisk)).toBe(true);
    expect(ok.headers['content-disposition']).toBe('attachment; filename="brief.json"');
    expect(ok.headers['x-content-type-options']).toBe('nosniff');

    const tampered = await app.inject({ method: 'GET', url: url('a'.repeat(64)), headers: headers(token) });
    expect(tampered.statusCode).toBe(409);
    expect(tampered.body).toBe('');
  });
});

describe('v1 acceptance demo — two topics run independently', () => {
  it('completes two runs with distinct run refs and two separately downloadable artifacts', async () => {
    const first = await driveToGate('topic-one', { 'researcher-a': 'ONE-A', 'researcher-b': 'ONE-B' });
    const second = await driveToGate('topic-two', { 'researcher-a': 'TWO-A', 'researcher-b': 'TWO-B' });

    expect(first.demo.runRef).not.toBe(second.demo.runRef);
    for (const run of [first, second]) {
      expect(run.outcome.state).toBe('waiting-human');
      expect(detailOf(run.demo).iterationLoops[0].cyclesUsed).toBe(2);
    }

    const paths = [declaredArtifactPath(first.demo), declaredArtifactPath(second.demo)];
    expect(paths[0]).not.toBe(paths[1]);
    expect(paths[0]).toContain('topic-one');
    expect(paths[1]).toContain('topic-two');

    for (const [index, run] of [first, second].entries()) {
      const path = paths[index];
      const bytes = readFileSync(join(run.demo.repoRoot, path));
      const digest = projectedArtifactDigest(run.demo.repoRoot, path);
      expect(digest).toBe(sha256HexBytes(bytes));
      const { app, token } = surface(run.demo.store, run.demo.repoRoot);
      openApps.push(app);
      await app.ready();
      const res = await app.inject({
        method: 'GET', headers: headers(token),
        url: `/api/control/files?path=${encodeURIComponent(path)}&sha256=${digest}`,
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(JSON.parse(res.body)).toMatchObject({ topic: index === 0 ? 'topic-one' : 'topic-two' });
    }
  });
});

describe('v1 acceptance demo — recovery from a session that died with unknown physical state', () => {
  it('lands on interrupted with one intervention and resumes without re-running the settled predecessor', async () => {
    const markers = { 'researcher-a': 'RECOVER-A', 'researcher-b': 'RECOVER-B' };
    // maxConcurrency 1 so researcher-a settles canonically BEFORE researcher-b's host dies; the point of
    // the assertion is that a's external effect is not repeated by the resume.
    const demo = harness({ topic: 'recovery-topic', markers, dieOnce: ['researcher-b'], maxConcurrency: 1 });

    const first = await drive(demo);
    expect(first.state).toBe('waiting-human');

    const afterCrash = detailOf(demo);
    const deadStage = afterCrash.stages.find((stage) => stage.stageId === 'researcher-b')!;
    const deadAttempt = afterCrash.attempts.find((attempt) => attempt.stageRef === deadStage.stageRef)!;
    expect(deadAttempt.state).toBe('interrupted');
    expect(failureSummaries(demo).some((line) => line.includes('died with unknown physical state'))).toBe(true);
    expect(afterCrash.sessions.find((session) => session.attemptRef === deadAttempt.attemptRef))
      .toMatchObject({ state: 'interrupted' });
    const interventions = afterCrash.humanRequests.filter((request) => request.kind === 'intervention' && request.state === 'open');
    expect(interventions).toHaveLength(1);
    expect(interventions[0].stageRef).toBe(deadStage.stageRef);

    // researcher-a already landed canonically and is NOT re-run.
    const startsFor = (id: string) => demo.starts.filter((start) => (start.proposalStage?.id ?? start.stageRef) === id).length;
    expect(startsFor('researcher-a')).toBe(1);
    expect(startsFor('researcher-b')).toBe(1);

    // The explicit resume: the operator clears the intervention, then the run is driven again.
    const cleared = demo.store.respondHumanRequest('operator', interventions[0].requestRef, {
      expectedRevision: interventions[0].revision, decision: 'approved',
      idempotencyKey: `resume-${interventions[0].requestRef}`, response: 'Host replaced; physical state verified clean.',
    });
    expect(cleared.ok).toBe(true);
    const { outcome } = await walkPolicyGates(demo);

    expect(outcome.state).toBe('waiting-human');
    expect(detailOf(demo).iterationLoops[0].cyclesUsed).toBe(2);
    // The first researcher's external effect happened exactly once across the crash and the resume;
    // only the dead stage was retried.
    expect(startsFor('researcher-a')).toBe(1);
    expect(startsFor('researcher-b')).toBe(2);
    expect(demo.integrations.filter((entry) => entry.stageId === 'researcher-a')).toHaveLength(1);
  });
});
