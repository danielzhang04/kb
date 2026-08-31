import { describe, expect, it } from 'vitest';
import { DEFAULT_DESTINATION, NAV_SECTIONS, isLive } from './config';

const ALL = NAV_SECTIONS.flatMap((section) => section.items);

describe('nav/config', () => {
  it('pins the exact P1 ids, order, and two divider boundaries', () => {
    expect(NAV_SECTIONS.map((section) => section.items.map((destination) => destination.id))).toEqual([
      ['home', 'inbox', 'schedules', 'terminal'],
      ['agents', 'workflows', 'projects', 'files'],
      ['health'],
    ]);
    expect(ALL.map((destination) => destination.label)).toEqual([
      'Home', 'Inbox', 'Schedules', 'Terminal', 'Agents', 'Workflows', 'Projects', 'Files', 'Health',
    ]);
  });

  it('uses three unlabelled sections and unique live destinations', () => {
    expect(NAV_SECTIONS.map((section) => section.id)).toEqual(['primary', 'entities', 'system']);
    expect(NAV_SECTIONS.every((section) => !('label' in section))).toBe(true);
    expect(new Set(ALL.map((destination) => destination.id)).size).toBe(9);
    expect(new Set(ALL.map((destination) => destination.icon)).size).toBe(9);
    expect(ALL.every(isLive)).toBe(true);
  });

  it('lands on Home and contains no retired destination', () => {
    expect(DEFAULT_DESTINATION).toBe('home');
    const ids = new Set<string>(ALL.map((destination) => destination.id));
    for (const retired of [
      'approvals', 'activity', 'atlas', 'connectors', 'ledgers', 'sentinel', 'agentPlatform',
      'board', 'editor', 'vibe', 'skills', 'registry', 'pipeline', 'runCanvas', 'timeline', 'browser',
    ]) expect(ids.has(retired)).toBe(false);
  });
});
