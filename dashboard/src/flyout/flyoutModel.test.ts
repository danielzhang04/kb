/**
 * U4 — flyout summary model. Pure derivation of a live contents summary from the Plane-A snapshot +
 * registry. Every summary degrades to `empty` on missing/zero data (the Flyout then renders nothing).
 */
import { describe, expect, it } from 'vitest';
import type { PlaneAIndex } from '../../server/planeA/indexer';
import type { ParsedCard } from '../../server/planeA/cards';
import { FLYOUT_DESTINATIONS, summaryFor, type RegistrySnapshot } from './flyoutModel';

function card(meta: Record<string, unknown>): ParsedCard {
  return { meta: meta as ParsedCard['meta'], body: '' };
}

const EMPTY: PlaneAIndex = {
  cards: {},
  ledgers: {
    dispatch: { count: 0, cards: 0, byProject: {} },
    cost: { stepCount: 0, perModelSteps: {}, modelMix: {}, usdPresent: false },
    grades: { count: 0, rows: [] },
    activity: { count: 0, rows: [] },
  },
  orgStates: [],
};

const POPULATED: PlaneAIndex = {
  cards: {
    inbox: [card({ id: 'c_inbox', state: 'inbox' })],
    working: [
      card({ id: 'c_w1', state: 'working', owner: 'claude/m1', action: 'build' }),
      card({ id: 'c_w2', state: 'working', owner: 'codex/x', action: 'test' }),
    ],
    approvals: [card({ id: 'c_appr', state: 'approvals', owner: 'claude/m1', 'risk-tier': 'T3' })],
  },
  ledgers: {
    dispatch: { count: 12, cards: 5, byProject: { kb: 12 } },
    cost: { stepCount: 340, perModelSteps: { opus: 200, sonnet: 140 }, modelMix: { opus: 0.6, sonnet: 0.4 }, usdPresent: true },
    grades: { count: 0, rows: [] },
    activity: { count: 0, rows: [] },
  },
  orgStates: [
    { project: 'kb', now: 'x', next: 'y', blocked: '' } as PlaneAIndex['orgStates'][number],
    { project: 'ecc', now: 'a', next: 'b', blocked: '' } as PlaneAIndex['orgStates'][number],
  ],
};

const REGISTRY: RegistrySnapshot = {
  workflows: {
    present: true,
    items: [{ id: 'wf_build', path: 'workflows/wf_build.md', name: 'wf_build', status: 'registered' }],
  },
  connections: {
    count: 2,
    items: [
      { project: 'kb', server: 'Gmail', tools: ['a', 'b'] },
      { project: 'ecc', server: 'Drive', tools: ['c'] },
    ],
    byProject: {},
  },
};

describe('summaryFor — populated', () => {
  it('tasks: counts per state + top working ids', () => {
    const s = summaryFor('tasks', POPULATED, {})!;
    expect(s.empty).toBe(false);
    expect(s.lines.find((l) => l.label === 'working')?.value).toBe(2);
    expect(s.lines.find((l) => l.label === 'inbox')?.value).toBe(1);
    expect(s.ids).toEqual(['c_w1', 'c_w2']);
  });

  it('agents: working owners', () => {
    const s = summaryFor('agents', POPULATED, {})!;
    expect(s.lines.find((l) => l.label === 'working')?.value).toBe(2);
    expect(s.ids).toEqual(['claude/m1', 'codex/x']);
  });

  it('approvals: pending count + ids', () => {
    const s = summaryFor('approvals', POPULATED, {})!;
    expect(s.lines[0]).toEqual({ label: 'pending', value: 1 });
    expect(s.ids).toEqual(['c_appr']);
  });

  it('workflows + connectors come from the registry', () => {
    expect(summaryFor('workflows', EMPTY, REGISTRY)!.lines[0].value).toBe(1);
    const conn = summaryFor('connectors', EMPTY, REGISTRY)!;
    expect(conn.lines.find((l) => l.label === 'connections')?.value).toBe(2);
    expect(conn.ids).toContain('Gmail');
  });

  it('ledgers: usage figures', () => {
    const s = summaryFor('ledgers', POPULATED, {})!;
    expect(s.lines.find((l) => l.label === 'steps')?.value).toBe(340);
    expect(s.lines.find((l) => l.label === 'models')?.value).toBe(2);
  });
});

describe('summaryFor — empty & non-flyout', () => {
  it('every flyout destination is empty on the empty snapshot', () => {
    for (const id of FLYOUT_DESTINATIONS) {
      expect(summaryFor(id, EMPTY, {})?.empty).toBe(true);
    }
  });

  it('returns null for destinations without a flyout', () => {
    expect(summaryFor('home', POPULATED, REGISTRY)).toBeNull();
    expect(summaryFor('activity', POPULATED, REGISTRY)).toBeNull();
  });
});
