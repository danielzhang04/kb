/**
 * Workflows view (U3) — "runs of work as connected chains" promoted to its own top-level destination.
 *
 * The live repo has NO `workflows/` registry directory yet (the indexer returns `present: false`), so
 * the EMPTY state is the state Daniel actually sees today — it is the designed centrepiece here, not an
 * afterthought: a calm explanation of what will appear, in no error tone. When workflows do exist, the
 * view renders a dense, calm list (id + mono path + a neutral "registered" status). Below either state
 * sits a hairline placeholder region marking where the D3.4 scoped run view (a React Flow DAG with
 * per-node model bars) will render run-chains once runs exist — a one-line hint, never a fake graph.
 *
 * Read-only, self-fetching: it keeps the U2.5 wrapper's pattern (fetch `/api/registry`, read the
 * `workflows` slice), degrading to the designed empty state on any failure rather than crashing.
 *
 * DATA GAP (reported upward): `WorkflowEntry` today carries only `{ id, path }` — there is no `name`
 * distinct from `id`, and no `status` field. This view renders `id` as the name and a neutral
 * "registered" marker; a real status/name needs a server-side schema addition (out of U3 scope).
 */
import { useEffect, useState } from 'react';
import type { WorkflowsIndex } from '../../server/registry/workflows';
import '../styles/views/workflows.css';

const EMPTY: WorkflowsIndex = { present: false, items: [] };

/** Accepts workflows data directly (tests) or self-fetches the registry index. */
export function Workflows({ data }: { data?: WorkflowsIndex } = {}): React.JSX.Element {
  const [fetched, setFetched] = useState<WorkflowsIndex | null>(null);

  useEffect(() => {
    if (data) return;
    let cancelled = false;
    fetch('/api/registry')
      .then((r) => r.json() as Promise<{ workflows?: WorkflowsIndex }>)
      .then((d) => {
        if (!cancelled && d.workflows) setFetched(d.workflows);
      })
      .catch(() => {
        /* read-only view: on failure keep the empty-safe scaffold, never crash the shell */
      });
    return () => {
      cancelled = true;
    };
  }, [data]);

  const workflows = data ?? fetched ?? EMPTY;
  const empty = !workflows.present || workflows.items.length === 0;

  return (
    <section className="v-workflows" aria-label="Workflows view">
      <header className="v-workflows__head">
        <h2 className="v-workflows__title">Workflows</h2>
        <p className="v-workflows__lede">Runs of work as connected chains.</p>
      </header>

      {empty ? (
        <div className="v-workflows__empty" data-testid="workflows-empty">
          <h3 className="v-workflows__empty-title">No workflows registered yet</h3>
          <p className="v-workflows__empty-body">
            A workflow is a reusable chain of cards — one run of work handed from stage to stage. Once
            a <code className="mc-mono">workflows/</code> registry exists in the repo, each registered
            workflow will appear here with its id and path, and its runs will render as connected chains
            below.
          </p>
          <p className="v-workflows__empty-sub">
            Nothing is wrong — there is simply nothing to run yet.
          </p>
        </div>
      ) : (
        <table className="v-workflows__table">
          <thead>
            <tr>
              <th>Workflow</th>
              <th>Path</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {workflows.items.map((w) => (
              <tr key={w.id} className="v-workflows__row" data-testid={`workflow-row-${w.id}`}>
                <td className="v-workflows__cell-id mc-mono">{w.id}</td>
                <td className="v-workflows__cell-path mc-mono">{w.path}</td>
                <td className="v-workflows__cell-status">
                  <span className="mc-status-dot mc-status-dot--idle" aria-hidden="true" />
                  <span className="v-workflows__status-label">registered</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Run-chain region: where the D3.4 scoped DAG renders once runs exist. A hairline hint, not a
          fake graph — it states intent without pretending data is present. */}
      <div className="v-workflows__runs" aria-label="Run chains">
        <span className="v-workflows__runs-hint">
          Run-chains will render here as connected node graphs once workflows have live runs (D3.4).
        </span>
      </div>
    </section>
  );
}
