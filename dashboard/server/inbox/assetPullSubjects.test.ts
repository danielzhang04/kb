import { describe, expect, it } from 'vitest';
import { ContractDecodeError } from '../write/durableManifest.ts';
import { decodeAssetPullIntent, resolveAssetPullAction } from './deploymentContracts.ts';
import type { AssetPullIntent } from './deploymentContracts.ts';
import {
  projectAssetPullItem, projectAssetPullSubjects, type AssetPullIntentsReaderPort,
} from './assetPullSubjects.ts';

const INTENT_REF = `assetpull-${'a'.repeat(32)}`;
const MANIFEST_DIGEST = 'f'.repeat(64);

function makeIntent(overrides: Partial<AssetPullIntent> = {}): AssetPullIntent {
  return {
    intentRef: INTENT_REF,
    runRef: 'run-1',
    manifestDigest: MANIFEST_DIGEST,
    state: 'pending',
    requestedAt: '2026-08-25T00:00:00.000Z',
    attempts: 0,
    result: null,
    ...overrides,
  };
}

describe('total action map, no store write', () => {
  it('pending projects an item that offers Pull', () => {
    const item = projectAssetPullItem(makeIntent({ state: 'pending' }));
    expect(item?.state).toBe('pending');
    expect(resolveAssetPullAction(INTENT_REF, 'pending').mutating?.verb).toBe('pull');
  });

  it('in-flight projects an item with Inspect only (no mutating control)', () => {
    const item = projectAssetPullItem(makeIntent({ state: 'in-flight', attempts: 1 }));
    expect(item?.state).toBe('in-flight');
    expect(resolveAssetPullAction(INTENT_REF, 'in-flight').mutating).toBeNull();
  });

  it('failed and offline both offer Retry and stay visible/retryable', () => {
    for (const state of ['failed', 'offline'] as const) {
      const item = projectAssetPullItem(makeIntent({
        state, attempts: 2,
        result: { outcome: 'failed', receiptAt: '2026-08-25T00:05:00.000Z', errorCode: 'timeout' },
      }));
      expect(item).not.toBeNull();
      expect(resolveAssetPullAction(INTENT_REF, state).mutating?.verb).toBe('retry');
    }
  });

  it('succeeded vanishes from the Inbox (design 266)', () => {
    const item = projectAssetPullItem(makeIntent({
      state: 'succeeded', attempts: 1,
      result: { outcome: 'succeeded', receiptAt: '2026-08-25T00:05:00.000Z', errorCode: null },
    }));
    expect(item).toBeNull();
  });
});

describe('projector performs no store write', () => {
  it('a reader double with extra throwing write-shaped methods is never invoked beyond listAssetPullIntents', () => {
    const reader: AssetPullIntentsReaderPort & Record<string, unknown> = {
      listAssetPullIntents: () => [makeIntent({ state: 'pending' }), makeIntent({
        intentRef: `assetpull-${'b'.repeat(32)}`, state: 'failed', attempts: 3,
        result: { outcome: 'failed', receiptAt: '2026-08-25T00:05:00.000Z', errorCode: 'refused' },
      })],
      createAssetPullIntent: () => { throw new Error('BUG: projector must never write'); },
      transitionAssetPullIntent: () => { throw new Error('BUG: projector must never write'); },
    };
    expect(() => projectAssetPullSubjects(reader)).not.toThrow();
    const result = projectAssetPullSubjects(reader);
    expect(result.items).toHaveLength(2);
    expect(result.state).toEqual({ status: 'ok' });
  });
});

describe('a failed asset-pull source yields a source-failure row, never a false empty', () => {
  it('a throwing reader returns items:[] with state failed', () => {
    const result = projectAssetPullSubjects({ listAssetPullIntents: () => { throw new Error('boom'); } });
    expect(result.items).toEqual([]);
    expect(result.state).toEqual({ status: 'failed', errorCode: 'unavailable' });
  });

  it('a genuinely empty reader is the legitimate ok-empty case', () => {
    const result = projectAssetPullSubjects({ listAssetPullIntents: () => [] });
    expect(result.items).toEqual([]);
    expect(result.state).toEqual({ status: 'ok' });
  });
});

describe('deterministic ids and sort', () => {
  it('sorts by id, stably across repeated calls', () => {
    const intents = [
      makeIntent({ intentRef: `assetpull-${'1'.repeat(32)}`, runRef: 'run-a' }),
      makeIntent({ intentRef: `assetpull-${'2'.repeat(32)}`, runRef: 'run-b' }),
    ];
    const build = () => projectAssetPullSubjects({ listAssetPullIntents: () => intents });
    const first = build();
    const second = build();
    expect(first.items.map((i) => i.id)).toEqual(second.items.map((i) => i.id));
    const sorted = [...first.items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    expect(first.items.map((i) => i.id)).toEqual(sorted.map((i) => i.id));
  });
});

describe('negative: no run-gate/next-fire/read/snooze/archive field can decode as the intent record', () => {
  it('decodeAssetPullIntent refuses an intent carrying any Home/Approvals-shaped extra field', () => {
    const base = makeIntent();
    for (const extra of [
      { runGate: true }, { nextFireAt: '2026-08-25T00:00:00.000Z' }, { read: false },
      { snoozedUntil: '2026-08-25T00:00:00.000Z' }, { archived: false },
    ]) {
      expect(() => decodeAssetPullIntent({ ...base, ...extra })).toThrow(ContractDecodeError);
    }
  });
});
