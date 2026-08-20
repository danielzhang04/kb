// @vitest-environment jsdom
/**
 * Loop Status panel (Wave-1 U-L2). What is pinned here:
 *   1. it registers itself by file drop, and it OPENS the section (`order` lower than every other);
 *   2. every loop state renders a DISTINCT chip, asserted by CLASS NAME (never by colour), including
 *      the `approvals` → "needs you" translation the whole panel exists to make unmissable;
 *   3. a paused loop says "paused" and still shows its track record;
 *   4. the honest empty state is gated on `anyDeclared`: "cadence drafts await arming" is said only
 *      while every loop is still undeclared, a declared-but-unbeaten loop instead says "Declared — no
 *      runs yet.", and either is worded differently from the daemon-unavailable state, which is a fact
 *      about the dashboard, not the fleet;
 *   5. the panel is READ-ONLY on the wire: exactly one call, a GET, no body.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { AGENT_PLATFORM_PANELS } from '../registry';
import { panel } from './LoopStatus.panel';
import { SessionProvider } from '../../../lib/sessionContext';
import { clearStoredSession, persistSession } from '../../../lib/authClient';
import type { LoopRow, LoopRun, LoopStatusPanel } from '../../../../server/panels/loopStatus';

function run(over: Partial<LoopRun> & { cadence: string }): LoopRun {
  return {
    label: 'Hygiene loop',
    date: '2026-08-18',
    card: 'aaaa0001-1111',
    project: 'kb',
    source: 'dispatch',
    outcome: 'done',
    narration: 'swept 3 branches',
    cardFound: true,
    ...over,
  };
}

function loop(over: Partial<LoopRow> & { cadence: string }): LoopRow {
  return {
    label: 'Hygiene loop',
    schedule: 'daily',
    declared: true,
    paused: false,
    state: 'never-run',
    lastRun: null,
    runCount: 0,
    ...over,
  };
}

/** The armed world: three DECLARED loops, none of which has run yet. */
const EMPTY: LoopStatusPanel = {
  label: 'loop-status',
  loops: [
    loop({ cadence: 'loop-a-hygiene', label: 'Hygiene loop', schedule: 'daily' }),
    loop({ cadence: 'loop-b-lesson-mining', label: 'Lesson-mining loop', schedule: 'daily' }),
    loop({ cadence: 'loop-c-agent-upgrade', label: 'Agent-upgrade loop', schedule: 'weekly:sat' }),
  ],
  feed: [],
  ledgerRowCount: 0,
  handRunCount: 0,
  rejectedRuns: 0,
  neverRun: true,
  anyDeclared: true,
};

/** TODAY's real shape: the three loops exist only as proposal drafts — no cadence declares them. */
const DRAFTS: LoopStatusPanel = {
  ...EMPTY,
  loops: EMPTY.loops.map((l) => ({ ...l, declared: false, state: 'not-declared' as const })),
  anyDeclared: false,
};

const DONE_RUN = run({ cadence: 'loop-a-hygiene' });
const APPROVALS_RUN = run({
  cadence: 'loop-b-lesson-mining',
  label: 'Lesson-mining loop',
  date: '2026-08-17',
  card: 'bbbb0002-2222',
  outcome: 'approvals',
  narration: 'two proposed lessons need your ruling',
});

const POPULATED: LoopStatusPanel = {
  label: 'loop-status',
  loops: [
    loop({
      cadence: 'loop-a-hygiene',
      state: 'done',
      lastRun: DONE_RUN,
      runCount: 1,
    }),
    loop({
      cadence: 'loop-b-lesson-mining',
      label: 'Lesson-mining loop',
      state: 'approvals',
      lastRun: APPROVALS_RUN,
      runCount: 1,
    }),
    loop({
      cadence: 'loop-c-agent-upgrade',
      label: 'Agent-upgrade loop',
      schedule: 'weekly:sat',
      paused: true,
      state: 'paused',
      lastRun: run({
        cadence: 'loop-c-agent-upgrade',
        label: 'Agent-upgrade loop',
        date: '2026-08-15',
        card: 'cccc0003-3333',
        outcome: 'working',
        narration: 'drafting an upgrade for codex-a',
      }),
      runCount: 1,
    }),
  ],
  feed: [DONE_RUN, APPROVALS_RUN],
  ledgerRowCount: 3,
  handRunCount: 0,
  rejectedRuns: 0,
  neverRun: false,
  anyDeclared: true,
};

/** Record every fetch call so the GET-only claim is asserted, not assumed. */
const calls: { url: string; init?: RequestInit }[] = [];

function stubFetch(payload: LoopStatusPanel | 'fail' = POPULATED): void {
  calls.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      if (String(input) === '/api/auth/context') {
        return { ok: true, status: 200, json: async () => ({ mode: 'win32-desktop' }) };
      }
      if (payload === 'fail') throw new Error('daemon unreachable');
      return { ok: true, status: 200, json: async () => payload };
    }),
  );
}

function unlocked(): React.JSX.Element {
  persistSession({ token: 'tok', expiresAt: Date.now() + 3_600_000 });
  return <SessionProvider>{panel.render()}</SessionProvider>;
}

function locked(): React.JSX.Element {
  clearStoredSession();
  return <SessionProvider>{panel.render()}</SessionProvider>;
}

afterEach(() => {
  cleanup();
  clearStoredSession();
  vi.unstubAllGlobals();
});

describe('LoopStatus panel', () => {
  it('registers itself by file drop and opens the section', () => {
    expect(panel.id).toBe('loop-status');
    expect(AGENT_PLATFORM_PANELS.some((p) => p.id === 'loop-status')).toBe(true);
    expect(AGENT_PLATFORM_PANELS[0].id).toBe('loop-status');
  });

  it('renders one named strip per loop with its DECLARED schedule, verbatim', async () => {
    stubFetch(EMPTY);
    render(unlocked());

    const hygiene = await screen.findByTestId('ap-loops-row-loop-a-hygiene');
    expect(hygiene.textContent).toContain('Hygiene loop'); // plain words, not the slug
    expect(hygiene.textContent).not.toContain('loop-a-hygiene');
    const upgrade = screen.getByTestId('ap-loops-schedule-loop-c-agent-upgrade');
    expect(upgrade.textContent).toContain('weekly:sat');
    expect(upgrade.textContent).toMatch(/^declared schedule:/);
    expect(screen.getByTestId('ap-loops-schedule-loop-a-hygiene').textContent).toContain('daily');
    // No due/next-run claim anywhere: the dispatcher owns that answer.
    expect(hygiene.textContent).not.toMatch(/next run|due|overdue/i);
  });

  /**
   * The state of the world TODAY. Calling a drafted schedule "declared" tells an operator the
   * dispatcher will beat it, which is false until a cadence block exists.
   */
  it('shows an undeclared loop as a DRAFT and refuses to call its schedule declared', async () => {
    stubFetch(DRAFTS);
    render(unlocked());

    const state = await screen.findByTestId('ap-loops-state-loop-a-hygiene');
    expect(state.getAttribute('data-state')).toBe('not-declared');
    expect(state.textContent).toBe('draft — not declared yet');
    expect(state.innerHTML).toContain('mc-status-dot--idle');
    // Not borrowing a run outcome's badge — this is the absence of a cadence, not a result.
    expect(state.innerHTML).not.toContain('mc-badge--');

    const schedule = screen.getByTestId('ap-loops-schedule-loop-c-agent-upgrade');
    expect(schedule.textContent).toMatch(/^proposed schedule \(not declared\):/);
    expect(schedule.textContent).toContain('weekly:sat');
    expect(schedule.textContent).not.toMatch(/declared schedule:/);
  });

  it('surfaces a HAND RUN — a card with no ledger row behind it — as such', async () => {
    const hand = run({
      cadence: 'loop-a-hygiene',
      date: '',
      card: 'ffff0006-6666',
      source: 'hand-run',
      outcome: 'done',
      narration: 'hand-ran the hygiene loop; 3 branches swept',
    });
    stubFetch({
      ...DRAFTS,
      loops: DRAFTS.loops.map((l) =>
        l.cadence === 'loop-a-hygiene' ? { ...l, lastRun: hand, runCount: 1 } : l,
      ),
      feed: [hand],
      handRunCount: 1,
      neverRun: false,
    });
    render(unlocked());

    const feed = await screen.findByTestId('ap-loops-feed-0');
    expect(screen.getByTestId('ap-loops-feed-source-0').textContent).toBe('hand run');
    expect(feed.textContent).toContain('undated'); // cards carry no date; nothing is invented
    expect(feed.textContent).toContain('hand-ran the hygiene loop; 3 branches swept');
    // The strip carries it too, so the panel is not dark during the arming ceremony.
    expect(screen.getByTestId('ap-loops-lastrun-loop-a-hygiene').textContent).toContain('hand run');
    expect(screen.queryByTestId('ap-loops-empty')).toBeNull();
  });

  it('counts its headings, so the size of each list is readable at a glance', async () => {
    stubFetch();
    render(unlocked());
    expect((await screen.findByText('Loops (3)')).tagName).toBe('H4');
    expect(screen.getByText('Recent runs (2)').tagName).toBe('H4');
  });

  /** Chips are asserted by CLASS NAME, never by colour — the shared vocabulary is the contract. */
  it('gives every state a distinct SHARED chip, and calls approvals "needs you"', async () => {
    stubFetch();
    render(unlocked());

    const done = await screen.findByTestId('ap-loops-state-loop-a-hygiene');
    expect(done.getAttribute('data-state')).toBe('done');
    expect(done.innerHTML).toContain('mc-status-dot--done');
    expect(within(done).getByText('done').className).toContain('mc-badge--done');

    const approvals = screen.getByTestId('ap-loops-state-loop-b-lesson-mining');
    expect(approvals.getAttribute('data-state')).toBe('approvals');
    expect(within(approvals).getByText('needs you').className).toContain('mc-badge--blocked');
    expect(approvals.innerHTML).toContain('mc-status-dot--blocked');
    // The queue-directory slug never reaches the reader as prose.
    expect(approvals.textContent).not.toMatch(/approvals/i);

    const paused = screen.getByTestId('ap-loops-state-loop-c-agent-upgrade');
    expect(paused.getAttribute('data-state')).toBe('paused');
    expect(paused.innerHTML).toContain('mc-status-dot--idle');
    expect(paused.textContent).toBe('paused');
    // A paused loop still shows its track record — only the STATE is forced.
    expect(screen.getByTestId('ap-loops-lastrun-loop-c-agent-upgrade').textContent).toContain(
      'drafting an upgrade for codex-a',
    );

    // No panel-local state colouring shadowing the shared chips.
    expect(done.innerHTML).not.toContain('ap-loops__state--');
  });

  it('renders a reverse-chronological narration feed across loops', async () => {
    stubFetch();
    render(unlocked());

    const first = await screen.findByTestId('ap-loops-feed-0');
    expect(first.textContent).toContain('2026-08-18');
    expect(first.textContent).toContain('Hygiene loop');
    expect(first.textContent).toContain('swept 3 branches');

    const second = screen.getByTestId('ap-loops-feed-1');
    expect(second.textContent).toContain('2026-08-17');
    expect(second.textContent).toContain('two proposed lessons need your ruling');
    expect(within(second).getByText('needs you').className).toContain('mc-badge--blocked');
    expect(screen.queryByTestId('ap-loops-feed-2')).toBeNull();
  });

  it('renders the honest empty state for DECLARED loops — never called a draft awaiting arming', async () => {
    // EMPTY is the armed world: three declared loops, none has run yet. Calling that "cadence drafts
    // await arming" would be false — the fleet CAN beat these; it just has not yet.
    stubFetch(EMPTY);
    render(unlocked());

    expect((await screen.findByTestId('ap-loops-empty')).textContent).toBe('Declared — no runs yet.');
    expect(screen.getByTestId('ap-loops-never-loop-a-hygiene').textContent).toBe('never run');
    expect(screen.getByTestId('ap-loops-state-loop-b-lesson-mining').getAttribute('data-state')).toBe('never-run');
    // Empty is NOT unavailable.
    expect(screen.queryByTestId('ap-loops-unavailable')).toBeNull();
  });

  it('renders the drafts empty state — "cadence drafts await arming" only while nothing is declared', async () => {
    stubFetch(DRAFTS);
    render(unlocked());

    expect((await screen.findByTestId('ap-loops-empty')).textContent).toBe(
      'No loop has ever run — cadence drafts await arming.',
    );
  });

  it('tells an empty ledger apart from rows whose cards could not be read', async () => {
    stubFetch({ ...EMPTY, ledgerRowCount: 2, rejectedRuns: 2, neverRun: true });
    render(unlocked());
    const empty = await screen.findByTestId('ap-loops-empty');
    expect(empty.textContent).toMatch(/2 dispatch rows name a loop/i);
    expect(empty.textContent).not.toMatch(/never run — cadence drafts/i);
    expect(screen.getByTestId('ap-loops-rejected').textContent).toMatch(/could not be parsed/i);
  });

  it('reads NOTHING while locked, and blames the lock rather than the daemon', async () => {
    stubFetch();
    render(locked());

    expect(screen.getByTestId('ap-loops-locked').textContent).toMatch(/unlock the dashboard/i);
    expect(screen.getByTestId('ap-loops-locked').textContent).not.toMatch(/daemon/i);
    expect(screen.queryByTestId('ap-loops-unavailable')).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('names the failure instead of blanking when the daemon does not answer', async () => {
    stubFetch('fail');
    render(unlocked());
    const note = await screen.findByTestId('ap-loops-unavailable');
    expect(note.textContent).toMatch(/unavailable/i);
    // …and it must not be mistaken for the fleet's own empty state.
    expect(screen.queryByTestId('ap-loops-empty')).toBeNull();
  });

  it('is READ-ONLY on the wire: exactly one call, a GET of the panel endpoint', async () => {
    stubFetch();
    render(unlocked());
    await screen.findByTestId('ap-loops-row-loop-a-hygiene');

    expect(calls.map((call) => call.url)).toEqual(['/api/auth/context', '/api/panels/loop-status']);
    for (const call of calls) {
      const method = call.init?.method ?? 'GET';
      expect(method.toUpperCase()).toBe('GET');
      expect(call.init?.body).toBeUndefined();
    }
  });
});
