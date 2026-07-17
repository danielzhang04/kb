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
 * The read-API gap is now closed: `WorkflowEntry` carries `name` + `status` (read from each workflow
 * file's frontmatter, falling back to the id and `registered` respectively), so real entries render
 * with a human name and a live status marker rather than a hardcoded label.
 */
import { useEffect, useState } from 'react';
import type { WorkflowsIndex } from '../../server/registry/workflows';
import '../styles/views/workflows.css';

const EMPTY: WorkflowsIndex = { present: false, items: [] };

/** Map a workflow status to a shared status-dot modifier (no new hue taxonomy). Unknown → idle. */
function statusDot(status: string): 'running' | 'idle' | 'error' | 'blocked' {
  switch (status.toLowerCase()) {
    case 'running':
    case 'active':
      return 'running';
    case 'failed':
    case 'error':
      return 'error';
    case 'blocked':
    case 'paused':
      return 'blocked';
    default:
      return 'idle';
  }
}

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
                <td className="v-workflows__cell-id">
                  <span className="v-workflows__wf-name">{w.name}</span>
                  {w.name !== w.id ? <span className="v-workflows__wf-id mc-mono">{w.id}</span> : null}
                </td>
                <td className="v-workflows__cell-path mc-mono">{w.path}</td>
                <td className="v-workflows__cell-status">
                  <span
                    className={`mc-status-dot mc-status-dot--${statusDot(w.status)}`}
                    aria-hidden="true"
                  />
                  <span className="v-workflows__status-label">{w.status}</span>
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
