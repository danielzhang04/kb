import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { makeSurfaceContext } from '../http/surface.ts';
import type { SurfaceContext } from '../http/context.ts';
import { registerComposerRoutes } from './routes.ts';
import { mintSession } from '../auth/session.ts';
import type { AuditEvent, AuditRow } from '../audit/log.ts';
import type { PreambleRunner } from '../write/preambleGate.ts';
import type { VibeProcess, VibeSpawner } from '../vibe/session.ts';
import { createProviderIdProtector } from './protector.ts';
import { createInMemoryComposerStore } from './store.ts';
import { lockout, rateLimit } from '../security/ratelimit.ts';
import { runtimeCapabilities } from '../runtime/capabilities.ts';
import { createInMemoryControlPlaneStore } from '../control/store.ts';

const PROVIDER_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const SECRET = Buffer.from('composer-routes-test-secret-0123456789');
const SECRET_TEXT = SECRET.toString('utf8');
const sessionConfig = { secret: SECRET, ttlMs: 60_000 };
const okPreamble: PreambleRunner = () => ({ exitCode: 0, stdout: 'PREAMBLE OK', stderr: '' });
const frozenPreamble: PreambleRunner = () => ({ exitCode: 1, stdout: 'PREAMBLE FAIL: STOP file present', stderr: '' });
let testStateRoot: string;

beforeEach(() => {
  testStateRoot = mkdtempSync(join(tmpdir(), 'kb-composer-routes-state-'));
});

function token(subject = 'operator'): string {
  return mintSession(subject, sessionConfig).token;
}

function headers(subject = 'operator'): Record<string, string> {
  return { 'content-type': 'application/json', authorization: `Bearer ${token(subject)}` };
}

function recordingAudit(): { rows: AuditRow[]; fn: NonNullable<SurfaceContext['appendAudit']> } {
  const rows: AuditRow[] = [];
  return {
    rows,
    fn: (_repoRoot: string, event: AuditEvent): AuditRow => {
      const row = { ts: '2026-07-18T00:00:00.000Z', ...event };
      rows.push(row);
      return row;
    },
  };
}

function makeProcess() {
  let stdout: ((chunk: string) => void) | undefined;
  let stderr: ((chunk: string) => void) | undefined;
  let exit: ((code: number | null) => void) | undefined;
  const kill = vi.fn();
  const writes: string[] = [];
  const proc: VibeProcess = {
    onStdout(cb) { stdout = cb; },
    onStderr(cb) { stderr = cb; },
    onExit(cb) { exit = cb; },
    writeStdin(text) { writes.push(text); },
    endStdin() {},
    kill,
  };
  return {
    proc,
    kill,
    writes,
    emitStdout: (chunk: string) => stdout?.(chunk),
    emitStderr: (chunk: string) => stderr?.(chunk),
    emitExit: (code: number | null) => exit?.(code),
  };
}

function permissiveGuard() {
  return lockout(rateLimit({ limit: 1000, windowMs: 60_000 }), { threshold: 1000, lockoutMs: 1 });
}

function buildApp(overrides: Partial<SurfaceContext> = {}) {
  const app = Fastify({ logger: false });
  const composerStore =
    overrides.composerStore ??
    createInMemoryComposerStore({ protector: createProviderIdProtector(SECRET) });
  const ctx = makeSurfaceContext({
    controlStore: createInMemoryControlPlaneStore(),
    repoRoot: '/repo',
    stateRoot: testStateRoot,
    sessionConfig,
    composerStore,
    runPreamble: okPreamble,
    appendAudit: recordingAudit().fn,
    vibeRateGuard: permissiveGuard(),
    ...overrides,
  });
  app.register(async (scope) => registerComposerRoutes(scope, ctx));
  return { app, ctx };
}

function repoWithDeclaredAgent(): string {
  const root = mkdtempSync(join(tmpdir(), 'composer-agent-'));
  mkdirSync(join(root, 'agents'), { recursive: true });
  writeFileSync(join(root, 'agents', 'research-worker.md'), [
    '---', 'id: research-worker', 'runner-bound: false', '---', '', '# Research worker', '',
    'Require a source-backed research brief before recommending publication.', '',
  ].join('\n'), 'utf8');
  return root;
}

async function createSession(app: FastifyInstance, subject = 'operator', title = 'Idea') {
  const response = await app.inject({
    method: 'POST', url: '/api/composer/sessions', headers: headers(subject), payload: { title },
  });
  expect(response.statusCode).toBe(201);
  return response.json().session as { composerRef: string };
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  if (app) await app.close();
  app = undefined;
  rmSync(testStateRoot, { recursive: true, force: true });
});

describe('Composer workspace catalog routes', () => {
  it('refuses a Linux Composer turn before constructing a Vibe child', async () => {
    const spawn = vi.fn(() => { throw new Error('must not spawn'); });
    ({ app } = buildApp({ runtimeCapabilities: runtimeCapabilities('linux'), spawn }));
    const response = await app.inject({
      method: 'POST', url: '/api/composer/sessions/any/turns', headers: headers(), payload: { prompt: 'hello' },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'capability-unavailable', capability: 'vibe' });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('refuses recognizable credential content in titles before persistence', async () => {
    ({ app } = buildApp());
    const response = await app.inject({
      method: 'POST', url: '/api/composer/sessions', headers: headers(),
      payload: { title: 'use sk-abcdefghijklmnopqrstuv for this' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'sensitive-content-refused', field: 'title' });
    expect((await app.inject({ method: 'GET', url: '/api/composer/sessions', headers: headers() })).json().sessions).toEqual([]);
  });

  it('allows ordinary UUID references that are not known provider capabilities', async () => {
    ({ app } = buildApp());
    const uuid = '123e4567-e89b-42d3-a456-426614174000';
    const response = await app.inject({
      method: 'POST', url: '/api/composer/sessions', headers: headers(), payload: { title: `Run ${uuid}` },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().session.title).toBe(`Run ${uuid}`);
  });

  it('binds a workspace only to a server-declared agent, preserves it through a fork, and keeps it subject-bound', async () => {
    ({ app } = buildApp({ repoRoot: repoWithDeclaredAgent() }));
    const created = await app.inject({
      method: 'POST', url: '/api/composer/sessions', headers: headers('alice'),
      payload: { title: 'Agent research', agentId: 'research-worker' },
    });
    expect(created.statusCode).toBe(201);
    const session = created.json().session as { composerRef: string; agent: { id: string; path: string; sourceHash: string } | null };
    expect(session.agent).toMatchObject({ id: 'research-worker', path: 'agents/research-worker.md' });
    expect(session.agent?.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(created.body).not.toContain(PROVIDER_ID);

    const rejected = await app.inject({
      method: 'POST', url: '/api/composer/sessions', headers: headers('alice'), payload: { agentId: 'queue-only-worker' },
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json()).toEqual({ error: 'agent-not-declared' });
    const root = repoWithDeclaredAgent();
    writeFileSync(join(root, 'agents', 'broken.md'), 'not a declaration\n', 'utf8');
    const invalidApp = buildApp({ repoRoot: root }).app;
    const invalid = await invalidApp.inject({
      method: 'POST', url: '/api/composer/sessions', headers: headers('alice'), payload: { agentId: 'broken' },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toEqual({
      error: 'agent-declaration-invalid',
      declaration: { id: 'broken', source: 'agents/broken.md', problem: 'malformed-frontmatter' },
    });
    await invalidApp.close();
    const ambiguousRoot = repoWithDeclaredAgent();
    writeFileSync(join(ambiguousRoot, 'agents', 'mismatch.md'), '---\nid: other-agent\n---\nno\n', 'utf8');
    writeFileSync(join(ambiguousRoot, 'agents', 'one.md'), '---\nid: shared-agent\n---\nno\n', 'utf8');
    writeFileSync(join(ambiguousRoot, 'agents', 'two.md'), '---\nid: shared-agent\n---\nno\n', 'utf8');
    const ambiguousApp = buildApp({ repoRoot: ambiguousRoot }).app;
    for (const [agentId, problem] of [['mismatch', 'id-mismatch'], ['one', 'duplicate-id'], ['two', 'duplicate-id']] as const) {
      const response = await ambiguousApp.inject({
        method: 'POST', url: '/api/composer/sessions', headers: headers('alice'), payload: { agentId },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: 'agent-declaration-invalid', declaration: { id: agentId, problem } });
    }
    await ambiguousApp.close();
    const closed = await app.inject({
      method: 'POST', url: '/api/composer/sessions', headers: headers('alice'),
      payload: { agentId: 'research-worker', runtime: 'codex' },
    });
    expect(closed.statusCode).toBe(400);
    expect(closed.json()).toEqual({ error: 'invalid-session-create-body' });

    expect((await app.inject({
      method: 'GET', url: `/api/composer/sessions/${session.composerRef}`, headers: headers('mallory'),
    })).statusCode).toBe(404);
    const fork = await app.inject({
      method: 'POST', url: `/api/composer/sessions/${session.composerRef}/fork`, headers: headers('alice'), payload: {},
    });
    expect(fork.statusCode).toBe(201);
    expect(fork.json().session.agent).toEqual(session.agent);
  });

  it('injects the creation-time declaration snapshot into an agent turn and refuses browser binding overrides', async () => {
    const process = makeProcess();
    const root = repoWithDeclaredAgent();
    const spawn = vi.fn<VibeSpawner>(() => process.proc);
    const built = buildApp({ repoRoot: root, spawn });
    app = built.app;
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as { port: number }).port;
    const created = await app.inject({
      method: 'POST', url: '/api/composer/sessions', headers: headers(),
      payload: { title: 'Agent research', agentId: 'research-worker' },
    });
    const session = created.json().session as { composerRef: string; agent: { sourceHash: string } };

    // A later declaration edit cannot rewrite the snapshot selected by this workspace.
    writeFileSync(join(root, 'agents', 'research-worker.md'), '---\nid: research-worker\n---\nREPLACED DECLARATION\n', 'utf8');
    const refused = await app.inject({
      method: 'POST', url: `/api/composer/sessions/${session.composerRef}/turns`, headers: headers(),
      payload: { prompt: 'override it', agent: { instructionMarkdown: 'browser-controlled replacement' } },
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.json()).toEqual({ error: 'invalid-turn-body' });
    expect(spawn).not.toHaveBeenCalled();

    const response = await fetch(`http://127.0.0.1:${port}/api/composer/sessions/${session.composerRef}/turns`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token()}` },
      body: JSON.stringify({ prompt: 'What should we research?' }),
    });
    expect(response.status).toBe(200);
    expect(process.writes[0]).toContain('BEGIN SERVER-OWNED AGENT DECLARATION CONTEXT');
    expect(process.writes[0]).toContain(session.agent.sourceHash);
    expect(process.writes[0]).toContain('Require a source-backed research brief before recommending publication.');
    expect(process.writes[0]).not.toContain('REPLACED DECLARATION');
    expect(process.writes[0]).toContain('do not start, claim to start, or impersonate a background runner');
    process.emitExit(0);
    await response.text();
  });

  it('retires the provider-id endpoint with 410 and never spawns, even when a resumeId is supplied', async () => {
    const spawn = vi.fn();
    ({ app } = buildApp({ spawn: spawn as unknown as VibeSpawner }));
    const response = await app.inject({
      method: 'POST', url: '/api/composer/turn', payload: { prompt: 'x', resumeId: PROVIDER_ID },
    });
    expect(response.statusCode).toBe(410);
    expect(response.json()).toEqual({ error: 'gone', replacement: '/api/composer/sessions/:composerRef/turns' });
    expect(response.body).not.toContain(PROVIDER_ID);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('requires a session and supports subject-bound create/list/get/fork/archive/restore', async () => {
    ({ app } = buildApp());
    expect((await app.inject({ method: 'GET', url: '/api/composer/sessions' })).statusCode).toBe(401);
    const created = await createSession(app, 'alice', 'Research');

    const listed = await app.inject({ method: 'GET', url: '/api/composer/sessions', headers: headers('alice') });
    expect(listed.json().sessions).toMatchObject([{ composerRef: created.composerRef, title: 'Research', state: 'open' }]);
    for (const [method, suffix] of [
      ['GET', ''], ['POST', '/fork'], ['POST', '/archive'], ['POST', '/restore'], ['POST', '/turns'],
    ] as const) {
      const response = await app.inject({
        method,
        url: `/api/composer/sessions/${created.composerRef}${suffix}`,
        headers: headers('mallory'),
        ...(method === 'POST' ? { payload: suffix === '/turns' ? { prompt: 'steal it' } : {} } : {}),
      });
      expect(response.statusCode, `${method} ${suffix}`).toBe(404);
    }

    const fork = await app.inject({
      method: 'POST', url: `/api/composer/sessions/${created.composerRef}/fork`, headers: headers('alice'), payload: {},
    });
    expect(fork.statusCode).toBe(201);
    expect(fork.json().session).toMatchObject({ sourceComposerRef: created.composerRef, state: 'open' });
    expect(fork.json().session.composerRef).not.toBe(created.composerRef);

    const archived = await app.inject({
      method: 'POST', url: `/api/composer/sessions/${created.composerRef}/archive`, headers: headers('alice'), payload: {},
    });
    expect(archived.json().session.state).toBe('archived');
    const restored = await app.inject({
      method: 'POST', url: `/api/composer/sessions/${created.composerRef}/restore`, headers: headers('alice'), payload: {},
    });
    expect(restored.json().session.state).toBe('open');
    expect((await app.inject({
      method: 'DELETE',
      url: `/api/composer/sessions/${created.composerRef}`,
      headers: { authorization: `Bearer ${token('alice')}` },
    })).statusCode).toBe(404);
  });
});

describe('Composer workspace turn route', () => {
  it('refuses recognizable credential content before spawn or turn persistence', async () => {
    const spawn = vi.fn();
    const built = buildApp({ spawn: spawn as unknown as VibeSpawner });
    app = built.app;
    const session = await createSession(app);
    const response = await app.inject({
      method: 'POST', url: `/api/composer/sessions/${session.composerRef}/turns`, headers: headers(),
      payload: { prompt: 'inspect -----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'sensitive-content-refused', field: 'prompt' });
    expect(spawn).not.toHaveBeenCalled();
    const detail = built.ctx.composerStore.get('operator', session.composerRef);
    expect(detail.ok && detail.workspace.turns).toEqual([]);
  });

  it('keeps the provider id server-side, persists the final model, and resumes after the first turn', async () => {
    const first = makeProcess();
    const second = makeProcess();
    const calls: string[][] = [];
    const processes = [first.proc, second.proc];
    const spawn: VibeSpawner = (args) => {
      calls.push(args);
      const process = processes.shift();
      if (!process) throw new Error('unexpected spawn');
      return process;
    };
    const built = buildApp({ spawn });
    app = built.app;
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as { port: number }).port;
    const session = await createSession(app, 'operator', 'Persistent chat');
    const bearer = token();

    const response = await fetch(`http://127.0.0.1:${port}/api/composer/sessions/${session.composerRef}/turns`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
      body: JSON.stringify({ prompt: 'first prompt' }),
    });
    expect(response.status).toBe(200);
    expect(first.writes[0]).toContain('first prompt');
    expect(first.writes[0]).toContain('BEGIN SERVER-OWNED COMPOSER PLANNING PROTOCOL');
    expect(first.writes[0]).toContain('kb.plan-proposal/v1');
    first.emitStdout(`${JSON.stringify({ type: 'system', subtype: 'init', session_id: PROVIDER_ID })}\n`);
    first.emitStdout(`${JSON.stringify({
      type: 'assistant', timestamp: '2026-07-18T00:00:00Z',
      message: { model: 'claude-sonnet-5', content: [
        { type: 'thinking', thinking: 'private reasoning must not cross the server boundary' },
        { type: 'text', text: `answer ${PROVIDER_ID} ${SECRET_TEXT} ${bearer}` },
        { type: 'tool_use', id: 'tool-secret', name: 'Read', input: { path: '.env', marker: 'tool-input-secret-canary' } },
      ] },
    })}\n`);
    first.emitStdout(`${JSON.stringify({
      type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool-secret', content: 'tool-result-secret-canary' }] },
    })}\n`);
    first.emitStderr(`diagnostic ${PROVIDER_ID} ${SECRET_TEXT} ${bearer}`);
    first.emitExit(0);
    const text = await response.text();
    expect(text).not.toContain(PROVIDER_ID);
    expect(text).not.toContain(SECRET_TEXT);
    expect(text).not.toContain(bearer);
    expect(text).not.toContain('sessionId');
    expect(text).not.toContain('private reasoning');
    expect(text).not.toContain('tool-input-secret-canary');
    expect(text).not.toContain('tool-result-secret-canary');
    expect(text).toContain('[redacted]');

    const detail = await app.inject({
      method: 'GET', url: `/api/composer/sessions/${session.composerRef}`, headers: headers(),
    });
    expect(detail.body).not.toContain(PROVIDER_ID);
    expect(detail.body).not.toContain(SECRET_TEXT);
    expect(detail.body).not.toContain(bearer);
    expect(detail.body).not.toContain('private reasoning');
    expect(detail.body).not.toContain('SERVER-OWNED COMPOSER PLANNING PROTOCOL');
    expect(detail.body).not.toContain('kb.plan-proposal/v1');
    expect(detail.json().session.turns[0]).toMatchObject({
      prompt: 'first prompt', state: 'failed', model: { turns: [{ model: 'claude-sonnet-5' }] },
    });

    const response2 = await fetch(`http://127.0.0.1:${port}/api/composer/sessions/${session.composerRef}/turns`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token()}` },
      body: JSON.stringify({ prompt: 'second prompt' }),
    });
    expect(calls[1]).toContain(`--resume=${PROVIDER_ID}`);
    expect(second.writes[0]).toContain('second prompt');
    expect(second.writes[0]).toContain('BEGIN SERVER-OWNED COMPOSER PLANNING PROTOCOL');
    second.emitExit(0);
    await response2.text();
    expect(calls[1]).not.toContain('--resume');
  });

  it('rehydrates a fresh runtime from bounded visible history without hidden reasoning', async () => {
    const process = makeProcess();
    const built = buildApp({ spawn: () => process.proc });
    app = built.app;
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as { port: number }).port;
    const session = await createSession(app, 'operator', 'Forked idea');
    const lease = built.ctx.composerStore.acquireWriter('operator', session.composerRef);
    if (!lease.ok) throw new Error('lease');
    const prior = built.ctx.composerStore.beginTurn('operator', session.composerRef, lease.lease, 'prior operator goal');
    if (!prior.ok) throw new Error('turn');
    built.ctx.composerStore.updateTurn('operator', session.composerRef, lease.lease, prior.workspace.turnId, {
      state: 'complete',
      model: { turns: [{
        index: 0, model: 'claude-sonnet-5', timestamp: null, usage: null,
        steps: [
          { kind: 'thinking', text: 'private chain of thought' },
          { kind: 'text', text: 'visible prior answer' },
        ],
      }] },
      endedAt: '2026-07-18T00:00:00.000Z',
    });
    built.ctx.composerStore.releaseWriter('operator', session.composerRef, lease.lease);

    const response = await fetch(`http://127.0.0.1:${port}/api/composer/sessions/${session.composerRef}/turns`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token()}` },
      body: JSON.stringify({ prompt: 'current request' }),
    });
    expect(response.status).toBe(200);
    expect(process.writes[0]).toContain('BEGIN PRIOR VISIBLE CONTEXT');
    expect(process.writes[0]).toContain('prior operator goal');
    expect(process.writes[0]).toContain('visible prior answer');
    expect(process.writes[0]).toContain('current request');
    expect(process.writes[0]).toContain('BEGIN SERVER-OWNED COMPOSER PLANNING PROTOCOL');
    expect(process.writes[0]).toContain('kb.plan-proposal/v1');
    expect(process.writes[0].indexOf('current request'))
      .toBeLessThan(process.writes[0].indexOf('BEGIN SERVER-OWNED COMPOSER PLANNING PROTOCOL'));
    expect(process.writes[0]).not.toContain('private chain of thought');
    process.emitExit(0);
    await response.text();
  });

  it('enforces one writer per workspace, permits another workspace, and refuses archive while active', async () => {
    const p1 = makeProcess();
    const p2 = makeProcess();
    let spawnCount = 0;
    const spawn = vi.fn<VibeSpawner>(() => (++spawnCount === 1 ? p1.proc : p2.proc));
    const built = buildApp({ spawn });
    app = built.app;
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as { port: number }).port;
    const a = await createSession(app);
    const b = await createSession(app);
    const fetchTurn = (ref: string) => fetch(`http://127.0.0.1:${port}/api/composer/sessions/${ref}/turns`, {
      method: 'POST', headers: headers(), body: JSON.stringify({ prompt: 'hold' }),
    });

    const activeA = await fetchTurn(a.composerRef);
    expect(activeA.status).toBe(200);
    const busy = await fetchTurn(a.composerRef);
    expect(busy.status).toBe(409);
    expect(await busy.json()).toEqual({ error: 'session-busy' });
    const fork = await app.inject({
      method: 'POST', url: `/api/composer/sessions/${a.composerRef}/fork`, headers: headers(), payload: {},
    });
    expect(fork.statusCode).toBe(409);
    expect(fork.json()).toEqual({ error: 'session-busy' });
    const archive = await app.inject({
      method: 'POST', url: `/api/composer/sessions/${a.composerRef}/archive`, headers: headers(), payload: {},
    });
    expect(archive.statusCode).toBe(409);

    const activeB = await fetchTurn(b.composerRef);
    expect(activeB.status).toBe(200);
    expect(spawn).toHaveBeenCalledTimes(2);
    p1.emitExit(0);
    p2.emitExit(0);
    await Promise.all([activeA.text(), activeB.text()]);
    expect((await app.inject({
      method: 'POST', url: `/api/composer/sessions/${a.composerRef}/archive`, headers: headers(), payload: {},
    })).statusCode).toBe(200);
  });

  it('releases the writer lease on a synchronous gate refusal and records a failed turn', async () => {
    const built = buildApp({ runPreamble: frozenPreamble, spawn: vi.fn() as unknown as VibeSpawner });
    app = built.app;
    const session = await createSession(app);
    const refused = await app.inject({
      method: 'POST', url: `/api/composer/sessions/${session.composerRef}/turns`, headers: headers(), payload: { prompt: 'blocked' },
    });
    expect(refused.statusCode).toBe(503);
    const archived = await app.inject({
      method: 'POST', url: `/api/composer/sessions/${session.composerRef}/archive`, headers: headers(), payload: {},
    });
    expect(archived.statusCode).toBe(200);
    expect(archived.json().session.turns[0]).toMatchObject({ prompt: 'blocked', state: 'failed' });
  });

  it('kills the child, releases the lease, and records stopped when the client disconnects', async () => {
    const process = makeProcess();
    const built = buildApp({ spawn: () => process.proc });
    app = built.app;
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as { port: number }).port;
    const session = await createSession(app);
    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${port}/api/composer/sessions/${session.composerRef}/turns`, {
      method: 'POST', headers: headers(), body: JSON.stringify({ prompt: 'long turn' }), signal: controller.signal,
    });
    expect(response.status).toBe(200);
    controller.abort();
    await response.text().catch(() => '');
    await vi.waitFor(() => expect(process.kill).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => {
      const detail = built.ctx.composerStore.get('operator', session.composerRef);
      expect(detail.ok && detail.workspace.turns[0].state).toBe('stopped');
    });
    expect((await app.inject({
      method: 'POST', url: `/api/composer/sessions/${session.composerRef}/archive`, headers: headers(), payload: {},
    })).statusCode).toBe(200);
  });

  it('contains provider-handle storage failures inside the turn callback and releases the lease', async () => {
    const process = makeProcess();
    const backing = createInMemoryComposerStore({ protector: createProviderIdProtector(SECRET) });
    const composerStore = {
      ...backing,
      setProviderId: () => { throw new Error('disk unavailable'); },
    };
    const built = buildApp({ composerStore, spawn: () => process.proc });
    app = built.app;
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as { port: number }).port;
    const session = await createSession(app);

    const response = await fetch(`http://127.0.0.1:${port}/api/composer/sessions/${session.composerRef}/turns`, {
      method: 'POST', headers: headers(), body: JSON.stringify({ prompt: 'persist this safely' }),
    });
    process.emitStdout(`${JSON.stringify({ type: 'system', subtype: 'init', session_id: PROVIDER_ID })}\n`);
    expect(process.kill).toHaveBeenCalledTimes(1);
    process.emitExit(1);
    await response.text();

    const detail = backing.get('operator', session.composerRef);
    expect(detail.ok && detail.workspace.turns[0]).toMatchObject({
      state: 'failed', error: 'local Composer state write failed',
    });
    expect(backing.archive('operator', session.composerRef).ok).toBe(true);
  });
});
