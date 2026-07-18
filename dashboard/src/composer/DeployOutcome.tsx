/**
 * C5 — the governed deploy-outcome wrapper. It owns the deploy() round-trip and the small results strip
 * so App.tsx stays lean and C3's {@link Composer} stays a pure convergence surface (it gains only an
 * optional `renderOutcome` slot — composition, not modification). It:
 *
 *   - wraps Composer, injecting a real onDeploy that calls C4's {@link deploy} with the validated plan +
 *     the WebAuthn session token, and stores the governed outcome;
 *   - renders that outcome as a strip INSIDE the Composer surface (placed right after the Deploy button):
 *     a filed queue-card id (launch), the branch/PR target (save), or a legible refusal (status + reason,
 *     incl. the 409 approval-locked shape);
 *   - lists a multi-file artifact's `followUps` as OFFERED next saves — each with its relpath and a button
 *     that deploys THAT single file via another governed deploy() save. Each is individually governed and
 *     fired only on click; nothing is auto-fired.
 *
 * No new gate, no new auth, no new audit sink: deploy() rides the already-governed /api/write/* endpoints.
 * `deployImpl` is injectable so the suite drives a fake — no real network, no real server, no real claude.
 */
import { useCallback, useEffect, useState } from 'react';
import type { Session } from '../lib/authClient';
import { Composer } from './Composer';
import { deploy as defaultDeploy } from './deploy';
import type { DeployRefusal, DeployResult, DeploySuccess } from './deploy';
import type { ArtifactKind, DeployPlan, FollowUp, SeedKind } from './artifactTypes';
import type { WorkflowRunRequest } from '../../server/write/workflowRun';
import type { ComposerSession } from './workspaceClient';

export interface DeployOutcomeProps {
  composerSession?: ComposerSession;
  onComposerSessionChange?: (session: ComposerSession) => void;
  onRunningChange?: (running: boolean) => void;
  /** WebAuthn session token — forwarded to Composer/ComposerChat and to every deploy() call. */
  sessionToken?: string;
  /** Point-of-action passkey mint used by both chat and deploy. The returned token is consumed directly
   *  for the pending action and cached locally while the parent updates its session state. */
  onRequestSession?: () => Promise<Session | null>;
  /** Pre-seed the Composer type chip. `idea` (default) is the idea-first entry; entity pickers pass a kind. */
  initialKind?: SeedKind;
  /** Optional out-of-band idea text an entity picker may pre-fill (forwarded to Composer). */
  ideaText?: string;
  /** Return to the underlying view (the Composer Back affordance). */
  onBack?: () => void;
  /** Injectable deploy seam (defaults to C4's governed dispatcher) — the suite drives a fake. */
  deployImpl?: typeof defaultDeploy;
}

/** Per-followUp save state, keyed by relpath: in-flight, or its settled governed result. */
interface FollowUpState {
  pending: boolean;
  result?: DeployResult;
}

function authRefusal(): DeployRefusal {
  return { ok: false, reason: 'passkey sign-in failed — no session was created' };
}

function requestRefusal(error: unknown): DeployRefusal {
  const detail = error instanceof Error && error.message.trim() !== '' ? `: ${error.message}` : '';
  return { ok: false, reason: `deploy request failed${detail}` };
}

export function DeployOutcome({
  composerSession,
  onComposerSessionChange,
  onRunningChange,
  sessionToken,
  onRequestSession,
  initialKind = 'idea',
  ideaText = '',
  onBack,
  deployImpl = defaultDeploy,
}: DeployOutcomeProps): React.JSX.Element {
  const [pending, setPending] = useState(false);
  const [runPending, setRunPending] = useState(false);
  const [runOutcome, setRunOutcome] = useState<{ ok: boolean; message: string } | null>(null);
  const [outcome, setOutcome] = useState<DeployResult | null>(null);
  const [followUps, setFollowUps] = useState<Record<string, FollowUpState>>({});
  const [localToken, setLocalToken] = useState<string | undefined>(sessionToken);

  useEffect(() => {
    if (sessionToken) setLocalToken(sessionToken);
  }, [sessionToken]);

  const resolveToken = useCallback(async (): Promise<string | undefined> => {
    const existing = sessionToken ?? localToken;
    if (existing) return existing;
    if (!onRequestSession) return undefined;
    try {
      const session = await onRequestSession();
      if (!session) return undefined;
      setLocalToken(session.token);
      return session.token;
    } catch {
      return undefined;
    }
  }, [localToken, onRequestSession, sessionToken]);

  // Primary deploy: hand the validated plan to the governed dispatcher and store the outcome. Resetting
  // the follow-up map on each primary keeps a re-deploy's offered saves in sync with the fresh result.
  const runPrimary = useCallback(
    async (plan: DeployPlan): Promise<void> => {
      setPending(true);
      setFollowUps({});
      try {
        const token = await resolveToken();
        if (!token) {
          setOutcome(authRefusal());
          return;
        }
        setOutcome(await deployImpl(plan, token));
      } catch (error) {
        setOutcome(requestRefusal(error));
      } finally {
        setPending(false);
      }
    },
    [deployImpl, resolveToken],
  );

  // A follow-up file is its own durable, single-file governed save — one deploy() per click, never batched.
  const saveFollowUp = useCallback(
    async (fu: FollowUp, kind: ArtifactKind): Promise<void> => {
      setFollowUps((prev) => ({ ...prev, [fu.relpath]: { pending: true } }));
      let result: DeployResult = requestRefusal(undefined);
      try {
        const token = await resolveToken();
        if (!token) result = authRefusal();
        else {
          const plan: DeployPlan = {
            kind,
            relpath: fu.relpath,
            content: fu.content,
            branchClass: 'durable',
            endpoint: 'save',
          };
          result = await deployImpl(plan, token);
        }
      } catch (error) {
        result = requestRefusal(error);
      } finally {
        setFollowUps((prev) => ({ ...prev, [fu.relpath]: { pending: false, result } }));
      }
    },
    [deployImpl, resolveToken],
  );

  const runWorkflow = useCallback(async (request: WorkflowRunRequest): Promise<void> => {
    setRunPending(true);
    setRunOutcome(null);
    try {
      const token = await resolveToken();
      if (!token) {
        setRunOutcome({ ok: false, message: 'Unlock dashboard to launch this run.' });
        return;
      }
      const response = await fetch('/api/write/workflow-runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(request),
      });
      const data = (await response.json()) as {
        runId?: string;
        cards?: unknown[];
        runners?: Array<{ status?: string }>;
        error?: string;
        detail?: unknown;
      };
      if (response.ok && data.runId) {
        const signaled = data.runners?.filter((runner) => runner.status === 'triggered').length ?? 0;
        const pickup = signaled > 0
          ? ` · ${signaled} background runner${signaled === 1 ? '' : 's'} signaled.`
          : ' · queued; no background runner was signaled.';
        setRunOutcome({ ok: true, message: `Launched ${data.runId} · ${data.cards?.length ?? 0} stages queued${pickup}` });
      } else {
        const detail = typeof data.detail === 'string' ? data.detail : data.error ?? `HTTP ${response.status}`;
        setRunOutcome({ ok: false, message: `Run refused: ${detail}` });
      }
    } catch (error) {
      setRunOutcome({ ok: false, message: `Run request failed: ${error instanceof Error ? error.message : String(error)}` });
    } finally {
      setRunPending(false);
    }
  }, [resolveToken]);

  return (
    <Composer
      composerSession={composerSession}
      onComposerSessionChange={onComposerSessionChange}
      onRunningChange={onRunningChange}
      sessionToken={sessionToken}
      onRequestSession={onRequestSession}
      initialKind={initialKind}
      ideaText={ideaText}
      onBack={onBack}
      onDeploy={runPrimary}
      deployPending={pending}
      onRunWorkflow={runWorkflow}
      runPending={runPending}
      renderOutcome={
        <>
          <OutcomeStrip
            pending={pending}
            outcome={outcome}
            followUps={followUps}
            onSaveFollowUp={saveFollowUp}
          />
          {runOutcome ? (
            <p className={`v-composer__run-outcome${runOutcome.ok ? ' v-composer__run-outcome--ok' : ''}`} role="status">
              {runOutcome.message}
            </p>
          ) : null}
        </>
      }
    />
  );
}

/** The results strip rendered inside the Composer draft panel. Nothing shows until a deploy is in flight
 *  or has settled. */
function OutcomeStrip({
  pending,
  outcome,
  followUps,
  onSaveFollowUp,
}: {
  pending: boolean;
  outcome: DeployResult | null;
  followUps: Record<string, FollowUpState>;
  onSaveFollowUp: (fu: FollowUp, kind: ArtifactKind) => void | Promise<void>;
}): React.JSX.Element | null {
  if (!pending && outcome === null) return null;
  return (
    <div className="v-composer__outcome" data-testid="composer-outcome" role="status" aria-live="polite">
      {pending ? (
        <p className="v-composer__outcome-line">Deploying…</p>
      ) : outcome && outcome.ok ? (
        <DeployedOk outcome={outcome} followUps={followUps} onSaveFollowUp={onSaveFollowUp} />
      ) : outcome ? (
        <Refused outcome={outcome} />
      ) : null}
    </div>
  );
}

/** A landed governed write: a filed card (launch) or a branch/PR target (save), plus any offered saves. */
function DeployedOk({
  outcome,
  followUps,
  onSaveFollowUp,
}: {
  outcome: DeploySuccess;
  followUps: Record<string, FollowUpState>;
  onSaveFollowUp: (fu: FollowUp, kind: ArtifactKind) => void | Promise<void>;
}): React.JSX.Element {
  return (
    <>
      <p className="v-composer__outcome-line v-composer__outcome-line--ok">
        {outcome.cardId ? (
          <>
            Filed queue card <code className="v-composer__outcome-code">{outcome.cardId}</code>
            {outcome.runner?.status === 'triggered'
              ? ' · background runner signaled'
              : outcome.runner
                ? ` · queued (${outcome.runner.detail ?? outcome.runner.status})`
                : ''}
          </>
        ) : outcome.target ? (
          <>
            Deployed — <code className="v-composer__outcome-code">{outcome.target}</code>
          </>
        ) : (
          <>Deployed.</>
        )}
      </p>

      {outcome.followUps && outcome.followUps.length > 0 ? (
        <div className="v-composer__followups">
          <p className="v-composer__followups-title">
            Offered next saves — each is an individually governed commit:
          </p>
          <ul className="v-composer__followups-list" aria-label="Follow-up saves">
            {outcome.followUps.map((fu) => (
              <FollowUpRow
                key={fu.relpath}
                fu={fu}
                kind={outcome.kind}
                state={followUps[fu.relpath]}
                onSave={onSaveFollowUp}
              />
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}

/** One offered follow-up file: its relpath and a Save button; once fired it reads as saved (or its
 *  refusal reason). */
function FollowUpRow({
  fu,
  kind,
  state,
  onSave,
}: {
  fu: FollowUp;
  kind: ArtifactKind;
  state?: FollowUpState;
  onSave: (fu: FollowUp, kind: ArtifactKind) => void | Promise<void>;
}): React.JSX.Element {
  const result = state?.result;
  return (
    <li className="v-composer__followup">
      <code className="v-composer__outcome-code">{fu.relpath}</code>
      {result?.ok ? (
        <span className="v-composer__followup-done" data-testid={`followup-done:${fu.relpath}`}>
          saved{result.target ? ` — ${result.target}` : ''}
        </span>
      ) : result ? (
        <span className="v-composer__followup-failed">{result.reason}</span>
      ) : (
        <button
          type="button"
          className="mc-btn mc-btn--quiet v-composer__followup-btn"
          aria-label={`Save ${fu.relpath}`}
          disabled={state?.pending}
          onClick={() => void onSave(fu, kind)}
        >
          {state?.pending ? 'Saving…' : 'Save'}
        </button>
      )}
    </li>
  );
}

/** A governed refusal, surfaced legibly: status + error code (the 409 approval-locked shape) and the
 *  human-readable reason. */
function Refused({ outcome }: { outcome: DeployRefusal }): React.JSX.Element {
  return (
    <p
      className="v-composer__outcome-line v-composer__outcome-line--refused"
      data-testid="composer-refusal"
    >
      Refused
      {outcome.status ? ` (${outcome.status}${outcome.error ? ` ${outcome.error}` : ''})` : ''}: {outcome.reason}
    </p>
  );
}
