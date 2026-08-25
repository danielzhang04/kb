// P6 W0 §3.2: the canonical capability-name normaliser (runs exactly once, at declaration read),
// `decodeCapabilityRequirement` (exact-key wall, rejects `hostId`), `match()` (refuses a non-canonical
// input with `invalid-capability-name` rather than normalising again), and the server-side
// `capabilityHash`. Types only in `./contracts.ts`; this is the canonicalisation + matching logic.
import type { CapabilityRequirement, HostAdvertisement } from './contracts.ts';
import {
  CANONICAL_ID, CAPABILITY_REQUIREMENT_FIELDS, ContractDecodeError, MAX_CONNECTORS,
  MAX_FILESYSTEM_ROOTS, MAX_SKILLS, MAX_TOOLS_PER_CONNECTOR, assertExactKeys,
} from './contracts.ts';
import { sha256Hex } from '../write/durableManifest.ts';

/**
 * Normalise one capability name to its canonical form [§3.2, `design:637`]: NFC, trim, lowercase ASCII,
 * `_` → `-`, collapse repeated `-`, then reject anything not matching the id charset. Throws
 * `invalid-capability-name` on a value that cannot be canonicalised.
 */
export function normalizeCapabilityName(raw: unknown): string {
  if (typeof raw !== 'string') throw new ContractDecodeError('capability-name', 'invalid-capability-name');
  const canonical = raw
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-')
    .replace(/-{2,}/g, '-');
  if (!CANONICAL_ID.test(canonical)) {
    throw new ContractDecodeError('capability-name', 'invalid-capability-name');
  }
  return canonical;
}

/** True iff `name` is already canonical — i.e. normalising it is a no-op. */
export function isCanonicalName(name: string): boolean {
  try {
    return normalizeCapabilityName(name) === name;
  } catch {
    return false;
  }
}

function assertCanonical(field: string, name: string): void {
  if (typeof name !== 'string' || !isCanonicalName(name)) {
    throw new ContractDecodeError(field, 'invalid-capability-name');
  }
}

function sortedUnique(field: string, names: string[], max: number): string[] {
  if (names.length > max) throw new ContractDecodeError(field, `at most ${max} entries, got ${names.length}`);
  const out = [...names].sort();
  for (let i = 1; i < out.length; i += 1) {
    if (out[i] === out[i - 1]) throw new ContractDecodeError(field, `duplicate ${JSON.stringify(out[i])}`);
  }
  return out;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * Normalise and decode a raw declared requirement into the canonical `CapabilityRequirement`. The
 * exact-key wall rejects `hostId`, `daemonVersion`, `reportedAt`, or any other non-requirable key
 * [§3.2] — a requirement that could name a host would reintroduce tier routing. Every name is
 * normalised here, ONCE; the stored requirement is thereafter already canonical.
 */
export function decodeCapabilityRequirement(value: unknown): CapabilityRequirement {
  const item = asRecord(value);
  if (!item) throw new ContractDecodeError('capabilityRequirement', 'object required');
  assertExactKeys('capabilityRequirement', item, CAPABILITY_REQUIREMENT_FIELDS);
  if (!Array.isArray(item.connectors)) throw new ContractDecodeError('connectors', 'array required');
  if (item.connectors.length > MAX_CONNECTORS) {
    throw new ContractDecodeError('connectors', `at most ${MAX_CONNECTORS} servers`);
  }
  const connectors = item.connectors.map((entry) => {
    const c = asRecord(entry);
    if (!c) throw new ContractDecodeError('connectors', 'each connector is an object');
    assertExactKeys('connectors', c, ['server', 'tools']);
    if (!Array.isArray(c.tools)) throw new ContractDecodeError('connectors.tools', 'array required');
    return {
      server: normalizeCapabilityName(c.server),
      tools: sortedUnique('connectors.tools', c.tools.map((t) => normalizeCapabilityName(t)), MAX_TOOLS_PER_CONNECTOR),
    };
  }).sort((a, b) => (a.server < b.server ? -1 : a.server > b.server ? 1 : 0));
  for (let i = 1; i < connectors.length; i += 1) {
    if (connectors[i]!.server === connectors[i - 1]!.server) {
      throw new ContractDecodeError('connectors', `duplicate server ${JSON.stringify(connectors[i]!.server)}`);
    }
  }
  if (!Array.isArray(item.skills)) throw new ContractDecodeError('skills', 'array required');
  if (!Array.isArray(item.filesystemRoots)) throw new ContractDecodeError('filesystemRoots', 'array required');
  if (typeof item.pty !== 'boolean') throw new ContractDecodeError('pty', 'boolean required');
  if (typeof item.gpu !== 'boolean') throw new ContractDecodeError('gpu', 'boolean required');
  if (!Array.isArray(item.clis)) throw new ContractDecodeError('clis', 'array required');
  const clis = sortedUnique('clis', item.clis.map((c) => {
    if (c !== 'claude' && c !== 'codex') throw new ContractDecodeError('clis', `not requirable ${JSON.stringify(c)}`);
    return c;
  }), 2) as Array<'claude' | 'codex'>;
  return {
    connectors,
    skills: sortedUnique('skills', item.skills.map((s) => normalizeCapabilityName(s)), MAX_SKILLS),
    filesystemRoots: sortedUnique(
      'filesystemRoots', item.filesystemRoots.map((r) => normalizeCapabilityName(r)), MAX_FILESYSTEM_ROOTS,
    ),
    pty: item.pty,
    gpu: item.gpu,
    clis,
  };
}

/** Canonical JSON: object keys sorted recursively so the hash is stable regardless of input order. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const rec = value as Record<string, unknown>;
  return `{${Object.keys(rec).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(rec[k])}`).join(',')}}`;
}

/**
 * The `capabilityHash` bound into a lease [§3.1]: `sha256` over the canonical JSON of the sorted,
 * normalised requirement, 64 lowercase hex. Always recomputed server-side; never accepted from a caller.
 */
export function capabilityHash(requirement: CapabilityRequirement): string {
  return sha256Hex(canonicalJson(decodeCapabilityRequirement(requirement)));
}

/**
 * `match(requirement, advertisement)` [§3.2]: true iff every required connector server appears with a
 * SUPERSET of the required tools; `skills` and `filesystemRoots` are subsets; `pty`/`gpu` are implied
 * (`required → advertised`); and every required CLI is `ready`. A non-canonical name reaching `match()`
 * is refused `invalid-capability-name` rather than normalised again — normalisation already happened once.
 */
export function match(requirement: CapabilityRequirement, advertisement: HostAdvertisement): boolean {
  for (const conn of requirement.connectors) {
    assertCanonical('match.connector', conn.server);
    for (const tool of conn.tools) assertCanonical('match.tool', tool);
  }
  for (const skill of requirement.skills) assertCanonical('match.skill', skill);
  for (const root of requirement.filesystemRoots) assertCanonical('match.root', root);

  const advConnectors = new Map(advertisement.connectors.map((c) => [c.server, new Set(c.tools)]));
  for (const req of requirement.connectors) {
    const advTools = advConnectors.get(req.server);
    if (!advTools) return false;
    for (const tool of req.tools) if (!advTools.has(tool)) return false;
  }
  const advSkills = new Set(advertisement.skills);
  for (const skill of requirement.skills) if (!advSkills.has(skill)) return false;
  const advRoots = new Set(advertisement.filesystemRoots);
  for (const root of requirement.filesystemRoots) if (!advRoots.has(root)) return false;
  if (requirement.pty && !advertisement.pty) return false;
  if (requirement.gpu && !advertisement.gpu) return false;
  for (const cli of requirement.clis) if (advertisement.clis[cli] !== 'ready') return false;
  return true;
}
