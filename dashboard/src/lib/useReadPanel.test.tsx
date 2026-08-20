// @vitest-environment jsdom
/**
 * `lib/useReadPanel` (U12) — the shared one-GET read effect, pinned once for the six panels that used
 * to carry a hand-written copy of it.
 *
 * The behaviours below are the ones a copy is most likely to get subtly wrong: the cancellation guard
 * (invisible when it works, a warning and a stale write when it does not), the `idle`/`loading`
 * distinction, and clearing the previous body before the next read lands.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { useReadPanel } from './useReadPanel';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** A probe that renders exactly what the hook reports, so assertions read off the DOM. */
function Probe({ url }: { url: string | null }): React.JSX.Element {
  const { data, state } = useReadPanel<{ name: string }>(url);
  return (
    <div>
      <span data-testid="state">{state}</span>
      <span data-testid="data">{data?.name ?? '(none)'}</span>
    </div>
  );
}

function stub(impl: (url: string) => Promise<unknown>): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: unknown) => impl(String(input)));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

describe('useReadPanel', () => {
  it('reads the url once and reports ready with the parsed body', async () => {
    const fetchMock = stub(async () => ok({ name: 'alpha' }));
    render(<Probe url="/api/thing" />);

    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('ready'));
    expect(screen.getByTestId('data').textContent).toBe('alpha');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/thing');
  });

  it('a null url reads NOTHING and reports idle — not loading, and not an empty result', async () => {
    const fetchMock = stub(async () => ok({ name: 'alpha' }));
    render(<Probe url={null} />);

    expect(screen.getByTestId('state').textContent).toBe('idle');
    expect(screen.getByTestId('data').textContent).toBe('(none)');
    expect(fetchMock).not.toHaveBeenCalled();
    // `idle` is how a panel gates on a lock or on an unpicked subject; painting an empty state there
    // would claim "nothing found" about a question that was never asked.
  });

  it('reports unavailable for a non-2xx, a rejected fetch, and an unparseable body alike', async () => {
    for (const impl of [
      async () => ({ ok: false, status: 401, json: async () => ({}) }),
      async () => ({ ok: false, status: 500, json: async () => ({}) }),
      async () => {
        throw new Error('offline');
      },
      async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('not json');
        },
      }),
    ]) {
      stub(impl as (url: string) => Promise<unknown>);
      render(<Probe url="/api/thing" />);
      await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('unavailable'));
      expect(screen.getByTestId('data').textContent).toBe('(none)');
      cleanup();
    }
  });

  it('re-reads when the url changes, and clears the old body before the new one lands', async () => {
    let release: ((value: unknown) => void) | null = null;
    const fetchMock = stub(async (url) => {
      if (url === '/api/first') return ok({ name: 'first' });
      return new Promise((resolve) => {
        release = resolve;
      });
    });

    const { rerender } = render(<Probe url="/api/first" />);
    await waitFor(() => expect(screen.getByTestId('data').textContent).toBe('first'));

    rerender(<Probe url="/api/second" />);
    // The FIRST subject's body must not sit under the SECOND subject's heading while it loads.
    expect(screen.getByTestId('data').textContent).toBe('(none)');
    expect(screen.getByTestId('state').textContent).toBe('loading');

    await act(async () => {
      release?.(ok({ name: 'second' }));
    });
    await waitFor(() => expect(screen.getByTestId('data').textContent).toBe('second'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('drops a response that arrives after unmount — no state write into a dead tree', async () => {
    let release: ((value: unknown) => void) | null = null;
    stub(
      async () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { unmount } = render(<Probe url="/api/slow" />);
    expect(screen.getByTestId('state').textContent).toBe('loading');
    unmount();

    await act(async () => {
      release?.(ok({ name: 'too late' }));
    });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('drops the OLD url’s response when it lands after the url already changed', async () => {
    const pending: Record<string, (value: unknown) => void> = {};
    stub(
      async (url) =>
        new Promise((resolve) => {
          pending[url] = resolve;
        }),
    );

    const { rerender } = render(<Probe url="/api/stale" />);
    rerender(<Probe url="/api/fresh" />);

    await act(async () => {
      pending['/api/fresh']?.(ok({ name: 'fresh' }));
    });
    await waitFor(() => expect(screen.getByTestId('data').textContent).toBe('fresh'));

    // The abandoned read finally answers — it must not overwrite the current subject's body.
    await act(async () => {
      pending['/api/stale']?.(ok({ name: 'stale' }));
    });
    expect(screen.getByTestId('data').textContent).toBe('fresh');
    expect(screen.getByTestId('state').textContent).toBe('ready');
  });

  it('goes back to idle when the url becomes null again', async () => {
    stub(async () => ok({ name: 'alpha' }));
    const { rerender } = render(<Probe url="/api/thing" />);
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('ready'));

    rerender(<Probe url={null} />);
    expect(screen.getByTestId('state').textContent).toBe('idle');
    expect(screen.getByTestId('data').textContent).toBe('(none)');
  });
});
