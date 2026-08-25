// P6 W0 §3.4:205, P6-C59: the WHOLE `v1Idempotency` record DECODER — the `Idempotency-Key` grammar, the
// canonical-body hash, the composite record key, and the exact-key wall over a stored row. Ownership
// splits at the decoder: W0 owns THIS file; W1 owns the `v1Idempotency` store collection, the v4
// migration that adds it, and the 24 h TTL sweep, importing this decoder and writing none of its own.
import { ContractDecodeError, sha256Hex } from '../../write/durableManifest.ts';

/** `Idempotency-Key` grammar [§3.4:205]. */
export const IDEMPOTENCY_KEY = /^[A-Za-z0-9_.:-]{16,128}$/;
export function isIdempotencyKey(value: unknown): value is string {
  return typeof value === 'string' && IDEMPOTENCY_KEY.test(value);
}
export function assertIdempotencyKey(value: unknown): string {
  if (!isIdempotencyKey(value)) throw new ContractDecodeError('idempotencyKey', 'must match /^[A-Za-z0-9_.:-]{16,128}$/');
  return value;
}

/** Only mutating methods carry an idempotency record. */
export const IDEMPOTENCY_METHODS = ['POST', 'PUT', 'DELETE'] as const;
export type IdempotencyMethod = typeof IDEMPOTENCY_METHODS[number];

/**
 * The stored row [§3.4:205]. Each row keys on `(actorOrNodeId, method, uri, key)` and stores
 * `sha256(canonical body)` plus the original status and response body bytes. `createdAt` anchors the
 * 24 h TTL that W1's sweeper reclaims.
 */
export interface V1IdempotencyRecord {
  readonly actorOrNodeId: string;
  readonly method: IdempotencyMethod;
  readonly uri: string;
  readonly key: string;
  readonly bodyHash: string;
  readonly status: number;
  readonly responseBody: string;
  readonly createdAt: string;
}

export const V1_IDEMPOTENCY_RECORD_FIELDS: readonly string[] = [
  'actorOrNodeId', 'method', 'uri', 'key', 'bodyHash', 'status', 'responseBody', 'createdAt',
];

const HEX64 = /^[0-9a-f]{64}$/;
const SAFE_ACTOR = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/** Canonical JSON (recursively sorted keys) so a re-ordered but identical body hashes the same. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const rec = value as Record<string, unknown>;
  return `{${Object.keys(rec).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(rec[k])}`).join(',')}}`;
}

/** `sha256(canonical body)` — 64 lowercase hex [§3.4:205]. */
export function canonicalBodyHash(body: unknown): string {
  return sha256Hex(canonicalJson(body));
}

/** The composite record key `(actorOrNodeId, method, URI, key)`, joined unambiguously. */
export function idempotencyRecordKey(
  parts: { actorOrNodeId: string; method: IdempotencyMethod; uri: string; key: string },
): string {
  if (!SAFE_ACTOR.test(parts.actorOrNodeId)) throw new ContractDecodeError('actorOrNodeId', 'safe id required');
  if (!IDEMPOTENCY_METHODS.includes(parts.method)) throw new ContractDecodeError('method', 'mutating method required');
  if (typeof parts.uri !== 'string' || parts.uri.length === 0 || parts.uri.includes('\n')) {
    throw new ContractDecodeError('uri', 'non-empty single-line uri required');
  }
  assertIdempotencyKey(parts.key);
  return `${parts.actorOrNodeId}${parts.method}${parts.uri}${parts.key}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** The exact-key wall over a stored row: precisely the frozen fields, each validated. */
export function decodeV1IdempotencyRecord(value: unknown): V1IdempotencyRecord {
  const item = asRecord(value);
  if (!item) throw new ContractDecodeError('v1IdempotencyRecord', 'object required');
  for (const k of Object.keys(item)) {
    if (!V1_IDEMPOTENCY_RECORD_FIELDS.includes(k)) throw new ContractDecodeError('v1IdempotencyRecord', `unknown key ${JSON.stringify(k)}`);
  }
  for (const k of V1_IDEMPOTENCY_RECORD_FIELDS) {
    if (!Object.hasOwn(item, k)) throw new ContractDecodeError('v1IdempotencyRecord', `missing key ${JSON.stringify(k)}`);
  }
  if (!SAFE_ACTOR.test(item.actorOrNodeId as string)) throw new ContractDecodeError('actorOrNodeId', 'safe id required');
  if (!IDEMPOTENCY_METHODS.includes(item.method as IdempotencyMethod)) {
    throw new ContractDecodeError('method', `mutating method required, got ${JSON.stringify(item.method)}`);
  }
  if (typeof item.uri !== 'string' || item.uri.length === 0) throw new ContractDecodeError('uri', 'non-empty uri');
  if (!isIdempotencyKey(item.key)) throw new ContractDecodeError('key', 'invalid idempotency key');
  if (typeof item.bodyHash !== 'string' || !HEX64.test(item.bodyHash)) throw new ContractDecodeError('bodyHash', '64 hex');
  if (typeof item.status !== 'number' || !Number.isInteger(item.status) || item.status < 100 || item.status > 599) {
    throw new ContractDecodeError('status', 'http status 100..599');
  }
  if (typeof item.responseBody !== 'string') throw new ContractDecodeError('responseBody', 'string required');
  if (typeof item.createdAt !== 'string'
    || !Number.isFinite(Date.parse(item.createdAt))
    || new Date(item.createdAt).toISOString() !== item.createdAt) {
    throw new ContractDecodeError('createdAt', 'RFC 3339 UTC required');
  }
  return {
    actorOrNodeId: item.actorOrNodeId as string,
    method: item.method as IdempotencyMethod,
    uri: item.uri,
    key: item.key as string,
    bodyHash: item.bodyHash,
    status: item.status,
    responseBody: item.responseBody,
    createdAt: item.createdAt,
  };
}

export type ReplayOutcome =
  | { readonly outcome: 'replay'; readonly status: number; readonly responseBody: string }
  | { readonly outcome: 'conflict'; readonly status: 409; readonly code: 'idempotency-conflict' };

/**
 * Compare a fresh request's canonical body hash against a stored row: an identical replay returns the
 * stored status/body verbatim; a changed body is `409 idempotency-conflict` [§3.4:205].
 */
export function evaluateReplay(record: V1IdempotencyRecord, presentedBodyHash: string): ReplayOutcome {
  if (record.bodyHash === presentedBodyHash) {
    return { outcome: 'replay', status: record.status, responseBody: record.responseBody };
  }
  return { outcome: 'conflict', status: 409, code: 'idempotency-conflict' };
}
