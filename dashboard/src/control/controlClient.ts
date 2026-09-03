/**
 * Browser-only client for the managed execution control plane.
 *
 * P2 run wire types come from the type-only shared protocol module; no Node implementation enters the
 * browser graph. Governed mutations always carry an exact hash/version and an idempotency key.
 */
import { invalidateSessionOnGovernedAuthFailure } from '../lib/authClient';
import type {
  AttentionEnvelope,
  ControlRunDto as RunDto,
  OutputRef,
  RunEventPage,
} from '../../server/control/p2Contracts.ts';
import type { AuthenticationResponseJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { performAssertion } from '../lib/webauthnClient.ts';
export type {
  AttentionEnvelope,
  ArchivedFrom as ArchivedFromDto,
  ControlRunDto as RunDto,
  OutputRef,
  RunnableRef as RunnableRefDto,
  RunEventPage,
  RunOutcome as RunOutcomeDto,
} from '../../server/control/p2Contracts.ts';

export type FetchLike = typeof fetch;
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type ProposalDecision = 'approved' | 'rejected' | 'changes-requested';
/** `'auto-closed'` is engine-written only (a terminal run, or the orphan sweep) — never an operator's
 *  own decision; see the server-side type for the full note. */
export type HumanRequestDecision = 'responded' | 'approved' | 'rejected' | 'changes-requested' | 'auto-closed';

export interface ProposalRoutingDto {
  runtime: string;
  model: string;
}

/** Immutable compiler-resolved logical identity. This is provenance, never a queue-card owner. */
export interface ResolvedAgentAssignmentDto {
  agentId: string;
  declarationPath: string;
  declarationHash: string;
  profileId: string;
  runtime: string;
  model: string;
}

export interface AgentWorkspaceLaunchProvenanceDto {
  composerRef: string;
  agentId: string;
  declarationPath: string;
  declarationHash: string;
}

export interface ProposalScopeDto {
  read: string[];
  write: string[];
}

export interface ProposalStageDto {
  id: string;
  title: string;
  action: string;
  target: string;
  workOrder: string;
  riskTier: 'T1' | 'T2' | 'T3';
  dependsOn: string[];
  worker: ProposalRoutingDto;
  requiredSkills: string[];
  scope: ProposalScopeDto;
  artifacts: Array<{ id: string; path: string; description: string }>;
  checkpoints: Array<{ id: string; label: string }>;
  humanGates: Array<{
    id: string;
    kind: 'input' | 'approval' | 'review' | 'intervention' | 'governance-refusal';
    prompt: string;
  }>;
  /** Present only for an immutable compiler-resolved logical assignment. */
  assignment?: ResolvedAgentAssignmentDto;
}

export interface PlanProposalDto {
  schema: 'kb.plan-proposal/v1';
  proposalId: string;
  project: string;
  title: string;
  summary: string;
  manager: ProposalRoutingDto & { requiredSkills: string[]; assignment?: ResolvedAgentAssignmentDto };
  scope: ProposalScopeDto;
  governanceRefs: string[];
  stages: ProposalStageDto[];
}

export interface ProposalDiffDto {
  schema: 'kb.plan-proposal-diff/v1';
  fromContentHash: string | null;
  toContentHash: string;
  changed: boolean;
  changes: Array<{ path: string; before: JsonValue | undefined; after: JsonValue | undefined }>;
}

export interface ProposalRevisionDto {
  proposalRef: string;
  revision: number;
  contentHash: string;
  previousContentHash: string | null;
  createdAt: string;
  /**
   * PROVENANCE — who authored this revision. Both fields have always been on the wire (the proposals
   * route sends the store records verbatim) and both were silently dropped by the normalizers below.
   * That drop is exactly why a workflow launch returned an inert `runRef` with nothing to link back to.
   *
   * `sourceComposerRef` is `'workflow-registry'` for a workflow-launched revision (stamped by
   * `server/workflows/routes.ts`), and `sourceTurnId` is then the WORKFLOW DEFINITION ID. That pair is
   * the authoritative workflow → runs join key — see `entityLinks.ts`. Re-dropping either field
   * silently unlinks the two entities, so `entityLinks.test.ts` asserts they survive normalization.
   */
  sourceComposerRef: string;
  sourceTurnId: string;
  proposal: PlanProposalDto;
  /** Present on a freshly imported/created revision. A reloaded revision remains reviewable by hash. */
  diff: ProposalDiffDto | null;
  approval: {
    revision: number;
    decision: ProposalDecision;
    decidedAt: string;
  } | null;
}

export type ProposalRevisionMetadataDto = Omit<ProposalRevisionDto, 'proposal' | 'diff'>;

export interface LaunchProposalResultDto {
  runRef: string;
  waitingHuman?: boolean;
  cards?: Array<{ stageId: string; cardId: string; cardPath: string }>;
}

export type RunState =
  | 'planned' | 'recovering' | 'running' | 'waiting-human' | 'stopping'
  | 'succeeded' | 'failed' | 'stopped' | 'interrupted'
  /** Operator-dismissed and terminal. Out of the default run list; still readable by ref forever. */
  | 'archived';
export type StageState = 'blocked' | 'ready' | 'running' | 'waiting-human' | 'succeeded' | 'failed' | 'stopped' | 'interrupted';
export type AttemptState = 'queued' | 'starting' | 'running' | 'waiting-human' | 'succeeded' | 'failed' | 'stopped' | 'interrupted';
export type ManagedSessionState = 'pending' | 'starting' | 'running' | 'waiting' | 'completed' | 'failed' | 'stopped' | 'interrupted';

export interface RunMetadataDto extends RunDto {
  /**
   * The subject that owns this run: `operator` for one launched by hand here, `dashboard-engine` for
   * one the queue bridge or the executor launched headlessly. A verified operator session lists every
   * subject's runs in one list, so the rows need this to be told apart — including the daemon's own
   * synthetic acceptance runs, which are deliberately listed rather than filtered.
   */
  ownerSubject: string;
  stageCount: number;
  attemptCount: number;
  sessionCount: number;
  openHumanRequestCount: number;
  eventCount: number;
}

export interface StageDto {
  stageRef: string;
  runRef: string;
  stageId: string;
  title: string;
  dependsOn: string[];
  canonicalCardRef: string | null;
  state: StageState;
  version: number;
  currentAttemptRef: string | null;
  /** Immutable logical-worker provenance, or null for a legacy/unassigned stage. */
  assignment: ResolvedAgentAssignmentDto | null;
  createdAt: string;
  updatedAt: string;
}

export interface AttemptDto {
  attemptRef: string;
  runRef: string;
  stageRef: string;
  generation: number;
  predecessorAttemptRef: string | null;
  runtime: string;
  model: string;
  state: AttemptState;
  version: number;
  managedSessionRef: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ManagedSessionDto {
  sessionRef: string;
  runRef: string;
  stageRef: string | null;
  attemptRef: string | null;
  role: 'manager' | 'worker';
  generation: number;
  predecessorSessionRef: string | null;
  runtime: string;
  model: string;
  attemptOperationKey?: string | null;
  state: ManagedSessionState;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface HumanRequestDto {
  requestRef: string;
  runRef: string;
  /**
   * The OWNING RUN's display identity, not the request's — a Human Request has no registry identity of
   * its own, and every surface listing one shows "which run needs you" beside the request's `title`.
   * Feed these to `<EntityName kind="run" id={request.runRef} …>`.
   */
  displayName: string;
  shortRef: number;
  stageRef: string | null;
  kind: 'input' | 'approval' | 'review' | 'intervention' | 'governance-refusal';
  /** Present only for the dedicated fail-closed iteration parking boundary. */
  gateKind?: 'iteration-park';
  revision: number;
  state: 'open' | 'resolved';
  title: string;
  prompt: string;
  /**
   * The plain-language rendering of this request: what happened and what the operator can do, in one
   * sentence, built server-side in `server/control/humanRequestAsk.ts`. This is the ONLY text a surface
   * may use as the primary "what needs you" line — `title`/`prompt` are the machine's own words.
   */
  ask: string;
  /** The machine's words (traceback, refusal code) — a detail fold, never the ask. Null when empty. */
  technicalDetail: string | null;
  response: {
    requestRevision: number;
    decision: HumanRequestDecision;
    response: string | null;
    respondedAt: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export type IterationRoleDto = 'peer' | 'judge' | 'mediator' | 'manager' | 'coordinator' | 'contributor';
export type IterationRequestKindDto = 'review' | 'rework' | 'position' | 'reply' | 'delegate' | 'check';
export type IterationVerdictDto =
  | 'fulfilled'
  | 'accept' | 'rework'
  | 'pass' | 'fail'
  | 'consensus' | 'continue'
  | 'complete' | 'parked';
export type IterationParkReasonDto = 'exhausted' | 'no-progress' | 'parked';

export interface IterationParticipantDto {
  participantId: string;
  /** Definition stage id (not the run-scoped StageDto.stageRef). */
  stageRef: string;
  role: IterationRoleDto;
  perspective: string;
  mandate: string;
  goal?: string;
}

export interface IterationRouteDto {
  routeId: string;
  senderParticipantId: string;
  recipientParticipantId: string;
  requestKinds: IterationRequestKindDto[];
  baseResolutionStageIds: string[];
}

export interface IterationScheduleStepDto {
  stepId: string;
  routeId: string;
  after?: { stepId: string; participantId: string; verdict: IterationVerdictDto };
  cycle: 'current' | 'next';
}

export interface IterationFindingDto {
  findingId: string;
  criterionId: string;
  severity: 'blocking' | 'advisory';
  summary: string;
  evidencePaths: string[];
}

export interface IterationPositionDto {
  positionId: string;
  participantId: string;
  summary: string;
  generationRefs: string[];
}

export interface IterationDissentDto {
  dissentId: string;
  participantId: string;
  positionId: string;
  summary: string;
}

export interface IterationCriterionOutcomeDto {
  criterionId: string;
  verdict: 'pass' | 'fail' | 'unverified';
  findingIds: string[];
}

export interface IterationOutcomeDto {
  schema: 'kb.iteration-outcome/v1';
  requestRef: string;
  iterationLoopRef: string;
  participantId: string;
  cycle: number;
  verdict: IterationVerdictDto;
  inputGenerationRefs: string[];
  criteria: IterationCriterionOutcomeDto[];
  findings: IterationFindingDto[];
  resolvedFindingRefs?: string[];
  positions: IterationPositionDto[];
  recordedDissent: IterationDissentDto[];
  summary: string;
}

export interface IterationArtifactSnapshotDto {
  path: string;
  regularFile: boolean;
  size: number | null;
  sha256: string | null;
  afterRegularFile: boolean;
  afterSize: number | null;
  afterSha256: string | null;
  byteIdentical: boolean;
}

export interface IterationResidueDto {
  unresolvedFindings: IterationFindingDto[];
  positions: IterationPositionDto[];
  recordedDissent: IterationDissentDto[];
  requestRefs: string[];
  receiptRefs: string[];
  activeGenerationRefs: string[];
  acceptedGenerationRefs: string[];
  nextRouteId: string;
  cycleUnit: string;
  cyclesUsed: number;
  maxCycles: number;
  attemptedRequestRef?: string;
  /** Distinct from cyclesUsed: a no-progress attempt is rolled back before parking. */
  attemptedRequestCycle?: number;
  attemptedOutcome?: IterationOutcomeDto;
  artifactSnapshots?: IterationArtifactSnapshotDto[];
  failureReason?: string;
}

export interface IterationRequestDto {
  schema: 'kb.iteration-request/v1';
  requestRef: string;
  iterationLoopRef: string;
  stepId?: string;
  routeId: string;
  senderParticipantId: string;
  recipientParticipantId: string;
  kind: IterationRequestKindDto;
  cycle: number;
  inputGenerationRefs: string[];
  baseCommit: string;
  artifactHashes: Record<string, string>;
  criteria: Array<{ id: string; description: string }>;
  unresolvedFindingRefs: string[];
  preservedInvariants: string[];
  nextAcceptanceCheck: string;
  instructions: string;
}

export interface IterationReceiptDto extends Omit<IterationOutcomeDto, 'schema'> {
  schema: 'kb.iteration-receipt/v1';
  receiptRef: string;
  outcomeHash: string;
  outputGenerationRefs: string[];
  baseCommit: string;
  canonicalCommit: string;
  createdAt: string;
  version: number;
}

export interface StageGenerationDto {
  generationRef: string;
  runRef: string;
  logicalStageRef: string;
  logicalStageId: string;
  generation: number;
  predecessorGenerationRef: string | null;
  attemptRef: string;
  canonicalResultOperationKey: string | null;
  resultHash: string | null;
  resultCardRef: string | null;
  baseCommit: string | null;
  canonicalCommit: string | null;
  state: 'queued' | 'committed';
  createdAt: string;
  updatedAt: string;
}

export interface GenerationSupersessionDto {
  runRef: string;
  predecessorGenerationRef: string;
  successorGenerationRef: string;
  triggerReceiptRef: string;
  operationKey: string;
  createdAt: string;
}

export interface IterationLoopDto {
  iterationLoopRef: string;
  runRef: string;
  definitionHash: string;
  iterationGroupId: string;
  goal?: string;
  participants: IterationParticipantDto[];
  routes: IterationRouteDto[];
  activation: { seedParticipantId: string; seedArtifactIds: string[] };
  initialStepId: string;
  schedule: IterationScheduleStepDto[];
  artifacts: string[];
  criteria: Array<{ id: string; description: string }>;
  maxCycles: number;
  cycleUnit: string;
  terminalAuthorities: Array<{ participantId: string; verdict: Extract<IterationVerdictDto, 'accept' | 'pass' | 'consensus' | 'complete'> }>;
  completionGate?: { id: string; kind: 'approval'; prompt: string; requiresReview: 'pass' };
  cyclesUsed: number;
  state:
    | 'awaiting-seed' | 'awaiting-turn' | 'running-turn'
    | 'failed' | 'rework-queued' | 'exhausted'
    | 'parked' | 'awaiting-completion-gate' | 'awaiting-park-gate'
    | 'passed' | 'declined';
  turnOwnerParticipantId?: string;
  currentStepId?: string;
  activeGenerationRefs: string[];
  acceptedGenerationRefs?: string[];
  lastReceiptRef?: string;
  completionGateRef?: string;
  interventionRef?: string;
  parkReason?: IterationParkReasonDto;
  unresolvedResidue?: IterationResidueDto;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * One PTY session bound to one Run attempt. Deliberately a DUPLICATE of the `shared/ptyProtocol.ts`
 * and `server/control/p2Contracts.ts` declarations (plan [C-M4]): the browser pins its own copy and
 * decodes it strictly, so a server-side widening is refused at the boundary rather than rendered.
 */
export type PtySessionState = 'starting' | 'live' | 'closing' | 'exited' | 'abandoned';
export type PublicExitDto = { exitCode: number | null; reason: 'exited' | 'closed' | 'abandoned'; observedAt: string };
export interface AttemptSessionPublicRow {
  attemptRef: string;
  sessionId: string;
  launcher: 'claude' | 'codex';
  state: PtySessionState;
  startedAt: string;
  endedAt: string | null;
  exit: PublicExitDto | null;
  controllerClaimed: boolean;
  liveControl: boolean;
}

export interface RunDetailDto {
  /**
   * [C-M4] The Run console contract, pinned REQUIRED on both sides. `sessionId` is the server's
   * selection among `attemptSessions` and is `null`, never absent, when there is nothing to open;
   * `attemptSessions` is every attempt session in the server's binding order — the browser renders
   * that order as given and never re-sorts it.
   */
  streamKind: 'pty' | 'transcript';
  sessionId: string | null;
  attemptSessions: AttemptSessionPublicRow[];
  outputs?: OutputRef[];
  run: RunDto;
  /** The subject that owns this run. See {@link RunMetadataDto.ownerSubject}. */
  ownerSubject: string;
  stages: StageDto[];
  attempts: AttemptDto[];
  sessions: ManagedSessionDto[];
  humanRequests: HumanRequestDto[];
  stageGenerations: StageGenerationDto[];
  generationSupersessions: GenerationSupersessionDto[];
  iterationLoops: IterationLoopDto[];
  iterationRequests: IterationRequestDto[];
  iterationReceipts: IterationReceiptDto[];
}

/**
 * Browser-side mirror of the single server-fixed historical settlement.  These are deliberately
 * not inputs: the browser cannot repurpose this endpoint for another run or a fresh operation.
 */
export const AUTHORIZED_FAILED_RUN_RECONCILIATION = {
  runRef: 'run-0aa72053-b9d7-41fa-a034-19871b66d214',
  proposalRef: 'proposal-3725fb98-e20e-4619-b6e7-c9055138a50d',
  proposalHash: '396480363d02620c25730160e00fd7adf51e1eff43f8427c80b2062a18dc80d9',
  managerSessionRef: 'session-54ef91fa-6607-4f0e-a2f6-f9edd87873bb',
  requestRef: 'request-86d0fc5f-797b-483c-a706-96a45e6f4d6e',
  idempotencyKey: 'reconcile:2026-08-01:run-0aa72053-b9d7-41fa-a034-19871b66d214:failed-launch:v7',
} as const;

export const AUTHORIZED_FAILED_RUN_RECONCILIATION_STAGES = [
  ['idea', 'stage-ea9da6f4-2b54-4664-a4ae-f2a47885e51b', 'wf-44c4644fe9fb254f8803fb48', 'attempt-e5672116-acdb-4dfd-887a-5c0566b92ae7', 'session-8445469e-a733-4a66-908f-b6a58f513323', 'codex', 'gpt-5.6-terra', []],
  ['story', 'stage-80eefd76-49ff-4307-9c4c-c66a1339d561', 'wf-84370585b7737c38f03a01a4', 'attempt-ba96da92-a01b-4f5f-9b9e-1cca3e7881bb', 'session-4ee8bf7b-7f3d-4d99-ae5c-8c997cbfc285', 'codex', 'gpt-5.6-terra', ['idea']],
  ['judge-gate', 'stage-cd27c97b-aa9e-44d1-beb9-d6ce652ce7e0', 'wf-ceedb44776e9f0b99fb95336', 'attempt-536e1401-aa6b-471b-9835-6769d209f53f', 'session-5e55ff31-4afc-4c17-bb9e-46355e1c425d', 'codex', 'gpt-5.6-sol', ['story']],
  ['packaging', 'stage-d38f12d7-185d-4bd1-b8e4-f9e9f53cac4c', 'wf-6489321a47f5ec64ef65b576', 'attempt-0adcdec3-786c-4992-9a06-49d71f495016', 'session-357f7a4a-e34f-471a-988b-6ae74eee9776', 'codex', 'gpt-5.6-terra', ['judge-gate']],
  ['visual-plan', 'stage-c4b5e74f-2198-4cac-9ae9-b1a02958aa85', 'wf-97a7a138bc0243e9f703e6f4', 'attempt-4cd57296-7228-4369-b0e7-aada10d49400', 'session-4d79b327-5ab6-4af8-a068-1ce0f21393ce', 'codex', 'gpt-5.6-terra', ['packaging']],
  ['shots-merge', 'stage-07c4a75c-3c5e-4b02-a682-47ec20450aff', 'wf-5270609bdb7cb8c2b0100eb8', 'attempt-9021bd2e-6ae4-4855-8b63-bb18639c5d9b', 'session-cc0b4e1d-da87-4435-b8ad-135aa7968733', 'codex', 'gpt-5.6-sol', ['visual-plan']],
  ['slice-contract', 'stage-28ed1538-43de-4e01-a99a-a4aaedc0ae1b', 'wf-ccd1e0e57af699cfd88d4dc6', 'attempt-703db9af-289a-4e7b-9c65-95a94d613b9d', 'session-a02036cd-bcaf-4dce-8099-bbad014b9361', 'codex', 'gpt-5.6-sol', ['visual-plan']],
  ['images', 'stage-2dd2e4e4-2e26-4090-aa85-3e199f080d58', 'wf-b2474af1b1687c4a7ed2475c', 'attempt-7219abe7-739f-4701-a7a8-c2eb088f90b5', 'session-43a4a0d2-c29d-44c2-96b7-dde19a606a3f', 'codex', 'gpt-5.6-terra', ['shots-merge', 'slice-contract']],
  ['image-review', 'stage-c9b76af0-728a-4431-a6d8-fc93ad6d3d13', 'wf-27e4f71519c58f4deceeff24', 'attempt-a605f573-df49-4b37-8e4f-0990089d608a', 'session-9da0dce9-465e-4e20-988f-d3896b5bfbd8', 'codex', 'gpt-5.6-sol', ['images']],
  ['audio', 'stage-95f7eccd-7a2c-4c32-a9b4-c847ef7a7101', 'wf-3ab267b511946c0a21318d0d', 'attempt-56927bad-37fb-4b69-af60-6afef22ab4df', 'session-021b0f7d-2104-498f-8169-14e02d9f18ee', 'codex', 'gpt-5.6-terra', ['image-review']],
  ['audio-plan-merge', 'stage-e7ab5eff-6f41-4851-8558-6c886aa18946', 'wf-978552383fd8f556cac9b416', 'attempt-fa5135e6-1973-4489-a529-86a1779aec0d', 'session-4c24da14-beb4-4816-b838-afc1244dc230', 'codex', 'gpt-5.6-sol', ['audio']],
  ['render', 'stage-86f3358e-9ff1-45b5-8c81-505411bb3c83', 'wf-ad666acabdf313544d841456', 'attempt-5e44a62f-fb32-41cb-aa23-8ab5ab9167b1', 'session-76a7c42f-345d-4369-b5c7-72cbcde88195', 'codex', 'gpt-5.6-terra', ['audio-plan-merge']],
  ['verify', 'stage-bdee2033-e216-46f4-a20e-f04ab43c09bb', 'wf-a767b15b4fd4c74c8b86b258', 'attempt-f83b955e-69d7-4905-8b00-66b532244be2', 'session-7700d49d-3941-40e5-b11f-4e313c366061', 'codex', 'gpt-5.6-sol', ['render']],
] as const;

export const AUTHORIZED_FAILED_RUN_RECONCILIATION_EVENT_SIGNATURES = [
  ['governance', 'system', 'waiting', 'canonical run published; runtime activation remains gated', null, null, null, '2026-08-01T02:04:04.767Z'],
  ['governance', 'human', 'success', 'authorized 2026-07-31 execution-lock boundary reclassified to intervention', null, null, null, '2026-08-01T03:31:39.866Z'],
  ['governance', 'human', 'success', 'Human Request responded at revision 2', null, null, null, '2026-08-01T03:32:43.924Z'],
  ['lifecycle', 'worker', 'failure', 'Codex workspace contains an unsupported changed path', 'stage-ea9da6f4-2b54-4664-a4ae-f2a47885e51b', 'attempt-e5672116-acdb-4dfd-887a-5c0566b92ae7', 'session-8445469e-a733-4a66-908f-b6a58f513323', '2026-08-01T03:32:49.322Z'],
  ['lifecycle', 'system', 'interrupted', 'dashboard restarted; active control-plane records were normalized to interrupted', null, null, null, '2026-08-01T08:18:11.696Z'],
] as const;

/** True only for the public, pre-v8 projection of the one authorized historical predecessor. */
export function isAuthorizedFailedRunReconciliationCandidate(
  detail: RunDetailDto,
  events: OperationalEventDto[],
): boolean {
  const { run } = detail;
  const request = detail.humanRequests[0];
  return run.runRef === AUTHORIZED_FAILED_RUN_RECONCILIATION.runRef
    && run.predecessorRunRef === null
    && run.title === 'Validate one all-Codex faceless-video opening slice'
    && run.proposalRef === AUTHORIZED_FAILED_RUN_RECONCILIATION.proposalRef
    && run.proposalRevision === 1
    && run.proposalHash === AUTHORIZED_FAILED_RUN_RECONCILIATION.proposalHash
    && run.publicationState === 'published' && run.state === 'failed' && run.version === 7
    && run.managerSessionRef === AUTHORIZED_FAILED_RUN_RECONCILIATION.managerSessionRef
    && run.managerGeneration === 1 && run.createdAt === '2026-08-01T02:04:03.640Z'
    && run.updatedAt === '2026-08-01T03:32:49.635Z'
    && detail.stages.length === 13 && detail.attempts.length === 13 && detail.sessions.length === 14
    && detail.stageGenerations.length === 0 && detail.generationSupersessions.length === 0
    && detail.iterationLoops.length === 0 && detail.iterationRequests.length === 0 && detail.iterationReceipts.length === 0
    && detail.humanRequests.length === 1 && !!request
    && request.requestRef === AUTHORIZED_FAILED_RUN_RECONCILIATION.requestRef
    && request.runRef === run.runRef && request.stageRef === null && request.kind === 'intervention'
    && request.revision === 2 && request.state === 'resolved' && request.title === 'Automatic execution activation is gated'
    && request.prompt === 'Canonical cards are published. Unlock execution with your passkey, mark this intervention responded, then resume this same run.'
    && request.response?.requestRevision === 2 && request.response.decision === 'responded'
    && request.response.response === null && request.response.respondedAt === '2026-08-01T03:32:43.921Z'
    && request.createdAt === '2026-08-01T02:04:04.762Z'
    && request.updatedAt === '2026-08-01T03:32:43.921Z'
    && detail.stages.every((stage, index) => {
      const expected = AUTHORIZED_FAILED_RUN_RECONCILIATION_STAGES[index];
      return !!expected && stage.runRef === run.runRef && stage.stageId === expected[0] && stage.stageRef === expected[1]
        && stage.canonicalCardRef === expected[2] && stage.currentAttemptRef === expected[3]
        && stage.dependsOn.length === expected[7].length
        && stage.dependsOn.every((dependency, dependencyIndex) => dependency === expected[7][dependencyIndex])
        && stage.state === (index === 0 ? 'failed' : 'blocked') && stage.version === (index === 0 ? 5 : 3);
    })
    && detail.attempts.every((attempt, index) => {
      const expected = AUTHORIZED_FAILED_RUN_RECONCILIATION_STAGES[index];
      return !!expected && attempt.runRef === run.runRef && attempt.attemptRef === expected[3] && attempt.stageRef === expected[1]
        && attempt.managedSessionRef === expected[4] && attempt.runtime === expected[5] && attempt.model === expected[6]
        && attempt.generation === 1 && attempt.predecessorAttemptRef === null
        && attempt.state === (index === 0 ? 'failed' : 'queued') && attempt.version === (index === 0 ? 5 : 2);
    })
    && detail.sessions[0]?.sessionRef === run.managerSessionRef && detail.sessions[0].runRef === run.runRef && detail.sessions[0].stageRef === null
    && detail.sessions[0].attemptRef === null && detail.sessions[0].role === 'manager' && detail.sessions[0].generation === 1
    && detail.sessions[0].predecessorSessionRef === null && detail.sessions[0].runtime === 'codex' && detail.sessions[0].model === 'gpt-5.6-sol'
    && detail.sessions[0].state === 'interrupted' && detail.sessions[0].version === 4
    && detail.sessions.slice(1).every((session, index) => {
      const expected = AUTHORIZED_FAILED_RUN_RECONCILIATION_STAGES[index];
      return !!expected && session.runRef === run.runRef && session.sessionRef === expected[4] && session.stageRef === expected[1] && session.attemptRef === expected[3]
        && session.role === 'worker' && session.generation === 1 && session.predecessorSessionRef === null
        && session.runtime === expected[5] && session.model === expected[6]
        && session.state === (index === 0 ? 'failed' : 'pending') && session.version === (index === 0 ? 4 : 1);
    })
    && events.length === 5 && events.every((event, index) => {
      const expected = AUTHORIZED_FAILED_RUN_RECONCILIATION_EVENT_SIGNATURES[index];
      return !!expected && event.cursor === index + 1 && event.runRef === run.runRef
        && event.kind === expected[0] && event.source === expected[1] && event.status === expected[2]
        && event.summary === expected[3] && event.stageRef === expected[4] && event.attemptRef === expected[5]
        && event.sessionRef === expected[6] && event.command === null && event.toolName === null && event.path === null
        && event.diff === null && event.checkpoint === null && event.createdAt === expected[7];
    });
}

/** The event the settlement writes; also the browser-visible proof that it completed. */
export const AUTHORIZED_FAILED_RUN_RECONCILIATION_SUMMARY =
  'authorized one-off reconciliation settled the failed 2026-07-31 FYT thin-slice predecessor';

/**
 * True once the one authorized run is settled. The settlement stops every stage, attempt, and session,
 * which is exactly the shape that makes a run look like the most eligible Retry predecessor in the
 * store — so without this the cockpit would offer a Retry the store refuses at mutation time
 * (`retryPredecessorRefusal`). The refusal is stated in the cockpit instead of being discovered by a click.
 */
export function isAuthorizedFailedRunSettled(
  detail: RunDetailDto,
  events: OperationalEventDto[],
): boolean {
  return detail.run.runRef === AUTHORIZED_FAILED_RUN_RECONCILIATION.runRef
    && detail.run.version >= 8
    && events.some((event) => event.runRef === detail.run.runRef
      && event.summary === AUTHORIZED_FAILED_RUN_RECONCILIATION_SUMMARY);
}

/** Stable server code for 'the ops commit is durable, only the control-plane record is outstanding'. */
export const AUTHORIZED_FAILED_RUN_PUBLISHED_UNCOMMITTED_CODE =
  'authorized-failed-run-reconciliation-published-uncommitted';

/** Distinguish a durable-but-unfinalized settlement from a genuine refusal. */
export function isAuthorizedFailedRunPublishedUncommitted(cause: unknown): boolean {
  return cause instanceof ControlApiError && cause.code === AUTHORIZED_FAILED_RUN_PUBLISHED_UNCOMMITTED_CODE;
}

export interface OperationalEventDto {
  cursor: number;
  runRef: string;
  kind: 'message' | 'command' | 'tool' | 'file' | 'diff' | 'checkpoint' | 'lifecycle' | 'session-link' | 'governance';
  source: 'system' | 'manager' | 'worker' | 'human';
  stageRef: string | null;
  attemptRef: string | null;
  sessionRef: string | null;
  status: 'pending' | 'running' | 'success' | 'failure' | 'stopped' | 'interrupted' | 'waiting' | null;
  summary: string | null;
  command: string | null;
  toolName: string | null;
  path: string | null;
  diff: string | null;
  checkpoint: string | null;
  createdAt: string;
}

export interface StorageInventoryItemDto {
  runRef: string;
  title: string;
  state: RunState;
  updatedAt: string;
  eventCount: number;
  estimatedBytes: number;
  quarantinedAt: string | null;
  /** The subject that owns the bundle; quarantine and restore never move it. See `RunDto.ownerSubject`. */
  ownerSubject: string;
}

export interface StorageInventoryDto {
  activeRuns: StorageInventoryItemDto[];
  quarantinedRuns: StorageInventoryItemDto[];
  proposalRevisionCount: number;
  nextEventCursor: number;
  estimatedBytes: number;
}

export interface QuarantinePlanDto {
  planHash: string;
  createdAt: string;
  items: Array<StorageInventoryItemDto & { eligible: boolean }>;
  estimatedBytes: number;
}

export class ControlApiError extends Error {
  readonly status: number;
  readonly reason: string;
  /** Stable server error discriminator; unlike `reason`, this never prefers human-readable detail. */
  readonly code: string;
  /**
   * The refusal body as the server sent it, for the routes whose refusals carry STRUCTURED data a
   * caller must act on — the [C-R6] replay gap's `nextSequence`/`floorSequence` is the first. Kept as
   * the raw record rather than a field per route: a caller that wants one of these numbers must
   * validate it itself, and no route can widen this error class by adding a refusal field.
   */
  readonly body: Record<string, unknown> | null;

  constructor(
    status: number,
    reason: string,
    code: string = reason,
    body: Record<string, unknown> | null = null,
  ) {
    super(reason ? `control request refused: ${status} (${reason})` : `control request refused: ${status}`);
    this.status = status;
    this.reason = reason;
    this.code = code;
    this.body = body;
  }
}

/** Mirrors the server's `ExecutionUnlockSource`; `tailnet` is the always-on deployment's arm-at-boot
 *  posture. An unrecognized source makes the parser drop the whole posture, so this must stay in step
 *  with `server/control/activation.ts`. */
export type ExecutionUnlockSourceDto = 'passkey' | 'env-override' | 'tailnet';

export interface ExecutionPostureDto {
  state: 'locked' | 'unlocked' | 'injected';
  source: ExecutionUnlockSourceDto | null;
  unlockedAt: string | null;
  unlockedBy: string | null;
  unlockRoute?: string;
}

export function parseExecutionPosture(value: unknown): ExecutionPostureDto | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const allowed = new Set(['state', 'source', 'unlockedAt', 'unlockedBy', 'unlockRoute']);
  if (Object.keys(item).some((key) => !allowed.has(key))) return null;
  if (item.state !== 'locked' && item.state !== 'unlocked' && item.state !== 'injected') return null;
  if (item.state === 'locked') {
    if (item.source !== null || item.unlockedAt !== null || item.unlockedBy !== null) return null;
    if (item.unlockRoute !== undefined && item.unlockRoute !== '/api/control/execution/unlock') return null;
    return {
      state: 'locked', source: null, unlockedAt: null, unlockedBy: null,
      ...(item.unlockRoute === '/api/control/execution/unlock' ? { unlockRoute: item.unlockRoute } : {}),
    };
  }
  if (item.state === 'injected') {
    // This is the server's no-latch posture: execution was injected directly and has no unlock event.
    if (item.source !== null || item.unlockedAt !== null || item.unlockedBy !== null || item.unlockRoute !== undefined) {
      return null;
    }
    return { state: 'injected', source: null, unlockedAt: null, unlockedBy: null };
  }
  if (item.source !== 'passkey' && item.source !== 'env-override' && item.source !== 'tailnet') return null;
  if (typeof item.unlockedAt !== 'string') return null;
  const unlockedAtMs = Date.parse(item.unlockedAt);
  if (!Number.isFinite(unlockedAtMs) || new Date(unlockedAtMs).toISOString() !== item.unlockedAt) return null;
  if (typeof item.unlockedBy !== 'string' || item.unlockedBy.trim().length === 0) return null;
  if (item.unlockRoute !== undefined) return null;
  return {
    state: 'unlocked', source: item.source, unlockedAt: item.unlockedAt, unlockedBy: item.unlockedBy,
  };
}

/** Read the daemon execution latch. A dashboard login is necessary, but never implies this is unlocked. */
export async function getExecutionPosture(token: string, fetchImpl?: FetchLike): Promise<ExecutionPostureDto> {
  const body = await read<{ execution?: unknown }>('/api/control/execution', token, fetchImpl);
  const posture = parseExecutionPosture(body.execution);
  if (!posture) throw new Error('execution state response was invalid');
  return posture;
}

/**
 * Arm the daemon's execution latch under the operator's EXISTING dashboard session.
 *
 * This used to run a second, purpose-bound WebAuthn ceremony of its own, which meant an operator who
 * had already signed in was prompted for a biometric TWICE. The platform's requirement is one dashboard
 * unlock for the whole platform, so authorization is now the session bearer every other governed
 * mutation carries; the server independently verifies it and writes the same T3 audit row. Arming is
 * still an explicit act — signing in never calls this. A 200 is accepted only when the server confirms
 * a passkey-sourced unlocked posture.
 */
export async function unlockExecution(token: string, fetchImpl?: FetchLike): Promise<ExecutionPostureDto> {
  const unlockedBody = await write<{ ok?: unknown; execution?: unknown }>(
    '/api/control/execution/unlock', {}, token, fetchImpl,
  );
  const posture = parseExecutionPosture(unlockedBody.execution);
  if (unlockedBody.ok !== true || posture?.state !== 'unlocked' || posture.source !== 'passkey') {
    throw new Error('execution unlock response was not passkey-authorized');
  }
  return posture;
}

/** Stable operator copy for the explicit execution ceremony; raw server details never reach the panel. */
export function executionUnlockErrorMessage(error: unknown): string {
  const detail = error && typeof error === 'object'
    ? [
        'name' in error && typeof error.name === 'string' ? error.name : '',
        'message' in error && typeof error.message === 'string' ? error.message : '',
      ].filter(Boolean).join(': ')
    : '';
  if (/cancel|abort|notallowederror/i.test(detail)) {
    return 'Execution unlock was cancelled. Execution remains locked.';
  }
  if (/not supported|webauthn.+unavailable/i.test(detail)) {
    return 'This browser cannot use the execution passkey. Open this dashboard in a WebAuthn-capable browser.';
  }
  if (/not passkey-authorized|response was invalid|options response was invalid/i.test(detail)) {
    return 'The server did not confirm a passkey-authorized unlock. Execution remains locked.';
  }
  if (/401|credential|unauthenticated/i.test(detail)) {
    return 'The execution passkey was refused. Use the enrolled passkey and try again.';
  }
  if (/503|unconfigured/i.test(detail)) {
    return 'Execution passkeys are not configured on this dashboard server.';
  }
  return 'Execution unlock failed. Execution remains locked; retry or check the dashboard server logs.';
}

interface RequestOptions {
  token?: string;
  fetchImpl?: FetchLike;
}

/**
 * Every governed 401 on this surface is now a bearer failure: the execution-unlock route no longer
 * verifies a second WebAuthn assertion, so there is no longer a class of 401 that means "your session
 * is fine, the second factor was refused". The `preserveSessionOnAuthFailure` seam that carved out
 * those assertion-refusal envelopes was removed with it — a 401 here always invalidates the session,
 * and nothing else (notably 429) ever does.
 */
async function request<T>(path: string, init: RequestInit, options: RequestOptions = {}): Promise<T> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  if (init.body !== undefined) headers.set('content-type', 'application/json');
  if (options.token) headers.set('authorization', `Bearer ${options.token}`);
  const response = await fetchImpl(path, { ...init, headers });
  // Only a 401 needs a preserved body for the shared invalidator. Successful and unrelated refusal
  // responses are consumed once and never cloned (some fetch shims intentionally cannot clone them).
  let authFailureResponse: Response | null = null;
  if (response.status === 401) {
    try {
      authFailureResponse = typeof response.clone === 'function' ? response.clone() : response;
    } catch {
      // A broken fetch shim must not replace the endpoint's real 401 with a clone exception.
    }
  }
  const body = await response.json().catch(() => ({})) as T & { reason?: unknown; detail?: unknown; error?: unknown };
  if (authFailureResponse) {
    await invalidateSessionOnGovernedAuthFailure(authFailureResponse);
  }
  if (!response.ok) {
    const code = typeof body.error === 'string' ? body.error : '';
    const reason = [body.detail, body.reason, body.error].find((value): value is string => typeof value === 'string') ?? '';
    throw new ControlApiError(response.status, reason, code, wireRecord(body));
  }
  return body;
}

const read = <T>(path: string, token: string, fetchImpl?: FetchLike): Promise<T> => request<T>(path, { method: 'GET' }, { token, fetchImpl });
const write = <T>(path: string, body: unknown, token: string, fetchImpl?: FetchLike): Promise<T> =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body) }, { token, fetchImpl });
const segment = (value: string): string => encodeURIComponent(value);

interface RawProposalRevision {
  proposalRef: string;
  sourceComposerRef: string;
  sourceTurnId: string;
  revision: number;
  hash: string;
  previousHash: string | null;
  title: string;
  createdAt: string;
  snapshot: PlanProposalDto;
  approval: ProposalRevisionDto['approval'];
}

interface RawProposalMetadata extends Omit<RawProposalRevision, 'snapshot'> {}

function normalizedRevision(value: RawProposalRevision, diff: ProposalDiffDto | null = null): ProposalRevisionDto {
  return {
    proposalRef: value.proposalRef,
    revision: value.revision,
    contentHash: value.hash,
    previousContentHash: value.previousHash,
    createdAt: value.createdAt,
    sourceComposerRef: value.sourceComposerRef,
    sourceTurnId: value.sourceTurnId,
    proposal: value.snapshot,
    diff,
    approval: value.approval,
  };
}

function normalizedMetadata(value: RawProposalMetadata): ProposalRevisionMetadataDto {
  return {
    proposalRef: value.proposalRef,
    revision: value.revision,
    contentHash: value.hash,
    previousContentHash: value.previousHash,
    createdAt: value.createdAt,
    // The join key. `listProposalRevisions` is the ONLY way the browser learns which workflow
    // definition produced a run, so dropping these here (as this function did) severed the link.
    sourceComposerRef: value.sourceComposerRef,
    sourceTurnId: value.sourceTurnId,
    approval: value.approval,
  };
}

export async function listProposalRevisions(
  composerRef: string | undefined,
  token: string,
  fetchImpl?: FetchLike,
): Promise<ProposalRevisionMetadataDto[]> {
  const query = composerRef ? `?composerRef=${encodeURIComponent(composerRef)}` : '';
  const body = await read<{ proposals: RawProposalMetadata[] }>(`/api/control/proposals${query}`, token, fetchImpl);
  return body.proposals.map(normalizedMetadata);
}

export async function getProposalRevision(
  proposalRef: string,
  revision: number,
  token: string,
  fetchImpl?: FetchLike,
): Promise<ProposalRevisionDto> {
  const body = await read<{ ok: true; value: RawProposalRevision }>(
    `/api/control/proposals/${segment(proposalRef)}/revisions/${revision}`,
    token,
    fetchImpl,
  );
  return normalizedRevision(body.value);
}

export function importProposal(
  input: { composerRef: string; turnId: string; proposalRef?: string; expectedPreviousHash?: string | null },
  token: string,
  fetchImpl?: FetchLike,
): Promise<ProposalRevisionDto> {
  return write<{ ok: true; value: RawProposalRevision; diff: ProposalDiffDto }>('/api/control/proposals/import', input, token, fetchImpl)
    .then((body) => normalizedRevision(body.value, body.diff));
}

export function createProposalRevision(
  proposalRef: string,
  input: { expectedPreviousHash: string; proposal: PlanProposalDto },
  token: string,
  fetchImpl?: FetchLike,
): Promise<ProposalRevisionDto> {
  return write<{ ok: true; value: RawProposalRevision; diff: ProposalDiffDto }>(
    `/api/control/proposals/${segment(proposalRef)}/revisions`, input, token, fetchImpl,
  ).then((body) => normalizedRevision(body.value, body.diff));
}

export function decideProposalRevision(
  proposalRef: string,
  revision: number,
  input: {
    expectedHash: string;
    expectedApprovalRevision: 0;
    decision: ProposalDecision;
    idempotencyKey: string;
    note?: string | null;
  },
  token: string,
  fetchImpl?: FetchLike,
): Promise<ProposalRevisionDto> {
  return write<{ ok: true; value: RawProposalRevision }>(
    `/api/control/proposals/${segment(proposalRef)}/revisions/${revision}/decision`, input, token, fetchImpl,
  ).then((body) => normalizedRevision(body.value));
}

export function launchProposalRevision(
  proposalRef: string,
  revision: number,
  input: {
    expectedHash: string;
    idempotencyKey: string;
    predecessorRunRef?: string;
    expectedPredecessorVersion?: number;
  },
  token: string,
  fetchImpl?: FetchLike,
): Promise<LaunchProposalResultDto> {
  return write(`/api/control/proposals/${segment(proposalRef)}/revisions/${revision}/launch`, input, token, fetchImpl);
}

export function acceptsHumanRequest(request: HumanRequestDto): boolean {
  if (request.state !== 'resolved' || !request.response || request.kind === 'governance-refusal') return false;
  if (request.kind === 'approval' || request.kind === 'review') {
    return request.response.decision === 'approved';
  }
  return request.response.decision === 'approved' || request.response.decision === 'responded';
}

export type ActivatableRun = Pick<RunDto, 'runRef' | 'version' | 'managerGeneration' | 'proposalHash'>;

/** Strictly resume one existing published run. This path cannot launch proposals or create successors. */
export function activateRun(
  run: ActivatableRun,
  token: string,
  fetchImpl?: FetchLike,
): Promise<{ ok: true; value: RunDto; replayed?: boolean; starting?: boolean }> {
  return write(`/api/control/runs/${segment(run.runRef)}/activate`, {
    expectedRunVersion: run.version,
    expectedManagerGeneration: run.managerGeneration,
    idempotencyKey: `activate:${run.runRef}:${run.version}:${run.proposalHash}:${run.managerGeneration}`,
  }, token, fetchImpl);
}

/**
 * Re-enter the exact PRE-PUBLICATION launch operation after accepted Human Requests have committed.
 *
 * A run that is already published no longer resumes from here. The server does it: answering the last
 * open boundary is the operator's go, and `POST /human-requests/:ref/respond` (and the completion-gate
 * route) kick the same activation the manual Resume button uses — see `server/control/routes.ts`
 * `resumeRunAfterBoundaryAccepted`. This client used to fire its OWN `activate` with a different
 * idempotency key, which after the server-side resume landed would have meant two activations of one
 * run from two sides, deduped by nothing. One mechanism, server-side; the Resume button stays as the
 * operator's manual fallback when the daemon is locked.
 */
export async function resumeRunAfterHumanResponse(
  runRef: string,
  token: string,
  fetchImpl?: FetchLike,
): Promise<void> {
  const detail = await getRun(runRef, token, fetchImpl);
  const accepted = detail.humanRequests.length > 0 && detail.humanRequests.every(acceptsHumanRequest);
  if (!accepted) return;
  if (detail.run.publicationState === 'waiting-human') {
    await launchProposalRevision(detail.run.proposalRef, detail.run.proposalRevision, {
      expectedHash: detail.run.proposalHash,
      idempotencyKey: `launch:${detail.run.proposalHash}`,
    }, token, fetchImpl);
  }
}

export async function listRuns(token: string, fetchImpl?: FetchLike): Promise<RunMetadataDto[]> {
  const body = await read<{ runs: RunMetadataDto[] }>('/api/control/runs', token, fetchImpl);
  return body.runs;
}

type WireValidator = (value: unknown) => boolean;

const wireString: WireValidator = (value) => typeof value === 'string';
const wireNumber: WireValidator = (value) => typeof value === 'number' && Number.isFinite(value);
const wireBoolean: WireValidator = (value) => typeof value === 'boolean';
const nullable = (validator: WireValidator): WireValidator => (value) => value === null || validator(value);
const arrayOf = (validator: WireValidator): WireValidator =>
  (value) => Array.isArray(value) && value.every(validator);
const stringRecord: WireValidator = (value) => {
  const record = wireRecord(value);
  return record !== null && Object.values(record).every(wireString);
};

function exactDto(
  value: unknown,
  required: Record<string, WireValidator>,
  optional: Record<string, WireValidator> = {},
): boolean {
  const record = wireRecord(value);
  if (!record) return false;
  const keys = Object.keys(record);
  if (!Object.keys(required).every((key) => Object.hasOwn(record, key))
    || !keys.every((key) => Object.hasOwn(required, key) || Object.hasOwn(optional, key))) return false;
  return Object.entries(required).every(([key, validator]) => validator(record[key]))
    && Object.entries(optional).every(([key, validator]) => !Object.hasOwn(record, key) || validator(record[key]));
}

const assignmentDto: WireValidator = (value) => exactDto(value, {
  agentId: wireString, declarationPath: wireString, declarationHash: wireString,
  profileId: wireString, runtime: wireString, model: wireString,
});
const ownerDto: WireValidator = (value) => {
  const owner = wireRecord(value);
  if (!owner || owner.type === undefined) return false;
  return owner.type === 'agent'
    ? exactDto(owner, { type: wireString, id: wireString, sourcePath: wireString })
    : owner.type === 'workflow' && exactDto(owner, {
      type: wireString, id: wireString, project: wireString, sourcePath: wireString,
    });
};
const outputRefDto: WireValidator = (value) => {
  const output = wireRecord(value);
  if (!output) return false;
  if (output.kind === 'repository-file' || output.kind === 'artifact') {
    return exactDto(output, { kind: wireString, label: wireString, path: wireString });
  }
  return output.kind === 'external-pr' && exactDto(output, {
    kind: wireString, label: wireString, owner: wireString, repository: wireString, number: wireNumber,
  });
};
const runDto: WireValidator = (value) => exactDto(value, {
  runRef: wireString, predecessorRunRef: nullable(wireString), title: wireString, displayName: wireString,
  shortRef: wireNumber, workflowRef: nullable(wireString), proposalRef: wireString,
  proposalRevision: wireNumber, proposalHash: wireString, publicationState: wireString, state: wireString,
  version: wireNumber, managerSessionRef: wireString, managerGeneration: wireNumber,
  managerAssignment: nullable(assignmentDto), owner: ownerDto, executionHost: wireString,
  terminalOutcome: nullable(wireString), completedAt: nullable(wireString), archivedFrom: nullable(wireString),
  createdAt: wireString, updatedAt: wireString,
}, {
  agentWorkspaceLaunch: nullable((entry) => exactDto(entry, {
    composerRef: wireString, agentId: wireString, declarationPath: wireString, declarationHash: wireString,
  })),
});
const stageDto: WireValidator = (value) => exactDto(value, {
  stageRef: wireString, runRef: wireString, stageId: wireString, title: wireString,
  dependsOn: arrayOf(wireString), canonicalCardRef: nullable(wireString), state: wireString, version: wireNumber,
  currentAttemptRef: nullable(wireString), assignment: nullable(assignmentDto), createdAt: wireString, updatedAt: wireString,
});
const attemptDto: WireValidator = (value) => exactDto(value, {
  attemptRef: wireString, runRef: wireString, stageRef: wireString, generation: wireNumber,
  predecessorAttemptRef: nullable(wireString), runtime: wireString, model: wireString, state: wireString,
  version: wireNumber, managedSessionRef: nullable(wireString), createdAt: wireString, updatedAt: wireString,
});
const managedSessionDto: WireValidator = (value) => exactDto(value, {
  sessionRef: wireString, runRef: wireString, stageRef: nullable(wireString), attemptRef: nullable(wireString),
  role: wireString, generation: wireNumber, predecessorSessionRef: nullable(wireString), runtime: wireString,
  model: wireString, state: wireString, version: wireNumber, createdAt: wireString, updatedAt: wireString,
}, { attemptOperationKey: nullable(wireString) });
const humanResponseDto: WireValidator = (value) => exactDto(value, {
  requestRevision: wireNumber, decision: wireString, response: nullable(wireString), respondedAt: wireString,
});
const humanRequestDto: WireValidator = (value) => exactDto(value, {
  requestRef: wireString, runRef: wireString, displayName: wireString, shortRef: wireNumber,
  stageRef: nullable(wireString), kind: wireString, revision: wireNumber, state: wireString, title: wireString,
  prompt: wireString, ask: wireString, technicalDetail: nullable(wireString), response: nullable(humanResponseDto),
  createdAt: wireString, updatedAt: wireString,
}, { gateKind: wireString });
const participantDto: WireValidator = (value) => exactDto(value, {
  participantId: wireString, stageRef: wireString, role: wireString, perspective: wireString, mandate: wireString,
}, { goal: wireString });
const routeDto: WireValidator = (value) => exactDto(value, {
  routeId: wireString, senderParticipantId: wireString, recipientParticipantId: wireString,
  requestKinds: arrayOf(wireString), baseResolutionStageIds: arrayOf(wireString),
});
const scheduleStepDto: WireValidator = (value) => exactDto(value, {
  stepId: wireString, routeId: wireString, cycle: wireString,
}, { after: (entry) => exactDto(entry, { stepId: wireString, participantId: wireString, verdict: wireString }) });
const findingDto: WireValidator = (value) => exactDto(value, {
  findingId: wireString, criterionId: wireString, severity: wireString, summary: wireString,
  evidencePaths: arrayOf(wireString),
});
const positionDto: WireValidator = (value) => exactDto(value, {
  positionId: wireString, participantId: wireString, summary: wireString, generationRefs: arrayOf(wireString),
});
const dissentDto: WireValidator = (value) => exactDto(value, {
  dissentId: wireString, participantId: wireString, positionId: wireString, summary: wireString,
});
const criterionOutcomeDto: WireValidator = (value) => exactDto(value, {
  criterionId: wireString, verdict: wireString, findingIds: arrayOf(wireString),
});
const outcomeDto: WireValidator = (value) => exactDto(value, {
  schema: wireString, requestRef: wireString, iterationLoopRef: wireString, participantId: wireString,
  cycle: wireNumber, verdict: wireString, inputGenerationRefs: arrayOf(wireString),
  criteria: arrayOf(criterionOutcomeDto), findings: arrayOf(findingDto), positions: arrayOf(positionDto),
  recordedDissent: arrayOf(dissentDto), summary: wireString,
}, { resolvedFindingRefs: arrayOf(wireString) });
const artifactSnapshotDto: WireValidator = (value) => exactDto(value, {
  path: wireString, regularFile: wireBoolean, size: nullable(wireNumber), sha256: nullable(wireString),
  afterRegularFile: wireBoolean, afterSize: nullable(wireNumber), afterSha256: nullable(wireString),
  byteIdentical: wireBoolean,
});
const residueDto: WireValidator = (value) => exactDto(value, {
  unresolvedFindings: arrayOf(findingDto), positions: arrayOf(positionDto), recordedDissent: arrayOf(dissentDto),
  requestRefs: arrayOf(wireString), receiptRefs: arrayOf(wireString), activeGenerationRefs: arrayOf(wireString),
  acceptedGenerationRefs: arrayOf(wireString), nextRouteId: wireString, cycleUnit: wireString,
  cyclesUsed: wireNumber, maxCycles: wireNumber,
}, {
  attemptedRequestRef: wireString, attemptedRequestCycle: wireNumber, attemptedOutcome: outcomeDto,
  artifactSnapshots: arrayOf(artifactSnapshotDto), failureReason: wireString,
});
const iterationRequestDto: WireValidator = (value) => exactDto(value, {
  schema: wireString, requestRef: wireString, iterationLoopRef: wireString, routeId: wireString,
  senderParticipantId: wireString, recipientParticipantId: wireString, kind: wireString, cycle: wireNumber,
  inputGenerationRefs: arrayOf(wireString), baseCommit: wireString, artifactHashes: stringRecord,
  criteria: arrayOf((entry) => exactDto(entry, { id: wireString, description: wireString })),
  unresolvedFindingRefs: arrayOf(wireString), preservedInvariants: arrayOf(wireString),
  nextAcceptanceCheck: wireString, instructions: wireString,
}, { stepId: wireString });
const iterationReceiptDto: WireValidator = (value) => exactDto(value, {
  schema: wireString, receiptRef: wireString, requestRef: wireString, iterationLoopRef: wireString,
  participantId: wireString, cycle: wireNumber, verdict: wireString, inputGenerationRefs: arrayOf(wireString),
  criteria: arrayOf(criterionOutcomeDto), findings: arrayOf(findingDto), positions: arrayOf(positionDto),
  recordedDissent: arrayOf(dissentDto), summary: wireString, outcomeHash: wireString,
  outputGenerationRefs: arrayOf(wireString), baseCommit: wireString, canonicalCommit: wireString,
  createdAt: wireString, version: wireNumber,
}, { resolvedFindingRefs: arrayOf(wireString) });
const stageGenerationDto: WireValidator = (value) => exactDto(value, {
  generationRef: wireString, runRef: wireString, logicalStageRef: wireString, logicalStageId: wireString,
  generation: wireNumber, predecessorGenerationRef: nullable(wireString), attemptRef: wireString,
  canonicalResultOperationKey: nullable(wireString), resultHash: nullable(wireString),
  resultCardRef: nullable(wireString), baseCommit: nullable(wireString), canonicalCommit: nullable(wireString),
  state: wireString, createdAt: wireString, updatedAt: wireString,
});
const generationSupersessionDto: WireValidator = (value) => exactDto(value, {
  runRef: wireString, predecessorGenerationRef: wireString, successorGenerationRef: wireString,
  triggerReceiptRef: wireString, operationKey: wireString, createdAt: wireString,
});
const iterationLoopDto: WireValidator = (value) => exactDto(value, {
  iterationLoopRef: wireString, runRef: wireString, definitionHash: wireString, iterationGroupId: wireString,
  participants: arrayOf(participantDto), routes: arrayOf(routeDto), activation: (entry) => exactDto(entry, {
    seedParticipantId: wireString, seedArtifactIds: arrayOf(wireString),
  }), initialStepId: wireString, schedule: arrayOf(scheduleStepDto), artifacts: arrayOf(wireString),
  criteria: arrayOf((entry) => exactDto(entry, { id: wireString, description: wireString })),
  maxCycles: wireNumber, cycleUnit: wireString,
  terminalAuthorities: arrayOf((entry) => exactDto(entry, { participantId: wireString, verdict: wireString })),
  cyclesUsed: wireNumber, state: wireString, activeGenerationRefs: arrayOf(wireString), version: wireNumber,
  createdAt: wireString, updatedAt: wireString,
}, {
  goal: wireString,
  completionGate: (entry) => exactDto(entry, { id: wireString, kind: wireString, prompt: wireString, requiresReview: wireString }),
  turnOwnerParticipantId: wireString, currentStepId: wireString, acceptedGenerationRefs: arrayOf(wireString),
  lastReceiptRef: wireString, completionGateRef: wireString, interventionRef: wireString,
  parkReason: wireString, unresolvedResidue: residueDto,
});

const PTY_SESSION_STATES: readonly string[] = ['starting', 'live', 'closing', 'exited', 'abandoned'];
const EXIT_REASONS: readonly string[] = ['exited', 'closed', 'abandoned'];
const ptySessionState: WireValidator = (value) => typeof value === 'string' && PTY_SESSION_STATES.includes(value);
const publicExitDto: WireValidator = (value) => exactDto(value, {
  exitCode: nullable(wireNumber),
  reason: (reason) => typeof reason === 'string' && EXIT_REASONS.includes(reason),
  observedAt: wireString,
});
/** Closed [C-M4] decoder: strict keys, closed state/launcher enums, and the existing ref/time shapes. */
export const attemptSessionPublicRowDto: WireValidator = (value) => exactDto(value, {
  attemptRef: wireString, sessionId: wireString,
  launcher: (launcher) => launcher === 'claude' || launcher === 'codex',
  state: ptySessionState, startedAt: wireString, endedAt: nullable(wireString),
  exit: nullable(publicExitDto), controllerClaimed: wireBoolean, liveControl: wireBoolean,
});

/** Closed decoder for the complete Run-detail wire graph. */
export function decodeRunDetail(value: unknown): RunDetailDto | null {
  return exactDto(value, {
    run: runDto, ownerSubject: wireString, stages: arrayOf(stageDto), attempts: arrayOf(attemptDto),
    sessions: arrayOf(managedSessionDto), humanRequests: arrayOf(humanRequestDto),
    stageGenerations: arrayOf(stageGenerationDto), generationSupersessions: arrayOf(generationSupersessionDto),
    iterationLoops: arrayOf(iterationLoopDto), iterationRequests: arrayOf(iterationRequestDto),
    iterationReceipts: arrayOf(iterationReceiptDto),
    streamKind: (kind) => kind === 'pty' || kind === 'transcript',
    sessionId: nullable(wireString),
    attemptSessions: arrayOf(attemptSessionPublicRowDto),
  }, { outputs: arrayOf(outputRefDto) }) ? value as RunDetailDto : null;
}

/** One [C-R6] raw-replay frame. `sequence` is the BYTE OFFSET of the frame's first byte. */
export interface RunSessionReplayFrame {
  sequence: number;
  encoding: 'base64';
  data: string;
}

/** One [C-R6] raw-replay page, exactly as the scoped Run replay route returns it. */
export interface RunSessionReplayPage {
  sessionId: string;
  fromSequence: number;
  nextSequence: number;
  complete: boolean;
  frames: RunSessionReplayFrame[];
}

/**
 * Why the whole replay read has a CLOSED refusal union rather than a thrown message: the console has
 * exactly four honest reactions to a refused page, and each one is a different sentence to the
 * operator. `gap` means the retention window dropped the head the caller asked for — the transcript
 * resumes, but with a hole. `unreadable` means the transcript itself cannot be served. `not-found`
 * means this run has no such attempt session (a cross-Run probe gets this same answer). `invalid` is
 * this client asking wrongly. A string-matched error message would collapse the four.
 */
export type RunSessionReplayRefusal =
  | { kind: 'gap'; nextSequence: number | null; floorSequence: number | null }
  | { kind: 'unreadable' }
  | { kind: 'not-found' }
  | { kind: 'invalid' };

export type RunSessionReplayResult =
  | { ok: true; value: RunSessionReplayPage }
  | { ok: false; refusal: RunSessionReplayRefusal };

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const byteOffset = (value: unknown): boolean => Number.isSafeInteger(value) && (value as number) >= 0;
const replayFrameDto: WireValidator = (value) => exactDto(value, {
  sequence: byteOffset,
  encoding: (encoding) => encoding === 'base64',
  data: (data) => typeof data === 'string' && data.length % 4 === 0 && BASE64.test(data),
});

/** Closed decoder for one replay page: exact keys, byte-offset integers, base64 payloads only. */
export function decodeRunSessionReplayPage(value: unknown): RunSessionReplayPage | null {
  return exactDto(value, {
    sessionId: wireString,
    fromSequence: byteOffset,
    nextSequence: byteOffset,
    complete: wireBoolean,
    frames: arrayOf(replayFrameDto),
  }) ? value as RunSessionReplayPage : null;
}

function replayRefusal(cause: unknown): RunSessionReplayRefusal {
  if (!(cause instanceof ControlApiError)) return { kind: 'unreadable' };
  if (cause.status === 404) return { kind: 'not-found' };
  if (cause.status === 400) return { kind: 'invalid' };
  if (cause.code === 'replay-gap') {
    const hint = (key: string): number | null =>
      byteOffset(cause.body?.[key]) ? cause.body?.[key] as number : null;
    return { kind: 'gap', nextSequence: hint('nextSequence'), floorSequence: hint('floorSequence') };
  }
  return { kind: 'unreadable' };
}

/**
 * Read ONE attempt session's transcript, whole, through the scoped Run replay route.
 *
 * Paging is driven by the server's `nextSequence` and terminated by its `complete` flag — never by a
 * frame count or a page-size guess, because the route's bounds (64 KiB, 256 frames) belong to the
 * reader and may tighten without this client knowing. A page that does not advance the cursor and is
 * not complete would spin forever, so it is treated as `unreadable` rather than retried.
 */
export async function readRunSessionReplay(
  runRef: string,
  sessionId: string,
  fromSequence: number,
  token: string,
  fetchImpl?: FetchLike,
): Promise<RunSessionReplayResult> {
  if (!byteOffset(fromSequence)) return { ok: false, refusal: { kind: 'invalid' } };
  const frames: RunSessionReplayFrame[] = [];
  let cursor = fromSequence;
  let pages = 0;
  for (;;) {
    let body: unknown;
    try {
      body = await read<unknown>(
        `/api/control/runs/${segment(runRef)}/pty-sessions/${segment(sessionId)}/replay?fromSequence=${cursor}`,
        token,
        fetchImpl,
      );
    } catch (cause) {
      return { ok: false, refusal: replayRefusal(cause) };
    }
    const envelope = wireRecord(body);
    const page = envelope && exactWireKeys(envelope, ['ok', 'value']) && envelope.ok === true
      ? decodeRunSessionReplayPage(envelope.value) : null;
    if (page === null || page.sessionId !== sessionId || page.fromSequence !== cursor) {
      return { ok: false, refusal: { kind: 'unreadable' } };
    }
    frames.push(...page.frames);
    pages += 1;
    if (page.complete) {
      return { ok: true, value: { sessionId, fromSequence, nextSequence: page.nextSequence, complete: true, frames } };
    }
    // A page that neither completes nor advances is a server that cannot finish this transcript. The
    // 4,096-page ceiling is the same statement for a stream that advances one byte at a time.
    if (page.nextSequence <= cursor || pages >= 4096) return { ok: false, refusal: { kind: 'unreadable' } };
    cursor = page.nextSequence;
  }
}

/**
 * The run-detail envelope is `{ok, value}` PLUS two decorations the server has attached deliberately
 * since 2026-07-30 (`server/control/routes.ts` "the latch posture every execution-touching response
 * carries, so the UI never has to guess", now `server/services/runReadService.ts#getRunDetail`):
 * `replayed`, the idempotent-read flag, and `execution`, the execution-latch posture. Both are decoded
 * here rather than merely tolerated, so the envelope stays as strictly typed as the exact-keys check it
 * replaces: an unknown key, a non-boolean `replayed`, or a posture this client cannot parse all still
 * fail the whole read.
 */
function runDetailEnvelopeIsWellFormed(envelope: Record<string, unknown>): boolean {
  if (!wireKeysWithin(envelope, ['ok', 'value'], ['replayed', 'execution'])) return false;
  if ('replayed' in envelope && typeof envelope.replayed !== 'boolean') return false;
  if ('execution' in envelope && parseExecutionPosture(envelope.execution) === null) return false;
  return true;
}

export async function getRun(runRef: string, token: string, fetchImpl?: FetchLike): Promise<RunDetailDto> {
  const body = await read<unknown>(
    `/api/control/runs/${segment(runRef)}`, token, fetchImpl,
  );
  const envelope = wireRecord(body);
  const detail = envelope && runDetailEnvelopeIsWellFormed(envelope) && envelope.ok === true
    ? decodeRunDetail(envelope.value) : null;
  if (!detail) throw new Error('invalid run detail');
  return detail;
}

/**
 * Dismiss a dead run (spec §3b). Terminal, T3-audited server-side, and idempotent on the key built
 * here from the run's identity + version, so a double-click can never archive twice or diverge.
 *
 * `reason` is the operator's own words and is what makes a clean-up of several stale runs auditable
 * one run at a time — there is deliberately no bulk endpoint.
 */
export function archiveRun(
  run: Pick<RunDto, 'runRef' | 'version'>,
  reason: string | null,
  token: string,
  fetchImpl?: FetchLike,
): Promise<{ run: RunDto; resolvedRequests: HumanRequestDto[]; pinnedRequestRefs: string[] }> {
  return write<{ ok: true; value: { run: RunDto; resolvedRequests: HumanRequestDto[]; pinnedRequestRefs: string[] } }>(
    `/api/control/runs/${segment(run.runRef)}/archive`,
    { idempotencyKey: `archive:${run.runRef}:${run.version}`, reason },
    token,
    fetchImpl,
  ).then((body) => body.value);
}

export async function listRunEvents(
  runRef: string,
  after: number,
  limit: number,
  token: string,
  fetchImpl?: FetchLike,
): Promise<RunEventPage> {
  const body = await read<unknown>(
    `/api/control/runs/${segment(runRef)}/events?after=${after}&limit=${limit}`, token, fetchImpl,
  );
  const page = decodeRunEventPage(body);
  if (page === null) throw new Error('invalid run event page');
  return page;
}

const RUN_EVENT_KEYS = [
  'cursor', 'runRef', 'kind', 'source', 'stageRef', 'attemptRef', 'sessionRef', 'status', 'summary',
  'command', 'toolName', 'path', 'diff', 'checkpoint', 'createdAt',
] as const;

function wireRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function exactWireKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}

/**
 * Exact keys with a documented optional tail: every key present must be one this client knows, and
 * every required key must be there. This is the same wire discipline as `exactWireKeys` for envelopes
 * whose server deliberately attaches optional decorations.
 */
function wireKeysWithin(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return keys.every((key) => required.includes(key) || optional.includes(key))
    && required.every((key) => keys.includes(key));
}

function nullableString(value: unknown): boolean {
  return value === null || typeof value === 'string';
}

export function decodeOperationalEvent(value: unknown): OperationalEventDto | null {
  const event = wireRecord(value);
  if (!event || !exactWireKeys(event, RUN_EVENT_KEYS)
    || !Number.isSafeInteger(event.cursor) || (event.cursor as number) < 0
    || typeof event.runRef !== 'string' || event.runRef.length === 0
    || !['message', 'command', 'tool', 'file', 'diff', 'checkpoint', 'lifecycle', 'session-link', 'governance'].includes(String(event.kind))
    || !['system', 'manager', 'worker', 'human'].includes(String(event.source))
    || ![event.stageRef, event.attemptRef, event.sessionRef, event.summary, event.command, event.toolName,
      event.path, event.diff, event.checkpoint].every(nullableString)
    || !(event.status === null || ['pending', 'running', 'success', 'failure', 'stopped', 'interrupted', 'waiting'].includes(String(event.status)))
    || typeof event.createdAt !== 'string') return null;
  return event as unknown as OperationalEventDto;
}

function decodeRunEventPage(value: unknown): RunEventPage | null {
  const page = wireRecord(value);
  if (!page || !exactWireKeys(page, ['revision', 'items', 'nextCursor'])
    || typeof page.revision !== 'string' || !/^[a-f0-9]{64}$/.test(page.revision)
    || !Array.isArray(page.items)
    || !(page.nextCursor === null || (Number.isSafeInteger(page.nextCursor) && (page.nextCursor as number) >= 0))) return null;
  const items = page.items.map(decodeOperationalEvent);
  if (items.some((event) => event === null)) return null;
  return { revision: page.revision, items: items as OperationalEventDto[], nextCursor: page.nextCursor as number | null };
}

function decodeAttention(value: unknown): AttentionEnvelope | null {
  const envelope = wireRecord(value);
  if (!envelope || !exactWireKeys(envelope, ['revision', 'pairs', 'agents', 'workflows'])
    || typeof envelope.revision !== 'string' || !/^[a-f0-9]{64}$/.test(envelope.revision)
    || !Array.isArray(envelope.pairs)) return null;
  const agents = wireRecord(envelope.agents);
  const workflows = wireRecord(envelope.workflows);
  if (!agents || !workflows || ![...Object.values(agents), ...Object.values(workflows)]
    .every((count) => Number.isSafeInteger(count) && (count as number) >= 0)) return null;
  for (const valuePair of envelope.pairs) {
    const pair = wireRecord(valuePair);
    const owner = wireRecord(pair?.owner);
    if (!pair || !exactWireKeys(pair, ['runRef', 'owner']) || typeof pair.runRef !== 'string' || !owner) return null;
    if (owner.type === 'agent') {
      if (!exactWireKeys(owner, ['type', 'id', 'sourcePath']) || typeof owner.id !== 'string'
        || typeof owner.sourcePath !== 'string' || !owner.sourcePath.startsWith('agents/')) return null;
    } else if (owner.type === 'workflow') {
      if (!exactWireKeys(owner, ['type', 'id', 'project', 'sourcePath']) || typeof owner.id !== 'string'
        || typeof owner.project !== 'string' || typeof owner.sourcePath !== 'string'
        || !owner.sourcePath.startsWith('orgs/')) return null;
    } else return null;
  }
  return envelope as unknown as AttentionEnvelope;
}

export async function getAttention(token: string, fetchImpl?: FetchLike): Promise<AttentionEnvelope> {
  const body = await read<unknown>('/api/attention', token, fetchImpl);
  const attention = decodeAttention(body);
  if (attention === null) throw new Error('invalid attention envelope');
  return attention;
}

export interface ManagerCasInput {
  expectedRunVersion: number;
  expectedManagerGeneration: number;
  idempotencyKey: string;
}

export interface CancellationOutcomeDto {
  state: RunDto['state'];
  stoppedSessionRefs: string[];
  interruptedSessionRefs: string[];
  replayed: boolean;
}

export function sendManagerMessage(
  runRef: string,
  input: ManagerCasInput & { message: string },
  token: string,
  fetchImpl?: FetchLike,
): Promise<OperationalEventDto> {
  return write<{ ok: true; value: OperationalEventDto }>(
    `/api/control/runs/${segment(runRef)}/manager/messages`, input, token, fetchImpl,
  ).then((body) => body.value);
}

export function stopManager(
  runRef: string,
  input: ManagerCasInput,
  token: string,
  fetchImpl?: FetchLike,
): Promise<CancellationOutcomeDto> {
  return write<{ ok: true; value: CancellationOutcomeDto }>(
    `/api/control/runs/${segment(runRef)}/manager/stop`, input, token, fetchImpl,
  ).then((body) => body.value);
}

export function createManagerSuccessor(
  runRef: string,
  input: {
    expectedManagerGeneration: number;
    runtime: string;
    model: string;
    idempotencyKey: string;
  },
  token: string,
  fetchImpl?: FetchLike,
): Promise<ManagedSessionDto> {
  return write<{ ok: true; value: ManagedSessionDto }>(
    `/api/control/runs/${segment(runRef)}/manager/successor`, input, token, fetchImpl,
  ).then((body) => body.value);
}

export interface StageRerouteInput {
  expectedStageVersion: number;
  expectedAttemptRef: string;
  expectedAttemptVersion: number;
  runtime: string;
  model: string;
  idempotencyKey: string;
}

export function rerouteManagedStage(
  runRef: string,
  stageRef: string,
  input: StageRerouteInput,
  token: string,
  fetchImpl?: FetchLike,
): Promise<{ stage: StageDto; attempt: AttemptDto; session: ManagedSessionDto }> {
  return write<{ ok: true; value: { stage: StageDto; attempt: AttemptDto; session: ManagedSessionDto } }>(
    `/api/control/runs/${segment(runRef)}/stages/${segment(stageRef)}/reroute`, input, token, fetchImpl,
  ).then((body) => body.value);
}

export function steerManagerAtCheckpoint(
  runRef: string,
  input: ManagerCasInput & { checkpoint: string; instruction: string },
  token: string,
  fetchImpl?: FetchLike,
): Promise<OperationalEventDto> {
  return write<{ ok: true; value: OperationalEventDto }>(
    `/api/control/runs/${segment(runRef)}/manager/steer`, input, token, fetchImpl,
  ).then((body) => body.value);
}

export function respondToHumanRequest(
  requestRef: string,
  input: {
    expectedRevision: number;
    decision: HumanRequestDecision;
    idempotencyKey: string;
    response?: string | null;
    ceremonyId?: string;
    assertion?: AuthenticationResponseJSON;
    challengeExpiresAt?: string;
  },
  token: string,
  fetchImpl?: FetchLike,
): Promise<HumanRequestDto> {
  return write<{ ok: true; value: HumanRequestDto }>(
    `/api/control/human-requests/${segment(requestRef)}/respond`, input, token, fetchImpl,
  ).then((body) => body.value);
}

export interface HumanResponseChallengeDto {
  ceremonyId: string;
  options: PublicKeyCredentialRequestOptionsJSON;
  challengeExpiresAt: string;
}

export function requestHumanResponseChallenge(
  requestRef: string,
  input: { expectedRevision: number; decision: HumanRequestDecision; response?: string | null },
  token: string,
  fetchImpl?: FetchLike,
): Promise<HumanResponseChallengeDto> {
  return write<HumanResponseChallengeDto>(
    `/api/control/human-requests/${segment(requestRef)}/respond/challenge`, input, token, fetchImpl,
  );
}

/** T3 responses are signed over the exact request revision, decision, response digest, origin, and expiry. */
export async function respondToHumanRequestWithCeremony(
  requestRef: string,
  input: {
    expectedRevision: number;
    decision: HumanRequestDecision;
    idempotencyKey: string;
    response?: string | null;
  },
  token: string,
  fetchImpl?: FetchLike,
  perform: (options: PublicKeyCredentialRequestOptionsJSON) => Promise<AuthenticationResponseJSON> = performAssertion,
): Promise<HumanRequestDto> {
  const challenge = await requestHumanResponseChallenge(requestRef, input, token, fetchImpl);
  const assertion = await perform(challenge.options);
  return respondToHumanRequest(requestRef, {
    ...input,
    ceremonyId: challenge.ceremonyId,
    assertion,
    challengeExpiresAt: challenge.challengeExpiresAt,
  }, token, fetchImpl);
}

/** One-off, server-constrained repair for the authorized 2026-07-31 execution-lock boundary. */
export function recoverAuthorized20260731ExecutionLock(
  input: {
    expectedRunVersion: number;
    expectedManagerGeneration: number;
    expectedRequestRevision: number;
    idempotencyKey: string;
  },
  token: string,
  fetchImpl?: FetchLike,
): Promise<HumanRequestDto> {
  return write<{ ok: true; value: { request: HumanRequestDto } }>(
    '/api/control/recovery/2026-07-31/execution-lock', input, token, fetchImpl,
  ).then((body) => body.value.request);
}

/**
 * The one fixed-CAS historical settlement. It uses the ordinary bearer/session boundary (including
 * its 401 invalidation behavior), while the server independently requires a current passkey unlock.
 * It has no run argument and cannot launch, activate, or Retry anything.
 */
export function reconcileAuthorizedFailedRun(
  token: string,
  fetchImpl?: FetchLike,
): Promise<{ run: RunDto; replayed?: boolean }> {
  return write<{ ok: true; value: { run: RunDto }; replayed?: boolean }>(
    '/api/control/recovery/2026-08-01/failed-run-reconciliation',
    {
      expectedRunVersion: 7,
      expectedManagerGeneration: 1,
      expectedRequestRevision: 2,
      expectedNextEventCursor: 6,
      expectedProposalHash: AUTHORIZED_FAILED_RUN_RECONCILIATION.proposalHash,
      idempotencyKey: AUTHORIZED_FAILED_RUN_RECONCILIATION.idempotencyKey,
    },
    token,
    fetchImpl,
  ).then((body) => ({ run: body.value.run, replayed: body.replayed }));
}

interface ResolveIterationGateCasDto {
  expectedGateRef: string;
  expectedRequestRevision: number;
  expectedLoopVersion: number;
  expectedGenerationRefs: string[];
  idempotencyKey: string;
  response?: string | null;
}

export type ResolveIterationGateDto = ResolveIterationGateCasDto & (
  | {
    expectedGateKind: null;
    expectedParkReason: null;
    decision: Extract<HumanRequestDecision, 'approved' | 'rejected' | 'changes-requested'>;
  }
  | {
    expectedGateKind: 'iteration-park';
    expectedParkReason: IterationParkReasonDto;
    decision: 'approved' | 'declined';
  }
);

export interface IterationGateResultDto {
  loop: IterationLoopDto;
  receipt: IterationReceiptDto | null;
  receiptVersion: number | null;
  gate: HumanRequestDto;
  interventionRequest: HumanRequestDto | null;
  run?: RunDto;
}

/** Resolve a server-bound iteration gate with the exact displayed gate and generation-set CAS. */
export function resolveIterationGate(
  requestRef: string,
  input: ResolveIterationGateDto,
  token: string,
  fetchImpl?: FetchLike,
): Promise<IterationGateResultDto> {
  return write<{ ok: true; value: IterationGateResultDto }>(
    `/api/control/iteration-gates/${segment(requestRef)}/resolve`, input, token, fetchImpl,
  ).then((body) => body.value);
}

export async function getRetentionInventory(token: string, fetchImpl?: FetchLike): Promise<StorageInventoryDto> {
  const body = await read<{ inventory: StorageInventoryDto }>('/api/control/retention/inventory', token, fetchImpl);
  return body.inventory;
}

export function dryRunQuarantine(runRefs: string[], token: string, fetchImpl?: FetchLike): Promise<QuarantinePlanDto> {
  return write<{ ok: true; value: QuarantinePlanDto }>('/api/control/retention/dry-run', { runRefs }, token, fetchImpl)
    .then((body) => body.value);
}

export function quarantineRuns(
  runRefs: string[],
  expectedPlanHash: string,
  token: string,
  fetchImpl?: FetchLike,
): Promise<StorageInventoryItemDto[]> {
  return write<{ ok: true; value: StorageInventoryItemDto[] }>(
    '/api/control/retention/quarantine', { runRefs, expectedPlanHash }, token, fetchImpl,
  ).then((body) => body.value);
}

export function restoreRun(runRef: string, token: string, fetchImpl?: FetchLike): Promise<RunMetadataDto> {
  return write<{ ok: true; value: RunMetadataDto }>('/api/control/retention/restore', { runRef }, token, fetchImpl)
    .then((body) => body.value);
}
