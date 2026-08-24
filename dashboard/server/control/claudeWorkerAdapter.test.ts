import { describe, expect, it } from 'vitest';
import type { ExecutionProfile } from './policy.ts';
import type { IterationOutcomeContract } from './iterationOutcome.ts';
import type { ProposalStage, ResolvedAgentAssignment } from './proposal.ts';
import type { WorkerAdapter, WorkerExecutionResult } from './execution.ts';
import type {
  ApprovedAttemptDeclaration,
  ApprovedCheckpointInstruction,
  ApprovedRunInstruction,
  AttemptExecutionPort,
  AttemptLaunch,
  AttemptStartReceipt,
  ObservedExit,
  PortResult,
} from '../pty/contracts.ts';
import {
  ATTEMPT_SESSION_COLS,
  ATTEMPT_SESSION_ROWS,
  createClaudeWorkerAdapter,
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_TIMEOUT_MS,
  relativeWorktreeCwd,
} from './claudeWorkerAdapter.ts';

/**
 * [C-S5] The runtime worker adapters own no process. Each maps one approved engine launch record onto
 * the closed `ApprovedAttemptDeclaration` the attempt port validates, and returns the port's own
 * two-phase `{receipt,result}` pair unchanged. Every case below therefore drives a RECORDING FAKE PORT:
 * there is no spawner seam left to inject, and the spawn/stream machinery these suites used to cover
 * moved behind `attemptSessionAdapter.ts` in W5.
 */

/** The host resolves `rootId` + `relativeCwd`; the retained adapters were handed an absolute path. */
const REPO_ROOT = 'C:/kb';

const CLAUDE_PROFILE: ExecutionProfile & { runtime: 'claude' } = {
  id: 'claude-worker', role: 'worker', runtime: 'claude', model: 'claude-sonnet',
  capabilities: ['read', 'write-approved-scope', 'emit-events'],
};
const CODEX_PROFILE: ExecutionProfile & { runtime: 'codex' } = {
  id: 'codex-worker', role: 'worker', runtime: 'codex', model: 'gpt-5.6',
  capabilities: ['read', 'write-approved-scope', 'run-approved-commands', 'emit-events'],
};
const ASSIGNMENT: ResolvedAgentAssignment = {
  agentId: 'reviewer-agent', declarationPath: '.agents/reviewer.md', declarationHash: 'a'.repeat(64),
  profileId: CLAUDE_PROFILE.id, runtime: 'claude', model: CLAUDE_PROFILE.model,
};
const STAGE: ProposalStage = {
  id: 'review-stage', title: 'Review stage', action: 'review:code', target: 'dashboard/server/control',
  workOrder: 'Review the adapter.', riskTier: 'T1', dependsOn: [], worker: { runtime: 'claude', model: 'claude-sonnet' },
  requiredSkills: ['code-review'], scope: { read: ['dashboard'], write: ['dashboard/server/control'] },
  artifacts: [{ id: 'review-report', path: 'dashboard/review.md', description: 'Review result.' }],
  checkpoints: [{ id: 'tests-green', label: 'Focused tests pass.' }], humanGates: [],
  assignment: ASSIGNMENT, workflowProfile: 'research',
};
const ITERATION_CONTRACT: IterationOutcomeContract = {
  iterationGroup: {
    iterationGroupId: 'review-loop',
    participants: [{ participantId: 'reviewer', stageRef: STAGE.id, role: 'judge', perspective: 'Correctness', mandate: 'Judge the change.' }],
    routes: [{ routeId: 'review-route', senderParticipantId: 'author', recipientParticipantId: 'reviewer', requestKinds: ['review'], baseResolutionStageIds: [] }],
    activation: { seedParticipantId: 'reviewer', seedArtifactIds: ['review-report'] },
    initialStepId: 'review-step', schedule: [{ stepId: 'review-step', routeId: 'review-route', cycle: 'current' }],
    artifacts: ['review-report'], criteria: [{ id: 'correct', description: 'The adapter is correct.' }],
    maxCycles: 2, cycleUnit: 'review-cycle', terminalAuthorities: [{ participantId: 'reviewer', verdict: 'pass' }],
  },
  request: {
    schema: 'kb.iteration-request/v1', requestRef: 'request-1', iterationLoopRef: 'loop-1',
    stepId: 'review-step', routeId: 'review-route', senderParticipantId: 'author', recipientParticipantId: 'reviewer',
    kind: 'review', cycle: 1, inputGenerationRefs: ['generation-1'], baseCommit: 'b'.repeat(40),
    artifactHashes: { 'review-report': 'c'.repeat(64) }, criteria: [{ id: 'correct', description: 'The adapter is correct.' }],
    unresolvedFindingRefs: [], preservedInvariants: ['receipt before result'], nextAcceptanceCheck: 'Run focused tests.',
    instructions: 'Return the review outcome.',
  },
  currentPositions: [],
};

function declaration(
  runtime: 'claude' | 'codex' = 'claude',
  overrides: Partial<ApprovedAttemptDeclaration> = {},
): ApprovedAttemptDeclaration {
  const profile = runtime === 'claude' ? CLAUDE_PROFILE : CODEX_PROFILE;
  const assignment: ResolvedAgentAssignment = runtime === 'claude' ? ASSIGNMENT : {
    ...ASSIGNMENT, profileId: CODEX_PROFILE.id, runtime: 'codex', model: CODEX_PROFILE.model,
  };
  const proposalStage: ProposalStage = runtime === 'claude' ? STAGE : {
    ...STAGE, worker: { runtime: 'codex', model: CODEX_PROFILE.model }, assignment,
  };
  return {
    operationKey: `op-${runtime === 'claude' ? 'a' : 'b'}${'0'.repeat(63)}`,
    subject: 'operator@example.test', runRef: 'run-11111111-1111-4111-8111-111111111111',
    stageRef: 'stage-22222222-2222-4222-8222-222222222222',
    attemptRef: `attempt-${runtime === 'claude' ? '3' : '4'}3333333-3333-4333-8333-333333333333`,
    sessionRef: `session-${runtime === 'claude' ? '5' : '6'}5555555-5555-4555-8555-555555555555`,
    rootId: 'worktrees', relativeCwd: 'orgs/example/worktree', cols: ATTEMPT_SESSION_COLS, rows: ATTEMPT_SESSION_ROWS,
    profile, workflowProfile: 'research', skills: ['code-review', 'security-review'],
    action: 'review:code', target: 'dashboard/server/control', workOrder: 'Implement the approved attempt adapter.',
    readScope: ['dashboard/server/control', 'dashboard/server/pty'], writeScope: ['dashboard/server/control'],
    checkpoints: ['tests-green', 'typecheck-green'], proposalStage, project: 'dashboard-v3',
    assignment, instructionMarkdown: '# Reviewer\nStay inside the declared scope.',
    ...overrides,
  } as ApprovedAttemptDeclaration;
}

function workerInput(input: ApprovedAttemptDeclaration): Parameters<WorkerAdapter['begin']>[0] {
  return {
    operationKey: input.operationKey, subject: input.subject, runRef: input.runRef, stageRef: input.stageRef,
    attemptRef: input.attemptRef, sessionRef: input.sessionRef, worktreePath: `${REPO_ROOT}/${input.relativeCwd}`,
    profile: input.profile, workflowProfile: input.workflowProfile, skills: input.skills, action: input.action,
    target: input.target, workOrder: input.workOrder, readScope: input.readScope, writeScope: input.writeScope,
    checkpoints: input.checkpoints,
    ...(input.assignment ? { assignment: input.assignment, instructionMarkdown: input.instructionMarkdown } : {}),
    ...(input.iterationContract ? { iterationContract: input.iterationContract, expectsIterationOutcome: true } : {}),
    proposalStage: input.proposalStage, project: input.project,
  };
}


interface Deferred<T> { promise: Promise<T>; resolve(value: T): void }
function deferred<T>(): Deferred<T> {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => { resolvePromise = resolve; });
  return { promise, resolve: resolvePromise };
}

const FAILED_START: WorkerExecutionResult = {
  state: 'failed', summary: 'attempt session start refused',
  usage: { inputTokens: 0, outputTokens: 0, costUsdMicros: 0 }, artifacts: [], checkpoints: [],
};

interface OpenAttempt {
  hash: string;
  launch: AttemptLaunch;
  receipt: Deferred<PortResult<AttemptStartReceipt>>;
  result: Deferred<WorkerExecutionResult>;
  settled: boolean;
}

/**
 * A recording fake of the W5 attempt port. It models exactly the port contract the adapters depend on:
 * one launch per `operationKey`, an exact duplicate declaration replaying the SAME receipt and result
 * promises, a changed request hash refusing with `binding-conflict`, and a cancel before the receipt
 * writing a tombstone (a cancelled receipt and a failed result) instead of ever producing a live one.
 * Every phase is caller-driven, so each ordering below is barriered rather than timing-hopeful.
 */
function recordingPort() {
  const declarations: ApprovedAttemptDeclaration[] = [];
  const order: string[] = [];
  const instructions: ApprovedRunInstruction[] = [];
  const open = new Map<string, OpenAttempt>();
  let liveRun: { operator: string; runRef: string } | null = null;

  const settle = (
    attempt: OpenAttempt,
    receipt: PortResult<AttemptStartReceipt>,
    result: WorkerExecutionResult,
  ): void => {
    if (attempt.settled) return;
    attempt.settled = true;
    attempt.receipt.resolve(receipt);
    attempt.result.resolve(result);
  };

  const port: AttemptExecutionPort = {
    begin(input) {
      declarations.push(input);
      order.push('begin:' + input.operationKey);
      const hash = JSON.stringify(input);
      const prior = open.get(input.operationKey);
      if (prior) {
        if (prior.hash === hash) return prior.launch;
        return {
          receipt: Promise.resolve({
            ok: false, refusal: 'binding-conflict',
            detail: 'operationKey already names a different approved attempt declaration',
          }),
          result: Promise.resolve(FAILED_START),
        };
      }
      const receipt = deferred<PortResult<AttemptStartReceipt>>();
      const result = deferred<WorkerExecutionResult>();
      const attempt: OpenAttempt = {
        hash, receipt, result, settled: false,
        launch: { receipt: receipt.promise, result: result.promise },
      };
      open.set(input.operationKey, attempt);
      return attempt.launch;
    },
    async cancel(input) {
      const attempt = open.get(input.operationKey);
      order.push('cancel:' + input.operationKey);
      const exit: ObservedExit = {
        sessionId: input.operationKey, sequence: 0, exitCode: null, signal: null,
        reason: 'abandoned', observedAt: new Date(0).toISOString(),
      };
      if (attempt) {
        settle(
          attempt,
          { ok: false, refusal: 'cancelled', detail: 'attempt was cancelled before its start receipt' },
          { ...FAILED_START, summary: 'attempt was cancelled before its start receipt' },
        );
      }
      return { ok: true, value: exit };
    },
    isRunLive(input) {
      return liveRun !== null && liveRun.operator === input.operator && liveRun.runRef === input.runRef;
    },
    async queueRunInstruction(input: ApprovedRunInstruction) {
      instructions.push(input);
      order.push('instruction:' + input.idempotencyKey);
      return true;
    },
    async queueRunInstructionAtCheckpoint(input: ApprovedCheckpointInstruction) {
      instructions.push(input);
      return true;
    },
    async drain() {},
  };

  return {
    port, declarations, order, instructions,
    setLive(run: { operator: string; runRef: string } | null) { liveRun = run; },
    resolveReceipt(operationKey: string, receipt: PortResult<AttemptStartReceipt>) {
      const attempt = open.get(operationKey);
      if (!attempt) throw new Error('no open attempt for ' + operationKey);
      order.push('receipt:' + operationKey);
      attempt.receipt.resolve(receipt);
    },
    resolveResult(operationKey: string, result: WorkerExecutionResult) {
      const attempt = open.get(operationKey);
      if (!attempt) throw new Error('no open attempt for ' + operationKey);
      attempt.settled = true;
      order.push('result:' + operationKey);
      attempt.result.resolve(result);
    },
    /** The start receipt an adopted (restart-replayed) attempt returns. */
    boundReceipt(input: ApprovedAttemptDeclaration, replayed: boolean): PortResult<AttemptStartReceipt> {
      return {
        ok: true,
        value: {
          operationKey: input.operationKey, sessionId: 'session-' + input.attemptRef,
          attemptRef: input.attemptRef, revision: 7, boundAt: new Date(0).toISOString(), replayed,
        },
      };
    },
  };
}

const SUCCEEDED: WorkerExecutionResult = {
  state: 'succeeded', summary: 'attempt completed',
  usage: { inputTokens: 11, outputTokens: 7, costUsdMicros: 42 }, artifacts: [], checkpoints: [],
};

/** Resolves after every already-queued microtask, so "still pending" is a proof, not a guess. */
async function settleMicrotasks(): Promise<void> {
  await new Promise((resolve) => { setTimeout(resolve, 0); });
}

async function isPending(promise: Promise<unknown>): Promise<boolean> {
  const marker = Symbol('pending');
  await settleMicrotasks();
  return (await Promise.race([promise, Promise.resolve(marker)])) === marker;
}

const WORKTREE_ROOT = REPO_ROOT;

describe('createClaudeWorkerAdapter two-phase start', () => {
  it('maps one approved engine record onto the exact approved attempt declaration', () => {
    const recorder = recordingPort();
    const adapter = createClaudeWorkerAdapter({ attemptPort: recorder.port, worktreeRoot: WORKTREE_ROOT });
    const expected = declaration('claude');

    adapter.begin(workerInput(expected));

    expect(recorder.declarations).toHaveLength(1);
    expect(recorder.declarations[0]).toEqual(expected);
    expect(recorder.declarations[0].rootId).toBe('worktrees');
    expect(recorder.declarations[0].relativeCwd).toBe('orgs/example/worktree');
  });

  it('carries an approved iteration contract through as a closed outcome fence', () => {
    const recorder = recordingPort();
    const adapter = createClaudeWorkerAdapter({ attemptPort: recorder.port, worktreeRoot: WORKTREE_ROOT });
    const expected = declaration('claude', {
      iterationContract: ITERATION_CONTRACT, expectsIterationOutcome: true,
    });

    adapter.begin(workerInput(expected));

    expect(recorder.declarations[0].iterationContract).toEqual(ITERATION_CONTRACT);
    expect(recorder.declarations[0].expectsIterationOutcome).toBe(true);
  });

  it('returns the port launch unchanged so the receipt settles strictly before the result', async () => {
    const recorder = recordingPort();
    const adapter = createClaudeWorkerAdapter({ attemptPort: recorder.port, worktreeRoot: WORKTREE_ROOT });
    const input = declaration('claude');

    const launch = adapter.begin(workerInput(input));
    expect(await isPending(launch.receipt)).toBe(true);
    recorder.resolveReceipt(input.operationKey, recorder.boundReceipt(input, false));
    expect((await launch.receipt).ok).toBe(true);
    expect(await isPending(launch.result)).toBe(true);
    recorder.resolveResult(input.operationKey, SUCCEEDED);

    expect(await launch.result).toEqual(SUCCEEDED);
    expect(recorder.order).toEqual([
      'begin:' + input.operationKey, 'receipt:' + input.operationKey, 'result:' + input.operationKey,
    ]);
  });

  it('cancels before the receipt as a tombstone and never yields a live receipt', async () => {
    const recorder = recordingPort();
    const adapter = createClaudeWorkerAdapter({ attemptPort: recorder.port, worktreeRoot: WORKTREE_ROOT });
    const input = declaration('claude');

    const launch = adapter.begin(workerInput(input));
    expect(await isPending(launch.receipt)).toBe(true);
    await recorder.port.cancel({ operationKey: input.operationKey, reason: 'operator stopped the run' });

    expect(await launch.receipt).toEqual({
      ok: false, refusal: 'cancelled', detail: 'attempt was cancelled before its start receipt',
    });
    expect((await launch.result).state).toBe('failed');
    expect(recorder.order).toEqual(['begin:' + input.operationKey, 'cancel:' + input.operationKey]);
  });

  it('surfaces a session that exited before its receipt as a refusal, never a running attempt', async () => {
    const recorder = recordingPort();
    const adapter = createClaudeWorkerAdapter({ attemptPort: recorder.port, worktreeRoot: WORKTREE_ROOT });
    const input = declaration('claude');

    const launch = adapter.begin(workerInput(input));
    recorder.resolveReceipt(input.operationKey, {
      ok: false, refusal: 'internal', detail: 'session exited before attempt binding',
    });
    recorder.resolveResult(input.operationKey, { ...FAILED_START, summary: 'session exited before attempt binding' });

    expect((await launch.receipt).ok).toBe(false);
    expect((await launch.result).state).toBe('failed');
  });

  it('shares one receipt and one result for an exact duplicate operationKey', async () => {
    const recorder = recordingPort();
    const adapter = createClaudeWorkerAdapter({ attemptPort: recorder.port, worktreeRoot: WORKTREE_ROOT });
    const input = declaration('claude');

    const first = adapter.begin(workerInput(input));
    const second = adapter.begin(workerInput(input));
    expect(second.receipt).toBe(first.receipt);
    expect(second.result).toBe(first.result);
    recorder.resolveReceipt(input.operationKey, recorder.boundReceipt(input, false));
    recorder.resolveResult(input.operationKey, SUCCEEDED);

    expect(await second.receipt).toEqual(await first.receipt);
    expect(await second.result).toBe(await first.result);
  });

  it('conflicts when the same operationKey carries a changed request hash', async () => {
    const recorder = recordingPort();
    const adapter = createClaudeWorkerAdapter({ attemptPort: recorder.port, worktreeRoot: WORKTREE_ROOT });
    const input = declaration('claude');

    adapter.begin(workerInput(input));
    const changed = adapter.begin(workerInput(
      declaration('claude', { workOrder: 'A different approved work order.' }),
    ));

    expect(await changed.receipt).toEqual({
      ok: false, refusal: 'binding-conflict',
      detail: 'operationKey already names a different approved attempt declaration',
    });
    expect((await changed.result).state).toBe('failed');
  });

  it('passes a replayed adoption receipt through unchanged after a restart', async () => {
    const recorder = recordingPort();
    const adapter = createClaudeWorkerAdapter({ attemptPort: recorder.port, worktreeRoot: WORKTREE_ROOT });
    const input = declaration('claude');

    const launch = adapter.begin(workerInput(input));
    recorder.resolveReceipt(input.operationKey, recorder.boundReceipt(input, true));

    const receipt = await launch.receipt;
    expect(receipt.ok && receipt.value.replayed).toBe(true);
    expect(receipt.ok && receipt.value.sessionId).toBe('session-' + input.attemptRef);
  });

  it('refuses before the port whenever the approved record cannot become a closed declaration', async () => {
    const recorder = recordingPort();
    const adapter = createClaudeWorkerAdapter({ attemptPort: recorder.port, worktreeRoot: WORKTREE_ROOT });
    const base = workerInput(declaration('claude'));
    const cases: Parameters<WorkerAdapter['begin']>[0][] = [
      { ...base, proposalStage: undefined },
      { ...base, project: undefined },
      { ...base, worktreePath: 'C:/elsewhere/worktree' },
      { ...base, expectsIterationOutcome: true },
      { ...base, instructionMarkdown: undefined },
      { ...base, profile: { ...base.profile, runtime: 'codex' } },
    ];

    for (const input of cases) {
      const launch = adapter.begin(input);
      expect((await launch.receipt).ok).toBe(false);
      expect((await launch.result).state).toBe('failed');
    }
    expect(recorder.declarations).toHaveLength(0);
  });

  it('refuses every attempt when no attempt port is activated', async () => {
    const adapter = createClaudeWorkerAdapter({ attemptPort: null, worktreeRoot: WORKTREE_ROOT });

    const launch = adapter.begin(workerInput(declaration('claude')));

    expect(await launch.receipt).toEqual({
      ok: false, refusal: 'invalid-request', detail: 'no attempt execution port is activated',
    });
    expect((await launch.result).state).toBe('failed');
  });

  it('routes an operator message to the port only while that run is live', async () => {
    const recorder = recordingPort();
    const adapter = createClaudeWorkerAdapter({ attemptPort: recorder.port, worktreeRoot: WORKTREE_ROOT });
    const input = declaration('claude');
    adapter.begin(workerInput(input));
    const agentId = input.assignment?.agentId ?? input.profile.id;

    expect(adapter.postMessage(input.runRef, agentId, 'steer left')).toBe(false);
    recorder.setLive({ operator: input.subject, runRef: input.runRef });
    expect(adapter.postMessage(input.runRef, agentId, 'steer left')).toBe(true);
    expect(adapter.postMessage(input.runRef, 'unknown-agent', 'steer left')).toBe(false);

    await settleMicrotasks();
    expect(recorder.instructions).toHaveLength(1);
    expect(recorder.instructions[0]).toMatchObject({
      operator: input.subject, runRef: input.runRef, message: 'steer left',
    });
  });

  it('keeps the shared attempt limits and the worktree-relative rule the port consumes', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(30 * 60_000);
    expect(DEFAULT_MAX_OUTPUT_BYTES).toBe(64 * 1024 * 1024);
    expect(relativeWorktreeCwd(WORKTREE_ROOT, WORKTREE_ROOT + '/orgs/example/worktree'))
      .toBe('orgs/example/worktree');
    expect(() => relativeWorktreeCwd(WORKTREE_ROOT, WORKTREE_ROOT + '/../escape'))
      .toThrow(/escapes the server-owned worktree root/);
  });

  /**
   * The attempt path composes NO child env ([C-S2]). The old launcher suites proved every credential
   * variable absent from a spawned child's env; the declaration that replaced that spawn must carry no
   * env at all, so a polluted parent environment has nothing to leak into. The child env itself is the
   * PTY host's single source of truth (`control/childEnv.ts`), covered by `childEnv.test.ts`.
   */
  it('hands the port a declaration with no env and no credential-named material', () => {
    const recorder = recordingPort();
    const adapter = createClaudeWorkerAdapter({ attemptPort: recorder.port, worktreeRoot: WORKTREE_ROOT });
    const polluted = {
      ANTHROPIC_API_KEY: 'sk-test-not-a-real-key',
      GITHUB_TOKEN: 'ghp-test-not-a-real-token',
      AWS_SECRET_ACCESS_KEY: 'test-not-a-real-secret',
      KB_DB_PASSWORD: 'test-not-a-real-password',
      GOOGLE_APPLICATION_CREDENTIALS: 'C:/kb/not-a-real-credential.json',
    };
    const restore: Array<[string, string | undefined]> = Object.keys(polluted)
      .map((name) => [name, process.env[name]] as [string, string | undefined]);
    Object.assign(process.env, polluted);
    try {
      adapter.begin(workerInput(declaration('claude')));
    } finally {
      for (const [name, value] of restore) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }

    expect(recorder.declarations).toHaveLength(1);
    const serialized = JSON.stringify(recorder.declarations[0]);
    for (const [name, value] of Object.entries(polluted)) {
      expect(serialized).not.toContain(name);
      expect(serialized).not.toContain(value);
    }
    expect(serialized).not.toMatch(/"(env|argv|args|command|executable|token|apiKey|password|credential)"/i);
    expect(Object.keys(recorder.declarations[0])).not.toContain('env');
  });
});
