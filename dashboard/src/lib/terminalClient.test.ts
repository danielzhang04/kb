// @vitest-environment jsdom
/**
 * Unit tests for the persistent-terminal client glue: fetch bearer wiring + safe fallbacks, the storage
 * round-trip, and the reconcile ordering used to restore tabs on mount. No real network; `fetch` and
 * `Storage` are injected.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deletePtySession,
  listPtySessions,
  loadStoredTabs,
  reconcileSessions,
  saveStoredTabs,
} from './terminalClient';
import type { PtySessionSummary } from './terminalClient';

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('listPtySessions', () => {
  it('sends the bearer and returns the sessions on 200', async () => {
    const sessions: PtySessionSummary[] = [{ sessionId: 'pty-1', createdAt: 1, attached: true }];
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ sessions }), { status: 200 }));
    const out = await listPtySessions('tok', fetchImpl as unknown as typeof fetch);
    expect(out).toEqual(sessions);
    expect(fetchImpl).toHaveBeenCalledWith('/api/pty/sessions', {
      headers: { authorization: 'Bearer tok', accept: 'application/json' },
    });
  });

  it('returns [] on a non-2xx (e.g. expired session → 401) rather than throwing', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 401 }));
    expect(await listPtySessions('tok', fetchImpl as unknown as typeof fetch)).toEqual([]);
  });

  it('returns [] when fetch itself rejects', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    });
    expect(await listPtySessions('tok', fetchImpl as unknown as typeof fetch)).toEqual([]);
  });
});

describe('deletePtySession', () => {
  it('issues a bearer DELETE against the encoded id', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 200 }));
    await deletePtySession('pty-1', 'tok', fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledWith('/api/pty/sessions/pty-1', {
      method: 'DELETE',
      headers: { authorization: 'Bearer tok' },
    });
  });
});

describe('storage round-trip', () => {
  it('saves and loads only session ids, tolerating garbage', () => {
    saveStoredTabs([{ sessionId: 'pty-a' }, { sessionId: 'pty-b' }]);
    expect(loadStoredTabs()).toEqual([{ sessionId: 'pty-a' }, { sessionId: 'pty-b' }]);

    localStorage.setItem('kb-terminal-tabs-v1', 'not json');
    expect(loadStoredTabs()).toEqual([]);
    localStorage.setItem('kb-terminal-tabs-v1', JSON.stringify([{ nope: 1 }, { sessionId: 'pty-c' }]));
    expect(loadStoredTabs()).toEqual([{ sessionId: 'pty-c' }]);
  });
});

describe('reconcileSessions', () => {
  it('keeps live remembered ids in order, drops dead ones, and appends unremembered live sessions', () => {
    const stored = [{ sessionId: 'pty-live' }, { sessionId: 'pty-dead' }];
    const live: PtySessionSummary[] = [
      { sessionId: 'pty-live', createdAt: 1, attached: false },
      { sessionId: 'pty-new', createdAt: 2, attached: false },
    ];
    expect(reconcileSessions(stored, live)).toEqual(['pty-live', 'pty-new']);
  });

  it('is [] when nothing is live', () => {
    expect(reconcileSessions([{ sessionId: 'pty-x' }], [])).toEqual([]);
  });
});
