import { describe, expect, it } from 'vitest';

import {
  buildChildEnv,
  DEFAULT_ENV_ALLOWLIST,
  DENIED_ENV_FRAGMENTS,
  isDeniedEnvName,
} from './childEnv.ts';

describe('child environment credential backstop', () => {
  it.each(DENIED_ENV_FRAGMENTS)('denies the %s fragment case-insensitively', (fragment) => {
    expect(isDeniedEnvName(`prefix_${fragment.toLocaleLowerCase('en-US')}_suffix`)).toBe(true);
    const denied = `prefix_${fragment}_suffix`;
    expect(buildChildEnv({ [denied]: 'blocked', SAFE_VALUE: 'kept' }, [denied, 'SAFE_VALUE']))
      .toEqual({ SAFE_VALUE: 'kept' });
  });

  it('copies only named allowlist entries even when the parent has unrelated values', () => {
    const parent = Object.fromEntries(DEFAULT_ENV_ALLOWLIST.map((name) => [name, `value:${name}`]));
    Object.assign(parent, {
      PROVIDER_SESSION: 'blocked',
      RANDOM_VALUE: 'blocked',
      PATH_API_KEY_BACKUP: 'blocked',
    });
    const result = buildChildEnv(parent);
    expect(result).toEqual(Object.fromEntries(DEFAULT_ENV_ALLOWLIST.map((name) => [name, `value:${name}`])));
    expect(result).not.toHaveProperty('PROVIDER_SESSION');
    expect(result).not.toHaveProperty('RANDOM_VALUE');
    expect(result).not.toHaveProperty('PATH_API_KEY_BACKUP');
  });

  // Absorbed from the deleted `pty/host.test.ts` — the subject was always `childEnv.ts`; `host.ts` only
  // re-exported it. A terminal opened by the daemon can therefore never `git push` with the fleet's
  // stored credential nor read the Claude Code OAuth token out of its own environment.
  it('copies allowlisted vars and drops every credential even when present in the parent env', () => {
    const parentEnv: Record<string, string | undefined> = {
      PATH: '/usr/bin:/bin',
      SystemRoot: 'C:\\Windows',
      TERM: 'xterm-256color',
      CLAUDE_CODE_OAUTH_TOKEN: 'oauth-secret-value',
      ANTHROPIC_API_KEY: 'sk-should-not-appear',
      GITHUB_TOKEN: 'ghp_pushcredential',
      GH_TOKEN: 'gho_pushcredential',
      GIT_ASKPASS: '/path/to/askpass',
      GIT_PASSWORD: 'hunter2',
    };

    const env = buildChildEnv(parentEnv);

    expect(env.PATH).toBe('/usr/bin:/bin');
    expect(env.SystemRoot).toBe('C:\\Windows');
    expect(env.TERM).toBe('xterm-256color');

    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.GH_TOKEN).toBeUndefined();
    expect(env.GIT_ASKPASS).toBeUndefined();
    expect(env.GIT_PASSWORD).toBeUndefined();

    const serialized = JSON.stringify(env);
    expect(serialized).not.toContain('oauth-secret-value');
    expect(serialized).not.toContain('sk-should-not-appear');
    expect(serialized).not.toContain('ghp_pushcredential');
    expect(serialized).not.toContain('hunter2');
  });

  it('a credential name can never leak even if it is mistakenly added to the allowlist (denylist wins)', () => {
    const parentEnv = { PATH: '/bin', GITHUB_TOKEN: 'ghp_leak' };
    const env = buildChildEnv(parentEnv, [...DEFAULT_ENV_ALLOWLIST, 'GITHUB_TOKEN']);
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.PATH).toBe('/bin');
  });

  it('isDeniedEnvName catches exact names, substrings, and case variants', () => {
    expect(isDeniedEnvName('CLAUDE_CODE_OAUTH_TOKEN')).toBe(true);
    expect(isDeniedEnvName('github_token')).toBe(true);
    expect(isDeniedEnvName('MY_GITHUB_TOKEN')).toBe(true);
    expect(isDeniedEnvName('SomeApiKey')).toBe(true);
    expect(isDeniedEnvName('PATH')).toBe(false);
    expect(isDeniedEnvName('TERM')).toBe(false);
  });
});
