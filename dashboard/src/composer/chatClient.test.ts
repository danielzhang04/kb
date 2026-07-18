import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultComposerStream } from './chatClient';
import type { TimelineModel } from '../lib/timelineModel';

afterEach(() => vi.unstubAllGlobals());

function response(frames: unknown[], ok = true, status = 200): Response {
  const chunks = frames.map((frame) => new TextEncoder().encode(`${JSON.stringify(frame)}\n`));
  let index = 0;
  return {
    ok, status, statusText: '', json: async () => ({ reason: 'fleet-frozen' }),
    body: { getReader: () => ({ read: async () => index < chunks.length ? { value: chunks[index++], done: false } : { value: undefined, done: true } }) },
  } as unknown as Response;
}

const MODEL: TimelineModel = {
  turns: [{ index: 0, model: 'claude', timestamp: null, usage: null, steps: [{ kind: 'text', text: 'hello' }] }],
};

describe('workspace Composer stream', () => {
  it('posts only prompt under the opaque Composer ref and streams deltas', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => response([{ type: 'delta', model: MODEL }, { type: 'exit', code: 0 }]));
    vi.stubGlobal('fetch', fetchMock);
    const deltas: TimelineModel[] = [];

    expect(await defaultComposerStream('cw_public_ref', 'research this', 'tok', (model) => deltas.push(model), new AbortController().signal)).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/composer/sessions/cw_public_ref/turns');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ prompt: 'research this' });
    expect(JSON.stringify(init)).not.toMatch(/resumeId|sessionId/);
    expect(deltas).toEqual([MODEL]);
  });

  it('surfaces stderr and non-zero exits without exposing provider ids', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response([{ type: 'stderr', chunk: 'failed' }, { type: 'exit', code: 0 }])));
    expect(await defaultComposerStream('cw_a', 'x', 'tok', () => {}, new AbortController().signal)).toEqual({ ok: false, reason: 'failed' });

    vi.stubGlobal('fetch', vi.fn(async () => response([{ type: 'exit', code: 7 }])));
    expect(await defaultComposerStream('cw_a', 'x', 'tok', () => {}, new AbortController().signal)).toEqual({ ok: false, reason: 'composer exited with code 7' });
  });

  it('maps a refused request and an aborted request calmly', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response([], false, 503)));
    expect(await defaultComposerStream('cw_a', 'x', 'tok', () => {}, new AbortController().signal)).toEqual({ ok: false, status: 503, reason: '503: fleet-frozen' });

    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('aborted'); }));
    expect(await defaultComposerStream('cw_a', 'x', 'tok', () => {}, controller.signal)).toEqual({ ok: false, reason: 'stopped' });
  });
});
