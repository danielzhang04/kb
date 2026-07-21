/**
 * Atlas V1 (Task 8) — the full Atlas view (design §4). One top-level nav destination (promoted from the
 * old greyed `soon` stub) that mirrors the desk voice worker at full zoom:
 *
 *   - a big orb whose per-state MOTION + BRIGHTNESS carry the worker state (no decorative colour):
 *       LISTENING steady glow · THINKING shimmer · SPEAKING pulse · ASLEEP dim · OFFLINE hollow.
 *     OFFLINE also shows "last seen <heartbeat age>".
 *   - the live transcript in the house Timeline idiom (dense single column, auto-scroll with freeze +
 *     an "N new" pill that jumps back to live).
 *   - activity history — the recent session transcripts from the ops ledger (design §5), newest-first.
 *   - the atlas-project cards with their queue states (semantic status dot only).
 *
 * Data comes from the shared {@link useAtlasState} poller (the mini-orb shares the same loop). Read-only:
 * nothing here writes or steers. Server types are `import type` only (client-import-graph guard).
 */
import { useEffect, useRef, useState } from 'react';
import { useAtlasState, type OrbState } from '../lib/useAtlasState';
import type { TranscriptLine, HistoryEntry, AtlasCard } from '../../server/panels/atlas';
import '../styles/views/atlas.css';

/** How close to the bottom (px) still counts as "tailing" — under jsdom all metrics are 0 ⇒ at bottom. */
const AT_BOTTOM_SLACK = 24;

/** A human-facing sentence for each orb state, shown under the orb. */
const STATE_CAPTION: Record<OrbState, string> = {
  OFFLINE: 'worker offline',
  ASLEEP: 'asleep — say “hey Atlas” to wake',
  LISTENING: 'listening',
  THINKING: 'thinking',
  SPEAKING: 'speaking',
};

/** Extract a `HH:MM:SS` clock from an ISO-8601 timestamp — deterministic, no locale/TZ shift. */
function formatClock(ts: string | null): string | null {
  if (!ts) return null;
  const t = ts.indexOf('T');
  if (t === -1) return null;
  const m = /^(\d{2}:\d{2}:\d{2})/.exec(ts.slice(t + 1));
  return m ? m[1] : null;
}

/** Coarse relative age from an ISO stamp to now ("just now" / "12s" / "5m" / "3h" / "2d" ago). */
function formatAge(iso: string | null, now: number): string {
  if (!iso) return 'never';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 'unknown';
  const secs = Math.max(0, Math.round((now - then) / 1000));
  if (secs < 5) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** The role tag shown in the transcript column ("you" for the operator, "atlas" for the worker). */
function roleLabel(role: string | null): string {
  if (role === 'user') return 'you';
  if (role === 'atlas' || role === 'assistant') return 'atlas';
  return role ?? '—';
}

/** The big orb — a filled circle whose state class drives the motion/brightness (all in atlas.css). */
function Orb({ state }: { state: OrbState }): React.JSX.Element {
  return (
    <div className={`atlas-orb atlas-orb--${state.toLowerCase()}`} role="img" aria-label={`Atlas is ${state}`}>
      <span className="atlas-orb__core" aria-hidden="true" />
    </div>
  );
}

/** One transcript row: mono role tag + clock, dimmed text. */
function TranscriptRow({ line }: { line: TranscriptLine }): React.JSX.Element {
  const clock = formatClock(line.t);
  const role = roleLabel(line.role);
  return (
    <div className={`atlas-line atlas-line--${role === 'atlas' ? 'atlas' : 'user'}`}>
      <span className="atlas-line__role mc-mono">{role}</span>
      {clock ? <span className="atlas-line__ts mc-mono">{clock}</span> : null}
      <span className="atlas-line__text">{line.text ?? ''}</span>
    </div>
  );
}

/** The live transcript pane — Timeline idiom: auto-scroll while tailing, freeze on scroll-up, "N new" pill. */
function LiveTranscript({ lines }: { lines: TranscriptLine[] }): React.JSX.Element {
  const logRef = useRef<HTMLDivElement | null>(null);
  const [frozen, setFrozen] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const prevCountRef = useRef(0);
  const count = lines.length;

  function isAtBottom(el: HTMLDivElement): boolean {
    return el.scrollHeight - el.scrollTop - el.clientHeight <= AT_BOTTOM_SLACK;
  }
  function scrollToLive(): void {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }
  function handleScroll(): void {
    const el = logRef.current;
    if (!el) return;
    if (isAtBottom(el)) {
      setFrozen(false);
      setNewCount(0);
    } else {
      setFrozen(true);
    }
  }
  function jumpToLive(): void {
    scrollToLive();
    setFrozen(false);
    setNewCount(0);
  }

  useEffect(() => {
    const prev = prevCountRef.current;
    if (count > prev) {
      if (frozen) setNewCount((n) => n + (count - prev));
      else scrollToLive();
    }
    prevCountRef.current = count;
  }, [count, frozen]);

  return (
    <section className="atlas-transcript" aria-label="Atlas live transcript">
      <div className="atlas-transcript__header">
        <span className="atlas-transcript__granularity mc-mono">live transcript</span>
        <span className="atlas-transcript__hint">the desk mic mirror — user and atlas turns</span>
      </div>
      <div className="atlas-transcript__viewport">
        <div className="atlas-transcript__log" ref={logRef} onScroll={handleScroll} data-testid="atlas-transcript-log">
          {count === 0 ? (
            <p className="atlas-transcript__empty">No turns yet this session.</p>
          ) : (
            lines.map((line, i) => <TranscriptRow key={i} line={line} />)
          )}
        </div>
        {frozen && newCount > 0 ? (
          <button type="button" className="atlas-transcript__newpill" onClick={jumpToLive}>
            {newCount} new ↓
          </button>
        ) : null}
      </div>
    </section>
  );
}

/** One past session from the ledger — a <details> row expanding to its turns. */
function HistorySession({ session }: { session: HistoryEntry }): React.JSX.Element {
  return (
    <details className="atlas-history__session">
      <summary className="atlas-history__summary">
        <span className="atlas-history__date mc-mono">{session.date || '—'}</span>
        <span className="atlas-history__sid mc-mono">{session.sessionId}</span>
        <span className="atlas-history__count mc-mono">{session.lines.length} turns</span>
      </summary>
      <div className="atlas-history__lines">
        {session.lines.length === 0 ? (
          <p className="atlas-transcript__empty">No turns recorded.</p>
        ) : (
          session.lines.map((line, i) => <TranscriptRow key={i} line={line} />)
        )}
      </div>
    </details>
  );
}

/** The recent-sessions pane (design §5 ledger). Newest-first is already established by the server. */
function ActivityHistory({ history }: { history: HistoryEntry[] }): React.JSX.Element {
  return (
    <section className="atlas-history" aria-label="Atlas activity history">
      <h3 className="atlas-section-title">Activity history</h3>
      {history.length === 0 ? (
        <p className="atlas-transcript__empty">No past sessions on the ledger yet.</p>
      ) : (
        <div className="atlas-history__list">
          {history.map((session) => (
            <HistorySession key={session.file} session={session} />
          ))}
        </div>
      )}
    </section>
  );
}

/** Map a queue card state to the shared semantic status-dot modifier (no decorative hue). */
function cardDotClass(state: string): string {
  const s = state.toLowerCase();
  if (s === 'done' || s === 'approved') return 'mc-status-dot--done';
  if (s === 'working') return 'mc-status-dot--running';
  if (s === 'blocked' || s === 'rejected' || s === 'failed') return 'mc-status-dot--blocked';
  return 'mc-status-dot--idle';
}

/** The cards Atlas has filed and their queue states (design §4). */
function FiledCards({ cards }: { cards: AtlasCard[] }): React.JSX.Element {
  return (
    <section className="atlas-cards" aria-label="Atlas cards">
      <h3 className="atlas-section-title">Cards filed</h3>
      {cards.length === 0 ? (
        <p className="atlas-transcript__empty">No atlas-project cards in the queue.</p>
      ) : (
        <table className="mc-table">
          <thead>
            <tr>
              <th>Card</th>
              <th>Action</th>
              <th>Workflow</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            {cards.map((card) => (
              <tr key={card.id} data-testid={`atlas-card-${card.id}`}>
                <td className="mc-mono">{card.id}</td>
                <td>{card.action || '—'}</td>
                <td className="mc-mono">{card.workflow ?? '—'}</td>
                <td>
                  <span className="atlas-cards__state">
                    <span className={`mc-status-dot ${cardDotClass(card.state)}`} aria-hidden="true" />
                    {card.state || '—'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export function Atlas(): React.JSX.Element {
  const { worker, history, cards, loading } = useAtlasState();
  // A tick so the OFFLINE "last seen <age>" advances between panel fetches. Cheap, view-local.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const state = worker.state;
  const caption = loading ? 'connecting to worker…' : STATE_CAPTION[state];

  return (
    <section className="v-atlas" aria-label="Atlas view">
      <div className="v-atlas__header">
        <h2 className="v-atlas__title">Atlas</h2>
        <span className="v-atlas__note">
          The desk voice worker, mirrored read-only. {worker.voice ? <>Voice <span className="mc-mono">{worker.voice}</span>.</> : null}
        </span>
      </div>

      <div className="v-atlas__stage">
        <Orb state={state} />
        <div className="v-atlas__stateword" data-testid="atlas-stateword" data-state={state}>
          <span className="v-atlas__stateword-label">{state}</span>
          <span className="v-atlas__stateword-caption">{caption}</span>
          {state === 'OFFLINE' && !loading ? (
            <span className="v-atlas__lastseen mc-mono">last seen {formatAge(worker.heartbeat, now)}</span>
          ) : null}
        </div>
      </div>

      <div className="v-atlas__panes">
        <LiveTranscript lines={worker.transcript} />
        <div className="v-atlas__side">
          <FiledCards cards={cards} />
          <ActivityHistory history={history} />
        </div>
      </div>
    </section>
  );
}
