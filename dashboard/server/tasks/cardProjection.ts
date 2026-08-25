/**
 * Read-only classification of a single card into the operator gate the Tasks view answers.
 *
 * The classification is deliberately conservative. Normal queued work and dependency-blocked DAG stages
 * are not human notifications. Only an approval boundary, an OPERATOR GATE (see {@link isHumanGate}),
 * an explicit human-facing action, a halted run, or an unowned/dependency-free blocked card is
 * surfaced. Nothing here changes card state.
 *
 * P4 W6.1 removed the pre-v3 Human Inbox feed vocabulary (the per-item classification labels and the
 * full-feed projection): the Inbox is now the PR + escalation surface of `server/inbox`, and the card
 * verify/reply/resolve gate is answered card-by-card in the Tasks view. This module keeps only the
 * per-card gate classification that gate needs.
 */
import type { ApprovalButtons } from '../approvals/assurance.ts';
import { buttonsFor } from '../approvals/assurance.ts';
import { HUMAN_INPUT_ACTION, WAKE_ACTION } from '../approvals/cardActions.ts';
import { workOrderOf } from '../auth/workOrder.ts';
import type { CardProjection, ParsedCard } from '../planeA/cards.ts';

export interface CardGateItem {
  /** Carries the server-owned `displayName`/`shortRef` so the gate names the card, not its id. */
  card: CardProjection;
  /** A short heading for the gate eyebrow (e.g. `Decision`, `Input`, `Intervention`, `Gate`). */
  label: string;
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

/**
 * Classify one card into the operator gate the Tasks view answers, or `null` when the card needs nothing
 * from a person. Pure and fixture-testable: derives everything from the card's own frontmatter and body,
 * never from file mtime or a repository scan.
 */
export function classifyCardGate(card: CardProjection): CardGateItem | null {
  const state = text(card.meta.state).toLowerCase();
  const action = text(card.meta.action);
  const context = safeWorkOrder(card);

  if (state === 'approvals') {
    return {
      card,
      label: 'Decision',
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
      label: 'Input',
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
      label: 'Intervention',
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
      label: 'Gate',
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
      label: 'Intervention',
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
  if (state === 'stop-requested' || state === 'halting') {
    return {
      card,
      label: 'Intervention',
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
      label: 'Intervention',
      status: 'Blocked without an automatic dependency release',
      reason: explicitlyHuman
        ? 'The blocked card explicitly requests human attention.'
        : 'This blocked card has no owner and no dependency that can release it automatically.',
      nextAction: 'Resolve below to record guidance and release the block back into the queue.',
      context,
      respond: 'resolve',
    };
  }

  return null;
}
