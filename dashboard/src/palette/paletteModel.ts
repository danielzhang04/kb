/**
 * Command-palette model (U4). Pure, dependency-free logic for the Ctrl/Cmd+K palette so the command
 * set and the filter are unit-testable without a DOM.
 *
 * Two command kinds:
 *   - `navigate` — one per destination in the nav config (INCLUDING greyed soon/future ones, which are
 *     `disabled`: visible so the operator learns the map, but Enter is a no-op). Selecting one changes
 *     the active view — nothing more.
 *   - `act` — shortcuts to a governed surface that ALREADY exists in the UI. CRITICAL: an act command
 *     NEVER invokes a governed endpoint. It only NAVIGATES to the surface where the WebAuthn-gated
 *     control lives — "Open Inbox" opens the Inbox, "Launch a workflow" opens Workflows (which owns the
 *     one Launch button), "Emergency stop" opens Sentinel (which owns the stop controls). The palette is
 *     a shortcut, never a bypass: no verify/launch/stop network call originates here.
 *
 * The filter is a simple case-insensitive substring-or-subsequence match over label + hint + keywords —
 * no new dependency, predictable, and good enough for a fixed, small command set.
 */
import { NAV_SECTIONS, isLive, type DestinationId, type NavDestination } from '../nav/config';

export type PaletteCommandKind = 'navigate' | 'act';

export interface PaletteCommand {
  /** Stable id / test handle (e.g. `nav:workflows`, `act:approve`). */
  id: string;
  kind: PaletteCommandKind;
  /** Human label shown in the row. */
  label: string;
  /** Mono glyph shown at the row start. */
  icon: string;
  /** Small greyed hint — the wave for soon/future destinations, or "opens X" for act commands. */
  hint?: string;
  /** True for non-actionable rows (soon/future destinations): visible, selectable, but Enter is inert. */
  disabled: boolean;
  /** Extra search terms folded into the filter (never rendered). */
  keywords: string;
  /** Destination to navigate to on run. Every command carries one — running a command is a navigation. */
  target: DestinationId;
}

/** Navigate commands — one per destination, derived straight from the nav config (single source). */
export const NAVIGATE_COMMANDS: PaletteCommand[] = NAV_SECTIONS.flatMap((s) => s.items).map(
  (d: NavDestination): PaletteCommand => ({
    id: `nav:${d.id}`,
    kind: 'navigate',
    label: d.label,
    icon: d.icon,
    hint: isLive(d) ? undefined : (d.hint ?? 'soon'),
    disabled: !isLive(d),
    keywords: d.id,
    target: d.id,
  }),
);

/**
 * Act commands — shortcuts to governed surfaces. Each only NAVIGATES/FOCUSES; the governed control stays
 * WebAuthn-gated on its own surface. No command here carries an endpoint.
 */
export const ACT_COMMANDS: PaletteCommand[] = [
  {
    id: 'act:approve',
    kind: 'act',
    label: 'Open Inbox',
    icon: '✓',
    hint: 'decisions, input, intervention',
    disabled: false,
    keywords: 'inbox approve verify sign signature pending review corroborate input intervention wake me',
    target: 'approvals',
  },
  {
    // Home's launch form is gone (spec §5): work is launched from the workflow it belongs to, by the
    // ONE Launch button on that surface. The shortcut follows the button rather than a dead form.
    id: 'act:launch',
    kind: 'act',
    label: 'Launch a workflow',
    icon: '+',
    hint: 'Workflows',
    disabled: false,
    keywords: 'launch task new run rerun start dispatch card workflow',
    target: 'workflows',
  },
  {
    // The stop controls left the sidebar floor (spec §6): they live on Sentinel, beside the fleet-health
    // readout an operator is looking at when they reach for them. The shortcut follows the controls.
    id: 'act:stop',
    kind: 'act',
    label: 'Emergency stop',
    icon: '⏻',
    hint: 'Sentinel',
    disabled: false,
    keywords: 'stop halt kill freeze nuclear pause cadence emergency passkey',
    target: 'sentinel',
  },
];

/** The full command set, navigate destinations first then act shortcuts. */
export const ALL_COMMANDS: PaletteCommand[] = [...NAVIGATE_COMMANDS, ...ACT_COMMANDS];

/** True when every char of `needle` appears in `hay` in order (a substring is a trivial subsequence). */
function isSubsequence(hay: string, needle: string): boolean {
  let i = 0;
  for (let j = 0; j < hay.length && i < needle.length; j++) {
    if (hay[j] === needle[i]) i += 1;
  }
  return i === needle.length;
}

/**
 * Filter commands by a query. Empty query returns the list unchanged (original order preserved). A
 * command matches when the query is a case-insensitive substring OR subsequence of its searchable text.
 */
export function filterCommands(commands: PaletteCommand[], query: string): PaletteCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return commands;
  return commands.filter((c) => {
    const hay = `${c.label} ${c.hint ?? ''} ${c.keywords}`.toLowerCase();
    return hay.includes(q) || isSubsequence(hay, q);
  });
}
