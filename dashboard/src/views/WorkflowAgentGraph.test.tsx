// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { WorkflowDefEntry } from './WorkflowDetail';
import {
  UNASSIGNED_AGENT,
  WorkflowAgentGraph,
  agentNodePositions,
  agentOrder,
  handoffEdges,
  type HandoffData,
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
    label?: React.ReactNode;
    markerStart?: unknown;
    markerEnd?: unknown;
    sourceHandle?: string;
    targetHandle?: string;
    ariaLabel?: string;
    data?: unknown;
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
          data-label={String(edge.label)}
          data-marker-start={String(Boolean(edge.markerStart))}
          data-marker-end={String(Boolean(edge.markerEnd))}
          data-source-handle={edge.sourceHandle}
          data-target-handle={edge.targetHandle}
          aria-label={edge.ariaLabel}
        >
          {JSON.stringify(edge.data)}
        </div>
      ))}
      {children}
      <button type="button" onClick={() => onNodesChange([{ id: 'alpha', type: 'position', position: { x: 900, y: 0 } }])}>Move alpha node</button>
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

/** `agentId` is what puts a step in a node; `profileId` is the model it runs on. */
const assign = (agentId: string) => ({ agentId, profileId: `worker:${agentId}` });

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

describe('WorkflowAgentGraph', () => {
  it('groups steps by the agent assigned to run them, with an explicit node for the unassigned', () => {
    render(<WorkflowAgentGraph entry={entry()} assignmentOptions={options()} />);
    expect(screen.getByTestId('workflow-agent-node-alpha').textContent).toContain('Research');
    expect(screen.getByTestId('workflow-agent-node-beta').textContent).toContain('Draft');
    expect(screen.getByTestId('workflow-agent-node-__unassigned__').textContent).toContain('Review');
    // The manager is a role ON a node, never a separate whole-workflow dropdown.
    expect(screen.getByTestId('workflow-agent-node-alpha').textContent).toContain('runs the workflow');
  });

  it('edits one step through the caller governed write, with no local draft and no batch submit', () => {
    const onAssign = vi.fn();
    vi.stubGlobal('fetch', vi.fn());
    render(<WorkflowAgentGraph entry={entry()} assignmentOptions={options()} onAssign={onAssign} />);

    fireEvent.change(screen.getByLabelText('Who runs Draft'), { target: { value: JSON.stringify(['alpha', 'worker:alpha']) } });
    expect(onAssign).toHaveBeenCalledWith({ kind: 'stage', stageId: 'draft' }, assign('alpha'));

    fireEvent.change(screen.getByLabelText('Who runs the workflow'), { target: { value: JSON.stringify(['beta', 'worker:beta']) } });
    expect(onAssign).toHaveBeenLastCalledWith({ kind: 'manager' }, assign('beta'));

    // Clearing is the same one write with a null assignment — not a second path.
    fireEvent.change(screen.getByLabelText('Who runs Research'), { target: { value: '' } });
    expect(onAssign).toHaveBeenLastCalledWith({ kind: 'stage', stageId: 'research' }, null);

    // The graph itself never talks to the network; the detail's caller owns the request.
    expect(fetch).not.toHaveBeenCalled();
  });

  it('states an unavailable choice rather than offering an empty picker', () => {
    render(<WorkflowAgentGraph
      entry={entry()}
      assignmentOptions={options({ stages: { ...options().stages, draft: { options: [], unavailable: 'Human binding required.' } } })}
    />);
    expect(screen.getByTestId('workflow-agent-stage-draft').textContent).toContain('Human binding required.');
    expect(screen.queryByLabelText('Who runs Draft')).toBeNull();
  });

  it('keeps the current pair listed even after it stops being eligible', () => {
    render(<WorkflowAgentGraph
      entry={entry()}
      assignmentOptions={options({ stages: { ...options().stages, draft: { options: [assign('alpha')], unavailable: null } } })}
    />);
    // Dropping the value silently would read as "unassigned" — the opposite of what the file says.
    const picker = screen.getByLabelText('Who runs Draft') as HTMLSelectElement;
    expect(picker.value).toBe(JSON.stringify(['beta', 'worker:beta']));
  });

  it('freezes every picker while a change is in flight', () => {
    render(<WorkflowAgentGraph entry={entry()} assignmentOptions={options()} readOnly />);
    expect((screen.getByLabelText('Who runs Draft') as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText('Who runs the workflow') as HTMLSelectElement).disabled).toBe(true);
  });

  it('bundles reciprocal handoffs on one trunk and omits work an agent hands to itself', () => {
    const workflow = entry({ stages: [
      { id: 'a1', action: 'a', target: 'a', riskTier: 'T1', declaredAssignment: assign('alpha') },
      { id: 'b1', action: 'b', target: 'b', riskTier: 'T1', declaredAssignment: assign('beta'), dependsOn: ['a1'] },
      { id: 'a2', action: 'a2', target: 'a2', riskTier: 'T1', declaredAssignment: assign('alpha'), dependsOn: ['b1', 'a1'] },
    ] });
    const edges = handoffEdges(workflow);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      source: 'alpha',
      target: 'beta',
      label: 'hands off 2 steps',
      markerStart: expect.objectContaining({ type: 'arrowclosed' }),
      markerEnd: expect.objectContaining({ type: 'arrowclosed' }),
    });
    expect(edges[0]?.ariaLabel).toContain('alpha hands off to beta: a1 then b1');
    expect(edges[0]?.ariaLabel).toContain('beta hands off to alpha: b1 then a2');
    expect((edges[0]?.data as HandoffData).directions).toHaveLength(2);
  });

  it('uses a single directional marker for a one-way handoff', () => {
    const alphaBeta = handoffEdges(entry()).find((edge) => edge.source === 'alpha' && edge.target === 'beta');
    expect(alphaBeta).toMatchObject({ label: 'hands off 1 step', markerEnd: expect.any(Object) });
    expect(alphaBeta?.markerStart).toBeUndefined();
  });

  it('keeps pair IDs unique for hyphenated agent names and skips unknown dependencies', () => {
    const workflow = entry({ stages: [
      { id: 'one', action: 'one', target: 'one', riskTier: 'T1', declaredAssignment: assign('a') },
      { id: 'two', action: 'two', target: 'two', riskTier: 'T1', declaredAssignment: assign('b-c'), dependsOn: ['one'] },
      { id: 'three', action: 'three', target: 'three', riskTier: 'T1', declaredAssignment: assign('a-b') },
      { id: 'four', action: 'four', target: 'four', riskTier: 'T1', declaredAssignment: assign('c'), dependsOn: ['three', 'missing'] },
    ] });
    const edges = handoffEdges(workflow);
    expect(edges.map((edge) => edge.id).sort()).toEqual(['handoff-a-b~c', 'handoff-a~b-c']);
    expect(edges.some((edge) => edge.source === UNASSIGNED_AGENT)).toBe(false);
  });

  it('orders and positions agents from step flow independently of declaration order', () => {
    const workflow = entry();
    const visible = ['orchestrator', 'beta', 'alpha', UNASSIGNED_AGENT];
    expect(agentOrder(workflow, visible)).toEqual(['alpha', 'beta', UNASSIGNED_AGENT, 'orchestrator']);
    const first = agentNodePositions(workflow, visible);
    const shuffled = agentNodePositions(workflow, [...visible].reverse());
    for (const id of visible) expect(shuffled.get(id)).toEqual(first.get(id));
  });

  it('compresses late ranks into adjacent lanes', () => {
    const stages: WorkflowDefEntry['stages'] = Array.from({ length: 13 }, (_, index) => ({
      id: `stage-${index}`,
      action: `stage-${index}`,
      target: `stage-${index}`,
      riskTier: 'T1',
      declaredAssignment: assign(index === 12 ? 'beta' : 'alpha'),
      dependsOn: index === 0 ? undefined : [`stage-${index - 1}`],
    }));
    const positions = agentNodePositions(entry({ stages }), ['alpha', 'beta']);
    expect(positions.get('alpha')).toEqual({ x: 0, y: 0 });
    expect(positions.get('beta')).toEqual({ x: 430, y: 0 });
  });

  it('keeps a local review cycle in one lane without circularizing the surrounding workflow', () => {
    const workflow = entry({ stages: [
      { id: 'a', action: 'a', target: 'a', riskTier: 'T1', declaredAssignment: assign('alpha') },
      { id: 'b1', action: 'b1', target: 'b1', riskTier: 'T1', declaredAssignment: assign('beta'), dependsOn: ['a'] },
      { id: 'c', action: 'c', target: 'c', riskTier: 'T1', declaredAssignment: assign('checker'), dependsOn: ['b1'] },
      { id: 'b2', action: 'b2', target: 'b2', riskTier: 'T1', declaredAssignment: assign('beta'), dependsOn: ['c'] },
      { id: 'd', action: 'd', target: 'd', riskTier: 'T1', declaredAssignment: assign('delta'), dependsOn: ['b2'] },
      { id: 'e', action: 'e', target: 'e', riskTier: 'T1', declaredAssignment: assign('echo'), dependsOn: ['d'] },
    ] });
    const positions = agentNodePositions(workflow, ['echo', 'checker', 'delta', 'alpha', 'beta']);
    expect(positions.get('alpha')?.x).toBe(0);
    expect(positions.get('beta')?.x).toBe(430);
    expect(positions.get('checker')?.x).toBe(430);
    expect(positions.get('delta')?.x).toBe(860);
    expect(positions.get('echo')?.x).toBe(1290);
  });

  it('projects the FYT agent cycle as five routed trunks around a stable four-node ring', () => {
    const workflow = entry({ stages: [
      { id: 'idea', action: 'idea', target: 'idea', riskTier: 'T1', declaredAssignment: assign('fyt-preproduction') },
      { id: 'research', action: 'research', target: 'research', riskTier: 'T1', declaredAssignment: assign('fyt-preproduction'), dependsOn: ['idea'] },
      { id: 'script', action: 'script', target: 'script', riskTier: 'T1', declaredAssignment: assign('fyt-preproduction'), dependsOn: ['research'] },
      { id: 'judge', action: 'judge', target: 'judge', riskTier: 'T1', declaredAssignment: assign('fyt-checker'), dependsOn: ['script'] },
      { id: 'shorts', action: 'shorts', target: 'shorts', riskTier: 'T1', declaredAssignment: assign('fyt-preproduction'), dependsOn: ['judge'] },
      { id: 'metadata', action: 'metadata', target: 'metadata', riskTier: 'T1', declaredAssignment: assign('fyt-preproduction'), dependsOn: ['judge'] },
      { id: 'shots', action: 'shots', target: 'shots', riskTier: 'T1', declaredAssignment: assign('fyt-preproduction'), dependsOn: ['judge'] },
      { id: 'motion', action: 'motion', target: 'motion', riskTier: 'T1', declaredAssignment: assign('fyt-preproduction'), dependsOn: ['shots'] },
      { id: 'images', action: 'images', target: 'images', riskTier: 'T1', declaredAssignment: assign('fyt-production'), dependsOn: ['shots'] },
      { id: 'image-review', action: 'review', target: 'review', riskTier: 'T1', declaredAssignment: assign('fyt-runner'), dependsOn: ['images', 'motion'] },
      { id: 'voiceover', action: 'voiceover', target: 'voiceover', riskTier: 'T1', declaredAssignment: assign('fyt-production'), dependsOn: ['judge'] },
      { id: 'audio-plan', action: 'audio', target: 'audio', riskTier: 'T1', declaredAssignment: assign('fyt-production'), dependsOn: ['script', 'shots', 'voiceover'] },
      { id: 'render', action: 'render', target: 'render', riskTier: 'T1', declaredAssignment: assign('fyt-production'), dependsOn: ['metadata', 'shorts', 'motion', 'image-review', 'audio-plan'] },
      { id: 'verify', action: 'verify', target: 'verify', riskTier: 'T1', declaredAssignment: assign('fyt-checker'), dependsOn: ['render'] },
    ] });
    const owners = ['fyt-runner', 'fyt-production', 'fyt-checker', 'fyt-preproduction'];
    expect(Object.fromEntries(agentNodePositions(workflow, owners))).toEqual({
      'fyt-preproduction': { x: 132, y: 116 },
      'fyt-checker': { x: 768, y: 116 },
      'fyt-production': { x: 768, y: 484 },
      'fyt-runner': { x: 132, y: 484 },
    });
    const edges = handoffEdges(workflow);
    expect(edges).toHaveLength(5);
    expect(edges.flatMap((edge) => edge.data?.directions ?? [])
      .reduce((count, direction) => count + direction.stagePairs.length, 0)).toBe(15);
    expect(edges.find((edge) => edge.id === 'handoff-fyt-checker~fyt-production')).toMatchObject({
      sourceHandle: 'source-bottom',
      targetHandle: 'target-top',
    });
    expect(edges.find((edge) => edge.id === 'handoff-fyt-preproduction~fyt-runner')).toMatchObject({
      sourceHandle: 'source-bottom',
      targetHandle: 'target-top',
    });
  });

  it('retains a dragged position and reroutes its edges through it', () => {
    render(<WorkflowAgentGraph entry={entry()} assignmentOptions={options()} />);
    expect(screen.getByTestId('reactflow-edge-handoff-alpha~beta').dataset.sourceHandle).toBe('source-right');
    fireEvent.click(screen.getByRole('button', { name: 'Move alpha node' }));
    expect(screen.getByTestId('reactflow-position-alpha').dataset.position).toBe('900,0');
    expect(screen.getByTestId('reactflow-edge-handoff-alpha~beta').dataset.sourceHandle).toBe('source-left');
  });

  it('explains itself in plain words and opens an agent without a network write', () => {
    const onOpenAgent = vi.fn();
    vi.stubGlobal('fetch', vi.fn());
    render(<WorkflowAgentGraph entry={entry()} assignmentOptions={options()} onOpenAgent={onOpenAgent} />);
    expect(screen.getByTestId('reactflow-panel').textContent).toContain('who hands work to whom');
    fireEvent.click(screen.getAllByRole('button', { name: 'Open agent' })[1]);
    expect(onOpenAgent).toHaveBeenCalledWith('beta');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('says so plainly when a workflow has no steps yet', () => {
    render(<WorkflowAgentGraph entry={entry({ stages: [], manager: null })} />);
    expect(screen.getByTestId('workflow-agent-network-empty').textContent).toContain('no steps');
  });
});
