/**
 * Emergency-stop controls (D2.8) — the app's SINGLE stop implementation, and all this module holds.
 *
 * `StopControls` is a thin POSTing form over the three governed halt paths: request one card's stop
 * (`/api/write/stop-card`), suppress one cadence's next beat (`/api/write/pause-cadence`), and the
 * nuclear whole-fleet freeze (`/api/write/stop`). It NEVER writes `queue/` or `STOP` itself — the
 * server side (`server/stop/floor.ts`) owns those writes and gates every one behind a WebAuthn session.
 *
 * Nothing renders this at a route of its own: the live mount is `views/panels/Sentinel.tsx`, beside
 * the fleet-health readout an operator is already reading when they reach for the stop. Unlock is
 * point-of-action through the shared session context, so a locked tab runs the one passkey ceremony
 * on submit and fails closed if it is refused.
 */
import { useState } from 'react';
import type { FormEvent } from 'react';
import { invalidateSessionOnGovernedAuthFailure } from '../lib/authClient';
import { useSession } from '../lib/sessionContext';

/**
 * D2.8 — files-only emergency-stop controls: a SCOPED control (walk one card `working` ->
 * `stop-requested` -> `halting`, or suppress one cadence's next beat) vs the NUCLEAR `STOP` control
 * (freeze the WHOLE fleet). Both are governed + WebAuthn-session-gated server-side by
 * `server/stop/floor.ts` (`requestStop`/`pauseCadence`/`writeStop`); this panel is a thin POSTing form
 * and NEVER writes `queue/`/`STOP` itself. The nuclear control
 * additionally requires an explicit confirm checkbox (armed, not a single accidental click) before its
 * submit button is even enabled.
 *
 * This is the app's SINGLE stop implementation. It used to be mounted in a pinned sidebar floor; spec §6
 * moved it into the Sentinel view (`views/panels/Sentinel.tsx`), beside the fleet-health readout an
 * operator is already reading when they reach for it. The component moved — it was never forked.
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
    <section className="mc-stop" aria-label="Emergency stop">
      <h3 className="mc-stop__title">Emergency stop</h3>
      <p className="mc-stop__lead">
        Three ways to halt work, narrowest first. Each one needs your passkey.
      </p>

      <div className="mc-stop__control">
        <p className="mc-stop__help">Ask one running task to wind down. It finishes what it is doing, then halts.</p>
        <form aria-label="Request card stop" onSubmit={(e) => void submitStopCard(e)}>
          <input aria-label="Card id to stop" placeholder="Task id" value={cardId} onChange={(e) => setCardId(e.target.value)} />
          <button type="submit">Request stop</button>
        </form>
        {stopCardStatus ? <p className="mc-stop__status" data-testid="stop-card-status">{stopCardStatus}</p> : null}
      </div>

      <div className="mc-stop__control">
        <p className="mc-stop__help">Skip the next beat of one scheduled cadence. Everything else keeps running.</p>
        <form aria-label="Pause cadence" onSubmit={(e) => void submitPauseCadence(e)}>
          <input aria-label="Cadence name" placeholder="Cadence name" value={cadenceName} onChange={(e) => setCadenceName(e.target.value)} />
          <button type="submit">Pause cadence</button>
        </form>
        {pauseStatus ? <p className="mc-stop__status" data-testid="pause-cadence-status">{pauseStatus}</p> : null}
      </div>

      <div className="mc-stop__control mc-stop__control--nuke">
        <p className="mc-stop__help">Freeze the whole fleet. Every agent stops picking up work until the freeze is lifted by hand.</p>
        <form aria-label="Nuclear STOP" onSubmit={(e) => void submitNuke(e)}>
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
        {nukeStatus ? <p className="mc-stop__status" data-testid="nuke-status">{nukeStatus}</p> : null}
      </div>
    </section>
  );
}
