/**
 * R2 — client for the routing read projection (`GET /api/routing`) and the two governed routing writes
 * (`POST /api/write/routing-override`, `POST /api/write/card-routing`). Pure `fetch` (no node builtins,
 * kept off the server import graph); `fetchImpl` is injected for hermetic unit tests. The client NEVER
 * writes routing directly — every mutation carries the WebAuthn bearer to a governed, audited endpoint.
 */

export type RoutingSource = 'card' | 'override' | 'policy' | 'default';

export interface EffectiveView {
  runtime: string;
  model: string;
  sourceRuntime: RoutingSource;
  sourceModel: RoutingSource;
}

export type EffectiveOrUnroutable = (EffectiveView & { unroutable?: false }) | { unroutable: true; reason: string };

export interface RuntimeRegistryEntry {
  default_worker: string | null;
  aliases: Record<string, string>;
  known_models: string[];
}

export interface CardRoutingView {
  stamped: { runtime: string | null; model: string | null };
  effective: EffectiveOrUnroutable;
}

export interface OverrideProvenanceView {
  scope: string;
  key: string;
  runtime: string | null;
  model: string | null;
  expires: string | null;
  setBy: string | null;
  setAt: string | null;
  expired: boolean;
  expiringSoon: boolean;
}

export interface RoutedVsRanView {
  cardId: string;
  routedRuntime: string;
  routedModel: string;
  ranModel: string;
  kind: string;
}

export interface RoutingSnapshot {
  policy: {
    version: number | null;
    runtimes: Record<string, RuntimeRegistryEntry>;
    matrix: Record<string, Record<string, { runtime?: string; model?: string }>>;
    role_default: { runtime?: string; model?: string } | null;
  };
  agents: Array<{ id: string; effective: EffectiveView }>;
  cards: Record<string, CardRoutingView>;
  audit: { mismatches: RoutedVsRanView[]; overrides: OverrideProvenanceView[] };
  overrides: OverrideProvenanceView[];
}

export type FetchLike = typeof fetch;

/** The empty projection used before the first fetch / on failure (read-only view never crashes). */
export const EMPTY_ROUTING: RoutingSnapshot = {
  policy: { version: null, runtimes: {}, matrix: {}, role_default: null },
  agents: [],
  cards: {},
  audit: { mismatches: [], overrides: [] },
  overrides: [],
};

/** Fetch the effective-routing projection. */
export async function fetchRouting(fetchImpl: FetchLike = fetch): Promise<RoutingSnapshot> {
  const res = await fetchImpl('/api/routing');
  if (!res.ok) throw new Error(`GET /api/routing failed: ${res.status}`);
  return (await res.json()) as RoutingSnapshot;
}

export interface WriteResult {
  ok: boolean;
  reason?: string;
}

/** POST a per-agent (or per-scope) routing-override set/clear. Requires a WebAuthn bearer. */
export async function postRoutingOverride(
  body:
    | { op: 'set'; scope: 'agent' | 'card'; key: string; runtime?: string | null; model?: string | null; expires?: string | null }
    | { op: 'clear'; scope: 'agent' | 'card'; key: string },
  token: string,
  fetchImpl: FetchLike = fetch,
): Promise<WriteResult> {
  const res = await fetchImpl('/api/write/routing-override', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { reason?: string };
  return { ok: res.ok, reason: data.reason };
}

/** POST a per-card routing set/clear (card frontmatter — top precedence). Requires a WebAuthn bearer. */
export async function postCardRouting(
  body: { op: 'set'; cardId: string; runtime: string; model: string } | { op: 'clear'; cardId: string },
  token: string,
  fetchImpl: FetchLike = fetch,
): Promise<WriteResult> {
  const res = await fetchImpl('/api/write/card-routing', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { reason?: string };
  return { ok: res.ok, reason: data.reason };
}
