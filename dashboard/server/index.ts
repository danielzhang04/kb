import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { kbBrowserRoutes } from './kb/routes.ts';
import { registerPlaneA } from './planeA/routes.ts';
import { registerRoutingRead } from './routing/routes.ts';
import { registerAgents } from './agents/routes.ts';
import { readDeclaredAgentDetails } from './agents/roster.ts';
import {
  registerInboxRoutes, createInboxRoutePorts,
  registerInboxActionRoutes, createInboxActionPorts,
} from './inbox/routes.ts';
import type { SubprocessPort } from './inbox/resolvers.ts';
import { registerHealthRoutes } from './health/routes.ts';
import { createHomeRoutePorts, registerHomeRoutes, createActivationReader } from './home/routes.ts';
import { registerTraceRead } from './trace/routes.ts';
import { registerBrainSearch } from './brain/routes.ts';
import { registerHub } from './hub/index.ts';
import { createBus, wireControlStoreTick } from './hub/bus.ts';
import { registerWriteSurface, makeSurfaceContext } from './http/surface.ts';
import { requireSession, surfaceRateLimitHook } from './http/middleware.ts';
import { registerWorkflows } from './workflows/routes.ts';
import { registerV1Routes } from './api/v1/routes.ts';
import { forwardDesktopReadProxy } from './placement/desktopReadProxy.ts';
import type { DesktopClient } from './placement/desktopClient.ts';
import { ScheduleService, registerScheduleRoutes } from './schedules/service.ts';
import { resolveScheduleOwner } from './schedules/owners.ts';
import { registerStatic } from './static/routes.ts';
import { registerPtyRoute, makePtyRouteContext } from './pty/route.ts';
import { createRawSessionReplayReader } from './pty/replayReader.ts';
import { originPlugin } from './security/origin.ts';
import { assertAuthModeBoot } from './auth/mode.ts';
import { installShutdownHandlers } from './shutdown.ts';
import { startHumanRequestSweeper } from './control/humanRequestSweep.ts';
import type { HumanRequestSweepResult } from './control/humanRequestSweep.ts';
import { createImplementerBatchRegistry, startMergePollTimer } from './learnings/execution.ts';
import { createLearningRecordRetire } from './reconciliation/realPorts.ts';
import type { MergedPrStatus, PrMergeReader } from './reconciliation/mergePoll.ts';
import { resolveRepositoryPin, RepositoryPinError } from './runtime/repoPin.ts';
import { defaultGitRunner, resolveBaseCommit } from './write/branch.ts';
import { runTrackedProcess } from './write/asyncGit.ts';
import { isCommitSha } from './write/durableManifest.ts';
import { assertSupportedRepositoryData } from './schema/startup.ts';
import type { SurfaceContext } from './http/context.ts';
import {
  probePublicPtyCapability, runtimeCapabilities, unavailablePtyCapability, type RuntimeCapabilities,
} from './runtime/capabilities.ts';
import type { PublicPtyCapability } from './pty/contracts.ts';
import type { VibeSpawner } from './vibe/session.ts';
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

/** Human Request orphan-sweep cadence — ON BY DEFAULT: it only ever mutates the control-plane JSON
 *  document it already owns, so there is no filesystem move or git commit to gate behind a dry-run.
 *  Default interval 5 minutes. */
export const DEFAULT_HUMAN_REQUEST_SWEEP_INTERVAL_MS = 300_000;

/** Merge-poll cadence — the read-only `reconciliation/mergePoll.ts` PR resolver. Default 60 s, matching
 *  the §3.3 background PR poll; the poll spawns no `gh` while its batch sources are empty. */
export const DEFAULT_MERGE_POLL_INTERVAL_MS = 60_000;

export function resolveMergePollIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.DASHBOARD_MERGE_POLL_INTERVAL_MS;
  if (raw === undefined || raw === '') return DEFAULT_MERGE_POLL_INTERVAL_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : DEFAULT_MERGE_POLL_INTERVAL_MS;
}
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
  /** The platform PTY host, injected UNGATED: `makeSurfaceContext` wraps it in the fleet-preamble gate
   *  exactly as it wraps the real one, so a fixture exercises the production gate rather than bypassing it. */
  ptySessionHost?: SurfaceContext['ptySessionHost'];
  /** The browser-session ref table, injected so a fixture can mint two independent browser identities
   *  against the same daemon without touching the real v2 document. */
  browserSessionRefs?: SurfaceContext['browserSessionRefs'];
  controlStore?: ControlPlaneStore;
  fileControlAccess?: FileControlPlaneAccess;
  /** Test seam only: the `/api/inbox` `gh pr list` subprocess port, so a fixture reaches no real `gh`. */
  inboxGh?: SubprocessPort;
  /**
   * P6 W6.3 [P6-C34]: the daemon composition mode. `'vm'` (default) is the full surface. `'desktop'` is an
   * EXPLICIT, minimal route inventory — a CLIENT of the VM's node routes, never a server of them: it
   * registers `/healthz`, `/readyz`, the read scope's own agent/workflow/health projections over local
   * state, and `placement/desktopReadProxy.ts`, and NOTHING else. It registers none of the four node
   * routes, no human-response route, and no VM-store write path (no write surface, no control routes, no
   * schedule mutations). A test enumerates the registered routes and deep-equals this inventory.
   */
  mode?: DaemonMode;
  /** P6 W6.3 [P6-C53]: the Desktop read proxy's client to the VM origin. Injected in tests; production
   *  binds it to the pinned `/api/v1` VM origin. When absent in Desktop mode the two proxy routes still
   *  register (the inventory is stable) but answer `503` until a client is configured. */
  desktopReadProxyClient?: DesktopClient;
}

export type DaemonMode = 'vm' | 'desktop';

/** One `{method, url}` per registered route, collected via an `onRoute` hook so a test can enumerate the
 *  exact route inventory of a built app (Desktop mode deep-equals a frozen list [P6-C34]). */
export interface RegisteredRoute { readonly method: string; readonly url: string; }
const REGISTERED_ROUTES = new WeakMap<FastifyInstance, RegisteredRoute[]>();
export function registeredRoutesOf(app: FastifyInstance): readonly RegisteredRoute[] {
  return REGISTERED_ROUTES.get(app) ?? [];
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
  // P6 W6.3 [P6-C34]: capture every registered route (both modes) so a test can enumerate the exact
  // inventory. An `onRoute` hook at the root fires for routes in child scopes too.
  const collectedRoutes: RegisteredRoute[] = [];
  REGISTERED_ROUTES.set(app, collectedRoutes);
  app.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) collectedRoutes.push({ method: String(method), url: route.url });
  });
  const mode: DaemonMode = options.mode ?? 'vm';
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
    ...(options.ptySessionHost ? { ptySessionHost: options.ptySessionHost } : {}),
    ...(options.browserSessionRefs ? { browserSessionRefs: options.browserSessionRefs } : {}),
    controlStore: options.controlStore,
    fileControlAccess: options.fileControlAccess,
  });

  app.get('/healthz', async () => {
    return { ok: true };
  });

  // P6 W6.3 [P6-C34, P6-C53]: Desktop mode is an EXPLICIT, minimal inventory and returns here — it never
  // reaches the VM write surface, node routes, human-response route, or schedule mutations below.
  if (mode === 'desktop') {
    composeDesktopMode(app, surfaceCtx, options);
    return app;
  }

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
      // ignore - best-effort teardown
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
    registerRoutingRead(scope, repoRoot);
    registerAgents(scope, surfaceCtx);
    const schedules = createScheduleService(repoRoot, surfaceCtx.controlStore);
    registerScheduleRoutes(scope, schedules);
    // P5 W6.1 [P5-C30]: ONE shared activation reader (constructed in `makeSurfaceContext`) passed to the
    // Inbox deploy-ready gate, Home, and Health so all three read one installed release, never a checkout.
    const activationReader = surfaceCtx.activationReader ?? createActivationReader();
    registerInboxRoutes(scope, surfaceCtx, createInboxRoutePorts(surfaceCtx, {
      ...(options.inboxGh ? { runGh: options.inboxGh } : {}), activation: activationReader,
    }));
    registerInboxActionRoutes(scope, surfaceCtx, createInboxActionPorts(surfaceCtx, { activation: activationReader }));
    registerHomeRoutes(scope, createHomeRoutePorts(surfaceCtx, schedules, activationReader, options.inboxGh));
    registerHealthRoutes(scope, surfaceCtx);
    if (surfaceCtx.runtimeCapabilities.localTranscripts && surfaceCtx.traceRoot) {
      registerTraceRead(scope, surfaceCtx.traceRoot);
    }
    registerBrainSearch(scope, { repoRoot });
    registerWorkflows(scope, surfaceCtx);
    // P6 W6.1 [P6-C20]: v1 READS join the existing read scope, under the same originPlugin +
    // surfaceRateLimitHook + requireSession this scope already applies. The operatorRouteOnlyGuard inside
    // refuses the node-proxy uid `403 operator-route-only` — proven on the shared `/api/v1/runs/**` prefix.
    registerV1Routes(scope, surfaceCtx, 'reads');
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
    // ONE session registry over ONE fleet-gated platform host for the whole daemon, both composed in
    // `makeSurfaceContext` and resolved off the surface context. Manual Terminal sessions persist across
    // browser reconnects without coupling them to worker execution. The route is a pure consumer of the
    // registry port: it never constructs a host, so it cannot fabricate a raw, ungated one. Without a
    // registry (no persistence, no host) nothing is registered at all — the capability is already
    // published as closed, and a half-wired PTY surface is worse than none.
    if (surfaceCtx.ptySessionRegistry && surfaceCtx.ptyPersistence) {
      const ptyCtx = makePtyRouteContext({
        repoRoot,
        sessionConfig: surfaceCtx.sessionConfig,
        allowedOrigins: surfaceCtx.allowedOrigins,
        registry: surfaceCtx.ptySessionRegistry,
        persistence: surfaceCtx.ptyPersistence,
        rateLimitHook: surfaceRateLimitHook(surfaceCtx.readRateGuard, surfaceCtx.rateGuard),
        // Read-only scrollback for a reattach ([C-R6]). Composed over the SAME `stateRoot` the
        // registry's `createTranscriptRetention` writes into, so the reader and the writer can never
        // disagree about where a `.raw` transcript lives. It is a pure read port: it cannot spawn,
        // write, or close anything, which is why it is safe to hand to every attaching principal the
        // registry already authorized.
        replay: createRawSessionReplayReader({
          stateRoot: surfaceCtx.stateRoot,
          // The record is the only honest source of the RETAINED WINDOW: the file says how many bytes
          // survive, the record says how many were ever written, and the difference is the floor a
          // replay must not claim to have served.
          extent: (sessionId) => {
            const record = surfaceCtx.ptyPersistence?.read().sessions
              .find((item) => item.sessionId === sessionId);
            return record === undefined
              ? null
              : { total: record.transcript.lastSequence, bytes: record.transcript.bytes };
          },
        }),
        ...(surfaceCtx.browserSessionRefs ? { browserSessionRefs: surfaceCtx.browserSessionRefs } : {}),
      });
      // `registerPtyRoute` installs this scope's own hooks in the pinned order
      // (origin -> rate limit -> session -> browser principal), so nothing else is added here.
      app.register(async (scope) => {
        await registerPtyRoute(scope, ptyCtx);
      });
    }
  }
  // P4 W6.2: the daemon-side merge-gate reconciler and stranded-card auto-archiver were DELETED here
  // (`write/{mergeGateReconciler,strandedArchiver,ownerActivity}.*`). Merge polling is now the read-only
  // `reconciliation/mergePoll.ts` PR resolver, which mutates ONLY through the one reconciliation publisher
  // (`mirror-merged` intents + the `learning-record-retire` action); card auto-archival by age is retired
  // outright [P4-C14].
  //
  // W6.3 wires that resolver's LIVE startup timer here, feeding it from the open-Implementer-batch registry
  // (`createImplementerBatchRegistry`). The repo pin is resolved once, degrade-safe: a deployment whose
  // `origin` is not a pinnable GitHub repo (the WSL oracle, local dev) simply runs no PR poll instead of
  // crashing boot [P4-C35, and the W6.1c degrade ruling]. The poll never calls `gh` while both the mirror
  // batch and the Implementer registry are empty, so the boot sweep spawns nothing on a fresh daemon.
  const implementerBatchRegistry = createImplementerBatchRegistry();
  let repoPinForPoll: { owner: string; repo: string } | null = null;
  try {
    repoPinForPoll = resolveRepositoryPin(repoRoot);
  } catch (error) {
    if (!(error instanceof RepositoryPinError)) throw error;
    // eslint-disable-next-line no-console
    console.info(`merge-poll timer disabled: ${error.message}`);
  }
  if (repoPinForPoll !== null) {
    const pollNow = (): string => (surfaceCtx.now ?? (() => new Date()))().toISOString();
    const retire = createLearningRecordRetire({
      repoRoot: surfaceCtx.repoRoot,
      store: surfaceCtx.controlStore,
      stateRoot: surfaceCtx.stateRoot,
      now: pollNow,
      coordinationPublication: surfaceCtx.coordinationPublication,
      outboxRoot: surfaceCtx.outboxRoot,
    });
    // A read-only single-PR merge reader over ambient `gh`. Any non-zero exit, timeout, or parse fault is
    // UNKNOWN (`null`) — the resolver then leaves the PR alone, exactly the safe direction the old gate took.
    const ghMergeReader: PrMergeReader = async (pr): Promise<MergedPrStatus | null> => {
      try {
        const stdout = await runTrackedProcess(
          'gh',
          ['pr', 'view', String(pr.number), '--repo', `${pr.owner}/${pr.repo}`, '--json', 'state,mergeCommit,mergedAt'],
          surfaceCtx.repoRoot,
          'pr view',
          { timeoutMs: 15_000 },
        );
        const parsed = JSON.parse(stdout) as { state?: unknown; mergeCommit?: unknown; mergedAt?: unknown };
        const merged = parsed.state === 'MERGED';
        const oid = (parsed.mergeCommit as { oid?: unknown } | null)?.oid;
        const mergeCommit = typeof oid === 'string' && isCommitSha(oid) ? oid : null;
        const mergedAt = typeof parsed.mergedAt === 'string' ? parsed.mergedAt : null;
        return { merged: merged && mergeCommit !== null, mergeCommit, mergedAt };
      } catch {
        return null;
      }
    };
    const stopMergePoll = startMergePollTimer(
      {
        repoPin: repoPinForPoll,
        gh: ghMergeReader,
        readOpenMirrorBatch: () => surfaceCtx.controlStore.readOpenScheduleMirrorBatch(),
        readOpenImplementerBatches: async () => implementerBatchRegistry.list(),
        readSourceRevision: () => resolveBaseCommit(surfaceCtx.repoRoot, defaultGitRunner),
        readStoreRevision: () => String(surfaceCtx.controlStore.getControlDocumentMetadata().documentRevision),
        publish: surfaceCtx.reconciliationPublisher,
        retire,
        // The Inbox PR projection is refreshed by its own resolver; a dedicated invalidation port is not
        // exposed to this scope, so a merged PR simply leaves the open list on the next scheduled refresh.
        invalidatePr: () => {},
        now: pollNow,
      },
      {
        intervalMs: resolveMergePollIntervalMs(),
        // On a confirmed retire the batch is done: drop it so the next poll does not re-resolve it.
        onPoll: (outcome) => { for (const batchId of outcome.recordsRetired) implementerBatchRegistry.forget(batchId); },
        onError: (error) => { console.error('merge poll tick failed', error); },
      },
    );
    app.addHook('onClose', async () => { stopMergePoll(); });
  }

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
 * The frozen Desktop-mode route inventory [P6-C34]. `index.test.ts` deep-equals `registeredRoutesOf(app)`
 * against this, so a future `register*` added to `buildApp` fails Desktop mode rather than silently
 * appearing there. Every entry is a READ or a public liveness probe; the two `/api/v1/runs/:runRef/{events,
 * gates}` rows are the read proxy's [P6-C53], and there is NO node route, NO human-response route, and NO
 * write path anywhere in it.
 */
export const DESKTOP_ROUTE_INVENTORY: readonly RegisteredRoute[] = [
  { method: 'GET', url: '/healthz' },
  { method: 'GET', url: '/readyz' },
  { method: 'GET', url: '/api/runtime/capabilities' },
  { method: 'GET', url: '/api/agents' },
  { method: 'GET', url: '/api/workflows' },
  { method: 'GET', url: '/api/health' },
  { method: 'GET', url: '/api/v1/runs/:runRef/events' },
  { method: 'GET', url: '/api/v1/runs/:runRef/gates' },
];

/**
 * Compose the Desktop-mode surface: `/readyz`, then one read scope (origin + rate + session) carrying the
 * agent/workflow/health projections over LOCAL state, and — the ONE addition [P6-C53] — the read-only
 * `placement/desktopReadProxy.ts` mount that forwards exactly `GET /api/v1/runs/:runRef/{events,gates}` to
 * the VM. It registers no write route: a Desktop-local respond call therefore has no route to resolve a VM
 * gate, which `index.test.ts` asserts directly.
 */
function composeDesktopMode(app: FastifyInstance, ctx: SurfaceContext, options: BuildAppOptions): void {
  app.get('/readyz', async () => await ctx.readiness());
  const proxyClient = options.desktopReadProxyClient;
  app.register(async (scope) => {
    originPlugin(scope, { allowedOrigins: ctx.allowedOrigins });
    scope.addHook('onRequest', surfaceRateLimitHook(ctx.readRateGuard, ctx.rateGuard));
    scope.addHook('preHandler', requireSession(ctx.sessionConfig));
    // Agent/workflow/health projections over LOCAL state — reads only, no builder write path.
    scope.get('/api/runtime/capabilities', async () => ctx.runtimeCapabilities);
    scope.get('/api/agents', async () => ({ agents: [] as unknown[] }));
    scope.get('/api/workflows', async () => ({ workflows: [] as unknown[] }));
    registerHealthRoutes(scope, ctx);
    // The read proxy [P6-C53]: forward exactly GET events/gates to the VM; every other method/path — a
    // human-response POST included — is refused BY OMISSION (the allowlist in desktopReadProxy.ts).
    for (const suffix of ['events', 'gates'] as const) {
      scope.get(`/api/v1/runs/:runRef/${suffix}`, async (req, reply) => {
        if (proxyClient === undefined) {
          reply.code(503).send({ apiVersion: 'v1', error: { code: 'vm-origin-unconfigured', message: 'no VM read-proxy client configured', retryable: true }, meta: {} });
          return;
        }
        const runRef = (req.params as { runRef: string }).runRef;
        const forwarded = await forwardDesktopReadProxy(proxyClient, 'GET', `/api/v1/runs/${runRef}/${suffix}`);
        reply.code(forwarded.status);
        for (const [key, value] of Object.entries(forwarded.headers)) reply.header(key, value);
        reply.send(forwarded.body);
      });
    }
  });
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
  /** @internal The one composition-time PTY probe; production runs the real host probe. */
  probePtyCapability?: typeof probePublicPtyCapability;
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
    // The one and only PTY probe of this process: composition asks the real host once, before any
    // route/registry/store exists. A refusal is published as the closed `pty:false` capability, and
    // every PTY construction below is gated on it — an unavailable host builds nothing at all. A
    // probe that throws is also just a refusal: boot must not die because the terminal stack cannot
    // be resolved, so the daemon comes up with no terminal instead of not coming up.
    let ptyCapability: PublicPtyCapability;
    try {
      ptyCapability = await (options.probePtyCapability ?? probePublicPtyCapability)({
        epochId: randomUUID(),
      });
    } catch {
      ptyCapability = unavailablePtyCapability(process.platform, new Date().toISOString());
    }
    const app = buildApplication({
      repoRoot,
      validateData: true,
      runtimeCapabilities: runtimeCapabilities(process.platform, ptyCapability),
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
