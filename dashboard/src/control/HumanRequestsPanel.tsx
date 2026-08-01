import { useCallback, useEffect, useState } from 'react';
import { SESSION_INVALIDATED_EVENT } from '../lib/authClient';
import {
  activateRun,
  getRun,
  listRuns,
  recoverAuthorized20260731ExecutionLock,
  resolveReviewCompletionGate,
  respondToHumanRequest,
  resumeRunAfterHumanResponse,
  type HumanRequestDecision,
  type HumanRequestDto,
  type RunDetailDto,
  type RunMetadataDto,
} from './controlClient';
import type { FetchLike } from './controlClient';
import { canResumePublishedRun, decisionsForHumanRequest } from './humanBoundaries';

function requestKey(request: HumanRequestDto, decision: HumanRequestDecision): string {
  return `human:${request.requestRef}:${request.revision}:${decision}`;
}

type LegacyRecoveryBinding = {
  expectedRunVersion: number;
  expectedManagerGeneration: number;
  expectedRequestRevision: number;
  idempotencyKey: string;
};
type OpenRequest = { request: HumanRequestDto; completionGate: boolean; legacyRecovery: LegacyRecoveryBinding | null };
type ResumeBinding = Pick<RunDetailDto['run'], 'runRef' | 'version' | 'managerGeneration' | 'proposalHash'>;
type StrandedRun = { run: RunMetadataDto; resumeBinding: ResumeBinding | null };

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
  const [requests, setRequests] = useState<OpenRequest[]>([]);
  // Runs stuck `waiting-human` with NO open request — otherwise unreachable from the UI, so surface them.
  // Only exact accepted-boundary details receive an activate-only recovery action.
  const [strandedRuns, setStrandedRuns] = useState<StrandedRun[]>([]);
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
    setRequests(details.flatMap((detail: RunDetailDto) => detail.humanRequests
      .filter((request) => request.state === 'open')
      .map((request) => {
        const exactLegacyMarker = detail.run.runRef === 'run-0aa72053-b9d7-41fa-a034-19871b66d214'
          && detail.run.publicationState === 'published' && detail.run.state === 'waiting-human'
          && detail.run.version === 4 && detail.run.managerGeneration === 1
          && request.requestRef === 'request-86d0fc5f-797b-483c-a706-96a45e6f4d6e'
          && request.runRef === detail.run.runRef && request.stageRef === null
          && request.kind === 'governance-refusal' && request.revision === 1 && request.response === null
          && request.title === 'Automatic execution activation is gated'
          && request.prompt === 'Canonical cards are published, but the daemon Broker/execution adapters are not activated. Complete the separate runtime approval before release.';
        return {
          request,
          completionGate: detail.reviewReceipts?.some((receipt) => receipt.completionRequestRef === request.requestRef) ?? false,
          legacyRecovery: exactLegacyMarker ? {
            expectedRunVersion: detail.run.version,
            expectedManagerGeneration: detail.run.managerGeneration,
            expectedRequestRevision: request.revision,
            idempotencyKey: `legacy-execution-lock-recovery:${detail.run.runRef}:${request.requestRef}:r${request.revision}`,
          } : null,
        };
      })));
    const detailByRun = new Map(details.map((detail) => [detail.run.runRef, detail]));
    setStrandedRuns(runs
      .filter((run) => run.state === 'waiting-human' && run.openHumanRequestCount === 0)
      .map((run) => {
        const detail = detailByRun.get(run.runRef);
        return { run, resumeBinding: detail && canResumePublishedRun(detail) ? detail.run : null };
      }));
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

  const respond = ({ request, completionGate }: OpenRequest, decision: HumanRequestDecision): void => {
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    const mutation = completionGate
      ? resolveReviewCompletionGate(request.requestRef, {
          expectedRequestRevision: request.revision,
          decision: decision as Extract<HumanRequestDecision, 'approved' | 'rejected' | 'changes-requested'>,
          idempotencyKey: requestKey(request, decision), response: responses[request.requestRef]?.trim() || null,
        }, token, fetchImpl)
      : respondToHumanRequest(request.requestRef, {
          expectedRevision: request.revision, decision, idempotencyKey: requestKey(request, decision),
          response: responses[request.requestRef]?.trim() || null,
        }, token, fetchImpl);
    void mutation
      .then(async () => {
        if ((!completionGate && (decision === 'approved' || decision === 'responded')) || (completionGate && decision === 'approved')) {
          await resumeRunAfterHumanResponse(request.runRef, token, fetchImpl);
        }
        await refresh(token);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Human response was refused.'))
      .finally(() => setBusy(false));
  };

  const resume = (binding: ResumeBinding): void => {
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    void activateRun(binding, token, fetchImpl)
      .then(() => refresh(token))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Run resume was refused.'))
      .finally(() => setBusy(false));
  };

  const recoverLegacyBoundary = (binding: LegacyRecoveryBinding): void => {
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    void recoverAuthorized20260731ExecutionLock(binding, token, fetchImpl)
      .then(() => refresh(token))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Legacy boundary recovery was refused.'))
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
      {strandedRuns.map(({ run, resumeBinding }) => (
        <article key={run.runRef} className="control-request control-request--stranded" data-testid={`waiting-no-request-${run.runRef}`}>
          <p className="control-eyebrow">waiting-human · no open request</p>
          <h3>{run.title}</h3>
          <p>{resumeBinding
            ? 'The request is resolved. Resume this existing run when execution is active.'
            : 'This run is waiting on a human with NO open request — inspect the run to see why it is parked.'}</p>
          {resumeBinding ? (
            <button type="button" className="mc-btn mc-btn--primary" disabled={busy} onClick={() => resume(resumeBinding)}>
              Resume run
            </button>
          ) : null}
          <p className="control-help mc-mono" data-testid={`inspect-run-${run.runRef}`}>run {run.runRef}</p>
        </article>
      ))}
      {requests.map(({ request, completionGate, legacyRecovery }) => (
        <article key={request.requestRef} className="control-request" data-review-completion-gate={completionGate || undefined}>
          <p className="control-eyebrow">{request.kind} · revision {request.revision} · run {request.runRef}</p>
          <h3>{completionGate ? `Review completion gate: ${request.title}` : request.title}</h3>
          <p>{request.prompt}</p>
          {legacyRecovery ? (
            <div className="control-actions">
              <button type="button" className="mc-btn mc-btn--primary" disabled={busy} onClick={() => recoverLegacyBoundary(legacyRecovery)}>
                Repair execution-lock boundary
              </button>
            </div>
          ) : (
            <>
              <label htmlFor={`inbox-response-${request.requestRef}`}>Response</label>
              <textarea
                id={`inbox-response-${request.requestRef}`}
                value={responses[request.requestRef] ?? ''}
                onChange={(event) => setResponses((current) => ({ ...current, [request.requestRef]: event.target.value }))}
                disabled={busy}
              />
              <div className="control-actions">
                {decisionsForHumanRequest(request.kind).map((decision) => (
                  <button key={decision} type="button" className={decision === 'approved' ? 'mc-btn mc-btn--primary' : 'mc-btn'} disabled={busy} onClick={() => respond({ request, completionGate, legacyRecovery: null }, decision)}>
                    {decision === 'changes-requested' ? 'Request changes' : decision[0].toUpperCase() + decision.slice(1)}
                  </button>
                ))}
              </div>
            </>
          )}
        </article>
      ))}
    </section>
  );
}
