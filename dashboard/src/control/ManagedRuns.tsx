import { useCallback, useEffect, useState } from 'react';
import { SESSION_INVALIDATED_EVENT } from '../lib/authClient';
import {
  createManagerSuccessor,
  getRun,
  listRunEvents,
  listRuns,
  launchProposalRevision,
  respondToHumanRequest,
  rerouteManagedStage,
  resumeRunAfterHumanResponse,
  sendManagerMessage,
  steerManagerAtCheckpoint,
  stopManager,
  type HumanRequestDecision,
  type HumanRequestDto,
  type OperationalEventDto,
  type AttemptDto,
  type RunDetailDto,
  type RunMetadataDto,
  type StageDto,
} from './controlClient';
import { RunCockpit } from './RunCockpit';
import { RetentionPanel } from './RetentionPanel';

function idempotencyKey(request: HumanRequestDto, decision: HumanRequestDecision): string {
  return `human:${request.requestRef}:${request.revision}:${decision}`;
}

function operationKey(prefix: string): string {
  return `${prefix}:${typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Date.now().toString(36)}`;
}

export interface ManagedRunsProps {
  sessionToken?: string;
  onRequestSession?: () => Promise<{ token: string } | null>;
}

/** Authenticated durable run projection. The older queue-card graph remains available below it. */
export function ManagedRuns({ sessionToken, onRequestSession }: ManagedRunsProps): React.JSX.Element {
  const [localToken, setLocalToken] = useState(sessionToken);
  const [runs, setRuns] = useState<RunMetadataDto[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunDetailDto | null>(null);
  const [events, setEvents] = useState<OperationalEventDto[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (sessionToken) setLocalToken(sessionToken); }, [sessionToken]);
  useEffect(() => {
    const invalidate = (): void => setLocalToken(undefined);
    window.addEventListener(SESSION_INVALIDATED_EVENT, invalidate);
    return () => window.removeEventListener(SESSION_INVALIDATED_EVENT, invalidate);
  }, []);
  const token = sessionToken ?? localToken;

  const loadRun = useCallback(async (runRef: string, activeToken: string): Promise<void> => {
    const [nextDetail, nextEvents] = await Promise.all([
      getRun(runRef, activeToken),
      listRunEvents(runRef, 0, 500, activeToken),
    ]);
    setDetail(nextDetail);
    setEvents(nextEvents);
  }, []);

  const refresh = useCallback(async (activeToken: string): Promise<void> => {
    const nextRuns = await listRuns(activeToken);
    setRuns(nextRuns);
    const nextSelected = selected && nextRuns.some((run) => run.runRef === selected)
      ? selected
      : nextRuns[0]?.runRef ?? null;
    setSelected(nextSelected);
    if (nextSelected) await loadRun(nextSelected, activeToken);
    else { setDetail(null); setEvents([]); }
  }, [loadRun, selected]);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    refresh(token).catch((cause: unknown) => {
      if (alive) setError(cause instanceof Error ? cause.message : 'Could not load managed runs.');
    });
    return () => { alive = false; };
  }, [refresh, token]);

  const unlock = (): void => {
    void (async () => {
      const session = await onRequestSession?.();
      if (session) setLocalToken(session.token);
    })();
  };

  const select = (runRef: string): void => {
    if (!token) return;
    setSelected(runRef);
    setError(null);
    void loadRun(runRef, token).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Could not load run.'));
  };

  const respond = (request: HumanRequestDto, decision: HumanRequestDecision, response: string): void => {
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    void respondToHumanRequest(request.requestRef, {
      expectedRevision: request.revision,
      decision,
      idempotencyKey: idempotencyKey(request, decision),
      response: response || null,
    }, token)
      .then(async () => {
        if (decision === 'approved' || decision === 'responded') await resumeRunAfterHumanResponse(request.runRef, token);
        await loadRun(request.runRef, token);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Human response was refused.'))
      .finally(() => setBusy(false));
  };

  const managerMessage = async (message: string): Promise<void> => {
    if (!token || !detail || busy) return;
    setBusy(true);
    setError(null);
    try {
      await sendManagerMessage(detail.run.runRef, {
        expectedRunVersion: detail.run.version,
        expectedManagerGeneration: detail.run.managerGeneration,
        idempotencyKey: operationKey(`manager-message:${detail.run.runRef}`), message,
      }, token);
      await loadRun(detail.run.runRef, token);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Manager message was refused.');
    } finally { setBusy(false); }
  };

  const steer = async (checkpoint: string, instruction: string): Promise<void> => {
    if (!token || !detail || busy) return;
    setBusy(true);
    setError(null);
    try {
      await steerManagerAtCheckpoint(detail.run.runRef, {
        expectedRunVersion: detail.run.version,
        expectedManagerGeneration: detail.run.managerGeneration,
        idempotencyKey: operationKey(`manager-steer:${detail.run.runRef}`), checkpoint, instruction,
      }, token);
      await loadRun(detail.run.runRef, token);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Manager steering was refused.');
    } finally { setBusy(false); }
  };

  const stop = async (): Promise<void> => {
    if (!token || !detail || busy) return;
    setBusy(true);
    setError(null);
    try {
      await stopManager(detail.run.runRef, {
        expectedRunVersion: detail.run.version,
        expectedManagerGeneration: detail.run.managerGeneration,
        idempotencyKey: `manager-stop:${detail.run.runRef}:${detail.run.managerGeneration}`,
      }, token);
      await loadRun(detail.run.runRef, token);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Run stop was refused.');
    } finally { setBusy(false); }
  };

  const retry = async (): Promise<void> => {
    if (!token || !detail || busy) return;
    setBusy(true);
    setError(null);
    try {
      const successor = await launchProposalRevision(detail.run.proposalRef, detail.run.proposalRevision, {
        expectedHash: detail.run.proposalHash,
        idempotencyKey: `retry:${detail.run.runRef}:${detail.run.version}`,
        predecessorRunRef: detail.run.runRef,
        expectedPredecessorVersion: detail.run.version,
      }, token);
      setSelected(successor.runRef);
      await loadRun(successor.runRef, token);
      setRuns(await listRuns(token));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Run Retry was refused.');
    } finally { setBusy(false); }
  };

  const recoverManager = async (): Promise<void> => {
    if (!token || !detail || busy) return;
    const manager = detail.sessions.find((session) => session.sessionRef === detail.run.managerSessionRef);
    if (!manager) return;
    setBusy(true);
    setError(null);
    try {
      await createManagerSuccessor(detail.run.runRef, {
        expectedManagerGeneration: detail.run.managerGeneration,
        runtime: manager.runtime,
        model: manager.model,
        idempotencyKey: `manager-successor:${detail.run.runRef}:${detail.run.managerGeneration + 1}`,
      }, token);
      await loadRun(detail.run.runRef, token);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Manager successor was refused.');
    } finally { setBusy(false); }
  };

  const reroute = async (stage: StageDto, attempt: AttemptDto, runtime: string, model: string): Promise<void> => {
    if (!token || !detail || busy) return;
    setBusy(true);
    setError(null);
    try {
      await rerouteManagedStage(detail.run.runRef, stage.stageRef, {
        expectedStageVersion: stage.version,
        expectedAttemptRef: attempt.attemptRef,
        expectedAttemptVersion: attempt.version,
        runtime,
        model,
        idempotencyKey: operationKey(`stage-reroute:${stage.stageRef}:${attempt.attemptRef}`),
      }, token);
      await loadRun(detail.run.runRef, token);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Stage reroute was refused.');
    } finally { setBusy(false); }
  };

  return (
    <section className="control-managed-runs" aria-label="Managed runs">
      <header className="control-managed-runs__head">
        <div>
          <h3>Managed run cockpit</h3>
          <p>Durable manager, stage, attempt, worker, event, and Human Request state.</p>
        </div>
        {token ? <button type="button" className="mc-btn" disabled={busy} onClick={() => void refresh(token)}>Refresh</button> : (
          <button type="button" className="mc-btn mc-btn--primary" onClick={unlock}>Unlock cockpit</button>
        )}
      </header>
      {error ? <p role="alert" className="control-managed-runs__error">{error}</p> : null}
      {token ? <RetentionPanel token={token} onChanged={() => refresh(token)} /> : null}
      {token && runs.length ? (
        <nav className="control-managed-runs__tabs" aria-label="Managed run instances">
          {runs.map((run) => (
            <button key={run.runRef} type="button" aria-pressed={selected === run.runRef} onClick={() => select(run.runRef)}>
              <strong>{run.title}</strong>
              <span className="mc-mono">{run.runRef}</span>
              <span>{run.state}{run.openHumanRequestCount ? ` · ${run.openHumanRequestCount} needs you` : ''}</span>
            </button>
          ))}
        </nav>
      ) : null}
      {token && runs.length === 0 ? <p className="control-help">No managed proposal runs yet.</p> : null}
      {detail ? (
        <RunCockpit
          detail={detail}
          events={events}
          busy={busy}
          onManagerMessage={detail.sessions.some((session) => session.sessionRef === detail.run.managerSessionRef && session.state === 'running') ? managerMessage : undefined}
          onSteer={detail.sessions.some((session) => session.sessionRef === detail.run.managerSessionRef && session.state === 'running') ? steer : undefined}
          onStop={detail.sessions.some((session) => session.state === 'running') ? stop : undefined}
          onRetry={['failed', 'stopped', 'interrupted'].includes(detail.run.state) ? retry : undefined}
          onManagerSuccessor={detail.sessions.some((session) => session.sessionRef === detail.run.managerSessionRef
            && ['interrupted', 'failed', 'stopped', 'completed'].includes(session.state)) ? recoverManager : undefined}
          onReroute={reroute}
          onHumanResponse={respond}
        />
      ) : null}
    </section>
  );
}
