/**
 * D3.1 MED mitigation — M7: the browser passkey-ceremony plumbing for a fleet-PTY open. Hermetic (fake
 * `@simplewebauthn/browser` + fake relay). Proves: a `challenge` message drives the ceremony with the
 * pinned rpId + UV=required and relays a mapped `assertion`; non-challenge messages fall through; a
 * ceremony failure relays NOTHING (fail-closed) and surfaces via onError. The real touch is M8 (manual).
 */
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticationResponseJSON } from '@simplewebauthn/browser';
import {
  collectPtyAssertion,
  handlePtyChallenge,
  parseControlMessage,
} from './ptyAssertionClient';
import type { PtyAssertion, PtyControlMessage } from './ptyAssertionClient';
import type { WebAuthnBrowserLike } from './webauthnClient';

const CHALLENGE = 'WyJrYi1wdHktb3BlbiIsImRHVnpkQzF1YjI1alpRIl0';
const RP_ID = 'dash.tailnet-abc.ts.net';

const ASSERT_RESPONSE = {
  id: 'cred-1',
  rawId: 'cred-1',
  type: 'public-key',
  clientExtensionResults: {},
  response: {
    authenticatorData: 'YXV0aA',
    clientDataJSON: 'Y2RhdGE',
    signature: 'c2ln',
    userHandle: 'dXNlcg',
  },
} as unknown as AuthenticationResponseJSON;

function fakeBrowser(): WebAuthnBrowserLike {
  return {
    browserSupportsWebAuthn: () => true,
    startRegistration: vi.fn(),
    startAuthentication: vi.fn(async () => ASSERT_RESPONSE),
  };
}

describe('collectPtyAssertion', () => {
  it('runs the ceremony with the host challenge, pinned rpId, and UV=required; maps the response', async () => {
    const browser = fakeBrowser();
    const out = await collectPtyAssertion(CHALLENGE, RP_ID, browser);
    expect(browser.startAuthentication).toHaveBeenCalledWith({
      optionsJSON: expect.objectContaining({
        challenge: CHALLENGE,
        rpId: RP_ID,
        userVerification: 'required',
      }),
    });
    expect(out).toEqual({
      credentialId: 'cred-1',
      authenticatorData: 'YXV0aA',
      clientDataJSON: 'Y2RhdGE',
      signature: 'c2ln',
    });
  });
});

describe('handlePtyChallenge — message plumbing', () => {
  it('on a challenge message, collects an assertion and relays it back', async () => {
    const sent: PtyControlMessage[] = [];
    const assertion: PtyAssertion = {
      credentialId: 'cred-1',
      authenticatorData: 'YXV0aA',
      clientDataJSON: 'Y2RhdGE',
      signature: 'c2ln',
    };
    const collect = vi.fn(async () => assertion);
    const consumed = await handlePtyChallenge(
      { type: 'challenge', challenge: CHALLENGE },
      { rpId: RP_ID, send: (m) => sent.push(m), collect },
    );
    expect(consumed).toBe(true);
    expect(collect).toHaveBeenCalledWith(CHALLENGE, RP_ID);
    expect(sent).toEqual([{ type: 'assertion', assertion }]);
  });

  it('accepts a challenge delivered as a JSON string', async () => {
    const sent: PtyControlMessage[] = [];
    const collect = vi.fn(async () => ({
      credentialId: 'c',
      authenticatorData: 'a',
      clientDataJSON: 'd',
      signature: 's',
    }));
    const consumed = await handlePtyChallenge(
      JSON.stringify({ type: 'challenge', challenge: CHALLENGE }),
      { rpId: RP_ID, send: (m) => sent.push(m), collect },
    );
    expect(consumed).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe('assertion');
  });

  it('ignores non-challenge / malformed messages (returns false, relays nothing)', async () => {
    const sent: PtyControlMessage[] = [];
    const collect = vi.fn();
    for (const raw of ['plain terminal data', '{"type":"data"}', '{"nope":1}', 42, null]) {
      expect(await handlePtyChallenge(raw, { rpId: RP_ID, send: (m) => sent.push(m), collect })).toBe(false);
    }
    expect(collect).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });

  it('FAIL-CLOSED: a ceremony failure relays NOTHING and surfaces via onError', async () => {
    const sent: PtyControlMessage[] = [];
    const onError = vi.fn();
    const collect = vi.fn(async () => {
      throw new Error('user declined the passkey');
    });
    const consumed = await handlePtyChallenge(
      { type: 'challenge', challenge: CHALLENGE },
      { rpId: RP_ID, send: (m) => sent.push(m), collect, onError },
    );
    expect(consumed).toBe(true); // the challenge WAS consumed
    expect(sent).toHaveLength(0); // but no (bogus) assertion was relayed
    expect(onError).toHaveBeenCalledOnce();
  });
});

describe('parseControlMessage', () => {
  it('round-trips a well-formed assertion message and rejects a partial one', () => {
    const good = {
      type: 'assertion' as const,
      assertion: { credentialId: 'c', authenticatorData: 'a', clientDataJSON: 'd', signature: 's' },
    };
    expect(parseControlMessage(JSON.stringify(good))).toEqual(good);
    // A missing signature field is rejected (no partial assertion is ever accepted).
    expect(parseControlMessage({ type: 'assertion', assertion: { credentialId: 'c' } })).toBeNull();
  });
});
