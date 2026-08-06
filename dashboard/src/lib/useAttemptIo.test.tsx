// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { clearStoredSession, persistSession } from './authClient';
import { SessionProvider } from './sessionContext';
import { useAttemptIo } from './useAttemptIo';
import type { UseSseResult } from './sseClient';

afterEach(() => {
  clearStoredSession();
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

const sse = (last: UseSseResult['last'] = null): UseSseResult => ({ last, count: last ? 1 : 0 });
const entry = (seq: number) => ({ seq, t: `2026-08-06T00:00:0${seq}.000Z`, dir: 'out' as const, line: `line ${seq}` });

function response(entries: ReturnType<typeof entry>[]): Response {
  return new Response(JSON.stringify({ entries }), { headers: { 'content-type': 'application/json' } });
}

function SessionWrapper({ children }: { children: ReactNode }): React.JSX.Element {
  return <SessionProvider>{children}</SessionProvider>;
}

function freshSession(): void {
  persistSession({ token: 'session-token', expiresAt: Date.now() + 60_000 });
}

describe('useAttemptIo', () => {
  it('catches up attempt lines on mount through the session-gated read', async () => {
    const fetcher = vi.fn(async () => response([entry(1), entry(2)]));
    freshSession();
    const { result } = renderHook(
      () => useAttemptIo({ runRef: 'run-1', attemptRef: 'attempt-1', sse: sse(), fetcher }),
      { wrapper: SessionWrapper },
    );

    await waitFor(() => expect(result.current.lines).toEqual([entry(1), entry(2)]));
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/control/runs/run-1/attempts/attempt-1/io?after=0');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer session-token');
  });

  it('trailing-debounces a burst of matching signals into one catch-up fetch', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response([entry(1)]))
      .mockResolvedValueOnce(response([entry(2), entry(3), entry(4)]));
    freshSession();
    const { result, rerender } = renderHook(
      ({ stream }: { stream: UseSseResult }) => useAttemptIo({ runRef: 'run-1', attemptRef: 'attempt-1', sse: stream, fetcher }),
      { initialProps: { stream: sse() }, wrapper: SessionWrapper },
    );
    await waitFor(() => expect(result.current.lines).toEqual([entry(1)]));

    vi.useFakeTimers();
    rerender({ stream: sse({ channel: 'control', kind: 'attempt-io', data: { attemptRef: 'attempt-1', seq: 2 } }) });
    rerender({ stream: sse({ channel: 'control', kind: 'attempt-io', data: { attemptRef: 'attempt-1', seq: 3 } }) });
    rerender({ stream: sse({ channel: 'control', kind: 'attempt-io', data: { attemptRef: 'attempt-1', seq: 4 } }) });
    await act(async () => { await vi.advanceTimersByTimeAsync(149); });
    expect(fetcher).toHaveBeenCalledOnce();

    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenLastCalledWith('/api/control/runs/run-1/attempts/attempt-1/io?after=1', expect.anything());
    expect(result.current.lines).toEqual([entry(1), entry(2), entry(3), entry(4)]);
    expect(result.current.live).toBe(true);
  });

  it('ignores a signal for another attempt', async () => {
    const fetcher = vi.fn(async () => response([entry(1)]));
    freshSession();
    const { result, rerender } = renderHook(
      ({ stream }: { stream: UseSseResult }) => useAttemptIo({ runRef: 'run-1', attemptRef: 'attempt-1', sse: stream, fetcher }),
      { initialProps: { stream: sse() }, wrapper: SessionWrapper },
    );
    await waitFor(() => expect(result.current.lines).toEqual([entry(1)]));

    rerender({ stream: sse({ channel: 'control', kind: 'attempt-io', data: { attemptRef: 'attempt-other', seq: 2 } }) });

    expect(result.current.lines).toEqual([entry(1)]);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('catches up after a higher sequence signal', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response([entry(1)]))
      .mockResolvedValueOnce(response([entry(2), entry(3)]));
    freshSession();
    const { result, rerender } = renderHook(
      ({ stream }: { stream: UseSseResult }) => useAttemptIo({ runRef: 'run-1', attemptRef: 'attempt-1', sse: stream, fetcher }),
      { initialProps: { stream: sse() }, wrapper: SessionWrapper },
    );
    await waitFor(() => expect(result.current.lines).toEqual([entry(1)]));

    rerender({ stream: sse({ channel: 'control', kind: 'attempt-io', data: { attemptRef: 'attempt-1', seq: 3 } }) });

    await waitFor(() => expect(result.current.lines).toEqual([entry(1), entry(2), entry(3)]));
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenLastCalledWith('/api/control/runs/run-1/attempts/attempt-1/io?after=1', expect.anything());
  });

  it('keeps only the configured client-side ring of lines', async () => {
    const fetcher = vi.fn(async () => response([entry(1), entry(2), entry(3)]));
    freshSession();
    const { result } = renderHook(
      () => useAttemptIo({ runRef: 'run-1', attemptRef: 'attempt-1', sse: sse(), fetcher, maxLines: 2 }),
      { wrapper: SessionWrapper },
    );

    await waitFor(() => expect(result.current.lines).toEqual([entry(2), entry(3)]));
  });
});
