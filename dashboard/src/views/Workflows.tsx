/**
 * Workflows view (U3) — registered reusable definition artifacts promoted to their own destination.
 *
 * The empty state is a calm explanation of what is absent, never an error. When workflows do exist, the
 * view renders a dense list of their registered definition files. Registration does not compile or run
 * a definition. Launched queue cards and their dependency links are visualized separately in Runs.
 *
 * Read-only, self-fetching: it keeps the U2.5 wrapper's pattern (fetch `/api/registry`, read the
 * `workflows` slice), degrading to the designed empty state on any failure rather than crashing.
 *
 * The read-API gap is now closed: `WorkflowEntry` carries `name` + `status` (read from each workflow
 * file's frontmatter, falling back to the id and `registered` respectively), so real entries render
 * with a human name and a live status marker rather than a hardcoded label.
 */
import { useEffect, useState } from 'react';
import type { WorkflowsIndex } from '../../server/registry/workflows';
import { useSse } from '../lib/sseClient';
import { invalidateSessionOnGovernedAuthFailure, type Session } from '../lib/authClient';
import { WorkflowDetail, type WorkflowDefEntry } from './WorkflowDetail';
import { listProposalRevisions, listRuns, type ProposalRevisionMetadataDto, type RunMetadataDto } from '../control/controlClient';
import { runsForWorkflow, WORKFLOW_COMPOSER_REF } from '../control/entityLinks';
import type { NavTarget } from '../nav/stack';
import '../styles/views/workflows.css';
import '../styles/views/entity.css';

const EMPTY: WorkflowsIndex = { present: false, items: [] };

/**
 * One org workflow-definition entry from GET /api/workflows. The shape now lives with the detail view
 * that renders it in full, so the two cannot drift.
 */
interface WorkflowDefsIndex {
  items: WorkflowDefEntry[];
}
const EMPTY_DEFS: WorkflowDefsIndex = { items: [] };

/** Map a workflow status to a shared status-dot modifier (no new hue taxonomy). Unknown → idle. */
function statusDot(status: string): 'running' | 'idle' | 'error' | 'blocked' {
  switch (status.toLowerCase()) {
    case 'running':
    case 'active':
      return 'running';
    case 'failed':
    case 'error':
      return 'error';
    case 'blocked':
    case 'paused':
      return 'blocked';
    default:
      return 'idle';
  }
}

/** Accepts workflows data directly (tests) or self-fetches the registry index. */
export function Workflows({
  data,
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
  data?: WorkflowsIndex;
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
  const [fetched, setFetched] = useState<WorkflowsIndex | null>(null);
  const [fetchedDefs, setFetchedDefs] = useState<WorkflowDefsIndex | null>(null);
  const [runStatus, setRunStatus] = useState<Record<string, string>>({});
  const [launchStatus, setLaunchStatus] = useState<Record<string, string>>({});
  // Uncontrolled fallback for the open definition when no nav stack is wired above this view.
  const [localOpenRef, setLocalOpenRef] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunMetadataDto[] | undefined>(injectedRuns);
  const [revisions, setRevisions] = useState<ProposalRevisionMetadataDto[] | undefined>(injectedRevisions);
  const { count: planeATick } = useSse('/events');
  const openDefRef = onOpenWorkflow ? focusWorkflowId ?? null : localOpenRef;

  useEffect(() => {
    if (data) return;
    let cancelled = false;
    fetch('/api/registry')
      .then((r) => r.json() as Promise<{ workflows?: WorkflowsIndex }>)
      .then((d) => {
        if (!cancelled && d.workflows) setFetched(d.workflows);
      })
      .catch(() => {
        /* read-only view: on failure keep the empty-safe scaffold, never crash the shell */
      });
    return () => {
      cancelled = true;
    };
  }, [data, planeATick]);

  // D15: org workflow definitions (compiled to governed proposals). Separate endpoint, separate section.
  useEffect(() => {
    // When either hermetic prop is injected (tests), the view is prop-driven and self-fetches nothing.
    if (definitions || data) return;
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

  const workflows = data ?? fetched ?? EMPTY;
  const empty = !workflows.present || workflows.items.length === 0;
  const defs = definitions ?? fetchedDefs ?? EMPTY_DEFS;

  async function launchDefinition(ref: string): Promise<void> {
    setLaunchStatus((current) => ({ ...current, [ref]: 'Launching…' }));
    try {
      const token = sessionToken ?? (await onRequestSession?.())?.token;
      if (!token) {
        setLaunchStatus((current) => ({ ...current, [ref]: 'Unlock refused.' }));
        return;
      }
      // The server REQUIRES a non-empty client-supplied idempotencyKey (≤512 chars): a server-minted key
      // would turn every proxy retry into a duplicate run, so it refuses an absent one rather than invent it.
      // An explicit Launch click is a distinct launch intent, so the key is UNIQUE per click — each click is
      // meant to create a new run. A content-hash would wrongly dedup repeat launches into a single run.
      const idempotencyKey = `launch:${ref}:${typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Date.now().toString(36)}`;
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
    }
  }

  async function runWorkflow(id: string): Promise<void> {
    const item = workflows.items.find((candidate) => candidate.id === id);
    if (!item?.definition) return;
    setRunStatus((current) => ({ ...current, [id]: 'Launching…' }));
    try {
      const token = sessionToken ?? (await onRequestSession?.())?.token;
      if (!token) {
        setRunStatus((current) => ({ ...current, [id]: 'Unlock refused.' }));
        return;
      }
      const response = await fetch('/api/write/workflow-runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(item.definition),
      });
      await invalidateSessionOnGovernedAuthFailure(response);
      const body = (await response.json()) as {
        runId?: string;
        runners?: Array<{ status?: string }>;
        error?: string;
        detail?: unknown;
      };
      const signaled = body.runners?.filter((runner) => runner.status === 'triggered').length ?? 0;
      const message = response.ok && body.runId
        ? `Launched ${body.runId}${signaled > 0 ? ` · ${signaled} background runner${signaled === 1 ? '' : 's'} signaled` : ' · queued; no runner signaled'}`
        : `Refused: ${typeof body.detail === 'string' ? body.detail : body.error ?? response.status}`;
      setRunStatus((current) => ({ ...current, [id]: message }));
    } catch (error) {
      setRunStatus((current) => ({ ...current, [id]: `Failed: ${error instanceof Error ? error.message : String(error)}` }));
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
                  onClick={() => void launchDefinition(openDef.ref)}
                >
                  Launch
                </button>
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
          Registered reusable definitions. Strict workflow-v1 definitions can launch here; live instances appear in Runs.
        </p>
      </header>

      {empty ? (
        <div className="v-workflows__empty" data-testid="workflows-empty">
          <h3 className="v-workflows__empty-title">No workflows registered yet</h3>
          <p className="v-workflows__empty-body">
            Workflow definitions are Markdown artifacts under <code className="mc-mono">workflows/</code>.
            Registered definitions appear here with their id, path, and status. Executable workflow-v1 definitions expose Run now.
          </p>
          <p className="v-workflows__empty-sub">
            When queue cards are launched with dependencies, their graph appears in Runs.
          </p>
        </div>
      ) : (
        <table className="v-workflows__table">
          <thead>
            <tr>
              <th>Workflow</th>
              <th>Path</th>
              <th>Status</th>
              <th>Run</th>
            </tr>
          </thead>
          <tbody>
            {workflows.items.map((w) => (
              <tr key={w.id} className="v-workflows__row" data-testid={`workflow-row-${w.id}`}>
                <td className="v-workflows__cell-id">
                  <span className="v-workflows__wf-name">{w.name}</span>
                  {w.name !== w.id ? <span className="v-workflows__wf-id mc-mono">{w.id}</span> : null}
                </td>
                <td className="v-workflows__cell-path mc-mono">{w.path}</td>
                <td className="v-workflows__cell-status">
                  <span
                    className={`mc-status-dot mc-status-dot--${statusDot(w.status)}`}
                    aria-hidden="true"
                  />
                  <span className="v-workflows__status-label">{w.status}</span>
                </td>
                <td className="v-workflows__cell-run">
                  {w.definition ? (
                    <>
                      <button type="button" className="mc-btn mc-btn--quiet" onClick={() => void runWorkflow(w.id)}>
                        Run now
                      </button>
                      {runStatus[w.id] ? <span className="v-workflows__run-status">{runStatus[w.id]}</span> : null}
                    </>
                  ) : (
                    <span className="v-workflows__not-runnable">Prose only</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {defs.items.length > 0 ? (
        <div className="v-workflows__defs" data-testid="workflow-defs">
          <h3 className="v-workflows__defs-title">Org workflow definitions</h3>
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
                          onClick={() => void launchDefinition(d.ref)}
                        >
                          Launch
                        </button>
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
      ) : null}

      <p className="v-workflows__runs-note" data-testid="workflows-runs-note">
        Saving a definition does not launch it. Run now creates a new instance; Runs shows its live stage graph.
      </p>
    </section>
  );
}
