/**
 * Autonomy Ladder panel (Agent Platform, Wave-1 U5) — what each worker has actually EARNED, beside
 * what its agent file DECLARES.
 *
 * ── Read-only, and visibly so ──
 * One `GET /api/panels/autonomy-ladder`. There is no button, form, or second fetch in this file: the
 * ladder is a recomputed VIEW of `ledgers/grades/**` + `governance/graders.yaml`, and promoting a
 * worker is a dispatch-path decision (`scripts/promotion.py`), never a UI action. The server module
 * it reads (`server/panels/autonomyLadder.ts`) is write-free by test, including an mtime check on the
 * grade shard.
 *
 * ── The one thing this panel must never blur ──
 * `declaredCeiling` is the advisory `autonomy-tier` string a human wrote into `agents/<id>.md`; the
 * earned rows are recomputed fact. They are rendered as two different things — a dashed, faint chip
 * (`data-testid="ap-ladder-declared-*"`) versus the earned table (`ap-ladder-earned-*`) — and are
 * never merged into a single "tier" cell. A worker declaring T3 with nothing earned must read as
 * exactly that.
 *
 * ── Honest emptiness ──
 * `ledgers/grades/` currently holds only `.gitkeep`, and `governance/graders.yaml` trusts exactly one
 * grader, so the live answer today is "no graded runs yet" for every worker. That is rendered as a
 * named empty state, never as a fabricated verdict and never as a blank cell. The two ways of having
 * nothing to show are told apart on the wire (`ledgerRowCount` vs `gradeRowCount`): an EMPTY LEDGER is
 * not the same situation as GRADED ROWS NOBODY IS ALLOWED TO TRUST, and reading the second as the
 * first would hide a broken trust anchor.
 *
 * ── Where the declared ceiling comes from (U5 → U4) ──
 * `declaredCeiling` is the same `autonomy-tier` field the Agent Management panel (U4,
 * `AgentManagement.panel.tsx`) renders among an agent's declaration fields; both read it from
 * `agents/<id>.md` through the server. Open that panel for the full declaration behind a ceiling shown
 * here — this panel deliberately shows only the ceiling, next to what was earned.
 */
import type { AgentPlatformPanel } from '../types';
import type { AutonomyLadderPanel, LadderKeyRow, LadderWorkerRow } from '../../../../server/panels/autonomyLadder';
import { useSession } from '../../../lib/sessionContext';
import { useReadPanel } from '../../../lib/useReadPanel';
import '../../../styles/views/agentPlatformAutonomyLadder.css';

/**
 * The verdict vocabulary, in plain words (U12).
 *
 * `queues-for-me` is a wire value — a hyphenated enum member, readable as a slug rather than as
 * English. On screen it is "queues for me", which is what it actually means. The CLASS keeps the wire
 * spelling (styling is keyed off the enum, not off prose), so this is a translation at the last
 * possible moment and nothing downstream has to parse it back.
 */
const VERDICT_LABEL: Record<string, string> = {
  autonomous: 'autonomous',
  'queues-for-me': 'queues for me',
};

/** Plain words for a verdict, falling back to the raw value rather than blanking an unknown one. */
export function verdictLabel(verdict: string): string {
  return VERDICT_LABEL[verdict] ?? verdict;
}

/** Percent with no false precision: the ledger deals in whole graded runs. */
function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/** The earned TIER, in the app's shared chip vocabulary (`.mc-badge--t1/t2/t3` in `styles/app.css`).
 *  An absent tier is an em-dash, never an empty chip that reads as a tier nobody can name. */
function TierCell({ tier }: { tier: string }): React.JSX.Element {
  if (!tier) return <td>—</td>;
  const modifier = /^T[123]$/.test(tier) ? ` mc-badge--${tier.toLowerCase()}` : '';
  return (
    <td>
      <span className={`mc-badge${modifier}`}>{tier}</span>
    </td>
  );
}

function EarnedRow({ row }: { row: LadderKeyRow }): React.JSX.Element {
  return (
    <tr data-testid={`ap-ladder-earned-${row.worker}-${row.taskType}-${row.tier}`}>
      <td className="ap-ladder__task">{row.taskType || '—'}</td>
      <TierCell tier={row.tier} />
      <td>
        <span
          className={`ap-ladder__verdict ap-ladder__verdict--${row.verdict}`}
          data-testid={`ap-ladder-verdict-${row.worker}-${row.taskType}-${row.tier}`}
          data-verdict={row.verdict}
        >
          {verdictLabel(row.verdict)}
        </span>
      </td>
      <td className={row.demote ? 'ap-ladder__demote' : undefined}>
        {row.streak}
        {row.demote ? ' (below floor)' : ''}
      </td>
      <td>
        {pct(row.passRate)} <span className="ap-ladder__note">({row.passes}/{row.runs})</span>
      </td>
    </tr>
  );
}

function WorkerBlock({ worker }: { worker: LadderWorkerRow }): React.JSX.Element {
  return (
    <section className="ap-ladder__worker" data-testid={`ap-ladder-worker-${worker.worker}`}>
      <header className="ap-ladder__head">
        <span className="ap-ladder__id">{worker.worker}</span>
        {/* ADVISORY — a declaration, styled to look nothing like an earned verdict. */}
        <span className="ap-ladder__declared" data-testid={`ap-ladder-declared-${worker.worker}`}>
          declared ceiling (advisory):{' '}
          <span className="ap-ladder__declared-value">{worker.declaredCeiling ?? 'not declared'}</span>
        </span>
      </header>
      <p className="ap-ladder__earned-label">earned</p>
      {worker.earned.length === 0 ? (
        <p className="ap-ladder__empty" data-testid={`ap-ladder-noearned-${worker.worker}`}>
          no graded runs — nothing earned
        </p>
      ) : (
        <table className="ap-ladder__table">
          <thead>
            <tr>
              <th>task type</th>
              <th>tier</th>
              <th>verdict</th>
              <th>streak</th>
              <th>pass rate</th>
            </tr>
          </thead>
          <tbody>
            {worker.earned.map((row) => (
              <EarnedRow key={`${row.project}/${row.taskType}/${row.tier}`} row={row} />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function AutonomyLadderBody(): React.JSX.Element {
  const { session } = useSession();
  // GET only, and exactly one. A null url while LOCKED means the shared read hook issues no request
  // at all — the gate is here, in front of the read, not in how the failure is worded afterwards.
  const { data: panelData, state } = useReadPanel<AutonomyLadderPanel>(
    session ? '/api/panels/autonomy-ladder' : null,
  );

  // A LOCKED dashboard is not a dead daemon. `/api/panels/autonomy-ladder` sits behind the session
  // pre-handler, so while locked every read would 401 — the check here is defense-in-depth so the
  // panel never mounts locked and never has to render that answer. Same idiom as
  // `WatchAgentsRunBody`: zero fetches, and the notice names the real reason.
  if (!session) {
    return (
      <p className="ap-ladder__note" data-testid="ap-ladder-locked">
        Unlock the dashboard to read the autonomy ladder. Nothing is read while it is locked.
      </p>
    );
  }

  // `idle` cannot occur here (the url is a constant while unlocked), but it is folded into the loading
  // branch so a mounted-panel idle paint can never fall through to the daemon-blame line below.
  if (state === 'loading' || state === 'idle') return <p className="ap-ladder__note">Reading the grade ledger…</p>;
  if (state === 'unavailable' || panelData === null) {
    return (
      <p className="ap-ladder__note" data-testid="ap-ladder-unavailable">
        The ladder is unavailable — the daemon did not answer. Nothing was changed.
      </p>
    );
  }

  return (
    <div className="ap-ladder">
      {panelData.frozen ? (
        <p className="ap-ladder__frozen" data-testid="ap-ladder-frozen">
          Fleet FROZEN (<code>ledgers/grades/FROZEN</code>) — every verdict is forced to{' '}
          <strong>{verdictLabel('queues-for-me')}</strong> regardless of track record.
        </p>
      ) : null}
      <p className="ap-ladder__note">
        Recomputed on every read from {panelData.gradeRowCount} trusted grade row
        {panelData.gradeRowCount === 1 ? '' : 's'} ({panelData.trustedGraderCount} allow-listed grader
        {panelData.trustedGraderCount === 1 ? '' : 's'}). Read-only: this panel never promotes anyone.
      </p>
      {panelData.trustedGraderCount === 0 ? (
        <p className="ap-ladder__note" data-testid="ap-ladder-no-anchor">
          No allow-listed grader in <code>governance/graders.yaml</code> — no grade row can earn autonomy
          (fail closed).
        </p>
      ) : null}
      {/* Two different kinds of "nothing to show", never conflated. */}
      {panelData.gradeRowCount === 0 ? (
        <p className="ap-ladder__note" data-testid="ap-ladder-no-trusted-rows">
          {panelData.ledgerRowCount === 0
            ? 'The grade ledger is empty — no runs have been graded yet.'
            : `${panelData.ledgerRowCount} graded row${panelData.ledgerRowCount === 1 ? '' : 's'} exist in the ledger, but none were authored by an allow-listed grader — nothing counts toward autonomy.`}
        </p>
      ) : null}
      <p className="ap-ladder__note">
        Declared ceilings come from <code>agents/&lt;id&gt;.md</code> — see the Agent Management panel for the
        full declaration behind each one.
      </p>
      {panelData.workers.length === 0 ? (
        <p className="ap-ladder__empty" data-testid="ap-ladder-noworkers">
          No workers on the roster yet.
        </p>
      ) : (
        panelData.workers.map((w) => <WorkerBlock key={w.worker} worker={w} />)
      )}
    </div>
  );
}

export const panel: AgentPlatformPanel = {
  id: 'autonomy-ladder',
  order: 40,
  title: 'Autonomy Ladder',
  description: 'Earned autonomy per worker, recomputed from trusted grades — beside the declared ceiling.',
  render: () => <AutonomyLadderBody />,
};
