import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mintSession, type SessionConfig } from '../auth/session.ts';
import { createInMemoryControlPlaneStore, type ControlPlaneStore } from '../control/store.ts';
import { makeSurfaceContext } from '../http/surface.ts';
import { runtimeCapabilities } from '../runtime/capabilities.ts';
import { workflowCardId } from '../write/workflowRun.ts';
import { stagingGit } from '../testFixtures/stagingGit.ts';
import { registerAgents } from './routes.ts';

const SESSION: SessionConfig = { secret: Buffer.from('agent-route-test-secret-32bytes!'), ttlMs: 60_000 };
const ORIGIN = 'http://localhost:5317';
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'agent-p2-'));
  mkdirSync(join(root, 'agents'), { recursive: true });
  mkdirSync(join(root, 'orgs', 'kb-ops'), { recursive: true });
  for (const rel of ['governance', 'CLAUDE.md', join('orgs', 'kb-ops', 'contract.md')]) {
    const from = join(REPO_ROOT, rel);
    if (existsSync(from)) { mkdirSync(join(root, rel, '..'), { recursive: true }); cpSync(from, join(root, rel), { recursive: true }); }
  }
  writeFileSync(join(root, 'agents', 'research-worker.md'), [
    '---', 'id: research-worker', 'version: 1', 'role: work', 'runtime: claude', 'model: claude-sonnet-5',
    'default-profile: worker:claude:claude-sonnet-5', 'allowed-profiles: [worker:claude:claude-sonnet-5]',
    'runner-bound: true', 'projects: [kb-ops]', 'description: Checks research.', 'tools: [Read, Grep]',
    'knowledge-source: [docs/]', 'autonomy-tier: T2', 'skills: []', 'connectors: []', 'filesystem-roots: [kb-ops]',
    'what-it-replaces: null', 'builds-on: []', '---', '', '# Research worker', '', 'Follow the assigned workflow.', '',
  ].join('\n'), 'utf8');
  writeFileSync(join(root, 'agents', 'system-sweeper.md'), [
    '---', 'id: system-sweeper', 'version: 1', 'role: work', 'runtime: claude', 'model: claude-sonnet-5',
    'default-profile: worker:claude:claude-sonnet-5', 'allowed-profiles: [worker:claude:claude-sonnet-5]',
    'runner-bound: false', 'projects: []', 'group: system', 'description: Sweeps system state.', '---', '', '# System Sweeper', '',
  ].join('\n'), 'utf8');
  return root;
}

describe('Agent P2 routes', () => {
  let app: ReturnType<typeof Fastify>;
  let store: ControlPlaneStore;
  let root: string;
  let durableRoot: string;
  let token: string;

  beforeEach(async () => {
    root = fixture();
    durableRoot = fixture();
    token = mintSession('operator', SESSION).token;
    store = createInMemoryControlPlaneStore();
    app = Fastify();
    registerAgents(app, surfaceFor(runtimeCapabilities('linux')));
    await app.ready();
  });

  /** One surface builder so a test can mount the same routes over a different composed capability. */
  function surfaceFor(capabilities: ReturnType<typeof runtimeCapabilities>) {
    return makeSurfaceContext({
      repoRoot: root, durableRepoRoot: durableRoot, stateRoot: join(root, 'state'), controlStore: store, sessionConfig: SESSION,
      allowedOrigins: [ORIGIN], runtimeCapabilities: capabilities,
      runPreamble: () => ({ exitCode: 0, stdout: 'PREAMBLE OK', stderr: '' }),
      appendAudit: (_repo, event) => ({ ts: 'now', ...event }),
      appendAuditLocal: (_repo, event) => ({ ts: 'now', ...event }),
      opsGit: (_repo, args) => args.join(' ') === 'rev-parse --abbrev-ref HEAD' ? 'ops\n'
        : args.join(' ') === 'rev-parse HEAD' ? `${'a'.repeat(40)}\n` : '',
      saveGit: stagingGit(),
      openPr: async () => ({ url: 'https://example.test/pull/11', number: 11, owner: 'danielzhang04', repo: 'kb' }),
      runPy: (_repo, _code, jsonArg) => {
        const op = JSON.parse(jsonArg) as { runId: string; stages: Array<{ id: string }> };
        return { exitCode: 0, stdout: `${JSON.stringify({ runId: op.runId, cards: op.stages.map((stage) => ({ stageId: stage.id, cardId: workflowCardId(op.runId, stage.id), state: 'blocked', cardPath: `queue/inbox/${workflowCardId(op.runId, stage.id)}.md` })) })}\n`, stderr: '' };
      },
    });
  }
  afterEach(async () => { await app.close(); rmSync(root, { recursive: true, force: true }); rmSync(durableRoot, { recursive: true, force: true }); });

  it('serves grouped EntitySummary and EntityDetail envelopes with ETag replay', async () => {
    const listed = await app.inject({ method: 'GET', url: '/api/agents' });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toMatchObject({
      revision: expect.any(String),
      groups: [expect.objectContaining({ id: 'kb-ops', collapsed: false }), expect.objectContaining({ id: 'System', collapsed: true })],
      items: expect.arrayContaining([expect.objectContaining({ ref: { type: 'agent', id: 'research-worker', sourcePath: 'agents/research-worker.md' }, humanName: 'Research Worker' })]),
    });
    expect((await app.inject({ method: 'GET', url: '/api/agents', headers: { 'if-none-match': listed.headers.etag! } })).statusCode).toBe(304);
    const detail = await app.inject({ method: 'GET', url: '/api/agents/research-worker' });
    expect(detail.json()).toMatchObject({ revision: expect.any(String), summary: { ref: { type: 'agent', id: 'research-worker' } }, brief: { purpose: 'Checks research.', outputs: [] }, details: { sourcePath: 'agents/research-worker.md', sourceRevision: expect.stringMatching(/^[a-f0-9]{64}$/) } });
  });

  it('keeps a projectless agent in the Undeclared group without failing the roster', async () => {
    const projectless = readFileSync(join(root, 'agents', 'research-worker.md'), 'utf8')
      .replace('id: research-worker', 'id: projectless-agent')
      .replace('projects: [kb-ops]', 'projects: []');
    writeFileSync(join(root, 'agents', 'projectless-agent.md'), projectless, 'utf8');

    const listed = await app.inject({ method: 'GET', url: '/api/agents' });

    expect(listed.statusCode).toBe(200);
    expect(listed.json().groups).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'kb-ops', items: expect.arrayContaining([expect.objectContaining({ ref: expect.objectContaining({ id: 'research-worker' }) })]) }),
      expect.objectContaining({ id: 'undeclared', label: 'Undeclared', items: expect.arrayContaining([expect.objectContaining({ ref: expect.objectContaining({ id: 'projectless-agent' }) })]) }),
    ]));
  });

  it('projects an armed owned schedule into list, Brief, status, and ETag revision', async () => {
    let collectionRevision = 4;
    store.getScheduleSnapshot = () => ({ collectionRevision, schedules: [{
      id: 'schedule-agent', owner: { type: 'agent', id: 'research-worker', sourcePath: 'agents/research-worker.md' },
      cadence: { source: '0 9 * * *', words: 'Daily at 9:00 AM' }, nextAt: '2026-08-23T13:00:00.000Z',
      lastOutcome: null, armed: true, origin: 'operator', mirroredAt: null, mirrorPath: 'HEARTBEAT.md', version: 1,
    }] });
    const first = await app.inject({ method: 'GET', url: '/api/agents' });
    expect(first.json().items.find((item: { ref: { id: string } }) => item.ref.id === 'research-worker')).toMatchObject({
      status: 'scheduled', nextSchedule: { scheduleId: 'schedule-agent', nextAt: '2026-08-23T13:00:00.000Z' },
    });
    expect((await app.inject({ method: 'GET', url: '/api/agents/research-worker' })).json().brief.schedule).toMatchObject({ scheduleId: 'schedule-agent' });
    collectionRevision += 1;
    const changed = await app.inject({ method: 'GET', url: '/api/agents', headers: { 'if-none-match': first.headers.etag! } });
    expect(changed.statusCode).toBe(200);
    expect(changed.headers.etag).not.toBe(first.headers.etag);
  });

  it('rejects POST sourcePath and absolute path injection before the builder durable write', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/agents', headers: { origin: ORIGIN, host: 'localhost:5317', authorization: `Bearer ${token}` }, payload: { selector: { type: 'agent', id: 'new-agent' }, project: 'kb-ops', expectedCollectionRevision: 'x', idempotencyKey: 'create-1', humanName: 'New Agent', purpose: 'Draft.', model: 'claude-sonnet-5', profile: 'worker:claude:claude-sonnet-5', tools: [], skills: [], connectors: [], filesystemRoots: ['kb-ops'], sourcePath: '../../CLAUDE.md' } });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invalid-agent-create-body' });
  });

  it('rejects PUT path and PUT sourcePath injection before the builder durable write', async () => {
    const detail = (await app.inject({ method: 'GET', url: '/api/agents/research-worker' })).json();
    const base = { expectedSourceRevision: detail.details.sourceRevision, idempotencyKey: 'edit-1', humanName: 'Research Worker', purpose: 'Checks research.', model: 'claude-sonnet-5', profile: 'worker:claude:claude-sonnet-5', tools: ['Read'], skills: [], connectors: [], filesystemRoots: ['kb-ops'] };
    for (const injected of [{ path: 'C:/repo/agent.md' }, { sourcePath: '../../CLAUDE.md' }]) {
      const response = await app.inject({ method: 'PUT', url: '/api/agents/research-worker', headers: { origin: ORIGIN, host: 'localhost:5317', authorization: `Bearer ${token}` }, payload: { ...base, ...injected } });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'invalid-agent-update-body' });
    }
  });

  it('registers positive POST path and PUT path builder saves at server-derived declarations', async () => {
    const listed = (await app.inject({ method: 'GET', url: '/api/agents' })).json();
    const auth = { origin: ORIGIN, host: 'localhost:5317', authorization: `Bearer ${token}` };
    const values = { humanName: 'New Agent', purpose: 'Draft safely.', model: 'claude-sonnet-5', profile: 'worker:claude:claude-sonnet-5', tools: ['Read'], skills: [], connectors: [], filesystemRoots: ['kb-ops'] };
    const created = await app.inject({ method: 'POST', url: '/api/agents', headers: auth, payload: { ...values, selector: { type: 'agent', id: 'new-agent' }, project: 'kb-ops', expectedCollectionRevision: listed.revision, idempotencyKey: 'create-positive' } });
    expect(created.statusCode).toBe(202);
    expect(readFileSync(join(durableRoot, 'agents', 'new-agent.md'), 'utf8')).toContain('id: "new-agent"');
    expect(existsSync(join(root, 'agents', 'new-agent.md'))).toBe(false);

    const detail = (await app.inject({ method: 'GET', url: '/api/agents/system-sweeper' })).json();
    const updated = await app.inject({ method: 'PUT', url: '/api/agents/system-sweeper', headers: auth, payload: { ...values, humanName: 'System Sweeper', purpose: 'Updated purpose.', expectedSourceRevision: detail.details.sourceRevision, idempotencyKey: 'edit-positive' } });
    expect(updated.statusCode).toBe(202);
    expect(readFileSync(join(durableRoot, 'agents', 'system-sweeper.md'), 'utf8')).toContain('description: "Updated purpose."');
  });

  it('resolves positive agent launch identity and source CAS before creating a Run', async () => {
    // P6 W6.2 [P6-C55]: the launch host now comes from a live placement decision — the seeded
    // advertisement must cover research-worker's own declared capability (`filesystem-roots: [kb-ops]`,
    // `runtime: claude`), which `computeCapabilityRequirement` now turns into a real match requirement.
    store.seedHostAdvertisementForTest({
      hostId: 'vm', daemonVersion: '1.0.0', reportedAt: new Date().toISOString(),
      connectors: [], skills: [], filesystemRoots: ['kb-ops'], pty: true, gpu: true,
      clis: { claude: 'ready', codex: 'ready' }, version: 1,
    });
    const detail = (await app.inject({ method: 'GET', url: '/api/agents/research-worker' })).json();
    const headers = { origin: ORIGIN, host: 'localhost:5317', authorization: `Bearer ${token}` };
    const stale = await app.inject({ method: 'POST', url: '/api/agents/research-worker/launch', headers, payload: { expectedSourceRevision: '0'.repeat(64), idempotencyKey: 'launch-1' } });
    expect(stale.statusCode).toBe(409);
    expect(store.listRuns('operator', 'all-subjects')).toEqual([]);
    const launched = await app.inject({ method: 'POST', url: '/api/agents/research-worker/launch', headers, payload: { expectedSourceRevision: detail.details.sourceRevision, idempotencyKey: 'launch-2' } });
    expect(launched.statusCode).toBe(202);
    expect(launched.json()).toMatchObject({ runRef: expect.any(String) });
    expect(store.listRuns('operator', 'all-subjects')).toHaveLength(1);
    expect(store.listRuns('operator', 'all-subjects')[0]).toMatchObject({
      owner: { type: 'agent', id: 'research-worker', sourcePath: 'agents/research-worker.md' },
      executionHost: 'vm',
    });
  });

  it('stores and previews the executionHost the composed capability advertises, on both platforms', async () => {
    const headers = { origin: ORIGIN, host: 'localhost:5317', authorization: `Bearer ${token}` };
    const detail = (await app.inject({ method: 'GET', url: '/api/agents/research-worker' })).json();
    // The never-run PREVIEW row still falls back to the composed capability's own self-identity
    // (`runtimeExecutionHost`, unchanged by P6) when nothing has run yet — that is what a re-derived
    // `process.platform` on this Windows box would get wrong.
    expect(JSON.stringify((await app.inject({ method: 'GET', url: '/api/agents' })).json())).toContain('"host":"vm"');
    // P6 W6.2 [P6-C55]: the ACTUAL launch host now comes from a live placement decision, so the fixture
    // advertises the host under test with research-worker's own declared capability satisfied.
    store.seedHostAdvertisementForTest({
      hostId: 'vm', daemonVersion: '1.0.0', reportedAt: new Date().toISOString(),
      connectors: [], skills: [], filesystemRoots: ['kb-ops'], pty: true, gpu: true,
      clis: { claude: 'ready', codex: 'ready' }, version: 1,
    });
    expect((await app.inject({
      method: 'POST', url: '/api/agents/research-worker/launch', headers,
      payload: { expectedSourceRevision: detail.details.sourceRevision, idempotencyKey: 'host-refused' },
    })).statusCode).toBe(202);
    expect(store.listRuns('operator', 'all-subjects')[0]?.executionHost).toBe('vm');

    store = createInMemoryControlPlaneStore({ initialHostAdvertisements: [] });
    store.seedHostAdvertisementForTest({
      hostId: 'desktop', daemonVersion: '1.0.0', reportedAt: new Date().toISOString(),
      connectors: [], skills: [], filesystemRoots: ['kb-ops'], pty: true, gpu: true,
      clis: { claude: 'ready', codex: 'ready' }, version: 1,
    });
    const desktop = Fastify();
    registerAgents(desktop, surfaceFor(runtimeCapabilities('win32', {
      pty: true, host: 'desktop', launchers: ['shell'], roots: ['repo'], checkedAt: '2026-08-22T09:00:00.000Z',
    })));
    await desktop.ready();
    expect(JSON.stringify((await desktop.inject({ method: 'GET', url: '/api/agents' })).json())).toContain('"host":"desktop"');
    expect((await desktop.inject({
      method: 'POST', url: '/api/agents/research-worker/launch', headers,
      payload: { expectedSourceRevision: detail.details.sourceRevision, idempotencyKey: 'host-advertised' },
    })).statusCode).toBe(202);
    expect(store.listRuns('operator', 'all-subjects')[0]?.executionHost).toBe('desktop');
    await desktop.close();
  });
});
