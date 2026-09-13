// @vitest-environment jsdom
import { StrictMode, Suspense, startTransition, useState } from 'react';
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
  'available': 'Preparation status: Local preparation checks passed. Checkpoint and source authority are checked when preparation runs.',
  'busy': 'Preparation status: Another preparation is in progress. Refresh status once it finishes.',
  'at-capacity': 'Preparation status: At capacity: two prepared plans already exist. New preparation is disabled; a pending request can still be resumed.',
  'maintenance-required': 'Preparation status: Maintenance is required before new plans can be prepared. A pending request can still be resumed.',
  'unavailable': 'Preparation status: Local preparation is unavailable.',
} as const;
const PREPARE = 'Prepare generation plan';
const RESUME = 'Resume preparation request';
const PREPARING = 'Preparing generation plan…';
const REFRESH = 'Refresh status';
const SUMMARY = /creator-001 · gen · one prepared run · declared \$2\.50 · plan cccccccccccc/;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const plansBody = (overrides: Record<string, unknown> = {}) => {
  const plans = Array.isArray(overrides.plans) ? overrides.plans : [];
  return { schema: 'figment/studio-gen-plans@3', requestScope: SCOPE_A, plans, preparation: 'available',
    executionRecords: plans.map((plan: { id: string; planSha256: string }) => ({ id: plan.id, planSha256: plan.planSha256, state: { status: 'unavailable', reason: 'evidence-unavailable' } })),
    assignmentRecords: plans.map((plan: { id: string; planSha256: string }) => ({ id: plan.id, planSha256: plan.planSha256, state: { status: 'unavailable', reason: 'evidence-unavailable' } })), ...overrides };
};
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


const EXECUTION_COPY = {
  'no-stage-record': 'No stage record; attempt history is unknown.',
  'recorded-running': 'Recorded running; current liveness is unknown.',
  'recorded-failed': 'Recorded failure.',
  'recorded-completed': 'Recorded completion; media quality has not been assessed.',
  'unavailable': 'Recorded execution status is unavailable.',
} as const;
const recordedReceipt = (overrides: Record<string, unknown> = {}) => ({ startedUtc: '2026-09-12T18:00:00Z', finishedUtc: '2026-09-12T18:05:00Z',
  terminationVerified: true, outputCount: 3, preflightEstimateUsd: 2.5, estimatedActualUsd: 0.1, failure: null, ...overrides });
const recordedState = (execution = 'no-stage-record', overrides: Record<string, unknown> = {}) => ({
  status: 'recorded', planSha256: 'c'.repeat(64), creator: 'creator-001', stage: 'gen', execution,
  liveness: execution === 'recorded-completed' ? null : 'unknown', quality: 'not-assessed', declaredCeilingUsd: 2.5, maxMinutes: 115,
  receipt: execution === 'recorded-completed' ? recordedReceipt() : null, ...overrides,
});
const executionRow = (state: unknown, plan = preparedBody()) => ({ id: plan.id, planSha256: plan.planSha256, state });
const statusBody = (state: unknown) => plansBody({ plans: [preparedBody()], executionRecords: [executionRow(state)] });
const without = (value: Record<string, unknown>, key: string) => Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));

const slotRecord = (overrides: Record<string, unknown> = {}) => ({ briefId: 'revision-a', briefSha256: 'f'.repeat(64), slotIndex: 1, role: 'hook', kind: 'persona', taxonomyType: 'A', ...overrides });
const assignmentState = (slots: unknown[] = [slotRecord()]) => ({ status: 'recorded', recordKind: 'planning-snapshot', currentSourceRevalidated: false, slots });
const assignmentBody = (state: unknown = assignmentState()) => plansBody({ plans: [preparedBody()], assignmentRecords: [executionRow(state)] });
const secondPlan = preparedBody({ id: '00000000-0000-4000-8000-000000000001', planSha256: 'd'.repeat(64) });
const twoAssignments = (first: unknown[], second: unknown[]) => plansBody({ plans: [preparedBody(), secondPlan],
  assignmentRecords: [executionRow(assignmentState(first)), executionRow(assignmentState(second), secondPlan)] });

describe('StudioGenPlans recorded assignment contract', () => {
  it('reloads owner A after a rendered B transition suspends before commit and is discarded', async () => {
    const original = deferred<Response>(), fresh = deferred<Response>(), suspended = deferred<never>();
    const s = server(() => s.gets().length === 1 ? original.promise : fresh.promise);
    let renderedB = 0, enterB!: () => void, returnA!: () => void;
    function Tail({ owner }: { owner: string }) { if (owner === 'b') { renderedB += 1; throw suspended.promise; } return null; }
    function Harness() {
      const [mode, setMode] = useState({ owner: 'a', revision: 0 });
      enterB = () => startTransition(() => setMode({ owner: 'b', revision: 1 }));
      returnA = () => setMode({ owner: 'a', revision: 2 });
      return <Suspense fallback={<p>Suspended owner fallback</p>}><StudioGenPlans token={mode.owner} fetchImpl={s.fetchImpl} onOpenRecordedSlot={vi.fn()} /><Tail owner={mode.owner} /></Suspense>;
    }
    render(<Harness />); await waitFor(() => expect(s.gets()).toHaveLength(1));
    await act(async () => enterB());
    expect(renderedB).toBeGreaterThan(0); expect(screen.queryByText('Suspended owner fallback')).toBeNull();
    expect(s.gets()).toHaveLength(1); // B rendered, but its effect never committed.
    act(() => returnA()); await waitFor(() => expect(s.gets()).toHaveLength(2));
    await act(async () => original.resolve(json(assignmentBody())));
    expect(screen.queryByRole('button', { name: 'View revision-a slot 1' })).toBeNull();
    await act(async () => fresh.resolve(json(assignmentBody(assignmentState([])))));
    await screen.findByText('No matching assignment records in this inventory.'); await enabled(PREPARE);
    expect(s.gets().every(([, init]) => new Headers(init?.headers).get('authorization') === 'Bearer a')).toBe(true);
    expect(s.posts()).toHaveLength(0);
  });

  it('renders bounded recorded slots and sends the exact six-field target only on explicit navigation', async () => {
    const target = slotRecord(), onOpenRecordedSlot = vi.fn();
    const s = server(() => json(assignmentBody()));
    render(<StudioGenPlans token="session" fetchImpl={s.fetchImpl} onOpenRecordedSlot={onOpenRecordedSlot} />);
    const open = await screen.findByRole('button', { name: 'View revision-a slot 1' });
    expect(screen.getByText('Matching records in the bounded current inventory. Sources and image approval were not revalidated.')).toBeTruthy();
    expect(screen.getByText(/revision ffffffffffff.*slot 1: hook/)).toBeTruthy();
    expect(onOpenRecordedSlot).not.toHaveBeenCalled();
    fireEvent.click(open);
    expect(onOpenRecordedSlot.mock.calls).toEqual([[target]]);
    expect(s.gets()).toHaveLength(1); expect(s.posts()).toHaveLength(0);
    expect(document.body.textContent).not.toMatch(/never used|approved assignment|assignment history complete/i);
  });

  it('keeps slot text without a navigation button when no callback is supplied', async () => {
    const s = server(() => json(assignmentBody()));
    render(<StudioGenPlans fetchImpl={s.fetchImpl} />);
    await screen.findByText(/Recorded planning assignment: revision-a/);
    expect(screen.queryByRole('button', { name: /View .* slot/ })).toBeNull();
    expect(s.posts()).toHaveLength(0);
  });

  it.each([
    ['empty matching inventory', assignmentState([]), 'No matching assignment records in this inventory.'],
    ['unavailable evidence', { status: 'unavailable', reason: 'evidence-unavailable' }, 'Recorded assignment evidence is unavailable.'],
    ['legacy root', { status: 'unavailable', reason: 'outside-content-authority-root' }, 'This legacy plan is outside the content-assignment root.'],
  ])('preserves the limited meaning of %s', async (_name, state, copy) => {
    const s = server(() => json(assignmentBody(state)));
    render(<StudioGenPlans fetchImpl={s.fetchImpl} onOpenRecordedSlot={vi.fn()} />);
    await screen.findByText(copy as string);
    expect(screen.queryByRole('button', { name: /View .* slot/ })).toBeNull();
    expect(s.posts()).toHaveLength(0);
  });

  it('explicitly accepts legacy GET @2 with local unavailable assignments and unchanged execution state', async () => {
    const body = without(statusBody(recordedState('recorded-completed')), 'assignmentRecords');
    const s = server(() => json({ ...body, schema: 'figment/studio-gen-plans@2' }));
    render(<StudioGenPlans fetchImpl={s.fetchImpl} onOpenRecordedSlot={vi.fn()} />);
    await screen.findByText(EXECUTION_COPY['recorded-completed']);
    expect(screen.getByText('Recorded assignment evidence is unavailable.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /View .* slot/ })).toBeNull();
    expect(s.posts()).toHaveLength(0);
  });

  it.each([
    ['missing @3 records', without(assignmentBody(), 'assignmentRecords')],
    ['extra @2 records', { ...assignmentBody(), schema: 'figment/studio-gen-plans@2' }],
    ['missing paired row', assignmentBodyWithRows([])],
    ['extra paired row', plansBody({ assignmentRecords: [executionRow(assignmentState())] })],
    ['foreign id', assignmentBodyWithRows([{ ...executionRow(assignmentState()), id: secondPlan.id }])],
    ['foreign digest', assignmentBodyWithRows([{ ...executionRow(assignmentState()), planSha256: secondPlan.planSha256 }])],
    ['extra envelope key', assignmentBodyWithRows([{ ...executionRow(assignmentState()), path: 'private-assignment' }])],
    ['duplicate paired rows', plansBody({ plans: [preparedBody(), secondPlan], assignmentRecords: [executionRow(assignmentState()), executionRow(assignmentState())] })],
    ['reversed paired rows', plansBody({ plans: [preparedBody(), secondPlan], assignmentRecords: [executionRow(assignmentState([]), secondPlan), executionRow(assignmentState([]))] })],
  ])('rejects %s without falling back or clearing pending intent', async (_name, body) => {
    sessionStorage.setItem(STORAGE_KEY, record(SCOPE_A, KEY_E));
    const s = server(() => json(body)), open = vi.fn();
    render(<StudioGenPlans fetchImpl={s.fetchImpl} onOpenRecordedSlot={open} />);
    await screen.findByText(GET_UNAVAILABLE);
    expect(screen.queryByRole('button', { name: /View .* slot/ })).toBeNull();
    expect(open).not.toHaveBeenCalled(); expect(s.posts()).toHaveLength(0);
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe(record(SCOPE_A, KEY_E));
    expect(document.body.textContent).not.toContain('private-assignment');
  });

  it.each([
    ['unknown status', { status: 'approved' }],
    ['unknown reason', { status: 'unavailable', reason: 'never-used' }],
    ['partial unavailable list', { status: 'unavailable', reason: 'evidence-unavailable', slots: [slotRecord()] }],
    ['source approval claim', { ...assignmentState(), currentSourceRevalidated: true }],
    ['wrong record kind', { ...assignmentState(), recordKind: 'approval' }],
    ['missing state field', without(assignmentState(), 'currentSourceRevalidated')],
    ['extra state field', { ...assignmentState(), sourcePath: 'private-assignment' }],
    ['non-array slots', { ...assignmentState(), slots: {} }],
    ['missing slot field', assignmentState([without(slotRecord(), 'taxonomyType')])],
    ['extra slot field', assignmentState([slotRecord({ imageId: 'private-assignment' })])],
    ['unsafe brief id', assignmentState([slotRecord({ briefId: '../private-assignment' })])],
    ['oversized brief id', assignmentState([slotRecord({ briefId: 'a'.repeat(129) })])],
    ['uppercase digest', assignmentState([slotRecord({ briefSha256: 'F'.repeat(64) })])],
    ['short digest', assignmentState([slotRecord({ briefSha256: 'f'.repeat(63) })])],
    ['zero slot', assignmentState([slotRecord({ slotIndex: 0 })])],
    ['excess slot', assignmentState([slotRecord({ slotIndex: 17 })])],
    ['fractional slot', assignmentState([slotRecord({ slotIndex: 1.5 })])],
    ['empty role', assignmentState([slotRecord({ role: '' })])],
    ['oversized role', assignmentState([slotRecord({ role: 'x'.repeat(81) })])],
    ['control in role', assignmentState([slotRecord({ role: 'hook\nprivate-assignment' })])],
    ['nonpersona slot', assignmentState([slotRecord({ kind: 'nonpersona' })])],
    ['lowercase taxonomy', assignmentState([slotRecord({ taxonomyType: 'a' })])],
    ['oversized taxonomy', assignmentState([slotRecord({ taxonomyType: 'A'.repeat(17) })])],
    ['duplicate slot', assignmentState([slotRecord(), slotRecord()])],
    ['duplicate identity with different role', assignmentState([slotRecord(), slotRecord({ role: 'payoff' })])],
  ])('refuses %s before exposing any partial assignment', async (_name, state) => {
    const s = server(() => json(assignmentBody(state)));
    render(<StudioGenPlans fetchImpl={s.fetchImpl} onOpenRecordedSlot={vi.fn()} />);
    await screen.findByText(GET_UNAVAILABLE);
    expect(screen.queryByText(/Recorded planning assignment:/)).toBeNull();
    expect(document.body.textContent).not.toContain('private-assignment'); expect(s.posts()).toHaveLength(0);
  });

  it('accepts exact slot/text bounds and 64 unique slots across two plans', async () => {
    const slots = Array.from({ length: 64 }, (_, i) => slotRecord({ briefId: `revision-${Math.floor(i / 16)}`, slotIndex: i % 16 + 1 }));
    slots[0] = slotRecord({ briefId: 'a'.repeat(128), role: 'x'.repeat(80), taxonomyType: 'A'.repeat(16) });
    const s = server(() => json(twoAssignments(slots.slice(0, 32), slots.slice(32))));
    render(<StudioGenPlans fetchImpl={s.fetchImpl} onOpenRecordedSlot={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByRole('button', { name: /View .* slot/ })).toHaveLength(64));
    expect(screen.queryByText(GET_UNAVAILABLE)).toBeNull(); expect(s.posts()).toHaveLength(0);
  });

  it.each(['duplicate across plans', '65 total unique slots'] as const)('enforces the global boundary for %s', async (variant) => {
    const slots = Array.from({ length: 65 }, (_, i) => slotRecord({ briefId: `revision-${Math.floor(i / 16)}`, slotIndex: i % 16 + 1 }));
    const body = variant === 'duplicate across plans' ? twoAssignments([slotRecord()], [slotRecord()]) : twoAssignments(slots.slice(0, 32), slots.slice(32));
    const s = server(() => json(body)); render(<StudioGenPlans fetchImpl={s.fetchImpl} onOpenRecordedSlot={vi.fn()} />);
    await screen.findByText(GET_UNAVAILABLE); expect(screen.queryByText(/Recorded planning assignment:/)).toBeNull(); expect(s.posts()).toHaveLength(0);
  });

  it('recovers malformed assignment evidence only on explicit refresh and preserves the pending POST key', async () => {
    sessionStorage.setItem(STORAGE_KEY, record(SCOPE_A, KEY_E)); let valid = false;
    const s = server((url) => url === GET_URL ? json(valid ? assignmentBody() : without(assignmentBody(), 'assignmentRecords')) : json(preparedBody()));
    render(<StudioGenPlans token="session" fetchImpl={s.fetchImpl} onOpenRecordedSlot={vi.fn()} />);
    await screen.findByText(GET_UNAVAILABLE); expect(s.gets()).toHaveLength(1); expect(s.posts()).toHaveLength(0);
    valid = true; fireEvent.click(await enabled(REFRESH)); await screen.findByRole('button', { name: 'View revision-a slot 1' });
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe(record(SCOPE_A, KEY_E)); expect(s.posts()).toHaveLength(0);
    fireEvent.click(await enabled(RESUME)); await screen.findByText(SUMMARY); expect(s.postKeys()).toEqual([KEY_E]);
  });

  it.each(['token', 'fetch'] as const)('never restores old assignment links after %s A-B-A and a stale refresh response', async (kind) => {
    const oldRefresh = deferred<Response>(), replacement = deferred<Response>(), newest = deferred<Response>();
    let aGets = 0;
    const first = server((_url, _init, headers) => {
      if (kind === 'token' && headers.get('authorization') === 'Bearer b') return replacement.promise;
      aGets += 1; return aGets === 1 ? json(assignmentBody()) : aGets === 2 ? oldRefresh.promise : newest.promise;
    });
    const second = server(() => replacement.promise), open = vi.fn();
    const props = (owner: 'a' | 'b') => ({ token: kind === 'token' ? owner : 'a', fetchImpl: kind === 'fetch' && owner === 'b' ? second.fetchImpl : first.fetchImpl, onOpenRecordedSlot: open });
    const view = render(<StudioGenPlans {...props('a')} />);
    await screen.findByRole('button', { name: 'View revision-a slot 1' }); fireEvent.click(await enabled(REFRESH));
    view.rerender(<StudioGenPlans {...props('b')} />); view.rerender(<StudioGenPlans {...props('a')} />);
    expect(screen.queryByRole('button', { name: 'View revision-a slot 1' })).toBeNull();
    await act(async () => oldRefresh.resolve(json(assignmentBody())));
    await act(async () => replacement.resolve(json(assignmentBody())));
    expect(screen.queryByRole('button', { name: 'View revision-a slot 1' })).toBeNull();
    await act(async () => newest.resolve(json(assignmentBody(assignmentState([])))));
    await screen.findByText('No matching assignment records in this inventory.');
    expect(open).not.toHaveBeenCalled(); expect(first.posts()).toHaveLength(0); expect(second.posts()).toHaveLength(0);
  });
});

function assignmentBodyWithRows(assignmentRecords: unknown[]) { return plansBody({ plans: [preparedBody()], assignmentRecords }); }

describe('StudioGenPlans recorded execution wire contract', () => {
  it.each([
    ['no-stage-record', recordedState()], ['recorded-running', recordedState('recorded-running')],
    ['recorded-failed', recordedState('recorded-failed')], ['recorded-completed', recordedState('recorded-completed')],
    ['unavailable', { status: 'unavailable', reason: 'evidence-unavailable' }],
  ] as const)('renders %s as recorded information and never sends a POST on mount or refresh', async (execution, state) => {
    const s = server(() => json(statusBody(state)));
    render(<StudioGenPlans token="session" fetchImpl={s.fetchImpl} />);
    await screen.findByText(EXECUTION_COPY[execution]);
    fireEvent.click(await enabled(REFRESH));
    await waitFor(() => expect(s.gets()).toHaveLength(2)); await enabled(REFRESH);
    expect(screen.getByText(EXECUTION_COPY[execution])).toBeTruthy(); expect(s.posts()).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /launch|retry execution|resume execution/i })).toBeNull();
    expect(document.body.textContent).not.toMatch(/quality approved|quality accepted|provider live/i);
  });

  it('accepts a bounded failed receipt without promoting uncertain teardown or clearing a pending key', async () => {
    sessionStorage.setItem(STORAGE_KEY, record(SCOPE_A, KEY_E));
    const state = recordedState('recorded-failed', { liveness: null, receipt: recordedReceipt({ terminationVerified: false, outputCount: 0, failure: 'run', estimatedActualUsd: null }) });
    const s = server(() => json(statusBody(state)));
    render(<StudioGenPlans token="session" fetchImpl={s.fetchImpl} />);
    await screen.findByText(EXECUTION_COPY['recorded-failed']); await enabled(RESUME);
    expect(s.posts()).toHaveLength(0); expect(sessionStorage.getItem(STORAGE_KEY)).toBe(record(SCOPE_A, KEY_E));
  });

  it.each([
    ['old schema', plansBody({ schema: 'figment/studio-gen-plans@1' })],
    ['missing rows', plansBody({ plans: [preparedBody()], executionRecords: [] })],
    ['missing field', plansBody({ executionRecords: undefined })],
    ['extra row', plansBody({ executionRecords: [executionRow(recordedState())] })],
    ['foreign id', plansBody({ plans: [preparedBody()], executionRecords: [{ ...executionRow(recordedState()), id: '00000000-0000-4000-8000-000000000001' }] })],
    ['foreign row digest', plansBody({ plans: [preparedBody()], executionRecords: [{ ...executionRow(recordedState()), planSha256: 'd'.repeat(64) }] })],
    ['extra row key', plansBody({ plans: [preparedBody()], executionRecords: [{ ...executionRow(recordedState()), path: 'private-path' }] })],
    ['duplicate rows', plansBody({ plans: [preparedBody(), preparedBody({ id: '00000000-0000-4000-8000-000000000001' })], executionRecords: [executionRow(recordedState()), executionRow(recordedState())] })],
    ['wrong row order', plansBody({ plans: [preparedBody(), preparedBody({ id: '00000000-0000-4000-8000-000000000001' })], executionRecords: [executionRow({ status: 'unavailable', reason: 'evidence-unavailable' }, preparedBody({ id: '00000000-0000-4000-8000-000000000001' })), executionRow(recordedState())] })],
  ])('refuses %s in the exact paired GET contract and preserves pending intent', async (_name, body) => {
    sessionStorage.setItem(STORAGE_KEY, record(SCOPE_A, KEY_E));
    const s = server(() => json(body)); render(<StudioGenPlans token="session" fetchImpl={s.fetchImpl} />);
    await screen.findByText(GET_UNAVAILABLE); expect(button(PREPARE).disabled).toBe(true);
    expect(s.posts()).toHaveLength(0); expect(sessionStorage.getItem(STORAGE_KEY)).toBe(record(SCOPE_A, KEY_E));
    expect(document.body.textContent).not.toContain('private-path');
  });

  it.each([
    ['unknown status', { status: 'approved' }], ['extra unavailable key', { status: 'unavailable', reason: 'evidence-unavailable', error: 'private-error' }],
    ['unknown unavailable reason', { status: 'unavailable', reason: 'provider-error' }],
    ['missing recorded key', without(recordedState(), 'receipt')], ['extra recorded key', recordedState('no-stage-record', { raw: 'private-error' })],
    ['foreign state digest', recordedState('no-stage-record', { planSha256: 'd'.repeat(64) })],
    ['foreign creator', recordedState('no-stage-record', { creator: 'creator-002' })], ['foreign stage', recordedState('no-stage-record', { stage: 'tester' })],
    ['unknown execution', recordedState('completed')], ['quality promotion', recordedState('no-stage-record', { quality: 'accepted' })],
    ['fractional minutes', recordedState('no-stage-record', { maxMinutes: 1.5 })], ['excess minutes', recordedState('no-stage-record', { maxMinutes: 841 })],
    ['negative ceiling', recordedState('no-stage-record', { declaredCeilingUsd: -1 })], ['excess ceiling', recordedState('no-stage-record', { declaredCeilingUsd: 51 })],
    ['running terminal liveness', recordedState('recorded-running', { liveness: null })], ['running receipt', recordedState('recorded-running', { receipt: recordedReceipt() })],
    ['missing completion receipt', recordedState('recorded-completed', { receipt: null })], ['completed unknown liveness', recordedState('recorded-completed', { liveness: 'unknown' })],
    ['failed receipt without failure', recordedState('recorded-failed', { liveness: null, receipt: recordedReceipt() })],
    ['extra receipt key', recordedState('recorded-completed', { receipt: recordedReceipt({ podId: 'private-error' }) })],
    ['invalid receipt timestamp', recordedState('recorded-completed', { receipt: recordedReceipt({ finishedUtc: 'not-a-date' }) })],
    ['oversized timestamp', recordedState('recorded-completed', { receipt: recordedReceipt({ startedUtc: 'x'.repeat(41) }) })],
    ['reversed timestamps', recordedState('recorded-completed', { receipt: recordedReceipt({ finishedUtc: '2026-09-12T17:00:00Z' }) })],
    ['missing receipt key', recordedState('recorded-completed', { receipt: without(recordedReceipt(), 'failure') })],
    ['wrong teardown type', recordedState('recorded-failed', { liveness: null, receipt: recordedReceipt({ terminationVerified: 'yes', failure: 'run' }) })],
    ['fractional output count', recordedState('recorded-completed', { receipt: recordedReceipt({ outputCount: 3.5 }) })],
    ['excess output count', recordedState('recorded-completed', { receipt: recordedReceipt({ outputCount: 99 }) })],
    ['incomplete gen batch', recordedState('recorded-completed', { receipt: recordedReceipt({ outputCount: 2 }) })],
    ['unverified completion', recordedState('recorded-completed', { receipt: recordedReceipt({ terminationVerified: false }) })],
    ['completion failure', recordedState('recorded-completed', { receipt: recordedReceipt({ failure: 'run' }) })],
    ['negative recorded cost', recordedState('recorded-completed', { receipt: recordedReceipt({ estimatedActualUsd: -0.1 }) })],
    ['oversized recorded estimate', recordedState('recorded-completed', { receipt: recordedReceipt({ preflightEstimateUsd: 51 }) })],
  ])('rejects %s without displaying the forged state', async (_name, state) => {
    const s = server(() => json(statusBody(state))); render(<StudioGenPlans token="session" fetchImpl={s.fetchImpl} />);
    await screen.findByText(GET_UNAVAILABLE); expect(button(PREPARE).disabled).toBe(true); expect(s.posts()).toHaveLength(0);
    expect(screen.queryByText(EXECUTION_COPY['recorded-completed'])).toBeNull(); expect(document.body.textContent).not.toContain('private-error');
  });

  it('refuses an otherwise valid execution body over the accepted GET size limit', async () => {
    sessionStorage.setItem(STORAGE_KEY, record(SCOPE_A, KEY_E));
    const s = server(() => new Response(JSON.stringify(statusBody(recordedState('recorded-completed'))) + ' '.repeat(65536), { status: 200 }));
    render(<StudioGenPlans token="session" fetchImpl={s.fetchImpl} />); await screen.findByText(GET_UNAVAILABLE);
    expect(button(PREPARE).disabled).toBe(true); expect(s.posts()).toHaveLength(0);
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe(record(SCOPE_A, KEY_E));
  });

  it('a malformed execution GET cannot erase a pending key and valid refresh recovers the original POST intent', async () => {
    sessionStorage.setItem(STORAGE_KEY, record(SCOPE_A, KEY_E)); let valid = false;
    const s = server((url) => url === GET_URL ? json(valid ? statusBody(recordedState('recorded-completed')) : plansBody({ plans: [preparedBody()], executionRecords: [] })) : json(preparedBody()));
    render(<StudioGenPlans token="session" fetchImpl={s.fetchImpl} />); await screen.findByText(GET_UNAVAILABLE);
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe(record(SCOPE_A, KEY_E)); expect(s.posts()).toHaveLength(0);
    valid = true; fireEvent.click(await enabled(REFRESH)); await screen.findByText(EXECUTION_COPY['recorded-completed']);
    expect(s.posts()).toHaveLength(0); fireEvent.click(await enabled(RESUME));
    await screen.findByText(SUMMARY); expect(s.postKeys()).toEqual([KEY_E]);
    expect(new Headers(s.posts()[0]![1]?.headers).get('X-Figment-Intent-Scope')).toBe(SCOPE_A);
    await waitFor(() => expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull());
  });

  it.each(['token', 'fetch'] as const)('hides recorded state immediately when %s ownership changes and ignores the old GET completion', async (owner) => {
    const oldRefresh = deferred<Response>(), replacement = deferred<Response>();
    const first = server(() => first.gets().length === 1 ? json(statusBody(recordedState('recorded-completed'))) : oldRefresh.promise);
    const second = server(() => replacement.promise);
    const tokenFetch = server((_url, _init, headers) => headers.get('authorization') === 'Bearer second' ? replacement.promise :
      tokenFetch.gets().filter(([, init]) => new Headers(init?.headers).get('authorization') === 'Bearer first').length === 1 ? json(statusBody(recordedState('recorded-completed'))) : oldRefresh.promise);
    const original = owner === 'token' ? tokenFetch : first;
    const { rerender } = render(<StudioGenPlans token="first" fetchImpl={original.fetchImpl} />);
    await screen.findByText(EXECUTION_COPY['recorded-completed']); fireEvent.click(await enabled(REFRESH));
    rerender(<StudioGenPlans token={owner === 'token' ? 'second' : 'first'} fetchImpl={owner === 'fetch' ? second.fetchImpl : original.fetchImpl} />);
    expect(screen.queryByText(EXECUTION_COPY['recorded-completed'])).toBeNull();
    await act(async () => { oldRefresh.resolve(json(statusBody(recordedState('recorded-completed')))); });
    expect(screen.queryByText(EXECUTION_COPY['recorded-completed'])).toBeNull();
    await act(async () => { replacement.resolve(json(statusBody({ status: 'unavailable', reason: 'evidence-unavailable' }))); });
    await screen.findByText(EXECUTION_COPY.unavailable); expect(original.posts()).toHaveLength(0); expect(second.posts()).toHaveLength(0);
  });
});
