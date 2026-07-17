/**
 * Connectors view (U3) — the fleet's MCP integrations, promoted from the Registry's connections slice
 * to its own top-level destination. Read-only: it self-fetches `/api/registry` (same empty-safe
 * pattern as {@link Registry}) and renders the per-project server→tools wiring as a dense table.
 *
 * DATA SHAPE (see server/registry/connections.ts): a project's MCP wiring is the set of
 * `mcp__<server>__<tool>` permission tokens in `orgs/<project>/.claude/settings.json`. There is no
 * `.mcp.json` transport/URL record, no per-connection health check, and no explicit scope flag — so
 * "scope" is projected from the data we DO have: a server present in one project = project-scoped, a
 * server present across every project that has any connection = global. Status is a static "allowed"
 * dot (the allow-list is a grant record, not a liveness probe — we do not claim a live connection).
 * Gaps (transport, real health, declared scope) feed the Phase R2 work order.
 */
import { useEffect, useMemo, useState } from 'react';
import type { ConnectionsIndex } from '../../server/registry/connections';
import '../styles/views/connectors.css';

const EMPTY: ConnectionsIndex = { count: 0, items: [], byProject: {} };

interface ConnectorRow {
  project: string;
  server: string;
  tools: string[];
  scope: 'global' | 'project';
}

/**
 * Flatten the per-project index into table rows and PROJECT a scope. A server that appears in every
 * project that has connections is treated as `global`; anything narrower is `project`. Honest given
 * the data — settings.json carries no explicit scope field.
 */
export function toRows(connections: ConnectionsIndex): ConnectorRow[] {
  const projects = Object.keys(connections.byProject);
  const serverProjects = new Map<string, Set<string>>();
  for (const c of connections.items) {
    if (!serverProjects.has(c.server)) serverProjects.set(c.server, new Set());
    serverProjects.get(c.server)!.add(c.project);
  }
  const rows: ConnectorRow[] = connections.items.map((c) => ({
    project: c.project,
    server: c.server,
    tools: c.tools,
    scope:
      projects.length > 1 && serverProjects.get(c.server)!.size === projects.length
        ? 'global'
        : 'project',
  }));
  return rows.sort(
    (a, b) => a.project.localeCompare(b.project) || a.server.localeCompare(b.server),
  );
}

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
  const rows = useMemo(() => toRows(connections), [connections]);

  return (
    <section className="v-connectors" aria-label="Connectors view">
      <h2 className="v-connectors__title">
        MCP integrations <span className="v-connectors__count mc-num">({connections.count})</span>
      </h2>

      {rows.length === 0 ? (
        <p className="v-connectors__empty">No MCP connections.</p>
      ) : (
        <div className="v-connectors__table-wrap">
          <table className="mc-table v-connectors__table">
            <thead>
              <tr>
                <th scope="col">Connection</th>
                <th scope="col">Project</th>
                <th scope="col">Scope</th>
                <th scope="col" className="v-connectors__col-num">Tools</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.project}::${r.server}`} data-testid={`connector-row-${r.project}-${r.server}`}>
                  <td>
                    <span className="mc-mono v-connectors__server">{r.server}</span>
                    <span className="v-connectors__tools-list" title={r.tools.join(', ')}>
                      {r.tools.join(', ')}
                    </span>
                  </td>
                  <td className="mc-mono">{r.project}</td>
                  <td>
                    <span className={`v-connectors__scope v-connectors__scope--${r.scope}`}>{r.scope}</span>
                  </td>
                  <td className="mc-mono v-connectors__col-num">{r.tools.length}</td>
                  <td>
                    <span className="v-connectors__status">
                      <span className="mc-status-dot mc-status-dot--done" aria-hidden="true" />
                      allowed
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
