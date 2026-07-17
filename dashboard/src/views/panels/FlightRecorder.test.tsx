// @vitest-environment jsdom
/**
 * D3.5 — Flight Recorder panel. A read-only index of committed distilled trace permalinks. Each card
 * with a recorded run links to its stable `traces/<card-id>/` permalink (the directory that serves the
 * committed `index.html` from `server/trace/`). No live fetch of transcript bytes — just links.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { FlightRecorder, tracePermalink } from './FlightRecorder';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('tracePermalink', () => {
  it('is the stable traces/<card-id>/ directory permalink shape', () => {
    expect(tracePermalink('card-77')).toBe('traces/card-77/');
  });

  it('percent-encodes a hostile id so it cannot escape traces/ (LOW-2)', () => {
    // A card id carrying path metacharacters must not normalize out of traces/.
    expect(tracePermalink('../../etc/secret')).toBe('traces/..%2F..%2Fetc%2Fsecret/');
    expect(tracePermalink('a/b')).toBe('traces/a%2Fb/');
  });
});

describe('FlightRecorder panel', () => {
  it('links each card to its committed traces/<card-id>/ permalink', () => {
    render(<FlightRecorder cardIds={['card-77', 'card-91']} />);

    expect(screen.getByLabelText('Flight Recorder panel')).toBeTruthy();

    const row = screen.getByTestId('trace-row-card-77');
    const link = within(row).getByRole('link') as HTMLAnchorElement;
    // The permalink points at the committed trace directory (serves index.html).
    expect(link.getAttribute('href')).toBe('/traces/card-77/');
    expect(within(row).getByText('card-77')).toBeTruthy();

    const other = screen.getByTestId('trace-row-card-91');
    expect((within(other).getByRole('link') as HTMLAnchorElement).getAttribute('href')).toBe(
      '/traces/card-91/',
    );
  });

  it('self-fetches the Plane-A index and lists completed cards as trace links', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          json: () =>
            Promise.resolve({
              cards: {
                done: [{ meta: { id: 'card-done-1' }, body: '' }],
                working: [{ meta: { id: 'card-working-1' }, body: '' }],
              },
            }),
        }),
      ),
    );

    render(<FlightRecorder />);
    const link = (await screen.findByTestId('trace-row-card-done-1')).querySelector('a');
    expect(link?.getAttribute('href')).toBe('/traces/card-done-1/');
  });

  it('renders a calm empty state when no traces are recorded', () => {
    render(<FlightRecorder cardIds={[]} />);
    expect(screen.getByText(/no committed traces/i)).toBeTruthy();
  });
});
