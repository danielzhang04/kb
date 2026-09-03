import { describe, expect, it } from 'vitest';
import type { RunMetadataDto, StageDto } from './controlClient';
import {
  agentIdsForRun,
  agentsForRun,
  agentLink,
  cardLink,
  cardOwnerIndex,
  cardsForAgent,
  runLink,
  runsForAgent,
  runsForWorkflow,
  workflowLink,
} from './entityLinks';
import type { PlaneAIndex } from '../../server/planeA/indexer';

const run = (over: Partial<RunMetadataDto>): RunMetadataDto => ({
  ownerSubject: 'operator',
  owner: { type: 'agent', id: 'manager', sourcePath: 'agents/manager.md' }, executionHost: 'desktop',
  terminalOutcome: null, completedAt: null, archivedFrom: null,
  runRef: 'run-1',
  predecessorRunRef: null,
  title: 'Rebuild the faceless video pipeline',
  displayName: 'Rebuild the faceless video pipeline',
  shortRef: 1,
  workflowRef: 'video-pipeline',
  proposalRef: 'wf-aaa',
  proposalRevision: 1,
  proposalHash: 'hash-a',
  publicationState: 'published',
  state: 'running',
  version: 1,
  managerSessionRef: 'sess-m',
  managerGeneration: 0,
  managerAssignment: null,
  createdAt: '2026-07-20T10:01:00.000Z',
  updatedAt: '2026-07-20T10:02:00.000Z',
  stageCount: 2,
  attemptCount: 2,
  sessionCount: 1,
  openHumanRequestCount: 0,
  eventCount: 12,
  ...over,
});

const stage = (over: Partial<StageDto>): StageDto => ({
  stageRef: 'stage-1',
  runRef: 'run-1',
  stageId: 'write',
  title: 'Write the script',
  dependsOn: [],
  canonicalCardRef: 'card-100',
  state: 'running',
  version: 1,
  currentAttemptRef: 'att-1',
  assignment: null,
  workflowProfile: null,
  review: null,
  completionGate: null,
  currentGeneration: 1,
  currentGenerationRef: null,
  acceptedGenerationRef: null,
  createdAt: '2026-07-20T10:01:00.000Z',
  updatedAt: '2026-07-20T10:02:00.000Z',
  ...over,
});

const indexWith = (cards: Array<{ id: string; owner?: string; state?: string; action?: string }>): PlaneAIndex => ({
  cards: {
    working: cards.map((c) => ({
      meta: { id: c.id, owner: c.owner, state: c.state ?? 'working', action: c.action ?? 'build' },
    })),
  } as unknown as PlaneAIndex['cards'],
  ledgers: {
    dispatch: { count: 0, cards: 0, byProject: {} },
    cost: { stepCount: 0, perModelSteps: {}, modelMix: {}, usdPresent: false },
    grades: { count: 0, rows: [] },
    activity: { count: 0, rows: [] },
  },
  orgStates: [],
});

describe('links', () => {
  it('sends every entity to the destination that owns it', () => {
    // The retarget lives in one table (`nav/stack.ts#focusTarget`); these builders are how the rest of
    // the app reaches it, so a run link can never drift back to a destination that no longer exists.
    expect(runLink('run-1')).toEqual({ view: 'workflows', focus: { kind: 'run', id: 'run-1' } });
    expect(workflowLink('video-pipeline')).toEqual({ view: 'workflows', focus: { kind: 'workflow', id: 'video-pipeline' } });
    expect(agentLink('claude-worker')).toEqual({ view: 'agents', focus: { kind: 'agent', id: 'claude-worker' } });
    expect(cardLink('card-100')).toEqual({ view: 'inbox', focus: { kind: 'card', id: 'card-100' } });
  });
});

describe('workflow -> runs', () => {
  it('groups on the server-stamped key, newest first, and leaves ad-hoc runs out', () => {
    const runs = runsForWorkflow('video-pipeline', [
      run({ runRef: 'run-1', createdAt: '2026-07-20T10:00:00.000Z' }),
      run({ runRef: 'run-2', createdAt: '2026-07-20T12:00:00.000Z' }),
      run({ runRef: 'run-3', workflowRef: 'other-workflow', createdAt: '2026-07-20T13:00:00.000Z' }),
      run({ runRef: 'run-4', workflowRef: null, createdAt: '2026-07-20T14:00:00.000Z' }),
    ]);
    expect(runs.map((r) => r.runRef)).toEqual(['run-2', 'run-1']);
  });
});

describe('run -> agent, via queue cards', () => {
  it('attributes each stage to its canonical card owner', () => {
    const owners = cardOwnerIndex(indexWith([
      { id: 'card-100', owner: 'claude-worker' },
      { id: 'card-200', owner: 'codex-worker' },
    ]));
    const links = agentsForRun(
      [stage({}), stage({ stageRef: 'stage-2', stageId: 'render', canonicalCardRef: 'card-200' })],
      owners,
    );
    expect(links.map((l) => l.agentId)).toEqual(['claude-worker', 'codex-worker']);
    expect(links[0].cardId).toBe('card-100');
  });

  it('invents no agent for a stage with no canonical card or no owner', () => {
    const owners = cardOwnerIndex(indexWith([{ id: 'card-100' }]));
    const links = agentsForRun(
      [stage({ canonicalCardRef: null }), stage({ stageRef: 'stage-2', canonicalCardRef: 'card-100' })],
      owners,
    );
    expect(links).toEqual([]);
  });

  it('de-duplicates agents working several stages of one run', () => {
    const owners = cardOwnerIndex(indexWith([
      { id: 'card-100', owner: 'claude-worker' },
      { id: 'card-101', owner: 'claude-worker' },
    ]));
    const ids = agentIdsForRun(
      [stage({}), stage({ stageRef: 'stage-2', canonicalCardRef: 'card-101' })],
      owners,
    );
    expect(ids).toEqual(['claude-worker']);
  });
});

describe('agent -> its work', () => {
  it('finds the runs an agent is working through the inverse card index', () => {
    const owners = cardOwnerIndex(indexWith([
      { id: 'card-100', owner: 'claude-worker' },
      { id: 'card-200', owner: 'codex-worker' },
    ]));
    const loaded = [
      { run: run({ runRef: 'run-1' }), stages: [stage({})] },
      { run: run({ runRef: 'run-2' }), stages: [stage({ stageRef: 's2', canonicalCardRef: 'card-200' })] },
    ];
    expect(runsForAgent('claude-worker', loaded, owners).map((r) => r.runRef)).toEqual(['run-1']);
    expect(runsForAgent('nobody', loaded, owners)).toEqual([]);
  });

  it('lists the queue cards an agent owns', () => {
    const cards = cardsForAgent('claude-worker', indexWith([
      { id: 'card-100', owner: 'claude-worker', action: 'build' },
      { id: 'card-200', owner: 'codex-worker' },
    ]));
    expect(cards.map((c) => c.id)).toEqual(['card-100']);
    expect(cards[0].action).toBe('build');
  });
});
