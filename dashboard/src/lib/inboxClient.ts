// P4 W6.1: the browser Inbox client, cut over ATOMICALLY to the closed PR + escalation + source-health
// contract of section 3.3. No compatibility union or adapter remains. The decoder validates SHAPE only
// (it never recomputes the server's sha256 revisions — those are opaque 64-hex strings here) and rebuilds
// the PR href from the pinned owner/repo/number so subject text can never supply a link target.

export type InboxSourceKind = 'pr' | 'escalation';
export type InboxSourceErrorCode = 'unavailable' | 'timeout' | 'overflow' | 'invalid';
const SOURCE_ERROR_CODES: readonly InboxSourceErrorCode[] = ['unavailable', 'timeout', 'overflow', 'invalid'];

export type SourceState =
  | { status: 'verified'; revision: string; verifiedAt: string; stale?: true }
  | { status: 'failed'; revision?: string; verifiedAt?: string; errorCode: InboxSourceErrorCode; stale: boolean };

export interface PrItem {
  id: string;
  createdAt: string;
  revision: string;
  kind: 'pr';
  subject: { owner: string; repo: string; number: number };
  title: string;
  href: string;
}

export interface EscalationItem {
  id: string;
  createdAt: string;
  revision: string;
  kind: 'escalation';
  subject: { cardId: string };
  related: { runRef?: string; stopEvent?: string };
  title: string;
  reason: string;
}

export type InboxItem = PrItem | EscalationItem;

export interface InboxResponse {
  items: InboxItem[];
  revision: string;
  sources: { pr: SourceState; escalation: SourceState };
}

export type FetchLike = typeof fetch;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...keys].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function hex64(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function validTime(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

/** The server rebuilds the href from the pin; the client re-derives it to reject a tampered link. */
function prHref(subject: { owner: string; repo: string; number: number }): string {
  return `https://github.com/${subject.owner}/${subject.repo}/pull/${subject.number}`;
}

function decodePrItem(item: Record<string, unknown>): PrItem | null {
  if (!exactKeys(item, ['createdAt', 'href', 'id', 'kind', 'revision', 'subject', 'title'])) return null;
  const subject = record(item.subject);
  if (!subject || !exactKeys(subject, ['number', 'owner', 'repo'])) return null;
  const { owner, repo, number } = subject;
  if (typeof owner !== 'string' || typeof repo !== 'string'
    || typeof number !== 'number' || !Number.isInteger(number) || number <= 0) return null;
  if (!hex64(item.id) || !hex64(item.revision) || !validTime(item.createdAt) || typeof item.title !== 'string') return null;
  const pinned = { owner, repo, number };
  if (item.href !== prHref(pinned)) return null;
  return { id: item.id, createdAt: item.createdAt, revision: item.revision, kind: 'pr', subject: pinned, title: item.title, href: item.href };
}

function decodeEscalationItem(item: Record<string, unknown>): EscalationItem | null {
  if (!exactKeys(item, ['createdAt', 'id', 'kind', 'reason', 'related', 'revision', 'subject', 'title'])) return null;
  const subject = record(item.subject);
  const related = record(item.related);
  if (!subject || !exactKeys(subject, ['cardId']) || !related) return null;
  if (!Object.keys(related).every((key) => key === 'runRef' || key === 'stopEvent')) return null;
  if (!Object.values(related).every((entry) => typeof entry === 'string')) return null;
  if (!hex64(item.id) || !hex64(item.revision) || !validTime(item.createdAt)
    || typeof subject.cardId !== 'string' || !/^[0-9a-f]{8}-/.test(subject.cardId)
    || typeof item.title !== 'string' || typeof item.reason !== 'string') return null;
  return {
    id: item.id,
    createdAt: item.createdAt,
    revision: item.revision,
    kind: 'escalation',
    subject: { cardId: subject.cardId },
    related: {
      ...(typeof related.runRef === 'string' ? { runRef: related.runRef } : {}),
      ...(typeof related.stopEvent === 'string' ? { stopEvent: related.stopEvent } : {}),
    },
    title: item.title,
    reason: item.reason,
  };
}

function decodeItem(value: unknown): InboxItem | null {
  const item = record(value);
  if (!item) return null;
  if (item.kind === 'pr') return decodePrItem(item);
  if (item.kind === 'escalation') return decodeEscalationItem(item);
  return null;
}

function decodeSourceState(value: unknown): SourceState | null {
  const state = record(value);
  if (!state) return null;
  if (state.status === 'verified') {
    if (!exactKeys(state, state.stale === undefined ? ['revision', 'status', 'verifiedAt'] : ['revision', 'stale', 'status', 'verifiedAt'])) return null;
    if (state.stale !== undefined && state.stale !== true) return null;
    if (typeof state.revision !== 'string' || !validTime(state.verifiedAt)) return null;
    return { status: 'verified', revision: state.revision, verifiedAt: state.verifiedAt, ...(state.stale === true ? { stale: true } : {}) };
  }
  if (state.status === 'failed') {
    if (typeof state.errorCode !== 'string' || !SOURCE_ERROR_CODES.includes(state.errorCode as InboxSourceErrorCode)) return null;
    if (typeof state.stale !== 'boolean') return null;
    if (state.revision !== undefined && typeof state.revision !== 'string') return null;
    if (state.verifiedAt !== undefined && !validTime(state.verifiedAt)) return null;
    return {
      status: 'failed',
      errorCode: state.errorCode as InboxSourceErrorCode,
      stale: state.stale,
      ...(typeof state.revision === 'string' ? { revision: state.revision } : {}),
      ...(typeof state.verifiedAt === 'string' ? { verifiedAt: state.verifiedAt } : {}),
    };
  }
  return null;
}

function decode(value: unknown): InboxResponse | null {
  const response = record(value);
  if (!response || !exactKeys(response, ['items', 'revision', 'sources'])) return null;
  if (!Array.isArray(response.items) || typeof response.revision !== 'string') return null;
  const items = response.items.map(decodeItem);
  if (!items.every((item): item is InboxItem => item !== null)) return null;
  const sources = record(response.sources);
  if (!sources || !exactKeys(sources, ['escalation', 'pr'])) return null;
  const pr = decodeSourceState(sources.pr);
  const escalation = decodeSourceState(sources.escalation);
  if (!pr || !escalation) return null;
  return { items, revision: response.revision, sources: { pr, escalation } };
}

/** `refresh` retries only the named failed source (`?refresh=pr|escalation`); Retry needs no mutation. */
export async function fetchInbox(fetchImpl: FetchLike = fetch, refresh?: InboxSourceKind): Promise<InboxResponse> {
  const url = refresh ? `/api/inbox?refresh=${refresh}` : '/api/inbox';
  const response = await fetchImpl(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`GET /api/inbox failed: ${response.status}`);
  const body = decode(await response.json());
  if (!body) throw new Error('Invalid Inbox response');
  return body;
}
