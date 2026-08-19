import { describe, expect, it } from 'vitest';
import { assertAuthModeBoot, resolveAuthMode, resolveTailnetConfig, AuthModeError } from './mode.ts';

const TAILNET = { DASHBOARD_AUTH_MODE: 'tailnet', DASHBOARD_TAILNET_HOST: 'kb.tail82dd4f.ts.net' };

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
  it('reads the serve host and defaults the trusted proxy owner to root', () => {
    expect(resolveTailnetConfig(TAILNET)).toEqual({
      host: 'kb.tail82dd4f.ts.net', proxyUid: 0, operatorLogin: null,
    });
  });

  it('accepts an explicit proxy uid and operator login allowlist', () => {
    expect(resolveTailnetConfig({
      ...TAILNET, DASHBOARD_TAILNET_PROXY_UID: '1000', DASHBOARD_TAILNET_OPERATOR: 'daniel@example.com',
    })).toEqual({ host: 'kb.tail82dd4f.ts.net', proxyUid: 1000, operatorLogin: 'daniel@example.com' });
  });

  it('rejects a missing or non-hostname serve host', () => {
    expect(() => resolveTailnetConfig({ DASHBOARD_AUTH_MODE: 'tailnet' })).toThrow(AuthModeError);
    expect(() => resolveTailnetConfig({ ...TAILNET, DASHBOARD_TAILNET_HOST: 'https://kb.ts.net' })).toThrow(AuthModeError);
    expect(() => resolveTailnetConfig({ ...TAILNET, DASHBOARD_TAILNET_HOST: 'kb.ts.net/path' })).toThrow(AuthModeError);
  });

  it('rejects a non-integer or negative proxy uid', () => {
    expect(() => resolveTailnetConfig({ ...TAILNET, DASHBOARD_TAILNET_PROXY_UID: 'root' })).toThrow(AuthModeError);
    expect(() => resolveTailnetConfig({ ...TAILNET, DASHBOARD_TAILNET_PROXY_UID: '-1' })).toThrow(AuthModeError);
  });
});

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
      env: { DASHBOARD_AUTH_MODE: 'tailnet' }, bindHost: '127.0.0.1', platform: 'linux',
    })).toThrow(AuthModeError);
  });

  it('REFUSES to start on an unknown mode in any case', () => {
    expect(() => assertAuthModeBoot({ env: { DASHBOARD_AUTH_MODE: 'x' }, bindHost: '127.0.0.1', platform: 'linux' }))
      .toThrow(AuthModeError);
  });

  it('SECURITY: REFUSES to start when a retired WebAuthn env is still present in tailnet mode', () => {
    // Defense in depth beyond the python ExecStartPre closed set: if both were set, a passkey unlock
    // could flip the latch source tailnet->passkey and re-open the two historical repair paths.
    for (const stale of ['DASHBOARD_RP_ORIGIN', 'DASHBOARD_WEBAUTHN_CREDENTIALS']) {
      expect(() => assertAuthModeBoot({
        env: { ...TAILNET, [stale]: 'x' }, bindHost: '127.0.0.1', platform: 'linux',
      })).toThrow(new RegExp(stale));
    }
  });

  it('leaves a retired WebAuthn env untouched in win32-desktop mode (it is that mode\'s own config)', () => {
    expect(assertAuthModeBoot({
      env: { DASHBOARD_RP_ORIGIN: 'https://x.ts.net' }, bindHost: '127.0.0.1', platform: 'linux',
    })).toBe('win32-desktop');
  });
});
