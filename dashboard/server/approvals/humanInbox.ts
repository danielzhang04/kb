/**
 * Read-only projection of the card queue into the operator's Human Inbox.
 *
 * The projection is deliberately conservative. Normal queued work and dependency-blocked DAG stages
 * are not human notifications. Only an approval boundary, an explicit human-facing action, a halted
 * run, or an unowned/dependency-free blocked card is surfaced. No item in this feed changes card state.
 */
import type { ApprovalButtons } from './assurance.ts';
import { buttonsFor } from './assurance.ts';
import { workOrderOf } from '../auth/workOrder.ts';
import type { ParsedCard } from '../planeA/cards.ts';
import type { PlaneAIndex } from '../planeA/indexer.ts';

export type HumanInboxCategory = 'decision' | 'input' | 'intervention';
export type HumanInboxUrgency = 'high' | 'normal' | 'low';

export interface HumanInboxItem {
  card: ParsedCard;
  category: HumanInboxCategory;
  categoryLabel: 'Decision' | 'Input' | 'Intervention';
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
  input: number;
  intervention: number;
}

export interface HumanInboxProjection {
  items: HumanInboxItem[];
  counts: HumanInboxCounts;
}

/** Exported so the governed `write/cardRespond.ts` route re-checks the identical input/wake predicates
 *  server-side, rather than trusting the client's projected category. */
export const HUMAN_INPUT_ACTION = /(?:^|[:/_-])(?:needs?-?input|human-?input|input-?required|question|human-?review|review-?required)(?:$|[:/_-])/i;
export const WAKE_ACTION = /^wake-me(?::|$)/i;

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

function classify(card: ParsedCard): HumanInboxItem | null {
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

  const explicitlyHuman = WAKE_ACTION.test(action) || HUMAN_INPUT_ACTION.test(action);
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

  return null;
}

/** Build the Human Inbox from an existing Plane-A snapshot; never scans or mutates the repository. */
export function projectHumanInbox(index: PlaneAIndex): HumanInboxProjection {
  const cards = Object.values(index.cards).flat();
  const urgencyRank = (item: HumanInboxItem): number => (item.urgency === 'high' ? 0 : item.urgency === 'normal' ? 1 : 2);
  const items = cards
    .map(classify)
    .filter((item): item is HumanInboxItem => item !== null)
    .sort((a, b) => {
      if (a.urgency !== b.urgency) return urgencyRank(a) - urgencyRank(b);
      const tier = tierRank(b.card) - tierRank(a.card);
      if (tier !== 0) return tier;
      return text(a.card.meta.id).localeCompare(text(b.card.meta.id));
    });

  const counts: HumanInboxCounts = { total: items.length, decision: 0, input: 0, intervention: 0 };
  for (const item of items) counts[item.category] += 1;
  return { items, counts };
}
