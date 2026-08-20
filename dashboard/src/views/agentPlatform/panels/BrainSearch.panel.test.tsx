// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AGENT_PLATFORM_PANELS } from '../registry';
import { panel } from './BrainSearch.panel';

function stubFetch(payload: unknown): ReturnType<typeof vi.fn> {
  const fetch = vi.fn(async () => ({ ok: true, json: async () => payload }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('BrainSearch panel', () => {
  it('registers itself without making a request before the first submitted query', () => {
    const fetch = stubFetch({ available: false, reason: 'index-not-built' });
    render(panel.render());
    expect(panel.id).toBe('brain-search');
    expect(AGENT_PLATFORM_PANELS.some((candidate) => candidate.id === 'brain-search')).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('states the measured per-query cost honestly — every query, not just the first', async () => {
    stubFetch({ query: 'alerts', k: 8, results: [] });
    render(panel.render());
    fireEvent.change(screen.getByLabelText('Search the brain'), { target: { value: 'alerts' } });
    fireEvent.submit(screen.getByTestId('ap-brainsearch-form'));

    const note = await screen.findByTestId('ap-brainsearch-loading');
    expect(note.textContent).toMatch(/every query/i);
    expect(note.textContent).not.toMatch(/first query/i);
    expect(note.textContent).toMatch(/10-20 seconds/);
  });

  it('submits a query and renders ranked results', async () => {
    const fetch = stubFetch({
      query: 'alerts before release', k: 8,
      results: [{
        source_path: 'docs/observability.md', heading_path: ['Observability', 'Canary lookup'],
        score: 0.9876, start_line: 3, end_line: 4, snippet: 'Alerts arrive before a deployment.',
      }],
    });
    render(panel.render());
    fireEvent.change(screen.getByLabelText('Search the brain'), { target: { value: 'alerts before release' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect((await screen.findByTestId('ap-brainsearch-result-0')).textContent).toContain('docs/observability.md');
    expect(screen.getByText('Observability > Canary lookup')).toBeTruthy();
    expect(screen.getByText('0.9876')).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith('/api/brain/search?q=alerts%20before%20release&k=8');
  });

  it('honestly renders empty and each unavailable reason', async () => {
    stubFetch({ query: 'nothing', k: 8, results: [] });
    render(panel.render());
    fireEvent.change(screen.getByLabelText('Search the brain'), { target: { value: 'nothing' } });
    fireEvent.submit(screen.getByTestId('ap-brainsearch-form'));
    expect((await screen.findByTestId('ap-brainsearch-empty')).textContent).toMatch(/no matching chunks/i);
    cleanup();

    stubFetch({ available: false, reason: 'index-not-built' });
    render(panel.render());
    fireEvent.change(screen.getByLabelText('Search the brain'), { target: { value: 'nothing' } });
    fireEvent.submit(screen.getByTestId('ap-brainsearch-form'));
    expect((await screen.findByTestId('ap-brainsearch-unavailable')).textContent).toMatch(/index not built/i);
    cleanup();

    stubFetch({ available: false, reason: 'query-failed' });
    render(panel.render());
    fireEvent.change(screen.getByLabelText('Search the brain'), { target: { value: 'nothing' } });
    fireEvent.submit(screen.getByTestId('ap-brainsearch-form'));
    expect((await screen.findByTestId('ap-brainsearch-unavailable')).textContent).toMatch(/search failed/i);
  });

  /**
   * U12 — the two reasons that used to fall through to the generic fallback. Both mean "the index on
   * disk cannot be used as-is", which is a REBUILD instruction, not a retry-later one.
   */
  it('names the model-mismatch and index-format reasons as rebuild instructions', async () => {
    for (const reason of ['model-mismatch', 'index-format-error']) {
      stubFetch({ available: false, reason });
      render(panel.render());
      fireEvent.change(screen.getByLabelText('Search the brain'), { target: { value: 'nothing' } });
      fireEvent.submit(screen.getByTestId('ap-brainsearch-form'));
      const note = await screen.findByTestId('ap-brainsearch-unavailable');
      expect(note.textContent, reason).toMatch(/rebuild it/i);
      expect(note.textContent, reason).not.toMatch(/search failed/i);
      cleanup();
    }
  });

  it('never blames a "brain service" — there is no service, only a per-query local process', async () => {
    for (const reason of ['index-not-built', 'model-mismatch', 'index-format-error', 'query-failed', 'something-new']) {
      stubFetch({ available: false, reason });
      render(panel.render());
      fireEvent.change(screen.getByLabelText('Search the brain'), { target: { value: 'nothing' } });
      fireEvent.submit(screen.getByTestId('ap-brainsearch-form'));
      const note = await screen.findByTestId('ap-brainsearch-unavailable');
      expect(note.textContent, reason).not.toMatch(/service/i);
      // An unrecognised reason still gets a stated answer rather than a blank chip.
      expect((note.textContent ?? '').length, reason).toBeGreaterThan(0);
      cleanup();
    }
  });
});
