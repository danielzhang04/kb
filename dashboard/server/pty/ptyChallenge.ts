/**
 * D3.1 (MED mitigation) — the PTY-open WebAuthn challenge codec (pure, dependency-free).
 *
 * A fleet-PTY open now requires a HOST-verified hardware passkey assertion over a HOST-issued fresh
 * nonce (Factor C, added on top of the existing peer-SID + per-boot-token factors). The host assembles
 * the exact challenge STRING the authenticator signs over and sends it to the daemon; the browser signs
 * exactly those bytes; the host-side verifier checks `clientDataJSON.challenge` byte-for-byte against it.
 *
 * DOMAIN SEPARATION (load-bearing): the PTY challenge is a TWO-tuple `["kb-pty-open", <nonceB64url>]`,
 * deliberately distinct from the card-approval channel's FOUR-tuple `[cardId, action, contentHash,
 * nonce]` (frozen `dashboard/server/auth/challenge.ts` / `scripts/webauthn_verify.py`). Because the
 * discriminant tag AND the arity differ, a card-approval assertion can never satisfy a PTY open and
 * vice-versa: this module's `parsePtyChallenge` rejects anything that is not a 2-tuple whose first
 * element is exactly `PTY_CHALLENGE_TAG`, and the card verifier's `parse_challenge` rejects anything
 * that is not a 4-element array.
 *
 * The encoding is byte-identical to the Python side (`scripts/pty_host_assertion_verify.py`): the
 * base64url (no padding) of `JSON.stringify(["kb-pty-open", nonceB64url])`. A pinned cross-language hex
 * constant in both test suites proves the two legs agree (a mismatch would fail closed, rejecting a
 * legitimate touch).
 */

/** The domain-separation discriminant. NEVER reused by the card channel (which has no such tag). */
export const PTY_CHALLENGE_TAG = 'kb-pty-open';

/** Strict base64url encode (no padding) — matches Python's `_b64url_encode`. */
function b64urlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

/**
 * Assemble the exact WebAuthn challenge string for a PTY open from a fresh host nonce. The nonce is
 * base64url-encoded and embedded as the second element of the 2-tuple; the whole tuple is JSON-encoded
 * and base64url-wrapped so the browser signs — and the verifier checks — exactly these bytes.
 */
export function buildPtyChallenge(nonce: Uint8Array): string {
  const nonceB64 = b64urlEncode(nonce);
  return Buffer.from(JSON.stringify([PTY_CHALLENGE_TAG, nonceB64]), 'utf-8').toString('base64url');
}

/**
 * Inverse of `buildPtyChallenge`. Returns the embedded `nonceB64url` string, or THROWS (fail-closed) on
 * anything that is not a base64url-wrapped 2-tuple `["kb-pty-open", <string>]`. Rejecting the card
 * channel's 4-tuple here is the TS-side half of the domain-separation guarantee.
 */
export function parsePtyChallenge(challenge: string): string {
  if (typeof challenge !== 'string' || challenge.length === 0) {
    throw new Error('pty challenge is not a non-empty string; fail-closed');
  }
  let decoded: string;
  try {
    decoded = Buffer.from(challenge, 'base64url').toString('utf-8');
  } catch {
    throw new Error('pty challenge is not valid base64url; fail-closed');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    throw new Error('pty challenge does not decode to JSON; fail-closed');
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) {
    throw new Error('pty challenge is not a 2-element array (domain separation); fail-closed');
  }
  const [tag, nonceB64] = parsed as unknown[];
  if (tag !== PTY_CHALLENGE_TAG) {
    throw new Error(`pty challenge tag is not '${PTY_CHALLENGE_TAG}' (got ${JSON.stringify(tag)}); fail-closed`);
  }
  if (typeof nonceB64 !== 'string' || nonceB64.length === 0) {
    throw new Error('pty challenge nonce is not a non-empty string; fail-closed');
  }
  return nonceB64;
}

/** True iff `challenge` is a well-formed PTY-open 2-tuple (never throws). Convenience over `parse`. */
export function isPtyChallenge(challenge: string): boolean {
  try {
    parsePtyChallenge(challenge);
    return true;
  } catch {
    return false;
  }
}
