/**
 * Tasks view (U3) — the whole card queue on one surface: every card across the four physical queue
 * dirs, grouped by lifecycle state (inbox / working / approvals / done, plus blocked / approved /
 * rejected when populated). A two-pane layout: LEFT a dense state-grouped table (mono id, action, tier
 * badge, owner, project, a per-state status dot); RIGHT a detail pane that opens on selection showing
 * the card's full frontmatter as a mono key/value block and its body sections rendered through the
 * existing safe markdown renderer.
 *
 * SECURITY: a card's body — `## Work order` / `## Evidence` / `## Result` — is INERT data. It is passed
 * verbatim to {@link renderMarkdown}, which HTML-escapes the whole source before applying any transform,
 * so nothing in a card can become live markup or an instruction. This view RENDERS card content; it
 * never interprets it.
 *
 * Read-only: self-fetches the Plane-A snapshot (`/api/index`) once on mount and reads its `cards`
 * projection (already grouped by state server-side). On fetch failure it degrades to calm per-group
 * empty states rather than crashing the shell. The App routes `tasks` to a placeholder today; this view
 * stands alone until the integrator adds the `case`.
 */
import { useEffect, useMemo, useState, useCallback } from 'react';
import type { CardProjection, ParsedCard, CardFieldValue } from '../../server/planeA/cards';
import { EntityName } from '../components/EntityName';
import type { PlaneAIndex } from '../../server/planeA/indexer';
import { useSession } from '../lib/sessionContext';
import {
  EMPTY_ROUTING,
  fetchRouting,
  postCardRouting,
  type RoutingSnapshot,
  type CardRoutingView,
} from '../lib/routingClient';
import { RoutingControl } from './routingControls';
import { renderMarkdown } from '../lib/markdown';
import '../styles/views/tasks.css';

/** Cards grouped by state — the shape of `PlaneAIndex.cards`. */
export type CardsByState = Record<string, CardProjection[]>;

type DotKind = 'idle' | 'running' | 'blocked' | 'done' | 'error';

/** Canonical render order + per-state label/status-dot. Escalating along the lifecycle. */
const STATE_META: Record<string, { label: string; dot: DotKind }> = {
  inbox: { label: 'Inbox', dot: 'idle' },
  working: { label: 'Working', dot: 'running' },
  blocked: { label: 'Blocked', dot: 'blocked' },
  approvals: { label: 'Approvals', dot: 'running' },
  approved: { label: 'Approved', dot: 'done' },
  rejected: { label: 'Rejected', dot: 'error' },
  done: { label: 'Done', dot: 'done' },
  'stop-requested': { label: 'Stop requested', dot: 'running' },
  halting: { label: 'Halting', dot: 'running' },
  halted: { label: 'Halted', dot: 'error' },
};

/** The order groups appear in. */
const STATE_ORDER = ['inbox', 'working', 'stop-requested', 'halting', 'halted', 'blocked', 'approvals', 'approved', 'rejected', 'done'];

/** Operational buckets that ALWAYS render a header (with a calm empty line when they hold nothing) —
 *  the operator should always see the shape of the queue. Others appear only when populated. */
const PRIMARY_STATES = new Set(['inbox', 'working', 'approvals', 'done']);

/** Frontmatter keys shown first, in this order; any remaining keys follow in insertion order. */
const FIELD_ORDER = ['id', 'action', 'target', 'risk-tier', 'owner', 'state', 'project', 'depends-on'];

/** Mirror the server lifecycle guard. Only blocked cards and unowned inbox drafts are safely mutable. */
export function cardRoutingLockReason(state: string, owner: unknown): string | null {
  if (state === 'blocked') return null;
  if (state === 'inbox' && (owner === null || owner === undefined || owner === '')) return null;
  if (state === 'inbox') return 'assigned and queued — the runner may already be active; use a successor attempt';
  if (['working', 'stop-requested', 'halting'].includes(state)) {
    return 'active or stopping — routing is fixed for this attempt';
  }
  if (state === 'approvals' || state === 'approved') {
    return 'under approval — routing is frozen with the reviewed scope';
  }
  if (['done', 'rejected', 'halted'].includes(state)) {
    return 'historical attempt — retry with new routing';
  }
  return `state ${state} is not safely reroutable`;
}

const EMPTY: CardsByState = {};

function tierClass(tier: string): '' | 'mc-badge--t1' | 'mc-badge--t2' | 'mc-badge--t3' {
  if (/3/.test(tier)) return 'mc-badge--t3';
  if (/2/.test(tier)) return 'mc-badge--t2';
  if (/1/.test(tier)) return 'mc-badge--t1';
  return '';
}

function fieldStr(v: CardFieldValue | undefined): string {
  if (v === null || v === undefined) return '—';
  if (Array.isArray(v)) return v.length ? v.join(', ') : '[]';
  return String(v);
}

/** Ordered [key, value] pairs for the frontmatter block: preferred keys first, then the rest. */
function orderedFields(card: ParsedCard): Array<[string, string]> {
  const seen = new Set<string>();
  const out: Array<[string, string]> = [];
  for (const key of FIELD_ORDER) {
    if (key in card.meta) {
      out.push([key, fieldStr(card.meta[key])]);
      seen.add(key);
    }
  }
  for (const [key, value] of Object.entries(card.meta)) {
    if (!seen.has(key)) out.push([key, fieldStr(value)]);
  }
  return out;
}

function CardRow({
  card,
  selected,
  onSelect,
}: {
  card: CardProjection;
  selected: boolean;
  onSelect: (id: string) => void;
}): React.JSX.Element {
  const id = String(card.meta.id);
  const tier = fieldStr(card.meta['risk-tier']);
  const owner = card.meta.owner;
  const project = fieldStr(card.meta.project);
  const cls = tierClass(tier);
  return (
    <tr
      className={`v-tasks__row${selected ? ' v-tasks__row--selected' : ''}`}
      aria-selected={selected}
      tabIndex={0}
      data-testid={`task-row-${id}`}
      onClick={() => onSelect(id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(id);
        }
      }}
    >
      {/* The card's name, not its id: the id stays reachable through the tooltip + copy affordance. */}
      <td className="v-tasks__cell-id">
        <EntityName kind="card" id={id} displayName={card.displayName} shortRef={card.shortRef} />
      </td>
      <td className="v-tasks__cell-action">{fieldStr(card.meta.action)}</td>
      <td className="v-tasks__cell-tier">
        {cls ? <span className={`mc-badge ${cls}`}>{tier}</span> : null}
      </td>
      <td className={`v-tasks__cell-owner mc-mono${owner == null ? ' v-tasks__cell--faint' : ''}`}>
        {owner == null ? '—' : String(owner)}
      </td>
      <td className="v-tasks__cell-project mc-mono">{project}</td>
    </tr>
  );
}

function StateGroup({
  state,
  cards,
  selectedId,
  onSelect,
}: {
  state: string;
  cards: CardProjection[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}): React.JSX.Element {
  const meta = STATE_META[state] ?? { label: state, dot: 'idle' as DotKind };
  return (
    <section className="v-tasks__group" aria-label={`${meta.label} cards`}>
      <header className="v-tasks__group-head">
        <span className={`mc-status-dot mc-status-dot--${meta.dot}`} aria-hidden="true" />
        <h3 className="v-tasks__group-title">{meta.label}</h3>
        <span className="v-tasks__group-count mc-num">{cards.length}</span>
      </header>
      {cards.length === 0 ? (
        <p className="v-tasks__group-empty">Nothing in {meta.label.toLowerCase()}.</p>
      ) : (
        <table className="v-tasks__table">
          <thead>
            <tr>
              {/* The card's NAME now leads this column; its id lives in the EntityName tooltip. */}
              <th>Card</th>
              <th>Action</th>
              <th>Tier</th>
              <th>Owner</th>
              <th>Project</th>
            </tr>
          </thead>
          <tbody>
            {cards.map((card) => (
              <CardRow
                key={String(card.meta.id)}
                card={card}
                selected={String(card.meta.id) === selectedId}
                onSelect={onSelect}
              />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** Per-card routing bar (R2.3): stamped runtime/model chips (or "unrouted"), effective-if-redispatched,
 *  and a governed card-scope override toggle. Card frontmatter is the TOP-precedence routing input. */
function CardRoutingBar({
  cardId,
  cardName,
  cardState,
  cardOwner,
  view,
  registry,
  onApply,
  onClear,
}: {
  cardId: string;
  /** The card's display name — the aria labels below name the card, never its id. */
  cardName: string;
  cardState: string;
  cardOwner: unknown;
  view: CardRoutingView | undefined;
  registry: RoutingSnapshot['policy']['runtimes'];
  onApply: (runtime: string, model: string) => Promise<{ ok: boolean; reason?: string }>;
  onClear: () => Promise<{ ok: boolean; reason?: string }>;
}): React.JSX.Element {
  const stamped = view?.stamped ?? { runtime: null, model: null };
  const routed = stamped.runtime || stamped.model;
  const lockedReason = cardRoutingLockReason(cardState, cardOwner);
  return (
    <div className="v-routing-bar" data-testid={`card-routing-bar-${cardId}`}>
      <span className="v-routing-bar__label">routing</span>
      {routed ? (
        <span className="v-routing-bar__stamp mc-mono">
          {stamped.runtime ?? '—'} / {stamped.model ?? '—'}
        </span>
      ) : (
        <span className="v-routing-bar__unrouted mc-mono">unrouted (legacy)</span>
      )}
      <span className="v-routing-bar__label">effective routing</span>
      <RoutingControl
        label={cardName}
        testIdPrefix={`card-${cardId}`}
        registry={registry}
        effective={view?.effective ?? null}
        canClear={Boolean(routed)}
        lockedReason={lockedReason}
        onApply={(runtime, model) => onApply(runtime, model)}
        onClear={onClear}
      />
    </div>
  );
}

function DetailPane({
  card,
  routingView,
  registry,
  onApplyRouting,
  onClearRouting,
}: {
  card: CardProjection;
  routingView: CardRoutingView | undefined;
  registry: RoutingSnapshot['policy']['runtimes'];
  onApplyRouting: (cardId: string, runtime: string, model: string) => Promise<{ ok: boolean; reason?: string }>;
  onClearRouting: (cardId: string) => Promise<{ ok: boolean; reason?: string }>;
}): React.JSX.Element {
  const fields = orderedFields(card);
  const body = card.body.trim();
  const cardId = String(card.meta.id);
  return (
    <aside className="v-tasks__detail" aria-label="Card detail">
      <h2 className="v-tasks__detail-id">
        <EntityName kind="card" id={cardId} displayName={card.displayName} shortRef={card.shortRef} />
      </h2>
      <p className="v-tasks__detail-caption">Card content below is rendered as inert data.</p>

      <CardRoutingBar
        cardId={cardId}
        cardName={card.displayName}
        cardState={String(card.meta.state)}
        cardOwner={card.meta.owner}
        view={routingView}
        registry={registry}
        onApply={(runtime, model) => onApplyRouting(cardId, runtime, model)}
        onClear={() => onClearRouting(cardId)}
      />

      <dl className="v-tasks__frontmatter">
        {fields.map(([key, value]) => (
          <div key={key} className="v-tasks__fm-row">
            <dt className="v-tasks__fm-key mc-mono">{key}</dt>
            <dd className="v-tasks__fm-val mc-mono">{value}</dd>
          </div>
        ))}
      </dl>

      {body ? (
        <div
          className="v-tasks__body"
          // Inert: renderMarkdown HTML-escapes the whole source before any transform (see markdown.ts).
          dangerouslySetInnerHTML={{ __html: renderMarkdown(card.body) }}
        />
      ) : (
        <p className="v-tasks__body-empty">This card has no body.</p>
      )}
    </aside>
  );
}

/** Tasks view. Accepts cards-by-state directly (tests) or self-fetches the Plane-A snapshot. Per-card
 *  routing (R2.3) comes from `/api/routing`; the card-scope toggle writes card frontmatter through the
 *  governed, audited card-routing endpoint. */
export function Tasks({
  data,
  routing,
  initialSelectedId,
}: {
  data?: CardsByState;
  routing?: RoutingSnapshot;
  /** Card id to open in the detail pane on mount — used by a card click-through (a run's card graph,
   *  a step's canonical card) so a jump lands on that card's full frontmatter/body/routing surface. */
  initialSelectedId?: string;
} = {}): React.JSX.Element {
  const { requireSession } = useSession();
  const [fetched, setFetched] = useState<CardsByState | null>(null);
  const [routingState, setRoutingState] = useState<RoutingSnapshot | null>(routing ?? null);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null);

  useEffect(() => {
    if (data) return;
    let cancelled = false;
    fetch('/api/index')
      .then((r) => r.json() as Promise<PlaneAIndex>)
      .then((d) => {
        if (!cancelled && d.cards) setFetched(d.cards);
      })
      .catch(() => {
        /* read-only view: on failure keep the empty-safe scaffold, never crash the shell */
      });
    return () => {
      cancelled = true;
    };
  }, [data]);

  const refreshRouting = useCallback(async () => {
    try {
      setRoutingState(await fetchRouting());
    } catch {
      /* keep last-known routing */
    }
  }, []);

  useEffect(() => {
    if (routing) return;
    void refreshRouting();
  }, [routing, refreshRouting]);

  const cards = data ?? fetched ?? EMPTY;
  const routingSnap = routing ?? routingState ?? EMPTY_ROUTING;

  /** Point-of-action unlock: a routing write on a locked tab runs the ONE ceremony first. */
  async function resolveToken(): Promise<string | undefined> {
    return (await requireSession())?.token;
  }

  async function applyCardRouting(cardId: string, runtime: string, model: string): Promise<{ ok: boolean; reason?: string }> {
    const token = await resolveToken();
    if (!token) return { ok: false, reason: 'no session' };
    const res = await postCardRouting({ op: 'set', cardId, runtime, model }, token);
    if (res.ok) await refreshRouting();
    return res;
  }

  async function clearCardRouting(cardId: string): Promise<{ ok: boolean; reason?: string }> {
    const token = await resolveToken();
    if (!token) return { ok: false, reason: 'no session' };
    const res = await postCardRouting({ op: 'clear', cardId }, token);
    if (res.ok) await refreshRouting();
    return res;
  }

  // Flat lookup so selection resolves regardless of which state bucket a card sits in.
  const byId = useMemo(() => {
    const m = new Map<string, CardProjection>();
    for (const bucket of Object.values(cards)) {
      for (const card of bucket) m.set(String(card.meta.id), card);
    }
    return m;
  }, [cards]);

  const selected = selectedId ? byId.get(selectedId) ?? null : null;

  // Render primary states always; extra states only when they hold cards.
  const groups = STATE_ORDER.filter(
    (state) => PRIMARY_STATES.has(state) || (cards[state]?.length ?? 0) > 0,
  );

  return (
    <div className="v-tasks" aria-label="Tasks view">
      <div className="v-tasks__groups">
        {groups.map((state) => (
          <StateGroup
            key={state}
            state={state}
            cards={cards[state] ?? []}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        ))}
      </div>

      {selected ? (
        <DetailPane
          card={selected}
          routingView={routingSnap.cards[String(selected.meta.id)]}
          registry={routingSnap.policy.runtimes}
          onApplyRouting={applyCardRouting}
          onClearRouting={clearCardRouting}
        />
      ) : (
        <aside className="v-tasks__placeholder" aria-label="Card detail">
          Select a card to see its frontmatter and body.
        </aside>
      )}
    </div>
  );
}
