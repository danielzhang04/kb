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
import { useCallback, useState } from 'react';
import { Composer } from './Composer';
import { deploy as defaultDeploy } from './deploy';
import type { DeployRefusal, DeployResult, DeploySuccess } from './deploy';
import type { ArtifactKind, DeployPlan, FollowUp, SeedKind } from './artifactTypes';

export interface DeployOutcomeProps {
  /** WebAuthn session token — forwarded to Composer/ComposerChat and to every deploy() call. */
  sessionToken?: string;
  /** Pre-seed the Composer type chip. `idea` (default) is the idea-first entry; entity pickers pass a kind. */
  initialKind?: SeedKind;
  /** Optional out-of-band idea text an entity picker may pre-fill (forwarded to Composer). */
  ideaText?: string;
  /** Return to the underlying view (the Composer Back affordance). */
  onBack: () => void;
  /** Injectable deploy seam (defaults to C4's governed dispatcher) — the suite drives a fake. */
  deployImpl?: typeof defaultDeploy;
}

/** Per-followUp save state, keyed by relpath: in-flight, or its settled governed result. */
interface FollowUpState {
  pending: boolean;
  result?: DeployResult;
}

export function DeployOutcome({
  sessionToken,
  initialKind = 'idea',
  ideaText = '',
  onBack,
  deployImpl = defaultDeploy,
}: DeployOutcomeProps): React.JSX.Element {
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<DeployResult | null>(null);
  const [followUps, setFollowUps] = useState<Record<string, FollowUpState>>({});

  // Primary deploy: hand the validated plan to the governed dispatcher and store the outcome. Resetting
  // the follow-up map on each primary keeps a re-deploy's offered saves in sync with the fresh result.
  const runPrimary = useCallback(
    async (plan: DeployPlan): Promise<void> => {
      setPending(true);
      setFollowUps({});
      const res = await deployImpl(plan, sessionToken);
      setOutcome(res);
      setPending(false);
    },
    [deployImpl, sessionToken],
  );

  // A follow-up file is its own durable, single-file governed save — one deploy() per click, never batched.
  const saveFollowUp = useCallback(
    async (fu: FollowUp, kind: ArtifactKind): Promise<void> => {
      setFollowUps((prev) => ({ ...prev, [fu.relpath]: { pending: true } }));
      const plan: DeployPlan = {
        kind,
        relpath: fu.relpath,
        content: fu.content,
        branchClass: 'durable',
        endpoint: 'save',
      };
      const res = await deployImpl(plan, sessionToken);
      setFollowUps((prev) => ({ ...prev, [fu.relpath]: { pending: false, result: res } }));
    },
    [deployImpl, sessionToken],
  );

  return (
    <Composer
      sessionToken={sessionToken}
      initialKind={initialKind}
      ideaText={ideaText}
      onBack={onBack}
      onDeploy={runPrimary}
      renderOutcome={
        <OutcomeStrip
          pending={pending}
          outcome={outcome}
          followUps={followUps}
          onSaveFollowUp={saveFollowUp}
        />
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
