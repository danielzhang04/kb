/**
 * Agent Platform registry (Wave-1 U0). These tests pin the ONE property the whole platform rests on:
 * a panel becomes a live tile by EXISTING in `panels/`, with no edit to any shared file. They fail if
 * someone ever downgrades the registry to a hand-maintained array, or lands a malformed panel.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENT_PLATFORM_PANELS } from './registry';

const HERE = dirname(fileURLToPath(import.meta.url)); // dashboard/src/views/agentPlatform
const PANELS_DIR = join(HERE, 'panels');

/** Panel ENTRY files on disk — the ground truth the glob reproduces with zero registry edits. Only
 *  `*.panel.tsx` counts: co-located `*.test.tsx` files and helper components are deliberately not
 *  registrable, so N parallel panel authors can add tests/helpers without perturbing this invariant. */
const PANEL_FILES = readdirSync(PANELS_DIR).filter((f) => f.endsWith('.panel.tsx'));

describe('agentPlatform/registry', () => {
  /**
   * The zero-edit registration proof. It used to be pinned on a placeholder `Demo Panel`; U12 retired
   * that file, so the proof now rides on a REAL panel — deliberately one whose id is named nowhere in
   * `registry.ts` (asserted below), which is the property that actually matters. `hygiene-report` is
   * the subject because it is the plainest real panel: no session, no picker, one fetch.
   */
  it('discovers a real panel without it being listed anywhere', () => {
    const found = AGENT_PLATFORM_PANELS.find((p) => p.id === 'hygiene-report');
    expect(found).toBeTruthy();
    expect(found?.title).toBe('Hygiene Report');
    expect(found?.description.length).toBeGreaterThan(0);
  });

  it('every registered entry conforms to the panel contract', () => {
    expect(AGENT_PLATFORM_PANELS.length).toBeGreaterThan(0);
    for (const panel of AGENT_PLATFORM_PANELS) {
      expect(typeof panel.id).toBe('string');
      expect(panel.id.length).toBeGreaterThan(0);
      expect(typeof panel.title).toBe('string');
      expect(panel.title.length).toBeGreaterThan(0);
      expect(typeof panel.description).toBe('string');
      expect(typeof panel.render).toBe('function');
      // Optional — but a present `order` is a real finite number, never a NaN that sorts at random.
      if (panel.order !== undefined) {
        expect(typeof panel.order).toBe('number');
        expect(Number.isFinite(panel.order)).toBe(true);
      }
    }
  });

  it('registers ids uniquely and sorts the grid deterministically by order, then id', () => {
    const ids = AGENT_PLATFORM_PANELS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);

    const expected = [...AGENT_PLATFORM_PANELS]
      .sort((a, b) => {
        const oa = a.order ?? Number.POSITIVE_INFINITY;
        const ob = b.order ?? Number.POSITIVE_INFINITY;
        return oa !== ob ? oa - ob : a.id.localeCompare(b.id);
      })
      .map((p) => p.id);
    expect(ids).toEqual(expected);
  });

  /**
   * U12's curated reading order. Pinned as a PREFIX rather than an equality so a panel added later
   * (which sorts last by construction) does not red this test — but a reshuffle of the eleven curated
   * ones does. The order is the section's argument about what to look at first: what is running now,
   * then who is allowed to do what, then the read-only forensics.
   */
  it('opens on the curated reading order, not alphabetically by id', () => {
    const CURATED = [
      // U-L2 — the loops run on their own overnight; "did they run, and does one need me?" is the
      // first question of the morning, so the section opens on it.
      'loop-status',
      'agent-management',
      'fleet-graph',
      'watch-agents-run',
      'autonomy-ladder',
      'run-envelope',
      'brain-search',
      'context-lifecycle',
      'model-audit',
      'proposed-lessons',
      'hygiene-report',
    ];
    const ids = AGENT_PLATFORM_PANELS.map((p) => p.id);
    expect(ids.slice(0, CURATED.length)).toEqual(CURATED);
    // …and this is genuinely NOT the alphabetical order, so the field is doing work.
    expect(CURATED).not.toEqual([...CURATED].sort((a, b) => a.localeCompare(b)));
  });

  it('sorts an order-less panel AFTER every ordered one, so a new file never displaces the curation', () => {
    const ordered = AGENT_PLATFORM_PANELS.filter((p) => p.order !== undefined);
    const unordered = AGENT_PLATFORM_PANELS.filter((p) => p.order === undefined);
    if (unordered.length === 0) return; // every panel is curated today; the rule still holds below
    const lastOrdered = AGENT_PLATFORM_PANELS.findIndex((p) => p.id === ordered[ordered.length - 1].id);
    const firstUnordered = AGENT_PLATFORM_PANELS.findIndex((p) => p.id === unordered[0].id);
    expect(firstUnordered).toBeGreaterThan(lastOrdered);
  });

  /**
   * The heading contract (U12), enforced against the sources rather than the rendered DOM so it holds
   * for every panel including the ones that need a session, a fetch or a graph to render at all.
   *
   * The shell renders the app's h1, the section's h2 and the opened panel's h3 (`ap__body-title`). A
   * body that opens its own `<h3>` therefore emits a second h3 for one panel — two sibling headings a
   * screen reader reads as two sections. Bodies start at h4 and nest downward.
   */
  it('panel bodies start at h4 — the shell owns h1/h2/h3', () => {
    const files = [
      ...readdirSync(PANELS_DIR, { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith('.tsx') && !e.name.endsWith('.test.tsx'))
        .map((e) => join(PANELS_DIR, e.name)),
      // Helper bodies in sibling directories are part of a panel body just as much as its entry file.
      ...readdirSync(PANELS_DIR, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .flatMap((dir) =>
          readdirSync(join(PANELS_DIR, dir.name))
            .filter((f) => f.endsWith('.tsx') && !f.endsWith('.test.tsx'))
            .map((f) => join(PANELS_DIR, dir.name, f)),
        ),
    ];
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      expect(source, `${file} opens an <h1>/<h2>/<h3> — the shell owns those levels`).not.toMatch(/<h[123][\s>]/);
    }
  });

  it('registers exactly the Agent Platform *.panel.tsx files present on disk (auto-discovery, not a hand-kept list)', () => {
    expect(PANEL_FILES.length).toBeGreaterThan(0);
    // Every entry file exports a `panel`, and every one of them is registered — so file count and
    // registry length move together. Adding a file is the whole registration procedure.
    // (Ids are NOT scraped out of the sources: a panel file may legitimately contain other `id:`
    // literals — fixtures, node objects — above its export. Uniqueness/shape are asserted at
    // RUNTIME above, which is stronger than any source regex.)
    const sidebarPanels = PANEL_FILES.filter((file) => readFileSync(join(PANELS_DIR, file), 'utf8').includes("placement: 'sidebar'"));
    expect(AGENT_PLATFORM_PANELS.length).toBe(PANEL_FILES.length - sidebarPanels.length);
    for (const file of PANEL_FILES) {
      const source = readFileSync(join(PANELS_DIR, file), 'utf8');
      expect(source, `${file} exports no \`panel\` const`).toMatch(/export const panel\b/);
    }
  });

  it('globs entry files ONLY, so co-located tests and helpers can never register', () => {
    const registrySource = readFileSync(join(HERE, 'registry.ts'), 'utf8');
    // A bare `*.tsx` glob would sweep in every `<Name>.panel.test.tsx` a panel author writes and a
    // duplicate/undefined `panel` export would warn-spam or break the count invariant above.
    expect(registrySource).not.toContain("'./panels/*.tsx'");
    expect(registrySource).toContain("'./panels/*.panel.tsx'");
    // The registry counts entry files only: whatever else sits in panels/ (tests, helper components,
    // helper sub-directories) is inert by construction.
    const sidebarPanels = PANEL_FILES.filter((file) => readFileSync(join(PANELS_DIR, file), 'utf8').includes("placement: 'sidebar'"));
    expect(AGENT_PLATFORM_PANELS.length).toBe(PANEL_FILES.length - sidebarPanels.length);
  });

  it('discovers by glob and never by a hardcoded panel list', () => {
    const source = readFileSync(join(HERE, 'registry.ts'), 'utf8');
    expect(source).toContain("import.meta.glob");
    expect(source).toContain("'./panels/*.panel.tsx'");
    // No panel is named in the registry — not even the demo one (the doc comment's example id aside,
    // which is deliberately not a real panel id).
    for (const panel of AGENT_PLATFORM_PANELS) {
      expect(source, `registry.ts names panel "${panel.id}" — discovery must stay hands-off`)
        .not.toContain(panel.id);
    }
  });
});
