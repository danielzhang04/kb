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
import { useEffect, useState } from 'react';
import type { AgentPlatformPanel } from '../types';
import type { AutonomyLadderPanel, LadderKeyRow, LadderWorkerRow } from '../../../../server/panels/autonomyLadder';
import '../../../styles/views/agentPlatformAutonomyLadder.css';

type LoadState = 'loading' | 'ready' | 'unavailable';

/** Percent with no false precision: the ledger deals in whole graded runs. */
function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function EarnedRow({ row }: { row: LadderKeyRow }): React.JSX.Element {
  return (
    <tr data-testid={`ap-ladder-earned-${row.worker}-${row.taskType}-${row.tier}`}>
      <td className="ap-ladder__task">{row.taskType || '—'}</td>
      <td className={`ap-ladder__tier--${row.tier}`}>{row.tier || '—'}</td>
      <td>
        <span
          className={`ap-ladder__verdict ap-ladder__verdict--${row.verdict}`}
          data-testid={`ap-ladder-verdict-${row.worker}-${row.taskType}-${row.tier}`}
        >
          {row.verdict}
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
  const [panelData, setPanelData] = useState<AutonomyLadderPanel | null>(null);
  const [state, setState] = useState<LoadState>('loading');

  useEffect(() => {
    let cancelled = false;
    // GET only. This is the panel's ONLY network call.
    void fetch('/api/panels/autonomy-ladder')
      .then((r) => {
        if (!r.ok) throw new Error(`autonomy-ladder request failed (${r.status})`);
        return r.json() as Promise<AutonomyLadderPanel>;
      })
      .then((data) => {
        if (cancelled) return;
        setPanelData(data);
        setState('ready');
      })
      .catch(() => {
        if (!cancelled) setState('unavailable');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === 'loading') return <p className="ap-ladder__note">Reading the grade ledger…</p>;
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
          <strong>queues-for-me</strong> regardless of track record.
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
  title: 'Autonomy Ladder',
  description: 'Earned autonomy per worker, recomputed from trusted grades — beside the declared ceiling.',
  render: () => <AutonomyLadderBody />,
};
