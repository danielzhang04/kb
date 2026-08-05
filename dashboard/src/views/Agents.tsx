/**
 * Agents view — the fleet roster with per-agent model routing (R2.2).
 *
 * `/api/agents` enriches declared agents and observed runtime identities. The primary roster contains
 * declarations only; observed default workers are projected separately as system workers. Until the
 * enriched projection loads, `deriveRoster` over `/api/index` supplies observed activity without
 * promoting queue owners into declared agents. Per-agent ROUTING (effective runtime/model + provenance,
 * and the governed toggle) comes from `/api/routing` (R2.1 projection). The model cell is now a live
 * governed control: it shows the effective model (mono) + provenance tag, and — with a WebAuthn session —
 * opens a popover to write an agent-scope override (audited, ops pull-rebase-push) or clear it. Fail-closed
 * like launchControls: without a session the control is disabled with a nudge; a point-of-action mint runs
 * inline through the shared session context.
 *
 * A routing-audit strip (R2.4) surfaces routed-vs-ran mismatches + expiring/expired overrides, read-only.
 * Read-only for the roster; every routing mutation is a governed, audited server write.
 */
import { useEffect, useState, useCallback } from 'react';
import type { PlaneAIndex } from '../../server/planeA/indexer';
import type { CardProjection, ParsedCard } from '../../server/planeA/cards';
import type { AgentRosterEntry } from '../../server/agents/roster';
import { useSession } from '../lib/sessionContext';
import {
  EMPTY_ROUTING,
  fetchRouting,
  postRoutingOverride,
  type RoutingSnapshot,
  type EffectiveView,
} from '../lib/routingClient';
import { RoutingControl } from './routingControls';
import { AgentDetail } from './AgentDetail';
import { EntityName } from '../components/EntityName';
import { entityRowProps } from '../components/entityRow';
import { fetchAgentDetail, fetchSystemWorkers, type AgentDetailDto, type SystemWorkerDto } from '../lib/agentClient';
import { getRun, listRuns, type RunMetadataDto } from '../control/controlClient';
import { cardOwnerIndex, runsForAgent, type RunWithStages } from '../control/entityLinks';
import type { NavTarget } from '../nav/stack';
import '../styles/views/agents.css';
import '../styles/views/entity.css';

/**
 * How many recent runs the agent → runs join will scan. Each one costs a governed detail read (stages
 * are not on the run list), so this is bounded and the bound is disclosed in the UI.
 */
const AGENT_RUN_SCAN_LIMIT = 20;

const EMPTY_INDEX: PlaneAIndex = {
  cards: {},
  ledgers: {
    dispatch: { count: 0, cards: 0, byProject: {} },
    cost: { stepCount: 0, perModelSteps: {}, modelMix: {}, usdPresent: false },
    grades: { count: 0, rows: [] },
    activity: { count: 0, rows: [] },
  },
  orgStates: [],
};

interface AgentRow {
  id: string;
  /**
   * The server-owned agent display identity from `/api/agents`, or null when this row came from the
   * card-ownership FALLBACK (`deriveRoster`) — that snapshot carries no agent registry entry, and
   * inventing an ordinal client-side would be a second, disagreeing source of truth. The id is itself
   * a human name, so the fallback simply renders it.
   */
  display: { displayName: string; shortRef: number } | null;
  working: boolean;
  current: { action: string; id: string; displayName: string; shortRef: number } | null;
  projects: string[];
  cardCount: number;
  /** Role from `routines/roles/` (only when the enriched `/api/agents` roster is loaded). */
  role: string | null;
  /** Most recent ledger-write date (only from the enriched roster), else null. */
  lastActive: string | null;
  /** True when an authoritative `agents/<id>.md` declaration exists (C7.3). Snapshot-derived rows: false. */
  declared: boolean;
  /** The honest runner-bound flag from the agent file — false = declared, no runner claims its cards yet. */
  runnerBound: boolean;
  /** The declared default runtime from the agent file (advisory), or null. */
  declaredRuntime: string | null;
  /** arc-3 step 3 — fetched by the roster on every load, previously rendered nowhere. */
  declaredModel: string | null;
  /** Declared default execution profile id, or null for a legacy declaration. */
  defaultProfile: string | null;
  /** Declared execution profile ids this declaration permits, or null for a legacy declaration. */
  allowedProfiles: string[] | null;
  description: string | null;
  ledger: { dispatches: number; steps: number; days: number };
  sources: Array<'queue' | 'ledger'>;
}

/** Normalise a card's `project` field (string | string[]) into a flat list of project names. */
function projectsOf(card: ParsedCard): string[] {
  const p = card.meta.project;
  if (Array.isArray(p)) return p.filter((x): x is string => typeof x === 'string' && x !== '');
  return typeof p === 'string' && p !== '' ? [p] : [];
}

/**
 * Derive the roster from the snapshot's card ownership (working-first, then id-alphabetical). This is
 * the fallback when the enriched `/api/agents` roster (which also folds in ledger writers + roles) has
 * not loaded — role/lastActive are null in that case.
 */
export function deriveRoster(index: PlaneAIndex): AgentRow[] {
  const byOwner = new Map<string, CardProjection[]>();
  for (const bucket of Object.values(index.cards)) {
    for (const card of bucket) {
      const owner = card.meta.owner;
      if (typeof owner !== 'string' || owner === '') continue;
      const existing = byOwner.get(owner);
      if (existing) existing.push(card);
      else byOwner.set(owner, [card]);
    }
  }

  const rows: AgentRow[] = [];
  for (const [id, cards] of byOwner) {
    const workingCard = cards.find((c) => c.meta.state === 'working') ?? null;
    const projects = [...new Set(cards.flatMap(projectsOf))].sort();
    rows.push({
      id,
      display: null,
      working: workingCard !== null,
      current: workingCard
        ? {
            action: String(workingCard.meta.action),
            id: String(workingCard.meta.id),
            displayName: workingCard.displayName,
            shortRef: workingCard.shortRef,
          }
        : null,
      projects,
      cardCount: cards.length,
      role: null,
      lastActive: null,
      declared: false,
      runnerBound: false,
      declaredRuntime: null,
      // Snapshot-derived rows know nothing about declarations or ledgers — say zero/null honestly
      // rather than inventing values the snapshot cannot support.
      declaredModel: null,
      defaultProfile: null,
      allowedProfiles: null,
      description: null,
      ledger: { dispatches: 0, steps: 0, days: 0 },
      sources: ['queue'],
    });
  }

  return rows.sort((a, b) => {
    if (a.working !== b.working) return a.working ? -1 : 1;
    return a.id.localeCompare(b.id);
  });
}

/** Project the enriched server roster onto the view row shape. */
function rowFromEntry(e: AgentRosterEntry): AgentRow {
  return {
    id: e.id,
    display: { displayName: e.displayName, shortRef: e.shortRef },
    working: e.working,
    current: e.current,
    projects: e.projects,
    cardCount: e.cardCount,
    role: e.role,
    lastActive: e.ledger.lastActive,
    declared: e.declared,
    runnerBound: e.runnerBound,
    declaredRuntime: e.declaredRuntime,
    declaredModel: e.declaredModel,
    defaultProfile: e.defaultProfile ?? null,
    allowedProfiles: e.allowedProfiles === null || e.allowedProfiles === undefined ? null : [...e.allowedProfiles],
    description: e.description,
    ledger: { dispatches: e.ledger.dispatches, steps: e.ledger.steps, days: e.ledger.days },
    sources: e.sources,
  };
}

/**
 * Runtime defaults are registry routing facts, distinct from a declaration's human-set `runner-bound`
 * flag. In particular, an observed `default_worker` must never be presented as a declared binding.
 */
function isRuntimeDefault(row: AgentRow, defaultWorkers: Set<string>): boolean {
  return defaultWorkers.has(row.id);
}

/** True when either field of an agent's effective routing was supplied by an override entry. */
function hasOverride(effective: EffectiveView | undefined): boolean {
  return effective?.sourceRuntime === 'override' || effective?.sourceModel === 'override';
}

/** The routing-audit strip (R2.4): routed-vs-ran mismatches + expiring/expired overrides. Read-only. */
function RoutingAuditStrip({ audit }: { audit: RoutingSnapshot['audit'] }): React.JSX.Element | null {
  const stale = audit.overrides.filter((o) => o.expired || o.expiringSoon);
  if (audit.mismatches.length === 0 && stale.length === 0) {
    return (
      <section className="v-routing-audit" aria-label="Routing audit">
        <h3 className="v-routing-audit__title">Routing audit</h3>
        <p className="v-routing-audit__empty">No routed-vs-ran mismatches; no stale overrides.</p>
      </section>
    );
  }
  return (
    <section className="v-routing-audit" aria-label="Routing audit">
      <h3 className="v-routing-audit__title">Routing audit</h3>
      {audit.mismatches.map((m) => (
        <div className="v-routing-audit__row" key={`mm-${m.cardId}`} data-testid={`routing-mismatch-${m.cardId}`}>
          <span className={`mc-status-dot mc-status-dot--${m.kind === 'runtime' ? 'error' : 'blocked'}`} aria-hidden="true" />
          <span className="mc-mono">{m.cardId}</span>
          <span>
            routed <span className="mc-mono">{m.routedModel || m.routedRuntime}</span> · ran{' '}
            <span className="mc-mono">{m.ranModel}</span>
          </span>
          <span className="v-routing__src mc-mono">{m.kind} mismatch</span>
        </div>
      ))}
      {stale.map((o) => (
        <div className="v-routing-audit__row" key={`ov-${o.scope}-${o.key}`} data-testid={`routing-stale-${o.key}`}>
          <span className={`mc-status-dot mc-status-dot--${o.expired ? 'error' : 'blocked'}`} aria-hidden="true" />
          <span className="mc-mono">
            {o.scope}:{o.key}
          </span>
          <span>
            override <span className="mc-mono">{o.model ?? o.runtime ?? '—'}</span>{' '}
            {o.expired ? 'expired' : 'expiring'} <span className="mc-mono">{o.expires}</span>
          </span>
        </div>
      ))}
    </section>
  );
}

/** One truthful roster slice. Declared and observed identities intentionally never share a table. */
function AgentRosterTable({
  rows,
  defaultWorkers,
  onOpenAgent,
  renderRouting,
}: {
  rows: AgentRow[];
  defaultWorkers: Set<string>;
  onOpenAgent: (id: string) => void;
  renderRouting: (agent: AgentRow) => React.JSX.Element;
}): React.JSX.Element {
  return (
    <div className="v-agents__table-wrap">
      <table className="mc-table v-agents__table">
        <thead>
          <tr>
            <th scope="col">Agent</th><th scope="col">Role</th><th scope="col">Binding</th>
            <th scope="col">Doing</th><th scope="col">Projects</th>
            <th scope="col" className="v-agents__col-num">Cards</th><th scope="col">Last active</th><th scope="col">Model</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((agent) => {
            const runtimeDefault = isRuntimeDefault(agent, defaultWorkers);
            return (
              <tr key={agent.id} data-testid={`agent-row-${agent.id}`}>
                <td>
                  <div className="v-agents__agent v-agents__agent--link" data-testid={`agent-open-${agent.id}`}
                    aria-label={`Open ${agent.display?.displayName ?? agent.id} detail`} {...entityRowProps(() => onOpenAgent(agent.id))}>
                    <span className={`mc-status-dot ${agent.working ? 'mc-status-dot--running' : 'mc-status-dot--idle'}`} aria-hidden="true" />
                    {agent.display
                      ? <EntityName kind="agent" id={agent.id} displayName={agent.display.displayName} shortRef={agent.display.shortRef} />
                      : <span className="mc-mono">{agent.id}</span>}
                    <span className="v-agents__state">{agent.working ? 'working' : 'idle'}</span>
                  </div>
                </td>
                <td>{agent.role ? <span className="v-agents__role mc-mono">{agent.role}</span> : <span className="v-agents__idle">—</span>}</td>
                <td>
                  <span className="v-agents__binding" data-testid={`agent-binding-${agent.id}`}>
                    <span className={`v-agents__provenance v-agents__provenance--${agent.declared ? 'declared' : 'observed'}`}>
                      {agent.declared ? 'declared' : 'observed'}
                    </span>
                    {agent.declared ? (
                      <span className={`v-agents__runner v-agents__runner--${agent.runnerBound ? 'bound' : 'unbound'}`}
                        title={agent.runnerBound ? 'This declaration is runner-bound' : 'This declaration has no runner-bound flag'}>
                        {agent.runnerBound ? 'runner-bound' : 'no runner'}
                      </span>
                    ) : null}
                    {runtimeDefault ? (
                      <span className="v-agents__runner v-agents__runner--bound" title="Default worker in the runtime registry">
                        runtime default
                      </span>
                    ) : !agent.declared ? <span className="v-agents__runner v-agents__runner--unbound">no runner</span> : null}
                    {agent.declaredRuntime ? <span className="mc-mono v-agents__declared-runtime">{agent.declaredRuntime}</span> : null}
                  </span>
                </td>
                {/* The card being worked is named, not id-printed; its id stays in the tooltip/copy. */}
                <td>{agent.current ? <span className="v-agents__doing"><span className="v-agents__action">{agent.current.action}</span><span className="v-agents__card-id"><EntityName kind="card" id={agent.current.id} displayName={agent.current.displayName} shortRef={agent.current.shortRef} muted /></span></span> : <span className="v-agents__idle">idle</span>}</td>
                <td>{agent.projects.length ? <span className="v-agents__projects">{agent.projects.map((project) => <span key={project} className="v-agents__proj mc-mono">{project}</span>)}</span> : <span className="v-agents__idle">—</span>}</td>
                <td className="mc-mono v-agents__col-num">{agent.cardCount}</td>
                <td className="mc-mono v-agents__last-active">{agent.lastActive ?? <span className="v-agents__idle">—</span>}</td>
                <td>{renderRouting(agent)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SystemWorkerTable({ workers }: { workers: SystemWorkerDto[] }): React.JSX.Element {
  return (
    <div className="v-agents__table-wrap">
      <table className="mc-table v-agents__table" data-testid="system-workers-table">
        <thead><tr><th>Worker</th><th>Runtime</th><th>Registration</th><th>Invocation</th></tr></thead>
        <tbody>
          {workers.map((worker) => (
            <tr key={worker.id} data-testid={`system-worker-${worker.id}`}>
              <td className="mc-mono">{worker.id}</td>
              <td className="mc-mono">{worker.runtime}</td>
              <td>runtime default</td>
              <td>{worker.dashboardTriggerable ? 'dashboard-triggerable' : 'queue-addressable'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Agents({
  snapshot,
  roster,
  routing,
  focusAgentId,
  onOpenAgent,
  onBack,
  activeSectionId,
  onSectionChange,
  onNavigate,
  onWorkWithAgent,
  agentRuns,
}: {
  snapshot?: PlaneAIndex;
  roster?: AgentRosterEntry[];
  routing?: RoutingSnapshot;
  /**
   * arc-3 step 3 — the open agent, driven by the nav stack. Mirrors ManagedRuns: when `onOpenAgent` is
   * omitted the view keeps its own state so it stays usable (and testable) standalone. A detail surface
   * whose every click is inert when rendered without a controller is a defect, not a simplification.
   */
  focusAgentId?: string | null;
  onOpenAgent?: (agentId: string) => void;
  onBack?: () => void;
  activeSectionId?: string;
  onSectionChange?: (id: string) => void;
  onNavigate?: (target: NavTarget) => void;
  /** Opens the existing Composer workspace for one declared agent; never invokes a runner directly. */
  onWorkWithAgent?: (agent: { id: string }) => void;
  /** Runs joined to this agent by the caller. `undefined` = not loaded, which the detail says out loud. */
  agentRuns?: RunMetadataDto[];
} = {}): React.JSX.Element {
  const { session, requireSession } = useSession();
  const sessionToken = session?.token;
  const [fetched, setFetched] = useState<PlaneAIndex | null>(null);
  const [rosterState, setRosterState] = useState<AgentRosterEntry[] | null>(roster ?? null);
  const [routingState, setRoutingState] = useState<RoutingSnapshot | null>(routing ?? null);
  // Uncontrolled fallback for the open agent when no nav stack is wired above this view.
  const [localOpenId, setLocalOpenId] = useState<string | null>(null);
  const [scannedRuns, setScannedRuns] = useState<RunWithStages[] | null>(null);
  const [detail, setDetail] = useState<AgentDetailDto | null>(null);
  const [systemWorkerState, setSystemWorkerState] = useState<SystemWorkerDto[] | null>(null);
  const [detailState, setDetailState] = useState<'idle' | 'loading' | 'ready' | 'unavailable'>('idle');
  const openAgentId = onOpenAgent ? focusAgentId ?? null : localOpenId;

  useEffect(() => {
    if (snapshot) return;
    let cancelled = false;
    fetch('/api/index')
      .then((r) => r.json() as Promise<PlaneAIndex>)
      .then((d) => {
        if (!cancelled) setFetched(d);
      })
      .catch(() => {
        /* read-only view: keep the empty-safe scaffold */
      });
    return () => {
      cancelled = true;
    };
  }, [snapshot]);

  useEffect(() => {
    if (roster) return; // caller supplied the roster (tests) — do not self-fetch
    let cancelled = false;
    fetch('/api/agents')
      .then((r) => r.json() as Promise<AgentRosterEntry[]>)
      .then((d) => {
        if (!cancelled && Array.isArray(d)) setRosterState(d);
      })
      .catch(() => {
        /* read-only view: fall back to the snapshot-derived roster */
      });
    return () => {
      cancelled = true;
    };
  }, [roster]);

  useEffect(() => {
    let cancelled = false;
    void fetchSystemWorkers()
      .then((workers) => { if (!cancelled && Array.isArray(workers)) setSystemWorkerState(workers); })
      .catch(() => { /* routing registry fallback below remains truthful */ });
    return () => { cancelled = true; };
  }, []);

  /**
   * Agent → its runs, the inverse card index (arc-3 step 4.3).
   *
   * `listRuns` returns no stages, so the join needs run DETAILS, which means one governed read per run.
   * That fan-out is why this loads ONLY while a detail is open and is capped at the most recent
   * AGENT_RUN_SCAN_LIMIT runs — an unbounded scan on opening an agent would be a self-inflicted
   * thundering herd against the operator's own control plane.
   *
   * The cap is disclosed in the section rather than hidden, because a silently truncated join is worse
   * than a stated partial one. Failure leaves `runs` undefined, which the detail reports as "not
   * loaded" instead of the false claim that this agent works no runs.
   */
  useEffect(() => {
    if (agentRuns || !openAgentId || !sessionToken) return;
    let cancelled = false;
    void (async () => {
      try {
        const all = await listRuns(sessionToken);
        const explicit = all.filter((run) => run.agentWorkspaceLaunch?.agentId === openAgentId)
          .map((run) => ({ run, stages: [] }));
        const recent = all.filter((run) => run.agentWorkspaceLaunch?.agentId !== openAgentId)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, AGENT_RUN_SCAN_LIMIT);
        const details = await Promise.all(
          recent.map(async (meta) => {
            try {
              const detail = await getRun(meta.runRef, sessionToken);
              return { run: meta, stages: detail.stages };
            } catch {
              return null; // one unreadable run must not void the whole join
            }
          }),
        );
        if (!cancelled) setScannedRuns([...explicit, ...details.filter((d): d is RunWithStages => d !== null)]);
      } catch {
        /* leaves the section at "not loaded" — never a false "works no runs" */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agentRuns, openAgentId, sessionToken]);

  const refreshRouting = useCallback(async () => {
    try {
      setRoutingState(await fetchRouting());
    } catch {
      /* keep last-known routing on failure */
    }
  }, []);

  useEffect(() => {
    if (routing) return; // caller supplied routing (tests) — do not self-fetch
    void refreshRouting();
  }, [routing, refreshRouting]);

  const index = snapshot ?? fetched ?? EMPTY_INDEX;
  const routingSnap = routing ?? routingState ?? EMPTY_ROUTING;
  const enriched = roster ?? rosterState;
  // Prefer the enriched union; the declared/system-worker partition below is authoritative. The
  // snapshot-derived fallback supplies observed activity but cannot manufacture declarations.
  const agentRows = enriched ? enriched.map(rowFromEntry) : deriveRoster(index);
  const detailTarget = openAgentId ? agentRows.find((agent) => agent.id === openAgentId) : undefined;

  // The compact roster is enough for navigation. Declaration instructions, codebase links, workflow
  // relationships, and runner facts are loaded only after opening a DECLARED agent. Observed runtime
  // identities are deliberately not treated as source files or executable agents.
  useEffect(() => {
    if (!detailTarget?.declared) {
      setDetail(null);
      setDetailState('idle');
      return;
    }
    let cancelled = false;
    setDetail(null);
    setDetailState('loading');
    void fetchAgentDetail(detailTarget.id)
      .then((next) => {
        if (!cancelled) {
          setDetail(next);
          setDetailState('ready');
        }
      })
      .catch(() => {
        if (!cancelled) setDetailState('unavailable');
      });
    return () => { cancelled = true; };
  }, [detailTarget?.declared, detailTarget?.id]);

  const effectiveById = new Map(routingSnap.agents.map((a) => [a.id, a.effective]));
  const registry = routingSnap.policy.runtimes;
  // Registered runner ids: every runtime's `default_worker`. A roster id in this set is runnable even
  // without an `agents/<id>.md` declaration (the pre-C7 onboarding path, e.g. `worker-desktop`).
  const defaultWorkers = new Set(
    Object.values(registry)
      .map((r) => r.default_worker)
      .filter((w): w is string => typeof w === 'string' && w !== ''),
  );
  const declaredRows = agentRows.filter((agent) => agent.declared);
  const declaredIds = new Set(declaredRows.map((agent) => agent.id));
  const systemWorkers = (systemWorkerState ?? Object.entries(registry).flatMap(([runtime, value]) => value.default_worker ? [{
    id: value.default_worker,
    runtime,
    addressable: true as const,
    dashboardTriggerable: false,
    registrationSource: 'runtime-default' as const,
  }] : [])).filter((worker) => !declaredIds.has(worker.id));

  /** Point-of-action unlock: a routing write on a locked tab runs the ONE ceremony first. */
  async function resolveToken(): Promise<string | undefined> {
    return (await requireSession())?.token;
  }

  /**
   * The governed model-routing control for one agent. Extracted so the table cell and the detail's
   * Routing section are literally the same control rather than two drifting copies — every mutation
   * still carries its own scope/key and is an audited server write.
   */
  function routingControlFor(a: AgentRow): React.JSX.Element {
    return (
      <RoutingControl
        label={a.id}
        testIdPrefix={`agent-${a.id}`}
        registry={registry}
        effective={effectiveById.get(a.id) ?? null}
        ttl
        canClear={hasOverride(effectiveById.get(a.id))}
        onApply={async (runtime, model, expires) => {
          const token = await resolveToken();
          if (!token) return { ok: false, reason: 'no session' };
          const res = await postRoutingOverride(
            { op: 'set', scope: 'agent', key: a.id, runtime, model, expires },
            token,
          );
          if (res.ok) await refreshRouting();
          return res;
        }}
        onClear={async () => {
          const token = await resolveToken();
          if (!token) return { ok: false, reason: 'no session' };
          const res = await postRoutingOverride({ op: 'clear', scope: 'agent', key: a.id }, token);
          if (res.ok) await refreshRouting();
          return res;
        }}
      />
    );
  }

  const openAgent = (id: string): void => {
    if (onOpenAgent) onOpenAgent(id);
    else setLocalOpenId(id);
  };

  const backToRoster = (): void => {
    if (onBack) onBack();
    else setLocalOpenId(null);
  };

  /**
   * The detail REPLACES the roster in place — "a separate window, still inside the agents sidebar, with
   * a back button", per the mandate. No new nav destination, no new App case: the locked IA is untouched.
   *
   * An id that is in the nav stack but NOT in the roster (a deleted agent, a card whose owner has since
   * been removed, a stale back-forward) gets an EXPLICIT state naming the id, consistent with the missing
   * run and missing workflow cases. Falling through to the table meant the operator clicked a link,
   * landed on a roster with no message, and an invisible extra entry sat on the nav stack with no back
   * affordance rendered to pop it.
   *
   * Gated on the roster having actually LOADED — `fetched` is null until the index arrives, and calling an
   * agent "not on the roster" while the request is still in flight would be its own dishonesty.
   */
  const rosterLoaded = Boolean(enriched ?? snapshot ?? fetched);
  const openAgentRow = openAgentId ? agentRows.find((a) => a.id === openAgentId) : undefined;
  if (openAgentId && !openAgentRow && rosterLoaded) {
    return (
      <section className="v-agents" aria-label="Agents view">
        <div className="entity-missing" data-testid="agent-not-found">
          <button
            type="button"
            className="entity-detail__back"
            data-testid="agent-not-found-back"
            onClick={backToRoster}
          >
            <span aria-hidden="true">←</span> All agents
          </button>
          <h3>This agent is not in the roster</h3>
          <p className="mc-mono entity-missing__ref" data-testid="agent-not-found-ref">{openAgentId}</p>
          <p className="control-help">
            No agent with this id is on the board. Queue cards keep an owner id after the agent itself is
            removed from the registry, so links can outlive the agent they point at.
          </p>
        </div>
      </section>
    );
  }
  if (openAgentRow) {
    // `undefined` (not scanned) and `[]` (scanned, none) stay distinct all the way to the render.
    const joinedRuns = agentRuns
      ?? (scannedRuns ? runsForAgent(openAgentRow.id, scannedRuns, cardOwnerIndex(index)) : undefined);
    return (
      <section className="v-agents" aria-label="Agents view">
        <AgentDetail
          agent={openAgentRow}
          index={index}
          runs={joinedRuns}
          runScanLimit={AGENT_RUN_SCAN_LIMIT}
          routing={routingControlFor(openAgentRow)}
          detail={detail}
          detailState={detailState === 'idle' ? undefined : detailState}
          onWorkWithAgent={onWorkWithAgent}
          activeSectionId={activeSectionId}
          onSectionChange={onSectionChange}
          onNavigate={onNavigate}
          onBack={backToRoster}
          backLabel="All agents"
        />
      </section>
    );
  }

  return (
    <section className="v-agents" aria-label="Agents view">
      <h2 className="v-agents__title">
        Agents <span className="v-agents__count mc-num">({declaredRows.length})</span>
      </h2>

      {declaredRows.length === 0 ? (
        <p className="v-agents__empty">No user-created agents are registered.</p>
      ) : (
        <>
          <section className="v-agents__group" aria-labelledby="declared-agents-title">
            <h3 id="declared-agents-title" className="v-agents__group-title">Your agents <span className="mc-num">({declaredRows.length})</span></h3>
            <p className="v-agents__group-note">Agents you create in <code className="mc-mono">agents/*.md</code>. Open one to see exactly what it governs and work with it directly.</p>
            {declaredRows.length ? <AgentRosterTable rows={declaredRows} defaultWorkers={defaultWorkers} onOpenAgent={openAgent} renderRouting={routingControlFor} /> : <p className="v-agents__empty">No declared agents are registered.</p>}
          </section>
        </>
      )}

      <details className="v-agents__system" data-testid="system-workers">
        <summary>System workers <span className="mc-num">({systemWorkers.length})</span></summary>
        <p className="v-agents__group-note">
          Infrastructure identities registered by the runtime policy. Dashboard-triggerable means this
          control plane can start the worker directly; queue-addressable workers pick up routed work through
          their existing runner boundary.
        </p>
        {systemWorkers.length ? <SystemWorkerTable workers={systemWorkers} /> : <p className="v-agents__empty">No separate system workers are registered.</p>}
      </details>

      <p className="v-agents__note">
        Humans and identities found only in historical queue or ledger records are intentionally omitted.
        The model cell shows effective routing; changing it remains a governed, audited write.
      </p>

      <RoutingAuditStrip audit={routingSnap.audit} />
    </section>
  );
}
