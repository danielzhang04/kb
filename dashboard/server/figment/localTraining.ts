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
export interface FigmentLocalTrainingResultRoots { tenStep: { run: string; plan: string; admissionParent: string }; currentQuality: { run: string; plan: string; admissionParent: string; cpu: string }; }
export type LocalTrainingResultsProjection = { status: 'not-configured' } | { status: 'unavailable'; reason: 'evidence-unavailable' } | { status: 'recorded'; historical: true; items: Array<{ kind: 'availability-probe' | 'current-quality-fit'; completed: true; durationSeconds: number; steps: number; artifactCount: number; checkpoints: Array<{ step: number; sha256: string; bytes: number }>; quality: 'not-evaluated' }> };

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

function resultRoot(value: string): SafeRoot | null { return openRoot(value); }
function validRun(value: Record<string, unknown>, schema: string): boolean { const teardown = object(value.teardown) ? value.teardown : null; return value.schema === schema && value.status === 'complete' && value.exit_code === 0 && value.failure === null && value.log_truncated === false && value.not_promotable === true && teardown?.verified_stopped === true; }
function duration(value: unknown, maximum: number): value is number { return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= maximum; }
function checkpoint(value: unknown, name: string, step: number): { step: number; sha256: string; bytes: number } | null {
  return object(value) && value.path === name && value.ss_steps === step && typeof value.sha256 === 'string' && SHA256.test(value.sha256) && integer(value.bytes, 300_000_000) && value.bytes > 0
    ? { step, sha256: value.sha256, bytes: value.bytes }
    : null;
}
function hash(raw: Buffer): string { return createHash('sha256').update(raw).digest('hex'); }
function validAdmission(value: Record<string, unknown>, schema: string, planHash: string, maxSteps: number, launcherHash: unknown, authorization: 'allow_gpu_fit_probe' | 'allow_gpu_quality'): boolean {
  return frozen(value) !== null && value.schema === schema && typeof value.admission_id === 'string' && value.admission_id.length > 0
    && value.plan_sha256 === planHash && value.max_train_steps === maxSteps && value.not_promotable === true
    && typeof value.launcher_sha256 === 'string' && SHA256.test(value.launcher_sha256) && value.launcher_sha256 === launcherHash && value[authorization] === true;
}
function resultRoots(value: unknown): value is FigmentLocalTrainingResultRoots {
  if (!object(value) || !object(value.tenStep) || !object(value.currentQuality)) return false;
  const ten = value.tenStep; const current = value.currentQuality;
  return typeof ten.run === 'string' && typeof ten.plan === 'string' && typeof ten.admissionParent === 'string'
    && typeof current.run === 'string' && typeof current.plan === 'string' && typeof current.admissionParent === 'string' && typeof current.cpu === 'string';
}
function validateCurrentPlan(record: JsonRecord): PlanEvidence | null {
  const value = record.value; const recipe = object(value.recipe) ? value.recipe : null; const observation = object(value.observation) ? value.observation : null;
  const execution = object(value.execution) ? value.execution : null; const frozenHash = frozen(value);
  const names = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((step) => `figmentlocalg01quality-current-100-step${String(step).padStart(8, '0')}.safetensors`).concat('figmentlocalg01quality-current-100.safetensors');
  const steps = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 100];
  if (frozenHash === null || value.schema !== 'figment/local-one-source-quality-plan@1' || value.creator !== 'creator-001' || value.branch !== 'current' || value.purpose !== 'one-source-local-quality-diagnostic' || value.not_promotable !== true || recipe === null || observation === null || execution === null) return null;
  if (observation.count !== 1 || observation.independent_views !== 1 || observation.kind !== 'canonical-original-pixels' || execution.cpu_preflight_allowed !== true || execution.gpu_quality_allowed !== false || execution.checkpoint_acceptance_allowed !== false || execution.sample_export_allowed !== false) return null;
  if (recipe.max_train_steps !== 100 || recipe.save_every_n_steps !== 10 || recipe.samples !== 0 || recipe.exports !== 0 || recipe.save_state !== false || !Array.isArray(recipe.checkpoint_names) || !Array.isArray(recipe.checkpoint_steps) || recipe.checkpoint_names.length !== names.length || recipe.checkpoint_steps.length !== steps.length) return null;
  if (!recipe.checkpoint_names.every((name, index) => name === names[index]) || !recipe.checkpoint_steps.every((step, index) => step === steps[index])) return null;
  return { rawHash: hash(record.raw), frozenHash };
}

/** Fixed-root historical run summaries; no checkpoint, log, or directory is read. */
export function collectLocalTrainingResults(roots?: FigmentLocalTrainingResultRoots | null): LocalTrainingResultsProjection {
  if (roots == null) return { status: 'not-configured' };
  if (!resultRoots(roots)) return { status: 'unavailable', reason: 'evidence-unavailable' };
  const tenRun = resultRoot(roots.tenStep.run), tenPlan = resultRoot(roots.tenStep.plan), tenAdmission = resultRoot(roots.tenStep.admissionParent), currentRun = resultRoot(roots.currentQuality.run), currentPlan = resultRoot(roots.currentQuality.plan), currentAdmission = resultRoot(roots.currentQuality.admissionParent), cpu = resultRoot(roots.currentQuality.cpu);
  if (!tenRun || !tenPlan || !tenAdmission || !currentRun || !currentPlan || !currentAdmission || !cpu) return { status: 'unavailable', reason: 'evidence-unavailable' };
  const ten = readJson(tenRun, 'receipt.json'), tenPlanRecord = readJson(tenPlan, 'local-single-observation-plan.json'), tenAdmissionRecord = readJson(tenAdmission, 'figment-local-lora-fit-admission-20260908-v2.json'), current = readJson(currentRun, 'receipt.json'), currentPlanRecord = readJson(currentPlan, 'local-quality-plan.json'), currentAdmissionRecord = readJson(currentAdmission, 'figment-local-quality-current-fit-admission-20260908-v1.json'), cpuRecord = readJson(cpu, 'receipt.json');
  if (!ten || !tenPlanRecord || !tenAdmissionRecord || !current || !currentPlanRecord || !currentAdmissionRecord || !cpuRecord) return { status: 'unavailable', reason: 'evidence-unavailable' };
  const tenPlanEvidence = validatePlan(tenPlanRecord); const currentPlanEvidence = validateCurrentPlan(currentPlanRecord); const tenFinal = object(ten.value.final_checkpoint) ? ten.value.final_checkpoint : null;
  const tenOk = tenPlanEvidence !== null && validRun(ten.value, 'figment/local-single-observation-fit-probe@1') && duration(ten.value.duration_seconds, 1200) && ten.value.plan_sha256 === tenPlanEvidence.frozenHash && ten.value.admission_id === tenAdmissionRecord.value.admission_id && validAdmission(tenAdmissionRecord.value, 'figment/local-single-observation-fit-admission@1', tenPlanEvidence.frozenHash, 10, ten.value.launcher_sha256, 'allow_gpu_fit_probe') && tenFinal && tenFinal.path === 'figmentlocalg01probe.safetensors' && typeof tenFinal.sha256 === 'string' && SHA256.test(tenFinal.sha256) && integer(tenFinal.bytes, 300_000_000) && tenFinal.bytes > 0;
  const inputs = object(current.value.inputs) ? current.value.inputs : null; const cpuInputs = object(cpuRecord.value.inputs) ? cpuRecord.value.inputs : null; const cpuResult = object(cpuRecord.value.result) ? cpuRecord.value.result : null;
  const cpuTeardown = object(cpuRecord.value.teardown) ? cpuRecord.value.teardown : null; const cpuProcess = object(cpuRecord.value.process) ? cpuRecord.value.process : null;
  const cpuOk = currentPlanEvidence !== null && cpuRecord.value.schema === 'figment/local-quality-cpu-preflight-launch@1' && cpuRecord.value.status === 'complete' && cpuRecord.value.branch === 'current' && cpuProcess?.exit_code === 0 && cpuTeardown?.verified_stopped === true && cpuInputs?.plan_canonical_sha256 === currentPlanEvidence.frozenHash && cpuInputs?.plan_file_sha256 === currentPlanEvidence.rawHash && cpuResult?.schema === 'figment/local-quality-cpu-preflight@1' && cpuResult.plan_sha256 === currentPlanEvidence.frozenHash && cpuResult.not_promotable === true && cpuResult.cuda_visible_devices === '-1' && cpuResult.cuda_available === false && cpuResult.cuda_device_count === 0 && cpuResult.cuda_initialized === false;
  const records = Array.isArray(current.value.checkpoints) ? current.value.checkpoints : [];
  const recipe = currentPlanEvidence && object(currentPlanRecord.value.recipe) ? currentPlanRecord.value.recipe : null;
  const recipeNames = recipe !== null && Array.isArray(recipe.checkpoint_names) ? recipe.checkpoint_names : null;
  const recipeSteps = recipe !== null && Array.isArray(recipe.checkpoint_steps) ? recipe.checkpoint_steps : null;
  const exactRecords = recipeNames !== null && recipeSteps !== null && records.length === recipeNames.length
    ? records.map((record, index) => checkpoint(record, recipeNames[index] as string, recipeSteps[index] as number))
    : [];
  const selected = exactRecords.length === 11 ? [exactRecords[1], exactRecords[4], exactRecords[10]] : [];
  const currentOk = currentPlanEvidence !== null && validRun(current.value, 'figment/local-quality-fit@1') && duration(current.value.duration_seconds, 1200) && current.value.plan_sha256 === currentPlanEvidence.frozenHash && inputs?.plan_sha256 === currentPlanEvidence.frozenHash && inputs?.plan_file_sha256 === currentPlanEvidence.rawHash && inputs?.cpu_receipt_sha256 === hash(cpuRecord.raw) && current.value.admission_id === currentAdmissionRecord.value.admission_id && validAdmission(currentAdmissionRecord.value, 'figment/local-quality-fit-admission@1', currentPlanEvidence.frozenHash, 100, current.value.launcher_sha256, 'allow_gpu_quality') && currentAdmissionRecord.value.cpu_receipt_sha256 === hash(cpuRecord.raw) && cpuOk && exactRecords.length === 11 && exactRecords.every(Boolean);
  if (!tenOk || !currentOk) return { status: 'unavailable', reason: 'evidence-unavailable' };
  return { status: 'recorded', historical: true, items: [{ kind: 'availability-probe', completed: true, durationSeconds: ten.value.duration_seconds as number, steps: 10, artifactCount: 1, checkpoints: [{ step: 10, sha256: tenFinal.sha256 as string, bytes: tenFinal.bytes as number }], quality: 'not-evaluated' }, { kind: 'current-quality-fit', completed: true, durationSeconds: current.value.duration_seconds as number, steps: 100, artifactCount: 11, checkpoints: selected as Array<{ step: number; sha256: string; bytes: number }>, quality: 'not-evaluated' }] };
}
