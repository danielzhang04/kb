/**
 * Agent Management panel (Agent Platform, Wave-1 U4) — the headline panel.
 *
 * ── What it is ──
 * The fleet roster as an operator actually reads it: who exists, what model they will cost us, what
 * they are for and whether they are working — then one click into the declaration-backed facts that
 * only matter once you have picked an agent.
 *
 * ── Declared vs observed (the invariant this panel is built around) ──
 * `/api/agents` returns a UNION: agents with an authoritative `agents/<id>.md` declaration, PLUS ids
 * merely observed owning queue cards or writing ledgers (`dispatcher-cloud`, `worker-desktop`, …).
 * Those two are not the same kind of thing and never share a section here. Only `declared` rows are
 * openable, and only they trigger the declaration read — asking the daemon for a declaration that
 * cannot exist and then reporting its correct 404 as a failure would be the panel lying about the
 * server. Same gate as the Agents view (`views/Agents.tsx`, the `detailTarget?.declared` effect).
 *
 * ── Where the data comes from ──
 * `/api/agents` for the list, and `fetchAgentDetail` — the shared client in `lib/agentClient.ts` — for
 * the detail. The browser never reads repo files; both are the server's bounded projections of
 * `agents/<id>.md`.
 *
 * The six declaration fields U3 added (`tools`, `knowledgeSource`, `autonomyTier`, `skills`,
 * `whatItReplaces`, `buildsOn`) now live on `AgentDetailDto` itself (U12): the server always sent
 * them, this panel used to re-declare them locally, and a local widening only ever describes the wire
 * for its own file. All six are null for every live agent today, which makes the null path the COMMON
 * path — so the panel both renders an explicit "not declared" per field AND says out loud, on screen,
 * why they are empty.
 *
 * The 404-vs-422-vs-broken distinction likewise comes from the client as a typed
 * {@link AgentDetailFailure}, instead of this panel wrapping `fetch` to spy on a response the client
 * was about to discard.
 *
 * ── What it deliberately does not do ──
 * No deep link into the Agents view: no navigation callback reaches a panel, so the panel states the
 * agent id in plain words rather than rendering a dead-looking link. Read-only throughout.
 *
 * House rules honoured: ONE entry file, its OWN stylesheet, headings starting at h4, and `import type`
 * only across the client→server boundary (a runtime import drags `node:fs` into the browser bundle —
 * see `lib/clientImportGraph.test.ts`). U4 shipped with zero shared-file edits; U12's integration pass
 * then moved this panel's two local re-implementations — the declaration type and the effective-model
 * rule — into the shared client and `lib/agentPresentation.ts`, which is where they belonged.
 */
import { useEffect, useState } from 'react';
import type { AgentPlatformPanel } from '../types';
import type { AgentRosterEntry } from '../../../../server/agents/roster';
import { ModelBadge } from '../../../components/ModelBadge';
import {
  fetchAgentDetail,
  isAgentDetailFailure,
  type AgentDetailDto,
  type AgentDetailFailureKind,
} from '../../../lib/agentClient';
// U12: the "effective model only, never declaredModel" rule now lives in one place for every agent
// surface — see the rationale there.
import { effectiveModelOf } from '../../../lib/agentPresentation';
import '../../../styles/views/agentPlatformAgentManagement.css';

/** The declaration as the client types it — the six U3 fields included (U12). */
type LadderDeclaration = NonNullable<AgentDetailDto['declaration']>;

/** Load state for either fetch. Mirrors the Agents view's `detailState`, owned panel-locally. */
type LoadState = 'idle' | 'loading' | 'ready' | 'unavailable';

/**
 * Why a declaration read did not produce a declaration. The KIND is the client's — see
 * `AgentDetailFailureKind` — so the panel and any other reader agree on what a 404 means; only the
 * rendered sentence is this panel's own.
 */
type DetailFailure = { kind: AgentDetailFailureKind; problem: string | null };

/** How much of the declaration body the detail previews. A profile, never a document dump. */
const INSTRUCTIONS_PREVIEW = 180;

/** The one honest empty answer, so a missing declaration never reads as a rendering bug. */
function NotDeclared(): React.JSX.Element {
  return <span className="ap-agentmgmt__none">— not declared</span>;
}

/** One labelled detail field. `value` null/empty ⇒ the explicit not-declared line. */
function Field({
  label,
  testId,
  value,
  mono = false,
}: {
  label: string;
  testId: string;
  value: string | string[] | null | undefined;
  mono?: boolean;
}): React.JSX.Element {
  const text = Array.isArray(value) ? value.join(', ') : value;
  const empty = text === null || text === undefined || text.trim() === '';
  return (
    <div className="ap-agentmgmt__field" data-testid={testId}>
      <span className="ap-agentmgmt__label">{label}</span>
      <p className={`ap-agentmgmt__value${mono && !empty ? ' ap-agentmgmt__value--mono' : ''}`}>
        {empty ? <NotDeclared /> : text}
      </p>
    </div>
  );
}

/** Truncate the declaration body to a single scannable line. */
function preview(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > INSTRUCTIONS_PREVIEW ? `${flat.slice(0, INSTRUCTIONS_PREVIEW)}…` : flat;
}

/** The detail card — replaces the list body in place, with its own back affordance. */
function AgentDetailCard({
  agent,
  detail,
  declaration,
  state,
  failure,
  onBack,
}: {
  agent: AgentRosterEntry;
  detail: AgentDetailDto | null;
  declaration: LadderDeclaration | null;
  state: LoadState;
  failure: DetailFailure | null;
  onBack: () => void;
}): React.JSX.Element {
  const codebases = detail?.codebases ?? [];
  const workflows = detail?.workflows ?? [];
  const instructions = declaration?.instructions ?? null;

  return (
    <div className="ap-agentmgmt__detail" data-testid="ap-agentmgmt-detail">
      <button type="button" className="ap-agentmgmt__back" data-testid="ap-agentmgmt-back" onClick={onBack}>
        <span aria-hidden="true">←</span> All agents
      </button>

      <div className="ap-agentmgmt__detail-head">
        <h4 className="ap-agentmgmt__detail-title">{agent.displayName || agent.id}</h4>
        <ModelBadge tier={effectiveModelOf(agent)} />
        <span
          className={`mc-status-dot ${agent.working ? 'mc-status-dot--running' : 'mc-status-dot--idle'}`}
          aria-hidden="true"
        />
        <span className="ap-agentmgmt__state">{agent.working ? 'working' : 'idle'}</span>
      </div>

      {/* `idle` counts as loading: the fetch effect has not run yet on the first frame, and painting
          the field block there would flash "not declared" across every field before the read starts. */}
      {state === 'idle' || state === 'loading' ? (
        <p className="ap-agentmgmt__status" data-testid="ap-agentmgmt-detail-loading">
          Reading the declaration…
        </p>
      ) : failure?.kind === 'no-declaration' ? (
        <p className="ap-agentmgmt__status" data-testid="ap-agentmgmt-detail-no-declaration">
          Observed runtime identity, no declaration. The daemon answered: there is no{' '}
          <code>agents/{agent.id}.md</code> for this id, so it has no role, tools or declared ceiling to
          show — it is known only from the cards it owns and the ledgers it wrote.
        </p>
      ) : failure?.kind === 'invalid' ? (
        <p className="ap-agentmgmt__status ap-agentmgmt__status--error" data-testid="ap-agentmgmt-detail-invalid">
          This agent&apos;s declaration exists but could not be used:{' '}
          <span className="ap-agentmgmt__value--mono">{failure.problem ?? 'the server did not say why'}</span>
        </p>
      ) : failure ? (
        <p className="ap-agentmgmt__status ap-agentmgmt__status--error" data-testid="ap-agentmgmt-detail-unavailable">
          The declaration read failed. The roster row above is still accurate; the declaration-backed
          fields are unavailable until the daemon answers.
        </p>
      ) : (
        <>
          <div className="ap-agentmgmt__fields">
            <Field label="Role" testId="ap-agentmgmt-role" value={agent.role} mono />
            <Field label="What it is for" testId="ap-agentmgmt-description" value={agent.description} />
            <Field label="Tools" testId="ap-agentmgmt-tools" value={declaration?.tools ?? agent.tools ?? null} mono />
            {/* NEVER labelled as a bare tier: this is what the declaration CLAIMS it may do, not a
                governance grant — the enforced ceiling lives in governance/risk-tiers.md. */}
            <Field
              label="Declared ceiling (advisory)"
              testId="ap-agentmgmt-ceiling"
              value={declaration?.autonomyTier ?? agent.autonomyTier ?? null}
              mono
            />
            <Field
              label="What it replaces"
              testId="ap-agentmgmt-replaces"
              value={declaration?.whatItReplaces ?? agent.whatItReplaces ?? null}
            />
            <Field
              label="Builds on"
              testId="ap-agentmgmt-builds-on"
              value={declaration?.buildsOn ?? agent.buildsOn ?? null}
              mono
            />
            <Field
              label="Knowledge sources"
              testId="ap-agentmgmt-knowledge"
              value={declaration?.knowledgeSource ?? agent.knowledgeSource ?? null}
              mono
            />
            <Field label="Skills" testId="ap-agentmgmt-skills" value={declaration?.skills ?? agent.skills ?? null} mono />
          </div>

          {/* The empty fields above are the expected reading today, and an operator cannot know that
              from the blanks alone — so the panel says it rather than leaving them to guess at a bug. */}
          <p className="ap-agentmgmt__schema-note" data-testid="ap-agentmgmt-schema-note">
            The six fields above come from the agent-definition schema added this run. No{' '}
            <code>agents/</code> declaration fills them in yet, so every live agent reads &ldquo;not
            declared&rdquo; — that is the schema working, not a failed read. And the ceiling is what a
            declaration <em>claims</em>; the autonomy an agent has actually earned is a different thing,
            tracked in the Autonomy Ladder panel.
          </p>

          <div className="ap-agentmgmt__fields">
            <Field
              label="How it runs"
              testId="ap-agentmgmt-how-it-runs"
              value={detail?.howItRuns?.summary ?? null}
            />
            <Field
              label="Codebases"
              testId="ap-agentmgmt-codebases"
              value={codebases.map((c) => (c.path ? `${c.project} (${c.path})` : c.project))}
              mono
            />
            <Field
              label="Workflows"
              testId="ap-agentmgmt-workflows"
              value={workflows.map((w) => w.title ?? w.ref)}
            />
            <Field
              label="Declaration"
              testId="ap-agentmgmt-source"
              value={declaration?.path ?? null}
              mono
            />
            <Field
              label="Instructions (preview)"
              testId="ap-agentmgmt-instructions"
              value={instructions === null ? null : preview(instructions)}
            />
          </div>
        </>
      )}

      {/* Panels get no navigation callback, so this is a statement, not a dead link. */}
      <p className="ap-agentmgmt__deeplink" data-testid="ap-agentmgmt-deeplink">
        Agent id: {agent.id} — open this agent&apos;s full profile from the Agents view in the sidebar.
      </p>
    </div>
  );
}

function AgentManagementBody(): React.JSX.Element {
  const [roster, setRoster] = useState<AgentRosterEntry[]>([]);
  const [listState, setListState] = useState<LoadState>('loading');
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AgentDetailDto | null>(null);
  const [detailState, setDetailState] = useState<LoadState>('idle');
  const [failure, setFailure] = useState<DetailFailure | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/agents')
      .then((r) => {
        if (!r.ok) throw new Error(`roster request failed (${r.status})`);
        return r.json() as Promise<AgentRosterEntry[]>;
      })
      .then((rows) => {
        if (cancelled) return;
        setRoster(Array.isArray(rows) ? rows : []);
        setListState('ready');
      })
      .catch(() => {
        // A dead daemon is an expected input for a read-only panel: name the state, never crash.
        if (!cancelled) setListState('unavailable');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const declaredRows = roster.filter((a) => a.declared);
  const observedRows = roster.filter((a) => !a.declared);
  const open = openId ? declaredRows.find((a) => a.id === openId) ?? null : null;
  const openDeclared = open?.declared ?? false;

  useEffect(() => {
    // Only DECLARED agents are ever asked about — an observed id has no declaration by construction.
    if (!openId || !openDeclared) {
      setDetail(null);
      setFailure(null);
      setDetailState('idle');
      return;
    }
    let cancelled = false;
    setDetail(null);
    setFailure(null);
    setDetailState('loading');

    // The status and the server's stated reason arrive on the thrown error itself (U12) — no wrapping
    // fetch, no second read of a body the client already consumed.
    void fetchAgentDetail(openId)
      .then((dto) => {
        if (cancelled) return;
        setDetail(dto);
        setDetailState('ready');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setFailure(
          isAgentDetailFailure(error)
            ? { kind: error.kind, problem: error.problemText }
            : { kind: 'error', problem: null },
        );
        setDetailState('unavailable');
      });
    return () => {
      cancelled = true;
    };
  }, [openId, openDeclared]);

  if (open) {
    return (
      <div className="ap-agentmgmt">
        <AgentDetailCard
          agent={open}
          detail={detail}
          declaration={detail?.declaration ?? null}
          state={detailState}
          failure={failure}
          onBack={() => setOpenId(null)}
        />
      </div>
    );
  }

  if (listState === 'unavailable') {
    return (
      <div className="ap-agentmgmt">
        <p className="ap-agentmgmt__status ap-agentmgmt__status--error" data-testid="ap-agentmgmt-list-error">
          The agent roster could not be loaded. This panel reads <code>/api/agents</code> and shows
          nothing rather than a stale or invented fleet.
        </p>
      </div>
    );
  }

  if (listState === 'loading') {
    return (
      <div className="ap-agentmgmt">
        <p className="ap-agentmgmt__status" data-testid="ap-agentmgmt-list-loading">
          Loading the roster…
        </p>
      </div>
    );
  }

  return (
    <div className="ap-agentmgmt">
      {declaredRows.length === 0 ? (
        <p className="ap-agentmgmt__status" data-testid="ap-agentmgmt-list-empty">
          No declared agents are registered.
        </p>
      ) : (
        <>
          <div className="ap-agentmgmt__list">
            {declaredRows.map((agent) => (
              <button
                key={agent.id}
                type="button"
                className="ap-agentmgmt__row"
                data-testid={`ap-agentmgmt-row-${agent.id}`}
                aria-label={`Open ${agent.displayName || agent.id} detail`}
                onClick={() => setOpenId(agent.id)}
              >
                <span
                  className={`mc-status-dot ${agent.working ? 'mc-status-dot--running' : 'mc-status-dot--idle'}`}
                  data-testid={`ap-agentmgmt-status-${agent.id}`}
                  aria-hidden="true"
                />
                <span className="ap-agentmgmt__id">{agent.displayName || agent.id}</span>
                <span className="ap-agentmgmt__desc">
                  {agent.description ?? <span className="ap-agentmgmt__none">no description</span>}
                </span>
                <ModelBadge tier={effectiveModelOf(agent)} />
                <span className="ap-agentmgmt__state">{agent.working ? 'working' : 'idle'}</span>
              </button>
            ))}
          </div>
          <p className="ap-agentmgmt__note">
            Read-only. The model shown is the resolved routing each agent will actually run on.
          </p>
        </>
      )}

      {observedRows.length > 0 ? (
        <section className="ap-agentmgmt__observed" data-testid="ap-agentmgmt-observed">
          <h4 className="ap-agentmgmt__observed-title">
            Observed runtime identities — no declaration <span className="mc-num">({observedRows.length})</span>
          </h4>
          <p className="ap-agentmgmt__note">
            Ids the roster saw owning cards or writing ledgers, with no <code>agents/&lt;id&gt;.md</code> behind
            them. They have nothing to open — the fields this panel shows come from a declaration these
            identities do not have.
          </p>
          <div className="ap-agentmgmt__list">
            {observedRows.map((agent) => (
              <div
                key={agent.id}
                className="ap-agentmgmt__row ap-agentmgmt__row--static"
                data-testid={`ap-agentmgmt-observed-row-${agent.id}`}
              >
                <span
                  className={`mc-status-dot ${agent.working ? 'mc-status-dot--running' : 'mc-status-dot--idle'}`}
                  aria-hidden="true"
                />
                <span className="ap-agentmgmt__id">{agent.displayName || agent.id}</span>
                <span className="ap-agentmgmt__desc ap-agentmgmt__none">
                  observed via {agent.sources.length > 0 ? agent.sources.join(' + ') : 'the roster union'}
                </span>
                <ModelBadge tier={effectiveModelOf(agent)} />
                <span className="ap-agentmgmt__state">{agent.working ? 'working' : 'idle'}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

export const panel: AgentPlatformPanel = {
  id: 'agent-management',
  order: 10,
  title: 'Agent Management',
  description: 'Fleet roster with model + status, drilling into role, tools, and the declared ceiling.',
  render: () => <AgentManagementBody />,
};
