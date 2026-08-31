import { describe, expect, it } from 'vitest';
import { fetchInbox } from './inboxClient.ts';

function response(value: unknown, ok = true): Response {
  return new Response(JSON.stringify(value), { status: ok ? 200 : 500, headers: { 'content-type': 'application/json' } });
}

const ISO = '2024-01-12T16:57:07.000Z';
const verified = { status: 'verified' as const, revision: 'f'.repeat(64), verifiedAt: ISO };
const sources4 = { pr: verified, escalation: verified, deployment: verified, assetPull: verified };
function env4(items: unknown[], sources: Record<string, unknown> = sources4) {
  return { items, revision: 'e'.repeat(64), sources };
}
const deploymentItem = {
  id: 'a'.repeat(64), createdAt: ISO, revision: 'deployment:3', kind: 'deployment' as const,
  subject: { deploymentRef: 'deployment-1' }, title: 'Deploy abc — parked', state: 'parked',
  blockingPtyIds: [`pty-${'a'.repeat(32)}`],
};
const deployReadyItem = {
  id: 'b'.repeat(64), createdAt: ISO, revision: `deploy-ready:${'a'.repeat(64)}`, kind: 'deployment' as const,
  subject: { deploymentRef: `deploy-ready:${'a'.repeat(40)}` }, title: 'Deploy ready: aaaaaaaaaaaa',
  state: 'deploy-ready', blockingPtyIds: [] as string[],
};
const assetPullItem = {
  id: 'c'.repeat(64), createdAt: ISO, revision: 'd'.repeat(64), kind: 'asset-pull' as const,
  subject: { intentRef: `assetpull-${'a'.repeat(32)}`, runRef: 'run-9', manifestDigest: 'e'.repeat(64) },
  title: 'Pull assets for run-9', state: 'pending',
};
const deploymentEscalationItem = {
  id: '0'.repeat(64), createdAt: ISO, revision: 'deployment:4', kind: 'deployment-escalation' as const,
  subject: { deploymentRef: 'deployment-1' }, title: 'Deploy swap deadline expired', swapDeadlineAt: ISO,
};

describe('fetchInbox — P5 four-source envelope', () => {
  it('decodes the four sources and the three new item kinds', async () => {
    const body = await fetchInbox(async () =>
      response(env4([deploymentItem, deployReadyItem, assetPullItem, deploymentEscalationItem])) as Response);
    expect(Object.keys(body.sources).sort()).toEqual(['assetPull', 'deployment', 'escalation', 'pr']);
    expect(body.items.map((i) => i.kind).sort()).toEqual(['asset-pull', 'deployment', 'deployment', 'deployment-escalation']);
  });

  it('rejects a deploy-ready item carrying blocking pty ids', async () => {
    const bad = { ...deployReadyItem, blockingPtyIds: [`pty-${'a'.repeat(32)}`] };
    await expect(fetchInbox(async () => response(env4([bad])) as Response)).rejects.toThrow(/invalid inbox/i);
  });

  it('rejects an unknown item kind, an extra key, and a short manifest digest', async () => {
    await expect(fetchInbox(async () => response(env4([{ ...assetPullItem, kind: 'mystery' }])) as Response)).rejects.toThrow(/invalid inbox/i);
    await expect(fetchInbox(async () => response(env4([{ ...deploymentItem, extra: 1 }])) as Response)).rejects.toThrow(/invalid inbox/i);
    await expect(fetchInbox(async () => response(env4([{ ...assetPullItem, subject: { ...assetPullItem.subject, manifestDigest: 'abc' } }])) as Response)).rejects.toThrow(/invalid inbox/i);
  });

  it('rejects a three-source envelope (the deployment/assetPull sources are required)', async () => {
    await expect(fetchInbox(async () => response(env4([], { pr: verified, escalation: verified, deployment: verified })) as Response)).rejects.toThrow(/invalid inbox/i);
  });

  it('builds the ?refresh URL for each of the four sources', async () => {
    for (const source of ['pr', 'escalation', 'deployment', 'assetPull'] as const) {
      const seen: string[] = [];
      await fetchInbox(async (url) => { seen.push(String(url)); return response(env4([])) as Response; }, source);
      expect(seen[0]).toBe(`/api/inbox?refresh=${source}`);
    }
  });
});

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
