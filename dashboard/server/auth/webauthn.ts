/**
 * D2.1 — SimpleWebAuthn registration/assertion transport. This is the *transport* only: option
 * generation for the browser's `startRegistration()`/`startAuthentication()` ceremonies, and the
 * corresponding server-side verify calls. RP-ID is pinned to the FULL ts.net host (§7 Q4) — never
 * the bare `ts.net` suffix, which would let any tailnet box claim credentials scoped to this one.
 * `userVerification: 'required'` everywhere so a bare presence tap (no biometric/PIN) can never
 * stand in for the approval signer.
 *
 * What this module does NOT do: the custom challenge-binding to a card's canonical content_hash
 * (D2.2) and the independent, load-bearing dispatcher-side re-verification (D2.3,
 * `scripts/webauthn_verify.py`) that actually gates a T3 write. `assertionForChallenge` only embeds
 * an externally-supplied challenge into the WebAuthn options — it does not construct or validate
 * that challenge's preimage; that binding is D2.2/D2.3's job.
 */
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  VerifiedAuthenticationResponse,
  VerifiedRegistrationResponse,
  WebAuthnCredential,
} from '@simplewebauthn/server';

export interface WebAuthnConfig {
  /** Full ts.net host, e.g. `box-1234.tailnet-abcd.ts.net` — never the bare `ts.net` suffix. */
  rpID: string;
  /** User-visible relying-party name shown by the platform passkey UI. */
  rpName: string;
  /** The full RP origin (scheme + host), e.g. `https://box-1234.tailnet-abcd.ts.net`. */
  origin: string;
}

const DEFAULT_RP_NAME = 'kb Mission Control';

/** The host (no scheme/port) of an origin URL — this is what WebAuthn calls the RP ID. */
function hostnameOf(origin: string): string {
  return new URL(origin).hostname;
}

/**
 * Resolve the WebAuthn RP config from the environment. Fail-closed: throws when
 * `DASHBOARD_RP_ORIGIN` is not configured rather than silently falling back to `localhost` — an
 * unconfigured RP must never silently pin credentials to the wrong (or no) host. Mirrors the
 * fail-closed stance of `security/origin.ts`'s `resolveAllowedOrigins`.
 */
export function resolveWebAuthnConfig(
  env: Record<string, string | undefined> = process.env,
): WebAuthnConfig {
  const origin = env.DASHBOARD_RP_ORIGIN?.trim();
  if (!origin) {
    throw new Error(
      'DASHBOARD_RP_ORIGIN is not configured — refusing to pin a WebAuthn RP-ID (fail-closed)',
    );
  }
  return {
    origin,
    rpID: hostnameOf(origin),
    rpName: env.DASHBOARD_RP_NAME?.trim() || DEFAULT_RP_NAME,
  };
}

export interface WebAuthnUser {
  id: string;
  name: string;
  displayName: string;
  /** Credentials already registered for this user, excluded from a new registration ceremony so the
   *  same authenticator can't be enrolled twice. */
  credentials?: WebAuthnCredential[];
}

/**
 * Begin a registration ceremony. Options for the browser's `startRegistration()`, RP-ID pinned to
 * the full ts.net host and `userVerification: 'required'` (biometric/PIN, not bare presence) at
 * enrollment time too — a passkey enrolled without UV could later assert without it.
 */
export async function registrationOptions(
  user: WebAuthnUser,
  config: WebAuthnConfig = resolveWebAuthnConfig(),
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  return generateRegistrationOptions({
    rpName: config.rpName,
    rpID: config.rpID,
    userName: user.name,
    userID: new TextEncoder().encode(user.id),
    userDisplayName: user.displayName,
    attestationType: 'none',
    excludeCredentials: (user.credentials ?? []).map((c) => ({
      id: c.id,
      transports: c.transports,
    })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
  });
}

export interface VerifyRegistrationArgs {
  /** The base64url `challenge` returned by the matching `registrationOptions()` call. */
  expectedChallenge: string;
  config?: WebAuthnConfig;
}

/** Verify the browser's registration response against the challenge issued for this ceremony. */
export async function verifyRegistration(
  resp: RegistrationResponseJSON,
  args: VerifyRegistrationArgs,
): Promise<VerifiedRegistrationResponse> {
  const config = args.config ?? resolveWebAuthnConfig();
  return verifyRegistrationResponse({
    response: resp,
    expectedChallenge: args.expectedChallenge,
    expectedOrigin: config.origin,
    expectedRPID: config.rpID,
    requireUserVerification: true,
  });
}

export interface AssertionSession {
  /** Credentials the requesting user has already registered — narrows which authenticator the
   *  browser offers. Omit/empty lets the browser prompt for any discoverable credential. */
  credentials?: WebAuthnCredential[];
}

/**
 * Begin a general (login) assertion ceremony: options for the browser's `startAuthentication()`,
 * embedding a freshly-generated server challenge and requiring user-verification.
 */
export async function assertionOptions(
  session: AssertionSession,
  config: WebAuthnConfig = resolveWebAuthnConfig(),
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  return generateAuthenticationOptions({
    rpID: config.rpID,
    allowCredentials: (session.credentials ?? []).map((c) => ({
      id: c.id,
      transports: c.transports,
    })),
    userVerification: 'required',
  });
}

/**
 * Assertion options bound to an EXTERNALLY-SUPPLIED challenge — e.g. D2.2's card-approval
 * `challenge = base64url(card_id ‖ action ‖ content_hash ‖ nonce)` — instead of a freshly-generated
 * one, so the approval-signing ceremony proves the biometric was performed over THIS exact,
 * pre-committed challenge value rather than an arbitrary server-generated nonce. Still RP-ID-pinned
 * and still requires user-verification.
 *
 * Note: SimpleWebAuthn's `challenge` option, when given a string, treats it as opaque UTF-8 text and
 * re-encodes those bytes as base64url for the wire — so `options.challenge` is
 * `base64url(UTF8(challenge))`, not `challenge` verbatim. Decoding it back to UTF-8 round-trips to
 * the exact input; that is the byte sequence the authenticator signs and what D2.3's verifier must
 * recompute against.
 */
export async function assertionForChallenge(
  challenge: string,
  session: AssertionSession = {},
  config: WebAuthnConfig = resolveWebAuthnConfig(),
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  return generateAuthenticationOptions({
    rpID: config.rpID,
    allowCredentials: (session.credentials ?? []).map((c) => ({
      id: c.id,
      transports: c.transports,
    })),
    challenge,
    userVerification: 'required',
  });
}

export interface VerifyAssertionArgs {
  /** The base64url `challenge` returned by `assertionOptions()`/`assertionForChallenge()`. */
  expectedChallenge: string;
  /** The stored credential (public key + counter) matching `resp.id`. */
  credential: WebAuthnCredential;
  config?: WebAuthnConfig;
}

/**
 * Verify a completed assertion for the general login path. A `verified: true` result here — and
 * ONLY that — is what `session.ts`'s `mintSessionFromVerifiedAssertion` mints a short-TTL session
 * from. This is NOT the D2.3 dispatcher-side approval verifier: that is an independent, Python-side
 * re-check (UV/UP/rpIdHash/counter/origin/nonce) against a pinned commit, run out-of-process by the
 * dispatcher — it never trusts this module's result for a T3 write.
 */
export async function verifyAssertion(
  resp: AuthenticationResponseJSON,
  args: VerifyAssertionArgs,
): Promise<VerifiedAuthenticationResponse> {
  const config = args.config ?? resolveWebAuthnConfig();
  return verifyAuthenticationResponse({
    response: resp,
    expectedChallenge: args.expectedChallenge,
    expectedOrigin: config.origin,
    expectedRPID: config.rpID,
    credential: args.credential,
    requireUserVerification: true,
  });
}
