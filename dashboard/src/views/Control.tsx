/**
 * Control-view landing — the mission-control board (D0.9, Option B / adopted default Q1).
 *
 * It COMPOSES the existing read-only views (it does not reimplement them): a fleet strip rolled up
 * from the Plane-A snapshot (agents, running count, USAGE — never spend), the org STATEs, the live
 * spectator Timeline entry, and the KB Browser + Registry panes. Live updates arrive over the hub's
 * SSE stream (D0.4): a Plane-A delta bumps the SSE tick, which re-fetches the whole snapshot (the bus
 * carries lightweight deltas, not full index frames — see server/hub/bus.ts).
 *
 * Data source: the `snapshot` prop (tests / an already-loaded parent) or a self-fetch of `/api/index`
 * (D0.9 server route). Every pane degrades to an empty-safe state; nothing here writes.
 */
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { PlaneAIndex } from '../../server/planeA/indexer';
import { Browser } from './Browser';
import { Registry } from './Registry';
import { Timeline } from './Timeline';
import { LaunchControls } from './launchControls';
import { useSse } from '../lib/sseClient';
import { useAssignableOwners } from '../lib/assignableOwners';
import { invalidateSessionOnGovernedAuthFailure } from '../lib/authClient';
import { useSession } from '../lib/sessionContext';

const EMPTY_INDEX: PlaneAIndex = {
  cards: {},
  ledgers: {
    dispatch: { count: 0, cards: 0, byProject: {} },
    cost: { stepCount: 0, perModelSteps: {}, modelMix: {}, usdPresent: false },
    grades: { count: 0, rows: [] },
    activity: { count: 0, rows: [] },
  },
  orgStates: [],
};

/** Distinct non-null card owners across every state bucket = the agents currently on the board. */
function agentCount(index: PlaneAIndex): number {
  const owners = new Set<string>();
  for (const bucket of Object.values(index.cards)) {
    for (const c of bucket) {
      if (typeof c.meta.owner === 'string' && c.meta.owner) owners.add(c.meta.owner);
    }
  }
  return owners.size;
}

function FleetStrip({ index }: { index: PlaneAIndex }): React.JSX.Element {
  const agents = agentCount(index);
  const running = index.cards.working?.length ?? 0;
  const approvals = index.cards.approvals?.length ?? 0;
  const mix = Object.entries(index.ledgers.cost.modelMix).sort((a, b) => b[1] - a[1]);

  return (
    <section className="fleet-strip" aria-label="Fleet status">
      <div className="fleet-strip__stat" data-testid="fleet-agents">
        <span className="fleet-strip__value">{agents}</span>
        <span className="fleet-strip__label">agents</span>
      </div>
      <div className="fleet-strip__stat" data-testid="fleet-running">
        <span className="fleet-strip__value">{running}</span>
        <span className="fleet-strip__label">running</span>
      </div>
      <div className="fleet-strip__stat" data-testid="fleet-approvals">
        <span className="fleet-strip__value">{approvals}</span>
        <span className="fleet-strip__label">approvals</span>
      </div>
      {/*
        USAGE, never spend: we surface step counts + model mix and deliberately suppress the USD
        figure (it exists in the ledger but is never shown here — see server/planeA/ledgers.ts).
      */}
      <div className="fleet-strip__usage" data-testid="fleet-usage">
        <span className="fleet-strip__label">USAGE</span>
        <span className="fleet-strip__sub">{index.ledgers.cost.stepCount} steps</span>
        {mix.length > 0 ? (
          <ul className="fleet-strip__mix">
            {mix.map(([model, share]) => (
              <li key={model}>
                {model} · {Math.round(share * 100)}%
              </li>
            ))}
          </ul>
        ) : (
          <span className="fleet-strip__sub">no usage yet</span>
        )}
      </div>
    </section>
  );
}

function OrgStates({ index }: { index: PlaneAIndex }): React.JSX.Element {
  return (
    <section className="org-states" aria-label="Org states">
      <h2>Org STATE</h2>
      {index.orgStates.length === 0 ? (
        <p className="org-states__empty">No org STATE files found.</p>
      ) : (
        <ul className="org-states__list">
          {index.orgStates.map((s) => (
            <li key={s.project} className="org-states__item">
              <h3>{s.project}</h3>
              <p className="org-states__now">
                <strong>Now:</strong> {s.now || '—'}
              </p>
              <p className="org-states__next">
                <strong>Next:</strong> {s.next || '—'}
              </p>
              {s.blocked && s.blocked !== '(nothing blocked)' ? (
                <p className="org-states__blocked">
                  <strong>Blocked:</strong> {s.blocked}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * D2.8 — files-only stop floor controls, distinctly surfaced per the plan: a SCOPED control (walk one
 * card `working` -> `stop-requested` -> `halting`, or suppress one cadence's next beat) vs the NUCLEAR
 * `STOP` control (freeze the WHOLE fleet). Both are governed + WebAuthn-session-gated server-side by
 * `server/stop/floor.ts` (`requestStop`/`pauseCadence`/`writeStop`); this panel is a thin POSTing form
 * and NEVER writes `queue/`/`STOP` itself, same pattern as `LaunchControls` above. The nuclear control
 * additionally requires an explicit confirm checkbox (armed, not a single accidental click) before its
 * submit button is even enabled.
 *
 * Unlock is point-of-action through the shared session context: a submit on a locked tab runs the ONE
 * passkey ceremony and, if it is refused, fails closed with the same no-session status it always had.
 */
export function StopControls(): React.JSX.Element {
  const { requireSession } = useSession();
  const [cardId, setCardId] = useState('');
  const [stopCardStatus, setStopCardStatus] = useState<string | null>(null);

  const [cadenceName, setCadenceName] = useState('');
  const [pauseStatus, setPauseStatus] = useState<string | null>(null);

  const [confirmNuke, setConfirmNuke] = useState(false);
  const [nukeStatus, setNukeStatus] = useState<string | null>(null);

  async function submitStopCard(e: FormEvent): Promise<void> {
    e.preventDefault();
    const token = (await requireSession())?.token;
    if (!token) {
      setStopCardStatus('no session — the dashboard is locked');
      return;
    }
    try {
      const res = await fetch('/api/write/stop-card', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ cardId }),
      });
      await invalidateSessionOnGovernedAuthFailure(res);
      const data = (await res.json()) as { state?: string; reason?: string };
      setStopCardStatus(res.ok ? `${cardId} -> ${data.state}` : `refused: ${data.reason ?? res.status}`);
    } catch {
      setStopCardStatus('stop request failed');
    }
  }

  async function submitPauseCadence(e: FormEvent): Promise<void> {
    e.preventDefault();
    const token = (await requireSession())?.token;
    if (!token) {
      setPauseStatus('no session — the dashboard is locked');
      return;
    }
    try {
      const res = await fetch('/api/write/pause-cadence', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: cadenceName }),
      });
      await invalidateSessionOnGovernedAuthFailure(res);
      const data = (await res.json()) as { path?: string; reason?: string };
      setPauseStatus(res.ok ? `paused ${cadenceName}` : `refused: ${data.reason ?? res.status}`);
    } catch {
      setPauseStatus('pause request failed');
    }
  }

  async function submitNuke(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!confirmNuke) {
      setNukeStatus('confirm the nuclear STOP checkbox first');
      return;
    }
    const token = (await requireSession())?.token;
    if (!token) {
      setNukeStatus('no session — the dashboard is locked');
      return;
    }
    try {
      const res = await fetch('/api/write/stop', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({}),
      });
      await invalidateSessionOnGovernedAuthFailure(res);
      const data = (await res.json()) as { reason?: string };
      setNukeStatus(res.ok ? 'STOP written — fleet frozen' : `refused: ${data.reason ?? res.status}`);
    } catch {
      setNukeStatus('STOP request failed');
    }
  }

  return (
    <section className="control__pane control__stop" aria-label="Stop floor">
      <h2>Stop floor</h2>

      <form aria-label="Request card stop" onSubmit={(e) => void submitStopCard(e)}>
        <input aria-label="Card id to stop" value={cardId} onChange={(e) => setCardId(e.target.value)} />
        <button type="submit">Request stop</button>
      </form>
      {stopCardStatus ? <p data-testid="stop-card-status">{stopCardStatus}</p> : null}

      <form aria-label="Pause cadence" onSubmit={(e) => void submitPauseCadence(e)}>
        <input aria-label="Cadence name" value={cadenceName} onChange={(e) => setCadenceName(e.target.value)} />
        <button type="submit">Pause cadence</button>
      </form>
      {pauseStatus ? <p data-testid="pause-cadence-status">{pauseStatus}</p> : null}

      <form aria-label="Nuclear STOP" className="control__stop-nuke" onSubmit={(e) => void submitNuke(e)}>
        <label>
          <input
            type="checkbox"
            aria-label="Confirm nuclear STOP"
            checked={confirmNuke}
            onChange={(e) => setConfirmNuke(e.target.checked)}
          />
          Confirm — freeze the WHOLE fleet
        </label>
        <button type="submit" disabled={!confirmNuke}>
          STOP everything
        </button>
      </form>
      {nukeStatus ? <p data-testid="nuke-status">{nukeStatus}</p> : null}
    </section>
  );
}

/** Control landing. Accepts a snapshot directly (tests) or self-fetches `/api/index` and refreshes on SSE. */
export function Control({ snapshot }: { snapshot?: PlaneAIndex } = {}): React.JSX.Element {
  const [fetched, setFetched] = useState<PlaneAIndex | null>(null);
  // A Plane-A delta on the hub bumps `count`; we refetch the snapshot on each tick (skipped when a
  // snapshot is supplied directly, and a no-op under jsdom where EventSource is absent).
  const { count } = useSse('/events');

  useEffect(() => {
    if (snapshot) return;
    let cancelled = false;
    fetch('/api/index')
      .then((r) => r.json() as Promise<PlaneAIndex>)
      .then((d) => {
        if (!cancelled) setFetched(d);
      })
      .catch(() => {
        /* read-only board: on failure keep the empty-safe scaffold, never crash the shell */
      });
    return () => {
      cancelled = true;
    };
  }, [snapshot, count]);

  const index = snapshot ?? fetched ?? EMPTY_INDEX;
  // C7.8 — populate the owner picker from the live roster ∪ registered default_workers. Every tab can
  // now mint at point-of-action, so the picker is always populated.
  const owners = useAssignableOwners(true);

  return (
    <div className="control" aria-label="Control view">
      <FleetStrip index={index} />
      <div className="control__grid">
        <div className="control__col control__col--wide">
          <section className="control__pane" aria-label="Live timeline">
            <h2>Live timeline</h2>
            <Timeline />
          </section>
          <section className="control__pane" aria-label="KB browser">
            <h2>Knowledge base</h2>
            <Browser />
          </section>
        </div>
        <div className="control__col">
          <OrgStates index={index} />
          <section className="control__pane" aria-label="Registry">
            <h2>Registry</h2>
            <Registry />
          </section>
          <LaunchControls owners={owners} />
        </div>
      </div>
    </div>
  );
}
