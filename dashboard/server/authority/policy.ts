/**
 * The single source of truth for which mutating routes a CLI may call unaided; see
 * docs/superpowers/specs/2026-09-16-authority-and-guardrails-design.md §4.1.
 */

export type AuthorityClass = 'open' | 'signed' | 'none';

export interface RouteAuthority {
  readonly path: string;
  readonly method: 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  readonly cls: AuthorityClass;
  readonly entityParam: string | null;
  readonly entityFromBody?: (body: Record<string, unknown>) => string | null;
  readonly escalate?: 'workflow-tag';
}

export function routeKey(entry: Pick<RouteAuthority, 'method' | 'path'>): string {
  return `${entry.method} ${entry.path}`;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

const open = (method: RouteAuthority['method'], path: string): RouteAuthority =>
  ({ method, path, cls: 'open', entityParam: null });

export const ROUTE_AUTHORITY: readonly RouteAuthority[] = Object.freeze([
  // ── open: the CLI's ordinary working set ───────────────────────────────────
  open('POST', '/api/workflows/:id/launch'),
  open('POST', '/api/write/launch'),
  open('POST', '/api/write/rerun'),
  open('POST', '/api/v1/runs'),
  open('POST', '/api/control/proposals/:proposalRef/revisions/:revision/launch'),
  { method: 'POST', path: '/api/control/human-requests/:requestRef/respond', cls: 'open', entityParam: 'requestRef', escalate: 'workflow-tag' },
  { method: 'POST', path: '/api/control/iteration-gates/:requestRef/resolve', cls: 'open', entityParam: 'requestRef', escalate: 'workflow-tag' },
  { method: 'POST', path: '/api/v1/runs/:runRef/human-requests/:requestRef/respond', cls: 'open', entityParam: 'requestRef', escalate: 'workflow-tag' },
  open('POST', '/api/control/runs/:runRef/manager/stop'),
  open('POST', '/api/control/runs/:runRef/manager/steer'),
  open('POST', '/api/control/runs/:runRef/manager/messages'),
  open('POST', '/api/control/runs/:runRef/manager/successor'),
  open('POST', '/api/control/runs/:runRef/agents/:agentId/messages'),
  open('POST', '/api/control/runs/:runRef/activate'),
  open('POST', '/api/control/runs/:runRef/stages/:stageRef/reroute'),
  // D1 (adversarial review of claude/c2-cadence-gates, 2026-09-23 boss ruling): `force: true`
  // force-resolves every open human request for the run — including ones a fail-closed/tagged run
  // would otherwise require a signed approval to answer — so it carries the SAME `escalate:
  // 'workflow-tag'` semantics as the two iteration-gate/human-request routes above. The generic
  // `requireAuthority` preHandler still treats `cls: 'open'` as a pass-through for every call (it has
  // no run or `force` flag to inspect); the route itself (`routes.ts`, the archive handler) reads this
  // field's intent and, ONLY when `force === true`, verifies the run's workflow tags and a signed
  // approval bound to this exact route + `runRef` before touching anything. A non-force archive is
  // completely unaffected.
  { method: 'POST', path: '/api/control/runs/:runRef/archive', cls: 'open', entityParam: 'runRef', escalate: 'workflow-tag' },
  open('POST', '/api/write/stop'),
  open('POST', '/api/schedules'),
  open('POST', '/api/schedules/:id/arm'),
  open('POST', '/api/schedules/:id/disarm'),
  open('POST', '/api/v1/schedules'),
  open('POST', '/api/control/execution/lock'),
  open('POST', '/api/control/execution/unlock'),
  open('POST', '/api/write/save'),
  open('POST', '/api/write/routing-override'),
  open('POST', '/api/write/card-routing'),
  open('POST', '/api/write/card-respond'),
  open('POST', '/api/write/workflow-runs'),
  open('POST', '/api/agents'),
  open('PUT', '/api/agents/:id'),
  open('POST', '/api/agents/:id/launch'),
  open('POST', '/api/workflows'),
  open('PUT', '/api/workflows/:id'),
  open('POST', '/api/v1/agents'),
  open('PUT', '/api/v1/agents/:id'),
  open('POST', '/api/v1/workflows'),
  open('PUT', '/api/v1/workflows/:id'),
  // v1 mirrors of the open schedule-arming routes above; spec §4.1's table names only the non-v1 pair
  // explicitly, but the live app registers both — see the completeness test's report for T1.
  open('POST', '/api/v1/schedules/:id/arm'),
  open('POST', '/api/v1/schedules/:id/disarm'),
  open('POST', '/api/control/proposals/import'),
  open('POST', '/api/control/proposals/:proposalRef/revisions'),
  open('POST', '/api/control/proposals/:proposalRef/revisions/:revision/decision'),
  open('POST', '/api/control/runs/:runRef/pty-sessions/:sessionId/controller'),
  open('DELETE', '/api/pty/sessions/:sessionId'),
  open('POST', '/api/auth/browser-session'),
  open('POST', '/api/approvals/verify'),
  open('POST', '/api/control/retention/dry-run'),

  // ── signed: the "never for a CLI" list ─────────────────────────────────────
  { method: 'POST', path: '/api/control/budget/override', cls: 'signed', entityParam: null, entityFromBody: (body) => str(body.windowDay) },
  { method: 'POST', path: '/api/control/runs/:runRef/reconcile-publication', cls: 'signed', entityParam: 'runRef' },
  { method: 'DELETE', path: '/api/schedules/:id', cls: 'signed', entityParam: 'id' },
  { method: 'DELETE', path: '/api/v1/schedules/:id', cls: 'signed', entityParam: 'id' },
  { method: 'POST', path: '/api/control/retention/quarantine', cls: 'signed', entityParam: null, entityFromBody: (body) => str(body.expectedPlanHash) },
  { method: 'POST', path: '/api/control/retention/restore', cls: 'signed', entityParam: null, entityFromBody: (body) => str(body.runRef) },
  { method: 'POST', path: '/api/inbox/deployment/:ref/deploy', cls: 'signed', entityParam: 'ref' },
  { method: 'POST', path: '/api/inbox/deployment/:ref/confirm', cls: 'signed', entityParam: 'ref' },
  { method: 'POST', path: '/api/inbox/deployment/:ref/abort', cls: 'signed', entityParam: 'ref' },
  { method: 'POST', path: '/api/inbox/deployment/:ref/acknowledge', cls: 'signed', entityParam: 'ref' },
  { method: 'POST', path: '/api/inbox/deployment/:ref/close-ptys-and-continue', cls: 'signed', entityParam: 'ref' },
  { method: 'POST', path: '/api/v1/deployments/:ref/acknowledge', cls: 'signed', entityParam: 'ref' },
  // v1 mirrors of the four signed deployment actions above; spec §4.1's table names only the v1
  // `acknowledge` mirror explicitly, but the live app registers all five — see the completeness test's
  // report for T1. Same operation, same `:ref`, so the same class as their non-v1 sibling.
  { method: 'POST', path: '/api/v1/deployments/:ref/deploy', cls: 'signed', entityParam: 'ref' },
  { method: 'POST', path: '/api/v1/deployments/:ref/confirm', cls: 'signed', entityParam: 'ref' },
  { method: 'POST', path: '/api/v1/deployments/:ref/abort', cls: 'signed', entityParam: 'ref' },
  { method: 'POST', path: '/api/v1/deployments/:ref/close-ptys-and-continue', cls: 'signed', entityParam: 'ref' },
  // Not named anywhere in spec §3/§4 — an asset-pull retry/pull action the live app registers (both the
  // `/api/inbox` and `/api/v1` forms) that the design never classified. Per the plan's rule for an
  // unmentioned route, classed conservatively `signed` rather than defaulted `open`; flagged in T1's report.
  { method: 'POST', path: '/api/inbox/asset-pull/:intentRef/pull', cls: 'signed', entityParam: 'intentRef' },
  { method: 'POST', path: '/api/inbox/asset-pull/:intentRef/retry', cls: 'signed', entityParam: 'intentRef' },
  { method: 'POST', path: '/api/v1/asset-pulls/:intentRef/pull', cls: 'signed', entityParam: 'intentRef' },
  { method: 'POST', path: '/api/v1/asset-pulls/:intentRef/retry', cls: 'signed', entityParam: 'intentRef' },
  { method: 'POST', path: '/api/control/recovery/2026-07-31/execution-lock', cls: 'signed', entityParam: null, entityFromBody: () => 'run-2026-07-31-execution-lock' },
  { method: 'POST', path: '/api/control/recovery/2026-08-01/failed-run-reconciliation', cls: 'signed', entityParam: null, entityFromBody: () => 'run-2026-08-01-failed-run' },
]);

/** Path prefixes that must have ZERO registered routes: `none` is an absence, not a refusal. */
export const FORBIDDEN_ROUTE_PREFIXES: readonly string[] = Object.freeze([
  '/api/governance', '/api/credentials', '/api/secrets', '/api/sshd', '/api/ssh', '/api/units', '/api/systemd',
]);

const BY_KEY = new Map(ROUTE_AUTHORITY.map((entry) => [routeKey(entry), entry]));

export function classifyRoute(method: string, path: string): RouteAuthority | null {
  const key = `${String(method).toUpperCase()} ${path}`;
  const entry = BY_KEY.get(key);
  if (entry) return entry;
  return null;
}
