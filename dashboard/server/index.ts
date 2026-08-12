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
import { registerPtyRoute, makePtyRouteContext } from './pty/route.ts';
import { registerSessionRunRoutes } from './pty/sessionRunRoutes.ts';
import { originPlugin } from './security/origin.ts';
import { installShutdownHandlers } from './shutdown.ts';
import { startMergeGateReconciler } from './write/mergeGateReconciler.ts';
import { startStrandedArchiver } from './write/strandedArchiver.ts';
import { startHumanRequestSweeper } from './control/humanRequestSweep.ts';
import type { HumanRequestSweepResult } from './control/humanRequestSweep.ts';

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
  // ONE surface context per process: its `sessionConfig` (HMAC secret) is resolved exactly once here and
  // SHARED with the PTY route below. Without this, the write surface and the PTY route each called
  // `resolveSessionSecret()` independently; with `DASHBOARD_SESSION_SECRET` unset that yields two DIFFERENT
  // random secrets, so a token minted at login (write-surface secret) can never verify at /api/pty (its own
  // secret) → every PTY open failed `verifySession` with `bad-signature`. One secret keeps mint == verify.
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
  // D3.1 temporary in-process PTY bridge (/api/pty), in its OWN origin-guarded child scope (mirrors
  // registerHub). NOT folded into the write surface: its per-request rate-limit hook is HTTP-request shaped
  // and fits a long-lived WS upgrade poorly. The route runs the fleet preamble BEFORE session validation,
  // enforces the max-concurrent cap, and writes exactly one audit row per allowed-origin attempt. Its child
  // env is credential-filtered, but the shell currently runs as the dashboard daemon's OS user; the retired
  // cross-user host/Factor-C path is a future hardening milestone, not an active control.
  {
    // ONE pty host + session registry for the whole daemon, resolved on the surface context. Manual
    // Terminal sessions persist across browser reconnects without coupling them to worker execution.
    // N4 (fail-closed host, 2026-08-03): the host is passed UNCONDITIONALLY. `makeSurfaceContext` always
    // builds the fleet-gated host, so `surfaceCtx.ptyHost` is present in production; if it were ever absent,
    // `makePtyRouteContext` THROWS (no ungated fallback) and the daemon refuses to start — the old
    // conditional spread would instead have let the route fabricate a raw, ungated shell host.
    const ptyCtx = makePtyRouteContext({
      sessionConfig: surfaceCtx.sessionConfig,
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
