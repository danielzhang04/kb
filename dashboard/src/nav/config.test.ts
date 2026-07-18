/**
 * U2.5 — nav config module (entity-first IA). The sidebar IA is a single typed array of divider-
 * separated, UNLABELLED groups (one entry per destination). These tests pin the config's SHAPE and the
 * locked entity-first grouping/ordering/greying so a later edit can't silently drop, re-tier, or
 * re-introduce a group label / a dropped destination.
 */
import { describe, expect, it } from 'vitest';
import {
  NAV_SECTIONS,
  DEFAULT_DESTINATION,
  NEW_MENU_ENTRIES,
  isLive,
  type NavSection,
  type NavStatus,
  type DestinationId,
} from './config';

const ALL = NAV_SECTIONS.flatMap((s) => s.items);
const STATUSES: NavStatus[] = ['live', 'soon', 'future'];

describe('nav/config', () => {
  it('is three unlabelled, divider-separated groups in the locked order', () => {
    expect(NAV_SECTIONS.map((s) => s.id)).toEqual(['primary', 'entities', 'system']);
    for (const section of NAV_SECTIONS) {
      expect(section.id).toBeTruthy();
      expect(section.items.length).toBeGreaterThan(0);
      // Entity-first IA: sections carry NO human label — there is nothing to render as a group header.
      expect((section as NavSection & { label?: unknown }).label).toBeUndefined();
    }
  });

  it('orders each group exactly as the locked IA', () => {
    expect(NAV_SECTIONS[0].items.map((d) => d.id)).toEqual([
      'home',
      'approvals',
      'activity',
      'atlas',
      'terminal',
    ]);
    expect(NAV_SECTIONS[1].items.map((d) => d.id)).toEqual([
      'workflows',
      'pipeline',
      'agents',
      'tasks',
      'projects',
      'files',
    ]);
    // D3.5 — Sentinel joins the system group (hosts the read-only layer panels behind sub-tabs).
    expect(NAV_SECTIONS[2].items.map((d) => d.id)).toEqual(['connectors', 'ledgers', 'sentinel']);
  });

  it('every destination has a unique id, a label, an icon and a valid status', () => {
    const ids = ALL.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const dest of ALL) {
      expect(dest.label.length).toBeGreaterThan(0);
      expect(dest.icon.length).toBeGreaterThan(0);
      expect(STATUSES).toContain(dest.status);
    }
  });

  it('presents the pipeline destination as Runs without changing its stable route id', () => {
    const runs = ALL.find((d) => d.id === 'pipeline');
    expect(runs?.label).toBe('Runs');
  });

  it('non-live destinations carry a greyed hint; live ones do not', () => {
    for (const dest of ALL) {
      if (isLive(dest)) {
        expect(dest.hint).toBeUndefined();
      } else {
        expect(dest.hint).toBeTruthy();
      }
    }
  });

  it('drops every superseded verb-IA destination', () => {
    const ids = new Set<string>(ALL.map((d) => d.id));
    // D3.4 un-defers `pipeline` (the depends-on DAG canvas) into the entities group and D3.5 re-introduces
    // `sentinel` as a real system destination (the layer panels) — both are now live destinations and are
    // deliberately NOT in this dropped set any more. The rest of the superseded verb-IA set stays gone.
    for (const dropped of ['board', 'editor', 'vibe', 'skills', 'registry']) {
      expect(ids.has(dropped)).toBe(false);
    }
    // "timeline" and "browser" were renamed to entity destinations, not kept.
    expect(ids.has('timeline')).toBe(false);
    expect(ids.has('browser')).toBe(false);
  });

  it('lands on Home by default, and Home is the first live item of the first group', () => {
    expect(DEFAULT_DESTINATION).toBe('home');
    const home = ALL.find((d) => d.id === 'home');
    expect(home && isLive(home)).toBe(true);
    expect(NAV_SECTIONS[0].items[0].id).toBe('home');
  });

  it('exposes the entity-first destinations with the right build states', () => {
    const status = (id: DestinationId) => ALL.find((d) => d.id === id)?.status;
    // Reachable now (real view or U3 placeholder).
    for (const id of [
      'home',
      'approvals',
      'activity',
      'workflows',
      'pipeline',
      'agents',
      'tasks',
      'projects',
      'files',
      'connectors',
      'ledgers',
      'sentinel',
    ] as const) {
      expect(status(id)).toBe('live');
    }
    // Terminal is LIVE as of D3.2 (the PTY pane).
    expect(status('terminal')).toBe('live');
    // Atlas remains a greyed "soon" stub — present in the IA, not yet reachable.
    expect(status('atlas')).toBe('soon');
  });

  it('the [+ New] menu is idea-first with the Composer live: idea + every entity type enabled (C7.2 un-defers agent)', () => {
    // C5 — the freeform "Idea…" leads; the menu's shape says "bring an idea, iterate".
    expect(NEW_MENU_ENTRIES.map((e) => e.id)).toEqual([
      'idea',
      'task',
      'workflow',
      'skill',
      'project',
      'agent',
    ]);
    const idea = NEW_MENU_ENTRIES.find((e) => e.id === 'idea');
    expect(idea?.enabled).toBe(true);
    // C7.2 — every creatable entity, INCLUDING agent, is actionable now.
    for (const id of ['task', 'workflow', 'skill', 'project', 'agent'] as const) {
      expect(NEW_MENU_ENTRIES.find((e) => e.id === id)?.enabled).toBe(true);
    }
    expect(Object.fromEntries(NEW_MENU_ENTRIES.map((entry) => [entry.id, entry.hint]))).toEqual({
      idea: 'Plan',
      task: 'Quick launch',
      workflow: 'Register',
      skill: 'Register',
      project: 'Register',
      agent: 'Declare',
    });
  });
});
