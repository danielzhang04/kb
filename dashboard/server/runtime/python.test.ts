import { describe, expect, it } from 'vitest';
import { resolvePython } from './python.ts';

describe('resolvePython', () => {
  it('uses the Python launcher only on Windows', () => {
    expect(resolvePython('win32')).toEqual({ command: 'py', prefixArgs: ['-3'] });
  });

  it.each(['linux', 'darwin'] as const)('uses python3 on %s', (platform) => {
    expect(resolvePython(platform)).toEqual({ command: 'python3', prefixArgs: [] });
  });
});
