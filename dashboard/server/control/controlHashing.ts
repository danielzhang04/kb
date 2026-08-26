/**
 * Control-plane-local pure helpers that were byte-identical in `store.ts` and `migrations.ts`.
 * Consolidated here (one internal source) and imported by both. These are deliberately kept
 * control-local rather than pushed to `../shared/`: the iteration-* helpers depend on control DTOs,
 * and `isPlainRecord` here uses the exact prototype-only truth table the control path was written
 * against. Bodies are verbatim copies of the former per-module definitions — behavior-identical.
 */
import { createHash } from 'node:crypto';
import type { IterationRequest, JsonValue } from './types.ts';
import type { ProposalIterationGroup } from './proposal.ts';
import type { StoredIterationRequest } from './store.ts';

export function clone<T>(value: T): T {
  return structuredClone(value);
}

export function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
}

export function iterationDefinitionHash(group: ProposalIterationGroup): string {
  return sha256(canonicalJson(group as unknown as JsonValue));
}

export function iterationRequestBody(request: StoredIterationRequest): IterationRequest {
  const { subject: _subject, runRef: _runRef, operationKey: _operationKey,
    operationFingerprint: _operationFingerprint, ...body } = request;
  return body;
}

export function iterationRequestFingerprint(request: StoredIterationRequest): string {
  return sha256(canonicalJson(iterationRequestBody(request) as unknown as JsonValue));
}
