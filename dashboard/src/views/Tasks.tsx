/**
 * Reusable card-approval surface. The Inbox imports this component rather than reimplementing the
 * governed gate, routing, inert markdown, metadata, or U5 click-out behavior that previously lived in
 * the retired Tasks destination.
 *
 * SECURITY: a card's body — `## Work order` / `## Evidence` / `## Result` — is INERT data. It is passed
 * verbatim to {@link renderMarkdown}, which HTML-escapes the whole source before applying any transform,
 * so nothing in a card can become live markup or an instruction. This view RENDERS card content; it
 * never interprets it.
 *
 * Data is supplied by the unified Inbox so `/api/index` and `/api/inbox` share one SSE refresh and one
 * dedupe decision. This module owns presentation and governed card actions only.
 */
import { useEffect, useMemo, useState, useCallback } from 'react';
import type { CardProjection, ParsedCard, CardFieldValue } from '../../server/planeA/cards';
import { EntityName } from '../components/EntityName';
import { humanizeEntityId } from '../entity/humanizeEntityId';
import { useSession } from '../lib/sessionContext';
import { recencyLabel } from '../lib/relativeAge.ts';
import type { CardsByState } from '../lib/cardIndexClient.ts';
import {
  EMPTY_ROUTING,
  fetchRouting,
  postCardRouting,
  type RoutingSnapshot,
  type CardRoutingView,
} from '../lib/routingClient';
import { RoutingControl } from './routingControls';
import { renderMarkdown } from '../lib/markdown';
import { classifyCardGate, type CardGateItem } from '../../server/tasks/cardProjection';
import {
  respondToCard,
  verifyApproval,
  type ApprovalChannel,
  type RespondAction,
} from '../lib/taskActionsClient';
import '../styles/views/tasks.css';

export type { CardsByState } from '../lib/cardIndexClient.ts';

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

function tierClass(tier: string): '' | 'mc-badge--t1' | 'mc-badge--t2' | 'mc-badge--t3' {
  if (/3/.test(tier)) return 'mc-badge--t3';
  if (/2/.test(tier)) return 'mc-badge--t2';
  if (/1/.test(tier)) return 'mc-badge--t1';
  return '';
}

const RISK_TIER_LABELS = {
  T1: 'Low risk',
  T2: 'Medium risk',
  T3: 'High risk',
} as const;

function riskTierLabel(tier: string): string {
  return RISK_TIER_LABELS[tier as keyof typeof RISK_TIER_LABELS] ?? tier;
}

function fieldStr(v: CardFieldValue | undefined): string {
  if (v === null || v === undefined) return '—';
  if (Array.isArray(v)) return v.length ? v.join(', ') : '[]';
  return String(v);
}

const CONTROL_PREFIX = /^(?:wake-me|needs?-?input|human-?input|input-?required|question|human-?review|review-?required|approve|decide|cadence)$/i;

interface TaskPresentation {
  title: string;
  cue: 'Review' | 'Reply' | 'Resolve' | 'Decide' | 'Watch' | 'Waiting' | null;
  needsAction: boolean;
  summary: string;
  gate: CardGateItem | null;
}

/** Turn the dispatcher action phrase into a readable title without changing its stored value. */
function plainTaskTitle(card: CardProjection): string {
  const raw = card.displayName.trim() || fieldStr(card.meta.action);
  const [prefix, ...rest] = raw.split(':');
  const subject = rest.length > 0 && CONTROL_PREFIX.test(prefix) ? rest.join(' ') : raw;
  const readable = humanizeEntityId(subject.replace(/[:/.]+/g, '-'));
  return readable || 'Untitled task';
}

function calmStateSummary(state: string): string {
  switch (state) {
    case 'inbox': return 'Queued and ready to start.';
    case 'working': return 'Work is underway.';
    case 'blocked': return 'Waiting for a dependency or guidance.';
    case 'approved': return 'Approved and ready for its next stage.';
    case 'rejected': return 'Stopped at a decision boundary.';
    case 'done': return 'Work is complete.';
    case 'stop-requested':
    case 'halting': return 'A requested stop is still winding down.';
    case 'halted': return 'The run stopped and is ready for review.';
    default: return `Currently ${humanizeEntityId(state)}.`;
  }
}

function plainGateSummary(gate: CardGateItem, state: string, cue: TaskPresentation['cue']): string {
  if (cue === 'Review') return 'This task is waiting for your decision.';
  if (cue === 'Reply') return 'The owner needs your input before work can continue.';
  if (cue === 'Resolve' && state === 'halted') return 'This stopped run needs your review and resolution.';
  if (cue === 'Resolve') return 'An agent needs your guidance before work can continue.';
  if (cue === 'Decide') return 'No agent can move this task until you decide.';
  if (cue === 'Waiting') return 'Your reply is recorded; the owner still needs to pick it up.';
  if (cue === 'Watch') return gate.status;
  return gate.reason;
}

/** One presentation vocabulary for both the list row and selected-card summary. */
function presentTask(card: CardProjection): TaskPresentation {
  const state = String(card.meta.state).toLowerCase();
  const gate = classifyCardGate(card);
  let cue: TaskPresentation['cue'] = null;

  if (gate) {
    if (gate.status === 'Reply recorded') cue = 'Waiting';
    else if (state === 'approvals') cue = 'Review';
    else if (gate.respond === 'reply') cue = 'Reply';
    else if (gate.respond === 'resolve') cue = 'Resolve';
    else if (gate.label === 'Gate') cue = 'Decide';
    else cue = 'Watch';
  }

  return {
    title: plainTaskTitle(card),
    cue,
    needsAction: cue !== null && cue !== 'Watch' && cue !== 'Waiting',
    summary: gate ? plainGateSummary(gate, state, cue) : calmStateSummary(state),
    gate,
  };
}

/** The ONE card list used for both rendering and Inbox escalation dedupe. Actionable decisions precede
 * watch/wait rows; within each tier, the newest file projection comes first. */
export function cardsNeedingHuman(cards: CardsByState): CardProjection[] {
  return Object.values(cards).flat()
    .filter((card) => classifyCardGate(card) !== null)
    .sort((left, right) => {
      const actionOrder = Number(presentTask(right).needsAction) - Number(presentTask(left).needsAction);
      if (actionOrder !== 0) return actionOrder;
      const rightTime = Date.parse(right.updatedAt ?? '');
      const leftTime = Date.parse(left.updatedAt ?? '');
      return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
    });
}

/** Ordered [key, value] pairs for the frontmatter block: preferred keys first, then the rest. */
function orderedFields(card: ParsedCard): Array<[string, string]> {
  const seen = new Set<string>();
  const out: Array<[string, string]> = [];
  for (const key of FIELD_ORDER) {
    if (key in card.meta) {
      const value = fieldStr(card.meta[key]);
      out.push([key, key === 'risk-tier' ? riskTierLabel(value) : value]);
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
  const tierLabel = riskTierLabel(tier);
  const cls = tierClass(tier);
  const presentation = presentTask(card);
  const owner = card.meta.owner == null || String(card.meta.owner).trim() === ''
    ? null
    : humanizeEntityId(String(card.meta.owner));
  return (
    <li
      role="button"
      className={`inbox__row inbox__row--card v-tasks__row${selected ? ' inbox__row--selected v-tasks__row--selected' : ''}`}
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
      <div className="inbox__row-main v-tasks__cell-summary">
        <div className="v-tasks__task-line">
          {presentation.cue ? (
            <span className={`v-tasks__action-cue${presentation.needsAction ? ' v-tasks__action-cue--needed' : ''}`}>
              {presentation.cue}
            </span>
          ) : null}
          <span className="v-tasks__task-title">{presentation.title}</span>
        </div>
        <p className="v-tasks__task-summary">{presentation.summary}</p>
        <div className="inbox__meta v-tasks__task-meta" aria-label="Card recency, owner, and risk">
          <span>{recencyLabel('Updated', card.updatedAt)}</span>
          <span>{owner ? `Owner ${owner}` : 'No one assigned yet'}</span>
          {tier && tier !== '—' ? (
            <span className={`mc-badge${cls ? ` ${cls}` : ''}`} aria-label={tierLabel}>{tierLabel}</span>
          ) : null}
        </div>
      </div>
    </li>
  );
}

/** Per-card routing bar (R2.3): stamped runtime/model chips (or "unrouted"), effective-if-redispatched,
 *  and a governed card-scope override toggle. Card frontmatter is the TOP-precedence routing input. */
export function CardRoutingBar({
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
        <span className="v-routing-bar__unrouted mc-mono">not routed</span>
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

/**
 * spec §5 — where a card's gate is actually ANSWERED.
 *
 * The unified Inbox row opens this detail beside the list, because a decision needs the card's work
 * order, frontmatter, and body around it. The verify channels and reply/resolve box stay beside that
 * governed context. The predicate is the SAME projection the Inbox lists from, never a second opinion
 * about what needs a human.
 */
export function CardGate({
  item,
  busy,
  draft,
  onDraftChange,
  onVerify,
  onRespond,
}: {
  item: CardGateItem;
  busy: boolean;
  draft: string;
  onDraftChange: (value: string) => void;
  onVerify: (channel: ApprovalChannel) => void;
  onRespond: (action: RespondAction, message: string) => void;
}): React.JSX.Element {
  return (
    <section className="v-tasks__gate" aria-label="Waiting on you" data-testid="card-gate">
      <p className="v-tasks__eyebrow">{item.label}</p>
      <h3 className="v-tasks__gate-head">{item.status}</h3>
      <p className="v-tasks__gate-reason">{item.reason}</p>
      <p className="v-tasks__gate-next"><strong>Next action</strong> {item.nextAction}</p>

      {item.respond ? (
        <div className="v-tasks__respond" data-testid="respond-form">
          <label className="v-tasks__field-label" htmlFor="respond-message">
            {item.respond === 'reply' ? 'Reply to the owning agent' : 'Resolution note'}
          </label>
          <textarea
            id="respond-message"
            className="v-tasks__respond-input"
            data-testid="respond-message"
            rows={4}
            maxLength={16000}
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            placeholder={item.respond === 'reply'
              ? 'Your note is appended to the card and it stays queued for pickup.'
              : 'Recorded on the card as an operator resolution.'}
          />
          <div className="v-tasks__buttons">
            <button
              type="button"
              className="mc-btn mc-btn--primary"
              data-testid="respond-submit"
              disabled={draft.trim().length === 0 || busy}
              onClick={() => onRespond(item.respond as RespondAction, draft.trim())}
            >
              {item.respond === 'reply' ? 'Send reply' : 'Resolve'}
            </button>
          </div>
        </div>
      ) : null}

      {item.buttons ? (
        <>
          <p className="v-tasks__truth-note" role="note">
            Verifying evidence only records your check — it doesn't start or finish the work.
          </p>
          <div className="v-tasks__buttons">
            {item.buttons.signed ? (
              <button type="button" className="mc-btn mc-btn--primary" disabled={busy} onClick={() => onVerify('signed')}>
                Verify evidence (signed)
              </button>
            ) : null}
            {item.buttons.possession ? (
              <button type="button" className="mc-btn" disabled={busy} onClick={() => onVerify('possession')}>
                Verify evidence (possession)
              </button>
            ) : null}
            {item.buttons.webauthn ? (
              <button type="button" className="mc-btn mc-btn--primary" disabled={busy} onClick={() => onVerify('webauthn')}>
                Verify evidence (WebAuthn)
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}

function DetailPane({
  card,
  presentation,
  gate,
  routingView,
  registry,
  onApplyRouting,
  onClearRouting,
  onClose,
}: {
  card: CardProjection;
  presentation: TaskPresentation;
  /** The gate block, when this card is one of the things waiting on a person. */
  gate: React.ReactNode;
  routingView: CardRoutingView | undefined;
  registry: RoutingSnapshot['policy']['runtimes'];
  onApplyRouting: (cardId: string, runtime: string, model: string) => Promise<{ ok: boolean; reason?: string }>;
  onClearRouting: (cardId: string) => Promise<{ ok: boolean; reason?: string }>;
  onClose: () => void;
}): React.JSX.Element {
  const fields = orderedFields(card);
  const body = card.body.trim();
  const cardId = String(card.meta.id);
  return (
    <aside className="v-tasks__detail" aria-label="Card detail">
      <button type="button" className="v-tasks__back mc-btn" onClick={onClose}>
        <span aria-hidden="true">←</span> Back to Inbox
      </button>

      <header className="v-tasks__detail-head">
        <h2 className="v-tasks__detail-title">{presentation.title}</h2>
        <p className="v-tasks__detail-summary">
          {presentation.cue ? <strong>{presentation.cue}</strong> : null}
          <span>{presentation.summary}</span>
        </p>
      </header>

      {gate}

      {body ? (
        <section className="v-tasks__brief" aria-label="Task brief">
          <div
            className="v-tasks__body"
            // Inert: renderMarkdown HTML-escapes the whole source before any transform (see markdown.ts).
            dangerouslySetInnerHTML={{ __html: renderMarkdown(card.body) }}
          />
        </section>
      ) : (
        <p className="mc-empty">This card has no body.</p>
      )}

      <section className="v-tasks__metadata" aria-label="Card details">
        <h3 className="v-tasks__metadata-title">Card details</h3>
        <div className="v-tasks__technical-id">
          <span className="v-tasks__technical-label">Card reference</span>
          <EntityName kind="card" id={cardId} displayName={card.displayName} shortRef={card.shortRef} muted />
        </div>
        <p className="v-tasks__detail-caption">
          Routing, card identifiers, and all stored details. Card content is shown as read-only text.
        </p>

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
      </section>
    </aside>
  );
}

/** Re-housed card list for Inbox. Per-card routing still comes from `/api/routing`; the card-scope
 * toggle writes frontmatter through the same governed, audited endpoint. */
export function CardApprovals({
  data,
  routing,
  initialSelectedId,
  fetchImpl,
  onRefresh,
}: {
  data: CardsByState;
  routing?: RoutingSnapshot;
  /** Card id opened by Inbox/card deep links. */
  initialSelectedId?: string;
  /** Injected for tests; the gate's governed writes use the real `fetch` in production. */
  fetchImpl?: typeof fetch;
  /** Re-read both Inbox projections after a governed card write. */
  onRefresh?: () => void;
}): React.JSX.Element {
  const { requireSession } = useSession();
  const [routingState, setRoutingState] = useState<RoutingSnapshot | null>(routing ?? null);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null);
  const [gateDraft, setGateDraft] = useState('');
  const [gateBusy, setGateBusy] = useState(false);
  const [gateOutcome, setGateOutcome] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const closeDetail = useCallback(() => setSelectedId(null), []);
  const selectTask = useCallback((id: string) => {
    setSelectedId((current) => current === id ? null : id);
  }, []);

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

  const cards = data;
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

  const attentionCards = useMemo(() => cardsNeedingHuman(cards), [cards]);

  // Deep links may target an ordinary card from a run/agent/asset surface. It stays out of the
  // human-only list, but its full governed detail must remain reachable.
  const byId = useMemo(() => {
    const m = new Map<string, CardProjection>();
    for (const bucket of Object.values(cards)) {
      for (const card of bucket) m.set(String(card.meta.id), card);
    }
    return m;
  }, [cards]);

  const selected = selectedId ? byId.get(selectedId) ?? null : null;

  useEffect(() => {
    if (!selectedId) return;
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeDetail();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [closeDetail, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    const closeOnOutsideClick = (event: MouseEvent): void => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('.v-tasks__detail, .v-tasks__row')) return;
      closeDetail();
    };
    document.addEventListener('click', closeOnOutsideClick);
    return () => document.removeEventListener('click', closeOnOutsideClick);
  }, [closeDetail, selectedId]);

  useEffect(() => {
    setSelectedId(initialSelectedId ?? null);
  }, [initialSelectedId]);

  // A fresh selection clears any half-typed response — the box is always scoped to the visible card.
  useEffect(() => {
    setGateDraft('');
    setGateOutcome(null);
  }, [selectedId]);

  /**
   * Is the selected card one of the things waiting on a person, and what may the operator do about it?
   *
   * Answered by the SAME projection the Inbox lists from, run over this one card — a second predicate
   * here is exactly how the two surfaces would come to disagree about what needs Daniel.
   */
  const selectedPresentation = useMemo(() => selected ? presentTask(selected) : null, [selected]);
  const gateItem = selectedPresentation?.gate ?? null;

  /**
   * One governed click on a card gate: reuse the live bearer, else run the app's ONE passkey ceremony,
   * and replace a bearer the server invalidated (401) exactly ONCE before retrying. Never a loop, never
   * a silent downgrade — the same rule the Inbox container used to carry for these two writes.
   */
  const governCard = async (
    label: string,
    call: (token: string) => Promise<{ ok: boolean; reason: string; status: number; liveness?: { online: boolean } }>,
  ): Promise<void> => {
    if (gateBusy) return;
    setGateBusy(true);
    setGateOutcome(null);
    try {
      let token = (await requireSession())?.token;
      if (!token) {
        setGateOutcome({ kind: 'error', message: `The dashboard is locked — ${label} was not sent.` });
        return;
      }
      let result = await call(token);
      if (result.status === 401) {
        const replacement = await requireSession();
        if (replacement && replacement.token !== token) {
          token = replacement.token;
          result = await call(token);
        }
      }
      const name = selected?.displayName ?? 'this card';
      if (!result.ok) {
        setGateOutcome({
          kind: 'error',
          message: result.reason ? `${name} was not updated: ${result.reason}` : `${name} was not updated (HTTP ${result.status}).`,
        });
        return;
      }
      // A reply COMMITS here, but it only PROGRESSES if a runner picks the card up. When the server says
      // no consumer is online, say so plainly rather than implying delivery.
      const offline = result.liveness && !result.liveness.online;
      const owner = typeof selected?.meta.owner === 'string' && selected.meta.owner ? `\`${selected.meta.owner}\`` : 'its owner';
      setGateOutcome({
        kind: 'success',
        message: offline
          ? `${name}: ${label} recorded and committed. No runner is online for ${owner} — this card will not progress until one runs.`
          : `${name}: ${label} recorded and committed.`,
      });
      setGateDraft('');
      onRefresh?.();
    } catch (cause) {
      setGateOutcome({ kind: 'error', message: cause instanceof Error ? cause.message : `${label} was refused.` });
    } finally {
      setGateBusy(false);
    }
  };

  return (
    <div
      className="v-tasks"
      aria-label="Approval cards"
    >
      <div className="v-tasks__groups">
        <ul className="inbox__list v-tasks__list" aria-label="Cards needing you">
          {attentionCards.map((card) => (
            <CardRow
              key={String(card.meta.id)}
              card={card}
              selected={String(card.meta.id) === selectedId}
              onSelect={selectTask}
            />
          ))}
        </ul>
      </div>

      {selected && selectedPresentation ? (
        <DetailPane
          card={selected}
          presentation={selectedPresentation}
          gate={gateItem ? (
            <>
              {gateOutcome ? (
                <p
                  className={`v-tasks__outcome v-tasks__outcome--${gateOutcome.kind}`}
                  role={gateOutcome.kind === 'error' ? 'alert' : 'status'}
                >
                  {gateOutcome.message}
                </p>
              ) : null}
              <CardGate
                item={gateItem}
                busy={gateBusy}
                draft={gateDraft}
                onDraftChange={setGateDraft}
                onVerify={(channel) => void governCard('verification', (token) =>
                  verifyApproval(String(selected.meta.id), channel, { token, fetchImpl }))}
                onRespond={(action, message) => void governCard(action === 'reply' ? 'reply' : 'resolution', (token) =>
                  respondToCard(String(selected.meta.id), action, message, { token, fetchImpl }))}
              />
            </>
          ) : null}
          routingView={routingSnap.cards[String(selected.meta.id)]}
          registry={routingSnap.policy.runtimes}
          onApplyRouting={applyCardRouting}
          onClearRouting={clearCardRouting}
          onClose={closeDetail}
        />
      ) : attentionCards.length > 0 ? (
        <aside className="v-tasks__placeholder" aria-label="Card detail">
          Select a card to see what it needs and why.
        </aside>
      ) : null}
    </div>
  );
}
