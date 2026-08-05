/**
 * LaunchControls — the single governed Launch/Rerun write surface (D2.6), extracted at U3 so it lives
 * in EXACTLY one place. Both actions are governed (preamble + WebAuthn session gated server-side by
 * `server/write/launch.ts`); this component is a thin POSTing form and NEVER writes `queue/` itself.
 * Unlock is point-of-action through the shared session context: a submit on a locked tab runs the ONE
 * passkey ceremony first and fails closed (no fetch, a plain no-session status) if it is refused.
 *
 * Two hosts render it with different chrome — Control's dense board pane and Home's rollup panel — so a
 * `variant` selects the class/testid set while the endpoints, aria-labels, field set, and fail-closed
 * behaviour stay identical across both (Control.test.tsx and Home.test.tsx both assert against them).
 */
import { useState } from 'react';
import type { FormEvent } from 'react';
import { invalidateSessionOnGovernedAuthFailure } from '../lib/authClient';
import { useSession } from '../lib/sessionContext';

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

/** C7.7 — one selectable owner for the launch picker. `runnerBound` drives the honest inline warning. */
export interface OwnerOption {
  id: string;
  runnerBound: boolean;
}

export function LaunchControls({
  variant = 'control',
  owners = [],
  executionReady = true,
}: {
  variant?: Variant;
  /** Home only — Launch/Rerun stay disabled until EXECUTION is unlocked by its OWN purpose-bound
   *  passkey check (see `control/ExecutionUnlock`). Unrelated to the dashboard session, which every
   *  tab can now mint at point of action. */
  executionReady?: boolean;
  /** C7.7 — the closed set of assignable owners (declared agents ∪ registered default_workers), for the
   *  optional owner `<select>`. HONEST PREVIEW ONLY — the server re-validates against the filesystem-
   *  enumerated set and is the authoritative boundary. Empty (default) → blank/unowned is the only choice. */
  owners?: OwnerOption[];
}): React.JSX.Element {
  const c = CHROME[variant];
  const { requireSession } = useSession();

  const [project, setProject] = useState('');
  const [action, setAction] = useState('');
  const [target, setTarget] = useState('');
  const [riskTier, setRiskTier] = useState<'T1' | 'T2' | 'T3'>('T1');
  const [owner, setOwner] = useState('');
  const [body, setBody] = useState('');
  const [launchStatus, setLaunchStatus] = useState<string | null>(null);

  // C7.7 — the selected owner's runner-bound status. `false` (declared, no runner) → an honest inline
  // warning: the card is legitimately PARKED until a runner is bound. Selection is still allowed ("assign
  // now, bind soon"); the server closed-set check — not the warning — gates registration.
  const selectedOwner = owners.find((o) => o.id === owner) ?? null;
  const showUnboundWarning = selectedOwner !== null && !selectedOwner.runnerBound;

  const [rerunCardId, setRerunCardId] = useState('');
  const [feedback, setFeedback] = useState('');
  const [rerunStatus, setRerunStatus] = useState<string | null>(null);

  async function submitLaunch(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!executionReady) {
      setLaunchStatus('execution is locked — unlock execution first');
      return;
    }
    // Fail-closed: a refused ceremony leaves the form untouched and calls no endpoint.
    const token = (await requireSession())?.token;
    if (!token) {
      setLaunchStatus('no session — the dashboard is locked');
      return;
    }
    try {
      // C7.7 — include `owner` ONLY when chosen; a blank owner preserves today's unowned-card launch.
      const payload: Record<string, unknown> = { project, action, target, riskTier, body };
      if (owner) payload.owner = owner;
      const res = await fetch('/api/write/launch', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      await invalidateSessionOnGovernedAuthFailure(res);
      const data = (await res.json()) as {
        cardId?: string;
        reason?: string;
        runner?: { status?: string; detail?: string };
      };
      const pickup = data.runner?.status === 'triggered'
        ? ' · background runner signaled'
        : data.runner
          ? ` · queued (${data.runner.detail ?? data.runner.status})`
          : '';
      setLaunchStatus(res.ok ? `launched ${data.cardId}${pickup}` : `refused: ${data.reason ?? res.status}`);
    } catch {
      setLaunchStatus('launch request failed');
    }
  }

  async function submitRerun(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!executionReady) {
      setRerunStatus('execution is locked — unlock execution first');
      return;
    }
    const token = (await requireSession())?.token;
    if (!token) {
      setRerunStatus('no session — the dashboard is locked');
      return;
    }
    try {
      const res = await fetch('/api/write/rerun', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ cardId: rerunCardId, feedback }),
      });
      await invalidateSessionOnGovernedAuthFailure(res);
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
      {!executionReady ? (
        <p className={cls(c.warning)}>Unlock execution before launching or rerunning cards.</p>
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
        <select
          className={cls(c.input)}
          aria-label="Owner"
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
        >
          <option value="">unowned</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.runnerBound ? o.id : `${o.id} (no runner)`}
            </option>
          ))}
        </select>
        {showUnboundWarning ? (
          <p className={cls(c.warning)} data-testid="owner-unbound-warning" role="alert">
            will not execute until a runner is bound to {owner}
          </p>
        ) : null}
        <textarea
          className={cls(c.input)}
          aria-label="Work order body"
          placeholder="work order"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <button className={cls(c.launchButton)} type="submit" disabled={!executionReady}>
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
        <button className={cls(c.rerunButton)} type="submit" disabled={!executionReady}>
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
