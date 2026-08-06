/**
 * Activation — the assembly of the governed automatic executor and its injection point into the surface
 * context, behind a RUNTIME UNLOCK LATCH.
 *
 * CORE INERT INVARIANT (design "Authorization boundary", plan D3), unchanged in shape: unless the daemon
 * is explicitly authorized, `buildActivatedExecution` returns `null` BEFORE touching any construction
 * factory. Nothing is imported eagerly that spawns; nothing is `new`-ed at module load. Locked, the
 * daemon behaves byte-for-byte as an unactivated one: no broker, no engine, no worker subprocess reachable.
 *
 * WHAT CHANGED (FYT gated-pipeline Task 4): there are now TWO authorizations, and the daemon boots with
 * neither unless the environment says otherwise.
 *   1. `DASHBOARD_EXECUTION_ACTIVATED === '1'` — demoted to a HEADLESS/TESTING OVERRIDE. It skips the
 *      latch entirely (the daemon comes up already unlocked) and exists for hermetic tests and headless
 *      operation. It is not how a human operator turns execution on.
 *   2. An {@link ExecutionUnlockGrant} — minted ONLY by {@link createExecutionLatch}'s `unlock`, which the
 *      unlock route calls after a WebAuthn passkey assertion verifies. The grant is unforgeable by
 *      construction (a module-private brand): a shape-matching object from anywhere else fails
 *      `isExecutionUnlockGrant`, so no route, store value, or JSON body can conjure one.
 * State stays unlocked until the daemon restarts (natural re-lock: the grant and the wiring live only in
 * memory) or an operator calls Lock, which drains the broker and drops the wiring.
 *
 * When the gate is on this wires, behind the gate, the already-built, already-reviewed control-plane
 * pieces into one `AutomaticExecutionEngine`:
 *   - the D4-approved CANONICAL git result integrator (never the app-local file integrator),
 *   - the production `claudeWorkerAdapter` (env-stripping, stdin-only work order, kill-timeout — reused
 *     verbatim, never re-implemented or weakened here),
 *   - the D3(b) no-subprocess manager adapter + cancellation controller from `managedExecution.ts`.
 *
 * Every collaborator is injectable via `deps` so the gate-off "constructs nothing" invariant and the
 * gate-on delegation are both hermetically testable without a real repo, git, or CLI.
 *
 * Strip-only floor: no TS enums, parameter properties, or namespaces. ESM with `.ts` specifiers.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { ManagedSessionBroker } from './broker.ts';
import type { BrokerPersistence, ManagedSessionAdapter, ManagedStartSpec } from './broker.ts';
import { createClaudeSessionAdapter, type ClaudeSessionLaunch } from './claudeSessionAdapter.ts';
import { createCodexSessionAdapter } from './codexSessionAdapter.ts';
import { createSubjectBrokerPersistence } from './brokerStore.ts';
import { createGitWorktreeAdapter, createCuratedSkillResolver, createFileAccountingAdapter } from './adapters.ts';
import { createCanonicalGitResultIntegrator } from './canonicalResultIntegrator.ts';
import { createClaudeWorkerAdapter, createWorkflowToolPolicyResolver } from './claudeWorkerAdapter.ts';
import { createCodexExecAdapter } from './codexExecAdapter.ts';
import { createAgentSessionChainStore } from './agentSessionChains.ts';
import { createAssignedAgentResolver } from './agentAssignmentResolver.ts';
import {
  AutomaticExecutionEngine,
  type AutomaticExecutionOptions,
  type CancelRunInput,
  type CancellationOutcome,
  type ContainManagerStartInput,
  type ExecuteRunInput,
  type ExecutionBudget,
  type ExecutionOutcome,
  type WorkerAdapter,
  canonicalResultOperationKey,
} from './execution.ts';
import { loadPolicyEnvironment } from './environment.ts';
import type { ExecutionProfile, PolicyEnvironment } from './policy.ts';
import type { ControlPlaneStore } from './store.ts';
import {
  createBrokerCancellationController,
  createBrokerManagerAdapter,
  createWorkerCancellationRegistry,
} from './managedExecution.ts';
import { settleFleetLedgerForRun } from './queueBridge.ts';
import { buildPaidActionExecution, type PaidActionExecutor } from './paidActionWiring.ts';
import { createSpendGrantProvisioner } from './spendGrantProvision.ts';
import { PAID_ACTION_ROUTE_PATH } from './paidActionRoute.ts';
import type { SpendGrant } from './spendGrant.ts';
import { brandInternalServiceCaller } from '../auth/session.ts';
import type { InternalServiceCaller } from '../auth/session.ts';

export class ActivationError extends Error {}

/** The single dashboard executor identity (D1): card owner, broker subject, ledger agent, run subject. */
export const DASHBOARD_EXECUTOR_SUBJECT = 'dashboard-engine';

/**
 * Construct the sanctioned internal service caller for the dashboard executor. Constructible ONLY when the
 * activation gate is on (Daniel's flip) — it throws otherwise, so no gate-off code path can obtain one and
 * the bridge fails closed rather than launching unauthenticated. No HTTP route imports or calls it. The
 * result is an in-process principal (see `auth/session.ts#InternalServiceCaller`), never a bearer token, so
 * nothing replayable against an HTTP write route is ever minted. The principal is unforgeable by
 * construction: `brandInternalServiceCaller` is the sole brand primitive, so a value that satisfies
 * `isInternalServiceCaller` can ONLY originate here — a shape-matching JSON object can never pass. The queue
 * bridge presents it to `executeApprovedLaunch` in place of a WebAuthn session token to authorize the
 * daemon-internal launch of a run it already imported and approved under its own subject.
 */
export function createInternalServiceCaller(
  subject: string = DASHBOARD_EXECUTOR_SUBJECT,
  env: Record<string, string | undefined> = process.env,
): InternalServiceCaller {
  if (!isExecutionActivated(env)) {
    throw new ActivationError('the internal service caller is only constructible with the activation gate on');
  }
  return brandInternalServiceCaller(subject);
}

/** Wave-A default project whose contract/governance the single held policy environment is loaded for. */
const DEFAULT_POLICY_PROJECT = 'kb-ops';

/** The closed governance anchors loaded into the held policy environment for the Wave-A project. */
const DEFAULT_GOVERNANCE_REFS: readonly string[] = [
  'CLAUDE.md',
  'governance/agent-rules.md',
  'governance/risk-tiers.md',
];
const SAFE_PROJECT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * Conservative execution caps for single-stage Wave-A runs. Subscription runs report 0 cost; the micro-
 * dollar ceiling is a fail-closed guard, never a spend authorization.
 */
const DEFAULT_BUDGET: ExecutionBudget = {
  maxAttempts: 30,
  maxInputTokens: 2_000_000,
  maxOutputTokens: 400_000,
  maxCostUsdMicros: 5_000_000,
};

const FULL_COMMIT = /^[a-f0-9]{40}$/;

/**
 * The HEADLESS/TESTING OVERRIDE. Reads exactly one variable; any value other than the literal '1' means
 * OFF, and OFF is now the normal production posture — an operator unlocks execution with a passkey
 * (`createExecutionLatch`), not with an environment variable. When it IS '1' the latch comes up already
 * unlocked, which is what hermetic tests and headless runs rely on.
 */
export function isExecutionActivated(env: Record<string, string | undefined> = process.env): boolean {
  return env.DASHBOARD_EXECUTION_ACTIVATED === '1';
}

/** Module-private brand: only code in this file can produce a value that satisfies the type. */
const EXECUTION_UNLOCK_BRAND: unique symbol = Symbol('kb.execution-unlock-grant');

/**
 * Proof that a human passkey assertion authorized execution wiring to be constructed. Unforgeable: the
 * brand symbol is module-private and never exported, so a JSON body, a store value, or another module's
 * literal can never satisfy {@link isExecutionUnlockGrant}.
 */
export interface ExecutionUnlockGrant {
  readonly [EXECUTION_UNLOCK_BRAND]: true;
  readonly subject: string;
  readonly unlockedAt: number;
}

function mintExecutionUnlockGrant(subject: string, unlockedAt: number): ExecutionUnlockGrant {
  return { [EXECUTION_UNLOCK_BRAND]: true, subject, unlockedAt };
}

/** True only for a grant this module minted. */
export function isExecutionUnlockGrant(value: unknown): value is ExecutionUnlockGrant {
  return typeof value === 'object' && value !== null
    && (value as Record<symbol, unknown>)[EXECUTION_UNLOCK_BRAND] === true;
}

export interface ActivationEngine {
  runToBoundary(input: ExecuteRunInput): Promise<ExecutionOutcome>;
  cancelRun(input: CancelRunInput): Promise<CancellationOutcome>;
  containManagerStart?(input: ContainManagerStartInput): Promise<void>;
}

export interface ActivatedExecution {
  controlBroker: ManagedSessionBroker;
  /** Headless worker operator-message delivery; Claude may accept a live frame, Codex always queues. */
  agentMessages: {
    deliver(input: { runRef: string; agentId: string; runtime: 'claude' | 'codex'; message: string }): Promise<'live' | 'queued'>;
  };
  runAutomatic: (input: ExecuteRunInput) => Promise<ExecutionOutcome>;
  cancelAutomatic: (input: CancelRunInput) => Promise<CancellationOutcome>;
  containManagerStart?: (input: ContainManagerStartInput) => Promise<void>;
  /** Exact g1 canonical-result proof for a terminal managed root. */
  verifyCanonicalResult: (input: { subject: string; runRef: string; stageId: string }) => Promise<boolean>;
  /** FYT paid-action executor and its spend-grant resolver, constructed with the other activated-execution
   *  singletons (so they exist ONLY behind the gate). The paid-action route reads both from the surface
   *  context, which the latch binds/unbinds in place on unlock/lock. */
  paidActionService: PaidActionExecutor;
  spendGrantStore: { resolve(token: string, now?: Date): SpendGrant | null };
}

/**
 * Every construction factory, injectable. Defaults reference the real production factories; tests pass
 * spies to prove the gate-off path calls NONE of them and the gate-on path delegates correctly.
 */
export interface ActivationDeps {
  loadPolicy(repoRoot: string, project: string, refs: string[]): PolicyEnvironment;
  resolveBaseCommit(repoRoot: string): string;
  createSessionAdapter: typeof createClaudeSessionAdapter;
  createCodexSessionAdapter: typeof createCodexSessionAdapter;
  createBrokerPersistence: typeof createSubjectBrokerPersistence;
  createBroker(adapter: ManagedSessionAdapter, persistence: BrokerPersistence): ManagedSessionBroker;
  createWorktrees: typeof createGitWorktreeAdapter;
  createSkills: typeof createCuratedSkillResolver;
  createAccounting: typeof createFileAccountingAdapter;
  createResults: typeof createCanonicalGitResultIntegrator;
  createToolPolicyResolver: typeof createWorkflowToolPolicyResolver;
  createAssignedAgentResolver: typeof createAssignedAgentResolver;
  createWorkers: typeof createClaudeWorkerAdapter;
  createCodexWorkers: typeof createCodexExecAdapter;
  createSessionChains: typeof createAgentSessionChainStore;
  createRegistry: typeof createWorkerCancellationRegistry;
  createManagers: typeof createBrokerManagerAdapter;
  createCancellation: typeof createBrokerCancellationController;
  createEngine(options: AutomaticExecutionOptions): ActivationEngine;
  /**
   * The terminal-run observation seam (T6 wire-up): settle the fleet cost ledger for a run once it is
   * terminal. Default is the real `settleFleetLedgerForRun`. Wrapped around `runAutomatic` below so it
   * exists only behind the gate. Injectable so the gate-on wrap is testable without a store or python.
   */
  settleLedgerForRun: typeof settleFleetLedgerForRun;
}

export interface BuildActivatedExecutionOptions {
  /** Headless/testing override source. Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
  /**
   * A passkey unlock grant. Supplying a valid one authorizes construction with the env override absent —
   * this is the operator path. Anything that is not a grant this module minted is ignored, so the gate
   * fails closed on a forged value rather than opening on a truthy one.
   */
  unlockGrant?: unknown;
  /** The app-local durable control-plane store the surface already resolved. */
  controlStore: ControlPlaneStore;
  /** Canonical ops worktree — used for policy load, worktree provisioning, and canonical integration. */
  repoRoot: string;
  /** Dashboard state root (outside the repo) — accounting ledger, worktrees, integration lineage. */
  stateRoot: string;
  subject?: string;
  project?: string;
  governanceRefs?: string[];
  worktreeRoot?: string;
  integrationRoot?: string;
  baseCommit?: string;
  budget?: ExecutionBudget;
  maxConcurrency?: number;
  /**
   * Manager-session launch resolver. Dormant under D3(b) (no manager broker session is started), so the
   * default is fail-closed: any unexpected managed-session spawn throws rather than launching an
   * unconfigured `claude`. Supply a real resolver only when adopting the D3(b→a) broker-backed manager.
   */
  resolveLaunch?: (spec: ManagedStartSpec) => ClaudeSessionLaunch;
  /**
   * Reads settled usage micro-dollars for one terminal stage attempt, for the fleet-ledger post-run seam.
   * Wave-A default (omitted) is 0 — the faithful subscription value (the worker reports $0 with no
   * ANTHROPIC_API_KEY). A future metered-billing wave supplies a reader here.
   */
  readUsageMicros?: (stageRef: string, attemptRef: string | null) => number;
  deps?: Partial<ActivationDeps>;
}

function managedProfile(profiles: readonly ExecutionProfile[], spec: ManagedStartSpec): ExecutionProfile {
  const profile = profiles.find((candidate) => candidate.id === spec.profileId && candidate.role === spec.role);
  if (!profile) throw new ActivationError(`managed session profile '${spec.profileId}' is unavailable`);
  return profile;
}

function defaultResolveBaseCommit(repoRoot: string): string {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
  if (!FULL_COMMIT.test(head)) throw new ActivationError('git rev-parse HEAD did not yield a full immutable commit id');
  return head;
}

function defaultDeps(): ActivationDeps {
  return {
    loadPolicy: loadPolicyEnvironment,
    resolveBaseCommit: defaultResolveBaseCommit,
    createSessionAdapter: createClaudeSessionAdapter,
    createCodexSessionAdapter,
    createBrokerPersistence: createSubjectBrokerPersistence,
    createBroker: (adapter, persistence) => new ManagedSessionBroker(adapter, persistence),
    createWorktrees: createGitWorktreeAdapter,
    createSkills: createCuratedSkillResolver,
    createAccounting: createFileAccountingAdapter,
    createResults: createCanonicalGitResultIntegrator,
    createToolPolicyResolver: createWorkflowToolPolicyResolver,
    createAssignedAgentResolver: createAssignedAgentResolver,
    createWorkers: createClaudeWorkerAdapter,
    createCodexWorkers: createCodexExecAdapter,
    createSessionChains: createAgentSessionChainStore,
    createRegistry: createWorkerCancellationRegistry,
    createManagers: createBrokerManagerAdapter,
    createCancellation: createBrokerCancellationController,
    createEngine: (options) => new AutomaticExecutionEngine(options),
    settleLedgerForRun: settleFleetLedgerForRun,
  };
}

/**
 * Server-owned project policy resolver. Wave A keeps its already-loaded default environment, while a
 * later project is loaded fresh for each engine boundary invocation with the canonical global anchors plus
 * that project's contract. The engine snapshots that one result for the invocation; this resolver never
 * has process-lifetime cache state that could retain a stale project policy. Browser/proposal text never
 * selects files or adds governance references.
 */
export function createProjectPolicyResolver(
  repoRoot: string,
  loadPolicy: ActivationDeps['loadPolicy'],
  heldProject: string,
  heldPolicy: PolicyEnvironment,
): (project: string) => PolicyEnvironment {
  if (!SAFE_PROJECT.test(heldProject)) throw new ActivationError('held policy project is unsafe');
  return (project: string): PolicyEnvironment => {
    if (!SAFE_PROJECT.test(project)) throw new ActivationError('project is unsafe for policy resolution');
    if (project === heldProject) return heldPolicy;
    return loadPolicy(repoRoot, project, [...DEFAULT_GOVERNANCE_REFS, `orgs/${project}/contract.md`]);
  };
}

/**
 * Returns the executor injection triple when execution is authorized, or `null` when it is not. The gate
 * is checked FIRST: on the locked path this function touches no factory, resolves no policy, shells no
 * git, and spawns no terminal.
 */
export function buildActivatedExecution(options: BuildActivatedExecutionOptions): ActivatedExecution | null {
  const env = options.env ?? process.env;
  if (!isExecutionActivated(env) && !isExecutionUnlockGrant(options.unlockGrant)) return null;

  const deps = { ...defaultDeps(), ...options.deps };
  const subject = options.subject ?? DASHBOARD_EXECUTOR_SUBJECT;
  const project = options.project ?? DEFAULT_POLICY_PROJECT;
  const refs = options.governanceRefs ?? [...DEFAULT_GOVERNANCE_REFS, `orgs/${project}/contract.md`];
  const stateRoot = options.stateRoot;
  const repoRoot = options.repoRoot;
  const worktreeRoot = options.worktreeRoot ?? join(stateRoot, 'control', 'worktrees');
  const integrationRoot = options.integrationRoot ?? join(stateRoot, 'control', 'integration');
  const budget = options.budget ?? DEFAULT_BUDGET;
  const maxConcurrency = options.maxConcurrency ?? 1;
  const baseCommit = options.baseCommit ?? deps.resolveBaseCommit(repoRoot);

  const policy = deps.loadPolicy(repoRoot, project, [...refs]);
  const resolvePolicy = createProjectPolicyResolver(repoRoot, deps.loadPolicy, project, policy);
  const assignedAgents = deps.createAssignedAgentResolver(repoRoot);
  const sessionChains = deps.createSessionChains(stateRoot);

  const resolveManagedLaunch = (spec: ManagedStartSpec): ClaudeSessionLaunch => {
    const profile = managedProfile(policy.profiles, spec);
    const resolved = options.resolveLaunch?.(spec) ?? {
      cwd: repoRoot,
      model: profile.model,
      allowedTools: ['Read'],
      permissionMode: 'default',
    };
    return { ...resolved, model: profile.model };
  };
  const claudeSessions = deps.createSessionAdapter({
    resolveLaunch: (spec) => {
      const profile = managedProfile(policy.profiles, spec);
      if (profile.runtime !== 'claude') throw new ActivationError('Codex managed session reached the Claude adapter');
      return resolveManagedLaunch(spec);
    },
  });
  const codexSessions = deps.createCodexSessionAdapter({
    resolveLaunch: (spec) => {
      const profile = managedProfile(policy.profiles, spec);
      if (profile.runtime !== 'codex') throw new ActivationError('Claude managed session reached the Codex adapter');
      const launch = resolveManagedLaunch(spec);
      return { cwd: launch.cwd, model: profile.model };
    },
    resolveThread: (spec) => {
      const entry = sessionChains.get(spec.runRef, spec.sessionRef);
      if (!entry) return null;
      if (entry.runtime !== 'codex') throw new ActivationError('managed session chain runtime differs from its profile');
      return entry.sessionId;
    },
    recordThread: (spec, threadId) => sessionChains.record(
      spec.runRef, spec.sessionRef, { runtime: 'codex', sessionId: threadId },
    ),
  });
  const sessionAdapter: ManagedSessionAdapter = {
    start(spec, observer) {
      const profile = managedProfile(policy.profiles, spec);
      return profile.runtime === 'codex'
        ? codexSessions.start(spec, observer)
        : claudeSessions.start(spec, observer);
    },
  };

  const broker = deps.createBroker(
    sessionAdapter,
    deps.createBrokerPersistence(options.controlStore, subject),
  );

  // C2 production on-switch (env-gated, default OFF). `DASHBOARD_SPARSE_READSCOPE === '1'` turns the git
  // worktree adapter's sparse-checkout provisioning on; any other value (incl. unset) keeps the full
  // checkout that is byte-identical to the pre-C2 adapter. Reads the SAME env source as the activation gate.
  const sparseReadScope = env.DASHBOARD_SPARSE_READSCOPE === '1';
  // The engine's `worktrees.ensure` call (execution.ts) passes NO `sparsePaths`, and execution.ts must not
  // be edited (it is the hottest, most-contended file — the read-scope design §10 keeps this wave out of
  // it). So instead of threading sparsePaths at the call site, we register each run's approved sparse set
  // (effectiveRead ∪ writeScope, taken verbatim from the hash-covered PlanProposal.scope) keyed by runRef,
  // and hand the adapter a `resolveSparsePaths` callback that looks it up at provisioning time. The value
  // is the SAME approved scope the compiler produced and the human approved; the adapter root-anchors and
  // validates it. Harmless when `sparseReadScope` is off (the callback is never consulted).
  // Value carries the registering call's identity so a duplicate-launch failure path can never
  // delete the LIVE run's entry (review finding: run B's synchronous "already active" throw would
  // otherwise drop run A's key mid-provision, silently degrading A to a full checkout).
  const runSparsePaths = new Map<string, { owner: object; paths: readonly string[] }>();
  const worktrees = deps.createWorktrees({
    repoRoot,
    worktreeRoot,
    baseCommit,
    sparseReadScope,
    resolveSparsePaths: (ensureInput) => runSparsePaths.get(ensureInput.runRef)?.paths,
  });
  const skills = deps.createSkills(policy.curatedSkills);
  const accounting = deps.createAccounting({
    stateRoot,
    windowId: new Date().toISOString().slice(0, 10),
    maxConcurrency,
    globalBudget: budget,
  });
  const results = deps.createResults({
    repoRoot,
    coordinationRoot: repoRoot,
    integrationRoot,
    worktreeRoot,
    stateRoot,
    baseCommit,
  });

  const registry = deps.createRegistry();
  const resolveChain = (runtime: 'claude' | 'codex', runRef: string, agentId: string): string | null => {
    const entry = sessionChains.get(runRef, agentId);
    if (!entry) return null;
    if (entry.runtime !== runtime) throw new ActivationError('worker session chain runtime differs from its profile');
    return entry.sessionId;
  };
  const claudeWorkers = deps.createWorkers({
    resolveToolPolicy: deps.createToolPolicyResolver(),
    registerCancellation: registry.register,
    deregisterCancellation: registry.clear,
    // C3: the canonical repo root, so `buildReadScopeSettings` emits the `//`-absolute deny companion.
    // (Read denies are non-functional on CLI 2.1.217 in -p mode — see claudeWorkerAdapter.ts — so this is
    // dormant future-proofing; the seam is wired for a CLI that honors them.)
    repoRoot,
    resolveSession: (runRef, agentId) => resolveChain('claude', runRef, agentId),
    recordSession: (runRef, agentId, sessionId) => sessionChains.record(
      runRef, agentId, { runtime: 'claude', sessionId },
    ),
    drainMessages: (runRef, agentId) => sessionChains.drainMessages(runRef, agentId),
  });
  const codexWorkers = deps.createCodexWorkers({
    resolveThread: (runRef, agentId) => resolveChain('codex', runRef, agentId),
    recordThread: (runRef, agentId, threadId) => sessionChains.record(
      runRef, agentId, { runtime: 'codex', sessionId: threadId },
    ),
    drainMessages: (runRef, agentId) => sessionChains.drainMessages(runRef, agentId),
  });
  const agentMessages: ActivatedExecution['agentMessages'] = {
    async deliver(input) {
      if (input.runtime === 'claude' && claudeWorkers.postMessage(input.runRef, input.agentId, input.message)) {
        return 'live';
      }
      await sessionChains.queueMessage(input.runRef, input.agentId, input.message);
      return 'queued';
    },
  };
  const workers: WorkerAdapter = {
    execute(input) {
      return input.profile.runtime === 'codex'
        ? codexWorkers.execute(input)
        : claudeWorkers.execute(input);
    },
  };

  const managers = deps.createManagers({ broker });
  const cancellation = deps.createCancellation({ broker, registry });

  // FYT paid-action wiring (Units D1/D3), constructed ONLY here — behind the gate — with the other
  // activated-execution singletons. One paid-action journal + grant store at `stateRoot/control`; the
  // committer/verifier resolve each call's artifact into that call's attempt worktree under `worktreeRoot`.
  // The provisioner hook mints a stage's grant and writes its token file into the prepared attempt worktree
  // at launch; it is passed to the engine so a paid stage arms its worker before delivery. Provider keys are
  // resolved server-side from OUTSIDE any worktree — never written into one.
  const paid = buildPaidActionExecution({ stateRoot, worktreeRoot });
  const paidActionRouteUrl = `${(env.DASHBOARD_RP_ORIGIN ?? env.DASHBOARD_DEV_ORIGIN ?? 'http://127.0.0.1:5317').replace(/\/+$/, '')}${PAID_ACTION_ROUTE_PATH}`;
  const provisionSpendGrant = createSpendGrantProvisioner({
    grantStore: paid.spendGrantStore,
    routeUrl: paidActionRouteUrl,
    ttlMs: 2 * 60 * 60 * 1_000,
  });

  const engine = deps.createEngine({
    store: options.controlStore,
    policy,
    policyProject: project,
    resolvePolicy,
    assignedAgents,
    worktreeRoot,
    maxConcurrency,
    budget,
    worktrees,
    managers,
    workers,
    skills,
    accounting,
    results,
    cancellation,
    provisionSpendGrant,
  });

  // T6 wire-up: drive the run to its boundary, then — behind this same gate — settle the fleet cost
  // ledger if the run is now terminal (see queueBridge.ts#settleFleetLedgerForRun). Settlement is
  // best-effort and must NEVER mask the run outcome: a ledger failure (e.g. a STOP dropped mid-flight is
  // handled inside as `blocked`, but an unexpected throw) is swallowed here so the executor's own result
  // and error handling in launch.ts are unaffected. Fires exactly once per run (on the terminal boundary).
  const settleLedgerForRun = deps.settleLedgerForRun;
  const readUsageMicros = options.readUsageMicros;
  const runAutomatic = async (input: ExecuteRunInput): Promise<ExecutionOutcome> => {
    // C2: register this run's sparse materialization set (effectiveRead ∪ writeScope) BEFORE the engine
    // provisions any worktree, so `resolveSparsePaths` (above) can find it at `ensure` time. Read from the
    // approved, hash-covered proposal scope. Guarded: a proposal without a `scope` (e.g. a test double)
    // simply registers nothing → the adapter falls back to a full checkout. Dropped in `finally` so the
    // registry never outlives the run.
    const scope = input.proposal?.scope;
    const owner = {};
    // First registration wins: a duplicate call for the SAME runRef must neither overwrite nor
    // (via its finally) drop the live entry. Same runRef binds an immutable proposal, so the
    // paths are identical anyway; the live call's ownership stays intact and only IT deletes.
    if (scope && !runSparsePaths.has(input.runRef)) {
      runSparsePaths.set(input.runRef, { owner, paths: [...(scope.read ?? []), ...(scope.write ?? [])] });
    }
    try {
      const outcome = await engine.runToBoundary(input);
      try {
        await settleLedgerForRun(
          { controlStore: options.controlStore, repoRoot },
          { subject: input.subject, runRef: input.runRef, readUsageMicros },
        );
      } catch (err) {
        // fleet-ledger settlement is best-effort; never let it mask the executor outcome — but never let it
        // vanish silently either (an unpushed ledger row needs operator follow-up). No logger in scope here.
        console.error('fleet-ledger settlement failed', err);
      }
      return outcome;
    } finally {
      // Ownership-aware drop: only the call that registered this entry may remove it.
      if (runSparsePaths.get(input.runRef)?.owner === owner) runSparsePaths.delete(input.runRef);
    }
  };

  return {
    controlBroker: broker,
    agentMessages,
    paidActionService: paid.paidActionService,
    spendGrantStore: paid.spendGrantStore,
    runAutomatic,
    cancelAutomatic: (input) => engine.cancelRun(input),
    verifyCanonicalResult: async (input) => (await results.lookup({
      operationKey: canonicalResultOperationKey(input.runRef, input.stageId),
      subject: input.subject,
      runRef: input.runRef,
      stageId: input.stageId,
    })) !== null,
    ...(engine.containManagerStart
      ? { containManagerStart: (input: ContainManagerStartInput) => engine.containManagerStart!(input) }
      : {}),
  };
}

/** What the lock/unlock routes and the UI see. Never carries the grant or any wiring reference. */
export interface ExecutionLatchState {
  state: 'locked' | 'unlocked';
  /** How it was unlocked: the passkey route, or the headless/testing env override. */
  source: 'passkey' | 'env-override' | null;
  unlockedAt: string | null;
  unlockedBy: string | null;
}

export interface ExecutionLatch {
  snapshot(): ExecutionLatchState;
  /** The live wiring, or `null` while locked. Never constructs anything. */
  current(): ActivatedExecution | null;
  /**
   * Construct the execution wiring under a freshly-verified passkey assertion. Idempotent: a second
   * unlock while already unlocked returns the same wiring and does not rebuild it.
   */
  unlock(input: { subject: string }): { ok: true; state: ExecutionLatchState } | { ok: false; reason: string };
  /** Drain managed sessions, drop the wiring, and return to the boot posture. Idempotent. */
  lock(input: { subject: string }): ExecutionLatchState;
}

export interface ExecutionLatchOptions {
  /** Build inputs the latch holds until an unlock actually happens. */
  buildOptions: Omit<BuildActivatedExecutionOptions, 'unlockGrant'>;
  /** Injectable for tests; defaults to the real builder. */
  build?: typeof buildActivatedExecution;
  env?: Record<string, string | undefined>;
  now?: () => number;
  /** Called on every transition so the surface context can bind/unbind the executor fields in place. */
  onChange?: (execution: ActivatedExecution | null, state: ExecutionLatchState) => void;
}

const LOCKED_STATE: ExecutionLatchState = { state: 'locked', source: null, unlockedAt: null, unlockedBy: null };

/**
 * The runtime unlock latch.
 *
 * Boot posture is LOCKED unless the headless/testing override is set, in which case the latch comes up
 * unlocked with `source: 'env-override'` and the daemon behaves exactly as it did before this existed.
 * From locked, the ONLY way to construct execution wiring is `unlock`, which the passkey-gated route
 * calls after `verifyAssertion` returns `verified: true`; the grant it mints cannot be produced anywhere
 * else. `lock` drains managed sessions and drops the wiring; a daemon restart does the same for
 * free, which is why nothing about the unlocked state is persisted.
 */
export function createExecutionLatch(options: ExecutionLatchOptions): ExecutionLatch {
  const build = options.build ?? buildActivatedExecution;
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now;
  let execution: ActivatedExecution | null = null;
  let state: ExecutionLatchState = LOCKED_STATE;

  const apply = (next: ActivatedExecution | null, nextState: ExecutionLatchState): void => {
    execution = next;
    state = nextState;
    options.onChange?.(next, nextState);
  };

  const construct = (subject: string, source: 'passkey' | 'env-override'): { ok: true; state: ExecutionLatchState } | { ok: false; reason: string } => {
    const at = now();
    const built = build({ ...options.buildOptions, env, unlockGrant: mintExecutionUnlockGrant(subject, at) });
    if (!built) return { ok: false, reason: 'execution-wiring-unavailable' };
    apply(built, {
      state: 'unlocked',
      source,
      unlockedAt: new Date(at).toISOString(),
      unlockedBy: subject,
    });
    return { ok: true, state };
  };

  // The env override is applied at construction so an overridden daemon is unlocked before the first
  // request, preserving the pre-latch behaviour byte for byte.
  if (isExecutionActivated(env)) construct(DASHBOARD_EXECUTOR_SUBJECT, 'env-override');

  return {
    snapshot: () => state,
    current: () => execution,
    unlock(input) {
      if (execution) return { ok: true, state };
      if (!SAFE_PROJECT.test(input.subject)) return { ok: false, reason: 'unsafe-unlock-subject' };
      try {
        return construct(input.subject, 'passkey');
      } catch (error) {
        // A construction failure must leave the daemon LOCKED, never half-wired.
        apply(null, LOCKED_STATE);
        return { ok: false, reason: error instanceof Error ? error.message : 'execution wiring could not be constructed' };
      }
    },
    lock() {
      if (!execution) return state;
      try {
        execution.controlBroker.drain();
      } catch {
        /* best-effort: locking is a fail-safe direction */
      }
      apply(null, LOCKED_STATE);
      return state;
    },
  };
}
