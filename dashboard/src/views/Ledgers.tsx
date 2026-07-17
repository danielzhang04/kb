/**
 * Ledgers view (U3) — per-usage rollup. The aggregate comes from the Plane-A rollup (`/api/index` →
 * `.ledgers`, built by `server/planeA/ledgers.ts`); the per-DAY and per-WRITER slices come from
 * `/api/ledgers/slices` (`sliceLedgers`, keyed off the ledger filename `<writer>-<YYYY-MM-DD>.tsv`).
 * It surfaces USAGE only: per-model step counts, model mix, and dispatch/card counts.
 *
 * SPEND IS SUPPRESSED. The `usd` column exists in the cost ledger (`usdPresent`) and is deliberately
 * never rendered here — matching the Control board's suppression. We do not surface a dollar figure,
 * and we do not claim the data is non-monetary; the rollup simply isn't shown as money.
 *
 * The period selector is now real: "All recorded" shows the aggregate, and one tab per recorded day
 * scopes the tables to that day's slice. A per-writer section breaks usage down by the agent that
 * wrote each ledger. When the slice endpoint has not loaded (tests pass a `rollup`/`slices` prop, or a
 * fetch fails) the view degrades to the aggregate-only "All recorded" period — never an error.
 *
 * Read-only, empty-safe. Accepts `rollup` and/or `slices` props directly (tests / an already-loaded
 * parent) or self-fetches `/api/index` + `/api/ledgers/slices`.
 */
import { useEffect, useMemo, useState } from 'react';
import type { PlaneAIndex } from '../../server/planeA/indexer';
import type { LedgerRollup, LedgerSlice, LedgerSlices } from '../../server/planeA/ledgers';
import '../styles/views/ledgers.css';

const EMPTY_ROLLUP: LedgerRollup = {
  dispatch: { count: 0, cards: 0, byProject: {} },
  cost: { stepCount: 0, perModelSteps: {}, modelMix: {}, usdPresent: false },
  grades: { count: 0, rows: [] },
  activity: { count: 0, rows: [] },
};

/** A usage period tab. `all` is the aggregate; other keys are `YYYY-MM-DD` day slices. */
interface Period {
  key: string;
  label: string;
}

/** The usage shown for the active period — either the aggregate or a single day's slice. */
interface ShownUsage {
  steps: number;
  perModelSteps: Record<string, number>;
  dispatchCount: number;
  cards: number;
  byProject: Record<string, number>;
}

/** Per-model steps + neutral mix meter. Mix is share of steps within the shown scope. */
function ModelStepsTable({ perModelSteps, stepCount }: { perModelSteps: Record<string, number>; stepCount: number }): React.JSX.Element {
  const rows = Object.entries(perModelSteps).sort((a, b) => b[1] - a[1]);
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
          const pct = stepCount > 0 ? Math.round((steps / stepCount) * 100) : 0;
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

/** Dispatch counts grouped by project. */
function DispatchTable({ byProject }: { byProject: Record<string, number> }): React.JSX.Element {
  const rows = Object.entries(byProject).sort((a, b) => b[1] - a[1]);
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

/** Per-writer usage — one row per agent that wrote a ledger, busiest first. USD suppressed. */
function WriterTable({ writers }: { writers: LedgerSlice[] }): React.JSX.Element {
  return (
    <table className="mc-table">
      <thead>
        <tr>
          <th>Writer</th>
          <th className="v-ledgers__num">Steps</th>
          <th className="v-ledgers__num">Dispatches</th>
        </tr>
      </thead>
      <tbody>
        {writers.map((w) => (
          <tr key={w.key}>
            <td className="mc-mono">{w.key}</td>
            <td className="v-ledgers__num mc-mono">{w.steps.toLocaleString()}</td>
            <td className="v-ledgers__num mc-mono">{w.dispatches.toLocaleString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Ledgers view. Accepts a rollup / slices directly (tests) or self-fetches the read API. */
export function Ledgers({ rollup, slices }: { rollup?: LedgerRollup; slices?: LedgerSlices } = {}): React.JSX.Element {
  const [fetched, setFetched] = useState<LedgerRollup | null>(null);
  const [slicesFetched, setSlicesFetched] = useState<LedgerSlices | null>(null);

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

  useEffect(() => {
    // Only self-fetch the slices when neither prop is supplied (tests pass props and don't mock fetch).
    if (rollup || slices) return;
    let cancelled = false;
    fetch('/api/ledgers/slices')
      .then((r) => r.json() as Promise<LedgerSlices>)
      .then((d) => {
        if (!cancelled) setSlicesFetched(d);
      })
      .catch(() => {
        /* read-only view: degrade to the aggregate-only period on failure */
      });
    return () => {
      cancelled = true;
    };
  }, [rollup, slices]);

  const data = rollup ?? fetched ?? EMPTY_ROLLUP;
  const sliceData = slices ?? slicesFetched ?? null;

  const periods = useMemo<Period[]>(() => {
    const base: Period[] = [{ key: 'all', label: 'All recorded' }];
    for (const day of sliceData?.byDay ?? []) base.push({ key: day.key, label: day.key });
    return base;
  }, [sliceData]);
  const [selected, setSelected] = useState('all');

  // Fall back to the aggregate if a previously-selected day disappears (data refresh).
  const activeSlice = selected === 'all' ? null : sliceData?.byDay.find((d) => d.key === selected) ?? null;
  const shown: ShownUsage = activeSlice
    ? {
        steps: activeSlice.steps,
        perModelSteps: activeSlice.perModelSteps,
        dispatchCount: activeSlice.dispatches,
        cards: activeSlice.cards,
        byProject: activeSlice.byProject,
      }
    : {
        steps: data.cost.stepCount,
        perModelSteps: data.cost.perModelSteps,
        dispatchCount: data.dispatch.count,
        cards: data.dispatch.cards,
        byProject: data.dispatch.byProject,
      };

  const hasModels = Object.keys(shown.perModelSteps).length > 0;
  const hasDispatch = Object.keys(shown.byProject).length > 0;
  const writers = sliceData?.byWriter ?? [];
  // Emptiness is judged on the aggregate: an aggregate with no usage is the calm empty state.
  const isEmpty =
    Object.keys(data.cost.perModelSteps).length === 0 &&
    Object.keys(data.dispatch.byProject).length === 0 &&
    data.cost.stepCount === 0 &&
    data.dispatch.count === 0;

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
              <span className="v-ledgers__tile-value">{shown.steps.toLocaleString()}</span>
              <span className="v-ledgers__tile-label">steps</span>
            </div>
            <div className="v-ledgers__tile">
              <span className="v-ledgers__tile-value">{Object.keys(shown.perModelSteps).length}</span>
              <span className="v-ledgers__tile-label">models</span>
            </div>
            <div className="v-ledgers__tile">
              <span className="v-ledgers__tile-value">{shown.dispatchCount.toLocaleString()}</span>
              <span className="v-ledgers__tile-label">dispatches</span>
            </div>
            <div className="v-ledgers__tile">
              <span className="v-ledgers__tile-value">{shown.cards.toLocaleString()}</span>
              <span className="v-ledgers__tile-label">cards</span>
            </div>
          </div>

          {hasModels ? (
            <section className="v-ledgers__section" aria-label="Per-model steps">
              <h2 className="v-ledgers__section-title">Per-model steps</h2>
              <ModelStepsTable perModelSteps={shown.perModelSteps} stepCount={shown.steps} />
            </section>
          ) : null}

          {hasDispatch ? (
            <section className="v-ledgers__section" aria-label="Dispatch by project">
              <h2 className="v-ledgers__section-title">Dispatch by project</h2>
              <DispatchTable byProject={shown.byProject} />
            </section>
          ) : null}

          {selected === 'all' && writers.length > 0 ? (
            <section className="v-ledgers__section" aria-label="Usage by writer">
              <h2 className="v-ledgers__section-title">Usage by writer</h2>
              <WriterTable writers={writers} />
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
