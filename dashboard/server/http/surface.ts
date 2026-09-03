/**
 * U2 — the governed HTTP surface's composition root. Builds one encapsulated Fastify child scope that
 * applies, as `onRequest` hooks in this exact order, the SAME primitives the hub already uses:
 *
 *   1. `security/origin.ts#originPlugin`   — Origin/Host guard (fail-closed: empty allowlist 403s all).
 *   2. `http/middleware.ts#writeRateLimitHook` — sliding-window rate-limit + lockout.
 *
 * It registers the public auth ceremonies, then a nested authenticated scope for write, composer,
 * control, and approval routes. That scope is the fail-closed backstop; individual mutating routes keep
 * their own `requireSession` preHandlers and gates. `/healthz`, `/readyz`, static assets, and the
 * read-only data scope are composed elsewhere.
 *
 * All security config is resolved ONCE here (notably the session secret — re-resolving per request would
 * mint a fresh random secret and invalidate every token). Tests call `makeSurfaceContext` with overrides
 * to inject hermetic runners and a test allowlist/credential store; production passes none and every
 * gate falls back to its real default.
 */
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve as resolvePath } from 'node:path';
import { connect as connectSocket } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { BROKER_SOCKET_PATH } from '../pty/fdPinnedPaths.ts';
import { createBrowserSessionRefStore, resolveSessionSecret, resolveSessionTtlMs } from '../auth/session.ts';
import { resolveAuthMode, resolveTailnetConfig } from '../auth/mode.ts';
import { createTailnetOperatorAuth } from '../auth/tailnetOperator.ts';
import { resolveAllowedOrigins, originPlugin } from '../security/origin.ts';
import { resolveWebAuthnConfig } from '../auth/webauthn.ts';
import { resolveCredentials } from '../auth/credentialStore.ts';
import { makeDefaultReadRateGuard, makeDefaultWriteRateGuard, requireSession, surfaceRateLimitHook } from './middleware.ts';
import type { SurfaceContext } from './context.ts';
import { makeNodeRateGuard, makeNodeReadRateGuard } from './context.ts';
import { registerV1NodeRoutes, registerV1Routes } from '../api/v1/routes.ts';
import { registerAuthRoutes, registerBrowserSessionRoute } from '../auth/routes.ts';
import { createActivationReader } from '../home/routes.ts';
import { registerWriteRoutes } from '../write/routes.ts';
import { createProviderIdProtector } from '../composer/protector.ts';
import { createFileComposerStore, resolveDashboardStateRoot } from '../composer/store.ts';
import { registerApprovalsRoutes } from '../approvals/routes.ts';
import { drainVibeProcesses } from '../vibe/session.ts';
import { activeVibeProcessCount } from '../vibe/session.ts';
import { drainAsyncGit } from '../write/asyncGit.ts';
import { activeAsyncGitCount } from '../write/asyncGit.ts';
import { createFileControlPlaneStore, createPythonScheduleClaimRenderer } from '../control/store.ts';
import { projectAttemptSessions } from '../control/runProjection.ts';
import { loadP2MigrationEvidence } from '../control/p2MigrationEvidence.ts';
import type { FileControlPlaneAccess } from '../control/writerLease.ts';
import { createFileDefinitionAmendmentStore } from '../workflows/amendmentStore.ts';
import { readScopeForSubject, registerControlRoutes } from '../control/routes.ts';
import { registerPaidActionRoute } from '../control/paidActionRoute.ts';
import { buildActivatedExecution, createExecutionLatch } from '../control/activation.ts';
import { createQueueBridge, dispatchClaimedCard } from '../control/queueBridge.ts';
import { publishAttemptIoSignal } from '../hub/bus.ts';
import { createSessionRunStore } from '../pty/sessionRuns.ts';
import { createRawSessionReplaySource } from '../pty/replayReader.ts';
import { createSessionPersistence, createTranscriptRetention } from '../pty/sessionPersistence.ts';
import { createWindowsSessionHost } from '../pty/windowsSessionHost.ts';
import { LinuxBrokerClient } from '../pty/linuxBrokerClient.ts';
import { createSessionRecordRegistry } from '../pty/sessionRecord.ts';
import type { DeploymentSessionCloser } from '../pty/sessionRecord.ts';
import type { SessionHost } from '../pty/contracts.ts';
import { migratePtySessionStateRoot } from '../pty/sessionMigration.ts';
import { RunControlTransactions } from '../control/runTransactions.ts';
import { DEFAULT_MANAGER_START_ACK_TIMEOUT_MS } from '../control/execution.ts';
import { assertFleetRunnable, defaultPreambleRunner } from '../write/preambleGate.ts';
import type { PreambleRunner } from '../write/preambleGate.ts';
import { quiescence } from '../release/quiescence.ts';
import { serviceCgroupChildCount } from '../release/serviceCgroup.ts';
import { defaultGitRunner, defaultPrOpener, prepareCoordination } from '../write/branch.ts';
import { DEFAULT_OUTBOX_ROOT, resolveCoordinationPublication } from '../write/outbox.ts';
import { admit } from '../control/admission.ts';
import { outboxStatus } from '../write/outboxStatus.ts';
import { composeRuntimeCapabilities, runtimeCapabilities } from '../runtime/capabilities.ts';
import { resolveSessionRoot } from '../trace/routes.ts';
import { createReconciliationPublisher, createReconciliationRealPorts } from '../reconciliation/realPorts.ts';

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

export type SurfaceContextOverrides = Partial<SurfaceContext> & {
  fileControlAccess?: FileControlPlaneAccess;
};

const QUEUE_BRIDGE_INTERVAL_MS = 15_000;

/** Stable, detail-free refusal for manual Terminal PTY opens at the host boundary. */
export const PTY_OPEN_FLEET_FROZEN = 'pty open refused: fleet-frozen';


/**
 * Put the fleet preamble on the platform {@link SessionHost} itself, not only on one HTTP route. The
 * browser route may deliberately check twice; the second check closes the gap for every registry caller
 * that reaches `SessionHost.create` without traversing that route (the Run-scoped attempt path included).
 * Construction stays inert: no preamble runs and no child spawns until `create` is actually invoked.
 *
 * A frozen fleet is a typed refusal, never a throw: `create` is the one host method that returns a
 * `HostLaunch` synchronously, so refusing it means handing back an already-refused receipt plus a
 * settled `abandoned` exit — the registry's normal failure path — instead of an exception the WebSocket
 * route would have to catch. The detail is the fixed {@link PTY_OPEN_FLEET_FROZEN} string: preamble
 * stdout/stderr can name environment or credential problems, and none of it may reach a browser frame,
 * an audit row, or a close reason.
 *
 * Only `create` is gated. `attach`/`write`/`resize`/`close`/`drain` act on sessions that already exist,
 * and a freeze must never strand a live child or block reaping one.
 */
function fleetGatedSessionHost(host: SessionHost, repoRoot: string, runPreamble: PreambleRunner): SessionHost {
  const fleetRunnable = (): boolean => {
    try {
      return assertFleetRunnable(repoRoot, runPreamble).ok;
    } catch {
      return false;
    }
  };
  return {
    probe: () => host.probe(),
    create(request, sink) {
      if (fleetRunnable()) return host.create(request, sink);
      return {
        receipt: Promise.resolve({ ok: false, refusal: 'unavailable', detail: PTY_OPEN_FLEET_FROZEN }),
        exit: Promise.resolve({
          sessionId: '',
          sequence: 0,
          exitCode: null,
          signal: null,
          reason: 'abandoned',
          observedAt: new Date().toISOString(),
        }),
      };
    },
    attach: (sessionId, sink) => host.attach(sessionId, sink),
    write: (sessionId, data) => host.write(sessionId, data),
    resize: (sessionId, size) => host.resize(sessionId, size),
    close: (sessionId) => host.close(sessionId),
    listEpoch: () => host.listEpoch(),
    drain: (epochId) => host.drain(epochId),
  };
}

/** Build a full {@link SurfaceContext}, filling every field not supplied in `overrides` with its real
 *  default. `sessionConfig`'s secret is resolved exactly once (see module doc). */
export function makeSurfaceContext(
  overrides: SurfaceContextOverrides = {},
  activation: SurfaceActivationSeam = {},
): SurfaceContext {
  // The auth-mode seam, resolved ONCE here with the same env source the activation gate reads. In
  // `tailnet` mode the operator authenticator rides on `sessionConfig` — the one object every
  // `requireSession` call site already receives — so the mode reaches all of them without a route edit.
  const authMode = resolveAuthMode(activation.env);
  const tailnet = authMode === 'tailnet' ? resolveTailnetConfig(activation.env) : null;
  const sessionConfig = overrides.sessionConfig ?? {
    secret: resolveSessionSecret(),
    ttlMs: resolveSessionTtlMs(),
    ...(tailnet ? { operatorAuth: createTailnetOperatorAuth(tailnet) } : {}),
  };
  const repoRoot = overrides.repoRoot ?? resolveRepoRoot();
  const coordinationPublication = overrides.coordinationPublication
    ?? resolveCoordinationPublication(activation.env as NodeJS.ProcessEnv | undefined);
  const openPr = overrides.openPr ?? defaultPrOpener;
  const traceRoot = overrides.traceRoot === undefined
    ? resolveSessionRoot(activation.env as NodeJS.ProcessEnv | undefined)
    : overrides.traceRoot;
  const outboxRoot = overrides.outboxRoot ?? DEFAULT_OUTBOX_ROOT;
  const stateRoot = overrides.stateRoot ?? resolveDashboardStateRoot();
  const controlStore = overrides.controlStore ?? (overrides.fileControlAccess
      ? createFileControlPlaneStore(stateRoot, overrides.fileControlAccess, {
        p2MigrationContext: loadP2MigrationEvidence(repoRoot),
        renderScheduleClaim: createPythonScheduleClaimRenderer(repoRoot),
      })
    : (() => { throw new Error('makeSurfaceContext requires controlStore or fileControlAccess'); })());
  // Wave-A executor activation (env-gated, default OFF). When any of the three executor fields is already
  // supplied as an override (tests, or a future explicit injection), activation is skipped entirely so no
  // construction is attempted. Otherwise `buildActivatedExecution` returns `null` unless the gate is on —
  // meaning production, gate absent, constructs no attempt port/engine and spawns no `claude` (the core inert
  // invariant): the executor fields below stay `undefined` exactly as today.
  const activationOverridden = overrides.attemptPort !== undefined
    || overrides.runAutomatic !== undefined
    || overrides.cancelAutomatic !== undefined
    || overrides.containManagerStart !== undefined
    || overrides.verifyCanonicalResult !== undefined;
  const build = activation.build ?? buildActivatedExecution;
  const buildQueueBridge = activation.createQueueBridge ?? createQueueBridge;
  const dispatchQueueCard = activation.dispatchClaimedCard ?? dispatchClaimedCard;
  const capabilities = composeRuntimeCapabilities(
    overrides.runtimeCapabilities ?? runtimeCapabilities(),
    { coordinationPublication, openPr, transcriptRoot: traceRoot },
  );
  // W6.4 - the ONE PTY host for `/api/pty`, composed here and nowhere else: Windows drives `node-pty`
  // in-process, Linux speaks the socket-activated broker protocol as an unprivileged client. The fleet
  // preamble wraps it, so every `create` — browser terminal or Run-scoped attempt — passes the gate.
  // Construction spawns nothing, connects to nothing, and runs no preamble; only `create` does.
  const ptyHostKind: 'desktop' | 'vm' = process.platform === 'win32' ? 'desktop' : 'vm';
  const underlyingPtySessionHost: SessionHost | undefined = capabilities.pty
    ? (overrides.ptySessionHost
      ?? (ptyHostKind === 'desktop'
        ? createWindowsSessionHost({
          epochId: randomUUID(),
          roots: { repo: repoRoot, worktrees: resolvePath(stateRoot, 'worktrees') },
        })
        // `epoch-`/`req-` + 32 hex, NOT a UUID: `brokerProtocol.ts` decodes these ids against those
        // exact patterns, so a UUID here is refused by the broker at `hello` and every session on the
        // VM fails. It never showed because Linux always probed `pty:false` and this branch was dead.
        : new LinuxBrokerClient({
          connect: async () => connectSocket(BROKER_SOCKET_PATH),
          dashboardEpochId: `epoch-${randomBytes(16).toString('hex')}`,
          makeRequestId: () => `req-${randomBytes(16).toString('hex')}`,
          onDisconnect: ({ cause, error, lastErrorFrame }) => {
            console.warn(`[pty-broker] disconnected ${JSON.stringify({ cause, error, lastErrorFrame })}`);
          },
          onReconcile: ({ sessionId, error }) => {
            console.warn(`[pty-broker] reconcile failed ${JSON.stringify({ sessionId, error })}`);
          },
        })))
    : undefined;
  const ptySessionHost = underlyingPtySessionHost
    ? fleetGatedSessionHost(underlyingPtySessionHost, repoRoot, overrides.runPreamble ?? defaultPreambleRunner)
    : undefined;
  // Session runs + transcripts (leg 2). Construction is INERT: the store's JSON document is created
  // lazily and the recorder only touches disk once a session is actually taped, so building a context
  // which every server test does, writes nothing. PTY epoch activation is lazy on the first host receipt.
  // ONE v3 PTY document (`kb.pty-sessions/v3`) for the whole daemon: session records, attempt bindings,
  // operation receipts AND the legacy session-run rows share its lock and its revision counter. Building
  // it is inert (the file is opened lazily). A daemon still holding an older PTY document migrates
  // through `sessionMigration`: backup first, ambiguity aborts with the old source authoritative.
  const ptyPersistence = capabilities.pty
    ? (overrides.ptyPersistence ?? createSessionPersistence(stateRoot))
    : undefined;
  // ONE migration, awaited before ANY reader of the real PTY document — never at compose (tests build
  // contexts inertly), only from the boot step `registerWriteSurface` wires below, which runs before the
  // app accepts its first request. Before this, only `ptySessionRuns`'s lazy write-time `migrate` awaited
  // it: the session registry read the SAME document straight off `persistence.read()`/`.mutate()` with no
  // migration wired in at all, so a v2 file on disk failed the registry's first read with a generic
  // `PTY session document is invalid` and the migration never ran (the bug this closure exists to close).
  // A test double supplied through `overrides.ptyPersistence` never names this process's real `stateRoot`,
  // so it is intentionally excluded here — production (and any test using the real, unoverridden
  // persistence) is the only caller for which `stateRoot` and `ptyPersistence` are guaranteed to agree on
  // one file. `existsSync` short-circuits the common case (a fresh daemon that never wrote v1/v2) so boot
  // never fails with "source is missing" on an install that only ever spoke v3.
  let ptyDocumentMigration: Promise<void> | null = null;
  const ensurePtyDocumentMigrated: () => Promise<void> = overrides.ptyPersistence !== undefined
    ? async () => {}
    : () => {
      ptyDocumentMigration ??= (async () => {
        if (!existsSync(resolvePath(stateRoot, 'pty', 'session-runs.json'))) return;
        await migratePtySessionStateRoot(stateRoot);
      })();
      return ptyDocumentMigration;
    };
  const ptySessionRuns = capabilities.pty && ptyPersistence
    ? (overrides.ptySessionRuns
      ?? createSessionRunStore(ptyPersistence, { migrate: ensurePtyDocumentMigrated }))
    : undefined;
  // The ONE v2 session registry. It is the only holder of the cross-controller close port: the closer is
  // handed OUT through `installDeploymentCloser` (Daniel's `close-ptys-and-continue` deployment action)
  // and is deliberately absent from the registry object every route sees.
  let deploymentSessionCloser: DeploymentSessionCloser | null = null;
  const ptySessionRegistry = capabilities.pty && ptySessionHost && ptyPersistence
    ? (overrides.ptySessionRegistry ?? createSessionRecordRegistry({
      host: ptySessionHost,
      // Makes the host explicit at the wiring site rather than inferred.
      hostKind: ptyHostKind,
      persistence: ptyPersistence,
      transcript: createTranscriptRetention(stateRoot),
      // Without these the registry is SILENT in production: a compensating close refusal, a swallowed
      // compensation, and the dropped-early-frames warning all had nowhere to go. Neither carries prompt,
      // recipe or key contents.
      onBackgroundError: (error) => {
        console.warn(`[pty-registry] ${error instanceof Error ? error.message : String(error)}`);
      },
      log: (message) => { console.warn(`[pty-registry] ${message}`); },
      // A Run-controller claim is authorized by the CONTROL plane, not by the PTY document: the
      // registry may only hand a session to a browser whose operator can already read that run, and
      // it CASes against the run version that read returned. An unreadable run resolves to `null`,
      // which the registry turns into `not-found` — the same answer a nonexistent session gets, so a
      // claim can never be used to probe for runs the caller cannot see.
      // The inner read must use the SAME scope the claim route's outer read used (`readScopeForSubject`
      // is a pure function of the subject, so this cannot drift from it): resolving under the default
      // `own-subject` while the route read under `all-subjects` would turn every engine-owned run the
      // operator can legitimately see into a `not-found` claim.
      resolveRunVersion: async (operator: string, runRef: string) => {
        const detail = controlStore.getRun(operator, runRef, readScopeForSubject(operator));
        return detail.ok ? detail.value.run.version : null;
      },
      installDeploymentCloser: (closer) => { deploymentSessionCloser = closer; },
    }))
    : undefined;
  // The typed raw-replay read the Run-scoped replay route serves earlier attempts from ([C-R6]).
  // Composed over the SAME `stateRoot` the registry's `createTranscriptRetention` writes into, and
  // over the SAME record the persistence document holds, so reader and writer can never disagree
  // about where a transcript lives or how much of it survived compaction. Absent with no persistence:
  // there is then no retained window to serve, and the route answers `pty-unavailable` rather than
  // inventing an empty transcript.
  const ptyRawReplay = overrides.ptyRawReplay ?? (ptyPersistence
    ? createRawSessionReplaySource({
      stateRoot,
      extent: (sessionId) => {
        const record = ptyPersistence.read().sessions.find((item) => item.sessionId === sessionId);
        return record === undefined
          ? null
          : { total: record.transcript.lastSequence, bytes: record.transcript.bytes };
      },
    }).read
    : undefined);
  // [C-M4] The Run detail's attempt-session projection. Composed over the SAME registry that owns
  // binding order and the SAME persistence document the records live in, so the order the operator
  // sees, the session the server selects, and the transcript the replay route serves can never come
  // from three different reads of the world.
  const ptyRunAttemptSessions = overrides.ptyRunAttemptSessions ?? (ptySessionRegistry && ptyPersistence
    ? (operator: string, runRef: string) => projectAttemptSessions(
      ptySessionRegistry.byRun(operator, runRef),
      ptyPersistence.read().sessions,
    )
    : undefined);
  const definitionAmendmentStore = overrides.definitionAmendmentStore ?? createFileDefinitionAmendmentStore(stateRoot);
  let offAttemptIo: (() => void) | null = null;
  let stopQueueBridge: (() => void) | undefined;
  let serviceCgroupCache: { checkedAt: number; children: number | null } | undefined;
  // W6.2 (step 1): compose the ONE reconciliation publisher over the real store/ops ports and expose it
  // on the context. It is composed exactly once here and called from NOWHERE yet — step 2 cuts the
  // card/inbox/schedule callers over to it; the four heredocs stay live until then.
  const reconciliationPublisher = overrides.reconciliationPublisher ?? createReconciliationPublisher(
    createReconciliationRealPorts({
      repoRoot,
      store: controlStore,
      stateRoot,
      runPy: overrides.runPy,
      now: overrides.now === undefined ? undefined : () => overrides.now!().toISOString(),
      coordinationPublication,
      outboxRoot,
    }),
  );
  let ctx!: SurfaceContext;
  ctx = {
    runtimeCapabilities: capabilities,
    repoRoot,
    reconciliationPublisher,
    coordinationPublication,
    outboxRoot,
    outboxRecoveryFailure: overrides.outboxRecoveryFailure,
    admission: overrides.admission ?? ((kind) => {
      const status = coordinationPublication === 'outbox'
        ? outboxStatus(outboxRoot)
        : { pending: 0, oldestAgeMs: 0, degraded: false, reasons: [] };
      return admit(kind, ctx.outboxRecoveryFailure
        ? {
          ...status,
          degraded: true,
          reasons: [...status.reasons, 'outbox-recovery-failed'],
        }
        : status);
    }),
    stateRoot,
    traceRoot,
    readiness: overrides.readiness ?? (async () => {
      const activation = ctx.executionLatch?.snapshot();
      const recoveryBlockers = ctx.outboxRecoveryFailure ? ['outbox-recovery-failed'] : [];
      const candidateNow = (ctx.now ?? (() => new Date()))().getTime();
      const checkedAt = Number.isFinite(candidateNow) ? candidateNow : Date.now();
      if (!serviceCgroupCache || checkedAt < serviceCgroupCache.checkedAt || checkedAt - serviceCgroupCache.checkedAt >= 1_000) {
        try {
          serviceCgroupCache = { checkedAt, children: serviceCgroupChildCount() };
        } catch {
          serviceCgroupCache = { checkedAt, children: null };
        }
      }
      if (serviceCgroupCache.children === null) {
        return {
          ok: true,
          quiescent: false,
          blockers: [...recoveryBlockers, 'service-cgroup-unknown'],
        };
      }
      // Live PTYs come from the platform host's own epoch listing — the only thing that knows what
      // children this daemon epoch still owns. An unreadable/refusing host counts as one live session:
      // quiescence must never be claimed off a count we could not take (same rule as the cgroup probe).
      let activePty = 0;
      if (ctx.ptySessionHost) {
        try {
          const listed = await ctx.ptySessionHost.listEpoch();
          activePty = listed.ok ? listed.value.sessionIds.length : 1;
        } catch {
          activePty = 1;
        }
      }
      const result = quiescence({
        executionState: activation?.state ?? 'locked',
        bridgeStopped: ctx.stopQueueBridge === undefined,
        queuedWork: 0,
        // The latch does not expose a worker count. Until the deferred coordinator
        // supplies one, an unlocked latch is conservatively treated as active;
        // locked/locking state already prevents readiness through executionState.
        activeWorkers: activation?.state === 'unlocked' ? 1 : 0,
        activeGit: activeAsyncGitCount(),
        activePty,
        activeComposer: activeVibeProcessCount(),
        serviceCgroupChildren: serviceCgroupCache.children,
      });
      return recoveryBlockers.length === 0
        ? result
        : { ...result, quiescent: false, blockers: [...new Set([...result.blockers, ...recoveryBlockers])] };
    }),
    hubBus: overrides.hubBus,
    definitionAmendmentStore,
    durableRepoRoot: overrides.durableRepoRoot ?? overrides.repoRoot ?? resolveDurableRepoRoot(),
    sessionConfig,
    authMode: overrides.authMode ?? authMode,
    // P5 W6.1 [P5-C30]: the ONE shared activation reader. Constructed exactly once here and threaded
    // through the context to Home, Health, and the Inbox deploy-ready gate. `index.test.ts` asserts a
    // single construction; deleting the `createHomeRoutePorts` default (home/routes.ts:73) makes a
    // second impossible.
    activationReader: overrides.activationReader ?? createActivationReader(),
    allowedOrigins: overrides.allowedOrigins ?? resolveAllowedOrigins(activation.env),
    rateGuard: overrides.rateGuard ?? makeDefaultWriteRateGuard(),
    readRateGuard: overrides.readRateGuard ?? makeDefaultReadRateGuard(),
    // P6 W6.1 [P6-C33]: the v1 NODE scope's OWN rate-guard pair, built beside the operator pair and never
    // shared. Always present so the node sibling scope can mount whenever node identity is configured.
    nodeRateGuard: overrides.nodeRateGuard ?? makeNodeRateGuard(),
    nodeReadRateGuard: overrides.nodeReadRateGuard ?? makeNodeReadRateGuard(),
    // Node identity + the injectable v1 ports. Absent leaves the whole v1 surface unregistered
    // (fail-closed); production binds these to the attested node uid, the root-owned map, and the
    // extracted W2 services + placement store adapters.
    nodeProxyUid: overrides.nodeProxyUid,
    loadHostNodeMap: overrides.loadHostNodeMap,
    v1: overrides.v1,
    // Lazy: resolveWebAuthnConfig throws when DASHBOARD_RP_ORIGIN is unset — only called inside a handler
    // (which the origin guard has already blocked when the allowlist is empty), never at registration.
    webAuthnConfig: overrides.webAuthnConfig ?? (() => resolveWebAuthnConfig()),
    credentials: overrides.credentials ?? (() => resolveCredentials()),
    appendAudit: overrides.appendAudit,
    appendAuditLocal: overrides.appendAuditLocal,
    opsGit: overrides.opsGit,
    saveGit: overrides.saveGit,
    openPr,
    runPy: overrides.runPy,
    runPreamble: overrides.runPreamble,
    activateManagedRoots: overrides.activateManagedRoots,
    spawn: overrides.spawn,
    vibeRateGuard: overrides.vibeRateGuard,
    now: overrides.now,
    // One issued-session allowlist for the whole process (review F1) — resumes only ids captured this
    // lifetime. Tests override with a fresh instance so ids never leak between them.
    composerStore:
      overrides.composerStore ??
      createFileComposerStore(stateRoot, {
        protector: createProviderIdProtector(sessionConfig.secret),
      }),
    controlStore,
    ptySessionHost,
    ptySessionRegistry,
    ptyRawReplay,
    ptyRunAttemptSessions,
    closeDeploymentPtySessions: async (sessionIds) =>
      deploymentSessionCloser === null
        ? { ok: false, refusal: 'unavailable', detail: 'no session host' }
        : deploymentSessionCloser(sessionIds),
    ptyPersistence,
    // One ref table per process, reading the v3 document so a ref already spent as a session controller
    // can never be re-minted for a second browser.
    browserSessionRefs: overrides.browserSessionRefs
      ?? createBrowserSessionRefStore(ptyPersistence ? { persistence: ptyPersistence } : {}),
    ptySessionRuns,
    // The `registerWriteSurface` boot hook awaits this before the app accepts its first request, so the
    // registry's raw `persistence.read()`/`.mutate()` calls and the run store's write-time migrate always
    // see an already-migrated (or already-v3) document. Absent without PTY persistence.
    ensurePtyDocumentMigrated: ptyPersistence ? ensurePtyDocumentMigrated : undefined,
    // Executor fields start UNBOUND: with the latch locked (the boot posture) nothing is constructed, so
    // every control route observes exactly the pre-activation refusals. The latch below rebinds them in
    // place on unlock and clears them on lock.
    attemptPort: overrides.attemptPort,
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
    runnerState: overrides.runnerState,
    runnerProcessStartTime: overrides.runnerProcessStartTime,
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
      buildOptions: {
        controlStore, repoRoot, stateRoot,
        // The attempt port is built from the SAME probed host and v3 document the browser PTY routes
        // use, so a Run attempt and a Terminal session are the same kind of record on the same host.
        sessionHost: ptySessionHost, attemptBindings: ptySessionRegistry,
        // The ONE reconciliation publisher composed above, threaded to the canonical result integrator so
        // its coordination phase publishes serial `card-transition` intents (P4 §3.4) rather than running
        // its own cards.py mutation + git commit/push.
        reconciliationPublisher,
        // The executor owns two coordination git writers of its own (the canonical integrator's prepare
        // phase and the post-run fleet-ledger settlement); both publish in THIS context's mode.
        coordinationPublication,
        outboxRoot,
      },
      onChange: (execution, state, serviceCaller) => {
        stopQueueBridge?.();
        stopQueueBridge = undefined;
        ctx.stopQueueBridge = undefined;
        offAttemptIo?.();
        offAttemptIo = null;
        ctx.attemptPort = execution?.attemptPort ?? undefined;
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
        // The queue bridge runs for a deliberately ARMED daemon: a passkey unlock (an operator just
        // asked for it) or `tailnet` mode (armed at boot by deployment posture). `env-override` is
        // excluded on purpose — it is the headless/testing arm and must stay inert.
        if (execution && (state.source === 'passkey' || state.source === 'tailnet') && serviceCaller) {
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
                resolveScheduleReceiptOwner: (cardId) => ctx.controlStore.resolveScheduleReceiptOwner(cardId),
                bindScheduleOccurrenceRun: (cardId, runRef) => ctx.controlStore.bindScheduleOccurrenceRun(cardId, runRef),
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
export function registerWriteSurface(app: FastifyInstance, ctx: SurfaceContext): void {
  // File-only: no PTY host is probed or contacted here, only the on-disk document. Runs before the app
  // starts listening, so it happens-before every route this function (and `registerV1NodeRoutes`, and the
  // sibling `/api/pty` scope in `index.ts`) registers — no request can reach a PTY route while this is
  // still in flight. See `ensurePtyDocumentMigrated`'s doc comment in `context.ts` for why this exists.
  app.addHook('onReady', async () => {
    try {
      await ctx.ensurePtyDocumentMigrated?.();
    } catch (error) {
      // Degrade, never brick: per the invariant in runtime/capabilities.ts (~100-103), a daemon
      // that cannot resolve its terminal stack comes up without a terminal, it does not fail to
      // come up. A migration failure here must leave boot to finish; the registry's own read-time
      // handling is what degrades any route that subsequently touches the unmigrated document.
      console.error('[pty-registry] PTY document migration failed', error instanceof Error ? error.message : String(error));
    }
  });
  app.addHook('onReady', async () => {
    if (ctx.coordinationPublication !== 'outbox') return;
    try {
      await prepareCoordination(
        ctx.repoRoot,
        ctx.opsGit ?? defaultGitRunner,
        ctx.coordinationPublication,
        ctx.outboxRoot,
      );
      ctx.outboxRecoveryFailure = undefined;
    } catch (error) {
      // Degrade, never brick: repair/export tooling requires a listening daemon and /readyz blocker.
      ctx.outboxRecoveryFailure = error instanceof Error ? error.message : String(error);
      console.error('outbox recovery failed; entering degraded mode', error);
    }
  });
  // preClose runs before Fastify waits for long-lived streaming requests to finish. Draining in
  // onClose would deadlock shutdown behind the very Composer children it was meant to stop.
  app.addHook('preClose', async () => {
    ctx.stopQueueBridge?.();
    ctx.stopQueueBridge = undefined;
    // Shutdown is a fail-safe direction: a drain that throws synchronously, rejects, or returns
    // nothing at all must not block Fastify from closing.
    try { await ctx.attemptPort?.drain(); } catch { /* best effort */ }
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

    // Session-minting ceremonies stay public (but origin/rate guarded). Every other route in this
    // surface inherits this scope-level session gate, so a future GET cannot accidentally ship public.
    registerAuthRoutes(scope, ctx);
    // Session-less by design: its own preHandler resolves the durable spend grant.
    registerPaidActionRoute(scope, ctx);
    scope.register(async (authenticated) => {
      authenticated.addHook('preHandler', requireSession(ctx.sessionConfig));
      // The controller-cookie endpoint lives INSIDE the session gate, not beside the public ceremonies:
      // its authorization is "Origin + operator" (route matrix), and in tailnet mode the operator gate is
      // the only proof that exists — no assertion is ever verified there, so the WebAuthn mint path never
      // runs and this is the sole way the always-on deployment gets a `kb_browser_session` ref at all.
      registerBrowserSessionRoute(authenticated, ctx);
      registerWriteRoutes(authenticated, ctx);
      registerControlRoutes(authenticated, ctx);
      registerApprovalsRoutes(authenticated, ctx);
      // P6 W6.1 [P6-C20]: v1 operator MUTATIONS join the operator authenticated scope — they SHOULD spend
      // the operator write budget and prove the session. The scope's operatorRouteOnlyGuard refuses the
      // node-proxy uid `403 operator-route-only`.
      registerV1Routes(authenticated, ctx, 'operator-mutations');
    });
  });
  // P6 W6.1 [P6-C20, P6-C33, P6-C46]: the four node routes as a SIBLING scope of the operator write scope,
  // both children of `app`. Registered on `app` — NOT nested inside the operator scope — precisely so the
  // operator rate hook above is never inherited by node traffic; the node scope installs its OWN
  // origin+rate hooks and requireNodeIdentity in place of requireSession. Mounts nothing when node identity
  // is unconfigured (fail-closed).
  registerV1NodeRoutes(app, ctx);
}
