/**
 * C1 — the Composer multi-turn chat pane. This is the working chat surface the [+ New] → Idea entry
 * mounts; the full convergence UI (type chip, draft preview) is C3, which extends this. It reuses the
 * shared `Timeline` fold/render path (same component the Vibe view and the live tail render through) and
 * threads the CLI session id across turns: the `resumeId` returned by turn N is fed into turn N+1, so the
 * conversation continues through the governed `--resume` spawn path.
 *
 * `stream` is injected (mirrors `Vibe.tsx`'s DI) so tests drive the pane through a fake stream — it never
 * spawns anything itself: it only POSTs to the governed `/api/composer/turn` endpoint, which owns the
 * preamble/session/rate-limit/audit gate chain. Session-gated end to end: no token, no send.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { TimelineModel } from '../lib/timelineModel';
import type { Session } from '../lib/authClient';
import { Timeline } from '../views/Timeline';
import { defaultComposerStream } from './chatClient';
import type { ComposerStreamFn } from './chatClient';

export interface ComposerChatProps {
  sessionToken?: string;
  /** Point-of-action passkey mint. The parent owns the durable session state; Composer keeps the returned
   *  token locally too so the operator can send immediately without losing the prompt while React rerenders. */
  onRequestSession?: () => Promise<Session | null>;
  stream?: ComposerStreamFn;
}

type Status = 'idle' | 'running' | 'stopped' | 'error';

const EMPTY: TimelineModel = { turns: [] };

/** The Composer chat pane: session-gated per-turn prompt in, a stack of live folded timelines out, with
 *  the CLI session id threaded across turns for `--resume` continuity. */
export function ComposerChat({
  sessionToken,
  onRequestSession,
  stream = defaultComposerStream,
}: ComposerChatProps): React.JSX.Element {
  const [prompt, setPrompt] = useState('');
  // One folded model per turn — the conversation renders as a stack of shared Timeline views.
  const [turns, setTurns] = useState<TimelineModel[]>([]);
  const [resumeId, setResumeId] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [localToken, setLocalToken] = useState<string | undefined>(sessionToken);
  const [signingIn, setSigningIn] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  // Monotonic turn index, kept in a ref so the async onDelta closure targets the right slot regardless of
  // React batching (the array and this counter start at 0 and advance together).
  const turnCountRef = useRef(0);

  useEffect(() => {
    if (sessionToken) setLocalToken(sessionToken);
  }, [sessionToken]);

  // Leaving Composer must abort the HTTP stream. The server binds request abort to child termination, so
  // an abandoned tab cannot leave a planning process running after this component is gone.
  useEffect(() => () => abortRef.current?.abort(), []);

  const token = sessionToken ?? localToken;

  const requestSession = useCallback(async (): Promise<void> => {
    if (!onRequestSession || signingIn) return;
    setSigningIn(true);
    setError(null);
    try {
      const session = await onRequestSession();
      if (session) setLocalToken(session.token);
      else setError('passkey sign-in failed — no session was created');
    } catch {
      setError('passkey sign-in failed — no session was created');
    } finally {
      setSigningIn(false);
    }
  }, [onRequestSession, signingIn]);

  const onSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!token || status === 'running' || prompt.trim() === '') return;
      setStatus('running');
      setError(null);

      const turnIndex = turnCountRef.current;
      turnCountRef.current += 1;
      setTurns((prev) => [...prev, EMPTY]);

      const controller = new AbortController();
      abortRef.current = controller;
      const onDelta = (model: TimelineModel): void =>
        setTurns((prev) => {
          const next = prev.slice();
          next[turnIndex] = model;
          return next;
        });

      const outcome = await stream(prompt.trim(), resumeId, token, onDelta, controller.signal);

      const wasStopped = controller.signal.aborted;
      abortRef.current = null;
      if (wasStopped) return; // Stop already set status to 'stopped'; don't clobber it.
      if (outcome.ok) {
        if (outcome.resumeId) setResumeId(outcome.resumeId);
        setPrompt(''); // clear for the next turn
        setStatus('idle');
      } else {
        setStatus('error');
        setError(outcome.reason ?? `refused${outcome.status ? ` (${outcome.status})` : ''}`);
      }
    },
    [prompt, resumeId, token, status, stream],
  );

  const onStop = useCallback(() => {
    abortRef.current?.abort();
    setStatus('stopped');
  }, []);

  return (
    <section className="composer-chat" aria-label="Composer chat">
      <p className="composer-chat__warning" role="note">
        Governed planning chat — each turn may inspect the kb with read-only tools. It cannot edit files
        or run shell commands; deployment is a separate explicit action. Turns are session-gated,
        preamble/STOP-gated, rate-limited, and independently audited.
      </p>
      {!token ? (
        <div className="composer-chat__session-warning">
          {onRequestSession ? (
            <button type="button" className="mc-btn mc-btn--primary" onClick={() => void requestSession()} disabled={signingIn}>
              {signingIn ? 'Signing in…' : 'Sign in with your passkey'}
            </button>
          ) : (
            <>Sign in with your passkey to use Composer.</>
          )}
        </div>
      ) : null}
      <div className="composer-chat__timeline">
        {turns.map((model, i) => (
          <Timeline key={i} model={model} />
        ))}
      </div>
      <form aria-label="Composer prompt" onSubmit={(e) => void onSubmit(e)}>
        <textarea
          aria-label="Prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={status === 'running'}
        />
        <button type="submit" disabled={!token || status === 'running' || prompt.trim() === ''}>
          {status === 'running' ? 'Running…' : 'Send'}
        </button>
        <button type="button" onClick={onStop} disabled={status !== 'running'}>
          Stop
        </button>
      </form>
      {status === 'stopped' ? (
        <p data-testid="composer-status" role="status">
          stopped
        </p>
      ) : null}
      {error ? (
        <p data-testid="composer-status" role="alert">
          refused: {error}
        </p>
      ) : null}
    </section>
  );
}
