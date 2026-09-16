/**
 * The ssh-signed human-approval channel: the canonical payload form and the ten ordered checks
 * `verifyApproval` runs over a signed-class request's `approval` body key. See
 * docs/superpowers/specs/2026-09-16-authority-and-guardrails-design.md §4.2.
 */
import { hasExactKeys, isPlainRecord } from '../control/recordShape.ts';
import type { SshsigVerifier } from './sshsig.ts';
import type { NonceStore } from './nonceStore.ts';

export const APPROVAL_SCHEMA = 'kb.human-approval/v1';
export const APPROVAL_NAMESPACE = 'kb-human-approval';
export const APPROVAL_PRINCIPAL = 'kb-ops-approver';
export const APPROVAL_MAX_TTL_MS = 15 * 60 * 1000;
/** The only human this channel ever names — the payload's `actor` is not a free-form label. */
const APPROVAL_ACTOR = 'daniel';
/** Clock skew tolerated on `issuedAt` against the SERVER's clock (spec §4.2 check #7). */
const ISSUED_AT_SKEW_MS = 60 * 1000;
const PAYLOAD_MAX_BYTES = 2048;
const SIGNATURE_MAX_BYTES = 8192;
const NONCE_PATTERN = /^[0-9a-f]{32}$/;
/** Exactly the shape the spec's example carries — no fractional seconds. `Date.parse` alone would
 *  also accept `.sssZ` and offset forms the signer never produces; the regex pins the wire shape. */
const ISO_Z_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const APPROVAL_PAYLOAD_KEYS = ['schema', 'route', 'entityRef', 'actor', 'issuedAt', 'expiresAt', 'nonce'] as const;

export interface ApprovalPayload {
  schema: string;
  route: string;
  entityRef: string;
  actor: string;
  issuedAt: string;
  expiresAt: string;
  nonce: string;
}

/** The signed bytes, verbatim: `JSON.stringify` over the seven keys IN THIS ORDER, no whitespace, no
 *  trailing newline. The signer produces this same string; the verifier never re-derives it — it
 *  verifies the bytes it actually received. */
export function canonicalApprovalPayload(p: ApprovalPayload): string {
  return JSON.stringify({
    schema: p.schema,
    route: p.route,
    entityRef: p.entityRef,
    actor: p.actor,
    issuedAt: p.issuedAt,
    expiresAt: p.expiresAt,
    nonce: p.nonce,
  });
}

export type ApprovalErrorCode =
  | 'approval-unavailable'
  | 'approval-required'
  | 'approval-invalid'
  | 'approval-expired'
  | 'approval-replayed';

export type ApprovalFailure = { status: 403 | 409 | 503; error: ApprovalErrorCode };

export interface VerifyApprovalInput {
  /** The request body's `approval` key, unvalidated. */
  approval: unknown;
  /** `routeKey(entry)` for the route this request actually reached. */
  expectedRoute: string;
  /** The entity ref the SERVER derived from the request (path param or `entityFromBody`) — never
   *  trusted from the approval itself (spec §5, "why the approval binds route + entityRef"). */
  expectedEntityRef: string;
  /** Path to the allowed-signers file; empty means the channel is not configured on this deployment. */
  allowedSigners: string;
  verifier: Pick<SshsigVerifier, 'verify'>;
  nonces: Pick<NonceStore, 'claim'>;
  now: () => number;
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

/** `null` on anything that is not exactly the pinned `YYYY-MM-DDTHH:MM:SSZ` shape or does not parse. */
function parseIsoZ(value: string): number | null {
  if (!ISO_Z_PATTERN.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

const fail = (status: ApprovalFailure['status'], error: ApprovalErrorCode): { ok: false } & ApprovalFailure =>
  ({ ok: false, status, error });

/** Runs spec §4.2's ten checks in the table's exact order — fail closed and stop at the first one that
 *  does not hold. The nonce is claimed LAST, after the signature verifies, so an unsigned or otherwise
 *  invalid request can never burn a nonce (spec §5). */
export async function verifyApproval(
  input: VerifyApprovalInput,
): Promise<{ ok: true } | ({ ok: false } & ApprovalFailure)> {
  // 1. the channel itself must be configured.
  if (!input.allowedSigners) return fail(503, 'approval-unavailable');

  // 2. `approval` present, an object, with exactly {payload, signature}, both strings.
  if (!isPlainRecord(input.approval) || !hasExactKeys(input.approval, ['payload', 'signature'])) {
    return fail(403, 'approval-required');
  }
  const { payload, signature } = input.approval as { payload: unknown; signature: unknown };
  if (typeof payload !== 'string' || typeof signature !== 'string') {
    return fail(403, 'approval-required');
  }

  // 3. size bounds, before anything parses the payload.
  if (byteLength(payload) > PAYLOAD_MAX_BYTES || byteLength(signature) > SIGNATURE_MAX_BYTES) {
    return fail(403, 'approval-invalid');
  }

  // 4. payload parses to exactly the seven keys, all strings, with the fixed schema/actor and a
  //    well-shaped nonce.
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return fail(403, 'approval-invalid');
  }
  if (!isPlainRecord(parsed) || !hasExactKeys(parsed, APPROVAL_PAYLOAD_KEYS)) {
    return fail(403, 'approval-invalid');
  }
  if (APPROVAL_PAYLOAD_KEYS.some((key) => typeof parsed[key] !== 'string')) {
    return fail(403, 'approval-invalid');
  }
  const body = parsed as unknown as ApprovalPayload;
  if (body.schema !== APPROVAL_SCHEMA) return fail(403, 'approval-invalid');
  if (body.actor !== APPROVAL_ACTOR) return fail(403, 'approval-invalid');
  if (!NONCE_PATTERN.test(body.nonce)) return fail(403, 'approval-invalid');

  // 5. route binding — recomputed server-side, never trusted from the approval.
  if (body.route !== input.expectedRoute) return fail(403, 'approval-invalid');

  // 6. entity binding — recomputed server-side, never trusted from the approval.
  if (body.entityRef !== input.expectedEntityRef) return fail(403, 'approval-invalid');

  // 7. window shape: valid ISO-8601 `Z` timestamps, TTL in (0, 15 min], issuedAt within skew of now.
  const issuedAtMs = parseIsoZ(body.issuedAt);
  const expiresAtMs = parseIsoZ(body.expiresAt);
  if (issuedAtMs === null || expiresAtMs === null) return fail(403, 'approval-invalid');
  const now = input.now();
  const ttlMs = expiresAtMs - issuedAtMs;
  if (ttlMs <= 0 || ttlMs > APPROVAL_MAX_TTL_MS) return fail(403, 'approval-invalid');
  if (issuedAtMs > now + ISSUED_AT_SKEW_MS) return fail(403, 'approval-invalid');

  // 8. expiry against the SERVER clock, never the client's.
  if (expiresAtMs <= now) return fail(403, 'approval-expired');

  // 9. the signature itself.
  const verified = await input.verifier.verify({
    payload: Buffer.from(payload, 'utf8'),
    signature,
    allowedSigners: input.allowedSigners,
    principal: APPROVAL_PRINCIPAL,
    namespace: APPROVAL_NAMESPACE,
  });
  if (!verified) return fail(403, 'approval-invalid');

  // 10. nonce claim — LAST, so an unsigned or invalid request can never burn one.
  const claim = input.nonces.claim(body.nonce, expiresAtMs);
  if (claim !== 'fresh') return fail(409, 'approval-replayed');

  return { ok: true };
}
