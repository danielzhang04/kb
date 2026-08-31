// P4 §3.6 — the closed System-schedule → execution-path resolver and the seven execution paths.
//
// This module maps EACH of the seven seeded System schedule IDs to EXACTLY ONE execution path
// (`design:314-376`). There is no compatibility adapter and no flag: an unknown schedule ID, or a
// schedule fired against the wrong agent, fails HERE — before any engine or worker is launched.
//
// The five proposal PRODUCERS (Lessons Miner, Grader, Model Audit, Hygiene, Context Lifecycle) publish
// deterministic `status: proposed` record batches through the ONE durable publisher in COORDINATION mode
// (purpose `learning-proposal`): a direct `ops` push, no PR, no Daniel merge — so NONE of them requires
// `durablePrWrites` [P4-C13]. Only the Learnings Implementer opens a PR (`learning-implementation`) and
// therefore requires `durablePrWrites`; the schedule mirror is the other durablePrWrites consumer, but
// it is a Sweeper-driven effect, not one of these seven schedule paths. The System Sweeper receives only
// READ ports and emits intents — it never mutates.
//
// Every effectful capability (engine, record render, record write, publish, PR-merge read) is INJECTED,
// so this module holds no git/write/spawn capability of its own: server code supplies metadata, renders
// records/intents, validates every worker-suggested target through the wall, and invokes the permitted
// publisher. Worker prose can authorize no path, actor, revision, or tool.
//
// SCOPE / P7 WIRING DISCLOSURE (read before wiring a live fire path):
// `resolveExecutionPath`, the `run*` runners (`runProposalProducer` / `runLearningsImplementer` /
// `runSystemSweeper`), and `implementerBatchRegistry.record()` are the dashboard-side execution-path
// LIBRARY plus its fail-closed VALIDATION — pure, injected, unit-tested. They are NOT self-wired.
// The live integration — a real schedule FIRE -> `resolveExecutionPath` -> the matching `run*` ->
// `implementerBatchRegistry.record()` (which is what populates the open-Implementer-batch registry the
// `startMergePollTimer` retire arm polls) — is a RUNTIME / dispatcher wiring step owned by P7, because
// it needs Daniel's live dispatcher and environment. Consequently, TODAY: the mirror-merged arm of the
// merge poll is live end-to-end, while the Implementer / `learning-record-retire` arm is exercised only
// by tests and the timer's read loop and has NO production fire path yet — nothing calls `.record()` in
// production, so `readOpenImplementerBatches` is `[]` and a retire cannot fire until P7 lands the wiring.
import {
  PROPOSAL_CANDIDATE_CAP,
  type ProposalEvidenceRow, type ProposalKind, type ProposalRecord,
} from './contracts.ts';
import {
  selectImplementerBatch, type BatchSelectionOptions, type LearningBatch, type SkippedRecord,
  type TargetWallPorts,
} from './targetWall.ts';
import type { LearningBatchManifestInput } from '../write/durableManifestService.ts';
import type { DurablePathManifest, RouteDurableReceipt } from '../write/durableManifest.ts';
import {
  assertCoordinationRoot, resolveRepositoryPin, RepositoryPinError,
  type DirectoryProbe, type GitRemoteReader, type RepositoryPin,
} from '../runtime/repoPin.ts';
import {
  resolveMergedPullRequests, type ImplementerBatchRef, type MergePollDeps, type MergePollOutcome,
} from '../reconciliation/mergePoll.ts';
import { runSweeper, type SweeperContext, type SweeperOutcome, type SweeperReadPorts } from '../reconciliation/sweeper.ts';

// --- The closed schedule → path map -------------------------------------------------------------

/** The three shapes a System schedule execution can take. */
export type ExecutionPathKind = 'proposal-producer' | 'learnings-implementer' | 'system-sweeper';

/**
 * One resolved execution path. `producedKind` is set only for a producer (the sole `ProposalKind` it may
 * emit); `requiresDurablePrWrites` is `true` for the Implementer alone among these seven paths [P4-C13].
 */
export interface ExecutionPathDescriptor {
  readonly scheduleId: SystemScheduleId;
  readonly agentId: string;
  readonly kind: ExecutionPathKind;
  readonly engine: string;
  readonly producedKind: ProposalKind | null;
  readonly requiresDurablePrWrites: boolean;
  /** The single capability/output the seed declaration must name accurately (§5 W6.3). */
  readonly outputSchema: 'kb.learning-proposal/v1' | 'kb.reconciliation-intent/v1';
}

/** The seven seeded System schedule IDs — the closed domain of {@link resolveExecutionPath}. */
export const SYSTEM_SCHEDULE_IDS = [
  'lessons-miner',
  'grader',
  'model-audit',
  'hygiene',
  'context-lifecycle',
  'learnings-implementer',
  'system-sweeper',
] as const;
export type SystemScheduleId = (typeof SYSTEM_SCHEDULE_IDS)[number];

const PRODUCER = (
  scheduleId: SystemScheduleId, engine: string, producedKind: ProposalKind,
): ExecutionPathDescriptor => ({
  scheduleId,
  agentId: scheduleId,
  kind: 'proposal-producer',
  engine,
  producedKind,
  requiresDurablePrWrites: false,
  outputSchema: 'kb.learning-proposal/v1',
});

/**
 * The closed map. Each seed's `agentId` equals its schedule ID (the P2 seed declarations), so a fire
 * whose schedule and agent disagree is rejected by {@link resolveExecutionPath} before launch.
 */
export const SYSTEM_EXECUTION_PATHS: Readonly<Record<SystemScheduleId, ExecutionPathDescriptor>> = Object.freeze({
  // Producers. Lessons Miner runs `session_miner.py` + `agent_maintainer.py#run_fire(forecast=False)`;
  // the Grader runs `agent_evals.py#run_suite(record=False,include_model_judged=False)`; the remaining
  // three run their declared tool-free worker over capped named source bytes.
  'lessons-miner': PRODUCER('lessons-miner', 'session_miner.py+agent_maintainer.run_fire', 'lesson'),
  'grader': PRODUCER('grader', 'agent_evals.run_suite', 'grade-finding'),
  'model-audit': PRODUCER('model-audit', 'tool-free-worker', 'model-audit'),
  'hygiene': PRODUCER('hygiene', 'tool-free-worker', 'hygiene'),
  'context-lifecycle': PRODUCER('context-lifecycle', 'tool-free-worker', 'context-lifecycle'),
  // The Implementer is the ONLY path that opens a PR, so it is the ONLY one that requires durablePrWrites.
  'learnings-implementer': {
    scheduleId: 'learnings-implementer',
    agentId: 'learnings-implementer',
    kind: 'learnings-implementer',
    engine: 'readProposedLearningRecords+selectImplementerBatch',
    producedKind: null,
    requiresDurablePrWrites: true,
    outputSchema: 'kb.learning-proposal/v1',
  },
  // The Sweeper is read-only: it emits reconciliation intents and never mutates.
  'system-sweeper': {
    scheduleId: 'system-sweeper',
    agentId: 'system-sweeper',
    kind: 'system-sweeper',
    engine: 'runSweeper',
    producedKind: null,
    requiresDurablePrWrites: false,
    outputSchema: 'kb.reconciliation-intent/v1',
  },
});

export class ExecutionResolutionError extends Error {
  readonly reason: 'unknown-schedule' | 'agent-mismatch';
  constructor(reason: ExecutionResolutionError['reason'], detail: string) {
    super(`execution path ${reason}: ${detail}`);
    this.name = 'ExecutionResolutionError';
    this.reason = reason;
  }
}

export function isSystemScheduleId(value: unknown): value is SystemScheduleId {
  return typeof value === 'string' && (SYSTEM_SCHEDULE_IDS as readonly string[]).includes(value);
}

/**
 * Resolve a schedule fire to its one execution path. An ID outside the closed seven, or an agent that
 * does not match the seed's declared owner, is refused HERE — before any engine or worker is launched.
 */
export function resolveExecutionPath(scheduleId: string, agentId: string): ExecutionPathDescriptor {
  if (!isSystemScheduleId(scheduleId)) {
    throw new ExecutionResolutionError('unknown-schedule', JSON.stringify(scheduleId));
  }
  const descriptor = SYSTEM_EXECUTION_PATHS[scheduleId];
  if (agentId !== descriptor.agentId) {
    throw new ExecutionResolutionError('agent-mismatch', `${JSON.stringify(scheduleId)} expects agent ${descriptor.agentId}, got ${JSON.stringify(agentId)}`);
  }
  return descriptor;
}

// --- Proposal producer execution ----------------------------------------------------------------

export class ExecutionEngineError extends Error {
  readonly stage: 'engine' | 'render' | 'publish';
  constructor(stage: ExecutionEngineError['stage'], detail: string) {
    super(`producer ${stage} failed: ${detail}`);
    this.name = 'ExecutionEngineError';
    this.stage = stage;
  }
}

/** One candidate a producer engine emits. Its Evidence is inert string data, never executed. */
export interface ProposalCandidate {
  readonly kind: ProposalKind;
  readonly target: string;
  readonly evidence: readonly ProposalEvidenceRow[];
  readonly proposedChange: string;
}

/** A rendered record file: the coordination-checkout-relative path and its `status: proposed` bytes. */
export interface RenderedRecordFile {
  readonly relpath: string;
  readonly bytes: string;
}

export interface ProducerPorts {
  /** The path's engine, run for JSON output. May throw (timeout, engine failure) — classified below. */
  readonly runEngine: (descriptor: ExecutionPathDescriptor) => Promise<readonly ProposalCandidate[]>;
  /** Render the capped candidates to deterministic record files (the ONE Python parser/renderer). */
  readonly renderRecords: (
    descriptor: ExecutionPathDescriptor, candidates: readonly ProposalCandidate[], sourceRun: string,
  ) => Promise<readonly RenderedRecordFile[]>;
  /** Publish the rendered records to `ops` in COORDINATION mode — no PR. */
  readonly publishCoordination: (
    manifestInput: { sourceAgent: string; sourceRun: string; baseCommit: string; recordPaths: readonly string[] },
    files: readonly RenderedRecordFile[],
  ) => Promise<RouteDurableReceipt>;
  readonly baseCommit: () => Promise<string>;
}

export type ProducerOutcome =
  | { readonly published: true; readonly recordPaths: readonly string[]; readonly receipt: RouteDurableReceipt }
  | { readonly published: false; readonly reason: 'no-candidates' };

/**
 * Run one proposal producer. Zero candidates is a successful no-op that publishes nothing. More than the
 * per-fire cap of five REJECTS the fire (the two-digit ordinal grammar is only total below the cap). The
 * publish is COORDINATION mode, so a producer never touches `durablePrWrites`.
 */
export async function runProposalProducer(
  descriptor: ExecutionPathDescriptor, sourceRun: string, ports: ProducerPorts,
): Promise<ProducerOutcome> {
  if (descriptor.kind !== 'proposal-producer' || descriptor.producedKind === null) {
    throw new ExecutionEngineError('engine', `${descriptor.scheduleId} is not a proposal producer`);
  }
  let candidates: readonly ProposalCandidate[];
  try {
    candidates = await ports.runEngine(descriptor);
  } catch (error) {
    throw new ExecutionEngineError('engine', error instanceof Error ? error.message : String(error));
  }
  // A producer emits AT MOST five candidates of its sole declared kind. A wrong kind or an over-cap fire
  // is a hard reject, never a silent truncation.
  for (const candidate of candidates) {
    if (candidate.kind !== descriptor.producedKind) {
      throw new ExecutionEngineError('engine', `candidate kind ${candidate.kind} is not ${descriptor.producedKind}`);
    }
  }
  if (candidates.length > PROPOSAL_CANDIDATE_CAP) {
    throw new ExecutionEngineError('engine', `${candidates.length} candidates exceed the cap of ${PROPOSAL_CANDIDATE_CAP}`);
  }
  if (candidates.length === 0) return { published: false, reason: 'no-candidates' };

  let files: readonly RenderedRecordFile[];
  try {
    files = await ports.renderRecords(descriptor, candidates, sourceRun);
  } catch (error) {
    throw new ExecutionEngineError('render', error instanceof Error ? error.message : String(error));
  }
  const recordPaths = files.map((file) => file.relpath).sort();
  const baseCommit = await ports.baseCommit();
  let receipt: RouteDurableReceipt;
  try {
    receipt = await ports.publishCoordination(
      { sourceAgent: descriptor.agentId, sourceRun, baseCommit, recordPaths },
      files,
    );
  } catch (error) {
    throw new ExecutionEngineError('publish', error instanceof Error ? error.message : String(error));
  }
  if (receipt.mode !== 'coordination') {
    throw new ExecutionEngineError('publish', 'a proposal producer must publish in coordination mode, not open a PR');
  }
  return { published: true, recordPaths, receipt };
}

// --- Learnings Implementer execution ------------------------------------------------------------

export class ImplementerCapabilityError extends Error {
  constructor(detail: string) {
    super(`learnings implementer refused: ${detail}`);
    this.name = 'ImplementerCapabilityError';
  }
}

export interface ImplementerPorts {
  /** Read every `status: proposed` record from the READ-ONLY coordination checkout [P4-C39]. */
  readonly readProposed: (coordinationRoot: string) => readonly ProposalRecord[];
  /** The target wall's Python/lstat ports, forwarded to `selectImplementerBatch`. */
  readonly wallPorts: TargetWallPorts;
  /** Open the ONE PR: stage the validated targets PLUS the batch records rewritten to `implemented`. */
  readonly publishImplementation: (
    batch: LearningBatch, manifest: DurablePathManifest,
  ) => Promise<RouteDurableReceipt>;
  readonly baseCommit: () => Promise<string>;
  readonly implementedAt: () => string;
  /** The composition-resolved `durablePrWrites` capability; the Implementer is fail-closed without it. */
  readonly durablePrWrites: boolean;
  /** Build the `learning-implementation` manifest (targets + records) from the selected batch. */
  readonly buildManifest: (batch: LearningBatchManifestInput) => DurablePathManifest;
}

export type ImplementerOutcome =
  | {
    readonly published: true;
    readonly batch: LearningBatch;
    readonly staged: readonly string[];
    readonly skipped: readonly SkippedRecord[];
    readonly receipt: RouteDurableReceipt;
  }
  | { readonly published: false; readonly skipped: readonly SkippedRecord[]; readonly reason: 'no-candidates' };

/**
 * Run the Learnings Implementer. It reads at most five `status: proposed` records from the read-only
 * coordination checkout, batches wall-clearing `lesson` AND `agent-improvement` records, and skips every
 * other record — including one of those two kinds pointing outside the wall — WITHOUT error and WITHOUT
 * changing its status [P4-C22]. A batch of zero candidates opens no PR. The single PR stages exactly the
 * validated targets plus the batch record files rewritten to `status: implemented` [P4-C13].
 */
export async function runLearningsImplementer(
  coordinationRoot: string, ports: ImplementerPorts,
): Promise<ImplementerOutcome> {
  // Fail closed: opening a PR requires the durable-PR capability. A producer never reaches here.
  if (!ports.durablePrWrites) {
    throw new ImplementerCapabilityError('durablePrWrites is unavailable, so no learning-implementation PR may open');
  }
  const records = ports.readProposed(coordinationRoot);
  const baseCommit = await ports.baseCommit();
  const options: BatchSelectionOptions = {
    repoRoot: coordinationRoot,
    baseCommit,
    implementedAt: ports.implementedAt(),
    ports: ports.wallPorts,
  };
  const selection = await selectImplementerBatch(records, options);
  if (!selection.ok) {
    throw new ImplementerCapabilityError(`${selection.reason}: ${selection.detail}`);
  }
  if (selection.batch === null) {
    return { published: false, skipped: selection.skipped, reason: 'no-candidates' };
  }
  const batch = selection.batch;
  const manifest = ports.buildManifest({
    batchId: batch.batchId,
    baseCommit: batch.baseCommit,
    implementedAt: batch.implementedAt,
    targetPaths: batch.targetPaths,
    recordPaths: batch.recordPaths,
  });
  const receipt = await ports.publishImplementation(batch, manifest);
  return { published: true, batch, staged: manifest.relpaths, skipped: selection.skipped, receipt };
}

// --- System Sweeper execution -------------------------------------------------------------------

/**
 * Run the System Sweeper. It receives ONLY read ports; the intent-capped output is returned for THE ONE
 * reconciliation publisher to apply. This module never applies a Sweeper intent — it only builds them.
 */
export async function runSystemSweeper(
  readPorts: SweeperReadPorts, context: SweeperContext,
): Promise<SweeperOutcome> {
  return runSweeper(readPorts, context);
}

// --- Open Implementer batch registry (the merge-poll source) ------------------------------------

/**
 * The source of open Implementer batch PRs the merge poll resolves. This is what W6.2 built the
 * `learning-record-retire` action against but did NOT wire a timer for; W6.3 wires the poll from here.
 */
export type OpenImplementerBatchSource = () => Promise<readonly ImplementerBatchRef[]>;

/**
 * Tracks the Implementer-batch PRs opened this process, keyed by `batch-id`, so the merge poll knows
 * which PRs to resolve and which records each merge supersedes. It is in-memory ON PURPOSE: the retire
 * action carries its OWN persistent operation-key receipt (proven-merge-only, replay-safe), so a restart
 * that forgets an open batch cannot double-retire — the batch simply is not re-polled until re-opened.
 * The registry never mutates: `list` feeds the read-only poll, `forget` drops a batch after it retires.
 */
export interface ImplementerBatchRegistry {
  record(ref: ImplementerBatchRef): void;
  list(): readonly ImplementerBatchRef[];
  forget(batchId: string): void;
}

export function createImplementerBatchRegistry(): ImplementerBatchRegistry {
  const open = new Map<string, ImplementerBatchRef>();
  return {
    record: (ref) => { open.set(ref.batchId, ref); },
    list: () => [...open.values()],
    forget: (batchId) => { open.delete(batchId); },
  };
}

/**
 * Derive the open-Implementer-batch PR ref for a freshly published batch. The PR arm of the receipt is
 * required; a coordination receipt here is a caller error (the Implementer opens a PR, never a push).
 */
export function implementerBatchRef(batch: LearningBatch, receipt: RouteDurableReceipt): ImplementerBatchRef {
  if (receipt.mode !== 'pr') {
    throw new ImplementerCapabilityError('an Implementer batch must be published as a PR to be polled');
  }
  return {
    batchId: batch.batchId,
    recordPaths: [...batch.recordPaths],
    pr: { owner: receipt.pr.owner, repo: receipt.pr.repo, number: receipt.pr.number },
  };
}

// --- Merge-poll timer ---------------------------------------------------------------------------

export interface MergePollTimerOptions {
  readonly intervalMs: number;
  /** Run one poll immediately at start (the boot sweep), like the Human Request sweeper. Default true. */
  readonly runImmediately?: boolean;
  readonly onPoll?: (outcome: MergePollOutcome) => void;
  readonly onError?: (error: unknown) => void;
}

/**
 * Start the read-only merge-poll timer. On each tick it resolves every tracked PR ONCE through
 * `resolveMergedPullRequests`, whose `readOpenImplementerBatches` source feeds the learning-record-retire
 * action on a confirmed Implementer-batch merge and whose `readOpenMirrorBatch` feeds `mirror-merged`.
 * Every effect flows through the one publisher; the timer itself mutates nothing. Returns a stop handle.
 */
export function startMergePollTimer(deps: MergePollDeps, options: MergePollTimerOptions): () => void {
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return; // never overlap two polls
    running = true;
    try {
      const outcome = await resolveMergedPullRequests(deps);
      options.onPoll?.(outcome);
    } catch (error) {
      options.onError?.(error);
    } finally {
      running = false;
    }
  };
  const handle = setInterval(() => { void tick(); }, options.intervalMs);
  if (typeof handle === 'object' && handle !== null && 'unref' in handle) handle.unref();
  if (options.runImmediately !== false) void tick();
  return () => { clearInterval(handle); };
}

// --- Composition-time coordination-root resolution ----------------------------------------------

export interface SystemExecutionComposition {
  /** The validated coordination checkout (absolute, `queue/` present). */
  readonly coordinationRoot: string;
  /** The pinned GitHub repo, or `null` when the remote is not a pinnable GitHub repo (degraded). */
  readonly repoPin: RepositoryPin | null;
  /** True when PR-dependent paths are degraded because the remote could not be pinned. */
  readonly prSourceDegraded: boolean;
}

/**
 * Compose the System execution surface at boot. `assertCoordinationRoot` STAYS eager fail-closed [P4-C39]:
 * a non-absolute root or a root without a `queue/` directory refuses composition. `resolveRepositoryPin`
 * DEGRADES: a legitimate kb deployment whose `origin` is not a GitHub repo (the WSL oracle, local dev)
 * must still boot, so a `RepositoryPinError` disables the PR-dependent paths rather than crashing the
 * daemon — consistent with W6.1's degrade ruling. Only an UNEXPECTED error propagates.
 * Note: this boot-composition helper is the intended single fail-closed entry, exercised today by its
 * own test; index.ts still open-codes `resolveRepositoryPin` alone, so the eager `assertCoordinationRoot`
 * lands only when W6.1's composition adopts this helper (P4-C39) — no safety gap, just not yet the caller.
 */
export function composeSystemExecution(input: {
  coordinationRoot: string;
  readRemote?: GitRemoteReader;
  directoryProbe?: DirectoryProbe;
}): SystemExecutionComposition {
  const coordinationRoot = assertCoordinationRoot(input.coordinationRoot, input.directoryProbe);
  let repoPin: RepositoryPin | null = null;
  let prSourceDegraded = false;
  try {
    repoPin = resolveRepositoryPin(coordinationRoot, input.readRemote);
  } catch (error) {
    if (!(error instanceof RepositoryPinError)) throw error;
    prSourceDegraded = true;
  }
  return { coordinationRoot, repoPin, prSourceDegraded };
}
