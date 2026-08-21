import type { InboxProjection } from './project.ts';

export type InboxFixtureScenario = 'inbox-populated' | 'inbox-empty' | 'inbox-error-after-success' | 'events-reconnect-unknown';

export interface InboxFixtureData {
  responses: Array<{ status: 200; body: InboxProjection } | { status: 500; body: { error: string } }>;
  eventFrames: string[];
  holdFirstResponse: boolean;
}

const item = {
  id: '13bcc48f18c38c928f91fa688c85acb939c1de999c2ff68de9ace09eafd73587',
  createdAt: '2024-01-12T16:57:07.000Z',
  revision: '50b7d395274b4b6e34c8b77375e8ac18e4e0a2f3f2d362978371311836911f4c',
  kind: 'escalation' as const,
  subject: { cardId: '65a1b2c3-01234567' },
  related: { runRef: 'run-fixture-1' },
  title: 'wake-me:fixture-failure',
  reason: 'The fixture runner needs a human decision.',
};

const populated: InboxProjection = { items: [item] };
const empty: InboxProjection = { items: [] };
const burst = Array.from({ length: 5 }, (_value, index) => JSON.stringify({ sequence: index + 1 }));

/** Deterministic Inbox-only inputs for W5's closed loopback fixture harness. */
export function inboxFixtureData(scenario: InboxFixtureScenario): InboxFixtureData {
  switch (scenario) {
    case 'inbox-populated':
      return { responses: [{ status: 200, body: populated }], eventFrames: [], holdFirstResponse: false };
    case 'inbox-empty':
      return { responses: [{ status: 200, body: empty }], eventFrames: [], holdFirstResponse: false };
    case 'inbox-error-after-success':
      return { responses: [{ status: 200, body: populated }, { status: 500, body: { error: 'fixture refresh failed' } }], eventFrames: burst, holdFirstResponse: false };
    case 'events-reconnect-unknown':
      return { responses: [{ status: 200, body: populated }, { status: 200, body: populated }], eventFrames: burst, holdFirstResponse: true };
  }
}
