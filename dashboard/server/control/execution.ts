import { createHash } from 'node:crypto';
import { sha256Hex } from '../shared/hashing.ts';
import { createReadStream } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { AttemptLaunch } from '../pty/contracts.ts';
import type { ControlPlaneStore } from './store.ts';
import type { Attempt, IterationArtifactSnapshot, ManagedSession, RunDetail, Stage } from './types.ts';
import { runLifecycleKind, type RunLifecycleKind } from './runLifecycle.ts';
import {
  classifyActionRisk,
  evaluateExecutionPolicy,
  policyScopeForStage,
  type ExecutionProfile,
  type PolicyEnvironment,
  type PublicationAuthorizationState,
  type SpendAuthorizationState,
} from './policy.ts';
import { ARTIFACT_PRODUCING_REQUEST_KINDS, isSafeRepoRelativePath, proposalContentHash, type PlanProposal, type ProposalStage, type ResolvedAgentAssignment } from './proposal.ts';
import type { AssignedAgentResolver, ResolvedAssignedAgent } from './agentAssignmentResolver.ts';
import {
  parseIterationOutcome,
  type IterationOutcome,
  type IterationOutcomeContract,
} from './iterationOutcome.ts';

const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_PROJECT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const REQUIRED_POLICY_REFS = ['CLAUDE.md', 'governance/agent-rules.md', 'governance/risk-tiers.md'] as const;
const REQUIRED_WORKER_CAPABILITIES = [
  'read',
  'write-approved-scope',
  'run-approved-commands',
  'emit-events',
] as const;

export interface ExecutionBudget {
  maxAttempts: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  /** Integer micro-dollars; floats never cross this boundary. */
  maxCostUsdMicros: number;
}

export interface ExecutionUsage {
  inputTokens: number;
  outputTokens: number;
  costUsdMicros: number;
}

export interface AccountingReservation {
  reservationRef: string;
  replayed: boolean;
}

export interface AccountingAdapter {
  /** Must durably deduplicate operationKey and atomically enforce all supplied limits. */
  reserve(input: {
    operationKey: string;
    subject: string;
    runRef: string;
    attemptRef: string;
    limits: ExecutionBudget;
  }): Promise<{ ok: true; value: AccountingReservation } | { ok: false; reason: string }>;
  /** Must durably deduplicate operationKey. */
  settle(input: {
    operationKey: string;
    reservationRef: string;
    usage: ExecutionUsage;
  }): Promise<void>;
}

export interface WorktreeAdapter {
  /** Idempotently ensures an isolated worktree at the server-planned path. */
  ensure(input: { operationKey: string; runRef: string; path: string; baseCommit?: string }): Promise<void>;
  /** Server-side inspection (for example git status/hash), never worker self-reporting. */
  inspect(input: { operationKey: string; runRef: string; path: string }): Promise<{
    changed: readonly WorkerArtifactResult[];
  }>;
  /**
   * Best-effort, idempotent teardown of a terminal attempt worktree. Callers invoke this only once
   * the worktree is provably no longer read by inspect/integrate. It must not throw on a missing or
   * already-removed worktree.
   */
  remove(input: { operationKey: string; runRef: string; path: string }): Promise<void>;
}

export interface ManagerAdapter {
  /** Idempotently spawns or reattaches the logical Manager and rehydrates durable run state. */
  ensure(input: {
    operationKey: string;
    subject: string;
    runRef: string;
    sessionRef: string;
    generation: number;
    predecessorSessionRef: string | null;
    proposalHash: string;
    profile: ExecutionProfile;
    /** Present only after a server-owned assignment resolver verifies the current declaration. */
    assignment?: ResolvedAgentAssignment;
    /** D3(b) validation evidence only; no manager child or prompt consumes this text. */
    instructionMarkdown?: string;
  }): Promise<void>;
}

export interface SkillResolver {
  /** Resolves only ids already admitted by the server-owned curated skill registry. */
  resolve(input: {
    operationKey: string;
    profile: ExecutionProfile;
    requested: readonly string[];
  }): Promise<{ ok: true; skills: readonly string[] } | { ok: false; reason: string }>;
}

export interface WorkerArtifactResult {
  path: string;
  digest: string;
}

export interface WorkerExecutionResult {
  state: 'succeeded' | 'failed' | 'waiting-human';
  summary: string;
  usage: ExecutionUsage;
  artifacts: WorkerArtifactResult[];
  checkpoints: string[];
  /** Present only when a verdict-producing participant satisfied its server-owned iteration contract. */
  iterationOutcome?: IterationOutcome;
}

export interface WorkerAdapter {
  /**
   * Two-phase attempt start ([C-S5]). `begin` returns immediately with `{receipt,result}`: the receipt
   * resolves only once the session exists, its durable operation receipt is written, the one-to-one
   * attempt binding is committed, and the recorder is attached. A caller MUST await the receipt before
   * projecting `starting -> running`, and only then await `result`. A refused receipt therefore never
   * produces a running projection, and an exact duplicate `operationKey` shares one receipt and one
   * result while a changed request hash conflicts.
   * operationKey is stable across reconciliation; implementations must not spawn duplicates.
   */
  begin(input: {
    operationKey: string;
    subject: string;
    runRef: string;
    stageRef: string;
    attemptRef: string;
    sessionRef: string;
    worktreePath: string;
    profile: ExecutionProfile;
    /**
     * The approved proposal's declared workflow tool-allowlist profile id, carried as data from
     * `PlanProposal.profile`. `null` when the proposal declares none — which an adapter must treat as a
     * refusal to spawn, never as an unrestricted worker.
     */
    workflowProfile: string | null;
    skills: readonly string[];
    action: string;
    target: string;
    workOrder: string;
    readScope: readonly string[];
    writeScope: readonly string[];
    checkpoints: readonly string[];
    /** Optional immutable generic contract, including the exact server-created iteration request. */
    iterationContract?: IterationOutcomeContract;
    /** Explicit adapter-boundary fence: this launch must return a closed iteration outcome. */
    expectsIterationOutcome?: boolean;
    /** Present only after a server-owned assignment resolver verifies the current declaration. */
    assignment?: ResolvedAgentAssignment;
    /** Exact bounded declaration Markdown, never browser/prompt input. */
    instructionMarkdown?: string;
    /**
     * The immutable compiled stage and its project, for adapters that must re-derive a stage's own halt
     * structure (declared human gates, dependencies, declared artifacts) at delivery time — the worker
     * pty adapter does. The loose `action`/`target`/`workOrder`/scope fields above stay the interface for
     * every adapter that does not; an adapter that needs this must REFUSE when it is absent rather than
     * reconstruct it. Never browser input: it comes from the approved proposal the run is bound to.
     */
    proposalStage?: ProposalStage;
    project?: string;
  }): AttemptLaunch;
}

export interface ManagedCancellationInput {
  operationKey: string;
  subject: string;
  runRef: string;
  sessionRef: string;
  attemptRef: string | null;
  intent: 'run-cancel' | 'run-complete';
}

/** Injected, idempotent stop authority. No production implementation is activated by this module. */
export interface ExecutionCancellationController {
  cancelManager(input: ManagedCancellationInput): Promise<void>;
  cancelWorker(input: ManagedCancellationInput & { attemptRef: string; attemptOperationKey: string }): Promise<void>;
}

function workerAttemptOperationKey(attemptRef: string, iterationRequestRef?: string): string {
  return iterationRequestRef ? `iteration-turn:${iterationRequestRef}` : `automatic-attempt:${attemptRef}`;
}

export interface ResultIntegrator {
  /** Returns a previously committed canonical result so restart recovery need not re-execute work. */
  lookup(input: { operationKey: string; subject: string; runRef: string; stageId: string }): Promise<CanonicalStageResult | null>;
  /** Resolve a committed run-lineage base only after every canonical dependency result is verified. */
  resolveBase?(input: {
    operationKey: string;
    subject: string;
    runRef: string;
    stageId: string;
    dependencyStageIds: readonly string[];
    /** Exact accepted generation identities for reviewed dependencies, never a stage-id-only lookup. */
    dependencyResultOperationKeys?: readonly { stageId: string; operationKey: string }[];
  }): Promise<string | null>;
  /** Commits the canonical stage result before dependent release; must deduplicate operationKey. */
  integrate(input: {
    operationKey: string;
    subject: string;
    runRef: string;
    stageRef: string;
    stageId: string;
    attemptRef: string;
    /** g1 writes the stage card; later review generations have no mutable stage card. */
    canonicalCardRef: string | null;
    summary: string;
    artifacts: readonly WorkerArtifactResult[];
    changed: readonly WorkerArtifactResult[];
    checkpoints: readonly string[];
    /** A participant outcome already validated against its server-owned iteration contract. */
    iterationOutcome?: IterationOutcome;
    /** Required with iterationOutcome; supplied only from the immutable approved definition and request. */
    iterationContract?: IterationOutcomeContract;
    resultHash: string;
    worktreePath: string;
  }): Promise<ResultIntegrationReceipt>;
}

export interface CanonicalStageResultPayload {
  summary: string;
  artifacts: readonly WorkerArtifactResult[];
  changed: readonly WorkerArtifactResult[];
  checkpoints: readonly string[];
  /** Validated generic participant output, when this result belongs to an iteration turn. */
  iterationOutcome?: IterationOutcome;
}

export type CanonicalStageResult = CanonicalStageResultPayload & { resultHash: string } & (
  | {
      durability: 'canonical';
      /** Immutable attempt parent and canonical lineage commit. */
      attemptBaseCommit: string;
      integrationCommit: string;
    }
  | {
      /** Inactive adapters retain only app-local receipts and can never satisfy reviewed lineage. */
      durability: 'inactive';
      attemptBaseCommit: null;
      integrationCommit: null;
    }
);

export type ResultIntegrationReceipt = (
  | { durability: 'canonical'; attemptBaseCommit: string; integrationCommit: string }
  | { durability: 'inactive' }
) & {
  status: 'integrated' | 'replayed';
  resultHash: string;
};

export interface AutomaticExecutionOptions {
  store: ControlPlaneStore;
  /** Held Wave-A environment, retained for the configured default project only. */
  policy: PolicyEnvironment;
  /** Project represented by the held policy. Defaults to the Wave-A kb-ops project. */
  policyProject?: string;
  /** Optional server-owned project resolver. It is invoked once, then snapshotted, per run. */
  resolvePolicy?: (project: string) => PolicyEnvironment;
  /** Required only for assigned compiler snapshots; legacy unassigned runs never invoke it. */
  assignedAgents?: AssignedAgentResolver;
  worktreeRoot: string;
  /** Server-owned ceiling shared by every active run. */
  maxConcurrency: number;
  /** Per-run fallback when the compiler did not declare maxConcurrency. Defaults to the ceiling. */
  defaultRunConcurrency?: number;
  /** WINDOW ceiling for the whole accounting window; also the automatic retry cap (`maxAttempts`). */
  budget: ExecutionBudget;
  /**
   * PER-ATTEMPT reservation limits. Every attempt reserves against this, never against the window
   * ceiling: the accounting adapter projects held limits at face value, so reserving each attempt at the
   * window ceiling makes the second attempt of a window unadmittable as soon as the first settles with
   * any usage. Must fit inside `budget` on every field (validated where it is resolved, in activation).
   */
  attemptBudget: ExecutionBudget;
  /** Closed server action registry; prose cannot widen runtime capabilities. */
  worktrees: WorktreeAdapter;
  managers: ManagerAdapter;
  workers: WorkerAdapter;
  skills: SkillResolver;
  accounting: AccountingAdapter;
  results: ResultIntegrator;
  cancellation: ExecutionCancellationController;
  /**
   * Optional server-owned spend-grant provisioning hook (FYT paid-action wiring, Unit D3). Called just
   * before a stage's worker runs, with the prepared attempt worktree path, so a spending stage's opaque
   * grant token can be minted and written into that worktree BEFORE the worker spawns. It spawns nothing
   * and mutates no run state; it only mints a grant and writes `.kb/spend-grant.json`. Left `undefined`
   * everywhere execution runs today (the executor is inert in production), so the default is a strict
   * no-op and this option changes nothing about existing behaviour. Supplied ONLY behind the activation
   * gate (see `activation.ts`). A throw from a supplied hook fails the attempt rather than running a
   * worker that has no grant to spend against.
   */
  provisionSpendGrant?: (input: ProvisionSpendGrantInput) => Promise<void>;
}

/** Everything the {@link AutomaticExecutionOptions.provisionSpendGrant} hook needs to derive, server-side,
 *  whether this stage spends and, if so, mint its grant against the run's own resolved gate approvals. All
 *  fields are server truth (the immutable proposal stage and the run's durable human requests); none is
 *  worker- or browser-supplied. */
export interface ProvisionSpendGrantInput {
  subject: string;
  runRef: string;
  stageRef: string;
  stageId: string;
  attemptRef: string;
  worktreePath: string;
  proposalStage: ProposalStage;
  humanRequests: readonly RunDetail['humanRequests'][number][];
}

export interface ExecuteRunInput {
  subject: string;
  runRef: string;
  proposal: PlanProposal;
  /** Server-local acknowledgement after the Manager adapter and durable session/run state are live. */
  onManagerStarted?: () => void;
}

/** Bound for HTTP/operator acknowledgement of durable Manager startup; adapters own deeper timeouts. */
export const DEFAULT_MANAGER_START_ACK_TIMEOUT_MS = 30_000;

export interface ExecutionOutcome {
  state: RunLifecycleKind;
  startedStageIds: string[];
  completedStageIds: string[];
  waitingStageIds: string[];
}

export interface CancelRunInput {
  subject: string;
  runRef: string;
  idempotencyKey: string;
  reason: string;
}

export interface ContainManagerStartInput {
  subject: string;
  runRef: string;
  idempotencyKey: string;
}

export interface CancellationOutcome {
  state: RunLifecycleKind;
  stoppedSessionRefs: string[];
  interruptedSessionRefs: string[];
  replayed: boolean;
}

export class AutomaticExecutionError extends Error {}

function requireSafeInteger(value: number, name: string, minimum: number): void {
  if (!Number.isSafeInteger(value) || value < minimum) throw new AutomaticExecutionError(`${name} is invalid`);
}

function assertUsage(value: ExecutionUsage): void {
  requireSafeInteger(value.inputTokens, 'inputTokens', 0);
  requireSafeInteger(value.outputTokens, 'outputTokens', 0);
  requireSafeInteger(value.costUsdMicros, 'costUsdMicros', 0);
}

function contains(path: string, roots: readonly string[]): boolean {
  return roots.some((root) => path === root || path.startsWith(`${root.replace(/\/$/, '')}/`));
}

/** Server-owned worktree planning. Neither proposals nor browser requests can supply this path. */
export function planRunWorktreePath(worktreeRoot: string, runRef: string): string {
  if (!isAbsolute(worktreeRoot)) throw new AutomaticExecutionError('worktreeRoot must be absolute');
  if (!SAFE_REF.test(runRef) || runRef.includes('..')) throw new AutomaticExecutionError('runRef is unsafe for worktree planning');
  const root = resolve(worktreeRoot);
  const planned = resolve(root, runRef);
  const child = relative(root, planned);
  if (!child || child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) {
    throw new AutomaticExecutionError('planned worktree escapes its server-owned root');
  }
  return planned;
}

/** Attempts are isolated beneath the per-run directory so parallel stages cannot contaminate inspection. */
export function planAttemptWorktreePath(worktreeRoot: string, runRef: string, attemptRef: string): string {
  const runPath = planRunWorktreePath(worktreeRoot, runRef);
  if (!SAFE_REF.test(attemptRef) || attemptRef.includes('..')) throw new AutomaticExecutionError('attemptRef is unsafe for worktree planning');
  const planned = resolve(runPath, attemptRef);
  const child = relative(runPath, planned);
  if (!child || child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) {
    throw new AutomaticExecutionError('planned attempt worktree escapes its run root');
  }
  return planned;
}

export function canonicalResultOperationKey(runRef: string, stageId: string, generation: number = 1): string {
  if (!SAFE_REF.test(runRef) || runRef.includes('..') || !SAFE_REF.test(stageId) || stageId.includes('..')) {
    throw new AutomaticExecutionError('canonical result identity is unsafe');
  }
  if (!Number.isSafeInteger(generation) || generation < 1) throw new AutomaticExecutionError('canonical result generation is invalid');
  const base = `result:${runRef}:${stageId}`;
  return generation === 1 ? base : `${base}:g${generation}`;
}

interface ArtifactFileState {
  regularFile: boolean;
  size: number | null;
  sha256: string | null;
}

async function streamedSha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

async function artifactFileState(path: string): Promise<ArtifactFileState> {
  try {
    const status = await lstat(path);
    if (!status.isFile()) return { regularFile: false, size: null, sha256: null };
    return { regularFile: true, size: status.size, sha256: await streamedSha256(path) };
  } catch {
    return { regularFile: false, size: null, sha256: null };
  }
}

function artifactPath(worktreePath: string, declaredPath: string): string {
  if (!isSafeRepoRelativePath(declaredPath)) throw new AutomaticExecutionError('declared artifact path is unsafe');
  const root = resolve(worktreePath);
  const planned = resolve(root, declaredPath);
  const child = relative(root, planned);
  if (!child || child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) {
    throw new AutomaticExecutionError('declared artifact escapes its attempt worktree');
  }
  return planned;
}

async function snapshotDeclaredArtifacts(worktreePath: string, stage: ProposalStage): Promise<Array<{
  path: string;
  before: ArtifactFileState;
}>> {
  return Promise.all(stage.artifacts.map(async (artifact) => ({
    path: artifact.path,
    before: await artifactFileState(artifactPath(worktreePath, artifact.path)),
  })));
}

async function inspectDeclaredArtifacts(
  worktreePath: string,
  before: readonly { path: string; before: ArtifactFileState }[],
): Promise<{ snapshots: IterationArtifactSnapshot[]; failureReason: string | null }> {
  const snapshots = await Promise.all(before.map(async (snapshot): Promise<IterationArtifactSnapshot> => {
    const after = await artifactFileState(artifactPath(worktreePath, snapshot.path));
    return {
      path: snapshot.path,
      regularFile: snapshot.before.regularFile,
      size: snapshot.before.size,
      sha256: snapshot.before.sha256,
      afterRegularFile: after.regularFile,
      afterSize: after.size,
      afterSha256: after.sha256,
      byteIdentical: snapshot.before.regularFile && after.regularFile
        && snapshot.before.size === after.size && snapshot.before.sha256 === after.sha256,
    };
  }));
  const irregular = snapshots.find((snapshot) => !snapshot.afterRegularFile);
  if (irregular) return { snapshots, failureReason: `required artifact '${irregular.path}' is missing or irregular` };
  const empty = snapshots.find((snapshot) => snapshot.afterSize === 0);
  if (empty) return { snapshots, failureReason: `required artifact '${empty.path}' is empty` };
  const identical = snapshots.find((snapshot) => snapshot.byteIdentical);
  if (identical) return { snapshots, failureReason: `required artifact '${identical.path}' is byte-identical to its pinned input` };
  return { snapshots, failureReason: null };
}

/** Generic iteration results are identified by the immutable logical request, never a stage counter. */
export function iterationResultOperationKey(runRef: string, stageId: string, requestRef: string): string {
  if (!SAFE_REF.test(runRef) || runRef.includes('..') || !SAFE_REF.test(stageId) || stageId.includes('..')
    || !SAFE_REF.test(requestRef) || requestRef.includes('..')) {
    throw new AutomaticExecutionError('iteration result identity is unsafe');
  }
  return `iteration-result:${runRef}:${stageId}:${requestRef}`;
}

export function canonicalStageResultHash(
  result: CanonicalStageResultPayload,
): string {
  const artifacts = [...result.artifacts].map((item) => ({ path: item.path, digest: item.digest })).sort((a, b) => a.path.localeCompare(b.path));
  const changed = [...result.changed].map((item) => ({ path: item.path, digest: item.digest })).sort((a, b) => a.path.localeCompare(b.path));
  const checkpoints = [...result.checkpoints].sort();
  const iterationOutcome = result.iterationOutcome === undefined ? null : {
    schema: result.iterationOutcome.schema,
    requestRef: result.iterationOutcome.requestRef,
    iterationLoopRef: result.iterationOutcome.iterationLoopRef,
    participantId: result.iterationOutcome.participantId,
    cycle: result.iterationOutcome.cycle,
    verdict: result.iterationOutcome.verdict,
    inputGenerationRefs: [...result.iterationOutcome.inputGenerationRefs],
    criteria: result.iterationOutcome.criteria.map((criterion) => ({
      criterionId: criterion.criterionId, verdict: criterion.verdict, findingIds: [...criterion.findingIds],
    })),
    findings: result.iterationOutcome.findings.map((finding) => ({
      findingId: finding.findingId, criterionId: finding.criterionId, severity: finding.severity,
      summary: finding.summary, evidencePaths: [...finding.evidencePaths],
    })),
    ...(result.iterationOutcome.resolvedFindingRefs === undefined
      ? {} : { resolvedFindingRefs: [...result.iterationOutcome.resolvedFindingRefs] }),
    positions: result.iterationOutcome.positions.map((position) => ({
      positionId: position.positionId, participantId: position.participantId,
      summary: position.summary, generationRefs: [...position.generationRefs],
    })),
    recordedDissent: result.iterationOutcome.recordedDissent.map((dissent) => ({ ...dissent })),
    summary: result.iterationOutcome.summary,
  };
  const payload = { summary: result.summary, artifacts, changed, checkpoints };
  if (result.iterationOutcome !== undefined) {
    return sha256Hex(JSON.stringify({ ...payload, iterationOutcome }));
  }
  return sha256Hex(JSON.stringify({ ...payload, iterationOutcome }));
}

function validatedIterationOutcome(contract: IterationOutcomeContract, outcome: IterationOutcome): IterationOutcome | null {
  try {
    const parsed = parseIterationOutcome(JSON.stringify(outcome), contract);
    return parsed.ok ? parsed.value : null;
  } catch {
    return null;
  }
}

function hasImmutableLineage(result: CanonicalStageResult | ResultIntegrationReceipt): result is (CanonicalStageResult | ResultIntegrationReceipt) & {
  durability: 'canonical'; attemptBaseCommit: string; integrationCommit: string;
} {
  return result.durability === 'canonical'
    && /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(result.attemptBaseCommit)
    && /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(result.integrationCommit);
}

function stageById(proposal: PlanProposal, stageId: string): ProposalStage {
  const stage = proposal.stages.find((candidate) => candidate.id === stageId);
  if (!stage) throw new AutomaticExecutionError(`run stage '${stageId}' is absent from the approved proposal`);
  return stage;
}

function resultIsSafe(
  stage: ProposalStage,
  result: WorkerExecutionResult,
  inspection: { changed: readonly WorkerArtifactResult[] },
  iterationContract?: IterationOutcomeContract,
): boolean {
  const allowedArtifacts = new Set(stage.artifacts.map((artifact) => artifact.path));
  const allowedCheckpoints = new Set(stage.checkpoints.map((checkpoint) => checkpoint.id));
  const inspected = new Map(inspection.changed.map((artifact) => [artifact.path, artifact.digest]));
  return result.summary.length <= 64 * 1024
    && !result.summary.includes('\0')
    && result.artifacts.every((artifact) =>
      isSafeRepoRelativePath(artifact.path)
      && allowedArtifacts.has(artifact.path)
      && contains(artifact.path, stage.scope.write)
      && /^[a-f0-9]{64}$/.test(artifact.digest))
    && inspection.changed.every((artifact) =>
      isSafeRepoRelativePath(artifact.path)
      && contains(artifact.path, stage.scope.write)
      && /^[a-f0-9]{64}$/.test(artifact.digest))
    && result.artifacts.every((artifact) => inspected.get(artifact.path) === artifact.digest)
    && result.checkpoints.every((checkpoint) => allowedCheckpoints.has(checkpoint))
    && (result.state !== 'succeeded' || (result.iterationOutcome === undefined
      ? iterationContract === undefined
      : iterationContract !== undefined && validatedIterationOutcome(iterationContract, result.iterationOutcome) !== null));
}

export function stableHumanTitle(kind: 'gate' | 'policy' | 'budget' | 'execution', stageId: string, detail: string): string {
  return `automatic:${kind}:${stageId}:${detail}`.slice(0, 240);
}

/**
 * Stage-stable title for a PRIOR canonical integration that an interrupted step left below its canonical
 * states. Deliberately carries no attemptRef: the condition belongs to the stranded record, not to any one
 * attempt, so repeated encounters reuse the one open boundary instead of stacking byte-identical parks.
 */
function strandedIntegrationTitle(stageId: string): string {
  return stableHumanTitle('execution', stageId, 'canonical-integration-incomplete');
}

/**
 * A result integrator raised "the record is mine, but its integration never finished" — a refused lineage
 * push, a daemon exit mid-publication. Classified by a duck-typed marker rather than an imported class
 * because the concrete integrator (`canonicalResultIntegrator.ts`) imports THIS module; the reverse import
 * would be a cycle. This is a stuck PRIOR integration, never an ordinary attempt failure: the attempt has
 * done no work at that point, so spawning a successor only re-raises the same error and burns a generation.
 */
export function isCanonicalIntegrationIncomplete(error: unknown): boolean {
  return typeof error === 'object' && error !== null
    && (error as { canonicalIntegrationIncomplete?: unknown }).canonicalIntegrationIncomplete === true;
}

function profileFor(policy: PolicyEnvironment, role: 'manager' | 'worker', runtime: string, model: string): ExecutionProfile | null {
  return policy.profiles.find((profile) => profile.role === role && profile.runtime === runtime && profile.model === model) ?? null;
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

interface RestrictedIntentRule {
  readonly pattern: RegExp;
  /** Disposition when the vocabulary appears in the stage's structured `action` id. */
  readonly action: { kind: 'refuse' | 'waiting'; reason: string };
  /** Disposition when the vocabulary appears only in the free-text `workOrder` prose. */
  readonly prose: { kind: 'refuse' | 'waiting'; reason: string };
}

/**
 * Restricted-intent vocabulary, evaluated per-field rather than over one concatenated blob.
 *
 * The `action` id is a compiled, structured declaration of what a stage DOES; restricted vocabulary
 * there is a deliberate statement of intent, so it keeps the original hard disposition (credential /
 * spending are non-overridable refusals; publication waits for approval).
 *
 * The `workOrder` is free-text instructions handed to a tool-capped, scope-bound worker — and, as the
 * `self-lint-report` false positive proved, the natural place for a def to state its OWN safety rules
 * ("report the path only — never echo a suspected secret's value", "no spend, no publish"). Those
 * prohibition sentences contain exactly the vocabulary this scanner hunts. A prose match is therefore
 * kept as defense-in-depth but downgraded to an `approval`-kind `waiting` boundary instead of a
 * non-overridable `governance-refusal`.
 *
 * What that downgrade does and does NOT buy (verified empirically in review): the flagged stage parks
 * waiting-human BEFORE any worker runs, and — because this check recomputes from immutable proposal
 * content on every engine pass and never consults the human decision — an approval does NOT release the
 * flagged stage; it re-parks on the next pass. The benefit is that an approved `approval` boundary
 * (unlike a `governance-refusal`, see launch.ts#acceptsBoundary) no longer poisons the REST of the run:
 * sibling stages can proceed. A false positive on a single-stage def still parks that run permanently —
 * the def must be reworded (as PR #58 did for self-lint-report).
 *
 * CONSTRAINT for future editors: if this branch is ever made releasable-on-approval, the human request
 * MUST be extended to show the full work order at decision time — today it carries only the reason slug,
 * and a reviewer must never approve prose they cannot see.
 *
 * Structured defenses (classifyActionRisk on the action namespace, evaluateExecutionPolicy, the worker
 * tool cap and write-scope) remain unchanged beneath this scan. Target paths are intentionally NOT
 * scanned here — legitimate paths such as `docs/credential-policy.md` would false-positive, and target
 * safety is already enforced structurally by evaluateExecutionPolicy.
 */
const RESTRICTED_INTENT_RULES: readonly RestrictedIntentRule[] = [
  {
    pattern: /\b(?:credential|password|private key|api key|access token|secret)\b/,
    action: { kind: 'refuse', reason: 'credential-handling-intent-is-forbidden' },
    prose: { kind: 'waiting', reason: 'credential-handling-language-requires-human-review' },
  },
  {
    pattern: /\b(?:purchase|spend|payment|credit card|buy)\b/,
    action: { kind: 'refuse', reason: 'real-spending-intent-is-forbidden' },
    prose: { kind: 'waiting', reason: 'spending-language-requires-human-review' },
  },
  {
    pattern: /\b(?:publish|publication|deploy|release externally|upload externally)\b/,
    action: { kind: 'waiting', reason: 'external-publication-intent-requires-human-approval' },
    prose: { kind: 'waiting', reason: 'external-publication-intent-requires-human-approval' },
  },
];

/** Copy and validate one server-owned project policy before any manager or worker decision is made. */
function snapshotProjectPolicy(project: string, environment: PolicyEnvironment): PolicyEnvironment {
  if (!SAFE_PROJECT.test(project)) throw new AutomaticExecutionError('proposal project is unsafe for policy resolution');
  const contractRef = `orgs/${project}/contract.md`;
  const required = [...REQUIRED_POLICY_REFS, contractRef];
  if (required.some((ref) => typeof environment.governanceContents[ref] !== 'string')
    || !environment.contractText.trim()) {
    throw new AutomaticExecutionError('project policy environment is incomplete');
  }
  return {
    profiles: environment.profiles.map((profile) => ({ ...profile, capabilities: [...profile.capabilities] })),
    curatedSkills: new Set(environment.curatedSkills),
    contractText: environment.contractText,
    governanceContents: { ...environment.governanceContents },
  };
}

function restrictedIntent(stage: ProposalStage): { kind: 'refuse' | 'waiting'; reason: string } | null {
  const action = stage.action.toLowerCase();
  for (const rule of RESTRICTED_INTENT_RULES) {
    if (rule.pattern.test(action)) return rule.action;
  }
  const prose = stage.workOrder.toLowerCase();
  for (const rule of RESTRICTED_INTENT_RULES) {
    if (rule.pattern.test(prose)) return rule.prose;
  }
  return null;
}

/**
 * Resolve the spend-authorization state of ONE stage from its own compiled gates and the run's own
 * resolved human requests.
 *
 * Three properties this must keep, and how:
 * - Stage-scoped: the request is matched by `stableHumanTitle('gate', stage.stageId, gate.id)`, so an
 *   approval recorded on a DIFFERENT stage's gate can never authorize this one.
 * - Gate-scoped: only gates carrying `spendAuthorization === true` are consulted, so approving an
 *   unrelated (non-spend) gate on the SAME stage authorizes nothing.
 * - Kind-scoped: only an `approved` decision counts. `responded` (the `input`-gate outcome) does not,
 *   and the compiler already refuses `spendAuthorization` on any non-approval kind.
 *
 * Absent any declared spend gate the answer is `'none'` — the caller then passes no spend request at
 * all and `evaluateExecutionPolicy` behaves exactly as it did before this existed.
 */
function stageSpendAuthorization(
  detail: RunDetail,
  stage: Stage,
  proposalStage: ProposalStage,
): SpendAuthorizationState {
  return declaredGateAuthorization(detail, stage, proposalStage, (gate) => gate.spendAuthorization === true);
}

/**
 * Resolve the CONTENT-BOUND T3/publication authorization state of ONE stage, from its own compiled gates
 * and this run's own resolved human requests — the same three scoping properties as
 * {@link stageSpendAuthorization} (stage-scoped by title, gate-scoped by the declared flag, kind-scoped to
 * an `approved` approval), and the same fail-closed default of `'none'`.
 *
 * This is what gives a `publish:`/T3 stage a releasing path at all. Before it, a T3 stage recomputed
 * `t3-content-bound-approval-required` on every engine pass and re-parked forever, because nothing told
 * the server which human decision was the content-bound approval. A gate declaring
 * `publicationAuthorization` names exactly that decision, in a committed workflow definition a human
 * reviewed, and the boundary created for such a gate carries the stage's full work order (see
 * `gateBoundaryPrompt`) so the approver sees the prose they are authorizing — the standing constraint on
 * ever making the publication branch releasable.
 */
function stagePublicationAuthorization(
  detail: RunDetail,
  stage: Stage,
  proposalStage: ProposalStage,
): PublicationAuthorizationState {
  return declaredGateAuthorization(detail, stage, proposalStage, (gate) => gate.publicationAuthorization === true);
}

/** Shared resolution for the declared-gate authorizations: none / pending / approved, stage-scoped. */
function declaredGateAuthorization(
  detail: RunDetail,
  stage: Stage,
  proposalStage: ProposalStage,
  selects: (gate: ProposalStage['humanGates'][number]) => boolean,
): 'none' | 'pending' | 'approved' {
  const gates = proposalStage.humanGates.filter(selects);
  if (gates.length === 0) return 'none';
  const approved = gates.every((gate) => {
    const title = stableHumanTitle('gate', stage.stageId, gate.id);
    const request = detail.humanRequests.find((candidate) => candidate.stageRef === stage.stageRef && candidate.title === title);
    return request?.state === 'resolved' && request.kind === 'approval' && request.response?.decision === 'approved';
  });
  return approved ? 'approved' : 'pending';
}

/**
 * The prompt a declared gate's boundary carries. A gate that authorizes its stage's T3 publication must
 * show the operator the work order they are releasing — the reviewer must never approve prose they cannot
 * see. Bounded so a long work order cannot overflow the human-request prompt limit.
 */
export function gateBoundaryPrompt(gate: ProposalStage['humanGates'][number], proposalStage: ProposalStage): string {
  if (gate.publicationAuthorization !== true) return gate.prompt;
  const order = proposalStage.workOrder.replace(/\s+/g, ' ').trim().slice(0, 1_200);
  return `${gate.prompt}\n\nWork order this approval releases (stage '${proposalStage.id}', `
    + `${proposalStage.riskTier}, action ${proposalStage.action}):\n${order}`.slice(0, 2_000);
}

function getCurrentAttempt(detail: RunDetail, stage: Stage): Attempt | null {
  return stage.currentAttemptRef
    ? detail.attempts.find((attempt) => attempt.attemptRef === stage.currentAttemptRef) ?? null
    : null;
}

function effectiveWorkerRouting(
  detail: RunDetail,
  stage: Stage,
  proposalStage: ProposalStage,
): { runtime: string; model: string } {
  const attempt = getCurrentAttempt(detail, stage);
  return attempt ? { runtime: attempt.runtime, model: attempt.model } : proposalStage.worker;
}

function getSession(detail: RunDetail, sessionRef: string | null): ManagedSession | null {
  return sessionRef ? detail.sessions.find((session) => session.sessionRef === sessionRef) ?? null : null;
}

function acceptedBoundary(request: RunDetail['humanRequests'][number]): boolean {
  if (request.state !== 'resolved' || request.response === null || request.kind === 'governance-refusal') return false;
  if (request.kind === 'approval' || request.kind === 'review') return request.response.decision === 'approved';
  return request.response.decision === 'approved' || request.response.decision === 'responded';
}

function isGroupScopedIterationBoundary(
  detail: RunDetail,
  request: RunDetail['humanRequests'][number],
): boolean {
  return detail.iterationLoops.some((loop) => request.gateKind === 'iteration-park'
    ? loop.interventionRef === request.requestRef
    : loop.completionGateRef === request.requestRef);
}

function hasRunWideBlockingBoundary(detail: RunDetail): boolean {
  return detail.humanRequests.some((request) => !acceptedBoundary(request)
    && !isGroupScopedIterationBoundary(detail, request));
}

function hasGroupScopedIterationBoundary(detail: RunDetail): boolean {
  return detail.humanRequests.some((request) => !acceptedBoundary(request)
    && isGroupScopedIterationBoundary(detail, request));
}

export class AutomaticExecutionEngine {
  private readonly activeRuns = new Set<string>();
  private readonly cancellingRuns = new Set<string>();
  private activeWorkers = 0;
  private capacityWaiters: Array<() => void> = [];
  private readonly options: AutomaticExecutionOptions;

  constructor(options: AutomaticExecutionOptions) {
    this.options = options;
    requireSafeInteger(options.maxConcurrency, 'maxConcurrency', 1);
    if (options.defaultRunConcurrency !== undefined) {
      requireSafeInteger(options.defaultRunConcurrency, 'defaultRunConcurrency', 1);
      if (options.defaultRunConcurrency > options.maxConcurrency) {
        throw new AutomaticExecutionError('defaultRunConcurrency exceeds maxConcurrency');
      }
    }
    requireSafeInteger(options.budget.maxAttempts, 'budget.maxAttempts', 1);
    requireSafeInteger(options.budget.maxInputTokens, 'budget.maxInputTokens', 0);
    requireSafeInteger(options.budget.maxOutputTokens, 'budget.maxOutputTokens', 0);
    requireSafeInteger(options.budget.maxCostUsdMicros, 'budget.maxCostUsdMicros', 0);
    requireSafeInteger(options.attemptBudget.maxAttempts, 'attemptBudget.maxAttempts', 1);
    requireSafeInteger(options.attemptBudget.maxInputTokens, 'attemptBudget.maxInputTokens', 0);
    requireSafeInteger(options.attemptBudget.maxOutputTokens, 'attemptBudget.maxOutputTokens', 0);
    requireSafeInteger(options.attemptBudget.maxCostUsdMicros, 'attemptBudget.maxCostUsdMicros', 0);
    planRunWorktreePath(options.worktreeRoot, 'validation');
  }

  async runToBoundary(input: ExecuteRunInput): Promise<ExecutionOutcome> {
    const lockKey = `${input.subject}\0${input.runRef}`;
    if (this.activeRuns.has(lockKey)) throw new AutomaticExecutionError('run reconciliation is already active');
    this.activeRuns.add(lockKey);
    const startedStageIds: string[] = [];
    const completedStageIds: string[] = [];
    const waitingStageIds: string[] = [];
    // Every boundary/blocked return builds the identical accumulator triple around the run's current
    // lifecycle kind; this closure is that one object so the shape can never drift return-to-return.
    const blockedOutcome = (state: RunLifecycleKind): ExecutionOutcome =>
      ({ state, startedStageIds, completedStageIds, waitingStageIds });
    try {
      this.assertRunBinding(input);
      // Resolve only after the immutable run/proposal binding is proven. In particular, an arbitrary
      // browser-supplied proposal must never select a project policy loader before it is known to be the
      // exact approved graph attached to this run.
      const policy = this.resolveProjectPolicy(input.proposal.project);
      const resolvedAgents = this.resolveRunAssignments(input, policy);
      const initialIterationWait = await this.reconcileIterationRuntime(input);
      if (initialIterationWait.length > 0) {
        waitingStageIds.push(...initialIterationWait);
        if (hasRunWideBlockingBoundary(this.detail(input))) {
          return blockedOutcome(runLifecycleKind(this.detail(input).run.lifecycle));
        }
      }
      if (!(await this.ensureManager(input, policy, resolvedAgents.manager))) {
        return blockedOutcome(runLifecycleKind(this.detail(input).run.lifecycle));
      }
      // BigInt keeps every safe-integer declaration exact; no old fixed cap or lossy product can
      // truncate a valid high bound. Each compiled schedule step can consume one durable worker pass,
      // including groups produced by the isolated legacy-definition compiler mapping.
      const iterationPasses = this.detail(input).iterationLoops.reduce(
        (total, group) => total + BigInt(group.maxCycles) * BigInt(group.schedule.length),
        0n,
      );
      const reconciliationPasses = BigInt(input.proposal.stages.length + 1) + iterationPasses;
      for (let pass = 0n; pass <= reconciliationPasses; pass += 1n) {
        const detail = this.detail(input);
        if (this.cancellingRuns.has(lockKey)) {
          return blockedOutcome(runLifecycleKind(detail.run.lifecycle));
        }
        if (['succeeded', 'failed', 'stopped', 'stopping'].includes(runLifecycleKind(detail.run.lifecycle))) {
          return blockedOutcome(runLifecycleKind(detail.run.lifecycle));
        }
        if (runLifecycleKind(detail.run.lifecycle) === 'interrupted'
          && detail.humanRequests.some((request) => request.state === 'open')) {
          return blockedOutcome(runLifecycleKind(detail.run.lifecycle));
        }
        const iterationWait = await this.reconcileIterationRuntime(input);
        if (iterationWait.length > 0) {
          for (const stageId of iterationWait) if (!waitingStageIds.includes(stageId)) waitingStageIds.push(stageId);
          if (hasRunWideBlockingBoundary(this.detail(input))) {
            return blockedOutcome(runLifecycleKind(this.detail(input).run.lifecycle));
          }
        }
        this.releaseDependents(input, this.detail(input));
        await this.scheduleIterationTurns(input);
        const refreshed = this.detail(input);
        if (hasRunWideBlockingBoundary(refreshed)) {
          return blockedOutcome(runLifecycleKind(refreshed.run.lifecycle));
        }
        if (refreshed.stages.some((stage) => stage.state === 'failed' || stage.state === 'stopped')) {
          const state = runLifecycleKind(this.transitionRun(input, 'failed').lifecycle);
          return blockedOutcome(state);
        }
        const candidates: Array<{ stage: Stage; proposalStage: ProposalStage }> = [];
        for (const stage of [...refreshed.stages].sort((left, right) => left.stageId.localeCompare(right.stageId))) {
          if (stage.state !== 'ready' && stage.state !== 'interrupted' && stage.state !== 'waiting-human') continue;
          const proposalStage = stageById(input.proposal, stage.stageId);
          const boundary = this.stageBoundary(input, refreshed, stage, proposalStage, policy);
          if (boundary === 'waiting') {
            if (!waitingStageIds.includes(stage.stageId)) waitingStageIds.push(stage.stageId);
            if (hasRunWideBlockingBoundary(this.detail(input))) {
              return blockedOutcome(runLifecycleKind(this.detail(input).run.lifecycle));
            }
            continue;
          }
          if (boundary === 'refused') {
            if (!waitingStageIds.includes(stage.stageId)) waitingStageIds.push(stage.stageId);
            if (hasRunWideBlockingBoundary(this.detail(input))) {
              return blockedOutcome(runLifecycleKind(this.detail(input).run.lifecycle));
            }
            continue;
          }
          candidates.push({ stage: this.detail(input).stages.find((candidate) => candidate.stageRef === stage.stageRef) as Stage, proposalStage });
        }
        const runConcurrency = Math.min(
          this.options.maxConcurrency,
          input.proposal.maxConcurrency ?? this.options.defaultRunConcurrency ?? this.options.maxConcurrency,
        );
        const available = Math.min(runConcurrency, Math.max(0, this.options.maxConcurrency - this.activeWorkers));
        if (candidates.length > 0 && available === 0) {
          await this.waitForCapacity();
          pass -= 1n;
          continue;
        }
        const batch = candidates.slice(0, available);
        if (batch.length === 0) {
          const settled = await this.settleRunState(input);
          return blockedOutcome(runLifecycleKind(settled.lifecycle));
        }
        const prepared = batch
          .map(({ stage, proposalStage }) => this.prepareOrContain(
            input, stage, proposalStage, policy, resolvedAgents.stages.get(proposalStage.id) ?? null,
          ))
          .filter((item): item is NonNullable<typeof item> => item !== null);
        for (const item of prepared) if (!startedStageIds.includes(item.proposalStage.id)) startedStageIds.push(item.proposalStage.id);
        this.activeWorkers += prepared.length;
        let results: Awaited<ReturnType<AutomaticExecutionEngine['executeAttempt']>>[];
        try {
          results = await Promise.all(prepared.map((item) => this.executeAttempt(input, item, policy)));
        } finally {
          this.activeWorkers -= prepared.length;
          for (const wake of this.capacityWaiters.splice(0)) wake();
        }
        for (const result of results) {
          if (result.state === 'succeeded' && !completedStageIds.includes(result.stageId)) completedStageIds.push(result.stageId);
          if (result.state === 'waiting-human' && !waitingStageIds.includes(result.stageId)) waitingStageIds.push(result.stageId);
        }
        if (results.some((result) => result.state === 'waiting-human')
          && runLifecycleKind(this.detail(input).run.lifecycle) === 'waiting-human'
          && hasRunWideBlockingBoundary(this.detail(input))) {
          return blockedOutcome(runLifecycleKind(this.detail(input).run.lifecycle));
        }
      }
      throw new AutomaticExecutionError('DAG reconciliation exceeded its deterministic pass bound');
    } finally {
      this.activeRuns.delete(lockKey);
    }
  }

  /** Persist cancellation intent first, then stop every live adapter and converge the durable graph. */
  async cancelRun(input: CancelRunInput): Promise<CancellationOutcome> {
    const lockKey = `${input.subject}\0${input.runRef}`;
    if (this.cancellingRuns.has(lockKey)) throw new AutomaticExecutionError('run cancellation is already active');
    this.cancellingRuns.add(lockKey);
    try {
      let intent: ReturnType<ControlPlaneStore['requestRunCancellation']> | null = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const current = this.detail(input);
        intent = this.options.store.requestRunCancellation(input.subject, input.runRef, {
          expectedRunVersion: current.run.version,
          idempotencyKey: input.idempotencyKey,
          reason: input.reason,
        });
        if (intent.ok || intent.reason !== 'conflict') break;
      }
      if (!intent || !intent.ok) throw new AutomaticExecutionError(intent?.detail ?? 'cancellation intent could not be persisted');

      const beforeSignal = this.detail(input);
      const signalTargets = beforeSignal.sessions.filter((session) =>
        !['completed', 'failed', 'stopped', 'interrupted'].includes(session.state));
      const failures = new Set<string>();
      const stoppedSessionRefs: string[] = [];
      await Promise.all(signalTargets.map(async (session) => {
        try {
          const signal = {
            operationKey: `cancel:${input.idempotencyKey}:${session.sessionRef}`,
            subject: input.subject,
            runRef: input.runRef,
            sessionRef: session.sessionRef,
            attemptRef: session.attemptRef,
            intent: 'run-cancel' as const,
          };
          if (session.role === 'manager') await this.options.cancellation.cancelManager(signal);
          else if (session.attemptRef) {
            await this.options.cancellation.cancelWorker({
              ...signal,
              attemptRef: session.attemptRef,
              attemptOperationKey: session.attemptOperationKey ?? workerAttemptOperationKey(session.attemptRef),
            });
          }
          else throw new AutomaticExecutionError('worker session is missing its attempt reference');
          stoppedSessionRefs.push(session.sessionRef);
        } catch {
          failures.add(session.sessionRef);
        }
      }));

      let current = this.detail(input);
      const currentManager = current.sessions.find((session) => session.sessionRef === current.run.managerSessionRef);
      const currentWorkerRefs = new Set(current.stages.flatMap((stage) => {
        const attempt = getCurrentAttempt(current, stage);
        return attempt?.managedSessionRef ? [attempt.managedSessionRef] : [];
      }));
      const uncertain = new Set([...failures]);
      if (currentManager?.state === 'interrupted') uncertain.add(currentManager.sessionRef);
      for (const session of current.sessions) {
        if (currentWorkerRefs.has(session.sessionRef) && session.state === 'interrupted') uncertain.add(session.sessionRef);
        if (['completed', 'failed', 'stopped', 'interrupted'].includes(session.state)) continue;
        const target = failures.has(session.sessionRef) ? 'interrupted' : 'stopped';
        const transitioned = this.options.store.transitionSession(input.subject, session.sessionRef, session.version, target);
        if (!transitioned.ok) throw new AutomaticExecutionError(transitioned.detail);
      }

      current = this.detail(input);
      for (const attempt of current.attempts) {
        if (['succeeded', 'failed', 'stopped', 'interrupted'].includes(attempt.state)) continue;
        const target = attempt.managedSessionRef && uncertain.has(attempt.managedSessionRef) ? 'interrupted' : 'stopped';
        const transitioned = this.options.store.transitionAttempt(input.subject, attempt.attemptRef, attempt.version, target);
        if (!transitioned.ok) throw new AutomaticExecutionError(transitioned.detail);
      }

      current = this.detail(input);
      for (const stage of current.stages) {
        if (['succeeded', 'failed', 'stopped'].includes(stage.state)) continue;
        const attempt = getCurrentAttempt(current, stage);
        const target = attempt?.managedSessionRef && uncertain.has(attempt.managedSessionRef) ? 'interrupted' : 'stopped';
        const transitioned = this.options.store.transitionStage(input.subject, stage.stageRef, stage.version, target);
        if (!transitioned.ok) throw new AutomaticExecutionError(transitioned.detail);
      }

      current = this.detail(input);
      const finalState = uncertain.size > 0 ? 'interrupted' : 'stopped';
      if (runLifecycleKind(current.run.lifecycle) !== finalState) {
        const transitioned = this.options.store.transitionRun(input.subject, input.runRef, current.run.version, finalState);
        if (!transitioned.ok) throw new AutomaticExecutionError(transitioned.detail);
      }
      const final = this.detail(input);
      if (uncertain.size > 0 && !final.humanRequests.some((request) => request.state === 'open' && request.title === 'Automatic cancellation needs intervention')) {
        const request = this.options.store.createHumanRequest(input.subject, input.runRef, {
          kind: 'intervention', title: 'Automatic cancellation needs intervention',
          prompt: 'One or more managed adapters did not acknowledge cancellation. Their durable sessions are interrupted, not claimed stopped.',
        });
        if (!request.ok) throw new AutomaticExecutionError(request.detail);
      }
      return {
        state: finalState,
        stoppedSessionRefs: stoppedSessionRefs.sort(),
        interruptedSessionRefs: [...uncertain].sort(),
        replayed: intent.replayed === true,
      };
    } finally {
      this.cancellingRuns.delete(lockKey);
    }
  }

  private waitForCapacity(): Promise<void> {
    if (this.activeWorkers < this.options.maxConcurrency) return Promise.resolve();
    return new Promise((resolveWaiter) => this.capacityWaiters.push(resolveWaiter));
  }

  private detail(input: Pick<ExecuteRunInput, 'subject' | 'runRef'>): RunDetail {
    const result = this.options.store.getRun(input.subject, input.runRef);
    if (!result.ok) throw new AutomaticExecutionError(result.detail);
    return result.value;
  }

  private resolveProjectPolicy(project: string): PolicyEnvironment {
    const heldProject = this.options.policyProject ?? 'kb-ops';
    if (!SAFE_PROJECT.test(heldProject)) throw new AutomaticExecutionError('held policy project is unsafe');
    if (!this.options.resolvePolicy) {
      if (project !== heldProject) throw new AutomaticExecutionError('project policy resolver is required for this proposal project');
      return snapshotProjectPolicy(project, this.options.policy);
    }
    let resolved: PolicyEnvironment;
    try {
      resolved = this.options.resolvePolicy(project);
    } catch (error) {
      throw new AutomaticExecutionError(`project policy resolution failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    return snapshotProjectPolicy(project, resolved);
  }

  private assertRunBinding(input: ExecuteRunInput): void {
    const detail = this.detail(input);
    if (proposalContentHash(input.proposal) !== detail.run.proposalHash) {
      throw new AutomaticExecutionError('proposal does not match the immutable run hash');
    }
    if (input.proposal.stages.length !== detail.stages.length) throw new AutomaticExecutionError('run graph does not match proposal graph');
    if (!sameAssignment(detail.run.managerAssignment, input.proposal.manager.assignment ?? null)) {
      throw new AutomaticExecutionError('run manager assignment differs from the approved proposal');
    }
    const runStages = new Map(detail.stages.map((stage) => [stage.stageId, stage]));
    for (const stage of input.proposal.stages) {
      const stored = runStages.get(stage.id);
      if (!stored || JSON.stringify([...stored.dependsOn].sort()) !== JSON.stringify([...stage.dependsOn].sort())) {
        throw new AutomaticExecutionError(`run graph differs at stage '${stage.id}'`);
      }
      if (!stored.canonicalCardRef) throw new AutomaticExecutionError(`stage '${stage.id}' lacks a canonical card link`);
      if (!sameAssignment(stored.assignment, stage.assignment ?? null)) {
        throw new AutomaticExecutionError(`run assignment differs at stage '${stage.id}'`);
      }
    }
  }

  private resolveAssignedAgent(
    input: ExecuteRunInput,
    assignment: ResolvedAgentAssignment | null,
    role: 'manager' | 'worker',
    policy: PolicyEnvironment,
  ): ResolvedAssignedAgent | null {
    if (assignment === null) return null;
    if (!this.options.assignedAgents) throw new AutomaticExecutionError('assigned run requires a server-owned agent resolver');
    try {
      return this.options.assignedAgents.resolve({ assignment, role, project: input.proposal.project, profiles: policy.profiles });
    } catch (error) {
      throw new AutomaticExecutionError(`assigned agent resolution failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Resolve every assignment once per invocation before any policy boundary or durable mutation. */
  private resolveRunAssignments(
    input: ExecuteRunInput,
    policy: PolicyEnvironment,
  ): { manager: ResolvedAssignedAgent | null; stages: ReadonlyMap<string, ResolvedAssignedAgent | null> } {
    const stages = new Map<string, ResolvedAssignedAgent | null>();
    const manager = this.resolveAssignedAgent(input, input.proposal.manager.assignment ?? null, 'manager', policy);
    for (const stage of input.proposal.stages) {
      stages.set(stage.id, this.resolveAssignedAgent(input, stage.assignment ?? null, 'worker', policy));
    }
    return { manager, stages };
  }

  private async ensureManager(
    input: ExecuteRunInput,
    policy: PolicyEnvironment,
    assignedAgent: ResolvedAssignedAgent | null,
  ): Promise<boolean> {
    let detail = this.detail(input);
    if (['waiting-human', 'interrupted'].includes(runLifecycleKind(detail.run.lifecycle))
      && hasRunWideBlockingBoundary(detail)) {
      return false;
    }
    const requested = input.proposal.manager;
    const profile = profileFor(policy, 'manager', requested.runtime, requested.model);
    if (!profile) throw new AutomaticExecutionError('manager is not a server-owned runtime profile');
    if (requested.requiredSkills.some((skill) => !policy.curatedSkills.has(skill))) {
      throw new AutomaticExecutionError('manager requested a non-curated skill');
    }
    let manager = getSession(detail, detail.run.managerSessionRef);
    if (!manager) throw new AutomaticExecutionError('manager session is missing');
    if (manager.runtime !== profile.runtime || manager.model !== profile.model) {
      throw new AutomaticExecutionError('stored manager routing differs from the approved server profile');
    }
    if (manager.state === 'interrupted' || manager.state === 'failed' || manager.state === 'stopped' || manager.state === 'completed') {
      const successor = this.options.store.createManagerSuccessor(input.subject, input.runRef, {
        expectedManagerGeneration: detail.run.managerGeneration,
        runtime: profile.runtime,
        model: profile.model,
        idempotencyKey: `automatic-manager:${input.runRef}:${detail.run.managerGeneration + 1}`,
      });
      if (!successor.ok) throw new AutomaticExecutionError(successor.detail);
      manager = successor.value;
      detail = this.detail(input);
    }
    if (manager.state === 'pending') manager = this.transitionSession(input, manager.sessionRef, 'starting');
    if (manager.state === 'starting' || manager.state === 'running') {
      const managerSessionRef = manager.sessionRef;
      try {
        await this.options.managers.ensure({
          operationKey: `automatic-manager-session:${managerSessionRef}`,
          subject: input.subject,
          runRef: input.runRef,
          sessionRef: managerSessionRef,
          generation: manager.generation,
          predecessorSessionRef: manager.predecessorSessionRef,
          proposalHash: detail.run.proposalHash,
          profile,
          ...(assignedAgent ? { assignment: assignedAgent.assignment, instructionMarkdown: assignedAgent.instructionMarkdown } : {}),
        });
        if (this.cancellationObserved(input)) return false;
        const refreshedManager = this.detail(input).sessions.find((session) => session.sessionRef === managerSessionRef);
        if (!refreshedManager || ['completed', 'failed', 'stopped', 'interrupted'].includes(refreshedManager.state)) {
          return false;
        }
        manager = refreshedManager;
        if (manager.state === 'starting') this.transitionSession(input, manager.sessionRef, 'running');
      } catch (error) {
        if (this.cancellationObserved(input)) return false;
        this.transitionSession(input, manager.sessionRef, 'interrupted');
        this.transitionRun(input, 'interrupted');
        const current = this.detail(input);
        const title = `automatic:manager:${manager.generation}`;
        if (!current.humanRequests.some((request) => request.stageRef === null && request.title === title && request.state === 'open')) {
          const request = this.options.store.createHumanRequest(input.subject, input.runRef, {
            kind: 'intervention',
            title,
            prompt: error instanceof Error ? error.message : 'manager adapter failed',
          });
          if (!request.ok) throw new AutomaticExecutionError(request.detail);
        }
        this.transitionRun(input, 'waiting-human');
        return false;
      }
    }
    detail = this.detail(input);
    const runKind = runLifecycleKind(detail.run.lifecycle);
    if (runKind === 'waiting-human' && hasRunWideBlockingBoundary(detail)) return false;
    if (runKind === 'planned' || runKind === 'interrupted' || runKind === 'recovering'
      || (runKind === 'waiting-human' && !hasGroupScopedIterationBoundary(detail))) {
      this.transitionRun(input, 'running');
    }
    input.onManagerStarted?.();
    return true;
  }

  /**
   * Contain only a Manager startup that failed before dispatcher acknowledgement. Unlike operator
   * cancellation, this preserves the run/stage graph so the same run can resume after intervention.
   */
  async containManagerStart(input: ContainManagerStartInput): Promise<void> {
    const detail = this.detail(input);
    const manager = detail.sessions.find((session) => session.sessionRef === detail.run.managerSessionRef);
    if (!manager || ['completed', 'failed', 'stopped', 'interrupted'].includes(manager.state)) return;
    // Fence the logical session before awaiting an adapter that may never acknowledge cancellation.
    // ensureManager re-reads this durable state after its own await and cannot revive a fenced session.
    const interrupted = this.options.store.transitionSession(
      input.subject,
      manager.sessionRef,
      manager.version,
      'interrupted',
    );
    if (!interrupted.ok) throw new AutomaticExecutionError(interrupted.detail);
    let cancellationError: unknown = null;
    try {
      await this.options.cancellation.cancelManager({
        operationKey: `contain-manager-start:${input.idempotencyKey}:${manager.sessionRef}`,
        subject: input.subject,
        runRef: input.runRef,
        sessionRef: manager.sessionRef,
        attemptRef: null,
        intent: 'run-cancel',
      });
    } catch (error) {
      cancellationError = error;
    }
    if (cancellationError) {
      throw new AutomaticExecutionError(
        cancellationError instanceof Error ? cancellationError.message : 'Manager startup cancellation failed',
      );
    }
  }

  private releaseDependents(input: ExecuteRunInput, detail: RunDetail): void {
    const byId = new Map(detail.stages.map((stage) => [stage.stageId, stage]));
    for (const stage of [...detail.stages].sort((left, right) => left.stageId.localeCompare(right.stageId))) {
      if (stage.state !== 'blocked') continue;
      const participantLoop = detail.iterationLoops.find((loop) => loop.participants.some((participant) => participant.stageRef === stage.stageId));
      if (participantLoop
        && (participantLoop.state !== 'awaiting-seed'
          || participantLoop.activation.seedParticipantId !== participantLoop.participants.find((participant) =>
            participant.stageRef === stage.stageId)?.participantId)) {
        continue;
      }
      if (stage.dependsOn.every((dependency) => {
        const dependencyStage = byId.get(dependency);
        if (dependencyStage?.state !== 'succeeded') return false;
        const dependencyLoop = detail.iterationLoops.find((loop) => loop.participants.some((participant) =>
          participant.stageRef === dependencyStage.stageId));
        return !dependencyLoop || dependencyLoop.state === 'passed';
      })) {
        const result = this.options.store.transitionStage(input.subject, stage.stageRef, stage.version, 'ready');
        if (!result.ok && result.reason !== 'conflict') throw new AutomaticExecutionError(result.detail);
      }
    }
  }

  private async scheduleIterationTurns(input: ExecuteRunInput): Promise<void> {
    for (const snapshot of this.detail(input).iterationLoops) {
      let detail = this.detail(input);
      const loop = detail.iterationLoops.find((candidate) => candidate.iterationLoopRef === snapshot.iterationLoopRef);
      if (!loop || (loop.state !== 'awaiting-turn' && loop.state !== 'rework-queued')) continue;
      const step = loop.currentStepId === undefined ? undefined : loop.schedule.find((candidate) => candidate.stepId === loop.currentStepId);
      const route = step && loop.routes.find((candidate) => candidate.routeId === step.routeId);
      if (!step || !route || route.recipientParticipantId !== loop.turnOwnerParticipantId
        || route.requestKinds.length < 1 || route.baseResolutionStageIds.length < 1) {
        throw new AutomaticExecutionError(`iteration group '${loop.iterationGroupId}' has no schedulable declared route`);
      }
      if (!this.options.results.resolveBase) {
        throw new AutomaticExecutionError('result integrator cannot resolve committed iteration lineage');
      }
      const dependencyResultOperationKeys = this.dependencyResultOperationKeys(detail, route.baseResolutionStageIds, loop.iterationLoopRef);
      const baseCommit = await this.options.results.resolveBase({
        operationKey: `iteration-base:${loop.iterationLoopRef}:${step.stepId}:turn${detail.iterationRequests.filter((request) =>
          request.iterationLoopRef === loop.iterationLoopRef).length + 1}`,
        subject: input.subject, runRef: input.runRef,
        stageId: loop.participants.find((participant) => participant.participantId === route.recipientParticipantId)!.stageRef,
        dependencyStageIds: [...route.baseResolutionStageIds], dependencyResultOperationKeys,
      });
      if (!baseCommit) {
        detail = this.detail(input);
        const current = detail.iterationLoops.find((candidate) => candidate.iterationLoopRef === loop.iterationLoopRef);
        const participant = current?.participants.find((candidate) => candidate.participantId === route.recipientParticipantId);
        const stage = participant && detail.stages.find((candidate) => candidate.stageId === participant.stageRef);
        if (!current || !stage || current.currentStepId !== step.stepId) {
          throw new AutomaticExecutionError('iteration turn changed during base resolution');
        }
        this.createBoundary(
          input,
          stage,
          'intervention',
          stableHumanTitle('execution', stage.stageId, 'iteration-base-resolution'),
          'committed iteration dependency lineage is unavailable',
        );
        const contained = this.detail(input);
        const currentStage = contained.stages.find((candidate) => candidate.stageRef === stage.stageRef) as Stage;
        const attempt = getCurrentAttempt(contained, currentStage);
        const session = getSession(contained, attempt?.managedSessionRef ?? null);
        if (attempt && ['queued', 'starting', 'running'].includes(attempt.state)) {
          this.transitionAttempt(input, attempt.attemptRef, 'interrupted');
        }
        if (session && ['pending', 'starting', 'running'].includes(session.state)) {
          this.transitionSession(input, session.sessionRef, 'interrupted');
        }
        return;
      }
      detail = this.detail(input);
      const currentLoop = detail.iterationLoops.find((candidate) => candidate.iterationLoopRef === loop.iterationLoopRef);
      if (!currentLoop || (currentLoop.state !== 'awaiting-turn' && currentLoop.state !== 'rework-queued')
        || currentLoop.currentStepId !== step.stepId) {
        throw new AutomaticExecutionError('iteration turn changed during base resolution');
      }
      const artifactHashes: Record<string, string> = {};
      const lookedUp = new Map<string, CanonicalStageResult>();
      for (const artifactId of currentLoop.artifacts) {
        const owner = input.proposal.stages.find((candidate) => candidate.artifacts.some((artifact) => artifact.id === artifactId));
        const artifact = owner?.artifacts.find((candidate) => candidate.id === artifactId);
        if (!owner || !artifact) throw new AutomaticExecutionError(`iteration artifact '${artifactId}' is absent from the approved stages`);
        let generation = currentLoop.activeGenerationRefs.map((ref) => detail.stageGenerations.find((candidate) =>
          candidate.generationRef === ref)).find((candidate) => candidate?.logicalStageId === owner.id);
        if (generation?.state === 'queued' && generation.predecessorGenerationRef !== null) {
          generation = detail.stageGenerations.find((candidate) => candidate.generationRef === generation?.predecessorGenerationRef);
        }
        if (!generation || generation.state !== 'committed') {
          throw new AutomaticExecutionError(`iteration artifact '${artifactId}' lacks a committed current generation`);
        }
        const operationKey = generation.canonicalResultOperationKey;
        if (!operationKey) throw new AutomaticExecutionError(`iteration artifact '${artifactId}' lacks a canonical result identity`);
        let result = lookedUp.get(operationKey);
        if (!result) {
          result = await this.options.results.lookup({ operationKey, subject: input.subject, runRef: input.runRef, stageId: owner.id }) ?? undefined;
          if (!result) throw new AutomaticExecutionError(`iteration artifact '${artifactId}' lacks a canonical result`);
          lookedUp.set(operationKey, result);
        }
        const output = result.artifacts.find((candidate) => candidate.path === artifact.path);
        if (!output) throw new AutomaticExecutionError(`iteration artifact '${artifactId}' lacks its pinned hash`);
        artifactHashes[artifactId] = output.digest;
      }
      const resolved = new Set(detail.iterationReceipts.flatMap((receipt) => receipt.resolvedFindingRefs ?? []));
      const unresolvedFindingRefs = detail.iterationReceipts
        .filter((receipt) => receipt.iterationLoopRef === currentLoop.iterationLoopRef)
        .flatMap((receipt) => receipt.findings.map((finding) => finding.findingId))
        .filter((findingRef, index, values) => !resolved.has(findingRef) && values.indexOf(findingRef) === index)
        .sort();
      const turn = detail.iterationRequests.filter((request) => request.iterationLoopRef === currentLoop.iterationLoopRef).length + 1;
      const recorded = this.options.store.recordIterationRequest(input.subject, currentLoop.iterationLoopRef, {
        expectedLoopVersion: currentLoop.version, routeId: route.routeId, kind: route.requestKinds[0],
        inputGenerationRefs: [...currentLoop.activeGenerationRefs], baseCommit, artifactHashes,
        unresolvedFindingRefs, preservedInvariants: currentLoop.criteria.map((criterion) => criterion.id),
        nextAcceptanceCheck: currentLoop.goal ?? `Apply ${currentLoop.criteria.map((criterion) => criterion.id).join(', ')}.`,
        instructions: `Execute declared route '${route.routeId}' at schedule step '${step.stepId}'.`,
        operationKey: `iteration-request:${currentLoop.iterationLoopRef}:${step.stepId}:turn${turn}`,
      });
      if (!recorded.ok) throw new AutomaticExecutionError(recorded.detail);
    }
  }

  private iterationRequestForStage(
    detail: RunDetail,
    stage: Stage,
    activeOnly = false,
  ): RunDetail['iterationRequests'][number] | undefined {
    const loop = detail.iterationLoops.find((candidate) => candidate.state !== 'awaiting-seed'
      && candidate.participants.some((participant) => participant.stageRef === stage.stageId));
    const participant = loop?.participants.find((candidate) => candidate.stageRef === stage.stageId);
    if (!loop || !participant) return undefined;
    const requests = detail.iterationRequests.filter((request) => request.iterationLoopRef === loop.iterationLoopRef
      && request.recipientParticipantId === participant.participantId);
    const active = [...requests].reverse().find((request) =>
      !detail.iterationReceipts.some((receipt) => receipt.requestRef === request.requestRef));
    return activeOnly ? active : active ?? requests.at(-1);
  }

  private iterationContractForStage(
    input: ExecuteRunInput,
    detail: RunDetail,
    stage: Stage,
  ): IterationOutcomeContract | undefined {
    const request = this.iterationRequestForStage(detail, stage);
    if (!request) return undefined;
    const loop = detail.iterationLoops.find((candidate) => candidate.iterationLoopRef === request.iterationLoopRef);
    const iterationGroup = loop && input.proposal.iterationGroups?.find((candidate) =>
      candidate.iterationGroupId === loop.iterationGroupId);
    if (!loop || !iterationGroup) {
      throw new AutomaticExecutionError(`iteration participant '${stage.stageId}' lacks its durable turn contract`);
    }
    const currentPositions = new Map<string, RunDetail['iterationReceipts'][number]['positions'][number]>();
    detail.iterationReceipts.filter((receipt) => receipt.iterationLoopRef === loop.iterationLoopRef)
      .flatMap((receipt) => receipt.positions).forEach((position) => currentPositions.set(position.positionId, position));
    return { iterationGroup, request, currentPositions: [...currentPositions.values()] };
  }

  private resultOperationKey(
    detail: RunDetail,
    stage: Stage,
    attempt: Attempt | null,
    iterationContract?: IterationOutcomeContract,
  ): string {
    const request = iterationContract?.request ?? this.iterationRequestForStage(detail, stage);
    return request
      ? iterationResultOperationKey(detail.run.runRef, stage.stageId, request.requestRef)
      : canonicalResultOperationKey(detail.run.runRef, stage.stageId, attempt?.logicalGeneration ?? stage.currentGeneration);
  }

  private async lookupCanonicalResult(
    input: ExecuteRunInput,
    stage: Stage,
    attempt: Attempt | null,
    iterationContract?: IterationOutcomeContract,
  ): Promise<CanonicalStageResult | null> {
    return this.options.results.lookup({
      operationKey: this.resultOperationKey(this.detail(input), stage, attempt, iterationContract),
      subject: input.subject, runRef: input.runRef, stageId: stage.stageId,
    });
  }

  private isIterationOwned(detail: RunDetail, stage: Stage): boolean {
    return detail.iterationLoops.some((loop) => {
      const participant = loop.participants.find((candidate) => candidate.stageRef === stage.stageId);
      if (!participant) return false;
      if (loop.state === 'awaiting-seed') return participant.participantId === loop.activation.seedParticipantId;
      return loop.state === 'running-turn' && loop.turnOwnerParticipantId === participant.participantId;
    });
  }

  private dependencyResultOperationKeys(
    detail: RunDetail,
    dependencyStageIds: readonly string[],
    iterationLoopRef?: string,
  ): Array<{ stageId: string; operationKey: string }> {
    return dependencyStageIds.map((stageId) => {
      const dependency = detail.stages.find((stage) => stage.stageId === stageId);
      if (!dependency) throw new AutomaticExecutionError(`dependency '${stageId}' disappeared from the run`);
      const iterationLoop = iterationLoopRef === undefined
        ? detail.iterationLoops.find((loop) => loop.participants.some((participant) => participant.stageRef === stageId))
        : detail.iterationLoops.find((loop) => loop.iterationLoopRef === iterationLoopRef);
      const iterationParticipant = iterationLoop?.participants.find((participant) => participant.stageRef === stageId);
      if (iterationLoop && iterationParticipant) {
        const pinnedRefs = iterationLoop.state === 'passed'
          ? iterationLoop.acceptedGenerationRefs ?? [] : iterationLoop.activeGenerationRefs;
        const generation = pinnedRefs.map((ref) => detail.stageGenerations.find((candidate) => candidate.generationRef === ref))
          .find((candidate) => candidate?.logicalStageId === stageId && candidate.state === 'committed');
        if (generation?.canonicalResultOperationKey) {
          return { stageId, operationKey: generation.canonicalResultOperationKey };
        }
        const receipts = detail.iterationReceipts.filter((receipt) => receipt.iterationLoopRef === iterationLoop.iterationLoopRef
          && receipt.participantId === iterationParticipant.participantId);
        const latest = receipts.at(-1);
        if (latest) {
          const request = detail.iterationRequests.find((candidate) => candidate.requestRef === latest.requestRef);
          if (request) return { stageId, operationKey: iterationResultOperationKey(detail.run.runRef, stageId, request.requestRef) };
        }
        throw new AutomaticExecutionError(`dependency '${stageId}' lacks its current pinned generation`);
      }
      return { stageId, operationKey: canonicalResultOperationKey(detail.run.runRef, stageId, dependency.currentGeneration) };
    });
  }

  /**
   * Complete store transitions after canonical integration in the only order accepted by the durable
   * iteration state machine. It is intentionally reusable by normal execution and restart recovery.
   */
  private async finalizeCanonicalSuccess(
    input: ExecuteRunInput,
    proposalStage: ProposalStage,
    stageRef: string,
    attemptRef: string,
    sessionRef: string,
    integrated: CanonicalStageResult,
  ): Promise<'succeeded' | 'waiting-human'> {
    let detail = this.detail(input);
    let stage = detail.stages.find((item) => item.stageRef === stageRef);
    let attempt = detail.attempts.find((item) => item.attemptRef === attemptRef);
    if (!stage || !attempt) throw new AutomaticExecutionError('canonical result lineage disappeared');
    const iterationLoop = detail.iterationLoops.find((loop) =>
      loop.participants.some((participant) => participant.stageRef === stage?.stageId));
    if (iterationLoop && !hasImmutableLineage(integrated)) {
      throw new AutomaticExecutionError('iteration canonical result lacks immutable lineage');
    }

    this.transitionSession(input, sessionRef, 'completed');
    attempt = this.transitionAttempt(input, attemptRef, 'succeeded');

    if (iterationLoop && (iterationLoop.state === 'awaiting-seed' || integrated.iterationOutcome?.verdict === 'fulfilled')) {
      if (integrated.durability !== 'canonical') throw new AutomaticExecutionError('iteration producer result lacks immutable lineage');
      const generation = integrated.iterationOutcome?.verdict === 'fulfilled'
        ? attempt.logicalGeneration : stage.currentGeneration;
      if (generation === null) throw new AutomaticExecutionError('iteration producer attempt lacks a logical generation');
      const operationKey = this.resultOperationKey(this.detail(input), stage, attempt);
      const recorded = this.detail(input).stageGenerations.find((item) => item.canonicalResultOperationKey === operationKey);
      if (recorded) {
        if (recorded.resultHash !== integrated.resultHash || recorded.attemptRef !== attemptRef
          || recorded.baseCommit !== integrated.attemptBaseCommit || recorded.canonicalCommit !== integrated.integrationCommit) {
          throw new AutomaticExecutionError('committed creator generation differs from the canonical result');
        }
      } else {
        const saved = this.options.store.recordStageGeneration(input.subject, stageRef, {
          expectedStageVersion: this.detail(input).stages.find((item) => item.stageRef === stageRef)?.version as number,
          expectedAttemptVersion: attempt.version,
          expectedGeneration: generation,
          operationKey,
          resultHash: integrated.resultHash,
          resultCardRef: integrated.iterationOutcome ? null : generation === 1 ? stage.canonicalCardRef : null,
          baseCommit: integrated.attemptBaseCommit,
          canonicalCommit: integrated.integrationCommit,
        });
        if (!saved.ok) throw new AutomaticExecutionError(saved.detail);
      }
    }

    this.transitionStageByRef(input, stageRef, 'succeeded');
    if (iterationLoop) {
      detail = this.detail(input);
      const currentLoop = detail.iterationLoops.find((loop) => loop.iterationLoopRef === iterationLoop.iterationLoopRef);
      stage = detail.stages.find((item) => item.stageRef === stageRef) as Stage;
      attempt = detail.attempts.find((item) => item.attemptRef === attemptRef) as Attempt;
      if (!currentLoop) throw new AutomaticExecutionError('iteration loop disappeared after canonical integration');
      if (currentLoop.state === 'awaiting-seed') {
        const seed = currentLoop.participants.find((participant) => participant.participantId === currentLoop.activation.seedParticipantId);
        const generation = detail.stageGenerations.find((candidate) => candidate.attemptRef === attemptRef && candidate.state === 'committed');
        const expectedArtifacts = currentLoop.activation.seedArtifactIds.map((artifactId) => {
          const artifact = proposalStage.artifacts.find((candidate) => candidate.id === artifactId);
          if (!artifact) throw new AutomaticExecutionError(`seed artifact '${artifactId}' is absent from its approved stage`);
          return artifact;
        });
        if (!seed || seed.stageRef !== stage.stageId || !generation
          || JSON.stringify(expectedArtifacts.map((artifact) => artifact.path).sort())
            !== JSON.stringify(integrated.artifacts.map((artifact) => artifact.path).sort())) {
          throw new AutomaticExecutionError('seed canonical result does not contain the exact activation artifact set');
        }
        const activated = this.options.store.activateIterationLoop(input.subject, currentLoop.iterationLoopRef, {
          expectedLoopVersion: currentLoop.version,
          seedGenerationRefs: [generation.generationRef],
          artifactGenerationRefs: Object.fromEntries(expectedArtifacts.map((artifact) => [artifact.id, generation.generationRef])),
          operationKey: `iteration-activate:${input.runRef}:${currentLoop.iterationGroupId}:c1`,
          ...(() => {
            const initialStep = currentLoop.schedule.find((candidate) => candidate.stepId === currentLoop.initialStepId);
            const initialRoute = initialStep && currentLoop.routes.find((candidate) => candidate.routeId === initialStep.routeId);
            const producerTurn = initialRoute?.requestKinds.some((kind) => ARTIFACT_PRODUCING_REQUEST_KINDS.has(kind));
            const participant = producerTurn && currentLoop.participants.find((candidate) =>
              candidate.participantId === initialRoute?.recipientParticipantId);
            const routedStage = participant && input.proposal.stages.find((candidate) => candidate.id === participant.stageRef);
            return routedStage ? { successorRuntime: routedStage.worker.runtime, successorModel: routedStage.worker.model } : {};
          })(),
        });
        if (!activated.ok) throw new AutomaticExecutionError(activated.detail);
        return 'succeeded';
      }
      const request = integrated.iterationOutcome === undefined ? undefined
        : detail.iterationRequests.find((candidate) => candidate.iterationLoopRef === currentLoop.iterationLoopRef
          && candidate.requestRef === integrated.iterationOutcome?.requestRef);
      if (!request || !integrated.iterationOutcome) {
        throw new AutomaticExecutionError('iteration turn lacks its durable request or validated outcome');
      }
      const outputGenerations = integrated.iterationOutcome.verdict === 'fulfilled'
        ? detail.stageGenerations.filter((generation) => generation.attemptRef === attemptRef && generation.state === 'committed')
        : [];
      // The worker base can include sibling integrations. It remains request provenance, but the
      // receipt lineage belongs to the first still-active generation pinned by durable ref.
      const activeGenerationRefs = new Set(currentLoop.activeGenerationRefs);
      const inputGenerationRef = request.inputGenerationRefs.find((ref) => activeGenerationRefs.has(ref));
      const inputGeneration = inputGenerationRef === undefined ? undefined : detail.stageGenerations.find((generation) =>
        generation.generationRef === inputGenerationRef && generation.state === 'committed');
      const receiptBase = integrated.iterationOutcome.verdict === 'fulfilled'
        ? integrated.attemptBaseCommit : inputGeneration?.baseCommit;
      const receiptCommit = integrated.iterationOutcome.verdict === 'fulfilled'
        ? integrated.integrationCommit : inputGeneration?.canonicalCommit;
      if (!receiptBase || !receiptCommit) throw new AutomaticExecutionError('iteration receipt lineage is incomplete');
      const saved = this.options.store.recordIterationReceipt(input.subject, currentLoop.iterationLoopRef, {
        expectedLoopVersion: currentLoop.version, requestRef: request.requestRef,
        outcome: integrated.iterationOutcome, outputGenerationRefs: outputGenerations.map((generation) => generation.generationRef),
        baseCommit: receiptBase, canonicalCommit: receiptCommit, participantAttemptRef: attemptRef,
        operationKey: `iteration-receipt:${request.requestRef}`,
      });
      if (!saved.ok) throw new AutomaticExecutionError(saved.detail);
      return this.routeIterationReceipt(input, saved.value);
    }
    return 'succeeded';
  }

  /** Finish the post-receipt half of a generic turn without replaying its worker or canonical integration. */
  private routeIterationReceipt(
    input: ExecuteRunInput,
    receipt: RunDetail['iterationReceipts'][number],
  ): 'succeeded' | 'waiting-human' {
    const detail = this.detail(input);
    const routedLoop = detail.iterationLoops.find((loop) => loop.iterationLoopRef === receipt.iterationLoopRef);
    const request = detail.iterationRequests.find((candidate) => candidate.requestRef === receipt.requestRef);
    if (!routedLoop || !request || request.iterationLoopRef !== routedLoop.iterationLoopRef
      || routedLoop.lastReceiptRef !== receipt.receiptRef) {
      throw new AutomaticExecutionError('iteration receipt reconciliation lineage is incomplete');
    }
    if (routedLoop.state === 'passed') return 'succeeded';
    if (routedLoop.state === 'awaiting-completion-gate' || routedLoop.state === 'awaiting-park-gate'
      || routedLoop.state === 'parked' || routedLoop.state === 'exhausted') {
      this.transitionRun(input, 'waiting-human');
      return 'waiting-human';
    }
    // A prior reconciliation already committed the declared successor. Do not submit the same
    // transition with a new expected version: its store fingerprint intentionally includes that CAS.
    if (routedLoop.state === 'awaiting-turn' || routedLoop.state === 'rework-queued') return 'succeeded';
    if (routedLoop.state !== 'failed') {
      throw new AutomaticExecutionError('iteration receipt is not in a reconcilable transient state');
    }
    const nextStep = routedLoop.schedule.find((candidate) => candidate.after !== undefined
      && candidate.after.stepId === request.stepId
      && candidate.after.participantId === receipt.participantId && candidate.after.verdict === receipt.verdict);
    const nextRoute = nextStep && routedLoop.routes.find((candidate) => candidate.routeId === nextStep.routeId);
    const nextParticipant = nextRoute && routedLoop.participants.find((candidate) => candidate.participantId === nextRoute.recipientParticipantId);
    const nextStage = nextParticipant && input.proposal.stages.find((candidate) => candidate.id === nextParticipant.stageRef);
    if (!nextStep || !nextRoute || !nextStage) throw new AutomaticExecutionError('iteration receipt has no declared successor');
    const nextCycle = nextStep.cycle === 'next' ? receipt.cycle + 1 : receipt.cycle;
    if (nextCycle > routedLoop.maxCycles) {
      const parked = this.options.store.parkIterationLoop(input.subject, routedLoop.iterationLoopRef, {
        expectedLoopVersion: routedLoop.version,
        expectedReceiptRef: receipt.receiptRef,
        expectedActiveGenerationRefs: [...routedLoop.activeGenerationRefs],
        reason: 'exhausted',
        nextRouteId: nextRoute.routeId,
        operationKey: `iteration-park:${receipt.receiptRef}:exhausted`,
      });
      if (!parked.ok) throw new AutomaticExecutionError(parked.detail);
      this.transitionRun(input, 'waiting-human');
      return 'waiting-human';
    }
    const advanced = this.options.store.advanceIterationTurn(input.subject, routedLoop.iterationLoopRef, {
      expectedLoopVersion: routedLoop.version, expectedReceiptRef: receipt.receiptRef,
      expectedActiveGenerationRefs: [...routedLoop.activeGenerationRefs], nextStepId: nextStep.stepId,
      operationKey: `iteration-advance:${receipt.receiptRef}:${nextStep.stepId}`,
      successorRuntime: nextStage.worker.runtime, successorModel: nextStage.worker.model,
    });
    if (!advanced.ok) throw new AutomaticExecutionError(advanced.detail);
    return 'succeeded';
  }

  /** Replay generic receipt and integration seams before considering runnable stages after a restart. */
  private async reconcileIterationRuntime(input: ExecuteRunInput): Promise<string[]> {
    const waiting: string[] = [];
    let detail = this.detail(input);
    for (const loop of detail.iterationLoops) {
      if (loop.state !== 'failed' || loop.lastReceiptRef === undefined) continue;
      const receipt = detail.iterationReceipts.find((candidate) => candidate.receiptRef === loop.lastReceiptRef);
      if (!receipt) throw new AutomaticExecutionError('transient failed iteration loop lacks its canonical receipt');
      const outcome = this.routeIterationReceipt(input, receipt);
      if (outcome === 'waiting-human') {
        const participant = loop.participants.find((candidate) => candidate.participantId === receipt.participantId);
        if (participant && !waiting.includes(participant.stageRef)) waiting.push(participant.stageRef);
      }
    }
    detail = this.detail(input);
    for (const stage of detail.stages) {
      if (!this.isIterationOwned(detail, stage)) continue;
      const attempt = getCurrentAttempt(detail, stage);
      if (!attempt?.managedSessionRef) continue;
      // Adapter exceptions are durably contained as interrupted; the normal preparation path creates
      // its successor, which then replays this same canonical result without a second worker run.
      if (attempt.state === 'interrupted') continue;
      const proposalStage = stageById(input.proposal, stage.stageId);
      const iterationContract = this.iterationContractForStage(input, detail, stage);
      const result = await this.lookupCanonicalResult(input, stage, attempt, iterationContract);
      if (!result) continue;
      if (canonicalStageResultHash(result) !== result.resultHash || !resultIsSafe(proposalStage, {
        state: 'succeeded', summary: result.summary, usage: { inputTokens: 0, outputTokens: 0, costUsdMicros: 0 },
        artifacts: [...result.artifacts], checkpoints: [...result.checkpoints],
        ...(result.iterationOutcome ? { iterationOutcome: result.iterationOutcome } : {}),
      }, { changed: result.changed }, iterationContract)) {
        throw new AutomaticExecutionError('persisted canonical iteration result failed reconciliation');
      }
      const outcome = await this.finalizeCanonicalSuccess(input, proposalStage, stage.stageRef, attempt.attemptRef, attempt.managedSessionRef, result);
      await this.cleanupAttemptWorktree(
        input,
        stage,
        attempt,
        planAttemptWorktreePath(this.options.worktreeRoot, input.runRef, attempt.attemptRef),
      );
      if (outcome === 'waiting-human') waiting.push(stage.stageId);
    }
    return waiting;
  }

  private stageBoundary(
    input: ExecuteRunInput,
    detail: RunDetail,
    stage: Stage,
    proposalStage: ProposalStage,
    policy: PolicyEnvironment,
  ): 'allow' | 'waiting' | 'refused' {
    if (detail.humanRequests.some((request) => request.stageRef === stage.stageRef && request.state === 'open')) {
      this.ensureStageWaiting(input, stage.stageRef);
      return 'waiting';
    }
    for (const gate of proposalStage.humanGates) {
      const title = stableHumanTitle('gate', stage.stageId, gate.id);
      const existing = detail.humanRequests.find((request) => request.stageRef === stage.stageRef && request.title === title);
      if (!existing) {
        this.createBoundary(input, stage, gate.kind, title, gateBoundaryPrompt(gate, proposalStage));
        return 'waiting';
      }
      if (existing.state === 'open') {
        this.ensureStageWaiting(input, stage.stageRef);
        return 'waiting';
      }
      const accepted = gate.kind === 'approval' || gate.kind === 'review'
        ? existing.response?.decision === 'approved'
        : gate.kind === 'governance-refusal'
          ? false
          : existing.response?.decision === 'approved' || existing.response?.decision === 'responded';
      if (!accepted) {
        this.ensureStageWaiting(input, stage.stageRef);
        return 'refused';
      }
    }
    // The mechanical tail every policy rung below shares: mint the stage's policy boundary under its
    // stable title if absent (else re-park the stage), then return refused/waiting by disposition. Only
    // the tail folds — the gate/action-risk/restricted-intent/policy ladder above and the
    // capability-mismatch rung below keep their exact ordering and their own distinct bodies.
    const mintOrWaitPolicyBoundary = (reason: string, refuse: boolean): 'waiting' | 'refused' => {
      const title = stableHumanTitle('policy', stage.stageId, reason);
      if (!detail.humanRequests.some((request) => request.stageRef === stage.stageRef && request.title === title)) {
        this.createBoundary(input, stage, refuse ? 'governance-refusal' : 'approval', title, reason);
      } else {
        this.ensureStageWaiting(input, stage.stageRef);
      }
      return refuse ? 'refused' : 'waiting';
    };
    const actionClassification = classifyActionRisk(proposalStage.action);
    if (actionClassification.disposition === 'forbidden') {
      return mintOrWaitPolicyBoundary(actionClassification.reason, true);
    }
    // Resolved once and shared by the restricted-intent scan and the policy call below, so a stage cannot
    // clear one and park on the other.
    const publicationAuthorization = stagePublicationAuthorization(this.detail(input), stage, proposalStage);
    const restricted = restrictedIntent(proposalStage);
    // A stage whose declared publication gate is RECORDED APPROVED has already been through the exact
    // human decision the publication rule exists to force, with its work order shown in that boundary.
    // Every other restricted-intent disposition — credential and spending vocabulary, and publication
    // language on a stage that declared NO publication gate — is untouched and still parks or refuses.
    const restrictedReleased = restricted !== null
      && restricted.reason === 'external-publication-intent-requires-human-approval'
      && publicationAuthorization === 'approved';
    if (restricted && !restrictedReleased) {
      return mintOrWaitPolicyBoundary(restricted.reason, restricted.kind === 'refuse');
    }
    const routing = effectiveWorkerRouting(detail, stage, proposalStage);
    const iterationVerdictTurn = [...detail.iterationRequests].reverse().some((request) => {
      if (ARTIFACT_PRODUCING_REQUEST_KINDS.has(request.kind)
        || detail.iterationReceipts.some((receipt) => receipt.requestRef === request.requestRef)) return false;
      const loop = detail.iterationLoops.find((candidate) => candidate.iterationLoopRef === request.iterationLoopRef);
      return loop?.participants.some((participant) => participant.participantId === request.recipientParticipantId
        && participant.stageRef === stage.stageId) === true;
    });
    // A stage that declares a spend-authorization gate IS a spending stage: it is submitted to policy
    // as one, and it clears only on that gate's own recorded approval. Declaring the gate therefore
    // never widens anything — it adds a blocking boundary and then returns the stage to the same
    // envelope it would have had with no declaration at all.
    const spendAuthorization = stageSpendAuthorization(this.detail(input), stage, proposalStage);
    const decision = evaluateExecutionPolicy({
      project: input.proposal.project,
      riskTier: proposalStage.riskTier,
      role: 'worker',
      runtime: routing.runtime as 'claude' | 'codex',
      model: routing.model,
      target: proposalStage.target,
      requiredSkills: proposalStage.requiredSkills,
      scope: policyScopeForStage(proposalStage.scope, Boolean(proposalStage.review) || iterationVerdictTurn),
      governanceRefs: input.proposal.governanceRefs,
      proposalHash: this.detail(input).run.proposalHash,
      approvedHash: this.detail(input).run.proposalHash,
      ...(spendAuthorization === 'none' ? {} : { requestsSpending: true, spendAuthorization }),
      // Symmetric to spend: declaring a publication gate SUBMITS the stage as a publishing stage and
      // clears only on that gate's own recorded approval. Declaring it therefore never widens anything.
      ...(publicationAuthorization === 'none' ? {} : { requestsPublication: true, publicationAuthorization }),
    }, policy);
    if (decision.disposition !== 'allow') {
      return mintOrWaitPolicyBoundary(decision.reason, decision.disposition === 'refuse');
    }
    if (!decision.profile || REQUIRED_WORKER_CAPABILITIES.some((capability) => !decision.profile?.capabilities.includes(capability))) {
      const title = stableHumanTitle('policy', stage.stageId, 'profile-capability-mismatch');
      if (!detail.humanRequests.some((request) => request.stageRef === stage.stageRef && request.title === title)) {
        this.createBoundary(input, stage, 'governance-refusal', title, 'server-owned worker profile lacks required automatic capabilities');
      }
      return 'refused';
    }
    if (stage.state === 'waiting-human' || stage.state === 'interrupted') {
      const latest = this.detail(input).stages.find((candidate) => candidate.stageRef === stage.stageRef) as Stage;
      const transitioned = this.options.store.transitionStage(input.subject, latest.stageRef, latest.version, 'ready');
      if (!transitioned.ok) throw new AutomaticExecutionError(transitioned.detail);
    }
    return 'allow';
  }

  private createBoundary(
    input: ExecuteRunInput,
    stage: Stage,
    kind: 'input' | 'approval' | 'review' | 'intervention' | 'governance-refusal',
    title: string,
    prompt: string,
  ): void {
    const created = this.options.store.createHumanRequest(input.subject, input.runRef, {
      stageRef: stage.stageRef,
      kind,
      title,
      prompt,
    });
    if (!created.ok) throw new AutomaticExecutionError(created.detail);
    this.ensureStageWaiting(input, stage.stageRef);
    this.transitionRun(input, 'waiting-human');
  }

  private ensureStageWaiting(input: ExecuteRunInput, stageRef: string): void {
    const current = this.detail(input).stages.find((stage) => stage.stageRef === stageRef);
    if (!current || current.state === 'waiting-human') return;
    const transitioned = this.options.store.transitionStage(input.subject, stageRef, current.version, 'waiting-human');
    if (!transitioned.ok) throw new AutomaticExecutionError(transitioned.detail);
  }

  private prepareOrContain(
    input: ExecuteRunInput,
    stage: Stage,
    proposalStage: ProposalStage,
    policy: PolicyEnvironment,
    assignedAgent: ResolvedAssignedAgent | null,
  ): ReturnType<AutomaticExecutionEngine['prepareAttempt']> {
    try {
      return this.prepareAttempt(input, stage, proposalStage, policy, assignedAgent);
    } catch (error) {
      const detail = this.detail(input);
      const latestStage = detail.stages.find((item) => item.stageRef === stage.stageRef) as Stage;
      const attempt = getCurrentAttempt(detail, latestStage);
      const session = getSession(detail, attempt?.managedSessionRef ?? null);
      if (attempt && (attempt.state === 'starting' || attempt.state === 'running')) {
        this.transitionAttempt(input, attempt.attemptRef, 'interrupted');
      }
      if (session && (session.state === 'starting' || session.state === 'running')) {
        this.transitionSession(input, session.sessionRef, 'interrupted');
      }
      const currentStage = this.detail(input).stages.find((item) => item.stageRef === stage.stageRef) as Stage;
      if (currentStage.state === 'running') this.transitionStageByRef(input, currentStage.stageRef, 'interrupted');
      const boundaryStage = this.detail(input).stages.find((item) => item.stageRef === stage.stageRef) as Stage;
      this.createBoundary(
        input,
        boundaryStage,
        'governance-refusal',
        stableHumanTitle('policy', stage.stageId, 'attempt-preparation'),
        error instanceof Error ? error.message : 'attempt preparation failed',
      );
      return null;
    }
  }

  private prepareAttempt(
    input: ExecuteRunInput,
    initial: Stage,
    proposalStage: ProposalStage,
    policy: PolicyEnvironment,
    assignedAgent: ResolvedAssignedAgent | null,
  ): {
    stage: Stage;
    proposalStage: ProposalStage;
    attempt: Attempt;
    session: ManagedSession;
    profile: ExecutionProfile;
    assignedAgent: ResolvedAssignedAgent | null;
    iterationContract?: IterationOutcomeContract;
  } | null {
    let detail = this.detail(input);
    let stage = detail.stages.find((candidate) => candidate.stageRef === initial.stageRef) as Stage;
    let attempt = getCurrentAttempt(detail, stage);
    const iterationLoop = detail.iterationLoops.find((loop) => loop.state !== 'awaiting-seed'
      && loop.participants.some((participant) => participant.stageRef === stage.stageId));
    let iterationContract: IterationOutcomeContract | undefined;
    if (iterationLoop) {
      const participant = iterationLoop.participants.find((candidate) => candidate.stageRef === stage.stageId);
      const request = [...detail.iterationRequests].reverse().find((candidate) =>
        candidate.iterationLoopRef === iterationLoop.iterationLoopRef
        && candidate.recipientParticipantId === participant?.participantId
        && !detail.iterationReceipts.some((receipt) => receipt.requestRef === candidate.requestRef));
      const iterationGroup = input.proposal.iterationGroups?.find((candidate) =>
        candidate.iterationGroupId === iterationLoop.iterationGroupId);
      if (!participant || !request || !iterationGroup) {
        throw new AutomaticExecutionError(`iteration participant '${stage.stageId}' lacks its durable turn contract`);
      }
      const currentPositions = new Map<string, RunDetail['iterationReceipts'][number]['positions'][number]>();
      detail.iterationReceipts.filter((receipt) => receipt.iterationLoopRef === iterationLoop.iterationLoopRef)
        .flatMap((receipt) => receipt.positions).forEach((position) => currentPositions.set(position.positionId, position));
      iterationContract = { iterationGroup, request, currentPositions: [...currentPositions.values()] };
    }
    const routing = effectiveWorkerRouting(detail, stage, proposalStage);
    if (attempt?.state === 'interrupted' && attempt.generation >= this.options.budget.maxAttempts) {
      this.createBoundary(input, stage, 'intervention', stableHumanTitle('budget', stage.stageId, 'attempts'), 'automatic attempt budget exhausted');
      return null;
    }
    if (!attempt || attempt.state === 'interrupted'
      || (iterationContract !== undefined && (attempt.state === 'succeeded' || attempt.state === 'failed'))) {
      const created = this.options.store.createAttempt(input.subject, stage.stageRef, {
        expectedStageVersion: stage.version,
        runtime: routing.runtime,
        model: routing.model,
      });
      if (!created.ok) throw new AutomaticExecutionError(created.detail);
      attempt = created.value;
      detail = this.detail(input);
      stage = detail.stages.find((candidate) => candidate.stageRef === stage.stageRef) as Stage;
    }
    if (attempt.state !== 'queued') throw new AutomaticExecutionError(`attempt '${attempt.attemptRef}' is not safely resumable`);
    const profile = profileFor(policy, 'worker', attempt.runtime, attempt.model);
    if (!profile) {
      throw new AutomaticExecutionError('attempt routing is not an approved server-owned profile');
    }
    const attemptOperationKey = workerAttemptOperationKey(attempt.attemptRef, iterationContract?.request.requestRef);
    let session = getSession(detail, attempt.managedSessionRef);
    if (!session) {
      const created = this.options.store.createWorkerSession(input.subject, attempt.attemptRef, {
        expectedAttemptVersion: attempt.version,
        attemptOperationKey,
      });
      if (!created.ok) throw new AutomaticExecutionError(created.detail);
      session = created.value;
      detail = this.detail(input);
      attempt = detail.attempts.find((candidate) => candidate.attemptRef === attempt?.attemptRef) as Attempt;
    }
    stage = detail.stages.find((candidate) => candidate.stageRef === stage.stageRef) as Stage;
    if (stage.state !== 'running') {
      const transitioned = this.options.store.transitionStage(input.subject, stage.stageRef, stage.version, 'running');
      if (!transitioned.ok) throw new AutomaticExecutionError(transitioned.detail);
    }
    attempt = this.detail(input).attempts.find((candidate) => candidate.attemptRef === attempt?.attemptRef) as Attempt;
    if (attempt.state === 'queued') attempt = this.transitionAttempt(input, attempt.attemptRef, 'starting');
    session = this.detail(input).sessions.find((candidate) => candidate.sessionRef === session?.sessionRef) as ManagedSession;
    if (session.state === 'pending') {
      session = this.transitionSession(input, session.sessionRef, 'starting', attemptOperationKey);
    }
    // `starting -> running` is DELIBERATELY not projected here ([C-S5]). Nothing has been started yet:
    // the attempt reaches `running` only in `projectAttemptRunning`, once the attempt port's start
    // receipt proves the session exists and is durably bound. A refused start therefore never leaves a
    // `running` attempt or session behind.
    return {
      stage: this.detail(input).stages.find((candidate) => candidate.stageRef === stage.stageRef) as Stage,
      proposalStage, attempt, session, profile, assignedAgent,
      ...(iterationContract ? { iterationContract } : {}),
    };
  }

  private async executeAttempt(
    input: ExecuteRunInput,
    prepared: {
      stage: Stage; proposalStage: ProposalStage; attempt: Attempt; session: ManagedSession;
      profile: ExecutionProfile; assignedAgent: ResolvedAssignedAgent | null;
      iterationContract?: IterationOutcomeContract;
    },
    policy: PolicyEnvironment,
  ): Promise<({ state: 'succeeded' | 'waiting-human' | 'stopped'; stageId: string })> {
    try {
      return await this.executeAttemptUnsafe(input, prepared, policy);
    } catch (error) {
      if (this.cancellationObserved(input)) return { state: 'stopped', stageId: prepared.stage.stageId };
      const replayed = await this.recoverCaughtIterationResult(input, prepared);
      if (replayed) return replayed;
      const current = this.detail(input);
      const attempt = current.attempts.find((item) => item.attemptRef === prepared.attempt.attemptRef);
      const session = current.sessions.find((item) => item.sessionRef === prepared.session.sessionRef);
      if (attempt && (attempt.state === 'starting' || attempt.state === 'running')) {
        this.transitionAttempt(input, attempt.attemptRef, 'interrupted');
      }
      if (session && (session.state === 'starting' || session.state === 'running')) {
        this.transitionSession(input, session.sessionRef, 'interrupted');
      }
      const currentStage = this.detail(input).stages.find((item) => item.stageRef === prepared.stage.stageRef) as Stage;
      if (!['succeeded', 'failed', 'stopped'].includes(currentStage.state)) {
        this.transitionStageByRef(input, prepared.stage.stageRef, 'interrupted');
      }
      this.options.store.appendEvent(input.subject, input.runRef, {
        kind: 'lifecycle', source: 'system', stageRef: prepared.stage.stageRef,
        attemptRef: prepared.attempt.attemptRef, sessionRef: prepared.session.sessionRef,
        status: 'interrupted', summary: error instanceof Error ? error.message : 'execution adapter failed',
      });
      const latest = this.detail(input).stages.find((item) => item.stageRef === prepared.stage.stageRef) as Stage;
      const title = stableHumanTitle('execution', latest.stageId, prepared.attempt.attemptRef);
      const prompt = error instanceof Error ? error.message : 'execution adapter failed';
      if (latest.state === 'succeeded') {
        const existing = this.detail(input).humanRequests.find((request) => request.stageRef === latest.stageRef && request.title === title && request.state === 'open');
        if (!existing) {
          const request = this.options.store.createHumanRequest(input.subject, input.runRef, {
            stageRef: latest.stageRef, kind: 'intervention', title, prompt,
          });
          if (!request.ok) throw new AutomaticExecutionError(request.detail);
        }
        this.transitionRun(input, 'waiting-human');
      } else {
        this.createBoundary(input, latest, 'intervention', title, prompt);
      }
      return { state: 'waiting-human', stageId: prepared.stage.stageId };
    }
  }

  /**
   * An adapter can lose its acknowledgement after persisting a canonical integration. Re-read that
   * exact generation before containment so durable work advances automatically rather than asking a
   * human to approve a transport failure.
   */
  private async recoverCaughtIterationResult(
    input: ExecuteRunInput,
    prepared: {
      stage: Stage; proposalStage: ProposalStage; attempt: Attempt; session: ManagedSession;
      profile: ExecutionProfile; assignedAgent: ResolvedAssignedAgent | null;
      iterationContract?: IterationOutcomeContract;
    },
  ): Promise<{ state: 'succeeded' | 'waiting-human'; stageId: string } | null> {
    const detail = this.detail(input);
    const stage = detail.stages.find((item) => item.stageRef === prepared.stage.stageRef);
    const attempt = detail.attempts.find((item) => item.attemptRef === prepared.attempt.attemptRef);
    const session = detail.sessions.find((item) => item.sessionRef === prepared.session.sessionRef);
    if (!stage || !attempt || !session || !this.isIterationOwned(detail, stage)) return null;
    try {
      const result = await this.lookupCanonicalResult(input, stage, attempt, prepared.iterationContract);
      if (!result || canonicalStageResultHash(result) !== result.resultHash || !resultIsSafe(prepared.proposalStage, {
        state: 'succeeded', summary: result.summary, usage: { inputTokens: 0, outputTokens: 0, costUsdMicros: 0 },
        artifacts: [...result.artifacts], checkpoints: [...result.checkpoints],
        ...(result.iterationOutcome ? { iterationOutcome: result.iterationOutcome } : {}),
      }, { changed: result.changed }, prepared.iterationContract)) return null;
      const outcome = await this.finalizeCanonicalSuccess(
        input, prepared.proposalStage, stage.stageRef, attempt.attemptRef, session.sessionRef, result,
      );
      await this.cleanupAttemptWorktree(input, stage, attempt, planAttemptWorktreePath(this.options.worktreeRoot, input.runRef, attempt.attemptRef));
      return { state: outcome, stageId: stage.stageId };
    } catch {
      return null;
    }
  }

  /**
   * Contain a stranded prior canonical integration. The stage parks on ONE stage-stable boundary carrying
   * the integrator's accurate cause — the stranded state and the step that failed — so the human ask is
   * truthful and actionable, and a recurrence while that boundary is open reuses it rather than stacking a
   * duplicate. The attempt is interrupted (never `waiting-human`, which no edge can leave) so the durable
   * graph stays resumable: once the operator clears the boundary, the next reconciliation's lookup resumes
   * the integration itself, without re-running the worker.
   */
  private parkStrandedIntegration(
    input: ExecuteRunInput,
    prepared: { stage: Stage; attempt: Attempt; session: ManagedSession },
    error: unknown,
  ): { state: 'waiting-human'; stageId: string } {
    const prompt = error instanceof Error ? error.message : 'canonical integration is incomplete';
    const detail = this.detail(input);
    const attempt = detail.attempts.find((item) => item.attemptRef === prepared.attempt.attemptRef);
    const session = detail.sessions.find((item) => item.sessionRef === prepared.session.sessionRef);
    if (attempt && (attempt.state === 'starting' || attempt.state === 'running')) {
      this.transitionAttempt(input, attempt.attemptRef, 'interrupted');
    }
    if (session && (session.state === 'starting' || session.state === 'running')) {
      this.transitionSession(input, session.sessionRef, 'interrupted');
    }
    this.options.store.appendEvent(input.subject, input.runRef, {
      kind: 'lifecycle', source: 'system', stageRef: prepared.stage.stageRef,
      attemptRef: prepared.attempt.attemptRef, sessionRef: prepared.session.sessionRef,
      status: 'interrupted', summary: prompt,
    });
    const latest = this.detail(input).stages.find((item) => item.stageRef === prepared.stage.stageRef) as Stage;
    if (!['succeeded', 'failed', 'stopped'].includes(latest.state) && latest.state !== 'waiting-human') {
      this.transitionStageByRef(input, latest.stageRef, 'interrupted');
    }
    const stage = this.detail(input).stages.find((item) => item.stageRef === prepared.stage.stageRef) as Stage;
    const title = strandedIntegrationTitle(stage.stageId);
    const open = this.detail(input).humanRequests.some(
      (request) => request.stageRef === stage.stageRef && request.title === title && request.state === 'open',
    );
    if (open) {
      this.ensureStageWaiting(input, stage.stageRef);
      this.transitionRun(input, 'waiting-human');
    } else {
      this.createBoundary(input, stage, 'intervention', title, prompt);
    }
    return { state: 'waiting-human', stageId: stage.stageId };
  }

  private async executeAttemptUnsafe(
    input: ExecuteRunInput,
    prepared: {
      stage: Stage; proposalStage: ProposalStage; attempt: Attempt; session: ManagedSession;
      profile: ExecutionProfile; assignedAgent: ResolvedAssignedAgent | null;
      iterationContract?: IterationOutcomeContract;
    },
    policy: PolicyEnvironment,
  ): Promise<({ state: 'succeeded' | 'waiting-human' | 'stopped'; stageId: string })> {
    const { stage, proposalStage, attempt, session, profile, assignedAgent, iterationContract } = prepared;
    const operationKey = session.attemptOperationKey ?? workerAttemptOperationKey(attempt.attemptRef);
    const resultOperationKey = this.resultOperationKey(this.detail(input), stage, attempt, iterationContract);
    const worktreePath = planAttemptWorktreePath(this.options.worktreeRoot, input.runRef, attempt.attemptRef);
    const iterationOwned = this.isIterationOwned(this.detail(input), stage);
    const artifactProducingTurn = iterationContract !== undefined && proposalStage.artifacts.length > 0
      && ARTIFACT_PRODUCING_REQUEST_KINDS.has(iterationContract.request.kind);
    let artifactSnapshotBefore: Awaited<ReturnType<typeof snapshotDeclaredArtifacts>> = [];
    let integrated: CanonicalStageResult | null;
    try {
      integrated = await this.lookupCanonicalResult(input, stage, attempt, iterationContract);
    } catch (error) {
      // A stuck PRIOR integration, not this attempt failing. The generic containment path below would
      // interrupt into a successor attempt that repeats this identical lookup, which is how the same
      // stranded record parked three generations behind byte-identical messages. Park once, accurately,
      // and leave the retry to the next lookup once the operator has repaired the environment.
      if (!isCanonicalIntegrationIncomplete(error)) throw error;
      if (this.cancellationObserved(input)) return { state: 'stopped', stageId: stage.stageId };
      return this.parkStrandedIntegration(input, prepared, error);
    }
    if (this.cancellationObserved(input)) return { state: 'stopped', stageId: stage.stageId };
    if (integrated) {
      if (canonicalStageResultHash(integrated) !== integrated.resultHash || !resultIsSafe(
        proposalStage,
        {
          state: 'succeeded', summary: integrated.summary, usage: { inputTokens: 0, outputTokens: 0, costUsdMicros: 0 },
          artifacts: [...integrated.artifacts], checkpoints: [...integrated.checkpoints],
          ...(integrated.iterationOutcome ? { iterationOutcome: integrated.iterationOutcome } : {}),
        },
        { changed: integrated.changed },
        iterationContract,
      ) || (iterationOwned && !hasImmutableLineage(integrated))) {
        throw new AutomaticExecutionError('persisted canonical result failed reconciliation');
      }
      this.options.store.appendEvent(input.subject, input.runRef, {
        kind: 'lifecycle', source: 'system', stageRef: stage.stageRef, attemptRef: attempt.attemptRef,
        sessionRef: session.sessionRef, status: 'success', summary: 'reconciled previously integrated canonical result',
      });
      const outcome = await this.finalizeCanonicalSuccess(
        input, proposalStage, stage.stageRef, attempt.attemptRef, session.sessionRef, integrated,
      );
      return { state: outcome, stageId: stage.stageId };
    }
    let baseCommit: string | undefined = iterationContract?.request.baseCommit
      ?? attempt.baseCommit ?? undefined;
    if (baseCommit === undefined && proposalStage.dependsOn.length > 0) {
      if (!this.options.results.resolveBase) {
        throw new AutomaticExecutionError('result integrator cannot resolve committed dependency lineage');
      }
      baseCommit = await this.options.results.resolveBase({
        operationKey: `result-base:${input.runRef}:${stage.stageId}`,
        subject: input.subject,
        runRef: input.runRef,
        stageId: stage.stageId,
        dependencyStageIds: [...proposalStage.dependsOn].sort(),
        dependencyResultOperationKeys: this.dependencyResultOperationKeys(this.detail(input), [...proposalStage.dependsOn].sort()),
      }) ?? undefined;
      if (this.cancellationObserved(input)) return { state: 'stopped', stageId: stage.stageId };
      if (!baseCommit) throw new AutomaticExecutionError('committed dependency lineage is unavailable');
    }
    await this.options.worktrees.ensure({
      operationKey: `worktree:${attempt.attemptRef}`, runRef: input.runRef, path: worktreePath, baseCommit,
    });
    if (this.cancellationObserved(input)) return { state: 'stopped', stageId: stage.stageId };
    const skills = await this.options.skills.resolve({ operationKey: `skills:${attempt.attemptRef}`, profile, requested: proposalStage.requiredSkills });
    if (this.cancellationObserved(input)) return { state: 'stopped', stageId: stage.stageId };
    if (!skills.ok || skills.skills.some((skill) => !policy.curatedSkills.has(skill))) {
      this.createBoundary(input, stage, 'governance-refusal', stableHumanTitle('policy', stage.stageId, 'skill-resolution'), skills.ok ? 'skill resolver widened the curated set' : skills.reason);
      this.transitionAttempt(input, attempt.attemptRef, 'waiting-human');
      this.transitionSession(input, session.sessionRef, 'waiting');
      return { state: 'waiting-human', stageId: stage.stageId };
    }
    const reservation = await this.options.accounting.reserve({
      operationKey: `reserve:${attempt.attemptRef}`,
      subject: input.subject,
      runRef: input.runRef,
      attemptRef: attempt.attemptRef,
      limits: this.options.attemptBudget,
    });
    if (this.cancellationObserved(input)) {
      if (reservation.ok) {
        await this.options.accounting.settle({
          operationKey: `settle:${attempt.attemptRef}`,
          reservationRef: reservation.value.reservationRef,
          usage: { inputTokens: 0, outputTokens: 0, costUsdMicros: 0 },
        });
      }
      return { state: 'stopped', stageId: stage.stageId };
    }
    if (!reservation.ok) {
      this.createBoundary(input, stage, 'intervention', stableHumanTitle('budget', stage.stageId, 'usage'), reservation.reason);
      this.transitionAttempt(input, attempt.attemptRef, 'interrupted');
      this.transitionSession(input, session.sessionRef, 'interrupted');
      return { state: 'waiting-human', stageId: stage.stageId };
    }
    if (artifactProducingTurn) {
      artifactSnapshotBefore = await snapshotDeclaredArtifacts(worktreePath, proposalStage);
    }
    // FYT paid-action wiring (Unit D3): mint this stage's spend grant and write its opaque token into the
    // prepared attempt worktree BEFORE the worker spawns, so a headless worker can spend through the daemon
    // without ever holding a provider key. No-op unless the hook is supplied (only behind the activation
    // gate) AND the stage declares a spendAuthorization gate the run has recorded approved. Runs after the
    // worktree exists (`worktrees.ensure` above) and before any worker delivery.
    if (this.options.provisionSpendGrant) {
      await this.options.provisionSpendGrant({
        subject: input.subject,
        runRef: input.runRef,
        stageRef: stage.stageRef,
        stageId: stage.stageId,
        attemptRef: attempt.attemptRef,
        worktreePath,
        proposalStage,
        humanRequests: this.detail(input).humanRequests,
      });
      if (this.cancellationObserved(input)) return { state: 'stopped', stageId: stage.stageId };
    }
    let result: WorkerExecutionResult;
    try {
      const launch = this.options.workers.begin({
        operationKey,
        subject: input.subject,
        runRef: input.runRef,
        stageRef: stage.stageRef,
        attemptRef: attempt.attemptRef,
        sessionRef: session.sessionRef,
        worktreePath,
        profile,
        workflowProfile: proposalStage.workflowProfile ?? input.proposal.profile ?? null,
        skills: skills.skills,
        action: proposalStage.action,
        target: proposalStage.target,
        workOrder: proposalStage.workOrder,
        readScope: proposalStage.scope.read,
        writeScope: proposalStage.scope.write,
        checkpoints: proposalStage.checkpoints.map((checkpoint) => checkpoint.id),
        proposalStage,
        project: input.proposal.project,
        ...(iterationContract ? { iterationContract, expectsIterationOutcome: true } : {}),
        ...(assignedAgent ? { assignment: assignedAgent.assignment, instructionMarkdown: assignedAgent.instructionMarkdown } : {}),
      });
      // Both halves of the launch exist the moment `begin` returns. If the receipt rejects, the catch
      // below synthesizes a failed result and NOTHING ever awaits `launch.result` — so claim its
      // rejection here, before the first await, or a later failure there is an unhandled rejection that
      // can take the daemon down. The real await stays in PHASE 2.
      launch.result.catch(() => { /* claimed; PHASE 2 owns the real outcome when it is reached */ });
      // PHASE 1. The receipt proves the session was created, its durable operation receipt written, the
      // attempt bound one-to-one, and the recorder attached. Only a successful receipt may promote the
      // attempt/session to `running`; a refusal falls straight through to the port's own failure result,
      // so a create/bind failure or a cancellation before the receipt is durably failed with no
      // `running` projection anywhere.
      const receipt = await launch.receipt;
      if (receipt.ok) this.projectAttemptRunning(input, attempt.attemptRef, session.sessionRef);
      // PHASE 2. Only now is the attempt's terminal result awaited.
      result = await launch.result;
    } catch (error) {
      result = {
        state: 'failed', summary: error instanceof Error ? error.message : 'worker adapter failed',
        usage: { inputTokens: 0, outputTokens: 0, costUsdMicros: 0 }, artifacts: [], checkpoints: [],
      };
    }
    try {
      assertUsage(result.usage);
      await this.options.accounting.settle({
        operationKey: `settle:${attempt.attemptRef}`,
        reservationRef: reservation.value.reservationRef,
        usage: result.usage,
      });
    } catch (error) {
      // A settlement the accounting adapter refuses (reported usage above this attempt's reserved
      // ceiling — cache-read input tokens accumulate across a long multi-turn worker session) writes
      // NOTHING: the reservation stays `active`, holding its full limit and, at maxConcurrency 1, the
      // window's only concurrency slot — for the rest of the window. Every later reserve in that window
      // would then be refused and every stage would park. Release the hold at the reserved ceiling (the
      // most this attempt could ever have been charged; never under-charge), then rethrow the original
      // error so the existing park/intervention path still fires with the overage message intact.
      try {
        await this.options.accounting.settle({
          operationKey: `settle-ceiling:${attempt.attemptRef}`,
          reservationRef: reservation.value.reservationRef,
          usage: {
            inputTokens: this.options.attemptBudget.maxInputTokens,
            outputTokens: this.options.attemptBudget.maxOutputTokens,
            costUsdMicros: this.options.attemptBudget.maxCostUsdMicros,
          },
        });
      } catch (releaseError) {
        // Best effort only: the actionable error for the human is the refusal below, not this one.
        console.error('accounting reservation could not be released at its ceiling', releaseError);
      }
      throw error;
    }
    if (this.cancellationObserved(input)) return { state: 'stopped', stageId: stage.stageId };
    if (result.state === 'succeeded' && iterationContract && result.iterationOutcome) {
      const validated = validatedIterationOutcome(iterationContract, result.iterationOutcome);
      if (!validated) {
        result = { ...result, state: 'failed', summary: 'iteration outcome failed its durable turn contract', artifacts: [], checkpoints: [] };
      } else {
        result = { ...result, iterationOutcome: validated };
      }
    }
    if (result.state === 'succeeded' && artifactProducingTurn && result.iterationOutcome) {
      const evidence = await inspectDeclaredArtifacts(worktreePath, artifactSnapshotBefore);
      if (evidence.failureReason !== null) {
        this.options.store.appendEvent(input.subject, input.runRef, {
          kind: 'lifecycle', source: 'worker', stageRef: stage.stageRef, attemptRef: attempt.attemptRef,
          sessionRef: session.sessionRef, status: 'waiting', summary: evidence.failureReason,
        });
        const detail = this.detail(input);
        const loop = detail.iterationLoops.find((candidate) =>
          candidate.iterationLoopRef === iterationContract.request.iterationLoopRef);
        if (!loop) throw new AutomaticExecutionError('iteration loop disappeared before no-progress park');
        const parked = this.options.store.parkIterationLoop(input.subject, loop.iterationLoopRef, {
          expectedLoopVersion: loop.version,
          expectedActiveGenerationRefs: [...loop.activeGenerationRefs],
          reason: 'no-progress',
          nextRouteId: iterationContract.request.routeId,
          attemptedRequestRef: iterationContract.request.requestRef,
          attemptedOutcome: result.iterationOutcome,
          artifactSnapshots: evidence.snapshots,
          failureReason: evidence.failureReason,
          operationKey: `iteration-park:${iterationContract.request.requestRef}:no-progress`,
        });
        if (!parked.ok) throw new AutomaticExecutionError(parked.detail);
        this.transitionRun(input, 'waiting-human');
        await this.cleanupAttemptWorktree(input, stage, attempt, worktreePath);
        return { state: 'waiting-human', stageId: stage.stageId };
      }
    }
    const inspection = result.state === 'succeeded'
      ? await this.options.worktrees.inspect({ operationKey: `inspect:${attempt.attemptRef}`, runRef: input.runRef, path: worktreePath })
      : { changed: [] };
    if (this.cancellationObserved(input)) return { state: 'stopped', stageId: stage.stageId };
    if (!resultIsSafe(proposalStage, result, inspection, iterationContract)) {
      result = { ...result, state: 'failed', summary: 'worker result exceeded the approved canonical result envelope', artifacts: [], checkpoints: [] };
    }
    this.options.store.appendEvent(input.subject, input.runRef, {
      kind: 'lifecycle', source: 'worker', stageRef: stage.stageRef, attemptRef: attempt.attemptRef,
      sessionRef: session.sessionRef, status: result.state === 'succeeded' ? 'success' : result.state === 'failed' ? 'failure' : 'waiting',
      summary: result.summary,
    });
    if (result.state === 'succeeded') {
      const canonical = {
        summary: result.summary,
        artifacts: result.artifacts,
        changed: inspection.changed,
        checkpoints: result.checkpoints,
        ...(result.iterationOutcome ? { iterationOutcome: result.iterationOutcome } : {}),
      };
      const resultHash = canonicalStageResultHash(canonical);
      const integratedResult = await this.options.results.integrate({
        operationKey: resultOperationKey,
        subject: input.subject,
        runRef: input.runRef,
        stageRef: stage.stageRef,
        stageId: stage.stageId,
        attemptRef: attempt.attemptRef,
        canonicalCardRef: iterationContract ? null : stage.canonicalCardRef,
        summary: result.summary,
        artifacts: result.artifacts,
        changed: inspection.changed,
        checkpoints: result.checkpoints,
        ...(result.iterationOutcome ? { iterationOutcome: result.iterationOutcome, iterationContract } : {}),
        resultHash,
        worktreePath,
      });
      if (this.cancellationObserved(input)) return { state: 'stopped', stageId: stage.stageId };
      if (canonicalStageResultHash(canonical) !== integratedResult.resultHash) {
        throw new AutomaticExecutionError('canonical result replay hash differs');
      }
      if (iterationOwned && !hasImmutableLineage(integratedResult)) {
        throw new AutomaticExecutionError('iteration canonical result lacks immutable lineage');
      }
      const completedCanonical: CanonicalStageResult = integratedResult.durability === 'canonical'
        ? {
            summary: canonical.summary, artifacts: canonical.artifacts, changed: canonical.changed, checkpoints: canonical.checkpoints,
            ...(canonical.iterationOutcome ? { iterationOutcome: canonical.iterationOutcome } : {}), resultHash: integratedResult.resultHash,
            durability: 'canonical', attemptBaseCommit: integratedResult.attemptBaseCommit, integrationCommit: integratedResult.integrationCommit,
          }
        : {
            summary: canonical.summary, artifacts: canonical.artifacts, changed: canonical.changed, checkpoints: canonical.checkpoints,
            ...(canonical.iterationOutcome ? { iterationOutcome: canonical.iterationOutcome } : {}), resultHash: integratedResult.resultHash,
            durability: 'inactive', attemptBaseCommit: null, integrationCommit: null,
          };
      const outcome = await this.finalizeCanonicalSuccess(
        input,
        proposalStage,
        stage.stageRef,
        attempt.attemptRef,
        session.sessionRef,
        completedCanonical,
      );
      await this.cleanupAttemptWorktree(input, stage, attempt, worktreePath);
      return { state: outcome, stageId: stage.stageId };
    }
    if (result.state === 'waiting-human') {
      this.createBoundary(input, stage, 'intervention', stableHumanTitle('execution', stage.stageId, attempt.attemptRef), result.summary);
      this.transitionAttempt(input, attempt.attemptRef, 'interrupted');
      this.transitionSession(input, session.sessionRef, 'interrupted');
      await this.cleanupAttemptWorktree(input, stage, attempt, worktreePath);
      return { state: 'waiting-human', stageId: stage.stageId };
    }
    this.transitionAttempt(input, attempt.attemptRef, 'failed');
    this.transitionSession(input, session.sessionRef, 'failed');
    this.transitionStageByRef(input, stage.stageRef, 'failed');
    await this.cleanupAttemptWorktree(input, stage, attempt, worktreePath);
    return { state: 'waiting-human', stageId: stage.stageId };
  }

  /**
   * Reclaim a terminal attempt's worktree. Cleanup is only invoked once integration has committed
   * (or was never started for this attempt), so it can never remove a worktree that inspect/integrate
   * might still read. Removal is best-effort: a missing tree must not throw, and an unexpected adapter
   * failure is recorded as a non-fatal event rather than wedging the run into an intervention.
   */
  private async cleanupAttemptWorktree(input: ExecuteRunInput, stage: Stage, attempt: Attempt, worktreePath: string): Promise<void> {
    try {
      await this.options.worktrees.remove({
        operationKey: `worktree-remove:${attempt.attemptRef}`,
        runRef: input.runRef,
        path: worktreePath,
      });
    } catch (error) {
      this.options.store.appendEvent(input.subject, input.runRef, {
        kind: 'lifecycle', source: 'system', stageRef: stage.stageRef, attemptRef: attempt.attemptRef,
        status: 'pending', summary: `attempt worktree cleanup did not complete: ${error instanceof Error ? error.message : 'unknown error'}`,
      });
    }
  }

  private cancellationObserved(input: Pick<ExecuteRunInput, 'subject' | 'runRef'>): boolean {
    const lockKey = `${input.subject}\0${input.runRef}`;
    const state = runLifecycleKind(this.detail(input).run.lifecycle);
    return this.cancellingRuns.has(lockKey) || state === 'stopping' || state === 'stopped' || state === 'interrupted';
  }

  private async settleRunState(input: ExecuteRunInput): Promise<RunDetail['run']> {
    const detail = this.detail(input);
    if (['stopping', 'stopped'].includes(runLifecycleKind(detail.run.lifecycle))) return detail.run;
    if (detail.stages.every((stage) => stage.state === 'succeeded')
      && detail.iterationLoops.every((loop) => loop.state === 'passed')) {
      const manager = detail.sessions.find((session) => session.sessionRef === detail.run.managerSessionRef);
      if (!manager) throw new AutomaticExecutionError('manager session disappeared before run completion');
      if (!['completed', 'failed', 'stopped', 'interrupted'].includes(manager.state)) {
        const intent = this.options.store.appendEvent(input.subject, input.runRef, {
          kind: 'lifecycle', source: 'system', sessionRef: manager.sessionRef, status: 'pending',
          summary: 'all stages completed; Manager shutdown requested before run success',
        });
        if (!intent.ok) throw new AutomaticExecutionError(intent.detail);
        try {
          await this.options.cancellation.cancelManager({
            operationKey: `complete:${input.runRef}:${manager.sessionRef}`,
            subject: input.subject,
            runRef: input.runRef,
            sessionRef: manager.sessionRef,
            attemptRef: null,
            intent: 'run-complete',
          });
          if (this.cancellationObserved(input)) return this.detail(input).run;
          this.transitionSession(input, manager.sessionRef, 'stopped');
        } catch (error) {
          if (this.cancellationObserved(input)) return this.detail(input).run;
          this.transitionSession(input, manager.sessionRef, 'interrupted');
          const request = this.options.store.createHumanRequest(input.subject, input.runRef, {
            kind: 'intervention', title: 'Manager shutdown needs intervention',
            prompt: error instanceof Error ? error.message : 'Manager adapter did not acknowledge shutdown',
          });
          if (!request.ok) throw new AutomaticExecutionError(request.detail);
          return this.transitionRun(input, 'waiting-human');
        }
      }
      return this.transitionRun(input, 'succeeded');
    }
    if (detail.iterationLoops.some((loop) => loop.state === 'declined')) return this.transitionRun(input, 'failed');
    if (detail.stages.some((stage) => stage.state === 'failed' || stage.state === 'stopped')) return this.transitionRun(input, 'failed');
    if (detail.stages.some((stage) => stage.state === 'waiting-human')) return this.transitionRun(input, 'waiting-human');
    if (hasGroupScopedIterationBoundary(detail)) return this.transitionRun(input, 'waiting-human');
    return detail.run;
  }

  private transitionRun(
    input: ExecuteRunInput,
    state: Exclude<RunLifecycleKind, 'paused-for-deploy'>,
  ): RunDetail['run'] {
    const run = this.detail(input).run;
    if (runLifecycleKind(run.lifecycle) === state) return run;
    const result = this.options.store.transitionRun(input.subject, input.runRef, run.version, state);
    if (!result.ok) throw new AutomaticExecutionError(result.detail);
    return result.value;
  }

  private transitionStageByRef(input: ExecuteRunInput, stageRef: string, state: Stage['state']): Stage {
    const stage = this.detail(input).stages.find((candidate) => candidate.stageRef === stageRef);
    if (!stage) throw new AutomaticExecutionError('stage disappeared');
    if (stage.state === state) return stage;
    const result = this.options.store.transitionStage(input.subject, stageRef, stage.version, state);
    if (!result.ok) throw new AutomaticExecutionError(result.detail);
    return result.value;
  }

  /**
   * The single `starting -> running` projection for a worker attempt ([C-S5]). It is reachable only
   * from the receipt-proved branch of `executeAttemptUnsafe`, so `running` in the store always means a
   * created, durably bound, recorder-attached session — never merely an intent to start one.
   */
  private projectAttemptRunning(input: ExecuteRunInput, attemptRef: string, sessionRef: string): void {
    const session = this.detail(input).sessions.find((candidate) => candidate.sessionRef === sessionRef);
    if (session && session.state === 'starting') this.transitionSession(input, sessionRef, 'running');
    const attempt = this.detail(input).attempts.find((candidate) => candidate.attemptRef === attemptRef);
    if (attempt && attempt.state === 'starting') this.transitionAttempt(input, attemptRef, 'running');
  }

  private transitionAttempt(input: ExecuteRunInput, attemptRef: string, state: Attempt['state']): Attempt {
    const attempt = this.detail(input).attempts.find((candidate) => candidate.attemptRef === attemptRef);
    if (!attempt) throw new AutomaticExecutionError('attempt disappeared');
    if (attempt.state === state) return attempt;
    const result = this.options.store.transitionAttempt(input.subject, attemptRef, attempt.version, state);
    if (!result.ok) throw new AutomaticExecutionError(result.detail);
    return result.value;
  }

  private transitionSession(
    input: ExecuteRunInput,
    sessionRef: string,
    state: ManagedSession['state'],
    attemptOperationKey?: string,
  ): ManagedSession {
    const session = this.detail(input).sessions.find((candidate) => candidate.sessionRef === sessionRef);
    if (!session) throw new AutomaticExecutionError('session disappeared');
    if (session.state === state
      && (attemptOperationKey === undefined || session.attemptOperationKey === attemptOperationKey)) return session;
    const result = this.options.store.transitionSession(
      input.subject, sessionRef, session.version, state, attemptOperationKey,
    );
    if (!result.ok) throw new AutomaticExecutionError(result.detail);
    return result.value;
  }
}
