/**
 * Agent Platform — the panel registry (U0). THIS FILE IS WRITTEN ONCE AND NEVER EDITED AGAIN.
 *
 * ── How to register a panel ───────────────────────────────────────────────────────────────────
 * Drop ONE entry file into `src/views/agentPlatform/panels/<Name>.panel.tsx` that exports a `panel`
 * const conforming to {@link AgentPlatformPanel}:
 *
 *     import type { AgentPlatformPanel } from '../types';
 *     import './myPanel.css';                    // your panel's OWN stylesheet
 *
 *     export const panel: AgentPlatformPanel = {
 *       id: 'example-panel',                     // unique, stable — also the grid sort key
 *       title: 'Example Panel',
 *       description: 'One line saying what this panel shows.',
 *       render: () => <ExamplePanelBody />,
 *     };
 *
 * That is the whole procedure. No edit here, none in `AgentPlatform.tsx`, none in `nav/config.ts`,
 * none in `App.tsx` — the glob below picks the file up at build time and the section renders a tile
 * for it. Deleting the file removes the tile the same way. Panels are sorted by `id` so the grid
 * order is deterministic and independent of filesystem/glob ordering.
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
  return (
    typeof p.id === 'string' &&
    p.id.length > 0 &&
    typeof p.title === 'string' &&
    p.title.length > 0 &&
    typeof p.description === 'string' &&
    typeof p.render === 'function'
  );
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
    panels.push(candidate);
  }
  return panels.sort((a, b) => a.id.localeCompare(b.id));
}

/** Every valid panel, sorted by id. Auto-discovered — nothing is listed by hand. */
export const AGENT_PLATFORM_PANELS: AgentPlatformPanel[] = collectPanels();
