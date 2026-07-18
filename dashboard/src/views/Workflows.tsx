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
import { useSse } from '../lib/sseClient';
import type { Session } from '../lib/authClient';
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
export function Workflows({
  data,
  sessionToken,
  onRequestSession,
}: {
  data?: WorkflowsIndex;
  sessionToken?: string;
  onRequestSession?: () => Promise<Session | null>;
} = {}): React.JSX.Element {
  const [fetched, setFetched] = useState<WorkflowsIndex | null>(null);
  const [runStatus, setRunStatus] = useState<Record<string, string>>({});
  const { count: planeATick } = useSse('/events');

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
  }, [data, planeATick]);

  const workflows = data ?? fetched ?? EMPTY;
  const empty = !workflows.present || workflows.items.length === 0;

  async function runWorkflow(id: string): Promise<void> {
    const item = workflows.items.find((candidate) => candidate.id === id);
    if (!item?.definition) return;
    setRunStatus((current) => ({ ...current, [id]: 'Launching…' }));
    try {
      const token = sessionToken ?? (await onRequestSession?.())?.token;
      if (!token) {
        setRunStatus((current) => ({ ...current, [id]: 'Unlock refused.' }));
        return;
      }
      const response = await fetch('/api/write/workflow-runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(item.definition),
      });
      const body = (await response.json()) as {
        runId?: string;
        runners?: Array<{ status?: string }>;
        error?: string;
        detail?: unknown;
      };
      const signaled = body.runners?.filter((runner) => runner.status === 'triggered').length ?? 0;
      const message = response.ok && body.runId
        ? `Launched ${body.runId}${signaled > 0 ? ` · ${signaled} background runner${signaled === 1 ? '' : 's'} signaled` : ' · queued; no runner signaled'}`
        : `Refused: ${typeof body.detail === 'string' ? body.detail : body.error ?? response.status}`;
      setRunStatus((current) => ({ ...current, [id]: message }));
    } catch (error) {
      setRunStatus((current) => ({ ...current, [id]: `Failed: ${error instanceof Error ? error.message : String(error)}` }));
    }
  }

  return (
    <section className="v-workflows" aria-label="Workflows view">
      <header className="v-workflows__head">
        <h2 className="v-workflows__title">Workflows</h2>
        <p className="v-workflows__lede">
          Registered reusable definitions. Strict workflow-v1 definitions can launch here; live instances appear in Runs.
        </p>
      </header>

      {empty ? (
        <div className="v-workflows__empty" data-testid="workflows-empty">
          <h3 className="v-workflows__empty-title">No workflows registered yet</h3>
          <p className="v-workflows__empty-body">
            Workflow definitions are Markdown artifacts under <code className="mc-mono">workflows/</code>.
            Registered definitions appear here with their id, path, and status. Executable workflow-v1 definitions expose Run now.
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
              <th>Run</th>
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
                <td className="v-workflows__cell-run">
                  {w.definition ? (
                    <>
                      <button type="button" className="mc-btn mc-btn--quiet" onClick={() => void runWorkflow(w.id)}>
                        Run now
                      </button>
                      {runStatus[w.id] ? <span className="v-workflows__run-status">{runStatus[w.id]}</span> : null}
                    </>
                  ) : (
                    <span className="v-workflows__not-runnable">Prose only</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="v-workflows__runs-note" data-testid="workflows-runs-note">
        Saving a definition does not launch it. Run now creates a new instance; Runs shows its live stage graph.
      </p>
    </section>
  );
}
