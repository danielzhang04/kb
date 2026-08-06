/**
 * Flight Recorder panel (D3.5) — a read-only index of committed distilled trace permalinks.
 *
 * Each completed card links to its STABLE `traces/<card-id>/` permalink: the directory the D0.8 trace
 * pipeline (`server/trace/`) commits an offline-openable `index.html` into. This panel does not fetch or
 * render transcript bytes — it is purely a link index over the Plane-A card projection, so it stays out of
 * the client→server node-import graph (see `src/lib/clientImportGraph.test.ts`); the permalink shape is a
 * pure string helper here, matching `server/trace/render.ts`'s `tracePath`.
 *
 * Accepts `cardIds` directly (tests / an already-loaded parent) or self-fetches `/api/index` and lists the
 * completed (`done`) cards. Read-only, empty-safe.
 */
import { useEffect, useState } from 'react';
import type { PlaneAIndex } from '../../../server/planeA/indexer';
import '../../styles/views/panels.css';

/** The stable committed-trace permalink for a card: `traces/<card-id>/` (serves the distilled index.html).
 *  The id is percent-encoded so a card id carrying `../` or other URL metacharacters cannot escape `traces/`. */
export function tracePermalink(cardId: string): string {
  return `traces/${encodeURIComponent(cardId)}/`;
}

/** Derive the completed-card ids from a Plane-A snapshot (the cards that carry a committed trace). */
function doneCardIds(index: PlaneAIndex): string[] {
  const done = index.cards?.done ?? [];
  return done
    .map((c) => (typeof c.meta?.id === 'string' ? c.meta.id : ''))
    .filter((id): id is string => id !== '');
}

export function FlightRecorder({ cardIds }: { cardIds?: string[] } = {}): React.JSX.Element {
  const [fetched, setFetched] = useState<string[] | null>(null);

  useEffect(() => {
    if (cardIds) return;
    let cancelled = false;
    fetch('/api/index')
      .then((r) => r.json() as Promise<PlaneAIndex>)
      .then((d) => {
        if (!cancelled) setFetched(doneCardIds(d));
      })
      .catch(() => {
        /* read-only view: on failure keep the empty-safe scaffold, never crash the shell */
      });
    return () => {
      cancelled = true;
    };
  }, [cardIds]);

  const ids = cardIds ?? fetched ?? [];

  return (
    <div className="v-panel v-panel--recorder" aria-label="Flight Recorder panel">
      <div className="v-panel__header">
        <h2 className="v-panel__title">Flight Recorder</h2>
        <span className="v-panel__note">
          Committed distilled trace permalinks. Each link opens the offline-openable
          <code className="mc-mono"> traces/&lt;card-id&gt;/</code> render.
        </span>
      </div>

      {ids.length === 0 ? (
        <p className="mc-empty">No committed traces recorded yet.</p>
      ) : (
        <table className="mc-table">
          <thead>
            <tr>
              <th>Card</th>
              <th>Permalink</th>
            </tr>
          </thead>
          <tbody>
            {ids.map((id) => (
              <tr key={id} data-testid={`trace-row-${id}`}>
                <td className="mc-mono">{id}</td>
                <td>
                  <a className="v-panel__link mc-mono" href={`/${tracePermalink(id)}`}>
                    /{tracePermalink(id)}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
