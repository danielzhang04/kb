/**
 * arc-3 — the governed run detail, rebuilt on the shared {@link EntityDetail} shell.
 *
 * Before this, the cockpit rendered a flat `<ol>` of stages and a flat `<ol>` of events and showed
 * roughly a fifth of what the browser had already been sent. `RunDetailDto` carries the FULL attempt
 * chain, every session, every Human Request (resolved included), `dependsOn`, and a `createdAt`/
 * `updatedAt` on every entity; `listRunEvents` adds per-event `diff`, `checkpoint`, `stageRef` and
 * `attemptRef`. None of that needed a new endpoint — it needed rendering.
 *
 * Four sections:
 *   Overview  — the run's identity plus the governed Manager surface and its Human Requests.
 *   Stages    — `dependsOn`, the canonical card, and the WHOLE attempt chain per stage (previously only
 *               `stage.currentAttemptRef` was ever read, so retries were invisible).
 *   Timeline  — the dense operational trace. Deliberately called the **Activity stream**, never a
 *               "terminal": the broker yields normalized, redacted events only and there is no raw
 *               stream route, so terminal language would promise a TTY the backend cannot supply.
 *   Changes   — `event.diff`. Persisted, typed, on the wire, and until now dropped on the floor.
 *
 * Governed mutations are unchanged: every one still carries its exact version/hash and idempotency key,
 * and the reroute disposition still mirrors the server guard.
 */
import { useState, type FormEvent } from 'react';
import type {
  AttemptDto,
  HumanRequestDecision,
  HumanRequestDto,
  ManagedSessionDto,
  OperationalEventDto,
  ResolvedAgentAssignmentDto,
  RunDetailDto,
  StageDto,
} from './controlClient';
import { decisionsForHumanRequest } from './humanBoundaries';
import { EntityDetail, type DetailSection, type EntityLink } from '../entity/EntityDetail';
import { agentIdsForRun } from './entityLinks';
import type { NavTarget } from '../nav/stack';
import { changeEvents, checkpointInfo, eventClock, eventLabel, isDiffTruncated, timestampLabel } from './runEvents';
import type { RunEventWindow } from './runEventWindow';
import { runTone } from './RunGrid';
import './control.css';

export interface RunCockpitProps {
  detail: RunDetailDto;
  events: OperationalEventDto[];
  busy?: boolean;
  /** Valid safe-checkpoint names compiled into the proposal, so steering is a pick, not a guess. */
  checkpoints?: Array<{ id: string; label: string }>;
  activeSectionId?: string;
  onSectionChange?: (id: string) => void;
  onBack?: () => void;
  backLabel?: string;
  onNavigate?: (target: NavTarget) => void;
  onManagerMessage?: (message: string) => void | Promise<void>;
  onStop?: () => void | Promise<void>;
  onRetry?: () => void | Promise<void>;
  onManagerSuccessor?: () => void | Promise<void>;
  onSteer?: (checkpoint: string, instruction: string) => void | Promise<void>;
  onReroute?: (stage: StageDto, attempt: AttemptDto, runtime: string, model: string) => void | Promise<void>;
  onHumanResponse?: (
    request: HumanRequestDto,
    decision: HumanRequestDecision,
    response: string,
  ) => void | Promise<void>;
  /**
   * arc-3 step 2 — cross-entity links.
   *
   * `cardOwners` is `cardId -> agent id` from the Plane-A index; combined with each stage's
   * `canonicalCardRef` it is the ONLY real run → agent join in the product, because no session or
   * attempt DTO carries an agent id. `workflowId` is the definition this run was launched from,
   * resolved by the caller through `sourceTurnId`, or null for an ad-hoc Composer run.
   */
  cardOwners?: Map<string, string>;
  workflowId?: string | null;
  /**
   * What `events` actually IS relative to the run's full history — see {@link RunEventWindow}.
   *
   * Without this the tab printed `events.length` while the grid card printed the true `eventCount`, so a
   * 5,000-event run read "5000 events" in one place and "500" in the other with nothing explaining the
   * gap. Omitted (standalone/test use) means "`events` is everything there is".
   */
  eventWindow?: RunEventWindow;
}

type RerouteDisposition =
  | { allowed: true; label: 'Reroutable before start' }
  | { allowed: false; label: 'Plan amendment required' | 'Successor attempt required' | 'Immutable' | 'Immutable logical assignment' };

function logicalAssignment(assignment: ResolvedAgentAssignmentDto | null): string {
  return assignment ? `${assignment.agentId} · ${assignment.profileId}` : 'unassigned';
}

function rerouteDisposition(detail: RunDetailDto, stage: StageDto, attempt: AttemptDto | undefined): RerouteDisposition {
  if (stage.assignment !== null) return { allowed: false, label: 'Immutable logical assignment' };
  if (stage.state === 'waiting-human' || detail.humanRequests.some((request) => request.stageRef === stage.stageRef)) {
    return { allowed: false, label: 'Plan amendment required' };
  }
  if (['succeeded', 'failed', 'stopped'].includes(stage.state) || (attempt && ['succeeded', 'failed', 'stopped'].includes(attempt.state))) {
    return { allowed: false, label: 'Immutable' };
  }
  if (detail.run.publicationState !== 'published' || ['stopping', 'succeeded', 'failed', 'stopped'].includes(detail.run.state)) {
    return { allowed: false, label: 'Immutable' };
  }
  const session = detail.sessions.find((candidate) => candidate.sessionRef === attempt?.managedSessionRef);
  if (!attempt || !['ready', 'blocked'].includes(stage.state) || attempt.state !== 'queued' || session?.state !== 'pending') {
    return { allowed: false, label: 'Successor attempt required' };
  }
  return { allowed: true, label: 'Reroutable before start' };
}

/* ============================================================================
 * Section bodies — pure components over their own DTO slice, so each is testable
 * with a literal fixture and no fetch mock.
 * ========================================================================= */

/** One attempt in a stage's chain. Every field here was already fetched and none of it was rendered. */
function AttemptRow({
  attempt,
  session,
  current,
}: {
  attempt: AttemptDto;
  session: ManagedSessionDto | undefined;
  current: boolean;
}): React.JSX.Element {
  return (
    <li
      className={`run-attempt${current ? ' run-attempt--current' : ''}`}
      data-testid={`run-attempt-${attempt.attemptRef}`}
    >
      <span className="run-attempt__head">
        <span className="mc-mono">attempt {attempt.generation}</span>
        <span className="run-attempt__state">{attempt.state}</span>
        {current ? <span className="run-attempt__current-tag">current</span> : null}
      </span>
      <span className="mc-mono run-attempt__routing">
        {attempt.runtime} · {attempt.model}
      </span>
      {attempt.predecessorAttemptRef ? (
        <span className="mc-mono run-attempt__meta">retry of {attempt.predecessorAttemptRef}</span>
      ) : null}
      {attempt.managedSessionRef ? (
        <span className="mc-mono run-attempt__meta">
          session {attempt.managedSessionRef}
          {session ? ` · ${session.role} · ${session.state}` : ''}
        </span>
      ) : null}
      <span className="mc-mono run-attempt__meta">
        {timestampLabel(attempt.createdAt)} → {timestampLabel(attempt.updatedAt)}
      </span>
    </li>
  );
}

export interface StagesSectionProps {
  detail: RunDetailDto;
  busy: boolean;
  routingDrafts: Record<string, { runtime: string; model: string }>;
  onDraftChange: (stageRef: string, next: { runtime: string; model: string }) => void;
  onReroute?: RunCockpitProps['onReroute'];
  onNavigate?: (target: NavTarget) => void;
}

export function StagesSection({
  detail,
  busy,
  routingDrafts,
  onDraftChange,
  onReroute,
  onNavigate,
}: StagesSectionProps): React.JSX.Element {
  return (
    <ol className="run-stages" data-testid="run-stages">
      {detail.stages.map((stage) => {
        // The WHOLE chain for this stage, not just `currentAttemptRef` — retries are the interesting part.
        const chain = detail.attempts
          .filter((item) => item.stageRef === stage.stageRef)
          .sort((a, b) => a.generation - b.generation);
        const attempt = detail.attempts.find((item) => item.attemptRef === stage.currentAttemptRef);
        const disposition = rerouteDisposition(detail, stage, attempt);
        const draft = routingDrafts[stage.stageRef] ?? { runtime: attempt?.runtime ?? '', model: attempt?.model ?? '' };
        const unchanged = attempt?.runtime === draft.runtime.trim() && attempt?.model === draft.model.trim();
        const updateDraft = (next: Partial<{ runtime: string; model: string }>): void => {
          onDraftChange(stage.stageRef, { ...draft, ...next });
        };
        return (
          <li key={stage.stageRef} className="run-stage" data-testid={`run-stage-${stage.stageRef}`}>
            <div className="run-stage__head">
              <strong>{stage.title}</strong>
              <span className="run-stage__state">{stage.state}</span>
            </div>
            <div className="run-stage__facts">
              <span className="mc-mono">{stage.stageId}</span>
              {/* `dependsOn` IS the managed-run dependency graph and was never rendered anywhere. */}
              <span className="mc-mono" data-testid={`run-stage-${stage.stageRef}-depends`}>
                {stage.dependsOn.length ? `depends on ${stage.dependsOn.join(', ')}` : 'no dependencies'}
              </span>
              {stage.canonicalCardRef ? (
                onNavigate ? (
                  <button
                    type="button"
                    className="run-stage__card-link mc-mono"
                    data-testid={`run-stage-${stage.stageRef}-card`}
                    onClick={() => onNavigate({ view: 'tasks', focus: { kind: 'card', id: stage.canonicalCardRef! } })}
                  >
                    {stage.canonicalCardRef}
                  </button>
                ) : (
                  <span className="mc-mono">{stage.canonicalCardRef}</span>
                )
              ) : (
                <span className="mc-mono">card pending</span>
              )}
              <span className="mc-mono">
                {timestampLabel(stage.createdAt)} → {timestampLabel(stage.updatedAt)}
              </span>
              <span data-testid={`run-stage-${stage.stageRef}-assignment`}>
                Logical assignment <span className="mc-mono">{logicalAssignment(stage.assignment)}</span>
              </span>
            </div>

            {chain.length ? (
              <ol className="run-attempts" data-testid={`run-stage-${stage.stageRef}-attempts`}>
                {chain.map((item) => (
                  <AttemptRow
                    key={item.attemptRef}
                    attempt={item}
                    session={detail.sessions.find((s) => s.sessionRef === item.managedSessionRef)}
                    current={item.attemptRef === stage.currentAttemptRef}
                  />
                ))}
              </ol>
            ) : (
              <p className="control-help">No attempts recorded for this stage yet.</p>
            )}

            <span className="run-stage__disposition">{disposition.label}</span>
            {attempt && disposition.allowed ? (
              <div className="control-form">
                <label htmlFor={`reroute-runtime-${stage.stageRef}`}>Runtime for {stage.title}</label>
                <input
                  id={`reroute-runtime-${stage.stageRef}`}
                  value={draft.runtime}
                  onChange={(event) => updateDraft({ runtime: event.target.value })}
                  disabled={busy}
                />
                <label htmlFor={`reroute-model-${stage.stageRef}`}>Model for {stage.title}</label>
                <input
                  id={`reroute-model-${stage.stageRef}`}
                  value={draft.model}
                  onChange={(event) => updateDraft({ model: event.target.value })}
                  disabled={busy}
                />
                <button
                  type="button"
                  className="mc-btn"
                  disabled={busy || !onReroute || unchanged || !draft.runtime.trim() || !draft.model.trim()}
                  onClick={() => void onReroute?.(stage, attempt, draft.runtime.trim(), draft.model.trim())}
                >
                  Reroute {stage.title}
                </button>
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The Activity stream — a dense, single-column operational trace.
 *
 * NOT a terminal, and never labelled as one: the broker's `onEvent` yields normalized, redacted events
 * only, so calling this a terminal would promise a live TTY that has no route behind it.
 */
export function TimelineSection({ events }: { events: OperationalEventDto[] }): React.JSX.Element {
  if (!events.length) return <p className="control-help">No events recorded yet.</p>;
  return (
    <ol className="run-activity" data-testid="run-activity">
      {events.map((event) => {
        const checkpoint = checkpointInfo(event);
        return (
          <li
            key={event.cursor}
            className={`run-activity__row run-activity__row--${event.kind}`}
            data-testid={`run-event-${event.cursor}`}
          >
            <span className="mc-mono run-activity__time" title={timestampLabel(event.createdAt)}>
              {eventClock(event.createdAt)}
            </span>
            <span className="mc-mono run-activity__kind">{event.kind}</span>
            <span className="run-activity__text">
              {checkpoint ? (
                <>
                  {/* Name and state are DISTINCT. The old flattening rendered the bare state word and
                   *  dropped the name, because `summary` (which holds the state) came first in the chain. */}
                  <span className="mc-mono" data-testid={`run-event-${event.cursor}-checkpoint-name`}>
                    {checkpoint.name}
                  </span>
                  {checkpoint.state ? (
                    <span
                      className={`run-activity__checkpoint run-activity__checkpoint--${checkpoint.state}`}
                      data-testid={`run-event-${event.cursor}-checkpoint-state`}
                    >
                      {checkpoint.state}
                    </span>
                  ) : null}
                  {checkpoint.detail ? (
                    <span className="run-activity__detail">{checkpoint.detail}</span>
                  ) : null}
                </>
              ) : (
                eventLabel(event)
              )}
            </span>
            <span className="mc-mono run-activity__attribution">
              {event.stageRef ?? '—'}
              {event.attemptRef ? ` · ${event.attemptRef}` : ''}
            </span>
            <span className="run-activity__status">{event.status ?? event.source}</span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Changes — the code history.
 *
 * `event.diff` is persisted server-side, returned by the events route, and typed on the DTO. It arrived
 * in the browser on every single load and was thrown away because it was never in `eventText()`'s `??`
 * chain. This section is the whole reason that mattered.
 */
export function ChangesSection({ events }: { events: OperationalEventDto[] }): React.JSX.Element {
  const changes = changeEvents(events);
  if (!changes.length) {
    return <p className="control-help">No file changes have been recorded for this run yet.</p>;
  }
  return (
    <>
      {/*
        * The Activity stream already tells the operator its feed is filtered. Changes calls itself "the
        * code history" and said nothing, while every diff here has been through
        * `redactSensitiveText(...).slice(0, 64 * 1024)` server-side and redacted again in
        * `publicEvents.ts`. A redacted, 64KB-clipped diff rendered raw into a `<pre>` LOOKS complete,
        * which is the failure mode: an operator reviewing a change has to know what they are not seeing.
        */}
      <p className="control-help" data-testid="run-changes-note">
        Diffs are redacted server-side and each is capped at 64KB; treat this as a review aid, not the
        authoritative patch. Individually truncated diffs are marked.
      </p>
      <ol className="run-changes" data-testid="run-changes">
        {changes.map((event) => {
          const truncated = isDiffTruncated(event);
          return (
            <li key={event.cursor} className="run-change" data-testid={`run-change-${event.cursor}`}>
              <div className="run-change__head">
                <code className="mc-mono run-change__path">{event.path ?? 'unknown path'}</code>
                <span className="mc-mono run-change__meta">
                  {eventClock(event.createdAt)}
                  {event.attemptRef ? ` · ${event.attemptRef}` : ''}
                </span>
              </div>
              <pre className="run-change__diff" data-testid={`run-change-${event.cursor}-diff`}>{event.diff}</pre>
              {truncated ? (
                <p className="run-change__truncated" data-testid={`run-change-${event.cursor}-truncated`}>
                  Truncated at the 64KB cap — the rest of this diff is not on the wire.
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>
    </>
  );
}

/* ============================================================================
 * The composed run detail.
 * ========================================================================= */

export function RunCockpit({
  detail,
  events,
  busy = false,
  checkpoints,
  activeSectionId,
  onSectionChange,
  onBack,
  backLabel,
  onNavigate,
  onManagerMessage,
  onStop,
  onRetry,
  onManagerSuccessor,
  onSteer,
  onReroute,
  onHumanResponse,
  cardOwners,
  workflowId,
  eventWindow,
}: RunCockpitProps): React.JSX.Element {
  const [message, setMessage] = useState('');
  const [checkpoint, setCheckpoint] = useState('');
  const [instruction, setInstruction] = useState('');
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [routingDrafts, setRoutingDrafts] = useState<Record<string, { runtime: string; model: string }>>({});
  const manager = detail.sessions.find((session) => session.sessionRef === detail.run.managerSessionRef);

  /**
   * What the operator is actually looking at in the Activity stream, said plainly.
   *
   * Three distinct cases, and the third is the one that must not be papered over: when paging stopped at
   * the cockpit's bound, `events` is an interior slice — neither the head nor the tail — and claiming it
   * is "the most recent" would be a lie. Silence is not an option for any of them.
   */
  const windowNote = ((): string | null => {
    if (!eventWindow) return null;
    if (eventWindow.complete && eventWindow.seen <= events.length) return null;
    if (eventWindow.complete) {
      return `Showing the most recent ${events.length} of ${eventWindow.seen} events; earlier ones are not loaded.`;
    }
    return `This run has more than ${eventWindow.seen} events — more than the cockpit will page through, `
      + `so these ${events.length} are an interior slice and the newest events are NOT shown.`;
  })();
  const openRequests = detail.humanRequests.filter((request) => request.state === 'open');
  const resolvedRequests = detail.humanRequests.filter((request) => request.state !== 'open');
  const completionRequestRefs = new Set((detail.reviewReceipts ?? [])
    .map((receipt) => receipt.completionRequestRef)
    .filter((ref): ref is string => ref !== null));

  const submitMessage = (event: FormEvent): void => {
    event.preventDefault();
    const value = message.trim();
    if (!value || !onManagerMessage) return;
    void onManagerMessage(value);
    setMessage('');
  };

  const submitSteer = (event: FormEvent): void => {
    event.preventDefault();
    const target = checkpoint.trim();
    const value = instruction.trim();
    if (!target || !value || !onSteer) return;
    void onSteer(target, value);
    setInstruction('');
  };

  const overview = (
    <>
      <section className="control-cockpit__manager mc-panel" aria-labelledby="manager-head">
        <h3 id="manager-head">Manager head</h3>
        <dl className="control-facts">
          <div><dt>Generation</dt><dd>{detail.run.managerGeneration}</dd></div>
          <div><dt>Session</dt><dd className="mc-mono">{detail.run.managerSessionRef}</dd></div>
          <div><dt>Executor</dt><dd className="mc-mono">{manager ? `${manager.runtime} · ${manager.model}` : 'recovering'}</dd></div>
          <div><dt>Logical assignment</dt><dd className="mc-mono">{logicalAssignment(detail.run.managerAssignment)}</dd></div>
          <div><dt>State</dt><dd>{manager?.state ?? 'unavailable'}</dd></div>
        </dl>
        <button
          type="button"
          className="mc-btn"
          disabled={busy || !onManagerSuccessor || !manager || !['interrupted', 'failed', 'stopped', 'completed'].includes(manager.state)}
          onClick={() => void onManagerSuccessor?.()}
        >
          Start successor Manager
        </button>
        <form className="control-form" onSubmit={submitMessage}>
          <label htmlFor="manager-message">Message manager</label>
          <textarea id="manager-message" value={message} onChange={(event) => setMessage(event.target.value)} disabled={busy} />
          <button type="submit" className="mc-btn mc-btn--primary" disabled={busy || !message.trim() || !onManagerMessage}>Send message</button>
        </form>
        <form className="control-form" onSubmit={submitSteer}>
          <label htmlFor="manager-checkpoint">Safe checkpoint</label>
          {/* The compiled proposal already names every valid checkpoint. Making the operator type one
           *  from memory — and silently fail on a typo — was a defect, not a design. Free text remains
           *  the fallback ONLY when the compiled list could not be loaded, so steering is never blocked. */}
          {checkpoints?.length ? (
            <select
              id="manager-checkpoint"
              value={checkpoint}
              onChange={(event) => setCheckpoint(event.target.value)}
              disabled={busy}
            >
              <option value="">Select a safe checkpoint…</option>
              {checkpoints.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label || option.id}
                </option>
              ))}
            </select>
          ) : (
            <input id="manager-checkpoint" value={checkpoint} onChange={(event) => setCheckpoint(event.target.value)} disabled={busy} />
          )}
          <label htmlFor="manager-steer">Steering instruction</label>
          <textarea id="manager-steer" value={instruction} onChange={(event) => setInstruction(event.target.value)} disabled={busy} />
          <p className="control-help">Steering is queued as operator text and applies only when this checkpoint is reached.</p>
          <button type="submit" className="mc-btn" disabled={busy || !checkpoint.trim() || !instruction.trim() || !onSteer}>Queue steering</button>
        </form>
      </section>

      {openRequests.length ? (
        <section className="control-requests mc-panel" aria-labelledby="human-requests">
          <h3 id="human-requests">Human requests</h3>
          {openRequests.map((request) => (
            <article key={request.requestRef} className="control-request">
              <p className="control-eyebrow">{request.kind} · revision {request.revision}</p>
              <h4>{completionRequestRefs.has(request.requestRef) ? `Review completion gate: ${request.title}` : request.title}</h4>
              <p>{request.prompt}</p>
              <label htmlFor={`response-${request.requestRef}`}>Response</label>
              <textarea
                id={`response-${request.requestRef}`}
                value={responses[request.requestRef] ?? ''}
                onChange={(event) => setResponses((current) => ({ ...current, [request.requestRef]: event.target.value }))}
                disabled={busy}
              />
              <div className="control-actions">
                {decisionsForHumanRequest(request.kind).map((decision) => (
                  <button
                    key={decision}
                    type="button"
                    className={decision === 'approved' ? 'mc-btn mc-btn--primary' : 'mc-btn'}
                    disabled={busy || !onHumanResponse}
                    onClick={() => void onHumanResponse?.(request, decision, responses[request.requestRef]?.trim() ?? '')}
                  >
                    {decision === 'changes-requested' ? 'Request changes' : decision[0].toUpperCase() + decision.slice(1)}
                  </button>
                ))}
              </div>
            </article>
          ))}
        </section>
      ) : null}

      {/* Resolved requests were filtered out entirely before, so the operator could not see what had
       *  already been decided or what they themselves had answered. */}
      {resolvedRequests.length ? (
        <section className="control-requests mc-panel" aria-labelledby="resolved-requests">
          <h3 id="resolved-requests">Resolved requests</h3>
          {resolvedRequests.map((request) => (
            <article key={request.requestRef} className="control-request" data-testid={`resolved-request-${request.requestRef}`}>
              <p className="control-eyebrow">{request.kind} · revision {request.revision}</p>
              <h4>{request.title}</h4>
              {request.response ? (
                <p className="control-help">
                  <span className="mc-mono">{request.response.decision}</span>
                  {request.response.response ? ` · ${request.response.response}` : ''}
                  {' · '}
                  <span className="mc-mono">{timestampLabel(request.response.respondedAt)}</span>
                </p>
              ) : (
                <p className="control-help">Resolved without a recorded response.</p>
              )}
            </article>
          ))}
        </section>
      ) : null}
    </>
  );

  const sections: DetailSection[] = [
    {
      id: 'overview',
      label: 'Overview',
      attention: openRequests.length > 0,
      render: () => overview,
    },
    {
      id: 'stages',
      label: 'Stages',
      count: detail.stages.length,
      render: () => (
        <StagesSection
          detail={detail}
          busy={busy}
          routingDrafts={routingDrafts}
          onDraftChange={(stageRef, next) => setRoutingDrafts((current) => ({ ...current, [stageRef]: next }))}
          onReroute={onReroute}
          onNavigate={onNavigate}
        />
      ),
    },
    {
      id: 'timeline',
      label: 'Activity stream',
      // The run's TRUE event count, so this tab agrees with the `eventCount` on the run's grid card.
      // How much of it is actually on screen is stated in the note below, not hidden in this number.
      count: eventWindow?.seen ?? events.length,
      render: () => (
        <>
          <p className="control-help">
            Visible operational trace only; private reasoning and raw tool payloads are not part of this feed.
          </p>
          {windowNote ? (
            <p className="control-help" data-testid="run-activity-window-note">{windowNote}</p>
          ) : null}
          <TimelineSection events={events} />
        </>
      ),
    },
    {
      id: 'changes',
      label: 'Changes',
      count: changeEvents(events).length,
      render: () => <ChangesSection events={events} />,
    },
  ];

  /**
   * The run's edges out. Every one is derived from data already loaded — no extra fetch, no new route.
   *
   * The agent links are labelled "via queue cards" because that is literally how they are derived: the
   * stage's canonical card's owner. Claiming a direct run→agent relationship the DTOs do not carry
   * would be dishonest, and the operator needs to know the join is indirect to read it correctly.
   */
  const links: EntityLink[] = [
    ...(workflowId
      ? [{ label: 'Launched from workflow', target: { view: 'workflows' as const, focus: { kind: 'workflow' as const, id: workflowId } }, ref: workflowId }]
      : []),
    ...(detail.run.predecessorRunRef
      ? [{ label: 'Retried from run', target: { view: 'pipeline' as const, focus: { kind: 'run' as const, id: detail.run.predecessorRunRef } }, ref: detail.run.predecessorRunRef }]
      : []),
    ...(cardOwners
      ? agentIdsForRun(detail.stages, cardOwners).map((agentId) => ({
          label: 'Agent · via queue cards',
          target: { view: 'agents' as const, focus: { kind: 'agent' as const, id: agentId } },
          ref: agentId,
        }))
      : []),
  ];

  const actions = (
    <>
      <button
        type="button"
        className="mc-btn"
        disabled={busy || !onStop || !['running', 'recovering', 'waiting-human'].includes(detail.run.state)}
        onClick={() => void onStop?.()}
      >
        Stop run
      </button>
      <button
        type="button"
        className="mc-btn"
        disabled={busy || !onRetry || !['failed', 'stopped', 'interrupted'].includes(detail.run.state)}
        onClick={() => void onRetry?.()}
      >
        Retry as successor
      </button>
    </>
  );

  return (
    <EntityDetail
      entity={{ kind: 'run', id: detail.run.runRef }}
      eyebrow={`Governed run · ${detail.run.runRef}`}
      title={detail.run.title}
      status={{ label: detail.run.state, tone: runTone(detail.run.state) }}
      facts={[
        { label: 'Publication', value: detail.run.publicationState },
        { label: 'Proposal', value: detail.run.proposalRef, mono: true },
        { label: 'Revision', value: detail.run.proposalRevision, mono: true },
        // The hash was sliced to 12 chars, which is not enough to compare against anything.
        { label: 'Proposal hash', value: detail.run.proposalHash, mono: true },
        { label: 'Run version', value: detail.run.version, mono: true },
        { label: 'Manager generation', value: detail.run.managerGeneration, mono: true },
        // `predecessorRunRef` is no longer a fact: it is a LINK in the row above, because retry lineage
        // is something the operator wants to walk, not merely read.
        { label: 'Created', value: timestampLabel(detail.run.createdAt), mono: true },
        { label: 'Updated', value: timestampLabel(detail.run.updatedAt), mono: true },
      ]}
      links={links}
      sections={sections}
      activeSectionId={activeSectionId}
      onSectionChange={onSectionChange}
      onBack={onBack}
      backLabel={backLabel}
      onNavigate={onNavigate}
      actions={actions}
    />
  );
}
