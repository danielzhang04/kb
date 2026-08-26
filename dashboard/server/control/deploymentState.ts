import type {
  CreateDeploymentInput,
  Deployment,
  DeploymentAcknowledgement,
  DeploymentProgress,
  DeploymentTerminalOutcome,
  DeploymentTransitionPatch,
  TransitionDeploymentInput,
} from './types.ts';
import { MAX_DEPLOYMENT_OPERATION_RECEIPTS } from './controlPlaneLimits.ts';
import { hasExactKeys, isCanonicalTimestamp, isNonEmpty, isPlainRecord } from './recordShape.ts';

export { isCanonicalTimestamp };

export const DEPLOYMENT_STATES = [
  'waiting-confirmation',
  'requested',
  'parked',
  'swapping',
  'resuming',
  'succeeded',
  'aborted',
  'failed',
  'acknowledged',
] as const;

export type DeploymentState = typeof DEPLOYMENT_STATES[number];

const DEPLOYMENT_STATE_SET = new Set<string>(DEPLOYMENT_STATES);
const TERMINAL_DEPLOYMENT_STATES = new Set<DeploymentState>([
  'succeeded', 'aborted', 'failed', 'acknowledged',
]);
const OUTCOME_DEPLOYMENT_STATES = new Set<DeploymentState>(['succeeded', 'aborted', 'failed']);

const DEPLOYMENT_EDGES = {
  'waiting-confirmation': new Set<DeploymentState>(['requested', 'aborted']),
  requested: new Set<DeploymentState>(['parked', 'aborted', 'failed']),
  parked: new Set<DeploymentState>(['swapping', 'aborted', 'failed']),
  swapping: new Set<DeploymentState>(['resuming', 'aborted', 'failed']),
  resuming: new Set<DeploymentState>(['succeeded', 'aborted', 'failed']),
  succeeded: new Set<DeploymentState>(['acknowledged']),
  aborted: new Set<DeploymentState>(['acknowledged']),
  failed: new Set<DeploymentState>(['acknowledged']),
  acknowledged: new Set<DeploymentState>(),
} satisfies Record<DeploymentState, ReadonlySet<DeploymentState>>;

const CREATE_KEYS = [
  'deploymentRef', 'idempotencyKey', 'initialState', 'parkWarnAt', 'previousCommit',
  'requestedAt', 'targetCommit',
] as const;
const TRANSITION_KEYS = [
  'expectedRevision', 'expectedState', 'idempotencyKey', 'nextState', 'patch',
] as const;
const DEPLOYMENT_KEYS = [
  'abortRequestedAt', 'acknowledgedBy', 'blockers', 'deploymentRef', 'drainAcks', 'error',
  'fenceRevision', 'parkWarnAt', 'previousCommit', 'progress', 'requestedAt', 'revision',
  'state', 'swapDeadlineAt', 'targetCommit', 'terminalOutcome',
] as const;
const STORED_DEPLOYMENT_KEYS = [...DEPLOYMENT_KEYS, 'operationReceipts'] as const;
const PATCH_FIELDS = [
  'swapDeadlineAt', 'blockers', 'progress', 'abortRequestedAt', 'error',
  'terminalOutcome', 'acknowledgedBy',
] as const;

function assertNever(value: never): never {
  throw new Error(`unhandled deployment state ${String(value)}`);
}

function isNullableTimestamp(value: unknown): value is string | null {
  return value === null || isCanonicalTimestamp(value);
}

function isDeploymentState(value: unknown): value is DeploymentState {
  return typeof value === 'string' && DEPLOYMENT_STATE_SET.has(value);
}

function isProgress(value: unknown): value is DeploymentProgress {
  return isPlainRecord(value)
    && hasExactKeys(value, ['attemptRef', 'detail', 'kind', 'since'])
    && ['idle', 'waiting-attempt', 'parked', 'swapping', 'rehydrating'].includes(String(value.kind))
    && (value.attemptRef === null || isNonEmpty(value.attemptRef))
    && isNullableTimestamp(value.since)
    && (value.detail === null || typeof value.detail === 'string');
}

function isTerminalOutcome(value: unknown): value is DeploymentTerminalOutcome {
  return isPlainRecord(value)
    && hasExactKeys(value, ['at', 'by', 'kind'])
    && ['succeeded', 'aborted', 'failed'].includes(String(value.kind))
    && isCanonicalTimestamp(value.at)
    && isNonEmpty(value.by);
}

function isAcknowledgement(value: unknown): value is DeploymentAcknowledgement {
  return isPlainRecord(value)
    && hasExactKeys(value, ['at', 'subject'])
    && isNonEmpty(value.subject)
    && isCanonicalTimestamp(value.at);
}

function isDrainAcks(value: unknown): value is Deployment['drainAcks'] {
  if (!isPlainRecord(value)) return false;
  return Object.entries(value).every(([participant, ack]) => isNonEmpty(participant)
    && isPlainRecord(ack)
    && hasExactKeys(ack, ['acknowledgedAt', 'fenceRevision'])
    && Number.isSafeInteger(ack.fenceRevision) && Number(ack.fenceRevision) >= 0
    && isCanonicalTimestamp(ack.acknowledgedAt));
}

function isBlockers(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmpty);
}

function meaningfulPatchFields(nextState: DeploymentState): ReadonlySet<string> {
  switch (nextState) {
    case 'waiting-confirmation': return new Set();
    case 'requested': return new Set(['blockers', 'progress']);
    case 'parked': return new Set(['blockers', 'progress']);
    case 'swapping': return new Set(['swapDeadlineAt', 'blockers', 'progress']);
    case 'resuming': return new Set(['blockers', 'progress']);
    case 'succeeded': return new Set(['progress', 'terminalOutcome']);
    case 'aborted': return new Set(['abortRequestedAt', 'error', 'terminalOutcome']);
    case 'failed': return new Set(['error', 'terminalOutcome']);
    case 'acknowledged': return new Set(['acknowledgedBy']);
    default: return assertNever(nextState);
  }
}

export function canTransitionDeployment(from: DeploymentState, to: DeploymentState): boolean {
  return DEPLOYMENT_EDGES[from].has(to);
}

export function isTerminalDeploymentState(state: DeploymentState): boolean {
  return TERMINAL_DEPLOYMENT_STATES.has(state);
}

export function validateCreateDeploymentInput(value: unknown): value is CreateDeploymentInput {
  if (!isPlainRecord(value) || !hasExactKeys(value, CREATE_KEYS)) return false;
  return isNonEmpty(value.deploymentRef)
    && (value.initialState === 'waiting-confirmation' || value.initialState === 'requested')
    && typeof value.targetCommit === 'string' && /^[a-f0-9]{40}$/.test(value.targetCommit)
    && typeof value.previousCommit === 'string' && /^[a-f0-9]{40}$/.test(value.previousCommit)
    && value.targetCommit !== value.previousCommit
    && isCanonicalTimestamp(value.requestedAt)
    && isCanonicalTimestamp(value.parkWarnAt)
    && Date.parse(value.parkWarnAt) > Date.parse(value.requestedAt)
    && isNonEmpty(value.idempotencyKey);
}

export function validateDeploymentTransitionPatch(
  nextState: DeploymentState,
  value: unknown,
): value is DeploymentTransitionPatch {
  if (!isPlainRecord(value)) return false;
  const allowed = meaningfulPatchFields(nextState);
  if (Object.keys(value).some((key) => !(PATCH_FIELDS as readonly string[]).includes(key) || !allowed.has(key))) {
    return false;
  }
  if (Object.hasOwn(value, 'swapDeadlineAt') && !isNullableTimestamp(value.swapDeadlineAt)) return false;
  if (Object.hasOwn(value, 'blockers') && !isBlockers(value.blockers)) return false;
  if (Object.hasOwn(value, 'progress') && !isProgress(value.progress)) return false;
  if (Object.hasOwn(value, 'abortRequestedAt') && !isNullableTimestamp(value.abortRequestedAt)) return false;
  if (Object.hasOwn(value, 'error') && value.error !== null && typeof value.error !== 'string') return false;
  if (Object.hasOwn(value, 'terminalOutcome')) {
    if (value.terminalOutcome !== null && !isTerminalOutcome(value.terminalOutcome)) return false;
    if (value.terminalOutcome !== null && value.terminalOutcome.kind !== nextState) return false;
  }
  if (Object.hasOwn(value, 'acknowledgedBy')
    && value.acknowledgedBy !== null && !isAcknowledgement(value.acknowledgedBy)) return false;
  if (OUTCOME_DEPLOYMENT_STATES.has(nextState)
    && (!Object.hasOwn(value, 'terminalOutcome') || !isTerminalOutcome(value.terminalOutcome))) return false;
  if (nextState === 'acknowledged'
    && (!Object.hasOwn(value, 'acknowledgedBy') || !isAcknowledgement(value.acknowledgedBy))) return false;
  return true;
}

export function validateTransitionDeploymentInput(value: unknown): value is TransitionDeploymentInput {
  return isPlainRecord(value)
    && hasExactKeys(value, TRANSITION_KEYS)
    && Number.isSafeInteger(value.expectedRevision) && Number(value.expectedRevision) >= 0
    && isDeploymentState(value.expectedState)
    && isDeploymentState(value.nextState)
    && isNonEmpty(value.idempotencyKey)
    && validateDeploymentTransitionPatch(value.nextState, value.patch);
}

function isDeployment(value: unknown, stored: boolean): value is Deployment {
  if (!isPlainRecord(value) || !hasExactKeys(value, stored ? STORED_DEPLOYMENT_KEYS : DEPLOYMENT_KEYS)) return false;
  if (!isNonEmpty(value.deploymentRef)
    || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1
    || typeof value.targetCommit !== 'string' || !/^[a-f0-9]{40}$/.test(value.targetCommit)
    || typeof value.previousCommit !== 'string' || !/^[a-f0-9]{40}$/.test(value.previousCommit)
    || value.targetCommit === value.previousCommit
    || !isDeploymentState(value.state)
    || !isCanonicalTimestamp(value.requestedAt)
    || !isCanonicalTimestamp(value.parkWarnAt)
    || Date.parse(value.parkWarnAt) <= Date.parse(value.requestedAt)
    || !isNullableTimestamp(value.swapDeadlineAt)
    || !Number.isSafeInteger(value.fenceRevision) || Number(value.fenceRevision) < 0
    || !isDrainAcks(value.drainAcks)
    || !isBlockers(value.blockers)
    || !isProgress(value.progress)
    || !isNullableTimestamp(value.abortRequestedAt)
    || value.error !== null && typeof value.error !== 'string'
    || value.terminalOutcome !== null && !isTerminalOutcome(value.terminalOutcome)
    || value.acknowledgedBy !== null && !isAcknowledgement(value.acknowledgedBy)) return false;
  const state = value.state as DeploymentState;
  if (OUTCOME_DEPLOYMENT_STATES.has(state)
    && (value.terminalOutcome === null || value.terminalOutcome.kind !== state)) return false;
  if (state === 'acknowledged' && (value.terminalOutcome === null || value.acknowledgedBy === null)) return false;
  return true;
}

export function assertDeploymentCollection(value: unknown): void {
  if (!Array.isArray(value)) throw new Error('invalid control-plane deployments');
  const refs = new Set<string>();
  const receiptKeys = new Set<string>();
  let active = 0;
  for (const deployment of value) {
    if (!isDeployment(deployment, true) || !isPlainRecord(deployment)) {
      throw new Error('invalid control-plane deployment');
    }
    if (refs.has(deployment.deploymentRef)) throw new Error('invalid control-plane deployment reference');
    refs.add(deployment.deploymentRef);
    if (!isTerminalDeploymentState(deployment.state as DeploymentState)) active += 1;
    const receipts = deployment.operationReceipts;
    if (!Array.isArray(receipts) || receipts.length > MAX_DEPLOYMENT_OPERATION_RECEIPTS) {
      throw new Error('invalid control-plane deployment receipts');
    }
    for (const receipt of receipts) {
      if (!isPlainRecord(receipt)
        || !hasExactKeys(receipt, ['deploymentRevision', 'fingerprint', 'key', 'operation', 'recordedAt', 'result'])
        || !isNonEmpty(receipt.key) || receiptKeys.has(receipt.key)
        || typeof receipt.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(receipt.fingerprint)
        || (receipt.operation !== 'create' && receipt.operation !== 'transition')
        || !Number.isSafeInteger(receipt.deploymentRevision) || Number(receipt.deploymentRevision) < 1
        || !isDeployment(receipt.result, false)
        || (receipt.result as Deployment).revision !== receipt.deploymentRevision
        || !isCanonicalTimestamp(receipt.recordedAt)) {
        throw new Error('invalid control-plane deployment receipt');
      }
      receiptKeys.add(receipt.key);
    }
  }
  if (active > 1) throw new Error('invalid control-plane active deployments');
}
