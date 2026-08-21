/**
 * Sidebar navigation config (U2.5 — entity-first IA). The Information Architecture is a single typed
 * array of divider-separated groups so a new destination is ONE entry here — App.tsx renders the
 * sidebar and routes the body straight off this config, so adding a destination needs zero
 * layout/CSS change (a destination with a dedicated view also gets one `case` in App's body switch;
 * everything else falls through to the shared U3 placeholder).
 *
 * The design brief §D was rewritten to match this file (2026-08-05 docs sync) — brief and config now
 * agree: an entity-first IA where the groups are UNLABELLED — hairline dividers only (Linear pattern),
 * no uppercase group headers. The brief's sidebar BEHAVIOUR (48px rail, hover tooltips, expand to
 * ~220px) and every §E/§F visual rule remain authoritative.
 *
 *   ── (divider, below the [+ New] menu) ──
 *   Home · Inbox · Schedules · Terminal
 *   ── (divider) ──
 *   Agents · Workflows · Tasks · Projects · Files
 *   ── (divider) ──
 *   Health
 *
 * The sidebar ends there. Session state stays in the top bar and fleet STOP lives in Health.
 *
 * Every listed P1 destination is live.
 *
 * The former `pipeline` ("Runs") and `runCanvas` ("Run Canvas") destinations are GONE: a run is an
 * execution of a workflow, not a sibling entity of one, so runs live inside `workflows` as a deep
 * target (`{ view: 'workflows', focus: { kind: 'run' } }` — see `nav/stack.ts#focusTarget`). There is
 * deliberately no redirect stub for either id.
 */

/** A destination's build state. `live` is reachable now; `soon`/`future` render greyed + disabled. */
export type NavStatus = 'live' | 'soon' | 'future';

/** Every routable (or planned) destination id. The App body switch is exhaustive over these. */
export type DestinationId =
  | 'home'
  | 'inbox'
  | 'schedules'
  | 'terminal'
  | 'agents'
  | 'workflows'
  | 'tasks'
  | 'projects'
  | 'files'
  | 'health';

export interface NavDestination {
  id: DestinationId;
  /** Human label shown in the expanded sidebar and used as the rail-mode hover tooltip. */
  label: string;
  /** Mono glyph shown in both rail and expanded modes. */
  icon: string;
  status: NavStatus;
  /** Small greyed hint (e.g. the wave it lands in) — shown for non-live destinations. */
  hint?: string;
}

/**
 * A divider-separated group of destinations. There is NO group label in the entity-first IA — the
 * `id` exists only as a stable React key / test handle. Rendering a label is intentionally impossible.
 */
export interface NavSection {
  id: string;
  items: NavDestination[];
}

/** True when a destination is reachable (mounts a real view or the U3 placeholder). */
export function isLive(dest: NavDestination): boolean {
  return dest.status === 'live';
}

export const NAV_SECTIONS: NavSection[] = [
  {
    id: 'primary',
    items: [
      { id: 'home', label: 'Home', icon: '⌂', status: 'live' },
      { id: 'inbox', label: 'Inbox', icon: '✓', status: 'live' },
      { id: 'schedules', label: 'Schedules', icon: '◷', status: 'live' },
      { id: 'terminal', label: 'Terminal', icon: '⌨', status: 'live' },
    ],
  },
  {
    id: 'entities',
    items: [
      { id: 'agents', label: 'Agents', icon: '◉', status: 'live' },
      { id: 'workflows', label: 'Workflows', icon: '⧉', status: 'live' },
      { id: 'tasks', label: 'Tasks', icon: '☰', status: 'live' },
      { id: 'projects', label: 'Projects', icon: '▤', status: 'live' },
      { id: 'files', label: 'Files', icon: '🗀', status: 'live' },
    ],
  },
  {
    id: 'system',
    items: [
      { id: 'health', label: 'Health', icon: '◎', status: 'live' },
    ],
  },
];

/** The default landing destination (Home). */
export const DEFAULT_DESTINATION: DestinationId = 'home';
