/**
 * arc-3 step 4 — the workflow-definition detail, on the shared {@link EntityDetail} shell.
 *
 * A workflow is a reusable DEFINITION; a run is one execution instance. They are distinct entities with
 * distinct nav destinations, but they render the same `kb.plan-proposal/v1` structure — one as a plan,
 * one as a realized state machine — which is exactly why they share this shell.
 *
 * What this view makes visible that the two dense tables did not:
 *   - `detail`, the validation failure reason, which existed only as an invisible `title=` tooltip on
 *     the word "Invalid". A definition could be broken and the operator had no way to read why.
 *   - definition-level `riskTier`, in the DTO and never rendered.
 *   - the compiled `proposalId` / `contentHash`, and the FULL compiled stages (`dependsOn`, `workOrder`,
 *     `scope`) which the list endpoint's four-field stage preview omits.
 *   - **Runs launched from this definition** — the join that makes Launch's `runRef` stop being an
 *     inert string, via the un-dropped `sourceTurnId` (see `control/entityLinks.ts`).
 */
import { useEffect, useState } from 'react';
import type { ProposalRoutingDto, ProposalStageDto, ResolvedAgentAssignmentDto, RunMetadataDto } from '../control/controlClient';
import { EntityDetail, type DetailSection } from '../entity/EntityDetail';
import type { NavTarget } from '../nav/stack';
import { WorkflowAgentGraph, type GovernanceAgentOption, type GovernanceDraft } from './WorkflowAgentGraph';
import '../styles/views/entity.css';

/** One definition entry from `GET /api/workflows` (mirrors `server/workflows/routes.ts`). */
export interface WorkflowDefEntry {
  ref: string;
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
  manager?: { agentId: string; profileId: string } | null;
  stageCount: number;
  riskTier: string | null;
  stages: Array<{
    id: string; title?: string; action: string; target: string; riskTier: string; dependsOn?: string[];
    governedBy?: string | null;
    declaredAssignment?: { agentId: string; profileId: string } | null;
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
   * Runs launched from this definition, joined by the caller through `sourceTurnId`. `undefined` means
   * not loaded (no cockpit session), which reads differently from `[]` and is worded differently.
   */
  runs?: RunMetadataDto[];
  activeSectionId?: string;
  onSectionChange?: (id: string) => void;
  onNavigate?: (target: NavTarget) => void;
  onBack?: () => void;
  backLabel?: string;
  /** The governed Launch control, passed in so this view stays presentational. */
  actions?: React.ReactNode;
  /** Server-derived assignment choices only; this view never infers routing from declarations. */
  assignmentOptions?: { manager: AssignmentChoices; stages: Record<string, AssignmentChoices> } | null;
  onAssignmentAmend?: (target: { kind: 'manager' } | { kind: 'stage'; stageId: string }, assignment: { agentId: string; profileId: string } | null) => void;
  amendmentStatus?: React.ReactNode;
  /** Values stay in the owner view so opening detail never changes launch intent. */
  parameterValues?: Record<string, string>;
  onParameterChange?: (name: string, value: string) => void;
  governanceOptions?: GovernanceAgentOption[];
  governanceDraft?: GovernanceDraft;
  onGovernanceDraftChange?: (draft: GovernanceDraft) => void;
  onGovernanceSubmit?: () => void;
  governanceDirty?: boolean;
  governanceReadOnly?: boolean;
  governanceStatus?: React.ReactNode;
}

interface AssignmentChoices { options: Array<{ agentId: string; profileId: string }>; unavailable: string | null; }

/**
 * Risk tier as a mono chip. Tier colours are a sanctioned data-encoding taxonomy, but tier is ALSO
 * carried by the label itself, so the chip stays readable without relying on hue.
 */
function TierChip({ tier }: { tier: string }): React.JSX.Element {
  return <span className={`entity-tier entity-tier--${tier.toLowerCase()} mc-mono`}>{tier}</span>;
}

function AssignmentRouting({
  declared,
  effective,
  unavailableDetail,
  testId,
}: {
  declared: { agentId: string; profileId: string } | null | undefined;
  effective: (ProposalRoutingDto & { assignment?: ResolvedAgentAssignmentDto }) | undefined;
  unavailableDetail?: string | null;
  testId: string;
}): React.JSX.Element {
  return (
    <div className="entity-note" data-testid={testId}>
      <p>
        Declared assignment: <span className="mc-mono">{declared ? `${declared.agentId} · ${declared.profileId}` : 'unassigned'}</span>
      </p>
      {effective ? (
        <p>
          Effective immutable routing: <span className="mc-mono">{effective.runtime}/{effective.model}</span>
          {effective.assignment ? <> · declaration <span className="mc-mono">{effective.assignment.declarationHash}</span></> : null}
        </p>
      ) : unavailableDetail ? (
        <p>Effective routing unavailable: {unavailableDetail}</p>
      ) : (
        <p>Effective routing has not been compiled.</p>
      )}
    </div>
  );
}

export function WorkflowDetail({
  entry,
  compiled: injectedCompiled,
  runs,
  activeSectionId,
  onSectionChange,
  onNavigate,
  onBack,
  backLabel,
  actions,
  assignmentOptions,
  onAssignmentAmend,
  amendmentStatus,
  parameterValues = {},
  onParameterChange,
  governanceOptions = [],
  governanceDraft,
  onGovernanceDraftChange,
  onGovernanceSubmit,
  governanceDirty = false,
  governanceReadOnly = false,
  governanceStatus,
}: WorkflowDetailProps): React.JSX.Element {
  const [fetched, setFetched] = useState<WorkflowCompiled | null>(injectedCompiled ?? null);

  /**
   * The compiled preview is DECORATION over the list entry: the detail is fully readable without it, so
   * a failure here degrades the Compiled and Stages sections rather than blocking the view.
   */
  useEffect(() => {
    if (injectedCompiled !== undefined || typeof fetch !== 'function') return;
    let alive = true;
    fetch(`/api/workflows/${encodeURIComponent(entry.ref)}`)
      .then((r) => r.json() as Promise<{ compiled: WorkflowCompiled | null }>)
      .then((d) => { if (alive) setFetched(d?.compiled ?? null); })
      .catch(() => { /* compiled sections degrade; the definition still reads */ });
    return () => { alive = false; };
  }, [entry.ref, injectedCompiled]);

  const compiled = injectedCompiled !== undefined ? injectedCompiled : fetched;
  // Prefer the compiled stages (dependsOn, workOrder, scope); fall back to the list's four-field preview.
  const compiledStages = compiled?.ok ? compiled.stages ?? [] : [];
  const compilerFailure = !entry.valid ? null : (entry.launchable === false ? entry.compileDetail : compiled?.ok === false ? compiled.detail : null);

  const overview = (
    <>
      {/* The reason a definition is invalid was previously reachable only by hovering the word
       *  "Invalid" — a tooltip is not a way to deliver a validation failure. */}
      {entry.valid ? null : (
        <section className="entity-undeclared" data-testid="workflow-invalid" aria-label="Definition is invalid">
          <p className="entity-undeclared__head">
            <span className="entity-undeclared__tag mc-mono">invalid</span>
            This definition does not compile and cannot be launched.
          </p>
          <p className="entity-undeclared__body" data-testid="workflow-invalid-detail">
            {entry.detail ?? 'No reason was reported by the validator.'}
          </p>
        </section>
      )}

      {compilerFailure ? (
        <section className="entity-undeclared" data-testid="workflow-compile-unavailable" aria-label="Workflow cannot launch">
          <p className="entity-undeclared__head">
            <span className="entity-undeclared__tag mc-mono">unavailable</span>
            This syntactically valid definition cannot be launched.
          </p>
          <p className="entity-undeclared__body">{compilerFailure}</p>
        </section>
      ) : null}

      <section className="entity-block" aria-label="Definition">
        <h3 className="entity-block__title">Definition</h3>
        <dl className="entity-kv" data-testid="workflow-facts">
          <div className="entity-kv__row">
            <dt>Project</dt>
            <dd className="mc-mono">{entry.project}</dd>
          </div>
          <div className="entity-kv__row">
            <dt>Path</dt>
            <dd className="mc-mono">{entry.path}</dd>
          </div>
          <div className="entity-kv__row">
            <dt>Workflow tool profile</dt>
            <dd className="mc-mono">{entry.profile ?? <span className="entity-empty-value">—</span>}</dd>
          </div>
          <div className="entity-kv__row">
            {/* Definition-level risk tier: in the DTO since D15 and rendered nowhere until now. */}
            <dt>Highest tier</dt>
            <dd>{entry.riskTier ? <TierChip tier={entry.riskTier} /> : <span className="entity-empty-value">—</span>}</dd>
          </div>
          <div className="entity-kv__row">
            <dt>Stages</dt>
            <dd className="mc-mono">{entry.stageCount}</dd>
          </div>
        </dl>
      </section>

      <section className="entity-block" aria-label="Manager assignment">
        <h3 className="entity-block__title">Manager assignment</h3>
        <AssignmentRouting
          testId="workflow-manager-routing"
          declared={entry.manager}
          effective={compiled?.ok ? compiled.manager : undefined}
          unavailableDetail={compilerFailure}
        />
      </section>

      <section className="entity-block" aria-label="Assignment amendments">
        <h3 className="entity-block__title">Pre-launch assignment amendments</h3>
        <p className="entity-note">Active source hash: <span className="mc-mono" data-testid="workflow-source-hash">{entry.sourceHash ?? 'unavailable'}</span></p>
        <AssignmentAmendmentRow label="Manager" target={{ kind: 'manager' }} declared={entry.manager} choices={assignmentOptions?.manager} onAmend={onAssignmentAmend} readOnly={governanceReadOnly} />
        {entry.stages.map((stage) => <AssignmentAmendmentRow key={stage.id} label={`Stage ${stage.id}`} target={{ kind: 'stage', stageId: stage.id }} declared={stage.declaredAssignment} choices={assignmentOptions?.stages[stage.id]} onAmend={onAssignmentAmend} readOnly={governanceReadOnly} />)}
        {amendmentStatus ? <p className="entity-note" data-testid="workflow-amendment-status">{amendmentStatus}</p> : null}
      </section>

      {(entry.parameters ?? []).length > 0 ? <section className="entity-block" aria-label="Launch parameters">
        <h3 className="entity-block__title">Launch parameters</h3>
        <p className="entity-note">These values are sent only in the governed launch request.</p>
        {(entry.parameters ?? []).map((name) => <label key={name} className="entity-note">{name}<input aria-label={`Workflow parameter ${name}`} value={parameterValues[name] ?? ''} onChange={(event) => onParameterChange?.(name, event.target.value)} /></label>)}
      </section> : null}

      <p className="entity-note">
        Registering a definition does not launch it. Launching compiles it to a governed proposal, which
        is approved and then executed as a run.
      </p>
    </>
  );

  const stages = (
    <section className="entity-block" aria-label="Compiled stages">
      <h3 className="entity-block__title">Stages</h3>
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
                  {/* dependsOn is the definition's DAG and was never rendered anywhere. */}
                  {stage.dependsOn.length ? `depends on ${stage.dependsOn.join(', ')}` : 'no dependencies'}
                </span>
              </div>
              <p className="entity-note entity-stage__order">{stage.workOrder}</p>
              <p className="entity-note">
                <span className="mc-mono">read</span> {stage.scope.read.join(', ') || '—'} ·{' '}
                <span className="mc-mono">write</span> {stage.scope.write.join(', ') || '—'}
              </p>
              <AssignmentRouting
                testId={`workflow-stage-routing-${stage.id}`}
                declared={entry.stages.find((preview) => preview.id === stage.id)?.declaredAssignment}
                effective={{ ...stage.worker, ...(stage.assignment ? { assignment: stage.assignment } : {}) }}
                unavailableDetail={compilerFailure}
              />
            </li>
          ))}
        </ol>
      ) : entry.stages.length ? (
        // Compiled preview unavailable: show the list endpoint's four-field stages and SAY that this is
        // the reduced view, rather than silently presenting it as the whole picture.
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
                <AssignmentRouting
                  testId={`workflow-stage-routing-${stage.id}`}
                  declared={stage.declaredAssignment}
                  effective={undefined}
                  unavailableDetail={compilerFailure}
                />
              </li>
            ))}
          </ol>
          <p className="entity-note">
            Preview only — scope and dependencies come from the compiled proposal, which could not be read.
          </p>
        </>
      ) : (
        <p className="entity-note">This definition declares no stages.</p>
      )}
    </section>
  );

  /**
   * THE step-2 payoff. Before the `sourceTurnId` un-drop there was no way to get from a definition to
   * anything it had ever launched; Launch printed a runRef into a status string and that was the end of it.
   */
  const runsSection = (
    <section className="entity-block" aria-label="Runs launched from this definition">
      <h3 className="entity-block__title">Runs</h3>
      {runs === undefined ? (
        <p className="entity-note" data-testid="workflow-runs-unloaded">
          Not loaded. Reading managed runs needs an unlocked cockpit session.
        </p>
      ) : runs.length === 0 ? (
        <p className="entity-note" data-testid="workflow-runs-empty">
          This definition has not been launched yet.
        </p>
      ) : (
        <ol className="entity-list" data-testid="workflow-runs">
          {runs.map((run) => (
            <li key={run.runRef}>
              <button
                type="button"
                className="entity-row entity-row--link"
                data-testid={`workflow-run-${run.runRef}`}
                disabled={!onNavigate}
                onClick={() => onNavigate?.({ view: 'pipeline', focus: { kind: 'run', id: run.runRef } })}
              >
                <span className="entity-row__main">{run.title}</span>
                <span className="mc-mono entity-row__ref">{run.runRef}</span>
                <span className="mc-mono entity-row__meta">{run.state}</span>
                <span className="mc-mono entity-row__meta">{run.stageCount} stages</span>
              </button>
            </li>
          ))}
        </ol>
      )}
      <p className="entity-note">
        Joined on the proposal revisions this definition stamped with its own id.
      </p>
    </section>
  );

  const compiledSection = (
    <section className="entity-block" aria-label="Compiled proposal">
      <h3 className="entity-block__title">Compiled proposal</h3>
      {compiled?.ok ? (
        <dl className="entity-kv" data-testid="workflow-compiled">
          <div className="entity-kv__row">
            <dt>Proposal id</dt>
            <dd className="mc-mono">{compiled.proposalId}</dd>
          </div>
          <div className="entity-kv__row">
            <dt>Content hash</dt>
            {/* In FULL. A sliced hash cannot be compared against anything, which is its only use. */}
            <dd className="mc-mono">{compiled.contentHash}</dd>
          </div>
        </dl>
      ) : compiled ? (
        <p className="entity-note" data-testid="workflow-compile-error">
          Compilation failed: {compiled.detail ?? compiled.error ?? 'no reason reported'}
        </p>
      ) : (
        <p className="entity-note" data-testid="workflow-compiled-unloaded">
          The compiled preview could not be read.
        </p>
      )}
      <p className="entity-note">
        A definition is content-addressed: identical content always compiles to the same proposal
        identity, so relaunching unchanged content reuses the approved revision instead of minting a
        second one.
      </p>
    </section>
  );

  const agentsSection = (
    <section className="entity-block" aria-label="Agent handoff network">
      <h3 className="entity-block__title">Agent handoff network</h3>
      <p className="entity-note">
        Stages remain the dependency and retry units. This view groups them by accountable agent and
        derives cross-agent handoffs from the underlying stage dependencies.
      </p>
      {entry.governanceProblems?.length ? (
        <section className="entity-undeclared" data-testid="workflow-governance-problems" aria-label="Workflow governance needs correction">
          <p className="entity-undeclared__head">
            <span className="entity-undeclared__tag mc-mono">governance</span>
            Authored ownership does not match the declared project roster.
          </p>
          <ul className="entity-undeclared__body">
            {entry.governanceProblems.map((problem) => <li key={problem}>{problem}</li>)}
          </ul>
          <p className="entity-undeclared__body">
            Ownership remains compile-neutral: executable assignments and the compiled proposal are unchanged.
          </p>
        </section>
      ) : null}
      {governanceDraft && onGovernanceDraftChange ? (
        <>
          <label className="entity-note">Workflow governor{' '}
            <select aria-label="Workflow governor" value={governanceDraft.workflow ?? ''} disabled={governanceReadOnly} onChange={(event) => onGovernanceDraftChange({ ...governanceDraft, workflow: event.target.value || null })}>
              <option value="">Unassigned</option>
              {governanceOptions.map((agent) => <option key={agent.id} value={agent.id}>{agent.id}</option>)}
            </select>
          </label>
          <WorkflowAgentGraph
            entry={entry}
            agents={governanceOptions}
            draft={governanceDraft}
            onDraftChange={onGovernanceDraftChange}
            onOpenAgent={(agentId) => onNavigate?.({ view: 'agents', focus: { kind: 'agent', id: agentId } })}
            readOnly={governanceReadOnly}
          />
          <div className="v-workflow-network__actions">
            <button type="button" className="mc-btn mc-btn--primary" disabled={!governanceDirty || governanceReadOnly || !onGovernanceSubmit} onClick={onGovernanceSubmit}>
              Submit ownership plan
            </button>
            <span className="entity-note">One source-addressed batch amendment and one human-reviewed PR.</span>
          </div>
          {governanceStatus ? <p className="entity-note" role="status" data-testid="workflow-governance-status">{governanceStatus}</p> : null}
        </>
      ) : <p className="entity-note">Governance data could not be loaded.</p>}
    </section>
  );

  const sections: DetailSection[] = [
    { id: 'agents', label: 'Agents', count: new Set([entry.governedBy, ...entry.stages.map((stage) => stage.governedBy)].filter(Boolean)).size, render: () => agentsSection },
    { id: 'overview', label: 'Overview', attention: !entry.valid, render: () => overview },
    { id: 'stages', label: 'Stages', count: entry.stageCount, render: () => stages },
    { id: 'runs', label: 'Runs', count: runs?.length, render: () => runsSection },
    { id: 'compiled', label: 'Compiled', render: () => compiledSection },
  ];

  return (
    <EntityDetail
      entity={{ kind: 'workflow', id: entry.ref }}
      eyebrow={`Workflow definition · ${entry.ref}`}
      title={entry.title ?? entry.ref}
      status={{ label: entry.valid ? 'valid' : 'invalid', tone: entry.valid ? 'ok' : 'error' }}
      facts={[
        { label: 'Project', value: entry.project, mono: true },
        { label: 'Workflow tool profile', value: entry.profile ?? '—', mono: true },
        { label: 'Stages', value: entry.stageCount, mono: true },
        { label: 'Highest tier', value: entry.riskTier ?? '—', mono: true },
      ]}
      sections={sections}
      activeSectionId={activeSectionId}
      onSectionChange={onSectionChange}
      onNavigate={onNavigate}
      onBack={onBack}
      backLabel={backLabel}
      actions={actions}
    />
  );
}

function AssignmentAmendmentRow({ label, target, declared, choices, onAmend, readOnly = false }: {
  label: string;
  target: { kind: 'manager' } | { kind: 'stage'; stageId: string };
  declared: { agentId: string; profileId: string } | null | undefined;
  choices: AssignmentChoices | undefined;
  onAmend?: WorkflowDetailProps['onAssignmentAmend'];
  readOnly?: boolean;
}): React.JSX.Element {
  const [choice, setChoice] = useState('');
  const assignmentKey = (option: { agentId: string; profileId: string }): string => JSON.stringify([option.agentId, option.profileId]);
  const selected = choices?.options.find((option) => assignmentKey(option) === choice);
  return <div className="entity-note" data-testid={`workflow-amendment-${target.kind === 'manager' ? 'manager' : target.stageId}`}>
    <p><span className="mc-mono">{label}</span> · {declared ? `${declared.agentId} · ${declared.profileId}` : 'unassigned'}</p>
    {choices?.unavailable ? <p>{choices.unavailable}</p> : null}
    {choices?.options.length ? <><select aria-label={`${label} assignment`} value={choice} disabled={readOnly} onChange={(event) => setChoice(event.target.value)}><option value="">Select eligible assignment</option>{choices.options.map((option) => <option key={assignmentKey(option)} value={assignmentKey(option)}>{option.agentId} · {option.profileId}</option>)}</select><button type="button" className="mc-btn mc-btn--quiet" disabled={!selected || readOnly} onClick={() => selected && onAmend?.(target, selected)}>Amend</button></> : null}
    {declared ? <button type="button" className="mc-btn mc-btn--quiet" disabled={readOnly} onClick={() => onAmend?.(target, null)}>Clear assignment</button> : null}
  </div>;
}
