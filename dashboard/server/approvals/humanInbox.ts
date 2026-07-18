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
export type HumanInboxUrgency = 'high' | 'normal';

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

const HUMAN_INPUT_ACTION = /(?:^|[:/_-])(?:needs?-?input|human-?input|input-?required|question|human-?review|review-?required)(?:$|[:/_-])/i;
const WAKE_ACTION = /^wake-me(?::|$)/i;

function text(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '');
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
    return {
      card,
      category: 'input',
      categoryLabel: 'Input',
      urgency: 'normal',
      status: 'Waiting for your input',
      reason: 'The card action explicitly asks for human input or review.',
      nextAction: 'Inspect the card in Tasks or Files. A direct reply/resume action is not wired in this Inbox yet.',
      context,
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
      nextAction: 'Inspect the work order and related task state. Resolution and resume remain governed card actions outside this Inbox.',
      context,
    };
  }

  if (state === 'halted') {
    return {
      card,
      category: 'intervention',
      categoryLabel: 'Intervention',
      urgency: 'high',
      status: 'Run halted',
      reason: 'Execution reached the terminal halted state.',
      nextAction: 'Inspect the task before deciding whether to launch a revised rerun. This Inbox does not silently resume halted work.',
      context,
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
      nextAction: 'Inspect the blocker in Tasks or Files. Reassignment and resume are not wired in this Inbox yet.',
      context,
    };
  }

  return null;
}

/** Build the Human Inbox from an existing Plane-A snapshot; never scans or mutates the repository. */
export function projectHumanInbox(index: PlaneAIndex): HumanInboxProjection {
  const cards = Object.values(index.cards).flat();
  const items = cards
    .map(classify)
    .filter((item): item is HumanInboxItem => item !== null)
    .sort((a, b) => {
      if (a.urgency !== b.urgency) return a.urgency === 'high' ? -1 : 1;
      const tier = tierRank(b.card) - tierRank(a.card);
      if (tier !== 0) return tier;
      return text(a.card.meta.id).localeCompare(text(b.card.meta.id));
    });

  const counts: HumanInboxCounts = { total: items.length, decision: 0, input: 0, intervention: 0 };
  for (const item of items) counts[item.category] += 1;
  return { items, counts };
}
