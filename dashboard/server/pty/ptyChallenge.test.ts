/**
 * D3.1 (MED mitigation) — M1: the pure PTY-open challenge codec. Proves round-trips, fail-closed parsing
 * of every malformed shape, and — load-bearing — DOMAIN SEPARATION from the card channel's 4-tuple.
 */
import { describe, expect, it } from 'vitest';
import { buildPtyChallenge, parsePtyChallenge, isPtyChallenge, PTY_CHALLENGE_TAG } from './ptyChallenge.ts';

/** base64url (no pad) of arbitrary bytes — mirrors the module's internal encoder for assertions. */
function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

/** Wrap an arbitrary JSON value as a base64url challenge, to forge malformed shapes in tests. */
function wrap(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf-8').toString('base64url');
}

describe('buildPtyChallenge / parsePtyChallenge — round-trip', () => {
  it('round-trips a fresh 32-byte nonce through the 2-tuple', () => {
    const nonce = new Uint8Array(32);
    for (let i = 0; i < 32; i++) nonce[i] = (i * 7 + 3) & 0xff;
    const challenge = buildPtyChallenge(nonce);
    expect(parsePtyChallenge(challenge)).toBe(b64url(nonce));
    expect(isPtyChallenge(challenge)).toBe(true);
  });

  it('CROSS-LANGUAGE PIN: matches the Python encoder byte-for-byte for a known nonce', () => {
    // nonce whose base64url is "dGVzdC1ub25jZQ" ("test-nonce"). The pinned output is asserted against
    // the SAME sample + constant in tests/test_pty_host_assertion_verify.py — a mismatch fails closed.
    const nonce = Buffer.from('test-nonce', 'utf-8');
    expect(b64url(nonce)).toBe('dGVzdC1ub25jZQ');
    expect(buildPtyChallenge(nonce)).toBe('WyJrYi1wdHktb3BlbiIsImRHVnpkQzF1YjI1alpRIl0');
  });
});

describe('parsePtyChallenge — fail-closed', () => {
  it('rejects a non-base64url / non-JSON blob', () => {
    expect(() => parsePtyChallenge('!!!not base64url!!!')).toThrow(/fail-closed/);
    expect(() => parsePtyChallenge('')).toThrow(/fail-closed/);
  });

  it('rejects a JSON value that is not an array', () => {
    expect(() => parsePtyChallenge(wrap({ tag: PTY_CHALLENGE_TAG, nonce: 'x' }))).toThrow(/2-element array/);
    expect(() => parsePtyChallenge(wrap('kb-pty-open'))).toThrow(/2-element array/);
  });

  it('rejects the wrong arity (1-tuple, 3-tuple)', () => {
    expect(() => parsePtyChallenge(wrap([PTY_CHALLENGE_TAG]))).toThrow(/2-element array/);
    expect(() => parsePtyChallenge(wrap([PTY_CHALLENGE_TAG, 'n', 'extra']))).toThrow(/2-element array/);
  });

  it('rejects a wrong domain tag (a different single-word tag)', () => {
    expect(() => parsePtyChallenge(wrap(['kb-card-approve', 'nonce']))).toThrow(/tag is not/);
  });

  it('rejects a non-string / empty nonce element', () => {
    expect(() => parsePtyChallenge(wrap([PTY_CHALLENGE_TAG, 123]))).toThrow(/nonce is not/);
    expect(() => parsePtyChallenge(wrap([PTY_CHALLENGE_TAG, '']))).toThrow(/nonce is not/);
  });
});

describe('DOMAIN SEPARATION from the card channel', () => {
  it('a card-approval 4-tuple challenge is NOT a valid PTY challenge', () => {
    // Byte-shape of the frozen card challenge: base64url(JSON.stringify([cardId, action, hash, nonce])).
    const cardChallenge = wrap(['01ARZ3NDEKTSV4RRFFQ69G5FAV', 'deploy', 'a'.repeat(64), 'nonce-000']);
    expect(isPtyChallenge(cardChallenge)).toBe(false);
    expect(() => parsePtyChallenge(cardChallenge)).toThrow(/2-element array/);
  });

  it("a PTY 2-tuple's tag can never collide with a 4-element card tuple (arity differs)", () => {
    const pty = buildPtyChallenge(Buffer.from('abc', 'utf-8'));
    const decoded = JSON.parse(Buffer.from(pty, 'base64url').toString('utf-8'));
    expect(Array.isArray(decoded)).toBe(true);
    expect(decoded).toHaveLength(2);
    expect(decoded[0]).toBe(PTY_CHALLENGE_TAG);
  });
});
