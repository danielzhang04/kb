import { createHash } from 'node:crypto';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { ControlPlaneStore } from './store.ts';
import type { Attempt, ManagedSession, RunDetail, Stage } from './types.ts';
import { classifyActionRisk, evaluateExecutionPolicy, type ExecutionProfile, type PolicyEnvironment } from './policy.ts';
import { isSafeRepoRelativePath, proposalContentHash, type PlanProposal, type ProposalStage, type ResolvedAgentAssignment } from './proposal.ts';
import type { AssignedAgentResolver, ResolvedAssignedAgent } from './agentAssignmentResolver.ts';
import { parseReviewOutcome, type ReviewContract, type ReviewOutcome } from './reviewOutcome.ts';

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
  /** Present only when a directly invoked checker satisfied its server-owned review contract. */
  reviewOutcome?: ReviewOutcome;
}

export interface WorkerAdapter {
  /** operationKey is stable across reconciliation; implementations must not spawn duplicates. */
  execute(input: {
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
    /** Optional immutable checker contract. Execution does not supply one until durable loop state exists. */
    reviewContract?: ReviewContract;
    /** Present only after a server-owned assignment resolver verifies the current declaration. */
    assignment?: ResolvedAgentAssignment;
    /** Exact bounded declaration Markdown, never browser/prompt input. */
    instructionMarkdown?: string;
  }): Promise<WorkerExecutionResult>;
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
  cancelWorker(input: ManagedCancellationInput & { attemptRef: string }): Promise<void>;
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
    /** A checker outcome that was already validated against its server-owned review contract. */
    reviewOutcome?: ReviewOutcome;
    /** Required with reviewOutcome; supplied only from the immutable approved proposal stage. */
    reviewContract?: ReviewContract;
    resultHash: string;
    worktreePath: string;
  }): Promise<ResultIntegrationReceipt>;
}

export interface CanonicalStageResultPayload {
  summary: string;
  artifacts: readonly WorkerArtifactResult[];
  changed: readonly WorkerArtifactResult[];
  checkpoints: readonly string[];
  /** Validated checker output, when this canonical result belongs to a checker. */
  reviewOutcome?: ReviewOutcome;
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
  maxConcurrency: number;
  budget: ExecutionBudget;
  /** Closed server action registry; prose cannot widen runtime capabilities. */
  worktrees: WorktreeAdapter;
  managers: ManagerAdapter;
  workers: WorkerAdapter;
  skills: SkillResolver;
  accounting: AccountingAdapter;
  results: ResultIntegrator;
  cancellation: ExecutionCancellationController;
}

export interface ExecuteRunInput {
  subject: string;
  runRef: string;
  proposal: PlanProposal;
}

export interface ExecutionOutcome {
  state: RunDetail['run']['state'];
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

export interface CancellationOutcome {
  state: RunDetail['run']['state'];
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

export function canonicalStageResultHash(result: CanonicalStageResultPayload): string {
  const artifacts = [...result.artifacts].map((item) => ({ path: item.path, digest: item.digest })).sort((a, b) => a.path.localeCompare(b.path));
  const changed = [...result.changed].map((item) => ({ path: item.path, digest: item.digest })).sort((a, b) => a.path.localeCompare(b.path));
  const checkpoints = [...result.checkpoints].sort();
  const reviewOutcome = result.reviewOutcome
    ? {
        schema: result.reviewOutcome.schema,
        decision: result.reviewOutcome.decision,
        summary: result.reviewOutcome.summary,
        criteria: result.reviewOutcome.criteria.map((criterion) => ({
          criterionId: criterion.criterionId,
          verdict: criterion.verdict,
          findingIds: [...criterion.findingIds],
        })),
        findings: result.reviewOutcome.findings.map((finding) => ({
          id: finding.id,
          criterionId: finding.criterionId,
          severity: finding.severity,
          summary: finding.summary,
          evidencePaths: [...finding.evidencePaths],
        })),
      }
    : null;
  return createHash('sha256').update(JSON.stringify({ summary: result.summary, artifacts, changed, checkpoints, reviewOutcome }), 'utf8').digest('hex');
}

function validatedReviewOutcome(stage: ProposalStage, outcome: ReviewOutcome): ReviewOutcome | null {
  if (!stage.review) return null;
  try {
    const parsed = parseReviewOutcome(JSON.stringify(outcome), { review: stage.review });
    return parsed.ok ? parsed.value : null;
  } catch {
    return null;
  }
}

function hasImmutableLineage(result: CanonicalStageResult | ResultIntegrationReceipt): boolean {
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
    && (result.reviewOutcome === undefined || validatedReviewOutcome(stage, result.reviewOutcome) !== null);
}

function stableHumanTitle(kind: 'gate' | 'policy' | 'budget' | 'execution', stageId: string, detail: string): string {
  return `automatic:${kind}:${stageId}:${detail}`.slice(0, 240);
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

function runBoundariesAccepted(detail: RunDetail): boolean {
  return detail.humanRequests.every(acceptedBoundary);
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
    requireSafeInteger(options.budget.maxAttempts, 'budget.maxAttempts', 1);
    requireSafeInteger(options.budget.maxInputTokens, 'budget.maxInputTokens', 0);
    requireSafeInteger(options.budget.maxOutputTokens, 'budget.maxOutputTokens', 0);
    requireSafeInteger(options.budget.maxCostUsdMicros, 'budget.maxCostUsdMicros', 0);
    planRunWorktreePath(options.worktreeRoot, 'validation');
  }

  async runToBoundary(input: ExecuteRunInput): Promise<ExecutionOutcome> {
    const lockKey = `${input.subject}\0${input.runRef}`;
    if (this.activeRuns.has(lockKey)) throw new AutomaticExecutionError('run reconciliation is already active');
    this.activeRuns.add(lockKey);
    const startedStageIds: string[] = [];
    const completedStageIds: string[] = [];
    const waitingStageIds: string[] = [];
    try {
      this.assertRunBinding(input);
      const reviewPreflight = this.preflightReviewRuntime(input);
      if (reviewPreflight.length > 0) {
        return { state: this.detail(input).run.state, startedStageIds, completedStageIds, waitingStageIds: reviewPreflight };
      }
      // Resolve only after the immutable run/proposal binding is proven. In particular, an arbitrary
      // browser-supplied proposal must never select a project policy loader before it is known to be the
      // exact approved graph attached to this run.
      const policy = this.resolveProjectPolicy(input.proposal.project);
      const resolvedAgents = this.resolveRunAssignments(input, policy);
      if (!(await this.ensureManager(input, policy, resolvedAgents.manager))) {
        return { state: this.detail(input).run.state, startedStageIds, completedStageIds, waitingStageIds };
      }
      for (let pass = 0; pass <= input.proposal.stages.length; pass += 1) {
        const detail = this.detail(input);
        if (this.cancellingRuns.has(lockKey)) {
          return { state: detail.run.state, startedStageIds, completedStageIds, waitingStageIds };
        }
        if (['succeeded', 'failed', 'stopped', 'stopping'].includes(detail.run.state)) {
          return { state: detail.run.state, startedStageIds, completedStageIds, waitingStageIds };
        }
        if (detail.run.state === 'interrupted' && detail.humanRequests.some((request) => request.state === 'open')) {
          return { state: detail.run.state, startedStageIds, completedStageIds, waitingStageIds };
        }
        this.releaseDependents(input, detail);
        const refreshed = this.detail(input);
        if (refreshed.stages.some((stage) => stage.state === 'failed' || stage.state === 'stopped')) {
          const state = this.transitionRun(input, 'failed').state;
          return { state, startedStageIds, completedStageIds, waitingStageIds };
        }
        const candidates: Array<{ stage: Stage; proposalStage: ProposalStage }> = [];
        for (const stage of [...refreshed.stages].sort((left, right) => left.stageId.localeCompare(right.stageId))) {
          if (stage.state !== 'ready' && stage.state !== 'interrupted' && stage.state !== 'waiting-human') continue;
          const proposalStage = stageById(input.proposal, stage.stageId);
          const boundary = this.stageBoundary(input, refreshed, stage, proposalStage, policy);
          if (boundary === 'waiting') {
            if (!waitingStageIds.includes(stage.stageId)) waitingStageIds.push(stage.stageId);
            continue;
          }
          if (boundary === 'refused') {
            if (!waitingStageIds.includes(stage.stageId)) waitingStageIds.push(stage.stageId);
            continue;
          }
          candidates.push({ stage: this.detail(input).stages.find((candidate) => candidate.stageRef === stage.stageRef) as Stage, proposalStage });
        }
        const available = Math.max(0, this.options.maxConcurrency - this.activeWorkers);
        if (candidates.length > 0 && available === 0) {
          await this.waitForCapacity();
          pass -= 1;
          continue;
        }
        const batch = candidates.slice(0, available);
        if (batch.length === 0) {
          const settled = await this.settleRunState(input);
          return { state: settled.state, startedStageIds, completedStageIds, waitingStageIds };
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
          else if (session.attemptRef) await this.options.cancellation.cancelWorker({ ...signal, attemptRef: session.attemptRef });
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
      if (current.run.state !== finalState) {
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
    if ((detail.run.state === 'waiting-human' || detail.run.state === 'interrupted') && !runBoundariesAccepted(detail)) {
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
      try {
        await this.options.managers.ensure({
          operationKey: `automatic-manager-session:${manager.sessionRef}`,
          subject: input.subject,
          runRef: input.runRef,
          sessionRef: manager.sessionRef,
          generation: manager.generation,
          predecessorSessionRef: manager.predecessorSessionRef,
          proposalHash: detail.run.proposalHash,
          profile,
          ...(assignedAgent ? { assignment: assignedAgent.assignment, instructionMarkdown: assignedAgent.instructionMarkdown } : {}),
        });
        if (this.cancellationObserved(input)) return false;
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
    if (detail.run.state === 'waiting-human' && !runBoundariesAccepted(detail)) return false;
    if (detail.run.state === 'planned' || detail.run.state === 'interrupted' || detail.run.state === 'recovering' || detail.run.state === 'waiting-human') {
      this.transitionRun(input, 'running');
    }
    return true;
  }

  private releaseDependents(input: ExecuteRunInput, detail: RunDetail): void {
    const byId = new Map(detail.stages.map((stage) => [stage.stageId, stage]));
    for (const stage of [...detail.stages].sort((left, right) => left.stageId.localeCompare(right.stageId))) {
      if (stage.state !== 'blocked') continue;
      if (stage.dependsOn.every((dependency) => byId.get(dependency)?.state === 'succeeded')) {
        const result = this.options.store.transitionStage(input.subject, stage.stageRef, stage.version, 'ready');
        if (!result.ok && result.reason !== 'conflict') throw new AutomaticExecutionError(result.detail);
      }
    }
  }

  /**
   * Review execution has no durable generation/receipt loop yet. Refuse the entire bound run before
   * resolving policy or assignments, starting the manager, or touching any injected execution adapter.
   */
  private preflightReviewRuntime(input: ExecuteRunInput): string[] {
    const reviewStages = input.proposal.stages.filter((proposalStage) => proposalStage.review !== undefined);
    if (reviewStages.length === 0) return [];
    const waitingStageIds: string[] = [];
    for (const proposalStage of reviewStages) {
      const detail = this.detail(input);
      const stage = detail.stages.find((candidate) => candidate.stageId === proposalStage.id);
      if (!stage) throw new AutomaticExecutionError(`review stage '${proposalStage.id}' disappeared from immutable run`);
      const reason = 'review-loop-durable-state-not-yet-available';
      const title = stableHumanTitle('policy', stage.stageId, reason);
      if (!detail.humanRequests.some((request) => request.stageRef === stage.stageRef && request.title === title)) {
        this.createBoundary(input, stage, 'governance-refusal', title, reason);
      } else {
        this.ensureStageWaiting(input, stage.stageRef);
      }
      waitingStageIds.push(stage.stageId);
    }
    return waitingStageIds;
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
    // Review outcomes need append-only generation/receipt state before they can release any dependent.
    // Do not spawn a checker on a transient result or let an ordinary succeeded Stage bypass that loop.
    if (proposalStage.review) {
      const reason = 'review-loop-durable-state-not-yet-available';
      const title = stableHumanTitle('policy', stage.stageId, reason);
      if (!detail.humanRequests.some((request) => request.stageRef === stage.stageRef && request.title === title)) {
        this.createBoundary(input, stage, 'governance-refusal', title, reason);
      } else {
        this.ensureStageWaiting(input, stage.stageRef);
      }
      return 'refused';
    }
    for (const gate of proposalStage.humanGates) {
      const title = stableHumanTitle('gate', stage.stageId, gate.id);
      const existing = detail.humanRequests.find((request) => request.stageRef === stage.stageRef && request.title === title);
      if (!existing) {
        this.createBoundary(input, stage, gate.kind, title, gate.prompt);
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
    const actionClassification = classifyActionRisk(proposalStage.action);
    if (actionClassification.disposition === 'forbidden') {
      const reason = actionClassification.reason;
      const title = stableHumanTitle('policy', stage.stageId, reason);
      if (!detail.humanRequests.some((request) => request.stageRef === stage.stageRef && request.title === title)) {
        this.createBoundary(input, stage, 'governance-refusal', title, reason);
      } else {
        this.ensureStageWaiting(input, stage.stageRef);
      }
      return 'refused';
    }
    const restricted = restrictedIntent(proposalStage);
    if (restricted) {
      const title = stableHumanTitle('policy', stage.stageId, restricted.reason);
      if (!detail.humanRequests.some((request) => request.stageRef === stage.stageRef && request.title === title)) {
        this.createBoundary(
          input,
          stage,
          restricted.kind === 'refuse' ? 'governance-refusal' : 'approval',
          title,
          restricted.reason,
        );
      } else {
        this.ensureStageWaiting(input, stage.stageRef);
      }
      return restricted.kind === 'refuse' ? 'refused' : 'waiting';
    }
    const routing = effectiveWorkerRouting(detail, stage, proposalStage);
    const decision = evaluateExecutionPolicy({
      project: input.proposal.project,
      riskTier: proposalStage.riskTier,
      role: 'worker',
      runtime: routing.runtime as 'claude' | 'codex',
      model: routing.model,
      target: proposalStage.target,
      requiredSkills: proposalStage.requiredSkills,
      scope: proposalStage.scope,
      governanceRefs: input.proposal.governanceRefs,
      proposalHash: this.detail(input).run.proposalHash,
      approvedHash: this.detail(input).run.proposalHash,
    }, policy);
    if (decision.disposition !== 'allow') {
      const title = stableHumanTitle('policy', stage.stageId, decision.reason);
      if (!detail.humanRequests.some((request) => request.stageRef === stage.stageRef && request.title === title)) {
        this.createBoundary(input, stage, decision.disposition === 'refuse' ? 'governance-refusal' : 'approval', title, decision.reason);
      } else {
        this.ensureStageWaiting(input, stage.stageRef);
      }
      return decision.disposition === 'refuse' ? 'refused' : 'waiting';
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
  } | null {
    let detail = this.detail(input);
    let stage = detail.stages.find((candidate) => candidate.stageRef === initial.stageRef) as Stage;
    let attempt = getCurrentAttempt(detail, stage);
    const routing = effectiveWorkerRouting(detail, stage, proposalStage);
    if (attempt?.state === 'interrupted' && attempt.generation >= this.options.budget.maxAttempts) {
      this.createBoundary(input, stage, 'intervention', stableHumanTitle('budget', stage.stageId, 'attempts'), 'automatic attempt budget exhausted');
      return null;
    }
    if (!attempt || attempt.state === 'interrupted') {
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
    let session = getSession(detail, attempt.managedSessionRef);
    if (!session) {
      const created = this.options.store.createWorkerSession(input.subject, attempt.attemptRef, { expectedAttemptVersion: attempt.version });
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
    if (session.state === 'pending') session = this.transitionSession(input, session.sessionRef, 'starting');
    if (session.state === 'starting') session = this.transitionSession(input, session.sessionRef, 'running');
    attempt = this.detail(input).attempts.find((candidate) => candidate.attemptRef === attempt?.attemptRef) as Attempt;
    if (attempt.state === 'starting') attempt = this.transitionAttempt(input, attempt.attemptRef, 'running');
    return {
      stage: this.detail(input).stages.find((candidate) => candidate.stageRef === stage.stageRef) as Stage,
      proposalStage, attempt, session, profile, assignedAgent,
    };
  }

  private async executeAttempt(
    input: ExecuteRunInput,
    prepared: {
      stage: Stage; proposalStage: ProposalStage; attempt: Attempt; session: ManagedSession;
      profile: ExecutionProfile; assignedAgent: ResolvedAssignedAgent | null;
    },
    policy: PolicyEnvironment,
  ): Promise<({ state: 'succeeded' | 'waiting-human' | 'stopped'; stageId: string })> {
    try {
      return await this.executeAttemptUnsafe(input, prepared, policy);
    } catch (error) {
      if (this.cancellationObserved(input)) return { state: 'stopped', stageId: prepared.stage.stageId };
      const current = this.detail(input);
      const attempt = current.attempts.find((item) => item.attemptRef === prepared.attempt.attemptRef);
      const session = current.sessions.find((item) => item.sessionRef === prepared.session.sessionRef);
      if (attempt && (attempt.state === 'starting' || attempt.state === 'running')) {
        this.transitionAttempt(input, attempt.attemptRef, 'interrupted');
      }
      if (session && (session.state === 'starting' || session.state === 'running')) {
        this.transitionSession(input, session.sessionRef, 'interrupted');
      }
      this.transitionStageByRef(input, prepared.stage.stageRef, 'interrupted');
      this.options.store.appendEvent(input.subject, input.runRef, {
        kind: 'lifecycle', source: 'system', stageRef: prepared.stage.stageRef,
        attemptRef: prepared.attempt.attemptRef, sessionRef: prepared.session.sessionRef,
        status: 'interrupted', summary: error instanceof Error ? error.message : 'execution adapter failed',
      });
      const latest = this.detail(input).stages.find((item) => item.stageRef === prepared.stage.stageRef) as Stage;
      this.createBoundary(
        input,
        latest,
        'intervention',
        stableHumanTitle('execution', latest.stageId, prepared.attempt.attemptRef),
        error instanceof Error ? error.message : 'execution adapter failed',
      );
      return { state: 'waiting-human', stageId: prepared.stage.stageId };
    }
  }

  private async executeAttemptUnsafe(
    input: ExecuteRunInput,
    prepared: {
      stage: Stage; proposalStage: ProposalStage; attempt: Attempt; session: ManagedSession;
      profile: ExecutionProfile; assignedAgent: ResolvedAssignedAgent | null;
    },
    policy: PolicyEnvironment,
  ): Promise<({ state: 'succeeded' | 'waiting-human' | 'stopped'; stageId: string })> {
    const { stage, proposalStage, attempt, session, profile, assignedAgent } = prepared;
    const operationKey = `automatic-attempt:${attempt.attemptRef}`;
    const resultOperationKey = canonicalResultOperationKey(input.runRef, stage.stageId);
    const worktreePath = planAttemptWorktreePath(this.options.worktreeRoot, input.runRef, attempt.attemptRef);
    const reviewedGeneration = proposalStage.review !== undefined
      || this.detail(input).reviewLoops.some((loop) => loop.subjectStageRef === stage.stageRef);
    const integrated = await this.options.results.lookup({
      operationKey: resultOperationKey,
      subject: input.subject,
      runRef: input.runRef,
      stageId: stage.stageId,
    });
    if (this.cancellationObserved(input)) return { state: 'stopped', stageId: stage.stageId };
    if (integrated) {
      const expectedHash = canonicalStageResultHash(integrated);
      if (integrated.resultHash !== expectedHash || !resultIsSafe(
        proposalStage,
        {
          state: 'succeeded', summary: integrated.summary, usage: { inputTokens: 0, outputTokens: 0, costUsdMicros: 0 },
          artifacts: [...integrated.artifacts], checkpoints: [...integrated.checkpoints],
          ...(integrated.reviewOutcome ? { reviewOutcome: integrated.reviewOutcome } : {}),
        },
        { changed: integrated.changed },
      ) || ((integrated.reviewOutcome !== undefined || reviewedGeneration) && !hasImmutableLineage(integrated))) {
        throw new AutomaticExecutionError('persisted canonical result failed reconciliation');
      }
      this.options.store.appendEvent(input.subject, input.runRef, {
        kind: 'lifecycle', source: 'system', stageRef: stage.stageRef, attemptRef: attempt.attemptRef,
        sessionRef: session.sessionRef, status: 'success', summary: 'reconciled previously integrated canonical result',
      });
      this.transitionSession(input, session.sessionRef, 'completed');
      this.transitionAttempt(input, attempt.attemptRef, 'succeeded');
      this.transitionStageByRef(input, stage.stageRef, 'succeeded');
      return { state: 'succeeded', stageId: stage.stageId };
    }
    let baseCommit: string | undefined;
    if (proposalStage.dependsOn.length > 0) {
      if (!this.options.results.resolveBase) {
        throw new AutomaticExecutionError('result integrator cannot resolve committed dependency lineage');
      }
      baseCommit = await this.options.results.resolveBase({
        operationKey: `result-base:${input.runRef}:${stage.stageId}`,
        subject: input.subject,
        runRef: input.runRef,
        stageId: stage.stageId,
        dependencyStageIds: [...proposalStage.dependsOn].sort(),
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
      limits: this.options.budget,
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
    let result: WorkerExecutionResult;
    try {
      result = await this.options.workers.execute({
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
        ...(assignedAgent ? { assignment: assignedAgent.assignment, instructionMarkdown: assignedAgent.instructionMarkdown } : {}),
      });
    } catch (error) {
      result = {
        state: 'failed', summary: error instanceof Error ? error.message : 'worker adapter failed',
        usage: { inputTokens: 0, outputTokens: 0, costUsdMicros: 0 }, artifacts: [], checkpoints: [],
      };
    }
    assertUsage(result.usage);
    await this.options.accounting.settle({
      operationKey: `settle:${attempt.attemptRef}`,
      reservationRef: reservation.value.reservationRef,
      usage: result.usage,
    });
    if (this.cancellationObserved(input)) return { state: 'stopped', stageId: stage.stageId };
    const inspection = result.state === 'succeeded'
      ? await this.options.worktrees.inspect({ operationKey: `inspect:${attempt.attemptRef}`, runRef: input.runRef, path: worktreePath })
      : { changed: [] };
    if (this.cancellationObserved(input)) return { state: 'stopped', stageId: stage.stageId };
    if (!resultIsSafe(proposalStage, result, inspection)) {
      result = { ...result, state: 'failed', summary: 'worker result exceeded the approved canonical result envelope', artifacts: [], checkpoints: [] };
    }
    if (result.state === 'succeeded' && proposalStage.review && result.reviewOutcome === undefined) {
      result = { ...result, state: 'failed', summary: 'checker succeeded without a validated review outcome', artifacts: [], checkpoints: [] };
    }
    if (result.state === 'succeeded' && result.reviewOutcome) {
      const validated = validatedReviewOutcome(proposalStage, result.reviewOutcome);
      if (!validated) {
        result = { ...result, state: 'failed', summary: 'checker review outcome failed validation', artifacts: [], checkpoints: [] };
      } else {
        result = { ...result, reviewOutcome: validated };
      }
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
        ...(result.reviewOutcome ? { reviewOutcome: result.reviewOutcome } : {}),
      };
      const resultHash = canonicalStageResultHash(canonical);
      const integratedResult = await this.options.results.integrate({
        operationKey: resultOperationKey,
        subject: input.subject,
        runRef: input.runRef,
        stageRef: stage.stageRef,
        stageId: stage.stageId,
        attemptRef: attempt.attemptRef,
        canonicalCardRef: stage.canonicalCardRef as string,
        summary: result.summary,
        artifacts: result.artifacts,
        changed: inspection.changed,
        checkpoints: result.checkpoints,
        ...(result.reviewOutcome ? { reviewOutcome: result.reviewOutcome } : {}),
        ...(result.reviewOutcome ? { reviewContract: { review: proposalStage.review as NonNullable<typeof proposalStage.review> } } : {}),
        resultHash,
        worktreePath,
      });
      if (this.cancellationObserved(input)) return { state: 'stopped', stageId: stage.stageId };
      if (integratedResult.resultHash !== resultHash) throw new AutomaticExecutionError('canonical result replay hash differs');
      if ((result.reviewOutcome || reviewedGeneration) && !hasImmutableLineage(integratedResult)) {
        throw new AutomaticExecutionError('reviewed canonical result lacks immutable lineage');
      }
      this.transitionSession(input, session.sessionRef, 'completed');
      this.transitionAttempt(input, attempt.attemptRef, 'succeeded');
      this.transitionStageByRef(input, stage.stageRef, 'succeeded');
      await this.cleanupAttemptWorktree(input, stage, attempt, worktreePath);
      return { state: 'succeeded', stageId: stage.stageId };
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
    const state = this.detail(input).run.state;
    return this.cancellingRuns.has(lockKey) || state === 'stopping' || state === 'stopped' || state === 'interrupted';
  }

  private async settleRunState(input: ExecuteRunInput): Promise<RunDetail['run']> {
    const detail = this.detail(input);
    if (detail.run.state === 'stopping' || detail.run.state === 'stopped') return detail.run;
    if (detail.stages.every((stage) => stage.state === 'succeeded')) {
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
    if (detail.stages.some((stage) => stage.state === 'failed' || stage.state === 'stopped')) return this.transitionRun(input, 'failed');
    if (detail.stages.some((stage) => stage.state === 'waiting-human')) return this.transitionRun(input, 'waiting-human');
    return detail.run;
  }

  private transitionRun(input: ExecuteRunInput, state: RunDetail['run']['state']): RunDetail['run'] {
    const run = this.detail(input).run;
    if (run.state === state) return run;
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

  private transitionAttempt(input: ExecuteRunInput, attemptRef: string, state: Attempt['state']): Attempt {
    const attempt = this.detail(input).attempts.find((candidate) => candidate.attemptRef === attemptRef);
    if (!attempt) throw new AutomaticExecutionError('attempt disappeared');
    if (attempt.state === state) return attempt;
    const result = this.options.store.transitionAttempt(input.subject, attemptRef, attempt.version, state);
    if (!result.ok) throw new AutomaticExecutionError(result.detail);
    return result.value;
  }

  private transitionSession(input: ExecuteRunInput, sessionRef: string, state: ManagedSession['state']): ManagedSession {
    const session = this.detail(input).sessions.find((candidate) => candidate.sessionRef === sessionRef);
    if (!session) throw new AutomaticExecutionError('session disappeared');
    if (session.state === state) return session;
    const result = this.options.store.transitionSession(input.subject, sessionRef, session.version, state);
    if (!result.ok) throw new AutomaticExecutionError(result.detail);
    return result.value;
  }
}
