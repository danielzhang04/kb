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
  open('POST', '/api/control/runs/:runRef/archive'),
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

/** Route keys Task 2 deletes with WebAuthn. Excluded from the live completeness check until then. */
export const PENDING_DELETION: readonly string[] = Object.freeze([
  'POST /api/auth/register/options',
  'POST /api/auth/register/verify',
  'POST /api/auth/assert/options',
  'POST /api/auth/assert/verify',
]);

/**
 * T3/T2 sequencing bridge — WebAuthn ceremony BYPRODUCT routes spec §4.1 also names for deletion
 * ("Deleted with WebAuthn: ... `/api/control/human-requests/:requestRef/respond/challenge`,
 * `/api/inbox/deployment/:ref/challenge`, `/api/control/iteration-gates/:requestRef/challenge`"), but
 * that T2 — not T1 — removes, same as `PENDING_DELETION`'s four. They are deliberately absent from
 * `PENDING_DELETION` itself (T2's own deletion step reads that constant and must see exactly its four
 * auth routes, not these three) and deliberately absent from `ROUTE_AUTHORITY` (putting them there would
 * classify routes this design intends to have zero of).
 *
 * Until T2 lands, though, they are still LIVE routes real ceremony tests still call — and `requireAuthority`
 * (T3, installed on every scope that can reach a mutating route) would otherwise refuse every one of them
 * with `403 route-unclassified`, breaking passing WebAuthn-ceremony coverage for a UI path spec §5 already
 * calls dead on prod ("every T3 challenge answers 403 ceremony-unavailable... the T3 path is simply dead").
 * `classifyRoute` treats them as `open` — a sequencing bridge, not a policy statement: it grants no signed
 * authority, and T2's deletion removes both this list and the routes it names, so nothing should still be
 * reading it once that lands.
 */
export const TRANSITIONAL_CEREMONY_ROUTES: readonly string[] = Object.freeze([
  'POST /api/control/human-requests/:requestRef/respond/challenge',
  'POST /api/inbox/deployment/:ref/challenge',
  'POST /api/control/iteration-gates/:requestRef/challenge',
]);

const BY_KEY = new Map(ROUTE_AUTHORITY.map((entry) => [routeKey(entry), entry]));
const TRANSITIONAL_KEYS = new Set(TRANSITIONAL_CEREMONY_ROUTES);

export function classifyRoute(method: string, path: string): RouteAuthority | null {
  const key = `${String(method).toUpperCase()} ${path}`;
  const entry = BY_KEY.get(key);
  if (entry) return entry;
  if (TRANSITIONAL_KEYS.has(key)) {
    return { method: method.toUpperCase() as RouteAuthority['method'], path, cls: 'open', entityParam: null };
  }
  return null;
}
