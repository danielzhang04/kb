/**
 * Agents view — the fleet roster with per-agent model routing (R2.2).
 *
 * The roster is the enriched `/api/agents` union (card owners ∪ ledger writers ∪ role catalog), each
 * row carrying its role + last-active date; until it loads (and in tests that pass only a snapshot) it
 * falls back to `deriveRoster` over `/api/index` (distinct non-null card `owner`, working iff it owns a
 * `working` card). Per-agent ROUTING (effective runtime/model + provenance,
 * and the governed toggle) comes from `/api/routing` (R2.1 projection). The model cell is now a live
 * governed control: it shows the effective model (mono) + provenance tag, and — with a WebAuthn session —
 * opens a popover to write an agent-scope override (audited, ops pull-rebase-push) or clear it. Fail-closed
 * like launchControls: without a session the control is disabled with a nudge; a point-of-action mint runs
 * inline when `onRequestSession` is wired.
 *
 * A routing-audit strip (R2.4) surfaces routed-vs-ran mismatches + expiring/expired overrides, read-only.
 * Read-only for the roster; every routing mutation is a governed, audited server write.
 */
import { useEffect, useState, useCallback } from 'react';
import type { PlaneAIndex } from '../../server/planeA/indexer';
import type { ParsedCard } from '../../server/planeA/cards';
import type { AgentRosterEntry } from '../../server/agents/roster';
import type { Session } from '../lib/authClient';
import {
  EMPTY_ROUTING,
  fetchRouting,
  postRoutingOverride,
  type RoutingSnapshot,
  type EffectiveView,
} from '../lib/routingClient';
import { RoutingControl } from './routingControls';
import { AgentDetail } from './AgentDetail';
import { getRun, listRuns, type RunMetadataDto } from '../control/controlClient';
import { cardOwnerIndex, runsForAgent, type RunWithStages } from '../control/entityLinks';
import type { NavTarget } from '../nav/stack';
import '../styles/views/agents.css';

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
  working: boolean;
  current: { action: string; id: string } | null;
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
  const byOwner = new Map<string, ParsedCard[]>();
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
      working: workingCard !== null,
      current: workingCard ? { action: String(workingCard.meta.action), id: String(workingCard.meta.id) } : null,
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
    description: e.description,
    ledger: { dispatches: e.ledger.dispatches, steps: e.ledger.steps, days: e.ledger.days },
    sources: e.sources,
  };
}

/**
 * An agent is RUNNABLE when a runner will actually claim its cards: either a human has flipped its
 * `runner-bound` flag true, or its id is a registered `default_worker` in the runtime registry (the
 * pre-C7 onboarding path). A declared agent that is neither is "declared — no runner": registered but
 * inert. `defaultWorkers` is the set of `default_worker` ids across the routing registry.
 */
function isRunnable(row: AgentRow, defaultWorkers: Set<string>): boolean {
  return row.runnerBound || defaultWorkers.has(row.id);
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

export function Agents({
  snapshot,
  roster,
  routing,
  sessionToken,
  onRequestSession,
  focusAgentId,
  onOpenAgent,
  onBack,
  activeSectionId,
  onSectionChange,
  onNavigate,
  agentRuns,
}: {
  snapshot?: PlaneAIndex;
  roster?: AgentRosterEntry[];
  routing?: RoutingSnapshot;
  sessionToken?: string;
  onRequestSession?: () => Promise<Session | null>;
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
  /** Runs joined to this agent by the caller. `undefined` = not loaded, which the detail says out loud. */
  agentRuns?: RunMetadataDto[];
} = {}): React.JSX.Element {
  const [fetched, setFetched] = useState<PlaneAIndex | null>(null);
  const [rosterState, setRosterState] = useState<AgentRosterEntry[] | null>(roster ?? null);
  const [routingState, setRoutingState] = useState<RoutingSnapshot | null>(routing ?? null);
  // Uncontrolled fallback for the open agent when no nav stack is wired above this view.
  const [localOpenId, setLocalOpenId] = useState<string | null>(null);
  const [scannedRuns, setScannedRuns] = useState<RunWithStages[] | null>(null);
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
        const recent = [...all]
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
        if (!cancelled) setScannedRuns(details.filter((d): d is RunWithStages => d !== null));
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
  // Prefer the enriched server roster (queue owners ∪ ledger writers ∪ roles); fall back to the
  // snapshot-derived roster until it loads (and in tests that pass only a snapshot).
  const agentRows = enriched ? enriched.map(rowFromEntry) : deriveRoster(index);

  const effectiveById = new Map(routingSnap.agents.map((a) => [a.id, a.effective]));
  const registry = routingSnap.policy.runtimes;
  // Registered runner ids: every runtime's `default_worker`. A roster id in this set is runnable even
  // without an `agents/<id>.md` declaration (the pre-C7 onboarding path, e.g. `worker-desktop`).
  const defaultWorkers = new Set(
    Object.values(registry)
      .map((r) => r.default_worker)
      .filter((w): w is string => typeof w === 'string' && w !== ''),
  );
  const canAct = Boolean(sessionToken) || Boolean(onRequestSession);

  async function resolveToken(): Promise<string | undefined> {
    if (sessionToken) return sessionToken;
    if (onRequestSession) return (await onRequestSession())?.token ?? undefined;
    return undefined;
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
        canAct={canAct}
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
   * An id that is in the nav stack but not in the roster (a deleted agent, a stale back-forward) falls
   * through to the table rather than rendering an empty shell.
   */
  const openAgentRow = openAgentId ? agentRows.find((a) => a.id === openAgentId) : undefined;
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
        Agents <span className="v-agents__count mc-num">({agentRows.length})</span>
      </h2>

      {agentRows.length === 0 ? (
        <p className="v-agents__empty">No agents on the board.</p>
      ) : (
        <>
          <div className="v-agents__table-wrap">
            <table className="mc-table v-agents__table">
              <thead>
                <tr>
                  <th scope="col">Agent</th>
                  <th scope="col">Role</th>
                  <th scope="col">Binding</th>
                  <th scope="col">Doing</th>
                  <th scope="col">Projects</th>
                  <th scope="col" className="v-agents__col-num">Cards</th>
                  <th scope="col">Last active</th>
                  <th scope="col">Model</th>
                </tr>
              </thead>
              <tbody>
                {agentRows.map((a) => (
                  <tr key={a.id} data-testid={`agent-row-${a.id}`}>
                    <td>
                      {/* The agent id is the click target into the detail. A button (not a row-level
                       *  onClick) so it is keyboard-reachable and announced as an action — the routing
                       *  cell in this same row is itself interactive, so a whole-row handler would
                       *  swallow its clicks. */}
                      <button
                        type="button"
                        className="v-agents__agent v-agents__agent--link"
                        data-testid={`agent-open-${a.id}`}
                        aria-label={`Open ${a.id} detail`}
                        onClick={() => openAgent(a.id)}
                      >
                        <span
                          className={`mc-status-dot ${a.working ? 'mc-status-dot--running' : 'mc-status-dot--idle'}`}
                          aria-hidden="true"
                        />
                        <span className="mc-mono">{a.id}</span>
                        <span className="v-agents__state">{a.working ? 'working' : 'idle'}</span>
                      </button>
                    </td>
                    <td>
                      {a.role ? (
                        <span className="v-agents__role mc-mono">{a.role}</span>
                      ) : (
                        <span className="v-agents__idle">—</span>
                      )}
                    </td>
                    <td>
                      {(() => {
                        const runnable = isRunnable(a, defaultWorkers);
                        return (
                          <span className="v-agents__binding" data-testid={`agent-binding-${a.id}`}>
                            {/* Declared-vs-observed: an authoritative agents/<id>.md vs merely observed activity. */}
                            <span
                              className={`v-agents__provenance v-agents__provenance--${a.declared ? 'declared' : 'observed'}`}
                            >
                              {a.declared ? 'declared' : 'observed'}
                            </span>
                            {/* Runner-bound status: runnable (a runner claims its cards) vs "no runner" (inert). */}
                            <span
                              className={`v-agents__runner v-agents__runner--${runnable ? 'bound' : 'unbound'}`}
                              title={
                                runnable
                                  ? 'A runner claims this agent’s cards'
                                  : 'Declared but no runner claims its cards yet'
                              }
                            >
                              {runnable ? 'runner-bound' : 'no runner'}
                            </span>
                            {a.declaredRuntime ? (
                              <span className="mc-mono v-agents__declared-runtime">{a.declaredRuntime}</span>
                            ) : null}
                          </span>
                        );
                      })()}
                    </td>
                    <td>
                      {a.current ? (
                        <span className="v-agents__doing">
                          <span className="v-agents__action">{a.current.action}</span>
                          <span className="mc-mono v-agents__card-id">{a.current.id}</span>
                        </span>
                      ) : (
                        <span className="v-agents__idle">idle</span>
                      )}
                    </td>
                    <td>
                      {a.projects.length === 0 ? (
                        <span className="v-agents__idle">—</span>
                      ) : (
                        <span className="v-agents__projects">
                          {a.projects.map((p) => (
                            <span key={p} className="v-agents__proj mc-mono">
                              {p}
                            </span>
                          ))}
                        </span>
                      )}
                    </td>
                    <td className="mc-mono v-agents__col-num">{a.cardCount}</td>
                    <td className="mc-mono v-agents__last-active">
                      {a.lastActive ?? <span className="v-agents__idle">—</span>}
                    </td>
                    <td>{routingControlFor(a)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="v-agents__note">
            Roster unions card owners, ledger writers, and the role catalog. The model cell shows
            effective routing (source tag); with a passkey session it writes a governed, audited
            agent-scope override.
          </p>
        </>
      )}

      <RoutingAuditStrip audit={routingSnap.audit} />
    </section>
  );
}
