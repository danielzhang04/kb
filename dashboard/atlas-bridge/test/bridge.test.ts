import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AtlasKbBridge } from '../src/bridge.js';
import { DashboardClient } from '../src/client.js';
import type { BridgeConfig } from '../src/config.js';
import { BridgeError } from '../src/errors.js';
import { applyAtlasSessionNotification } from '../src/session.js';

type Mode = 'legacy' | 'v1' | 'unknown';
interface SeenRequest {
  method: string;
  path: string;
  authorization?: string;
  idempotencyKey?: string;
  body?: Record<string, unknown>;
}

interface FakeOptions {
  mode: Mode;
  unauthorized?: boolean;
  secret500Path?: string;
  delayMutationPath?: string;
  delayPath?: string;
  humanRequestKind?: string;
  malformedMutationFamily?: 'agents' | 'workflows' | 'runs' | 'schedules';
  largeResponsePath?: string;
  largeTrace?: boolean;
  largeIndex?: boolean;
  largeV1ProbePath?: string;
  forbiddenLegacyPaths?: readonly string[];
  listSize?: number;
  longGet?: boolean;
  indexWithoutSummary?: boolean;
  projectedLists?: boolean;
  unreadableRepoPath?: string;
}

const servers: Array<ReturnType<typeof createServer>> = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  })));
});

function send(response: ServerResponse, status: number, body?: unknown): void {
  response.statusCode = status;
  if (body === undefined) return void response.end();
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(body));
}

function envelope(kind: string, data: unknown = [], meta: Record<string, unknown> = {}): unknown {
  return { apiVersion: 'v1', kind, data, meta };
}

async function sendLargeIndex(response: ServerResponse): Promise<void> {
  response.statusCode = 200;
  response.setHeader('content-type', 'application/json');
  response.on('error', () => undefined);
  response.write('{"generatedAt":"2026-08-27T00:00:00.000Z","summary":{"agents":3},"ignored":"');
  const chunk = 'x'.repeat(64 * 1024);
  for (let index = 0; index < 80 && !response.destroyed; index += 1) {
    response.write(chunk);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  if (!response.destroyed) {
    response.end('","ledgers":{"grades":{"rows":[{"worker":"first"},{"worker":"second"},{"worker":"third"}]}}}');
  }
}

async function sendLargeV1Probe(response: ServerResponse): Promise<void> {
  response.statusCode = 200;
  response.setHeader('content-type', 'application/json');
  response.on('error', () => undefined);
  response.write('{"api');
  await new Promise<void>((resolve) => setImmediate(resolve));
  response.write('Version":"v1","kind":"agent-list","data":["');
  const chunk = 'x'.repeat(64 * 1024);
  for (let index = 0; index < 80 && !response.destroyed; index += 1) {
    response.write(chunk);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  if (!response.destroyed) response.end('"],"meta":{}}');
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

async function fakeDashboard(options: FakeOptions): Promise<{ origin: string; requests: SeenRequest[] }> {
  const requests: SeenRequest[] = [];
  const agents = Array.from({ length: options.listSize ?? 0 }, (_, index) => ({
    ref: `agent-${index}`, displayName: `Agent ${index}`, role: 'builder', working: index % 2 === 0,
    current: `card-${index}`, ledger: { lastActive: `2026-08-27T00:${String(index).padStart(2, '0')}:00Z` },
    cardCount: index, project: 'atlas-prep', projects: ['atlas-prep', 'kb-ops', 'third', 'drop'],
    shortRef: `a-${index}`, privatePrompt: 'must not pass through',
  }));
  const workflows = Array.from({ length: options.listSize ?? 0 }, (_, index) => ({
    ref: `workflow-${index}`, title: `Workflow ${index}`, displayName: `Workflow ${index}`,
    project: 'atlas-prep', profile: 'standard', riskTier: 'T2', launchable: true, valid: true,
    stageCount: 2, path: `workflows/workflow-${index}.yaml`, manager: 'atlas', governedBy: 'contract.md',
    parameters: {}, stages: [{}, {}], shortRef: `w-${index}`, sourceHash: 'b'.repeat(64),
    compileError: 'x'.repeat(240), governanceProblems: [], pendingAmendmentRef: null,
    pendingAmendmentPath: null, pendingAmendmentStatus: null,
  }));
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://dashboard.test');
    const body = await readBody(request);
    requests.push({
      method: request.method ?? 'GET', path: url.pathname,
      authorization: request.headers.authorization,
      idempotencyKey: request.headers['idempotency-key'] as string | undefined,
      body,
    });
    if (url.pathname === '/api/auth/context') {
      return options.mode === 'legacy' ? send(response, 404, { error: 'not-found' }) : send(response, 200, { mode: 'win32-desktop' });
    }
    if (options.unauthorized) return send(response, 401, { error: 'unauthenticated' });
    if (options.secret500Path === url.pathname && request.method !== 'GET') {
      return send(response, 500, { error: 'Authorization: Bearer x-super-secret', assertion: 'secret' });
    }
    if (options.delayMutationPath === url.pathname && request.method !== 'GET') {
      return void setTimeout(() => send(response, 200, { ok: true }), 200);
    }
    if (options.delayPath === url.pathname) {
      return void setTimeout(() => send(response, 200, { ok: true }), 200);
    }
    if (options.largeResponsePath === url.pathname) {
      response.statusCode = 200;
      response.setHeader('content-type', 'application/json');
      response.write('{"value":"');
      response.write('x'.repeat(4096));
      return void response.end('"}');
    }
    if (options.forbiddenLegacyPaths?.includes(url.pathname)) return send(response, 403, { error: 'forbidden' });
    if (url.pathname === '/api/runtime/capabilities') return send(response, 200, { runtime: 'fake' });

    if (url.pathname.startsWith('/api/v1/')) {
      if (options.mode === 'legacy') return send(response, 404, { error: 'not-found' });
      if (options.mode === 'unknown') return send(response, 200, { apiVersion: 'v2', kind: 'health', data: {}, meta: {} });
      if (options.largeV1ProbePath === url.pathname) return void await sendLargeV1Probe(response);
      if (request.method === 'GET') {
        if (url.pathname === '/api/v1/health') return send(response, 200, envelope('health', {}, { watermark: 'a'.repeat(64) }));
        if (url.pathname === '/api/v1/agents') return send(response, 200, envelope('agent-list', [], { watermark: options.malformedMutationFamily === 'agents' ? 'bad' : 'a'.repeat(64) }));
        if (/^\/api\/v1\/agents\/[^/]+$/.test(url.pathname)) return send(response, 200, envelope('agent', { id: 'agent' }, { etag: 'a'.repeat(64) }));
        if (url.pathname === '/api/v1/workflows') return send(response, 200, envelope('workflow-list', options.projectedLists ? [{
          id: 'workflow-v1', title: 'V1 workflow', project: 'atlas-prep', profile: 'standard', riskTier: 'T2',
          launchable: true, valid: true, stageCount: 3, compileError: 'compile failed', ignored: 'drop',
        }] : [], { watermark: options.malformedMutationFamily === 'workflows' ? 'bad' : 'b'.repeat(64) }));
        if (/^\/api\/v1\/workflows\/[^/]+$/.test(url.pathname)) return send(response, 200, envelope('workflow', { id: 'workflow' }, { etag: 'c'.repeat(64) }));
        if (url.pathname === '/api/v1/runs') return send(response, 200, envelope('run-list', [], { watermark: options.malformedMutationFamily === 'runs' ? 'bad' : 'd'.repeat(64) }));
        if (/\/events$/.test(url.pathname)) return send(response, 200, envelope('run-events', [], { nextCursor: '2' }));
        if (/^\/api\/v1\/runs\/[^/]+$/.test(url.pathname)) return send(response, 200, envelope('run', { runRef: 'run-1' }, { etag: 'run:run-1:1' }));
        if (url.pathname === '/api/v1/schedules') return send(response, 200, envelope('schedule-list', [], { watermark: options.malformedMutationFamily === 'schedules' ? 'bad' : 'schedules:4' }));
        if (url.pathname === '/api/v1/inbox') return send(response, 200, envelope('inbox', [
          { requestRef: 'req-1', runRef: 'run-1', kind: options.humanRequestKind ?? 'question' },
        ]));
      }
      if (url.pathname.startsWith('/api/v1/agents')) return send(response, 200, envelope('agent', body, { etag: 'a'.repeat(64) }));
      if (url.pathname.startsWith('/api/v1/workflows')) return send(response, 200, envelope('workflow', body, { etag: 'b'.repeat(64) }));
      if (url.pathname === '/api/v1/runs') return send(response, 200, envelope('run', body, { etag: 'run:new:1' }));
      if (url.pathname.includes('/human-requests/')) return send(response, 200, envelope('human-response', body));
      if (url.pathname.startsWith('/api/v1/schedules')) return send(response, 200, envelope('schedule', body, { etag: 'schedule:s-1:2' }));
      return send(response, 404, { error: 'not-found' });
    }

    if (request.method !== 'GET') return send(response, 200, { ok: true, value: body });
    if (url.pathname === '/api/agents') return send(response, 200, { agents, watermark: 'legacy-agents' });
    if (/^\/api\/agents\/[^/]+$/.test(url.pathname)) return send(response, 200, {
      id: 'agent', sourceHash: 'a'.repeat(64), prompt: options.longGet ? 'p'.repeat(3000) : 'short',
      nested: { notes: options.longGet ? 'n'.repeat(2500) : 'short' },
    });
    if (url.pathname === '/api/workflows') return send(response, 200, { items: workflows, watermark: 'legacy-workflows' });
    if (/^\/api\/workflows\/[^/]+$/.test(url.pathname)) return send(response, 200, { id: 'workflow', sourceHash: 'b'.repeat(64) });
    if (url.pathname === '/api/control/runs') return send(response, 200, { runs: options.projectedLists ? [
      { runRef: 'run-1', workflowId: 'workflow-1', status: 'done', startedAt: 'start', endedAt: 'end', secret: 'drop' },
    ] : [] });
    if (/^\/api\/control\/human-requests\/[^/]+$/.test(url.pathname)) {
      return send(response, 200, { requestRef: 'req-1', kind: options.humanRequestKind ?? 'question' });
    }
    if (url.pathname === '/api/schedules') return send(response, 200, { schedules: options.projectedLists ? [
      { scheduleId: 'schedule-1', name: 'Daily', cron: '0 9 * * *', cadence: 'daily', armed: true, nextRunAt: 'next', secret: 'drop' },
    ] : [], watermark: 'schedules:2' });
    if (url.pathname === '/api/inbox') return send(response, 200, { items: options.projectedLists ? [
      { requestRef: 'request-1', kind: 'question', title: 'Choose', createdAt: 'created', agentId: 'atlas', secret: 'drop' },
    ] : [] });
    if (url.pathname === '/api/kb/tree') return send(response, 200, { entries: [] });
    if (url.pathname === '/api/kb/file') {
      if (url.searchParams.get('path') === options.unreadableRepoPath) return send(response, 404, { error: 'not-found' });
      return send(response, 200, { path: url.searchParams.get('path'), content: 'readable' });
    }
    if (url.pathname === '/api/kb/history') return send(response, 200, { commits: options.projectedLists ? [
      { hash: 'abc123', message: 'Change', author: 'Agent', date: 'today', secret: 'drop' },
    ] : [] });
    if (url.pathname === '/api/brain/search') return send(response, 200, { matches: options.projectedLists ? [
      { path: 'README.md', line: 4, snippet: 'match', score: 0.9, secret: 'drop' },
    ] : [] });
    if (url.pathname === '/api/index') {
      if (options.largeIndex) return void await sendLargeIndex(response);
      if (options.indexWithoutSummary) return send(response, 200, {
        cards: { inbox: [{ id: 'c-1' }], done: [] }, agents: [{ id: 'a-1' }, { id: 'a-2' }],
        projects: [{ id: 'atlas-prep' }],
      });
      return send(response, 200, { ledgers: { grades: { rows: options.projectedLists ? [
        { cardId: 'card-1', worker: 'codex', action: 'build', score: 95, result: 'pass', createdAt: 'today', secret: 'drop' },
      ] : [] } } });
    }
    if (url.pathname === '/api/trace') return send(response, 200, {
      sessions: options.largeTrace
        ? Array.from({ length: 20 }, (_, index) => ({ id: index, text: 'x'.repeat(100) }))
        : options.projectedLists ? [{ sessionId: 'trace-1', title: 'Trace', agentId: 'atlas', messages: [{}, {}], secret: 'drop' }] : [],
    });
    if (url.pathname === '/api/pty/sessions') return send(response, 200, { sessions: options.projectedLists ? [
      { sessionId: 'term-1', name: 'Shell', status: 'idle', cwd: 'repo', owner: 'atlas', createdAt: 'today', secret: 'drop' },
    ] : [] });
    if (url.pathname === '/api/home' || url.pathname === '/api/health') return send(response, 200, {});
    return send(response, 404, { error: 'not-found' });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fake dashboard did not bind');
  return { origin: `http://127.0.0.1:${address.port}`, requests };
}

function config(origin: string, mutationsEnabled = true,
  overrides: Partial<BridgeConfig> & { maxResultBytes?: number } = {}): BridgeConfig {
  return {
    enabled: true, mutationsEnabled, origin, reviewProfiles: { standard: 'review-workflow' },
    requestTimeoutMs: 1000, maxResponseBytes: 1024 * 1024, maxIndexBytes: 16 * 1024 * 1024,
    maxResultBytes: 16 * 1024, ...overrides,
  } as BridgeConfig;
}

interface ClientOptions {
  mutationsEnabled?: boolean;
  config?: Partial<BridgeConfig>;
  logs?: string[];
  session?: boolean;
}

function clientFor(origin: string, options: ClientOptions = {}): DashboardClient {
  const client = new DashboardClient(config(origin, options.mutationsEnabled ?? true, options.config),
    options.logs ? (event, fields) => options.logs?.push(JSON.stringify({ event, fields })) : undefined);
  if (options.session !== false) client.setSession({ token: 'operator-token-123', expiresAt: Date.now() + 60_000 });
  return client;
}

describe('Atlas kb bridge', () => {
  it('negotiates the live legacy-only dashboard explicitly', async () => {
    const fake = await fakeDashboard({ mode: 'legacy' });
    const client = clientFor(fake.origin, { session: false });
    const capabilities = await client.capabilities();
    expect(capabilities.dashboardMode).toBe('legacy');
    expect(capabilities.families.agents.read).toBe('legacy');
    expect(capabilities.families.workflows.mutation).toBe('legacy');
    expect(capabilities.families.repo.read).toBe('legacy');
    await expect(new AtlasKbBridge(client).callTool('kb_agents_list', {})).resolves.toEqual({
      items: [], total: 0, offset: 0, limit: 20, next_offset: null,
    });
    expect(fake.requests.every((request) => request.authorization === undefined)).toBe(true);
  });

  it('requires a session for win32-desktop but keeps legacy probe 401s local', async () => {
    const v1 = await fakeDashboard({ mode: 'v1' });
    await expect(clientFor(v1.origin, { session: false }).capabilities()).rejects.toMatchObject({ code: 'session_required' });
    const legacy401 = await fakeDashboard({ mode: 'legacy', unauthorized: true });
    const capabilities = await clientFor(legacy401.origin, { session: false }).capabilities();
    expect(capabilities.families.agents).toMatchObject({ read: 'unavailable', reason: 'HTTP 401' });
    expect(capabilities.families.workflows).toMatchObject({ read: 'unavailable', reason: 'HTTP 401' });
  });

  it('negotiates exact v1 envelopes per family', async () => {
    const fake = await fakeDashboard({ mode: 'v1' });
    const capabilities = await clientFor(fake.origin).capabilities();
    expect(capabilities.dashboardMode).toBe('win32-desktop');
    expect(capabilities.families.agents).toMatchObject({ read: 'v1', mutation: 'v1' });
    expect(capabilities.families.schedules).toMatchObject({ read: 'v1', mutation: 'v1' });
    expect(capabilities.families.agent_launch.mutation).toBe('legacy');
  });

  it('rejects unknown v1 envelope versions without aborting legacy fallback', async () => {
    const fake = await fakeDashboard({ mode: 'unknown' });
    const capabilities = await clientFor(fake.origin).capabilities();
    expect(capabilities.families.agents.read).toBe('legacy');
    expect(capabilities.families.workflows.read).toBe('legacy');
  });

  it('applies the private session notification and injects only a bearer header', async () => {
    const fake = await fakeDashboard({ mode: 'legacy' });
    const client = new DashboardClient(config(fake.origin));
    applyAtlasSessionNotification(client, {
      method: 'notifications/atlas/session',
      params: { token: 'notification-token-123', expiresAt: Date.now() + 60_000 },
    });
    await client.capabilities();
    const runtime = fake.requests.find((request) => request.path === '/api/runtime/capabilities');
    expect(runtime?.authorization).toBe('Bearer notification-token-123');
    expect(JSON.stringify(await client.capabilities())).not.toContain('notification-token-123');
  });

  it('maps a route-level 401 to a content-free session_required error', async () => {
    const fake401 = await fakeDashboard({ mode: 'legacy', unauthorized: true });
    await expect(clientFor(fake401.origin).request('/api/agents', { requireSession: false }))
      .rejects.toMatchObject({ code: 'session_required', message: 'say: Atlas, unlock kb' });
  });

  it('rejects near-expiry sessions and installs an unrefed generation-safe expiry timer', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-27T00:00:00.000Z'));
    const seenAuthorization: Array<string | null> = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
      seenAuthorization.push(new Headers(init?.headers).get('authorization'));
      if (path === '/api/auth/context') return new Response(JSON.stringify({ mode: 'win32-desktop' }), { status: 200 });
      if (path === '/api/runtime/capabilities') return new Response('{}', { status: 200 });
      const kinds: Record<string, string> = {
        '/api/v1/health': 'health', '/api/v1/agents': 'agent-list', '/api/v1/workflows': 'workflow-list',
        '/api/v1/runs': 'run-list', '/api/v1/schedules': 'schedule-list', '/api/v1/inbox': 'inbox',
      };
      if (kinds[path]) {
        const watermark = path === '/api/v1/schedules' ? 'schedules:1' : 'a'.repeat(64);
        return new Response(JSON.stringify(envelope(kinds[path], [], { watermark })), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }) as unknown as typeof fetch;
    const client = new DashboardClient(config('http://dashboard.test'), undefined, fetchImpl);
    expect(() => client.setSession({ token: 'too-soon-token', expiresAt: Date.now() + 30_000 }))
      .toThrow(expect.objectContaining({ code: 'invalid_arguments' }));
    client.setSession({ token: 'first-session-token', expiresAt: Date.now() + 31_000 });
    expect((client as unknown as { sessionTimer: NodeJS.Timeout }).sessionTimer.hasRef()).toBe(false);
    await client.capabilities();
    await vi.advanceTimersByTimeAsync(1_000);
    client.setSession({ token: 'second-session-token', expiresAt: Date.now() + 60_000 });
    await client.capabilities();
    await vi.advanceTimersByTimeAsync(30_500);
    await client.capabilities();
    expect(seenAuthorization.at(-1)).toBe('Bearer second-session-token');
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(client.capabilities()).rejects.toMatchObject({ code: 'session_required' });
  });

  it('isolates a probe transport timeout to that route family', async () => {
    const fake = await fakeDashboard({ mode: 'v1', delayPath: '/api/trace' });
    const capabilities = await clientFor(fake.origin, { config: { requestTimeoutMs: 20 } }).capabilities();
    expect(capabilities.families.agents.read).toBe('v1');
    expect(capabilities.families.workflows.read).toBe('v1');
    expect(capabilities.families.traces.read).toBe('unavailable');
    expect(capabilities.families.traces.reason?.length).toBeLessThan(128);
  });

  it('uses status-only legacy probes and does not buffer a 5 MB body', async () => {
    const fake = await fakeDashboard({ mode: 'legacy', largeIndex: true });
    const capabilities = await clientFor(fake.origin, {
      session: false, config: { maxResponseBytes: 1024 },
    }).capabilities();
    expect(capabilities.families.analytics.read).toBe('legacy');
    expect(capabilities.families.grades.read).toBe('legacy');
  });

  it('treats runtime capability discovery as a status-only local probe', async () => {
    const fake = await fakeDashboard({ mode: 'legacy', largeResponsePath: '/api/runtime/capabilities' });
    const capabilities = await clientFor(fake.origin, {
      session: false, config: { maxResponseBytes: 40 },
    }).capabilities();
    expect(capabilities.runtime).toEqual({ available: true });
    expect(capabilities.families.agents.read).toBe('legacy');
  });

  it('reads only a bounded v1 envelope prefix before aborting a 5 MB body', async () => {
    const fake = await fakeDashboard({ mode: 'v1', largeV1ProbePath: '/api/v1/agents' });
    const capabilities = await clientFor(fake.origin, {
      config: { maxResponseBytes: 1024 },
    }).capabilities();
    expect(capabilities.families.agents).toMatchObject({ read: 'v1', mutation: 'unavailable' });
    expect(capabilities.families.workflows.read).toBe('v1');
  });

  it('keeps legacy 403 probes family-local with an HTTP 403 reason', async () => {
    const fake = await fakeDashboard({
      mode: 'legacy', forbiddenLegacyPaths: ['/api/control/runs', '/api/pty/sessions'],
    });
    const capabilities = await clientFor(fake.origin, { session: false }).capabilities();
    expect(capabilities.families.agents.read).toBe('legacy');
    expect(capabilities.families.runs).toMatchObject({ read: 'unavailable', reason: 'HTTP 403' });
    expect(capabilities.families.human_response).toMatchObject({ read: 'unavailable', reason: 'HTTP 403' });
    expect(capabilities.families.run_control).toMatchObject({ read: 'unavailable', reason: 'HTTP 403' });
    expect(capabilities.families.terminals).toMatchObject({ read: 'unavailable', reason: 'HTTP 403' });
  });

  it('streams a 5 MB legacy index and extracts only bounded summaries and grade rows', async () => {
    const fake = await fakeDashboard({ mode: 'legacy', largeIndex: true });
    const bridge = new AtlasKbBridge(clientFor(fake.origin, {
      session: false, config: { maxResponseBytes: 1024, maxResultBytes: 16 * 1024 },
    }));
    const grades = await bridge.callTool('kb_grades', { limit: 2 });
    expect(grades).toEqual({
      items: [{ worker: 'first' }, { worker: 'second' }], total: 3, offset: 0, limit: 2, next_offset: 2,
    });
    const snapshot = await bridge.callTool('kb_analytics_snapshot', {});
    expect(snapshot).toEqual({
      index: { generatedAt: '2026-08-27T00:00:00.000Z', summary: { agents: 3 } },
    });
    expect(JSON.stringify(grades)).not.toContain('ignored');
    expect(Buffer.byteLength(JSON.stringify(snapshot), 'utf8')).toBeLessThan(16 * 1024);
  });

  it('paginates and projects a 40-item legacy list into two stable pages', async () => {
    const fake = await fakeDashboard({ mode: 'legacy', listSize: 40 });
    const bridge = new AtlasKbBridge(clientFor(fake.origin, { session: false }));
    const first = await bridge.callTool('kb_workflows_list', { limit: 20, offset: 0 });
    const second = await bridge.callTool('kb_workflows_list', { limit: 20, offset: 20 });

    expect(first).toMatchObject({ total: 40, offset: 0, limit: 20, next_offset: 20 });
    expect(second).toMatchObject({ total: 40, offset: 20, limit: 20, next_offset: null });
    expect((first as { items: unknown[] }).items).toHaveLength(20);
    expect((second as { items: Array<Record<string, unknown>> }).items[0]).toEqual({
      id: 'workflow-20', title: 'Workflow 20', project: 'atlas-prep', profile: 'standard', riskTier: 'T2',
      launchable: true, valid: true, stageCount: 2, compileError: `${'x'.repeat(197)}...`,
    });
    expect(JSON.stringify(first)).not.toContain('privateDefinition');
  });

  it('drops trailing projected items under the result budget instead of replacing the page', async () => {
    const fake = await fakeDashboard({ mode: 'legacy', listSize: 40 });
    const bridge = new AtlasKbBridge(clientFor(fake.origin, {
      session: false, config: { maxResultBytes: 700 },
    }));
    const result = await bridge.callTool('kb_agents_list', { limit: 20, offset: 0 }) as {
      items: unknown[]; total: number; offset: number; limit: number; next_offset: number | null; truncated: boolean;
    };

    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.length).toBeLessThan(20);
    expect(result).toMatchObject({ total: 40, offset: 0, limit: 20, truncated: true });
    expect(result.next_offset).toBe(result.items.length);
    expect(result).not.toHaveProperty('bytes');
    expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThanOrEqual(700);
  });

  it('bounds every long string in get results while preserving their structure', async () => {
    const fake = await fakeDashboard({ mode: 'legacy', longGet: true });
    const bridge = new AtlasKbBridge(clientFor(fake.origin, { session: false }));
    const result = await bridge.callTool('kb_agent_get', { agent_id: 'agent' }) as {
      prompt: string; nested: { notes: string };
    };

    expect(result.prompt).toHaveLength(2000);
    expect(result.prompt.endsWith('...')).toBe(true);
    expect(result.nested.notes).toHaveLength(2000);
    expect(result.nested.notes.endsWith('...')).toBe(true);
    expect(result).toMatchObject({ id: 'agent', nested: {} });
  });

  it('falls back to bounded top-level index metrics when legacy summary keys are absent', async () => {
    const fake = await fakeDashboard({ mode: 'legacy', indexWithoutSummary: true });
    const bridge = new AtlasKbBridge(clientFor(fake.origin, { session: false }));
    const snapshot = await bridge.callTool('kb_analytics_snapshot', {});
    expect(snapshot).toEqual({ index: { keys: [
      { name: 'cards', elements: 2, bytes: 34 },
      { name: 'agents', elements: 2, bytes: 27 },
      { name: 'projects', elements: 1, bytes: 21 },
    ] } });
  });

  it('publishes limit and offset on every list-tool schema', async () => {
    const fake = await fakeDashboard({ mode: 'legacy' });
    const tools = new AtlasKbBridge(clientFor(fake.origin, { session: false })).tools();
    const names = [
      'kb_agents_list', 'kb_workflows_list', 'kb_runs_list', 'kb_inbox_list', 'kb_schedules_list',
      'kb_repo_history', 'kb_trace_list', 'kb_terminal_list', 'kb_grades', 'kb_repo_search',
    ];
    for (const name of names) {
      const schema = tools.find((tool) => tool.name === name)?.inputSchema as {
        properties: Record<string, unknown>;
      };
      expect(schema.properties).toHaveProperty('limit');
      expect(schema.properties).toHaveProperty('offset');
    }
  });

  it('uses the documented compact projection for every list tool', async () => {
    const fake = await fakeDashboard({ mode: 'legacy', listSize: 1, projectedLists: true });
    const bridge = new AtlasKbBridge(clientFor(fake.origin, { session: false }));
    const calls: Array<[string, Record<string, unknown>]> = [
      ['kb_agents_list', {}], ['kb_workflows_list', {}], ['kb_runs_list', {}], ['kb_inbox_list', {}],
      ['kb_schedules_list', {}], ['kb_repo_history', { path: 'README.md' }],
      ['kb_repo_search', { query: 'match' }], ['kb_grades', {}], ['kb_trace_list', {}], ['kb_terminal_list', {}],
    ];
    const expected = [
      ['id', 'displayName', 'role', 'working', 'current', 'ledger', 'cardCount', 'project', 'projects', 'shortRef'],
      ['id', 'title', 'project', 'profile', 'riskTier', 'launchable', 'valid', 'stageCount', 'compileError'],
      ['id', 'workflow', 'status', 'startedAt', 'endedAt'],
      ['id', 'kind', 'title', 'createdAt', 'agent'],
      ['id', 'name', 'cron', 'interval', 'armed', 'next'],
      ['id', 'message', 'author', 'date'], ['path', 'line', 'snippet', 'score'],
      ['id', 'worker', 'task', 'grade', 'status', 'timestamp'],
      ['id', 'title', 'agent', 'turns'], ['id', 'name', 'status', 'cwd', 'agent', 'startedAt'],
    ];

    for (const [index, [name, args]] of calls.entries()) {
      const result = await bridge.callTool(name, args) as { items: Array<Record<string, unknown>> };
      expect(result).toMatchObject({ total: 1, offset: 0, limit: 20, next_offset: null });
      expect(Object.keys(result.items[0])).toEqual(expected[index]);
      expect(JSON.stringify(result)).not.toContain('secret');
    }
    expect((await bridge.callTool('kb_agents_list', {}) as { items: Array<Record<string, unknown>> }).items[0].projects)
      .toEqual(['atlas-prep', 'kb-ops', 'third']);
    expect((await bridge.callTool('kb_workflows_list', {}) as { items: Array<Record<string, unknown>> }).items[0].compileError)
      .toBe(`${'x'.repeat(197)}...`);
  });

  it('maps the v1 workflow projection to the same voice-useful fields', async () => {
    const fake = await fakeDashboard({ mode: 'v1', projectedLists: true });
    const bridge = new AtlasKbBridge(clientFor(fake.origin));
    await expect(bridge.callTool('kb_workflows_list', {})).resolves.toMatchObject({ items: [{
      id: 'workflow-v1', title: 'V1 workflow', project: 'atlas-prep', profile: 'standard', riskTier: 'T2',
      launchable: true, valid: true, stageCount: 3, compileError: 'compile failed',
    }] });
  });

  it('enforces the dedicated index input cap independently of ordinary reads', async () => {
    const fake = await fakeDashboard({ mode: 'legacy', largeIndex: true });
    const bridge = new AtlasKbBridge(clientFor(fake.origin, {
      session: false, config: { maxResponseBytes: 1024, maxIndexBytes: 1024 },
    }));
    await expect(bridge.callTool('kb_grades', {})).rejects.toMatchObject({ code: 'response_too_large' });
  });

  it('stops reading a response stream as soon as the byte cap is crossed', async () => {
    let pulls = 0;
    const fetchImpl = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(Buffer.alloc(32, 120));
        if (pulls === 4) controller.close();
      },
    }), { status: 200 })) as unknown as typeof fetch;
    const client = new DashboardClient(config('http://dashboard.test', true, { maxResponseBytes: 40 }), undefined, fetchImpl);
    await expect(client.request('/large', { requireSession: false })).rejects.toMatchObject({ code: 'response_too_large' });
    expect(pulls).toBeLessThan(4);
  });

  it('caps every final list result by trimming items without losing pagination', async () => {
    const fake = await fakeDashboard({ mode: 'legacy', largeTrace: true });
    const bridge = new AtlasKbBridge(clientFor(fake.origin, {
      session: false, config: { maxResultBytes: 128 } as Partial<BridgeConfig>,
    }));
    const result = await bridge.callTool('kb_trace_list', { limit: 20 });
    expect(result).toMatchObject({ items: expect.any(Array), offset: 0, limit: 20, truncated: true });
    expect(result).toHaveProperty('next_offset');
    expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThanOrEqual(128);
  });

  it('never exposes secret-bearing 500 bodies in logs or errors', async () => {
    const fake = await fakeDashboard({ mode: 'legacy', secret500Path: '/api/agents/a/launch' });
    const logs: string[] = [];
    const bridge = new AtlasKbBridge(clientFor(fake.origin, { logs }));
    let caught: unknown;
    try {
      await bridge.callTool('kb_agent_launch', {
        agent_id: 'a', expected_source_revision: 'a'.repeat(64), idempotency_key: 'agent-launch-0001',
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(BridgeError);
    expect(JSON.stringify(caught)).not.toContain('x-super-secret');
    expect(logs.join('\n')).not.toContain('x-super-secret');
    expect(logs.join('\n')).not.toContain('Bearer x');
  });

  it('registers mutations only under the dormancy flag and labels every tool', async () => {
    const fake = await fakeDashboard({ mode: 'legacy' });
    const readOnly = new AtlasKbBridge(clientFor(fake.origin, { mutationsEnabled: false }));
    expect(readOnly.tools().every((tool) => tool.description.startsWith('READ '))).toBe(true);
    const enabled = new AtlasKbBridge(clientFor(fake.origin));
    expect(enabled.tools().every((tool) => /^(READ|MUTATION) /.test(tool.description))).toBe(true);
    expect(enabled.tools().some((tool) => tool.name === 'kb_agent_create')).toBe(true);
  });

  it('publishes recursively closed mutation schemas and rejects forbidden create fields before HTTP', async () => {
    const fake = await fakeDashboard({ mode: 'v1' });
    const bridge = new AtlasKbBridge(clientFor(fake.origin));
    const assertClosed = (schema: unknown): void => {
      if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) return;
      const item = schema as Record<string, unknown>;
      if (item.type === 'object') expect(item.additionalProperties).toBe(false);
      if (item.properties && typeof item.properties === 'object') {
        for (const child of Object.values(item.properties as Record<string, unknown>)) assertClosed(child);
      }
      if (item.items) assertClosed(item.items);
    };
    for (const tool of bridge.tools().filter((tool) => tool.description.startsWith('MUTATION '))) {
      assertClosed(tool.inputSchema);
    }
    for (const extra of [{ env: { API_KEY: 'x' } }, { command: 'do-dangerous-work' }]) {
      await expect(bridge.callTool('kb_agent_create', {
        definition: { name: 'a' }, expected_collection_revision: 'a'.repeat(64),
        idempotency_key: 'closed-create-0001', ...extra,
      })).rejects.toMatchObject({ code: 'invalid_arguments' });
    }
    expect(fake.requests).toHaveLength(0);
  });

  it('keeps v1 reads but disables mutations when that family metadata has the wrong revision domain', async () => {
    const fake = await fakeDashboard({ mode: 'v1', malformedMutationFamily: 'workflows' });
    const capabilities = await clientFor(fake.origin).capabilities();
    expect(capabilities.families.workflows).toMatchObject({ read: 'v1', mutation: 'unavailable' });
    expect(capabilities.families.workflow_launch).toMatchObject({ read: 'v1', mutation: 'unavailable' });
  });

  it('rejects non-canonical repository paths before any HTTP request', async () => {
    const fake = await fakeDashboard({ mode: 'legacy' });
    const bridge = new AtlasKbBridge(clientFor(fake.origin, { session: false }));
    const invalid = ['/absolute', 'C:/drive', 'dir\\file', 'dir//file', 'dir/../file', 'dir\0file'];
    for (const path of invalid) {
      await expect(bridge.callTool('kb_repo_tree', { path })).rejects.toMatchObject({ code: 'invalid_arguments' });
      await expect(bridge.callTool('kb_repo_file', { path })).rejects.toMatchObject({ code: 'invalid_arguments' });
      await expect(bridge.callTool('kb_repo_history', { path })).rejects.toMatchObject({ code: 'invalid_arguments' });
    }
    expect(fake.requests).toHaveLength(0);
  });

  it('returns a content-free typed error when a listed repo path is not readable', async () => {
    const fake = await fakeDashboard({ mode: 'legacy', unreadableRepoPath: 'outside/file.md' });
    const bridge = new AtlasKbBridge(clientFor(fake.origin, { session: false }));
    await expect(bridge.callTool('kb_repo_file', { path: 'outside/file.md' })).rejects.toMatchObject({
      code: 'path_not_readable',
      message: 'that path is outside the readable roots or does not exist',
    });
  });

  it('passes list-emitted legacy refs through workflow and agent detail and launch routes', async () => {
    const fake = await fakeDashboard({ mode: 'legacy', listSize: 1 });
    const bridge = new AtlasKbBridge(clientFor(fake.origin, { session: false }));
    const workflows = await bridge.callTool('kb_workflows_list', {}) as { items: Array<{ id: string }> };
    const agents = await bridge.callTool('kb_agents_list', {}) as { items: Array<{ id: string }> };
    await bridge.callTool('kb_workflow_get', { workflow_id: workflows.items[0].id });
    await bridge.callTool('kb_agent_get', { agent_id: agents.items[0].id });
    await bridge.callTool('kb_workflow_launch', {
      workflow_id: workflows.items[0].id, expected_source_revision: 'revision-5',
      idempotency_key: 'workflow-ref-launch-0001',
    });
    expect(fake.requests).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: 'GET', path: '/api/workflows/workflow-0' }),
      expect.objectContaining({ method: 'GET', path: '/api/agents/agent-0' }),
      expect.objectContaining({
        method: 'POST', path: '/api/workflows/workflow-0/launch',
        body: expect.objectContaining({ workflowId: 'workflow-0' }),
      }),
    ]));
  });

  it('sends CAS fields and matching header/body idempotency keys for every mutation tool', async () => {
    const fake = await fakeDashboard({ mode: 'v1' });
    const bridge = new AtlasKbBridge(clientFor(fake.origin));
    const key = (name: string) => `${name}-000000000001`;
    await bridge.callTool('kb_agent_create', { definition: { name: 'a' }, expected_collection_revision: 'r1', idempotency_key: key('agent-create') });
    await bridge.callTool('kb_agent_update', { agent_id: 'a', definition: { name: 'a2' }, expected_source_revision: 'r2', idempotency_key: key('agent-update') });
    await bridge.callTool('kb_workflow_create', { definition: { name: 'w' }, expected_collection_revision: 'r3', idempotency_key: key('workflow-create') });
    await bridge.callTool('kb_workflow_update', { workflow_id: 'w', definition: { name: 'w2' }, expected_source_revision: 'r4', idempotency_key: key('workflow-update') });
    await bridge.callTool('kb_workflow_launch', { workflow_id: 'w', expected_source_revision: 'r5', idempotency_key: key('workflow-launch') });
    await bridge.callTool('kb_agent_launch', { agent_id: 'a', expected_source_revision: 'r6', idempotency_key: key('agent-launch') });
    await bridge.callTool('kb_human_respond', { run_ref: 'run-1', request_ref: 'req-1', request_kind: 'question', expected_revision: 2, decision: 'responded', response: 'yes', idempotency_key: key('human-respond') });
    await bridge.callTool('kb_review_dispatch', { review_profile: 'standard', target_ref: 'target-1', idempotency_key: key('review-dispatch') });
    await bridge.callTool('kb_schedule_create', { owner: 'daniel', cadence: 'daily', expected_collection_revision: 'schedules:4', idempotency_key: key('schedule-create') });
    await bridge.callTool('kb_schedule_set_armed', { schedule_id: 's-1', armed: true, expected_version: 1, idempotency_key: key('schedule-arm') });
    await bridge.callTool('kb_schedule_delete', { schedule_id: 's-1', expected_version: 2, idempotency_key: key('schedule-delete') });
    await bridge.callTool('kb_run_control', { run_ref: 'run-1', action: 'cancel', expected_run_version: 3, expected_manager_generation: 1, idempotency_key: key('run-cancel') });

    const mutations = fake.requests.filter((request) => request.method !== 'GET');
    expect(mutations).toHaveLength(12);
    for (const request of mutations) {
      expect(request.idempotencyKey).toBe(request.body?.idempotencyKey);
      expect(Object.keys(request.body ?? {}).some((field) => field.startsWith('expected'))).toBe(true);
    }
  });

  it('does not switch to v1 after an ambiguous legacy mutation timeout', async () => {
    const fake = await fakeDashboard({ mode: 'legacy', delayMutationPath: '/api/agents' });
    const bridge = new AtlasKbBridge(clientFor(fake.origin, { config: { requestTimeoutMs: 20 } }));
    await expect(bridge.callTool('kb_agent_create', {
      definition: { name: 'a' }, expected_collection_revision: 'r1', idempotency_key: 'timeout-create-0001',
    })).rejects.toMatchObject({ code: 'dashboard_unavailable' });
    const mutations = fake.requests.filter((request) => request.method !== 'GET');
    expect(mutations.map((request) => request.path)).toEqual(['/api/agents']);
  });

  it('uses the authoritative request kind and refuses T3 without sending a mutation', async () => {
    const fake = await fakeDashboard({ mode: 'v1', humanRequestKind: 'approval' });
    const bridge = new AtlasKbBridge(clientFor(fake.origin));
    await expect(bridge.callTool('kb_human_respond', {
      run_ref: 'run-1', request_ref: 'req-1', request_kind: 'question', expected_revision: 1,
      decision: 'responded', idempotency_key: 'approval-refuse-001',
    })).rejects.toMatchObject({ code: 't3_requires_dashboard' });
    expect(fake.requests.filter((request) => request.method !== 'GET')).toHaveLength(0);
  });

  it('refuses review profiles outside the package allow-list', async () => {
    const fake = await fakeDashboard({ mode: 'v1' });
    const bridge = new AtlasKbBridge(clientFor(fake.origin));
    await expect(bridge.callTool('kb_review_dispatch', {
      review_profile: 'unmapped', target_ref: 'target-1', idempotency_key: 'review-refuse-0001',
    })).rejects.toMatchObject({ code: 'review_profile_refused' });
    expect(fake.requests.filter((request) => request.method !== 'GET')).toHaveLength(0);
  });
});
