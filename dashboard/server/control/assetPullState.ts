// Dashboard v3 P5 §3.2 — the AssetPullIntent record's exact-key walls, closed state machine, and
// collection invariant, mirroring `deploymentState.ts` [P5-C34]. Types-and-validators only; the store
// (`store.ts`) is the sole writer and the service (`deploy/assetPullService.ts`) the sole orchestrator.
import type {
  AssetPullErrorCode,
  AssetPullIntent,
  AssetPullResult,
  AssetPullState,
  CreateAssetPullIntentInput,
  UpdateAssetPullIntentInput,
} from './types.ts';

export const ASSET_PULL_STATES = [
  'pending', 'in-flight', 'succeeded', 'failed', 'offline',
] as const;

const ASSET_PULL_STATE_SET = new Set<string>(ASSET_PULL_STATES);
const TERMINAL_ASSET_PULL_STATES = new Set<AssetPullState>(['succeeded']);
const ASSET_PULL_ERROR_CODES = new Set<string>([
  'unavailable', 'timeout', 'digest-mismatch', 'refused', 'invalid',
]);

/** The closed edge map: a dispatch arms `in-flight`; a settlement lands it; failure/offline re-arm. */
const ASSET_PULL_EDGES = {
  pending: new Set<AssetPullState>(['in-flight']),
  'in-flight': new Set<AssetPullState>(['succeeded', 'failed', 'offline']),
  succeeded: new Set<AssetPullState>(),
  failed: new Set<AssetPullState>(['in-flight']),
  offline: new Set<AssetPullState>(['in-flight']),
} satisfies Record<AssetPullState, ReadonlySet<AssetPullState>>;

export const ASSET_PULL_MAX_ATTEMPTS = 32;

const CREATE_ASSET_PULL_KEYS = [
  'intentRef', 'runRef', 'manifestDigest', 'requestedAt', 'idempotencyKey',
] as const;
const UPDATE_ASSET_PULL_KEYS = [
  'expectedState', 'expectedAttempts', 'nextState', 'attemptsDelta', 'result', 'idempotencyKey',
] as const;
const ASSET_PULL_KEYS = [
  'intentRef', 'runRef', 'manifestDigest', 'state', 'requestedAt', 'attempts', 'result',
] as const;
const ASSET_PULL_RESULT_KEYS = ['outcome', 'receiptAt', 'errorCode'] as const;

const INTENT_REF_RE = /^assetpull-[0-9a-f]{32}$/;
const HEX64_RE = /^[0-9a-f]{64}$/;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return keys.length === sortedExpected.length
    && keys.every((key, index) => key === sortedExpected[index]);
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && !value.includes('\0');
}

export function isCanonicalTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function isAttempts(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= ASSET_PULL_MAX_ATTEMPTS;
}

function isAssetPullState(value: unknown): value is AssetPullState {
  return typeof value === 'string' && ASSET_PULL_STATE_SET.has(value);
}

function isAssetPullResult(value: unknown): value is AssetPullResult {
  return isPlainRecord(value)
    && hasExactKeys(value, ASSET_PULL_RESULT_KEYS)
    && (value.outcome === 'succeeded' || value.outcome === 'failed')
    && isCanonicalTimestamp(value.receiptAt)
    && (value.errorCode === null
      || (typeof value.errorCode === 'string' && ASSET_PULL_ERROR_CODES.has(value.errorCode)));
}

export function canTransitionAssetPull(from: AssetPullState, to: AssetPullState): boolean {
  return ASSET_PULL_EDGES[from].has(to);
}

export function isTerminalAssetPullState(state: AssetPullState): boolean {
  return TERMINAL_ASSET_PULL_STATES.has(state);
}

export function validateCreateAssetPullIntentInput(value: unknown): value is CreateAssetPullIntentInput {
  if (!isPlainRecord(value) || !hasExactKeys(value, CREATE_ASSET_PULL_KEYS)) return false;
  return typeof value.intentRef === 'string' && INTENT_REF_RE.test(value.intentRef)
    && isNonEmpty(value.runRef)
    && typeof value.manifestDigest === 'string' && HEX64_RE.test(value.manifestDigest)
    && isCanonicalTimestamp(value.requestedAt)
    && isNonEmpty(value.idempotencyKey);
}

export function validateUpdateAssetPullIntentInput(value: unknown): value is UpdateAssetPullIntentInput {
  if (!isPlainRecord(value) || !hasExactKeys(value, UPDATE_ASSET_PULL_KEYS)) return false;
  if (!isAssetPullState(value.expectedState) || !isAssetPullState(value.nextState)) return false;
  if (!Number.isSafeInteger(value.expectedAttempts) || Number(value.expectedAttempts) < 0) return false;
  if (value.attemptsDelta !== 0 && value.attemptsDelta !== 1) return false;
  if (!canTransitionAssetPull(value.expectedState, value.nextState)) return false;
  if (!isNonEmpty(value.idempotencyKey)) return false;
  // A dispatch (`in-flight`) never carries a result; a settlement always does.
  if (value.nextState === 'in-flight') {
    if (value.attemptsDelta !== 1 || value.result !== null) return false;
  } else {
    if (value.attemptsDelta !== 0 || !isAssetPullResult(value.result)) return false;
  }
  return true;
}

function isAssetPullIntent(value: unknown): value is AssetPullIntent {
  if (!isPlainRecord(value) || !hasExactKeys(value, ASSET_PULL_KEYS)) return false;
  return typeof value.intentRef === 'string' && INTENT_REF_RE.test(value.intentRef)
    && isNonEmpty(value.runRef)
    && typeof value.manifestDigest === 'string' && HEX64_RE.test(value.manifestDigest)
    && isAssetPullState(value.state)
    && isCanonicalTimestamp(value.requestedAt)
    && isAttempts(value.attempts)
    && (value.result === null || isAssetPullResult(value.result))
    // A `succeeded` intent carries a succeeded result; a `pending` intent has none yet.
    && !(value.state === 'succeeded' && (value.result === null || (value.result as AssetPullResult).outcome !== 'succeeded'))
    && !(value.state === 'pending' && value.result !== null);
}

export function assertAssetPullCollection(value: unknown): void {
  if (!Array.isArray(value)) throw new Error('invalid control-plane asset-pull intents');
  const refs = new Set<string>();
  for (const intent of value) {
    if (!isAssetPullIntent(intent)) throw new Error('invalid control-plane asset-pull intent');
    if (refs.has(intent.intentRef)) throw new Error('invalid control-plane asset-pull intent reference');
    refs.add(intent.intentRef);
  }
}

export type { AssetPullErrorCode };
