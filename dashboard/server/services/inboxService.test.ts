// P6 W2 — characterization of `GET /api/inbox`'s extracted service: the closed `?refresh=` decode, the
// per-source invalidation, and the composed 200 body, all over injected fakes (no real `gh`/tree).

import { describe, expect, it, vi } from 'vitest';
import { readInboxRoute, type InboxServicePort } from './inboxService.ts';

function port(over: Partial<InboxServicePort> = {}): InboxServicePort {
  return {
    invalidatePr: vi.fn(),
    invalidateBudget: vi.fn(),
    readInbox: vi.fn(async () => ({ items: [], sources: {} })),
    ...over,
  };
}

describe('inboxService', () => {
  it('composes the inbox with no refresh and no invalidation', async () => {
    const p = port();
    const out = await readInboxRoute(p, undefined);
    expect(out).toEqual({ status: 200, body: { items: [], sources: {} } });
    expect(p.invalidatePr).not.toHaveBeenCalled();
    expect(p.invalidateBudget).not.toHaveBeenCalled();
  });

  it('invalidates only the PR cache on ?refresh=pr', async () => {
    const p = port();
    await readInboxRoute(p, 'pr');
    expect(p.invalidatePr).toHaveBeenCalledOnce();
    expect(p.invalidateBudget).not.toHaveBeenCalled();
  });

  it('invalidates the named budget slot on ?refresh=deployment|assetPull', async () => {
    const p = port();
    await readInboxRoute(p, 'assetPull');
    expect(p.invalidateBudget).toHaveBeenCalledWith('assetPull');
    expect(p.invalidatePr).not.toHaveBeenCalled();
  });

  it('does not invalidate on ?refresh=escalation but still composes', async () => {
    const p = port();
    const out = await readInboxRoute(p, 'escalation');
    expect(out.status).toBe(200);
    expect(p.invalidatePr).not.toHaveBeenCalled();
    expect(p.invalidateBudget).not.toHaveBeenCalled();
  });

  it('refuses 400 bad-refresh with the decoder reason on any other value', async () => {
    const p = port();
    const out = await readInboxRoute(p, 'nonsense');
    expect(out.status).toBe(400);
    expect((out.body as { error: string }).error).toBe('bad-refresh');
    expect((out.body as { reason: string }).reason).toContain('refresh');
    expect(p.readInbox).not.toHaveBeenCalled();
  });
});
