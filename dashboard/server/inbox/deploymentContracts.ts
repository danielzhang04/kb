// Dashboard v3 P5 — W0 closed contracts for the two new Inbox arms: the deployment subject with its
// single-mutating-control action projection (§3.1), and the asset-pull subject over the movement:256
// AssetPullIntent record (§3.2). Plus the `deployment:<n>` / `deploy-ready:<sha>` revision + ref
// parse/stringify pairs [P5-C28] and the quiescence action payload (§3.7).
//
// Types and strict decoders ONLY — no projector, no resolver, no route, no store mutation (plan §5 W0).
// The action FUNCTION here is total over `DeploymentItemState`; W3 builds the projector that calls it.
import {
  ContractDecodeError, closedObject, requireString, sha256Hex,
} from '../write/durableManifest.ts';
import { DEPLOYMENT_STATES } from '../control/deploymentState.ts';
import type { DeploymentState } from '../control/deploymentState.ts';

// ---------------------------------------------------------------------------------------------------
// Revision + ref parse/stringify [P5-C28, P5-C47, P5-C58].
// ---------------------------------------------------------------------------------------------------

/** `deployment:<n>` — `n` the decimal store revision, no padding, no leading zero. */
export function stringifyDeploymentRevision(revision: number): string {
  if (!Number.isInteger(revision) || revision < 0) {
    throw new ContractDecodeError('revision', 'non-negative integer required');
  }
  return `deployment:${revision}`;
}

const DEPLOYMENT_REVISION = /^deployment:(0|[1-9][0-9]{0,15})$/;

/**
 * The closed parser every stored-record endpoint runs BEFORE any store read, ceremony, or helper call.
 * A bare number, a padded number, a foreign prefix, or an out-of-range value all refuse `invalid-revision`.
 */
export function parseDeploymentRevision(value: string): number {
  const match = typeof value === 'string' ? DEPLOYMENT_REVISION.exec(value) : null;
  if (match === null) throw new ContractDecodeError('invalid-revision', 'deployment:<n> required');
  return Number.parseInt(match[1]!, 10);
}

const HEX64 = /^[0-9a-f]{64}$/;
const HEX40 = /^[0-9a-f]{40}$/;

/** `deploy-ready:` + `sha256(targetSha \0 liveSha)` — the derived candidate revision [§3.1]. */
export function deployReadyRevision(targetSha: string, liveSha: string): string {
  if (!HEX40.test(targetSha)) throw new ContractDecodeError('deployReadyRevision.target', '40 lowercase hex required');
  if (!HEX40.test(liveSha)) throw new ContractDecodeError('deployReadyRevision.live', '40 lowercase hex required');
  return `deploy-ready:${sha256Hex(`${targetSha}\u0000${liveSha}`)}`;
}

const DEPLOY_READY_REVISION = /^deploy-ready:[0-9a-f]{64}$/;
export function isDeployReadyRevision(value: string): boolean {
  return typeof value === 'string' && DEPLOY_READY_REVISION.test(value);
}

/** One closed `:ref` matcher; anything else is `400 invalid-ref` before the revision is even read. */
const DEPLOYMENT_REF = /^(deploy-ready|deployment):[0-9a-f-]{1,64}$/;
export type DeploymentRefKind = 'deploy-ready' | 'deployment';
export function parseDeploymentRef(ref: string): { kind: DeploymentRefKind; ref: string } {
  const match = typeof ref === 'string' ? DEPLOYMENT_REF.exec(ref) : null;
  if (match === null) throw new ContractDecodeError('invalid-ref', 'deploy-ready:<hex> | deployment:<n> required');
  return { kind: match[1] as DeploymentRefKind, ref };
}

// ---------------------------------------------------------------------------------------------------
// Deployment Inbox item + single-mutating-control action projection (§3.1) [P5-C18, P5-C49, P5-C58].
// ---------------------------------------------------------------------------------------------------

/** `DEPLOYMENT_STATES` plus the derived `deploy-ready` projection state [P5-C17]. */
export type DeploymentItemState = DeploymentState | 'deploy-ready';
export const DEPLOYMENT_ITEM_STATES: readonly DeploymentItemState[] = [...DEPLOYMENT_STATES, 'deploy-ready'];

/** design 256 verbatim over the string-`revision` InboxBase (`design:249-253`). */
export interface DeploymentInboxItem {
  readonly kind: 'deployment';
  readonly id: string;
  readonly createdAt: string;
  readonly revision: string;
  readonly subject: { readonly deploymentRef: string };
  readonly title: string;
  readonly state: DeploymentItemState;
  readonly blockingPtyIds: readonly string[];
}

/** `id = sha256("deployment" + "\0" + deploymentRef)` [§3.1, matching `p4-plan:194`]. */
export function deploymentItemId(deploymentRef: string): string {
  return sha256Hex(`deployment\u0000${deploymentRef}`);
}

/** The four T3 verbs plus the two operator-gated mutators [P5-C21, P5-C49]. */
export type DeploymentMutatingVerb =
  | 'confirm' | 'deploy' | 'abort' | 'acknowledge' | 'close-ptys-and-continue';

export interface DeploymentMutatingControl {
  readonly verb: DeploymentMutatingVerb;
  readonly t3: boolean;
  readonly endpoint: string;
}

/**
 * The single-valued action projection. `mutating` is exactly ONE control or `null` — a shape carrying
 * TWO mutating controls cannot be assigned here, which is `design:264`'s "exactly the state-valid action"
 * enforced structurally. Inspect is navigation and is ALWAYS present, so it never competes.
 */
export interface DeploymentAction {
  readonly mutating: DeploymentMutatingControl | null;
  readonly inspect: { readonly kind: 'navigate'; readonly deploymentRef: string };
}

export interface DeploymentActionInput {
  readonly state: DeploymentItemState;
  readonly deploymentRef: string;
  readonly blockingPtyIds: readonly string[];
  readonly abortRequestedAt: string | null;
  /** Only meaningful for `deploy-ready`; `movement:254` splits the entry verb on it [P5-C58]. */
  readonly breaking: boolean;
}

const base = (deploymentRef: string): string => `/api/inbox/deployment/${deploymentRef}`;

/**
 * The total single-valued function of P5-C18 / P5-C58. Conditions are evaluated in the table's order;
 * exactly one mutating control (or none) results, and Inspect always accompanies it. `deploy-ready`
 * carries `blockingPtyIds: []` by construction [P5-C59], so the PTY rule never fires for it.
 */
export function resolveDeploymentAction(input: DeploymentActionInput): DeploymentAction {
  const inspect = { kind: 'navigate' as const, deploymentRef: input.deploymentRef };
  const ref = input.deploymentRef;
  const control = (verb: DeploymentMutatingVerb, t3: boolean, path: string): DeploymentAction => ({
    mutating: { verb, t3, endpoint: `${base(ref)}/${path}` }, inspect,
  });
  const none = (): DeploymentAction => ({ mutating: null, inspect });

  // stored states only; `deploy-ready` carries no blocking ids [P5-C59].
  if (input.state !== 'deploy-ready' && input.blockingPtyIds.length > 0) {
    return control('close-ptys-and-continue', true, 'close-ptys-and-continue');
  }
  switch (input.state) {
    case 'waiting-confirmation':
      return control('confirm', true, 'confirm');
    case 'deploy-ready':
      return input.breaking ? control('confirm', true, 'confirm') : control('deploy', true, 'deploy');
    case 'requested':
    case 'parked':
      return input.abortRequestedAt === null ? control('abort', true, 'abort') : none();
    case 'swapping':
    case 'resuming':
      return none();
    case 'succeeded':
    case 'aborted':
    case 'failed':
      return control('acknowledge', false, 'acknowledge');
    case 'acknowledged':
      return none();
    default:
      return assertNeverState(input.state);
  }
}

function assertNeverState(state: never): never {
  throw new ContractDecodeError('deploymentAction.state', `unmapped deployment state ${JSON.stringify(state)}`);
}

const DEPLOYMENT_ITEM_KEYS = ['kind', 'id', 'createdAt', 'revision', 'subject', 'title', 'state', 'blockingPtyIds'] as const;
const PTY_SESSION_ID = /^pty-[0-9a-f]{32}$/;

export function decodeDeploymentInboxItem(value: unknown): DeploymentInboxItem {
  const record = closedObject(value, DEPLOYMENT_ITEM_KEYS, 'deploymentItem');
  if (record['kind'] !== 'deployment') throw new ContractDecodeError('deploymentItem.kind', "'deployment' required");
  const subject = closedObject(record['subject'], ['deploymentRef'], 'deploymentItem.subject');
  const deploymentRef = requireString(subject, 'deploymentRef', 'deploymentItem.subject');
  const state = record['state'];
  if (!DEPLOYMENT_ITEM_STATES.includes(state as DeploymentItemState)) {
    throw new ContractDecodeError('deploymentItem.state', 'closed deployment item state required');
  }
  const rawPtyIds = record['blockingPtyIds'];
  if (!Array.isArray(rawPtyIds)) throw new ContractDecodeError('deploymentItem.blockingPtyIds', 'array required');
  const blockingPtyIds = rawPtyIds.map((id, index) => {
    if (typeof id !== 'string' || !PTY_SESSION_ID.test(id)) {
      throw new ContractDecodeError(`deploymentItem.blockingPtyIds[${index}]`, 'pty-<32 hex> required');
    }
    return id;
  });
  if (state === 'deploy-ready' && blockingPtyIds.length > 0) {
    throw new ContractDecodeError('deploymentItem.blockingPtyIds', 'deploy-ready carries no blocking ids [P5-C59]');
  }
  const revision = requireString(record, 'revision', 'deploymentItem');
  const id = requireString(record, 'id', 'deploymentItem');
  if (id !== deploymentItemId(deploymentRef)) {
    throw new ContractDecodeError('deploymentItem.id', 'id must be the pinned deploymentRef hash');
  }
  return {
    kind: 'deployment', id, createdAt: requireString(record, 'createdAt', 'deploymentItem'),
    revision, subject: { deploymentRef }, title: requireString(record, 'title', 'deploymentItem'),
    state: state as DeploymentItemState, blockingPtyIds,
  };
}

// ---------------------------------------------------------------------------------------------------
// Asset-pull intent record + Inbox subject (§3.2) [movement:256].
// ---------------------------------------------------------------------------------------------------

export type AssetPullState = 'pending' | 'in-flight' | 'succeeded' | 'failed' | 'offline';
export const ASSET_PULL_STATES: readonly AssetPullState[] = [
  'pending', 'in-flight', 'succeeded', 'failed', 'offline',
];

export type AssetPullResultOutcome = 'succeeded' | 'failed';
export type AssetPullErrorCode = 'unavailable' | 'timeout' | 'digest-mismatch' | 'refused' | 'invalid';
export const ASSET_PULL_ERROR_CODES: readonly AssetPullErrorCode[] = [
  'unavailable', 'timeout', 'digest-mismatch', 'refused', 'invalid',
];

export interface AssetPullResult {
  readonly outcome: AssetPullResultOutcome;
  readonly receiptAt: string;
  readonly errorCode: AssetPullErrorCode | null;
}

/** movement:256 record VERBATIM: `{intentRef,runRef,manifestDigest,state,requestedAt,attempts,result}`. */
export interface AssetPullIntent {
  readonly intentRef: string;
  readonly runRef: string;
  readonly manifestDigest: string;
  readonly state: AssetPullState;
  readonly requestedAt: string;
  readonly attempts: number;
  readonly result: AssetPullResult | null;
}

export const ASSET_PULL_MAX_ATTEMPTS = 32;
const INTENT_REF = /^assetpull-[0-9a-f]{32}$/;
const ASSET_PULL_KEYS = ['intentRef', 'runRef', 'manifestDigest', 'state', 'requestedAt', 'attempts', 'result'] as const;
const ASSET_PULL_RESULT_KEYS = ['outcome', 'receiptAt', 'errorCode'] as const;

export function assetPullItemId(intentRef: string): string {
  return sha256Hex(`asset-pull\u0000${intentRef}`);
}

/** Pull and Retry reuse ONE key so the resident retry loop resends the same key (movement:256). */
export function assetPullIdempotencyKey(intentRef: string, manifestDigest: string): string {
  return `pull-assets:${intentRef}:${manifestDigest}`;
}

function decodeAssetPullResult(value: unknown): AssetPullResult {
  const record = closedObject(value, ASSET_PULL_RESULT_KEYS, 'assetPull.result');
  const outcome = record['outcome'];
  if (outcome !== 'succeeded' && outcome !== 'failed') {
    throw new ContractDecodeError('assetPull.result.outcome', "'succeeded' | 'failed'");
  }
  const errorCode = record['errorCode'];
  if (errorCode !== null && !ASSET_PULL_ERROR_CODES.includes(errorCode as AssetPullErrorCode)) {
    throw new ContractDecodeError('assetPull.result.errorCode', 'closed error code or null required');
  }
  return {
    outcome,
    receiptAt: requireString(record, 'receiptAt', 'assetPull.result'),
    errorCode: errorCode as AssetPullErrorCode | null,
  };
}

export function decodeAssetPullIntent(value: unknown): AssetPullIntent {
  const record = closedObject(value, ASSET_PULL_KEYS, 'assetPull');
  const intentRef = requireString(record, 'intentRef', 'assetPull');
  if (!INTENT_REF.test(intentRef)) throw new ContractDecodeError('assetPull.intentRef', 'assetpull-<32 hex> required');
  const manifestDigest = requireString(record, 'manifestDigest', 'assetPull');
  if (!HEX64.test(manifestDigest)) throw new ContractDecodeError('assetPull.manifestDigest', '64 lowercase hex required');
  const state = record['state'];
  if (!ASSET_PULL_STATES.includes(state as AssetPullState)) {
    throw new ContractDecodeError('assetPull.state', 'closed state required');
  }
  const attempts = record['attempts'];
  if (typeof attempts !== 'number' || !Number.isInteger(attempts) || attempts < 0 || attempts > ASSET_PULL_MAX_ATTEMPTS) {
    throw new ContractDecodeError('assetPull.attempts', `integer in [0, ${ASSET_PULL_MAX_ATTEMPTS}] required`);
  }
  const result = record['result'] === null ? null : decodeAssetPullResult(record['result']);
  return {
    intentRef, runRef: requireString(record, 'runRef', 'assetPull'), manifestDigest,
    state: state as AssetPullState, requestedAt: requireString(record, 'requestedAt', 'assetPull'),
    attempts, result,
  };
}

export type AssetPullMutatingVerb = 'pull' | 'retry';
export interface AssetPullAction {
  readonly mutating: { readonly verb: AssetPullMutatingVerb; readonly endpoint: string } | null;
  readonly inspect: { readonly kind: 'navigate'; readonly intentRef: string };
}

/** Total map: pending⇒Pull, in-flight⇒Inspect only, failed/offline⇒Retry, succeeded⇒item absent [§3.2]. */
export function resolveAssetPullAction(intentRef: string, state: AssetPullState): AssetPullAction {
  const inspect = { kind: 'navigate' as const, intentRef };
  const endpoint = (verb: AssetPullMutatingVerb): string => `/api/inbox/asset-pull/${intentRef}/${verb}`;
  switch (state) {
    case 'pending':
      return { mutating: { verb: 'pull', endpoint: endpoint('pull') }, inspect };
    case 'failed':
    case 'offline':
      return { mutating: { verb: 'retry', endpoint: endpoint('retry') }, inspect };
    case 'in-flight':
    case 'succeeded':
      return { mutating: null, inspect };
    default:
      return assertNeverAssetPullState(state);
  }
}

function assertNeverAssetPullState(state: never): never {
  throw new ContractDecodeError('assetPull.state', `unmapped asset-pull state ${JSON.stringify(state)}`);
}

// ---------------------------------------------------------------------------------------------------
// Quiescence action payload (§3.7) [P5-C7].
// ---------------------------------------------------------------------------------------------------

/**
 * `{deploymentRef, expectedRevision, sessionIds}` plus the T3 assertion whose digest pins
 * `sha256(sorted sessionIds joined by "\0")`. The server re-reads the live set and refuses
 * `409 pty-set-changed` on any difference; it never closes a superset, subset, or re-derived set.
 */
export interface QuiescenceActionPayload {
  readonly deploymentRef: string;
  readonly expectedRevision: string;
  readonly sessionIds: readonly string[];
}

const QUIESCENCE_KEYS = ['deploymentRef', 'expectedRevision', 'sessionIds'] as const;

export function decodeQuiescenceActionPayload(value: unknown): QuiescenceActionPayload {
  const record = closedObject(value, QUIESCENCE_KEYS, 'quiescence');
  const deploymentRef = requireString(record, 'deploymentRef', 'quiescence');
  const expectedRevision = requireString(record, 'expectedRevision', 'quiescence');
  parseDeploymentRevision(expectedRevision); // closed `deployment:<n>` only [P5-C58].
  const rawIds = record['sessionIds'];
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    throw new ContractDecodeError('quiescence.sessionIds', 'non-empty array required');
  }
  const seen = new Set<string>();
  const sessionIds = rawIds.map((id, index) => {
    if (typeof id !== 'string' || !PTY_SESSION_ID.test(id)) {
      throw new ContractDecodeError(`quiescence.sessionIds[${index}]`, 'pty-<32 hex> required');
    }
    if (seen.has(id)) throw new ContractDecodeError('quiescence.sessionIds', 'duplicate session id');
    seen.add(id);
    return id;
  });
  return { deploymentRef, expectedRevision, sessionIds };
}

/** The T3 digest pins the exact live set: `sha256(sorted sessionIds joined by "\0")` (§3.3, §3.7). */
export function quiescenceDigest(sessionIds: readonly string[]): string {
  return sha256Hex([...sessionIds].sort().join('\u0000'));
}
