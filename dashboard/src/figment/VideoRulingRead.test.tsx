// @vitest-environment jsdom
import { StrictMode, useLayoutEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { VideoRulingRead } from './VideoRulingRead';

const GET_URL = '/api/figment/video-rulings';
const readUrl = (id: string) => `/api/figment/video-rulings/${encodeURIComponent(id)}/read`;
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const EMPTY_COPY = 'No video review claims are configured.';
const CHECK = 'Check recorded review';
const CHECK_PENDING = 'Checking recorded review…';
const REFRESH = 'Refresh status';
const HEADING = 'Video review claims';
const LIMITATIONS = [
  'Review criteria are self-reported claims.',
  'The claimed author has not been authenticated.',
  'This result grants no delivery, media-quality or publication approval.',
];

const passCriteria = {
  playbackObservation: 'watched_full',
  correspondenceReview: 'pass',
  temporalReview: 'pass',
  detailCropReview: 'pass',
  templateFitReview: 'pass',
  audioPresenceClaim: 'absent',
  audioLicensingReview: 'not_applicable',
  audioMixSyncReview: 'not_applicable',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const inventoryBody = (overrides: Record<string, unknown> = {}) => ({ schema: 'figment/studio-video-rulings@1', ids: ['clip-1'], availability: 'available', ...overrides });
const resultBody = (overrides: Record<string, unknown> = {}) => ({
  schema: 'figment/studio-video-ruling@1',
  id: 'clip-1',
  subjectSha256: HASH_A,
  rulingSha256: HASH_B,
  derivedOutcome: 'reported_pass',
  criteria: passCriteria,
  notPromotable: true,
  attributionAuthenticated: false,
  limitations: LIMITATIONS,
  ...overrides,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

type Handler = (url: string, init: RequestInit | undefined, headers: Headers) => Promise<Response> | Response;
function server(handler: Handler) {
  const mock = vi.fn(async (url: string, init?: RequestInit) => handler(url, init, new Headers(init?.headers)));
  const posts = () => mock.mock.calls.filter(([url]) => url !== GET_URL);
  const gets = () => mock.mock.calls.filter(([url]) => url === GET_URL);
  return { fetchImpl: mock as unknown as typeof fetch, posts, gets };
}

function BeforePassiveObserver({ onLayout }: { onLayout: () => void }) {
  useLayoutEffect(() => { onLayout(); });
  return null;
}

function ReaderWithLayoutObserver({ token, fetchImpl, onLayout }: { token?: string; fetchImpl: typeof fetch; onLayout: () => void }) {
  return <>
    <VideoRulingRead token={token} fetchImpl={fetchImpl} />
    <BeforePassiveObserver onLayout={onLayout} />
  </>;
}

const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
async function enabled(name: string): Promise<HTMLButtonElement> {
  await waitFor(() => expect(button(name).disabled).toBe(false));
  return button(name);
}
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function selectAndCheck(name = 'clip-1') {
  await screen.findByRole('combobox');
  const select = screen.getByRole('combobox') as HTMLSelectElement;
  const check = await enabled(CHECK);
  fireEvent.change(select, { target: { value: name } });
  fireEvent.click(check);
}

describe('VideoRulingRead discovery', () => {
  it('GETs on mount with the session token and renders no POST', async () => {
    const s = server((url) => url === GET_URL ? json(inventoryBody()) : json(resultBody()));
    render(<VideoRulingRead token="session" fetchImpl={s.fetchImpl} />);
    await screen.findByRole('combobox');
    expect(s.posts()).toHaveLength(0);
    const [, init] = s.gets()[0]!;
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer session');
    expect(init?.method).toBeUndefined();
    expect(init?.body).toBeUndefined();
  });

  it('resolves the latest of two StrictMode-driven GETs and issues no POST', async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const calls = [first, second];
    let call = 0;
    const s = server((url) => {
      if (url !== GET_URL) return json(resultBody());
      const deferredCall = calls[call++];
      return deferredCall ? deferredCall.promise : json(inventoryBody());
    });
    render(
      <StrictMode>
        <VideoRulingRead token="session" fetchImpl={s.fetchImpl} />
      </StrictMode>,
    );
    await flush();
    second.resolve(json(inventoryBody({ ids: ['clip-1', 'clip_2'] })));
    await flush();
    first.resolve(json(inventoryBody({ ids: ['stale'] })));
    await flush();
    expect(screen.queryByText('stale')).toBeNull();
    await screen.findByRole('combobox');
    expect(s.posts()).toHaveLength(0);
  });

  it('shows a loading state before the GET resolves', async () => {
    const get = deferred<Response>();
    const s = server(() => get.promise);
    render(<VideoRulingRead token="session" fetchImpl={s.fetchImpl} />);
    expect(button(REFRESH).disabled).toBe(true);
    expect(screen.queryByRole('combobox')).toBeNull();
    get.resolve(json(inventoryBody()));
    await enabled(REFRESH);
  });

  it('shows fixed empty copy when no ids are configured', async () => {
    const s = server(() => json(inventoryBody({ ids: [] })));
    render(<VideoRulingRead token="session" fetchImpl={s.fetchImpl} />);
    await screen.findByText(EMPTY_COPY);
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it.each([
    ['server failure', () => json({ error: 'boom' }, 500)],
    ['network failure', () => Promise.reject(new Error('offline'))],
    ['non-JSON body', () => new Response('<html>', { status: 200 })],
    ['malformed inventory', () => json(inventoryBody({ ids: ['../escape'] }))],
  ])('renders a fixed unavailable state on %s and never leaks response detail', async (_name, reply) => {
    const s = server(() => reply());
    render(<VideoRulingRead token="session" fetchImpl={s.fetchImpl} />);
    await waitFor(() => expect(button(REFRESH).disabled).toBe(false));
    expect(screen.getByRole('alert').textContent).toBe('Video review claims are unavailable.');
    expect(document.body.textContent).not.toMatch(/boom|html|offline/);
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('shows a fixed busy state and prevents checking from dispatching a POST', async () => {
    const s = server(() => json(inventoryBody({ availability: 'busy' })));
    render(<VideoRulingRead token="session" fetchImpl={s.fetchImpl} />);
    await waitFor(() => expect(button(REFRESH).disabled).toBe(false));
    await screen.findByText('Another check is in progress. Refresh once it finishes.');
    const checkButton = screen.queryByRole('button', { name: CHECK });
    if (checkButton) {
      expect((checkButton as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(checkButton);
    }
    expect(s.posts()).toHaveLength(0);
  });

  it('shows a fixed quarantined state and prevents checking from dispatching a POST', async () => {
    const s = server(() => json(inventoryBody({ availability: 'quarantined' })));
    render(<VideoRulingRead token="session" fetchImpl={s.fetchImpl} />);
    await waitFor(() => expect(button(REFRESH).disabled).toBe(false));
    await screen.findByText('Video review claims are quarantined and cannot be checked right now.');
    const checkButton = screen.queryByRole('button', { name: CHECK });
    if (checkButton) {
      expect((checkButton as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(checkButton);
    }
    expect(s.posts()).toHaveLength(0);
  });

  it('Refresh re-GETs without ever POSTing', async () => {
    const s = server((url) => url === GET_URL ? json(inventoryBody()) : json(resultBody()));
    render(<VideoRulingRead token="session" fetchImpl={s.fetchImpl} />);
    fireEvent.click(await enabled(REFRESH));
    await waitFor(() => expect(s.gets()).toHaveLength(2));
    expect(s.posts()).toHaveLength(0);
  });
});

describe('VideoRulingRead check', () => {
  it('POSTs to the exact encoded id URL with the session token and no body', async () => {
    const s = server((url) => url === GET_URL ? json(inventoryBody()) : json(resultBody()));
    render(<VideoRulingRead token="session" fetchImpl={s.fetchImpl} />);
    await selectAndCheck('clip-1');
    await screen.findByText('Reported pass');
    const [url, init] = s.posts()[0]!;
    expect(url).toBe(readUrl('clip-1'));
    expect(init?.body).toBeUndefined();
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer session');
  });

  it('collapses a rapid double click into a single POST', async () => {
    const post = deferred<Response>();
    const s = server((url) => url === GET_URL ? json(inventoryBody()) : post.promise);
    render(<VideoRulingRead token="session" fetchImpl={s.fetchImpl} />);
    await screen.findByRole('combobox');
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'clip-1' } });
    const check = await enabled(CHECK);
    fireEvent.click(check);
    fireEvent.click(check);
    await flush();
    expect(s.posts()).toHaveLength(1);
    post.resolve(json(resultBody()));
    await screen.findByText('Reported pass');
  });

  it('disables select, refresh and check while a POST is in flight', async () => {
    const post = deferred<Response>();
    const s = server((url) => url === GET_URL ? json(inventoryBody()) : post.promise);
    render(<VideoRulingRead token="session" fetchImpl={s.fetchImpl} />);
    await screen.findByRole('combobox');
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    const check = await enabled(CHECK);
    fireEvent.change(select, { target: { value: 'clip-1' } });
    fireEvent.click(check);
    await waitFor(() => expect(button(CHECK_PENDING).disabled).toBe(true));
    expect(button(REFRESH).disabled).toBe(true);
    expect((screen.getByRole('combobox') as HTMLSelectElement).disabled).toBe(true);
    post.resolve(json(resultBody()));
    await screen.findByText('Reported pass');
  });

  it('renders an accessible outcome and criteria list with evidence hashes on a passing result', async () => {
    const s = server((url) => url === GET_URL ? json(inventoryBody()) : json(resultBody()));
    render(<VideoRulingRead token="session" fetchImpl={s.fetchImpl} />);
    await selectAndCheck('clip-1');
    await screen.findByText('Reported pass');
    for (const line of LIMITATIONS) expect(screen.getByText(line)).toBeTruthy();
    expect(screen.getByText(new RegExp(`Subject evidence hash:.*${HASH_A}`))).toBeTruthy();
    expect(screen.getByText(new RegExp(`Ruling evidence hash:.*${HASH_B}`))).toBeTruthy();
    const criteriaLabels: Array<[string, string]> = [
      ['Playback observation', 'Watched in full'],
      ['Correspondence review', 'Pass'],
      ['Temporal review', 'Pass'],
      ['Detail crop review', 'Pass'],
      ['Template fit review', 'Pass'],
      ['Audio presence claim', 'Absent'],
      ['Audio licensing review', 'Not applicable'],
      ['Audio mix and sync review', 'Not applicable'],
    ];
    for (const [label, value] of criteriaLabels) {
      expect(screen.getByText(new RegExp(`${label}.*${value}`))).toBeTruthy();
    }
  });

  it('renders a failing outcome in plain language', async () => {
    const criteria = { ...passCriteria, correspondenceReview: 'fail' };
    const s = server((url) => url === GET_URL ? json(inventoryBody()) : json(resultBody({ criteria, derivedOutcome: 'reported_fail' })));
    render(<VideoRulingRead token="session" fetchImpl={s.fetchImpl} />);
    await selectAndCheck('clip-1');
    await screen.findByText('Reported failure');
  });

  it('renders an incomplete outcome in plain language', async () => {
    const criteria = { ...passCriteria, playbackObservation: 'not_watched' };
    const s = server((url) => url === GET_URL ? json(inventoryBody()) : json(resultBody({ criteria, derivedOutcome: 'reported_incomplete' })));
    render(<VideoRulingRead token="session" fetchImpl={s.fetchImpl} />);
    await selectAndCheck('clip-1');
    await screen.findByText('Reported review incomplete');
  });

  it.each([
    ['conflict', 409, 'Another video review check is in progress. Refresh status once it finishes.'],
    ['operator attention required', 423, 'This check needs operator attention after an earlier process ended in an uncertain state.'],
    ['generic failure', 500, 'The recorded review could not be read.'],
  ])('renders a fixed message on HTTP %s without the response body', async (_name, status, message) => {
    const s = server((url) => url === GET_URL ? json(inventoryBody()) : json({ error: 'do-not-render-me', path: '/secret' }, status));
    render(<VideoRulingRead token="session" fetchImpl={s.fetchImpl} />);
    await selectAndCheck('clip-1');
    await waitFor(() => expect(button(CHECK).disabled).toBe(false));
    expect(screen.getByRole('alert').textContent).toBe(message);
    expect(document.body.textContent).not.toMatch(/do-not-render-me|secret/);
  });

  it('rejects a malformed JSON POST response with a fixed message', async () => {
    const s = server((url) => url === GET_URL ? json(inventoryBody()) : new Response('{"bad', { status: 200 }));
    render(<VideoRulingRead token="session" fetchImpl={s.fetchImpl} />);
    await selectAndCheck('clip-1');
    await waitFor(() => expect(button(CHECK).disabled).toBe(false));
    expect(screen.getByRole('alert').textContent).toBe('The recorded review could not be read.');
    expect(screen.queryByText('Reported pass')).toBeNull();
  });

  it('rejects a mismatched-id POST response', async () => {
    const s = server((url) => url === GET_URL ? json(inventoryBody()) : json(resultBody({ id: 'clip-2' })));
    render(<VideoRulingRead token="session" fetchImpl={s.fetchImpl} />);
    await selectAndCheck('clip-1');
    await waitFor(() => expect(button(CHECK).disabled).toBe(false));
    expect(screen.getByRole('alert').textContent).toBe('The recorded review could not be read.');
    expect(screen.queryByText('Reported pass')).toBeNull();
  });

  it('rejects an oversized POST response body', async () => {
    const bloated = JSON.stringify(resultBody()).slice(0, -1) + ' '.repeat(16400) + '}';
    const s = server((url) => url === GET_URL ? json(inventoryBody()) : new Response(bloated, { status: 200, headers: { 'content-type': 'application/json' } }));
    render(<VideoRulingRead token="session" fetchImpl={s.fetchImpl} />);
    await selectAndCheck('clip-1');
    await waitFor(() => expect(button(CHECK).disabled).toBe(false));
    expect(screen.getByRole('alert').textContent).toBe('The recorded review could not be read.');
    expect(screen.queryByText('Reported pass')).toBeNull();
  });

  it('rejects an oversized GET inventory response', async () => {
    const bloated = JSON.stringify(inventoryBody()).slice(0, -1) + ' '.repeat(4100) + '}';
    const s = server((url) => url === GET_URL ? new Response(bloated, { status: 200, headers: { 'content-type': 'application/json' } }) : json(resultBody()));
    render(<VideoRulingRead token="session" fetchImpl={s.fetchImpl} />);
    await waitFor(() => expect(button(REFRESH).disabled).toBe(false));
    expect(screen.getByRole('alert').textContent).toBe('Video review claims are unavailable.');
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('never renders malicious string content from an unrelated field', async () => {
    const s = server((url) => url === GET_URL ? json(inventoryBody({ ids: ['clip-1'] })) : json({ error: '<img src=x onerror=alert(1)>' }, 500));
    render(<VideoRulingRead token="session" fetchImpl={s.fetchImpl} />);
    await selectAndCheck('clip-1');
    await waitFor(() => expect(button(CHECK).disabled).toBe(false));
    expect(document.querySelector('img')).toBeNull();
    expect(document.body.textContent).not.toMatch(/onerror|alert\(1\)/);
  });

  it('a new failing check clears a prior passing result', async () => {
    const failing = { ...passCriteria, correspondenceReview: 'fail' };
    let call = 0;
    const s = server((url) => url === GET_URL ? json(inventoryBody()) : json(call++ === 0 ? resultBody() : resultBody({ criteria: failing, derivedOutcome: 'reported_fail' })));
    render(<VideoRulingRead token="session" fetchImpl={s.fetchImpl} />);
    await selectAndCheck('clip-1');
    await screen.findByText('Reported pass');
    await selectAndCheck('clip-1');
    await screen.findByText('Reported failure');
    expect(screen.queryByText('Reported pass')).toBeNull();
  });

  it('a network rejection on check clears any prior result', async () => {
    let call = 0;
    const s = server((url) => url === GET_URL ? json(inventoryBody()) : (call++ === 0 ? json(resultBody()) : Promise.reject(new Error('offline'))));
    render(<VideoRulingRead token="session" fetchImpl={s.fetchImpl} />);
    await selectAndCheck('clip-1');
    await screen.findByText('Reported pass');
    await selectAndCheck('clip-1');
    await waitFor(() => expect(button(CHECK).disabled).toBe(false));
    expect(screen.queryByText('Reported pass')).toBeNull();
  });

  it('a refresh clears a prior result', async () => {
    const s = server((url) => url === GET_URL ? json(inventoryBody()) : json(resultBody()));
    render(<VideoRulingRead token="session" fetchImpl={s.fetchImpl} />);
    await selectAndCheck('clip-1');
    await screen.findByText('Reported pass');
    fireEvent.click(await enabled(REFRESH));
    await waitFor(() => expect(s.gets()).toHaveLength(2));
    expect(screen.queryByText('Reported pass')).toBeNull();
  });

  it('does not write to localStorage or sessionStorage', async () => {
    const setLocal = vi.spyOn(Storage.prototype, 'setItem');
    const s = server((url) => url === GET_URL ? json(inventoryBody()) : json(resultBody()));
    render(<VideoRulingRead token="session" fetchImpl={s.fetchImpl} />);
    await selectAndCheck('clip-1');
    await screen.findByText('Reported pass');
    expect(setLocal).not.toHaveBeenCalled();
  });

  it('does not poll or retry after a failed GET', async () => {
    const s = server(() => json({}, 503));
    render(<VideoRulingRead token="session" fetchImpl={s.fetchImpl} />);
    await waitFor(() => expect(button(REFRESH).disabled).toBe(false));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(s.gets()).toHaveLength(1);
  });
});

describe('VideoRulingRead request ordering', () => {
  it('hides a prior result synchronously when the token changes', async () => {
    const s = server((url) => url === GET_URL ? json(inventoryBody()) : json(resultBody()));
    const { rerender } = render(<VideoRulingRead token="a" fetchImpl={s.fetchImpl} />);
    await selectAndCheck('clip-1');
    await screen.findByText('Reported pass');
    rerender(<VideoRulingRead token="b" fetchImpl={s.fetchImpl} />);
    expect(screen.queryByText('Reported pass')).toBeNull();
  });

  it('hides a prior result synchronously when fetchImpl changes', async () => {
    const s1 = server((url) => url === GET_URL ? json(inventoryBody()) : json(resultBody()));
    const s2 = server((url) => url === GET_URL ? json(inventoryBody()) : json(resultBody()));
    const { rerender } = render(<VideoRulingRead token="a" fetchImpl={s1.fetchImpl} />);
    await selectAndCheck('clip-1');
    await screen.findByText('Reported pass');
    rerender(<VideoRulingRead token="a" fetchImpl={s2.fetchImpl} />);
    expect(screen.queryByText('Reported pass')).toBeNull();
  });

  it.each(['token', 'fetch implementation'] as const)('hides an established GET failure before passive cleanup on %s replacement', async (replacement) => {
    const nextGet = deferred<Response>();
    let getCalls = 0;
    const s1 = server((url) => url === GET_URL && getCalls++ === 0 ? json({}, 500) : nextGet.promise);
    const s2 = server(() => nextGet.promise);
    const { rerender } = render(<ReaderWithLayoutObserver token="a" fetchImpl={s1.fetchImpl} onLayout={() => {}} />);
    await screen.findByRole('alert');
    let observedBeforePassiveCleanup = false;
    const nextProps = replacement === 'token' ? { token: 'b', fetchImpl: s1.fetchImpl } : { token: 'a', fetchImpl: s2.fetchImpl };
    rerender(<ReaderWithLayoutObserver {...nextProps} onLayout={() => {
      observedBeforePassiveCleanup = true;
      expect(screen.queryByRole('alert')).toBeNull();
      expect(button(REFRESH).disabled).toBe(false);
    }} />);
    expect(observedBeforePassiveCleanup).toBe(true);
  });

  it.each([
    ['token', '409 conflict', () => json({}, 409), 'Another video review check is in progress. Refresh status once it finishes.'],
    ['fetch implementation', '409 conflict', () => json({}, 409), 'Another video review check is in progress. Refresh status once it finishes.'],
    ['token', '423 operator attention', () => json({}, 423), 'This check needs operator attention after an earlier process ended in an uncertain state.'],
    ['fetch implementation', '423 operator attention', () => json({}, 423), 'This check needs operator attention after an earlier process ended in an uncertain state.'],
    ['token', 'network rejection', () => Promise.reject(new Error('offline')), 'The recorded review could not be read.'],
    ['fetch implementation', 'network rejection', () => Promise.reject(new Error('offline')), 'The recorded review could not be read.'],
  ])('hides an established POST error before passive cleanup on %s replacement (%s)', async (replacement, _name, reply, message) => {
    const nextGet = deferred<Response>();
    const s1 = server((url) => url === GET_URL ? json(inventoryBody()) : reply());
    const s2 = server(() => nextGet.promise);
    const { rerender } = render(<ReaderWithLayoutObserver token="a" fetchImpl={s1.fetchImpl} onLayout={() => {}} />);
    await selectAndCheck('clip-1');
    await screen.findByText(message);
    let observedBeforePassiveCleanup = false;
    const nextProps = replacement === 'token' ? { token: 'b', fetchImpl: s1.fetchImpl } : { token: 'a', fetchImpl: s2.fetchImpl };
    rerender(<ReaderWithLayoutObserver {...nextProps} onLayout={() => {
      observedBeforePassiveCleanup = true;
      expect(screen.queryByRole('alert')).toBeNull();
    }} />);
    expect(observedBeforePassiveCleanup).toBe(true);
  });

  it.each(['token', 'fetch implementation'] as const)('does not let an old pending POST disable refresh before passive cleanup on %s replacement', async (replacement) => {
    const post = deferred<Response>();
    const nextGet = deferred<Response>();
    const s1 = server((url) => url === GET_URL ? json(inventoryBody()) : post.promise);
    const s2 = server(() => nextGet.promise);
    const { rerender } = render(<ReaderWithLayoutObserver token="a" fetchImpl={s1.fetchImpl} onLayout={() => {}} />);
    await selectAndCheck('clip-1');
    await waitFor(() => expect(button(CHECK_PENDING).disabled).toBe(true));
    let observedBeforePassiveCleanup = false;
    const nextProps = replacement === 'token' ? { token: 'b', fetchImpl: s1.fetchImpl } : { token: 'a', fetchImpl: s2.fetchImpl };
    rerender(<ReaderWithLayoutObserver {...nextProps} onLayout={() => {
      observedBeforePassiveCleanup = true;
      expect(screen.queryByRole('button', { name: CHECK_PENDING })).toBeNull();
      expect(button(REFRESH).disabled).toBe(false);
    }} />);
    expect(observedBeforePassiveCleanup).toBe(true);
  });

  it('discards a late GET response from a previous fetchImpl generation', async () => {
    const first = deferred<Response>();
    const s1 = server(() => first.promise);
    const s2 = server(() => json(inventoryBody({ availability: 'quarantined' })));
    const { rerender } = render(<VideoRulingRead token="a" fetchImpl={s1.fetchImpl} />);
    rerender(<VideoRulingRead token="a" fetchImpl={s2.fetchImpl} />);
    await waitFor(() => expect(button(REFRESH).disabled).toBe(false));
    first.resolve(json(inventoryBody({ ids: ['stale'] })));
    await flush();
    expect(screen.queryByText('stale')).toBeNull();
  });

  it('discards a late POST response from a previous token generation', async () => {
    const first = deferred<Response>();
    const s = server((url, _init, headers) => {
      if (url === GET_URL) return json(inventoryBody());
      return headers.get('authorization') === 'Bearer a' ? first.promise : json(resultBody({ derivedOutcome: 'reported_incomplete', criteria: { ...passCriteria, playbackObservation: 'not_watched' } }));
    });
    const { rerender } = render(<VideoRulingRead token="a" fetchImpl={s.fetchImpl} />);
    await selectAndCheck('clip-1');
    rerender(<VideoRulingRead token="b" fetchImpl={s.fetchImpl} />);
    await screen.findByRole('combobox');
    first.resolve(json(resultBody()));
    await flush();
    expect(screen.queryByText('Reported pass')).toBeNull();
  });

  it('does not reanimate stale data or auto-POST after unmount and remount', async () => {
    const s = server((url) => url === GET_URL ? json(inventoryBody()) : json(resultBody()));
    const { unmount } = render(<VideoRulingRead token="a" fetchImpl={s.fetchImpl} />);
    await selectAndCheck('clip-1');
    await screen.findByText('Reported pass');
    unmount();
    render(<VideoRulingRead token="a" fetchImpl={s.fetchImpl} />);
    await screen.findByRole('combobox');
    expect(screen.queryByText('Reported pass')).toBeNull();
    expect(s.posts()).toHaveLength(1);
  });

  it('discards a late POST resolved after unmount and does not auto-POST on remount', async () => {
    const post = deferred<Response>();
    const s = server((url) => url === GET_URL ? json(inventoryBody()) : post.promise);
    const { unmount } = render(<VideoRulingRead token="a" fetchImpl={s.fetchImpl} />);
    await selectAndCheck('clip-1');
    unmount();
    post.resolve(json(resultBody()));
    await flush();
    render(<VideoRulingRead token="a" fetchImpl={s.fetchImpl} />);
    await screen.findByRole('combobox');
    expect(screen.queryByText('Reported pass')).toBeNull();
    expect(s.posts()).toHaveLength(1);
  });

  it('StrictMode does not duplicate the POST or reanimate stale data across the dev double-invoke', async () => {
    const s = server((url) => url === GET_URL ? json(inventoryBody()) : json(resultBody()));
    render(
      <StrictMode>
        <VideoRulingRead token="a" fetchImpl={s.fetchImpl} />
      </StrictMode>,
    );
    await selectAndCheck('clip-1');
    await screen.findByText('Reported pass');
    expect(s.posts()).toHaveLength(1);
  });
});

describe('VideoRulingRead static copy', () => {
  it('renders the fixed heading', async () => {
    const s = server(() => json(inventoryBody({ ids: [] })));
    render(<VideoRulingRead token="session" fetchImpl={s.fetchImpl} />);
    expect(await screen.findByRole('heading', { name: HEADING })).toBeTruthy();
  });
});
