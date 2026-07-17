/**
 * C1 — Composer chat client. `defaultComposerStream` extends the `defaultVibeStream` pattern (injectable
 * fetch stream fn, bearer session token, incremental NDJSON body read, calm refusal surfacing) with the
 * multi-turn `resumeId` round-trip: it POSTs `{ prompt, resumeId }`, reads the server's typed frames, and
 * returns the CLI session id captured from the `session` frame so the caller threads it into the next turn.
 * These tests drive a fake `fetch` — no real network, no real `claude`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultComposerStream } from './chatClient';
import type { TimelineModel } from '../lib/timelineModel';

afterEach(() => vi.unstubAllGlobals());

function fakeFrameResponse(frames: unknown[], opts: { ok?: boolean; status?: number } = {}): Response {
  const chunks = frames.map((f) => `${JSON.stringify(f)}\n`);
  let i = 0;
  const encoder = new TextEncoder();
  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    statusText: 'OK',
    json: () => Promise.resolve({}),
    body: {
      getReader: () => ({
        read: () => {
          if (i >= chunks.length) return Promise.resolve({ value: undefined, done: true });
          const value = encoder.encode(chunks[i]);
          i += 1;
          return Promise.resolve({ value, done: false });
        },
      }),
    },
  } as unknown as Response;
}

const DELTA_MODEL: TimelineModel = {
  turns: [{ index: 0, model: 'claude-sonnet-5', timestamp: null, usage: null, steps: [{ kind: 'text', text: 'hi' }] }],
};

describe('defaultComposerStream', () => {
  it('reads delta models and returns the captured resumeId from the session frame', async () => {
    const frames = [
      { type: 'session', sessionId: 'sess-1' },
      { type: 'delta', model: DELTA_MODEL },
      { type: 'exit', code: 0 },
    ];
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(fakeFrameResponse(frames))));

    const deltas: TimelineModel[] = [];
    const controller = new AbortController();
    const outcome = await defaultComposerStream('hi', undefined, 'tok-1', (m) => deltas.push(m), controller.signal);

    expect(outcome).toEqual({ ok: true, resumeId: 'sess-1' });
    expect(deltas).toHaveLength(1);
    expect(deltas[0].turns).toHaveLength(1);
  });

  it('POSTs { prompt, resumeId } to /api/composer/turn with the bearer token on a continuing turn', async () => {
    const fetchMock = vi.fn((_url: string, _init: RequestInit) => Promise.resolve(fakeFrameResponse([{ type: 'exit', code: 0 }])));
    vi.stubGlobal('fetch', fetchMock);

    await defaultComposerStream('again', 'sess-prev', 'tok-9', () => {}, new AbortController().signal);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/composer/turn');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok-9');
    expect(JSON.parse(init.body as string)).toEqual({ prompt: 'again', resumeId: 'sess-prev' });
  });

  it('omits resumeId from the body on the first turn (no prior session)', async () => {
    const fetchMock = vi.fn((_url: string, _init: RequestInit) => Promise.resolve(fakeFrameResponse([{ type: 'exit', code: 0 }])));
    vi.stubGlobal('fetch', fetchMock);

    await defaultComposerStream('first', undefined, 'tok-1', () => {}, new AbortController().signal);

    const init = fetchMock.mock.calls[0][1];
    expect(JSON.parse(init.body as string)).toEqual({ prompt: 'first' });
  });

  it('surfaces a non-ok response as a mapped refusal reason without throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 503,
          statusText: 'Service Unavailable',
          json: () => Promise.resolve({ reason: 'fleet-frozen' }),
        } as unknown as Response),
      ),
    );

    const outcome = await defaultComposerStream('hi', undefined, 'tok', () => {}, new AbortController().signal);
    expect(outcome).toEqual({ ok: false, status: 503, reason: 'fleet-frozen' });
  });
});
