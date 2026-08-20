import { resolvePython } from './python.ts';
import type { PrOpener } from '../write/branch.ts';
import type { CoordinationPublication } from '../write/outbox.ts';

/** The host capabilities resolved once at daemon composition time. */
export interface RuntimeCapabilities {
  platform: NodeJS.Platform;
  python: ReturnType<typeof resolvePython>;
  pty: boolean;
  runnerTrigger: boolean;
  vibe: boolean;
  /** True only when composition has both direct publication and a concrete PR opener. */
  durablePrWrites: boolean;
  /** True only when composition resolved one readable local Claude transcript root. */
  localTranscripts: boolean;
  dashboardBridge: true;
}

export function runtimeCapabilities(
  platform: NodeJS.Platform = process.platform,
): RuntimeCapabilities {
  const windows = platform === 'win32';
  return {
    platform,
    python: resolvePython(platform),
    pty: windows,
    runnerTrigger: windows,
    vibe: windows,
    // Deployment-dependent capabilities are fail-closed until the composition root supplies the
    // actual surfaces they require. They are not host/OS guesses and never read deployment env here.
    durablePrWrites: false,
    localTranscripts: false,
    dashboardBridge: true,
  };
}

/** Add capabilities that can only be known after the daemon's real surfaces have been resolved. */
export function composeRuntimeCapabilities(
  host: RuntimeCapabilities,
  deployment: {
    coordinationPublication: CoordinationPublication;
    openPr?: PrOpener;
    transcriptRoot: string | null;
  },
): RuntimeCapabilities {
  return {
    ...host,
    durablePrWrites: deployment.coordinationPublication !== 'outbox'
      && typeof deployment.openPr === 'function',
    localTranscripts: deployment.transcriptRoot !== null,
  };
}
