import Fastify from 'fastify';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mintSession, type SessionConfig } from '../auth/session.ts';
import { makeSurfaceContext } from '../http/surface.ts';
import { createInMemoryControlPlaneStore } from '../control/store.ts';
import { workflowCardId } from '../write/workflowRun.ts';
import { registerWorkflows } from './routes.ts';

const SESSION: SessionConfig = { secret: Buffer.from('workflow-route-test-secret-32byte!'), ttlMs: 60_000 };
const ORIGIN = 'http://localhost:5317';
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

function headers(token?: string): Record<string, string> {
  const base: Record<string, string> = { origin: ORIGIN, host: 'localhost:5317', 'content-type': 'application/json' };
  if (token) base.authorization = `Bearer ${token}`;
  return base;
}

describe('workflow definition routes', () => {
  let app: ReturnType<typeof Fastify>;
  let controlStore: ReturnType<typeof createInMemoryControlPlaneStore>;
  let token: string;

  beforeEach(async () => {
    let id = 0;
    controlStore = createInMemoryControlPlaneStore({ newId: () => `ref-${++id}` });
    token = mintSession('operator', SESSION).token;
    app = Fastify();
    registerWorkflows(app, makeSurfaceContext({
      repoRoot: REPO_ROOT,
      sessionConfig: SESSION,
      allowedOrigins: [ORIGIN],
      credentials: () => [],
      controlStore,
      appendAudit: (_repoRoot, event) => ({ ts: new Date().toISOString(), ...event }),
      appendAuditLocal: (_repoRoot, event) => ({ ts: new Date().toISOString(), ...event }),
      runPreamble: () => ({ exitCode: 0, stdout: 'PREAMBLE OK', stderr: '' }),
      opsGit: (_repoRoot, args) => (args.join(' ') === 'rev-parse --abbrev-ref HEAD' ? 'ops\n' : ''),
      runPy: (_repoRoot, _code, jsonArg) => {
        const op = JSON.parse(jsonArg) as { runId: string; stages: Array<{ id: string }> };
        const cards = op.stages.map((stage) => {
          const cardId = workflowCardId(op.runId, stage.id);
          return { stageId: stage.id, cardId, state: 'blocked', cardPath: `queue/inbox/${cardId}.md` };
        });
        return { exitCode: 0, stdout: `${JSON.stringify({ runId: op.runId, cards })}\n`, stderr: '' };
      },
    }));
    await app.ready();
  });

  afterEach(async () => app.close());

  it('lists the shipped org workflow definitions as valid', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/workflows' });
    expect(response.statusCode).toBe(200);
    const items = response.json().items as Array<{ ref: string; valid: boolean; project: string; riskTier: string }>;
    const triage = items.find((item) => item.ref === 'email-triage');
    const brief = items.find((item) => item.ref === 'research-brief');
    expect(triage).toMatchObject({ valid: true, project: 'kb-ops', riskTier: 'T2' });
    expect(brief).toMatchObject({ valid: true, project: 'kb-ops', riskTier: 'T2' });
  });

  it('returns a definition with its compiled proposal preview and content hash', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/workflows/research-brief' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { definition: { id: string } | null; compiled: { ok: boolean; proposalId: string; contentHash: string; stages: unknown[] } };
    expect(body.definition?.id).toBe('research-brief');
    expect(body.compiled.ok).toBe(true);
    expect(body.compiled.proposalId).toMatch(/^wf-[a-f0-9]{48}$/);
    expect(body.compiled.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(body.compiled.stages).toHaveLength(1);
  });

  it('404s an unknown definition', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/workflows/nope' });
    expect(response.statusCode).toBe(404);
  });

  it('refuses the launch without a session', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/workflows/research-brief/launch', headers: headers(), payload: {} });
    expect(response.statusCode).toBe(401);
  });

  it('launches a definition through the control plane and stalls at the activation gate', async () => {
    const response = await app.inject({
      method: 'POST', url: '/api/workflows/research-brief/launch', headers: headers(token), payload: {},
    });
    expect(response.statusCode).toBe(202);
    const body = response.json() as { ok: boolean; runRef: string; activationGated: boolean; waitingHuman: boolean; cards: unknown[] };
    expect(body.ok).toBe(true);
    expect(body.activationGated).toBe(true);
    expect(body.waitingHuman).toBe(true);
    expect(body.cards).toHaveLength(1);

    // The run is durably projected: published, waiting on the runtime-activation human gate.
    const run = controlStore.getRun('operator', body.runRef);
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.value.run.publicationState).toBe('published');
    expect(run.value.run.state).toBe('waiting-human');
    expect(run.value.humanRequests.some((request) => request.title === 'Automatic execution activation is gated')).toBe(true);
  });
});
