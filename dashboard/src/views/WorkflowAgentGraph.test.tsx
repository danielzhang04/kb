// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { WorkflowDefEntry } from './WorkflowDetail';
import { WorkflowAgentGraph, governanceEdges, initialGovernance, type GovernanceDraft } from './WorkflowAgentGraph';

vi.mock('reactflow', () => ({
  Background: () => null,
  Controls: () => null,
  Handle: () => null,
  Position: { Left: 'left', Right: 'right' },
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ReactFlow: ({ nodes, nodeTypes }: { nodes: Array<{ id: string; type: string; data: unknown }>; nodeTypes: Record<string, React.ComponentType<{ data: unknown }>> }) => <>{nodes.map((node) => {
    const Component = nodeTypes[node.type]!;
    return <Component key={node.id} data={node.data} />;
  })}</>,
  useNodesState: (initial: unknown[]) => [initial, vi.fn(), vi.fn()],
}));

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

  it('aggregates cross-owner handoffs, permits a collapsed cycle, and omits internal dependencies', () => {
    const workflow = entry({ stages: [
      { id: 'a1', action: 'a', target: 'a', riskTier: 'T1', governedBy: 'alpha', dependsOn: ['b1'] },
      { id: 'b1', action: 'b', target: 'b', riskTier: 'T1', governedBy: 'beta', dependsOn: ['a2'] },
      { id: 'a2', action: 'a2', target: 'a2', riskTier: 'T1', governedBy: 'alpha', dependsOn: ['a1'] },
    ] });
    const edges = governanceEdges(workflow, initialGovernance(workflow));
    expect(edges).toHaveLength(2);
    expect(edges.map((edge) => `${edge.source}->${edge.target}`).sort()).toEqual(['alpha->beta', 'beta->alpha']);
    expect((edges.find((edge) => edge.source === 'alpha' && edge.target === 'beta') as { title?: string } | undefined)?.title).toContain('a2');
  });

  it('shows selected governance facts and navigates from the inspector without a network write', () => {
    const onOpenAgent = vi.fn();
    const onDraftChange = vi.fn();
    render(<WorkflowAgentGraph entry={entry()} agents={agents} draft={initialGovernance(entry())} onDraftChange={onDraftChange} onOpenAgent={onOpenAgent} />);
    fireEvent.click(screen.getByTestId('workflow-agent-node-beta'));
    expect(screen.getByTestId('workflow-agent-inspector').textContent).toContain('Draft');
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
    render(<WorkflowAgentGraph entry={entry()} agents={agents} draft={initialGovernance(entry())} onDraftChange={vi.fn()} readOnly />);
    expect(screen.queryByLabelText('draft governed by')).toBeNull();
    expect((screen.getByTestId('workflow-stage-chip-draft') as HTMLButtonElement).draggable).toBe(false);
    expect(screen.getByTestId('workflow-agent-inspector').textContent).toContain('Research');
  });
});
