import { useState } from 'react';
import type { HumanRequestDecision, HumanRequestDto } from '../control/controlClient';
import { decisionsForHumanRequest } from '../control/humanBoundaries';

export function HumanRequestCard({
  request,
  busy,
  onRespond,
  showPrompt = false,
}: {
  request: HumanRequestDto;
  busy: boolean;
  onRespond: (decision: HumanRequestDecision, response: string) => void;
  showPrompt?: boolean;
}): React.JSX.Element {
  const [response, setResponse] = useState('');

  return (
    <article className="control-request" data-testid={`run-gate-${request.requestRef}`}>
      {/* spec §3b — the ASK leads: what happened and what you can do, in the server's one plain
        * sentence. The machine's own words (traceback, refusal code) are a fold below it, never
        * the thing the operator is asked to answer. */}
      <h4>{request.ask}</h4>
      {showPrompt ? <p>{request.prompt}</p> : null}
      {request.technicalDetail ? (
        <details className="entity-fold" data-testid={`run-gate-technical-${request.requestRef}`}>
          <summary>Technical details</summary>
          <pre className="entity-fold__body run-gate__technical">{request.technicalDetail}</pre>
        </details>
      ) : null}
      <label htmlFor={`response-${request.requestRef}`}>Your answer</label>
      <textarea
        id={`response-${request.requestRef}`}
        value={response}
        onChange={(event) => setResponse(event.target.value)}
        disabled={busy}
      />
      <div className="control-actions">
        {decisionsForHumanRequest(request.kind).map((decision) => (
          <button
            key={decision}
            type="button"
            className={decision === 'approved' ? 'mc-btn mc-btn--primary' : 'mc-btn'}
            disabled={busy}
            onClick={() => onRespond(decision, response.trim())}
          >
            {decision === 'changes-requested' ? 'Request changes' : decision[0].toUpperCase() + decision.slice(1)}
          </button>
        ))}
      </div>
    </article>
  );
}
