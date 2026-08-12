/**
 * The Human Inbox — spec §5. ONE list, and nothing else.
 *
 * What this view used to be: five summary tiles over three items, a row list, a pick-something-first
 * placeholder pane, a detail panel that answered gates inline with no context around them, and a
 * SECOND panel wall underneath for run requests. Four surfaces for one question.
 *
 * What it is now: the list IS the view. Each row says, in one plain line, what needs the operator; the
 * row is a link into the surface that OWNS that gate — the run (stream tiles, transcript, the gate
 * strip with the run in front of you) or the card (frontmatter, body, its verify/respond block). Gates
 * are answered THERE, with context, never from a row that shows none. So this file holds no write path
 * at all: it takes rows and renders them.
 *
 * The list is a pure projection of live state. Nothing here records that an item was "handled" — when
 * any writer (a kb agent, a terminal, another tab) moves the card or run out of a needs-human state,
 * the item stops being produced and the row disappears on the next SSE tick. Dashboard-side resolution
 * bookkeeping is exactly how this surface used to disagree with queue truth, so there is none.
 */
import type { HumanInboxCategory, HumanInboxItem, HumanInboxUrgency } from '../../server/approvals/humanInbox';
import { EntityName, type EntityKind } from '../components/EntityName';
import { entityRowProps } from '../components/entityRow';
import { cardLink, runLink } from '../control/entityLinks';
import { relativeAge, timestampLabel } from '../control/runEvents';
import type { NavTarget } from '../nav/stack';
import '../styles/views/approvals.css';

/** One thing waiting on the operator, wherever it came from. Cards and run asks are the same shape. */
export interface InboxRow {
  /** React key. Card id or Human Request ref — never rendered. */
  key: string;
  /** The plain-language line: what needs you. Card action, or the server-built run `ask`. */
  ask: string;
  /** Risk tier chip text (`T1`/`T2`/`T3`), or null when the source carries no tier. */
  tier: string | null;
  category: HumanInboxCategory;
  categoryLabel: string;
  urgency: HumanInboxUrgency;
  /** The entity the row names, rendered through EntityName — never a raw id in primary text. */
  entity: { kind: EntityKind; id: string; displayName: string; shortRef: number };
  /** Where the gate is actually addressed, with context. */
  target: NavTarget;
  /**
   * When this ask was filed — a card's id-epoch prefix (`cards.new_id`, same convention as
   * `server/approvals/humanInbox.ts#cardAgeMs`), or the server's own `createdAt` for a run ask. Null only
   * for a legacy/hand-authored card id that carries no epoch. Drives the "time added" readout and the
   * newest-first tiebreak in {@link inboxRows}.
   */
  createdAt: string | null;
}

/** A run that needs the operator: one open request, or a run parked with no request at all. */
export interface RunAskRow {
  requestRef: string;
  runRef: string;
  displayName: string;
  shortRef: number;
  ask: string;
  tier: 'T2' | 'T3';
  category: HumanInboxCategory;
  categoryLabel: 'Gate' | 'Input' | 'Intervention';
  urgency: HumanInboxUrgency;
  /** The request's own `createdAt` (or the run's, for the synthetic "parked with nothing to answer" row). */
  createdAt: string;
}

function tierRank(tier: string | null): number {
  const match = /t\s*([0-9]+)/i.exec(tier ?? '');
  return match ? Number(match[1]) : 0;
}

function urgencyRank(urgency: HumanInboxUrgency): number {
  return urgency === 'critical' ? 0 : urgency === 'high' ? 1 : urgency === 'normal' ? 2 : 3;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '');
}

/** `cards.new_id` prefixes every id with an 8-hex-digit unix-epoch-seconds stamp — the same convention
 *  `server/approvals/humanInbox.ts#cardAgeMs` reads server-side. Decoded here too so a card row can carry
 *  a "time added" without a wire change: the id is already on every card DTO. Null for a non-matching
 *  (legacy/hand-authored) id, exactly like the server-side reader. */
const CARD_ID_EPOCH_RE = /^([0-9a-f]{8})-/;
function cardCreatedAt(id: string): string | null {
  const match = CARD_ID_EPOCH_RE.exec(id);
  if (!match) return null;
  const epochSec = parseInt(match[1] as string, 16);
  return Number.isFinite(epochSec) ? new Date(epochSec * 1000).toISOString() : null;
}

/**
 * Merge the two feeds into the one ordered list.
 *
 * Card items keep their action as the line (`deploy:prod` IS what needs deciding); run asks carry the
 * server's plain-language sentence. Ordering is the pre-existing law — urgency, then tier, then
 * category — applied across BOTH sources so a T3 run gate cannot hide under a T1 card.
 */
export function inboxRows(cards: HumanInboxItem[], runAsks: RunAskRow[] = []): InboxRow[] {
  const fromCards: InboxRow[] = cards.map((item) => ({
    key: `card:${text(item.card.meta.id)}`,
    ask: [text(item.card.meta.action), text(item.card.meta.target)].filter(Boolean).join(' · ')
      || item.card.displayName,
    tier: text(item.card.meta['risk-tier']) || null,
    category: item.category,
    categoryLabel: item.categoryLabel,
    urgency: item.urgency,
    entity: {
      kind: 'card',
      id: text(item.card.meta.id),
      displayName: item.card.displayName,
      shortRef: item.card.shortRef,
    },
    target: cardLink(text(item.card.meta.id)),
    createdAt: cardCreatedAt(text(item.card.meta.id)),
  }));
  const fromRuns: InboxRow[] = runAsks.map((ask) => ({
    key: `run:${ask.requestRef}`,
    ask: ask.ask,
    tier: ask.tier,
    category: ask.category,
    categoryLabel: ask.categoryLabel,
    urgency: ask.urgency,
    entity: { kind: 'run', id: ask.runRef, displayName: ask.displayName, shortRef: ask.shortRef },
    target: runLink(ask.runRef),
    createdAt: ask.createdAt,
  }));
  return [...fromCards, ...fromRuns].sort((a, b) => {
    if (a.urgency !== b.urgency) return urgencyRank(a.urgency) - urgencyRank(b.urgency);
    const tier = tierRank(b.tier) - tierRank(a.tier);
    if (tier !== 0) return tier;
    // Newest-first tiebreak: two items at the same urgency and tier are equally actionable by that law,
    // so the one that showed up most recently — the one most likely to still need a fresh look — leads.
    const at = a.createdAt ? Date.parse(a.createdAt) : NaN;
    const bt = b.createdAt ? Date.parse(b.createdAt) : NaN;
    if (!Number.isNaN(at) && !Number.isNaN(bt) && at !== bt) return bt - at;
    return a.categoryLabel.localeCompare(b.categoryLabel);
  });
}

export interface ApprovalsProps {
  rows: InboxRow[];
  /** Open the surface that owns a gate. Absent in a bare render; then rows are inert text. */
  onNavigate?: (target: NavTarget) => void;
  /**
   * True when the tab's session is locked, so run-side asks (which need it) are not in `rows` at all.
   * Renders an explicit notice instead of the old silent gap — a locked tab must say gated items may
   * exist, never look identical to "nothing is waiting".
   */
  locked?: boolean;
}

function InboxRowView({ row, onNavigate }: { row: InboxRow; onNavigate?: (target: NavTarget) => void }): React.JSX.Element {
  const tier = tierRank(row.tier);
  const rowClass = [
    'v-approvals__row',
    tier >= 3 ? 'v-approvals__row--t3' : '',
    row.urgency === 'high' || row.urgency === 'critical' ? 'v-approvals__row--urgent' : '',
  ].filter(Boolean).join(' ');
  return (
    <li key={row.key}>
      <div
        className={rowClass}
        data-testid={`inbox-row-${row.key}`}
        aria-label={`Open ${row.entity.displayName}`}
        {...entityRowProps(() => onNavigate?.(row.target))}
      >
        <span className="v-approvals__row-copy">
          {/* The plain line leads; the entity names WHERE it lives; the id is behind the tooltip. */}
          <span className="v-approvals__row-action">{row.ask}</span>
          <span className="v-approvals__row-id">
            <EntityName
              kind={row.entity.kind}
              id={row.entity.id}
              displayName={row.entity.displayName}
              shortRef={row.entity.shortRef}
              muted
            />
          </span>
        </span>
        <span className="v-approvals__row-meta">
          <span className={`v-approvals__category v-approvals__category--${row.category}`}>
            {row.categoryLabel}
          </span>
          {row.tier ? (
            <span className={`v-approvals__row-badge mc-badge mc-badge--t${tier || 1}`}>{row.tier}</span>
          ) : null}
          {row.createdAt ? (
            <span className="v-approvals__row-time" title={timestampLabel(row.createdAt)}>
              {relativeAge(row.createdAt)}
            </span>
          ) : null}
        </span>
      </div>
    </li>
  );
}

export function Approvals({ rows, onNavigate, locked }: ApprovalsProps): React.JSX.Element {
  // A locked tab hides run-side asks entirely upstream (they need the session); this is the one place
  // that says so out loud instead of letting the list look complete with a silent gap in it. It points at
  // the app's ONE standing unlock affordance (the top-bar chip) rather than growing a second unlock here.
  const lockedNotice = locked ? (
    <p className="v-approvals__notice" data-testid="approvals-locked-notice" role="status">
      This tab is locked — run-side requests are hidden until you unlock it. Use Unlock in the top bar to see and answer them.
    </p>
  ) : null;

  if (rows.length === 0) {
    return (
      <div className="v-approvals" aria-label="Human Inbox">
        {lockedNotice}
        <div className="v-approvals__empty" data-testid="approvals-empty">
          <p className="v-approvals__empty-title">No human attention waiting</p>
          <p className="v-approvals__empty-sub">Decisions, operator gates, questions, wake-me cards, and halted runs will appear here.</p>
        </div>
      </div>
    );
  }

  // Triage: an item at `urgency: 'low'` (a replied input awaiting agent pickup, or a stranded/owned-but-
  // not-progressing card) has nothing left for the operator to DO right now. Splitting it into a
  // collapsed section — rather than interleaving it by tier the way the ranking otherwise would — is what
  // makes "which ones I need to address" obvious at a glance instead of requiring a full read of the list.
  const actionable = rows.filter((row) => row.urgency !== 'low');
  const stale = rows.filter((row) => row.urgency === 'low');

  return (
    <div className="v-approvals" aria-label="Human Inbox">
      {lockedNotice}
      {actionable.length > 0 ? (
        <>
          <p className="v-approvals__list-head">Needs you · {actionable.length}</p>
          <ul className="v-approvals__list">
            {actionable.map((row) => <InboxRowView key={row.key} row={row} onNavigate={onNavigate} />)}
          </ul>
        </>
      ) : null}
      {stale.length > 0 ? (
        <details className="v-approvals__stale" data-testid="approvals-stale-section">
          <summary>Older / stale · {stale.length}</summary>
          <ul className="v-approvals__list">
            {stale.map((row) => <InboxRowView key={row.key} row={row} onNavigate={onNavigate} />)}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
