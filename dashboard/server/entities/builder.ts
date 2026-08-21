import type { EntityBuilderRequest, RunnableSelector } from './contracts.ts';
import type { RunnableRef } from '../control/p2Contracts.ts';
import { createHash } from 'node:crypto';

export interface EntityBuilderCatalog {
  models: readonly string[];
  profiles?: readonly string[];
  tools: readonly string[];
  skills: readonly string[];
  connectors: readonly EntityBuilderConnector[];
  /** Symbolic root ids map to server-owned allowed paths. */
  filesystemRoots: Readonly<Record<string, string>>;
}

export interface EntityBuilderConnector {
  server: string;
  tools: readonly string[];
}

export interface EntityBuilderMaterialization extends EntityBuilderRequest {
  connectors: Array<{ server: string; tools: string[] }>;
  filesystemRoots: string[];
  catalogedModel: string;
}

export interface EntityBuilderPort {
  save(input: {
    ref: RunnableRef;
    sourcePath: RunnableRef['sourcePath'];
    expectedSourceRevision: string;
    idempotencyKey: string;
    request: EntityBuilderMaterialization;
  }): Promise<{ status: 'pending' | 'applied'; operationId: string; replayed: boolean }>;
}

const REQUEST_KEYS = new Set(['humanName', 'purpose', 'model', 'tools', 'skills', 'connectors', 'filesystemRoots']);
const builderReplays = new WeakMap<EntityBuilderPort, Map<string, { digest: string; receipt: Promise<BuilderReceipt> }>>();

type BuilderReceipt = { status: 'pending' | 'applied'; operationId: string; replayed: boolean };

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function allowed(values: readonly string[], requested: string[]): boolean {
  const catalog = new Set(values);
  return requested.every((value) => catalog.has(value));
}

function connectorArray(value: unknown): value is Array<{ server: string; tools: string[] }> {
  return Array.isArray(value) && value.every((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const record = entry as Record<string, unknown>;
    return Object.keys(record).length === 2 && typeof record.server === 'string' && stringArray(record.tools);
  });
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function requestDigest(ref: RunnableRef, expectedSourceRevision: string, request: EntityBuilderMaterialization): string {
  return createHash('sha256').update(JSON.stringify({ ref, expectedSourceRevision, request })).digest('hex');
}

function trustedSelector(value: RunnableSelector): RunnableSelector {
  const record = value as unknown as Record<string, unknown>;
  if (Object.keys(record).length !== 2 || typeof record.id !== 'string' || !record.id || (record.type !== 'agent' && record.type !== 'workflow')) {
    throw new Error('invalid-runnable-selector');
  }
  return { type: record.type, id: record.id };
}

/** Parse the closed display/policy request. Paths are derived only from server-owned declarations and catalogs. */
export function materializeEntityBuilderRequest(value: unknown, catalog: EntityBuilderCatalog): EntityBuilderMaterialization {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid-builder-request');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !REQUEST_KEYS.has(key))) throw new Error('builder-field-forbidden');
  if (!nonEmptyString(record.humanName) || !nonEmptyString(record.purpose) || typeof record.model !== 'string' || !stringArray(record.tools) || !stringArray(record.skills) || (record.connectors !== undefined && !connectorArray(record.connectors)) || (record.filesystemRoots !== undefined && !stringArray(record.filesystemRoots))) throw new Error('invalid-builder-request');
  const connectors = record.connectors ?? [];
  const filesystemRoots = record.filesystemRoots ?? [];
  if (![...catalog.models, ...(catalog.profiles ?? [])].includes(record.model)) throw new Error('unknown-model');
  if (!allowed(catalog.tools, record.tools)) throw new Error('unknown-tool');
  if (!allowed(catalog.skills, record.skills)) throw new Error('unknown-capability');
  for (const connector of connectors) {
    const cataloged = catalog.connectors.find((entry) => entry.server === connector.server);
    if (!cataloged) throw new Error('unknown-connector');
    if (!allowed(cataloged.tools, connector.tools)) throw new Error('unknown-tool');
  }
  if (filesystemRoots.some((rootId) => !Object.hasOwn(catalog.filesystemRoots, rootId))) throw new Error('unknown-root');
  return {
    humanName: record.humanName,
    purpose: record.purpose,
    model: record.model,
    tools: [...record.tools],
    skills: [...record.skills],
    connectors: connectors.map((connector) => ({ server: connector.server, tools: [...connector.tools] })),
    filesystemRoots: [...filesystemRoots],
    catalogedModel: record.model,
  };
}

export async function submitEntityBuilder(
  input: { selector: RunnableSelector; expectedSourceRevision: string; idempotencyKey: string; request: unknown },
  services: { resolve(selector: RunnableSelector): RunnableRef; catalog: EntityBuilderCatalog; port: EntityBuilderPort },
): Promise<{ status: 'pending' | 'applied'; operationId: string; replayed: boolean }> {
  if (!nonEmptyString(input.expectedSourceRevision) || !nonEmptyString(input.idempotencyKey)) throw new Error('missing-source-cas');
  const selector = trustedSelector(input.selector);
  const request = materializeEntityBuilderRequest(input.request, services.catalog);
  const ref = services.resolve(selector);
  if (ref.type !== selector.type || ref.id !== selector.id) throw new Error('runnable-selector-mismatch');
  const digest = requestDigest(ref, input.expectedSourceRevision, request);
  const replays = builderReplays.get(services.port) ?? new Map<string, { digest: string; receipt: Promise<BuilderReceipt> }>();
  builderReplays.set(services.port, replays);
  const replay = replays.get(input.idempotencyKey);
  if (replay) {
    if (replay.digest !== digest) throw new Error('idempotency-body-conflict');
    return replay.receipt;
  }
  const receipt = services.port.save({ ref, sourcePath: ref.sourcePath, expectedSourceRevision: input.expectedSourceRevision, idempotencyKey: input.idempotencyKey, request });
  replays.set(input.idempotencyKey, { digest, receipt });
  try {
    return await receipt;
  } catch (error) {
    replays.delete(input.idempotencyKey);
    throw error;
  }
}
