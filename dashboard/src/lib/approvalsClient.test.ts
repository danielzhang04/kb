/**
 * U2 — approvalsClient: reads the live pending feed and drives an explicit verify POST.
 */
import { describe, expect, it, vi } from 'vitest';
import { fetchHumanInbox, fetchPending, respondToCard, verifyApproval } from './approvalsClient';
import type { ParsedCard } from '../../server/planeA/cards';

function card(id: string): ParsedCard {
  return {
    meta: { id, project: 'kb', action: 'a', target: 't', 'risk-tier': 'T3', owner: null, state: 'approvals' },
    body: '## Work order\n\nx\n',
  };
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

describe('fetchPending', () => {
  it('maps the /api/approvals payload to the pending cards', async () => {
    const fake = vi.fn(async () => jsonResponse({ pending: [{ card: card('c1'), buttons: {} }, { card: card('c2'), buttons: {} }] }));
    const cards = await fetchPending(fake as unknown as typeof fetch);
    expect(fake).toHaveBeenCalledWith('/api/approvals', { headers: { accept: 'application/json' } });
    expect(cards.map((c) => c.meta.id)).toEqual(['c1', 'c2']);
  });

  it('throws on a non-2xx response', async () => {
    const fake = vi.fn(async () => jsonResponse({}, false, 500));
    await expect(fetchPending(fake as unknown as typeof fetch)).rejects.toThrow(/500/);
  });
});

describe('fetchHumanInbox', () => {
  it('reads the unified attention feed and counts', async () => {
    const payload = {
      items: [{ card: card('c1'), category: 'decision', categoryLabel: 'Decision', urgency: 'high', status: 'waiting', reason: 'gate', nextAction: 'verify', context: 'x' }],
      counts: { total: 1, decision: 1, input: 0, intervention: 0 },
    };
    const fake = vi.fn(async () => jsonResponse(payload));
    const result = await fetchHumanInbox(fake as unknown as typeof fetch);
    expect(fake).toHaveBeenCalledWith('/api/human-inbox', { headers: { accept: 'application/json' } });
    expect(result.counts.total).toBe(1);
    expect(result.items[0].category).toBe('decision');
  });
});

describe('verifyApproval', () => {
  it('POSTs cardId+channel with the session bearer', async () => {
    const fake = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ ok: true, reason: 'verified' }));
    const res = await verifyApproval('card-77', 'webauthn', { token: 'sess-tok', fetchImpl: fake as unknown as typeof fetch });
    expect(res).toMatchObject({ ok: true, status: 200 });
    const [url, init] = fake.mock.calls[0];
    expect(url).toBe('/api/approvals/verify');
    expect(init!.method).toBe('POST');
    expect((init!.headers as Record<string, string>).authorization).toBe('Bearer sess-tok');
    expect(JSON.parse(init!.body as string)).toEqual({ cardId: 'card-77', channel: 'webauthn' });
  });

  it('surfaces a 401 (no session) as ok:false rather than throwing', async () => {
    const fake = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ error: 'unauthenticated' }, false, 401));
    const res = await verifyApproval('card-77', 'signed', { fetchImpl: fake as unknown as typeof fetch });
    expect(res).toMatchObject({ ok: false, status: 401 });
    // No bearer header when there is no session.
    const [, init] = fake.mock.calls[0];
    expect((init!.headers as Record<string, string>).authorization).toBeUndefined();
  });
});

describe('respondToCard', () => {
  it('POSTs cardId+action+message to the governed route with the session bearer', async () => {
    const fake = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ ok: true, state: 'done' }));
    const res = await respondToCard('wake-1', 'resolve', 'restarted', { token: 'sess-tok', fetchImpl: fake as unknown as typeof fetch });
    expect(res).toMatchObject({ ok: true, status: 200 });
    const [url, init] = fake.mock.calls[0];
    expect(url).toBe('/api/write/card-respond');
    expect(init!.method).toBe('POST');
    expect((init!.headers as Record<string, string>).authorization).toBe('Bearer sess-tok');
    expect(JSON.parse(init!.body as string)).toEqual({ cardId: 'wake-1', action: 'resolve', message: 'restarted' });
  });

  it('surfaces a 409 refusal reason as ok:false rather than throwing', async () => {
    const fake = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ error: 'card-respond-refused', reason: 'cannot reply to a wake-me card' }, false, 409));
    const res = await respondToCard('wake-1', 'reply', 'hi', { token: 't', fetchImpl: fake as unknown as typeof fetch });
    expect(res).toMatchObject({ ok: false, status: 409, reason: 'cannot reply to a wake-me card' });
  });
});
