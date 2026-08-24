// P4 §3.3 closed contracts: the Inbox union (PR + escalation ONLY), per-source lifecycle state, the
// deterministic id/revision formulas, and the pinned read command. Types and strict decoders ONLY —
// no resolver, no subprocess, no cache, no route. Runs and STOP are resolvers, never subjects
// (`design:244-273,597`); deployment and asset-pull subjects are P5.
import {
  ContractDecodeError, closedObject, isDigestSha256, requireString, sha256Hex,
} from '../write/durableManifest.ts';

export type InboxSourceKind = 'pr' | 'escalation';
export const INBOX_SOURCE_KINDS: readonly InboxSourceKind[] = ['escalation', 'pr'];

/** Closed error-code union; browser error text is fixed copy and never raw stderr. */
export type InboxSourceErrorCode = 'unavailable' | 'timeout' | 'overflow' | 'invalid';
export const INBOX_SOURCE_ERROR_CODES: readonly InboxSourceErrorCode[] = [
  'unavailable', 'timeout', 'overflow', 'invalid',
];

export type SourceState =
  | { readonly status: 'verified'; readonly revision: string; readonly verifiedAt: string }
  | {
      readonly status: 'failed'; readonly revision?: string; readonly verifiedAt?: string;
      readonly errorCode: InboxSourceErrorCode; readonly stale: boolean;
    };

export interface InboxItemBase {
  readonly id: string;
  readonly createdAt: string;
  readonly revision: string;
}

export interface PrSubjectKey { readonly owner: string; readonly repo: string; readonly number: number }

export type PrSubject = InboxItemBase & {
  readonly kind: 'pr';
  readonly subject: PrSubjectKey;
  readonly title: string;
  /** Server-constructed from the pinned owner/repo/number; never accepted from subject text. */
  readonly href: string;
};

export type EscalationSubject = InboxItemBase & {
  readonly kind: 'escalation';
  readonly subject: { readonly cardId: string };
  readonly related: { readonly runRef?: string; readonly stopEvent?: string };
  readonly title: string;
  readonly reason: string;
};

/** The complete P4 Inbox union. A run-shaped payload cannot decode or compile as an item. */
export type P4InboxItem = PrSubject | EscalationSubject;

export interface InboxResponse {
  readonly items: readonly P4InboxItem[];
  readonly revision: string;
  readonly sources: { readonly pr: SourceState; readonly escalation: SourceState };
}

/** `GET /api/inbox?refresh=pr|escalation`; any other value is a 400. */
export type InboxRefreshSource = InboxSourceKind;
export function decodeInboxRefreshParam(value: unknown): InboxRefreshSource | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && INBOX_SOURCE_KINDS.includes(value as InboxSourceKind)) {
    return value as InboxRefreshSource;
  }
  throw new ContractDecodeError('refresh', 'pr | escalation');
}

/** Pinned literal read command [P4-C25]; `<owner>/<repo>` comes only from the composition-time pin. */
export const PR_LIST_ROW_LIMIT = 100;
export function ghPrListArgv(owner: string, repo: string): readonly string[] {
  return ['pr', 'list', '--repo', `${owner}/${repo}`, '--state', 'open', '--limit', String(PR_LIST_ROW_LIMIT + 1)];
}
export const PR_LIST_TIMEOUT_MS = 15_000;
/** ONE `gh` subprocess per 30 s GLOBALLY; the 60 s poll shares the same budget [P4-C34]. */
export const PR_REFRESH_BUDGET_MS = 30_000;
export const PR_POLL_INTERVAL_MS = 60_000;

export function prHref(subject: PrSubjectKey): string {
  return `https://github.com/${subject.owner}/${subject.repo}/pull/${subject.number}`;
}

/** PR key is lowercase owner/repo plus decimal number; escalation key is the normalized card path. */
export function prSubjectKeyString(subject: PrSubjectKey): string {
  return `${subject.owner.toLowerCase()}/${subject.repo.toLowerCase()}#${subject.number}`;
}
export function escalationSubjectKeyString(cardId: string): string {
  return cardId;
}
export function inboxItemId(kind: InboxSourceKind, canonicalSubjectKey: string): string {
  return sha256Hex(`${kind}\u0000${canonicalSubjectKey}`);
}

/** Stable source keys for the two resolvers; they are never Inbox subjects. */
export function runSourceKey(runRef: string): string { return `run:${runRef}`; }
export function stopSourceKey(stopBytesSha256: string): string {
  if (!isDigestSha256(stopBytesSha256)) throw new ContractDecodeError('stopEvent', 'sha256 hex required');
  return `stop:${stopBytesSha256}`;
}

/** createdAt desc, then kind, then id. */
export function compareInboxItems(left: P4InboxItem, right: P4InboxItem): number {
  if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? 1 : -1;
  if (left.kind !== right.kind) return left.kind < right.kind ? -1 : 1;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function canonicalSourceState(kind: InboxSourceKind, state: SourceState): string {
  return state.status === 'verified'
    ? `${kind}\u0000verified\u0000${state.revision}\u0000${state.verifiedAt}`
    : `${kind}\u0000failed\u0000${state.revision ?? ''}\u0000${state.verifiedAt ?? ''}\u0000${state.errorCode}\u0000${String(state.stale)}`;
}

/** `sha256(canonical sorted source states + sorted item id/revision pairs)`. */
export function inboxRevision(
  sources: { readonly pr: SourceState; readonly escalation: SourceState },
  items: readonly Pick<P4InboxItem, 'id' | 'revision'>[],
): string {
  const sourceLines = [...INBOX_SOURCE_KINDS]
    .sort()
    .map((kind) => canonicalSourceState(kind, sources[kind]));
  const itemLines = items.map((item) => `${item.id}\u0000${item.revision}`).sort();
  return sha256Hex([...sourceLines, ...itemLines].join('\u0001'));
}

const VERIFIED_KEYS = ['status', 'revision', 'verifiedAt'] as const;
const FAILED_KEYS = ['status', 'revision', 'verifiedAt', 'errorCode', 'stale'] as const;

export function decodeSourceState(value: unknown): SourceState {
  if (value === null || typeof value !== 'object') throw new ContractDecodeError('source', 'object required');
  const status = (value as Record<string, unknown>)['status'];
  if (status === 'verified') {
    const record = closedObject(value, VERIFIED_KEYS, 'source');
    return {
      status: 'verified',
      revision: requireString(record, 'revision', 'source'),
      verifiedAt: requireString(record, 'verifiedAt', 'source'),
    };
  }
  if (status === 'failed') {
    const record = closedObject(value, FAILED_KEYS, 'source');
    const errorCode = record['errorCode'];
    if (typeof errorCode !== 'string' || !INBOX_SOURCE_ERROR_CODES.includes(errorCode as InboxSourceErrorCode)) {
      throw new ContractDecodeError('source.errorCode', 'closed error code required');
    }
    if (typeof record['stale'] !== 'boolean') throw new ContractDecodeError('source.stale', 'boolean required');
    const failed: SourceState = {
      status: 'failed', errorCode: errorCode as InboxSourceErrorCode, stale: record['stale'],
      ...(record['revision'] === undefined ? {} : { revision: requireString(record, 'revision', 'source') }),
      ...(record['verifiedAt'] === undefined ? {} : { verifiedAt: requireString(record, 'verifiedAt', 'source') }),
    };
    return failed;
  }
  throw new ContractDecodeError('source.status', "'verified' | 'failed'");
}

const PR_ITEM_KEYS = ['kind', 'id', 'createdAt', 'revision', 'subject', 'title', 'href'] as const;
const ESCALATION_ITEM_KEYS = ['kind', 'id', 'createdAt', 'revision', 'subject', 'related', 'title', 'reason'] as const;

export function decodeInboxItem(value: unknown): P4InboxItem {
  if (value === null || typeof value !== 'object') throw new ContractDecodeError('item', 'object required');
  const kind = (value as Record<string, unknown>)['kind'];
  if (kind === 'pr') {
    const record = closedObject(value, PR_ITEM_KEYS, 'item');
    const subjectRecord = closedObject(record['subject'], ['owner', 'repo', 'number'], 'item.subject');
    const number = subjectRecord['number'];
    if (typeof number !== 'number' || !Number.isInteger(number) || number <= 0) {
      throw new ContractDecodeError('item.subject.number', 'positive integer required');
    }
    const subject: PrSubjectKey = {
      owner: requireString(subjectRecord, 'owner', 'item.subject'),
      repo: requireString(subjectRecord, 'repo', 'item.subject'),
      number,
    };
    const href = requireString(record, 'href', 'item');
    if (href !== prHref(subject)) throw new ContractDecodeError('item.href', 'href must be rebuilt from the pinned subject');
    const item: PrSubject = {
      kind: 'pr', id: requireString(record, 'id', 'item'), createdAt: requireString(record, 'createdAt', 'item'),
      revision: requireString(record, 'revision', 'item'), subject, title: requireString(record, 'title', 'item'), href,
    };
    if (item.id !== inboxItemId('pr', prSubjectKeyString(subject))) {
      throw new ContractDecodeError('item.id', 'id must be the pinned subject hash');
    }
    return item;
  }
  if (kind === 'escalation') {
    const record = closedObject(value, ESCALATION_ITEM_KEYS, 'item');
    const subjectRecord = closedObject(record['subject'], ['cardId'], 'item.subject');
    const cardId = requireString(subjectRecord, 'cardId', 'item.subject');
    const relatedRecord = closedObject(record['related'], ['runRef', 'stopEvent'], 'item.related');
    const related: { runRef?: string; stopEvent?: string } = {};
    if (relatedRecord['runRef'] !== undefined) related.runRef = requireString(relatedRecord, 'runRef', 'item.related');
    if (relatedRecord['stopEvent'] !== undefined) related.stopEvent = requireString(relatedRecord, 'stopEvent', 'item.related');
    const item: EscalationSubject = {
      kind: 'escalation', id: requireString(record, 'id', 'item'), createdAt: requireString(record, 'createdAt', 'item'),
      revision: requireString(record, 'revision', 'item'), subject: { cardId }, related,
      title: requireString(record, 'title', 'item'), reason: requireString(record, 'reason', 'item'),
    };
    if (item.id !== inboxItemId('escalation', escalationSubjectKeyString(cardId))) {
      throw new ContractDecodeError('item.id', 'id must be the pinned subject hash');
    }
    return item;
  }
  throw new ContractDecodeError('item.kind', "closed union 'pr' | 'escalation'");
}

const RESPONSE_KEYS = ['items', 'revision', 'sources'] as const;

export function decodeInboxResponse(value: unknown): InboxResponse {
  const record = closedObject(value, RESPONSE_KEYS, 'inbox');
  const rawItems = record['items'];
  if (!Array.isArray(rawItems)) throw new ContractDecodeError('inbox.items', 'array required');
  const items = rawItems.map((entry) => decodeInboxItem(entry));
  const sourcesRecord = closedObject(record['sources'], ['pr', 'escalation'], 'inbox.sources');
  const sources = { pr: decodeSourceState(sourcesRecord['pr']), escalation: decodeSourceState(sourcesRecord['escalation']) };
  const revision = requireString(record, 'revision', 'inbox');
  if (revision !== inboxRevision(sources, items)) throw new ContractDecodeError('inbox.revision', 'revision must match its inputs');
  for (let index = 1; index < items.length; index += 1) {
    if (compareInboxItems(items[index - 1]!, items[index]!) > 0) {
      throw new ContractDecodeError('inbox.items', 'items must be sorted by createdAt desc, kind, id');
    }
  }
  return { items, revision, sources };
}

/** "Nothing needs you" is legal only when both sources are freshly verified and empty. */
export function isLegalEmptyInbox(response: InboxResponse): boolean {
  return response.items.length === 0
    && response.sources.pr.status === 'verified'
    && response.sources.escalation.status === 'verified';
}
