/**
 * Read-only FYT registration acceptance.  This deliberately exercises the checked-out definition
 * through the public registry route; it never launches a run or invokes a workflow worker.
 *
 * It is the acceptance test for the gate-machinery task: the checked-out `video-run.md` must parse,
 * compile, bind all six roster agents, and expose gates G0-G4 at the spec's positions with exactly
 * one of them carrying the run's spend authorization.
 */
import Fastify from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createInMemoryControlPlaneStore } from '../control/store.ts';
import { createInMemoryComposerStore } from '../composer/store.ts';
import { createProviderIdProtector } from '../composer/protector.ts';
import { loadWorkflowCompileEnvironment } from '../control/environment.ts';
import { makeSurfaceContext } from '../http/surface.ts';
import { readDeclaredAgents } from '../agents/roster.ts';
import { createInMemoryAssignmentAmendmentStore } from './amendmentStore.ts';
import { compileWorkflowDef } from './compile.ts';
import { registerWorkflows, scanWorkflowDefs } from './routes.ts';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const SESSION_SECRET = Buffer.from('fyt-registration-test-secret-32bytes');
const STAGE_IDS = [
  'idea', 'story', 'judge-gate', 'packaging', 'visual-plan', 'shots-merge', 'images', 'image-review',
  'audio', 'audio-plan-merge', 'render', 'verify', 'publish-private',
];
/**
 * Every stage is executable — a declared agent id plus the worker execution profile it binds through —
 * INCLUDING the two runner-governed staging→root merge nodes, which resolve to `fyt-checker`. `fyt-runner`
 * owns those writes' place in the run under the single-writer law (see `GOVERNANCE.stages` below), but it
 * is declared with a MANAGER default execution profile, and `compile.ts#resolveAssignment` requires a
 * stage's agent to have a WORKER one, so this workflow's manager cannot also be one of its stage workers.
 * The merge is a verification act — re-linting a plan neither merge node authored — which is exactly the
 * shape `fyt-checker` already owns everywhere else in this DAG, so assigning it there strengthens
 * author-never-grades rather than bending it. See video-run.md's single-writer section for the ruling.
 */
const ASSIGNMENTS: Record<string, string> = {
  idea: 'fyt-story',
  story: 'fyt-story',
  'judge-gate': 'fyt-checker',
  packaging: 'fyt-story',
  'visual-plan': 'fyt-visuals',
  'shots-merge': 'fyt-checker',
  images: 'fyt-visuals',
  'image-review': 'fyt-checker',
  audio: 'fyt-audio-render',
  'audio-plan-merge': 'fyt-checker',
  render: 'fyt-audio-render',
  verify: 'fyt-checker',
  'publish-private': 'fyt-publish',
};
const UNBOUND_STAGE_IDS: string[] = [];
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
    // The two merge nodes are governed by the conductor, which sequences and gates around them, even
    // though `fyt-checker` is the identity that actually writes the video root (see ASSIGNMENTS above).
    'shots-merge': 'fyt-runner',
    images: 'fyt-visuals',
    'image-review': 'fyt-checker',
    audio: 'fyt-audio-render',
    'audio-plan-merge': 'fyt-runner',
    render: 'fyt-audio-render',
    verify: 'fyt-checker',
    'publish-private': 'fyt-publish',
  },
} as const;

/**
 * State roots minted by {@link makeApp}, torn down after each test.
 *
 * `stateRoot` must NEVER be `REPO_ROOT`: `namingFor` (`http/context.ts`) hands any state root that is
 * not the production one its own `new NamingRegistry(join(stateRoot, 'naming.json'))`, so pointing it
 * at the repo made this read-only acceptance test mint real workflow ordinals into an untracked
 * `naming.json` at the worktree root. A temp dir is the documented isolation seam. `repoRoot` stays
 * REPO_ROOT — scanning the real checked-out definitions is the whole point of this test.
 */
const stateRoots: string[] = [];

afterEach(() => {
  while (stateRoots.length > 0) {
    rmSync(stateRoots.pop()!, { recursive: true, force: true });
  }
});

function makeApp() {
  const stateRoot = mkdtempSync(join(tmpdir(), 'fyt-videorun-'));
  stateRoots.push(stateRoot);
  const app = Fastify();
  registerWorkflows(app, makeSurfaceContext({
    repoRoot: REPO_ROOT,
    stateRoot,
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
      const item = (listed.json().items as Array<Record<string, unknown>>).find((entry) =>
        (entry.ref as { id?: string } | undefined)?.id === 'video-run');
      expect(item).toMatchObject({
        ref: {
          type: 'workflow', id: 'video-run', project: 'faceless-youtube',
          sourcePath: 'orgs/faceless-youtube/workflows/video-run.md',
        },
        humanName: 'Video Run', modelLabel: 'varies',
      });

      const scanned = scanWorkflowDefs(REPO_ROOT).find((entry) => entry.entry.ref === 'video-run');
      expect(scanned?.entry).toMatchObject({
        ref: 'video-run',
        project: 'faceless-youtube',
        path: 'orgs/faceless-youtube/workflows/video-run.md',
        valid: true,
        profile: 'producer',
        governedBy: GOVERNANCE.workflow,
        governanceProblems: [],
        stageCount: STAGE_IDS.length,
        parameters: ['channel', 'slug', 'slice'],
        manager: { agentId: 'fyt-runner', profileId: 'manager:claude:claude-fable-5' },
      });
      const listedStages = scanned?.entry.stages ?? [];
      expect(listedStages.map((stage) => stage.id)).toEqual(STAGE_IDS);
      // `governedBy` is retained for display continuity only; `declaredAssignment` is what executes.
      expect(Object.fromEntries(listedStages.map((stage) => [stage.id, stage.governedBy]))).toEqual(GOVERNANCE.stages);
      expect(Object.fromEntries(listedStages.map((stage) => [stage.id, stage.declaredAssignment]))).toEqual(
        Object.fromEntries(STAGE_IDS.map((id) => [
          id,
          // `null` is what the route emits for a stage with no authored binding. Every stage in this
          // definition has one, including both merge nodes (bound to `fyt-checker`), so `UNBOUND_STAGE_IDS`
          // is empty and this branch is exercised by no stage today.
          ASSIGNMENTS[id] ? { agentId: ASSIGNMENTS[id], profileId: WORKER_PROFILE } : null,
        ])),
      );
      expect(listedStages.filter((stage) => stage.declaredAssignment === null).map((stage) => stage.id))
        .toEqual(UNBOUND_STAGE_IDS);
      // A single chain: no path routes around a gate, so every stage downstream of an unapproved gate
      // is structurally unreachable rather than merely discouraged.
      expect(Object.fromEntries(listedStages.map((stage) => [stage.id, stage.dependsOn]))).toEqual(
        Object.fromEntries(STAGE_IDS.map((id, index) => [id, index === 0 ? [] : [STAGE_IDS[index - 1]]])),
      );

      const detail = await app.inject({ method: 'GET', url: '/api/workflows/video-run' });
      expect(detail.statusCode).toBe(200);
      const detailBody = detail.json() as {
        summary: { ref: { id: string; sourcePath: string } };
        details: { workflow: { stepDag: { nodes: Array<{ stageRef: string }> } } };
      };
      expect(detailBody.summary.ref).toEqual({
        type: 'workflow', id: 'video-run', project: 'faceless-youtube',
        sourcePath: 'orgs/faceless-youtube/workflows/video-run.md',
      });
      expect(detailBody.details.workflow.stepDag.nodes.map((node) => node.stageRef)).toEqual(STAGE_IDS);

      expect(scanned?.def).toMatchObject({
        profile: 'producer', governedBy: GOVERNANCE.workflow, parameters: ['channel', 'slug', 'slice'],
        manager: { agentId: 'fyt-runner', profileId: 'manager:claude:claude-fable-5' },
      });
      expect(scanned?.def?.stages).toHaveLength(STAGE_IDS.length);
      if (!scanned?.def) throw new Error('video-run definition did not scan');
      const compilation = compileWorkflowDef(scanned.def, loadWorkflowCompileEnvironment(REPO_ROOT));
      expect(compilation.ok).toBe(true);
      if (!compilation.ok) throw new Error(compilation.detail);
      const compiled = compilation.value;
      expect(compiled.stages).toHaveLength(STAGE_IDS.length);
      expect(compiled.manager).toMatchObject({
        runtime: 'claude', model: 'claude-fable-5',
        assignment: { agentId: 'fyt-runner', profileId: 'manager:claude:claude-fable-5' },
      });
      // Every stage resolves to an immutable declaration binding, on Fable 5, through a worker profile —
      // including the two merge nodes, both bound to `fyt-checker` (see the ASSIGNMENTS note).
      expect(compiled.stages.map((stage) => [stage.id, stage.assignment?.agentId, stage.assignment?.profileId])).toEqual(
        STAGE_IDS.map((id) => (ASSIGNMENTS[id] ? [id, ASSIGNMENTS[id], WORKER_PROFILE] : [id, undefined, undefined])),
      );
      expect(compiled.stages.filter((stage) => stage.assignment)
        .every((stage) => stage.assignment?.model === 'claude-fable-5')).toBe(true);
      expect(compiled.stages.filter((stage) => !stage.assignment).map((stage) => stage.id))
        .toEqual(UNBOUND_STAGE_IDS);

      // The gates: at the spec's positions, all approval-kind, all threaded through the compiler
      // (a hardcoded `humanGates: []` would make every one of these assertions fail).
      expect(Object.fromEntries(
        compiled.stages.filter((stage) => stage.humanGates.length > 0).map((stage) => [stage.id, stage.humanGates]),
      )).toEqual(Object.fromEntries(Object.entries(GATES).map(([stageId, gateIds]) => [stageId, gateIds.map((gateId) => expect.objectContaining({
        id: gateId, kind: 'approval', prompt: expect.any(String),
      }))])));
      expect(compiled.stages.filter((stage) => stage.humanGates.length > 0).map((stage) => stage.id))
        .toEqual(STAGE_IDS.filter((id) => id in GATES));

      // EVERY paid stage carries its own recorded cost authorization, and only paid stages do. G2 is the
      // one human decision; `audio` restates it as `g3b-narration-cost` because the control plane
      // authorizes cost PER STAGE, so a targeted single-stage re-run of narration would otherwise call a
      // paid API with no authorization recorded against the stage that called it. Approving G0/G1/G3/G4
      // must still never read as a cost authorization.
      const spendGates = compiled.stages.flatMap((stage) => stage.humanGates
        .filter((gate) => gate.spendAuthorization === true)
        .map((gate) => `${stage.id}:${gate.id}`));
      expect(spendGates).toEqual(SPEND_GATES);
      const spendGateIds = new Set(SPEND_GATES.map((entry) => entry.split(':')[1]));
      expect(compiled.stages.flatMap((stage) => stage.humanGates)
        .filter((gate) => !spendGateIds.has(gate.id as string))
        .every((gate) => gate.spendAuthorization === undefined)).toBe(true);
    } finally {
      await app.close();
    }
  });
});
