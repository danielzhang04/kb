import { createHash } from 'node:crypto';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { ControlPlaneStore } from './store.ts';
import type { Attempt, ManagedSession, RunDetail, Stage } from './types.ts';
import { classifyActionRisk, evaluateExecutionPolicy, type ExecutionProfile, type PolicyEnvironment } from './policy.ts';
import { isSafeRepoRelativePath, proposalContentHash, type PlanProposal, type ProposalStage } from './proposal.ts';

const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
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
    skills: readonly string[];
    action: string;
    target: string;
    workOrder: string;
    readScope: readonly string[];
    writeScope: readonly string[];
    checkpoints: readonly string[];
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
    canonicalCardRef: string;
    summary: string;
    artifacts: readonly WorkerArtifactResult[];
    changed: readonly WorkerArtifactResult[];
    checkpoints: readonly string[];
    resultHash: string;
    worktreePath: string;
  }): Promise<{ status: 'integrated' | 'replayed'; resultHash: string }>;
}

export interface CanonicalStageResult {
  resultHash: string;
  summary: string;
  artifacts: readonly WorkerArtifactResult[];
  changed: readonly WorkerArtifactResult[];
  checkpoints: readonly string[];
}

export interface AutomaticExecutionOptions {
  store: ControlPlaneStore;
  policy: PolicyEnvironment;
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

export function canonicalStageResultHash(result: Omit<CanonicalStageResult, 'resultHash'>): string {
  const artifacts = [...result.artifacts].map((item) => ({ path: item.path, digest: item.digest })).sort((a, b) => a.path.localeCompare(b.path));
  const changed = [...result.changed].map((item) => ({ path: item.path, digest: item.digest })).sort((a, b) => a.path.localeCompare(b.path));
  const checkpoints = [...result.checkpoints].sort();
  return createHash('sha256').update(JSON.stringify({ summary: result.summary, artifacts, changed, checkpoints }), 'utf8').digest('hex');
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
    && result.checkpoints.every((checkpoint) => allowedCheckpoints.has(checkpoint));
}

function stableHumanTitle(kind: 'gate' | 'policy' | 'budget' | 'execution', stageId: string, detail: string): string {
  return `automatic:${kind}:${stageId}:${detail}`.slice(0, 240);
}

function profileFor(policy: PolicyEnvironment, role: 'manager' | 'worker', runtime: string, model: string): ExecutionProfile | null {
  return policy.profiles.find((profile) => profile.role === role && profile.runtime === runtime && profile.model === model) ?? null;
}

function restrictedIntent(stage: ProposalStage): { kind: 'refuse' | 'waiting'; reason: string } | null {
  const text = `${stage.action}\n${stage.workOrder}`.toLowerCase();
  if (/\b(?:credential|password|private key|api key|access token|secret)\b/.test(text)) {
    return { kind: 'refuse', reason: 'credential-handling-intent-is-forbidden' };
  }
  if (/\b(?:purchase|spend|payment|credit card|buy)\b/.test(text)) {
    return { kind: 'refuse', reason: 'real-spending-intent-is-forbidden' };
  }
  if (/\b(?:publish|publication|deploy|release externally|upload externally)\b/.test(text)) {
    return { kind: 'waiting', reason: 'external-publication-intent-requires-human-approval' };
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
      if (!(await this.ensureManager(input))) {
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
          const boundary = this.stageBoundary(input, refreshed, stage, proposalStage);
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
          .map(({ stage, proposalStage }) => this.prepareOrContain(input, stage, proposalStage))
          .filter((item): item is NonNullable<typeof item> => item !== null);
        for (const item of prepared) if (!startedStageIds.includes(item.proposalStage.id)) startedStageIds.push(item.proposalStage.id);
        this.activeWorkers += prepared.length;
        let results: Awaited<ReturnType<AutomaticExecutionEngine['executeAttempt']>>[];
        try {
          results = await Promise.all(prepared.map((item) => this.executeAttempt(input, item)));
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

  private assertRunBinding(input: ExecuteRunInput): void {
    const detail = this.detail(input);
    if (proposalContentHash(input.proposal) !== detail.run.proposalHash) {
      throw new AutomaticExecutionError('proposal does not match the immutable run hash');
    }
    if (input.proposal.stages.length !== detail.stages.length) throw new AutomaticExecutionError('run graph does not match proposal graph');
    const runStages = new Map(detail.stages.map((stage) => [stage.stageId, stage]));
    for (const stage of input.proposal.stages) {
      const stored = runStages.get(stage.id);
      if (!stored || JSON.stringify([...stored.dependsOn].sort()) !== JSON.stringify([...stage.dependsOn].sort())) {
        throw new AutomaticExecutionError(`run graph differs at stage '${stage.id}'`);
      }
      if (!stored.canonicalCardRef) throw new AutomaticExecutionError(`stage '${stage.id}' lacks a canonical card link`);
    }
  }

  private async ensureManager(input: ExecuteRunInput): Promise<boolean> {
    let detail = this.detail(input);
    if ((detail.run.state === 'waiting-human' || detail.run.state === 'interrupted') && !runBoundariesAccepted(detail)) {
      return false;
    }
    const requested = input.proposal.manager;
    const profile = profileFor(this.options.policy, 'manager', requested.runtime, requested.model);
    if (!profile) throw new AutomaticExecutionError('manager is not a server-owned runtime profile');
    if (requested.requiredSkills.some((skill) => !this.options.policy.curatedSkills.has(skill))) {
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

  private stageBoundary(
    input: ExecuteRunInput,
    detail: RunDetail,
    stage: Stage,
    proposalStage: ProposalStage,
  ): 'allow' | 'waiting' | 'refused' {
    if (detail.humanRequests.some((request) => request.stageRef === stage.stageRef && request.state === 'open')) {
      this.ensureStageWaiting(input, stage.stageRef);
      return 'waiting';
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
    }, this.options.policy);
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

  private prepareOrContain(input: ExecuteRunInput, stage: Stage, proposalStage: ProposalStage): ReturnType<AutomaticExecutionEngine['prepareAttempt']> {
    try {
      return this.prepareAttempt(input, stage, proposalStage);
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

  private prepareAttempt(input: ExecuteRunInput, initial: Stage, proposalStage: ProposalStage): {
    stage: Stage;
    proposalStage: ProposalStage;
    attempt: Attempt;
    session: ManagedSession;
    profile: ExecutionProfile;
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
    const profile = profileFor(this.options.policy, 'worker', attempt.runtime, attempt.model);
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
    return { stage: this.detail(input).stages.find((candidate) => candidate.stageRef === stage.stageRef) as Stage, proposalStage, attempt, session, profile };
  }

  private async executeAttempt(
    input: ExecuteRunInput,
    prepared: { stage: Stage; proposalStage: ProposalStage; attempt: Attempt; session: ManagedSession; profile: ExecutionProfile },
  ): Promise<({ state: 'succeeded' | 'waiting-human' | 'stopped'; stageId: string })> {
    try {
      return await this.executeAttemptUnsafe(input, prepared);
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
    prepared: { stage: Stage; proposalStage: ProposalStage; attempt: Attempt; session: ManagedSession; profile: ExecutionProfile },
  ): Promise<({ state: 'succeeded' | 'waiting-human' | 'stopped'; stageId: string })> {
    const { stage, proposalStage, attempt, session, profile } = prepared;
    const operationKey = `automatic-attempt:${attempt.attemptRef}`;
    const resultOperationKey = `result:${input.runRef}:${stage.stageId}`;
    const worktreePath = planAttemptWorktreePath(this.options.worktreeRoot, input.runRef, attempt.attemptRef);
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
        { state: 'succeeded', summary: integrated.summary, usage: { inputTokens: 0, outputTokens: 0, costUsdMicros: 0 }, artifacts: [...integrated.artifacts], checkpoints: [...integrated.checkpoints] },
        { changed: integrated.changed },
      )) {
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
    if (!skills.ok || skills.skills.some((skill) => !this.options.policy.curatedSkills.has(skill))) {
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
        skills: skills.skills,
        action: proposalStage.action,
        target: proposalStage.target,
        workOrder: proposalStage.workOrder,
        readScope: proposalStage.scope.read,
        writeScope: proposalStage.scope.write,
        checkpoints: proposalStage.checkpoints.map((checkpoint) => checkpoint.id),
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
    this.options.store.appendEvent(input.subject, input.runRef, {
      kind: 'lifecycle', source: 'worker', stageRef: stage.stageRef, attemptRef: attempt.attemptRef,
      sessionRef: session.sessionRef, status: result.state === 'succeeded' ? 'success' : result.state === 'failed' ? 'failure' : 'waiting',
      summary: result.summary,
    });
    if (result.state === 'succeeded') {
      const canonical = { summary: result.summary, artifacts: result.artifacts, changed: inspection.changed, checkpoints: result.checkpoints };
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
        resultHash,
        worktreePath,
      });
      if (this.cancellationObserved(input)) return { state: 'stopped', stageId: stage.stageId };
      if (integratedResult.resultHash !== resultHash) throw new AutomaticExecutionError('canonical result replay hash differs');
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
