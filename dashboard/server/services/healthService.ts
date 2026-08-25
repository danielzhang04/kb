// P6 W2 [P6-C64, P6-C76, P6-C80, design:410,435] — the pure health service extracted from
// `registerHealthRoutes`'s `GET /api/health` handler (`health/routes.ts`). It composes the shipped health
// response through the injected `composeHealth` port and applies the same `"health:<sha256>"` ETag/304,
// AND composes two NEW integrity rows into the `fleet` section, both FAILURE-ONLY:
//
//   • the `node-proxy` row [P6-C64, P6-C76]: `kind:'integrity'`, `label:'Node proxy'`, value
//     `{status:'error', code:'node-proxy-unreachable', owner:'kb-node-proxy'}`, emitted ONLY when the
//     proxy, the shim socket, or the second serve listener is unreachable, and OMITTED entirely when
//     healthy — a reachable row could not satisfy `healthClient`'s `body.status === 'error'` wall.
//   • the `host-map` row [P6-C80]: `kind:'integrity'`, `label:'Host map'`, value
//     `{status:'error', code:'host-map-invalid', owner:<basename of the map file path>}`, emitted on any
//     §3.3 map malformation and OMITTED when the map loads clean.
//
// Both sit in the `fleet` section beside the existing schedule-owner integrity row; both carry a `code`
// so `src/views/Health.tsx`'s `row.value.code` render is untouched. No other section changes. W6.2 serves
// these rows and owns the `healthClient` wall edit; W2 only BUILDS the service + its test. No route edited.

import { createHash } from 'node:crypto';
import type { HealthResponse } from '../health/service.ts';
import type { ServiceReply } from './scheduleService.ts';

/** The `node-proxy` failure row shape — the closed three-key `{status,code,owner}` integrity wall. */
export interface NodeProxyIntegrityRow {
  readonly kind: 'integrity';
  readonly key: 'node-proxy:kb-node-proxy';
  readonly label: 'Node proxy';
  readonly value: { readonly status: 'error'; readonly code: 'node-proxy-unreachable'; readonly owner: 'kb-node-proxy' };
  readonly observedAt: string;
  readonly source: 'node-proxy';
}

/** The `host-map` failure row shape — same closed three-key `{status,code,owner}` integrity wall. */
export interface HostMapIntegrityRow {
  readonly kind: 'integrity';
  readonly key: `host-map:${string}`;
  readonly label: 'Host map';
  readonly value: { readonly status: 'error'; readonly code: 'host-map-invalid'; readonly owner: string };
  readonly observedAt: string;
  readonly source: 'host-map';
}

/** Liveness of the node-identity hop: the proxy process, the `WhoIs` shim socket, and the second serve
 *  listener. Any unreachable member is a failure. Injected so no real socket is opened in tests. */
export type NodeProxyLivenessPort = () => { readonly reachable: boolean };

/** Validation of the root-owned host-node map. `valid:false` on any §3.3 malformation. `mapPath` is the
 *  configured file path, whose basename becomes the row's `owner`. Injected so no real file is read. */
export type HostMapValidationPort = () => { readonly valid: boolean; readonly mapPath: string };

export interface HealthServicePort {
  /** `composeHealth(...)` plus the schedule collection revision the route captures during composition. */
  compose(): Promise<{ response: HealthResponse; scheduleCollectionRevision: number | 'unavailable' }>;
  nodeProxyLiveness: NodeProxyLivenessPort;
  hostMapValidation: HostMapValidationPort;
  /** RFC 3339 stamp for any composed integrity row; stripped before the ETag, like every other row. */
  nowIso(): string;
}

function mapBasename(mapPath: string): string {
  return mapPath.split(/[\\/]/).filter((segment) => segment.length > 0).pop() ?? mapPath;
}

/** The `node-proxy` failure row, when the hop is unreachable. */
export function nodeProxyRow(observedAt: string): NodeProxyIntegrityRow {
  return {
    kind: 'integrity', key: 'node-proxy:kb-node-proxy', label: 'Node proxy',
    value: { status: 'error', code: 'node-proxy-unreachable', owner: 'kb-node-proxy' },
    observedAt, source: 'node-proxy',
  };
}

/** The `host-map` failure row, when the map is malformed. `owner` is the map file's basename. */
export function hostMapRow(observedAt: string, mapPath: string): HostMapIntegrityRow {
  const owner = mapBasename(mapPath);
  return {
    kind: 'integrity', key: `host-map:${owner}`, label: 'Host map',
    value: { status: 'error', code: 'host-map-invalid', owner },
    observedAt, source: 'host-map',
  };
}

/**
 * Compose Health with the two failure-only integrity rows appended to the `fleet` section, then apply the
 * route's exact ETag/304. Returns the extra rows so a caller/test can assert independence without walking
 * the section, but the served body already carries them inside `fleet`.
 */
export async function composeHealthResponse(port: HealthServicePort): Promise<{
  response: HealthResponse;
  scheduleCollectionRevision: number | 'unavailable';
  addedRows: Array<NodeProxyIntegrityRow | HostMapIntegrityRow>;
}> {
  const { response, scheduleCollectionRevision } = await port.compose();
  const observedAt = port.nowIso();
  const added: Array<NodeProxyIntegrityRow | HostMapIntegrityRow> = [];
  if (!port.nodeProxyLiveness().reachable) added.push(nodeProxyRow(observedAt));
  const map = port.hostMapValidation();
  if (!map.valid) added.push(hostMapRow(observedAt, map.mapPath));

  // Append only into the `fleet` section's rows; every other section is left byte-for-byte identical.
  const sections = response.sections.map((section) =>
    section.id === 'fleet'
      ? { ...section, rows: [...section.rows, ...added] as typeof section.rows }
      : section);
  return { response: { ...response, sections } as HealthResponse, scheduleCollectionRevision, addedRows: added };
}

/** GET /api/health — compose (with the two failure rows) then the `"health:<sha256>"` ETag/304. */
export async function readHealth(port: HealthServicePort, ifNoneMatch: string | undefined): Promise<ServiceReply> {
  const { response, scheduleCollectionRevision } = await composeHealthResponse(port);
  const stableSections = response.sections.map((section) => ({
    ...section,
    rows: section.rows.map(({ observedAt: _observedAt, ...row }) => row),
  }));
  const revision = createHash('sha256')
    .update(JSON.stringify({ scheduleCollectionRevision, sections: stableSections }))
    .digest('hex');
  const etag = `"health:${revision}"`;
  if (ifNoneMatch === etag) return { status: 304, etag };
  return { status: 200, etag, body: response };
}
