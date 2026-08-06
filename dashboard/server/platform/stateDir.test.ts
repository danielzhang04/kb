import { describe, expect, it } from 'vitest';
import { posix, win32 } from 'node:path';
import { kbStateDir } from './stateDir.ts';

describe('kbStateDir', () => {
  it('uses KB_STATE_DIR when configured', () => {
    expect(kbStateDir('kb-dashboard', {
      env: { KB_STATE_DIR: '/srv/kb-state' }, platform: 'linux', homeDir: '/home/kb',
    })).toBe(posix.join('/srv/kb-state', 'kb-dashboard'));
  });

  it('uses LOCALAPPDATA on win32', () => {
    expect(kbStateDir('kb-dashboard', {
      env: { LOCALAPPDATA: 'C:\\Users\\kb\\AppData\\Local' }, platform: 'win32', homeDir: 'C:\\Users\\kb',
    })).toBe(win32.join('C:\\Users\\kb\\AppData\\Local', 'kb-dashboard'));
  });

  it('uses the XDG state default on POSIX', () => {
    expect(kbStateDir('kb-dashboard', { env: {}, platform: 'linux', homeDir: '/home/kb' }))
      .toBe(posix.join('/home/kb', '.local', 'state', 'kb-dashboard'));
  });
});
