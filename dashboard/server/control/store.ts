import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { redactSensitiveText } from '../composer/publicTimeline.ts';
import { MAX_REVIEW_OUTCOME_CHARS, parseReviewOutcome } from './reviewOutcome.ts';
import type {
  ProposalCompletionGate,
  ProposalReview,
  ResolvedAgentAssignment,
} from './proposal.ts';
import type {
  BrokerConsumption,
  BrokerMutation,
  ManagedStartSpec,
} from './broker.ts';
import type { PublicOperationalEvent } from './publicEvents.ts';
import type {
  Attempt,
  AttemptState,
  AgentWorkspaceLaunchProvenance,
  ControlResult,
  GenerationSupersession,
  HumanRequest,
  HumanRequestDecision,
  HumanRequestKind,
  JsonObject,
  JsonValue,
  ManagedSession,
  ManagedSessionState,
  OperationalEvent,
  OperationalEventInput,
  ProposalDecision,
  ProposalRevision,
  ProposalRevisionMetadata,
  QuarantinePlan,
  Run,
  RunDetail,
  RunMetadata,
  RunState,
  ReviewLoop,
  ReviewReceipt,
  Stage,
  StageGeneration,
  StageState,
  StorageInventory,
  StorageInventoryItem,
} from './types.ts';

export const MAX_CONTROL_DOCUMENT_BYTES = 128 * 1024 * 1024;
export const MAX_PROPOSAL_SNAPSHOT_BYTES = 512 * 1024;
export const MAX_EVENTS_PER_RUN = 100_000;
export const MAX_EVENT_PAGE = 1_000;
export const MAX_STAGES_PER_RUN = 128;
export const MAX_HUMAN_REQUESTS_PER_RUN = 1_024;
export const MAX_BROKER_RECEIPTS_PER_SESSION = 4_096;
export const MAX_STEERING_INSTRUCTIONS_PER_SESSION = 256;

const MAX_TITLE = 240;
const MAX_SHORT_TEXT = 512;
const MAX_LONG_TEXT = 64 * 1024;
const MAX_REVIEW_CRITERIA = 16;
const MAX_REVIEW_REWORKS = 2;
const MAX_REVIEW_CRITERION_DESCRIPTION = 200;
const MAX_COMPLETION_GATE_PROMPT = 2_000;
const MAX_ACTIVATION_RECEIPTS_PER_RUN = 64;
const HASH_RE = /^[a-f0-9]{64}$/;
const CANONICAL_COMMIT_RE = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const SAFE_REF_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_STAGE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const AGENT_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PROFILE_ID_RE = /^[a-z0-9][a-z0-9:._-]{0,127}$/;
const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const PROPOSAL_DECISIONS = new Set<ProposalDecision>(['approved', 'rejected', 'changes-requested']);
const HUMAN_REQUEST_KINDS = new Set<HumanRequestKind>(['input', 'approval', 'review', 'intervention', 'governance-refusal']);
const HUMAN_DECISIONS = new Set<HumanRequestDecision>(['responded', 'approved', 'rejected', 'changes-requested']);
const EVENT_KINDS = new Set(['message', 'command', 'tool', 'file', 'diff', 'checkpoint', 'lifecycle', 'session-link', 'governance']);
const EVENT_SOURCES = new Set(['system', 'manager', 'worker', 'human']);
const EVENT_STATUSES = new Set(['pending', 'running', 'success', 'failure', 'stopped', 'interrupted', 'waiting']);
const EVENT_FIELDS = new Set([
  'kind', 'source', 'stageRef', 'attemptRef', 'sessionRef', 'status', 'summary', 'command', 'toolName', 'path', 'diff', 'checkpoint',
]);
const RUN_STATES = new Set<RunState>(['planned', 'recovering', 'running', 'waiting-human', 'stopping', 'succeeded', 'failed', 'stopped', 'interrupted', 'archived']);
const STAGE_STATES = new Set<StageState>(['blocked', 'ready', 'running', 'waiting-human', 'succeeded', 'failed', 'stopped', 'interrupted']);
const ATTEMPT_STATES = new Set<AttemptState>(['queued', 'starting', 'running', 'waiting-human', 'succeeded', 'failed', 'stopped', 'interrupted']);
const SESSION_STATES = new Set<ManagedSessionState>(['pending', 'starting', 'running', 'waiting', 'completed', 'failed', 'stopped', 'interrupted']);
const TERMINAL_RUN = new Set<RunState>(['succeeded', 'failed', 'stopped', 'archived']);

/** The single human identity the daemon mints WebAuthn sessions for (`server/auth/routes.ts` OPERATOR.id).
 *  Every other subject in this document is a machine: the dashboard engine, an executor, a test fixture. */
export const OPERATOR_SUBJECT = 'operator';

/**
 * How far a READ reaches across subjects.
 *
 * Every record here is stamped with the subject that created it, and every WRITE is — and stays —
 * scoped to exactly one subject. That is the ownership boundary and nothing below widens it. But the
 * daemon's runs are not all created by the same subject: the SPA session is `operator` while the queue
 * bridge and the executor own their runs under `dashboard-engine`, so an own-subject-only read showed
 * the one human on this machine only the half of the plane they happened to launch by hand.
 *
 * `'all-subjects'` is what a verified operator session resolves to (`routes.ts#readScope`). It changes
 * WHICH records a read may return, never who may mutate them: no write path takes this type at all.
 */
export type ReadScope = 'own-subject' | 'all-subjects';

const TERMINAL_STAGE = new Set<StageState>(['succeeded', 'failed', 'stopped']);
const TERMINAL_ATTEMPT = new Set<AttemptState>(['succeeded', 'failed', 'stopped']);
const TERMINAL_SESSION = new Set<ManagedSessionState>(['completed', 'failed', 'stopped']);
const RETRY_SETTLED_STAGE = new Set<StageState>([...TERMINAL_STAGE, 'interrupted']);
const RETRY_SETTLED_ATTEMPT = new Set<AttemptState>([...TERMINAL_ATTEMPT, 'interrupted']);
const RETRY_SETTLED_SESSION = new Set<ManagedSessionState>([...TERMINAL_SESSION, 'interrupted']);
const QUARANTINE_ELIGIBLE = new Set<RunState>(['succeeded', 'failed', 'stopped', 'interrupted', 'archived']);
const QUARANTINE_SETTLED_STAGE = new Set<StageState>([...TERMINAL_STAGE, 'interrupted']);
const QUARANTINE_SETTLED_ATTEMPT = new Set<AttemptState>([...TERMINAL_ATTEMPT, 'interrupted']);
const QUARANTINE_SETTLED_SESSION = new Set<ManagedSessionState>([...TERMINAL_SESSION, 'interrupted']);
const PUBLICATION_STATES = new Set<Run['publicationState']>(['pending', 'waiting-human', 'publishing', 'published', 'reconcile-required']);
const ACTIVATION_PHASES = new Set<RunActivationPhase>(['claimed', 'roots-activated', 'dispatched', 'failed']);

/**
 * `archived` is an absorbing state with NO outgoing edge, and is reachable only from a run that is
 * already settled or parked — never from `planned`/`recovering`/`running`/`stopping`. Live work must be
 * stopped on its own governed path first; dismissing a run must never be a way to abandon a running
 * Manager. `transitionRun` refuses it outright (see below): archiving also has to resolve the run's open
 * requests atomically, so `archiveRun` is the ONLY writer of this edge.
 */
const RUN_EDGES: Readonly<Record<RunState, ReadonlySet<RunState>>> = {
  planned: new Set(['recovering', 'running', 'waiting-human', 'stopping', 'failed', 'stopped', 'interrupted']),
  recovering: new Set(['running', 'waiting-human', 'stopping', 'failed', 'stopped', 'interrupted']),
  running: new Set(['waiting-human', 'stopping', 'succeeded', 'failed', 'stopped', 'interrupted']),
  'waiting-human': new Set(['planned', 'recovering', 'running', 'stopping', 'failed', 'stopped', 'interrupted', 'archived']),
  stopping: new Set(['stopped', 'failed', 'interrupted']),
  succeeded: new Set(['archived']),
  failed: new Set(['archived']),
  stopped: new Set(['archived']),
  interrupted: new Set(['recovering', 'running', 'waiting-human', 'stopping', 'failed', 'stopped', 'archived']),
  archived: new Set(),
};
const PUBLICATION_EDGES: Readonly<Record<Run['publicationState'], ReadonlySet<Run['publicationState']>>> = {
  pending: new Set(['waiting-human', 'publishing', 'reconcile-required']),
  'waiting-human': new Set(['pending', 'reconcile-required']),
  publishing: new Set(['published', 'reconcile-required']),
  published: new Set(),
  'reconcile-required': new Set(['publishing']),
};
const STAGE_EDGES: Readonly<Record<StageState, ReadonlySet<StageState>>> = {
  blocked: new Set(['ready', 'waiting-human', 'stopped', 'interrupted']),
  ready: new Set(['running', 'waiting-human', 'failed', 'stopped', 'interrupted']),
  running: new Set(['waiting-human', 'succeeded', 'failed', 'stopped', 'interrupted']),
  'waiting-human': new Set(['ready', 'failed', 'stopped', 'interrupted']),
  succeeded: new Set(),
  failed: new Set(),
  stopped: new Set(),
  interrupted: new Set(['ready', 'waiting-human', 'failed', 'stopped']),
};
const ATTEMPT_EDGES: Readonly<Record<AttemptState, ReadonlySet<AttemptState>>> = {
  queued: new Set(['starting', 'waiting-human', 'failed', 'stopped', 'interrupted']),
  starting: new Set(['running', 'waiting-human', 'failed', 'stopped', 'interrupted']),
  running: new Set(['waiting-human', 'succeeded', 'failed', 'stopped', 'interrupted']),
  'waiting-human': new Set(['failed', 'stopped', 'interrupted']),
  succeeded: new Set(),
  failed: new Set(),
  stopped: new Set(),
  interrupted: new Set(['stopped']),
};
const SESSION_EDGES: Readonly<Record<ManagedSessionState, ReadonlySet<ManagedSessionState>>> = {
  pending: new Set(['starting', 'failed', 'stopped', 'interrupted']),
  starting: new Set(['running', 'failed', 'stopped', 'interrupted']),
  running: new Set(['waiting', 'completed', 'failed', 'stopped', 'interrupted']),
  waiting: new Set(['running', 'completed', 'failed', 'stopped', 'interrupted']),
  completed: new Set(),
  failed: new Set(),
  stopped: new Set(),
  interrupted: new Set(['stopped']),
};

interface StoredProposal extends ProposalRevision {
  subject: string;
}

interface StoredRun extends Run {
  subject: string;
  launchOperationKey?: string | null;
  launchOperationFingerprint?: string | null;
  archiveOperationKey?: string | null;
  archiveOperationFingerprint?: string | null;
  activationReceipts?: StoredRunActivationReceipt[];
  authorizedFailedRunReconciliation?: StoredAuthorizedFailedRunReconciliation | null;
}

export type RunActivationPhase = 'claimed' | 'roots-activated' | 'dispatched' | 'failed';

interface StoredRunActivationReceipt {
  idempotencyKey: string;
  fingerprint: string;
  phase: RunActivationPhase;
  claimedAt: string;
  updatedAt: string;
}

interface StoredStage extends Stage {
  subject: string;
}

interface StoredStageGeneration extends StageGeneration {
  subject: string;
  operationFingerprint: string;
}

interface StoredReviewLoop extends ReviewLoop {
  subject: string;
}

interface StoredReviewReceipt extends ReviewReceipt {
  subject: string;
  operationFingerprint: string;
}

interface StoredGenerationSupersession extends GenerationSupersession {
  subject: string;
  operationFingerprint: string;
}

interface StoredAttempt extends Attempt {
  subject: string;
  rerouteOperationKey?: string | null;
  rerouteOperationFingerprint?: string | null;
}

interface StoredSession extends ManagedSession {
  subject: string;
  operationKey: string | null;
  operationFingerprint: string | null;
  brokerProfileId?: string | null;
  brokerApprovedPromptHash?: string | null;
  brokerStopRequested?: boolean;
  brokerSteering?: StoredSteeringInstruction[];
  brokerReceipts?: StoredBrokerReceipt[];
}

interface StoredSteeringInstruction {
  instructionRef: string;
  instruction: string;
  checkpoint: string | null;
  enqueuedAt: string;
}

type StoredBrokerReceiptKind = 'start' | 'event' | 'complete' | 'stop' | 'enqueue' | 'consume' | 'interrupt';

interface StoredBrokerReceipt {
  kind: StoredBrokerReceiptKind;
  idempotencyKey: string;
  fingerprint: string;
  revision: number;
  status: 'reserved' | 'already-active' | 'applied' | 'inactive' | 'conflict';
  instructions: string[];
  createdAt: string;
}

interface StoredHumanRequest extends HumanRequest {
  subject: string;
  operationKey?: string | null;
  operationFingerprint?: string | null;
  resolutionOperationFingerprint?: string | null;
  /** Private, one-off repair idempotency. Deliberately separate from the request's creation key. */
  legacyRecoveryOperationKey?: string | null;
  legacyRecoveryOperationFingerprint?: string | null;
  legacyRecoveryEventCursor?: number | null;
}

export type AuthorizedFailedRunReconciliationPhase = 'claimed' | 'committed';

export interface AuthorizedFailedRunReconciliationReceipt {
  idempotencyKey: string;
  fingerprint: string;
  phase: AuthorizedFailedRunReconciliationPhase;
  claimedAt: string;
  updatedAt: string;
  canonicalCommit: string | null;
  eventCursor: number | null;
}

interface StoredAuthorizedFailedRunReconciliation extends AuthorizedFailedRunReconciliationReceipt {}

interface StoredEvent extends OperationalEvent {
  subject: string;
  operationKey?: string | null;
  operationFingerprint?: string | null;
}

interface QuarantinedRunBundle {
  subject: string;
  quarantinedAt: string;
  run: StoredRun;
  stages: StoredStage[];
  attempts: StoredAttempt[];
  sessions: StoredSession[];
  humanRequests: StoredHumanRequest[];
  events: StoredEvent[];
  stageGenerations: StoredStageGeneration[];
  reviewLoops: StoredReviewLoop[];
  reviewReceipts: StoredReviewReceipt[];
  generationSupersessions: StoredGenerationSupersession[];
}

interface StoreDocument {
  version: 1;
  nextEventCursor: number;
  proposals: StoredProposal[];
  runs: StoredRun[];
  stages: StoredStage[];
  attempts: StoredAttempt[];
  sessions: StoredSession[];
  humanRequests: StoredHumanRequest[];
  events: StoredEvent[];
  stageGenerations: StoredStageGeneration[];
  reviewLoops: StoredReviewLoop[];
  reviewReceipts: StoredReviewReceipt[];
  generationSupersessions: StoredGenerationSupersession[];
  quarantine: QuarantinedRunBundle[];
}

function retryPredecessorRefusal(document: StoreDocument, predecessor: StoredRun): string | null {
  // The one Daniel-authorized settlement is a CLOSED record: it stopped every stage, attempt, and
  // session precisely so nothing could run again, which would otherwise make it look like the most
  // eligible Retry predecessor in the store. Its receipt — carried by the run itself, so it survives
  // quarantine and restore — is the refusal key.
  if (predecessor.authorizedFailedRunReconciliation != null) {
    return 'Retry predecessor is the authorized 2026-08-01 settled failed run, whose settlement is final and can never have a successor';
  }
  if (predecessor.publicationState !== 'published') {
    return 'Retry predecessor canonical publication is not reconciled and published';
  }
  const stages = document.stages.filter((item) => item.subject === predecessor.subject && item.runRef === predecessor.runRef);
  if (stages.some((stage) => stage.canonicalCardRef === null)) {
    return 'Retry predecessor has an unresolved canonical card link';
  }
  if (stages.some((stage) => !RETRY_SETTLED_STAGE.has(stage.state))) {
    return 'Retry predecessor still has active or unresolved canonical stage work';
  }
  if (document.attempts.some((attempt) =>
    attempt.subject === predecessor.subject && attempt.runRef === predecessor.runRef && !RETRY_SETTLED_ATTEMPT.has(attempt.state))) {
    return 'Retry predecessor still has an active or unresolved attempt';
  }
  if (document.sessions.some((session) =>
    session.subject === predecessor.subject && session.runRef === predecessor.runRef && !RETRY_SETTLED_SESSION.has(session.state))) {
    return 'Retry predecessor still has an active or unresolved managed session';
  }
  if (document.humanRequests.some((request) =>
    request.subject === predecessor.subject && request.runRef === predecessor.runRef && request.state === 'open')) {
    return 'Retry predecessor still has an unresolved Human Request';
  }
  return null;
}

export interface ControlStoreOptions {
  now?: () => Date;
  newId?: () => string;
  maxDocumentBytes?: number;
  maxEventsPerRun?: number;
}

export interface CreateProposalRevisionInput {
  proposalRef?: string;
  expectedPreviousHash?: string | null;
  sourceComposerRef: string;
  sourceTurnId: string;
  title: string;
  snapshot: JsonObject;
}

export interface ApproveProposalInput {
  expectedHash: string;
  expectedApprovalRevision: 0;
  decision: ProposalDecision;
  idempotencyKey: string;
  note?: string | null;
}

export interface CreateRunStageInput {
  stageId: string;
  title: string;
  dependsOn: string[];
  canonicalCardRef?: string | null;
  /** Must exactly match the approved compiler snapshot for this stage. */
  assignment?: ResolvedAgentAssignment | null;
  /** Must exactly match the approved compiler snapshot for this stage. */
  workflowProfile?: string | null;
  /** Must exactly match the approved compiler snapshot for this stage. */
  review?: ProposalReview | null;
  /** Must exactly match the approved compiler snapshot for this stage. */
  completionGate?: ProposalCompletionGate | null;
}

export interface CreateRunInput {
  title: string;
  proposalRef: string;
  proposalRevision: number;
  expectedProposalHash: string;
  managerRuntime: string;
  managerModel: string;
  /** Must exactly match the approved compiler snapshot for the Manager. */
  managerAssignment?: ResolvedAgentAssignment | null;
  idempotencyKey: string;
  predecessorRunRef?: string | null;
  expectedPredecessorVersion?: number;
  /** Internal, server-derived Composer origin; HTTP clients never choose declaration identity. */
  agentWorkspaceLaunch?: AgentWorkspaceLaunchProvenance | null;
  stages: CreateRunStageInput[];
}

export interface RunActivationInput {
  expectedRunVersion: number;
  expectedManagerGeneration: number;
  idempotencyKey: string;
}

export interface RunActivationReceipt {
  run: Run;
  phase: RunActivationPhase;
}

export interface CreateAttemptInput {
  expectedStageVersion: number;
  runtime: string;
  model: string;
  /** Required only for checker attempts and bound to the active subject generation. */
  reviewSubjectGenerationRef?: string | null;
  reviewSubjectResultHash?: string | null;
  reviewSubjectCanonicalCommit?: string | null;
}

export interface RecordStageGenerationInput {
  expectedStageVersion: number;
  expectedAttemptVersion: number;
  expectedGeneration: number;
  operationKey: string;
  resultHash: string;
  resultCardRef: string | null;
  baseCommit: string;
  canonicalCommit: string;
}

export interface RecordReviewReceiptInput {
  expectedReviewStageVersion: number;
  expectedCheckerAttemptVersion: number;
  expectedLoopVersion: number;
  subjectGenerationRef: string;
  subjectResultHash: string;
  checkerAttemptRef: string;
  outcome: string;
  operationKey: string;
}

export interface AdvanceReviewGenerationInput {
  expectedSubjectStageVersion: number;
  expectedReviewStageVersion: number;
  expectedLoopVersion: number;
  expectedSubjectAttemptRef: string;
  expectedSubjectAttemptVersion: number;
  expectedCheckerAttemptRef: string;
  expectedCheckerAttemptVersion: number;
  expectedFailedReceiptRef: string;
  expectedGenerationRef: string;
  idempotencyKey: string;
}

export interface ParkExhaustedReviewInput {
  expectedSubjectStageVersion: number;
  expectedReviewStageVersion: number;
  expectedLoopVersion: number;
  expectedReceiptVersion: number;
  expectedSubjectAttemptRef: string;
  expectedSubjectAttemptVersion: number;
  expectedCheckerAttemptRef: string;
  expectedCheckerAttemptVersion: number;
  expectedGenerationRef: string;
  expectedFailedReceiptRef: string;
  idempotencyKey: string;
}

export interface ParkExhaustedReviewResult {
  receipt: ReviewReceipt;
  loop: ReviewLoop;
  interventionRequest: HumanRequest;
  subjectStage: Stage;
  reviewStage: Stage;
}

export interface AttachReviewCompletionGateInput {
  expectedReceiptVersion: number;
  expectedLoopVersion: number;
  expectedReviewStageVersion: number;
  idempotencyKey: string;
}

export interface ResolveReviewCompletionGateInput {
  expectedRequestRevision: number;
  expectedReceiptVersion: number;
  expectedLoopVersion: number;
  expectedReviewStageVersion: number;
  expectedSubjectStageVersion: number;
  decision: 'approved' | 'rejected' | 'changes-requested';
  idempotencyKey: string;
  response?: string | null;
}

export interface ReviewCompletionGateResult {
  receipt: ReviewReceipt;
  loop: ReviewLoop;
  request: HumanRequest;
  subjectStage: Stage;
  reviewStage: Stage;
  interventionRequest: HumanRequest | null;
}

export interface CreateWorkerSessionInput {
  expectedAttemptVersion: number;
}

export interface RerouteStageInput {
  expectedStageVersion: number;
  expectedAttemptRef: string;
  expectedAttemptVersion: number;
  runtime: string;
  model: string;
  idempotencyKey: string;
}

export interface RerouteStageResult {
  stage: Stage;
  attempt: Attempt;
  session: ManagedSession;
}

export interface CreateHumanRequestInput {
  stageRef?: string | null;
  kind: HumanRequestKind;
  title: string;
  prompt: string;
}

export interface CreateHumanRequestBatchInput {
  idempotencyKey: string;
  requests: CreateHumanRequestInput[];
}

export interface RespondHumanRequestInput {
  expectedRevision: number;
  decision: HumanRequestDecision;
  idempotencyKey: string;
  response?: string | null;
}

export interface ArchiveRunInput {
  idempotencyKey: string;
  /** Why the operator dismissed this run. Recorded on the resolved requests and in the audit row. */
  reason?: string | null;
}

export interface ArchiveRunResult {
  run: Run;
  /** Requests this archive resolved, in the same commit that moved the run to `archived`. */
  resolvedRequests: HumanRequest[];
  /**
   * Open requests the archive could NOT resolve: a review completion gate / review intervention is
   * pinned open by the review lineage invariants (only the review gate resolver may move one), so they
   * are reported rather than silently corrupted. The archived run leaves every default projection, so
   * these stop reaching the operator either way.
   */
  pinnedRequestRefs: string[];
}

export interface CloseOrphanedHumanRequestsResult {
  /** Every request auto-closed this sweep, across every subject and run, in one commit. */
  closed: HumanRequest[];
}

export interface RecoverAuthorized20260731ExecutionLockInput {
  expectedRunVersion: number;
  expectedManagerGeneration: number;
  expectedRequestRevision: number;
  idempotencyKey: string;
}

export interface RecoverAuthorized20260731ExecutionLockResult {
  request: HumanRequest;
  event: OperationalEvent;
}

export type RecoverAuthorized20260731ExecutionLockPreflight =
  | { disposition: 'eligible'; result: null }
  | { disposition: 'replay'; result: RecoverAuthorized20260731ExecutionLockResult };

export interface ReconcileAuthorized20260801FailedRunInput {
  expectedRunVersion: number;
  expectedManagerGeneration: number;
  expectedRequestRevision: number;
  expectedNextEventCursor: number;
  expectedProposalHash: string;
  idempotencyKey: string;
}

export interface ReconcileAuthorized20260801FailedRunResult {
  run: Run;
  event: OperationalEvent;
  receipt: AuthorizedFailedRunReconciliationReceipt;
}

export type ReconcileAuthorized20260801FailedRunPreflight =
  | { disposition: 'eligible'; receipt: null; result: null }
  | { disposition: 'claimed'; receipt: AuthorizedFailedRunReconciliationReceipt; result: null }
  | { disposition: 'replay'; receipt: AuthorizedFailedRunReconciliationReceipt; result: ReconcileAuthorized20260801FailedRunResult };

export interface CreateManagerSuccessorInput {
  expectedManagerGeneration: number;
  runtime: string;
  model: string;
  idempotencyKey: string;
}

export interface ManagerCommandInput {
  expectedRunVersion: number;
  expectedManagerGeneration: number;
  idempotencyKey: string;
  kind: 'message' | 'steer' | 'stop';
  message?: string;
  checkpoint?: string;
}

export interface ManagerCommandResult {
  run: Run;
  event: OperationalEvent;
}

export interface RequestRunCancellationInput {
  expectedRunVersion: number;
  idempotencyKey: string;
  reason: string;
}

export interface CanonicalStageProjectionInput {
  stageRef: string;
  expectedStageVersion: number;
  canonicalCardRef: string;
  state: Exclude<StageState, 'interrupted'>;
  attemptRef: string;
  expectedAttemptVersion: number;
  attemptState: Exclude<AttemptState, 'interrupted'>;
  sessionRef: string;
  expectedSessionVersion: number;
  sessionState: Exclude<ManagedSessionState, 'interrupted'>;
}

export interface ReconcileCanonicalProjectionInput {
  expectedRunVersion: number;
  expectedProposalHash: string;
  stages: CanonicalStageProjectionInput[];
}

export interface BrokerSteeringInput {
  runRef: string;
  sessionRef: string;
  instructionRef: string;
  instruction: string;
  /** Null means deliver at the next safe checkpoint; otherwise deliver only at this checkpoint. */
  checkpoint: string | null;
  expectedRevision: number;
  idempotencyKey: string;
}

export interface BrokerStoreBackend {
  brokerReserveStart(subject: string, input: { spec: ManagedStartSpec; idempotencyKey: string }):
    { status: 'reserved'; revision: number } | { status: 'already-active'; revision: number };
  brokerAppendEvent(subject: string, input: {
    runRef: string;
    sessionRef: string;
    event: PublicOperationalEvent;
    idempotencyKey: string;
  }): void;
  brokerCompleteSession(subject: string, input: {
    runRef: string;
    sessionRef: string;
    state: 'completed' | 'failed' | 'stopped';
    detail: string | null;
    expectedRevision: number;
    idempotencyKey: string;
  }): BrokerMutation;
  brokerRequestStop(subject: string, input: {
    runRef: string;
    sessionRef: string;
    expectedRevision: number;
    idempotencyKey: string;
  }): BrokerMutation;
  brokerEnqueueSteering(subject: string, input: BrokerSteeringInput): BrokerMutation;
  brokerConsumeSteering(subject: string, input: {
    runRef: string;
    sessionRef: string;
    checkpoint: string;
    expectedRevision: number;
    idempotencyKey: string;
  }): BrokerConsumption;
  brokerInterruptResidue(subject: string, input: {
    runRef: string;
    sessionRef: string;
    idempotencyKey: string;
  }): BrokerMutation;
}

export interface ControlPlaneStore extends BrokerStoreBackend {
  listProposalRevisions(subject: string, proposalRef?: string): ProposalRevisionMetadata[];
  listProposalRevisionsForComposer(subject: string, sourceComposerRef: string, scope?: ReadScope): ProposalRevisionMetadata[];
  getProposalRevision(subject: string, proposalRef: string, revision: number): ControlResult<ProposalRevision>;
  createProposalRevision(subject: string, input: CreateProposalRevisionInput): ControlResult<ProposalRevision>;
  decideProposal(subject: string, proposalRef: string, revision: number, input: ApproveProposalInput): ControlResult<ProposalRevision>;

  /** Reads. `scope` defaults to `'own-subject'`; only a verified operator session widens it (see
   *  {@link ReadScope}). No mutation on this interface takes a scope. */
  listRuns(subject: string, scope?: ReadScope): RunMetadata[];
  getRun(subject: string, runRef: string, scope?: ReadScope): ControlResult<RunDetail>;
  createRun(subject: string, input: CreateRunInput): ControlResult<RunDetail>;
  /** Read an exact durable activation receipt without claiming a new activation. */
  getRunActivationReceipt(subject: string, runRef: string, input: RunActivationInput): ControlResult<RunActivationReceipt | null>;
  /** Internal lifecycle guard used to exclude competing Manager recovery while activation owns the run. */
  hasActiveRunActivation(subject: string, runRef: string): ControlResult<boolean>;
  /** Atomically bind one exact activation operation and move waiting-human -> recovering. */
  claimRunActivation(subject: string, runRef: string, input: RunActivationInput): ControlResult<RunActivationReceipt>;
  /** Advance the durable activation outbox without repeating an earlier phase. */
  advanceRunActivation(
    subject: string,
    runRef: string,
    input: RunActivationInput,
    phase: Extract<RunActivationPhase, 'roots-activated' | 'dispatched'>,
  ): ControlResult<RunActivationReceipt>;
  /** Fail a claimed activation and return an undispatched run to waiting-human. */
  failRunActivation(subject: string, runRef: string, input: RunActivationInput): ControlResult<RunActivationReceipt>;
  transitionRun(subject: string, runRef: string, expectedVersion: number, state: RunState): ControlResult<Run>;
  /** Terminal operator dismissal: `archived` run + its answerable open requests resolved, one commit. */
  archiveRun(subject: string, runRef: string, input: ArchiveRunInput): ControlResult<ArchiveRunResult>;
  transitionPublication(
    subject: string,
    runRef: string,
    expectedVersion: number,
    state: Run['publicationState'],
  ): ControlResult<Run>;
  /** Privileged all-or-nothing projection after canonical-card identity and audit were verified. */
  reconcileCanonicalProjection(
    subject: string,
    runRef: string,
    input: ReconcileCanonicalProjectionInput,
  ): ControlResult<RunDetail>;
  transitionStage(subject: string, stageRef: string, expectedVersion: number, state: StageState): ControlResult<Stage>;
  recordStageGeneration(subject: string, stageRef: string, input: RecordStageGenerationInput): ControlResult<StageGeneration>;
  recordReviewReceipt(subject: string, reviewStageRef: string, input: RecordReviewReceiptInput): ControlResult<ReviewReceipt>;
  attachReviewCompletionGate(subject: string, reviewReceiptRef: string, input: AttachReviewCompletionGateInput): ControlResult<ReviewCompletionGateResult>;
  resolveReviewCompletionGate(subject: string, requestRef: string, input: ResolveReviewCompletionGateInput): ControlResult<ReviewCompletionGateResult>;
  advanceReviewGeneration(subject: string, runRef: string, input: AdvanceReviewGenerationInput): ControlResult<StageGeneration>;
  parkExhaustedReview(subject: string, runRef: string, input: ParkExhaustedReviewInput): ControlResult<ParkExhaustedReviewResult>;
  linkStageCard(subject: string, stageRef: string, expectedVersion: number, canonicalCardRef: string): ControlResult<Stage>;
  createAttempt(subject: string, stageRef: string, input: CreateAttemptInput): ControlResult<Attempt>;
  /** Atomically supersedes one never-started queued attempt without rewriting its historical routing. */
  rerouteStage(subject: string, stageRef: string, input: RerouteStageInput): ControlResult<RerouteStageResult>;
  transitionAttempt(subject: string, attemptRef: string, expectedVersion: number, state: AttemptState): ControlResult<Attempt>;
  createWorkerSession(subject: string, attemptRef: string, input: CreateWorkerSessionInput): ControlResult<ManagedSession>;
  transitionSession(subject: string, sessionRef: string, expectedVersion: number, state: ManagedSessionState): ControlResult<ManagedSession>;
  createManagerSuccessor(subject: string, runRef: string, input: CreateManagerSuccessorInput): ControlResult<ManagedSession>;
  recordManagerCommand(subject: string, runRef: string, input: ManagerCommandInput): ControlResult<ManagerCommandResult>;
  /** Atomically persists run-wide cancellation intent before any adapter is signaled. */
  requestRunCancellation(subject: string, runRef: string, input: RequestRunCancellationInput): ControlResult<ManagerCommandResult>;

  getHumanRequest(subject: string, requestRef: string): ControlResult<HumanRequest>;
  createHumanRequest(subject: string, runRef: string, input: CreateHumanRequestInput): ControlResult<HumanRequest>;
  createHumanRequests(
    subject: string,
    runRef: string,
    input: CreateHumanRequestBatchInput,
  ): ControlResult<HumanRequest[]>;
  reviseHumanRequest(subject: string, requestRef: string, expectedRevision: number, title: string, prompt: string): ControlResult<HumanRequest>;
  respondHumanRequest(subject: string, requestRef: string, input: RespondHumanRequestInput): ControlResult<HumanRequest>;
  /**
   * Housekeeping sweep, not a governed HTTP write — no subject, no session, no idempotency key from a
   * caller. Auto-closes every OPEN, non-review-linked Human Request whose parent run has reached a
   * terminal state (mirrors `TERMINAL_RUN`), with an honest `'auto-closed'` response — it never claims
   * a human answered. `transitionRun` calls the same predicate inline (same commit as the transition);
   * this method additionally sweeps the WHOLE document, so it also catches a request whose run went
   * terminal before this shipped or by some path other than a transition. Called from the boot +
   * interval sweep wired in `humanRequestSweep.ts`. Idempotent: an already-resolved request is simply
   * skipped on the next sweep.
   *
   * TERMINAL STATE IS THE ONLY PREDICATE (ruling, 2026-08-11). An age-based predicate shipped here
   * first and was removed: closure is IRREVERSIBLE — nothing reopens a resolved request, both
   * `respondHumanRequest` and `reviseHumanRequest` conflict on one, and `stageBoundary` then refuses
   * the run forever — so an age heuristic could permanently wedge a run that is legitimately parked on
   * a human gate simply because the human took a week. A run that is genuinely dead reaches a terminal
   * state (or an operator archives it, which resolves its requests in the same commit); a run that has
   * not is still the operator's to answer.
   */
  closeOrphanedHumanRequests(nowMs: number): CloseOrphanedHumanRequestsResult;
  /** Daniel-authorized, exact-run repair for the 2026-07-31 execution-lock launch defect. */
  preflightAuthorized20260731ExecutionLock(
    subject: string,
    input: RecoverAuthorized20260731ExecutionLockInput,
  ): ControlResult<RecoverAuthorized20260731ExecutionLockPreflight>;
  recoverAuthorized20260731ExecutionLock(
    subject: string,
    input: RecoverAuthorized20260731ExecutionLockInput,
  ): ControlResult<RecoverAuthorized20260731ExecutionLockResult>;
  /** Daniel-authorized, exact-run settlement for the failed 2026-07-31 FYT thin-slice launch. */
  preflightAuthorized20260801FailedRunReconciliation(
    subject: string,
    input: ReconcileAuthorized20260801FailedRunInput,
  ): ControlResult<ReconcileAuthorized20260801FailedRunPreflight>;
  claimAuthorized20260801FailedRunReconciliation(
    subject: string,
    input: ReconcileAuthorized20260801FailedRunInput,
  ): ControlResult<AuthorizedFailedRunReconciliationReceipt>;
  commitAuthorized20260801FailedRunReconciliation(
    subject: string,
    input: ReconcileAuthorized20260801FailedRunInput,
    canonicalCommit: string,
  ): ControlResult<ReconcileAuthorized20260801FailedRunResult>;

  appendEvent(subject: string, runRef: string, input: OperationalEventInput): ControlResult<OperationalEvent>;
  listEvents(subject: string, runRef: string, afterCursor?: number, limit?: number, scope?: ReadScope): ControlResult<OperationalEvent[]>;

  inventory(subject: string): StorageInventory;
  dryRunQuarantine(subject: string, runRefs: string[]): ControlResult<QuarantinePlan>;
  quarantineRuns(subject: string, runRefs: string[], expectedPlanHash: string): ControlResult<StorageInventoryItem[]>;
  restoreRun(subject: string, runRef: string): ControlResult<RunMetadata>;
}

export class ControlStoreLimitError extends Error {}

function emptyDocument(): StoreDocument {
  return {
    version: 1,
    nextEventCursor: 1,
    proposals: [],
    runs: [],
    stages: [],
    attempts: [],
    sessions: [],
    humanRequests: [],
    events: [],
    stageGenerations: [],
    reviewLoops: [],
    reviewReceipts: [],
    generationSupersessions: [],
    quarantine: [],
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function ok<T>(value: T, replayed?: boolean): ControlResult<T> {
  return replayed ? { ok: true, value, replayed: true } : { ok: true, value };
}

function fail<T>(reason: Extract<ControlResult<T>, { ok: false }>['reason'], detail: string): ControlResult<T> {
  return { ok: false, reason, detail };
}

function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function proposalSnapshotHash(snapshot: JsonObject): string {
  return sha256(canonicalJson(snapshot));
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return Object.getPrototypeOf(value) === Object.prototype && Object.values(record).every(isJsonValue);
}

function containsRecognizedSecret(value: JsonValue): boolean {
  if (typeof value === 'string') return redactSensitiveText(value) !== value;
  if (Array.isArray(value)) return value.some(containsRecognizedSecret);
  if (value && typeof value === 'object') return Object.values(value).some(containsRecognizedSecret);
  return false;
}

function cleanText(value: string, max: number): string {
  return redactSensitiveText(value.replace(/\0/g, '')).slice(0, max);
}

function validNonEmpty(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max && !value.includes('\0');
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
}

/**
 * The proposal compiler owns this binding. The store repeats its closed-shape checks so a caller
 * cannot substitute a declaration/profile after approval but before durable run creation.
 */
function normalizeAssignment(value: unknown): ResolvedAgentAssignment | null | undefined {
  if (value === undefined || value === null) return null;
  if (!isPlainRecord(value)) return undefined;
  const keys = Object.keys(value).sort();
  const expectedKeys = ['agentId', 'declarationHash', 'declarationPath', 'model', 'profileId', 'runtime'];
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) return undefined;
  const { agentId, declarationPath, declarationHash, profileId, runtime, model } = value;
  if (typeof agentId !== 'string' || !AGENT_ID_RE.test(agentId)
    || typeof declarationPath !== 'string' || declarationPath !== `agents/${agentId}.md`
    || typeof declarationHash !== 'string' || !HASH_RE.test(declarationHash)
    || typeof profileId !== 'string' || !PROFILE_ID_RE.test(profileId)
    || (runtime !== 'claude' && runtime !== 'codex')
    || typeof model !== 'string' || !MODEL_ID_RE.test(model)) {
    return undefined;
  }
  return { agentId, declarationPath, declarationHash, profileId, runtime, model };
}

function sameAssignment(left: ResolvedAgentAssignment | null, right: ResolvedAgentAssignment | null): boolean {
  return left === right || (left !== null && right !== null
    && left.agentId === right.agentId
    && left.declarationPath === right.declarationPath
    && left.declarationHash === right.declarationHash
    && left.profileId === right.profileId
    && left.runtime === right.runtime
    && left.model === right.model);
}

function normalizeAgentWorkspaceLaunch(value: unknown): AgentWorkspaceLaunchProvenance | null | undefined {
  if (value === undefined || value === null) return null;
  if (!isPlainRecord(value)) return undefined;
  const keys = Object.keys(value).sort();
  const expected = ['agentId', 'composerRef', 'declarationHash', 'declarationPath'];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) return undefined;
  const { composerRef, agentId, declarationPath, declarationHash } = value;
  if (typeof composerRef !== 'string' || !SAFE_REF_RE.test(composerRef)
    || typeof agentId !== 'string' || !AGENT_ID_RE.test(agentId)
    || declarationPath !== `agents/${agentId}.md`
    || typeof declarationHash !== 'string' || !HASH_RE.test(declarationHash)) return undefined;
  return { composerRef, agentId, declarationPath, declarationHash };
}

interface CheckerContractProvenance {
  workflowProfile: string | null;
  review: ProposalReview | null;
  completionGate: ProposalCompletionGate | null;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return keys.length === sortedExpected.length && keys.every((key, index) => key === sortedExpected[index]);
}

function normalizeWorkflowProfile(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  return typeof value === 'string' && SAFE_STAGE_ID_RE.test(value) ? value : undefined;
}

function normalizeReview(value: unknown, dependsOn: readonly string[]): ProposalReview | null | undefined {
  if (value === undefined || value === null) return null;
  if (!isPlainRecord(value) || !hasExactKeys(value, ['subjectStageId', 'maxCreatorReworks', 'criteria'])) return undefined;
  const { subjectStageId, maxCreatorReworks, criteria } = value;
  if (typeof subjectStageId !== 'string' || !SAFE_STAGE_ID_RE.test(subjectStageId) || !dependsOn.includes(subjectStageId)
    || typeof maxCreatorReworks !== 'number' || !Number.isSafeInteger(maxCreatorReworks)
    || maxCreatorReworks < 0 || maxCreatorReworks > MAX_REVIEW_REWORKS
    || !Array.isArray(criteria) || criteria.length < 1 || criteria.length > MAX_REVIEW_CRITERIA) {
    return undefined;
  }
  const normalizedCriteria: ProposalReview['criteria'] = [];
  const ids = new Set<string>();
  for (const criterion of criteria) {
    if (!isPlainRecord(criterion) || !hasExactKeys(criterion, ['id', 'description'])
      || typeof criterion.id !== 'string' || !SAFE_STAGE_ID_RE.test(criterion.id)
      || !validNonEmpty(criterion.description, MAX_REVIEW_CRITERION_DESCRIPTION) || ids.has(criterion.id)) {
      return undefined;
    }
    ids.add(criterion.id);
    normalizedCriteria.push({ id: criterion.id, description: criterion.description });
  }
  return { subjectStageId, maxCreatorReworks, criteria: normalizedCriteria };
}

function normalizeCompletionGate(value: unknown): ProposalCompletionGate | null | undefined {
  if (value === undefined || value === null) return null;
  if (!isPlainRecord(value) || !hasExactKeys(value, ['id', 'kind', 'prompt', 'requiresReview'])) return undefined;
  if (typeof value.id !== 'string' || !SAFE_STAGE_ID_RE.test(value.id)
    || value.kind !== 'approval' || value.requiresReview !== 'pass'
    || !validNonEmpty(value.prompt, MAX_COMPLETION_GATE_PROMPT)) return undefined;
  return { id: value.id, kind: 'approval', prompt: value.prompt, requiresReview: 'pass' };
}

/**
 * The compiler owns checker contracts.  Missing legacy fields normalize to null, but any present
 * value must be one of the exact, bounded shapes the compiler admits.
 */
function normalizeCheckerContract(
  value: { workflowProfile?: unknown; review?: unknown; completionGate?: unknown; dependsOn: readonly string[] },
): CheckerContractProvenance | undefined {
  const workflowProfile = normalizeWorkflowProfile(value.workflowProfile);
  const review = normalizeReview(value.review, value.dependsOn);
  const completionGate = normalizeCompletionGate(value.completionGate);
  if (workflowProfile === undefined || review === undefined || completionGate === undefined) return undefined;
  if (review !== null && workflowProfile !== 'checker-readonly') return undefined;
  if (completionGate !== null && review === null) return undefined;
  return { workflowProfile, review, completionGate };
}

function sameCheckerContract(left: CheckerContractProvenance, right: CheckerContractProvenance): boolean {
  return canonicalJson(left as unknown as JsonValue) === canonicalJson(right as unknown as JsonValue);
}

function reviewLoopDefinitionHash(stage: Pick<StoredStage, 'workflowProfile' | 'assignment' | 'review' | 'completionGate'>): string {
  return sha256(canonicalJson({
    workflowProfile: stage.workflowProfile,
    assignment: stage.assignment,
    review: stage.review,
    completionGate: stage.completionGate,
  } as unknown as JsonValue));
}

function generationOperationKey(runRef: string, stageId: string, generation: number): string {
  return generation === 1 ? `result:${runRef}:${stageId}` : `result:${runRef}:${stageId}:g${generation}`;
}

function reviewReceiptOperationKey(runRef: string, reviewStageId: string, generation: number): string {
  return `review-outcome:${runRef}:${reviewStageId}:g${generation}`;
}

function reviewGateOperationKey(runRef: string, reviewStageId: string, generation: number): string {
  return `review-gate:${runRef}:${reviewStageId}:g${generation}`;
}

function reviewInterventionOperationKey(runRef: string, reviewStageId: string, generation: number): string {
  return `review-intervention:${runRef}:${reviewStageId}:g${generation}`;
}

function reviewExhaustedOperationKey(runRef: string, reviewStageId: string, generation: number): string {
  return `review-exhausted:${runRef}:${reviewStageId}:g${generation}`;
}

function reviewGateAttachFingerprint(reviewReceiptRef: string, input: AttachReviewCompletionGateInput): string {
  return sha256(JSON.stringify({ reviewReceiptRef, input }));
}

function reviewGateResolutionFingerprint(requestRef: string, input: ResolveReviewCompletionGateInput, response: string | null): string {
  return sha256(JSON.stringify({ requestRef, input: { ...input, response } }));
}

function exhaustedReviewFingerprint(subject: string, runRef: string, input: ParkExhaustedReviewInput): string {
  return sha256(JSON.stringify({ subject, runRef, input }));
}

function sameStringArray(left: readonly string[], right: unknown): boolean {
  return Array.isArray(right) && left.length === right.length
    && right.every((item, index) => typeof item === 'string' && item === left[index]);
}

function approvedAssignment(value: unknown): ResolvedAgentAssignment | null | undefined {
  if (!isPlainRecord(value) || !Object.hasOwn(value, 'assignment')) return null;
  return normalizeAssignment(value.assignment);
}

function approvedRunAssignments(
  snapshot: JsonObject,
  stages: readonly CreateRunStageInput[],
): {
  manager: ResolvedAgentAssignment | null;
  stages: Map<string, { assignment: ResolvedAgentAssignment | null; checkerContract: CheckerContractProvenance }>;
} | null {
  if (!isPlainRecord(snapshot.manager) || !Array.isArray(snapshot.stages) || snapshot.stages.length !== stages.length) return null;
  const manager = approvedAssignment(snapshot.manager);
  if (manager === undefined) return null;
  const snapshotStages = snapshot.stages;
  const snapshotById = new Map<string, Record<string, unknown>>();
  for (const snapshotStage of snapshotStages) {
    if (!isPlainRecord(snapshotStage) || typeof snapshotStage.id !== 'string' || snapshotById.has(snapshotStage.id)) return null;
    snapshotById.set(snapshotStage.id, snapshotStage);
  }
  const resolved = new Map<string, { assignment: ResolvedAgentAssignment | null; checkerContract: CheckerContractProvenance }>();
  for (const stage of stages) {
    const snapshotStage = snapshotById.get(stage.stageId);
    if (!snapshotStage) return null;
    if (typeof snapshotStage.title !== 'string' || snapshotStage.title !== stage.title.trim()
      || !sameStringArray(stage.dependsOn, snapshotStage.dependsOn)) return null;
    const assignment = approvedAssignment(snapshotStage);
    if (assignment === undefined) return null;
    const checkerContract = normalizeCheckerContract({
      workflowProfile: snapshotStage.workflowProfile,
      review: snapshotStage.review,
      completionGate: snapshotStage.completionGate,
      dependsOn: stage.dependsOn,
    });
    if (!checkerContract) return null;
    if (checkerContract.review !== null
      && (assignment === null || typeof snapshotStage.action !== 'string' || !snapshotStage.action.startsWith('review:'))) {
      return null;
    }
    resolved.set(stage.stageId, { assignment, checkerContract });
  }
  return { manager, stages: resolved };
}

function validOptionalEventText(input: OperationalEventInput): boolean {
  return ['summary', 'command', 'toolName', 'path', 'diff', 'checkpoint'].every((field) => {
    const value = (input as unknown as Record<string, unknown>)[field];
    return value === undefined || value === null || (typeof value === 'string' && !value.includes('\0'));
  });
}

function publicProposal(value: StoredProposal): ProposalRevision {
  const { subject: _subject, ...proposal } = value;
  return clone(proposal);
}

function proposalMetadata(value: StoredProposal): ProposalRevisionMetadata {
  return {
    proposalRef: value.proposalRef,
    sourceComposerRef: value.sourceComposerRef,
    sourceTurnId: value.sourceTurnId,
    revision: value.revision,
    hash: value.hash,
    previousHash: value.previousHash,
    title: value.title,
    createdAt: value.createdAt,
    approval: value.approval
      ? {
          revision: value.approval.revision,
          decision: value.approval.decision,
          decidedBy: value.approval.decidedBy,
          decidedAt: value.approval.decidedAt,
        }
      : null,
  };
}

function publicRun(value: StoredRun): Run {
  const {
    subject: _subject,
    launchOperationKey: _launchOperationKey,
    launchOperationFingerprint: _launchOperationFingerprint,
    archiveOperationKey: _archiveOperationKey,
    archiveOperationFingerprint: _archiveOperationFingerprint,
    activationReceipts: _activationReceipts,
    authorizedFailedRunReconciliation: _authorizedFailedRunReconciliation,
    ...run
  } = value;
  return clone(run);
}

function publicStage(value: StoredStage): Stage {
  const { subject: _subject, ...stage } = value;
  return clone(stage);
}

function publicAttempt(value: StoredAttempt): Attempt {
  const { subject: _subject, ...attempt } = value;
  return clone(attempt);
}

function publicSession(value: StoredSession): ManagedSession {
  const {
    subject: _subject,
    operationKey: _operationKey,
    operationFingerprint: _fingerprint,
    brokerProfileId: _brokerProfileId,
    brokerApprovedPromptHash: _brokerApprovedPromptHash,
    brokerStopRequested: _brokerStopRequested,
    brokerSteering: _brokerSteering,
    brokerReceipts: _brokerReceipts,
    ...session
  } = value;
  return clone(session);
}

function publicRequest(value: StoredHumanRequest): HumanRequest {
  const {
    subject: _subject,
    operationKey: _operationKey,
    operationFingerprint: _operationFingerprint,
    resolutionOperationFingerprint: _resolutionOperationFingerprint,
    legacyRecoveryOperationKey: _legacyRecoveryOperationKey,
    legacyRecoveryOperationFingerprint: _legacyRecoveryOperationFingerprint,
    legacyRecoveryEventCursor: _legacyRecoveryEventCursor,
    ...request
  } = value;
  return clone(request);
}

/**
 * A request whose resolution is RESERVED to the review gate resolver.
 *
 * The review lineage validated on every load pins these: a completion gate's resolution is
 * fingerprint-bound to its receipt/loop/stage CAS tuple, and a review intervention must stay `open`.
 * Resolving either through a generic path would make the document fail its own invariants on reload,
 * so both the generic responder and the archive path ask this question first.
 */
function isReviewLinkedRequest(document: StoreDocument, requestRef: string): boolean {
  return document.reviewReceipts.some((receipt) =>
    receipt.completionRequestRef === requestRef || receipt.interventionRequestRef === requestRef);
}

/**
 * Write one operator resolution onto an OPEN request, in place.
 *
 * `respondHumanRequest` (one request, one explicit decision) and `archiveRun` (every answerable request
 * on a dismissed run) are the two writers of a Human Response, and the record they leave has to be
 * identical — `acceptsHumanRequest`, the resume path and the store's own replay checks all read these
 * exact fields. One writer, so the two can never drift.
 */
/** The per-request response key an archive writes; derived so a replay recognizes its own resolutions. */
function archiveResponseKey(archiveKey: string, requestRef: string): string {
  return `archive:${archiveKey}:${requestRef}`.slice(0, MAX_SHORT_TEXT);
}

function recordHumanResponse(
  request: StoredHumanRequest,
  subject: string,
  input: { decision: HumanRequestDecision; idempotencyKey: string; response: string | null },
  at: string,
): void {
  request.response = {
    requestRevision: request.revision,
    decision: input.decision,
    respondedBy: subject,
    idempotencyKey: input.idempotencyKey,
    response: input.response,
    respondedAt: at,
  };
  request.state = 'resolved';
  request.updatedAt = at;
}

/** The per-request idempotency key an engine-side auto-close writes; `tag` names the terminal state the
 *  run reached, so the key is unique per (run outcome, request) and a replay recognizes its own record. */
function autoCloseResponseKey(tag: string, runRef: string, requestRef: string): string {
  return `auto-close:${tag}:${runRef}:${requestRef}`.slice(0, MAX_SHORT_TEXT);
}

/**
 * Resolve every OPEN, non-review-linked Human Request on one run with an honest auto-close record —
 * same shape as `archiveRun`'s resolution, except the decision is `'auto-closed'`, never `'responded'`,
 * so the record can never be misread as a human having answered. A review-linked request is left exactly
 * as `archiveRun` leaves it: untouched, pinned open by the review lineage invariants.
 *
 * Each close ALSO writes one governance event onto the run's timeline, from the same commit: an
 * operator reading the run has to be able to see that the platform, not a person, resolved the ask —
 * a resolution that appears only on the request record is invisible in the place the operator actually
 * reads the run's history. Mirrors the event `routes.ts` appends for a human response, with
 * `source: 'system'` because no human was involved. The run's event budget is respected: at the cap the
 * request still closes and the event is dropped rather than the close failing (the timeline is the
 * audit copy, not the record of truth — the sweep's audit ledger row is the durable one).
 */
function autoCloseOpenHumanRequestsForRun(
  document: StoreDocument, subject: string, runRef: string, atISO: string, tag: string, reason: string, maxEvents: number,
): StoredHumanRequest[] {
  const closed: StoredHumanRequest[] = [];
  let eventCount = document.events.filter((item) => item.subject === subject && item.runRef === runRef).length;
  for (const request of document.humanRequests) {
    if (request.subject !== subject || request.runRef !== runRef || request.state !== 'open') continue;
    if (isReviewLinkedRequest(document, request.requestRef)) continue;
    // A `review` kind carries retention/audit weight beyond its own run — `quarantinePlan` requires
    // every Human Request resolved precisely so a review outcome is never silently bypassed by an
    // ordinary state transition. It is left for an explicit `respondHumanRequest` or a deliberate,
    // reason-carrying `archiveRun`, never for this ambient close.
    if (request.kind === 'review') continue;
    recordHumanResponse(request, subject, {
      decision: 'auto-closed',
      idempotencyKey: autoCloseResponseKey(tag, runRef, request.requestRef),
      response: reason,
    }, atISO);
    closed.push(request);
    if (eventCount >= maxEvents) continue;
    eventCount += 1;
    document.events.push({
      subject,
      cursor: document.nextEventCursor,
      runRef,
      kind: 'governance',
      source: 'system',
      stageRef: request.stageRef,
      attemptRef: null,
      sessionRef: null,
      status: 'stopped',
      summary: `Human Request auto-closed without an answer (${tag}): ${reason}`,
      command: null,
      toolName: null,
      path: null,
      diff: null,
      checkpoint: null,
      createdAt: atISO,
    });
    document.nextEventCursor += 1;
  }
  return closed;
}

function publicEvent(value: StoredEvent): OperationalEvent {
  const {
    subject: _subject,
    operationKey: _operationKey,
    operationFingerprint: _operationFingerprint,
    ...event
  } = value;
  return clone(event);
}

function publicStageGeneration(value: StoredStageGeneration): StageGeneration {
  const { subject: _subject, operationFingerprint: _operationFingerprint, ...generation } = value;
  return clone(generation);
}

function publicReviewLoop(value: StoredReviewLoop): ReviewLoop {
  const { subject: _subject, ...loop } = value;
  return clone(loop);
}

function publicReviewReceipt(value: StoredReviewReceipt): ReviewReceipt {
  const { subject: _subject, operationFingerprint: _operationFingerprint, ...receipt } = value;
  return clone(receipt);
}

function publicGenerationSupersession(value: StoredGenerationSupersession): GenerationSupersession {
  const { subject: _subject, operationFingerprint: _operationFingerprint, ...supersession } = value;
  return clone(supersession);
}

function detail(document: StoreDocument, subject: string, run: StoredRun): RunDetail {
  return {
    run: publicRun(run),
    stages: document.stages.filter((item) => item.subject === subject && item.runRef === run.runRef).map(publicStage),
    attempts: document.attempts.filter((item) => item.subject === subject && item.runRef === run.runRef).map(publicAttempt),
    sessions: document.sessions.filter((item) => item.subject === subject && item.runRef === run.runRef).map(publicSession),
    humanRequests: document.humanRequests.filter((item) => item.subject === subject && item.runRef === run.runRef).map(publicRequest),
    stageGenerations: document.stageGenerations.filter((item) => item.subject === subject && item.runRef === run.runRef).map(publicStageGeneration),
    reviewLoops: document.reviewLoops.filter((item) => item.subject === subject && item.runRef === run.runRef).map(publicReviewLoop),
    reviewReceipts: document.reviewReceipts.filter((item) => item.subject === subject && item.runRef === run.runRef).map(publicReviewReceipt),
    generationSupersessions: document.generationSupersessions.filter((item) => item.subject === subject && item.runRef === run.runRef).map(publicGenerationSupersession),
  };
}

function metadata(document: StoreDocument, subject: string, run: StoredRun): RunMetadata {
  return {
    ...publicRun(run),
    stageCount: document.stages.filter((item) => item.subject === subject && item.runRef === run.runRef).length,
    attemptCount: document.attempts.filter((item) => item.subject === subject && item.runRef === run.runRef).length,
    sessionCount: document.sessions.filter((item) => item.subject === subject && item.runRef === run.runRef).length,
    openHumanRequestCount: document.humanRequests.filter((item) => item.subject === subject && item.runRef === run.runRef && item.state === 'open').length,
    eventCount: document.events.filter((item) => item.subject === subject && item.runRef === run.runRef).length,
  };
}

function bundleBytes(bundle: QuarantinedRunBundle | Omit<QuarantinedRunBundle, 'quarantinedAt'>): number {
  return Buffer.byteLength(JSON.stringify(bundle), 'utf8');
}

function activeBundle(document: StoreDocument, subject: string, run: StoredRun): Omit<QuarantinedRunBundle, 'quarantinedAt'> {
  return {
    subject,
    run,
    stages: document.stages.filter((item) => item.subject === subject && item.runRef === run.runRef),
    attempts: document.attempts.filter((item) => item.subject === subject && item.runRef === run.runRef),
    sessions: document.sessions.filter((item) => item.subject === subject && item.runRef === run.runRef),
    humanRequests: document.humanRequests.filter((item) => item.subject === subject && item.runRef === run.runRef),
    events: document.events.filter((item) => item.subject === subject && item.runRef === run.runRef),
    stageGenerations: document.stageGenerations.filter((item) => item.subject === subject && item.runRef === run.runRef),
    reviewLoops: document.reviewLoops.filter((item) => item.subject === subject && item.runRef === run.runRef),
    reviewReceipts: document.reviewReceipts.filter((item) => item.subject === subject && item.runRef === run.runRef),
    generationSupersessions: document.generationSupersessions.filter((item) => item.subject === subject && item.runRef === run.runRef),
  };
}

function inventoryItem(bundle: QuarantinedRunBundle | Omit<QuarantinedRunBundle, 'quarantinedAt'>): StorageInventoryItem {
  return {
    runRef: bundle.run.runRef,
    title: bundle.run.title,
    state: bundle.run.state,
    updatedAt: bundle.run.updatedAt,
    eventCount: bundle.events.length,
    estimatedBytes: bundleBytes(bundle),
    quarantinedAt: 'quarantinedAt' in bundle ? bundle.quarantinedAt : null,
  };
}

function bundleIsQuarantineEligible(bundle: Omit<QuarantinedRunBundle, 'quarantinedAt'>): boolean {
  return QUARANTINE_ELIGIBLE.has(bundle.run.state)
    && bundle.stages.every((stage) => QUARANTINE_SETTLED_STAGE.has(stage.state))
    && bundle.attempts.every((attempt) => QUARANTINE_SETTLED_ATTEMPT.has(attempt.state))
    && bundle.sessions.every((session) => QUARANTINE_SETTLED_SESSION.has(session.state))
    && bundle.humanRequests.every((request) => request.state === 'resolved' && request.response !== null)
    && bundle.reviewLoops.every((loop) => loop.state === 'passed');
}

function quarantineBundleHash(bundle: Omit<QuarantinedRunBundle, 'quarantinedAt'>): string {
  // The dry-run confirmation binds every record that will move, not inventory counts or byte estimates.
  return sha256(canonicalJson(bundle as unknown as JsonValue));
}

function boundaryAccepted(request: StoredHumanRequest): boolean {
  if (request.state !== 'resolved' || request.response === null) return false;
  if (request.kind === 'governance-refusal') return false;
  if (request.kind === 'approval' || request.kind === 'review') return request.response.decision === 'approved';
  return request.response.decision === 'approved' || request.response.decision === 'responded';
}

function boundariesAccepted(document: StoreDocument, subject: string, runRef: string, stageRef?: string): boolean {
  return document.humanRequests
    .filter((request) => request.subject === subject && request.runRef === runRef
      && (stageRef === undefined || request.stageRef === stageRef))
    .every(boundaryAccepted);
}

function activationFingerprint(runRef: string, input: RunActivationInput): string {
  return sha256(canonicalJson({
    runRef,
    expectedRunVersion: input.expectedRunVersion,
    expectedManagerGeneration: input.expectedManagerGeneration,
  }));
}

function validRunActivationInput(input: RunActivationInput): boolean {
  return validNonEmpty(input.idempotencyKey, MAX_SHORT_TEXT)
    && Number.isSafeInteger(input.expectedRunVersion) && input.expectedRunVersion >= 1
    && Number.isSafeInteger(input.expectedManagerGeneration) && input.expectedManagerGeneration >= 1;
}

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

function authorized20260731RecoveryFingerprint(input: RecoverAuthorized20260731ExecutionLockInput): string {
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

function validateAuthorized20260731RecoveryDurability(
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
    || run.publicationState !== 'published' || run.state !== 'waiting-human'
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
      || attempt.reviewSubjectGenerationRef !== null || attempt.reviewSubjectResultHash !== null
      || attempt.reviewSubjectCanonicalCommit !== null || attempt.logicalGeneration !== null
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
  if (document.stageGenerations.some(matchesRun) || document.reviewLoops.some(matchesRun)
    || document.reviewReceipts.some(matchesRun) || document.generationSupersessions.some(matchesRun)) return false;

  const events = document.events.filter(matchesRun);
  return events.length === 1 && events[0]?.kind === 'governance' && events[0].source === 'system'
    && events[0].stageRef === null && events[0].attemptRef === null && events[0].sessionRef === null
    && events[0].status === 'waiting'
    && events[0].summary === 'canonical run published; runtime activation remains gated'
    && events[0].command === null && events[0].toolName === null && events[0].path === null
    && events[0].diff === null && events[0].checkpoint === null;
}

function classifyAuthorized20260731ExecutionLock(
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

const AUTHORIZED_20260801_RECONCILIATION_SUMMARY =
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

function authorized20260801FailedRunFingerprint(input: ReconcileAuthorized20260801FailedRunInput): string {
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

function publicAuthorizedFailedRunReceipt(
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

export function exactAuthorized20260801ProposalRevision(proposal: ProposalRevision): boolean {
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
    || run.publicationState !== 'published' || run.state !== 'failed'
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
      || attempt.reviewSubjectGenerationRef !== null || attempt.reviewSubjectResultHash !== null
      || attempt.reviewSubjectCanonicalCommit !== null || attempt.logicalGeneration !== null
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
    && !document.stageGenerations.some(matchesRun) && !document.reviewLoops.some(matchesRun)
    && !document.reviewReceipts.some(matchesRun) && !document.generationSupersessions.some(matchesRun)
    && exactAuthorized20260801Events(document, subject, phase, receipt);
}

function validAuthorized20260801Input(input: ReconcileAuthorized20260801FailedRunInput): boolean {
  return input.expectedRunVersion === 7 && input.expectedManagerGeneration === 1
    && input.expectedRequestRevision === 2 && input.expectedNextEventCursor === 6
    && input.expectedProposalHash === AUTHORIZED_20260801_FAILED_RUN_PROPOSAL_HASH
    && input.idempotencyKey === AUTHORIZED_20260801_FAILED_RUN_IDEMPOTENCY_KEY;
}

function classifyAuthorized20260801FailedRun(
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
      result: { run: publicRun(run), event: publicEvent(event), receipt: publicReceipt },
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
function validateAuthorized20260801FailedRunDurability(
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

function latestPendingActivationReceipt(run: StoredRun): StoredRunActivationReceipt | undefined {
  const receipts = run.activationReceipts ?? [];
  for (let index = receipts.length - 1; index >= 0; index -= 1) {
    const receipt = receipts[index];
    if (receipt && (receipt.phase === 'claimed' || receipt.phase === 'roots-activated')) return receipt;
  }
  return undefined;
}

function assertActivationReceipts(run: StoredRun): void {
  const receipts = run.activationReceipts;
  if (receipts === undefined) return;
  if (!Array.isArray(receipts) || receipts.length > MAX_ACTIVATION_RECEIPTS_PER_RUN) {
    throw new Error('invalid control-plane run activation receipt');
  }
  const keys = new Set<string>();
  for (const receipt of receipts) {
    if (!receipt || typeof receipt !== 'object'
      || !validNonEmpty(receipt.idempotencyKey, MAX_SHORT_TEXT)
      || keys.has(receipt.idempotencyKey)
      || !HASH_RE.test(receipt.fingerprint)
      || !ACTIVATION_PHASES.has(receipt.phase)
      || !validNonEmpty(receipt.claimedAt, MAX_SHORT_TEXT)
      || !validNonEmpty(receipt.updatedAt, MAX_SHORT_TEXT)) {
      throw new Error('invalid control-plane run activation receipt');
    }
    keys.add(receipt.idempotencyKey);
  }
  const pending = receipts.filter((receipt) => receipt.phase === 'claimed' || receipt.phase === 'roots-activated');
  if (pending.length > 1) throw new Error('invalid control-plane pending run activation receipts');
}

function loopForReviewStage(document: StoreDocument, stage: StoredStage): StoredReviewLoop | undefined {
  return document.reviewLoops.find((loop) => loop.subject === stage.subject && loop.runRef === stage.runRef && loop.reviewStageRef === stage.stageRef);
}

function loopForSubjectStage(document: StoreDocument, stage: StoredStage): StoredReviewLoop | undefined {
  return document.reviewLoops.find((loop) => loop.subject === stage.subject && loop.runRef === stage.runRef && loop.subjectStageRef === stage.stageRef);
}

function stageMaySucceed(document: StoreDocument, stage: StoredStage): boolean {
  const subjectLoop = loopForSubjectStage(document, stage);
  if (subjectLoop) {
    const generation = stage.currentGenerationRef === null ? undefined : document.stageGenerations.find((item) =>
      item.subject === stage.subject && item.generationRef === stage.currentGenerationRef);
    return generation?.state === 'committed' && subjectLoop.activeGenerationRef === generation.generationRef;
  }
  const reviewLoop = loopForReviewStage(document, stage);
  if (!reviewLoop || reviewLoop.state === 'passed') return true;
  if (reviewLoop.state !== 'checking' || !stage.currentAttemptRef || !reviewLoop.activeGenerationRef) return false;
  const attempt = document.attempts.find((item) => item.subject === stage.subject && item.attemptRef === stage.currentAttemptRef);
  const generation = document.stageGenerations.find((item) => item.subject === stage.subject && item.generationRef === reviewLoop.activeGenerationRef);
  return attempt?.state === 'succeeded' && generation?.state === 'committed'
    && attempt.reviewSubjectGenerationRef === generation.generationRef
    && attempt.reviewSubjectResultHash === generation.resultHash
    && attempt.reviewSubjectCanonicalCommit === generation.canonicalCommit;
}

function dependenciesSucceeded(document: StoreDocument, stage: StoredStage): boolean {
  const stages = new Map(document.stages
    .filter((candidate) => candidate.subject === stage.subject && candidate.runRef === stage.runRef)
    .map((candidate) => [candidate.stageId, candidate]));
  return stage.dependsOn.every((dependency) => {
    const dependencyStage = stages.get(dependency);
    if (!dependencyStage || dependencyStage.state !== 'succeeded') return false;
    const loop = loopForSubjectStage(document, dependencyStage);
    if (!loop) return true;
    // The checker reads the committed active generation; every other dependent waits for acceptance.
    if (loop.reviewStageRef === stage.stageRef) {
      return loop.state === 'checking' && loop.activeGenerationRef === dependencyStage.currentGenerationRef;
    }
    return loop.state === 'passed' && loop.acceptedGenerationRef !== null
      && loop.acceptedGenerationRef === dependencyStage.acceptedGenerationRef;
  });
}

function reviewDependenciesAccepted(document: StoreDocument, stage: StoredStage): boolean {
  const stages = new Map(document.stages
    .filter((candidate) => candidate.subject === stage.subject && candidate.runRef === stage.runRef)
    .map((candidate) => [candidate.stageId, candidate]));
  return stage.dependsOn.every((dependency) => {
    const dependencyStage = stages.get(dependency);
    if (!dependencyStage) return false;
    const loop = loopForSubjectStage(document, dependencyStage);
    if (!loop) return true;
    return loop.reviewStageRef === stage.stageRef
      ? loop.state === 'checking' && loop.activeGenerationRef === dependencyStage.currentGenerationRef
      : loop.state === 'passed' && loop.acceptedGenerationRef === dependencyStage.acceptedGenerationRef;
  });
}

function runCanSucceed(document: StoreDocument, run: StoredRun): boolean {
  const matches = <T extends { subject: string; runRef: string }>(value: T): boolean =>
    value.subject === run.subject && value.runRef === run.runRef;
  return document.stages.filter(matches).every((stage) => stage.state === 'succeeded')
    && document.reviewLoops.filter(matches).every((loop) => loop.state === 'passed')
    && document.attempts.filter(matches).every((attempt) => TERMINAL_ATTEMPT.has(attempt.state) || attempt.state === 'interrupted')
    && document.sessions.filter(matches).every((session) => TERMINAL_SESSION.has(session.state) || session.state === 'interrupted');
}

function assertDocument(document: unknown): asserts document is StoreDocument {
  if (!document || typeof document !== 'object') throw new Error('invalid control-plane store');
  const candidate = document as Partial<StoreDocument>;
  const arrays = ['proposals', 'runs', 'stages', 'attempts', 'sessions', 'humanRequests', 'events', 'quarantine'] as const;
  if (candidate.version !== 1 || !Number.isSafeInteger(candidate.nextEventCursor) || (candidate.nextEventCursor ?? 0) < 1) {
    throw new Error('invalid control-plane store');
  }
  if (arrays.some((field) => !Array.isArray(candidate[field]))) throw new Error('invalid control-plane store');
  let previous = 0;
  for (const event of candidate.events ?? []) {
    if (!Number.isSafeInteger(event.cursor) || event.cursor <= previous || event.cursor >= (candidate.nextEventCursor ?? 0)) {
      throw new Error('invalid control-plane event cursor sequence');
    }
    previous = event.cursor;
  }
  for (const run of candidate.runs ?? []) {
    assertActivationReceipts(run);
    validateAuthorized20260801FailedRunDurability(candidate.events ?? [], run);
  }
  validateAuthorized20260731RecoveryDurability(candidate.humanRequests ?? [], candidate.events ?? []);
  for (const bundle of candidate.quarantine ?? []) {
    assertActivationReceipts(bundle.run);
    validateAuthorized20260731RecoveryDurability(bundle.humanRequests, bundle.events);
    validateAuthorized20260801FailedRunDurability(bundle.events, bundle.run);
  }
}

function appendRecoveryEvent(
  document: StoreDocument,
  subject: string,
  runRef: string,
  stamp: string,
  pendingActivation: boolean,
): void {
  document.events.push({
    subject,
    cursor: document.nextEventCursor,
    runRef,
    kind: 'lifecycle',
    source: 'system',
    stageRef: null,
    attemptRef: null,
    sessionRef: null,
    status: pendingActivation ? 'waiting' : 'interrupted',
    summary: pendingActivation
      ? 'dashboard restarted; an undispatched activation was returned to waiting-human for durable recovery'
      : 'dashboard restarted; active control-plane records were normalized to interrupted',
    command: null,
    toolName: null,
    path: null,
    diff: null,
    checkpoint: null,
    createdAt: stamp,
  });
  document.nextEventCursor += 1;
}

function normalizeStoredStageCheckerContract(stage: StoredStage): boolean {
  const checkerContract = normalizeCheckerContract(stage);
  if (!checkerContract) throw new Error('invalid control-plane checker contract provenance');
  let changed = false;
  if (stage.workflowProfile === undefined) {
    stage.workflowProfile = null;
    changed = true;
  }
  if (stage.review === undefined) {
    stage.review = null;
    changed = true;
  }
  if (stage.completionGate === undefined) {
    stage.completionGate = null;
    changed = true;
  }
  return changed;
}

function normalizeStoredStageGenerationProjection(stage: StoredStage): boolean {
  let changed = false;
  if (stage.currentGeneration === undefined) {
    stage.currentGeneration = 1;
    changed = true;
  }
  if (stage.currentGenerationRef === undefined) {
    stage.currentGenerationRef = null;
    changed = true;
  }
  if (stage.acceptedGenerationRef === undefined) {
    stage.acceptedGenerationRef = null;
    changed = true;
  }
  if (!Number.isSafeInteger(stage.currentGeneration) || stage.currentGeneration < 1
    || (stage.currentGenerationRef !== null && (typeof stage.currentGenerationRef !== 'string' || !SAFE_REF_RE.test(stage.currentGenerationRef)))
    || (stage.acceptedGenerationRef !== null && (typeof stage.acceptedGenerationRef !== 'string' || !SAFE_REF_RE.test(stage.acceptedGenerationRef)))) {
    throw new Error('invalid control-plane stage generation projection');
  }
  return changed;
}

function normalizeStoredAttemptReviewProvenance(attempt: StoredAttempt): boolean {
  let changed = false;
  for (const field of ['reviewSubjectGenerationRef', 'reviewSubjectResultHash', 'reviewSubjectCanonicalCommit', 'logicalGeneration', 'baseGenerationRef', 'baseCommit'] as const) {
    if (attempt[field] === undefined) {
      attempt[field] = null;
      changed = true;
    }
  }
  const values = [attempt.reviewSubjectGenerationRef, attempt.reviewSubjectResultHash, attempt.reviewSubjectCanonicalCommit];
  if (values.every((value) => value === null)) return changed;
  if (attempt.logicalGeneration !== null && (!Number.isSafeInteger(attempt.logicalGeneration) || attempt.logicalGeneration < 1)
    || (attempt.baseGenerationRef !== null && (typeof attempt.baseGenerationRef !== 'string' || !SAFE_REF_RE.test(attempt.baseGenerationRef)))
    || (attempt.baseCommit !== null && (typeof attempt.baseCommit !== 'string' || !CANONICAL_COMMIT_RE.test(attempt.baseCommit)))
    || (values.every((value) => value === null))) return changed;
  if (typeof attempt.reviewSubjectGenerationRef !== 'string' || !SAFE_REF_RE.test(attempt.reviewSubjectGenerationRef)
    || typeof attempt.reviewSubjectResultHash !== 'string' || !HASH_RE.test(attempt.reviewSubjectResultHash)
    || typeof attempt.reviewSubjectCanonicalCommit !== 'string' || !CANONICAL_COMMIT_RE.test(attempt.reviewSubjectCanonicalCommit)) {
    throw new Error('invalid control-plane checker attempt provenance');
  }
  return changed;
}

function migrateReviewCollections(document: StoreDocument): boolean {
  const raw = document as StoreDocument & Partial<StoreDocument>;
  let changed = false;
  for (const field of ['stageGenerations', 'reviewLoops', 'reviewReceipts', 'generationSupersessions'] as const) {
    if (raw[field] === undefined) {
      raw[field] = [] as never;
      changed = true;
    } else if (!Array.isArray(raw[field])) {
      throw new Error('invalid control-plane review collections');
    }
  }
  for (const bundle of document.quarantine) {
    const rawBundle = bundle as QuarantinedRunBundle & Partial<QuarantinedRunBundle>;
    for (const field of ['stageGenerations', 'reviewLoops', 'reviewReceipts', 'generationSupersessions'] as const) {
      if (rawBundle[field] === undefined) {
        rawBundle[field] = [] as never;
        changed = true;
      } else if (!Array.isArray(rawBundle[field])) {
        throw new Error('invalid control-plane review collections');
      }
    }
  }
  const generationBundles = [
    { stages: document.stages, generations: document.stageGenerations },
    ...document.quarantine.map((bundle) => ({ stages: bundle.stages, generations: bundle.stageGenerations })),
  ];
  for (const { stages, generations } of generationBundles) for (const generation of generations) {
    if (generation.resultCardRef === undefined) {
      const stage = stages.find((item) => item.stageRef === generation.logicalStageRef);
      generation.resultCardRef = generation.generation === 1 && stage && stage.canonicalCardRef !== null
        ? stage.canonicalCardRef : null;
      changed = true;
    }
    if (generation.baseCommit === undefined) {
      generation.baseCommit = null;
      changed = true;
    }
  }
  for (const bundle of [{ loops: document.reviewLoops, receipts: document.reviewReceipts }, ...document.quarantine.map((item) => ({ loops: item.reviewLoops, receipts: item.reviewReceipts }))]) {
    for (const loop of bundle.loops) {
      if (loop.interventionRequestRef === undefined) { loop.interventionRequestRef = null; changed = true; }
    }
    for (const receipt of bundle.receipts) {
      if (receipt.interventionRequestRef === undefined) { receipt.interventionRequestRef = null; changed = true; }
      if (receipt.version === undefined) { receipt.version = 1; changed = true; }
    }
  }
  for (const request of [...document.humanRequests, ...document.quarantine.flatMap((bundle) => bundle.humanRequests)]) {
    if (request.resolutionOperationFingerprint === undefined) { request.resolutionOperationFingerprint = null; changed = true; }
    if (request.legacyRecoveryOperationKey === undefined) { request.legacyRecoveryOperationKey = null; changed = true; }
    if (request.legacyRecoveryOperationFingerprint === undefined) { request.legacyRecoveryOperationFingerprint = null; changed = true; }
    if (request.legacyRecoveryEventCursor === undefined) { request.legacyRecoveryEventCursor = null; changed = true; }
  }
  return changed;
}

function validateReviewDurability(
  stages: readonly StoredStage[],
  attempts: readonly StoredAttempt[],
  sessions: readonly StoredSession[],
  generations: readonly StoredStageGeneration[],
  supersessions: readonly StoredGenerationSupersession[],
  loops: readonly StoredReviewLoop[],
  receipts: readonly StoredReviewReceipt[],
  humanRequests: readonly StoredHumanRequest[],
): void {
  const stageByRef = new Map(stages.map((stage) => [stage.stageRef, stage]));
  const attemptByRef = new Map(attempts.map((attempt) => [attempt.attemptRef, attempt]));
  const sessionByRef = new Map(sessions.map((session) => [session.sessionRef, session]));
  const generationByRef = new Map<string, StoredStageGeneration>();
  const generationByLogicalStage = new Set<string>();
  const generationOperationKeys = new Set<string>();
  const loopByReviewStage = new Map<string, StoredReviewLoop>();
  const loopBySubjectStage = new Map<string, StoredReviewLoop>();
  const reviewLoopRefs = new Set<string>();
  const receiptPairs = new Set<string>();
  const receiptOperationKeys = new Set<string>();
  const reviewReceiptRefs = new Set<string>();
  for (const generation of generations) {
    const stage = stageByRef.get(generation.logicalStageRef);
    const attempt = attemptByRef.get(generation.attemptRef);
    if (!stage || !attempt || generation.subject !== stage.subject || generation.subject !== attempt.subject
      || generation.runRef !== stage.runRef || generation.runRef !== attempt.runRef || attempt.stageRef !== stage.stageRef
      || generation.logicalStageId !== stage.stageId
      || !Number.isSafeInteger(generation.generation) || generation.generation < 1
      || !SAFE_REF_RE.test(generation.generationRef) || !SAFE_REF_RE.test(generation.attemptRef)
      || (generation.state === 'committed' && generation.canonicalResultOperationKey !== generationOperationKey(generation.runRef, generation.logicalStageId, generation.generation))
      || (generation.state === 'queued'
        ? generation.canonicalResultOperationKey !== null || generation.resultHash !== null || generation.resultCardRef !== null || generation.baseCommit !== null || generation.canonicalCommit !== null
        : generation.state !== 'committed' || generation.canonicalResultOperationKey === null || generation.resultHash === null
          || generation.canonicalCommit === null || !HASH_RE.test(generation.resultHash)
          || (generation.resultCardRef !== null && !SAFE_REF_RE.test(generation.resultCardRef))
          || (generation.generation > 1 && generation.resultCardRef !== null)
          || (generation.generation === 1 && (stage.canonicalCardRef === null || generation.resultCardRef !== stage.canonicalCardRef))
          || generation.baseCommit === null || !CANONICAL_COMMIT_RE.test(generation.baseCommit)
          || !CANONICAL_COMMIT_RE.test(generation.canonicalCommit))
      || generationByRef.has(generation.generationRef)
      || generationByLogicalStage.has(`${generation.logicalStageRef}:${generation.generation}`)
      || (generation.canonicalResultOperationKey !== null && generationOperationKeys.has(generation.canonicalResultOperationKey))) {
      throw new Error('invalid control-plane stage generation');
    }
    generationByRef.set(generation.generationRef, generation);
    generationByLogicalStage.add(`${generation.logicalStageRef}:${generation.generation}`);
    if (generation.canonicalResultOperationKey !== null) generationOperationKeys.add(generation.canonicalResultOperationKey);
  }
  for (const generation of generations) {
    const predecessor = generation.predecessorGenerationRef === null ? null : generationByRef.get(generation.predecessorGenerationRef);
    if ((generation.generation === 1 && predecessor !== null)
      || (generation.generation > 1 && (!predecessor || predecessor.logicalStageRef !== generation.logicalStageRef
        || predecessor.generation !== generation.generation - 1))) {
      throw new Error('invalid control-plane stage generation predecessor');
    }
  }
  const supersessionPredecessors = new Set<string>();
  const supersessionSuccessors = new Set<string>();
  const supersessionOperations = new Set<string>();
  for (const supersession of supersessions) {
    const predecessor = generationByRef.get(supersession.predecessorGenerationRef);
    const successor = generationByRef.get(supersession.successorGenerationRef);
    if (!predecessor || !successor || supersession.subject !== predecessor.subject || supersession.subject !== successor.subject
      || supersession.runRef !== predecessor.runRef || supersession.runRef !== successor.runRef
      || successor.logicalStageRef !== predecessor.logicalStageRef || successor.generation !== predecessor.generation + 1
      || successor.predecessorGenerationRef !== predecessor.generationRef || !['queued', 'committed'].includes(successor.state)
      || !SAFE_REF_RE.test(supersession.failedReviewReceiptRef) || !validNonEmpty(supersession.operationKey, MAX_SHORT_TEXT)
      || supersession.operationKey !== `rework:${supersession.runRef}:${predecessor.logicalStageId}:g${successor.generation}`
      || supersessionPredecessors.has(predecessor.generationRef) || supersessionSuccessors.has(successor.generationRef)
      || supersessionOperations.has(supersession.operationKey)) {
      throw new Error('invalid control-plane generation supersession');
    }
    supersessionPredecessors.add(predecessor.generationRef);
    supersessionSuccessors.add(successor.generationRef);
    supersessionOperations.add(supersession.operationKey);
  }
  for (const loop of loops) {
    const reviewStage = stageByRef.get(loop.reviewStageRef);
    const subjectStage = stageByRef.get(loop.subjectStageRef);
    if (!reviewStage || !subjectStage || loop.subject !== reviewStage.subject || loop.subject !== subjectStage.subject
      || loop.runRef !== reviewStage.runRef || loop.runRef !== subjectStage.runRef
      || reviewStage.review === null || reviewStage.review.subjectStageId !== subjectStage.stageId
      || reviewStage.workflowProfile !== 'checker-readonly' || reviewStage.dependsOn.length !== 1 || reviewStage.dependsOn[0] !== subjectStage.stageId
      || loop.maxCreatorReworks !== reviewStage.review.maxCreatorReworks
      || loop.reviewDefinitionHash !== reviewLoopDefinitionHash(reviewStage)
      || !Number.isSafeInteger(loop.reworksUsed) || loop.reworksUsed < 0 || loop.reworksUsed > loop.maxCreatorReworks
      || !['awaiting-subject', 'checking', 'rework-queued', 'failed', 'parked', 'awaiting-gate', 'passed'].includes(loop.state)
      || !Number.isSafeInteger(loop.version) || loop.version < 1 || !SAFE_REF_RE.test(loop.reviewLoopRef)
      || loopByReviewStage.has(loop.reviewStageRef) || loopBySubjectStage.has(loop.subjectStageRef)
      || reviewLoopRefs.has(loop.reviewLoopRef)) {
      throw new Error('invalid control-plane review loop');
    }
    for (const ref of [loop.activeGenerationRef, loop.acceptedGenerationRef, loop.activeReceiptRef, loop.interventionRequestRef]) {
      if (ref !== null && (typeof ref !== 'string' || !SAFE_REF_RE.test(ref))) throw new Error('invalid control-plane review loop reference');
    }
    if (loop.activeGenerationRef !== null && generationByRef.get(loop.activeGenerationRef)?.logicalStageRef !== subjectStage.stageRef) {
      throw new Error('invalid control-plane review loop generation reference');
    }
    if (loop.acceptedGenerationRef !== null && generationByRef.get(loop.acceptedGenerationRef)?.logicalStageRef !== subjectStage.stageRef) {
      throw new Error('invalid control-plane review loop accepted generation reference');
    }
    const activeGeneration = loop.activeGenerationRef === null ? null : generationByRef.get(loop.activeGenerationRef);
    if (activeGeneration && (subjectStage.currentGenerationRef !== activeGeneration.generationRef
      || subjectStage.currentGeneration !== activeGeneration.generation)) {
      throw new Error('invalid control-plane review loop active projection');
    }
    loopByReviewStage.set(loop.reviewStageRef, loop);
    loopBySubjectStage.set(loop.subjectStageRef, loop);
    reviewLoopRefs.add(loop.reviewLoopRef);
  }
  for (const stage of stages) {
    const loop = loopByReviewStage.get(stage.stageRef);
    if ((stage.review !== null && !loop) || (stage.review === null && loop)) {
      throw new Error('invalid control-plane review loop completeness');
    }
  }
  for (const attempt of attempts) {
    const loop = loopByReviewStage.get(attempt.stageRef);
    const creatorLoop = loopBySubjectStage.get(attempt.stageRef);
    const values = [attempt.reviewSubjectGenerationRef, attempt.reviewSubjectResultHash, attempt.reviewSubjectCanonicalCommit];
    const creatorProvenance = [attempt.logicalGeneration, attempt.baseGenerationRef, attempt.baseCommit];
    if (creatorLoop) {
      const generation = generations.find((item) => item.attemptRef === attempt.attemptRef);
      const predecessor = generation?.predecessorGenerationRef === null || generation === undefined
        ? undefined : generationByRef.get(generation.predecessorGenerationRef);
      const invalidCreatorProvenance = !generation
        ? attempt.logicalGeneration !== 1 || attempt.baseGenerationRef !== null || attempt.baseCommit !== null
        : generation.logicalStageRef !== creatorLoop.subjectStageRef || attempt.logicalGeneration !== generation.generation
          || (generation.generation === 1
            ? attempt.baseGenerationRef !== null || attempt.baseCommit !== null
            : !predecessor || attempt.baseGenerationRef !== predecessor.generationRef || attempt.baseCommit !== predecessor.canonicalCommit);
      if (invalidCreatorProvenance) {
        throw new Error('invalid control-plane creator attempt generation provenance');
      }
    } else if (creatorProvenance.some((value) => value !== null)) {
      throw new Error('invalid control-plane ordinary attempt generation provenance');
    }
    if (!loop) {
      if (values.some((value) => value !== null)) throw new Error('invalid control-plane ordinary attempt review provenance');
      continue;
    }
    if (values.every((value) => value === null)) {
      const referenced = receipts.some((receipt) => receipt.checkerAttemptRef === attempt.attemptRef);
      if (referenced || (!TERMINAL_ATTEMPT.has(attempt.state) && attempt.state !== 'interrupted')) {
        throw new Error('invalid control-plane unbound legacy checker attempt');
      }
      continue;
    }
    const generation = attempt.reviewSubjectGenerationRef === null ? undefined : generationByRef.get(attempt.reviewSubjectGenerationRef);
    if (!generation || attempt.reviewSubjectResultHash !== generation.resultHash
      || attempt.reviewSubjectCanonicalCommit !== generation.canonicalCommit || generation.logicalStageRef !== loop.subjectStageRef
      || generation.runRef !== attempt.runRef || generation.subject !== attempt.subject) {
      throw new Error('invalid control-plane checker attempt generation provenance');
    }
  }
  for (const receipt of receipts) {
    const loop = loopByReviewStage.get(receipt.reviewStageRef);
    const generation = generationByRef.get(receipt.subjectGenerationRef);
    const checkerAttempt = attemptByRef.get(receipt.checkerAttemptRef);
    const receiptReviewStage = stageByRef.get(receipt.reviewStageRef);
    const validOutcomeState = receipt.outcome.decision === 'fail'
      ? receipt.state === 'failed'
      : receipt.outcome.decision === 'parked'
        ? receipt.state === 'parked'
        : receiptReviewStage?.completionGate === null
          ? receipt.state === 'passed'
          : ['awaiting-completion-gate', 'passed', 'parked'].includes(receipt.state);
    if (!loop || !generation || !checkerAttempt || receipt.subject !== loop.subject || receipt.subject !== generation.subject
      || receipt.subject !== checkerAttempt.subject || receipt.runRef !== loop.runRef || receipt.runRef !== generation.runRef
      || receipt.runRef !== checkerAttempt.runRef || checkerAttempt.stageRef !== receipt.reviewStageRef
      || checkerAttempt.reviewSubjectGenerationRef !== generation.generationRef
      || checkerAttempt.reviewSubjectResultHash !== generation.resultHash || checkerAttempt.reviewSubjectCanonicalCommit !== generation.canonicalCommit
      || receipt.subjectStageRef !== loop.subjectStageRef
      || generation.logicalStageRef !== receipt.subjectStageRef || generation.resultHash !== receipt.subjectResultHash
      || !SAFE_REF_RE.test(receipt.reviewReceiptRef) || !SAFE_REF_RE.test(receipt.checkerAttemptRef)
      || receipt.operationKey !== reviewReceiptOperationKey(receipt.runRef, stageByRef.get(receipt.reviewStageRef)?.stageId ?? '', generation.generation)
      || !['passed', 'awaiting-completion-gate', 'failed', 'parked'].includes(receipt.state)
      || !Number.isSafeInteger(receipt.version) || receipt.version < 1
      || !validOutcomeState
      || (receipt.completionRequestRef !== null && !SAFE_REF_RE.test(receipt.completionRequestRef))
      || (receipt.interventionRequestRef !== null && !SAFE_REF_RE.test(receipt.interventionRequestRef))
      || (receipt.state === 'awaiting-completion-gate' ? receipt.finalizedAt !== null : receipt.finalizedAt === null)
      || sha256(canonicalJson(receipt.outcome as unknown as JsonValue)) !== receipt.outcomeHash
      || !parseReviewOutcome(JSON.stringify(receipt.outcome), { review: stageByRef.get(receipt.reviewStageRef)?.review as ProposalReview }).ok
      || receiptPairs.has(`${receipt.reviewStageRef}:${receipt.subjectGenerationRef}`) || receiptOperationKeys.has(receipt.operationKey)
      || reviewReceiptRefs.has(receipt.reviewReceiptRef)) {
      throw new Error('invalid control-plane review receipt');
    }
    receiptPairs.add(`${receipt.reviewStageRef}:${receipt.subjectGenerationRef}`);
    receiptOperationKeys.add(receipt.operationKey);
    reviewReceiptRefs.add(receipt.reviewReceiptRef);
  }
  const receiptByRef = new Map(receipts.map((receipt) => [receipt.reviewReceiptRef, receipt]));
  const requestByRef = new Map<string, StoredHumanRequest>();
  const reservedRequestOperations = new Set<string>();
  const requestCounts = new Map<string, number>();
  for (const request of humanRequests) {
    const countKey = `${request.subject}\0${request.runRef}`;
    const count = (requestCounts.get(countKey) ?? 0) + 1;
    if (count > MAX_HUMAN_REQUESTS_PER_RUN) throw new Error('invalid control-plane Human Request limit');
    requestCounts.set(countKey, count);
    if (!SAFE_REF_RE.test(request.requestRef) || requestByRef.has(request.requestRef)) {
      throw new Error('invalid control-plane review request reference');
    }
    const reserved = request.operationKey?.startsWith('review-gate:')
      || request.operationKey?.startsWith('review-intervention:')
      || request.operationKey?.startsWith('review-exhausted:');
    if (reserved && (!request.operationKey || !HASH_RE.test(request.operationFingerprint ?? '') || reservedRequestOperations.has(request.operationKey))) {
      throw new Error('invalid control-plane review request operation');
    }
    if (request.resolutionOperationFingerprint !== null && request.resolutionOperationFingerprint !== undefined
      && !HASH_RE.test(request.resolutionOperationFingerprint)) {
      throw new Error('invalid control-plane review request resolution fingerprint');
    }
    if (request.response === null && request.resolutionOperationFingerprint !== null && request.resolutionOperationFingerprint !== undefined) {
      throw new Error('invalid control-plane unresolved review request fingerprint');
    }
    if (reserved && request.operationKey) reservedRequestOperations.add(request.operationKey);
    requestByRef.set(request.requestRef, request);
  }
  const linkedRequestRefs = new Set<string>();
  for (const receipt of receipts) {
    const loop = loopByReviewStage.get(receipt.reviewStageRef);
    const generation = generationByRef.get(receipt.subjectGenerationRef);
    const reviewStage = stageByRef.get(receipt.reviewStageRef);
    if (!loop || !generation || !reviewStage) throw new Error('invalid control-plane review request linkage');
    const completion = receipt.completionRequestRef === null ? null : requestByRef.get(receipt.completionRequestRef) ?? null;
    const intervention = receipt.interventionRequestRef === null ? null : requestByRef.get(receipt.interventionRequestRef) ?? null;
    const gateOperation = reviewGateOperationKey(receipt.runRef, reviewStage.stageId, generation.generation);
    const interventionOperation = reviewInterventionOperationKey(receipt.runRef, reviewStage.stageId, generation.generation);
    const exhaustedOperation = reviewExhaustedOperationKey(receipt.runRef, reviewStage.stageId, generation.generation);
    const linked = [receipt.completionRequestRef, receipt.interventionRequestRef].filter((value): value is string => value !== null);
    if (linked.some((ref) => linkedRequestRefs.has(ref))) throw new Error('invalid control-plane duplicate review request link');
    for (const ref of linked) linkedRequestRefs.add(ref);
    const completionResolved = completion?.state === 'resolved' && completion.response !== null;
    const attachVersionDelta = completionResolved ? 2 : 1;
    const attachInput: AttachReviewCompletionGateInput = {
      expectedReceiptVersion: receipt.version - attachVersionDelta,
      expectedLoopVersion: loop.version - attachVersionDelta,
      expectedReviewStageVersion: reviewStage.version,
      idempotencyKey: gateOperation,
    };
    const validCompletion = completion !== null && completion.subject === receipt.subject && completion.runRef === receipt.runRef
      && completion.stageRef === receipt.reviewStageRef && completion.kind === 'approval' && completion.operationKey === gateOperation
      && completion.operationFingerprint === reviewGateAttachFingerprint(receipt.reviewReceiptRef, attachInput)
      && completion.revision === 1 && completion.title === cleanText(`Review gate: ${reviewStage.title}`, MAX_TITLE)
      && reviewStage.completionGate !== null
      && completion.prompt === cleanText(`${reviewStage.completionGate.prompt}\n\nReview summary: ${receipt.outcome.summary}`, MAX_LONG_TEXT)
      && ((completion.state === 'open' && completion.response === null && completion.resolutionOperationFingerprint === null)
        || completionResolved);
    let validResolution = true;
    if (completionResolved && completion?.response) {
      const resolutionInput: ResolveReviewCompletionGateInput = {
        expectedRequestRevision: completion.revision,
        expectedReceiptVersion: receipt.version - 1,
        expectedLoopVersion: loop.version - 1,
        expectedReviewStageVersion: reviewStage.version,
        expectedSubjectStageVersion: (stageByRef.get(receipt.subjectStageRef)?.version ?? 0) - 1,
        decision: completion.response.decision as ResolveReviewCompletionGateInput['decision'],
        idempotencyKey: completion.response.idempotencyKey,
        response: completion.response.response,
      };
      validResolution = completion.response.requestRevision === completion.revision
        && completion.response.respondedBy === completion.subject
        && ['approved', 'rejected', 'changes-requested'].includes(completion.response.decision)
        && completion.resolutionOperationFingerprint === reviewGateResolutionFingerprint(
          completion.requestRef,
          resolutionInput,
          completion.response.response,
        );
    }
    const parserParked = receipt.outcome.decision === 'parked';
    const exhaustedParking = receipt.state === 'failed' && loop.state === 'parked'
      && loop.activeReceiptRef === receipt.reviewReceiptRef && loop.activeGenerationRef === generation.generationRef;
    const exhaustedInput: ParkExhaustedReviewInput = {
      expectedSubjectStageVersion: stageByRef.get(receipt.subjectStageRef)?.version ?? 0,
      expectedReviewStageVersion: reviewStage.version,
      expectedLoopVersion: loop.version - 1,
      expectedReceiptVersion: receipt.version - 1,
      expectedSubjectAttemptRef: generation.attemptRef,
      expectedSubjectAttemptVersion: attemptByRef.get(generation.attemptRef)?.version ?? 0,
      expectedCheckerAttemptRef: receipt.checkerAttemptRef,
      expectedCheckerAttemptVersion: attemptByRef.get(receipt.checkerAttemptRef)?.version ?? 0,
      expectedGenerationRef: generation.generationRef,
      expectedFailedReceiptRef: receipt.reviewReceiptRef,
      idempotencyKey: exhaustedOperation,
    };
    const expectedInterventionFingerprint = exhaustedParking
      ? exhaustedReviewFingerprint(receipt.subject, receipt.runRef, exhaustedInput)
      : parserParked
        ? sha256(`${receipt.outcomeHash}\0${interventionOperation}`)
        : completion?.response ? sha256(`${completion.requestRef}\0${completion.response.idempotencyKey}`) : null;
    const expectedInterventionOperation = exhaustedParking ? exhaustedOperation : interventionOperation;
    const expectedInterventionPrompt = exhaustedParking
      ? `Creator rework bound exhausted: ${receipt.outcome.summary}`
      : parserParked
        ? `Review parked: ${receipt.outcome.summary}`
        : completion?.response ? `Review gate ${completion.response.decision}: ${receipt.outcome.summary}` : '';
    const validIntervention = intervention !== null && intervention.subject === receipt.subject && intervention.runRef === receipt.runRef
      && intervention.stageRef === receipt.reviewStageRef && intervention.kind === 'intervention' && intervention.operationKey === expectedInterventionOperation
      && intervention.operationFingerprint === expectedInterventionFingerprint && intervention.revision === 1
      && intervention.title === cleanText(`Review intervention: ${reviewStage.title}`, MAX_TITLE)
      && intervention.prompt === cleanText(expectedInterventionPrompt, MAX_LONG_TEXT)
      && intervention.state === 'open' && intervention.response === null && intervention.resolutionOperationFingerprint === null;
    const subjectStage = stageByRef.get(receipt.subjectStageRef);
    const completedWorkerSession = (attempt: StoredAttempt) => attempt.managedSessionRef === null || (() => {
      const session = sessionByRef.get(attempt.managedSessionRef);
      return !!session && session.subject === attempt.subject && session.runRef === attempt.runRef
        && session.stageRef === attempt.stageRef && session.attemptRef === attempt.attemptRef
        && session.role === 'worker' && session.state === 'completed';
    })();
    const validExhaustedParking = !exhaustedParking || (receipt.outcome.decision === 'fail'
      && receipt.completionRequestRef === null && loop.reworksUsed === loop.maxCreatorReworks
      && subjectStage?.state === 'succeeded' && subjectStage.currentGenerationRef === generation.generationRef
      && subjectStage.acceptedGenerationRef === null && subjectStage.currentAttemptRef === generation.attemptRef
      && reviewStage.state === 'succeeded' && reviewStage.currentAttemptRef === receipt.checkerAttemptRef
      && loop.activeGenerationRef === generation.generationRef && loop.activeReceiptRef === receipt.reviewReceiptRef
      && loop.acceptedGenerationRef === null && attemptByRef.get(generation.attemptRef)?.state === 'succeeded'
      && attemptByRef.get(receipt.checkerAttemptRef)?.state === 'succeeded'
      && completedWorkerSession(attemptByRef.get(generation.attemptRef) as StoredAttempt)
      && completedWorkerSession(attemptByRef.get(receipt.checkerAttemptRef) as StoredAttempt)
      && validIntervention);
    if ((receipt.completionRequestRef !== null && !validCompletion) || (receipt.interventionRequestRef !== null && !validIntervention)
      || !validResolution || !validExhaustedParking
      || ((receipt.interventionRequestRef !== null || loop.activeReceiptRef === receipt.reviewReceiptRef)
        && loop.interventionRequestRef !== receipt.interventionRequestRef)) {
      throw new Error('invalid control-plane review request cross-reference');
    }
    const gateAuthored = reviewStage.completionGate !== null;
    const completionDecision = completion?.response?.decision;
    if ((receipt.state === 'awaiting-completion-gate' && (!gateAuthored || (completion !== null && (completion.state !== 'open' || completion.response !== null))))
      || (receipt.state === 'passed' && (receipt.interventionRequestRef !== null || (gateAuthored && (!completion || completion.state !== 'resolved' || completionDecision !== 'approved'))))
      || (receipt.state === 'failed' && (exhaustedParking
        ? receipt.completionRequestRef !== null || !intervention
        : receipt.completionRequestRef !== null || receipt.interventionRequestRef !== null))
      || (receipt.state === 'parked' && (!intervention || (receipt.outcome.decision === 'parked'
        ? receipt.completionRequestRef !== null
        : !completion || completion.state !== 'resolved' || !['rejected', 'changes-requested'].includes(completionDecision ?? ''))))) {
      throw new Error('invalid control-plane review request state matrix');
    }
  }
  for (const request of humanRequests) {
    const reserved = request.operationKey?.startsWith('review-gate:')
      || request.operationKey?.startsWith('review-intervention:')
      || request.operationKey?.startsWith('review-exhausted:');
    if (reserved && !linkedRequestRefs.has(request.requestRef)) throw new Error('invalid control-plane orphan review request');
  }
  for (const supersession of supersessions) {
    const receipt = receiptByRef.get(supersession.failedReviewReceiptRef);
    if (!receipt || receipt.state !== 'failed' || receipt.subjectGenerationRef !== supersession.predecessorGenerationRef) {
      throw new Error('invalid control-plane generation supersession receipt');
    }
  }
  for (const generation of generations) {
    if (generation.generation < 2) continue;
    const links = supersessions.filter((item) => item.successorGenerationRef === generation.generationRef);
    if (links.length !== 1 || links[0]?.predecessorGenerationRef !== generation.predecessorGenerationRef) {
      throw new Error('invalid control-plane generation supersession completeness');
    }
  }
  for (const loop of loops) {
    const activeGeneration = loop.activeGenerationRef === null ? null : generationByRef.get(loop.activeGenerationRef);
    const activeReceipt = loop.activeReceiptRef === null ? null : receiptByRef.get(loop.activeReceiptRef);
    const acceptedGeneration = loop.acceptedGenerationRef === null ? null : generationByRef.get(loop.acceptedGenerationRef);
    if ((loop.state === 'awaiting-subject' && (activeGeneration !== null || activeReceipt !== null || acceptedGeneration !== null))
      || (loop.state === 'checking' && (activeGeneration === null || activeReceipt !== null || acceptedGeneration !== null))
      || (loop.state === 'rework-queued' && (activeGeneration?.state !== 'queued' || activeReceipt !== null || acceptedGeneration !== null))
      || (['failed', 'parked', 'awaiting-gate', 'passed'].includes(loop.state)
        && (!activeGeneration || !activeReceipt || activeReceipt.reviewStageRef !== loop.reviewStageRef
          || activeReceipt.subjectGenerationRef !== activeGeneration.generationRef))
      || (loop.state === 'failed' && activeReceipt?.state !== 'failed')
      || (loop.state === 'parked' && activeReceipt?.state !== 'parked'
        && !(activeReceipt?.state === 'failed' && loop.interventionRequestRef !== null && loop.reworksUsed === loop.maxCreatorReworks))
      || (loop.state === 'awaiting-gate' && activeReceipt?.state !== 'awaiting-completion-gate')
      || (loop.state === 'passed' && activeReceipt?.state !== 'passed')
      || (loop.state === 'passed' && (!acceptedGeneration || acceptedGeneration.generationRef !== activeGeneration?.generationRef))
      || (loop.state !== 'passed' && acceptedGeneration !== null)) {
      throw new Error('invalid control-plane review loop state references');
    }
    if (loop.state === 'rework-queued' && activeGeneration) {
      const subjectStage = stageByRef.get(loop.subjectStageRef);
      const reviewStage = stageByRef.get(loop.reviewStageRef);
      const attempt = attemptByRef.get(activeGeneration.attemptRef);
      const allowedSubjectLifecycle = !!subjectStage && !!attempt && (
        (subjectStage.state === 'ready' && ['queued', 'starting', 'running', 'succeeded'].includes(attempt.state))
        || (subjectStage.state === 'running' && ['starting', 'running', 'succeeded'].includes(attempt.state))
        || (subjectStage.state === 'interrupted' && ['interrupted', 'succeeded'].includes(attempt.state))
      );
      if (!subjectStage || !reviewStage || !attempt || subjectStage.currentAttemptRef !== activeGeneration.attemptRef
        || subjectStage.acceptedGenerationRef !== null || reviewStage.currentAttemptRef !== null || reviewStage.state !== 'blocked'
        || !allowedSubjectLifecycle) {
        throw new Error('invalid control-plane queued rework stage projection');
      }
    }
  }
  for (const stage of stages) {
    const currentGeneration = stage.currentGenerationRef === null ? null : generationByRef.get(stage.currentGenerationRef);
    if (stage.currentGenerationRef !== null && (!currentGeneration || currentGeneration.logicalStageRef !== stage.stageRef
      || currentGeneration.generation !== stage.currentGeneration)) {
      throw new Error('invalid control-plane stage current generation reference');
    }
    if (stage.acceptedGenerationRef !== null && generationByRef.get(stage.acceptedGenerationRef)?.logicalStageRef !== stage.stageRef) {
      throw new Error('invalid control-plane stage accepted generation reference');
    }
    const loop = loopBySubjectStage.get(stage.stageRef);
    if (loop && stage.acceptedGenerationRef !== loop.acceptedGenerationRef) {
      throw new Error('invalid control-plane stage accepted generation projection');
    }
  }
}

function legacyReviewLoopRef(stage: StoredStage): string {
  return `review-loop-${sha256(`${stage.runRef}\0${stage.stageRef}`)}`;
}

/**
 * Pre-foundation review contracts are durable compiler provenance, but their checker attempts have
 * no subject-generation binding.  We preserve those attempts as unbound history and interrupt any
 * live one; only a fresh, explicitly bound checker attempt may ever produce a receipt.
 */
function materializeLegacyReviewLoops(
  stages: readonly StoredStage[],
  attempts: readonly StoredAttempt[],
  loops: StoredReviewLoop[],
  stamp: string,
): boolean {
  let changed = false;
  for (const reviewStage of stages) {
    if (reviewStage.review === null || loops.some((loop) => loop.reviewStageRef === reviewStage.stageRef)) continue;
    const subjectStage = stages.find((stage) => stage.subject === reviewStage.subject && stage.runRef === reviewStage.runRef
      && stage.stageId === reviewStage.review?.subjectStageId);
    if (!subjectStage || reviewStage.dependsOn.length !== 1 || reviewStage.dependsOn[0] !== subjectStage.stageId
      || reviewStage.workflowProfile !== 'checker-readonly') {
      throw new Error('invalid control-plane legacy review contract');
    }
    loops.push({
      subject: reviewStage.subject,
      reviewLoopRef: legacyReviewLoopRef(reviewStage),
      runRef: reviewStage.runRef,
      reviewStageRef: reviewStage.stageRef,
      subjectStageRef: subjectStage.stageRef,
      maxCreatorReworks: reviewStage.review.maxCreatorReworks,
      reviewDefinitionHash: reviewLoopDefinitionHash(reviewStage),
      reworksUsed: 0,
      state: 'awaiting-subject',
      activeGenerationRef: null,
      acceptedGenerationRef: null,
      activeReceiptRef: null,
      interventionRequestRef: null,
      version: 1,
      createdAt: reviewStage.createdAt,
      updatedAt: stamp,
    });
    changed = true;
  }
  for (const reviewStage of stages.filter((stage) => stage.review !== null)) {
    for (const attempt of attempts.filter((candidate) => candidate.stageRef === reviewStage.stageRef)) {
      const unbound = attempt.reviewSubjectGenerationRef === null && attempt.reviewSubjectResultHash === null
        && attempt.reviewSubjectCanonicalCommit === null;
      if (!unbound || TERMINAL_ATTEMPT.has(attempt.state) || attempt.state === 'interrupted') continue;
      attempt.state = 'interrupted';
      attempt.version += 1;
      attempt.updatedAt = stamp;
      if (reviewStage.currentAttemptRef === attempt.attemptRef) {
        reviewStage.currentAttemptRef = null;
        reviewStage.version += 1;
        reviewStage.updatedAt = stamp;
      }
      changed = true;
    }
  }
  return changed;
}

function normalizeCrash(document: StoreDocument, stamp: string): boolean {
  let changed = migrateReviewCollections(document);
  for (const run of document.runs) {
    let runChanged = false;
    if (run.activationReceipts === undefined) {
      run.activationReceipts = [];
      changed = true;
    }
    if (run.authorizedFailedRunReconciliation === undefined) {
      run.authorizedFailedRunReconciliation = null;
      changed = true;
    }
    assertActivationReceipts(run);
    const pendingActivation = latestPendingActivationReceipt(run);
    const managerAssignment = normalizeAssignment(run.managerAssignment);
    if (managerAssignment === undefined) throw new Error('invalid control-plane assignment provenance');
    if (run.managerAssignment === undefined) {
      run.managerAssignment = null;
      changed = true;
    }
    const agentWorkspaceLaunch = normalizeAgentWorkspaceLaunch(run.agentWorkspaceLaunch);
    if (agentWorkspaceLaunch === undefined) throw new Error('invalid control-plane agent workspace launch provenance');
    if (run.agentWorkspaceLaunch === undefined) {
      run.agentWorkspaceLaunch = null;
      changed = true;
    }
    if (run.state === 'running' || run.state === 'recovering' || run.state === 'stopping') {
      run.state = pendingActivation ? 'waiting-human' : 'interrupted';
      run.version += 1;
      run.updatedAt = stamp;
      runChanged = true;
    }
    for (const stage of document.stages.filter((item) => item.subject === run.subject && item.runRef === run.runRef)) {
      const assignment = normalizeAssignment(stage.assignment);
      if (assignment === undefined) throw new Error('invalid control-plane assignment provenance');
      if (stage.assignment === undefined) {
        stage.assignment = null;
        changed = true;
      }
      if (normalizeStoredStageCheckerContract(stage)) changed = true;
      if (normalizeStoredStageGenerationProjection(stage)) changed = true;
      if (stage.state !== 'running') continue;
      stage.state = 'interrupted';
      stage.version += 1;
      stage.updatedAt = stamp;
      runChanged = true;
    }
    for (const attempt of document.attempts.filter((item) => item.subject === run.subject && item.runRef === run.runRef)) {
      if (normalizeStoredAttemptReviewProvenance(attempt)) changed = true;
      if (attempt.state !== 'starting' && attempt.state !== 'running') continue;
      attempt.state = 'interrupted';
      attempt.version += 1;
      attempt.updatedAt = stamp;
      runChanged = true;
    }
    for (const session of document.sessions.filter((item) => item.subject === run.subject && item.runRef === run.runRef)) {
      session.brokerSteering ??= [];
      session.brokerReceipts ??= [];
      session.brokerStopRequested ??= false;
      if (session.state !== 'starting' && session.state !== 'running' && session.state !== 'waiting') continue;
      session.state = 'interrupted';
      session.version += 1;
      session.updatedAt = stamp;
      session.brokerStopRequested = false;
      runChanged = true;
    }
    if (runChanged) {
      appendRecoveryEvent(document, run.subject, run.runRef, stamp, run.state === 'waiting-human' && pendingActivation !== undefined);
      changed = true;
    }
  }
  for (const bundle of document.quarantine) {
    if (bundle.run.activationReceipts === undefined) {
      bundle.run.activationReceipts = [];
      changed = true;
    }
    if (bundle.run.authorizedFailedRunReconciliation === undefined) {
      bundle.run.authorizedFailedRunReconciliation = null;
      changed = true;
    }
    assertActivationReceipts(bundle.run);
    const managerAssignment = normalizeAssignment(bundle.run.managerAssignment);
    if (managerAssignment === undefined) throw new Error('invalid control-plane assignment provenance');
    if (bundle.run.managerAssignment === undefined) {
      bundle.run.managerAssignment = null;
      changed = true;
    }
    for (const stage of bundle.stages) {
      const assignment = normalizeAssignment(stage.assignment);
      if (assignment === undefined) throw new Error('invalid control-plane assignment provenance');
      if (stage.assignment === undefined) {
        stage.assignment = null;
        changed = true;
      }
      if (normalizeStoredStageCheckerContract(stage)) changed = true;
      if (normalizeStoredStageGenerationProjection(stage)) changed = true;
    }
    const agentWorkspaceLaunch = normalizeAgentWorkspaceLaunch(bundle.run.agentWorkspaceLaunch);
    if (agentWorkspaceLaunch === undefined) throw new Error('invalid control-plane agent workspace launch provenance');
    if (bundle.run.agentWorkspaceLaunch === undefined) {
      bundle.run.agentWorkspaceLaunch = null;
      changed = true;
    }
    for (const attempt of bundle.attempts) {
      if (normalizeStoredAttemptReviewProvenance(attempt)) changed = true;
    }
    if (materializeLegacyReviewLoops(bundle.stages, bundle.attempts, bundle.reviewLoops, stamp)) changed = true;
    validateReviewDurability(bundle.stages, bundle.attempts, bundle.sessions, bundle.stageGenerations, bundle.generationSupersessions, bundle.reviewLoops, bundle.reviewReceipts, bundle.humanRequests);
  }
  if (materializeLegacyReviewLoops(document.stages, document.attempts, document.reviewLoops, stamp)) changed = true;
  validateReviewDurability(document.stages, document.attempts, document.sessions, document.stageGenerations, document.generationSupersessions, document.reviewLoops, document.reviewReceipts, document.humanRequests);
  validateAuthorized20260731RecoveryDurability(document.humanRequests, document.events);
  for (const run of document.runs) validateAuthorized20260801FailedRunDurability(document.events, run);
  for (const bundle of document.quarantine) {
    validateAuthorized20260731RecoveryDurability(bundle.humanRequests, bundle.events);
    validateAuthorized20260801FailedRunDurability(bundle.events, bundle.run);
  }
  return changed;
}

function makeStore(load: () => StoreDocument, save: (document: StoreDocument) => void, options: ControlStoreOptions): ControlPlaneStore {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? randomUUID;
  const maxEvents = options.maxEventsPerRun ?? MAX_EVENTS_PER_RUN;
  const ref = (prefix: string): string => `${prefix}-${newId()}`;
  const stamp = (): string => now().toISOString();

  /**
   * The one place a run is resolved from a ref. `scope` defaults to `'own-subject'`, so every WRITE
   * path below keeps the exact ownership check it always had; only the reads that a verified operator
   * session drives ever pass `'all-subjects'` (see {@link ReadScope}). Run refs are globally unique
   * (`run-<uuid>`), so widening the scope can never resolve a ref to a different subject's run by
   * accident — it only stops hiding one.
   */
  const findRun = (document: StoreDocument, subject: string, runRef: string, scope: ReadScope = 'own-subject'): StoredRun | undefined =>
    document.runs.find((item) => item.runRef === runRef && (scope === 'all-subjects' || item.subject === subject));

  const findSession = (document: StoreDocument, subject: string, runRef: string, sessionRef: string): StoredSession | undefined =>
    document.sessions.find((item) => item.subject === subject && item.runRef === runRef && item.sessionRef === sessionRef);

  const brokerState = (session: StoredSession): { receipts: StoredBrokerReceipt[]; steering: StoredSteeringInstruction[] } => {
    session.brokerReceipts ??= [];
    session.brokerSteering ??= [];
    session.brokerStopRequested ??= false;
    return { receipts: session.brokerReceipts, steering: session.brokerSteering };
  };

  const brokerFingerprint = (kind: StoredBrokerReceiptKind, input: unknown): string =>
    sha256(JSON.stringify({ kind, input }));

  const findBrokerReceipt = (
    session: StoredSession,
    kind: StoredBrokerReceiptKind,
    idempotencyKey: string,
    fingerprint: string,
  ): StoredBrokerReceipt | undefined => {
    const { receipts } = brokerState(session);
    const prior = receipts.find((item) => item.idempotencyKey === idempotencyKey);
    if (!prior) return undefined;
    if (prior.kind !== kind || prior.fingerprint !== fingerprint) {
      throw new Error('broker idempotencyKey was reused with different operation content');
    }
    return prior;
  };

  const pushBrokerReceipt = (session: StoredSession, receipt: StoredBrokerReceipt): void => {
    const { receipts } = brokerState(session);
    if (receipts.length >= MAX_BROKER_RECEIPTS_PER_SESSION) {
      throw new ControlStoreLimitError(`managed session has reached the ${MAX_BROKER_RECEIPTS_PER_SESSION} broker receipt limit`);
    }
    receipts.push(receipt);
  };

  const replayBrokerMutation = (receipt: StoredBrokerReceipt): BrokerMutation => ({
    status: receipt.status === 'applied' ? 'duplicate' : receipt.status as 'conflict' | 'inactive',
    revision: receipt.revision,
  });

  const commit = (document: StoreDocument): void => save(document);

  const appendBrokerEvent = (
    document: StoreDocument,
    session: StoredSession,
    input: Omit<OperationalEventInput, 'sessionRef'>,
    createdAt: string,
  ): StoredEvent => {
    const currentCount = document.events.filter((item) => item.subject === session.subject && item.runRef === session.runRef).length;
    if (currentCount >= maxEvents) throw new ControlStoreLimitError('run has reached the operational event limit');
    const event: StoredEvent = {
      subject: session.subject,
      cursor: document.nextEventCursor,
      runRef: session.runRef,
      kind: input.kind,
      source: input.source,
      stageRef: session.stageRef,
      attemptRef: session.attemptRef,
      sessionRef: session.sessionRef,
      status: input.status ?? null,
      summary: input.summary == null ? null : cleanText(input.summary, MAX_LONG_TEXT),
      command: input.command == null ? null : cleanText(input.command, MAX_LONG_TEXT),
      toolName: input.toolName == null ? null : cleanText(input.toolName, MAX_SHORT_TEXT),
      path: input.path == null ? null : cleanText(input.path, MAX_LONG_TEXT),
      diff: input.diff == null ? null : cleanText(input.diff, MAX_LONG_TEXT),
      checkpoint: input.checkpoint == null ? null : cleanText(input.checkpoint, MAX_LONG_TEXT),
      createdAt,
    };
    document.nextEventCursor += 1;
    document.events.push(event);
    return event;
  };

  const brokerPublicEvent = (session: StoredSession, event: PublicOperationalEvent): Omit<OperationalEventInput, 'sessionRef'> => {
    const source = session.role === 'manager' ? 'manager' as const : 'worker' as const;
    switch (event.kind) {
      case 'message': return { kind: 'message', source, summary: event.text };
      case 'session': return {
        kind: 'session-link', source, summary: `${event.role} ${event.sessionRef}: ${event.state}`,
      };
      case 'command': return {
        kind: 'command', source, summary: event.label, path: event.path,
        status: event.status === 'started' ? 'running' : event.status === 'succeeded' ? 'success' : 'failure',
      };
      case 'tool': return {
        kind: 'tool', source, toolName: event.name,
        status: event.status === 'started' ? 'running' : event.status === 'succeeded' ? 'success' : 'failure',
      };
      case 'file': return { kind: 'file', source, path: event.path, summary: event.operation };
      case 'diff': return { kind: 'diff', source, path: event.path, diff: event.summary };
      case 'checkpoint': return {
        kind: 'checkpoint', source, checkpoint: event.name,
        status: event.state === 'blocked' ? 'waiting' : 'success', summary: event.state,
      };
      case 'lifecycle': return {
        kind: 'lifecycle', source, summary: event.detail ? `${event.state}: ${event.detail}` : event.state,
        status: event.state === 'failed' ? 'failure'
          : event.state === 'stopped' ? 'stopped'
            : event.state === 'interrupted' ? 'interrupted'
              : event.state === 'running' ? 'running' : null,
      };
    }
  };

  const validateRefs = (document: StoreDocument, subject: string, runRef: string, input: OperationalEventInput): string | null => {
    if (input.stageRef && !document.stages.some((item) => item.subject === subject && item.runRef === runRef && item.stageRef === input.stageRef)) {
      return 'event stageRef does not belong to this run';
    }
    if (input.attemptRef && !document.attempts.some((item) => item.subject === subject && item.runRef === runRef && item.attemptRef === input.attemptRef)) {
      return 'event attemptRef does not belong to this run';
    }
    if (input.sessionRef && !document.sessions.some((item) => item.subject === subject && item.runRef === runRef && item.sessionRef === input.sessionRef)) {
      return 'event sessionRef does not belong to this run';
    }
    return null;
  };

  const quarantinePlan = (document: StoreDocument, subject: string, runRefs: string[], createdAt: string): ControlResult<QuarantinePlan> => {
    const unique = [...new Set(runRefs)].sort();
    if (unique.length === 0 || unique.length !== runRefs.length) return fail('invalid', 'runRefs must be a non-empty array without duplicates');
    const items = [];
    const bundleHashes: Array<{ runRef: string; bundleHash: string }> = [];
    for (const runRef of unique) {
      const run = findRun(document, subject, runRef);
      if (!run) return fail('not-found', `run '${runRef}' was not found`);
      const bundle = activeBundle(document, subject, run);
      const item = inventoryItem(bundle);
      items.push({ ...item, eligible: bundleIsQuarantineEligible(bundle) });
      bundleHashes.push({ runRef, bundleHash: quarantineBundleHash(bundle) });
    }
    const planBody: JsonObject = {
      runs: bundleHashes,
    };
    return ok({
      planHash: sha256(`${subject}\n${canonicalJson(planBody)}`),
      createdAt,
      items,
      estimatedBytes: items.reduce((sum, item) => sum + item.estimatedBytes, 0),
    });
  };

  return {
    listProposalRevisions(subject, proposalRef) {
      return load().proposals
        .filter((item) => item.subject === subject && (proposalRef === undefined || item.proposalRef === proposalRef))
        .sort((a, b) => a.proposalRef.localeCompare(b.proposalRef) || b.revision - a.revision)
        .map(proposalMetadata);
    },

    listProposalRevisionsForComposer(subject, sourceComposerRef, scope = 'own-subject') {
      return load().proposals
        .filter((item) => (scope === 'all-subjects' || item.subject === subject) && item.sourceComposerRef === sourceComposerRef)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.revision - a.revision)
        .map(proposalMetadata);
    },

    getProposalRevision(subject, proposalRef, revision) {
      const proposal = load().proposals.find((item) => item.subject === subject && item.proposalRef === proposalRef && item.revision === revision);
      return proposal ? ok(publicProposal(proposal)) : fail('not-found', 'proposal revision was not found');
    },

    createProposalRevision(subject, input) {
      if (!validNonEmpty(subject, MAX_SHORT_TEXT) || !validNonEmpty(input.title, MAX_TITLE)) return fail('invalid', 'subject and title are required');
      if (!SAFE_REF_RE.test(input.sourceComposerRef) || !SAFE_REF_RE.test(input.sourceTurnId)) {
        return fail('invalid', 'sourceComposerRef and sourceTurnId must be safe opaque references');
      }
      if (!isJsonValue(input.snapshot) || Array.isArray(input.snapshot) || input.snapshot === null) return fail('invalid', 'snapshot must be a JSON object');
      const snapshotBytes = Buffer.byteLength(canonicalJson(input.snapshot), 'utf8');
      if (snapshotBytes > MAX_PROPOSAL_SNAPSHOT_BYTES) return fail('limit', 'proposal snapshot exceeds the storage limit');
      if (containsRecognizedSecret(input.snapshot)) return fail('invalid', 'proposal snapshot contains a recognizable credential');
      const document = load();
      const existing = input.proposalRef
        ? document.proposals.filter((item) => item.subject === subject && item.proposalRef === input.proposalRef).sort((a, b) => b.revision - a.revision)
        : [];
      if (input.proposalRef && existing.length === 0) return fail('not-found', 'proposal was not found');
      const latest = existing[0];
      if (latest && latest.sourceComposerRef !== input.sourceComposerRef) {
        return fail('conflict', 'a different Composer workspace must import as a fresh proposal');
      }
      const expected = input.expectedPreviousHash ?? null;
      if ((latest?.hash ?? null) !== expected) return fail('conflict', 'proposal head changed');
      const proposal: StoredProposal = {
        subject,
        proposalRef: latest?.proposalRef ?? ref('proposal'),
        sourceComposerRef: input.sourceComposerRef,
        sourceTurnId: input.sourceTurnId,
        revision: (latest?.revision ?? 0) + 1,
        hash: proposalSnapshotHash(input.snapshot),
        previousHash: latest?.hash ?? null,
        title: input.title.trim(),
        createdAt: stamp(),
        snapshot: clone(input.snapshot),
        approval: null,
      };
      document.proposals.push(proposal);
      commit(document);
      return ok(publicProposal(proposal));
    },

    decideProposal(subject, proposalRef, revision, input) {
      const document = load();
      const proposal = document.proposals.find((item) => item.subject === subject && item.proposalRef === proposalRef && item.revision === revision);
      if (!proposal) return fail('not-found', 'proposal revision was not found');
      if (!HASH_RE.test(input.expectedHash) || input.expectedHash !== proposal.hash || input.expectedApprovalRevision !== 0) {
        return fail('conflict', 'proposal hash or approval revision changed');
      }
      if (!PROPOSAL_DECISIONS.has(input.decision)) return fail('invalid', 'proposal decision is invalid');
      if (!validNonEmpty(input.idempotencyKey, MAX_SHORT_TEXT)) return fail('invalid', 'idempotencyKey is required');
      const note = input.note == null ? null : cleanText(input.note, MAX_LONG_TEXT);
      if (proposal.approval) {
        if (proposal.approval.idempotencyKey !== input.idempotencyKey) return fail('conflict', 'proposal revision already has a decision');
        if (proposal.approval.decision !== input.decision || proposal.approval.note !== note) {
          return fail('idempotency-conflict', 'idempotencyKey was reused with different decision content');
        }
        return ok(publicProposal(proposal), true);
      }
      proposal.approval = {
        revision: 1,
        decision: input.decision,
        decidedBy: subject,
        idempotencyKey: input.idempotencyKey,
        decidedAt: stamp(),
        note,
      };
      commit(document);
      return ok(publicProposal(proposal));
    },

    listRuns(subject, scope = 'own-subject') {
      const document = load();
      return document.runs
        .filter((item) => scope === 'all-subjects' || item.subject === subject)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        // Child records are gathered under the RUN's own subject, never the caller's: under
        // `'all-subjects'` those differ, and counting a foreign run's stages under the caller's subject
        // would report zeros for everything.
        .map((run) => metadata(document, run.subject, run));
    },

    getRun(subject, runRef, scope = 'own-subject') {
      const document = load();
      const run = findRun(document, subject, runRef, scope);
      return run ? ok(detail(document, run.subject, run)) : fail('not-found', 'run was not found');
    },

    createRun(subject, input) {
      if (!validNonEmpty(input.title, MAX_TITLE) || !validNonEmpty(input.managerRuntime, MAX_SHORT_TEXT) || !validNonEmpty(input.managerModel, MAX_SHORT_TEXT)) {
        return fail('invalid', 'run title and manager routing are required');
      }
      if (!validNonEmpty(input.idempotencyKey, MAX_SHORT_TEXT)) return fail('invalid', 'idempotencyKey is required');
      const managerAssignment = normalizeAssignment(input.managerAssignment);
      if (managerAssignment === undefined) return fail('invalid', 'manager assignment provenance is invalid');
      const agentWorkspaceLaunch = normalizeAgentWorkspaceLaunch(input.agentWorkspaceLaunch);
      if (agentWorkspaceLaunch === undefined) return fail('invalid', 'agent workspace launch provenance is invalid');
      if (!Array.isArray(input.stages) || input.stages.length === 0 || input.stages.length > MAX_STAGES_PER_RUN) {
        return fail('limit', `run must contain 1-${MAX_STAGES_PER_RUN} stages`);
      }
      const ids = new Set<string>();
      const stageAssignments = new Map<string, ResolvedAgentAssignment | null>();
      const stageCheckerContracts = new Map<string, CheckerContractProvenance>();
      for (const stage of input.stages) {
        if (!validNonEmpty(stage.stageId, MAX_SHORT_TEXT) || !validNonEmpty(stage.title, MAX_TITLE) || ids.has(stage.stageId)
          || !Array.isArray(stage.dependsOn) || stage.dependsOn.some((item) => typeof item !== 'string')
          || new Set(stage.dependsOn).size !== stage.dependsOn.length
          || stage.canonicalCardRef != null) {
          return fail('invalid', 'stage ids and titles must be non-empty and stage ids must be unique');
        }
        const assignment = normalizeAssignment(stage.assignment);
        if (assignment === undefined) return fail('invalid', 'stage assignment provenance is invalid');
        const checkerContract = normalizeCheckerContract(stage);
        if (!checkerContract) return fail('invalid', 'stage checker contract provenance is invalid');
        ids.add(stage.stageId);
        stageAssignments.set(stage.stageId, assignment);
        stageCheckerContracts.set(stage.stageId, checkerContract);
      }
      if (input.stages.some((stage) => stage.dependsOn.some((dependency) => !ids.has(dependency) || dependency === stage.stageId))) {
        return fail('invalid', 'stage dependencies must reference a different stage in the same run');
      }
      const remaining = new Map(input.stages.map((stage) => [stage.stageId, stage.dependsOn.length]));
      const children = new Map(input.stages.map((stage) => [stage.stageId, [] as string[]]));
      for (const stage of input.stages) for (const dependency of stage.dependsOn) children.get(dependency)?.push(stage.stageId);
      const ready = [...remaining].filter(([, count]) => count === 0).map(([stageId]) => stageId);
      let visited = 0;
      while (ready.length > 0) {
        const stageId = ready.pop() as string;
        visited += 1;
        for (const child of children.get(stageId) ?? []) {
          const count = (remaining.get(child) ?? 0) - 1;
          remaining.set(child, count);
          if (count === 0) ready.push(child);
        }
      }
      if (visited !== input.stages.length) return fail('invalid', 'stage dependency graph contains a cycle');
      const document = load();
      const fingerprintStages = input.stages.map((stage) => ({
        ...stage,
        assignment: stageAssignments.get(stage.stageId) ?? null,
        ...stageCheckerContracts.get(stage.stageId),
      }));
      const launchFingerprint = sha256(JSON.stringify({
        proposalRef: input.proposalRef,
        proposalRevision: input.proposalRevision,
        expectedProposalHash: input.expectedProposalHash,
        title: input.title.trim(),
        managerRuntime: input.managerRuntime,
        managerModel: input.managerModel,
        managerAssignment,
        agentWorkspaceLaunch,
        predecessorRunRef: input.predecessorRunRef ?? null,
        expectedPredecessorVersion: input.expectedPredecessorVersion ?? null,
        stages: fingerprintStages,
      }));
      const replay = document.runs.find((item) => item.subject === subject && item.launchOperationKey === input.idempotencyKey);
      if (replay) {
        if (replay.launchOperationFingerprint !== launchFingerprint) {
          return fail('idempotency-conflict', 'idempotencyKey was reused with different launch content');
        }
        return ok(detail(document, subject, replay), true);
      }
      const proposal = document.proposals.find((item) =>
        item.subject === subject && item.proposalRef === input.proposalRef && item.revision === input.proposalRevision,
      );
      if (!proposal) return fail('not-found', 'proposal revision was not found');
      if (proposal.hash !== input.expectedProposalHash) return fail('conflict', 'proposal hash changed');
      if (proposal.approval?.decision !== 'approved') return fail('not-approved', 'proposal revision is not approved');
      const approvedAssignments = approvedRunAssignments(proposal.snapshot, input.stages);
      if (!approvedAssignments) return fail('invalid', 'approved proposal assignment provenance is invalid');
      if (!sameAssignment(managerAssignment, approvedAssignments.manager)
        || input.stages.some((stage) => {
          const approved = approvedAssignments.stages.get(stage.stageId);
          const requested = stageCheckerContracts.get(stage.stageId);
          return !approved || !requested
            || !sameAssignment(stageAssignments.get(stage.stageId) ?? null, approved.assignment)
            || !sameCheckerContract(requested, approved.checkerContract);
        })) {
        return fail('conflict', 'stage provenance does not match the approved proposal snapshot');
      }
      if (managerAssignment !== null
        && (input.managerRuntime !== managerAssignment.runtime || input.managerModel !== managerAssignment.model)) {
        return fail('conflict', 'manager routing does not match its approved assignment provenance');
      }
      const predecessorRunRef = input.predecessorRunRef ?? null;
      if (predecessorRunRef) {
        const predecessor = findRun(document, subject, predecessorRunRef);
        if (!predecessor) return fail('not-found', 'predecessor run was not found');
        if (predecessor.version !== input.expectedPredecessorVersion) return fail('conflict', 'predecessor run version changed');
        if (!TERMINAL_RUN.has(predecessor.state) && predecessor.state !== 'interrupted') {
          return fail('invalid', 'only a terminal or interrupted run can have a Retry successor');
        }
        if (predecessor.proposalHash !== proposal.hash) return fail('conflict', 'Retry successor must bind the same approved proposal hash');
        if (!sameAssignment(predecessor.managerAssignment, managerAssignment)
          || input.stages.some((stage) => {
            const predecessorStage = document.stages.find((item) =>
              item.subject === subject && item.runRef === predecessor.runRef && item.stageId === stage.stageId);
            const checkerContract = stageCheckerContracts.get(stage.stageId);
            const predecessorCheckerContract = predecessorStage ? normalizeCheckerContract(predecessorStage) : undefined;
            return !predecessorStage || !checkerContract
              || !sameAssignment(predecessorStage.assignment, stageAssignments.get(stage.stageId) ?? null)
              || !predecessorCheckerContract || !sameCheckerContract(predecessorCheckerContract, checkerContract);
          })) {
          return fail('conflict', 'Retry successor must preserve stage provenance');
        }
        const retryRefusal = retryPredecessorRefusal(document, predecessor);
        if (retryRefusal) return fail('invalid', retryRefusal);
      }
      const createdAt = stamp();
      const runRef = ref('run');
      const managerSessionRef = ref('session');
      const run: StoredRun = {
        subject,
        launchOperationKey: input.idempotencyKey,
        launchOperationFingerprint: launchFingerprint,
        activationReceipts: [],
        authorizedFailedRunReconciliation: null,
        runRef,
        predecessorRunRef,
        title: input.title.trim(),
        proposalRef: proposal.proposalRef,
        proposalRevision: proposal.revision,
        proposalHash: proposal.hash,
        publicationState: 'pending',
        state: 'planned',
        version: 1,
        managerSessionRef,
        managerGeneration: 1,
        managerAssignment: clone(managerAssignment),
        agentWorkspaceLaunch: clone(agentWorkspaceLaunch),
        createdAt,
        updatedAt: createdAt,
      };
      const stages: StoredStage[] = input.stages.map((inputStage) => ({
        subject,
        stageRef: ref('stage'),
        runRef,
        stageId: inputStage.stageId,
        title: inputStage.title.trim(),
        dependsOn: [...inputStage.dependsOn],
        canonicalCardRef: inputStage.canonicalCardRef ?? null,
        state: inputStage.dependsOn.length === 0 ? 'ready' : 'blocked',
        version: 1,
        currentAttemptRef: null,
        assignment: clone(stageAssignments.get(inputStage.stageId) ?? null),
        workflowProfile: stageCheckerContracts.get(inputStage.stageId)?.workflowProfile ?? null,
        review: clone(stageCheckerContracts.get(inputStage.stageId)?.review ?? null),
        completionGate: clone(stageCheckerContracts.get(inputStage.stageId)?.completionGate ?? null),
        currentGeneration: 1,
        currentGenerationRef: null,
        acceptedGenerationRef: null,
        createdAt,
        updatedAt: createdAt,
      }));
      const stagesById = new Map(stages.map((stage) => [stage.stageId, stage]));
      const reviewedSubjects = new Set<string>();
      const reviewLoops: StoredReviewLoop[] = [];
      for (const reviewStage of stages) {
        if (reviewStage.review === null) continue;
        const subjectStage = stagesById.get(reviewStage.review.subjectStageId);
        if (!subjectStage || reviewedSubjects.has(subjectStage.stageRef)) {
          return fail('invalid', 'review stages must bind exactly one distinct subject stage');
        }
        reviewedSubjects.add(subjectStage.stageRef);
        reviewLoops.push({
          subject,
          reviewLoopRef: ref('review-loop'),
          runRef,
          reviewStageRef: reviewStage.stageRef,
          subjectStageRef: subjectStage.stageRef,
          maxCreatorReworks: reviewStage.review.maxCreatorReworks,
          reviewDefinitionHash: reviewLoopDefinitionHash(reviewStage),
          reworksUsed: 0,
          state: 'awaiting-subject',
          activeGenerationRef: null,
          acceptedGenerationRef: null,
          activeReceiptRef: null,
          interventionRequestRef: null,
          version: 1,
          createdAt,
          updatedAt: createdAt,
        });
      }
      const manager: StoredSession = {
        subject,
        operationKey: null,
        operationFingerprint: null,
        sessionRef: managerSessionRef,
        runRef,
        stageRef: null,
        attemptRef: null,
        role: 'manager',
        generation: 1,
        predecessorSessionRef: null,
        runtime: input.managerRuntime,
        model: input.managerModel,
        state: 'pending',
        version: 1,
        createdAt,
        updatedAt: createdAt,
      };
      document.runs.push(run);
      document.stages.push(...stages);
      document.sessions.push(manager);
      document.reviewLoops.push(...reviewLoops);
      commit(document);
      return ok(detail(document, subject, run));
    },

    getRunActivationReceipt(subject, runRef, input) {
      if (!validRunActivationInput(input)) {
        return fail('invalid', 'run activation identity is invalid');
      }
      const document = load();
      const run = findRun(document, subject, runRef);
      if (!run) return fail('not-found', 'run was not found');
      const receipt = (run.activationReceipts ?? []).find((candidate) =>
        candidate.idempotencyKey === input.idempotencyKey);
      if (!receipt) return ok(null);
      const fingerprint = activationFingerprint(runRef, input);
      if (receipt.fingerprint !== fingerprint) {
        return fail('idempotency-conflict', 'idempotencyKey was reused with different activation content');
      }
      return ok({ run: publicRun(run), phase: receipt.phase }, true);
    },

    hasActiveRunActivation(subject, runRef) {
      const document = load();
      const run = findRun(document, subject, runRef);
      if (!run) return fail('not-found', 'run was not found');
      const receipts = run.activationReceipts ?? [];
      const latest = receipts[receipts.length - 1];
      return ok(latestPendingActivationReceipt(run) !== undefined
        || (latest?.phase === 'dispatched' && (run.state === 'recovering' || run.state === 'running')));
    },

    claimRunActivation(subject, runRef, input) {
      if (!validRunActivationInput(input)) {
        return fail('invalid', 'run activation identity is invalid');
      }
      const document = load();
      const run = findRun(document, subject, runRef);
      if (!run) return fail('not-found', 'run was not found');
      const fingerprint = activationFingerprint(runRef, input);
      const receipts = run.activationReceipts ??= [];
      const receipt = receipts.find((candidate) => candidate.idempotencyKey === input.idempotencyKey);
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) {
          return fail('idempotency-conflict', 'idempotencyKey was reused with different activation content');
        }
        if (receipt.phase === 'failed') {
          return fail('conflict', 'run activation previously failed');
        }
        if (receipt.phase === 'dispatched') {
          return ok({ run: publicRun(run), phase: receipt.phase }, true);
        }
        if (run.publicationState !== 'published'
          || (run.state !== 'recovering' && run.state !== 'waiting-human')) {
          return fail('conflict', 'claimed run activation state changed');
        }
        const requests = document.humanRequests.filter((request) =>
          request.subject === subject && request.runRef === runRef);
        if (requests.length === 0 || requests.some((request) => !boundaryAccepted(request))) {
          return fail('conflict', 'run activation Human Request boundaries are absent or unresolved');
        }
        if (run.state === 'waiting-human') {
          run.state = 'recovering';
          run.version += 1;
          run.updatedAt = stamp();
          commit(document);
        }
        return ok({ run: publicRun(run), phase: receipt.phase }, true);
      }
      const pending = latestPendingActivationReceipt(run);
      if (pending && run.state !== 'waiting-human') {
        return fail('idempotency-conflict', 'run activation is already claimed by another idempotencyKey');
      }
      if (run.version !== input.expectedRunVersion || run.managerGeneration !== input.expectedManagerGeneration
        || run.publicationState !== 'published' || run.state !== 'waiting-human') {
        return fail('conflict', 'run activation state changed');
      }
      const requests = document.humanRequests.filter((request) =>
        request.subject === subject && request.runRef === runRef);
      if (requests.length === 0 || requests.some((request) => !boundaryAccepted(request))) {
        return fail('conflict', 'run activation Human Request boundaries are absent or unresolved');
      }
      if (receipts.length >= MAX_ACTIVATION_RECEIPTS_PER_RUN) {
        return fail('limit', `run has reached the ${MAX_ACTIVATION_RECEIPTS_PER_RUN} activation receipt limit`);
      }
      if (pending) {
        pending.phase = 'failed';
        pending.updatedAt = stamp();
      }
      const claimedAt = stamp();
      const claimedReceipt: StoredRunActivationReceipt = {
        idempotencyKey: input.idempotencyKey,
        fingerprint,
        phase: 'claimed',
        claimedAt,
        updatedAt: claimedAt,
      };
      receipts.push(claimedReceipt);
      run.state = 'recovering';
      run.version += 1;
      run.updatedAt = claimedAt;
      commit(document);
      return ok({ run: publicRun(run), phase: claimedReceipt.phase });
    },

    advanceRunActivation(subject, runRef, input, phase) {
      if (!validRunActivationInput(input) || (phase !== 'roots-activated' && phase !== 'dispatched')) {
        return fail('invalid', 'run activation identity or phase is invalid');
      }
      const document = load();
      const run = findRun(document, subject, runRef);
      if (!run) return fail('not-found', 'run was not found');
      const receipt = (run.activationReceipts ?? []).find((candidate) =>
        candidate.idempotencyKey === input.idempotencyKey);
      if (!receipt) return fail('conflict', 'run activation was not claimed');
      if (receipt.fingerprint !== activationFingerprint(runRef, input)) {
        return fail('idempotency-conflict', 'idempotencyKey was reused with different activation content');
      }
      if (receipt.phase === 'failed') return fail('conflict', 'run activation previously failed');
      const rank: Record<Exclude<RunActivationPhase, 'failed'>, number> = {
        claimed: 0,
        'roots-activated': 1,
        dispatched: 2,
      };
      if (rank[receipt.phase] >= rank[phase]) {
        return ok({ run: publicRun(run), phase: receipt.phase }, true);
      }
      if ((phase === 'roots-activated' && run.state !== 'recovering')
        || (phase === 'dispatched' && run.state !== 'running')) {
        return fail('conflict', 'run activation state changed');
      }
      if (phase === 'dispatched' && receipt.phase !== 'roots-activated') {
        return fail('conflict', 'run activation roots are not durably activated');
      }
      receipt.phase = phase;
      receipt.updatedAt = stamp();
      commit(document);
      return ok({ run: publicRun(run), phase: receipt.phase });
    },

    failRunActivation(subject, runRef, input) {
      if (!validRunActivationInput(input)) return fail('invalid', 'run activation identity is invalid');
      const document = load();
      const run = findRun(document, subject, runRef);
      if (!run) return fail('not-found', 'run was not found');
      const receipt = (run.activationReceipts ?? []).find((candidate) =>
        candidate.idempotencyKey === input.idempotencyKey);
      if (!receipt) return fail('conflict', 'run activation was not claimed');
      if (receipt.fingerprint !== activationFingerprint(runRef, input)) {
        return fail('idempotency-conflict', 'idempotencyKey was reused with different activation content');
      }
      if (receipt.phase === 'dispatched') return fail('conflict', 'dispatched run activation cannot fail');
      if (receipt.phase === 'failed') {
        return ok({ run: publicRun(run), phase: receipt.phase }, true);
      }
      receipt.phase = 'failed';
      receipt.updatedAt = stamp();
      if (run.state === 'recovering' || run.state === 'running') {
        run.state = 'waiting-human';
        run.version += 1;
        run.updatedAt = receipt.updatedAt;
      }
      commit(document);
      return ok({ run: publicRun(run), phase: receipt.phase });
    },

    transitionRun(subject, runRef, expectedVersion, state) {
      const document = load();
      const run = findRun(document, subject, runRef);
      if (!run) return fail('not-found', 'run was not found');
      if (!RUN_STATES.has(state)) return fail('invalid', 'run state is invalid');
      // Archiving resolves the run's open requests in the SAME commit, so a bare transition to it would
      // leave a dismissed run still holding open asks. `archiveRun` owns that edge exclusively.
      if (state === 'archived') return fail('invalid', 'archiving a run goes through archiveRun, not a bare transition');
      if (run.version !== expectedVersion) return fail('conflict', 'run version changed');
      if (run.state === state) return ok(publicRun(run), true);
      if (!RUN_EDGES[run.state].has(state)) return fail('invalid', `run transition ${run.state}->${state} is not allowed`);
      if (run.state === 'waiting-human' && ['planned', 'recovering', 'running'].includes(state)
        && !boundariesAccepted(document, subject, runRef)) {
        return fail('invalid', 'waiting-human run boundaries are unresolved or not accepted');
      }
      if (state === 'succeeded' && !runCanSucceed(document, run)) {
        return fail('invalid', 'run cannot succeed while a descendant is nonterminal or a stage is incomplete');
      }
      run.state = state;
      run.version += 1;
      run.updatedAt = stamp();
      // A bare transition can land a run on a terminal state (`archived` goes through `archiveRun`
      // exclusively — rejected above). Close its open requests in the SAME commit, so a run that just
      // failed/stopped/succeeded can never leave a haunting ask behind the way the pre-fix zombies did.
      if (TERMINAL_RUN.has(state)) {
        autoCloseOpenHumanRequestsForRun(
          document, subject, runRef, run.updatedAt, `terminal:${state}`,
          `Automatically closed — the run reached its terminal state ('${state}') without this being answered.`,
          maxEvents,
        );
      }
      commit(document);
      return ok(publicRun(run));
    },

    transitionPublication(subject, runRef, expectedVersion, state) {
      const document = load();
      const run = findRun(document, subject, runRef);
      if (!run) return fail('not-found', 'run was not found');
      if (!PUBLICATION_STATES.has(state)) return fail('invalid', 'publication state is invalid');
      if (run.version !== expectedVersion) return fail('conflict', 'run version changed');
      if (run.publicationState === state) return ok(publicRun(run), true);
      if (!PUBLICATION_EDGES[run.publicationState].has(state)) {
        return fail('invalid', `publication transition ${run.publicationState}->${state} is not allowed`);
      }
      if (run.publicationState === 'waiting-human' && state === 'pending' && !boundariesAccepted(document, subject, runRef)) {
        return fail('invalid', 'publication boundaries are unresolved or not accepted');
      }
      run.publicationState = state;
      run.version += 1;
      run.updatedAt = stamp();
      commit(document);
      return ok(publicRun(run));
    },

    reconcileCanonicalProjection(subject, runRef, input) {
      const document = load();
      const run = findRun(document, subject, runRef);
      if (!run) return fail('not-found', 'run was not found');
      if (run.version !== input.expectedRunVersion) return fail('conflict', 'run version changed');
      if (run.proposalHash !== input.expectedProposalHash) return fail('conflict', 'canonical projection proposal hash differs');
      if (run.publicationState !== 'reconcile-required') {
        return fail('invalid', 'canonical projection requires reconcile-required publication state');
      }
      if (!Array.isArray(input.stages) || input.stages.length === 0) return fail('invalid', 'canonical stage projection is required');
      const storedStages = document.stages.filter((stage) => stage.subject === subject && stage.runRef === runRef);
      if (input.stages.length !== storedStages.length || new Set(input.stages.map((stage) => stage.stageRef)).size !== input.stages.length) {
        return fail('invalid', 'canonical projection must cover every run stage exactly once');
      }
      const projectedById = new Map<string, CanonicalStageProjectionInput>();
      const resolved: Array<{
        projection: CanonicalStageProjectionInput;
        stage: StoredStage;
        attempt: StoredAttempt;
        session: StoredSession;
      }> = [];
      const expectedTargets: Record<CanonicalStageProjectionInput['state'], {
        attempt: CanonicalStageProjectionInput['attemptState'];
        session: CanonicalStageProjectionInput['sessionState'];
      }> = {
        blocked: { attempt: 'queued', session: 'pending' },
        ready: { attempt: 'queued', session: 'pending' },
        running: { attempt: 'running', session: 'running' },
        'waiting-human': { attempt: 'waiting-human', session: 'waiting' },
        succeeded: { attempt: 'succeeded', session: 'completed' },
        failed: { attempt: 'failed', session: 'failed' },
        stopped: { attempt: 'stopped', session: 'stopped' },
      };
      for (const projection of input.stages) {
        const stage = storedStages.find((candidate) => candidate.stageRef === projection.stageRef);
        const attempt = document.attempts.find((candidate) =>
          candidate.subject === subject && candidate.runRef === runRef && candidate.attemptRef === projection.attemptRef);
        const session = document.sessions.find((candidate) =>
          candidate.subject === subject && candidate.runRef === runRef && candidate.sessionRef === projection.sessionRef);
        if (!stage || !attempt || !session || attempt.stageRef !== stage.stageRef || session.stageRef !== stage.stageRef
          || session.attemptRef !== attempt.attemptRef || stage.currentAttemptRef !== attempt.attemptRef
          || attempt.managedSessionRef !== session.sessionRef) {
          return fail('invalid', 'canonical projection references do not form the current stage-attempt-session chain');
        }
        if (stage.version !== projection.expectedStageVersion || attempt.version !== projection.expectedAttemptVersion
          || session.version !== projection.expectedSessionVersion) return fail('conflict', 'canonical projection version changed');
        if (stage.canonicalCardRef !== projection.canonicalCardRef) return fail('conflict', 'canonical card identity differs');
        const expected = expectedTargets[projection.state];
        if (!expected || projection.attemptState !== expected.attempt || projection.sessionState !== expected.session) {
          return fail('invalid', 'canonical projection lifecycle tuple is inconsistent');
        }
        projectedById.set(stage.stageId, projection);
        resolved.push({ projection, stage, attempt, session });
      }
      for (const { projection, stage } of resolved) {
        if (['ready', 'running', 'succeeded'].includes(projection.state)
          && !stage.dependsOn.every((dependency) => projectedById.get(dependency)?.state === 'succeeded')) {
          return fail('invalid', 'canonical projection releases a stage before its dependencies succeed');
        }
        if (projection.state === 'succeeded' && !stageMaySucceed(document, stage)) {
          return fail('invalid', 'canonical projection bypasses review lineage');
        }
        if (['ready', 'running', 'succeeded'].includes(projection.state) && !reviewDependenciesAccepted(document, stage)) {
          return fail('invalid', 'canonical projection bypasses accepted review dependencies');
        }
      }
      const states = input.stages.map((stage) => stage.state);
      const runState: RunState = states.every((state) => state === 'succeeded') ? 'succeeded'
        : states.some((state) => state === 'failed') ? 'failed'
          : states.some((state) => state === 'stopped') ? 'stopped'
            : states.some((state) => state === 'running') ? 'running' : 'waiting-human';
      if ((runState === 'running' || runState === 'succeeded') && !boundariesAccepted(document, subject, runRef)) {
        return fail('invalid', 'canonical projection cannot release unresolved or non-accepted boundaries');
      }
      const changedAt = stamp();
      for (const { projection, stage, attempt, session } of resolved) {
        if (session.state !== projection.sessionState) {
          session.state = projection.sessionState;
          session.version += 1;
          session.updatedAt = changedAt;
        }
        if (attempt.state !== projection.attemptState) {
          attempt.state = projection.attemptState;
          attempt.version += 1;
          attempt.updatedAt = changedAt;
        }
        if (stage.state !== projection.state) {
          stage.state = projection.state;
          stage.version += 1;
          stage.updatedAt = changedAt;
        }
      }
      const manager = document.sessions.find((session) =>
        session.subject === subject && session.runRef === runRef && session.sessionRef === run.managerSessionRef && session.role === 'manager');
      if (!manager) return fail('conflict', 'current manager session is missing');
      const managerState: ManagedSessionState = runState === 'running' ? 'running'
        : runState === 'waiting-human' ? 'waiting'
          : runState === 'succeeded' ? 'stopped'
            : runState === 'failed' ? 'failed' : 'stopped';
      if (manager.state !== managerState) {
        manager.state = managerState;
        manager.version += 1;
        manager.updatedAt = changedAt;
      }
      run.publicationState = 'published';
      run.state = runState;
      run.version += 1;
      run.updatedAt = changedAt;
      if (runState === 'succeeded' && !runCanSucceed(document, run)) {
        return fail('invalid', 'canonical projection left a nonterminal descendant');
      }
      commit(document);
      return ok(detail(document, subject, run));
    },

    transitionStage(subject, stageRef, expectedVersion, state) {
      const document = load();
      const stage = document.stages.find((item) => item.subject === subject && item.stageRef === stageRef);
      if (!stage) return fail('not-found', 'stage was not found');
      if (!STAGE_STATES.has(state)) return fail('invalid', 'stage state is invalid');
      if (stage.version !== expectedVersion) return fail('conflict', 'stage version changed');
      if (stage.state === state) return ok(publicStage(stage), true);
      if (!STAGE_EDGES[stage.state].has(state)) return fail('invalid', `stage transition ${stage.state}->${state} is not allowed`);
      if (['ready', 'running', 'succeeded'].includes(state) && !dependenciesSucceeded(document, stage)) {
        return fail('invalid', 'stage dependencies are not succeeded');
      }
      if (state === 'succeeded' && !stageMaySucceed(document, stage)) {
        return fail('invalid', 'stage review lineage is not committed or accepted');
      }
      if (stage.state === 'waiting-human' && state === 'ready'
        && !boundariesAccepted(document, subject, stage.runRef, stage.stageRef)) {
        return fail('invalid', 'waiting-human stage boundaries are unresolved or not accepted');
      }
      stage.state = state;
      stage.version += 1;
      stage.updatedAt = stamp();
      commit(document);
      return ok(publicStage(stage));
    },

    recordStageGeneration(subject, stageRef, input) {
      if (!validNonEmpty(input.operationKey, MAX_SHORT_TEXT) || typeof input.resultHash !== 'string' || !HASH_RE.test(input.resultHash)
        || (input.resultCardRef !== null && (typeof input.resultCardRef !== 'string' || !SAFE_REF_RE.test(input.resultCardRef)))
        || typeof input.baseCommit !== 'string' || !CANONICAL_COMMIT_RE.test(input.baseCommit)
        || typeof input.canonicalCommit !== 'string' || !CANONICAL_COMMIT_RE.test(input.canonicalCommit)
        || !Number.isSafeInteger(input.expectedGeneration) || input.expectedGeneration < 1) {
        return fail('invalid', 'stage generation lineage is invalid');
      }
      const document = load();
      const stage = document.stages.find((item) => item.subject === subject && item.stageRef === stageRef);
      if (!stage) return fail('not-found', 'stage was not found');
      if (input.operationKey !== generationOperationKey(stage.runRef, stage.stageId, input.expectedGeneration)) {
        return fail('invalid', 'stage generation operationKey is not canonical');
      }
      if ((input.expectedGeneration === 1 && (stage.canonicalCardRef === null || input.resultCardRef !== stage.canonicalCardRef))
        || (input.expectedGeneration > 1 && input.resultCardRef !== null)) {
        return fail('invalid', 'stage generation result card does not match immutable generation policy');
      }
      const fingerprint = sha256(JSON.stringify({ stageRef, ...input }));
      const replay = document.stageGenerations.find((item) => item.subject === subject && item.runRef === stage.runRef
        && item.canonicalResultOperationKey === input.operationKey);
      if (replay) {
        if (replay.operationFingerprint !== fingerprint) return fail('idempotency-conflict', 'operationKey was reused with different generation content');
        return ok(publicStageGeneration(replay), true);
      }
      if (stage.version !== input.expectedStageVersion) return fail('conflict', 'stage version changed');
      if (stage.currentGeneration !== input.expectedGeneration) {
        return fail('conflict', 'stage generation projection changed');
      }
      if (!stage.currentAttemptRef) return fail('invalid', 'stage has no current attempt');
      const attempt = document.attempts.find((item) => item.subject === subject && item.attemptRef === stage.currentAttemptRef);
      if (!attempt || attempt.stageRef !== stage.stageRef
        || attempt.version !== input.expectedAttemptVersion || attempt.state !== 'succeeded') {
        return fail('conflict', 'current attempt does not match the committed generation');
      }
      const loops = document.reviewLoops.filter((loop) => loop.subject === subject && loop.runRef === stage.runRef && loop.subjectStageRef === stage.stageRef);
      if (loops.length === 0) return fail('invalid', 'stage has no review loop');
      const predecessor = stage.currentGeneration === 1 ? null : document.stageGenerations.find((item) =>
        item.subject === subject && item.runRef === stage.runRef && item.logicalStageRef === stage.stageRef
          && item.generation === stage.currentGeneration - 1);
      if (stage.currentGeneration > 1 && !predecessor) return fail('conflict', 'prior generation is missing');
      const createdAt = stamp();
      const queued = stage.currentGenerationRef === null ? undefined : document.stageGenerations.find((item) => item.generationRef === stage.currentGenerationRef);
      if (queued && (queued.state !== 'queued' || queued.attemptRef !== attempt.attemptRef)) {
        return fail('conflict', 'queued generation projection changed');
      }
      if (queued && (!predecessor || attempt.logicalGeneration !== queued.generation
        || attempt.baseGenerationRef !== predecessor.generationRef || attempt.baseCommit !== predecessor.canonicalCommit
        || input.baseCommit !== attempt.baseCommit)) {
        return fail('conflict', 'queued creator attempt base lineage changed');
      }
      const generation: StoredStageGeneration = queued ?? {
        subject,
        operationFingerprint: fingerprint,
        generationRef: ref('generation'),
        runRef: stage.runRef,
        logicalStageRef: stage.stageRef,
        logicalStageId: stage.stageId,
        generation: stage.currentGeneration,
        predecessorGenerationRef: predecessor?.generationRef ?? null,
        attemptRef: attempt.attemptRef,
        canonicalResultOperationKey: null,
        resultHash: null,
        resultCardRef: null,
        baseCommit: null,
        canonicalCommit: null,
        state: 'queued',
        createdAt,
        updatedAt: createdAt,
      };
      generation.operationFingerprint = fingerprint;
      generation.canonicalResultOperationKey = input.operationKey;
      generation.resultHash = input.resultHash;
      generation.resultCardRef = input.resultCardRef;
      generation.baseCommit = input.baseCommit;
      generation.canonicalCommit = input.canonicalCommit;
      generation.state = 'committed';
      generation.updatedAt = createdAt;
      stage.currentGenerationRef = generation.generationRef;
      stage.version += 1;
      stage.updatedAt = createdAt;
      for (const loop of loops) {
        loop.activeGenerationRef = generation.generationRef;
        loop.state = 'checking';
        loop.version += 1;
        loop.updatedAt = createdAt;
      }
      if (!queued) document.stageGenerations.push(generation);
      commit(document);
      return ok(publicStageGeneration(generation));
    },

    recordReviewReceipt(subject, reviewStageRef, input) {
      if (!validNonEmpty(input.operationKey, MAX_SHORT_TEXT) || !validNonEmpty(input.subjectGenerationRef, MAX_SHORT_TEXT)
        || typeof input.subjectResultHash !== 'string' || !HASH_RE.test(input.subjectResultHash)
        || !validNonEmpty(input.checkerAttemptRef, MAX_SHORT_TEXT) || !validNonEmpty(input.outcome, MAX_REVIEW_OUTCOME_CHARS)) {
        return fail('invalid', 'review receipt content is invalid');
      }
      const document = load();
      const reviewStage = document.stages.find((item) => item.subject === subject && item.stageRef === reviewStageRef);
      if (!reviewStage) return fail('not-found', 'review stage was not found');
      if (reviewStage.review === null) return fail('invalid', 'stage has no review contract');
      const parsed = parseReviewOutcome(input.outcome, { review: reviewStage.review });
      if (!parsed.ok) return fail('invalid', parsed.detail);
      const outcomeHash = sha256(canonicalJson(parsed.value as unknown as JsonValue));
      const fingerprint = sha256(JSON.stringify({ reviewStageRef, ...input, outcomeHash }));
      const replay = document.reviewReceipts.find((item) => item.subject === subject && item.runRef === reviewStage.runRef && item.operationKey === input.operationKey);
      if (replay) {
        if (replay.operationFingerprint !== fingerprint) return fail('idempotency-conflict', 'operationKey was reused with different review receipt content');
        return ok(publicReviewReceipt(replay), true);
      }
      const loop = document.reviewLoops.find((item) => item.subject === subject && item.runRef === reviewStage.runRef && item.reviewStageRef === reviewStageRef);
      if (!loop) return fail('invalid', 'review loop was not found');
      if (reviewStage.version !== input.expectedReviewStageVersion || loop.version !== input.expectedLoopVersion) {
        return fail('conflict', 'review projection changed');
      }
      const subjectStage = document.stages.find((item) => item.subject === subject && item.runRef === reviewStage.runRef && item.stageRef === loop.subjectStageRef);
      const generation = document.stageGenerations.find((item) => item.subject === subject && item.runRef === reviewStage.runRef
        && item.generationRef === input.subjectGenerationRef);
      const checkerAttempt = document.attempts.find((item) => item.subject === subject && item.attemptRef === input.checkerAttemptRef);
      if (!subjectStage || !generation || generation.logicalStageRef !== loop.subjectStageRef || generation.state !== 'committed'
        || generation.resultHash !== input.subjectResultHash || loop.activeGenerationRef !== generation.generationRef
        || subjectStage.currentGenerationRef !== generation.generationRef
        || reviewStage.currentAttemptRef !== input.checkerAttemptRef
        || !checkerAttempt || checkerAttempt.stageRef !== reviewStageRef || checkerAttempt.version !== input.expectedCheckerAttemptVersion
        || checkerAttempt.state !== 'succeeded' || checkerAttempt.reviewSubjectGenerationRef !== generation.generationRef
        || checkerAttempt.reviewSubjectResultHash !== generation.resultHash || checkerAttempt.reviewSubjectCanonicalCommit !== generation.canonicalCommit) {
        return fail('conflict', 'review receipt lineage does not match current committed work');
      }
      if (input.operationKey !== reviewReceiptOperationKey(reviewStage.runRef, reviewStage.stageId, generation.generation)) {
        return fail('invalid', 'review receipt operationKey is not canonical');
      }
      if (document.reviewReceipts.some((item) => item.subject === subject && item.runRef === reviewStage.runRef
        && item.reviewStageRef === reviewStageRef && item.subjectGenerationRef === generation.generationRef)) {
        return fail('conflict', 'a review receipt already exists for this generation');
      }
      const createdAt = stamp();
      const state: ReviewReceipt['state'] = parsed.value.decision === 'fail'
        ? 'failed'
        : parsed.value.decision === 'parked'
          ? 'parked'
          : reviewStage.completionGate === null ? 'passed' : 'awaiting-completion-gate';
      if (state === 'parked' && document.humanRequests.filter((item) => item.subject === subject && item.runRef === reviewStage.runRef).length >= MAX_HUMAN_REQUESTS_PER_RUN) {
        return fail('limit', 'run has reached the Human Request limit');
      }
      const receipt: StoredReviewReceipt = {
        subject,
        operationFingerprint: fingerprint,
        reviewReceiptRef: ref('review-receipt'),
        runRef: reviewStage.runRef,
        reviewStageRef,
        subjectStageRef: subjectStage.stageRef,
        subjectGenerationRef: generation.generationRef,
        subjectResultHash: generation.resultHash,
        checkerAttemptRef: checkerAttempt.attemptRef,
        outcome: clone(parsed.value),
        outcomeHash,
        operationKey: input.operationKey,
        state,
        completionRequestRef: null,
        interventionRequestRef: null,
        version: 1,
        createdAt,
        finalizedAt: state === 'awaiting-completion-gate' ? null : createdAt,
      };
      loop.activeReceiptRef = receipt.reviewReceiptRef;
      loop.state = state === 'awaiting-completion-gate' ? 'awaiting-gate' : state;
      if (state === 'passed') {
        loop.acceptedGenerationRef = generation.generationRef;
        subjectStage.acceptedGenerationRef = generation.generationRef;
        subjectStage.version += 1;
        subjectStage.updatedAt = createdAt;
      }
      if (state === 'parked') {
        const interventionOperationKey = reviewInterventionOperationKey(reviewStage.runRef, reviewStage.stageId, generation.generation);
        if (document.humanRequests.filter((item) => item.subject === subject && item.runRef === reviewStage.runRef).length >= MAX_HUMAN_REQUESTS_PER_RUN) {
          return fail('limit', 'run has reached the Human Request limit');
        }
        if (document.humanRequests.some((item) => item.subject === subject && item.runRef === reviewStage.runRef && item.operationKey === interventionOperationKey)) {
          return fail('conflict', 'review intervention operationKey is already reserved');
        }
        const intervention: StoredHumanRequest = {
          subject, operationKey: interventionOperationKey, operationFingerprint: sha256(`${receipt.outcomeHash}\0${interventionOperationKey}`),
          requestRef: ref('request'), runRef: reviewStage.runRef, stageRef: reviewStage.stageRef, kind: 'intervention', revision: 1, state: 'open',
          title: cleanText(`Review intervention: ${reviewStage.title}`, MAX_TITLE), resolutionOperationFingerprint: null,
          prompt: cleanText(`Review parked: ${receipt.outcome.summary}`, MAX_LONG_TEXT), response: null, createdAt, updatedAt: createdAt,
        };
        receipt.interventionRequestRef = intervention.requestRef;
        loop.interventionRequestRef = intervention.requestRef;
        document.humanRequests.push(intervention);
      }
      loop.version += 1;
      loop.updatedAt = createdAt;
      document.reviewReceipts.push(receipt);
      commit(document);
      return ok(publicReviewReceipt(receipt));
    },

    attachReviewCompletionGate(subject, reviewReceiptRef, input) {
      if (!SAFE_REF_RE.test(reviewReceiptRef) || !validNonEmpty(input.idempotencyKey, MAX_SHORT_TEXT)) return fail('invalid', 'review gate identity is invalid');
      const document = load();
      const receipt = document.reviewReceipts.find((item) => item.subject === subject && item.reviewReceiptRef === reviewReceiptRef);
      if (!receipt) return fail('not-found', 'review receipt was not found');
      const reviewStage = document.stages.find((item) => item.subject === subject && item.stageRef === receipt.reviewStageRef);
      const subjectStage = document.stages.find((item) => item.subject === subject && item.stageRef === receipt.subjectStageRef);
      const loop = document.reviewLoops.find((item) => item.subject === subject && item.reviewStageRef === receipt.reviewStageRef);
      const generation = document.stageGenerations.find((item) => item.subject === subject && item.generationRef === receipt.subjectGenerationRef);
      if (!reviewStage || !subjectStage || !loop || !generation) return fail('conflict', 'review gate lineage is incomplete');
      const operationKey = reviewGateOperationKey(receipt.runRef, reviewStage.stageId, generation.generation);
      if (input.idempotencyKey !== operationKey) return fail('invalid', 'review gate idempotencyKey is not canonical');
      const fingerprint = reviewGateAttachFingerprint(reviewReceiptRef, input);
      const replay = document.humanRequests.find((item) => item.subject === subject && item.operationKey === operationKey);
      if (replay) {
        if (replay.operationFingerprint !== fingerprint || receipt.completionRequestRef !== replay.requestRef) return fail('idempotency-conflict', 'review gate idempotencyKey was reused with different content');
        return ok({ receipt: publicReviewReceipt(receipt), loop: publicReviewLoop(loop), request: publicRequest(replay), subjectStage: publicStage(subjectStage), reviewStage: publicStage(reviewStage), interventionRequest: null }, true);
      }
      if (receipt.state !== 'awaiting-completion-gate' || receipt.completionRequestRef !== null || receipt.interventionRequestRef !== null
        || loop.state !== 'awaiting-gate' || loop.activeReceiptRef !== receipt.reviewReceiptRef || loop.activeGenerationRef !== generation.generationRef
        || loop.acceptedGenerationRef !== null || loop.interventionRequestRef !== null || reviewStage.completionGate === null
        || receipt.version !== input.expectedReceiptVersion || loop.version !== input.expectedLoopVersion || reviewStage.version !== input.expectedReviewStageVersion) {
        return fail('conflict', 'review completion gate changed');
      }
      if (document.humanRequests.filter((item) => item.subject === subject && item.runRef === receipt.runRef).length >= MAX_HUMAN_REQUESTS_PER_RUN) {
        return fail('limit', 'run has reached the Human Request limit');
      }
      const createdAt = stamp();
      const request: StoredHumanRequest = {
        subject, operationKey, operationFingerprint: fingerprint, requestRef: ref('request'), runRef: receipt.runRef, stageRef: reviewStage.stageRef,
        kind: 'approval', revision: 1, state: 'open', title: cleanText(`Review gate: ${reviewStage.title}`, MAX_TITLE),
        prompt: cleanText(`${reviewStage.completionGate.prompt}\n\nReview summary: ${receipt.outcome.summary}`, MAX_LONG_TEXT), response: null,
        resolutionOperationFingerprint: null, createdAt, updatedAt: createdAt,
      };
      receipt.completionRequestRef = request.requestRef; receipt.version += 1;
      loop.version += 1; loop.updatedAt = createdAt;
      document.humanRequests.push(request);
      commit(document);
      return ok({ receipt: publicReviewReceipt(receipt), loop: publicReviewLoop(loop), request: publicRequest(request), subjectStage: publicStage(subjectStage), reviewStage: publicStage(reviewStage), interventionRequest: null });
    },

    resolveReviewCompletionGate(subject, requestRef, input) {
      if (!SAFE_REF_RE.test(requestRef) || !validNonEmpty(input.idempotencyKey, MAX_SHORT_TEXT)
        || !['approved', 'rejected', 'changes-requested'].includes(input.decision)) return fail('invalid', 'review gate resolution is invalid');
      const document = load();
      const request = document.humanRequests.find((item) => item.subject === subject && item.requestRef === requestRef);
      if (!request) return fail('not-found', 'review gate request was not found');
      const receipt = document.reviewReceipts.find((item) => item.subject === subject && item.completionRequestRef === requestRef);
      const loop = receipt ? document.reviewLoops.find((item) => item.subject === subject && item.reviewStageRef === receipt.reviewStageRef) : undefined;
      const reviewStage = receipt ? document.stages.find((item) => item.subject === subject && item.stageRef === receipt.reviewStageRef) : undefined;
      const subjectStage = receipt ? document.stages.find((item) => item.subject === subject && item.stageRef === receipt.subjectStageRef) : undefined;
      if (!receipt || !loop || !reviewStage || !subjectStage) return fail('conflict', 'review gate linkage is incomplete');
      const response = input.response == null ? null : cleanText(input.response, MAX_LONG_TEXT);
      const resolutionFingerprint = reviewGateResolutionFingerprint(requestRef, input, response);
      if (request.response) {
        if (request.response.idempotencyKey !== input.idempotencyKey || request.resolutionOperationFingerprint !== resolutionFingerprint) return fail('idempotency-conflict', 'review gate response was reused with different content');
        return ok({ receipt: publicReviewReceipt(receipt), loop: publicReviewLoop(loop), request: publicRequest(request), subjectStage: publicStage(subjectStage), reviewStage: publicStage(reviewStage), interventionRequest: receipt.interventionRequestRef === null ? null : publicRequest(document.humanRequests.find((item) => item.requestRef === receipt.interventionRequestRef) as StoredHumanRequest) }, true);
      }
      const generation = document.stageGenerations.find((item) => item.subject === subject && item.generationRef === receipt.subjectGenerationRef);
      const gateOperationKey = generation ? reviewGateOperationKey(receipt.runRef, reviewStage.stageId, generation.generation) : '';
      const attachInput: AttachReviewCompletionGateInput = {
        expectedReceiptVersion: receipt.version - 1,
        expectedLoopVersion: loop.version - 1,
        expectedReviewStageVersion: reviewStage.version,
        idempotencyKey: gateOperationKey,
      };
      if (request.kind !== 'approval' || request.state !== 'open' || receipt.state !== 'awaiting-completion-gate' || loop.state !== 'awaiting-gate'
        || !generation || generation.state !== 'committed' || generation.logicalStageRef !== subjectStage.stageRef
        || generation.runRef !== receipt.runRef || generation.resultHash !== receipt.subjectResultHash
        || subjectStage.currentGenerationRef !== generation.generationRef || subjectStage.acceptedGenerationRef !== null
        || loop.activeReceiptRef !== receipt.reviewReceiptRef || loop.activeGenerationRef !== generation.generationRef
        || loop.acceptedGenerationRef !== null || loop.interventionRequestRef !== null || receipt.interventionRequestRef !== null
        || reviewStage.completionGate === null || request.runRef !== receipt.runRef || request.stageRef !== reviewStage.stageRef
        || request.operationKey !== gateOperationKey || request.operationFingerprint !== reviewGateAttachFingerprint(receipt.reviewReceiptRef, attachInput)
        || request.revision !== 1 || request.response !== null || request.resolutionOperationFingerprint !== null
        || request.revision !== input.expectedRequestRevision || receipt.version !== input.expectedReceiptVersion || loop.version !== input.expectedLoopVersion
        || reviewStage.version !== input.expectedReviewStageVersion || subjectStage.version !== input.expectedSubjectStageVersion) return fail('conflict', 'review gate resolution changed');
      if (input.decision !== 'approved' && document.humanRequests.filter((item) => item.subject === subject && item.runRef === receipt.runRef).length >= MAX_HUMAN_REQUESTS_PER_RUN) {
        return fail('limit', 'run has reached the Human Request limit');
      }
      const createdAt = stamp();
      request.response = { requestRevision: request.revision, decision: input.decision, respondedBy: subject, idempotencyKey: input.idempotencyKey, response, respondedAt: createdAt };
      request.resolutionOperationFingerprint = resolutionFingerprint;
      request.state = 'resolved'; request.updatedAt = createdAt;
      receipt.state = input.decision === 'approved' ? 'passed' : 'parked'; receipt.finalizedAt = createdAt; receipt.version += 1;
      loop.state = input.decision === 'approved' ? 'passed' : 'parked'; loop.acceptedGenerationRef = input.decision === 'approved' ? receipt.subjectGenerationRef : null;
      loop.version += 1; loop.updatedAt = createdAt;
      subjectStage.acceptedGenerationRef = input.decision === 'approved' ? receipt.subjectGenerationRef : null;
      subjectStage.version += 1; subjectStage.updatedAt = createdAt;
      if (input.decision !== 'approved') {
        const interventionOperationKey = reviewInterventionOperationKey(receipt.runRef, reviewStage.stageId, generation.generation);
        if (document.humanRequests.some((item) => item.subject === subject && item.runRef === receipt.runRef && item.operationKey === interventionOperationKey)) {
          return fail('conflict', 'review intervention operationKey is already reserved');
        }
        const intervention: StoredHumanRequest = {
          subject, operationKey: interventionOperationKey, operationFingerprint: sha256(`${requestRef}\0${input.idempotencyKey}`),
          requestRef: ref('request'), runRef: receipt.runRef, stageRef: reviewStage.stageRef, kind: 'intervention', revision: 1, state: 'open',
          title: cleanText(`Review intervention: ${reviewStage.title}`, MAX_TITLE), resolutionOperationFingerprint: null,
          prompt: cleanText(`Review gate ${input.decision}: ${receipt.outcome.summary}`, MAX_LONG_TEXT), response: null, createdAt, updatedAt: createdAt,
        };
        receipt.interventionRequestRef = intervention.requestRef;
        loop.interventionRequestRef = intervention.requestRef;
        document.humanRequests.push(intervention);
      }
      commit(document);
      return ok({ receipt: publicReviewReceipt(receipt), loop: publicReviewLoop(loop), request: publicRequest(request), subjectStage: publicStage(subjectStage), reviewStage: publicStage(reviewStage), interventionRequest: receipt.interventionRequestRef === null ? null : publicRequest(document.humanRequests.find((item) => item.requestRef === receipt.interventionRequestRef) as StoredHumanRequest) });
    },

    advanceReviewGeneration(subject, runRef, input) {
      if (!validNonEmpty(input.idempotencyKey, MAX_SHORT_TEXT) || !SAFE_REF_RE.test(input.expectedSubjectAttemptRef)
        || !SAFE_REF_RE.test(input.expectedCheckerAttemptRef) || !SAFE_REF_RE.test(input.expectedFailedReceiptRef)
        || !SAFE_REF_RE.test(input.expectedGenerationRef)) return fail('invalid', 'rework identity is invalid');
      const document = load();
      const fingerprint = sha256(JSON.stringify({ runRef, input }));
      const replay = document.generationSupersessions.find((item) => item.subject === subject && item.operationKey === input.idempotencyKey);
      if (replay) {
        if (replay.operationFingerprint !== fingerprint) return fail('idempotency-conflict', 'idempotencyKey was reused with different rework content');
        const successor = document.stageGenerations.find((item) => item.generationRef === replay.successorGenerationRef);
        return successor ? ok(publicStageGeneration(successor), true) : fail('conflict', 'rework replay successor is missing');
      }
      const subjectStage = document.stages.find((stage) => stage.subject === subject && stage.runRef === runRef
        && stage.currentAttemptRef === input.expectedSubjectAttemptRef);
      if (!subjectStage) return fail('conflict', 'current creator attempt changed');
      const loop = loopForSubjectStage(document, subjectStage);
      if (!loop || loop.state !== 'failed' || loop.activeGenerationRef !== input.expectedGenerationRef
        || loop.activeReceiptRef !== input.expectedFailedReceiptRef) return fail('conflict', 'failed review loop changed');
      const reviewStage = document.stages.find((stage) => stage.subject === subject && stage.runRef === runRef && stage.stageRef === loop.reviewStageRef);
      const generation = document.stageGenerations.find((item) => item.subject === subject && item.generationRef === input.expectedGenerationRef);
      const receipt = document.reviewReceipts.find((item) => item.subject === subject && item.reviewReceiptRef === input.expectedFailedReceiptRef);
      const subjectAttempt = document.attempts.find((item) => item.subject === subject && item.attemptRef === input.expectedSubjectAttemptRef);
      const checkerAttempt = document.attempts.find((item) => item.subject === subject && item.attemptRef === input.expectedCheckerAttemptRef);
      const nextGeneration = (generation?.generation ?? 0) + 1;
      const operationKey = generation ? `rework:${runRef}:${subjectStage.stageId}:g${nextGeneration}` : '';
      if (input.idempotencyKey !== operationKey) return fail('invalid', 'rework idempotencyKey is not canonical');
      if (!generation || !receipt || !reviewStage || !subjectAttempt || !checkerAttempt
        || subjectStage.version !== input.expectedSubjectStageVersion || reviewStage.version !== input.expectedReviewStageVersion
        || loop.version !== input.expectedLoopVersion || subjectAttempt.version !== input.expectedSubjectAttemptVersion
        || checkerAttempt.version !== input.expectedCheckerAttemptVersion || subjectAttempt.state !== 'succeeded'
        || checkerAttempt.state !== 'succeeded' || subjectStage.state !== 'succeeded' || reviewStage.state !== 'succeeded'
        || generation.state !== 'committed' || receipt.state !== 'failed'
        || receipt.subjectGenerationRef !== generation.generationRef || receipt.checkerAttemptRef !== checkerAttempt.attemptRef
        || reviewStage.currentAttemptRef !== checkerAttempt.attemptRef || generation.attemptRef !== subjectAttempt.attemptRef
        || checkerAttempt.stageRef !== reviewStage.stageRef || checkerAttempt.reviewSubjectGenerationRef !== generation.generationRef
        || checkerAttempt.reviewSubjectResultHash !== generation.resultHash || checkerAttempt.reviewSubjectCanonicalCommit !== generation.canonicalCommit) {
        return fail('conflict', 'rework lineage or version changed');
      }
      if (subjectStage.assignment !== null
        && (subjectAttempt.runtime !== subjectStage.assignment.runtime || subjectAttempt.model !== subjectStage.assignment.model)) {
        return fail('conflict', 'creator attempt routing does not match immutable assignment provenance');
      }
      if (loop.reworksUsed >= loop.maxCreatorReworks) return fail('ineligible', 'creator rework bound is exhausted');
      if (document.humanRequests.some((request) => request.subject === subject && request.runRef === runRef && request.state === 'open'
        && (request.kind === 'approval' || request.kind === 'intervention'))) return fail('ineligible', 'open gate or intervention prevents rework');
      const checkerSession = checkerAttempt.managedSessionRef === null ? undefined : document.sessions.find((session) =>
        session.subject === subject && session.runRef === runRef && session.sessionRef === checkerAttempt.managedSessionRef);
      if (checkerAttempt.managedSessionRef !== null
        && (!checkerSession || checkerSession.attemptRef !== checkerAttempt.attemptRef || checkerSession.state !== 'completed')) {
        return fail('conflict', 'checker session is not completed for the reviewed attempt');
      }
      const createdAt = stamp();
      const successorAttempt: StoredAttempt = {
        subject, attemptRef: ref('attempt'), runRef, stageRef: subjectStage.stageRef,
        generation: Math.max(...document.attempts.filter((attempt) => attempt.stageRef === subjectStage.stageRef).map((attempt) => attempt.generation), 0) + 1,
        predecessorAttemptRef: subjectAttempt.attemptRef,
        // Legacy stages can have a valid observed creator attempt without a persisted
        // assignment. Preserve that exact routing; never invent a replacement model.
        runtime: subjectStage.assignment?.runtime ?? subjectAttempt.runtime,
        model: subjectStage.assignment?.model ?? subjectAttempt.model,
        state: 'queued', version: 1, managedSessionRef: null,
        reviewSubjectGenerationRef: null, reviewSubjectResultHash: null, reviewSubjectCanonicalCommit: null,
        logicalGeneration: nextGeneration, baseGenerationRef: generation.generationRef, baseCommit: generation.canonicalCommit,
        createdAt, updatedAt: createdAt,
      };
      const successor: StoredStageGeneration = {
        subject, operationFingerprint: fingerprint, generationRef: ref('generation'), runRef,
        logicalStageRef: subjectStage.stageRef, logicalStageId: subjectStage.stageId, generation: nextGeneration,
        predecessorGenerationRef: generation.generationRef, attemptRef: successorAttempt.attemptRef,
        canonicalResultOperationKey: null, resultHash: null, resultCardRef: null, baseCommit: null, canonicalCommit: null,
        state: 'queued', createdAt, updatedAt: createdAt,
      };
      document.generationSupersessions.push({ subject, operationFingerprint: fingerprint, runRef, predecessorGenerationRef: generation.generationRef,
        successorGenerationRef: successor.generationRef, failedReviewReceiptRef: receipt.reviewReceiptRef, operationKey: input.idempotencyKey, createdAt });
      document.attempts.push(successorAttempt);
      document.stageGenerations.push(successor);
      subjectStage.currentGeneration = nextGeneration;
      subjectStage.currentGenerationRef = successor.generationRef;
      subjectStage.currentAttemptRef = successorAttempt.attemptRef;
      subjectStage.acceptedGenerationRef = null;
      subjectStage.state = 'ready'; subjectStage.version += 1; subjectStage.updatedAt = createdAt;
      reviewStage.currentAttemptRef = null; reviewStage.state = 'blocked'; reviewStage.version += 1; reviewStage.updatedAt = createdAt;
      loop.reworksUsed += 1; loop.state = 'rework-queued'; loop.activeGenerationRef = successor.generationRef;
      loop.activeReceiptRef = null; loop.acceptedGenerationRef = null; loop.version += 1; loop.updatedAt = createdAt;
      commit(document);
      return ok(publicStageGeneration(successor));
    },

    parkExhaustedReview(subject, runRef, input) {
      if (!validNonEmpty(input.idempotencyKey, MAX_SHORT_TEXT) || !SAFE_REF_RE.test(input.expectedGenerationRef)
        || !SAFE_REF_RE.test(input.expectedFailedReceiptRef) || !SAFE_REF_RE.test(input.expectedSubjectAttemptRef)
        || !SAFE_REF_RE.test(input.expectedCheckerAttemptRef)) return fail('invalid', 'exhausted review identity is invalid');
      const document = load();
      const receipt = document.reviewReceipts.find((item) => item.subject === subject && item.runRef === runRef
        && item.reviewReceiptRef === input.expectedFailedReceiptRef);
      if (!receipt) return fail('not-found', 'failed review receipt was not found');
      const reviewStage = document.stages.find((item) => item.subject === subject && item.runRef === runRef
        && item.stageRef === receipt.reviewStageRef);
      const subjectStage = document.stages.find((item) => item.subject === subject && item.runRef === runRef
        && item.stageRef === receipt.subjectStageRef);
      const receiptGeneration = document.stageGenerations.find((item) => item.subject === subject && item.runRef === runRef
        && item.generationRef === receipt.subjectGenerationRef);
      if (!reviewStage || !subjectStage || !receiptGeneration) return fail('conflict', 'exhausted review lineage is incomplete');
      const operationKey = reviewExhaustedOperationKey(runRef, reviewStage.stageId, receiptGeneration.generation);
      if (input.idempotencyKey !== operationKey) return fail('invalid', 'exhausted review idempotencyKey is not canonical');
      const fingerprint = exhaustedReviewFingerprint(subject, runRef, input);
      const replay = document.humanRequests.find((item) => item.subject === subject && item.runRef === runRef
        && item.operationKey === operationKey);
      if (replay) {
        if (replay.operationFingerprint !== fingerprint) return fail('idempotency-conflict', 'exhausted review idempotencyKey was reused with different content');
        const loop = document.reviewLoops.find((item) => item.subject === subject && item.runRef === runRef
          && item.reviewStageRef === reviewStage.stageRef);
        if (receipt.interventionRequestRef !== replay.requestRef || loop?.interventionRequestRef !== replay.requestRef
          || receipt.state !== 'failed' || loop.state !== 'parked') {
          return fail('conflict', 'exhausted review replay linkage is incomplete');
        }
        return ok({ receipt: publicReviewReceipt(receipt), loop: publicReviewLoop(loop), interventionRequest: publicRequest(replay),
          subjectStage: publicStage(subjectStage), reviewStage: publicStage(reviewStage) }, true);
      }
      const generation = document.stageGenerations.find((item) => item.subject === subject && item.runRef === runRef
        && item.generationRef === input.expectedGenerationRef);
      const loop = document.reviewLoops.find((item) => item.subject === subject && item.runRef === runRef
        && item.reviewStageRef === receipt.reviewStageRef && item.subjectStageRef === receipt.subjectStageRef);
      const subjectAttempt = document.attempts.find((item) => item.subject === subject && item.runRef === runRef
        && item.attemptRef === receiptGeneration.attemptRef);
      const checkerAttempt = document.attempts.find((item) => item.subject === subject && item.runRef === runRef
        && item.attemptRef === receipt.checkerAttemptRef);
      const completedWorkerSession = (attempt: StoredAttempt) => attempt.managedSessionRef === null || document.sessions.some((session) =>
        session.subject === subject && session.runRef === runRef && session.sessionRef === attempt.managedSessionRef
        && session.stageRef === attempt.stageRef && session.attemptRef === attempt.attemptRef
        && session.role === 'worker' && session.state === 'completed',
      );
      if (!generation || !loop || !subjectAttempt || !checkerAttempt
        || subjectStage.version !== input.expectedSubjectStageVersion || reviewStage.version !== input.expectedReviewStageVersion
        || loop.version !== input.expectedLoopVersion || receipt.version !== input.expectedReceiptVersion
        || subjectAttempt.attemptRef !== input.expectedSubjectAttemptRef || subjectAttempt.version !== input.expectedSubjectAttemptVersion
        || checkerAttempt.attemptRef !== input.expectedCheckerAttemptRef || checkerAttempt.version !== input.expectedCheckerAttemptVersion
        || loop.state !== 'failed' || receipt.state !== 'failed' || generation.state !== 'committed'
        || generation.logicalStageRef !== subjectStage.stageRef || generation.generationRef !== receipt.subjectGenerationRef
        || generation.resultHash !== receipt.subjectResultHash || generation.attemptRef !== subjectAttempt.attemptRef
        || subjectStage.currentGenerationRef !== generation.generationRef || subjectStage.currentAttemptRef !== subjectAttempt.attemptRef
        || subjectAttempt.stageRef !== subjectStage.stageRef || subjectAttempt.state !== 'succeeded'
        || subjectStage.state !== 'succeeded' || subjectStage.acceptedGenerationRef !== null
        || reviewStage.currentAttemptRef !== checkerAttempt.attemptRef || reviewStage.state !== 'succeeded' || reviewStage.acceptedGenerationRef !== null
        || checkerAttempt.stageRef !== reviewStage.stageRef || checkerAttempt.state !== 'succeeded'
        || checkerAttempt.reviewSubjectGenerationRef !== generation.generationRef
        || checkerAttempt.reviewSubjectResultHash !== generation.resultHash || checkerAttempt.reviewSubjectCanonicalCommit !== generation.canonicalCommit
        || !completedWorkerSession(subjectAttempt) || !completedWorkerSession(checkerAttempt)
        || receipt.reviewStageRef !== reviewStage.stageRef || receipt.subjectStageRef !== subjectStage.stageRef
        || receipt.completionRequestRef !== null || receipt.interventionRequestRef !== null
        || loop.activeGenerationRef !== generation.generationRef || loop.activeReceiptRef !== receipt.reviewReceiptRef
        || loop.acceptedGenerationRef !== null || loop.interventionRequestRef !== null) {
        return fail('conflict', 'exhausted review lineage or version changed');
      }
      if (loop.reworksUsed > loop.maxCreatorReworks) return fail('conflict', 'creator rework count exceeds its bound');
      if (loop.reworksUsed < loop.maxCreatorReworks) return fail('ineligible', 'creator rework bound is not exhausted');
      if (document.humanRequests.filter((item) => item.subject === subject && item.runRef === runRef).length >= MAX_HUMAN_REQUESTS_PER_RUN) {
        return fail('limit', 'run has reached the Human Request limit');
      }
      if (document.humanRequests.some((item) => item.operationKey === operationKey)) {
        return fail('conflict', 'exhausted review operationKey is already reserved');
      }
      const createdAt = stamp();
      const intervention: StoredHumanRequest = {
        subject, operationKey, operationFingerprint: fingerprint, requestRef: ref('request'), runRef, stageRef: reviewStage.stageRef,
        kind: 'intervention', revision: 1, state: 'open', title: cleanText(`Review intervention: ${reviewStage.title}`, MAX_TITLE),
        prompt: cleanText(`Creator rework bound exhausted: ${receipt.outcome.summary}`, MAX_LONG_TEXT), response: null,
        resolutionOperationFingerprint: null, createdAt, updatedAt: createdAt,
      };
      receipt.interventionRequestRef = intervention.requestRef; receipt.version += 1;
      loop.state = 'parked'; loop.interventionRequestRef = intervention.requestRef; loop.version += 1; loop.updatedAt = createdAt;
      document.humanRequests.push(intervention);
      commit(document);
      return ok({ receipt: publicReviewReceipt(receipt), loop: publicReviewLoop(loop), interventionRequest: publicRequest(intervention),
        subjectStage: publicStage(subjectStage), reviewStage: publicStage(reviewStage) });
    },

    linkStageCard(subject, stageRef, expectedVersion, canonicalCardRef) {
      const document = load();
      const stage = document.stages.find((item) => item.subject === subject && item.stageRef === stageRef);
      if (!stage) return fail('not-found', 'stage was not found');
      if (stage.version !== expectedVersion) return fail('conflict', 'stage version changed');
      if (!validNonEmpty(canonicalCardRef, MAX_SHORT_TEXT) || !SAFE_REF_RE.test(canonicalCardRef)) {
        return fail('invalid', 'canonicalCardRef must be a safe opaque reference');
      }
      if (stage.canonicalCardRef !== null) return fail('conflict', 'stage is already linked to a canonical card');
      stage.canonicalCardRef = canonicalCardRef;
      stage.version += 1;
      stage.updatedAt = stamp();
      commit(document);
      return ok(publicStage(stage));
    },

    createAttempt(subject, stageRef, input) {
      const document = load();
      const stage = document.stages.find((item) => item.subject === subject && item.stageRef === stageRef);
      if (!stage) return fail('not-found', 'stage was not found');
      if (stage.version !== input.expectedStageVersion) return fail('conflict', 'stage version changed');
      if (!validNonEmpty(input.runtime, MAX_SHORT_TEXT) || !validNonEmpty(input.model, MAX_SHORT_TEXT)) return fail('invalid', 'attempt routing is required');
      if (stage.assignment !== null
        && (input.runtime !== stage.assignment.runtime || input.model !== stage.assignment.model)) {
        return fail('invalid', 'attempt routing does not match assigned stage provenance');
      }
      const reviewSubjectGenerationRef = input.reviewSubjectGenerationRef ?? null;
      const reviewSubjectResultHash = input.reviewSubjectResultHash ?? null;
      const reviewSubjectCanonicalCommit = input.reviewSubjectCanonicalCommit ?? null;
      const reviewLoop = loopForReviewStage(document, stage);
      if (reviewLoop) {
        const generation = reviewLoop.activeGenerationRef === null ? undefined : document.stageGenerations.find((item) =>
          item.subject === subject && item.runRef === stage.runRef && item.generationRef === reviewLoop.activeGenerationRef);
        if (reviewLoop.state !== 'checking' || !generation || reviewSubjectGenerationRef !== generation.generationRef
          || reviewSubjectResultHash !== generation.resultHash || reviewSubjectCanonicalCommit !== generation.canonicalCommit) {
          return fail('conflict', 'checker attempt must bind the active committed subject generation');
        }
      } else if (reviewSubjectGenerationRef !== null || reviewSubjectResultHash !== null || reviewSubjectCanonicalCommit !== null) {
        return fail('invalid', 'ordinary attempts cannot carry review generation provenance');
      } else if (!reviewDependenciesAccepted(document, stage)) {
        return fail('invalid', 'stage review dependencies are not accepted');
      }
      const previous = stage.currentAttemptRef
        ? document.attempts.find((item) => item.subject === subject && item.attemptRef === stage.currentAttemptRef)
        : undefined;
      if (previous && !TERMINAL_ATTEMPT.has(previous.state) && previous.state !== 'interrupted') return fail('conflict', 'current attempt is still active');
      const createdAt = stamp();
      const attempt: StoredAttempt = {
        subject,
        attemptRef: ref('attempt'),
        runRef: stage.runRef,
        stageRef,
        generation: (previous?.generation ?? 0) + 1,
        predecessorAttemptRef: previous?.attemptRef ?? null,
        runtime: input.runtime,
        model: input.model,
        state: 'queued',
        version: 1,
        managedSessionRef: null,
        reviewSubjectGenerationRef,
        reviewSubjectResultHash,
        reviewSubjectCanonicalCommit,
        logicalGeneration: loopForSubjectStage(document, stage) ? stage.currentGeneration : null,
        baseGenerationRef: null,
        baseCommit: null,
        createdAt,
        updatedAt: createdAt,
      };
      stage.currentAttemptRef = attempt.attemptRef;
      stage.version += 1;
      stage.updatedAt = createdAt;
      document.attempts.push(attempt);
      commit(document);
      return ok(publicAttempt(attempt));
    },

    rerouteStage(subject, stageRef, input) {
      if (!validNonEmpty(input.idempotencyKey, MAX_SHORT_TEXT)
        || !validNonEmpty(input.runtime, MAX_SHORT_TEXT) || !validNonEmpty(input.model, MAX_SHORT_TEXT)
        || !SAFE_REF_RE.test(input.expectedAttemptRef)
        || !Number.isSafeInteger(input.expectedStageVersion) || input.expectedStageVersion < 1
        || !Number.isSafeInteger(input.expectedAttemptVersion) || input.expectedAttemptVersion < 1) {
        return fail('invalid', 'reroute identity, runtime, model, and idempotencyKey are required');
      }
      const fingerprint = sha256(JSON.stringify({
        stageRef,
        expectedStageVersion: input.expectedStageVersion,
        expectedAttemptRef: input.expectedAttemptRef,
        expectedAttemptVersion: input.expectedAttemptVersion,
        runtime: input.runtime,
        model: input.model,
      }));
      const document = load();
      const replay = document.attempts.find((attempt) =>
        attempt.subject === subject && attempt.stageRef === stageRef && attempt.rerouteOperationKey === input.idempotencyKey,
      );
      if (replay) {
        if (replay.rerouteOperationFingerprint !== fingerprint) {
          return fail('idempotency-conflict', 'idempotencyKey was reused with different reroute content');
        }
        const replayStage = document.stages.find((stage) => stage.subject === subject && stage.stageRef === stageRef);
        const replaySession = document.sessions.find((session) =>
          session.subject === subject && session.sessionRef === replay.managedSessionRef,
        );
        if (!replayStage || !replaySession) return fail('conflict', 'reroute replay projection is incomplete');
        return ok({ stage: publicStage(replayStage), attempt: publicAttempt(replay), session: publicSession(replaySession) }, true);
      }
      const stage = document.stages.find((item) => item.subject === subject && item.stageRef === stageRef);
      if (!stage) return fail('not-found', 'stage was not found');
      if (stage.assignment !== null) {
        return fail('invalid', 'assigned stages cannot reroute; assignment provenance is immutable');
      }
      if (loopForSubjectStage(document, stage)) {
        return fail('invalid', 'loop-managed creator stages cannot reroute outside their generation transaction');
      }
      if (stage.version !== input.expectedStageVersion || stage.currentAttemptRef !== input.expectedAttemptRef) {
        return fail('conflict', 'stage version or current attempt changed');
      }
      if (stage.state !== 'ready' && stage.state !== 'blocked') {
        return fail('invalid', 'only a ready or blocked stage can reroute before execution');
      }
      const run = findRun(document, subject, stage.runRef);
      if (!run || run.publicationState !== 'published' || TERMINAL_RUN.has(run.state) || run.state === 'stopping') {
        return fail('invalid', 'run is not in a published reroutable state');
      }
      if (document.humanRequests.some((request) =>
        request.subject === subject && request.stageRef === stageRef)) {
        return fail('invalid', 'human-gated stages require a plan amendment before rerouting');
      }
      const current = document.attempts.find((attempt) =>
        attempt.subject === subject && attempt.attemptRef === input.expectedAttemptRef && attempt.stageRef === stageRef,
      );
      if (!current || current.version !== input.expectedAttemptVersion) return fail('conflict', 'attempt version changed');
      if (current.state !== 'queued') return fail('invalid', 'only a never-started queued attempt can reroute');
      if (current.runtime === input.runtime && current.model === input.model) return fail('invalid', 'reroute must change runtime or model');
      const currentSession = document.sessions.find((session) =>
        session.subject === subject && session.sessionRef === current.managedSessionRef && session.attemptRef === current.attemptRef,
      );
      if (!currentSession || currentSession.state !== 'pending') {
        return fail('invalid', 'queued attempt session is no longer safely reroutable');
      }
      const createdAt = stamp();
      const attempt: StoredAttempt = {
        subject,
        rerouteOperationKey: input.idempotencyKey,
        rerouteOperationFingerprint: fingerprint,
        attemptRef: ref('attempt'),
        runRef: stage.runRef,
        stageRef,
        generation: current.generation + 1,
        predecessorAttemptRef: current.attemptRef,
        runtime: input.runtime,
        model: input.model,
        state: 'queued',
        version: 1,
        managedSessionRef: null,
        reviewSubjectGenerationRef: current.reviewSubjectGenerationRef,
        reviewSubjectResultHash: current.reviewSubjectResultHash,
        reviewSubjectCanonicalCommit: current.reviewSubjectCanonicalCommit,
        logicalGeneration: current.logicalGeneration,
        baseGenerationRef: current.baseGenerationRef,
        baseCommit: current.baseCommit,
        createdAt,
        updatedAt: createdAt,
      };
      const session: StoredSession = {
        subject,
        operationKey: null,
        operationFingerprint: null,
        sessionRef: ref('session'),
        runRef: stage.runRef,
        stageRef,
        attemptRef: attempt.attemptRef,
        role: 'worker',
        generation: attempt.generation,
        predecessorSessionRef: currentSession.sessionRef,
        runtime: input.runtime,
        model: input.model,
        state: 'pending',
        version: 1,
        createdAt,
        updatedAt: createdAt,
      };
      attempt.managedSessionRef = session.sessionRef;
      current.state = 'stopped';
      current.version += 1;
      current.updatedAt = createdAt;
      currentSession.state = 'stopped';
      currentSession.version += 1;
      currentSession.updatedAt = createdAt;
      stage.currentAttemptRef = attempt.attemptRef;
      stage.version += 1;
      stage.updatedAt = createdAt;
      document.attempts.push(attempt);
      document.sessions.push(session);
      commit(document);
      return ok({ stage: publicStage(stage), attempt: publicAttempt(attempt), session: publicSession(session) });
    },

    transitionAttempt(subject, attemptRef, expectedVersion, state) {
      const document = load();
      const attempt = document.attempts.find((item) => item.subject === subject && item.attemptRef === attemptRef);
      if (!attempt) return fail('not-found', 'attempt was not found');
      if (!ATTEMPT_STATES.has(state)) return fail('invalid', 'attempt state is invalid');
      if (attempt.version !== expectedVersion) return fail('conflict', 'attempt version changed');
      if (attempt.state === state) return ok(publicAttempt(attempt), true);
      if (!ATTEMPT_EDGES[attempt.state].has(state)) {
        return fail('invalid', `attempt transition ${attempt.state}->${state} is not allowed; create a successor attempt when required`);
      }
      attempt.state = state;
      attempt.version += 1;
      attempt.updatedAt = stamp();
      commit(document);
      return ok(publicAttempt(attempt));
    },

    createWorkerSession(subject, attemptRef, input) {
      const document = load();
      const attempt = document.attempts.find((item) => item.subject === subject && item.attemptRef === attemptRef);
      if (!attempt) return fail('not-found', 'attempt was not found');
      if (attempt.version !== input.expectedAttemptVersion) return fail('conflict', 'attempt version changed');
      if (attempt.state !== 'queued') return fail('invalid', 'only a queued attempt can create a managed session');
      if (attempt.managedSessionRef) return fail('conflict', 'attempt already has a managed session');
      const createdAt = stamp();
      const session: StoredSession = {
        subject,
        operationKey: null,
        operationFingerprint: null,
        sessionRef: ref('session'),
        runRef: attempt.runRef,
        stageRef: attempt.stageRef,
        attemptRef: attempt.attemptRef,
        role: 'worker',
        generation: attempt.generation,
        predecessorSessionRef: null,
        runtime: attempt.runtime,
        model: attempt.model,
        state: 'pending',
        version: 1,
        createdAt,
        updatedAt: createdAt,
      };
      attempt.managedSessionRef = session.sessionRef;
      attempt.version += 1;
      attempt.updatedAt = createdAt;
      document.sessions.push(session);
      commit(document);
      return ok(publicSession(session));
    },

    transitionSession(subject, sessionRef, expectedVersion, state) {
      const document = load();
      const session = document.sessions.find((item) => item.subject === subject && item.sessionRef === sessionRef);
      if (!session) return fail('not-found', 'managed session was not found');
      if (!SESSION_STATES.has(state)) return fail('invalid', 'managed session state is invalid');
      if (session.version !== expectedVersion) return fail('conflict', 'managed session version changed');
      if (session.state === state) return ok(publicSession(session), true);
      if (!SESSION_EDGES[session.state].has(state)) return fail('invalid', `managed session transition ${session.state}->${state} is not allowed`);
      if (session.state === 'waiting' && state === 'running'
        && !boundariesAccepted(document, subject, session.runRef, session.stageRef ?? undefined)) {
        return fail('invalid', 'waiting managed-session boundaries are unresolved or not accepted');
      }
      session.state = state;
      session.version += 1;
      session.updatedAt = stamp();
      commit(document);
      return ok(publicSession(session));
    },

    createManagerSuccessor(subject, runRef, input) {
      const document = load();
      const run = findRun(document, subject, runRef);
      if (!run) return fail('not-found', 'run was not found');
      if (TERMINAL_RUN.has(run.state)) return fail('invalid', 'terminal runs require a successor run, not a Manager replacement');
      if (!validNonEmpty(input.idempotencyKey, MAX_SHORT_TEXT) || !validNonEmpty(input.runtime, MAX_SHORT_TEXT) || !validNonEmpty(input.model, MAX_SHORT_TEXT)) {
        return fail('invalid', 'successor routing and idempotencyKey are required');
      }
      if (run.managerAssignment !== null
        && (input.runtime !== run.managerAssignment.runtime || input.model !== run.managerAssignment.model)) {
        return fail('invalid', 'assigned manager routing is immutable');
      }
      const fingerprint = sha256(JSON.stringify({ runRef, expected: input.expectedManagerGeneration, runtime: input.runtime, model: input.model }));
      const replay = document.sessions.find((item) => item.subject === subject && item.runRef === runRef && item.role === 'manager' && item.operationKey === input.idempotencyKey);
      if (replay) {
        if (replay.operationFingerprint !== fingerprint) return fail('idempotency-conflict', 'idempotencyKey was reused with different successor content');
        return ok(publicSession(replay), true);
      }
      if (run.managerGeneration !== input.expectedManagerGeneration) return fail('conflict', 'manager generation changed');
      const current = document.sessions.find((item) => item.subject === subject && item.sessionRef === run.managerSessionRef);
      if (!current) return fail('conflict', 'current manager session is missing');
      if (!TERMINAL_SESSION.has(current.state) && current.state !== 'interrupted') return fail('conflict', 'current manager session is still active');
      if (run.state !== 'recovering' && !RUN_EDGES[run.state].has('recovering')) {
        return fail('invalid', `run transition ${run.state}->recovering is not allowed`);
      }
      const createdAt = stamp();
      const session: StoredSession = {
        subject,
        operationKey: input.idempotencyKey,
        operationFingerprint: fingerprint,
        sessionRef: ref('session'),
        runRef,
        stageRef: null,
        attemptRef: null,
        role: 'manager',
        generation: run.managerGeneration + 1,
        predecessorSessionRef: current.sessionRef,
        runtime: input.runtime,
        model: input.model,
        state: 'pending',
        version: 1,
        createdAt,
        updatedAt: createdAt,
      };
      run.managerSessionRef = session.sessionRef;
      run.managerGeneration = session.generation;
      // A replacement Manager may rehydrate while a boundary is open, but recovery cannot release it.
      if (run.state !== 'waiting-human') run.state = 'recovering';
      run.version += 1;
      run.updatedAt = createdAt;
      document.sessions.push(session);
      commit(document);
      return ok(publicSession(session));
    },

    recordManagerCommand(subject, runRef, input) {
      const document = load();
      const run = findRun(document, subject, runRef);
      if (!run) return fail('not-found', 'run was not found');
      if (!validNonEmpty(input.idempotencyKey, MAX_SHORT_TEXT) || !['message', 'steer', 'stop'].includes(input.kind)) {
        return fail('invalid', 'manager command and idempotencyKey are required');
      }
      const message = input.message == null ? null : cleanText(input.message, MAX_LONG_TEXT);
      const checkpoint = input.checkpoint == null ? null : cleanText(input.checkpoint, MAX_SHORT_TEXT);
      if (input.kind === 'message' && !validNonEmpty(message, MAX_LONG_TEXT)) return fail('invalid', 'manager message is required');
      if (input.kind === 'steer' && (!validNonEmpty(message, MAX_LONG_TEXT) || !validNonEmpty(checkpoint, MAX_SHORT_TEXT))) {
        return fail('invalid', 'checkpoint and steering instruction are required');
      }
      const fingerprint = sha256(JSON.stringify({
        runRef,
        expectedRunVersion: input.expectedRunVersion,
        expectedManagerGeneration: input.expectedManagerGeneration,
        kind: input.kind,
        message,
        checkpoint,
      }));
      const replay = document.events.find((item) =>
        item.subject === subject && item.runRef === runRef && item.operationKey === input.idempotencyKey,
      );
      if (replay) {
        if (replay.operationFingerprint !== fingerprint) {
          return fail('idempotency-conflict', 'idempotencyKey was reused with different manager command content');
        }
        return ok({ run: publicRun(run), event: publicEvent(replay) }, true);
      }
      if (run.version !== input.expectedRunVersion || run.managerGeneration !== input.expectedManagerGeneration) {
        return fail('conflict', 'run version or manager generation changed');
      }
      if (TERMINAL_RUN.has(run.state)) return fail('invalid', 'terminal runs cannot accept manager commands');
      const manager = document.sessions.find((item) =>
        item.subject === subject && item.sessionRef === run.managerSessionRef && item.role === 'manager',
      );
      if (!manager) return fail('conflict', 'current manager session is missing');
      const createdAt = stamp();
      const event: StoredEvent = {
        subject,
        operationKey: input.idempotencyKey,
        operationFingerprint: fingerprint,
        cursor: document.nextEventCursor,
        runRef,
        kind: input.kind === 'message' ? 'message' : input.kind === 'steer' ? 'checkpoint' : 'lifecycle',
        source: 'human',
        stageRef: null,
        attemptRef: null,
        sessionRef: manager.sessionRef,
        status: input.kind === 'stop' ? 'stopped' : 'pending',
        summary: input.kind === 'stop' ? 'operator requested Manager stop' : message,
        command: null,
        toolName: null,
        path: null,
        diff: null,
        checkpoint: input.kind === 'steer' ? checkpoint : null,
        createdAt,
      };
      document.nextEventCursor += 1;
      document.events.push(event);
      if (input.kind === 'stop') {
        if (run.state !== 'stopping' && !RUN_EDGES[run.state].has('stopping')) {
          return fail('invalid', `run transition ${run.state}->stopping is not allowed`);
        }
        run.state = 'stopping';
        run.version += 1;
        run.updatedAt = createdAt;
      }
      commit(document);
      return ok({ run: publicRun(run), event: publicEvent(event) });
    },

    requestRunCancellation(subject, runRef, input) {
      const document = load();
      const run = findRun(document, subject, runRef);
      if (!run) return fail('not-found', 'run was not found');
      if (!validNonEmpty(input.idempotencyKey, MAX_SHORT_TEXT) || !validNonEmpty(input.reason, MAX_LONG_TEXT)) {
        return fail('invalid', 'cancellation idempotencyKey and reason are required');
      }
      const reason = cleanText(input.reason, MAX_LONG_TEXT);
      const fingerprint = sha256(JSON.stringify({ runRef, reason }));
      const replay = document.events.find((event) =>
        event.subject === subject && event.runRef === runRef && event.operationKey === input.idempotencyKey,
      );
      if (replay) {
        if (replay.operationFingerprint !== fingerprint) {
          return fail('idempotency-conflict', 'cancellation idempotencyKey was reused with different content');
        }
        return ok({ run: publicRun(run), event: publicEvent(replay) }, true);
      }
      if (run.version !== input.expectedRunVersion) return fail('conflict', 'run version changed');
      if (run.state !== 'stopping' && !RUN_EDGES[run.state].has('stopping')) {
        return fail('invalid', `run transition ${run.state}->stopping is not allowed`);
      }
      const createdAt = stamp();
      const event: StoredEvent = {
        subject,
        operationKey: input.idempotencyKey,
        operationFingerprint: fingerprint,
        cursor: document.nextEventCursor,
        runRef,
        kind: 'lifecycle',
        source: 'human',
        stageRef: null,
        attemptRef: null,
        sessionRef: null,
        status: 'waiting',
        summary: cleanText(`run cancellation requested: ${reason}`, MAX_LONG_TEXT),
        command: null,
        toolName: null,
        path: null,
        diff: null,
        checkpoint: null,
        createdAt,
      };
      document.nextEventCursor += 1;
      document.events.push(event);
      if (run.state !== 'stopping') {
        run.state = 'stopping';
        run.version += 1;
        run.updatedAt = createdAt;
      }
      commit(document);
      return ok({ run: publicRun(run), event: publicEvent(event) });
    },

    brokerReserveStart(subject, input) {
      const safeSpec: ManagedStartSpec = {
        runRef: input.spec.runRef,
        sessionRef: input.spec.sessionRef,
        role: input.spec.role,
        profileId: input.spec.profileId,
        approvedPrompt: input.spec.approvedPrompt,
      };
      if (!validNonEmpty(subject, MAX_SHORT_TEXT) || !validNonEmpty(input.idempotencyKey, MAX_SHORT_TEXT)
        || !SAFE_REF_RE.test(safeSpec.runRef) || !SAFE_REF_RE.test(safeSpec.sessionRef)
        || !validNonEmpty(safeSpec.profileId, MAX_SHORT_TEXT) || !validNonEmpty(safeSpec.approvedPrompt, MAX_LONG_TEXT)
        || redactSensitiveText(safeSpec.approvedPrompt) !== safeSpec.approvedPrompt) {
        throw new Error('invalid managed session start reservation');
      }
      const document = load();
      const session = findSession(document, subject, safeSpec.runRef, safeSpec.sessionRef);
      if (!session || session.role !== safeSpec.role) throw new Error('managed session was not found for this subject and role');
      const fingerprint = brokerFingerprint('start', {
        runRef: safeSpec.runRef,
        sessionRef: safeSpec.sessionRef,
        role: safeSpec.role,
        profileId: safeSpec.profileId,
        approvedPromptHash: sha256(safeSpec.approvedPrompt),
      });
      const prior = findBrokerReceipt(session, 'start', input.idempotencyKey, fingerprint);
      if (prior) return { status: prior.status as 'reserved' | 'already-active', revision: prior.revision };
      const createdAt = stamp();
      if (session.state !== 'pending' && session.state !== 'interrupted') {
        pushBrokerReceipt(session, {
          kind: 'start', idempotencyKey: input.idempotencyKey, fingerprint,
          revision: session.version, status: 'already-active', instructions: [], createdAt,
        });
        commit(document);
        return { status: 'already-active', revision: session.version };
      }
      session.state = 'running';
      session.version += 1;
      session.updatedAt = createdAt;
      session.brokerProfileId = safeSpec.profileId;
      session.brokerApprovedPromptHash = sha256(safeSpec.approvedPrompt);
      session.brokerStopRequested = false;
      appendBrokerEvent(document, session, {
        kind: 'lifecycle', source: 'system', status: 'running', summary: `${session.role} managed session started`,
      }, createdAt);
      pushBrokerReceipt(session, {
        kind: 'start', idempotencyKey: input.idempotencyKey, fingerprint,
        revision: session.version, status: 'reserved', instructions: [], createdAt,
      });
      commit(document);
      return { status: 'reserved', revision: session.version };
    },

    brokerAppendEvent(subject, input) {
      if (!validNonEmpty(input.idempotencyKey, MAX_SHORT_TEXT)) throw new Error('broker event idempotencyKey is required');
      const document = load();
      const session = findSession(document, subject, input.runRef, input.sessionRef);
      if (!session) throw new Error('managed session was not found for this subject');
      const fingerprint = brokerFingerprint('event', input.event);
      if (findBrokerReceipt(session, 'event', input.idempotencyKey, fingerprint)) return;
      if (session.state !== 'running' && session.state !== 'waiting') throw new Error('managed session is not active');
      const createdAt = stamp();
      appendBrokerEvent(document, session, brokerPublicEvent(session, input.event), createdAt);
      pushBrokerReceipt(session, {
        kind: 'event', idempotencyKey: input.idempotencyKey, fingerprint,
        revision: session.version, status: 'applied', instructions: [], createdAt,
      });
      commit(document);
    },

    brokerCompleteSession(subject, input) {
      if (!validNonEmpty(input.idempotencyKey, MAX_SHORT_TEXT) || !['completed', 'failed', 'stopped'].includes(input.state)) {
        throw new Error('invalid managed session completion');
      }
      const terminalDetail = input.detail == null ? null : cleanText(input.detail, MAX_LONG_TEXT);
      const document = load();
      const session = findSession(document, subject, input.runRef, input.sessionRef);
      if (!session) throw new Error('managed session was not found for this subject');
      const fingerprint = brokerFingerprint('complete', {
        runRef: input.runRef, sessionRef: input.sessionRef, state: input.state, detail: terminalDetail,
      });
      const prior = findBrokerReceipt(session, 'complete', input.idempotencyKey, fingerprint);
      if (prior) return replayBrokerMutation(prior);
      const createdAt = stamp();
      if (session.state !== 'running' && session.state !== 'waiting') {
        pushBrokerReceipt(session, {
          kind: 'complete', idempotencyKey: input.idempotencyKey, fingerprint,
          revision: session.version, status: 'inactive', instructions: [], createdAt,
        });
        commit(document);
        return { status: 'inactive', revision: session.version };
      }
      if (session.version !== input.expectedRevision) {
        pushBrokerReceipt(session, {
          kind: 'complete', idempotencyKey: input.idempotencyKey, fingerprint,
          revision: session.version, status: 'conflict', instructions: [], createdAt,
        });
        commit(document);
        return { status: 'conflict', revision: session.version };
      }
      session.state = input.state;
      session.version += 1;
      session.updatedAt = createdAt;
      session.brokerStopRequested = false;
      appendBrokerEvent(document, session, {
        kind: 'lifecycle', source: 'system',
        status: input.state === 'completed' ? 'success' : input.state === 'failed' ? 'failure' : 'stopped',
        summary: terminalDetail ?? `${session.role} managed session ${input.state}`,
      }, createdAt);
      pushBrokerReceipt(session, {
        kind: 'complete', idempotencyKey: input.idempotencyKey, fingerprint,
        revision: session.version, status: 'applied', instructions: [], createdAt,
      });
      commit(document);
      return { status: 'applied', revision: session.version };
    },

    brokerRequestStop(subject, input) {
      if (!validNonEmpty(input.idempotencyKey, MAX_SHORT_TEXT)) throw new Error('broker stop idempotencyKey is required');
      const document = load();
      const session = findSession(document, subject, input.runRef, input.sessionRef);
      if (!session) throw new Error('managed session was not found for this subject');
      const fingerprint = brokerFingerprint('stop', { runRef: input.runRef, sessionRef: input.sessionRef });
      const prior = findBrokerReceipt(session, 'stop', input.idempotencyKey, fingerprint);
      if (prior) return replayBrokerMutation(prior);
      const createdAt = stamp();
      if (session.state !== 'running' && session.state !== 'waiting') {
        pushBrokerReceipt(session, {
          kind: 'stop', idempotencyKey: input.idempotencyKey, fingerprint,
          revision: session.version, status: 'inactive', instructions: [], createdAt,
        });
        commit(document);
        return { status: 'inactive', revision: session.version };
      }
      if (session.version !== input.expectedRevision) {
        pushBrokerReceipt(session, {
          kind: 'stop', idempotencyKey: input.idempotencyKey, fingerprint,
          revision: session.version, status: 'conflict', instructions: [], createdAt,
        });
        commit(document);
        return { status: 'conflict', revision: session.version };
      }
      if (!session.brokerStopRequested) {
        session.brokerStopRequested = true;
        session.version += 1;
        session.updatedAt = createdAt;
        appendBrokerEvent(document, session, {
          kind: 'lifecycle', source: 'human', status: 'waiting', summary: 'operator requested managed session stop',
        }, createdAt);
      }
      pushBrokerReceipt(session, {
        kind: 'stop', idempotencyKey: input.idempotencyKey, fingerprint,
        revision: session.version, status: 'applied', instructions: [], createdAt,
      });
      commit(document);
      return { status: 'applied', revision: session.version };
    },

    brokerEnqueueSteering(subject, input) {
      const checkpoint = input.checkpoint == null ? null : input.checkpoint.trim();
      const instruction = input.instruction.trim();
      if (!validNonEmpty(input.idempotencyKey, MAX_SHORT_TEXT) || !validNonEmpty(input.instructionRef, MAX_SHORT_TEXT)
        || !validNonEmpty(instruction, 16_000) || (checkpoint !== null && !validNonEmpty(checkpoint, 128))
        || redactSensitiveText(instruction) !== instruction) {
        throw new Error('invalid managed session steering instruction');
      }
      const document = load();
      const session = findSession(document, subject, input.runRef, input.sessionRef);
      if (!session) throw new Error('managed session was not found for this subject');
      const fingerprint = brokerFingerprint('enqueue', {
        runRef: input.runRef, sessionRef: input.sessionRef, instructionRef: input.instructionRef,
        instruction, checkpoint,
      });
      const prior = findBrokerReceipt(session, 'enqueue', input.idempotencyKey, fingerprint);
      if (prior) return replayBrokerMutation(prior);
      const createdAt = stamp();
      if (session.state !== 'running' && session.state !== 'waiting') {
        pushBrokerReceipt(session, {
          kind: 'enqueue', idempotencyKey: input.idempotencyKey, fingerprint,
          revision: session.version, status: 'inactive', instructions: [], createdAt,
        });
        commit(document);
        return { status: 'inactive', revision: session.version };
      }
      if (session.version !== input.expectedRevision) {
        pushBrokerReceipt(session, {
          kind: 'enqueue', idempotencyKey: input.idempotencyKey, fingerprint,
          revision: session.version, status: 'conflict', instructions: [], createdAt,
        });
        commit(document);
        return { status: 'conflict', revision: session.version };
      }
      const { steering } = brokerState(session);
      if (steering.length >= MAX_STEERING_INSTRUCTIONS_PER_SESSION) {
        throw new ControlStoreLimitError(`managed session has reached the ${MAX_STEERING_INSTRUCTIONS_PER_SESSION} steering instruction limit`);
      }
      if (steering.some((item) => item.instructionRef === input.instructionRef)) {
        throw new Error('instructionRef is already queued under a different operation');
      }
      steering.push({ instructionRef: input.instructionRef, instruction, checkpoint, enqueuedAt: createdAt });
      session.version += 1;
      session.updatedAt = createdAt;
      appendBrokerEvent(document, session, {
        kind: 'checkpoint', source: 'human', status: 'pending', summary: instruction, checkpoint,
      }, createdAt);
      pushBrokerReceipt(session, {
        kind: 'enqueue', idempotencyKey: input.idempotencyKey, fingerprint,
        revision: session.version, status: 'applied', instructions: [], createdAt,
      });
      commit(document);
      return { status: 'applied', revision: session.version };
    },

    brokerConsumeSteering(subject, input) {
      const checkpoint = input.checkpoint.trim();
      if (!validNonEmpty(input.idempotencyKey, MAX_SHORT_TEXT) || !validNonEmpty(checkpoint, 128)) {
        throw new Error('checkpoint and idempotencyKey are required');
      }
      const document = load();
      const session = findSession(document, subject, input.runRef, input.sessionRef);
      if (!session) throw new Error('managed session was not found for this subject');
      const fingerprint = brokerFingerprint('consume', { runRef: input.runRef, sessionRef: input.sessionRef, checkpoint });
      const prior = findBrokerReceipt(session, 'consume', input.idempotencyKey, fingerprint);
      if (prior) return { ...replayBrokerMutation(prior), instructions: [...prior.instructions] };
      const createdAt = stamp();
      if (session.state !== 'running' && session.state !== 'waiting') {
        pushBrokerReceipt(session, {
          kind: 'consume', idempotencyKey: input.idempotencyKey, fingerprint,
          revision: session.version, status: 'inactive', instructions: [], createdAt,
        });
        commit(document);
        return { status: 'inactive', revision: session.version, instructions: [] };
      }
      if (session.version !== input.expectedRevision) {
        pushBrokerReceipt(session, {
          kind: 'consume', idempotencyKey: input.idempotencyKey, fingerprint,
          revision: session.version, status: 'conflict', instructions: [], createdAt,
        });
        commit(document);
        return { status: 'conflict', revision: session.version, instructions: [] };
      }
      const { steering } = brokerState(session);
      const consumed = steering.filter((item) => item.checkpoint === null || item.checkpoint === checkpoint);
      session.brokerSteering = steering.filter((item) => item.checkpoint !== null && item.checkpoint !== checkpoint);
      const instructions = consumed.map((item) => item.instruction);
      session.version += 1;
      session.updatedAt = createdAt;
      appendBrokerEvent(document, session, {
        kind: 'checkpoint', source: 'manager', status: 'success',
        summary: `safe checkpoint reached; ${instructions.length} steering instruction(s) released`, checkpoint,
      }, createdAt);
      pushBrokerReceipt(session, {
        kind: 'consume', idempotencyKey: input.idempotencyKey, fingerprint,
        revision: session.version, status: 'applied', instructions: [...instructions], createdAt,
      });
      commit(document);
      return { status: 'applied', revision: session.version, instructions };
    },

    brokerInterruptResidue(subject, input) {
      if (!validNonEmpty(input.idempotencyKey, MAX_SHORT_TEXT)) throw new Error('recovery idempotencyKey is required');
      const document = load();
      const session = findSession(document, subject, input.runRef, input.sessionRef);
      if (!session) throw new Error('managed session was not found for this subject');
      const fingerprint = brokerFingerprint('interrupt', { runRef: input.runRef, sessionRef: input.sessionRef });
      const prior = findBrokerReceipt(session, 'interrupt', input.idempotencyKey, fingerprint);
      if (prior) return replayBrokerMutation(prior);
      const createdAt = stamp();
      if (session.state !== 'starting' && session.state !== 'running' && session.state !== 'waiting') {
        pushBrokerReceipt(session, {
          kind: 'interrupt', idempotencyKey: input.idempotencyKey, fingerprint,
          revision: session.version, status: 'inactive', instructions: [], createdAt,
        });
        commit(document);
        return { status: 'inactive', revision: session.version };
      }
      session.state = 'interrupted';
      session.version += 1;
      session.updatedAt = createdAt;
      session.brokerStopRequested = false;
      appendBrokerEvent(document, session, {
        kind: 'lifecycle', source: 'system', status: 'interrupted', summary: 'daemon restart interrupted managed session ownership',
      }, createdAt);
      pushBrokerReceipt(session, {
        kind: 'interrupt', idempotencyKey: input.idempotencyKey, fingerprint,
        revision: session.version, status: 'applied', instructions: [], createdAt,
      });
      commit(document);
      return { status: 'applied', revision: session.version };
    },

    getHumanRequest(subject, requestRef) {
      const request = load().humanRequests.find((item) => item.subject === subject && item.requestRef === requestRef);
      return request ? ok(publicRequest(request)) : fail('not-found', 'Human Request was not found');
    },

    createHumanRequest(subject, runRef, input) {
      const document = load();
      const run = findRun(document, subject, runRef);
      if (!run) return fail('not-found', 'run was not found');
      if (document.humanRequests.filter((item) => item.subject === subject && item.runRef === runRef).length >= MAX_HUMAN_REQUESTS_PER_RUN) {
        return fail('limit', 'run has reached the Human Request limit');
      }
      if (!validNonEmpty(input.title, MAX_TITLE) || !validNonEmpty(input.prompt, MAX_LONG_TEXT)) return fail('invalid', 'Human Request title and prompt are required');
      const stageRef = input.stageRef ?? null;
      if (stageRef && !document.stages.some((item) => item.subject === subject && item.runRef === runRef && item.stageRef === stageRef)) {
        return fail('invalid', 'Human Request stageRef does not belong to this run');
      }
      if (!HUMAN_REQUEST_KINDS.has(input.kind)) return fail('invalid', 'Human Request kind is invalid');
      const createdAt = stamp();
      const request: StoredHumanRequest = {
        subject,
        requestRef: ref('request'),
        runRef,
        stageRef,
        kind: input.kind,
        revision: 1,
        state: 'open',
        title: cleanText(input.title, MAX_TITLE),
        prompt: cleanText(input.prompt, MAX_LONG_TEXT),
        response: null,
        resolutionOperationFingerprint: null,
        createdAt,
        updatedAt: createdAt,
      };
      document.humanRequests.push(request);
      commit(document);
      return ok(publicRequest(request));
    },

    createHumanRequests(subject, runRef, input) {
      const document = load();
      const run = findRun(document, subject, runRef);
      if (!run) return fail('not-found', 'run was not found');
      if (!validNonEmpty(input.idempotencyKey, MAX_SHORT_TEXT) || !Array.isArray(input.requests) || input.requests.length === 0) {
        return fail('invalid', 'idempotencyKey and a non-empty Human Request batch are required');
      }
      if (input.idempotencyKey.startsWith('review-gate:') || input.idempotencyKey.startsWith('review-intervention:')
        || input.idempotencyKey.startsWith('review-exhausted:')) {
        return fail('invalid', 'review request operation namespaces are reserved');
      }
      const fingerprint = sha256(JSON.stringify(input.requests));
      const replay = document.humanRequests.filter((item) =>
        item.subject === subject && item.runRef === runRef && item.operationKey === input.idempotencyKey,
      );
      if (replay.length > 0) {
        if (replay.some((item) => item.operationFingerprint !== fingerprint) || replay.length !== input.requests.length) {
          return fail('idempotency-conflict', 'idempotencyKey was reused with different Human Request content');
        }
        return ok(replay.map(publicRequest), true);
      }
      const existingCount = document.humanRequests.filter((item) => item.subject === subject && item.runRef === runRef).length;
      if (existingCount + input.requests.length > MAX_HUMAN_REQUESTS_PER_RUN) {
        return fail('limit', 'run has reached the Human Request limit');
      }
      for (const request of input.requests) {
        if (!validNonEmpty(request.title, MAX_TITLE) || !validNonEmpty(request.prompt, MAX_LONG_TEXT)
          || !HUMAN_REQUEST_KINDS.has(request.kind)) {
          return fail('invalid', 'every Human Request requires a valid kind, title, and prompt');
        }
        const stageRef = request.stageRef ?? null;
        if (stageRef && !document.stages.some((item) =>
          item.subject === subject && item.runRef === runRef && item.stageRef === stageRef,
        )) return fail('invalid', 'Human Request stageRef does not belong to this run');
      }
      const createdAt = stamp();
      const requests: StoredHumanRequest[] = input.requests.map((request) => ({
        subject,
        operationKey: input.idempotencyKey,
        operationFingerprint: fingerprint,
        requestRef: ref('request'),
        runRef,
        stageRef: request.stageRef ?? null,
        kind: request.kind,
        revision: 1,
        state: 'open',
        title: cleanText(request.title, MAX_TITLE),
        prompt: cleanText(request.prompt, MAX_LONG_TEXT),
        response: null,
        resolutionOperationFingerprint: null,
        createdAt,
        updatedAt: createdAt,
      }));
      document.humanRequests.push(...requests);
      commit(document);
      return ok(requests.map(publicRequest));
    },

    reviseHumanRequest(subject, requestRef, expectedRevision, title, prompt) {
      const document = load();
      const request = document.humanRequests.find((item) => item.subject === subject && item.requestRef === requestRef);
      if (!request) return fail('not-found', 'Human Request was not found');
      if (isReviewLinkedRequest(document, requestRef)) {
        return fail('invalid', 'review-linked Human Requests are resolved only by the review gate resolver');
      }
      if (request.legacyRecoveryOperationKey != null) {
        return fail('invalid', 'the authorized legacy recovery receipt is immutable');
      }
      if (request.revision !== expectedRevision) return fail('conflict', 'Human Request revision changed');
      if (request.state !== 'open' || request.response) return fail('conflict', 'resolved Human Requests are immutable');
      if (!validNonEmpty(title, MAX_TITLE) || !validNonEmpty(prompt, MAX_LONG_TEXT)) return fail('invalid', 'Human Request title and prompt are required');
      request.title = cleanText(title, MAX_TITLE);
      request.prompt = cleanText(prompt, MAX_LONG_TEXT);
      request.revision += 1;
      request.updatedAt = stamp();
      commit(document);
      return ok(publicRequest(request));
    },

    preflightAuthorized20260731ExecutionLock(subject, input) {
      return classifyAuthorized20260731ExecutionLock(load(), subject, input);
    },

    recoverAuthorized20260731ExecutionLock(subject, input) {
      const document = load();
      const classified = classifyAuthorized20260731ExecutionLock(document, subject, input);
      if (!classified.ok) return classified;
      if (classified.value.disposition === 'replay') return ok(classified.value.result, true);
      const run = findRun(document, subject, AUTHORIZED_20260731_EXECUTION_LOCK_RUN_REF);
      const request = document.humanRequests.find((item) => item.subject === subject
        && item.requestRef === AUTHORIZED_20260731_EXECUTION_LOCK_REQUEST_REF);
      if (!run || !request) return fail('conflict', 'the eligible legacy execution-lock boundary disappeared');
      if (document.events.filter((item) => item.subject === subject && item.runRef === run.runRef).length >= maxEvents) {
        return fail('limit', 'run has reached the operational event limit');
      }
      const recoveredAt = stamp();
      const event: StoredEvent = {
        subject,
        cursor: document.nextEventCursor,
        runRef: run.runRef,
        kind: 'governance',
        source: 'human',
        stageRef: null,
        attemptRef: null,
        sessionRef: null,
        status: 'success',
        summary: 'authorized 2026-07-31 execution-lock boundary reclassified to intervention',
        command: null,
        toolName: null,
        path: null,
        diff: null,
        checkpoint: null,
        createdAt: recoveredAt,
      };
      request.kind = 'intervention';
      request.title = AUTHORIZED_20260731_EXECUTION_LOCK_TITLE;
      request.prompt = AUTHORIZED_20260731_EXECUTION_LOCK_NEW_PROMPT;
      request.revision += 1;
      request.updatedAt = recoveredAt;
      request.legacyRecoveryOperationKey = input.idempotencyKey;
      request.legacyRecoveryOperationFingerprint = authorized20260731RecoveryFingerprint(input);
      request.legacyRecoveryEventCursor = event.cursor;
      document.nextEventCursor += 1;
      document.events.push(event);
      commit(document);
      return ok({ request: publicRequest(request), event: publicEvent(event) });
    },

    preflightAuthorized20260801FailedRunReconciliation(subject, input) {
      return classifyAuthorized20260801FailedRun(load(), subject, input);
    },

    claimAuthorized20260801FailedRunReconciliation(subject, input) {
      const document = load();
      const classified = classifyAuthorized20260801FailedRun(document, subject, input);
      if (!classified.ok) return classified;
      if (classified.value.disposition === 'replay' || classified.value.disposition === 'claimed') {
        return ok(classified.value.receipt, true);
      }
      const run = findRun(document, subject, AUTHORIZED_20260801_FAILED_RUN_REF);
      if (!run) return fail('conflict', 'the eligible failed run disappeared');
      const claimedAt = stamp();
      const receipt: StoredAuthorizedFailedRunReconciliation = {
        idempotencyKey: input.idempotencyKey,
        fingerprint: authorized20260801FailedRunFingerprint(input),
        phase: 'claimed',
        claimedAt,
        updatedAt: claimedAt,
        canonicalCommit: null,
        eventCursor: null,
      };
      run.authorizedFailedRunReconciliation = receipt;
      commit(document);
      return ok(publicAuthorizedFailedRunReceipt(receipt));
    },

    commitAuthorized20260801FailedRunReconciliation(subject, input, canonicalCommit) {
      if (!/^[a-f0-9]{40}$/.test(canonicalCommit)) return fail('invalid', 'the exact canonical ops commit is required');
      const document = load();
      const classified = classifyAuthorized20260801FailedRun(document, subject, input);
      if (!classified.ok) return classified;
      if (classified.value.disposition === 'replay') return ok(classified.value.result, true);
      if (classified.value.disposition !== 'claimed') {
        return fail('conflict', 'failed-run reconciliation must be claimed before canonical commit');
      }
      const run = findRun(document, subject, AUTHORIZED_20260801_FAILED_RUN_REF);
      const receipt = run?.authorizedFailedRunReconciliation;
      if (!run || !receipt || receipt.phase !== 'claimed') {
        return fail('conflict', 'the claimed failed-run reconciliation disappeared');
      }
      if (document.events.filter((event) => event.subject === subject && event.runRef === run.runRef).length >= maxEvents) {
        return fail('limit', 'run has reached the operational event limit');
      }
      const reconciledAt = stamp();
      for (const expected of AUTHORIZED_20260801_FAILED_RUN_STAGES) {
        if (expected.stageId === 'idea') continue;
        const stage = document.stages.find((candidate) => candidate.subject === subject && candidate.stageRef === expected.stageRef);
        const attempt = document.attempts.find((candidate) => candidate.subject === subject && candidate.attemptRef === expected.attemptRef);
        const session = document.sessions.find((candidate) => candidate.subject === subject && candidate.sessionRef === expected.sessionRef);
        if (!stage || !attempt || !session) return fail('conflict', `failed-run reconciliation chain '${expected.stageId}' disappeared`);
        stage.state = 'stopped'; stage.version = 4; stage.updatedAt = reconciledAt;
        attempt.state = 'stopped'; attempt.version = 3; attempt.updatedAt = reconciledAt;
        session.state = 'stopped'; session.version = 2; session.updatedAt = reconciledAt;
      }
      // Allocate from the global counter rather than pinning cursor 6: an unrelated run's event may
      // legitimately have taken it while this settlement was claimed, and rewinding the counter would
      // hand the same cursor out twice.
      const event: StoredEvent = {
        subject,
        cursor: document.nextEventCursor,
        runRef: run.runRef,
        kind: 'governance',
        source: 'human',
        stageRef: null,
        attemptRef: null,
        sessionRef: null,
        status: 'success',
        summary: AUTHORIZED_20260801_RECONCILIATION_SUMMARY,
        command: null,
        toolName: null,
        path: null,
        diff: null,
        checkpoint: null,
        createdAt: reconciledAt,
      };
      run.version = 8;
      run.updatedAt = reconciledAt;
      receipt.phase = 'committed';
      receipt.updatedAt = reconciledAt;
      receipt.canonicalCommit = canonicalCommit;
      receipt.eventCursor = event.cursor;
      document.events.push(event);
      document.nextEventCursor = event.cursor + 1;
      commit(document);
      return ok({
        run: publicRun(run),
        event: publicEvent(event),
        receipt: publicAuthorizedFailedRunReceipt(receipt),
      });
    },

    respondHumanRequest(subject, requestRef, input) {
      const document = load();
      const request = document.humanRequests.find((item) => item.subject === subject && item.requestRef === requestRef);
      if (!request) return fail('not-found', 'Human Request was not found');
      if (isReviewLinkedRequest(document, requestRef)) {
        return fail('invalid', 'review-linked Human Requests are resolved only by the review gate resolver');
      }
      if (!validNonEmpty(input.idempotencyKey, MAX_SHORT_TEXT)) return fail('invalid', 'idempotencyKey is required');
      if (!HUMAN_DECISIONS.has(input.decision)) return fail('invalid', 'Human Request decision is invalid');
      const response = input.response == null ? null : cleanText(input.response, MAX_LONG_TEXT);
      if (request.response) {
        if (request.response.idempotencyKey !== input.idempotencyKey) return fail('conflict', 'Human Request is already resolved');
        if (request.response.requestRevision !== input.expectedRevision || request.response.decision !== input.decision || request.response.response !== response) {
          return fail('idempotency-conflict', 'idempotencyKey was reused with different response content');
        }
        return ok(publicRequest(request), true);
      }
      if (request.revision !== input.expectedRevision || request.state !== 'open') return fail('conflict', 'Human Request revision changed');
      recordHumanResponse(request, subject, {
        decision: input.decision, idempotencyKey: input.idempotencyKey, response,
      }, stamp());
      commit(document);
      return ok(publicRequest(request));
    },

    /**
     * Dismiss a dead run: move it to the terminal `archived` state and resolve its open requests in the
     * SAME commit, so a parked run can never survive as a haunting ask in the operator's inbox.
     *
     * Idempotent on `idempotencyKey` exactly like every other governed write here — a replay with the
     * same key and the same reason returns the archived run; a reused key with different content is an
     * `idempotency-conflict`, and a second, different archive of an already-archived run is a `conflict`.
     */
    archiveRun(subject, runRef, input) {
      const document = load();
      const run = findRun(document, subject, runRef);
      if (!run) return fail('not-found', 'run was not found');
      if (!validNonEmpty(input.idempotencyKey, MAX_SHORT_TEXT)) return fail('invalid', 'idempotencyKey is required');
      const reason = input.reason == null ? null : cleanText(input.reason, MAX_LONG_TEXT);
      const fingerprint = sha256(`${runRef}\0${reason ?? ''}`);
      const resolvedRequests = (): HumanRequest[] => document.humanRequests
        .filter((item) => item.subject === subject && item.runRef === runRef
          && item.response?.idempotencyKey === archiveResponseKey(input.idempotencyKey, item.requestRef))
        .map(publicRequest);
      const pinned = (): string[] => document.humanRequests
        .filter((item) => item.subject === subject && item.runRef === runRef && item.state === 'open')
        .map((item) => item.requestRef);
      if (run.archiveOperationKey) {
        if (run.archiveOperationKey !== input.idempotencyKey) return fail('conflict', 'run is already archived');
        if (run.archiveOperationFingerprint !== fingerprint) {
          return fail('idempotency-conflict', 'archive idempotencyKey was reused with a different reason');
        }
        return ok({ run: publicRun(run), resolvedRequests: resolvedRequests(), pinnedRequestRefs: pinned() }, true);
      }
      if (!RUN_EDGES[run.state].has('archived')) {
        return fail('invalid', 'only a finished, stopped, interrupted, or waiting-human run can be archived');
      }
      const archivedAt = stamp();
      for (const request of document.humanRequests) {
        if (request.subject !== subject || request.runRef !== runRef || request.state !== 'open') continue;
        // A review-linked request is pinned open by the review lineage invariants; touching it here would
        // make the document fail its own validation on the next load. Reported, never forced.
        if (isReviewLinkedRequest(document, request.requestRef)) continue;
        recordHumanResponse(request, subject, {
          decision: 'responded',
          idempotencyKey: archiveResponseKey(input.idempotencyKey, request.requestRef),
          response: reason,
        }, archivedAt);
      }
      run.state = 'archived';
      run.version += 1;
      run.updatedAt = archivedAt;
      run.archiveOperationKey = input.idempotencyKey;
      run.archiveOperationFingerprint = fingerprint;
      commit(document);
      return ok({ run: publicRun(run), resolvedRequests: resolvedRequests(), pinnedRequestRefs: pinned() });
    },

    /**
     * The boot/tick sweep's write path — see the interface doc for the single predicate. Runs across
     * every subject in one pass (a background job has no caller subject to scope to); a real
     * per-transition close already happened inline in `transitionRun` for a run that reaches terminal
     * state after this shipped, so this mostly re-covers PRE-EXISTING orphans on its first sweep and is
     * a cheap no-op on every sweep after. One commit total, only when something actually closed.
     */
    closeOrphanedHumanRequests(nowMs) {
      const document = load();
      const atISO = new Date(nowMs).toISOString();
      const closed: StoredHumanRequest[] = [];
      for (const run of document.runs) {
        if (!TERMINAL_RUN.has(run.state)) continue;
        closed.push(...autoCloseOpenHumanRequestsForRun(
          document, run.subject, run.runRef, atISO, `terminal:${run.state}`,
          `Automatically closed — the run reached its terminal state ('${run.state}') without this being answered.`,
          maxEvents,
        ));
      }
      if (closed.length > 0) commit(document);
      return { closed: closed.map(publicRequest) };
    },

    appendEvent(subject, runRef, input) {
      const document = load();
      if (!findRun(document, subject, runRef)) return fail('not-found', 'run was not found');
      if (Object.keys(input as object).some((field) => !EVENT_FIELDS.has(field))) return fail('invalid', 'operational event contains an unknown field');
      if (!EVENT_KINDS.has(input.kind) || !EVENT_SOURCES.has(input.source) || (input.status != null && !EVENT_STATUSES.has(input.status))) {
        return fail('invalid', 'operational event kind, source, or status is invalid');
      }
      if (!validOptionalEventText(input)) return fail('invalid', 'operational event text fields must be strings without NUL bytes');
      const currentCount = document.events.filter((item) => item.subject === subject && item.runRef === runRef).length;
      if (currentCount >= maxEvents) return fail('limit', 'run has reached the operational event limit');
      const refError = validateRefs(document, subject, runRef, input);
      if (refError) return fail('invalid', refError);
      const event: StoredEvent = {
        subject,
        cursor: document.nextEventCursor,
        runRef,
        kind: input.kind,
        source: input.source,
        stageRef: input.stageRef ?? null,
        attemptRef: input.attemptRef ?? null,
        sessionRef: input.sessionRef ?? null,
        status: input.status ?? null,
        summary: input.summary == null ? null : cleanText(input.summary, MAX_LONG_TEXT),
        command: input.command == null ? null : cleanText(input.command, MAX_LONG_TEXT),
        toolName: input.toolName == null ? null : cleanText(input.toolName, MAX_SHORT_TEXT),
        path: input.path == null ? null : cleanText(input.path, MAX_LONG_TEXT),
        diff: input.diff == null ? null : cleanText(input.diff, MAX_LONG_TEXT),
        checkpoint: input.checkpoint == null ? null : cleanText(input.checkpoint, MAX_LONG_TEXT),
        createdAt: stamp(),
      };
      document.nextEventCursor += 1;
      document.events.push(event);
      commit(document);
      return ok(publicEvent(event));
    },

    listEvents(subject, runRef, afterCursor = 0, limit = 250, scope = 'own-subject') {
      const document = load();
      const run = findRun(document, subject, runRef, scope);
      if (!run) return fail('not-found', 'run was not found');
      if (!Number.isSafeInteger(afterCursor) || afterCursor < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_EVENT_PAGE) {
        return fail('invalid', `event cursor must be non-negative and limit must be 1-${MAX_EVENT_PAGE}`);
      }
      return ok(document.events
        .filter((event) => event.subject === run.subject && event.runRef === runRef && event.cursor > afterCursor)
        .slice(0, limit)
        .map(publicEvent));
    },

    inventory(subject) {
      const document = load();
      const activeRuns = document.runs.filter((run) => run.subject === subject).map((run) => inventoryItem(activeBundle(document, subject, run)));
      const quarantinedRuns = document.quarantine.filter((bundle) => bundle.subject === subject).map(inventoryItem);
      const proposalBytes = document.proposals
        .filter((proposal) => proposal.subject === subject)
        .reduce((sum, proposal) => sum + Buffer.byteLength(JSON.stringify(proposal), 'utf8'), 0);
      return {
        activeRuns,
        quarantinedRuns,
        proposalRevisionCount: document.proposals.filter((proposal) => proposal.subject === subject).length,
        nextEventCursor: document.nextEventCursor,
        estimatedBytes: proposalBytes
          + activeRuns.reduce((sum, item) => sum + item.estimatedBytes, 0)
          + quarantinedRuns.reduce((sum, item) => sum + item.estimatedBytes, 0),
      };
    },

    dryRunQuarantine(subject, runRefs) {
      return quarantinePlan(load(), subject, runRefs, stamp());
    },

    quarantineRuns(subject, runRefs, expectedPlanHash) {
      const document = load();
      const planned = quarantinePlan(document, subject, runRefs, stamp());
      if (!planned.ok) return planned;
      if (planned.value.planHash !== expectedPlanHash) return fail('conflict', 'quarantine plan changed; review a fresh dry-run');
      if (planned.value.items.some((item) => !item.eligible)) {
        return fail('ineligible', 'only quiescent terminal or interrupted run bundles without open Human Requests can be quarantined');
      }
      const quarantinedAt = stamp();
      const moved: StorageInventoryItem[] = [];
      for (const item of planned.value.items) {
        const run = findRun(document, subject, item.runRef);
        if (!run) return fail('conflict', 'quarantine plan changed');
        const bundle: QuarantinedRunBundle = { ...activeBundle(document, subject, run), quarantinedAt };
        document.quarantine.push(bundle);
        document.runs = document.runs.filter((value) => value !== run);
        document.stages = document.stages.filter((value) => value.subject !== subject || value.runRef !== run.runRef);
        document.attempts = document.attempts.filter((value) => value.subject !== subject || value.runRef !== run.runRef);
        document.sessions = document.sessions.filter((value) => value.subject !== subject || value.runRef !== run.runRef);
        document.humanRequests = document.humanRequests.filter((value) => value.subject !== subject || value.runRef !== run.runRef);
        document.events = document.events.filter((value) => value.subject !== subject || value.runRef !== run.runRef);
        document.stageGenerations = document.stageGenerations.filter((value) => value.subject !== subject || value.runRef !== run.runRef);
        document.reviewLoops = document.reviewLoops.filter((value) => value.subject !== subject || value.runRef !== run.runRef);
        document.reviewReceipts = document.reviewReceipts.filter((value) => value.subject !== subject || value.runRef !== run.runRef);
        document.generationSupersessions = document.generationSupersessions.filter((value) => value.subject !== subject || value.runRef !== run.runRef);
        moved.push(inventoryItem(bundle));
      }
      commit(document);
      return ok(moved);
    },

    restoreRun(subject, runRef) {
      const document = load();
      if (findRun(document, subject, runRef)) return fail('conflict', 'an active run already has this reference');
      const index = document.quarantine.findIndex((bundle) => bundle.subject === subject && bundle.run.runRef === runRef);
      if (index < 0) return fail('not-found', 'quarantined run was not found');
      const [bundle] = document.quarantine.splice(index, 1);
      const restoredAt = stamp();
      bundle.run.updatedAt = restoredAt;
      bundle.run.version += 1;
      document.runs.push(bundle.run);
      document.stages.push(...bundle.stages);
      document.attempts.push(...bundle.attempts);
      document.sessions.push(...bundle.sessions);
      document.humanRequests.push(...bundle.humanRequests);
      document.events.push(...bundle.events);
      document.stageGenerations.push(...bundle.stageGenerations);
      document.reviewLoops.push(...bundle.reviewLoops);
      document.reviewReceipts.push(...bundle.reviewReceipts);
      document.generationSupersessions.push(...bundle.generationSupersessions);
      document.events.sort((a, b) => a.cursor - b.cursor);
      const recoveryEvent: StoredEvent = {
        subject,
        cursor: document.nextEventCursor,
        runRef,
        kind: 'lifecycle',
        source: 'system',
        stageRef: null,
        attemptRef: null,
        sessionRef: null,
        status: null,
        summary: 'run restored from quarantine',
        command: null,
        toolName: null,
        path: null,
        diff: null,
        checkpoint: null,
        createdAt: restoredAt,
      };
      document.nextEventCursor += 1;
      document.events.push(recoveryEvent);
      commit(document);
      return ok(metadata(document, subject, bundle.run));
    },
  };
}

export function createInMemoryControlPlaneStore(options: ControlStoreOptions = {}): ControlPlaneStore {
  let document = emptyDocument();
  const maxBytes = options.maxDocumentBytes ?? MAX_CONTROL_DOCUMENT_BYTES;
  return makeStore(
    () => clone(document),
    (next) => {
      const bytes = Buffer.byteLength(JSON.stringify(next), 'utf8');
      if (bytes > maxBytes) throw new ControlStoreLimitError(`control-plane store exceeds ${maxBytes} bytes`);
      document = clone(next);
    },
    options,
  );
}

/** File-backed daemon store. Every mutation replaces one sibling temp file atomically. */
export function createFileControlPlaneStore(stateRoot: string, options: ControlStoreOptions = {}): ControlPlaneStore {
  const path = join(stateRoot, 'control', 'control-plane.json');
  const maxBytes = options.maxDocumentBytes ?? MAX_CONTROL_DOCUMENT_BYTES;
  const load = (): StoreDocument => {
    if (!existsSync(path)) return emptyDocument();
    if (statSync(path).size > maxBytes) throw new ControlStoreLimitError(`control-plane store exceeds ${maxBytes} bytes`);
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    assertDocument(parsed);
    return parsed;
  };
  const save = (document: StoreDocument): void => {
    const encoded = `${JSON.stringify(document)}\n`;
    if (Buffer.byteLength(encoded, 'utf8') > maxBytes) throw new ControlStoreLimitError(`control-plane store exceeds ${maxBytes} bytes`);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
    let fd: number | null = null;
    try {
      fd = openSync(temp, 'wx', 0o600);
      writeFileSync(fd, encoded, 'utf8');
      closeSync(fd);
      fd = null;
      renameSync(temp, path);
    } finally {
      if (fd !== null) closeSync(fd);
      if (existsSync(temp)) rmSync(temp, { force: true });
    }
  };
  const recovered = load();
  if (normalizeCrash(recovered, (options.now ?? (() => new Date()))().toISOString())) save(recovered);
  return makeStore(load, save, options);
}
