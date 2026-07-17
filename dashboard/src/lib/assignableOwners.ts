/**
 * C7.8 — client wiring for the launch owner picker.
 *
 * C7.7 gave `LaunchControls` an optional `owners` prop but nothing populated it, so in production the
 * dropdown rendered empty and no card could be assigned an owner. This closes that gap: the host fetches
 * the live roster (`/api/agents`) + routing registry (`/api/routing`) and maps them to the ASSIGNABLE
 * closed set, MIRRORING the server's `readAssignableOwners` — declared agents (`agents/<id>.md`) ∪
 * registered runtime `default_worker` ids. HONEST PREVIEW ONLY: the server (`server/write/launch.ts`)
 * re-enumerates the set from the filesystem and remains the authoritative boundary. Reuses the same
 * `fetch('/api/agents')` / `fetchRouting()` conventions as the Agents view; no new data channel.
 */
import { useEffect, useMemo, useState } from 'react';
import type { AgentRosterEntry } from '../../server/agents/roster';
import type { OwnerOption } from '../views/launchControls';
import { fetchRouting } from './routingClient';

/**
 * Project the roster + registered default_workers onto the closed set of assignable owner options.
 * `runnerBound` is the honest "a runner will claim its cards" signal: true for any registered
 * `default_worker`, else the declared agent's own `runner-bound` flag (mirrors Agents view `isRunnable`).
 * A non-declared, non-default_worker card owner is NOT assignable and is excluded. Sorted id-alphabetical.
 */
export function toAssignableOwners(roster: AgentRosterEntry[], defaultWorkers: Set<string>): OwnerOption[] {
  const byId = new Map<string, OwnerOption>();
  for (const e of roster) {
    if (e.declared) byId.set(e.id, { id: e.id, runnerBound: e.runnerBound || defaultWorkers.has(e.id) });
  }
  for (const id of defaultWorkers) {
    if (!byId.has(id)) byId.set(id, { id, runnerBound: true });
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** Pull every runtime's non-empty `default_worker` id out of a routing snapshot's registry. */
function defaultWorkersFrom(runtimes: Record<string, { default_worker: string | null }>): Set<string> {
  return new Set(
    Object.values(runtimes)
      .map((rt) => rt.default_worker)
      .filter((w): w is string => typeof w === 'string' && w !== ''),
  );
}

/**
 * Fetch the roster + routing registry and derive the assignable owner options for the launch picker.
 * Gated by `enabled` (the host's can-act state) so a signed-out board with no mint capability issues no
 * network — keeping the picker inert until a launch is actually possible. Degrades to `[]` on any
 * failure, so the picker falls back to the unowned-only default and the surface never crashes.
 */
export function useAssignableOwners(enabled: boolean): OwnerOption[] {
  const [roster, setRoster] = useState<AgentRosterEntry[]>([]);
  const [defaultWorkers, setDefaultWorkers] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetch('/api/agents')
      .then((r) => r.json() as Promise<AgentRosterEntry[]>)
      .then((d) => {
        if (!cancelled && Array.isArray(d)) setRoster(d);
      })
      .catch(() => {
        /* read-only preview: keep the unowned-only fallback */
      });
    fetchRouting()
      .then((snap) => {
        if (!cancelled) setDefaultWorkers(defaultWorkersFrom(snap.policy.runtimes));
      })
      .catch(() => {
        /* keep the empty registry fallback */
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return useMemo(() => toAssignableOwners(roster, defaultWorkers), [roster, defaultWorkers]);
}
