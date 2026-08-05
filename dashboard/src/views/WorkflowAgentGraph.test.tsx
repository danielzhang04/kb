// @vitest-environment jsdom
/**
 * The workflow graph is STAGE-keyed: one box per step, arrows from the steps' own `dependsOn`.
 *
 * The headline test is the regression pin. Real definitions carry `manager: null` and no per-step
 * assignment at all; the previous agent-keyed projection collapsed every such workflow into a single
 * "Nobody yet" box with zero arrows, which is what "I see nothing in the agent graph" was. A
 * fourteen-step chain with nobody assigned must still draw fourteen boxes and its full chain of arrows.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { WorkflowDefEntry } from './WorkflowDetail';
import {
  MANAGER_NODE,
  WorkflowAgentGraph,
  dependencyEdges,
  stageNodeId,
  stageNodePositions,
  stageRanks,
  stageSlot,
  type ResolvedAssignment,
  type WorkflowAssignmentOptions,
} from './WorkflowAgentGraph';

vi.mock('reactflow', async () => {
  const React = await import('react');
  type MockNode = { id: string; type: string; position: { x: number; y: number }; data: unknown };
  type MockChange = { id: string; type: string; position?: { x: number; y: number } };
  type MockEdge = {
    id: string;
    source: string;
    target: string;
    markerEnd?: unknown;
    sourceHandle?: string;
    targetHandle?: string;
    ariaLabel?: string;
  };
  return {
    Background: () => null,
    Controls: () => null,
    Handle: () => null,
    MarkerType: { ArrowClosed: 'arrowclosed' },
    Panel: ({ children }: { children: React.ReactNode }) => <div data-testid="reactflow-panel">{children}</div>,
    Position: { Top: 'top', Right: 'right', Bottom: 'bottom', Left: 'left' },
    ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    ReactFlow: ({ nodes, edges, nodeTypes, onNodesChange, children }: {
      nodes: MockNode[];
      edges: MockEdge[];
      nodeTypes: Record<string, React.ComponentType<{ data: unknown }>>;
      onNodesChange: (changes: MockChange[]) => void;
      children: React.ReactNode;
    }) => <div data-testid="reactflow-mock">
      {nodes.map((node) => {
        const Component = nodeTypes[node.type]!;
        return <div key={node.id} data-testid={`reactflow-position-${node.id}`} data-position={`${node.position.x},${node.position.y}`}><Component data={node.data} /></div>;
      })}
      {edges.map((edge) => (
        <div
          key={edge.id}
          data-testid={`reactflow-edge-${edge.id}`}
          data-source={edge.source}
          data-target={edge.target}
          data-marker-end={String(Boolean(edge.markerEnd))}
          data-source-handle={edge.sourceHandle}
          data-target-handle={edge.targetHandle}
          aria-label={edge.ariaLabel}
        />
      ))}
      {children}
      <button type="button" onClick={() => onNodesChange([{ id: 'stage:draft', type: 'position', position: { x: 0, y: 0 } }])}>Move the draft step</button>
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

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const assign = (agentId: string) => ({ agentId, profileId: `worker:${agentId}` });
const resolved = (over: Partial<ResolvedAssignment> & { agentId: string }): ResolvedAssignment => ({
  profileId: `worker:${over.agentId}`, model: 'claude-sonnet-5', source: 'declared', ...over,
});

const entry = (over: Partial<WorkflowDefEntry> = {}): WorkflowDefEntry => ({
  ref: 'kb~network.md', displayName: over.title ?? 'Network', shortRef: 1,
  project: 'kb-ops', path: 'orgs/kb-ops/workflows/network.md', sourceHash: 'a'.repeat(64),
  valid: true, title: 'Network', profile: null, stageCount: 3, riskTier: 'T2', detail: null,
  manager: assign('alpha'),
  stages: [
    { id: 'research', title: 'Research', action: 'research', target: 'notes.md', riskTier: 'T1', declaredAssignment: assign('alpha') },
    { id: 'draft', title: 'Draft', action: 'draft', target: 'draft.md', riskTier: 'T1', dependsOn: ['research'], declaredAssignment: assign('beta') },
    { id: 'review', title: 'Review', action: 'review', target: 'review.md', riskTier: 'T2', dependsOn: ['draft'], declaredAssignment: null },
  ],
  ...over,
});

const options = (over: Partial<WorkflowAssignmentOptions> = {}): WorkflowAssignmentOptions => ({
  manager: { options: [assign('alpha'), assign('beta')], unavailable: null },
  stages: {
    research: { options: [assign('alpha'), assign('beta')], unavailable: null },
    draft: { options: [assign('alpha'), assign('beta')], unavailable: null },
    review: { options: [assign('alpha'), assign('beta')], unavailable: null },
  },
  ...over,
});

/** The shape live `/api/workflows` actually returns: no manager, no assignment, a real chain. */
const bare = (): WorkflowDefEntry => entry({
  manager: null,
  stageCount: 5,
  stages: [
    { id: 'idea', title: 'Idea', action: 'idea', target: 'idea.md', riskTier: 'T1', declaredAssignment: null },
    { id: 'research', title: 'Research', action: 'research', target: 'research.md', riskTier: 'T1', dependsOn: ['idea'], declaredAssignment: null },
    { id: 'script', title: 'Script', action: 'script', target: 'script.md', riskTier: 'T1', dependsOn: ['research'], declaredAssignment: null },
    { id: 'judge-gate', title: 'Judge', action: 'judge', target: 'judgement.md', riskTier: 'T2', dependsOn: ['script'], declaredAssignment: null },
    { id: 'render', title: 'Render', action: 'render', target: 'final.mp4', riskTier: 'T2', dependsOn: ['judge-gate'], declaredAssignment: null },
  ],
});

describe('the graph draws the workflow, assigned or not', () => {
  /**
   * THE PIN. `manager: null` and every `declaredAssignment: null` is the live payload, not an edge case.
   */
  it('renders every step and every dependency of a workflow nobody has been assigned to', () => {
    render(<WorkflowAgentGraph entry={bare()} />);

    for (const [id, title] of [['idea', 'Idea'], ['research', 'Research'], ['script', 'Script'], ['judge-gate', 'Judge'], ['render', 'Render']]) {
      expect(screen.getByTestId(`workflow-step-node-${id}`).textContent).toContain(title);
    }
    expect(screen.getByTestId('reactflow-edge-step-idea~research')).toBeTruthy();
    expect(screen.getByTestId('reactflow-edge-step-research~script')).toBeTruthy();
    expect(screen.getByTestId('reactflow-edge-step-script~judge-gate')).toBeTruthy();
    expect(screen.getByTestId('reactflow-edge-step-judge-gate~render')).toBeTruthy();
    // No manager to draw, and no phantom "everything hands off to nobody" collapse.
    expect(screen.queryByTestId('workflow-manager-node')).toBeNull();
    expect(dependencyEdges(bare())).toHaveLength(4);
  });

  it('names each arrow in plain words and points it at the step that runs later', () => {
    const edge = dependencyEdges(bare()).find((candidate) => candidate.id === 'step-script~judge-gate');
    expect(edge).toMatchObject({
      source: stageNodeId('script'),
      target: stageNodeId('judge-gate'),
      markerEnd: expect.objectContaining({ type: 'arrowclosed' }),
    });
    expect(edge?.ariaLabel).toBe('Judge runs after Script');
  });

  it('skips a dependency naming a step this workflow does not declare', () => {
    const edges = dependencyEdges(entry({ manager: null, stages: [
      { id: 'one', action: 'one', target: 'one', riskTier: 'T1' },
      { id: 'two', action: 'two', target: 'two', riskTier: 'T1', dependsOn: ['one', 'missing'] },
    ] }));
    expect(edges.map((edge) => edge.id)).toEqual(['step-one~two']);
  });

  it('lays steps out in dependency lanes, with the manager in front of the first step', () => {
    const workflow = entry();
    expect(Object.fromEntries(stageRanks(workflow))).toEqual({ research: 0, draft: 1, review: 2 });
    const positions = stageNodePositions(workflow);
    expect(positions.get(MANAGER_NODE)).toEqual({ x: 0, y: 0 });
    expect(positions.get(stageNodeId('research'))).toEqual({ x: 400, y: 0 });
    expect(positions.get(stageNodeId('draft'))).toEqual({ x: 800, y: 0 });
    expect(positions.get(stageNodeId('review'))).toEqual({ x: 1200, y: 0 });
    // Nobody running the workflow → no empty lane held open for a manager that does not exist.
    expect(stageNodePositions(bare()).get(stageNodeId('idea'))).toEqual({ x: 0, y: 0 });
  });

  it('stacks steps that can run at the same time into rows of one lane', () => {
    const workflow = entry({ manager: null, stages: [
      { id: 'shots', action: 'shots', target: 'shots', riskTier: 'T1' },
      { id: 'images', action: 'images', target: 'images', riskTier: 'T1', dependsOn: ['shots'] },
      { id: 'motion', action: 'motion', target: 'motion', riskTier: 'T1', dependsOn: ['shots'] },
    ] });
    const positions = stageNodePositions(workflow);
    expect(positions.get(stageNodeId('images'))).toEqual({ x: 400, y: 0 });
    expect(positions.get(stageNodeId('motion'))).toEqual({ x: 400, y: 240 });
  });

  it('renders a malformed step cycle instead of recursing forever', () => {
    const workflow = entry({ manager: null, stages: [
      { id: 'a', action: 'a', target: 'a', riskTier: 'T1', dependsOn: ['b'] },
      { id: 'b', action: 'b', target: 'b', riskTier: 'T1', dependsOn: ['a'] },
    ] });
    render(<WorkflowAgentGraph entry={workflow} />);
    expect(screen.getByTestId('workflow-step-node-a')).toBeTruthy();
    expect(screen.getByTestId('workflow-step-node-b')).toBeTruthy();
  });

  it('says so plainly when a workflow has no steps yet', () => {
    render(<WorkflowAgentGraph entry={entry({ stages: [], manager: null })} />);
    expect(screen.getByTestId('workflow-agent-network-empty').textContent).toContain('no steps');
  });
});

describe('who will run each step', () => {
  it('shows a resolved default with a default tag, its model, and where it came from', () => {
    const workflow = entry({ manager: null, stages: [
      {
        id: 'script', title: 'Script', action: 'script', target: 'script.md', riskTier: 'T1',
        declaredAssignment: null,
        resolvedAssignment: resolved({ agentId: 'fyt-preproduction', source: 'stage-governed-by', model: 'claude-opus-4-8' }),
      },
    ] });
    render(<WorkflowAgentGraph entry={workflow} />);

    const slot = screen.getByTestId('workflow-step-node-script-agent');
    expect(slot.textContent).toContain('fyt-preproduction');
    expect(slot.textContent).toContain('claude-opus-4-8');
    expect(slot.textContent).toContain('default');
    expect(slot.querySelector('[title]')?.getAttribute('title')).toBe('The agent that governs this step.');
    // A resolved default is the wanted case, so the box never asks anybody to go and assign anything.
    expect(screen.getByTestId('workflow-step-node-script').textContent).not.toMatch(/assign/i);
  });

  it('shows an explicitly declared agent with no default tag', () => {
    const workflow = entry({ manager: null, stages: [
      {
        id: 'draft', title: 'Draft', action: 'draft', target: 'draft.md', riskTier: 'T1',
        declaredAssignment: assign('beta'),
        resolvedAssignment: resolved({ agentId: 'beta', source: 'declared' }),
      },
    ] });
    render(<WorkflowAgentGraph entry={workflow} />);
    const slot = screen.getByTestId('workflow-step-node-draft-agent');
    expect(slot.textContent).toContain('beta');
    expect(slot.textContent).not.toContain('default');
  });

  it('omits the model when the roster does not pin one', () => {
    const workflow = entry({ manager: null, stages: [
      {
        id: 'draft', title: 'Draft', action: 'draft', target: 'draft.md', riskTier: 'T1',
        resolvedAssignment: resolved({ agentId: 'beta', source: 'manager-default', model: null }),
      },
    ] });
    render(<WorkflowAgentGraph entry={workflow} />);
    const slot = screen.getByTestId('workflow-step-node-draft-agent');
    expect(slot.textContent).toContain('beta');
    expect(slot.textContent).toContain('default');
    expect(slot.textContent).not.toMatch(/claude-/);
  });

  it('states an unresolvable slot as a fact, never as a job to do', () => {
    const workflow = entry({ manager: null, stages: [
      { id: 'draft', title: 'Draft', action: 'draft', target: 'draft.md', riskTier: 'T1', declaredAssignment: null },
    ] });
    render(<WorkflowAgentGraph entry={workflow} />);
    const empty = screen.getByTestId('workflow-step-node-draft-nobody');
    expect(empty.textContent).toBe('no default agent resolvable');
    expect(screen.getByTestId('workflow-step-node-draft').textContent).not.toMatch(/assign|unassigned|nobody yet/i);
  });

  it('carries a varied per-step cast rather than one name repeated down the column', () => {
    const workflow = entry({ manager: null, stages: [
      { id: 'script', title: 'Script', action: 'script', target: 's', riskTier: 'T1', resolvedAssignment: resolved({ agentId: 'fyt-preproduction', source: 'stage-governed-by' }) },
      { id: 'judge-gate', title: 'Judge', action: 'judge', target: 'j', riskTier: 'T2', dependsOn: ['script'], resolvedAssignment: resolved({ agentId: 'fyt-checker', source: 'stage-governed-by' }) },
      { id: 'render', title: 'Render', action: 'render', target: 'r', riskTier: 'T2', dependsOn: ['judge-gate'], resolvedAssignment: resolved({ agentId: 'fyt-production', source: 'stage-governed-by' }) },
    ] });
    render(<WorkflowAgentGraph entry={workflow} />);
    expect(screen.getByTestId('workflow-step-node-script-agent').textContent).toContain('fyt-preproduction');
    expect(screen.getByTestId('workflow-step-node-judge-gate-agent').textContent).toContain('fyt-checker');
    expect(screen.getByTestId('workflow-step-node-render-agent').textContent).toContain('fyt-production');
  });

  /** An older payload predates `resolvedAssignment`; the declaration in the file is still the truth. */
  it('falls back to the step governing agent when the server sent no resolution', () => {
    const stage = { id: 'script', action: 'script', target: 's', riskTier: 'T1', governedBy: 'fyt-preproduction' };
    expect(stageSlot(stage)).toEqual({ agentId: 'fyt-preproduction', model: null, source: 'stage-governed-by', isDefault: true });
    render(<WorkflowAgentGraph entry={entry({ manager: null, stages: [stage] })} />);
    expect(screen.getByTestId('workflow-step-node-script-agent').textContent).toContain('fyt-preproduction');
    expect(screen.getByTestId('workflow-step-node-script-agent').textContent).toContain('default');
  });

  it('keeps a manager box for the agent that runs the workflow, resolved or declared', () => {
    render(<WorkflowAgentGraph entry={entry()} />);
    expect(screen.getByTestId('workflow-manager-node').textContent).toContain('runs the workflow');
    expect(screen.getByTestId('workflow-manager-node-agent').textContent).toContain('alpha');
    cleanup();

    render(<WorkflowAgentGraph entry={entry({ manager: null, governedBy: 'fyt-runner' })} />);
    const manager = screen.getByTestId('workflow-manager-node-agent');
    expect(manager.textContent).toContain('fyt-runner');
    expect(manager.textContent).toContain('default');
    // The manager kicks off every step that starts the workflow.
    expect(screen.getByTestId('reactflow-edge-start-research').dataset.source).toBe(MANAGER_NODE);
  });

  it('opens the agent a step will run as, without a network write', () => {
    const onOpenAgent = vi.fn();
    vi.stubGlobal('fetch', vi.fn());
    render(<WorkflowAgentGraph entry={entry()} onOpenAgent={onOpenAgent} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Open agent' })[2]);
    expect(onOpenAgent).toHaveBeenCalledWith('beta');
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('the override, which is the same one governed write', () => {
  it('edits one step through the caller governed write, with no local draft and no batch submit', () => {
    const onAssign = vi.fn();
    vi.stubGlobal('fetch', vi.fn());
    render(<WorkflowAgentGraph entry={entry()} assignmentOptions={options()} onAssign={onAssign} />);

    fireEvent.change(screen.getByLabelText('Who runs Draft'), { target: { value: JSON.stringify(['alpha', 'worker:alpha']) } });
    expect(onAssign).toHaveBeenCalledWith({ kind: 'stage', stageId: 'draft' }, assign('alpha'));

    fireEvent.change(screen.getByLabelText('Who runs the workflow'), { target: { value: JSON.stringify(['beta', 'worker:beta']) } });
    expect(onAssign).toHaveBeenLastCalledWith({ kind: 'manager' }, assign('beta'));

    // Clearing an override is the same one write with a null assignment — the default takes over again.
    fireEvent.change(screen.getByLabelText('Who runs Research'), { target: { value: '' } });
    expect(onAssign).toHaveBeenLastCalledWith({ kind: 'stage', stageId: 'research' }, null);

    // The graph itself never talks to the network; the detail's caller owns the request.
    expect(fetch).not.toHaveBeenCalled();
  });

  it('offers keeping the default rather than choosing nobody', () => {
    render(<WorkflowAgentGraph entry={entry()} assignmentOptions={options()} />);
    expect((screen.getByLabelText('Who runs Review') as HTMLSelectElement).options[0].textContent).toBe('Keep the default');
  });

  it('states an unavailable choice rather than offering an empty picker', () => {
    render(<WorkflowAgentGraph
      entry={entry()}
      assignmentOptions={options({ stages: { ...options().stages, draft: { options: [], unavailable: 'Human binding required.' } } })}
    />);
    expect(screen.getByTestId('workflow-step-node-draft').textContent).toContain('Human binding required.');
    expect(screen.queryByLabelText('Who runs Draft')).toBeNull();
  });

  it('keeps the current pair listed even after it stops being eligible', () => {
    render(<WorkflowAgentGraph
      entry={entry()}
      assignmentOptions={options({ stages: { ...options().stages, draft: { options: [assign('alpha')], unavailable: null } } })}
    />);
    const picker = screen.getByLabelText('Who runs Draft') as HTMLSelectElement;
    expect(picker.value).toBe(JSON.stringify(['beta', 'worker:beta']));
  });

  it('freezes every picker while a change is in flight', () => {
    render(<WorkflowAgentGraph entry={entry()} assignmentOptions={options()} readOnly />);
    expect((screen.getByLabelText('Who runs Draft') as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText('Who runs the workflow') as HTMLSelectElement).disabled).toBe(true);
  });
});

describe('the canvas', () => {
  it('retains a dragged position and reroutes its edges through it', () => {
    render(<WorkflowAgentGraph entry={entry()} assignmentOptions={options()} />);
    expect(screen.getByTestId('reactflow-edge-step-research~draft').dataset.sourceHandle).toBe('source-right');
    fireEvent.click(screen.getByRole('button', { name: 'Move the draft step' }));
    expect(screen.getByTestId('reactflow-position-stage:draft').dataset.position).toBe('0,0');
    expect(screen.getByTestId('reactflow-edge-step-research~draft').dataset.sourceHandle).toBe('source-left');
  });

  it('explains itself in plain words', () => {
    render(<WorkflowAgentGraph entry={entry()} />);
    expect(screen.getByTestId('reactflow-panel').textContent).toContain('arrows show what runs after what');
  });
});

/**
 * THE REGRESSION PIN for the live "nothing to see, nothing to click on" defect.
 *
 * Every test above mocks `reactflow`, so none of them can see layout — and the graph rendered PERFECTLY
 * in jsdom while being completely invisible in a browser. Measured live: `.v-workflow-network__canvas`
 * was 758x736, but `.react-flow` inside it computed to height 0px, because reactflow's root is
 * `height: 100%` and a percentage height resolves against the parent's `height` property, which a bare
 * `min-height` never sets. `fitView` then framed a zero-height viewport and pushed the nodes outside the
 * `overflow: hidden` clip.
 *
 * jsdom will not compute that for us, so we assert the CSS CONTRACT directly: the canvas must declare a
 * real `height`. Reverting it to `min-height` alone fails these tests.
 */
describe('the canvas height contract (the invisible-graph regression)', () => {
  // Resolved from the project root, not `import.meta.url`: this suite runs under jsdom, where
  // `import.meta.url` is an http: URL that `readFileSync` cannot take.
  const css = readFileSync(resolve(process.cwd(), 'src/styles/views/workflows.css'), 'utf8');

  /** Every declaration block whose selector mentions the canvas class, minus the state-only rules. */
  const canvasBlocks = (): string[] => {
    const blocks: string[] = [];
    const re = /([^{}]*\.v-workflow-network__canvas[^{}]*)\{([^}]*)\}/g;
    for (let m = re.exec(css); m !== null; m = re.exec(css)) {
      if (!/:focus-within|:hover/.test(m[1] as string)) blocks.push(m[2] as string);
    }
    return blocks;
  };

  it('declares the canvas rules at all', () => {
    expect(canvasBlocks().length).toBeGreaterThanOrEqual(2); // base + the narrow-viewport override
  });

  it('never sizes the canvas with min-height ALONE — that is exactly the bug', () => {
    for (const block of canvasBlocks()) {
      if (!/min-height\s*:/.test(block)) continue;
      expect(block).toMatch(/(^|[;\s])height\s*:/);
    }
  });

  it('gives the base rule an explicit height, so reactflow can resolve height:100%', () => {
    expect(canvasBlocks()[0] as string).toMatch(/(^|[;\s])height\s*:\s*\d/);
  });

  it('keeps an explicit height in the narrow-viewport override too', () => {
    const narrow = canvasBlocks().slice(1);
    expect(narrow.length).toBeGreaterThan(0);
    for (const block of narrow) expect(block).toMatch(/(^|[;\s])height\s*:\s*\d/);
  });
});
