/**
 * Home — the DEFAULT landing view of the entity-first IA (U3). Daniel's locked spec: a ROLLUP whose
 * job is "what's running / to resume" front-and-centre plus usage KPIs. The fleet runs as desktop
 * tasks coordinating through git; this dashboard is only a projection — closing the tab stops nothing,
 * so on reopen Home reconstructs the operator's context from files (the `/api/index` snapshot): what is
 * mid-flight, what is waiting on HIM (the human-inbox projection — approvals, operator gates, wake-me
 * cards and halted runs alike, never merely `state: approvals`), where each project stands, and how
 * much work has run.
 *
 * It stays a rollup — every row links CONCEPTUALLY to its entity view via the optional `onNavigate`
 * prop (the integrator wires it to the shell's nav switch); depth lives in the dedicated views, never
 * bolted on here. Home also hosts the governed launch surface ([+ New ▾] → Task lands here), a lean
 * re-implementation of Control's Launch/Rerun forms — `LaunchControls` is not exported from Control and
 * this agent must not edit that file, so the forms are duplicated faithfully (same endpoints, same
 * fail-closed-without-a-session behaviour) rather than imported.
 *
 * USAGE, never spend: KPIs surface step counts + model mix and DELIBERATELY suppress the USD figure —
 * it exists in the ledger (`cost.usdPresent`) but is never rendered here (matches Control's suppression).
 *
 * Data source: the `snapshot` prop (tests / an already-loaded parent) or a self-fetch of `/api/index`,
 * refreshed on each hub SSE tick. Every panel degrades to an empty-safe state; nothing here writes.
 */
import { useEffect, useState } from 'react';
import type { PlaneAIndex } from '../../server/planeA/indexer';
import type { ParsedCard } from '../../server/planeA/cards';
import { projectHumanInbox } from '../../server/approvals/humanInbox';
import type { DestinationId } from '../nav/config';
import type { Session } from '../lib/authClient';
import { useSse } from '../lib/sseClient';
import { useAssignableOwners } from '../lib/assignableOwners';
import { LaunchControls } from './launchControls';
import { ExecutionUnlock, type ExecutionUnlockClient } from '../control/ExecutionUnlock';
import { parseExecutionPosture, type ExecutionPostureDto } from '../control/controlClient';
import '../styles/views/home.css';

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

function cardMain(card: ParsedCard): string {
  const action = String(card.meta.action ?? '');
  const target = String(card.meta.target ?? '');
  return [action, target].filter(Boolean).join(' · ') || '—';
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
  onNavigate,
}: {
  index: PlaneAIndex;
  onNavigate?: (id: DestinationId) => void;
}): React.JSX.Element {
  // The `waiting` tile counts WHO MUST ACT, not card state. `stateCount(index, 'approvals')` used to
  // supply this number and rendered 0 while seven `human-operator` gates sat in `state: inbox` — the
  // promotion step into `queue/approvals/` is not what makes something the operator's problem. This is
  // the same projection the Approvals view lists, so the tile and that view can never disagree.
  const waiting = projectHumanInbox(index).counts.total;
  return (
    <section className="v-home__kpis" aria-label="Fleet KPIs">
      <KpiTile testId="kpi-agents" label="agents" value={agentCount(index)} to="agents" onNavigate={onNavigate} />
      <KpiTile testId="kpi-running" label="running" value={stateCount(index, 'working')} to="tasks" onNavigate={onNavigate} />
      <KpiTile
        testId="kpi-approvals"
        label="waiting"
        value={waiting}
        to="approvals"
        accent={waiting > 0}
        onNavigate={onNavigate}
      />
      <KpiTile testId="kpi-blocked" label="blocked" value={stateCount(index, 'blocked')} />
      <KpiTile testId="kpi-queued" label="queued" value={stateCount(index, 'inbox')} to="tasks" onNavigate={onNavigate} />
      <KpiTile testId="kpi-steps" label="steps" value={index.ledgers.cost.stepCount} to="ledgers" onNavigate={onNavigate} />
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
  main,
  meta,
  tier,
  dot,
  to,
  onNavigate,
}: {
  id: string;
  main: string;
  meta?: string;
  tier?: unknown;
  dot?: 'running' | 'blocked' | 'idle';
  to: DestinationId;
  onNavigate?: (id: DestinationId) => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="v-home__row"
      onClick={() => onNavigate?.(to)}
      aria-label={`Open ${id} in ${to}`}
    >
      {dot ? <span className={`mc-status-dot mc-status-dot--${dot}`} aria-hidden="true" /> : null}
      <span className="v-home__row-id mc-mono">{id}</span>
      <span className="v-home__row-main">{main}</span>
      {meta ? <span className="v-home__row-meta mc-mono">{meta}</span> : null}
      {tier ? <span className={`mc-badge${tierClass(tier)}`}>{String(tier)}</span> : null}
    </button>
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
      {count === 0 ? <p className="v-home__empty">{emptyLabel}</p> : <div className="v-home__rows">{children}</div>}
    </div>
  );
}

function RunningResume({
  index,
  onNavigate,
}: {
  index: PlaneAIndex;
  onNavigate?: (id: DestinationId) => void;
}): React.JSX.Element {
  const working = index.cards.working ?? [];
  // Same projection as the KPI tile and the Approvals view — NOT `index.cards.approvals`, which is the
  // promoted-card bucket and was empty (only a `.gitkeep`) while seven operator gates waited in `inbox`.
  const waiting = projectHumanInbox(index).items;
  const blocked = index.cards.blocked ?? [];
  const activity = index.ledgers.activity.rows;

  return (
    <section className="v-home__resume mc-panel" aria-label="Running and to resume" data-testid="home-resume">
      <h2 className="v-home__panel-title">Running · to resume</h2>

      <ResumeGroup title="Running now" count={working.length} emptyLabel="Nothing running — the fleet is idle.">
        {working.map((c) => (
          <ResumeRow
            key={String(c.meta.id)}
            id={String(c.meta.id)}
            main={cardMain(c)}
            meta={typeof c.meta.owner === 'string' ? c.meta.owner : undefined}
            tier={c.meta['risk-tier']}
            dot="running"
            to="tasks"
            onNavigate={onNavigate}
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
        {waiting.map((item) => (
          <ResumeRow
            key={String(item.card.meta.id)}
            id={String(item.card.meta.id)}
            main={cardMain(item.card)}
            meta={item.categoryLabel}
            tier={item.card.meta['risk-tier']}
            dot="idle"
            to="approvals"
            onNavigate={onNavigate}
          />
        ))}
      </ResumeGroup>

      {blocked.length > 0 ? (
        <ResumeGroup title="Blocked" count={blocked.length} emptyLabel="">
          {blocked.map((c) => (
            <ResumeRow
              key={String(c.meta.id)}
              id={String(c.meta.id)}
              main={cardMain(c)}
              tier={c.meta['risk-tier']}
              dot="blocked"
              to="tasks"
              onNavigate={onNavigate}
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
          <p className="v-home__empty">No org STATE files found.</p>
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
        title="Recent activity"
        count={activity.length}
        emptyLabel="No activity recorded yet — the ledger is empty."
      >
        {activity.slice(-6).reverse().map((row, i) => (
          <ResumeRow
            key={`activity-${i}`}
            id={String(row.card ?? row.date ?? `#${i}`)}
            main={Object.values(row).filter(Boolean).join(' · ') || '—'}
            to="activity"
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
  const cost = index.ledgers.cost;
  const rows = Object.entries(cost.perModelSteps).sort((a, b) => b[1] - a[1]);
  return (
    <section className="v-home__usage mc-panel" aria-label="Usage" data-testid="home-usage">
      <h2 className="v-home__panel-title">Usage</h2>
      <div className="v-home__usage-total">
        <span className="v-home__usage-total-value mc-mono">{cost.stepCount}</span>
        <span className="v-home__eyebrow">steps run</span>
      </div>
      {rows.length === 0 ? (
        <p className="v-home__empty">No usage recorded yet.</p>
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
  sessionToken,
  onNavigate,
  onRequestSession,
  executionClient,
}: {
  snapshot?: PlaneAIndex;
  sessionToken?: string;
  onNavigate?: (id: DestinationId) => void;
  /** U5.1 — forwarded to LaunchControls for point-of-action passkey minting (App-wired). */
  onRequestSession?: () => Promise<Session | null>;
  /** Hermetic seam for the purpose-bound execution ceremony; production uses the real control client. */
  executionClient?: ExecutionUnlockClient;
} = {}): React.JSX.Element {
  const [fetched, setFetched] = useState<PlaneAIndex | null>(null);
  const [execution, setExecution] = useState<{ sessionToken: string; posture: ExecutionPostureDto } | null>(null);
  // A Plane-A delta on the hub bumps `count`; we refetch the snapshot on each tick (skipped when a
  // snapshot is supplied directly, and a no-op under jsdom where EventSource is absent).
  const { count } = useSse('/events');

  useEffect(() => {
    if (snapshot) return;
    let cancelled = false;
    fetch('/api/index')
      .then((r) => r.json() as Promise<PlaneAIndex>)
      .then((d) => {
        if (!cancelled) setFetched(d);
      })
      .catch(() => {
        /* read-only board: on failure keep the empty-safe scaffold, never crash the shell */
      });
    return () => {
      cancelled = true;
    };
  }, [snapshot, count]);

  const index = snapshot ?? fetched ?? EMPTY_INDEX;
  // C7.8 — populate the owner picker from the live roster ∪ registered default_workers. Gated on the
  // can-act state so a signed-out board with no mint capability issues no roster fetch.
  const canAct = Boolean(sessionToken) || Boolean(onRequestSession);
  const owners = useAssignableOwners(canAct);
  const parsedExecution = parseExecutionPosture(execution?.posture);
  const executionReady = Boolean(
    sessionToken
    && execution?.sessionToken === sessionToken
    && parsedExecution?.state === 'unlocked'
    && parsedExecution.source === 'passkey',
  );

  return (
    <div className="v-home" aria-label="Home view">
      <KpiTiles index={index} onNavigate={onNavigate} />
      <div className="v-home__grid">
        <div className="v-home__col v-home__col--wide">
          <RunningResume index={index} onNavigate={onNavigate} />
        </div>
        <div className="v-home__col">
          <UsagePanel index={index} />
          <ExecutionUnlock
            sessionToken={sessionToken}
            client={executionClient}
            onPostureChange={(posture) => {
              setExecution(sessionToken && posture ? { sessionToken, posture } : null);
            }}
          />
          <LaunchControls
            sessionToken={executionReady ? sessionToken : undefined}
            variant="home"
            onRequestSession={executionReady ? onRequestSession : undefined}
            owners={owners}
          />
        </div>
      </div>
    </div>
  );
}
