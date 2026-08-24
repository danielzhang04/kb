import { createHash } from 'node:crypto';
import { WAKE_ACTION } from '../approvals/cardActions.ts';
import type { CardProjection } from '../planeA/cards.ts';
import type { PlaneAIndex } from '../planeA/indexer.ts';
import {
  compareInboxItems, inboxRevision, type EscalationSubject, type InboxResponse, type P4InboxItem,
  type PrSubject, type SourceState,
} from './contracts.ts';

export interface EscalationInboxItem {
  id: string;
  createdAt: string;
  revision: string;
  kind: 'escalation';
  subject: { cardId: string };
  related: { runRef?: string; stopEvent?: string };
  title: string;
  reason: string;
}

export interface InboxProjection {
  items: EscalationInboxItem[];
}

const CARD_ID_PREFIX = /^[0-9a-f]{8}-/;
function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function workOrder(card: CardProjection): string {
  const lines = card.body.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === '## Work order');
  if (start === -1) return '';
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## ')) break;
    if (line.trim() !== '') return line.trim();
  }
  return '';
}

function revision(card: CardProjection): string {
  const entries = Object.entries(card.meta).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  return createHash('sha256').update(JSON.stringify([entries, card.body]), 'utf8').digest('hex');
}

function projects(card: CardProjection): boolean {
  return text(card.meta.state) === 'inbox'
    && WAKE_ACTION.test(text(card.meta.action))
    && CARD_ID_PREFIX.test(text(card.meta.id));
}

function item(card: CardProjection): EscalationInboxItem {
  const cardId = text(card.meta.id);
  if (!CARD_ID_PREFIX.test(cardId)) throw new Error(`Inbox escalation card id is missing its creation prefix: ${cardId}`);
  const epochSeconds = Number.parseInt(cardId.slice(0, 8), 16);
  const runRef = text(card.meta['run-ref']);
  const stopEvent = text(card.meta['stop-event']);
  return {
    id: createHash('sha256').update(`escalation\0${cardId}`, 'utf8').digest('hex'),
    createdAt: new Date(epochSeconds * 1000).toISOString(),
    revision: revision(card),
    kind: 'escalation',
    subject: { cardId },
    related: { ...(runRef ? { runRef } : {}), ...(stopEvent ? { stopEvent } : {}) },
    title: text(card.meta.action),
    reason: workOrder(card),
  };
}

/** Project only queued wake-me cards, the persisted escalation record for failed runs and STOP events. */
export function projectInbox(index: PlaneAIndex): InboxProjection {
  const cards = Object.values(index.cards).flat();
  return { items: cards.filter(projects).map(item).sort((a, b) => a.subject.cardId.localeCompare(b.subject.cardId)) };
}

// ---------------------------------------------------------------------------------------------
// P4 section 3.3: the closed PR + escalation union, written BESIDE the `{items}` shape above; W6.1
// cuts the route, the Home count, and the browser decoder over and deletes the older shape
// [P4-C32]. A card that leaves `state: inbox` (completed) leaves the escalation set, and a merged
// or closed PR leaves the open-PR read, so removal needs no separate event. Runs and STOP stay
// escalation LINKS, never subjects, and there is no next-fire or run gate anywhere here.
// ---------------------------------------------------------------------------------------------

export interface InboxSourceSnapshot<TItem> {
  readonly items: readonly TItem[];
  readonly state: SourceState;
}

export interface P4InboxSources {
  readonly pr: InboxSourceSnapshot<PrSubject>;
  readonly escalation: InboxSourceSnapshot<EscalationSubject>;
}

/** The escalation half of the union: the same wake-me cards, typed to the W0 contract. */
export function projectEscalationSubjects(index: PlaneAIndex): readonly EscalationSubject[] {
  const cards = Object.values(index.cards).flat();
  return cards.filter(projects).map(item).sort(compareInboxItems);
}

/**
 * Compose the two independently-read sources. A failed source keeps its own last-good items and its
 * own `SourceState`; the other source is untouched, so a partial failure never empties the Inbox
 * and never hides the healthy half.
 */
export function projectP4Inbox(sources: P4InboxSources): InboxResponse {
  const items: P4InboxItem[] = [...sources.pr.items, ...sources.escalation.items].sort(compareInboxItems);
  const states = { pr: sources.pr.state, escalation: sources.escalation.state };
  return { items, revision: inboxRevision(states, items), sources: states };
}
