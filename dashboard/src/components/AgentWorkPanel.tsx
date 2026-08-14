import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { HumanRequestDecision, HumanRequestDto, RunDetailDto } from '../control/controlClient';
import { postAgentMessage } from '../control/agentMessages';
import { latestAttemptRefOfAgent, type AgentRunOverlay } from '../control/runGraph';
import { useAttemptIo } from '../lib/useAttemptIo';
import { useSession } from '../lib/sessionContext';
import type { UseSseResult } from '../lib/sseClient';
import { HumanRequestCard } from './HumanRequestCard';

const terminalStates = new Set<AgentRunOverlay['state']>(['succeeded', 'failed', 'stopped', 'interrupted']);

export function AgentWorkPanel({
  runRef,
  agentId,
  run,
  overlay,
  sse,
  onClose,
  onRespondRequest,
  busy = false,
}: {
  runRef: string;
  agentId: string;
  run: RunDetailDto;
  overlay: AgentRunOverlay | undefined;
  sse: UseSseResult;
  onClose: () => void;
  onRespondRequest: (request: HumanRequestDto, decision: HumanRequestDecision, response: string) => void;
  busy?: boolean;
}): React.JSX.Element {
  const { session, requireSession } = useSession();
  const attemptRef = overlay?.attemptRef ?? latestAttemptRefOfAgent(run, agentId);
  const { lines, live } = useAttemptIo({ runRef, attemptRef, sse, maxLines: 200 });
  const stream = useRef<HTMLOListElement>(null);
  const nearBottom = useRef(true);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [deliveryNotice, setDeliveryNotice] = useState<string | null>(null);
  const stageRefs = new Set(run.stages
    .filter((stage) => (stage.assignment?.agentId ?? '') === agentId)
    .map((stage) => stage.stageRef));
  const requests = run.humanRequests.filter((request) => request.state === 'open'
    && (request as HumanRequestDto & { gateKind?: string }).gateKind !== 'iteration-park'
    && request.stageRef !== null && stageRefs.has(request.stageRef));
  const completionRequestRefs = new Set((run.reviewReceipts ?? [])
    .map((receipt) => receipt.completionRequestRef)
    .filter((ref): ref is string => ref !== null));
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

      {requests.length ? (
        <section className="v-agent-work-panel__gates" aria-label="Waiting on you">
          <h4>Waiting on you</h4>
          {requests.map((request) => (
            <HumanRequestCard key={request.requestRef} request={request} busy={busy}
              showPrompt={completionRequestRefs.has(request.requestRef)}
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
