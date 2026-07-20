import { useCallback, useEffect, useState } from 'react';
import { SESSION_INVALIDATED_EVENT } from '../lib/authClient';
import {
  createManagerSuccessor,
  getProposalRevision,
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
import { RunGrid } from './RunGrid';
import { RetentionPanel } from './RetentionPanel';
import type { NavTarget } from '../nav/stack';

function idempotencyKey(request: HumanRequestDto, decision: HumanRequestDecision): string {
  return `human:${request.requestRef}:${request.revision}:${decision}`;
}

function operationKey(prefix: string): string {
  return `${prefix}:${typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Date.now().toString(36)}`;
}

export interface ManagedRunsProps {
  sessionToken?: string;
  onRequestSession?: () => Promise<{ token: string } | null>;
  /** Runs supplied directly (tests) instead of self-fetching. */
  runs?: RunMetadataDto[];
  /**
   * The open run, driven by the nav stack. When `onOpenRun` is omitted the component falls back to
   * its own local state so it stays usable (and testable) standalone.
   */
  focusRunRef?: string | null;
  onOpenRun?: (runRef: string) => void;
  onBackToRuns?: () => void;
  /** The detail tab the nav stack wants restored, and the writer that records tab changes into it. */
  activeSectionId?: string;
  onSectionChange?: (id: string) => void;
  /** Cross-entity navigation out of the detail (a stage's canonical queue card). */
  onNavigate?: (target: NavTarget) => void;
  /** Injectable clock so run-card ages are deterministic under test. */
  now?: number;
}

/**
 * The managed run surface: a wrapping grid of full-text run cards, and — once a card is opened — that
 * run's detail in its place, with a back affordance provided by the nav stack.
 *
 * The grid replaced a horizontal `<nav>` of ellipsis-clipped buttons. Opening a run REPLACES the grid
 * rather than appending a panel below it, so the operator is looking at exactly one thing.
 */
export function ManagedRuns({
  sessionToken,
  onRequestSession,
  runs: injectedRuns,
  focusRunRef,
  onOpenRun,
  onBackToRuns,
  activeSectionId,
  onSectionChange,
  onNavigate,
  now,
}: ManagedRunsProps): React.JSX.Element {
  const [localToken, setLocalToken] = useState(sessionToken);
  const [runs, setRuns] = useState<RunMetadataDto[]>(injectedRuns ?? []);
  // Uncontrolled fallback for the open run when no nav stack is wired above this component.
  const [localOpenRef, setLocalOpenRef] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunDetailDto | null>(null);
  const [events, setEvents] = useState<OperationalEventDto[]>([]);
  const [checkpoints, setCheckpoints] = useState<Array<{ id: string; label: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openRunRef = onOpenRun ? focusRunRef ?? null : localOpenRef;

  useEffect(() => { if (sessionToken) setLocalToken(sessionToken); }, [sessionToken]);
  useEffect(() => { if (injectedRuns) setRuns(injectedRuns); }, [injectedRuns]);
  useEffect(() => {
    const invalidate = (): void => setLocalToken(undefined);
    window.addEventListener(SESSION_INVALIDATED_EVENT, invalidate);
    return () => window.removeEventListener(SESSION_INVALIDATED_EVENT, invalidate);
  }, []);
  const token = sessionToken ?? localToken;

  /**
   * Load a run's detail, its events, and the compiled checkpoint names.
   *
   * The checkpoint list comes from the already-approved proposal revision through the EXISTING
   * revision endpoint — it turns the steering control from a free-text field the operator had to type
   * from memory into a pick list. A failure here is non-fatal: steering degrades to free text rather
   * than becoming unavailable.
   */
  const loadRun = useCallback(async (runRef: string, activeToken: string): Promise<void> => {
    const [nextDetail, nextEvents] = await Promise.all([
      getRun(runRef, activeToken),
      listRunEvents(runRef, 0, 500, activeToken),
    ]);
    setDetail(nextDetail);
    setEvents(nextEvents);
    try {
      const revision = await getProposalRevision(nextDetail.run.proposalRef, nextDetail.run.proposalRevision, activeToken);
      const seen = new Map<string, { id: string; label: string }>();
      for (const stage of revision.proposal.stages) {
        for (const point of stage.checkpoints) if (!seen.has(point.id)) seen.set(point.id, point);
      }
      setCheckpoints([...seen.values()]);
    } catch {
      setCheckpoints([]);
    }
  }, []);

  const refresh = useCallback(async (activeToken: string): Promise<void> => {
    setRuns(await listRuns(activeToken));
  }, []);

  // List load. Opening a run is a separate, explicit act — the surface no longer auto-opens the first
  // run's detail, because the grid IS the landing state.
  useEffect(() => {
    if (!token || injectedRuns) return;
    let alive = true;
    refresh(token).catch((cause: unknown) => {
      if (alive) setError(cause instanceof Error ? cause.message : 'Could not load managed runs.');
    });
    return () => { alive = false; };
  }, [refresh, token, injectedRuns]);

  // Detail load, driven by whichever run the nav stack (or the local fallback) has open.
  useEffect(() => {
    if (!token || !openRunRef) {
      setDetail(null);
      setEvents([]);
      setCheckpoints([]);
      return;
    }
    let alive = true;
    loadRun(openRunRef, token).catch((cause: unknown) => {
      if (alive) setError(cause instanceof Error ? cause.message : 'Could not load run.');
    });
    return () => { alive = false; };
  }, [loadRun, openRunRef, token]);

  const unlock = (): void => {
    void (async () => {
      const session = await onRequestSession?.();
      if (session) setLocalToken(session.token);
    })();
  };

  const openRun = (runRef: string): void => {
    setError(null);
    if (onOpenRun) onOpenRun(runRef);
    else setLocalOpenRef(runRef);
  };

  const back = (): void => {
    setError(null);
    if (onBackToRuns) onBackToRuns();
    else setLocalOpenRef(null);
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
      // Follow the successor: the operator's attention belongs on the run they just created.
      openRun(successor.runRef);
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

  const managerRunning = detail?.sessions.some(
    (session) => session.sessionRef === detail.run.managerSessionRef && session.state === 'running',
  );

  return (
    <section className="control-managed-runs" aria-label="Managed runs">
      {detail && openRunRef ? (
        <>
          {error ? <p role="alert" className="control-managed-runs__error">{error}</p> : null}
          <RunCockpit
            detail={detail}
            events={events}
            busy={busy}
            checkpoints={checkpoints}
            activeSectionId={activeSectionId}
            onSectionChange={onSectionChange}
            onBack={back}
            backLabel="All runs"
            onNavigate={onNavigate}
            onManagerMessage={managerRunning ? managerMessage : undefined}
            onSteer={managerRunning ? steer : undefined}
            onStop={detail.sessions.some((session) => session.state === 'running') ? stop : undefined}
            onRetry={['failed', 'stopped', 'interrupted'].includes(detail.run.state) ? retry : undefined}
            onManagerSuccessor={detail.sessions.some((session) => session.sessionRef === detail.run.managerSessionRef
              && ['interrupted', 'failed', 'stopped', 'completed'].includes(session.state)) ? recoverManager : undefined}
            onReroute={reroute}
            onHumanResponse={respond}
          />
        </>
      ) : (
        <>
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
          {runs.length ? (
            <RunGrid runs={runs} selectedRunRef={openRunRef} onSelect={openRun} now={now} />
          ) : null}
          {token && runs.length === 0 ? <p className="control-help">No managed proposal runs yet.</p> : null}
        </>
      )}
    </section>
  );
}
