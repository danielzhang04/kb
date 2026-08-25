import Fastify from 'fastify';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mintSession, type SessionConfig } from '../auth/session.ts';
import type { AuditEvent } from '../audit/log.ts';
import { createInMemoryControlPlaneStore, type ControlPlaneStore } from '../control/store.ts';
import { makeSurfaceContext } from '../http/surface.ts';
import { runtimeCapabilities } from '../runtime/capabilities.ts';
import { workflowCardId } from '../write/workflowRun.ts';
import { createFileAssignmentAmendmentStore } from './amendmentStore.ts';
import { registerWorkflows, scanWorkflowDefs, createWorkflowLaunchServicePort } from './routes.ts';
import { registerV1OperatorMutationRoutes } from '../api/v1/routes.ts';
import { originPlugin } from '../security/origin.ts';
import { requireSession } from '../http/middleware.ts';
import { normalizedTextSha256 } from '../control/textArtifactHash.ts';
import { registerAgents } from '../agents/routes.ts';
import { projectRunAttention } from '../control/attention.ts';

const SESSION: SessionConfig = { secret: Buffer.from('workflow-route-test-secret-32byte!'), ttlMs: 60_000 };
const ORIGIN = 'http://localhost:5317';
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

function headers(token: string): Record<string, string> {
  return { origin: ORIGIN, host: 'localhost:5317', authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

const definitionText = (): string => [
  '---', 'id: amendable', 'project: kb-ops', 'title: Assigned research', 'profile: research',
  'manager:', '  agentId: assigned-manager', '  profileId: manager:claude:claude-opus-5',
  'stages:', '  - id: brief', '    title: Research a topic', '    action: research:web-brief',
  '    target: orgs/kb-ops/output', '    workOrder: research it', '    agentId: assigned-worker', '    profileId: worker:claude:claude-sonnet-5',
  '    artifacts:', '      - id: brief-file', '        path: orgs/kb-ops/output/brief.md', '        description: Cited brief',
  '---', 'body', '',
].join('\n');

function buildRoots(): { activeRoot: string; durableRoot: string } {
  const activeRoot = mkdtempSync(join(tmpdir(), 'workflow-p2-active-'));
  const durableRoot = mkdtempSync(join(tmpdir(), 'workflow-p2-durable-'));
  for (const root of [activeRoot, durableRoot]) {
    for (const rel of ['governance', 'CLAUDE.md', join('orgs', 'kb-ops', 'contract.md')]) {
      const from = join(REPO_ROOT, rel);
      if (existsSync(from)) { mkdirSync(join(root, rel, '..'), { recursive: true }); cpSync(from, join(root, rel), { recursive: true }); }
    }
    const agents = join(root, 'agents'); mkdirSync(agents, { recursive: true });
    writeFileSync(join(agents, 'assigned-manager.md'), ['---', 'id: assigned-manager', 'runtime: claude', 'model: claude-opus-5', 'default-profile: manager:claude:claude-opus-5', 'allowed-profiles: [manager:claude:claude-opus-5]', 'projects: [kb-ops]', 'runner-bound: true', 'role: manager', '---', 'Manager.'].join('\n'));
    writeFileSync(join(agents, 'assigned-worker.md'), ['---', 'id: assigned-worker', 'runtime: claude', 'model: claude-sonnet-5', 'default-profile: worker:claude:claude-sonnet-5', 'allowed-profiles: [worker:claude:claude-sonnet-5]', 'projects: [kb-ops]', 'runner-bound: true', 'role: worker', '---', 'Worker.'].join('\n'));
    const workflows = join(root, 'orgs', 'kb-ops', 'workflows'); mkdirSync(workflows, { recursive: true });
    writeFileSync(join(workflows, 'amendable.md'), definitionText());
  }
  return { activeRoot, durableRoot };
}

describe('Workflow P2 routes', () => {
  let activeRoot: string;
  let durableRoot: string;
  let app: ReturnType<typeof Fastify>;
  let token: string;
  let store: ControlPlaneStore;
  let gitCalls: string[][];
  let stagedPaths: string[];
  let auditRows: AuditEvent[];
  let surface: ReturnType<typeof makeSurfaceContext>;
  let admissionDegraded: boolean;
  let prFailure: boolean;
  let prCalls: number;
  let auditFailure: boolean;
  let automaticRunRefs: string[];

  async function setup(options: { activated?: boolean } = {}): Promise<void> {
    ({ activeRoot, durableRoot } = buildRoots());
    token = mintSession('operator', SESSION).token;
    store = createInMemoryControlPlaneStore();
    gitCalls = [];
    stagedPaths = [];
    auditRows = [];
    admissionDegraded = false;
    prFailure = false;
    prCalls = 0;
    auditFailure = false;
    automaticRunRefs = [];
    app = Fastify();
    surface = makeSurfaceContext({
      repoRoot: activeRoot, durableRepoRoot: durableRoot, stateRoot: join(activeRoot, 'state'), controlStore: store,
      sessionConfig: SESSION, allowedOrigins: [ORIGIN], runtimeCapabilities: runtimeCapabilities('linux'),
      definitionAmendmentStore: createFileAssignmentAmendmentStore(join(activeRoot, 'state')),
      admission: () => admissionDegraded ? { ok: false, status: 503, reason: 'outbox-degraded' } : { ok: true },
      runPreamble: () => ({ exitCode: 0, stdout: 'PREAMBLE OK', stderr: '' }),
      appendAudit: (_root, event) => { if (auditFailure) throw new Error('audit unavailable'); auditRows.push(event); return { ts: 'now', ...event }; },
      appendAuditLocal: (_root, event) => { if (auditFailure) throw new Error('audit unavailable'); auditRows.push(event); return { ts: 'now', ...event }; },
      opsGit: async (_root, args) => args.join(' ') === 'rev-parse --abbrev-ref HEAD' ? 'ops\n'
        : args.join(' ') === 'rev-parse HEAD' ? `${'a'.repeat(40)}\n` : '',
      // P4 W2 contract change: the one durable publisher consumes a manifest and PROVES its exact
      // cached set before creating history, so the fake replays the paths it saw staged.
      saveGit: async (_root, args) => {
        gitCalls.push(args);
        const joined = args.join(' ');
        if (joined === 'rev-parse --abbrev-ref HEAD') return 'claude/m1-dashboard\n';
        // `resolveBaseCommit` now REFUSES a non-sha HEAD rather than downgrading to the unpinned
        // sentinel, so the fake answers with a real base the publisher can pin against.
        if (joined === 'rev-parse HEAD') return `${'c'.repeat(40)}\n`;
        if (args[0] === 'add' && args[1] === '--') stagedPaths.push(...args.slice(2));
        if (joined === 'diff --cached --name-status -z') return stagedPaths.map((path) => `M\0${path}\0`).join('');
        if (args[0] === 'ls-files') return stagedPaths.map((path) => `100644 ${'b'.repeat(40)} 0\t${path}\0`).join('');
        if (args[0] === 'commit' || args[0] === 'reset') stagedPaths.length = 0;
        return '';
      },
      openPr: async () => { prCalls += 1; if (prFailure) throw new Error('PR unavailable'); return { url: 'https://example.test/pull/9', number: 9, owner: 'danielzhang04', repo: 'kb' }; },
      runPy: (_root, _code, jsonArg) => {
        const op = JSON.parse(jsonArg) as { runId: string; stages?: Array<{ id: string }>; cardRefs?: string[] };
        if (op.cardRefs) return { exitCode: 0, stdout: `${JSON.stringify({ cards: op.cardRefs.map((cardRef) => ({ cardRef, path: `queue/inbox/${cardRef}.md`, completed: false, changed: false })) })}\n`, stderr: '' };
        const cards = (op.stages ?? []).map((stage) => ({ stageId: stage.id, cardId: workflowCardId(op.runId, stage.id), state: 'blocked', cardPath: `queue/inbox/${workflowCardId(op.runId, stage.id)}.md` }));
        if (options.activated) {
          mkdirSync(join(activeRoot, 'queue', 'inbox'), { recursive: true });
          for (const card of cards) writeFileSync(join(activeRoot, card.cardPath), '', 'utf8');
        }
        return { exitCode: 0, stdout: `${JSON.stringify({ runId: op.runId, cards })}\n`, stderr: '' };
      },
      ...(options.activated ? {
        attemptPort: { isRunLive: () => true, drain: async () => {} } as never,
        runAutomatic: (async ({ runRef }: { runRef: string }) => { automaticRunRefs.push(runRef); return { ok: true }; }) as never,
      } : {}),
    });
    registerAgents(app, surface);
    registerWorkflows(app, surface);
    await app.ready();
  }

  beforeEach(setup);
  afterEach(async () => {
    if (app) await app.close();
    if (activeRoot) rmSync(activeRoot, { recursive: true, force: true });
    if (durableRoot) rmSync(durableRoot, { recursive: true, force: true });
  });

  async function sourceRevision(): Promise<string> {
    return (await app.inject({ method: 'GET', url: '/api/workflows/amendable' })).json().details.sourceRevision as string;
  }

  it('serves grouped EntitySummary and EntityDetail envelopes with a serializable step DAG and ETag', async () => {
    const listed = await app.inject({ method: 'GET', url: '/api/workflows' });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toMatchObject({ revision: expect.any(String), groups: [{ id: 'kb-ops', collapsed: false }], items: [{ ref: { type: 'workflow', id: 'amendable', project: 'kb-ops', sourcePath: 'orgs/kb-ops/workflows/amendable.md' }, humanName: 'Amendable', modelLabel: 'varies' }] });
    expect((await app.inject({ method: 'GET', url: '/api/workflows', headers: { 'if-none-match': listed.headers.etag! } })).statusCode).toBe(304);
    const detail = await app.inject({ method: 'GET', url: '/api/workflows/amendable' });
    expect(detail.json()).toMatchObject({ revision: expect.any(String), summary: { ref: { id: 'amendable' } }, brief: { outputs: [{ kind: 'artifact', label: 'Cited brief', path: 'orgs/kb-ops/output/brief.md' }] }, details: { sourceRevision: expect.stringMatching(/^[a-f0-9]{64}$/), workflow: { stepDag: { nodes: [{ stageRef: 'brief', label: 'Research a topic' }], edges: [] }, parameters: [] } } });
    expect(JSON.stringify(detail.json())).not.toContain('eventsFor');
  });

  it('keeps Agent and Workflow gate counts byte-parallel with the shared attention projector', async () => {
    const agentOwner = { type: 'agent' as const, id: 'assigned-worker', sourcePath: 'agents/assigned-worker.md' as const };
    const workflowOwner = { type: 'workflow' as const, id: 'amendable', project: 'kb-ops', sourcePath: 'orgs/kb-ops/workflows/amendable.md' as const };
    const runs = [
      { runRef: 'run-agent', owner: agentOwner, ownerSubject: 'agent-owner', executionHost: 'desktop', title: 'Agent run', lifecycle: { kind: 'running', deployPause: null }, createdAt: '2026-08-21T10:00:00.000Z', updatedAt: '2026-08-21T12:00:00.000Z', completedAt: null, terminalOutcome: null, archivedFrom: null, openHumanRequestCount: 1 },
      { runRef: 'run-workflow', owner: workflowOwner, ownerSubject: 'workflow-owner', executionHost: 'vm', title: 'Workflow run', lifecycle: { kind: 'running', deployPause: null }, createdAt: '2026-08-21T11:00:00.000Z', updatedAt: '2026-08-21T13:00:00.000Z', completedAt: null, terminalOutcome: null, archivedFrom: null, openHumanRequestCount: 1 },
    ] as unknown as ReturnType<ControlPlaneStore['listRuns']>;
    const resolved = runs.map((run) => ({ requestRef: `request-${run.runRef}`, runRef: run.runRef, state: 'resolved' as const }));
    store.listRuns = () => runs;
    store.getRun = (_subject, runRef) => ({
      ok: true,
      value: { humanRequests: resolved.filter((request) => request.runRef === runRef) },
    } as never);

    const projected = projectRunAttention({
      runs: runs.map((run) => ({ runRef: run.runRef, owner: run.owner, lifecycle: run.lifecycle.kind })),
      humanRequests: resolved,
    });
    const agentSummary = (await app.inject({ method: 'GET', url: '/api/agents' })).json().items
      .find((item: { ref: { id: string } }) => item.ref.id === agentOwner.id);
    const workflowSummary = (await app.inject({ method: 'GET', url: '/api/workflows' })).json().items[0];

    expect([agentSummary.gatedRunCount, workflowSummary.gatedRunCount]).toEqual([
      projected.agents[agentOwner.id] ?? 0,
      projected.workflows[`workflow:${workflowOwner.project}:${workflowOwner.id}`] ?? 0,
    ]);
    expect(agentSummary.gatedRunCount).toBe(0);
    expect(workflowSummary.gatedRunCount).toBe(0);
  });

  it('projects an armed immutable Workflow schedule into status, Brief, and ETag revision', async () => {
    let collectionRevision = 4;
    store.getScheduleSnapshot = () => ({ collectionRevision, schedules: [{
      id: 'schedule-workflow', owner: { type: 'workflow', id: 'amendable', project: 'kb-ops', sourcePath: 'orgs/kb-ops/workflows/amendable.md' },
      cadence: { source: '0 10 * * *', words: 'Daily at 10:00 AM' }, nextAt: '2026-08-23T14:00:00.000Z', lastOutcome: null,
      armed: true, origin: 'operator', mirroredAt: null, mirrorPath: 'HEARTBEAT.md', version: 1,
    }] });
    const first = await app.inject({ method: 'GET', url: '/api/workflows' });
    expect(first.json().items[0]).toMatchObject({ status: 'scheduled', nextSchedule: { scheduleId: 'schedule-workflow', nextAt: '2026-08-23T14:00:00.000Z' } });
    expect((await app.inject({ method: 'GET', url: '/api/workflows/amendable' })).json().brief.schedule).toMatchObject({ scheduleId: 'schedule-workflow' });
    collectionRevision += 1;
    const changed = await app.inject({ method: 'GET', url: '/api/workflows' });
    expect(changed.headers.etag).not.toBe(first.headers.etag);
  });

  it('performs a positive workflow launch through the canonical Run transaction and refuses stale source before Run creation', async () => {
    const stale = await app.inject({ method: 'POST', url: '/api/workflows/amendable/launch', headers: headers(token), payload: { idempotencyKey: 'stale', expectedSourceRevision: '0'.repeat(64), parameters: {} } });
    expect(stale.statusCode).toBe(409);
    expect(store.listRuns('operator', 'all-subjects')).toEqual([]);
    const launched = await app.inject({ method: 'POST', url: '/api/workflows/amendable/launch', headers: headers(token), payload: { idempotencyKey: 'launch-1', expectedSourceRevision: await sourceRevision(), parameters: {} } });
    expect(launched.statusCode).toBe(202);
    expect(launched.json()).toMatchObject({ runRef: expect.any(String) });
    expect(store.listRuns('operator', 'all-subjects')).toHaveLength(1);
    expect(store.listRuns('operator', 'all-subjects')[0]).toMatchObject({ executionHost: expect.stringMatching(/^(desktop|vm)$/) });
    const detail = (await app.inject({ method: 'GET', url: '/api/workflows/amendable' })).json();
    expect(detail.details.workflow.runGraph).toMatchObject({
      runRef: launched.json().runRef,
      stages: [{ stageId: 'brief', stageRef: expect.stringMatching(/^stage-/), state: expect.any(String) }],
      attempts: expect.any(Array), events: expect.any(Array),
    });
    expect(detail.details.workflow.stepDag.nodes[0].stageRef).toMatch(/^stage-/);
  });

  it('keeps Workflow ownership immutable when composer provenance is supplied and rejects owner or host body fields', async () => {
    const source = readFileSync(join(activeRoot, 'agents', 'assigned-manager.md'));
    const workspace = surface.composerStore.create('operator', 'Compose amendable', {
      id: 'assigned-manager', path: 'agents/assigned-manager.md', sourceHash: normalizedTextSha256(source),
      projects: ['kb-ops'], instructionMarkdown: 'Manager.',
    });
    const revision = await sourceRevision();
    for (const injected of [{ owner: 'assigned-manager' }, { host: 'desktop' }]) {
      expect((await app.inject({ method: 'POST', url: '/api/workflows/amendable/launch', headers: headers(token), payload: { idempotencyKey: `forbidden-${Object.keys(injected)[0]}`, expectedSourceRevision: revision, parameters: {}, ...injected } })).statusCode).toBe(400);
    }
    const launched = await app.inject({ method: 'POST', url: '/api/workflows/amendable/launch', headers: headers(token), payload: { idempotencyKey: 'composer-provenance', expectedSourceRevision: revision, parameters: {}, composerRef: workspace.composerRef } });
    expect(launched.statusCode).toBe(202);
    const stored = store.getRun('operator', launched.json().runRef, 'all-subjects');
    expect(stored).toMatchObject({ ok: true, value: { run: {
      owner: { type: 'workflow', id: 'amendable', project: 'kb-ops', sourcePath: 'orgs/kb-ops/workflows/amendable.md' },
      agentWorkspaceLaunch: { composerRef: workspace.composerRef, agentId: 'assigned-manager' },
    } } });
  });

  it('retains launch authentication, origin, idempotency, and exact replay boundaries', async () => {
    const revision = await sourceRevision();
    const payload = { idempotencyKey: 'launch-replay', expectedSourceRevision: revision, parameters: {} };
    expect((await app.inject({ method: 'POST', url: '/api/workflows/amendable/launch', headers: { origin: ORIGIN, host: 'localhost:5317' }, payload })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/workflows/amendable/launch', headers: { ...headers(token), origin: 'https://evil.example' }, payload })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/workflows/amendable/launch', headers: headers(token), payload: { expectedSourceRevision: revision, parameters: {} } })).statusCode).toBe(400);
    const first = await app.inject({ method: 'POST', url: '/api/workflows/amendable/launch', headers: headers(token), payload });
    const replay = await app.inject({ method: 'POST', url: '/api/workflows/amendable/launch', headers: headers(token), payload });
    expect(first.statusCode).toBe(202);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ runRef: first.json().runRef });
    expect(store.listRuns('operator', 'all-subjects')).toHaveLength(1);
  });

  it('refuses outbox-degraded launches and definition edits before run, git, or audit effects', async () => {
    const revision = await sourceRevision();
    admissionDegraded = true;
    const launch = await app.inject({ method: 'POST', url: '/api/workflows/amendable/launch', headers: headers(token), payload: { idempotencyKey: 'degraded-launch', expectedSourceRevision: revision, parameters: {} } });
    const edit = await app.inject({ method: 'PUT', url: '/api/workflows/amendable', headers: headers(token), payload: { kind: 'assignment', idempotencyKey: 'degraded-edit', expectedSourceRevision: revision, target: { kind: 'stage', stageId: 'brief' }, assignment: null } });
    expect(launch.statusCode).toBe(503);
    expect(edit.statusCode).toBe(503);
    expect(launch.json()).toEqual({ error: 'outbox-degraded' });
    expect(store.listRuns('operator', 'all-subjects')).toEqual([]);
    expect(gitCalls).toEqual([]);
    expect(auditRows).toEqual([]);
  });

  it('records canonical launch audit actions with the policy snapshot', async () => {
    const launched = await app.inject({ method: 'POST', url: '/api/workflows/amendable/launch', headers: headers(token), payload: { idempotencyKey: 'audit-policy', expectedSourceRevision: await sourceRevision(), parameters: {} } });
    expect(launched.statusCode).toBe(202);
    const decision = auditRows.find((row) => row.action === 'control-proposal-decision-authorize');
    const launch = auditRows.find((row) => row.action === 'control-run-launch');
    expect(decision?.detail).toMatchObject({ source: 'workflow:amendable' });
    expect(launch?.detail).toMatchObject({ source: 'workflow:amendable', policyBaseCommit: expect.any(String), policyHashes: [{ stageId: 'brief', policyHash: expect.stringMatching(/^[a-f0-9]{64}$/) }] });
    expect(auditRows.some((row) => row.action.startsWith('workflow-launch'))).toBe(false);
  });

  it('keeps parser-valid but compiler-refused assignments unlaunchable', async () => {
    const workerPath = join(activeRoot, 'agents', 'assigned-worker.md');
    writeFileSync(workerPath, readFileSync(workerPath, 'utf8').replace('runner-bound: true', 'runner-bound: false'));
    const response = await app.inject({ method: 'POST', url: '/api/workflows/amendable/launch', headers: headers(token), payload: { idempotencyKey: 'unbound', expectedSourceRevision: await sourceRevision(), parameters: {} } });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'assigned-agent-not-runner-bound', detail: expect.stringContaining('assigned-worker') });
    expect(store.listRuns('operator', 'all-subjects')).toEqual([]);
  });

  it('stalls T3 at its human gate without publishing canonical cards', async () => {
    const path = join(activeRoot, 'orgs', 'kb-ops', 'workflows', 'amendable.md');
    writeFileSync(path, readFileSync(path, 'utf8').replace('action: research:web-brief', 'action: release:cut'));
    const response = await app.inject({ method: 'POST', url: '/api/workflows/amendable/launch', headers: headers(token), payload: { idempotencyKey: 't3-gate', expectedSourceRevision: await sourceRevision(), parameters: {} } });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ waitingHuman: true });
    expect(response.json()).not.toHaveProperty('cards');
    const run = store.getRun('operator', response.json().runRef, 'all-subjects');
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.value.run).toMatchObject({ publicationState: 'waiting-human', lifecycle: { kind: 'waiting-human' } });
    expect(run.value.stages.every((stage) => stage.canonicalCardRef === null)).toBe(true);
  });

  it('hands an activated one-step launch to runAutomatic exactly once', async () => {
    await app.close();
    rmSync(activeRoot, { recursive: true, force: true });
    rmSync(durableRoot, { recursive: true, force: true });
    await setup({ activated: true });
    const response = await app.inject({ method: 'POST', url: '/api/workflows/amendable/launch', headers: headers(token), payload: { idempotencyKey: 'activated', expectedSourceRevision: await sourceRevision(), parameters: {} } });
    expect(response.statusCode).toBe(201);
    expect(automaticRunRefs).toEqual([response.json().runRef]);
  });

  it('preserves assignment amendment source CAS and exact pending replay through generalized PUT', async () => {
    const body = { kind: 'assignment', idempotencyKey: 'assignment-1', expectedSourceRevision: await sourceRevision(), target: { kind: 'stage', stageId: 'brief' }, assignment: null };
    expect((await app.inject({ method: 'PUT', url: '/api/workflows/amendable', headers: headers(token), payload: { ...body, idempotencyKey: undefined } })).statusCode).toBe(400);
    const stale = await app.inject({ method: 'PUT', url: '/api/workflows/amendable', headers: headers(token), payload: { ...body, expectedSourceRevision: '0'.repeat(64) } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ error: 'stale-source-revision', sourceRevision: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(gitCalls).toEqual([]);
    const first = await app.inject({ method: 'PUT', url: '/api/workflows/amendable', headers: headers(token), payload: body });
    expect(first.statusCode).toBe(202);
    expect(first.json()).toMatchObject({ status: 'pending-human-merge', replayed: false, pr: { url: 'https://example.test/pull/9' } });
    expect(readFileSync(join(activeRoot, 'orgs', 'kb-ops', 'workflows', 'amendable.md'), 'utf8')).toBe(definitionText());
    expect(readFileSync(join(durableRoot, 'orgs', 'kb-ops', 'workflows', 'amendable.md'), 'utf8')).not.toContain('agentId: assigned-worker');
    const replay = await app.inject({ method: 'PUT', url: '/api/workflows/amendable', headers: headers(token), payload: body });
    expect(replay.statusCode).toBe(202);
    expect(replay.json()).toMatchObject({ replayed: true, proposedSourceHash: first.json().proposedSourceHash });
    const changed = await app.inject({ method: 'PUT', url: '/api/workflows/amendable', headers: headers(token), payload: { ...body, target: { kind: 'manager' } } });
    expect(changed.statusCode).toBe(409);
    expect(changed.json()).toMatchObject({ error: 'assignment-amendment-pending' });
    expect(gitCalls.filter((call) => call[0] === 'add')).toHaveLength(1);
  });

  it('preserves governance amendments through generalized PUT and removes both specialized routes', async () => {
    const response = await app.inject({ method: 'PUT', url: '/api/workflows/amendable', headers: headers(token), payload: { kind: 'governance', idempotencyKey: 'governance-1', expectedSourceRevision: await sourceRevision(), governance: { workflow: 'assigned-manager', stages: { brief: 'assigned-worker' } } } });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ status: 'pending-human-merge', governance: { workflow: 'assigned-manager', stages: { brief: 'assigned-worker' } } });
    expect(auditRows.some((row) => row.action === 'workflow-governance-amendment')).toBe(true);
    expect((await app.inject({ method: 'POST', url: '/api/workflows/amendable/assignment-amendments', headers: headers(token), payload: {} })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/workflows/amendable/governance-amendments', headers: headers(token), payload: {} })).statusCode).toBe(404);
  });

  it('reports audit failure truthfully while keeping the durable edit launch-blocking', async () => {
    auditFailure = true;
    const revision = await sourceRevision();
    const response = await app.inject({ method: 'PUT', url: '/api/workflows/amendable', headers: headers(token), payload: { kind: 'governance', idempotencyKey: 'audit-failure', expectedSourceRevision: revision, governance: { workflow: 'assigned-manager', stages: { brief: 'assigned-worker' } } } });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ status: 'pending-human-merge', auditStatus: 'failed', error: 'governance-amendment-audit-required' });
    const launch = await app.inject({ method: 'POST', url: '/api/workflows/amendable/launch', headers: headers(token), payload: { idempotencyKey: 'after-audit-failure', expectedSourceRevision: revision, parameters: {} } });
    expect(launch.statusCode).toBe(409);
    expect(launch.json()).toMatchObject({ error: 'assignment-amendment-pending' });
  });

  it('persists post-commit PR failure and refuses launch after an app restart', async () => {
    prFailure = true;
    const revision = await sourceRevision();
    const response = await app.inject({ method: 'PUT', url: '/api/workflows/amendable', headers: headers(token), payload: { kind: 'assignment', idempotencyKey: 'pr-failure', expectedSourceRevision: revision, target: { kind: 'stage', stageId: 'brief' }, assignment: null } });
    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({ error: 'assignment-durable-route-incomplete', status: 'recovery-required', committed: true, pushed: true });
    expect(readFileSync(join(durableRoot, 'orgs', 'kb-ops', 'workflows', 'amendable.md'), 'utf8')).not.toContain('agentId: assigned-worker');
    await app.close();
    app = Fastify();
    surface = { ...surface, definitionAmendmentStore: createFileAssignmentAmendmentStore(join(activeRoot, 'state')) };
    registerWorkflows(app, surface);
    await app.ready();
    const launch = await app.inject({ method: 'POST', url: '/api/workflows/amendable/launch', headers: headers(token), payload: { idempotencyKey: 'restarted', expectedSourceRevision: revision, parameters: {} } });
    expect(launch.statusCode).toBe(409);
    expect(launch.json()).toMatchObject({ error: 'assignment-amendment-pending' });
  });

  it('proves launch refusal while a durable edit is pending and creates no Run', async () => {
    const revision = await sourceRevision();
    await app.inject({ method: 'PUT', url: '/api/workflows/amendable', headers: headers(token), payload: { kind: 'assignment', idempotencyKey: 'pending-edit', expectedSourceRevision: revision, target: { kind: 'stage', stageId: 'brief' }, assignment: null } });
    const launch = await app.inject({ method: 'POST', url: '/api/workflows/amendable/launch', headers: headers(token), payload: { idempotencyKey: 'blocked', expectedSourceRevision: revision, parameters: {} } });
    expect(launch.statusCode).toBe(409);
    expect(launch.json()).toMatchObject({ error: 'assignment-amendment-pending' });
    expect(store.listRuns('operator', 'all-subjects')).toEqual([]);
  });

  it('rejects POST path and POST sourcePath plus owner/host fields before any durable write', async () => {
    const list = (await app.inject({ method: 'GET', url: '/api/workflows' })).json();
    const response = await app.inject({ method: 'POST', url: '/api/workflows', headers: headers(token), payload: { selector: { type: 'workflow', id: 'new-flow' }, project: 'kb-ops', expectedCollectionRevision: list.revision, idempotencyKey: 'create-1', humanName: 'New Flow', purpose: 'Draft safely.', model: 'claude-sonnet-5', profile: 'research', tools: [], skills: [], connectors: [], filesystemRoots: ['kb-ops'], sourcePath: '../../CLAUDE.md', owner: 'operator', host: 'desktop' } });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invalid-workflow-create-body' });
    expect(gitCalls).toEqual([]);
  });

  it('rejects PUT path and PUT sourcePath fields before any durable write', async () => {
    const detail = (await app.inject({ method: 'GET', url: '/api/workflows/amendable' })).json();
    const base = { expectedSourceRevision: detail.details.sourceRevision, idempotencyKey: 'edit-1', humanName: 'Amendable', purpose: 'Draft safely.', model: 'claude-sonnet-5', profile: 'research', tools: [], skills: [], connectors: [], filesystemRoots: ['kb-ops'] };
    for (const injected of [{ path: 'C:/repo/workflow.md' }, { sourcePath: '../../CLAUDE.md' }]) {
      const response = await app.inject({ method: 'PUT', url: '/api/workflows/amendable', headers: headers(token), payload: { ...base, ...injected } });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'invalid-workflow-update-body' });
    }
    expect(gitCalls).toEqual([]);
  });

  it('registers positive POST path and PUT path builder saves at server-derived workflow declarations', async () => {
    const listed = (await app.inject({ method: 'GET', url: '/api/workflows' })).json();
    const values = { humanName: 'New Flow', purpose: 'Draft safely.', model: 'claude-sonnet-5', profile: 'research', tools: [], skills: [], connectors: [], filesystemRoots: ['kb-ops'] };
    const createPayload = { ...values, selector: { type: 'workflow', id: 'new-flow' }, project: 'kb-ops', expectedCollectionRevision: listed.revision, idempotencyKey: 'create-positive' };
    const created = await app.inject({ method: 'POST', url: '/api/workflows', headers: headers(token), payload: createPayload });
    expect(created.statusCode).toBe(202);
    expect((await app.inject({ method: 'POST', url: '/api/workflows', headers: headers(token), payload: createPayload })).json()).toMatchObject({ operationId: 'create-positive', replayed: true });
    const conflict = await app.inject({ method: 'POST', url: '/api/workflows', headers: headers(token), payload: { ...createPayload, purpose: 'Conflicting body.' } });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toEqual({ error: 'idempotency-body-conflict' });
    expect(gitCalls.filter((call) => call[0] === 'add')).toHaveLength(1);
    expect(prCalls).toBe(1);
    expect(auditRows.filter((row) => row.action === 'entity-builder-amend')).toHaveLength(1);
    expect(readFileSync(join(durableRoot, 'orgs', 'kb-ops', 'workflows', 'new-flow.md'), 'utf8')).toContain('id: "new-flow"');
    expect(existsSync(join(activeRoot, 'orgs', 'kb-ops', 'workflows', 'new-flow.md'))).toBe(false);

    const detail = (await app.inject({ method: 'GET', url: '/api/workflows/amendable' })).json();
    const updated = await app.inject({ method: 'PUT', url: '/api/workflows/amendable', headers: headers(token), payload: { ...values, humanName: 'Renamed Flow', expectedSourceRevision: detail.details.sourceRevision, idempotencyKey: 'edit-positive' } });
    expect(updated.statusCode).toBe(202);
    expect(readFileSync(join(durableRoot, 'orgs', 'kb-ops', 'workflows', 'amendable.md'), 'utf8')).toContain('title: "Renamed Flow"');
  });

  it('fails closed on duplicate workflow ids instead of selecting one path', async () => {
    const other = join(activeRoot, 'orgs', 'other', 'workflows'); mkdirSync(other, { recursive: true });
    writeFileSync(join(other, 'same.md'), definitionText().replace('project: kb-ops', 'project: other'));
    const duplicate = join(activeRoot, 'orgs', 'kb-ops', 'workflows', 'same.md'); writeFileSync(duplicate, definitionText());
    const duplicates = scanWorkflowDefs(activeRoot).filter((entry) => entry.entry.ref.includes('amendable'));
    expect(duplicates).toHaveLength(2);
    expect(duplicates.every((entry) => !entry.entry.valid && entry.def === null)).toBe(true);
    expect((await app.inject({ method: 'GET', url: '/api/workflows/amendable' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/workflows/amendable/launch', headers: headers(token), payload: { idempotencyKey: 'duplicate', expectedSourceRevision: 'a'.repeat(64), parameters: {} } })).statusCode).toBe(404);
    expect(store.listRuns('operator', 'all-subjects')).toEqual([]);
  });

  it('does not scan a workflow directory that resolves through a junction outside its project', () => {
    const outside = mkdtempSync(join(tmpdir(), 'workflow-p2-outside-'));
    try {
      writeFileSync(join(outside, 'escape.md'), definitionText().replace('id: amendable', 'id: escape-link').replace('project: kb-ops', 'project: linked').replaceAll('orgs/kb-ops/', 'orgs/linked/'));
      const project = join(activeRoot, 'orgs', 'linked');
      mkdirSync(project, { recursive: true });
      symlinkSync(outside, join(project, 'workflows'), 'junction');
      expect(scanWorkflowDefs(activeRoot).some((entry) => entry.def?.id === 'escape-link')).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  // P6 W6.2 [design:435] — the no-byte-change snapshot: every §2 handler this task converted into a thin
  // service caller must serve the EXACT same top-level key set (and error vocabulary) it served before
  // the conversion. `toMatchObject` above already pins individual fields per scenario; this test pins
  // the FULL key set (via `Object.keys(...).sort()`) so an extraction that silently added or dropped a
  // field — the class of defect a partial `toMatchObject` cannot see — fails here.
  it('no-byte-change snapshot: the converted handlers serve the exact same envelope key set as before', async () => {
    const listed = await app.inject({ method: 'GET', url: '/api/workflows' });
    expect(Object.keys(listed.json()).sort()).toEqual(['groups', 'items', 'revision']);
    const detail = await app.inject({ method: 'GET', url: '/api/workflows/amendable' });
    expect(Object.keys(detail.json()).sort()).toEqual(['brief', 'details', 'revision', 'summary']);

    const created = await app.inject({
      method: 'POST', url: '/api/workflows', headers: headers(token),
      payload: {
        selector: { type: 'workflow', id: 'snapshot-flow' }, project: 'kb-ops', expectedCollectionRevision: listed.json().revision, idempotencyKey: 'snapshot-create',
        humanName: 'Snapshot Flow', purpose: 'Prove the byte contract.', model: 'claude-sonnet-5', profile: 'producer',
        tools: [], skills: [], connectors: [], filesystemRoots: ['kb-ops'],
      },
    });
    expect(created.statusCode).toBe(202);
    expect(Object.keys(created.json()).sort()).toEqual(['operationId', 'replayed', 'status'].sort());

    const launched = await app.inject({
      method: 'POST', url: '/api/workflows/amendable/launch', headers: headers(token),
      payload: { idempotencyKey: 'snapshot-launch', expectedSourceRevision: await sourceRevision(), parameters: {} },
    });
    expect(launched.statusCode).toBe(202);
    expect(Object.keys(launched.json()).sort()).toEqual(['activationGated', 'cards', 'ok', 'runRef', 'waitingHuman'].sort());

    // Refusals: the closed error vocabulary is unchanged too — an extraction that renamed a code or
    // widened a body would fail these exact-shape checks.
    const staleLaunch = await app.inject({
      method: 'POST', url: '/api/workflows/amendable/launch', headers: headers(token),
      payload: { idempotencyKey: 'snapshot-stale', expectedSourceRevision: '0'.repeat(64), parameters: {} },
    });
    expect(staleLaunch.statusCode).toBe(409);
    expect(staleLaunch.json()).toEqual({ error: 'stale-source-revision', sourceRevision: expect.stringMatching(/^[a-f0-9]{64}$/) });

    const missingKey = await app.inject({
      method: 'POST', url: '/api/workflows/amendable/launch', headers: headers(token),
      payload: { idempotencyKey: '', expectedSourceRevision: await sourceRevision(), parameters: {} },
    });
    expect(missingKey.statusCode).toBe(400);
    expect(Object.keys(missingKey.json()).sort()).toEqual(['detail', 'error']);
  });

  // P6 W6.2 [design:633]: an old-route launch and a `POST /api/v1/runs` launch of the SAME owner must
  // produce byte-identical `Run.owner`/`executionHost`/`terminalOutcome`/`completedAt`/`archivedFrom`
  // rows. Both routes now call `launchService` bound to the SAME `createWorkflowLaunchServicePort(ctx)`
  // (workflows/routes.ts) — this test proves that parity end to end, against the SAME store, rather than
  // asserting it structurally.
  it('an old-route launch and a v1 launch of the same owner store byte-identical Run identity fields', async () => {
    const v1App = Fastify();
    surface.v1 = { launchPort: createWorkflowLaunchServicePort(surface) };
    v1App.register(async (v1Scope) => {
      originPlugin(v1Scope, { allowedOrigins: [ORIGIN] });
      v1Scope.addHook('preHandler', requireSession(SESSION));
      registerV1OperatorMutationRoutes(v1Scope, surface);
    });
    await v1App.ready();
    try {
      const oldRoute = await app.inject({
        method: 'POST', url: '/api/workflows/amendable/launch', headers: headers(token),
        payload: { idempotencyKey: 'parity-old-route', expectedSourceRevision: await sourceRevision(), parameters: {} },
      });
      expect(oldRoute.statusCode).toBe(202);
      const oldRunRef = oldRoute.json().runRef as string;

      const v1Route = await v1App.inject({
        method: 'POST', url: '/api/v1/runs', headers: headers(token),
        payload: { workflowId: 'amendable', idempotencyKey: 'parity-v1-route', expectedSourceRevision: await sourceRevision(), parameters: {} },
      });
      expect(v1Route.statusCode).toBe(202);
      const v1RunRef = v1Route.json().data.runRef as string;
      expect(v1RunRef).not.toBe(oldRunRef); // two distinct client idempotency keys, two distinct runs

      const identityFields = (runRef: string) => {
        const run = store.listRuns('operator', 'all-subjects').find((candidate) => candidate.runRef === runRef)!;
        return {
          owner: run.owner, executionHost: run.executionHost, terminalOutcome: run.terminalOutcome,
          completedAt: run.completedAt, archivedFrom: run.archivedFrom,
        };
      };
      expect(identityFields(v1RunRef)).toEqual(identityFields(oldRunRef));
    } finally {
      await v1App.close();
    }
  });
});
