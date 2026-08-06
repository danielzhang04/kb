/**
 * FYT paid-action wiring — Unit D1: assemble the durable spend-grant store and the paid-action service from
 * Unit C's production dependencies, for construction behind the activation gate (see `activation.ts`).
 *
 * PER-RUN ARTIFACT ROOT (the integration wrinkle). Unit C's committer/verifier are rooted at ONE fixed
 * directory, but each paid call must write/read its artifact in the RUN'S ATTEMPT WORKTREE
 * (`worktreeRoot/<runRef>/<attemptRef>`, per `activation.ts` + `execution.ts#planAttemptWorktreePath`), a
 * different directory per call. Rather than construct a whole service per call — which would need its own
 * startup reconciliation and could clobber concurrent in-flight calls — this builds ONE service whose
 * committer and verifier are ROOT-RESOLVING: for each call they compute the attempt worktree from the
 * call's own (runRef, attemptRef) and delegate to a Unit C committer/verifier rooted there. The committer
 * receives (runRef, attemptRef) directly; the verifier receives only an actionRef, so it resolves the same
 * pair from the service's own durable journal snapshot (late-bound). If the action is not found — or its
 * worktree has since been torn down — the verifier returns null and the service downgrades the replay to
 * `unknown`, exactly as it treats a missing artifact.
 *
 * JOURNAL SCOPE / GLOBAL CEILING. There is exactly ONE journal, at `stateRoot/control/paid-actions.json`,
 * shared by every run/stage/attempt. That is deliberate: the absolute `FYT_PAID_ACTION_GLOBAL_CEILING`
 * ($1.50) is a JOURNAL-WIDE floor summed across ALL actions (`paidActionService.reserve`), so it is correct
 * only with a single journal. A per-run journal would make the "global" ceiling per-run and defeat the
 * defense-in-depth second floor. Startup reconciliation runs once (lazily, on the first execute) against
 * that one journal.
 *
 * Strip-only floor: no TS enums, parameter properties, or namespaces. ESM with `.ts` specifiers.
 */
import { planAttemptWorktreePath } from './execution.ts';
import {
  createProviderArtifactVerifier,
  createProviderCommitter,
  createProviderCredentialResolver,
  createProviderTransport,
} from './paidActionProviders.ts';
import {
  createPaidActionService,
  type PaidActionArtifactVerifier,
  type PaidActionCommitter,
  type PaidActionCredentialResolver,
  type PaidActionRequest,
  type PaidActionResult,
  type PaidActionTransport,
} from './paidActionService.ts';
import { createSpendGrantStore } from './spendGrant.ts';

/** The subset of the paid-action service the route drives: execute one call, and read the durable journal to
 *  derive the next call ordinal server-side. */
export interface PaidActionExecutor {
  execute(input: PaidActionRequest): Promise<PaidActionResult>;
  snapshot(): ReadonlyArray<{
    runRef: string;
    stageRef: string;
    attemptRef: string;
    operation: string;
    callOrdinal: number;
  }>;
}

export interface PaidActionExecution {
  paidActionService: PaidActionExecutor;
  spendGrantStore: ReturnType<typeof createSpendGrantStore>;
}

export interface BuildPaidActionExecutionOptions {
  /** Dashboard state root (outside the repo). Hosts the ONE paid-action journal and the grant journal. */
  stateRoot: string;
  /** Server-owned attempt-worktree root: `worktreeRoot/<runRef>/<attemptRef>` is each call's artifact root. */
  worktreeRoot: string;
  /** Production credential resolver (server-side key, never in a worktree). Defaults to the real resolver
   *  guarded so its secrets path can never resolve inside `worktreeRoot`. */
  credentials?: PaidActionCredentialResolver;
  /** Production provider transport (one HTTP attempt per dispatch). Defaults to the real transport. */
  transport?: PaidActionTransport;
  now?: () => Date;
  lockTimeoutMs?: number;
}

/** A committer that writes each call's bytes into that call's own attempt worktree. */
function createRootResolvingCommitter(worktreeRoot: string): PaidActionCommitter {
  return {
    async commit(input) {
      const worktreePath = planAttemptWorktreePath(worktreeRoot, input.runRef, input.attemptRef);
      return createProviderCommitter({ repoRoot: worktreePath }).commit(input);
    },
  };
}

/** A verifier that re-reads each call's artifact from that call's attempt worktree, resolved from the
 *  service's own journal (the verifier's input carries only an actionRef). */
function createRootResolvingVerifier(
  worktreeRoot: string,
  locate: (actionRef: string) => { runRef: string; attemptRef: string } | null,
): PaidActionArtifactVerifier {
  return {
    async verify(input) {
      const located = locate(input.actionRef);
      if (!located) return null;
      const worktreePath = planAttemptWorktreePath(worktreeRoot, located.runRef, located.attemptRef);
      return createProviderArtifactVerifier({ repoRoot: worktreePath }).verify(input);
    },
  };
}

/**
 * Build the paid-action service (one journal, root-resolving artifact I/O) and its sibling spend-grant
 * store. Startup reconciliation is deferred to the first execute so this stays synchronous and side-effect
 * free at construction (the gate-off "constructs nothing that spends" posture): nothing here touches a
 * provider, and the journals are only read/written on the first real call.
 */
export function buildPaidActionExecution(options: BuildPaidActionExecutionOptions): PaidActionExecution {
  const credentials = options.credentials
    ?? createProviderCredentialResolver({ worktreesRoot: options.worktreeRoot });
  const transport = options.transport ?? createProviderTransport();

  const committer = createRootResolvingCommitter(options.worktreeRoot);
  let service: ReturnType<typeof createPaidActionService> | null = null;
  const verifier = createRootResolvingVerifier(options.worktreeRoot, (actionRef) => {
    const action = service?.snapshot().find((candidate) => candidate.actionRef === actionRef);
    return action ? { runRef: action.runRef, attemptRef: action.attemptRef } : null;
  });

  service = createPaidActionService({
    stateRoot: options.stateRoot,
    credentials,
    transport,
    committer,
    verifier,
    ...(options.now ? { now: options.now } : {}),
    ...(options.lockTimeoutMs !== undefined ? { lockTimeoutMs: options.lockTimeoutMs } : {}),
  });
  const built = service;

  // Reconcile the one journal exactly once, lazily, before the first execute. The service refuses execute
  // until reconciliation completes; memoizing the promise makes concurrent first calls share it.
  let reconciled: Promise<{ failed: number; unknown: number }> | null = null;
  const ensureReconciled = (): Promise<{ failed: number; unknown: number }> => {
    if (!reconciled) reconciled = built.reconcileStartup();
    return reconciled;
  };

  const paidActionService: PaidActionExecutor = {
    async execute(input) {
      await ensureReconciled();
      return built.execute(input);
    },
    snapshot: () => built.snapshot(),
  };

  const spendGrantStore = createSpendGrantStore({
    stateRoot: options.stateRoot,
    ...(options.now ? { now: options.now } : {}),
    ...(options.lockTimeoutMs !== undefined ? { lockTimeoutMs: options.lockTimeoutMs } : {}),
  });

  return { paidActionService, spendGrantStore };
}
