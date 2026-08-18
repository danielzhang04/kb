// @vitest-environment jsdom
/**
 * Autonomy Ladder panel (Wave-1 U5). Five guarantees are pinned here:
 *   1. it registers itself by file drop (the registry finds it by id — no shared-file edit);
 *   2. the DECLARED ceiling and the EARNED verdicts render as structurally distinct elements, so a
 *      declaration can never be read as an earned fact;
 *   3. a worker with no graded runs gets an honest "nothing earned" line, never a fabricated verdict,
 *      and a frozen fleet says so;
 *   4. the panel is READ-ONLY on the wire — every fetch it makes is a GET (and there is exactly one);
 *   5. (U12) a LOCKED dashboard reads nothing and says so, rather than blaming the daemon for a 401.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { AGENT_PLATFORM_PANELS } from '../registry';
import { panel } from './AutonomyLadder.panel';
import { SessionProvider } from '../../../lib/sessionContext';
import { clearStoredSession, persistSession } from '../../../lib/authClient';
import type { AutonomyLadderPanel, LadderKeyRow } from '../../../../server/panels/autonomyLadder';

function key(over: Partial<LadderKeyRow> & { worker: string }): LadderKeyRow {
  return {
    project: 'kb',
    taskType: 'doc-edit',
    tier: 'T1',
    verdict: 'queues-for-me',
    runs: 0,
    passes: 0,
    streak: 0,
    floorStatus: 'ok',
    demote: false,
    passRate: 0,
    ...over,
  };
}

function body(over: Partial<AutonomyLadderPanel> = {}): AutonomyLadderPanel {
  return {
    label: 'autonomy-ladder',
    frozen: false,
    trustedGraderCount: 1,
    gradeRowCount: 10,
    ledgerRowCount: 10,
    keys: [],
    workers: [],
    ...over,
  };
}

const EARNED = key({
  worker: 'codex-a',
  taskType: 'doc-edit',
  tier: 'T1',
  verdict: 'autonomous',
  runs: 10,
  passes: 10,
  streak: 10,
  passRate: 1,
});

const PAYLOAD = body({
  keys: [EARNED],
  workers: [
    { worker: 'codex-a', declaredCeiling: 'T1', earned: [EARNED] },
    // Declares T2, has earned nothing — the case the panel exists to make unmistakable.
    { worker: 'ladder-architect', declaredCeiling: 'T2', earned: [] },
  ],
});

/** Record every fetch call so the GET-only claim is asserted, not assumed. */
const calls: { url: string; init?: RequestInit }[] = [];

function stubFetch(payload: AutonomyLadderPanel | 'fail' = PAYLOAD): void {
  calls.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      if (payload === 'fail') throw new Error('daemon unreachable');
      return { ok: true, status: 200, json: async () => payload };
    }),
  );
}

/** The panel under a FRESH session — the ordinary case every assertion below rides on. */
function unlocked(): React.JSX.Element {
  persistSession({ token: 'tok', expiresAt: Date.now() + 3_600_000 });
  return <SessionProvider>{panel.render()}</SessionProvider>;
}

/** The panel with no session at all. */
function locked(): React.JSX.Element {
  clearStoredSession();
  return <SessionProvider>{panel.render()}</SessionProvider>;
}

afterEach(() => {
  cleanup();
  clearStoredSession();
  vi.unstubAllGlobals();
});

describe('AutonomyLadder panel', () => {
  it('registers itself by file drop', () => {
    expect(panel.id).toBe('autonomy-ladder');
    expect(AGENT_PLATFORM_PANELS.some((p) => p.id === 'autonomy-ladder')).toBe(true);
  });

  it('renders the declared ceiling and the earned verdicts as DISTINCT elements', async () => {
    stubFetch();
    render(unlocked());

    const declared = await screen.findByTestId('ap-ladder-declared-codex-a');
    expect(declared.textContent).toMatch(/declared ceiling \(advisory\)/i);
    expect(declared.textContent).toContain('T1');

    const earned = screen.getByTestId('ap-ladder-earned-codex-a-doc-edit-T1');
    expect(within(earned).getByTestId('ap-ladder-verdict-codex-a-doc-edit-T1').textContent).toBe('autonomous');
    expect(earned.textContent).toContain('10'); // streak
    expect(earned.textContent).toContain('100%'); // pass rate

    // Structurally separate: the declared chip is NOT inside the earned row, and vice versa.
    expect(earned.contains(declared)).toBe(false);
    expect(declared.contains(earned)).toBe(false);
  });

  it('shows an honest "nothing earned" line for a worker that declares a ceiling but has no grades', async () => {
    stubFetch();
    render(unlocked());

    expect((await screen.findByTestId('ap-ladder-declared-ladder-architect')).textContent).toContain('T2');
    expect(screen.getByTestId('ap-ladder-noearned-ladder-architect').textContent).toMatch(/no graded runs/i);
    // No verdict of any kind is invented for that worker.
    expect(screen.queryByTestId(/^ap-ladder-verdict-ladder-architect/)).toBeNull();
  });

  it('tells an EMPTY ledger apart from rows no allow-listed grader authored', async () => {
    stubFetch(body({ gradeRowCount: 0, ledgerRowCount: 0, workers: [] }));
    render(unlocked());
    expect((await screen.findByTestId('ap-ladder-no-trusted-rows')).textContent).toMatch(/ledger is empty/i);
    cleanup();

    stubFetch(body({ gradeRowCount: 0, ledgerRowCount: 7, trustedGraderCount: 0, workers: [] }));
    render(unlocked());
    const note = await screen.findByTestId('ap-ladder-no-trusted-rows');
    expect(note.textContent).toMatch(/7 graded rows exist/i);
    expect(note.textContent).toMatch(/allow-listed grader/i);
  });

  it('banners a frozen fleet', async () => {
    stubFetch(body({ frozen: true, workers: [{ worker: 'codex-a', declaredCeiling: null, earned: [] }] }));
    render(unlocked());
    const banner = await screen.findByTestId('ap-ladder-frozen');
    // Plain words on screen (U12) — the wire value `queues-for-me` is a slug, not English.
    expect(banner.textContent).toMatch(/queues for me/i);
    expect(banner.textContent).not.toMatch(/queues-for-me/i);
  });

  /**
   * U12 — one verdict-translation policy. The hyphenated enum member is the WIRE value; it stays on
   * the element (as a class and a `data-verdict`, which is what styling and any machine reader use)
   * and never reaches the reader as prose.
   */
  it('renders verdicts in plain words while keeping the wire value machine-readable', async () => {
    stubFetch(
      body({
        workers: [
          { worker: 'codex-a', declaredCeiling: 'T1', earned: [EARNED] },
          { worker: 'codex-b', declaredCeiling: 'T1', earned: [key({ worker: 'codex-b', taskType: 'review', tier: 'T2' })] },
        ],
      }),
    );
    render(unlocked());

    const queued = await screen.findByTestId('ap-ladder-verdict-codex-b-review-T2');
    expect(queued.textContent).toBe('queues for me');
    expect(queued.getAttribute('data-verdict')).toBe('queues-for-me');
    expect(queued.className).toContain('ap-ladder__verdict--queues-for-me');

    // `autonomous` is already a plain word and is left exactly as it is.
    const autonomous = screen.getByTestId('ap-ladder-verdict-codex-a-doc-edit-T1');
    expect(autonomous.textContent).toBe('autonomous');
    expect(autonomous.getAttribute('data-verdict')).toBe('autonomous');
  });

  /**
   * U12 — the tier cell adopts the app's shared chip (`.mc-badge--t1/t2/t3` in `styles/app.css`)
   * instead of a panel-local `.ap-ladder__tier--T2` colour rule. Same pill everywhere a tier appears.
   */
  it('renders the earned tier as the SHARED mc-badge chip, not a panel-local tier colour', async () => {
    stubFetch(
      body({
        workers: [
          { worker: 'codex-b', declaredCeiling: 'T1', earned: [key({ worker: 'codex-b', taskType: 'review', tier: 'T2' })] },
        ],
      }),
    );
    render(unlocked());

    const row = await screen.findByTestId('ap-ladder-earned-codex-b-review-T2');
    const chip = within(row).getByText('T2');
    expect(chip.className).toContain('mc-badge');
    expect(chip.className).toContain('mc-badge--t2');
    expect(row.innerHTML).not.toContain('ap-ladder__tier--');
  });

  /**
   * U12 — the honesty fix. `/api/panels/autonomy-ladder` is behind the session pre-handler, so a
   * locked dashboard 401s; the panel used to report that as "the daemon did not answer", which sends
   * an operator to check a service that is answering fine.
   */
  it('reads NOTHING while locked, and blames the lock rather than the daemon', async () => {
    stubFetch();
    render(locked());

    expect(screen.getByTestId('ap-ladder-locked').textContent).toMatch(/unlock the dashboard/i);
    expect(screen.getByTestId('ap-ladder-locked').textContent).not.toMatch(/daemon/i);
    expect(screen.queryByTestId('ap-ladder-unavailable')).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('names the failure instead of blanking when the daemon does not answer', async () => {
    stubFetch('fail');
    render(unlocked());
    expect((await screen.findByTestId('ap-ladder-unavailable')).textContent).toMatch(/unavailable/i);
  });

  it('is READ-ONLY on the wire: exactly one call, a GET of the panel endpoint', async () => {
    stubFetch();
    render(unlocked());
    await screen.findByTestId('ap-ladder-declared-codex-a');

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/api/panels/autonomy-ladder');
    // No init at all (⇒ GET), or an explicitly GET init — never a mutating method or a body.
    const method = calls[0].init?.method ?? 'GET';
    expect(method.toUpperCase()).toBe('GET');
    expect(calls[0].init?.body).toBeUndefined();
  });
});
