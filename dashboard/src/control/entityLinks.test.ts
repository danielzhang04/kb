import { describe, expect, it } from 'vitest';
import { listProposalRevisions, type ProposalRevisionMetadataDto, type RunMetadataDto, type StageDto } from './controlClient';
import {
  agentIdsForRun,
  agentsForRun,
  cardOwnerIndex,
  cardsForAgent,
  proposalRefsForWorkflow,
  runsForAgent,
  runsForWorkflow,
  workflowIdForRun,
  WORKFLOW_COMPOSER_REF,
} from './entityLinks';
import type { PlaneAIndex } from '../../server/planeA/indexer';

const revision = (over: Partial<ProposalRevisionMetadataDto>): ProposalRevisionMetadataDto => ({
  proposalRef: 'wf-aaa',
  revision: 1,
  contentHash: 'hash-a',
  previousContentHash: null,
  createdAt: '2026-07-20T10:00:00.000Z',
  sourceComposerRef: WORKFLOW_COMPOSER_REF,
  sourceTurnId: 'video-pipeline',
  approval: null,
  ...over,
});

const run = (over: Partial<RunMetadataDto>): RunMetadataDto => ({
  runRef: 'run-1',
  predecessorRunRef: null,
  title: 'Rebuild the faceless video pipeline',
  displayName: 'Rebuild the faceless video pipeline',
  shortRef: 1,
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

/**
 * THE join key. `sourceTurnId` is invisible at runtime when it goes missing — the workflow detail just
 * renders "no runs" forever and nothing errors — so its survival through normalization is asserted
 * directly against the wire shape rather than trusted.
 */
describe('proposal revision provenance survives normalization', () => {
  it('keeps sourceTurnId and sourceComposerRef from the raw wire record', async () => {
    const wire = {
      proposals: [
        {
          proposalRef: 'wf-aaa',
          sourceComposerRef: 'workflow-registry',
          sourceTurnId: 'video-pipeline',
          revision: 1,
          hash: 'hash-a',
          previousHash: null,
          title: 'Video pipeline',
          createdAt: '2026-07-20T10:00:00.000Z',
          approval: null,
        },
      ],
    };
    const fetchImpl = (async () =>
      new Response(JSON.stringify(wire), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;

    const [only] = await listProposalRevisions('workflow-registry', 'token', fetchImpl);

    // If either assertion fails, workflow -> runs is silently severed everywhere in the UI.
    expect(only.sourceTurnId).toBe('video-pipeline');
    expect(only.sourceComposerRef).toBe('workflow-registry');
  });
});

describe('workflow -> runs', () => {
  it('collects every proposal ref a definition launched', () => {
    const refs = proposalRefsForWorkflow('video-pipeline', [
      revision({}),
      revision({ proposalRef: 'wf-bbb', revision: 2 }),
      revision({ proposalRef: 'wf-ccc', sourceTurnId: 'other-pipeline' }),
    ]);
    expect([...refs].sort()).toEqual(['wf-aaa', 'wf-bbb']);
  });

  it('ignores revisions that did not come from the workflow registry', () => {
    const refs = proposalRefsForWorkflow('video-pipeline', [
      revision({ sourceComposerRef: 'composer', proposalRef: 'adhoc-1' }),
    ]);
    expect(refs.size).toBe(0);
  });

  it('reaches the runs launched from a definition, newest first', () => {
    const runs = runsForWorkflow(
      'video-pipeline',
      [revision({}), revision({ proposalRef: 'wf-bbb' })],
      [
        run({ runRef: 'run-1', proposalRef: 'wf-aaa', createdAt: '2026-07-20T10:00:00.000Z' }),
        run({ runRef: 'run-2', proposalRef: 'wf-bbb', createdAt: '2026-07-20T12:00:00.000Z' }),
        run({ runRef: 'run-3', proposalRef: 'unrelated', createdAt: '2026-07-20T13:00:00.000Z' }),
      ],
    );
    expect(runs.map((r) => r.runRef)).toEqual(['run-2', 'run-1']);
  });

  it('resolves a run back to its definition, and to null for an ad-hoc run', () => {
    const revisions = [revision({}), revision({ proposalRef: 'adhoc-1', sourceComposerRef: 'composer' })];
    expect(workflowIdForRun({ proposalRef: 'wf-aaa' }, revisions)).toBe('video-pipeline');
    expect(workflowIdForRun({ proposalRef: 'adhoc-1' }, revisions)).toBeNull();
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
