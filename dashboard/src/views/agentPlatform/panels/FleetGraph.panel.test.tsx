// @vitest-environment jsdom
/**
 * Fleet graph panel (Agent Platform, Wave-1 U14).
 *
 * The projection rules are exported pure functions, so they are pinned as DATA; only the click-to-
 * inspect behaviour goes through the DOM. Reactflow is mocked with the same idiom
 * `views/WorkflowAgentGraph.test.tsx` uses — it renders each node through its registered node type
 * and each edge as an inert div, which is exactly enough to assert what is drawn and what is not.
 *
 * The load-bearing negatives:
 *   - a `buildsOn` predecessor that is not a roster id must NOT become an edge (reactflow would drop
 *     it silently), and must still be visible as plain text;
 *   - a card dependency between two cards owned by the SAME agent is not a fleet relationship;
 *   - an unowned card names no agent, so it contributes nothing;
 *   - every edge label must read TRUE along its own arrow, and every edge must leave/arrive on the
 *     side nearest its counterpart rather than defaulting to top→top.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AgentRosterEntry } from '../../../../server/agents/roster';
import type { Dag } from '../../../../server/dag/graph';
import {
  buildsOnEdges,
  coordinationEdges,
  fleetNodeId,
  fleetNodes,
  keepDrawableEdges,
  roleColorClass,
} from './FleetGraph';
import { FleetGraphBody, panel } from './FleetGraph.panel';

vi.mock('reactflow', async () => {
  const React = await import('react');
  type MockNode = { id: string; type: string; position: { x: number; y: number }; data: unknown };
  type MockChange = { id: string; type: string; position?: { x: number; y: number } };
  type MockEdge = {
    id: string;
    source: string;
    target: string;
    label?: string;
    className?: string;
    ariaLabel?: string;
    markerEnd?: unknown;
    sourceHandle?: string;
    targetHandle?: string;
    style?: { strokeDasharray?: string };
  };
  return {
    Background: () => null,
    Controls: () => null,
    Handle: () => null,
    MarkerType: { ArrowClosed: 'arrowclosed' },
    Panel: ({ children }: { children: React.ReactNode }) => <div data-testid="reactflow-panel">{children}</div>,
    Position: { Top: 'top', Right: 'right', Bottom: 'bottom', Left: 'left' },
    ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    ReactFlow: ({ nodes, edges, nodeTypes, fitViewOptions, children }: {
      nodes: MockNode[];
      edges: MockEdge[];
      nodeTypes: Record<string, React.ComponentType<{ data: unknown }>>;
      fitViewOptions?: { padding?: number; minZoom?: number; maxZoom?: number };
      children: React.ReactNode;
    }) => <div data-testid="reactflow-mock" data-fit-max-zoom={String(fitViewOptions?.maxZoom)}>
      {nodes.map((node) => {
        const Component = nodeTypes[node.type]!;
        return (
          <div key={node.id} data-testid={`reactflow-position-${node.id}`} data-position={`${node.position.x},${node.position.y}`}>
            <Component data={node.data} />
          </div>
        );
      })}
      {edges.map((edge) => (
        <div
          key={edge.id}
          data-testid={`reactflow-edge-${edge.id}`}
          data-source={edge.source}
          data-target={edge.target}
          data-label={edge.label}
          data-class={edge.className}
          data-dashed={String(Boolean(edge.style?.strokeDasharray))}
          data-marker-end={String(Boolean(edge.markerEnd))}
          data-source-handle={edge.sourceHandle}
          data-target-handle={edge.targetHandle}
          aria-label={edge.ariaLabel}
        />
      ))}
      {children}
    </div>,
    useNodesState: (initial: MockNode[]) => {
      const [nodes, setNodes] = React.useState(initial);
      const onNodesChange = React.useCallback((changes: MockChange[]) => {
        setNodes((current) => current.map((node) => {
          const change = changes.find((candidate) => candidate.id === node.id && candidate.type === 'position' && candidate.position);
          return change?.position ? { ...node, position: change.position } : node;
        }));
      }, []);
      return [nodes, setNodes, onNodesChange];
    },
  };
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** A full roster entry with sane defaults — same shape the live `GET /api/agents` returns. */
function entry(over: Partial<AgentRosterEntry> & { id: string }): AgentRosterEntry {
  return {
    displayName: over.id,
    shortRef: 1,
    role: null,
    working: false,
    current: null,
    projects: [],
    cardCount: 0,
    ledger: { dispatches: 0, steps: 0, days: 0, lastActive: null },
    sources: [],
    effective: { runtime: 'claude', model: 'claude-opus-4-8', sourceRuntime: 'policy', sourceModel: 'policy' },
    declared: false,
    runnerBound: false,
    declaredRuntime: null,
    declaredModel: null,
    defaultProfile: null,
    allowedProfiles: null,
    description: null,
    ...over,
  };
}

/** A DAG node carrying only what the collapse reads: its id and its card owner. */
function dagNode(id: string, owner: string | null): Dag['nodes'][number] {
  return {
    id,
    data: {
      id,
      displayName: id,
      shortRef: 1,
      action: 'build',
      target: '.',
      state: 'working',
      summary: 'build',
      runtime: null,
      model: null,
      owner,
      project: 'kb',
      role: null,
      workflow: null,
      dependsOn: [],
      variantGroup: null,
      blocked: false,
    },
  };
}

/**
 * Both live role vocabularies are present on purpose: `claude-boss`/`codex` are DECLARED agents
 * carrying frontmatter roles (`manage`/`work`), while `inspector` is undeclared and so carries the
 * `routines/roles/` FILENAME `inspector` — the shape that used to render as an unknown role.
 */
const ROSTER: AgentRosterEntry[] = [
  entry({
    id: 'claude-boss',
    displayName: 'claude-boss',
    role: 'manage',
    working: true,
    declared: true,
    runnerBound: true,
    autonomyTier: 'T2',
    effective: { runtime: 'claude', model: 'claude-fable-5', sourceRuntime: 'override', sourceModel: 'override' },
  }),
  entry({
    id: 'codex',
    displayName: 'codex',
    role: 'work',
    declared: true,
    buildsOn: ['claude-boss', 'retired-scout'],
    whatItReplaces: 'the hand-run dispatch terminal',
    autonomyTier: 'T1',
    // The declared model is a string the resolver REFUSED; only `effective` may ever be shown.
    declaredModel: 'gpt-9-imaginary',
    effective: { runtime: 'codex', model: 'gpt-5.6-terra', sourceRuntime: 'policy', sourceModel: 'policy' },
  }),
  entry({ id: 'inspector', displayName: 'inspector', role: 'inspector' }),
];

const DAG: Dag = {
  nodes: [
    dagNode('c1', 'claude-boss'),
    dagNode('c2', 'codex'),
    dagNode('c3', 'codex'),
    dagNode('c4', 'inspector'),
    dagNode('c5', null),
  ],
  edges: [
    { id: 'e1', source: 'c1', target: 'c2' }, // claude-boss → codex
    { id: 'e2', source: 'c1', target: 'c3' }, // the SAME pair again — collapses to one edge
    { id: 'e3', source: 'c2', target: 'c3' }, // codex → codex: a self-pair, dropped
    { id: 'e4', source: 'c5', target: 'c4' }, // unowned source: skipped
    { id: 'e5', source: 'c3', target: 'c4' }, // codex → inspector
  ],
};

function stubFetch(roster: AgentRosterEntry[] = ROSTER, dag: Dag = DAG): void {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
    ok: true,
    status: 200,
    json: async () => (url === '/api/agents' ? roster : dag),
  })));
}

describe('fleetNodes', () => {
  it('maps one node per roster entry and namespaces the ids', () => {
    const nodes = fleetNodes(ROSTER);
    expect(nodes.map((n) => n.id)).toEqual(['agent:claude-boss', 'agent:codex', 'agent:inspector']);
    expect(fleetNodeId('codex')).toBe('agent:codex');
    expect(nodes[0]).toEqual({
      id: 'agent:claude-boss',
      agentId: 'claude-boss',
      role: 'manage',
      working: true,
      declared: true,
      runnerBound: true,
      displayName: 'claude-boss',
      model: 'claude-fable-5',
    });
    expect(nodes[2]).toMatchObject({ working: false, declared: false, runnerBound: false, role: 'inspector' });
  });

  it('carries the EFFECTIVE model and never the declared one', () => {
    // `codex` declares `gpt-9-imaginary`, which the resolver refused; re-surfacing it would print a
    // model nothing can run (the failure U4's review caught).
    expect(fleetNodes(ROSTER)[1]?.model).toBe('gpt-5.6-terra');
  });

  it('is empty-safe on a missing roster', () => {
    expect(fleetNodes(null)).toEqual([]);
    expect(fleetNodes(undefined)).toEqual([]);
  });
});

describe('coordinationEdges', () => {
  it('collapses card dependencies to one deduped edge per owner pair, skipping null owners and self-pairs', () => {
    const edges = coordinationEdges(DAG);
    expect(edges.map((e) => [e.source, e.target])).toEqual([
      ['agent:claude-boss', 'agent:codex'],
      ['agent:codex', 'agent:inspector'],
    ]);
    expect(edges.every((e) => e.kind === 'coordination')).toBe(true);
    // c2→c3 is codex→codex and c5 owns nobody: neither may appear in any form.
    expect(edges.some((e) => e.source === e.target)).toBe(false);
    expect(edges.length).toBe(2);
  });

  it('is empty-safe on a missing DAG', () => {
    expect(coordinationEdges(null)).toEqual([]);
    expect(coordinationEdges({ nodes: [], edges: [] })).toEqual([]);
  });
});

describe('buildsOnEdges', () => {
  it('draws only the predecessors that are fleet members and returns the rest as text data', () => {
    const { edges, unresolved } = buildsOnEdges(ROSTER);
    expect(edges).toEqual([
      {
        id: 'fleet-builds:codex~claude-boss',
        source: 'agent:codex',
        target: 'agent:claude-boss',
        kind: 'declared-buildsOn',
        resolved: true,
      },
    ]);
    // The unresolved predecessor is ABSENT from the edge list — reactflow would drop it silently.
    expect(edges.some((e) => e.target === 'agent:retired-scout')).toBe(false);
    expect(unresolved).toEqual([{ agentId: 'codex', predecessor: 'retired-scout' }]);
  });

  it('ignores blank and self predecessors', () => {
    const { edges, unresolved } = buildsOnEdges([entry({ id: 'solo', buildsOn: ['', '  ', 'solo'] })]);
    expect(edges).toEqual([]);
    expect(unresolved).toEqual([]);
  });
});

describe('roleColorClass', () => {
  it('maps every known role and never returns empty for anything else', () => {
    expect(roleColorClass('manage')).toBe('fg-role--manage');
    expect(roleColorClass('work')).toBe('fg-role--work');
    expect(roleColorClass('inspect')).toBe('fg-role--inspect');
    expect(roleColorClass('scout')).toBe('fg-role--scout');
    expect(roleColorClass('consolidate')).toBe('fg-role--consolidate');
    expect(roleColorClass(null)).toBe('fg-role--unknown');
    expect(roleColorClass(undefined)).toBe('fg-role--unknown');
    expect(roleColorClass('archivist')).toBe('fg-role--unknown');
    expect(roleColorClass('')).toBe('fg-role--unknown');
  });

  it('folds BOTH live role vocabularies onto one class set', () => {
    // Declared frontmatter says `work`; an undeclared agent gets the `routines/roles/` filename
    // `worker` from roleFor(). Both are the same role and must colour identically.
    expect(roleColorClass('worker')).toBe(roleColorClass('work'));
    expect(roleColorClass('manager')).toBe(roleColorClass('manage'));
    expect(roleColorClass('inspector')).toBe(roleColorClass('inspect'));
    expect(roleColorClass('consolidator')).toBe(roleColorClass('consolidate'));
    expect(roleColorClass('SCOUT')).toBe('fg-role--scout');
    expect(roleColorClass('worker')).toBe('fg-role--work');
    expect(roleColorClass('inspector')).toBe('fg-role--inspect');
  });
});

// `nearestHandles` moved to `src/lib/graphHandles.ts` (U12) — one routing rule for every reactflow
// graph in the app. Its unit tests moved with it, to `src/lib/graphHandles.test.ts`.

describe('keepDrawableEdges', () => {
  it('drops any edge whose endpoint is not a drawn node', () => {
    const nodes = fleetNodes(ROSTER);
    const ghost = { id: 'x', source: 'agent:codex', target: 'agent:ghost', kind: 'coordination' as const, resolved: true };
    expect(keepDrawableEdges([...coordinationEdges(DAG), ghost], nodes).map((e) => e.id))
      .toEqual(['fleet-coord:claude-boss~codex', 'fleet-coord:codex~inspector']);
  });
});

describe('the panel', () => {
  it('registers under a stable id', () => {
    expect(panel.id).toBe('fleet-graph');
    expect(panel.title.length).toBeGreaterThan(0);
    expect(panel.description.length).toBeGreaterThan(0);
  });

  it('renders the real roster as nodes and the proven relations as edges', async () => {
    stubFetch();
    render(<FleetGraphBody />);

    expect(await screen.findByTestId('fleet-node-claude-boss')).toBeTruthy();
    expect(screen.getByTestId('fleet-node-codex')).toBeTruthy();
    expect(screen.getByTestId('fleet-node-inspector')).toBeTruthy();
    // Status uses the app's ONE dot vocabulary, never a panel-local colour.
    expect(screen.getByTestId('fleet-node-dot-claude-boss').className).toContain('mc-status-dot--running');
    expect(screen.getByTestId('fleet-node-dot-codex').className).toContain('mc-status-dot--idle');
    expect(screen.getByTestId('fleet-node-claude-boss').querySelector('.fg-role--manage')).toBeTruthy();
    expect(screen.getByTestId('fleet-node-claude-boss').textContent).toContain('runner-bound');
    // An undeclared agent's role arrives as a routines/roles FILENAME and must still colour correctly.
    expect(screen.getByTestId('fleet-node-inspector').querySelector('.fg-role--inspect')).toBeTruthy();
    expect(screen.getByTestId('fleet-node-inspector').querySelector('.fg-role--unknown')).toBeNull();

    // EFFECTIVE model on the node; the refused `declaredModel` must never appear.
    const badge = screen.getByTestId('fleet-node-codex').querySelector('[data-testid="model-badge"]');
    expect(badge?.textContent).toBe('gpt-5.6-terra');
    expect(screen.getByTestId('fleet-node-codex').textContent).not.toContain('gpt-9-imaginary');
  });

  it('labels every edge so it reads TRUE along its own arrow', async () => {
    stubFetch();
    render(<FleetGraphBody />);

    // The arrow runs dependency-owner → dependent-owner (claude-boss's card gates codex's), so the
    // label must read "blocks": "depends on" would state the exact inverse of the arrow.
    const coordination = await screen.findByTestId('reactflow-edge-fleet-coord:claude-boss~codex');
    expect(coordination.getAttribute('data-source')).toBe('agent:claude-boss');
    expect(coordination.getAttribute('data-target')).toBe('agent:codex');
    expect(coordination.getAttribute('data-label')).toBe('blocks');
    expect(coordination.getAttribute('data-label')).not.toBe('depends on');
    expect(coordination.getAttribute('aria-label'))
      .toBe("claude-boss blocks codex (codex's work depends on claude-boss)");
    expect(coordination.getAttribute('data-marker-end')).toBe('true');
    expect(coordination.getAttribute('data-dashed')).toBe('false');

    // The lineage arrow runs agent → predecessor, so "builds on" already reads with it.
    const lineage = screen.getByTestId('reactflow-edge-fleet-builds:codex~claude-boss');
    expect(lineage.getAttribute('data-source')).toBe('agent:codex');
    expect(lineage.getAttribute('data-target')).toBe('agent:claude-boss');
    expect(lineage.getAttribute('data-label')).toBe('builds on');
    expect(lineage.getAttribute('aria-label')).toBe('codex builds on claude-boss');
    expect(lineage.getAttribute('data-dashed')).toBe('true');
  });

  /**
   * Handles are asserted on the FIRST frame the edges exist — deliberately, and synchronously after
   * the first edge appears. Edge routing reads node positions out of `useNodesState`, which lags the
   * projection by one effect flush; before U12 seeded the routing map from the computed grid, this
   * frame routed every arrow through the unmeasured right→left fallback and then jumped, which is
   * both a visible flash and what made this test intermittent.
   */
  it('routes every edge through facing handles rather than reactflow’s top→top fallback', async () => {
    stubFetch();
    render(<FleetGraphBody />);

    // claude-boss sits left of codex on the grid; codex sits right of claude-boss.
    const coordination = await screen.findByTestId('reactflow-edge-fleet-coord:claude-boss~codex');
    expect(coordination.getAttribute('data-source-handle')).toBe('source-right');
    expect(coordination.getAttribute('data-target-handle')).toBe('target-left');

    const lineage = screen.getByTestId('reactflow-edge-fleet-builds:codex~claude-boss');
    expect(lineage.getAttribute('data-source-handle')).toBe('source-left');
    expect(lineage.getAttribute('data-target-handle')).toBe('target-right');

    for (const edge of Array.from(document.querySelectorAll('[data-testid^="reactflow-edge-"]'))) {
      expect(edge.getAttribute('data-source-handle')).toBeTruthy();
      expect(edge.getAttribute('data-target-handle')).toBeTruthy();
    }
  });

  it('opens a node into its own inspect pane, and closes it again', async () => {
    stubFetch();
    render(<FleetGraphBody />);

    fireEvent.click(await screen.findByTestId('fleet-node-codex'));
    const inspect = screen.getByTestId('fleet-inspect');
    expect(inspect.textContent).toContain('codex');
    expect(inspect.textContent).toContain('work');
    expect(screen.getByTestId('fleet-inspect-replaces').textContent).toContain('the hand-run dispatch terminal');
    expect(screen.getByTestId('fleet-inspect-tier').textContent).toBe('T1');
    expect(inspect.textContent).toContain('declared ceiling (advisory)');
    expect(inspect.querySelector('[data-testid="model-badge"]')?.textContent).toBe('gpt-5.6-terra');
    // The resolved predecessor is a jump control; clicking it highlights that node rather than navigating.
    fireEvent.click(screen.getByRole('button', { name: 'claude-boss' }));
    expect(screen.getByTestId('fleet-node-claude-boss').className).toContain('fg-node--highlighted');

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('fleet-inspect')).toBeNull();
  });

  it('prints an unresolved predecessor as text and never as an edge', async () => {
    stubFetch();
    render(<FleetGraphBody />);

    const list = await screen.findByTestId('fleet-unresolved-list');
    expect(list.textContent).toContain('retired-scout');
    expect(screen.queryByTestId('reactflow-edge-fleet-builds:codex~retired-scout')).toBeNull();
    // No ghost node was fabricated to receive it either.
    expect(screen.queryByTestId('fleet-node-retired-scout')).toBeNull();
  });

  it('states a failed load instead of throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })));
    render(<FleetGraphBody />);
    await waitFor(() => expect(screen.getByTestId('fleet-graph-error')).toBeTruthy());
    expect(screen.queryByTestId('reactflow-mock')).toBeNull();
  });

  it('says there is nothing to connect instead of a legend about arrows it did not draw', async () => {
    // The live default on this checkout: agents exist, every queue card has `depends-on: []`, and no
    // declaration names a predecessor.
    stubFetch(
      [entry({ id: 'claude-boss', role: 'manage' }), entry({ id: 'codex', role: 'worker' })],
      { nodes: [dagNode('c1', 'claude-boss'), dagNode('c2', 'codex')], edges: [] },
    );
    render(<FleetGraphBody />);

    expect(await screen.findByTestId('fleet-node-claude-boss')).toBeTruthy();
    expect(document.querySelectorAll('[data-testid^="reactflow-edge-"]').length).toBe(0);
    const note = screen.getByTestId('fleet-graph-no-edges');
    expect(note.textContent).toContain('No cross-agent dependencies in the current queue');
    expect(note.textContent).toContain('no builds-on declarations');
    // The legend must not describe arrow kinds the canvas does not contain.
    expect(screen.getByTestId('reactflow-panel').textContent).not.toContain('blocks');
    expect(screen.getByTestId('reactflow-panel').textContent).not.toContain('builds on');
  });

  it('drops the no-relations note as soon as there is a relation to draw', async () => {
    stubFetch();
    render(<FleetGraphBody />);
    await screen.findByTestId('fleet-node-codex');
    expect(screen.queryByTestId('fleet-graph-no-edges')).toBeNull();
    expect(screen.getByTestId('reactflow-panel').textContent).toContain('along the arrow');
  });

  it('says so when the roster is empty', async () => {
    stubFetch([], { nodes: [], edges: [] });
    render(<FleetGraphBody />);
    expect(await screen.findByTestId('fleet-graph-empty')).toBeTruthy();
  });
});
