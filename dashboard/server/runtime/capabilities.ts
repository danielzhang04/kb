import { resolvePython } from './python.ts';
import type { PrOpener } from '../write/branch.ts';
import type { CoordinationPublication } from '../write/outbox.ts';
import type { PtyCapabilityProbe, PublicPtyCapability } from '../pty/contracts.ts';
import { probeWindowsPty, toPublicPtyCapability, type WindowsPtyProbeOptions } from '../pty/probe.ts';
import { resolveExecutionHost } from '../entities/project.ts';
import type { HostKind } from '../control/p2Contracts.ts';

/** Everything the host answers without touching the PTY stack (Health reads only this slice). */
export interface RuntimeHostCapabilities {
  platform: NodeJS.Platform;
  python: ReturnType<typeof resolvePython>;
  runnerTrigger: boolean;
  vibe: boolean;
  /** True only when composition has both direct publication and a concrete PR opener. */
  durablePrWrites: boolean;
  /** True only when composition resolved one readable local Claude transcript root. */
  localTranscripts: boolean;
  dashboardBridge: true;
}

/**
 * The public capability payload: the unchanged non-PTY host capabilities composed beside the P3 §3
 * closed PTY slice. There is no OS-derived PTY boolean: `pty` is the discriminant of the closed
 * capability, so `pty === true` narrows to the advertised host/launchers/roots and `pty === false`
 * always carries a closed diagnostic reason.
 */
export type RuntimeCapabilities = RuntimeHostCapabilities & PublicPtyCapability;

export function runtimeHostCapabilities(
  platform: NodeJS.Platform = process.platform,
): RuntimeHostCapabilities {
  const windows = platform === 'win32';
  return {
    platform,
    python: resolvePython(platform),
    runnerTrigger: windows,
    vibe: windows,
    // Deployment-dependent capabilities are fail-closed until the composition root supplies the
    // actual surfaces they require. They are not host/OS guesses and never read deployment env here.
    durablePrWrites: false,
    localTranscripts: false,
    dashboardBridge: true,
  };
}

/**
 * The one representation of "no host was ever checked". A composition that never probed must not
 * stamp a check time it did not perform, so it publishes this sentinel; the browser decoder accepts
 * it on the closed branch only, and the client's own unavailable sentinel uses the same value.
 */
export const NEVER_CHECKED_AT = '';

/**
 * The fail-closed PTY slice used by any composition that has not probed a host. The platform switch
 * decides only WHICH host stack went unresolved — never whether a terminal exists, which is always
 * `false` here — and `checkedAt` defaults to the never-checked sentinel rather than a fabricated
 * timestamp. Callers that actually attempted a probe pass the real attempt time.
 */
export function unavailablePtyCapability(
  platform: NodeJS.Platform,
  checkedAt: string = NEVER_CHECKED_AT,
): PublicPtyCapability {
  return {
    pty: false,
    diagnostic: {
      reason: platform === 'win32' ? 'node-pty-unavailable' : 'broker-unavailable',
      detail: null,
      checkedAt,
    },
  };
}

/**
 * Probe the real host exactly once, at composition. On Windows this is W1's closed local probe over
 * the actual node-pty/launcher/root policy; off Windows the Linux broker probe is W6.2's, so until it
 * lands composition publishes the closed `broker-unavailable` refusal rather than any boolean.
 */
export async function probePublicPtyCapability(options: {
  platform?: NodeJS.Platform;
  epochId: string;
  now?: () => Date;
  probeWindowsHost?: (probeOptions: WindowsPtyProbeOptions) => Promise<PtyCapabilityProbe>;
}): Promise<PublicPtyCapability> {
  const platform = options.platform ?? process.platform;
  const now = options.now ?? (() => new Date());
  const checkedAt = now().toISOString();
  if (platform !== 'win32') {
    return { pty: false, diagnostic: { reason: 'broker-unavailable', detail: null, checkedAt } };
  }
  try {
    const probe = await (options.probeWindowsHost ?? probeWindowsPty)({ epochId: options.epochId, now });
    return toPublicPtyCapability(probe);
  } catch {
    // A host probe that throws is a host that cannot be advertised. W6.1 moved a native-module load
    // into composition, so a throw here must degrade to "no terminal", never abort the daemon.
    return unavailablePtyCapability(platform, checkedAt);
  }
}

/**
 * The one host answer for a composition. An advertised terminal names its own host; a composition
 * with no terminal falls back to the single platform->host mapper the entity projections already
 * own. No consumer re-derives a host from `process.platform`.
 */
export function runtimeExecutionHost(capabilities: RuntimeCapabilities): HostKind {
  return capabilities.pty
    ? capabilities.host
    : resolveExecutionHost(capabilities.platform === 'win32' ? 'desktop' : 'cloud');
}

export function runtimeCapabilities(
  platform: NodeJS.Platform = process.platform,
  pty: PublicPtyCapability = unavailablePtyCapability(platform),
): RuntimeCapabilities {
  const base = runtimeHostCapabilities(platform);
  return pty.pty
    ? {
      ...base,
      pty: true,
      host: pty.host,
      launchers: [...pty.launchers],
      roots: [...pty.roots],
      checkedAt: pty.checkedAt,
    }
    : { ...base, pty: false, diagnostic: pty.diagnostic };
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
  const durablePrWrites = deployment.coordinationPublication !== 'outbox'
    && typeof deployment.openPr === 'function';
  const localTranscripts = deployment.transcriptRoot !== null;
  // Both branches are textually identical on purpose: spreading a discriminated union loses the
  // discriminant's link to its payload, so TS must be handed one spread per already-narrowed arm.
  return host.pty
    ? { ...host, durablePrWrites, localTranscripts }
    : { ...host, durablePrWrites, localTranscripts };
}
