import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';

export interface StateDirOptions {
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  homeDir?: string;
}

/** Resolve an application state directory outside the repository. */
export function kbStateDir(name: string, options: StateDirOptions = {}): string {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? homedir();
  const platform = options.platform ?? process.platform;
  const path = platform === 'win32' ? win32 : posix;
  const configured = env.KB_STATE_DIR?.trim();
  if (configured) return path.join(configured, name);

  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA?.trim() || path.join(homeDir, 'AppData', 'Local');
    return path.join(localAppData, name);
  }
  return path.join(homeDir, '.local', 'state', name);
}
