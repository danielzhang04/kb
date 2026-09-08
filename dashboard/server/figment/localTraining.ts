/** Fixed-root, historical projection of completed local preparation receipts. */
import { createHash } from 'node:crypto';
import { closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

const MAX_JSON_BYTES = 256 * 1024;
const MAX_JSON_DEPTH = 64;
const SHA256 = /^[a-f0-9]{64}$/;
const TOKENIZERS = new Map([
  ['openai/clip-vit-large-patch14', 49407],
  ['laion/CLIP-ViT-bigG-14-laion2B-39B-b160k', 0],
]);

export interface FigmentLocalTrainingEvidenceRoots {
  cpuPreflight: string;
  tokenizerLaunch: string;
  plan: string;
  tokenizerLoad: string;
}

export type LocalTrainingProjection =
  | { status: 'not-configured' }
  | { status: 'unavailable'; reason: 'evidence-unavailable' }
  | {
      status: 'recorded'; historical: true;
      preparation: {
        source: 'anchors/g01.jpg';
        originalObservations: 1;
        repeatCount: 1;
        targetResolution: [number, number];
        effectiveBucket: [number, number];
        cpuCudaMasked: true;
        cpuVerifiedTeardown: true;
        tokenizerLoads: Array<{ id: string; probeTokenCount: number }>;
      };
    };

interface SafeRoot { path: string; real: string; }
interface JsonRecord { value: Record<string, unknown>; raw: Buffer; }
interface PlanEvidence { rawHash: string; frozenHash: string; }
interface CpuEvidence { targetResolution: [number, number]; effectiveBucket: [number, number]; }

function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function integer(value: unknown, maximum = 100_000): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= maximum; }
function pair(value: unknown): value is [number, number] { return Array.isArray(value) && value.length === 2 && integer(value[0]) && value[0] > 0 && integer(value[1]) && value[1] > 0; }
function inside(root: string, candidate: string): boolean { const value = relative(root, candidate); return value === '' || (!value.startsWith(`..${sep}`) && value !== '..' && !isAbsolute(value)); }

function reparse(path: string): boolean {
  try {
    const info = lstatSync(path); const real = realpathSync(path);
    return info.isSymbolicLink() || resolve(real) !== resolve(path);
  } catch { return true; }
}

function openRoot(candidate: unknown): SafeRoot | null {
  if (typeof candidate !== 'string' || !candidate.trim()) return null;
  try {
    const path = resolve(candidate); const info = lstatSync(path);
    if (!info.isDirectory() || reparse(path)) return null;
    return { path, real: realpathSync(path) };
  } catch { return null; }
}

function safeFile(root: SafeRoot, name: string): string | null {
  const path = resolve(root.path, name);
  if (!inside(root.path, path)) return null;
  try {
    let cursor = root.path;
    for (const segment of relative(root.path, path).split(/[\\/]/).filter(Boolean)) {
      cursor = join(cursor, segment);
      if (reparse(cursor)) return null;
    }
    return lstatSync(path).isFile() && inside(root.real, realpathSync(path)) ? path : null;
  } catch { return null; }
}

function bounded(path: string): Buffer | null {
  let descriptor: number | null = null;
  try {
    descriptor = openSync(path, 'r');
    const before = fstatSync(descriptor);
    if (!before.isFile() || before.size < 1 || before.size > MAX_JSON_BYTES) return null;
    const data = Buffer.allocUnsafe(before.size);
    for (let offset = 0; offset < data.length;) {
      const count = readSync(descriptor, data, offset, data.length - offset, offset);
      if (count <= 0) return null;
      offset += count;
    }
    const after = fstatSync(descriptor);
    return after.isFile() && after.size === before.size ? data : null;
  } catch { return null; } finally { if (descriptor !== null) try { closeSync(descriptor); } catch { /* rejected above */ } }
}

function withinDepth(source: string): boolean {
  let depth = 0; let quoted = false; let escaped = false;
  for (const character of source) {
    if (quoted) { if (escaped) escaped = false; else if (character === '\\') escaped = true; else if (character === '"') quoted = false; continue; }
    if (character === '"') quoted = true;
    else if (character === '{' || character === '[') { depth += 1; if (depth > MAX_JSON_DEPTH) return false; }
    else if (character === '}' || character === ']') depth -= 1;
  }
  return !quoted && depth === 0;
}

function readJson(root: SafeRoot, name: string): JsonRecord | null {
  const path = safeFile(root, name); const raw = path === null ? null : bounded(path);
  if (raw === null) return null;
  try {
    const source = raw.toString('utf8'); const value: unknown = withinDepth(source) ? JSON.parse(source) : null;
    return object(value) ? { value, raw } : null;
  } catch { return null; }
}

function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value) as string;
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error('non-finite'); return JSON.stringify(value) as string; }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  throw new Error('non-json');
}

function frozen(record: Record<string, unknown>): string | null {
  const value = { ...record }; const actual = value.frozen_sha256;
  delete value.frozen_sha256;
  if (typeof actual !== 'string' || !SHA256.test(actual)) return null;
  try { return createHash('sha256').update(canonical(value)).digest('hex') === actual ? actual : null; } catch { return null; }
}

function validatePlan(record: JsonRecord): PlanEvidence | null {
  const value = record.value; const execution = object(value.execution) ? value.execution : null; const observation = object(value.observation) ? value.observation : null;
  const fit = object(value.fit_probe) ? value.fit_probe : null; const source = object(value.source) ? value.source : null; const hash = frozen(value);
  if (value.schema !== 'figment/local-single-observation-lora-plan@1' || value.creator !== 'creator-001' || value.not_promotable !== true || hash === null || execution === null || observation === null || fit === null || source === null) return null;
  if (execution.cpu_preflight_allowed !== true || execution.gpu_fit_probe_allowed !== false || execution.checkpoint_acceptance_allowed !== false || execution.sample_export_allowed !== false) return null;
  if (observation.count !== 1 || observation.independent_views !== 1 || observation.kind !== 'canonical-original-pixels' || fit.max_train_steps !== 10 || fit.samples !== 0 || fit.exports !== 0 || source.logical_path !== 'anchors/g01.jpg') return null;
  return { rawHash: createHash('sha256').update(record.raw).digest('hex'), frozenHash: hash };
}

function validateCpu(record: JsonRecord, plan: PlanEvidence): CpuEvidence | null {
  const value = record.value; const inputs = object(value.inputs) ? value.inputs : null; const process = object(value.process) ? value.process : null;
  const teardown = object(value.teardown) ? value.teardown : null; const result = object(value.result) ? value.result : null;
  if (value.schema !== 'figment/local-cpu-preflight-launch@1' || value.status !== 'complete' || value.plan_sha256 !== plan.frozenHash || inputs === null || process === null || teardown === null || result === null) return null;
  if (inputs.plan_canonical_sha256 !== plan.frozenHash || inputs.plan_file_sha256 !== plan.rawHash || process.exit_code !== 0 || teardown.verified_stopped !== true) return null;
  if (result.schema !== 'figment/local-single-observation-cpu-preflight@1' || result.plan_sha256 !== plan.frozenHash || result.observations !== 1 || result.unique_source_images !== 1 || result.repeat_count !== 1 || result.cuda_visible_devices !== '-1' || result.cuda_available !== false || result.cuda_device_count !== 0 || result.cuda_initialized !== false || result.not_promotable !== true || result.gpu_fit_probe_allowed !== false || !Array.isArray(result.offline_environment) || !result.offline_environment.includes('PYTORCH_NVML_BASED_CUDA_CHECK')) return null;
  const buckets = result.effective_buckets;
  return pair(result.target_resolution) && Array.isArray(buckets) && buckets.length === 1 && pair(buckets[0]) ? { targetResolution: result.target_resolution, effectiveBucket: buckets[0] } : null;
}

function validateTokenizer(outer: JsonRecord, inner: JsonRecord): Array<{ id: string; probeTokenCount: number }> | null {
  const launch = outer.value; const process = object(launch.process) ? launch.process : null; const teardown = object(launch.teardown) ? launch.teardown : null;
  const value = inner.value; const tokenizers = value.tokenizers; const hash = frozen(value);
  if (hash === null || launch.schema !== 'figment/local-tokenizer-load-launch@1' || launch.status !== 'complete' || process === null || teardown === null || process.exit_code !== 0 || teardown.verified_stopped !== true || launch.tokenizer_load_receipt_raw_sha256 !== createHash('sha256').update(inner.raw).digest('hex') || launch.tokenizer_load_receipt_frozen_sha256 !== hash) return null;
  if (value.schema !== 'figment/local-tokenizer-load@1' || value.not_promotable !== true || value.runtime_or_training_approval !== false || value.cuda_visible_devices !== '-1' || value.pytorch_nvml_based_cuda_check !== '1' || value.cuda_available !== false || value.cuda_device_count !== 0 || value.cuda_initialized !== false || value.torch_imported !== true || !Array.isArray(tokenizers) || tokenizers.length !== TOKENIZERS.size) return null;
  const result: Array<{ id: string; probeTokenCount: number }> = [];
  for (const item of tokenizers) {
    if (!object(item) || typeof item.id !== 'string' || item.class !== 'CLIPTokenizer' || item.local_files_only !== true || item.caption_token_count !== 19 || !integer(item.effective_pad_token_id, 100_000) || TOKENIZERS.get(item.id) !== item.effective_pad_token_id || result.some((row) => row.id === item.id)) return null;
    result.push({ id: item.id, probeTokenCount: item.caption_token_count });
  }
  return result.length === TOKENIZERS.size ? result.sort((a, b) => a.id.localeCompare(b.id)) : null;
}

/** Reads four configured receipt locations; it neither scans nor evaluates current training eligibility. */
export function collectLocalTrainingReadiness(roots?: FigmentLocalTrainingEvidenceRoots | null): LocalTrainingProjection {
  if (roots === undefined || roots === null) return { status: 'not-configured' };
  const cpuRoot = openRoot(roots.cpuPreflight); const tokenizerLaunchRoot = openRoot(roots.tokenizerLaunch); const planRoot = openRoot(roots.plan); const tokenizerLoadRoot = openRoot(roots.tokenizerLoad);
  if (cpuRoot === null || tokenizerLaunchRoot === null || planRoot === null || tokenizerLoadRoot === null) return { status: 'unavailable', reason: 'evidence-unavailable' };
  const planRecord = readJson(planRoot, 'local-single-observation-plan.json'); const cpuRecord = readJson(cpuRoot, 'receipt.json'); const tokenizerLaunch = readJson(tokenizerLaunchRoot, 'receipt.json'); const tokenizerLoad = readJson(tokenizerLoadRoot, 'local-tokenizer-load.json');
  if (planRecord === null || cpuRecord === null || tokenizerLaunch === null || tokenizerLoad === null) return { status: 'unavailable', reason: 'evidence-unavailable' };
  const plan = validatePlan(planRecord); const cpu = plan === null ? null : validateCpu(cpuRecord, plan); const tokenizerLoads = validateTokenizer(tokenizerLaunch, tokenizerLoad);
  return plan === null || cpu === null || tokenizerLoads === null
    ? { status: 'unavailable', reason: 'evidence-unavailable' }
    : { status: 'recorded', historical: true, preparation: { source: 'anchors/g01.jpg', originalObservations: 1, repeatCount: 1, targetResolution: cpu.targetResolution, effectiveBucket: cpu.effectiveBucket, cpuCudaMasked: true, cpuVerifiedTeardown: true, tokenizerLoads } };
}
