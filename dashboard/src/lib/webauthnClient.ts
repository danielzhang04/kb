/**
 * D2.1 — browser-facing WebAuthn client glue. A thin wrapper over `@simplewebauthn/browser`'s
 * ceremony helpers: it takes server-issued options (from `server/auth/webauthn.ts`'s
 * `registrationOptions`/`assertionOptions`/`assertionForChallenge`) and returns the browser's signed
 * response for the caller to POST onward to the matching verify endpoint. It has NO knowledge of
 * fetch/endpoints — no routes are wired yet (a later task's job) — so it stays framework-agnostic
 * and unit-testable without a network.
 *
 * The `@simplewebauthn/browser` surface is injected (mirrors the `sseClient`/`registerSw` DI seam)
 * so this is testable under the default node vitest environment without a real WebAuthn-capable
 * browser or jsdom.
 */
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser';
import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser';

/** The slice of `@simplewebauthn/browser` this module calls — injectable so tests can fake it. */
export interface WebAuthnBrowserLike {
  startRegistration(options: {
    optionsJSON: PublicKeyCredentialCreationOptionsJSON;
  }): Promise<RegistrationResponseJSON>;
  startAuthentication(options: {
    optionsJSON: PublicKeyCredentialRequestOptionsJSON;
  }): Promise<AuthenticationResponseJSON>;
  browserSupportsWebAuthn(): boolean;
}

/** The real browser implementation — used as the default so callers don't have to wire it up. */
export const realWebAuthnBrowser: WebAuthnBrowserLike = {
  startRegistration: (options) => startRegistration(options),
  startAuthentication: (options) => startAuthentication(options),
  browserSupportsWebAuthn: () => browserSupportsWebAuthn(),
};

/**
 * Run the registration ceremony against server-issued options. Rejects — never silently no-ops —
 * when the browser lacks WebAuthn support, so the caller can render a clear "no passkey support"
 * message instead of a ceremony that would otherwise hang or throw a less legible browser error.
 */
export async function performRegistration(
  optionsJSON: PublicKeyCredentialCreationOptionsJSON,
  browser: WebAuthnBrowserLike = realWebAuthnBrowser,
): Promise<RegistrationResponseJSON> {
  if (!browser.browserSupportsWebAuthn()) {
    throw new Error('this browser does not support WebAuthn');
  }
  return browser.startRegistration({ optionsJSON });
}

/**
 * Run the assertion ceremony against server-issued options — either the plain login options from
 * `assertionOptions` or the challenge-bound options from `assertionForChallenge`.
 */
export async function performAssertion(
  optionsJSON: PublicKeyCredentialRequestOptionsJSON,
  browser: WebAuthnBrowserLike = realWebAuthnBrowser,
): Promise<AuthenticationResponseJSON> {
  if (!browser.browserSupportsWebAuthn()) {
    throw new Error('this browser does not support WebAuthn');
  }
  return browser.startAuthentication({ optionsJSON });
}
