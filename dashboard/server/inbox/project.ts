import { createHash } from 'node:crypto';
import type { CardProjection } from '../planeA/cards.ts';
import type { PlaneAIndex } from '../planeA/indexer.ts';

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
const WAKE_ACTION = /^wake-me(?::|$)/i;

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
