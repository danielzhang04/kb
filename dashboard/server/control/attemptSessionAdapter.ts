import { sha256Hex } from '../shared/hashing.ts';
import type { AgentSessionChainStore, MessageClaim } from './agentSessionChains.ts';
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
import { recipeEndsInputOnEof, validateRelativeCwd } from '../pty/fdPinnedPaths.ts';
import type { SessionRecordRegistry } from '../pty/sessionRecord.ts';
import {
  type ApprovedAttemptDeclaration,
  type ApprovedCheckpointInstruction,
  type ApprovedRunInstruction,
  type AttemptExecutionPort,
  type AttemptLaunch,
  type AttemptOperationRecord,
  type AttemptOperationStatus,
  type AttemptParserContext,
  type AttemptStartReceipt,
  type HostRefusalCode,
  type ObservedExit,
  type OperationReceipt,
  type ParsedAttemptResult,
  type PortResult,
  type SessionDataFrame,
  type SessionHost,
  type SessionSink,
  type StartRunSessionReceipt,
} from '../pty/contracts.ts';
import type { LaunchRecipe } from '../../shared/ptyProtocol.ts';

type WorkerExecutionResult = Awaited<AttemptLaunch['result']>;
type ExecutionUsage = WorkerExecutionResult['usage'];

const DEFAULT_STDERR_TAIL_CHARS = 4_000;
const DEFAULT_SUMMARY_MAX_CHARS = 60_000;
const TERMINAL_ATTEMPT_LIMIT = 32;
/** Valid-shaped sentinel used only when no host receipt exists. The sole production cancellation
 * caller awaits acknowledgement but deliberately discards its value (`managedExecution.ts`). */
const UNKNOWN_SESSION_ID = `pty-${'0'.repeat(32)}`;
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
  /** The one durable attempt/session authority, including the atomic host start. */
  sessionRecords: Pick<SessionRecordRegistry,
    'startRunSession' | 'byAttempt' | 'readOperation' | 'writeOperation'>;
  /** One safe control-key to host-key mapping line per newly launched attempt. */
  log?: (message: string) => void;
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
  /** The sole durable authority for queued-message delivery. B wires the active chain store last. */
  messageClaims?: Pick<AgentSessionChainStore, 'claimMessages' | 'bindPromptFingerprint'
    | 'admitPtyBind' | 'markPtyBound' | 'recordWriteIntent' | 'ackClaim' | 'releasePrewrite'>;
  /** Optional generation fence supplied by B; a withdrawn adapter cannot issue another forward effect. */
  assertForwardAdmission?: () => void;
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
  runStart: StartRunSessionReceipt | null;
  /** Resolves with the registry-owned start once phase 1 decides, or `null` when no session was created. */
  runStartReady: Deferred<StartRunSessionReceipt | null>;
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
  claim: ClaimContext | null;
  claimOwnership: 'none' | 'creator' | 'observer' | 'poisoned';
  instructionResults: Map<string, { fingerprint: string; promise: Promise<boolean> }>;
}

interface ClaimContext {
  claim: MessageClaim;
  creatorHandle: string;
  promptFingerprint: string | null;
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

function hostKey(controlOperationKey: string): string {
  return `op-${sha256Hex(controlOperationKey)}`;
}

function attemptAgentId(input: ApprovedAttemptDeclaration): string {
  return input.assignment?.agentId ?? input.profile.id;
}

/**
 * `policyPattern` from `pty/brokerProtocol.ts`, restated on the sending side. Both runtimes validate
 * against this ONE constant: a `toolPolicyId` that fails it is refused here, with a message naming the
 * attempt, instead of being sent and refused inside `decodeLaunchRecipe`, where an invalid frame tears
 * down the broker connection rather than failing one launch.
 */
const TOOL_POLICY_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;

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
    if (!TOOL_POLICY_ID_RE.test(toolPolicyId)) {
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

  // Codex carries the SAME rule as the Claude branch above, and for the same reason. The fallback
  // this replaces was `input.workflowProfile ?? input.profile.id`, and `input.profile.id` has the
  // shape `worker:codex:gpt-5.6-terra` — colons, which `policyPattern` in `brokerProtocol.ts` refuses.
  // So the fallback could not produce a launchable recipe under any circumstance; it could only turn
  // "this attempt declares no tool cap" into a decode failure that killed the broker socket instead of
  // naming the missing profile. An attempt with no workflow profile has no cap to resolve, so it is
  // refused here, where the reason is still legible.
  if (input.workflowProfile === null) throw new Error('codex attempt has no workflow profile');
  // ...and the id is RESOLVED, not merely shape-checked. `TOOL_POLICY_ID_RE` only says the name is
  // spellable on the wire; a syntactically perfect name for a profile that was renamed or retired
  // passes it, reaches the broker, and comes back as a generic `unknown Codex tool policy` — a round
  // trip and a dead frame for something the sender already knew. The claude branch resolves through
  // `createWorkflowToolPolicyResolver`; the two branches are only symmetric, as the comment above
  // claims, if codex does too. Codex has no `--allowedTools`, so the resolved policy is not carried
  // into the recipe — the point of the call is the server-ownedness verdict, which is exactly the
  // check the broker's membership test performs one hop later.
  const resolveCodexPolicy = options.resolveClaudePolicy ?? createWorkflowToolPolicyResolver();
  resolveCodexPolicy(input.workflowProfile);
  if (!TOOL_POLICY_ID_RE.test(input.workflowProfile)) {
    throw new Error('codex attempt resolved an invalid server-owned tool policy id');
  }
  const recipe: LaunchRecipe = {
    launcher: 'codex', mode: 'headless-json', model: input.profile.model,
    toolPolicyId: input.workflowProfile,
    sandbox: 'codex-workspace-write', ...(resumeRef ? { resumeRef } : {}),
  };
  // No EOT byte in the prompt any more. `codex exec -` reads its instruction from stdin UNTIL EOF, and
  // the Linux broker hands a headless child a real PIPE, where U+0004 is an ordinary data byte: the
  // trailing EOT bought nothing there (VM probe A4 hung to the 90 s kill with it) and only appended a
  // stray byte to the work order. End of input is now stated as such, once, after the last approved
  // prompt - see `recipeEndsInputOnEof` (pty/fdPinnedPaths.ts) and the `host.endInput` call in `begin`.
  // On the ConPTY host that call still delivers exactly this byte, so Windows stdin bytes are unchanged.
  return { recipe, prompts: [Buffer.from(prompt, 'utf8')], agentId };
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
  if (!options.sessionRecords) throw new Error('attempt session records are required');
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
      return { ok: true, value: await options.sessionRecords.readOperation(hostKey(operationKey)) };
    } catch (error) {
      return internal(error);
    }
  };

  const writeRecord = async (
    controlOperationKey: string,
    record: AttemptOperationRecord,
    expectedRevision: number | null,
  ): Promise<PortResult<AttemptOperationRecord>> => {
    try {
      const operationKey = hostKey(controlOperationKey);
      return await options.sessionRecords.writeOperation({
        ...record,
        operationKey,
        receipt: record.receipt ? { ...record.receipt, operationKey } : record.receipt,
      }, expectedRevision);
    } catch (error) {
      return internal(error);
    }
  };

  const pendingRecord = (
    input: ApprovedAttemptDeclaration,
    fingerprint: string,
    messageClaim: AttemptOperationRecord['messageClaim'],
  ): AttemptOperationRecord => {
    const createdAt = new Date().toISOString();
    return {
      operationKey: input.operationKey,
      requestHash: fingerprint,
      status: 'pending',
      promptsDelivered: 0,
      sessionId: null,
      attemptRef: input.attemptRef,
      messageClaim,
      receipt: {
        operationKey: input.operationKey, requestHash: fingerprint, status: 'pending',
        sessionId: null, attemptRef: input.attemptRef, refusal: null, createdAt, settledAt: null,
      },
      revision: 0,
      updatedAt: createdAt,
    };
  };

  const reconciliationRequired = <T>(): PortResult<T> =>
    refuse('internal', 'message-claim-reconciliation-required');

  const sameStrings = (left: readonly string[], right: readonly string[]): boolean =>
    left.length === right.length && left.every((value, index) => value === right[index]);

  const isQueuedMessage = (value: unknown): value is MessageClaim['messages'][number] =>
    typeof value === 'object' && value !== null
    && Object.keys(value).length === 4
    && typeof (value as { messageRef?: unknown }).messageRef === 'string'
    && typeof (value as { text?: unknown }).text === 'string'
    && typeof (value as { queuedAt?: unknown }).queuedAt === 'string'
    && Number.isSafeInteger((value as { ordinal?: unknown }).ordinal);

  const sameMessages = (
    left: readonly MessageClaim['messages'][number][],
    right: readonly MessageClaim['messages'][number][],
  ): boolean => left.length === right.length && left.every((value, index) =>
    value.messageRef === right[index]?.messageRef
      && value.text === right[index]?.text
      && value.queuedAt === right[index]?.queuedAt
      && value.ordinal === right[index]?.ordinal);

  /** Claim-port fulfillments are untrusted at this boundary. A malformed success is ambiguous, not a
   * harmless type error: the AtomicJson mutation may already have committed before a wrapper fulfilled
   * with the wrong value. */
  const isClaimShape = (value: unknown): value is MessageClaim => {
    if (typeof value !== 'object' || value === null) return false;
    const candidate = value as Record<string, unknown>;
    const keys = [
      'claimRef', 'operationKey', 'declarationFingerprint', 'agentId', 'messageRefs', 'messages',
      'promptFingerprint', 'ptyOperationRevision', 'state', 'revision', 'claimedAt', 'updatedAt',
    ];
    if (Object.keys(candidate).length !== keys.length || !keys.every((key) => Object.hasOwn(candidate, key))) return false;
    return typeof candidate.claimRef === 'string'
      && typeof candidate.operationKey === 'string'
      && typeof candidate.declarationFingerprint === 'string' && /^[a-f0-9]{64}$/.test(candidate.declarationFingerprint)
      && typeof candidate.agentId === 'string'
      && Array.isArray(candidate.messageRefs) && candidate.messageRefs.every((item) => typeof item === 'string')
      && Array.isArray(candidate.messages) && candidate.messages.every(isQueuedMessage)
      && (candidate.promptFingerprint === null
        || (typeof candidate.promptFingerprint === 'string' && /^[a-f0-9]{64}$/.test(candidate.promptFingerprint)))
      && (candidate.ptyOperationRevision === null || (typeof candidate.ptyOperationRevision === 'number'
        && Number.isSafeInteger(candidate.ptyOperationRevision) && candidate.ptyOperationRevision >= 0))
      && (candidate.state === 'claimed' || candidate.state === 'prompt-bound' || candidate.state === 'pty-bind-admitted'
        || candidate.state === 'pty-bound' || candidate.state === 'write-intent' || candidate.state === 'acknowledged'
        || candidate.state === 'released')
      && typeof candidate.revision === 'number' && Number.isSafeInteger(candidate.revision) && candidate.revision >= 1
      && typeof candidate.claimedAt === 'string' && typeof candidate.updatedAt === 'string';
  };

  const validClaimTransition = (
    value: unknown,
    previous: MessageClaim,
    state: MessageClaim['state'],
    prompt: string | null,
    ptyRevision: number | null,
    clearMessages = false,
  ): value is MessageClaim => isClaimShape(value)
    && value.claimRef === previous.claimRef
    && value.operationKey === previous.operationKey
    && value.declarationFingerprint === previous.declarationFingerprint
    && value.agentId === previous.agentId
    && sameStrings(value.messageRefs, previous.messageRefs)
    && sameMessages(value.messages, clearMessages ? [] : previous.messages)
    && value.promptFingerprint === prompt
    && value.ptyOperationRevision === ptyRevision
    && value.state === state
    && value.revision === previous.revision + 1;

  const validCreatedClaim = (
    value: unknown,
    agentId: string,
    operationKey: string,
    declarationFingerprint: string,
  ): value is { disposition: 'created'; claim: MessageClaim; creatorHandle: string } => {
    if (typeof value !== 'object' || value === null) return false;
    const candidate = value as Record<string, unknown>;
    return Object.keys(candidate).length === 3
      && candidate.disposition === 'created'
      && typeof candidate.creatorHandle === 'string' && candidate.creatorHandle.length >= 16 && candidate.creatorHandle.length <= 128
      && isClaimShape(candidate.claim)
      && candidate.claim.operationKey === operationKey
      && candidate.claim.agentId === agentId
      && candidate.claim.declarationFingerprint === declarationFingerprint
      && candidate.claim.state === 'claimed'
      && candidate.claim.promptFingerprint === null
      && candidate.claim.ptyOperationRevision === null;
  };

  const validObservedClaim = (
    value: unknown,
    agentId: string,
    operationKey: string,
    declarationFingerprint: string,
  ): value is { disposition: 'observed'; claim: MessageClaim } => {
    if (typeof value !== 'object' || value === null) return false;
    const candidate = value as Record<string, unknown>;
    return Object.keys(candidate).length === 2
      && candidate.disposition === 'observed'
      && isClaimShape(candidate.claim)
      && candidate.claim.operationKey === operationKey
      && candidate.claim.agentId === agentId
      && candidate.claim.declarationFingerprint === declarationFingerprint;
  };

  const claimCas = (attempt: ActiveAttempt, promptFingerprint = attempt.claim?.promptFingerprint): {
    runRef: string; agentId: string; operationKey: string; claimRef: string;
    declarationFingerprint: string; promptFingerprint: string | null; creatorHandle: string; expectedRevision: number;
  } | null => {
    const context = attempt.claim;
    if (!context) return null;
    return {
      runRef: attempt.input.runRef, agentId: context.claim.agentId, operationKey: hostKey(attempt.input.operationKey),
      claimRef: context.claim.claimRef, declarationFingerprint: context.claim.declarationFingerprint,
      promptFingerprint: promptFingerprint ?? null, creatorHandle: context.creatorHandle,
      expectedRevision: context.claim.revision,
    };
  };

  const applyClaimTransition = async (
    attempt: ActiveAttempt,
    invoke: (input: NonNullable<ReturnType<typeof claimCas>>) => Promise<unknown>,
    state: MessageClaim['state'],
    promptFingerprint: string | null,
    ptyRevision: number | null,
    clearMessages = false,
  ): Promise<MessageClaim | null> => {
    const previous = attempt.claim?.claim;
    const cas = claimCas(attempt, promptFingerprint);
    if (attempt.claimOwnership !== 'creator' || !previous || !cas) return null;
    let transitioned: unknown;
    try {
      transitioned = await invoke(cas);
    } catch {
      attempt.claimOwnership = 'poisoned';
      return null;
    }
    if (!validClaimTransition(transitioned, previous, state, promptFingerprint, ptyRevision, clearMessages)) {
      attempt.claimOwnership = 'poisoned';
      return null;
    }
    attempt.claim = { ...attempt.claim!, claim: transitioned, promptFingerprint };
    return transitioned;
  };

  const releaseOwnedClaim = async (attempt: ActiveAttempt): Promise<boolean> => {
    const claims = options.messageClaims;
    const previous = attempt.claim?.claim;
    if (attempt.claimOwnership !== 'creator' || !claims || !previous) return false;
    const released = await applyClaimTransition(
      attempt,
      (cas) => claims.releasePrewrite(cas),
      'released',
      previous.promptFingerprint,
      previous.ptyOperationRevision,
      true,
    );
    return released !== null;
  };

  const promptFingerprint = (claim: MessageClaim, prompts: readonly Uint8Array[]): string => sha256Hex(JSON.stringify({
    messageRefs: claim.messageRefs,
    prompts: prompts.map((prompt) => Buffer.from(prompt).toString('base64')),
  }));

  const nextRecord = (
    current: AttemptOperationRecord,
    patch: { status?: AttemptOperationStatus; promptsDelivered?: number; sessionId?: string | null; refusal?: HostRefusalCode | null },
  ): AttemptOperationRecord => {
    const status = patch.status ?? current.status;
    const updatedAt = new Date().toISOString();
    const sessionId = patch.sessionId === undefined ? current.sessionId : patch.sessionId;
    const wireStatus = receiptStatus(status);
    const inherited = patch.refusal === undefined ? (current.receipt?.refusal ?? null) : patch.refusal;
    // The durable document enforces one refusal per receipt status: `pending`/`bound` carry none,
    // `cancelled` carries exactly `cancelled`, and `failed` MUST carry one. A worker that merely reported
    // an unsuccessful result has no host refusal of its own, and writing that receipt with a null refusal
    // made the whole persistence mutate throw, so the operation stayed `pending` forever.
    const refusal = wireStatus === 'cancelled'
      ? 'cancelled'
      : wireStatus === 'failed' ? (inherited ?? 'internal') : null;
    return {
      ...current,
      status,
      promptsDelivered: patch.promptsDelivered ?? current.promptsDelivered,
      sessionId,
      updatedAt,
      receipt: {
        operationKey: current.operationKey,
        requestHash: current.requestHash,
        status: wireStatus,
        sessionId,
        attemptRef: current.attemptRef,
        refusal,
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
      const written = await writeRecord(attempt.input.operationKey, next, current.revision);
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
    if (attempt.record === null || attempt.claimOwnership === 'poisoned') return;
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
          messageClaim: null,
          receipt: {
            operationKey, requestHash, status: 'cancelled', sessionId: null, attemptRef,
            refusal: 'cancelled', createdAt: settledAt, settledAt,
          },
          revision: 0, updatedAt: settledAt,
        };
        const written = await writeRecord(operationKey, tombstone, null);
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
        operationKey,
        nextRecord(current, { status: 'cancelled', refusal: 'cancelled' }),
        current.revision,
      );
      if (written.ok) { if (attempt) attempt.record = written.value; return written; }
      if (written.refusal !== 'binding-conflict') return written;
    }
    return refuse('internal', 'durable attempt operation changed too many times');
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
    && options.sessionRecords.byAttempt(attempt.input.subject, attempt.input.attemptRef) !== null;

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
      if (attempt.runStart === null || attempt.runStart.sessionId !== sessionId) {
        attempt.internalFailure = 'registry-owned session start is unavailable';
        return refuse('internal', attempt.internalFailure);
      }
      try {
        const closed = await attempt.runStart.close();
        if (!closed.ok) attempt.internalFailure = closed.detail ?? `session close refused: ${closed.refusal}`;
        return closed;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        attempt.internalFailure = detail;
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
    try {
      options.assertForwardAdmission?.();
    } catch {
      attempt.claimOwnership = 'poisoned';
      if (attempt.input.profile.runtime === 'claude') attempt.framesWritten -= 1;
      await closeAttempt(attempt, receipt.value.sessionId);
      return false;
    }
    try {
      written = await options.host.write(receipt.value.sessionId, data);
    } catch (error) {
      attempt.internalFailure = error instanceof Error ? error.message : String(error);
      if (attempt.input.profile.runtime === 'claude') attempt.framesWritten -= 1;
      await closeAttempt(attempt, receipt.value.sessionId);
      return false;
    }
    try {
      options.assertForwardAdmission?.();
    } catch {
      attempt.claimOwnership = 'poisoned';
      if (attempt.input.profile.runtime === 'claude') attempt.framesWritten -= 1;
      await closeAttempt(attempt, receipt.value.sessionId);
      return false;
    }
    if (!written.ok || !written.value || written.value.accepted !== data.byteLength) {
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
    let prepared!: PreparedAttempt;
    const agentId = attemptAgentId(input);

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
      // Run exits are observed through the registry-owned promise installed after start.
      exit() {},
      closed() {
        if (attempt?.exited === true || attempt?.settled === true) return true;
        try { return options.recorder?.closed(input) === true; } catch { return false; }
      },
    };
    const hostOperationKey = hostKey(input.operationKey);

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
      prepared: undefined as unknown as PreparedAttempt,
      runStart: null,
      runStartReady: deferred<StartRunSessionReceipt | null>(),
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
      exited: false,
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
      claim: null,
      claimOwnership: 'none',
      instructionResults: new Map(),
    };
    attempts.set(input.operationKey, attempt);

    /** Cleans up only failures after the registry has returned a durable successful start. */
    const failAfterStart = async (
      receiptResult: PortResult<AttemptStartReceipt>,
    ): Promise<PortResult<AttemptStartReceipt>> => {
      // Before write-intent the sole creator can still prove a release.  Once any claim mutation is
      // ambiguous, or write-intent won, the PTY might have received bytes: close only.  In particular
      // do not turn an uncertain delivery into a terminal PTY receipt by retrying a record settlement.
      let definitelyReleased = attempt.claim?.claim?.state === 'released';
      if (!definitelyReleased && attempt.claimOwnership === 'creator'
        && attempt.claim?.claim?.state === 'pty-bound') {
        definitelyReleased = await releaseOwnedClaim(attempt);
      }
      if (definitelyReleased && attempt.claimOwnership !== 'poisoned') {
        const cancelledRollback = !receiptResult.ok && receiptResult.refusal === 'cancelled';
        await settleRecord(attempt, cancelledRollback ? 'cancelled' : 'failed',
          receiptResult.ok ? null : receiptResult.refusal);
      }
      if (!attempt.sessionId) return receiptResult;
      const closed = await closeAttempt(attempt, attempt.sessionId);
      return closed.ok ? receiptResult : refuse('internal', closed.detail ?? `session close refused: ${closed.refusal}`);
    };

    receiptPromise = (async (): Promise<PortResult<AttemptStartReceipt>> => {
      // `drainMessages` remains only as a temporary construction compatibility option for B. It is
      // deliberately never invoked: destructive drain has no durable recovery path.
      const claims = options.messageClaims;
      if (!claims) { attempt.runStartReady.resolve(null); return refuse('unavailable', 'message claim delivery is unbound'); }
      let createdClaim: MessageClaim;
      let claimed: unknown;
      try {
        options.assertForwardAdmission?.();
        claimed = await claims.claimMessages(input.runRef, agentId, hostOperationKey, requestFingerprint);
        if (validObservedClaim(claimed, agentId, hostOperationKey, requestFingerprint)) {
          attempt.claimOwnership = 'observer';
          attempt.runStartReady.resolve(null);
          return reconciliationRequired();
        }
      } catch {
        attempt.claimOwnership = 'poisoned';
        attempt.runStartReady.resolve(null);
        return reconciliationRequired();
      }
      if (!validCreatedClaim(claimed, agentId, hostOperationKey, requestFingerprint)) {
        attempt.claimOwnership = 'poisoned';
        attempt.runStartReady.resolve(null);
        return reconciliationRequired();
      }
      createdClaim = claimed.claim;
      attempt.claim = { claim: createdClaim, creatorHandle: claimed.creatorHandle, promptFingerprint: null };
      attempt.claimOwnership = 'creator';
      options.log?.(`control=${input.operationKey} host=${hostOperationKey} attemptRef=${input.attemptRef}`);
      try {
        options.assertForwardAdmission?.();
      } catch {
        await releaseOwnedClaim(attempt);
        attempt.runStartReady.resolve(null);
        return reconciliationRequired();
      }
      try {
        prepared = prepareAttempt(input, options, createdClaim.messages.map((message) => message.text));
        attempt.prepared = prepared;
      } catch (error) {
        if (!await releaseOwnedClaim(attempt)) { attempt.runStartReady.resolve(null); return reconciliationRequired(); }
        attempt.runStartReady.resolve(null);
        return refuse('invalid-request', error instanceof Error ? error.message : 'attempt prompt preparation refused');
      }
      const boundPromptFingerprint = promptFingerprint(createdClaim, prepared.prompts);
      try {
        options.assertForwardAdmission?.();
      } catch {
        if (!await releaseOwnedClaim(attempt)) attempt.claimOwnership = 'poisoned';
        attempt.runStartReady.resolve(null);
        return reconciliationRequired();
      }
      const bound = await applyClaimTransition(
        attempt,
        (cas) => claims.bindPromptFingerprint({ ...cas, promptFingerprint: boundPromptFingerprint }),
        'prompt-bound',
        boundPromptFingerprint,
        null,
      );
      if (!bound) { attempt.runStartReady.resolve(null); return reconciliationRequired(); }
      try {
        options.assertForwardAdmission?.();
      } catch {
        if (!await releaseOwnedClaim(attempt)) attempt.claimOwnership = 'poisoned';
        attempt.runStartReady.resolve(null);
        return reconciliationRequired();
      }
      // ---- PTY preflight and one admitted write-ahead CAS. ----
      const read = await readRecord(input.operationKey);
      if (!read.ok) {
        if (!await releaseOwnedClaim(attempt)) { attempt.runStartReady.resolve(null); return reconciliationRequired(); }
        attempt.runStartReady.resolve(null); return read;
      }
      if (read.value !== null) {
        if (!await releaseOwnedClaim(attempt)) { attempt.runStartReady.resolve(null); return reconciliationRequired(); }
        attempt.runStartReady.resolve(null);
        return refuse('binding-conflict', 'existing PTY attempt operation cannot adopt a message claim');
      }
      try {
        options.assertForwardAdmission?.();
      } catch {
        if (!await releaseOwnedClaim(attempt)) attempt.claimOwnership = 'poisoned';
        attempt.runStartReady.resolve(null);
        return reconciliationRequired();
      }
      const admitted = await applyClaimTransition(
        attempt,
        (cas) => claims.admitPtyBind({ ...cas, promptFingerprint: boundPromptFingerprint }),
        'pty-bind-admitted',
        boundPromptFingerprint,
        null,
      );
      if (!admitted) { attempt.runStartReady.resolve(null); return reconciliationRequired(); }
      try {
        options.assertForwardAdmission?.();
      } catch {
        attempt.claimOwnership = 'poisoned';
        attempt.runStartReady.resolve(null);
        return reconciliationRequired();
      }
      const binding = attempt.claim!.claim;
      const created = await writeRecord(input.operationKey, pendingRecord(input, requestFingerprint, {
        claimRef: binding.claimRef, declarationFingerprint: binding.declarationFingerprint, promptFingerprint: boundPromptFingerprint,
      }), null);
      if (!created.ok || created.value.messageClaim?.claimRef !== binding.claimRef
        || created.value.messageClaim.declarationFingerprint !== binding.declarationFingerprint
        || created.value.messageClaim.promptFingerprint !== boundPromptFingerprint) {
        attempt.claimOwnership = 'poisoned';
        attempt.runStartReady.resolve(null); return reconciliationRequired();
      }
      attempt.record = created.value;
      const ptyBound = await applyClaimTransition(
        attempt,
        (cas) => claims.markPtyBound({ ...cas, promptFingerprint: boundPromptFingerprint,
          ptyOperationRevision: created.value.revision }),
        'pty-bound',
        boundPromptFingerprint,
        created.value.revision,
      );
      if (!ptyBound) { attempt.runStartReady.resolve(null); return reconciliationRequired(); }
      try {
        options.assertForwardAdmission?.();
      } catch {
        if (!await releaseOwnedClaim(attempt)) attempt.claimOwnership = 'poisoned';
        attempt.runStartReady.resolve(null);
        return reconciliationRequired();
      }
      if (attempt.cancelled || attempt.record?.status === 'cancelled') {
        await releaseOwnedClaim(attempt);
        attempt.runStartReady.resolve(null);
        return refuse('cancelled', 'attempt was cancelled before its session was created');
      }

      // ---- PHASE 1: the registry creates and atomically binds the run session. ----
      let started: PortResult<StartRunSessionReceipt>;
      try {
        options.assertForwardAdmission?.();
      } catch {
        if (!await releaseOwnedClaim(attempt)) attempt.claimOwnership = 'poisoned';
        attempt.runStartReady.resolve(null);
        return reconciliationRequired();
      }
      try {
        started = await options.sessionRecords.startRunSession({
          operator: input.subject,
          runRef: input.runRef,
          attemptRef: input.attemptRef,
          managedSessionRef: input.sessionRef,
          hostOperationKey,
          requestHash: requestFingerprint,
          recipe: prepared.recipe,
          rootId: input.rootId,
          relativeCwd: input.relativeCwd,
          size: { cols: input.cols, rows: input.rows },
          displayName: input.proposalStage.title,
          sink,
        });
      } catch (error) {
        attempt.claimOwnership = 'poisoned';
        attempt.runStartReady.resolve(null);
        return reconciliationRequired();
      }
      if (!started.ok) {
        if (!await releaseOwnedClaim(attempt)) { attempt.runStartReady.resolve(null); return reconciliationRequired(); }
        attempt.runStartReady.resolve(null);
        return started;
      }
      attempt.runStart = started.value;
      attempt.sessionId = started.value.sessionId;
      attempt.runStartReady.resolve(started.value);
      void started.value.exit.then((observed) => {
        attempt.exited = true;
        try { options.recorder?.exit(input, observed); } catch { /* recorder observation is failure-isolated */ }
        exit.resolve(observed);
      }, () => {
        attempt.exited = true;
        exit.resolve(observedExitFailure(started.value.sessionId, 'abandoned'));
      });
      try { options.assertForwardAdmission?.(); } catch {
        if (!await releaseOwnedClaim(attempt)) attempt.claimOwnership = 'poisoned';
        await closeAttempt(attempt, started.value.sessionId);
        return reconciliationRequired();
      }
      const refreshed = await readRecord(input.operationKey);
      if (!refreshed.ok || refreshed.value === null) {
        return failAfterStart(refreshed.ok
          ? refuse('internal', 'durable attempt operation disappeared after session start')
          : refreshed);
      }
      attempt.record = refreshed.value;
      const cancelledAfterStart = await cancellationRefusal(attempt);
      if (cancelledAfterStart) return failAfterStart(cancelledAfterStart);
      if (attempt.exited) return failAfterStart(refuse('internal', 'session exited before approved prompt delivery'));

      // The chain's write-intent is the sole delivery admission. The old per-prompt PTY reservation is
      // deliberately not consulted or advanced: it would be a second delivery authority.
      try {
        options.assertForwardAdmission?.();
      } catch {
        if (!await releaseOwnedClaim(attempt)) attempt.claimOwnership = 'poisoned';
        return failAfterStart(reconciliationRequired());
      }
      try {
        const intent = await applyClaimTransition(
          attempt,
          (cas) => claims.recordWriteIntent({ ...cas, promptFingerprint: boundPromptFingerprint }),
          'write-intent',
          boundPromptFingerprint,
          attempt.claim?.claim.ptyOperationRevision ?? null,
        );
        if (!intent) return failAfterStart(reconciliationRequired());
        options.assertForwardAdmission?.();
      } catch { attempt.claimOwnership = 'poisoned'; return failAfterStart(reconciliationRequired()); }
      for (const prompt of prepared.prompts) {
        if (attempt.cancelled || attempt.exited) {
          // Once write intent exists, an exit/cancellation between opening frames is ambiguous.  The
          // PTY may have accepted the prior frame, so only close; never release or terminalize it.
          attempt.claimOwnership = 'poisoned';
          return failAfterStart(reconciliationRequired());
        }
        attempt.framesWritten += input.profile.runtime === 'claude' ? 1 : 0;
        let written: PortResult<{ accepted: number }>;
        try {
          options.assertForwardAdmission?.();
          written = await options.host.write(started.value.sessionId, prompt);
          options.assertForwardAdmission?.();
        } catch (error) {
          attempt.claimOwnership = 'poisoned';
          if (input.profile.runtime === 'claude') attempt.framesWritten -= 1;
          return failAfterStart(reconciliationRequired());
        }
        if (!written.ok || !written.value || written.value.accepted !== prompt.byteLength) {
          attempt.claimOwnership = 'poisoned';
          if (input.profile.runtime === 'claude') attempt.framesWritten -= 1;
          return failAfterStart(reconciliationRequired());
        }
      }
      // ---- END OF INPUT, for the recipes whose CLI reads stdin until EOF. ----
      // `codex exec -` (and `exec resume <ref> -`) will not start a turn until stdin CLOSES, so this is
      // part of delivering the approved prompt, not cleanup: skipping it leaves a child that hangs to
      // the attempt timeout, and a refusal here fails the start exactly as a refused prompt write does.
      // Claude's stream-json reader frames its own turns and needs the pipe HELD OPEN for the next one,
      // so its recipes never reach this call.
      if (recipeEndsInputOnEof(prepared.recipe) && (attempt.exited || attempt.cancelled)) {
        // The prompt itself is not a completed Codex delivery until EOF was accepted.  An exit after
        // the only prompt must not turn a skipped EOF into an acknowledged claim.
        attempt.claimOwnership = 'poisoned';
        return failAfterStart(reconciliationRequired());
      }
      if (recipeEndsInputOnEof(prepared.recipe)) {
        let ended: PortResult<{ ended: true }>;
        try {
          options.assertForwardAdmission?.();
          ended = await options.host.endInput(started.value.sessionId);
          options.assertForwardAdmission?.();
        } catch (error) {
          attempt.claimOwnership = 'poisoned';
          return failAfterStart(reconciliationRequired());
        }
        if (!ended.ok || !ended.value || ended.value.ended !== true) {
          attempt.claimOwnership = 'poisoned';
          return failAfterStart(reconciliationRequired());
        }
        if (attempt.exited || attempt.cancelled) {
          attempt.claimOwnership = 'poisoned';
          return failAfterStart(reconciliationRequired());
        }
      }
      if (attempt.cancelled) {
        attempt.claimOwnership = 'poisoned';
        return failAfterStart(reconciliationRequired());
      }
      const acknowledged = await applyClaimTransition(
        attempt,
        (cas) => claims.ackClaim({ ...cas, promptFingerprint: boundPromptFingerprint }),
        'acknowledged',
        boundPromptFingerprint,
        attempt.claim?.claim.ptyOperationRevision ?? null,
        true,
      );
      if (!acknowledged) return failAfterStart(reconciliationRequired());
      attempt.openingPromptsWritten = true;
      const cancelledBeforeReceipt = await cancellationRefusal(attempt);
      if (cancelledBeforeReceipt) return failAfterStart(cancelledBeforeReceipt);
      maybeCloseCompletedClaude(attempt);
      return {
        ok: true,
        value: {
          operationKey: input.operationKey,
          sessionId: started.value.sessionId,
          attemptRef: input.attemptRef,
          revision: started.value.documentRevision,
          boundAt: attempt.record.receipt?.settledAt ?? new Date(0).toISOString(),
          replayed: started.value.replayed,
        },
      };
    })();

    /**
     * The timer's escape hatch for an attempt that never got a session pointer. `receiptPromise` awaits
     * the registry start; a host that never resolves it would leave the result promise pending forever,
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
    /** Only the live creator can release a prewrite claim; observers never acquire its handle. */
    async cancel(input) {
      const attempt = attempts.get(input.operationKey) ?? null;
      if (attempt === null) {
        // A foreign adapter has no creator handle. A blind PTY tombstone cannot restore the claim and
        // would strand operator text, so it is observer-only rather than a second delivery authority.
        return reconciliationRequired();
      }
      if (attempt.cancelPromise) return attempt.cancelPromise;
      attempt.cancelled = true;
      attempt.cancelPromise = (async () => {
        if (attempt.claimOwnership !== 'creator') {
          if (attempt.runStart) await closeAttempt(attempt, attempt.runStart.sessionId);
          return reconciliationRequired();
        }
        let released = false;
        if (attempt.claim?.claim.state === 'claimed' || attempt.claim?.claim.state === 'prompt-bound'
          || attempt.claim?.claim.state === 'pty-bound') {
          released = await releaseOwnedClaim(attempt);
          if (!released) {
            if (attempt.runStart) await closeAttempt(attempt, attempt.runStart.sessionId);
            return reconciliationRequired();
          }
        }
        if (attempt.claim?.claim.state === 'pty-bind-admitted') {
          attempt.claimOwnership = 'poisoned';
          if (attempt.runStart) await closeAttempt(attempt, attempt.runStart.sessionId);
          return reconciliationRequired();
        }
        if (released || attempt.claim?.claim.state === 'write-intent') {
          if (attempt.runStart) return closeAttempt(attempt, attempt.runStart.sessionId);
          return { ok: true as const, value: observedExitFailure(attempt.sessionId ?? UNKNOWN_SESSION_ID, 'abandoned') };
        }
        const cancelled = await durablyCancel(input.operationKey, attempt);
        if (!cancelled.ok) return cancelled;
        const runStart = await attempt.runStartReady.promise;
        if (!runStart) {
          return { ok: true as const, value: observedExitFailure(attempt.sessionId ?? UNKNOWN_SESSION_ID, 'abandoned') };
        }
        return closeAttempt(attempt, runStart.sessionId);
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
