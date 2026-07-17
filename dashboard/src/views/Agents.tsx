/**
 * Agents view (U3) — the fleet roster: who exists, who's working, and on what.
 *
 * HONEST v1 PROJECTION. There is no canonical agent-registry endpoint; the only place agent identity
 * surfaces in the read-only API is the `owner` field of cards. So the roster is DERIVED from
 * `/api/index` (Plane-A snapshot): every distinct non-null card `owner` is an agent, its status is
 * "working" iff it owns a card in the `working` state, and its "doing" line is that working card's
 * action + id. Projects come from the agent's owned cards. Card count is owned-card count.
 *
 * KNOWN GAPS (feed the Phase R2 work order — see the note rendered under the table and the build
 * report): (1) last-seen / per-agent activity is NOT derivable — the ledger rollup in `/api/index`
 * collapses all rows and discards writer identity + dates. (2) Per-agent model is Phase R2; the model
 * cell is a DISABLED visual placeholder ("—") — no writes, no toggle. (3) An idle agent that owns no
 * card is invisible (no registry to enumerate from). (4) MCP connections attach to projects, not
 * agents — they live in the Connectors view, not here.
 *
 * Read-only. Self-fetches `/api/index` (same empty-safe pattern as Control) or takes a snapshot.
 */
import { useEffect, useState } from 'react';
import type { PlaneAIndex } from '../../server/planeA/indexer';
import type { ParsedCard } from '../../server/planeA/cards';
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
  /** The card the agent is actively working, if any — its action + id feed the "doing" cell. */
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

/**
 * Derive the roster from the snapshot: group every card by its non-null owner, then project each
 * agent's status/current-card/projects/count. Sorted working-first, then id-alphabetical.
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
    });
  }

  return rows.sort((a, b) => {
    if (a.working !== b.working) return a.working ? -1 : 1;
    return a.id.localeCompare(b.id);
  });
}

/**
 * Per-agent model cell. Phase-R2 model routing lands a real per-agent toggle here; until then this is
 * a DISABLED visual slot — a muted mono "—" chip with a hint. It never writes and has no toggle.
 */
function ModelPlaceholder(): React.JSX.Element {
  return (
    <span className="v-agents__model mc-mono" aria-disabled="true" title="model routing — Phase R">
      —
    </span>
  );
}

/** Agents view. Accepts a snapshot directly (tests) or self-fetches `/api/index`. */
export function Agents({ snapshot }: { snapshot?: PlaneAIndex } = {}): React.JSX.Element {
  const [fetched, setFetched] = useState<PlaneAIndex | null>(null);

  useEffect(() => {
    if (snapshot) return;
    let cancelled = false;
    fetch('/api/index')
      .then((r) => r.json() as Promise<PlaneAIndex>)
      .then((d) => {
        if (!cancelled) setFetched(d);
      })
      .catch(() => {
        /* read-only view: on failure keep the empty-safe scaffold, never crash the shell */
      });
    return () => {
      cancelled = true;
    };
  }, [snapshot]);

  const index = snapshot ?? fetched ?? EMPTY_INDEX;
  const roster = deriveRoster(index);

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
                      <ModelPlaceholder />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="v-agents__note">
            Roster derived from card ownership. Last-seen and per-agent activity aren&rsquo;t available
            from the current index; per-agent model routing arrives in Phase&nbsp;R.
          </p>
        </>
      )}
    </section>
  );
}
