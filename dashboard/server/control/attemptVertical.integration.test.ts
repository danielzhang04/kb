import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import type {
  ApprovedAttemptDeclaration,
  AttemptOperationRecord,
  HostStartReceipt,
  ObservedExit,
  PortResult,
  PtyCapabilityProbe,
  SessionHost,
  SessionHostRequest,
  SessionSink,
  SessionSize,
  StartRunSessionInput,
} from '../pty/contracts.ts';
import { createSessionRecordRegistry } from '../pty/sessionRecord.ts';
import {
  assertPtySessionsDocumentV3,
  createEmptyPtySessionsDocument,
  createTranscriptRetention,
  enforcePtySessionRetention,
  MAX_RETAINED_SESSIONS,
  type SessionPersistence,
} from '../pty/sessionPersistence.ts';
import { createRawSessionReplaySource } from '../pty/replayReader.ts';
import { sha256Hex } from '../shared/hashing.ts';
import type { ExecutionProfile } from './policy.ts';
import type { ProposalStage, ResolvedAgentAssignment } from './proposal.ts';
import { createAttemptSessionAdapter } from './attemptSessionAdapter.ts';
import { projectAttemptSessions } from './runProjection.ts';

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  return { promise: new Promise<T>((accept) => { resolve = accept; }), resolve };
}

function validatedMemoryPersistence(events: string[]): {
  persistence: SessionPersistence;
  readDocument: SessionPersistence['read'];
} {
  let document = createEmptyPtySessionsDocument();
  assertPtySessionsDocumentV3(document);
  const persistence: SessionPersistence = {
    read: () => structuredClone(document),
    mutate: async (expectedRevision, callback) => {
      if (expectedRevision !== null && document.revision !== expectedRevision) {
        throw Object.assign(new Error('PTY document revision conflict'), { code: 'revision-conflict' });
      }
      const draft = structuredClone(document);
      const value = await callback(draft);
      draft.revision += 1;
      assertPtySessionsDocumentV3(draft);
      events.push(`document:${draft.revision}`);
      document = draft;
      return { revision: draft.revision, value };
    },
  };
  return { persistence, readDocument: persistence.read };
}

class LinuxShapedSessionHost implements SessionHost {
  readonly sessionId: string;
  readonly epochId: string;
  readonly writes: Array<{ sessionId: string; data: Uint8Array }> = [];
  readonly closeCalls: string[] = [];
  createCount = 0;
  createCalls = 0;
  probeCalls = 0;
  private sink: SessionSink | null = null;
  private activeExit: Deferred<ObservedExit> | null = null;
  private outputSequence = 0;
  private readonly earlyOutput: readonly string[];

  private readonly track: <T>(result: PortResult<T>) => PortResult<T>;
  constructor(
    track: <T>(result: PortResult<T>) => PortResult<T>,
    sessionCharacter = 'a',
    epochCharacter = 'b',
    earlyOutput: readonly string[] = [],
  ) {
    this.track = track;
    this.sessionId = `pty-${sessionCharacter.repeat(32)}`;
    this.epochId = `epoch-${epochCharacter.repeat(32)}`;
    this.earlyOutput = earlyOutput;
  }

  async probe(): Promise<PtyCapabilityProbe> {
    this.probeCalls += 1;
    return {
      available: true,
      host: 'vm',
      transport: 'unix-broker',
      launchers: ['claude', 'codex'],
      roots: ['repo', 'worktrees'],
      epochId: this.epochId,
      checkedAt: '2026-09-02T16:00:00.000Z',
    };
  }

  create(request: SessionHostRequest, sink: SessionSink) {
    this.createCalls += 1;
    const replayed = this.sink !== null;
    if (!replayed) this.createCount += 1;
    this.sink = sink;
    this.activeExit = deferred<ObservedExit>();
    if (!replayed) this.earlyOutput.forEach((text) => this.emit(text));
    const receipt: HostStartReceipt = {
      operationKey: request.operationKey,
      sessionId: this.sessionId,
      epochId: this.epochId,
      outputSequence: 4711,
      boundAt: new Date(Date.parse('2026-09-02T16:00:00.000Z') + (this.createCalls * 1_000)).toISOString(),
      replayed,
    };
    return {
      receipt: Promise.resolve(this.track({ ok: true, value: receipt })),
      exit: this.activeExit.promise,
    };
  }

  emit(text: string): void {
    if (!this.sink) throw new Error('session has not been created');
    const data = Buffer.from(text, 'utf8');
    this.sink.data({
      sessionId: this.sessionId,
      sequence: this.outputSequence,
      encoding: 'base64',
      data: data.toString('base64'),
      replay: false,
    });
    this.outputSequence += 1;
  }

  finish(reason: ObservedExit['reason'], exitCode: number | null = null): ObservedExit {
    const exit: ObservedExit = {
      sessionId: this.sessionId,
      sequence: this.outputSequence,
      exitCode,
      signal: null,
      reason,
      observedAt: '2026-09-02T16:00:02.000Z',
    };
    this.sink?.exit(exit);
    this.activeExit?.resolve(exit);
    return exit;
  }

  async attach(_sessionId: string, _sink: SessionSink) {
    return this.track({ ok: true as const, value: { attachmentId: `att-${'c'.repeat(32)}` } });
  }

  async write(sessionId: string, data: Uint8Array) {
    this.writes.push({ sessionId, data: Uint8Array.from(data) });
    return this.track({ ok: true as const, value: { accepted: data.byteLength } });
  }

  async resize(_sessionId: string, size: SessionSize) {
    return this.track({ ok: true as const, value: size });
  }

  async close(sessionId: string) {
    this.closeCalls.push(sessionId);
    return this.track({ ok: true as const, value: this.finish('closed') });
  }

  async listEpoch() {
    return this.track({ ok: true as const, value: { epochId: this.epochId, sessionIds: [this.sessionId] } });
  }

  async drain(epochId: string) {
    return this.track({
      ok: true as const,
      value: { epochId, closed: [this.sessionId], alreadyGone: [] },
    });
  }
}

function claudeDeclaration(): ApprovedAttemptDeclaration {
  const profile: ExecutionProfile & { runtime: 'claude' } = {
    id: 'claude-worker',
    role: 'worker',
    runtime: 'claude',
    model: 'claude-sonnet',
    capabilities: ['read', 'write-approved-scope', 'emit-events'],
  };
  const assignment: ResolvedAgentAssignment = {
    agentId: 'reviewer-agent',
    declarationPath: '.agents/reviewer.md',
    declarationHash: 'd'.repeat(64),
    profileId: profile.id,
    runtime: profile.runtime,
    model: profile.model,
  };
  const proposalStage: ProposalStage = {
    id: 'review-stage',
    title: 'Review stage',
    action: 'review:code',
    target: 'dashboard/server/control',
    workOrder: 'Run the real attempt-start vertical.',
    riskTier: 'T1',
    dependsOn: [],
    worker: { runtime: 'claude', model: 'claude-sonnet' },
    requiredSkills: ['code-review'],
    scope: { read: ['dashboard'], write: ['dashboard/server/control'] },
    artifacts: [{ id: 'review-report', path: 'dashboard/review.md', description: 'Review result.' }],
    checkpoints: [{ id: 'tests-green', label: 'Focused tests pass.' }],
    humanGates: [],
    assignment,
    workflowProfile: 'research',
  };
  const attemptRef = 'attempt-33333333-3333-4333-8333-333333333333';
  return {
    operationKey: `automatic-attempt:${attemptRef}`,
    subject: 'operator@example.test',
    runRef: 'run-11111111-1111-4111-8111-111111111111',
    stageRef: 'stage-22222222-2222-4222-8222-222222222222',
    attemptRef,
    sessionRef: 'session-55555555-5555-4555-8555-555555555555',
    rootId: 'worktrees',
    relativeCwd: 'orgs/example/worktree',
    cols: 120,
    rows: 42,
    profile,
    workflowProfile: 'research',
    skills: ['code-review'],
    action: proposalStage.action,
    target: proposalStage.target,
    workOrder: proposalStage.workOrder,
    readScope: proposalStage.scope.read,
    writeScope: proposalStage.scope.write,
    checkpoints: ['tests-green'],
    proposalStage,
    project: 'dashboard-v3',
    assignment,
    instructionMarkdown: '# Reviewer\nStay inside the declared scope.',
    expectsIterationOutcome: false,
  };
}

describe('attempt-start real document vertical', () => {
  it('records a host exit terminally so projection and retention no longer treat it as live', async () => {
    const host = new LinuxShapedSessionHost((result) => result, 'c', 'd');
    const { persistence, readDocument } = validatedMemoryPersistence([]);
    const registry = createSessionRecordRegistry({ host, hostKind: 'vm', persistence });
    const input = claudeDeclaration();
    const adapter = createAttemptSessionAdapter({
      host, sessionRecords: registry,
    });
    const launch = adapter.begin(input);
    await expect(launch.receipt).resolves.toMatchObject({ ok: true });

    host.finish('exited', 17);
    await launch.result;
    await vi.waitFor(() => expect(readDocument().sessions[0]).toMatchObject({
      state: 'exited',
      exit: { sessionId: host.sessionId, exitCode: 17, reason: 'exited' },
    }));
    expect(projectAttemptSessions(registry.byRun(input.subject, input.runRef), readDocument().sessions))
      .toEqual([expect.objectContaining({ sessionId: host.sessionId, state: 'exited', liveControl: false })]);

    const retained = readDocument();
    const terminal = retained.sessions[0]!;
    if (terminal.state !== 'exited') throw new Error('expected exited retention fixture');
    for (let index = 0; index < MAX_RETAINED_SESSIONS; index += 1) {
      retained.sessions.push({
        ...terminal,
        sessionId: `pty-${(index + 100).toString(16).padStart(32, '0')}`,
        exit: { ...terminal.exit!, sessionId: `pty-${(index + 100).toString(16).padStart(32, '0')}` },
      });
    }
    enforcePtySessionRetention(retained);
    expect(retained.sessions).toHaveLength(MAX_RETAINED_SESSIONS);
    expect(retained.sessions.some((record) => record.sessionId === host.sessionId)).toBe(false);
  });

  it('persists, binds, prompts, reattaches, and cancels through the real registry without refusal', async () => {
    const events: string[] = [];
    const refusals: Array<PortResult<unknown>> = [];
    const track = <T>(result: PortResult<T>): PortResult<T> => {
      if (!result.ok) refusals.push(result);
      return result;
    };
    const earlyOutput = ['early output one\n', 'early output two\n'];
    const host = new LinuxShapedSessionHost(track, 'a', 'b', earlyOutput);
    const { persistence, readDocument } = validatedMemoryPersistence(events);
    const retainedOutput: Uint8Array[] = [];
    const registry = createSessionRecordRegistry({
      host,
      hostKind: 'vm',
      persistence,
      now: () => '2026-09-02T16:00:01.000Z',
      transcript: {
        append: (sessionId, sequence, data) => {
          retainedOutput.push(Uint8Array.from(data));
          const bytes = retainedOutput.reduce((total, frame) => total + frame.byteLength, 0);
          return {
            path: `pty/transcripts/${sessionId}.raw`,
            bytes,
            truncated: false,
            lastSequence: sequence + data.byteLength,
          };
        },
      },
    });
    const statuses: string[] = [];
    const originalStart = registry.startRunSession.bind(registry);
    vi.spyOn(registry, 'startRunSession').mockImplementation(async (startInput) => {
      events.push('start-run-session:start');
      const result = track(await originalStart(startInput));
      events.push('start-run-session:done');
      return result;
    });
    const originalWriteOperation = registry.writeOperation.bind(registry);
    vi.spyOn(registry, 'writeOperation').mockImplementation(async (record, expectedRevision) => {
      if (record.sessionId !== null) events.push(`operation-session:${record.status}:${record.promptsDelivered}`);
      const result = track(await originalWriteOperation(record, expectedRevision));
      if (result.ok) statuses.push(result.value.status);
      return result;
    });
    const logs: string[] = [];
    let observedExit: ObservedExit | null = null;
    let observedFrames = 0;
    const observedOutput: string[] = [];
    const input = claudeDeclaration();
    const adapter = createAttemptSessionAdapter({
      host,
      sessionRecords: registry,
      log: (message) => logs.push(message),
      recorder: {
        data(_attempt, frame) {
          observedFrames += 1;
          observedOutput.push(Buffer.from(frame.data, 'base64').toString('utf8'));
        },
        exit(_attempt, exit) { observedExit = exit; },
        closed() { return false; },
      },
    });

    const launch = adapter.begin(input);
    await expect(launch.receipt).resolves.toMatchObject({
      ok: true,
      value: {
        operationKey: input.operationKey,
        sessionId: host.sessionId,
        attemptRef: input.attemptRef,
      },
    });

    const hostOperationKey = `op-${sha256Hex(input.operationKey)}`;
    const afterBind = readDocument();
    expect(afterBind.attemptOperations[hostOperationKey]).toMatchObject({
      operationKey: hostOperationKey,
      status: 'bound',
      promptsDelivered: 2,
      sessionId: host.sessionId,
    });
    expect(afterBind.sessions).toContainEqual(expect.objectContaining({
      provenance: 'run',
      operationKey: hostOperationKey,
      sessionId: host.sessionId,
      operator: input.subject,
      runRef: input.runRef,
      attemptRef: input.attemptRef,
      managedSessionRef: input.sessionRef,
      epochId: host.epochId,
      host: 'vm',
      name: 'Review stage',
      transcript: {
        path: `pty/transcripts/${host.sessionId}.raw`,
        bytes: Buffer.byteLength(earlyOutput.join(''), 'utf8'),
        truncated: false,
        lastSequence: Buffer.byteLength(earlyOutput.join(''), 'utf8'),
      },
    }));
    expect(afterBind.sessions).toHaveLength(1);
    expect(statuses).toContain('bound');
    expect(host.writes).toHaveLength(2);
    expect(events.indexOf('start-run-session:done'))
      .toBeLessThan(events.indexOf('operation-session:bound:1'));
    expect(host.probeCalls).toBe(0);
    expect(observedFrames).toBe(2);
    expect(observedOutput).toEqual(earlyOutput);
    expect(Buffer.concat(retainedOutput.map((frame) => Buffer.from(frame))).toString('utf8'))
      .toBe(earlyOutput.join(''));

    host.emit('live output frame\n');
    await vi.waitFor(() => expect(Buffer.concat(retainedOutput.map((frame) => Buffer.from(frame))).toString('utf8'))
      .toBe(`${earlyOutput.join('')}live output frame\n`));

    const sameAdapterReplay = adapter.begin({ ...input });
    await expect(sameAdapterReplay.receipt).resolves.toMatchObject({
      ok: true,
      value: { operationKey: input.operationKey, sessionId: host.sessionId },
    });
    expect(host.createCalls).toBe(1);
    expect(host.createCount).toBe(1);
    expect(host.closeCalls).toEqual([]);

    const replayAdapter = createAttemptSessionAdapter({
      host,
      sessionRecords: registry,
      log: (message) => logs.push(message),
      recorder: {
        data() { observedFrames += 1; },
        exit(_attempt, exit) { observedExit = exit; },
        closed() { return false; },
      },
    });
    const replay = replayAdapter.begin({ ...input });
    await expect(replay.receipt).resolves.toMatchObject({
      ok: true,
      value: { operationKey: input.operationKey, sessionId: host.sessionId, replayed: true },
    });
    expect(host.createCalls).toBe(2);
    expect(host.createCount).toBe(1);
    expect(host.writes).toHaveLength(2);
    expect(host.closeCalls).toEqual([]);
    const afterReplay = readDocument();
    expect(afterReplay.sessions).toHaveLength(1);
    expect(afterReplay.attemptBindings).toHaveLength(1);
    expect(afterReplay.operationReceipts).toHaveLength(1);

    const restartedHost = new LinuxShapedSessionHost(track, 'd', 'e');
    const restartedRegistry = createSessionRecordRegistry({
      host: restartedHost,
      hostKind: 'vm',
      persistence,
      now: () => '2026-09-02T16:01:01.000Z',
    });
    const restartedAdapter = createAttemptSessionAdapter({
      host: restartedHost,
      sessionRecords: restartedRegistry,
    });
    const restarted = restartedAdapter.begin({ ...input });
    await expect(restarted.receipt).resolves.toMatchObject({
      ok: true,
      value: { operationKey: input.operationKey, sessionId: restartedHost.sessionId },
    });
    const afterRestart = readDocument();
    expect(afterRestart.sessions).toHaveLength(2);
    expect(afterRestart.sessions.find((record) => record.sessionId === host.sessionId)).toMatchObject({
      sessionId: host.sessionId,
      operationKey: hostOperationKey,
      state: 'abandoned',
      endedAt: '2026-09-02T16:01:01.000Z',
      abandonReason: 'daemon-restart',
      attachmentIds: [],
      transcript: expect.objectContaining({ path: `pty/transcripts/${host.sessionId}.raw` }),
      exit: { sessionId: host.sessionId, reason: 'abandoned', observedAt: '2026-09-02T16:01:01.000Z' },
    });
    expect(afterRestart.sessions.find((record) => record.sessionId === restartedHost.sessionId))
      .toMatchObject({ state: 'live', epochId: restartedHost.epochId });
    expect(afterRestart.attemptBindings).toEqual([
      expect.objectContaining({ sessionId: host.sessionId, attemptRef: input.attemptRef, retired: true }),
      expect.objectContaining({ sessionId: restartedHost.sessionId, attemptRef: input.attemptRef }),
    ]);
    expect(afterRestart.operationReceipts).toEqual([
      expect.objectContaining({ operationKey: hostOperationKey, sessionId: restartedHost.sessionId }),
    ]);
    expect(afterRestart.attemptOperations[hostOperationKey]?.sessionId).toBe(restartedHost.sessionId);

    await expect(restartedAdapter.cancel({ operationKey: input.operationKey, reason: 'operator cancelled the run' }))
      .resolves.toMatchObject({ ok: true, value: { sessionId: restartedHost.sessionId, reason: 'closed' } });
    await restarted.result;

    await vi.waitFor(() => expect(readDocument().sessions.find((record) => record.sessionId === restartedHost.sessionId))
      .toMatchObject({ state: 'exited', exit: { reason: 'closed' } }));

    expect(host.closeCalls).toEqual([]);
    expect(restartedHost.closeCalls).toEqual([restartedHost.sessionId]);
    expect(observedFrames).toBe(3);
    expect(observedExit).toBeNull();
    expect(logs).toEqual([
      `control=${input.operationKey} host=${hostOperationKey} attemptRef=${input.attemptRef}`,
      `control=${input.operationKey} host=${hostOperationKey} attemptRef=${input.attemptRef}`,
    ]);
    expect(refusals).toEqual([]);
  });

  it('sanitizes and bounds a maximum-length proposal title without refusing the attempt', async () => {
    const refusals: Array<PortResult<unknown>> = [];
    const track = <T>(result: PortResult<T>): PortResult<T> => {
      if (!result.ok) refusals.push(result);
      return result;
    };
    const host = new LinuxShapedSessionHost(track, 'f', '1');
    const { persistence, readDocument } = validatedMemoryPersistence([]);
    const registry = createSessionRecordRegistry({ host, hostKind: 'vm', persistence });
    const input = claudeDeclaration();
    input.proposalStage = { ...input.proposalStage, title: `name\t\u202e${'x'.repeat(200)}` };
    const adapter = createAttemptSessionAdapter({
      host,
      sessionRecords: registry,
    });
    const launch = adapter.begin(input);
    await expect(launch.receipt).resolves.toMatchObject({ ok: true });
    expect(readDocument().sessions[0]?.name).toBe(`name ${'x'.repeat(75)}`);
    expect(Buffer.byteLength(readDocument().sessions[0]?.name ?? '', 'utf8')).toBeLessThanOrEqual(80);
    expect(readDocument().sessions[0]?.name).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u);
    expect(refusals).toEqual([]);
    await adapter.cancel({ operationKey: input.operationKey, reason: 'test complete' });
    await launch.result;
  });

  it('serializes a frame emitted during the persisted-frame flush into the raw cursor stream', async () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'attempt-flush-race-'));
    try {
      const host = new LinuxShapedSessionHost((result) => result, '8', '9', ['first\n']);
      const { persistence, readDocument } = validatedMemoryPersistence([]);
      const registry = createSessionRecordRegistry({
        host,
        hostKind: 'vm',
        persistence,
        transcript: createTranscriptRetention(stateRoot),
      });
      const entered = deferred<void>();
      const release = deferred<void>();
      let calls = 0;
      const originalStart = registry.startRunSession.bind(registry);
      vi.spyOn(registry, 'startRunSession').mockImplementation(async (startInput) => {
        const started = originalStart(startInput);
        calls += 1;
        if (calls === 1) {
          entered.resolve();
          await release.promise;
        }
        return started;
      });
      const input = claudeDeclaration();
      const adapter = createAttemptSessionAdapter({
        host, sessionRecords: registry,
      });
      const launch = adapter.begin(input);
      await entered.promise;
      host.emit('during\n');
      release.resolve();
      await expect(launch.receipt).resolves.toMatchObject({ ok: true });

      const expected = 'first\nduring\n';
      expect(readFileSync(join(stateRoot, 'pty', 'transcripts', `${host.sessionId}.raw`), 'utf8')).toBe(expected);
      expect(readDocument().sessions[0]?.transcript.lastSequence).toBe(Buffer.byteLength(expected));
      await adapter.cancel({ operationKey: input.operationKey, reason: 'test complete' });
      await launch.result;
    } finally {
      rmSync(stateRoot, { recursive: true, force: true });
    }
  });

  it('retires an abandoned incarnation without orphaning its projection or raw transcript', async () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'attempt-retired-history-'));
    try {
      const firstHost = new LinuxShapedSessionHost((result) => result, '6', '7', ['historical\n']);
      const { persistence, readDocument } = validatedMemoryPersistence([]);
      const firstRegistry = createSessionRecordRegistry({
        host: firstHost,
        hostKind: 'vm',
        persistence,
        transcript: createTranscriptRetention(stateRoot),
      });
      const input = claudeDeclaration();
      const firstAdapter = createAttemptSessionAdapter({
        host: firstHost, sessionRecords: firstRegistry,
      });
      await expect(firstAdapter.begin(input).receipt).resolves.toMatchObject({ ok: true });

      const secondHost = new LinuxShapedSessionHost((result) => result, 'a', 'b');
      const secondRegistry = createSessionRecordRegistry({ host: secondHost, hostKind: 'vm', persistence });
      const secondAdapter = createAttemptSessionAdapter({
        host: secondHost, sessionRecords: secondRegistry,
      });
      const replacement = secondAdapter.begin({ ...input });
      await expect(replacement.receipt).resolves.toMatchObject({
        ok: true, value: { sessionId: secondHost.sessionId },
      });

      const document = readDocument();
      expect(document.attemptBindings).toEqual([
        expect.objectContaining({ sessionId: firstHost.sessionId, retired: true }),
        expect.objectContaining({ sessionId: secondHost.sessionId }),
      ]);
      expect(secondRegistry.bySession(input.subject, firstHost.sessionId))
        .toMatchObject({ sessionId: firstHost.sessionId, retired: true });
      expect(projectAttemptSessions(secondRegistry.byRun(input.subject, input.runRef), document.sessions))
        .toEqual([
          expect.objectContaining({ sessionId: firstHost.sessionId, state: 'abandoned', liveControl: false }),
          expect.objectContaining({ sessionId: secondHost.sessionId, state: 'live', liveControl: true }),
        ]);
      const replay = createRawSessionReplaySource({
        stateRoot,
        extent: (sessionId) => {
          const record = readDocument().sessions.find((item) => item.sessionId === sessionId);
          return record ? { total: record.transcript.lastSequence, bytes: record.transcript.bytes } : null;
        },
      });
      await expect(replay.read(firstHost.sessionId, 0)).resolves.toMatchObject({
        ok: true,
        value: { frames: [{ data: Buffer.from('historical\n').toString('base64') }] },
      });
      await secondAdapter.cancel({ operationKey: input.operationKey, reason: 'test complete' });
      await replacement.result;
    } finally {
      rmSync(stateRoot, { recursive: true, force: true });
    }
  });

  it('refuses a live identity collision and closes only the newly created session', async () => {
    const firstHost = new LinuxShapedSessionHost((result) => result, '2', '3');
    const { persistence, readDocument } = validatedMemoryPersistence([]);
    const firstRegistry = createSessionRecordRegistry({ host: firstHost, hostKind: 'vm', persistence });
    const input = claudeDeclaration();
    const firstAdapter = createAttemptSessionAdapter({
      host: firstHost, sessionRecords: firstRegistry,
    });
    await expect(firstAdapter.begin(input).receipt).resolves.toMatchObject({ ok: true });

    const rivalHost = new LinuxShapedSessionHost((result) => result, '4', '3');
    const rivalRegistry = createSessionRecordRegistry({ host: rivalHost, hostKind: 'vm', persistence });
    const rivalAdapter = createAttemptSessionAdapter({
      host: rivalHost, sessionRecords: rivalRegistry,
    });
    await expect(rivalAdapter.begin({ ...input }).receipt).resolves.toMatchObject({
      ok: false, refusal: 'binding-conflict',
    });
    expect(rivalHost.closeCalls).toEqual([rivalHost.sessionId]);
    expect(firstHost.closeCalls).toEqual([]);
    expect(readDocument().sessions).toEqual([
      expect.objectContaining({ sessionId: firstHost.sessionId, state: 'live' }),
      expect.objectContaining({
        sessionId: rivalHost.sessionId,
        state: 'exited',
        exit: expect.objectContaining({ reason: 'closed' }),
      }),
    ]);
    expect(readDocument().attemptBindings).toEqual([
      expect.objectContaining({ sessionId: firstHost.sessionId }),
    ]);
    expect(readDocument().attemptBindings[0]).not.toHaveProperty('retired');
  });

  it('owns first start, replay, epoch retirement, collision cleanup, and early-frame cursors', async () => {
    const events: string[] = [];
    const { persistence, readDocument } = validatedMemoryPersistence(events);
    const firstHost = new LinuxShapedSessionHost(
      (result) => result,
      '1',
      '2',
      ['alpha\n', 'beta\n'],
    );
    const firstRegistry = createSessionRecordRegistry({ host: firstHost, hostKind: 'vm', persistence });
    const declaration = claudeDeclaration();
    const hostOperationKey = `op-${sha256Hex(declaration.operationKey)}`;
    const requestHash = sha256Hex('registry-level-start');
    const createdAt = '2026-09-02T15:59:59.000Z';
    await expect(firstRegistry.writeOperation({
      operationKey: hostOperationKey,
      requestHash,
      status: 'pending',
      promptsDelivered: 0,
      sessionId: null,
      attemptRef: declaration.attemptRef,
      receipt: {
        operationKey: hostOperationKey,
        requestHash,
        status: 'pending',
        sessionId: null,
        attemptRef: declaration.attemptRef,
        refusal: null,
        createdAt,
        settledAt: null,
      },
      revision: 0,
      updatedAt: createdAt,
    }, null)).resolves.toMatchObject({ ok: true });

    const observedOffsets: number[] = [];
    const sink: SessionSink = {
      data: (frame) => observedOffsets.push(frame.sequence),
      exit() {},
      closed: () => false,
    };
    const startInput: StartRunSessionInput = {
      operator: declaration.subject,
      runRef: declaration.runRef,
      attemptRef: declaration.attemptRef,
      managedSessionRef: declaration.sessionRef,
      hostOperationKey,
      requestHash,
      recipe: {
        launcher: 'claude',
        mode: 'headless-json',
        model: 'claude-sonnet',
        toolPolicyId: 'research',
        sandbox: 'claude-policy',
      },
      rootId: 'worktrees',
      relativeCwd: declaration.relativeCwd,
      size: { cols: declaration.cols, rows: declaration.rows },
      displayName: declaration.proposalStage.title,
      sink,
    };

    const first = await firstRegistry.startRunSession(startInput);
    expect(first).toMatchObject({
      ok: true,
      value: {
        sessionId: firstHost.sessionId,
        replayed: false,
        outputCursor: Buffer.byteLength('alpha\nbeta\n'),
      },
    });
    expect(observedOffsets).toEqual([0, Buffer.byteLength('alpha\n')]);
    expect(readDocument()).toMatchObject({
      sessions: [expect.objectContaining({
        sessionId: firstHost.sessionId,
        state: 'live',
        transcript: expect.objectContaining({ lastSequence: Buffer.byteLength('alpha\nbeta\n') }),
      })],
      attemptBindings: [expect.objectContaining({ sessionId: firstHost.sessionId })],
      operationReceipts: [expect.objectContaining({ sessionId: firstHost.sessionId, status: 'bound' })],
      attemptOperations: {
        [hostOperationKey]: expect.objectContaining({ sessionId: firstHost.sessionId, status: 'bound' }),
      },
    });

    const beforeReplayRevision = readDocument().revision;
    const replay = await firstRegistry.startRunSession(startInput);
    expect(replay).toMatchObject({
      ok: true,
      value: { sessionId: firstHost.sessionId, replayed: true, documentRevision: beforeReplayRevision },
    });
    expect(readDocument().revision).toBe(beforeReplayRevision);

    const replacementHost = new LinuxShapedSessionHost((result) => result, '3', '4');
    const replacementRegistry = createSessionRecordRegistry({
      host: replacementHost,
      hostKind: 'vm',
      persistence,
      now: () => '2026-09-02T16:01:00.000Z',
    });
    const replacement = await replacementRegistry.startRunSession(startInput);
    expect(replacement).toMatchObject({ ok: true, value: { sessionId: replacementHost.sessionId } });
    expect(readDocument()).toMatchObject({
      sessions: [
        expect.objectContaining({ sessionId: firstHost.sessionId, state: 'abandoned' }),
        expect.objectContaining({ sessionId: replacementHost.sessionId, state: 'live' }),
      ],
      attemptBindings: [
        expect.objectContaining({ sessionId: firstHost.sessionId, retired: true }),
        expect.objectContaining({ sessionId: replacementHost.sessionId }),
      ],
    });

    const rivalHost = new LinuxShapedSessionHost((result) => result, '5', '4');
    const rivalRegistry = createSessionRecordRegistry({ host: rivalHost, hostKind: 'vm', persistence });
    await expect(rivalRegistry.startRunSession(startInput)).resolves.toMatchObject({
      ok: false,
      refusal: 'binding-conflict',
    });
    expect(rivalHost.closeCalls).toEqual([rivalHost.sessionId]);
    expect(readDocument().sessions).toContainEqual(expect.objectContaining({
      sessionId: rivalHost.sessionId,
      state: 'exited',
      exit: expect.objectContaining({ reason: 'closed' }),
    }));

    if (replacement.ok) {
      await replacement.value.close();
      await replacement.value.exit;
    }
  });

  it('names a missing session record when an operation claim is refused', async () => {
    const events: string[] = [];
    const host = new LinuxShapedSessionHost((result) => result);
    const { persistence } = validatedMemoryPersistence(events);
    const registry = createSessionRecordRegistry({ host, hostKind: 'vm', persistence });
    const operationKey = `op-${'e'.repeat(64)}`;
    const missingSessionId = `pty-${'f'.repeat(32)}`;
    const now = '2026-09-02T16:00:00.000Z';
    const record: AttemptOperationRecord = {
      operationKey,
      requestHash: '1'.repeat(64),
      status: 'pending',
      promptsDelivered: 1,
      sessionId: missingSessionId,
      attemptRef: 'attempt-missing-session',
      receipt: {
        operationKey,
        requestHash: '1'.repeat(64),
        status: 'pending',
        sessionId: missingSessionId,
        attemptRef: 'attempt-missing-session',
        refusal: null,
        createdAt: now,
        settledAt: null,
      },
      revision: 0,
      updatedAt: now,
    };

    await expect(registry.writeOperation(record, null)).resolves.toEqual({
      ok: false,
      refusal: 'internal',
      detail: `attempt operation references missing session record '${missingSessionId}'`,
    });
  });
});
