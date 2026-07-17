/**
 * Ledgers view (U3) — per-usage rollup, rendered from the Plane-A ledger rollup (`/api/index` →
 * `.ledgers`, built by `server/planeA/ledgers.ts`). It surfaces USAGE only: per-model step counts,
 * model mix, and dispatch/card counts.
 *
 * SPEND IS SUPPRESSED. The `usd` column exists in the cost ledger (`ledgers.cost.usdPresent`) and is
 * deliberately never rendered here — matching the Control board's suppression. We do not surface a
 * dollar figure, and we do not claim the data is non-monetary; the rollup simply isn't shown as money.
 *
 * DATA GAP (reported, degraded gracefully): the rollup endpoint is a FLAT aggregate — it exposes no
 * per-DAY dimension (cost rows carry no date column; the date lives only in the ledger filename) and
 * no per-agent/writer breakdown (dispatch rows are collapsed to `byProject` counts). So the "day
 * selector" the spec calls for has a single honest entry ("All recorded") until a per-day rollup
 * endpoint exists; the component is written to light up more periods the moment the data carries them.
 *
 * Read-only, empty-safe: an empty ledger renders a calm empty state, never an error. Accepts a
 * `rollup` prop directly (tests / an already-loaded parent) or self-fetches `/api/index`.
 */
import { useEffect, useMemo, useState } from 'react';
import type { PlaneAIndex } from '../../server/planeA/indexer';
import type { LedgerRollup } from '../../server/planeA/ledgers';
import '../styles/views/ledgers.css';

const EMPTY_ROLLUP: LedgerRollup = {
  dispatch: { count: 0, cards: 0, byProject: {} },
  cost: { stepCount: 0, perModelSteps: {}, modelMix: {}, usdPresent: false },
  grades: { count: 0, rows: [] },
  activity: { count: 0, rows: [] },
};

/** A usage period. Today the rollup carries only the aggregate; more periods appear when the data does. */
interface Period {
  key: string;
  label: string;
}

function ModelStepsTable({ rollup }: { rollup: LedgerRollup }): React.JSX.Element {
  const rows = Object.entries(rollup.cost.perModelSteps).sort((a, b) => b[1] - a[1]);
  return (
    <table className="mc-table">
      <thead>
        <tr>
          <th>Model</th>
          <th className="v-ledgers__num">Steps</th>
          <th>Mix</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([modelName, steps]) => {
          const share = rollup.cost.modelMix[modelName] ?? 0;
          const pct = Math.round(share * 100);
          return (
            <tr key={modelName}>
              <td className="mc-mono">{modelName}</td>
              <td className="v-ledgers__num mc-mono">{steps.toLocaleString()}</td>
              <td>
                <div className="v-ledgers__mix">
                  <span className="v-ledgers__mix-track">
                    <span className="v-ledgers__mix-fill" style={{ width: `${pct}%` }} />
                  </span>
                  <span className="v-ledgers__mix-pct">{pct}%</span>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function DispatchTable({ rollup }: { rollup: LedgerRollup }): React.JSX.Element {
  const rows = Object.entries(rollup.dispatch.byProject).sort((a, b) => b[1] - a[1]);
  return (
    <table className="mc-table">
      <thead>
        <tr>
          <th>Project</th>
          <th className="v-ledgers__num">Dispatches</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([project, count]) => (
          <tr key={project}>
            <td className="mc-mono">{project}</td>
            <td className="v-ledgers__num mc-mono">{count.toLocaleString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Ledgers view. Accepts a rollup directly (tests) or self-fetches `/api/index` and reads `.ledgers`. */
export function Ledgers({ rollup }: { rollup?: LedgerRollup } = {}): React.JSX.Element {
  const [fetched, setFetched] = useState<LedgerRollup | null>(null);

  useEffect(() => {
    if (rollup) return;
    let cancelled = false;
    fetch('/api/index')
      .then((r) => r.json() as Promise<PlaneAIndex>)
      .then((d) => {
        if (!cancelled) setFetched(d.ledgers ?? EMPTY_ROLLUP);
      })
      .catch(() => {
        /* read-only view: on failure keep the empty-safe scaffold, never crash the shell */
      });
    return () => {
      cancelled = true;
    };
  }, [rollup]);

  const data = rollup ?? fetched ?? EMPTY_ROLLUP;

  // Only the aggregate period exists until a per-day rollup endpoint lands (see DATA GAP above).
  const periods = useMemo<Period[]>(() => [{ key: 'all', label: 'All recorded' }], []);
  const [selected, setSelected] = useState('all');

  const hasModels = Object.keys(data.cost.perModelSteps).length > 0;
  const hasDispatch = Object.keys(data.dispatch.byProject).length > 0;
  const isEmpty = !hasModels && !hasDispatch && data.cost.stepCount === 0 && data.dispatch.count === 0;

  return (
    <div className="v-ledgers" aria-label="Ledgers view">
      <div className="v-ledgers__header">
        <h1 className="v-ledgers__title">Ledgers</h1>
        <span className="v-ledgers__note">
          Usage rollup — per-model steps, model mix, dispatch counts. Spend is recorded in the ledger and
          not shown here.
        </span>
      </div>

      <div className="v-ledgers__periods" role="tablist" aria-label="Usage period">
        {periods.map((p) => (
          <button
            key={p.key}
            type="button"
            role="tab"
            aria-selected={selected === p.key}
            className={`v-ledgers__period${selected === p.key ? ' v-ledgers__period--active' : ''}`}
            onClick={() => setSelected(p.key)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {isEmpty ? (
        <p className="v-ledgers__empty">No ledger activity recorded yet.</p>
      ) : (
        <>
          <div className="v-ledgers__tiles">
            <div className="v-ledgers__tile">
              <span className="v-ledgers__tile-value">{data.cost.stepCount.toLocaleString()}</span>
              <span className="v-ledgers__tile-label">steps</span>
            </div>
            <div className="v-ledgers__tile">
              <span className="v-ledgers__tile-value">{Object.keys(data.cost.perModelSteps).length}</span>
              <span className="v-ledgers__tile-label">models</span>
            </div>
            <div className="v-ledgers__tile">
              <span className="v-ledgers__tile-value">{data.dispatch.count.toLocaleString()}</span>
              <span className="v-ledgers__tile-label">dispatches</span>
            </div>
            <div className="v-ledgers__tile">
              <span className="v-ledgers__tile-value">{data.dispatch.cards.toLocaleString()}</span>
              <span className="v-ledgers__tile-label">cards</span>
            </div>
          </div>

          {hasModels ? (
            <section className="v-ledgers__section" aria-label="Per-model steps">
              <h2 className="v-ledgers__section-title">Per-model steps</h2>
              <ModelStepsTable rollup={data} />
            </section>
          ) : null}

          {hasDispatch ? (
            <section className="v-ledgers__section" aria-label="Dispatch by project">
              <h2 className="v-ledgers__section-title">Dispatch by project</h2>
              <DispatchTable rollup={data} />
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
