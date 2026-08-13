/**
 * U2 — the governed write surface's composition root. Builds one encapsulated Fastify child scope that
 * applies, as `onRequest` hooks in this exact order, the SAME primitives the hub already uses:
 *
 *   1. `security/origin.ts#originPlugin`   — Origin/Host guard (fail-closed: empty allowlist 403s all).
 *   2. `http/middleware.ts#writeRateLimitHook` — sliding-window rate-limit + lockout.
 *
 * then registers the auth / write / composer / approvals routes onto that scope (each mutating route adds
 * its own `requireSession` preHandler, so the full chain is origin -> rate-limit -> session -> gate ->
 * audit). `/healthz` and the read-only hub/registry/planeA routes stay OUTSIDE this scope — untouched.
 *
 * All security config is resolved ONCE here (notably the session secret — re-resolving per request would
 * mint a fresh random secret and invalidate every token). Tests call `makeSurfaceContext` with overrides
 * to inject hermetic runners and a test allowlist/credential store; production passes none and every
 * gate falls back to its real default.
 */
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { resolveSessionSecret, resolveSessionTtlMs } from '../auth/session.ts';
import { resolveAllowedOrigins, originPlugin } from '../security/origin.ts';
import { resolveWebAuthnConfig } from '../auth/webauthn.ts';
import { resolveCredentials } from '../auth/credentialStore.ts';
import { makeDefaultReadRateGuard, makeDefaultWriteRateGuard, surfaceRateLimitHook } from './middleware.ts';
import type { SurfaceContext } from './context.ts';
import { registerAuthRoutes } from '../auth/routes.ts';
import { registerWriteRoutes } from '../write/routes.ts';
import { registerComposerRoutes } from '../composer/routes.ts';
import { createResumeRegistry } from '../composer/resumeRegistry.ts';
import { createProviderIdProtector } from '../composer/protector.ts';
import { createFileComposerStore, resolveDashboardStateRoot } from '../composer/store.ts';
import { registerApprovalsRoutes } from '../approvals/routes.ts';
import { drainVibeProcesses } from '../vibe/session.ts';
import { activeVibeProcessCount } from '../vibe/session.ts';
import { drainAsyncGit } from '../write/asyncGit.ts';
import { activeAsyncGitCount } from '../write/asyncGit.ts';
import { createFileControlPlaneStore } from '../control/store.ts';
import { createFileDefinitionAmendmentStore } from '../workflows/amendmentStore.ts';
import { registerControlRoutes } from '../control/routes.ts';
import { buildActivatedExecution, createExecutionLatch } from '../control/activation.ts';
import { createQueueBridge, dispatchClaimedCard } from '../control/queueBridge.ts';
import { publishAttemptIoSignal } from '../hub/bus.ts';
import { createPtyHost } from '../pty/host.ts';
import type { PtyHost } from '../pty/host.ts';
import { createPersistentSessionRegistry } from '../pty/persistentSessions.ts';
import { createSessionRunStore } from '../pty/sessionRuns.ts';
import { createTranscriptRecorder } from '../pty/transcripts.ts';
import { RunControlTransactions } from '../control/runTransactions.ts';
import { DEFAULT_MANAGER_START_ACK_TIMEOUT_MS } from '../control/execution.ts';
import { assertFleetRunnable, defaultPreambleRunner } from '../write/preambleGate.ts';
import type { PreambleRunner } from '../write/preambleGate.ts';
import { quiescence } from '../release/quiescence.ts';
import { serviceCgroupChildCount } from '../release/serviceCgroup.ts';

/** dashboard/server/http/surface.ts -> ../../../ is the repo root. Overridable via env / tests. */
export function resolveRepoRoot(): string {
  return process.env.DASHBOARD_REPO_ROOT ?? fileURLToPath(new URL('../../../', import.meta.url));
}

export function resolveDurableRepoRoot(): string {
  return process.env.DASHBOARD_DURABLE_REPO_ROOT ?? resolveRepoRoot();
}

/**
 * Optional seam for the Wave-A executor activation. Production passes nothing: `build` defaults to the
 * real `buildActivatedExecution` and `env` to `process.env`, so the gate (`DASHBOARD_EXECUTION_ACTIVATED`)
 * is read from the real environment and the executor is constructed only when it is `'1'`. Tests inject a
 * hermetic `build`/`env` so the gate-on wiring is exercised without shelling git or touching the fs.
 */
export interface SurfaceActivationSeam {
  build?: typeof buildActivatedExecution;
  env?: Record<string, string | undefined>;
  createQueueBridge?: typeof createQueueBridge;
  dispatchClaimedCard?: typeof dispatchClaimedCard;
}

const QUEUE_BRIDGE_INTERVAL_MS = 15_000;

/** Stable, detail-free refusal for manual Terminal PTY opens at the host boundary. */
export const PTY_OPEN_FLEET_FROZEN = 'pty open refused: fleet-frozen';

/**
 * Put the fleet preamble on the shared host itself, not only on one HTTP route. The browser route may
 * deliberately check twice; the second check closes the gap for session-registry callers that
 * reach `PtyHost.open` without traversing that route. Construction stays inert: no preamble runs and no
 * shell opens until `open` is actually invoked.
 */
function fleetGatedPtyHost(host: PtyHost, repoRoot: string, runPreamble: PreambleRunner): PtyHost {
  return {
    open(request) {
      try {
        if (!assertFleetRunnable(repoRoot, runPreamble).ok) throw new Error(PTY_OPEN_FLEET_FROZEN);
      } catch {
        // Preamble stdout/stderr can name environment or credential problems. Never surface those details
        // through a PTY spawn error, audit row, or WebSocket close reason.
        throw new Error(PTY_OPEN_FLEET_FROZEN);
      }
      return host.open(request);
    },
    stop(sessionId) {
      return host.stop(sessionId);
    },
    stopAll() {
      host.stopAll();
    },
    sessions() {
      return host.sessions();
    },
  };
}

/** Build a full {@link SurfaceContext}, filling every field not supplied in `overrides` with its real
 *  default. `sessionConfig`'s secret is resolved exactly once (see module doc). */
export function makeSurfaceContext(
  overrides: Partial<SurfaceContext> = {},
  activation: SurfaceActivationSeam = {},
): SurfaceContext {
  const sessionConfig = overrides.sessionConfig ?? { secret: resolveSessionSecret(), ttlMs: resolveSessionTtlMs() };
  const repoRoot = overrides.repoRoot ?? resolveRepoRoot();
  const stateRoot = overrides.stateRoot ?? resolveDashboardStateRoot();
  const controlStore = overrides.controlStore ?? createFileControlPlaneStore(stateRoot);
  // Wave-A executor activation (env-gated, default OFF). When any of the three executor fields is already
  // supplied as an override (tests, or a future explicit injection), activation is skipped entirely so no
  // construction is attempted. Otherwise `buildActivatedExecution` returns `null` unless the gate is on —
  // meaning production, gate absent, constructs no broker/engine and spawns no `claude` (the core inert
  // invariant): the executor fields below stay `undefined` exactly as today.
  const activationOverridden = overrides.controlBroker !== undefined
    || overrides.runAutomatic !== undefined
    || overrides.cancelAutomatic !== undefined
    || overrides.containManagerStart !== undefined
    || overrides.verifyCanonicalResult !== undefined;
  const build = activation.build ?? buildActivatedExecution;
  const buildQueueBridge = activation.createQueueBridge ?? createQueueBridge;
  const dispatchQueueCard = activation.dispatchClaimedCard ?? dispatchClaimedCard;
  // The daemon's PTY stack belongs exclusively to `/api/pty` browser terminals. Constructing a host
  // spawns nothing; only `open` does.
  const underlyingPtyHost = overrides.ptyHost ?? createPtyHost({ shell: 'powershell.exe' });
  const ptyHost = fleetGatedPtyHost(
    underlyingPtyHost,
    repoRoot,
    overrides.runPreamble ?? defaultPreambleRunner,
  );
  const ptySessions = overrides.ptySessions ?? createPersistentSessionRegistry();
  // Session runs + transcripts (leg 2). Construction is INERT: the store's JSON document is created
  // lazily and the recorder only touches disk once a session is actually taped, so building a context
  // — which every server test does — writes nothing. The `live` → `abandoned` boot sweep runs at ROUTE
  // REGISTRATION instead, the one moment that happens exactly once per daemon boot.
  const ptySessionRuns = overrides.ptySessionRuns ?? createSessionRunStore(stateRoot);
  const ptyTranscripts = overrides.ptyTranscripts ?? createTranscriptRecorder({ root: stateRoot });
  const definitionAmendmentStore = overrides.definitionAmendmentStore ?? createFileDefinitionAmendmentStore(stateRoot);
  let offAttemptIo: (() => void) | null = null;
  let stopQueueBridge: (() => void) | undefined;
  let ctx!: SurfaceContext;
  ctx = {
    repoRoot,
    stateRoot,
    readiness: overrides.readiness ?? (async () => {
      const activation = ctx.executionLatch?.snapshot();
      let serviceCgroupChildren: number;
      try {
        serviceCgroupChildren = serviceCgroupChildCount();
      } catch {
        return { ok: true, quiescent: false, blockers: ['service-cgroup-unknown'] };
      }
      return quiescence({
        executionState: activation?.state ?? 'locked',
        bridgeStopped: ctx.stopQueueBridge === undefined,
        queuedWork: 0,
        // The latch does not expose a worker count. Until the deferred coordinator
        // supplies one, an unlocked latch is conservatively treated as active;
        // locked/locking state already prevents readiness through executionState.
        activeWorkers: activation?.state === 'unlocked' ? 1 : 0,
        activeGit: activeAsyncGitCount(),
        activePty: ctx.ptySessions?.liveCount() ?? 0,
        activeComposer: activeVibeProcessCount(),
        serviceCgroupChildren,
      });
    }),
    hubBus: overrides.hubBus,
    definitionAmendmentStore,
    durableRepoRoot: overrides.durableRepoRoot ?? overrides.repoRoot ?? resolveDurableRepoRoot(),
    sessionConfig,
    allowedOrigins: overrides.allowedOrigins ?? resolveAllowedOrigins(),
    rateGuard: overrides.rateGuard ?? makeDefaultWriteRateGuard(),
    readRateGuard: overrides.readRateGuard ?? makeDefaultReadRateGuard(),
    // Lazy: resolveWebAuthnConfig throws when DASHBOARD_RP_ORIGIN is unset — only called inside a handler
    // (which the origin guard has already blocked when the allowlist is empty), never at registration.
    webAuthnConfig: overrides.webAuthnConfig ?? (() => resolveWebAuthnConfig()),
    credentials: overrides.credentials ?? (() => resolveCredentials()),
    appendAudit: overrides.appendAudit,
    appendAuditLocal: overrides.appendAuditLocal,
    opsGit: overrides.opsGit,
    saveGit: overrides.saveGit,
    openPr: overrides.openPr,
    runPy: overrides.runPy,
    runPreamble: overrides.runPreamble,
    activateManagedRoots: overrides.activateManagedRoots,
    spawn: overrides.spawn,
    vibeRateGuard: overrides.vibeRateGuard,
    now: overrides.now,
    // One issued-session allowlist for the whole process (review F1) — resumes only ids captured this
    // lifetime. Tests override with a fresh instance so ids never leak between them.
    resumeRegistry: overrides.resumeRegistry ?? createResumeRegistry(),
    composerStore:
      overrides.composerStore ??
      createFileComposerStore(stateRoot, {
        protector: createProviderIdProtector(sessionConfig.secret),
      }),
    controlStore,
    ptyHost,
    ptySessions,
    ptySessionRuns,
    ptyTranscripts,
    // Executor fields start UNBOUND: with the latch locked (the boot posture) nothing is constructed, so
    // every control route observes exactly the pre-activation refusals. The latch below rebinds them in
    // place on unlock and clears them on lock.
    controlBroker: overrides.controlBroker,
    runAutomatic: overrides.runAutomatic,
    cancelAutomatic: overrides.cancelAutomatic,
    containManagerStart: overrides.containManagerStart,
    verifyCanonicalResult: overrides.verifyCanonicalResult,
    // Paid-action execution starts UNBOUND for the same reason as the executor fields above: the latch
    // binds it on unlock and clears it on lock. A test may inject it directly to exercise the route.
    paidActionService: overrides.paidActionService,
    spendGrantStore: overrides.spendGrantStore,
    runControlTransactions: overrides.runControlTransactions ?? new RunControlTransactions(),
    managerStartAckTimeoutMs: overrides.managerStartAckTimeoutMs ?? DEFAULT_MANAGER_START_ACK_TIMEOUT_MS,
    triggerRunner: overrides.triggerRunner,
    schtasksRun: overrides.schtasksRun,
    // One liveness cache per context (see resumeRegistry) — persists across responds within this process,
    // fresh per test context so schtasks probe results never leak between tests.
    livenessCache: overrides.livenessCache ?? new Map(),
  };

  // The latch owns construction from here on. An explicitly injected latch stands as given; when
  // executor fields are injected directly no latch is created at all;
  // otherwise the daemon boots locked — or, with the headless override set, unlocks itself immediately
  // inside `createExecutionLatch`, which is the pre-latch behaviour.
  if (overrides.executionLatch !== undefined) {
    ctx.executionLatch = overrides.executionLatch;
  } else if (!activationOverridden) {
    ctx.executionLatch = createExecutionLatch({
      build,
      env: activation.env,
      buildOptions: { controlStore, repoRoot, stateRoot },
      onChange: (execution, state, serviceCaller) => {
        stopQueueBridge?.();
        stopQueueBridge = undefined;
        ctx.stopQueueBridge = undefined;
        offAttemptIo?.();
        offAttemptIo = null;
        ctx.controlBroker = execution?.controlBroker;
        ctx.runAutomatic = execution?.runAutomatic;
        ctx.cancelAutomatic = execution?.cancelAutomatic;
        ctx.containManagerStart = execution?.containManagerStart;
        ctx.verifyCanonicalResult = execution?.verifyCanonicalResult;
        ctx.paidActionService = execution?.paidActionService;
        ctx.spendGrantStore = execution?.spendGrantStore;
        if (execution && ctx.hubBus) {
          const bus = ctx.hubBus;
          offAttemptIo = execution.attemptIo.onAppend((event) => publishAttemptIoSignal(bus, {
            attemptRef: event.attemptRef,
            seq: event.entry.seq,
          }));
        }
        if (execution && state.source === 'passkey' && serviceCaller) {
          const bridge = buildQueueBridge({
            repoRoot: ctx.repoRoot,
            runPy: ctx.runPy,
            runPreamble: ctx.runPreamble,
            dispatch: async (card) => {
              if (ctx.executionLatch?.current() !== execution) {
                throw new Error('queue bridge dispatch refused outside the armed execution window');
              }
              const result = await dispatchQueueCard(ctx, card, {
                isArmed: () => ctx.executionLatch?.current() === execution,
                internalCaller: (subject) => {
                  if (subject !== serviceCaller.subject) {
                    throw new Error('queue bridge requested an unexpected internal service subject');
                  }
                  if (ctx.executionLatch?.current() !== execution) {
                    throw new Error('internal service caller unavailable outside the armed execution window');
                  }
                  return serviceCaller;
                },
              });
              if (result.outcome !== 'launched' && result.outcome !== 'replayed') {
                console.error('queue bridge dispatch did not launch', result);
              }
            },
            onError: (error) => console.error('queue bridge tick failed', error),
          });
          stopQueueBridge = () => bridge.stop();
          ctx.stopQueueBridge = stopQueueBridge;
          bridge.start(QUEUE_BRIDGE_INTERVAL_MS);
        }
      },
    });
  }
  return ctx;
}

/** Register the governed write surface (auth + write + composer + approvals) as one guarded child scope. */
export function registerWriteSurface(app: FastifyInstance, ctx: SurfaceContext = makeSurfaceContext()): void {
  // preClose runs before Fastify waits for long-lived streaming requests to finish. Draining in
  // onClose would deadlock shutdown behind the very Composer children it was meant to stop.
  app.addHook('preClose', async () => {
    ctx.stopQueueBridge?.();
    ctx.stopQueueBridge = undefined;
    ctx.controlBroker?.drain();
    drainVibeProcesses();
    // Kill any in-flight (possibly network-stalled) coordination git/gh child so shutdown never blocks
    // behind a hung push — the very failure mode this async-git conversion exists to remove.
    drainAsyncGit();
  });
  app.register(async (scope) => {
    // Order matters: origin guard first (fail-closed), then the rate-limiter, both as onRequest hooks.
    // The rate-limiter meters GET/HEAD and mutations against SEPARATE budgets (see middleware.ts):
    // this scope fronts every governed read the UI polls, and metering those against the 30/min write
    // budget threw the whole dashboard into a 5-minute lockout under ordinary polling load.
    originPlugin(scope, { allowedOrigins: ctx.allowedOrigins });
    scope.addHook('onRequest', surfaceRateLimitHook(ctx.readRateGuard, ctx.rateGuard));

    registerAuthRoutes(scope, ctx);
    registerWriteRoutes(scope, ctx);
    registerComposerRoutes(scope, ctx);
    registerControlRoutes(scope, ctx);
    registerApprovalsRoutes(scope, ctx);
  });
}
