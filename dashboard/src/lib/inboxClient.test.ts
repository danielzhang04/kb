import { describe, expect, it } from 'vitest';
import { fetchInbox } from './inboxClient.ts';

function response(value: unknown, ok = true): Response {
  return new Response(JSON.stringify(value), { status: ok ? 200 : 500, headers: { 'content-type': 'application/json' } });
}

const item = {
  id: 'a'.repeat(64),
  createdAt: '2024-01-12T16:57:07.000Z',
  revision: 'b'.repeat(64),
  kind: 'escalation',
  subject: { cardId: '65a1b2c3-01234567' },
  related: {},
  title: 'wake-me:runner-failed',
  reason: 'A runner stopped.',
};

describe('fetchInbox', () => {
  it('rejects retired item fields and malformed subjects', async () => {
    for (const field of ['category', 'urgency', 'status', 'nextAction', 'context', 'buttons', 'reply', 'unknownExtra']) {
      await expect(fetchInbox(async () => response({ items: [{ ...item, [field]: 'rejected' }] }) as Response)).rejects.toThrow(/invalid inbox/i);
    }
    await expect(fetchInbox(async () => response({ items: [{ ...item, subject: {} }] }) as Response)).rejects.toThrow(/invalid inbox/i);
    await expect(fetchInbox(async () => response({ items: [{ ...item, subject: { ...item.subject, unknownExtra: true } }] }) as Response)).rejects.toThrow(/invalid inbox/i);
    await expect(fetchInbox(async () => response({ items: [{ ...item, subject: { cardId: 'zzzz0000-abcd1234' } }] }) as Response)).rejects.toThrow(/invalid inbox/i);
    await expect(fetchInbox(async () => response({ items: [], unknownExtra: true }) as Response)).rejects.toThrow(/invalid inbox/i);
  });
});
