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
import '../styles/views/entity.css';

/** One definition entry from `GET /api/workflows` (mirrors `server/workflows/routes.ts`). */
export interface WorkflowDefEntry {
  ref: string;
  project: string;
  path: string;
  valid: boolean;
  title: string | null;
  /** Existing workflow tool capability profile; never an agent assignment profile. */
  profile: string | null;
  manager?: { agentId: string; profileId: string } | null;
  stageCount: number;
  riskTier: string | null;
  stages: Array<{
    id: string; action: string; target: string; riskTier: string;
    declaredAssignment?: { agentId: string; profileId: string } | null;
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
}

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

  const sections: DetailSection[] = [
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
