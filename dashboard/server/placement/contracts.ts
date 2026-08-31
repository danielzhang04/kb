// P6 W0 §3.1 closed contracts: `HostAdvertisement` and `PlacementLease` copied VERBATIM from the
// design spec (388-408), their field domains, and the `CapabilityRequirement` shape. Types and strict
// exact-key decoders ONLY — W0 adds no route, store mutation, probe, proxy, client, or UI. The canonical
// name normaliser, `match()`, and `capabilityHash()` live in `./normalize.ts` [plan §3.2].
import type { HostKind } from '../control/p2Contracts.ts';
import { ContractDecodeError } from '../write/durableManifest.ts';
import { record, isoUtc } from '../shared/decode.ts';

export type { HostKind };

/** The only two hosts (`p2Contracts.ts` reuse). There is no third host string anywhere in P6 [§3.1]. */
export const HOST_KINDS: readonly HostKind[] = ['vm', 'desktop'];

/**
 * The freshness window and the re-advertise interval are ONE shared constant pair, never two literals
 * [§3.1, P6-C44]. An advertisement is fresh for 90 s; every daemon re-advertises on a 30-s timer, so
 * three consecutive misses are tolerated. The interval must sit strictly below the window (asserted in
 * the test) — an interval at or above the window makes every launch `no-complete-placement`.
 */
export const ADVERTISEMENT_FRESHNESS_MS = 90_000;
export const ADVERTISEMENT_INTERVAL_MS = 30_000;

/** A claim/renew grants a 120-s lease [§3.1]. */
export const LEASE_TTL_MS = 120_000;

/** Over-bound input is a refusal, never truncation [§3.1]. */
export const MAX_CONNECTORS = 64;
export const MAX_TOOLS_PER_CONNECTOR = 128;
export const MAX_SKILLS = 256;
export const MAX_FILESYSTEM_ROOTS = 64;

/**
 * The canonical id charset shared by connector servers, tool names, skills, and filesystem-root ids.
 * A `/`, `\`, `:`, `.`, or `..` cannot match, so an absolute client path can never enter the record
 * (`design:394`). Normalisation to this form happens once, in `./normalize.ts`.
 */
export const CANONICAL_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Display/diagnostics only, never an authorization input [§3.1]. */
const DAEMON_VERSION = /^[a-z0-9][a-z0-9.\-]{0,63}$/;
const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const HEX64 = /^[0-9a-f]{64}$/;

/** CLI readiness; only `ready` satisfies a requirement [§3.1]. */
export type CliStatus = 'ready' | 'missing' | 'login-required';
export const CLI_STATUSES: readonly CliStatus[] = ['ready', 'missing', 'login-required'];

// --- design 388-408 VERBATIM: the two interfaces are copied field-for-field. -------------------------
export interface HostAdvertisement {
  hostId: HostKind;
  daemonVersion: string;
  reportedAt: string;
  connectors: Array<{ server: string; tools: string[] }>;
  skills: string[];
  filesystemRoots: string[]; // symbolic ids, never absolute client paths
  pty: boolean;
  gpu: boolean;
  clis: { claude: CliStatus; codex: CliStatus };
}

export interface PlacementLease {
  runRef: string;
  hostId: HostKind;
  capabilityHash: string;
  revision: number;
  expiresAt: string;
  lastReportSequence: number;
}
// ----------------------------------------------------------------------------------------------------

/** The frozen field list of the design-388 interface; the test asserts a decoded record against it. */
export const HOST_ADVERTISEMENT_FIELDS: readonly string[] = [
  'hostId', 'daemonVersion', 'reportedAt', 'connectors', 'skills', 'filesystemRoots', 'pty', 'gpu', 'clis',
];
export const PLACEMENT_LEASE_FIELDS: readonly string[] = [
  'runRef', 'hostId', 'capabilityHash', 'revision', 'expiresAt', 'lastReportSequence',
];

/**
 * The plan-owned numeric advertisement version [§3.1:142] is the advertisement ETag domain and lives
 * BESIDE the verbatim spec fields, never inside them — so the field-list test above stays exact.
 */
export interface StoredHostAdvertisement extends HostAdvertisement {
  version: number;
}

/**
 * The exact subset of `HostAdvertisement` that can be required [§3.2]. `hostId`, `daemonVersion`, and
 * `reportedAt` are deliberately NOT requirable — a requirement that could name a host would reintroduce
 * the tier routing P6 deletes.
 */
export interface CapabilityRequirement {
  connectors: Array<{ server: string; tools: string[] }>;
  skills: string[];
  filesystemRoots: string[];
  pty: boolean;
  gpu: boolean;
  clis: Array<'claude' | 'codex'>;
}

export const CAPABILITY_REQUIREMENT_FIELDS: readonly string[] = [
  'connectors', 'skills', 'filesystemRoots', 'pty', 'gpu', 'clis',
];

/** Exact-key wall: the object has PRECISELY these keys, no more and no fewer. */
export function assertExactKeys(field: string, value: Record<string, unknown>, keys: readonly string[]): void {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new ContractDecodeError(field, `unknown key ${JSON.stringify(key)}`);
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) throw new ContractDecodeError(field, `missing key ${JSON.stringify(key)}`);
  }
}


/** A sorted, unique array of canonical ids under a bound; over-bound or non-canonical throws. */
function decodeIdArray(field: string, value: unknown, max: number): string[] {
  if (!Array.isArray(value)) throw new ContractDecodeError(field, 'array required');
  if (value.length > max) throw new ContractDecodeError(field, `at most ${max} entries, got ${value.length}`);
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || !CANONICAL_ID.test(entry)) {
      throw new ContractDecodeError(field, `non-canonical id ${JSON.stringify(entry)}`);
    }
    if (out.length > 0 && out[out.length - 1]! >= entry) {
      throw new ContractDecodeError(field, 'ids must be sorted and unique');
    }
    out.push(entry);
  }
  return out;
}

function decodeConnectors(value: unknown): Array<{ server: string; tools: string[] }> {
  if (!Array.isArray(value)) throw new ContractDecodeError('connectors', 'array required');
  if (value.length > MAX_CONNECTORS) {
    throw new ContractDecodeError('connectors', `at most ${MAX_CONNECTORS} servers, got ${value.length}`);
  }
  const out: Array<{ server: string; tools: string[] }> = [];
  for (const entry of value) {
    const item = record(entry);
    if (!item) throw new ContractDecodeError('connectors', 'each connector is an object');
    assertExactKeys('connectors', item, ['server', 'tools']);
    if (typeof item.server !== 'string' || !CANONICAL_ID.test(item.server)) {
      throw new ContractDecodeError('connectors', `non-canonical server ${JSON.stringify(item.server)}`);
    }
    if (out.length > 0 && out[out.length - 1]!.server >= item.server) {
      throw new ContractDecodeError('connectors', 'servers must be sorted and unique');
    }
    out.push({ server: item.server, tools: decodeIdArray('connectors.tools', item.tools, MAX_TOOLS_PER_CONNECTOR) });
  }
  return out;
}

function decodeCliStatus(field: string, value: unknown): CliStatus {
  if (value !== 'ready' && value !== 'missing' && value !== 'login-required') {
    throw new ContractDecodeError(field, `invalid cli status ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * Decode a `HostAdvertisement` (the verbatim 9 fields). Every non-canonical name, unknown key,
 * over-bound array, or absolute-path root is rejected here. The plan-owned `version` is not part of
 * the advertisement body — it is assigned server-side and lives on `StoredHostAdvertisement`.
 */
export function decodeHostAdvertisement(value: unknown): HostAdvertisement {
  const item = record(value);
  if (!item) throw new ContractDecodeError('hostAdvertisement', 'object required');
  assertExactKeys('hostAdvertisement', item, HOST_ADVERTISEMENT_FIELDS);
  if (item.hostId !== 'vm' && item.hostId !== 'desktop') {
    throw new ContractDecodeError('hostId', `invalid host ${JSON.stringify(item.hostId)}`);
  }
  if (typeof item.daemonVersion !== 'string' || !DAEMON_VERSION.test(item.daemonVersion)) {
    throw new ContractDecodeError('daemonVersion', 'must match /^[a-z0-9][a-z0-9.\\-]{0,63}$/');
  }
  if (!isoUtc(item.reportedAt)) throw new ContractDecodeError('reportedAt', 'RFC 3339 UTC required');
  const connectors = decodeConnectors(item.connectors);
  const skills = decodeIdArray('skills', item.skills, MAX_SKILLS);
  const filesystemRoots = decodeIdArray('filesystemRoots', item.filesystemRoots, MAX_FILESYSTEM_ROOTS);
  if (typeof item.pty !== 'boolean') throw new ContractDecodeError('pty', 'boolean required');
  if (typeof item.gpu !== 'boolean') throw new ContractDecodeError('gpu', 'boolean required');
  const clis = record(item.clis);
  if (!clis) throw new ContractDecodeError('clis', 'object required');
  assertExactKeys('clis', clis, ['claude', 'codex']);
  return {
    hostId: item.hostId,
    daemonVersion: item.daemonVersion,
    reportedAt: item.reportedAt,
    connectors,
    skills,
    filesystemRoots,
    pty: item.pty,
    gpu: item.gpu,
    clis: { claude: decodeCliStatus('clis.claude', clis.claude), codex: decodeCliStatus('clis.codex', clis.codex) },
  };
}

/** True iff the advertisement is fresh against the store's clock (never the reporter's) [§3.1]. */
export function isAdvertisementFresh(reportedAt: string, nowMs: number): boolean {
  const at = Date.parse(reportedAt);
  if (!Number.isFinite(at)) return false;
  const age = nowMs - at;
  return age >= 0 && age < ADVERTISEMENT_FRESHNESS_MS;
}

/**
 * Decode a stored `PlacementLease`. `capabilityHash` is 64 lowercase hex; it is always recomputed
 * server-side and never accepted from a caller (that rule is enforced at the route — the claim DTO
 * carries no `capabilityHash` field at all, see `../api/v1/contracts.ts`).
 */
export function decodePlacementLease(value: unknown): PlacementLease {
  const item = record(value);
  if (!item) throw new ContractDecodeError('placementLease', 'object required');
  assertExactKeys('placementLease', item, PLACEMENT_LEASE_FIELDS);
  if (typeof item.runRef !== 'string' || !SAFE_REF.test(item.runRef)) {
    throw new ContractDecodeError('runRef', 'safe ref required');
  }
  if (item.hostId !== 'vm' && item.hostId !== 'desktop') {
    throw new ContractDecodeError('hostId', `invalid host ${JSON.stringify(item.hostId)}`);
  }
  if (typeof item.capabilityHash !== 'string' || !HEX64.test(item.capabilityHash)) {
    throw new ContractDecodeError('capabilityHash', '64 lowercase hex required');
  }
  if (typeof item.revision !== 'number' || !Number.isInteger(item.revision) || item.revision < 1) {
    throw new ContractDecodeError('revision', 'positive integer required');
  }
  if (!isoUtc(item.expiresAt)) throw new ContractDecodeError('expiresAt', 'RFC 3339 UTC required');
  if (typeof item.lastReportSequence !== 'number' || !Number.isInteger(item.lastReportSequence)
    || item.lastReportSequence < 0) {
    throw new ContractDecodeError('lastReportSequence', 'non-negative integer required');
  }
  return {
    runRef: item.runRef,
    hostId: item.hostId,
    capabilityHash: item.capabilityHash,
    revision: item.revision,
    expiresAt: item.expiresAt,
    lastReportSequence: item.lastReportSequence,
  };
}

export { ContractDecodeError };
