import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchInbox, type FetchLike, type InboxResponse } from '../lib/inboxClient.ts';
import { useSse, type SseFactory } from '../lib/sseClient.ts';
import type { NavTarget } from '../nav/stack.ts';
import '../styles/views/inbox.css';

export interface InboxProps {
  fetchImpl?: FetchLike;
  sseFactory?: SseFactory;
  onNavigate?: (target: NavTarget) => void;
}

export function Inbox({ fetchImpl, sseFactory, onNavigate }: InboxProps): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<InboxResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const trailing = useRef(false);
  const mounted = useRef(true);
  const { count } = useSse('/events', sseFactory);
  const previousCount = useRef(count);

  const refresh = useCallback((): void => {
    if (inFlight.current) {
      trailing.current = true;
      return;
    }
    inFlight.current = true;
    void fetchInbox(fetchImpl)
      .then((next) => {
        if (!mounted.current) return;
        setSnapshot(next);
        setError(null);
      })
      .catch(() => {
        if (mounted.current) setError('Could not refresh Inbox.');
      })
      .finally(() => {
        inFlight.current = false;
        if (!mounted.current) return;
        setLoading(false);
        if (trailing.current) {
          trailing.current = false;
          refresh();
        }
      });
  }, [fetchImpl]);

  useEffect(() => {
    mounted.current = true;
    refresh();
    return () => { mounted.current = false; };
  }, [refresh]);

  useEffect(() => {
    if (count === previousCount.current) return;
    previousCount.current = count;
    refresh();
  }, [count, refresh]);

  if (loading && snapshot === null) return <p className="inbox__loading" role="status">Loading Inbox…</p>;
  if (snapshot === null) return <p className="inbox__error" role="alert">{error ?? 'Could not refresh Inbox.'}</p>;

  return (
    <section className="inbox" aria-label="Inbox">
      {error ? <p className="inbox__error" role="alert">{error}</p> : null}
      {snapshot.items.length === 0 ? <p className="inbox__empty">Nothing needs you</p> : (
        <ul className="inbox__list">
          {snapshot.items.map((item) => (
            <li className="inbox__row" key={item.id}>
              <div>
                <p className="inbox__title">{item.title}</p>
                <p className="inbox__reason">{item.reason}</p>
              </div>
              <button type="button" onClick={() => onNavigate?.({ view: 'tasks', focus: { kind: 'card', id: item.subject.cardId } })}>Open card</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
