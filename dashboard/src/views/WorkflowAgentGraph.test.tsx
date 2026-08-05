// @vitest-environment jsdom
/**
 * The workflow graph is AGENT-keyed: one card per agent, the steps it governs listed inside it, and
 * arrows only where work actually changes hands between agents.
 *
 * Two real definition shapes pin the projection, both copied from live `GET /api/workflows`:
 *
 *  - FULL CAST (`videoRun()`): faceless-youtube's fourteen-step pipeline. Fourteen steps, four agents,
 *    one of which (`fyt-runner`) both manages the workflow and governs a step — so it must be ONE card
 *    wearing both roles, never two. This is the shape Daniel was looking at when he said the graph
 *    should show agents rather than skills, and that the nodes were too small and too far apart.
 *  - ZERO CAST (`bare()`): a kb-ops definition with no manager, no `governedBy`, and no per-step
 *    assignment. Nothing resolves, so the graph must draw ONE honest card saying so — never an empty
 *    canvas, and never a picker that vanished with the step boxes.
 *
 * The grouping, ordering, edge-collapse and layout rules are all exported pure functions, so they are
 * tested as data rather than through the DOM.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { WorkflowDefEntry } from './WorkflowDetail';
import {
  AGENT_GRID_COLUMNS,
  AGENT_NODE_GAP_X,
  AGENT_NODE_WIDTH,
  UNRESOLVED_NODE,
  WorkflowAgentGraph,
  agentEdges,
  agentGroups,
  agentNodeHeight,
  agentNodeId,
  agentNodePositions,
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
    ReactFlow: ({ nodes, edges, nodeTypes, onNodesChange, fitViewOptions, minZoom, maxZoom, children }: {
      nodes: MockNode[];
      edges: MockEdge[];
      nodeTypes: Record<string, React.ComponentType<{ data: unknown }>>;
      onNodesChange: (changes: MockChange[]) => void;
      fitViewOptions?: { padding?: number; minZoom?: number; maxZoom?: number };
      minZoom?: number;
      maxZoom?: number;
      children: React.ReactNode;
    }) => <div
      data-testid="reactflow-mock"
      data-fit-max-zoom={String(fitViewOptions?.maxZoom)}
      data-fit-min-zoom={String(fitViewOptions?.minZoom)}
      data-min-zoom={String(minZoom)}
      data-max-zoom={String(maxZoom)}
    >
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
      <button type="button" onClick={() => onNodesChange([{ id: 'agent:fyt-preproduction', type: 'position', position: { x: 0, y: 900 } }])}>Move the preproduction card</button>
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
    { id: 'research', title: 'Research', action: 'research', target: 'notes.md', riskTier: 'T1', declaredAssignment: assign('alpha'), resolvedAssignment: resolved({ agentId: 'alpha' }) },
    { id: 'draft', title: 'Draft', action: 'draft', target: 'draft.md', riskTier: 'T1', dependsOn: ['research'], declaredAssignment: assign('beta'), resolvedAssignment: resolved({ agentId: 'beta' }) },
    { id: 'review', title: 'Review', action: 'review', target: 'review.md', riskTier: 'T2', dependsOn: ['draft'], declaredAssignment: null, resolvedAssignment: resolved({ agentId: 'alpha' }) },
  ],
  ...over,
});

/**
 * THE FULL-CAST SHAPE, verbatim from live `/api/workflows` (`video-run`, faceless-youtube): fourteen
 * steps, every one governed by a `governedBy` default rather than a declaration, and a manager that
 * also governs `image-review`.
 */
const governed = (agentId: string, model: string): ResolvedAssignment =>
  ({ agentId, profileId: `worker:${model}`, model, source: 'stage-governed-by' });
const SOL = 'gpt-5.6-sol';
const OPUS = 'claude-opus-4-8';

const videoRun = (): WorkflowDefEntry => entry({
  ref: 'video-run', project: 'faceless-youtube', title: 'Produce one video (faceless pipeline)',
  displayName: 'Produce one video (faceless pipeline)', path: 'orgs/faceless-youtube/workflows/video-run.md',
  governedBy: 'fyt-runner', manager: null, stageCount: 14,
  resolvedManager: { agentId: 'fyt-runner', profileId: 'manager:claude:claude-opus-4-8', model: OPUS, source: 'governed-by' },
  stages: [
    { id: 'idea', title: 'Pick and brief one video idea', action: 'idea', target: 'idea.md', riskTier: 'T1', dependsOn: [], governedBy: 'fyt-preproduction', resolvedAssignment: governed('fyt-preproduction', SOL) },
    { id: 'research', title: 'Research the picked idea', action: 'research', target: 'dossier.md', riskTier: 'T1', dependsOn: ['idea'], governedBy: 'fyt-preproduction', resolvedAssignment: governed('fyt-preproduction', SOL) },
    { id: 'script', title: 'Write the long-form voiceover script', action: 'script', target: 'script.md', riskTier: 'T1', dependsOn: ['research'], governedBy: 'fyt-preproduction', resolvedAssignment: governed('fyt-preproduction', SOL) },
    { id: 'judge-gate', title: 'Fresh-eyes acceptance gate on the script', action: 'judge', target: 'judgement.md', riskTier: 'T2', dependsOn: ['script'], governedBy: 'fyt-checker', resolvedAssignment: governed('fyt-checker', OPUS) },
    { id: 'shorts', title: 'Derive the short-form bench', action: 'shorts', target: 'shorts.md', riskTier: 'T1', dependsOn: ['judge-gate'], governedBy: 'fyt-preproduction', resolvedAssignment: governed('fyt-preproduction', SOL) },
    { id: 'metadata', title: 'Author publishing metadata (no upload)', action: 'metadata', target: 'metadata.md', riskTier: 'T1', dependsOn: ['judge-gate'], governedBy: 'fyt-preproduction', resolvedAssignment: governed('fyt-preproduction', SOL) },
    { id: 'shots', title: 'Build the visual shot list and prompts', action: 'shots', target: 'shots.md', riskTier: 'T1', dependsOn: ['judge-gate'], governedBy: 'fyt-preproduction', resolvedAssignment: governed('fyt-preproduction', SOL) },
    { id: 'motion', title: 'Plan the per-shot motion layers', action: 'motion', target: 'motion.md', riskTier: 'T1', dependsOn: ['shots'], governedBy: 'fyt-preproduction', resolvedAssignment: governed('fyt-preproduction', SOL) },
    { id: 'images', title: 'Generate the on-style stills (SPENDS REAL MONEY)', action: 'images', target: 'stills', riskTier: 'T2', dependsOn: ['shots'], governedBy: 'fyt-production', resolvedAssignment: governed('fyt-production', SOL) },
    { id: 'image-review', title: 'Batched review of every generated still', action: 'image-review', target: 'review.md', riskTier: 'T2', dependsOn: ['images', 'motion'], governedBy: 'fyt-runner', resolvedAssignment: { agentId: 'fyt-runner', profileId: 'manager:claude:claude-opus-4-8', model: OPUS, source: 'stage-governed-by' } },
    { id: 'voiceover', title: 'Generate the narration audio (paid TTS)', action: 'voiceover', target: 'vo.wav', riskTier: 'T2', dependsOn: ['judge-gate'], governedBy: 'fyt-production', resolvedAssignment: governed('fyt-production', SOL) },
    { id: 'audio-plan', title: 'Author the unified audio plan', action: 'audio-plan', target: 'audio.json', riskTier: 'T1', dependsOn: ['script', 'shots', 'voiceover'], governedBy: 'fyt-production', resolvedAssignment: governed('fyt-production', SOL) },
    { id: 'render', title: 'Assemble the finished cut (heavyweight)', action: 'render', target: 'final.mp4', riskTier: 'T2', dependsOn: ['metadata', 'shorts', 'motion', 'image-review', 'audio-plan'], governedBy: 'fyt-production', resolvedAssignment: governed('fyt-production', SOL) },
    { id: 'verify', title: 'Verify the render against the manifests', action: 'verify', target: 'verification.md', riskTier: 'T2', dependsOn: ['render'], governedBy: 'fyt-checker', resolvedAssignment: governed('fyt-checker', OPUS) },
  ],
});

/** THE ZERO-CAST SHAPE, verbatim from live `/api/workflows` (kb-ops): nothing resolves for anything. */
const bare = (): WorkflowDefEntry => entry({
  ref: 'research-brief', title: 'Research brief (cited)', manager: null, resolvedManager: null,
  governedBy: null, stageCount: 3,
  stages: [
    { id: 'gather', title: 'Gather', action: 'research:web-brief', target: 'orgs/kb-ops/output', riskTier: 'T2', declaredAssignment: null },
    { id: 'write', title: 'Write', action: 'write', target: 'brief.md', riskTier: 'T1', dependsOn: ['gather'], declaredAssignment: null },
    { id: 'cite', title: 'Cite', action: 'cite', target: 'brief.md', riskTier: 'T1', dependsOn: ['write'], declaredAssignment: null },
  ],
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

const groupsByKey = (workflow: WorkflowDefEntry) =>
  Object.fromEntries(agentGroups(workflow).map((group) => [group.key, group.stages.map((stage) => stage.id)]));

describe('grouping steps under the agent that governs them', () => {
  /** THE PIN for "show each AGENT, not each SKILL": fourteen steps become four cards. */
  it('collapses the fourteen-step pipeline into one card per agent, steps in pipeline order', () => {
    const groups = agentGroups(videoRun());
    expect(groups.map((group) => group.key)).toEqual([
      'fyt-runner', 'fyt-preproduction', 'fyt-checker', 'fyt-production',
    ]);
    expect(groupsByKey(videoRun())).toEqual({
      'fyt-runner': ['image-review'],
      'fyt-preproduction': ['idea', 'research', 'script', 'shorts', 'metadata', 'shots', 'motion'],
      'fyt-checker': ['judge-gate', 'verify'],
      'fyt-production': ['voiceover', 'images', 'audio-plan', 'render'],
    });
    // Every step is accounted for exactly once, and nothing fell into the unresolved bucket.
    expect(groups.flatMap((group) => group.stages)).toHaveLength(14);
    expect(groups.some((group) => group.key === '')).toBe(false);
  });

  /** The manager also governs `image-review`. That is ONE card wearing both roles. */
  it('gives an agent that both manages and works a single card, not two', () => {
    const groups = agentGroups(videoRun());
    expect(groups.filter((group) => group.isManager)).toHaveLength(1);
    const runner = groups[0]!;
    expect(runner).toMatchObject({ key: 'fyt-runner', isManager: true, models: [OPUS] });
    expect(runner.stages.map((stage) => stage.id)).toEqual(['image-review']);
  });

  it('keeps a manager that governs no step as its own card with no steps', () => {
    const groups = agentGroups(entry({ manager: null, governedBy: 'fyt-runner' }));
    expect(groups[0]).toMatchObject({ key: 'fyt-runner', isManager: true, stages: [] });
    expect(groups.map((group) => group.key)).toEqual(['fyt-runner', 'alpha', 'beta']);
  });

  it('orders agents by their earliest step, with the manager at the head of the chain', () => {
    // Ranks put preproduction first (idea, rank 0), then checker (judge-gate, 3), then production
    // (voiceover, 4). fyt-runner's own step is rank 6 — it leads anyway, because it starts the run.
    const ranks = stageRanks(videoRun());
    expect(ranks.get('idea')).toBe(0);
    expect(ranks.get('judge-gate')).toBe(3);
    expect(ranks.get('voiceover')).toBe(4);
    expect(ranks.get('image-review')).toBe(6);
    expect(agentGroups(videoRun()).map((group) => group.key))
      .toEqual(['fyt-runner', 'fyt-preproduction', 'fyt-checker', 'fyt-production']);

    // Without a manager the pure earliest-step order stands on its own.
    const unmanaged = videoRun();
    unmanaged.resolvedManager = null;
    unmanaged.governedBy = null;
    expect(agentGroups(unmanaged).map((group) => group.key))
      .toEqual(['fyt-preproduction', 'fyt-checker', 'fyt-production', 'fyt-runner']);
  });

  it('reports each agent effective model and tags a resolved default', () => {
    const groups = agentGroups(videoRun());
    expect(groups.find((group) => group.key === 'fyt-preproduction')).toMatchObject({
      models: [SOL], isDefault: true, source: 'stage-governed-by',
    });
    expect(groups.find((group) => group.key === 'fyt-checker')?.models).toEqual([OPUS]);
  });

  it('claims no default tag for an agent whose steps are not all defaults', () => {
    const mixed = entry({ manager: null, governedBy: null, stages: [
      { id: 'one', title: 'One', action: 'one', target: 'o', riskTier: 'T1', resolvedAssignment: resolved({ agentId: 'alpha', source: 'declared' }) },
      { id: 'two', title: 'Two', action: 'two', target: 't', riskTier: 'T1', dependsOn: ['one'], resolvedAssignment: resolved({ agentId: 'alpha', source: 'stage-governed-by' }) },
    ] });
    expect(agentGroups(mixed)[0]).toMatchObject({ key: 'alpha', isDefault: false });
  });

  it('lists every distinct model an agent runs its steps on, inventing none', () => {
    const twoProfiles = entry({ manager: null, governedBy: null, stages: [
      { id: 'one', title: 'One', action: 'one', target: 'o', riskTier: 'T1', resolvedAssignment: resolved({ agentId: 'alpha', model: 'claude-opus-4-8' }) },
      { id: 'two', title: 'Two', action: 'two', target: 't', riskTier: 'T1', dependsOn: ['one'], resolvedAssignment: resolved({ agentId: 'alpha', model: 'claude-haiku-4-5' }) },
      { id: 'three', title: 'Three', action: 'three', target: 'h', riskTier: 'T1', dependsOn: ['two'], resolvedAssignment: resolved({ agentId: 'alpha', model: null }) },
    ] });
    expect(agentGroups(twoProfiles)[0]?.models).toEqual(['claude-opus-4-8', 'claude-haiku-4-5']);
  });

  /** An older payload predates `resolvedAssignment`; the declaration in the file is still the truth. */
  it('falls back to the step governing agent when the server sent no resolution', () => {
    const stage = { id: 'script', action: 'script', target: 's', riskTier: 'T1', governedBy: 'fyt-preproduction' };
    expect(stageSlot(stage)).toEqual({ agentId: 'fyt-preproduction', model: null, source: 'stage-governed-by', isDefault: true });
    expect(agentGroups(entry({ manager: null, governedBy: null, stages: [stage] }))[0]?.key).toBe('fyt-preproduction');
  });
});

describe('the zero-cast definition', () => {
  /** THE PIN for "one honest node, never an empty canvas". */
  it('gathers every unresolvable step under one card that says nothing resolved', () => {
    const groups = agentGroups(bare());
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ key: '', agentId: null, isManager: false, models: [] });
    expect(groups[0]?.stages.map((stage) => stage.id)).toEqual(['gather', 'write', 'cite']);
    expect(agentNodeId(null)).toBe(UNRESOLVED_NODE);
  });

  it('draws that card, states the fact, and keeps every step override reachable', () => {
    render(<WorkflowAgentGraph
      entry={bare()}
      assignmentOptions={{
        manager: { options: [], unavailable: null },
        stages: { gather: { options: [assign('writer')], unavailable: null } },
      }}
    />);
    const card = screen.getByTestId('workflow-agent-node-unresolved');
    expect(screen.getByTestId('workflow-agent-node-unresolved-nobody').textContent).toBe('no default agent resolvable');
    expect(card.textContent).not.toMatch(/assign|unassigned|nobody yet/i);
    for (const title of ['Gather', 'Write', 'Cite']) expect(card.textContent).toContain(title);
    // The override survived the redesign: one picker per step, still inside the card.
    expect(screen.getByLabelText('Who runs Gather')).toBeTruthy();
    expect(screen.getByLabelText('Who runs Cite')).toBeTruthy();
    // Nobody manages it, so there is no workflow-level picker to offer.
    expect(screen.queryByLabelText('Who runs the workflow')).toBeNull();
    expect(screen.queryByTestId('workflow-agent-network-empty')).toBeNull();
  });

  it('draws no handoff arrows, because one card cannot hand off to itself', () => {
    expect(agentEdges(bare())).toEqual([]);
  });
});

describe('arrows are handoffs BETWEEN agents', () => {
  it('collapses fourteen step dependencies into the deduped agent-level handoffs', () => {
    const edges = agentEdges(videoRun());
    const pairs = edges.map((edge) => `${edge.source}->${edge.target}`).sort();
    expect(pairs).toEqual([
      'agent:fyt-checker->agent:fyt-preproduction',
      'agent:fyt-checker->agent:fyt-production',
      'agent:fyt-preproduction->agent:fyt-checker',
      'agent:fyt-preproduction->agent:fyt-production',
      'agent:fyt-preproduction->agent:fyt-runner',
      'agent:fyt-production->agent:fyt-checker',
      'agent:fyt-production->agent:fyt-runner',
      'agent:fyt-runner->agent:fyt-preproduction',
      'agent:fyt-runner->agent:fyt-production',
    ].sort());
    // Deduped: three separate steps depend on `judge-gate`, and they draw ONE checker->preproduction arrow.
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it('never draws an agent handing off to itself', () => {
    // `idea -> research -> script` and `shots -> motion` are all preproduction; none of them is an arrow.
    for (const edge of agentEdges(videoRun())) expect(edge.source).not.toBe(edge.target);
    const soloAgent = entry({ manager: null, governedBy: null, stages: [
      { id: 'one', title: 'One', action: 'one', target: 'o', riskTier: 'T1', resolvedAssignment: resolved({ agentId: 'alpha' }) },
      { id: 'two', title: 'Two', action: 'two', target: 't', riskTier: 'T1', dependsOn: ['one'], resolvedAssignment: resolved({ agentId: 'alpha' }) },
    ] });
    expect(agentEdges(soloAgent)).toEqual([]);
  });

  it('reaches the agent that owns the opening step from the manager, distinctly', () => {
    const start = agentEdges(videoRun()).find((edge) => edge.id === 'start-fyt-preproduction');
    expect(start).toMatchObject({
      source: agentNodeId('fyt-runner'),
      target: agentNodeId('fyt-preproduction'),
      markerEnd: expect.objectContaining({ type: 'arrowclosed' }),
    });
    expect(start?.ariaLabel).toBe('fyt-preproduction starts the workflow');
  });

  it('names a handoff in plain words and points it at the agent that runs later', () => {
    const edge = agentEdges(videoRun()).find((candidate) => candidate.id === 'handoff-fyt-preproduction~fyt-checker');
    expect(edge?.ariaLabel).toBe('fyt-checker takes over from fyt-preproduction');
    expect(edge?.source).toBe(agentNodeId('fyt-preproduction'));
    expect(edge?.target).toBe(agentNodeId('fyt-checker'));
  });

  it('skips a dependency naming a step this workflow does not declare', () => {
    const edges = agentEdges(entry({ manager: null, governedBy: null, stages: [
      { id: 'one', action: 'one', target: 'one', riskTier: 'T1', resolvedAssignment: resolved({ agentId: 'alpha' }) },
      { id: 'two', action: 'two', target: 'two', riskTier: 'T1', dependsOn: ['one', 'missing'], resolvedAssignment: resolved({ agentId: 'beta' }) },
    ] }));
    expect(edges.map((edge) => edge.id)).toEqual(['handoff-alpha~beta']);
  });

  it('survives a malformed step cycle instead of recursing forever', () => {
    const workflow = entry({ manager: null, governedBy: null, stages: [
      { id: 'a', title: 'A', action: 'a', target: 'a', riskTier: 'T1', dependsOn: ['b'], resolvedAssignment: resolved({ agentId: 'alpha' }) },
      { id: 'b', title: 'B', action: 'b', target: 'b', riskTier: 'T1', dependsOn: ['a'], resolvedAssignment: resolved({ agentId: 'beta' }) },
    ] });
    render(<WorkflowAgentGraph entry={workflow} />);
    expect(screen.getByTestId('workflow-agent-node-alpha')).toBeTruthy();
    expect(screen.getByTestId('workflow-agent-node-beta')).toBeTruthy();
    expect(agentEdges(workflow)).toHaveLength(2);
  });
});

describe('the layout frames the whole cast', () => {
  /** THE PIN for "each node is too small and far apart I can't really see anything". */
  it('wraps the cast into at most two columns instead of one long thin chain', () => {
    const positions = agentNodePositions(videoRun());
    expect(AGENT_GRID_COLUMNS).toBe(2);
    const xs = [...positions.values()].map((point) => point.x);
    expect(new Set(xs)).toEqual(new Set([0, AGENT_NODE_WIDTH + AGENT_NODE_GAP_X]));
    // Four agents, two columns: the whole graph is two cards wide and two rows tall.
    const width = Math.max(...xs) + AGENT_NODE_WIDTH;
    expect(width).toBe(2 * AGENT_NODE_WIDTH + AGENT_NODE_GAP_X);
    expect(new Set([...positions.values()].map((point) => point.y)).size).toBe(2);
  });

  it('reads left to right in pipeline order, then wraps', () => {
    const positions = agentNodePositions(videoRun());
    const at = (agentId: string) => positions.get(agentNodeId(agentId))!;
    expect(at('fyt-runner')).toEqual({ x: 0, y: 0 });
    expect(at('fyt-preproduction')).toEqual({ x: AGENT_NODE_WIDTH + AGENT_NODE_GAP_X, y: 0 });
    expect(at('fyt-checker').x).toBe(0);
    expect(at('fyt-checker').y).toBeGreaterThan(0);
    expect(at('fyt-production').y).toBe(at('fyt-checker').y);
  });

  it('spaces a row by its TALLEST card, so a seven-step card never overlaps the row below', () => {
    const groups = agentGroups(videoRun());
    const preproduction = groups.find((group) => group.key === 'fyt-preproduction')!;
    const runner = groups.find((group) => group.key === 'fyt-runner')!;
    expect(agentNodeHeight(preproduction)).toBeGreaterThan(agentNodeHeight(runner));
    const positions = agentNodePositions(videoRun());
    expect(positions.get(agentNodeId('fyt-checker'))!.y).toBeGreaterThan(agentNodeHeight(preproduction));
  });

  it('puts a single card at the origin rather than holding a column open', () => {
    expect([...agentNodePositions(bare()).values()]).toEqual([{ x: 0, y: 0 }]);
  });

  /** `fitView` framed a chain wider than the canvas before, clipped by reactflow's own 0.5 zoom floor. */
  it('frames at 1:1 at most and is allowed to zoom below the reactflow default floor', () => {
    render(<WorkflowAgentGraph entry={videoRun()} />);
    const canvas = screen.getByTestId('reactflow-mock');
    expect(canvas.dataset.fitMaxZoom).toBe('1');
    expect(Number(canvas.dataset.minZoom)).toBeLessThan(0.5);
    expect(Number(canvas.dataset.fitMinZoom)).toBeLessThanOrEqual(0.3);
  });

  it('retains a dragged card and reroutes its handoffs through the new place', () => {
    render(<WorkflowAgentGraph entry={videoRun()} />);
    expect(screen.getByTestId('reactflow-edge-start-fyt-preproduction').dataset.sourceHandle).toBe('source-right');
    fireEvent.click(screen.getByRole('button', { name: 'Move the preproduction card' }));
    expect(screen.getByTestId('reactflow-position-agent:fyt-preproduction').dataset.position).toBe('0,900');
    expect(screen.getByTestId('reactflow-edge-start-fyt-preproduction').dataset.sourceHandle).toBe('source-bottom');
  });

  it('says so plainly when a workflow has no steps yet', () => {
    render(<WorkflowAgentGraph entry={entry({ stages: [], manager: null })} />);
    expect(screen.getByTestId('workflow-agent-network-empty').textContent).toContain('no steps');
  });

  it('explains itself in plain words', () => {
    render(<WorkflowAgentGraph entry={videoRun()} />);
    expect(screen.getByTestId('reactflow-panel').textContent).toContain('arrows show the handoffs between them');
  });
});

describe('what one agent card says', () => {
  it('leads with the agent, its model, and the steps it governs in order', () => {
    render(<WorkflowAgentGraph entry={videoRun()} />);
    const card = screen.getByTestId('workflow-agent-node-fyt-preproduction');
    expect(card.textContent).toContain('fyt-preproduction');
    expect(screen.getByTestId('workflow-agent-node-fyt-preproduction-agent').textContent).toContain(SOL);
    expect(screen.getByTestId('workflow-agent-node-fyt-preproduction-agent').textContent).toContain('default');

    const listed = [...screen.getByTestId('workflow-agent-node-fyt-preproduction-stages').children]
      .map((row) => row.textContent);
    expect(listed).toHaveLength(7);
    expect(listed[0]).toContain('Pick and brief one video idea');
    expect(listed[6]).toContain('Plan the per-shot motion layers');
    // Numbered, because the order of an agent's own worklist is the point.
    expect(listed[0]?.startsWith('1')).toBe(true);
  });

  it('marks the manager card and explains where a default came from', () => {
    render(<WorkflowAgentGraph entry={videoRun()} />);
    const runner = screen.getByTestId('workflow-agent-node-fyt-runner');
    expect(runner.textContent).toContain('runs the workflow');
    expect(runner.textContent).toContain('Batched review of every generated still');
    expect(screen.getByTestId('workflow-agent-node-fyt-runner-agent').querySelector('[title]')?.getAttribute('title'))
      .toBe('The agent that governs these steps.');
    // Every other card is an ordinary worker.
    expect(screen.getByTestId('workflow-agent-node-fyt-checker').textContent).not.toContain('runs the workflow');
  });

  it('shows an explicitly declared agent with no default tag, and omits an unpinned model', () => {
    render(<WorkflowAgentGraph
      entry={entry({ manager: null, governedBy: null, stages: [
        { id: 'draft', title: 'Draft', action: 'draft', target: 'd', riskTier: 'T1', declaredAssignment: assign('beta'), resolvedAssignment: resolved({ agentId: 'beta', source: 'declared', model: null }) },
      ] })}
      onOpenAgent={vi.fn()}
    />);
    const slot = screen.getByTestId('workflow-agent-node-beta-agent');
    expect(slot.textContent).toContain('Open agent');
    expect(slot.textContent).not.toContain('default');
    expect(slot.textContent).not.toMatch(/claude-|gpt-/);
  });

  /** Nothing true to say on the second line — so there is no empty bordered strip pretending there is. */
  it('drops the model line entirely when the roster pins nothing and there is nowhere to open', () => {
    render(<WorkflowAgentGraph entry={entry({ manager: null, governedBy: null, stages: [
      { id: 'draft', title: 'Draft', action: 'draft', target: 'd', riskTier: 'T1', declaredAssignment: assign('beta'), resolvedAssignment: resolved({ agentId: 'beta', source: 'declared', model: null }) },
    ] })} />);
    expect(screen.getByTestId('workflow-agent-node-beta').textContent).toContain('beta');
    expect(screen.queryByTestId('workflow-agent-node-beta-agent')).toBeNull();
  });

  it('opens the agent a card is, without a network write', () => {
    const onOpenAgent = vi.fn();
    vi.stubGlobal('fetch', vi.fn());
    render(<WorkflowAgentGraph entry={videoRun()} onOpenAgent={onOpenAgent} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Open agent' })[1]!);
    expect(onOpenAgent).toHaveBeenCalledWith('fyt-preproduction');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('states a manager that governs no step of its own rather than showing an empty list', () => {
    render(<WorkflowAgentGraph entry={entry({ manager: null, governedBy: 'fyt-runner' })} />);
    expect(screen.getByTestId('workflow-agent-node-fyt-runner').textContent).toContain('no steps of its own');
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

  it('keeps exactly one picker per step, on the card of the agent that governs it', () => {
    render(<WorkflowAgentGraph entry={videoRun()} assignmentOptions={{
      manager: { options: [assign('fyt-runner')], unavailable: null },
      stages: { 'image-review': { options: [assign('fyt-checker')], unavailable: null } },
    }} />);
    const runner = screen.getByTestId('workflow-agent-node-fyt-runner');
    expect(runner.querySelectorAll('select')).toHaveLength(2); // the workflow itself + image-review
    expect(screen.getByTestId('workflow-agent-node-fyt-preproduction').querySelectorAll('select')).toHaveLength(7);
    expect(screen.getByTestId('workflow-agent-node-fyt-checker').querySelectorAll('select')).toHaveLength(2);
    expect(screen.getAllByLabelText(/^Who runs /)).toHaveLength(15); // 14 steps + the workflow
  });

  it('offers keeping the default rather than choosing nobody', () => {
    render(<WorkflowAgentGraph entry={entry()} assignmentOptions={options()} />);
    expect((screen.getByLabelText('Who runs Review') as HTMLSelectElement).options[0]!.textContent).toBe('Keep the default');
  });

  it('states an unavailable choice rather than offering an empty picker', () => {
    render(<WorkflowAgentGraph
      entry={entry()}
      assignmentOptions={options({ stages: { ...options().stages, draft: { options: [], unavailable: 'Human binding required.' } } })}
    />);
    expect(screen.getByTestId('workflow-agent-node-beta').textContent).toContain('Human binding required.');
    expect(screen.queryByLabelText('Who runs Draft')).toBeNull();
  });

  it('keeps the current pair listed even after it stops being eligible', () => {
    render(<WorkflowAgentGraph
      entry={entry()}
      assignmentOptions={options({ stages: { ...options().stages, draft: { options: [assign('alpha')], unavailable: null } } })}
    />);
    expect((screen.getByLabelText('Who runs Draft') as HTMLSelectElement).value).toBe(JSON.stringify(['beta', 'worker:beta']));
  });

  it('freezes every picker while a change is in flight', () => {
    render(<WorkflowAgentGraph entry={entry()} assignmentOptions={options()} readOnly />);
    expect((screen.getByLabelText('Who runs Draft') as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText('Who runs the workflow') as HTMLSelectElement).disabled).toBe(true);
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

  /**
   * The layout positions cards by `AGENT_NODE_WIDTH`, but the CARD's real width comes from CSS. If the
   * two drift, `fitView` frames a box that is not the graph and the cards overlap or gape.
   */
  it('sizes the card in CSS to the same width the layout positions it by', () => {
    const rule = /\.v-workflow-agent\s*\{([^}]*)\}/.exec(css);
    const width = /width\s*:\s*([\d.]+)rem/.exec(rule?.[1] ?? '');
    expect(Number(width?.[1]) * 16).toBe(AGENT_NODE_WIDTH);
  });
});
