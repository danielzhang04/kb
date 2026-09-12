// @vitest-environment jsdom
import { StrictMode, useLayoutEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ContentBriefRevisionForm } from './ContentBriefRevisionForm';

const POST = '/api/figment/studio/content-brief-revisions';
const BASE_A = { briefId: 'base-brief', briefDate: '2026-09-11' };
const BASE_B = { briefId: 'other-base', briefDate: '2026-09-10' };
const ID = '2026-09-12-creator-001-revision-a';
const HASH = 'a'.repeat(64);
const AMBIGUOUS = 'The request ended without a trustworthy result. A local revision may have been created. Inspect recorded briefs before deciding what to do. Sending it again is not known to be safe.';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function success(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 'figment/studio-content-brief-revision@1', status: 'published', briefId: ID, briefSha256: HASH, ...overrides,
  };
}

function renderForm(overrides: Partial<Parameters<typeof ContentBriefRevisionForm>[0]> = {}) {
  const onRefreshRequested = vi.fn();
  const fetchImpl = vi.fn(async () => response(success())) as unknown as typeof fetch;
  const view = render(<ContentBriefRevisionForm bases={[BASE_A, BASE_B]} token="session-a" fetchImpl={fetchImpl} onRefreshRequested={onRefreshRequested} {...overrides} />);
  return { ...view, fetchImpl: fetchImpl as unknown as ReturnType<typeof vi.fn>, onRefreshRequested };
}

function fillValid(): void {
  fireEvent.change(screen.getByLabelText('Revision date'), { target: { value: '2026-09-12' } });
  fireEvent.change(screen.getByLabelText('Slug'), { target: { value: 'revision-a' } });
  fireEvent.change(screen.getByLabelText('Hypothesis'), { target: { value: 'A bounded local planning hypothesis.' } });
  fireEvent.change(screen.getByLabelText('Intended metric'), { target: { value: 'profile visits per reached account' } });
}

function submit(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Create local planning revision' }));
}

function BeforePassiveObserver({ onLayout }: { onLayout: () => void }) {
  useLayoutEffect(() => { onLayout(); });
  return null;
}

function FormWithLayoutObserver({ onLayout, ...props }: Parameters<typeof ContentBriefRevisionForm>[0] & { onLayout: () => void }) {
  return <>
    <ContentBriefRevisionForm {...props} />
    <BeforePassiveObserver onLayout={onLayout} />
  </>;
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('ContentBriefRevisionForm dispatch boundary', () => {
  it('does not offer a write or invoke fetch when no recorded base is supplied', () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    renderForm({ bases: [], fetchImpl });
    expect(screen.getByText('No recorded creator-001 content briefs are available.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Create local planning revision' })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not POST on mount, editing, base selection, or parent refresh callback identity replacement', () => {
    const { fetchImpl, rerender } = renderForm();
    fillValid();
    fireEvent.change(screen.getByLabelText('Base brief'), { target: { value: BASE_B.briefId } });
    rerender(<ContentBriefRevisionForm bases={[BASE_A, BASE_B]} token="session-a" fetchImpl={fetchImpl as unknown as typeof fetch} onRefreshRequested={vi.fn()} />);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ['empty date', () => fireEvent.change(screen.getByLabelText('Revision date'), { target: { value: '' } })],
    ['invalid date', () => fireEvent.change(screen.getByLabelText('Revision date'), { target: { value: '0000-01-01' } })],
    ['unsafe slug', () => fireEvent.change(screen.getByLabelText('Slug'), { target: { value: '../escape' } })],
    ['whitespace hypothesis', () => fireEvent.change(screen.getByLabelText('Hypothesis'), { target: { value: '  ' } })],
    ['control-character metric', () => fireEvent.change(screen.getByLabelText('Intended metric'), { target: { value: 'metric\u0000' } })],
    ['unpaired-surrogate hypothesis', () => fireEvent.change(screen.getByLabelText('Hypothesis'), { target: { value: 'bad\ud800' } })],
    ['4097-unit metric', () => fireEvent.change(screen.getByLabelText('Intended metric'), { target: { value: 'a'.repeat(4097) } })],
    ['derived id overflow', () => fireEvent.change(screen.getByLabelText('Slug'), { target: { value: 'a'.repeat(106) } })],
  ])('does not dispatch an invalid %s shape', async (_name, mutate) => {
    const { fetchImpl } = renderForm();
    fillValid();
    mutate();
    submit();
    await act(async () => {});
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends exactly one current-token POST with exact JSON, content type, and an owned signal', async () => {
    const { fetchImpl } = renderForm();
    fillValid();
    submit();
    await screen.findByText(`Local planning revision created: ${ID}.`);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(POST);
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer session-a');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(init.body))).toEqual({
      baseBriefId: BASE_A.briefId,
      briefDate: '2026-09-12',
      slug: 'revision-a',
      hypothesis: 'A bounded local planning hypothesis.',
      intendedMetric: 'profile visits per reached account',
    });
  });

  it('collapses a rapid double click and preserves only the request fields while pending', async () => {
    const pending = deferred<Response>();
    const fetchImpl = vi.fn(() => pending.promise) as unknown as typeof fetch;
    renderForm({ fetchImpl });
    fillValid();
    const button = screen.getByRole('button', { name: 'Create local planning revision' });
    fireEvent.click(button); fireEvent.click(button);
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(true));
    expect((screen.getByRole('button', { name: 'Creating local planning revision…' }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    for (const label of ['Base brief', 'Revision date', 'Slug', 'Hypothesis', 'Intended metric']) {
      expect((screen.getByLabelText(label) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).disabled).toBe(true);
    }
    pending.resolve(response(success()));
    await screen.findByText(`Local planning revision created: ${ID}.`);
  });

  it('dispatches one explicit POST from a StrictMode mount', async () => {
    const pending = deferred<Response>();
    const fetchImpl = vi.fn(() => pending.promise) as unknown as typeof fetch;
    render(<StrictMode><ContentBriefRevisionForm
      bases={[BASE_A, BASE_B]}
      token="session-a"
      fetchImpl={fetchImpl}
      onRefreshRequested={vi.fn()}
    /></StrictMode>);
    fillValid(); submit();
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    pending.resolve(response(success()));
    await screen.findByText(`Local planning revision created: ${ID}.`);
  });

  it('accepts both 4096 UTF-16 unit text limits and the inclusive 105-unit slug limit', async () => {
    const { fetchImpl } = renderForm();
    fireEvent.change(screen.getByLabelText('Revision date'), { target: { value: '2026-09-12' } });
    fireEvent.change(screen.getByLabelText('Slug'), { target: { value: 'a'.repeat(105) } });
    fireEvent.change(screen.getByLabelText('Hypothesis'), { target: { value: 'h'.repeat(4096) } });
    fireEvent.change(screen.getByLabelText('Intended metric'), { target: { value: 'm'.repeat(4096) } });
    submit();
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
  });
});

describe('ContentBriefRevisionForm outcomes', () => {
  it.each([
    [400, 'The revision request was rejected before publication. Review the fields and try again.'],
    [413, 'The revision request was rejected before publication. Review the fields and try again.'],
    [401, 'Your session cannot create this local revision.'],
    [403, 'Your session cannot create this local revision.'],
    [404, 'The selected base is no longer available. Refresh recorded briefs.'],
    [429, 'Another write or a rate limit blocked this request. Nothing was sent again automatically.'],
  ])('uses fixed copy for HTTP %s without rendering private response text', async (status, copy) => {
    const fetchImpl = vi.fn(async () => response({ detail: 'PRIVATE_SERVER_PATH' }, status)) as unknown as typeof fetch;
    renderForm({ fetchImpl }); fillValid(); submit();
    await screen.findByText(copy);
    expect(document.body.textContent).not.toContain('PRIVATE_SERVER_PATH');
  });

  it('keeps conflict ambiguous and offers inventory refresh but no repeat POST control', async () => {
    const fetchImpl = vi.fn(async () => response({ detail: 'PRIVATE_CONFLICT' }, 409)) as unknown as typeof fetch;
    const { onRefreshRequested } = renderForm({ fetchImpl }); fillValid(); submit();
    await screen.findByText('A revision with that ID already exists. Inspect recorded briefs. This does not prove that an earlier request created it.');
    expect(screen.queryByRole('button', { name: /retry|create local planning revision/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh recorded briefs' }));
    expect(onRefreshRequested).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['transport rejection', () => Promise.reject(new Error('PRIVATE_NETWORK_DETAIL'))],
    ['503', () => response({ detail: 'PRIVATE_503' }, 503)],
    ['malformed success', () => new Response('{', { status: 200 })],
    ['wrong success id', () => response(success({ briefId: '2026-09-12-creator-001-other' }))],
    ['wrong success schema', () => response(success({ schema: 'figment/other@1' }))],
    ['extra success key', () => response(success({ privateRecovery: 'PRIVATE_RECOVERY_PATH' }))],
    ['uppercase success hash', () => response(success({ briefSha256: 'A'.repeat(64) }))],
    ['unsafe success id', () => response(success({ briefId: '../PRIVATE_PATH' }))],
    ['oversized decoded success', () => new Response(`${JSON.stringify(success())}${' '.repeat(4097)}`, { status: 200 })],
  ])('treats %s as an unknown outcome without retrying', async (_name, reply) => {
    const fetchImpl = vi.fn(async () => reply()) as unknown as typeof fetch;
    renderForm({ fetchImpl }); fillValid(); submit();
    await screen.findByText(AMBIGUOUS);
    expect(document.body.textContent).not.toMatch(/PRIVATE_NETWORK_DETAIL|PRIVATE_503/);
    fireEvent.change(screen.getByLabelText('Hypothesis'), { target: { value: 'A later edit must not resend the request.' } });
    expect(screen.queryByRole('button', { name: 'Create local planning revision' })).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('treats an injected synchronous fetch failure as ambiguous without rendering its detail', async () => {
    const fetchImpl = vi.fn(() => { throw new Error('PRIVATE_SYNCHRONOUS_FETCH_FAILURE'); }) as unknown as typeof fetch;
    renderForm({ fetchImpl }); fillValid(); submit();
    await screen.findByText(AMBIGUOUS);
    expect(document.body.textContent).not.toContain('PRIVATE_SYNCHRONOUS_FETCH_FAILURE');
    expect(screen.queryByRole('button', { name: 'Create local planning revision' })).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('shows only the exact public success and requests parent refresh only when clicked', async () => {
    const { fetchImpl, onRefreshRequested } = renderForm(); fillValid(); submit();
    await screen.findByText(`Local planning revision created: ${ID}.`);
    expect(screen.getByText(`Brief hash: ${HASH}`)).toBeTruthy();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh recorded briefs' }));
      fireEvent.click(screen.getByRole('button', { name: 'Refresh recorded briefs' }));
    });
    expect(onRefreshRequested).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['conflict', () => response({ detail: 'PRIVATE_CONFLICT' }, 409)],
    ['ambiguous transport failure', () => Promise.reject(new Error('PRIVATE_NETWORK_DETAIL'))],
  ])('never restores a POST control after %s even if the base or token changes', async (_name, reply) => {
    const fetchImpl = vi.fn(async () => reply()) as unknown as typeof fetch;
    const view = renderForm({ fetchImpl });
    fillValid(); submit();
    await screen.findByRole('alert');
    fireEvent.change(screen.getByLabelText('Base brief'), { target: { value: BASE_B.briefId } });
    view.rerender(<ContentBriefRevisionForm bases={[BASE_A, BASE_B]} token="session-b" fetchImpl={fetchImpl} onRefreshRequested={vi.fn()} />);
    await act(async () => {});
    expect(screen.queryByRole('button', { name: 'Create local planning revision' })).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('ContentBriefRevisionForm request ownership', () => {
  it.each(['base', 'token', 'fetch implementation', 'removed base'] as const)('invalidates a pending POST on %s change and ignores its late success', async (boundary) => {
    const pending = deferred<Response>();
    const first = vi.fn(() => pending.promise) as unknown as typeof fetch;
    const second = vi.fn(async () => response(success())) as unknown as typeof fetch;
    const view = renderForm({ fetchImpl: first }); fillValid(); submit();
    const [, init] = (first as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    if (boundary === 'base') fireEvent.change(screen.getByLabelText('Base brief'), { target: { value: BASE_B.briefId } });
    else if (boundary === 'token') view.rerender(<ContentBriefRevisionForm bases={[BASE_A, BASE_B]} token="session-b" fetchImpl={first} onRefreshRequested={vi.fn()} />);
    else if (boundary === 'fetch implementation') view.rerender(<ContentBriefRevisionForm bases={[BASE_A, BASE_B]} token="session-a" fetchImpl={second} onRefreshRequested={vi.fn()} />);
    else view.rerender(<ContentBriefRevisionForm bases={[BASE_B]} token="session-a" fetchImpl={first} onRefreshRequested={vi.fn()} />);
    expect(init.signal?.aborted).toBe(true);
    await screen.findByText(AMBIGUOUS);
    expect(screen.queryByRole('button', { name: 'Create local planning revision' })).toBeNull();
    pending.resolve(response(success()));
    await act(async () => {});
    expect(screen.queryByText(`Local planning revision created: ${ID}.`)).toBeNull();
    expect((first as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    expect((second as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it.each(['base', 'token', 'fetch implementation', 'removed base'] as const)('invalidates a pending POST on %s change and ignores its late rejection', async (boundary) => {
    const pending = deferred<Response>();
    const first = vi.fn(() => pending.promise) as unknown as typeof fetch;
    const second = vi.fn(async () => response(success())) as unknown as typeof fetch;
    const view = renderForm({ fetchImpl: first }); fillValid(); submit();
    const [, init] = (first as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    if (boundary === 'base') fireEvent.change(screen.getByLabelText('Base brief'), { target: { value: BASE_B.briefId } });
    else if (boundary === 'token') view.rerender(<ContentBriefRevisionForm bases={[BASE_A, BASE_B]} token="session-b" fetchImpl={first} onRefreshRequested={vi.fn()} />);
    else if (boundary === 'fetch implementation') view.rerender(<ContentBriefRevisionForm bases={[BASE_A, BASE_B]} token="session-a" fetchImpl={second} onRefreshRequested={vi.fn()} />);
    else view.rerender(<ContentBriefRevisionForm bases={[BASE_B]} token="session-a" fetchImpl={first} onRefreshRequested={vi.fn()} />);
    expect(init.signal?.aborted).toBe(true);
    await screen.findByText(AMBIGUOUS);
    expect(screen.queryByRole('button', { name: 'Create local planning revision' })).toBeNull();
    pending.reject(new Error('PRIVATE_LATE_REJECTION'));
    await act(async () => {});
    expect(screen.queryByText(`Local planning revision created: ${ID}.`)).toBeNull();
    expect(document.body.textContent).not.toMatch(/PRIVATE_LATE_REJECTION|cancel+ed/i);
  });

  it('keeps a pending request owned when a fresh but semantically equal bases list retains the selected ID', async () => {
    const pending = deferred<Response>();
    const fetchImpl = vi.fn(() => pending.promise) as unknown as typeof fetch;
    const view = renderForm({ fetchImpl });
    fireEvent.change(screen.getByLabelText('Base brief'), { target: { value: BASE_B.briefId } });
    fillValid(); submit();
    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    view.rerender(<ContentBriefRevisionForm
      bases={[{ ...BASE_A }, { ...BASE_B }]}
      token="session-a"
      fetchImpl={fetchImpl}
      onRefreshRequested={vi.fn()}
    />);
    expect(init.signal?.aborted).toBe(false);
    pending.resolve(response(success()));
    await screen.findByText(`Local planning revision created: ${ID}.`);
  });

  it.each(['token', 'fetch implementation', 'removed selected base'] as const)('hides established feedback before passive cleanup when the %s changes', async (boundary) => {
    const first = vi.fn(async () => response(success())) as unknown as typeof fetch;
    const second = vi.fn(async () => response(success())) as unknown as typeof fetch;
    const view = render(<FormWithLayoutObserver
      bases={[BASE_A, BASE_B]}
      token="session-a"
      fetchImpl={first}
      onRefreshRequested={vi.fn()}
      onLayout={() => {}}
    />);
    fillValid(); submit();
    await screen.findByText(`Local planning revision created: ${ID}.`);
    let observedBeforePassiveCleanup = false;
    const next = boundary === 'token'
      ? { bases: [BASE_A, BASE_B], token: 'session-b', fetchImpl: first }
      : boundary === 'fetch implementation'
        ? { bases: [BASE_A, BASE_B], token: 'session-a', fetchImpl: second }
        : { bases: [BASE_B], token: 'session-a', fetchImpl: first };
    view.rerender(<FormWithLayoutObserver
      {...next}
      onRefreshRequested={vi.fn()}
      onLayout={() => {
        observedBeforePassiveCleanup = true;
        expect(screen.queryByText(`Local planning revision created: ${ID}.`)).toBeNull();
      }}
    />);
    expect(observedBeforePassiveCleanup).toBe(true);
  });

  it('does not reanimate an old completion or auto-POST after unmount/remount or StrictMode', async () => {
    const pending = deferred<Response>();
    const fetchImpl = vi.fn(() => pending.promise) as unknown as typeof fetch;
    const view = renderForm({ fetchImpl }); fillValid(); submit();
    view.unmount(); pending.resolve(response(success()));
    await act(async () => {});
    render(<StrictMode><ContentBriefRevisionForm bases={[BASE_A]} token="session-a" fetchImpl={fetchImpl} onRefreshRequested={vi.fn()} /></StrictMode>);
    expect(screen.queryByText(`Local planning revision created: ${ID}.`)).toBeNull();
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });
});
