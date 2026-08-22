import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { kbBrowserRoutes } from './kb/routes.ts';
import { registerPlaneA } from './planeA/routes.ts';
import { registerDag } from './dag/routes.ts';
import { registerRoutingRead } from './routing/routes.ts';
import { registerAgents } from './agents/routes.ts';
import { readDeclaredAgentDetails } from './agents/roster.ts';
import { registerInboxRoutes } from './inbox/routes.ts';
import { registerHealthRoutes } from './health/routes.ts';
import { registerTraceRead } from './trace/routes.ts';
import { registerBrainSearch } from './brain/routes.ts';
import { registerContextLifecycle } from './contextLifecycle/routes.ts';
import { registerLessons } from './lessons/routes.ts';
import { registerHygiene } from './hygiene/routes.ts';
import { registerModelAudit } from './modelAudit/routes.ts';
import { registerHub } from './hub/index.ts';
import { createBus, wireControlStoreTick } from './hub/bus.ts';
import { registerWriteSurface, makeSurfaceContext } from './http/surface.ts';
import { requireSession, surfaceRateLimitHook } from './http/middleware.ts';
import { registerWorkflows } from './workflows/routes.ts';
import { ScheduleService, registerScheduleRoutes } from './schedules/service.ts';
import { resolveScheduleOwner } from './schedules/owners.ts';
import { registerStatic } from './static/routes.ts';
import { registerPtyRoute, makePtyRouteContext } from './pty/route.ts';
import { registerSessionRunRoutes } from './pty/sessionRunRoutes.ts';
import { originPlugin } from './security/origin.ts';
import { assertAuthModeBoot } from './auth/mode.ts';
import { installShutdownHandlers } from './shutdown.ts';
import { startMergeGateReconciler } from './write/mergeGateReconciler.ts';
import { startStrandedArchiver } from './write/strandedArchiver.ts';
import { startHumanRequestSweeper } from './control/humanRequestSweep.ts';
import type { HumanRequestSweepResult } from './control/humanRequestSweep.ts';
import { assertSupportedRepositoryData } from './schema/startup.ts';
import type { SurfaceContext } from './http/context.ts';
import type { RuntimeCapabilities } from './runtime/capabilities.ts';
import type { VibeSpawner } from './vibe/session.ts';
import { createPtyHost } from './pty/host.ts';
import { resolveDashboardStateRoot } from './composer/store.ts';
import { acquireWriterLease } from './control/writerLease.ts';
import type { FileControlPlaneAccess, WriterLease } from './control/writerLease.ts';
import type { ControlPlaneStore } from './control/store.ts';
import { createFileControlPlaneStore, createPythonScheduleClaimRenderer } from './control/store.ts';
import { loadP2MigrationEvidence } from './control/p2MigrationEvidence.ts';
import { runP2ScheduleStartupMigrations } from './control/migrations.ts';
import {
  migratePausedCadenceMarkersToScheduleArmedV1,
  readDevelopmentScheduleSeedSource,
} from './schedules/seedImport.ts';
import { createScheduleSocketServer, scheduleSocketRuntimeCapability } from './schedules/socketRoutes.ts';
import { discoverLegacyScheduleMarkers, publishVerifiedScheduleMarkerRemoval } from './write/branch.ts';

/** Loopback-only bind. Network location is never a trust boundary (ordering law 4). */
export const HOST = '127.0.0.1';
export const PORT = Number(process.env.DASHBOARD_PORT ?? 4317);

/** G1 merge-gate reconciler cadence (Decision 2): default 5 minutes; a value <= 0 (or non-numeric)
 *  disables it. On-by-default is fail-safe — every reconciler failure leaves gate cards OPEN, so the
 *  only thing disabling it removes is the auto-close of already-merged PRs. */
export const DEFAULT_MERGE_GATE_INTERVAL_MS = 300_000;
export function resolveMergeGateIntervalMs(): number {
  const raw = process.env.DASHBOARD_MERGE_GATE_INTERVAL_MS;
  if (raw === undefined || raw === '') return DEFAULT_MERGE_GATE_INTERVAL_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : DEFAULT_MERGE_GATE_INTERVAL_MS;
}

/** Stranded-archiver cadence — DEFAULT-OFF (0 = disabled). Unlike the merge-gate reconciler this daemon
 *  MOVES cards, so on-by-default is NOT fail-safe here: the v1 build defaulted ON at 5-min intervals and
 *  would have wrongly archived live cards. It ships disabled and is opt-in via env.
 *  POLICY RATIFIED (Daniel, 2026-07-22, all 8 §3d questions): 7-day window; archived cards stay MOVED
 *  (never deleted, `queue/archived/` retained indefinitely, reversible archived→inbox only); unattended
 *  MOVE is authorized — but only AFTER the rollout gate below; daemon default stays off; the Human-Inbox
 *  `stranded` surface stays until dry-run proves correct, then is removed; the four ownerActivity sources
 *  are approved as-is; schtasks liveness stays codex-only and veto-only. */
export const DEFAULT_STRANDED_ARCHIVE_INTERVAL_MS = 0;
export function resolveStrandedArchiveIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.DASHBOARD_STRANDED_ARCHIVE_INTERVAL_MS;
  if (raw === undefined || raw === '') return DEFAULT_STRANDED_ARCHIVE_INTERVAL_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : DEFAULT_STRANDED_ARCHIVE_INTERVAL_MS;
}

/** Compile-time policy flag guarding the LIVE MOVE path. Even with this true, a live MOVE ALSO requires
 *  the env gate below — two independent locks. While it is `false` the archiver is dry-run-only
 *  regardless of env.
 *  ROLLOUT GATE (ratified 2026-07-22, policy Q3+Q4): flip this to `true` in a reviewed PR ONLY after the
 *  dry-run cadence (enable via DASHBOARD_STRANDED_ARCHIVE_INTERVAL_MS) has produced 7 consecutive daily
 *  cycles with ZERO wrong would-archive picks; Daniel then also sets DASHBOARD_STRANDED_ARCHIVE_LIVE=1
 *  on the daemon. Until both, dry-run-only. */
export const STRANDED_ARCHIVE_LIVE_MOVE_ALLOWED = false;
/** dryRun is TRUE (report only, move nothing) unless BOTH the compile-time flag is flipped AND the operator
 *  sets `DASHBOARD_STRANDED_ARCHIVE_LIVE=1`. This ship: always dry-run. */
export function resolveStrandedArchiveDryRun(env: NodeJS.ProcessEnv = process.env): boolean {
  const envLive = env.DASHBOARD_STRANDED_ARCHIVE_LIVE === '1';
  return !(STRANDED_ARCHIVE_LIVE_MOVE_ALLOWED && envLive);
}

/** Abandonment window — default 7 days (policy Q1), overridable via env for dry-run experimentation. */
export const DEFAULT_STRANDED_ARCHIVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export function resolveStrandedArchiveWindowMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.DASHBOARD_STRANDED_ARCHIVE_WINDOW_MS;
  if (raw === undefined || raw === '') return DEFAULT_STRANDED_ARCHIVE_WINDOW_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_STRANDED_ARCHIVE_WINDOW_MS;
}

/** Human Request orphan-sweep cadence — ON BY DEFAULT (unlike the stranded-card archiver above, this
 *  only ever mutates the control-plane JSON document it already owns; there is no filesystem move or
 *  git commit to gate behind a dry-run). 5 minutes, matching the merge-gate reconciler's cadence. */
export const DEFAULT_HUMAN_REQUEST_SWEEP_INTERVAL_MS = 300_000;
export function resolveHumanRequestSweepIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.DASHBOARD_HUMAN_REQUEST_SWEEP_INTERVAL_MS;
  if (raw === undefined || raw === '') return DEFAULT_HUMAN_REQUEST_SWEEP_INTERVAL_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : DEFAULT_HUMAN_REQUEST_SWEEP_INTERVAL_MS;
}

/**
 * One daemon-log line for a sweep that actually closed something, or `null` for the overwhelmingly
 * common empty sweep (a 5-minute cadence must never narrate its own no-ops). Says WHAT closed and WHY,
 * because the reason is the only thing that distinguishes a correct close from a bug, and flags any
 * request whose audit row could not be written so a short trail is never silent.
 */
export function humanRequestSweepLogLine(result: HumanRequestSweepResult): string | null {
  if (result.closed.length === 0) return null;
  const closed = result.closed
    .map((request) => `${request.requestRef} (run ${request.runRef}: ${request.reason ?? 'no reason recorded'})`)
    .join('; ');
  const audit = result.auditFailures.length > 0
    ? ` — AUDIT ROW FAILED for ${result.auditFailures.join(', ')}`
    : '';
  return `[human-request-sweep] auto-closed ${result.closed.length}: ${closed}${audit}`;
}

/**
 * Build the Fastify backend. Only `/healthz`, static assets, and the four session-minting auth
 * ceremonies and loopback-only `/readyz` stay public.
 * Every other matched data route — repository/state reads, hub streams, PTY,
 * and writes — is in an Origin/Host- + rate-limit-guarded scope with a session pre-handler. It is
 * fail-closed by default: with no `DASHBOARD_RP_ORIGIN` the origin allowlist is empty and every governed
 * route 403s; with an RP origin but no provisioned passkey, no session can be minted and every governed
 * route 401s.
 */
export interface BuildAppOptions {
  repoRoot?: string;
  validateData?: boolean;
  readiness?: SurfaceContext['readiness'];
  allowedOrigins?: SurfaceContext['allowedOrigins'];
  sessionConfig?: SurfaceContext['sessionConfig'];
  runtimeCapabilities?: RuntimeCapabilities;
  coordinationPublication?: SurfaceContext['coordinationPublication'];
  openPr?: SurfaceContext['openPr'];
  traceRoot?: string | null;
  spawn?: VibeSpawner;
  createPtyHost?: typeof createPtyHost;
  controlStore?: ControlPlaneStore;
  fileControlAccess?: FileControlPlaneAccess;
}

function createScheduleService(repoRoot: string, store: ControlPlaneStore): ScheduleService {
  return new ScheduleService({
    store,
    resolveOwner: async (selector) => resolveScheduleOwner(repoRoot, selector),
    seedAuthorization: async (scheduleId) => store.isScheduleSeedAuthorized(scheduleId),
    mirrorPathForOwner: (owner) => {
      if (owner.type === 'workflow') return `orgs/${owner.project}/HEARTBEAT.md`;
      const declaration = readDeclaredAgentDetails(repoRoot).get(owner.id);
      if (!declaration || declaration.group === 'system') return 'HEARTBEAT.md';
      const primaryProject = [...declaration.projects].sort()[0];
      return primaryProject ? `orgs/${primaryProject}/HEARTBEAT.md` : 'HEARTBEAT.md';
    },
  });
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const repoRoot = options.repoRoot ?? process.env.DASHBOARD_REPO_ROOT ?? fileURLToPath(new URL('../../', import.meta.url));
  if (options.validateData !== false) assertSupportedRepositoryData(repoRoot);
  const app = Fastify({ logger: false });
  const bus = createBus();
  const surfaceCtx = makeSurfaceContext({
    hubBus: bus,
    repoRoot,
    readiness: options.readiness,
    allowedOrigins: options.allowedOrigins,
    sessionConfig: options.sessionConfig,
    runtimeCapabilities: options.runtimeCapabilities,
    coordinationPublication: options.coordinationPublication,
    openPr: options.openPr,
    traceRoot: options.traceRoot,
    spawn: options.spawn,
    controlStore: options.controlStore,
    fileControlAccess: options.fileControlAccess,
  }, { createPtyHost: options.createPtyHost });

  app.get('/healthz', async () => {
    return { ok: true };
  });

  registerHub(app, { repoRoot, bus, allowedOrigins: surfaceCtx.allowedOrigins, sessionConfig: surfaceCtx.sessionConfig });
  // ONE surface context per process: its `sessionConfig` (HMAC secret) is resolved exactly once here and
  // SHARED with the PTY route below. Without this, the write surface and the PTY route each called
  // `resolveSessionSecret()` independently; with `DASHBOARD_SESSION_SECRET` unset that yields two DIFFERENT
  // random secrets, so a token minted at login (write-surface secret) can never verify at /api/pty (its own
  // secret) → every PTY open failed `verifySession` with `bad-signature`. One secret keeps mint == verify.
  const controlStoreWatcher = wireControlStoreTick(bus, surfaceCtx.stateRoot);
  app.addHook('onClose', async () => {
    try {
      const watcher = await controlStoreWatcher;
      await watcher.close();
    } catch {
      // ignore â€” best-effort teardown
    }
  });
  // Loopback-only readiness for repair/export tooling. It is registered OUTSIDE the origin-guarded scope
  // on purpose: export_tier0.py and backup_tier0.py call it with curl, apply_ops_reconciliation.py and
  // activate_release.py with urllib, all sending Host: 127.0.0.1:<port> and no Origin. That Host matches
  // NO allowlisted origin in either auth mode (win32's RP origin or tailnet's serve host), so inside the
  // guard all four would 403; keeping /readyz outside it is what lets loopback tooling reach it. The DoS
  // amplification S2 raised is closed by the 1s serviceCgroupChildCount memoization, not by this hook. Do
  // NOT attach the read-rate hook either: the restore drill polls every 0.25s (240 req/min) against a
  // 300/min budget with a 60s lockout — far too close to the edge.
  app.get('/readyz', async () => await surfaceCtx.readiness());
  app.register(async (scope) => {
    originPlugin(scope, { allowedOrigins: surfaceCtx.allowedOrigins });
    scope.addHook('onRequest', surfaceRateLimitHook(surfaceCtx.readRateGuard, surfaceCtx.rateGuard));
    scope.addHook('preHandler', requireSession(surfaceCtx.sessionConfig));
    scope.get('/api/runtime/capabilities', async () => surfaceCtx.runtimeCapabilities);
    scope.register(kbBrowserRoutes, { repoRoot });
    registerPlaneA(scope, repoRoot);
    registerDag(scope, repoRoot);
    registerRoutingRead(scope, repoRoot);
    registerAgents(scope, surfaceCtx);
    const schedules = createScheduleService(repoRoot, surfaceCtx.controlStore);
    registerScheduleRoutes(scope, schedules);
    registerInboxRoutes(scope, surfaceCtx);
    registerHealthRoutes(scope, surfaceCtx);
    if (surfaceCtx.runtimeCapabilities.localTranscripts && surfaceCtx.traceRoot) {
      registerTraceRead(scope, surfaceCtx.traceRoot);
    }
    registerBrainSearch(scope, { repoRoot });
    registerContextLifecycle(scope);
    registerLessons(scope, repoRoot);
    registerHygiene(scope, repoRoot);
    registerModelAudit(scope);
    registerWorkflows(scope, surfaceCtx);
  });
  registerWriteSurface(app, surfaceCtx); // U2: governed write surface (origin -> rate-limit -> session -> gate -> audit)
  // D15: workflow-definition registry (GET /api/workflows[/:id] read-only) + the governed one-step launch
  // (POST /api/workflows/:id/launch) in its OWN origin/rate-limit/session child scope. Shares surfaceCtx
  // so the launch route mints/verifies against the same session secret as the write surface.
  // D3.1 temporary in-process PTY bridge (/api/pty), in its OWN origin-guarded child scope (mirrors
  // registerHub). NOT folded into the write surface: its per-request rate-limit hook is HTTP-request shaped
  // and fits a long-lived WS upgrade poorly. The route runs the fleet preamble BEFORE session validation,
  // enforces the max-concurrent cap, and writes exactly one audit row per allowed-origin attempt. Its child
  // env is credential-filtered, but the shell currently runs as the dashboard daemon's OS user; the retired
  // cross-user host/Factor-C path is a future hardening milestone, not an active control.
  if (surfaceCtx.runtimeCapabilities.pty) {
    // ONE pty host + session registry for the whole daemon, resolved on the surface context. Manual
    // Terminal sessions persist across browser reconnects without coupling them to worker execution.
    // N4 (fail-closed host, 2026-08-03): the host is passed UNCONDITIONALLY. `makeSurfaceContext` always
    // builds the fleet-gated host, so `surfaceCtx.ptyHost` is present in production; if it were ever absent,
    // `makePtyRouteContext` THROWS (no ungated fallback) and the daemon refuses to start — the old
    // conditional spread would instead have let the route fabricate a raw, ungated shell host.
    const ptyCtx = makePtyRouteContext({
      sessionConfig: surfaceCtx.sessionConfig,
      allowedOrigins: surfaceCtx.allowedOrigins,
      ptyHost: surfaceCtx.ptyHost,
      ...(surfaceCtx.ptySessions ? { registry: surfaceCtx.ptySessions } : {}),
      // Leg 2: the daemon records the entity-primed sessions it spawns (agent / workflow), and tapes
      // their output. Both are owned by the surface context so there is exactly one of each per process.
      ...(surfaceCtx.ptySessionRuns ? { sessionRuns: surfaceCtx.ptySessionRuns } : {}),
      ...(surfaceCtx.ptyTranscripts ? { transcripts: surfaceCtx.ptyTranscripts } : {}),
    });
    app.register(async (scope) => {
      await registerPtyRoute(scope, ptyCtx);
      // The session-run REST surface sits BESIDE /api/pty inside the same origin-guarded scope, and is
      // registered here rather than from the pty route so neither module has to import the other. Its
      // registration also runs the boot sweep that corrects any `live` record left by the last process.
      if (surfaceCtx.ptySessionRuns) {
        await registerSessionRunRoutes(scope, {
          repoRoot: ptyCtx.repoRoot,
          sessionConfig: ptyCtx.sessionConfig,
          sessionRuns: surfaceCtx.ptySessionRuns,
          ...(surfaceCtx.ptyTranscripts ? { transcripts: surfaceCtx.ptyTranscripts } : {}),
        });
      }
      originPlugin(scope, { allowedOrigins: ptyCtx.allowedOrigins ?? [] });
    });
  }
  // G1 — daemon-side merge-gate reconciler (inbox-gates). Wired here but only ticks AFTER Daniel's
  // deliberate daemon restart (nothing in this wave restarts the live daemon). It reads the canonical ops
  // worktree, asks gh (ambient auth) whether each open `approve:merge:<pr>` gate's PR is merged/closed,
  // and closes the gate through the SAME governed transaction path as the card-respond route. The runner
  // fields fall back to their real defaults in production; every failure leaves the gate OPEN. The interval
  // is unref'd, so it never keeps the process alive; its stop fn is registered on shutdown.
  const stopMergeGateReconciler = startMergeGateReconciler(
    {
      repoRoot: surfaceCtx.repoRoot,
      opsGit: surfaceCtx.opsGit,
      runPy: surfaceCtx.runPy,
      appendAuditLocal: surfaceCtx.appendAuditLocal,
      now: surfaceCtx.now,
    },
    resolveMergeGateIntervalMs(),
  );
  app.addHook('onClose', async () => { stopMergeGateReconciler(); });

  // Stranded-card auto-archiver v2 (redesign 2026-07-21) — DEFAULT-OFF and DRY-RUN-ONLY. It reads the
  // canonical ops worktree and, for each card owned by a REAL agent that is idle in inbox/working past the
  // window with BOTH the card AND its owner showing no activity (the corrected liveness model; a missing
  // schtasks task is NOT abandonment), decides what it WOULD archive. Two independent locks keep it inert:
  // the interval defaults to 0 (disabled — the timer never schedules), and even when enabled `dryRun`
  // stays TRUE (reports, moves nothing) until the compile-time STRANDED_ARCHIVE_LIVE_MOVE_ALLOWED flag AND
  // an operator env gate are BOTH set — pending Daniel's policy answers. The live MOVE path reuses the same
  // governed transaction as the reconciler; every failure leaves the card untouched. Unref'd; stop on close.
  const stopStrandedArchiver = startStrandedArchiver(
    {
      repoRoot: surfaceCtx.repoRoot,
      opsGit: surfaceCtx.opsGit,
      runPy: surfaceCtx.runPy,
      appendAuditLocal: surfaceCtx.appendAuditLocal,
      schtasksRun: surfaceCtx.schtasksRun,
      runnerState: surfaceCtx.runnerState,
      runnerProcessStartTime: surfaceCtx.runnerProcessStartTime,
      livenessCache: surfaceCtx.livenessCache,
      platform: surfaceCtx.runtimeCapabilities.platform,
      now: surfaceCtx.now,
      dryRun: resolveStrandedArchiveDryRun(),
      windowMs: resolveStrandedArchiveWindowMs(),
      // Dry-run report sink: one structured line per card the sweep WOULD archive, to the daemon log.
      logDryRun: (d) => {
        // eslint-disable-next-line no-console
        console.info(`[stranded-archiver dry-run] WOULD archive ${d.cardId} (owner ${d.owner}, card-idle ${Math.round((d.cardIdleMs ?? 0) / 3.6e6)}h, owner-idle ${Math.round((d.ownerIdleMs ?? 0) / 3.6e6)}h; ${d.liveness})`);
      },
    },
    resolveStrandedArchiveIntervalMs(),
  );
  app.addHook('onClose', async () => { stopStrandedArchiver(); });

  // Human Request orphan sweeper — ON BY DEFAULT. Runs once immediately (the boot sweep — clears any
  // request left open on a run that had already gone terminal before this process started, which is how
  // stale 2026-07 requests were found still open on 2026-08-11: nothing had ever re-checked them) and
  // then on the interval. Terminal run state is its ONLY predicate. Every failure just leaves requests
  // open — the pre-fix status quo — so there is no unsafe direction for this to fail toward. Each close
  // writes one line to the daemon log saying what and why, plus one audit-ledger row COMMITTED to `ops`
  // through `appendAudit` — deliberately not the bare local appender the merge-gate reconciler and
  // stranded archiver use above (each of those stages the ledger inside its own card-mutation commit;
  // this sweep has no card commit to ride on, and an uncommitted local row would leave the shared
  // checkout dirty and abort every later coordination write). See humanRequestSweep.ts's header.
  const stopHumanRequestSweeper = startHumanRequestSweeper(
    {
      store: surfaceCtx.controlStore,
      repoRoot: surfaceCtx.repoRoot,
      appendAudit: surfaceCtx.appendAudit,
      now: surfaceCtx.now,
      onSweep: (result) => {
        const line = humanRequestSweepLogLine(result);
        // eslint-disable-next-line no-console
        if (line) console.info(line);
      },
    },
    resolveHumanRequestSweepIntervalMs(),
  );
  app.addHook('onClose', async () => { stopHumanRequestSweeper(); });

  // Always-on: serve the built SPA (dist/) with an SPA fallback, if it exists; API-only otherwise.
  // Registered last — every /api/* route above and the hub's /events + /ws already claim their exact
  // paths, so this can never shadow them (see static/routes.ts for the precedence argument).
  registerStatic(app);

  return app;
}

/**
 * Start the daemon on the loopback interface.
 *
 * The auth mode's boot invariants are asserted BEFORE anything is built or bound, so a misconfigured
 * `tailnet` daemon refuses to run rather than serving ambient-auth routes on the wrong interface or the
 * wrong platform. Failing here surfaces as a non-zero exit and a systemd restart loop — loud, and the
 * safe direction.
 */
export interface StartOptions {
  repoRoot?: string;
  /** @internal */
  leaseFactory?: typeof acquireWriterLease;
  /** @internal */
  buildApplication?: typeof buildApp;
}

/** Production Schedule boot unit, exported so crash/restart tests exercise the exact startup path. */
export async function runScheduleBootMigrations(
  repoRoot: string,
  controlStore: ControlPlaneStore,
  publishRemoval: (marker: string, digest: string) => Promise<void> =
    (marker, digest) => publishVerifiedScheduleMarkerRemoval(repoRoot, marker, digest),
): Promise<void> {
  await runP2ScheduleStartupMigrations({
    existingMarker: controlStore.getScheduleSeedImportMarker(),
    development: await readDevelopmentScheduleSeedSource(repoRoot),
    commitSeeds: (plan) => controlStore.commitScheduleSeedImport(plan),
    convertPauseMarkers: async () => {
      const discovered = await discoverLegacyScheduleMarkers(repoRoot, await controlStore.readScheduleSnapshot());
      const incomplete = await controlStore.listIncompleteSchedulePauseMarkerReceipts?.() ?? [];
      const markers = [...new Map([...discovered, ...incomplete].map((marker) => [marker.marker, {
        marker: marker.marker, scheduleId: marker.scheduleId, digest: marker.digest,
      }])).values()];
      return migratePausedCadenceMarkersToScheduleArmedV1({
        markers,
        store: controlStore,
        receipts: {
          read: (marker) => controlStore.readSchedulePauseMarkerReceipt(marker),
          write: (receipt) => controlStore.writeSchedulePauseMarkerReceipt(receipt),
        },
        publishRemoval,
      });
    },
  });
}

export async function start(
  port: number = PORT,
  host: string = HOST,
  options: StartOptions = {},
): Promise<FastifyInstance> {
  assertAuthModeBoot({ bindHost: host });
  const leaseFactory = options.leaseFactory ?? acquireWriterLease;
  const buildApplication = options.buildApplication ?? buildApp;
  let lease: WriterLease | null = leaseFactory({
    stateRoot: resolveDashboardStateRoot(),
    bootId: randomUUID(),
  });
  try {
    const repoRoot = options.repoRoot ?? fileURLToPath(new URL('../../', import.meta.url));
    let controlStore: ControlPlaneStore | undefined;
    if (!options.buildApplication) {
      controlStore = createFileControlPlaneStore(lease.stateRoot, { mode: 'already-locked', lease }, {
        p2MigrationContext: loadP2MigrationEvidence(repoRoot),
        renderScheduleClaim: createPythonScheduleClaimRenderer(repoRoot),
      });
      await runScheduleBootMigrations(repoRoot, controlStore);
    }
    const app = buildApplication({
      repoRoot,
      validateData: true,
      ...(controlStore
        ? { controlStore }
        : { fileControlAccess: { mode: 'already-locked' as const, lease } }),
    });
    if (controlStore && scheduleSocketRuntimeCapability().available) {
      const uid = process.getuid?.();
      if (uid === undefined) throw new Error('schedule dispatcher uid is unavailable');
      const scheduleService = createScheduleService(repoRoot, controlStore);
      const socket = createScheduleSocketServer({
        socketPath: '/run/kb-dashboard/schedules.sock',
        store: {
          ...controlStore,
          readScheduleSnapshot: () => scheduleService.list(),
          claimScheduleOccurrence: (input) => scheduleService.claimScheduleOccurrence(input),
        },
        dispatcherUid: uid,
      });
      app.addHook('onClose', async () => { await new Promise<void>((done) => socket.close(() => done())); });
    }
    app.addHook('onClose', async () => {
      lease?.release();
      lease = null;
    });
    try {
      await app.listen({ port, host });
    } catch (error) {
      try { await app.close(); } catch {}
      throw error;
    }
    return app;
  } catch (error) {
    lease?.release();
    lease = null;
    throw error;
  }
}

// Run directly: `node server/index.ts` (native TS via Node 24) / `npm run dev:server`.
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  start()
    .then((app) => {
      installShutdownHandlers(app);
      // eslint-disable-next-line no-console
      console.log(`kb dashboard daemon listening on http://${HOST}:${PORT}`);
    })
    .catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error(err);
      process.exit(1);
    });
}
