/**
 * Workflows view (U2.5) — the Registry's workflows slice promoted to its own top-level destination
 * ("runs of work as connected chains"). A thin, read-only wrapper: it self-fetches `/api/registry`
 * (same route + empty-safe pattern as {@link Registry}) and renders only the workflows list, degrading
 * to the calm "no workflows registered yet" empty state rather than an error. U3 grows this into the
 * connected-chain view; here it stands up the destination without duplicating registry server logic.
 */
import { useEffect, useState } from 'react';
import type { WorkflowsIndex } from '../../server/registry/workflows';

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
    <section className="registry__section" aria-label="Workflows view">
      <h2>Workflows</h2>
      {empty ? (
        <p className="registry__empty">No workflows registered yet.</p>
      ) : (
        <ul>
          {workflows.items.map((w) => (
            <li key={w.id}>{w.id}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
