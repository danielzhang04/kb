import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor } from './cursor.ts';
import type { CursorPayload } from './cursor.ts';

// Low-entropy synthetic HMAC keys (injected — W1 persists the real secret, P6-C41).
const KEY = Buffer.from('test-cursor-key-v1', 'utf8');
const ROTATED = Buffer.from('test-cursor-key-v2', 'utf8');
const payload: CursorPayload = { kind: 'runs', watermark: 'w-1', filterHash: 'f-1', lastKey: 'k-000' };

describe('cursor codec (§3.4:209, injected HMAC key)', () => {
  it('round-trips a valid cursor while its watermark is current', () => {
    const token = encodeCursor(payload, KEY);
    const result = decodeCursor(token, KEY, 'w-1');
    expect(result).toEqual({ ok: true, payload });
  });

  it('is stable across daemons sharing the same secret (one-stream-both-hosts)', () => {
    // A cursor minted with one Buffer verifies under a distinct Buffer of the same bytes.
    const token = encodeCursor(payload, KEY);
    const sameSecret = Buffer.from('test-cursor-key-v1', 'utf8');
    expect(decodeCursor(token, sameSecret, 'w-1').ok).toBe(true);
  });

  it('returns 409 cursor-stale once the watermark has moved', () => {
    const token = encodeCursor(payload, KEY);
    expect(decodeCursor(token, KEY, 'w-2'))
      .toEqual({ ok: false, status: 409, code: 'cursor-stale', retryable: true });
  });

  it('treats a rotated secret as 409 cursor-stale, never 400', () => {
    const token = encodeCursor(payload, KEY);
    expect(decodeCursor(token, ROTATED, 'w-1'))
      .toEqual({ ok: false, status: 409, code: 'cursor-stale', retryable: true });
  });

  it('returns 400 cursor-malformed for a hand-edited or truncated cursor', () => {
    const token = encodeCursor(payload, KEY);
    const malformed = { ok: false, status: 400, code: 'cursor-malformed', retryable: false };
    expect(decodeCursor(token.slice(0, token.indexOf('.')), KEY, 'w-1')).toEqual(malformed); // no signature
    expect(decodeCursor('not-base64url.@@@', KEY, 'w-1')).toEqual(malformed);
    expect(decodeCursor('', KEY, 'w-1')).toEqual(malformed);
    expect(decodeCursor(`${Buffer.from('{"kind":"runs"}').toString('base64url')}.sig`, KEY, 'w-1')).toEqual(malformed);
  });

  it('encodes the exact four fields regardless of input key order', () => {
    const reordered: CursorPayload = { lastKey: 'k-000', filterHash: 'f-1', watermark: 'w-1', kind: 'runs' };
    expect(encodeCursor(reordered, KEY)).toBe(encodeCursor(payload, KEY));
  });
});
