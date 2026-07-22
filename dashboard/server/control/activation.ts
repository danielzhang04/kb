/**
 * Wave A activation — the env-gated assembly of the governed automatic executor and its injection point
 * into the surface context.
 *
 * CORE INERT INVARIANT (design "Authorization boundary", plan D3): unless
 * `DASHBOARD_EXECUTION_ACTIVATED === '1'`, `buildActivatedExecution` returns `null` BEFORE touching any
 * construction factory. Nothing is imported eagerly that spawns; nothing is `new`-ed at module load. With
 * the gate off the daemon behaves byte-for-byte as today: no broker, no engine, no `claude` subprocess
 * reachable. The live flip is Daniel's alone.
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
import { createSubjectBrokerPersistence } from './brokerStore.ts';
import { createGitWorktreeAdapter, createCuratedSkillResolver, createFileAccountingAdapter } from './adapters.ts';
import { createCanonicalGitResultIntegrator } from './canonicalResultIntegrator.ts';
import { createClaudeWorkerAdapter, createWorkflowToolPolicyResolver } from './claudeWorkerAdapter.ts';
import {
  AutomaticExecutionEngine,
  type AutomaticExecutionOptions,
  type CancelRunInput,
  type CancellationOutcome,
  type ExecuteRunInput,
  type ExecutionBudget,
  type ExecutionOutcome,
} from './execution.ts';
import { loadPolicyEnvironment } from './environment.ts';
import type { PolicyEnvironment } from './policy.ts';
import type { ControlPlaneStore } from './store.ts';
import {
  createBrokerCancellationController,
  createBrokerManagerAdapter,
  createWorkerCancellationRegistry,
} from './managedExecution.ts';
import { settleFleetLedgerForRun } from './queueBridge.ts';
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

/**
 * Conservative execution caps for single-stage Wave-A runs. Subscription runs report 0 cost; the micro-
 * dollar ceiling is a fail-closed guard, never a spend authorization.
 */
const DEFAULT_BUDGET: ExecutionBudget = {
  maxAttempts: 3,
  maxInputTokens: 2_000_000,
  maxOutputTokens: 400_000,
  maxCostUsdMicros: 5_000_000,
};

const FULL_COMMIT = /^[a-f0-9]{40}$/;

/** The whole gate. Reads exactly one variable; any value other than the literal '1' means OFF. */
export function isExecutionActivated(env: Record<string, string | undefined> = process.env): boolean {
  return env.DASHBOARD_EXECUTION_ACTIVATED === '1';
}

export interface ActivationEngine {
  runToBoundary(input: ExecuteRunInput): Promise<ExecutionOutcome>;
  cancelRun(input: CancelRunInput): Promise<CancellationOutcome>;
}

export interface ActivatedExecution {
  controlBroker: ManagedSessionBroker;
  runAutomatic: (input: ExecuteRunInput) => Promise<ExecutionOutcome>;
  cancelAutomatic: (input: CancelRunInput) => Promise<CancellationOutcome>;
}

/**
 * Every construction factory, injectable. Defaults reference the real production factories; tests pass
 * spies to prove the gate-off path calls NONE of them and the gate-on path delegates correctly.
 */
export interface ActivationDeps {
  loadPolicy(repoRoot: string, project: string, refs: string[]): PolicyEnvironment;
  resolveBaseCommit(repoRoot: string): string;
  createSessionAdapter: typeof createClaudeSessionAdapter;
  createBrokerPersistence: typeof createSubjectBrokerPersistence;
  createBroker(adapter: ManagedSessionAdapter, persistence: BrokerPersistence): ManagedSessionBroker;
  createWorktrees: typeof createGitWorktreeAdapter;
  createSkills: typeof createCuratedSkillResolver;
  createAccounting: typeof createFileAccountingAdapter;
  createResults: typeof createCanonicalGitResultIntegrator;
  createToolPolicyResolver: typeof createWorkflowToolPolicyResolver;
  createWorkers: typeof createClaudeWorkerAdapter;
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
  /** Gate source. Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
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

const dormantResolveLaunch = (_spec: ManagedStartSpec): ClaudeSessionLaunch => {
  throw new ActivationError('no managed manager session is started under D3(b); resolveLaunch is dormant');
};

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
    createBrokerPersistence: createSubjectBrokerPersistence,
    createBroker: (adapter, persistence) => new ManagedSessionBroker(adapter, persistence),
    createWorktrees: createGitWorktreeAdapter,
    createSkills: createCuratedSkillResolver,
    createAccounting: createFileAccountingAdapter,
    createResults: createCanonicalGitResultIntegrator,
    createToolPolicyResolver: createWorkflowToolPolicyResolver,
    createWorkers: createClaudeWorkerAdapter,
    createRegistry: createWorkerCancellationRegistry,
    createManagers: createBrokerManagerAdapter,
    createCancellation: createBrokerCancellationController,
    createEngine: (options) => new AutomaticExecutionEngine(options),
    settleLedgerForRun: settleFleetLedgerForRun,
  };
}

/**
 * Returns the executor injection triple when the gate is on, or `null` when it is off. The gate is
 * checked FIRST: on the off path this function touches no factory, resolves no policy, and shells no git.
 */
export function buildActivatedExecution(options: BuildActivatedExecutionOptions): ActivatedExecution | null {
  const env = options.env ?? process.env;
  if (!isExecutionActivated(env)) return null;

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
  const resolveLaunch = options.resolveLaunch ?? dormantResolveLaunch;

  const policy = deps.loadPolicy(repoRoot, project, [...refs]);

  const broker = deps.createBroker(
    deps.createSessionAdapter({ resolveLaunch }),
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
  const workers = deps.createWorkers({
    resolveToolPolicy: deps.createToolPolicyResolver(),
    registerCancellation: registry.register,
    deregisterCancellation: registry.clear,
    // C3: the canonical repo root, so `buildReadScopeSettings` emits the `//`-absolute deny companion.
    // (Read denies are non-functional on CLI 2.1.217 in -p mode — see claudeWorkerAdapter.ts — so this is
    // dormant future-proofing; the seam is wired for a CLI that honors them.)
    repoRoot,
  });
  const managers = deps.createManagers({ broker });
  const cancellation = deps.createCancellation({ broker, registry });

  const engine = deps.createEngine({
    store: options.controlStore,
    policy,
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
        settleLedgerForRun(
          { controlStore: options.controlStore, repoRoot },
          { subject: input.subject, runRef: input.runRef, readUsageMicros },
        );
      } catch {
        /* fleet-ledger settlement is best-effort; never let it mask the executor outcome */
      }
      return outcome;
    } finally {
      // Ownership-aware drop: only the call that registered this entry may remove it.
      if (runSparsePaths.get(input.runRef)?.owner === owner) runSparsePaths.delete(input.runRef);
    }
  };

  return {
    controlBroker: broker,
    runAutomatic,
    cancelAutomatic: (input) => engine.cancelRun(input),
  };
}
