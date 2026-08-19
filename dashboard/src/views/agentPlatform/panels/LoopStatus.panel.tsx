/**
 * Loop Status panel (Agent Platform, Wave-1 U-L2) — the three self-improving loops: what state each is
 * in, when it last ran, what came out, and what schedule it DECLARES.
 *
 * ── Why it opens the section ──
 * `order: 5` puts this first, ahead of Agent Management (10). The loops are the thing that runs on its
 * own overnight; everything else on this section explains the fleet the loops act on. The first
 * question an operator has in the morning is "did the loops run, and does any of them need me?".
 *
 * ── Read-only, and visibly so ──
 * One `GET /api/panels/loop-status`. No button, no form, no second fetch. Arming, pausing and running a
 * loop are dispatcher-side actions (`scripts/dispatch.py` + a `queue/paused/<name>` sentinel a human
 * places); this panel only reports them. The server module it reads is write-free by test, including an
 * mtime check on the dispatch shard.
 *
 * ── Declared vs proposed, never a computed schedule ──
 * The schedule shown is the literal `schedule:` string. It is only labelled DECLARED when a cadence
 * block in a `HEARTBEAT.md` actually names the loop; until then the loop is a draft and the string is
 * labelled a proposal, because telling an operator a schedule is declared is telling them the fleet
 * will beat it. Either way this panel computes no "due today", "next run" or "overdue" —
 * `dispatch.py::due()` is the one scheduler, and a second opinion rendered next to it would drift.
 *
 * ── The arming ceremony is the panel's first audience ──
 * Stage ① of arming a loop is a HAND RUN: a human runs it once to prove it works, before the cadence
 * exists. That produces a queue card and NO dispatch-ledger row, so the server matches such cards by
 * their `action` and marks them `hand run`. Without it this panel would be blank through exactly the
 * stretch someone is watching it to decide whether to arm.
 *
 * ── Honest emptiness ──
 * The three loops' HEARTBEAT cadences are still DRAFTS awaiting Daniel, and the live ledger/queue
 * truth lives on the `ops` branch. So today's honest answer is "no loop has ever run — cadence drafts
 * await arming", with each loop row still appearing by name, as a draft, with its proposed schedule.
 * That sentence is gated on `panelData.anyDeclared` (see `server/panels/loopStatus.ts`): once a loop is
 * actually declared and simply has not run yet, calling it a "draft awaiting arming" is false, so the
 * empty-feed line reads "Declared — no runs yet." instead. Empty is told apart from unavailable: an
 * empty ledger is a fact about the fleet, a dead daemon is a fact about the dashboard, and they are
 * never rendered as the same sentence.
 */
import type { AgentPlatformPanel } from '../types';
import type { LoopRow, LoopRun, LoopState, LoopStatusPanel } from '../../../../server/panels/loopStatus';
import { useSession } from '../../../lib/sessionContext';
import { useReadPanel } from '../../../lib/useReadPanel';
import '../../../styles/views/agentPlatformLoopStatus.css';

/**
 * The state vocabulary, mapped onto the app's SHARED chips (`.mc-status-dot*` / `.mc-badge*` in
 * `styles/app.css`) rather than a panel-local re-colouring: a green dot must mean the same thing here
 * as it does on an agent row.
 *
 * `label` is what a person reads. `approvals` becomes "needs you" — the wire value is a queue
 * directory name, and the only thing an operator actually needs to know about it is that it is waiting
 * on a human. The wire value stays on the element as `data-state` for machine readers and styling.
 */
const STATE_CHIP: Record<LoopState, { label: string; dot: string; badge: string }> = {
  // A loop nobody has declared yet cannot be beaten by the dispatcher. Idle dot, no status badge:
  // this is the absence of a cadence, not a run outcome, and it must not borrow a run's colour.
  'not-declared': { label: 'draft — not declared yet', dot: 'idle', badge: '' },
  paused: { label: 'paused', dot: 'idle', badge: '' },
  'never-run': { label: 'never run', dot: 'idle', badge: '' },
  unknown: { label: 'outcome unknown', dot: 'waiting', badge: '' },
  inbox: { label: 'queued', dot: 'waiting', badge: '' },
  blocked: { label: 'blocked', dot: 'blocked', badge: 'blocked' },
  working: { label: 'running', dot: 'running', badge: 'running' },
  done: { label: 'done', dot: 'done', badge: 'done' },
  approvals: { label: 'needs you', dot: 'blocked', badge: 'blocked mc-badge--attention' },
  approved: { label: 'approved', dot: 'done', badge: 'done' },
  rejected: { label: 'rejected', dot: 'error', badge: 'error' },
};

/** An unknown state never blanks a row: it degrades to the neutral waiting chip with the raw value. */
function chipFor(state: string): { label: string; dot: string; badge: string } {
  return STATE_CHIP[state as LoopState] ?? { label: state, dot: 'waiting', badge: '' };
}

function StateChip({ state, testId }: { state: string; testId: string }): React.JSX.Element {
  const chip = chipFor(state);
  return (
    <span className="ap-loops__state" data-testid={testId} data-state={state}>
      <span className={`mc-status-dot mc-status-dot--${chip.dot}`} aria-hidden="true" />
      <span className={chip.badge ? `mc-badge mc-badge--${chip.badge}` : 'mc-badge'}>{chip.label}</span>
    </span>
  );
}

/** The last-run half of a status strip: when, and what came out. Never a blank cell. */
function LastRun({ row }: { row: LoopRow }): React.JSX.Element {
  if (row.lastRun === null) {
    return (
      <span className="ap-loops__lastrun" data-testid={`ap-loops-never-${row.cadence}`}>
        never run
      </span>
    );
  }
  const run = row.lastRun;
  return (
    <span className="ap-loops__lastrun" data-testid={`ap-loops-lastrun-${row.cadence}`}>
      <span className="ap-loops__date">{run.date || 'undated'}</span>{' '}
      {run.source === 'hand-run' ? <span className="ap-loops__source">hand run</span> : null}{' '}
      <span className="ap-loops__narration">
        {run.narration ??
          (run.cardFound ? 'the run card records no result yet' : 'its card is not in this checkout')}
      </span>
    </span>
  );
}

function LoopStrip({ row }: { row: LoopRow }): React.JSX.Element {
  return (
    <li className="ap-loops__row" data-testid={`ap-loops-row-${row.cadence}`}>
      <span className="ap-loops__name">{row.label}</span>
      <StateChip state={row.state} testId={`ap-loops-state-${row.cadence}`} />
      <LastRun row={row} />
      {/* Verbatim, and only called DECLARED when a cadence block actually declares it. An undeclared
          loop's string is a draft's PROPOSAL — saying otherwise would tell an operator the fleet is
          about to run something it cannot run. Neither form is a computed next-run time. */}
      <span className="ap-loops__schedule" data-testid={`ap-loops-schedule-${row.cadence}`}>
        {row.declared ? 'declared schedule: ' : 'proposed schedule (not declared): '}
        <code>{row.schedule}</code>
      </span>
    </li>
  );
}

function FeedEntry({ run, index }: { run: LoopRun; index: number }): React.JSX.Element {
  return (
    <li className="ap-loops__feed-item" data-testid={`ap-loops-feed-${index}`}>
      <span className="ap-loops__date">{run.date || 'undated'}</span>
      <span className="ap-loops__feed-loop">{run.label}</span>
      <StateChip state={run.outcome ?? 'unknown'} testId={`ap-loops-feed-state-${index}`} />
      {run.source === 'hand-run' ? (
        <span className="ap-loops__source" data-testid={`ap-loops-feed-source-${index}`}>
          hand run
        </span>
      ) : null}
      {/* Worker-authored prose, rendered as INERT TEXT — never interpreted as an instruction. */}
      <span className="ap-loops__narration">
        {run.narration ?? (run.cardFound ? 'no result recorded' : 'card not in this checkout')}
      </span>
    </li>
  );
}

function LoopStatusBody(): React.JSX.Element {
  const { session } = useSession();
  // GET only, and exactly one. A null url while LOCKED means the shared read hook issues no request at
  // all — the gate sits in front of the read, not in how the failure is worded afterwards.
  const { data: panelData, state } = useReadPanel<LoopStatusPanel>(session ? '/api/panels/loop-status' : null);

  if (!session) {
    return (
      <p className="ap-loops__note" data-testid="ap-loops-locked">
        Unlock the dashboard to read loop status. Nothing is read while it is locked.
      </p>
    );
  }

  if (state === 'loading' || state === 'idle') return <p className="ap-loops__note">Reading the dispatch ledger…</p>;
  if (state === 'unavailable' || panelData === null) {
    return (
      <p className="ap-loops__note" data-testid="ap-loops-unavailable">
        Loop status is unavailable — the daemon did not answer. Nothing was changed.
      </p>
    );
  }

  return (
    <div className="ap-loops">
      {/* Counted headings, the HygieneReport pattern — the number is the first thing worth knowing. */}
      <h4 className="ap-loops__heading">Loops ({panelData.loops.length})</h4>
      <ul className="ap-loops__list">
        {panelData.loops.map((row) => (
          <LoopStrip key={row.cadence} row={row} />
        ))}
      </ul>

      <h4 className="ap-loops__heading">Recent runs ({panelData.feed.length})</h4>
      {panelData.feed.length === 0 ? (
        // EMPTY — a fact about the fleet, worded as one. Distinct from the `unavailable` line above,
        // which is a fact about the dashboard.
        <p className="ap-loops__empty" data-testid="ap-loops-empty">
          {panelData.ledgerRowCount === 0
            ? // Gated on `anyDeclared`: an armed loop that simply has not run yet is not a "draft"
              // — that sentence is only honest while every loop is still undeclared.
              panelData.anyDeclared
              ? 'Declared — no runs yet.'
              : 'No loop has ever run — cadence drafts await arming.'
            : `${panelData.ledgerRowCount} dispatch row${panelData.ledgerRowCount === 1 ? '' : 's'} name a loop, but none could be read back to a card — nothing is shown rather than a guessed outcome.`}
        </p>
      ) : (
        <ul className="ap-loops__feed">
          {panelData.feed.map((run, i) => (
            <FeedEntry key={`${run.cadence}/${run.card}/${run.date}`} run={run} index={i} />
          ))}
        </ul>
      )}

      {panelData.rejectedRuns > 0 ? (
        <p className="ap-loops__note" data-testid="ap-loops-rejected">
          {panelData.rejectedRuns} run{panelData.rejectedRuns === 1 ? '' : 's'} omitted: the run card
          could not be parsed, so no outcome is claimed for it.
        </p>
      ) : null}
      <p className="ap-loops__note">
        Recomputed on every read from <code>ledgers/dispatch/**</code> joined to <code>queue/**</code>,
        plus hand-run cards matched by their <code>action</code> (a hand run leaves no ledger row). A
        loop is called declared only when a cadence block in <code>HEARTBEAT.md</code> names it — this
        panel never computes when one is next due. Read-only: it never arms, pauses, or runs a loop.
      </p>
    </div>
  );
}

export const panel: AgentPlatformPanel = {
  id: 'loop-status',
  // Lower than every other panel, so the section opens here. The pending section reframe may re-home
  // this panel into a "Now" band; there is no `group` field on the panel contract yet, so this stays
  // an ordering fact and a note — nothing to migrate when that field arrives.
  order: 5,
  title: 'Loop Status',
  description: 'The self-improving loops: state, last run and what came out, beside its proposed or declared schedule.',
  render: () => <LoopStatusBody />,
};
