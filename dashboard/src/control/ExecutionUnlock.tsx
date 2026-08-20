import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX, ReactNode } from 'react';
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

/** Client representation of the server-owned tailnet arm-at-boot posture. No control call creates it. */
const TAILNET_ARMED_STATE: ExecutionArmingState = {
  posture: {
    state: 'unlocked',
    source: 'tailnet',
    unlockedAt: new Date().toISOString(),
    unlockedBy: 'tailnet',
  },
  pending: false,
  error: null,
  retry: null,
  signedIn: true,
};

/** What the operator is told about the automatic arm. `retry` exists ONLY after a failed attempt. */
export interface ExecutionArmingState {
  /** The authoritative server posture, or null while unknown / unreadable. */
  posture: ExecutionPostureDto | null;
  /** An arm attempt (posture read plus any unlock POST) is in flight for the current session. */
  pending: boolean;
  /** Operator-facing reason the automatic arm failed. Null whenever execution is armed or idle. */
  error: string | null;
  /** Non-null only while `error` is set — a failed arm is the one thing worth a click. */
  retry: (() => void) | null;
  /** Whether a live dashboard session exists at all. Without one there is nothing to arm under. */
  signedIn: boolean;
}

const ExecutionArmingContext = createContext<ExecutionArmingState | null>(null);

type ArmOutcome =
  | { ok: true; posture: ExecutionPostureDto }
  | { ok: false; posture: ExecutionPostureDto | null; error: string };

function requirePosture(value: ExecutionPostureDto): ExecutionPostureDto {
  const parsed = parseExecutionPosture(value);
  // Keep the UI boundary fail-closed even when a test/injected client returns a malformed success.
  if (!parsed) throw new Error('execution state response was invalid');
  return parsed;
}

/**
 * Arm execution for ONE session bearer.
 *
 * Reads the authoritative posture first, and only POSTs the unlock when the latch is genuinely locked —
 * an already-unlocked or injected runtime needs no call at all. Every failure path re-reads the posture
 * before it reports anything, because the interesting refusals here (the 409 a latch raises when it is
 * already armed or unavailable, an env-override arm, a concurrent arm that won the race) all mean
 * "execution is armed", not "arming failed". Only a posture that is still `locked` is a real failure.
 */
async function armExecution(client: ExecutionUnlockClient, token: string): Promise<ArmOutcome> {
  let posture: ExecutionPostureDto;
  try {
    posture = requirePosture(await client.getPosture(token));
  } catch {
    return {
      ok: false,
      posture: null,
      error: 'Execution state could not be loaded. Execution remains unavailable.',
    };
  }
  if (posture.state !== 'locked') return { ok: true, posture };
  try {
    const next = requirePosture(await client.unlock(token));
    if (next.state !== 'unlocked' || next.source !== 'passkey') {
      throw new Error('execution unlock response was not passkey-authorized');
    }
    return { ok: true, posture: next };
  } catch (reason) {
    const settled = await client.getPosture(token)
      .then((value) => parseExecutionPosture(value))
      .catch(() => null);
    if (settled && settled.state !== 'locked') return { ok: true, posture: settled };
    return { ok: false, posture: settled, error: executionUnlockErrorMessage(reason) };
  }
}

/** One arm attempt, tagged with the exact scope that owns it so a stale settle can never be adopted. */
interface Attempt {
  token: string;
  client: ExecutionUnlockClient;
  nonce: number;
  promise: Promise<ArmOutcome>;
}

/**
 * The session→execution bridge: EXACTLY ONE unlock POST per session mint, fired the moment the shared
 * session goes locked→unlocked.
 *
 * Daniel's requirement is that the first unlock unlocks everything he needs — so signing in arms
 * execution, with no second click and (since the route stopped running its own ceremony) no second
 * passkey prompt. Nothing about the server contract moved: the unlock route is still explicit, still
 * bearer-verified, and still writes its T3 audit row per arm. What changed is only who presses it.
 *
 * `enabled` is what keeps this legal AND single-owner. The panel below always calls this hook, and
 * simply passes `false` when a {@link ExecutionArmingProvider} above it already owns the attempt — a
 * conditional hook would be a rules-of-hooks violation, and a second live owner would be a second POST.
 *
 * The in-flight promise lives in a ref keyed by scope, and each effect run JOINS it rather than starting
 * its own. That is what survives React 18 StrictMode, which mounts every effect twice: the second run
 * finds the same attempt and subscribes to it, so the double mount still produces a single request.
 */
function useSessionArmedExecution(client: ExecutionUnlockClient, enabled: boolean): ExecutionArmingState {
  const { session } = useSession();
  const sessionToken = session?.token;
  const attemptRef = useRef<Attempt | null>(null);
  const [nonce, setNonce] = useState(0);
  const [settled, setSettled] = useState<{ attempt: Attempt; outcome: ArmOutcome } | null>(null);

  useEffect(() => {
    if (!enabled || !sessionToken) {
      // Sign-out, expiry, or a governed 401 drops the token: forget the attempt so the NEXT mint arms
      // again from scratch rather than showing the dead session's outcome.
      attemptRef.current = null;
      setSettled(null);
      return;
    }
    const existing = attemptRef.current;
    const attempt: Attempt = existing
      && existing.token === sessionToken && existing.client === client && existing.nonce === nonce
      ? existing
      : { token: sessionToken, client, nonce, promise: armExecution(client, sessionToken) };
    attemptRef.current = attempt;
    let alive = true;
    setSettled(null);
    void attempt.promise.then((outcome) => {
      if (!alive || attemptRef.current !== attempt) return;
      setSettled({ attempt, outcome });
    });
    return () => {
      alive = false;
    };
  }, [enabled, sessionToken, client, nonce]);

  // Resolved against this render's own scope, never against a ref. An outcome belonging to a replaced
  // token/client/nonce is dropped here, so an abandoned render fails closed to "still working".
  const outcome = settled
    && settled.attempt.token === sessionToken
    && settled.attempt.client === client
    && settled.attempt.nonce === nonce
    ? settled.outcome
    : null;
  const error = outcome && !outcome.ok ? outcome.error : null;

  return useMemo<ExecutionArmingState>(() => ({
    posture: outcome?.posture ?? null,
    pending: enabled && Boolean(sessionToken) && !outcome,
    error,
    retry: error ? () => setNonce((value) => value + 1) : null,
    signedIn: Boolean(sessionToken),
  }), [outcome, error, enabled, sessionToken]);
}

/**
 * The app's single arming owner. Mount it once, directly under `SessionProvider` (see `App.tsx`), so a
 * sign-in arms execution no matter which view is on screen — the Home panel is a STATUS readout and is
 * unmounted most of the time, so owning the attempt there would silently skip arming for anyone who
 * signs in from the topbar chip while looking at Terminal, Workflows, or anything else.
 */
export function ExecutionArmingProvider({
  client = defaultClient,
  children,
}: {
  client?: ExecutionUnlockClient;
  children: ReactNode;
}): JSX.Element {
  const { mode } = useSession();
  const sessionArming = useSessionArmedExecution(client, mode === 'win32-desktop');
  const arming = mode === 'tailnet' ? TAILNET_ARMED_STATE : sessionArming;
  return <ExecutionArmingContext.Provider value={arming}>{children}</ExecutionArmingContext.Provider>;
}

/** Read the shared arming state, or null when rendered outside {@link ExecutionArmingProvider}. */
export function useExecutionArming(): ExecutionArmingState | null {
  return useContext(ExecutionArmingContext);
}

/**
 * The execution posture panel — a STATUS readout, not a control.
 *
 * There is ONE ceremony and ONE click for the whole platform: the shared dashboard sign-in. This panel
 * used to raise a second biometric prompt; that went when the unlock route dropped its own ceremony.
 * Now the remaining CLICK is gone too — {@link ExecutionArmingProvider} arms execution off the session
 * mint, and this panel reports the result. Arming stays explicit and audited ON THE SERVER (one governed,
 * bearer-verified, T3-audited POST per arm); it just is not the operator's chore any more.
 *
 * The one affordance left is a RETRY, and only when an arm actually failed — a button that appears when
 * there is nothing to fix is how the second click grew back last time.
 */
export function ExecutionUnlock({
  client = defaultClient,
  onPostureChange,
}: {
  client?: ExecutionUnlockClient;
  onPostureChange?: (posture: ExecutionPostureDto | null) => void;
}): JSX.Element {
  const { mode } = useSession();
  const hosted = useExecutionArming();
  // Always called; inert whenever a provider above already owns the attempt (see the hook's doc).
  const local = useSessionArmedExecution(client, hosted === null && mode === 'win32-desktop');
  const arming = hosted ?? (mode === 'tailnet' ? TAILNET_ARMED_STATE : local);
  const { posture, pending, error, retry, signedIn } = arming;

  // Held in a ref so a parent's inline callback cannot restart anything; the effect tracks POSTURE only.
  const postureListener = useRef(onPostureChange);
  postureListener.current = onPostureChange;
  useEffect(() => {
    postureListener.current?.(posture);
  }, [posture]);

  const label = pending
    ? 'Arming execution…'
    : posture?.state === 'unlocked'
      ? `Execution armed · ${posture.source ?? 'unknown source'}`
      : posture?.state === 'injected'
        ? 'Execution supplied by an injected runtime'
        : 'Execution locked';

  return (
    <section className="v-home__execution mc-panel" aria-label="Execution state" data-testid="execution-unlock">
      <div className="v-home__execution-head">
        <div>
          <span className="v-home__eyebrow">Execution</span>
          <p className="v-home__execution-state">{label}</p>
        </div>
        {retry ? (
          <button
            type="button"
            className="mc-btn mc-btn--primary"
            data-testid="execution-arm-retry"
            onClick={retry}
          >
            Retry arming
          </button>
        ) : null}
      </div>
      <p className="v-home__execution-help">
        {mode === 'tailnet'
          ? 'Execution is armed by the tailnet deployment at server boot.'
          : signedIn
          ? 'Execution arms with your sign-in. The dashboard makes that governed, audited call for you — no second prompt, no second click.'
          : 'Execution arms with your sign-in. Unlock this tab and execution arms with it.'}
      </p>
      {error ? <p className="v-home__execution-error" role="alert">{error}</p> : null}
    </section>
  );
}
