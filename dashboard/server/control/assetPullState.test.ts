import { describe, expect, it } from 'vitest';
import {
  ASSET_PULL_MAX_ATTEMPTS,
  ASSET_PULL_STATES,
  assertAssetPullCollection,
  canTransitionAssetPull,
  isTerminalAssetPullState,
  validateCreateAssetPullIntentInput,
  validateUpdateAssetPullIntentInput,
} from './assetPullState.ts';
import type { AssetPullIntent, AssetPullState } from './types.ts';

const INTENT_REF = `assetpull-${'0'.repeat(32)}`;
const DIGEST = 'a'.repeat(64);
const AT = '2026-08-20T00:00:00.000Z';

const create = {
  intentRef: INTENT_REF, runRef: 'run-1', manifestDigest: DIGEST, requestedAt: AT, idempotencyKey: 'k1',
} as const;

const intent: AssetPullIntent = {
  intentRef: INTENT_REF, runRef: 'run-1', manifestDigest: DIGEST, state: 'pending',
  requestedAt: AT, attempts: 0, result: null,
};

describe('CreateAssetPullIntentInput validation', () => {
  it('accepts a well-formed input', () => {
    expect(validateCreateAssetPullIntentInput(create)).toBe(true);
  });

  it.each([
    ['extra key', { ...create, extra: 1 }],
    ['bad intentRef', { ...create, intentRef: 'assetpull-nope' }],
    ['non-hex digest', { ...create, manifestDigest: 'z'.repeat(64) }],
    ['short digest', { ...create, manifestDigest: 'a'.repeat(63) }],
    ['non-canonical requestedAt', { ...create, requestedAt: '2026-08-20T00:00:00Z' }],
    ['empty runRef', { ...create, runRef: '' }],
  ])('rejects %s', (_name, value) => {
    expect(validateCreateAssetPullIntentInput(value)).toBe(false);
  });
});

describe('UpdateAssetPullIntentInput validation', () => {
  const dispatch = {
    expectedState: 'pending', expectedAttempts: 0, nextState: 'in-flight',
    attemptsDelta: 1, result: null, idempotencyKey: 'k',
  } as const;
  const settle = {
    expectedState: 'in-flight', expectedAttempts: 1, nextState: 'succeeded',
    attemptsDelta: 0, result: { outcome: 'succeeded', receiptAt: AT, errorCode: null }, idempotencyKey: 'k',
  } as const;

  it('accepts a dispatch and a settlement', () => {
    expect(validateUpdateAssetPullIntentInput(dispatch)).toBe(true);
    expect(validateUpdateAssetPullIntentInput(settle)).toBe(true);
    expect(validateUpdateAssetPullIntentInput({ ...settle, nextState: 'failed',
      result: { outcome: 'failed', receiptAt: AT, errorCode: 'timeout' } })).toBe(true);
  });

  it.each([
    ['illegal edge', { ...dispatch, expectedState: 'succeeded', nextState: 'in-flight' }],
    ['dispatch carrying a result', { ...dispatch, result: { outcome: 'succeeded', receiptAt: AT, errorCode: null } }],
    ['settlement with an increment', { ...settle, attemptsDelta: 1 }],
    ['settlement without a result', { ...settle, result: null }],
    ['bad error code', { ...settle, nextState: 'failed', result: { outcome: 'failed', receiptAt: AT, errorCode: 'nope' } }],
    ['extra key', { ...dispatch, extra: 1 }],
  ])('rejects %s', (_name, value) => {
    expect(validateUpdateAssetPullIntentInput(value)).toBe(false);
  });
});

describe('asset-pull state machine', () => {
  it('exposes the closed edge map', () => {
    const allowed = new Set([
      'pending>in-flight', 'in-flight>succeeded', 'in-flight>failed', 'in-flight>offline',
      'failed>in-flight', 'offline>in-flight',
    ]);
    for (const from of ASSET_PULL_STATES) for (const to of ASSET_PULL_STATES) {
      expect(canTransitionAssetPull(from as AssetPullState, to as AssetPullState)).toBe(allowed.has(`${from}>${to}`));
    }
  });

  it('marks only succeeded terminal', () => {
    expect(isTerminalAssetPullState('succeeded')).toBe(true);
    for (const state of ['pending', 'in-flight', 'failed', 'offline'] as const) {
      expect(isTerminalAssetPullState(state)).toBe(false);
    }
  });
});

describe('assertAssetPullCollection', () => {
  it('accepts an empty collection and a valid row', () => {
    expect(() => assertAssetPullCollection([])).not.toThrow();
    expect(() => assertAssetPullCollection([intent])).not.toThrow();
  });

  it.each([
    ['extra field', [{ ...intent, extra: 1 }]],
    ['bad state', [{ ...intent, state: 'nope' }]],
    ['attempts over cap', [{ ...intent, attempts: ASSET_PULL_MAX_ATTEMPTS + 1 }]],
    ['pending with a result', [{ ...intent, result: { outcome: 'succeeded', receiptAt: AT, errorCode: null } }]],
    ['succeeded without a matching result', [{ ...intent, state: 'succeeded', result: null }]],
  ])('rejects %s', (_name, value) => {
    expect(() => assertAssetPullCollection(value)).toThrow(/asset-pull/);
  });

  it('rejects a duplicate intentRef', () => {
    expect(() => assertAssetPullCollection([intent, { ...intent }])).toThrow(/reference/);
  });
});
