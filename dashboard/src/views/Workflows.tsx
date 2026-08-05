/**
 * Workflows — the one surface for definitions AND their executions.
 *
 * A workflow is a reusable staged DAG stored under `orgs/<project>/workflows/`; a run is one execution
 * of it. They used to be three nav destinations (Workflows, Runs, Run Canvas) presenting two parallel
 * vocabularies for the same thing. They are one destination now: this roster, a workflow's detail, and a
 * run's detail, reached by drilling in.
 *
 * The roster answers what an operator scanning it actually asks — is this thing running, when did it
 * last run, did it work. It used to key its rows on file paths and spend a whole column on governance
 * chips while showing nothing at all about runs.
 *
 * Runs that no definition owns (launched from a Composer proposal) collect under one "Ad-hoc" group
 * rather than being unreachable.
 */
import { useEffect, useRef, useState } from 'react';
import { useSse } from '../lib/sseClient';
import { invalidateSessionOnGovernedAuthFailure } from '../lib/authClient';
import { useSession } from '../lib/sessionContext';
import { WorkflowDetail, RunRow, type WorkflowDefEntry } from './WorkflowDetail';
import { RunDetail } from './RunDetail';
import { EntityName } from '../components/EntityName';
import { entityRowProps } from '../components/entityRow';
import { listRuns, type RunMetadataDto } from '../control/controlClient';
import { relativeAge, runDot, runStateLabel } from '../control/runEvents';
import { runsForWorkflow } from '../control/entityLinks';
import type { NavTarget } from '../nav/stack';
import type { Assignment, AssignTarget, WorkflowAssignmentOptions } from './WorkflowAgentGraph';
import '../styles/views/workflows.css';
import '../styles/views/entity.css';

/** One org workflow-definition entry from GET /api/workflows. */
export interface WorkflowDefsIndex {
  items: WorkflowDefEntry[];
}
const EMPTY_DEFS: WorkflowDefsIndex = { items: [] };

/** A run counts as live while something is still moving it forward. */
export function isLiveRun(run: RunMetadataDto): boolean {
  return run.state === 'running' || run.state === 'recovering' || run.state === 'stopping';
}

/**
 * Why this workflow cannot be launched right now, in plain words, or null when it can.
 *
 * A pending edit is a real block — the launch route refuses while one exists — so it is stated, once,
 * without naming the amendment machinery that produces it.
 */
export function launchBlockReason(entry: WorkflowDefEntry): string | null {
  if (entry.pendingAmendmentError) {
    return 'A change to this workflow is in an unreadable state, so it cannot run until that is sorted out.';
  }
  const phase = entry.pendingAmendment?.phase;
  if (!phase) return null;
  const what = phase === 'pending-human-merge' ? 'is waiting for a human to review it'
    : phase === 'audit-pending' ? 'is saved and its safety check is still running'
    : phase === 'audit-failed' ? 'failed its safety check'
    : ['prepared', 'committed', 'pushed'].includes(phase) ? 'stopped part-way and needs a human to finish it'
    : 'is in an unclear state';
  return `A change to this workflow ${what}, so it cannot run yet. What you see below is what it still does today.`;
}

/** One operator click gets one stable key; retries of that request cannot mint a duplicate governed run. */
function launchIdempotencyKey(ref: string, sourceHash: string, parameters: Record<string, string>): string {
  const entropy = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Date.now().toString(36);
  return `workflow-launch:${ref}:${sourceHash}:${JSON.stringify(parameters)}:${entropy}`;
}

/** Accepts canonical org definition data directly (tests) or self-fetches `/api/workflows`. */
export function Workflows({
  definitions,
  focusWorkflowId,
  focusRunRef,
  onOpenWorkflow,
  onOpenRun,
  onBack,
  onNavigate,
  onRunWorkflow,
  runs: injectedRuns,
  now,
}: {
  definitions?: WorkflowDefsIndex;
  /**
   * The open entity, driven by the nav stack. Controlled-or-uncontrolled, mirroring Agents: without a
   * controller the view keeps its own state so it stays usable and testable standalone.
   */
  focusWorkflowId?: string | null;
  focusRunRef?: string | null;
  onOpenWorkflow?: (ref: string) => void;
  onOpenRun?: (runRef: string) => void;
  onBack?: () => void;
  onNavigate?: (target: NavTarget) => void;
  /** "Run workflow" on a workflow's detail — handed up to the app, which primes a terminal session.
   *  The roster rows are unchanged: a row still just opens the workflow. */
  onRunWorkflow?: (workflow: { ref: string }) => void;
  /** Injected by tests; otherwise loaded from the control plane. */
  runs?: RunMetadataDto[];
  now?: number;
} = {}): React.JSX.Element {
  const { session, requireSession } = useSession();
  const sessionToken = session?.token;
  const [fetchedDefs, setFetchedDefs] = useState<WorkflowDefsIndex | null>(null);
  const [runs, setRuns] = useState<RunMetadataDto[] | undefined>(injectedRuns);
  const [launchStatus, setLaunchStatus] = useState<Record<string, string>>({});
  const [launchingRefs, setLaunchingRefs] = useState<Set<string>>(() => new Set());
  const [parameterValues, setParameterValues] = useState<Record<string, Record<string, string>>>({});
  const [assignmentOptions, setAssignmentOptions] = useState<Record<string, WorkflowAssignmentOptions>>({});
  const [assigningRef, setAssigningRef] = useState<string | null>(null);
  const [assignStatus, setAssignStatus] = useState<Record<string, string>>({});
  // State rendering is asynchronous; this ref is the synchronous double-click guard and retains the
  // same idempotency key for the full lifetime of one launch intent.
  const pendingLaunches = useRef(new Map<string, string>());
  // Uncontrolled fallbacks for the open entity when no nav stack is wired above this view.
  const [localOpenWorkflow, setLocalOpenWorkflow] = useState<string | null>(null);
  const [localOpenRun, setLocalOpenRun] = useState<string | null>(null);
  const { count: planeATick } = useSse('/events');
  const openDefRef = onOpenWorkflow ? focusWorkflowId ?? null : localOpenWorkflow;
  const openRunRef = onOpenRun ? focusRunRef ?? null : localOpenRun;

  useEffect(() => {
    if (definitions) return;
    if (typeof fetch !== 'function') return;
    let cancelled = false;
    fetch('/api/workflows')
      .then((r) => r.json() as Promise<WorkflowDefsIndex>)
      .then((d) => {
        if (!cancelled && Array.isArray(d?.items)) setFetchedDefs(d);
      })
      .catch(() => {
        /* read-only section: keep the empty-safe scaffold on failure */
      });
    return () => {
      cancelled = true;
    };
  }, [definitions, planeATick]);

  /**
   * The runs, for the whole roster.
   *
   * A governed read, so it stays `undefined` while the tab is locked — which the roster reports as "not
   * loaded" rather than claiming a workflow has never run. That distinction is the point. Reading the
   * list does NOT prompt for a passkey: the lock chip is the standing unlock, and only actions mint.
   */
  useEffect(() => {
    if (injectedRuns || !sessionToken) return;
    let cancelled = false;
    listRuns(sessionToken)
      .then((next) => { if (!cancelled) setRuns(next); })
      .catch(() => {
        /* the roster keeps saying "not loaded" — never a false "never run" */
      });
    return () => { cancelled = true; };
  }, [injectedRuns, sessionToken, planeATick]);

  const defs = definitions ?? fetchedDefs ?? EMPTY_DEFS;
  const defsLoaded = Boolean(definitions ?? fetchedDefs);

  const launchParameters = (entry: WorkflowDefEntry): Record<string, string> =>
    Object.fromEntries((entry.parameters ?? []).map((name) => [name, parameterValues[entry.ref]?.[name] ?? '']));

  async function launchDefinition(ref: string): Promise<void> {
    const entry = defs.items.find((candidate) => candidate.ref === ref);
    if (!entry?.sourceHash) {
      setLaunchStatus((current) => ({ ...current, [ref]: 'Refused: this workflow’s source revision could not be read.' }));
      return;
    }
    const parameters = launchParameters(entry);
    const operation = `${ref}:${entry.sourceHash}:${JSON.stringify(parameters)}`;
    if (pendingLaunches.current.has(operation)) return;
    const idempotencyKey = pendingLaunches.current.get(operation) ?? launchIdempotencyKey(ref, entry.sourceHash, parameters);
    pendingLaunches.current.set(operation, idempotencyKey);
    setLaunchingRefs((current) => new Set(current).add(ref));
    setLaunchStatus((current) => ({ ...current, [ref]: 'Launching…' }));
    try {
      const token = (await requireSession())?.token;
      if (!token) {
        setLaunchStatus((current) => ({ ...current, [ref]: 'The dashboard is locked — nothing was launched.' }));
        return;
      }
      const response = await fetch(`/api/workflows/${encodeURIComponent(ref)}/launch`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ idempotencyKey, expectedSourceHash: entry.sourceHash, parameters }),
      });
      await invalidateSessionOnGovernedAuthFailure(response);
      const body = (await response.json()) as { runRef?: string; activationGated?: boolean; error?: string; detail?: unknown };
      const message = response.ok && body.runRef
        ? `Run created ${body.runRef}${body.activationGated ? '; it starts once execution is unlocked' : ''}`
        : `Refused: ${typeof body.detail === 'string' ? body.detail : body.error ?? response.status}`;
      setLaunchStatus((current) => ({ ...current, [ref]: message }));
    } catch (error) {
      setLaunchStatus((current) => ({ ...current, [ref]: `Failed: ${error instanceof Error ? error.message : String(error)}` }));
    } finally {
      pendingLaunches.current.delete(operation);
      setLaunchingRefs((current) => {
        const next = new Set(current);
        next.delete(ref);
        return next;
      });
    }
  }

  useEffect(() => {
    if (!openDefRef || assignmentOptions[openDefRef] || typeof fetch !== 'function') return;
    let alive = true;
    fetch(`/api/workflows/${encodeURIComponent(openDefRef)}`)
      .then((response) => response.json() as Promise<{ assignmentOptions?: WorkflowAssignmentOptions }>)
      .then((body) => {
        if (alive && body.assignmentOptions) {
          setAssignmentOptions((current) => ({ ...current, [openDefRef]: body.assignmentOptions! }));
        }
      })
      .catch(() => { /* the graph still reads; its pickers are simply not offered */ });
    return () => { alive = false; };
  }, [openDefRef, assignmentOptions]);

  /**
   * The ONE governed write behind every picker on the graph. Its outcome is a change request that a
   * human merges, so the wording says exactly that: nothing about the workflow moved yet.
   */
  async function assign(ref: string, target: AssignTarget, assignment: Assignment | null): Promise<void> {
    const entry = defs.items.find((candidate) => candidate.ref === ref);
    if (!entry?.sourceHash || assigningRef) return;
    const token = (await requireSession())?.token;
    if (!token) {
      setAssignStatus((current) => ({ ...current, [ref]: 'The dashboard is locked — nothing was changed.' }));
      return;
    }
    setAssigningRef(ref);
    setAssignStatus((current) => ({ ...current, [ref]: 'Sending the change…' }));
    try {
      const response = await fetch(`/api/workflows/${encodeURIComponent(ref)}/assignment-amendments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ expectedSourceHash: entry.sourceHash, target, assignment }),
      });
      await invalidateSessionOnGovernedAuthFailure(response);
      const body = await response.json() as {
        status?: string; stateStatus?: string; auditStatus?: string; branch?: string;
        baseSourceHash?: string; proposedSourceHash?: string; pr?: { url?: string }; error?: string; detail?: string;
      };
      if (body.status === 'pending-human-merge' && body.baseSourceHash === entry.sourceHash && body.proposedSourceHash) {
        setAssignStatus((current) => ({
          ...current,
          [ref]: 'Sent for review. This workflow still runs exactly as shown until a human approves the change.',
        }));
      } else {
        setAssignStatus((current) => ({
          ...current,
          [ref]: body.status === 'recovery-required'
            ? `The change stopped part-way (${body.stateStatus ?? 'unknown state'}) and needs a human to finish it.`
            : body.auditStatus === 'failed'
              ? 'The change failed its safety check and was not applied.'
              : `Refused: ${body.detail ?? body.error ?? response.status}`,
        }));
      }
    } catch (error) {
      setAssignStatus((current) => ({ ...current, [ref]: `Failed: ${error instanceof Error ? error.message : String(error)}` }));
    } finally {
      setAssigningRef(null);
    }
  }

  const openWorkflow = (ref: string): void => {
    if (onOpenWorkflow) onOpenWorkflow(ref);
    else setLocalOpenWorkflow(ref);
  };
  const openRun = (ref: string): void => {
    if (onOpenRun) onOpenRun(ref);
    else setLocalOpenRun(ref);
  };
  const back = (): void => {
    if (onBack) onBack();
    else if (localOpenRun) setLocalOpenRun(null);
    else setLocalOpenWorkflow(null);
  };

  // A run's own surface. It self-fetches, so this destination carries no run state of its own.
  if (openRunRef) {
    return (
      <section className="v-workflows" aria-label="Workflows view">
        <RunDetail
          runRef={openRunRef}
          onBack={back}
          backLabel={openDefRef ? 'Back to the workflow' : 'All workflows'}
          onNavigate={onNavigate}
          now={now}
        />
      </section>
    );
  }

  /**
   * A focused ref that is NOT in the index (a definition deleted from `workflows/`, a stale link, a
   * back-forward into a since-removed entry) gets an EXPLICIT dead-link state naming the ref. It used to
   * fall through to the roster: the operator clicked a link, landed on a list with no message, and an
   * invisible extra entry sat on the nav stack with no back affordance rendered to pop it.
   *
   * Gated on the index having actually LOADED, not on it being non-empty — calling a workflow "not
   * registered" because the request is still in flight would be its own dishonesty.
   */
  const openDef = openDefRef ? defs.items.find((d) => d.ref === openDefRef) : undefined;
  if (openDefRef && !openDef && defsLoaded) {
    return (
      <section className="v-workflows" aria-label="Workflows view">
        <div className="entity-missing" data-testid="workflow-not-found">
          <button type="button" className="entity-detail__back" data-testid="workflow-not-found-back" onClick={back}>
            <span aria-hidden="true">←</span> All workflows
          </button>
          <h3>This workflow is no longer registered</h3>
          <p className="mc-mono entity-missing__ref" data-testid="workflow-not-found-ref">{openDefRef}</p>
          <p className="control-help">
            No workflow with this reference exists any more — it was most likely removed from
            <code className="mc-mono"> workflows/</code>, while runs launched from it kept the reference.
          </p>
        </div>
      </section>
    );
  }

  if (openDef) {
    return (
      <section className="v-workflows" aria-label="Workflows view">
        <WorkflowDetail
          entry={openDef}
          runs={runs === undefined ? undefined : runsForWorkflow(openDef.ref, runs)}
          now={now}
          onOpenRun={openRun}
          onNavigate={onNavigate}
          onBack={back}
          backLabel="All workflows"
          onRunWorkflow={onRunWorkflow}
          parameterValues={parameterValues[openDef.ref] ?? {}}
          onParameterChange={(name, value) => setParameterValues((current) => ({
            ...current, [openDef.ref]: { ...current[openDef.ref], [name]: value },
          }))}
          onLaunch={() => void launchDefinition(openDef.ref)}
          launching={launchingRefs.has(openDef.ref)}
          launchStatus={launchStatus[openDef.ref] ?? null}
          blockedReason={launchBlockReason(openDef)}
          assignmentOptions={assignmentOptions[openDef.ref] ?? null}
          onAssign={(target, assignment) => void assign(openDef.ref, target, assignment)}
          assignBusy={assigningRef === openDef.ref}
          assignStatus={assignStatus[openDef.ref] ?? null}
        />
      </section>
    );
  }

  const runsByWorkflow = (ref: string): RunMetadataDto[] => runs === undefined ? [] : runsForWorkflow(ref, runs);
  const knownRefs = new Set(defs.items.map((entry) => entry.ref));
  const adHocRuns = (runs ?? [])
    .filter((run) => run.workflowRef === null || !knownRefs.has(run.workflowRef))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return (
    <section className="v-workflows" aria-label="Workflows view">
      <header className="v-workflows__head">
        <h2 className="v-workflows__title">Workflows</h2>
      </header>

      {defs.items.length === 0 ? (
        <div className="v-workflows__empty" data-testid="workflows-empty">
          <h3 className="v-workflows__empty-title">No workflows yet</h3>
          <p className="v-workflows__empty-body">
            A workflow is declared under <code className="mc-mono">orgs/&lt;project&gt;/workflows/</code>.
            Add one there and it appears here, ready to run.
          </p>
        </div>
      ) : (
        <table className="mc-table mc-table--boxed" data-testid="workflow-defs">
          <thead>
            <tr>
              <th>Workflow</th>
              <th>Project</th>
              <th>Last run</th>
              <th>Runs</th>
            </tr>
          </thead>
          <tbody>
            {defs.items.map((d) => {
              const workflowRuns = runsByWorkflow(d.ref);
              const latest = workflowRuns[0];
              const liveCount = workflowRuns.filter(isLiveRun).length;
              const needsYou = workflowRuns.reduce((total, run) => total + run.openHumanRequestCount, 0);
              return (
                <tr key={d.ref} className="v-workflows__row" data-testid={`workflow-def-${d.ref}`}>
                  <td className="v-workflows__cell-id">
                    <div
                      className="mc-row-link v-workflows__open"
                      data-testid={`workflow-open-${d.ref}`}
                      aria-label={`Open ${d.displayName}`}
                      /* The file path is technical detail, not this workflow's identity: it stays in the
                       * row tooltip so the workflow's own name is the only primary text here. */
                      title={d.path}
                      {...entityRowProps(() => openWorkflow(d.ref))}
                    >
                      <span className="v-workflows__wf-name">
                        <EntityName kind="workflow" id={d.ref} displayName={d.displayName} shortRef={d.shortRef} />
                      </span>
                      {d.valid && d.launchable !== false ? null : (
                        <span className="v-workflows__flag" data-testid={`workflow-flag-${d.ref}`}>needs a fix</span>
                      )}
                    </div>
                  </td>
                  <td className="v-workflows__cell-profile mc-mono">{d.project}</td>
                  <td className="v-workflows__cell-latest" data-testid={`workflow-latest-${d.ref}`}>
                    {runs === undefined ? (
                      <span className="v-workflows__muted">not loaded</span>
                    ) : latest ? (
                      <>
                        <span className={`mc-status-dot mc-status-dot--${runDot(latest.state)}`} aria-hidden="true" />
                        <span className="v-workflows__status-label">{runStateLabel(latest.state)}</span>
                        <span className="mc-mono v-workflows__muted">{relativeAge(latest.updatedAt, now)}</span>
                      </>
                    ) : (
                      <span className="v-workflows__muted">never run</span>
                    )}
                  </td>
                  <td className="v-workflows__cell-counts mc-mono" data-testid={`workflow-counts-${d.ref}`}>
                    {runs === undefined ? '—' : (
                      <>
                        {workflowRuns.length}
                        {liveCount ? <span className="v-workflows__live" data-testid={`workflow-live-${d.ref}`}>
                          <span className="mc-status-dot mc-status-dot--running" aria-hidden="true" /> {liveCount} live
                        </span> : null}
                        {needsYou ? <span className="v-workflows__needs-you"> · {needsYou} need you</span> : null}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {adHocRuns.length ? (
        <section className="v-workflows__adhoc" aria-label="Ad-hoc runs" data-testid="workflows-adhoc">
          <h3 className="entity-block__title">Ad-hoc</h3>
          <p className="entity-note">Runs that no workflow owns — started straight from a plan.</p>
          <ol className="entity-list">
            {adHocRuns.map((run) => (
              <li key={run.runRef}>
                <RunRow run={run} now={now} onOpen={openRun} />
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </section>
  );
}
