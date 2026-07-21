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
import type { ResolvedAgentAssignment } from './proposal.ts';
import type {
  BrokerConsumption,
  BrokerMutation,
  ManagedStartSpec,
} from './broker.ts';
import type { PublicOperationalEvent } from './publicEvents.ts';
import type {
  Attempt,
  AttemptState,
  ControlResult,
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
  Stage,
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
const HASH_RE = /^[a-f0-9]{64}$/;
const SAFE_REF_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
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
const RUN_STATES = new Set<RunState>(['planned', 'recovering', 'running', 'waiting-human', 'stopping', 'succeeded', 'failed', 'stopped', 'interrupted']);
const STAGE_STATES = new Set<StageState>(['blocked', 'ready', 'running', 'waiting-human', 'succeeded', 'failed', 'stopped', 'interrupted']);
const ATTEMPT_STATES = new Set<AttemptState>(['queued', 'starting', 'running', 'waiting-human', 'succeeded', 'failed', 'stopped', 'interrupted']);
const SESSION_STATES = new Set<ManagedSessionState>(['pending', 'starting', 'running', 'waiting', 'completed', 'failed', 'stopped', 'interrupted']);
const TERMINAL_RUN = new Set<RunState>(['succeeded', 'failed', 'stopped']);
const TERMINAL_STAGE = new Set<StageState>(['succeeded', 'failed', 'stopped']);
const TERMINAL_ATTEMPT = new Set<AttemptState>(['succeeded', 'failed', 'stopped']);
const TERMINAL_SESSION = new Set<ManagedSessionState>(['completed', 'failed', 'stopped']);
const RETRY_SETTLED_STAGE = new Set<StageState>([...TERMINAL_STAGE, 'interrupted']);
const RETRY_SETTLED_ATTEMPT = new Set<AttemptState>([...TERMINAL_ATTEMPT, 'interrupted']);
const RETRY_SETTLED_SESSION = new Set<ManagedSessionState>([...TERMINAL_SESSION, 'interrupted']);
const QUARANTINE_ELIGIBLE = new Set<RunState>(['succeeded', 'failed', 'stopped', 'interrupted']);
const QUARANTINE_SETTLED_STAGE = new Set<StageState>([...TERMINAL_STAGE, 'interrupted']);
const QUARANTINE_SETTLED_ATTEMPT = new Set<AttemptState>([...TERMINAL_ATTEMPT, 'interrupted']);
const QUARANTINE_SETTLED_SESSION = new Set<ManagedSessionState>([...TERMINAL_SESSION, 'interrupted']);
const PUBLICATION_STATES = new Set<Run['publicationState']>(['pending', 'waiting-human', 'publishing', 'published', 'reconcile-required']);

const RUN_EDGES: Readonly<Record<RunState, ReadonlySet<RunState>>> = {
  planned: new Set(['recovering', 'running', 'waiting-human', 'stopping', 'failed', 'stopped', 'interrupted']),
  recovering: new Set(['running', 'waiting-human', 'stopping', 'failed', 'stopped', 'interrupted']),
  running: new Set(['waiting-human', 'stopping', 'succeeded', 'failed', 'stopped', 'interrupted']),
  'waiting-human': new Set(['planned', 'recovering', 'running', 'stopping', 'failed', 'stopped', 'interrupted']),
  stopping: new Set(['stopped', 'failed', 'interrupted']),
  succeeded: new Set(),
  failed: new Set(),
  stopped: new Set(),
  interrupted: new Set(['recovering', 'running', 'waiting-human', 'stopping', 'failed', 'stopped']),
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
}

interface StoredStage extends Stage {
  subject: string;
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
}

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
  quarantine: QuarantinedRunBundle[];
}

function retryPredecessorRefusal(document: StoreDocument, predecessor: StoredRun): string | null {
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
  stages: CreateRunStageInput[];
}

export interface CreateAttemptInput {
  expectedStageVersion: number;
  runtime: string;
  model: string;
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
  listProposalRevisionsForComposer(subject: string, sourceComposerRef: string): ProposalRevisionMetadata[];
  getProposalRevision(subject: string, proposalRef: string, revision: number): ControlResult<ProposalRevision>;
  createProposalRevision(subject: string, input: CreateProposalRevisionInput): ControlResult<ProposalRevision>;
  decideProposal(subject: string, proposalRef: string, revision: number, input: ApproveProposalInput): ControlResult<ProposalRevision>;

  listRuns(subject: string): RunMetadata[];
  getRun(subject: string, runRef: string): ControlResult<RunDetail>;
  createRun(subject: string, input: CreateRunInput): ControlResult<RunDetail>;
  transitionRun(subject: string, runRef: string, expectedVersion: number, state: RunState): ControlResult<Run>;
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

  appendEvent(subject: string, runRef: string, input: OperationalEventInput): ControlResult<OperationalEvent>;
  listEvents(subject: string, runRef: string, afterCursor?: number, limit?: number): ControlResult<OperationalEvent[]>;

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
): { manager: ResolvedAgentAssignment | null; stages: Map<string, ResolvedAgentAssignment | null> } | null {
  if (!isPlainRecord(snapshot.manager) || !Array.isArray(snapshot.stages) || snapshot.stages.length !== stages.length) return null;
  const manager = approvedAssignment(snapshot.manager);
  if (manager === undefined) return null;
  const snapshotStages = snapshot.stages;
  const snapshotById = new Map<string, Record<string, unknown>>();
  for (const snapshotStage of snapshotStages) {
    if (!isPlainRecord(snapshotStage) || typeof snapshotStage.id !== 'string' || snapshotById.has(snapshotStage.id)) return null;
    snapshotById.set(snapshotStage.id, snapshotStage);
  }
  const resolved = new Map<string, ResolvedAgentAssignment | null>();
  for (const stage of stages) {
    const snapshotStage = snapshotById.get(stage.stageId);
    if (!snapshotStage) return null;
    if (typeof snapshotStage.title !== 'string' || snapshotStage.title !== stage.title.trim()
      || !sameStringArray(stage.dependsOn, snapshotStage.dependsOn)) return null;
    const assignment = approvedAssignment(snapshotStage);
    if (assignment === undefined) return null;
    resolved.set(stage.stageId, assignment);
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
    ...request
  } = value;
  return clone(request);
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

function detail(document: StoreDocument, subject: string, run: StoredRun): RunDetail {
  return {
    run: publicRun(run),
    stages: document.stages.filter((item) => item.subject === subject && item.runRef === run.runRef).map(publicStage),
    attempts: document.attempts.filter((item) => item.subject === subject && item.runRef === run.runRef).map(publicAttempt),
    sessions: document.sessions.filter((item) => item.subject === subject && item.runRef === run.runRef).map(publicSession),
    humanRequests: document.humanRequests.filter((item) => item.subject === subject && item.runRef === run.runRef).map(publicRequest),
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
    && bundle.humanRequests.every((request) => request.state === 'resolved' && request.response !== null);
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

function dependenciesSucceeded(document: StoreDocument, stage: StoredStage): boolean {
  const stages = new Map(document.stages
    .filter((candidate) => candidate.subject === stage.subject && candidate.runRef === stage.runRef)
    .map((candidate) => [candidate.stageId, candidate]));
  return stage.dependsOn.every((dependency) => stages.get(dependency)?.state === 'succeeded');
}

function runCanSucceed(document: StoreDocument, run: StoredRun): boolean {
  const matches = <T extends { subject: string; runRef: string }>(value: T): boolean =>
    value.subject === run.subject && value.runRef === run.runRef;
  return document.stages.filter(matches).every((stage) => stage.state === 'succeeded')
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
}

function appendRecoveryEvent(document: StoreDocument, subject: string, runRef: string, stamp: string): void {
  document.events.push({
    subject,
    cursor: document.nextEventCursor,
    runRef,
    kind: 'lifecycle',
    source: 'system',
    stageRef: null,
    attemptRef: null,
    sessionRef: null,
    status: 'interrupted',
    summary: 'dashboard restarted; active control-plane records were normalized to interrupted',
    command: null,
    toolName: null,
    path: null,
    diff: null,
    checkpoint: null,
    createdAt: stamp,
  });
  document.nextEventCursor += 1;
}

function normalizeCrash(document: StoreDocument, stamp: string): boolean {
  let changed = false;
  for (const run of document.runs) {
    let runChanged = false;
    const managerAssignment = normalizeAssignment(run.managerAssignment);
    if (managerAssignment === undefined) throw new Error('invalid control-plane assignment provenance');
    if (run.managerAssignment === undefined) {
      run.managerAssignment = null;
      changed = true;
    }
    if (run.state === 'running' || run.state === 'recovering' || run.state === 'stopping') {
      run.state = 'interrupted';
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
      if (stage.state !== 'running') continue;
      stage.state = 'interrupted';
      stage.version += 1;
      stage.updatedAt = stamp;
      runChanged = true;
    }
    for (const attempt of document.attempts.filter((item) => item.subject === run.subject && item.runRef === run.runRef)) {
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
      appendRecoveryEvent(document, run.subject, run.runRef, stamp);
      changed = true;
    }
  }
  for (const bundle of document.quarantine) {
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
    }
  }
  return changed;
}

function makeStore(load: () => StoreDocument, save: (document: StoreDocument) => void, options: ControlStoreOptions): ControlPlaneStore {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? randomUUID;
  const maxEvents = options.maxEventsPerRun ?? MAX_EVENTS_PER_RUN;
  const ref = (prefix: string): string => `${prefix}-${newId()}`;
  const stamp = (): string => now().toISOString();

  const findRun = (document: StoreDocument, subject: string, runRef: string): StoredRun | undefined =>
    document.runs.find((item) => item.subject === subject && item.runRef === runRef);

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

    listProposalRevisionsForComposer(subject, sourceComposerRef) {
      return load().proposals
        .filter((item) => item.subject === subject && item.sourceComposerRef === sourceComposerRef)
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

    listRuns(subject) {
      const document = load();
      return document.runs.filter((item) => item.subject === subject).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((run) => metadata(document, subject, run));
    },

    getRun(subject, runRef) {
      const document = load();
      const run = findRun(document, subject, runRef);
      return run ? ok(detail(document, subject, run)) : fail('not-found', 'run was not found');
    },

    createRun(subject, input) {
      if (!validNonEmpty(input.title, MAX_TITLE) || !validNonEmpty(input.managerRuntime, MAX_SHORT_TEXT) || !validNonEmpty(input.managerModel, MAX_SHORT_TEXT)) {
        return fail('invalid', 'run title and manager routing are required');
      }
      if (!validNonEmpty(input.idempotencyKey, MAX_SHORT_TEXT)) return fail('invalid', 'idempotencyKey is required');
      const managerAssignment = normalizeAssignment(input.managerAssignment);
      if (managerAssignment === undefined) return fail('invalid', 'manager assignment provenance is invalid');
      if (!Array.isArray(input.stages) || input.stages.length === 0 || input.stages.length > MAX_STAGES_PER_RUN) {
        return fail('limit', `run must contain 1-${MAX_STAGES_PER_RUN} stages`);
      }
      const ids = new Set<string>();
      const stageAssignments = new Map<string, ResolvedAgentAssignment | null>();
      for (const stage of input.stages) {
        if (!validNonEmpty(stage.stageId, MAX_SHORT_TEXT) || !validNonEmpty(stage.title, MAX_TITLE) || ids.has(stage.stageId)
          || !Array.isArray(stage.dependsOn) || stage.dependsOn.some((item) => typeof item !== 'string')
          || new Set(stage.dependsOn).size !== stage.dependsOn.length
          || stage.canonicalCardRef != null) {
          return fail('invalid', 'stage ids and titles must be non-empty and stage ids must be unique');
        }
        const assignment = normalizeAssignment(stage.assignment);
        if (assignment === undefined) return fail('invalid', 'stage assignment provenance is invalid');
        ids.add(stage.stageId);
        stageAssignments.set(stage.stageId, assignment);
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
      }));
      const launchFingerprint = sha256(JSON.stringify({
        proposalRef: input.proposalRef,
        proposalRevision: input.proposalRevision,
        expectedProposalHash: input.expectedProposalHash,
        title: input.title.trim(),
        managerRuntime: input.managerRuntime,
        managerModel: input.managerModel,
        managerAssignment,
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
        || input.stages.some((stage) => !sameAssignment(stageAssignments.get(stage.stageId) ?? null, approvedAssignments.stages.get(stage.stageId) ?? null))) {
        return fail('conflict', 'assignment provenance does not match the approved proposal snapshot');
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
            return !predecessorStage || !sameAssignment(predecessorStage.assignment, stageAssignments.get(stage.stageId) ?? null);
          })) {
          return fail('conflict', 'Retry successor must preserve assignment provenance');
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
        createdAt,
        updatedAt: createdAt,
      }));
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
      commit(document);
      return ok(detail(document, subject, run));
    },

    transitionRun(subject, runRef, expectedVersion, state) {
      const document = load();
      const run = findRun(document, subject, runRef);
      if (!run) return fail('not-found', 'run was not found');
      if (!RUN_STATES.has(state)) return fail('invalid', 'run state is invalid');
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

    respondHumanRequest(subject, requestRef, input) {
      const document = load();
      const request = document.humanRequests.find((item) => item.subject === subject && item.requestRef === requestRef);
      if (!request) return fail('not-found', 'Human Request was not found');
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
      const respondedAt = stamp();
      request.response = {
        requestRevision: input.expectedRevision,
        decision: input.decision,
        respondedBy: subject,
        idempotencyKey: input.idempotencyKey,
        response,
        respondedAt,
      };
      request.state = 'resolved';
      request.updatedAt = respondedAt;
      commit(document);
      return ok(publicRequest(request));
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

    listEvents(subject, runRef, afterCursor = 0, limit = 250) {
      const document = load();
      if (!findRun(document, subject, runRef)) return fail('not-found', 'run was not found');
      if (!Number.isSafeInteger(afterCursor) || afterCursor < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_EVENT_PAGE) {
        return fail('invalid', `event cursor must be non-negative and limit must be 1-${MAX_EVENT_PAGE}`);
      }
      return ok(document.events
        .filter((event) => event.subject === subject && event.runRef === runRef && event.cursor > afterCursor)
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
