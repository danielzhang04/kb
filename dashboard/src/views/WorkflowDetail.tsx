/**
 * The workflow detail — one graph, one Launch, one history of everything this workflow has done.
 *
 * A workflow is a reusable definition; a run is one execution of it. Both live in this destination, so
 * this view answers exactly three questions and pushes everything else behind a fold:
 *   - what does this workflow do, and who runs each step (the Flow tab — and where you change it);
 *   - can I run it right now (one button, with any inputs it declares beside it);
 *   - what has it done (the Runs tab, live and past).
 *
 * The five-tab layout this replaced (Agents / Overview / Stages / Runs / Compiled) split those answers
 * across five clicks and spoke in engine vocabulary — "compiled proposal", "proposal revision",
 * "pre-launch assignment amendments", a workflow-governor dropdown with its own submit button. The
 * governor plan was compile-neutral bookkeeping: it never decided who ran anything. It is gone, and the
 * only editing surface left is the per-agent picker on the graph, which posts the SAME governed
 * assignment write the old form did.
 */
import { useEffect, useState } from 'react';
import type { ProposalRoutingDto, ProposalStageDto, ResolvedAgentAssignmentDto, RunMetadataDto } from '../control/controlClient';
import { relativeAge, runDot, runStateLabel } from '../control/runEvents';
import { EntityName } from '../components/EntityName';
import { entityRowProps } from '../components/entityRow';
import { EntityDetail, type DetailSection } from '../entity/EntityDetail';
import type { NavTarget } from '../nav/stack';
import {
  WorkflowAgentGraph,
  type AssignTarget,
  type Assignment,
  type ResolvedAssignment,
  type WorkflowAssignmentOptions,
} from './WorkflowAgentGraph';
import '../styles/views/entity.css';
import '../styles/views/agents.css';

/** One definition entry from `GET /api/workflows` (mirrors `server/workflows/routes.ts`). */
export interface WorkflowDefEntry {
  ref: string;
  /** Server-owned display identity (`server/workflows/routes.ts#entryWithCompileStatus`). The
   *  workflow's TITLE is its identity here; `path` and `sourceHash` are technical detail. */
  displayName: string;
  shortRef: number;
  project: string;
  path: string;
  sourceHash: string | null;
  pendingAmendment?: { workflowPath: string; baseSourceHash: string; proposedSourceHash: string; branch: string; pr: { url?: string; number?: number }; phase: string } | null;
  pendingAmendmentError?: string | null;
  valid: boolean;
  title: string | null;
  /** Existing workflow tool capability profile; never an agent assignment profile. */
  profile: string | null;
  governedBy?: string | null;
  governanceProblems?: string[];
  /** Required string parameters declared by the immutable workflow definition. */
  parameters?: string[];
  manager?: Assignment | null;
  /**
   * Who the server says runs this workflow today — the declared manager when there is one, else the
   * default it resolved from the file (its governing agent, the project's manager, …). Optional: an
   * older payload carries only `manager`, and the graph degrades to that.
   */
  resolvedManager?: ResolvedAssignment | null;
  stageCount: number;
  riskTier: string | null;
  stages: Array<{
    id: string; title?: string; action: string; target: string; riskTier: string; dependsOn?: string[];
    governedBy?: string | null;
    declaredAssignment?: Assignment | null;
    /** Who the server says runs this step today, declaration or resolved default alike. See above. */
    resolvedAssignment?: ResolvedAssignment | null;
    review?: { subjectStageId: string; maxCreatorReworks: number } | null;
    completionGate?: { id: string; kind: 'approval'; requiresReview: 'pass' } | null;
  }>;
  detail: string | null;
  /** Semantic compiler status, deliberately independent from syntax `valid`. */
  launchable?: boolean;
  compileError?: string | null;
  compileDetail?: string | null;
}

/** The compiled projection from `GET /api/workflows/:ref` — read-only, pre-auth, no engine internals. */
export interface WorkflowCompiled {
  ok: boolean;
  proposalId?: string;
  contentHash?: string;
  manager?: ProposalRoutingDto & { requiredSkills: string[]; assignment?: ResolvedAgentAssignmentDto };
  stages?: ProposalStageDto[];
  error?: string;
  detail?: string;
}

export interface WorkflowDetailProps {
  entry: WorkflowDefEntry;
  /** Injected by tests; otherwise self-fetched from the per-definition route. */
  compiled?: WorkflowCompiled | null;
  /**
   * This workflow's runs, newest first. `undefined` means not loaded (the tab is locked), which reads
   * differently from `[]` and is worded differently.
   */
  runs?: RunMetadataDto[];
  /** Injectable clock so run ages are deterministic under test. */
  now?: number;
  onOpenRun?: (runRef: string) => void;
  onNavigate?: (target: NavTarget) => void;
  onBack?: () => void;
  backLabel?: string;
  /** Controlled by the nav stack so back-navigation restores the operator's tab. */
  activeSectionId?: string;
  onSectionChange?: (id: string) => void;
  /** Inputs the definition declares. Values live in the owner view so opening detail never changes intent. */
  parameterValues?: Record<string, string>;
  onParameterChange?: (name: string, value: string) => void;
  onLaunch?: () => void;
  launching?: boolean;
  /** Outcome of the last launch attempt, already in plain words. */
  launchStatus?: string | null;
  /** Why Launch is refused right now, in plain words, or null when it can run. */
  blockedReason?: string | null;
  /** Server-derived assignment choices only; this view never infers routing from declarations. */
  assignmentOptions?: WorkflowAssignmentOptions | null;
  onAssign?: (target: AssignTarget, assignment: Assignment | null) => void;
  assignBusy?: boolean;
  assignStatus?: React.ReactNode;
}

/**
 * Risk tier as a mono chip. Tier colours are a sanctioned data-encoding taxonomy, but tier is ALSO
 * carried by the label itself, so the chip stays readable without relying on hue.
 */
function TierChip({ tier }: { tier: string }): React.JSX.Element {
  return <span className={`entity-tier entity-tier--${tier.toLowerCase()} mc-mono`}>{tier}</span>;
}

/** One run row, shared by this view's Runs list and the Workflows roster's Ad-hoc group. */
export function RunRow({
  run,
  now,
  onOpen,
}: {
  run: RunMetadataDto;
  now?: number;
  onOpen?: (runRef: string) => void;
}): React.JSX.Element {
  return (
    <div
      className="entity-row entity-row--link"
      data-testid={`workflow-run-${run.runRef}`}
      aria-disabled={!onOpen || undefined}
      {...entityRowProps(() => onOpen?.(run.runRef))}
    >
      <span className="entity-row__main">
        <EntityName kind="run" id={run.runRef} displayName={run.displayName} shortRef={run.shortRef} />
      </span>
      <span className="entity-row__meta">
        <span className={`mc-status-dot mc-status-dot--${runDot(run.state)}`} aria-hidden="true" />
        {runStateLabel(run.state)}
      </span>
      {run.openHumanRequestCount > 0 ? (
        <span className="entity-row__meta" data-testid={`workflow-run-${run.runRef}-needs-you`}>
          {run.openHumanRequestCount} waiting on you
        </span>
      ) : null}
      <span className="mc-mono entity-row__meta">{relativeAge(run.updatedAt, now)}</span>
    </div>
  );
}

export function WorkflowDetail({
  entry,
  compiled: injectedCompiled,
  runs,
  now,
  onOpenRun,
  onNavigate,
  onBack,
  backLabel,
  activeSectionId,
  onSectionChange,
  parameterValues = {},
  onParameterChange,
  onLaunch,
  launching = false,
  launchStatus,
  blockedReason,
  assignmentOptions,
  onAssign,
  assignBusy = false,
  assignStatus,
}: WorkflowDetailProps): React.JSX.Element {
  const [fetched, setFetched] = useState<WorkflowCompiled | null>(injectedCompiled ?? null);
  // A controlled `activeSectionId` from the nav stack wins; the local copy supports this view alone.
  const [localSection, setLocalSection] = useState<string | undefined>(undefined);
  const selectedSection = activeSectionId ?? localSection;
  const selectSection = (id: string): void => {
    setLocalSection(id);
    onSectionChange?.(id);
  };

  /**
   * The compiled preview is DECORATION over the list entry: the detail is fully readable without it, so
   * a failure here degrades the technical fold rather than blocking the view.
   */
  useEffect(() => {
    if (injectedCompiled !== undefined || typeof fetch !== 'function') return;
    let alive = true;
    fetch(`/api/workflows/${encodeURIComponent(entry.ref)}`)
      .then((r) => r.json() as Promise<{ compiled: WorkflowCompiled | null }>)
      .then((d) => { if (alive) setFetched(d?.compiled ?? null); })
      .catch(() => { /* the technical fold degrades; the workflow still reads */ });
    return () => { alive = false; };
  }, [entry.ref, injectedCompiled]);

  const compiled = injectedCompiled !== undefined ? injectedCompiled : fetched;
  const compiledStages = compiled?.ok ? compiled.stages ?? [] : [];
  const compilerFailure = !entry.valid ? null
    : (entry.launchable === false ? entry.compileDetail : compiled?.ok === false ? compiled.detail : null);
  const parameters = entry.parameters ?? [];
  const parametersMissing = parameters.some((name) => (parameterValues[name] ?? '').trim() === '');
  const canLaunch = Boolean(onLaunch) && entry.valid && entry.launchable !== false
    && !blockedReason && !parametersMissing && !launching;
  const body = (
    <>
      {entry.valid ? null : (
        <section className="entity-undeclared" data-testid="workflow-invalid" aria-label="This workflow cannot run">
          <p className="entity-undeclared__head">
            <span className="entity-undeclared__tag mc-mono">needs a fix</span>
            This workflow does not read correctly, so it cannot run.
          </p>
          <p className="entity-undeclared__body" data-testid="workflow-invalid-detail">
            {entry.detail ?? 'No reason was reported by the validator.'}
          </p>
        </section>
      )}

      {compilerFailure ? (
        <section className="entity-undeclared" data-testid="workflow-compile-unavailable" aria-label="This workflow cannot run">
          <p className="entity-undeclared__head">
            <span className="entity-undeclared__tag mc-mono">cannot run</span>
            This workflow reads correctly but cannot be started.
          </p>
          <p className="entity-undeclared__body">{compilerFailure}</p>
        </section>
      ) : null}

      {blockedReason ? (
        <p className="entity-note" role="status" data-testid="workflow-blocked">{blockedReason}</p>
      ) : null}

      <section className="entity-block" aria-label="Who runs what">
        <h3 className="entity-block__title">Who runs what</h3>
        <WorkflowAgentGraph
          entry={entry}
          assignmentOptions={assignmentOptions}
          onAssign={onAssign}
          onOpenAgent={(agentId) => onNavigate?.({ view: 'agents', focus: { kind: 'agent', id: agentId } })}
          readOnly={assignBusy || Boolean(blockedReason)}
        />
        {assignStatus ? (
          <p className="entity-note" role="status" data-testid="workflow-assign-status">{assignStatus}</p>
        ) : null}
      </section>

      <details className="entity-fold" data-testid="workflow-technical">
        <summary>Technical details</summary>
        <div className="entity-fold__body">
          <dl className="entity-kv" data-testid="workflow-facts">
            <div className="entity-kv__row"><dt>File</dt><dd className="mc-mono">{entry.path}</dd></div>
            <div className="entity-kv__row">
              <dt>Source revision</dt>
              <dd className="mc-mono" data-testid="workflow-source-hash">{entry.sourceHash ?? 'unavailable'}</dd>
            </div>
            <div className="entity-kv__row">
              <dt>Tool profile</dt>
              <dd className="mc-mono">{entry.profile ?? <span className="entity-empty-value">—</span>}</dd>
            </div>
            <div className="entity-kv__row">
              <dt>Plan id</dt>
              <dd className="mc-mono">{compiled?.ok ? compiled.proposalId : '—'}</dd>
            </div>
            <div className="entity-kv__row">
              {/* In FULL. A sliced hash cannot be compared against anything, which is its only use. */}
              <dt>Plan hash</dt>
              <dd className="mc-mono">{compiled?.ok ? compiled.contentHash : '—'}</dd>
            </div>
          </dl>

          {entry.pendingAmendment ? (
            <p className="entity-note" data-testid="workflow-pending-change">
              Waiting on branch <span className="mc-mono">{entry.pendingAmendment.branch}</span>, new source revision{' '}
              <span className="mc-mono">{entry.pendingAmendment.proposedSourceHash}</span>.{' '}
              {entry.pendingAmendment.pr.url ? <a href={entry.pendingAmendment.pr.url}>Open pull request</a> : null}
            </p>
          ) : null}
          {entry.pendingAmendmentError ? (
            <p className="entity-note" data-testid="workflow-pending-change-error">{entry.pendingAmendmentError}</p>
          ) : null}

          {entry.governanceProblems?.length ? (
            <ul className="entity-note" data-testid="workflow-governance-problems">
              {entry.governanceProblems.map((problem) => <li key={problem}>{problem}</li>)}
            </ul>
          ) : null}

          <h4 className="entity-block__title">Steps</h4>
          {compiledStages.length ? (
            <ol className="entity-list" data-testid="workflow-stages">
              {compiledStages.map((stage) => (
                <li key={stage.id}>
                  <div className="entity-row" data-testid={`workflow-stage-${stage.id}`}>
                    <span className="entity-row__main">
                      <span className="mc-mono">{stage.action}</span> → <span className="mc-mono">{stage.target}</span>
                    </span>
                    <TierChip tier={stage.riskTier} />
                    <span className="mc-mono entity-row__meta">
                      {stage.dependsOn.length ? `after ${stage.dependsOn.join(', ')}` : 'starts the workflow'}
                    </span>
                  </div>
                  <p className="entity-note entity-stage__order">{stage.workOrder}</p>
                  <p className="entity-note">
                    <span className="mc-mono">read</span> {stage.scope.read.join(', ') || '—'} ·{' '}
                    <span className="mc-mono">write</span> {stage.scope.write.join(', ') || '—'}
                  </p>
                </li>
              ))}
            </ol>
          ) : entry.stages.length ? (
            // Compiled preview unavailable: show the list endpoint's four-field steps and SAY that this
            // is the reduced view, rather than silently presenting it as the whole picture.
            <>
              <ol className="entity-list" data-testid="workflow-stages-preview">
                {entry.stages.map((stage) => (
                  <li key={stage.id}>
                    <div className="entity-row" data-testid={`workflow-stage-${stage.id}`}>
                      <span className="entity-row__main">
                        <span className="mc-mono">{stage.action}</span> → <span className="mc-mono">{stage.target}</span>
                      </span>
                      <TierChip tier={stage.riskTier} />
                    </div>
                  </li>
                ))}
              </ol>
              <p className="entity-note">
                Reduced view — scope and ordering come from the compiled plan, which could not be read.
              </p>
            </>
          ) : (
            <p className="entity-note">This workflow declares no steps.</p>
          )}

          {/*
            * The control-plane launch: a governed run started straight from the definition, with the
            * inputs it declares. It stays fully wired — it is how the governing agent and power use
            * start a run — but it is no longer what an operator meets first. "Run workflow" above is.
            */}
          <h4 className="entity-block__title">Start a governed run directly</h4>
          <div className="v-workflows__direct-launch" data-testid="workflow-direct-launch">
            {parameters.map((name) => (
              <label key={name} className="entity-detail__param">
                <span>{name}</span>
                <input
                  aria-label={`Workflow parameter ${name}`}
                  value={parameterValues[name] ?? ''}
                  onChange={(event) => onParameterChange?.(name, event.target.value)}
                />
              </label>
            ))}
            <button
              type="button"
              className="mc-btn"
              disabled={!canLaunch}
              title={blockedReason ?? (parametersMissing ? 'Fill in every input first.' : undefined)}
              onClick={() => onLaunch?.()}
            >
              {launching ? 'Launching…' : 'Launch'}
            </button>
            {launchStatus ? (
              <span className="v-workflows__run-status" data-testid={`workflow-def-status-${entry.ref}`}>{launchStatus}</span>
            ) : null}
          </div>
        </div>
      </details>
    </>
  );

  /** Governed runs only. `undefined` and an empty list remain distinct claims. */
  const runsBody = (
    <>
      <section className="entity-block" aria-label="Governed runs">
        <h3 className="entity-block__title">Runs</h3>
        {runs === undefined ? (
          <p className="entity-note" data-testid="workflow-runs-unloaded">
            Not loaded — unlock the dashboard to see this workflow&rsquo;s runs.
          </p>
        ) : runs.length === 0 ? (
          <p className="entity-note" data-testid="workflow-runs-empty">
            This workflow has not run yet.
          </p>
        ) : (
          <ol className="entity-list" data-testid="workflow-runs">
            {runs.map((run) => (
              <li key={run.runRef}>
                <RunRow run={run} now={now} onOpen={onOpenRun} />
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );

  /** ONE header action: governed launch, then this definition's Runs tab. */
  const actions = (
    <div>
      <button
        type="button"
        className="mc-btn mc-btn--primary"
        data-testid="workflow-run"
        onClick={() => {
          onLaunch?.();
          selectSection('runs');
        }}
      >
        Run workflow
      </button>
      <p className="entity-note">Starts a governed run and shows its history under Runs.</p>
    </div>
  );

  const sections: DetailSection[] = [
    { id: 'flow', label: 'Flow', render: () => body },
    { id: 'runs', label: 'Runs', count: runs?.length ?? 0, render: () => runsBody },
  ];

  return (
    <EntityDetail
      entity={{ kind: 'workflow', id: entry.ref }}
      eyebrow={<>Workflow · <EntityName kind="workflow" id={entry.ref} displayName={entry.displayName} shortRef={entry.shortRef} muted /></>}
      title={entry.displayName}
      status={{ label: entry.valid ? 'ready' : 'needs a fix', tone: entry.valid ? 'ok' : 'error' }}
      facts={[
        { label: 'Project', value: entry.project, mono: true },
        { label: 'Steps', value: entry.stageCount, mono: true },
        { label: 'Highest tier', value: entry.riskTier ?? '—', mono: true },
        { label: 'Runs', value: runs === undefined ? '—' : runs.length, mono: true },
      ]}
      sections={sections}
      activeSectionId={selectedSection}
      onSectionChange={selectSection}
      onNavigate={onNavigate}
      onBack={onBack}
      backLabel={backLabel}
      actions={actions}
    />
  );
}
