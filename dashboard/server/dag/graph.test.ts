/**
 * D3.4 — the pipeline DAG projection. `buildDag` is a PURE function over the Plane-A index: it turns
 * the card queue into a `{ nodes, edges }` graph whose edges are the queue's `depends-on` relations.
 * A node whose `depends-on` target is not in a released (`done`) state is marked `blocked`, and cards
 * sharing a `variant-group` carry that group so the canvas can cluster the siblings.
 */
import { describe, expect, it } from 'vitest';
import { buildDag } from './graph.ts';
import type { ParsedCard } from '../planeA/cards.ts';

function card(over: Partial<ParsedCard['meta']> & { id: string }): ParsedCard {
  return {
    meta: {
      project: 'kb',
      action: 'noop',
      target: 'x',
      'risk-tier': 'T1',
      owner: null,
      state: 'inbox',
      ...over,
    },
    body: '',
  };
}

/** A minimal index (only `cards` matters to buildDag) grouped by state, like PlaneAIndex.cards. */
function indexOf(cards: ParsedCard[]): { cards: Record<string, ParsedCard[]> } {
  const grouped: Record<string, ParsedCard[]> = {};
  for (const c of cards) (grouped[String(c.meta.state)] ??= []).push(c);
  return { cards: grouped };
}

describe('buildDag', () => {
  it('builds one node per card and one edge per depends-on relation (dependency → dependent)', () => {
    const dag = buildDag(
      indexOf([
        card({ id: 'a', state: 'done' }),
        card({ id: 'b', state: 'working', 'depends-on': ['a'] }),
      ]),
    );
    expect(dag.nodes.map((n) => n.id).sort()).toEqual(['a', 'b']);
    // Edge points FROM the dependency (a) TO the dependent (b).
    expect(dag.edges).toHaveLength(1);
    expect(dag.edges[0]).toMatchObject({ source: 'a', target: 'b' });
  });

  it('marks variant-group siblings with their shared group', () => {
    const dag = buildDag(
      indexOf([
        card({ id: 'v1', 'variant-group': 'grp-1' }),
        card({ id: 'v2', 'variant-group': 'grp-1' }),
        card({ id: 'solo' }),
      ]),
    );
    const byId = new Map(dag.nodes.map((n) => [n.id, n.data]));
    expect(byId.get('v1')?.variantGroup).toBe('grp-1');
    expect(byId.get('v2')?.variantGroup).toBe('grp-1');
    expect(byId.get('solo')?.variantGroup).toBeNull();
    // The two siblings share the same group id — the canvas clusters on it.
    const siblings = dag.nodes.filter((n) => n.data.variantGroup === 'grp-1').map((n) => n.id).sort();
    expect(siblings).toEqual(['v1', 'v2']);
  });

  it('marks a node blocked when a depends-on target is not in a released (done) state', () => {
    const dag = buildDag(
      indexOf([
        card({ id: 'dep', state: 'working' }), // not done → unreleased
        card({ id: 'child', state: 'inbox', 'depends-on': ['dep'] }),
        card({ id: 'released-dep', state: 'done' }),
        card({ id: 'free', state: 'inbox', 'depends-on': ['released-dep'] }),
      ]),
    );
    const byId = new Map(dag.nodes.map((n) => [n.id, n.data]));
    expect(byId.get('child')?.blocked).toBe(true); // dep is `working`, not released
    expect(byId.get('free')?.blocked).toBe(false); // released-dep is `done`
    expect(byId.get('dep')?.blocked).toBe(false); // no dependencies of its own
  });

  it('treats a depends-on target that is absent from the index as unreleased (blocked, no dangling edge)', () => {
    const dag = buildDag(indexOf([card({ id: 'orphan', 'depends-on': ['ghost'] })]));
    const node = dag.nodes.find((n) => n.id === 'orphan');
    expect(node?.data.blocked).toBe(true);
    // No edge is emitted to a node that does not exist (reactflow would warn on a dangling edge).
    expect(dag.edges).toHaveLength(0);
  });

  it('carries the display fields each node renders (summary, stamped model/runtime, state)', () => {
    const dag = buildDag(
      indexOf([card({ id: 'c1', action: 'run-build', target: 'src/', state: 'working', model: 'claude-opus-4-8', runtime: 'claude' })]),
    );
    const data = dag.nodes[0].data;
    expect(data.state).toBe('working');
    expect(data.model).toBe('claude-opus-4-8');
    expect(data.runtime).toBe('claude');
    expect(data.summary).toContain('run-build');
  });
});
