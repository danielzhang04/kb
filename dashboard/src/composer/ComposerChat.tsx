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
import { useCallback, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { TimelineModel } from '../lib/timelineModel';
import { Timeline } from '../views/Timeline';
import { defaultComposerStream } from './chatClient';
import type { ComposerStreamFn } from './chatClient';

export interface ComposerChatProps {
  sessionToken?: string;
  stream?: ComposerStreamFn;
}

type Status = 'idle' | 'running' | 'stopped' | 'error';

const EMPTY: TimelineModel = { turns: [] };

/** The Composer chat pane: session-gated per-turn prompt in, a stack of live folded timelines out, with
 *  the CLI session id threaded across turns for `--resume` continuity. */
export function ComposerChat({ sessionToken, stream = defaultComposerStream }: ComposerChatProps): React.JSX.Element {
  const [prompt, setPrompt] = useState('');
  // One folded model per turn — the conversation renders as a stack of shared Timeline views.
  const [turns, setTurns] = useState<TimelineModel[]>([]);
  const [resumeId, setResumeId] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Monotonic turn index, kept in a ref so the async onDelta closure targets the right slot regardless of
  // React batching (the array and this counter start at 0 and advance together).
  const turnCountRef = useRef(0);

  const onSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!sessionToken || status === 'running' || prompt.trim() === '') return;
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

      const outcome = await stream(prompt.trim(), resumeId, sessionToken, onDelta, controller.signal);

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
    [prompt, resumeId, sessionToken, status, stream],
  );

  const onStop = useCallback(() => {
    abortRef.current?.abort();
    setStatus('stopped');
  }, []);

  return (
    <section className="composer-chat" aria-label="Composer chat">
      <p className="composer-chat__warning" role="note">
        Live prompt with fleet reach — each turn spawns a real <code>claude</code> session against the kb
        (RCE-equivalent power). Session-gated, preamble/STOP-gated, rate-limited, and independently audited.
      </p>
      {!sessionToken ? (
        <p className="composer-chat__session-warning">Sign in with your passkey to use Composer.</p>
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
        <button type="submit" disabled={!sessionToken || status === 'running' || prompt.trim() === ''}>
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
