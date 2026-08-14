import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { HumanRequestDecision, HumanRequestDto, RunDetailDto } from '../control/controlClient';
import { postAgentMessage } from '../control/agentMessages';
import { latestAttemptRefOfAgent, type AgentRunOverlay, type IterationParticipantOverlay } from '../control/runGraph';
import { useAttemptIo } from '../lib/useAttemptIo';
import { useSession } from '../lib/sessionContext';
import type { UseSseResult } from '../lib/sseClient';
import { HumanRequestCard } from './HumanRequestCard';

const terminalStates = new Set<AgentRunOverlay['state']>(['succeeded', 'failed', 'stopped', 'interrupted']);

function refs(values: readonly string[]): string {
  return values.length ? values.join(' · ') : 'none';
}

function ParticipantIterationDetail({ participant }: { participant: IterationParticipantOverlay }): React.JSX.Element {
  const residue = participant.parked ? participant.unresolvedResidue : undefined;
  const positions = [...participant.receipts.flatMap((receipt) => receipt.positions), ...(residue?.positions ?? [])];
  const dissent = [...participant.receipts.flatMap((receipt) => receipt.recordedDissent), ...(residue?.recordedDissent ?? [])];
  return (
    <article className="v-agent-work-panel__iteration" data-testid={`agent-work-participant-${participant.key}`}>
      <header className="v-agent-work-panel__iteration-head">
        <h4>{participant.stageId} · {participant.iterationGroupId} · {participant.participantId}</h4>
        <span className="entity-chip">{participant.role}</span>
        {participant.loopState === 'declined' ? <span className="entity-chip v-iteration-declined-chip">declined</span> : null}
        {participant.loopState !== 'declined' && participant.parked ? (
          <span className="entity-chip v-iteration-park-chip">parked: {participant.parkReason ?? 'awaiting approval'}</span>
        ) : null}
      </header>
      <dl className="v-agent-work-panel__iteration-definition">
        <div><dt>Mandate</dt><dd>{participant.mandate}</dd></div>
        <div><dt>Perspective</dt><dd>{participant.perspectiveSummary}</dd></div>
        {participant.goal ? <div><dt>Goal</dt><dd>{participant.goal}</dd></div> : null}
        <div><dt>Presented for approval</dt><dd className="mc-mono" data-testid="iteration-approval-artifacts">{refs(participant.activeGenerationRefs)}</dd></div>
        {participant.acceptedGenerationRefs ? <div><dt>Accepted artifacts</dt><dd className="mc-mono">{refs(participant.acceptedGenerationRefs)}</dd></div> : null}
      </dl>

      <section aria-label="Request lineage">
        <h5>Request lineage</h5>
        {participant.requests.length ? <ol>
          {participant.requests.map((request) => <li key={request.requestRef}>
            <span className="mc-mono">{request.requestRef}</span> · {request.kind} · route {request.routeId} · cycle {request.cycle}
            <span>inputs: <span className="mc-mono">{refs(request.inputGenerationRefs)}</span></span>
            <span>base commit: <span className="mc-mono">{request.baseCommit}</span></span>
          </li>)}
        </ol> : <p className="entity-note">No iteration requests yet.</p>}
      </section>

      <section aria-label="Receipt lineage">
        <h5>Receipt lineage</h5>
        {participant.receipts.length ? <ol>
          {participant.receipts.map((receipt) => <li key={receipt.receiptRef}>
            <span><span className="mc-mono">{receipt.receiptRef}</span> · {receipt.verdict}</span>
            <span>inputs: <span className="mc-mono">{refs(receipt.inputGenerationRefs)}</span></span>
            <span>outputs: <span className="mc-mono">{refs(receipt.outputGenerationRefs)}</span></span>
            <span>base commit: <span className="mc-mono">{receipt.baseCommit}</span></span>
            <span>canonical commit: <span className="mc-mono">{receipt.canonicalCommit}</span></span>
          </li>)}
        </ol> : <p className="entity-note">No iteration receipts yet.</p>}
      </section>

      {positions.length || dissent.length ? <section aria-label="Positions and dissent">
        <h5>Positions and dissent</h5>
        {positions.map((position) => <p key={`position-${position.positionId}`}><strong>{position.participantId}:</strong> {position.summary} <span className="mc-mono">{refs(position.generationRefs)}</span></p>)}
        {dissent.map((item) => <p key={`dissent-${item.dissentId}`}><strong>Dissent · {item.participantId}:</strong> {item.summary}</p>)}
      </section> : null}

      {residue ? <section className="v-agent-work-panel__residue" aria-label="Unresolved parked residue">
        <h5>Unresolved parked residue</h5>
        {residue.failureReason ? <p>{residue.failureReason}</p> : null}
        {residue.unresolvedFindings.map((finding) => <p key={finding.findingId}>{finding.severity}: {finding.summary} · {refs(finding.evidencePaths)}</p>)}
        <p>requests: <span className="mc-mono">{refs(residue.requestRefs)}</span></p>
        <p>receipts: <span className="mc-mono">{refs(residue.receiptRefs)}</span></p>
        {residue.attemptedRequestRef ? <p>attempted request: <span className="mc-mono">{residue.attemptedRequestRef}</span></p> : null}
        {(residue.artifactSnapshots ?? []).map((snapshot) => <p key={snapshot.path}>
          <span className="mc-mono">{snapshot.path}</span> · {snapshot.byteIdentical ? 'byte-identical' : 'changed'} · {snapshot.afterSize ?? 'missing'} bytes
        </p>)}
      </section> : null}
    </article>
  );
}

export function AgentWorkPanel({
  runRef,
  agentId,
  participantStageKey,
  run,
  overlay,
  sse,
  onClose,
  onRespondRequest,
  busy = false,
}: {
  runRef: string;
  agentId: string;
  participantStageKey?: string;
  run: RunDetailDto;
  overlay: AgentRunOverlay | undefined;
  sse: UseSseResult;
  onClose: () => void;
  onRespondRequest: (request: HumanRequestDto, decision: HumanRequestDecision, response: string) => void;
  busy?: boolean;
}): React.JSX.Element {
  const { session, requireSession } = useSession();
  const attemptRef = overlay?.attemptRef ?? latestAttemptRefOfAgent(run, agentId);
  const participantStages = participantStageKey
    ? (overlay?.participantStages ?? []).filter((participant) => participant.key === participantStageKey)
    : (overlay?.participantStages ?? []);
  const { lines, live } = useAttemptIo({ runRef, attemptRef, sse, maxLines: 200 });
  const stream = useRef<HTMLOListElement>(null);
  const nearBottom = useRef(true);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [deliveryNotice, setDeliveryNotice] = useState<string | null>(null);
  const stageRefs = new Set(run.stages
    .filter((stage) => (stage.assignment?.agentId ?? '') === agentId)
    .map((stage) => stage.stageRef));
  const iterationGateRefs = new Set((run.iterationLoops ?? []).flatMap((loop) =>
    [loop.completionGateRef, loop.interventionRef].filter((ref): ref is string => ref !== undefined)));
  const requests = run.humanRequests.filter((request) => request.state === 'open'
    && request.gateKind !== 'iteration-park' && !iterationGateRefs.has(request.requestRef)
    && request.stageRef !== null && stageRefs.has(request.stageRef));
  const acceptsInput = agentId !== '' && !!session && !!overlay && !terminalStates.has(overlay.state);
  const composerHint = !session
    ? 'Unlock the dashboard to message this agent.'
    : !overlay
      ? 'This agent has no live or queued attempt to receive a message.'
      : terminalStates.has(overlay.state)
        ? 'This agent is no longer accepting messages.'
        : null;

  useEffect(() => {
    if (!nearBottom.current || !stream.current) return;
    stream.current.scrollTop = stream.current.scrollHeight;
  }, [lines]);

  const send = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const text = message.trim();
    if (!text || sending || !acceptsInput) return;
    setSending(true);
    setDeliveryNotice(null);
    try {
      const token = (await requireSession())?.token;
      if (!token) {
        setDeliveryNotice('The dashboard is locked — your message was not delivered.');
        return;
      }
      const result = await postAgentMessage(runRef, agentId, text, token);
      if ('offline' in result) {
        setDeliveryNotice('This agent is offline — your message was not delivered.');
      } else {
        setMessage('');
        setDeliveryNotice(result.delivery === 'queued' ? 'Queued for its next turn.' : 'Delivered live.');
      }
    } catch (cause) {
      setDeliveryNotice(cause instanceof Error ? cause.message : 'The message was refused.');
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="v-agent-work-panel" data-testid={`agent-work-panel-${agentId || 'unresolved'}`} aria-label={`${agentId || 'Unresolved'} workings`}>
      <header className="v-agent-work-panel__head">
        <div className="v-agent-work-panel__identity">
          <h3>{agentId || 'No default agent'}</h3>
          {overlay ? <span className={`entity-chip v-agent-state v-agent-state--${overlay.state}`}>{overlay.state}</span> : null}
          {live ? <span className="v-agent-work-panel__live" aria-label="live output">live</span> : null}
        </div>
        <button type="button" className="v-agent-work-panel__close" aria-label="Close panel" onClick={onClose}>×</button>
      </header>

      <ol className="v-agent-work-panel__stream mc-mono" data-testid="agent-work-panel-stream" aria-label={`${agentId || 'Unresolved'} live stream`}
        ref={stream} onScroll={(event) => {
          const target = event.currentTarget;
          nearBottom.current = target.scrollHeight - target.scrollTop - target.clientHeight < 24;
        }}>
        {lines.length ? lines.map((item) => (
          <li key={item.seq} className={`v-agent-work-panel__line v-agent-work-panel__line--${item.dir}`}>
            {item.dir === 'in' ? '› ' : ''}{item.line}
          </li>
        )) : <li className="v-agent-work-panel__empty">no live output for this agent yet</li>}
      </ol>

      {participantStages.length ? (
        <section className="v-agent-work-panel__iterations" aria-label="Iteration participant details">
          <h4>Loop detail</h4>
          {participantStages.map((participant) => <ParticipantIterationDetail key={participant.key} participant={participant} />)}
        </section>
      ) : null}

      {requests.length ? (
        <section className="v-agent-work-panel__gates" aria-label="Waiting on you">
          <h4>Waiting on you</h4>
          {requests.map((request) => (
            <HumanRequestCard key={request.requestRef} request={request} busy={busy}
              onRespond={(decision, response) => onRespondRequest(request, decision, response)} />
          ))}
        </section>
      ) : null}

      {agentId ? (
        <form className="v-agent-work-panel__composer" data-testid="agent-work-panel-composer" onSubmit={(event) => void send(event)}>
          <label className="sr-only" htmlFor={`agent-work-panel-message-${agentId}`}>Message {agentId}</label>
          <textarea id={`agent-work-panel-message-${agentId}`} value={message} onChange={(event) => setMessage(event.target.value)}
            placeholder="Message this agent" rows={3} disabled={sending || !acceptsInput} />
          <div className="v-agent-work-panel__composer-actions">
            <button type="submit" className="mc-btn" disabled={sending || !acceptsInput || message.trim() === ''}>{sending ? 'Sending…' : 'Send'}</button>
            {composerHint ? <span className="control-help" data-testid="agent-work-panel-composer-hint">{composerHint}</span> : null}
          </div>
          {deliveryNotice ? <p className="v-agent-work-panel__delivery" role="status">{deliveryNotice}</p> : null}
        </form>
      ) : null}
    </section>
  );
}
