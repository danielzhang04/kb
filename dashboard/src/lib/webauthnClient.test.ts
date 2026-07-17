import { describe, expect, it, vi } from 'vitest';
import { performAssertion, performRegistration } from './webauthnClient';
import type { WebAuthnBrowserLike } from './webauthnClient';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser';

const REG_OPTIONS = {} as PublicKeyCredentialCreationOptionsJSON;
const ASSERT_OPTIONS = {} as PublicKeyCredentialRequestOptionsJSON;
const REG_RESPONSE = { id: 'cred-1' } as unknown as RegistrationResponseJSON;
const ASSERT_RESPONSE = { id: 'cred-1' } as unknown as AuthenticationResponseJSON;

function fakeBrowser(supported: boolean): WebAuthnBrowserLike {
  return {
    browserSupportsWebAuthn: () => supported,
    startRegistration: vi.fn(async () => REG_RESPONSE),
    startAuthentication: vi.fn(async () => ASSERT_RESPONSE),
  };
}

describe('performRegistration', () => {
  it('delegates to the injected browser and returns the signed response', async () => {
    const browser = fakeBrowser(true);
    const resp = await performRegistration(REG_OPTIONS, browser);
    expect(browser.startRegistration).toHaveBeenCalledWith({ optionsJSON: REG_OPTIONS });
    expect(resp).toEqual(REG_RESPONSE);
  });

  it('rejects without calling the browser when WebAuthn is unsupported', async () => {
    const browser = fakeBrowser(false);
    await expect(performRegistration(REG_OPTIONS, browser)).rejects.toThrow(/WebAuthn/i);
    expect(browser.startRegistration).not.toHaveBeenCalled();
  });
});

describe('performAssertion', () => {
  it('delegates to the injected browser and returns the signed response', async () => {
    const browser = fakeBrowser(true);
    const resp = await performAssertion(ASSERT_OPTIONS, browser);
    expect(browser.startAuthentication).toHaveBeenCalledWith({ optionsJSON: ASSERT_OPTIONS });
    expect(resp).toEqual(ASSERT_RESPONSE);
  });

  it('rejects without calling the browser when WebAuthn is unsupported', async () => {
    const browser = fakeBrowser(false);
    await expect(performAssertion(ASSERT_OPTIONS, browser)).rejects.toThrow(/WebAuthn/i);
    expect(browser.startAuthentication).not.toHaveBeenCalled();
  });
});
