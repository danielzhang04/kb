// @vitest-environment jsdom
/**
 * Atlas V1 (Task 8) — the shared Atlas poller. Two concerns are pinned here:
 *   1. `deriveWorker` normalizes the worker `/state` passthrough AND the derived OFFLINE shape into the
 *      always-present `AtlasWorkerView` (with defensive fallbacks) — pure, deterministic.
 *   2. the module-level fetch loop is SHARED (one loop for N consumers) and PAUSES while `document.hidden`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, cleanup } from '@testing-library/react';
import { deriveWorker, useAtlasState } from './useAtlasState';
import type { AtlasPanel } from '../../server/panels/atlas';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('deriveWorker', () => {
  it('passes a healthy worker snapshot through into the UI view', () => {
    const view = deriveWorker({
      version: 1,
      state: 'SPEAKING',
      since: '2026-07-20T10:00:00Z',
      heartbeat: '2026-07-20T10:00:05Z',
      session_id: 'sess-1',
      voice: 'mars',
      transcript: [{ t: '2026-07-20T10:00:01Z', role: 'user', text: 'hi' }],
    });
    expect(view.state).toBe('SPEAKING');
    expect(view.since).toBe('2026-07-20T10:00:00Z');
    expect(view.heartbeat).toBe('2026-07-20T10:00:05Z');
    expect(view.sessionId).toBe('sess-1');
    expect(view.voice).toBe('mars');
    expect(view.transcript).toEqual([{ t: '2026-07-20T10:00:01Z', role: 'user', text: 'hi' }]);
  });

  it('maps the derived OFFLINE shape, carrying the last-known heartbeat', () => {
    const view = deriveWorker({ state: 'OFFLINE', lastHeartbeat: '2026-07-20T09:59:00Z' });
    expect(view.state).toBe('OFFLINE');
    expect(view.heartbeat).toBe('2026-07-20T09:59:00Z');
    expect(view.transcript).toEqual([]);
  });

  it('degrades a null/absent or unrecognized snapshot defensively', () => {
    expect(deriveWorker(null).state).toBe('OFFLINE');
    expect(deriveWorker(undefined).state).toBe('OFFLINE');
    // An unknown state string falls back to ASLEEP rather than rendering a bogus orb.
    expect(deriveWorker({ state: 'GLITCH' }).state).toBe('ASLEEP');
    // A malformed transcript entry is coerced, never thrown on.
    expect(deriveWorker({ state: 'LISTENING', transcript: [{}, 5, null] }).transcript).toEqual([
      { t: null, role: null, text: null },
      { t: null, role: null, text: null },
      { t: null, role: null, text: null },
    ]);
  });
});

const PANEL: AtlasPanel = {
  worker: { version: 1, state: 'LISTENING', since: null, heartbeat: 'hb', session_id: null, voice: 'mars', transcript: [] },
  history: [],
  cards: [],
};

describe('useAtlasState shared poller', () => {
  it('runs ONE fetch loop for multiple consumers and pauses while the tab is hidden', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => PANEL }));
    vi.stubGlobal('fetch', fetchMock);

    // Two independent consumers (mirrors the mini-orb + full view) share a single interval.
    await act(async () => {
      renderHook(() => useAtlasState());
      renderHook(() => useAtlasState());
      await Promise.resolve();
    });
    const afterSeed = fetchMock.mock.calls.length; // one seed fetch from the first subscriber

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    // Exactly one additional fetch across the interval — a single shared loop, not one per consumer.
    expect(fetchMock.mock.calls.length).toBe(afterSeed + 1);

    // Backgrounded tab: the tick is skipped.
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    const beforeHidden = fetchMock.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(fetchMock.mock.calls.length).toBe(beforeHidden);
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  });
});
