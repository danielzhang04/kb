// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import type { WorkflowDefEntry } from './WorkflowDetail';
import {
  UNASSIGNED_GOVERNOR,
  WorkflowAgentGraph,
  governanceEdges,
  governanceNodePositions,
  governanceOwnerOrder,
  initialGovernance,
  type GovernanceDraft,
  type GovernanceHandoffData,
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
    ReactFlow: ({ nodes, edges, nodeTypes, nodesDraggable, onNodesChange, children }: {
      nodes: MockNode[];
      edges: MockEdge[];
      nodeTypes: Record<string, React.ComponentType<{ data: unknown }>>;
      nodesDraggable: boolean;
      onNodesChange: (changes: MockChange[]) => void;
      children: React.ReactNode;
    }) => <div data-testid="reactflow-mock" data-nodes-draggable={String(nodesDraggable)}>
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

const entry = (over: Partial<WorkflowDefEntry> = {}): WorkflowDefEntry => ({
  ref: 'kb~network.md', project: 'kb-ops', path: 'orgs/kb-ops/workflows/network.md', sourceHash: 'a'.repeat(64),
  valid: true, title: 'Network', profile: null, stageCount: 3, riskTier: 'T2', detail: null,
  governedBy: 'alpha',
  stages: [
    { id: 'research', title: 'Research', action: 'research', target: 'notes.md', riskTier: 'T1', governedBy: 'alpha' },
    { id: 'draft', title: 'Draft', action: 'draft', target: 'draft.md', riskTier: 'T1', dependsOn: ['research'], governedBy: 'beta' },
    { id: 'review', title: 'Review', action: 'review', target: 'review.md', riskTier: 'T2', dependsOn: ['draft'], governedBy: null },
  ],
  ...over,
});
const agents = [{ id: 'alpha', role: 'writer', description: null }, { id: 'beta', role: 'reviewer', description: null }];

describe('WorkflowAgentGraph', () => {
  it('groups stages by declared governor and keeps an explicit unassigned node for null or missing keys', () => {
    const workflow = entry();
    render(<WorkflowAgentGraph entry={workflow} agents={agents} draft={{ workflow: 'alpha', stages: { research: 'alpha', draft: 'beta' } }} onDraftChange={vi.fn()} />);
    expect(screen.getByTestId('workflow-agent-node-alpha').textContent).toContain('Research');
    expect(screen.getByTestId('workflow-agent-node-beta').textContent).toContain('Draft');
    expect(screen.getByTestId('workflow-agent-node-__unassigned__').textContent).toContain('Review');
  });

  it('bundles reciprocal owner handoffs on one trunk and omits internal dependencies', () => {
    const workflow = entry({ stages: [
      { id: 'a1', action: 'a', target: 'a', riskTier: 'T1', governedBy: 'alpha' },
      { id: 'b1', action: 'b', target: 'b', riskTier: 'T1', governedBy: 'beta', dependsOn: ['a1'] },
      { id: 'a2', action: 'a2', target: 'a2', riskTier: 'T1', governedBy: 'alpha', dependsOn: ['b1', 'a1'] },
    ] });
    const edges = governanceEdges(workflow, initialGovernance(workflow));
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      source: 'alpha',
      target: 'beta',
      label: '2 handoffs',
      markerStart: expect.objectContaining({ type: 'arrowclosed' }),
      markerEnd: expect.objectContaining({ type: 'arrowclosed' }),
    });
    expect(edges[0]?.ariaLabel).toContain('alpha to beta: a1 → b1');
    expect(edges[0]?.ariaLabel).toContain('beta to alpha: b1 → a2');
    expect((edges[0]?.data as GovernanceHandoffData).directions).toHaveLength(2);
  });

  it('uses a single directional marker for one-way handoffs', () => {
    const edges = governanceEdges(entry(), initialGovernance(entry()));
    const alphaBeta = edges.find((edge) => edge.source === 'alpha' && edge.target === 'beta');
    expect(alphaBeta).toMatchObject({ label: '1 handoff', markerEnd: expect.any(Object) });
    expect(alphaBeta?.markerStart).toBeUndefined();
  });

  it('keeps pair IDs unique for hyphenated agent names and skips unknown dependencies', () => {
    const workflow = entry({ stages: [
      { id: 'one', action: 'one', target: 'one', riskTier: 'T1', governedBy: 'a' },
      { id: 'two', action: 'two', target: 'two', riskTier: 'T1', governedBy: 'b-c', dependsOn: ['one'] },
      { id: 'three', action: 'three', target: 'three', riskTier: 'T1', governedBy: 'a-b' },
      { id: 'four', action: 'four', target: 'four', riskTier: 'T1', governedBy: 'c', dependsOn: ['three', 'missing'] },
    ] });
    const edges = governanceEdges(workflow, initialGovernance(workflow));
    expect(edges.map((edge) => edge.id).sort()).toEqual(['handoff-a-b~c', 'handoff-a~b-c']);
    expect(edges.some((edge) => edge.source === UNASSIGNED_GOVERNOR)).toBe(false);
  });

  it('orders and positions owners from stage flow independently of declaration order', () => {
    const workflow = entry();
    const draft = initialGovernance(workflow);
    const visible = ['orchestrator', 'beta', 'alpha', UNASSIGNED_GOVERNOR];
    expect(governanceOwnerOrder(workflow, draft, visible)).toEqual(['alpha', 'beta', UNASSIGNED_GOVERNOR, 'orchestrator']);
    const first = governanceNodePositions(workflow, draft, visible);
    const shuffled = governanceNodePositions(workflow, draft, [...visible].reverse());
    for (const id of visible) expect(shuffled.get(id)).toEqual(first.get(id));
  });

  it('compresses late owner ranks into adjacent lanes', () => {
    const stages: WorkflowDefEntry['stages'] = Array.from({ length: 13 }, (_, index) => ({
      id: `stage-${index}`,
      action: `stage-${index}`,
      target: `stage-${index}`,
      riskTier: 'T1',
      governedBy: index === 12 ? 'beta' : 'alpha',
      dependsOn: index === 0 ? undefined : [`stage-${index - 1}`],
    }));
    const workflow = entry({ stages });
    const positions = governanceNodePositions(workflow, initialGovernance(workflow), ['alpha', 'beta']);
    expect(positions.get('alpha')).toEqual({ x: 0, y: 0 });
    expect(positions.get('beta')).toEqual({ x: 430, y: 0 });
  });

  it('keeps a local review cycle in one lane without circularizing the surrounding workflow', () => {
    const workflow = entry({ stages: [
      { id: 'a', action: 'a', target: 'a', riskTier: 'T1', governedBy: 'alpha' },
      { id: 'b1', action: 'b1', target: 'b1', riskTier: 'T1', governedBy: 'beta', dependsOn: ['a'] },
      { id: 'c', action: 'c', target: 'c', riskTier: 'T1', governedBy: 'checker', dependsOn: ['b1'] },
      { id: 'b2', action: 'b2', target: 'b2', riskTier: 'T1', governedBy: 'beta', dependsOn: ['c'] },
      { id: 'd', action: 'd', target: 'd', riskTier: 'T1', governedBy: 'delta', dependsOn: ['b2'] },
      { id: 'e', action: 'e', target: 'e', riskTier: 'T1', governedBy: 'echo', dependsOn: ['d'] },
    ] });
    const positions = governanceNodePositions(
      workflow,
      initialGovernance(workflow),
      ['echo', 'checker', 'delta', 'alpha', 'beta'],
    );
    expect(positions.get('alpha')?.x).toBe(0);
    expect(positions.get('beta')?.x).toBe(430);
    expect(positions.get('checker')?.x).toBe(430);
    expect(positions.get('delta')?.x).toBe(860);
    expect(positions.get('echo')?.x).toBe(1290);
  });

  it('projects the FYT owner cycle as five routed trunks around a stable four-node ring', () => {
    const workflow = entry({ stages: [
      { id: 'idea', action: 'idea', target: 'idea', riskTier: 'T1', governedBy: 'fyt-preproduction' },
      { id: 'research', action: 'research', target: 'research', riskTier: 'T1', governedBy: 'fyt-preproduction', dependsOn: ['idea'] },
      { id: 'script', action: 'script', target: 'script', riskTier: 'T1', governedBy: 'fyt-preproduction', dependsOn: ['research'] },
      { id: 'judge', action: 'judge', target: 'judge', riskTier: 'T1', governedBy: 'fyt-checker', dependsOn: ['script'] },
      { id: 'shorts', action: 'shorts', target: 'shorts', riskTier: 'T1', governedBy: 'fyt-preproduction', dependsOn: ['judge'] },
      { id: 'metadata', action: 'metadata', target: 'metadata', riskTier: 'T1', governedBy: 'fyt-preproduction', dependsOn: ['judge'] },
      { id: 'shots', action: 'shots', target: 'shots', riskTier: 'T1', governedBy: 'fyt-preproduction', dependsOn: ['judge'] },
      { id: 'motion', action: 'motion', target: 'motion', riskTier: 'T1', governedBy: 'fyt-preproduction', dependsOn: ['shots'] },
      { id: 'images', action: 'images', target: 'images', riskTier: 'T1', governedBy: 'fyt-production', dependsOn: ['shots'] },
      { id: 'image-review', action: 'review', target: 'review', riskTier: 'T1', governedBy: 'fyt-runner', dependsOn: ['images', 'motion'] },
      { id: 'voiceover', action: 'voiceover', target: 'voiceover', riskTier: 'T1', governedBy: 'fyt-production', dependsOn: ['judge'] },
      { id: 'audio-plan', action: 'audio', target: 'audio', riskTier: 'T1', governedBy: 'fyt-production', dependsOn: ['script', 'shots', 'voiceover'] },
      { id: 'render', action: 'render', target: 'render', riskTier: 'T1', governedBy: 'fyt-production', dependsOn: ['metadata', 'shorts', 'motion', 'image-review', 'audio-plan'] },
      { id: 'verify', action: 'verify', target: 'verify', riskTier: 'T1', governedBy: 'fyt-checker', dependsOn: ['render'] },
    ] });
    const draft = initialGovernance(workflow);
    const owners = ['fyt-runner', 'fyt-production', 'fyt-checker', 'fyt-preproduction'];
    const positions = governanceNodePositions(workflow, draft, owners);
    expect(Object.fromEntries(positions)).toEqual({
      'fyt-preproduction': { x: 132, y: 116 },
      'fyt-checker': { x: 768, y: 116 },
      'fyt-production': { x: 768, y: 484 },
      'fyt-runner': { x: 132, y: 484 },
    });
    const edges = governanceEdges(workflow, draft);
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

  it('retains a position and reroutes its edges through an ownership projection', () => {
    const workflow = entry();
    function Harness(): React.JSX.Element {
      const [draft, setDraft] = useState(initialGovernance(workflow));
      return <WorkflowAgentGraph entry={workflow} agents={agents} draft={draft} onDraftChange={setDraft} />;
    }
    render(<Harness />);
    expect(screen.getByTestId('reactflow-edge-handoff-alpha~beta').dataset.sourceHandle).toBe('source-right');
    fireEvent.click(screen.getByRole('button', { name: 'Move alpha node' }));
    expect(screen.getByTestId('reactflow-position-alpha').dataset.position).toBe('900,0');
    expect(screen.getByTestId('reactflow-edge-handoff-alpha~beta').dataset.sourceHandle).toBe('source-left');
    fireEvent.click(screen.getByRole('button', { name: 'Inspect beta' }));
    fireEvent.change(screen.getByLabelText('draft governed by'), { target: { value: 'alpha' } });
    expect(screen.getByTestId('reactflow-position-alpha').dataset.position).toBe('900,0');
  });

  it('shows selected governance facts and navigates from the inspector without a network write', () => {
    const onOpenAgent = vi.fn();
    const onDraftChange = vi.fn();
    render(<WorkflowAgentGraph entry={entry()} agents={agents} draft={initialGovernance(entry())} onDraftChange={onDraftChange} onOpenAgent={onOpenAgent} />);
    expect(screen.getByTestId('reactflow-panel').textContent).toContain('One line per agent pair');
    fireEvent.click(screen.getByTestId('workflow-agent-node-beta'));
    expect(screen.getByTestId('workflow-agent-inspector').textContent).toContain('Draft');
    expect(screen.getByTestId('workflow-agent-inspector').textContent).toContain('From alpha');
    fireEvent.click(screen.getByRole('button', { name: 'Open agent' }));
    expect(onOpenAgent).toHaveBeenCalledWith('beta');
    expect(onDraftChange).not.toHaveBeenCalled();
  });

  it('uses the select fallback and drag draft locally, with no fetch', () => {
    const onDraftChange = vi.fn();
    const draft: GovernanceDraft = initialGovernance(entry());
    vi.stubGlobal('fetch', vi.fn());
    render(<WorkflowAgentGraph entry={entry()} agents={agents} draft={draft} onDraftChange={onDraftChange} />);
    fireEvent.click(screen.getByTestId('workflow-agent-node-beta'));
    fireEvent.change(screen.getByLabelText('draft governed by'), { target: { value: 'alpha' } });
    expect(onDraftChange).toHaveBeenLastCalledWith(expect.objectContaining({ stages: expect.objectContaining({ draft: 'alpha' }) }));
    const transfer = { getData: vi.fn(() => 'research') } as unknown as DataTransfer;
    fireEvent.drop(screen.getByTestId('workflow-agent-node-beta'), { dataTransfer: transfer });
    expect(onDraftChange).toHaveBeenLastCalledWith(expect.objectContaining({ stages: expect.objectContaining({ research: 'beta' }) }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps a keyboard-selectable fallback while read-only hides mutation controls', () => {
    const workflow = entry({ governedBy: 'coordinator' });
    render(<WorkflowAgentGraph entry={workflow} agents={[...agents, { id: 'coordinator', role: 'manager', description: null }]} draft={initialGovernance(workflow)} onDraftChange={vi.fn()} readOnly />);
    expect(screen.queryByLabelText('draft governed by')).toBeNull();
    expect((screen.getByTestId('workflow-stage-chip-draft') as HTMLButtonElement).draggable).toBe(false);
    expect(screen.getByTestId('reactflow-mock').dataset.nodesDraggable).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Inspect coordinator' }));
    expect(screen.getByTestId('workflow-agent-inspector').textContent).toContain('Governs the whole workflow');
  });
});
