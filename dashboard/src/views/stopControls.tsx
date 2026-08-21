import { useState } from 'react';
import type { FormEvent } from 'react';
import { invalidateSessionOnGovernedAuthFailure } from '../lib/authClient';
import { useSession } from '../lib/sessionContext';

/** The single P1 fleet STOP control. Card stop belongs to Run view; cadence pause belongs to Schedules. */
export function StopControls(): React.JSX.Element {
  const { requireSession } = useSession();
  const [confirmed, setConfirmed] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!confirmed) {
      setStatus('confirm the nuclear STOP checkbox first');
      return;
    }
    const token = (await requireSession())?.token;
    if (!token) {
      setStatus('no session — the dashboard is locked');
      return;
    }
    try {
      const response = await fetch('/api/write/stop', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({}),
      });
      await invalidateSessionOnGovernedAuthFailure(response);
      const body = await response.json() as { reason?: string };
      setStatus(response.ok ? 'STOP written — fleet frozen' : `refused: ${body.reason ?? response.status}`);
    } catch {
      setStatus('STOP request failed');
    }
  }

  return (
    <section className="mc-stop" aria-label="Emergency stop">
      <h3 className="mc-stop__title">Emergency stop</h3>
      <div className="mc-stop__control mc-stop__control--nuke">
        <p className="mc-stop__help">Freeze the whole fleet. Every agent stops picking up work until the freeze is lifted by hand.</p>
        <form aria-label="Nuclear STOP" onSubmit={(event) => void submit(event)}>
          <label>
            <input type="checkbox" aria-label="Confirm nuclear STOP" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            Confirm — freeze the WHOLE fleet
          </label>
          <button type="submit" disabled={!confirmed}>STOP everything</button>
        </form>
        {status ? <p className="mc-stop__status" data-testid="nuke-status">{status}</p> : null}
      </div>
    </section>
  );
}
