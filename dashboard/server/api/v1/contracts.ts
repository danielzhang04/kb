// P6 W0 §3.4/§3.5: the SIX per-kind revision domains as branded, mutually-unassignable types; their
// string-form constructors/parsers; the 428-vs-412 precondition split [P6-C45]; the closed `actions`
// relation union; the claim/renew/report DTOs [§3.5]; and the node-identity refusal-code union [§3.3].
// There is NO generic `compareRevision` and NO shared `revision` field — that is the whole point.
import { ContractDecodeError } from '../../write/durableManifest.ts';

const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const HEX64 = /^[0-9a-f]{64}$/;

// --- The six branded revision domains [§3.4:203]. Each `unique symbol` tag makes them mutually --------
// --- unassignable: a Run ETag cannot be passed where a schedule watermark is expected, at compile time.
declare const REVISION_BRAND: unique symbol;
type Branded<Tag extends string> = string & { readonly [REVISION_BRAND]: Tag };

export type ItemEtag = Branded<'item'>;                                 // agent/workflow source hash
export type RunEtag = Branded<'run'>;                                   // run:<runRef>:<version>
export type ScheduleItemEtag = Branded<'schedule-item'>;                // schedule:<id>:<version>
export type ScheduleCollectionWatermark = Branded<'schedule-collection'>; // schedules:<collectionRevision>
export type SourceRevisionWatermark = Branded<'source-revision'>;       // deployment/asset/inbox source hash
export type HostVersion = Branded<'host-version'>;                      // host:<hostId>:<version>
export type LeaseRevision = Branded<'lease-revision'>;                  // lease:<runRef>:<revision>
export type AggregateWatermark = Branded<'aggregate'>;                  // health/read-only aggregate hash

/**
 * A mutation precondition can be any per-item ETag domain, but NEVER an `AggregateWatermark`: the Health
 * watermark can never be a precondition at all [P6-C45]. Passing one here is a compile error.
 */
export type MutationPrecondition =
  | ItemEtag | RunEtag | ScheduleItemEtag | ScheduleCollectionWatermark | HostVersion | LeaseRevision;

// String-form constructors. Each brands only after validating the exact grammar.
export function runEtag(runRef: string, version: number): RunEtag {
  if (!SAFE_REF.test(runRef)) throw new ContractDecodeError('runEtag', 'safe runRef required');
  if (!Number.isInteger(version) || version < 0) throw new ContractDecodeError('runEtag', 'version integer');
  return `run:${runRef}:${version}` as RunEtag;
}
export function scheduleItemEtag(id: string, version: number): ScheduleItemEtag {
  if (!SAFE_REF.test(id)) throw new ContractDecodeError('scheduleItemEtag', 'safe id required');
  if (!Number.isInteger(version) || version < 0) throw new ContractDecodeError('scheduleItemEtag', 'version integer');
  return `schedule:${id}:${version}` as ScheduleItemEtag;
}
export function scheduleCollectionWatermark(collectionRevision: number): ScheduleCollectionWatermark {
  if (!Number.isInteger(collectionRevision) || collectionRevision < 0) {
    throw new ContractDecodeError('scheduleCollectionWatermark', 'revision integer');
  }
  return `schedules:${collectionRevision}` as ScheduleCollectionWatermark;
}
export function hostVersion(hostId: 'vm' | 'desktop', version: number): HostVersion {
  if (!Number.isInteger(version) || version < 0) throw new ContractDecodeError('hostVersion', 'version integer');
  return `host:${hostId}:${version}` as HostVersion;
}
export function leaseRevision(runRef: string, revision: number): LeaseRevision {
  if (!SAFE_REF.test(runRef)) throw new ContractDecodeError('leaseRevision', 'safe runRef required');
  if (!Number.isInteger(revision) || revision < 1) throw new ContractDecodeError('leaseRevision', 'revision >= 1');
  return `lease:${runRef}:${revision}` as LeaseRevision;
}
/** Agent/workflow item ETags are their source hash, unchanged [§3.4:203]. */
export function itemEtag(sourceHash: string): ItemEtag {
  if (!HEX64.test(sourceHash)) throw new ContractDecodeError('itemEtag', '64 hex source hash');
  return sourceHash as ItemEtag;
}
export function sourceRevisionWatermark(hash: string): SourceRevisionWatermark {
  if (!HEX64.test(hash)) throw new ContractDecodeError('sourceRevisionWatermark', '64 hex');
  return hash as SourceRevisionWatermark;
}
/** A Health/read-only aggregate watermark is a hash of contributing source revisions [design:429]. */
export function aggregateWatermark(hash: string): AggregateWatermark {
  if (!HEX64.test(hash)) throw new ContractDecodeError('aggregateWatermark', '64 hex');
  return hash as AggregateWatermark;
}

// --- Preconditions: 428 (absent) and 412 (present-but-stale) are DIFFERENT failures [P6-C45]. ---------
export type PreconditionResult =
  | { ok: true }
  | { ok: false; status: 428; code: 'precondition-required'; retryable: false }
  | { ok: false; status: 412; code: 'etag-mismatch'; retryable: false; current: string }
  | { ok: false; status: 412; code: 'watermark-not-a-precondition'; retryable: false };

/**
 * Evaluate a per-item ETag precondition on a mutating route. Absent → `428 precondition-required`;
 * present but not equal to the current item ETag → `412` carrying the current value. The type wall
 * forbids an `AggregateWatermark` from ever reaching this function.
 */
export function evaluateItemPrecondition(
  presented: MutationPrecondition | undefined,
  current: MutationPrecondition,
): PreconditionResult {
  if (presented === undefined) return { ok: false, status: 428, code: 'precondition-required', retryable: false };
  if (presented !== current) {
    return { ok: false, status: 412, code: 'etag-mismatch', retryable: false, current: current as string };
  }
  return { ok: true };
}

/**
 * The Health watermark can never be a precondition [P6-C45]. A mutation that presents NOTHING is
 * `428 precondition-required`; one that presents the watermark as `If-Match` is
 * `412 watermark-not-a-precondition`. Neither is a `400`.
 */
export function evaluateAggregatePrecondition(presented: AggregateWatermark | undefined): PreconditionResult {
  if (presented === undefined) return { ok: false, status: 428, code: 'precondition-required', retryable: false };
  return { ok: false, status: 412, code: 'watermark-not-a-precondition', retryable: false };
}

// --- The closed `actions` relation union [§3.4:209, design:431]. -------------------------------------
export const ACTION_RELS = [
  'self', 'events', 'claim', 'renew', 'report', 'respond', 'arm', 'disarm', 'cancel',
  'confirm', 'deploy', 'abort', 'acknowledge', 'inspect', 'pull', 'retry',
] as const;
export type ActionRel = typeof ACTION_RELS[number];

/** HTTP methods only; there is deliberately no merge verb. */
export const ACTION_METHODS = ['GET', 'POST', 'PUT', 'DELETE'] as const;
export type ActionMethod = typeof ACTION_METHODS[number];

export interface V1Action {
  readonly rel: ActionRel;
  readonly href: string;
  readonly method: ActionMethod;
}

/** hrefs are server-constructed, pinned `/api/v1` paths: no scheme, query, whitespace, or traversal. */
const SAFE_HREF = /^\/api\/v1\/[A-Za-z0-9/_:.-]*$/;

/**
 * Build a closed action. Rejects any href that is an executable path, a command, a credential-bearing
 * URL, an environment blob, or a traversal — and any rel/method outside the frozen unions [design:431].
 */
export function buildAction(rel: ActionRel, href: string, method: ActionMethod): V1Action {
  if (!ACTION_RELS.includes(rel)) throw new ContractDecodeError('action.rel', `unknown rel ${JSON.stringify(rel)}`);
  if (!ACTION_METHODS.includes(method)) {
    throw new ContractDecodeError('action.method', `unknown method ${JSON.stringify(method)}`);
  }
  if (typeof href !== 'string' || href.includes('..') || href.includes('//') || !SAFE_HREF.test(href)) {
    throw new ContractDecodeError('action.href', `unsafe href ${JSON.stringify(href)}`);
  }
  return { rel, href, method };
}

// --- Claim / renew / report DTOs [§3.5]. -------------------------------------------------------------
export const MAX_CLAIM_WAIT_MS = 25_000;
export interface ClaimRequest { readonly waitMs: number }
export interface RenewRequest { readonly expectedLeaseRevision: number }
export const REPORT_KINDS = ['started', 'event', 'gate-opened', 'completed', 'failed'] as const;
export type ReportKind = typeof REPORT_KINDS[number];
export interface ReportRequest {
  readonly expectedLeaseRevision: number;
  readonly sequence: number;
  readonly kind: ReportKind;
  readonly payload: Record<string, unknown>;
}

/** A report can never carry an operator decision or a T3 assertion [§3.5:219]. */
export const REPORT_FORBIDDEN_PAYLOAD_KEYS: readonly string[] = [
  'decision', 'assertion', 'authorization', 'expectedRequestRevision', 'credential', 'signature',
];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
function exact(field: string, value: Record<string, unknown>, keys: readonly string[]): void {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new ContractDecodeError(field, `unknown key ${JSON.stringify(key)}`);
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) throw new ContractDecodeError(field, `missing key ${JSON.stringify(key)}`);
  }
}

/** Claim takes nothing the client chooses but `{waitMs}`, and `waitMs <= 25000` [§3.5]. */
export function decodeClaimRequest(value: unknown): ClaimRequest {
  const item = asRecord(value);
  if (!item) throw new ContractDecodeError('claimRequest', 'object required');
  exact('claimRequest', item, ['waitMs']);
  if (typeof item.waitMs !== 'number' || !Number.isInteger(item.waitMs) || item.waitMs < 0
    || item.waitMs > MAX_CLAIM_WAIT_MS) {
    throw new ContractDecodeError('waitMs', `integer 0..${MAX_CLAIM_WAIT_MS}`);
  }
  return { waitMs: item.waitMs };
}

export function decodeRenewRequest(value: unknown): RenewRequest {
  const item = asRecord(value);
  if (!item) throw new ContractDecodeError('renewRequest', 'object required');
  exact('renewRequest', item, ['expectedLeaseRevision']);
  if (typeof item.expectedLeaseRevision !== 'number' || !Number.isInteger(item.expectedLeaseRevision)
    || item.expectedLeaseRevision < 1) {
    throw new ContractDecodeError('expectedLeaseRevision', 'integer >= 1');
  }
  return { expectedLeaseRevision: item.expectedLeaseRevision };
}

/**
 * Report is an append of `started|event|gate-opened|completed|failed` [design:459]; the exact-key wall
 * rejects any `decision`, `expectedRequestRevision`, or assertion-shaped field — at the top level AND in
 * `payload` — before any store write. It cannot respond to or resolve a human gate.
 */
export function decodeReportRequest(value: unknown): ReportRequest {
  const item = asRecord(value);
  if (!item) throw new ContractDecodeError('reportRequest', 'object required');
  exact('reportRequest', item, ['expectedLeaseRevision', 'sequence', 'kind', 'payload']);
  if (typeof item.expectedLeaseRevision !== 'number' || !Number.isInteger(item.expectedLeaseRevision)
    || item.expectedLeaseRevision < 1) {
    throw new ContractDecodeError('expectedLeaseRevision', 'integer >= 1');
  }
  if (typeof item.sequence !== 'number' || !Number.isInteger(item.sequence) || item.sequence < 1) {
    throw new ContractDecodeError('sequence', 'integer >= 1');
  }
  if (!REPORT_KINDS.includes(item.kind as ReportKind)) {
    throw new ContractDecodeError('kind', `not a report kind ${JSON.stringify(item.kind)}`);
  }
  const payload = asRecord(item.payload);
  if (!payload) throw new ContractDecodeError('payload', 'object required');
  for (const forbidden of REPORT_FORBIDDEN_PAYLOAD_KEYS) {
    if (Object.hasOwn(payload, forbidden)) {
      throw new ContractDecodeError('payload', `forbidden field ${JSON.stringify(forbidden)}`);
    }
  }
  return { expectedLeaseRevision: item.expectedLeaseRevision, sequence: item.sequence, kind: item.kind as ReportKind, payload };
}

// --- Node-identity refusal-code union [§3.3]. --------------------------------------------------------
export const NODE_REFUSAL_CODES = [
  'untrusted-peer',                // 401 peer-uid proof fails
  'node-unknown',                  // 403 node id not in map
  'node-revoked',                  // 403 node id revoked
  'host-map-unavailable',          // 503 map missing/malformed
  'node-route-only',               // 403 operator peer on a node route
  'operator-route-only',           // 403 node proxy peer on an operator route
  'operator-not-a-node',           // 403 operator subject on a node route
  'node-not-an-operator',          // 403 node identity on an operator route
  'host-response-forbidden',       // 403 node identity on the human-response route
  'node-attribution-unavailable',  // 503 WhoIs shim dead/refusing/timed-out
] as const;
export type NodeRefusalCode = typeof NODE_REFUSAL_CODES[number];

export const NODE_REFUSAL_STATUS: Record<NodeRefusalCode, number> = {
  'untrusted-peer': 401,
  'node-unknown': 403,
  'node-revoked': 403,
  'host-map-unavailable': 503,
  'node-route-only': 403,
  'operator-route-only': 403,
  'operator-not-a-node': 403,
  'node-not-an-operator': 403,
  'host-response-forbidden': 403,
  'node-attribution-unavailable': 503,
};

export { ContractDecodeError };
