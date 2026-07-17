/**
 * D2.1 — SimpleWebAuthn registration/assertion transport (RP-ID pinned to the full ts.net host,
 * §7 Q4; never the bare `ts.net` suffix — a bare-suffix RP-ID would let ANY ts.net box on the
 * tailnet claim credentials scoped to this one). This is the transport only: the custom
 * challenge-binding + independent dispatcher verify is D2.3 (`scripts/webauthn_verify.py`).
 */
import { describe, expect, it } from 'vitest';
import {
  assertionForChallenge,
  assertionOptions,
  registrationOptions,
  resolveWebAuthnConfig,
} from './webauthn';

const RP_ORIGIN = 'https://box-1234.tailnet-abcd.ts.net';

describe('resolveWebAuthnConfig', () => {
  it('is fail-closed: throws when DASHBOARD_RP_ORIGIN is not configured', () => {
    expect(() => resolveWebAuthnConfig({})).toThrow();
  });

  it('derives rpID as the full host (no scheme/port) from DASHBOARD_RP_ORIGIN', () => {
    const config = resolveWebAuthnConfig({ DASHBOARD_RP_ORIGIN: RP_ORIGIN });
    expect(config.rpID).toBe('box-1234.tailnet-abcd.ts.net');
    expect(config.origin).toBe(RP_ORIGIN);
  });
});

describe('registrationOptions', () => {
  it('pins rpID to the full ts.net host (never the bare suffix)', async () => {
    const config = resolveWebAuthnConfig({ DASHBOARD_RP_ORIGIN: RP_ORIGIN });
    const options = await registrationOptions(
      { id: 'user-1', name: 'daniel', displayName: 'Daniel' },
      config,
    );
    expect(options.rp.id).toBe('box-1234.tailnet-abcd.ts.net');
    expect(options.rp.id).not.toBe('ts.net');
  });

  it('requires user-verification (biometric, not bare presence) at registration too', async () => {
    const config = resolveWebAuthnConfig({ DASHBOARD_RP_ORIGIN: RP_ORIGIN });
    const options = await registrationOptions(
      { id: 'user-1', name: 'daniel', displayName: 'Daniel' },
      config,
    );
    expect(options.authenticatorSelection?.userVerification).toBe('required');
  });

  it('excludes already-registered credentials so the same authenticator cannot double-enroll', async () => {
    const config = resolveWebAuthnConfig({ DASHBOARD_RP_ORIGIN: RP_ORIGIN });
    const options = await registrationOptions(
      {
        id: 'user-1',
        name: 'daniel',
        displayName: 'Daniel',
        credentials: [{ id: 'cred-abc', publicKey: new Uint8Array([1, 2, 3]), counter: 0 }],
      },
      config,
    );
    expect(options.excludeCredentials?.map((c) => c.id)).toContain('cred-abc');
  });
});

describe('assertionOptions', () => {
  it('embeds the server challenge and requires userVerification', async () => {
    const config = resolveWebAuthnConfig({ DASHBOARD_RP_ORIGIN: RP_ORIGIN });
    const options = await assertionOptions({}, config);
    expect(typeof options.challenge).toBe('string');
    expect(options.challenge.length).toBeGreaterThan(0);
    expect(options.userVerification).toBe('required');
  });

  it('narrows allowCredentials to the session credentials when provided', async () => {
    const config = resolveWebAuthnConfig({ DASHBOARD_RP_ORIGIN: RP_ORIGIN });
    const options = await assertionOptions(
      { credentials: [{ id: 'cred-xyz', publicKey: new Uint8Array([9]), counter: 3 }] },
      config,
    );
    expect(options.allowCredentials?.map((c) => c.id)).toEqual(['cred-xyz']);
  });
});

describe('assertionForChallenge', () => {
  it('embeds the exact externally-supplied challenge (e.g. the D2.2 card-approval challenge)', async () => {
    const config = resolveWebAuthnConfig({ DASHBOARD_RP_ORIGIN: RP_ORIGIN });
    const externalChallenge = 'q1w2e3r4-fixed-challenge-value';
    const options = await assertionForChallenge(externalChallenge, {}, config);
    // SimpleWebAuthn treats a string `challenge` as opaque UTF-8 text and re-encodes ITS BYTES as
    // base64url for the wire (`options.challenge` is base64url(UTF8(input)), not the input string
    // verbatim) — decoding it back to UTF-8 must round-trip to the exact externally-supplied value,
    // which is what matters: the browser signs over these bytes, and D2.3's verifier recomputes the
    // same decode.
    const decoded = Buffer.from(options.challenge, 'base64url').toString('utf-8');
    expect(decoded).toBe(externalChallenge);
    expect(options.userVerification).toBe('required');
  });
});
