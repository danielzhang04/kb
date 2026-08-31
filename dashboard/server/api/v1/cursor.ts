// P6 W0 §3.4:209: the signed opaque list cursor. It encodes `{kind, watermark, filterHash, lastKey}`,
// base64url over the payload with a detached HMAC-SHA256 signature. The HMAC key is an INJECTED
// parameter [P6-C41] — W0 defines the codec shape; W1 persists the per-store secret in the control
// document so a VM-minted cursor verifies at the Desktop daemon and survives restart.
//
// Decode outcomes [P6-C41]:
//   - watermark moved            -> 409 cursor-stale   (client restarts the stream)
//   - signature fails (rotation) -> 409 cursor-stale   (a rotated secret is a restart, never a 400)
//   - structurally malformed     -> 400 cursor-malformed (hand-edited or truncated)
// A rotated secret and a valid-structure forgery both fail the HMAC and are indistinguishable with only
// the current key, so both are `409` — the client's correct response to either is to restart, and no
// payload is ever trusted after a failed HMAC. Only a token that cannot be parsed at all is `400`.
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface CursorPayload {
  readonly kind: string;
  readonly watermark: string;
  readonly filterHash: string;
  readonly lastKey: string;
}

const CURSOR_KEYS: readonly (keyof CursorPayload)[] = ['kind', 'watermark', 'filterHash', 'lastKey'];

export type CursorDecodeResult =
  | { readonly ok: true; readonly payload: CursorPayload }
  | { readonly ok: false; readonly status: 409; readonly code: 'cursor-stale'; readonly retryable: true }
  | { readonly ok: false; readonly status: 400; readonly code: 'cursor-malformed'; readonly retryable: false };

/** Canonical JSON over the fixed four-field payload (keys emitted in the frozen order). */
function canonicalPayload(payload: CursorPayload): string {
  return JSON.stringify({
    filterHash: payload.filterHash,
    kind: payload.kind,
    lastKey: payload.lastKey,
    watermark: payload.watermark,
  });
}

function sign(body: string, key: Buffer): string {
  return createHmac('sha256', key).update(body, 'utf8').digest('base64url');
}

/** Encode a cursor: `base64url(canonical payload).base64url(HMAC)`. */
export function encodeCursor(payload: CursorPayload, key: Buffer): string {
  const canonical = canonicalPayload(payload);
  const body = Buffer.from(canonical, 'utf8').toString('base64url');
  return `${body}.${sign(canonical, key)}`;
}

function malformed(): CursorDecodeResult {
  return { ok: false, status: 400, code: 'cursor-malformed', retryable: false };
}
function stale(): CursorDecodeResult {
  return { ok: false, status: 409, code: 'cursor-stale', retryable: true };
}

/**
 * Decode and verify a cursor against the current `key` and `currentWatermark`. See the outcome table at
 * the head of this file: structural failure is the only `400`; a failed HMAC or a moved watermark is `409`.
 */
export function decodeCursor(token: string, key: Buffer, currentWatermark: string): CursorDecodeResult {
  if (typeof token !== 'string') return malformed();
  const dot = token.indexOf('.');
  if (dot <= 0 || dot !== token.lastIndexOf('.') || dot === token.length - 1) return malformed();
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return malformed();
  }
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return malformed();
  const rec = json as Record<string, unknown>;
  if (Object.keys(rec).length !== CURSOR_KEYS.length) return malformed();
  for (const field of CURSOR_KEYS) {
    if (typeof rec[field] !== 'string') return malformed();
  }
  const payload: CursorPayload = {
    kind: rec.kind as string,
    watermark: rec.watermark as string,
    filterHash: rec.filterHash as string,
    lastKey: rec.lastKey as string,
  };

  // Verify the detached signature under the CURRENT key. A rotated secret fails here and is `409`.
  const expected = Buffer.from(sign(canonicalPayload(payload), key), 'utf8');
  let presented: Buffer;
  try {
    presented = Buffer.from(sig, 'utf8');
  } catch {
    return malformed();
  }
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) return stale();

  if (payload.watermark !== currentWatermark) return stale();
  return { ok: true, payload };
}
