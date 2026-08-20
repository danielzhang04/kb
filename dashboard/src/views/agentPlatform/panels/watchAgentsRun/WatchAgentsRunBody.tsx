/**
 * Watch-agents-run panel body (Agent Platform, Wave-1 U15).
 *
 * ── What it answers ──
 * "Is anything running right now, and what is it doing?" — the one question the Agent Platform grid
 * could not answer before. Live runs get one card per assigned agent showing its state in plain
 * words, the model tier it is costing us, how long it has been working, how many tools it has
 * called, and the last few lines of its actual I/O. Finished runs collapse into a short summary list.
 *
 * ── Where the data comes from ──
 * The existing, unedited control client only:
 *   - `listRuns`      → the run list (sorted newest-updated first here, not server-side);
 *   - `getRun`        → per LIVE run, projected through `control/runGraph.overlaysFromRun` — the same
 *                       projection RunDetail's agent graph uses, so this panel and the run detail can
 *                       never disagree about which agent is on which attempt. Where that projection
 *                       has no ACTIVE attempt for an agent (it only tracks running/waiting stages),
 *                       `latestAttemptRefOfAgent` supplies the agent's most recent one — the same
 *                       fallback `AgentWorkPanel` uses, so a finished agent keeps its model, its
 *                       duration and its tail instead of going blank the moment it succeeds;
 *   - `listRunEvents` → per LIVE run, PAGED (see the tool tally below).
 *
 * ── The tool tally, and why it is paged ──
 * `listRunEvents(ref, 0, 500)` does NOT return the most recent 500 events. `after` is the START of the
 * cursor and the server filters `cursor > after` then slices, so a single call returns the OLDEST page
 * — the exact bug `control/runEventWindow.ts` exists to document and fix. A head-page tally would
 * under-count every long run while looking perfectly right on a short one. So the walk pages forward
 * to exhaustion, bounded by {@link WATCH_EVENT_MAX_PAGES}, and carries a `complete` flag:
 *
 *   - complete + attempt seen → "called N tools" (an exact count);
 *   - bounded out + attempt seen → "called ≥N tools" (a stated lower bound);
 *   - attempt not in the window at all → the count is OMITTED.
 *
 * There is deliberately no `?? 0`: "called 0 tools" is a claim about a run we did not finish reading.
 *
 * ── Freshness ──
 * One SSE subscription (`/events`). Its arrival counter is debounced by
 * {@link WATCH_REFRESH_DEBOUNCE_MS} so a burst costs one cycle — but the debounce carries a MAX WAIT
 * ({@link WATCH_REFRESH_MAX_WAIT_MS}): a run emitting faster than the quiet period can never starve
 * the refresh, which is the classic way a "live" panel silently freezes on exactly the busiest run.
 * Between cycles the numbers are stale by construction, so every activity line is stamped with how old
 * it is rather than presenting a frozen duration as current.
 *
 * ── Honesty rules this file keeps ──
 *   - Locked dashboard ⇒ ZERO fetches and a stated locked notice. Not a spinner, not an empty list.
 *   - ONE state at a time: a first-load failure shows the failure, never a failure beside a spinner.
 *   - A per-run detail failure drops that one run's agent cards; the rest of the panel still renders.
 *   - `planned` runs are neither live nor finished, so they are in neither list rather than being
 *     mislabelled "recently finished".
 *
 * Read-only throughout: every governed mutation on a run stays with the Run detail view.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getRun,
  listRunEvents,
  listRuns,
  type AttemptDto,
  type RunMetadataDto,
  type RunState,
} from '../../../../control/controlClient';
import { latestAttemptRefOfAgent, overlaysFromRun, type AgentRunOverlay } from '../../../../control/runGraph';
import { relativeAge, runDot, runStateLabel } from '../../../../control/runEvents';
import { RUN_EVENT_MAX_PAGES, RUN_EVENT_PAGE } from '../../../../control/runEventWindow';
import { AttemptMiniTail } from '../../../../components/AttemptMiniTail';
import { ModelBadge } from '../../../../components/ModelBadge';
import { useSession } from '../../../../lib/sessionContext';
import { useSse } from '../../../../lib/sseClient';

/** SSE frames are collapsed into one refresh after this quiet period. */
export const WATCH_REFRESH_DEBOUNCE_MS = 500;

/**
 * The debounce ceiling. A run emitting faster than the quiet period would otherwise reset the timer
 * forever and freeze the panel on the one run worth watching, so the refresh fires at least this often
 * while frames keep arriving.
 */
export const WATCH_REFRESH_MAX_WAIT_MS = 5_000;

/** How often the "as of" staleness stamp re-renders. Only the stamp — no data is read on this tick. */
export const WATCH_STALENESS_TICK_MS = 5_000;

/** How many finished runs the tail list shows. Beyond this the Runs view is the right surface. */
export const RECENT_RUN_LIMIT = 8;

/**
 * How many LIVE runs get the per-run detail + event fan-out. Each costs a governed detail read plus a
 * paged event walk, so the bound is real and it is disclosed in the UI rather than hidden — same
 * discipline as `Agents.tsx#AGENT_RUN_SCAN_LIMIT`.
 */
export const WATCH_RUN_SCAN_LIMIT = 12;

/** Server-side `MAX_EVENT_PAGE`, and the bound on the forward walk. Single-sourced from the window. */
export const WATCH_EVENT_PAGE = RUN_EVENT_PAGE;
export const WATCH_EVENT_MAX_PAGES = RUN_EVENT_MAX_PAGES;

/** The run states that mean "this run is still going" — the ones that earn a live card. */
const LIVE_RUN_STATES: ReadonlySet<RunState> = new Set<RunState>([
  'running',
  'waiting-human',
  'recovering',
  'stopping',
]);

/* ============================================================================
 * Pure projections — each testable with a literal fixture.
 * ========================================================================= */

/** What an agent is doing, in the four shapes that need different words and different arithmetic. */
export type AgentPhase = 'running' | 'waiting' | 'finished' | 'idle';

/** Collapse a stage-level state word into the phase that drives its verb and its elapsed clock. */
export function agentPhase(state: string): AgentPhase {
  switch (state) {
    case 'running':
      return 'running';
    // It STARTED and is blocked on a person. Folding this into "not started yet" would blame the
    // machine for a wait the operator owns.
    case 'waiting-human':
      return 'waiting';
    case 'succeeded':
    case 'failed':
    case 'stopped':
    case 'interrupted':
      return 'finished';
    default:
      return 'idle';
  }
}

/**
 * The `mc-status-dot--*` modifier for an AGENT's state.
 *
 * Panel-local, and it resolves to the SHARED dot taxonomy in `styles/app.css` — the same vocabulary
 * `runEvents.runDot` produces for runs, so a red agent and a red run mean the same thing. It exists
 * separately only because `runDot` switches over `RunState`, which has no `ready`/`blocked` cases;
 * promoting this into `runEvents.ts` is a U12 decision, not a U15 edit.
 *
 * The distinction that matters: a FAILED agent is not a finished agent. Both are terminal, but only
 * one of them is bad news, and a single green "done" for both is the panel quietly hiding failures.
 */
export function agentDot(state: string): string {
  switch (state) {
    case 'running':
      return 'running';
    case 'succeeded':
      return 'done';
    case 'failed':
    case 'interrupted':
      return 'error';
    case 'stopped':
    case 'waiting-human':
      return 'blocked';
    default:
      return 'idle';
  }
}

/**
 * An agent state in the words an operator reads. `runStateLabel` covers the run vocabulary; the two
 * stage-only states it has no case for (`ready`, `blocked`) fall through it as raw machine tokens, so
 * they get their plain-word answer here and everything else defers to the shared labeller.
 */
export function agentStateLabel(state: string): string {
  switch (state) {
    case 'ready':
      return 'ready to start';
    case 'blocked':
      return 'waiting on an earlier step';
    default:
      return runStateLabel(state);
  }
}

/** Whole seconds an attempt has been (or was) working, or null when its timestamps are unusable. */
export function elapsedSeconds(attempt: AttemptDto, stillOpen: boolean, now: number): number | null {
  const started = Date.parse(attempt.createdAt);
  if (Number.isNaN(started)) return null;
  const ended = stillOpen ? now : Date.parse(attempt.updatedAt);
  if (Number.isNaN(ended)) return null;
  return Math.max(0, Math.round((ended - started) / 1000));
}

/** A tool count we are willing to state, and whether it is exact or a floor. Null means "don't claim". */
export interface ToolCount {
  count: number;
  /** True when the event walk was bounded out, so this is "at least this many", not a total. */
  atLeast: boolean;
}

/** Tool calls per attempt across the whole run, plus whether the walk actually reached the end. */
export interface ToolTally {
  byAttempt: Map<string, number>;
  complete: boolean;
}

/**
 * Page the run's events forward to exhaustion, tallying `kind === 'tool'` per attempt.
 *
 * Bounded by {@link WATCH_EVENT_MAX_PAGES}: an unbounded client loop against a run that is still
 * emitting is a hang. Hitting the bound sets `complete: false`, which the UI reports as a floor.
 */
export async function readToolTally(
  runRef: string,
  token: string,
  fetchPage: typeof listRunEvents = listRunEvents,
): Promise<ToolTally> {
  const byAttempt = new Map<string, number>();
  let after = 0;
  for (let page = 0; page < WATCH_EVENT_MAX_PAGES; page += 1) {
    const batch = await fetchPage(runRef, after, WATCH_EVENT_PAGE, token);
    for (const event of batch) {
      if (event.kind !== 'tool' || event.attemptRef === null) continue;
      byAttempt.set(event.attemptRef, (byAttempt.get(event.attemptRef) ?? 0) + 1);
    }
    if (batch.length > 0) after = batch[batch.length - 1].cursor;
    // A short page means the cursor is exhausted — this is the end of the run's events.
    if (batch.length < WATCH_EVENT_PAGE) return { byAttempt, complete: true };
  }
  return { byAttempt, complete: false };
}

/**
 * What we are willing to say about an attempt's tool use.
 *
 * An attempt absent from the tally is UNKNOWN, never zero — the only reason to render a number here is
 * having counted one. Note there is no `?? 0` anywhere on this path, deliberately.
 */
export function toolCountFor(tally: ToolTally | null, attemptRef: string | null): ToolCount | null {
  if (tally === null || attemptRef === null) return null;
  const count = tally.byAttempt.get(attemptRef);
  if (count === undefined) return null;
  return { count, atLeast: !tally.complete };
}

/** One agent's live position inside a run: its overlay, its attempt, and what it has been doing. */
export interface AgentCard {
  agentId: string;
  overlay: AgentRunOverlay;
  /** The active attempt, or the agent's most recent one when the overlay has no active attempt. */
  attemptRef: string | null;
  attempt: AttemptDto | null;
  toolCount: ToolCount | null;
}

/** The activity line under an agent's name: what it is doing, for how long, over how many tools. */
export function activityLine(card: AgentCard, now: number, refreshedAt: number): string {
  const phase = agentPhase(card.overlay.state);
  const open = phase === 'running' || phase === 'waiting';
  const seconds = card.attempt === null ? null : elapsedSeconds(card.attempt, open, now);
  const clock = seconds === null ? '' : ` ${seconds}s`;
  const verb =
    phase === 'running'
      ? `working${clock}`
      : phase === 'waiting'
        ? `waiting${clock} · needs you`
        : phase === 'finished'
          ? seconds === null ? 'finished' : `ran ${seconds}s`
          : 'not started yet';

  const parts = [verb];
  if (card.toolCount !== null) {
    parts.push(`called ${card.toolCount.atLeast ? '≥' : ''}${card.toolCount.count} tools`);
  }
  // Every number above is frozen until the next refresh cycle. Say how old it is rather than let a
  // stale duration read as a live one.
  parts.push(`as of ${relativeAge(new Date(refreshedAt).toISOString(), now)}`);
  return parts.join(' · ');
}

/* ============================================================================
 * Reads
 * ========================================================================= */

/** Agent cards per live run, keyed by runRef. A run absent from the map failed its detail read. */
type AgentCardsByRun = Record<string, AgentCard[]>;

/** Read one live run's agent cards. Never throws — a dead read returns null and the card list drops. */
async function readAgentCards(runRef: string, token: string): Promise<AgentCard[] | null> {
  let detail;
  try {
    detail = await getRun(runRef, token);
  } catch {
    return null;
  }
  const overlays = overlaysFromRun(detail);
  const attemptsByRef = new Map(detail.attempts.map((attempt) => [attempt.attemptRef, attempt]));

  // The tally is DECORATION: a failed event walk costs the counts, never the cards.
  let tally: ToolTally | null = null;
  try {
    tally = await readToolTally(runRef, token);
  } catch {
    tally = null;
  }

  return Object.entries(overlays)
    .filter(([agentId]) => agentId !== '')
    .map(([agentId, overlay]) => {
      // `overlaysFromRun` only carries an attempt for a running/waiting stage. A succeeded or failed
      // agent has one too — it is just not "active" — and dropping it would blank its model, its
      // duration and its tail the instant it finished.
      const attemptRef = overlay.attemptRef ?? latestAttemptRefOfAgent(detail, agentId);
      return {
        agentId,
        overlay,
        attemptRef,
        attempt: attemptRef === null ? null : attemptsByRef.get(attemptRef) ?? null,
        toolCount: toolCountFor(tally, attemptRef),
      };
    })
    .sort((a, b) => a.agentId.localeCompare(b.agentId));
}

/* ============================================================================
 * Render
 * ========================================================================= */

function AgentRow({
  runRef,
  card,
  now,
  refreshedAt,
  sse,
}: {
  runRef: string;
  card: AgentCard;
  now: number;
  refreshedAt: number;
  sse: ReturnType<typeof useSse>;
}): React.JSX.Element {
  const dot = agentDot(card.overlay.state);
  return (
    <li className="wa-agent" data-testid={`watch-agent-${runRef}-${card.agentId}`}>
      <div className="wa-agent__head">
        <span
          className={`mc-status-dot mc-status-dot--${dot} wa-dot wa-dot--${dot}`}
          data-testid={`watch-agent-dot-${runRef}-${card.agentId}`}
        />
        <span className="wa-agent__id mc-mono">{card.agentId}</span>
        <span className="wa-agent__state">{agentStateLabel(card.overlay.state)}</span>
        {card.attempt === null ? null : <ModelBadge tier={card.attempt.model} />}
        {card.overlay.openGate ? <span className="wa-agent__gate">open gate</span> : null}
      </div>
      <div className="wa-agent__activity">{activityLine(card, now, refreshedAt)}</div>
      {card.attemptRef === null ? null : (
        <AttemptMiniTail runRef={runRef} attemptRef={card.attemptRef} sse={sse} />
      )}
    </li>
  );
}

function LiveRunCard({
  run,
  cards,
  now,
  refreshedAt,
  sse,
}: {
  run: RunMetadataDto;
  cards: AgentCard[] | undefined;
  now: number;
  refreshedAt: number;
  sse: ReturnType<typeof useSse>;
}): React.JSX.Element {
  const dot = runDot(run.state);
  return (
    <li className="wa-run" data-testid={`watch-run-${run.runRef}`}>
      <div className="wa-run__head">
        <span
          className={`mc-status-dot mc-status-dot--${dot} wa-dot wa-dot--${dot}`}
          data-testid={`watch-run-dot-${run.runRef}`}
        />
        <span className="wa-run__title">{run.displayName}</span>
        <span className="wa-run__state">{runStateLabel(run.state)}</span>
        <span className="wa-run__age">{relativeAge(run.updatedAt, now)}</span>
      </div>
      {cards === undefined ? (
        <p className="wa-run__note">Could not read this run's agents just now.</p>
      ) : cards.length === 0 ? (
        <p className="wa-run__note">No agent is assigned to a step of this run.</p>
      ) : (
        <ul className="wa-run__agents">
          {cards.map((card) => (
            <AgentRow
              key={card.agentId}
              runRef={run.runRef}
              card={card}
              now={now}
              refreshedAt={refreshedAt}
              sse={sse}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Finished runs are a summary row by design: no mini-tail, because there is nothing still arriving. */
function RecentRunRow({ run, now }: { run: RunMetadataDto; now: number }): React.JSX.Element {
  const dot = runDot(run.state);
  return (
    <li className="wa-recent" data-testid={`watch-recent-${run.runRef}`}>
      <span
        className={`mc-status-dot mc-status-dot--${dot} wa-dot wa-dot--${dot}`}
        data-testid={`watch-recent-dot-${run.runRef}`}
      />
      <span className="wa-recent__title">{run.displayName}</span>
      <span className="wa-recent__state">{runStateLabel(run.state)}</span>
      <span className="wa-recent__age">{relativeAge(run.updatedAt, now)}</span>
      {/* Qualified on purpose: this is the run's MANAGER model, not "the model this run used" — the
          workers each carry their own, and an unlabelled chip here would read as the run's one tier. */}
      <span className="wa-recent__model-label">manager</span>
      <ModelBadge tier={run.managerAssignment?.model ?? null} />
    </li>
  );
}

export function WatchAgentsRunBody(): React.JSX.Element {
  const { session } = useSession();
  const token = session?.token;
  const sse = useSse('/events');
  const [runs, setRuns] = useState<RunMetadataDto[] | null>(null);
  const [cardsByRun, setCardsByRun] = useState<AgentCardsByRun>({});
  const [error, setError] = useState<string | null>(null);
  /** Wall clock of the last successful cycle. Every rendered duration is relative to this instant. */
  const [refreshedAt, setRefreshedAt] = useState(() => Date.now());
  /** Ticks on its own so the "as of" stamp keeps counting up while the data sits frozen. */
  const [clock, setClock] = useState(() => Date.now());
  /** Monotonic refresh trigger. Bumped by the debounced SSE effect below, never by a render. */
  const [tick, setTick] = useState(0);
  /** When the current un-serviced SSE burst began — the anchor for the debounce's max wait. */
  const pendingSince = useRef<number | null>(null);

  // Collapse an SSE burst into one refresh, but never let a chatty run starve the refresh: once the
  // burst has been pending for WATCH_REFRESH_MAX_WAIT_MS the next frame fires immediately.
  useEffect(() => {
    if (sse.count === 0) return;
    if (pendingSince.current === null) pendingSince.current = Date.now();
    const waited = Date.now() - pendingSince.current;
    const delay = Math.max(0, Math.min(WATCH_REFRESH_DEBOUNCE_MS, WATCH_REFRESH_MAX_WAIT_MS - waited));
    const timer = setTimeout(() => {
      pendingSince.current = null;
      setTick((value) => value + 1);
    }, delay);
    return () => clearTimeout(timer);
  }, [sse.count]);

  // The staleness stamp only. No read happens on this tick.
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), WATCH_STALENESS_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  // The one read path. Locked ⇒ it never runs, so a locked panel issues no request at all.
  useEffect(() => {
    if (!token) {
      setRuns(null);
      setCardsByRun({});
      return;
    }
    let alive = true;
    void (async () => {
      let listed: RunMetadataDto[];
      try {
        listed = await listRuns(token);
      } catch (cause) {
        if (alive) setError(cause instanceof Error ? cause.message : 'Could not load runs.');
        return;
      }
      if (!alive) return;
      const sorted = [...listed].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      setRuns(sorted);
      setError(null);
      const at = Date.now();
      setRefreshedAt(at);
      setClock(at);

      // Bounded, parallel fan-out: one governed detail read + one paged event walk per live run.
      const scanned = sorted.filter((run) => LIVE_RUN_STATES.has(run.state)).slice(0, WATCH_RUN_SCAN_LIMIT);
      const results = await Promise.all(
        scanned.map(async (run) => ({ runRef: run.runRef, cards: await readAgentCards(run.runRef, token) })),
      );
      if (!alive) return;
      const next: AgentCardsByRun = {};
      for (const result of results) if (result.cards !== null) next[result.runRef] = result.cards;
      setCardsByRun(next);
    })();
    return () => {
      alive = false;
    };
  }, [token, tick]);

  const { live, recent } = useMemo(() => {
    const all = runs ?? [];
    return {
      live: all.filter((run) => LIVE_RUN_STATES.has(run.state)),
      // `planned` is neither: it has not started, so it is not live, and it never finished. It belongs
      // in neither list rather than being filed under a heading that would misdescribe it.
      recent: all
        .filter((run) => !LIVE_RUN_STATES.has(run.state) && run.state !== 'planned')
        .slice(0, RECENT_RUN_LIMIT),
    };
  }, [runs]);

  if (!session) {
    return (
      <div className="wa" aria-label="Watch agents run panel">
        <p className="wa__locked" data-testid="watch-agents-run-locked">
          Unlock the dashboard to watch agents run. Nothing is read while it is locked.
        </p>
      </div>
    );
  }

  // ONE state at a time. A failed first load is an answer, not a thing to show beside a spinner.
  if (error !== null && runs === null) {
    return (
      <div className="wa" aria-label="Watch agents run panel">
        <p className="wa__error" data-testid="watch-agents-run-error">
          {error}
        </p>
      </div>
    );
  }

  return (
    <div className="wa" aria-label="Watch agents run panel">
      {error !== null ? (
        <p className="wa__error" data-testid="watch-agents-run-error">
          {error}
        </p>
      ) : null}

      {runs === null ? (
        <p className="wa__note" data-testid="watch-agents-run-loading">
          Reading runs…
        </p>
      ) : runs.length === 0 ? (
        <p className="wa__empty" data-testid="watch-agents-run-empty">
          No runs on this daemon yet. Launch one and it appears here while it works.
        </p>
      ) : (
        <>
          <h4 className="wa__heading">Live now</h4>
          {live.length === 0 ? (
            <p className="wa__note" data-testid="watch-agents-run-none-live">
              Nothing is running right now.
            </p>
          ) : (
            <>
              <ul className="wa__list">
                {live.map((run) => (
                  <LiveRunCard
                    key={run.runRef}
                    run={run}
                    cards={cardsByRun[run.runRef]}
                    now={clock}
                    refreshedAt={refreshedAt}
                    sse={sse}
                  />
                ))}
              </ul>
              {live.length > WATCH_RUN_SCAN_LIMIT ? (
                <p className="wa__note" data-testid="watch-agents-run-scan-cap">
                  Agent detail is read for the {WATCH_RUN_SCAN_LIMIT} most recently updated live runs.
                </p>
              ) : null}
            </>
          )}

          <h4 className="wa__heading">Recently finished</h4>
          {recent.length === 0 ? (
            <p className="wa__note">No finished runs yet.</p>
          ) : (
            <ul className="wa__list wa__list--recent">
              {recent.map((run) => (
                <RecentRunRow key={run.runRef} run={run} now={clock} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
