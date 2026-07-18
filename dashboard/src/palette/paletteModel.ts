/**
 * Command-palette model (U4). Pure, dependency-free logic for the Ctrl/Cmd+K palette so the command
 * set and the filter are unit-testable without a DOM.
 *
 * Two command kinds:
 *   - `navigate` — one per destination in the nav config (INCLUDING greyed soon/future ones, which are
 *     `disabled`: visible so the operator learns the map, but Enter is a no-op). Selecting one changes
 *     the active view — nothing more.
 *   - `act` — shortcuts to a governed surface that ALREADY exists in the UI. CRITICAL: an act command
 *     NEVER invokes a governed endpoint. It only NAVIGATES to (or focuses) the surface where the
 *     WebAuthn-gated control lives — "Approve…" opens Approvals, "Launch task" opens Home's launch
 *     surface, "Stop / Session" focuses the pinned floor. The palette is a shortcut, never a bypass:
 *     no verify/launch/stop network call originates here.
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
  /** Destination to navigate to on run. Absent only for the pure focus-floor command. */
  target?: DestinationId;
  /** When true, running the command focuses the pinned Session/Stop floor (no endpoint call). */
  focusFloor?: boolean;
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
    id: 'act:launch',
    kind: 'act',
    label: 'Launch task',
    icon: '+',
    hint: 'Home launch surface',
    disabled: false,
    keywords: 'launch task new run rerun start dispatch card',
    target: 'home',
  },
  {
    id: 'act:stop',
    kind: 'act',
    label: 'Stop / Session',
    icon: '⏻',
    hint: 'focus the pinned floor',
    disabled: false,
    keywords: 'stop halt session sign in passkey webauthn kill freeze nuclear',
    focusFloor: true,
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
