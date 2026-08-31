import { useCallback, useEffect, useState } from 'react';
import type { HomeResponse } from '../../server/home/contracts.ts';
import { runLink } from '../control/entityLinks.ts';
import { D13Home, type D13RetryTarget } from '../home/D13Home.tsx';
import { fetchHome, type HomeFetch } from '../lib/homeClient.ts';
import { useSession } from '../lib/sessionContext.tsx';
import { useSse } from '../lib/sseClient.ts';
import { focusTarget, type NavTarget } from '../nav/stack.ts';
import '../styles/views/home.css';

export interface HomeProps {
  response?: HomeResponse;
  onNavigateTarget?: (target: NavTarget) => void;
  onRetry?: (target: D13RetryTarget) => void;
  fetchImpl?: HomeFetch;
}

/** Live D13 Home. The five section results come only from the registered server projection. */
export function Home({
  response,
  onNavigateTarget,
  onRetry,
  fetchImpl = fetch,
}: HomeProps = {}): React.JSX.Element {
  const { session } = useSession();
  const { count: eventTick } = useSse('/events');
  const [fetched, setFetched] = useState<HomeResponse | null>(null);
  const [error, setError] = useState(false);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    if (response || !session?.token) return;
    let cancelled = false;
    setError(false);
    void fetchHome(session.token, fetchImpl).then((next) => {
      if (!cancelled) setFetched(next);
    }).catch(() => {
      if (!cancelled) setError(true);
    });
    return () => { cancelled = true; };
  }, [eventTick, fetchImpl, response, retryTick, session?.token]);

  const retry = useCallback((target: D13RetryTarget): void => {
    onRetry?.(target);
    if (!response) setRetryTick((value) => value + 1);
  }, [onRetry, response]);

  const home = response ?? fetched;
  if (!home) {
    return (
      <main className="d13-home" aria-label="Home view">
        <h1>Home</h1>
        <p>{error ? 'Home is unavailable.' : 'Loading Home.'}</p>
        {error ? <button type="button" onClick={() => retry('running-now')}>Retry Home</button> : null}
      </main>
    );
  }

  return (
    <D13Home
      response={home}
      onOpenRun={(runRef) => onNavigateTarget?.(runLink(runRef))}
      onOpenAttention={() => onNavigateTarget?.({ view: 'inbox' })}
      onOpenSchedule={(owner) => onNavigateTarget?.(focusTarget({ kind: owner.type, id: owner.id }))}
      onRetry={retry}
    />
  );
}
