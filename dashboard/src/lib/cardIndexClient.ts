import type { CardProjection } from '../../server/planeA/cards.ts';
import { record } from './decodeGuards.ts';

export type CardsByState = Record<string, CardProjection[]>;
export type CardIndexFetch = typeof fetch;

function validTime(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value));
}

function decodeCard(value: unknown): CardProjection | null {
  const card = record(value);
  const meta = record(card?.meta);
  if (!card || !meta) return null;
  if (typeof meta.id !== 'string' || typeof meta.state !== 'string' || typeof card.body !== 'string') return null;
  if (typeof card.displayName !== 'string' || !Number.isInteger(card.shortRef)) return null;
  if (card.updatedAt !== undefined && !validTime(card.updatedAt)) return null;
  return card as unknown as CardProjection;
}

/** Decode only the `/api/index` card projection used by the Inbox. The additive `updatedAt` is optional
 *  for old snapshots, but when present it must be a valid time just like Inbox item timestamps. */
export function decodeCardIndex(value: unknown): CardsByState | null {
  const response = record(value);
  const source = record(response?.cards);
  if (!source) return null;
  const cards: CardsByState = {};
  for (const [state, values] of Object.entries(source)) {
    if (!Array.isArray(values)) return null;
    const decoded = values.map(decodeCard);
    if (decoded.some((card) => card === null)) return null;
    cards[state] = decoded as CardProjection[];
  }
  return cards;
}

export async function fetchCardIndex(fetchImpl: CardIndexFetch = fetch): Promise<CardsByState> {
  const response = await fetchImpl('/api/index', { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`card index unavailable (${response.status})`);
  const decoded = decodeCardIndex(await response.json());
  if (!decoded) throw new Error('card index response is invalid');
  return decoded;
}
