import { useCallback, useEffect, useState } from 'react';
import { SESSION_INVALIDATED_EVENT } from '../lib/authClient';
import {
  getRun,
  listRuns,
  respondToHumanRequest,
  resumeRunAfterHumanResponse,
  type HumanRequestDecision,
  type HumanRequestDto,
  type RunMetadataDto,
} from './controlClient';
import type { FetchLike } from './controlClient';
import { decisionsForHumanRequest } from './humanBoundaries';

function requestKey(request: HumanRequestDto, decision: HumanRequestDecision): string {
  return `human:${request.requestRef}:${request.revision}:${decision}`;
}

export function HumanRequestsPanel({
  sessionToken,
  onRequestSession,
  fetchImpl,
}: {
  sessionToken?: string;
  onRequestSession?: () => Promise<{ token: string } | null>;
  fetchImpl?: FetchLike;
}): React.JSX.Element {
  const [localToken, setLocalToken] = useState(sessionToken);
  const [requests, setRequests] = useState<HumanRequestDto[]>([]);
  // Runs stuck `waiting-human` with NO open request — otherwise unreachable from the UI, so surface them
  // as a distinct, non-actionable "inspect run" row rather than letting them hang invisibly (audit gap #3).
  const [strandedRuns, setStrandedRuns] = useState<RunMetadataDto[]>([]);
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (sessionToken) setLocalToken(sessionToken); }, [sessionToken]);
  useEffect(() => {
    const invalidate = (): void => setLocalToken(undefined);
    window.addEventListener(SESSION_INVALIDATED_EVENT, invalidate);
    return () => window.removeEventListener(SESSION_INVALIDATED_EVENT, invalidate);
  }, []);
  const token = sessionToken ?? localToken;

  const refresh = useCallback(async (activeToken: string): Promise<void> => {
    const runs = await listRuns(activeToken, fetchImpl);
    // Widen beyond "has open requests" to also pull `waiting-human` runs — a run can be parked waiting on a
    // human with zero open requests, a state otherwise invisible in both feeds.
    const active = runs.filter((run) => run.openHumanRequestCount > 0 || run.state === 'waiting-human');
    const details = await Promise.all(active.map((run) => getRun(run.runRef, activeToken, fetchImpl)));
    setRequests(details.flatMap((detail) => detail.humanRequests).filter((request) => request.state === 'open'));
    setStrandedRuns(runs.filter((run) => run.state === 'waiting-human' && run.openHumanRequestCount === 0));
  }, [fetchImpl]);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    refresh(token).catch((cause: unknown) => {
      if (alive) setError(cause instanceof Error ? cause.message : 'Could not load Human Requests.');
    });
    return () => { alive = false; };
  }, [refresh, token]);

  const unlock = (): void => {
    void onRequestSession?.().then((session) => { if (session) setLocalToken(session.token); });
  };

  const respond = (request: HumanRequestDto, decision: HumanRequestDecision): void => {
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    void respondToHumanRequest(request.requestRef, {
      expectedRevision: request.revision,
      decision,
      idempotencyKey: requestKey(request, decision),
      response: responses[request.requestRef]?.trim() || null,
    }, token, fetchImpl)
      .then(async () => {
        if (decision === 'approved' || decision === 'responded') {
          await resumeRunAfterHumanResponse(request.runRef, token, fetchImpl);
        }
        await refresh(token);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Human response was refused.'))
      .finally(() => setBusy(false));
  };

  return (
    <section className="control-inbox-requests mc-panel" aria-label="Managed Human Requests">
      <header className="control-managed-runs__head">
        <div><h2>Run requests</h2><p>Durable, revision-bound requests from managed runs.</p></div>
        {token ? <button type="button" className="mc-btn" disabled={busy} onClick={() => void refresh(token)}>Refresh</button> : (
          <button type="button" className="mc-btn mc-btn--primary" onClick={unlock}>Unlock run requests</button>
        )}
      </header>
      {error ? <p role="alert">{error}</p> : null}
      {token && requests.length === 0 && strandedRuns.length === 0 ? <p className="control-help">No managed run requests need attention.</p> : null}
      {strandedRuns.map((run) => (
        <article key={run.runRef} className="control-request control-request--stranded" data-testid={`waiting-no-request-${run.runRef}`}>
          <p className="control-eyebrow">waiting-human · no open request</p>
          <h3>{run.title}</h3>
          <p>This run is waiting on a human with NO open request — inspect the run to see why it is parked.</p>
          {/* No actionable control here: with no open request there is nothing to approve/respond. The run
              ref is the handle the operator uses to open it in the Governed runs view. */}
          <p className="control-help mc-mono" data-testid={`inspect-run-${run.runRef}`}>run {run.runRef}</p>
        </article>
      ))}
      {requests.map((request) => (
        <article key={request.requestRef} className="control-request">
          <p className="control-eyebrow">{request.kind} · revision {request.revision} · run {request.runRef}</p>
          <h3>{request.title}</h3>
          <p>{request.prompt}</p>
          <label htmlFor={`inbox-response-${request.requestRef}`}>Response</label>
          <textarea
            id={`inbox-response-${request.requestRef}`}
            value={responses[request.requestRef] ?? ''}
            onChange={(event) => setResponses((current) => ({ ...current, [request.requestRef]: event.target.value }))}
            disabled={busy}
          />
          <div className="control-actions">
            {decisionsForHumanRequest(request.kind).map((decision) => (
              <button key={decision} type="button" className={decision === 'approved' ? 'mc-btn mc-btn--primary' : 'mc-btn'} disabled={busy} onClick={() => respond(request, decision)}>
                {decision === 'changes-requested' ? 'Request changes' : decision[0].toUpperCase() + decision.slice(1)}
              </button>
            ))}
          </div>
        </article>
      ))}
    </section>
  );
}
