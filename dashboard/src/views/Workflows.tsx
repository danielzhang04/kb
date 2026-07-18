/**
 * Workflows view (U3) — registered reusable definition artifacts promoted to their own destination.
 *
 * The empty state is a calm explanation of what is absent, never an error. When workflows do exist, the
 * view renders a dense list of their registered definition files. Registration does not compile or run
 * a definition. Launched queue cards and their dependency links are visualized separately in Runs.
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
        <p className="v-workflows__lede">
          Registered reusable definitions. Launched queue-card graphs appear in Runs.
        </p>
      </header>

      {empty ? (
        <div className="v-workflows__empty" data-testid="workflows-empty">
          <h3 className="v-workflows__empty-title">No workflows registered yet</h3>
          <p className="v-workflows__empty-body">
            Workflow definitions are Markdown artifacts under <code className="mc-mono">workflows/</code>.
            Registered definitions appear here with their id, path, and status; this view does not execute them.
          </p>
          <p className="v-workflows__empty-sub">
            When queue cards are launched with dependencies, their graph appears in Runs.
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

      <p className="v-workflows__runs-note" data-testid="workflows-runs-note">
        These are definitions, not live runs. Runs visualizes launched queue cards and their dependency links.
      </p>
    </section>
  );
}
