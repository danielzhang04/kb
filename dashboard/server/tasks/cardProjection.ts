/**
 * Read-only projection of the card queue into the operator's Human Inbox.
 *
 * The projection is deliberately conservative. Normal queued work and dependency-blocked DAG stages
 * are not human notifications. Only an approval boundary, an OPERATOR GATE (see {@link isHumanGate}),
 * an explicit human-facing action, a halted run, or an unowned/dependency-free blocked card is
 * surfaced. No item in this feed changes card state.
 *
 * The feed keys on WHO MUST ACT, not on card `state`. Keying on state alone is what hid seven
 * `human-operator` gates — six of them T3, including the OAuth gates blocking all external reach —
 * inside `state: inbox` while this surface reported that nothing was waiting.
 */
import type { ApprovalButtons } from '../approvals/assurance.ts';
import { buttonsFor } from '../approvals/assurance.ts';
import { HUMAN_INPUT_ACTION, WAKE_ACTION } from '../approvals/cardActions.ts';
import { workOrderOf } from '../auth/workOrder.ts';
import type { CardProjection, ParsedCard } from '../planeA/cards.ts';
import type { PlaneAIndex } from '../planeA/indexer.ts';

export type HumanInboxCategory = 'decision' | 'gate' | 'input' | 'intervention' | 'stranded';
export type HumanInboxUrgency = 'critical' | 'high' | 'normal' | 'low';

export interface HumanInboxItem {
  /** Carries the server-owned `displayName`/`shortRef` so the Inbox names the card, not its id. */
  card: CardProjection;
  category: HumanInboxCategory;
  categoryLabel: 'Decision' | 'Gate' | 'Input' | 'Intervention' | 'Stranded';
  urgency: HumanInboxUrgency;
  status: string;
  reason: string;
  nextAction: string;
  /** Trusted Work order context only. Evidence and Feedback remain inert and are never projected. */
  context: string | null;
  /** Present only at a real approval boundary. These verify an approval record; they do not resume it. */
  buttons?: ApprovalButtons;
  /**
   * Inline resolution capability distinct from `buttons` (which are decision verify channels). `'reply'`
   * appends operator steer to an input card; `'resolve'` records/releases a wake-me/blocked/halted card
   * via the governed `POST /api/write/card-respond` route. Absent once a reply is already recorded.
   */
  respond?: 'reply' | 'resolve';
}

export interface HumanInboxCounts {
  total: number;
  decision: number;
  gate: number;
  input: number;
  intervention: number;
  stranded: number;
}

export interface HumanInboxProjection {
  items: HumanInboxItem[];
  counts: HumanInboxCounts;
}

/** Exported so the governed `write/cardRespond.ts` route re-checks the identical input/wake predicates
 *  server-side, rather than trusting the client's projected category. */
/** The owner id the dispatchers assign to a card only a human can move. */
export const HUMAN_OPERATOR = 'human-operator';
/** An explicit `approve:*` action — the second limb of the human-gate test. */
export const APPROVE_ACTION = /^approve:/i;

/**
 * An OPERATOR GATE: a card that no agent can move, regardless of its `state`.
 *
 * This mirrors `scripts/brief.py::_is_human_gate` EXACTLY and deliberately — the morning brief shipped
 * the identical defect (it reported "inbox and approvals are clear" while five T3 gates waited) and was
 * fixed with this two-limb test. A second, drifting definition in the dashboard is precisely how the two
 * surfaces would disagree about what needs Daniel, so this is the same predicate, not a similar one.
 *
 * Both limbs matter and neither implies the other: `decide:budget-gate-measures-nothing` matches only on
 * `owner`, while an `approve:*` card assigned to an agent for staging matches only on `action`.
 */
export function isHumanGate(card: ParsedCard): boolean {
  return text(card.meta.owner) === HUMAN_OPERATOR || APPROVE_ACTION.test(text(card.meta.action));
}

/** The exact marker prefixes `write/cardRespond.ts` writes — used to demote a replied input item and to
 *  hide an operator-resolved halted card. Scoped to the named body section so untrusted `## Evidence`
 *  text can never spoof them. */
const REPLY_RECORDED = 'Reply from operator (';
const RESOLVE_RECORDED = 'Resolved by operator (';

function text(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '');
}

/** Return the text of one `## <section>` block (up to the next `## ` header / EOF), or '' if absent. */
function sectionText(body: string, section: string): string {
  const lines = body.split('\n');
  const header = `## ${section}`;
  const start = lines.findIndex((line) => line.trim() === header);
  if (start === -1) return '';
  let end = lines.length;
  for (let j = start + 1; j < lines.length; j += 1) {
    if (lines[j].startsWith('## ')) {
      end = j;
      break;
    }
  }
  return lines.slice(start + 1, end).join('\n');
}

function dependencies(card: ParsedCard): string[] {
  const value = card.meta['depends-on'];
  return Array.isArray(value) ? value : [];
}

function safeWorkOrder(card: ParsedCard): string | null {
  try {
    return workOrderOf(card.body);
  } catch {
    return null;
  }
}

function tierRank(card: ParsedCard): number {
  const match = /t\s*([0-9]+)/i.exec(text(card.meta['risk-tier']));
  return match ? Number(match[1]) : 0;
}

/** A card is STRANDED once it is owned by a real agent yet has made no progress for this long — a
 *  strong hint the owner's runner is offline. Advisory (low urgency); a false positive is only noise. */
const STRANDED_AGE_MS = 24 * 60 * 60 * 1000;
/** `cards.new_id` prefixes every id with an 8-hex-digit unix-epoch-seconds stamp (`f"{int(time):08x}-…"`).
 *  A non-matching id (legacy / hand-authored) yields an UNKNOWN age — never a stranded classification. */
const CARD_ID_EPOCH_RE = /^([0-9a-f]{8})-/;

/** Age of a card in ms, derived purely from its id's epoch prefix, or `null` when the id does not carry
 *  one. Keeps `classify` pure and fixture-testable (Decision 1) — no file mtime, no indexer change. */
function cardAgeMs(card: ParsedCard, now: number): number | null {
  const match = CARD_ID_EPOCH_RE.exec(text(card.meta.id));
  if (!match) return null;
  const epochSec = parseInt(match[1], 16);
  if (!Number.isFinite(epochSec)) return null;
  return now - epochSec * 1000;
}

/** A compact human age for the stranded reason line (`25h`, `2d`). */
function formatAge(ms: number): string {
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function classify(card: CardProjection, now: number): HumanInboxItem | null {
  const state = text(card.meta.state).toLowerCase();
  const action = text(card.meta.action);
  const context = safeWorkOrder(card);

  if (state === 'approvals') {
    return {
      card,
      category: 'decision',
      categoryLabel: 'Decision',
      urgency: tierRank(card) >= 3 ? 'high' : 'normal',
      status: 'Awaiting evidence verification',
      reason: 'This card is at an approval boundary.',
      nextAction: 'Review the signed scope, then verify an available approval record. Verification alone does not run or resume this card.',
      context,
      buttons: buttonsFor(card),
    };
  }

  if (state === 'inbox' && HUMAN_INPUT_ACTION.test(action)) {
    const replied = sectionText(card.body, 'Feedback').includes(REPLY_RECORDED);
    return {
      card,
      category: 'input',
      categoryLabel: 'Input',
      urgency: replied ? 'low' : 'normal',
      status: replied ? 'Reply recorded' : 'Waiting for your input',
      reason: 'The card action explicitly asks for human input or review.',
      nextAction: replied
        ? 'Reply recorded — awaiting agent pickup.'
        : 'Reply below to steer the owning agent. Your note is appended to the card and it stays queued for pickup.',
      context,
      ...(replied ? {} : { respond: 'reply' as const }),
    };
  }

  if (state === 'inbox' && WAKE_ACTION.test(action)) {
    return {
      card,
      category: 'intervention',
      categoryLabel: 'Intervention',
      urgency: 'high',
      status: 'Operator attention requested',
      reason: 'An agent filed an explicit wake-me card.',
      nextAction: 'Resolve below to record your note and close the wake-me card (it moves to done).',
      context,
      respond: 'resolve',
    };
  }

  // Ordered AFTER the input/wake limbs on purpose: a `wake-me:*` card owned by `human-operator` stays an
  // Intervention (it has a real resolve path), and only cards with no other human-facing classification
  // fall through to the generic gate.
  if (state === 'inbox' && isHumanGate(card)) {
    return {
      card,
      category: 'gate',
      categoryLabel: 'Gate',
      urgency: tierRank(card) >= 3 ? 'high' : 'normal',
      status: 'Waiting on the human operator',
      reason: 'This card is assigned to the human operator or carries an explicit approve action. No agent can move it.',
      // Deliberately NOT a promise the dashboard can keep: `write/cardRespond.ts` authorizes reply/resolve
      // only for input, wake-me, blocked and halted cards, so an operator gate is surfaced read-only
      // rather than given a button that would fail closed on click.
      nextAction: 'Carry out the work order below outside the dashboard, then move the card yourself. The dashboard has no automated path for an operator gate.',
      context,
    };
  }

  if (state === 'halted') {
    if (sectionText(card.body, 'Result').includes(RESOLVE_RECORDED)) return null;
    return {
      card,
      category: 'intervention',
      categoryLabel: 'Intervention',
      urgency: 'high',
      status: 'Run halted',
      reason: 'Execution reached the terminal halted state.',
      nextAction: 'Resolve below to record an operator note on this terminal card. Relaunch a revised run separately.',
      context,
      respond: 'resolve',
    };
  }

  // Mid-stop ladder (stop-requested / halting): the operator asked a working card to stop and it is
  // winding down. Surfaced so the stop is VISIBLE, but watch-only — the ladder self-resolves to `halted`
  // (handled above) or SIGKILL backstops it; there is no operator respond verb for these transient states.
  // `halted` is terminal and handled above, so it is never double-counted here.
  if (state === 'stop-requested' || state === 'halting') {
    return {
      card,
      category: 'intervention',
      categoryLabel: 'Intervention',
      urgency: 'high',
      status: state === 'stop-requested' ? 'Stop requested — winding down' : 'Halting — winding down',
      reason: 'A working card is being cooperatively stopped and has not yet reached the terminal halted state.',
      nextAction: 'Watch the stop complete. The ladder self-resolves to halted, or SIGKILL backstops a worker that never polls; no dashboard action is needed here.',
      context,
    };
  }

  // An operator gate that got blocked is still the human's to clear — without `isHumanGate` here it would
  // need `owner === null` to surface, which an owner-matched gate never is.
  const explicitlyHuman = WAKE_ACTION.test(action) || HUMAN_INPUT_ACTION.test(action) || isHumanGate(card);
  const unownedRootBlock = state === 'blocked' && card.meta.owner === null && dependencies(card).length === 0;
  if (state === 'blocked' && (explicitlyHuman || unownedRootBlock)) {
    return {
      card,
      category: 'intervention',
      categoryLabel: 'Intervention',
      urgency: explicitlyHuman ? 'high' : 'normal',
      status: 'Blocked without an automatic dependency release',
      reason: explicitlyHuman
        ? 'The blocked card explicitly requests human attention.'
        : 'This blocked card has no owner and no dependency that can release it automatically.',
      nextAction: 'Resolve below to record guidance and release the block back into the queue.',
      context,
      respond: 'resolve',
    };
  }

  // STRANDED: an agent-owned card sitting in `inbox`/`working` with no progress for longer than the
  // threshold — a strong hint the owner's runner is offline (the two dead cloud cadences that sat
  // unnoticed since 07-18). Advisory (low urgency). Excludes operator gates (owner === human-operator,
  // already surfaced as a Gate) and unowned cards; a non-hex id yields an unknown age and is NEVER
  // stranded (Decision 1 — a false stranded is noise, so skip rather than surface). Ordered last so any
  // richer classification (input / wake / gate) wins first.
  const owner = text(card.meta.owner);
  if ((state === 'inbox' || state === 'working') && owner !== '' && owner !== HUMAN_OPERATOR) {
    const age = cardAgeMs(card, now);
    if (age !== null && age > STRANDED_AGE_MS) {
      const human = formatAge(age);
      return {
        card,
        category: 'stranded',
        categoryLabel: 'Stranded',
        urgency: 'low',
        status: 'Owned but not progressing',
        reason: `Owned by \`${owner}\`, no progress for ${human} — is its runner online?`,
        nextAction: `Confirm \`${owner}\`'s runner is online; otherwise reassign or close this card. No automated dashboard path exists for a stranded card.`,
        context,
      };
    }
  }

  return null;
}

/** The stable synthetic id of the STOP-file freeze item — kept constant so it dedups visually and never
 *  collides with a real card id (no real card is named `stop-file`). */
export const STOP_FILE_ITEM_ID = 'stop-file';

/**
 * The synthetic Intervention produced (not persisted) when the repo-root `STOP` freeze file is present.
 * It is NOT a card — the projection emits it directly. Critical urgency so it dominates the feed the
 * instant it appears. The route derives `stopPresent` from the filesystem and NEVER reads STOP's contents.
 */
function stopFileItem(): HumanInboxItem {
  return {
    card: {
      meta: {
        id: STOP_FILE_ITEM_ID,
        project: 'kb',
        action: '',
        target: '',
        'risk-tier': 'T3',
        owner: HUMAN_OPERATOR,
        state: '',
      },
      body: '',
      // Synthetic: it is not a card, so it has no registry ordinal. `0` is outside the registry's
      // 1-based range and reads as "no ordinal" rather than colliding with a real card's #1.
      displayName: 'Fleet frozen — STOP file present',
      shortRef: 0,
    },
    category: 'intervention',
    categoryLabel: 'Intervention',
    urgency: 'critical',
    status: 'Fleet frozen',
    reason: 'The repo-root `STOP` file is present — every fleet agent halts at its preamble.',
    nextAction: 'The repo-root `STOP` file is present — the fleet is frozen. Remove it (or clear via the stop floor) to resume.',
    context: null,
  };
}

/**
 * Build the Human Inbox from an existing Plane-A snapshot; never scans or mutates the repository.
 * `opts.now` (default `Date.now()`) makes stranded-age deterministic; `opts.stopPresent` prepends the
 * synthetic STOP intervention (the caller/route decides presence from the filesystem).
 */
export function projectHumanInbox(
  index: PlaneAIndex,
  opts: { now?: number; stopPresent?: boolean } = {},
): HumanInboxProjection {
  const now = opts.now ?? Date.now();
  const cards = Object.values(index.cards).flat();
  const urgencyRank = (item: HumanInboxItem): number =>
    item.urgency === 'critical' ? 0 : item.urgency === 'high' ? 1 : item.urgency === 'normal' ? 2 : 3;
  const projected = cards
    .map((card) => classify(card, now))
    .filter((item): item is HumanInboxItem => item !== null);
  const items = (opts.stopPresent ? [stopFileItem(), ...projected] : projected).sort((a, b) => {
    if (a.urgency !== b.urgency) return urgencyRank(a) - urgencyRank(b);
    const tier = tierRank(b.card) - tierRank(a.card);
    if (tier !== 0) return tier;
    return text(a.card.meta.id).localeCompare(text(b.card.meta.id));
  });

  const counts: HumanInboxCounts = { total: items.length, decision: 0, gate: 0, input: 0, intervention: 0, stranded: 0 };
  for (const item of items) counts[item.category] += 1;
  return { items, counts };
}
