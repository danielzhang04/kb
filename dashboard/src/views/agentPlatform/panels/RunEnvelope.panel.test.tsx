// @vitest-environment jsdom
/**
 * U6 — Run Envelope panel. Steps render from an injected/fetched envelope, a failed fetch degrades
 * cleanly instead of throwing, and the fixture step-check section shows BOTH pass and fail rows.
 * Exactly one network call is ever made, and it is mocked.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, within, waitFor } from '@testing-library/react';
import { panel, RunEnvelopeBody } from './RunEnvelope.panel';
import { FIXTURE_ENVELOPE } from './runEnvelopeFixture';
import type { RunEnvelope } from '../../../../server/trace/envelope.ts';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ENVELOPE: RunEnvelope = {
  sessionId: 'sess-1',
  stepCount: 2,
  steps: [
    {
      id: 'toolu_a',
      index: 0,
      name: 'Read',
      model: 'claude-opus-5',
      hasResult: true,
      isError: undefined,
      usage: null,
      startedAt: '2026-08-18T10:00:00.000Z',
      endedAt: '2026-08-18T10:00:01.500Z',
      durationMs: 1500,
    },
    {
      id: 'toolu_b',
      index: 1,
      name: 'Bash',
      model: null,
      hasResult: false,
      isError: undefined,
      usage: null,
      startedAt: '2026-08-18T10:00:02.000Z',
      endedAt: null,
      durationMs: null,
    },
  ],
};

describe('RunEnvelope panel registration', () => {
  it('exports a well-shaped panel with a stable id', () => {
    expect(panel.id).toBe('run-envelope');
    expect(panel.title.length).toBeGreaterThan(0);
    expect(typeof panel.render).toBe('function');
  });
});

describe('RunEnvelope envelope section', () => {
  it('renders one row per step with tool, model, result state and duration', () => {
    render(<RunEnvelopeBody envelope={ENVELOPE} />);
    const first = screen.getByTestId('runenv-step-0');
    expect(within(first).getByText('Read')).toBeTruthy();
    expect(within(first).getByText('result')).toBeTruthy();
    expect(within(first).getByText('1500ms')).toBeTruthy();

    const second = screen.getByTestId('runenv-step-1');
    expect(within(second).getByText('Bash')).toBeTruthy();
    expect(within(second).getByText('no result')).toBeTruthy();
  });

  it('renders the model through the shared ModelBadge (U16), weight and all', () => {
    render(<RunEnvelopeBody envelope={ENVELOPE} />);
    const badge = within(screen.getByTestId('runenv-step-0')).getByTestId('model-badge');
    expect(badge.textContent).toBe('claude-opus-5');
    expect(badge.getAttribute('data-model-weight')).toBe('deep');
    // A step with no model still renders the badge (its own em-dash), never a bare undefined.
    const none = within(screen.getByTestId('runenv-step-1')).getByTestId('model-badge');
    expect(none.textContent).toBe('—');
  });

  it('makes no network call when an envelope is injected', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<RunEnvelopeBody envelope={ENVELOPE} />);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches exactly once for the given session id and renders the response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ENVELOPE });
    vi.stubGlobal('fetch', fetchMock);
    render(<RunEnvelopeBody sessionId="sess-1" />);
    await waitFor(() => expect(screen.getByTestId('runenv-step-0')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/trace/sess-1');
  });

  it('degrades cleanly when the fetch rejects — no throw, explicit unavailable state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(() => render(<RunEnvelopeBody sessionId="sess-x" />)).not.toThrow();
    await waitFor(() => expect(screen.getByTestId('runenv-unavailable')).toBeTruthy());
    expect(screen.queryByTestId('runenv-step-0')).toBeNull();
  });

  it('degrades cleanly on a non-OK response too', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }));
    render(<RunEnvelopeBody sessionId="missing" />);
    await waitFor(() => expect(screen.getByTestId('runenv-unavailable')).toBeTruthy());
  });

  it('is empty-safe for a run with no tool steps', () => {
    render(<RunEnvelopeBody envelope={{ sessionId: 'empty', stepCount: 0, steps: [] }} />);
    expect(screen.getByTestId('runenv-empty').textContent).toContain('No tool steps');
  });
});

describe('RunEnvelope step-check section', () => {
  it('labels itself as a report-only prototype and NAMES the fixture it reports on', () => {
    render(<RunEnvelopeBody envelope={ENVELOPE} />);
    expect(screen.getByText('prototype — fixture only, report-only, never mutates')).toBeTruthy();
    // The heading names the fixture session, so its rows can never be read as the live run above.
    expect(screen.getByText(`Step check — fixture ${FIXTURE_ENVELOPE.sessionId}`)).toBeTruthy();
    expect(FIXTURE_ENVELOPE.sessionId).not.toBe(ENVELOPE.sessionId);
  });

  it('reports one row per fixture step per rule, with BOTH pass and fail verdicts', () => {
    render(<RunEnvelopeBody envelope={ENVELOPE} />);
    const verdicts = screen.getAllByTestId(/^stepcheck-outcome-/).map((el) => el.getAttribute('data-verdict'));
    expect(verdicts.length).toBe(FIXTURE_ENVELOPE.steps.length * 5);
    expect(verdicts).toContain('pass');
    expect(verdicts).toContain('fail');
    // The fixture's third step is an errored `Write`: it breaks both toolAllowed and noError.
    const failRows = screen
      .getAllByTestId(/^stepcheck-row-/)
      .filter((row) => within(row).queryByText('fail') !== null)
      .map((row) => row.textContent ?? '');
    expect(failRows.some((t) => t.includes('noError'))).toBe(true);
    expect(failRows.some((t) => t.includes('toolAllowed'))).toBe(true);
    // …and the two 7s Glob steps blow the 5s budget.
    expect(failRows.some((t) => t.includes('maxDurationMs'))).toBe(true);
  });

  it('renders a NOT-EVALUATED verdict distinctly from a pass', () => {
    // A step with no measurable duration: maxDurationMs cannot be checked on it.
    const unmeasurable: RunEnvelope = {
      sessionId: 'unmeasurable',
      stepCount: 1,
      steps: [{ ...FIXTURE_ENVELOPE.steps[0], endedAt: null, durationMs: null }],
    };
    render(<RunEnvelopeBody envelope={ENVELOPE} fixtureEnvelope={unmeasurable} />);
    const badges = screen.getAllByTestId(/^stepcheck-outcome-/);
    const skipped = badges.filter((b) => b.getAttribute('data-verdict') === 'not-evaluated');
    expect(skipped).toHaveLength(1);
    expect(skipped[0].textContent).toBe('not evaluated');
    // Distinct styling — it must not borrow the pass chip.
    expect(skipped[0].className).toContain('ap-runenv__badge--skipped');
    expect(skipped[0].className).not.toContain('ap-runenv__badge--ok');
  });

  it('does not mutate the fixture envelope it reports on', () => {
    const before = JSON.stringify(FIXTURE_ENVELOPE);
    render(<RunEnvelopeBody envelope={ENVELOPE} />);
    expect(JSON.stringify(FIXTURE_ENVELOPE)).toBe(before);
  });
});
