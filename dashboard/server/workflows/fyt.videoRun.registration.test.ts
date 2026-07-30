/**
 * Read-only FYT registration acceptance.  This deliberately exercises the checked-out definition
 * through the public registry route; it never launches a run or invokes a workflow worker.
 *
 * It is the acceptance test for the gate-machinery task: the checked-out `video-run.md` must parse,
 * compile, bind all six roster agents, and expose gates G0-G4 at the spec's positions with exactly
 * one of them carrying the run's spend authorization.
 */
import Fastify from 'fastify';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createInMemoryControlPlaneStore } from '../control/store.ts';
import { createInMemoryComposerStore } from '../composer/store.ts';
import { createProviderIdProtector } from '../composer/protector.ts';
import { makeSurfaceContext } from '../http/surface.ts';
import { readDeclaredAgents } from '../agents/roster.ts';
import { createInMemoryAssignmentAmendmentStore } from './amendmentStore.ts';
import { registerWorkflows } from './routes.ts';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const SESSION_SECRET = Buffer.from('fyt-registration-test-secret-32bytes');
const STAGE_IDS = [
  'idea', 'story', 'judge-gate', 'packaging', 'visual-plan', 'images', 'image-review',
  'audio', 'render', 'verify', 'publish-private',
];
/** Every stage is executable: a declared agent id plus the worker execution profile it binds through. */
const ASSIGNMENTS: Record<string, string> = {
  idea: 'fyt-story',
  story: 'fyt-story',
  'judge-gate': 'fyt-checker',
  packaging: 'fyt-story',
  'visual-plan': 'fyt-visuals',
  images: 'fyt-visuals',
  'image-review': 'fyt-checker',
  audio: 'fyt-audio-render',
  render: 'fyt-audio-render',
  verify: 'fyt-checker',
  'publish-private': 'fyt-publish',
};
const WORKER_PROFILE = 'worker:claude:claude-fable-5';
/**
 * Gate placement. `execution.ts#stageBoundary` evaluates a stage's declared gates BEFORE preparing
 * any attempt for it, so a gate is declared on the stage it must hold back — the stage AFTER the work
 * being judged. This map is the acceptance statement of that decision.
 */
const GATES: Record<string, string[]> = {
  story: ['g0-idea-pick'],
  packaging: ['g1-script'],
  images: ['g2-visual-plan'],
  // `audio` declares TWO: the shot-board approval that releases it, and the recorded cost authorization
  // for the paid narration call it makes. `stageBoundary` raises a stage's gates one at a time and holds
  // the stage until every one is recorded approved.
  audio: ['g3-image-board', 'g3b-narration-cost'],
  'publish-private': ['g4-publish-private'],
};
/** Every gate that IS a recorded cost authorization — one per paid stage, and only on paid stages. */
const SPEND_GATES = ['images:g2-visual-plan', 'audio:g3b-narration-cost'];
const GOVERNANCE = {
  workflow: 'fyt-runner',
  stages: {
    idea: 'fyt-story',
    story: 'fyt-story',
    'judge-gate': 'fyt-checker',
    packaging: 'fyt-story',
    'visual-plan': 'fyt-visuals',
    images: 'fyt-visuals',
    'image-review': 'fyt-checker',
    audio: 'fyt-audio-render',
    render: 'fyt-audio-render',
    verify: 'fyt-checker',
    'publish-private': 'fyt-publish',
  },
} as const;

function makeApp() {
  const app = Fastify();
  registerWorkflows(app, makeSurfaceContext({
    repoRoot: REPO_ROOT,
    stateRoot: REPO_ROOT,
    sessionConfig: { secret: SESSION_SECRET, ttlMs: 60_000 },
    allowedOrigins: [],
    credentials: () => [],
    definitionAmendmentStore: createInMemoryAssignmentAmendmentStore(),
    controlStore: createInMemoryControlPlaneStore(),
    composerStore: createInMemoryComposerStore({ protector: createProviderIdProtector(SESSION_SECRET) }),
  }));
  return app;
}

describe('checked-out FYT video-run registry acceptance', () => {
  it('parses the six checked-out roster declarations as runner-bound, and the two superseded ones as not', () => {
    const declarations = readDeclaredAgents(REPO_ROOT);
    const roster = ['fyt-runner', 'fyt-story', 'fyt-visuals', 'fyt-audio-render', 'fyt-publish', 'fyt-checker'];
    expect(roster.map((id) => ({ id, runnerBound: declarations.get(id)?.runnerBound }))).toEqual(
      roster.map((id) => ({ id, runnerBound: true })),
    );
    // The old role-cut agents are tombstoned, not deleted: they must stay parsable and unbindable.
    expect(['fyt-preproduction', 'fyt-production'].map((id) => ({ id, runnerBound: declarations.get(id)?.runnerBound })))
      .toEqual([{ id: 'fyt-preproduction', runnerBound: false }, { id: 'fyt-production', runnerBound: false }]);
  });

  it('discovers the actual definition as valid, launchable, and executable on the six-agent roster', async () => {
    const app = makeApp();
    await app.ready();
    try {
      const listed = await app.inject({ method: 'GET', url: '/api/workflows' });
      expect(listed.statusCode).toBe(200);
      const item = (listed.json().items as Array<Record<string, unknown>>).find((entry) => entry.ref === 'video-run');
      expect(item).toMatchObject({
        ref: 'video-run',
        project: 'faceless-youtube',
        path: 'orgs/faceless-youtube/workflows/video-run.md',
        valid: true,
        launchable: true,
        profile: 'producer',
        governedBy: GOVERNANCE.workflow,
        governanceProblems: [],
        stageCount: 11,
        parameters: ['channel', 'slug', 'slice'],
        manager: { agentId: 'fyt-runner', profileId: 'manager:claude:claude-fable-5' },
        pendingAmendment: null,
      });
      const listedStages = item?.stages as Array<Record<string, unknown>>;
      expect(listedStages.map((stage) => stage.id)).toEqual(STAGE_IDS);
      // `governedBy` is retained for display continuity only; `declaredAssignment` is what executes.
      expect(Object.fromEntries(listedStages.map((stage) => [stage.id, stage.governedBy]))).toEqual(GOVERNANCE.stages);
      expect(Object.fromEntries(listedStages.map((stage) => [stage.id, stage.declaredAssignment]))).toEqual(
        Object.fromEntries(STAGE_IDS.map((id) => [id, { agentId: ASSIGNMENTS[id], profileId: WORKER_PROFILE }])),
      );
      // A single chain: no path routes around a gate, so every stage downstream of an unapproved gate
      // is structurally unreachable rather than merely discouraged.
      expect(Object.fromEntries(listedStages.map((stage) => [stage.id, stage.dependsOn]))).toEqual(
        Object.fromEntries(STAGE_IDS.map((id, index) => [id, index === 0 ? [] : [STAGE_IDS[index - 1]]])),
      );

      const detail = await app.inject({ method: 'GET', url: '/api/workflows/video-run' });
      expect(detail.statusCode).toBe(200);
      const body = detail.json() as {
        definition: {
          profile: string; governedBy?: string; parameters: string[];
          manager?: { agentId: string; profileId: string };
          stages: Array<{ id: string; governedBy?: string; agentId?: string; profileId?: string; humanGates?: unknown }>;
        };
        compiled: {
          ok: boolean; manager: Record<string, unknown>;
          stages: Array<{ id: string; assignment?: Record<string, unknown>; humanGates: Array<Record<string, unknown>> }>;
        };
      };
      expect(body.definition).toMatchObject({
        profile: 'producer', governedBy: GOVERNANCE.workflow, parameters: ['channel', 'slug', 'slice'],
        manager: { agentId: 'fyt-runner', profileId: 'manager:claude:claude-fable-5' },
      });
      expect(body.definition.stages).toHaveLength(11);
      expect(body.compiled.ok).toBe(true);
      expect(body.compiled.stages).toHaveLength(11);
      expect(body.compiled.manager).toMatchObject({
        runtime: 'claude', model: 'claude-fable-5',
        assignment: { agentId: 'fyt-runner', profileId: 'manager:claude:claude-fable-5' },
      });
      // Every stage resolves to an immutable declaration binding, on Fable 5, through a worker profile.
      expect(body.compiled.stages.map((stage) => [stage.id, stage.assignment?.agentId, stage.assignment?.profileId])).toEqual(
        STAGE_IDS.map((id) => [id, ASSIGNMENTS[id], WORKER_PROFILE]),
      );
      expect(body.compiled.stages.every((stage) => stage.assignment?.model === 'claude-fable-5')).toBe(true);

      // The gates: at the spec's positions, all approval-kind, all threaded through the compiler
      // (a hardcoded `humanGates: []` would make every one of these assertions fail).
      expect(Object.fromEntries(
        body.compiled.stages.filter((stage) => stage.humanGates.length > 0).map((stage) => [stage.id, stage.humanGates]),
      )).toEqual(Object.fromEntries(Object.entries(GATES).map(([stageId, gateIds]) => [stageId, gateIds.map((gateId) => expect.objectContaining({
        id: gateId, kind: 'approval', prompt: expect.any(String),
      }))])));
      expect(body.compiled.stages.filter((stage) => stage.humanGates.length > 0).map((stage) => stage.id))
        .toEqual(STAGE_IDS.filter((id) => id in GATES));

      // EVERY paid stage carries its own recorded cost authorization, and only paid stages do. G2 is the
      // one human decision; `audio` restates it as `g3b-narration-cost` because the control plane
      // authorizes cost PER STAGE, so a targeted single-stage re-run of narration would otherwise call a
      // paid API with no authorization recorded against the stage that called it. Approving G0/G1/G3/G4
      // must still never read as a cost authorization.
      const spendGates = body.compiled.stages.flatMap((stage) => stage.humanGates
        .filter((gate) => gate.spendAuthorization === true)
        .map((gate) => `${stage.id}:${gate.id}`));
      expect(spendGates).toEqual(SPEND_GATES);
      const spendGateIds = new Set(SPEND_GATES.map((entry) => entry.split(':')[1]));
      expect(body.compiled.stages.flatMap((stage) => stage.humanGates)
        .filter((gate) => !spendGateIds.has(gate.id as string))
        .every((gate) => gate.spendAuthorization === undefined)).toBe(true);
    } finally {
      await app.close();
    }
  });
});
