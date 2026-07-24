import { useCallback, useEffect, useState } from 'react';
import { SESSION_INVALIDATED_EVENT } from '../lib/authClient';
import {
  activateRun,
  ControlApiError,
  createManagerSuccessor,
  getProposalRevision,
  getRun,
  listRuns,
  launchProposalRevision,
  resolveReviewCompletionGate,
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
import { listProposalRevisions, type ProposalRevisionMetadataDto } from './controlClient';
import '../styles/views/entity.css';
import { loadRunEventWindow, type RunEventWindow } from './runEventWindow';
import { RunCockpit } from './RunCockpit';
import { RunGrid } from './RunGrid';
import { RetentionPanel } from './RetentionPanel';
import { cardOwnerIndex, workflowIdForRun, WORKFLOW_COMPOSER_REF } from './entityLinks';
import type { PlaneAIndex } from '../../server/planeA/indexer';
import type { NavTarget } from '../nav/stack';
import { canResumePublishedRun } from './humanBoundaries';

function idempotencyKey(request: HumanRequestDto, decision: HumanRequestDecision): string {
  return `human:${request.requestRef}:${request.revision}:${decision}`;
}

function isReviewCompletionGate(detail: RunDetailDto | null, request: HumanRequestDto): boolean {
  return detail?.reviewReceipts?.some((receipt) => receipt.completionRequestRef === request.requestRef) ?? false;
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
  /**
   * arc-3 step 2 — link sources, injectable so tests need no fetch mock.
   *
   * `cardIndex` is the Plane-A snapshot (`/api/index`, ungoverned) that carries card owners; `revisions`
   * is the workflow-registry proposal list that carries `sourceTurnId`. Both are link decoration only:
   * either failing leaves the run detail fully functional with fewer edges, never broken.
   */
  cardIndex?: PlaneAIndex;
  revisions?: ProposalRevisionMetadataDto[];
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
  cardIndex,
  revisions: injectedRevisions,
}: ManagedRunsProps): React.JSX.Element {
  const [localToken, setLocalToken] = useState(sessionToken);
  const [index, setIndex] = useState<PlaneAIndex | null>(cardIndex ?? null);
  const [revisions, setRevisions] = useState<ProposalRevisionMetadataDto[]>(injectedRevisions ?? []);
  const [runs, setRuns] = useState<RunMetadataDto[]>(injectedRuns ?? []);
  // Uncontrolled fallback for the open run when no nav stack is wired above this component.
  const [localOpenRef, setLocalOpenRef] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunDetailDto | null>(null);
  const [events, setEvents] = useState<OperationalEventDto[]>([]);
  const [eventWindow, setEventWindow] = useState<RunEventWindow | undefined>(undefined);
  const [checkpoints, setCheckpoints] = useState<Array<{ id: string; label: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * The runRef the server says does not exist. Distinct from `error` on purpose: a missing run is not a
   * transient failure to retry, it is a permanent answer the operator needs stated ("this run is gone"),
   * and it is the ONLY thing that may render in the detail's place.
   */
  const [missingRunRef, setMissingRunRef] = useState<string | null>(null);

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
    const [nextDetail, nextWindow] = await Promise.all([
      getRun(runRef, activeToken),
      // The TAIL of the trace, paged forward through the existing cursor endpoint — see runEventWindow.ts.
      loadRunEventWindow(runRef, activeToken),
    ]);
    setDetail(nextDetail);
    setEvents(nextWindow.events);
    setEventWindow(nextWindow);
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

  /**
   * Detail load, driven by whichever run the nav stack (or the local fallback) has open.
   *
   * The clear at the top is LOAD-BEARING, not tidiness. This effect used to leave `detail` alone while
   * the next run loaded and `loadRun` only ever assigned it on success, so a link to a run that no longer
   * exists (retention prunes them; the "Retried from run" link reaches one) left the PREVIOUS run's
   * detail on screen under the new run's nav entry — its title, its stages, and live `Stop run` /
   * `Retry as successor` buttons closing over the wrong `runRef`. A retry click would then have launched
   * a successor of a run the operator was not even looking at.
   */
  useEffect(() => {
    setDetail(null);
    setEvents([]);
    setEventWindow(undefined);
    setCheckpoints([]);
    setMissingRunRef(null);
    if (!token || !openRunRef) return;
    let alive = true;
    loadRun(openRunRef, token).catch((cause: unknown) => {
      if (!alive) return;
      // A 404 is an answer, not a failure: the run is gone and the operator gets told so explicitly.
      if (cause instanceof ControlApiError && cause.status === 404) setMissingRunRef(openRunRef);
      else setError(cause instanceof Error ? cause.message : 'Could not load run.');
    });
    return () => { alive = false; };
  }, [loadRun, openRunRef, token]);

  /**
   * Link sources. Both are LOAD-BEARING FOR EDGES ONLY, so both swallow failure: a run detail with no
   * agent link is degraded, a run detail that refused to render because a decoration fetch 404'd would
   * be broken. `/api/index` is the ungoverned Plane-A snapshot; the revision list is governed and simply
   * stays empty without a session.
   */
  useEffect(() => {
    if (cardIndex || typeof fetch !== 'function') return;
    let alive = true;
    fetch('/api/index')
      .then((r) => r.json() as Promise<PlaneAIndex>)
      .then((d) => { if (alive) setIndex(d); })
      .catch(() => { /* links degrade; the detail still renders */ });
    return () => { alive = false; };
  }, [cardIndex]);

  useEffect(() => {
    if (injectedRevisions || !token) return;
    let alive = true;
    listProposalRevisions(WORKFLOW_COMPOSER_REF, token)
      .then((d) => { if (alive) setRevisions(d); })
      .catch(() => { /* run -> workflow link is simply absent */ });
    return () => { alive = false; };
  }, [injectedRevisions, token]);

  const cardOwners = index ? cardOwnerIndex(index) : undefined;

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
    const completionGate = isReviewCompletionGate(detail, request);
    const mutation = completionGate
      ? resolveReviewCompletionGate(request.requestRef, {
          expectedRequestRevision: request.revision,
          decision: decision as Extract<HumanRequestDecision, 'approved' | 'rejected' | 'changes-requested'>,
          idempotencyKey: idempotencyKey(request, decision), response: response || null,
        }, token)
      : respondToHumanRequest(request.requestRef, {
          expectedRevision: request.revision, decision, idempotencyKey: idempotencyKey(request, decision), response: response || null,
        }, token);
    void mutation
      .then(async () => {
        if ((!completionGate && (decision === 'approved' || decision === 'responded')) || (completionGate && decision === 'approved')) {
          await resumeRunAfterHumanResponse(request.runRef, token);
        }
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

  const resume = async (): Promise<void> => {
    if (!token || !detail || busy) return;
    setBusy(true);
    setError(null);
    try {
      await activateRun(detail.run, token);
      await loadRun(detail.run.runRef, token);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Run resume was refused.');
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

  /**
   * THE INVARIANT: no governed action may ever be rendered against a run other than the one the nav
   * stack is focused on.
   *
   * The clear-on-change above is what normally upholds it; this ref-identity check makes it STRUCTURAL,
   * so no future reordering of state updates can reintroduce a detail/nav mismatch. `RunCockpit` is the
   * only thing that renders `Stop run`, `Resume run`, and `Retry as successor`, and it is unreachable unless the loaded
   * detail is the focused run.
   */
  const focused = detail && openRunRef && detail.run.runRef === openRunRef ? detail : null;
  const resumeAvailable = focused ? canResumePublishedRun(focused) : false;

  return (
    <section className="control-managed-runs" aria-label="Managed runs">
      {focused ? (
        <>
          {error ? <p role="alert" className="control-managed-runs__error">{error}</p> : null}
          <RunCockpit
            detail={focused}
            eventWindow={eventWindow}
            events={events}
            busy={busy}
            checkpoints={checkpoints}
            activeSectionId={activeSectionId}
            onSectionChange={onSectionChange}
            onBack={back}
            backLabel="All runs"
            onNavigate={onNavigate}
            cardOwners={cardOwners}
            workflowId={workflowIdForRun(focused.run, revisions)}
            onManagerMessage={managerRunning ? managerMessage : undefined}
            onSteer={managerRunning ? steer : undefined}
            onStop={focused.sessions.some((session) => session.state === 'running') ? stop : undefined}
            onResume={resumeAvailable ? resume : undefined}
            onRetry={['failed', 'stopped', 'interrupted'].includes(focused.run.state) ? retry : undefined}
            onManagerSuccessor={!resumeAvailable && focused.sessions.some((session) => session.sessionRef === focused.run.managerSessionRef
              && ['interrupted', 'failed', 'stopped', 'completed'].includes(session.state)) ? recoverManager : undefined}
            onReroute={reroute}
            onHumanResponse={respond}
          />
        </>
      ) : missingRunRef && missingRunRef === openRunRef ? (
        /*
         * The run the link pointed at is gone. Showing the grid here would silently drop the operator
         * somewhere else after a click, and a blank panel would tell them nothing — so the dead link is
         * named explicitly, with the way back. Deliberately NO governed actions: there is no run to act on.
         */
        <div className="entity-missing" data-testid="run-not-found">
          <button
            type="button"
            className="entity-detail__back"
            data-testid="run-not-found-back"
            onClick={back}
          >
            <span aria-hidden="true">←</span> All runs
          </button>
          <h3>This run no longer exists</h3>
          <p className="mc-mono entity-missing__ref" data-testid="run-not-found-ref">{missingRunRef}</p>
          <p className="control-help">
            The control plane has no record of it — retention pruning removes completed runs, so links and
            retry lineage can outlive the run they point at. Nothing can be started or stopped for it.
          </p>
        </div>
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
