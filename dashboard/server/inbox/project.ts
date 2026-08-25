import { createHash } from 'node:crypto';
import { WAKE_ACTION } from '../approvals/cardActions.ts';
import type { CardProjection } from '../planeA/cards.ts';
import type { PlaneAIndex } from '../planeA/indexer.ts';
import { sha256Hex } from '../write/durableManifest.ts';
import {
  compareInboxItems, inboxRevision, type EscalationSubject, type InboxResponse, type P4InboxItem,
  type PrSubject, type SourceState,
} from './contracts.ts';
import type { DeploymentInboxItem } from './deploymentContracts.ts';
import type { AssetPullInboxItem } from './assetPullSubjects.ts';
import type { DeploymentEscalationItem } from './deploymentSubjects.ts';

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

// ---------------------------------------------------------------------------------------------
// P5 W6.1 §3.1/§3.2 — the FOUR-source envelope [P5-C31]. The P4 `{items,revision,sources}` contract
// is extended IN THE SERVED SHAPE with the `deployment` and `asset-pull` arms and their two source
// states; the top-level revision preimage now folds four source states in canonical lexicographic
// order `assetPull, deployment, escalation, pr`. This is the ONE shape the route serves — there is
// no compatibility union, adapter, or flag [P5-C22]. `projectP4Inbox`/`InboxResponse` above stay as
// the pr+escalation building block; nothing serves them over the wire any more. The two new sources
// carry P4's `SourceState` VERBATIM (`unavailable|timeout|overflow|invalid`, `stale`), so the browser
// copy, refresh budget, and staleness semantics are identical [P5-C48].
// ---------------------------------------------------------------------------------------------

/** Every subject kind the P5 Inbox serves: the P4 union plus the three P5-projected kinds. */
export type P5InboxItem =
  | P4InboxItem
  | DeploymentInboxItem
  | AssetPullInboxItem
  | DeploymentEscalationItem;

export type P5InboxSourceKind = 'pr' | 'escalation' | 'deployment' | 'assetPull';
/** Canonical lexicographic order the revision preimage folds the four source states in [P5-C31]. */
export const P5_INBOX_SOURCE_ORDER: readonly P5InboxSourceKind[] = ['assetPull', 'deployment', 'escalation', 'pr'];

export interface P5InboxSourceStates {
  readonly pr: SourceState;
  readonly escalation: SourceState;
  readonly deployment: SourceState;
  readonly assetPull: SourceState;
}

export interface P5InboxResponse {
  readonly items: readonly P5InboxItem[];
  readonly revision: string;
  readonly sources: P5InboxSourceStates;
}

/** The same canonical source-state encoding P4 pins (`contracts.ts#canonicalSourceState`), so a fresh
 *  verified state keeps stable bytes and `stale` only ever appends. Replicated here (the P4 function is
 *  module-private) rather than crossing the union with a cast. */
function canonicalSourceState(kind: P5InboxSourceKind, state: SourceState): string {
  return state.status === 'verified'
    ? `${kind}\u0000verified\u0000${state.revision}\u0000${state.verifiedAt}${state.stale === true ? '\u0000stale' : ''}`
    : `${kind}\u0000failed\u0000${state.revision ?? ''}\u0000${state.verifiedAt ?? ''}\u0000${state.errorCode}\u0000${String(state.stale)}`;
}

/** `sha256(canonical FOUR sorted source states + sorted item id/revision pairs)` [P5-C31]. */
export function inboxRevisionP5(
  sources: P5InboxSourceStates,
  items: readonly Pick<P5InboxItem, 'id' | 'revision'>[],
): string {
  const sourceLines = [...P5_INBOX_SOURCE_ORDER]
    .sort()
    .map((kind) => canonicalSourceState(kind, sources[kind]));
  const itemLines = items.map((item) => `${item.id}\u0000${item.revision}`).sort();
  return sha256Hex([...sourceLines, ...itemLines].join(''));
}

/** createdAt desc, then kind, then id — the P4 ordering, widened over the P5 union. */
export function compareP5InboxItems(left: P5InboxItem, right: P5InboxItem): number {
  if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? 1 : -1;
  if (left.kind !== right.kind) return left.kind < right.kind ? -1 : 1;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

export interface P5InboxSourceReads {
  readonly pr: { readonly items: readonly PrSubject[]; readonly state: SourceState };
  readonly escalation: { readonly items: readonly EscalationSubject[]; readonly state: SourceState };
  readonly deployment: {
    readonly items: readonly (DeploymentInboxItem | DeploymentEscalationItem)[];
    readonly state: SourceState;
  };
  readonly assetPull: { readonly items: readonly AssetPullInboxItem[]; readonly state: SourceState };
}

/**
 * Compose one P5 Inbox response from the four independently-read sources. A failed source keeps its own
 * last-good items and its own `SourceState`; the other three are untouched, so a partial failure never
 * empties the Inbox and never hides a healthy arm [design 367].
 */
export function projectP5Inbox(sources: P5InboxSourceReads): P5InboxResponse {
  const items: P5InboxItem[] = [
    ...sources.pr.items,
    ...sources.escalation.items,
    ...sources.deployment.items,
    ...sources.assetPull.items,
  ].sort(compareP5InboxItems);
  const states: P5InboxSourceStates = {
    pr: sources.pr.state,
    escalation: sources.escalation.state,
    deployment: sources.deployment.state,
    assetPull: sources.assetPull.state,
  };
  return { items, revision: inboxRevisionP5(states, items), sources: states };
}
