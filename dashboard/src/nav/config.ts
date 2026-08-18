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
 *   Home · Approvals(n) · Activity · Atlas(live — Atlas V1) · Terminal(live — D3.2)
 *   ── (divider) ──
 *   Workflows · Agents · Tasks · Projects · Files · Agent Platform(live — Wave-1 U0)
 *   ── (divider) ──
 *   Connectors · Ledgers · Sentinel
 *
 * The sidebar ENDS there. Session state is the top-bar lock chip, and the emergency-stop controls live
 * on the Sentinel view next to the fleet-health readout they act on — neither is a pinned shell region.
 *
 * Live day-one views: Home, Approvals, Activity, Workflows, Files, Connectors. Agents/Tasks/Projects/
 * Ledgers are reachable nav items that land on a U3 placeholder (the nav skeleton is real; the view
 * lands next wave). Terminal is LIVE as of D3.2 (the PTY pane); Atlas is LIVE as of Atlas V1 (the voice
 * worker mirror — big orb + live transcript + activity history), amending the locked entity-first IA
 * per Daniel's 2026-07-20 call (the old greyed "soon" stub is promoted, not moved).
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
  | 'approvals'
  | 'activity'
  | 'atlas'
  | 'terminal'
  | 'workflows'
  | 'agents'
  | 'tasks'
  | 'projects'
  | 'files'
  | 'agentPlatform'
  | 'connectors'
  | 'ledgers'
  | 'sentinel';

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
      { id: 'approvals', label: 'Inbox', icon: '✓', status: 'live' },
      { id: 'activity', label: 'Activity', icon: '≡', status: 'live' },
      { id: 'atlas', label: 'Atlas', icon: '◈', status: 'live' },
      { id: 'terminal', label: 'Terminal', icon: '⌨', status: 'live' },
    ],
  },
  {
    id: 'entities',
    items: [
      // Definitions AND their executions. Runs are reached by drilling into the workflow that produced
      // them (or the "Ad-hoc" group for runs no definition owns) — never from a nav entry of their own.
      { id: 'workflows', label: 'Workflows', icon: '⧉', status: 'live' },
      { id: 'agents', label: 'Agents', icon: '◉', status: 'live' },
      { id: 'tasks', label: 'Tasks', icon: '☰', status: 'live' },
      { id: 'projects', label: 'Projects', icon: '▤', status: 'live' },
      { id: 'files', label: 'Files', icon: '🗀', status: 'live' },
      // Wave-1 U0 — the Agent Platform section. Its panels are auto-discovered from
      // `views/agentPlatform/panels/*.panel.tsx`, so this stays the ONLY nav entry the platform needs.
      { id: 'agentPlatform', label: 'Agent Platform', icon: '⬡', status: 'live' },
    ],
  },
  {
    id: 'system',
    items: [
      { id: 'connectors', label: 'Connectors', icon: '⛓', status: 'live' },
      { id: 'ledgers', label: 'Ledgers', icon: '▦', status: 'live' },
      // D3.5 — the Sentinel destination hosts the read-only layer panels (Sentinel / Quartermaster /
      // Flight Recorder / Atlas) behind an underline-tab bar. One nav entry; panels reachable from it.
      { id: 'sentinel', label: 'Sentinel', icon: '◎', status: 'live' },
    ],
  },
];

/** The default landing destination (Home). */
export const DEFAULT_DESTINATION: DestinationId = 'home';
