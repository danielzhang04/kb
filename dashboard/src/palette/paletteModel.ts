/**
 * Command-palette model (U4). Pure, dependency-free logic for the Ctrl/Cmd+K palette so the command
 * set and the filter are unit-testable without a DOM.
 *
 * The command set is one navigation command per destination in the closed P1 nav config. Selecting a
 * command changes the active view and never invokes a governed endpoint.
 *
 * The filter is a simple case-insensitive substring-or-subsequence match over label + hint + keywords —
 * no new dependency, predictable, and good enough for a fixed, small command set.
 */
import { NAV_SECTIONS, isLive, type DestinationId, type NavDestination } from '../nav/config';

export type PaletteCommandKind = 'navigate';

export interface PaletteCommand {
  /** Stable id / test handle (for example `nav:workflows`). */
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

/** The exact full command set. */
export const ALL_COMMANDS: PaletteCommand[] = NAVIGATE_COMMANDS;

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
