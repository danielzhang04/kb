import { describe, expect, it } from 'vitest';
import { pythonInvocation } from './python.ts';

describe('pythonInvocation', () => {
  it('uses KB_PYTHON as one command with no added arguments', () => {
    expect(pythonInvocation({ env: { KB_PYTHON: 'C:\\Python 3\\python.exe -u' }, platform: 'win32' }))
      .toEqual({ command: 'C:\\Python 3\\python.exe -u', baseArgs: [] });
  });

  it('uses the transitional Python launcher default on win32', () => {
    expect(pythonInvocation({ env: {}, platform: 'win32' })).toEqual({ command: 'py', baseArgs: ['-3'] });
  });

  it('uses python3 on POSIX', () => {
    expect(pythonInvocation({ env: {}, platform: 'linux' })).toEqual({ command: 'python3', baseArgs: [] });
  });
});
