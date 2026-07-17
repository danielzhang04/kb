/**
 * U1 — nav config module. The sidebar IA is a single typed array (one entry per destination) so a
 * new layer/agent/workflow is a one-line config add. These tests pin the config's SHAPE and the
 * brief's §D grouping/ordering/greying so a later edit can't silently drop or mis-tier a destination.
 */
import { describe, expect, it } from 'vitest';
import {
  NAV_SECTIONS,
  DEFAULT_DESTINATION,
  isLive,
  type NavStatus,
  type DestinationId,
} from './config';

const ALL = NAV_SECTIONS.flatMap((s) => s.items);
const STATUSES: NavStatus[] = ['live', 'soon', 'future'];

describe('nav/config', () => {
  it('is a grouped array of four sections in brief order', () => {
    expect(NAV_SECTIONS.map((s) => s.label)).toEqual(['Operate', 'Build', 'Knowledge', 'System']);
    for (const section of NAV_SECTIONS) {
      expect(section.id).toBeTruthy();
      expect(section.items.length).toBeGreaterThan(0);
    }
  });

  it('every destination has a unique id, a label, an icon and a valid status', () => {
    const ids = ALL.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length); // ids unique across ALL sections
    for (const dest of ALL) {
      expect(dest.label.length).toBeGreaterThan(0);
      expect(dest.icon.length).toBeGreaterThan(0);
      expect(STATUSES).toContain(dest.status);
    }
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

  it('lands on Board by default and Board is a live Operate destination', () => {
    expect(DEFAULT_DESTINATION).toBe('board');
    const board = ALL.find((d) => d.id === 'board');
    expect(board && isLive(board)).toBe(true);
    // Board is the first item of the first section.
    expect(NAV_SECTIONS[0].items[0].id).toBe('board');
  });

  it('exposes the brief §D destinations with the right build states', () => {
    const status = (id: DestinationId) => ALL.find((d) => d.id === id)?.status;
    // Reachable now.
    for (const id of ['board', 'approvals', 'timeline', 'editor', 'vibe', 'registry', 'browser'] as const) {
      expect(status(id)).toBe('live');
    }
    // Greyed placeholders (soon/future) — present in the IA, not yet built.
    expect(status('terminal')).toBe('soon');
    for (const id of ['pipeline', 'atlas', 'agents', 'ledgers', 'sentinel'] as const) {
      expect(status(id)).toBe('future');
    }
  });

  it('places each destination in its brief §D group', () => {
    const group = (id: DestinationId) =>
      NAV_SECTIONS.find((s) => s.items.some((d) => d.id === id))?.id;
    expect(group('board')).toBe('operate');
    expect(group('terminal')).toBe('operate');
    expect(group('editor')).toBe('build');
    expect(group('registry')).toBe('build');
    expect(group('browser')).toBe('knowledge');
    expect(group('sentinel')).toBe('system');
  });
});
