import { sha256Hex } from '../shared/hashing.ts';
import {
  boundSummary,
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_TIMEOUT_MS,
  buildAgentBindingPrompt,
  buildQueuedOperatorMessagePrompt,
  buildWorkerPrompt,
  encodeStreamJsonUserMessage,
  parseWorkerStream,
} from './claudeWorkerAdapter.ts';
import {
  buildReadScopeSettings,
  createWorkflowToolPolicyResolver,
  type ClaudeToolPolicy,
} from './claudeLaunchPolicy.ts';
import { parseCodexStream } from './codexResultParser.ts';
import { parseIterationOutcome } from './iterationOutcome.ts';
import type { AttemptIoSink } from './attemptIo.ts';
import { validateRelativeCwd } from '../pty/fdPinnedPaths.ts';
import {
  RUN_CONTROLLER_NULL_BROWSER_SESSION_REF,
  type ApprovedAttemptDeclaration,
  type ApprovedCheckpointInstruction,
  type ApprovedRunInstruction,
  type AttemptBindingPort,
  type AttemptExecutionPort,
  type AttemptLaunch,
  type AttemptOperationRecord,
  type AttemptOperationStatus,
  type AttemptParserContext,
  type AttemptStartReceipt,
  type HostLaunch,
  type HostRefusalCode,
  type HostStartReceipt,
  type ObservedExit,
  type OperationReceipt,
  type ParsedAttemptResult,
  type PortResult,
  type SessionDataFrame,
  type SessionHost,
  type SessionHostRequest,
  type SessionSink,
} from '../pty/contracts.ts';
import type { LaunchRecipe } from '../../shared/ptyProtocol.ts';

type WorkerExecutionResult = Awaited<AttemptLaunch['result']>;
type ExecutionUsage = WorkerExecutionResult['usage'];

const DEFAULT_STDERR_TAIL_CHARS = 4_000;
const DEFAULT_SUMMARY_MAX_CHARS = 60_000;
const TERMINAL_ATTEMPT_LIMIT = 32;
const RAW_AUTHORITY_FIELDS = new Set([
  'recipe', 'command', 'executable', 'args', 'argv', 'env', 'uid', 'user', 'host', 'token',
  'cwd', 'resumeRef',
]);
const ZERO_USAGE: ExecutionUsage = { inputTokens: 0, outputTokens: 0, costUsdMicros: 0 };
const TERMINAL_STATUSES: ReadonlySet<AttemptOperationStatus> = new Set(['cancelled', 'failed', 'completed']);

type ResumeRuntime = ApprovedAttemptDeclaration['profile']['runtime'];

interface ResolvedClaudeLaunchPolicy {
  workflowProfile: string;
  policy: ClaudeToolPolicy;
  settings: string | undefined;
}

export interface AttemptSessionRecorder {
  data(attempt: ApprovedAttemptDeclaration, frame: SessionDataFrame): void;
  exit(attempt: ApprovedAttemptDeclaration, exit: ObservedExit): void;
  closed(attempt: ApprovedAttemptDeclaration): boolean;
}

export interface AttemptSessionAdapterOptions {
  host: SessionHost;
  bindings: AttemptBindingPort;
  resolveClaudePolicy?: (workflowProfile: string | null) => ClaudeToolPolicy;
  /** Maps a validated server-owned Claude policy/settings pair to the host recipe table. */
  resolveClaudePolicyId?: (input: ResolvedClaudeLaunchPolicy) => string;
  resolveResumeRef?: (runtime: ResumeRuntime, runRef: string, agentId: string) => string | null;
  recordResumeRef?: (
    runtime: ResumeRuntime,
    runRef: string,
    agentId: string,
    resumeRef: string,
  ) => void | Promise<void>;
  parseResult?: (context: AttemptParserContext) => ParsedAttemptResult;
  recorder?: AttemptSessionRecorder;
  /**
   * Write-side seam of the durable per-attempt IO log. Every observed data frame is tapped into it, the
   * same tap the pre-port spawner held; the `attempt-io` route and the hub signal read from the other
   * side of the store, so losing this seam silently empties both.
   */
  attemptIo?: AttemptIoSink;
  /**
   * Durable operator messages queued while no attempt was live. Drained EXACTLY once, at the start of the
   * next attempt for the same (run, agent), and prepended in chain order to that attempt's own prompt.
   */
  drainMessages?: (runRef: string, agentId: string) => Promise<readonly string[]>;
  repoRoot?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  stderrTailChars?: number;
  summaryMaxChars?: number;
}

export interface AttemptSessionAdapter extends AttemptExecutionPort {
  /** Test/replay seam over the exact bytes received by the recorder sink. */
  rawTranscript(attemptRef: string): Uint8Array | null;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

interface PreparedAttempt {
  recipe: LaunchRecipe;
  prompts: Uint8Array[];
  agentId: string;
}

interface ActiveAttempt {
  input: ApprovedAttemptDeclaration;
  fingerprint: string;
  order: number;
  launch: AttemptLaunch;
  prepared: PreparedAttempt;
  hostLaunch: HostLaunch | null;
  /** Resolves with the host launch once phase 1 decides, or `null` when no session was created. */
  hostLaunchReady: Deferred<HostLaunch | null>;
  /** Streaming-decoded stdout; see `decodeChunk`. */
  readTranscript(): string;
  rawBytes(): Uint8Array;
  retainedBytes(): number;
  releaseTranscript(): void;
  outputLimitExceeded: boolean;
  timedOut: boolean;
  cancelled: boolean;
  exited: boolean;
  settled: boolean;
  sessionId: string | null;
  framesWritten: number;
  baselineClaudeResults: number;
  openingPromptsWritten: boolean;
  terminalCloseStarted: boolean;
  exit: Deferred<ObservedExit>;
  closePromise: Promise<PortResult<ObservedExit>> | null;
  cancelPromise: Promise<PortResult<ObservedExit>> | null;
  /** Last durable snapshot this instance observed. Never trusted for terminal decisions without a CAS. */
  record: AttemptOperationRecord | null;
  internalFailure: string | null;
  instructionResults: Map<string, { fingerprint: string; promise: Promise<boolean> }>;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => { resolvePromise = resolve; });
  return { promise, resolve: resolvePromise };
}

function failed(summary: string, usage: ExecutionUsage = ZERO_USAGE): WorkerExecutionResult {
  return { state: 'failed', summary: boundSummary(summary), usage, artifacts: [], checkpoints: [] };
}

function refusalResult(runtime: ResumeRuntime, refusal: PortResult<unknown>): WorkerExecutionResult {
  if (refusal.ok) return failed(`${runtime} attempt session failed without a refusal`);
  const detail = refusal.detail?.trim();
  return failed(`${runtime} attempt session start refused (${refusal.refusal})${detail ? `: ${detail}` : ''}`);
}

function safeCount(value: unknown): number {
  const numberValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) return 0;
  return Math.min(Math.floor(numberValue), Number.MAX_SAFE_INTEGER);
}

function codexUsage(event: Record<string, unknown>): ExecutionUsage {
  const usage = event.usage && typeof event.usage === 'object'
    ? event.usage as Record<string, unknown>
    : {};
  return {
    inputTokens: safeCount(usage.input_tokens),
    outputTokens: safeCount(usage.output_tokens),
    costUsdMicros: 0,
  };
}

function extractClaudeResumeRef(stdout: string): string | null {
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const event = JSON.parse(trimmed) as Record<string, unknown>;
      if (typeof event.session_id === 'string' && event.session_id.trim()) return event.session_id;
    } catch {
      // Diagnostic noise is intentionally tolerated by the retained Claude result parser too.
    }
  }
  return null;
}

export function parseAttemptResult(
  context: AttemptParserContext,
  limits: { timeoutMs?: number; maxOutputBytes?: number; stderrTailChars?: number; summaryMaxChars?: number } = {},
): ParsedAttemptResult {
  if (context.runtime === 'claude') {
    return {
      result: parseWorkerStream(context.stdout, context.stderrTail, context.exitCode, {
        timedOut: context.timedOut,
        exceeded: context.outputLimitExceeded,
        cancelled: context.cancelled,
        resultObserved: context.resultObserved,
        timeoutMs: limits.timeoutMs,
        maxOutputBytes: limits.maxOutputBytes,
        stderrTailChars: limits.stderrTailChars,
        summaryMaxChars: limits.summaryMaxChars,
        ...(context.iterationContract ? { iterationContract: context.iterationContract } : {}),
      }),
      resumeRef: extractClaudeResumeRef(context.stdout),
    };
  }

  const parsed = parseCodexStream(context.stdout);
  const usage = parsed.terminalEvent ? codexUsage(parsed.terminalEvent) : ZERO_USAGE;
  const stderrTail = context.stderrTail.trim();
  const timeoutMs = limits.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = limits.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  if (context.cancelled) {
    return { result: failed(`codex worker was cancelled. ${stderrTail}`.trim()), resumeRef: parsed.threadId };
  }
  if (context.timedOut) {
    return { result: failed(`codex worker timed out after ${timeoutMs}ms and was killed. ${stderrTail}`), resumeRef: parsed.threadId };
  }
  if (context.outputLimitExceeded) {
    return { result: failed(`codex worker output exceeded the ${maxOutputBytes}-byte cap and was killed. ${stderrTail}`), resumeRef: parsed.threadId };
  }
  if (context.exitCode !== 0) {
    return {
      result: failed(`codex worker exited with code ${context.exitCode ?? 'null'}. ${stderrTail}`, usage),
      resumeRef: parsed.threadId,
    };
  }
  if (!parsed.terminalEvent) {
    return {
      result: failed(`codex worker produced no turn.completed terminal event. ${stderrTail}`),
      resumeRef: parsed.threadId,
    };
  }
  if (context.iterationContract) {
    const outcome = parseIterationOutcome(parsed.finalMessage, context.iterationContract);
    if (!outcome.ok) return { result: failed(outcome.detail, usage), resumeRef: parsed.threadId };
    return {
      result: {
        state: 'succeeded', summary: boundSummary(outcome.value.summary), usage,
        artifacts: [], checkpoints: [], iterationOutcome: outcome.value,
      },
      resumeRef: parsed.threadId,
    };
  }
  return {
    result: {
      state: 'succeeded',
      summary: boundSummary(parsed.finalMessage || 'codex worker completed without a final agent message.'),
      usage,
      artifacts: [],
      checkpoints: [],
    },
    resumeRef: parsed.threadId,
  };
}

function containsRawAuthority(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((item) => containsRawAuthority(item, seen));
  for (const [key, child] of Object.entries(value)) {
    if (RAW_AUTHORITY_FIELDS.has(key)) return true;
    if (containsRawAuthority(child, seen)) return true;
  }
  return false;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonical(child)]));
  }
  return value;
}

export function attemptDeclarationFingerprint(input: ApprovedAttemptDeclaration): string {
  return sha256Hex(JSON.stringify(canonical(input)));
}

function attemptAgentId(input: ApprovedAttemptDeclaration): string {
  return input.assignment?.agentId ?? input.profile.id;
}

function prepareAttempt(
  input: ApprovedAttemptDeclaration,
  options: AttemptSessionAdapterOptions,
  queuedMessages: readonly string[] = [],
): PreparedAttempt {
  if (containsRawAuthority(input)) throw new Error('attempt declaration contains raw recipe authority');
  // [C-S4] pre-receipt: the SAME server-owned worktree-path validator the pinned launch path uses
  // (`pty/fdPinnedPaths.ts`) runs here, before any durable record or session exists, so an attempt whose
  // cwd is absolute, escapes the root, or carries control characters/reserved names refuses instead of
  // producing a receipt. Mode/ownership (special files, symlinks, setuid/setgid) is enforced by the same
  // module's `pinBrokerLaunch` at the host, which opens every component O_NOFOLLOW before exec.
  try { validateRelativeCwd(input.relativeCwd); } catch {
    throw new Error('attempt worktree cwd is not a safe server-owned relative path');
  }
  if ((input.assignment === undefined) !== (input.instructionMarkdown === undefined)) {
    throw new Error('attempt requires assignment and declaration instructions together');
  }
  if ((input.iterationContract === undefined) === (input.expectsIterationOutcome === true)) {
    throw new Error('attempt outcome fence requires an immutable iteration contract');
  }
  if (input.assignment && (
    input.assignment.runtime !== input.profile.runtime
    || input.assignment.model !== input.profile.model
    || input.assignment.profileId !== input.profile.id
    || input.instructionMarkdown === undefined
    || input.instructionMarkdown.trim() === ''
    || input.instructionMarkdown.length > 64 * 1024
    || input.instructionMarkdown.includes('\0')
  )) {
    throw new Error('attempt requires verified assignment provenance and safe declaration instructions');
  }
  if (input.iterationContract) {
    const recipient = input.iterationContract.iterationGroup.participants.find(
      (participant) => participant.participantId === input.iterationContract?.request.recipientParticipantId,
    );
    if (!recipient || recipient.stageRef !== input.proposalStage.id
      || (input.proposalStage.workflowProfile ?? null) !== input.workflowProfile) {
      throw new Error('attempt iteration recipient must match the approved stage and workflow profile');
    }
  }
  const agentId = attemptAgentId(input);
  const resumeRef = options.resolveResumeRef?.(input.profile.runtime, input.runRef, agentId) ?? null;
  const workOrderPrompt = buildWorkerPrompt({
    workOrder: input.workOrder,
    readScope: input.readScope,
    writeScope: input.writeScope,
    ...(input.profile.runtime === 'codex' && !resumeRef && input.instructionMarkdown !== undefined
      ? { agentDeclarationMarkdown: input.instructionMarkdown } : {}),
    ...(input.iterationContract
      ? { iterationContract: input.iterationContract, proposalStage: input.proposalStage } : {}),
  });
  // Operator text queued while nothing was live enters the NEXT attempt as inert data, ahead of the work
  // order and in chain order — never as instructions, never as argv.
  const prompt = queuedMessages.length === 0
    ? workOrderPrompt
    : `${buildQueuedOperatorMessagePrompt(queuedMessages)}\n${workOrderPrompt}`;

  if (input.profile.runtime === 'claude') {
    const resolvePolicy = options.resolveClaudePolicy ?? createWorkflowToolPolicyResolver();
    const policy = resolvePolicy(input.workflowProfile);
    if (input.workflowProfile === null) throw new Error('claude attempt has no workflow profile');
    const settings = buildReadScopeSettings({
      allowedTools: policy.allowedTools,
      readScope: input.readScope,
      writeScope: input.writeScope,
      repoRoot: options.repoRoot,
    });
    const toolPolicyId = options.resolveClaudePolicyId?.({
      workflowProfile: input.workflowProfile,
      policy,
      settings,
    }) ?? input.workflowProfile;
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(toolPolicyId)) {
      throw new Error('claude attempt resolved an invalid server-owned tool policy id');
    }
    const recipe: LaunchRecipe = {
      launcher: 'claude', mode: 'headless-json', model: input.profile.model,
      toolPolicyId, sandbox: 'claude-policy', ...(resumeRef ? { resumeRef } : {}),
    };
    const prompts = [
      ...(!resumeRef && input.instructionMarkdown !== undefined
        ? [encodeStreamJsonUserMessage(buildAgentBindingPrompt(input.instructionMarkdown))] : []),
      encodeStreamJsonUserMessage(prompt),
    ].map((value) => Buffer.from(value, 'utf8'));
    return { recipe, prompts, agentId };
  }

  const recipe: LaunchRecipe = {
    launcher: 'codex', mode: 'headless-json', model: input.profile.model,
    toolPolicyId: input.workflowProfile ?? input.profile.id,
    sandbox: 'codex-workspace-write', ...(resumeRef ? { resumeRef } : {}),
  };
  // In a PTY, EOT is the closed-contract equivalent of the old adapter's endStdin().
  return { recipe, prompts: [Buffer.from(`${prompt}\u0004`, 'utf8')], agentId };
}

function countClaudeResults(stdout: string): number {
  let count = 0;
  for (const line of stdout.split('\n')) {
    try {
      const event = JSON.parse(line.trim()) as Record<string, unknown>;
      if (event.type === 'result') count += 1;
    } catch {
      // The retained parsers tolerate non-JSON diagnostic lines.
    }
  }
  return count;
}

function observedExitFailure(sessionId: string, reason: ObservedExit['reason']): ObservedExit {
  return {
    sessionId,
    sequence: 0,
    exitCode: null,
    signal: null,
    reason,
    observedAt: new Date(0).toISOString(),
  };
}

function receiptStatus(status: AttemptOperationStatus): OperationReceipt['status'] {
  // `OperationReceipt` has no `completed`; a completed operation stayed bound to its session.
  return status === 'completed' ? 'bound' : status;
}

export function createAttemptSessionAdapter(options: AttemptSessionAdapterOptions): AttemptSessionAdapter {
  const attempts = new Map<string, ActiveAttempt>();
  const terminalOrder: string[] = [];
  let retainedTerminalBytes = 0;
  let order = 0;
  let draining = false;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const stderrTailChars = options.stderrTailChars ?? DEFAULT_STDERR_TAIL_CHARS;
  const summaryMaxChars = options.summaryMaxChars ?? DEFAULT_SUMMARY_MAX_CHARS;
  const parseResult = options.parseResult ?? ((context: AttemptParserContext) => parseAttemptResult(context, {
    timeoutMs, maxOutputBytes, stderrTailChars, summaryMaxChars,
  }));

  const refuse = (code: HostRefusalCode, detail: string): { ok: false; refusal: HostRefusalCode; detail: string } => ({
    ok: false, refusal: code, detail,
  });
  const refusedLaunch = (runtime: ResumeRuntime, result: PortResult<AttemptStartReceipt>): AttemptLaunch => ({
    receipt: Promise.resolve(result), result: Promise.resolve(refusalResult(runtime, result)),
  });
  const internal = (error: unknown): { ok: false; refusal: HostRefusalCode; detail: string } => ({
    ok: false, refusal: 'internal', detail: error instanceof Error ? error.message : String(error),
  });

  /**
   * Terminal attempts are evicted oldest-first, and eviction RELEASES the transcript the sink closure
   * still holds (`releaseTranscript` clears the very array handed to the host). Retention is bounded by
   * BOTH the count cap and one `maxOutputBytes` budget across all retained terminal attempts — never
   * 32x that. The newest terminal attempt is always kept so its result stays readable.
   * Non-terminal attempts are never retained past the host's live set: every `begin` eagerly starts a
   * result promise that ends in `settleAttempt`, so a non-settled entry always names a session the host
   * still owns.
   */
  const settleAttempt = (attempt: ActiveAttempt): void => {
    if (attempt.settled) return;
    attempt.settled = true;
    terminalOrder.push(attempt.input.operationKey);
    retainedTerminalBytes += attempt.retainedBytes();
    while (terminalOrder.length > 1
      && (terminalOrder.length > TERMINAL_ATTEMPT_LIMIT || retainedTerminalBytes > maxOutputBytes)) {
      const evicted = terminalOrder.shift();
      if (evicted === undefined) break;
      const victim = attempts.get(evicted);
      if (victim) {
        retainedTerminalBytes -= victim.retainedBytes();
        victim.releaseTranscript();
        attempts.delete(evicted);
      }
    }
  };

  const readRecord = async (operationKey: string): Promise<PortResult<AttemptOperationRecord | null>> => {
    try {
      return { ok: true, value: await options.bindings.readOperation(operationKey) };
    } catch (error) {
      return internal(error);
    }
  };

  const writeRecord = async (
    record: AttemptOperationRecord,
    expectedRevision: number | null,
  ): Promise<PortResult<AttemptOperationRecord>> => {
    try {
      return await options.bindings.writeOperation(record, expectedRevision);
    } catch (error) {
      return internal(error);
    }
  };

  const pendingRecord = (
    input: ApprovedAttemptDeclaration,
    fingerprint: string,
  ): AttemptOperationRecord => {
    const createdAt = new Date().toISOString();
    return {
      operationKey: input.operationKey,
      requestHash: fingerprint,
      status: 'pending',
      promptsDelivered: 0,
      sessionId: null,
      attemptRef: input.attemptRef,
      receipt: {
        operationKey: input.operationKey, requestHash: fingerprint, status: 'pending',
        sessionId: null, attemptRef: input.attemptRef, refusal: null, createdAt, settledAt: null,
      },
      revision: 0,
      updatedAt: createdAt,
    };
  };

  const nextRecord = (
    current: AttemptOperationRecord,
    patch: { status?: AttemptOperationStatus; promptsDelivered?: number; sessionId?: string | null; refusal?: HostRefusalCode | null },
  ): AttemptOperationRecord => {
    const status = patch.status ?? current.status;
    const updatedAt = new Date().toISOString();
    const sessionId = patch.sessionId === undefined ? current.sessionId : patch.sessionId;
    return {
      ...current,
      status,
      promptsDelivered: patch.promptsDelivered ?? current.promptsDelivered,
      sessionId,
      updatedAt,
      receipt: {
        operationKey: current.operationKey,
        requestHash: current.requestHash,
        status: receiptStatus(status),
        sessionId,
        attemptRef: current.attemptRef,
        refusal: patch.refusal === undefined ? (current.receipt?.refusal ?? null) : patch.refusal,
        createdAt: current.receipt?.createdAt ?? updatedAt,
        settledAt: TERMINAL_STATUSES.has(status) || status === 'bound' ? updatedAt : null,
      },
    };
  };

  /**
   * CAS over the durable record. The mutation closure always receives the CURRENT durable record, never
   * a caller-local snapshot, so a retry after `binding-conflict` re-applies the intent on top of the
   * winner's state instead of regressing a counter. A terminal record is never WRITTEN AT ALL: the guard
   * keys on `current.status` alone, not on whether this patch changes the status, so a status-preserving
   * patch (the prompt reservation, which sets only the counter) cannot land on a record another instance
   * cancelled between this caller's read and the CAS retry. A finished operation cannot be resurrected,
   * nor advanced, by a late writer.
   */
  const casRecord = async (
    attempt: ActiveAttempt,
    mutate: (current: AttemptOperationRecord) => AttemptOperationRecord,
  ): Promise<PortResult<AttemptOperationRecord>> => {
    for (let retry = 0; retry < 8; retry += 1) {
      let current = attempt.record;
      if (current === null || retry > 0) {
        const read = await readRecord(attempt.input.operationKey);
        if (!read.ok) return read;
        if (read.value === null) return refuse('internal', 'durable attempt operation disappeared');
        current = read.value;
        attempt.record = current;
      }
      if (TERMINAL_STATUSES.has(current.status)) {
        return current.status === 'cancelled'
          ? refuse('cancelled', 'attempt operation was durably cancelled')
          : refuse('binding-conflict', `attempt operation already ${current.status}`);
      }
      const next = mutate(current);
      const written = await writeRecord(next, current.revision);
      if (written.ok) {
        attempt.record = written.value;
        return written;
      }
      if (written.refusal !== 'binding-conflict') return written;
    }
    return refuse('internal', 'durable attempt operation changed too many times');
  };

  const settleRecord = async (
    attempt: ActiveAttempt,
    status: Extract<AttemptOperationStatus, 'failed' | 'cancelled' | 'completed'>,
    refusalCode: HostRefusalCode | null,
  ): Promise<void> => {
    if (attempt.record === null) return;
    if (TERMINAL_STATUSES.has(attempt.record.status)) return;
    // A terminal CAS loss means someone else already settled the operation; either way it is finished.
    await casRecord(attempt, (current) => nextRecord(current, { status, refusal: refusalCode }));
  };

  /**
   * Durable cancellation, keyed by `operationKey` and independent of this instance's map. A key with no
   * record yet gets a create-CAS tombstone (its `requestHash` is empty: a blind cancel has no declaration
   * to fingerprint), and a create that loses the race retries as an update over the winner's record.
   */
  const durablyCancel = async (
    operationKey: string,
    attempt: ActiveAttempt | null,
  ): Promise<PortResult<AttemptOperationRecord>> => {
    for (let retry = 0; retry < 8; retry += 1) {
      const read = await readRecord(operationKey);
      if (!read.ok) return read;
      const current = read.value;
      if (current === null) {
        const settledAt = new Date().toISOString();
        const requestHash = attempt?.fingerprint ?? '';
        const attemptRef = attempt?.input.attemptRef ?? null;
        const tombstone: AttemptOperationRecord = {
          operationKey, requestHash, status: 'cancelled', promptsDelivered: 0, sessionId: null, attemptRef,
          receipt: {
            operationKey, requestHash, status: 'cancelled', sessionId: null, attemptRef,
            refusal: 'cancelled', createdAt: settledAt, settledAt,
          },
          revision: 0, updatedAt: settledAt,
        };
        const written = await writeRecord(tombstone, null);
        if (written.ok) { if (attempt) attempt.record = written.value; return written; }
        if (written.refusal !== 'binding-conflict') return written;
        continue;
      }
      if (current.status === 'cancelled') {
        if (attempt) attempt.record = current;
        return { ok: true, value: current };
      }
      if (TERMINAL_STATUSES.has(current.status)) {
        return refuse('binding-conflict', `attempt operation already ${current.status}`);
      }
      const written = await writeRecord(
        nextRecord(current, { status: 'cancelled', refusal: 'cancelled' }),
        current.revision,
      );
      if (written.ok) { if (attempt) attempt.record = written.value; return written; }
      if (written.refusal !== 'binding-conflict') return written;
    }
    return refuse('internal', 'durable attempt operation changed too many times');
  };

  const terminalRefusal = (record: AttemptOperationRecord): PortResult<AttemptStartReceipt> | null => {
    if (record.status === 'cancelled') return refuse('cancelled', 'attempt operation was durably cancelled');
    if (record.status === 'failed') {
      return refuse(record.receipt?.refusal ?? 'internal', 'attempt operation previously failed');
    }
    if (record.status === 'completed') {
      return refuse('binding-conflict', 'attempt operation already completed');
    }
    return null;
  };

  const cancellationRefusal = async (attempt: ActiveAttempt): Promise<PortResult<AttemptStartReceipt> | null> => {
    if (attempt.cancelled) return refuse('cancelled', 'attempt was cancelled before its start receipt');
    const read = await readRecord(attempt.input.operationKey);
    if (!read.ok) return read;
    if (read.value !== null) {
      attempt.record = read.value;
      if (read.value.status === 'cancelled') {
        attempt.cancelled = true;
        return refuse('cancelled', 'attempt was cancelled before its start receipt');
      }
    }
    return null;
  };

  /**
   * Live selection is reconstructed from durable state plus the durable binding row (`byAttempt`) — not
   * from an instance-local `bound` flag — so a restarted instance that replays `begin` reports the run as
   * live for the session the previous instance created.
   * `attempt.record` is NOT re-read here: `isRunLive` is synchronous, so this reflects the durable record
   * as of the last await boundary the OWNING attempt passed, and the owning attempt has no further read
   * once its start receipt resolves. A cancel written by another instance after that point is therefore
   * invisible to this predicate until this instance next touches the record (cancel, prompt, settle).
   */
  const isLive = (attempt: ActiveAttempt): boolean => attempt.record !== null
    && attempt.record.status === 'bound'
    && !attempt.settled && !attempt.exited && !attempt.cancelled
    && options.bindings.byAttempt(attempt.input.subject, attempt.input.attemptRef) !== null;

  const selectAttempt = (operator: string, runRef: string): ActiveAttempt | null => {
    let selected: ActiveAttempt | null = null;
    for (const attempt of attempts.values()) {
      if (attempt.input.subject !== operator || attempt.input.runRef !== runRef || !isLive(attempt)) continue;
      if (selected === null || attempt.order > selected.order) selected = attempt;
    }
    return selected;
  };

  const closeAttempt = (attempt: ActiveAttempt, sessionId: string): Promise<PortResult<ObservedExit>> => {
    if (attempt.closePromise) return attempt.closePromise;
    attempt.closePromise = (async () => {
      try {
        const closed = await options.host.close(sessionId);
        if (closed.ok) attempt.exit.resolve(closed.value);
        else {
          attempt.internalFailure = closed.detail ?? `session close refused: ${closed.refusal}`;
          attempt.exit.resolve(observedExitFailure(sessionId, 'abandoned'));
        }
        return closed;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        attempt.internalFailure = detail;
        attempt.exit.resolve(observedExitFailure(sessionId, 'abandoned'));
        return { ok: false, refusal: 'internal', detail };
      }
    })();
    return attempt.closePromise;
  };

  const writePrompt = async (attempt: ActiveAttempt, data: Uint8Array): Promise<boolean> => {
    const receipt = await attempt.launch.receipt;
    if (!receipt.ok || attempt.settled || attempt.cancelled || attempt.exited) return false;
    attempt.framesWritten += attempt.input.profile.runtime === 'claude' ? 1 : 0;
    let written: PortResult<{ accepted: number }>;
    try { written = await options.host.write(receipt.value.sessionId, data); } catch (error) {
      attempt.internalFailure = error instanceof Error ? error.message : String(error);
      if (attempt.input.profile.runtime === 'claude') attempt.framesWritten -= 1;
      await closeAttempt(attempt, receipt.value.sessionId);
      return false;
    }
    if (!written.ok || written.value.accepted !== data.byteLength) {
      if (attempt.input.profile.runtime === 'claude') attempt.framesWritten -= 1;
      return false;
    }
    if (attempt.cancelled || attempt.exited) return false;
    maybeCloseCompletedClaude(attempt);
    return true;
  };

  function maybeCloseCompletedClaude(attempt: ActiveAttempt): void {
    if (attempt.input.profile.runtime !== 'claude' || attempt.record?.status !== 'bound'
      || !attempt.openingPromptsWritten || attempt.exited || attempt.terminalCloseStarted
      || !attempt.sessionId || attempt.framesWritten === 0) return;
    if (countClaudeResults(attempt.readTranscript()) < attempt.baselineClaudeResults + attempt.framesWritten) return;
    attempt.terminalCloseStarted = true;
    void closeAttempt(attempt, attempt.sessionId);
  }

  const queueInstruction = (
    input: ApprovedRunInstruction | ApprovedCheckpointInstruction,
  ): Promise<boolean> => {
    const attempt = selectAttempt(input.operator, input.runRef);
    if (!attempt || attempt.input.profile.runtime !== 'claude') return Promise.resolve(false);
    const checkpoint = 'checkpoint' in input ? input.checkpoint : null;
    const instructionFingerprint = JSON.stringify({ message: input.message, checkpoint });
    const replay = attempt.instructionResults.get(input.idempotencyKey);
    if (replay) return replay.fingerprint === instructionFingerprint ? replay.promise : Promise.resolve(false);
    const message = checkpoint === null
      ? input.message
      : `Deliver at server-approved checkpoint '${checkpoint}':\n${input.message}`;
    const bytes = Buffer.from(encodeStreamJsonUserMessage(buildQueuedOperatorMessagePrompt([message])), 'utf8');
    const promise = writePrompt(attempt, bytes);
    attempt.instructionResults.set(input.idempotencyKey, { fingerprint: instructionFingerprint, promise });
    return promise;
  };

  const begin = (input: ApprovedAttemptDeclaration): AttemptLaunch => {
    if (containsRawAuthority(input)) {
      return refusedLaunch(input.profile.runtime, refuse('invalid-request', 'attempt declaration contains raw recipe authority'));
    }
    const requestFingerprint = attemptDeclarationFingerprint(input);
    const prior = attempts.get(input.operationKey);
    if (prior) {
      if (prior.fingerprint === requestFingerprint) return prior.launch;
      return refusedLaunch(input.profile.runtime, refuse(
        'binding-conflict', 'operationKey already names a different approved attempt declaration',
      ));
    }
    if (draining) {
      return refusedLaunch(input.profile.runtime, refuse('unavailable', 'attempt session adapter is draining'));
    }
    let prepared: PreparedAttempt;
    try { prepared = prepareAttempt(input, options); } catch (error) {
      return refusedLaunch(input.profile.runtime, refuse(
        'invalid-request', error instanceof Error ? error.message : String(error),
      ));
    }

    const chunks: Uint8Array[] = [];
    const exit = deferred<ObservedExit>();
    let capturedBytes = 0;
    let retainedBytes = 0;
    let transcript = '';
    // One streaming decoder per attempt: a multi-byte character split across two frames decodes as one
    // character instead of two replacement characters.
    let decoder = new TextDecoder('utf-8', { fatal: false });
    // A SECOND streaming decoder for the durable IO log: the transcript decoder stops at `maxOutputBytes`,
    // and the operator-visible log must keep receiving frames past that cap.
    const ioDecoder = new TextDecoder('utf-8', { fatal: false });
    let exceededBeforeAttempt = false;
    let exitedBeforeAttempt = false;
    let attempt!: ActiveAttempt;
    const sink: SessionSink = {
      data(frame) {
        if (attempt?.settled) return;
        const bytes = Buffer.from(frame.data, 'base64');
        try { options.recorder?.data(input, frame); } catch { /* recorder observation is failure-isolated */ }
        // The durable per-attempt IO log tap (the store redacts and caps on its own side). A PTY host
        // exposes one stream, so every observed frame is an `out` entry.
        if (bytes.byteLength > 0) {
          const text = ioDecoder.decode(bytes, { stream: true });
          if (text.length > 0) {
            try { options.attemptIo?.append(input.attemptRef, 'out', text); } catch {
              /* the durable IO log must never break the live data path */
            }
          }
        }
        // A PTY host exposes exactly one stream; `SessionDataFrame` carries no channel discriminator, so
        // every observed byte is stdout.
        const remaining = Math.max(0, maxOutputBytes - capturedBytes);
        if (remaining > 0) {
          const retained = bytes.subarray(0, remaining);
          chunks.push(retained);
          retainedBytes += retained.byteLength;
          transcript += decoder.decode(retained, { stream: true });
        }
        capturedBytes += bytes.byteLength;
        if (capturedBytes > maxOutputBytes) {
          exceededBeforeAttempt = true;
          if (attempt) {
            attempt.outputLimitExceeded = true;
            if (attempt.sessionId) void closeAttempt(attempt, attempt.sessionId);
          }
        }
        if (attempt && input.profile.runtime === 'claude') {
          if (frame.replay) attempt.baselineClaudeResults = countClaudeResults(transcript);
          else maybeCloseCompletedClaude(attempt);
        }
      },
      exit(observed) {
        exitedBeforeAttempt = true;
        if (attempt) attempt.exited = true;
        try { options.recorder?.exit(input, observed); } catch { /* recorder observation is failure-isolated */ }
        exit.resolve(observed);
      },
      closed() {
        if (exitedBeforeAttempt || attempt?.settled === true) return true;
        try { return options.recorder?.closed(input) === true; } catch { return false; }
      },
    };
    const request: SessionHostRequest = {
      operationKey: input.operationKey,
      // Run attempts are controller-null: charged to the declaration's owning operator with no browser.
      principal: { operator: input.subject, browserSessionRef: RUN_CONTROLLER_NULL_BROWSER_SESSION_REF },
      recipe: prepared.recipe,
      rootId: input.rootId,
      relativeCwd: input.relativeCwd,
      cols: input.cols,
      rows: input.rows,
    };

    let receiptPromise!: Promise<PortResult<AttemptStartReceipt>>;
    let resultPromise!: Promise<WorkerExecutionResult>;
    const launch: AttemptLaunch = {
      get receipt() { return receiptPromise; },
      get result() { return resultPromise; },
    };
    attempt = {
      input,
      fingerprint: requestFingerprint,
      order: order += 1,
      launch,
      prepared,
      hostLaunch: null,
      hostLaunchReady: deferred<HostLaunch | null>(),
      readTranscript: () => transcript,
      rawBytes: () => Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))),
      retainedBytes: () => retainedBytes,
      releaseTranscript: () => {
        chunks.length = 0;
        retainedBytes = 0;
        transcript = '';
        decoder = new TextDecoder('utf-8', { fatal: false });
      },
      outputLimitExceeded: exceededBeforeAttempt,
      timedOut: false,
      cancelled: false,
      exited: exitedBeforeAttempt,
      settled: false,
      sessionId: null,
      framesWritten: 0,
      baselineClaudeResults: 0,
      openingPromptsWritten: false,
      terminalCloseStarted: false,
      exit,
      closePromise: null,
      cancelPromise: null,
      record: null,
      internalFailure: null,
      instructionResults: new Map(),
    };
    attempts.set(input.operationKey, attempt);

    const rollback = async (
      receiptResult: PortResult<AttemptStartReceipt>,
    ): Promise<PortResult<AttemptStartReceipt>> => {
      const cancelledRollback = !receiptResult.ok && receiptResult.refusal === 'cancelled';
      await settleRecord(
        attempt,
        cancelledRollback ? 'cancelled' : 'failed',
        receiptResult.ok ? null : receiptResult.refusal,
      );
      if (!attempt.sessionId) return receiptResult;
      const closed = await closeAttempt(attempt, attempt.sessionId);
      return closed.ok ? receiptResult : refuse('internal', closed.detail ?? `session close refused: ${closed.refusal}`);
    };

    receiptPromise = (async (): Promise<PortResult<AttemptStartReceipt>> => {
      // ---- PHASE 0: drain the durable operator queue into THIS attempt's opening prompt. ----
      // `agentMessages.deliver` answers `queued` when no worker frame could be written; this is the only
      // place that promise is honoured. It runs before the write-ahead reservation so the reserved prompt
      // count already covers the augmented sequence, and it drains exactly once per attempt (a duplicate
      // `begin` for the same operationKey returns the memoised launch above and never reaches here).
      if (options.drainMessages) {
        let queued: readonly string[] = [];
        try { queued = await options.drainMessages(input.runRef, prepared.agentId); } catch {
          // An unavailable chain document must not sink the attempt; the messages stay queued.
          queued = [];
        }
        if (queued.length > 0) {
          try { prepared.prompts = prepareAttempt(input, options, queued).prompts; } catch {
            /* an unrepresentable message set falls back to the approved prompt sequence */
          }
        }
      }
      // ---- WRITE-AHEAD PHASE 1: the durable intent lands BEFORE any session can exist. ----
      const read = await readRecord(input.operationKey);
      if (!read.ok) { attempt.hostLaunchReady.resolve(null); return read; }
      if (read.value !== null) {
        // Terminal status is decided before declaration identity: a blind `cancel()` tombstone carries no
        // `requestHash` to compare, and a cancelled key must refuse as cancelled, not as a conflict.
        const settled = terminalRefusal(read.value);
        if (settled) { attempt.hostLaunchReady.resolve(null); return settled; }
        if (read.value.requestHash !== requestFingerprint) {
          attempt.hostLaunchReady.resolve(null);
          return refuse('binding-conflict', 'operationKey already names a different approved attempt declaration');
        }
        attempt.record = read.value;
      } else {
        const created = await writeRecord(pendingRecord(input, requestFingerprint), null);
        if (created.ok) attempt.record = created.value;
        else if (created.refusal === 'binding-conflict') {
          // Another instance owns this key. Adopt and resume ITS record; never create a rival session and
          // never close the session this instance did not create.
          const adopted = await readRecord(input.operationKey);
          if (!adopted.ok) { attempt.hostLaunchReady.resolve(null); return adopted; }
          if (adopted.value === null) {
            attempt.hostLaunchReady.resolve(null);
            return refuse('internal', 'durable attempt operation disappeared after a create conflict');
          }
          const settled = terminalRefusal(adopted.value);
          if (settled) { attempt.hostLaunchReady.resolve(null); return settled; }
          if (adopted.value.requestHash !== requestFingerprint) {
            attempt.hostLaunchReady.resolve(null);
            return refuse('binding-conflict', 'operationKey already names a different approved attempt declaration');
          }
          // Losing the create CAS means the winner is running RIGHT NOW, not that it crashed: its own
          // `begin` is between the same two await boundaries this one is. Resuming its prompt sequence
          // would put two instances on one live session, interleaving prompts out of order and both
          // CASing `bound`. Only a record whose approved prompt sequence is already fully delivered is
          // safe to adopt; anything mid-flight refuses to the loser and lets the winner finish.
          if (adopted.value.promptsDelivered !== prepared.prompts.length) {
            attempt.hostLaunchReady.resolve(null);
            return refuse(
              'binding-conflict',
              'another instance is still delivering the approved prompt sequence for this operationKey',
            );
          }
          attempt.record = adopted.value;
        } else {
          attempt.hostLaunchReady.resolve(null);
          return created;
        }
      }
      if (attempt.cancelled || attempt.record?.status === 'cancelled') {
        attempt.hostLaunchReady.resolve(null);
        return refuse('cancelled', 'attempt was cancelled before its session was created');
      }

      // ---- PHASE 1: create (or, by operationKey, re-attach to) the host session. ----
      let hostLaunch: HostLaunch;
      try { hostLaunch = options.host.create(request, sink); } catch (error) {
        attempt.hostLaunchReady.resolve(null);
        const failure = internal(error);
        await settleRecord(attempt, 'failed', failure.refusal);
        return failure;
      }
      attempt.hostLaunch = hostLaunch;
      attempt.hostLaunchReady.resolve(hostLaunch);
      hostLaunch.exit.then((observed) => {
        attempt.exited = true;
        exit.resolve(observed);
      }, () => {
        attempt.exited = true;
        exit.resolve(observedExitFailure(attempt.sessionId ?? 'unknown', 'abandoned'));
      });

      const cancelledBeforeCreate = await cancellationRefusal(attempt);
      if (cancelledBeforeCreate) return rollback(cancelledBeforeCreate);
      let hostReceipt: PortResult<HostStartReceipt>;
      try {
        hostReceipt = await hostLaunch.receipt;
      } catch (error) {
        return rollback(internal(error));
      }
      if (!hostReceipt.ok) {
        await settleRecord(attempt, 'failed', hostReceipt.refusal);
        return hostReceipt;
      }
      attempt.sessionId = hostReceipt.value.sessionId;
      const cancelledAfterCreate = await cancellationRefusal(attempt);
      if (cancelledAfterCreate) return rollback(cancelledAfterCreate);
      if (attempt.exited) return rollback(refuse('internal', 'session exited before attempt binding'));
      let binding: PortResult<{ revision: number }>;
      try {
        binding = await options.bindings.bind({
          expectedRevision: hostReceipt.value.revision,
          operator: input.subject,
          runRef: input.runRef,
          attemptRef: input.attemptRef,
          managedSessionRef: input.sessionRef,
          sessionId: hostReceipt.value.sessionId,
        });
      } catch (error) {
        return rollback(internal(error));
      }
      const cancelledAfterBind = await cancellationRefusal(attempt);
      if (cancelledAfterBind) return rollback(cancelledAfterBind);
      if (attempt.exited) return rollback(refuse('internal', 'session exited during attempt binding'));
      if (!binding.ok) return rollback(binding);

      // ---- WRITE-AHEAD PHASE 2: reserve prompt i durably BEFORE its bytes leave this process. ----
      // Ordering per prompt: CAS(promptsDelivered = current + 1) -> host.write(prompt). A crash between
      // the CAS and the write loses at most that one prompt; a crash after the write can never re-send it
      // because the reservation is already durable. The closure reads `current.promptsDelivered` so a CAS
      // retry after a conflict re-applies the increment on the winner's counter instead of regressing it.
      // The durable `sessionId` is the pointer `durablyCancel` closes. It is claimed once, by whoever
      // first wrote a non-null one; a later writer never repoints it at the session IT created, because a
      // host that failed to dedupe by `operationKey` would otherwise strand the original session with no
      // durable name. `undefined` leaves the field untouched (see `nextRecord`).
      const claimSessionId = (current: AttemptOperationRecord): string | undefined => (
        current.sessionId === null ? hostReceipt.value.sessionId : undefined
      );
      if ((attempt.record?.promptsDelivered ?? 0) > prepared.prompts.length) {
        return rollback(refuse('internal', 'durable prompt progress exceeds the approved declaration'));
      }
      for (;;) {
        const delivered = attempt.record?.promptsDelivered ?? 0;
        if (delivered >= prepared.prompts.length) break;
        const cancelledBeforePrompt = await cancellationRefusal(attempt);
        if (cancelledBeforePrompt) return rollback(cancelledBeforePrompt);
        if (attempt.exited) return rollback(refuse('internal', 'session exited before approved prompt delivery'));
        const prompt = prepared.prompts[delivered];
        const reserved = await casRecord(attempt, (current) => nextRecord(current, {
          promptsDelivered: current.promptsDelivered + 1,
          sessionId: claimSessionId(current),
        }));
        if (!reserved.ok) return rollback(reserved);
        if (reserved.value.promptsDelivered !== delivered + 1) {
          return rollback(refuse('binding-conflict', 'another instance advanced the approved prompt sequence'));
        }
        attempt.framesWritten += input.profile.runtime === 'claude' ? 1 : 0;
        let written: PortResult<{ accepted: number }>;
        try { written = await options.host.write(hostReceipt.value.sessionId, prompt); } catch (error) {
          if (input.profile.runtime === 'claude') attempt.framesWritten -= 1;
          return rollback(internal(error));
        }
        const cancelledAfterWrite = await cancellationRefusal(attempt);
        if (cancelledAfterWrite) return rollback(cancelledAfterWrite);
        if (!written.ok || written.value.accepted !== prompt.byteLength) {
          if (input.profile.runtime === 'claude') attempt.framesWritten -= 1;
          return rollback(written.ok
            ? refuse('internal', 'host accepted only part of the approved prompt')
            : written);
        }
        if (attempt.exited) return rollback(refuse('internal', 'session exited during approved prompt delivery'));
      }
      attempt.openingPromptsWritten = true;
      const cancelledBeforeReceipt = await cancellationRefusal(attempt);
      if (cancelledBeforeReceipt) return rollback(cancelledBeforeReceipt);
      if (attempt.exited) return rollback(refuse('internal', 'session exited before the attempt start receipt'));
      const bound = await casRecord(attempt, (current) => nextRecord(current, {
        status: 'bound', sessionId: claimSessionId(current), refusal: null,
      }));
      if (!bound.ok) return rollback(bound);
      const cancelledAfterBound = await cancellationRefusal(attempt);
      if (cancelledAfterBound) return rollback(cancelledAfterBound);
      if (attempt.exited) return rollback(refuse('internal', 'session exited before the attempt start receipt'));
      maybeCloseCompletedClaude(attempt);
      return {
        ok: true,
        value: {
          operationKey: hostReceipt.value.operationKey,
          sessionId: hostReceipt.value.sessionId,
          attemptRef: input.attemptRef,
          revision: binding.value.revision,
          boundAt: hostReceipt.value.boundAt,
          replayed: hostReceipt.value.replayed,
        },
      };
    })();

    /**
     * The timer's escape hatch for an attempt that never got a session pointer. `receiptPromise` awaits
     * `hostLaunch.receipt`; a host that never resolves it would leave the result promise pending forever,
     * so the attempt would never reach `settleAttempt`, never become evictable, and hold its transcript
     * for the life of the process. Racing this against `receiptPromise` restores the invariant that every
     * `begin` ends in `settleAttempt`.
     */
    const timedOutReceipt = deferred<PortResult<AttemptStartReceipt>>();
    const timer = setTimeout(() => {
      if (attempt.settled) return;
      attempt.timedOut = true;
      if (attempt.sessionId) {
        void closeAttempt(attempt, attempt.sessionId);
        return;
      }
      // No session pointer: the host receipt never resolved, so nothing can ever resolve `attempt.exit`
      // and no parse can use the bytes captured so far. Release them and fail the attempt durably.
      attempt.internalFailure ??= 'attempt timed out before its host session receipt resolved';
      attempt.releaseTranscript();
      timedOutReceipt.resolve(refuse('internal', 'attempt timed out before its host session receipt resolved'));
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();

    resultPromise = (async (): Promise<WorkerExecutionResult> => {
      const receipt = await Promise.race([receiptPromise, timedOutReceipt.promise]);
      if (!receipt.ok) {
        clearTimeout(timer);
        await settleRecord(attempt, receipt.refusal === 'cancelled' ? 'cancelled' : 'failed', receipt.refusal);
        settleAttempt(attempt);
        return refusalResult(input.profile.runtime, receipt);
      }
      if (attempt.outputLimitExceeded) void closeAttempt(attempt, receipt.value.sessionId);
      const observedExit = await attempt.exit.promise;
      clearTimeout(timer);
      const stdout = attempt.readTranscript();
      const parsed = parseResult({
        runtime: input.profile.runtime,
        stdout,
        // A PTY host has exactly one stream, so a PTY-hosted attempt never has a separate stderr tail.
        stderrTail: '',
        exitCode: observedExit.exitCode,
        timedOut: attempt.timedOut,
        outputLimitExceeded: attempt.outputLimitExceeded,
        cancelled: attempt.cancelled,
        resultObserved: input.profile.runtime === 'claude'
          ? countClaudeResults(stdout) >= attempt.framesWritten
          : parseCodexStream(stdout).terminalEvent !== null,
        ...(input.iterationContract ? { iterationContract: input.iterationContract } : {}),
      });
      if (attempt.internalFailure) {
        await settleRecord(attempt, 'failed', 'internal');
        settleAttempt(attempt);
        return failed(`${input.profile.runtime} attempt session failed internally: ${attempt.internalFailure}`);
      }
      if (parsed.resumeRef) {
        try {
          await options.recordResumeRef?.(input.profile.runtime, input.runRef, prepared.agentId, parsed.resumeRef);
        } catch (error) {
          await settleRecord(attempt, 'failed', 'internal');
          settleAttempt(attempt);
          return failed(`${input.profile.runtime} worker could not record its emitted ${input.profile.runtime === 'claude' ? 'session' : 'thread'}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      await settleRecord(
        attempt,
        attempt.cancelled ? 'cancelled' : parsed.result.state === 'succeeded' ? 'completed' : 'failed',
        attempt.cancelled ? 'cancelled' : null,
      );
      settleAttempt(attempt);
      return parsed.result;
    })();

    return launch;
  };

  return {
    begin,
    /**
     * Cancellation is keyed by `operationKey` and durable: the tombstone is CAS-written whether or not
     * this instance owns the attempt, so an attempt begun on another instance (or begun later) sees the
     * tombstone and refuses.
     */
    async cancel(input) {
      const attempt = attempts.get(input.operationKey) ?? null;
      if (attempt === null) {
        const cancelled = await durablyCancel(input.operationKey, null);
        if (!cancelled.ok) return cancelled;
        return { ok: true, value: observedExitFailure(cancelled.value.sessionId ?? input.operationKey, 'abandoned') };
      }
      if (attempt.cancelPromise) return attempt.cancelPromise;
      attempt.cancelled = true;
      attempt.cancelPromise = (async () => {
        const cancelled = await durablyCancel(input.operationKey, attempt);
        if (!cancelled.ok) return cancelled;
        const hostLaunch = await attempt.hostLaunchReady.promise;
        if (!hostLaunch) {
          return { ok: true as const, value: observedExitFailure(input.operationKey, 'abandoned') };
        }
        const receipt = await hostLaunch.receipt;
        if (!receipt.ok) return receipt;
        return closeAttempt(attempt, receipt.value.sessionId);
      })();
      return attempt.cancelPromise;
    },
    isRunLive(input) {
      return [...attempts.values()].some((attempt) => attempt.input.subject === input.operator
        && attempt.input.runRef === input.runRef && isLive(attempt));
    },
    queueRunInstruction(input) {
      return queueInstruction(input);
    },
    queueRunInstructionAtCheckpoint(input) {
      return queueInstruction(input);
    },
    async drain() {
      draining = true;
      const listed = await options.host.listEpoch();
      if (!listed.ok) throw new Error(listed.detail ?? `session host drain refused: ${listed.refusal}`);
      const drained = await options.host.drain(listed.value.epochId);
      if (!drained.ok) throw new Error(drained.detail ?? `session host drain refused: ${drained.refusal}`);
    },
    rawTranscript(attemptRef) {
      const attempt = [...attempts.values()].find((candidate) => candidate.input.attemptRef === attemptRef);
      return attempt ? attempt.rawBytes() : null;
    },
  };
}
