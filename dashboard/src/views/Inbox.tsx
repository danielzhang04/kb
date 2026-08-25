// P4 W6.1: the Inbox view, cut over ATOMICALLY to the PR + escalation + source-health contract. Each PR
// exposes exactly ONE action — "Open PR", explicitly labelled external, following the server-constructed
// URL to the pinned PR (`design:264`); each escalation exposes "Open card". No lifecycle, read-state, or
// deferral controls exist here (no merge, no run) — the surface is links only. A failed source shows a
// source-specific retry row and never empties the healthy half; "Nothing needs you" appears only when
// both sources are freshly verified and empty.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchInbox, type FetchLike, type InboxResponse, type InboxSourceKind, type SourceState,
} from '../lib/inboxClient.ts';
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

const SOURCE_LABEL: Record<InboxSourceKind, string> = { pr: 'Pull requests', escalation: 'Escalations' };
/** Fixed browser copy per closed error code — never raw stderr (section 3.3). */
const ERROR_COPY: Record<string, string> = {
  unavailable: 'the source is unavailable',
  timeout: 'the source timed out',
  overflow: 'the source returned too many rows',
  invalid: 'the source returned an unreadable response',
};

function SourceHealthRow({ kind, state, onRetry }: {
  kind: InboxSourceKind;
  state: SourceState;
  onRetry: (kind: InboxSourceKind) => void;
}): React.JSX.Element {
  const copy = ERROR_COPY[state.status === 'failed' ? state.errorCode : 'unavailable'] ?? 'the source is unavailable';
  return (
    <li className="inbox__source-health" data-testid={`inbox-source-${kind}`}>
      <p className="inbox__source-reason" role="status">
        {SOURCE_LABEL[kind]}: {copy}. Showing the last verified items{state.stale ? ' (stale)' : ''}.
      </p>
      <button type="button" className="inbox__retry" onClick={() => onRetry(kind)} aria-label={`Retry ${SOURCE_LABEL[kind]}`}>
        Retry
      </button>
    </li>
  );
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

  // SSE invalidation: a PR/card/run/STOP source revision bumps the event count; re-read on every change.
  useEffect(() => {
    if (count === previousCount.current) return;
    previousCount.current = count;
    refresher.trigger();
  }, [count, refresher]);

  const retrySource = useCallback((kind: InboxSourceKind) => {
    void fetchInbox(fetchImpl, kind)
      .then((next) => { setSnapshot(next); setError(null); })
      .catch(() => setError('Could not refresh Inbox.'));
  }, [fetchImpl]);

  if (loading && snapshot === null) return <p className="inbox__loading" role="status">Loading Inbox…</p>;
  if (snapshot === null) return <p className="inbox__error" role="alert">{error ?? 'Could not refresh Inbox.'}</p>;

  const failedSources = (['pr', 'escalation'] as const).filter((kind) => snapshot.sources[kind].status === 'failed');
  const bothVerifiedEmpty = snapshot.items.length === 0 && failedSources.length === 0;

  return (
    <section className="inbox" aria-label="Inbox">
      {error ? <p className="inbox__error" role="alert">{error}</p> : null}
      {failedSources.length > 0 ? (
        <ul className="inbox__sources">
          {failedSources.map((kind) => (
            <SourceHealthRow key={kind} kind={kind} state={snapshot.sources[kind]} onRetry={retrySource} />
          ))}
        </ul>
      ) : null}
      {bothVerifiedEmpty ? <p className="inbox__empty">Nothing needs you</p> : (
        <ul className="inbox__list">
          {snapshot.items.map((item) => (
            <li className="inbox__row" key={item.id}>
              <div>
                <p className="inbox__title" title={item.title}>{humanizeEntityId(item.title)}</p>
                <p className="inbox__reason">{item.kind === 'pr' ? `${item.subject.owner}/${item.subject.repo}#${item.subject.number}` : item.reason}</p>
              </div>
              {item.kind === 'pr' ? (
                <a
                  className="inbox__action inbox__action--external"
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer external"
                  aria-label={`Open PR #${item.subject.number} on GitHub (opens externally in a new tab)`}
                >
                  Open PR <span className="inbox__external-label">(external)</span>
                </a>
              ) : (
                <button type="button" className="inbox__action" onClick={() => onNavigate?.({ view: 'tasks', focus: { kind: 'card', id: item.subject.cardId } })}>
                  Open card
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
