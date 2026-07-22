import type {
  ProposalCompletionGate,
  ProposalReview,
  ResolvedAgentAssignment,
} from './proposal.ts';
import type { ReviewOutcome } from './reviewOutcome.ts';

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
  | 'interrupted';
export type StageState = 'blocked' | 'ready' | 'running' | 'waiting-human' | 'succeeded' | 'failed' | 'stopped' | 'interrupted';
export type AttemptState = 'queued' | 'starting' | 'running' | 'waiting-human' | 'succeeded' | 'failed' | 'stopped' | 'interrupted';
export type ManagedSessionState = 'pending' | 'starting' | 'running' | 'waiting' | 'completed' | 'failed' | 'stopped' | 'interrupted';

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
  createdAt: string;
  updatedAt: string;
}

export interface RunMetadata extends Run {
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
  canonicalResultOperationKey: string;
  resultHash: string;
  canonicalCommit: string;
  state: 'committed';
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
  state: 'awaiting-subject' | 'checking' | 'failed' | 'parked' | 'awaiting-gate' | 'passed';
  activeGenerationRef: string | null;
  acceptedGenerationRef: string | null;
  activeReceiptRef: string | null;
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
export type HumanRequestDecision = 'responded' | 'approved' | 'rejected' | 'changes-requested';

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
  stages: Stage[];
  attempts: Attempt[];
  sessions: ManagedSession[];
  humanRequests: HumanRequest[];
  stageGenerations: StageGeneration[];
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
