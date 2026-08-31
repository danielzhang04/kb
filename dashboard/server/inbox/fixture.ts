import {
  compareInboxItems, inboxItemId, inboxRevision, prHref, prSubjectKeyString, type InboxResponse,
  type P4InboxItem, type SourceState,
} from './contracts.ts';
import type { InboxProjection } from './project.ts';
import { prItemRevision } from './resolvers.ts';

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

// P4 section 3.3: a deterministic instance of the closed PR + escalation union, written beside the
// `{items}` fixture above. W6.1 repoints the browser fixture at this one when the route cuts over.
const PR_SUBJECT = { owner: 'kb-owner', repo: 'kb', number: 4 } as const;
const P4_VERIFIED: SourceState = { status: 'verified', revision: 'fixture-source', verifiedAt: '2026-08-20T12:00:00.000Z' };

const PR_TITLE = 'Fixture pull request awaiting review';
const PR_CREATED_AT = '2026-08-19T10:00:00Z';

// Derived, never hand-typed: the id, the revision and the order all come from the same formulas the
// resolver and the contract use, so a change to any of them moves the fixture with it.
const p4ItemsUnordered: readonly P4InboxItem[] = [
  {
    kind: 'pr',
    id: inboxItemId('pr', prSubjectKeyString(PR_SUBJECT)),
    createdAt: new Date(PR_CREATED_AT).toISOString(),
    revision: prItemRevision(prSubjectKeyString(PR_SUBJECT), PR_TITLE, PR_CREATED_AT),
    subject: PR_SUBJECT,
    title: PR_TITLE,
    href: prHref(PR_SUBJECT),
  },
  {
    ...item,
    id: inboxItemId('escalation', item.subject.cardId),
  },
];
const p4Items: readonly P4InboxItem[] = [...p4ItemsUnordered].sort(compareInboxItems);

/** The P4 union fixture: both sources verified, one subject of each kind, sorted and revisioned. */
export function p4InboxFixture(): InboxResponse {
  const sources = { pr: P4_VERIFIED, escalation: P4_VERIFIED };
  return { items: p4Items, revision: inboxRevision(sources, p4Items), sources };
}

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
