/**
 * Shared fleet-data hook for the entity hover-flyouts (U4). All flyouts read from ONE cached snapshot of
 * `/api/index` + `/api/registry` rather than each firing its own request on hover — a module-level cache
 * with in-flight de-duping means N mounted flyout hosts trigger at most one GET per source (no
 * stampede). It refreshes on each hub SSE tick, reusing the same SSE pattern as Home/Approvals.
 *
 * Read-only and empty-safe: a failed fetch resolves to the empty scaffold so a flyout degrades to
 * nothing, never an error.
 */
import { useEffect, useState } from 'react';
import type { PlaneAIndex } from '../../server/planeA/indexer';
import { useSse } from '../lib/sseClient';
import type { RegistrySnapshot } from './flyoutModel';

export const EMPTY_INDEX: PlaneAIndex = {
  cards: {},
  ledgers: {
    dispatch: { count: 0, cards: 0, byProject: {} },
    cost: { stepCount: 0, perModelSteps: {}, modelMix: {}, usdPresent: false },
    grades: { count: 0, rows: [] },
    activity: { count: 0, rows: [] },
  },
  orgStates: [],
};

const EMPTY_REGISTRY: RegistrySnapshot = {};

let indexCache: PlaneAIndex | null = null;
let indexInFlight: Promise<PlaneAIndex> | null = null;
let registryCache: RegistrySnapshot | null = null;
let registryInFlight: Promise<RegistrySnapshot> | null = null;

function loadIndex(): Promise<PlaneAIndex> {
  if (indexCache) return Promise.resolve(indexCache);
  if (indexInFlight) return indexInFlight;
  indexInFlight = fetch('/api/index')
    .then((r) => r.json() as Promise<PlaneAIndex>)
    .then((d) => {
      indexCache = d;
      return d;
    })
    .catch(() => EMPTY_INDEX);
  return indexInFlight;
}

function loadRegistry(): Promise<RegistrySnapshot> {
  if (registryCache) return Promise.resolve(registryCache);
  if (registryInFlight) return registryInFlight;
  registryInFlight = fetch('/api/registry')
    .then((r) => r.json() as Promise<RegistrySnapshot>)
    .then((d) => {
      registryCache = d;
      return d;
    })
    .catch(() => EMPTY_REGISTRY);
  return registryInFlight;
}

/** Drop the cached snapshots so the next load re-fetches (called on an SSE delta). */
export function invalidateFleetData(): void {
  indexCache = null;
  indexInFlight = null;
  registryCache = null;
  registryInFlight = null;
}

/** Test-only: clear all shared state so a cache from one test never leaks into the next. */
export function resetFleetData(): void {
  invalidateFleetData();
}

/**
 * Subscribe to the shared fleet snapshot. First mount triggers a single load per source (deduped across
 * consumers); every hub SSE tick invalidates and re-pulls so flyouts stay live without a reload.
 */
export function useFleetData(): { index: PlaneAIndex; registry: RegistrySnapshot } {
  const [index, setIndex] = useState<PlaneAIndex>(indexCache ?? EMPTY_INDEX);
  const [registry, setRegistry] = useState<RegistrySnapshot>(registryCache ?? EMPTY_REGISTRY);
  const { count } = useSse('/events');

  useEffect(() => {
    let alive = true;
    // A delta arrived after first paint → drop the cache so this load pulls fresh data.
    if (count > 0) invalidateFleetData();
    void loadIndex().then((d) => {
      if (alive) setIndex(d);
    });
    void loadRegistry().then((d) => {
      if (alive) setRegistry(d);
    });
    return () => {
      alive = false;
    };
  }, [count]);

  return { index, registry };
}
