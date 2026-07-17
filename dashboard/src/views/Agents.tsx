/**
 * Agents view — the fleet roster with per-agent model routing (R2.2).
 *
 * The roster is DERIVED from `/api/index` (Plane-A snapshot): every distinct non-null card `owner` is an
 * agent, working iff it owns a `working` card. Per-agent ROUTING (effective runtime/model + provenance,
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
import type { Session } from '../lib/authClient';
import {
  EMPTY_ROUTING,
  fetchRouting,
  postRoutingOverride,
  type RoutingSnapshot,
  type EffectiveView,
} from '../lib/routingClient';
import { RoutingControl } from './routingControls';
import '../styles/views/agents.css';

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
}

/** Normalise a card's `project` field (string | string[]) into a flat list of project names. */
function projectsOf(card: ParsedCard): string[] {
  const p = card.meta.project;
  if (Array.isArray(p)) return p.filter((x): x is string => typeof x === 'string' && x !== '');
  return typeof p === 'string' && p !== '' ? [p] : [];
}

/** Derive the roster from the snapshot (working-first, then id-alphabetical). */
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
    });
  }

  return rows.sort((a, b) => {
    if (a.working !== b.working) return a.working ? -1 : 1;
    return a.id.localeCompare(b.id);
  });
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
  routing,
  sessionToken,
  onRequestSession,
}: {
  snapshot?: PlaneAIndex;
  routing?: RoutingSnapshot;
  sessionToken?: string;
  onRequestSession?: () => Promise<Session | null>;
} = {}): React.JSX.Element {
  const [fetched, setFetched] = useState<PlaneAIndex | null>(null);
  const [routingState, setRoutingState] = useState<RoutingSnapshot | null>(routing ?? null);

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
  const roster = deriveRoster(index);

  const effectiveById = new Map(routingSnap.agents.map((a) => [a.id, a.effective]));
  const registry = routingSnap.policy.runtimes;
  const canAct = Boolean(sessionToken) || Boolean(onRequestSession);

  async function resolveToken(): Promise<string | undefined> {
    if (sessionToken) return sessionToken;
    if (onRequestSession) return (await onRequestSession())?.token ?? undefined;
    return undefined;
  }

  return (
    <section className="v-agents" aria-label="Agents view">
      <h2 className="v-agents__title">
        Agents <span className="v-agents__count mc-num">({roster.length})</span>
      </h2>

      {roster.length === 0 ? (
        <p className="v-agents__empty">No agents on the board.</p>
      ) : (
        <>
          <div className="v-agents__table-wrap">
            <table className="mc-table v-agents__table">
              <thead>
                <tr>
                  <th scope="col">Agent</th>
                  <th scope="col">Doing</th>
                  <th scope="col">Projects</th>
                  <th scope="col" className="v-agents__col-num">Cards</th>
                  <th scope="col">Model</th>
                </tr>
              </thead>
              <tbody>
                {roster.map((a) => (
                  <tr key={a.id} data-testid={`agent-row-${a.id}`}>
                    <td>
                      <span className="v-agents__agent">
                        <span
                          className={`mc-status-dot ${a.working ? 'mc-status-dot--running' : 'mc-status-dot--idle'}`}
                          aria-hidden="true"
                        />
                        <span className="mc-mono">{a.id}</span>
                        <span className="v-agents__state">{a.working ? 'working' : 'idle'}</span>
                      </span>
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
                    <td>
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="v-agents__note">
            Roster derived from card ownership. The model cell shows effective routing (source tag);
            with a passkey session it writes a governed, audited agent-scope override.
          </p>
        </>
      )}

      <RoutingAuditStrip audit={routingSnap.audit} />
    </section>
  );
}
