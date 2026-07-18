import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { TimelineModel } from '../lib/timelineModel';
import type { Session } from '../lib/authClient';
import { Timeline } from '../views/Timeline';
import { defaultComposerStream, getComposerSession } from './workspaceClient';
import type { ComposerSession, ComposerStreamFn } from './workspaceClient';

export interface ComposerChatProps {
  composerSession?: ComposerSession;
  sessionToken?: string;
  onRequestSession?: () => Promise<Session | null>;
  onSessionChange?: (session: ComposerSession) => void;
  onRunningChange?: (running: boolean) => void;
  stream?: ComposerStreamFn;
}

type Status = 'idle' | 'running' | 'stopped' | 'error';

const FALLBACK_SESSION: ComposerSession = {
  composerRef: 'local-preview',
  title: 'New idea',
  state: 'open',
  createdAt: '',
  updatedAt: '',
  sourceComposerRef: null,
  turns: [],
};

function LiveAssistant({ model }: { model: TimelineModel }): React.JSX.Element {
  const text = model.turns.flatMap((turn) => turn.steps)
    .filter((step) => step.kind === 'text')
    .map((step) => step.kind === 'text' ? step.text : '')
    .filter(Boolean);
  const operations = model.turns.flatMap((turn) => turn.steps).filter((step) => step.kind !== 'text').length;
  return (
    <div className="composer-chat__assistant">
      {text.map((part, index) => <p key={index}>{part}</p>)}
      {operations > 0 || text.length === 0 ? (
        <details className="composer-chat__operations" open={text.length === 0}>
          <summary>{operations > 0 ? `${operations} operational step${operations === 1 ? '' : 's'}` : 'Working'}</summary>
          <Timeline model={model} />
        </details>
      ) : null}
    </div>
  );
}

/** Workspace-scoped operational chat. Its component stays mounted while its tab is open. */
export function ComposerChat({
  composerSession = FALLBACK_SESSION,
  sessionToken,
  onRequestSession,
  onSessionChange,
  onRunningChange,
  stream = defaultComposerStream,
}: ComposerChatProps): React.JSX.Element {
  const [prompt, setPrompt] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [localToken, setLocalToken] = useState<string | undefined>(sessionToken);
  const [signingIn, setSigningIn] = useState(false);
  const [livePrompt, setLivePrompt] = useState<string | null>(null);
  const [liveModel, setLiveModel] = useState<TimelineModel | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const runningObserverRef = useRef(onRunningChange);

  useEffect(() => {
    if (sessionToken) setLocalToken(sessionToken);
  }, [sessionToken]);

  useEffect(() => { runningObserverRef.current = onRunningChange; }, [onRunningChange]);

  useEffect(() => {
    runningObserverRef.current?.(status === 'running');
  }, [status]);

  useEffect(() => () => runningObserverRef.current?.(false), []);

  // A closed workspace tab may unmount this pane. Switching tabs or navigating never does, so independent
  // active turns continue. An actual unmount still releases the request instead of orphaning it.
  useEffect(() => () => abortRef.current?.abort(), []);

  const token = sessionToken ?? localToken;
  const historicalTurns = useMemo(() => composerSession.turns, [composerSession.turns]);

  const resolveToken = useCallback(async (): Promise<string | undefined> => {
    if (token) return token;
    if (!onRequestSession || signingIn) return undefined;
    setSigningIn(true);
    setError(null);
    try {
      const next = await onRequestSession();
      if (!next) {
        setError('passkey sign-in failed — no session was created');
        return undefined;
      }
      setLocalToken(next.token);
      return next.token;
    } catch {
      setError('passkey sign-in failed — no session was created');
      return undefined;
    } finally {
      setSigningIn(false);
    }
  }, [onRequestSession, signingIn, token]);

  const refresh = useCallback(async (activeToken: string): Promise<void> => {
    if (!onSessionChange || composerSession.composerRef === FALLBACK_SESSION.composerRef) return;
    try {
      onSessionChange(await getComposerSession(composerSession.composerRef, activeToken));
    } catch {
      // The live turn remains visible; a later workspace refresh can reconcile server history.
    }
  }, [composerSession.composerRef, onSessionChange]);

  const onSubmit = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    if (status === 'running' || !prompt.trim()) return;
    const activeToken = await resolveToken();
    if (!activeToken) return;

    const sentPrompt = prompt.trim();
    setPrompt('');
    setLivePrompt(sentPrompt);
    setLiveModel(null);
    setStatus('running');
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    const outcome = await stream(
      composerSession.composerRef,
      sentPrompt,
      activeToken,
      setLiveModel,
      controller.signal,
    );
    const stopped = controller.signal.aborted;
    abortRef.current = null;
    await refresh(activeToken);
    if (stopped) {
      setStatus('stopped');
      return;
    }
    if (!outcome.ok) {
      setStatus('error');
      setError(outcome.reason ?? `refused${outcome.status ? ` (${outcome.status})` : ''}`);
      return;
    }
    setStatus('idle');
    setLivePrompt(null);
    setLiveModel(null);
  }, [composerSession.composerRef, prompt, refresh, resolveToken, status, stream]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setStatus('stopped');
  }, []);

  return (
    <section className="composer-chat" aria-label="Composer chat">
      <div className="composer-chat__timeline" aria-label="Conversation history">
        {historicalTurns.length === 0 && !livePrompt ? (
          <div className="composer-chat__empty">
            <h3>What do you want to accomplish?</h3>
            <p>Explore the idea here. Composer can inspect the kb, ask questions, and help shape an executable plan.</p>
          </div>
        ) : null}
        {historicalTurns.map((turn) => (
          <article key={turn.turnId} className="composer-chat__exchange">
            <div className="composer-chat__user"><span>You</span><p>{turn.prompt}</p></div>
            <div className="composer-chat__assistant composer-chat__assistant--history">
              <span>Composer</span>
              {turn.model ? <LiveAssistant model={turn.model} /> : (
                <p>{turn.error ? turn.error : turn.state === 'complete' ? 'Completed response' : turn.state}</p>
              )}
            </div>
          </article>
        ))}
        {livePrompt ? (
          <article className="composer-chat__exchange" data-testid="composer-live-turn">
            <div className="composer-chat__user"><span>You</span><p>{livePrompt}</p></div>
            {liveModel ? <LiveAssistant model={liveModel} /> : <p className="composer-chat__working">Composer is working…</p>}
          </article>
        ) : null}
      </div>

      <form className="composer-chat__input" aria-label="Composer prompt" onSubmit={(event) => void onSubmit(event)}>
        <textarea
          aria-label="Prompt"
          value={prompt}
          placeholder="Describe what you want to research, build, or change…"
          onChange={(event) => setPrompt(event.target.value)}
          disabled={status === 'running'}
        />
        <button
          type={status === 'running' ? 'button' : 'submit'}
          className="mc-btn mc-btn--primary composer-chat__primary"
          disabled={status !== 'running' && (!prompt.trim() || signingIn)}
          onClick={status === 'running' ? stop : undefined}
        >
          {status === 'running' ? 'Stop' : signingIn ? 'Unlocking…' : 'Send'}
        </button>
      </form>
      <p className="composer-chat__safety-note">Do not paste passwords, API keys, private keys, or access tokens.</p>
      {status === 'stopped' ? <p data-testid="composer-status" role="status">Stopped.</p> : null}
      {error ? <p data-testid="composer-status" role="alert">{error}</p> : null}
    </section>
  );
}
