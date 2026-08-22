/**
 * arc-3 — the navigation stack.
 *
 * The shell has deliberately never had a router (see the header of `src/App.tsx`): the destination set
 * is fixed and long-lived overlays (Terminal's xterm instances, Composer workspaces) are mounted
 * OUTSIDE the body switch and must survive navigation. A router that owns mount/unmount fights that
 * directly, so it would cost a full migration for partial ownership.
 *
 * What arc-3 actually needs is drill-in + back, which `App.tsx` already had a single-purpose version of
 * (`openCardId` + `goTo('tasks')` + `taskSelectedId`). This module generalizes that precedent into one
 * typed stack of ~40 lines with zero dependencies.
 *
 * The three operations are deliberately asymmetric:
 *   - `goTo` RESETS to a single root entry. A sidebar click is a fresh start, never accumulated
 *     history — that preserves today's mental model exactly (no back arrow appears from browsing the
 *     sidebar).
 *   - `push` drills in; back becomes available.
 *   - `back` pops one and is a no-op at the root.
 *
 * `NavTarget` doubles as the URL schema if shareable deep links ever become a real requirement, so
 * migrating to a router later is mechanical rather than a rewrite.
 */
import type { DestinationId } from './config';
import type { RunnableRef } from '../../server/control/p2Contracts.ts';

/** The entity a pushed entry is focused on. `card` reuses the pre-existing Tasks detail-pane payload. */
export type Focus =
  | { kind: 'run'; id: string }
  | { kind: 'workflow'; id: string }
  | { kind: 'agent'; id: string }
  | { kind: 'card'; id: string };

export interface NavTarget {
  view: DestinationId;
  focus?: Focus;
  /** Closed roster filter used only by Home's Agent/Workflow attention links. */
  filter?: 'attention';
  /** The detail section (tab) to restore. Written back into the top entry as the operator switches tabs. */
  section?: string;
  /** New-schedule intent with immutable server-owned runnable identity prefilled. */
  scheduleOwner?: RunnableRef;
}

/**
 * The ONE destination that owns each focus kind.
 *
 * A run used to have two homes of its own (`pipeline` and `runCanvas`). It has none now: a run is an
 * execution OF a workflow, so it is a deep target inside `workflows` — the same destination that lists
 * the definition it came from. Everything that links to a run goes through {@link focusTarget}, so the
 * retarget is one table, not a search-and-replace across every caller.
 */
export const DESTINATION_BY_FOCUS: Record<Focus['kind'], DestinationId> = {
  run: 'workflows',
  workflow: 'workflows',
  agent: 'agents',
  card: 'tasks',
};

/** The nav target that opens an entity, in whichever destination owns its kind. */
export function focusTarget(focus: Focus, section?: string): NavTarget {
  return { view: DESTINATION_BY_FOCUS[focus.kind], focus, ...(section === undefined ? {} : { section }) };
}

export type NavEntry = NavTarget;

/** Depth cap. Drilling deeper drops from the BOTTOM so the operator never loses their current context. */
export const MAX_NAV_DEPTH = 8;

export const rootStack = (view: DestinationId): NavEntry[] => [{ view }];

/** True when two entries address the same thing — used to swallow double-click duplicates. */
export function sameTarget(a: NavEntry | undefined, b: NavTarget): boolean {
  if (!a) return false;
  return a.view === b.view && a.focus?.kind === b.focus?.kind && a.focus?.id === b.focus?.id && a.filter === b.filter;
}

/** A sidebar click: reset to a fresh root. No back arrow, no accumulated history. */
export function goToStack(view: DestinationId): NavEntry[] {
  return rootStack(view);
}

/** Drill in. Identical-to-top pushes are swallowed; depth is capped from the bottom. */
export function pushStack(stack: NavEntry[], target: NavTarget): NavEntry[] {
  if (sameTarget(stack[stack.length - 1], target)) return stack;
  const next = [...stack, target];
  return next.length > MAX_NAV_DEPTH ? next.slice(next.length - MAX_NAV_DEPTH) : next;
}

/** Pop one entry. At the root this is a no-op (the caller hides the affordance). */
export function backStack(stack: NavEntry[]): NavEntry[] {
  return stack.length > 1 ? stack.slice(0, -1) : stack;
}

/** Rewrite the top entry's active section so `back()` then forward restores the operator's tab. */
export function setSectionOnStack(stack: NavEntry[], section: string): NavEntry[] {
  const top = stack[stack.length - 1];
  if (!top || top.section === section) return stack;
  return [...stack.slice(0, -1), { ...top, section }];
}

/** The entry the back button would return to, or undefined at the root. */
export function parentEntry(stack: NavEntry[]): NavEntry | undefined {
  return stack.length > 1 ? stack[stack.length - 2] : undefined;
}

const DESTINATIONS = new Set<DestinationId>([
  'home', 'inbox', 'schedules', 'terminal', 'agents', 'workflows', 'tasks', 'projects', 'files', 'health',
]);
const URL_ENTITY_VIEW: Partial<Record<Focus['kind'], DestinationId>> = {
  agent: 'agents',
  workflow: 'workflows',
  card: 'tasks',
};

/** Parse the closed P1 query grammar; every invalid ingress falls back to a clean Home root. */
export function parseNavigationSearch(search: string): NavEntry[] {
  const fallback = rootStack('home');
  if (/%(?![0-9a-f]{2})/i.test(search)) return fallback;
  const params = new URLSearchParams(search);
  if ([...params].some(([key, value]) => key.includes('\uFFFD') || value.includes('\uFFFD'))) return fallback;
  const keys = [...params.keys()];
  if (keys.some((key) => key !== 'view' && key !== 'entity' && key !== 'filter')) return fallback;
  if (params.getAll('view').length !== 1 || params.getAll('entity').length > 1 || params.getAll('filter').length > 1) return fallback;
  const view = params.get('view');
  if (!view || !DESTINATIONS.has(view as DestinationId)) return fallback;
  const destination = view as DestinationId;
  const filter = params.get('filter');
  if (filter !== null && (filter !== 'attention' || destination !== 'agents' && destination !== 'workflows')) return fallback;
  const root = { view: destination, ...(filter === 'attention' ? { filter } : {}) } as NavEntry;
  const encodedEntity = params.get('entity');
  if (encodedEntity === null) return [root];
  const separator = encodedEntity.indexOf(':');
  if (separator <= 0 || separator === encodedEntity.length - 1) return fallback;
  const kind = encodedEntity.slice(0, separator) as Focus['kind'];
  const id = encodedEntity.slice(separator + 1);
  if (!(kind in URL_ENTITY_VIEW) || URL_ENTITY_VIEW[kind] !== destination) return fallback;
  const focus = { kind, id } as Focus;
  return [root, { ...root, focus }];
}

/** Serialize the top stack entry through URLSearchParams so entity identity is encoded exactly once. */
export function navigationSearchFor(entry: NavEntry): string {
  const params = new URLSearchParams();
  params.set('view', entry.view);
  if (entry.filter === 'attention' && (entry.view === 'agents' || entry.view === 'workflows')) {
    params.set('filter', entry.filter);
  }
  if (entry.focus && URL_ENTITY_VIEW[entry.focus.kind] === entry.view) {
    params.set('entity', `${entry.focus.kind}:${entry.focus.id}`);
  }
  return `?${params.toString()}`;
}
