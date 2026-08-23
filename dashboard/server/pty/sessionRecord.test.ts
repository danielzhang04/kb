import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AttemptOperationRecord, BrowserPrincipal, PtySessionsDocumentV2, SessionHost,
  SessionHostRequest, SessionRecord, SessionSink } from './contracts.ts';
import { RUN_CONTROLLER_NULL_BROWSER_SESSION_REF } from './contracts.ts';
import {
  claimRunController,
  createAttachmentClosure,
  createSessionRecordRegistry,
  hostRequestPrincipal,
  principalMatches,
  sessionIsControlledBy,
  summarizeSessionRecord,
} from './sessionRecord.ts';
import {
  assertPtySessionsDocumentV2,
  createEmptyPtySessionsDocument,
  createTranscriptRetention,
  enforcePtySessionRetention,
} from './sessionPersistence.ts';
import type { SessionPersistence } from './sessionPersistence.ts';

const REF_A = Buffer.alloc(32, 1).toString('base64url');
const REF_B = Buffer.alloc(32, 2).toString('base64url');
const NOW = '2026-08-23T12:00:00.000Z';
const ALICE_A: BrowserPrincipal = { operator: 'alice', browserSessionRef: REF_A };
const ALICE_B: BrowserPrincipal = { operator: 'alice', browserSessionRef: REF_B };
const BOB_A: BrowserPrincipal = { operator: 'bob', browserSessionRef: REF_A };

function runRecord(): SessionRecord {
  return {
    sessionId: `pty-${'1'.repeat(32)}`,
    operationKey: `op-${'2'.repeat(64)}`,
    requestHash: '3'.repeat(64),
    recipeDigest: '4'.repeat(64),
    launcher: 'claude',
    host: 'vm',
    rootId: 'worktrees',
    relativeCwd: 'run-a',
    name: 'Run A',
    attachmentIds: [],
    transcript: { path: 'pty/transcripts/run-a.log', bytes: 0, truncated: false, lastSequence: 0 },
    startedAt: '2026-08-23T12:00:00.000Z',
    endedAt: null,
    revision: 7,
    provenance: 'run',
    controller: null,
    operator: 'alice',
    runRef: 'run-a',
    attemptRef: 'attempt-a',
    managedSessionRef: 'managed-a',
    state: 'live',
    epochId: `epoch-${'5'.repeat(32)}`,
    exit: null,
  };
}

describe('composite-principal session policy', () => {
  it('requires the operator/ref cross-product for every controller check', () => {
    expect(principalMatches(ALICE_A, { ...ALICE_A })).toBe(true);
    expect(principalMatches(ALICE_A, ALICE_B)).toBe(false);
    expect(principalMatches(ALICE_A, BOB_A)).toBe(false);

    const claimed = { ...runRecord(), controller: ALICE_A, claimRevision: 8 } as SessionRecord;
    expect(sessionIsControlledBy(claimed, ALICE_A)).toBe(true);
    expect(sessionIsControlledBy(claimed, ALICE_B)).toBe(false);
    expect(sessionIsControlledBy(claimed, BOB_A)).toBe(false);
  });

  it('claim first/replay/revision/foreign mask and exact claim envelope', () => {
    const record = runRecord();
    const original = claimRunController(record, ALICE_A, {
      runRef: 'run-a', sessionId: record.sessionId, expectedRunVersion: 4, expectedSessionRevision: 7,
    }, 4);
    expect(original).toEqual({ ok: true, value: { revision: 8, sessionId: record.sessionId, replayed: false } });
    record.revision += 1;
    const replay = claimRunController(record, ALICE_A, {
      runRef: 'run-a', sessionId: record.sessionId, expectedRunVersion: 4, expectedSessionRevision: 7,
    }, 4);
    // Byte-stable revision/sessionId, but the replay is reported as one: ClaimReceipt.replayed is
    // a live contract field, not a constant.
    expect(replay).toEqual({ ok: true, value: { revision: 8, sessionId: record.sessionId, replayed: true } });
    expect(claimRunController(runRecord(), ALICE_A, {
      runRef: 'run-a', sessionId: record.sessionId, expectedRunVersion: 4, expectedSessionRevision: 6,
    }, 4)).toMatchObject({ ok: false, refusal: 'binding-conflict' });
    expect(claimRunController(record, ALICE_B, {
      runRef: 'run-a', sessionId: record.sessionId, expectedRunVersion: 4, expectedSessionRevision: 8,
    }, 4)).toMatchObject({ ok: false, refusal: 'not-found' });
    expect(claimRunController(record, BOB_A, {
      runRef: 'run-a', sessionId: record.sessionId, expectedRunVersion: 4, expectedSessionRevision: 8,
    }, 4)).toMatchObject({ ok: false, refusal: 'not-found' });
  });

  it('names the host principal for manual and controller-null Run launches', () => {
    expect(hostRequestPrincipal({ provenance: 'manual', controller: ALICE_A })).toEqual(ALICE_A);
    expect(hostRequestPrincipal({ provenance: 'run', operator: 'alice', controller: null })).toEqual({
      operator: 'alice', browserSessionRef: RUN_CONTROLLER_NULL_BROWSER_SESSION_REF,
    });
    expect(hostRequestPrincipal({ provenance: 'run', operator: 'alice', controller: ALICE_B })).toEqual(ALICE_B);
  });

  it('re-reads the Run version inside the claim mutation before writing', async () => {
    let document = createEmptyPtySessionsDocument();
    document.sessions.push(runRecord());
    let runVersion = 4;
    let resolverCalls = 0;
    const persistence: SessionPersistence = {
      read: () => structuredClone(document),
      mutate: async (_expectedRevision, callback) => {
        runVersion = 5;
        const draft = structuredClone(document);
        const value = await callback(draft);
        draft.revision += 1;
        document = draft;
        return { revision: document.revision, value };
      },
    };
    const registry = createSessionRecordRegistry({
      persistence,
      host: {} as SessionHost,
      resolveRunVersion: async () => {
        resolverCalls += 1;
        await Promise.resolve();
        return runVersion;
      },
    });

    const claim = await registry.claimRunController(ALICE_A, {
      runRef: 'run-a', sessionId: runRecord().sessionId, expectedRunVersion: 4, expectedSessionRevision: 7,
    });
    expect(claim).toMatchObject({ ok: false, refusal: 'binding-conflict' });
    expect(resolverCalls).toBe(2);
    expect(document.sessions[0]?.controller).toBeNull();
  });

  it('replays the byte-equal original claim after an unrelated attach revision', async () => {
    let document = createEmptyPtySessionsDocument();
    document.sessions.push(runRecord());
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
    const host = { attach: vi.fn(async () => ({ ok: true as const,
      value: { attachmentId: `att-${'a'.repeat(32)}` } })) } as unknown as SessionHost;
    const registry = createSessionRecordRegistry({ persistence, host, resolveRunVersion: () => 4 });
    const input = { runRef: 'run-a', sessionId: runRecord().sessionId,
      expectedRunVersion: 4, expectedSessionRevision: 7 };

    const original = await registry.claimRunController(ALICE_A, input);
    await expect(registry.attach(ALICE_A, input.sessionId,
      { data: vi.fn(), exit: vi.fn(), closed: () => false })).resolves.toMatchObject({ ok: true });
    expect(await registry.claimRunController(ALICE_A, input)).toEqual({
      ok: true,
      value: { ...(original.ok ? original.value : {}), replayed: true },
    });
  });

  /** A fake that runs the real retention + strict validator, so it can reject like the real store. */
  function validatingPersistence(seed = createEmptyPtySessionsDocument()) {
    const state = { document: seed, mutations: 0, failMutation: 0 };
    let queue = Promise.resolve();
    const persistence: SessionPersistence = {
      read: () => structuredClone(state.document),
      mutate: async (expectedRevision, callback) => {
        let result!: { revision: number; value: unknown };
        const action = queue.then(async () => {
          state.mutations += 1;
          if (state.mutations === state.failMutation) {
            throw new Error('C:\\private\\pty\\session-runs.json write failed');
          }
          if (expectedRevision !== null && expectedRevision !== state.document.revision) {
            throw new Error('revision-conflict');
          }
          const draft = structuredClone(state.document);
          const value = await callback(draft);
          enforcePtySessionRetention(draft);
          draft.revision += 1;
          assertPtySessionsDocumentV2(draft);
          state.document = draft;
          result = { revision: draft.revision, value };
        });
        queue = action.then(() => undefined, () => undefined);
        await action;
        return result as never;
      },
    };
    return { state, persistence };
  }

  function compensationHost(close: SessionHost['close']) {
    const requests: SessionHostRequest[] = [];
    let serial = 0;
    const host = {
      probe: async () => ({ available: true as const, host: 'desktop' as const,
        transport: 'local-node-pty' as const, launchers: ['shell' as const], roots: ['repo' as const],
        epochId: `epoch-${'e'.repeat(32)}`, checkedAt: NOW }),
      create: (request: SessionHostRequest, sink: { data(frame: { sessionId: string; sequence: number;
        encoding: 'base64'; data: string; replay: boolean }): void }) => {
        requests.push(structuredClone(request));
        serial += 1;
        const sessionId = `pty-${serial.toString(16).padStart(32, '0')}`;
        sink.data({ sessionId, sequence: 1, encoding: 'base64', data: 'eA==', replay: false });
        return { receipt: Promise.resolve({ ok: true as const, value: { operationKey: request.operationKey,
          sessionId, epochId: `epoch-${'e'.repeat(32)}`, revision: 0, boundAt: NOW, replayed: false } }),
          exit: new Promise<never>(() => undefined) };
      },
      close,
    } as unknown as SessionHost;
    return { host, requests };
  }

  const MANUAL_REQUEST = { launcher: 'shell' as const, rootId: 'repo' as const,
    relativeCwd: '', cols: 80, rows: 24 };

  it('names the calling principal on every host create request', async () => {
    const { persistence } = validatingPersistence();
    const { host, requests } = compensationHost(vi.fn(async (sessionId: string) => ({ ok: true as const,
      value: { sessionId, sequence: 1, exitCode: null, signal: null, reason: 'closed' as const,
        observedAt: NOW } })));
    let operation = 0;
    const registry = createSessionRecordRegistry({ persistence, host, now: () => NOW,
      makeOperationKey: () => `op-${(++operation).toString(16).padStart(64, '0')}` });

    await expect(registry.create(ALICE_A, MANUAL_REQUEST)).resolves.toMatchObject({ ok: true });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.principal).toEqual(ALICE_A);
  });

  it('mints every data sequence as a byte offset, exactly once per host frame across all sinks', async () => {
    // [C-R6] W0 amendment #3. The host numbers frames 1, 2, 3; the wire numbers BYTES. Two sinks see
    // every frame (the registry's transcript sink and the attachment's), and the two hosts deliver
    // differently — Windows hands the SAME object to each sink, the Linux broker builds a fresh one per
    // sink. Both are exercised here, because counting a frame's bytes twice would shift the transcript
    // off its own offsets permanently.
    const { persistence, state } = validatingPersistence();
    let sessionId = '';
    let hostSink: SessionSink | null = null;
    let attachSink: SessionSink | null = null;
    const host = {
      probe: async () => ({ available: true as const, host: 'desktop' as const,
        transport: 'local-node-pty' as const, launchers: ['shell' as const], roots: ['repo' as const],
        epochId: `epoch-${'e'.repeat(32)}`, checkedAt: NOW }),
      create: (request: SessionHostRequest, sink: SessionSink) => {
        hostSink = sink;
        sessionId = `pty-${'a'.repeat(32)}`;
        return { receipt: Promise.resolve({ ok: true as const, value: { operationKey: request.operationKey,
          sessionId, epochId: `epoch-${'e'.repeat(32)}`, revision: 0, boundAt: NOW, replayed: false } }),
          exit: new Promise<never>(() => undefined) };
      },
      attach: async (_id: string, sink: SessionSink) => {
        attachSink = sink;
        return { ok: true as const, value: { attachmentId: `att-${'b'.repeat(32)}` } };
      },
    } as unknown as SessionHost;

    const appended: { sequence: number; bytes: number }[] = [];
    let onDisk = 0;
    const transcript = {
      append: (_id: string, sequence: number, data: Uint8Array) => {
        appended.push({ sequence, bytes: data.byteLength });
        onDisk += data.byteLength;
        return { path: `pty/transcripts/${sessionId}.raw`, bytes: onDisk, truncated: false,
          lastSequence: sequence + data.byteLength };
      },
    };
    let operation = 0;
    const registry = createSessionRecordRegistry({ persistence, host, transcript, now: () => NOW,
      makeOperationKey: () => `op-${(++operation).toString(16).padStart(64, '0')}` });

    await expect(registry.create(ALICE_A, MANUAL_REQUEST)).resolves.toMatchObject({ ok: true });
    const observed: number[] = [];
    await registry.attach(ALICE_A, sessionId, {
      data: (frame) => { observed.push(frame.sequence); }, exit: () => {}, closed: () => false,
    });

    // ASCII, a multibyte string whose byte length is not its character length, and raw non-UTF-8 bytes.
    const payloads = [
      Buffer.from('ab', 'utf8'),
      Buffer.from('é€', 'utf8'),
      Buffer.from([0xff, 0x00, 0xfe, 0x80]),
    ];
    payloads.forEach((payload, index) => {
      const shared = { sessionId, sequence: index + 1, encoding: 'base64' as const,
        data: payload.toString('base64'), replay: false };
      // Windows: one object, every sink. Linux: a fresh object per sink, same host sequence.
      (hostSink as unknown as SessionSink).data(shared);
      (attachSink as unknown as SessionSink).data({ ...shared });
    });

    const expectedOffsets = [0, 2, 2 + 5];
    const total = 2 + 5 + 4;
    const deadline = Date.now() + 5_000;
    while (state.document.sessions[0]?.transcript.lastSequence !== total) {
      if (Date.now() > deadline) break;
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(observed).toEqual(expectedOffsets);
    expect(appended).toEqual([
      { sequence: 0, bytes: 2 }, { sequence: 2, bytes: 5 }, { sequence: 7, bytes: 4 },
    ]);
    // The record's cumulative total is the reader's `total`, and the retained window is [total-bytes, total).
    expect(state.document.sessions[0].transcript).toMatchObject({ bytes: total, lastSequence: total });
  });

  describe('resume baseline over a re-created registry ([C-R6] byte offsets, not frame counts)', () => {
    let stateRoot: string;

    beforeEach(() => { stateRoot = mkdtempSync(join(tmpdir(), 'kb-sessionrecord-resume-')); });
    afterEach(() => { rmSync(stateRoot, { recursive: true, force: true }); });

    /** A live, controller-claimed record so `attach` authorizes ALICE_A without a separate claim. */
    function resumableRecord(lastSequence: number): SessionRecord {
      return { ...runRecord(), controller: { ...ALICE_A }, claimRevision: 1,
        transcript: { ...runRecord().transcript, lastSequence } } as SessionRecord;
    }

    /** Same inline CAS shape as the other registry tests in this file — no strict-validator overhead. */
    function simplePersistence(seed: PtySessionsDocumentV2): SessionPersistence {
      let document = seed;
      let mutation = Promise.resolve();
      return {
        read: () => structuredClone(document),
        mutate: async (expectedRevision, callback) => {
          let result!: { revision: number; value: unknown };
          const action = mutation.then(async () => {
            if (expectedRevision !== null && expectedRevision !== document.revision) throw new Error('revision-conflict');
            const draft = structuredClone(document);
            const value = await callback(draft);
            draft.revision += 1;
            document = draft;
            result = { revision: document.revision, value };
          });
          mutation = action.then(() => undefined);
          await action;
          return result as never;
        },
      };
    }

    /** Attaches and returns the offset minted for exactly one host frame delivered after attach. */
    async function mintedResumeOffset(
      persistence: SessionPersistence,
      transcript: ReturnType<typeof createTranscriptRetention>,
    ): Promise<number> {
      const sessionId = runRecord().sessionId;
      let capturedSink: SessionSink | null = null;
      const host = { attach: async (_id: string, sink: SessionSink) => {
        capturedSink = sink;
        return { ok: true as const, value: { attachmentId: `att-${'c'.repeat(32)}` } };
      } } as unknown as SessionHost;
      const registry = createSessionRecordRegistry({ persistence, host, transcript, now: () => NOW });
      const observed: number[] = [];
      const attached = await registry.attach(ALICE_A, sessionId,
        { data: (frame) => observed.push(frame.sequence), exit: () => {}, closed: () => false });
      expect(attached).toMatchObject({ ok: true });
      (capturedSink as unknown as SessionSink).data({ sessionId, sequence: 1, encoding: 'base64',
        data: Buffer.from('x').toString('base64'), replay: false });
      expect(observed).toHaveLength(1);
      return observed[0] as number;
    }

    it('resumes above a stale frame-counter lastSequence when the retained file is larger', async () => {
      const transcript = createTranscriptRetention(stateRoot);
      transcript.append(runRecord().sessionId, 0, Buffer.alloc(500, 1)); // 500 real bytes on disk
      const document = createEmptyPtySessionsDocument();
      document.sessions.push(resumableRecord(3)); // an earlier build's frame counter, not a byte offset
      const persistence = simplePersistence(document);

      expect(await mintedResumeOffset(persistence, transcript)).toBe(500);
    });

    it('leaves the baseline unchanged when lastSequence already covers the retained bytes', async () => {
      const transcript = createTranscriptRetention(stateRoot);
      transcript.append(runRecord().sessionId, 0, Buffer.alloc(40, 1)); // 40 bytes retained
      const document = createEmptyPtySessionsDocument();
      document.sessions.push(resumableRecord(1000)); // already ahead of the retained file
      const persistence = simplePersistence(document);

      expect(await mintedResumeOffset(persistence, transcript)).toBe(1000);
    });

    it('falls back to lastSequence when the transcript file is missing', async () => {
      const transcript = createTranscriptRetention(stateRoot); // no file ever written for this session
      const document = createEmptyPtySessionsDocument();
      document.sessions.push(resumableRecord(42));
      const persistence = simplePersistence(document);

      expect(await mintedResumeOffset(persistence, transcript)).toBe(42);
    });
  });

  it('surfaces the host capacity refusal instead of counting sessions itself', async () => {
    const { persistence, state } = validatingPersistence();
    const host = {
      probe: async () => ({ available: true as const, host: 'desktop' as const,
        transport: 'local-node-pty' as const, launchers: ['shell' as const], roots: ['repo' as const],
        epochId: `epoch-${'e'.repeat(32)}`, checkedAt: NOW }),
      // Capacity lives with the host now that SessionHostRequest names the principal.
      create: () => ({ receipt: Promise.resolve({ ok: false as const, refusal: 'capacity' as const,
        detail: null }), exit: new Promise<never>(() => undefined) }),
    } as unknown as SessionHost;
    let operation = 0;
    const registry = createSessionRecordRegistry({ persistence, host, now: () => NOW,
      makeOperationKey: () => `op-${(++operation).toString(16).padStart(64, '0')}` });

    await expect(registry.create(ALICE_A, MANUAL_REQUEST)).resolves.toEqual({
      ok: false, refusal: 'capacity', detail: null,
    });
    expect(state.document.sessions).toHaveLength(0);
    expect(state.document.operationReceipts.at(-1)).toMatchObject({ status: 'failed', refusal: 'capacity' });
  });

  it('compensates a post-launch rejection through the real retention/validator path', async () => {
    const { persistence, state } = validatingPersistence();
    const liveIds = new Set<string>();
    const close = vi.fn(async (sessionId: string) => {
      liveIds.delete(sessionId);
      return { ok: true as const, value: { sessionId, sequence: 1, exitCode: null, signal: null,
        reason: 'closed' as const, observedAt: NOW } };
    });
    const { host } = compensationHost(close);
    const transcript = { append: vi.fn(() => ({ path: 'pty/transcripts/ignored.raw', bytes: 1,
      truncated: false, lastSequence: 1 })) };
    const errors: unknown[] = [];
    let operation = 0;
    const registry = createSessionRecordRegistry({ persistence, host, transcript, now: () => NOW,
      onBackgroundError: (error) => errors.push(error),
      makeOperationKey: () => `op-${(++operation).toString(16).padStart(64, '0')}` });

    state.failMutation = 2;
    await expect(registry.create(ALICE_A, MANUAL_REQUEST)).resolves.toEqual({
      ok: false, refusal: 'internal', detail: 'session operation failed',
    });
    const failedSessionId = `pty-${'0'.repeat(31)}1`;
    expect(close).toHaveBeenCalledWith(failedSessionId);
    expect(liveIds).not.toContain(failedSessionId);
    expect(state.document.sessions).toHaveLength(0);
    expect(state.document.operationReceipts.at(-1)).toMatchObject({ status: 'failed', refusal: 'internal' });
    expect(transcript.append).not.toHaveBeenCalled();
    expect(String(errors[0])).toContain('C:\\private\\pty');

    state.failMutation = 0;
    await expect(registry.create(ALICE_A, MANUAL_REQUEST)).resolves.toMatchObject({ ok: true });
  });

  it('escalates a refused compensating close instead of leaving an unnamed child alive', async () => {
    const { persistence, state } = validatingPersistence();
    const close = vi.fn(async () => ({ ok: false as const, refusal: 'unavailable' as const,
      detail: null }));
    const { host } = compensationHost(close);
    const errors: unknown[] = [];
    let operation = 0;
    const registry = createSessionRecordRegistry({ persistence, host, now: () => NOW,
      onBackgroundError: (error) => errors.push(error),
      makeOperationKey: () => `op-${(++operation).toString(16).padStart(64, '0')}` });

    state.failMutation = 2;
    await expect(registry.create(ALICE_A, MANUAL_REQUEST)).resolves.toMatchObject({ ok: false, refusal: 'internal' });
    expect(close).toHaveBeenCalledTimes(1);
    const escalated = errors.map(String).filter((entry) => entry.includes('compensating close refused'));
    expect(escalated).toHaveLength(1);
    expect(escalated[0]).toContain('unavailable');
    expect(escalated[0]).toContain(`pty-${'0'.repeat(31)}1`);
  });

  function attemptOperation(overrides: Partial<AttemptOperationRecord> = {}): AttemptOperationRecord {
    return {
      operationKey: `op-${'a'.repeat(64)}`,
      requestHash: 'b'.repeat(64),
      status: 'pending',
      promptsDelivered: 0,
      sessionId: null,
      attemptRef: null,
      receipt: null,
      revision: 0,
      updatedAt: '2026-08-23T11:00:00.000Z',
      ...overrides,
    };
  }

  it('creates, replays and CAS-conflicts durable attempt operations', async () => {
    const { persistence, state } = validatingPersistence();
    const registry = createSessionRecordRegistry({ persistence, host: {} as SessionHost, now: () => NOW });

    expect(await registry.readOperation(attemptOperation().operationKey)).toBeNull();
    const created = await registry.writeOperation(attemptOperation(), null);
    expect(created).toEqual({ ok: true, value: attemptOperation({ revision: 1, updatedAt: NOW }) });
    // `expectedRevision: null` means "must not exist": a second create is a conflict, not an upsert.
    expect(await registry.writeOperation(attemptOperation(), null)).toMatchObject({
      ok: false, refusal: 'binding-conflict',
    });
    expect(await registry.writeOperation(attemptOperation({ status: 'bound' }), 0)).toMatchObject({
      ok: false, refusal: 'binding-conflict',
    });
    expect(await registry.readOperation(attemptOperation().operationKey))
      .toEqual(attemptOperation({ revision: 1, updatedAt: NOW }));
    expect(await registry.writeOperation(attemptOperation({ status: 'completed', promptsDelivered: 3 }), 1))
      .toEqual({ ok: true, value: attemptOperation({ status: 'completed', promptsDelivered: 3,
        revision: 2, updatedAt: NOW }) });
    expect(state.document.attemptOperations[attemptOperation().operationKey])
      .toMatchObject({ status: 'completed', revision: 2 });
    expect(await registry.readOperation('op-not-a-key')).toBeNull();
  });

  it('lets exactly one of two concurrent attempt-operation writers win', async () => {
    const { persistence, state } = validatingPersistence();
    const registry = createSessionRecordRegistry({ persistence, host: {} as SessionHost, now: () => NOW });

    const both = await Promise.all([
      registry.writeOperation(attemptOperation({ promptsDelivered: 1 }), null),
      registry.writeOperation(attemptOperation({ promptsDelivered: 2 }), null),
    ]);
    expect(both.filter((result) => result.ok)).toHaveLength(1);
    expect(both.filter((result) => !result.ok)).toEqual([
      { ok: false, refusal: 'binding-conflict', detail: 'attempt operation revision conflict' },
    ]);
    expect(state.document.attemptOperations[attemptOperation().operationKey]?.revision).toBe(1);

    const contenders = await Promise.all([
      registry.writeOperation(attemptOperation({ status: 'bound' }), 1),
      registry.writeOperation(attemptOperation({ status: 'cancelled' }), 1),
    ]);
    expect(contenders.filter((result) => result.ok)).toHaveLength(1);
    expect(state.document.attemptOperations[attemptOperation().operationKey]?.revision).toBe(2);
  });

  it('same-pair multi-tab', async () => {
    const ids = new Set(['att-old', 'att-new']);
    const detach = createAttachmentClosure('att-old', ids);
    await detach();
    await detach();
    expect([...ids]).toEqual(['att-new']);
  });

  it('reports detached-live sessions without changing their live state', () => {
    const record = { ...runRecord(), attachmentIds: [] };
    expect(summarizeSessionRecord(record)).toMatchObject({
      state: 'live', attachmentCount: 0, attachmentState: 'detached',
    });
  });

  it('independent composite-principal list/attach/write/resize/close/eviction', async () => {
    let document = createEmptyPtySessionsDocument();
    let mutation = Promise.resolve();
    const persistence: SessionPersistence = {
      read: () => structuredClone(document),
      mutate: async (expectedRevision, callback) => {
        let result!: { revision: number; value: unknown };
        const action = mutation.then(async () => {
          if (expectedRevision !== null && expectedRevision !== document.revision) throw new Error('revision-conflict');
          const draft = structuredClone(document);
          const value = await callback(draft);
          draft.revision += 1;
          document = draft;
          result = { revision: document.revision, value };
        });
        mutation = action.then(() => undefined);
        await action;
        return result as never;
      },
    };
    let serial = 0;
    const close = vi.fn(async (sessionId: string) => ({ ok: true as const, value: {
      sessionId, sequence: 1, exitCode: 0, signal: null, reason: 'closed' as const,
      observedAt: '2026-08-23T12:01:00.000Z',
    } }));
    const host: SessionHost = {
      probe: async () => ({ available: true, host: 'desktop', transport: 'local-node-pty',
        launchers: ['shell'], roots: ['repo'], epochId: `epoch-${'e'.repeat(32)}`, checkedAt: NOW }),
      create: (request) => {
        serial += 1;
        const sessionId = `pty-${serial.toString(16).padStart(32, '0')}`;
        return {
          receipt: Promise.resolve({ ok: true, value: { operationKey: request.operationKey, sessionId,
            epochId: `epoch-${'e'.repeat(32)}`, revision: 0, boundAt: NOW, replayed: false } }),
          exit: new Promise(() => undefined),
        };
      },
      attach: async () => ({ ok: true, value: { attachmentId: `att-${'a'.repeat(32)}` } }),
      write: async (_id, data) => ({ ok: true, value: { accepted: data.byteLength } }),
      resize: async (_id, size) => ({ ok: true, value: size }),
      close,
      listEpoch: async () => ({ ok: true, value: { epochId: `epoch-${'e'.repeat(32)}`, sessionIds: [] } }),
      drain: async (epochId) => ({ ok: true, value: { epochId, closed: [], alreadyGone: [] } }),
    };
    let deploymentCloser: ((ids: readonly string[]) => Promise<unknown>) | undefined;
    let operation = 0;
    const registry = createSessionRecordRegistry({
      host,
      persistence,
      now: () => NOW,
      resolveRunVersion: () => 4,
      makeOperationKey: () => `op-${(++operation).toString(16).padStart(64, '0')}`,
      installDeploymentCloser: (closer) => { deploymentCloser = closer; },
    });
    const created = await registry.create(ALICE_A, { launcher: 'shell', rootId: 'repo', relativeCwd: '', cols: 80, rows: 24 });
    expect(created.ok).toBe(true);
    const sessionId = created.ok ? created.value.sessionId : '';
    expect(await registry.list(ALICE_A)).toHaveLength(1);
    const controlledRun = { ...runRecord(), controller: { ...ALICE_A }, claimRevision: 8 } as SessionRecord;
    document.sessions.push(controlledRun);

    const sink = { data: vi.fn(), exit: vi.fn(), closed: () => false };
    for (const foreign of [ALICE_B, BOB_A]) {
      expect(await registry.list(foreign)).toEqual([]);
      expect(await registry.attach(foreign, sessionId, sink)).toMatchObject({ ok: false, refusal: 'not-found' });
      expect(await registry.write(foreign, sessionId, new Uint8Array([1]))).toMatchObject({ ok: false, refusal: 'not-found' });
      expect(await registry.resize(foreign, sessionId, { cols: 90, rows: 30 })).toMatchObject({ ok: false, refusal: 'not-found' });
      expect(await registry.close(foreign, sessionId)).toMatchObject({ ok: false, refusal: 'not-found' });
      expect(await registry.claimRunController(foreign, {
        runRef: 'run-a', sessionId: controlledRun.sessionId, expectedRunVersion: 4, expectedSessionRevision: 7,
      })).toMatchObject({ ok: false, refusal: 'not-found' });
    }
    expect('detach' in registry).toBe(false);
    const attached = await registry.attach(ALICE_A, sessionId, sink);
    expect(attached).toMatchObject({ ok: true, value: { session: { attachmentCount: 1 } } });
    if (attached.ok) await attached.value.detach();
    expect((await registry.list(ALICE_A))[0]).toMatchObject({ attachmentCount: 0, attachmentState: 'detached' });
    expect(close).not.toHaveBeenCalled();
    expect(await registry.write(ALICE_A, sessionId, new Uint8Array([1, 2]))).toMatchObject({ ok: true, value: { accepted: 2 } });
    expect(await registry.resize(ALICE_A, sessionId, { cols: 90, rows: 30 })).toMatchObject({ ok: true });

    expect(Object.getOwnPropertyNames(registry)).not.toContain('deploymentCloser');
    expect(Object.values(registry)).not.toContain(deploymentCloser);
    expect(deploymentCloser).toBeTypeOf('function');
    await expect(deploymentCloser?.([sessionId])).resolves.toMatchObject({ ok: true, value: { closed: [sessionId] } });
    expect(close).toHaveBeenCalledWith(sessionId);
  });

  it('deployment closer casts', () => {
    let installed: unknown;
    const persistence: SessionPersistence = {
      read: createEmptyPtySessionsDocument,
      mutate: async () => { throw new Error('not used'); },
    };
    const registry = createSessionRecordRegistry({
      persistence,
      host: {} as SessionHost,
      installDeploymentCloser: (closer) => { installed = closer; },
    });
    const cast = registry as unknown as Record<string, unknown>;
    expect(cast.deploymentCloser).toBeUndefined();
    expect(cast.closeAll).toBeUndefined();
    expect(Object.values(cast)).not.toContain(installed);
  });
});
