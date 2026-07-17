import { describe, it, expect, vi } from 'vitest';
import { fetchRouting, postRoutingOverride, postCardRouting, EMPTY_ROUTING } from './routingClient';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

describe('fetchRouting', () => {
  it('GETs /api/routing and returns the parsed snapshot', async () => {
    const snap = { ...EMPTY_ROUTING, agents: [{ id: 'w', effective: { runtime: 'claude', model: 'x', sourceRuntime: 'policy', sourceModel: 'policy' } }] };
    const fetchImpl = vi.fn(async () => jsonResponse(snap));
    const out = await fetchRouting(fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledWith('/api/routing');
    expect(out.agents[0].id).toBe('w');
  });

  it('throws on a non-ok response', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, false, 500));
    await expect(fetchRouting(fetchImpl as unknown as typeof fetch)).rejects.toThrow();
  });
});

describe('postRoutingOverride', () => {
  it('POSTs the set body with the WebAuthn bearer', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ ok: true }));
    const res = await postRoutingOverride(
      { op: 'set', scope: 'agent', key: 'codex-worker', runtime: 'codex', model: 'gpt-5-codex', expires: null },
      'TOKEN',
      fetchImpl as unknown as typeof fetch,
    );
    expect(res.ok).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('/api/write/routing-override');
    expect(init!.method).toBe('POST');
    expect((init!.headers as Record<string, string>).authorization).toBe('Bearer TOKEN');
    expect(JSON.parse(init!.body as string)).toMatchObject({ op: 'set', scope: 'agent', key: 'codex-worker' });
  });

  it('surfaces a refusal reason on a non-ok response', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ reason: 'invalid session' }, false, 401));
    const res = await postRoutingOverride({ op: 'clear', scope: 'agent', key: 'w' }, 'T', fetchImpl as unknown as typeof fetch);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('invalid session');
  });
});

describe('postCardRouting', () => {
  it('POSTs the card set body with the bearer', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ ok: true }));
    await postCardRouting({ op: 'set', cardId: 'card-1', runtime: 'codex', model: 'gpt-5-codex' }, 'T', fetchImpl as unknown as typeof fetch);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('/api/write/card-routing');
    expect((init!.headers as Record<string, string>).authorization).toBe('Bearer T');
  });
});
