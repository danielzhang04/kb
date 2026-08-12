/**
 * The workflow detail — one graph, one Launch, one history of everything this workflow has done.
 *
 * A workflow is a reusable definition; a run is one execution of it. Both live in this destination, so
 * this view answers exactly three questions and pushes everything else behind a fold:
 *   - what does this workflow do, and who runs each step (the Flow tab — and where you change it);
 *   - can I run it right now (one button, with any inputs it declares beside it);
 *   - what has it done (the Runs tab, live and past).
 *
 * ── Two provenances in ONE list, never blurred (leg 2) ──
 *
 * The Runs tab merges two genuinely different records in start order:
 *
 *   a GOVERNED RUN — launched from the compiled, hash-pinned plan and driven by the executor. It opens
 *                    the run detail, exactly as before. That detail has no terminal in it, deliberately.
 *   a CHAT SESSION — one primed `claude` in a terminal, driven by an operator's keystrokes. No plan, no
 *                    stages, no governance. It opens IN THIS PAGE: live in the console above, past as a
 *                    transcript.
 *
 * Every row says which it is, in plain words. A workflow's history is genuinely both things, and showing
 * them in two disconnected places would hide half of what happened — but letting a chat session render
 * with a governed run's chrome would be worse, so the vocabularies stay strictly separate.
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
import { ConsolePane } from '../console/ConsolePane';
import type { ConsoleControl } from '../console/ConsolePane';
import { useAttachableSession } from '../console/useAttachableSession';
import { SessionRunRow, useSessionRuns } from '../console/sessionRuns';
import { EntityDetail, type DetailSection } from '../entity/EntityDetail';
import { useOptionalSession } from '../lib/sessionContext';
import type { PtySocketFactory, SessionRunDto, SessionRunsClient, TerminalSessionsClient } from '../lib/terminalClient';
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
  /** Injected in tests so no component test opens a real WebSocket. Defaults to the real `/api/pty`. */
  socketFactory?: PtySocketFactory;
  /** Injected in tests so no component test hits the network. Defaults to the real session REST client. */
  sessionsClient?: TerminalSessionsClient;
  /** Injected in tests; defaults to the real `/api/pty/session-runs` client. */
  sessionRunsClient?: SessionRunsClient;
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
  kindLabel,
}: {
  run: RunMetadataDto;
  now?: number;
  onOpen?: (runRef: string) => void;
  /** Set in a MERGED list, where a row must say which kind of record it is. Omitted where the list is
   *  homogeneous and the label would be noise. */
  kindLabel?: string;
}): React.JSX.Element {
  return (
    <div
      className="entity-row entity-row--link"
      data-testid={`workflow-run-${run.runRef}`}
      aria-disabled={!onOpen || undefined}
      {...entityRowProps(() => onOpen?.(run.runRef))}
    >
      {kindLabel ? (
        <span className="session-run__kind mc-mono" data-testid={`workflow-run-kind-${run.runRef}`}>{kindLabel}</span>
      ) : null}
      <span className="entity-row__main">
        <EntityName kind="run" id={run.runRef} displayName={run.displayName} shortRef={run.shortRef} />
      </span>
      <span className="entity-row__meta">
        <span className={`mc-status-dot mc-status-dot--${runDot(run.state)}`} aria-hidden="true" />
        {runStateLabel(run.state)}
      </span>
      {/* Who owns this run. Rendered on EVERY row, not only foreign ones: a verified operator session
          lists every subject's runs in one list (including the daemon's synthetic acceptance runs,
          which are deliberately not filtered out — this badge is what disambiguates them), and a badge
          that appears only sometimes reads as an alert rather than as provenance. Plain mono meta, the
          same treatment as the age stamp it sits beside. */}
      <span className="mc-mono entity-row__meta" data-testid={`workflow-run-${run.runRef}-owner`}>{run.ownerSubject}</span>
      {run.openHumanRequestCount > 0 ? (
        <span className="entity-row__meta" data-testid={`workflow-run-${run.runRef}-needs-you`}>
          {run.openHumanRequestCount} waiting on you
        </span>
      ) : null}
      <span className="mc-mono entity-row__meta">{relativeAge(run.updatedAt, now)}</span>
    </div>
  );
}

/**
 * ONE time-ordered history from the two records a workflow actually produces. Ordered by when each
 * STARTED, newest first, so the list reads as "what happened here, most recent first" regardless of
 * which mechanism produced it. A governed run's `updatedAt` is the closest thing it publishes to a
 * position on that timeline; a session run carries its own `startedAt`.
 *
 * Exported for its own test: the merge is the rendering rule, and a rule worth stating is worth pinning.
 */
export type MergedRunRow =
  | { key: string; at: number; row: 'governed'; run: RunMetadataDto }
  | { key: string; at: number; row: 'session'; run: SessionRunDto };

export function mergeRunRows(
  governed: RunMetadataDto[] | undefined,
  sessions: SessionRunDto[] | undefined,
): MergedRunRow[] {
  const rows: MergedRunRow[] = [
    ...(governed ?? []).map((run): MergedRunRow => ({
      key: `governed:${run.runRef}`,
      at: Date.parse(run.updatedAt) || 0,
      row: 'governed',
      run,
    })),
    ...(sessions ?? []).map((run): MergedRunRow => ({
      key: `session:${run.sessionRunRef}`,
      at: Date.parse(run.startedAt) || 0,
      row: 'session',
      run,
    })),
  ];
  return rows.sort((a, b) => b.at - a.at);
}

/**
 * The workflow's OWN console — a live shell primed as the agent that governs this workflow, inside its
 * detail. Mirrors `AgentConsole` (leg 1) exactly, including the ordering that keeps a remount from
 * becoming a respawn: while the live-session lookup is in flight NO console is rendered, because
 * rendering the spawn target early is precisely how a tab switch leaks a second shell into the daemon's
 * shared terminal cap.
 */
export function WorkflowConsole({
  workflowRef,
  runnable,
  started,
  onStop,
  socketFactory,
  sessionsClient,
}: {
  workflowRef: string;
  /** A workflow that cannot run has nothing to prime a governing session with. */
  runnable: boolean;
  started: boolean;
  onStop: () => void;
  socketFactory?: PtySocketFactory;
  sessionsClient?: TerminalSessionsClient;
}): React.JSX.Element {
  const sessionContext = useOptionalSession();
  const [signingIn, setSigningIn] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [control, setControl] = useState<ConsoleControl | null>(null);
  const attachable = useAttachableSession(runnable ? { kind: 'workflow', ref: workflowRef } : null, {
    ...(sessionsClient ? { sessionsClient } : {}),
  });

  // An already-running shell WINS over a fresh spawn request: if this workflow has a live session, that
  // is the session the operator means, whatever they just clicked.
  const target = attachable.attach ?? (started ? attachable.spawn : null);

  async function handleUnlock(): Promise<void> {
    if (signingIn || !sessionContext) return;
    setSigningIn(true);
    try {
      await sessionContext.requireSession();
    } finally {
      setSigningIn(false);
    }
  }

  const stop = (): void => {
    setNotice(null);
    attachable.release();
    onStop();
  };

  let body: React.ReactNode;
  if (!runnable) {
    body = (
      <p className="entity-note" data-testid="workflow-console-unrunnable">
        This workflow cannot run as written, so there is nothing to start a session for.
      </p>
    );
  } else if (!attachable.unlocked) {
    body = sessionContext ? (
      <button
        type="button"
        className="mc-btn agent-console__unlock"
        onClick={() => void handleUnlock()}
        disabled={signingIn}
        data-testid="workflow-console-locked"
      >
        {signingIn ? 'Unlocking…' : 'Locked — unlock to open a session'}
      </button>
    ) : (
      <p className="entity-note" data-testid="workflow-console-locked">
        Locked — opening a session needs an unlocked passkey session.
      </p>
    );
  } else if (attachable.status === 'loading') {
    body = (
      <p className="entity-note" data-testid="workflow-console-loading">
        Checking whether this workflow already has a live session…
      </p>
    );
  } else if (!target) {
    body = (
      <p className="entity-note" data-testid="workflow-console-idle">
        No live session. Use <strong>Run workflow</strong> above to start one you can type into.
      </p>
    );
  } else {
    body = (
      <>
        <div className="agent-console__bar">
          <span className="agent-console__state mc-mono" data-testid="workflow-console-mode">
            {target.mode === 'attach' ? 'attached' : 'starting'}
          </span>
          <button
            type="button"
            className="agent-console__close"
            onClick={() => (control ? control.requestClose() : stop())}
            data-testid="workflow-console-close"
          >
            End session
          </button>
        </div>
        <ConsolePane
          target={target}
          visible
          {...(socketFactory ? { socketFactory } : {})}
          {...(sessionsClient ? { sessionsClient } : {})}
          onError={(reason) =>
            setNotice(
              reason === 'too-many-terminals'
                ? 'The fleet already has the maximum number of terminals open. Close one — here or in the Terminal — and try again.'
                : null,
            )
          }
          onExit={stop}
          registerControl={setControl}
          testIdSuffix="-workflow"
          ariaLabel={`Live session governing ${workflowRef}`}
        />
      </>
    );
  }

  return (
    <section className="entity-block agent-console" aria-label="Live session for this workflow">
      <h3 className="entity-block__title">Chat session</h3>
      <p className="entity-note">
        A session is a conversation with the agent that governs this workflow — not a governed run of it.
      </p>
      {/* The cap refusal renders HERE, in the console the operator opened, never as a navigation away. */}
      {notice ? (
        <p className="agent-console__notice" role="status" data-testid="workflow-console-notice">{notice}</p>
      ) : null}
      {body}
    </section>
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
  socketFactory,
  sessionsClient,
  sessionRunsClient,
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
  // Whether the operator has asked for a session on THIS workflow. It lives here, not in the section
  // body, because the body unmounts on every tab switch — and the request must survive that, exactly as
  // the shell it started does.
  const [consoleStarted, setConsoleStarted] = useState(false);
  const [expandedSessionRef, setExpandedSessionRef] = useState<string | null>(null);
  // Mirrors leg 1's AgentDetail: a controlled `activeSectionId` from the nav stack still wins, and the
  // local copy only carries the uncontrolled case so "Run workflow" can SHOW the tab it just started on.
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
  const runnable = entry.valid && entry.launchable !== false;

  const sessionRuns = useSessionRuns(
    { kind: 'workflow', ref: entry.ref },
    { ...(sessionRunsClient ? { client: sessionRunsClient } : {}) },
  );
  const merged = mergeRunRows(runs, sessionRuns.runs);

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

  /**
   * The Runs tab: the live console this workflow's sessions land in, then ONE history that merges the
   * two kinds of record. `undefined` and `[]` stay different claims — "we did not look" is not "we
   * looked and there is nothing", and conflating them is how a dashboard starts lying quietly.
   */
  const runsBody = (
    <>
      <WorkflowConsole
        workflowRef={entry.ref}
        runnable={runnable}
        started={consoleStarted}
        onStop={() => {
          setConsoleStarted(false);
          // A session that just ended becomes a PAST session; re-read so it appears in the history below
          // instead of the list still claiming it is running.
          sessionRuns.refresh();
        }}
        {...(socketFactory ? { socketFactory } : {})}
        {...(sessionsClient ? { sessionsClient } : {})}
      />

      <section className="entity-block" aria-label="Runs and sessions">
        <h3 className="entity-block__title">History</h3>
        <p className="entity-note">
          Governed runs execute the compiled plan. Chat sessions are conversations with the agent that
          governs this workflow. Both are listed here, newest first.
        </p>
        {sessionRuns.error ? (
          <p className="entity-note" role="status" data-testid="workflow-session-runs-error">{sessionRuns.error}</p>
        ) : null}
        {runs === undefined && sessionRuns.runs === undefined ? (
          <p className="entity-note" data-testid="workflow-runs-unloaded">
            Not loaded — unlock the dashboard to see this workflow&rsquo;s runs.
          </p>
        ) : merged.length === 0 ? (
          <p className="entity-note" data-testid="workflow-runs-empty">
            This workflow has not run yet, and nobody has opened a session with it.
          </p>
        ) : (
          <ol className="entity-list" data-testid="workflow-runs">
            {merged.map((entryRow) => (
              <li key={entryRow.key}>
                {entryRow.row === 'governed' ? (
                  <RunRow run={entryRow.run} now={now} onOpen={onOpenRun} kindLabel="governed run" />
                ) : (
                  <SessionRunRow
                    run={entryRow.run}
                    now={now}
                    expanded={expandedSessionRef === entryRow.run.sessionRunRef}
                    onToggle={() => setExpandedSessionRef((current) =>
                      current === entryRow.run.sessionRunRef ? null : entryRow.run.sessionRunRef)}
                    onArchive={() => void sessionRuns.archive(entryRow.run.sessionRunRef)}
                    archiving={sessionRuns.archivingRef === entryRow.run.sessionRunRef}
                    {...(sessionRunsClient ? { client: sessionRunsClient } : {})}
                  />
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );

  /**
   * ONE button. It opens a terminal session primed as the agent that runs this workflow — no channel to
   * type, no slug to fill in, no assignment to make first — and it lands the operator IN THIS PAGE, on
   * the Runs tab, instead of throwing them at the Terminal destination and leaving the workflow they
   * were reading. The direct governed launch (with its declared inputs) lives behind the technical fold.
   */
  const actions = (
    <div>
      <button
        type="button"
        className="mc-btn mc-btn--primary"
        data-testid="workflow-run"
        onClick={() => {
          setConsoleStarted(true);
          selectSection('runs');
        }}
      >
        Run workflow
      </button>
      <p className="entity-note">Opens a session you can type into, as the agent that runs this workflow, under Runs.</p>
    </div>
  );

  const sections: DetailSection[] = [
    { id: 'flow', label: 'Flow', render: () => body },
    { id: 'runs', label: 'Runs', count: merged.length, render: () => runsBody },
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
