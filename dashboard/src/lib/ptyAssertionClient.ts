/**
 * D3.1 MED mitigation — M7: the browser half of the fleet-PTY-open passkey ceremony.
 *
 * Opening a fleet terminal now requires a HOST-verified hardware passkey assertion over a HOST-issued
 * fresh nonce (Factor C). The flow on the terminal WebSocket:
 *
 *   1. host → daemon → browser:  a `challenge` control message (the assembled nonce challenge string).
 *   2. browser:                  `navigator.credentials.get({ challenge, rpId, userVerification:'required' })`
 *                                → USER TOUCHES THE PASSKEY → an assertion.
 *   3. browser → daemon → host:  an `assertion` control message the host verifies (Factor C).
 *
 * This module is framework-agnostic and network-agnostic — it takes the challenge, runs the ceremony via
 * the injected `@simplewebauthn/browser` seam (reusing `performAssertion`), and hands back the assertion
 * for the caller to relay. The real touch is exercised at the M8 human gate; here the MESSAGE PLUMBING is
 * unit-tested with fakes. Fails LOUDLY (throws) if the ceremony fails, so the caller relays nothing bogus.
 */
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { performAssertion, realWebAuthnBrowser } from './webauthnClient.ts';
import type { WebAuthnBrowserLike } from './webauthnClient.ts';

/** The assertion envelope the host-side verifier consumes (base64url fields, mirrors the server type). */
export interface PtyAssertion {
  credentialId: string;
  authenticatorData: string;
  clientDataJSON: string;
  signature: string;
}

/** A control message on the terminal WS. `challenge` is host→browser; `assertion` is browser→host. */
export type PtyControlMessage =
  | { type: 'challenge'; challenge: string }
  | { type: 'assertion'; assertion: PtyAssertion };

/** Default assertion timeout (ms) for the ceremony. Bounded so a stuck authenticator surfaces to the UI. */
const DEFAULT_CEREMONY_TIMEOUT_MS = 60_000;

/**
 * Run the passkey ceremony over the host-issued `challenge` and map the browser response to the host's
 * assertion envelope. `userVerification: 'required'` forces the biometric/PIN (UV) the host verifier
 * demands. Throws on any ceremony failure (declined / no touch / no WebAuthn) — never returns a partial.
 */
export async function collectPtyAssertion(
  challenge: string,
  rpId: string,
  browser: WebAuthnBrowserLike = realWebAuthnBrowser,
): Promise<PtyAssertion> {
  const options: PublicKeyCredentialRequestOptionsJSON = {
    challenge, // the host-issued base64url challenge; @simplewebauthn decodes it to the signed bytes
    rpId,
    userVerification: 'required',
    timeout: DEFAULT_CEREMONY_TIMEOUT_MS,
  };
  const resp = await performAssertion(options, browser);
  return {
    credentialId: resp.id,
    authenticatorData: resp.response.authenticatorData,
    clientDataJSON: resp.response.clientDataJSON,
    signature: resp.response.signature,
  };
}

/** Injectable deps for the message-plumbing handler (all faked in unit tests). */
export interface PtyChallengeHandlerDeps {
  /** The pinned RP id the ceremony asserts to (server-configured; NEVER derived from the challenge). */
  rpId: string;
  /** Relay a control message back toward the host (in production, `ws.send(JSON.stringify(msg))`). */
  send: (message: PtyControlMessage) => void;
  /** The ceremony runner. Default: `collectPtyAssertion`. Injected in tests. */
  collect?: (challenge: string, rpId: string) => Promise<PtyAssertion>;
  /** Surface a ceremony failure to the UI (the open is refused host-side regardless). */
  onError?: (err: unknown) => void;
}

/**
 * Handle ONE inbound control message from the terminal WS. If it is a `challenge`, run the ceremony and
 * relay the resulting `assertion`. Non-challenge / malformed messages are ignored (returns false) so the
 * caller can fall through to its normal PTY-data handling. Returns true iff a challenge was consumed.
 *
 * Fail-closed: a ceremony failure relays NOTHING (the host times out its per-connection nonce and the
 * open is refused). The error is surfaced via `onError` for the UI, never swallowed silently.
 */
export async function handlePtyChallenge(raw: unknown, deps: PtyChallengeHandlerDeps): Promise<boolean> {
  const msg = parseControlMessage(raw);
  if (!msg || msg.type !== 'challenge') return false;
  const collect = deps.collect ?? ((c: string, r: string) => collectPtyAssertion(c, r));
  try {
    const assertion = await collect(msg.challenge, deps.rpId);
    deps.send({ type: 'assertion', assertion });
  } catch (err) {
    deps.onError?.(err);
  }
  return true;
}

/** Parse a raw WS payload (string or already-parsed object) into a control message, or null. */
export function parseControlMessage(raw: unknown): PtyControlMessage | null {
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (obj === null || typeof obj !== 'object') return null;
  const rec = obj as Record<string, unknown>;
  if (rec.type === 'challenge' && typeof rec.challenge === 'string') {
    return { type: 'challenge', challenge: rec.challenge };
  }
  if (rec.type === 'assertion' && rec.assertion && typeof rec.assertion === 'object') {
    const a = rec.assertion as Record<string, unknown>;
    if (
      typeof a.credentialId === 'string' &&
      typeof a.authenticatorData === 'string' &&
      typeof a.clientDataJSON === 'string' &&
      typeof a.signature === 'string'
    ) {
      return {
        type: 'assertion',
        assertion: {
          credentialId: a.credentialId,
          authenticatorData: a.authenticatorData,
          clientDataJSON: a.clientDataJSON,
          signature: a.signature,
        },
      };
    }
  }
  return null;
}
