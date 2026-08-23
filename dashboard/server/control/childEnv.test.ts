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
});
