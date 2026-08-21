export interface InboxItem {
  id: string;
  createdAt: string;
  revision: string;
  kind: 'escalation';
  subject: { cardId: string };
  related: { runRef?: string; stopEvent?: string };
  title: string;
  reason: string;
}

export interface InboxResponse {
  items: InboxItem[];
}

export type FetchLike = typeof fetch;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

function validTime(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function decodeItem(value: unknown): InboxItem | null {
  const item = record(value);
  if (!item || !exactKeys(item, ['createdAt', 'id', 'kind', 'reason', 'related', 'revision', 'subject', 'title'])) return null;
  const subject = record(item.subject);
  const related = record(item.related);
  if (!subject || !exactKeys(subject, ['cardId']) || !related) return null;
  if (!Object.keys(related).every((key) => key === 'runRef' || key === 'stopEvent')) return null;
  if (!Object.values(related).every((entry) => typeof entry === 'string')) return null;
  if (item.kind !== 'escalation' || typeof item.id !== 'string' || !/^[0-9a-f]{64}$/.test(item.id)
    || typeof item.revision !== 'string' || !/^[0-9a-f]{64}$/.test(item.revision)
    || !validTime(item.createdAt) || typeof subject.cardId !== 'string' || !/^[0-9a-f]{8}-/.test(subject.cardId)
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

function decode(value: unknown): InboxResponse | null {
  const response = record(value);
  if (!response || !exactKeys(response, ['items']) || !Array.isArray(response.items)) return null;
  const items = response.items.map(decodeItem);
  return items.every((item): item is InboxItem => item !== null) ? { items } : null;
}

export async function fetchInbox(fetchImpl: FetchLike = fetch): Promise<InboxResponse> {
  const response = await fetchImpl('/api/inbox', { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`GET /api/inbox failed: ${response.status}`);
  const body = decode(await response.json());
  if (!body) throw new Error('Invalid Inbox response');
  return body;
}
