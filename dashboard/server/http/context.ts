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
import type { SessionConfig } from '../auth/session.ts';
import type { AllowedOrigins } from '../security/origin.ts';
import type { LockoutGuard } from '../security/ratelimit.ts';
import type { WebAuthnConfig } from '../auth/webauthn.ts';
import type { WebAuthnCredential } from '@simplewebauthn/server';
import { appendAudit as realAppendAudit } from '../audit/log.ts';
import type { AppendAuditOptions, AuditEvent, AuditRow, OpsGitRunner } from '../audit/log.ts';
import type { GitRunner, PrOpener } from '../write/branch.ts';
import type { CoordinationPublication } from '../write/outbox.ts';
import type { PyRunner } from '../write/launch.ts';
import type { PreambleRunner } from '../write/preambleGate.ts';
import type { VibeSpawner } from '../vibe/session.ts';
import type { ResumeRegistry } from '../composer/resumeRegistry.ts';
import type { ComposerWorkspaceStore } from '../composer/store.ts';
import type { RunnerTrigger } from '../runner/trigger.ts';
import type { LivenessCache, SchtasksRunner } from '../runner/liveness.ts';
import type { ControlPlaneStore } from '../control/store.ts';
import type { ManagedSessionBroker } from '../control/broker.ts';
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
import type { PtyHost } from '../pty/host.ts';
import type { PersistentSessionRegistry } from '../pty/persistentSessions.ts';
import type { SessionRunStore } from '../pty/sessionRuns.ts';
import type { TranscriptRecorder } from '../pty/transcripts.ts';
import type { DefinitionAmendmentStore } from '../workflows/amendmentStore.ts';
import type { activateManagedRootCards } from '../write/workflowRun.ts';
import type { EventBus } from '../hub/bus.ts';
import type { quiescence } from '../release/quiescence.ts';
import type { AdmissionDecision, AdmissionKind } from '../control/admission.ts';
import type { RuntimeCapabilities } from '../runtime/capabilities.ts';

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
  allowedOrigins: AllowedOrigins;
  /** The MUTATION budget (POST/PUT/PATCH/DELETE/...) on the governed scope. */
  rateGuard: LockoutGuard;
  /** The independent GET/HEAD budget on the governed scope. A separate bucket by design: UI polling
   *  must never be able to spend the write budget or trip its lockout. See `middleware.ts`. */
  readRateGuard: LockoutGuard;
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
  resumeRegistry: ResumeRegistry;
  /** Durable, subject-bound Composer workspace catalog. Provider handles remain private to this store. */
  composerStore: ComposerWorkspaceStore;
  /** App-local durable proposal/run/session/event projection. Canonical queue cards remain fleet truth. */
  controlStore: ControlPlaneStore;
  /** Optional gated daemon-owned broker. Production remains inactive until its separate approval gate. */
  controlBroker?: ManagedSessionBroker;
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
  /** The daemon's node-pty host and persistent session registry, owned by the manual Terminal view. */
  ptyHost?: PtyHost;
  ptySessions?: PersistentSessionRegistry;
  /**
   * The durable record of entity-primed terminal sessions, and their transcripts. Deliberately NOT
   * control-plane objects: a session run has no proposal hash, no executor, and no closed-tab exit (see
   * `server/pty/sessionRuns.ts`). Both are inert to construct — no file is touched until a session is
   * actually recorded.
   */
  ptySessionRuns?: SessionRunStore;
  ptyTranscripts?: TranscriptRecorder;
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
  /** Per-context TTL cache backing the liveness probe, created once per process in `makeSurfaceContext`
   *  (so a slow schtasks is queried at most once per TTL across responds) and fresh per test context. */
  livenessCache?: LivenessCache;
  /** Display-name/short-ref registry used when a route builds an entity DTO. Left undefined in
   *  production and in tests: {@link namingFor} then derives one from this context's own `stateRoot`,
   *  so a test whose `stateRoot` is a temp dir automatically gets an isolated ordinal file. */
  naming?: NamingRegistry;
}

/** The audit fn a route should call — the injected fake in tests, the real git-committing one otherwise. */
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

/** The display-name registry a DTO builder should use for this context. */
export function namingFor(ctx: SurfaceContext): NamingRegistry {
  if (ctx.naming) return ctx.naming;
  // The ungoverned Plane-A reads (`/api/index`, `/api/dag`, `/api/agents`) hold no SurfaceContext and
  // use `defaultNamingRegistry()` over the SAME shared file. On the production state root this must
  // resolve to that very instance, never a second one.
  if (resolve(ctx.stateRoot) === resolve(resolveDashboardStateRoot())) return defaultNamingRegistry();
  const existing = registryByStateRoot.get(ctx.stateRoot);
  if (existing) return existing;
  const created = new NamingRegistry(join(ctx.stateRoot, 'naming.json'));
  registryByStateRoot.set(ctx.stateRoot, created);
  return created;
}
