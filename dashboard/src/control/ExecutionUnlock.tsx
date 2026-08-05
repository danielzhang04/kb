import { useEffect, useRef, useState } from 'react';
import { useSession } from '../lib/sessionContext';
import {
  executionUnlockErrorMessage,
  getExecutionPosture,
  parseExecutionPosture,
  unlockExecution,
  type ExecutionPostureDto,
} from './controlClient';

export interface ExecutionUnlockClient {
  getPosture(token: string): Promise<ExecutionPostureDto>;
  unlock(token: string): Promise<ExecutionPostureDto>;
}

const defaultClient: ExecutionUnlockClient = {
  getPosture: (token) => getExecutionPosture(token),
  unlock: (token) => unlockExecution(token),
};

interface Scope {
  sessionToken: string | undefined;
  client: ExecutionUnlockClient;
}

interface ViewState extends Scope {
  posture: ExecutionPostureDto | null;
  loading: boolean;
  unlocking: boolean;
  error: string | null;
}

interface UnlockRequest {
  scope: Scope;
  id: symbol;
}

function emptyView(sessionToken: string | undefined, client: ExecutionUnlockClient): ViewState {
  return { sessionToken, client, posture: null, loading: Boolean(sessionToken), unlocking: false, error: null };
}

/**
 * The execution posture panel.
 *
 * ONE passkey ceremony for the whole platform: the shared sign-in from `sessionContext`. Arming
 * execution is authorized by that same session bearer, so this panel runs NO ceremony of its own — the
 * second biometric prompt it used to raise is gone. What remains is a plain one-click action, kept
 * explicit on purpose: signing in must never silently arm the executor, so the operator still performs
 * a visible "Unlock execution" act. From a locked tab the first click mints the shared session (the one
 * ceremony) and the arming click follows once the posture is known.
 */
export function ExecutionUnlock({
  client = defaultClient,
  onPostureChange,
}: {
  client?: ExecutionUnlockClient;
  onPostureChange?: (posture: ExecutionPostureDto | null) => void;
}): React.JSX.Element {
  const { session, requireSession } = useSession();
  const sessionToken = session?.token;
  const committedScopeRef = useRef<Scope | null>(null);
  const requestRef = useRef<UnlockRequest | null>(null);
  const [view, setView] = useState<ViewState>(() => emptyView(sessionToken, client));
  // View state is immutable-tagged. A new render therefore fails closed without mutating any shared ref,
  // including when React abandons that render before committing it.
  const currentView = view.sessionToken === sessionToken && view.client === client
    ? view
    : emptyView(sessionToken, client);

  useEffect(() => {
    const scope: Scope = { sessionToken, client };
    let alive = true;
    committedScopeRef.current = scope;
    setView(emptyView(sessionToken, client));
    // This callback belongs to this committed token/client effect. It is intentionally captured rather
    // than stored in a render-mutated ref, so an abandoned render cannot replace it.
    onPostureChange?.(null);
    if (sessionToken) {
      client.getPosture(sessionToken)
        .then((next) => {
          if (!alive || committedScopeRef.current !== scope) return;
          const parsed = parseExecutionPosture(next);
          if (!parsed) throw new Error('execution state response was invalid');
          setView({ ...emptyView(sessionToken, client), posture: parsed, loading: false });
          onPostureChange?.(parsed);
        })
        .catch(() => {
          if (!alive || committedScopeRef.current !== scope) return;
          setView({
            ...emptyView(sessionToken, client),
            loading: false,
            error: 'Execution state could not be loaded. Execution remains unavailable.',
          });
          onPostureChange?.(null);
        });
    }
    return () => {
      alive = false;
      if (committedScopeRef.current === scope) committedScopeRef.current = null;
      if (requestRef.current?.scope === scope) requestRef.current = null;
    };
    // `onPostureChange` is captured for the committed token/client scope. Depending on an inline callback
    // would restart the authentication read after every parent posture update.
  }, [sessionToken, client]);

  const requestUnlock = async (): Promise<void> => {
    const scope = committedScopeRef.current;
    if (!sessionToken || !scope || scope.sessionToken !== sessionToken || scope.client !== client) return;
    if (requestRef.current?.scope === scope) return;
    const request: UnlockRequest = { scope, id: Symbol('execution-unlock') };
    requestRef.current = request;
    setView((current) => current.sessionToken === sessionToken && current.client === client
      ? { ...current, unlocking: true, error: null }
      : { ...emptyView(sessionToken, client), loading: false, unlocking: true });
    try {
      const next = await client.unlock(sessionToken);
      if (committedScopeRef.current !== scope || requestRef.current !== request) return;
      const parsed = parseExecutionPosture(next);
      // Keep the UI boundary fail-closed even when a test/injected client returns a malformed success.
      if (parsed?.state !== 'unlocked' || parsed.source !== 'passkey') {
        throw new Error('execution unlock response was not passkey-authorized');
      }
      setView((current) => current.sessionToken === sessionToken && current.client === client
        ? { ...current, posture: parsed }
        : current);
      onPostureChange?.(parsed);
    } catch (reason) {
      if (committedScopeRef.current !== scope || requestRef.current !== request) return;
      setView((current) => current.sessionToken === sessionToken && current.client === client
        ? { ...current, error: executionUnlockErrorMessage(reason) }
        : current);
    } finally {
      if (committedScopeRef.current === scope && requestRef.current === request) {
        requestRef.current = null;
        setView((current) => current.sessionToken === sessionToken && current.client === client
          ? { ...current, unlocking: false }
          : current);
      }
    }
  };

  const handleUnlock = async (): Promise<void> => {
    // A locked tab needs the shared session before the posture can even be read. That sign-in is the
    // ONE passkey ceremony; arming then happens on the next click, once the loaded posture confirms
    // execution is still locked. No second ceremony runs on either click.
    if (!sessionToken) {
      await requireSession();
      return;
    }
    await requestUnlock();
  };

  const label = currentView.loading
    ? 'Checking execution…'
    : currentView.posture?.state === 'unlocked'
      ? `Execution unlocked · ${currentView.posture.source ?? 'unknown source'}`
      : currentView.posture?.state === 'injected'
        ? 'Execution supplied by an injected runtime'
        : 'Execution locked';

  return (
    <section className="v-home__execution mc-panel" aria-label="Execution state" data-testid="execution-unlock">
      <div className="v-home__execution-head">
        <div>
          <span className="v-home__eyebrow">Execution</span>
          <p className="v-home__execution-state">{label}</p>
        </div>
        {!currentView.loading && (!sessionToken || currentView.posture?.state === 'locked') ? (
          <button type="button" className="mc-btn mc-btn--primary" disabled={currentView.unlocking} onClick={() => void handleUnlock()}>
            {currentView.unlocking ? 'Unlocking execution…' : 'Unlock execution'}
          </button>
        ) : null}
      </div>
      <p className="v-home__execution-help">
        Arming execution is authorized by your dashboard sign-in — no second passkey prompt. It stays a
        deliberate act: signing in does not start agents or unlock runs.
      </p>
      {currentView.error ? <p className="v-home__execution-error" role="alert">{currentView.error}</p> : null}
    </section>
  );
}
