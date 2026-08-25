// P6 W3 §3.2, design:410, P6-C49: host selection over fresh advertisements, and the never-run entity
// chip's fallback [P6-C39]. Pure functions with injected ports (wave rule) — no store access, no
// `register*` call. `select()` is the launch-time decision W6 wires into `launchService.ts`; it never
// creates a Run row itself when there is zero complete placement.
import type { CapabilityRequirement, HostAdvertisement, HostKind } from './contracts.ts';
import { freshMatches, match } from './match.ts';
import { isAdvertisementFresh } from './contracts.ts';
import { runtimeExecutionHost } from '../runtime/capabilities.ts';
import type { RuntimeCapabilities } from '../runtime/capabilities.ts';

/** VM wins a tie; Desktop wins whenever it is the only complete match [§3.2, design:410]. */
function preferVmOnTie(hostIds: readonly HostKind[]): HostKind {
  return hostIds.includes('vm') ? 'vm' : hostIds[0]!;
}

export interface SelectPlacementResult {
  outcome: 'placed' | 'no-complete-placement';
  hostId?: HostKind;
}

/**
 * Selection over the fresh advertisements only [§3.2]: zero complete matches ⇒
 * `no-complete-placement`; one ⇒ that host; both ⇒ VM. No partial placement occurs.
 */
export function selectPlacementHost(
  requirement: CapabilityRequirement,
  advertisements: readonly HostAdvertisement[],
  nowMs: number,
): SelectPlacementResult {
  const matches = freshMatches(requirement, advertisements, nowMs);
  if (matches.length === 0) return { outcome: 'no-complete-placement' };
  return { outcome: 'placed', hostId: preferVmOnTie(matches.map((advertisement) => advertisement.hostId)) };
}

export interface CreatedRun {
  runRef: string;
  executionHost: HostKind;
}

export interface SelectPorts {
  /** Only called when there IS a complete placement. Never called on `no-complete-placement`. */
  createRun(hostId: HostKind): Promise<CreatedRun>;
}

export type SelectResult =
  | { outcome: 'no-complete-placement' }
  | { outcome: 'placed'; hostId: HostKind; run: CreatedRun };

/**
 * The named failing test this file gates [P6-C49]: `select()` returns `no-complete-placement` and
 * creates NO Run row when zero fresh advertisements match; prefers VM on a tie; and returns Desktop
 * as the sole complete match. The refusal is terminal — no queued-until-capable state (§3.2).
 */
export async function select(
  requirement: CapabilityRequirement,
  advertisements: readonly HostAdvertisement[],
  nowMs: number,
  ports: SelectPorts,
): Promise<SelectResult> {
  const decision = selectPlacementHost(requirement, advertisements, nowMs);
  if (decision.outcome === 'no-complete-placement') return { outcome: 'no-complete-placement' };
  const run = await ports.createRun(decision.hostId!);
  return { outcome: 'placed', hostId: decision.hostId!, run };
}

export interface NeverRunProjection {
  /** `'placement'` when at least one advertisement is fresh; `'self-identity'` otherwise [P6-C39]. */
  source: 'placement' | 'self-identity';
  hostId: HostKind;
}

/**
 * The never-run entity chip's host [P6-C39, design:159,410]. When at least one advertisement is
 * fresh, project the placement the tie-break rule would produce (falling back to any fresh host when
 * none is a complete match, so the preview chip is never blank). When NO advertisement is fresh at
 * all, there is nothing to project from, so the chip falls back — SERVER-SIDE — to the serving
 * daemon's own composed capability host, `runtimeExecutionHost` (unchanged, kept precisely for this),
 * and is labelled self-identity, never a placement claim.
 */
export function projectNeverRunHost(
  requirement: CapabilityRequirement,
  advertisements: readonly HostAdvertisement[],
  nowMs: number,
  selfCapabilities: RuntimeCapabilities,
): NeverRunProjection {
  const fresh = advertisements.filter((advertisement) => isAdvertisementFresh(advertisement.reportedAt, nowMs));
  if (fresh.length === 0) {
    return { source: 'self-identity', hostId: runtimeExecutionHost(selfCapabilities) };
  }
  const matches = fresh.filter((advertisement) => match(requirement, advertisement));
  const candidates = matches.length > 0 ? matches : fresh;
  return { source: 'placement', hostId: preferVmOnTie(candidates.map((advertisement) => advertisement.hostId)) };
}
