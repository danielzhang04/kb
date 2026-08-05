/**
 * Sentinel panel (D3.5) — read-only agent liveness. Projects the server health panel
 * (`GET /api/panels/health`, built by `server/panels/health.ts`): per-agent liveness derived from ledger
 * recency + working-card state, the declared HEARTBEAT cadences, and per-org STATE blocked flags. Status
 * is encoded with the semantic status dot (green/idle/red vocabulary), never a decorative hue.
 *
 * Accepts a `panel` prop directly (tests / an already-loaded parent) or self-fetches. The liveness
 * readout is read-only and empty-safe; the one thing on this view that WRITES is the emergency-stop
 * section at the bottom — {@link StopControls}, the app's single stop implementation, relocated here
 * from the sidebar floor (spec §6) so the halt controls sit beside the health readout that motivates
 * reaching for them. It is visually separated and mints its own session at point of action.
 */
import { useEffect, useState } from 'react';
import type { HealthPanel, LivenessStatus } from '../../../server/panels/health';
import { StopControls } from '../Control';
import '../../styles/views/panels.css';

const EMPTY: HealthPanel = {
  asOf: '',
  stalenessDays: 2,
  agents: [],
  orgs: [],
  systemCadences: [],
  cadenceCount: 0,
  liveCount: 0,
};

/** Map a liveness bucket to a status-dot modifier (semantic colour only — no decorative accent). */
function dotClass(status: LivenessStatus): string {
  switch (status) {
    case 'working':
      return 'mc-status-dot--running';
    case 'active':
      return 'mc-status-dot--done';
    case 'stale':
      return 'mc-status-dot--blocked';
    default:
      return 'mc-status-dot--idle';
  }
}

export function Sentinel({ panel }: { panel?: HealthPanel } = {}): React.JSX.Element {
  const [fetched, setFetched] = useState<HealthPanel | null>(null);

  useEffect(() => {
    if (panel) return;
    let cancelled = false;
    fetch('/api/panels/health')
      .then((r) => r.json() as Promise<HealthPanel>)
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

  return (
    <div className="v-panel v-panel--sentinel" aria-label="Sentinel panel">
      <div className="v-panel__header">
        <h2 className="v-panel__title">Sentinel</h2>
        <span className="v-panel__note">
          Agent liveness from ledger recency, working-card state, and declared HEARTBEAT cadences
          {data.asOf ? (
            <>
              {' '}
              (as of <span className="mc-mono">{data.asOf}</span>).
            </>
          ) : (
            '.'
          )}
        </span>
      </div>

      <div className="v-panel__tiles">
        <div className="v-panel__tile">
          <span className="v-panel__tile-value">{data.liveCount}</span>
          <span className="v-panel__tile-label">live</span>
        </div>
        <div className="v-panel__tile">
          <span className="v-panel__tile-value">{data.agents.length}</span>
          <span className="v-panel__tile-label">agents</span>
        </div>
        <div className="v-panel__tile">
          <span className="v-panel__tile-value">{data.cadenceCount}</span>
          <span className="v-panel__tile-label">cadences</span>
        </div>
      </div>

      {data.agents.length === 0 ? (
        <p className="mc-empty">No agents observed yet.</p>
      ) : (
        <section className="v-panel__section" aria-label="Agent liveness">
          <h3 className="v-panel__section-title">Agent liveness</h3>
          <table className="mc-table">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Role</th>
                <th>Status</th>
                <th>Last active</th>
              </tr>
            </thead>
            <tbody>
              {data.agents.map((a) => (
                <tr key={a.id} data-testid={`sentinel-agent-${a.id}`}>
                  <td className="mc-mono">{a.id}</td>
                  <td>{a.role ?? '—'}</td>
                  <td>
                    <span className="v-panel__status">
                      <span className={`mc-status-dot ${dotClass(a.status)}`} aria-hidden="true" />
                      {a.status}
                    </span>
                  </td>
                  <td className="mc-mono">{a.lastActive ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {data.orgs.length > 0 ? (
        <section className="v-panel__section" aria-label="Project heartbeats">
          <h3 className="v-panel__section-title">Project heartbeats</h3>
          <table className="mc-table">
            <thead>
              <tr>
                <th>Project</th>
                <th>Blocked</th>
                <th>Cadences</th>
              </tr>
            </thead>
            <tbody>
              {data.orgs.map((o) => (
                <tr key={o.project} data-testid={`sentinel-org-${o.project}`}>
                  <td className="mc-mono">{o.project}</td>
                  <td>
                    {o.blocked ? (
                      <span className="v-panel__status">
                        <span className="mc-status-dot mc-status-dot--blocked" aria-hidden="true" />
                        blocked
                      </span>
                    ) : (
                      <span className="v-panel__muted">clear</span>
                    )}
                  </td>
                  <td className="mc-mono">{o.cadences.map((c) => c.name).join(', ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {/* The only writing control on this view — hairline-separated from the read-only readout above. */}
      <div className="v-panel__stop">
        <StopControls />
      </div>
    </div>
  );
}
