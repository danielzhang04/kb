import { useState, type FormEvent } from 'react';
import type {
  AttemptDto,
  HumanRequestDecision,
  HumanRequestDto,
  OperationalEventDto,
  RunDetailDto,
  StageDto,
} from './controlClient';
import { decisionsForHumanRequest } from './humanBoundaries';
import './control.css';

export interface RunCockpitProps {
  detail: RunDetailDto;
  events: OperationalEventDto[];
  busy?: boolean;
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
}

type RerouteDisposition =
  | { allowed: true; label: 'Reroutable before start' }
  | { allowed: false; label: 'Plan amendment required' | 'Successor attempt required' | 'Immutable' };

function rerouteDisposition(detail: RunDetailDto, stage: StageDto, attempt: AttemptDto | undefined): RerouteDisposition {
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

function eventText(event: OperationalEventDto): string {
  return event.summary ?? event.command ?? event.toolName ?? event.path ?? event.checkpoint ?? event.kind;
}

export function RunCockpit({
  detail,
  events,
  busy = false,
  onManagerMessage,
  onStop,
  onRetry,
  onManagerSuccessor,
  onSteer,
  onReroute,
  onHumanResponse,
}: RunCockpitProps) {
  const [message, setMessage] = useState('');
  const [checkpoint, setCheckpoint] = useState('');
  const [instruction, setInstruction] = useState('');
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [routingDrafts, setRoutingDrafts] = useState<Record<string, { runtime: string; model: string }>>({});
  const manager = detail.sessions.find((session) => session.sessionRef === detail.run.managerSessionRef);

  const submitMessage = (event: FormEvent) => {
    event.preventDefault();
    const value = message.trim();
    if (!value || !onManagerMessage) return;
    void onManagerMessage(value);
    setMessage('');
  };

  const submitSteer = (event: FormEvent) => {
    event.preventDefault();
    const target = checkpoint.trim();
    const value = instruction.trim();
    if (!target || !value || !onSteer) return;
    void onSteer(target, value);
    setInstruction('');
  };

  return (
    <section className="control-cockpit" aria-label={`Run ${detail.run.title}`}>
      <header className="control-cockpit__head">
        <div>
          <p className="control-eyebrow">Governed run · {detail.run.runRef}</p>
          <h2>{detail.run.title}</h2>
          <p>Proposal revision {detail.run.proposalRevision} · <code title={detail.run.proposalHash}>{detail.run.proposalHash.slice(0, 12)}</code></p>
        </div>
        <div className="control-cockpit__state">
          <span className={`mc-status-dot mc-status-dot--${detail.run.state === 'running' ? 'running' : 'idle'}`} aria-hidden="true" />
          <span>{detail.run.state}</span>
          <button type="button" className="mc-btn" disabled={busy || !onStop || !['running', 'recovering', 'waiting-human'].includes(detail.run.state)} onClick={() => void onStop?.()}>
            Stop run
          </button>
          <button type="button" className="mc-btn" disabled={busy || !onRetry || !['failed', 'stopped', 'interrupted'].includes(detail.run.state)} onClick={() => void onRetry?.()}>
            Retry as successor
          </button>
        </div>
      </header>

      <p className="control-help">A queued stage may reroute before it starts. Approval-bound, human-gated, active, and terminal work requires the disposition shown on that stage.</p>

      <div className="control-cockpit__grid">
        <section className="control-cockpit__manager mc-panel" aria-labelledby="manager-head">
          <h3 id="manager-head">Manager head</h3>
          <dl className="control-facts">
            <div><dt>Generation</dt><dd>{detail.run.managerGeneration}</dd></div>
            <div><dt>Session</dt><dd className="mc-mono">{detail.run.managerSessionRef}</dd></div>
            <div><dt>Runtime</dt><dd className="mc-mono">{manager ? `${manager.runtime} · ${manager.model}` : 'recovering'}</dd></div>
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
            <input id="manager-checkpoint" value={checkpoint} onChange={(event) => setCheckpoint(event.target.value)} disabled={busy} />
            <label htmlFor="manager-steer">Steering instruction</label>
            <textarea id="manager-steer" value={instruction} onChange={(event) => setInstruction(event.target.value)} disabled={busy} />
            <p className="control-help">Steering is queued as operator text and applies only when this checkpoint is reached.</p>
            <button type="submit" className="mc-btn" disabled={busy || !checkpoint.trim() || !instruction.trim() || !onSteer}>Queue steering</button>
          </form>
        </section>

        <section className="control-cockpit__stages mc-panel" aria-labelledby="run-stages">
          <h3 id="run-stages">Stages</h3>
          <ol className="control-stage-list">
            {detail.stages.map((stage) => {
              const attempt = detail.attempts.find((item) => item.attemptRef === stage.currentAttemptRef);
              const disposition = rerouteDisposition(detail, stage, attempt);
              const draft = routingDrafts[stage.stageRef] ?? { runtime: attempt?.runtime ?? '', model: attempt?.model ?? '' };
              const unchanged = attempt?.runtime === draft.runtime.trim() && attempt?.model === draft.model.trim();
              const updateDraft = (next: Partial<{ runtime: string; model: string }>) => {
                setRoutingDrafts((current) => ({ ...current, [stage.stageRef]: { ...draft, ...next } }));
              };
              return (
                <li key={stage.stageRef}>
                  <div><strong>{stage.title}</strong><span>{stage.state}</span></div>
                  <span className="mc-mono">{stage.canonicalCardRef ?? 'card pending'}</span>
                  {attempt ? <span className="mc-mono">attempt {attempt.generation} · {attempt.runtime} · {attempt.model}</span> : null}
                  <span>{disposition.label}</span>
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
        </section>
      </div>

      {detail.humanRequests.some((request) => request.state === 'open') ? (
        <section className="control-requests mc-panel" aria-labelledby="human-requests">
          <h3 id="human-requests">Human requests</h3>
          {detail.humanRequests.filter((request) => request.state === 'open').map((request) => (
            <article key={request.requestRef} className="control-request">
              <p className="control-eyebrow">{request.kind} · revision {request.revision}</p>
              <h4>{request.title}</h4>
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

      <section className="control-events mc-panel" aria-labelledby="operational-events">
        <h3 id="operational-events">Operational events</h3>
        <p className="control-help">Visible operational trace only; private reasoning and raw tool payloads are not part of this feed.</p>
        {events.length ? (
          <ol className="control-events__list">
            {events.map((event) => (
              <li key={event.cursor}>
                <span className="mc-mono">{event.cursor}</span>
                <span>{event.kind}</span>
                <span>{eventText(event)}</span>
                <span>{event.status ?? event.source}</span>
              </li>
            ))}
          </ol>
        ) : <p className="control-help">No events recorded yet.</p>}
      </section>
    </section>
  );
}
