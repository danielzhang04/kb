import type {
  ProposalCompletionGate,
  ProposalIterationGroup,
  ProposalIterationParticipant,
  ProposalIterationRequestKind,
  ProposalIterationRole,
  ProposalIterationRoute,
  ProposalIterationScheduleStep,
  ProposalIterationTerminalAuthority,
  ProposalIterationVerdict,
  ProposalReview,
  ProposalReviewCriterion,
  ResolvedAgentAssignment,
} from './proposal.ts';
import type { IterationOutcome } from './iterationOutcome.ts';
import type { DeploymentState } from './deploymentState.ts';
import type { RunLifecycleKind } from './runLifecycle.ts';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type ProposalDecision = 'approved' | 'rejected' | 'changes-requested';

export interface ProposalApproval {
  revision: 1;
  decision: ProposalDecision;
  decidedBy: string;
  idempotencyKey: string;
  decidedAt: string;
  note: string | null;
}

export interface ProposalRevision {
  proposalRef: string;
  sourceComposerRef: string;
  sourceTurnId: string;
  revision: number;
  hash: string;
  previousHash: string | null;
  title: string;
  createdAt: string;
  snapshot: JsonObject;
  approval: ProposalApproval | null;
  /**
   * The subject that OWNS this revision — `operator` for one authored in the Composer, `dashboard-engine`
   * for one the queue bridge imported from a card. Same rule and same immutability as
   * {@link RunMetadata.ownerSubject}: a cross-subject launch executes AS this subject, so the launch
   * route has to be able to name it.
   */
  ownerSubject: string;
}

export interface ProposalRevisionMetadata {
  proposalRef: string;
  sourceComposerRef: string;
  sourceTurnId: string;
  revision: number;
  hash: string;
  previousHash: string | null;
  title: string;
  createdAt: string;
  approval: Omit<ProposalApproval, 'idempotencyKey' | 'note'> | null;
}

export interface DeployPause {
  deploymentRef: string;
  pausedAt: string;
  priorKind: Exclude<RunLifecycleKind, 'paused-for-deploy'>;
  resumeStreak: number;
  lastResumeAttemptCursor: number | null;
  resumeClaim: {
    deploymentRef: string;
    bootId: string;
    claimantRef: string;
  } | null;
}

export type RunLifecycle =
  | {
      kind: Exclude<RunLifecycleKind, 'paused-for-deploy'>;
      deployPause: null;
    }
  | {
      kind: 'paused-for-deploy';
      deployPause: DeployPause;
    };

export interface DeploymentProgress {
  kind: 'idle' | 'waiting-attempt' | 'parked' | 'swapping' | 'rehydrating';
  attemptRef: string | null;
  since: string | null;
  detail: string | null;
}

export interface DeploymentTerminalOutcome {
  kind: 'succeeded' | 'aborted' | 'failed';
  at: string;
  by: string;
}

export interface DeploymentAcknowledgement {
  subject: string;
  at: string;
}

export interface Deployment {
  deploymentRef: string;
  revision: number;
  targetCommit: string;
  previousCommit: string;
  state: DeploymentState;
  requestedAt: string;
  parkWarnAt: string;
  swapDeadlineAt: string | null;
  fenceRevision: number;
  drainAcks: Record<string, { fenceRevision: number; acknowledgedAt: string }>;
  blockers: string[];
  progress: DeploymentProgress;
  abortRequestedAt: string | null;
  error: string | null;
  terminalOutcome: DeploymentTerminalOutcome | null;
  acknowledgedBy: DeploymentAcknowledgement | null;
}

export interface DeploymentTransitionPatch {
  swapDeadlineAt?: string | null;
  blockers?: string[];
  progress?: DeploymentProgress;
  abortRequestedAt?: string | null;
  error?: string | null;
  terminalOutcome?: DeploymentTerminalOutcome | null;
  acknowledgedBy?: DeploymentAcknowledgement | null;
}

export interface CreateDeploymentInput {
  deploymentRef: string;
  initialState: 'waiting-confirmation' | 'requested';
  targetCommit: string;
  previousCommit: string;
  requestedAt: string;
  parkWarnAt: string;
  idempotencyKey: string;
}

export interface TransitionDeploymentInput {
  expectedRevision: number;
  expectedState: DeploymentState;
  nextState: DeploymentState;
  idempotencyKey: string;
  patch: DeploymentTransitionPatch;
}

export type StageState = 'blocked' | 'ready' | 'running' | 'waiting-human' | 'succeeded' | 'failed' | 'stopped' | 'interrupted';
export type AttemptState = 'queued' | 'starting' | 'running' | 'waiting-human' | 'succeeded' | 'failed' | 'stopped' | 'interrupted';
export const TERMINAL_ATTEMPT = new Set<AttemptState>(['succeeded', 'failed', 'stopped']);
export type ManagedSessionState = 'pending' | 'starting' | 'running' | 'waiting' | 'completed' | 'failed' | 'stopped' | 'interrupted';

/** Immutable server-derived origin for a workflow launched from an agent Composer workspace. */
export interface AgentWorkspaceLaunchProvenance {
  composerRef: string;
  agentId: string;
  declarationPath: string;
  declarationHash: string;
}

export interface Run {
  runRef: string;
  predecessorRunRef: string | null;
  title: string;
  proposalRef: string;
  proposalRevision: number;
  proposalHash: string;
  publicationState: 'pending' | 'waiting-human' | 'publishing' | 'published' | 'reconcile-required';
  lifecycle: RunLifecycle;
  version: number;
  managerSessionRef: string;
  managerGeneration: number;
  /** Compiler-resolved declaration/profile provenance; never an executor identity. */
  managerAssignment: ResolvedAgentAssignment | null;
  /** Null for ordinary launches; never contains a provider session id. */
  agentWorkspaceLaunch: AgentWorkspaceLaunchProvenance | null;
  createdAt: string;
  updatedAt: string;
}

export interface RunDto extends Omit<Run, 'lifecycle'> {
  state: RunLifecycleKind;
}

export interface RunMetadata extends Run {
  /**
   * The subject that OWNS this run — `operator` for a run launched by hand from the SPA,
   * `dashboard-engine` for one the queue bridge or the executor launched headlessly.
   *
   * A verified operator session reads (and now mutates) across every subject, so one list mixes both;
   * without this the rows are indistinguishable. Display/attribution provenance only: nothing
   * authorizes off it, and ownership never changes, not even when the operator acts on a foreign run.
   */
  ownerSubject: string;
  stageCount: number;
  attemptCount: number;
  sessionCount: number;
  openHumanRequestCount: number;
  eventCount: number;
}

export interface Stage {
  stageRef: string;
  runRef: string;
  stageId: string;
  title: string;
  dependsOn: string[];
  canonicalCardRef: string | null;
  state: StageState;
  version: number;
  currentAttemptRef: string | null;
  /** Compiler-resolved declaration/profile provenance; never an executor identity. */
  assignment: ResolvedAgentAssignment | null;
  /** Compiler-owned checker contract; immutable after launch. */
  workflowProfile: string | null;
  /** Compiler-owned checker review contract; immutable after launch. */
  review: ProposalReview | null;
  /** Compiler-owned completion gate; immutable after launch. */
  completionGate: ProposalCompletionGate | null;
  /** Current logical creator projection; immutable history lives in StageGeneration. */
  currentGeneration: number;
  currentGenerationRef: string | null;
  acceptedGenerationRef: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StageGeneration {
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

export interface GenerationSupersession {
  runRef: string;
  predecessorGenerationRef: string;
  successorGenerationRef: string;
  triggerReceiptRef: string;
  operationKey: string;
  createdAt: string;
}

export type IterationRole = ProposalIterationRole;
export type IterationRequestKind = ProposalIterationRequestKind;
export type IterationVerdict = ProposalIterationVerdict;
export type IterationParkReason = 'exhausted' | 'no-progress' | 'parked';
export interface IterationParticipant extends ProposalIterationParticipant {}
export interface IterationRoute extends ProposalIterationRoute {}
export interface IterationScheduleStep extends ProposalIterationScheduleStep {}
export interface IterationTerminalAuthority extends ProposalIterationTerminalAuthority {}

export interface IterationFinding {
  findingId: string;
  criterionId: string;
  severity: 'blocking' | 'advisory';
  summary: string;
  evidencePaths: string[];
}

export interface IterationPosition {
  positionId: string;
  participantId: string;
  summary: string;
  generationRefs: string[];
}

export interface IterationDissent {
  dissentId: string;
  participantId: string;
  positionId: string;
  summary: string;
}

export interface IterationArtifactSnapshot {
  path: string;
  /** Pre-launch lstat/hash evidence. Null size/hash means the path was absent or irregular. */
  regularFile: boolean;
  size: number | null;
  sha256: string | null;
  /** Pre-integration lstat/hash evidence for the worker result. */
  afterRegularFile: boolean;
  afterSize: number | null;
  afterSha256: string | null;
  byteIdentical: boolean;
}

export interface IterationResidue {
  unresolvedFindings: IterationFinding[];
  positions: IterationPosition[];
  recordedDissent: IterationDissent[];
  requestRefs: string[];
  receiptRefs: string[];
  activeGenerationRefs: string[];
  acceptedGenerationRefs: string[];
  nextRouteId: string;
  cycleUnit: string;
  cyclesUsed: number;
  maxCycles: number;
  /** Present only when an artifact-producing turn parks before canonical integration. */
  attemptedRequestRef?: string;
  /** The parser-bounded worker outcome retained without minting a receipt. */
  attemptedOutcome?: IterationOutcome;
  artifactSnapshots?: IterationArtifactSnapshot[];
  failureReason?: string;
}

export interface IterationRequest {
  schema: 'kb.iteration-request/v1';
  requestRef: string;
  iterationLoopRef: string;
  /** Server-owned schedule identity bound into the canonical request fingerprint. */
  stepId?: string;
  routeId: string;
  senderParticipantId: string;
  recipientParticipantId: string;
  kind: IterationRequestKind;
  cycle: number;
  inputGenerationRefs: string[];
  baseCommit: string;
  artifactHashes: Record<string, string>;
  criteria: ProposalReviewCriterion[];
  unresolvedFindingRefs: string[];
  preservedInvariants: string[];
  nextAcceptanceCheck: string;
  instructions: string;
}

export interface IterationReceipt extends Omit<IterationOutcome, 'schema'> {
  schema: 'kb.iteration-receipt/v1';
  receiptRef: string;
  outcomeHash: string;
  outputGenerationRefs: string[];
  baseCommit: string;
  canonicalCommit: string;
  /** Exact participant attempt that produced this outcome. */
  participantAttemptRef: string;
  createdAt: string;
  /** Public compare-and-swap version for the iteration gate route. */
  version: number;
}

export interface IterationLoop extends ProposalIterationGroup {
  iterationLoopRef: string;
  runRef: string;
  definitionHash: string;
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
  /** Distinct post-semantic-acceptance approval gate. */
  completionGateRef?: string;
  /** Iteration park or rejected-completion intervention. */
  interventionRef?: string;
  parkReason?: IterationParkReason;
  unresolvedResidue?: IterationResidue;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ActivateIterationLoopInput {
  expectedLoopVersion: number;
  seedGenerationRefs: string[];
  artifactGenerationRefs: Record<string, string>;
  operationKey: string;
  /** Server-selected routing used only when the initial schedule step is artifact-producing. */
  successorRuntime?: string;
  successorModel?: string;
}

export interface RecordIterationRequestInput {
  expectedLoopVersion: number;
  routeId: string;
  kind: IterationRequestKind;
  inputGenerationRefs: string[];
  baseCommit: string;
  artifactHashes: Record<string, string>;
  unresolvedFindingRefs: string[];
  preservedInvariants: string[];
  nextAcceptanceCheck: string;
  instructions: string;
  operationKey: string;
}

export interface RecordIterationReceiptInput {
  expectedLoopVersion: number;
  requestRef: string;
  outcome: IterationOutcome;
  outputGenerationRefs: string[];
  baseCommit: string;
  canonicalCommit: string;
  participantAttemptRef: string;
  operationKey: string;
}

export interface AdvanceIterationTurnInput {
  expectedLoopVersion: number;
  expectedReceiptRef: string;
  expectedActiveGenerationRefs: string[];
  nextStepId: string;
  operationKey: string;
  /** Server-selected routing used only when the generic transition must mint a producer successor. */
  successorRuntime?: string;
  successorModel?: string;
}

export interface ParkIterationLoopInput {
  expectedLoopVersion: number;
  /** Required for receipt-driven exhausted/explicit parks; absent for a pre-integration no-progress park. */
  expectedReceiptRef?: string;
  expectedActiveGenerationRefs: string[];
  reason: IterationParkReason;
  nextRouteId: string;
  attemptedRequestRef?: string;
  attemptedOutcome?: IterationOutcome;
  artifactSnapshots?: IterationArtifactSnapshot[];
  failureReason?: string;
  operationKey: string;
}

export interface IterationParkResult {
  loop: IterationLoop;
  receipt: IterationReceipt | null;
  receiptVersion: number | null;
  gate: HumanRequest;
}

export interface ResolveIterationGateInput {
  expectedRequestRevision: number;
  expectedLoopVersion: number;
  expectedReceiptVersion: number | null;
  decision: 'approved' | 'declined' | 'rejected' | 'changes-requested';
  operationKey: string;
  response?: string | null;
}

export interface IterationGateResult extends IterationParkResult {
  interventionRequest: HumanRequest | null;
}

export interface Attempt {
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
  /** Logical creator-generation lineage; null for ordinary/legacy attempts. */
  logicalGeneration: number | null;
  baseGenerationRef: string | null;
  baseCommit: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ManagedSession {
  sessionRef: string;
  runRef: string;
  stageRef: string | null;
  attemptRef: string | null;
  role: 'manager' | 'worker';
  generation: number;
  predecessorSessionRef: string | null;
  runtime: string;
  model: string;
  state: ManagedSessionState;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type HumanRequestKind = 'input' | 'approval' | 'review' | 'intervention' | 'governance-refusal';
/**
 * `'auto-closed'` is written ONLY by the engine (`transitionRun` on a terminal state, or the orphan
 * sweep in `closeOrphanedHumanRequests` — see store.ts), never accepted from an operator's own decision
 * (the public `respondHumanRequest` route validates against `HUMAN_DECISIONS`, which omits it). Keeping
 * it a distinct value — rather than reusing `'responded'` — means a closed record never claims a human
 * answered when nobody did.
 */
export type HumanRequestDecision = 'responded' | 'approved' | 'rejected' | 'changes-requested' | 'auto-closed';

export interface HumanResponse {
  requestRevision: number;
  decision: HumanRequestDecision;
  respondedBy: string;
  idempotencyKey: string;
  response: string | null;
  respondedAt: string;
}

export interface HumanRequest {
  requestRef: string;
  runRef: string;
  stageRef: string | null;
  kind: HumanRequestKind;
  /** Generic iteration-gate discriminator; completion approvals leave this absent. */
  gateKind?: 'iteration-park';
  revision: number;
  state: 'open' | 'resolved';
  title: string;
  prompt: string;
  response: HumanResponse | null;
  createdAt: string;
  updatedAt: string;
}

export type OperationalEventKind =
  | 'message'
  | 'command'
  | 'tool'
  | 'file'
  | 'diff'
  | 'checkpoint'
  | 'lifecycle'
  | 'session-link'
  | 'governance';
export type OperationalEventStatus = 'pending' | 'running' | 'success' | 'failure' | 'stopped' | 'interrupted' | 'waiting' | null;

/**
 * Closed public event shape. Provider payloads, tool inputs/results, environment, credentials,
 * and hidden reasoning have no representable field at this persistence boundary.
 */
export interface OperationalEventInput {
  kind: OperationalEventKind;
  source: 'system' | 'manager' | 'worker' | 'human';
  stageRef?: string | null;
  attemptRef?: string | null;
  sessionRef?: string | null;
  status?: OperationalEventStatus;
  summary?: string | null;
  command?: string | null;
  toolName?: string | null;
  path?: string | null;
  diff?: string | null;
  checkpoint?: string | null;
}

export interface OperationalEvent {
  cursor: number;
  runRef: string;
  kind: OperationalEventKind;
  source: 'system' | 'manager' | 'worker' | 'human';
  stageRef: string | null;
  attemptRef: string | null;
  sessionRef: string | null;
  status: OperationalEventStatus;
  summary: string | null;
  command: string | null;
  toolName: string | null;
  path: string | null;
  diff: string | null;
  checkpoint: string | null;
  createdAt: string;
}

export interface RunDetail {
  run: Run;
  /** The subject that owns this run. See {@link RunMetadata.ownerSubject}. */
  ownerSubject: string;
  stages: Stage[];
  attempts: Attempt[];
  sessions: ManagedSession[];
  humanRequests: HumanRequest[];
  stageGenerations: StageGeneration[];
  generationSupersessions: GenerationSupersession[];
  iterationLoops: IterationLoop[];
  iterationRequests: IterationRequest[];
  iterationReceipts: IterationReceipt[];
}

/** HTTP-only residue fields derived from the authoritative request collection. */
export interface IterationResidueDto extends IterationResidue {
  /** May exceed cyclesUsed because a no-progress attempt rolls cycle accounting back before parking. */
  attemptedRequestCycle?: number;
}

/** HTTP representation of an iteration loop; persisted loop state remains unchanged. */
export interface IterationLoopDto extends Omit<IterationLoop, 'unresolvedResidue'> {
  unresolvedResidue?: IterationResidueDto;
}

/** Authoritative run-detail response shape exposed by the control API. */
export interface RunDetailDto extends Omit<RunDetail, 'run' | 'iterationLoops'> {
  run: RunDto;
  iterationLoops: IterationLoopDto[];
}

export interface StorageInventoryItem {
  runRef: string;
  title: string;
  state: RunLifecycleKind;
  updatedAt: string;
  eventCount: number;
  estimatedBytes: number;
  quarantinedAt: string | null;
  /** The subject that owns the bundle — see {@link RunMetadata.ownerSubject}. Quarantine never moves it. */
  ownerSubject: string;
}

export interface StorageInventory {
  activeRuns: StorageInventoryItem[];
  quarantinedRuns: StorageInventoryItem[];
  proposalRevisionCount: number;
  nextEventCursor: number;
  estimatedBytes: number;
}

export interface QuarantinePlanItem extends StorageInventoryItem {
  eligible: boolean;
}

export interface QuarantinePlan {
  planHash: string;
  createdAt: string;
  items: QuarantinePlanItem[];
  estimatedBytes: number;
}

export type ControlResult<T> =
  | { ok: true; value: T; replayed?: boolean }
  | {
      ok: false;
      reason: 'not-found' | 'conflict' | 'invalid' | 'not-approved' | 'limit' | 'ineligible' | 'idempotency-conflict';
      detail: string;
    };
