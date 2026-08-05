/**
 * The agent detail, on the shared {@link EntityDetail} shell.
 *
 * ── Shape (UX overhaul §4): identity, then what it is DOING, then ONE technical fold ──
 *
 * Primary UI answers an operator's three questions in order: who is this agent, what is it doing right
 * now, and can I talk to it (the "Run agent" action, one click into a live primed session). Everything
 * that is machinery rather than status — the declaration file and its instructions, declared runtime /
 * model / execution profiles, the runner flag, roster provenance, governed workflows and stages, ledger
 * rollups, and the effective-routing control — lives behind a SINGLE "Technical details" fold. There is
 * no second fold and no jargon in the primary text: `declared`, `runner-bound` and `binding` are terms
 * of art, and terms of art belong inside the fold that explains them.
 *
 * ── The not-declared state is still stated, never implied ──
 *
 * On a checkout with no `agents/` directory, `readDeclaredAgents` fails OPEN to an empty map and every
 * roster row arrives with a null `description`, `declaredRuntime` and `declaredModel`. Rendering those
 * nulls as blanks would look broken — the operator could not tell "we failed to load this" from "this
 * was never written down". So the primary surface says it in one plain line, and the fold names the
 * exact missing file and what writing it would add. Neutral chrome throughout: a missing declaration is
 * a fact, not an error.
 */
import type { PlaneAIndex } from '../../server/planeA/indexer';
import type { RunMetadataDto } from '../control/controlClient';
import { cardsForAgent, runLink } from '../control/entityLinks';
import { relativeAge } from '../control/runEvents';
import { EntityName } from '../components/EntityName';
import { entityRowProps } from '../components/entityRow';
import { EntityDetail, type DetailSection, type EntityLink } from '../entity/EntityDetail';
import type { AgentDetailDto } from '../lib/agentClient';
import { renderMarkdown } from '../lib/markdown';
import type { NavTarget } from '../nav/stack';
import '../styles/views/entity.css';

/** Everything the detail renders about one agent. A superset of the roster table's row. */
export interface AgentDetailRow {
  id: string;
  /** Server-owned agent display identity, or null on a card-ownership fallback row (see Agents.tsx). */
  display: { displayName: string; shortRef: number } | null;
  role: string | null;
  working: boolean;
  current: { action: string; id: string; displayName: string; shortRef: number } | null;
  projects: string[];
  cardCount: number;
  lastActive: string | null;
  declared: boolean;
  runnerBound: boolean;
  declaredRuntime: string | null;
  /** Fetched by the roster on every load and, until now, rendered nowhere. */
  declaredModel: string | null;
  /** Declared default execution profile id, or null for a legacy declaration. */
  defaultProfile: string | null;
  /** Declared execution profile ids this declaration permits, or null for a legacy declaration. */
  allowedProfiles: string[] | null;
  description: string | null;
  ledger: { dispatches: number; steps: number; days: number };
  /** Which roster sources produced this row: `queue` (owns cards) and/or `ledger` (wrote ledgers). */
  sources: Array<'queue' | 'ledger'>;
}

export interface AgentDetailProps {
  agent: AgentDetailRow;
  /** The Plane-A snapshot, for the agent's owned queue cards. */
  index?: PlaneAIndex;
  /**
   * Runs this agent is working, joined through queue-card ownership by the caller. `undefined` means
   * "not loaded" (no session), which reads differently from `[]` ("loaded, none") and is said so.
   */
  runs?: RunMetadataDto[];
  /**
   * How many recent runs the caller scanned to build `runs`. Disclosed in the section, because a
   * silently truncated join is worse than a stated partial one.
   */
  runScanLimit?: number;
  /** The governed per-agent model routing control, passed in so this view stays presentational. */
  routing?: React.ReactNode;
  /** Read-only declaration-backed facts from GET /api/agents/:id. */
  detail?: AgentDetailDto | null;
  /** Distinguishes a request still in flight from a detail that has no optional relationships. */
  detailState?: 'loading' | 'ready' | 'unavailable';
  /**
   * Start an interactive session as this agent: the caller lands the operator in a live terminal with
   * claude already primed by the agent's own file. One click, no intermediate workspace. Only offered
   * for an agent that HAS a definition file — there is nothing to prime a session with otherwise.
   */
  onRunAgent?: (agent: AgentDetailRow) => void;
  activeSectionId?: string;
  onSectionChange?: (id: string) => void;
  onNavigate?: (target: NavTarget) => void;
  onBack?: () => void;
  backLabel?: string;
}

/** A value that exists, or an explicit dash — never an empty cell that reads as a load failure. */
function orDash(value: string | null): React.ReactNode {
  return value ?? <span className="entity-empty-value">—</span>;
}

/**
 * Last activity as an age ("3d ago"), which is what an operator actually reads for. A raw `YYYY-MM-DD`
 * is a record, not a status. `null` means the agent has never written a ledger row, and says so.
 */
export function lastActiveLabel(lastActive: string | null, now: number = Date.now()): React.ReactNode {
  if (lastActive === null) return <span className="entity-empty-value">never</span>;
  return relativeAge(lastActive, now);
}

/** Profile declarations are distinct from legacy runtime/model defaults and must not render as blanks. */
function profileContract(value: string | null): React.ReactNode {
  return value ?? <span className="entity-empty-value">not declared (legacy)</span>;
}

/** Keep an empty array distinct from a legacy null even though valid declarations normally have profiles. */
function allowedProfileContract(value: string[] | null): React.ReactNode {
  if (value === null) return <span className="entity-empty-value">not declared (legacy)</span>;
  if (value.length === 0) return <span className="entity-empty-value">none declared</span>;
  return value.map((profile, index) => (
    <span key={profile}>
      {index > 0 ? ', ' : null}
      <span className="mc-mono">{profile}</span>
    </span>
  ));
}

/**
 * The NOT-DECLARED panel. Names the file that would exist, what the agent is known from instead, and
 * what a declaration would add — so an operator reading a sparse detail knows why it is sparse.
 */
export function NotDeclaredPanel({ agent }: { agent: AgentDetailRow }): React.JSX.Element {
  const known = agent.sources.length
    ? agent.sources.map((s) => (s === 'queue' ? 'the queue cards it owns' : 'the ledger rows it wrote')).join(' and ')
    : 'the role catalog alone';
  return (
    <section className="entity-undeclared" data-testid="agent-not-declared" aria-label="Agent is not declared">
      <p className="entity-undeclared__head">
        <span className="entity-undeclared__tag mc-mono">not declared</span>
        No <code className="mc-mono">agents/{agent.id}.md</code> exists in this repository.
      </p>
      <p className="entity-undeclared__body">
        This agent is <strong>observed</strong>, not declared: everything below is inferred from {known}.
        It has no authoritative definition file, which is why it has no stated purpose, no declared
        runtime or model, and cannot be runner-bound.
      </p>
      <p className="entity-undeclared__body">
        Writing that file would add a one-line description of what this agent exists to do, its default
        runtime and model, and the human-set <code className="mc-mono">runner-bound</code> flag that lets a
        runner claim its cards. Until then this is an honest record of activity, not a definition.
      </p>
    </section>
  );
}

export function AgentDetail({
  agent,
  index,
  runs,
  runScanLimit,
  routing,
  detail,
  detailState,
  onRunAgent,
  activeSectionId,
  onSectionChange,
  onNavigate,
  onBack,
  backLabel,
}: AgentDetailProps): React.JSX.Element {
  const cards = index ? cardsForAgent(agent.id, index) : [];
  // The compact roster provides these facts before the declaration read completes. When the detail
  // projection arrives, prefer its exact declaration-backed values without changing legacy nulls.
  const declarationProfiles = detail?.declaration ?? null;
  const defaultProfile = declarationProfiles ? declarationProfiles.defaultProfile : agent.defaultProfile;
  const allowedProfiles = declarationProfiles ? declarationProfiles.allowedProfiles : agent.allowedProfiles;

  /**
   * Provenance chips — which of the roster's sources produced this row. Distinguished by LABEL and
   * mono weight, never by colour: this is a new taxonomy, and new taxonomies do not get new hues.
   */
  const provenance: string[] = [
    ...(agent.declared ? ['declared'] : []),
    ...agent.sources,
    ...(agent.role && !agent.declared ? ['role catalog'] : []),
  ];

  /** Everything technical about this agent, folded once. Nothing below this line is primary UI. */
  const technical = (
    <>
      {agent.declared ? null : <NotDeclaredPanel agent={agent} />}

      <section className="entity-block" aria-label="Declared defaults">
        <h3 className="entity-block__title">Declared defaults</h3>
        <dl className="entity-kv" data-testid="agent-declared">
          <div className="entity-kv__row">
            <dt>Runtime</dt>
            <dd className="mc-mono">{orDash(agent.declaredRuntime)}</dd>
          </div>
          <div className="entity-kv__row">
            <dt>Model</dt>
            <dd className="mc-mono">{orDash(agent.declaredModel)}</dd>
          </div>
          <div className="entity-kv__row">
            <dt>Default profile</dt>
            <dd className="mc-mono" data-testid="agent-default-profile">{profileContract(defaultProfile)}</dd>
          </div>
          <div className="entity-kv__row">
            <dt>Allowed profiles</dt>
            <dd data-testid="agent-allowed-profiles">{allowedProfileContract(allowedProfiles)}</dd>
          </div>
          <div className="entity-kv__row">
            <dt>Runner bound</dt>
            {/* The honest flag: declared but inert is a real and common state, so it is stated plainly. */}
            <dd className="mc-mono">{agent.runnerBound ? 'yes' : 'no'}</dd>
          </div>
        </dl>
        <p className="entity-note">
          Execution profile IDs are declared metadata from the agent file. Composition validates
          their availability against the server registry. Legacy declarations have no profile
          contract. Live routing is resolved separately and is shown — and changed — under Routing.
        </p>
      </section>

      <section className="entity-block" aria-label="Roster provenance">
        <h3 className="entity-block__title">Known from</h3>
        <div className="entity-chips" data-testid="agent-sources">
          {provenance.length ? (
            provenance.map((source) => (
              <span key={source} className="entity-chip mc-mono">{source}</span>
            ))
          ) : (
            <span className="entity-note">No source recorded.</span>
          )}
        </div>
      </section>

      <section className="entity-block" aria-label="Declaration source and instructions">
        <h3 className="entity-block__title">Declaration</h3>
        {detailState === 'loading' ? (
          <p className="entity-note" data-testid="agent-detail-loading">Loading declaration-backed relationships…</p>
        ) : detailState === 'unavailable' ? (
          <p className="entity-note" data-testid="agent-detail-unavailable">
            Additional declaration facts are unavailable. The roster facts above remain the last safe data loaded.
          </p>
        ) : detail?.declaration ? (
          <>
            <dl className="entity-kv" data-testid="agent-declaration">
              <div className="entity-kv__row">
                <dt>Source file</dt>
                <dd className="mc-mono">{detail.declaration.path}</dd>
              </div>
              <div className="entity-kv__row">
                <dt>Source</dt>
                <dd>{orDash(detail.declaration.source)}</dd>
              </div>
            </dl>
            {detail.declaration.instructions ? (
              <div
                className="entity-prose"
                data-testid="agent-instructions"
                // Safe: renderMarkdown escapes all source HTML before transforming Markdown.
                dangerouslySetInnerHTML={{ __html: renderMarkdown(detail.declaration.instructions) }}
              />
            ) : (
              <p className="entity-note">No runnable instructions are recorded in this declaration.</p>
            )}
          </>
        ) : agent.declared ? (
          <p className="entity-note">No declaration detail was returned for this declared roster entry.</p>
        ) : (
          <p className="entity-note">Observed runtime identities have no declaration source or instructions.</p>
        )}
      </section>

      {detailState === 'ready' && detail ? (
        <>
          <section className="entity-block" aria-label="Codebase relationships">
            <h3 className="entity-block__title">Codebases</h3>
            {detail.codebases.length ? (
              <ul className="entity-list" data-testid="agent-codebases">
                {detail.codebases.map((codebase) => (
                  <li key={`${codebase.project}:${codebase.path ?? ''}`} className="entity-row">
                    <span className="entity-row__main">{codebase.project}</span>
                    {codebase.path ? <span className="mc-mono entity-row__ref">{codebase.path}</span> : null}
                    {codebase.relationship ? <span className="entity-row__meta">{codebase.relationship}</span> : null}
                  </li>
                ))}
              </ul>
            ) : <p className="entity-note">No codebase relationship is declared.</p>}
          </section>

          <section className="entity-block" aria-label="Workflow relationships">
            <h3 className="entity-block__title">Governance</h3>
            {detail.workflows.length ? (
              <ul className="entity-list" data-testid="agent-workflows">
                {detail.workflows.map((workflow) => (
                  <li key={workflow.ref} className="entity-governance">
                    <button
                      type="button"
                      className="entity-row entity-row--link"
                      data-testid={`agent-workflow-${workflow.ref}`}
                      disabled={!onNavigate}
                      onClick={() => onNavigate?.({ view: 'workflows', focus: { kind: 'workflow', id: workflow.ref } })}
                    >
                      <span className="entity-row__main">{workflow.title ?? workflow.ref}</span>
                      <span className="mc-mono entity-row__ref">{workflow.path ?? workflow.ref}</span>
                      {workflow.relationship ? <span className="entity-row__meta">{workflow.relationship}</span> : null}
                      <span className="entity-row__meta">Open workflow</span>
                    </button>
                    {workflow.governsWorkflow ? (
                      <p className="entity-note" data-testid={`agent-governs-workflow-${workflow.ref}`}>
                        Governs the workflow and its cross-agent handoffs.
                      </p>
                    ) : null}
                    {workflow.stages?.length ? (
                      <ol className="entity-list" data-testid={`agent-governed-stages-${workflow.ref}`}>
                        {workflow.stages.map((stage) => (
                          <li key={stage.id} className="entity-row" data-testid={`agent-governed-stage-${stage.id}`}>
                            <span className="entity-row__main">{stage.title}</span>
                            <span className="mc-mono entity-row__ref">{stage.id}</span>
                            <span className="entity-row__meta">
                              Input: {stage.dependsOn.length ? stage.dependsOn.join(', ') : 'workflow start'}
                            </span>
                            <span className="entity-row__meta">
                              Output: <span className="mc-mono">{stage.action}</span> to <span className="mc-mono">{stage.target}</span>
                            </span>
                            {stage.review ? <span className="entity-row__meta">Reviews {stage.review.subjectStageId}; max {stage.review.maxCreatorReworks} creator reworks</span> : null}
                            {stage.completionGate ? <span className="entity-row__meta">Gate {stage.completionGate.id}: approval after review pass</span> : null}
                          </li>
                        ))}
                      </ol>
                    ) : workflow.governsWorkflow ? (
                      <p className="entity-note">Coordinates this workflow without owning an artifact-producing stage.</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : <p className="entity-note">This agent governs no workflow or workflow stages.</p>}
          </section>

          <section className="entity-block" aria-label="How this agent runs">
            <h3 className="entity-block__title">How it runs</h3>
            {detail.howItRuns ? (
              <dl className="entity-kv" data-testid="agent-how-it-runs">
                <div className="entity-kv__row"><dt>Mode</dt><dd>{orDash(detail.howItRuns.summary)}</dd></div>
                <div className="entity-kv__row"><dt>Runner</dt><dd className="mc-mono">{orDash(detail.howItRuns.runner)}</dd></div>
                <div className="entity-kv__row"><dt>Command</dt><dd className="mc-mono">{orDash(detail.howItRuns.command)}</dd></div>
              </dl>
            ) : <p className="entity-note">No executable runner facts are declared.</p>}
          </section>
        </>
      ) : null}
    </>
  );

  const activity = (
    <section className="entity-block" aria-label="Ledger activity">
      <h3 className="entity-block__title">Ledger activity</h3>
      <dl className="entity-kv" data-testid="agent-ledger">
        <div className="entity-kv__row">
          <dt>Dispatches</dt>
          <dd className="mc-mono">{agent.ledger.dispatches}</dd>
        </div>
        <div className="entity-kv__row">
          {/* Steps, never dollars. Cost is deliberately not a surface in this product. */}
          <dt>Steps</dt>
          <dd className="mc-mono">{agent.ledger.steps}</dd>
        </div>
        <div className="entity-kv__row">
          <dt>Active days</dt>
          <dd className="mc-mono">{agent.ledger.days}</dd>
        </div>
        <div className="entity-kv__row">
          <dt>Last active</dt>
          <dd className="mc-mono">{orDash(agent.lastActive)}</dd>
        </div>
      </dl>
      <p className="entity-note">
        Counted from <code className="mc-mono">ledgers/&lt;kind&gt;/{agent.id}-&lt;date&gt;.tsv</code> rows.
      </p>
    </section>
  );

  const overview = (
    <>
      {agent.declared ? null : (
        // One plain line in the primary surface; the fold below carries the full explanation.
        <p className="entity-note" data-testid="agent-undefined-note">
          There is no definition file for this agent yet, so everything here is inferred from what it has
          actually done.
        </p>
      )}

      <section className="entity-block" aria-label="Current work">
        <h3 className="entity-block__title">Doing now</h3>
        {agent.current ? (
          <div
            className="entity-row entity-row--link"
            data-testid={`agent-current-${agent.current.id}`}
            aria-disabled={!onNavigate || undefined}
            {...entityRowProps(() => onNavigate?.({ view: 'tasks', focus: { kind: 'card', id: agent.current!.id } }))}
          >
            <span className="entity-row__main">
              <EntityName kind="card" id={agent.current.id} displayName={agent.current.displayName} shortRef={agent.current.shortRef} />
            </span>
          </div>
        ) : (
          <p className="entity-note" data-testid="agent-idle">Idle — it has no task in progress.</p>
        )}
      </section>

      <section className="entity-block" aria-label="What this agent exists to do">
        <h3 className="entity-block__title">Purpose</h3>
        {agent.description ? (
          <p className="entity-prose" data-testid="agent-description">{agent.description}</p>
        ) : (
          <p className="entity-note" data-testid="agent-description-absent">
            No description recorded. An agent states its purpose in one line at the top of its own
            definition file — named under Technical details below.
          </p>
        )}
      </section>

      <section className="entity-block" aria-label="Owned queue cards">
        <h3 className="entity-block__title">
          Queue cards <span className="mc-mono entity-block__count">{cards.length}</span>
        </h3>
        {cards.length ? (
          <ol className="entity-list" data-testid="agent-cards">
            {cards.map((card) => (
              <li key={card.id}>
                <div
                  className="entity-row entity-row--link"
                  data-testid={`agent-card-${card.id}`}
                  aria-disabled={!onNavigate || undefined}
                  {...entityRowProps(() => onNavigate?.({ view: 'tasks', focus: { kind: 'card', id: card.id } }))}
                >
                  <span className="entity-row__main">
                    <EntityName kind="card" id={card.id} displayName={card.displayName} shortRef={card.shortRef} />
                  </span>
                  <span className="mc-mono entity-row__meta">{card.state}</span>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="entity-note">This agent owns no queue cards.</p>
        )}
      </section>

      <section className="entity-block" aria-label="Projects">
        <h3 className="entity-block__title">Projects</h3>
        {agent.projects.length ? (
          <div className="entity-chips" data-testid="agent-projects">
            {agent.projects.map((project) => (
              <span key={project} className="entity-chip mc-mono">{project}</span>
            ))}
          </div>
        ) : (
          <p className="entity-note">No project recorded on any owned card.</p>
        )}
      </section>

      {/* THE fold. One disclosure holds every technical fact about this agent — definition file,
          declared defaults, roster provenance, governed workflows, runner facts, ledger rollups and the
          governed routing control. Primary UI above it stays plain-language. */}
      <details className="entity-fold" data-testid="agent-technical">
        <summary>Technical details</summary>
        <div className="entity-fold__body">
          {technical}
          {activity}
          {routing ? (
            <section className="entity-block" aria-label="Model routing">
              <h3 className="entity-block__title">Effective routing</h3>
              {routing}
              <p className="entity-note">
                Changing the model is a governed, audited server write and needs a passkey session.
              </p>
            </section>
          ) : null}
        </div>
      </details>
    </>
  );

  /**
   * Runs. `undefined` and `[]` are DIFFERENT answers and are worded differently — "we did not look" is
   * not the same claim as "we looked and there are none", and conflating them is how a dashboard starts
   * lying quietly.
   */
  const runsSection = (
    <section className="entity-block" aria-label="Runs this agent is working">
      <h3 className="entity-block__title">Runs</h3>
      {runs === undefined ? (
        <p className="entity-note" data-testid="agent-runs-unloaded">
          Not loaded — reading this agent's runs needs an unlocked session.
        </p>
      ) : runs.length === 0 ? (
        <p className="entity-note" data-testid="agent-runs-empty">
          No run is working a task this agent owns.
        </p>
      ) : (
        <ol className="entity-list" data-testid="agent-runs">
          {runs.map((run) => (
            <li key={run.runRef}>
              <div
                className="entity-row entity-row--link"
                data-testid={`agent-run-${run.runRef}`}
                aria-disabled={!onNavigate || undefined}
                {...entityRowProps(() => onNavigate?.(runLink(run.runRef)))}
              >
                <span className="entity-row__main">
                  <EntityName kind="run" id={run.runRef} displayName={run.displayName} shortRef={run.shortRef} />
                </span>
                <span className="mc-mono entity-row__meta">{run.state}</span>
              </div>
            </li>
          ))}
        </ol>
      )}
      <p className="entity-note">
        Runs this agent started directly are matched by their recorded provenance. Derived via queue cards
        for older runs, through the tasks this agent owns.
        {runs !== undefined && runScanLimit ? (
          <> Scanned the {runScanLimit} most recent runs only for that older inference.</>
        ) : null}
      </p>
    </section>
  );

  const sections: DetailSection[] = [
    { id: 'overview', label: 'Overview', count: cards.length, render: () => overview },
    { id: 'runs', label: 'Runs', count: runs?.length, render: () => runsSection },
  ];

  const links: EntityLink[] = agent.current
    ? [{
        label: 'Current card',
        target: { view: 'tasks', focus: { kind: 'card', id: agent.current.id } },
        ref: agent.current.id,
      }]
    : [];

  return (
    <EntityDetail
      entity={{ kind: 'agent', id: agent.id }}
      eyebrow={agent.display
        ? <>Fleet agent · <EntityName kind="agent" id={agent.id} displayName={agent.display.displayName} shortRef={agent.display.shortRef} muted /></>
        : `Fleet agent · ${agent.id}`}
      title={agent.role ? `${agent.id} · ${agent.role}` : agent.id}
      status={{
        label: agent.working ? 'working' : 'idle',
        tone: agent.working ? 'running' : 'idle',
      }}
      // Identity only. Declaration/runner status is machinery and lives in the fold, not the header.
      facts={[
        { label: 'Role', value: orDash(agent.role), mono: true },
        { label: 'Model', value: orDash(agent.declaredModel), mono: true },
        { label: 'Tasks', value: agent.cardCount, mono: true },
        { label: 'Last active', value: lastActiveLabel(agent.lastActive), mono: true },
      ]}
      links={links}
      sections={sections}
      activeSectionId={activeSectionId}
      onSectionChange={onSectionChange}
      onNavigate={onNavigate}
      onBack={onBack}
      backLabel={backLabel}
      actions={agent.declared && onRunAgent ? (
        <div>
          <button
            type="button"
            className="mc-btn mc-btn--primary"
            data-testid="agent-run"
            onClick={() => onRunAgent(agent)}
          >
            Run agent
          </button>
          <p className="entity-note">Opens a terminal session you can type into, set up as this agent.</p>
        </div>
      ) : undefined}
    />
  );
}
