// P6 W3 §3.1, P6-C15: the probe layer for the five advertisement-bound `RuntimeHostCapabilities`
// fields (`connectors`, `skills`, `filesystemRoots`, `gpu`, `clis`). There is NO second capability
// composition and no advertisement-only source of truth: this overlays probed values onto the SAME
// `RuntimeHostCapabilities` object `capabilities.ts` already composes, using its closed defaults as
// the fail-closed fallback. Pure functions with injected ports (wave rule) — no timer, no `register*`.
import type { CliStatus } from '../placement/contracts.ts';
import { CLOSED_CLIS } from './capabilities.ts';
import type { RuntimeCapabilities, RuntimeHostCapabilities } from './capabilities.ts';

export type AdvertisementCapabilitySlice =
  Pick<RuntimeHostCapabilities, 'connectors' | 'skills' | 'filesystemRoots' | 'gpu' | 'clis'>;

/** Injected probes for the five advertisement-bound fields. Every probe is optional. */
export interface CapabilitySourcePorts {
  probeConnectors?(): Promise<Array<{ server: string; tools: string[] }>>;
  probeSkills?(): Promise<string[]>;
  probeFilesystemRoots?(): Promise<string[]>;
  probeGpu?(): Promise<boolean>;
  probeClis?(): Promise<{ claude: CliStatus; codex: CliStatus }>;
}

/** Absent probe or thrown probe both resolve to `closed` — a failed probe defaults CLOSED [P6-C15]. */
async function closedOnFailure<T>(probe: (() => Promise<T>) | undefined, closed: T): Promise<T> {
  if (!probe) return closed;
  try {
    return await probe();
  } catch {
    return closed;
  }
}

/**
 * Probe the five advertisement-bound capabilities. An absent or throwing probe defaults CLOSED —
 * no connectors/skills/roots, no gpu, both CLIs `missing` — exactly `runtime/capabilities.ts`'s own
 * closed defaults, so a composition that never probes stays byte-identical to one that probed and
 * found nothing.
 */
export async function probeAdvertisementCapabilities(
  ports: CapabilitySourcePorts = {},
): Promise<AdvertisementCapabilitySlice> {
  const [connectors, skills, filesystemRoots, gpu, clis] = await Promise.all([
    closedOnFailure(ports.probeConnectors, [] as Array<{ server: string; tools: string[] }>),
    closedOnFailure(ports.probeSkills, [] as string[]),
    closedOnFailure(ports.probeFilesystemRoots, [] as string[]),
    closedOnFailure(ports.probeGpu, false),
    closedOnFailure(ports.probeClis, { ...CLOSED_CLIS }),
  ]);
  return { connectors, skills, filesystemRoots, gpu, clis };
}

/** Overlay probed advertisement capabilities onto an already-composed `RuntimeHostCapabilities`. */
export async function withAdvertisementCapabilities(
  base: RuntimeHostCapabilities,
  ports: CapabilitySourcePorts = {},
): Promise<RuntimeHostCapabilities> {
  return { ...base, ...(await probeAdvertisementCapabilities(ports)) };
}

/**
 * The same overlay applied to a FULL `RuntimeCapabilities` — the composition root's shape, PTY slice
 * included — so one composed capability object serves both `/api/runtime/capabilities` and the
 * advertisement. There is still no second composition: this only replaces the five advertisement-bound
 * fields with their probed values and touches nothing else.
 */
export function overlayAdvertisementCapabilities(
  capabilities: RuntimeCapabilities,
  slice: AdvertisementCapabilitySlice,
): RuntimeCapabilities {
  // Both branches are textually identical on purpose — spreading a discriminated union loses the
  // discriminant's link to its payload, so TS must be handed one spread per already-narrowed arm. Same
  // reason `composeRuntimeCapabilities` is written this way.
  return capabilities.pty ? { ...capabilities, ...slice } : { ...capabilities, ...slice };
}
