/**
 * Read-only FYT registration acceptance.  This deliberately exercises the checked-out definition
 * through the public registry route; it never launches a run or invokes a workflow worker.
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
  'idea', 'research', 'script', 'judge-gate', 'shorts', 'metadata', 'shots', 'motion',
  'images', 'image-review', 'voiceover', 'audio-plan', 'render', 'verify',
];

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
  it('parses the four checked-out FYT declarations as declared-only, not runner-bound', () => {
    const declarations = readDeclaredAgents(REPO_ROOT);
    expect(['fyt-runner', 'fyt-preproduction', 'fyt-production', 'fyt-checker'].map((id) => {
      const declaration = declarations.get(id);
      return { id, runnerBound: declaration?.runnerBound };
    })).toEqual([
      { id: 'fyt-runner', runnerBound: false },
      { id: 'fyt-preproduction', runnerBound: false },
      { id: 'fyt-production', runnerBound: false },
      { id: 'fyt-checker', runnerBound: false },
    ]);
  });

  it('discovers the actual definition as valid, launchable, generic, and presently unassigned', async () => {
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
        stageCount: 14,
        parameters: ['channel', 'slug'],
        manager: null,
        pendingAmendment: null,
      });
      expect((item?.stages as Array<Record<string, unknown>>).map((stage) => stage.id)).toEqual(STAGE_IDS);
      expect((item?.stages as Array<Record<string, unknown>>).every((stage) => stage.declaredAssignment === null)).toBe(true);

      const detail = await app.inject({ method: 'GET', url: '/api/workflows/video-run' });
      expect(detail.statusCode).toBe(200);
      const body = detail.json() as {
        definition: { profile: string; parameters: string[]; manager?: unknown; stages: Array<{ agentId?: unknown; profileId?: unknown }> };
        compiled: { ok: boolean; manager: Record<string, unknown>; stages: Array<Record<string, unknown>> };
        assignmentOptions: { manager: { options: unknown[]; unavailable: string | null }; stages: Record<string, { options: unknown[]; unavailable: string | null }> };
      };
      // This is the generic `producer` path: it is compiler-launchable without an authored immutable
      // binding, not an assertion that a real runner has been activated.
      expect(body.definition).toMatchObject({ profile: 'producer', parameters: ['channel', 'slug'] });
      expect(body.definition.manager).toBeUndefined();
      expect(body.definition.stages).toHaveLength(14);
      expect(body.definition.stages.every((stage) => stage.agentId === undefined && stage.profileId === undefined)).toBe(true);
      expect(body.compiled.ok).toBe(true);
      expect(body.compiled.manager.assignment).toBeUndefined();
      expect(body.compiled.stages).toHaveLength(14);
      expect(body.compiled.stages.every((stage) => stage.assignment === undefined)).toBe(true);
      expect(body.assignmentOptions.manager).toEqual({
        options: [],
        unavailable: 'Human binding required: no runner-bound declared agent is eligible for this workflow assignment.',
      });
      expect(Object.values(body.assignmentOptions.stages)).toEqual(
        STAGE_IDS.map(() => ({
          options: [],
          unavailable: 'Human binding required: no runner-bound declared agent is eligible for this workflow assignment.',
        })),
      );
    } finally {
      await app.close();
    }
  });
});
