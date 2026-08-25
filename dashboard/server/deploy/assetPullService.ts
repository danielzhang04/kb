// Dashboard v3 P5 §3.2 — the AssetPull service adapter [movement:256].
//
// Pull (from `pending`) and Retry (from `failed|offline`) both arm one `in-flight` dispatch under the
// single idempotency key `pull-assets:<intentRef>:<manifestDigest>`, which the route hands to the
// desktop helper so the resident retry loop resends the SAME key until the helper reports success or
// failure. The intent's own `(state, attempts)` are its idempotency ledger: a repeated Pull while the
// intent is already `in-flight` converges on the current row with no second increment, and the
// attempt count is hard-capped at 32. `settle()` lands the helper receipt. No swap, no activation —
// every asset-pull write commits at ordinary durability in the store.
import type { ControlPlaneStore } from '../control/store.ts';
import type { AssetPullErrorCode, AssetPullIntent, ControlResult, CreateAssetPullIntentInput } from '../control/types.ts';
import { ASSET_PULL_MAX_ATTEMPTS } from '../control/assetPullState.ts';

export type AssetPullServiceCode =
  | 'not-found'
  | 'invalid-state'
  | 'attempts-exhausted'
  | 'conflict'
  | 'idempotency-conflict'
  | 'invalid';

export class AssetPullServiceError extends Error {
  readonly status: number;
  readonly code: AssetPullServiceCode;

  constructor(status: number, code: AssetPullServiceCode, message: string = code) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = 'AssetPullServiceError';
  }
}

export interface AssetPullServiceOptions {
  store: ControlPlaneStore;
  now?: () => Date;
}

export interface AssetPullDispatch {
  intent: AssetPullIntent;
  /** The pinned key the route sends to the helper; stable across the resident retry loop. */
  idempotencyKey: string;
  /** True when a concurrent/repeat Pull or Retry converged on the already-armed in-flight row. */
  replayed: boolean;
}

const ASSET_PULL_SUBJECT = 'asset-pull';

/** `pull-assets:<intentRef>:<manifestDigest>` — Pull and Retry reuse ONE key (movement:256). */
export function assetPullIdempotencyKey(intentRef: string, manifestDigest: string): string {
  return `pull-assets:${intentRef}:${manifestDigest}`;
}

// Derived from the store's actual result type [P5-C46/C58 idiom, per quiescence.ts:50] rather than
// hand-declared, so this stays total over every reason `ControlPlaneStore`'s AssetPullIntent methods
// can ever return — not just the four this module's own writes happen to produce today.
type StoreFail = Extract<ControlResult<AssetPullIntent>, { ok: false }>;

function refuse(result: StoreFail): AssetPullServiceError {
  switch (result.reason) {
    case 'not-found': return new AssetPullServiceError(404, 'not-found', result.detail);
    case 'invalid': return new AssetPullServiceError(400, 'invalid', result.detail);
    case 'idempotency-conflict': return new AssetPullServiceError(409, 'idempotency-conflict', result.detail);
    case 'conflict': return new AssetPullServiceError(409, 'conflict', result.detail);
    // `not-approved` / `limit` / `ineligible` belong to other control-plane subjects (proposals, run
    // activation) and the AssetPullIntent store methods never produce them; refused as a generic
    // conflict so the mapping is total without minting a new AssetPull service code.
    case 'not-approved':
    case 'limit':
    case 'ineligible':
      return new AssetPullServiceError(409, 'conflict', result.detail);
  }
}

export class AssetPullService {
  private readonly store: ControlPlaneStore;
  private readonly now: () => Date;

  constructor(options: AssetPullServiceOptions) {
    this.store = options.store;
    this.now = options.now ?? (() => new Date());
  }

  create(input: CreateAssetPullIntentInput): { intent: AssetPullIntent; replayed: boolean } {
    const result = this.store.createAssetPullIntent(ASSET_PULL_SUBJECT, input);
    if (!result.ok) throw refuse(result);
    return { intent: result.value, replayed: result.replayed === true };
  }

  /** Pull home — only from `pending`. Idempotent while already `in-flight`. */
  pull(intentRef: string): AssetPullDispatch {
    return this.dispatch(intentRef, ['pending']);
  }

  /** Retry — only from `failed|offline`. Idempotent while already `in-flight`. */
  retry(intentRef: string): AssetPullDispatch {
    return this.dispatch(intentRef, ['failed', 'offline']);
  }

  /** Land the helper receipt: `in-flight → succeeded|failed|offline`. */
  settle(
    intentRef: string,
    outcome: 'succeeded' | 'failed' | 'offline',
    errorCode: AssetPullErrorCode | null = null,
  ): AssetPullIntent {
    const current = this.read(intentRef);
    if (current.state !== 'in-flight') throw new AssetPullServiceError(409, 'invalid-state');
    const receiptAt = this.now().toISOString();
    const result = this.store.updateAssetPullIntent(ASSET_PULL_SUBJECT, intentRef, {
      expectedState: 'in-flight',
      expectedAttempts: current.attempts,
      nextState: outcome === 'offline' ? 'offline' : outcome,
      attemptsDelta: 0,
      result: outcome === 'succeeded'
        ? { outcome: 'succeeded', receiptAt, errorCode: null }
        : { outcome: 'failed', receiptAt, errorCode },
      idempotencyKey: assetPullIdempotencyKey(intentRef, current.manifestDigest),
    });
    if (!result.ok) throw refuse(result);
    return result.value;
  }

  private dispatch(intentRef: string, from: AssetPullIntent['state'][]): AssetPullDispatch {
    const current = this.read(intentRef);
    const idempotencyKey = assetPullIdempotencyKey(intentRef, current.manifestDigest);
    // Already armed: a repeat Pull/Retry converges on the in-flight row with no second increment.
    if (current.state === 'in-flight') return { intent: current, idempotencyKey, replayed: true };
    if (!from.includes(current.state)) throw new AssetPullServiceError(409, 'invalid-state');
    if (current.attempts >= ASSET_PULL_MAX_ATTEMPTS) throw new AssetPullServiceError(409, 'attempts-exhausted');
    const result = this.store.updateAssetPullIntent(ASSET_PULL_SUBJECT, intentRef, {
      expectedState: current.state,
      expectedAttempts: current.attempts,
      nextState: 'in-flight',
      attemptsDelta: 1,
      result: null,
      idempotencyKey,
    });
    if (result.ok) return { intent: result.value, idempotencyKey, replayed: false };
    // A concurrent dispatch won the CAS: re-read and converge if it armed the same in-flight row.
    if (result.reason === 'conflict') {
      const settled = this.store.getAssetPullIntent(intentRef);
      if (settled.ok && settled.value.state === 'in-flight') {
        return { intent: settled.value, idempotencyKey, replayed: true };
      }
    }
    throw refuse(result);
  }

  private read(intentRef: string): AssetPullIntent {
    const result = this.store.getAssetPullIntent(intentRef);
    if (!result.ok) throw refuse(result);
    return result.value;
  }
}
