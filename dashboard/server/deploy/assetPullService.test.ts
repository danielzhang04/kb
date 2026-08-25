import { describe, expect, it } from 'vitest';
import { createInMemoryControlPlaneStore } from '../control/store.ts';
import type { CreateAssetPullIntentInput } from '../control/types.ts';
import { AssetPullService, assetPullIdempotencyKey } from './assetPullService.ts';

const INTENT_REF = `assetpull-${'0'.repeat(32)}`;
const DIGEST = 'a'.repeat(64);
const NOW = '2026-08-20T00:00:00.000Z';
const KEY = assetPullIdempotencyKey(INTENT_REF, DIGEST);

const createInput: CreateAssetPullIntentInput = {
  intentRef: INTENT_REF, runRef: 'run-1', manifestDigest: DIGEST,
  requestedAt: NOW, idempotencyKey: 'pull-create-1',
};

function service() {
  const store = createInMemoryControlPlaneStore();
  const svc = new AssetPullService({ store, now: () => new Date(NOW) });
  svc.create(createInput);
  return { store, svc };
}

describe('AssetPullService', () => {
  it('creates a pending intent with zero attempts', () => {
    const { store } = service();
    expect(store.getAssetPullIntent(INTENT_REF)).toMatchObject({
      ok: true, value: { state: 'pending', attempts: 0, result: null },
    });
  });

  it('creates the intent idempotently on the same intentRef', () => {
    const { svc } = service();
    const replay = svc.create(createInput);
    expect(replay.replayed).toBe(true);
  });

  it('Pull arms in-flight under the pinned key and increments attempts once', () => {
    const { svc } = service();
    const dispatched = svc.pull(INTENT_REF);
    expect(dispatched).toMatchObject({ replayed: false, idempotencyKey: KEY });
    expect(dispatched.intent).toMatchObject({ state: 'in-flight', attempts: 1 });
  });

  it('Pull is idempotent while already in-flight — one key, no second increment', () => {
    const { svc } = service();
    svc.pull(INTENT_REF);
    const again = svc.pull(INTENT_REF);
    expect(again).toMatchObject({ replayed: true, idempotencyKey: KEY });
    expect(again.intent.attempts).toBe(1);
  });

  it('settles a succeeded receipt', () => {
    const { svc } = service();
    svc.pull(INTENT_REF);
    const settled = svc.settle(INTENT_REF, 'succeeded');
    expect(settled).toMatchObject({
      state: 'succeeded', result: { outcome: 'succeeded', receiptAt: NOW, errorCode: null },
    });
  });

  it('Retry re-arms only from failed|offline and reuses the same key', () => {
    const { svc } = service();
    svc.pull(INTENT_REF);
    svc.settle(INTENT_REF, 'failed', 'timeout');
    const retried = svc.retry(INTENT_REF);
    expect(retried).toMatchObject({ replayed: false, idempotencyKey: KEY });
    expect(retried.intent).toMatchObject({ state: 'in-flight', attempts: 2 });
  });

  it('refuses an out-of-state Pull or Retry', () => {
    const { svc } = service();
    svc.pull(INTENT_REF);
    svc.settle(INTENT_REF, 'failed', 'timeout');
    expect(() => svc.pull(INTENT_REF)).toThrow(expect.objectContaining({ code: 'invalid-state' }));
    const fresh = service();
    expect(() => fresh.svc.retry(INTENT_REF)).toThrow(expect.objectContaining({ code: 'invalid-state' }));
  });

  it('caps attempts at 32 and then refuses Retry as attempts-exhausted', () => {
    const { svc, store } = service();
    for (let i = 0; i < 32; i += 1) {
      if (i === 0) svc.pull(INTENT_REF); else svc.retry(INTENT_REF);
      svc.settle(INTENT_REF, 'failed', 'timeout');
    }
    expect(store.getAssetPullIntent(INTENT_REF)).toMatchObject({ ok: true, value: { attempts: 32, state: 'failed' } });
    expect(() => svc.retry(INTENT_REF)).toThrow(expect.objectContaining({ code: 'attempts-exhausted', status: 409 }));
  });

  it('surfaces not-found for an unknown intent', () => {
    const { svc } = service();
    expect(() => svc.pull(`assetpull-${'1'.repeat(32)}`)).toThrow(expect.objectContaining({ code: 'not-found' }));
  });
});
