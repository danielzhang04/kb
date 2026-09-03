/**
 * Control-plane stored DTO / interface / type declarations, extracted verbatim from control/store.ts
 * (Slice B, behavior-identical move). Types have no runtime; store.ts re-exports the previously-exported
 * ones so every consumer importing them from control/store.ts is byte-unaffected. Declarations local to
 * makeStore stay in store.ts.
 */
import type { ReadScope } from './store.ts';
import type { PersistenceDeps } from './persistence.ts';
import { loadAndMigrate, type MigrationContext } from './migrations.ts';
import type { ControlPlaneCollection } from './generated/controlPlaneSchema.ts';
import type { HostKind, RunnableRef, Schedule } from './p2Contracts.ts';
import type { HostAdvertisement, PlacementLease, StoredHostAdvertisement } from '../placement/contracts.ts';
import type { V1IdempotencyRecord } from '../api/v1/idempotency.ts';
import type {
  ScheduleOccurrenceClaim,
  ScheduleMirrorStorePort,
} from '../schedules/contracts.ts';
import type {
  ReconciliationReceiptPort,
} from '../reconciliation/contracts.ts';
import type {
  AtomicScheduleStorePort,
} from '../schedules/service.ts';
import type {
  ScheduleSocketStorePort,
} from '../schedules/socketRoutes.ts';
import type {
  PauseMarkerMigrationReceipt,
  ScheduleSeedImportMarker,
  ScheduleSeedImportPlan,
} from '../schedules/seedImport.ts';
import type {
  ProposalCompletionGate,
  ProposalIterationGroup,
  ProposalReview,
  ResolvedAgentAssignment,
} from './proposal.ts';
import type {
  BrokerConsumption,
  BrokerMutation,
  ManagedStartSpec,
} from './attemptDurability.ts';
import type { PublicOperationalEvent } from './publicEvents.ts';
import type { RunLifecycleKind } from './runLifecycle.ts';
import type {
  Attempt,
  AttemptState,
  ActivateIterationLoopInput,
  AdvanceIterationTurnInput,
  AgentWorkspaceLaunchProvenance,
  AssetPullIntent,
  ControlResult,
  CreateAssetPullIntentInput,
  CreateDeploymentInput,
  Deployment,
  GenerationSupersession,
  HumanRequest,
  HumanRequestDecision,
  HumanRequestKind,
  IterationLoop,
  IterationGateResult,
  IterationParkResult,
  IterationReceipt,
  IterationRequest,
  JsonObject,
  ManagedSession,
  ManagedSessionState,
  OperationalEvent,
  OperationalEventInput,
  ProposalDecision,
  ProposalRevision,
  ProposalRevisionMetadata,
  QuarantinePlan,
  ParkIterationLoopInput,
  RecordIterationReceiptInput,
  RecordIterationRequestInput,
  ResolveIterationGateInput,
  Run,
  RunDetail,
  RunMetadata,
  Stage,
  StageGeneration,
  StageState,
  StorageInventory,
  StorageInventoryItem,
  TransitionDeploymentInput,
  UpdateAssetPullIntentInput,
} from './types.ts';

/**
 * `ownerSubject` is omitted deliberately: on a STORED row the owner is `subject`, and carrying both
 * would be two mutable copies of one fact. {@link publicProposal} projects `subject` onto `ownerSubject`
 * on the way out, exactly as `detail`/`metadata` do for a run.
 */
export interface StoredProposal extends Omit<ProposalRevision, 'ownerSubject'> {
  subject: string;
}

export interface StoredRun extends Run {
  subject: string;
  launchOperationKey?: string | null;
  launchOperationFingerprint?: string | null;
  archiveOperationKey?: string | null;
  archiveOperationFingerprint?: string | null;
  activationReceipts?: StoredRunActivationReceipt[];
  authorizedFailedRunReconciliation?: StoredAuthorizedFailedRunReconciliation | null;
}

export interface StoredDeployment extends Deployment {
  operationReceipts: Array<{
    key: string;
    fingerprint: string;
    operation: 'create' | 'transition';
    deploymentRevision: number;
    result: Deployment;
    recordedAt: string;
  }>;
}

/**
 * The stored AssetPullIntent shape (§3.2). The intent's own `state` + `attempts` ARE its idempotency
 * ledger — a dispatch is refused unless the caller pinned the exact `(state, attempts)` it read — so no
 * operationReceipts sidecar is needed, and the stored shape is the public record verbatim [P5-C34].
 */
export type StoredAssetPullIntent = AssetPullIntent;

export type RunActivationPhase = 'claimed' | 'roots-activated' | 'dispatched' | 'failed';

export interface StoredRunActivationReceipt {
  idempotencyKey: string;
  fingerprint: string;
  phase: RunActivationPhase;
  claimedAt: string;
  updatedAt: string;
}

export interface StoredStage extends Stage {
  subject: string;
}

export interface StoredStageGeneration extends StageGeneration {
  subject: string;
  operationFingerprint: string;
}

export interface StoredGenerationSupersession extends GenerationSupersession {
  subject: string;
  operationFingerprint: string;
}

export interface StoredIterationLoop extends IterationLoop {
  subject: string;
  advanceOperationKey?: string;
  advanceOperationFingerprint?: string;
}

export interface StoredIterationRequest extends IterationRequest {
  subject: string;
  runRef: string;
  stepId: string;
  operationKey: string;
  operationFingerprint: string;
}

export interface StoredIterationReceipt extends IterationReceipt {
  subject: string;
  runRef: string;
  routeId: string;
  operationKey: string;
  operationFingerprint: string;
}

export interface StoredAttempt extends Attempt {
  subject: string;
  rerouteOperationKey?: string | null;
  rerouteOperationFingerprint?: string | null;
  iterationAdvanceOperationKey?: string | null;
  iterationAdvanceOperationFingerprint?: string | null;
  iterationAdvanceReceiptRef?: string | null;
}

export interface StoredSession extends ManagedSession {
  subject: string;
  operationKey: string | null;
  operationFingerprint: string | null;
  brokerProfileId?: string | null;
  brokerApprovedPromptHash?: string | null;
  brokerStopRequested?: boolean;
  brokerSteering?: StoredSteeringInstruction[];
  brokerReceipts?: StoredBrokerReceipt[];
}

export interface StoredSteeringInstruction {
  instructionRef: string;
  instruction: string;
  checkpoint: string | null;
  enqueuedAt: string;
}

export type StoredBrokerReceiptKind = 'start' | 'event' | 'complete' | 'stop' | 'enqueue' | 'consume' | 'interrupt';

export interface StoredBrokerReceipt {
  kind: StoredBrokerReceiptKind;
  idempotencyKey: string;
  fingerprint: string;
  revision: number;
  status: 'reserved' | 'already-active' | 'applied' | 'inactive' | 'conflict';
  instructions: string[];
  createdAt: string;
}

export interface StoredHumanRequest extends HumanRequest {
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

export interface StoredAuthorizedFailedRunReconciliation extends AuthorizedFailedRunReconciliationReceipt {}

export interface StoredEvent extends OperationalEvent {
  subject: string;
  operationKey?: string | null;
  operationFingerprint?: string | null;
}

export interface QuarantinedRunBundle {
  subject: string;
  quarantinedAt: string;
  run: StoredRun;
  stages: StoredStage[];
  attempts: StoredAttempt[];
  sessions: StoredSession[];
  humanRequests: StoredHumanRequest[];
  events: StoredEvent[];
  stageGenerations: StoredStageGeneration[];
  iterationLoops: StoredIterationLoop[];
  iterationRequests: StoredIterationRequest[];
  iterationReceipts: StoredIterationReceipt[];
  generationSupersessions: StoredGenerationSupersession[];
}

/** W6.4 consumes these private v3 rows through the store; public Schedule never exposes them. */
export interface StoredSchedule extends Schedule {
  cadenceCanonical: string;
  seedBytes: string | null;
  seedDigest: string | null;
  seedAuthorized: boolean;
  launchPayload: JsonObject | null;
  operationReceipts: JsonObject[];
  emissionReceipts: JsonObject[];
  mirrorMetadataRevision: number;
  tombstone: JsonObject | null;
  /**
   * P4 section 3.5: the store mirror revision this row was last touched at. Additive and optional —
   * a pre-P4 document lacking it reads as 0 and gains it on the first mirror batch, with no document
   * version bump and no migration [P4-C37].
   */
  lastMirrorRevision?: number;
}

export interface StoredScheduleTombstone extends JsonObject {
  id: string;
  deletedAt: string;
  version: number;
  operationReceipts: JsonObject[];
  /**
   * A tombstone also carries the additive `lastMirrorRevision` and `mirroredAt` [P4-C37], but it is
   * a `JsonObject` whose index signature admits no `undefined`, so those two live behind index
   * access (`scheduleMirrorFields`) rather than as declared optional properties.
   */
}

export interface StoredScheduleOccurrenceClaim extends JsonObject {
  scheduleId: string;
  scheduledFor: string;
  nextAt: string;
  owner: JsonObject;
  phase: ScheduleOccurrenceClaim['phase'];
  idempotencyKey: string;
  fingerprint: string;
  card: JsonObject;
  cardBytesSha256: string;
  runRef: string | null;
  phaseReceipts: JsonObject[];
  completionReceipt: JsonObject | null;
}

export interface StoredScheduleSeedImport extends JsonObject {
  version: number;
  releaseSha: string;
  seedDigest: string;
  importedAt: string;
}

export interface StoreDocumentCollections {
  proposals: StoredProposal[];
  runs: StoredRun[];
  stages: StoredStage[];
  attempts: StoredAttempt[];
  sessions: StoredSession[];
  humanRequests: StoredHumanRequest[];
  events: StoredEvent[];
  stageGenerations: StoredStageGeneration[];
  iterationLoops: StoredIterationLoop[];
  iterationRequests: StoredIterationRequest[];
  iterationReceipts: StoredIterationReceipt[];
  generationSupersessions: StoredGenerationSupersession[];
  quarantine: QuarantinedRunBundle[];
  deployments: StoredDeployment[];
  schedules: StoredSchedule[];
  scheduleTombstones: StoredScheduleTombstone[];
  scheduleOccurrenceClaims: StoredScheduleOccurrenceClaim[];
  scheduleSeedImports: StoredScheduleSeedImport[];
  // P6 W1: the three placement collections join the versioned document at schema v4 [P6-C23, P6-C48].
  hostAdvertisements: StoredHostAdvertisement[];
  placementLeases: PlacementLease[];
  v1Idempotency: V1IdempotencyRecord[];
}

export interface StoreDocument extends StoreDocumentCollections {
  version: 4;
  documentRevision: number;
  nextEventCursor: number;
  scheduleCollectionRevision: number;
  /**
   * P4 section 3.5: incremented only by mirror-relevant create, arm/disarm, delete, and seed
   * reconciliation — never by occurrence completion. Additive and optional on the SAME versioned
   * document: absent reads as 0, first written when the first mirror batch is prepared [P4-C37].
   */
  scheduleMirrorRevision?: number;
  /**
   * The durable §3.5 batch record: `{ record: <ScheduleMirrorBatch>, superseded?: {...} }`. One
   * field holds the whole batch (state/operationKey/pr/mergedAt/targetWatermark/paths) so the
   * preparation CAS has something to read and write inside a single writer transaction. When a
   * `failed` batch is closed by the next preparation, that close is recorded on the replacing
   * wrapper — the batch-state union itself is W0's closed contract and is not extended here.
   */
  scheduleMirrorBatch?: JsonObject;
  /** The watermark of the last mirror actually landed (a merge, or a byte-identical no-op). */
  scheduleMirrorMergedWatermark?: JsonObject;
  /**
   * P4 section 3.4: the two-phase reconciliation receipts persisted behind the injected
   * `ReconciliationReceiptPort` [P4-C33]. Additive and optional on the SAME versioned document —
   * absent reads as an empty ledger, first written when the first intent prepares; no version bump
   * and no migration, exactly like the mirror fields above. Rows are keyed by `idempotencyKey`; each
   * is either a `prepared` or a `published` receipt (see `decodeStoredReconciliationReceipt`).
   */
  reconciliationReceipts?: JsonObject[];
  /**
   * Dashboard v3 P5 §3.2: the movement:256 asset-pull intents. Additive and optional on the SAME
   * versioned document — absent reads as an empty collection, first written when the first intent is
   * created; no version bump and no migration, exactly like the mirror and reconciliation fields
   * above [P5-C34]. Rows are keyed by `intentRef`.
   */
  assetPullIntents?: StoredAssetPullIntent[];
  /**
   * P6 W1 [P6-C41]: the per-store HMAC key for opaque v1 cursors. Additive and optional on the SAME
   * versioned document — absent until first minted, then durable across every reopen and identical on
   * both daemons so a VM-minted cursor verifies at the Desktop daemon. Never an authorization input.
   */
  cursorSecret?: string;
}

export type StoreDocumentCollectionEquality =
  keyof StoreDocumentCollections extends ControlPlaneCollection
    ? ControlPlaneCollection extends keyof StoreDocumentCollections ? true : false
    : false;
const STORE_DOCUMENT_COLLECTIONS_MATCH_GENERATED: StoreDocumentCollectionEquality = true;
void STORE_DOCUMENT_COLLECTIONS_MATCH_GENERATED;

export interface ControlStoreOptions {
  now?: () => Date;
  newId?: () => string;
  bootId?: string;
  maxDocumentBytes?: number;
  maxEventsPerRun?: number;
  /** @internal */
  persistenceDepsForTest?: PersistenceDeps;
  /** @internal Exact persisted byte size for durability tests and the explicitly enabled VM benchmark. */
  persistenceTargetBytesForTest?: number;
  /** @internal Future migration-edge regression seam. */
  loadAndMigrateForTest?: typeof loadAndMigrate;
  /** Server-owned catalogs and optional checksum-bound operator mapping for v2 -> v3. */
  p2MigrationContext?: Omit<MigrationContext, 'stamp'>;
  /** @internal Integration seam; production always executes the generated Python validator. */
  generatedPythonRoundTripForTest?: (document: StoreDocument) => void;
  /** Server-owned card renderer. The persisted result is returned verbatim on occurrence replay. */
  renderScheduleClaim?: (input: {
    scheduleId: string;
    scheduledFor: string;
    nextAt: string;
    owner: RunnableRef;
    mirrorPath: Schedule['mirrorPath'];
  }) => Promise<{ card: Record<string, unknown>; cardBytesSha256: string }>;
  /** @internal Vitest-only seam proving retention-boundary validation independently of load(). */
  beforeIterationBoundaryValidationForTest?: (
    boundary: 'quarantine' | 'restore',
    target: StoreDocument | QuarantinedRunBundle,
  ) => void;
  /**
   * P6 W6.2 [P6-C55]: seed the `hostAdvertisements` collection at construction. Production advertises
   * through `PUT /api/v1/hosts/:hostId` (W6.3's self-advertisement timer); this is the test-only seam a
   * fixture uses to give the launch-time placement decision a fresh candidate without a real HTTP round
   * trip. Never read outside `createInMemoryControlPlaneStore`.
   */
  initialHostAdvertisements?: StoredHostAdvertisement[];
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
  /** Trusted full owner resolved by the server before this transaction. */
  owner: RunnableRef;
  /** Boot-verified daemon host, never a client field. */
  executionHost: HostKind;
  /** Must exactly match the approved compiler snapshot for the Manager. */
  managerAssignment?: ResolvedAgentAssignment | null;
  idempotencyKey: string;
  predecessorRunRef?: string | null;
  expectedPredecessorVersion?: number;
  /** Internal, server-derived Composer origin; HTTP clients never choose declaration identity. */
  agentWorkspaceLaunch?: AgentWorkspaceLaunchProvenance | null;
  /** Exact compiler-owned snapshot. */
  iterationGroups?: ProposalIterationGroup[];
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

export interface CreateWorkerSessionInput {
  expectedAttemptVersion: number;
  attemptOperationKey?: string;
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

/**
 * P6 W6.3: the result of the advertisement CAS. Shaped to match the node route's `AdvertiseStorePort`
 * exactly (`{ok:true,version}` / `{ok:false,current}`), so that route can bind straight to the store
 * method without a second result vocabulary. `current` is `0` when no row exists for the host yet.
 */
export type HostAdvertisementUpsertResult =
  | { readonly ok: true; readonly version: number }
  | { readonly ok: false; readonly current: number };

export interface ControlPlaneStore
  extends BrokerStoreBackend, AtomicScheduleStorePort, ScheduleSocketStorePort, ScheduleMirrorStorePort {
  getControlDocumentMetadata(): Pick<StoreDocument, 'version' | 'documentRevision' | 'scheduleCollectionRevision'>;
  /**
   * P4 section 3.4 [P4-C33]: the real two-phase reconciliation receipt store, shaped exactly as the
   * `ReconciliationReceiptPort` the publisher injects. W4 backs the port with an in-memory fake; the
   * composition passes this instead and re-runs W4's suites unchanged.
   */
  reconciliationReceiptPort(): ReconciliationReceiptPort;
  /** W6 schedule read side; private durability fields never cross this boundary. */
  getScheduleSnapshot(): { collectionRevision: number; schedules: Schedule[] };
  resolveScheduleReceiptOwner(cardId: string): RunnableRef | null;
  bindScheduleOccurrenceRun(cardId: string, runRef: string): Promise<void>;
  isScheduleSeedAuthorized(scheduleId: string): boolean;
  getScheduleSeedImportMarker(): ScheduleSeedImportMarker | null;
  commitScheduleSeedImport(plan: ScheduleSeedImportPlan): Promise<void>;
  readSchedulePauseMarkerReceipt(marker: string): Promise<PauseMarkerMigrationReceipt | null>;
  listIncompleteSchedulePauseMarkerReceipts?(): Promise<PauseMarkerMigrationReceipt[]>;
  writeSchedulePauseMarkerReceipt(receipt: PauseMarkerMigrationReceipt): Promise<void>;
  getDeployment(deploymentRef: string): ControlResult<Deployment>;
  listDeployments(): Deployment[];
  createDeployment(subject: string, input: CreateDeploymentInput): ControlResult<Deployment>;
  transitionDeployment(
    subject: string,
    deploymentRef: string,
    input: TransitionDeploymentInput,
  ): ControlResult<Deployment>;

  // Dashboard v3 P5 §3.2 — the asset-pull intent collection. Reads are allowlisted below; the two
  // mutators are reached only through the W1 `AssetPullService` under the writer lease.
  getAssetPullIntent(intentRef: string): ControlResult<AssetPullIntent>;
  listAssetPullIntents(): AssetPullIntent[];
  createAssetPullIntent(subject: string, input: CreateAssetPullIntentInput): ControlResult<AssetPullIntent>;
  updateAssetPullIntent(
    subject: string,
    intentRef: string,
    input: UpdateAssetPullIntentInput,
  ): ControlResult<AssetPullIntent>;

  listProposalRevisions(subject: string, proposalRef?: string): ProposalRevisionMetadata[];
  listProposalRevisionsForComposer(subject: string, sourceComposerRef: string, scope?: ReadScope): ProposalRevisionMetadata[];
  getProposalRevision(subject: string, proposalRef: string, revision: number, scope?: ReadScope): ControlResult<ProposalRevision>;
  createProposalRevision(subject: string, input: CreateProposalRevisionInput): ControlResult<ProposalRevision>;
  decideProposal(subject: string, proposalRef: string, revision: number, input: ApproveProposalInput): ControlResult<ProposalRevision>;

  /**
   * P6 W6.2 [P6-C55]: the raw stored `HostAdvertisement` rows (freshness is the CALLER's decision, via
   * `placement/select.ts`'s `isAdvertisementFresh`/`freshMatches`, never filtered here). This is the one
   * read seam the four launch-time placement sites use instead of `process.platform`.
   */
  listHostAdvertisements(): StoredHostAdvertisement[];
  /**
   * P6 W6.3: the ONE production writer of a `hostAdvertisements` row — the store method behind the node
   * route's `AdvertiseStorePort` (`api/v1/routes.ts`) and the method the daemon's own self-advertisement
   * timer (`placement/selfAdvertise.ts`) calls on its own store. The argument list is that port's
   * verbatim: `hostId` is the ADDRESSED host (the route derives it from the peer map, never from the
   * body) and a body naming a different host THROWS, so a future route binding cannot silently drop its
   * argument. Same CAS discipline: `expectedVersion` is the version the caller last read (`undefined` =
   * "no row for this host yet"), a mismatch is a REFUSAL carrying the current version rather than a
   * silent overwrite, and a success bumps the plan-owned `version` by exactly one. The body is decoded
   * through the W0 contract before it is persisted, so an invalid advertisement never enters the document.
   *
   * It deliberately does NOT bump `documentRevision` — advertisements are liveness telemetry on their own
   * per-row revision line, not coordinated state. See the implementation comment in `store.ts`.
   */
  upsertHostAdvertisement(
    hostId: HostKind,
    advertisement: HostAdvertisement,
    expectedVersion: number | undefined,
  ): HostAdvertisementUpsertResult;
  /**
   * @internal P6 W6.2 test-only seam: append/replace one advertisement by `hostId` so a fixture can give
   * the launch-time placement decision a fresh candidate without a real `PUT /api/v1/hosts/:hostId`
   * round trip or a CAS read. Production advertises only through `upsertHostAdvertisement` above. Never
   * called from a route handler.
   */
  seedHostAdvertisementForTest(advertisement: StoredHostAdvertisement): void;

  /** `scope` defaults to `'own-subject'` everywhere it appears; only a verified operator session widens
   *  it (see {@link ReadScope}). Reads first; the operator-driven mutations below take it too. */
  listRuns(subject: string, scope?: ReadScope): RunMetadata[];
  getRun(subject: string, runRef: string, scope?: ReadScope): ControlResult<RunDetail>;
  createRun(subject: string, input: CreateRunInput): ControlResult<RunDetail>;
  /**
   * The non-terminal run this SUBJECT already holds for `(proposalRef, revision)`, ignoring the one a
   * launch keyed `launchOperationKey` would replay.
   *
   * A cross-subject launch consults it before creating a run: the operator's launch key is namespaced
   * away from the owner's key space, so replay can never find the owner's in-flight run, and a second
   * launch of the same revision would strand it behind a duplicate.
   */
  findActiveRunForRevision(
    subject: string,
    proposalRef: string,
    revision: number,
    launchOperationKey: string,
  ): RunMetadata | null;
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
  transitionRun(
    subject: string,
    runRef: string,
    expectedVersion: number,
    state: Exclude<RunLifecycleKind, 'paused-for-deploy'>,
  ): ControlResult<Run>;
  /** Terminal operator dismissal: `archived` run + its answerable open requests resolved, one commit. */
  archiveRun(subject: string, runRef: string, input: ArchiveRunInput, scope?: ReadScope): ControlResult<ArchiveRunResult>;
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
  activateIterationLoop(subject: string, iterationLoopRef: string, input: ActivateIterationLoopInput): ControlResult<IterationLoop>;
  recordIterationRequest(subject: string, iterationLoopRef: string, input: RecordIterationRequestInput): ControlResult<IterationRequest>;
  recordIterationReceipt(subject: string, iterationLoopRef: string, input: RecordIterationReceiptInput): ControlResult<IterationReceipt>;
  advanceIterationTurn(subject: string, iterationLoopRef: string, input: AdvanceIterationTurnInput): ControlResult<IterationLoop>;
  parkIterationLoop(subject: string, iterationLoopRef: string, input: ParkIterationLoopInput): ControlResult<IterationParkResult>;
  resolveIterationGate(subject: string, requestRef: string, input: ResolveIterationGateInput, scope?: ReadScope): ControlResult<IterationGateResult>;
  linkStageCard(subject: string, stageRef: string, expectedVersion: number, canonicalCardRef: string): ControlResult<Stage>;
  createAttempt(subject: string, stageRef: string, input: CreateAttemptInput): ControlResult<Attempt>;
  /** Atomically supersedes one never-started queued attempt without rewriting its historical routing. */
  rerouteStage(subject: string, stageRef: string, input: RerouteStageInput): ControlResult<RerouteStageResult>;
  transitionAttempt(subject: string, attemptRef: string, expectedVersion: number, state: AttemptState): ControlResult<Attempt>;
  createWorkerSession(subject: string, attemptRef: string, input: CreateWorkerSessionInput): ControlResult<ManagedSession>;
  transitionSession(subject: string, sessionRef: string, expectedVersion: number, state: ManagedSessionState,
    attemptOperationKey?: string): ControlResult<ManagedSession>;
  createManagerSuccessor(subject: string, runRef: string, input: CreateManagerSuccessorInput): ControlResult<ManagedSession>;
  recordManagerCommand(subject: string, runRef: string, input: ManagerCommandInput, scope?: ReadScope): ControlResult<ManagerCommandResult>;
  /** Atomically persists run-wide cancellation intent before any adapter is signaled. */
  requestRunCancellation(subject: string, runRef: string, input: RequestRunCancellationInput): ControlResult<ManagerCommandResult>;

  getHumanRequest(subject: string, requestRef: string, scope?: ReadScope): ControlResult<HumanRequest>;
  createHumanRequest(subject: string, runRef: string, input: CreateHumanRequestInput, scope?: ReadScope): ControlResult<HumanRequest>;
  createHumanRequests(
    subject: string,
    runRef: string,
    input: CreateHumanRequestBatchInput,
  ): ControlResult<HumanRequest[]>;
  reviseHumanRequest(subject: string, requestRef: string, expectedRevision: number, title: string, prompt: string): ControlResult<HumanRequest>;
  respondHumanRequest(subject: string, requestRef: string, input: RespondHumanRequestInput, scope?: ReadScope): ControlResult<HumanRequest>;
  /**
   * Housekeeping sweep, not a governed HTTP write — no subject, no session, no idempotency key from a
   * caller. Auto-closes every OPEN, non-review-linked Human Request whose parent run has reached a
   * terminal state (mirrors `isTerminalRun`), with an honest `'auto-closed'` response — it never claims
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

  appendEvent(subject: string, runRef: string, input: OperationalEventInput, scope?: ReadScope): ControlResult<OperationalEvent>;
  listEvents(subject: string, runRef: string, afterCursor?: number, limit?: number, scope?: ReadScope): ControlResult<OperationalEvent[]>;

  /**
   * Retention. `scope` defaults to `'own-subject'` here exactly as everywhere else; a widened call
   * resolves the bundle across subjects and then partitions every record it moves by the RUN's OWN
   * subject, so quarantine and restore never relabel a bundle as the caller's.
   */
  inventory(subject: string, scope?: ReadScope): StorageInventory;
  dryRunQuarantine(subject: string, runRefs: string[], scope?: ReadScope): ControlResult<QuarantinePlan>;
  quarantineRuns(subject: string, runRefs: string[], expectedPlanHash: string, scope?: ReadScope): ControlResult<StorageInventoryItem[]>;
  restoreRun(subject: string, runRef: string, scope?: ReadScope): ControlResult<RunMetadata>;
}
