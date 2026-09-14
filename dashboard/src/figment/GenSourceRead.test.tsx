// @vitest-environment jsdom
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GenSourceRead } from './GenSourceRead';
import type { GenSourceReadProps } from './GenSourceRead';
import { GEN_SOURCE_LIMITATIONS } from '../../shared/figmentGenSourceRead.ts';

const GET_URL = '/api/figment/studio/gen-source-reads';
const postUrl = (id: string) => `/api/figment/studio/gen-plans/${encodeURIComponent(id)}/source-check`;

const PLAN_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_PLAN_ID = '00000000-0000-4000-8000-000000000002';
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SCOPE_A = '1'.repeat(64);
const SCOPE_B = '2'.repeat(64);
const CHECKED_AT = '2026-09-12T18:00:00Z';
const NEW_CHECKED_AT = '2026-09-13T00:00:00Z';

const CHECK = 'Check current source';
const CHECK_PENDING = 'Checking source…';
const REFRESH = 'Refresh status';
const GET_UNAVAILABLE = 'Source availability status is unavailable.';
const NOT_CONFIGURED = 'Source checking is not configured for this plan.';
const BUSY_COPY = 'Another source check is in progress. Refresh once it finishes.';
const QUARANTINED_COPY = 'Checking is unavailable until an operator reviews the previous check.';
const POST_UNAUTHORIZED = 'This check could not be authorized. Sign in again and retry.';
const POST_UNAVAILABLE = 'Source checking is unavailable.';
const POST_NEEDS_ATTENTION = 'This check needs operator attention after an earlier process ended in an uncertain state.';
const POST_IDENTITY_MISMATCH = 'The source check was rejected because the plan identity did not match. Refresh and retry.';
const POST_TIMEOUT_COPY = 'The check timed out waiting for a response. The server may still be working; there will be no automatic retry. You may check again.';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const digestsFixture = () => ({
  personaSha256: 'c'.repeat(64),
  approvalSha256: 'd'.repeat(64),
  approvalLineageSha256: 'e'.repeat(64),
  sourcePlanSha256: 'f'.repeat(64),
  checkpointSha256: '3'.repeat(64),
  genManifestSha256: ['4'.repeat(64)],
});

const inventoryBody = (overrides: Record<string, unknown> = {}) => ({
  schema: 'figment/studio-gen-source-reads@1',
  configured: true,
  availability: 'available',
  entries: [{ id: PLAN_ID, planSha256: SHA_A }],
  ...overrides,
});

const resultBody = (overrides: Record<string, unknown> = {}) => ({
  schema: 'figment/studio-gen-source-read@1',
  id: PLAN_ID,
  planSha256: SHA_A,
  outcome: 'source-checked',
  checkedAtUtc: CHECKED_AT,
  digests: digestsFixture(),
  claims: { launchReady: false, qualityApproved: false, atomicSnapshot: false },
  limitations: [...GEN_SOURCE_LIMITATIONS],
  ...overrides,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// A response-shaped object with no `.body` stream, forcing the text() fallback path,
// with its own independently controllable text() timing.
function fakeResponse(status: number, textPromise: Promise<string>, ok = status >= 200 && status < 300): Response {
  return { ok, status, text: () => textPromise } as unknown as Response;
}

type Handler = (url: string, init: RequestInit | undefined, headers: Headers) => Promise<Response> | Response;
function server(handler: Handler) {
  const mock = vi.fn(async (url: string, init?: RequestInit) => handler(url, init, new Headers(init?.headers)));
  const calls = () => mock.mock.calls;
  const gets = () => calls().filter(([url, init]) => url === GET_URL && init?.method === undefined);
  const posts = () => calls().filter(([, init]) => init?.method === 'POST');
  return { fetchImpl: mock as unknown as typeof fetch, calls, gets, posts };
}

const baseProps = (overrides: Partial<GenSourceReadProps> = {}): GenSourceReadProps => ({
  planId: PLAN_ID,
  planSha256: SHA_A,
  requestScope: SCOPE_A,
  ownerGeneration: 1,
  token: 'session',
  ...overrides,
});

const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
async function enabled(name: string): Promise<HTMLButtonElement> {
  await waitFor(() => expect(button(name).disabled).toBe(false));
  return button(name);
}

// For fake-timer tests: waitFor's internal polling relies on real setTimeout and must
// not be combined with fake timers. Flush pending microtasks explicitly instead.
async function flushMicrotasks(times = 3): Promise<void> {
  for (let i = 0; i < times; i++) {
    await act(async () => { await Promise.resolve(); });
  }
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('GenSourceRead mount and inventory GET', () => {
  it('GETs inventory on mount with auth header, credentials, no method/body and issues zero POSTs', async () => {
    const s = server((url) => url === GET_URL ? json(inventoryBody()) : json(resultBody()));
    render(<GenSourceRead {...baseProps()} fetchImpl={s.fetchImpl} />);
    await enabled(CHECK);
    expect(s.posts()).toHaveLength(0);
    const [, init] = s.gets()[0]!;
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer session');
    expect(init?.method).toBeUndefined();
    expect(init?.body).toBeUndefined();
    expect(init?.credentials).toBe('same-origin');
  });

  it('shows a loading indicator until the GET resolves', async () => {
    const get = deferred<Response>();
    const s = server(() => get.promise);
    render(<GenSourceRead {...baseProps()} fetchImpl={s.fetchImpl} />);
    expect(screen.getByRole('status').textContent).toMatch(/Checking source availability/);
    expect(button(REFRESH).disabled).toBe(true);
    get.resolve(json(inventoryBody()));
    await enabled(REFRESH);
  });

  it.each([
    ['server failure', () => json({ error: 'boom' }, 500)],
    ['network rejection', () => Promise.reject(new Error('offline'))],
    ['non-JSON body', () => new Response('<html>', { status: 200 })],
    ['malformed inventory', () => json(inventoryBody({ availability: 'ready' }))],
  ])('fails closed with fixed copy on %s and never leaks detail', async (_n, reply) => {
    const s = server(() => reply());
    render(<GenSourceRead {...baseProps()} fetchImpl={s.fetchImpl} />);
    await screen.findByRole('alert');
    expect(screen.getByRole('alert').textContent).toBe(GET_UNAVAILABLE);
    expect(document.body.textContent).not.toMatch(/boom|html|offline/);
    expect(s.posts()).toHaveLength(0);
  });

  it('fails closed on a genuinely synchronous GET fetch throw (not wrapped as a rejection) without leaking detail', async () => {
    const syncFetch = vi.fn(() => { throw new Error('boom-sync'); }) as unknown as typeof fetch;
    render(<GenSourceRead {...baseProps()} fetchImpl={syncFetch} />);
    await screen.findByRole('alert');
    expect(screen.getByRole('alert').textContent).toBe(GET_UNAVAILABLE);
    expect(document.body.textContent).not.toMatch(/boom-sync/);
  });

  it('rejects an oversized GET inventory response body', async () => {
    const bloated = JSON.stringify(inventoryBody()).slice(0, -1) + ' '.repeat(8300) + '}';
    const s = server((url) => url === GET_URL
      ? new Response(bloated, { status: 200, headers: { 'content-type': 'application/json' } })
      : json(resultBody()));
    render(<GenSourceRead {...baseProps()} fetchImpl={s.fetchImpl} />);
    await screen.findByRole('alert');
    expect(screen.getByRole('alert').textContent).toBe(GET_UNAVAILABLE);
    expect(button(CHECK).disabled).toBe(true);
    fireEvent.click(button(CHECK));
    expect(s.posts()).toHaveLength(0);
  });

  it('does not auto-retry after an inventory failure; only Refresh re-GETs', async () => {
    const s = server((url) => url === GET_URL ? json({}, 503) : json(resultBody()));
    render(<GenSourceRead {...baseProps()} fetchImpl={s.fetchImpl} />);
    await screen.findByRole('alert');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(s.gets()).toHaveLength(1);
    fireEvent.click(await enabled(REFRESH));
    await waitFor(() => expect(s.gets()).toHaveLength(2));
    expect(s.posts()).toHaveLength(0);
  });

  it.each([
    ['not configured', { configured: false, availability: 'not-configured', entries: [] }, NOT_CONFIGURED],
    ['entry sha mismatch', { entries: [{ id: PLAN_ID, planSha256: SHA_B }] }, NOT_CONFIGURED],
    ['busy', { availability: 'busy' }, BUSY_COPY],
    ['quarantined', { availability: 'quarantined' }, QUARANTINED_COPY],
  ])('disables checking on %s with the exact stated reason and no POST when clicked', async (_n, overrides, expectedReason) => {
    const s = server((url) => url === GET_URL ? json(inventoryBody(overrides)) : json(resultBody()));
    render(<GenSourceRead {...baseProps()} fetchImpl={s.fetchImpl} />);
    await waitFor(() => expect(button(REFRESH).disabled).toBe(false));
    expect(screen.getByText(expectedReason)).toBeTruthy();
    expect(button(CHECK).disabled).toBe(true);
    fireEvent.click(button(CHECK));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(s.posts()).toHaveLength(0);
  });

  it('Refresh never dispatches a POST', async () => {
    const s = server((url) => url === GET_URL ? json(inventoryBody()) : json(resultBody()));
    render(<GenSourceRead {...baseProps()} fetchImpl={s.fetchImpl} />);
    fireEvent.click(await enabled(REFRESH));
    await waitFor(() => expect(s.gets()).toHaveLength(2));
    expect(s.posts()).toHaveLength(0);
  });

  it('dispatches exactly one actual GET fetch call despite StrictMode double-invoking the effect, and issues no POST', async () => {
    // React 18 StrictMode mounts, cleans up, and re-mounts the effect synchronously, all
    // before any microtask can flush. The first loadInventory() call's AbortController is
    // replaced (and its pending fetch dispatch short-circuits as stale) before its
    // `Promise.resolve().then()` microtask ever calls fetchImpl, so only the second
    // invocation ever reaches the network. There is no "second, later, stale GET" to race.
    const s = server((url) => url === GET_URL ? json(inventoryBody()) : json(resultBody()));
    render(<StrictMode><GenSourceRead {...baseProps()} fetchImpl={s.fetchImpl} /></StrictMode>);
    await enabled(CHECK);
    expect(s.gets()).toHaveLength(1);
    expect(s.posts()).toHaveLength(0);
  });
});

describe('GenSourceRead explicit POST', () => {
  it('sends exactly one bodyless POST to the exact URL with plan/scope/auth headers on explicit click', async () => {
    const s = server((url) => url === GET_URL ? json(inventoryBody()) : json(resultBody()));
    render(<GenSourceRead {...baseProps()} fetchImpl={s.fetchImpl} />);
    fireEvent.click(await enabled(CHECK));
    await screen.findByText(/Source checked at/);
    expect(s.posts()).toHaveLength(1);
    const [url, init] = s.posts()[0]!;
    expect(url).toBe(postUrl(PLAN_ID));
    expect(init?.method).toBe('POST');
    expect(init?.body).toBeUndefined();
    expect(init?.credentials).toBe('same-origin');
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe('Bearer session');
    expect(headers.get('X-Figment-Plan-Sha256')).toBe(SHA_A);
    expect(headers.get('X-Figment-Request-Scope')).toBe(SCOPE_A);
  });

  it('collapses a synchronous double click into a single POST', async () => {
    const post = deferred<Response>();
    const s = server((url) => url === GET_URL ? json(inventoryBody()) : post.promise);
    render(<GenSourceRead {...baseProps()} fetchImpl={s.fetchImpl} />);
    const check = await enabled(CHECK);
    fireEvent.click(check);
    fireEvent.click(check);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(s.posts()).toHaveLength(1);
    post.resolve(json(resultBody()));
    await screen.findByText(/Source checked at/);
  });

  it('renders a valid result with the checked-at time and no-authority disclaimers', async () => {
    const s = server((url) => url === GET_URL ? json(inventoryBody()) : json(resultBody()));
    render(<GenSourceRead {...baseProps()} fetchImpl={s.fetchImpl} />);
    fireEvent.click(await enabled(CHECK));
    await screen.findByText(`Source checked at ${CHECKED_AT}`);
    expect(screen.getByText(/does not grant launch, quality or approval/)).toBeTruthy();
    expect(screen.getByText('A manual, past-only observation of the source used to prepare this plan. It grants no launch, quality, or approval authority, and it is not automatically retried.')).toBeTruthy();
    expect(screen.getByText(/Source plan digest: f{12}/)).toBeTruthy();
    for (const line of GEN_SOURCE_LIMITATIONS) expect(screen.getByText(line)).toBeTruthy();
  });

  it.each([
    ['401 unauthorized', () => json({}, 401), POST_UNAUTHORIZED],
    ['409 identity mismatch', () => json({ error: 'identity-mismatch' }, 409), POST_IDENTITY_MISMATCH],
    ['409 generic busy', () => json({ error: 'locked' }, 409), BUSY_COPY],
    ['409 unparsable body', () => new Response('{"bad', { status: 409 }), BUSY_COPY],
    [
      '409 duplicate key via escaped unicode (raw backslash-u preserved in the wire text)',
      () => new Response('{"error":"identity-mismatch","err\\u006fr":"identity-mismatch"}', { status: 409 }),
      BUSY_COPY,
    ],
    ['423 needs attention', () => json({}, 423), POST_NEEDS_ATTENTION],
    ['500 generic', () => json({ error: 'boom' }, 500), POST_UNAVAILABLE],
    ['500 with identity mismatch body', () => json({ error: 'identity-mismatch' }, 500), POST_IDENTITY_MISMATCH],
    ['200 malformed JSON', () => new Response('{"bad', { status: 200 }), POST_UNAVAILABLE],
    ['200 valid JSON wrong DTO', () => json({ ok: true }), POST_UNAVAILABLE],
    ['200 mismatched id', () => json(resultBody({ id: OTHER_PLAN_ID })), POST_UNAVAILABLE],
    ['text() rejection (async body-read failure)', () => fakeResponse(200, Promise.reject(new Error('stream broke'))), POST_UNAVAILABLE],
    ['network rejection', () => Promise.reject(new Error('offline')), POST_UNAVAILABLE],
  ])('renders fixed copy on %s and does not leak response detail', async (_n, reply, message) => {
    const s = server((url) => url === GET_URL ? json(inventoryBody()) : reply());
    render(<GenSourceRead {...baseProps()} fetchImpl={s.fetchImpl} />);
    fireEvent.click(await enabled(CHECK));
    await waitFor(() => expect(button(CHECK).disabled).toBe(false));
    expect(screen.getByRole('alert').textContent).toBe(message);
    expect(document.body.textContent).not.toMatch(/boom|locked|stream broke|offline/);
    expect(screen.queryByText(/Source checked at/)).toBeNull();
  });

  it('fails closed on a genuinely synchronous POST fetch throw (not wrapped as a rejection) without leaking detail', async () => {
    const syncFetch = vi.fn((url: string) => {
      if (url === GET_URL) return json(inventoryBody());
      throw new Error('boom-sync-post');
    }) as unknown as typeof fetch;
    render(<GenSourceRead {...baseProps()} fetchImpl={syncFetch} />);
    fireEvent.click(await enabled(CHECK));
    await waitFor(() => expect(button(CHECK).disabled).toBe(false));
    expect(screen.getByRole('alert').textContent).toBe(POST_UNAVAILABLE);
    expect(document.body.textContent).not.toMatch(/boom-sync-post/);
  });

  it('rejects an oversized POST response body', async () => {
    const bloated = JSON.stringify(resultBody()).slice(0, -1) + ' '.repeat(8300) + '}';
    const s = server((url) => url === GET_URL
      ? json(inventoryBody())
      : new Response(bloated, { status: 200, headers: { 'content-type': 'application/json' } }));
    render(<GenSourceRead {...baseProps()} fetchImpl={s.fetchImpl} />);
    fireEvent.click(await enabled(CHECK));
    await waitFor(() => expect(button(CHECK).disabled).toBe(false));
    expect(screen.getByRole('alert').textContent).toBe(POST_UNAVAILABLE);
    expect(screen.queryByText(/Source checked at/)).toBeNull();
  });

  it('does not read from or write to localStorage or sessionStorage during mount+check+refresh', async () => {
    const getSpy = vi.spyOn(Storage.prototype, 'getItem');
    const setSpy = vi.spyOn(Storage.prototype, 'setItem');
    const s = server((url) => url === GET_URL ? json(inventoryBody()) : json(resultBody()));
    render(<GenSourceRead {...baseProps()} fetchImpl={s.fetchImpl} />);
    fireEvent.click(await enabled(CHECK));
    await screen.findByText(/Source checked at/);
    fireEvent.click(await enabled(REFRESH));
    await waitFor(() => expect(s.gets()).toHaveLength(2));
    expect(getSpy).not.toHaveBeenCalled();
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('a refresh clears a prior result', async () => {
    const s = server((url) => url === GET_URL ? json(inventoryBody()) : json(resultBody()));
    render(<GenSourceRead {...baseProps()} fetchImpl={s.fetchImpl} />);
    fireEvent.click(await enabled(CHECK));
    await screen.findByText(/Source checked at/);
    fireEvent.click(await enabled(REFRESH));
    await waitFor(() => expect(s.gets()).toHaveLength(2));
    expect(screen.queryByText(/Source checked at/)).toBeNull();
  });
});

describe('GenSourceRead ownership and staleness', () => {
  // Each patch below is a self-consistent identity change: when planId changes, its
  // matching planSha256 changes with it so the pairing corresponds to a real inventory entry.
  const ownerAxes: Array<[string, Partial<GenSourceReadProps>]> = [
    ['ownerGeneration', { ownerGeneration: 2 }],
    ['requestScope', { requestScope: SCOPE_B }],
    ['planId and its matching planSha256', { planId: OTHER_PLAN_ID, planSha256: SHA_B }],
    ['same id, new planSha256', { planSha256: SHA_B }],
    ['token', { token: 'other-session' }],
  ];

  it.each(ownerAxes)('hides a prior result synchronously on %s change and issues no POST as a side effect', async (_axis, patch) => {
    let getCount = 0;
    const s = server((url) => {
      if (url !== GET_URL) return json(resultBody());
      getCount++;
      const currentSha = getCount === 1 ? SHA_A : SHA_B;
      return json(inventoryBody({ entries: [{ id: PLAN_ID, planSha256: currentSha }, { id: OTHER_PLAN_ID, planSha256: SHA_B }] }));
    });
    const postsBefore = s.posts().length;
    const { rerender } = render(<GenSourceRead {...baseProps()} fetchImpl={s.fetchImpl} />);
    fireEvent.click(await enabled(CHECK));
    await screen.findByText(/Source checked at/);
    const postsAfterCheck = s.posts().length;
    rerender(<GenSourceRead {...baseProps(patch)} fetchImpl={s.fetchImpl} />);
    expect(screen.queryByText(/Source checked at/)).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(s.posts().length).toBe(postsAfterCheck);
    expect(postsAfterCheck).toBe(postsBefore + 1);
  });

  it('hides a prior result synchronously on fetchImpl change', async () => {
    const s1 = server((url) => url === GET_URL ? json(inventoryBody()) : json(resultBody()));
    const s2 = server((url) => url === GET_URL ? json(inventoryBody()) : json(resultBody()));
    const { rerender } = render(<GenSourceRead {...baseProps()} fetchImpl={s1.fetchImpl} />);
    fireEvent.click(await enabled(CHECK));
    await screen.findByText(/Source checked at/);
    rerender(<GenSourceRead {...baseProps()} fetchImpl={s2.fetchImpl} />);
    expect(screen.queryByText(/Source checked at/)).toBeNull();
  });

  it('discards a late GET whole response (headers and body together) that arrives after an owner (token) change', async () => {
    const firstGet = deferred<Response>();
    const s = server((url, _init, h) => {
      if (url !== GET_URL) return json(resultBody());
      return h.get('authorization') === 'Bearer a' ? firstGet.promise : json(inventoryBody({ availability: 'quarantined' }));
    });
    const { rerender } = render(<GenSourceRead {...baseProps({ token: 'a' })} fetchImpl={s.fetchImpl} />);
    await act(async () => { await Promise.resolve(); }); // let the first GET actually dispatch
    rerender(<GenSourceRead {...baseProps({ token: 'b' })} fetchImpl={s.fetchImpl} />);
    await screen.findByText(QUARANTINED_COPY);
    firstGet.resolve(json(inventoryBody({ availability: 'available' })));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText(QUARANTINED_COPY)).toBeTruthy();
    expect(button(CHECK).disabled).toBe(true);
  });

  it('discards a late GET body that is deferred independently after headers resolve, arriving after an owner (token) change', async () => {
    let textReads = 0;
    const oldBody = deferred<string>();
    const s = server((url, _init, h) => {
      if (url !== GET_URL) return json(resultBody());
      if (h.get('authorization') === 'Bearer a') {
        return { ok: true, status: 200, text: () => { textReads++; return oldBody.promise; } } as unknown as Response;
      }
      return json(inventoryBody({ availability: 'quarantined' }));
    });
    const { rerender } = render(<GenSourceRead {...baseProps({ token: 'a' })} fetchImpl={s.fetchImpl} />);
    await waitFor(() => expect(textReads).toBe(1)); // text() entered; body still pending
    rerender(<GenSourceRead {...baseProps({ token: 'b' })} fetchImpl={s.fetchImpl} />);
    await screen.findByText(QUARANTINED_COPY);
    oldBody.resolve(JSON.stringify(inventoryBody({ availability: 'available' })));
    await act(async () => { await Promise.resolve(); });
    expect(textReads).toBe(1);
    expect(screen.getByText(QUARANTINED_COPY)).toBeTruthy();
    expect(button(CHECK).disabled).toBe(true);
  });

  it('a stale POST result cannot overwrite a newer POST result, even when its late body arrives after the newer one already succeeded', async () => {
    const oldHeaders = deferred<Response>();
    const oldBody = deferred<string>();
    const readOldBody = vi.fn(() => oldBody.promise);
    const s = server((url, _init, h) => {
      if (url === GET_URL) return json(inventoryBody());
      if (h.get('authorization') === 'Bearer a') return oldHeaders.promise;
      return json(resultBody({ checkedAtUtc: NEW_CHECKED_AT }));
    });
    const { rerender } = render(<GenSourceRead {...baseProps({ token: 'a' })} fetchImpl={s.fetchImpl} />);
    fireEvent.click(await enabled(CHECK));
    await waitFor(() => expect(s.posts()).toHaveLength(1));
    expect(button(CHECK).textContent).toBe(CHECK_PENDING);
    // Old POST's headers resolve but its body remains pending independently.
    oldHeaders.resolve({ ok: true, status: 200, text: readOldBody } as unknown as Response);
    await waitFor(() => expect(readOldBody).toHaveBeenCalledTimes(1));
    rerender(<GenSourceRead {...baseProps({ token: 'b' })} fetchImpl={s.fetchImpl} />);
    fireEvent.click(await enabled(CHECK));
    await screen.findByText(`Source checked at ${NEW_CHECKED_AT}`);
    // Now release the old, stale POST's body.
    oldBody.resolve(JSON.stringify(resultBody({ checkedAtUtc: CHECKED_AT })));
    await act(async () => { await Promise.resolve(); });
    expect(readOldBody).toHaveBeenCalledTimes(1);
    expect(screen.getByText(`Source checked at ${NEW_CHECKED_AT}`)).toBeTruthy();
    expect(screen.queryByText(`Source checked at ${CHECKED_AT}`)).toBeNull();
  });

  it('a true A->B->A owner cycle discards a stale POST body from the original A generation, with its header and body resolving independently', async () => {
    const oldHeaders = deferred<Response>();
    const oldBody = deferred<string>();
    const readOldBody = vi.fn(() => oldBody.promise);
    const s = server((url, _init, h) => {
      if (url === GET_URL) return json(inventoryBody());
      if (h.get('authorization') === 'Bearer a') return oldHeaders.promise;
      return json(resultBody());
    });
    const { rerender } = render(<GenSourceRead {...baseProps({ token: 'a' })} fetchImpl={s.fetchImpl} />);
    fireEvent.click(await enabled(CHECK));
    await waitFor(() => expect(s.posts()).toHaveLength(1));
    expect(button(CHECK).textContent).toBe(CHECK_PENDING);
    oldHeaders.resolve({ ok: true, status: 200, text: readOldBody } as unknown as Response);
    await waitFor(() => expect(readOldBody).toHaveBeenCalledTimes(1));
    rerender(<GenSourceRead {...baseProps({ token: 'b' })} fetchImpl={s.fetchImpl} />);
    rerender(<GenSourceRead {...baseProps({ token: 'a' })} fetchImpl={s.fetchImpl} />);
    await enabled(CHECK);
    const postsBefore = s.posts().length;
    oldBody.resolve(JSON.stringify(resultBody({ checkedAtUtc: CHECKED_AT })));
    await act(async () => { await Promise.resolve(); });
    expect(readOldBody).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Source checked at/)).toBeNull();
    expect(s.posts().length).toBe(postsBefore);
  });

  it('unmounting in the same tick, before the deferred fetch microtask fires, issues zero POSTs', async () => {
    const s = server((url) => url === GET_URL ? json(inventoryBody()) : json(resultBody()));
    const { unmount } = render(<GenSourceRead {...baseProps()} fetchImpl={s.fetchImpl} />);
    await enabled(CHECK);
    fireEvent.click(button(CHECK));
    unmount();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(s.posts()).toHaveLength(0);
  });

  it('unmount after a check has already dispatched, then remount, never resurrects the old result or auto-POSTs', async () => {
    const s = server((url) => url === GET_URL ? json(inventoryBody()) : json(resultBody()));
    const { unmount } = render(<GenSourceRead {...baseProps()} fetchImpl={s.fetchImpl} />);
    fireEvent.click(await enabled(CHECK));
    await screen.findByText(/Source checked at/);
    unmount();
    render(<GenSourceRead {...baseProps()} fetchImpl={s.fetchImpl} />);
    await enabled(CHECK);
    expect(screen.queryByText(/Source checked at/)).toBeNull();
    expect(s.posts()).toHaveLength(1);
  });

  it('discards a late POST resolved after unmount and does not auto-POST on remount', async () => {
    const post = deferred<Response>();
    const s = server((url) => url === GET_URL ? json(inventoryBody()) : post.promise);
    const { unmount } = render(<GenSourceRead {...baseProps()} fetchImpl={s.fetchImpl} />);
    fireEvent.click(await enabled(CHECK));
    await waitFor(() => expect(s.posts()).toHaveLength(1));
    unmount();
    post.resolve(json(resultBody()));
    await new Promise((resolve) => setTimeout(resolve, 0));
    render(<GenSourceRead {...baseProps()} fetchImpl={s.fetchImpl} />);
    await enabled(CHECK);
    expect(screen.queryByText(/Source checked at/)).toBeNull();
    expect(s.posts()).toHaveLength(1);
  });

  it('StrictMode does not duplicate the POST or reanimate stale data', async () => {
    const s = server((url) => url === GET_URL ? json(inventoryBody()) : json(resultBody()));
    render(<StrictMode><GenSourceRead {...baseProps()} fetchImpl={s.fetchImpl} /></StrictMode>);
    fireEvent.click(await enabled(CHECK));
    await screen.findByText(/Source checked at/);
    expect(s.posts()).toHaveLength(1);
  });
});

describe('GenSourceRead timeouts', () => {
  beforeEach(() => vi.useFakeTimers());

  it('a 30s GET timeout clears loading, shows fixed unavailable copy, ignores a later completion, and leaves no live timers', async () => {
    const pendingText = deferred<string>();
    const s = server(() => fakeResponse(200, pendingText.promise));
    const { unmount } = render(<GenSourceRead {...baseProps()} fetchImpl={s.fetchImpl} />);
    await flushMicrotasks(); // let the deferred GET actually dispatch before advancing timers
    expect(s.gets()).toHaveLength(1);
    await act(async () => { vi.advanceTimersByTime(30_000); });
    expect(screen.getByRole('alert').textContent).toBe(GET_UNAVAILABLE);
    pendingText.resolve(JSON.stringify(inventoryBody()));
    await flushMicrotasks();
    expect(screen.getByRole('alert').textContent).toBe(GET_UNAVAILABLE);
    expect(button(CHECK).disabled).toBe(true);
    expect(screen.queryByText(/Source checked at/)).toBeNull();
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a 150s POST timeout clears the pending state, shows the fixed timeout copy, and permanently ignores a later completion with no new timer', async () => {
    const pendingText = deferred<string>();
    const s = server((url) => url === GET_URL ? json(inventoryBody()) : fakeResponse(200, pendingText.promise));
    render(<GenSourceRead {...baseProps()} fetchImpl={s.fetchImpl} />);
    await flushMicrotasks(); // let the GET dispatch and resolve
    expect(button(CHECK).disabled).toBe(false);
    fireEvent.click(button(CHECK));
    await flushMicrotasks(); // let the deferred POST actually dispatch before advancing timers
    expect(s.posts()).toHaveLength(1);
    await act(async () => { vi.advanceTimersByTime(150_000); });
    expect(screen.getByRole('alert').textContent).toBe(POST_TIMEOUT_COPY);
    expect(button(CHECK).disabled).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    // The server eventually "completes" the abandoned request; the component must ignore it.
    pendingText.resolve(JSON.stringify(resultBody()));
    await flushMicrotasks();
    expect(screen.getByRole('alert').textContent).toBe(POST_TIMEOUT_COPY);
    expect(screen.queryByText(/Source checked at/)).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    expect(s.posts()).toHaveLength(1);
  });

  it('the POST timer and controller are cleared on unmount before the timeout fires', async () => {
    const pendingText = deferred<string>();
    const s = server((url) => url === GET_URL ? json(inventoryBody()) : fakeResponse(200, pendingText.promise));
    const { unmount } = render(<GenSourceRead {...baseProps()} fetchImpl={s.fetchImpl} />);
    await flushMicrotasks();
    expect(button(CHECK).disabled).toBe(false);
    fireEvent.click(button(CHECK));
    await flushMicrotasks();
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a settled GET before the timeout clears the GET timer', async () => {
    const s = server(() => json(inventoryBody()));
    const { unmount } = render(<GenSourceRead {...baseProps()} fetchImpl={s.fetchImpl} />);
    await flushMicrotasks();
    expect(button(CHECK).disabled).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    unmount();
  });

  it('leaves zero live timers after a successful GET and POST, and after unmount', async () => {
    const s = server((url) => url === GET_URL ? json(inventoryBody()) : json(resultBody()));
    const { unmount } = render(<GenSourceRead {...baseProps()} fetchImpl={s.fetchImpl} />);
    await flushMicrotasks();
    expect(button(CHECK).disabled).toBe(false);
    fireEvent.click(button(CHECK));
    await flushMicrotasks();
    expect(screen.getByText(`Source checked at ${CHECKED_AT}`)).toBeTruthy();
    expect(vi.getTimerCount()).toBe(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
