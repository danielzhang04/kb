/**
 * Sidebar navigation config (U1). The Information Architecture is a single typed array so a new
 * layer / agent / workflow / knowledge surface is ONE entry here — App.tsx renders the sidebar and
 * routes the body straight off this config, so adding a destination needs zero layout/CSS change
 * (a `live` destination also gets one `case` in App's body switch; everything else is data).
 *
 * Groups + order + greying mirror docs/design-brief.md §D:
 *   OPERATE   Board (default) · Approvals · Timeline · Terminal (soon: D3/v2)
 *   BUILD     Editor · Vibe · Pipeline (future: D3) · Registry
 *   KNOWLEDGE Browser · Atlas (future)
 *   SYSTEM    Agents (future) · Ledgers (future) · Sentinel (future)
 * The Session/Stop floor is NOT a nav destination — it is a pinned-bottom shell region (App.tsx),
 * always reachable regardless of the active view. Room remains for a 5th group (INTELLIGENCE for
 * Atlas + Sentinel once real) by appending one more section object.
 */

/** A destination's build state. `live` is reachable now; `soon`/`future` render greyed + disabled. */
export type NavStatus = 'live' | 'soon' | 'future';

/** Every routable (or planned) destination id. The App body switch is exhaustive over these. */
export type DestinationId =
  | 'board'
  | 'approvals'
  | 'timeline'
  | 'terminal'
  | 'editor'
  | 'vibe'
  | 'pipeline'
  | 'registry'
  | 'browser'
  | 'atlas'
  | 'agents'
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

export interface NavSection {
  id: string;
  label: string;
  items: NavDestination[];
}

/** True when a destination is reachable (mounts a real view). `soon`/`future` are disabled. */
export function isLive(dest: NavDestination): boolean {
  return dest.status === 'live';
}

export const NAV_SECTIONS: NavSection[] = [
  {
    id: 'operate',
    label: 'Operate',
    items: [
      { id: 'board', label: 'Board', icon: '◧', status: 'live' },
      { id: 'approvals', label: 'Approvals', icon: '✓', status: 'live' },
      { id: 'timeline', label: 'Timeline', icon: '☰', status: 'live' },
      { id: 'terminal', label: 'Terminal', icon: '_', status: 'soon', hint: 'D3/v2' },
    ],
  },
  {
    id: 'build',
    label: 'Build',
    items: [
      { id: 'editor', label: 'Editor', icon: '✎', status: 'live' },
      { id: 'vibe', label: 'Vibe', icon: '✳', status: 'live' },
      { id: 'pipeline', label: 'Pipeline', icon: '⇄', status: 'future', hint: 'D3' },
      { id: 'registry', label: 'Registry', icon: '≡', status: 'live' },
    ],
  },
  {
    id: 'knowledge',
    label: 'Knowledge',
    items: [
      { id: 'browser', label: 'Browser', icon: '▤', status: 'live' },
      { id: 'atlas', label: 'Atlas', icon: '✦', status: 'future', hint: 'soon' },
    ],
  },
  {
    id: 'system',
    label: 'System',
    items: [
      { id: 'agents', label: 'Agents', icon: '◎', status: 'future', hint: 'soon' },
      { id: 'ledgers', label: 'Ledgers', icon: '▦', status: 'future', hint: 'soon' },
      { id: 'sentinel', label: 'Sentinel', icon: '◈', status: 'future', hint: 'soon' },
    ],
  },
];

/** The default landing destination (Board). */
export const DEFAULT_DESTINATION: DestinationId = 'board';
