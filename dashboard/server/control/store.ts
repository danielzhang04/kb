import {
  existsSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { redactSensitiveText } from '../composer/publicTimeline.ts';
import {
  canonicalJson, clone, isPlainRecord, iterationDefinitionHash, iterationRequestFingerprint, sha256,
} from './controlHashing.ts';
import { parseIterationOutcome } from './iterationOutcome.ts';
import {
  persistControlDocumentSync,
  writeControlPlaneMigrationBackupSync,
  type SaveDurability,
} from './persistence.ts';
import { assertWriterLeaseForRoot } from './writerLease.ts';
import type { FileControlPlaneAccess } from './writerLease.ts';
import {
  legacyGroupForStages,
  loadAndMigrate,
  normalizeCrash,
  type MigrationContext,
} from './migrations.ts';
import {
  CONTROL_PLANE_SCHEMA_VERSION,
} from './generated/controlPlaneSchema.ts';
import { decodeHostKind, decodeRun, decodeRunnableRef, decodeStoredRun } from './p2Decoders.ts';
import type {
  RunnableRef,
  Schedule,
} from './p2Contracts.ts';
// P6 W1 [P6-C23, P6-C37, P6-C48, P6-C59]: the three additive placement collections introduced by the
// v3 -> v4 migration. Their record decoders are W0's contracts, imported — never re-declared here.
import type {
  StoredHostAdvertisement,
} from '../placement/contracts.ts';
// P6 W6.3: the advertisement CAS decodes its body through the SAME W0 decoder the node route uses, so
// there is exactly one validation of a `HostAdvertisement` in the daemon.
import { decodeHostAdvertisement } from '../placement/contracts.ts';
// P6 W1b [P6-C48]: the store-open document invariant must decode every placement collection row through
// its W0 exact-key decoder, not just confirm the collections are bounded arrays.
import { assertPlacementCollections } from './placementState.ts';
import type {
  CompleteScheduleOccurrenceInput,
  DeleteScheduleInput,
  DeleteScheduleReceipt,
  ResolvedCreateScheduleInput,
  ScheduleMutationReceipt,
  ScheduleMutationEvent,
  ScheduleOccurrenceClaim,
  CommitScheduleMirrorPreparationResult,
  ScheduleMirrorRow,
  ScheduleSnapshot,
  SetScheduleArmedInput,
} from '../schedules/contracts.ts';
import {
  decodeScheduleMirrorBatch, decodeScheduleMirrorWatermark, isRowCoveredByMirror,
} from '../schedules/mirrorContracts.ts';
import type { ScheduleMirrorBatch, ScheduleMirrorWatermark } from '../schedules/mirrorContracts.ts';
import { ReconciliationConflictError } from '../reconciliation/contracts.ts';
import type {
  PreparedReconciliationReceipt,
  PublishedReconciliationReceipt,
  ReconciliationReceipt,
  ReconciliationReceiptPort,
  ReconciliationResult,
} from '../reconciliation/contracts.ts';
import type {
  ScheduleMutationTransaction,
  StoredScheduleMutationReceipt,
} from '../schedules/service.ts';
import type {
  AdvanceScheduleOccurrenceInput,
} from '../schedules/socketRoutes.ts';
import type {
  ProposalCompletionGate,
  ProposalIterationGroup,
  ProposalReview,
  ResolvedAgentAssignment,
} from './proposal.ts';
import { ARTIFACT_PRODUCING_REQUEST_KINDS } from './proposal.ts';
import type {
  BrokerMutation,
  ManagedStartSpec,
} from './attemptDurability.ts';
import type { PublicOperationalEvent } from './publicEvents.ts';
import { TERMINAL_ATTEMPT } from './types.ts';
import { MAX_DEPLOYMENT_OPERATION_RECEIPTS } from './controlPlaneLimits.ts';
import {
  assertDeploymentCollection,
  canTransitionDeployment,
  isTerminalDeploymentState,
  validateCreateDeploymentInput,
  validateTransitionDeploymentInput,
} from './deploymentState.ts';
import {
  ASSET_PULL_MAX_ATTEMPTS,
  assertAssetPullCollection,
  canTransitionAssetPull,
  validateCreateAssetPullIntentInput,
  validateUpdateAssetPullIntentInput,
} from './assetPullState.ts';
import type {
  Attempt,
  AttemptState,
  AgentWorkspaceLaunchProvenance,
  AssetPullIntent,
  ControlResult,
  Deployment,
  GenerationSupersession,
  HumanRequest,
  HumanRequestDecision,
  HumanRequestKind,
  IterationLoop,
  IterationReceipt,
  IterationRequest,
  IterationResidue,
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
  ParkIterationLoopInput,
  Run,
  RunDetail,
  RunDto,
  RunMetadata,
  Stage,
  StageGeneration,
  StageState,
  StorageInventoryItem,
} from './types.ts';
import {
  RUN_LIFECYCLE_KINDS,
  canQuarantineRun,
  canTransitionRun,
  isTerminalRun,
  lifecycleForKind,
  projectRunState,
  runLifecycleKind,
  type RunLifecycleKind,
} from './runLifecycle.ts';

export const MAX_CONTROL_DOCUMENT_BYTES = 128 * 1024 * 1024;
/** Snapshot/restore of the control plane must include this grant sidecar with control-plane.json. */
export const CONTROL_PLANE_ACCEPTED_SIZE_FILENAME = 'control-plane.accepted-size.json';
export const MAX_PROPOSAL_SNAPSHOT_BYTES = 512 * 1024;
export const MAX_EVENTS_PER_RUN = 100_000;
export const MAX_EVENT_PAGE = 1_000;
export const MAX_STAGES_PER_RUN = 128;
export const MAX_HUMAN_REQUESTS_PER_RUN = 1_024;
export const MAX_BROKER_RECEIPTS_PER_SESSION = 4_096;
export const MAX_STEERING_INSTRUCTIONS_PER_SESSION = 256;

const MAX_TITLE = 240;
export const MAX_SHORT_TEXT = 512;
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
const STAGE_STATES = new Set<StageState>(['blocked', 'ready', 'running', 'waiting-human', 'succeeded', 'failed', 'stopped', 'interrupted']);
const ATTEMPT_STATES = new Set<AttemptState>(['queued', 'starting', 'running', 'waiting-human', 'succeeded', 'failed', 'stopped', 'interrupted']);
const SESSION_STATES = new Set<ManagedSessionState>(['pending', 'starting', 'running', 'waiting', 'completed', 'failed', 'stopped', 'interrupted']);

/** The single human identity the daemon mints WebAuthn sessions for (`server/auth/routes.ts` OPERATOR.id).
 *  Every other subject in this document is a machine: the dashboard engine, an executor, a test fixture. */
export const OPERATOR_SUBJECT = 'operator';

/**
 * How far one call reaches across subjects.
 *
 * Every record here is stamped with the subject that created it. The daemon's runs are not all created
 * by the same subject: the SPA session is `operator` while the queue bridge and the executor own their
 * runs under `dashboard-engine`, so an own-subject-only view showed the one human on this machine only
 * the half of the plane they happened to launch by hand.
 *
 * `'all-subjects'` is what a verified operator session resolves to (`routes.ts#readScope`) and nothing
 * else ever does — it is derived from the verified session subject alone, never from a header, query
 * param or body field, and every parameter below defaults to `'own-subject'` so any caller that does
 * not opt in keeps the exact ownership check it always had.
 *
 * READS took it first. Since Daniel's ruling of 2026-08-11 the OPERATOR-DRIVEN MUTATIONS take it too
 * (respond to a Human Request, resolve a review completion gate, Manager message/steer/stop, archive a
 * run, and the events/intervention requests those write): a gate the Inbox listed but the operator
 * could not answer, on exactly the headless runs these controls exist for, is not a boundary — it is a
 * dead end. Two invariants hold under a widened mutation and are pinned in `store.test.ts`:
 *
 *  - OWNERSHIP NEVER MOVES. Every record a widened mutation touches or creates stays partitioned under
 *    the RUN's subject (`run.subject`), so the run's own machinery — the engine, the quarantine bundle,
 *    the timeline read, every count — still finds its whole record tree. Nothing transfers.
 *  - THE ACTOR IS RECORDED HONESTLY. Where a record names WHO acted (`response.respondedBy`) it names
 *    the caller — the operator — never the run's owner. The route layer additionally lands the audit
 *    row under the operator's identity.
 *
 * Engine and bridge paths never pass it, so they are unchanged and stay own-subject.
 */
export type ReadScope = 'own-subject' | 'all-subjects';

const TERMINAL_STAGE = new Set<StageState>(['succeeded', 'failed', 'stopped']);
const TERMINAL_SESSION = new Set<ManagedSessionState>(['completed', 'failed', 'stopped']);
const RETRY_SETTLED_STAGE = new Set<StageState>([...TERMINAL_STAGE, 'interrupted']);
const RETRY_SETTLED_ATTEMPT = new Set<AttemptState>([...TERMINAL_ATTEMPT, 'interrupted']);
const RETRY_SETTLED_SESSION = new Set<ManagedSessionState>([...TERMINAL_SESSION, 'interrupted']);
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
  // `starting -> succeeded` exists because [C-S5] moved the `running` projection behind the attempt
  // start receipt: a stage finalized from an already-committed canonical result adopts it without ever
  // starting a session, so its attempt succeeds straight out of `starting`.
  starting: new Set(['running', 'succeeded', 'waiting-human', 'failed', 'stopped', 'interrupted']),
  running: new Set(['waiting-human', 'succeeded', 'failed', 'stopped', 'interrupted']),
  'waiting-human': new Set(['failed', 'stopped', 'interrupted']),
  succeeded: new Set(),
  failed: new Set(),
  stopped: new Set(),
  interrupted: new Set(['stopped']),
};
const SESSION_EDGES: Readonly<Record<ManagedSessionState, ReadonlySet<ManagedSessionState>>> = {
  pending: new Set(['starting', 'failed', 'stopped', 'interrupted']),
  // `starting -> waiting` exists because [C-S5] moved the `running` projection behind the attempt start
  // receipt: a stage that parks for a human (a refused skill resolution) between session creation and
  // that receipt has a `starting` session that never ran, and parking it is not an interruption.
  starting: new Set(['running', 'waiting', 'completed', 'failed', 'stopped', 'interrupted']),
  running: new Set(['waiting', 'completed', 'failed', 'stopped', 'interrupted']),
  waiting: new Set(['running', 'completed', 'failed', 'stopped', 'interrupted']),
  completed: new Set(),
  failed: new Set(),
  stopped: new Set(),
  interrupted: new Set(['stopped']),
};


import type {
  StoredProposal,
  StoredRun,
  StoredDeployment,
  StoredAssetPullIntent,
  RunActivationPhase,
  StoredRunActivationReceipt,
  StoredStage,
  StoredStageGeneration,
  StoredGenerationSupersession,
  StoredIterationLoop,
  StoredIterationRequest,
  StoredIterationReceipt,
  StoredAttempt,
  StoredSession,
  StoredSteeringInstruction,
  StoredBrokerReceiptKind,
  StoredBrokerReceipt,
  StoredHumanRequest,
  StoredAuthorizedFailedRunReconciliation,
  StoredEvent,
  QuarantinedRunBundle,
  StoredSchedule,
  StoredScheduleTombstone,
  StoredScheduleOccurrenceClaim,
  StoreDocumentCollections,
  StoreDocument,
  ControlStoreOptions,
  CreateRunStageInput,
  RunActivationInput,
  CanonicalStageProjectionInput,
  ControlPlaneStore,
} from './storeTypes.ts';
export type {
  StoredProposal,
  StoredRun,
  RunActivationPhase,
  StoredRunActivationReceipt,
  StoredStage,
  StoredStageGeneration,
  StoredGenerationSupersession,
  StoredIterationLoop,
  StoredIterationRequest,
  StoredIterationReceipt,
  StoredAttempt,
  StoredSession,
  StoredHumanRequest,
  AuthorizedFailedRunReconciliationPhase,
  AuthorizedFailedRunReconciliationReceipt,
  StoredAuthorizedFailedRunReconciliation,
  StoredEvent,
  QuarantinedRunBundle,
  StoredSchedule,
  StoredScheduleTombstone,
  StoredScheduleOccurrenceClaim,
  StoredScheduleSeedImport,
  StoreDocumentCollections,
  StoreDocument,
  ControlStoreOptions,
  CreateProposalRevisionInput,
  ApproveProposalInput,
  CreateRunStageInput,
  CreateRunInput,
  RunActivationInput,
  RunActivationReceipt,
  CreateAttemptInput,
  RecordStageGenerationInput,
  CreateWorkerSessionInput,
  RerouteStageInput,
  RerouteStageResult,
  CreateHumanRequestInput,
  CreateHumanRequestBatchInput,
  RespondHumanRequestInput,
  ArchiveRunInput,
  ArchiveRunResult,
  CloseOrphanedHumanRequestsResult,
  RecoverAuthorized20260731ExecutionLockInput,
  RecoverAuthorized20260731ExecutionLockResult,
  RecoverAuthorized20260731ExecutionLockPreflight,
  ReconcileAuthorized20260801FailedRunInput,
  ReconcileAuthorized20260801FailedRunResult,
  ReconcileAuthorized20260801FailedRunPreflight,
  CreateManagerSuccessorInput,
  ManagerCommandInput,
  ManagerCommandResult,
  RequestRunCancellationInput,
  CanonicalStageProjectionInput,
  ReconcileCanonicalProjectionInput,
  BrokerSteeringInput,
  BrokerStoreBackend,
  HostAdvertisementUpsertResult,
  ControlPlaneStore,
} from './storeTypes.ts';

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


/** Invoke the canonical Python card renderer without a shell or caller-provided path. */
export function createPythonScheduleClaimRenderer(
  repoRoot: string,
  now: () => Date = () => new Date(),
): NonNullable<ControlStoreOptions['renderScheduleClaim']> {
  const script = join(repoRoot, 'scripts', 'cards.py');
  return async (input) => {
    const command = process.platform === 'win32' ? 'py' : 'python3';
    const args = process.platform === 'win32'
      ? ['-3', script, '--schedule-occurrence-claim']
      : [script, '--schedule-occurrence-claim'];
    const result = spawnSync(command, args, {
      cwd: repoRoot,
      input: JSON.stringify({
        scheduleId: input.scheduleId,
        scheduledFor: input.scheduledFor,
        owner: input.owner,
        mirrorPath: input.mirrorPath,
        dispatchedAt: now().toISOString(),
      }),
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    if (result.error || result.status !== 0 || !result.stdout) {
      throw Object.assign(new Error('schedule-card-renderer-failed'), { status: 503, code: 'schedule-card-renderer-failed' });
    }
    let parsed: unknown;
    try { parsed = JSON.parse(result.stdout); } catch {
      throw Object.assign(new Error('schedule-card-renderer-invalid'), { status: 503, code: 'schedule-card-renderer-invalid' });
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw Object.assign(new Error('schedule-card-renderer-invalid'), { status: 503, code: 'schedule-card-renderer-invalid' });
    }
    return parsed as { card: Record<string, unknown>; cardBytesSha256: string };
  };
}


export class ControlStoreLimitError extends Error {}
export class ControlStoreMigrationLimitError extends ControlStoreLimitError {}
export class ControlStoreReadOnlyError extends Error {
  constructor() {
    super('control-plane store is read-only');
    this.name = 'ControlStoreReadOnlyError';
  }
}

function genericPersistenceDocument(document: StoreDocument): StoreDocument {
  return clone(document);
}

export function emptyStoreDocumentForTest(): StoreDocument {
  return {
    version: 4,
    documentRevision: 0,
    nextEventCursor: 1,
    scheduleCollectionRevision: 0,
    proposals: [],
    runs: [],
    stages: [],
    attempts: [],
    sessions: [],
    humanRequests: [],
    events: [],
    stageGenerations: [],
    iterationLoops: [],
    iterationRequests: [],
    iterationReceipts: [],
    generationSupersessions: [],
    quarantine: [],
    deployments: [],
    schedules: [],
    scheduleTombstones: [],
    scheduleOccurrenceClaims: [],
    scheduleSeedImports: [],
    hostAdvertisements: [],
    placementLeases: [],
    v1Idempotency: [],
  };
}

export function ok<T>(value: T, replayed?: boolean): ControlResult<T> {
  return replayed ? { ok: true, value, replayed: true } : { ok: true, value };
}

export function fail<T>(reason: Extract<ControlResult<T>, { ok: false }>['reason'], detail: string): ControlResult<T> {
  return { ok: false, reason, detail };
}

/** Windows production invocation: `py -3 deploy/control_plane_schema.py --round-trip-v3` (stdin JSON). */
export const GENERATED_PYTHON_ROUND_TRIP_COMMAND = 'py -3 deploy/control_plane_schema.py --round-trip-v3';

/** Exact generated-Python prepublication validation command used by production startup. */
export function validateGeneratedPythonControlPlaneRoundTrip(document: StoreDocument): void {
  const script = fileURLToPath(new URL('../../../deploy/control_plane_schema.py', import.meta.url));
  const command = process.platform === 'win32' ? 'py' : 'python3';
  const args = process.platform === 'win32'
    ? ['-3', script, '--round-trip-v3']
    : [script, '--round-trip-v3'];
  const result = spawnSync(command, args, {
    input: JSON.stringify(genericPersistenceDocument(document)),
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error || result.status !== 0 || !result.stdout) {
    throw new Error(`generated Python control-plane round trip failed${result.stderr ? `: ${result.stderr.trim()}` : ''}`);
  }
  let restored: unknown;
  try {
    restored = JSON.parse(result.stdout);
  } catch {
    throw new Error('generated Python control-plane round trip returned invalid JSON');
  }
  if (canonicalJson(restored as JsonValue) !== canonicalJson(genericPersistenceDocument(document) as unknown as JsonValue)) {
    throw new Error('generated Python control-plane round trip changed the migrated document');
  }
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

export function validNonEmpty(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max && !value.includes('\0');
}

function validIterationArtifactSnapshot(
  value: NonNullable<ParkIterationLoopInput['artifactSnapshots']>[number],
): boolean {
  const validSize = (size: number | null): boolean => size === null || (Number.isSafeInteger(size) && size >= 0);
  const validHash = (hash: string | null): boolean => hash === null || HASH_RE.test(hash);
  const pathSegments = typeof value?.path === 'string' ? value.path.replace(/\\/g, '/').split('/') : [];
  return !!value && validNonEmpty(value.path, MAX_LONG_TEXT) && !/^[A-Za-z]:/.test(value.path)
    && !value.path.startsWith('/') && pathSegments.every((segment) => segment.length > 0 && segment !== '..')
    && typeof value.regularFile === 'boolean' && validSize(value.size) && validHash(value.sha256)
    && typeof value.afterRegularFile === 'boolean' && validSize(value.afterSize) && validHash(value.afterSha256)
    && typeof value.byteIdentical === 'boolean'
    && (value.regularFile ? value.size !== null && value.sha256 !== null : value.size === null && value.sha256 === null)
    && (value.afterRegularFile
      ? value.afterSize !== null && value.afterSha256 !== null
      : value.afterSize === null && value.afterSha256 === null)
    && value.byteIdentical === (value.regularFile && value.afterRegularFile
      && value.size === value.afterSize && value.sha256 === value.afterSha256);
}

/**
 * The proposal compiler owns this binding. The store repeats its closed-shape checks so a caller
 * cannot substitute a declaration/profile after approval but before durable run creation.
 */
export function normalizeAssignment(value: unknown): ResolvedAgentAssignment | null | undefined {
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

export function sameAssignment(left: ResolvedAgentAssignment | null, right: ResolvedAgentAssignment | null): boolean {
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

export function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
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
export function normalizeCheckerContract(
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

export function sameCheckerContract(left: CheckerContractProvenance, right: CheckerContractProvenance): boolean {
  return canonicalJson(left as unknown as JsonValue) === canonicalJson(right as unknown as JsonValue);
}

function generationOperationKey(runRef: string, stageId: string, generation: number): string {
  return generation === 1 ? `result:${runRef}:${stageId}` : `result:${runRef}:${stageId}:g${generation}`;
}

function iterationGenerationOperationKey(runRef: string, stageId: string, requestRef: string): string {
  return `iteration-result:${runRef}:${stageId}:${requestRef}`;
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
  const { subject, ...proposal } = value;
  // Always the REVISION's own subject, never the reader's: under `'all-subjects'` those differ, and the
  // field exists precisely to name the owner of a revision the caller does not own.
  return { ...clone(proposal), ownerSubject: subject };
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

export function internalRun(value: StoredRun): Run {
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
  const decoded = decodeRun(run);
  if (!decoded) throw new Error('invalid control-plane Run transport payload');
  return decoded;
}

function publicDeployment(deployment: StoredDeployment): Deployment {
  const { operationReceipts: _operationReceipts, ...result } = deployment;
  return clone(result);
}

function publicAssetPullIntent(intent: StoredAssetPullIntent): AssetPullIntent {
  return clone(intent);
}

export function publicRun(value: StoredRun): RunDto {
  const { lifecycle, ...run } = internalRun(value);
  return { ...run, state: projectRunState(lifecycle) };
}

function publicStage(value: StoredStage): Stage {
  const { subject: _subject, ...stage } = value;
  return clone(stage);
}

function publicAttempt(value: StoredAttempt): Attempt {
  const {
    subject: _subject,
    iterationAdvanceOperationKey: _iterationAdvanceOperationKey,
    iterationAdvanceOperationFingerprint: _iterationAdvanceOperationFingerprint,
    iterationAdvanceReceiptRef: _iterationAdvanceReceiptRef,
    ...attempt
  } = value;
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

export function publicRequest(value: StoredHumanRequest): HumanRequest {
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
 * A request whose resolution is RESERVED to a specialized iteration gate resolver.
 *
 * Completion and iteration-park gates are fingerprint-bound to their receipt/loop CAS tuple. A
 * rejection-minted intervention is a separate ordinary Human Request and remains generically answerable.
 * The generic responder and archive path both ask this question before mutating a specialized gate.
 */
function isIterationGateRequest(document: StoreDocument, requestRef: string): boolean {
  // Completion and iteration-park gates keep their specialized CAS resolver. A completion rejection's
  // linked intervention is intentionally answered through the ordinary Human Request responder.
  if (document.humanRequests.find((request) => request.requestRef === requestRef)?.kind === 'intervention') return false;
  return document.iterationLoops.some((loop) =>
    loop.completionGateRef === requestRef || loop.interventionRef === requestRef);
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
    if (isIterationGateRequest(document, request.requestRef)) continue;
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

export function publicEvent(value: StoredEvent): OperationalEvent {
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

function publicIterationLoop(value: StoredIterationLoop): IterationLoop {
  const {
    subject: _subject,
    advanceOperationKey: _advanceOperationKey,
    advanceOperationFingerprint: _advanceOperationFingerprint,
    ...loop
  } = value;
  return clone(loop);
}

function publicIterationRequest(value: StoredIterationRequest): IterationRequest {
  const {
    subject: _subject, runRef: _runRef, operationKey: _operationKey,
    operationFingerprint: _operationFingerprint, ...request
  } = value;
  return clone(request);
}

function publicIterationReceipt(value: StoredIterationReceipt): IterationReceipt {
  const {
    subject: _subject, runRef: _runRef, routeId: _routeId, operationKey: _operationKey,
    operationFingerprint: _operationFingerprint, ...receipt
  } = value;
  return clone(receipt);
}

function publicGenerationSupersession(value: StoredGenerationSupersession): GenerationSupersession {
  const { subject: _subject, operationFingerprint: _operationFingerprint, ...supersession } = value;
  return clone(supersession);
}

function detail(document: StoreDocument, subject: string, run: StoredRun): RunDetail {
  const stages = document.stages.filter((item) => item.subject === subject && item.runRef === run.runRef);
  const iterationLoops = document.iterationLoops.filter((item) => item.subject === subject && item.runRef === run.runRef);
  const iterationReceipts = document.iterationReceipts.filter((item) => item.subject === subject && item.runRef === run.runRef);
  return {
    run: internalRun(run),
    // Always the RUN's own subject, never the caller's: under `'all-subjects'` those differ, and the
    // field exists precisely to name the owner of a run the caller does not own.
    ownerSubject: run.subject,
    stages: stages.map(publicStage),
    attempts: document.attempts.filter((item) => item.subject === subject && item.runRef === run.runRef).map(publicAttempt),
    sessions: document.sessions.filter((item) => item.subject === subject && item.runRef === run.runRef).map(publicSession),
    humanRequests: document.humanRequests.filter((item) => item.subject === subject && item.runRef === run.runRef).map(publicRequest),
    stageGenerations: document.stageGenerations.filter((item) => item.subject === subject && item.runRef === run.runRef).map(publicStageGeneration),
    iterationLoops: iterationLoops.map(publicIterationLoop),
    iterationRequests: document.iterationRequests.filter((item) => item.subject === subject && item.runRef === run.runRef).map(publicIterationRequest),
    iterationReceipts: iterationReceipts.map(publicIterationReceipt),
    generationSupersessions: document.generationSupersessions.filter((item) => item.subject === subject && item.runRef === run.runRef).map(publicGenerationSupersession),
  };
}

function metadata(document: StoreDocument, subject: string, run: StoredRun): RunMetadata {
  return {
    ...internalRun(run),
    ownerSubject: run.subject,
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
  const stages = document.stages.filter((item) => item.subject === subject && item.runRef === run.runRef);
  const iterationLoops = document.iterationLoops.filter((item) => item.subject === subject && item.runRef === run.runRef);
  const iterationReceipts = document.iterationReceipts.filter((item) => item.subject === subject && item.runRef === run.runRef);
  return {
    subject,
    run,
    stages,
    attempts: document.attempts.filter((item) => item.subject === subject && item.runRef === run.runRef),
    sessions: document.sessions.filter((item) => item.subject === subject && item.runRef === run.runRef),
    humanRequests: document.humanRequests.filter((item) => item.subject === subject && item.runRef === run.runRef),
    events: document.events.filter((item) => item.subject === subject && item.runRef === run.runRef),
    stageGenerations: document.stageGenerations.filter((item) => item.subject === subject && item.runRef === run.runRef),
    iterationLoops,
    iterationRequests: document.iterationRequests.filter((item) => item.subject === subject && item.runRef === run.runRef),
    iterationReceipts,
    generationSupersessions: document.generationSupersessions.filter((item) => item.subject === subject && item.runRef === run.runRef),
  };
}

function inventoryItem(bundle: QuarantinedRunBundle | Omit<QuarantinedRunBundle, 'quarantinedAt'>): StorageInventoryItem {
  return {
    runRef: bundle.run.runRef,
    title: bundle.run.title,
    state: projectRunState(bundle.run.lifecycle),
    updatedAt: bundle.run.updatedAt,
    eventCount: bundle.events.length,
    estimatedBytes: bundleBytes(bundle),
    quarantinedAt: 'quarantinedAt' in bundle ? bundle.quarantinedAt : null,
    ownerSubject: bundle.subject,
  };
}

function bundleIsQuarantineEligible(bundle: Omit<QuarantinedRunBundle, 'quarantinedAt'>): boolean {
  return canQuarantineRun(bundle.run.lifecycle)
    && bundle.stages.every((stage) => QUARANTINE_SETTLED_STAGE.has(stage.state))
    && bundle.attempts.every((attempt) => QUARANTINE_SETTLED_ATTEMPT.has(attempt.state))
    && bundle.sessions.every((session) => QUARANTINE_SETTLED_SESSION.has(session.state))
    && bundle.humanRequests.every((request) => request.state === 'resolved' && request.response !== null)
    && bundle.iterationLoops.every((loop) => loop.state === 'passed');
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

import {
  AUTHORIZED_20260731_EXECUTION_LOCK_NEW_PROMPT,
  AUTHORIZED_20260731_EXECUTION_LOCK_REQUEST_REF,
  AUTHORIZED_20260731_EXECUTION_LOCK_RUN_REF,
  AUTHORIZED_20260731_EXECUTION_LOCK_TITLE,
  AUTHORIZED_20260801_FAILED_RUN_REF,
  AUTHORIZED_20260801_FAILED_RUN_STAGES,
  AUTHORIZED_20260801_RECONCILIATION_SUMMARY,
  authorized20260731RecoveryFingerprint,
  authorized20260801FailedRunFingerprint,
  classifyAuthorized20260731ExecutionLock,
  classifyAuthorized20260801FailedRun,
  publicAuthorizedFailedRunReceipt,
  validateAuthorized20260731RecoveryDurability,
  validateAuthorized20260801FailedRunDurability,
} from './authorizedIncidentRecovery.ts';
export {
  AUTHORIZED_20260731_EXECUTION_LOCK_NEW_PROMPT,
  AUTHORIZED_20260731_EXECUTION_LOCK_OLD_PROMPT,
  AUTHORIZED_20260731_EXECUTION_LOCK_REQUEST_REF,
  AUTHORIZED_20260731_EXECUTION_LOCK_RUN_REF,
  AUTHORIZED_20260731_EXECUTION_LOCK_TITLE,
  AUTHORIZED_20260801_FAILED_RUN_FINGERPRINT,
  AUTHORIZED_20260801_FAILED_RUN_IDEMPOTENCY_KEY,
  AUTHORIZED_20260801_FAILED_RUN_INPUT,
  AUTHORIZED_20260801_FAILED_RUN_MANAGER_SESSION_REF,
  AUTHORIZED_20260801_FAILED_RUN_PROPOSAL_HASH,
  AUTHORIZED_20260801_FAILED_RUN_PROPOSAL_REF,
  AUTHORIZED_20260801_FAILED_RUN_REF,
  AUTHORIZED_20260801_FAILED_RUN_STAGES,
  exactAuthorized20260801ProposalRevision,
} from './authorizedIncidentRecovery.ts';

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

function iterationLoopForStage(document: StoreDocument, stage: StoredStage): StoredIterationLoop | undefined {
  return document.iterationLoops.find((loop) => loop.subject === stage.subject && loop.runRef === stage.runRef
    && loop.participants.some((participant) => participant.stageRef === stage.stageId));
}

function stageMaySucceed(document: StoreDocument, stage: StoredStage): boolean {
  const loop = iterationLoopForStage(document, stage);
  if (!loop || loop.state === 'passed') return true;
  const participant = loop.participants.find((candidate) => candidate.stageRef === stage.stageId);
  if (!participant) return false;
  if (loop.state === 'awaiting-seed') {
    if (participant.participantId !== loop.activation.seedParticipantId) return false;
    const generation = stage.currentGenerationRef === null ? undefined : document.stageGenerations.find((item) =>
      item.subject === stage.subject && item.generationRef === stage.currentGenerationRef);
    return generation?.state === 'committed';
  }
  if (loop.state !== 'running-turn' || !stage.currentAttemptRef) return false;
  const request = document.iterationRequests.find((item) => item.subject === stage.subject
    && item.iterationLoopRef === loop.iterationLoopRef && item.stepId === loop.currentStepId
    && item.recipientParticipantId === participant.participantId
    && !document.iterationReceipts.some((receipt) => receipt.subject === stage.subject && receipt.requestRef === item.requestRef));
  if (!request) return false;
  const attempt = document.attempts.find((item) => item.subject === stage.subject && item.attemptRef === stage.currentAttemptRef);
  if (attempt?.state !== 'succeeded') return false;
  if (!ARTIFACT_PRODUCING_REQUEST_KINDS.has(request.kind)) return true;
  const generation = stage.currentGenerationRef === null ? undefined : document.stageGenerations.find((item) =>
    item.subject === stage.subject && item.generationRef === stage.currentGenerationRef);
  return generation?.state === 'committed'
    && generation.canonicalResultOperationKey === iterationGenerationOperationKey(
      stage.runRef, stage.stageId, request.requestRef,
    );
}

function dependenciesSucceeded(document: StoreDocument, stage: StoredStage): boolean {
  const stages = new Map(document.stages
    .filter((candidate) => candidate.subject === stage.subject && candidate.runRef === stage.runRef)
    .map((candidate) => [candidate.stageId, candidate]));
  return stage.dependsOn.every((dependency) => {
    const dependencyStage = stages.get(dependency);
    if (!dependencyStage || dependencyStage.state !== 'succeeded') return false;
    const loop = iterationLoopForStage(document, dependencyStage);
    if (!loop) return true;
    const consumerLoop = iterationLoopForStage(document, stage);
    return consumerLoop?.iterationLoopRef === loop.iterationLoopRef || loop.state === 'passed';
  });
}

function dependenciesAcceptedForAttempt(document: StoreDocument, stage: StoredStage): boolean {
  const stages = new Map(document.stages
    .filter((candidate) => candidate.subject === stage.subject && candidate.runRef === stage.runRef)
    .map((candidate) => [candidate.stageId, candidate]));
  return stage.dependsOn.every((dependency) => {
    const dependencyStage = stages.get(dependency);
    if (!dependencyStage) return false;
    const loop = iterationLoopForStage(document, dependencyStage);
    if (!loop) return true;
    const consumerLoop = iterationLoopForStage(document, stage);
    return consumerLoop?.iterationLoopRef === loop.iterationLoopRef || loop.state === 'passed';
  });
}

function runCanSucceed(document: StoreDocument, run: StoredRun): boolean {
  const matches = <T extends { subject: string; runRef: string }>(value: T): boolean =>
    value.subject === run.subject && value.runRef === run.runRef;
  return document.stages.filter(matches).every((stage) => stage.state === 'succeeded')
    && document.iterationLoops.filter(matches).every((loop) => loop.state === 'passed')
    && document.attempts.filter(matches).every((attempt) => TERMINAL_ATTEMPT.has(attempt.state) || attempt.state === 'interrupted')
    && document.sessions.filter(matches).every((session) => TERMINAL_SESSION.has(session.state) || session.state === 'interrupted');
}

function validateStoreDocument(document: StoreDocument): void {
  assertDeploymentCollection(document.deployments);
  assertAssetPullCollection(document.assetPullIntents ?? []);
  // P6 W1b [P6-C48]: fail closed on a corrupt placement/advertisement/idempotency row rather than
  // loading it unvalidated — mirrors the same call in migrations.ts's assertDocumentInvariant so both
  // the migrated-load path and the read-only-harness path (which never runs migration) are covered.
  assertPlacementCollections({
    hostAdvertisements: document.hostAdvertisements ?? [],
    placementLeases: document.placementLeases ?? [],
    v1Idempotency: document.v1Idempotency ?? [],
    cursorSecret: document.cursorSecret,
  });
  const validateRows = (bundle: Pick<StoreDocumentCollections, 'runs' | 'stages'>): void => {
    for (const run of bundle.runs) {
      if (normalizeAssignment(run.managerAssignment) === undefined) {
        throw new Error('invalid control-plane assignment provenance');
      }
      if (normalizeAgentWorkspaceLaunch(run.agentWorkspaceLaunch) === undefined) {
        throw new Error('invalid control-plane agent-workspace launch provenance');
      }
      if (!decodeStoredRun(run)) throw new Error('invalid control-plane stored run');
    }
    for (const stage of bundle.stages) {
      if (normalizeAssignment(stage.assignment) === undefined) {
        throw new Error('invalid control-plane assignment provenance');
      }
      if (normalizeCheckerContract(stage) === undefined) {
        throw new Error('invalid control-plane checker contract provenance');
      }
    }
  };
  validateRows(document);
  for (const run of document.runs) {
    assertActivationReceipts(run);
    validateAuthorized20260801FailedRunDurability(document.events, run);
  }
  validateAuthorized20260731RecoveryDurability(document.humanRequests, document.events);
  for (const bundle of document.quarantine) {
    validateRows({ runs: [bundle.run], stages: bundle.stages });
    assertActivationReceipts(bundle.run);
    validateAuthorized20260731RecoveryDurability(bundle.humanRequests, bundle.events);
    validateAuthorized20260801FailedRunDurability(bundle.events, bundle.run);
  }
}

function iterationResidue(
  loop: StoredIterationLoop,
  requests: readonly StoredIterationRequest[],
  receipts: readonly StoredIterationReceipt[],
  activeGenerationRefs: readonly string[],
  nextRouteId: string,
  preIntegration?: {
    attemptedRequestRef: string;
    attemptedOutcome: NonNullable<ParkIterationLoopInput['attemptedOutcome']>;
    artifactSnapshots: NonNullable<ParkIterationLoopInput['artifactSnapshots']>;
    failureReason: string;
    cyclesUsed: number;
  },
): IterationResidue {
  const resolved = new Set(receipts.flatMap((item) => item.resolvedFindingRefs ?? []));
  const findings = new Map<string, IterationReceipt['findings'][number]>();
  const positions = new Map<string, IterationReceipt['positions'][number]>();
  const dissents = new Map<string, IterationReceipt['recordedDissent'][number]>();
  for (const item of receipts) {
    for (const finding of item.findings) if (!resolved.has(finding.findingId)) findings.set(finding.findingId, clone(finding));
    for (const position of item.positions) positions.set(position.positionId, clone(position));
    for (const dissent of item.recordedDissent) dissents.set(dissent.dissentId, clone(dissent));
  }
  const evidenceCycles = [...requests.map((item) => item.cycle), ...receipts.map((item) => item.cycle)];
  const cyclesUsed = preIntegration?.cyclesUsed ?? Math.max(1, ...evidenceCycles);
  const acceptedReceipt = [...receipts].reverse().find((item) => loop.terminalAuthorities.some((authority) =>
    authority.participantId === item.participantId && authority.verdict === item.verdict));
  // P1 permits at most one acceptance, so accepted residue is normally empty before termination.
  const acceptedGenerationRefs = acceptedReceipt ? [...acceptedReceipt.inputGenerationRefs] : [];
  return {
    unresolvedFindings: [...findings.values()], positions: [...positions.values()], recordedDissent: [...dissents.values()],
    requestRefs: requests.map((item) => item.requestRef), receiptRefs: receipts.map((item) => item.receiptRef),
    activeGenerationRefs: [...activeGenerationRefs], acceptedGenerationRefs, nextRouteId,
    cycleUnit: loop.cycleUnit, cyclesUsed, maxCycles: loop.maxCycles,
    ...(preIntegration ? {
      attemptedRequestRef: preIntegration.attemptedRequestRef,
      attemptedOutcome: clone(preIntegration.attemptedOutcome),
      artifactSnapshots: clone(preIntegration.artifactSnapshots),
      failureReason: preIntegration.failureReason,
    } : {}),
  };
}

function hasBlockingIterationRequest(document: StoreDocument, loop: StoredIterationLoop): boolean {
  const ownGateRefs = new Set([loop.completionGateRef, loop.interventionRef]
    .filter((value): value is string => value !== undefined));
  return document.humanRequests.some((request) => {
    if (request.subject !== loop.subject || request.runRef !== loop.runRef || request.state !== 'open') return false;
    if (ownGateRefs.has(request.requestRef)) return true;
    if (!['approval', 'intervention'].includes(request.kind) || isIterationGateRequest(document, request.requestRef)) return false;
    const requestLoop = request.stageRef === null ? undefined : document.iterationLoops.find((candidate) =>
      candidate.subject === request.subject && candidate.runRef === request.runRef
      && candidate.participants.some((participant) => document.stages.some((stage) =>
        stage.subject === candidate.subject && stage.runRef === candidate.runRef
        && stage.stageId === participant.stageRef && stage.stageRef === request.stageRef)));
    return requestLoop === undefined || requestLoop.iterationLoopRef === loop.iterationLoopRef;
  });
}

type IterationDurabilityBundle = Pick<StoreDocument,
  'stages' | 'attempts' | 'sessions' | 'stageGenerations' | 'generationSupersessions'
  | 'iterationLoops' | 'iterationRequests' | 'iterationReceipts' | 'humanRequests'>;

function validateGenericIterationBundle(bundle: IterationDurabilityBundle): void {
  validateIterationDurability(
    bundle.stages, bundle.attempts, bundle.sessions, bundle.stageGenerations, bundle.generationSupersessions,
    bundle.iterationLoops, bundle.iterationRequests, bundle.iterationReceipts, bundle.humanRequests,
  );
}

function iterationBundleForRun(document: StoreDocument, subject: string, runRef: string): IterationDurabilityBundle {
  const matches = <T extends { subject: string; runRef: string }>(value: T): boolean =>
    value.subject === subject && value.runRef === runRef;
  return {
    stages: document.stages.filter(matches), attempts: document.attempts.filter(matches),
    sessions: document.sessions.filter(matches), stageGenerations: document.stageGenerations.filter(matches),
    generationSupersessions: document.generationSupersessions.filter(matches),
    iterationLoops: document.iterationLoops.filter(matches), iterationRequests: document.iterationRequests.filter(matches),
    iterationReceipts: document.iterationReceipts.filter(matches), humanRequests: document.humanRequests.filter(matches),
  };
}

function validateIterationDurability(
  stages: readonly StoredStage[],
  attempts: readonly StoredAttempt[],
  _sessions: readonly StoredSession[],
  generations: readonly StoredStageGeneration[],
  supersessions: readonly StoredGenerationSupersession[],
  loops: readonly StoredIterationLoop[],
  requests: readonly StoredIterationRequest[],
  receipts: readonly StoredIterationReceipt[],
  humanRequests: readonly StoredHumanRequest[],
): void {
  const stageById = new Map(stages.map((stage) => [`${stage.subject}\0${stage.runRef}\0${stage.stageId}`, stage]));
  const stageByRef = new Map(stages.map((stage) => [stage.stageRef, stage]));
  const attemptByRef = new Map(attempts.map((attempt) => [attempt.attemptRef, attempt]));
  const generationByRef = new Map<string, StoredStageGeneration>();
  const generationKeys = new Set<string>();
  const generationOperations = new Set<string>();
  const generationFingerprintMatches = (
    generation: StoredStageGeneration,
    stage: StoredStage,
    attempt: StoredAttempt,
  ): boolean => {
    // A stage version may advance after a generation commits, while the terminal attempt version is
    // immutable. Search the complete historical CAS domain so later legitimate stage writes do not
    // weaken the generation content binding or impose a hidden lifecycle ceiling.
    for (let expectedStageVersion = 1; expectedStageVersion <= stage.version; expectedStageVersion += 1) {
      const fingerprint = sha256(JSON.stringify({
        stageRef: stage.stageRef,
        expectedStageVersion,
        expectedAttemptVersion: attempt.version,
        expectedGeneration: generation.generation,
        operationKey: generation.canonicalResultOperationKey,
        resultHash: generation.resultHash,
        resultCardRef: generation.resultCardRef,
        baseCommit: generation.baseCommit,
        canonicalCommit: generation.canonicalCommit,
      }));
      if (fingerprint === generation.operationFingerprint) return true;
    }
    return false;
  };
  for (const generation of generations) {
    const stage = stageByRef.get(generation.logicalStageRef);
    const attempt = attemptByRef.get(generation.attemptRef);
    const key = `${generation.logicalStageRef}:${generation.generation}`;
    const iterationOperation = requests.some((request) => {
      const loop = loops.find((candidate) => candidate.iterationLoopRef === request.iterationLoopRef);
      const participant = loop?.participants.find((candidate) => candidate.participantId === request.recipientParticipantId);
      return request.subject === generation.subject && request.runRef === generation.runRef
        && participant?.stageRef === generation.logicalStageId
        && generation.canonicalResultOperationKey === iterationGenerationOperationKey(
          generation.runRef, generation.logicalStageId, request.requestRef,
        );
    });
    if (!stage || !attempt || generation.subject !== stage.subject || generation.subject !== attempt.subject
      || generation.runRef !== stage.runRef || generation.runRef !== attempt.runRef || attempt.stageRef !== stage.stageRef
      || generation.logicalStageId !== stage.stageId || !Number.isSafeInteger(generation.generation) || generation.generation < 1
      || !SAFE_REF_RE.test(generation.generationRef) || !SAFE_REF_RE.test(generation.attemptRef)
      || !HASH_RE.test(generation.operationFingerprint)
      || generationByRef.has(generation.generationRef) || generationKeys.has(key)
      || (generation.canonicalResultOperationKey !== null && generationOperations.has(generation.canonicalResultOperationKey))
      || (generation.state === 'queued'
        ? generation.canonicalResultOperationKey !== null || generation.resultHash !== null || generation.resultCardRef !== null
          || generation.baseCommit !== null || generation.canonicalCommit !== null
        : generation.state !== 'committed' || (!iterationOperation && generation.canonicalResultOperationKey !== generationOperationKey(
          generation.runRef, generation.logicalStageId, generation.generation,
        )) || generation.resultHash === null || !HASH_RE.test(generation.resultHash)
          || !generationFingerprintMatches(generation, stage, attempt)
          || (generation.resultCardRef !== null && !SAFE_REF_RE.test(generation.resultCardRef))
          || (iterationOperation ? generation.resultCardRef !== null
            : generation.generation > 1 ? generation.resultCardRef !== null
              : stage.canonicalCardRef === null || generation.resultCardRef !== stage.canonicalCardRef)
          || generation.baseCommit === null || !CANONICAL_COMMIT_RE.test(generation.baseCommit)
          || generation.canonicalCommit === null || !CANONICAL_COMMIT_RE.test(generation.canonicalCommit))) {
      throw new Error('invalid control-plane stage generation');
    }
    generationByRef.set(generation.generationRef, generation);
    generationKeys.add(key);
    if (generation.canonicalResultOperationKey !== null) generationOperations.add(generation.canonicalResultOperationKey);
  }
  for (const generation of generations) {
    const predecessor = generation.predecessorGenerationRef === null ? null : generationByRef.get(generation.predecessorGenerationRef);
    if ((generation.generation === 1 && predecessor !== null)
      || (generation.generation > 1 && (!predecessor || predecessor.logicalStageRef !== generation.logicalStageRef
        || predecessor.generation !== generation.generation - 1))) {
      throw new Error('invalid control-plane stage generation predecessor');
    }
  }
  const loopByRef = new Map<string, StoredIterationLoop>();
  const participantStages = new Set<string>();
  for (const loop of loops) {
    if (!loop || typeof loop !== 'object' || !Array.isArray(loop.participants) || !Array.isArray(loop.routes)
      || !Array.isArray(loop.schedule) || !Array.isArray(loop.artifacts) || !Array.isArray(loop.criteria)
      || !Array.isArray(loop.activeGenerationRefs) || (loop.acceptedGenerationRefs !== undefined && !Array.isArray(loop.acceptedGenerationRefs))
      || !loop.activation || typeof loop.activation !== 'object' || !Array.isArray(loop.activation.seedArtifactIds)
      || !Array.isArray(loop.terminalAuthorities)) {
      throw new Error('invalid control-plane iteration loop');
    }
    const participantIds = new Set(loop.participants.map((participant) => participant.participantId));
    const routeIds = new Set(loop.routes.map((route) => route.routeId));
    const stepIds = new Set(loop.schedule.map((step) => step.stepId));
    const definition = (({ subject: _subject, iterationLoopRef: _ref, runRef: _run, definitionHash: _hash,
      cyclesUsed: _cycles, state: _state, turnOwnerParticipantId: _owner, currentStepId: _step,
      activeGenerationRefs: _active, acceptedGenerationRefs: _accepted, lastReceiptRef: _receipt,
      completionGateRef: _completionGate, interventionRef: _intervention, parkReason: _park,
      unresolvedResidue: _residue, advanceOperationKey: _advanceOperationKey,
      advanceOperationFingerprint: _advanceOperationFingerprint, version: _version,
      createdAt: _created, updatedAt: _updated, ...group }) => group)(loop);
    if (!SAFE_REF_RE.test(loop.iterationLoopRef) || loopByRef.has(loop.iterationLoopRef)
      || !SAFE_STAGE_ID_RE.test(loop.iterationGroupId) || loop.definitionHash !== iterationDefinitionHash(definition)
      || !Number.isSafeInteger(loop.version) || loop.version < 0
      || !Number.isSafeInteger(loop.cyclesUsed) || loop.cyclesUsed < 0 || loop.cyclesUsed > loop.maxCycles
      || !Number.isSafeInteger(loop.maxCycles) || loop.maxCycles < 1 || !validNonEmpty(loop.cycleUnit, MAX_LONG_TEXT)
      || loop.participants.length < 2 || participantIds.size !== loop.participants.length
      || loop.routes.length < 1 || routeIds.size !== loop.routes.length
      || loop.schedule.length < 1 || stepIds.size !== loop.schedule.length || !stepIds.has(loop.initialStepId)
      || !participantIds.has(loop.activation.seedParticipantId)
      || loop.activation.seedArtifactIds.some((artifact) => !loop.artifacts.includes(artifact))
      || (loop.completionGateRef !== undefined && !SAFE_REF_RE.test(loop.completionGateRef))
      || (loop.interventionRef !== undefined && !SAFE_REF_RE.test(loop.interventionRef))
      || ((loop.advanceOperationKey === undefined) !== (loop.advanceOperationFingerprint === undefined))
      || (loop.advanceOperationKey !== undefined && (!validNonEmpty(loop.advanceOperationKey, MAX_SHORT_TEXT)
        || !HASH_RE.test(loop.advanceOperationFingerprint ?? '')))
      || !['awaiting-seed', 'awaiting-turn', 'running-turn', 'failed', 'rework-queued', 'exhausted', 'parked',
        'awaiting-completion-gate', 'awaiting-park-gate', 'passed', 'declined'].includes(loop.state)) {
      throw new Error('invalid control-plane iteration loop');
    }
    for (const participant of loop.participants) {
      const stage = stageById.get(`${loop.subject}\0${loop.runRef}\0${participant.stageRef}`);
      const key = `${loop.subject}\0${loop.runRef}\0${participant.stageRef}`;
      if (!stage || participantStages.has(key) || !SAFE_REF_RE.test(participant.participantId)
        || !validNonEmpty(participant.mandate, MAX_LONG_TEXT) || !validNonEmpty(participant.perspective, MAX_LONG_TEXT)) {
        throw new Error('invalid control-plane iteration participant');
      }
      participantStages.add(key);
    }
    for (const route of loop.routes) {
      if (!participantIds.has(route.senderParticipantId) || !participantIds.has(route.recipientParticipantId)
        || route.senderParticipantId === route.recipientParticipantId || route.requestKinds.length < 1
        || route.baseResolutionStageIds.some((id) => !stageById.has(`${loop.subject}\0${loop.runRef}\0${id}`))) {
        throw new Error('invalid control-plane iteration route');
      }
    }
    for (const step of loop.schedule) {
      if (!routeIds.has(step.routeId) || (step.after && (!stepIds.has(step.after.stepId) || !participantIds.has(step.after.participantId)))) {
        throw new Error('invalid control-plane iteration schedule');
      }
    }
    if ((loop.turnOwnerParticipantId !== undefined && !participantIds.has(loop.turnOwnerParticipantId))
      || (loop.currentStepId !== undefined && !stepIds.has(loop.currentStepId))
      || loop.activeGenerationRefs.some((ref) => generationByRef.get(ref)?.runRef !== loop.runRef)
      || (loop.acceptedGenerationRefs ?? []).some((ref) => !loop.activeGenerationRefs.includes(ref))) {
      throw new Error('invalid control-plane iteration loop projection');
    }
    const hasAnyTurnProjection = loop.turnOwnerParticipantId !== undefined || loop.currentStepId !== undefined;
    const ownsTurn = loop.turnOwnerParticipantId !== undefined && loop.currentStepId !== undefined;
    const activeGenerations = loop.activeGenerationRefs.map((ref) => generationByRef.get(ref));
    const openTurnRequest = [...requests].reverse().find((request) => request.iterationLoopRef === loop.iterationLoopRef
      && request.stepId === loop.currentStepId && !receipts.some((receipt) => receipt.requestRef === request.requestRef));
    const turnOwner = loop.participants.find((participant) => participant.participantId === loop.turnOwnerParticipantId);
    const turnOwnerStage = turnOwner && stageById.get(`${loop.subject}\0${loop.runRef}\0${turnOwner.stageRef}`);
    const turnOwnerAttempt = turnOwnerStage?.currentAttemptRef === null ? undefined
      : attemptByRef.get(turnOwnerStage?.currentAttemptRef ?? '');
    const queuedProducerTurn = loop.state === 'running-turn'
      && openTurnRequest !== undefined && ARTIFACT_PRODUCING_REQUEST_KINDS.has(openTurnRequest.kind)
      && turnOwnerAttempt !== undefined && ['queued', 'starting', 'running', 'succeeded'].includes(turnOwnerAttempt.state)
      && activeGenerations.every((generation) => generation?.state === 'committed');
    const queuedProducerAttempt = loop.state === 'rework-queued' && (turnOwnerAttempt?.state === 'queued'
      || (turnOwnerAttempt?.state === 'interrupted' && turnOwnerStage?.state === 'waiting-human'
        && humanRequests.some((request) => request.subject === loop.subject && request.runRef === loop.runRef
          && request.stageRef === turnOwnerStage.stageRef && request.state === 'open'
          && request.gateKind !== 'iteration-park')))
      && turnOwnerStage !== undefined && turnOwnerAttempt.logicalGeneration === (turnOwnerStage.currentGenerationRef === null
        ? 1 : turnOwnerStage.currentGeneration + 1)
      && turnOwnerAttempt.baseGenerationRef === turnOwnerStage.currentGenerationRef;
    if ((loop.state === 'awaiting-seed' && (hasAnyTurnProjection || activeGenerations.length > 0 || loop.lastReceiptRef !== undefined))
      || (['awaiting-turn', 'running-turn'].includes(loop.state)
        && (!ownsTurn || activeGenerations.length < 1
          || (!queuedProducerTurn && activeGenerations.some((generation) => generation?.state !== 'committed'))))
      || (loop.state === 'awaiting-turn' && openTurnRequest !== undefined)
      || (loop.state === 'running-turn' && openTurnRequest === undefined)
      || (loop.state === 'rework-queued'
        && (!ownsTurn || !(queuedProducerAttempt && activeGenerations.every((generation) => generation?.state === 'committed'))))
      || (['failed', 'exhausted', 'parked', 'awaiting-completion-gate', 'awaiting-park-gate', 'passed', 'declined'].includes(loop.state)
        && hasAnyTurnProjection)) {
      throw new Error('invalid control-plane iteration loop state');
    }
    loopByRef.set(loop.iterationLoopRef, loop);
  }
  const requestByRef = new Map<string, StoredIterationRequest>();
  const requestCyclesByLoop = new Map<string, number[]>();
  for (const request of requests) {
    const loop = loopByRef.get(request.iterationLoopRef);
    const step = loop?.schedule.find((candidate) => candidate.stepId === request.stepId);
    const route = loop?.routes.find((candidate) => candidate.routeId === request.routeId);
    if (!loop || request.subject !== loop.subject || request.runRef !== loop.runRef
      || request.schema !== 'kb.iteration-request/v1' || !SAFE_REF_RE.test(request.requestRef) || requestByRef.has(request.requestRef)
      || !step || step.routeId !== request.routeId || !route
      || route.senderParticipantId !== request.senderParticipantId || route.recipientParticipantId !== request.recipientParticipantId
      || !route.requestKinds.includes(request.kind) || !Number.isSafeInteger(request.cycle) || request.cycle < 1 || request.cycle > loop.maxCycles
      || request.inputGenerationRefs.some((ref) => generationByRef.get(ref)?.runRef !== loop.runRef)
      || !CANONICAL_COMMIT_RE.test(request.baseCommit) || !HASH_RE.test(request.operationFingerprint)
      || Object.values(request.artifactHashes).some((hash) => !HASH_RE.test(hash))) {
      throw new Error('invalid control-plane iteration request');
    }
    if (request.operationFingerprint !== iterationRequestFingerprint(request)) {
      throw new Error('invalid control-plane iteration request fingerprint');
    }
    if (request.kind === 'rework'
      && (!validNonEmpty(request.instructions, MAX_LONG_TEXT) || !validNonEmpty(request.nextAcceptanceCheck, MAX_LONG_TEXT))) {
      throw new Error('invalid control-plane iteration request rework instructions');
    }
    requestByRef.set(request.requestRef, request);
    const cycles = requestCyclesByLoop.get(request.iterationLoopRef) ?? [];
    cycles.push(request.cycle);
    requestCyclesByLoop.set(request.iterationLoopRef, cycles);
  }
  const receiptByRef = new Map<string, StoredIterationReceipt>();
  const receiptCyclesByLoop = new Map<string, number[]>();
  const findingRefsByLoop = new Map<string, Set<string>>();
  for (const receipt of receipts) {
    const loop = loopByRef.get(receipt.iterationLoopRef);
    const request = requestByRef.get(receipt.requestRef);
    const inputGenerations = receipt.inputGenerationRefs.map((ref) => generationByRef.get(ref));
    const outputGenerations = receipt.outputGenerationRefs.map((ref) => generationByRef.get(ref));
    const fulfilled = receipt.verdict === 'fulfilled';
    const primaryGeneration = fulfilled ? outputGenerations[0]
      : inputGenerations[0];
    const recipientStageId = loop?.participants.find((participant) =>
      participant.participantId === request?.recipientParticipantId)?.stageRef;
    const participantStage = recipientStageId === undefined ? undefined
      : stageById.get(`${receipt.subject}\0${receipt.runRef}\0${recipientStageId}`);
    const participantAttempt = attemptByRef.get(receipt.participantAttemptRef);
    const outcome = {
      requestRef: receipt.requestRef, iterationLoopRef: receipt.iterationLoopRef, participantId: receipt.participantId,
      cycle: receipt.cycle, verdict: receipt.verdict, inputGenerationRefs: receipt.inputGenerationRefs,
      criteria: receipt.criteria, findings: receipt.findings, positions: receipt.positions,
      ...(receipt.resolvedFindingRefs === undefined ? {} : { resolvedFindingRefs: receipt.resolvedFindingRefs }),
      recordedDissent: receipt.recordedDissent, summary: receipt.summary,
    };
    if (!loop || !request || receipt.subject !== loop.subject || receipt.runRef !== loop.runRef
      || receipt.schema !== 'kb.iteration-receipt/v1' || !SAFE_REF_RE.test(receipt.receiptRef) || receiptByRef.has(receipt.receiptRef)
      || receipt.participantId !== request.recipientParticipantId || receipt.cycle !== request.cycle
      || canonicalJson(receipt.inputGenerationRefs as unknown as JsonValue) !== canonicalJson(request.inputGenerationRefs as unknown as JsonValue)
      || !primaryGeneration || !participantStage || !participantAttempt
      || participantAttempt.subject !== receipt.subject || participantAttempt.runRef !== receipt.runRef
      || participantAttempt.stageRef !== participantStage.stageRef || participantAttempt.state !== 'succeeded'
      || inputGenerations.some((generation) => !generation || generation.state !== 'committed')
      || (fulfilled && outputGenerations.some((generation) => !generation || generation.state !== 'committed'
        || generation.baseCommit !== receipt.baseCommit || generation.canonicalCommit !== receipt.canonicalCommit
        || generation.logicalStageId !== recipientStageId || generation.attemptRef !== receipt.participantAttemptRef))
      || (!fulfilled && (primaryGeneration.baseCommit !== receipt.baseCommit
        || primaryGeneration.canonicalCommit !== receipt.canonicalCommit))
      || (fulfilled && (receipt.outputGenerationRefs.length !== 1
        || new Set(receipt.outputGenerationRefs).size !== receipt.outputGenerationRefs.length))
      || (!fulfilled && receipt.outputGenerationRefs.length !== 0)
      || receipt.outcomeHash !== sha256(canonicalJson(outcome as unknown as JsonValue))
      || !CANONICAL_COMMIT_RE.test(receipt.baseCommit) || !CANONICAL_COMMIT_RE.test(receipt.canonicalCommit)
      || !HASH_RE.test(receipt.operationFingerprint) || !Number.isSafeInteger(receipt.version) || receipt.version < 1
      || receipt.findings.some((finding) => !SAFE_REF_RE.test(finding.findingId))) {
      throw new Error('invalid control-plane iteration receipt');
    }
    receiptByRef.set(receipt.receiptRef, receipt);
    const receiptCycles = receiptCyclesByLoop.get(receipt.iterationLoopRef) ?? [];
    receiptCycles.push(receipt.cycle);
    receiptCyclesByLoop.set(receipt.iterationLoopRef, receiptCycles);
    const findingRefs = findingRefsByLoop.get(receipt.iterationLoopRef) ?? new Set<string>();
    const receiptFindingRefs = new Set<string>();
    for (const finding of receipt.findings) {
      if (receiptFindingRefs.has(finding.findingId)) throw new Error('invalid control-plane iteration finding reference');
      receiptFindingRefs.add(finding.findingId);
      findingRefs.add(finding.findingId);
    }
    findingRefsByLoop.set(receipt.iterationLoopRef, findingRefs);
  }
  for (const request of requests) {
    const findingRefs = findingRefsByLoop.get(request.iterationLoopRef) ?? new Set<string>();
    if (request.unresolvedFindingRefs.some((ref) => !findingRefs.has(ref))) {
      throw new Error('invalid control-plane iteration request finding reference');
    }
  }
  const generationByAttemptRef = new Map(generations.map((generation) => [generation.attemptRef, generation]));
  for (const attempt of attempts) {
    const hasIterationAdvance = attempt.iterationAdvanceOperationKey !== undefined
      || attempt.iterationAdvanceOperationFingerprint !== undefined || attempt.iterationAdvanceReceiptRef !== undefined;
    if (hasIterationAdvance && (!validNonEmpty(attempt.iterationAdvanceOperationKey, MAX_SHORT_TEXT)
      || !HASH_RE.test(attempt.iterationAdvanceOperationFingerprint ?? '')
      || (attempt.iterationAdvanceReceiptRef !== null
        && !receiptByRef.has(attempt.iterationAdvanceReceiptRef ?? '')))) {
      throw new Error('invalid control-plane iteration advance attempt');
    }
    if (attempt.logicalGeneration !== null) {
      const generation = generationByAttemptRef.get(attempt.attemptRef);
      const predecessor = generation?.predecessorGenerationRef
        ? generationByRef.get(generation.predecessorGenerationRef) : undefined;
      const pendingPredecessor = attempt.baseGenerationRef === null
        ? undefined : generationByRef.get(attempt.baseGenerationRef);
      const pendingRequest = requests.find((request) => {
        if (receipts.some((receipt) => receipt.requestRef === request.requestRef)) return false;
        const loop = loopByRef.get(request.iterationLoopRef);
        const participant = loop?.participants.find((candidate) => candidate.participantId === request.recipientParticipantId);
        return participant?.stageRef === stageByRef.get(attempt.stageRef)?.stageId
          && ARTIFACT_PRODUCING_REQUEST_KINDS.has(request.kind);
      });
      const pendingBaseCommit = pendingRequest?.baseCommit ?? pendingPredecessor?.canonicalCommit ?? null;
      if (!generation
        ? attempt.logicalGeneration === 1
          ? attempt.baseGenerationRef !== null || attempt.baseCommit !== (pendingRequest?.baseCommit ?? null)
          : !pendingPredecessor || pendingPredecessor.logicalStageRef !== attempt.stageRef
            || pendingPredecessor.generation !== attempt.logicalGeneration - 1
            || attempt.baseCommit !== pendingBaseCommit
        : generation.logicalStageRef !== attempt.stageRef || attempt.logicalGeneration !== generation.generation
          || (generation.generation === 1
            ? attempt.baseGenerationRef !== null
              || (attempt.baseCommit !== null && attempt.baseCommit !== generation.baseCommit)
            : !predecessor || attempt.baseGenerationRef !== predecessor.generationRef
              || attempt.baseCommit !== (generation.state === 'queued' ? pendingBaseCommit : generation.baseCommit))) {
        throw new Error('invalid control-plane creator attempt generation provenance');
      }
    } else if (attempt.baseGenerationRef !== null || attempt.baseCommit !== null) {
      throw new Error('invalid control-plane iteration attempt generation provenance');
    }
  }
  const supersessionsBySuccessor = new Map<string, StoredGenerationSupersession[]>();
  for (const supersession of supersessions) {
    const predecessor = generationByRef.get(supersession.predecessorGenerationRef);
    const successor = generationByRef.get(supersession.successorGenerationRef);
    if (!predecessor || !successor || supersession.subject !== predecessor.subject || supersession.subject !== successor.subject
      || supersession.runRef !== predecessor.runRef || supersession.runRef !== successor.runRef
      || successor.logicalStageRef !== predecessor.logicalStageRef || successor.generation !== predecessor.generation + 1
      || successor.predecessorGenerationRef !== predecessor.generationRef
      || !SAFE_REF_RE.test(supersession.triggerReceiptRef) || !receiptByRef.has(supersession.triggerReceiptRef)) {
      throw new Error('invalid control-plane generation supersession receipt');
    }
    const links = supersessionsBySuccessor.get(supersession.successorGenerationRef) ?? [];
    links.push(supersession);
    supersessionsBySuccessor.set(supersession.successorGenerationRef, links);
  }
  for (const generation of generations) {
    if (generation.generation < 2) continue;
    const links = supersessionsBySuccessor.get(generation.generationRef) ?? [];
    if (links.length !== 1 || links[0]?.predecessorGenerationRef !== generation.predecessorGenerationRef) {
      throw new Error('invalid control-plane generation supersession completeness');
    }
  }
  const humanByRef = new Map(humanRequests.map((request) => [request.requestRef, request]));
  for (const loop of loops) {
    if (loop.lastReceiptRef !== undefined && !receiptByRef.has(loop.lastReceiptRef)) throw new Error('invalid control-plane iteration loop receipt');
    for (const ref of [loop.completionGateRef, loop.interventionRef]) {
      if (ref !== undefined && (humanByRef.get(ref)?.runRef !== loop.runRef
        || humanByRef.get(ref)?.subject !== loop.subject)) throw new Error('invalid control-plane iteration gate');
    }
    if (loop.state === 'passed' && loop.interventionRef !== undefined) {
      const resolvedParkGate = humanByRef.get(loop.interventionRef);
      if (resolvedParkGate?.gateKind !== 'iteration-park' || resolvedParkGate.state !== 'resolved'
        || resolvedParkGate.response?.decision !== 'approved') {
        throw new Error('invalid control-plane iteration passed intervention');
      }
    }
    if (loop.state === 'passed' && (loop.acceptedGenerationRefs?.length ?? 0) < 1) throw new Error('invalid control-plane iteration accepted artifacts');
    const completionGate = loop.completionGateRef === undefined ? undefined : humanByRef.get(loop.completionGateRef);
    const iterationParkGate = loop.interventionRef === undefined ? undefined : humanByRef.get(loop.interventionRef);
    if (loop.state === 'awaiting-completion-gate'
      && (!completionGate || completionGate.kind !== 'approval' || completionGate.gateKind !== undefined
        || completionGate.state !== 'open' || completionGate.response !== null)) {
      throw new Error('invalid control-plane iteration completion gate');
    }
    if (loop.state === 'awaiting-park-gate'
      && (!iterationParkGate || iterationParkGate.kind !== 'approval' || iterationParkGate.gateKind !== 'iteration-park'
        || iterationParkGate.state !== 'open' || iterationParkGate.response !== null
        || loop.parkReason === undefined || loop.unresolvedResidue === undefined)) {
      throw new Error('invalid control-plane iteration park gate');
    }
    if (loop.state === 'declined'
      && (!iterationParkGate || iterationParkGate.gateKind !== 'iteration-park' || iterationParkGate.state !== 'resolved'
        || iterationParkGate.response?.decision !== 'rejected' || (loop.acceptedGenerationRefs?.length ?? 0) !== 0)) {
      throw new Error('invalid control-plane declined iteration gate');
    }
    if (loop.parkReason !== undefined && loop.state === 'passed'
      && (!iterationParkGate || iterationParkGate.gateKind !== 'iteration-park' || iterationParkGate.state !== 'resolved'
        || iterationParkGate.response?.decision !== 'approved' || loop.unresolvedResidue === undefined)) {
      throw new Error('invalid control-plane approved iteration park gate');
    }
    if (loop.unresolvedResidue && (loop.unresolvedResidue.cyclesUsed !== loop.cyclesUsed
      || loop.unresolvedResidue.maxCycles !== loop.maxCycles || loop.unresolvedResidue.cycleUnit !== loop.cycleUnit)) {
      throw new Error('invalid control-plane iteration residue');
    }
    if (loop.unresolvedResidue) {
      const residue = loop.unresolvedResidue;
      const evidence = [residue.attemptedRequestRef, residue.attemptedOutcome,
        residue.artifactSnapshots, residue.failureReason];
      const hasNoProgressEvidence = evidence.some((value) => value !== undefined);
      if (hasNoProgressEvidence) {
        const attemptedRequest = residue.attemptedRequestRef === undefined
          ? undefined : requestByRef.get(residue.attemptedRequestRef);
        const parsed = attemptedRequest && residue.attemptedOutcome !== undefined
          ? parseIterationOutcome(JSON.stringify(residue.attemptedOutcome), { iterationGroup: loop, request: attemptedRequest })
          : null;
        const snapshots = residue.artifactSnapshots;
        if (loop.parkReason !== 'no-progress' || !attemptedRequest || attemptedRequest.iterationLoopRef !== loop.iterationLoopRef
          || !parsed?.ok || canonicalJson(parsed.value as unknown as JsonValue)
            !== canonicalJson(residue.attemptedOutcome as unknown as JsonValue)
          || !ARTIFACT_PRODUCING_REQUEST_KINDS.has(attemptedRequest.kind)
          || !Array.isArray(snapshots) || snapshots.length < 1
          || new Set(snapshots.map((snapshot) => snapshot.path)).size !== snapshots.length
          || snapshots.some((snapshot) => !validIterationArtifactSnapshot(snapshot))
          || !validNonEmpty(residue.failureReason, MAX_LONG_TEXT)) {
          throw new Error('invalid control-plane iteration no-progress residue');
        }
      } else if (loop.parkReason === 'no-progress') {
        throw new Error('invalid control-plane iteration no-progress residue');
      }
    }
    const receiptCycles = receiptCyclesByLoop.get(loop.iterationLoopRef) ?? [];
    const greatestReceiptCycle = Math.max(0, ...receiptCycles);
    const cycleMayBeInFlight = ['awaiting-turn', 'running-turn', 'rework-queued'].includes(loop.state)
      || (loop.state === 'awaiting-park-gate' && loop.parkReason === 'no-progress');
    const minimumDerivedCycle = loop.state === 'awaiting-seed' ? 0 : Math.max(1, greatestReceiptCycle);
    const maximumDerivedCycle = loop.state === 'awaiting-seed' ? 0
      : greatestReceiptCycle + (cycleMayBeInFlight ? 1 : 0);
    if (loop.cyclesUsed < minimumDerivedCycle || loop.cyclesUsed > maximumDerivedCycle) {
      throw new Error('invalid control-plane iteration cycle evidence');
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
  }
}

function makeStore(
  load: () => StoreDocument,
  save: (document: StoreDocument, durability?: SaveDurability) => void,
  options: ControlStoreOptions,
): ControlPlaneStore {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? randomUUID;
  const maxEvents = options.maxEventsPerRun ?? MAX_EVENTS_PER_RUN;
  const ref = (prefix: string): string => `${prefix}-${newId()}`;
  const stamp = (): string => now().toISOString();

  /**
   * The one place a run is resolved from a ref. `scope` defaults to `'own-subject'`, so every path
   * below keeps the exact ownership check it always had unless it explicitly opts in; only the calls a
   * verified operator session drives ever pass `'all-subjects'` (see {@link ReadScope}). Run refs are
   * globally unique (`run-<uuid>`), so widening the scope can never resolve a ref to a different
   * subject's run by accident — it only stops hiding one.
   *
   * A caller that widens must then read ownership off the RESOLVED RUN (`run.subject`), never off its
   * own `subject`, for every sibling-record lookup and every record it stamps. `run.subject` is
   * immutable — no path assigns it after `createRun` — so it is a stable partition key.
   */
  const findRun = (document: StoreDocument, subject: string, runRef: string, scope: ReadScope = 'own-subject'): StoredRun | undefined =>
    document.runs.find((item) => item.runRef === runRef && (scope === 'all-subjects' || item.subject === subject));

  /** {@link findRun} for a Human Request, which the respond paths resolve by ref without a run ref. */
  const findHumanRequest = (
    document: StoreDocument, subject: string, requestRef: string, scope: ReadScope = 'own-subject',
  ): StoredHumanRequest | undefined =>
    document.humanRequests.find((item) => item.requestRef === requestRef && (scope === 'all-subjects' || item.subject === subject));

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

  const commit = (document: StoreDocument, durability: SaveDurability = 'ordinary'): void => {
    document.documentRevision += 1;
    save(document, durability);
  };

  interface IterationTransitionTarget {
    subject: string;
    iterationLoopRef?: string;
    requestRef?: string;
    receiptRef?: string;
    gateRef?: string;
    expectedLoopVersion?: number;
    expectedReceiptVersion?: number | null;
    missingDetail: string;
    conflictDetail: string;
  }

  interface IterationTransitionContext {
    loop: StoredIterationLoop;
    request?: StoredIterationRequest;
    receipt?: StoredIterationReceipt;
  }

  /** Sole iteration CAS/persistence core. */
  const transitionIterationState = <T>(
    document: StoreDocument,
    target: IterationTransitionTarget,
    mutate: (context: IterationTransitionContext) => ControlResult<T>,
  ): ControlResult<T> => {
    let receipt = target.receiptRef !== undefined
      ? document.iterationReceipts.find((item) => item.subject === target.subject && item.receiptRef === target.receiptRef)
      : undefined;
    const receiptRequestRef = receipt?.requestRef;
    const request = target.requestRef !== undefined
      ? document.iterationRequests.find((item) => item.subject === target.subject && item.requestRef === target.requestRef)
      : receiptRequestRef !== undefined
        ? document.iterationRequests.find((item) => item.subject === target.subject && item.requestRef === receiptRequestRef)
        : undefined;
    const receiptLoopRef = receipt?.iterationLoopRef;
    const loop = receiptLoopRef !== undefined
      ? document.iterationLoops.find((item) => item.subject === target.subject && item.iterationLoopRef === receiptLoopRef)
      : request
        ? document.iterationLoops.find((item) => item.subject === target.subject && item.iterationLoopRef === request.iterationLoopRef)
        : target.iterationLoopRef !== undefined
          ? document.iterationLoops.find((item) => item.subject === target.subject && item.iterationLoopRef === target.iterationLoopRef)
      : target.gateRef !== undefined
        ? document.iterationLoops.find((candidate) => candidate.subject === target.subject
          && (candidate.completionGateRef === target.gateRef || candidate.interventionRef === target.gateRef))
        : undefined;
    if (!receipt && target.gateRef !== undefined && loop?.lastReceiptRef !== undefined) {
      receipt = document.iterationReceipts.find((item) => item.subject === target.subject
        && item.receiptRef === loop.lastReceiptRef);
    }
    if (!loop || (target.receiptRef !== undefined && !receipt)) {
      return fail('conflict', target.missingDetail);
    }
    if ((target.expectedLoopVersion !== undefined && loop.version !== target.expectedLoopVersion)
      || (target.expectedReceiptVersion !== undefined && (target.expectedReceiptVersion === null
        ? receipt !== undefined : receipt?.version !== target.expectedReceiptVersion))) {
      return fail('conflict', target.conflictDetail);
    }
    const result = mutate({ loop, ...(request ? { request } : {}), ...(receipt ? { receipt } : {}) });
    if (!result.ok) return result;
    validateGenericIterationBundle(iterationBundleForRun(document, loop.subject, loop.runRef));
    commit(document);
    return result;
  };

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

  const quarantinePlan = (
    document: StoreDocument, subject: string, runRefs: string[], createdAt: string, scope: ReadScope = 'own-subject',
  ): ControlResult<QuarantinePlan> => {
    const unique = [...new Set(runRefs)].sort();
    if (unique.length === 0 || unique.length !== runRefs.length) return fail('invalid', 'runRefs must be a non-empty array without duplicates');
    const items = [];
    const bundleHashes: Array<{ runRef: string; bundleHash: string }> = [];
    for (const runRef of unique) {
      const run = findRun(document, subject, runRef, scope);
      if (!run) return fail('not-found', `run '${runRef}' was not found`);
      // The bundle is assembled under the RUN's OWN subject, so a widened plan describes exactly the
      // records that will move — reading the siblings as the CALLER would return an empty bundle and
      // report a foreign run as costless and trivially eligible.
      const bundle = activeBundle(document, run.subject, run);
      const item = inventoryItem(bundle);
      items.push({ ...item, eligible: bundleIsQuarantineEligible(bundle) });
      bundleHashes.push({ runRef, bundleHash: quarantineBundleHash(bundle) });
    }
    const planBody: JsonObject = {
      runs: bundleHashes,
    };
    return ok({
      // The plan hash stays keyed to the CALLER, not the owner: it is the dry-run → execute CAS for one
      // reviewer's confirmation, and both halves are computed by the same caller. Keying it to the owner
      // would let two different callers' confirmations satisfy each other's CAS.
      planHash: sha256(`${subject}\n${canonicalJson(planBody)}`),
      createdAt,
      items,
      estimatedBytes: items.reduce((sum, item) => sum + item.estimatedBytes, 0),
    });
  };

  const publicSchedule = (schedule: StoredSchedule): Schedule => ({
    id: schedule.id,
    owner: clone(schedule.owner),
    cadence: { ...schedule.cadence },
    nextAt: schedule.nextAt,
    lastOutcome: schedule.lastOutcome,
    armed: schedule.armed,
    origin: schedule.origin,
    mirroredAt: schedule.mirroredAt,
    mirrorPath: schedule.mirrorPath,
    version: schedule.version,
  });

  const scheduleSnapshot = (document: StoreDocument): ScheduleSnapshot => ({
    collectionRevision: document.scheduleCollectionRevision,
    schedules: document.schedules.map(publicSchedule),
  });

  // P4 section 3.5 mirror revision. Absent fields default to 0 so a pre-P4 document reads without
  // error; a mirror-relevant mutation is the only thing that advances the counter [P4-C37].
  const scheduleMirrorRevisionOf = (document: StoreDocument): number => document.scheduleMirrorRevision ?? 0;

  const advanceScheduleMirrorRevision = (
    document: StoreDocument,
    ...rows: Array<{ lastMirrorRevision?: number }>
  ): number => {
    const next = scheduleMirrorRevisionOf(document) + 1;
    document.scheduleMirrorRevision = next;
    for (const row of rows) row.lastMirrorRevision = next;
    return next;
  };

  /**
   * The mirror projection. `name` is the seed cadence identity the HEARTBEAT file is keyed on — a
   * row that no seed import produced has none, reads null, and is skipped by the renderer rather
   * than invented from `owner.id` (which would re-import under a different `seedScheduleId`).
   * `schedule` is the canonical source expression the file's own consumers parse, never the words.
   */
  const scheduleMirrorRow = (schedule: StoredSchedule): ScheduleMirrorRow => {
    const cadenceName = schedule.launchPayload?.cadenceName;
    return {
      id: schedule.id,
      name: typeof cadenceName === 'string' && cadenceName !== '' ? cadenceName : null,
      schedule: schedule.cadenceCanonical,
      agent: schedule.owner.type === 'agent' ? schedule.owner.id : null,
      armed: schedule.armed,
      mirrorPath: schedule.mirrorPath,
      lastMirrorRevision: schedule.lastMirrorRevision ?? 0,
    };
  };

  /** The watermark of a store that has never merged a mirror batch. */
  const unmirroredWatermark = (): ScheduleMirrorWatermark => ({
    revision: 0,
    digest: sha256('schedule-mirror-unmirrored'),
  });

  const storedScheduleMirrorBatch = (document: StoreDocument): ScheduleMirrorBatch | null => {
    const wrapper = document.scheduleMirrorBatch;
    if (!wrapper || typeof wrapper !== 'object') return null;
    const record = (wrapper as JsonObject)['record'];
    if (record === undefined || record === null) return null;
    return decodeScheduleMirrorBatch(record);
  };

  const scheduleMirrorBatchJson = (batch: ScheduleMirrorBatch): JsonObject =>
    JSON.parse(JSON.stringify(batch)) as JsonObject;

  /**
   * The additive P4 mirror fields of one row. A live schedule declares them; a tombstone is a
   * `JsonObject` and reaches them by index, so both are handled through this one view.
   */
  type ScheduleMirrorFields = { id: string; lastMirrorRevision?: number; mirroredAt?: string | null };
  const scheduleMirrorFields = (row: StoredSchedule | StoredScheduleTombstone): ScheduleMirrorFields =>
    row as unknown as ScheduleMirrorFields;

  const mirrorRows = (document: StoreDocument): ScheduleMirrorFields[] =>
    [...document.schedules, ...document.scheduleTombstones].map(scheduleMirrorFields);

  /** Materialise the additive P4 fields on an existing document. No version bump, no migration. */
  const materialiseScheduleMirrorFields = (document: StoreDocument): boolean => {
    let changed = false;
    if (document.scheduleMirrorRevision === undefined) {
      document.scheduleMirrorRevision = 0;
      changed = true;
    }
    for (const row of mirrorRows(document)) {
      if (row.lastMirrorRevision === undefined) {
        row.lastMirrorRevision = 0;
        changed = true;
      }
    }
    return changed;
  };

  const scheduleFailure = (status: number, code: string): Error & { status: number; code: string } =>
    Object.assign(new Error(code), { status, code });

  const scheduleReceiptRows = (document: StoreDocument): JsonObject[][] => [
    ...document.schedules.map((schedule) => schedule.operationReceipts),
    ...document.scheduleTombstones.map((tombstone) => tombstone.operationReceipts),
  ];

  const appendScheduleMutationEvent = (
    document: StoreDocument,
    target: JsonObject[],
    input: Omit<ScheduleMutationEvent, 'kind' | 'cursor' | 'createdAt'>,
  ): void => {
    const event: ScheduleMutationEvent = {
      kind: 'schedule-mutation-event',
      cursor: document.nextEventCursor,
      createdAt: stamp(),
      ...input,
    };
    document.nextEventCursor += 1;
    target.push(clone(event as unknown as JsonObject));
  };

  let scheduleTransactionTail: Promise<void> = Promise.resolve();
  const scheduleTransaction = <T>(operation: (transaction: ScheduleMutationTransaction) => Promise<T>): Promise<T> => {
    const run = scheduleTransactionTail.then(async () => {
      const document = load();
      let dirty = false;
      const transaction: ScheduleMutationTransaction = {
        readScheduleSnapshot: async () => clone(scheduleSnapshot(document)),
        readMutationReceipt: async (key) => {
          const row = scheduleReceiptRows(document).flat().find((candidate) =>
            candidate.operation === key.operation && candidate.target === key.target
            && candidate.idempotencyKey === key.idempotencyKey);
          if (!row || typeof row.fingerprint !== 'string' || typeof row.receipt !== 'object' || row.receipt === null) return null;
          return clone({ fingerprint: row.fingerprint, receipt: row.receipt } as unknown as StoredScheduleMutationReceipt);
        },
        writeMutationReceipt: async (key, fingerprint, receipt) => {
          const target = 'schedule' in receipt
            ? document.schedules.find((schedule) => schedule.id === receipt.schedule.id)?.operationReceipts
            : document.scheduleTombstones.find((tombstone) => tombstone.id === receipt.tombstone.id)?.operationReceipts;
          if (!target) throw scheduleFailure(500, 'schedule-mutation-receipt-target-missing');
          target.push(clone({ ...key, fingerprint, receipt } as unknown as JsonObject));
          dirty = true;
        },
        createSchedule: async (input: ResolvedCreateScheduleInput) => {
          if (input.expectedCollectionRevision !== document.scheduleCollectionRevision) {
            throw scheduleFailure(409, 'stale-schedule-collection');
          }
          const id = sha256(`schedule\0operator\0${input.owner.type}\0${input.owner.id}\0${input.idempotencyKey}`);
          if (document.schedules.some((schedule) => schedule.id === id)
            || document.scheduleTombstones.some((tombstone) => tombstone.id === id)) {
            throw scheduleFailure(409, 'schedule-id-conflict');
          }
          const schedule: StoredSchedule = {
            id,
            owner: clone(input.owner),
            cadence: { ...input.cadence },
            cadenceCanonical: input.cadence.source,
            nextAt: null,
            lastOutcome: null,
            armed: false,
            origin: 'operator',
            mirroredAt: null,
            mirrorPath: input.mirrorPath,
            version: 1,
            seedBytes: null,
            seedDigest: null,
            seedAuthorized: false,
            launchPayload: null,
            operationReceipts: [],
            emissionReceipts: [],
            mirrorMetadataRevision: 0,
            tombstone: null,
          };
          document.schedules.push(schedule);
          document.scheduleCollectionRevision += 1;
          advanceScheduleMirrorRevision(document, schedule);
          dirty = true;
          return { schedule: publicSchedule(schedule), collectionRevision: document.scheduleCollectionRevision, replayed: false };
        },
        setScheduleArmed: async (id: string, input: SetScheduleArmedInput) => {
          const schedule = document.schedules.find((candidate) => candidate.id === id);
          if (!schedule) throw scheduleFailure(404, 'schedule-not-found');
          if (schedule.version !== input.expectedVersion) throw scheduleFailure(409, 'stale-schedule-version');
          schedule.armed = input.armed;
          schedule.version += 1;
          document.scheduleCollectionRevision += 1;
          advanceScheduleMirrorRevision(document, schedule);
          appendScheduleMutationEvent(document, schedule.operationReceipts, {
            operation: input.armed ? 'armed' : 'disarmed',
            scheduleId: id,
            scheduleVersion: schedule.version,
            collectionRevision: document.scheduleCollectionRevision,
            idempotencyKey: input.idempotencyKey,
          });
          dirty = true;
          return { schedule: publicSchedule(schedule), collectionRevision: document.scheduleCollectionRevision, replayed: false };
        },
        deleteSchedule: async (id: string, input: DeleteScheduleInput): Promise<DeleteScheduleReceipt> => {
          const index = document.schedules.findIndex((candidate) => candidate.id === id);
          if (index === -1) throw scheduleFailure(404, 'schedule-not-found');
          const schedule = document.schedules[index];
          if (schedule.version !== input.expectedVersion) throw scheduleFailure(409, 'stale-schedule-version');
          document.scheduleCollectionRevision += 1;
          appendScheduleMutationEvent(document, schedule.operationReceipts, {
            operation: 'deleted',
            scheduleId: id,
            scheduleVersion: schedule.version + 1,
            collectionRevision: document.scheduleCollectionRevision,
            idempotencyKey: input.idempotencyKey,
          });
          const tombstone: StoredScheduleTombstone = {
            id,
            deletedAt: stamp(),
            version: schedule.version + 1,
            operationReceipts: schedule.operationReceipts,
          };
          document.schedules.splice(index, 1);
          document.scheduleTombstones.push(tombstone);
          advanceScheduleMirrorRevision(document, scheduleMirrorFields(tombstone));
          dirty = true;
          return {
            tombstone: { id, deletedAt: tombstone.deletedAt, version: tombstone.version },
            collectionRevision: document.scheduleCollectionRevision,
            replayed: false,
          };
        },
        claimScheduleOccurrence: async (input) => {
          const schedule = document.schedules.find((candidate) => candidate.id === input.occurrence.scheduleId);
          if (!schedule) throw scheduleFailure(404, 'schedule-not-found');
          if (schedule.version !== input.expectedVersion) throw scheduleFailure(409, 'stale-schedule-version');
          if (!schedule.armed) throw scheduleFailure(409, 'schedule-not-armed');
          const fingerprint = sha256(canonicalJson(input as unknown as JsonValue));
          const prior = document.scheduleOccurrenceClaims.find((candidate) =>
            candidate.scheduleId === input.occurrence.scheduleId && candidate.scheduledFor === input.occurrence.scheduledFor);
          if (prior) {
            if (prior.idempotencyKey !== input.idempotencyKey || prior.fingerprint !== fingerprint) {
              throw scheduleFailure(409, 'schedule-occurrence-conflict');
            }
            return clone({
              scheduleId: prior.scheduleId,
              scheduledFor: prior.scheduledFor,
              owner: prior.owner as unknown as RunnableRef,
              phase: prior.phase,
              card: prior.card,
              cardBytesSha256: prior.cardBytesSha256,
            });
          }
          if (!options.renderScheduleClaim) throw scheduleFailure(503, 'schedule-card-renderer-unavailable');
          const rendered = await options.renderScheduleClaim({
            scheduleId: schedule.id,
            scheduledFor: input.occurrence.scheduledFor,
            nextAt: input.occurrence.nextAt,
            owner: clone(schedule.owner),
            mirrorPath: schedule.mirrorPath,
          });
          const card = clone(rendered.card) as JsonObject;
          const meta = card.meta;
          if (!/^[0-9a-f]{64}$/.test(rendered.cardBytesSha256)
            || typeof meta !== 'object' || meta === null || Array.isArray(meta)
            || meta['execution-controller'] !== 'dashboard'
            || meta.scheduled_for !== input.occurrence.scheduledFor
            || typeof meta.id !== 'string') throw scheduleFailure(500, 'schedule-card-render-invalid');
          const claim: StoredScheduleOccurrenceClaim = {
            scheduleId: schedule.id,
            scheduledFor: input.occurrence.scheduledFor,
            nextAt: input.occurrence.nextAt,
            owner: clone(schedule.owner) as unknown as JsonObject,
            phase: 'claimed',
            idempotencyKey: input.idempotencyKey,
            fingerprint,
            card,
            cardBytesSha256: rendered.cardBytesSha256,
            runRef: null,
            phaseReceipts: [],
            completionReceipt: null,
          };
          document.scheduleOccurrenceClaims.push(claim);
          dirty = true;
          return clone({
            scheduleId: claim.scheduleId,
            scheduledFor: claim.scheduledFor,
            owner: schedule.owner,
            phase: claim.phase,
            card: claim.card,
            cardBytesSha256: claim.cardBytesSha256,
          });
        },
      };
      const result = await operation(transaction);
      if (dirty) commit(document);
      return result;
    });
    scheduleTransactionTail = run.then(() => undefined, () => undefined);
    return run;
  };

  const claimReceipt = (claim: StoredScheduleOccurrenceClaim): ScheduleOccurrenceClaim => ({
    scheduleId: claim.scheduleId,
    scheduledFor: claim.scheduledFor,
    owner: clone(claim.owner) as unknown as RunnableRef,
    phase: claim.phase,
    card: clone(claim.card),
    cardBytesSha256: claim.cardBytesSha256,
  });

  const completeStoredScheduleOccurrence = (
    document: StoreDocument,
    input: CompleteScheduleOccurrenceInput,
  ): ScheduleMutationReceipt => {
    const claim = document.scheduleOccurrenceClaims.find((candidate) =>
      candidate.scheduleId === input.scheduleId && candidate.scheduledFor === input.scheduledFor);
    const schedule = document.schedules.find((candidate) => candidate.id === input.scheduleId);
    if (!claim || !schedule || claim.phase !== 'ledger-appended' || claim.runRef !== input.runRef) {
      throw scheduleFailure(409, 'schedule-occurrence-conflict');
    }
    const fingerprint = sha256(canonicalJson(input as unknown as JsonValue));
    if (claim.completionReceipt) {
      if (claim.completionReceipt.idempotencyKey !== input.idempotencyKey
        || claim.completionReceipt.fingerprint !== fingerprint) throw scheduleFailure(409, 'idempotency-conflict');
      return clone(claim.completionReceipt.result as unknown as ScheduleMutationReceipt);
    }
    schedule.lastOutcome = input.lastOutcome;
    schedule.nextAt = input.nextAt;
    schedule.version += 1;
    document.scheduleCollectionRevision += 1;
    const result: ScheduleMutationReceipt = {
      schedule: publicSchedule(schedule),
      collectionRevision: document.scheduleCollectionRevision,
      replayed: false,
    };
    claim.completionReceipt = clone({ idempotencyKey: input.idempotencyKey, fingerprint, result } as unknown as JsonObject);
    return result;
  };

  // --- P4 section 3.4 two-phase reconciliation receipt [P4-C33] ---------------------------------
  // The real store behind the injected `ReconciliationReceiptPort`. W4 backs the port with an
  // in-memory fake and never touches this file; here it is substituted and W4's suites re-run
  // unchanged. Both writes are CAS, serialized on ONE writer tail so `prepare` is an atomic
  // insert-if-absent and `publish` advances exactly the `prepared` row it read — the publisher has no
  // other guard against a duplicate effect. `load()` re-reads the persisted document and the whole
  // transaction body is synchronous (load -> mutate -> commit), so a read always sees prior writes;
  // a read-your-writes gap would re-classify a replay as `fresh` and re-run its effect.
  const reconciliationReceiptRowIndex = (document: StoreDocument, idempotencyKey: string): number =>
    (document.reconciliationReceipts ?? []).findIndex((row) => row['idempotencyKey'] === idempotencyKey);

  const sameStringList = (left: unknown, right: readonly string[]): boolean =>
    Array.isArray(left) && left.length === right.length && left.every((entry, index) => entry === right[index]);

  const decodeStoredReconciliationResult = (value: unknown): ReconciliationResult => {
    const record = (value ?? {}) as JsonObject;
    const detail = record['detail'];
    return {
      outcome: record['outcome'] as ReconciliationResult['outcome'],
      revision: record['revision'] as string,
      // Verbatim round-trip: `detail` is present iff it was stored, so an exact replay returns a
      // result with the same optional-field shape as the original, never a spurious `detail:undefined`.
      ...(typeof detail === 'string' ? { detail } : {}),
    };
  };

  const decodeStoredReconciliationReceipt = (row: JsonObject): ReconciliationReceipt => {
    const base = {
      idempotencyKey: row['idempotencyKey'] as string,
      requestSha256: row['requestSha256'] as string,
      expectedSourceRevision: row['expectedSourceRevision'] as string,
      expectedStoreRevision: row['expectedStoreRevision'] as string,
      exactTargets: [...((row['exactTargets'] as string[] | undefined) ?? [])],
    };
    if (row['phase'] === 'published') {
      return {
        ...base,
        phase: 'published',
        result: decodeStoredReconciliationResult(row['result']),
        auditRef: row['auditRef'] as string,
      };
    }
    return { ...base, phase: 'prepared' };
  };

  let reconciliationReceiptTail: Promise<unknown> = Promise.resolve();
  const reconciliationReceiptTransaction = <T>(operation: (document: StoreDocument) => T): Promise<T> => {
    const run = reconciliationReceiptTail.then(() => operation(load()));
    reconciliationReceiptTail = run.then(() => undefined, () => undefined);
    return run;
  };

  const reconciliationReceiptPortImpl: ReconciliationReceiptPort = {
    async read(idempotencyKey: string): Promise<ReconciliationReceipt | null> {
      const document = load();
      const index = reconciliationReceiptRowIndex(document, idempotencyKey);
      if (index === -1) return null;
      return decodeStoredReconciliationReceipt(clone(document.reconciliationReceipts![index]!));
    },
    prepare(receipt: PreparedReconciliationReceipt): Promise<PreparedReconciliationReceipt> {
      return reconciliationReceiptTransaction((document) => {
        // Insert-if-absent under the single writer tail: a duplicate key surfaces a 409, never the
        // store's raw error, so the publisher's loser sees the same audited conflict a changed replay
        // gets [assumption 1, 2].
        if (reconciliationReceiptRowIndex(document, receipt.idempotencyKey) !== -1) {
          throw new ReconciliationConflictError(
            receipt.idempotencyKey, 'a reconciliation receipt already exists for this key',
          );
        }
        const rows = document.reconciliationReceipts ?? [];
        rows.push(clone(receipt as unknown as JsonObject));
        document.reconciliationReceipts = rows;
        commit(document);
        return receipt;
      });
    },
    publish(receipt: PublishedReconciliationReceipt): Promise<PublishedReconciliationReceipt> {
      return reconciliationReceiptTransaction((document) => {
        const rows = document.reconciliationReceipts ?? [];
        const index = reconciliationReceiptRowIndex(document, receipt.idempotencyKey);
        const existing = index === -1 ? undefined : rows[index];
        // CAS on the FULL prepared row: it must be `prepared`, carry the same requestSha256, and match
        // every expectation/target the preparation staged [assumption 3].
        if (
          existing === undefined
          || existing['phase'] !== 'prepared'
          || existing['requestSha256'] !== receipt.requestSha256
          || existing['expectedSourceRevision'] !== receipt.expectedSourceRevision
          || existing['expectedStoreRevision'] !== receipt.expectedStoreRevision
          || !sameStringList(existing['exactTargets'], receipt.exactTargets)
        ) {
          throw new ReconciliationConflictError(receipt.idempotencyKey, 'reconciliation receipt CAS failed');
        }
        rows[index] = clone(receipt as unknown as JsonObject);
        document.reconciliationReceipts = rows;
        commit(document);
        return receipt;
      });
    },
  };

  return {
    getControlDocumentMetadata() {
      const { version, documentRevision, scheduleCollectionRevision } = load();
      return { version, documentRevision, scheduleCollectionRevision };
    },

    reconciliationReceiptPort() {
      return reconciliationReceiptPortImpl;
    },

    getScheduleSnapshot() {
      return scheduleSnapshot(load());
    },

    async readScheduleMirrorSnapshot() {
      const document = load();
      return { revision: scheduleMirrorRevisionOf(document), rows: document.schedules.map(scheduleMirrorRow) };
    },

    async readOpenScheduleMirrorBatch() {
      return storedScheduleMirrorBatch(load());
    },

    async readMergedScheduleMirrorWatermark() {
      const merged = load().scheduleMirrorMergedWatermark;
      return merged === undefined ? unmirroredWatermark() : decodeScheduleMirrorWatermark(merged);
    },

    // The read and the write both live inside the single-writer schedule transaction, so this call
    // — not the caller's earlier read — is what makes "at most one open batch" true.
    commitScheduleMirrorPreparation(batch): Promise<CommitScheduleMirrorPreparationResult> {
      return scheduleTransaction(async () => {
        const document = load();
        const stored = storedScheduleMirrorBatch(document);
        if (stored && stored.state !== 'merged' && stored.state !== 'failed') {
          if (stored.id === batch.id) return { outcome: 'replayed' as const, batch: stored };
          return { outcome: 'batch-open' as const, batch: stored };
        }
        // The first batch materialises both additive fields on the existing document [P4-C37].
        materialiseScheduleMirrorFields(document);
        // A batch the operator abandoned (state `failed`) is closed by the next preparation instead
        // of wedging the mirror forever; the close is recorded on the replacing record.
        const superseded = stored && stored.state === 'failed'
          ? { id: stored.id, state: 'superseded', at: batch.createdAt }
          : undefined;
        document.scheduleMirrorBatch = {
          record: scheduleMirrorBatchJson(batch),
          ...(superseded === undefined ? {} : { superseded }),
        };
        commit(document);
        return { outcome: 'committed' as const };
      });
    },

    applyScheduleMirrorMerge(input) {
      return scheduleTransaction(async () => {
        const document = load();
        materialiseScheduleMirrorFields(document);
        const updatedRowIds: string[] = [];
        // §3.5: CAS only the rows AND tombstones the batch actually covered. A mutation made after
        // the batch was prepared carries a higher revision and is left for the next batch.
        for (const row of mirrorRows(document)) {
          if (!isRowCoveredByMirror(row.lastMirrorRevision ?? 0, input.batch.targetWatermark)) continue;
          row.mirroredAt = input.mirroredAt;
          updatedRowIds.push(row.id);
        }
        document.scheduleMirrorBatch = { record: scheduleMirrorBatchJson(input.batch) };
        document.scheduleMirrorMergedWatermark = { ...input.batch.targetWatermark };
        commit(document);
        return { updatedRowIds };
      });
    },

    recordScheduleMirrorUnchanged(watermark) {
      return scheduleTransaction(async () => {
        const document = load();
        const merged = document.scheduleMirrorMergedWatermark;
        if (merged !== undefined
          && merged['revision'] === watermark.revision && merged['digest'] === watermark.digest) {
          return;
        }
        materialiseScheduleMirrorFields(document);
        document.scheduleMirrorMergedWatermark = { ...watermark };
        commit(document);
      });
    },

    markScheduleMirrorBatchFailed(batchId) {
      return scheduleTransaction(async () => {
        const document = load();
        const stored = storedScheduleMirrorBatch(document);
        if (!stored || stored.id !== batchId || stored.state === 'merged' || stored.state === 'failed') {
          return { failed: false };
        }
        const { pr: _pr, ...rest } = stored;
        document.scheduleMirrorBatch = { record: scheduleMirrorBatchJson({ ...rest, state: 'failed' }) };
        commit(document);
        return { failed: true };
      });
    },

    async readScheduleSnapshot() {
      return scheduleSnapshot(load());
    },

    transaction(operation) {
      return scheduleTransaction(operation);
    },

    createSchedule(input) {
      return scheduleTransaction((transaction) => transaction.createSchedule(input));
    },

    setScheduleArmed(id, input) {
      return scheduleTransaction((transaction) => transaction.setScheduleArmed(id, input));
    },

    deleteSchedule(id, input) {
      return scheduleTransaction((transaction) => transaction.deleteSchedule(id, input));
    },

    claimScheduleOccurrence(input) {
      return scheduleTransaction((transaction) => transaction.claimScheduleOccurrence(input));
    },

    advanceScheduleOccurrence(input: AdvanceScheduleOccurrenceInput) {
      return scheduleTransaction(async () => {
        const document = load();
        const claim = document.scheduleOccurrenceClaims.find((candidate) =>
          candidate.scheduleId === input.scheduleId && candidate.scheduledFor === input.scheduledFor);
        if (!claim || claim.nextAt !== input.nextAt) throw scheduleFailure(409, 'schedule-occurrence-conflict');
        const fingerprint = sha256(canonicalJson(input as unknown as JsonValue));
        const prior = claim.phaseReceipts.find((receipt) => receipt.idempotencyKey === input.idempotencyKey);
        if (prior) {
          if (prior.fingerprint !== fingerprint) throw scheduleFailure(409, 'idempotency-conflict');
          return claimReceipt(claim);
        }
        const phases = ['claimed', 'card-saved', 'ledger-appended'] as const;
        const current = phases.indexOf(claim.phase);
        const next = phases.indexOf(input.phase);
        if (next !== current + 1) throw scheduleFailure(409, 'schedule-phase-conflict');
        claim.phase = input.phase;
        claim.phaseReceipts.push({ idempotencyKey: input.idempotencyKey, fingerprint });
        commit(document);
        return claimReceipt(claim);
      });
    },

    completeScheduleOccurrence(input: CompleteScheduleOccurrenceInput) {
      return scheduleTransaction(async () => {
        const document = load();
        const result = completeStoredScheduleOccurrence(document, input);
        commit(document);
        return result;
      });
    },

    bindScheduleOccurrenceRun(cardId, runRef) {
      return scheduleTransaction(async () => {
        const document = load();
        const claims = document.scheduleOccurrenceClaims.filter((candidate) => {
          const meta = candidate.card.meta;
          return typeof meta === 'object' && meta !== null && !Array.isArray(meta) && meta.id === cardId;
        });
        if (claims.length !== 1 || claims[0].phase !== 'ledger-appended') {
          throw scheduleFailure(409, 'schedule-occurrence-conflict');
        }
        const claim = claims[0];
        if (claim.runRef !== null && claim.runRef !== runRef) throw scheduleFailure(409, 'schedule-occurrence-conflict');
        if (claim.runRef === runRef) return;
        claim.runRef = runRef;
        commit(document);
      });
    },

    resolveScheduleReceiptOwner(cardId) {
      const claim = load().scheduleOccurrenceClaims.find((candidate) => {
        const meta = candidate.card.meta;
        return typeof meta === 'object' && meta !== null && !Array.isArray(meta) && meta.id === cardId;
      });
      return claim ? clone(claim.owner) as unknown as RunnableRef : null;
    },

    isScheduleSeedAuthorized(scheduleId) {
      return load().schedules.find((schedule) => schedule.id === scheduleId)?.seedAuthorized === true;
    },

    getScheduleSeedImportMarker() {
      const marker = load().scheduleSeedImports.at(-1);
      return marker ? clone({
        version: 1 as const,
        releaseSha: marker.releaseSha === '' ? null : marker.releaseSha,
        seedDigest: marker.seedDigest,
        importedAt: marker.importedAt,
      }) : null;
    },

    commitScheduleSeedImport(plan) {
      return scheduleTransaction(async () => {
        const document = load();
        const existing = document.scheduleSeedImports.at(-1);
        if (existing) {
          if (existing.seedDigest !== plan.marker.seedDigest
            || (existing.releaseSha === '' ? null : existing.releaseSha) !== plan.marker.releaseSha) {
            throw scheduleFailure(409, 'schedule-seed-import-conflict');
          }
          return;
        }
        if (plan.seeds.some((seed) => document.schedules.some((schedule) => schedule.id === seed.id)
          || document.scheduleTombstones.some((tombstone) => tombstone.id === seed.id))) {
          throw scheduleFailure(409, 'schedule-seed-id-conflict');
        }
        for (const seed of plan.seeds) {
          document.schedules.push({
            id: seed.id,
            owner: clone(seed.owner),
            cadence: { ...seed.cadence },
            cadenceCanonical: seed.cadence.source,
            nextAt: null,
            lastOutcome: null,
            armed: seed.armed,
            origin: 'seed',
            mirroredAt: null,
            mirrorPath: seed.path,
            version: 1,
            seedBytes: seed.sourceBytes,
            seedDigest: seed.sourceDigest,
            seedAuthorized: plan.marker.releaseSha !== null,
            launchPayload: { cadenceName: seed.name, disarmedReason: seed.disarmedReason },
            operationReceipts: [],
            emissionReceipts: [],
            mirrorMetadataRevision: 0,
            tombstone: null,
          });
        }
        document.scheduleSeedImports.push({
          version: 1,
          releaseSha: plan.marker.releaseSha ?? '',
          seedDigest: plan.marker.seedDigest,
          importedAt: plan.marker.importedAt,
        });
        document.scheduleCollectionRevision += 1;
        // Seed reconciliation is one mirror-relevant event; every imported row carries its revision.
        const imported = plan.seeds
          .map((seed) => document.schedules.find((schedule) => schedule.id === seed.id))
          .filter((schedule): schedule is StoredSchedule => schedule !== undefined);
        advanceScheduleMirrorRevision(document, ...imported);
        commit(document);
      });
    },

    async readSchedulePauseMarkerReceipt(marker) {
      for (const schedule of load().schedules) {
        const receipt = schedule.emissionReceipts.find((candidate) =>
          candidate.kind === 'legacy-pause-migration' && candidate.marker === marker);
        if (receipt) return clone({
          marker: String(receipt.marker),
          scheduleId: String(receipt.scheduleId),
          digest: String(receipt.digest),
          storePhase: receipt.storePhase === true,
          publisherPhase: receipt.publisherPhase === true,
        });
      }
      return null;
    },

    async listIncompleteSchedulePauseMarkerReceipts() {
      return load().schedules.flatMap((schedule) => schedule.emissionReceipts
        .filter((candidate) => candidate.kind === 'legacy-pause-migration' && candidate.publisherPhase !== true)
        .map((receipt) => clone({
          marker: String(receipt.marker),
          scheduleId: String(receipt.scheduleId),
          digest: String(receipt.digest),
          storePhase: receipt.storePhase === true,
          publisherPhase: false,
        })));
    },

    writeSchedulePauseMarkerReceipt(receipt) {
      return scheduleTransaction(async () => {
        const document = load();
        const schedule = document.schedules.find((candidate) => candidate.id === receipt.scheduleId);
        if (!schedule) throw scheduleFailure(409, 'pause-marker-schedule-missing');
        const index = schedule.emissionReceipts.findIndex((candidate) =>
          candidate.kind === 'legacy-pause-migration' && candidate.marker === receipt.marker);
        const stored = clone({ kind: 'legacy-pause-migration', ...receipt } as unknown as JsonObject);
        if (index === -1) schedule.emissionReceipts.push(stored);
        else schedule.emissionReceipts[index] = stored;
        commit(document);
      });
    },

    getDeployment(deploymentRef) {
      const deployment = load().deployments.find((item) => item.deploymentRef === deploymentRef);
      return deployment ? ok(publicDeployment(deployment)) : fail('not-found', 'deployment was not found');
    },

    listDeployments() {
      return load().deployments
        .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt) || a.deploymentRef.localeCompare(b.deploymentRef))
        .map(publicDeployment);
    },

    createDeployment(subject, input) {
      if (!validNonEmpty(subject, MAX_SHORT_TEXT) || !validateCreateDeploymentInput(input)) {
        return fail('invalid', 'deployment creation input is invalid');
      }
      const document = load();
      const fingerprint = sha256(canonicalJson({ subject, input } as unknown as JsonValue));
      const prior = document.deployments.flatMap((deployment) => deployment.operationReceipts)
        .find((receipt) => receipt.key === input.idempotencyKey);
      if (prior) {
        if (prior.operation !== 'create' || prior.fingerprint !== fingerprint) {
          return fail('idempotency-conflict', 'deployment idempotencyKey was reused with different content');
        }
        return ok(clone(prior.result), true);
      }
      if (document.deployments.some((deployment) => deployment.deploymentRef === input.deploymentRef)
        || document.deployments.some((deployment) => !isTerminalDeploymentState(deployment.state))) {
        return fail('conflict', 'a deployment with this reference or another nonterminal deployment already exists');
      }
      const deployment: StoredDeployment = {
        deploymentRef: input.deploymentRef,
        revision: 1,
        targetCommit: input.targetCommit,
        previousCommit: input.previousCommit,
        state: input.initialState,
        requestedAt: input.requestedAt,
        parkWarnAt: input.parkWarnAt,
        swapDeadlineAt: null,
        fenceRevision: 0,
        drainAcks: {},
        blockers: [],
        progress: { kind: 'idle', attemptRef: null, since: null, detail: null },
        abortRequestedAt: null,
        error: null,
        terminalOutcome: null,
        acknowledgedBy: null,
        operationReceipts: [],
      };
      const result = publicDeployment(deployment);
      deployment.operationReceipts.push({
        key: input.idempotencyKey,
        fingerprint,
        operation: 'create',
        deploymentRevision: deployment.revision,
        result: clone(result),
        recordedAt: stamp(),
      });
      document.deployments.push(deployment);
      commit(document, 'deploy-critical');
      return ok(result);
    },

    transitionDeployment(subject, deploymentRef, input) {
      if (!validNonEmpty(subject, MAX_SHORT_TEXT) || !validNonEmpty(deploymentRef, MAX_SHORT_TEXT)
        || !validateTransitionDeploymentInput(input)) {
        return fail('invalid', 'deployment transition input is invalid');
      }
      const document = load();
      const fingerprint = sha256(canonicalJson({ subject, deploymentRef, input } as unknown as JsonValue));
      const prior = document.deployments.flatMap((deployment) => deployment.operationReceipts)
        .find((receipt) => receipt.key === input.idempotencyKey);
      if (prior) {
        if (prior.operation !== 'transition' || prior.fingerprint !== fingerprint) {
          return fail('idempotency-conflict', 'deployment idempotencyKey was reused with different content');
        }
        return ok(clone(prior.result), true);
      }
      const deployment = document.deployments.find((item) => item.deploymentRef === deploymentRef);
      if (!deployment) return fail('not-found', 'deployment was not found');
      if (deployment.revision !== input.expectedRevision || deployment.state !== input.expectedState
        || !canTransitionDeployment(deployment.state, input.nextState)) {
        return fail('conflict', 'deployment revision, state, or transition changed');
      }
      deployment.state = input.nextState;
      Object.assign(deployment, clone(input.patch));
      deployment.revision += 1;
      const result = publicDeployment(deployment);
      deployment.operationReceipts.push({
        key: input.idempotencyKey,
        fingerprint,
        operation: 'transition',
        deploymentRevision: deployment.revision,
        result: clone(result),
        recordedAt: stamp(),
      });
      while (deployment.operationReceipts.length > MAX_DEPLOYMENT_OPERATION_RECEIPTS) {
        const transitionReceipt = deployment.operationReceipts.findIndex((receipt) => receipt.operation === 'transition');
        if (transitionReceipt < 0) throw new Error('deployment transition receipt eviction invariant failed');
        deployment.operationReceipts.splice(transitionReceipt, 1);
      }
      commit(document, 'deploy-critical');
      return { ok: true, value: result, replayed: undefined };
    },

    getAssetPullIntent(intentRef) {
      const intent = (load().assetPullIntents ?? []).find((item) => item.intentRef === intentRef);
      return intent ? ok(publicAssetPullIntent(intent)) : fail('not-found', 'asset-pull intent was not found');
    },

    listAssetPullIntents() {
      return (load().assetPullIntents ?? [])
        .slice()
        .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt) || a.intentRef.localeCompare(b.intentRef))
        .map(publicAssetPullIntent);
    },

    createAssetPullIntent(subject, input) {
      if (!validNonEmpty(subject, MAX_SHORT_TEXT) || !validateCreateAssetPullIntentInput(input)) {
        return fail('invalid', 'asset-pull intent creation input is invalid');
      }
      const document = load();
      const intents = document.assetPullIntents ?? [];
      // movement:256 creates one intent per succeeded run; a second create for the same intentRef is a
      // replay when its pinned fields match, and a conflict otherwise. The intent's `(state, attempts)`
      // are its idempotency ledger, so no operationReceipts sidecar is kept.
      const existing = intents.find((item) => item.intentRef === input.intentRef);
      if (existing) {
        if (existing.runRef !== input.runRef || existing.manifestDigest !== input.manifestDigest
          || existing.requestedAt !== input.requestedAt) {
          return fail('idempotency-conflict', 'asset-pull intentRef was reused with different content');
        }
        return ok(publicAssetPullIntent(existing), true);
      }
      const intent: StoredAssetPullIntent = {
        intentRef: input.intentRef,
        runRef: input.runRef,
        manifestDigest: input.manifestDigest,
        state: 'pending',
        requestedAt: input.requestedAt,
        attempts: 0,
        result: null,
      };
      intents.push(intent);
      document.assetPullIntents = intents;
      commit(document);
      return ok(publicAssetPullIntent(intent));
    },

    updateAssetPullIntent(subject, intentRef, input) {
      if (!validNonEmpty(subject, MAX_SHORT_TEXT) || !validNonEmpty(intentRef, MAX_SHORT_TEXT)
        || !validateUpdateAssetPullIntentInput(input)) {
        return fail('invalid', 'asset-pull intent update input is invalid');
      }
      const document = load();
      const intent = (document.assetPullIntents ?? []).find((item) => item.intentRef === intentRef);
      if (!intent) return fail('not-found', 'asset-pull intent was not found');
      // A CAS pinned to the exact `(state, attempts)` the caller read: a stale dispatch or settlement
      // conflicts with NO side effect, so a concurrent double-dispatch converges on one in-flight row.
      if (intent.state !== input.expectedState || intent.attempts !== input.expectedAttempts
        || !canTransitionAssetPull(intent.state, input.nextState)) {
        return fail('conflict', 'asset-pull intent state or attempts changed');
      }
      if (input.attemptsDelta === 1 && intent.attempts >= ASSET_PULL_MAX_ATTEMPTS) {
        return fail('conflict', 'asset-pull intent attempts are exhausted');
      }
      intent.state = input.nextState;
      intent.attempts += input.attemptsDelta;
      intent.result = input.result === null ? null : clone(input.result);
      commit(document);
      return ok(publicAssetPullIntent(intent));
    },

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

    getProposalRevision(subject, proposalRef, revision, scope = 'own-subject') {
      // Widened for the operator's SINGLE-revision read only (run detail's checkpoint pick-list, and the
      // launch route resolving a bridge-imported revision). The proposals LIST and the composer
      // import/revision/decision paths stay own-subject on purpose — bridge adoption safety and Composer
      // authoring state are not the operator's to enumerate or edit. See {@link ReadScope}.
      const proposal = load().proposals.find((item) =>
        (scope === 'all-subjects' || item.subject === subject) && item.proposalRef === proposalRef && item.revision === revision);
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

    listHostAdvertisements() {
      return [...load().hostAdvertisements];
    },

    upsertHostAdvertisement(hostId, advertisement, expectedVersion) {
      // Port-shape parity with the node route's `AdvertiseStorePort`: the addressed host is an EXPLICIT
      // argument (the route derives it from the peer map, never from the body), and a body that disagrees
      // is a caller bug — refused loudly rather than silently writing whichever host the body named.
      if (advertisement.hostId !== hostId) {
        throw new Error(`host advertisement is for ${advertisement.hostId}, not the addressed host ${hostId}`);
      }
      // ONE row per host by construction (`hostId` is the primary key), so a second daemon beat can never
      // append a duplicate. The load/compare/save runs inside this single method, which under the writer
      // lease is the store's unit of atomicity — the same shape `claimLease` relies on.
      const document = load();
      const current = document.hostAdvertisements.find((row) => row.hostId === hostId)?.version;
      if (current !== expectedVersion) return { ok: false, current: current ?? 0 };
      const version = (current ?? 0) + 1;
      // Decode HERE, before the row is persisted: the store never persists an advertisement the W0
      // contract would reject on the way back out (`assertPlacementCollections` at open would fail closed).
      const stored: StoredHostAdvertisement = { ...decodeHostAdvertisement(advertisement), version };
      document.hostAdvertisements = [
        ...document.hostAdvertisements.filter((existing) => existing.hostId !== hostId),
        stored,
      ];
      // `save`, NOT `commit`: an advertisement must NOT bump `documentRevision`. That counter is the
      // revision of the COORDINATED control-plane state — `reconciliation/publisher.ts` gates every card
      // walk on it (a changed value refuses the intent as `stale store revision`), and Home/Agents/
      // Workflows derive their browser ETags from it. A 30-s liveness beat that bumped it would abort
      // in-flight reconciliation intents and invalidate every cached projection, forever. The
      // advertisement has its OWN revision line: the plan-owned per-row `version` that sits beside the
      // verbatim spec fields precisely because it is the advertisement ETag domain
      // [placement/contracts.ts §3.1:142] — that is what this CAS advances. Persistence is untouched:
      // `commit` is exactly `documentRevision += 1` followed by this same `save`, so durability, the
      // document size limit, and the atomic rename all behave identically. Consumers that PROJECT an
      // advertisement therefore have to fold this per-row `version` into their own ETag rather than lean
      // on `documentRevision` — `workflows/routes.ts`'s `hostAdvertisementRevision` is the one such site.
      //
      // KNOWN AND ACCEPTED: `scheduleTransaction` above loads its document before its `await`s and commits
      // it at the end, so a beat landing inside that window is overwritten by the transaction's older
      // snapshot. It is self-healing and bounded — the next beat (≤ 30 s, well inside the 90-s freshness
      // window) re-reads and rewrites the row — so a clobbered beat can never make a fresh host go stale.
      // Closing it properly means narrowing that transaction's snapshot, which is a schedule-side change.
      save(document);
      return { ok: true, version };
    },

    seedHostAdvertisementForTest(advertisement) {
      const document = load();
      document.hostAdvertisements = [
        ...document.hostAdvertisements.filter((existing) => existing.hostId !== advertisement.hostId),
        advertisement,
      ];
      commit(document);
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

    findActiveRunForRevision(subject, proposalRef, revision, launchOperationKey) {
      const document = load();
      // Own-subject only, by construction: the caller asks about the OWNER's key space, which is the
      // space a launch would create in. `launchOperationKey` names the run this launch would REPLAY, and
      // replaying is not duplicating.
      const active = document.runs.find((item) => item.subject === subject
        && item.proposalRef === proposalRef
        && item.proposalRevision === revision
        && item.launchOperationKey !== launchOperationKey
        && !isTerminalRun(item.lifecycle));
      return active ? metadata(document, subject, active) : null;
    },

    createRun(subject, input) {
      if (!validNonEmpty(input.title, MAX_TITLE) || !validNonEmpty(input.managerRuntime, MAX_SHORT_TEXT) || !validNonEmpty(input.managerModel, MAX_SHORT_TEXT)) {
        return fail('invalid', 'run title and manager routing are required');
      }
      if (!validNonEmpty(input.idempotencyKey, MAX_SHORT_TEXT)) return fail('invalid', 'idempotencyKey is required');
      const managerAssignment = normalizeAssignment(input.managerAssignment);
      if (managerAssignment === undefined) return fail('invalid', 'manager assignment provenance is invalid');
      const owner = decodeRunnableRef(input.owner);
      const executionHost = decodeHostKind(input.executionHost);
      if (!owner) return fail('invalid', 'runnable-owner-required');
      if (!executionHost) return fail('invalid', 'execution host is invalid');
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
        owner,
        executionHost,
        agentWorkspaceLaunch,
        predecessorRunRef: input.predecessorRunRef ?? null,
        expectedPredecessorVersion: input.expectedPredecessorVersion ?? null,
        iterationGroups: input.iterationGroups ?? [],
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
      const approvedIterationGroups = Array.isArray(proposal.snapshot.iterationGroups)
        ? proposal.snapshot.iterationGroups as unknown as ProposalIterationGroup[] : [];
      const requestedIterationGroups = input.iterationGroups ?? [];
      if (canonicalJson(requestedIterationGroups as unknown as JsonValue)
        !== canonicalJson(approvedIterationGroups as unknown as JsonValue)) {
        return fail('conflict', 'iteration groups do not match the approved proposal snapshot');
      }
      for (const group of requestedIterationGroups) {
        if (!group || typeof group !== 'object' || !Array.isArray(group.participants) || group.participants.length < 2
          || !Array.isArray(group.routes) || !Array.isArray(group.schedule) || !Array.isArray(group.artifacts)
          || !Array.isArray(group.criteria) || !Array.isArray(group.terminalAuthorities)
          || !group.activation || typeof group.activation !== 'object' || !Array.isArray(group.activation.seedArtifactIds)) {
          return fail('invalid', 'iteration group shape is invalid');
        }
        if (group.participants.some((participant) => !participant || typeof participant !== 'object')) {
          return fail('invalid', 'iteration group participant shape is invalid');
        }
        const participantIds = new Set(group.participants.map((participant) => participant.participantId));
        if (participantIds.size !== group.participants.length
          || group.participants.some((participant) => !ids.has(participant.stageRef))
          || group.routes.some((route) => !route || !Array.isArray(route.baseResolutionStageIds)
            || !Array.isArray(route.requestKinds)
            || typeof route.senderParticipantId !== 'string' || typeof route.recipientParticipantId !== 'string'
            || typeof route.routeId !== 'string'
            || !participantIds.has(route.senderParticipantId) || !participantIds.has(route.recipientParticipantId)
            || route.baseResolutionStageIds.some((stageId) => !ids.has(stageId)))) {
          return fail('invalid', 'iteration group references must stay inside the approved run snapshot');
        }
        const snapshotStages = Array.isArray(proposal.snapshot.stages)
          ? proposal.snapshot.stages as unknown as Array<Record<string, unknown>> : null;
        if (!snapshotStages) return fail('invalid', 'approved iteration stage snapshot is invalid');
        const seed = group.participants.find((participant) => participant.participantId === group.activation.seedParticipantId);
        const seedStage = seed && snapshotStages.find((stage) => stage.id === seed.stageRef);
        const artifactIds = new Set(Array.isArray(seedStage?.artifacts)
          ? seedStage.artifacts.map((artifact) => isPlainRecord(artifact) ? artifact.id : undefined) : []);
        if (!seed || group.activation.seedArtifactIds.some((artifact) => !artifactIds.has(artifact))) {
          return fail('invalid', 'iteration activation artifacts must belong to the approved seed stage');
        }
      }
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
        if (!isTerminalRun(predecessor.lifecycle) && runLifecycleKind(predecessor.lifecycle) !== 'interrupted') {
          return fail('invalid', 'only a terminal or interrupted run can have a Retry successor');
        }
        if (predecessor.proposalHash !== proposal.hash) return fail('conflict', 'Retry successor must bind the same approved proposal hash');
        if (JSON.stringify(predecessor.owner) !== JSON.stringify(owner)
          || predecessor.executionHost !== executionHost) {
          return fail('conflict', 'Retry successor must preserve immutable runnable owner and execution host');
        }
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
        lifecycle: lifecycleForKind('planned', null),
        owner: clone(owner),
        executionHost,
        terminalOutcome: null,
        completedAt: null,
        archivedFrom: null,
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
      const legacyIterationGroups: ProposalIterationGroup[] = [];
      for (const reviewStage of stages) {
        if (reviewStage.review === null) continue;
        const subjectStage = stagesById.get(reviewStage.review.subjectStageId);
        if (!subjectStage || reviewedSubjects.has(subjectStage.stageRef)) {
          return fail('invalid', 'review stages must bind exactly one distinct subject stage');
        }
        reviewedSubjects.add(subjectStage.stageRef);
        legacyIterationGroups.push(legacyGroupForStages(subjectStage, reviewStage, proposal.snapshot));
      }
      const iterationGroups = requestedIterationGroups.length > 0 ? requestedIterationGroups : legacyIterationGroups;
      const iterationLoops: StoredIterationLoop[] = iterationGroups.map((group) => {
        return {
          subject, ...clone(group), iterationLoopRef: ref('iteration-loop'), runRef,
          definitionHash: iterationDefinitionHash(group), cyclesUsed: 0, state: 'awaiting-seed',
          activeGenerationRefs: [], version: 0, createdAt, updatedAt: createdAt,
        };
      });
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
      document.iterationLoops.push(...iterationLoops);
      validateGenericIterationBundle(iterationBundleForRun(document, subject, runRef));
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
      return ok({ run: internalRun(run), phase: receipt.phase }, true);
    },

    hasActiveRunActivation(subject, runRef) {
      const document = load();
      const run = findRun(document, subject, runRef);
      if (!run) return fail('not-found', 'run was not found');
      const receipts = run.activationReceipts ?? [];
      const latest = receipts[receipts.length - 1];
      return ok(latestPendingActivationReceipt(run) !== undefined
        || (latest?.phase === 'dispatched'
          && ['recovering', 'running'].includes(runLifecycleKind(run.lifecycle))));
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
          return ok({ run: internalRun(run), phase: receipt.phase }, true);
        }
        if (run.publicationState !== 'published'
          || !['recovering', 'waiting-human'].includes(runLifecycleKind(run.lifecycle))) {
          return fail('conflict', 'claimed run activation state changed');
        }
        const requests = document.humanRequests.filter((request) =>
          request.subject === subject && request.runRef === runRef);
        if (requests.length === 0 || requests.some((request) => !boundaryAccepted(request))) {
          return fail('conflict', 'run activation Human Request boundaries are absent or unresolved');
        }
        if (runLifecycleKind(run.lifecycle) === 'waiting-human') {
          run.lifecycle = lifecycleForKind('recovering', null);
          run.version += 1;
          run.updatedAt = stamp();
          commit(document);
        }
        return ok({ run: internalRun(run), phase: receipt.phase }, true);
      }
      const pending = latestPendingActivationReceipt(run);
      if (pending && runLifecycleKind(run.lifecycle) !== 'waiting-human') {
        return fail('idempotency-conflict', 'run activation is already claimed by another idempotencyKey');
      }
      if (run.version !== input.expectedRunVersion || run.managerGeneration !== input.expectedManagerGeneration
        || run.publicationState !== 'published' || runLifecycleKind(run.lifecycle) !== 'waiting-human') {
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
      run.lifecycle = lifecycleForKind('recovering', null);
      run.version += 1;
      run.updatedAt = claimedAt;
      commit(document);
      return ok({ run: internalRun(run), phase: claimedReceipt.phase });
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
        return ok({ run: internalRun(run), phase: receipt.phase }, true);
      }
      if ((phase === 'roots-activated' && runLifecycleKind(run.lifecycle) !== 'recovering')
        || (phase === 'dispatched' && runLifecycleKind(run.lifecycle) !== 'running')) {
        return fail('conflict', 'run activation state changed');
      }
      if (phase === 'dispatched' && receipt.phase !== 'roots-activated') {
        return fail('conflict', 'run activation roots are not durably activated');
      }
      receipt.phase = phase;
      receipt.updatedAt = stamp();
      commit(document);
      return ok({ run: internalRun(run), phase: receipt.phase });
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
        return ok({ run: internalRun(run), phase: receipt.phase }, true);
      }
      receipt.phase = 'failed';
      receipt.updatedAt = stamp();
      if (['recovering', 'running'].includes(runLifecycleKind(run.lifecycle))) {
        run.lifecycle = lifecycleForKind('waiting-human', null);
        run.version += 1;
        run.updatedAt = receipt.updatedAt;
      }
      commit(document);
      return ok({ run: internalRun(run), phase: receipt.phase });
    },

    transitionRun(subject, runRef, expectedVersion, state) {
      const document = load();
      const run = findRun(document, subject, runRef);
      if (!run) return fail('not-found', 'run was not found');
      if (!(RUN_LIFECYCLE_KINDS as readonly string[]).includes(state)) {
        return fail('invalid', 'run state is invalid');
      }
      // Archiving resolves the run's open requests in the SAME commit, so a bare transition to it would
      // leave a dismissed run still holding open asks. `archiveRun` owns that edge exclusively.
      if (state === 'archived') return fail('invalid', 'archiving a run goes through archiveRun, not a bare transition');
      if (run.version !== expectedVersion) return fail('conflict', 'run version changed');
      const priorKind = runLifecycleKind(run.lifecycle);
      if (priorKind === state) return ok(internalRun(run), true);
      if (!canTransitionRun(run.lifecycle, state)) return fail('invalid', `run transition ${priorKind}->${state} is not allowed`);
      if (priorKind === 'waiting-human' && ['planned', 'recovering', 'running'].includes(state)
        && !boundariesAccepted(document, subject, runRef)) {
        return fail('invalid', 'waiting-human run boundaries are unresolved or not accepted');
      }
      if (state === 'succeeded' && !runCanSucceed(document, run)) {
        return fail('invalid', 'run cannot succeed while a descendant is nonterminal or a stage is incomplete');
      }
      run.lifecycle = lifecycleForKind(state, null);
      run.version += 1;
      run.updatedAt = stamp();
      if (state === 'succeeded' || state === 'failed' || state === 'stopped') {
        run.terminalOutcome = state === 'succeeded' ? 'ok' : state;
        run.completedAt ??= run.updatedAt;
        run.archivedFrom = null;
      }
      // A bare transition can land a run on a terminal state (`archived` goes through `archiveRun`
      // exclusively — rejected above). Close its open requests in the SAME commit, so a run that just
      // failed/stopped/succeeded can never leave a haunting ask behind the way the pre-fix zombies did.
      if (isTerminalRun(run.lifecycle)) {
        autoCloseOpenHumanRequestsForRun(
          document, subject, runRef, run.updatedAt, `terminal:${state}`,
          `Automatically closed — the run reached its terminal state ('${state}') without this being answered.`,
          maxEvents,
        );
      }
      if (state === 'succeeded' || state === 'failed' || state === 'stopped') {
        const claims = document.scheduleOccurrenceClaims.filter((candidate) => candidate.runRef === runRef);
        if (claims.length > 1) throw scheduleFailure(409, 'schedule-occurrence-conflict');
        const claim = claims[0];
        if (claim && claim.completionReceipt === null) {
          completeStoredScheduleOccurrence(document, {
            scheduleId: claim.scheduleId,
            scheduledFor: claim.scheduledFor,
            runRef,
            lastOutcome: state === 'succeeded' ? 'ok' : state,
            nextAt: claim.nextAt,
            idempotencyKey: `terminal-run:${runRef}`,
          });
        }
      }
      commit(document);
      return ok(internalRun(run));
    },

    transitionPublication(subject, runRef, expectedVersion, state) {
      const document = load();
      const run = findRun(document, subject, runRef);
      if (!run) return fail('not-found', 'run was not found');
      if (!PUBLICATION_STATES.has(state)) return fail('invalid', 'publication state is invalid');
      if (run.version !== expectedVersion) return fail('conflict', 'run version changed');
      if (run.publicationState === state) return ok(internalRun(run), true);
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
      return ok(internalRun(run));
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
        if (['ready', 'running', 'succeeded'].includes(projection.state)
          && !dependenciesAcceptedForAttempt(document, stage)) {
          return fail('invalid', 'canonical projection bypasses accepted iteration dependencies');
        }
      }
      const states = input.stages.map((stage) => stage.state);
      const runState: Exclude<RunLifecycleKind, 'paused-for-deploy'> = states.every((state) => state === 'succeeded') ? 'succeeded'
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
      run.lifecycle = lifecycleForKind(runState, null);
      run.version += 1;
      run.updatedAt = changedAt;
      if (runState === 'succeeded' || runState === 'failed' || runState === 'stopped') {
        run.terminalOutcome = runState === 'succeeded' ? 'ok' : runState;
        run.completedAt ??= changedAt;
        run.archivedFrom = null;
      }
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
      const genericLoop = iterationLoopForStage(document, stage);
      if (!genericLoop) return fail('invalid', 'stage has no iteration loop');
      const participant = genericLoop.participants.find((candidate) => candidate.stageRef === stage.stageId);
      const activeRequest = [...document.iterationRequests].reverse().find((request) => request.subject === subject
        && request.runRef === stage.runRef && request.iterationLoopRef === genericLoop.iterationLoopRef
        && request.recipientParticipantId === participant?.participantId
        && !document.iterationReceipts.some((receipt) => receipt.requestRef === request.requestRef));
      const iterationOperationKey = activeRequest === undefined ? undefined
        : iterationGenerationOperationKey(stage.runRef, stage.stageId, activeRequest.requestRef);
      if (input.operationKey !== (iterationOperationKey
        ?? generationOperationKey(stage.runRef, stage.stageId, input.expectedGeneration))) {
        return fail('invalid', 'stage generation operationKey is not canonical');
      }
      if ((iterationOperationKey !== undefined && input.resultCardRef !== null)
        || (iterationOperationKey === undefined && input.expectedGeneration === 1
          && (stage.canonicalCardRef === null || input.resultCardRef !== stage.canonicalCardRef))
        || (iterationOperationKey === undefined && input.expectedGeneration > 1 && input.resultCardRef !== null)) {
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
      if (!stage.currentAttemptRef) return fail('invalid', 'stage has no current attempt');
      const attempt = document.attempts.find((item) => item.subject === subject && item.attemptRef === stage.currentAttemptRef);
      if (!attempt || attempt.stageRef !== stage.stageRef
        || attempt.version !== input.expectedAttemptVersion || attempt.state !== 'succeeded') {
        return fail('conflict', 'current attempt does not match the committed generation');
      }
      const producerCommit = activeRequest !== undefined
        && ARTIFACT_PRODUCING_REQUEST_KINDS.has(activeRequest.kind);
      const projectedGeneration = producerCommit ? attempt.logicalGeneration : stage.currentGeneration;
      if (projectedGeneration !== input.expectedGeneration) {
        return fail('conflict', 'stage generation projection changed');
      }
      const predecessor = input.expectedGeneration === 1 ? null : document.stageGenerations.find((item) =>
        item.subject === subject && item.runRef === stage.runRef && item.logicalStageRef === stage.stageRef
          && item.generation === input.expectedGeneration - 1);
      if (input.expectedGeneration > 1 && !predecessor) return fail('conflict', 'prior generation is missing');
      const createdAt = stamp();
      const projected = stage.currentGenerationRef === null ? undefined : document.stageGenerations.find((item) =>
        item.generationRef === stage.currentGenerationRef);
      const queued = projected?.state === 'queued' && projected.generation === input.expectedGeneration
        ? projected : undefined;
      if (projected?.generation === input.expectedGeneration && (!queued || queued.attemptRef !== attempt.attemptRef)) {
        return fail('conflict', 'queued generation projection changed');
      }
      if (queued && (attempt.logicalGeneration !== queued.generation
        || attempt.baseGenerationRef !== (predecessor?.generationRef ?? null)
        || input.baseCommit !== attempt.baseCommit)) {
        return fail('conflict', 'queued creator attempt base lineage changed');
      }
      const generation: StoredStageGeneration = queued ? { ...queued } : {
        subject,
        operationFingerprint: fingerprint,
        generationRef: ref('generation'),
        runRef: stage.runRef,
        logicalStageRef: stage.stageRef,
        logicalStageId: stage.stageId,
        generation: input.expectedGeneration,
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
      return transitionIterationState(document, {
        subject, iterationLoopRef: genericLoop.iterationLoopRef,
        missingDetail: 'stage has no iteration loop', conflictDetail: 'iteration projection changed',
      }, ({ loop }) => {
        if (queued) Object.assign(queued, generation);
        else document.stageGenerations.push(generation);
        if (producerCommit && activeRequest) {
          if (attempt.baseGenerationRef !== (predecessor?.generationRef ?? null)
            || !activeRequest.inputGenerationRefs.every((ref) => loop.activeGenerationRefs.includes(ref))) {
            return fail('conflict', 'iteration producer commit lineage changed');
          }
          if (predecessor) {
            const triggerReceipt = loop.lastReceiptRef === undefined ? undefined : document.iterationReceipts.find((receipt) =>
              receipt.subject === subject && receipt.receiptRef === loop.lastReceiptRef);
            if (!triggerReceipt || !activeRequest.inputGenerationRefs.includes(predecessor.generationRef)) {
              return fail('conflict', 'iteration producer supersession trigger is missing');
            }
            const supersessionOperationKey = `rework:${loop.runRef}:${generation.logicalStageId}:g${generation.generation}`;
            document.generationSupersessions.push({
              subject, operationFingerprint: sha256(canonicalJson({
                runRef: loop.runRef, predecessorGenerationRef: predecessor.generationRef,
                successorGenerationRef: generation.generationRef, triggerReceiptRef: triggerReceipt.receiptRef,
                operationKey: supersessionOperationKey,
              } as unknown as JsonValue)), runRef: loop.runRef,
              predecessorGenerationRef: predecessor.generationRef, successorGenerationRef: generation.generationRef,
              triggerReceiptRef: triggerReceipt.receiptRef, operationKey: supersessionOperationKey, createdAt,
            });
            loop.activeGenerationRefs = loop.activeGenerationRefs.map((generationRef) =>
              generationRef === predecessor.generationRef ? generation.generationRef : generationRef);
          } else if (!loop.activeGenerationRefs.includes(generation.generationRef)) {
            loop.activeGenerationRefs = [...loop.activeGenerationRefs, generation.generationRef];
          }
          loop.version += 1;
          loop.updatedAt = createdAt;
        }
        stage.currentGeneration = generation.generation;
        stage.currentGenerationRef = generation.generationRef;
        stage.version += 1;
        stage.updatedAt = createdAt;
        return ok(publicStageGeneration(generation));
      });
    },

    activateIterationLoop(subject, iterationLoopRef, input) {
      if (!SAFE_REF_RE.test(iterationLoopRef) || !validNonEmpty(input.operationKey, MAX_SHORT_TEXT)
        || !Number.isSafeInteger(input.expectedLoopVersion) || input.expectedLoopVersion < 0
        || !Array.isArray(input.seedGenerationRefs) || input.seedGenerationRefs.length < 1
        || input.seedGenerationRefs.some((value) => !SAFE_REF_RE.test(value))
        || !isPlainRecord(input.artifactGenerationRefs)
        || ((input.successorRuntime === undefined) !== (input.successorModel === undefined))
        || (input.successorRuntime !== undefined && (!validNonEmpty(input.successorRuntime, MAX_SHORT_TEXT)
          || !validNonEmpty(input.successorModel, MAX_SHORT_TEXT)))) {
        return fail('invalid', 'iteration activation identity is invalid');
      }
      const document = load();
      const loop = document.iterationLoops.find((item) => item.subject === subject && item.iterationLoopRef === iterationLoopRef);
      if (!loop) return fail('not-found', 'iteration loop was not found');
      const operationKey = `iteration-activate:${loop.runRef}:${loop.iterationGroupId}:c1`;
      if (input.operationKey !== operationKey) return fail('invalid', 'iteration activation operationKey is not canonical');
      const artifactIds = Object.keys(input.artifactGenerationRefs).sort();
      const expectedArtifacts = [...loop.activation.seedArtifactIds].sort();
      const mappedGenerationRefs = [...new Set(Object.values(input.artifactGenerationRefs))].sort();
      const seedGenerationRefs = [...new Set(input.seedGenerationRefs)].sort();
      if (canonicalJson(artifactIds as unknown as JsonValue) !== canonicalJson(expectedArtifacts as unknown as JsonValue)
        || canonicalJson(mappedGenerationRefs as unknown as JsonValue) !== canonicalJson(seedGenerationRefs as unknown as JsonValue)) {
        return fail('invalid', 'iteration activation artifacts do not match the declared seed set');
      }
      const seed = loop.participants.find((participant) => participant.participantId === loop.activation.seedParticipantId);
      const step = loop.schedule.find((candidate) => candidate.stepId === loop.initialStepId);
      const route = step && loop.routes.find((candidate) => candidate.routeId === step.routeId);
      if (loop.state !== 'awaiting-seed') {
        const initialProducerTurn = route?.requestKinds.some((kind) => ARTIFACT_PRODUCING_REQUEST_KINDS.has(kind)) === true;
        const recipientStageId = route && loop.participants.find((participant) =>
          participant.participantId === route.recipientParticipantId)?.stageRef;
        const recipientStage = document.stages.find((stage) => stage.subject === subject && stage.runRef === loop.runRef
          && stage.stageId === recipientStageId);
        const producerAttempt = recipientStage?.currentAttemptRef === null ? undefined : document.attempts.find((attempt) =>
          attempt.subject === subject && attempt.attemptRef === recipientStage?.currentAttemptRef
          && attempt.iterationAdvanceOperationKey === input.operationKey);
        const producerReplay = initialProducerTurn && producerAttempt?.state === 'queued';
        if (loop.cyclesUsed === 1 && loop.currentStepId === loop.initialStepId
          && canonicalJson([...loop.activeGenerationRefs].sort() as unknown as JsonValue)
            === canonicalJson(seedGenerationRefs as unknown as JsonValue)
          && (initialProducerTurn ? producerReplay : loop.state === 'awaiting-turn')) {
          return ok(publicIterationLoop(loop), true);
        }
        return fail('conflict', 'iteration loop activation changed');
      }
      const generations = seedGenerationRefs.map((generationRef) => document.stageGenerations.find((candidate) =>
        candidate.subject === subject && candidate.runRef === loop.runRef && candidate.generationRef === generationRef));
      if (!seed || !step || !route || route.senderParticipantId !== seed.participantId
        || generations.some((generation) => !generation || generation.state !== 'committed'
          || generation.logicalStageId !== seed.stageRef)) {
        return fail('conflict', 'iteration seed generation lineage changed');
      }
      const initialProducerTurn = route.requestKinds.some((kind) => ARTIFACT_PRODUCING_REQUEST_KINDS.has(kind));
      let successorAttempt: StoredAttempt | undefined;
      let successorStage: StoredStage | undefined;
      if (initialProducerTurn) {
        const recipient = loop.participants.find((participant) => participant.participantId === route.recipientParticipantId);
        successorStage = recipient && document.stages.find((stage) => stage.subject === subject
          && stage.runRef === loop.runRef && stage.stageId === recipient.stageRef);
        if (!successorStage || !input.successorRuntime || !input.successorModel || successorStage.currentGenerationRef !== null
          || successorStage.currentAttemptRef !== null || (successorStage.state !== 'blocked' && successorStage.state !== 'ready')) {
          return fail('conflict', 'initial iteration producer routing is unavailable');
        }
        const createdAt = stamp();
        const operationFingerprint = sha256(canonicalJson({ operationKey: input.operationKey,
          successorRuntime: input.successorRuntime, successorModel: input.successorModel } as unknown as JsonValue));
        successorAttempt = {
          subject, attemptRef: ref('attempt'), runRef: loop.runRef, stageRef: successorStage.stageRef,
          generation: 1, predecessorAttemptRef: null, runtime: input.successorRuntime, model: input.successorModel,
          state: 'queued', version: 1, managedSessionRef: null, logicalGeneration: 1,
          baseGenerationRef: null, baseCommit: null, createdAt, updatedAt: createdAt,
          iterationAdvanceOperationKey: input.operationKey,
          iterationAdvanceOperationFingerprint: operationFingerprint,
          iterationAdvanceReceiptRef: null,
        };
      }
      return transitionIterationState(document, {
        subject, iterationLoopRef, expectedLoopVersion: input.expectedLoopVersion,
        missingDetail: 'iteration loop was not found', conflictDetail: 'iteration loop activation changed',
      }, ({ loop: currentLoop }) => {
        const createdAt = stamp();
        currentLoop.cyclesUsed = 1;
        currentLoop.state = successorAttempt ? 'rework-queued' : 'awaiting-turn';
        currentLoop.currentStepId = step.stepId;
        currentLoop.turnOwnerParticipantId = route.recipientParticipantId;
        currentLoop.activeGenerationRefs = seedGenerationRefs;
        if (successorAttempt && successorStage) {
          document.attempts.push(successorAttempt);
          successorStage.currentAttemptRef = successorAttempt.attemptRef;
          successorStage.acceptedGenerationRef = null;
          // The attempt is loop-owned. The generation does not exist until canonical commit.
          successorStage.state = 'blocked';
          successorStage.version += 1;
          successorStage.updatedAt = createdAt;
        }
        delete currentLoop.lastReceiptRef;
        delete currentLoop.acceptedGenerationRefs;
        delete currentLoop.completionGateRef;
        delete currentLoop.interventionRef;
        delete currentLoop.parkReason;
        delete currentLoop.unresolvedResidue;
        currentLoop.version += 1;
        currentLoop.updatedAt = createdAt;
        return ok(publicIterationLoop(currentLoop));
      });
    },

    recordIterationRequest(subject, iterationLoopRef, input) {
      if (!SAFE_REF_RE.test(iterationLoopRef) || !validNonEmpty(input.operationKey, MAX_SHORT_TEXT)
        || !SAFE_REF_RE.test(input.routeId) || !Array.isArray(input.inputGenerationRefs)
        || input.inputGenerationRefs.length < 1 || input.inputGenerationRefs.some((value) => !SAFE_REF_RE.test(value))
        || !CANONICAL_COMMIT_RE.test(input.baseCommit) || !isPlainRecord(input.artifactHashes)
        || Object.values(input.artifactHashes).some((value) => typeof value !== 'string' || !HASH_RE.test(value))
        || !Array.isArray(input.unresolvedFindingRefs) || !Array.isArray(input.preservedInvariants)
        || !validNonEmpty(input.nextAcceptanceCheck, MAX_LONG_TEXT) || !validNonEmpty(input.instructions, MAX_LONG_TEXT)) {
        return fail('invalid', 'iteration request content is invalid');
      }
      const document = load();
      const replay = document.iterationRequests.find((item) => item.subject === subject && item.operationKey === input.operationKey);
      if (replay) {
        if (replay.iterationLoopRef !== iterationLoopRef || replay.routeId !== input.routeId || replay.kind !== input.kind
          || replay.baseCommit !== input.baseCommit
          || canonicalJson(replay.inputGenerationRefs as unknown as JsonValue) !== canonicalJson(input.inputGenerationRefs as unknown as JsonValue)
          || canonicalJson(replay.artifactHashes as unknown as JsonValue) !== canonicalJson(input.artifactHashes as unknown as JsonValue)
          || canonicalJson(replay.unresolvedFindingRefs as unknown as JsonValue) !== canonicalJson(input.unresolvedFindingRefs as unknown as JsonValue)
          || canonicalJson(replay.preservedInvariants as unknown as JsonValue) !== canonicalJson(input.preservedInvariants as unknown as JsonValue)
          || replay.nextAcceptanceCheck !== input.nextAcceptanceCheck || replay.instructions !== input.instructions) {
          return fail('idempotency-conflict', 'operationKey was reused with different iteration request content');
        }
        return ok(publicIterationRequest(replay), true);
      }
      const loop = document.iterationLoops.find((item) => item.subject === subject && item.iterationLoopRef === iterationLoopRef);
      if (!loop) return fail('not-found', 'iteration loop was not found');
      const step = loop.currentStepId === undefined ? undefined : loop.schedule.find((candidate) => candidate.stepId === loop.currentStepId);
      const route = step && loop.routes.find((candidate) => candidate.routeId === step.routeId);
      const producerEntry = loop.state === 'rework-queued'
        && ARTIFACT_PRODUCING_REQUEST_KINDS.has(input.kind);
      if ((loop.state !== 'awaiting-turn' && !producerEntry) || !step || !route || route.routeId !== input.routeId
        || route.recipientParticipantId !== loop.turnOwnerParticipantId || !route.requestKinds.includes(input.kind)) {
        return fail('conflict', 'iteration turn owner or declared route changed');
      }
      if (hasBlockingIterationRequest(document, loop)) {
        return fail('ineligible', 'iteration turn is blocked by an open gate or intervention');
      }
      const active = [...loop.activeGenerationRefs].sort();
      if (canonicalJson([...input.inputGenerationRefs].sort() as unknown as JsonValue) !== canonicalJson(active as unknown as JsonValue)) {
        return fail('conflict', 'iteration request generations changed');
      }
      const generations = input.inputGenerationRefs.map((generationRef) => document.stageGenerations.find((candidate) =>
        candidate.subject === subject && candidate.runRef === loop.runRef && candidate.generationRef === generationRef));
      const recipientStageId = loop.participants.find((participant) => participant.participantId === route.recipientParticipantId)?.stageRef;
      const recipientStage = document.stages.find((stage) => stage.subject === subject && stage.runRef === loop.runRef
        && stage.stageId === recipientStageId);
      const producerAttempt = producerEntry && recipientStage?.currentAttemptRef !== null
        ? document.attempts.find((attempt) => attempt.subject === subject
          && attempt.attemptRef === recipientStage?.currentAttemptRef) : undefined;
      if (generations.some((generation) => !generation || generation.state !== 'committed')
        || (producerEntry && (!producerAttempt || producerAttempt.state !== 'queued'
          || producerAttempt.logicalGeneration !== (recipientStage!.currentGenerationRef === null
            ? 1 : recipientStage!.currentGeneration + 1)
          || producerAttempt.baseGenerationRef !== recipientStage!.currentGenerationRef))
        || Object.keys(input.artifactHashes).sort().join('\0') !== [...loop.artifacts].sort().join('\0')) {
        return fail('conflict', 'iteration request lineage changed');
      }
      const lastReceipt = loop.lastReceiptRef === undefined ? undefined : document.iterationReceipts.find((receipt) =>
        receipt.subject === subject && receipt.receiptRef === loop.lastReceiptRef);
      const cycle = lastReceipt === undefined ? 1 : step.cycle === 'next' ? lastReceipt.cycle + 1 : lastReceipt.cycle;
      if (cycle > loop.maxCycles) return fail('ineligible', 'iteration cycle bound is exhausted');
      const request: StoredIterationRequest = {
        subject, runRef: loop.runRef, operationKey: input.operationKey, operationFingerprint: '',
        schema: 'kb.iteration-request/v1', requestRef: ref('iteration-request'), iterationLoopRef,
        stepId: step.stepId, routeId: route.routeId, senderParticipantId: route.senderParticipantId,
        recipientParticipantId: route.recipientParticipantId, kind: input.kind, cycle,
        inputGenerationRefs: [...input.inputGenerationRefs], baseCommit: input.baseCommit,
        artifactHashes: clone(input.artifactHashes), criteria: clone(loop.criteria),
        unresolvedFindingRefs: [...input.unresolvedFindingRefs], preservedInvariants: [...input.preservedInvariants],
        nextAcceptanceCheck: input.nextAcceptanceCheck, instructions: input.instructions,
      };
      request.operationFingerprint = iterationRequestFingerprint(request);
      // The operation fingerprint is intentionally over the canonical persisted request, not caller-only CAS fields.
      const replayFingerprint = request.operationFingerprint;
      return transitionIterationState(document, {
        subject, iterationLoopRef, expectedLoopVersion: input.expectedLoopVersion,
        missingDetail: 'iteration loop was not found', conflictDetail: 'iteration turn owner or declared route changed',
      }, ({ loop: currentLoop }) => {
        request.operationFingerprint = replayFingerprint;
        const participant = currentLoop.participants.find((candidate) => candidate.participantId === request.recipientParticipantId);
        const participantStage = participant && document.stages.find((candidate) => candidate.subject === subject
          && candidate.runRef === currentLoop.runRef && candidate.stageId === participant.stageRef);
        if (!participantStage || !dependenciesSucceeded(document, participantStage)
          || !['blocked', 'ready', 'succeeded'].includes(participantStage.state)) {
          return fail('conflict', 'iteration participant stage is not schedulable');
        }
        if (participantStage.state !== 'ready') {
          participantStage.state = 'ready';
          participantStage.version += 1;
          participantStage.updatedAt = stamp();
        }
        if (producerEntry) {
          const queuedAttempt = participantStage.currentAttemptRef === null ? undefined : document.attempts.find((attempt) =>
            attempt.subject === subject && attempt.attemptRef === participantStage.currentAttemptRef);
          if (!queuedAttempt || queuedAttempt.state !== 'queued'
            || queuedAttempt.logicalGeneration !== (participantStage.currentGenerationRef === null
              ? 1 : participantStage.currentGeneration + 1)
            || queuedAttempt.baseGenerationRef !== participantStage.currentGenerationRef) {
            return fail('conflict', 'iteration producer successor attempt changed');
          }
          queuedAttempt.baseCommit = input.baseCommit;
          queuedAttempt.version += 1;
          queuedAttempt.updatedAt = stamp();
        }
        currentLoop.state = 'running-turn';
        currentLoop.cyclesUsed = cycle;
        currentLoop.version += 1;
        currentLoop.updatedAt = stamp();
        document.iterationRequests.push(request);
        return ok(publicIterationRequest(request));
      });
    },

    recordIterationReceipt(subject, iterationLoopRef, input) {
      if (!SAFE_REF_RE.test(iterationLoopRef) || !SAFE_REF_RE.test(input.requestRef)
        || !validNonEmpty(input.operationKey, MAX_SHORT_TEXT) || !SAFE_REF_RE.test(input.participantAttemptRef)
        || !Array.isArray(input.outputGenerationRefs) || input.outputGenerationRefs.some((value) => !SAFE_REF_RE.test(value))
        || !CANONICAL_COMMIT_RE.test(input.baseCommit) || !CANONICAL_COMMIT_RE.test(input.canonicalCommit)) {
        return fail('invalid', 'iteration receipt content is invalid');
      }
      const document = load();
      const request = document.iterationRequests.find((item) => item.subject === subject && item.requestRef === input.requestRef);
      const loop = document.iterationLoops.find((item) => item.subject === subject && item.iterationLoopRef === iterationLoopRef);
      if (!request || !loop || request.iterationLoopRef !== loop.iterationLoopRef) return fail('not-found', 'iteration request was not found');
      const parsed = parseIterationOutcome(JSON.stringify(input.outcome), { iterationGroup: loop, request });
      if (!parsed.ok) return fail('invalid', parsed.detail);
      const outcome = parsed.value;
      const fingerprint = sha256(canonicalJson({ iterationLoopRef, requestRef: input.requestRef, outcome,
        outputGenerationRefs: input.outputGenerationRefs, baseCommit: input.baseCommit,
        canonicalCommit: input.canonicalCommit, participantAttemptRef: input.participantAttemptRef,
        operationKey: input.operationKey } as unknown as JsonValue));
      const replay = document.iterationReceipts.find((item) => item.subject === subject && item.operationKey === input.operationKey);
      if (replay) {
        if (replay.operationFingerprint !== fingerprint) return fail('idempotency-conflict', 'operationKey was reused with different iteration receipt content');
        return ok(publicIterationReceipt(replay), true);
      }
      if (document.iterationReceipts.some((item) => item.subject === subject && item.requestRef === request.requestRef)) {
        return fail('conflict', 'an iteration receipt already exists for this request');
      }
      const generations = request.inputGenerationRefs.map((generationRef) => document.stageGenerations.find((candidate) =>
        candidate.subject === subject && candidate.runRef === loop.runRef && candidate.generationRef === generationRef));
      const fulfilled = outcome.verdict === 'fulfilled';
      const outputGenerations = input.outputGenerationRefs.map((generationRef) => document.stageGenerations.find((candidate) =>
        candidate.subject === subject && candidate.runRef === loop.runRef && candidate.generationRef === generationRef));
      // request.baseCommit records the worker's shared-lineage base and may include sibling commits;
      // durable generation refs, not that moving commit, identify verdict receipt lineage.
      const activeGenerationRefs = new Set(loop.activeGenerationRefs);
      const primary = fulfilled ? outputGenerations[0]
        : generations.find((generation) => generation !== undefined && activeGenerationRefs.has(generation.generationRef));
      const recipientStageId = loop.participants.find((participant) =>
        participant.participantId === request.recipientParticipantId)?.stageRef;
      const expectedActiveGenerationRefs = fulfilled ? request.inputGenerationRefs.reduce<string[]>((refs, generationRef) => {
        const replacement = outputGenerations.find((generation) => generation?.predecessorGenerationRef === generationRef);
        return [...refs, replacement?.generationRef ?? generationRef];
      }, []).concat(outputGenerations.filter((generation) => generation?.predecessorGenerationRef === null)
        .map((generation) => generation!.generationRef)) : request.inputGenerationRefs;
      if (loop.state !== 'running-turn' || loop.turnOwnerParticipantId !== request.recipientParticipantId
        || loop.currentStepId !== request.stepId || !primary
        || generations.some((generation) => !generation || generation.state !== 'committed')
        || (fulfilled && outputGenerations.some((generation) => !generation || generation.state !== 'committed'
          || generation.baseCommit !== input.baseCommit || generation.canonicalCommit !== input.canonicalCommit
          || generation.logicalStageId !== recipientStageId || generation.attemptRef !== input.participantAttemptRef))
        || (fulfilled && (input.outputGenerationRefs.length !== 1
          || new Set(input.outputGenerationRefs).size !== input.outputGenerationRefs.length))
        || (!fulfilled && input.outputGenerationRefs.length !== 0)
        || (!fulfilled && (primary.baseCommit !== input.baseCommit || primary.canonicalCommit !== input.canonicalCommit))
        || canonicalJson([...loop.activeGenerationRefs].sort() as unknown as JsonValue)
          !== canonicalJson([...expectedActiveGenerationRefs].sort() as unknown as JsonValue)) {
        return fail('conflict', 'iteration receipt lineage or turn owner changed');
      }
      const terminal = loop.terminalAuthorities.some((authority) =>
        authority.participantId === outcome.participantId && authority.verdict === outcome.verdict);
      const explicitPark = outcome.verdict === 'parked';
      const createdAt = stamp();
      let gate: StoredHumanRequest | null = null;
      if ((terminal && loop.completionGate !== undefined) || explicitPark) {
        if (document.humanRequests.filter((item) => item.subject === subject && item.runRef === loop.runRef).length >= MAX_HUMAN_REQUESTS_PER_RUN) {
          return fail('limit', 'run has reached the Human Request limit');
        }
        const stageRef = document.stages.find((stage) => stage.subject === subject && stage.runRef === loop.runRef
          && stage.stageId === loop.participants.find((participant) => participant.participantId === outcome.participantId)?.stageRef)?.stageRef ?? null;
        gate = explicitPark ? {
          subject, operationKey: `iteration-parked:${input.operationKey}`,
          operationFingerprint: sha256(`${iterationLoopRef}\0parked\0${input.operationKey}`),
          requestRef: ref('request'), runRef: loop.runRef, stageRef, kind: 'approval', gateKind: 'iteration-park',
          revision: 1, state: 'open', title: cleanText(`Iteration parked: ${loop.iterationGroupId}`, MAX_TITLE),
          prompt: cleanText(`Participant explicitly parked; approve the exact parked generation set or decline. ${outcome.summary}`, MAX_LONG_TEXT),
          response: null, resolutionOperationFingerprint: null, createdAt, updatedAt: createdAt,
        } : {
          subject, operationKey: `iteration-completion:${input.operationKey}`,
          operationFingerprint: sha256(`${iterationLoopRef}\0${input.operationKey}`),
          requestRef: ref('request'), runRef: loop.runRef, stageRef,
          kind: 'approval', revision: 1, state: 'open', title: cleanText(`Iteration completion: ${loop.iterationGroupId}`, MAX_TITLE),
          prompt: cleanText(`${loop.completionGate!.prompt}\n\nIteration summary: ${outcome.summary}`, MAX_LONG_TEXT),
          response: null, resolutionOperationFingerprint: null, createdAt, updatedAt: createdAt,
        };
      }
      const outcomeBody = {
        requestRef: outcome.requestRef, iterationLoopRef: outcome.iterationLoopRef, participantId: outcome.participantId,
        cycle: outcome.cycle, verdict: outcome.verdict, inputGenerationRefs: [...outcome.inputGenerationRefs],
        criteria: clone(outcome.criteria), findings: clone(outcome.findings),
        ...(outcome.resolvedFindingRefs === undefined ? {} : { resolvedFindingRefs: [...outcome.resolvedFindingRefs] }),
        positions: clone(outcome.positions), recordedDissent: clone(outcome.recordedDissent), summary: outcome.summary,
      };
      const receipt: StoredIterationReceipt = {
        subject, runRef: loop.runRef, routeId: request.routeId, operationKey: input.operationKey,
        operationFingerprint: fingerprint, version: 1, participantAttemptRef: input.participantAttemptRef,
        schema: 'kb.iteration-receipt/v1', receiptRef: ref('iteration-receipt'), ...outcomeBody,
        outcomeHash: sha256(canonicalJson(outcomeBody as unknown as JsonValue)),
        outputGenerationRefs: [...input.outputGenerationRefs], baseCommit: input.baseCommit,
        canonicalCommit: input.canonicalCommit, createdAt,
      };
      return transitionIterationState(document, {
        subject, iterationLoopRef, requestRef: request.requestRef, expectedLoopVersion: input.expectedLoopVersion,
        missingDetail: 'iteration request was not found', conflictDetail: 'iteration receipt lineage or turn owner changed',
      }, ({ loop: currentLoop }) => {
        currentLoop.lastReceiptRef = receipt.receiptRef;
        currentLoop.state = explicitPark ? 'awaiting-park-gate' : terminal ? (gate ? 'awaiting-completion-gate' : 'passed') : 'failed';
        delete currentLoop.turnOwnerParticipantId;
        delete currentLoop.currentStepId;
        if (explicitPark && gate) {
          const loopRequests = document.iterationRequests.filter((item) => item.subject === subject && item.iterationLoopRef === iterationLoopRef);
          const loopReceipts = [...document.iterationReceipts.filter((item) => item.subject === subject
            && item.iterationLoopRef === iterationLoopRef), receipt];
          currentLoop.interventionRef = gate.requestRef;
          currentLoop.parkReason = 'parked';
          currentLoop.unresolvedResidue = iterationResidue(currentLoop, loopRequests, loopReceipts,
            currentLoop.activeGenerationRefs, request.routeId);
          currentLoop.cyclesUsed = currentLoop.unresolvedResidue.cyclesUsed;
          delete currentLoop.acceptedGenerationRefs;
          delete currentLoop.completionGateRef;
          document.humanRequests.push(gate);
        } else if (gate) {
          delete currentLoop.parkReason;
          delete currentLoop.unresolvedResidue;
          delete currentLoop.interventionRef;
          currentLoop.completionGateRef = gate.requestRef;
          delete currentLoop.acceptedGenerationRefs;
          document.humanRequests.push(gate);
        } else if (terminal) {
          delete currentLoop.parkReason;
          delete currentLoop.unresolvedResidue;
          delete currentLoop.interventionRef;
          currentLoop.acceptedGenerationRefs = [...currentLoop.activeGenerationRefs];
          delete currentLoop.completionGateRef;
          for (const generationRef of currentLoop.activeGenerationRefs) {
            const acceptedGeneration = document.stageGenerations.find((item) => item.subject === subject
              && item.runRef === currentLoop.runRef && item.generationRef === generationRef);
            const acceptedStage = acceptedGeneration && document.stages.find((item) => item.subject === subject
              && item.runRef === currentLoop.runRef && item.stageRef === acceptedGeneration.logicalStageRef);
            if (!acceptedStage) return fail('conflict', 'iteration accepted stage projection is incomplete');
            acceptedStage.acceptedGenerationRef = generationRef;
            acceptedStage.version += 1;
            acceptedStage.updatedAt = createdAt;
          }
        } else {
          delete currentLoop.parkReason;
          delete currentLoop.unresolvedResidue;
          delete currentLoop.interventionRef;
          delete currentLoop.acceptedGenerationRefs;
          delete currentLoop.completionGateRef;
        }
        currentLoop.version += 1;
        currentLoop.updatedAt = createdAt;
        document.iterationReceipts.push(receipt);
        return ok(publicIterationReceipt(receipt));
      });
    },

    advanceIterationTurn(subject, iterationLoopRef, input) {
      if (!SAFE_REF_RE.test(iterationLoopRef) || !SAFE_REF_RE.test(input.expectedReceiptRef)
        || !SAFE_REF_RE.test(input.nextStepId) || !validNonEmpty(input.operationKey, MAX_SHORT_TEXT)
        || !Array.isArray(input.expectedActiveGenerationRefs)
        || input.expectedActiveGenerationRefs.some((value) => !SAFE_REF_RE.test(value))
        || ((input.successorRuntime === undefined) !== (input.successorModel === undefined))
        || (input.successorRuntime !== undefined && (!validNonEmpty(input.successorRuntime, MAX_SHORT_TEXT)
          || !validNonEmpty(input.successorModel, MAX_SHORT_TEXT)))) {
        return fail('invalid', 'iteration advance identity is invalid');
      }
      const document = load();
      const loop = document.iterationLoops.find((item) => item.subject === subject && item.iterationLoopRef === iterationLoopRef);
      const receipt = document.iterationReceipts.find((item) => item.subject === subject && item.receiptRef === input.expectedReceiptRef);
      if (!loop || !receipt || receipt.iterationLoopRef !== loop.iterationLoopRef) return fail('not-found', 'iteration receipt was not found');
      const request = document.iterationRequests.find((item) => item.subject === subject && item.requestRef === receipt.requestRef);
      const currentStep = request && loop.schedule.find((step) => step.stepId === request.stepId);
      const nextStep = currentStep && loop.schedule.find((step) => step.stepId === input.nextStepId
        && step.after?.stepId === currentStep.stepId && step.after.participantId === receipt.participantId
        && step.after.verdict === receipt.verdict);
      const nextRoute = nextStep && loop.routes.find((route) => route.routeId === nextStep.routeId);
      if (!request || !currentStep || !nextStep || !nextRoute) return fail('invalid', 'iteration successor is not declared by the schedule');
      const nextParticipant = loop.participants.find((participant) => participant.participantId === nextRoute.recipientParticipantId);
      const nextStage = nextParticipant && document.stages.find((stage) => stage.subject === subject
        && stage.runRef === loop.runRef && stage.stageId === nextParticipant.stageRef);
      const producerTurn = nextRoute.requestKinds.some((kind) => ARTIFACT_PRODUCING_REQUEST_KINDS.has(kind));
      if (!nextStage) return fail('conflict', 'iteration successor participant stage is missing');
      const fingerprint = sha256(canonicalJson({ iterationLoopRef, ...input } as unknown as JsonValue));
      if (loop.advanceOperationKey === input.operationKey) {
        if (loop.advanceOperationFingerprint !== fingerprint) {
          return fail('idempotency-conflict', 'operationKey was reused with different iteration advance content');
        }
        const replayAttempt = nextStage.currentAttemptRef === null ? undefined : document.attempts.find((attempt) =>
          attempt.subject === subject && attempt.attemptRef === nextStage.currentAttemptRef
          && attempt.iterationAdvanceOperationKey === input.operationKey);
        if (loop.lastReceiptRef !== receipt.receiptRef || loop.currentStepId !== nextStep.stepId
          || loop.turnOwnerParticipantId !== nextRoute.recipientParticipantId
          || (producerTurn ? loop.state !== 'rework-queued' || !replayAttempt : loop.state !== 'awaiting-turn')) {
          return fail('conflict', 'iteration advance replay lineage is incomplete');
        }
        return ok(publicIterationLoop(loop), true);
      }
      if (loop.state !== 'failed' || loop.lastReceiptRef !== receipt.receiptRef
        || canonicalJson([...loop.activeGenerationRefs].sort() as unknown as JsonValue)
          !== canonicalJson([...input.expectedActiveGenerationRefs].sort() as unknown as JsonValue)) {
        return fail('conflict', 'iteration advance lineage changed');
      }
      if (hasBlockingIterationRequest(document, loop)) {
        return fail('ineligible', 'iteration turn is blocked by an open gate or intervention');
      }
      const successorCycle = nextStep.cycle === 'next' ? receipt.cycle + 1 : receipt.cycle;
      if (successorCycle > loop.maxCycles) return fail('ineligible', 'iteration cycle bound is exhausted');
      let successorAttempt: StoredAttempt | undefined;
      if (producerTurn) {
        const predecessor = nextStage.currentGenerationRef === null ? undefined : document.stageGenerations.find((generation) =>
          generation.subject === subject && generation.runRef === loop.runRef && generation.generationRef === nextStage.currentGenerationRef);
        if (predecessor && predecessor.state !== 'committed') return fail('conflict', 'iteration producer predecessor is not committed');
        const priorAttempt = nextStage.currentAttemptRef === null ? undefined : document.attempts.find((attempt) =>
          attempt.subject === subject && attempt.runRef === loop.runRef && attempt.attemptRef === nextStage.currentAttemptRef);
        if (priorAttempt && !TERMINAL_ATTEMPT.has(priorAttempt.state) && priorAttempt.state !== 'interrupted') {
          return fail('conflict', 'iteration producer attempt is still active');
        }
        const runtime = nextStage.assignment?.runtime ?? priorAttempt?.runtime ?? input.successorRuntime;
        const model = nextStage.assignment?.model ?? priorAttempt?.model ?? input.successorModel;
        if (!runtime || !model || (nextStage.assignment !== null
          && (runtime !== nextStage.assignment.runtime || model !== nextStage.assignment.model))) {
          return fail('conflict', 'iteration producer routing is unavailable');
        }
        const createdAt = stamp();
        const nextGeneration = predecessor ? predecessor.generation + 1 : 1;
        successorAttempt = {
          subject, attemptRef: ref('attempt'), runRef: loop.runRef, stageRef: nextStage.stageRef,
          generation: Math.max(...document.attempts.filter((attempt) => attempt.subject === subject
            && attempt.stageRef === nextStage.stageRef).map((attempt) => attempt.generation), 0) + 1,
          predecessorAttemptRef: priorAttempt?.attemptRef ?? null, runtime, model, state: 'queued', version: 1,
          managedSessionRef: null, logicalGeneration: nextGeneration,
          baseGenerationRef: predecessor?.generationRef ?? null, baseCommit: predecessor?.canonicalCommit ?? null,
          createdAt, updatedAt: createdAt, iterationAdvanceOperationKey: input.operationKey,
          iterationAdvanceOperationFingerprint: fingerprint, iterationAdvanceReceiptRef: receipt.receiptRef,
        };
      }
      return transitionIterationState(document, {
        subject, iterationLoopRef, receiptRef: receipt.receiptRef, expectedLoopVersion: input.expectedLoopVersion,
        missingDetail: 'iteration receipt was not found', conflictDetail: 'iteration advance lineage changed',
      }, ({ loop: currentLoop }) => {
        if (successorAttempt) {
          document.attempts.push(successorAttempt);
          nextStage.currentAttemptRef = successorAttempt.attemptRef;
          nextStage.acceptedGenerationRef = null;
          // Keep the attempt fenced from DAG dispatch until its durable loop request is recorded.
          nextStage.state = 'blocked';
          nextStage.version += 1;
          nextStage.updatedAt = successorAttempt.createdAt;
        }
        currentLoop.state = successorAttempt ? 'rework-queued' : 'awaiting-turn';
        currentLoop.currentStepId = nextStep.stepId;
        currentLoop.turnOwnerParticipantId = nextRoute.recipientParticipantId;
        currentLoop.advanceOperationKey = input.operationKey;
        currentLoop.advanceOperationFingerprint = fingerprint;
        delete currentLoop.acceptedGenerationRefs;
        delete currentLoop.completionGateRef;
        delete currentLoop.interventionRef;
        delete currentLoop.parkReason;
        delete currentLoop.unresolvedResidue;
        currentLoop.version += 1;
        currentLoop.updatedAt = stamp();
        return ok(publicIterationLoop(currentLoop));
      });
    },

    parkIterationLoop(subject, iterationLoopRef, input) {
      const preIntegration = input.reason === 'no-progress';
      const hasPreIntegrationEvidence = input.attemptedRequestRef !== undefined || input.attemptedOutcome !== undefined
        || input.artifactSnapshots !== undefined || input.failureReason !== undefined;
      if (!SAFE_REF_RE.test(iterationLoopRef)
        || (preIntegration ? input.expectedReceiptRef !== undefined : !SAFE_REF_RE.test(input.expectedReceiptRef ?? ''))
        || (!preIntegration && hasPreIntegrationEvidence)
        || (preIntegration && (!SAFE_REF_RE.test(input.attemptedRequestRef ?? '') || input.attemptedOutcome === undefined
          || !Array.isArray(input.artifactSnapshots) || input.artifactSnapshots.length < 1
          || input.artifactSnapshots.some((snapshot) => !validIterationArtifactSnapshot(snapshot))
          || !validNonEmpty(input.failureReason, MAX_LONG_TEXT)))
        || !SAFE_REF_RE.test(input.nextRouteId) || !validNonEmpty(input.operationKey, MAX_SHORT_TEXT)
        || !['exhausted', 'no-progress', 'parked'].includes(input.reason)
        || !Array.isArray(input.expectedActiveGenerationRefs)
        || input.expectedActiveGenerationRefs.some((value) => !SAFE_REF_RE.test(value))) {
        return fail('invalid', 'iteration park identity is invalid');
      }
      const document = load();
      const loop = document.iterationLoops.find((item) => item.subject === subject && item.iterationLoopRef === iterationLoopRef);
      const receipt = input.expectedReceiptRef === undefined ? undefined : document.iterationReceipts.find((item) =>
        item.subject === subject && item.receiptRef === input.expectedReceiptRef);
      if (!loop || (!preIntegration && (!receipt || receipt.iterationLoopRef !== loop.iterationLoopRef))) {
        return fail('not-found', 'iteration receipt was not found');
      }
      const linkedReceipt = receipt ?? (preIntegration && loop.lastReceiptRef !== undefined
        ? document.iterationReceipts.find((item) => item.subject === subject && item.receiptRef === loop.lastReceiptRef)
        : undefined);
      const fingerprint = sha256(canonicalJson({ iterationLoopRef, ...input } as unknown as JsonValue));
      const replay = document.humanRequests.find((item) => item.subject === subject && item.operationKey === input.operationKey);
      if (replay) {
        if (replay.operationFingerprint !== fingerprint || loop.interventionRef !== replay.requestRef) {
          return fail('idempotency-conflict', 'operationKey was reused with different iteration park content');
        }
        return ok({ loop: publicIterationLoop(loop), receipt: linkedReceipt ? publicIterationReceipt(linkedReceipt) : null,
          receiptVersion: linkedReceipt?.version ?? null, gate: publicRequest(replay) }, true);
      }
      const request = document.iterationRequests.find((item) => item.subject === subject
        && item.requestRef === (preIntegration ? input.attemptedRequestRef : receipt?.requestRef));
      const currentStep = request && loop.schedule.find((step) => step.stepId === request.stepId);
      const nextStep = !preIntegration && currentStep && receipt ? loop.schedule.find((step) =>
        step.after?.stepId === currentStep.stepId && step.after.participantId === receipt.participantId
        && step.after.verdict === receipt.verdict) : undefined;
      const nextRoute = preIntegration
        ? currentStep && loop.routes.find((route) => route.routeId === currentStep.routeId)
        : nextStep && loop.routes.find((route) => route.routeId === nextStep.routeId);
      if (!request || !currentStep || !nextRoute || nextRoute.routeId !== input.nextRouteId
        || (!preIntegration && !nextStep)) {
        return fail('invalid', 'iteration park next route is not declared by the schedule');
      }
      if ((preIntegration
        ? loop.state !== 'running-turn' || loop.currentStepId !== request.stepId
          || loop.turnOwnerParticipantId !== request.recipientParticipantId
        : loop.state !== 'failed' || loop.lastReceiptRef !== receipt?.receiptRef)
        || canonicalJson([...loop.activeGenerationRefs].sort() as unknown as JsonValue)
          !== canonicalJson([...input.expectedActiveGenerationRefs].sort() as unknown as JsonValue)) {
        return fail('conflict', 'iteration park lineage changed');
      }
      const successorCycle = !preIntegration && receipt && nextStep
        ? nextStep.cycle === 'next' ? receipt.cycle + 1 : receipt.cycle : null;
      if (input.reason === 'exhausted' && (successorCycle === null || successorCycle <= loop.maxCycles)) {
        return fail('ineligible', 'iteration cycle bound is not exhausted');
      }
      if (document.humanRequests.filter((item) => item.subject === subject && item.runRef === loop.runRef).length >= MAX_HUMAN_REQUESTS_PER_RUN) {
        return fail('limit', 'run has reached the Human Request limit');
      }
      const loopRequests = document.iterationRequests.filter((item) => item.subject === subject && item.iterationLoopRef === iterationLoopRef);
      const loopReceipts = document.iterationReceipts.filter((item) => item.subject === subject && item.iterationLoopRef === iterationLoopRef);
      let parsedAttemptedOutcome: NonNullable<ParkIterationLoopInput['attemptedOutcome']> | undefined;
      if (preIntegration) {
        const parsed = parseIterationOutcome(JSON.stringify(input.attemptedOutcome), { iterationGroup: loop, request });
        if (!parsed.ok || !ARTIFACT_PRODUCING_REQUEST_KINDS.has(request.kind)) {
          return fail('invalid', parsed.ok ? 'no-progress requires an artifact-producing turn' : parsed.detail);
        }
        parsedAttemptedOutcome = parsed.value;
      }
      const consumedCycles = preIntegration ? Math.max(1, ...loopReceipts.map((item) => item.cycle)) : undefined;
      const residue = iterationResidue(loop, loopRequests, loopReceipts, loop.activeGenerationRefs, input.nextRouteId,
        preIntegration ? {
          attemptedRequestRef: request.requestRef, attemptedOutcome: parsedAttemptedOutcome!,
          artifactSnapshots: input.artifactSnapshots!, failureReason: input.failureReason!, cyclesUsed: consumedCycles!,
        } : undefined);
      const createdAt = stamp();
      const participantId = preIntegration ? request.recipientParticipantId : receipt!.participantId;
      const summary = preIntegration ? parsedAttemptedOutcome!.summary : receipt!.summary;
      const gate: StoredHumanRequest = {
        subject, operationKey: input.operationKey, operationFingerprint: fingerprint,
        requestRef: ref('request'), runRef: loop.runRef,
        stageRef: document.stages.find((stage) => stage.subject === subject && stage.runRef === loop.runRef
          && stage.stageId === loop.participants.find((participant) => participant.participantId === participantId)?.stageRef)?.stageRef ?? null,
        kind: 'approval', gateKind: 'iteration-park', revision: 1, state: 'open', title: cleanText(`Iteration parked: ${loop.iterationGroupId}`, MAX_TITLE),
        prompt: cleanText(`Iteration ${input.reason}; approve the exact parked generation set or decline. ${summary}`, MAX_LONG_TEXT),
        response: null, resolutionOperationFingerprint: null, createdAt, updatedAt: createdAt,
      };
      return transitionIterationState(document, {
        subject, iterationLoopRef, ...(preIntegration ? { requestRef: request.requestRef } : { receiptRef: receipt!.receiptRef }),
        expectedLoopVersion: input.expectedLoopVersion,
        missingDetail: 'iteration receipt was not found', conflictDetail: 'iteration park lineage changed',
      }, ({ loop: currentLoop, receipt: currentReceipt }) => {
        if (!preIntegration && !currentReceipt) return fail('conflict', 'iteration receipt was not found');
        if (preIntegration) {
          const participant = currentLoop.participants.find((candidate) => candidate.participantId === request.recipientParticipantId);
          const stage = participant && document.stages.find((candidate) => candidate.subject === subject
            && candidate.runRef === currentLoop.runRef && candidate.stageId === participant.stageRef);
          const attempt = stage?.currentAttemptRef === null ? undefined : document.attempts.find((candidate) =>
            candidate.subject === subject && candidate.attemptRef === stage?.currentAttemptRef);
          const session = attempt?.managedSessionRef === null ? undefined : document.sessions.find((candidate) =>
            candidate.subject === subject && candidate.sessionRef === attempt?.managedSessionRef);
          if (!stage || !attempt || attempt.state !== 'running') return fail('conflict', 'no-progress attempt lineage changed');
          attempt.state = 'interrupted';
          attempt.version += 1;
          attempt.updatedAt = createdAt;
          if (session && ['pending', 'starting', 'running'].includes(session.state)) {
            session.state = 'interrupted';
            session.version += 1;
            session.updatedAt = createdAt;
          }
          const predecessor = attempt.baseGenerationRef === null ? undefined : document.stageGenerations.find((generation) =>
            generation.subject === subject && generation.generationRef === attempt.baseGenerationRef);
          stage.currentAttemptRef = predecessor?.attemptRef ?? null;
          stage.currentGeneration = predecessor?.generation ?? 1;
          stage.currentGenerationRef = predecessor?.generationRef ?? null;
          stage.state = predecessor ? 'succeeded' : 'blocked';
          stage.version += 1;
          stage.updatedAt = createdAt;
        }
        currentLoop.cyclesUsed = residue.cyclesUsed;
        currentLoop.state = 'awaiting-park-gate';
        currentLoop.interventionRef = gate.requestRef;
        currentLoop.parkReason = input.reason;
        currentLoop.unresolvedResidue = residue;
        delete currentLoop.turnOwnerParticipantId;
        delete currentLoop.currentStepId;
        currentLoop.version += 1;
        currentLoop.updatedAt = createdAt;
        document.humanRequests.push(gate);
        const parkedReceipt = currentReceipt ?? linkedReceipt;
        return ok({ loop: publicIterationLoop(currentLoop), receipt: parkedReceipt ? publicIterationReceipt(parkedReceipt) : null,
          receiptVersion: parkedReceipt?.version ?? null, gate: publicRequest(gate) });
      });
    },

    resolveIterationGate(subject, requestRef, input, scope = 'own-subject') {
      if (!SAFE_REF_RE.test(requestRef) || !validNonEmpty(input.operationKey, MAX_SHORT_TEXT)
        || !['approved', 'declined', 'rejected', 'changes-requested'].includes(input.decision)) {
        return fail('invalid', 'iteration gate resolution is invalid');
      }
      const document = load();
      const gate = findHumanRequest(document, subject, requestRef, scope);
      if (!gate) return fail('not-found', 'iteration gate was not found');
      const owner = gate.subject;
      const loop = document.iterationLoops.find((item) => item.subject === owner
        && (item.completionGateRef === requestRef || item.interventionRef === requestRef));
      const receipt = loop?.lastReceiptRef === undefined ? undefined : document.iterationReceipts.find((item) =>
        item.subject === owner && item.receiptRef === loop.lastReceiptRef);
      if (!loop || (!receipt && (gate.gateKind !== 'iteration-park'
        || loop.unresolvedResidue?.attemptedRequestRef === undefined))) {
        return fail('conflict', 'iteration gate linkage is incomplete');
      }
      if (gate.gateKind === 'iteration-park' && input.decision === 'changes-requested') {
        return fail('invalid', 'iteration-park gates cannot add an in-place cycle');
      }
      const response = input.response == null ? null : cleanText(input.response, MAX_LONG_TEXT);
      const fingerprint = sha256(canonicalJson({ requestRef, ...input, response } as unknown as JsonValue));
      if (gate.response !== null) {
        if (gate.response.idempotencyKey !== input.operationKey || gate.resolutionOperationFingerprint !== fingerprint) {
          return fail('idempotency-conflict', 'iteration gate response was reused with different content');
        }
        const existingIntervention = !loop.interventionRef || loop.interventionRef === gate.requestRef
          ? null : document.humanRequests.find((item) => item.subject === owner
            && item.requestRef === loop.interventionRef) ?? null;
        return ok({ loop: publicIterationLoop(loop), receipt: receipt ? publicIterationReceipt(receipt) : null,
          receiptVersion: receipt?.version ?? null,
          gate: publicRequest(gate), interventionRequest: existingIntervention ? publicRequest(existingIntervention) : null }, true);
      }
      const parkGate = gate.gateKind === 'iteration-park';
      if ((!parkGate && gate.kind !== 'approval') || gate.state !== 'open' || gate.revision !== input.expectedRequestRevision
        || loop.version !== input.expectedLoopVersion || (input.expectedReceiptVersion === null
          ? receipt !== undefined : receipt?.version !== input.expectedReceiptVersion)
        || (parkGate ? loop.state !== 'awaiting-park-gate' || loop.interventionRef !== requestRef
          : loop.state !== 'awaiting-completion-gate' || loop.completionGateRef !== requestRef)) {
        return fail('conflict', 'iteration gate resolution changed');
      }
      const approved = input.decision === 'approved';
      const createdAt = stamp();
      let intervention: StoredHumanRequest | null = null;
      if (!parkGate && !approved) {
        if (!receipt) return fail('conflict', 'iteration completion receipt is missing');
        if (document.humanRequests.filter((item) => item.subject === owner && item.runRef === loop.runRef).length >= MAX_HUMAN_REQUESTS_PER_RUN) {
          return fail('limit', 'run has reached the Human Request limit');
        }
        intervention = {
          subject: owner, operationKey: `iteration-intervention:${input.operationKey}`,
          operationFingerprint: sha256(`${requestRef}\0${input.operationKey}`), requestRef: ref('request'),
          runRef: loop.runRef, stageRef: gate.stageRef, kind: 'intervention', revision: 1, state: 'open',
          title: cleanText(`Iteration intervention: ${loop.iterationGroupId}`, MAX_TITLE),
          prompt: cleanText(`Completion gate ${input.decision}: ${receipt.summary}`, MAX_LONG_TEXT), response: null,
          resolutionOperationFingerprint: null, createdAt, updatedAt: createdAt,
        };
      }
      return transitionIterationState(document, {
        subject: owner, iterationLoopRef: loop.iterationLoopRef, gateRef: requestRef,
        expectedLoopVersion: input.expectedLoopVersion, expectedReceiptVersion: input.expectedReceiptVersion,
        missingDetail: 'iteration gate linkage is incomplete', conflictDetail: 'iteration gate resolution changed',
      }, ({ loop: currentLoop, receipt: currentReceipt }) => {
        if (!parkGate && !currentReceipt) return fail('conflict', 'iteration gate linkage is incomplete');
        const responseDecision: HumanRequestDecision = approved ? 'approved' : 'rejected';
        gate.response = { requestRevision: gate.revision, decision: responseDecision, respondedBy: subject,
          idempotencyKey: input.operationKey, response, respondedAt: createdAt };
        gate.resolutionOperationFingerprint = fingerprint;
        gate.state = 'resolved';
        gate.updatedAt = createdAt;
        if (currentReceipt) currentReceipt.version += 1;
        if (parkGate) {
          currentLoop.state = approved ? 'passed' : 'declined';
          currentLoop.acceptedGenerationRefs = approved ? [...currentLoop.activeGenerationRefs] : [];
          // Retain the resolved gate link as durable evidence of the exact-set decision.
          currentLoop.interventionRef = gate.requestRef;
        } else {
          currentLoop.state = approved ? 'passed' : 'parked';
          currentLoop.acceptedGenerationRefs = approved ? [...currentLoop.activeGenerationRefs] : [];
          if (intervention) {
            currentLoop.interventionRef = intervention.requestRef;
            document.humanRequests.push(intervention);
          } else {
            delete currentLoop.interventionRef;
          }
        }
        for (const generationRef of currentLoop.activeGenerationRefs) {
          const decidedGeneration = document.stageGenerations.find((item) => item.subject === owner
            && item.runRef === currentLoop.runRef && item.generationRef === generationRef);
          const decidedStage = decidedGeneration && document.stages.find((item) => item.subject === owner
            && item.runRef === currentLoop.runRef && item.stageRef === decidedGeneration.logicalStageRef);
          if (!decidedStage) return fail('conflict', 'iteration gate stage projection is incomplete');
          decidedStage.acceptedGenerationRef = approved ? generationRef : null;
          decidedStage.version += 1;
          decidedStage.updatedAt = createdAt;
        }
        currentLoop.version += 1;
        currentLoop.updatedAt = createdAt;
        return ok({ loop: publicIterationLoop(currentLoop), receipt: currentReceipt ? publicIterationReceipt(currentReceipt) : null,
          receiptVersion: currentReceipt?.version ?? null, gate: publicRequest(gate),
          interventionRequest: intervention ? publicRequest(intervention) : null });
      });
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
      const loop = iterationLoopForStage(document, stage);
      if (loop) {
        const participant = loop.participants.find((candidate) => candidate.stageRef === stage.stageId);
        const request = document.iterationRequests.find((candidate) => candidate.subject === subject
          && candidate.iterationLoopRef === loop.iterationLoopRef && candidate.stepId === loop.currentStepId
          && !document.iterationReceipts.some((receipt) => receipt.subject === subject && receipt.requestRef === candidate.requestRef));
        const seedAttempt = loop.state === 'awaiting-seed' && participant?.participantId === loop.activation.seedParticipantId
          && stage.currentGenerationRef === null;
        if (!seedAttempt && (loop.state !== 'running-turn' || !participant
          || request?.recipientParticipantId !== participant.participantId)) {
          return fail('conflict', 'iteration attempt is not the active turn owner');
        }
      } else if (!dependenciesAcceptedForAttempt(document, stage)) {
        return fail('invalid', 'stage dependencies are not accepted');
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
        logicalGeneration: null,
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
      if (iterationLoopForStage(document, stage)) {
        return fail('invalid', 'loop-managed participant stages cannot reroute outside their iteration transaction');
      }
      if (stage.version !== input.expectedStageVersion || stage.currentAttemptRef !== input.expectedAttemptRef) {
        return fail('conflict', 'stage version or current attempt changed');
      }
      if (stage.state !== 'ready' && stage.state !== 'blocked') {
        return fail('invalid', 'only a ready or blocked stage can reroute before execution');
      }
      const run = findRun(document, subject, stage.runRef);
      if (!run || run.publicationState !== 'published' || isTerminalRun(run.lifecycle)
        || runLifecycleKind(run.lifecycle) === 'stopping') {
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
      if (isTerminalRun(run.lifecycle)) return fail('invalid', 'terminal runs require a successor run, not a Manager replacement');
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
      const priorKind = runLifecycleKind(run.lifecycle);
      if (priorKind !== 'recovering' && !canTransitionRun(run.lifecycle, 'recovering')) {
        return fail('invalid', `run transition ${priorKind}->recovering is not allowed`);
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
      if (runLifecycleKind(run.lifecycle) !== 'waiting-human') {
        run.lifecycle = lifecycleForKind('recovering', null);
      }
      run.version += 1;
      run.updatedAt = createdAt;
      document.sessions.push(session);
      commit(document);
      return ok(publicSession(session));
    },

    recordManagerCommand(subject, runRef, input, scope = 'own-subject') {
      const document = load();
      const run = findRun(document, subject, runRef, scope);
      if (!run) return fail('not-found', 'run was not found');
      // Everything below is partitioned by the RUN's owner, not the caller: the command's event belongs
      // on the run's own timeline (`listEvents`, the event cap, the quarantine bundle all key off it),
      // and the Manager session it targets is the run's. Who ISSUED it is carried by `source: 'human'`
      // plus the route's session gate and audit row — see {@link ReadScope}.
      const owner = run.subject;
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
        item.subject === owner && item.runRef === runRef && item.operationKey === input.idempotencyKey,
      );
      if (replay) {
        if (replay.operationFingerprint !== fingerprint) {
          return fail('idempotency-conflict', 'idempotencyKey was reused with different manager command content');
        }
        return ok({ run: internalRun(run), event: publicEvent(replay) }, true);
      }
      if (run.version !== input.expectedRunVersion || run.managerGeneration !== input.expectedManagerGeneration) {
        return fail('conflict', 'run version or manager generation changed');
      }
      if (isTerminalRun(run.lifecycle)) return fail('invalid', 'terminal runs cannot accept manager commands');
      const manager = document.sessions.find((item) =>
        item.subject === owner && item.sessionRef === run.managerSessionRef && item.role === 'manager',
      );
      if (!manager) return fail('conflict', 'current manager session is missing');
      const createdAt = stamp();
      const event: StoredEvent = {
        subject: owner,
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
        const priorKind = runLifecycleKind(run.lifecycle);
        if (priorKind !== 'stopping' && !canTransitionRun(run.lifecycle, 'stopping')) {
          return fail('invalid', `run transition ${priorKind}->stopping is not allowed`);
        }
        run.lifecycle = lifecycleForKind('stopping', null);
        run.version += 1;
        run.updatedAt = createdAt;
      }
      commit(document);
      return ok({ run: internalRun(run), event: publicEvent(event) });
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
        return ok({ run: internalRun(run), event: publicEvent(replay) }, true);
      }
      if (run.version !== input.expectedRunVersion) return fail('conflict', 'run version changed');
      const priorKind = runLifecycleKind(run.lifecycle);
      if (priorKind !== 'stopping' && !canTransitionRun(run.lifecycle, 'stopping')) {
        return fail('invalid', `run transition ${priorKind}->stopping is not allowed`);
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
      if (priorKind !== 'stopping') {
        run.lifecycle = lifecycleForKind('stopping', null);
        run.version += 1;
        run.updatedAt = createdAt;
      }
      commit(document);
      return ok({ run: internalRun(run), event: publicEvent(event) });
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

    getHumanRequest(subject, requestRef, scope = 'own-subject') {
      const request = findHumanRequest(load(), subject, requestRef, scope);
      return request ? ok(publicRequest(request)) : fail('not-found', 'Human Request was not found');
    },

    createHumanRequest(subject, runRef, input, scope = 'own-subject') {
      const document = load();
      const run = findRun(document, subject, runRef, scope);
      if (!run) return fail('not-found', 'run was not found');
      // The request belongs to the RUN, so it is filed under the run's owner: the engine that owns the
      // run has to be able to see and resolve the ask a widened caller filed on it.
      const owner = run.subject;
      if (document.humanRequests.filter((item) => item.subject === owner && item.runRef === runRef).length >= MAX_HUMAN_REQUESTS_PER_RUN) {
        return fail('limit', 'run has reached the Human Request limit');
      }
      if (!validNonEmpty(input.title, MAX_TITLE) || !validNonEmpty(input.prompt, MAX_LONG_TEXT)) return fail('invalid', 'Human Request title and prompt are required');
      const stageRef = input.stageRef ?? null;
      if (stageRef && !document.stages.some((item) => item.subject === owner && item.runRef === runRef && item.stageRef === stageRef)) {
        return fail('invalid', 'Human Request stageRef does not belong to this run');
      }
      if (!HUMAN_REQUEST_KINDS.has(input.kind)) return fail('invalid', 'Human Request kind is invalid');
      const createdAt = stamp();
      const request: StoredHumanRequest = {
        subject: owner,
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
      if (input.idempotencyKey.startsWith('iteration-parked:') || input.idempotencyKey.startsWith('iteration-completion:')
        || input.idempotencyKey.startsWith('iteration-intervention:')) {
        return fail('invalid', 'iteration request operation namespaces are reserved');
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
      if (isIterationGateRequest(document, requestRef)) {
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
        run: internalRun(run),
        event: publicEvent(event),
        receipt: publicAuthorizedFailedRunReceipt(receipt),
      });
    },

    respondHumanRequest(subject, requestRef, input, scope = 'own-subject') {
      const document = load();
      const request = findHumanRequest(document, subject, requestRef, scope);
      if (!request) return fail('not-found', 'Human Request was not found');
      if (isIterationGateRequest(document, requestRef)) {
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
      // `subject`, deliberately, not `request.subject`: `respondedBy` is the record of WHO ANSWERED, so
      // under a widened scope it must name the operator. The request itself keeps its owner — the
      // resolution is a fact about the run's ask, not a transfer of it.
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
    archiveRun(subject, runRef, input, scope = 'own-subject') {
      const document = load();
      const run = findRun(document, subject, runRef, scope);
      if (!run) return fail('not-found', 'run was not found');
      // The run's requests are filed under the run's owner, so the sweep below reads them from there;
      // only the RESPONSE each one gets names the caller (see `recordHumanResponse` call).
      const owner = run.subject;
      if (!validNonEmpty(input.idempotencyKey, MAX_SHORT_TEXT)) return fail('invalid', 'idempotencyKey is required');
      const reason = input.reason == null ? null : cleanText(input.reason, MAX_LONG_TEXT);
      const fingerprint = sha256(`${runRef}\0${reason ?? ''}`);
      const resolvedRequests = (): HumanRequest[] => document.humanRequests
        .filter((item) => item.subject === owner && item.runRef === runRef
          && item.response?.idempotencyKey === archiveResponseKey(input.idempotencyKey, item.requestRef))
        .map(publicRequest);
      const pinned = (): string[] => document.humanRequests
        .filter((item) => item.subject === owner && item.runRef === runRef && item.state === 'open')
        .map((item) => item.requestRef);
      if (run.archiveOperationKey) {
        if (run.archiveOperationKey !== input.idempotencyKey) return fail('conflict', 'run is already archived');
        if (run.archiveOperationFingerprint !== fingerprint) {
          return fail('idempotency-conflict', 'archive idempotencyKey was reused with a different reason');
        }
        return ok({ run: internalRun(run), resolvedRequests: resolvedRequests(), pinnedRequestRefs: pinned() }, true);
      }
      if (!canTransitionRun(run.lifecycle, 'archived')) {
        return fail('invalid', 'only a finished, stopped, interrupted, or waiting-human run can be archived');
      }
      const archivedAt = stamp();
      for (const request of document.humanRequests) {
        if (request.subject !== owner || request.runRef !== runRef || request.state !== 'open') continue;
        // A review-linked request is pinned open by the review lineage invariants; touching it here would
        // make the document fail its own validation on the next load. Reported, never forced.
        if (isIterationGateRequest(document, request.requestRef)) continue;
        recordHumanResponse(request, subject, {
          decision: 'responded',
          idempotencyKey: archiveResponseKey(input.idempotencyKey, request.requestRef),
          response: reason,
        }, archivedAt);
      }
      const archivedFrom = runLifecycleKind(run.lifecycle);
      run.lifecycle = lifecycleForKind('archived', null);
      run.version += 1;
      run.updatedAt = archivedAt;
      run.archivedFrom = archivedFrom as Run['archivedFrom'];
      if (archivedFrom === 'interrupted') {
        run.terminalOutcome = 'interrupted';
        run.completedAt = archivedAt;
      } else if (archivedFrom === 'waiting-human') {
        run.terminalOutcome = 'abandoned';
        run.completedAt = archivedAt;
      }
      run.archiveOperationKey = input.idempotencyKey;
      run.archiveOperationFingerprint = fingerprint;
      commit(document);
      return ok({ run: internalRun(run), resolvedRequests: resolvedRequests(), pinnedRequestRefs: pinned() });
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
        if (!isTerminalRun(run.lifecycle)) continue;
        const terminalKind = runLifecycleKind(run.lifecycle);
        closed.push(...autoCloseOpenHumanRequestsForRun(
          document, run.subject, run.runRef, atISO, `terminal:${terminalKind}`,
          `Automatically closed — the run reached its terminal state ('${terminalKind}') without this being answered.`,
          maxEvents,
        ));
      }
      if (closed.length > 0) commit(document);
      return { closed: closed.map(publicRequest) };
    },

    appendEvent(subject, runRef, input, scope = 'own-subject') {
      const document = load();
      const run = findRun(document, subject, runRef, scope);
      if (!run) return fail('not-found', 'run was not found');
      // An event is a line on the RUN's timeline, so it is filed under the run's owner even when a
      // widened caller writes it: `listEvents` pages by `run.subject`, the per-run cap counts by it,
      // and the quarantine bundle collects by it — an operator-stamped event would be invisible in the
      // first, uncapped in the second, and orphaned by the third. Who acted lives in the summary text
      // (`source: 'human'`) and in the route's audit row.
      const owner = run.subject;
      if (Object.keys(input as object).some((field) => !EVENT_FIELDS.has(field))) return fail('invalid', 'operational event contains an unknown field');
      if (!EVENT_KINDS.has(input.kind) || !EVENT_SOURCES.has(input.source) || (input.status != null && !EVENT_STATUSES.has(input.status))) {
        return fail('invalid', 'operational event kind, source, or status is invalid');
      }
      if (!validOptionalEventText(input)) return fail('invalid', 'operational event text fields must be strings without NUL bytes');
      const currentCount = document.events.filter((item) => item.subject === owner && item.runRef === runRef).length;
      if (currentCount >= maxEvents) return fail('limit', 'run has reached the operational event limit');
      const refError = validateRefs(document, owner, runRef, input);
      if (refError) return fail('invalid', refError);
      const event: StoredEvent = {
        subject: owner,
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

    inventory(subject, scope = 'own-subject') {
      const document = load();
      const mine = (owner: string): boolean => scope === 'all-subjects' || owner === subject;
      // Each bundle is still assembled under its OWN subject; the scope only decides which bundles are
      // listed at all.
      const activeRuns = document.runs.filter((run) => mine(run.subject)).map((run) => inventoryItem(activeBundle(document, run.subject, run)));
      const quarantinedRuns = document.quarantine.filter((bundle) => mine(bundle.subject)).map(inventoryItem);
      const proposalBytes = document.proposals
        .filter((proposal) => mine(proposal.subject))
        .reduce((sum, proposal) => sum + Buffer.byteLength(JSON.stringify(proposal), 'utf8'), 0);
      return {
        activeRuns,
        quarantinedRuns,
        proposalRevisionCount: document.proposals.filter((proposal) => mine(proposal.subject)).length,
        nextEventCursor: document.nextEventCursor,
        estimatedBytes: proposalBytes
          + activeRuns.reduce((sum, item) => sum + item.estimatedBytes, 0)
          + quarantinedRuns.reduce((sum, item) => sum + item.estimatedBytes, 0),
      };
    },

    dryRunQuarantine(subject, runRefs, scope = 'own-subject') {
      return quarantinePlan(load(), subject, runRefs, stamp(), scope);
    },

    quarantineRuns(subject, runRefs, expectedPlanHash, scope = 'own-subject') {
      const document = load();
      options.beforeIterationBoundaryValidationForTest?.('quarantine', document);
      validateGenericIterationBundle(document);
      const planned = quarantinePlan(document, subject, runRefs, stamp(), scope);
      if (!planned.ok) return planned;
      if (planned.value.planHash !== expectedPlanHash) return fail('conflict', 'quarantine plan changed; review a fresh dry-run');
      if (planned.value.items.some((item) => !item.eligible)) {
        return fail('ineligible', 'only quiescent terminal or interrupted run bundles without open Human Requests can be quarantined');
      }
      const quarantinedAt = stamp();
      const moved: StorageInventoryItem[] = [];
      for (const item of planned.value.items) {
        const run = findRun(document, subject, item.runRef, scope);
        if (!run) return fail('conflict', 'quarantine plan changed');
        // `owner` — never the caller — keys the bundle and every partition sweep below. Sweeping by the
        // caller's subject on a widened quarantine would archive an EMPTY bundle and leave the owner's
        // stages, attempts, sessions, requests and events orphaned behind the removed run.
        const owner = run.subject;
        const bundle: QuarantinedRunBundle = { ...activeBundle(document, owner, run), quarantinedAt };
        document.quarantine.push(bundle);
        document.runs = document.runs.filter((value) => value !== run);
        document.stages = document.stages.filter((value) => value.subject !== owner || value.runRef !== run.runRef);
        document.attempts = document.attempts.filter((value) => value.subject !== owner || value.runRef !== run.runRef);
        document.sessions = document.sessions.filter((value) => value.subject !== owner || value.runRef !== run.runRef);
        document.humanRequests = document.humanRequests.filter((value) => value.subject !== owner || value.runRef !== run.runRef);
        document.events = document.events.filter((value) => value.subject !== owner || value.runRef !== run.runRef);
        document.stageGenerations = document.stageGenerations.filter((value) => value.subject !== owner || value.runRef !== run.runRef);
        document.iterationLoops = document.iterationLoops.filter((value) => value.subject !== owner || value.runRef !== run.runRef);
        document.iterationRequests = document.iterationRequests.filter((value) => value.subject !== owner || value.runRef !== run.runRef);
        document.iterationReceipts = document.iterationReceipts.filter((value) => value.subject !== owner || value.runRef !== run.runRef);
        document.generationSupersessions = document.generationSupersessions.filter((value) => value.subject !== owner || value.runRef !== run.runRef);
        moved.push(inventoryItem(bundle));
      }
      commit(document);
      return ok(moved);
    },

    restoreRun(subject, runRef, scope = 'own-subject') {
      const document = load();
      if (findRun(document, subject, runRef, scope)) return fail('conflict', 'an active run already has this reference');
      const index = document.quarantine.findIndex((bundle) =>
        (scope === 'all-subjects' || bundle.subject === subject) && bundle.run.runRef === runRef);
      if (index < 0) return fail('not-found', 'quarantined run was not found');
      const [bundle] = document.quarantine.splice(index, 1);
      options.beforeIterationBoundaryValidationForTest?.('restore', bundle);
      validateGenericIterationBundle(bundle);
      // Restore puts the bundle back exactly where it came from: every record it carries already names
      // its own subject, and the recovery event and the returned metadata are filed under that same
      // owner, never under whoever asked for the restore.
      const owner = bundle.subject;
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
      document.iterationLoops.push(...bundle.iterationLoops);
      document.iterationRequests.push(...bundle.iterationRequests);
      document.iterationReceipts.push(...bundle.iterationReceipts);
      document.generationSupersessions.push(...bundle.generationSupersessions);
      document.events.sort((a, b) => a.cursor - b.cursor);
      const recoveryEvent: StoredEvent = {
        subject: owner,
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
      return ok(metadata(document, owner, bundle.run));
    },
  };
}

/**
 * P6 W6.2 [P6-C55]: a fresh, maximally-capable synthetic advertisement — `pty`/`gpu` true, both CLIs
 * `ready`, empty connector/skill/root lists (an empty `CapabilityRequirement` is the common case for a
 * test fixture that never declares one). This is what `createInMemoryControlPlaneStore` seeds by
 * default so every P2-era launch test — written before placement existed — keeps succeeding without
 * each of dozens of call sites naming a host explicitly. Pass `initialHostAdvertisements: []` to opt out
 * and exercise the `no-complete-placement` refusal instead.
 */
function defaultTestHostAdvertisement(): StoredHostAdvertisement {
  return {
    hostId: 'vm', daemonVersion: '1.0.0', reportedAt: new Date().toISOString(),
    connectors: [], skills: [], filesystemRoots: [], pty: true, gpu: true,
    clis: { claude: 'ready', codex: 'ready' }, version: 1,
  };
}

export function createInMemoryControlPlaneStore(options: ControlStoreOptions = {}): ControlPlaneStore {
  let document = {
    ...emptyStoreDocumentForTest(),
    hostAdvertisements: options.initialHostAdvertisements ?? [defaultTestHostAdvertisement()],
  };
  const maxBytes = options.maxDocumentBytes ?? MAX_CONTROL_DOCUMENT_BYTES;
  return makeStore(
    () => {
      const loaded = clone(document);
      validateGenericIterationBundle(loaded);
      for (const bundle of loaded.quarantine) validateGenericIterationBundle(bundle);
      return loaded;
    },
    (next) => {
      const persisted = genericPersistenceDocument(next);
      const bytes = Buffer.byteLength(JSON.stringify(persisted), 'utf8');
      if (bytes > maxBytes) throw new ControlStoreLimitError(`control-plane store exceeds ${maxBytes} bytes`);
      document = persisted;
    },
    options,
  );
}

const READ_ONLY_CONTROL_STORE_METHODS = new Set<keyof ControlPlaneStore>([
  'getControlDocumentMetadata', 'getScheduleSnapshot', 'readScheduleSnapshot', 'resolveScheduleReceiptOwner',
  'isScheduleSeedAuthorized',
  'getScheduleSeedImportMarker', 'readSchedulePauseMarkerReceipt', 'listIncompleteSchedulePauseMarkerReceipts',
  'getDeployment', 'listDeployments',
  'getAssetPullIntent', 'listAssetPullIntents',
  'listProposalRevisions', 'listProposalRevisionsForComposer', 'getProposalRevision',
  'listHostAdvertisements',
  'listRuns', 'getRun', 'findActiveRunForRevision', 'getRunActivationReceipt', 'hasActiveRunActivation',
  'getHumanRequest', 'preflightAuthorized20260731ExecutionLock',
  'preflightAuthorized20260801FailedRunReconciliation', 'listEvents', 'inventory', 'dryRunQuarantine',
]);

function readOnlyControlPlaneStore(store: ControlPlaneStore): ControlPlaneStore {
  return new Proxy(store, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof property !== 'string' || typeof value !== 'function'
        || READ_ONLY_CONTROL_STORE_METHODS.has(property as keyof ControlPlaneStore)) return value;
      return () => { throw new ControlStoreReadOnlyError(); };
    },
  });
}

/** File-backed daemon store. Every mutation replaces one sibling temp file atomically. */
export function createFileControlPlaneStore(
  stateRoot: string,
  access: FileControlPlaneAccess,
  options: ControlStoreOptions = {},
): ControlPlaneStore {
  const path = join(stateRoot, 'control', 'control-plane.json');
  const acceptedSizePath = join(stateRoot, 'control', CONTROL_PLANE_ACCEPTED_SIZE_FILENAME);
  const maxBytes = options.maxDocumentBytes ?? MAX_CONTROL_DOCUMENT_BYTES;
  const persistenceTargetBytes = options.persistenceTargetBytesForTest;
  if (persistenceTargetBytes !== undefined) {
    if (process.env.NODE_ENV !== 'test' && process.env.KB_VM_DURABILITY_BENCHMARK !== '1') {
      throw new Error('persistenceTargetBytesForTest is available only in tests or the VM durability benchmark');
    }
    if (!Number.isSafeInteger(persistenceTargetBytes) || persistenceTargetBytes < 1) {
      throw new Error('persistenceTargetBytesForTest must be a positive safe integer');
    }
  }
  let acceptedMaxBytes = maxBytes;
  // The one post-hydration validation triad every load path runs: full-document schema check, then the
  // generic iteration-bundle check on the document and each quarantined bundle.
  const assertHydrated = (document: StoreDocument): void => {
    validateStoreDocument(document);
    validateGenericIterationBundle(document);
    for (const bundle of document.quarantine) validateGenericIterationBundle(bundle);
  };
  if (access.mode === 'already-locked') assertWriterLeaseForRoot(access.lease, stateRoot);
  if (access.mode === 'read-only-harness') {
    const loadReadOnly = (): StoreDocument => {
      if (!existsSync(path)) throw new ControlStoreReadOnlyError();
      if (statSync(path).size > maxBytes) {
        throw new ControlStoreLimitError(`control-plane store exceeds ${maxBytes} bytes`);
      }
      const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)
        || (parsed as Record<string, unknown>).version !== CONTROL_PLANE_SCHEMA_VERSION) {
        throw new ControlStoreReadOnlyError();
      }
      const document = parsed as StoreDocument;
      assertHydrated(document);
      return clone(document);
    };
    loadReadOnly();
    return readOnlyControlPlaneStore(makeStore(
      loadReadOnly,
      () => { throw new ControlStoreReadOnlyError(); },
      options,
    ));
  }
  const lease = access.lease;
  const migrateDocument = options.loadAndMigrateForTest ?? loadAndMigrate;
  const startupStamp = (options.now ?? (() => new Date()))().toISOString();
  const migrationContext = (source: string): MigrationContext => {
    const raw = JSON.parse(source) as Record<string, unknown>;
    const supplied = options.p2MigrationContext;
    if (Number(raw.version) < CONTROL_PLANE_SCHEMA_VERSION
      && (!supplied || !Array.isArray(supplied.agentDeclarations)
        || !Array.isArray(supplied.workflowDefinitions)
        || !Array.isArray(supplied.workflowLaunchAudits)
        || !Array.isArray(supplied.auditRows))) {
      throw new Error('control-plane v2 migration requires attested production evidence');
    }
    return {
      stamp: startupStamp,
      executionHost: process.platform === 'win32' ? 'desktop' : 'vm',
      ...supplied,
      // Bind any explicit operator mapping to the exact persisted bytes being
      // migrated. Callers cannot substitute a checksum for a different store.
      sourceSha256: createHash('sha256').update(source).digest('hex'),
    };
  };
  const bootId = options.bootId ?? lease.bootId;
  const requiresGenericRewrite = (raw: Record<string, unknown>): boolean => {
    const quarantined = Array.isArray(raw.quarantine) ? raw.quarantine as Array<Record<string, unknown>> : [];
    return Object.hasOwn(raw, 'reviewLoops') || Object.hasOwn(raw, 'reviewReceipts')
      || !Object.hasOwn(raw, 'iterationLoops') || !Object.hasOwn(raw, 'iterationRequests')
      || !Object.hasOwn(raw, 'iterationReceipts')
      || quarantined.some((bundle) => Object.hasOwn(bundle, 'reviewLoops') || Object.hasOwn(bundle, 'reviewReceipts')
        || !Object.hasOwn(bundle, 'iterationLoops') || !Object.hasOwn(bundle, 'iterationRequests')
        || !Object.hasOwn(bundle, 'iterationReceipts'));
  };
  const hydrate = (encoded: string): StoreDocument => {
    const migrated = migrateDocument(encoded, CONTROL_PLANE_SCHEMA_VERSION, migrationContext(encoded)).document;
    assertHydrated(migrated);
    return migrated;
  };
  const load = (): StoreDocument => {
    assertWriterLeaseForRoot(lease, stateRoot);
    if (!existsSync(path)) return emptyStoreDocumentForTest();
    if (statSync(path).size > acceptedMaxBytes) {
      throw new ControlStoreLimitError(`control-plane store exceeds ${acceptedMaxBytes} bytes`);
    }
    return hydrate(readFileSync(path, 'utf8'));
  };
  const save = (
    document: StoreDocument,
    durability: SaveDurability = 'ordinary',
    enforceConfiguredLimit = true,
  ): void => {
    assertWriterLeaseForRoot(lease, stateRoot);
    const persisted = genericPersistenceDocument(document);
    const canonical = JSON.stringify(persisted);
    const canonicalBytes = Buffer.byteLength(canonical, 'utf8') + 1;
    if (persistenceTargetBytes !== undefined && persistenceTargetBytes < canonicalBytes) {
      throw new ControlStoreLimitError(
        `persistence target ${persistenceTargetBytes} bytes is smaller than encoded document ${canonicalBytes} bytes`,
      );
    }
    const encoded = persistenceTargetBytes === undefined
      ? `${canonical}\n`
      : `${canonical}${' '.repeat(persistenceTargetBytes - canonicalBytes)}\n`;
    if (enforceConfiguredLimit && Buffer.byteLength(encoded, 'utf8') > acceptedMaxBytes) {
      throw new ControlStoreLimitError(`control-plane store exceeds ${acceptedMaxBytes} bytes`);
    }
    persistControlDocumentSync(path, encoded, durability, options.persistenceDepsForTest);
  };
  let recovered = emptyStoreDocumentForTest();
  let migrated = false;
  let legacyRewrite = false;
  let sourceBytes = 0;
  let migrationBackupSource: Buffer | null = null;
  let migrationBackupFrom = 0;
  if (existsSync(path)) {
    sourceBytes = statSync(path).size;
    const source = readFileSync(path, 'utf8');
    const parsed: unknown = JSON.parse(source);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) && existsSync(acceptedSizePath)) {
      try {
        const basis: unknown = JSON.parse(readFileSync(acceptedSizePath, 'utf8'));
        const sourceVersion = Number((parsed as Record<string, unknown>).version);
        if (basis === null || typeof basis !== 'object' || Array.isArray(basis)
          || Object.keys(basis).sort().join(',') !== 'maxBytes,schema,schemaVersion'
          || (basis as Record<string, unknown>).schema !== 'kb.control-plane-accepted-size/v1'
          || !Number.isSafeInteger((basis as Record<string, unknown>).schemaVersion)
          || Number((basis as Record<string, unknown>).schemaVersion) < 1
          || Number((basis as Record<string, unknown>).schemaVersion) > sourceVersion
          || !Number.isSafeInteger((basis as Record<string, unknown>).maxBytes)
          || Number((basis as Record<string, unknown>).maxBytes) < 1) {
          throw new Error('invalid accepted-size sidecar shape');
        }
        acceptedMaxBytes = Math.max(maxBytes, Number((basis as Record<string, unknown>).maxBytes));
      } catch {
        // Advisory recovery metadata: the configured base limit remains authoritative when unreadable.
        console.warn('[control-store] ignoring invalid control-plane accepted-size sidecar');
      }
    }
    if (sourceBytes > acceptedMaxBytes) {
      throw new ControlStoreLimitError(`control-plane store exceeds ${acceptedMaxBytes} bytes`);
    }
    legacyRewrite = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      && (parsed as Record<string, unknown>).version === 1
      && requiresGenericRewrite(parsed as Record<string, unknown>);
    const initial = migrateDocument(source, CONTROL_PLANE_SCHEMA_VERSION, migrationContext(source));
    recovered = initial.document;
    assertHydrated(recovered);
    migrated = initial.applied.length > 0;
    // P6 [P6-C32]: capture the exact preimage for ANY applied edge, not only v2 -> v3. `from` is the
    // on-disk source version; `to` is the schema version we migrated up to.
    if (initial.applied.length > 0) {
      migrationBackupSource = Buffer.from(source, 'utf8');
      migrationBackupFrom = Number((parsed as Record<string, unknown>).version);
    }
  }
  const normalized = normalizeCrash(recovered, { stamp: startupStamp, bootId });
  if (normalized || migrated) {
    recovered.documentRevision += 1;
    const migratedBytes = Buffer.byteLength(`${JSON.stringify(genericPersistenceDocument(recovered))}\n`, 'utf8');
    if (legacyRewrite && migratedBytes > maxBytes) {
      throw new ControlStoreMigrationLimitError(
        `control-plane legacy migration would exceed the ${maxBytes} byte limit (source ${sourceBytes} bytes; migrated ${migratedBytes} bytes)`,
      );
    }
    const migrationGrowth = migratedBytes - sourceBytes;
    const pureSchemaMigrationOverage = migrated && !legacyRewrite && migratedBytes > maxBytes && migrationGrowth > 0;
    const nextAcceptedMaxBytes = pureSchemaMigrationOverage
      ? acceptedMaxBytes + migrationGrowth
      : acceptedMaxBytes;
    acceptedMaxBytes = nextAcceptedMaxBytes;
    if (migrationBackupSource) {
      // P6 [P6-C32]: the BACKUP is captured for any applied edge (above), but the cross-language Python
      // round-trip guard stays scoped to a v2-origin document — the P2 identity/schedule carrier it was
      // written to validate. A v1 legacy rewrite migrates through its own TS-validated path and never had
      // this guard; a purely additive v3->v4 has no carrier to cross-check.
      if (migrationBackupFrom === 2) {
        (options.generatedPythonRoundTripForTest ?? validateGeneratedPythonControlPlaneRoundTrip)(recovered);
      }
      writeControlPlaneMigrationBackupSync(
        stateRoot, migrationBackupSource, migrationBackupFrom, recovered.version, options.persistenceDepsForTest,
      );
    }
    save(recovered, 'deploy-critical');
    if (pureSchemaMigrationOverage) {
      assertWriterLeaseForRoot(lease, stateRoot);
      persistControlDocumentSync(
        acceptedSizePath,
        `${JSON.stringify({
          schema: 'kb.control-plane-accepted-size/v1',
          schemaVersion: recovered.version,
          maxBytes: acceptedMaxBytes,
        })}\n`,
        'deploy-critical',
        options.persistenceDepsForTest,
      );
    }
  }
  return makeStore(load, save, options);
}
