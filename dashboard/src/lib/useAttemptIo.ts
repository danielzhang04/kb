import { useEffect, useRef, useState } from 'react';
import { invalidateSessionOnGovernedAuthFailure } from './authClient';
import { useSession } from './sessionContext';
import type { UseSseResult } from './sseClient';

export interface AttemptIoLine {
  seq: number;
  t: string;
  dir: 'out' | 'in' | 'meta';
  line: string;
}

async function readAttemptIo(
  request: typeof fetch,
  runRef: string,
  attemptRef: string,
  after: number,
  token: string,
): Promise<AttemptIoLine[]> {
  const response = await request(`/api/control/runs/${runRef}/attempts/${attemptRef}/io?after=${after}`, {
    method: 'GET',
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
  });
  if (response.status === 401) {
    try {
      await invalidateSessionOnGovernedAuthFailure(response.clone());
    } catch {
      // A broken fetch shim must not replace the endpoint's real refusal with a clone exception.
    }
  }
  if (!response.ok) throw new Error('attempt-io catch-up failed');
  const body = await response.json() as { entries?: AttemptIoLine[] };
  return body.entries ?? [];
}

export function useAttemptIo(options: {
  runRef: string;
  attemptRef: string | null;
  sse: UseSseResult;
  fetcher?: typeof fetch;
  maxLines?: number;
}): { lines: AttemptIoLine[]; live: boolean } {
  const { runRef, attemptRef, sse, fetcher, maxLines = 200 } = options;
  const { session } = useSession();
  const [lines, setLines] = useState<AttemptIoLine[]>([]);
  const [live, setLive] = useState(false);
  const lastSeen = useRef(0);
  const fetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const keep = (entries: AttemptIoLine[]): void => {
    const fresh = entries.filter((entry) => entry.seq > lastSeen.current);
    if (fresh.length === 0) return;
    lastSeen.current = fresh[fresh.length - 1].seq;
    setLines((current) => [...current, ...fresh].slice(-maxLines));
  };

  useEffect(() => {
    lastSeen.current = 0;
    setLines([]);
    setLive(false);
    if (fetchTimer.current) clearTimeout(fetchTimer.current);
    fetchTimer.current = null;
    if (liveTimer.current) clearTimeout(liveTimer.current);
    liveTimer.current = null;
    if (!attemptRef || !session) return;
    let alive = true;
    const request = fetcher ?? fetch;
    void readAttemptIo(request, runRef, attemptRef, 0, session.token)
      .then((entries) => { if (alive) keep(entries); })
      .catch(() => {
        // A later signal can still trigger a successful session-gated catch-up.
      });
    return () => { alive = false; };
  }, [attemptRef, fetcher, maxLines, runRef, session]);

  useEffect(() => () => {
    if (fetchTimer.current) clearTimeout(fetchTimer.current);
    if (liveTimer.current) clearTimeout(liveTimer.current);
  }, []);

  useEffect(() => {
    const frame = sse.last;
    if (!attemptRef || frame?.channel !== 'control' || frame.kind !== 'attempt-io') return;
    const data = frame.data as { attemptRef?: string; seq?: number } | undefined;
    if (data?.attemptRef !== attemptRef || typeof data.seq !== 'number') return;

    setLive(true);
    if (liveTimer.current) clearTimeout(liveTimer.current);
    liveTimer.current = setTimeout(() => setLive(false), 15_000);
    if (!session || data.seq <= lastSeen.current) return;

    if (fetchTimer.current) clearTimeout(fetchTimer.current);
    fetchTimer.current = setTimeout(() => {
      fetchTimer.current = null;
      const request = fetcher ?? fetch;
      void readAttemptIo(request, runRef, attemptRef, lastSeen.current, session.token)
        .then(keep)
        .catch(() => {
          // The next signal will schedule another catch-up attempt.
        });
    }, 150);
  }, [attemptRef, fetcher, maxLines, runRef, session, sse.last]);

  return { lines, live };
}
