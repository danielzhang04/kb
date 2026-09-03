import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createSessionRecordRegistry } from '../pty/sessionRecord.ts';
import { createEmptyPtySessionsDocument } from '../pty/sessionPersistence.ts';
import type { SessionPersistence } from '../pty/sessionPersistence.ts';
import { sha256Hex } from '../shared/hashing.ts';
import { createAttemptIoStore } from './attemptIo.ts';
import {
  attemptDeclarationFingerprint,
  createAttemptSessionAdapter as createAttemptSessionAdapterRaw,
} from './attemptSessionAdapter.ts';

type AdapterOptions = Parameters<typeof createAttemptSessionAdapterRaw>[0];
type TestAdapterOptions = Omit<AdapterOptions, 'sessionRecords'> & {
  bindings?: AttemptBindingPort;
  sessionRecords?: AdapterOptions['sessionRecords'];
  hostKind?: 'desktop' | 'vm';
};
function createAttemptSessionAdapter(
  options: TestAdapterOptions,
) {
  const { bindings = new MemoryBindings(), sessionRecords, hostKind: _hostKind, ...adapterOptions } = options;
  return createAttemptSessionAdapterRaw({
    ...adapterOptions,
    sessionRecords: sessionRecords ?? ('startRunSession' in bindings
      ? bindings as AdapterOptions['sessionRecords']
      : createMemorySessionRecords(options.host, bindings)),
  });
}
import {
  DEFAULT_MAX_OUTPUT_BYTES as CLAUDE_DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_TIMEOUT_MS as CLAUDE_DEFAULT_TIMEOUT_MS,
} from './claudeWorkerAdapter.ts';
import { loadWorkflowProfiles } from './environment.ts';
import type { ExecutionProfile } from './policy.ts';
import type { IterationOutcomeContract } from './iterationOutcome.ts';
import type { ProposalStage, ResolvedAgentAssignment } from './proposal.ts';
import {
  RUN_CONTROLLER_NULL_BROWSER_SESSION_REF,
  type ApprovedAttemptDeclaration,
  type AttemptBinding,
  type AttemptBindingPort,
  type AttemptOperationRecord,
  type HostStartReceipt,
  type ObservedExit,
  type PortResult,
  type PtyCapabilityProbe,
  type SessionHost,
  type SessionHostRequest,
  type SessionSink,
  type SessionSize,
} from '../pty/contracts.ts';

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
    rootId: 'worktrees', relativeCwd: 'orgs/example/worktree', cols: 120, rows: 42,
    profile, workflowProfile: 'research', skills: ['code-review', 'security-review'],
    action: 'review:code', target: 'dashboard/server/control', workOrder: 'Implement the approved attempt adapter.',
    readScope: ['dashboard/server/control', 'dashboard/server/pty'], writeScope: ['dashboard/server/control'],
    checkpoints: ['tests-green', 'typecheck-green'], proposalStage, project: 'dashboard-v3',
    assignment, instructionMarkdown: '# Reviewer\nStay inside the declared scope.',
    expectsIterationOutcome: false,
    ...overrides,
  } as ApprovedAttemptDeclaration;
}

interface Deferred<T> { promise: Promise<T>; resolve(value: T): void; reject(reason: unknown): void }
function deferred<T>(): Deferred<T> {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (reason: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => { resolvePromise = resolve; rejectPromise = reject; });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

interface HostAttempt {
  request: SessionHostRequest;
  sink: SessionSink;
  receipt: Deferred<PortResult<HostStartReceipt>>;
  exit: Deferred<ObservedExit>;
  sessionId: string;
  finished: boolean;
}

class MemorySessionHost implements SessionHost {
  private outputSequence = 0;
  readonly attempts: HostAttempt[] = [];
  readonly writes: Array<{ sessionId: string; bytes: Uint8Array }> = [];
  readonly closeCalls: string[] = [];
  readonly receipts = new Map<string, HostStartReceipt>();
  readonly writeGates = new Map<number, Deferred<void>>();
  readonly rejectedWrites = new Set<number>();
  /** Phase 1 is now write-ahead, so `create` happens after an await: queued outcomes apply on arrival. */
  private readonly queuedResolve = new Map<number, Partial<HostStartReceipt>>();
  private readonly queuedRefuse = new Map<number, PortResult<HostStartReceipt>>();
  finishAfterWrite: number | null = null;
  rejectClose = false;
  refuseClose = false;
  writeCalls = 0;
  listEpochCalls = 0;
  drainCalls: string[] = [];

  readonly events: string[];

  constructor(events: string[] = []) {
    this.events = events;
  }

  async probe(): Promise<PtyCapabilityProbe> {
    return { available: true, host: 'desktop', transport: 'local-node-pty', launchers: ['claude', 'codex'], roots: ['worktrees'], epochId: 'epoch-11111111111111111111111111111111', checkedAt: '2026-08-23T00:00:00.000Z' };
  }

  create(request: SessionHostRequest, sink: SessionSink) {
    this.events.push(`host.create:${request.operationKey}`);
    const prior = this.receipts.get(request.operationKey);
    const index = this.attempts.length;
    const sessionId = prior?.sessionId ?? `pty-${String(index + 1).padStart(32, '0')}`;
    const attempt: HostAttempt = { request, sink, receipt: deferred(), exit: deferred(), sessionId, finished: false };
    this.attempts.push(attempt);
    if (prior) queueMicrotask(() => attempt.receipt.resolve({ ok: true, value: { ...prior, replayed: true } }));
    const queuedResolve = this.queuedResolve.get(index);
    if (queuedResolve) { this.queuedResolve.delete(index); this.resolveCreate(index, queuedResolve); }
    const queuedRefuse = this.queuedRefuse.get(index);
    if (queuedRefuse) { this.queuedRefuse.delete(index); attempt.receipt.resolve(queuedRefuse); }
    return { receipt: attempt.receipt.promise, exit: attempt.exit.promise };
  }

  resolveCreate(index: number, overrides: Partial<HostStartReceipt> = {}): void {
    const attempt = this.attempts[index];
    if (!attempt) { this.queuedResolve.set(index, overrides); return; }
    const receipt: HostStartReceipt = {
      operationKey: attempt.request.operationKey, sessionId: attempt.sessionId,
      epochId: 'epoch-11111111111111111111111111111111', outputSequence: 1,
      boundAt: '2026-08-23T00:00:01.000Z', replayed: false, ...overrides,
    };
    this.receipts.set(attempt.request.operationKey, receipt);
    attempt.receipt.resolve({ ok: true, value: receipt });
  }

  refuseCreate(index: number, refusal: PortResult<HostStartReceipt>): void {
    const attempt = this.attempts[index];
    if (!attempt) { this.queuedRefuse.set(index, refusal); return; }
    attempt.receipt.resolve(refusal);
  }

  emit(index: number, text: string, replay = false): void {
    this.emitBytes(index, Buffer.from(text, 'utf8'), replay);
  }

  emitBytes(index: number, bytes: Uint8Array, replay = false): void {
    const attempt = this.attempts[index];
    attempt.sink.data({
      sessionId: attempt.sessionId, sequence: this.outputSequence, encoding: 'base64',
      data: Buffer.from(bytes).toString('base64'), replay,
    });
    this.outputSequence += 1;
  }

  finish(index: number, exitCode: number | null = 0, reason: ObservedExit['reason'] = 'exited'): ObservedExit {
    const attempt = this.attempts[index];
    const exit: ObservedExit = {
      sessionId: attempt.sessionId, sequence: 99, exitCode, signal: null, reason,
      observedAt: '2026-08-23T00:00:02.000Z',
    };
    if (!attempt.finished) {
      attempt.finished = true;
      attempt.sink.exit(exit);
      attempt.exit.resolve(exit);
    }
    return exit;
  }

  async attach(_sessionId: string, _sink: SessionSink) { return { ok: true as const, value: { attachmentId: 'att-11111111111111111111111111111111' } }; }
  async write(sessionId: string, data: Uint8Array) {
    const call = this.writeCalls++;
    const gate = this.writeGates.get(call);
    if (gate) await gate.promise;
    if (this.rejectedWrites.has(call)) throw new Error(`write ${call} rejected`);
    const live = this.attempts.some((attempt) => attempt.sessionId === sessionId && !attempt.finished);
    if (!live) {
      return { ok: false as const, refusal: 'not-found' as const, detail: 'session already finished' };
    }
    this.writes.push({ sessionId, bytes: Uint8Array.from(data) });
    if (this.finishAfterWrite === call) {
      const index = this.attempts.findIndex((attempt) => attempt.sessionId === sessionId && !attempt.finished);
      if (index >= 0) this.finish(index, 0);
    }
    return { ok: true as const, value: { accepted: data.byteLength } };
  }
  async resize(_sessionId: string, size: SessionSize) { return { ok: true as const, value: size }; }
  async close(sessionId: string) {
    this.closeCalls.push(sessionId);
    if (this.rejectClose) throw new Error('close rejected');
    if (this.refuseClose) return { ok: false as const, refusal: 'internal' as const, detail: 'close refused' };
    const index = this.attempts.findIndex((attempt) => attempt.sessionId === sessionId && !attempt.finished);
    const exit = index >= 0 ? this.finish(index, null, 'closed') : {
      sessionId, sequence: 99, exitCode: null, signal: null, reason: 'closed' as const,
      observedAt: '2026-08-23T00:00:02.000Z',
    };
    return { ok: true as const, value: exit };
  }
  async listEpoch() {
    this.listEpochCalls += 1;
    return { ok: true as const, value: {
      epochId: 'epoch-11111111111111111111111111111111',
      sessionIds: this.attempts.filter((attempt) => !attempt.finished).map((attempt) => attempt.sessionId),
    } };
  }
  async drain(epochId: string) {
    this.drainCalls.push(epochId);
    const closed: string[] = [];
    for (let index = 0; index < this.attempts.length; index += 1) {
      const attempt = this.attempts[index];
      if (attempt.finished) continue;
      closed.push(attempt.sessionId);
      this.finish(index, null, 'closed');
    }
    return { ok: true as const, value: { epochId, closed, alreadyGone: [] } };
  }
}

/**
 * A deliberately dumb CAS store: revision match or `binding-conflict`, nothing else. Declaration-identity,
 * cancellation and terminal-status guards belong to the adapter and are asserted through it.
 */
type BindingInput = {
  operator: string;
  runRef: string;
  attemptRef: string;
  managedSessionRef: string;
  sessionId: string;
};

class MemoryBindings implements AttemptBindingPort {
  readonly rows: AttemptBinding[] = [];
  readonly calls: BindingInput[] = [];
  readonly operations = new Map<string, AttemptOperationRecord>();
  readonly conflictOn = new Set<number>();
  gate: Deferred<void> | null = null;
  nextRefusal: PortResult<{ revision: number }> | null = null;
  rejectStartBinding = false;
  rejectOperationWrite = false;
  beforeWrite: ((record: AttemptOperationRecord, expectedRevision: number | null, call: number) => void) | null = null;
  writeCalls = 0;

  readonly events: string[];

  constructor(events: string[] = []) {
    this.events = events;
  }

  async recordBinding(input: BindingInput): Promise<PortResult<{ revision: number }>> {
    this.calls.push(input);
    const gate = this.gate;
    if (gate) await gate.promise;
    if (this.rejectStartBinding) throw new Error('start binding rejected');
    if (this.nextRefusal) {
      const refusal = this.nextRefusal;
      this.nextRefusal = null;
      return refusal;
    }
    const prior = this.rows.find((row) => row.attemptRef === input.attemptRef || row.sessionId === input.sessionId);
    if (prior) {
      const exact = prior.operator === input.operator && prior.runRef === input.runRef
        && prior.attemptRef === input.attemptRef && prior.managedSessionRef === input.managedSessionRef
        && prior.sessionId === input.sessionId;
      return exact
        ? { ok: true, value: { revision: this.rows.length } }
        : { ok: false, refusal: 'binding-conflict', detail: 'binding differs' };
    }
    this.rows.push({ ...input, createdAt: '2026-08-23T00:00:01.000Z' });
    return { ok: true, value: { revision: this.rows.length } };
  }
  byAttempt(operator: string, attemptRef: string) { return this.rows.find((row) => row.operator === operator && row.attemptRef === attemptRef) ?? null; }
  bySession(operator: string, sessionId: string) { return this.rows.find((row) => row.operator === operator && row.sessionId === sessionId) ?? null; }
  byRun(operator: string, runRef: string) { return this.rows.filter((row) => row.operator === operator && row.runRef === runRef); }

  async readOperation(operationKey: string): Promise<AttemptOperationRecord | null> {
    const value = this.operations.get(operationKey);
    return value ? structuredClone(value) : null;
  }

  async writeOperation(
    record: AttemptOperationRecord,
    expectedRevision: number | null,
  ): Promise<PortResult<AttemptOperationRecord>> {
    const call = this.writeCalls++;
    this.beforeWrite?.(record, expectedRevision, call);
    if (this.rejectOperationWrite) throw new Error('operation write rejected');
    if (this.conflictOn.delete(call)) {
      return { ok: false, refusal: 'binding-conflict', detail: 'forced operation conflict' };
    }
    const prior = this.operations.get(record.operationKey);
    if ((prior?.revision ?? null) !== expectedRevision) {
      return { ok: false, refusal: 'binding-conflict', detail: 'operation revision changed' };
    }
    const written: AttemptOperationRecord = { ...structuredClone(record), revision: (prior?.revision ?? 0) + 1 };
    this.operations.set(record.operationKey, written);
    this.events.push(`bindings.write:${record.operationKey}:${written.status}:${written.promptsDelivered}`);
    return { ok: true, value: structuredClone(written) };
  }

  seed(record: AttemptOperationRecord): void {
    this.operations.set(record.operationKey, structuredClone(record));
  }
}

function createMemorySessionRecords(
  host: SessionHost,
  bindings: AttemptBindingPort,
): AdapterOptions['sessionRecords'] {
  const startStore = bindings as AttemptBindingPort & {
    recordBinding(input: BindingInput): Promise<PortResult<{ revision: number }>>;
  };
  return {
    byAttempt: (operator, attemptRef) => bindings.byAttempt(operator, attemptRef),
    readOperation: (operationKey) => bindings.readOperation(operationKey),
    writeOperation: (record, expectedRevision) => bindings.writeOperation(record, expectedRevision),
    async startRunSession(input) {
      const launch = host.create({
        operationKey: input.hostOperationKey,
        principal: {
          operator: input.operator,
          browserSessionRef: RUN_CONTROLLER_NULL_BROWSER_SESSION_REF,
        },
        recipe: input.recipe,
        rootId: input.rootId,
        relativeCwd: input.relativeCwd,
        cols: input.size.cols,
        rows: input.size.rows,
      }, input.sink);
      const receipt = await launch.receipt;
      if (!receipt.ok) return receipt;
      const current = await bindings.readOperation(input.hostOperationKey);
      if (current === null) {
        await host.close(receipt.value.sessionId);
        return { ok: false, refusal: 'internal', detail: 'missing pending operation' };
      }
      if (current.sessionId !== null && current.sessionId !== receipt.value.sessionId) {
        await host.close(receipt.value.sessionId);
        return { ok: false, refusal: 'binding-conflict', detail: 'run session binding conflict' };
      }
      const bound = await bindings.writeOperation({
        ...current,
        status: 'bound',
        sessionId: receipt.value.sessionId,
        receipt: {
          operationKey: input.hostOperationKey,
          requestHash: input.requestHash,
          status: 'bound',
          sessionId: receipt.value.sessionId,
          attemptRef: input.attemptRef,
          refusal: null,
          createdAt: current.receipt?.createdAt ?? receipt.value.boundAt,
          settledAt: receipt.value.boundAt,
        },
      }, current.revision);
      if (!bound.ok) {
        await host.close(receipt.value.sessionId);
        return bound;
      }
      let binding: PortResult<{ revision: number }>;
      try {
        binding = await startStore.recordBinding({
          operator: input.operator,
          runRef: input.runRef,
          attemptRef: input.attemptRef,
          managedSessionRef: input.managedSessionRef,
          sessionId: receipt.value.sessionId,
        });
      } catch (error) {
        await host.close(receipt.value.sessionId);
        return {
          ok: false,
          refusal: 'internal',
          detail: error instanceof Error ? error.message : String(error),
        };
      }
      if (!binding.ok) {
        await host.close(receipt.value.sessionId);
        return binding;
      }
      return {
        ok: true,
        value: {
          sessionId: receipt.value.sessionId,
          epochId: receipt.value.epochId,
          outputCursor: 0,
          replayed: receipt.value.replayed,
          documentRevision: binding.value.revision,
          exit: launch.exit,
          close: () => host.close(receipt.value.sessionId),
        },
      };
    },
  };
}

function mixedOperationBindings(host: SessionHost): {
  bindings: AttemptBindingPort;
  sessionRecords: ReturnType<typeof createSessionRecordRegistry>;
  readDocument: () => ReturnType<typeof createEmptyPtySessionsDocument>;
} {
  let document = createEmptyPtySessionsDocument();
  const persistence: SessionPersistence = {
    read: () => structuredClone(document),
    mutate: async (_expectedRevision, callback) => {
      const draft = structuredClone(document);
      const value = await callback(draft);
      draft.revision += 1;
      document = draft;
      return { revision: document.revision, value };
    },
  };
  const registry = createSessionRecordRegistry({ persistence, host });
  return { bindings: registry, sessionRecords: registry, readDocument: () => structuredClone(document) };
}

describe('control operation key translation', () => {
  it('refuses construction without the run-session document authority', () => {
    expect(() => createAttemptSessionAdapterRaw({
      host: new MemorySessionHost(),
      sessionRecords: undefined as never,
    })).toThrow('attempt session records are required');
  });

  it('persists an automatic-attempt key with real operations and a fake binding projection', async () => {
    const host = new MemorySessionHost();
    const { bindings, sessionRecords, readDocument } = mixedOperationBindings(host);
    const controlOperationKey = 'automatic-attempt:attempt-x';
    const expectedHostKey = `op-${sha256Hex(controlOperationKey)}`;
    const input = declaration('codex', { operationKey: controlOperationKey, attemptRef: 'attempt-x' });
    const launch = createAttemptSessionAdapter({ host, bindings, sessionRecords }).begin(input);

    await vi.waitFor(() => expect(host.attempts).toHaveLength(1));
    host.attempts[0]!.receipt.resolve({
      ok: true,
      value: {
        operationKey: expectedHostKey,
        sessionId: host.attempts[0]!.sessionId,
        epochId: `epoch-${'1'.repeat(32)}`,
        outputSequence: 1,
        boundAt: '2026-09-02T18:26:00.000Z',
        replayed: false,
      },
    });

    await expect(launch.receipt).resolves.toMatchObject({
      ok: true,
      value: { operationKey: controlOperationKey, attemptRef: 'attempt-x' },
    });
    const persisted = readDocument().attemptOperations[expectedHostKey];
    expect(persisted?.operationKey).toMatch(/^op-[0-9a-f]{64}$/);
    expect(persisted?.operationKey).toBe(expectedHostKey);
    expect(persisted?.attemptRef).toBe('attempt-x');
  });

  it('memoizes one host create per control key and separates different control keys', async () => {
    const host = new MemorySessionHost();
    const { bindings } = mixedOperationBindings(host);
    const firstInput = declaration('codex', {
      operationKey: 'automatic-attempt:attempt-x',
      attemptRef: 'attempt-x',
    });
    const adapter = createAttemptSessionAdapter({ host, bindings });

    const first = adapter.begin(firstInput);
    const replay = adapter.begin(firstInput);
    expect(replay).toBe(first);
    await vi.waitFor(() => expect(host.attempts).toHaveLength(1));

    const secondControlKey = 'automatic-attempt:attempt-y';
    adapter.begin({ ...firstInput, operationKey: secondControlKey, attemptRef: 'attempt-y' });
    await vi.waitFor(() => expect(host.attempts).toHaveLength(2));
    expect(host.attempts.map((attempt) => attempt.request.operationKey)).toEqual([
      `op-${sha256Hex(firstInput.operationKey)}`,
      `op-${sha256Hex(secondControlKey)}`,
    ]);
  });

  it('cancels by the control key while updating the mapped durable record', async () => {
    const host = new MemorySessionHost();
    const { bindings, readDocument } = mixedOperationBindings(host);
    const controlOperationKey = 'automatic-attempt:attempt-x';
    const expectedHostKey = `op-${sha256Hex(controlOperationKey)}`;
    const input = declaration('codex', { operationKey: controlOperationKey, attemptRef: 'attempt-x' });
    createAttemptSessionAdapter({ host, bindings }).begin(input);
    await vi.waitFor(() => expect(readDocument().attemptOperations[expectedHostKey]?.status).toBe('pending'));

    const cancellation = await createAttemptSessionAdapter({ host, bindings }).cancel({
      operationKey: controlOperationKey,
      reason: 'operator stop',
    });

    expect(cancellation.ok).toBe(true);
    expect(readDocument().attemptOperations[expectedHostKey]).toMatchObject({
      operationKey: expectedHostKey,
      status: 'cancelled',
    });
    expect(readDocument().attemptOperations[controlOperationKey]).toBeUndefined();
  });
});

function seededRecord(
  input: ApprovedAttemptDeclaration,
  overrides: Partial<AttemptOperationRecord> = {},
): AttemptOperationRecord {
  const requestHash = attemptDeclarationFingerprint(input);
  const operationKey = `op-${sha256Hex(input.operationKey)}`;
  return {
    operationKey, requestHash, status: 'pending', promptsDelivered: 0,
    sessionId: null, attemptRef: input.attemptRef,
    receipt: {
      operationKey, requestHash, status: 'pending', sessionId: null,
      attemptRef: input.attemptRef, refusal: null, createdAt: '2026-08-23T00:00:00.000Z', settledAt: null,
    },
    revision: 1, updatedAt: '2026-08-23T00:00:00.000Z', ...overrides,
  };
}

function claudeLine(summary: string, sessionId = 'claude-session-1'): string {
  return `${JSON.stringify({
    type: 'result', subtype: 'success', is_error: false, result: summary, session_id: sessionId,
    usage: { input_tokens: 7, cache_creation_input_tokens: 2, cache_read_input_tokens: 3, output_tokens: 5 },
    total_cost_usd: 0,
  })}\n`;
}
function claudeTranscript(summary: string): string { return claudeLine('declaration accepted') + claudeLine(summary); }
function codexTranscript(summary: string, threadId = 'thread-1'): string {
  return [
    JSON.stringify({ type: 'thread.started', thread_id: threadId }),
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: summary } }),
    JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 11, output_tokens: 13 } }),
  ].join('\n') + '\n';
}

describe('registry-owned attempt session adapter', () => {
  it('applies ONE pair of limits to BOTH runtimes from the retained constants', () => {
    // The codex adapter no longer carries its own copy of these limits (its mirrored constants were
    // dead code): the port applies the retained pair to every runtime, so a drift has nowhere to hide.
    expect(CLAUDE_DEFAULT_TIMEOUT_MS).toBe(30 * 60_000);
    expect(CLAUDE_DEFAULT_MAX_OUTPUT_BYTES).toBe(64 * 1024 * 1024);
  });

  it('names the controller-null principal on every host create', async () => {
    const host = new MemorySessionHost();
    const input = declaration();
    const launch = createAttemptSessionAdapter({ host, bindings: new MemoryBindings() }).begin(input);
    host.resolveCreate(0);
    await launch.receipt;
    expect(host.attempts[0].request.principal).toEqual({
      operator: input.subject, browserSessionRef: RUN_CONTROLLER_NULL_BROWSER_SESSION_REF,
    });
    expect(RUN_CONTROLLER_NULL_BROWSER_SESSION_REF).toBe('run-controller-null');
  });

  it('writes the durable pending intent before the host session exists and settles it terminally', async () => {
    const events: string[] = [];
    const host = new MemorySessionHost(events);
    const bindings = new MemoryBindings(events);
    const input = declaration('codex');
    const launch = createAttemptSessionAdapter({ host, bindings }).begin(input);
    await vi.waitFor(() => expect(host.attempts).toHaveLength(1));
    host.resolveCreate(0);
    await launch.receipt;
    const expectedHostKey = `op-${sha256Hex(input.operationKey)}`;
    expect(events[0]).toBe(`bindings.write:${expectedHostKey}:pending:0`);
    expect(events[1]).toBe(`host.create:${expectedHostKey}`);
    expect(bindings.operations.get(`op-${sha256Hex(input.operationKey)}`)).toMatchObject({
      status: 'bound', promptsDelivered: 1, sessionId: host.attempts[0].sessionId,
      requestHash: attemptDeclarationFingerprint(input),
    });
    host.emit(0, codexTranscript('done'));
    host.finish(0);
    await expect(launch.result).resolves.toMatchObject({ state: 'succeeded' });
    expect(bindings.operations.get(`op-${sha256Hex(input.operationKey)}`)?.status).toBe('completed');
  });

  it('refuses a different host session after adopting a create-CAS winner', async () => {
    const host = new MemorySessionHost();
    const bindings = new MemoryBindings();
    const input = declaration('codex');
    // A rival instance wins the create CAS between our read and our write.
    bindings.beforeWrite = (record, expectedRevision) => {
      if (expectedRevision === null) {
        bindings.seed(seededRecord(input, { status: 'pending', promptsDelivered: 1, sessionId: 'rival-session' }));
        bindings.beforeWrite = null;
      }
      void record;
    };
    const launch = createAttemptSessionAdapter({ host, bindings }).begin(input);
    await vi.waitFor(() => expect(host.attempts).toHaveLength(1));
    host.resolveCreate(0);
    await expect(launch.receipt).resolves.toMatchObject({ ok: false, refusal: 'binding-conflict' });
    // The registry owns the collision decision and closes only the session this instance created.
    expect(host.writes).toHaveLength(0);
    expect(host.closeCalls).toEqual([host.attempts[0].sessionId]);
    expect(bindings.operations.get(`op-${sha256Hex(input.operationKey)}`)?.promptsDelivered).toBe(1);
  });

  it('reserves each prompt durably before writing it and never re-sends a reserved prompt', async () => {
    const input = declaration();

    // Crash before any prompt: nothing reserved, so a restart delivers both prompts exactly once.
    const beforeHost = new MemorySessionHost();
    const beforeBindings = new MemoryBindings();
    beforeBindings.gate = deferred();
    const crashed = createAttemptSessionAdapter({ host: beforeHost, bindings: beforeBindings }).begin(input);
    await vi.waitFor(() => expect(beforeHost.attempts).toHaveLength(1));
    beforeHost.resolveCreate(0);
    await vi.waitFor(() => expect(beforeBindings.calls).toHaveLength(1));
    beforeBindings.gate = null;
    const restarted = createAttemptSessionAdapter({ host: beforeHost, bindings: beforeBindings }).begin(input);
    await expect(restarted.receipt).resolves.toMatchObject({ ok: true, value: { replayed: true } });
    const beforeWrites = beforeHost.writes.map((write) => Buffer.from(write.bytes).toString('utf8'));
    expect(beforeWrites).toHaveLength(2);
    expect(new Set(beforeWrites).size).toBe(2);
    void crashed;

    // Crash after the reservation but before the bytes leave: the restart must NOT re-send prompt 1.
    const betweenHost = new MemorySessionHost();
    const betweenBindings = new MemoryBindings();
    betweenHost.writeGates.set(1, deferred<void>());
    const interrupted = createAttemptSessionAdapter({ host: betweenHost, bindings: betweenBindings }).begin(input);
    await vi.waitFor(() => expect(betweenHost.attempts).toHaveLength(1));
    betweenHost.resolveCreate(0);
    await vi.waitFor(() => {
      expect(betweenHost.writes).toHaveLength(1);
      expect(betweenHost.writeCalls).toBe(2);
      expect(betweenBindings.operations.get(`op-${sha256Hex(input.operationKey)}`)?.promptsDelivered).toBe(2);
    });
    const resumed = createAttemptSessionAdapter({ host: betweenHost, bindings: betweenBindings }).begin(input);
    await expect(resumed.receipt).resolves.toMatchObject({ ok: true, value: { replayed: true } });
    expect(betweenHost.writes).toHaveLength(1);
    void interrupted;
  });

  it('recomputes the prompt reservation from the current record instead of a local index', async () => {
    const host = new MemorySessionHost();
    const bindings = new MemoryBindings();
    const input = declaration();
    // Force the first prompt reservation to lose its CAS while a rival advances the counter to 1.
    bindings.beforeWrite = (record, _expected, call) => {
      if (record.promptsDelivered === 1 && record.status === 'bound') {
        bindings.conflictOn.add(call);
        bindings.seed({
          ...bindings.operations.get(`op-${sha256Hex(input.operationKey)}`)!, promptsDelivered: 1, revision: 9,
        });
        bindings.beforeWrite = null;
      }
    };
    const launch = createAttemptSessionAdapter({ host, bindings }).begin(input);
    await vi.waitFor(() => expect(host.attempts).toHaveLength(1));
    host.resolveCreate(0);
    await expect(launch.receipt).resolves.toMatchObject({ ok: false, refusal: 'binding-conflict' });
    // The counter advanced to 2 on the winner's state; it never regressed to 1 and re-armed a duplicate.
    expect(bindings.operations.get(`op-${sha256Hex(input.operationKey)}`)?.promptsDelivered).toBe(2);
    expect(host.writes).toHaveLength(0);
  });

  it('refuses a prompt reservation that a cancel overtook, and writes no prompt bytes', async () => {
    const host = new MemorySessionHost();
    const bindings = new MemoryBindings();
    const input = declaration('codex');
    // The reservation CAS loses its revision check; by the time it re-reads, another instance has
    // durably cancelled the key. The retry sees a terminal record and must refuse — even though the
    // reservation patch changes only the counter and would leave the status exactly as it found it.
    bindings.beforeWrite = (record, _expectedRevision, call) => {
      if (record.promptsDelivered === 1 && record.status === 'bound') {
        bindings.conflictOn.add(call);
        const current = bindings.operations.get(`op-${sha256Hex(input.operationKey)}`)!;
        bindings.seed({ ...current, status: 'cancelled' });
        bindings.beforeWrite = null;
      }
    };
    const launch = createAttemptSessionAdapter({ host, bindings }).begin(input);
    await vi.waitFor(() => expect(host.attempts).toHaveLength(1));
    host.resolveCreate(0);
    await expect(launch.receipt).resolves.toMatchObject({ ok: false, refusal: 'cancelled' });
    expect(host.writes).toHaveLength(0);
    expect(bindings.operations.get(`op-${sha256Hex(input.operationKey)}`)).toMatchObject({
      status: 'cancelled', promptsDelivered: 0,
    });
  });

  it('refuses to adopt a create-CAS winner that is still delivering its approved prompts', async () => {
    const host = new MemorySessionHost();
    const bindings = new MemoryBindings();
    const input = declaration(); // claude: two approved prompts
    // The rival wins the create CAS while only halfway through its own prompt sequence.
    bindings.beforeWrite = (record, expectedRevision) => {
      if (expectedRevision === null) {
        bindings.seed(seededRecord(input, {
          status: 'pending', promptsDelivered: 1, sessionId: 'pty-rival',
        }));
        bindings.beforeWrite = null;
      }
      void record;
    };
    // Queued in advance: a rival session, if this instance wrongly creates one, gets a working receipt,
    // so the failure mode under test is a wrong outcome rather than a hang.
    host.resolveCreate(0);
    const launch = createAttemptSessionAdapter({ host, bindings }).begin(input);
    await expect(launch.receipt).resolves.toMatchObject({ ok: false, refusal: 'binding-conflict' });
    // No second owner: no session, no interleaved prompt, and the winner's session is never closed.
    expect(host.attempts).toHaveLength(0);
    expect(host.writes).toHaveLength(0);
    expect(host.closeCalls).toHaveLength(0);
    expect(bindings.operations.get(`op-${sha256Hex(input.operationKey)}`)).toMatchObject({
      status: 'pending', promptsDelivered: 1, sessionId: 'pty-rival',
    });
  });

  it('refuses and closes a new session when another instance already claimed the durable sessionId', async () => {
    const host = new MemorySessionHost();
    const bindings = new MemoryBindings();
    const input = declaration('codex');
    bindings.seed(seededRecord(input, {
      status: 'pending', promptsDelivered: 0, sessionId: 'pty-claimed-by-the-winner',
    }));
    const launch = createAttemptSessionAdapter({ host, bindings }).begin(input);
    await vi.waitFor(() => expect(host.attempts).toHaveLength(1));
    host.resolveCreate(0);
    await expect(launch.receipt).resolves.toMatchObject({
      ok: false, refusal: 'binding-conflict',
    });
    // A host that did not dedupe by operationKey handed back a different session. The registry refuses
    // it without repointing durable state and closes only the unclaimed newcomer.
    expect(host.attempts[0].sessionId).not.toBe('pty-claimed-by-the-winner');
    expect(bindings.operations.get(`op-${sha256Hex(input.operationKey)}`)).toMatchObject({
      status: 'failed', promptsDelivered: 0, sessionId: 'pty-claimed-by-the-winner',
    });
    expect(host.closeCalls).toEqual([host.attempts[0].sessionId]);
  });

  it('settles an attempt whose host receipt never resolves and releases its transcript', async () => {
    const host = new MemorySessionHost();
    const bindings = new MemoryBindings();
    const input = declaration('codex');
    const adapter = createAttemptSessionAdapter({ host, bindings, timeoutMs: 150 });
    const launch = adapter.begin(input);
    await vi.waitFor(() => expect(host.attempts).toHaveLength(1));
    host.emit(0, codexTranscript('bytes no parse will ever read'));
    expect(adapter.rawTranscript(input.attemptRef)!.byteLength).toBeGreaterThan(0);
    // The host never resolves the start receipt, so only the timer can end this attempt.
    await expect(launch.result).resolves.toMatchObject({ state: 'failed' });
    expect(bindings.operations.get(`op-${sha256Hex(input.operationKey)}`)?.status).toBe('failed');
    expect(adapter.rawTranscript(input.attemptRef)!.byteLength).toBe(0);
  });

  it('strands a reserved-but-unsent prompt and settles the attempt failed at the timer', async () => {
    const host = new MemorySessionHost();
    const bindings = new MemoryBindings();
    const input = declaration('codex');
    // The reservation landed durably and the process died before `host.write`: at-most-once delivery
    // means that prompt is lost for good, and the restart must not re-send it.
    bindings.seed(seededRecord(input, { status: 'pending', promptsDelivered: 1 }));
    const adapter = createAttemptSessionAdapter({ host, bindings, timeoutMs: 150 });
    const launch = adapter.begin(input);
    await vi.waitFor(() => expect(host.attempts).toHaveLength(1));
    host.resolveCreate(0);
    await expect(launch.receipt).resolves.toMatchObject({ ok: true });
    expect(host.writes).toHaveLength(0);
    // The session therefore idles with nothing to do until the timer reaps it.
    await expect(launch.result).resolves.toMatchObject({ state: 'failed' });
    expect(host.closeCalls).toEqual([host.attempts[0].sessionId]);
    expect(bindings.operations.get(`op-${sha256Hex(input.operationKey)}`)).toMatchObject({
      status: 'failed', promptsDelivered: 1,
    });
  });

  it('cancels durably by operationKey without a live attempt and refuses the later begin', async () => {
    const host = new MemorySessionHost();
    const bindings = new MemoryBindings();
    const input = declaration();
    const canceller = createAttemptSessionAdapter({ host, bindings });
    await expect(canceller.cancel({ operationKey: input.operationKey, reason: 'operator stop' }))
      .resolves.toMatchObject({
        ok: true, value: { sessionId: `pty-${'0'.repeat(32)}`, reason: 'abandoned' },
      });
    expect(bindings.operations.get(`op-${sha256Hex(input.operationKey)}`)?.status).toBe('cancelled');

    const later = createAttemptSessionAdapter({ host, bindings }).begin(input);
    await expect(later.receipt).resolves.toMatchObject({ ok: false, refusal: 'cancelled' });
    await expect(later.result).resolves.toMatchObject({ state: 'failed', summary: expect.stringContaining('cancelled') });
    expect(host.attempts).toHaveLength(0);
  });

  it('never resurrects a terminal operation and creates no session for one', async () => {
    for (const [status, refusal] of [['completed', 'binding-conflict'], ['failed', 'internal'], ['cancelled', 'cancelled']] as const) {
      const host = new MemorySessionHost();
      const bindings = new MemoryBindings();
      const input = declaration('codex', { operationKey: `op-${status.charCodeAt(0).toString(16)}${'7'.repeat(62)}` });
      bindings.seed(seededRecord(input, { status, promptsDelivered: 1 }));
      const adapter = createAttemptSessionAdapter({ host, bindings });
      const launch = adapter.begin(input);
      await expect(launch.receipt).resolves.toMatchObject({ ok: false, refusal });
      await expect(launch.result).resolves.toMatchObject({ state: 'failed' });
      expect(host.attempts).toHaveLength(0);
      expect(adapter.isRunLive({ operator: input.subject, runRef: input.runRef })).toBe(false);
      expect(bindings.operations.get(`op-${sha256Hex(input.operationKey)}`)?.status).toBe(status);
    }
  });

  it('reconstructs active-attempt selection on a fresh instance from the durable record and binding row', async () => {
    const host = new MemorySessionHost();
    const bindings = new MemoryBindings();
    const input = declaration();
    const first = createAttemptSessionAdapter({ host, bindings });
    const launch = first.begin(input);
    await vi.waitFor(() => expect(host.attempts).toHaveLength(1));
    host.resolveCreate(0);
    await launch.receipt;
    const writesBefore = host.writes.length;

    const restarted = createAttemptSessionAdapter({ host, bindings });
    expect(restarted.isRunLive({ operator: input.subject, runRef: input.runRef })).toBe(false);
    const replay = restarted.begin(input);
    await expect(replay.receipt).resolves.toMatchObject({ ok: true, value: { replayed: true, sessionId: host.attempts[0].sessionId } });
    expect(host.writes).toHaveLength(writesBefore);
    expect(restarted.isRunLive({ operator: input.subject, runRef: input.runRef })).toBe(true);
    await expect(restarted.queueRunInstruction({
      operator: input.subject, runRef: input.runRef, idempotencyKey: 'reconstructed-1',
      message: 'Continue on the reconstructed session.',
    })).resolves.toBe(true);
    expect(host.writes.at(-1)!.sessionId).toBe(host.attempts[0].sessionId);
    expect(bindings.byAttempt(input.subject, input.attemptRef)).not.toBeNull();

    // Durable binding row missing => the run is not live, whatever this instance's local flags say.
    const orphanBindings = new MemoryBindings();
    orphanBindings.seed(seededRecord(input, { status: 'bound', promptsDelivered: 2, sessionId: 'pty-orphan' }));
    const orphan = createAttemptSessionAdapter({ host: new MemorySessionHost(), bindings: orphanBindings });
    expect(orphan.isRunLive({ operator: input.subject, runRef: input.runRef })).toBe(false);
  });

  it('decodes a multi-byte character split across two frames without corruption', async () => {
    const host = new MemorySessionHost();
    const adapter = createAttemptSessionAdapter({ host, bindings: new MemoryBindings() });
    const input = declaration('codex');
    const launch = adapter.begin(input);
    await vi.waitFor(() => expect(host.attempts).toHaveLength(1));
    host.resolveCreate(0);
    await launch.receipt;
    const transcript = Buffer.from(codexTranscript('cost is 100\u20ac total'), 'utf8');
    const euro = transcript.indexOf(Buffer.from('\u20ac', 'utf8'));
    expect(euro).toBeGreaterThan(0);
    // Split the 3-byte character down the middle across two frames.
    host.emitBytes(0, transcript.subarray(0, euro + 1));
    host.emitBytes(0, transcript.subarray(euro + 1));
    host.finish(0);
    await expect(launch.result).resolves.toMatchObject({ state: 'succeeded', summary: 'cost is 100\u20ac total' });
    expect(Buffer.from(adapter.rawTranscript(input.attemptRef)!).toString('utf8')).toBe(transcript.toString('utf8'));
  });

  it.each(loadWorkflowProfiles())('resolves current workflow profile $id through the Claude policy/settings builders', async (workflow) => {
    const host = new MemorySessionHost();
    const bindings = new MemoryBindings();
    const resolved = vi.fn(() => workflow.id);
    const adapter = createAttemptSessionAdapter({ host, bindings, resolveClaudePolicyId: resolved });
    const input = declaration('claude', {
      operationKey: `op-${workflow.id.charCodeAt(0).toString(16).padStart(2, '0')}${'1'.repeat(62)}`,
      attemptRef: `attempt-${workflow.id}-1`, sessionRef: `session-${workflow.id}-1`, workflowProfile: workflow.id,
    });
    const launch = adapter.begin(input);
    host.resolveCreate(0);
    await launch.receipt;
    expect(resolved).toHaveBeenCalledWith({
      workflowProfile: workflow.id,
      policy: { allowedTools: workflow.allowedTools, permissionMode: 'default' },
      settings: workflow.allowedTools.includes('Bash') ? undefined : expect.any(String),
    });
    const transcript = claudeTranscript(`${workflow.id} ok`);
    host.emit(0, transcript);
    host.finish(0);
    await expect(launch.result).resolves.toMatchObject({ state: 'succeeded', summary: `${workflow.id} ok` });
  });

  /**
   * D4. The Codex branch used to fall back to `input.profile.id` when an attempt declared no workflow
   * profile, and a real execution-profile id is `worker:codex:gpt-5.6-terra` — colons, which the
   * broker's `policyPattern` refuses. That fallback could never produce a launchable recipe; it only
   * converted "no tool cap was approved" into a frame the broker rejects, which tears the socket down
   * instead of failing one launch. Both runtimes now refuse it here, by name.
   */
  it.each(['claude', 'codex'] as const)('refuses a %s attempt that declares no workflow profile', async (runtime) => {
    const host = new MemorySessionHost();
    const adapter = createAttemptSessionAdapter({ host, bindings: new MemoryBindings() });
    const launch = adapter.begin(declaration(runtime, {
      workflowProfile: null,
      // The real shape of a control-plane execution-profile id, i.e. the value the old fallback used.
      profile: { ...(runtime === 'claude' ? CLAUDE_PROFILE : CODEX_PROFILE), id: `worker:${runtime}:model-1` },
    } as Partial<ApprovedAttemptDeclaration>));
    const receipt = await launch.receipt;
    expect(receipt.ok).toBe(false);
    expect(receipt).toMatchObject({ refusal: 'invalid-request' });
    expect((await launch.result).state).toBe('failed');
    // Nothing reached the host, so no colon-bearing toolPolicyId was ever put on the wire.
    expect(host.attempts).toHaveLength(0);
  });

  /**
   * The codex branch used to SHAPE-CHECK `workflowProfile` against `TOOL_POLICY_ID_RE` and stop there,
   * while the claude branch resolved it through `createWorkflowToolPolicyResolver`. `research-v2` is
   * spellable on the wire and names nothing server-owned, so it passed the sender, reached the broker,
   * and came back as a generic `unknown Codex tool policy` — a wasted round trip and a rejected frame
   * for a fact the sender already had. Both runtimes now refuse a non-server-owned id here, by name.
   */
  it.each(['claude', 'codex'] as const)(
    'refuses a %s attempt naming a syntactically valid but non-server-owned workflow profile',
    async (runtime) => {
      const host = new MemorySessionHost();
      const adapter = createAttemptSessionAdapter({ host, bindings: new MemoryBindings() });
      // Passes `TOOL_POLICY_ID_RE` (/^[a-z][a-z0-9-]{0,63}$/) and is in no profile table.
      expect('research-v2').toMatch(/^[a-z][a-z0-9-]{0,63}$/);
      const launch = adapter.begin(declaration(runtime, { workflowProfile: 'research-v2' }));
      const receipt = await launch.receipt;
      expect(receipt.ok).toBe(false);
      expect(receipt).toMatchObject({ refusal: 'invalid-request' });
      expect((await launch.result).state).toBe('failed');
      // Nothing reached the host, so the broker never spent a frame refusing what the sender knew.
      expect(host.attempts).toHaveLength(0);
    },
  );

  it('never emits a toolPolicyId the broker policy pattern would refuse', async () => {
    for (const runtime of ['claude', 'codex'] as const) {
      const host = new MemorySessionHost();
      const adapter = createAttemptSessionAdapter({ host, bindings: new MemoryBindings() });
      adapter.begin(declaration(runtime, { workflowProfile: 'checker-readonly' }));
      host.resolveCreate(0);
      await new Promise((resolve) => { setTimeout(resolve, 0); });
      const { toolPolicyId } = host.attempts[0].request.recipe;
      expect(toolPolicyId).toBe('checker-readonly');
      expect(toolPolicyId).not.toContain(':');
      expect(toolPolicyId).toMatch(/^[a-z][a-z0-9-]{0,63}$/);
    }
  });

  it('resumes Claude by the exact prior session and records the emitted continuation without replaying its declaration', async () => {
    const host = new MemorySessionHost();
    const input = declaration();
    const recorded = vi.fn();
    const adapter = createAttemptSessionAdapter({
      host,
      bindings: new MemoryBindings(),
      resolveResumeRef: (runtime, runRef, agentId) => {
        expect([runtime, runRef, agentId]).toEqual(['claude', input.runRef, input.assignment!.agentId]);
        return 'claude-session-prior';
      },
      recordResumeRef: recorded,
    });
    const launch = adapter.begin(input);
    host.resolveCreate(0);
    await launch.receipt;
    expect(host.attempts[0].request.recipe).toMatchObject({
      launcher: 'claude', resumeRef: 'claude-session-prior', sandbox: 'claude-policy',
    });
    expect(host.writes).toHaveLength(1);
    expect(Buffer.from(host.writes[0].bytes).toString('utf8')).not.toContain('SERVER-VERIFIED AGENT DECLARATION');
    host.emit(0, claudeLine('resumed', 'claude-session-next'));
    await expect(launch.result).resolves.toMatchObject({ state: 'succeeded', summary: 'resumed' });
    expect(recorded).toHaveBeenCalledWith('claude', input.runRef, input.assignment!.agentId, 'claude-session-next');
  });

  it('includes every declaration field in exact-operation identity and enforces the iteration outcome fence', async () => {
    const complete = declaration('claude', { iterationContract: ITERATION_CONTRACT, expectsIterationOutcome: true });
    const mutations: Array<[string, (value: ApprovedAttemptDeclaration) => ApprovedAttemptDeclaration]> = [
      ['subject', (value) => ({ ...value, subject: `${value.subject}-changed` })],
      ['runRef', (value) => ({ ...value, runRef: `${value.runRef}-changed` })],
      ['stageRef', (value) => ({ ...value, stageRef: `${value.stageRef}-changed` })],
      ['attemptRef', (value) => ({ ...value, attemptRef: `${value.attemptRef}-changed` })],
      ['sessionRef', (value) => ({ ...value, sessionRef: `${value.sessionRef}-changed` })],
      ['rootId/cwd', (value) => ({ ...value, relativeCwd: `${value.relativeCwd}/changed` })],
      ['cols/rows', (value) => ({ ...value, cols: value.cols + 1, rows: value.rows + 1 })],
      ['profile', (value) => ({ ...value, profile: { ...value.profile, capabilities: [...value.profile.capabilities, 'run-approved-commands'] } })],
      ['workflowProfile', (value) => ({ ...value, workflowProfile: 'scanner' })],
      ['skills', (value) => ({ ...value, skills: [...value.skills, 'humanizer'] })],
      ['action', (value) => ({ ...value, action: `${value.action}:changed` })],
      ['target', (value) => ({ ...value, target: `${value.target}/changed` })],
      ['workOrder', (value) => ({ ...value, workOrder: `${value.workOrder} Changed.` })],
      ['readScope', (value) => ({ ...value, readScope: [...value.readScope, 'docs'] })],
      ['writeScope', (value) => ({ ...value, writeScope: [...value.writeScope, 'dashboard/shared'] })],
      ['checkpoints', (value) => ({ ...value, checkpoints: [...value.checkpoints, 'reviewed'] })],
      ['iterationContract', (value) => ({ ...value, iterationContract: { ...value.iterationContract!, request: { ...value.iterationContract!.request, instructions: 'Changed request.' } } }) as ApprovedAttemptDeclaration],
      ['outcome fence', (value) => ({ ...value, expectsIterationOutcome: false }) as ApprovedAttemptDeclaration],
      ['assignment', (value) => ({ ...value, assignment: { ...value.assignment!, declarationHash: 'd'.repeat(64) } }) as ApprovedAttemptDeclaration],
      ['declaration', (value) => ({ ...value, instructionMarkdown: `${value.instructionMarkdown}\nChanged.` }) as ApprovedAttemptDeclaration],
      ['proposal stage', (value) => ({ ...value, proposalStage: { ...value.proposalStage, title: 'Changed stage' } })],
      ['project', (value) => ({ ...value, project: `${value.project}-changed` })],
    ];
    for (const [field, mutate] of mutations) {
      expect(attemptDeclarationFingerprint(mutate(complete)), field).not.toBe(attemptDeclarationFingerprint(complete));
    }

    const host = new MemorySessionHost();
    const adapter = createAttemptSessionAdapter({ host, bindings: new MemoryBindings() });
    await expect(adapter.begin(declaration('claude', { expectsIterationOutcome: true })).receipt)
      .resolves.toMatchObject({ ok: false, refusal: 'invalid-request', detail: expect.stringContaining('outcome fence') });
    const launch = adapter.begin(complete);
    await vi.waitFor(() => expect(host.attempts).toHaveLength(1));
    host.resolveCreate(0);
    await launch.receipt;
    expect(Buffer.from(host.writes[1].bytes).toString('utf8')).toContain('SERVER-OWNED ITERATION CONTRACT');
    const outcome = {
      schema: 'kb.iteration-outcome/v1', requestRef: 'request-1', iterationLoopRef: 'loop-1', participantId: 'reviewer',
      cycle: 1, verdict: 'pass', inputGenerationRefs: ['generation-1'],
      criteria: [{ criterionId: 'correct', verdict: 'pass', findingIds: [] }], findings: [], positions: [], recordedDissent: [],
      summary: 'Review passed.',
    };
    host.emit(0, claudeLine('declaration accepted') + claudeLine(JSON.stringify(outcome)));
    host.finish(0);
    await expect(launch.result).resolves.toMatchObject({ state: 'succeeded', summary: 'Review passed.', iterationOutcome: outcome });
  });

  it.each([
    'recipe', 'command', 'executable', 'args', 'argv', 'env', 'uid', 'user', 'host', 'token', 'cwd', 'resumeRef',
  ].flatMap((field) => [
    [`top-level ${field}`, field, false] as const,
    [`nested ${field}`, field, true] as const,
  ]))('returns invalid-request for raw authority at %s', async (_label, field, nested) => {
    const host = new MemorySessionHost();
    const bindings = new MemoryBindings();
    const adapter = createAttemptSessionAdapter({ host, bindings });
    const input = nested
      ? { ...declaration(), proposalStage: { ...STAGE, [field]: field === 'argv' ? ['--danger'] : 'danger' } }
      : { ...declaration(), [field]: field === 'argv' ? ['--danger'] : 'danger' };
    const launch = adapter.begin(input as ApprovedAttemptDeclaration);
    await expect(launch.receipt).resolves.toMatchObject({ ok: false, refusal: 'invalid-request' });
    await expect(launch.result).resolves.toMatchObject({ state: 'failed', summary: expect.stringContaining('invalid-request') });
    expect(host.attempts).toHaveLength(0);
    expect(bindings.operations.size).toBe(0);
  });

  it('barriers create refusal, atomic-start failure, cancel-before-create, and exit-before-receipt without a live projection', async () => {
    const input = declaration();

    // Cancel before the session is created: the tombstone lands first and NO session is ever created.
    const cancelHost = new MemorySessionHost();
    const cancelBindings = new MemoryBindings();
    const cancelAdapter = createAttemptSessionAdapter({ host: cancelHost, bindings: cancelBindings });
    const cancelled = cancelAdapter.begin(input);
    const cancelResult = cancelAdapter.cancel({ operationKey: input.operationKey, reason: 'operator stop' });
    expect(cancelAdapter.isRunLive({ operator: input.subject, runRef: input.runRef })).toBe(false);
    await expect(cancelResult).resolves.toMatchObject({
      ok: true, value: { sessionId: `pty-${'0'.repeat(32)}`, reason: 'abandoned' },
    });
    await expect(cancelled.receipt).resolves.toMatchObject({ ok: false, refusal: 'cancelled' });
    await expect(cancelled.result).resolves.toMatchObject({ state: 'failed', summary: expect.stringContaining('cancelled') });
    expect(cancelHost.attempts).toHaveLength(0);
    expect(cancelHost.closeCalls).toHaveLength(0);
    expect(cancelBindings.operations.get(`op-${sha256Hex(input.operationKey)}`)?.status).toBe('cancelled');

    // The host refuses at create: the durable record settles `failed` and no session leaks.
    const refuseHost = new MemorySessionHost();
    const refuseBindings = new MemoryBindings();
    const refused = createAttemptSessionAdapter({ host: refuseHost, bindings: refuseBindings }).begin(input);
    refuseHost.refuseCreate(0, { ok: false, refusal: 'launcher-unavailable', detail: 'claude missing' });
    await expect(refused.receipt).resolves.toEqual({ ok: false, refusal: 'launcher-unavailable', detail: 'claude missing' });
    expect(refuseHost.closeCalls).toHaveLength(0);
    expect(refuseBindings.operations.get(`op-${sha256Hex(input.operationKey)}`)).toMatchObject({
      status: 'failed', receipt: { refusal: 'launcher-unavailable' },
    });

    const bindHost = new MemorySessionHost();
    const bindings = new MemoryBindings();
    bindings.nextRefusal = { ok: false, refusal: 'binding-conflict', detail: 'attempt already bound' };
    const bindAdapter = createAttemptSessionAdapter({ host: bindHost, bindings });
    const bindFailed = bindAdapter.begin(input);
    bindHost.resolveCreate(0);
    await expect(bindFailed.receipt).resolves.toEqual({ ok: false, refusal: 'binding-conflict', detail: 'attempt already bound' });
    await expect(bindFailed.result).resolves.toMatchObject({ state: 'failed', summary: expect.stringContaining('binding-conflict') });
    expect(bindAdapter.isRunLive({ operator: input.subject, runRef: input.runRef })).toBe(false);
    expect(bindHost.closeCalls).toEqual([bindHost.attempts[0].sessionId]);
    expect(bindings.operations.get(`op-${sha256Hex(input.operationKey)}`)?.status).toBe('failed');

    const earlyHost = new MemorySessionHost();
    const earlyBindings = new MemoryBindings();
    const earlyAdapter = createAttemptSessionAdapter({ host: earlyHost, bindings: earlyBindings });
    const early = earlyAdapter.begin(input);
    await vi.waitFor(() => expect(earlyHost.attempts).toHaveLength(1));
    earlyHost.emit(0, claudeTranscript('exited early'));
    earlyHost.finish(0);
    earlyHost.resolveCreate(0);
    let resultSettled = false;
    void early.result.then(() => { resultSettled = true; });
    expect(earlyBindings.calls).toHaveLength(0);
    await expect(early.receipt).resolves.toMatchObject({ ok: false, refusal: 'internal' });
    await expect(early.result).resolves.toMatchObject({ state: 'failed', summary: expect.stringContaining('internal') });
    expect(resultSettled).toBe(true);
    expect(earlyHost.writes).toHaveLength(0);
    expect(earlyBindings.operations.get(`op-${sha256Hex(input.operationKey)}`)?.status).toBe('failed');
  });

  it('persists cancellation through atomic start and refuses cancellation replay after restart', async () => {
    const input = declaration();
    const host = new MemorySessionHost();
    const bindings = new MemoryBindings();
    bindings.gate = deferred<void>();
    const adapter = createAttemptSessionAdapter({ host, bindings });
    const launch = adapter.begin(input);
    await vi.waitFor(() => expect(host.attempts).toHaveLength(1));
    host.resolveCreate(0);
    await vi.waitFor(() => expect(bindings.calls).toHaveLength(1));
    const cancellation = adapter.cancel({ operationKey: input.operationKey, reason: 'operator stop' });
    await vi.waitFor(() => expect(
      bindings.operations.get(`op-${sha256Hex(input.operationKey)}`)?.status,
    ).toBe('cancelled'));
    bindings.gate!.resolve();
    await expect(cancellation).resolves.toMatchObject({ ok: true, value: { reason: 'closed' } });
    await expect(launch.receipt).resolves.toMatchObject({ ok: false, refusal: 'cancelled' });
    await expect(launch.result).resolves.toMatchObject({ state: 'failed', summary: expect.stringContaining('cancelled') });
    expect(host.closeCalls).toEqual([host.attempts[0].sessionId]);
    expect(host.writes).toHaveLength(0);

    const attemptsBeforeRestart = host.attempts.length;
    const replay = createAttemptSessionAdapter({ host, bindings }).begin(input);
    await expect(replay.receipt).resolves.toMatchObject({ ok: false, refusal: 'cancelled' });
    await expect(replay.result).resolves.toMatchObject({ state: 'failed', summary: expect.stringContaining('cancelled') });
    expect(host.attempts).toHaveLength(attemptsBeforeRestart);
  });

  it.each([
    ['workOrder', (input: ApprovedAttemptDeclaration) => ({ ...input, workOrder: `${input.workOrder} changed` })],
    ['read scope', (input: ApprovedAttemptDeclaration) => ({ ...input, readScope: [...input.readScope, 'docs'] })],
  ] as const)('rejects a restarted operation with changed %s by durable sha256 fingerprint', async (_field, mutate) => {
    const host = new MemorySessionHost();
    const bindings = new MemoryBindings();
    const input = declaration();
    const first = createAttemptSessionAdapter({ host, bindings }).begin(input);
    await vi.waitFor(() => expect(host.attempts).toHaveLength(1));
    host.resolveCreate(0);
    await first.receipt;
    const attemptsBeforeRestart = host.attempts.length;
    const conflict = createAttemptSessionAdapter({ host, bindings }).begin(mutate(input));
    await expect(conflict.receipt).resolves.toMatchObject({ ok: false, refusal: 'binding-conflict' });
    expect(bindings.operations.get(`op-${sha256Hex(input.operationKey)}`)?.requestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(host.attempts).toHaveLength(attemptsBeforeRestart);
  });

  it.each([
    ['stageRef', (input: ApprovedAttemptDeclaration) => ({ ...input, stageRef: `${input.stageRef}-changed` })],
    ['skills', (input: ApprovedAttemptDeclaration) => ({ ...input, skills: [...input.skills, 'humanizer'] })],
    ['action', (input: ApprovedAttemptDeclaration) => ({ ...input, action: `${input.action}:changed` })],
    ['target', (input: ApprovedAttemptDeclaration) => ({ ...input, target: `${input.target}/changed` })],
    ['checkpoints', (input: ApprovedAttemptDeclaration) => ({ ...input, checkpoints: [...input.checkpoints, 'reviewed'] })],
    ['project', (input: ApprovedAttemptDeclaration) => ({ ...input, project: `${input.project}-changed` })],
    ['profile role', (input: ApprovedAttemptDeclaration) => ({ ...input, profile: { ...input.profile, role: input.profile.role === 'worker' ? 'manager' : 'worker' } }) as ApprovedAttemptDeclaration],
    ['profile capabilities', (input: ApprovedAttemptDeclaration) => ({ ...input, profile: { ...input.profile, capabilities: [...input.profile.capabilities, 'extra-capability'] } }) as ApprovedAttemptDeclaration],
    ['assignment path', (input: ApprovedAttemptDeclaration) => ({ ...input, assignment: { ...input.assignment!, declarationPath: '.agents/changed.md' } }) as ApprovedAttemptDeclaration],
    ['assignment hash', (input: ApprovedAttemptDeclaration) => ({ ...input, assignment: { ...input.assignment!, declarationHash: 'e'.repeat(64) } }) as ApprovedAttemptDeclaration],
    ['proposalStage', (input: ApprovedAttemptDeclaration) => ({ ...input, proposalStage: { ...input.proposalStage, title: 'Changed title' } })],
  ] as const)('durably fingerprints semantically ignored field %s', async (_field, mutate) => {
    const host = new MemorySessionHost();
    const bindings = new MemoryBindings();
    const input = declaration();
    const first = createAttemptSessionAdapter({ host, bindings }).begin(input);
    await vi.waitFor(() => expect(host.attempts).toHaveLength(1));
    host.resolveCreate(0);
    await first.receipt;
    const replay = createAttemptSessionAdapter({ host, bindings }).begin(mutate(input));
    await expect(replay.receipt).resolves.toMatchObject({ ok: false, refusal: 'binding-conflict' });
    expect(host.attempts).toHaveLength(1);
  });

  it('maps rejected atomic start, prompt write, and post-start close promises to internal failures', async () => {
    const bindHost = new MemorySessionHost();
    const bindBindings = new MemoryBindings();
    bindBindings.rejectStartBinding = true;
    const bind = createAttemptSessionAdapter({ host: bindHost, bindings: bindBindings }).begin(declaration());
    await vi.waitFor(() => expect(bindHost.attempts).toHaveLength(1));
    bindHost.resolveCreate(0);
    await expect(bind.receipt).resolves.toMatchObject({ ok: false, refusal: 'internal' });
    await expect(bind.result).resolves.toMatchObject({ state: 'failed', summary: expect.stringContaining('internal') });
    expect(bindHost.closeCalls).toHaveLength(1);

    const writeHost = new MemorySessionHost();
    writeHost.rejectedWrites.add(0);
    const writeBindings = new MemoryBindings();
    const write = createAttemptSessionAdapter({ host: writeHost, bindings: writeBindings }).begin(declaration());
    await vi.waitFor(() => expect(writeHost.attempts).toHaveLength(1));
    writeHost.resolveCreate(0);
    await expect(write.receipt).resolves.toMatchObject({ ok: false, refusal: 'internal' });
    await expect(write.result).resolves.toMatchObject({ state: 'failed', summary: expect.stringContaining('internal') });
    expect(writeHost.closeCalls).toHaveLength(1);
    expect(writeBindings.operations.get(`op-${sha256Hex(declaration().operationKey)}`)?.status).toBe('failed');

    const closeHost = new MemorySessionHost();
    closeHost.rejectClose = true;
    const closeBindings = new MemoryBindings();
    closeBindings.nextRefusal = { ok: false, refusal: 'binding-conflict', detail: 'binding differs' };
    const close = createAttemptSessionAdapter({ host: closeHost, bindings: closeBindings }).begin(declaration());
    await vi.waitFor(() => expect(closeHost.attempts).toHaveLength(1));
    closeHost.resolveCreate(0);
    await expect(close.receipt).resolves.toMatchObject({ ok: false, refusal: 'internal' });
    await expect(close.result).resolves.toMatchObject({ state: 'failed', summary: expect.stringContaining('internal') });

    const rejectStore = new MemorySessionHost();
    const rejectBindings = new MemoryBindings();
    rejectBindings.rejectOperationWrite = true;
    const rejected = createAttemptSessionAdapter({ host: rejectStore, bindings: rejectBindings }).begin(declaration());
    await expect(rejected.receipt).resolves.toMatchObject({ ok: false, refusal: 'internal' });
    expect(rejectStore.attempts).toHaveLength(0);
  });

  it.each(['throws', 'refuses'] as const)('records a terminal closed exit when the host %s during close', async (failure) => {
    const host = new MemorySessionHost();
    host.rejectClose = failure === 'throws';
    host.refuseClose = failure === 'refuses';
    const mixed = mixedOperationBindings(host);
    const input = declaration();
    const adapter = createAttemptSessionAdapter({
      host, bindings: mixed.bindings, sessionRecords: mixed.sessionRecords,
    });
    const launch = adapter.begin(input);
    await vi.waitFor(() => expect(host.attempts).toHaveLength(1));
    host.resolveCreate(0);
    await expect(launch.receipt).resolves.toMatchObject({ ok: true });

    await expect(adapter.cancel({ operationKey: input.operationKey, reason: 'operator stop' }))
      .resolves.toMatchObject({ ok: false, refusal: 'internal' });
    await expect(launch.result).resolves.toMatchObject({ state: 'failed' });
    expect(mixed.readDocument().sessions).toEqual([
      expect.objectContaining({
        sessionId: host.attempts[0].sessionId,
        state: 'exited',
        exit: expect.objectContaining({ exitCode: null, reason: 'closed' }),
      }),
    ]);
  });

  it('refuses exit between Claude prompts and isolates recorder.closed exceptions', async () => {
    const host = new MemorySessionHost();
    host.finishAfterWrite = 0;
    const bindings = new MemoryBindings();
    const adapter = createAttemptSessionAdapter({
      host, bindings,
      recorder: { data() {}, exit() {}, closed() { throw new Error('observer failed'); } },
    });
    const input = declaration();
    const launch = adapter.begin(input);
    await vi.waitFor(() => expect(host.attempts).toHaveLength(1));
    expect(() => host.attempts[0].sink.closed()).not.toThrow();
    host.resolveCreate(0);
    await expect(launch.receipt).resolves.toMatchObject({ ok: false, refusal: 'internal' });
    await expect(launch.result).resolves.toMatchObject({ state: 'failed' });
    expect(host.writes).toHaveLength(1);
    // The exited operation is durably terminal, so it is never resumed and prompt 0 is never re-sent.
    expect(bindings.operations.get(`op-${sha256Hex(input.operationKey)}`)).toMatchObject({
      status: 'failed', promptsDelivered: 1,
    });
  });

  it('shares exact duplicates, conflicts changed operation requests, and never re-runs a completed operation', async () => {
    const host = new MemorySessionHost();
    const bindings = new MemoryBindings();
    const input = declaration();
    const firstAdapter = createAttemptSessionAdapter({ host, bindings });
    const first = firstAdapter.begin(input);
    expect(firstAdapter.begin({ ...input })).toBe(first);
    const changed = firstAdapter.begin({ ...input, workOrder: 'Different authority.' });
    await expect(changed.receipt).resolves.toMatchObject({ ok: false, refusal: 'binding-conflict' });
    await vi.waitFor(() => expect(host.attempts).toHaveLength(1));
    host.resolveCreate(0);
    await first.receipt;
    host.emit(0, claudeTranscript('first result'));
    host.finish(0);
    await first.result;
    const writeCount = host.writes.length;
    expect(bindings.operations.get(`op-${sha256Hex(input.operationKey)}`)?.status).toBe('completed');

    const restarted = createAttemptSessionAdapter({ host, bindings });
    const replay = restarted.begin(input);
    await expect(replay.receipt).resolves.toMatchObject({ ok: false, refusal: 'binding-conflict' });
    await expect(replay.result).resolves.toMatchObject({ state: 'failed' });
    expect(host.attempts).toHaveLength(1);
    expect(host.writes).toHaveLength(writeCount);
    expect(bindings.rows).toHaveLength(1);
  });

  it('evicts consumed terminal attempts, releases their transcripts, and bounds retained bytes by one output cap', async () => {
    const host = new MemorySessionHost();
    const bindings = new MemoryBindings();
    const adapter = createAttemptSessionAdapter({ host, bindings, maxOutputBytes: 16 });
    const refs: string[] = [];
    for (let index = 0; index < 33; index += 1) {
      const input = declaration('codex', {
        operationKey: `op-${index.toString(16).padStart(64, '0')}`,
        attemptRef: `attempt-terminal-${index}`,
        sessionRef: `session-terminal-${index}`,
      });
      refs.push(input.attemptRef);
      const launch = adapter.begin(input);
      await vi.waitFor(() => expect(host.attempts).toHaveLength(index + 1));
      host.resolveCreate(index);
      await launch.receipt;
      host.emit(index, codexTranscript(`result-${index}`));
      host.finish(index);
      await launch.result;
    }
    // Every retained transcript is capped at `maxOutputBytes`, and the retained SET is capped by the same
    // budget — so only the newest terminal attempt survives here, and the evicted arrays are released.
    const retained = refs.filter((ref) => adapter.rawTranscript(ref) !== null);
    expect(retained).toEqual([refs.at(-1)]);
    expect(adapter.rawTranscript(refs.at(-1)!)!.byteLength).toBeLessThanOrEqual(16);
    expect(bindings.rows).toHaveLength(33);

    const cappedHost = new MemorySessionHost();
    const capped = createAttemptSessionAdapter({ host: cappedHost, bindings: new MemoryBindings(), maxOutputBytes: 8 });
    const cappedInput = declaration('codex', {
      operationKey: `op-f${'9'.repeat(63)}`, attemptRef: 'attempt-capped', sessionRef: 'session-capped',
    });
    const launch = capped.begin(cappedInput);
    await vi.waitFor(() => expect(cappedHost.attempts).toHaveLength(1));
    cappedHost.resolveCreate(0);
    await launch.receipt;
    cappedHost.emit(0, 'more than eight bytes');
    await expect(launch.result).resolves.toMatchObject({ state: 'failed', summary: expect.stringContaining('8-byte cap') });
    expect(capped.rawTranscript(cappedInput.attemptRef)!.byteLength).toBeLessThanOrEqual(8);
  });

  it('awaits idempotent instructions on the newest active attempt, cancels it, and drains the epoch', async () => {
    const host = new MemorySessionHost();
    const adapter = createAttemptSessionAdapter({ host, bindings: new MemoryBindings() });
    const firstInput = declaration();
    const secondInput = declaration('claude', {
      operationKey: `op-d${'4'.repeat(63)}`, attemptRef: 'attempt-newest', sessionRef: 'session-newest',
    });
    const first = adapter.begin(firstInput);
    const second = adapter.begin(secondInput);
    await vi.waitFor(() => expect(host.attempts).toHaveLength(2));
    host.resolveCreate(0);
    host.resolveCreate(1);
    await Promise.all([first.receipt, second.receipt]);
    expect(adapter.isRunLive({ operator: firstInput.subject, runRef: firstInput.runRef })).toBe(true);
    const before = host.writes.length;
    const instruction = { operator: firstInput.subject, runRef: firstInput.runRef, idempotencyKey: 'instruction-1', message: 'Inspect the smaller diff.' };
    await expect(adapter.queueRunInstruction(instruction)).resolves.toBe(true);
    await expect(adapter.queueRunInstruction(instruction)).resolves.toBe(true);
    await expect(adapter.queueRunInstruction({ ...instruction, message: 'Changed message.' })).resolves.toBe(false);
    await expect(adapter.queueRunInstructionAtCheckpoint({ ...instruction, idempotencyKey: 'checkpoint-1', checkpoint: 'tests-green' })).resolves.toBe(true);
    expect(host.writes).toHaveLength(before + 2);
    expect(host.writes.slice(-2).every((write) => write.sessionId === host.attempts[1].sessionId)).toBe(true);
    expect(Buffer.from(host.writes.at(-1)!.bytes).toString('utf8')).toContain("checkpoint 'tests-green'");

    const cancel = adapter.cancel({ operationKey: secondInput.operationKey, reason: 'superseded' });
    await expect(cancel).resolves.toMatchObject({ ok: true, value: { sessionId: host.attempts[1].sessionId } });
    expect(adapter.isRunLive({ operator: firstInput.subject, runRef: firstInput.runRef })).toBe(true);
    await adapter.drain();
    expect(host.listEpochCalls).toBe(1);
    expect(host.drainCalls).toEqual(['epoch-11111111111111111111111111111111']);
    const refused = adapter.begin({ ...firstInput, operationKey: `op-e${'5'.repeat(63)}`, attemptRef: 'attempt-after-drain' });
    await expect(refused.receipt).resolves.toMatchObject({ ok: false, refusal: 'unavailable' });
  });

  /**
   * B1 regression. The durable per-attempt IO log has exactly one writer, and it is this port: the
   * `attempt-io` route and the hub signal both read the other side of the SAME store, so a port that
   * does not tap it leaves three operator surfaces permanently empty with no error anywhere.
   */
  it('taps every data frame into the durable attempt IO log the attempt-io route reads', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kb-attempt-io-'));
    const attemptIo = createAttemptIoStore({ root, flushMs: 0 });
    const appended: string[] = [];
    const off = attemptIo.onAppend((event) => appended.push(`${event.entry.dir}:${event.entry.line}`));
    try {
      const host = new MemorySessionHost();
      const input = declaration();
      const adapter = createAttemptSessionAdapter({ host, bindings: new MemoryBindings(), attemptIo });
      const launch = adapter.begin(input);
      host.resolveCreate(0);
      await expect(launch.receipt).resolves.toMatchObject({ ok: true });
      host.emit(0, 'first line\n');
      host.emit(0, 'second line\n');

      // Exactly what the route serves: `attemptIo.read(attemptRef)`.
      const entries = attemptIo.read(input.attemptRef);
      expect(entries.map((entry) => entry.line)).toEqual(['first line\n', 'second line\n']);
      expect(entries.every((entry) => entry.dir === 'out')).toBe(true);
      expect(appended).toEqual(['out:first line\n', 'out:second line\n']);
    } finally {
      off();
      attemptIo.stop();
      rmSync(root, { recursive: true, force: true });
    }
  });

  /**
   * B2 regression. `agentMessages.deliver` answers `queued` only because THIS drain exists: the queued
   * text must reach the next attempt's own prompt, in chain order, and the chain must be empty after.
   */
  it('drains queued operator messages into the next attempt\u2019s first prompt, in order', async () => {
    const host = new MemorySessionHost();
    const chain = new Map<string, string[]>([['run:reviewer-agent', ['first queued', 'second queued']]]);
    const drainCalls: Array<[string, string]> = [];
    const input = declaration();
    const adapter = createAttemptSessionAdapter({
      host,
      bindings: new MemoryBindings(),
      drainMessages: async (runRef, agentId) => {
        drainCalls.push([runRef, agentId]);
        const drained = chain.get('run:reviewer-agent') ?? [];
        chain.delete('run:reviewer-agent');
        return drained;
      },
    });

    const launch = adapter.begin(input);
    host.resolveCreate(0);
    await expect(launch.receipt).resolves.toMatchObject({ ok: true });

    expect(drainCalls).toEqual([[input.runRef, 'reviewer-agent']]);
    const prompts = host.writes.map((write) => Buffer.from(write.bytes).toString('utf8'));
    const workOrderPrompt = prompts.at(-1)!;
    expect(workOrderPrompt).toContain('first queued');
    expect(workOrderPrompt).toContain('second queued');
    expect(workOrderPrompt.indexOf('first queued')).toBeLessThan(workOrderPrompt.indexOf('second queued'));
    // Inert data, ahead of the authoritative work order — never instructions.
    expect(workOrderPrompt.indexOf('second queued'))
      .toBeLessThan(workOrderPrompt.indexOf('Implement the approved attempt adapter.'));
    expect(chain.size).toBe(0);
  });

  /**
   * [C-S4] pre-receipt. The worktree-path validator runs BEFORE any durable record or host session, so
   * an unsafe cwd can never produce a receipt or a session the registry would have to close.
   */
  it('refuses an unsafe attempt worktree cwd before any receipt or host session exists', async () => {
    for (const relativeCwd of ['../escape', '/etc', 'C:/kb', 'orgs/example/con', 'orgs/../../escape']) {
      const host = new MemorySessionHost();
      const adapter = createAttemptSessionAdapter({ host, bindings: new MemoryBindings() });
      const launch = adapter.begin(declaration('claude', { relativeCwd }));
      await expect(launch.receipt).resolves.toMatchObject({
        ok: false, refusal: 'invalid-request',
        detail: 'attempt worktree cwd is not a safe server-owned relative path',
      });
      expect((await launch.result).state).toBe('failed');
      expect(host.attempts).toHaveLength(0);
    }
  });

  /** The host request carries a recipe NAME and no env: nothing on this path can leak a credential. */
  it('hands the host a request with no env and no credential-named material', async () => {
    const host = new MemorySessionHost();
    const adapter = createAttemptSessionAdapter({ host, bindings: new MemoryBindings() });
    adapter.begin(declaration());
    host.resolveCreate(0);
    await new Promise((resolve) => { setTimeout(resolve, 0); });

    const serialized = JSON.stringify(host.attempts[0].request);
    for (const name of ['ANTHROPIC_API_KEY', 'GITHUB_TOKEN', 'AWS_SECRET_ACCESS_KEY', 'PASSWORD', 'CREDENTIAL']) {
      expect(serialized.toUpperCase()).not.toContain(name);
    }
    expect(Object.keys(host.attempts[0].request)).not.toContain('env');
    expect(Object.keys(host.attempts[0].request.recipe).sort())
      .toEqual(['launcher', 'mode', 'model', 'sandbox', 'toolPolicyId']);
  });
});
