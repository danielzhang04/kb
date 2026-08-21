// @vitest-environment jsdom
/**
 * `useAttachableSession` — the lookup that decides ATTACH vs SPAWN for an embedded console.
 *
 * The hook is the difference between an agent's detail reattaching to the shell it already started and
 * quietly opening a new one every time the operator switches tabs. So these tests pin the matching rule
 * hard: kind AND ref, never one or the other, and never a shell or a plain-claude session that happens
 * to be lying around.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

import { sessionMatchesSpec, spawnForSpec, useAttachableSession } from './useAttachableSession';
import type { PtySessionSummary, TerminalSessionsClient } from '../lib/terminalClient';
import { clearStoredSession, persistSession } from '../lib/authClient';
import { TestSessionProvider } from '../test/session';

function client(live: PtySessionSummary[] = []): TerminalSessionsClient & { list: ReturnType<typeof vi.fn> } {
  return { list: vi.fn(async () => live), remove: vi.fn(async () => {}) };
}

function summary(over: Partial<PtySessionSummary> & { sessionId: string }): PtySessionSummary {
  return { createdAt: 1, attached: false, kind: 'shell', targetRef: null, ...over };
}

/** Signed-in wrapper: a stored fresh bearer the provider reads on mount. */
function unlockedWrapper(token = 'tok-abc') {
  persistSession({ token, expiresAt: Date.now() + 60_000 });
  return ({ children }: { children: React.ReactNode }): React.JSX.Element => (
    <TestSessionProvider>{children}</TestSessionProvider>
  );
}

afterEach(() => {
  clearStoredSession();
  cleanup();
  vi.clearAllMocks();
});

describe('sessionMatchesSpec', () => {
  it('requires BOTH the kind and the ref to match', () => {
    const spec = { kind: 'agent', ref: 'fyt-runner' } as const;
    expect(sessionMatchesSpec(summary({ sessionId: 'a', kind: 'agent', targetRef: 'fyt-runner' }), spec)).toBe(true);
    // Another agent's session.
    expect(sessionMatchesSpec(summary({ sessionId: 'b', kind: 'agent', targetRef: 'other' }), spec)).toBe(false);
    // A workflow that happens to share the ref is a different program entirely.
    expect(sessionMatchesSpec(summary({ sessionId: 'c', kind: 'workflow', targetRef: 'fyt-runner' }), spec)).toBe(false);
    // A session FLIPPED out of agent mode into plain claude is no longer this agent's session.
    expect(sessionMatchesSpec(summary({ sessionId: 'd', kind: 'claude', targetRef: 'fyt-runner' }), spec)).toBe(false);
    // A plain login shell is nobody's.
    expect(sessionMatchesSpec(summary({ sessionId: 'e' }), spec)).toBe(false);
    // An older daemon that reports no kind at all must not be adopted on a guess.
    expect(sessionMatchesSpec({ sessionId: 'f', createdAt: 1, attached: false }, spec)).toBe(false);
  });
});

describe('spawnForSpec', () => {
  it('names the entity and lets the server resolve it', () => {
    expect(spawnForSpec({ kind: 'agent', ref: 'fyt-runner' })).toEqual({ mode: 'agent', agentId: 'fyt-runner' });
    expect(spawnForSpec({ kind: 'workflow', ref: 'kb~video.md' })).toEqual({
      mode: 'workflow',
      workflowRef: 'kb~video.md',
    });
  });
});

describe('useAttachableSession', () => {
  it('returns the live session already bound to this spec', async () => {
    const live = [
      summary({ sessionId: 'pty-shell' }),
      summary({ sessionId: 'pty-other', kind: 'agent', targetRef: 'someone-else' }),
      summary({ sessionId: 'pty-mine', kind: 'agent', targetRef: 'fyt-runner' }),
    ];
    let resolveList!: (rows: PtySessionSummary[]) => void;
    const sessions = {
      list: vi.fn(() => new Promise<PtySessionSummary[]>((resolve) => { resolveList = resolve; })),
      remove: vi.fn(async () => {}),
    };
    const { result } = renderHook(
      () => useAttachableSession({ kind: 'agent', ref: 'fyt-runner' }, { sessionsClient: sessions }),
      { wrapper: unlockedWrapper() },
    );

    await waitFor(() => expect(result.current.unlocked).toBe(true));
    expect(result.current.status).toBe('loading'); // never decide before the list settles
    await act(async () => { resolveList(live); });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.attach).toEqual({ mode: 'attach', sessionId: 'pty-mine' });
    expect(sessions.list).toHaveBeenCalledWith('tok-abc');
  });

  it('offers a spawn target and no attach when nothing is running for this spec', async () => {
    const { result } = renderHook(
      () => useAttachableSession({ kind: 'agent', ref: 'fyt-runner' }, { sessionsClient: client([]) }),
      { wrapper: unlockedWrapper() },
    );
    await waitFor(() => expect(result.current.unlocked).toBe(true));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.attach).toBeNull();
    expect(result.current.spawn).toEqual({ mode: 'spawn', spawn: { mode: 'agent', agentId: 'fyt-runner' } });
    expect(result.current.unlocked).toBe(true);
  });

  it('keeps ONE spawn target identity across re-renders, so a pane it drives never reconnects', async () => {
    const sessions = client([]);
    const { result, rerender } = renderHook(
      () => useAttachableSession({ kind: 'agent', ref: 'fyt-runner' }, { sessionsClient: sessions }),
      { wrapper: unlockedWrapper() },
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const first = result.current.spawn;
    rerender();
    rerender();
    expect(result.current.spawn).toBe(first);
  });

  it('settles as ready-but-locked with no bearer, and lists nothing', async () => {
    const sessions = client([summary({ sessionId: 'pty-mine', kind: 'agent', targetRef: 'fyt-runner' })]);
    const { result } = renderHook(
      () => useAttachableSession({ kind: 'agent', ref: 'fyt-runner' }, { sessionsClient: sessions }),
      { wrapper: ({ children }) => <TestSessionProvider>{children}</TestSessionProvider> },
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.unlocked).toBe(false);
    expect(result.current.attach).toBeNull();
    expect(sessions.list).not.toHaveBeenCalled();
  });

  it('settles immediately with no spec — there is nothing to look for', async () => {
    const sessions = client([summary({ sessionId: 'pty-mine', kind: 'agent', targetRef: 'fyt-runner' })]);
    const { result } = renderHook(() => useAttachableSession(null, { sessionsClient: sessions }), {
      wrapper: unlockedWrapper(),
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.attach).toBeNull();
    expect(sessions.list).not.toHaveBeenCalled();
  });

  it('release drops the attach (the shell ended) and refresh re-reads the live list', async () => {
    const sessions = client([summary({ sessionId: 'pty-mine', kind: 'agent', targetRef: 'fyt-runner' })]);
    const { result } = renderHook(
      () => useAttachableSession({ kind: 'agent', ref: 'fyt-runner' }, { sessionsClient: sessions }),
      { wrapper: unlockedWrapper() },
    );
    await waitFor(() => expect(result.current.attach).not.toBeNull());

    act(() => result.current.release());
    expect(result.current.attach).toBeNull();

    act(() => result.current.refresh());
    await waitFor(() => expect(sessions.list).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.attach).toEqual({ mode: 'attach', sessionId: 'pty-mine' }));
  });

  it('re-looks-up when the spec changes to a different agent', async () => {
    const sessions = client([
      summary({ sessionId: 'pty-a', kind: 'agent', targetRef: 'agent-a' }),
      summary({ sessionId: 'pty-b', kind: 'agent', targetRef: 'agent-b' }),
    ]);
    const { result, rerender } = renderHook(
      ({ ref }: { ref: string }) => useAttachableSession({ kind: 'agent', ref }, { sessionsClient: sessions }),
      { wrapper: unlockedWrapper(), initialProps: { ref: 'agent-a' } },
    );
    await waitFor(() => expect(result.current.attach).toEqual({ mode: 'attach', sessionId: 'pty-a' }));

    rerender({ ref: 'agent-b' });
    await waitFor(() => expect(result.current.attach).toEqual({ mode: 'attach', sessionId: 'pty-b' }));
    expect(result.current.spawn).toEqual({ mode: 'spawn', spawn: { mode: 'agent', agentId: 'agent-b' } });
  });
});
