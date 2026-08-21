import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchInbox, type FetchLike, type InboxResponse } from '../lib/inboxClient.ts';
import { createInboxRefresher } from '../lib/inboxRefresher.ts';
import { useSse, type SseFactory } from '../lib/sseClient.ts';
import type { NavTarget } from '../nav/stack.ts';
import { humanizeEntityId } from '../entity/humanizeEntityId.ts';
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
  const { count } = useSse('/events', sseFactory);
  const previousCount = useRef(count);
  const refresher = useMemo(() => createInboxRefresher({
    load: () => fetchInbox(fetchImpl),
    onSuccess: (next) => {
      setSnapshot(next);
      setError(null);
    },
    onFailure: () => setError('Could not refresh Inbox.'),
    onSettled: () => setLoading(false),
  }), [fetchImpl]);

  useEffect(() => {
    refresher.trigger();
    return () => refresher.dispose();
  }, [refresher]);

  useEffect(() => {
    if (count === previousCount.current) return;
    previousCount.current = count;
    refresher.trigger();
  }, [count, refresher]);

  if (loading && snapshot === null) return <p className="inbox__loading" role="status">Loading Inbox…</p>;
  if (snapshot === null) return <p className="inbox__error" role="alert">{error ?? 'Could not refresh Inbox.'}</p>;

  return (
    <section className="inbox" aria-label="Inbox">
      {error ? <p className="inbox__error" role="alert">{error}</p> : null}
      {snapshot.items.length === 0 ? <p className="inbox__empty">Nothing needs you</p> : (
        <ul className="inbox__list">
          {snapshot.items.map((item) => (
            <li className="inbox__row" key={item.id} data-raw-id={item.title}>
              <div>
                <p className="inbox__title" title={item.title}>{humanizeEntityId(item.title)}</p>
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
