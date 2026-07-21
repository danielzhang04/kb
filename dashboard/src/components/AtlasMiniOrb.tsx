/**
 * Atlas V1 (Task 8) — the global mini-orb (Daniel's addition, design §4). Mounted at the App-shell
 * level so it renders over EVERY view; it is the peripheral "Atlas is awake" cue while the operator is
 * on some other tab.
 *
 * Visibility rule: hidden while the worker is ASLEEP or OFFLINE (and while still loading), so the corner
 * is empty unless Atlas is actively awake. App also declines to mount it on the Atlas view itself — no
 * double orb. When shown it pulses through LISTENING / THINKING / SPEAKING (the same motion vocabulary
 * as the big orb, scaled down) and a click navigates to the Atlas view.
 *
 * Read-only mirror: this never captures audio and triggers nothing — clicking only changes the active
 * dashboard view. Worker state comes from the shared {@link useAtlasState} poller (no second fetch loop).
 */
import { useAtlasState, type OrbState } from '../lib/useAtlasState';
import '../styles/views/atlas.css';

/** Only the awake states render a mini-orb; the rest leave the corner empty. */
function isAwake(state: OrbState): boolean {
  return state === 'LISTENING' || state === 'THINKING' || state === 'SPEAKING';
}

export function AtlasMiniOrb({ onOpen }: { onOpen: () => void }): React.JSX.Element | null {
  const { worker, loading } = useAtlasState();
  if (loading || !isAwake(worker.state)) return null;

  const state = worker.state.toLowerCase();
  return (
    <button
      type="button"
      className={`atlas-miniorb atlas-miniorb--${state}`}
      onClick={onOpen}
      title={`Atlas · ${state}`}
      aria-label={`Atlas is ${state}. Open the Atlas view.`}
      data-testid="atlas-miniorb"
      data-state={worker.state}
    >
      <span className="atlas-miniorb__orb" aria-hidden="true" />
    </button>
  );
}
