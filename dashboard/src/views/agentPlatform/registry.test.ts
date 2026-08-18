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
  it('discovers the demo panel without it being listed anywhere', () => {
    const demo = AGENT_PLATFORM_PANELS.find((p) => p.id === 'demo-placeholder');
    expect(demo).toBeTruthy();
    expect(demo?.title).toBe('Demo Panel');
    expect(demo?.description.length).toBeGreaterThan(0);
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
    }
  });

  it('registers ids uniquely and sorts the grid deterministically by id', () => {
    const ids = AGENT_PLATFORM_PANELS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
  });

  it('registers exactly the *.panel.tsx files present on disk (auto-discovery, not a hand-kept list)', () => {
    expect(PANEL_FILES.length).toBeGreaterThan(0);
    // Every entry file exports a `panel`, and every one of them is registered — so file count and
    // registry length move together. Adding a file is the whole registration procedure.
    // (Ids are NOT scraped out of the sources: a panel file may legitimately contain other `id:`
    // literals — fixtures, node objects — above its export. Uniqueness/shape are asserted at
    // RUNTIME above, which is stronger than any source regex.)
    expect(AGENT_PLATFORM_PANELS.length).toBe(PANEL_FILES.length);
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
    expect(AGENT_PLATFORM_PANELS.length).toBe(PANEL_FILES.length);
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
