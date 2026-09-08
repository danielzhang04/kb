/**
 * Read-only Figment hub projection.  It deliberately reads a small, fixed record
 * inventory; the request has no path parameters and cannot select a filesystem
 * location. A JSON ruling or a current SHA-bound machine gate is never an operator
 * checkpoint approval; incomplete checkpoint lineage stays `unknown`.
 */
import { createHash } from 'node:crypto';
import { closeSync, fstatSync, lstatSync, openSync, opendirSync, readFileSync, readSync, realpathSync, statSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { collectDeclaredReferences, isDeclaredReference, isOpaqueReferenceTarget, readDeclaredReference } from './references.ts';
import { collectGeneratedInputs, readGeneratedInput } from './generatedInputs.ts';
import { collectLocalTrainingReadiness, type FigmentLocalTrainingEvidenceRoots, type LocalTrainingProjection } from './localTraining.ts';

const RECORD_NAMES = new Set(['plan.json', 'driver-plan.json', 'run.json', 'gate.json', 'accepted-checkpoint.json']);
const MAX_RECORDS = 256;
const MAX_DEPTH = 8;
const MAX_JSON_BYTES = 1_048_576;
const MAX_HASH_BYTES = 1_048_576;
const MAX_JSON_DEPTH = 64;
const MAX_DIR_ENTRIES = 256;
const MAX_DIRECTORIES = 512;
const MAX_DIAGNOSTIC_JOBS = 128;
const MAX_FILES_PER_JOB = 128;
const MAX_DIAGNOSTIC_ARTIFACTS = 128;
const MAX_DIAGNOSTIC_PNG_BYTES = 16 * 1024 * 1024;
const MAX_DIAGNOSTIC_TOTAL_PNG_BYTES = 128 * 1024 * 1024;
const MAX_DIAGNOSTIC_PNG_PIXELS = 32_000_000;
const MAX_PLAN_STAGES = 8;
const MAX_PLAN_RUNS_PER_STAGE = 32;
const SHA256 = /^[a-f0-9]{64}$/;

export type ReviewState = 'unreviewed' | 'stale' | 'approved' | 'unknown';
export type MachineGateState = 'current' | 'stale' | null;

export interface FigmentRecord {
  path: string;
  type: string;
  creator: string | null;
  /** Checkpoint promotion state, never inferred from a machine gate or rulings file. */
  reviewState: ReviewState;
  /** SHA-bound machine gate evidence, reported separately from operator approval. */
  machineGateState: MachineGateState;
  schema: string | null;
}

export interface FigmentProjection {
  schema: 'figment/hub@1';
  available: boolean;
  creators: Array<{ id: string; persona: 'valid' | 'malformed'; loraTier: string | null; loraTrigger: string | null; accountTiers: string[] }>;
  creatorsTruncated: boolean;
  records: FigmentRecord[];
  recordsTruncated: boolean;
  plans: { items: Array<{ path: string; creator: string; variant: string | null; stages: Array<{ name: string; runCount: number; declaredCeilingUsd: number | null }>; declaredCeilingUsd: number }>; truncated: boolean };
  research: { available: boolean; artifacts: Array<{ area: 'research' | 'book'; name: string; bytes: number; modifiedAt: string }>; truncated: boolean };
  references: { items: Array<{ creator: string; name: string; bytes: number; sha256: string; width: number; height: number; modifiedAt: string }>; truncated: boolean };
  generatedInputs: { available: boolean; items: Array<{ name: string; bytes: number; sha256: string; width: number; height: number; sourceReference: string; sourceSha256: string; generatedOn: string | null; reviewStatus: string; visualReview: Record<string, string> }>; truncated: boolean };
  localTraining: LocalTrainingProjection;
  diagnostic: DiagnosticProjection;
  warnings: string[];
}

export type DiagnosticProjection =
  | { status: 'not-configured' }
  | { status: 'unavailable'; reason: 'unsafe-configured-root' | 'missing-run-record' | 'malformed-run-record' | 'unsafe-artifact-reference' }
  | { status: 'diagnostic-not-promotable'; dryRun: boolean | null; podId: string | null; artifacts: Array<{ name: string; bytes: number; sha256: string; width: number; height: number; modifiedAt: string }>; artifactsTruncated: boolean };

interface SafeRoot { readonly path: string; readonly real: string; }

function openRoot(candidate: string): SafeRoot | null {
  try {
    const path = resolve(candidate);
    const info = lstatSync(path);
    if (!info.isDirectory() || info.isSymbolicLink()) return null;
    return { path, real: realpathSync(path) };
  } catch { return null; }
}

function inside(root: string, candidate: string): boolean {
  const value = relative(root, candidate);
  return value === '' || (!value.startsWith(`..${sep}`) && value !== '..' && !isAbsolute(value));
}

/** Refuse every symlink along a selected path, including a junction hidden in a parent directory. */
function safeFile(root: SafeRoot, candidate: string): string | null {
  const path = isAbsolute(candidate) ? resolve(candidate) : resolve(root.path, candidate);
  if (!inside(root.path, path)) return null;
  try {
    let cursor = root.path;
    const rest = relative(root.path, path).split(/[\\/]/).filter(Boolean);
    for (const segment of rest) {
      cursor = join(cursor, segment);
      if (lstatSync(cursor).isSymbolicLink()) return null;
    }
    if (!lstatSync(path).isFile()) return null;
    const real = realpathSync(path);
    return inside(root.real, real) ? path : null;
  } catch { return null; }
}

function safeDirectory(root: SafeRoot, candidate: string): string | null {
  const path = isAbsolute(candidate) ? resolve(candidate) : resolve(root.path, candidate);
  if (!inside(root.path, path)) return null;
  try {
    let cursor = root.path;
    for (const segment of relative(root.path, path).split(/[\\/]/).filter(Boolean)) {
      cursor = join(cursor, segment);
      if (lstatSync(cursor).isSymbolicLink()) return null;
    }
    if (!lstatSync(path).isDirectory()) return null;
    return inside(root.real, realpathSync(path)) ? path : null;
  } catch { return null; }
}

function withinJsonDepth(text: string): boolean {
  let depth = 0; let quoted = false; let escaped = false;
  for (const character of text) {
    if (quoted) { if (escaped) escaped = false; else if (character === '\\') escaped = true; else if (character === '"') quoted = false; continue; }
    if (character === '"') quoted = true;
    else if (character === '{' || character === '[') { depth += 1; if (depth > MAX_JSON_DEPTH) return false; }
    else if (character === '}' || character === ']') depth -= 1;
  }
  return !quoted && depth === 0;
}

function readJson(root: SafeRoot, candidate: string, warnings: string[] = []): Record<string, unknown> | null {
  const path = safeFile(root, candidate);
  if (path === null) return null;
  try {
    if (statSync(path).size > MAX_JSON_BYTES) { warnings.push(`Skipped oversized JSON record: ${relative(root.path, path).split(sep).join('/')}`); return null; }
    const source = readFileSync(path, 'utf8');
    if (!withinJsonDepth(source)) { warnings.push(`Skipped overly nested JSON record: ${relative(root.path, path).split(sep).join('/')}`); return null; }
    const value: unknown = JSON.parse(source);
    return isObject(value) ? value : null;
  } catch { return null; }
}

function boundedEntries(directory: string): { entries: import('node:fs').Dirent[]; truncated: boolean } {
  const entries: import('node:fs').Dirent[] = [];
  try {
    const handle = opendirSync(directory);
    try {
      let entry = handle.readSync();
      while (entry !== null && entries.length < MAX_DIR_ENTRIES) { entries.push(entry); entry = handle.readSync(); }
      return { entries, truncated: entry !== null };
    } finally { handle.closeSync(); }
  } catch { return { entries, truncated: false }; }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null { return typeof value === 'string' ? value : null; }
function sha256File(path: string): string | null {
  try { return statSync(path).size <= MAX_HASH_BYTES ? createHash('sha256').update(readFileSync(path)).digest('hex') : null; } catch { return null; }
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function pngInfo(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE) || bytes.readUInt32BE(8) !== 13 || bytes.subarray(12, 16).toString('ascii') !== 'IHDR') return null;
  const width = bytes.readUInt32BE(16); const height = bytes.readUInt32BE(20);
  return width > 0 && height > 0 && width * height <= MAX_DIAGNOSTIC_PNG_PIXELS ? { width, height } : null;
}

/** Reads no more than the configured PNG limit, and rejects a file that changes while open. */
function boundedPng(path: string): { bytes: Buffer; modifiedAt: string } | null {
  let descriptor: number | null = null;
  try {
    descriptor = openSync(path, 'r');
    const before = fstatSync(descriptor);
    if (!before.isFile() || before.size < 0 || before.size > MAX_DIAGNOSTIC_PNG_BYTES) return null;
    const bytes = Buffer.allocUnsafe(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const read = readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (read <= 0) return null;
      offset += read;
    }
    const after = fstatSync(descriptor);
    return after.isFile() && after.size === before.size ? { bytes, modifiedAt: after.mtime.toISOString() } : null;
  } catch { return null; } finally { if (descriptor !== null) { try { closeSync(descriptor); } catch { /* close failure cannot make an asset valid */ } } }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value) as string;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('non-finite JSON number');
    return JSON.stringify(value) as string;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  throw new Error('non-JSON value');
}

function creatorFrom(path: string): string | null {
  const parts = path.split(/[\\/]/);
  const index = parts.indexOf('personas');
  return index >= 0 && /^[a-z0-9-]{1,80}$/i.test(parts[index + 1] ?? '') ? parts[index + 1] : null;
}

function gateMachineState(root: SafeRoot, record: Record<string, unknown>): MachineGateState {
  if (record.decision !== 'verified' || typeof record.subject_path !== 'string' || !SHA256.test(String(record.subject_sha256 ?? ''))) return null;
  const subject = safeFile(root, record.subject_path);
  if (subject === null) return 'stale';
  const digest = sha256File(subject);
  return digest !== null && digest === record.subject_sha256 ? 'current' : 'stale';
}

/**
 * This is intentionally narrower than pipeline/lineage.py's approval algorithm. It can identify a
 * corrupt accepted record, but does not recreate its full review subject; without that freshness proof
 * it returns unknown. The train driver remains the sole authority that can promote a checkpoint.
 */
function checkpointState(root: SafeRoot, record: Record<string, unknown>): ReviewState {
  if (record.schema !== 'figment/accepted-checkpoint@1') return 'unknown';
  const approval = text(record.approval_lineage);
  const approvalDigest = text(record.approval_lineage_sha256);
  const plan = text(record.source_plan);
  const planDigest = text(record.source_plan_sha256);
  if (!approval || !SHA256.test(approvalDigest ?? '') || !plan || !SHA256.test(planDigest ?? '')) return 'unknown';
  const approvalPath = safeFile(root, approval);
  const planPath = safeFile(root, plan);
  if (approvalPath === null || planPath === null) return 'unknown';
  const approvalActual = sha256File(approvalPath);
  const planActual = sha256File(planPath);
  if (approvalActual === null || planActual === null) return 'unknown';
  if (approvalActual !== approvalDigest || planActual !== planDigest) return 'stale';
  const lineage = readJson(root, approval);
  if (lineage?.schema !== 'figment/approval-lineage@1' || !isObject(lineage.subject) || !SHA256.test(String(lineage.subject_sha256 ?? ''))) return 'unknown';
  try {
    return createHash('sha256').update(canonicalJson(lineage.subject)).digest('hex') === lineage.subject_sha256
      ? 'unknown' : 'stale';
  } catch { return 'unknown'; }
}

function recordState(root: SafeRoot, type: string, record: Record<string, unknown> | null): ReviewState {
  if (record === null) return 'unknown';
  if (type === 'gate') return gateMachineState(root, record) === 'stale' ? 'stale' : 'unknown';
  if (type === 'accepted-checkpoint') return checkpointState(root, record);
  return typeof record.schema === 'string' || type === 'plan' ? 'unreviewed' : 'unknown';
}

function recordType(name: string): string {
  if (name === 'accepted-checkpoint.json') return 'accepted-checkpoint';
  if (name === 'driver-plan.json' || name === 'plan.json') return 'plan';
  return name.slice(0, -'.json'.length);
}

function collectRecords(root: SafeRoot, warnings: string[]): { records: FigmentProjection['records']; truncated: boolean } {
  const records: FigmentProjection['records'] = [];
  let truncated = false; let directories = 0;
  const visit = (directory: string, depth: number): void => {
    if (records.length >= MAX_RECORDS || depth > MAX_DEPTH || directories >= MAX_DIRECTORIES) { truncated = true; return; }
    const safe = safeDirectory(root, directory);
    if (safe === null) return;
    directories += 1;
    const listed = boundedEntries(safe);
    if (listed.truncated) { truncated = true; warnings.push(`Record discovery stopped after ${MAX_DIR_ENTRIES} entries in one directory.`); }
    const entries = listed.entries;
    for (const entry of entries) {
      if (records.length >= MAX_RECORDS) { truncated = true; return; }
      const child = join(safe, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { visit(child, depth + 1); continue; }
      if (!entry.isFile() || !RECORD_NAMES.has(entry.name)) continue;
      const document = readJson(root, child, warnings);
      records.push({
        path: relative(root.path, child).split(sep).join('/'), type: recordType(entry.name), creator: creatorFrom(relative(root.path, child)),
        reviewState: recordState(root, recordType(entry.name), document),
        machineGateState: entry.name === 'gate.json' && document !== null ? gateMachineState(root, document) : null,
        schema: text(document?.schema),
      });
    }
  };
  // Current driver plans may live at `runs/`; the pipeline location is retained for legacy plan roots.
  for (const start of ['personas', 'runs', join('pipeline', 'train', 'runs')]) visit(join(root.path, start), 0);
  if (directories >= MAX_DIRECTORIES) warnings.push('Record discovery reached its safe directory limit.');
  return { records, truncated };
}

function collectCreators(root: SafeRoot): { creators: FigmentProjection['creators']; truncated: boolean } {
  const directory = safeDirectory(root, 'personas');
  if (directory === null) return { creators: [], truncated: false };
  try {
    const listed = boundedEntries(directory);
    return { creators: listed.entries.flatMap<FigmentProjection['creators'][number]>((entry) => {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !/^[a-z0-9-]{1,80}$/i.test(entry.name)) return [];
      const persona = readJson(root, join('personas', entry.name, 'persona.yaml'));
      if (persona === null) return [{ id: entry.name, persona: 'malformed' as const, loraTier: null, loraTrigger: null, accountTiers: [] }];
      const lora: Record<string, unknown> = isObject(persona.lora) ? persona.lora : {};
      const accounts = Array.isArray(persona.accounts) ? persona.accounts : [];
      return [{ id: entry.name, persona: 'valid' as const, loraTier: text(lora.tier), loraTrigger: text(lora.trigger), accountTiers: accounts.flatMap((account) => isObject(account) && typeof account.tier === 'string' ? [account.tier] : []) }];
    }), truncated: listed.truncated };
  } catch { return { creators: [], truncated: false }; }
}

/** A display-only summary of existing, schema-identified plans. It never exposes argv, prompts, or raw manifest data; malformed, unbounded, and non-finite budgets are omitted. */
function collectPlans(root: SafeRoot, records: FigmentProjection['records'], truncated: boolean): FigmentProjection['plans'] {
  const items: FigmentProjection['plans']['items'] = [];
  for (const record of records) {
    if (record.type !== 'plan' || record.schema !== 'figment/train-plan@1') continue;
    const plan = readJson(root, record.path);
    const creator = text(plan?.creator);
    if (!isObject(plan?.stages)) continue;
    const stages = Object.entries(plan.stages);
    if (!creator || !/^[a-z0-9-]{1,80}$/i.test(creator) || stages.length === 0 || stages.length > MAX_PLAN_STAGES) continue;
    const summary: FigmentProjection['plans']['items'][number]['stages'] = [];
    let total = 0; let complete = true;
    for (const [name, stage] of stages) {
      const runs = isObject(stage) && Array.isArray(stage.runs) ? stage.runs : null;
      if (!/^[a-z][a-z0-9-]{0,31}$/i.test(name) || runs === null || runs.length > MAX_PLAN_RUNS_PER_STAGE) { complete = false; break; }
      let stageTotal = 0; let stageComplete = true;
      for (const run of runs) {
        const ceiling = isObject(run) ? run.ceiling_usd : null;
        if (typeof ceiling !== 'number' || !Number.isFinite(ceiling) || ceiling < 0) { stageComplete = false; continue; }
        if (!Number.isFinite(stageTotal + ceiling)) { stageComplete = false; break; }
        stageTotal += ceiling;
      }
      if (!stageComplete || !Number.isFinite(total + stageTotal)) { complete = false; break; }
      summary.push({ name, runCount: runs.length, declaredCeilingUsd: stageTotal });
      total += stageTotal;
    }
    if (!complete) continue;
    const variant = text(plan?.variant);
    items.push({ path: record.path, creator, variant: variant && variant.length <= 80 ? variant : null, stages: summary, declaredCeilingUsd: total });
  }
  return { items, truncated };
}

function collectResearch(root: SafeRoot): FigmentProjection['research'] {
  const artifacts: FigmentProjection['research']['artifacts'] = [];
  let available = false;
  let truncated = false;
  for (const [area, location] of [['research', 'research'], ['book', join('research', 'book')]] as const) {
    const directory = safeDirectory(root, location);
    if (directory === null) continue;
    available = true;
    try {
      const listed = boundedEntries(directory);
      if (listed.truncated) truncated = true;
      for (const entry of listed.entries) {
        if (artifacts.length >= MAX_RECORDS) { truncated = true; break; }
        if (!entry.isFile() || entry.isSymbolicLink()) continue;
        const file = safeFile(root, join(location, entry.name));
        if (file === null) continue;
        const stats = statSync(file);
        artifacts.push({ area, name: entry.name, bytes: stats.size, modifiedAt: stats.mtime.toISOString() });
      }
    } catch { /* unavailable child is simply omitted */ }
  }
  return { available, artifacts: artifacts.sort((a, b) => a.area.localeCompare(b.area) || a.name.localeCompare(b.name)), truncated };
}

type DiagnosticReceipt = { dryRun: boolean | null; podId: string | null; files: Array<{ name: string; bytes: number }>; truncated: boolean };
type DiagnosticUnavailable = Extract<DiagnosticProjection, { status: 'unavailable' }>;

/** Validates bounded, ordered receipt membership without opening any output artifact. */
function diagnosticReceipt(root: SafeRoot): DiagnosticReceipt | DiagnosticUnavailable {
  const run = readJson(root, 'run.json');
  if (run === null) return { status: 'unavailable', reason: 'missing-run-record' };
  if (!Array.isArray(run.jobs)) return { status: 'unavailable', reason: 'malformed-run-record' };
  const files: DiagnosticReceipt['files'] = [];
  let totalBytes = 0; let truncated = false;
  if (run.jobs.length > MAX_DIAGNOSTIC_JOBS) return { status: 'unavailable', reason: 'malformed-run-record' };
  for (const job of run.jobs) {
    if (!isObject(job) || !Array.isArray(job.files)) return { status: 'unavailable', reason: 'malformed-run-record' };
    if (job.files.length > MAX_FILES_PER_JOB) return { status: 'unavailable', reason: 'malformed-run-record' };
    for (const file of job.files) {
      if (files.length >= MAX_DIAGNOSTIC_ARTIFACTS) { truncated = true; break; }
      const name = isObject(file) ? text(file.path) : null;
      const receiptBytes = isObject(file) ? file.bytes : null;
      if (!name || !name.endsWith('.png') || basename(name) !== name || name.includes('\\') || name.includes('/') || name === '.' || name === '..'
        || typeof receiptBytes !== 'number' || !Number.isSafeInteger(receiptBytes) || receiptBytes < 0) {
        return { status: 'unavailable', reason: 'unsafe-artifact-reference' };
      }
      if (receiptBytes > MAX_DIAGNOSTIC_PNG_BYTES) return { status: 'unavailable', reason: 'malformed-run-record' };
      if (totalBytes + receiptBytes > MAX_DIAGNOSTIC_TOTAL_PNG_BYTES) { truncated = true; break; }
      files.push({ name, bytes: receiptBytes });
      totalBytes += receiptBytes;
    }
    if (truncated) break;
  }
  return { dryRun: typeof run.dry_run === 'boolean' ? run.dry_run : null, podId: text(run.pod_id), files, truncated };
}

function diagnosticProjection(root: SafeRoot): DiagnosticProjection {
  const receipt = diagnosticReceipt(root);
  if ('status' in receipt) return receipt;
  const artifacts: Array<{ name: string; bytes: number; sha256: string; width: number; height: number; modifiedAt: string }> = [];
  for (const file of receipt.files) {
      const path = safeFile(root, file.name);
      if (path === null) return { status: 'unavailable', reason: 'unsafe-artifact-reference' };
      const loaded = boundedPng(path);
      if (loaded === null || loaded.bytes.length !== file.bytes) return { status: 'unavailable', reason: 'malformed-run-record' };
      const info = pngInfo(loaded.bytes);
      if (info === null) return { status: 'unavailable', reason: 'malformed-run-record' };
      artifacts.push({ name: file.name, bytes: loaded.bytes.length, sha256: createHash('sha256').update(loaded.bytes).digest('hex'), ...info, modifiedAt: loaded.modifiedAt });
  }
  return { status: 'diagnostic-not-promotable', dryRun: receipt.dryRun, podId: receipt.podId, artifacts, artifactsTruncated: receipt.truncated };
}

function readDiagnostic(configuredRoot: string | null | undefined): DiagnosticProjection {
  if (!configuredRoot?.trim()) return { status: 'not-configured' };
  const root = openRoot(configuredRoot);
  return root === null ? { status: 'unavailable', reason: 'unsafe-configured-root' } : diagnosticProjection(root);
}

export function buildFigmentProjection(repoRoot: string, diagnosticRoot?: string | null, generatedInputRoot?: string | null, localTrainingEvidence?: FigmentLocalTrainingEvidenceRoots | null): FigmentProjection {
  const warnings: string[] = [];
  const root = openRoot(join(repoRoot, 'orgs', 'figment'));
  if (root === null) return { schema: 'figment/hub@1', available: false, creators: [], creatorsTruncated: false, records: [], recordsTruncated: false, plans: { items: [], truncated: false }, research: { available: false, artifacts: [], truncated: false }, references: { items: [], truncated: false }, generatedInputs: { available: false, items: [], truncated: false }, localTraining: collectLocalTrainingReadiness(localTrainingEvidence), diagnostic: readDiagnostic(diagnosticRoot), warnings };
  const collected = collectRecords(root, warnings);
  const creators = collectCreators(root);
  return { schema: 'figment/hub@1', available: true, creators: creators.creators, creatorsTruncated: creators.truncated, records: collected.records, recordsTruncated: collected.truncated, plans: collectPlans(root, collected.records, collected.truncated), research: collectResearch(root), references: collectDeclaredReferences(root.path), generatedInputs: collectGeneratedInputs(repoRoot, generatedInputRoot), localTraining: collectLocalTrainingReadiness(localTrainingEvidence), diagnostic: readDiagnostic(diagnosticRoot), warnings };
}

export function registerFigmentRead(app: FastifyInstance, options: { repoRoot: string; diagnosticRoot?: string | null; generatedInputRoot?: string | null; localTrainingEvidence?: FigmentLocalTrainingEvidenceRoots | null }): void {
  app.get('/api/figment', async () => buildFigmentProjection(options.repoRoot, options.diagnosticRoot, options.generatedInputRoot, options.localTrainingEvidence));
  app.get('/api/figment/reference-assets/:creator/:name', async (request, reply) => {
    const { creator, name } = request.params as { creator?: unknown; name?: unknown };
    const { sha256 } = (request.query ?? {}) as { sha256?: unknown };
    if (typeof creator !== 'string' || typeof name !== 'string' || typeof sha256 !== 'string' || !SHA256.test(sha256) || !isOpaqueReferenceTarget(creator, name)) return reply.code(404).send({ error: 'not-found' });
    const referenceRoot = join(options.repoRoot, 'orgs', 'figment');
    if (!isDeclaredReference(referenceRoot, creator, name)) return reply.code(404).send({ error: 'not-found' });
    const loaded = readDeclaredReference(referenceRoot, creator, name, sha256);
    if (loaded === null) return reply.code(409).send({ error: 'stale-declared-reference' });
    return reply.header('content-type', loaded.contentType).header('x-content-type-options', 'nosniff').header('cache-control', 'no-store').send(loaded.bytes);
  });
  app.get('/api/figment/diagnostic-assets/:name', async (request, reply) => {
    const { name } = request.params as { name?: unknown };
    const { sha256 } = (request.query ?? {}) as { sha256?: unknown };
    if (typeof name !== 'string' || typeof sha256 !== 'string' || !SHA256.test(sha256)) return reply.code(404).send({ error: 'not-found' });
    const root = options.diagnosticRoot?.trim() ? openRoot(options.diagnosticRoot) : null;
    if (root === null) return reply.code(404).send({ error: 'not-found' });
    const receipt = diagnosticReceipt(root);
    if ('status' in receipt) return reply.code(404).send({ error: 'not-found' });
    const expected = receipt.files.find((artifact) => artifact.name === name);
    if (expected === undefined) return reply.code(404).send({ error: 'not-found' });
    try {
      const path = safeFile(root, name);
      const loaded = path === null ? null : boundedPng(path);
      const info = loaded === null ? null : pngInfo(loaded.bytes);
      if (loaded === null || loaded.bytes.length !== expected.bytes || info === null || createHash('sha256').update(loaded.bytes).digest('hex') !== sha256) return reply.code(409).send({ error: 'stale-diagnostic-asset' });
      return reply.header('content-type', 'image/png').header('x-content-type-options', 'nosniff').header('cache-control', 'no-store').send(loaded.bytes);
    } catch { return reply.code(409).send({ error: 'stale-diagnostic-asset' }); }
  });
  app.get('/api/figment/generated-input-assets/:name', async (request, reply) => {
    const { name } = request.params as { name?: unknown }; const { sha256 } = (request.query ?? {}) as { sha256?: unknown };
    if (typeof name !== 'string' || typeof sha256 !== 'string' || !SHA256.test(sha256)) return reply.code(404).send({ error: 'not-found' });
    const loaded = readGeneratedInput(options.repoRoot, options.generatedInputRoot, name, sha256);
    if (loaded === null) return reply.code(409).send({ error: 'stale-generated-input' });
    return reply.header('content-type', 'image/png').header('x-content-type-options', 'nosniff').header('cache-control', 'no-store').send(loaded.bytes);
  });
}
