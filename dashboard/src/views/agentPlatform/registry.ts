/**
 * Agent Platform — the panel registry (U0).
 *
 * Written once and left alone. It has been edited EXACTLY ONCE since (U12, the integration pass) to
 * teach the sort about the optional `order` field and to write down the heading contract below;
 * nothing about the registration procedure changed, and adding a panel still touches no file here.
 *
 * ── How to register a panel ───────────────────────────────────────────────────────────────────
 * Drop ONE entry file into `src/views/agentPlatform/panels/<Name>.panel.tsx` that exports a `panel`
 * const conforming to {@link AgentPlatformPanel}:
 *
 *     import type { AgentPlatformPanel } from '../types';
 *     import './myPanel.css';                    // your panel's OWN stylesheet
 *
 *     export const panel: AgentPlatformPanel = {
 *       id: 'example-panel',                     // unique, stable — React key + tie-breaking sort key
 *       order: 55,                               // OPTIONAL reading position; omit and you sort last
 *       title: 'Example Panel',
 *       description: 'One line saying what this panel shows.',
 *       render: () => <ExamplePanelBody />,
 *     };
 *
 * That is the whole procedure. No edit here, none in `AgentPlatform.tsx`, none in `nav/config.ts`,
 * none in `App.tsx` — the glob below picks the file up at build time and the section renders a tile
 * for it. Deleting the file removes the tile the same way. Panels are sorted by `order` then `id`, so
 * the grid order is deterministic and independent of filesystem/glob ordering, and a panel that sets
 * no `order` still lands somewhere stable (after the ordered ones, alphabetically among its peers).
 *
 * ── House rules (they keep N parallel panel authors from colliding) ───────────────────────────
 *   • ONE entry file per panel, named `<Name>.panel.tsx`. ONLY `*.panel.tsx` is registered.
 *   • Co-located tests (`<Name>.panel.test.tsx`) and helper components (`<Name>Body.tsx`, or a
 *     sibling directory such as `panels/<name>/`) are IGNORED by the registry — name them
 *     anything except `*.panel.tsx` and they will never become a tile.
 *   • YOUR PANEL OWNS ITS OWN CSS FILE; NEVER EDIT `styles/views/agentPlatform.css`. That
 *     stylesheet belongs to the section shell (grid/tiles/placeholder) — appending panel rules to
 *     it makes it a shared write target, which is exactly what this registry exists to avoid.
 *     Keep your classes under a panel-specific prefix so two panels can never clash.
 *   • HEADING CONTRACT: a panel body's OWN headings start at `<h4>`. The section shell owns `<h1>`
 *     (the app), `<h2>` ("Agent Platform") and `<h3>` (the opened panel's title, rendered by
 *     `AgentPlatform.tsx` as `ap__body-title`), so a body that opens with an `<h3>` duplicates the
 *     shell's level and a screen reader reads two sibling headings for one panel. Nest downward from
 *     h4 (h5 for a sub-section) and never skip a level. Pinned by `registry.test.ts`.
 *   • Prefer the SHARED chip/dot vocabulary in `styles/app.css` (`.mc-badge*`, `.mc-status-dot*`)
 *     over a panel-local re-implementation of it: a green chip must mean the same thing in every
 *     panel. Your stylesheet is for what is genuinely yours (layout, panel-specific structure).
 *
 * ── Failure behaviour ─────────────────────────────────────────────────────────────────────────
 * A malformed panel module (missing `panel`, wrong field types, duplicate id) is SKIPPED with a
 * console warning; it never throws, so one bad panel file can never blank the shell. Same defensive
 * posture as the read-only layer panels (`views/panels/FlightRecorder.tsx`).
 *
 * On a DUPLICATE id, FIRST WINS by path-sorted glob order: modules are walked in ascending path
 * order (the sort below is explicit, not a Vite implementation detail), so `Alpha.panel.tsx` keeps
 * the id and `Beta.panel.tsx` is skipped with a warning naming the offending path. Fix the loser's
 * id rather than relying on the ordering.
 *
 * ── Mechanism ─────────────────────────────────────────────────────────────────────────────────
 * `import.meta.glob(..., { eager: true })` is a Vite compile-time transform: it is rewritten into
 * static imports in the bundle (no runtime directory read, so it works in the browser), and it
 * resolves under this repo's vitest run too — vitest drives the same Vite transform pipeline.
 */
import type { AgentPlatformPanel } from './types';

/** Every panel ENTRY module in `./panels/`, resolved eagerly at build time (Vite rewrites this to
 *  static imports). The `*.panel.tsx` suffix is load-bearing: it excludes co-located `*.test.tsx`
 *  files and helper components, which a bare `*.tsx` glob would wrongly try to register. */
const PANEL_MODULES = import.meta.glob<{ panel: AgentPlatformPanel }>('./panels/*.panel.tsx', {
  eager: true,
});

/** Structural check — a module's export is only trusted as a panel when every field is well-shaped. */
function isPanel(value: unknown): value is AgentPlatformPanel {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Partial<AgentPlatformPanel>;
  // `order` is optional, but a PRESENT one must be a real finite number: a NaN or a string would sort
  // unpredictably and silently scramble the grid rather than failing where the mistake was made.
  if (p.order !== undefined && (typeof p.order !== 'number' || !Number.isFinite(p.order))) return false;
  return (
    typeof p.id === 'string' &&
    p.id.length > 0 &&
    typeof p.title === 'string' &&
    p.title.length > 0 &&
    typeof p.description === 'string' &&
    typeof p.render === 'function'
  );
}

/**
 * The grid order: `order` ascending, ties (and every panel that sets none) broken by `id`.
 *
 * A panel with no `order` sorts AFTER every panel that has one — `Infinity`, not `0` — so dropping in
 * a new file appends a tile instead of silently displacing the curated reading order.
 */
function comparePanels(a: AgentPlatformPanel, b: AgentPlatformPanel): number {
  const oa = a.order ?? Number.POSITIVE_INFINITY;
  const ob = b.order ?? Number.POSITIVE_INFINITY;
  if (oa !== ob) return oa - ob;
  return a.id.localeCompare(b.id);
}

function collectPanels(): AgentPlatformPanel[] {
  const panels: AgentPlatformPanel[] = [];
  const seen = new Set<string>();
  // Explicit path sort → duplicate-id resolution is FIRST-WINS in ascending path order, and never
  // depends on the glob's own key ordering.
  const modules = Object.entries(PANEL_MODULES).sort(([a], [b]) => a.localeCompare(b));
  for (const [path, mod] of modules) {
    const candidate = (mod as { panel?: unknown } | null | undefined)?.panel;
    if (!isPanel(candidate)) {
      console.warn(`[agentPlatform] ignoring ${path}: it does not export a well-shaped \`panel\`.`);
      continue;
    }
    if (seen.has(candidate.id)) {
      console.warn(`[agentPlatform] ignoring ${path}: duplicate panel id "${candidate.id}".`);
      continue;
    }
    seen.add(candidate.id);
    // A sidebar-owned panel keeps its self-contained body here but is not a second Agent Platform tile.
    if (candidate.placement !== 'sidebar') panels.push(candidate);
  }
  return panels.sort(comparePanels);
}

/** Every valid panel, in reading order. Auto-discovered — nothing is listed by hand. */
export const AGENT_PLATFORM_PANELS: AgentPlatformPanel[] = collectPanels();
