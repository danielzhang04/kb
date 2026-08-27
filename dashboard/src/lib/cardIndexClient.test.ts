import { describe, expect, it, vi } from 'vitest';
import { decodeCardIndex, fetchCardIndex } from './cardIndexClient.ts';

function projection(updatedAt?: string) {
  return {
    meta: { id: 'card-1', state: 'approvals' },
    body: '## Work order\n\nReview it.\n',
    displayName: 'Review it',
    shortRef: 1,
    ...(updatedAt === undefined ? {} : { updatedAt }),
  };
}

describe('cardIndexClient', () => {
  it('accepts legacy projections without updatedAt and validates an additive ISO time when present', () => {
    expect(decodeCardIndex({ cards: { approvals: [projection()] } })?.approvals).toHaveLength(1);
    expect(decodeCardIndex({ cards: { approvals: [projection('2026-08-26T12:00:00.000Z')] } })
      ?.approvals[0]?.updatedAt).toBe('2026-08-26T12:00:00.000Z');
    expect(decodeCardIndex({ cards: { approvals: [projection('not-a-time')] } })).toBeNull();
  });

  it('fetches the existing index endpoint and returns only its decoded card projection', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      cards: { approvals: [projection('2026-08-26T12:00:00.000Z')] },
      ledgers: {},
      orgStates: [],
    }), { status: 200 }));
    const cards = await fetchCardIndex(fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledWith('/api/index', { headers: { accept: 'application/json' } });
    expect(cards.approvals).toHaveLength(1);
  });
});
