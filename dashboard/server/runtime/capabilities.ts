import { resolvePython } from './python.ts';

/** The host capabilities resolved once at daemon composition time. */
export interface RuntimeCapabilities {
  platform: NodeJS.Platform;
  python: ReturnType<typeof resolvePython>;
  pty: boolean;
  runnerTrigger: boolean;
  vibe: boolean;
  dashboardBridge: true;
}

export function runtimeCapabilities(platform: NodeJS.Platform = process.platform): RuntimeCapabilities {
  const windows = platform === 'win32';
  return {
    platform,
    python: resolvePython(platform),
    pty: windows,
    runnerTrigger: windows,
    vibe: windows,
    dashboardBridge: true,
  };
}
