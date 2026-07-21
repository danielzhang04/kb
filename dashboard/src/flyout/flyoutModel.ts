/**
 * Entity hover-flyout model (U4). Pure derivation of a small "live contents" summary for a sidebar
 * entity item, computed from data the views ALREADY fetch: the Plane-A snapshot (`/api/index`) and the
 * registry (`/api/registry`). No new endpoint, no per-hover fetch — the summary is a pure function of a
 * shared snapshot (see {@link useFleetData}).
 *
 * Every summary degrades to `empty: true` when its data is missing/zero; the Flyout renders NOTHING for
 * an empty summary (no error state ever appears in a flyout).
 */
import type { PlaneAIndex } from '../../server/planeA/indexer';
import type { ParsedCard } from '../../server/planeA/cards';
import type { ConnectionsIndex } from '../../server/registry/connections';
import type { DestinationId } from '../nav/config';

/** The registry slices a flyout may read (subset of `/api/registry`). */
export interface RegistrySnapshot {
  connections?: ConnectionsIndex;
}

/** One dense count row in a flyout. */
export interface FlyoutLine {
  label: string;
  value: number;
}

/** A flyout's rendered contents. `empty` → the Flyout renders nothing (calm, no error). */
export interface FlyoutSummary {
  title: string;
  lines: FlyoutLine[];
  /** Top mono ids/names to list (e.g. working card ids, pending ids). */
  ids: string[];
  /** Eyebrow shown above the id list (e.g. "working", "pending"). */
  idLabel?: string;
  empty: boolean;
}

/** Destinations that carry a hover-flyout. Home/Activity/Atlas/Terminal do not. */
export const FLYOUT_DESTINATIONS: ReadonlySet<DestinationId> = new Set<DestinationId>([
  'approvals',
  'agents',
  'tasks',
  'projects',
  'files',
  'connectors',
  'ledgers',
]);

const MAX_IDS = 5;

function bucket(index: PlaneAIndex, state: string): ParsedCard[] {
  return index.cards[state] ?? [];
}

function cardId(card: ParsedCard): string {
  return String(card.meta.id);
}

/** Task lifecycle states surfaced (in order) in the Tasks flyout, when populated. */
const TASK_STATES: Array<{ state: string; label: string }> = [
  { state: 'inbox', label: 'inbox' },
  { state: 'working', label: 'working' },
  { state: 'blocked', label: 'blocked' },
  { state: 'approvals', label: 'approvals' },
  { state: 'done', label: 'done' },
];

function tasksSummary(index: PlaneAIndex): FlyoutSummary {
  const lines = TASK_STATES.map(({ state, label }) => ({ label, value: bucket(index, state).length })).filter(
    (l) => l.value > 0,
  );
  const working = bucket(index, 'working');
  return {
    title: 'Tasks',
    lines,
    ids: working.slice(0, MAX_IDS).map(cardId),
    idLabel: working.length > 0 ? 'working now' : undefined,
    empty: lines.length === 0,
  };
}

function agentsSummary(index: PlaneAIndex): FlyoutSummary {
  const byOwner = new Map<string, { working: boolean }>();
  for (const cards of Object.values(index.cards)) {
    for (const c of cards) {
      const owner = c.meta.owner;
      if (typeof owner !== 'string' || owner === '') continue;
      const prev = byOwner.get(owner) ?? { working: false };
      if (c.meta.state === 'working') prev.working = true;
      byOwner.set(owner, prev);
    }
  }
  const working = [...byOwner.entries()].filter(([, v]) => v.working).map(([id]) => id).sort();
  return {
    title: 'Agents',
    lines: [
      { label: 'working', value: working.length },
      { label: 'on board', value: byOwner.size },
    ],
    ids: working.slice(0, MAX_IDS),
    idLabel: working.length > 0 ? 'working' : undefined,
    empty: byOwner.size === 0,
  };
}

function approvalsSummary(index: PlaneAIndex): FlyoutSummary {
  const pending = bucket(index, 'approvals');
  return {
    title: 'Approvals',
    lines: [{ label: 'pending', value: pending.length }],
    ids: pending.slice(0, MAX_IDS).map(cardId),
    idLabel: pending.length > 0 ? 'awaiting signature' : undefined,
    empty: pending.length === 0,
  };
}

function projectsSummary(index: PlaneAIndex): FlyoutSummary {
  const names = index.orgStates.map((s) => s.project);
  return {
    title: 'Projects',
    lines: [{ label: 'projects', value: names.length }],
    ids: names.slice(0, MAX_IDS),
    idLabel: names.length > 0 ? 'in the kb' : undefined,
    empty: names.length === 0,
  };
}

/** Files browses the KB tree (no /api/index file dimension); the honest live signal we already hold is
 *  the project/org count, so the Files flyout summarises the KB's project shape. */
function filesSummary(index: PlaneAIndex): FlyoutSummary {
  const count = index.orgStates.length;
  return {
    title: 'Files',
    lines: [{ label: 'projects', value: count }],
    ids: [],
    empty: count === 0,
  };
}

function connectorsSummary(registry: RegistrySnapshot): FlyoutSummary {
  const conn = registry.connections;
  const items = conn?.items ?? [];
  const servers = [...new Set(items.map((c) => c.server))].sort();
  return {
    title: 'Connectors',
    lines: [
      { label: 'connections', value: conn?.count ?? items.length },
      { label: 'servers', value: servers.length },
    ],
    ids: servers.slice(0, MAX_IDS),
    idLabel: servers.length > 0 ? 'mcp servers' : undefined,
    empty: items.length === 0,
  };
}

function ledgersSummary(index: PlaneAIndex): FlyoutSummary {
  const cost = index.ledgers.cost;
  const dispatch = index.ledgers.dispatch;
  const models = Object.keys(cost.perModelSteps).length;
  return {
    title: 'Ledgers',
    lines: [
      { label: 'steps', value: cost.stepCount },
      { label: 'models', value: models },
      { label: 'dispatches', value: dispatch.count },
    ],
    ids: [],
    empty: cost.stepCount === 0 && dispatch.count === 0,
  };
}

/**
 * Build the flyout summary for a destination. Returns `null` for destinations without a flyout. The
 * returned summary may still be `empty` (Flyout then renders nothing).
 */
export function summaryFor(
  id: DestinationId,
  index: PlaneAIndex,
  registry: RegistrySnapshot,
): FlyoutSummary | null {
  switch (id) {
    case 'tasks':
      return tasksSummary(index);
    case 'agents':
      return agentsSummary(index);
    case 'approvals':
      return approvalsSummary(index);
    case 'projects':
      return projectsSummary(index);
    case 'files':
      return filesSummary(index);
    case 'connectors':
      return connectorsSummary(registry);
    case 'ledgers':
      return ledgersSummary(index);
    default:
      return null;
  }
}
