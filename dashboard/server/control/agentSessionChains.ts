import { isAbsolute, join, resolve } from 'node:path';
import { createAtomicJsonDocument, type AtomicJsonDocument } from './atomicJsonDocument.ts';

const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_DOCUMENT_BYTES = 1 * 1024 * 1024;
const RESERVED_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export type AgentSessionRuntime = 'claude' | 'codex';

/** An opaque runtime-owned continuation token. The control plane never parses sessionId. */
export interface ChainEntry {
  runtime: AgentSessionRuntime;
  sessionId: string;
  updatedAt: string;
}

interface AgentSessionChainDocument {
  schema: 'kb.agent-session-chains/v1';
  chains: Record<string, ChainEntry>;
}

export type AgentSessionChainStoreErrorCode = 'invalid-input' | 'document-unavailable';

/** A corrupt or inaccessible chain document must never be treated as an empty session registry. */
export class AgentSessionChainStoreError extends Error {
  readonly code: AgentSessionChainStoreErrorCode;

  constructor(code: AgentSessionChainStoreErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

function fail(code: AgentSessionChainStoreErrorCode, message: string): never {
  throw new AgentSessionChainStoreError(code, message);
}

function requireSafeRef(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !SAFE_REF.test(value) || value.includes('..')) {
    fail('invalid-input', `${label} is invalid`);
  }
}

function requireAgentId(value: unknown): asserts value is string {
  requireSafeRef(value, 'agent id');
  if (RESERVED_OBJECT_KEYS.has(value)) fail('invalid-input', 'agent id is invalid');
}

function isRuntime(value: unknown): value is AgentSessionRuntime {
  return value === 'claude' || value === 'codex';
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function assertDocument(value: unknown): asserts value is AgentSessionChainDocument {
  const document = value as AgentSessionChainDocument;
  if (!document || typeof document !== 'object' || Array.isArray(document)
    || document.schema !== 'kb.agent-session-chains/v1'
    || !document.chains || typeof document.chains !== 'object' || Array.isArray(document.chains)) {
    fail('document-unavailable', 'agent session chain document is invalid');
  }

  for (const [agentId, entry] of Object.entries(document.chains)) {
    try {
      requireAgentId(agentId);
    } catch {
      fail('document-unavailable', 'agent session chain document is invalid');
    }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || !isRuntime(entry.runtime) || typeof entry.sessionId !== 'string' || entry.sessionId.length === 0
      || !isTimestamp(entry.updatedAt)) {
      fail('document-unavailable', 'agent session chain document is invalid');
    }
  }
}

function documentError(error: unknown): AgentSessionChainStoreError {
  if (error instanceof AgentSessionChainStoreError) return error;
  return new AgentSessionChainStoreError('document-unavailable', 'agent session chain document is unavailable');
}

export interface AgentSessionChainStore {
  get(runRef: string, agentId: string): ChainEntry | null;
  record(runRef: string, agentId: string, entry: Pick<ChainEntry, 'runtime' | 'sessionId'>): Promise<void>;
}

/**
 * Durable per-(run, agent) runtime continuation registry. Documents are partitioned by run so a
 * malformed run cannot affect another run's chain; writes use AtomicJsonDocument's cross-process lock.
 */
export function createAgentSessionChainStore(stateRoot: string): AgentSessionChainStore {
  if (!isAbsolute(stateRoot) || stateRoot.includes('\0')) fail('invalid-input', 'agent session chain state root is invalid');
  const root = resolve(stateRoot);
  const documents = new Map<string, AtomicJsonDocument<AgentSessionChainDocument>>();

  const documentFor = (runRef: string): AtomicJsonDocument<AgentSessionChainDocument> => {
    requireSafeRef(runRef, 'run reference');
    const existing = documents.get(runRef);
    if (existing) return existing;
    const document = createAtomicJsonDocument<AgentSessionChainDocument>({
      path: join(root, 'control', 'agent-session-chains', `${runRef}.json`),
      empty: () => ({ schema: 'kb.agent-session-chains/v1', chains: {} }),
      validate: assertDocument,
      error: (message) => new AgentSessionChainStoreError('document-unavailable', message),
      maxBytes: MAX_DOCUMENT_BYTES,
    });
    documents.set(runRef, document);
    return document;
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
        await documentFor(runRef).mutate((document) => {
          const prior = document.chains[agentId];
          const now = Date.now();
          const previous = prior ? Date.parse(prior.updatedAt) : Number.NEGATIVE_INFINITY;
          const updatedAt = new Date(Math.max(now, previous + 1)).toISOString();
          // defineProperty handles an otherwise special object key such as "__proto__" safely.
          Object.defineProperty(document.chains, agentId, {
            value: { runtime: entry.runtime, sessionId: entry.sessionId, updatedAt },
            enumerable: true,
            configurable: true,
            writable: true,
          });
        });
      } catch (error) {
        throw documentError(error);
      }
    },
  };
}
