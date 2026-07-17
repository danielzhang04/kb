/**
 * Sidebar navigation config (U2.5 — entity-first IA). The Information Architecture is a single typed
 * array of divider-separated groups so a new destination is ONE entry here — App.tsx renders the
 * sidebar and routes the body straight off this config, so adding a destination needs zero
 * layout/CSS change (a destination with a dedicated view also gets one `case` in App's body switch;
 * everything else falls through to the shared U3 placeholder).
 *
 * This SUPERSEDES the design brief §D verb-grouping (Operate/Build/Knowledge/System). Daniel locked an
 * entity-first IA: the groups are UNLABELLED — hairline dividers only (Linear pattern), no uppercase
 * group headers. The brief's sidebar BEHAVIOUR (48px rail, hover tooltips, expand to ~220px) and every
 * §E/§F visual rule remain authoritative.
 *
 *   ── (divider, below the [+ New] menu) ──
 *   Home · Approvals(n) · Activity · Atlas(soon) · Terminal(soon — D3)
 *   ── (divider) ──
 *   Workflows · Agents · Tasks · Projects · Files
 *   ── (divider) ──
 *   Connectors · Ledgers
 *   ── pinned floor ──  Session · STOP  (a shell region in App.tsx, not a nav destination)
 *
 * Live day-one views: Home, Approvals, Activity, Workflows, Files, Connectors. Agents/Tasks/Projects/
 * Ledgers are reachable nav items that land on a U3 placeholder (the nav skeleton is real; the view
 * lands next wave). Atlas/Terminal are greyed + disabled "soon" stubs.
 */

/** A destination's build state. `live` is reachable now; `soon`/`future` render greyed + disabled. */
export type NavStatus = 'live' | 'soon' | 'future';

/** Every routable (or planned) destination id. The App body switch is exhaustive over these. */
export type DestinationId =
  | 'home'
  | 'approvals'
  | 'activity'
  | 'atlas'
  | 'terminal'
  | 'workflows'
  | 'agents'
  | 'tasks'
  | 'projects'
  | 'files'
  | 'connectors'
  | 'ledgers';

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
      { id: 'approvals', label: 'Approvals', icon: '✓', status: 'live' },
      { id: 'activity', label: 'Activity', icon: '≡', status: 'live' },
      { id: 'atlas', label: 'Atlas', icon: '◈', status: 'soon', hint: 'soon' },
      { id: 'terminal', label: 'Terminal', icon: '⌨', status: 'soon', hint: 'D3' },
    ],
  },
  {
    id: 'entities',
    items: [
      { id: 'workflows', label: 'Workflows', icon: '⧉', status: 'live' },
      { id: 'agents', label: 'Agents', icon: '◉', status: 'live' },
      { id: 'tasks', label: 'Tasks', icon: '☰', status: 'live' },
      { id: 'projects', label: 'Projects', icon: '▤', status: 'live' },
      { id: 'files', label: 'Files', icon: '🗀', status: 'live' },
    ],
  },
  {
    id: 'system',
    items: [
      { id: 'connectors', label: 'Connectors', icon: '⛓', status: 'live' },
      { id: 'ledgers', label: 'Ledgers', icon: '▦', status: 'live' },
    ],
  },
];

/** The default landing destination (Home). */
export const DEFAULT_DESTINATION: DestinationId = 'home';

/** The [+ New ▾] menu entries (U5.1 — idea-first). The FIRST entry is a freeform "Idea…" — the menu's
 *  shape now says "bring an idea, iterate", not "pick an entity type". `idea` is clickable (opens the
 *  Composer placeholder) but carries a "Composer — soon" hint; `task` is the working entry that routes
 *  to the governed launch surface. The remaining entity types are greyed until the Composer lands. */
export interface NewMenuEntry {
  id: 'idea' | 'task' | 'workflow' | 'skill' | 'project' | 'agent';
  label: string;
  /** Whether the item is actionable (fires onCreate). Both `idea` and `task` are actionable day one. */
  enabled: boolean;
  /** Optional trailing hint shown even on an enabled item (e.g. the idea entry's "Composer — soon"). */
  hint?: string;
}

export const NEW_MENU_ENTRIES: NewMenuEntry[] = [
  { id: 'idea', label: 'Idea…', enabled: true, hint: 'Composer — soon' },
  { id: 'task', label: 'Task', enabled: true },
  { id: 'workflow', label: 'Workflow', enabled: false },
  { id: 'skill', label: 'Skill', enabled: false },
  { id: 'project', label: 'Project', enabled: false },
  { id: 'agent', label: 'Agent', enabled: false },
];
