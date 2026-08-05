// @vitest-environment jsdom
/**
 * Unit tests for the persistent-terminal client glue: fetch bearer wiring + safe fallbacks, the storage
 * round-trip, and the reconcile ordering used to restore tabs on mount. No real network; `fetch` and
 * `Storage` are injected.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  archiveSessionRun,
  deletePtySession,
  fetchSessionRun,
  listPtySessions,
  listSessionRuns,
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

/**
 * Session runs (leg 2). The bearer wiring is the same as the session endpoints'; what is new is the
 * refusal handling: a dismissal that the server refused must come back as WORDS the surface can show,
 * because a Dismiss button that silently did nothing would read as success.
 */
describe('session-run client', () => {
  it('lists with the bearer, and asks for archived records only when told to', async () => {
    const sessionRuns = [{ sessionRunRef: 'srun-1', kind: 'agent', targetRef: 'a' }];
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ sessionRuns }), { status: 200 }));
    const out = await listSessionRuns('tok', {}, fetchImpl as unknown as typeof fetch);
    expect(out).toEqual(sessionRuns);
    expect(fetchImpl).toHaveBeenCalledWith('/api/pty/session-runs', {
      headers: { authorization: 'Bearer tok', accept: 'application/json' },
    });

    await listSessionRuns('tok', { includeArchived: true }, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenLastCalledWith('/api/pty/session-runs?includeArchived=1', expect.anything());
  });

  it('degrades to an empty list on a refusal or a network failure', async () => {
    const unauthorized = vi.fn(async () => new Response('{}', { status: 401 }));
    expect(await listSessionRuns('tok', {}, unauthorized as unknown as typeof fetch)).toEqual([]);
    const broken = vi.fn(async () => { throw new Error('offline'); });
    expect(await listSessionRuns('tok', {}, broken as unknown as typeof fetch)).toEqual([]);
  });

  it('fetches one session run with its transcript, and null on any failure', async () => {
    const body = { sessionRun: { sessionRunRef: 'srun-1' }, transcript: { text: 'hi', bytes: 2, truncated: false } };
    const ok = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    expect(await fetchSessionRun('srun-1', 'tok', ok as unknown as typeof fetch)).toMatchObject(body);
    expect(ok).toHaveBeenCalledWith('/api/pty/session-runs/srun-1', {
      headers: { authorization: 'Bearer tok', accept: 'application/json' },
    });
    const missing = vi.fn(async () => new Response('{}', { status: 404 }));
    expect(await fetchSessionRun('srun-1', 'tok', missing as unknown as typeof fetch)).toBeNull();
  });

  it('archives with an idempotency key and reports a live-session refusal in plain words', async () => {
    const archived = { sessionRunRef: 'srun-1', outcome: 'archived' };
    const ok = vi.fn(async () => new Response(JSON.stringify({ ok: true, sessionRun: archived, replayed: false }), { status: 200 }));
    const result = await archiveSessionRun('srun-1', 'tok', { idempotencyKey: 'key-1', reason: 'done' }, ok as unknown as typeof fetch);
    expect(result).toMatchObject({ ok: true, replayed: false });
    expect(ok).toHaveBeenCalledWith('/api/pty/session-runs/srun-1/archive', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ idempotencyKey: 'key-1', reason: 'done' }),
    }));

    const live = vi.fn(async () => new Response(JSON.stringify({ error: 'session-run-live' }), { status: 409 }));
    const refused = await archiveSessionRun('srun-1', 'tok', { idempotencyKey: 'key-1' }, live as unknown as typeof fetch);
    expect(refused).toEqual({ ok: false, reason: 'This session is still running. End it first, then dismiss it.' });
  });
});
