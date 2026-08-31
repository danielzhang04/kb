import { sha256Hex } from '../shared/hashing.ts';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { RunnableRef } from '../control/p2Contracts.ts';
import type { AttestedScheduleSource } from './attestedSource.ts';
import type { ScheduleStorePort } from './contracts.ts';

export const EXPECTED_SEED_OWNER_BY_CADENCE: Readonly<Record<string, string>> = Object.freeze({
  'nightly-review': 'dispatcher-cloud',
  'weekly-audit': 'dispatcher-cloud',
  'grades-reconcile': 'grader',
  'branch-hygiene': 'hygiene',
  'context-lifecycle': 'context-lifecycle',
  'lessons-miner': 'lessons-miner',
  'grader': 'grader',
  'model-audit': 'model-audit',
  'hygiene': 'hygiene',
  'learnings-implementer': 'learnings-implementer',
  'system-sweeper': 'system-sweeper',
  'research-draft-gate': 'dispatcher-cloud',
  'self-lint-report': 'hygiene',
});

export type HeartbeatSeedPath = 'HEARTBEAT.md' | `orgs/${string}/HEARTBEAT.md`;

export interface HeartbeatSeedFile {
  path: HeartbeatSeedPath;
  bytes: string;
}

export interface AgentSeedFile {
  path: `agents/${string}.md`;
  bytes: string;
}

export interface DevelopmentScheduleSeedSource {
  heartbeatFiles: HeartbeatSeedFile[];
  agentFiles: AgentSeedFile[];
}

export interface ScheduleSeedImportMarker {
  version: 1;
  releaseSha: string | null;
  seedDigest: string;
  importedAt: string;
}

export interface PreparedScheduleSeed {
  id: string;
  path: HeartbeatSeedPath;
  name: string;
  owner: RunnableRef;
  cadence: { source: string; words: string };
  sourceBytes: string;
  sourceDigest: string;
  armed: boolean;
  disarmedReason: 'seed-not-on-protected-main' | 'seed-cadence-unsupported' | null;
}

export interface ScheduleSeedImportPlan {
  seeds: PreparedScheduleSeed[];
  marker: ScheduleSeedImportMarker;
}

export interface ScheduleSeedImportError {
  path: HeartbeatSeedPath;
  cadence: string;
  owner: string;
  id: string;
  reason: 'unknown-cadence' | 'missing-cadence' | 'unknown-owner' | 'duplicate-owner' | 'owner-mapping-mismatch' | 'invalid-cadence';
}

export interface ScheduleSeedImportReport {
  migration: 'importHeartbeatScheduleSeedsV1';
  total: number;
  imported: number;
  errors: ScheduleSeedImportError[];
  truncated: boolean;
}

interface ParsedSeed {
  path: HeartbeatSeedPath;
  name: string;
  schedule: string | null;
  agent: string | null;
  sourceArmed: boolean | null;
  sourceBytes: string;
}

export const HEARTBEAT_SEED_PATHS: readonly HeartbeatSeedPath[] = [
  'HEARTBEAT.md', 'orgs/atlas-prep/HEARTBEAT.md', 'orgs/kb-ops/HEARTBEAT.md',
];

export async function readDevelopmentScheduleSeedSource(repoRoot: string): Promise<DevelopmentScheduleSeedSource> {
  const heartbeatFiles = await Promise.all(HEARTBEAT_SEED_PATHS.map(async (path) => ({
    path,
    bytes: await readFile(resolve(repoRoot, path), 'utf8'),
  })));
  const agentFiles = await Promise.all([...new Set(Object.values(EXPECTED_SEED_OWNER_BY_CADENCE))]
    .sort()
    .map(async (id) => ({
      path: `agents/${id}.md` as const,
      bytes: await readFile(resolve(repoRoot, 'agents', `${id}.md`), 'utf8'),
    })));
  return { heartbeatFiles, agentFiles };
}

const AGENT_SEED_PATHS: readonly `agents/${string}.md`[] = [
  ...new Set(Object.values(EXPECTED_SEED_OWNER_BY_CADENCE)),
].sort().map((id) => `agents/${id}.md` as const);

function unquote(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1);
  return trimmed;
}

function parseSeedFile(file: HeartbeatSeedFile): ParsedSeed[] {
  const fence = /```ya?ml\s*\r?\n([\s\S]*?)```/.exec(file.bytes)?.[1];
  if (!fence) return [];
  const normalized = fence.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split(/(?<=\n)/);
  const starts: Array<{ index: number; indent: number; name: string }> = [];
  lines.forEach((line, index) => {
    const match = /^(\s*)-\s+name:\s*([^\n#]+?)\s*(?:\n)?$/.exec(line);
    if (match) starts.push({ index, indent: match[1].length, name: unquote(match[2]) });
  });
  return starts.map((start, position) => {
    const next = starts.slice(position + 1).find((candidate) => candidate.indent === start.indent);
    const end = next?.index ?? lines.length;
    const block = lines.slice(start.index, end).join('').replace(/\n+$/, '\n');
    const childIndent = start.indent + 2;
    const fields = new Map<string, string>();
    for (const line of lines.slice(start.index + 1, end)) {
      const match = /^(\s*)([a-z][\w-]*):\s*([^\n#]*?)(?:\n)?$/i.exec(line);
      if (match && match[1].length === childIndent && !['|', '>', '|-', '>-'].includes(match[3].trim())) fields.set(match[2], unquote(match[3]));
    }
    const armed = fields.get('armed');
    return {
      path: file.path,
      name: start.name,
      schedule: fields.get('schedule') || null,
      agent: fields.get('agent') || null,
      sourceArmed: armed === undefined ? null : armed === 'true' ? true : armed === 'false' ? false : null,
      sourceBytes: block,
    };
  });
}

function normalizedHeartbeatPath(path: HeartbeatSeedPath): HeartbeatSeedPath {
  const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '');
  if (normalized === 'HEARTBEAT.md' || /^orgs\/[a-z0-9][a-z0-9-]*\/HEARTBEAT\.md$/.test(normalized)) return normalized as HeartbeatSeedPath;
  throw new Error('invalid heartbeat seed path');
}

export function seedScheduleId(path: HeartbeatSeedPath, cadenceName: string): string {
  return sha256Hex(`schedule\0${normalizedHeartbeatPath(path)}\0${cadenceName}`);
}

function wordsFor(source: string): string | null {
  if (source === 'daily') return 'Daily';
  const weekly = /^weekly:([a-z]{3})$/i.exec(source);
  if (weekly) return `Weekly on ${weekly[1].charAt(0).toUpperCase()}${weekly[1].slice(1).toLowerCase()}`;
  if (source === 'weekly') return null;
  const fields = source.split(/\s+/);
  if (fields.length !== 5) return null;
  const every = /^\*\/(\d+)$/.exec(fields[0]);
  if (every && fields.slice(1).every((field) => field === '*')) return `Every ${Number(every[1])} minutes`;
  if (/^\d+$/.test(fields[0]) && /^\d+$/.test(fields[1])) {
    const hour = Number(fields[1]);
    const minute = Number(fields[0]);
    if (minute > 59 || hour > 23) return null;
    const time = `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
    if (fields[4] === '*') return `Daily · ${time}`;
    const day = fields[4].slice(0, 3);
    return `${day.charAt(0).toUpperCase()}${day.slice(1).toLowerCase()} · ${time}`;
  }
  return source;
}

function declarationIndex(files: AgentSeedFile[]): Map<string, RunnableRef[]> {
  const index = new Map<string, RunnableRef[]>();
  for (const file of files) {
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(file.bytes)?.[1];
    if (!frontmatter) continue;
    const id = /^id:\s*([a-z0-9][a-z0-9-]*)\s*$/m.exec(frontmatter)?.[1];
    const group = /^group:\s*([a-z0-9][a-z0-9-]*)\s*$/m.exec(frontmatter)?.[1];
    if (!id || group !== 'system') continue;
    const declaration: RunnableRef = { type: 'agent', id, sourcePath: file.path };
    index.set(declaration.id, [...(index.get(declaration.id) ?? []), declaration]);
  }
  return index;
}

function validMarker(value: ScheduleSeedImportMarker | null | undefined): value is ScheduleSeedImportMarker {
  return value?.version === 1
    && (value.releaseSha === null || /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value.releaseSha))
    && /^[0-9a-f]{64}$/.test(value.seedDigest)
    && !Number.isNaN(Date.parse(value.importedAt));
}

async function readSeedSource(input: {
  source: AttestedScheduleSource;
  development?: DevelopmentScheduleSeedSource;
}): Promise<{ heartbeatFiles: HeartbeatSeedFile[]; agentFiles: AgentSeedFile[]; releaseSha: string | null; protectedMain: boolean }> {
  if (input.source.available) {
    const source = input.source;
    const [heartbeatFiles, agentFiles] = await Promise.all([
      Promise.all(HEARTBEAT_SEED_PATHS.map(async (path) => ({ path, bytes: await source.read(path) }))),
      Promise.all(AGENT_SEED_PATHS.map(async (path) => ({ path, bytes: await source.read(path) }))),
    ]);
    return { heartbeatFiles, agentFiles, releaseSha: source.sourceCommit, protectedMain: true };
  }
  return {
    heartbeatFiles: input.development?.heartbeatFiles ?? [],
    agentFiles: input.development?.agentFiles ?? [],
    releaseSha: null,
    protectedMain: false,
  };
}

function failure(errors: ScheduleSeedImportError[]): { ok: false; code: 'schedule-owner-migration-required'; report: ScheduleSeedImportReport } {
  const bounded = errors.slice(0, 13);
  return {
    ok: false,
    code: 'schedule-owner-migration-required',
    report: {
      migration: 'importHeartbeatScheduleSeedsV1',
      total: Object.keys(EXPECTED_SEED_OWNER_BY_CADENCE).length,
      imported: 0,
      errors: bounded,
      truncated: errors.length > bounded.length,
    },
  };
}

export async function importHeartbeatScheduleSeedsV1(
  input: {
    source: AttestedScheduleSource;
    development?: DevelopmentScheduleSeedSource;
    existingMarker?: ScheduleSeedImportMarker | null;
    importedAt?: string;
  },
  commit: (plan: ScheduleSeedImportPlan) => Promise<void>,
): Promise<
  | { ok: true; replayed: true; marker: ScheduleSeedImportMarker }
  | { ok: true; replayed: false; plan: ScheduleSeedImportPlan }
  | { ok: false; code: 'schedule-owner-migration-required'; report: ScheduleSeedImportReport }
> {
  if (validMarker(input.existingMarker)) return { ok: true, replayed: true, marker: input.existingMarker };

  let loaded: Awaited<ReturnType<typeof readSeedSource>>;
  try {
    loaded = await readSeedSource(input);
  } catch {
    return failure(Object.entries(EXPECTED_SEED_OWNER_BY_CADENCE).map(([cadence, owner]) => ({
      path: 'HEARTBEAT.md', cadence, owner, id: '', reason: 'missing-cadence',
    })));
  }
  const parsed = loaded.heartbeatFiles.flatMap(parseSeedFile);
  const byName = new Map<string, ParsedSeed[]>();
  for (const seed of parsed) byName.set(seed.name, [...(byName.get(seed.name) ?? []), seed]);
  const owners = declarationIndex(loaded.agentFiles);
  const errors: ScheduleSeedImportError[] = [];
  for (const seed of parsed) {
    const expectedOwner = EXPECTED_SEED_OWNER_BY_CADENCE[seed.name];
    const id = seedScheduleId(seed.path, seed.name);
    if (!expectedOwner) errors.push({ path: seed.path, cadence: seed.name, owner: seed.agent ?? '', id, reason: 'unknown-cadence' });
    else if (seed.agent !== expectedOwner) errors.push({ path: seed.path, cadence: seed.name, owner: seed.agent ?? '', id, reason: 'owner-mapping-mismatch' });
  }
  for (const [cadence, expectedOwner] of Object.entries(EXPECTED_SEED_OWNER_BY_CADENCE)) {
    const matches = byName.get(cadence) ?? [];
    if (matches.length !== 1) {
      errors.push({ path: matches[0]?.path ?? 'HEARTBEAT.md', cadence, owner: expectedOwner, id: matches[0] ? seedScheduleId(matches[0].path, cadence) : '', reason: 'missing-cadence' });
      continue;
    }
    const declarations = owners.get(expectedOwner) ?? [];
    if (declarations.length === 0) errors.push({ path: matches[0].path, cadence, owner: expectedOwner, id: seedScheduleId(matches[0].path, cadence), reason: 'unknown-owner' });
    else if (declarations.length > 1) errors.push({ path: matches[0].path, cadence, owner: expectedOwner, id: seedScheduleId(matches[0].path, cadence), reason: 'duplicate-owner' });
    if (!matches[0].schedule) errors.push({ path: matches[0].path, cadence, owner: expectedOwner, id: seedScheduleId(matches[0].path, cadence), reason: 'invalid-cadence' });
  }
  if (errors.length > 0) return failure(errors);

  const seeds = Object.keys(EXPECTED_SEED_OWNER_BY_CADENCE).map((name): PreparedScheduleSeed => {
    const seed = (byName.get(name) ?? [])[0];
    const owner = (owners.get(EXPECTED_SEED_OWNER_BY_CADENCE[name]) ?? [])[0];
    const words = wordsFor(seed.schedule ?? '');
    const supported = words !== null;
    return {
      id: seedScheduleId(seed.path, name),
      path: seed.path,
      name,
      owner,
      cadence: { source: seed.schedule ?? '', words: words ?? seed.schedule ?? '' },
      sourceBytes: seed.sourceBytes,
      sourceDigest: sha256Hex(seed.sourceBytes),
      armed: loaded.protectedMain && seed.sourceArmed !== false && supported,
      disarmedReason: !supported ? 'seed-cadence-unsupported' : !loaded.protectedMain ? 'seed-not-on-protected-main' : null,
    };
  }).sort((left, right) => left.path.localeCompare(right.path) || left.name.localeCompare(right.name));
  const seedDigest = sha256Hex(seeds.map((seed) => `${seed.id}\0${seed.sourceDigest}`).join('\0'));
  const marker: ScheduleSeedImportMarker = {
    version: 1,
    releaseSha: loaded.releaseSha,
    seedDigest,
    importedAt: input.importedAt ?? new Date().toISOString(),
  };
  const plan = { seeds, marker };
  await commit(plan);
  return { ok: true, replayed: false, plan };
}

export interface PauseMarkerMigrationReceipt {
  marker: string;
  scheduleId: string;
  digest: string;
  storePhase: boolean;
  publisherPhase: boolean;
}

export interface PauseMarkerReceiptPort {
  read(marker: string): Promise<PauseMarkerMigrationReceipt | null>;
  write(receipt: PauseMarkerMigrationReceipt): Promise<void>;
}

export async function migratePausedCadenceMarkersToScheduleArmedV1(input: {
  markers: Array<{ marker: string; scheduleId: string; digest: string }>;
  store: ScheduleStorePort;
  receipts: PauseMarkerReceiptPort;
  publishRemoval(marker: string, digest: string): Promise<void>;
}): Promise<PauseMarkerMigrationReceipt[]> {
  const snapshot = await input.store.readScheduleSnapshot();
  const completed: PauseMarkerMigrationReceipt[] = [];
  for (const marker of input.markers) {
    if (!/^queue\/[a-z0-9][a-z0-9./-]{1,240}$/.test(marker.marker)
      || marker.marker.includes('//') || marker.marker.split('/').includes('..')
      || !/^[0-9a-f]{64}$/.test(marker.scheduleId)
      || !/^[0-9a-f]{64}$/.test(marker.digest)) throw new Error('pause-marker-migration-invalid');
    const existing = await input.receipts.read(marker.marker);
    if (existing && (existing.scheduleId !== marker.scheduleId || existing.digest !== marker.digest)) throw new Error('pause-marker-migration-conflict');
    let receipt: PauseMarkerMigrationReceipt = existing ?? { ...marker, storePhase: false, publisherPhase: false };
    if (!receipt.storePhase) {
      const schedule = snapshot.schedules.find((row) => row.id === marker.scheduleId);
      if (!schedule) throw new Error('pause-marker-schedule-missing');
      await input.store.setScheduleArmed(schedule.id, {
        expectedVersion: schedule.version,
        idempotencyKey: `pause-marker:${marker.digest}`,
        armed: false,
      });
      receipt = { ...receipt, storePhase: true };
      await input.receipts.write(receipt);
    }
    if (!receipt.publisherPhase) {
      await input.publishRemoval(marker.marker, marker.digest);
      receipt = { ...receipt, publisherPhase: true };
      await input.receipts.write(receipt);
    }
    completed.push(receipt);
  }
  return completed;
}
