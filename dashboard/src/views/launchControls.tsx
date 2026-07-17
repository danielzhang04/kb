/**
 * LaunchControls — the single governed Launch/Rerun write surface (D2.6), extracted at U3 so it lives
 * in EXACTLY one place. Both actions are governed (preamble + WebAuthn session gated server-side by
 * `server/write/launch.ts`); this component is a thin POSTing form and NEVER writes `queue/` itself.
 * Fail-closed: without a `sessionToken` the buttons are disabled end-to-end and a submit surfaces the
 * sign-in nudge WITHOUT calling fetch.
 *
 * Two hosts render it with different chrome — Control's dense board pane and Home's rollup panel — so a
 * `variant` selects the class/testid set while the endpoints, aria-labels, field set, and fail-closed
 * behaviour stay identical across both (Control.test.tsx and Home.test.tsx both assert against them).
 */
import { useState } from 'react';
import type { FormEvent } from 'react';
import type { Session } from '../lib/authClient';

type Variant = 'control' | 'home';

interface VariantChrome {
  section: string;
  sectionTestId?: string;
  title: string;
  warning: string;
  form: string;
  input: string;
  launchButton: string;
  rerunButton: string;
  status: string;
}

const CHROME: Record<Variant, VariantChrome> = {
  control: {
    section: 'control__pane control__launch',
    title: '',
    warning: 'control__launch-warning',
    form: '',
    input: '',
    launchButton: '',
    rerunButton: '',
    status: '',
  },
  home: {
    section: 'v-home__launch mc-panel',
    sectionTestId: 'home-launch',
    title: 'v-home__panel-title',
    warning: 'v-home__launch-warning',
    form: 'v-home__form',
    input: 'v-home__input',
    launchButton: 'mc-btn mc-btn--primary',
    rerunButton: 'mc-btn',
    status: 'v-home__form-status mc-mono',
  },
};

/** `undefined` for an empty className keeps the DOM identical to the pre-extraction hand-written markup
 *  (React omits a `class` attribute entirely rather than emitting `class=""`). */
function cls(value: string): string | undefined {
  return value === '' ? undefined : value;
}

export function LaunchControls({
  sessionToken,
  variant = 'control',
  onRequestSession,
}: {
  sessionToken?: string;
  variant?: Variant;
  /** U5.1 — point-of-action passkey mint. When supplied (App-wired), the buttons are enabled without a
   *  standing session and a submit runs the WebAuthn ceremony inline instead of gating behind a wall.
   *  Absent (direct component tests / dormant Control) → the fail-closed disabled+nudge behaviour. */
  onRequestSession?: () => Promise<Session | null>;
}): React.JSX.Element {
  const c = CHROME[variant];

  // Resolve a usable bearer: the standing session, else the inline ceremony (if wired), else none.
  async function resolveToken(): Promise<string | undefined> {
    if (sessionToken) return sessionToken;
    if (onRequestSession) return (await onRequestSession())?.token;
    return undefined;
  }
  const canAct = Boolean(sessionToken) || Boolean(onRequestSession);

  const [project, setProject] = useState('');
  const [action, setAction] = useState('');
  const [target, setTarget] = useState('');
  const [riskTier, setRiskTier] = useState<'T1' | 'T2' | 'T3'>('T1');
  const [body, setBody] = useState('');
  const [launchStatus, setLaunchStatus] = useState<string | null>(null);

  const [rerunCardId, setRerunCardId] = useState('');
  const [feedback, setFeedback] = useState('');
  const [rerunStatus, setRerunStatus] = useState<string | null>(null);

  async function submitLaunch(e: FormEvent): Promise<void> {
    e.preventDefault();
    // Fail-closed with no way to mint (no token, no wired ceremony): a synchronous nudge, no fetch.
    if (!canAct) {
      setLaunchStatus('no session — sign in with your passkey first');
      return;
    }
    const token = await resolveToken();
    if (!token) {
      setLaunchStatus('no session — sign in with your passkey first');
      return;
    }
    try {
      const res = await fetch('/api/write/launch', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ project, action, target, riskTier, body }),
      });
      const data = (await res.json()) as { cardId?: string; reason?: string };
      setLaunchStatus(res.ok ? `launched ${data.cardId}` : `refused: ${data.reason ?? res.status}`);
    } catch {
      setLaunchStatus('launch request failed');
    }
  }

  async function submitRerun(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!canAct) {
      setRerunStatus('no session — sign in with your passkey first');
      return;
    }
    const token = await resolveToken();
    if (!token) {
      setRerunStatus('no session — sign in with your passkey first');
      return;
    }
    try {
      const res = await fetch('/api/write/rerun', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ cardId: rerunCardId, feedback }),
      });
      const data = (await res.json()) as { cardId?: string; reason?: string };
      setRerunStatus(
        res.ok ? `filed ${data.cardId} depends-on ${rerunCardId}` : `refused: ${data.reason ?? res.status}`,
      );
    } catch {
      setRerunStatus('rerun request failed');
    }
  }

  return (
    <section className={cls(c.section)} aria-label="Launch and rerun" data-testid={c.sectionTestId}>
      <h2 className={cls(c.title)}>Launch / rerun</h2>
      {!canAct ? (
        <p className={cls(c.warning)}>Sign in with your passkey to launch or rerun cards.</p>
      ) : null}
      <form className={cls(c.form)} aria-label="Launch card" onSubmit={(e) => void submitLaunch(e)}>
        <input
          className={cls(c.input)}
          aria-label="Project"
          placeholder="project"
          value={project}
          onChange={(e) => setProject(e.target.value)}
        />
        <input
          className={cls(c.input)}
          aria-label="Action"
          placeholder="action"
          value={action}
          onChange={(e) => setAction(e.target.value)}
        />
        <input
          className={cls(c.input)}
          aria-label="Target"
          placeholder="target"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        />
        <select
          className={cls(c.input)}
          aria-label="Risk tier"
          value={riskTier}
          onChange={(e) => setRiskTier(e.target.value as 'T1' | 'T2' | 'T3')}
        >
          <option value="T1">T1</option>
          <option value="T2">T2</option>
          <option value="T3">T3</option>
        </select>
        <textarea
          className={cls(c.input)}
          aria-label="Work order body"
          placeholder="work order"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <button className={cls(c.launchButton)} type="submit" disabled={!canAct}>
          Launch
        </button>
      </form>
      {launchStatus ? (
        <p className={cls(c.status)} data-testid="launch-status">
          {launchStatus}
        </p>
      ) : null}

      <form className={cls(c.form)} aria-label="Rerun card" onSubmit={(e) => void submitRerun(e)}>
        <input
          className={cls(c.input)}
          aria-label="Card id to rerun"
          placeholder="card id"
          value={rerunCardId}
          onChange={(e) => setRerunCardId(e.target.value)}
        />
        <textarea
          className={cls(c.input)}
          aria-label="Rerun feedback"
          placeholder="feedback"
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
        />
        <button className={cls(c.rerunButton)} type="submit" disabled={!canAct}>
          Rerun
        </button>
      </form>
      {rerunStatus ? (
        <p className={cls(c.status)} data-testid="rerun-status">
          {rerunStatus}
        </p>
      ) : null}
    </section>
  );
}
