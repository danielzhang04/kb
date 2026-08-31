import { parseIterationOutcome } from './iterationOutcome.ts';
import { CONTROL_PLANE_COLLECTIONS, CONTROL_PLANE_MIGRATIONS, CONTROL_PLANE_SCHEMA_VERSION } from './generated/controlPlaneSchema.ts';
import { assertDeploymentCollection } from './deploymentState.ts';
import { assertAssetPullCollection } from './assetPullState.ts';
// P6 W1b [P6-C48]: the store-open invariant must decode every placement collection row through its W0
// exact-key decoder, not just check bounded-array shape (assertMigrationEnvelope's `boundedArray` check
// below) — otherwise a corrupt hostAdvertisements/placementLeases/v1Idempotency row loads silently.
import { assertPlacementCollections } from './placementState.ts';
import {
  crashNormalizedLifecycle,
  lifecycleForKind,
  RUN_LIFECYCLE_KINDS,
  runLifecycleKind,
} from './runLifecycle.ts';
import { TERMINAL_ATTEMPT } from './types.ts';
import { decodeHostKind, decodeRunIdentityFields, decodeRunnableRef, identityFieldsFromRun } from './p2Decoders.ts';
import {
  migrateRunIdentities,
  type LegacyAgentDeclaration,
  type LegacyWorkflowDefinition,
  type LegacyWorkflowLaunchAudit,
  type RunIdentityMigrationReport,
} from './runIdentity.ts';
import {
  migrateRunOutcomes,
  type LegacyArchiveAudit,
  type RunOutcomeMigrationReport,
} from './runOutcomeMigration.ts';
import type { HostKind, RunIdentityFields } from './p2Contracts.ts';
import { openAttestedScheduleSource } from '../schedules/attestedSource.ts';
import {
  importHeartbeatScheduleSeedsV1,
  type DevelopmentScheduleSeedSource,
  type ScheduleSeedImportMarker,
  type ScheduleSeedImportPlan,
} from '../schedules/seedImport.ts';
import type {
  IterationLoop,
  JsonObject,
  JsonValue,
  RunLifecycle,
} from './types.ts';
import type { ProposalIterationGroup, ProposalReview } from './proposal.ts';
import {
  canonicalJson, clone, isPlainRecord, iterationDefinitionHash, iterationRequestFingerprint, sha256,
} from './controlHashing.ts';
import type {
  QuarantinedRunBundle,
  StoreDocument,
  StoredAttempt,
  StoredGenerationSupersession,
  StoredIterationLoop,
  StoredIterationReceipt,
  StoredIterationRequest,
  StoredStage,
  StoredStageGeneration,
} from './store.ts';

const MAX_ENVELOPE_COLLECTION_ROWS = 1_000_000;
const MAX_ACTIVATION_RECEIPTS_PER_RUN = 64;
const MAX_SHORT_TEXT = 512;
const HASH_RE = /^[a-f0-9]{64}$/;
const CANONICAL_COMMIT_RE = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const SAFE_REF_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ACTIVATION_PHASES = new Set(['claimed', 'roots-activated', 'dispatched', 'failed']);
const ORDINARY_RUN_KINDS = new Set(RUN_LIFECYCLE_KINDS.filter((kind) => kind !== 'paused-for-deploy'));
const V2_COLLECTIONS = [
  'proposals', 'runs', 'stages', 'attempts', 'sessions', 'humanRequests', 'events',
  'stageGenerations', 'iterationLoops', 'iterationRequests', 'iterationReceipts',
  'generationSupersessions', 'quarantine', 'deployments',
] as const;
// P6 [P6-C23, P6-C48]: the three additive placement collections the v3 -> v4 edge introduces. They are
// present only from schema v4, so a pre-P6 v3 document must NOT be required to carry them.
const V4_NEW_COLLECTIONS = ['hostAdvertisements', 'placementLeases', 'v1Idempotency'] as const;
const V3_COLLECTIONS = CONTROL_PLANE_COLLECTIONS.filter(
  (collection) => !(V4_NEW_COLLECTIONS as readonly string[]).includes(collection),
);

type RawDocument = Record<string, any>;

export interface MigrationContext {
  stamp: string;
  executionHost?: HostKind;
  agentDeclarations?: readonly LegacyAgentDeclaration[];
  workflowDefinitions?: readonly LegacyWorkflowDefinition[];
  workflowLaunchAudits?: readonly LegacyWorkflowLaunchAudit[];
  auditRows?: readonly LegacyArchiveAudit[];
  sourceSha256?: string;
  explicitMapping?: {
    storeSha256: string;
    runs: Readonly<Record<string, RunIdentityFields>>;
  };
}

export interface AppliedMigration {
  from: number;
  to: number;
  breaking: boolean;
  down: 'present';
}

/**
 * The up-edge `breaking` flag, sourced from the generated migration registry so the applied-migration
 * record can never drift from the registry's own declaration (as the hardcoded v3->v4 `true` once did,
 * against the registry's `breaking:false` for that edge) [P6 W1b].
 */
function breakingFlagForUpEdge(from: number, to: number): boolean {
  const entry = CONTROL_PLANE_MIGRATIONS.find((edge) => edge.from === from && edge.to === to);
  if (!entry) throw new Error(`no control-plane migration registry entry for edge ${from}->${to}`);
  return entry.breaking;
}

export interface MigrationResult {
  document: StoreDocument;
  applied: AppliedMigration[];
}

export interface P2RunMigrationReports {
  runIdentity: RunIdentityMigrationReport;
  runOutcome: RunOutcomeMigrationReport;
}

export class P2RunMigrationError extends Error {
  readonly code: 'run-owner-migration-required' | 'run-outcome-migration-required';
  readonly reports: P2RunMigrationReports;

  constructor(reports: P2RunMigrationReports) {
    const code = reports.runIdentity.errors.length > 0
      ? 'run-owner-migration-required' as const
      : 'run-outcome-migration-required' as const;
    super(`${code}: ${JSON.stringify(reports)}`);
    this.code = code;
    this.reports = reports;
    this.name = 'P2RunMigrationError';
  }
}

interface LegacyStoreReviewLoopMigrationRow {
  subject: string;
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

interface LegacyStoreReviewReceiptMigrationRow {
  subject: string;
  operationFingerprint: string;
  reviewReceiptRef: string;
  runRef: string;
  reviewStageRef: string;
  subjectStageRef: string;
  subjectGenerationRef: string;
  subjectResultHash: string;
  checkerAttemptRef: string;
  outcome: {
    schema: 'kb.review-outcome/v1';
    decision: 'pass' | 'fail' | 'parked';
    summary: string;
    criteria: Array<{ criterionId: string; verdict: 'pass' | 'fail' | 'unverified'; findingIds: string[] }>;
    findings: Array<{ id: string; criterionId: string; severity: 'blocking' | 'advisory'; summary: string; evidencePaths: string[] }>;
  };
  outcomeHash: string;
  operationKey: string;
  state: 'passed' | 'awaiting-completion-gate' | 'failed' | 'parked';
  completionRequestRef: string | null;
  interventionRequestRef: string | null;
  version: number;
  createdAt: string;
  finalizedAt: string | null;
}

type LegacyStoreMigrationBundle = Pick<StoreDocument,
  'stages' | 'attempts' | 'stageGenerations' | 'generationSupersessions'
  | 'iterationLoops' | 'iterationRequests' | 'iterationReceipts'> & {
    reviewLoops?: LegacyStoreReviewLoopMigrationRow[];
    reviewReceipts?: LegacyStoreReviewReceiptMigrationRow[];
  };

function validNonEmpty(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max && !value.includes('\0');
}

function boundedArray(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length <= MAX_ENVELOPE_COLLECTION_ROWS;
}

export function assertMigrationEnvelope(value: unknown): asserts value is RawDocument {
  if (!isPlainRecord(value) || typeof value.version !== 'number' || !Number.isSafeInteger(value.version)) {
    throw new Error('invalid control-plane store');
  }
  const version = value.version;
  if (version < 1 || version > CONTROL_PLANE_SCHEMA_VERSION) {
    throw new Error(`unsupported control-plane version ${String(version)}`);
  }
  if (typeof value.nextEventCursor !== 'number' || !Number.isSafeInteger(value.nextEventCursor)
    || value.nextEventCursor < 1) {
    throw new Error('invalid control-plane store');
  }
  const required = version === 1
    ? ['proposals', 'runs', 'stages', 'attempts', 'sessions', 'humanRequests', 'events', 'quarantine']
    : version === 2 ? [...V2_COLLECTIONS]
      : version === 3 ? [...V3_COLLECTIONS] : [...CONTROL_PLANE_COLLECTIONS];
  if (required.some((field) => !boundedArray(value[field]))) throw new Error('invalid control-plane store');
  if (version === 1) {
    for (const field of [
      'reviewLoops', 'reviewReceipts', 'stageGenerations', 'iterationLoops', 'iterationRequests',
      'iterationReceipts', 'generationSupersessions',
    ]) {
      if (value[field] !== undefined && !boundedArray(value[field])) throw new Error('invalid control-plane store');
    }
  } else if (typeof value.documentRevision !== 'number' || !Number.isSafeInteger(value.documentRevision)
    || value.documentRevision < 0) {
    throw new Error('invalid control-plane store');
  }
  if (version >= 3 && (typeof value.scheduleCollectionRevision !== 'number'
    || !Number.isSafeInteger(value.scheduleCollectionRevision) || value.scheduleCollectionRevision < 0)) {
    throw new Error('invalid control-plane schedule collection revision');
  }
}

function assertEventCursorSequence(document: RawDocument): void {
  let previous = 0;
  for (const event of document.events) {
    if (!isPlainRecord(event) || typeof event.cursor !== 'number' || !Number.isSafeInteger(event.cursor)
      || event.cursor <= previous || event.cursor >= document.nextEventCursor) {
      throw new Error('invalid control-plane event cursor sequence');
    }
    previous = event.cursor;
  }
}

function assertActivationReceipts(run: RawDocument): void {
  const receipts = run.activationReceipts;
  if (receipts === undefined) return;
  if (!boundedArray(receipts) || receipts.length > MAX_ACTIVATION_RECEIPTS_PER_RUN) {
    throw new Error('invalid control-plane run activation receipt');
  }
  const keys = new Set<string>();
  for (const receipt of receipts) {
    if (!isPlainRecord(receipt)
      || !validNonEmpty(receipt.idempotencyKey, MAX_SHORT_TEXT)
      || keys.has(receipt.idempotencyKey)
      || typeof receipt.fingerprint !== 'string' || !HASH_RE.test(receipt.fingerprint)
      || !ACTIVATION_PHASES.has(String(receipt.phase))
      || !validNonEmpty(receipt.claimedAt, MAX_SHORT_TEXT)
      || !validNonEmpty(receipt.updatedAt, MAX_SHORT_TEXT)) {
      throw new Error('invalid control-plane run activation receipt');
    }
    keys.add(receipt.idempotencyKey);
  }
  if (receipts.filter((receipt) => isPlainRecord(receipt)
    && (receipt.phase === 'claimed' || receipt.phase === 'roots-activated')).length > 1) {
    throw new Error('invalid control-plane pending run activation receipts');
  }
}

function assertDeployPause(value: unknown): void {
  if (!isPlainRecord(value)
    || !validNonEmpty(value.deploymentRef, MAX_SHORT_TEXT)
    || !validNonEmpty(value.pausedAt, MAX_SHORT_TEXT)
    || typeof value.priorKind !== 'string' || !ORDINARY_RUN_KINDS.has(value.priorKind as any)
    || typeof value.resumeStreak !== 'number' || !Number.isSafeInteger(value.resumeStreak) || value.resumeStreak < 0
    || value.lastResumeAttemptCursor !== null
      && (typeof value.lastResumeAttemptCursor !== 'number'
        || !Number.isSafeInteger(value.lastResumeAttemptCursor) || value.lastResumeAttemptCursor < 1)) {
    throw new Error('invalid control-plane run deploy pause');
  }
  if (value.resumeClaim !== null && (!isPlainRecord(value.resumeClaim)
    || !validNonEmpty(value.resumeClaim.deploymentRef, MAX_SHORT_TEXT)
    || value.resumeClaim.deploymentRef !== value.deploymentRef
    || !validNonEmpty(value.resumeClaim.bootId, MAX_SHORT_TEXT)
    || !validNonEmpty(value.resumeClaim.claimantRef, MAX_SHORT_TEXT))) {
    throw new Error('invalid control-plane run deploy pause');
  }
}

function assertRunLifecycle(run: unknown): void {
  if (!isPlainRecord(run) || Object.hasOwn(run, 'state') || !isPlainRecord(run.lifecycle)
    || typeof run.lifecycle.kind !== 'string'
    || !(RUN_LIFECYCLE_KINDS as readonly string[]).includes(run.lifecycle.kind)) {
    throw new Error('invalid control-plane run lifecycle');
  }
  if (run.lifecycle.kind === 'paused-for-deploy') assertDeployPause(run.lifecycle.deployPause);
  else if (run.lifecycle.deployPause !== null) throw new Error('invalid control-plane run lifecycle');
  assertActivationReceipts(run);
}

export function assertDocumentInvariant(value: unknown): asserts value is StoreDocument {
  assertMigrationEnvelope(value);
  if (value.version !== CONTROL_PLANE_SCHEMA_VERSION) throw new Error('invalid control-plane store target');
  assertDeploymentCollection(value.deployments);
  // Dashboard v3 P5 §3.2: the asset-pull intents are ADDITIVE and optional on the SAME versioned
  // document — a pre-P5 document lacks the field and reads as an empty collection, so no version bump
  // and no migration is introduced; a present collection is still validated [P5-C34].
  assertAssetPullCollection(value.assetPullIntents ?? []);
  // P6 W1b [P6-C48]: decode every placement-collection row (hostAdvertisements/placementLeases/
  // v1Idempotency) through its W0 exact-key decoder here, fail-closed — the `required.some(...)`
  // bounded-array check above only confirms shape, never per-row content.
  assertPlacementCollections({
    hostAdvertisements: value.hostAdvertisements,
    placementLeases: value.placementLeases,
    v1Idempotency: value.v1Idempotency,
    cursorSecret: value.cursorSecret,
  });
  assertEventCursorSequence(value);
  for (const run of value.runs) {
    assertRunLifecycle(run);
    if (!identityFieldsFromRun(run)) throw new Error('invalid control-plane run identity');
  }
  for (const stage of value.stages) assertStoredStageGenerationProjection(stage);
  for (const bundle of value.quarantine) {
    if (!isPlainRecord(bundle) || !isPlainRecord(bundle.run)) throw new Error('invalid control-plane quarantine');
    for (const field of [
      'stages', 'attempts', 'sessions', 'humanRequests', 'events', 'stageGenerations',
      'iterationLoops', 'iterationRequests', 'iterationReceipts', 'generationSupersessions',
    ]) if (!boundedArray(bundle[field])) throw new Error('invalid control-plane quarantine');
    assertRunLifecycle(bundle.run);
    if (!identityFieldsFromRun(bundle.run)) throw new Error('invalid control-plane run identity');
    for (const stage of bundle.stages as RawDocument[]) assertStoredStageGenerationProjection(stage);
  }
}

function migrateLegacyStoreAttemptProvenance(
  attempt: StoredAttempt,
  generationByRef: ReadonlyMap<string, StoredStageGeneration>,
): boolean {
  const raw = attempt as StoredAttempt & {
    reviewSubjectGenerationRef?: unknown;
    reviewSubjectResultHash?: unknown;
    reviewSubjectCanonicalCommit?: unknown;
  };
  let changed = false;
  const legacy = [raw.reviewSubjectGenerationRef, raw.reviewSubjectResultHash, raw.reviewSubjectCanonicalCommit];
  if (legacy.some((value) => value !== undefined && value !== null)
    && (typeof raw.reviewSubjectGenerationRef !== 'string' || !SAFE_REF_RE.test(raw.reviewSubjectGenerationRef)
      || typeof raw.reviewSubjectResultHash !== 'string' || !HASH_RE.test(raw.reviewSubjectResultHash)
      || typeof raw.reviewSubjectCanonicalCommit !== 'string' || !CANONICAL_COMMIT_RE.test(raw.reviewSubjectCanonicalCommit))) {
    throw new Error('invalid legacy store attempt provenance');
  }
  if (legacy.every((value) => value !== undefined && value !== null)) {
    const generation = generationByRef.get(raw.reviewSubjectGenerationRef as string);
    if (!generation || generation.subject !== attempt.subject || generation.runRef !== attempt.runRef
      || generation.resultHash !== raw.reviewSubjectResultHash
      || generation.canonicalCommit !== raw.reviewSubjectCanonicalCommit) {
      throw new Error('invalid control-plane checker attempt generation provenance');
    }
  }
  for (const field of ['reviewSubjectGenerationRef', 'reviewSubjectResultHash', 'reviewSubjectCanonicalCommit'] as const) {
    if (Object.prototype.hasOwnProperty.call(raw, field)) {
      delete raw[field];
      changed = true;
    }
  }
  for (const field of ['logicalGeneration', 'baseGenerationRef', 'baseCommit'] as const) {
    if (attempt[field] === undefined) {
      attempt[field] = null;
      changed = true;
    }
  }
  if (attempt.logicalGeneration !== null && (!Number.isSafeInteger(attempt.logicalGeneration) || attempt.logicalGeneration < 1)
    || (attempt.baseGenerationRef !== null && (typeof attempt.baseGenerationRef !== 'string' || !SAFE_REF_RE.test(attempt.baseGenerationRef)))
    || (attempt.baseCommit !== null && (typeof attempt.baseCommit !== 'string' || !CANONICAL_COMMIT_RE.test(attempt.baseCommit)))) {
    throw new Error('invalid control-plane iteration attempt provenance');
  }
  return changed;
}

function prepareLegacyStoreMigration(document: StoreDocument): boolean {
  let changed = false;
  const bundles = [document as StoreDocument & LegacyStoreMigrationBundle,
    ...document.quarantine.map((bundle) => bundle as QuarantinedRunBundle & LegacyStoreMigrationBundle)];
  for (const bundle of bundles) {
    const raw = bundle as unknown as LegacyStoreMigrationBundle & Record<string, unknown>;
    for (const field of ['stageGenerations', 'iterationLoops', 'iterationRequests', 'iterationReceipts', 'generationSupersessions'] as const) {
      if (raw[field] === undefined) {
        raw[field] = [];
        changed = true;
      } else if (!Array.isArray(raw[field])) {
        throw new Error('invalid control-plane iteration collections');
      }
    }
    if (raw.reviewLoops !== undefined && !Array.isArray(raw.reviewLoops)
      || raw.reviewReceipts !== undefined && !Array.isArray(raw.reviewReceipts)) {
      throw new Error('invalid legacy store collections');
    }
    for (const loop of raw.reviewLoops ?? []) {
      if (loop.interventionRequestRef === undefined) { loop.interventionRequestRef = null; changed = true; }
    }
    for (const receipt of raw.reviewReceipts ?? []) {
      if (receipt.interventionRequestRef === undefined) { receipt.interventionRequestRef = null; changed = true; }
      if (receipt.version === undefined) { receipt.version = 1; changed = true; }
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
  for (const request of [...document.humanRequests, ...document.quarantine.flatMap((bundle) => bundle.humanRequests)]) {
    if (request.resolutionOperationFingerprint === undefined) { request.resolutionOperationFingerprint = null; changed = true; }
    if (request.legacyRecoveryOperationKey === undefined) { request.legacyRecoveryOperationKey = null; changed = true; }
    if (request.legacyRecoveryOperationFingerprint === undefined) { request.legacyRecoveryOperationFingerprint = null; changed = true; }
    if (request.legacyRecoveryEventCursor === undefined) { request.legacyRecoveryEventCursor = null; changed = true; }
  }
  for (const bundle of [{ loops: document.iterationLoops, receipts: document.iterationReceipts },
    ...document.quarantine.map((item) => ({ loops: item.iterationLoops, receipts: item.iterationReceipts }))]) {
    const receiptByRef = new Map(bundle.receipts.map((receipt) => [receipt.receiptRef, receipt]));
    for (const loop of bundle.loops) {
      const rawLoop = loop as StoredIterationLoop & { gateRef?: unknown };
      if (rawLoop.gateRef === undefined) continue;
      if (typeof rawLoop.gateRef !== 'string') throw new Error('invalid control-plane iteration gate');
      const receipt = loop.lastReceiptRef === undefined ? undefined : receiptByRef.get(loop.lastReceiptRef);
      const rawReceipt = receipt as (StoredIterationReceipt & { completionRequestRef?: unknown }) | undefined;
      if (rawReceipt?.completionRequestRef === rawLoop.gateRef) loop.completionGateRef = rawLoop.gateRef;
      else loop.interventionRef = rawLoop.gateRef;
      delete rawLoop.gateRef;
      changed = true;
    }
  }
  return changed;
}

export function legacyGroupForStages(
  subjectStage: StoredStage,
  reviewStage: StoredStage,
  snapshot?: JsonObject,
): ProposalIterationGroup {
  const groups = snapshot && Array.isArray(snapshot.iterationGroups)
    ? snapshot.iterationGroups as unknown as ProposalIterationGroup[] : [];
  const approved = groups.find((group) => Array.isArray(group.participants)
    && group.participants.some((participant) => participant.stageRef === subjectStage.stageId)
    && group.participants.some((participant) => participant.stageRef === reviewStage.stageId));
  if (approved) return clone(approved);
  const review = reviewStage.review as ProposalReview;
  const snapshotStages = snapshot && Array.isArray(snapshot.stages) ? snapshot.stages as unknown as Array<Record<string, unknown>> : [];
  const source = snapshotStages.find((stage) => stage.id === subjectStage.stageId);
  const artifacts = Array.isArray(source?.artifacts)
    ? source.artifacts.map((artifact) => isPlainRecord(artifact) && typeof artifact.id === 'string' ? artifact.id : '').filter(Boolean)
    : [];
  const artifactIds = artifacts.length > 0 ? artifacts : [`${subjectStage.stageId}-artifact`];
  const producerId = `${subjectStage.stageId}-manager`;
  const judgeId = `${reviewStage.stageId}-judge`;
  const reviewStep = `${reviewStage.stageId}-review`;
  const reworkStep = `${reviewStage.stageId}-rework`;
  return {
    iterationGroupId: `${reviewStage.stageId}-iteration`,
    goal: `Accept '${subjectStage.title}' against the declared review criteria.`,
    participants: [
      { participantId: producerId, stageRef: subjectStage.stageId, role: 'manager', perspective: `Own stage '${subjectStage.stageId}'.`, mandate: subjectStage.title },
      { participantId: judgeId, stageRef: reviewStage.stageId, role: 'judge', perspective: `Review stage '${subjectStage.stageId}'.`, mandate: reviewStage.title },
    ],
    routes: [
      { routeId: `${reviewStage.stageId}-to-judge`, senderParticipantId: producerId, recipientParticipantId: judgeId, requestKinds: ['review'], baseResolutionStageIds: [subjectStage.stageId] },
      { routeId: `${reviewStage.stageId}-to-manager`, senderParticipantId: judgeId, recipientParticipantId: producerId, requestKinds: ['rework'], baseResolutionStageIds: [reviewStage.stageId] },
    ],
    activation: { seedParticipantId: producerId, seedArtifactIds: artifactIds },
    initialStepId: reviewStep,
    schedule: [
      { stepId: reviewStep, routeId: `${reviewStage.stageId}-to-judge`, after: { stepId: reworkStep, participantId: producerId, verdict: 'fulfilled' }, cycle: 'next' },
      { stepId: reworkStep, routeId: `${reviewStage.stageId}-to-manager`, after: { stepId: reviewStep, participantId: judgeId, verdict: 'fail' }, cycle: 'current' },
    ],
    artifacts: artifactIds,
    criteria: clone(review.criteria),
    maxCycles: review.maxCreatorReworks + 1,
    cycleUnit: `One '${subjectStage.stageId}' generation followed by one '${reviewStage.stageId}' verdict.`,
    terminalAuthorities: [{ participantId: judgeId, verdict: 'pass' }],
    ...(reviewStage.completionGate ? { completionGate: clone(reviewStage.completionGate) } : {}),
  };
}

function migrateLegacyStoreLoop(
  loop: LegacyStoreReviewLoopMigrationRow,
  stages: readonly StoredStage[],
  snapshot?: JsonObject,
): StoredIterationLoop {
  const subject = stages.find((stage) => stage.stageRef === loop.subjectStageRef);
  const review = stages.find((stage) => stage.stageRef === loop.reviewStageRef);
  if (!subject || !review) throw new Error('invalid control-plane review loop');
  const group = legacyGroupForStages(subject, review, snapshot);
  const producer = group.participants.find((participant) => participant.stageRef === subject.stageId)!;
  const judge = group.participants.find((participant) => participant.stageRef === review.stageId)!;
  const reviewStep = group.schedule.find((step) => group.routes.find((route) =>
    route.routeId === step.routeId)?.recipientParticipantId === judge.participantId);
  const reworkStep = group.schedule.find((step) => group.routes.find((route) =>
    route.routeId === step.routeId)?.recipientParticipantId === producer.participantId);
  const state: IterationLoop['state'] = ({
    'awaiting-subject': 'awaiting-seed', checking: 'awaiting-turn', 'rework-queued': 'rework-queued',
    failed: 'failed', parked: 'parked', 'awaiting-gate': 'awaiting-completion-gate', passed: 'passed',
  } as const)[loop.state];
  return {
    subject: loop.subject, ...group, iterationLoopRef: loop.reviewLoopRef, runRef: loop.runRef,
    definitionHash: iterationDefinitionHash(group), cyclesUsed: loop.activeGenerationRef === null ? 0 : loop.reworksUsed + 1,
    state,
    ...(state === 'awaiting-turn' ? { turnOwnerParticipantId: judge.participantId, currentStepId: reviewStep?.stepId } : {}),
    ...(state === 'rework-queued' ? { turnOwnerParticipantId: producer.participantId, currentStepId: reworkStep?.stepId } : {}),
    activeGenerationRefs: loop.activeGenerationRef === null ? [] : [loop.activeGenerationRef],
    ...(loop.acceptedGenerationRef === null ? {} : { acceptedGenerationRefs: [loop.acceptedGenerationRef] }),
    ...(loop.activeReceiptRef === null ? {} : { lastReceiptRef: loop.activeReceiptRef }),
    ...(loop.interventionRequestRef === null ? {} : { interventionRef: loop.interventionRequestRef }),
    version: Math.max(0, loop.version - 1), createdAt: loop.createdAt, updatedAt: loop.updatedAt,
  };
}

function decodeLegacyStoreReviewOutcome(
  value: unknown,
  loop: StoredIterationLoop,
  request: StoredIterationRequest,
): ReturnType<typeof parseIterationOutcome> {
  const invalid = () => ({ ok: false as const, detail: 'invalid legacy review outcome' });
  if (!isPlainRecord(value)) return invalid();
  const exactKeys = (record: Record<string, unknown>, expected: readonly string[]): boolean =>
    Object.keys(record).length === expected.length && expected.every((key) => Object.prototype.hasOwnProperty.call(record, key));
  if (!exactKeys(value, ['schema', 'decision', 'summary', 'criteria', 'findings'])
    || value.schema !== 'kb.review-outcome/v1'
    || !Array.isArray(value.findings)
    || value.findings.some((finding) => !isPlainRecord(finding)
      || !exactKeys(finding, ['id', 'criterionId', 'severity', 'summary', 'evidencePaths']))) {
    return invalid();
  }
  const findings = value.findings.map((finding) => {
    const { id, ...rest } = finding as Record<string, unknown>;
    return { ...rest, findingId: id };
  });
  return parseIterationOutcome(JSON.stringify({
    schema: 'kb.iteration-outcome/v1', requestRef: request.requestRef,
    iterationLoopRef: request.iterationLoopRef, participantId: request.recipientParticipantId,
    cycle: request.cycle, verdict: value.decision, inputGenerationRefs: request.inputGenerationRefs,
    criteria: value.criteria, findings, positions: [], recordedDissent: [], summary: value.summary,
  }), { iterationGroup: loop, request });
}

function migrateLegacyStoreReceipt(
  receipt: LegacyStoreReviewReceiptMigrationRow,
  loop: StoredIterationLoop,
  generationByRef: ReadonlyMap<string, StoredStageGeneration>,
): { request: StoredIterationRequest; receipt: StoredIterationReceipt } {
  const judge = loop.participants.find((participant) => participant.role === 'judge');
  const route = judge && loop.routes.find((candidate) => candidate.recipientParticipantId === judge.participantId);
  const sender = route && loop.participants.find((participant) => participant.participantId === route.senderParticipantId);
  const generation = generationByRef.get(receipt.subjectGenerationRef);
  if (!judge || !route || !sender || !generation?.canonicalCommit || !generation.baseCommit
    || generation.subject !== receipt.subject || generation.runRef !== receipt.runRef
    || generation.resultHash !== receipt.subjectResultHash
    || sha256(canonicalJson(receipt.outcome as unknown as JsonValue)) !== receipt.outcomeHash) {
    throw new Error('invalid control-plane review receipt');
  }
  const requestRef = `iteration-request-${sha256(receipt.reviewReceiptRef).slice(0, 48)}`;
  const request: StoredIterationRequest = {
    subject: receipt.subject, runRef: receipt.runRef, operationKey: `iteration-request:${receipt.operationKey}`,
    operationFingerprint: '', schema: 'kb.iteration-request/v1', requestRef,
    iterationLoopRef: loop.iterationLoopRef, stepId: loop.schedule.find((step) => step.routeId === route.routeId)?.stepId ?? loop.initialStepId,
    routeId: route.routeId,
    senderParticipantId: sender.participantId, recipientParticipantId: judge.participantId, kind: 'review',
    cycle: generation.generation, inputGenerationRefs: [generation.generationRef], baseCommit: generation.canonicalCommit,
    artifactHashes: Object.fromEntries(loop.artifacts.map((artifact) => [artifact, generation.resultHash as string])),
    criteria: clone(loop.criteria), unresolvedFindingRefs: [], preservedInvariants: [],
    nextAcceptanceCheck: 'Apply every declared criterion.', instructions: judge.mandate,
  };
  request.operationFingerprint = iterationRequestFingerprint(request);
  const parsed = decodeLegacyStoreReviewOutcome(receipt.outcome, loop, request);
  if (!parsed.ok) throw new Error('invalid control-plane review receipt');
  const { schema: _schema, ...outcome } = parsed.value;
  return { request, receipt: {
    subject: receipt.subject, runRef: receipt.runRef, routeId: route.routeId,
    operationKey: receipt.operationKey, operationFingerprint: receipt.operationFingerprint,
    version: receipt.version, participantAttemptRef: receipt.checkerAttemptRef,
    schema: 'kb.iteration-receipt/v1', receiptRef: receipt.reviewReceiptRef, ...outcome,
    outcomeHash: sha256(canonicalJson(outcome as unknown as JsonValue)), outputGenerationRefs: [],
    baseCommit: generation.baseCommit, canonicalCommit: generation.canonicalCommit, createdAt: receipt.createdAt,
  } };
}

function decodeLegacyStoreRows(document: StoreDocument): boolean {
  let changed = false;
  const proposalForRun = (runRef: string): JsonObject | undefined => {
    const run = document.runs.find((item) => item.runRef === runRef)
      ?? document.quarantine.find((bundle) => bundle.run.runRef === runRef)?.run;
    const proposals = run && document.proposals.find((item) => item.subject === run.subject
      && item.proposalRef === run.proposalRef && item.revision === run.proposalRevision);
    return proposals?.snapshot;
  };
  const migrate = (bundle: LegacyStoreMigrationBundle): void => {
    const legacyLoops = bundle.reviewLoops ?? [];
    const legacyReceipts = bundle.reviewReceipts ?? [];
    if (!Array.isArray(legacyLoops) || !Array.isArray(legacyReceipts)) {
      throw new Error('invalid legacy store collections');
    }
    const genericRuntimeExists = bundle.iterationLoops.length > 0 || bundle.iterationRequests.length > 0
      || bundle.iterationReceipts.length > 0;
    const loopByRef = new Map(bundle.iterationLoops.map((loop) => [loop.iterationLoopRef, loop]));
    for (const legacy of genericRuntimeExists ? [] : legacyLoops) {
      if (loopByRef.has(legacy.reviewLoopRef)) continue;
      const generic = migrateLegacyStoreLoop(legacy, bundle.stages, proposalForRun(legacy.runRef));
      bundle.iterationLoops.push(generic);
      loopByRef.set(generic.iterationLoopRef, generic);
      changed = true;
    }
    const legacyLoopByReviewStage = new Map(legacyLoops.map((loop) => [loop.reviewStageRef, loop]));
    const generationByRef = new Map(bundle.stageGenerations.map((generation) => [generation.generationRef, generation]));
    const requestRefs = new Set(bundle.iterationRequests.map((request) => request.requestRef));
    const receiptRefs = new Set(bundle.iterationReceipts.map((receipt) => receipt.receiptRef));
    for (const legacy of genericRuntimeExists ? [] : legacyReceipts) {
      const legacyLoop = legacyLoopByReviewStage.get(legacy.reviewStageRef);
      const loop = legacyLoop && loopByRef.get(legacyLoop.reviewLoopRef);
      if (!loop) throw new Error('invalid control-plane review receipt loop migration');
      const generic = migrateLegacyStoreReceipt(legacy, loop, generationByRef);
      if (!requestRefs.has(generic.request.requestRef)) {
        bundle.iterationRequests.push(generic.request);
        requestRefs.add(generic.request.requestRef);
        changed = true;
      }
      if (!receiptRefs.has(generic.receipt.receiptRef)) {
        bundle.iterationReceipts.push(generic.receipt);
        receiptRefs.add(generic.receipt.receiptRef);
        changed = true;
      }
      if (loop.lastReceiptRef === legacy.reviewReceiptRef) {
        if (legacy.completionRequestRef === null) delete loop.completionGateRef;
        else loop.completionGateRef = legacy.completionRequestRef;
        if (legacy.interventionRequestRef === null) delete loop.interventionRef;
        else loop.interventionRef = legacy.interventionRequestRef;
      }
    }
    for (const receipt of bundle.iterationReceipts) {
      const raw = receipt as StoredIterationReceipt & {
        state?: unknown; completionRequestRef?: unknown; interventionRequestRef?: unknown;
        finalizedAt?: unknown; checkerAttemptRef?: unknown; subjectResultHash?: unknown;
      };
      if (!SAFE_REF_RE.test(receipt.participantAttemptRef)) {
        throw new Error('invalid legacy store receipt attempt reference');
      }
      const loop = loopByRef.get(receipt.iterationLoopRef);
      if (loop?.lastReceiptRef === receipt.receiptRef) {
        if (typeof raw.completionRequestRef === 'string') loop.completionGateRef = raw.completionRequestRef;
        if (typeof raw.interventionRequestRef === 'string') loop.interventionRef = raw.interventionRequestRef;
      }
      for (const field of ['state', 'completionRequestRef', 'interventionRequestRef', 'finalizedAt', 'checkerAttemptRef', 'subjectResultHash'] as const) {
        if (Object.prototype.hasOwnProperty.call(raw, field)) {
          delete raw[field];
          changed = true;
        }
      }
    }
    for (const supersession of bundle.generationSupersessions) {
      const raw = supersession as StoredGenerationSupersession & { failedReviewReceiptRef?: unknown };
      if (!supersession.triggerReceiptRef && typeof raw.failedReviewReceiptRef === 'string') {
        supersession.triggerReceiptRef = raw.failedReviewReceiptRef;
      }
      if (Object.prototype.hasOwnProperty.call(raw, 'failedReviewReceiptRef')) {
        delete raw.failedReviewReceiptRef;
        changed = true;
      }
    }
    for (const attempt of bundle.attempts) {
      if (migrateLegacyStoreAttemptProvenance(attempt, generationByRef)) changed = true;
    }
    if (Object.prototype.hasOwnProperty.call(bundle, 'reviewLoops')) {
      delete bundle.reviewLoops;
      changed = true;
    }
    if (Object.prototype.hasOwnProperty.call(bundle, 'reviewReceipts')) {
      delete bundle.reviewReceipts;
      changed = true;
    }
  };
  migrate(document as StoreDocument & LegacyStoreMigrationBundle);
  for (const bundle of document.quarantine) migrate(bundle as QuarantinedRunBundle & LegacyStoreMigrationBundle);
  return changed;
}

function reviewLoopDefinitionHash(stage: Pick<StoredStage, 'workflowProfile' | 'assignment' | 'review' | 'completionGate'>): string {
  return sha256(canonicalJson({
    workflowProfile: stage.workflowProfile,
    assignment: stage.assignment,
    review: stage.review,
    completionGate: stage.completionGate,
  } as unknown as JsonValue));
}

function legacyReviewLoopRef(stage: StoredStage): string {
  return `review-loop-${sha256(`${stage.runRef}\0${stage.stageRef}`)}`;
}

function materializeLegacyStoreReviewLoops(
  stages: readonly StoredStage[],
  attempts: readonly StoredAttempt[],
  loops: LegacyStoreReviewLoopMigrationRow[],
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
      if (TERMINAL_ATTEMPT.has(attempt.state) || attempt.state === 'interrupted') continue;
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

function assertStoredStageGenerationProjection(stage: RawDocument): void {
  if (!Number.isSafeInteger(stage.currentGeneration) || stage.currentGeneration < 1
    || (stage.currentGenerationRef !== null
      && (typeof stage.currentGenerationRef !== 'string' || !SAFE_REF_RE.test(stage.currentGenerationRef)))
    || (stage.acceptedGenerationRef !== null
      && (typeof stage.acceptedGenerationRef !== 'string' || !SAFE_REF_RE.test(stage.acceptedGenerationRef)))) {
    throw new Error('invalid control-plane stage generation projection');
  }
}

function normalizeStoredStageGenerationProjection(stage: RawDocument): void {
  stage.currentGeneration ??= 1;
  stage.currentGenerationRef ??= null;
  stage.acceptedGenerationRef ??= null;
  assertStoredStageGenerationProjection(stage);
}

function normalizeLegacyFields(document: RawDocument): void {
  for (const bundle of [document, ...document.quarantine]) {
    const runs = bundle === document ? document.runs : [bundle.run];
    for (const run of runs) {
      run.activationReceipts ??= [];
      run.authorizedFailedRunReconciliation ??= null;
      run.managerAssignment ??= null;
      run.agentWorkspaceLaunch ??= null;
    }
    for (const stage of bundle.stages) {
      stage.assignment ??= null;
      stage.workflowProfile ??= null;
      stage.review ??= null;
      stage.completionGate ??= null;
      normalizeStoredStageGenerationProjection(stage);
    }
    for (const session of bundle.sessions) {
      session.brokerSteering ??= [];
      session.brokerReceipts ??= [];
      session.brokerStopRequested ??= false;
    }
  }
}

function upV1ToV2(source: RawDocument, context: MigrationContext): RawDocument {
  const document = source as unknown as StoreDocument;
  prepareLegacyStoreMigration(document);
  for (const bundle of [document, ...document.quarantine]) {
    const generationByRef = new Map(bundle.stageGenerations.map((generation) => [generation.generationRef, generation]));
    for (const attempt of bundle.attempts) migrateLegacyStoreAttemptProvenance(attempt, generationByRef);
  }
  // Missing checker-contract fields are valid v1 residue. Normalize them before deciding which
  // stages actually carry a review contract; v2 invariants still validate every resulting shape.
  normalizeLegacyFields(document as unknown as RawDocument);
  for (const bundle of [document as StoreDocument & LegacyStoreMigrationBundle,
    ...document.quarantine.map((item) => item as QuarantinedRunBundle & LegacyStoreMigrationBundle)]) {
    if (bundle.iterationLoops.length === 0
      && materializeLegacyStoreReviewLoops(bundle.stages, bundle.attempts,
        bundle.reviewLoops ?? (bundle.reviewLoops = []), context.stamp)) {}
  }
  decodeLegacyStoreRows(document);
  const raw = document as unknown as RawDocument;
  for (const run of [...raw.runs, ...raw.quarantine.map((bundle: RawDocument) => bundle.run)]) {
    if (Object.hasOwn(run, 'state')) {
      run.lifecycle = lifecycleForKind(run.state, null);
      delete run.state;
    }
  }
  // Migrations are up-only: a genuine pre-existing v1 document carries no v2 fields, so v2's
  // deployment ledger starts empty at revision 0 (rollback is restore-from-backup, never down-migrate).
  raw.documentRevision = 0;
  raw.deployments = [];
  raw.version = 2;
  return raw;
}

interface P2LocatedRun {
  run: RawDocument;
  subject: string;
  location: string;
  humanRequests: RawDocument[];
  events: RawDocument[];
  mutationReceipts: RawDocument[];
}

function p2MutationReceipts(bundle: RawDocument, run: RawDocument): RawDocument[] {
  const matches = (row: RawDocument): boolean => row.subject === run.subject && row.runRef === run.runRef;
  return [
    ...(Array.isArray(run.activationReceipts) ? run.activationReceipts : []),
    ...(run.authorizedFailedRunReconciliation == null ? [] : [run.authorizedFailedRunReconciliation]),
    ...(bundle.sessions as RawDocument[]).filter(matches).flatMap((session) =>
      Array.isArray(session.brokerReceipts) ? session.brokerReceipts : []),
    ...(bundle.iterationReceipts as RawDocument[]).filter(matches),
    ...(bundle.generationSupersessions as RawDocument[]).filter(matches),
    ...(bundle.stageGenerations as RawDocument[]).filter(matches),
    ...(bundle.attempts as RawDocument[]).filter((attempt) => matches(attempt)
      && (attempt.rerouteOperationKey != null || attempt.iterationAdvanceOperationKey != null)),
  ];
}

function p2LocatedRuns(document: RawDocument): P2LocatedRun[] {
  return [
    ...document.runs.map((run: RawDocument, index: number) => ({
      run, subject: String(run.subject), location: `runs[${index}]`,
      humanRequests: document.humanRequests.filter((row: RawDocument) => row.subject === run.subject && row.runRef === run.runRef),
      events: document.events.filter((row: RawDocument) => row.subject === run.subject && row.runRef === run.runRef),
      mutationReceipts: p2MutationReceipts(document, run),
    })),
    ...document.quarantine.map((bundle: RawDocument, index: number) => ({
      run: bundle.run as RawDocument, subject: String(bundle.subject), location: `quarantine[${index}].run`,
      humanRequests: (bundle.humanRequests as RawDocument[]).filter((row) => row.runRef === bundle.run.runRef),
      events: (bundle.events as RawDocument[]).filter((row) => row.runRef === bundle.run.runRef),
      mutationReceipts: p2MutationReceipts(bundle, bundle.run as RawDocument),
    })),
  ];
}

function existingOwnerHost(run: RawDocument): Pick<RunIdentityFields, 'owner' | 'executionHost'> | null {
  const owner = decodeRunnableRef(run.owner);
  const executionHost = decodeHostKind(run.executionHost);
  return owner && executionHost ? { owner, executionHost } : null;
}

function explicitOutcomeMatchesLifecycle(fields: RunIdentityFields, lifecycle: RunLifecycle['kind']): boolean {
  if (lifecycle === 'succeeded') return fields.terminalOutcome === 'ok' && fields.archivedFrom === null;
  if (lifecycle === 'failed' || lifecycle === 'stopped') {
    return fields.terminalOutcome === lifecycle && fields.archivedFrom === null;
  }
  if (lifecycle !== 'archived') {
    return fields.terminalOutcome === null && fields.completedAt === null && fields.archivedFrom === null;
  }
  const archivedOutcome = {
    succeeded: 'ok', failed: 'failed', stopped: 'stopped',
    interrupted: 'interrupted', 'waiting-human': 'abandoned',
  } as const;
  return fields.archivedFrom !== null && fields.terminalOutcome === archivedOutcome[fields.archivedFrom];
}

export function reportP2RunMigrations(document: RawDocument, context: MigrationContext): P2RunMigrationReports & {
  identities: Array<{ location: string; runRef: string; value: Pick<RunIdentityFields, 'owner' | 'executionHost'> }>;
  outcomes: Array<{ location: string; runRef: string; value: Pick<RunIdentityFields, 'terminalOutcome' | 'completedAt' | 'archivedFrom'> }>;
} {
  const located = p2LocatedRuns(document);
  if (context.explicitMapping && context.explicitMapping.storeSha256 !== context.sourceSha256) {
    throw new Error('explicit run migration mapping store SHA mismatch');
  }
  const identities: Array<{ location: string; runRef: string; value: Pick<RunIdentityFields, 'owner' | 'executionHost'> }> = [];
  const identityInputs = [];
  for (const item of located) {
    const existing = existingOwnerHost(item.run);
    const mapped = context.explicitMapping?.runs[String(item.run.runRef)];
    const decodedMapping = mapped ? decodeRunIdentityFields(mapped) : null;
    if (mapped && !decodedMapping) throw new Error(`invalid explicit run migration mapping for ${String(item.run.runRef)}`);
    const hasOwnerHost = Object.hasOwn(item.run, 'owner') || Object.hasOwn(item.run, 'executionHost');
    const verifiedHost = context.executionHost ?? (process.platform === 'win32' ? 'desktop' : 'vm');
    if (existing && existing.executionHost === verifiedHost) {
      identities.push({ location: item.location, runRef: String(item.run.runRef), value: existing });
      continue;
    }
    if (hasOwnerHost) {
      identityInputs.push({
        runRef: String(item.run.runRef), location: item.location, executionHost: verifiedHost,
        agentWorkspaceLaunch: null, proposal: null, agentDeclarations: [], workflowDefinitions: [], workflowLaunchAudits: [],
      });
      continue;
    }
    if (decodedMapping) {
      identities.push({
        location: item.location, runRef: String(item.run.runRef),
        value: { owner: decodedMapping.owner, executionHost: decodedMapping.executionHost },
      });
      continue;
    }
    const proposal = document.proposals.find((row: RawDocument) => row.subject === item.run.subject
      && row.proposalRef === item.run.proposalRef && row.revision === item.run.proposalRevision
      && row.hash === item.run.proposalHash);
    identityInputs.push({
      runRef: String(item.run.runRef), location: item.location,
      executionHost: verifiedHost,
      agentWorkspaceLaunch: item.run.agentWorkspaceLaunch == null ? null : {
        agentId: String(item.run.agentWorkspaceLaunch.agentId),
        declarationPath: String(item.run.agentWorkspaceLaunch.declarationPath),
        declarationHash: String(item.run.agentWorkspaceLaunch.declarationHash),
      },
      proposal: proposal ? {
        proposalRef: String(proposal.proposalRef), proposalRevision: Number(proposal.revision), proposalHash: String(proposal.hash),
      } : null,
      agentDeclarations: context.agentDeclarations ?? [],
      workflowDefinitions: context.workflowDefinitions ?? [],
      workflowLaunchAudits: context.workflowLaunchAudits ?? [],
    });
  }
  const identityResolution = migrateRunIdentities(identityInputs);
  identities.push(...identityResolution.items.map((item) => ({
    location: item.location, runRef: item.runRef,
    value: { owner: item.value.owner, executionHost: item.value.executionHost },
  })));
  const runIdentity: RunIdentityMigrationReport = {
    ...identityResolution.report,
    total: located.length,
    migrated: identities.length,
  };

  const outcomes: Array<{
    location: string;
    runRef: string;
    value: Pick<RunIdentityFields, 'terminalOutcome' | 'completedAt' | 'archivedFrom'>;
  }> = [];
  const outcomeInputs = located.flatMap((item) => {
    const mapped = context.explicitMapping?.runs[String(item.run.runRef)];
    const decodedMapping = mapped ? decodeRunIdentityFields(mapped) : null;
    const outcomeKeys = ['terminalOutcome', 'completedAt', 'archivedFrom'] as const;
    const outcomeKeysPresent = outcomeKeys.filter((key) => Object.hasOwn(item.run, key));
    const existing = identityFieldsFromRun(item.run);
    if (decodedMapping && outcomeKeysPresent.length === 0) {
      const lifecycle = runLifecycleKind(item.run.lifecycle as RunLifecycle);
      if (!explicitOutcomeMatchesLifecycle(decodedMapping, lifecycle)) {
        throw new Error(`explicit run migration mapping outcome mismatch for ${String(item.run.runRef)}`);
      }
      outcomes.push({
        location: item.location,
        runRef: String(item.run.runRef),
        value: {
          terminalOutcome: decodedMapping.terminalOutcome,
          completedAt: decodedMapping.completedAt,
          archivedFrom: decodedMapping.archivedFrom,
        },
      });
      return [];
    }
    return [{
      runRef: String(item.run.runRef), subject: item.subject, location: item.location,
      lifecycle: runLifecycleKind(item.run.lifecycle as RunLifecycle),
      updatedAt: String(item.run.updatedAt), version: Number(item.run.version),
      archiveOperationKey: typeof item.run.archiveOperationKey === 'string' ? item.run.archiveOperationKey : null,
      humanRequests: item.humanRequests.map((row) => ({
        requestRef: String(row.requestRef), runRef: String(row.runRef), updatedAt: String(row.updatedAt),
        response: row.response == null ? null : {
          requestRevision: Number(row.response.requestRevision), decision: String(row.response.decision),
          respondedBy: String(row.response.respondedBy), idempotencyKey: String(row.response.idempotencyKey),
          response: row.response.response == null ? null : String(row.response.response),
          respondedAt: String(row.response.respondedAt),
        },
      })),
      events: item.events.map((row) => ({ createdAt: String(row.createdAt) })),
      mutationReceipts: item.mutationReceipts.map((receipt: RawDocument) => ({
        ...(typeof receipt.createdAt === 'string' ? { createdAt: receipt.createdAt } : {}),
        ...(typeof receipt.claimedAt === 'string' ? { claimedAt: receipt.claimedAt } : {}),
        ...(typeof receipt.updatedAt === 'string' ? { updatedAt: receipt.updatedAt } : {}),
        ...(typeof receipt.recordedAt === 'string' ? { recordedAt: receipt.recordedAt } : {}),
      })),
      auditRows: context.auditRows ?? [],
      existing,
      existingInvalid: outcomeKeysPresent.length > 0 && (outcomeKeysPresent.length !== outcomeKeys.length || existing === null),
    }];
  });
  const outcomeResolution = migrateRunOutcomes(outcomeInputs);
  outcomes.push(...outcomeResolution.items.map((item) => ({ location: item.location, runRef: item.runRef, value: item.value })));
  const runOutcome: RunOutcomeMigrationReport = {
    ...outcomeResolution.report,
    total: located.length,
    migrated: outcomes.length,
  };
  return { runIdentity, runOutcome, identities, outcomes };
}

function applyP2RunMigration(document: RawDocument, context: MigrationContext): void {
  const reported = reportP2RunMigrations(document, context);
  if (reported.runIdentity.errors.length > 0 || reported.runOutcome.errors.length > 0) {
    throw new P2RunMigrationError({ runIdentity: reported.runIdentity, runOutcome: reported.runOutcome });
  }
  const byLocation = new Map(p2LocatedRuns(document).map((item) => [item.location, item.run]));
  for (const item of reported.identities) Object.assign(byLocation.get(item.location)!, clone(item.value));
  for (const item of reported.outcomes) Object.assign(byLocation.get(item.location)!, clone(item.value));
}

function upV2ToV3(source: RawDocument, context: MigrationContext): RawDocument {
  // Migrations are up-only: a genuine pre-existing v2 document carries no v3 run-identity or schedule
  // fields, so the real P2 run migration always runs and the schedule collections start empty
  // (rollback is restore-from-backup, never down-migrate).
  applyP2RunMigration(source, context);
  source.scheduleCollectionRevision = 0;
  source.schedules = [];
  source.scheduleTombstones = [];
  source.scheduleOccurrenceClaims = [];
  source.scheduleSeedImports = [];
  source.version = 3;
  return source;
}

// P6 [P6-C23, P6-C48]: v3 -> v4 is a purely ADDITIVE edge — it introduces the three placement
// collections empty and touches nothing else, so the paired down deletes exactly those keys and
// restores a byte-identical v3 document (the keys are appended last on the way up and removed on the
// way down, leaving the original key order intact).
function upV3ToV4(source: RawDocument): RawDocument {
  source.hostAdvertisements = [];
  source.placementLeases = [];
  source.v1Idempotency = [];
  source.version = 4;
  return source;
}

// The single edge table for the {1->2, 2->3, 3->4} up-only ladder. It drives both former hand-rolled
// encodings — `applyMigrationEdgeForTest` and the up-ladder — so the edge set is declared once.
// Migrations are up-only; rollback is restore-from-backup, never down-migrate. `breaking` takes the
// generated registry flag (`breakingFlagForUpEdge`, evaluated once here; the registry import is already
// resolved and its value is constant). `fn` is called with `(document, context)`; edges that ignore
// `context` simply drop it.
interface MigrationEdge {
  from: number;
  to: number;
  fn: (document: RawDocument, context: MigrationContext) => RawDocument;
  breaking: boolean;
}

const UP_EDGES: readonly MigrationEdge[] = [
  { from: 1, to: 2, fn: upV1ToV2, breaking: breakingFlagForUpEdge(1, 2) },
  { from: 2, to: 3, fn: upV2ToV3, breaking: breakingFlagForUpEdge(2, 3) },
  { from: 3, to: 4, fn: upV3ToV4, breaking: breakingFlagForUpEdge(3, 4) },
];

export function applyMigrationEdgeForTest(
  source: unknown,
  target: 1 | 2 | 3 | 4,
  context: MigrationContext,
): unknown {
  assertMigrationEnvelope(source);
  const document = clone(source);
  const edge = UP_EDGES.find((candidate) => candidate.from === document.version && candidate.to === target);
  if (!edge) throw new Error(`no control-plane migration edge ${document.version}->${target}`);
  return edge.fn(document, context);
}

export function migrateControlDocument(
  source: unknown,
  target: number,
  context: MigrationContext,
): MigrationResult {
  assertMigrationEnvelope(source);
  if (!Number.isSafeInteger(target) || target < 1 || target > CONTROL_PLANE_SCHEMA_VERSION) {
    throw new Error(`unsupported control-plane target version ${String(target)}`);
  }
  const document = clone(source);
  const applied: AppliedMigration[] = [];
  // P6 [P6-C32]: the ladder chains every up edge so v1 -> v4 and v2 -> v4 reach the target in one call
  // (each `up*` advances `document.version`, so the loop steps one edge at a time). Migrations are
  // up-only; rollback is restore-from-backup, never down-migrate.
  while (document.version < target) {
    const edge = UP_EDGES.find((candidate) => candidate.from === document.version);
    if (!edge) break;
    edge.fn(document, context);
    applied.push({ from: edge.from, to: edge.to, breaking: edge.breaking, down: 'present' });
  }
  if (document.version !== target) {
    throw new Error(`no control-plane migration path ${document.version}->${target}`);
  }
  if (target === CONTROL_PLANE_SCHEMA_VERSION) assertDocumentInvariant(document);
  else assertMigrationEnvelope(document);
  return { document: document as StoreDocument, applied };
}

export function loadAndMigrate(encoded: string, target: number, context: MigrationContext): MigrationResult {
  const parsed: unknown = JSON.parse(encoded);
  assertMigrationEnvelope(parsed);
  return migrateControlDocument(parsed, target, context);
}

export interface P2ScheduleStartupMigrationReport {
  phases: ['identity', 'outcome', 'schedule-collections', 'seed-import', 'pause-marker-conversion'];
  source: Awaited<ReturnType<typeof openAttestedScheduleSource>>;
}

/**
 * The Run migration and v3 collection creation are completed by `loadAndMigrate` before this async
 * startup continuation is called. Keeping the remaining phases here makes their order observable and
 * prevents pause conversion from racing seed creation.
 */
export async function runP2ScheduleStartupMigrations(
  input: {
    currentReleasePath?: string;
    existingMarker?: ScheduleSeedImportMarker | null;
    development?: DevelopmentScheduleSeedSource;
    commitSeeds(plan: ScheduleSeedImportPlan): Promise<void>;
    convertPauseMarkers(): Promise<unknown>;
  },
  deps: {
    openSource?: typeof openAttestedScheduleSource;
    importSeeds?: typeof importHeartbeatScheduleSeedsV1;
  } = {},
): Promise<P2ScheduleStartupMigrationReport> {
  const source = await (deps.openSource ?? openAttestedScheduleSource)({ currentPath: input.currentReleasePath });
  const imported = await (deps.importSeeds ?? importHeartbeatScheduleSeedsV1)({
    source,
    existingMarker: input.existingMarker,
    ...(input.development ? { development: input.development } : {}),
  }, input.commitSeeds);
  if (!imported.ok) throw Object.assign(new Error(imported.code), { code: imported.code, report: imported.report });
  await input.convertPauseMarkers();
  return {
    phases: ['identity', 'outcome', 'schedule-collections', 'seed-import', 'pause-marker-conversion'],
    source,
  };
}

export function normalizeCrash(
  document: StoreDocument,
  context: { stamp: string; bootId: string },
): boolean {
  let changed = false;
  const raw = document as unknown as RawDocument;
  for (const run of raw.runs) {
    let runChanged = false;
    if (run.lifecycle.kind === 'paused-for-deploy') {
      const claim = run.lifecycle.deployPause.resumeClaim;
      if (claim !== null && claim.bootId !== context.bootId) {
        run.lifecycle = lifecycleForKind('paused-for-deploy', { ...run.lifecycle.deployPause, resumeClaim: null });
        run.version += 1;
        run.updatedAt = context.stamp;
        changed = true;
      }
      continue;
    }
    const pendingActivation = [...run.activationReceipts].reverse()
      .find((receipt: RawDocument) => receipt.phase === 'claimed' || receipt.phase === 'roots-activated');
    const normalizedLifecycle = crashNormalizedLifecycle(run.lifecycle, pendingActivation !== undefined);
      if (normalizedLifecycle !== run.lifecycle) {
        run.lifecycle = normalizedLifecycle;
        run.version += 1;
        run.updatedAt = context.stamp;
        runChanged = true;
      }
    for (const stage of raw.stages.filter((item: RawDocument) => item.subject === run.subject && item.runRef === run.runRef)) {
      if (stage.state !== 'running') continue;
      stage.state = 'interrupted';
      stage.version += 1;
      stage.updatedAt = context.stamp;
      runChanged = true;
    }
    for (const attempt of raw.attempts.filter((item: RawDocument) => item.subject === run.subject && item.runRef === run.runRef)) {
      if (attempt.state !== 'starting' && attempt.state !== 'running') continue;
      attempt.state = 'interrupted';
      attempt.version += 1;
      attempt.updatedAt = context.stamp;
      runChanged = true;
    }
    for (const session of raw.sessions.filter((item: RawDocument) => item.subject === run.subject && item.runRef === run.runRef)) {
      if (!['starting', 'running', 'waiting'].includes(session.state)) continue;
      session.state = 'interrupted';
      session.version += 1;
      session.updatedAt = context.stamp;
      session.brokerStopRequested = false;
      runChanged = true;
    }
    if (runChanged) {
      raw.events.push({
        subject: run.subject,
        cursor: raw.nextEventCursor,
        runRef: run.runRef,
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
        createdAt: context.stamp,
      });
      raw.nextEventCursor += 1;
      changed = true;
    }
  }
  return changed;
}
