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
import type { ReviewOutcome, ReviewOutcomeCriterion } from './reviewOutcome.ts';

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

export type RunState =
  | 'planned'
  | 'recovering'
  | 'running'
  | 'waiting-human'
  | 'stopping'
  | 'succeeded'
  | 'failed'
  | 'stopped'
  | 'interrupted'
  /**
   * Operator-dismissed. A terminal, absorbing state reachable only from a settled or parked run
   * (`archiveRun`): the run keeps every record it had, stops appearing in default list projections,
   * and its answerable open requests are resolved in the same commit. Nothing transitions out of it.
   */
  | 'archived';
export type StageState = 'blocked' | 'ready' | 'running' | 'waiting-human' | 'succeeded' | 'failed' | 'stopped' | 'interrupted';
export type AttemptState = 'queued' | 'starting' | 'running' | 'waiting-human' | 'succeeded' | 'failed' | 'stopped' | 'interrupted';
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
  state: RunState;
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
  failedReviewReceiptRef: string;
  operationKey: string;
  createdAt: string;
}

export type IterationRole = ProposalIterationRole;
export type IterationRequestKind = ProposalIterationRequestKind;
export type IterationVerdict = ProposalIterationVerdict;
export type IterationParkReason = 'exhausted' | 'no-progress';
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
}

export interface IterationRequest {
  schema: 'kb.iteration-request/v1';
  requestRef: string;
  iterationLoopRef: string;
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

export interface IterationReceipt {
  schema: 'kb.iteration-receipt/v1';
  receiptRef: string;
  requestRef: string;
  iterationLoopRef: string;
  participantId: string;
  cycle: number;
  verdict: IterationVerdict;
  inputGenerationRefs: string[];
  criteria: ReviewOutcomeCriterion[];
  findings: IterationFinding[];
  positions: IterationPosition[];
  recordedDissent: IterationDissent[];
  summary: string;
  outcomeHash: string;
  outputGenerationRefs: string[];
  baseCommit: string;
  canonicalCommit: string;
  createdAt: string;
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
  gateRef?: string;
  parkReason?: IterationParkReason;
  unresolvedResidue?: IterationResidue;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewLoop {
  reviewLoopRef: string;
  runRef: string;
  reviewStageRef: string;
  subjectStageRef: string;
  maxCreatorReworks: number;
  reviewDefinitionHash: string;
  reworksUsed: number;
  state: 'awaiting-subject' | 'checking' | 'rework-queued' | 'failed' | 'parked' | 'awaiting-gate' | 'passed';
  activeGenerationRef: string | null;
  acceptedGenerationRef: string | null;
  activeReceiptRef: string | null;
  interventionRequestRef: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewReceipt {
  reviewReceiptRef: string;
  runRef: string;
  reviewStageRef: string;
  subjectStageRef: string;
  subjectGenerationRef: string;
  subjectResultHash: string;
  checkerAttemptRef: string;
  outcome: ReviewOutcome;
  outcomeHash: string;
  operationKey: string;
  state: 'passed' | 'awaiting-completion-gate' | 'failed' | 'parked';
  completionRequestRef: string | null;
  interventionRequestRef: string | null;
  version: number;
  createdAt: string;
  finalizedAt: string | null;
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
  /** Immutable checker base; null for ordinary and legacy attempts. */
  reviewSubjectGenerationRef: string | null;
  reviewSubjectResultHash: string | null;
  reviewSubjectCanonicalCommit: string | null;
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
  reviewLoops: ReviewLoop[];
  reviewReceipts: ReviewReceipt[];
}

export interface StorageInventoryItem {
  runRef: string;
  title: string;
  state: RunState;
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
