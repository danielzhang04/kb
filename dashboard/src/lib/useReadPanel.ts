/**
 * `useReadPanel` (U12) — the one read effect every read-only Agent Platform panel was writing by hand.
 *
 * ── What it replaces ──
 * Six panels each carried the same twenty lines: a `LoadState` union, a `data` slot, a `let cancelled`
 * flag, a `!response.ok` throw, a `.catch` that sets `unavailable`, and a cleanup that flips the flag.
 * Six copies of a cancellation guard is six chances to forget it — and forgetting it is not a visible
 * bug, it is a React warning and a state write into an unmounted tree, which is exactly the class of
 * defect that survives review.
 *
 * ── The contract ──
 * ONE GET, no retry, no polling, no cache. A failure of ANY kind — network down, non-2xx, unparseable
 * body — lands on `unavailable`, because a read-only panel's honest answer to all three is the same:
 * "this could not be read, and nothing was changed". Panels that need to tell those apart (a 401 lock
 * versus a dead daemon) must decide that BEFORE calling, by passing `null`.
 *
 * ── `null` as the url ──
 * `null` means "there is nothing to read yet", not "read nothing". It issues no request and reports
 * `idle`, which is how a panel gates on a session (locked ⇒ zero fetches) or on a subject the operator
 * has not picked yet. A URL that changes re-reads; the in-flight response for the old URL is dropped.
 */
import { useEffect, useState } from 'react';

/**
 * `idle` — nothing was asked for (a null url). Distinct from `loading` on purpose: a panel that paints
 * its empty state during `idle` would flash "nothing found" before it had asked anything.
 */
export type ReadPanelState = 'idle' | 'loading' | 'ready' | 'unavailable';

export interface ReadPanelResult<T> {
  /** The parsed body of the most recent successful read, or null before/instead of one. */
  data: T | null;
  state: ReadPanelState;
}

/**
 * Read `url` once and report the outcome. Re-reads whenever `url` changes; a `null` url reads nothing.
 *
 * The returned `data` is cleared the moment a new read starts, so a panel can never render the PREVIOUS
 * subject's body under the current subject's heading while the new read is in flight.
 */
export function useReadPanel<T>(url: string | null): ReadPanelResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [state, setState] = useState<ReadPanelState>(url === null ? 'idle' : 'loading');

  useEffect(() => {
    if (url === null) {
      setData(null);
      setState('idle');
      return;
    }
    let cancelled = false;
    setData(null);
    setState('loading');
    void fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`${url} answered ${response.status}`);
        return response.json() as Promise<T>;
      })
      .then((body) => {
        if (cancelled) return;
        setData(body);
        setState('ready');
      })
      .catch(() => {
        // Read-only surface: name the state, never crash the shell and never invent a body.
        if (!cancelled) setState('unavailable');
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return { data, state };
}
