/**
 * `ensureBrowserSession` — the client half of the bug that made the tailnet deployment's terminal
 * unreachable. `POST /api/auth/browser-session` is the ONLY route that mints the `kb_browser_session`
 * cookie `/api/pty` demands, and nothing in the client ever called it. What is pinned here: it is
 * called, it retries a 401 EXACTLY once (the refusal carries the expiring cookie, so the retry presents
 * nothing and mints), it never loops, concurrent callers share one request, and every failure is a
 * named refusal rather than a silent success.
 */
import { describe, expect, it, vi } from 'vitest';
import { BROWSER_SESSION_ROUTE, browserSessionMessage, ensureBrowserSession } from './browserSessionClient';

function response(status: number): Response {
  return { ok: status >= 200 && status < 300, status } as Response;
}

/** A fetch that answers with the given statuses in order, then repeats the last one forever. */
function fetchReturning(...statuses: number[]) {
  let call = 0;
  return vi.fn(async () => {
    const status = statuses[Math.min(call, statuses.length - 1)];
    call += 1;
    return response(status);
  }) as unknown as typeof fetch & { mock: { calls: unknown[][] } };
}

describe('ensureBrowserSession', () => {
  it('POSTs the mint route same-origin, and reports the 204 as a live browser session', async () => {
    const fetchImpl = fetchReturning(204);

    await expect(ensureBrowserSession(fetchImpl)).resolves.toEqual({ ok: true });

    expect(fetchImpl.mock.calls).toHaveLength(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(BROWSER_SESSION_ROUTE);
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('same-origin');
  });

  it('retries a 401 EXACTLY once — the refusal expired the dead ref, so the retry mints', async () => {
    // The daemon-restart case: this browser holds a ref the store has forgotten and cannot clear it
    // itself (HttpOnly). The 401 carries the expiring cookie; the second POST presents nothing.
    const fetchImpl = fetchReturning(401, 204);

    await expect(ensureBrowserSession(fetchImpl)).resolves.toEqual({ ok: true });

    expect(fetchImpl.mock.calls).toHaveLength(2);
  });

  it('stops after the second 401 and names the refusal — no retry loop is ever armed', async () => {
    const fetchImpl = fetchReturning(401, 401, 204);

    await expect(ensureBrowserSession(fetchImpl)).resolves.toEqual({ ok: false, reason: 'refused' });

    expect(fetchImpl.mock.calls).toHaveLength(2);
  });

  it('separates a ref store that could not answer (503) from a refused credential', async () => {
    await expect(ensureBrowserSession(fetchReturning(503))).resolves.toEqual({
      ok: false, reason: 'unavailable',
    });
    await expect(ensureBrowserSession(fetchReturning(500))).resolves.toEqual({
      ok: false, reason: 'refused',
    });
  });

  it('reports a transport failure as `unreachable` — the server never spoke about this credential', async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;

    await expect(ensureBrowserSession(fetchImpl)).resolves.toEqual({ ok: false, reason: 'unreachable' });
  });

  it('shares ONE in-flight request across concurrent callers, and asks again after it settles', async () => {
    // A workspace listing plus every mounted console call this at once; one POST answers all of them.
    // But nothing is cached across settles: the ref store does not survive a daemon restart, so a
    // remembered success is exactly what would keep a dead cookie in play.
    const fetchImpl = fetchReturning(204);

    const [first, second] = await Promise.all([
      ensureBrowserSession(fetchImpl),
      ensureBrowserSession(fetchImpl),
    ]);

    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: true });
    expect(fetchImpl.mock.calls).toHaveLength(1);

    await ensureBrowserSession(fetchImpl);
    expect(fetchImpl.mock.calls).toHaveLength(2);
  });

  it('gives every refusal its own operator sentence', () => {
    const sentences = (['refused', 'unavailable', 'unreachable'] as const).map(browserSessionMessage);
    expect(new Set(sentences).size).toBe(3);
    for (const sentence of sentences) expect(sentence.length).toBeGreaterThan(0);
  });
});
