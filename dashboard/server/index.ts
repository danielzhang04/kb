import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { fileURLToPath } from 'node:url';
import { kbBrowserRoutes } from './kb/routes.ts';
import { registerRegistry } from './registry/routes.ts';
import { registerPlaneA } from './planeA/routes.ts';
import { registerDag } from './dag/routes.ts';
import { registerRoutingRead } from './routing/routes.ts';
import { registerAgents } from './agents/routes.ts';
import { registerPanels } from './panels/routes.ts';
import { registerHub } from './hub/index.ts';
import { wireControlStoreTick } from './hub/bus.ts';
import { registerWriteSurface, makeSurfaceContext } from './http/surface.ts';
import { registerWorkflows } from './workflows/routes.ts';
import { registerStatic } from './static/routes.ts';
import { installShutdownHandlers } from './shutdown.ts';
import { startMergeGateReconciler } from './write/mergeGateReconciler.ts';
import { startStrandedArchiver } from './write/strandedArchiver.ts';

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

/**
 * Build the Fastify backend. `/healthz` and the read-only hub/registry/planeA routes stay pre-auth;
 * the governed WRITE surface (auth ceremonies, save/launch/stop, vibe, approvals) is registered by
 * `registerWriteSurface` as its own encapsulated, Origin/Host- + rate-limit-guarded child scope, with
 * each mutating route additionally session-gated (U2). It is fail-closed by default: with no
 * `DASHBOARD_RP_ORIGIN` the origin allowlist is empty and every write route 403s; with an RP origin but
 * no provisioned passkey, no session can be minted and every write route 401s.
 */
export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get('/healthz', async () => {
    // `node` echoes the running runtime version so an accidental unpinned Node
    // upgrade is caught (pinned to 24.18.0 via .nvmrc + package.json engines).
    return { ok: true, node: process.versions.node };
  });

  app.register(kbBrowserRoutes); // D0.5: read-only KB browser (GET-only /api/kb/*)
  registerRegistry(app); // D0.6: read-only registries (GET-only /api/registry/*)
  registerPlaneA(app); // D0.9: read-only Plane-A snapshot for the Control landing (GET /api/index)
  registerDag(app); // D3.4: read-only pipeline DAG projection over depends-on (GET /api/dag)
  registerRoutingRead(app); // R2.1/R2.4: read-only effective-routing projection (GET /api/routing)
  registerAgents(app); // read-only fleet roster (GET /api/agents): queue owners ∪ ledger writers ∪ roles
  registerPanels(app); // D3.5: read-only layer panels (GET /api/panels/health | /api/panels/usage)
  const bus = registerHub(app, { repoRoot: process.env.DASHBOARD_REPO_ROOT }); // D0.4: SSE/WS hub + Origin/Host guard (/events, /ws)
  // ONE surface context per process: its `sessionConfig` (HMAC secret) is resolved exactly once so a token
  // minted by the write surface remains valid for every governed route in this daemon.
  const surfaceCtx = makeSurfaceContext({ hubBus: bus });
  const controlStoreWatcher = wireControlStoreTick(bus, surfaceCtx.stateRoot);
  app.addHook('onClose', async () => {
    try {
      const watcher = await controlStoreWatcher;
      await watcher.close();
    } catch {
      // ignore â€” best-effort teardown
    }
  });
  registerWriteSurface(app, surfaceCtx); // U2: governed write surface (origin -> rate-limit -> session -> gate -> audit)
  // D15: workflow-definition registry (GET /api/workflows[/:id] read-only) + the governed one-step launch
  // (POST /api/workflows/:id/launch) in its OWN origin/rate-limit/session child scope. Shares surfaceCtx
  // so the launch route mints/verifies against the same session secret as the write surface.
  registerWorkflows(app, surfaceCtx);
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
      runnerState: surfaceCtx.runnerState,
      runnerProcessStartTime: surfaceCtx.runnerProcessStartTime,
      livenessCache: surfaceCtx.livenessCache,
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

  // Always-on: serve the built SPA (dist/) with an SPA fallback, if it exists; API-only otherwise.
  // Registered last — every /api/* route above and the hub's /events + /ws already claim their exact
  // paths, so this can never shadow them (see static/routes.ts for the precedence argument).
  registerStatic(app);

  return app;
}

/** Start the daemon on the loopback interface. */
export async function start(port: number = PORT, host: string = HOST): Promise<FastifyInstance> {
  const app = buildApp();
  await app.listen({ port, host });
  return app;
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
