/**
 * Bounded, read-only HTTP surface for the current-source observation reader
 * (`orgs/figment/pipeline/gen_source_read.py`). This grants no launch,
 * quality, or approval authority; it is a manual, past-tense observation of
 * one already-published generation plan's compiled source inputs.
 *
 * Configuration is server-owned, immutable after registration, and limited
 * to at most two entries (mirroring the existing two-plan capacity). Absent
 * configuration (`undefined`/`null`) disables this feature entirely; present
 * but malformed configuration is a fixed configuration error at startup.
 */
import { createHash } from 'node:crypto';
import { lstat, open } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import {
  GEN_SOURCE_ID_RE,
  GEN_SOURCE_LIMITATIONS,
  decodeGenSourceReadResult,
  parseGenSourceJson,
  type GenSourceReadInventory,
  type GenSourceReadResult,
} from '../../shared/figmentGenSourceRead.ts';
import { requireSession, verifiedSession } from '../http/middleware.ts';
import type { SessionConfig } from '../auth/session.ts';
import {
  StudioPlanProcessError,
  runStudioPlanProcessCapture,
  type StudioPlanProcessOptions,
} from './studioPlanProcess.ts';
import {
  assertInventoryRoots,
  currentRoot,
  publishedPlan,
  readPublishedStudioPlans,
  safePath,
  safeRoot,
  studioPlanRoots,
  type Inventory as PublishedInventory,
  type PublishedObservations,
  type SafeRoot,
} from './studioPublishedPlans.ts';

const CONFIG_ERROR = 'invalid Figment gen-source-read configuration';
const MAX_STRING_CHARS = 2_048;
const MAX_CONFIG_JSON_CHARS = 65_536;
const MAX_ADAPTER_BYTES = 512 * 1024;
const MAX_STDOUT_BYTES = 4_096;
const SHA256_RE = /^[a-f0-9]{64}$/;
const DEPENDENCY_KEYS = [
  'observed_reads.py', 'figment_train.py', 'training_config.py', 'persona.py', 'lineage.py',
] as const;
const CONFIG_KEYS = ['pythonExecutable', 'adapterSha256', 'dependencySha256', 'entries'];
const ENTRY_KEYS = ['id', 'planSha256', 'sourceRoot', 'sourcePlanSha256'];
const PYTHON_RESULT_KEYS = [
  'schema', 'result', 'creator', 'selected_plan_sha256', 'persona_sha256', 'approval_sha256',
  'approval_lineage_sha256', 'source_plan_sha256', 'checkpoint_sha256', 'gen_manifest_sha256',
  'gen_runs', 'claims',
];
const CLAIMS_KEYS = ['launch_ready', 'quality_approved', 'atomic_snapshot'];

export interface GenSourceReadDependencyPins {
  readonly 'observed_reads.py': string;
  readonly 'figment_train.py': string;
  readonly 'training_config.py': string;
  readonly 'persona.py': string;
  readonly 'lineage.py': string;
}

export interface GenSourceReadConfigEntry {
  readonly id: string;
  readonly planSha256: string;
  readonly sourceRoot: string;
  readonly sourcePlanSha256: string;
}

export interface GenSourceReadConfig {
  readonly pythonExecutable: string;
  readonly adapterSha256: string;
  readonly dependencySha256: GenSourceReadDependencyPins;
  readonly entries: readonly GenSourceReadConfigEntry[];
}

// ---------------------------------------------------------------------------
// Structural validation primitives (reject non-plain objects, accessors,
// symbols, unknown keys and array holes before any value is read).
// ---------------------------------------------------------------------------

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

function ownEnumerablePlainKeys(value: object): string[] | null {
  const keys: string[] = [];
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return null;
    keys.push(key);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) return null;
  return keys;
}

function hasExactKeys(value: object, keys: readonly string[]): boolean {
  const actual = ownEnumerablePlainKeys(value);
  if (actual === null) return false;
  const sortedActual = [...actual].sort();
  const sortedExpected = [...keys].sort();
  return sortedActual.length === sortedExpected.length
    && sortedActual.every((key, index) => key === sortedExpected[index]);
}

function readPlainArray(value: unknown, maxLength: number): unknown[] | null {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
  if (Object.getOwnPropertySymbols(value).length > 0) return null;
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  if (!lengthDescriptor || !('value' in lengthDescriptor)) return null;
  const length = lengthDescriptor.value;
  if (!Number.isInteger(length) || length < 0 || length > maxLength) return null;
  if (Object.getOwnPropertyNames(value).length !== length + 1) return null;
  const items: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return null;
    items.push(descriptor.value);
  }
  return items;
}

function isWellFormedString(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (Number.isNaN(next) || next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

function hasControlOrNul(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0 || code < 0x20 || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

const isBoundedString = (value: unknown): value is string =>
  typeof value === 'string' && value.length >= 1 && value.length <= MAX_STRING_CHARS
  && isWellFormedString(value) && !hasControlOrNul(value);

const WINDOWS_RESERVED_STEMS = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

/**
 * Absolute canonical path only, matching the current platform's own grammar:
 * on Windows this requires a `drive:\` root and rejects UNC/device roots,
 * POSIX-style roots, embedded colons, trailing dot/space segments, and
 * reserved device stems; on POSIX this requires a `/` root and rejects
 * backslashes entirely. Malformed input is rejected, never normalized.
 */
function isCanonicalAbsolutePath(value: unknown): value is string {
  if (!isBoundedString(value)) return false;
  if (!isAbsolute(value)) return false;
  if (process.platform === 'win32') {
    if (value.includes('/')) return false;
    if (!/^[A-Za-z]:\\/.test(value)) return false;
    if (value.endsWith('\\')) return false;
    const segments = value.slice(3).split('\\');
    for (const segment of segments) {
      if (segment.length === 0 || segment === '.' || segment === '..') return false;
      if (segment.includes(':')) return false;
      if (segment.endsWith('.') || segment.endsWith(' ')) return false;
      const stem = segment.split('.')[0];
      if (WINDOWS_RESERVED_STEMS.test(stem)) return false;
    }
    return true;
  }
  if (value.includes('\\')) return false;
  if (!value.startsWith('/')) return false;
  if (value.endsWith('/')) return false;
  const segments = value.slice(1).split('/');
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

// ---------------------------------------------------------------------------
// Config parsing
// ---------------------------------------------------------------------------

function parseDependencyPins(value: unknown): GenSourceReadDependencyPins | null {
  if (!isPlainObject(value) || !hasExactKeys(value, DEPENDENCY_KEYS)) return null;
  const observedReads = value['observed_reads.py'];
  const figmentTrain = value['figment_train.py'];
  const trainingConfig = value['training_config.py'];
  const persona = value['persona.py'];
  const lineage = value['lineage.py'];
  if (
    typeof observedReads !== 'string' || !SHA256_RE.test(observedReads)
    || typeof figmentTrain !== 'string' || !SHA256_RE.test(figmentTrain)
    || typeof trainingConfig !== 'string' || !SHA256_RE.test(trainingConfig)
    || typeof persona !== 'string' || !SHA256_RE.test(persona)
    || typeof lineage !== 'string' || !SHA256_RE.test(lineage)
  ) return null;
  return {
    'observed_reads.py': observedReads, 'figment_train.py': figmentTrain,
    'training_config.py': trainingConfig, 'persona.py': persona, 'lineage.py': lineage,
  };
}

function parseConfigEntry(value: unknown, seenIds: Set<string>): GenSourceReadConfigEntry | null {
  if (!isPlainObject(value) || !hasExactKeys(value, ENTRY_KEYS)) return null;
  const { id, planSha256, sourceRoot, sourcePlanSha256 } = value;
  if (typeof id !== 'string' || !GEN_SOURCE_ID_RE.test(id) || seenIds.has(id)) return null;
  if (typeof planSha256 !== 'string' || !SHA256_RE.test(planSha256)) return null;
  if (typeof sourcePlanSha256 !== 'string' || !SHA256_RE.test(sourcePlanSha256)) return null;
  if (!isCanonicalAbsolutePath(sourceRoot)) return null;
  seenIds.add(id);
  return { id, planSha256, sourceRoot, sourcePlanSha256 };
}

function buildConfig(raw: unknown): GenSourceReadConfig | null {
  if (!isPlainObject(raw) || !hasExactKeys(raw, CONFIG_KEYS)) return null;
  const pythonExecutable = raw.pythonExecutable;
  if (!isCanonicalAbsolutePath(pythonExecutable)) return null;
  const adapterSha256 = raw.adapterSha256;
  if (typeof adapterSha256 !== 'string' || !SHA256_RE.test(adapterSha256)) return null;
  const dependencySha256 = parseDependencyPins(raw.dependencySha256);
  if (dependencySha256 === null) return null;
  const rawEntries = readPlainArray(raw.entries, 2);
  if (rawEntries === null || rawEntries.length < 1) return null;
  const seenIds = new Set<string>();
  const entries: GenSourceReadConfigEntry[] = [];
  for (const rawEntry of rawEntries) {
    const entry = parseConfigEntry(rawEntry, seenIds);
    if (entry === null) return null;
    entries.push(entry);
  }
  return { pythonExecutable, adapterSha256, dependencySha256, entries };
}

/** Trusted server-owned configuration. Only absent input disables the feature. */
export function parseGenSourceReadConfig(value: unknown): GenSourceReadConfig | null {
  if (value === null || value === undefined) return null;
  const parsed = buildConfig(value);
  if (parsed === null) throw new Error(CONFIG_ERROR);
  return parsed;
}

/** Parse the environment seam without allowing an oversized value into JSON.parse. */
export function parseGenSourceReadConfigJson(raw: string | undefined): GenSourceReadConfig | null {
  if (raw === undefined) return null;
  if (
    typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_CONFIG_JSON_CHARS
    || !isWellFormedString(raw)
  ) {
    throw new Error(CONFIG_ERROR);
  }
  let parsed: unknown;
  try {
    parsed = parseGenSourceJson(raw, MAX_CONFIG_JSON_CHARS);
  } catch {
    throw new Error(CONFIG_ERROR);
  }
  // A JSON-present-but-null environment value is a malformed configuration,
  // distinct from the in-process seam where `null`/`undefined` disables.
  if (parsed === null) throw new Error(CONFIG_ERROR);
  return parseGenSourceReadConfig(parsed);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

function cloneConfig(config: GenSourceReadConfig): GenSourceReadConfig {
  const cloned: GenSourceReadConfig = {
    pythonExecutable: config.pythonExecutable,
    adapterSha256: config.adapterSha256,
    dependencySha256: { ...config.dependencySha256 },
    entries: config.entries.map((entry) => ({
      id: entry.id, planSha256: entry.planSha256,
      sourceRoot: entry.sourceRoot, sourcePlanSha256: entry.sourcePlanSha256,
    })),
  };
  return deepFreeze(cloned);
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

// ---------------------------------------------------------------------------
// Bounded adapter identity/read (independent of the published-plan reader).
// ---------------------------------------------------------------------------

interface AdapterIdentity { dev: number; ino: number; size: number; mtimeMs: number; }
interface AdapterRecord { bytes: Buffer; identity: AdapterIdentity; ctimeMs: number; openedCtimeMs: number; }

function identityOf(stat: { dev: number; ino: number; size: number; mtimeMs: number }): AdapterIdentity {
  return { dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs };
}

// Cross-API (lstat vs fstat) comparisons deliberately exclude ctime: this file
// keeps lstat- and fstat-observed ctime values separate rather than asserting
// any specific cross-API relationship between them.
function sameIdentity(a: AdapterIdentity, b: AdapterIdentity): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs;
}

async function readAdapterRecord(path: string): Promise<AdapterRecord | null> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    const named = await lstat(path);
    if (!named.isFile() || named.isSymbolicLink() || named.size < 1 || named.size > MAX_ADAPTER_BYTES) return null;
    handle = await open(path, 'r');
    const opened = await handle.stat();
    if (!opened.isFile() || opened.isSymbolicLink()) return null;
    if (!sameIdentity(identityOf(named), identityOf(opened))) return null;
    const buffer = Buffer.allocUnsafe(MAX_ADAPTER_BYTES + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > MAX_ADAPTER_BYTES || offset !== opened.size) return null;
    const bytes = Buffer.from(buffer.subarray(0, offset));
    // Same-API (lstat/lstat) recheck: ctime is safe to compare here.
    const namedAfter = await lstat(path);
    if (!namedAfter.isFile() || namedAfter.isSymbolicLink()) return null;
    if (!sameIdentity(identityOf(named), identityOf(namedAfter)) || named.ctimeMs !== namedAfter.ctimeMs) return null;
    // Same-API (fstat/fstat) recheck on the still-open handle.
    const openedAfter = await handle.stat();
    if (!openedAfter.isFile() || openedAfter.isSymbolicLink()) return null;
    if (!sameIdentity(identityOf(opened), identityOf(openedAfter)) || opened.ctimeMs !== openedAfter.ctimeMs) return null;
    return { bytes, identity: identityOf(opened), ctimeMs: named.ctimeMs, openedCtimeMs: opened.ctimeMs };
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Published-plan inventory signature (exact fresh-vs-original comparison).
// ---------------------------------------------------------------------------

function inventorySignature(value: PublishedInventory): string {
  return JSON.stringify({
    unmarked: value.unmarked,
    roots: [...value.roots].sort(),
    directories: [...value.directories].sort(),
    published: [...value.published]
      .map((entry) => ({
        schema: entry.saved.schema,
        id: entry.saved.id,
        planSha256: entry.saved.plan_sha256,
        intentSha256: entry.saved.intent_sha256,
        createdUtc: entry.saved.created_utc,
        directory: entry.directory,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  });
}

function sameInventorySignature(a: PublishedInventory, b: PublishedInventory): boolean {
  return inventorySignature(a) === inventorySignature(b);
}

// ---------------------------------------------------------------------------
// Reader stdout validation (bounded ASCII/JSON framing, then exact schema).
// ---------------------------------------------------------------------------

function validateStdoutFraming(stdout: Buffer): string | null {
  if (!Buffer.isBuffer(stdout)) return null;
  if (stdout.length < 1 || stdout.length > MAX_STDOUT_BYTES) return null;
  for (let index = 0; index < stdout.length; index += 1) {
    const byte = stdout[index];
    if (byte > 0x7f || byte === 0x0d) return null;
    if (byte < 0x20 && byte !== 0x0a) return null;
  }
  if (stdout[stdout.length - 1] !== 0x0a) return null;
  const body = stdout.subarray(0, stdout.length - 1);
  if (body.includes(0x0a)) return null;
  return body.toString('ascii');
}

interface ProjectedDigests {
  personaSha256: string; approvalSha256: string; approvalLineageSha256: string;
  checkpointSha256: string; genManifestSha256: string;
}

function validatePythonResult(value: unknown, entry: GenSourceReadConfigEntry): ProjectedDigests | null {
  if (!isPlainObject(value) || !hasExactKeys(value, PYTHON_RESULT_KEYS)) return null;
  if (value.schema !== 'figment/gen-source-read@1') return null;
  if (value.result !== 'current-source-observed') return null;
  if (value.creator !== 'creator-001') return null;
  if (value.selected_plan_sha256 !== entry.planSha256) return null;
  if (value.source_plan_sha256 !== entry.sourcePlanSha256) return null;
  const persona = value.persona_sha256;
  const approval = value.approval_sha256;
  const lineage = value.approval_lineage_sha256;
  const checkpoint = value.checkpoint_sha256;
  if (
    typeof persona !== 'string' || !SHA256_RE.test(persona)
    || typeof approval !== 'string' || !SHA256_RE.test(approval)
    || typeof lineage !== 'string' || !SHA256_RE.test(lineage)
    || typeof checkpoint !== 'string' || !SHA256_RE.test(checkpoint)
  ) return null;
  const manifestItems = readPlainArray(value.gen_manifest_sha256, 1);
  if (manifestItems === null || manifestItems.length !== 1) return null;
  const manifestSha = manifestItems[0];
  if (typeof manifestSha !== 'string' || !SHA256_RE.test(manifestSha)) return null;
  if (value.gen_runs !== 1) return null;
  if (!isPlainObject(value.claims) || !hasExactKeys(value.claims, CLAIMS_KEYS)) return null;
  if (value.claims.launch_ready !== false || value.claims.quality_approved !== false
    || value.claims.atomic_snapshot !== false) return null;
  return {
    personaSha256: persona, approvalSha256: approval, approvalLineageSha256: lineage,
    checkpointSha256: checkpoint, genManifestSha256: manifestSha,
  };
}

// ---------------------------------------------------------------------------
// Pre-spawn and post-spawn checks
// ---------------------------------------------------------------------------

interface PreSpawnState {
  root: SafeRoot;
  selectedDir: string;
  sourceRootPath: string;
  adapterAbsPath: string;
  originalAdapter: AdapterRecord;
  observations: PublishedObservations;
  inventory: PublishedInventory;
  publishedDirectory: string;
}

async function runPreSpawnChecks(
  repoRoot: string, adapterPath: string, config: GenSourceReadConfig,
  entry: GenSourceReadConfigEntry, id: string,
): Promise<PreSpawnState | null> {
  try {
    const root = await safeRoot(repoRoot);
    if (root === null) return null;
    const adapterAbsPath = await safePath(root, adapterPath, 'file');
    if (adapterAbsPath === null) return null;
    const originalAdapter = await readAdapterRecord(adapterAbsPath);
    if (originalAdapter === null || sha256(originalAdapter.bytes) !== config.adapterSha256) return null;
    const { allocation } = studioPlanRoots(root.path);
    const selectedDir = await safePath(root, join(allocation, id), 'directory');
    if (selectedDir === null) return null;
    const sourceRootPath = await safePath(root, entry.sourceRoot, 'directory');
    if (sourceRootPath === null) return null;
    const observations: PublishedObservations = [];
    const inventory = await readPublishedStudioPlans(root, observations);
    await assertInventoryRoots(root, inventory);
    if (inventory.unmarked) return null;
    const matches = inventory.published.filter(
      (candidate) => candidate.saved.id === id && candidate.saved.plan_sha256 === entry.planSha256,
    );
    if (matches.length !== 1) return null;
    const publishedEntry = matches[0];
    // The configured entry's directory must be the canonical allocation path;
    // a legacy-rooted match cannot equal the allocation-rooted `selectedDir`.
    if (resolve(publishedEntry.directory) !== resolve(selectedDir)) return null;
    const preparedPlan = await publishedPlan(root, publishedEntry, observations);
    if (
      preparedPlan === null || preparedPlan.creator !== 'creator-001' || preparedPlan.stage !== 'gen'
      || preparedPlan.runCount !== 1 || preparedPlan.planSha256 !== entry.planSha256
    ) return null;
    return {
      root, selectedDir, sourceRootPath, adapterAbsPath, originalAdapter, observations, inventory,
      publishedDirectory: publishedEntry.directory,
    };
  } catch {
    return null;
  }
}

async function recheckOriginalAdapter(pre: PreSpawnState, config: GenSourceReadConfig): Promise<boolean> {
  const adapterRecheckPath = await safePath(pre.root, pre.adapterAbsPath, 'file');
  if (adapterRecheckPath === null) return false;
  const adapterAfter = await readAdapterRecord(adapterRecheckPath);
  return (
    adapterAfter !== null && sameIdentity(pre.originalAdapter.identity, adapterAfter.identity)
    && pre.originalAdapter.ctimeMs === adapterAfter.ctimeMs
    && pre.originalAdapter.openedCtimeMs === adapterAfter.openedCtimeMs
    && pre.originalAdapter.bytes.equals(adapterAfter.bytes)
    && sha256(adapterAfter.bytes) === config.adapterSha256
  );
}

async function runPostSpawnChecks(
  pre: PreSpawnState, config: GenSourceReadConfig, entry: GenSourceReadConfigEntry,
  id: string, stdout: Buffer, nowFn: () => Date,
): Promise<GenSourceReadResult | null> {
  try {
    const text = validateStdoutFraming(stdout);
    if (text === null) return null;
    let parsedOutput: unknown;
    try {
      parsedOutput = parseGenSourceJson(text, MAX_STDOUT_BYTES);
    } catch {
      return null;
    }
    const projected = validatePythonResult(parsedOutput, entry);
    if (projected === null) return null;

    // Fresh inventory must be identical to the one collected before spawn.
    const after = await readPublishedStudioPlans(pre.root);
    await assertInventoryRoots(pre.root, after);
    if (after.unmarked || !sameInventorySignature(pre.inventory, after)) return null;
    const afterMatch = after.published.find(
      (candidate) => candidate.saved.id === id && candidate.saved.plan_sha256 === entry.planSha256,
    );
    if (!afterMatch || resolve(afterMatch.directory) !== resolve(pre.publishedDirectory)) return null;
    const afterPlan = await publishedPlan(pre.root, afterMatch);
    if (
      afterPlan === null || afterPlan.creator !== 'creator-001' || afterPlan.stage !== 'gen'
      || afterPlan.runCount !== 1 || afterPlan.planSha256 !== entry.planSha256
    ) return null;

    // Rerun every original published-plan observation kept open, again.
    for (const observation of pre.observations) {
      if (!(await observation())) return null;
    }

    // Recheck the adapter's original observation again (not a fresh baseline).
    if (!(await recheckOriginalAdapter(pre, config))) return null;

    if (!(await currentRoot(pre.root))) return null;

    const candidate = {
      schema: 'figment/studio-gen-source-read@1',
      id,
      planSha256: entry.planSha256,
      outcome: 'source-checked',
      checkedAtUtc: nowFn().toISOString(),
      digests: {
        personaSha256: projected.personaSha256,
        approvalSha256: projected.approvalSha256,
        approvalLineageSha256: projected.approvalLineageSha256,
        sourcePlanSha256: entry.sourcePlanSha256,
        checkpointSha256: projected.checkpointSha256,
        genManifestSha256: [projected.genManifestSha256] as [string],
      },
      claims: { launchReady: false, qualityApproved: false, atomicSnapshot: false },
      limitations: [...GEN_SOURCE_LIMITATIONS] as [string, string, string, string],
    };
    return decodeGenSourceReadResult(candidate, id, entry.planSha256);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

type Slot = 'idle' | 'running' | 'quarantined';

export function registerFigmentGenSourceRead(
  app: FastifyInstance,
  options: {
    repoRoot: string;
    sessionConfig: SessionConfig;
    config?: GenSourceReadConfig | null;
    runProcess?: typeof runStudioPlanProcessCapture;
    now?: () => Date;
  },
): void {
  if (typeof options.repoRoot !== 'string' || !isAbsolute(options.repoRoot)) throw new Error(CONFIG_ERROR);
  const repoRoot = resolve(options.repoRoot);
  const parsedConfig = parseGenSourceReadConfig(options.config ?? null);
  const config = parsedConfig === null ? null : cloneConfig(parsedConfig);
  const entriesById = new Map<string, GenSourceReadConfigEntry>();
  for (const entry of config?.entries ?? []) entriesById.set(entry.id, entry);
  const runner = options.runProcess ?? runStudioPlanProcessCapture;
  const nowFn = options.now ?? (() => new Date());
  const adapterPath = join(repoRoot, 'orgs', 'figment', 'pipeline', 'gen_source_read.py');
  let slot: Slot = 'idle';

  const requestScopeFor = (subject: string): string =>
    sha256(JSON.stringify(['figment-studio-request-scope@1', repoRoot, subject]));

  app.get(
    '/api/figment/studio/gen-source-reads',
    { preHandler: requireSession(options.sessionConfig), exposeHeadRoute: false },
    async (request, reply) => {
      if ((request.raw.url ?? '').includes('?')) return reply.code(400).send({ error: 'query-not-allowed' });
      const length = request.headers['content-length'];
      if (request.body !== undefined || request.headers['transfer-encoding'] !== undefined
        || (length !== undefined && length !== '0')) return reply.code(400).send({ error: 'body-not-allowed' });
      const session = verifiedSession(request);
      if (session === undefined) return reply.code(401).send({ error: 'missing-session' });

      const inventory: GenSourceReadInventory = config === null
        ? { schema: 'figment/studio-gen-source-reads@1', configured: false, availability: 'not-configured', entries: [] }
        : {
          schema: 'figment/studio-gen-source-reads@1',
          configured: true,
          availability: slot === 'idle' ? 'available' : slot === 'running' ? 'busy' : 'quarantined',
          entries: config.entries.map((entry) => ({ id: entry.id, planSha256: entry.planSha256 })),
        };
      return reply.send(inventory);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/figment/studio/gen-plans/:id/source-check',
    { preHandler: requireSession(options.sessionConfig) },
    async (request, reply) => {
      if ((request.raw.url ?? '').includes('?')) return reply.code(400).send({ error: 'malformed' });
      const length = request.headers['content-length'];
      if (request.body !== undefined || request.headers['transfer-encoding'] !== undefined
        || (length !== undefined && length !== '0')) return reply.code(400).send({ error: 'malformed' });
      const session = verifiedSession(request);
      if (session === undefined) return reply.code(401).send({ error: 'missing-session' });

      const planHeader = request.headers['x-figment-plan-sha256'];
      const scopeHeader = request.headers['x-figment-request-scope'];
      if (typeof planHeader !== 'string' || !SHA256_RE.test(planHeader)) {
        return reply.code(400).send({ error: 'malformed' });
      }
      if (typeof scopeHeader !== 'string' || !SHA256_RE.test(scopeHeader)) {
        return reply.code(400).send({ error: 'malformed' });
      }
      if (scopeHeader !== requestScopeFor(session.claims.sub)) {
        return reply.code(409).send({ error: 'identity-mismatch' });
      }

      const id = request.params.id;
      if (typeof id !== 'string' || !GEN_SOURCE_ID_RE.test(id)) return reply.code(400).send({ error: 'malformed' });

      if (config === null) return reply.code(404).send({ error: 'unconfigured' });
      const entry = entriesById.get(id);
      if (entry === undefined) return reply.code(404).send({ error: 'unknown' });
      if (entry.planSha256 !== planHeader) return reply.code(409).send({ error: 'identity-mismatch' });

      // Reserve the single slot synchronously, before any await.
      if (slot === 'running') return reply.code(409).send({ error: 'busy' });
      if (slot === 'quarantined') return reply.code(423).send({ error: 'quarantined' });
      slot = 'running';

      const pre = await runPreSpawnChecks(repoRoot, adapterPath, config, entry, id);
      if (pre === null) {
        // No child was ever spawned: a known pre-spawn refusal returns to idle.
        slot = 'idle';
        return reply.code(503).send({ error: 'unavailable' });
      }

      const args = [
        '-I', '-B', pre.adapterAbsPath,
        '--creator', 'creator-001',
        '--selected-root', pre.selectedDir,
        '--selected-plan-sha256', entry.planSha256,
        '--source-root', pre.sourceRootPath,
        '--source-plan-sha256', entry.sourcePlanSha256,
        '--dependency-sha256', JSON.stringify(config.dependencySha256),
      ] as const;
      const runnerOptions = Object.freeze({
        cwd: repoRoot, timeout: 120_000, maxBuffer: 8_192, windowsHide: true, requireEmptyStderr: true,
      } satisfies StudioPlanProcessOptions);

      let stdout: Buffer;
      try {
        ({ stdout } = await runner(config.pythonExecutable, args, runnerOptions));
      } catch (error) {
        if (error instanceof StudioPlanProcessError && error.terminationUncertain === false) {
          // Confirmed clean teardown, typed failure: safe to reuse the slot.
          slot = 'idle';
          return reply.code(503).send({ error: 'unavailable' });
        }
        // Uncertain teardown, or an unclassified failure: never reuse the slot.
        slot = 'quarantined';
        return reply.code(423).send({ error: 'quarantined' });
      }

      // The runner is confirmed torn down past this point: any remaining
      // failure is an ordinary unavailability, never a fresh quarantine.
      const result = await runPostSpawnChecks(pre, config, entry, id, stdout, nowFn);
      slot = 'idle';
      if (result === null) return reply.code(503).send({ error: 'unavailable' });
      return reply.send(result);
    },
  );
}
