/**
 * U2 — the shared context every governed-write route registrar receives. It bundles the resolved
 * security config (session signing, origin allowlist, rate-limit guard, WebAuthn RP config + registered
 * credentials) plus the SAME injectable side-effect runners each gate module already exposes for its
 * own hermetic unit tests. In production every runner field is left `undefined` and each module falls
 * back to its real default (shell git/py/claude); route tests inject recording fakes so no real
 * subprocess, git remote, or `queue/` tree is ever touched — the security chain itself is never faked.
 */
import { join, resolve } from 'node:path';
import { NamingRegistry, defaultNamingRegistry } from '../naming.ts';
import { resolveDashboardStateRoot } from '../composer/store.ts';
import type { BrowserSessionRefManager, SessionConfig } from '../auth/session.ts';
import type { AuthMode } from '../auth/mode.ts';
import type { AllowedOrigins } from '../security/origin.ts';
import type { LockoutGuard } from '../security/ratelimit.ts';
import { lockout, rateLimit } from '../security/ratelimit.ts';
import type { HostNodeMapLoad } from '../auth/hostNodeMap.ts';
import type { V1SurfaceDeps } from '../api/v1/routes.ts';
import type { WebAuthnConfig } from '../auth/webauthn.ts';
import type { WebAuthnCredential } from '@simplewebauthn/server';
import { appendAudit as realAppendAudit } from '../audit/log.ts';
import type { AppendAuditOptions, AuditEvent, AuditRow, OpsGitRunner } from '../audit/log.ts';
import type { GitRunner, PrOpener } from '../write/branch.ts';
import type { CoordinationPublication } from '../write/outbox.ts';
import type { PyRunner } from '../write/launch.ts';
import type { PreambleRunner } from '../write/preambleGate.ts';
import type { VibeSpawner } from '../vibe/session.ts';
import type { ComposerWorkspaceStore } from '../composer/store.ts';
import type { RunnerTrigger } from '../runner/trigger.ts';
import type {
  LivenessCache,
  ProcessStartTimeReader,
  RunnerStateReader,
  SchtasksRunner,
} from '../runner/liveness.ts';
import type { ControlPlaneStore } from '../control/store.ts';
import type { AttemptExecutionPort } from '../pty/contracts.ts';
import type {
  CancelRunInput,
  CancellationOutcome,
  ContainManagerStartInput,
  ExecuteRunInput,
  ExecutionOutcome,
} from '../control/execution.ts';
import type { RunControlTransactions } from '../control/runTransactions.ts';
import type { ExecutionLatch } from '../control/activation.ts';
import type { PaidActionExecutor } from '../control/paidActionWiring.ts';
import type { SpendGrant } from '../control/spendGrant.ts';
import type { SessionHost } from '../pty/contracts.ts';
import type { AttemptSessionPublicRow } from '../control/p2Contracts.ts';
import type { DeploymentSessionCloser, SessionRecordRegistry } from '../pty/sessionRecord.ts';
import type { RawSessionReplayResult } from '../pty/replayReader.ts';
import type { SessionRunStore } from '../pty/sessionRuns.ts';
import type { SessionPersistence } from '../pty/sessionPersistence.ts';
import type { DefinitionAmendmentStore } from '../workflows/amendmentStore.ts';
import type { activateManagedRootCards } from '../write/workflowRun.ts';
import type { EventBus } from '../hub/bus.ts';
import type { quiescence } from '../release/quiescence.ts';
import type { AdmissionDecision, AdmissionKind } from '../control/admission.ts';
import type { RuntimeCapabilities } from '../runtime/capabilities.ts';
import type { ReconciliationPublisher } from '../reconciliation/realPorts.ts';
import type { ActivationReaderPort } from '../home/project.ts';

/** How a route records exactly one audit row. Injected as a recording fake in tests. Widened to allow a
 *  `Promise` so the real (now async, off-the-event-loop) `appendAudit` and synchronous test fakes both fit;
 *  every route `await`s it. */
export type AppendAuditFn = (repoRoot: string, event: AuditEvent, options?: AppendAuditOptions) => AuditRow | Promise<AuditRow>;
/** Local-only audit append used when the consequential write and audit must share one ops commit. */
export type AppendAuditLocalFn = (repoRoot: string, event: AuditEvent, now?: () => Date) => AuditRow;

export interface SurfaceContext {
  /** Host capabilities resolved once at the composition root. */
  runtimeCapabilities: RuntimeCapabilities;
  /** Canonical ops worktree used for live reads and coordination writes. */
  repoRoot: string;
  /**
   * P4 W6.2 [P4-C33]: the ONE server-owned reconciliation publisher, composed once at the surface root
   * over the real store/ops ports. Present for step 2's callers (card/inbox transitions, schedule
   * effects); step 1 composes it but calls it from nowhere — the four heredocs stay live.
   */
  reconciliationPublisher: ReconciliationPublisher;
  /** Coordination publication is resolved once at the HTTP composition root. */
  coordinationPublication?: CoordinationPublication;
  /** Durable VM spool root used when coordination publication is `outbox`. */
  outboxRoot?: string;
  /** Startup recovery fault retained as degraded state so /readyz remains available for repair tooling. */
  outboxRecoveryFailure?: string;
  /** Admission policy for work that would add to the durable outbox. */
  admission: (kind: AdmissionKind) => AdmissionDecision;
  /** Dashboard-owned runtime state root; never a repository content path. */
  stateRoot: string;
  /** Readable local Claude transcript root resolved once at composition; null when unavailable. */
  traceRoot: string | null;
  /** Minimal, unauthenticated readiness probe. */
  readiness: () => Promise<ReturnType<typeof quiescence>>;
  /** Optional live hub bus; the surface uses it only while an execution latch is armed. */
  hubBus?: EventBus;
  /** Restart-safe, server-owned pending definition-amendment records. */
  definitionAmendmentStore: DefinitionAmendmentStore;
  /** Isolated work-branch checkout used only for durable Composer saves. */
  durableRepoRoot?: string;
  /** One shared session config (secret resolved ONCE) so a token minted at assert/verify verifies at
   *  every write route. Re-resolving per request would mint a fresh random secret and break everything. */
  sessionConfig: SessionConfig;
  /** Deployment authentication mode resolved once at the HTTP composition root. */
  authMode: AuthMode;
  /**
   * P5 W6.1 [P5-C30]: the ONE shared installed-release activation reader, constructed exactly once in
   * `makeSurfaceContext` and threaded through this context. Home (D13 chip), Health (ReleaseRow), and the
   * Inbox deploy-ready gate all read the live release SHA/activation time through THIS instance — never a
   * checkout, and never a second construction. W6.2 consumes it in `health/service.ts`. Optional only so
   * the many test contexts that never touch a release need not build one; `makeSurfaceContext` ALWAYS
   * sets it in production, and `index.ts` passes that one instance to Home, Health, and the Inbox gate.
   */
  activationReader?: ActivationReaderPort;
  allowedOrigins: AllowedOrigins;
  /** The MUTATION budget (POST/PUT/PATCH/DELETE/...) on the governed scope. */
  rateGuard: LockoutGuard;
  /** The independent GET/HEAD budget on the governed scope. A separate bucket by design: UI polling
   *  must never be able to spend the write budget or trip its lockout. See `middleware.ts`. */
  readRateGuard: LockoutGuard;
  /**
   * P6 W6.1 [P6-C33]: the v1 NODE scope's OWN rate-guard pair, never shared with the operator pair
   * above. A renewing/reporting Desktop daemon — or a hostile node — spends only these buckets, so it can
   * never trip Daniel's write-surface lockout. Sized ABOVE the intended node traffic [P6-C52] so a
   * 204-on-timeout client that re-claims immediately after a 25-s long-poll never `429`s. Built in
   * {@link makeNodeRateGuard}/{@link makeNodeReadRateGuard} beside the operator pair; absent only in the
   * many test contexts that register no node scope.
   */
  nodeRateGuard?: LockoutGuard;
  nodeReadRateGuard?: LockoutGuard;
  /**
   * P6 W6.1/W4 [P6-C46]: the attested `kb-node-proxy` uid the node scope's peer-uid topology guard proves
   * against. `undefined` disables the node scope entirely (fail-closed: no node routes register). NEVER
   * `0` and never equal to the operator proxy uid — `assertAuthModeBoot` refuses to boot otherwise.
   */
  nodeProxyUid?: number;
  /** The boot-loaded root-owned host-node map (or its fail-closed sentinel), resolved once — not per request. */
  loadHostNodeMap?: () => HostNodeMapLoad;
  /**
   * P6 W6.1: the injectable ports the v1 route surface is thin over. Production binds these to the extracted
   * W2 services + the placement store adapters; route tests inject recording fakes exactly as every other
   * governed route does. Absent leaves the v1 surface unregistered (fail-closed).
   */
  v1?: V1SurfaceDeps;
  /** Lazy — `auth/webauthn.ts#resolveWebAuthnConfig` THROWS when `DASHBOARD_RP_ORIGIN` is unset, so it
   *  is only ever called inside a handler (which the origin guard already blocked when the allowlist is
   *  empty), never at registration time. */
  webAuthnConfig: () => WebAuthnConfig;
  /** The fail-closed registered-credential store (`[]` until a human provisions a passkey). */
  credentials: () => WebAuthnCredential[];

  // --- injectable side-effect runners (undefined => each module's real default) ---
  appendAudit?: AppendAuditFn;
  appendAuditLocal?: AppendAuditLocalFn;
  /** Git runner for the audit-log ops commit + the floor's coordination writes. */
  opsGit?: OpsGitRunner;
  /** Git runner for governedSave's branch routing (structurally identical; kept distinct for clarity). */
  saveGit?: GitRunner;
  openPr?: PrOpener;
  runPy?: PyRunner;
  runPreamble?: PreambleRunner;
  /** Exact managed-root activation seam; production uses the canonical queue-card transaction. */
  activateManagedRoots?: typeof activateManagedRootCards;
  spawn?: VibeSpawner;
  /** Optional dedicated guard for the vibe module's own internal limiter (else its module singleton). */
  vibeRateGuard?: LockoutGuard;
  now?: () => Date;
  /** review F1 — the process-lifetime issued-CLI-session allowlist that binds Composer's `--resume`.
   *  Created ONCE per process in `makeSurfaceContext` (so ids captured on one turn are visible to the
   *  next); tests inject a fresh instance so nothing leaks across them. */
  /** Durable, subject-bound Composer workspace catalog. Provider handles remain private to this store. */
  composerStore: ComposerWorkspaceStore;
  /** App-local durable proposal/run/session/event projection. Canonical queue cards remain fleet truth. */
  controlStore: ControlPlaneStore;
  /** Optional gated attempt-execution authority. Production remains inactive until its approval gate,
   *  and it stays absent when the daemon has no usable PTY host. */
  attemptPort?: AttemptExecutionPort;
  /**
   * The runtime execution unlock latch. The daemon boots LOCKED (no wiring constructed) and the
   * passkey-gated unlock route asks this to construct it, which rebinds the executor fields below IN
   * PLACE on this same context object — so every route that already checks `ctx.runAutomatic` observes
   * the current posture without a second lookup path. Absent only when a test injects the executor.
   */
  executionLatch?: ExecutionLatch;
  /** Stop the closure-owned queue poller during preClose; never exposes tick/dispatch to routes. */
  stopQueueBridge?: () => void;
  /** FYT paid-action executor (server-owned spend). Bound ONLY behind the activation gate (with the
   *  executor fields above), so it is `undefined` while the daemon is locked/inert and the paid-action
   *  route fails closed. Never supplied by the browser. */
  paidActionService?: PaidActionExecutor;
  /** The durable spend-grant resolver the paid-action route validates a worker's bearer token against.
   *  Bound with {@link paidActionService}; the raw token never leaves the worker, only its hash is stored. */
  spendGrantStore?: { resolve(token: string, now?: Date): SpendGrant | null };
  /** The one platform PTY host for `/api/pty` (Windows `node-pty`, Linux broker client), already wrapped
   *  in the fleet-preamble gate. Absent when the runtime reports no PTY capability. */
  ptySessionHost?: SessionHost;
  /** The one v2 session registry every registered PTY route goes through. */
  ptySessionRegistry?: SessionRecordRegistry;
  /**
   * The typed, read-only raw transcript read ([C-R6]) the Run-scoped replay route serves earlier
   * attempts from. Deliberately the `read` half of `RawSessionReplaySource`, never the WebSocket
   * `reader` adapter: the control route must see a gap or an unreadable transcript as a REFUSAL
   * VALUE it can turn into a status, not as "attach with no scrollback". It cannot write, spawn,
   * resize, or close, so a caller the control store already authorized to read the run can hold it.
   */
  ptyRawReplay?: (sessionId: string, fromSequence: number) => Promise<RawSessionReplayResult>;
  /**
   * [C-M4] The Run detail DTO's attempt-session projection, read synchronously at DTO build time. It
   * is a projection port rather than a registry method so the Run detail route cannot reach anything
   * else on the PTY document: it takes an operator plus a run ref and returns public rows only. Absent
   * without PTY persistence, in which case the run carries an empty attempt list.
   */
  ptyRunAttemptSessions?: (operator: string, runRef: string) => AttemptSessionPublicRow[];
  /**
   * The ONLY cross-controller termination: Daniel's deployment `close-ptys-and-continue` against exact
   * ids. It is deliberately not a method on the registry, so no ordinary route can reach it.
   */
  closeDeploymentPtySessions?: DeploymentSessionCloser;
  /**
   * The durable record of entity-primed terminal sessions. Deliberately NOT a control-plane object: a
   * session run has no proposal hash, no executor, and no closed-tab exit (see `server/pty/sessionRuns.ts`).
   * Inert to construct — no file is touched until a session is actually recorded. Transcript bytes are
   * owned by the v2 registry's `createTranscriptRetention` port, never by a context field.
   */
  ptySessionRuns?: SessionRunStore;
  /**
   * The one `kb.pty-sessions/v2` document port for the process (spec [C-M3]): session records, attempt
   * bindings, operation receipts and the legacy session-run rows all live in it, behind one lock and one
   * revision counter. Built by `makeSurfaceContext`; inert until first use.
   */
  ptyPersistence?: SessionPersistence;
  /**
   * The browser-session-ref table. `auth/routes.ts` mints/renews the `kb_browser_session` cookie through
   * it at a verified assertion; the second half of every PTY principal comes from that cookie. Absent, no
   * cookie is issued and PTY work has no principal at all — a closed refusal, never a default principal.
   */
  browserSessionRefs?: BrowserSessionRefManager;
  /** Optional server-owned automatic executor; never supplied by the browser. */
  runAutomatic?: (input: ExecuteRunInput) => Promise<ExecutionOutcome>;
  /** Optional executor-owned cancellation boundary for Manager and Worker processes. */
  cancelAutomatic?: (input: CancelRunInput) => Promise<CancellationOutcome>;
  /** Recovery-only Manager startup containment; preserves the run/stage graph for exact resume. */
  containManagerStart?: (input: ContainManagerStartInput) => Promise<void>;
  /** Exact canonical g1 result proof used only before replaying an already-completed root. */
  verifyCanonicalResult?: (input: { subject: string; runRef: string; stageId: string }) => Promise<boolean>;
  /** Per-run runtime-control serializer; never substitutes for durable store CAS. */
  runControlTransactions: RunControlTransactions;
  /** Deadline for the durable Manager-start acknowledgement returned to an activating operator. */
  managerStartAckTimeoutMs: number;
  /** Signals an already-provisioned background runner after a committed launch. */
  triggerRunner?: RunnerTrigger;
  /** G3 reply-liveness — read-only Windows Task Scheduler probe seam (mirrors `triggerRunner`). Injected as
   *  a recording fake in tests; production leaves it undefined and `ownerLiveness` shells the real
   *  `schtasks /Query`. Never involves a credential. */
  schtasksRun?: SchtasksRunner;
  /** Linux detached-runner state and /proc probes. */
  runnerState?: RunnerStateReader;
  runnerProcessStartTime?: ProcessStartTimeReader;
  /** Per-context TTL cache backing the liveness probe, created once per process in `makeSurfaceContext`
   *  (so a slow schtasks is queried at most once per TTL across responds) and fresh per test context. */
  livenessCache?: LivenessCache;
  /** Display-name/short-ref registry used when a route builds an entity DTO. Left undefined in
   *  production and in tests: {@link namingFor} then derives one from this context's own `stateRoot`,
   *  so a test whose `stateRoot` is a temp dir automatically gets an isolated ordinal file. */
  naming?: NamingRegistry;
}

/** The audit fn a route should call — the injected fake in tests, the real git-committing one otherwise.
 *  Operator attribution is deliberately NOT stamped here: it is applied at the single row-write point
 *  (`audit/log.ts#appendAuditRowLocal`), so writers that bypass this wrapper — notably `pty/route.ts`,
 *  which appends through its own context — are covered by the same one seam. */
export function auditFn(ctx: SurfaceContext): AppendAuditFn {
  if (ctx.appendAudit) return ctx.appendAudit;
  return (repoRoot, event, options = {}) => realAppendAudit(repoRoot, event, {
    ...options,
    publication: ctx.coordinationPublication,
    outboxRoot: ctx.outboxRoot,
  });
}

/**
 * One {@link NamingRegistry} per state root. Ordinals are append-only and each save rewrites the WHOLE
 * document from that instance's own in-memory snapshot, so two instances over one file would hand out
 * "the next ordinal" from stale snapshots and silently clobber each other's assignments. Every caller
 * on a given state root therefore shares one instance.
 */
const registryByStateRoot = new Map<string, NamingRegistry>();

/**
 * P6 W6.1 [P6-C33, P6-C52]: the v1 NODE scope's write budget, its OWN `LockoutGuard` instance built
 * beside the operator pair and never shared. Sized above the intended node traffic: claim 4/60 s, renew
 * 6/120 s, report 60 burst then 10/s all coexist under one coarse per-peer bucket of 90 writes/min with
 * a short 60-s lockout, so an immediate re-claim after a 25-s long-poll cannot `429`, while a genuine
 * flood well above those budgets is still throttled — for that node's peer only, leaving the operator
 * write surface (its own separate bucket) fully responsive.
 */
export function makeNodeRateGuard(): LockoutGuard {
  return lockout(rateLimit({ limit: 90, windowMs: 60_000 }), { threshold: 20, lockoutMs: 60_000 });
}

/** The v1 node scope's read budget. There are no node GETs today, but the shared
 *  `surfaceRateLimitHook(readGuard, writeGuard)` needs both halves; keeping it isolated preserves the
 *  same "a read can never spend the write budget" split the operator pair has. */
export function makeNodeReadRateGuard(): LockoutGuard {
  return lockout(rateLimit({ limit: 300, windowMs: 60_000 }), { threshold: 20, lockoutMs: 60_000 });
}

/** The display-name registry a DTO builder should use for this context. */
export function namingFor(ctx: SurfaceContext): NamingRegistry {
  if (ctx.naming) return ctx.naming;
  // Repository projections such as `/api/index` hold no SurfaceContext and use
  // `defaultNamingRegistry()` over the SAME shared file. On the production state root this must
  // resolve to that very instance, never a second one.
  if (resolve(ctx.stateRoot) === resolve(resolveDashboardStateRoot())) return defaultNamingRegistry();
  const existing = registryByStateRoot.get(ctx.stateRoot);
  if (existing) return existing;
  const created = new NamingRegistry(join(ctx.stateRoot, 'naming.json'));
  registryByStateRoot.set(ctx.stateRoot, created);
  return created;
}
