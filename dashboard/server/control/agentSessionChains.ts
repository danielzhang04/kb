import { createHash, randomUUID } from 'node:crypto';
import { isAbsolute, join, resolve } from 'node:path';
import { createAtomicJsonDocument, type AtomicJsonDocument } from './atomicJsonDocument.ts';

const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_DOCUMENT_BYTES = 1 * 1024 * 1024;
export const MAX_OPERATOR_MESSAGE_CHARS = 64 * 1024;
const RESERVED_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export type AgentSessionRuntime = 'claude' | 'codex';

/** An opaque runtime-owned continuation token. The control plane never parses sessionId. */
export interface ChainEntry {
  runtime: AgentSessionRuntime;
  sessionId: string;
  updatedAt: string;
}

export interface QueuedAgentMessage {
  messageRef: string;
  text: string;
  queuedAt: string;
  ordinal: number;
}

export type MessageClaimState =
  | 'claimed'
  | 'prompt-bound'
  | 'pty-bind-admitted'
  | 'pty-bound'
  | 'write-intent'
  | 'acknowledged'
  | 'released';

/** Public store result. The creator capability hash is deliberately absent. */
export interface MessageClaim {
  claimRef: string;
  operationKey: string;
  declarationFingerprint: string;
  agentId: string;
  messageRefs: string[];
  messages: QueuedAgentMessage[];
  promptFingerprint: string | null;
  ptyOperationRevision: number | null;
  state: MessageClaimState;
  revision: number;
  claimedAt: string;
  updatedAt: string;
}

interface StoredMessageClaim extends MessageClaim {
  ownerHandleHash: string;
}

interface AgentSessionChainDocumentV1 {
  schema: 'kb.agent-session-chains/v1';
  chains: Record<string, ChainEntry>;
  messages: Record<string, string[]>;
}

interface AgentSessionChainDocumentV2 {
  schema: 'kb.agent-session-chains/v2';
  chains: Record<string, ChainEntry>;
  messages: Record<string, QueuedAgentMessage[]>;
  claims: Record<string, StoredMessageClaim>;
  nextMessageOrdinal: number;
}

type StoredDocument = AgentSessionChainDocumentV1 | AgentSessionChainDocumentV2;

export type AgentSessionChainStoreErrorCode = 'invalid-input' | 'document-unavailable' | 'claim-conflict';

/** A corrupt or inaccessible chain document must never be treated as empty durable state. */
export class AgentSessionChainStoreError extends Error {
  readonly code: AgentSessionChainStoreErrorCode;

  constructor(code: AgentSessionChainStoreErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export type ClaimMessagesResult =
  | { disposition: 'created'; claim: MessageClaim; creatorHandle: string }
  | { disposition: 'observed'; claim: MessageClaim };

export interface MessageClaimCas {
  runRef: string;
  agentId: string;
  operationKey: string;
  claimRef: string;
  declarationFingerprint: string;
  promptFingerprint: string | null;
  creatorHandle: string;
  expectedRevision: number;
}

function fail(code: AgentSessionChainStoreErrorCode, message: string): never {
  throw new AgentSessionChainStoreError(code, message);
}

function claimConflict(): never {
  fail('claim-conflict', 'message claim transition was refused');
}

function requireSafeRef(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !SAFE_REF.test(value) || value.includes('..')) {
    fail('invalid-input', `${label} is invalid`);
  }
}

function requireMapKey(value: unknown, label: string): asserts value is string {
  requireSafeRef(value, label);
  if (RESERVED_OBJECT_KEYS.has(value)) fail('invalid-input', `${label} is invalid`);
}

function requireAgentId(value: unknown): asserts value is string {
  requireMapKey(value, 'agent id');
}

function requireOperationKey(value: unknown): asserts value is string {
  requireMapKey(value, 'operation key');
}

function requireFingerprint(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !SHA256.test(value)) fail('invalid-input', `${label} is invalid`);
}

function requireRevision(value: unknown, label: string, minimum = 1): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) fail('invalid-input', `${label} is invalid`);
}

function requireCreatorHandle(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length < 16 || value.length > 128 || value.includes('\0')) {
    fail('invalid-input', 'message claim creator handle is invalid');
  }
}

function isRuntime(value: unknown): value is AgentSessionRuntime {
  return value === 'claude' || value === 'codex';
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isSafeMessage(value: unknown): value is string {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.length <= MAX_OPERATOR_MESSAGE_CHARS
    && !value.includes('\0');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function assertChainMap(value: unknown): asserts value is Record<string, ChainEntry> {
  if (!isRecord(value)) fail('document-unavailable', 'agent session chain document is invalid');
  for (const [agentId, candidate] of Object.entries(value)) {
    try { requireAgentId(agentId); } catch { fail('document-unavailable', 'agent session chain document is invalid'); }
    if (!isRecord(candidate) || !exactKeys(candidate, ['runtime', 'sessionId', 'updatedAt'])
      || !isRuntime(candidate.runtime) || typeof candidate.sessionId !== 'string'
      || candidate.sessionId.length === 0 || !isTimestamp(candidate.updatedAt)) {
      fail('document-unavailable', 'agent session chain document is invalid');
    }
  }
}

function assertQueuedMessage(value: unknown): asserts value is QueuedAgentMessage {
  if (!isRecord(value) || !exactKeys(value, ['messageRef', 'text', 'queuedAt', 'ordinal'])
    || typeof value.messageRef !== 'string' || !SAFE_REF.test(value.messageRef)
    || !isSafeMessage(value.text) || value.text !== value.text.trim()
    || !isTimestamp(value.queuedAt) || !Number.isSafeInteger(value.ordinal) || (value.ordinal as number) < 0) {
    fail('document-unavailable', 'agent session chain document is invalid');
  }
}

const CLAIM_STATES = new Set<MessageClaimState>([
  'claimed', 'prompt-bound', 'pty-bind-admitted', 'pty-bound', 'write-intent', 'acknowledged', 'released',
]);

function assertClaim(operationKey: string, value: unknown): asserts value is StoredMessageClaim {
  if (!isRecord(value) || !exactKeys(value, [
    'claimRef', 'operationKey', 'declarationFingerprint', 'agentId', 'messageRefs', 'messages',
    'promptFingerprint', 'ptyOperationRevision', 'state', 'ownerHandleHash', 'revision', 'claimedAt', 'updatedAt',
  ])) fail('document-unavailable', 'agent session chain document is invalid');
  try {
    requireOperationKey(operationKey);
    requireOperationKey(value.operationKey);
    requireSafeRef(value.claimRef, 'claim reference');
    requireFingerprint(value.declarationFingerprint, 'declaration fingerprint');
    requireAgentId(value.agentId);
  } catch {
    fail('document-unavailable', 'agent session chain document is invalid');
  }
  if (value.operationKey !== operationKey || !Array.isArray(value.messageRefs) || !Array.isArray(value.messages)
    || value.messageRefs.some((item) => typeof item !== 'string' || !SAFE_REF.test(item))
    || new Set(value.messageRefs).size !== value.messageRefs.length
    || value.messages.some((item) => { try { assertQueuedMessage(item); return false; } catch { return true; } })
    || !(value.promptFingerprint === null || (typeof value.promptFingerprint === 'string' && SHA256.test(value.promptFingerprint)))
    || !(value.ptyOperationRevision === null
      || (Number.isSafeInteger(value.ptyOperationRevision) && (value.ptyOperationRevision as number) >= 0))
    || typeof value.state !== 'string' || !CLAIM_STATES.has(value.state as MessageClaimState)
    || typeof value.ownerHandleHash !== 'string' || !SHA256.test(value.ownerHandleHash)
    || !Number.isSafeInteger(value.revision) || (value.revision as number) < 1
    || !isTimestamp(value.claimedAt) || !isTimestamp(value.updatedAt)) {
    fail('document-unavailable', 'agent session chain document is invalid');
  }
  const claim = value as unknown as StoredMessageClaim;
  const terminal = claim.state === 'acknowledged' || claim.state === 'released';
  if ((!terminal && (claim.messages.length !== claim.messageRefs.length
      || claim.messages.some((message, index) => message.messageRef !== claim.messageRefs[index])))
    || (terminal && claim.messages.length !== 0)
    || (claim.state === 'claimed' && (claim.promptFingerprint !== null || claim.ptyOperationRevision !== null))
    || ((claim.state === 'prompt-bound' || claim.state === 'pty-bind-admitted')
      && (claim.promptFingerprint === null || claim.ptyOperationRevision !== null))
    || ((claim.state === 'pty-bound' || claim.state === 'write-intent' || claim.state === 'acknowledged')
      && (claim.promptFingerprint === null || claim.ptyOperationRevision === null))
    || (claim.promptFingerprint === null && claim.ptyOperationRevision !== null)) {
    fail('document-unavailable', 'agent session chain document is invalid');
  }
}

function assertDocument(value: unknown): asserts value is StoredDocument {
  if (!isRecord(value) || typeof value.schema !== 'string') {
    fail('document-unavailable', 'agent session chain document is invalid');
  }
  if (value.schema === 'kb.agent-session-chains/v1') {
    if (!exactKeys(value, ['schema', 'chains', 'messages'])) {
      fail('document-unavailable', 'agent session chain document is invalid');
    }
    assertChainMap(value.chains);
    if (!isRecord(value.messages)) fail('document-unavailable', 'agent session chain document is invalid');
    for (const [agentId, messages] of Object.entries(value.messages)) {
      try { requireAgentId(agentId); } catch { fail('document-unavailable', 'agent session chain document is invalid'); }
      if (!Array.isArray(messages) || messages.some((message) => !isSafeMessage(message))) {
        fail('document-unavailable', 'agent session chain document is invalid');
      }
    }
    return;
  }
  if (value.schema !== 'kb.agent-session-chains/v2'
    || !exactKeys(value, ['schema', 'chains', 'messages', 'claims', 'nextMessageOrdinal'])) {
    fail('document-unavailable', 'agent session chain document is invalid');
  }
  assertChainMap(value.chains);
  if (!isRecord(value.messages) || !isRecord(value.claims)
    || !Number.isSafeInteger(value.nextMessageOrdinal) || (value.nextMessageOrdinal as number) < 0) {
    fail('document-unavailable', 'agent session chain document is invalid');
  }
  const activeOrdinals = new Set<number>();
  const activeRefs = new Set<string>();
  const observeActive = (message: QueuedAgentMessage): void => {
    if (message.ordinal >= (value.nextMessageOrdinal as number)
      || activeOrdinals.has(message.ordinal) || activeRefs.has(message.messageRef)) {
      fail('document-unavailable', 'agent session chain document is invalid');
    }
    activeOrdinals.add(message.ordinal);
    activeRefs.add(message.messageRef);
  };
  for (const [agentId, messages] of Object.entries(value.messages)) {
    try { requireAgentId(agentId); } catch { fail('document-unavailable', 'agent session chain document is invalid'); }
    if (!Array.isArray(messages)) fail('document-unavailable', 'agent session chain document is invalid');
    let priorOrdinal = -1;
    for (const message of messages) {
      assertQueuedMessage(message);
      if (message.ordinal <= priorOrdinal) fail('document-unavailable', 'agent session chain document is invalid');
      priorOrdinal = message.ordinal;
      observeActive(message);
    }
  }
  for (const [operationKey, claim] of Object.entries(value.claims)) {
    assertClaim(operationKey, claim);
    if (claim.state !== 'acknowledged' && claim.state !== 'released') {
      for (const message of claim.messages) observeActive(message);
    }
  }
}

function documentError(error: unknown): AgentSessionChainStoreError {
  if (error instanceof AgentSessionChainStoreError) return error;
  return new AgentSessionChainStoreError('document-unavailable', 'agent session chain document is unavailable');
}

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function define<T>(target: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true });
}

function migrationMessageRef(runRef: string, agentId: string, ordinal: number, text: string): string {
  return `message-legacy-${hash(JSON.stringify([runRef, agentId, ordinal, text]))}`;
}

function upgrade(document: StoredDocument, runRef: string): AgentSessionChainDocumentV2 {
  if (document.schema === 'kb.agent-session-chains/v2') return document;
  const messages: Record<string, QueuedAgentMessage[]> = {};
  let ordinal = 0;
  const queuedAt = new Date().toISOString();
  for (const agentId of Object.keys(document.messages).sort()) {
    define(messages, agentId, document.messages[agentId]!.map((text) => {
      const message: QueuedAgentMessage = {
        messageRef: migrationMessageRef(runRef, agentId, ordinal, text),
        text: text.trim(),
        queuedAt,
        ordinal,
      };
      ordinal += 1;
      return message;
    }));
  }
  const replacement: AgentSessionChainDocumentV2 = {
    schema: 'kb.agent-session-chains/v2',
    chains: structuredClone(document.chains),
    messages,
    claims: {},
    nextMessageOrdinal: ordinal,
  };
  const mutable = document as unknown as Record<string, unknown>;
  for (const key of Object.keys(mutable)) delete mutable[key];
  Object.assign(mutable, replacement);
  return document as unknown as AgentSessionChainDocumentV2;
}

function publicClaim(claim: StoredMessageClaim): MessageClaim {
  return structuredClone({
    claimRef: claim.claimRef,
    operationKey: claim.operationKey,
    declarationFingerprint: claim.declarationFingerprint,
    agentId: claim.agentId,
    messageRefs: claim.messageRefs,
    messages: claim.messages,
    promptFingerprint: claim.promptFingerprint,
    ptyOperationRevision: claim.ptyOperationRevision,
    state: claim.state,
    revision: claim.revision,
    claimedAt: claim.claimedAt,
    updatedAt: claim.updatedAt,
  });
}

function nextTimestamp(previous: string): string {
  return new Date(Math.max(Date.now(), Date.parse(previous) + 1)).toISOString();
}

function validateCas(input: MessageClaimCas): void {
  requireSafeRef(input.runRef, 'run reference');
  requireAgentId(input.agentId);
  requireOperationKey(input.operationKey);
  requireSafeRef(input.claimRef, 'claim reference');
  requireFingerprint(input.declarationFingerprint, 'declaration fingerprint');
  if (input.promptFingerprint !== null) requireFingerprint(input.promptFingerprint, 'prompt fingerprint');
  requireCreatorHandle(input.creatorHandle);
  requireRevision(input.expectedRevision, 'message claim revision');
}

function matchesCas(claim: StoredMessageClaim, input: MessageClaimCas, includePrompt = true): boolean {
  return claim.claimRef === input.claimRef
    && claim.operationKey === input.operationKey
    && claim.agentId === input.agentId
    && claim.declarationFingerprint === input.declarationFingerprint
    && (!includePrompt || claim.promptFingerprint === input.promptFingerprint)
    && claim.ownerHandleHash === hash(input.creatorHandle)
    && claim.revision === input.expectedRevision;
}

export interface AgentSessionChainStore {
  get(runRef: string, agentId: string): ChainEntry | null;
  record(runRef: string, agentId: string, entry: Pick<ChainEntry, 'runtime' | 'sessionId'>): Promise<void>;
  queueMessage(runRef: string, agentId: string, text: string): Promise<void>;
  drainMessages(runRef: string, agentId: string): Promise<string[]>;
  /** `operationKey` is the adapter's mapped `hostKey`, identical to the PTY attempt-operation key. */
  claimMessages(runRef: string, agentId: string, operationKey: string,
    declarationFingerprint: string): Promise<ClaimMessagesResult>;
  bindPromptFingerprint(input: MessageClaimCas & { promptFingerprint: string }): Promise<MessageClaim>;
  admitPtyBind(input: MessageClaimCas & { promptFingerprint: string }): Promise<MessageClaim>;
  markPtyBound(input: MessageClaimCas & { promptFingerprint: string; ptyOperationRevision: number }): Promise<MessageClaim>;
  recordWriteIntent(input: MessageClaimCas & { promptFingerprint: string }): Promise<MessageClaim>;
  ackClaim(input: MessageClaimCas & { promptFingerprint: string }): Promise<MessageClaim>;
  releasePrewrite(input: MessageClaimCas): Promise<MessageClaim>;
}

/** Durable per-Run registry. AtomicJsonDocument provides cross-process exclusion, not effect recovery. */
export function createAgentSessionChainStore(stateRoot: string): AgentSessionChainStore {
  if (!isAbsolute(stateRoot) || stateRoot.includes('\0')) fail('invalid-input', 'agent session chain state root is invalid');
  const root = resolve(stateRoot);
  const documents = new Map<string, AtomicJsonDocument<StoredDocument>>();

  const documentFor = (runRef: string): AtomicJsonDocument<StoredDocument> => {
    requireSafeRef(runRef, 'run reference');
    const existing = documents.get(runRef);
    if (existing) return existing;
    const document = createAtomicJsonDocument<StoredDocument>({
      path: join(root, 'control', 'agent-session-chains', `${runRef}.json`),
      empty: () => ({
        schema: 'kb.agent-session-chains/v2', chains: {}, messages: {}, claims: {}, nextMessageOrdinal: 0,
      }),
      validate: assertDocument,
      error: (message) => new AgentSessionChainStoreError('document-unavailable', message),
      maxBytes: MAX_DOCUMENT_BYTES,
    });
    documents.set(runRef, document);
    return document;
  };

  const mutateClaim = async (
    input: MessageClaimCas,
    allowed: readonly MessageClaimState[],
    update: (claim: StoredMessageClaim, document: AgentSessionChainDocumentV2) => StoredMessageClaim,
    includePrompt = true,
  ): Promise<MessageClaim> => {
    validateCas(input);
    try {
      return await documentFor(input.runRef).mutate((stored) => {
        const document = upgrade(stored, input.runRef);
        if (!Object.hasOwn(document.claims, input.operationKey)) claimConflict();
        const current = document.claims[input.operationKey]!;
        if (!matchesCas(current, input, includePrompt) || !allowed.includes(current.state)) claimConflict();
        const next = update(current, document);
        next.revision = current.revision + 1;
        next.updatedAt = nextTimestamp(current.updatedAt);
        define(document.claims, input.operationKey, next);
        return publicClaim(next);
      });
    } catch (error) {
      throw documentError(error);
    }
  };

  return {
    get(runRef, agentId) {
      requireAgentId(agentId);
      try {
        const chains = documentFor(runRef).read().chains;
        const entry = Object.hasOwn(chains, agentId) ? chains[agentId] : undefined;
        return entry ? structuredClone(entry) : null;
      } catch (error) {
        throw documentError(error);
      }
    },

    async record(runRef, agentId, entry) {
      requireAgentId(agentId);
      if (!isRuntime(entry.runtime) || typeof entry.sessionId !== 'string' || entry.sessionId.length === 0) {
        fail('invalid-input', 'agent session chain entry is invalid');
      }
      try {
        await documentFor(runRef).mutate((stored) => {
          const document = upgrade(stored, runRef);
          const prior = document.chains[agentId];
          const updatedAt = new Date(Math.max(Date.now(), prior ? Date.parse(prior.updatedAt) + 1 : 0)).toISOString();
          define(document.chains, agentId, { runtime: entry.runtime, sessionId: entry.sessionId, updatedAt });
        });
      } catch (error) {
        throw documentError(error);
      }
    },

    async queueMessage(runRef, agentId, text) {
      requireAgentId(agentId);
      if (!isSafeMessage(text)) fail('invalid-input', 'operator message is invalid');
      try {
        await documentFor(runRef).mutate((stored) => {
          const document = upgrade(stored, runRef);
          if (document.nextMessageOrdinal >= Number.MAX_SAFE_INTEGER) {
            fail('document-unavailable', 'agent session chain message ordinal is exhausted');
          }
          const message: QueuedAgentMessage = {
            messageRef: `message-${randomUUID()}`,
            text: text.trim(),
            queuedAt: new Date().toISOString(),
            ordinal: document.nextMessageOrdinal,
          };
          document.nextMessageOrdinal += 1;
          define(document.messages, agentId, [...(document.messages[agentId] ?? []), message]);
        });
      } catch (error) {
        throw documentError(error);
      }
    },

    async drainMessages(runRef, agentId) {
      requireAgentId(agentId);
      try {
        return await documentFor(runRef).mutate((stored) => {
          const document = upgrade(stored, runRef);
          const drained = [...(document.messages[agentId] ?? [])]
            .sort((left, right) => left.ordinal - right.ordinal)
            .map((message) => message.text);
          delete document.messages[agentId];
          return drained;
        });
      } catch (error) {
        throw documentError(error);
      }
    },

    async claimMessages(runRef, agentId, operationKey, declarationFingerprint) {
      requireAgentId(agentId);
      requireOperationKey(operationKey);
      requireFingerprint(declarationFingerprint, 'declaration fingerprint');
      const creatorHandle = randomUUID();
      const ownerHandleHash = hash(creatorHandle);
      const claimRef = `claim-${randomUUID()}`;
      try {
        return await documentFor(runRef).mutate((stored): ClaimMessagesResult => {
          const document = upgrade(stored, runRef);
          if (Object.hasOwn(document.claims, operationKey)) {
            const existing = document.claims[operationKey]!;
            if (existing.agentId !== agentId || existing.declarationFingerprint !== declarationFingerprint) claimConflict();
            return { disposition: 'observed', claim: publicClaim(existing) };
          }
          const messages = [...(document.messages[agentId] ?? [])].sort((left, right) => left.ordinal - right.ordinal);
          delete document.messages[agentId];
          const claimedAt = new Date().toISOString();
          const claim: StoredMessageClaim = {
            claimRef,
            operationKey,
            declarationFingerprint,
            agentId,
            messageRefs: messages.map((message) => message.messageRef),
            messages,
            promptFingerprint: null,
            ptyOperationRevision: null,
            state: 'claimed',
            ownerHandleHash,
            revision: 1,
            claimedAt,
            updatedAt: claimedAt,
          };
          define(document.claims, operationKey, claim);
          return { disposition: 'created', claim: publicClaim(claim), creatorHandle };
        });
      } catch (error) {
        throw documentError(error);
      }
    },

    bindPromptFingerprint(input) {
      requireFingerprint(input.promptFingerprint, 'prompt fingerprint');
      return mutateClaim(input, ['claimed'], (claim) => ({
        ...claim, promptFingerprint: input.promptFingerprint, state: 'prompt-bound',
      }), false);
    },

    admitPtyBind(input) {
      return mutateClaim(input, ['prompt-bound'], (claim) => ({ ...claim, state: 'pty-bind-admitted' }));
    },

    markPtyBound(input) {
      requireRevision(input.ptyOperationRevision, 'PTY operation revision', 0);
      return mutateClaim(input, ['pty-bind-admitted'], (claim) => ({
        ...claim, ptyOperationRevision: input.ptyOperationRevision, state: 'pty-bound',
      }));
    },

    recordWriteIntent(input) {
      return mutateClaim(input, ['pty-bound'], (claim) => ({ ...claim, state: 'write-intent' }));
    },

    ackClaim(input) {
      return mutateClaim(input, ['write-intent'], (claim) => ({ ...claim, messages: [], state: 'acknowledged' }));
    },

    releasePrewrite(input) {
      return mutateClaim(input, ['claimed', 'prompt-bound', 'pty-bound'], (claim, document) => {
        const restored = [...(document.messages[claim.agentId] ?? []), ...claim.messages]
          .sort((left, right) => left.ordinal - right.ordinal);
        if (restored.length > 0) define(document.messages, claim.agentId, restored);
        else delete document.messages[claim.agentId];
        return { ...claim, messages: [], state: 'released' };
      });
    },
  };
}
