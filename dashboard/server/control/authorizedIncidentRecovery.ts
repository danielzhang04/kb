/**
 * One-time incident-recovery machinery for two Daniel-authorized settlements: the 2026-07-31
 * execution-lock reclassification and the 2026-08-01 failed-run reconciliation. Extracted verbatim
 * from control/store.ts (Slice B, behavior-identical move). store.ts re-exports the consumer-facing
 * symbols so every importer and test is byte-untouched. Every function here is a module-level pure
 * predicate over an explicit StoreDocument argument; none close over makeStore state.
 */
import { canonicalJson, clone, sha256 } from './controlHashing.ts';
import { runLifecycleKind } from './runLifecycle.ts';
import type { ProposalCompletionGate, ProposalReview, ResolvedAgentAssignment } from './proposal.ts';
import type { ControlResult, ProposalRevision, StageState } from './types.ts';
import {
  MAX_SHORT_TEXT,
  fail,
  hasExactKeys,
  internalRun,
  normalizeAssignment,
  normalizeCheckerContract,
  ok,
  proposalSnapshotHash,
  publicEvent,
  publicRequest,
  sameAssignment,
  sameCheckerContract,
  validNonEmpty,
} from './store.ts';
import type {
  AuthorizedFailedRunReconciliationPhase,
  AuthorizedFailedRunReconciliationReceipt,
  RecoverAuthorized20260731ExecutionLockInput,
  RecoverAuthorized20260731ExecutionLockPreflight,
  ReconcileAuthorized20260801FailedRunInput,
  ReconcileAuthorized20260801FailedRunPreflight,
  StoreDocument,
  StoredAuthorizedFailedRunReconciliation,
  StoredEvent,
  StoredHumanRequest,
  StoredRun,
  StoredRunActivationReceipt,
} from './store.ts';

export const AUTHORIZED_20260731_EXECUTION_LOCK_RUN_REF = 'run-0aa72053-b9d7-41fa-a034-19871b66d214';
export const AUTHORIZED_20260731_EXECUTION_LOCK_REQUEST_REF = 'request-86d0fc5f-797b-483c-a706-96a45e6f4d6e';
export const AUTHORIZED_20260731_EXECUTION_LOCK_TITLE = 'Automatic execution activation is gated';
export const AUTHORIZED_20260731_EXECUTION_LOCK_OLD_PROMPT = 'Canonical cards are published, but the daemon Broker/execution adapters are not activated. Complete the separate runtime approval before release.';
export const AUTHORIZED_20260731_EXECUTION_LOCK_NEW_PROMPT = 'Canonical cards are published. Unlock execution with your passkey, mark this intervention responded, then resume this same run.';

const AUTHORIZED_20260731_STAGE_STATES = new Map<string, StageState>([
  ['idea', 'ready'],
  ['story', 'blocked'],
  ['judge-gate', 'blocked'],
  ['packaging', 'blocked'],
  ['visual-plan', 'blocked'],
  ['shots-merge', 'blocked'],
  ['slice-contract', 'blocked'],
  ['images', 'blocked'],
  ['image-review', 'blocked'],
  ['audio', 'blocked'],
  ['audio-plan-merge', 'blocked'],
  ['render', 'blocked'],
  ['verify', 'blocked'],
]);
const AUTHORIZED_20260731_SOL_STAGES = new Set([
  'judge-gate', 'shots-merge', 'slice-contract', 'image-review', 'audio-plan-merge', 'verify',
]);

export function authorized20260731RecoveryFingerprint(input: RecoverAuthorized20260731ExecutionLockInput): string {
  return sha256(canonicalJson({
    runRef: AUTHORIZED_20260731_EXECUTION_LOCK_RUN_REF,
    requestRef: AUTHORIZED_20260731_EXECUTION_LOCK_REQUEST_REF,
    expectedRunVersion: input.expectedRunVersion,
    expectedManagerGeneration: input.expectedManagerGeneration,
    expectedRequestRevision: input.expectedRequestRevision,
    kind: 'intervention',
    title: AUTHORIZED_20260731_EXECUTION_LOCK_TITLE,
    prompt: AUTHORIZED_20260731_EXECUTION_LOCK_NEW_PROMPT,
  }));
}

export function validateAuthorized20260731RecoveryDurability(
  humanRequests: readonly StoredHumanRequest[],
  events: readonly StoredEvent[],
): void {
  const recoveryCursors = new Set<number>();
  const expectedFingerprint = authorized20260731RecoveryFingerprint({
    expectedRunVersion: 4, expectedManagerGeneration: 1, expectedRequestRevision: 1, idempotencyKey: 'validation-only',
  });
  for (const request of humanRequests) {
    const fields = [
      request.legacyRecoveryOperationKey,
      request.legacyRecoveryOperationFingerprint,
      request.legacyRecoveryEventCursor,
    ];
    if (fields.every((value) => value == null)) continue;
    if (fields.some((value) => value == null)
      || request.requestRef !== AUTHORIZED_20260731_EXECUTION_LOCK_REQUEST_REF
      || request.runRef !== AUTHORIZED_20260731_EXECUTION_LOCK_RUN_REF
      || request.operationKey != null || request.operationFingerprint != null
      || !validNonEmpty(request.legacyRecoveryOperationKey, MAX_SHORT_TEXT)
      || request.legacyRecoveryOperationFingerprint !== expectedFingerprint
      || !Number.isSafeInteger(request.legacyRecoveryEventCursor) || (request.legacyRecoveryEventCursor ?? 0) < 1
      || recoveryCursors.has(request.legacyRecoveryEventCursor as number)
      || request.kind !== 'intervention' || request.revision !== 2
      || request.title !== AUTHORIZED_20260731_EXECUTION_LOCK_TITLE
      || request.prompt !== AUTHORIZED_20260731_EXECUTION_LOCK_NEW_PROMPT) {
      throw new Error('invalid control-plane authorized legacy recovery receipt');
    }
    const event = events.find((candidate) => candidate.subject === request.subject
      && candidate.runRef === request.runRef && candidate.cursor === request.legacyRecoveryEventCursor);
    if (!event || event.kind !== 'governance' || event.source !== 'human' || event.status !== 'success'
      || event.stageRef !== null || event.attemptRef !== null || event.sessionRef !== null
      || event.summary !== 'authorized 2026-07-31 execution-lock boundary reclassified to intervention'
      || event.command !== null || event.toolName !== null || event.path !== null
      || event.diff !== null || event.checkpoint !== null) {
      throw new Error('invalid control-plane authorized legacy recovery event');
    }
    recoveryCursors.add(request.legacyRecoveryEventCursor as number);
  }
}

function exactAuthorized20260731NeverStartedState(
  document: StoreDocument,
  subject: string,
  run: StoredRun,
  request: StoredHumanRequest,
  input: RecoverAuthorized20260731ExecutionLockInput,
): boolean {
  if (run.runRef !== AUTHORIZED_20260731_EXECUTION_LOCK_RUN_REF
    || request.requestRef !== AUTHORIZED_20260731_EXECUTION_LOCK_REQUEST_REF
    || request.runRef !== run.runRef
    || run.publicationState !== 'published' || runLifecycleKind(run.lifecycle) !== 'waiting-human'
    || input.expectedRunVersion !== 4 || input.expectedManagerGeneration !== 1 || input.expectedRequestRevision !== 1
    || run.version !== input.expectedRunVersion || run.managerGeneration !== input.expectedManagerGeneration
    || (run.activationReceipts ?? []).length !== 0
    || request.stageRef !== null || request.kind !== 'governance-refusal'
    || request.revision !== input.expectedRequestRevision || request.state !== 'open' || request.response !== null
    || request.title !== AUTHORIZED_20260731_EXECUTION_LOCK_TITLE
    || request.prompt !== AUTHORIZED_20260731_EXECUTION_LOCK_OLD_PROMPT
    || request.operationKey != null || request.operationFingerprint != null
    || request.resolutionOperationFingerprint != null
    || request.legacyRecoveryOperationKey != null || request.legacyRecoveryOperationFingerprint != null
    || request.legacyRecoveryEventCursor != null) return false;

  const requests = document.humanRequests.filter((item) => item.subject === subject && item.runRef === run.runRef);
  if (requests.length !== 1 || requests[0] !== request) return false;

  const stages = document.stages.filter((item) => item.subject === subject && item.runRef === run.runRef);
  if (stages.length !== AUTHORIZED_20260731_STAGE_STATES.size
    || new Set(stages.map((stage) => stage.canonicalCardRef)).size !== stages.length
    || stages.some((stage) => AUTHORIZED_20260731_STAGE_STATES.get(stage.stageId) !== stage.state || stage.version !== 3
      || stage.canonicalCardRef === null || stage.currentAttemptRef === null
      || stage.currentGeneration !== 1 || stage.currentGenerationRef !== null || stage.acceptedGenerationRef !== null)) return false;

  const attempts = document.attempts.filter((item) => item.subject === subject && item.runRef === run.runRef);
  if (attempts.length !== stages.length || attempts.some((attempt) => {
    const stage = stages.find((candidate) => candidate.stageRef === attempt.stageRef);
    const expectedModel = stage && AUTHORIZED_20260731_SOL_STAGES.has(stage.stageId) ? 'gpt-5.6-sol' : 'gpt-5.6-terra';
    return !stage || stage.currentAttemptRef !== attempt.attemptRef || attempt.state !== 'queued' || attempt.version !== 2
      || attempt.generation !== 1 || attempt.runtime !== 'codex' || attempt.model !== expectedModel
      || attempt.managedSessionRef === null || attempt.predecessorAttemptRef !== null
      || attempt.logicalGeneration !== null
      || attempt.baseGenerationRef !== null || attempt.baseCommit !== null;
  })) return false;

  const sessions = document.sessions.filter((item) => item.subject === subject && item.runRef === run.runRef);
  const managers = sessions.filter((session) => session.role === 'manager');
  const workers = sessions.filter((session) => session.role === 'worker');
  if (sessions.length !== 14 || managers.length !== 1 || workers.length !== attempts.length) return false;
  const manager = managers[0];
  if (!manager || manager.sessionRef !== run.managerSessionRef || manager.generation !== run.managerGeneration
    || manager.runtime !== 'codex' || manager.model !== 'gpt-5.6-sol' || manager.version !== 1
    || manager.stageRef !== null || manager.attemptRef !== null || manager.predecessorSessionRef !== null) return false;
  if (sessions.some((session) => session.state !== 'pending' || session.operationKey != null || session.operationFingerprint != null
    || session.brokerProfileId != null || session.brokerApprovedPromptHash != null || session.brokerStopRequested === true
    || (session.brokerSteering ?? []).length !== 0 || (session.brokerReceipts ?? []).length !== 0)) return false;
  if (workers.some((session) => {
    const attempt = attempts.find((candidate) => candidate.attemptRef === session.attemptRef);
    return !attempt || session.stageRef !== attempt.stageRef || attempt.managedSessionRef !== session.sessionRef
      || session.runtime !== attempt.runtime || session.model !== attempt.model || session.version !== 1
      || session.generation !== 1 || session.predecessorSessionRef !== null;
  })) return false;

  const matchesRun = <T extends { subject: string; runRef: string }>(item: T): boolean =>
    item.subject === subject && item.runRef === run.runRef;
  if (document.stageGenerations.some(matchesRun) || document.iterationLoops.some(matchesRun)
    || document.iterationReceipts.some(matchesRun) || document.generationSupersessions.some(matchesRun)) return false;

  const events = document.events.filter(matchesRun);
  return events.length === 1 && events[0]?.kind === 'governance' && events[0].source === 'system'
    && events[0].stageRef === null && events[0].attemptRef === null && events[0].sessionRef === null
    && events[0].status === 'waiting'
    && events[0].summary === 'canonical run published; runtime activation remains gated'
    && events[0].command === null && events[0].toolName === null && events[0].path === null
    && events[0].diff === null && events[0].checkpoint === null;
}

export function classifyAuthorized20260731ExecutionLock(
  document: StoreDocument,
  subject: string,
  input: RecoverAuthorized20260731ExecutionLockInput,
): ControlResult<RecoverAuthorized20260731ExecutionLockPreflight> {
  if (!validNonEmpty(input.idempotencyKey, MAX_SHORT_TEXT)
    || input.expectedRunVersion !== 4 || input.expectedManagerGeneration !== 1 || input.expectedRequestRevision !== 1) {
    return fail('invalid', 'the exact authorized run, manager, and request CAS plus idempotencyKey are required');
  }
  const run = document.runs.find((item) => item.subject === subject
    && item.runRef === AUTHORIZED_20260731_EXECUTION_LOCK_RUN_REF);
  const request = document.humanRequests.find((item) => item.subject === subject
    && item.requestRef === AUTHORIZED_20260731_EXECUTION_LOCK_REQUEST_REF);
  if (!run || !request) return fail('not-found', 'the authorized legacy execution-lock boundary was not found');
  const fingerprint = authorized20260731RecoveryFingerprint(input);
  const recoveryFields = [
    request.legacyRecoveryOperationKey,
    request.legacyRecoveryOperationFingerprint,
    request.legacyRecoveryEventCursor,
  ];
  if (recoveryFields.some((value) => value != null)) {
    if (recoveryFields.some((value) => value == null)
      || request.legacyRecoveryOperationKey !== input.idempotencyKey
      || request.legacyRecoveryOperationFingerprint !== fingerprint) {
      return fail('idempotency-conflict', 'legacy recovery idempotencyKey was reused with different content');
    }
    const event = document.events.find((item) => item.subject === subject && item.runRef === run.runRef
      && item.cursor === request.legacyRecoveryEventCursor);
    if (request.kind !== 'intervention' || request.revision !== 2
      || request.title !== AUTHORIZED_20260731_EXECUTION_LOCK_TITLE
      || request.prompt !== AUTHORIZED_20260731_EXECUTION_LOCK_NEW_PROMPT
      || !event || event.kind !== 'governance' || event.source !== 'human' || event.status !== 'success'
      || event.summary !== 'authorized 2026-07-31 execution-lock boundary reclassified to intervention') {
      return fail('conflict', 'the recovered legacy execution-lock receipt is inconsistent');
    }
    return ok({
      disposition: 'replay',
      result: { request: publicRequest(request), event: publicEvent(event) },
    });
  }
  if (!exactAuthorized20260731NeverStartedState(document, subject, run, request, input)) {
    return fail('conflict', 'the authorized legacy execution-lock run no longer matches its never-started signature');
  }
  return ok({ disposition: 'eligible', result: null });
}

export const AUTHORIZED_20260801_FAILED_RUN_REF = AUTHORIZED_20260731_EXECUTION_LOCK_RUN_REF;
export const AUTHORIZED_20260801_FAILED_RUN_PROPOSAL_REF = 'proposal-3725fb98-e20e-4619-b6e7-c9055138a50d';
export const AUTHORIZED_20260801_FAILED_RUN_PROPOSAL_HASH = '396480363d02620c25730160e00fd7adf51e1eff43f8427c80b2062a18dc80d9';
export const AUTHORIZED_20260801_FAILED_RUN_IDEMPOTENCY_KEY =
  'reconcile:2026-08-01:run-0aa72053-b9d7-41fa-a034-19871b66d214:failed-launch:v7';
export const AUTHORIZED_20260801_FAILED_RUN_MANAGER_SESSION_REF = 'session-54ef91fa-6607-4f0e-a2f6-f9edd87873bb';

export const AUTHORIZED_20260801_FAILED_RUN_STAGES = [
  { stageId: 'idea', stageRef: 'stage-ea9da6f4-2b54-4664-a4ae-f2a47885e51b', cardRef: 'wf-44c4644fe9fb254f8803fb48', attemptRef: 'attempt-e5672116-acdb-4dfd-887a-5c0566b92ae7', sessionRef: 'session-8445469e-a733-4a66-908f-b6a58f513323', runtime: 'codex', model: 'gpt-5.6-terra' },
  { stageId: 'story', stageRef: 'stage-80eefd76-49ff-4307-9c4c-c66a1339d561', cardRef: 'wf-84370585b7737c38f03a01a4', attemptRef: 'attempt-ba96da92-a01b-4f5f-9b9e-1cca3e7881bb', sessionRef: 'session-4ee8bf7b-7f3d-4d99-ae5c-8c997cbfc285', runtime: 'codex', model: 'gpt-5.6-terra' },
  { stageId: 'judge-gate', stageRef: 'stage-cd27c97b-aa9e-44d1-beb9-d6ce652ce7e0', cardRef: 'wf-ceedb44776e9f0b99fb95336', attemptRef: 'attempt-536e1401-aa6b-471b-9835-6769d209f53f', sessionRef: 'session-5e55ff31-4afc-4c17-bb9e-46355e1c425d', runtime: 'codex', model: 'gpt-5.6-sol' },
  { stageId: 'packaging', stageRef: 'stage-d38f12d7-185d-4bd1-b8e4-f9e9f53cac4c', cardRef: 'wf-6489321a47f5ec64ef65b576', attemptRef: 'attempt-0adcdec3-786c-4992-9a06-49d71f495016', sessionRef: 'session-357f7a4a-e34f-471a-988b-6ae74eee9776', runtime: 'codex', model: 'gpt-5.6-terra' },
  { stageId: 'visual-plan', stageRef: 'stage-c4b5e74f-2198-4cac-9ae9-b1a02958aa85', cardRef: 'wf-97a7a138bc0243e9f703e6f4', attemptRef: 'attempt-4cd57296-7228-4369-b0e7-aada10d49400', sessionRef: 'session-4d79b327-5ab6-4af8-a068-1ce0f21393ce', runtime: 'codex', model: 'gpt-5.6-terra' },
  { stageId: 'shots-merge', stageRef: 'stage-07c4a75c-3c5e-4b02-a682-47ec20450aff', cardRef: 'wf-5270609bdb7cb8c2b0100eb8', attemptRef: 'attempt-9021bd2e-6ae4-4855-8b63-bb18639c5d9b', sessionRef: 'session-cc0b4e1d-da87-4435-b8ad-135aa7968733', runtime: 'codex', model: 'gpt-5.6-sol' },
  { stageId: 'slice-contract', stageRef: 'stage-28ed1538-43de-4e01-a99a-a4aaedc0ae1b', cardRef: 'wf-ccd1e0e57af699cfd88d4dc6', attemptRef: 'attempt-703db9af-289a-4e7b-9c65-95a94d613b9d', sessionRef: 'session-a02036cd-bcaf-4dce-8099-bbad014b9361', runtime: 'codex', model: 'gpt-5.6-sol' },
  { stageId: 'images', stageRef: 'stage-2dd2e4e4-2e26-4090-aa85-3e199f080d58', cardRef: 'wf-b2474af1b1687c4a7ed2475c', attemptRef: 'attempt-7219abe7-739f-4701-a7a8-c2eb088f90b5', sessionRef: 'session-43a4a0d2-c29d-44c2-96b7-dde19a606a3f', runtime: 'codex', model: 'gpt-5.6-terra' },
  { stageId: 'image-review', stageRef: 'stage-c9b76af0-728a-4431-a6d8-fc93ad6d3d13', cardRef: 'wf-27e4f71519c58f4deceeff24', attemptRef: 'attempt-a605f573-df49-4b37-8e4f-0990089d608a', sessionRef: 'session-9da0dce9-465e-4e20-988f-d3896b5bfbd8', runtime: 'codex', model: 'gpt-5.6-sol' },
  { stageId: 'audio', stageRef: 'stage-95f7eccd-7a2c-4c32-a9b4-c847ef7a7101', cardRef: 'wf-3ab267b511946c0a21318d0d', attemptRef: 'attempt-56927bad-37fb-4b69-af60-6afef22ab4df', sessionRef: 'session-021b0f7d-2104-498f-8169-14e02d9f18ee', runtime: 'codex', model: 'gpt-5.6-terra' },
  { stageId: 'audio-plan-merge', stageRef: 'stage-e7ab5eff-6f41-4851-8558-6c886aa18946', cardRef: 'wf-978552383fd8f556cac9b416', attemptRef: 'attempt-fa5135e6-1973-4489-a529-86a1779aec0d', sessionRef: 'session-4c24da14-beb4-4816-b838-afc1244dc230', runtime: 'codex', model: 'gpt-5.6-sol' },
  { stageId: 'render', stageRef: 'stage-86f3358e-9ff1-45b5-8c81-505411bb3c83', cardRef: 'wf-ad666acabdf313544d841456', attemptRef: 'attempt-5e44a62f-fb32-41cb-aa23-8ab5ab9167b1', sessionRef: 'session-76a7c42f-345d-4369-b5c7-72cbcde88195', runtime: 'codex', model: 'gpt-5.6-terra' },
  { stageId: 'verify', stageRef: 'stage-bdee2033-e216-46f4-a20e-f04ab43c09bb', cardRef: 'wf-a767b15b4fd4c74c8b86b258', attemptRef: 'attempt-f83b955e-69d7-4905-8b00-66b532244be2', sessionRef: 'session-7700d49d-3941-40e5-b11f-4e313c366061', runtime: 'codex', model: 'gpt-5.6-sol' },
] as const;

const AUTHORIZED_20260801_ACTIVATION_RECEIPT: StoredRunActivationReceipt = {
  idempotencyKey: `activate:${AUTHORIZED_20260801_FAILED_RUN_REF}:4:${AUTHORIZED_20260801_FAILED_RUN_PROPOSAL_HASH}:1`,
  fingerprint: '9e81be057acedd88e8fd4a5d9cf7c3aa0420db0ee9e274c63fd1a3e322acf205',
  phase: 'dispatched',
  claimedAt: '2026-08-01T03:32:45.859Z',
  updatedAt: '2026-08-01T03:32:47.623Z',
};

const AUTHORIZED_20260801_EVENT_SIGNATURES = [
  { cursor: 1, kind: 'governance', source: 'system', status: 'waiting', summary: 'canonical run published; runtime activation remains gated', stageRef: null, attemptRef: null, sessionRef: null, command: null, toolName: null, path: null, diff: null, checkpoint: null, createdAt: '2026-08-01T02:04:04.767Z' },
  { cursor: 2, kind: 'governance', source: 'human', status: 'success', summary: 'authorized 2026-07-31 execution-lock boundary reclassified to intervention', stageRef: null, attemptRef: null, sessionRef: null, command: null, toolName: null, path: null, diff: null, checkpoint: null, createdAt: '2026-08-01T03:31:39.866Z' },
  { cursor: 3, kind: 'governance', source: 'human', status: 'success', summary: 'Human Request responded at revision 2', stageRef: null, attemptRef: null, sessionRef: null, command: null, toolName: null, path: null, diff: null, checkpoint: null, createdAt: '2026-08-01T03:32:43.924Z' },
  { cursor: 4, kind: 'lifecycle', source: 'worker', status: 'failure', summary: 'Codex workspace contains an unsupported changed path', stageRef: 'stage-ea9da6f4-2b54-4664-a4ae-f2a47885e51b', attemptRef: 'attempt-e5672116-acdb-4dfd-887a-5c0566b92ae7', sessionRef: 'session-8445469e-a733-4a66-908f-b6a58f513323', command: null, toolName: null, path: null, diff: null, checkpoint: null, createdAt: '2026-08-01T03:32:49.322Z' },
  { cursor: 5, kind: 'lifecycle', source: 'system', status: 'interrupted', summary: 'dashboard restarted; active control-plane records were normalized to interrupted', stageRef: null, attemptRef: null, sessionRef: null, command: null, toolName: null, path: null, diff: null, checkpoint: null, createdAt: '2026-08-01T08:18:11.696Z' },
] as const;

export const AUTHORIZED_20260801_RECONCILIATION_SUMMARY =
  'authorized one-off reconciliation settled the failed 2026-07-31 FYT thin-slice predecessor';

/** The one authorized settlement has exactly one legal input; its digest is the receipt's identity. */
export const AUTHORIZED_20260801_FAILED_RUN_INPUT: ReconcileAuthorized20260801FailedRunInput = {
  expectedRunVersion: 7,
  expectedManagerGeneration: 1,
  expectedRequestRevision: 2,
  expectedNextEventCursor: 6,
  expectedProposalHash: AUTHORIZED_20260801_FAILED_RUN_PROPOSAL_HASH,
  idempotencyKey: AUTHORIZED_20260801_FAILED_RUN_IDEMPOTENCY_KEY,
};

export function authorized20260801FailedRunFingerprint(input: ReconcileAuthorized20260801FailedRunInput): string {
  return sha256(canonicalJson({
    operation: 'authorized-2026-08-01-fyt-failed-run-reconciliation',
    runRef: AUTHORIZED_20260801_FAILED_RUN_REF,
    proposalRef: AUTHORIZED_20260801_FAILED_RUN_PROPOSAL_REF,
    expectedRunVersion: input.expectedRunVersion,
    expectedManagerGeneration: input.expectedManagerGeneration,
    expectedRequestRevision: input.expectedRequestRevision,
    expectedNextEventCursor: input.expectedNextEventCursor,
    expectedProposalHash: input.expectedProposalHash,
    idempotencyKey: input.idempotencyKey,
  }));
}

export const AUTHORIZED_20260801_FAILED_RUN_FINGERPRINT =
  authorized20260801FailedRunFingerprint(AUTHORIZED_20260801_FAILED_RUN_INPUT);

export function publicAuthorizedFailedRunReceipt(
  receipt: StoredAuthorizedFailedRunReconciliation,
): AuthorizedFailedRunReconciliationReceipt {
  return clone(receipt);
}

function exactAuthorized20260801Request(request: StoredHumanRequest): boolean {
  return request.subject === 'operator'
    && request.requestRef === AUTHORIZED_20260731_EXECUTION_LOCK_REQUEST_REF
    && request.runRef === AUTHORIZED_20260801_FAILED_RUN_REF
    && request.stageRef === null && request.kind === 'intervention' && request.revision === 2
    && request.state === 'resolved' && request.title === AUTHORIZED_20260731_EXECUTION_LOCK_TITLE
    && request.prompt === AUTHORIZED_20260731_EXECUTION_LOCK_NEW_PROMPT
    && request.createdAt === '2026-08-01T02:04:04.762Z' && request.updatedAt === '2026-08-01T03:32:43.921Z'
    && request.operationKey == null && request.operationFingerprint == null
    && request.resolutionOperationFingerprint == null
    && request.legacyRecoveryOperationKey === `legacy-execution-lock-recovery:${AUTHORIZED_20260801_FAILED_RUN_REF}:${AUTHORIZED_20260731_EXECUTION_LOCK_REQUEST_REF}:r1`
    && request.legacyRecoveryOperationFingerprint === '67abeff66b673f7eb834236a928790c0ac4b8f73f2f9472cbeda523989cdc3c3'
    && request.legacyRecoveryEventCursor === 2
    && request.response?.requestRevision === 2 && request.response.decision === 'responded'
    && request.response.respondedBy === 'operator'
    && request.response.idempotencyKey === `human:${AUTHORIZED_20260731_EXECUTION_LOCK_REQUEST_REF}:2:responded`
    && request.response.response === null && request.response.respondedAt === '2026-08-01T03:32:43.921Z';
}

function exactAuthorized20260801Events(
  document: StoreDocument,
  subject: string,
  phase: AuthorizedFailedRunReconciliationPhase | null,
  receipt: StoredAuthorizedFailedRunReconciliation | null,
): boolean {
  const events = document.events.filter((event) => event.subject === subject && event.runRef === AUTHORIZED_20260801_FAILED_RUN_REF);
  const requiredLength = phase === 'committed' ? 6 : 5;
  if (events.length !== requiredLength) return false;
  // `nextEventCursor` is a GLOBAL counter that ANY run's event advances. Only the pre-claim
  // classification pins it, because that exact value is the operator's declared CAS. Once the
  // settlement is claimed it must survive an unrelated concurrent event, so from there on the counter
  // is only required to be at or past the settlement's own allocation.
  if (phase === null ? document.nextEventCursor !== 6 : document.nextEventCursor < (phase === 'committed' ? 7 : 6)) return false;
  for (let index = 0; index < AUTHORIZED_20260801_EVENT_SIGNATURES.length; index += 1) {
    const event = events[index];
    const expected = AUTHORIZED_20260801_EVENT_SIGNATURES[index];
    if (!event || !expected || Object.entries(expected).some(([key, value]) => event[key as keyof StoredEvent] !== value)) return false;
  }
  if (phase !== 'committed') return true;
  const event = events[5];
  return !!event && !!receipt && event.cursor >= 6 && receipt.eventCursor === event.cursor
    && event.kind === 'governance' && event.source === 'human' && event.status === 'success'
    && event.summary === AUTHORIZED_20260801_RECONCILIATION_SUMMARY
    && event.stageRef === null && event.attemptRef === null && event.sessionRef === null
    && event.command === null && event.toolName === null && event.path === null
    && event.diff === null && event.checkpoint === null && event.createdAt === receipt.updatedAt;
}

const AUTHORIZED_20260801_MANAGER_ASSIGNMENT = {
  agentId: 'fyt-runner',
  declarationPath: 'agents/fyt-runner.md',
  declarationHash: 'ba119796897f72495ba8dadcb8ca78a4be352e88e6f7ef42c74823fe1b048fc0',
  profileId: 'manager:codex:gpt-5.6-sol',
  runtime: 'codex',
  model: 'gpt-5.6-sol',
} as const;

const AUTHORIZED_20260801_AGENT_WORKSPACE_LAUNCH = {
  composerRef: '4c9aa9e0-92fe-4f66-a0e3-dd36f29d7960',
  agentId: 'fyt-runner',
  declarationPath: 'agents/fyt-runner.md',
  declarationHash: 'ba119796897f72495ba8dadcb8ca78a4be352e88e6f7ef42c74823fe1b048fc0',
} as const;

// Takes the OWNERLESS shape so a `StoredProposal` and a projected `ProposalRevision` both satisfy it —
// the frozen field-by-field comparison below is unchanged and never looks at ownership.
export function exactAuthorized20260801ProposalRevision(proposal: Omit<ProposalRevision, 'ownerSubject'>): boolean {
  const approval = proposal.approval as unknown as Record<string, unknown> | null;
  return proposal.proposalRef === AUTHORIZED_20260801_FAILED_RUN_PROPOSAL_REF
    && proposal.sourceComposerRef === 'workflow-registry'
    && proposal.sourceTurnId === 'thin-slice-run'
    && proposal.revision === 1
    && proposal.hash === AUTHORIZED_20260801_FAILED_RUN_PROPOSAL_HASH
    && proposal.previousHash === null
    && proposal.title === 'Validate one all-Codex faceless-video opening slice'
    && proposal.createdAt === '2026-08-01T02:04:02.673Z'
    && proposalSnapshotHash(proposal.snapshot) === AUTHORIZED_20260801_FAILED_RUN_PROPOSAL_HASH
    && !!approval && hasExactKeys(approval, ['revision', 'decision', 'decidedBy', 'idempotencyKey', 'decidedAt', 'note'])
    && approval.revision === 1 && approval.decision === 'approved' && approval.decidedBy === 'operator'
    && approval.idempotencyKey === 'agent-workspace-launch:4c9aa9e0-92fe-4f66-a0e3-dd36f29d7960:thin-slice-run:f481bfb5-584d-4200-b0f1-8b1fc0556209:decision'
    && approval.decidedAt === '2026-08-01T02:04:03.315Z' && approval.note === null;
}

function exactAuthorized20260801Graph(
  document: StoreDocument,
  subject: string,
  phase: AuthorizedFailedRunReconciliationPhase | null,
): boolean {
  const run = document.runs.find((candidate) => candidate.subject === subject
    && candidate.runRef === AUTHORIZED_20260801_FAILED_RUN_REF);
  const receipt = run?.authorizedFailedRunReconciliation ?? null;
  if (!run || run.subject !== 'operator' || run.predecessorRunRef !== null
    || run.title !== 'Validate one all-Codex faceless-video opening slice'
    || run.proposalRef !== AUTHORIZED_20260801_FAILED_RUN_PROPOSAL_REF || run.proposalRevision !== 1
    || run.proposalHash !== AUTHORIZED_20260801_FAILED_RUN_PROPOSAL_HASH
    || run.publicationState !== 'published' || runLifecycleKind(run.lifecycle) !== 'failed'
    || run.version !== (phase === 'committed' ? 8 : 7)
    || run.managerSessionRef !== AUTHORIZED_20260801_FAILED_RUN_MANAGER_SESSION_REF || run.managerGeneration !== 1
    || run.launchOperationKey !== 'agent-workspace-launch:4c9aa9e0-92fe-4f66-a0e3-dd36f29d7960:thin-slice-run:f481bfb5-584d-4200-b0f1-8b1fc0556209'
    || run.launchOperationFingerprint !== '664ccc0a8734e5d5bdcaebb834aa656c609be49107ccfa44d784a309ff886600'
    || JSON.stringify(run.managerAssignment) !== JSON.stringify(AUTHORIZED_20260801_MANAGER_ASSIGNMENT)
    || JSON.stringify(run.agentWorkspaceLaunch) !== JSON.stringify(AUTHORIZED_20260801_AGENT_WORKSPACE_LAUNCH)
    || run.createdAt !== '2026-08-01T02:04:03.640Z'
    || (phase === 'committed' ? run.updatedAt !== receipt?.updatedAt : run.updatedAt !== '2026-08-01T03:32:49.635Z')
    || JSON.stringify(run.activationReceipts ?? []) !== JSON.stringify([AUTHORIZED_20260801_ACTIVATION_RECEIPT])) return false;

  const proposal = document.proposals.find((candidate) => candidate.subject === subject
    && candidate.proposalRef === AUTHORIZED_20260801_FAILED_RUN_PROPOSAL_REF && candidate.revision === 1);
  if (!proposal || !exactAuthorized20260801ProposalRevision(proposal)) return false;

  const requests = document.humanRequests.filter((candidate) => candidate.subject === subject
    && candidate.runRef === AUTHORIZED_20260801_FAILED_RUN_REF);
  if (requests.length !== 1 || !requests[0] || !exactAuthorized20260801Request(requests[0])) return false;

  const stages = document.stages.filter((candidate) => candidate.subject === subject && candidate.runRef === run.runRef);
  const attempts = document.attempts.filter((candidate) => candidate.subject === subject && candidate.runRef === run.runRef);
  const sessions = document.sessions.filter((candidate) => candidate.subject === subject && candidate.runRef === run.runRef);
  if (stages.length !== AUTHORIZED_20260801_FAILED_RUN_STAGES.length
    || attempts.length !== AUTHORIZED_20260801_FAILED_RUN_STAGES.length
    || sessions.length !== AUTHORIZED_20260801_FAILED_RUN_STAGES.length + 1) return false;
  const proposalStages = Array.isArray(proposal.snapshot.stages)
    ? proposal.snapshot.stages as unknown as Array<{
        id: string;
        dependsOn: string[];
        assignment: ResolvedAgentAssignment | null;
        workflowProfile: string | null;
        review: ProposalReview | null;
        completionGate: ProposalCompletionGate | null;
      }>
    : [];
  for (const expected of AUTHORIZED_20260801_FAILED_RUN_STAGES) {
    const stage = stages.find((candidate) => candidate.stageId === expected.stageId);
    const attempt = attempts.find((candidate) => candidate.attemptRef === expected.attemptRef);
    const session = sessions.find((candidate) => candidate.sessionRef === expected.sessionRef);
    const proposalStage = proposalStages.find((candidate) => candidate.id === expected.stageId);
    const idea = expected.stageId === 'idea';
    /*
     * Compare stored provenance against the approved snapshot in the STORE'S OWN normal form, never
     * raw value against raw value. `normalizeStoredStageCheckerContract` fills a stage's absent
     * optional keys (workflowProfile/review/completionGate) with null at load time and PERSISTS that,
     * while the approved snapshot simply omits them — so a raw compare read `null !== undefined` on
     * every stage and reported the untouched historical run as drifted. Assignment carries the same
     * hazard (absent vs null, plus key order), so it goes through the same door.
     */
    const storedContract = stage ? normalizeCheckerContract(stage) : undefined;
    const proposalContract = proposalStage ? normalizeCheckerContract(proposalStage) : undefined;
    const storedAssignment = stage ? normalizeAssignment(stage.assignment) : undefined;
    const proposalAssignment = proposalStage ? normalizeAssignment(proposalStage.assignment) : undefined;
    if (!stage || !attempt || !session || !proposalStage
      || !storedContract || !proposalContract
      || storedAssignment === undefined || proposalAssignment === undefined
      || stage.stageRef !== expected.stageRef || stage.canonicalCardRef !== expected.cardRef
      || stage.currentAttemptRef !== expected.attemptRef || stage.currentGeneration !== 1
      || stage.currentGenerationRef !== null || stage.acceptedGenerationRef !== null
      || JSON.stringify(stage.dependsOn) !== JSON.stringify(proposalStage.dependsOn)
      || !sameAssignment(storedAssignment, proposalAssignment)
      || !sameCheckerContract(storedContract, proposalContract)
      || stage.state !== (idea ? 'failed' : phase === 'committed' ? 'stopped' : 'blocked')
      || stage.version !== (idea ? 5 : phase === 'committed' ? 4 : 3)
      || attempt.stageRef !== expected.stageRef || attempt.state !== (idea ? 'failed' : phase === 'committed' ? 'stopped' : 'queued')
      || attempt.version !== (idea ? 5 : phase === 'committed' ? 3 : 2)
      || attempt.generation !== 1 || attempt.predecessorAttemptRef !== null
      || attempt.runtime !== expected.runtime || attempt.model !== expected.model
      || attempt.managedSessionRef !== expected.sessionRef
      || attempt.logicalGeneration !== null
      || attempt.baseGenerationRef !== null || attempt.baseCommit !== null
      || session.stageRef !== expected.stageRef || session.attemptRef !== expected.attemptRef || session.role !== 'worker'
      || session.generation !== 1 || session.predecessorSessionRef !== null
      || session.runtime !== expected.runtime || session.model !== expected.model
      || session.state !== (idea ? 'failed' : phase === 'committed' ? 'stopped' : 'pending')
      || session.version !== (idea ? 4 : phase === 'committed' ? 2 : 1)
      || session.operationKey !== null || session.operationFingerprint !== null
      || session.brokerProfileId != null || session.brokerApprovedPromptHash != null
      || session.brokerStopRequested === true || (session.brokerSteering ?? []).length !== 0
      || (session.brokerReceipts ?? []).length !== 0) return false;
    if (phase === 'committed' && !idea
      && (stage.updatedAt !== receipt?.updatedAt || attempt.updatedAt !== receipt?.updatedAt || session.updatedAt !== receipt?.updatedAt)) return false;
  }
  const manager = sessions.find((candidate) => candidate.role === 'manager');
  if (!manager || manager.sessionRef !== AUTHORIZED_20260801_FAILED_RUN_MANAGER_SESSION_REF
    || manager.stageRef !== null || manager.attemptRef !== null || manager.generation !== 1
    || manager.predecessorSessionRef !== null || manager.runtime !== 'codex' || manager.model !== 'gpt-5.6-sol'
    || manager.state !== 'interrupted' || manager.version !== 4
    || manager.operationKey !== null || manager.operationFingerprint !== null
    || manager.brokerProfileId != null || manager.brokerApprovedPromptHash != null
    || manager.brokerStopRequested === true || (manager.brokerSteering ?? []).length !== 0
    || (manager.brokerReceipts ?? []).length !== 0
    || manager.createdAt !== '2026-08-01T02:04:03.640Z' || manager.updatedAt !== '2026-08-01T08:18:11.696Z') return false;

  const matchesRun = <T extends { subject: string; runRef: string }>(item: T): boolean =>
    item.subject === subject && item.runRef === run.runRef;
  return !document.runs.some((candidate) => candidate.subject === subject && candidate.predecessorRunRef === run.runRef)
    && !document.stageGenerations.some(matchesRun) && !document.iterationLoops.some(matchesRun)
    && !document.iterationRequests.some(matchesRun) && !document.iterationReceipts.some(matchesRun)
    && !document.generationSupersessions.some(matchesRun)
    && exactAuthorized20260801Events(document, subject, phase, receipt);
}

function validAuthorized20260801Input(input: ReconcileAuthorized20260801FailedRunInput): boolean {
  return input.expectedRunVersion === 7 && input.expectedManagerGeneration === 1
    && input.expectedRequestRevision === 2 && input.expectedNextEventCursor === 6
    && input.expectedProposalHash === AUTHORIZED_20260801_FAILED_RUN_PROPOSAL_HASH
    && input.idempotencyKey === AUTHORIZED_20260801_FAILED_RUN_IDEMPOTENCY_KEY;
}

export function classifyAuthorized20260801FailedRun(
  document: StoreDocument,
  subject: string,
  input: ReconcileAuthorized20260801FailedRunInput,
): ControlResult<ReconcileAuthorized20260801FailedRunPreflight> {
  if (!validAuthorized20260801Input(input)) return fail('invalid', 'the exact authorized failed-run CAS and fixed idempotencyKey are required');
  const run = document.runs.find((candidate) => candidate.subject === subject
    && candidate.runRef === AUTHORIZED_20260801_FAILED_RUN_REF);
  if (!run) return fail('not-found', 'the authorized failed run was not found');
  const receipt = run.authorizedFailedRunReconciliation ?? null;
  if (receipt) {
    if (receipt.idempotencyKey !== input.idempotencyKey
      || receipt.fingerprint !== authorized20260801FailedRunFingerprint(input)) {
      return fail('idempotency-conflict', 'failed-run reconciliation idempotencyKey was reused with different content');
    }
    if (receipt.phase === 'claimed') {
      return exactAuthorized20260801Graph(document, subject, 'claimed')
        ? ok({ disposition: 'claimed', receipt: publicAuthorizedFailedRunReceipt(receipt), result: null })
        : fail('conflict', 'the claimed failed-run reconciliation no longer matches its exact historical state');
    }
    if (!exactAuthorized20260801Graph(document, subject, 'committed')) {
      return fail('conflict', 'the committed failed-run reconciliation receipt is inconsistent');
    }
    const event = document.events.find((candidate) => candidate.subject === subject
      && candidate.runRef === run.runRef && candidate.cursor === receipt.eventCursor);
    if (!event) return fail('conflict', 'the committed failed-run reconciliation event is missing');
    const publicReceipt = publicAuthorizedFailedRunReceipt(receipt);
    return ok({
      disposition: 'replay',
      receipt: publicReceipt,
      result: { run: internalRun(run), event: publicEvent(event), receipt: publicReceipt },
    });
  }
  return exactAuthorized20260801Graph(document, subject, null)
    ? ok({ disposition: 'eligible', receipt: null, result: null })
    : fail('conflict', 'the authorized failed run no longer matches its exact historical signature');
}

/**
 * Load-time durability scope, deliberately the same posture as
 * `validateAuthorized20260731RecoveryDurability` above: the receipt's OWN invariants plus the shape of
 * its OWN event. It never re-asserts the whole historical run graph, never reads a global counter, and
 * never looks at other runs — every `load()` runs this, so any predicate that legitimate later
 * mutations (a successor run, a quarantine restore, an unrelated concurrent event) can falsify would
 * make the daemon unable to boot. The settlement's finality is enforced where finality belongs: at
 * MUTATION time (`retryPredecessorRefusal`, reached from `createRun`'s predecessor path).
 */
export function validateAuthorized20260801FailedRunDurability(
  events: readonly StoredEvent[],
  run: StoredRun,
): void {
  const receipt = run.authorizedFailedRunReconciliation;
  if (receipt == null) return;
  if (run.runRef !== AUTHORIZED_20260801_FAILED_RUN_REF
    || receipt.idempotencyKey !== AUTHORIZED_20260801_FAILED_RUN_IDEMPOTENCY_KEY
    || receipt.fingerprint !== AUTHORIZED_20260801_FAILED_RUN_FINGERPRINT
    || !['claimed', 'committed'].includes(receipt.phase)
    || !validNonEmpty(receipt.claimedAt, MAX_SHORT_TEXT) || !validNonEmpty(receipt.updatedAt, MAX_SHORT_TEXT)
    || (receipt.phase === 'claimed' && (receipt.canonicalCommit !== null || receipt.eventCursor !== null))
    || (receipt.phase === 'committed' && (!receipt.canonicalCommit || !/^[a-f0-9]{40}$/.test(receipt.canonicalCommit)
      || !Number.isSafeInteger(receipt.eventCursor) || (receipt.eventCursor ?? 0) < 1))) {
    throw new Error('invalid control-plane authorized failed-run reconciliation receipt');
  }
  if (receipt.phase !== 'committed') return;
  const event = events.find((candidate) => candidate.subject === run.subject
    && candidate.runRef === run.runRef && candidate.cursor === receipt.eventCursor);
  if (!event || event.kind !== 'governance' || event.source !== 'human' || event.status !== 'success'
    || event.stageRef !== null || event.attemptRef !== null || event.sessionRef !== null
    || event.summary !== AUTHORIZED_20260801_RECONCILIATION_SUMMARY
    || event.command !== null || event.toolName !== null || event.path !== null
    || event.diff !== null || event.checkpoint !== null || event.createdAt !== receipt.updatedAt) {
    throw new Error('invalid control-plane authorized failed-run reconciliation event');
  }
}
