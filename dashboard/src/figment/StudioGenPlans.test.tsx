// @vitest-environment jsdom
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StudioGenPlans } from './StudioGenPlans';

const STORAGE_KEY = 'figment.studio.genPlan.pending.v1';
const GET_URL = '/api/figment/studio/gen-plans';
const POST_URL = '/api/figment/studio/gen-plan';
const SCOPE_A = 'a'.repeat(64);
const SCOPE_B = 'b'.repeat(64);
const KEY_E = 'e'.repeat(48);
const PREPARE_UNAVAILABLE = 'Generation plan preparation is unavailable. A current selected checkpoint and source authority are required before a plan can be prepared.';
const GET_UNAVAILABLE = 'Studio generation plans are unavailable.';
const STORAGE_BLOCKED = 'A generation plan request could not be recorded. Preparation is blocked until it can be.';
const PENDING_UNREADABLE = 'A stored generation plan request could not be read. Preparation is blocked and the stored request has been left in place.';
const PENDING_FOREIGN = 'A stored generation plan request belongs to a different operator or workspace. Preparation is blocked and the stored request has been left in place.';
const CLEAR_FAILED = 'The generation plan was prepared, but its pending request record could not be cleared. New preparation is blocked; resuming replays the same request.';
const STATUS = {
  'available': 'Preparation status: Preparation is available.',
  'busy': 'Preparation status: Another preparation is in progress. Refresh status once it finishes.',
  'at-capacity': 'Preparation status: At capacity: two prepared plans already exist. New preparation is disabled; a pending request can still be resumed.',
  'maintenance-required': 'Preparation status: Maintenance is required before new plans can be prepared. A pending request can still be resumed.',
  'unavailable': 'Preparation status: Preparation is unavailable. A current selected checkpoint and source authority are required.',
} as const;
const PREPARE = 'Prepare generation plan';
const RESUME = 'Resume preparation request';
const PREPARING = 'Preparing generation plan…';
const REFRESH = 'Refresh status';
const SUMMARY = /creator-001 · gen · one prepared run · declared \$2\.50 · plan cccccccccccc/;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const plansBody = (overrides: Record<string, unknown> = {}) => ({ schema: 'figment/studio-gen-plans@1', requestScope: SCOPE_A, plans: [], preparation: 'available', ...overrides });
const preparedBody = (overrides: Record<string, unknown> = {}) => ({ schema: 'figment/studio-gen-plan@1', id: '00000000-0000-4000-8000-000000000000', status: 'prepared', creator: 'creator-001', stage: 'gen', runCount: 1, declaredCeilingUsd: 2.5, planSha256: 'c'.repeat(64), ...overrides });
const record = (scope: string, key: string) => JSON.stringify({ schema: 'figment/studio-gen-plan-pending@1', requestScope: scope, key });
const realGetItem = Storage.prototype.getItem;

function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

type Handler = (url: string, init: RequestInit | undefined, headers: Headers) => Promise<Response> | Response;
function server(handler: Handler) {
  const mock = vi.fn(async (url: string, init?: RequestInit) => handler(url, init, new Headers(init?.headers)));
  const posts = () => mock.mock.calls.filter(([url]) => url === POST_URL);
  const gets = () => mock.mock.calls.filter(([url]) => url === GET_URL);
  const postKeys = () => posts().map(([, init]) => new Headers(init?.headers).get('Idempotency-Key'));
  return { fetchImpl: mock as unknown as typeof fetch, posts, gets, postKeys };
}
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
async function enabled(name: string): Promise<HTMLButtonElement> {
  await waitFor(() => expect(button(name).disabled).toBe(false));
  return button(name);
}
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

beforeEach(() => sessionStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); sessionStorage.clear(); });

describe('StudioGenPlans discovery', () => {
  it('reads status with the session token and never POSTs on mount, even with a same-scope pending intent', async () => {
    sessionStorage.setItem(STORAGE_KEY, record(SCOPE_A, KEY_E));
    const s = server((url) => url === GET_URL ? json(plansBody()) : json(preparedBody()));
    render(<StudioGenPlans token="session" fetchImpl={s.fetchImpl} />);
    await enabled(RESUME);
    await flush();
    expect(s.posts()).toHaveLength(0);
    const [, init] = s.gets()[0]!;
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer session');
    expect(init?.method).toBeUndefined(); expect(init?.body).toBeUndefined();
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe(record(SCOPE_A, KEY_E));
  });

  it('keeps every mutation disabled while the status GET is loading', async () => {
    const get = deferred<Response>();
    const s = server(() => get.promise);
    render(<StudioGenPlans token="session" fetchImpl={s.fetchImpl} />);
    expect(screen.getByText('Checking preparation status…')).toBeTruthy();
    expect(button(PREPARE).disabled).toBe(true);
    expect(button(REFRESH).disabled).toBe(true);
    get.resolve(json(plansBody()));
    await enabled(PREPARE);
  });

  it.each([
    ['server failure', () => json({ error: 'x' }, 500)],
    ['network failure', () => Promise.reject(new Error('offline'))],
    ['non-JSON body', () => new Response('<html>', { status: 200 })],
    ['extra field', () => json({ ...plansBody(), path: 'C:/secret' })],
    ['three plans', () => json(plansBody({ plans: [preparedBody(), preparedBody({ id: '00000000-0000-4000-8000-000000000001' }), preparedBody({ id: '00000000-0000-4000-8000-000000000002' })] }))],
    ['duplicate plan ids', () => json(plansBody({ plans: [preparedBody(), preparedBody()] }))],
    ['plan with extra field', () => json(plansBody({ plans: [{ ...preparedBody(), marker: 'raw' }] }))],
    ['bad scope', () => json(plansBody({ requestScope: 'A'.repeat(64) }))],
    ['unknown preparation', () => json(plansBody({ preparation: 'ready' }))],
  ])('fails closed on a %s status response', async (_name, reply) => {
    const s = server((url) => url === GET_URL ? reply() : json(preparedBody()));
    render(<StudioGenPlans token="session" fetchImpl={s.fetchImpl} />);
    await screen.findByText(GET_UNAVAILABLE);
    expect(button(PREPARE).disabled).toBe(true);
    fireEvent.click(button(PREPARE));
    await flush();
    expect(s.posts()).toHaveLength(0);
    expect(document.body.textContent).not.toMatch(/secret|raw|html/);
  });

  it('Refresh status recovers from a failed GET without POSTing and without touching a pending intent', async () => {
    sessionStorage.setItem(STORAGE_KEY, record(SCOPE_A, KEY_E));
    let fail = true;
    const s = server((url) => url === GET_URL ? (fail ? json({}, 503) : json(plansBody({ preparation: 'maintenance-required' }))) : json(preparedBody()));
    render(<StudioGenPlans token="session" fetchImpl={s.fetchImpl} />);
    await screen.findByText(GET_UNAVAILABLE);
    fail = false;
    fireEvent.click(await enabled(REFRESH));
    await screen.findByText(STATUS['maintenance-required']);
    await enabled(RESUME);
    expect(s.gets()).toHaveLength(2);
    expect(s.posts()).toHaveLength(0);
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe(record(SCOPE_A, KEY_E));
  });

  it('shows verified stored plan summaries as snapshots with fixed availability copy', async () => {
    const s = server(() => json(plansBody({ preparation: 'at-capacity', plans: [preparedBody(), preparedBody({ id: '00000000-0000-4000-8000-000000000001', declaredCeilingUsd: 3 })] })));
    render(<StudioGenPlans token="session" fetchImpl={s.fetchImpl} />);
    await screen.findByText(STATUS['at-capacity']);
    expect(screen.getByText('Stored plan summaries are recorded snapshots, not live validity checks.')).toBeTruthy();
    expect(screen.getAllByText(/prepared · one prepared run · declared/)).toHaveLength(2);
    expect(button(PREPARE).disabled).toBe(true);
  });
});

describe('StudioGenPlans intent lifecycle', () => {
  it('persists and reads back the exact intent before a POST with the exact scope header, then clears it and re-reads status', async () => {
    const seen: { stored?: string | null; init?: RequestInit } = {};
    const s = server((url, init) => {
      if (url === GET_URL) return json(plansBody());
      seen.stored = sessionStorage.getItem(STORAGE_KEY); seen.init = init;
      return json(preparedBody());
    });
    render(<StudioGenPlans token="session" fetchImpl={s.fetchImpl} />);
    fireEvent.click(await enabled(PREPARE));
    await screen.findByText(SUMMARY);
    const headers = new Headers(seen.init?.headers);
    expect(seen.init?.method).toBe('POST'); expect(seen.init?.body).toBeUndefined();
    expect(headers.get('authorization')).toBe('Bearer session');
    expect(headers.get('X-Figment-Intent-Scope')).toBe(SCOPE_A);
    const key = headers.get('Idempotency-Key')!;
    expect(key).toMatch(/^[0-9a-f]{48}$/);
    expect(seen.stored).toBe(record(SCOPE_A, key));
    await waitFor(() => expect(s.gets()).toHaveLength(2));
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('recovers a lost success across remount by explicitly replaying the same key', async () => {
    const first = server((url) => url === GET_URL ? json(plansBody()) : Promise.reject(new Error('response lost')));
    const { unmount } = render(<StudioGenPlans token="session" fetchImpl={first.fetchImpl} />);
    fireEvent.click(await enabled(PREPARE));
    await screen.findByText(PREPARE_UNAVAILABLE);
    const key = first.postKeys()[0]!;
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe(record(SCOPE_A, key));
    unmount();
    const second = server((url) => url === GET_URL ? json(plansBody({ preparation: 'at-capacity' })) : json(preparedBody()));
    render(<StudioGenPlans token="session" fetchImpl={second.fetchImpl} />);
    const resume = await enabled(RESUME);
    expect(second.posts()).toHaveLength(0);
    fireEvent.click(resume);
    await screen.findByText(SUMMARY);
    expect(second.postKeys()).toEqual([key]);
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('never rotates the key across malformed 200, 503, 429, 409 and network failures, with fixed copy', async () => {
    const replies = [
      () => new Response('{"plan": <bad', { status: 200 }),
      () => json({ ...preparedBody(), extra: 'leak' }),
      () => new Response('exploded', { status: 503 }),
      () => json({ error: 'rate-limited' }, 429),
      () => json({ error: 'intent-scope-conflict' }, 409),
      () => Promise.reject(new Error('socket hang up')),
    ];
    const s = server((url) => url === GET_URL ? json(plansBody()) : (replies[s.posts().length - 1] ?? (() => json(preparedBody())))());
    render(<StudioGenPlans token="session" fetchImpl={s.fetchImpl} />);
    fireEvent.click(await enabled(PREPARE));
    for (let attempt = 1; attempt <= replies.length; attempt += 1) {
      await waitFor(() => expect(s.gets()).toHaveLength(attempt + 1));
      expect(screen.getByText(PREPARE_UNAVAILABLE)).toBeTruthy();
      expect(document.body.textContent).not.toMatch(/bad|leak|exploded|rate-limited|conflict|socket/);
      fireEvent.click(await enabled(RESUME));
    }
    await screen.findByText(SUMMARY);
    const keys = s.postKeys();
    expect(keys).toHaveLength(replies.length + 1);
    expect(new Set(keys).size).toBe(1);
  });

  it('collapses double clicks on Prepare and on Resume into one POST each', async () => {
    const post = deferred<Response>();
    const s = server((url) => url === GET_URL ? json(plansBody()) : s.posts().length === 1 ? post.promise : json(preparedBody()));
    render(<StudioGenPlans token="session" fetchImpl={s.fetchImpl} />);
    const prepare = await enabled(PREPARE);
    fireEvent.click(prepare); fireEvent.click(prepare);
    expect(button(PREPARING).disabled).toBe(true);
    expect(button(REFRESH).disabled).toBe(true);
    await flush();
    expect(s.posts()).toHaveLength(1);
    post.resolve(json({}, 503));
    const resume = await enabled(RESUME);
    fireEvent.click(resume); fireEvent.click(resume);
    await screen.findByText(SUMMARY);
    expect(s.posts()).toHaveLength(2);
    expect(new Set(s.postKeys()).size).toBe(1);
  });

  it('re-reads status after a failed POST so availability is accurate', async () => {
    let preparation = 'available';
    const s = server((url) => { if (url === GET_URL) return json(plansBody({ preparation })); preparation = 'busy'; return json({}, 503); });
    render(<StudioGenPlans token="session" fetchImpl={s.fetchImpl} />);
    fireEvent.click(await enabled(PREPARE));
    await screen.findByText(STATUS.busy);
    expect(button(RESUME).disabled).toBe(true);
    expect(s.gets()).toHaveLength(2);
  });

  it.each(['at-capacity', 'maintenance-required'] as const)('replays a same-scope pending intent at %s with the scope header', async (preparation) => {
    sessionStorage.setItem(STORAGE_KEY, record(SCOPE_A, KEY_E));
    const seen: { headers?: Headers } = {};
    const s = server((url, _init, h) => { if (url === GET_URL) return json(plansBody({ preparation })); seen.headers = h; return json(preparedBody()); });
    render(<StudioGenPlans token="session" fetchImpl={s.fetchImpl} />);
    await screen.findByText(STATUS[preparation]);
    expect(button(RESUME)).toBeTruthy();
    fireEvent.click(await enabled(RESUME));
    await screen.findByText(SUMMARY);
    expect(s.posts()).toHaveLength(1);
    expect(seen.headers?.get('Idempotency-Key')).toBe(KEY_E);
    expect(seen.headers?.get('X-Figment-Intent-Scope')).toBe(SCOPE_A);
  });

  it.each(['busy', 'unavailable'] as const)('allows no mutation at all while %s', async (preparation) => {
    const s = server((url) => url === GET_URL ? json(plansBody({ preparation })) : json(preparedBody()));
    const { unmount } = render(<StudioGenPlans token="session" fetchImpl={s.fetchImpl} />);
    await screen.findByText(STATUS[preparation]);
    expect(button(PREPARE).disabled).toBe(true);
    fireEvent.click(button(PREPARE));
    unmount();
    sessionStorage.setItem(STORAGE_KEY, record(SCOPE_A, KEY_E));
    render(<StudioGenPlans token="session" fetchImpl={s.fetchImpl} />);
    await screen.findByText(STATUS[preparation]);
    expect(button(RESUME).disabled).toBe(true);
    fireEvent.click(button(RESUME));
    await flush();
    expect(s.posts()).toHaveLength(0);
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe(record(SCOPE_A, KEY_E));
  });

  it('does not offer a new prepare at capacity without a pending intent', async () => {
    const s = server(() => json(plansBody({ preparation: 'at-capacity' })));
    render(<StudioGenPlans token="session" fetchImpl={s.fetchImpl} />);
    await screen.findByText(STATUS['at-capacity']);
    expect(button(PREPARE).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: RESUME })).toBeNull();
  });
});

describe('StudioGenPlans storage boundaries', () => {
  it.each([
    ['corrupt JSON', '{not json'],
    ['oversized record', JSON.stringify({ schema: 'figment/studio-gen-plan-pending@1', requestScope: SCOPE_A, key: KEY_E, pad: 'x'.repeat(600) })],
    ['extra field', JSON.stringify({ schema: 'figment/studio-gen-plan-pending@1', requestScope: SCOPE_A, key: KEY_E, token: 'secret' })],
    ['bad key', record(SCOPE_A, 'E'.repeat(48))],
  ])('blocks mutation and preserves the bytes of a %s pending record', async (_name, raw) => {
    sessionStorage.setItem(STORAGE_KEY, raw);
    const s = server((url) => url === GET_URL ? json(plansBody()) : json(preparedBody()));
    render(<StudioGenPlans token="session" fetchImpl={s.fetchImpl} />);
    await screen.findByText(PENDING_UNREADABLE);
    expect(button(PREPARE).disabled).toBe(true);
    fireEvent.click(button(PREPARE));
    fireEvent.click(await enabled(REFRESH));
    await waitFor(() => expect(s.gets()).toHaveLength(2));
    await enabled(REFRESH);
    expect(screen.getByText(PENDING_UNREADABLE)).toBeTruthy();
    expect(button(PREPARE).disabled).toBe(true);
    expect(s.posts()).toHaveLength(0);
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe(raw);
    expect(document.body.textContent).not.toMatch(/secret/);
  });

  it('blocks mutation and preserves a foreign-scope record', async () => {
    sessionStorage.setItem(STORAGE_KEY, record(SCOPE_B, KEY_E));
    const s = server((url) => url === GET_URL ? json(plansBody()) : json(preparedBody()));
    render(<StudioGenPlans token="session" fetchImpl={s.fetchImpl} />);
    await screen.findByText(PENDING_FOREIGN);
    expect(button(PREPARE).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: RESUME })).toBeNull();
    fireEvent.click(button(PREPARE));
    await flush();
    expect(s.posts()).toHaveLength(0);
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe(record(SCOPE_B, KEY_E));
  });

  it('re-reads storage at allocation time and never overwrites a record that appeared after status was read', async () => {
    const s = server((url) => url === GET_URL ? json(plansBody()) : json(preparedBody()));
    render(<StudioGenPlans token="session" fetchImpl={s.fetchImpl} />);
    const prepare = await enabled(PREPARE);
    sessionStorage.setItem(STORAGE_KEY, record(SCOPE_B, KEY_E));
    fireEvent.click(prepare);
    await screen.findByText(PENDING_FOREIGN);
    expect(s.posts()).toHaveLength(0);
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe(record(SCOPE_B, KEY_E));
  });

  it('blocks mutation with fixed copy when getItem throws, with no memory-only fallback', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    const s = server((url) => url === GET_URL ? json(plansBody()) : json(preparedBody()));
    render(<StudioGenPlans token="session" fetchImpl={s.fetchImpl} />);
    await screen.findByText(PENDING_UNREADABLE);
    expect(button(PREPARE).disabled).toBe(true);
    fireEvent.click(button(PREPARE));
    await flush();
    expect(s.posts()).toHaveLength(0);
  });

  it('blocks mutation with fixed copy when setItem throws, with no memory-only fallback', async () => {
    const s = server((url) => url === GET_URL ? json(plansBody()) : json(preparedBody()));
    render(<StudioGenPlans token="session" fetchImpl={s.fetchImpl} />);
    const prepare = await enabled(PREPARE);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    fireEvent.click(prepare);
    await screen.findByText(STORAGE_BLOCKED);
    expect(button(PREPARE).disabled).toBe(true);
    await flush();
    expect(s.posts()).toHaveLength(0);
  });

  it('blocks the POST when the read-back after writing fails, and leaves the written bytes in place', async () => {
    const s = server((url) => url === GET_URL ? json(plansBody()) : json(preparedBody()));
    render(<StudioGenPlans token="session" fetchImpl={s.fetchImpl} />);
    const prepare = await enabled(PREPARE);
    const spy = vi.spyOn(Storage.prototype, 'getItem');
    spy.mockImplementationOnce((key: string) => realGetItem.call(sessionStorage, key)).mockImplementation(() => { throw new Error('denied'); });
    fireEvent.click(prepare);
    await screen.findByText(PENDING_UNREADABLE);
    await flush();
    expect(s.posts()).toHaveLength(0);
    spy.mockRestore();
    expect(JSON.parse(sessionStorage.getItem(STORAGE_KEY)!)).toMatchObject({ requestScope: SCOPE_A });
  });

  it('retains the same key when removeItem throws after a valid success, and blocks new intents', async () => {
    const s = server((url) => url === GET_URL ? json(plansBody()) : json(preparedBody()));
    render(<StudioGenPlans token="session" fetchImpl={s.fetchImpl} />);
    const prepare = await enabled(PREPARE);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked'); });
    fireEvent.click(prepare);
    await screen.findByText(SUMMARY);
    await screen.findByText(CLEAR_FAILED);
    const key = s.postKeys()[0]!;
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe(record(SCOPE_A, key));
    fireEvent.click(await enabled(RESUME));
    await waitFor(() => expect(s.posts()).toHaveLength(2));
    expect(s.postKeys()).toEqual([key, key]);
  });

  it('treats a removal that does not take effect as a failed clear', async () => {
    const s = server((url) => url === GET_URL ? json(plansBody()) : json(preparedBody()));
    render(<StudioGenPlans token="session" fetchImpl={s.fetchImpl} />);
    const prepare = await enabled(PREPARE);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => undefined);
    fireEvent.click(prepare);
    await screen.findByText(CLEAR_FAILED);
    await enabled(RESUME);
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe(record(SCOPE_A, s.postKeys()[0]!));
  });

  it('treats an unreadable record at clear time as a failed clear and preserves it', async () => {
    const restore: Array<() => void> = [];
    const s = server((url) => {
      if (url === GET_URL) return json(plansBody());
      const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
      restore.push(() => spy.mockRestore());
      return json(preparedBody());
    });
    render(<StudioGenPlans token="session" fetchImpl={s.fetchImpl} />);
    fireEvent.click(await enabled(PREPARE));
    await screen.findByText(CLEAR_FAILED);
    await screen.findByText(PENDING_UNREADABLE);
    expect(button(PREPARE).disabled).toBe(true);
    restore.forEach((undo) => undo());
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe(record(SCOPE_A, s.postKeys()[0]!));
    expect(s.posts()).toHaveLength(1);
  });

  it('never clears a different record that replaced the intent while the POST was in flight', async () => {
    const s = server((url) => {
      if (url === GET_URL) return json(plansBody());
      sessionStorage.setItem(STORAGE_KEY, record(SCOPE_A, KEY_E));
      return json(preparedBody());
    });
    render(<StudioGenPlans token="session" fetchImpl={s.fetchImpl} />);
    fireEvent.click(await enabled(PREPARE));
    await screen.findByText(SUMMARY);
    await enabled(RESUME);
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe(record(SCOPE_A, KEY_E));
  });
});

describe('StudioGenPlans lifecycle and auth changes', () => {
  it('applies a POST success under React.StrictMode', async () => {
    const s = server((url) => url === GET_URL ? json(plansBody()) : json(preparedBody()));
    render(<StrictMode><StudioGenPlans token="session" fetchImpl={s.fetchImpl} /></StrictMode>);
    fireEvent.click(await enabled(PREPARE));
    await screen.findByText(SUMMARY);
    expect(s.posts()).toHaveLength(1);
    await waitFor(() => expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull());
    await enabled(PREPARE);
  });

  it('ignores a stale GET after a token change', async () => {
    sessionStorage.setItem(STORAGE_KEY, record(SCOPE_B, KEY_E));
    const firstGet = deferred<Response>();
    const s = server((url, _init, headers) => url === GET_URL && headers.get('authorization') === 'Bearer first' ? firstGet.promise : json(plansBody({ requestScope: SCOPE_B })));
    const { rerender } = render(<StudioGenPlans token="first" fetchImpl={s.fetchImpl} />);
    rerender(<StudioGenPlans token="second" fetchImpl={s.fetchImpl} />);
    await enabled(RESUME);
    firstGet.resolve(json(plansBody({ requestScope: SCOPE_A })));
    await flush();
    expect(screen.queryByText(PENDING_FOREIGN)).toBeNull();
    expect(button(RESUME).disabled).toBe(false);
  });

  it('ignores a stale GET after a fetchImpl change', async () => {
    const firstGet = deferred<Response>();
    const first = server(() => firstGet.promise);
    const second = server(() => json(plansBody({ preparation: 'busy' })));
    const { rerender } = render(<StudioGenPlans token="session" fetchImpl={first.fetchImpl} />);
    rerender(<StudioGenPlans token="session" fetchImpl={second.fetchImpl} />);
    await screen.findByText(STATUS.busy);
    firstGet.resolve(json(plansBody()));
    await flush();
    expect(screen.getByText(STATUS.busy)).toBeTruthy();
    expect(button(PREPARE).disabled).toBe(true);
  });

  it('a stale POST after a token change neither keeps the UI locked, unlocks a newer request, nor clears the intent', async () => {
    const oldPost = deferred<Response>();
    const newPost = deferred<Response>();
    const s = server((url, _init, headers) => url === GET_URL ? json(plansBody()) : headers.get('authorization') === 'Bearer first' ? oldPost.promise : newPost.promise);
    const { rerender } = render(<StudioGenPlans token="first" fetchImpl={s.fetchImpl} />);
    fireEvent.click(await enabled(PREPARE));
    expect(button(PREPARING).disabled).toBe(true);
    const key = s.postKeys()[0]!;
    rerender(<StudioGenPlans token="second" fetchImpl={s.fetchImpl} />);
    fireEvent.click(await enabled(RESUME));
    expect(button(PREPARING).disabled).toBe(true);
    oldPost.resolve(json(preparedBody()));
    await flush();
    expect(button(PREPARING).disabled).toBe(true);
    expect(screen.queryByText(SUMMARY)).toBeNull();
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe(record(SCOPE_A, key));
    newPost.resolve(json(preparedBody()));
    await screen.findByText(SUMMARY);
    expect(s.postKeys()).toEqual([key, key]);
    expect(new Headers(s.posts()[1]![1]?.headers).get('authorization')).toBe('Bearer second');
    await waitFor(() => expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull());
  });

  it('a POST response arriving after unmount does not clear the intent', async () => {
    const post = deferred<Response>();
    const s = server((url) => url === GET_URL ? json(plansBody()) : post.promise);
    const { unmount } = render(<StudioGenPlans token="session" fetchImpl={s.fetchImpl} />);
    fireEvent.click(await enabled(PREPARE));
    const key = s.postKeys()[0]!;
    unmount();
    post.resolve(json(preparedBody()));
    await flush();
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe(record(SCOPE_A, key));
    expect(s.gets()).toHaveLength(1);
  });
});
