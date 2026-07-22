/**
 * Workflows view — the one canonical roster of org workflow definitions.
 *
 * A workflow is a reusable staged DAG stored under `orgs/<project>/workflows/`. Its detail shows the
 * compiled proposal; Launch compiles that definition into a governed run. Historic root-registry
 * entries are deliberately absent: they are not a second workflow system and must not create a second,
 * misleading "Run now" path.
 */
import { useEffect, useRef, useState } from 'react';
import { useSse } from '../lib/sseClient';
import { invalidateSessionOnGovernedAuthFailure, type Session } from '../lib/authClient';
import { WorkflowDetail, type WorkflowDefEntry } from './WorkflowDetail';
import { listProposalRevisions, listRuns, type ProposalRevisionMetadataDto, type RunMetadataDto } from '../control/controlClient';
import { runsForWorkflow, WORKFLOW_COMPOSER_REF } from '../control/entityLinks';
import type { NavTarget } from '../nav/stack';
import '../styles/views/workflows.css';
import '../styles/views/entity.css';

/**
 * One org workflow-definition entry from GET /api/workflows. The shape now lives with the detail view
 * that renders it in full, so the two cannot drift.
 */
export interface WorkflowDefsIndex {
  items: WorkflowDefEntry[];
}
const EMPTY_DEFS: WorkflowDefsIndex = { items: [] };

/** One operator click gets one stable key; retries of that request cannot mint a duplicate governed run. */
function launchIdempotencyKey(ref: string): string {
  const entropy = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Date.now().toString(36);
  return `workflow-launch:${ref}:${entropy}`;
}

/** Accepts canonical org definition data directly (tests) or self-fetches `/api/workflows`. */
export function Workflows({
  definitions,
  sessionToken,
  onRequestSession,
  focusWorkflowId,
  onOpenWorkflow,
  onBack,
  activeSectionId,
  onSectionChange,
  onNavigate,
  runs: injectedRuns,
  revisions: injectedRevisions,
}: {
  definitions?: WorkflowDefsIndex;
  sessionToken?: string;
  onRequestSession?: () => Promise<Session | null>;
  /**
   * arc-3 step 4 — the open definition, driven by the nav stack. Controlled-or-uncontrolled, mirroring
   * ManagedRuns and Agents: without a controller the view keeps its own state so it stays usable and
   * testable standalone rather than rendering an inert detail.
   */
  focusWorkflowId?: string | null;
  onOpenWorkflow?: (ref: string) => void;
  onBack?: () => void;
  activeSectionId?: string;
  onSectionChange?: (id: string) => void;
  onNavigate?: (target: NavTarget) => void;
  /** Injected by tests; otherwise loaded from the control plane to power the workflow → runs join. */
  runs?: RunMetadataDto[];
  revisions?: ProposalRevisionMetadataDto[];
} = {}): React.JSX.Element {
  const [fetchedDefs, setFetchedDefs] = useState<WorkflowDefsIndex | null>(null);
  const [launchStatus, setLaunchStatus] = useState<Record<string, string>>({});
  const [launchingRefs, setLaunchingRefs] = useState<Set<string>>(() => new Set());
  // State rendering is asynchronous; this ref is the synchronous double-click guard and retains the
  // same idempotency key for the full lifetime of one launch intent.
  const pendingLaunches = useRef(new Map<string, string>());
  // Uncontrolled fallback for the open definition when no nav stack is wired above this view.
  const [localOpenRef, setLocalOpenRef] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunMetadataDto[] | undefined>(injectedRuns);
  const [revisions, setRevisions] = useState<ProposalRevisionMetadataDto[] | undefined>(injectedRevisions);
  const { count: planeATick } = useSse('/events');
  const openDefRef = onOpenWorkflow ? focusWorkflowId ?? null : localOpenRef;

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
   * The workflow → runs join sources. Loaded ONLY while a definition detail is open — the roster itself
   * needs neither, and these are governed reads that would otherwise fire on every visit to this view.
   *
   * Both stay `undefined` without a session, which the detail reports as "not loaded" rather than
   * claiming the definition has never been launched. That distinction is the whole point of the join.
   */
  useEffect(() => {
    if (!openDefRef || !sessionToken) return;
    if (injectedRuns && injectedRevisions) return;
    let cancelled = false;
    Promise.all([listRuns(sessionToken), listProposalRevisions(WORKFLOW_COMPOSER_REF, sessionToken)])
      .then(([nextRuns, nextRevisions]) => {
        if (cancelled) return;
        if (!injectedRuns) setRuns(nextRuns);
        if (!injectedRevisions) setRevisions(nextRevisions);
      })
      .catch(() => {
        /* the Runs section keeps saying "not loaded" — never a false "never launched" */
      });
    return () => {
      cancelled = true;
    };
  }, [openDefRef, sessionToken, injectedRuns, injectedRevisions]);

  const defs = definitions ?? fetchedDefs ?? EMPTY_DEFS;
  const canLaunch = (entry: WorkflowDefEntry): boolean => entry.valid && entry.launchable !== false;

  async function launchDefinition(ref: string): Promise<void> {
    if (pendingLaunches.current.has(ref)) return;
    const idempotencyKey = launchIdempotencyKey(ref);
    pendingLaunches.current.set(ref, idempotencyKey);
    setLaunchingRefs((current) => new Set(current).add(ref));
    setLaunchStatus((current) => ({ ...current, [ref]: 'Launching…' }));
    try {
      const token = sessionToken ?? (await onRequestSession?.())?.token;
      if (!token) {
        setLaunchStatus((current) => ({ ...current, [ref]: 'Unlock refused.' }));
        return;
      }
      const response = await fetch(`/api/workflows/${encodeURIComponent(ref)}/launch`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ idempotencyKey }),
      });
      await invalidateSessionOnGovernedAuthFailure(response);
      const body = (await response.json()) as { runRef?: string; activationGated?: boolean; error?: string; detail?: unknown };
      const message = response.ok && body.runRef
        ? `Run created ${body.runRef}${body.activationGated ? '; execution awaits activation' : ''}`
        : `Refused: ${typeof body.detail === 'string' ? body.detail : body.error ?? response.status}`;
      setLaunchStatus((current) => ({ ...current, [ref]: message }));
    } catch (error) {
      setLaunchStatus((current) => ({ ...current, [ref]: `Failed: ${error instanceof Error ? error.message : String(error)}` }));
    } finally {
      pendingLaunches.current.delete(ref);
      setLaunchingRefs((current) => {
        const next = new Set(current);
        next.delete(ref);
        return next;
      });
    }
  }

  const openWorkflow = (ref: string): void => {
    if (onOpenWorkflow) onOpenWorkflow(ref);
    else setLocalOpenRef(ref);
  };

  const backToWorkflows = (): void => {
    if (onBack) onBack();
    else setLocalOpenRef(null);
  };

  /**
   * The definition detail REPLACES the tables in place — same pattern as runs and agents, no new nav
   * destination.
   *
   * A focused ref that is NOT in the index (a definition deleted from `workflows/`, a stale `sourceTurnId`
   * on an older run, a back-forward into a since-removed entry) gets an EXPLICIT dead-link state naming
   * the ref, matching how a missing run is handled in `ManagedRuns`. It used to fall through to the
   * roster: the operator clicked a link, landed on a list with no message, and an invisible extra entry
   * sat on the nav stack with no back affordance rendered to pop it.
   *
   * Gated on the index having actually LOADED, not on it being non-empty — `fetchedDefs` is null until
   * the fetch lands, and calling a definition "not registered" because the request is still in flight
   * would be its own dishonesty.
   */
  const defsLoaded = Boolean(definitions ?? fetchedDefs);
  const openDef = openDefRef ? defs.items.find((d) => d.ref === openDefRef) : undefined;
  if (openDefRef && !openDef && defsLoaded) {
    return (
      <section className="v-workflows" aria-label="Workflows view">
        <div className="entity-missing" data-testid="workflow-not-found">
          <button
            type="button"
            className="entity-detail__back"
            data-testid="workflow-not-found-back"
            onClick={backToWorkflows}
          >
            <span aria-hidden="true">←</span> All workflows
          </button>
          <h3>This workflow is no longer registered</h3>
          <p className="mc-mono entity-missing__ref" data-testid="workflow-not-found-ref">{openDefRef}</p>
          <p className="control-help">
            No definition with this ref is in the registry — it was most likely removed from
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
          runs={runs && revisions ? runsForWorkflow(openDef.ref, revisions, runs) : undefined}
          activeSectionId={activeSectionId}
          onSectionChange={onSectionChange}
          onNavigate={onNavigate}
          onBack={backToWorkflows}
          backLabel="All workflows"
          actions={
            openDef.valid ? (
              <>
                <button
                  type="button"
                  className="mc-btn mc-btn--primary"
                  disabled={!canLaunch(openDef) || launchingRefs.has(openDef.ref)}
                  onClick={() => void launchDefinition(openDef.ref)}
                >
                  Launch
                </button>
                {!canLaunch(openDef) ? (
                  <span className="v-workflows__run-status" data-testid={`workflow-def-unavailable-${openDef.ref}`}>
                    Unavailable: {openDef.compileDetail ?? openDef.compileError ?? 'compiler refused this definition'}
                  </span>
                ) : null}
                {launchStatus[openDef.ref] ? (
                  <span className="v-workflows__run-status" data-testid={`workflow-def-status-${openDef.ref}`}>
                    {launchStatus[openDef.ref]}
                  </span>
                ) : null}
              </>
            ) : null
          }
        />
      </section>
    );
  }

  return (
    <section className="v-workflows" aria-label="Workflows view">
      <header className="v-workflows__head">
        <h2 className="v-workflows__title">Workflows</h2>
        <p className="v-workflows__lede">
          Reusable staged DAG definitions that compile to governed runs. Live instances appear in Runs.
        </p>
      </header>

      {defs.items.length === 0 ? (
        <div className="v-workflows__empty" data-testid="workflows-empty">
          <h3 className="v-workflows__empty-title">No org workflow definitions found</h3>
          <p className="v-workflows__empty-body">
            A workflow is a reusable staged DAG declared under
            <code className="mc-mono"> orgs/&lt;project&gt;/workflows/</code>. Add a definition there and it
            appears here with its validation state and compiled stage preview.
          </p>
          <p className="v-workflows__empty-sub">
            Launch compiles a valid definition into a governed run; its live stage graph appears in Runs.
          </p>
        </div>
      ) : (
        <div className="v-workflows__defs" data-testid="workflow-defs">
          <p className="v-workflows__defs-lede">
            Definitions under <code className="mc-mono">orgs/&lt;project&gt;/workflows/</code> compile to governed proposals.
            Launch publishes canonical cards through the control plane; execution awaits runtime activation.
          </p>
          <table className="v-workflows__table">
            <thead>
              <tr>
                <th>Definition</th>
                <th>Profile</th>
                <th>Stages</th>
                <th>Valid</th>
                <th>Launch</th>
              </tr>
            </thead>
            <tbody>
              {defs.items.map((d) => (
                <tr key={d.ref} className="v-workflows__row" data-testid={`workflow-def-${d.ref}`}>
                  <td className="v-workflows__cell-id">
                    {/* The definition name opens its detail. A button, not a row handler: the Launch
                     *  control in this same row is a governed write and must keep its own click. */}
                    <button
                      type="button"
                      className="v-workflows__open"
                      data-testid={`workflow-open-${d.ref}`}
                      aria-label={`Open ${d.title ?? d.ref} detail`}
                      onClick={() => openWorkflow(d.ref)}
                    >
                      <span className="v-workflows__wf-name">{d.title ?? d.ref}</span>
                      <span className="v-workflows__wf-id mc-mono">{d.path}</span>
                    </button>
                  </td>
                  <td className="v-workflows__cell-profile mc-mono">{d.profile ?? '—'}</td>
                  <td className="v-workflows__cell-stages">
                    {d.valid ? (
                      <ul className="v-workflows__stage-list">
                        {d.stages.map((s) => (
                          <li key={s.id} className="mc-mono">
                            {s.action} → {s.target} <span className="v-workflows__tier">{s.riskTier}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="v-workflows__cell-valid">
                    <span
                      className={`mc-status-dot mc-status-dot--${d.valid ? 'running' : 'error'}`}
                      aria-hidden="true"
                    />
                    <span className="v-workflows__status-label">{d.valid ? 'valid' : 'invalid'}</span>
                  </td>
                  <td className="v-workflows__cell-run">
                    {d.valid ? (
                      <>
                        <button
                          type="button"
                          className="mc-btn mc-btn--quiet"
                          disabled={!canLaunch(d) || launchingRefs.has(d.ref)}
                          onClick={() => void launchDefinition(d.ref)}
                        >
                          Launch
                        </button>
                        {!canLaunch(d) ? (
                          <span className="v-workflows__not-runnable" data-testid={`workflow-def-unavailable-${d.ref}`}>
                            {d.compileDetail ?? d.compileError ?? 'Compiler refused'}
                          </span>
                        ) : null}
                        {launchStatus[d.ref] ? (
                          <span className="v-workflows__run-status" data-testid={`workflow-def-status-${d.ref}`}>
                            {launchStatus[d.ref]}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <span className="v-workflows__not-runnable" title={d.detail ?? undefined}>Invalid</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="v-workflows__runs-note" data-testid="workflows-runs-note">
        Saving a definition does not launch it. Launch compiles a valid staged DAG into a governed run;
        Runs shows its live stage graph.
      </p>
    </section>
  );
}
