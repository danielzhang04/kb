import { randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

import { isBrowserSessionRef } from '../auth/browserSessionRef.ts';
import { renameWithRetrySync } from '../atomicRename.ts';
import { createAtomicJsonDocument } from '../control/atomicJsonDocument.ts';
import type { AtomicJsonDocument } from '../control/atomicJsonDocument.ts';
import { decodeRunnableRef } from '../control/p2Decoders.ts';
import type {
  ArchiveKeyEntry,
  AttemptBinding,
  AttemptOperationRecord,
  ObservedExit,
  OperationReceipt,
  PtySessionsDocumentV2,
  SessionRecord,
  SessionRecordBase,
} from './contracts.ts';
import type { HostRefusalCode, PortResult } from './contracts.ts';

export const PTY_SESSIONS_SCHEMA = 'kb.pty-sessions/v2' as const;
export const MAX_PTY_DOCUMENT_BYTES = 4_000_000;
export const MAX_RETAINED_SESSIONS = 500;
export const MAX_ATTEMPT_BINDINGS = 500;
export const MAX_OPERATION_RECEIPTS = 1_000;
/** Hard document cap for the durable attempt-operation map. */
export const MAX_ATTEMPT_OPERATIONS = 1_024;
/** Terminal attempt operations retained; older terminal rows are evicted first. */
export const MAX_TERMINAL_ATTEMPT_OPERATIONS = 256;
const TERMINAL_ATTEMPT_OPERATION_STATES = new Set(['cancelled', 'failed', 'completed']);
const ATTEMPT_OPERATION_STATES = ['pending', 'bound', 'cancelled', 'failed', 'completed'];
export const MAX_LEGACY_RUNS = 500;
export const MAX_LEGACY_ARCHIVE_KEYS = 512;
export const DEFAULT_TRANSCRIPT_BYTES = 512_000;

const SESSION_ID_RE = /^pty-[0-9a-f]{32}$/;
const OPERATION_KEY_RE = /^op-[0-9a-f]{64}$/;
const EPOCH_ID_RE = /^epoch-[0-9a-f]{32}$/;
const ATTACHMENT_ID_RE = /^att-[0-9a-f]{32}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const SESSION_RUN_REF_RE = /^srun-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UNSAFE_TEXT_RE = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\u2028\u2029]/u;
const WINDOWS_RESERVED_RE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const ACTIVE_STATES = new Set(['starting', 'live', 'closing']);
const REFUSALS = new Set([
  'unavailable', 'capacity', 'invalid-request', 'unsafe-root', 'unsafe-cwd',
  'launcher-unavailable', 'input-too-large', 'size-out-of-range', 'not-found',
  'binding-conflict', 'epoch-lost', 'cancelled', 'internal',
]);

export type PtySessionPersistenceErrorCode = 'invalid-input' | 'document-unavailable'
  | 'revision-conflict' | 'capacity';

export class PtySessionPersistenceError extends Error {
  readonly code: PtySessionPersistenceErrorCode;

  constructor(code: PtySessionPersistenceErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'PtySessionPersistenceError';
  }
}

function fail(message = 'PTY session document is invalid'): never {
  throw new PtySessionPersistenceError('document-unavailable', message);
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function safeInteger(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function timestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 40) return false;
  const millis = Date.parse(value);
  return Number.isFinite(millis) && new Date(millis).toISOString() === value;
}

function legacyTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value));
}

function boundedText(value: unknown, maximumBytes: number, allowEmpty = false): value is string {
  return typeof value === 'string' && (allowEmpty || value.length > 0)
    && Buffer.byteLength(value, 'utf8') <= maximumBytes && !UNSAFE_TEXT_RE.test(value);
}

function safeRef(value: unknown): value is string {
  return typeof value === 'string' && decodeRunnableRef({
    type: 'agent',
    id: value,
    sourcePath: `agents/${value}.md`,
  }) !== null;
}

function relativeCwd(value: unknown): value is string {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 240 || UNSAFE_TEXT_RE.test(value)) return false;
  if (value === '') return true;
  if (value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) return false;
  return value.split('/').every((part) => part !== '' && part !== '.' && part !== '..'
    && !part.endsWith('.') && !part.endsWith(' ') && !WINDOWS_RESERVED_RE.test(part));
}

function assertController(value: unknown): asserts value is { operator: string; browserSessionRef: string } {
  const item = object(value);
  if (item === null || !exactKeys(item, ['operator', 'browserSessionRef'])
    || !boundedText(item.operator, 160) || !isBrowserSessionRef(item.browserSessionRef)) fail();
}

function assertExit(value: unknown, sessionId: string, abandonedOnly = false): asserts value is ObservedExit {
  const item = object(value);
  if (item === null || !exactKeys(item, ['sessionId', 'sequence', 'exitCode', 'signal', 'reason', 'observedAt'])
    || item.sessionId !== sessionId || !safeInteger(item.sequence)
    || !(item.exitCode === null || safeInteger(item.exitCode, -2_147_483_648, 2_147_483_647))
    || !(item.signal === null || safeInteger(item.signal, 0, 255))
    || !['exited', 'closed', 'abandoned'].includes(item.reason as string)
    || (abandonedOnly && item.reason !== 'abandoned') || !timestamp(item.observedAt)) fail();
}

function assertTranscript(value: unknown): void {
  const item = object(value);
  if (item === null || !exactKeys(item, ['path', 'bytes', 'truncated', 'lastSequence'])
    || !boundedText(item.path, 1_024)
    || !safeInteger(item.bytes, 0, 1_073_741_824) || typeof item.truncated !== 'boolean'
    || !safeInteger(item.lastSequence)) fail();
}

function assertSessionRecord(value: unknown): asserts value is SessionRecord {
  const item = object(value);
  if (item === null) fail();
  const common = [
    'sessionId', 'operationKey', 'requestHash', 'recipeDigest', 'launcher', 'host', 'rootId',
    'relativeCwd', 'name', 'attachmentIds', 'transcript', 'startedAt', 'endedAt', 'revision',
    'provenance', 'controller', 'state', 'epochId', 'exit',
  ];
  const provenanceKeys = item.provenance === 'run'
    ? ['operator', 'runRef', 'attemptRef', 'managedSessionRef', ...(item.controller === null ? [] : ['claimRevision'])]
    : [];
  const stateKeys = item.state === 'abandoned' ? ['abandonReason'] : [];
  if (!exactKeys(item, [...common, ...provenanceKeys, ...stateKeys])
    || typeof item.sessionId !== 'string' || !SESSION_ID_RE.test(item.sessionId)
    || typeof item.operationKey !== 'string' || !OPERATION_KEY_RE.test(item.operationKey)
    || typeof item.requestHash !== 'string' || !SHA256_RE.test(item.requestHash)
    || typeof item.recipeDigest !== 'string' || !SHA256_RE.test(item.recipeDigest)
    || !['shell', 'claude', 'codex'].includes(item.launcher as string)
    || !['desktop', 'vm'].includes(item.host as string) || !['repo', 'worktrees'].includes(item.rootId as string)
    || !relativeCwd(item.relativeCwd) || !boundedText(item.name, 80)
    || !Array.isArray(item.attachmentIds) || item.attachmentIds.length > 64
    || item.attachmentIds.some((id) => typeof id !== 'string' || !ATTACHMENT_ID_RE.test(id))
    || new Set(item.attachmentIds).size !== item.attachmentIds.length
    || !timestamp(item.startedAt) || !(item.endedAt === null || timestamp(item.endedAt))
    || !safeInteger(item.revision) || typeof item.epochId !== 'string' || !EPOCH_ID_RE.test(item.epochId)) fail();
  assertTranscript(item.transcript);

  if (item.provenance === 'manual') {
    assertController(item.controller);
  } else if (item.provenance === 'run') {
    if (!boundedText(item.operator, 160) || !safeRef(item.runRef) || !safeRef(item.attemptRef)
      || !safeRef(item.managedSessionRef)) fail();
    if (item.controller === null) {
      if ('claimRevision' in item) fail();
    } else {
      assertController(item.controller);
      if (item.controller.operator !== item.operator || !safeInteger(item.claimRevision)) fail();
    }
  } else fail();

  if (ACTIVE_STATES.has(item.state as string)) {
    if (item.exit !== null || item.endedAt !== null) fail();
  } else if (item.state === 'exited') {
    if (item.exit === null || item.endedAt === null) fail();
    assertExit(item.exit, item.sessionId);
    if (item.exit.reason === 'abandoned') fail();
  } else if (item.state === 'abandoned') {
    if (!['epoch-lost', 'daemon-restart', 'start-recovery'].includes(item.abandonReason as string)
      || item.exit === null || item.endedAt === null) fail();
    assertExit(item.exit, item.sessionId, true);
  } else fail();
}

function assertAttemptBinding(value: unknown): asserts value is AttemptBinding {
  const item = object(value);
  if (item === null || !exactKeys(item, ['operator', 'runRef', 'attemptRef', 'managedSessionRef', 'sessionId', 'createdAt'])
    || !boundedText(item.operator, 160) || !safeRef(item.runRef) || !safeRef(item.attemptRef)
    || !safeRef(item.managedSessionRef) || typeof item.sessionId !== 'string'
    || !SESSION_ID_RE.test(item.sessionId) || !timestamp(item.createdAt)) fail();
}

function assertReceipt(value: unknown): asserts value is OperationReceipt {
  const item = object(value);
  if (item === null || !exactKeys(item, ['operationKey', 'requestHash', 'status', 'sessionId', 'attemptRef',
    'refusal', 'createdAt', 'settledAt']) || typeof item.operationKey !== 'string'
    || !OPERATION_KEY_RE.test(item.operationKey) || typeof item.requestHash !== 'string'
    || !SHA256_RE.test(item.requestHash) || !['pending', 'bound', 'failed', 'cancelled'].includes(item.status as string)
    || !(item.sessionId === null || (typeof item.sessionId === 'string' && SESSION_ID_RE.test(item.sessionId)))
    || !(item.attemptRef === null || safeRef(item.attemptRef))
    || !(item.refusal === null || REFUSALS.has(item.refusal as string))
    || !timestamp(item.createdAt) || !(item.settledAt === null || timestamp(item.settledAt))) fail();
  if (item.status === 'pending' && (item.settledAt !== null || item.refusal !== null)) fail();
  if (item.status === 'bound' && (item.sessionId === null || item.settledAt === null || item.refusal !== null)) fail();
  if (item.status === 'failed' && (item.refusal === null || item.settledAt === null)) fail();
  if (item.status === 'cancelled' && (item.refusal !== 'cancelled' || item.settledAt === null)) fail();
}

function assertAttemptOperation(key: unknown, value: unknown): asserts value is AttemptOperationRecord {
  const item = object(value);
  if (item === null || !exactKeys(item, ['operationKey', 'requestHash', 'status', 'promptsDelivered',
    'sessionId', 'attemptRef', 'receipt', 'revision', 'updatedAt'])
    || typeof item.operationKey !== 'string' || !OPERATION_KEY_RE.test(item.operationKey)
    || item.operationKey !== key
    || typeof item.requestHash !== 'string' || !SHA256_RE.test(item.requestHash)
    || !ATTEMPT_OPERATION_STATES.includes(item.status as string)
    || !safeInteger(item.promptsDelivered, 0, 1_000_000)
    || !(item.sessionId === null || (typeof item.sessionId === 'string' && SESSION_ID_RE.test(item.sessionId)))
    || !(item.attemptRef === null || safeRef(item.attemptRef))
    || !safeInteger(item.revision) || !timestamp(item.updatedAt)) fail();
  if (item.receipt !== null) {
    assertReceipt(item.receipt);
    if (item.receipt.operationKey !== item.operationKey
      || item.receipt.requestHash !== item.requestHash) fail();
  }
}

function assertLegacyRun(value: unknown): void {
  const item = object(value);
  if (item === null || !exactKeys(item, ['sessionRunRef', 'kind', 'targetRef', 'owner', 'ptySessionId',
    'primingPath', 'startedAt', 'endedAt', 'outcome', 'exitCode', 'transcript', 'version'])
    || typeof item.sessionRunRef !== 'string' || !SESSION_RUN_REF_RE.test(item.sessionRunRef)
    || !['agent', 'workflow'].includes(item.kind as string)
    || typeof item.targetRef !== 'string' || item.targetRef.length === 0
    || typeof item.owner !== 'string' || item.owner.length === 0
    || !(item.ptySessionId === null || typeof item.ptySessionId === 'string')
    || !(item.primingPath === null || typeof item.primingPath === 'string')
    || !legacyTimestamp(item.startedAt) || !(item.endedAt === null || legacyTimestamp(item.endedAt))
    || !['live', 'ended', 'abandoned', 'archived'].includes(item.outcome as string)
    || !(item.exitCode === null || (typeof item.exitCode === 'number' && Number.isFinite(item.exitCode)))
    || !safeInteger(item.version, 1)) fail();
  if (item.transcript !== null) {
    const transcript = object(item.transcript);
    if (transcript === null || !exactKeys(transcript, ['path', 'bytes', 'truncated'])
      || typeof transcript.path !== 'string'
      || typeof transcript.bytes !== 'number' || !Number.isFinite(transcript.bytes)
      || typeof transcript.truncated !== 'boolean') fail();
  }
}

function assertArchiveKey(value: unknown): asserts value is ArchiveKeyEntry {
  const item = object(value);
  if (item === null || !exactKeys(item, ['key', 'sessionRunRef', 'reason'])
    || typeof item.key !== 'string' || typeof item.sessionRunRef !== 'string'
    || !(item.reason === null || typeof item.reason === 'string')) fail();
}

export function assertPtySessionsDocumentV2(value: unknown): asserts value is PtySessionsDocumentV2 {
  const document = object(value);
  if (document === null || !exactKeys(document, ['schema', 'revision', 'sessions', 'attemptBindings',
    'operationReceipts', 'attemptOperations', 'legacyRuns', 'legacyArchiveKeys'])
    || document.schema !== PTY_SESSIONS_SCHEMA
    || !safeInteger(document.revision) || !Array.isArray(document.sessions)
    || !Array.isArray(document.attemptBindings) || !Array.isArray(document.operationReceipts)
    || object(document.attemptOperations) === null
    || !Array.isArray(document.legacyRuns) || !Array.isArray(document.legacyArchiveKeys)
    || document.sessions.length > MAX_RETAINED_SESSIONS || document.attemptBindings.length > MAX_ATTEMPT_BINDINGS
    || document.operationReceipts.length > MAX_OPERATION_RECEIPTS
    || Object.keys(document.attemptOperations as object).length > MAX_ATTEMPT_OPERATIONS
    || document.legacyRuns.length > MAX_LEGACY_RUNS
    || document.legacyArchiveKeys.length > MAX_LEGACY_ARCHIVE_KEYS) fail();
  const attemptOperations = document.attemptOperations as Record<string, unknown>;
  if (Object.getPrototypeOf(attemptOperations) !== Object.prototype) fail();
  for (const [key, operation] of Object.entries(attemptOperations)) assertAttemptOperation(key, operation);
  document.sessions.forEach(assertSessionRecord);
  document.attemptBindings.forEach(assertAttemptBinding);
  document.operationReceipts.forEach(assertReceipt);
  document.legacyRuns.forEach(assertLegacyRun);
  document.legacyArchiveKeys.forEach(assertArchiveKey);

  const unique = (values: unknown[]): boolean => new Set(values).size === values.length;
  if (!unique(document.sessions.map((item) => item.sessionId))
    || !unique(document.sessions.map((item) => item.operationKey))
    || !unique(document.attemptBindings.map((item) => item.attemptRef))
    || !unique(document.attemptBindings.map((item) => item.managedSessionRef))
    || !unique(document.attemptBindings.map((item) => item.sessionId))
    || !unique(document.operationReceipts.map((item) => item.operationKey))
    || !unique(document.legacyRuns.map((item) => item.sessionRunRef))
    || !unique(document.legacyArchiveKeys.map((item) => item.key))) fail();
  const sessionsById = new Map(document.sessions.map((session) => [session.sessionId, session]));
  for (const binding of document.attemptBindings) {
    const session = sessionsById.get(binding.sessionId);
    if (session === undefined || session.provenance !== 'run'
      || session.operator !== binding.operator || session.runRef !== binding.runRef
      || session.attemptRef !== binding.attemptRef || session.managedSessionRef !== binding.managedSessionRef) fail();
  }
  for (const receipt of document.operationReceipts) {
    if (receipt.sessionId === null) continue;
    const session = sessionsById.get(receipt.sessionId);
    if (session === undefined || session.operationKey !== receipt.operationKey
      || session.requestHash !== receipt.requestHash
      || (session.provenance === 'manual' ? receipt.attemptRef !== null : receipt.attemptRef !== session.attemptRef)) fail();
  }
  for (const operation of Object.values(document.attemptOperations as Record<string, AttemptOperationRecord>)) {
    if (operation.sessionId !== null && !sessionsById.has(operation.sessionId)) fail();
  }
  for (let index = 1; index < document.sessions.length; index += 1) {
    if (Date.parse(document.sessions[index - 1]!.startedAt) > Date.parse(document.sessions[index]!.startedAt)) fail();
  }
  if (Buffer.byteLength(JSON.stringify(document), 'utf8') + 1 > MAX_PTY_DOCUMENT_BYTES) fail();
}

export const validatePtySessionsDocumentV2 = (value: unknown): value is PtySessionsDocumentV2 => {
  try { assertPtySessionsDocumentV2(value); return true; } catch { return false; }
};

export function createEmptyPtySessionsDocument(): PtySessionsDocumentV2 {
  return {
    schema: PTY_SESSIONS_SCHEMA,
    revision: 0,
    sessions: [],
    attemptBindings: [],
    operationReceipts: [],
    attemptOperations: {},
    legacyRuns: [],
    legacyArchiveKeys: [],
  };
}

/**
 * Sessions are stored in non-decreasing `startedAt` order (the validator's invariant), so a launch
 * whose `boundAt` arrives out of order must be spliced into place, never appended (D5).
 */
export function insertSessionRecord(document: PtySessionsDocumentV2, record: SessionRecord): void {
  const startedAt = Date.parse(record.startedAt);
  let index = document.sessions.length;
  while (index > 0 && Date.parse(document.sessions[index - 1]!.startedAt) > startedAt) index -= 1;
  document.sessions.splice(index, 0, record);
}

export function enforcePtySessionRetention(document: PtySessionsDocumentV2): void {
  while (document.sessions.length > MAX_RETAINED_SESSIONS) {
    const index = document.sessions.findIndex((item) => item.state === 'exited' || item.state === 'abandoned');
    if (index < 0) throw new PtySessionPersistenceError('capacity', 'live PTY sessions exceed retention cap');
    const [removed] = document.sessions.splice(index, 1);
    const removedId = removed?.sessionId;
    document.attemptBindings = document.attemptBindings.filter((item) => item.sessionId !== removedId);
    // Every row that names the evicted session goes with it, or the referential checks in
    // assertPtySessionsDocumentV2 would refuse the document forever at the retention boundary.
    document.operationReceipts = document.operationReceipts.filter((item) => item.sessionId !== removedId);
    for (const [key, operation] of Object.entries(document.attemptOperations)) {
      if (operation.sessionId === removedId) delete document.attemptOperations[key];
    }
  }
  while (document.attemptBindings.length > MAX_ATTEMPT_BINDINGS) {
    const index = document.attemptBindings.findIndex((binding) =>
      !document.sessions.some((session) => session.sessionId === binding.sessionId && ACTIVE_STATES.has(session.state)));
    if (index < 0) throw new PtySessionPersistenceError('capacity', 'live PTY bindings exceed retention cap');
    document.attemptBindings.splice(index, 1);
  }
  while (document.operationReceipts.length > MAX_OPERATION_RECEIPTS) {
    const index = document.operationReceipts.findIndex((receipt) => receipt.status !== 'pending'
      && !document.sessions.some((session) => session.operationKey === receipt.operationKey));
    if (index < 0) throw new PtySessionPersistenceError('capacity', 'live or pending PTY receipts exceed retention cap');
    document.operationReceipts.splice(index, 1);
  }
  const terminalOperations = (): [string, AttemptOperationRecord][] =>
    Object.entries(document.attemptOperations)
      .filter(([, operation]) => TERMINAL_ATTEMPT_OPERATION_STATES.has(operation.status))
      .sort(([leftKey, left], [rightKey, right]) => Date.parse(left.updatedAt) - Date.parse(right.updatedAt)
        || (leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0));
  let terminal = terminalOperations();
  for (let index = 0; terminal.length - index > MAX_TERMINAL_ATTEMPT_OPERATIONS; index += 1) {
    delete document.attemptOperations[terminal[index]![0]];
  }
  while (Object.keys(document.attemptOperations).length > MAX_ATTEMPT_OPERATIONS) {
    terminal = terminalOperations();
    const oldest = terminal[0];
    if (oldest === undefined) {
      throw new PtySessionPersistenceError('capacity', 'live PTY attempt operations exceed retention cap');
    }
    delete document.attemptOperations[oldest[0]];
  }
  while (document.legacyRuns.length > MAX_LEGACY_RUNS) {
    const index = document.legacyRuns.findIndex((item) => item.outcome !== 'live');
    if (index < 0) throw new PtySessionPersistenceError('capacity', 'live legacy PTY runs exceed retention cap');
    const [removed] = document.legacyRuns.splice(index, 1);
    document.legacyArchiveKeys = document.legacyArchiveKeys.filter((item) => item.sessionRunRef !== removed?.sessionRunRef);
  }
  while (document.legacyArchiveKeys.length > MAX_LEGACY_ARCHIVE_KEYS) document.legacyArchiveKeys.shift();
}

export type OperationReceiptReplay = { receipt: OperationReceipt; replayed: boolean };

export function beginOperationReceipt(
  document: PtySessionsDocumentV2,
  input: Pick<OperationReceipt, 'operationKey' | 'requestHash' | 'attemptRef' | 'createdAt'>,
): PortResult<OperationReceiptReplay> {
  const existing = document.operationReceipts.find((receipt) => receipt.operationKey === input.operationKey);
  if (existing !== undefined) {
    if (existing.requestHash !== input.requestHash || existing.attemptRef !== input.attemptRef) {
      return { ok: false, refusal: 'binding-conflict', detail: 'operation receipt request conflict' };
    }
    return { ok: true, value: { receipt: structuredClone(existing), replayed: true } };
  }
  const receipt: OperationReceipt = {
    operationKey: input.operationKey,
    requestHash: input.requestHash,
    status: 'pending',
    sessionId: null,
    attemptRef: input.attemptRef,
    refusal: null,
    createdAt: input.createdAt,
    settledAt: null,
  };
  document.operationReceipts.push(receipt);
  return { ok: true, value: { receipt: structuredClone(receipt), replayed: false } };
}

export function settleOperationReceipt(
  document: PtySessionsDocumentV2,
  input: {
    operationKey: string;
    requestHash: string;
    status: 'bound' | 'failed' | 'cancelled';
    sessionId: string | null;
    refusal: HostRefusalCode | null;
    settledAt: string;
  },
): PortResult<OperationReceiptReplay> {
  const receipt = document.operationReceipts.find((item) => item.operationKey === input.operationKey);
  if (receipt === undefined) return { ok: false, refusal: 'not-found', detail: 'operation receipt not found' };
  if (receipt.requestHash !== input.requestHash) {
    return { ok: false, refusal: 'binding-conflict', detail: 'operation receipt request conflict' };
  }
  if (receipt.status !== 'pending') {
    const exact = receipt.status === input.status && receipt.sessionId === input.sessionId
      && receipt.refusal === input.refusal && receipt.settledAt === input.settledAt;
    return exact
      ? { ok: true, value: { receipt: structuredClone(receipt), replayed: true } }
      : { ok: false, refusal: 'binding-conflict', detail: 'operation receipt settlement conflict' };
  }
  if (input.status === 'bound' && (input.sessionId === null || input.refusal !== null)) {
    return { ok: false, refusal: 'invalid-request', detail: 'bound receipt settlement is invalid' };
  }
  if (input.status === 'failed' && input.refusal === null) {
    return { ok: false, refusal: 'invalid-request', detail: 'failed receipt settlement is invalid' };
  }
  if (input.status === 'cancelled' && input.refusal !== 'cancelled') {
    return { ok: false, refusal: 'invalid-request', detail: 'cancelled receipt settlement is invalid' };
  }
  Object.assign(receipt, input);
  return { ok: true, value: { receipt: structuredClone(receipt), replayed: false } };
}

function nextRevision(record: SessionRecord): number {
  if (record.revision >= Number.MAX_SAFE_INTEGER) {
    throw new PtySessionPersistenceError('revision-conflict', 'PTY session revision overflow');
  }
  return record.revision + 1;
}

export function applyEpochAbandonment(
  document: PtySessionsDocumentV2,
  epochId: string,
  reason: 'epoch-lost' | 'daemon-restart' | 'start-recovery',
  observedAt: string,
): number {
  let changed = 0;
  for (let index = 0; index < document.sessions.length; index += 1) {
    const record = document.sessions[index] as SessionRecord;
    if (record.epochId !== epochId || !ACTIVE_STATES.has(record.state)) continue;
    const exit: ObservedExit = {
      sessionId: record.sessionId,
      sequence: Math.min(Number.MAX_SAFE_INTEGER, record.transcript.lastSequence + 1),
      exitCode: null,
      signal: null,
      reason: 'abandoned',
      observedAt,
    };
    document.sessions[index] = {
      ...record,
      attachmentIds: [],
      state: 'abandoned',
      endedAt: observedAt,
      revision: nextRevision(record),
      exit,
      abandonReason: reason,
    } as SessionRecord;
    changed += 1;
  }
  return changed;
}

export function applyObservedSessionExit(
  document: PtySessionsDocumentV2,
  exit: ObservedExit,
  expectedEpochId: string,
): boolean {
  const index = document.sessions.findIndex((item) => item.sessionId === exit.sessionId);
  if (index < 0) return false;
  const record = document.sessions[index] as SessionRecord;
  if (record.epochId !== expectedEpochId || !ACTIVE_STATES.has(record.state) || exit.reason === 'abandoned') return false;
  document.sessions[index] = {
    ...record,
    attachmentIds: [],
    state: 'exited',
    endedAt: exit.observedAt,
    revision: nextRevision(record),
    exit,
  } as SessionRecord;
  return true;
}

export interface SessionPersistence {
  read(): PtySessionsDocumentV2;
  mutate<R>(expectedRevision: number | null, callback: (document: PtySessionsDocumentV2) => R | Promise<R>):
    Promise<{ revision: number; value: R }>;
}

export function createSessionPersistence(stateRoot: string): SessionPersistence {
  if (!isAbsolute(stateRoot) || stateRoot.includes('\0')) {
    throw new PtySessionPersistenceError('invalid-input', 'PTY state root is invalid');
  }
  let document: AtomicJsonDocument<PtySessionsDocumentV2> | null = null;
  const atomic = (): AtomicJsonDocument<PtySessionsDocumentV2> => {
    document ??= createAtomicJsonDocument({
      path: join(resolve(stateRoot), 'pty', 'session-runs.json'),
      empty: createEmptyPtySessionsDocument,
      validate: assertPtySessionsDocumentV2,
      error: (message) => new PtySessionPersistenceError('document-unavailable', message),
      maxBytes: MAX_PTY_DOCUMENT_BYTES,
    });
    return document;
  };
  return {
    read: () => atomic().read(),
    mutate: (expectedRevision, callback) => atomic().mutate(async (draft) => {
      if (expectedRevision !== null && draft.revision !== expectedRevision) {
        throw new PtySessionPersistenceError('revision-conflict', 'PTY document revision conflict');
      }
      if (draft.revision >= Number.MAX_SAFE_INTEGER) {
        throw new PtySessionPersistenceError('revision-conflict', 'PTY document revision overflow');
      }
      const value = await callback(draft);
      enforcePtySessionRetention(draft);
      draft.revision += 1;
      assertPtySessionsDocumentV2(draft);
      return { revision: draft.revision, value };
    }),
  };
}

export interface TranscriptRetention {
  /**
   * Append one frame. [C-R6]: `sequence` is the BYTE OFFSET of `data`'s first byte in the session's
   * output stream (the registry mints it), and the returned `lastSequence` is the cumulative byte total
   * that offset advances to — so the retained window on disk is always `[lastSequence - bytes, lastSequence)`.
   */
  append(sessionId: string, sequence: number, data: Uint8Array): SessionRecordBase['transcript'];
  /**
   * Read-only: the current size in bytes of the session's `.raw` file on disk, or `0` if it does not
   * exist. A cumulative byte total can never be smaller than what is still retained, so a resume that
   * only trusts a stored `lastSequence` can under-mint when that value predates this file (e.g. a record
   * written by an earlier build that stored a frame counter there instead). No writes.
   */
  retainedBytes?(sessionId: string): number;
}

export interface TranscriptRetentionFs {
  rename(source: string, destination: string): void;
}

/** Server-derived transcript paths only; callers provide an id and bytes, never a path. */
export function createTranscriptRetention(
  stateRoot: string,
  maxBytes = DEFAULT_TRANSCRIPT_BYTES,
  fsPort: TranscriptRetentionFs = { rename: renameWithRetrySync },
): TranscriptRetention {
  if (!isAbsolute(stateRoot) || !safeInteger(maxBytes, 1, 16_777_216)) {
    throw new PtySessionPersistenceError('invalid-input', 'PTY transcript retention configuration is invalid');
  }
  const directory = resolve(stateRoot, 'pty', 'transcripts');
  const pathFor = (sessionId: string): string => {
    if (!SESSION_ID_RE.test(sessionId)) {
      throw new PtySessionPersistenceError('invalid-input', 'PTY transcript session id is invalid');
    }
    const path = resolve(directory, `${sessionId}.raw`);
    if (relative(directory, path).startsWith('..')) {
      throw new PtySessionPersistenceError('invalid-input', 'PTY transcript path is invalid');
    }
    return path;
  };
  return {
    append(sessionId, sequence, data) {
      if (!SESSION_ID_RE.test(sessionId) || !safeInteger(sequence) || data.byteLength > 65_536) {
        throw new PtySessionPersistenceError('invalid-input', 'PTY transcript frame is invalid');
      }
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const path = pathFor(sessionId);
      const currentBytes = existsSync(path) ? statSync(path).size : 0;
      // Common case: the frame fits under the cap, so it is an fsync'd append — no full rewrite
      // and no rename per frame. Compaction is reserved for the truncating append below.
      if (currentBytes + data.byteLength <= maxBytes) {
        const appendDescriptor = openSync(path, 'a', 0o600);
        try {
          writeFileSync(appendDescriptor, Buffer.from(data));
          fsyncSync(appendDescriptor);
        } finally {
          closeSync(appendDescriptor);
        }
        return {
          path: `pty/transcripts/${sessionId}.raw`,
          bytes: currentBytes + data.byteLength,
          truncated: false,
          lastSequence: sequence + data.byteLength,
        };
      }
      const current = currentBytes > 0 ? readFileSync(path) : Buffer.alloc(0);
      const combined = Buffer.concat([current, Buffer.from(data)]);
      const retained = combined.subarray(combined.byteLength - maxBytes);
      const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
      let descriptor: number | null = null;
      try {
        descriptor = openSync(temp, 'wx', 0o600);
        writeFileSync(descriptor, retained);
        fsyncSync(descriptor);
        closeSync(descriptor);
        descriptor = null;
        fsPort.rename(temp, path);
      } finally {
        if (descriptor !== null) closeSync(descriptor);
        if (existsSync(temp)) rmSync(temp, { force: true });
      }
      return {
        path: `pty/transcripts/${sessionId}.raw`,
        bytes: retained.byteLength,
        truncated: true,
        lastSequence: sequence + data.byteLength,
      };
    },
    retainedBytes(sessionId) {
      const path = pathFor(sessionId);
      return existsSync(path) ? statSync(path).size : 0;
    },
  };
}
