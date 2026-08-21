import { describe, expect, it } from 'vitest';
import type { CardProjection } from '../planeA/cards.ts';
import type { PlaneAIndex } from '../planeA/indexer.ts';
import { inboxFixtureData } from './fixture.ts';
import { projectInbox } from './project.ts';

function card(id: string, action: string, state = 'inbox', extra: Record<string, string> = {}): CardProjection {
  return {
    meta: { id, project: 'kb', action, target: '.', 'risk-tier': 'T1', owner: null, state, ...extra },
    body: '## Work order\n\nDecide who owns the recovery.\n',
    displayName: action,
    shortRef: 1,
  };
}

function index(cards: CardProjection[]): PlaneAIndex {
  return {
    cards: { inbox: cards },
    ledgers: {
      dispatch: { count: 0, cards: 0, byProject: {} },
      cost: { stepCount: 0, perModelSteps: {}, modelMix: {} } as unknown as PlaneAIndex['ledgers']['cost'],
      grades: { count: 0, rows: [] },
      activity: { count: 0, rows: [] },
    },
    orgStates: [],
  };
}

describe('projectInbox', () => {
  it('projects only escalation items with pinned subject.cardId', () => {
    // Frozen SHA-256 vectors derived once from sha256("escalation\\0" + meta.id) and
    // sha256(JSON.stringify([sorted meta entries, body])) for this literal W1 contract card.
    const escalation: CardProjection = {
      meta: {
        id: '65a1b2c3-01234567', project: 'kb', action: 'wake-me:runner-failed', target: '.',
        'risk-tier': 'T1', owner: null, state: 'inbox', 'run-ref': 'run-7', 'stop-event': 'stop-2',
      },
      body: '## Work order\n\nDecide who owns the recovery.\n',
      displayName: 'wake-me:runner-failed',
      shortRef: 1,
    };
    const id = '65a1b2c3-01234567';
    const goldenId = '13bcc48f18c38c928f91fa688c85acb939c1de999c2ff68de9ace09eafd73587';
    const goldenRevision = '721b3614df89f98d1d8567970571e4f4f734b50e0919db7ab059123dec490d2f';
    const result = projectInbox(index([
      escalation,
      card('65a1b2c4-01234567', 'approve:release', 'inbox'),
      card('65a1b2c5-01234567', 'wake-me:already-resolved', 'done'),
    ]));

    expect(result).toEqual({
      items: [{
        id: goldenId,
        createdAt: new Date(0x65a1b2c3 * 1000).toISOString(),
        revision: goldenRevision,
        kind: 'escalation',
        subject: { cardId: id },
        related: { runRef: 'run-7', stopEvent: 'stop-2' },
        title: 'wake-me:runner-failed',
        reason: 'Decide who owns the recovery.',
      }],
    });
  });

  it('keeps each optional related reference independently', () => {
    expect(projectInbox(index([
      card('65a1b2c3-01234567', 'wake-me:run-only', 'inbox', { 'run-ref': 'run-7' }),
      card('65a1b2c4-01234567', 'wake-me:stop-only', 'inbox', { 'stop-event': 'stop-2' }),
    ])).items.map(({ related }) => related)).toEqual([{ runRef: 'run-7' }, { stopEvent: 'stop-2' }]);
  });

  it('excludes done wake-me cards and malformed card ids without failing the projection', () => {
    expect(projectInbox(index([
      card('65a1b2c3-01234567', 'wake-me:done', 'done'),
      card('zzzz0000-abcd1234', 'wake-me:bad-id'),
    ]))).toEqual({ items: [] });
  });

  it('provides deterministic populated, empty, failure, and burst fixture data', () => {
    expect(inboxFixtureData('inbox-populated').responses).toHaveLength(1);
    expect(inboxFixtureData('inbox-empty').responses[0]).toEqual({ status: 200, body: { items: [] } });
    expect(inboxFixtureData('inbox-error-after-success').responses).toHaveLength(2);
    expect(inboxFixtureData('events-reconnect-unknown')).toMatchObject({ holdFirstResponse: true, eventFrames: expect.any(Array) });
  });

  it('never reads a reason from Evidence', () => {
    const escalation = {
      ...card('65a1b2c3-abcdef01', 'wake-me:source-failed'),
      body: '## Work order\n\nSafe reason.\n\n## Evidence\n\n> Untrusted payload.\n',
    };
    expect(projectInbox(index([escalation])).items[0]?.reason).toBe('Safe reason.');
  });
});
