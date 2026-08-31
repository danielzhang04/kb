import { mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import type { AttemptOperationRecord, OperationReceipt, PtySessionsDocumentV2,
  SessionRecord } from './contracts.ts';
import {
  applyEpochAbandonment,
  applyObservedSessionExit,
  assertPtySessionsDocumentV2,
  beginOperationReceipt,
  createEmptyPtySessionsDocument,
  createSessionPersistence,
  createTranscriptRetention,
  enforcePtySessionRetention,
  insertSessionRecord,
  MAX_TERMINAL_ATTEMPT_OPERATIONS,
  settleOperationReceipt,
} from './sessionPersistence.ts';

const NOW = '2026-08-23T12:00:00.000Z';
const OPERATION_KEY = `op-${'1'.repeat(64)}`;
const SESSION_ID = `pty-${'2'.repeat(32)}`;
const EPOCH_ID = `epoch-${'3'.repeat(32)}`;
const REQUEST_HASH = '4'.repeat(64);

function manualRecord(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    sessionId: SESSION_ID,
    operationKey: OPERATION_KEY,
    requestHash: REQUEST_HASH,
    recipeDigest: '5'.repeat(64),
    launcher: 'shell',
    host: 'desktop',
    rootId: 'repo',
    relativeCwd: '',
    name: 'Shell',
    attachmentIds: [],
    transcript: { path: 'pty/transcripts/session.log', bytes: 0, truncated: false, lastSequence: 0 },
    startedAt: NOW,
    endedAt: null,
    revision: 0,
    provenance: 'manual',
    controller: { operator: 'alice', browserSessionRef: Buffer.alloc(32, 1).toString('base64url') },
    state: 'live',
    epochId: EPOCH_ID,
    exit: null,
    ...overrides,
  } as SessionRecord;
}

describe('strict PTY v2 persistence', () => {
  it('accepts only the exact v2 document and closed record discriminants', () => {
    const document = createEmptyPtySessionsDocument();
    document.sessions.push(manualRecord());
    expect(() => assertPtySessionsDocumentV2(document)).not.toThrow();
    expect(() => assertPtySessionsDocumentV2({ ...document, extra: true })).toThrow(/invalid/i);
    expect(() => assertPtySessionsDocumentV2({
      ...document,
      sessions: [{ ...manualRecord(), controller: null }],
    })).toThrow(/invalid/i);
    expect(() => assertPtySessionsDocumentV2({
      ...document,
      sessions: [{ ...manualRecord(), state: 'exited', exit: null }],
    })).toThrow(/invalid/i);
  });

  it('uses canonical control ref decoding and rejects orphaned binding/receipt relations', () => {
    const run = {
      ...manualRecord(),
      provenance: 'run',
      controller: null,
      operator: 'alice',
      runRef: 'run-a',
      attemptRef: 'attempt-a',
      managedSessionRef: 'managed-a',
    } as SessionRecord;
    const binding = { operator: 'alice', runRef: 'run-a', attemptRef: 'attempt-a',
      managedSessionRef: 'managed-a', sessionId: SESSION_ID, createdAt: NOW };
    const receipt: OperationReceipt = { operationKey: OPERATION_KEY, requestHash: REQUEST_HASH,
      status: 'bound', sessionId: SESSION_ID, attemptRef: 'attempt-a', refusal: null,
      createdAt: NOW, settledAt: NOW };
    const valid = { ...createEmptyPtySessionsDocument(), sessions: [run],
      attemptBindings: [binding], operationReceipts: [receipt] };
    expect(() => assertPtySessionsDocumentV2(valid)).not.toThrow();
    expect(() => assertPtySessionsDocumentV2({ ...valid, sessions: [] })).toThrow(/invalid/i);
    expect(() => assertPtySessionsDocumentV2({ ...valid, attemptBindings: [], sessions: [],
      operationReceipts: [{ ...receipt, sessionId: `pty-${'f'.repeat(32)}` }] })).toThrow(/invalid/i);
    expect(() => assertPtySessionsDocumentV2({ ...valid,
      sessions: [{ ...run, runRef: 'run:colon' }],
      attemptBindings: [{ ...binding, runRef: 'run:colon' }] })).toThrow(/invalid/i);
  });

  it('preserves abandonment precedence over a late old-epoch exit', () => {
    const document = createEmptyPtySessionsDocument();
    document.sessions.push(manualRecord());

    expect(applyEpochAbandonment(document, EPOCH_ID, 'epoch-lost', NOW)).toBe(1);
    expect(applyObservedSessionExit(document, {
      sessionId: SESSION_ID,
      sequence: 2,
      exitCode: 0,
      signal: null,
      reason: 'exited',
      observedAt: '2026-08-23T12:00:01.000Z',
    }, EPOCH_ID)).toBe(false);
    expect(document.sessions[0]).toMatchObject({
      state: 'abandoned',
      abandonReason: 'epoch-lost',
      revision: 1,
      exit: { reason: 'abandoned' },
    });
  });

  it('caps receipts and sessions without evicting live or pending entries', () => {
    const document = createEmptyPtySessionsDocument();
    document.sessions = Array.from({ length: 501 }, (_, index) => manualRecord({
      sessionId: `pty-${index.toString(16).padStart(32, '0')}`,
      operationKey: `op-${index.toString(16).padStart(64, '0')}`,
      requestHash: index.toString(16).padStart(64, '0'),
      recipeDigest: index.toString(16).padStart(64, '0'),
      ...(index === 0 ? {} : {
        state: 'exited',
        endedAt: NOW,
        exit: { sessionId: `pty-${index.toString(16).padStart(32, '0')}`, sequence: 1,
          exitCode: 0, signal: null, reason: 'exited', observedAt: NOW },
      }),
    }));
    const pending: OperationReceipt = {
      operationKey: OPERATION_KEY,
      requestHash: REQUEST_HASH,
      status: 'pending',
      sessionId: null,
      attemptRef: null,
      refusal: null,
      createdAt: NOW,
      settledAt: null,
    };
    // Real `bound` receipts naming real sessions — the shape the referential check governs and
    // the exact shape a `sessionId: null` fixture could never exercise (D1).
    const bound = document.sessions.map((session): OperationReceipt => ({
      operationKey: session.operationKey,
      requestHash: session.requestHash,
      status: 'bound',
      sessionId: session.sessionId,
      attemptRef: null,
      refusal: null,
      createdAt: NOW,
      settledAt: NOW,
    }));
    const filler = Array.from({ length: 1_000 }, (_, index) => ({
      ...pending,
      operationKey: `op-${'f'.repeat(48)}${index.toString(16).padStart(16, '0')}`,
      requestHash: `f${index.toString(16).padStart(63, '0')}`,
      status: 'failed' as const,
      refusal: 'internal' as const,
      settledAt: NOW,
    }));
    document.operationReceipts = [pending, ...bound, ...filler];
    const evicted = document.sessions[1] as SessionRecord;

    enforcePtySessionRetention(document);
    expect(document.sessions).toHaveLength(500);
    expect(document.sessions.filter((record) => record.state === 'live')).toHaveLength(1);
    expect(document.operationReceipts).toHaveLength(1_000);
    expect(document.operationReceipts).toContainEqual(pending);
    // The evicted session's receipt leaves with it; the surviving 500 bound receipts stay.
    expect(document.operationReceipts.some((receipt) => receipt.sessionId === evicted.sessionId)).toBe(false);
    expect(document.operationReceipts.filter((receipt) => receipt.status === 'bound')).toHaveLength(500);
    // The document produced at the 500-session boundary must still satisfy the strict validator,
    // or every later create fails permanently inside mutate().
    expect(() => assertPtySessionsDocumentV2(document)).not.toThrow();
  });

  it('drops a bound receipt with its evicted session at the 500-session boundary', () => {
    // No receipt-cap pressure here: 501 receipts stay far under MAX_OPERATION_RECEIPTS, so the
    // only thing that can remove the orphan is session eviction itself.
    const document = createEmptyPtySessionsDocument();
    document.sessions = Array.from({ length: 501 }, (_, index) => manualRecord({
      sessionId: `pty-${index.toString(16).padStart(32, '0')}`,
      operationKey: `op-${index.toString(16).padStart(64, '0')}`,
      requestHash: index.toString(16).padStart(64, '0'),
      recipeDigest: index.toString(16).padStart(64, '0'),
      ...(index === 0 ? {} : {
        state: 'exited',
        endedAt: NOW,
        exit: { sessionId: `pty-${index.toString(16).padStart(32, '0')}`, sequence: 1,
          exitCode: 0, signal: null, reason: 'exited', observedAt: NOW },
      }),
    }));
    document.operationReceipts = document.sessions.map((session): OperationReceipt => ({
      operationKey: session.operationKey,
      requestHash: session.requestHash,
      status: 'bound',
      sessionId: session.sessionId,
      attemptRef: null,
      refusal: null,
      createdAt: NOW,
      settledAt: NOW,
    }));
    const evicted = document.sessions[1] as SessionRecord;

    enforcePtySessionRetention(document);
    expect(document.sessions).toHaveLength(500);
    expect(document.operationReceipts).toHaveLength(500);
    expect(document.operationReceipts.some((receipt) => receipt.sessionId === evicted.sessionId)).toBe(false);
    // Without this the referential check refuses the document and every later create fails forever.
    expect(() => assertPtySessionsDocumentV2(document)).not.toThrow();
  });

  it('evicts attempt operations with their session and caps terminal rows oldest-first', () => {
    const document = createEmptyPtySessionsDocument();
    const operation = (index: number, overrides: Partial<AttemptOperationRecord> = {}): AttemptOperationRecord => ({
      operationKey: `op-${index.toString(16).padStart(64, '0')}`,
      requestHash: index.toString(16).padStart(64, '0'),
      status: 'completed',
      promptsDelivered: 0,
      sessionId: null,
      attemptRef: null,
      receipt: null,
      revision: 1,
      updatedAt: new Date(Date.parse(NOW) + index * 1_000).toISOString(),
      ...overrides,
    });
    document.sessions = Array.from({ length: 501 }, (_, index) => manualRecord({
      sessionId: `pty-${index.toString(16).padStart(32, '0')}`,
      operationKey: `op-${'e'.repeat(48)}${index.toString(16).padStart(16, '0')}`,
      requestHash: `e${index.toString(16).padStart(63, '0')}`,
      ...(index === 0 ? {} : {
        state: 'exited',
        endedAt: NOW,
        exit: { sessionId: `pty-${index.toString(16).padStart(32, '0')}`, sequence: 1,
          exitCode: 0, signal: null, reason: 'exited', observedAt: NOW },
      }),
    }));
    const evicted = document.sessions[1] as SessionRecord;
    for (let index = 0; index < MAX_TERMINAL_ATTEMPT_OPERATIONS + 4; index += 1) {
      document.attemptOperations[operation(index).operationKey] = operation(index);
    }
    // Two rows that must survive the terminal cap for different reasons.
    document.attemptOperations[operation(9_001).operationKey] = operation(9_001, { status: 'pending' });
    document.attemptOperations[operation(9_002).operationKey] =
      operation(9_002, { sessionId: evicted.sessionId, status: 'bound' });

    enforcePtySessionRetention(document);
    const remaining = Object.values(document.attemptOperations);
    expect(remaining.filter((row) => row.status === 'completed')).toHaveLength(MAX_TERMINAL_ATTEMPT_OPERATIONS);
    // Oldest-first: the four earliest terminal rows went, the newest stayed.
    expect(document.attemptOperations[operation(0).operationKey]).toBeUndefined();
    expect(document.attemptOperations[operation(3).operationKey]).toBeUndefined();
    expect(document.attemptOperations[operation(4).operationKey]).toBeDefined();
    expect(document.attemptOperations[operation(9_001).operationKey]).toBeDefined();
    // The row naming the evicted session left with it, so the referential check still holds.
    expect(document.attemptOperations[operation(9_002).operationKey]).toBeUndefined();
    expect(() => assertPtySessionsDocumentV2(document)).not.toThrow();
  });

  it('accepts only exact attempt-operation rows and refuses dangling session references', () => {
    const document = createEmptyPtySessionsDocument();
    document.sessions.push(manualRecord());
    const operation: AttemptOperationRecord = {
      operationKey: `op-${'a'.repeat(64)}`,
      requestHash: 'b'.repeat(64),
      status: 'bound',
      promptsDelivered: 2,
      sessionId: SESSION_ID,
      attemptRef: 'attempt-a',
      receipt: null,
      revision: 3,
      updatedAt: NOW,
    };
    const withOperation = (row: unknown, key = operation.operationKey) => ({
      ...document, attemptOperations: { [key]: row },
    });
    expect(() => assertPtySessionsDocumentV2(withOperation(operation))).not.toThrow();
    expect(() => assertPtySessionsDocumentV2({ ...document, attemptOperations: [] })).toThrow(/invalid/i);
    expect(() => assertPtySessionsDocumentV2(withOperation({ ...operation, extra: true }))).toThrow(/invalid/i);
    expect(() => assertPtySessionsDocumentV2(withOperation({ ...operation, status: 'settled' }))).toThrow(/invalid/i);
    expect(() => assertPtySessionsDocumentV2(withOperation({ ...operation, promptsDelivered: -1 }))).toThrow(/invalid/i);
    // The map key must be the row's own operationKey.
    expect(() => assertPtySessionsDocumentV2(withOperation(operation, `op-${'c'.repeat(64)}`))).toThrow(/invalid/i);
    // Referential: a non-null sessionId must name a session that still exists.
    expect(() => assertPtySessionsDocumentV2(withOperation({ ...operation,
      sessionId: `pty-${'d'.repeat(32)}` }))).toThrow(/invalid/i);
    expect(() => assertPtySessionsDocumentV2(withOperation({ ...operation, sessionId: null }))).not.toThrow();
  });

  it('keeps sessions in startedAt order when a launch binds out of order', () => {
    const document = createEmptyPtySessionsDocument();
    const later = manualRecord({ sessionId: `pty-${'1'.repeat(32)}`,
      operationKey: `op-${'1'.repeat(64)}`, startedAt: '2026-08-23T12:00:02.000Z' });
    const earlier = manualRecord({ sessionId: `pty-${'2'.repeat(32)}`,
      operationKey: `op-${'2'.repeat(64)}`, startedAt: '2026-08-23T12:00:01.000Z' });
    insertSessionRecord(document, later);
    insertSessionRecord(document, earlier);
    expect(document.sessions.map((record) => record.startedAt))
      .toEqual(['2026-08-23T12:00:01.000Z', '2026-08-23T12:00:02.000Z']);
    // Appending instead would break the validator's ordering invariant and refuse the create.
    expect(() => assertPtySessionsDocumentV2(document)).not.toThrow();
    expect(() => assertPtySessionsDocumentV2({ ...document, sessions: [earlier, later].reverse() }))
      .toThrow(/invalid/i);
  });

  it('replays exact operation receipts and conflicts changed requests or settlements', () => {
    const document = createEmptyPtySessionsDocument();
    expect(beginOperationReceipt(document, {
      operationKey: OPERATION_KEY, requestHash: REQUEST_HASH, attemptRef: null, createdAt: NOW,
    })).toMatchObject({ ok: true, value: { replayed: false } });
    expect(beginOperationReceipt(document, {
      operationKey: OPERATION_KEY, requestHash: REQUEST_HASH, attemptRef: null, createdAt: NOW,
    })).toMatchObject({ ok: true, value: { replayed: true } });
    expect(beginOperationReceipt(document, {
      operationKey: OPERATION_KEY, requestHash: 'a'.repeat(64), attemptRef: null, createdAt: NOW,
    })).toMatchObject({ ok: false, refusal: 'binding-conflict' });
    expect(settleOperationReceipt(document, {
      operationKey: OPERATION_KEY, requestHash: REQUEST_HASH, status: 'bound', sessionId: SESSION_ID,
      refusal: null, settledAt: NOW,
    })).toMatchObject({ ok: true, value: { replayed: false } });
    expect(settleOperationReceipt(document, {
      operationKey: OPERATION_KEY, requestHash: REQUEST_HASH, status: 'failed', sessionId: null,
      refusal: 'internal', settledAt: NOW,
    })).toMatchObject({ ok: false, refusal: 'binding-conflict' });
  });

  it('retains the bounded raw transcript tail and advances its sequence metadata', () => {
    const root = mkdtempSync(join(tmpdir(), 'kb-pty-transcript-'));
    try {
      const retention = createTranscriptRetention(root, 4);
      // [C-R6]: the caller passes the frame's BYTE OFFSET and gets back the cumulative byte total, so
      // the retained window is always `[lastSequence - bytes, lastSequence)` — here [2, 6) after the
      // second append, which is exactly the four bytes left on disk.
      expect(retention.append(SESSION_ID, 0, new Uint8Array([1, 2, 3]))).toMatchObject({
        bytes: 3, truncated: false, lastSequence: 3,
      });
      expect(retention.append(SESSION_ID, 3, new Uint8Array([4, 5, 6]))).toMatchObject({
        bytes: 4, truncated: true, lastSequence: 6,
      });
      expect([...readFileSync(join(root, 'pty', 'transcripts', `${SESSION_ID}.raw`))]).toEqual([3, 4, 5, 6]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('appends without rewriting the file and compacts only when the tail is truncated', () => {
    const root = mkdtempSync(join(tmpdir(), 'kb-pty-transcript-append-'));
    try {
      const rename = vi.fn(renameSync);
      const retention = createTranscriptRetention(root, 16, { rename });
      for (let frame = 1; frame <= 5; frame += 1) {
        expect(retention.append(SESSION_ID, (frame - 1) * 3, new Uint8Array([frame, frame, frame])))
          .toMatchObject({ bytes: frame * 3, truncated: false, lastSequence: frame * 3 });
      }
      // Five frames, zero atomic rewrites: an append is an fsync'd append, not a full-file rewrite.
      expect(rename).toHaveBeenCalledTimes(0);
      expect(readFileSync(join(root, 'pty', 'transcripts', `${SESSION_ID}.raw`))).toHaveLength(15);

      expect(retention.append(SESSION_ID, 15, new Uint8Array([6, 6, 6])))
        .toMatchObject({ bytes: 16, truncated: true, lastSequence: 18 });
      // Exactly one rename across all six appends: compaction happens on truncation only.
      expect(rename).toHaveBeenCalledTimes(1);
      expect([...readFileSync(join(root, 'pty', 'transcripts', `${SESSION_ID}.raw`))])
        .toEqual([1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps the published transcript intact when atomic rename fails', () => {
    const root = mkdtempSync(join(tmpdir(), 'kb-pty-transcript-rename-'));
    try {
      createTranscriptRetention(root, 4).append(SESSION_ID, 1, new Uint8Array([1, 2, 3]));
      const rename = vi.fn(() => { throw new Error('simulated rename interruption'); });
      const retention = createTranscriptRetention(root, 4, { rename });

      expect(() => retention.append(SESSION_ID, 2, new Uint8Array([4, 5, 6]))).toThrow(/rename interruption/);
      expect(rename).toHaveBeenCalledTimes(1);
      expect([...readFileSync(join(root, 'pty', 'transcripts', `${SESSION_ID}.raw`))]).toEqual([1, 2, 3]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('awaits asynchronous persistence callbacks before commit', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kb-pty-persistence-'));
    try {
      const persistence = createSessionPersistence(root);
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      let settled = false;
      const mutation = persistence.mutate(0, async (document) => {
        await gate;
        document.legacyArchiveKeys.push({ key: 'awaited', sessionRunRef: 'legacy', reason: null });
      }).then(() => { settled = true; });
      await Promise.resolve();
      expect(settled).toBe(false);
      release();
      await mutation;
      expect(persistence.read()).toMatchObject({ revision: 1,
        legacyArchiveKeys: [{ key: 'awaited', sessionRunRef: 'legacy', reason: null }] });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('record compile-negative shapes', () => {
  it('keeps manual and run controller/state records discriminated', () => {
    const base = manualRecord();
    const valid: PtySessionsDocumentV2 = { ...createEmptyPtySessionsDocument(), sessions: [base] };
    expect(valid.sessions).toHaveLength(1);

    // @ts-expect-error manual records cannot have a null controller
    const manualNull: SessionRecord = { ...base, controller: null };
    // @ts-expect-error manual records cannot carry Run provenance
    const manualRun: SessionRecord = { ...base, runRef: 'run-a' };
    // @ts-expect-error unclaimed Run records cannot carry a claim revision
    const unclaimedClaim: SessionRecord = { ...base, provenance: 'run', controller: null,
      operator: 'alice', runRef: 'run-a', attemptRef: 'attempt-a', managedSessionRef: 'managed-a', claimRevision: 1 };
    // @ts-expect-error claimed Run records require claimRevision
    const claimedWithoutRevision: SessionRecord = { ...base, provenance: 'run', controller: {
      operator: 'alice', browserSessionRef: Buffer.alloc(32, 1).toString('base64url') },
      operator: 'alice', runRef: 'run-a', attemptRef: 'attempt-a', managedSessionRef: 'managed-a' };
    // @ts-expect-error exited records require a non-null ObservedExit
    const exitedWithoutResult: SessionRecord = { ...base, state: 'exited', endedAt: NOW, exit: null };
    expect([manualNull, manualRun, unclaimedClaim, claimedWithoutRevision, exitedWithoutResult]).toHaveLength(5);
  });
});
