/**
 * Home — the DEFAULT landing view of the entity-first IA (U3). Daniel's locked spec: a ROLLUP whose
 * job is "what's running / to resume" front-and-centre plus usage KPIs. The fleet runs as desktop
 * tasks coordinating through git; this dashboard is only a projection — closing the tab stops nothing,
 * so on reopen Home reconstructs the operator's context from files (the `/api/index` snapshot): what is
 * mid-flight, what is waiting on HIM (the human-inbox projection — approvals, operator gates, wake-me
 * cards and halted runs alike, never merely `state: approvals`), where each project stands, and how
 * much work has run.
 *
 * It stays a rollup — a row links to the DESTINATION that owns it via `onNavigate`, and a waiting-on-you
 * row links to the exact entity via `onNavigateTarget` (spec §5: a gate is addressed on the surface
 * holding its context, never from the rollup). Depth lives in the dedicated views, never bolted on here.
 *
 * Home no longer hosts a launch form. Work is launched from the workflow it belongs to (ONE Launch
 * button on the workflow surface); a second, form-shaped launch path on the landing page was a parallel
 * way to do the same governed thing, with its own owner picker and its own failure modes.
 *
 * USAGE, never spend: KPIs surface step counts + model mix and DELIBERATELY suppress the USD figure —
 * it exists in the ledger (`cost.usdPresent`) but is never rendered here (matches Control's suppression).
 *
 * Data source: the `snapshot` prop (tests / an already-loaded parent) or a self-fetch of `/api/index`,
 * refreshed on each hub SSE tick. Every panel degrades to an empty-safe state; nothing here writes.
 */
import { useEffect, useState } from 'react';
import type { PlaneAIndex } from '../../server/planeA/indexer';
import type { CardProjection } from '../../server/planeA/cards';
import type { DestinationId } from '../nav/config';
import { useSse } from '../lib/sseClient';
import { invalidateSessionOnGovernedAuthFailure } from '../lib/authClient';
import { fetchInbox, type InboxResponse } from '../lib/inboxClient';
import { ExecutionUnlock, type ExecutionUnlockClient } from '../control/ExecutionUnlock';
import { EntityName } from '../components/EntityName';
import { PLANE_A_RECORDS_KEY, PLANE_A_RUN_ROWS_KEY } from '../lib/planeAKeys';
import { entityRowProps } from '../components/entityRow';
import { cardLink } from '../control/entityLinks';
import type { NavTarget } from '../nav/stack';
import '../styles/views/home.css';

const EMPTY_INDEX: PlaneAIndex = {
  cards: {},
  [PLANE_A_RECORDS_KEY]: {
    dispatch: { count: 0, cards: 0, byProject: {} },
    cost: { stepCount: 0, perModelSteps: {}, modelMix: {}, usdPresent: false },
    grades: { count: 0, rows: [] },
    [PLANE_A_RUN_ROWS_KEY]: { count: 0, rows: [] },
  },
  orgStates: [],
};

/** Distinct non-null card owners across every state bucket = the agents currently on the board. */
function agentCount(index: PlaneAIndex): number {
  const owners = new Set<string>();
  for (const bucket of Object.values(index.cards)) {
    for (const c of bucket) {
      if (typeof c.meta.owner === 'string' && c.meta.owner) owners.add(c.meta.owner);
    }
  }
  return owners.size;
}

function stateCount(index: PlaneAIndex, state: string): number {
  return index.cards[state]?.length ?? 0;
}

/** Map a card's `risk-tier` (`T1`/`T2`/`T3`) to its badge modifier. Unknown tiers get no modifier. */
function tierClass(tier: unknown): string {
  const t = String(tier ?? '').toLowerCase();
  return t === 't1' || t === 't2' || t === 't3' ? ` mc-badge--${t}` : '';
}

/**
 * What a card ACTS ON — its target, and nothing else.
 *
 * This used to be `action · target`, which printed the card's name a second time in the row: a card's
 * `action` IS its `displayName` (planeA/cards.ts#cardTitle), already rendered by `EntityName` in the
 * column beside it. The name appears once now, and this column adds the thing it operates on.
 */
function cardTarget(card: CardProjection): string {
  return String(card.meta.target ?? '') || '—';
}

/* ── KPI tiles ─────────────────────────────────────────────────────────────────────────────────
 * Flat hairline panels, mono tabular-nums xl numerals (brief Board spec). A tile with a `to` target
 * renders as a button and navigates on activation; the rest are static readouts. The Approvals tile
 * takes the single terracotta accent (left-border) only while something is actually waiting.
 */
function KpiTile({
  label,
  value,
  to,
  accent,
  onNavigate,
  testId,
}: {
  label: string;
  value: number;
  to?: DestinationId;
  accent?: boolean;
  onNavigate?: (id: DestinationId) => void;
  testId: string;
}): React.JSX.Element {
  const className = `v-home__kpi${accent ? ' v-home__kpi--accent' : ''}${to ? ' v-home__kpi--link' : ''}`;
  const body = (
    <>
      <span className="v-home__kpi-value mc-mono">{value}</span>
      <span className="v-home__kpi-label">{label}</span>
    </>
  );
  if (to && onNavigate) {
    return (
      <button type="button" className={className} data-testid={testId} onClick={() => onNavigate(to)}>
        {body}
      </button>
    );
  }
  return (
    <div className={className} data-testid={testId}>
      {body}
    </div>
  );
}

function KpiTiles({
  index,
  inbox,
  onNavigate,
}: {
  index: PlaneAIndex;
  inbox: InboxResponse;
  onNavigate?: (id: DestinationId) => void;
}): React.JSX.Element {
  // The `waiting` tile counts WHO MUST ACT, not card state. `stateCount(index, 'approvals')` used to
  // supply this number and rendered 0 while seven `human-operator` gates sat in `state: inbox` — the
  // promotion step into `queue/approvals/` is not what makes something the operator's problem. This is
  // the same projection the Approvals view lists, so the tile and that view can never disagree.
  const waiting = inbox.items.length;
  // FOUR tiles, not six: agents / running / waiting / blocked. `queued` and `steps` went — a queued
  // count is not a state anyone acts on from here, and the step count is already the first number in
  // the Usage panel below, where it belongs.
  return (
    <section className="v-home__kpis" aria-label="Fleet KPIs">
      <KpiTile testId="kpi-agents" label="agents" value={agentCount(index)} to="agents" onNavigate={onNavigate} />
      <KpiTile testId="kpi-running" label="running" value={stateCount(index, 'working')} to="tasks" onNavigate={onNavigate} />
      <KpiTile
        testId="kpi-inbox"
        label="waiting"
        value={waiting}
        to="inbox"
        accent={waiting > 0}
        onNavigate={onNavigate}
      />
      <KpiTile testId="kpi-blocked" label="blocked" value={stateCount(index, 'blocked')} />
    </section>
  );
}

/* ── Running / resume hero ─────────────────────────────────────────────────────────────────────
 * The front-and-centre "pick up where you left off" surface. Each row is a button so it is keyboard-
 * reachable and calls `onNavigate` to its entity view (a card is a task; a signature request is an
 * approval; a STATE line is a project; a ledger beat is activity). Left-border accent marks the row
 * as the shared active/selected language on hover/focus.
 */
function ResumeRow({
  id,
  entity,
  main,
  meta,
  tier,
  dot,
  to,
  target,
  onNavigate,
  onNavigateTarget,
}: {
  id: string;
  /** The card/entity identity this row is about. Absent for rows that name no entity (ledger beats). */
  entity?: { kind: 'card'; displayName: string; shortRef: number };
  main: string;
  meta?: string;
  tier?: unknown;
  dot?: 'running' | 'blocked' | 'idle';
  to: DestinationId;
  /** The exact entity to open. Preferred over `to` when present — a gate needs its own context. */
  target?: NavTarget;
  onNavigate?: (id: DestinationId) => void;
  onNavigateTarget?: (target: NavTarget) => void;
}): React.JSX.Element {
  // A row with a deep link opens the ENTITY (spec §5); without one it falls back to the destination.
  const open = target && onNavigateTarget ? () => onNavigateTarget(target) : () => onNavigate?.(to);
  return (
    <div
      className="v-home__row"
      aria-label={`Open ${entity?.displayName ?? id}`}
      {...entityRowProps(open)}
    >
      {dot ? <span className={`mc-status-dot mc-status-dot--${dot}`} aria-hidden="true" /> : null}
      {/* Inverted: the human name leads, the id lives in EntityName's tooltip + copy button. */}
      {entity ? (
        <span className="v-home__row-id">
          <EntityName kind={entity.kind} id={id} displayName={entity.displayName} shortRef={entity.shortRef} />
        </span>
      ) : (
        <span className="v-home__row-id mc-mono">{id}</span>
      )}
      <span className="v-home__row-main">{main}</span>
      {meta ? <span className="v-home__row-meta mc-mono">{meta}</span> : null}
      {tier ? <span className={`mc-badge${tierClass(tier)}`}>{String(tier)}</span> : null}
    </div>
  );
}

function ResumeGroup({
  title,
  count,
  emptyLabel,
  children,
}: {
  title: string;
  count: number;
  emptyLabel: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="v-home__group">
      <div className="v-home__group-head">
        <span className="v-home__eyebrow">{title}</span>
        <span className="v-home__count mc-mono">{count}</span>
      </div>
      {count === 0 ? <p className="mc-empty">{emptyLabel}</p> : <div className="v-home__rows">{children}</div>}
    </div>
  );
}

function RunningResume({
  index,
  inbox,
  onNavigate,
  onNavigateTarget,
}: {
  index: PlaneAIndex;
  inbox: InboxResponse;
  onNavigate?: (id: DestinationId) => void;
  onNavigateTarget?: (target: NavTarget) => void;
}): React.JSX.Element {
  const working = index.cards.working ?? [];
  // Same escalation-only projection as the Inbox KPI.
  const cardsById = new Map(
    Object.values(index.cards).flat().map((card) => [String(card.meta.id), card]),
  );
  const waiting = inbox.items
    .map((item) => ({ item, card: cardsById.get(item.subject.cardId) }))
    .filter((entry): entry is { item: typeof entry.item; card: CardProjection } => entry.card !== undefined);
  const blocked = index.cards.blocked ?? [];
  const recentRuns = index[PLANE_A_RECORDS_KEY][PLANE_A_RUN_ROWS_KEY].rows;

  return (
    <section className="v-home__resume mc-panel" aria-label="Running and to resume" data-testid="home-resume">
      <h2 className="v-home__panel-title">Running · to resume</h2>

      <ResumeGroup title="Running now" count={working.length} emptyLabel="Nothing running — the fleet is idle.">
        {working.map((c) => (
          <ResumeRow
            key={String(c.meta.id)}
            id={String(c.meta.id)}
            entity={{ kind: 'card', displayName: c.displayName, shortRef: c.shortRef }}
            main={cardTarget(c)}
            meta={typeof c.meta.owner === 'string' ? c.meta.owner : undefined}
            tier={c.meta['risk-tier']}
            dot="running"
            to="tasks"
            target={cardLink(String(c.meta.id))}
            onNavigate={onNavigate}
            onNavigateTarget={onNavigateTarget}
          />
        ))}
      </ResumeGroup>

      {/* Titled "Waiting on you", not "…on your signature": most of these need an action in the world
        * (clear an OAuth gate, decide a governance amendment), not a signature. The empty label may only
        * render when the whole human-inbox projection is empty. */}
      <ResumeGroup
        title="Waiting on you"
        count={waiting.length}
        emptyLabel="Nothing is waiting on you."
      >
        {waiting.map(({ item, card }) => (
          <ResumeRow
            key={item.subject.cardId}
            id={item.subject.cardId}
            entity={{ kind: 'card', displayName: card.displayName, shortRef: card.shortRef }}
            main={cardTarget(card)}
            meta={item.reason}
            tier={card.meta['risk-tier']}
            dot="idle"
            to="inbox"
            /* spec §5 — a waiting row opens the CARD, where the gate is answered with its work order
             * in front of the operator, not the Inbox list that shows none of it. */
            target={cardLink(item.subject.cardId)}
            onNavigate={onNavigate}
            onNavigateTarget={onNavigateTarget}
          />
        ))}
      </ResumeGroup>

      {blocked.length > 0 ? (
        <ResumeGroup title="Blocked" count={blocked.length} emptyLabel="">
          {blocked.map((c) => (
            <ResumeRow
              key={String(c.meta.id)}
              id={String(c.meta.id)}
              entity={{ kind: 'card', displayName: c.displayName, shortRef: c.shortRef }}
              main={cardTarget(c)}
              tier={c.meta['risk-tier']}
              dot="blocked"
              to="tasks"
              target={cardLink(String(c.meta.id))}
              onNavigate={onNavigate}
              onNavigateTarget={onNavigateTarget}
            />
          ))}
        </ResumeGroup>
      ) : null}

      <div className="v-home__group">
        <div className="v-home__group-head">
          <span className="v-home__eyebrow">Projects</span>
          <span className="v-home__count mc-mono">{index.orgStates.length}</span>
        </div>
        {index.orgStates.length === 0 ? (
          <p className="mc-empty">No org STATE files found.</p>
        ) : (
          <ul className="v-home__projects">
            {index.orgStates.map((s) => {
              const isBlocked = Boolean(s.blocked && s.blocked !== '(nothing blocked)');
              return (
                <li key={s.project}>
                  <button
                    type="button"
                    className="v-home__project"
                    onClick={() => onNavigate?.('projects')}
                    title={`Open ${s.project} in projects`}
                  >
                    <span className="v-home__project-name mc-mono">{s.project}</span>
                    <span className="v-home__project-now">{s.now || s.next || '—'}</span>
                    {isBlocked ? <span className="mc-badge mc-badge--blocked">blocked</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <ResumeGroup
        title="Recent runs"
        count={recentRuns.length}
        emptyLabel="No runs recorded yet."
      >
        {recentRuns.slice(-6).reverse().map((row, i) => (
          <ResumeRow
            key={`recent-run-${i}`}
            id={String(row.card ?? row.date ?? `#${i}`)}
            main={Object.values(row).filter(Boolean).join(' · ') || '—'}
            to="home"
            onNavigate={onNavigate}
          />
        ))}
      </ResumeGroup>
    </section>
  );
}

/* ── Usage panel (right column) ────────────────────────────────────────────────────────────────
 * Per-model step counts + model mix from the cost rollup. USD is suppressed (usage, not spend). A
 * dense mono table, not decorative bars — matches the Registry table language and stays calm.
 */
function UsagePanel({ index }: { index: PlaneAIndex }): React.JSX.Element {
  const cost = index[PLANE_A_RECORDS_KEY].cost;
  const rows = Object.entries(cost.perModelSteps).sort((a, b) => b[1] - a[1]);
  return (
    <section className="v-home__usage mc-panel" aria-label="Usage" data-testid="home-usage">
      <h2 className="v-home__panel-title">Usage</h2>
      <div className="v-home__usage-total">
        <span className="v-home__usage-total-value mc-mono">{cost.stepCount}</span>
        <span className="v-home__eyebrow">steps run</span>
      </div>
      {rows.length === 0 ? (
        <p className="mc-empty">No usage recorded yet.</p>
      ) : (
        <table className="mc-table v-home__usage-table">
          <thead>
            <tr>
              <th>model</th>
              <th>steps</th>
              <th>mix</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([model, steps]) => (
              <tr key={model}>
                <td className="mc-mono">{model}</td>
                <td className="mc-mono">{steps}</td>
                <td className="mc-mono">{Math.round((cost.modelMix[model] ?? 0) * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/**
 * Home landing. Accepts a snapshot directly (tests) or self-fetches `/api/index` and refreshes on SSE.
 * `onNavigate` is threaded to every row/tile and called with the destination id; the integrator wires
 * it to the shell's nav switch (import { DestinationId } from ../nav/config).
 */
export function Home({
  snapshot,
  inboxSnapshot,
  onNavigate,
  onNavigateTarget,
  executionClient,
}: {
  snapshot?: PlaneAIndex;
  inboxSnapshot?: InboxResponse;
  onNavigate?: (id: DestinationId) => void;
  /** Open one exact entity. Wired by the shell to its nav stack; rows fall back to `onNavigate`. */
  onNavigateTarget?: (target: NavTarget) => void;
  /** Hermetic seam for the panel's own arming attempt when Home is rendered outside the app shell
   *  (tests). Inside the shell the App-level arming provider owns the attempt and this is unused. */
  executionClient?: ExecutionUnlockClient;
} = {}): React.JSX.Element {
  const [fetched, setFetched] = useState<PlaneAIndex | null>(null);
  const [fetchedInbox, setFetchedInbox] = useState<InboxResponse | null>(null);
  // A Plane-A delta on the hub bumps `count`; we refetch the snapshot on each tick (skipped when a
  // snapshot is supplied directly, and a no-op under jsdom where EventSource is absent).
  const { count } = useSse('/events');

  useEffect(() => {
    if (snapshot) return;
    let cancelled = false;
    fetch('/api/index')
      .then(async (r) => {
        if (!r.ok) {
          await invalidateSessionOnGovernedAuthFailure(r);
          throw new Error(`GET /api/index failed: ${r.status}`);
        }
        return r.json() as Promise<PlaneAIndex>;
      })
      .then((d) => {
        // HTTP/JSON is untrusted at this boundary. A refusal body is not a Plane-A projection.
        if (!cancelled && d?.cards && d[PLANE_A_RECORDS_KEY]
          && Array.isArray(d[PLANE_A_RECORDS_KEY][PLANE_A_RUN_ROWS_KEY]?.rows)
          && d[PLANE_A_RECORDS_KEY].cost && Array.isArray(d.orgStates)) setFetched(d);
      })
      .catch(() => {
        /* read-only board: on failure keep the empty-safe scaffold, never crash the shell */
      });
    return () => {
      cancelled = true;
    };
  }, [snapshot, count]);

  useEffect(() => {
    if (inboxSnapshot) return;
    let cancelled = false;
    fetchInbox()
      .then((response) => { if (!cancelled) setFetchedInbox(response); })
      .catch(() => {
        /* retain the last verified Inbox response; the empty-safe initial state remains valid */
      });
    return () => { cancelled = true; };
  }, [inboxSnapshot, count]);

  const index = snapshot ?? fetched ?? EMPTY_INDEX;
  const inbox = inboxSnapshot ?? fetchedInbox ?? { items: [] };

  return (
    <div className="v-home" aria-label="Home view">
      <KpiTiles index={index} inbox={inbox} onNavigate={onNavigate} />
      <div className="v-home__grid">
        <div className="v-home__col v-home__col--wide">
          <RunningResume index={index} inbox={inbox} onNavigate={onNavigate} onNavigateTarget={onNavigateTarget} />
        </div>
        <div className="v-home__col">
          <UsagePanel index={index} />
          {/* A STATUS readout, not a control: execution arms off the ONE dashboard sign-in (App's
              `ExecutionArmingProvider` owns that), and this reports the posture it produced. */}
          <ExecutionUnlock client={executionClient} />
        </div>
      </div>
    </div>
  );
}
