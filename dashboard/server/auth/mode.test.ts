import { describe, expect, it } from 'vitest';
import { assertAuthModeBoot, resolveAuthMode, resolveNodeProxyUid, resolveTailnetConfig, AuthModeError } from './mode.ts';

const TAILNET = {
  DASHBOARD_AUTH_MODE: 'tailnet',
  DASHBOARD_TAILNET_HOST: 'kb.command.ts.net',
  DASHBOARD_TAILNET_OPERATOR: 'daniel.zhang.t1@gmail.com',
  // P6 §3.3: the attested node-proxy uid, distinct from 0 and from the tailnet (root) proxy uid.
  DASHBOARD_NODE_PROXY_UID: '1001',
};

describe('resolveAuthMode', () => {
  it('defaults to the win32 desktop mode when unset — today behaviour is untouched', () => {
    expect(resolveAuthMode({})).toBe('win32-desktop');
    expect(resolveAuthMode({ DASHBOARD_AUTH_MODE: '' })).toBe('win32-desktop');
  });

  it('resolves both explicit modes', () => {
    expect(resolveAuthMode({ DASHBOARD_AUTH_MODE: 'tailnet' })).toBe('tailnet');
    expect(resolveAuthMode({ DASHBOARD_AUTH_MODE: ' win32-desktop ' })).toBe('win32-desktop');
  });

  it('THROWS on an unknown mode rather than silently falling back', () => {
    expect(() => resolveAuthMode({ DASHBOARD_AUTH_MODE: 'tailscale' })).toThrow(AuthModeError);
  });
});

describe('resolveTailnetConfig', () => {
  it('reads the serve host + required operator and defaults the trusted proxy owner to root', () => {
    expect(resolveTailnetConfig(TAILNET)).toEqual({
      host: 'kb.command.ts.net', proxyUid: 0, operatorLogin: 'daniel.zhang.t1@gmail.com',
    });
  });

  it('accepts an explicit proxy uid', () => {
    expect(resolveTailnetConfig({ ...TAILNET, DASHBOARD_TAILNET_PROXY_UID: '1000' }))
      .toEqual({ host: 'kb.command.ts.net', proxyUid: 1000, operatorLogin: 'daniel.zhang.t1@gmail.com' });
  });

  it('SECURITY: REJECTS a missing operator — tailnet membership must not be operator-by-default', () => {
    const { DASHBOARD_TAILNET_OPERATOR: _omit, ...noOperator } = TAILNET;
    expect(() => resolveTailnetConfig(noOperator)).toThrow(AuthModeError);
    expect(() => resolveTailnetConfig({ ...TAILNET, DASHBOARD_TAILNET_OPERATOR: '  ' })).toThrow(AuthModeError);
  });

  it('rejects a missing or non-hostname serve host', () => {
    expect(() => resolveTailnetConfig({ DASHBOARD_AUTH_MODE: 'tailnet', DASHBOARD_TAILNET_OPERATOR: 'x@y' })).toThrow(AuthModeError);
    expect(() => resolveTailnetConfig({ ...TAILNET, DASHBOARD_TAILNET_HOST: 'https://kb.ts.net' })).toThrow(AuthModeError);
    expect(() => resolveTailnetConfig({ ...TAILNET, DASHBOARD_TAILNET_HOST: 'kb.ts.net/path' })).toThrow(AuthModeError);
  });

  it('rejects a non-integer or negative proxy uid', () => {
    expect(() => resolveTailnetConfig({ ...TAILNET, DASHBOARD_TAILNET_PROXY_UID: 'root' })).toThrow(AuthModeError);
    expect(() => resolveTailnetConfig({ ...TAILNET, DASHBOARD_TAILNET_PROXY_UID: '-1' })).toThrow(AuthModeError);
  });
});

/** W47: a tailnet env carrying the re-admitted, correctly-pinned passkey pair. */
const PASSKEY_TAILNET = {
  ...TAILNET,
  DASHBOARD_RP_ORIGIN: 'https://kb.command.ts.net',
  DASHBOARD_WEBAUTHN_CREDENTIALS: '[{"id":"cred-1","publicKey":"AQID","counter":0}]',
};

describe('assertAuthModeBoot', () => {
  it('is a no-op in win32 desktop mode on any platform or bind host', () => {
    expect(assertAuthModeBoot({ env: {}, bindHost: '0.0.0.0', platform: 'win32' })).toBe('win32-desktop');
  });

  it('accepts a loopback bind on Linux in tailnet mode', () => {
    for (const bindHost of ['127.0.0.1', '::1', 'localhost']) {
      expect(assertAuthModeBoot({ env: TAILNET, bindHost, platform: 'linux' })).toBe('tailnet');
    }
  });

  it('REFUSES to start when the listener would be exposed beyond loopback', () => {
    expect(() => assertAuthModeBoot({ env: TAILNET, bindHost: '0.0.0.0', platform: 'linux' })).toThrow(/loopback/);
    expect(() => assertAuthModeBoot({ env: TAILNET, bindHost: '100.89.73.118', platform: 'linux' })).toThrow(/loopback/);
  });

  it('REFUSES to start in tailnet mode off Linux — the peer proof reads /proc', () => {
    expect(() => assertAuthModeBoot({ env: TAILNET, bindHost: '127.0.0.1', platform: 'win32' })).toThrow(/Linux/);
  });

  it('REFUSES to start when the serve host is unconfigured', () => {
    expect(() => assertAuthModeBoot({
      env: { DASHBOARD_AUTH_MODE: 'tailnet', DASHBOARD_TAILNET_OPERATOR: 'x@y' }, bindHost: '127.0.0.1', platform: 'linux',
    })).toThrow(AuthModeError);
  });

  it('SECURITY: REFUSES to start when the operator is unconfigured', () => {
    const { DASHBOARD_TAILNET_OPERATOR: _omit, ...noOperator } = TAILNET;
    expect(() => assertAuthModeBoot({ env: noOperator, bindHost: '127.0.0.1', platform: 'linux' })).toThrow(AuthModeError);
  });

  it('REFUSES to start on an unknown mode in any case', () => {
    expect(() => assertAuthModeBoot({ env: { DASHBOARD_AUTH_MODE: 'x' }, bindHost: '127.0.0.1', platform: 'linux' }))
      .toThrow(AuthModeError);
  });

  // W47 - the CONSTRAINED tailnet passkey channel replaces the blanket retirement this case used to
  // assert. RED ON REVERT: restore `RETIRED_IN_TAILNET` and the three admitting cases below fail (a
  // valid pair, and the origin-only enrolment posture, would be refused); drop the constraint entirely
  // and the mismatched-origin, credentials-only and zero-credential cases fail.
  it('W47: BOTH ABSENT stays legal - the default VM posture is unchanged', () => {
    expect(assertAuthModeBoot({ env: TAILNET, bindHost: '127.0.0.1', platform: 'linux' })).toBe('tailnet');
  });

  it('W47: admits a valid RP-origin + credential PAIR in tailnet mode', () => {
    expect(assertAuthModeBoot({ env: PASSKEY_TAILNET, bindHost: '127.0.0.1', platform: 'linux' })).toBe('tailnet');
  });

  it('W47 SECURITY: REFUSES a DASHBOARD_RP_ORIGIN that is not exactly https://<tailnet host>', () => {
    for (const wrong of [
      'https://evil.ts.net', 'http://kb.command.ts.net', 'https://kb.command.ts.net/',
      'https://kb.command.ts.net:443', 'HTTPS://kb.command.ts.net',
    ]) {
      expect(() => assertAuthModeBoot({
        env: { ...PASSKEY_TAILNET, DASHBOARD_RP_ORIGIN: wrong }, bindHost: '127.0.0.1', platform: 'linux',
      })).toThrow(/DASHBOARD_RP_ORIGIN to equal https:\/\/kb\.command\.ts\.net exactly/);
    }
  });

  it('W47: RP ORIGIN ALONE is legal - the enrolment posture, which grants nothing', () => {
    // The register ceremony needs an RP origin and is the only way to obtain a credential, so this
    // state must boot. It confers no authority: the store is empty, so ceremonyAvailable is false and
    // every T3 challenge answers 403 (proved in auth/routes.test.ts and control/routes.test.ts).
    const { DASHBOARD_WEBAUTHN_CREDENTIALS: _creds, ...originOnly } = PASSKEY_TAILNET;
    expect(assertAuthModeBoot({ env: originOnly, bindHost: '127.0.0.1', platform: 'linux' })).toBe('tailnet');
  });

  it('W47 SECURITY: REFUSES credentials WITHOUT an RP origin - a store that can pin no RP-ID', () => {
    const { DASHBOARD_RP_ORIGIN: _origin, ...credsOnly } = PASSKEY_TAILNET;
    expect(() => assertAuthModeBoot({ env: credsOnly, bindHost: '127.0.0.1', platform: 'linux' }))
      .toThrow(/requires DASHBOARD_RP_ORIGIN whenever DASHBOARD_WEBAUTHN_CREDENTIALS is set/);
  });

  it('W47 SECURITY: the origin-equality rule applies to an origin-ONLY env too', () => {
    const { DASHBOARD_WEBAUTHN_CREDENTIALS: _creds, ...originOnly } = PASSKEY_TAILNET;
    expect(() => assertAuthModeBoot({
      env: { ...originOnly, DASHBOARD_RP_ORIGIN: 'https://evil.ts.net' }, bindHost: '127.0.0.1', platform: 'linux',
    })).toThrow(/to equal https:\/\/kb\.command\.ts\.net exactly/);
  });

  it('W47 SECURITY: REFUSES a credentials value that resolves to ZERO credentials', () => {
    // Exactly the values `resolveCredentials()` maps to []: a daemon that "has" the channel but could
    // never verify an assertion must not boot claiming it.
    for (const bad of ['[]', 'not-json', '{"id":"a","publicKey":"b"}', '[{"id":"a"}]', '[null]']) {
      expect(() => assertAuthModeBoot({
        env: { ...PASSKEY_TAILNET, DASHBOARD_WEBAUTHN_CREDENTIALS: bad }, bindHost: '127.0.0.1', platform: 'linux',
      })).toThrow(AuthModeError);
    }
  });

  it('W47: the constraint is tailnet-only - win32-desktop owns these two vars outright', () => {
    expect(assertAuthModeBoot({
      env: { DASHBOARD_RP_ORIGIN: 'https://x.ts.net' }, bindHost: '127.0.0.1', platform: 'linux',
    })).toBe('win32-desktop');
  });

  // P6 §3.3 [P6-C27, P6-C60, P6-C73] — the whole node-identity fix is the distinctness rule
  //   DASHBOARD_NODE_PROXY_UID ∉ {0, DASHBOARD_TAILNET_PROXY_UID}, tailnet uid pinned to 0.
  it('SECURITY: REFUSES to boot when DASHBOARD_NODE_PROXY_UID is 0 (root serve would satisfy the node peer check)', () => {
    expect(() => assertAuthModeBoot({
      env: { ...TAILNET, DASHBOARD_NODE_PROXY_UID: '0' }, bindHost: '127.0.0.1', platform: 'linux',
    })).toThrow(/DASHBOARD_NODE_PROXY_UID/);
  });

  it('SECURITY: REFUSES to boot when DASHBOARD_TAILNET_PROXY_UID is anything but 0', () => {
    // Node uid stays distinct (1001 vs 1000), so the ONLY failing condition is the tailnet uid ≠ 0 —
    // this is the second of the two named refusal tests, not the equal-uids case [P6-C73].
    expect(() => assertAuthModeBoot({
      env: { ...TAILNET, DASHBOARD_TAILNET_PROXY_UID: '1000' }, bindHost: '127.0.0.1', platform: 'linux',
    })).toThrow(/DASHBOARD_TAILNET_PROXY_UID=0/);
  });

  it('SECURITY: REFUSES to boot when the node-proxy uid env is absent (never a silent 0 default)', () => {
    const { DASHBOARD_NODE_PROXY_UID: _omit, ...noNode } = TAILNET;
    expect(() => assertAuthModeBoot({ env: noNode, bindHost: '127.0.0.1', platform: 'linux' }))
      .toThrow(AuthModeError);
  });

  it('accepts a boot with a valid distinct node-proxy uid and a tailnet uid of 0', () => {
    expect(assertAuthModeBoot({
      env: { ...TAILNET, DASHBOARD_TAILNET_PROXY_UID: '0', DASHBOARD_NODE_PROXY_UID: '1001' },
      bindHost: '127.0.0.1', platform: 'linux',
    })).toBe('tailnet');
  });
});

describe('resolveNodeProxyUid', () => {
  it('reads the required node-proxy uid', () => {
    expect(resolveNodeProxyUid({ DASHBOARD_NODE_PROXY_UID: '1001' })).toBe(1001);
  });

  it('SECURITY: REJECTS an absent node-proxy uid — there is no 0 default', () => {
    expect(() => resolveNodeProxyUid({})).toThrow(AuthModeError);
    expect(() => resolveNodeProxyUid({ DASHBOARD_NODE_PROXY_UID: '  ' })).toThrow(AuthModeError);
  });

  it('rejects a non-integer or negative node-proxy uid', () => {
    expect(() => resolveNodeProxyUid({ DASHBOARD_NODE_PROXY_UID: 'root' })).toThrow(AuthModeError);
    expect(() => resolveNodeProxyUid({ DASHBOARD_NODE_PROXY_UID: '-1' })).toThrow(AuthModeError);
  });
});
