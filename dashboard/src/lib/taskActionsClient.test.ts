/**
 * U2 — taskActionsClient: drives explicit Inbox card verify/reply/resolve POSTs.
 */
import { describe, expect, it, vi } from 'vitest';
import { respondToCard, verifyApproval } from './taskActionsClient';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

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
