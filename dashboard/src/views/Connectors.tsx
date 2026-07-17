/**
 * Connectors view (U2.5) — the Registry's MCP connections slice promoted to its own top-level
 * destination ("MCP integrations"). A thin, read-only wrapper: it self-fetches `/api/registry` (same
 * route + empty-safe pattern as {@link Registry}) and renders only the per-project server→tools list,
 * degrading to the calm "no MCP connections" empty state rather than an error. U3 may enrich this; here
 * it stands up the destination without duplicating registry server logic.
 */
import { useEffect, useState } from 'react';
import type { ConnectionsIndex } from '../../server/registry/connections';

const EMPTY: ConnectionsIndex = { count: 0, items: [], byProject: {} };

/** Accepts connections data directly (tests) or self-fetches the registry index. */
export function Connectors({ data }: { data?: ConnectionsIndex } = {}): React.JSX.Element {
  const [fetched, setFetched] = useState<ConnectionsIndex | null>(null);

  useEffect(() => {
    if (data) return;
    let cancelled = false;
    fetch('/api/registry')
      .then((r) => r.json() as Promise<{ connections?: ConnectionsIndex }>)
      .then((d) => {
        if (!cancelled && d.connections) setFetched(d.connections);
      })
      .catch(() => {
        /* read-only view: on failure keep the empty-safe scaffold, never crash the shell */
      });
    return () => {
      cancelled = true;
    };
  }, [data]);

  const connections = data ?? fetched ?? EMPTY;
  const projects = Object.keys(connections.byProject);

  return (
    <section className="registry__section" aria-label="Connectors view">
      <h2>Connectors ({connections.count})</h2>
      {projects.length === 0 ? (
        <p className="registry__empty">No MCP connections.</p>
      ) : (
        projects.map((project) => (
          <div key={project} className="registry__project">
            <h4>{project}</h4>
            <ul>
              {connections.byProject[project].map((c) => (
                <li key={c.server}>
                  <strong>{c.server}</strong>: {c.tools.join(', ')}
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
