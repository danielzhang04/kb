// @vitest-environment jsdom
/**
 * U6 — Run Envelope panel. Steps render from an injected/fetched envelope, a failed fetch degrades
 * cleanly instead of throwing, and the fixture step-check section shows all three verdicts.
 *
 * U12 added three things this file now pins:
 *   - a LOCKED dashboard reads nothing and says so (every route here is behind the session gate, so
 *     "unavailable" used to be the panel blaming the daemon for a 401);
 *   - the SUBJECT is a picker over `GET /api/trace` — the transcripts that exist on this machine —
 *     rather than one hard-coded session id that 404s everywhere else;
 *   - the chips are the shared `.mc-badge*` system, `not-evaluated` included.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, cleanup, within, waitFor, fireEvent } from '@testing-library/react';
import { panel, RunEnvelopeBody, PREFERRED_SESSION_ID, defaultSubject } from './RunEnvelope.panel';
import { FIXTURE_ENVELOPE } from './runEnvelopeFixture';
import { SessionProvider } from '../../../lib/sessionContext';
import { clearStoredSession, persistSession } from '../../../lib/authClient';
import type { RunEnvelope } from '../../../../server/trace/envelope.ts';
import type { SessionListEntry, SessionListResponse } from '../../../../server/trace/routes.ts';
import { RuntimeCapabilitiesProvider } from '../../../lib/runtimeCapabilities';

afterEach(() => {
  cleanup();
  clearStoredSession();
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

/** Render under a fresh session. Every assertion that expects a read rides on this. */
function unlocked(node: React.JSX.Element): React.JSX.Element {
  persistSession({ token: 'tok', expiresAt: Date.now() + 3_600_000 });
  return (
    <SessionProvider deps={{ fetchAuthContext: async () => ({ mode: 'win32-desktop' as const }) }}>
      {node}
    </SessionProvider>
  );
}

/** Render with no session at all. */
function locked(node: React.JSX.Element): React.JSX.Element {
  clearStoredSession();
  return (
    <SessionProvider deps={{ fetchAuthContext: async () => ({ mode: 'win32-desktop' as const }) }}>
      {node}
    </SessionProvider>
  );
}

function entry(over: Partial<SessionListEntry> & { sessionId: string }): SessionListEntry {
  return { project: 'C--Users-someone-kb', modifiedAt: '2026-08-18T10:00:00.000Z', sizeBytes: 10, ...over };
}

function listResponse(sessions: SessionListEntry[], over: Partial<SessionListResponse> = {}): SessionListResponse {
  return { available: true, sessionRoot: '/root', truncated: false, sessions, ...over };
}

/**
 * A fetch stub that routes by URL: the list route and the per-session envelope route are two
 * different reads and a test that could not tell them apart would prove nothing about either.
 */
function stubRoutes(options: {
  list?: SessionListResponse | 'fail';
  envelopes?: Record<string, RunEnvelope | 'fail' | 'notfound'>;
}): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url === '/api/trace') {
      if (options.list === undefined || options.list === 'fail') throw new Error('list unreachable');
      return { ok: true, status: 200, json: async () => options.list };
    }
    const id = decodeURIComponent(url.replace('/api/trace/', ''));
    const found = options.envelopes?.[id];
    if (found === undefined || found === 'notfound') return { ok: false, status: 404, json: async () => ({}) };
    if (found === 'fail') throw new Error('offline');
    return { ok: true, status: 200, json: async () => found };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('RunEnvelope panel registration', () => {
  it('exports a well-shaped panel with a stable id', () => {
    expect(panel.id).toBe('run-envelope');
    expect(panel.title.length).toBeGreaterThan(0);
    expect(typeof panel.render).toBe('function');
  });
});

describe('RunEnvelope envelope section', () => {
  it('renders one row per step with tool, model, result state and duration', async () => {
    render(unlocked(<RunEnvelopeBody envelope={ENVELOPE} />));
    await waitFor(() => expect(screen.getByTestId('runenv-step-0')).toBeTruthy());
    const first = screen.getByTestId('runenv-step-0');
    expect(within(first).getByText('Read')).toBeTruthy();
    expect(within(first).getByText('result')).toBeTruthy();
    expect(within(first).getByText('1500ms')).toBeTruthy();

    const second = screen.getByTestId('runenv-step-1');
    expect(within(second).getByText('Bash')).toBeTruthy();
    expect(within(second).getByText('no result')).toBeTruthy();
  });

  it('renders the model through the shared ModelBadge (U16), weight and all', async () => {
    render(unlocked(<RunEnvelopeBody envelope={ENVELOPE} />));
    await waitFor(() => expect(screen.getByTestId('runenv-step-0')).toBeTruthy());
    const badge = within(screen.getByTestId('runenv-step-0')).getByTestId('model-badge');
    expect(badge.textContent).toBe('claude-opus-5');
    expect(badge.getAttribute('data-model-weight')).toBe('deep');
    // A step with no model still renders the badge (its own em-dash), never a bare undefined.
    const none = within(screen.getByTestId('runenv-step-1')).getByTestId('model-badge');
    expect(none.textContent).toBe('—');
  });

  /** U12 — the result chips come from `styles/app.css`, not a panel-local copy of the geometry. */
  it('renders result state through the SHARED mc-badge chips', async () => {
    render(unlocked(<RunEnvelopeBody envelope={ENVELOPE} />));
    await waitFor(() => expect(screen.getByTestId('runenv-step-0')).toBeTruthy());
    const ok = within(screen.getByTestId('runenv-step-0')).getByText('result');
    expect(ok.className).toContain('mc-badge');
    expect(ok.className).toContain('mc-badge--done');
    // "no result" is the app's NEUTRAL chip — it is neither good news nor bad, so it takes no tone.
    const pending = within(screen.getByTestId('runenv-step-1')).getByText('no result');
    expect(pending.className).toContain('mc-badge');
    expect(pending.className).not.toMatch(/mc-badge--(done|error)/);
    // No panel-local badge class survives anywhere in the rendered panel.
    expect(screen.getByLabelText('Run Envelope panel').innerHTML).not.toContain('ap-runenv__badge');
  });

  it('makes no network call when an envelope is injected', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(unlocked(<RunEnvelopeBody envelope={ENVELOPE} />));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches exactly once for a PINNED session id — no list request beside it', async () => {
    const fetchMock = stubRoutes({ envelopes: { 'sess-1': ENVELOPE } });
    render(unlocked(<RunEnvelopeBody sessionId="sess-1" />));
    await waitFor(() => expect(screen.getByTestId('runenv-step-0')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/trace/sess-1');
    // A parent that already knows its subject pays for one request, not two.
    expect(screen.queryByTestId('runenv-session-picker')).toBeNull();
  });

  it('degrades cleanly when the fetch rejects — no throw, explicit unavailable state', async () => {
    stubRoutes({ envelopes: { 'sess-x': 'fail' } });
    expect(() => render(unlocked(<RunEnvelopeBody sessionId="sess-x" />))).not.toThrow();
    await waitFor(() => expect(screen.getByTestId('runenv-unavailable')).toBeTruthy());
    expect(screen.queryByTestId('runenv-step-0')).toBeNull();
  });

  it('degrades cleanly on a non-OK response too', async () => {
    stubRoutes({ envelopes: {} });
    render(unlocked(<RunEnvelopeBody sessionId="missing" />));
    await waitFor(() => expect(screen.getByTestId('runenv-unavailable')).toBeTruthy());
  });

  it('is empty-safe for a run with no tool steps', async () => {
    render(unlocked(<RunEnvelopeBody envelope={{ sessionId: 'empty', stepCount: 0, steps: [] }} />));
    await waitFor(() => expect(screen.getByTestId('runenv-empty')).toBeTruthy());
    expect(screen.getByTestId('runenv-empty').textContent).toContain('No tool steps');
  });

  /**
   * "No tool steps in this run" is a CLAIM ABOUT A RUN. Every frame before a run is in hand — the
   * list still loading, no subject resolved, the envelope in flight — must say loading instead, or
   * the panel asserts a fact about a session it has not read.
   */
  it('never claims "no tool steps" before a run is actually in hand', async () => {
    let releaseList: ((value: unknown) => void) | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        if (String(input) === '/api/trace') {
          return new Promise((resolve) => {
            releaseList = resolve;
          });
        }
        return { ok: true, status: 200, json: async () => ENVELOPE };
      }),
    );

    render(unlocked(<RunEnvelopeBody />));
    // Frame 1: the transcript list has not answered, so there is not even a subject yet.
    await waitFor(() => expect(screen.getByTestId('runenv-empty')).toBeTruthy());
    expect(screen.getByTestId('runenv-empty').textContent).toContain('Loading envelope');
    expect(screen.getByTestId('runenv-empty').textContent).not.toContain('No tool steps');

    await act(async () => {
      releaseList?.({ ok: true, status: 200, json: async () => listResponse([entry({ sessionId: 'sess-1' })]) });
    });
    await waitFor(() => expect(screen.getByTestId('runenv-step-0')).toBeTruthy());
  });
});

/**
 * U12 — locked is not broken. Every route this panel reads sits behind the session pre-handler, so
 * a locked dashboard 401s; reporting that as "no transcript served for this session" points the
 * operator at the transcript store instead of at the lock screen.
 */
describe('RunEnvelope while the dashboard is locked', () => {
  it('reads nothing at all and names the lock as the reason', () => {
    const fetchMock = stubRoutes({ list: listResponse([entry({ sessionId: 'a' })]), envelopes: { a: ENVELOPE } });
    render(locked(<RunEnvelopeBody />));

    expect(screen.getByTestId('runenv-locked').textContent).toMatch(/unlock the dashboard/i);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('runenv-unavailable')).toBeNull();
    expect(screen.queryByTestId('runenv-session-picker')).toBeNull();
  });

  it('still shows the step check — it reads nothing, so hiding it would be its own small lie', () => {
    stubRoutes({ list: listResponse([]) });
    render(locked(<RunEnvelopeBody />));
    expect(screen.getAllByTestId(/^stepcheck-row-/).length).toBeGreaterThan(0);
  });
});

/**
 * U12 — subject selection. A hard-coded session id is a claim about ONE machine; the picker asks the
 * daemon which transcripts actually exist and offers those.
 */
describe('RunEnvelope subject picker', () => {
  it('uses the existing no-transcript state and makes no trace probe when the capability is absent', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(unlocked(
      <RuntimeCapabilitiesProvider value={{ pty: false, localTranscripts: false }}>
        <RunEnvelopeBody />
      </RuntimeCapabilitiesProvider>,
    ));

    await waitFor(() => expect(screen.getByTestId('runenv-no-transcripts')).toBeTruthy());
    expect(screen.getByTestId('runenv-no-transcripts').textContent).toMatch(/no transcript on this machine/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('prefers the built-in session id WHEN THE MACHINE HAS IT, and reads that one', async () => {
    const fetchMock = stubRoutes({
      list: listResponse([entry({ sessionId: 'newer' }), entry({ sessionId: PREFERRED_SESSION_ID })]),
      envelopes: { [PREFERRED_SESSION_ID]: ENVELOPE },
    });
    render(unlocked(<RunEnvelopeBody />));

    await waitFor(() => expect(screen.getByTestId('runenv-step-0')).toBeTruthy());
    const picker = screen.getByTestId('runenv-session-picker') as HTMLSelectElement;
    expect(picker.value).toBe(PREFERRED_SESSION_ID);
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toContain(`/api/trace/${PREFERRED_SESSION_ID}`);
  });

  it('falls back to the newest listed transcript when the built-in id is absent', async () => {
    stubRoutes({
      list: listResponse([entry({ sessionId: 'newest' }), entry({ sessionId: 'older' })]),
      envelopes: { newest: { ...ENVELOPE, sessionId: 'newest' } },
    });
    render(unlocked(<RunEnvelopeBody />));

    await waitFor(() => expect(screen.getByTestId('runenv-step-0')).toBeTruthy());
    expect((screen.getByTestId('runenv-session-picker') as HTMLSelectElement).value).toBe('newest');
  });

  it('re-reads the envelope when a different session is picked', async () => {
    const fetchMock = stubRoutes({
      list: listResponse([entry({ sessionId: 'first' }), entry({ sessionId: 'second' })]),
      envelopes: {
        first: { ...ENVELOPE, sessionId: 'first' },
        second: { sessionId: 'second', stepCount: 1, steps: [{ ...ENVELOPE.steps[0], id: 'toolu_c', name: 'Grep' }] },
      },
    });
    render(unlocked(<RunEnvelopeBody />));
    await waitFor(() => expect(screen.getByTestId('runenv-step-0')).toBeTruthy());

    fireEvent.change(screen.getByTestId('runenv-session-picker'), { target: { value: 'second' } });
    await waitFor(() => expect(within(screen.getByTestId('runenv-step-0')).getByText('Grep')).toBeTruthy());
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toContain('/api/trace/second');
  });

  it('says "no transcript on this machine" for an empty root — never a spinner and never a failure', async () => {
    const fetchMock = stubRoutes({ list: listResponse([]) });
    render(unlocked(<RunEnvelopeBody />));

    await waitFor(() => expect(screen.getByTestId('runenv-no-transcripts')).toBeTruthy());
    expect(screen.getByTestId('runenv-no-transcripts').textContent).toMatch(/no transcript on this machine/i);
    // No envelope was requested for a session nobody named.
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual(['/api/trace']);
    expect(screen.queryByTestId('runenv-empty')).toBeNull();
    expect(screen.queryByTestId('runenv-unavailable')).toBeNull();
  });

  it('treats a failed list request as unavailable, distinct from a successful-but-empty list', async () => {
    stubRoutes({ list: listResponse([], { available: false }) });
    render(unlocked(<RunEnvelopeBody />));
    await waitFor(() => expect(screen.getByTestId('runenv-no-transcripts')).toBeTruthy());
    cleanup();

    stubRoutes({ list: 'fail' });
    render(unlocked(<RunEnvelopeBody />));
    await waitFor(() => expect(screen.getByTestId('runenv-list-unavailable')).toBeTruthy());
  });

  it('defaultSubject is a pure function of the list, with no default invented from nothing', () => {
    expect(defaultSubject([])).toBeNull();
    expect(defaultSubject([entry({ sessionId: 'a' }), entry({ sessionId: 'b' })])).toBe('a');
    expect(defaultSubject([entry({ sessionId: 'a' }), entry({ sessionId: PREFERRED_SESSION_ID })])).toBe(
      PREFERRED_SESSION_ID,
    );
  });
});

describe('RunEnvelope step-check section', () => {
  it('labels itself as a report-only prototype and NAMES the fixture it reports on', () => {
    render(unlocked(<RunEnvelopeBody envelope={ENVELOPE} />));
    expect(screen.getByText('prototype — fixture only, report-only, never mutates')).toBeTruthy();
    // The heading names the fixture session, so its rows can never be read as the live run above.
    expect(screen.getByText(`Step check — fixture ${FIXTURE_ENVELOPE.sessionId}`)).toBeTruthy();
    expect(FIXTURE_ENVELOPE.sessionId).not.toBe(ENVELOPE.sessionId);
  });

  it('reports one row per fixture step per rule, with BOTH pass and fail verdicts', () => {
    render(unlocked(<RunEnvelopeBody envelope={ENVELOPE} />));
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

  /**
   * U12 — the third state has to be ON SCREEN by default. Before this, `not-evaluated` was reachable
   * only by injecting a fixture from a test: the code had the state, the panel never showed it, and
   * nobody would learn to recognise "could not check" from using the thing.
   */
  it('shows a NOT-EVALUATED verdict in the DEFAULT render, not only under an injected fixture', () => {
    render(unlocked(<RunEnvelopeBody envelope={ENVELOPE} />));
    const unevaluated = screen
      .getAllByTestId(/^stepcheck-outcome-/)
      .filter((el) => el.getAttribute('data-verdict') === 'not-evaluated');
    expect(unevaluated.length).toBeGreaterThan(0);
    expect(unevaluated[0].textContent).toBe('not evaluated');
    // The fixture earns it honestly: exactly one step has no measurable duration.
    expect(FIXTURE_ENVELOPE.steps.filter((s) => s.durationMs === null)).toHaveLength(1);
    expect(unevaluated).toHaveLength(1);
  });

  it('renders a NOT-EVALUATED verdict distinctly from a pass, in the shared badge system', () => {
    // A step with no measurable duration: maxDurationMs cannot be checked on it.
    const unmeasurable: RunEnvelope = {
      sessionId: 'unmeasurable',
      stepCount: 1,
      steps: [{ ...FIXTURE_ENVELOPE.steps[0], endedAt: null, durationMs: null }],
    };
    render(unlocked(<RunEnvelopeBody envelope={ENVELOPE} fixtureEnvelope={unmeasurable} />));
    const badges = screen.getAllByTestId(/^stepcheck-outcome-/);
    const skipped = badges.filter((b) => b.getAttribute('data-verdict') === 'not-evaluated');
    expect(skipped).toHaveLength(1);
    expect(skipped[0].textContent).toBe('not evaluated');
    // Distinct styling, from the SHARED system — it must not borrow the pass chip.
    expect(skipped[0].className).toContain('mc-badge');
    expect(skipped[0].className).toContain('mc-badge--unevaluated');
    expect(skipped[0].className).not.toContain('mc-badge--done');
    const passed = badges.filter((b) => b.getAttribute('data-verdict') === 'pass');
    expect(passed[0].className).toContain('mc-badge--done');
    expect(passed[0].className).not.toContain('mc-badge--unevaluated');
  });

  it('does not mutate the fixture envelope it reports on', () => {
    const before = JSON.stringify(FIXTURE_ENVELOPE);
    render(unlocked(<RunEnvelopeBody envelope={ENVELOPE} />));
    expect(JSON.stringify(FIXTURE_ENVELOPE)).toBe(before);
  });
});
