import { describe, expect, it } from 'vitest';
import type { CardProjection } from '../planeA/cards.ts';
import type { PlaneAIndex } from '../planeA/indexer.ts';
import {
  compareInboxItems, decodeInboxResponse, inboxItemId, inboxRevision, isLegalEmptyInbox, prHref,
  prSubjectKeyString, type PrSubject, type SourceState,
} from './contracts.ts';
import { inboxFixtureData, p4InboxFixture } from './fixture.ts';
import { projectEscalationSubjects, projectInbox, projectP4Inbox } from './project.ts';

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

const VERIFIED: SourceState = { status: 'verified', revision: 'r', verifiedAt: '2026-08-20T00:00:00.000Z' };

function pr(number: number, createdAt: string, title = `PR ${number}`): PrSubject {
  const subject = { owner: 'kb-owner', repo: 'kb', number };
  return {
    kind: 'pr', id: inboxItemId('pr', prSubjectKeyString(subject)), createdAt,
    revision: `pr-rev-${number}`, subject, title, href: prHref(subject),
  };
}

describe('projectP4Inbox', () => {
  it('projects exactly the PR + escalation union with per-source states and a matching revision', () => {
    const escalations = projectEscalationSubjects(index([card('65a1b2c3-01234567', 'wake-me:runner-failed')]));
    const items = [pr(4, '2026-08-21T00:00:00.000Z')];
    const response = projectP4Inbox({
      pr: { items, state: VERIFIED }, escalation: { items: escalations, state: VERIFIED },
    });

    expect(response.items.map((entry) => entry.kind)).toEqual(['pr', 'escalation']);
    expect(response.sources).toEqual({ pr: VERIFIED, escalation: VERIFIED });
    expect(response.revision).toBe(inboxRevision(response.sources, response.items));
    expect(decodeInboxResponse(JSON.parse(JSON.stringify(response)))).toEqual(response);
  });

  it('sorts by createdAt desc, then kind, then id, and is byte-stable across runs', () => {
    const escalations = projectEscalationSubjects(index([
      card('65a1b2c3-01234567', 'wake-me:a'), card('65a1b2c3-01234568', 'wake-me:b'),
    ]));
    const sameInstant = escalations[0]!.createdAt;
    const sources = {
      pr: { items: [pr(2, '2026-01-01T00:00:00.000Z'), pr(9, sameInstant)], state: VERIFIED },
      escalation: { items: escalations, state: VERIFIED },
    };
    const first = projectP4Inbox(sources);
    expect(JSON.stringify(projectP4Inbox(sources))).toBe(JSON.stringify(first));
    for (let i = 1; i < first.items.length; i += 1) {
      expect(compareInboxItems(first.items[i - 1]!, first.items[i]!)).toBeLessThanOrEqual(0);
    }
    const tied = first.items.filter((entry) => entry.createdAt === sameInstant);
    expect(tied.map((entry) => entry.kind)).toEqual(['escalation', 'escalation', 'pr']);
  });

  it('removes only the merged PR subject and only the completed card escalation', () => {
    const both = projectP4Inbox({
      pr: { items: [pr(4, '2026-08-21T00:00:00.000Z'), pr(6, '2026-08-20T00:00:00.000Z')], state: VERIFIED },
      escalation: {
        items: projectEscalationSubjects(index([card('65a1b2c3-01234567', 'wake-me:x'), card('65a1b2c4-01234567', 'wake-me:y')])),
        state: VERIFIED,
      },
    });
    expect(both.items).toHaveLength(4);

    const after = projectP4Inbox({
      pr: { items: [pr(6, '2026-08-20T00:00:00.000Z')], state: VERIFIED },
      escalation: {
        items: projectEscalationSubjects(index([
          card('65a1b2c3-01234567', 'wake-me:x', 'done'), card('65a1b2c4-01234567', 'wake-me:y'),
        ])),
        state: VERIFIED,
      },
    });
    expect(after.items.map((entry) => entry.kind)).toEqual(['pr', 'escalation']);
    expect(after.items.filter((entry) => entry.kind === 'pr')).toHaveLength(1);
    expect(after.revision).not.toBe(both.revision);
  });

  it('keeps last-good items of the failed source and leaves the other source unaffected', () => {
    const failed: SourceState = { status: 'failed', errorCode: 'timeout', stale: true, revision: 'r' };
    const response = projectP4Inbox({
      pr: { items: [pr(4, '2026-08-21T00:00:00.000Z')], state: failed },
      escalation: { items: projectEscalationSubjects(index([card('65a1b2c3-01234567', 'wake-me:x')])), state: VERIFIED },
    });
    expect(response.sources.pr).toEqual(failed);
    expect(response.sources.escalation).toEqual(VERIFIED);
    expect(response.items).toHaveLength(2);
    expect(isLegalEmptyInbox(response)).toBe(false);
  });

  it('never reports a legal empty inbox while a source is failed with no last-good data', () => {
    const response = projectP4Inbox({
      pr: { items: [], state: { status: 'failed', errorCode: 'unavailable', stale: false } },
      escalation: { items: [], state: VERIFIED },
    });
    expect(response.items).toEqual([]);
    expect(isLegalEmptyInbox(response)).toBe(false);
    expect(isLegalEmptyInbox(projectP4Inbox({
      pr: { items: [], state: VERIFIED }, escalation: { items: [], state: VERIFIED },
    }))).toBe(true);
  });

  it('carries no run subject and no run gate: run and STOP stay escalation links', () => {
    const escalations = projectEscalationSubjects(index([
      card('65a1b2c3-01234567', 'wake-me:run-failed', 'inbox', { 'run-ref': 'run-7', 'stop-event': 'stop-2' }),
    ]));
    const response = projectP4Inbox({ pr: { items: [], state: VERIFIED }, escalation: { items: escalations, state: VERIFIED } });
    expect(response.items.map((entry) => entry.kind)).toEqual(['escalation']);
    expect(response.items).toHaveLength(1);
    expect((response.items[0] as { related: unknown }).related).toEqual({ runRef: 'run-7', stopEvent: 'stop-2' });
    expect(Object.keys(response)).toEqual(['items', 'revision', 'sources']);
    expect(JSON.stringify(response)).not.toMatch(/nextFire|runGate|gate/i);
  });

  it('serves a decodable P4 union fixture beside the current {items} fixture', () => {
    const fixture = p4InboxFixture();
    expect(decodeInboxResponse(JSON.parse(JSON.stringify(fixture)))).toEqual(fixture);
    expect(fixture.items.map((entry) => entry.kind)).toEqual(['pr', 'escalation']);
    expect(inboxFixtureData('inbox-populated').responses[0]).toMatchObject({ status: 200 });
  });
});

// P5 W6.1 §3.1/§3.2 — the four-source envelope [P5-C31].
import {
  projectP5Inbox, inboxRevisionP5, compareP5InboxItems, P5_INBOX_SOURCE_ORDER,
  type P5InboxSourceStates,
} from './project.ts';
import type { DeploymentInboxItem } from './deploymentContracts.ts';
import type { AssetPullInboxItem } from './assetPullSubjects.ts';

const ISO = '2026-08-24T00:00:00.000Z';
const verified = (revision: string): SourceState => ({ status: 'verified', revision, verifiedAt: ISO });
const failed: SourceState = { status: 'failed', errorCode: 'unavailable', stale: false };

function deploymentItem(id: string, state: DeploymentInboxItem['state'] = 'parked'): DeploymentInboxItem {
  return {
    kind: 'deployment', id, createdAt: ISO, revision: 'deployment:3',
    subject: { deploymentRef: 'deployment-1' }, title: 't', state, blockingPtyIds: [] as string[],
  };
}
function assetItem(id: string): AssetPullInboxItem {
  return {
    kind: 'asset-pull', id, createdAt: ISO, revision: 'r',
    subject: { intentRef: `assetpull-${'a'.repeat(32)}`, runRef: 'run-1', manifestDigest: 'd'.repeat(64) },
    title: 't', state: 'pending',
  };
}

describe('projectP5Inbox — four-source envelope', () => {
  const base = {
    pr: { items: [], state: verified('pr') },
    escalation: { items: [], state: verified('esc') },
    deployment: { items: [], state: verified('dep') },
    assetPull: { items: [], state: verified('ap') },
  };

  it('carries the four source keys and folds the revision preimage in canonical order assetPull,deployment,escalation,pr', () => {
    expect([...P5_INBOX_SOURCE_ORDER]).toEqual(['assetPull', 'deployment', 'escalation', 'pr']);
    const response = projectP5Inbox(base);
    expect(Object.keys(response.sources).sort()).toEqual(['assetPull', 'deployment', 'escalation', 'pr']);
    // The revision is exactly the four-source fold of its own inputs.
    expect(response.revision).toBe(inboxRevisionP5(response.sources, response.items));
  });

  it('a failed source keeps the other three verified — never a false empty', () => {
    const response = projectP5Inbox({ ...base, deployment: { items: [], state: failed } });
    expect(response.sources.deployment.status).toBe('failed');
    expect(response.sources.pr.status).toBe('verified');
    expect(response.sources.assetPull.status).toBe('verified');
  });

  it('merges + sorts items from all four arms deterministically', () => {
    const response = projectP5Inbox({
      ...base,
      deployment: { items: [deploymentItem('d'.repeat(64))], state: verified('dep') },
      assetPull: { items: [assetItem('a'.repeat(64))], state: verified('ap') },
    });
    expect(response.items.map((i) => i.kind).sort()).toEqual(['asset-pull', 'deployment']);
  });

  it('the revision changes when any source state changes (four-source coupling)', () => {
    const a = projectP5Inbox(base).revision;
    const b = projectP5Inbox({ ...base, assetPull: { items: [], state: verified('ap-2') } }).revision;
    expect(a).not.toBe(b);
  });

  it('compareP5InboxItems orders by createdAt desc, then kind, then id', () => {
    const older = deploymentItem('a'.repeat(64));
    const newer = { ...deploymentItem('b'.repeat(64)), createdAt: '2026-08-25T00:00:00.000Z' };
    expect(compareP5InboxItems(newer, older)).toBeLessThan(0);
  });
});

// Silence the unused-type lint by referencing the exported state shape.
const _p5states: P5InboxSourceStates | null = null;
void _p5states;
