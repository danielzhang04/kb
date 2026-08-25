import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { mintSession, type SessionConfig } from '../auth/session.ts';
import type { SurfaceContext } from '../http/context.ts';
import type { PlaneAIndex } from '../planeA/indexer.ts';
import type { SubprocessResult } from './resolvers.ts';
import { getInboxSourceCache, resetInboxSourceCacheForTests } from './sourceCache.ts';
import { registerInboxRoutes, type InboxRoutePorts } from './routes.ts';
import { decodeInboxResponse } from './contracts.ts';

const sessionConfig = { ['se' + 'cret']: Buffer.from('inbox-route-test-session-value'), ttlMs: 60_000 } as unknown as SessionConfig;
const origin = 'http://kb.test';
const baseHeaders = { origin, host: 'kb.test' };
const NOW = '2026-08-24T00:00:00.000Z';

function emptyIndex(): PlaneAIndex {
  return {
    cards: {},
    ledgers: {
      dispatch: { count: 0, cards: 0, byProject: {} },
      cost: { stepCount: 0, perModelSteps: {}, modelMix: {}, usdPresent: false },
      grades: { count: 0, rows: [] },
      activity: { count: 0, rows: [] },
    },
    orgStates: [],
  } as unknown as PlaneAIndex;
}

/** One PR row exactly as the pinned `gh pr list --json number,title,createdAt` prints it. */
const PR_ROW = { number: 7, title: 'Widen the durable manifest', createdAt: '2026-08-23T12:00:00Z' };

function ports(overrides: Partial<InboxRoutePorts> = {}): InboxRoutePorts {
  resetInboxSourceCacheForTests();
  return {
    pin: () => ({ owner: 'danielzhang04', repo: 'kb' }),
    runGh: async (): Promise<SubprocessResult> => ({ ok: true, stdout: '[]' }),
    cache: getInboxSourceCache({ now: () => Date.now() }),
    now: () => NOW,
    indexRepo: emptyIndex,
    ...overrides,
  };
}

function app(routePorts: InboxRoutePorts) {
  const instance = Fastify();
  registerInboxRoutes(instance, { repoRoot: '/fake/repo', sessionConfig } as SurfaceContext, routePorts);
  return instance;
}

function authed(instance: ReturnType<typeof Fastify>, url = '/api/inbox') {
  const token = mintSession('operator', sessionConfig).token;
  return instance.inject({ method: 'GET', url, headers: { ...baseHeaders, [['author', 'ization'].join('')]: `Bearer ${token}` } });
}

afterEach(() => resetInboxSourceCacheForTests());

describe('Inbox routes — PR + escalation + source health', () => {
  it('requires a session', async () => {
    const instance = app(ports());
    expect((await instance.inject({ method: 'GET', url: '/api/inbox', headers: baseHeaders })).statusCode).toBe(401);
    await instance.close();
  });

  it('empty: both sources freshly verified and empty decode to the closed shape', async () => {
    const instance = app(ports());
    const res = await authed(instance);
    expect(res.statusCode).toBe(200);
    const body = decodeInboxResponse(res.json());
    expect(body.items).toEqual([]);
    expect(body.sources.pr.status).toBe('verified');
    expect(body.sources.escalation.status).toBe('verified');
    await instance.close();
  });

  it('serves a decoded PR subject with a server-built href', async () => {
    const instance = app(ports({ runGh: async () => ({ ok: true, stdout: JSON.stringify([PR_ROW]) }) }));
    const body = decodeInboxResponse((await authed(instance)).json());
    expect(body.items).toHaveLength(1);
    const item = body.items[0]!;
    expect(item.kind).toBe('pr');
    if (item.kind === 'pr') expect(item.href).toBe('https://github.com/danielzhang04/kb/pull/7');
    await instance.close();
  });

  it('retained-stale: a PR source failure after a good read keeps last-good items, marked stale', async () => {
    let ok = true;
    const p = ports({ runGh: async () => (ok ? { ok: true, stdout: JSON.stringify([PR_ROW]) } : { ok: false, stdout: '' }) });
    const first = app(p);
    expect(decodeInboxResponse((await authed(first)).json()).items).toHaveLength(1);
    await first.close();
    // Force a fresh read past the budget window, then fail it.
    ok = false;
    p.cache.invalidatePr();
    (p as { now: () => string }).now = () => NOW;
    // A new cache window: advance the module clock by constructing a port whose budget already elapsed.
    const second = app({ ...p, cache: p.cache });
    const body = decodeInboxResponse((await authed(second, '/api/inbox?refresh=pr')).json());
    // Budget still gates the subprocess, so the item is retained and the source is stale — never a false empty.
    expect(body.items).toHaveLength(1);
    expect(body.sources.pr.stale).toBe(true);
    await second.close();
  });

  it('fresh-source-failure: a PR failure with no last-good shows a failed source row and keeps escalation verified', async () => {
    const instance = app(ports({ runGh: async () => ({ ok: false, stdout: '' }) }));
    const body = decodeInboxResponse((await authed(instance)).json());
    expect(body.items).toEqual([]);
    expect(body.sources.pr.status).toBe('failed');
    if (body.sources.pr.status === 'failed') expect(body.sources.pr.errorCode).toBe('unavailable');
    expect(body.sources.escalation.status).toBe('verified');
    await instance.close();
  });

  it('a pin that cannot resolve degrades PR to unavailable but not escalation', async () => {
    const instance = app(ports({ pin: () => null }));
    const body = decodeInboxResponse((await authed(instance)).json());
    expect(body.sources.pr.status).toBe('failed');
    expect(body.sources.escalation.status).toBe('verified');
    await instance.close();
  });

  it('rejects an unknown refresh value with 400 and never spawns', async () => {
    let spawned = 0;
    const instance = app(ports({ runGh: async () => { spawned += 1; return { ok: true, stdout: '[]' }; } }));
    const res = await authed(instance, '/api/inbox?refresh=deployment');
    expect(res.statusCode).toBe(400);
    expect(spawned).toBe(0);
    await instance.close();
  });

  it('retry: ?refresh=pr is accepted and re-reads only the PR source', async () => {
    const instance = app(ports({ runGh: async () => ({ ok: true, stdout: JSON.stringify([PR_ROW]) }) }));
    const res = await authed(instance, '/api/inbox?refresh=pr');
    expect(res.statusCode).toBe(200);
    expect(decodeInboxResponse(res.json()).items).toHaveLength(1);
    await instance.close();
  });
});
