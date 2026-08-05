/**
 * Quartermaster panel (D3.5) — read-only usage rollup. Projects the server usage panel
 * (`GET /api/panels/usage`, built by `server/panels/usage.ts`): per-model `step` counts, model mix, and
 * card/dispatch counts.
 *
 * SPEND IS SUPPRESSED. The cost ledger carries a `usd` column (`usdPresent`) but this panel never renders
 * a dollar figure — matching the Ledgers / Control suppression. It also surfaces no token or wall-clock
 * dimension, because the ledger has none. Model identifiers render mono.
 *
 * Accepts a `panel` prop directly (tests) or self-fetches. Read-only, empty-safe.
 */
import { useEffect, useState } from 'react';
import type { UsagePanel } from '../../../server/panels/usage';
import '../../styles/views/panels.css';

const EMPTY: UsagePanel = {
  label: 'usage',
  stepCount: 0,
  perModelSteps: {},
  modelMix: {},
  models: [],
  dispatchCount: 0,
  cards: 0,
  byProject: {},
  byWriter: [],
  byDay: [],
  usdPresent: false,
};

export function Quartermaster({ panel }: { panel?: UsagePanel } = {}): React.JSX.Element {
  const [fetched, setFetched] = useState<UsagePanel | null>(null);

  useEffect(() => {
    if (panel) return;
    let cancelled = false;
    fetch('/api/panels/usage')
      .then((r) => r.json() as Promise<UsagePanel>)
      .then((d) => {
        if (!cancelled) setFetched(d);
      })
      .catch(() => {
        /* read-only view: keep the empty-safe scaffold on failure */
      });
    return () => {
      cancelled = true;
    };
  }, [panel]);

  const data = panel ?? fetched ?? EMPTY;
  const isEmpty = data.stepCount === 0 && data.dispatchCount === 0 && data.models.length === 0;

  return (
    <div className="v-panel v-panel--quartermaster" aria-label="Quartermaster panel">
      <div className="v-panel__header">
        <h2 className="v-panel__title">Quartermaster</h2>
        <span className="v-panel__note">
          Usage rollup — per-model steps, model mix, dispatch counts. Spend is recorded in the ledger and
          not shown here.
        </span>
      </div>

      {isEmpty ? (
        <p className="mc-empty">No usage recorded yet.</p>
      ) : (
        <>
          <div className="v-panel__tiles">
            <div className="v-panel__tile">
              <span className="v-panel__tile-value">{data.stepCount.toLocaleString()}</span>
              <span className="v-panel__tile-label">steps</span>
            </div>
            <div className="v-panel__tile">
              <span className="v-panel__tile-value">{data.models.length}</span>
              <span className="v-panel__tile-label">models</span>
            </div>
            <div className="v-panel__tile">
              <span className="v-panel__tile-value">{data.dispatchCount.toLocaleString()}</span>
              <span className="v-panel__tile-label">dispatches</span>
            </div>
            <div className="v-panel__tile">
              <span className="v-panel__tile-value">{data.cards.toLocaleString()}</span>
              <span className="v-panel__tile-label">cards</span>
            </div>
          </div>

          {data.models.length > 0 ? (
            <section className="v-panel__section" aria-label="Per-model steps">
              <h3 className="v-panel__section-title">Per-model steps</h3>
              <table className="mc-table">
                <thead>
                  <tr>
                    <th>Model</th>
                    <th className="v-panel__num">Steps</th>
                    <th>Mix</th>
                  </tr>
                </thead>
                <tbody>
                  {data.models.map((m) => {
                    const pct = Math.round(m.mix * 100);
                    return (
                      <tr key={m.model}>
                        <td className="mc-mono">{m.model}</td>
                        <td className="v-panel__num mc-mono">{m.steps.toLocaleString()}</td>
                        <td>
                          <div className="v-panel__mix">
                            <span className="v-panel__mix-track">
                              <span className="v-panel__mix-fill" style={{ width: `${pct}%` }} />
                            </span>
                            <span className="v-panel__mix-pct mc-mono">{pct}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          ) : null}

          {data.byWriter.length > 0 ? (
            <section className="v-panel__section" aria-label="Usage by writer">
              <h3 className="v-panel__section-title">Usage by writer</h3>
              <table className="mc-table">
                <thead>
                  <tr>
                    <th>Writer</th>
                    <th className="v-panel__num">Steps</th>
                    <th className="v-panel__num">Dispatches</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byWriter.map((w) => (
                    <tr key={w.key}>
                      <td className="mc-mono">{w.key}</td>
                      <td className="v-panel__num mc-mono">{w.steps.toLocaleString()}</td>
                      <td className="v-panel__num mc-mono">{w.dispatches.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
