// @vitest-environment jsdom
/**
 * Watch-agents-run panel body (Wave-1 U15) — the BEHAVIOUR half.
 *
 * What this panel exists to guarantee, pinned against the real control-client surface (mocked at the
 * module boundary, never edited):
 *
 *   - a locked dashboard issues ZERO requests, and an empty run list gets a stated empty answer;
 *   - a live agent renders model, working time, the live pulse modifier, and a mini-tail wired to the
 *     RIGHT run/attempt pair;
 *   - the tool tally PAGES the event cursor to exhaustion (a single head page under-counts every long
 *     run), reports a bounded-out walk as "≥N", and OMITS a count it did not actually take — there is
 *     no zero fallback anywhere;
 *   - a failed agent is red, not the green of a succeeded one;
 *   - a waiting-human agent says it is waiting on a person, not that it never started;
 *   - a finished agent inside a live run keeps its model, duration and tail;
 *   - the SSE debounce cannot be starved by a run that keeps emitting;
 *   - `planned` runs are filed under neither heading, and the recent chip says whose model it is.
 *
 * Colour is never asserted: the dots take their hue from the shared `.mc-status-dot--*` rules, and a
 * test that read a computed colour would be pinning app.css from a panel test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type {
  AttemptDto,
  OperationalEventDto,
  RunDetailDto,
  RunMetadataDto,
  RunState,
  StageDto,
} from '../../../../control/controlClient';
import { SessionProvider } from '../../../../lib/sessionContext';
import { clearStoredSession, persistSession } from '../../../../lib/authClient';
import type { UseSseResult } from '../../../../lib/sseClient';

const NOW = Date.parse('2026-08-18T12:00:00.000Z');

/* ── Module seams ────────────────────────────────────────────────────────────────────────────── */

const api = vi.hoisted(() => ({
  listRuns: vi.fn(),
  getRun: vi.fn(),
  listRunEvents: vi.fn(),
}));
vi.mock('../../../../control/controlClient', () => api);

/** A mutable fake SSE result — the panel only ever reads `count`/`last` off it. */
const sseState = vi.hoisted(() => ({ current: { last: null, count: 0 } as UseSseResult }));
vi.mock('../../../../lib/sseClient', () => ({ useSse: () => sseState.current }));

/**
 * The mini-tail is imported VERBATIM by the panel; here it is replaced by a prop recorder so the test
 * can assert the run/attempt pair it is handed. Its own rendering is covered by its own test.
 */
const miniTail = vi.hoisted(() => ({ props: [] as Array<{ runRef: string; attemptRef: string }> }));
vi.mock('../../../../components/AttemptMiniTail', () => ({
  AttemptMiniTail: ({ runRef, attemptRef }: { runRef: string; attemptRef: string }) => {
    miniTail.props.push({ runRef, attemptRef });
    return <div data-testid={`fake-mini-tail-${runRef}-${attemptRef}`} />;
  },
}));

import {
  WatchAgentsRunBody,
  WATCH_EVENT_MAX_PAGES,
  WATCH_EVENT_PAGE,
  WATCH_REFRESH_DEBOUNCE_MS,
  WATCH_REFRESH_MAX_WAIT_MS,
  WATCH_RUN_SCAN_LIMIT,
} from './WatchAgentsRunBody';

/* ── Fixtures ────────────────────────────────────────────────────────────────────────────────── */

function assignment(agentId: string, model: string) {
  return { agentId, declarationPath: '', declarationHash: '', profileId: `worker:${agentId}`, runtime: 'claude', model };
}

function run(over: Partial<RunMetadataDto> & { runRef: string; state: RunState }): RunMetadataDto {
  return {
    predecessorRunRef: null,
    title: over.runRef,
    displayName: over.runRef,
    shortRef: 1,
    workflowRef: 'wf-1',
    proposalRef: 'proposal-1',
    proposalRevision: 1,
    proposalHash: 'a'.repeat(64),
    publicationState: 'published',
    version: 1,
    managerSessionRef: 'session-manager',
    managerGeneration: 1,
    managerAssignment: assignment('manager', 'claude-fable-5'),
    createdAt: '2026-08-18T11:00:00.000Z',
    updatedAt: '2026-08-18T11:59:00.000Z',
    ownerSubject: 'operator',
    stageCount: 1,
    attemptCount: 1,
    sessionCount: 1,
    openHumanRequestCount: 0,
    eventCount: 0,
    ...over,
  };
}

function stage(input: {
  stageRef: string;
  agentId: string;
  attemptRef: string | null;
  state?: StageDto['state'];
}): StageDto {
  return {
    stageRef: input.stageRef,
    runRef: 'run-live',
    stageId: input.stageRef,
    title: input.stageRef,
    dependsOn: [],
    canonicalCardRef: null,
    state: input.state ?? 'running',
    version: 1,
    currentAttemptRef: input.attemptRef,
    assignment: assignment(input.agentId, 'claude-sonnet-5'),
    createdAt: '2026-08-18T11:00:00.000Z',
    updatedAt: '2026-08-18T11:59:00.000Z',
  };
}

function attempt(over: Partial<AttemptDto> & { attemptRef: string; stageRef: string }): AttemptDto {
  return {
    runRef: 'run-live',
    generation: 1,
    predecessorAttemptRef: null,
    runtime: 'claude',
    model: 'claude-sonnet-5',
    state: 'running',
    version: 1,
    managedSessionRef: null,
    createdAt: '2026-08-18T11:59:18.000Z', // 42s before NOW
    updatedAt: '2026-08-18T11:59:18.000Z',
    ...over,
  };
}

function toolEvent(cursor: number, attemptRef: string): OperationalEventDto {
  return {
    cursor,
    runRef: 'run-live',
    kind: 'tool',
    source: 'worker',
    stageRef: null,
    attemptRef,
    sessionRef: null,
    status: 'success',
    summary: null,
    command: null,
    toolName: 'Read',
    path: null,
    diff: null,
    checkpoint: null,
    createdAt: '2026-08-18T11:59:30.000Z',
  };
}

/** A page of tool events whose cursors continue from `after` — the shape the forward pager walks. */
function toolPage(after: number, count: number, attemptRef: string): OperationalEventDto[] {
  return Array.from({ length: count }, (_, index) => toolEvent(after + index + 1, attemptRef));
}

function detailFor(stages: StageDto[], attempts: AttemptDto[]): RunDetailDto {
  return {
    run: run({ runRef: 'run-live', state: 'running' }),
    ownerSubject: 'operator',
    stages,
    attempts,
    sessions: [],
    humanRequests: [],
    reviewLoops: [],
    reviewReceipts: [],
  };
}

/** The common single-agent live run: one stage, one attempt, run state overridable. */
function liveRunWith(stageState: StageDto['state'], attemptOver: Partial<AttemptDto> = {}): void {
  api.listRuns.mockResolvedValue([run({ runRef: 'run-live', state: 'running' })]);
  api.getRun.mockResolvedValue(
    detailFor(
      [stage({ stageRef: 'stage-a', agentId: 'alpha', attemptRef: stageState === 'running' || stageState === 'waiting-human' ? 'attempt-a' : null, state: stageState })],
      [attempt({ attemptRef: 'attempt-a', stageRef: 'stage-a', ...attemptOver })],
    ),
  );
}

/* ── Harness ─────────────────────────────────────────────────────────────────────────────────── */

function unlocked(): React.JSX.Element {
  persistSession({ token: 'tok', expiresAt: NOW + 3_600_000 });
  return (
    <SessionProvider>
      <WatchAgentsRunBody />
    </SessionProvider>
  );
}

function locked(): React.JSX.Element {
  clearStoredSession();
  return (
    <SessionProvider>
      <WatchAgentsRunBody />
    </SessionProvider>
  );
}

/** Flush pending promises (and optionally timers) inside act, so React state lands before asserting. */
async function settle(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function agentText(agentId = 'alpha'): string {
  return screen.getByTestId(`watch-agent-run-live-${agentId}`).textContent ?? '';
}

describe('WatchAgentsRunBody', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    sseState.current = { last: null, count: 0 };
    miniTail.props.length = 0;
    api.listRuns.mockReset();
    api.getRun.mockReset();
    api.listRunEvents.mockReset();
    api.listRuns.mockResolvedValue([]);
    api.getRun.mockResolvedValue(detailFor([], []));
    api.listRunEvents.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    clearStoredSession();
    vi.useRealTimers();
  });

  it('states an honest empty answer when there are no runs at all', async () => {
    render(unlocked());
    await settle();

    expect(screen.getByTestId('watch-agents-run-empty').textContent).toContain('No runs on this daemon yet');
    expect(screen.queryByTestId('watch-agents-run-error')).toBeNull();
  });

  it('reads nothing at all while the dashboard is locked', async () => {
    render(locked());
    await settle(WATCH_REFRESH_MAX_WAIT_MS * 2);

    expect(screen.getByTestId('watch-agents-run-locked')).toBeTruthy();
    expect(api.listRuns).not.toHaveBeenCalled();
    expect(api.getRun).not.toHaveBeenCalled();
    expect(api.listRunEvents).not.toHaveBeenCalled();
  });

  it('shows the failure ALONE when the first load fails — never beside the spinner', async () => {
    api.listRuns.mockRejectedValue(new Error('daemon unreachable'));

    render(unlocked());
    await settle();

    expect(screen.getByTestId('watch-agents-run-error').textContent).toContain('daemon unreachable');
    expect(screen.queryByTestId('watch-agents-run-loading')).toBeNull();
    expect(screen.queryByTestId('watch-agents-run-empty')).toBeNull();
  });

  it('renders a running agent with its model, working time, pulse modifier and a wired mini-tail', async () => {
    liveRunWith('running');
    api.listRunEvents.mockResolvedValue([toolEvent(1, 'attempt-a'), toolEvent(2, 'attempt-a')]);

    render(unlocked());
    await settle();

    expect(agentText()).toContain('alpha');
    expect(agentText()).toContain('running');
    expect(agentText()).toContain('working 42s');
    expect(agentText()).toContain('called 2 tools');
    expect(agentText()).toContain('as of 0s ago');
    expect(screen.getAllByTestId('model-badge').some((chip) => chip.textContent === 'claude-sonnet-5')).toBe(true);

    // Live pulse is carried by the modifier class, never by an asserted colour.
    expect(screen.getByTestId('watch-agent-dot-run-live-alpha').className).toContain('wa-dot--running');

    expect(miniTail.props).toContainEqual({ runRef: 'run-live', attemptRef: 'attempt-a' });
    expect(screen.getByTestId('fake-mini-tail-run-live-attempt-a')).toBeTruthy();
  });

  it('renders a finished run as a done summary row with no pulse modifier and no mini-tail', async () => {
    api.listRuns.mockResolvedValue([run({ runRef: 'run-old', state: 'succeeded' })]);

    render(unlocked());
    await settle();

    const row = screen.getByTestId('watch-recent-run-old');
    expect(row.textContent).toContain('finished');
    expect(row.textContent).toContain('1m ago');
    // The chip is the MANAGER's model, and says so.
    expect(row.textContent).toContain('manager');
    expect(row.textContent).toContain('claude-fable-5');

    const dot = screen.getByTestId('watch-recent-dot-run-old');
    expect(dot.className).toContain('wa-dot--done');
    expect(dot.className).not.toContain('wa-dot--running');

    expect(api.getRun).not.toHaveBeenCalled();
    expect(miniTail.props).toHaveLength(0);
  });

  it('files a planned run under neither heading', async () => {
    api.listRuns.mockResolvedValue([run({ runRef: 'run-planned', state: 'planned' })]);

    render(unlocked());
    await settle();

    expect(screen.queryByTestId('watch-recent-run-planned')).toBeNull();
    expect(screen.queryByTestId('watch-run-run-planned')).toBeNull();
    expect(screen.getByTestId('watch-agents-run-none-live')).toBeTruthy();
  });

  /* ── The tool tally ────────────────────────────────────────────────────────────────────────── */

  it('pages the event cursor to exhaustion instead of counting only the first page', async () => {
    liveRunWith('running');
    api.listRunEvents.mockImplementation(async (_ref: string, after: number) => {
      if (after === 0) return toolPage(0, WATCH_EVENT_PAGE, 'attempt-a');
      if (after === WATCH_EVENT_PAGE) return toolPage(WATCH_EVENT_PAGE, 5, 'attempt-a');
      return [];
    });

    render(unlocked());
    await settle();

    // A single head-page read would have claimed the page size. The walk reached the real end.
    expect(agentText()).toContain(`called ${WATCH_EVENT_PAGE + 5} tools`);
    expect(agentText()).not.toContain('≥');
    expect(api.listRunEvents).toHaveBeenCalledTimes(2);
    expect(api.listRunEvents).toHaveBeenNthCalledWith(1, 'run-live', 0, WATCH_EVENT_PAGE, 'tok');
  });

  it('states a bounded-out walk as a floor, not as a total', async () => {
    liveRunWith('running');
    api.listRunEvents.mockImplementation(async (_ref: string, after: number) =>
      toolPage(after, WATCH_EVENT_PAGE, 'attempt-a'));

    render(unlocked());
    await settle();

    expect(agentText()).toContain(`called ≥${WATCH_EVENT_PAGE * WATCH_EVENT_MAX_PAGES} tools`);
    expect(api.listRunEvents).toHaveBeenCalledTimes(WATCH_EVENT_MAX_PAGES);
  });

  it('omits the count entirely for an attempt the walk never saw — never "0 tools"', async () => {
    liveRunWith('running');
    api.listRunEvents.mockResolvedValue([toolEvent(1, 'attempt-somebody-else')]);

    render(unlocked());
    await settle();

    expect(agentText()).toContain('working 42s');
    expect(agentText()).not.toContain('tools');
    expect(agentText()).not.toContain('0 tools');
  });

  it('scopes the tool tally to the attempt each agent is actually on', async () => {
    api.listRuns.mockResolvedValue([run({ runRef: 'run-live', state: 'running' })]);
    api.getRun.mockResolvedValue(
      detailFor(
        [
          stage({ stageRef: 'stage-a', agentId: 'alpha', attemptRef: 'attempt-a', state: 'running' }),
          stage({ stageRef: 'stage-b', agentId: 'beta', attemptRef: 'attempt-b', state: 'running' }),
        ],
        [
          attempt({ attemptRef: 'attempt-a', stageRef: 'stage-a' }),
          attempt({ attemptRef: 'attempt-b', stageRef: 'stage-b' }),
        ],
      ),
    );
    api.listRunEvents.mockResolvedValue([
      toolEvent(1, 'attempt-a'),
      toolEvent(2, 'attempt-a'),
      toolEvent(3, 'attempt-a'),
      toolEvent(4, 'attempt-b'),
      toolEvent(5, 'attempt-b'),
    ]);

    render(unlocked());
    await settle();

    expect(agentText('alpha')).toContain('called 3 tools');
    expect(agentText('beta')).toContain('called 2 tools');
    // ONE event walk for the whole run, not one per agent.
    expect(api.listRunEvents).toHaveBeenCalledTimes(1);
  });

  /* ── Agent state vocabulary ────────────────────────────────────────────────────────────────── */

  it('renders a failed agent red, not the green of a succeeded one', async () => {
    liveRunWith('failed', { state: 'failed' });

    render(unlocked());
    await settle();

    const dot = screen.getByTestId('watch-agent-dot-run-live-alpha').className;
    expect(dot).toContain('wa-dot--error');
    expect(dot).not.toContain('wa-dot--done');
    expect(dot).not.toContain('wa-dot--running');
    expect(agentText()).toContain('failed');
  });

  it('says a waiting-human agent is waiting on a person, not that it never started', async () => {
    liveRunWith('waiting-human', { state: 'waiting-human' });

    render(unlocked());
    await settle();

    expect(agentText()).toContain('waiting 42s');
    expect(agentText()).toContain('needs you');
    expect(agentText()).not.toContain('not started yet');
    expect(screen.getByTestId('watch-agent-dot-run-live-alpha').className).toContain('wa-dot--blocked');
  });

  it('gives ready and blocked stage states plain words instead of raw tokens', async () => {
    api.listRuns.mockResolvedValue([run({ runRef: 'run-live', state: 'running' })]);
    api.getRun.mockResolvedValue(
      detailFor(
        [
          stage({ stageRef: 'stage-a', agentId: 'alpha', attemptRef: null, state: 'ready' }),
          stage({ stageRef: 'stage-b', agentId: 'beta', attemptRef: null, state: 'blocked' }),
        ],
        [],
      ),
    );

    render(unlocked());
    await settle();

    expect(agentText('alpha')).toContain('ready to start');
    expect(agentText('beta')).toContain('waiting on an earlier step');
    expect(agentText('beta')).toContain('not started yet');
  });

  it('keeps a finished agent inside a live run on its model, duration and tail', async () => {
    api.listRuns.mockResolvedValue([run({ runRef: 'run-live', state: 'waiting-human' })]);
    api.getRun.mockResolvedValue(
      detailFor(
        // A succeeded stage carries no ACTIVE attempt in the overlay — the fallback has to find it.
        [stage({ stageRef: 'stage-a', agentId: 'alpha', attemptRef: null, state: 'succeeded' })],
        [
          attempt({
            attemptRef: 'attempt-a',
            stageRef: 'stage-a',
            state: 'succeeded',
            createdAt: '2026-08-18T11:58:00.000Z',
            updatedAt: '2026-08-18T11:58:30.000Z',
          }),
        ],
      ),
    );

    render(unlocked());
    await settle();

    expect(agentText()).toContain('ran 30s');
    expect(screen.getAllByTestId('model-badge').some((chip) => chip.textContent === 'claude-sonnet-5')).toBe(true);
    expect(miniTail.props).toContainEqual({ runRef: 'run-live', attemptRef: 'attempt-a' });
    expect(screen.getByTestId('watch-agent-dot-run-live-alpha').className).toContain('wa-dot--done');
  });

  /* ── Freshness ─────────────────────────────────────────────────────────────────────────────── */

  it('refetches once per SSE burst, after the debounce', async () => {
    api.listRuns.mockResolvedValue([run({ runRef: 'run-old', state: 'succeeded' })]);

    const { rerender } = render(unlocked());
    await settle();
    expect(api.listRuns).toHaveBeenCalledTimes(1);

    // Three frames inside one quiet period must collapse into a single refresh.
    for (const count of [1, 2, 3]) {
      sseState.current = { last: null, count };
      rerender(unlocked());
      await settle(WATCH_REFRESH_DEBOUNCE_MS / 4);
    }
    expect(api.listRuns).toHaveBeenCalledTimes(1);

    await settle(WATCH_REFRESH_DEBOUNCE_MS);
    expect(api.listRuns).toHaveBeenCalledTimes(2);
  });

  it('cannot be starved by a run that keeps emitting inside the quiet period', async () => {
    api.listRuns.mockResolvedValue([run({ runRef: 'run-old', state: 'succeeded' })]);
    const step = WATCH_REFRESH_DEBOUNCE_MS / 2; // every frame lands before the debounce would fire

    const { rerender } = render(unlocked());
    await settle();
    expect(api.listRuns).toHaveBeenCalledTimes(1);

    let count = 0;
    const emitFor = async (ms: number): Promise<void> => {
      for (let elapsed = 0; elapsed < ms; elapsed += step) {
        count += 1;
        sseState.current = { last: null, count };
        rerender(unlocked());
        await settle(step);
      }
    };

    // Well inside the max wait: the debounce is still doing its job and nothing has refetched.
    await emitFor(WATCH_REFRESH_MAX_WAIT_MS / 2);
    expect(api.listRuns).toHaveBeenCalledTimes(1);

    // Past it: the ceiling forces a refresh even though frames never stopped.
    await emitFor(WATCH_REFRESH_MAX_WAIT_MS);
    expect(api.listRuns.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  /* ── Fan-out ───────────────────────────────────────────────────────────────────────────────── */

  it('caps the per-run detail fan-out and discloses the cap', async () => {
    const many = Array.from({ length: WATCH_RUN_SCAN_LIMIT + 3 }, (_, index) =>
      run({ runRef: `run-${index}`, state: 'running', updatedAt: `2026-08-18T11:${String(30 + index).padStart(2, '0')}:00.000Z` }));
    api.listRuns.mockResolvedValue(many);

    render(unlocked());
    await settle();

    expect(api.getRun).toHaveBeenCalledTimes(WATCH_RUN_SCAN_LIMIT);
    expect(screen.getByTestId('watch-agents-run-scan-cap')).toBeTruthy();
    // Every live run is still LISTED — only the detail read is bounded.
    expect(screen.getAllByTestId(/^watch-run-run-/)).toHaveLength(WATCH_RUN_SCAN_LIMIT + 3);
  });
});
