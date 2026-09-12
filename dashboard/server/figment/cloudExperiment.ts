/** Bounded, read-only status projections for configured Figment cloud experiments. */
import { createHash } from 'node:crypto';
import { closeSync, fstatSync, lstatSync, openSync, opendirSync, readSync, realpathSync } from 'node:fs';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';

const MAX_JSON_BYTES = 256 * 1024, MAX_DEPTH = 64, MAX_JOBS = 32, MAX_FILES_PER_JOB = 32, MAX_OUTPUTS = 128, MAX_ROOT_ENTRIES = 32;
const MAX_CHECKPOINT_BYTES = 512 * 1024 * 1024, SHA256 = /^[a-f0-9]{64}$/;
type Failure = 'bootstrap' | 'run';
export type CloudExperimentProjection =
  | { status: 'not-configured' }
  | { status: 'unavailable'; reason: 'evidence-unavailable' }
  | { status: 'recorded'; execution: 'started-pending-final' | 'failed' | 'completed'; liveness: 'unknown' | null; maxMinutes: number; maxUsd: number | null; preflightEstimateUsd: number | null; estimatedActualUsd: number | null; startedUtc: string; finishedUtc: string | null; terminationVerified: boolean | null; outputCount: number; quality: 'not-reviewed'; failure: Failure | null };
export type TrainFirstProjection =
  | { status: 'not-configured' }
  | { status: 'unavailable'; reason: 'evidence-unavailable' }
  | { status: 'recorded'; planSha256: string; creator: string; stage: 'train' | 'tester'; execution: 'planned' | 'running' | 'failed' | 'completed'; liveness: 'unknown' | null; maxMinutes: number; maxUsd: number; startedUtc: string | null; finishedUtc: string | null; terminationVerified: boolean | null; checkpoints: Array<{ name: string; bytes: number }>; outputCount: number; quality: 'not-reviewed' | 'recorded-rejection' | 'unavailable' };

interface Root { path: string; real: string; }
function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function inside(root: string, candidate: string): boolean { const value = relative(root, candidate); return value === '' || (!value.startsWith(`..${sep}`) && value !== '..' && !isAbsolute(value)); }
function reparse(path: string): boolean { try { const info = lstatSync(path), real = realpathSync(path); return info.isSymbolicLink() || resolve(real) !== resolve(path); } catch { return true; } }
function root(value: string | null | undefined): Root | null { if (!value?.trim() || !isAbsolute(value)) return null; try { const path = resolve(value); return lstatSync(path).isDirectory() && !reparse(path) ? { path, real: realpathSync(path) } : null; } catch { return null; } }
function file(root: Root, name: string): string | null { const path = resolve(root.path, name); if (!inside(root.path, path)) return null; try { let cursor = root.path; for (const segment of relative(root.path, path).split(/[\\/]/).filter(Boolean)) { cursor = resolve(cursor, segment); if (reparse(cursor)) return null; } return lstatSync(path).isFile() && inside(root.real, realpathSync(path)) ? path : null; } catch { return null; } }
function childRoot(parent: Root, name: string): Root | null { const path = resolve(parent.path, name); if (!inside(parent.path, path)) return null; try { let cursor = parent.path; for (const segment of relative(parent.path, path).split(/[\\/]/).filter(Boolean)) { cursor = resolve(cursor, segment); if (reparse(cursor)) return null; } return lstatSync(path).isDirectory() && inside(parent.real, realpathSync(path)) ? { path, real: realpathSync(path) } : null; } catch { return null; } }
function absent(root: Root, name: string): boolean {
  const path = resolve(root.path, name); if (!inside(root.path, path)) return false;
  let cursor = root.path;
  for (const segment of relative(root.path, path).split(/[\\/]/).filter(Boolean)) {
    cursor = resolve(cursor, segment);
    try { const info = lstatSync(cursor); if (info.isSymbolicLink() || resolve(realpathSync(cursor)) !== cursor) return false; }
    catch (error) { return (error as NodeJS.ErrnoException).code === 'ENOENT'; }
  }
  return false;
}
function bounded(path: string): Buffer | null { let descriptor: number | null = null; try { descriptor = openSync(path, 'r'); const before = fstatSync(descriptor); if (!before.isFile() || before.size < 1 || before.size > MAX_JSON_BYTES) return null; const bytes = Buffer.allocUnsafe(before.size); for (let offset = 0; offset < bytes.length;) { const count = readSync(descriptor, bytes, offset, bytes.length - offset, offset); if (count <= 0) return null; offset += count; } const after = fstatSync(descriptor); return after.isFile() && after.size === before.size ? bytes : null; } catch { return null; } finally { if (descriptor !== null) try { closeSync(descriptor); } catch { /* invalid above */ } } }
function decoded(raw: Buffer): Record<string, unknown> | null { try { const source = raw.toString('utf8'); const value: unknown = shallow(source) ? JSON.parse(source) : null; return object(value) ? value : null; } catch { return null; } }
function json(path: string): Record<string, unknown> | null { const raw = bounded(path); return raw === null ? null : decoded(raw); }
function jsonDigest(path: string): { value: Record<string, unknown>; sha256: string } | null { const raw = bounded(path); if (raw === null) return null; const value = decoded(raw); return value === null ? null : { value, sha256: createHash('sha256').update(raw).digest('hex') }; }
const NUMBER_SOURCE = Symbol('canonical-number-source');
type CanonicalNumber = { [NUMBER_SOURCE]: string };
function canonicalNumber(source: unknown, value: number): CanonicalNumber | null {
  if (typeof source !== 'string' || !Number.isFinite(value)) return null;
  if (!source.includes('.') && !/[eE]/.test(source)) return Number.isSafeInteger(value) && source === String(value) ? { [NUMBER_SOURCE]: source } : null;
  if (!/^-?(?:0|[1-9]\d*)\.(?:0|\d*[1-9])$/.test(source)) return null;
  const magnitude = Math.abs(value);
  if (magnitude !== 0 && (magnitude < 1e-4 || magnitude >= 1e16)) return null;
  const rendered = Object.is(value, -0) ? '-0.0' : Number.isInteger(value) ? `${String(value)}.0` : String(value);
  return rendered === source ? { [NUMBER_SOURCE]: source } : null;
}
function canonicalJson(value: unknown): string | null {
  if (object(value) && NUMBER_SOURCE in value) return typeof (value as CanonicalNumber)[NUMBER_SOURCE] === 'string' ? (value as CanonicalNumber)[NUMBER_SOURCE] : null;
  if (value === null || typeof value === 'boolean') return String(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) { const rows = value.map(canonicalJson); return rows.some((row) => row === null) ? null : `[${rows.join(',')}]`; }
  if (object(value)) { const rows = Object.keys(value).sort().map((key) => { const row = canonicalJson(value[key]); return row === null ? null : `${JSON.stringify(key)}:${row}`; }); return rows.some((row) => row === null) ? null : `{${rows.join(',')}}`; }
  return null;
}
function jsonCanonicalSubject(path: string): { value: Record<string, unknown>; subjectSha256: string } | null {
  const raw = bounded(path); if (raw === null) return null;
  const value = decoded(raw); if (value === null) return null;
  try {
    let valid = true;
    const annotated: unknown = JSON.parse(raw.toString('utf8'), function (_key: string, value: unknown) {
      if (typeof value !== 'number') return value;
      const wrapped = canonicalNumber((arguments[2] as { source?: unknown } | undefined)?.source, value);
      if (wrapped === null) valid = false;
      return wrapped ?? value;
    });
    const subject = object(annotated) ? annotated.subject : null, canonical = valid ? canonicalJson(subject) : null;
    return canonical === null ? null : { value, subjectSha256: createHash('sha256').update(canonical, 'utf8').digest('hex') };
  } catch { return null; }
}
function size(path: string, maximum: number): number | null { let descriptor: number | null = null; try { descriptor = openSync(path, 'r'); const info = fstatSync(descriptor); return info.isFile() && info.size > 0 && info.size <= maximum ? info.size : null; } catch { return null; } finally { if (descriptor !== null) try { closeSync(descriptor); } catch { /* invalid above */ } } }
function shallow(source: string): boolean { let depth = 0, quoted = false, escaped = false; for (const character of source) { if (quoted) { if (escaped) escaped = false; else if (character === '\\') escaped = true; else if (character === '"') quoted = false; continue; } if (character === '"') quoted = true; else if (character === '{' || character === '[') { depth += 1; if (depth > MAX_DEPTH) return false; } else if (character === '}' || character === ']') depth -= 1; } return !quoted && depth === 0; }
function finite(value: unknown, maximum: number): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= maximum; }
function iso(value: unknown): value is string { return typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value)); }
function recovery(root: Root): string | null { try { const directory = opendirSync(root.path); let candidate: string | null = null, entries = 0; try { for (let entry = directory.readSync(); entry !== null; entry = directory.readSync()) { if (++entries > MAX_ROOT_ENTRIES) return null; if (entry.isFile() && /^recovery-[A-Za-z0-9._-]{1,160}\.json$/.test(entry.name)) { if (candidate !== null) return null; candidate = entry.name; } } } finally { directory.closeSync(); } return candidate === null ? null : file(root, candidate); } catch { return null; } }
function outputCount(jobs: unknown[]): number | null { let total = 0; for (const job of jobs) { if (!object(job) || !Array.isArray(job.files) || job.files.length > MAX_FILES_PER_JOB) return null; for (const item of job.files) { if (!object(item)) return null; const bytes = item.bytes; if (typeof item.path !== 'string' || item.path.length < 1 || item.path.length > 240 || /[\\/]/.test(item.path) || typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes < 0) return null; if (++total > MAX_OUTPUTS) return null; } } return total; }
function acquiredRecovery(raw: Buffer, opened: Root, journalPath: string): CloudExperimentProjection | null { try {
  const source = raw.toString('utf8'); const value: unknown = shallow(source) ? JSON.parse(source) : null;
  const required = new Set(['schema', 'state', 'attempt_id', 'pod_name', 'manifest_path', 'manifest_sha256', 'max_minutes', 'max_usd', 'created_utc', 'receipt_path', 'pod_id', 'absence_verified', 'intent_sha256']);
  const known = new Set([...required, 'provider_last_started_utc', 'recovery_status', 'recovery_error_code', 'recovered_utc']);
  if (!object(value) || Object.keys(value).some((key) => !known.has(key)) || [...required].some((key) => !(key in value)) || value.schema !== 'figment/pod-recovery@1' || value.state !== 'acquired' || value.absence_verified !== false) return null;
  const podName = value.pod_name, attemptId = value.attempt_id, podId = value.pod_id, manifestPath = value.manifest_path, receiptPath = value.receipt_path;
  if (typeof podName !== 'string' || !/^figment-bakeoff-[0-9]{8}-[0-9]{6}-[0-9a-f]{6}$/.test(podName) || attemptId !== podName || basename(journalPath) !== `recovery-${podName}.json`) return null;
  if (typeof podId !== 'string' || podId.length > 160 || !/^[A-Za-z0-9-]+$/.test(podId) || typeof value.manifest_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.manifest_sha256) || typeof value.intent_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.intent_sha256)) return null;
  if (typeof manifestPath !== 'string' || manifestPath.length > 1024 || !isAbsolute(manifestPath) || typeof receiptPath !== 'string' || receiptPath.length > 1024 || !isAbsolute(receiptPath) || resolve(receiptPath) !== resolve(opened.path, 'run.json')) return null;
  if (!iso(value.created_utc) || !finite(value.max_minutes, 840) || value.max_minutes <= 0 || !finite(value.max_usd, 50) || value.max_usd <= 0) return null;
  if (value.provider_last_started_utc !== undefined && !iso(value.provider_last_started_utc)) return null;
  if (value.recovery_status !== undefined || value.recovery_error_code !== undefined || value.recovered_utc !== undefined) return null;
  return { status: 'recorded', execution: 'started-pending-final', liveness: 'unknown', maxMinutes: value.max_minutes, maxUsd: value.max_usd, preflightEstimateUsd: null, estimatedActualUsd: null, startedUtc: value.created_utc, finishedUtc: null, terminationVerified: null, outputCount: 0, quality: 'not-reviewed', failure: null };
} catch { return null; } }

/** Never projects pod ids, errors, bootstrap logs, uploads, artifact names, or filesystem paths. */
export function collectCloudExperiment(configuredRoot?: string | null): CloudExperimentProjection {
  if (configuredRoot == null || !configuredRoot.trim()) return { status: 'not-configured' };
  const opened = root(configuredRoot); if (opened === null) return { status: 'unavailable', reason: 'evidence-unavailable' };
  const path = file(opened, 'run.json'); const raw = path === null ? null : bounded(path);
  if (raw === null) { const journal = recovery(opened); if (journal === null) return { status: 'unavailable', reason: 'evidence-unavailable' }; const pending = bounded(journal); if (pending === null) return { status: 'unavailable', reason: 'evidence-unavailable' }; return acquiredRecovery(pending, opened, journal) ?? { status: 'unavailable', reason: 'evidence-unavailable' }; }
  try {
    const source = raw.toString('utf8'); const value: unknown = shallow(source) ? JSON.parse(source) : null;
    if (!object(value) || value.schema !== 'figment/runpod-run@1' || value.dry_run !== false || !iso(value.started_utc) || !finite(value.max_minutes, 840) || value.max_minutes <= 0 || !finite(value.preflight_estimate_usd, 50) || value.preflight_estimate_usd <= 0 || !Array.isArray(value.jobs) || value.jobs.length > MAX_JOBS || !iso(value.finished_utc)) throw new Error('malformed');
    const finished = value.finished_utc;
    const actual = value.estimated_actual_usd === undefined || value.estimated_actual_usd === null ? null : finite(value.estimated_actual_usd, 50) ? value.estimated_actual_usd : null;
    if (value.estimated_actual_usd !== undefined && value.estimated_actual_usd !== null && actual === null) throw new Error('malformed');
    const terminated = value.termination_verified === undefined || value.termination_verified === null ? null : typeof value.termination_verified === 'boolean' ? value.termination_verified : null;
    if (value.termination_verified !== undefined && value.termination_verified !== null && terminated === null) throw new Error('malformed');
    if (value.error !== undefined && (typeof value.error !== 'string' || value.error.length === 0)) throw new Error('malformed');
    const error = typeof value.error === 'string' ? value.error : null;
    const outputs = outputCount(value.jobs); if (outputs === null) throw new Error('malformed');
    return { status: 'recorded', execution: error !== null ? 'failed' : 'completed', liveness: null, maxMinutes: value.max_minutes, maxUsd: null, preflightEstimateUsd: value.preflight_estimate_usd, estimatedActualUsd: actual, startedUtc: value.started_utc, finishedUtc: finished, terminationVerified: terminated, outputCount: outputs, quality: 'not-reviewed', failure: error === null ? null : error.startsWith('BootstrapFailed:') ? 'bootstrap' : 'run' };
  } catch { return { status: 'unavailable', reason: 'evidence-unavailable' }; }
}

interface ManifestArtifact { remote: string; local: string; type: string; waitFor: string; }
interface PlannedRun { manifest: string; sha256: string; out: string; maxMinutes: number; maxUsd: number; artifacts: ManifestArtifact[]; outputs: string[]; }
function argvValue(argv: unknown, flag: string): string | null {
  if (!Array.isArray(argv) || argv.length < 2 || argv.length > 32 || argv.some((item) => typeof item !== 'string' || item.length > 2048)) return null;
  const indexes = argv.flatMap((item, index) => item === flag ? [index] : []);
  return indexes.length === 1 && indexes[0] + 1 < argv.length ? argv[indexes[0] + 1] as string : null;
}
function plannedRun(opened: Root, value: unknown): PlannedRun | null {
  if (!object(value) || typeof value.manifest !== 'string' || typeof value.out !== 'string' || typeof value.sha256 !== 'string' || !SHA256.test(value.sha256) || typeof value.ceiling_usd !== 'string') return null;
  const maximum = Number(value.ceiling_usd), minutes = Number(argvValue(value.argv, '--max-minutes')), argvMaximum = Number(argvValue(value.argv, '--max-usd'));
  const argvManifest = argvValue(value.argv, '--manifest'), argvOutput = argvValue(value.argv, '--out'), budget = object(value.budget) ? value.budget : null;
  const manifest = file(opened, value.manifest), output = childRoot(opened, value.out), manifestRecord = manifest === null ? null : jsonDigest(manifest);
  if (manifest === null || manifestRecord === null || (output === null && !absent(opened, value.out)) || manifestRecord.sha256 !== value.sha256 || !finite(maximum, 50) || maximum <= 0 || argvMaximum !== maximum || !finite(minutes, 840) || minutes <= 0 || typeof argvManifest !== 'string' || resolve(argvManifest) !== resolve(opened.path, value.manifest) || typeof argvOutput !== 'string' || resolve(argvOutput) !== resolve(opened.path, value.out) || (budget !== null && budget.max_minutes !== minutes)) return null;
  const manifestValue = manifestRecord.value;
  const rawArtifacts = manifestValue.artifacts, rawJobs = manifestValue.jobs;
  const artifacts: ManifestArtifact[] = [];
  if (rawArtifacts !== undefined && (!Array.isArray(rawArtifacts) || rawArtifacts.length > 8)) return null;
  if (Array.isArray(rawArtifacts)) for (const row of rawArtifacts) {
    if (!object(row) || typeof row.remote !== 'string' || basename(row.remote) !== row.remote || typeof row.local !== 'string' || basename(row.local) !== row.local || !row.local.endsWith('.safetensors') || row.remote !== row.local || typeof row.type !== 'string' || typeof row.wait_for !== 'string' || artifacts.some((item) => item.local === row.local)) return null;
    artifacts.push({ remote: row.remote, local: row.local, type: row.type, waitFor: row.wait_for });
  }
  const outputs: string[] = [];
  if (rawJobs !== undefined && (!Array.isArray(rawJobs) || rawJobs.length > MAX_JOBS)) return null;
  if (Array.isArray(rawJobs)) for (const row of rawJobs) {
    if (!object(row) || typeof row.output_name !== 'string' || basename(row.output_name) !== row.output_name || row.expected_images !== 1 || outputs.includes(row.output_name)) return null;
    outputs.push(row.output_name);
  }
  return { manifest: value.manifest, sha256: value.sha256, out: value.out, maxMinutes: minutes, maxUsd: maximum, artifacts, outputs };
}
function safeRun(opened: Root, plan: Record<string, unknown>, stage: 'train' | 'tester'): PlannedRun | null {
  const stages = object(plan.stages) ? plan.stages : null, section = stages && object(stages[stage]) ? stages[stage] : null, runs = section?.runs;
  return Array.isArray(runs) && runs.length === 1 ? plannedRun(opened, runs[0]) : null;
}
function attemptState(value: unknown): 'running' | 'failed' | 'complete' | null { return object(value) && (value.status === 'running' || value.status === 'failed' || value.status === 'complete') ? value.status : null; }
function testerOutputs(output: Root, run: PlannedRun, jobs: unknown): number | null {
  if (run.outputs.length !== 5 || !Array.isArray(jobs) || jobs.length !== run.outputs.length) return null;
  const seen = new Set<string>();
  for (const [index, job] of jobs.entries()) {
    if (!object(job) || job.output_name !== run.outputs[index] || !Array.isArray(job.files) || job.files.length !== 1 || !object(job.files[0])) return null;
    const item = job.files[0], name = item.path, recordedBytes = item.bytes;
    if (typeof name !== 'string' || basename(name) !== name || !name.toLowerCase().endsWith('.png') || seen.has(name) || typeof recordedBytes !== 'number' || !Number.isSafeInteger(recordedBytes) || recordedBytes <= 0) return null;
    const path = file(output, name); if (path === null || size(path, 64 * 1024 * 1024) !== recordedBytes) return null;
    seen.add(name);
  }
  return seen.size;
}
interface TesterOutput { imageId: string; name: string; bytes: number; }
function testerOutputRows(output: Root, run: PlannedRun, jobs: unknown): TesterOutput[] | null {
  if (run.outputs.length !== 5 || !Array.isArray(jobs) || jobs.length !== run.outputs.length) return null;
  const rows: TesterOutput[] = [], seen = new Set<string>();
  for (const [index, job] of jobs.entries()) {
    if (!object(job) || job.output_name !== run.outputs[index] || !Array.isArray(job.files) || job.files.length !== 1 || !object(job.files[0])) return null;
    const item = job.files[0], name = item.path, recordedBytes = item.bytes;
    if (typeof name !== 'string' || basename(name) !== name || !name.toLowerCase().endsWith('.png') || seen.has(name) || typeof recordedBytes !== 'number' || !Number.isSafeInteger(recordedBytes) || recordedBytes <= 0) return null;
    const path = file(output, name); if (path === null || size(path, 64 * 1024 * 1024) !== recordedBytes) return null;
    seen.add(name); rows.push({ imageId: run.outputs[index], name, bytes: recordedBytes });
  }
  return rows;
}
function reviewSubjectMatches(subject: unknown, creator: string, planSha256: string, run: PlannedRun, outputs: TesterOutput[]): boolean {
  if (!object(subject) || subject.creator !== creator || subject.stage !== 'tester' || !object(subject.plan) || subject.plan.name !== 'plan.json' || subject.plan.sha256 !== planSha256 || !Array.isArray(subject.manifests) || subject.manifests.length !== 1 || !object(subject.manifests[0]) || subject.manifests[0].name !== basename(run.manifest) || subject.manifests[0].sha256 !== run.sha256 || !Array.isArray(subject.images) || subject.images.length !== outputs.length) return false;
  return subject.images.every((row, index) => object(row) && row.image_id === outputs[index].imageId && row.name === outputs[index].name && row.bytes === outputs[index].bytes && typeof row.sha256 === 'string' && SHA256.test(row.sha256));
}
function structural(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(structural);
  if (object(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, structural(value[key])]));
  return value;
}
function sameStructure(left: unknown, right: unknown): boolean { return JSON.stringify(structural(left)) === JSON.stringify(structural(right)); }
function testerReviewQuality(opened: Root, creator: string, planSha256: string, run: PlannedRun): 'not-reviewed' | 'recorded-rejection' | 'unavailable' {
  const grade = childRoot(opened, 'grade/tester');
  if (grade === null) return absent(opened, 'grade/tester') ? 'not-reviewed' : 'unavailable';
  const decisionNames = ['rulings.json', 'review-manifest.json', 'rejection-lineage.json'] as const;
  const decisionPaths = decisionNames.map((name) => file(grade, name));
  const decisionsMissing = decisionNames.map((name) => absent(grade, name));
  const forbidden = ['approval-lineage.json', 'approved-list.json', 'accepted-checkpoint.json', 'approved'];
  if (decisionPaths.every((path) => path === null) && decisionsMissing.every(Boolean)) return forbidden.every((name) => absent(grade, name)) ? 'not-reviewed' : 'unavailable';
  const evaluationPath = file(grade, 'evaluation-inputs.json');
  if (evaluationPath === null || decisionPaths.some((path) => path === null) || forbidden.some((name) => !absent(grade, name))) return 'unavailable';
  const evaluationRecord = jsonCanonicalSubject(evaluationPath), rulingsRecord = jsonDigest(decisionPaths[0] as string), review = json(decisionPaths[1] as string), rejection = json(decisionPaths[2] as string);
  const outputRoot = childRoot(opened, run.out), receiptPath = outputRoot === null ? null : file(outputRoot, 'run.json'), receipt = receiptPath === null ? null : json(receiptPath);
  const outputs = outputRoot === null || receipt === null ? null : testerOutputRows(outputRoot, run, receipt.jobs);
  if (evaluationRecord === null || rulingsRecord === null || review === null || rejection === null || outputs === null) return 'unavailable';
  const evaluation = evaluationRecord.value;
  const subjectSha256 = evaluation.subject_sha256;
  if (evaluation.schema !== 'figment/evaluation-inputs@1' || evaluation.creator !== creator || evaluation.stage !== 'tester' || typeof subjectSha256 !== 'string' || !SHA256.test(subjectSha256) || subjectSha256 !== evaluationRecord.subjectSha256 || !reviewSubjectMatches(evaluation.subject, creator, planSha256, run, outputs)) return 'unavailable';
  const rulings = rulingsRecord.value, rulingRows = rulings.rulings;
  if (rulings.schema !== 'figment/rulings@1' || rulings.creator !== creator || rulings.stage !== 'tester' || rulings.evaluation_subject_sha256 !== subjectSha256 || typeof rulings.decided_by !== 'string' || !rulings.decided_by.trim() || !iso(rulings.decided_at) || !Array.isArray(rulingRows) || rulingRows.length !== outputs.length || !rulingRows.every((row, index) => object(row) && row.image_id === outputs[index].imageId && row.decision === 'cull')) return 'unavailable';
  if (review.creator !== creator || review.stage !== 'tester' || !Array.isArray(review.images) || review.images.length !== outputs.length || !review.images.every((row, index) => object(row) && row.image_id === outputs[index].imageId && typeof row.path === 'string' && basename(row.path) === outputs[index].name && (row.review_status === 'parked' || row.review_status === 'verified'))) return 'unavailable';
  if (rejection.schema !== 'figment/approval-lineage@1' || rejection.creator !== creator || rejection.stage !== 'tester' || rejection.decision !== 'rejected' || rejection.decided_by !== rulings.decided_by || rejection.decided_at !== rulings.decided_at || rejection.rulings_sha256 !== rulingsRecord.sha256 || rejection.reviewed_subject_sha256 !== subjectSha256 || rejection.subject_sha256 !== subjectSha256 || !reviewSubjectMatches(rejection.reviewed_subject, creator, planSha256, run, outputs) || !reviewSubjectMatches(rejection.subject, creator, planSha256, run, outputs) || !sameStructure(rejection.reviewed_subject, evaluation.subject) || !sameStructure(rejection.subject, evaluation.subject) || !object(rejection.transition) || rejection.transition.kind !== 'none' || rejection.transition.requires_replan !== false) return 'unavailable';
  return 'recorded-rejection';
}
function terminalReceipt(opened: Root, run: PlannedRun, stage: 'train' | 'tester'): Pick<Extract<TrainFirstProjection, { status: 'recorded' }>, 'execution' | 'startedUtc' | 'finishedUtc' | 'terminationVerified' | 'checkpoints' | 'outputCount'> | null {
  const output = childRoot(opened, run.out); if (output === null) return null;
  const receiptPath = file(output, 'run.json'), receipt = receiptPath === null ? null : json(receiptPath);
  if (receipt === null || receipt.schema !== 'figment/runpod-run@1' || receipt.dry_run !== false || receipt.max_minutes !== run.maxMinutes || !finite(receipt.preflight_estimate_usd, run.maxUsd) || receipt.preflight_estimate_usd <= 0 || !iso(receipt.started_utc) || !iso(receipt.finished_utc) || Date.parse(receipt.finished_utc) < Date.parse(receipt.started_utc) || receipt.termination_verified !== true || !Array.isArray(receipt.placement_attempts) || receipt.placement_attempts.length < 1 || receipt.placement_attempts.some((row) => !object(row) || row.termination_verified !== true)) return null;
  const error = receipt.error;
  if (error !== undefined && (typeof error !== 'string' || !error)) return null;
  if (error !== undefined) return { execution: 'failed', startedUtc: receipt.started_utc, finishedUtc: receipt.finished_utc, terminationVerified: true, checkpoints: [], outputCount: 0 };
  if (stage === 'train') {
    if (run.artifacts.length !== 5 || !Array.isArray(receipt.artifacts) || receipt.artifacts.length !== run.artifacts.length) return null;
    const checkpoints: Array<{ name: string; bytes: number }> = [];
    for (const [index, row] of receipt.artifacts.entries()) {
      const expected = run.artifacts[index];
      if (!object(row) || row.remote !== expected.remote || row.path !== expected.local || row.type !== expected.type || row.wait_for !== expected.waitFor || typeof row.bytes !== 'number' || !Number.isSafeInteger(row.bytes) || row.bytes <= 0 || row.bytes > MAX_CHECKPOINT_BYTES) return null;
      const path = file(output, expected.local); if (path === null || size(path, MAX_CHECKPOINT_BYTES) !== row.bytes) return null;
      checkpoints.push({ name: expected.local, bytes: row.bytes });
    }
    return { execution: 'completed', startedUtc: receipt.started_utc, finishedUtc: receipt.finished_utc, terminationVerified: true, checkpoints, outputCount: 0 };
  }
  const outputs = testerOutputs(output, run, receipt.jobs);
  return outputs === 5 ? { execution: 'completed', startedUtc: receipt.started_utc, finishedUtc: receipt.finished_utc, terminationVerified: true, checkpoints: [], outputCount: outputs } : null;
}

/** Projects one exact, server-configured train-first plan; request data cannot select its root. */
export function collectTrainFirst(configuredRoot?: string | null, allowedPlanSha256?: string | null): TrainFirstProjection {
  if ((configuredRoot == null || !configuredRoot.trim()) && (allowedPlanSha256 == null || !allowedPlanSha256.trim())) return { status: 'not-configured' };
  if (configuredRoot == null || !configuredRoot.trim() || typeof allowedPlanSha256 !== 'string' || !SHA256.test(allowedPlanSha256)) return { status: 'unavailable', reason: 'evidence-unavailable' };
  const opened = root(configuredRoot), planPath = opened === null ? null : file(opened, 'plan.json'), planRecord = planPath === null ? null : jsonDigest(planPath);
  const plan = planRecord?.value;
  if (opened === null || planRecord?.sha256 !== allowedPlanSha256 || plan === undefined || plan.schema !== 'figment/train-plan@1' || plan.variant !== 'train-first' || typeof plan.creator !== 'string' || !/^[A-Za-z0-9._-]{1,80}$/.test(plan.creator)) return { status: 'unavailable', reason: 'evidence-unavailable' };
  const train = safeRun(opened, plan, 'train'), tester = safeRun(opened, plan, 'tester');
  if (train === null || tester === null || train.artifacts.length !== 5 || train.artifacts.some((item) => item.type !== 'output' || item.waitFor !== '_training.complete') || tester.artifacts.length !== 0 || tester.outputs.length !== 5) return { status: 'unavailable', reason: 'evidence-unavailable' };
  const stagePath = file(opened, 'stage.json');
  if (stagePath === null) return absent(opened, 'stage.json') ? { status: 'recorded', planSha256: allowedPlanSha256, creator: plan.creator, stage: 'train', execution: 'planned', liveness: null, maxMinutes: train.maxMinutes, maxUsd: train.maxUsd, startedUtc: null, finishedUtc: null, terminationVerified: null, checkpoints: [], outputCount: 0, quality: 'not-reviewed' } : { status: 'unavailable', reason: 'evidence-unavailable' };
  const state = json(stagePath), runs = state && object(state.runs) ? state.runs : null, completed = state?.completed_stages;
  if (state === null || state.schema !== 'figment/train-stage@1' || state.creator !== plan.creator || state.plan_sha256 !== allowedPlanSha256 || runs === null || !Array.isArray(completed) || completed.some((item) => item !== 'train' && item !== 'tester') || new Set(completed).size !== completed.length || (completed.includes('tester') && !completed.includes('train'))) return { status: 'unavailable', reason: 'evidence-unavailable' };
  const testerAttempt = attemptState(runs[tester.manifest]), trainAttempt = attemptState(runs[train.manifest]);
  const selectedStage: 'train' | 'tester' = testerAttempt !== null || completed.includes('tester') || state.status === 'running:tester' || state.status === 'stopped:tester' ? 'tester' : 'train';
  const selectedRun = selectedStage === 'tester' ? tester : train, attempt = selectedStage === 'tester' ? testerAttempt : trainAttempt;
  const expectedStatus = attempt === 'running' ? `running:${selectedStage}` : attempt === 'failed' ? `stopped:${selectedStage}` : selectedStage === 'tester' ? new Set(['complete:tester', 'complete']) : new Set(['complete:train', 'complete']);
  if (attempt === null || (typeof expectedStatus === 'string' ? state.status !== expectedStatus : !expectedStatus.has(String(state.status))) || (attempt === 'complete') !== completed.includes(selectedStage) || (selectedStage === 'tester' && !completed.includes('train'))) return { status: 'unavailable', reason: 'evidence-unavailable' };
  const selectedRecord = runs[selectedRun.manifest];
  const started = object(selectedRecord) && iso(selectedRecord.started_utc) ? selectedRecord.started_utc : null;
  if (attempt === 'running') return started === null ? { status: 'unavailable', reason: 'evidence-unavailable' } : { status: 'recorded', planSha256: allowedPlanSha256, creator: plan.creator, stage: selectedStage, execution: 'running', liveness: 'unknown', maxMinutes: selectedRun.maxMinutes, maxUsd: selectedRun.maxUsd, startedUtc: started, finishedUtc: null, terminationVerified: null, checkpoints: [], outputCount: 0, quality: 'not-reviewed' };
  const terminal = terminalReceipt(opened, selectedRun, selectedStage);
  if (terminal === null || (attempt === 'complete' && terminal.execution !== 'completed') || (attempt === 'failed' && terminal.execution !== 'failed')) return { status: 'unavailable', reason: 'evidence-unavailable' };
  const quality = selectedStage === 'tester' && terminal.execution === 'completed' ? testerReviewQuality(opened, plan.creator, allowedPlanSha256, tester) : 'not-reviewed';
  return { status: 'recorded', planSha256: allowedPlanSha256, creator: plan.creator, stage: selectedStage, liveness: null, maxMinutes: selectedRun.maxMinutes, maxUsd: selectedRun.maxUsd, quality, ...terminal };
}

type RecordedGenReceipt = Pick<Extract<CloudExperimentProjection, { status: 'recorded' }>,
  'startedUtc' | 'finishedUtc' | 'terminationVerified' | 'outputCount' | 'preflightEstimateUsd' | 'estimatedActualUsd' | 'failure'>;
export type PreparedGenStatus =
  | { status: 'unavailable'; reason: 'evidence-unavailable' }
  | { status: 'recorded'; planSha256: string; creator: 'creator-001'; stage: 'gen';
      execution: 'no-stage-record' | 'recorded-running' | 'recorded-failed' | 'recorded-completed';
      liveness: 'unknown' | null; quality: 'not-assessed'; declaredCeilingUsd: number; maxMinutes: number;
      receipt: RecordedGenReceipt | null };

function genRelativePath(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 240
    && /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(value)
    && value.split('/').every((part) => part !== '.' && part !== '..');
}

/** Recorded metadata only. Caller supplies the server-owned published directory and marker digest.
 * No source-authority, ledger, output-byte, quality, or current provider-state validation occurs here.
 * In particular, a missing stage record does not prove there was no provider attempt.
 */
export function collectPreparedGenStatus(publishedDirectory: string, markerPlanSha256: string): PreparedGenStatus {
  const unavailable: PreparedGenStatus = { status: 'unavailable', reason: 'evidence-unavailable' };
  try {
    if (typeof markerPlanSha256 !== 'string' || !SHA256.test(markerPlanSha256)) return unavailable;
    const opened = root(publishedDirectory);
    if (opened === null) return unavailable;
    const observed: Array<{ name: string; sha256: string }> = [];
    const read = (name: string): Record<string, unknown> | null => {
      const path = file(opened, name), record = path === null ? null : jsonDigest(path);
      if (record === null) return null;
      observed.push({ name, sha256: record.sha256 });
      return record.value;
    };
    const stable = (): boolean => observed.every(({ name, sha256 }) => {
      const path = file(opened, name);
      return path !== null && jsonDigest(path)?.sha256 === sha256;
    });
    const plan = read('plan.json');
    if (plan === null || observed[0]?.sha256 !== markerPlanSha256 || plan.schema !== 'figment/train-plan@1'
      || plan.creator !== 'creator-001' || plan.variant !== undefined || !object(plan.stages)
      || Object.keys(plan.stages).length !== 1 || !object(plan.stages.gen)) return unavailable;
    const runs = plan.stages.gen.runs;
    if (!Array.isArray(runs) || runs.length !== 1 || !object(runs[0])) return unavailable;
    const run = runs[0];
    if (!genRelativePath(run.manifest) || !genRelativePath(run.out) || typeof run.sha256 !== 'string'
      || !SHA256.test(run.sha256) || typeof run.ceiling_usd !== 'string'
      || !/^\d{1,2}(?:\.\d{1,2})?$/.test(run.ceiling_usd)) return unavailable;
    const ceiling = Number(run.ceiling_usd), minutesValue = argvValue(run.argv, '--max-minutes');
    const minutes = minutesValue === null ? NaN : Number(minutesValue);
    const argvManifest = argvValue(run.argv, '--manifest'), argvOut = argvValue(run.argv, '--out');
    const argvCeiling = argvValue(run.argv, '--max-usd');
    if (!finite(ceiling, 50) || ceiling <= 0 || !Number.isInteger(minutes) || !finite(minutes, 840) || minutes <= 0
      || argvCeiling === null || Number(argvCeiling) !== ceiling || argvManifest === null || !isAbsolute(argvManifest)
      || resolve(argvManifest) !== resolve(opened.path, run.manifest) || argvOut === null || !isAbsolute(argvOut)
      || resolve(argvOut) !== resolve(opened.path, run.out)) return unavailable;
    const manifest = read(run.manifest);
    if (manifest === null || observed[1]?.sha256 !== run.sha256 || manifest.max_minutes !== minutes
      || !Array.isArray(manifest.jobs) || manifest.jobs.length < 1 || manifest.jobs.length > MAX_JOBS
      || (manifest.artifacts !== undefined && (!Array.isArray(manifest.artifacts) || manifest.artifacts.length !== 0))) return unavailable;
    const outputs: string[] = [];
    for (const job of manifest.jobs) {
      if (!object(job) || typeof job.output_name !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(job.output_name)
        || job.expected_images !== 3 || outputs.includes(job.output_name)) return unavailable;
      outputs.push(job.output_name);
    }
    const output = childRoot(opened, run.out);
    if (output === null && !absent(opened, run.out)) return unavailable;
    const base = { status: 'recorded' as const, planSha256: markerPlanSha256, creator: 'creator-001' as const,
      stage: 'gen' as const, quality: 'not-assessed' as const, declaredCeilingUsd: ceiling, maxMinutes: minutes };
    if (file(opened, 'stage.json') === null) return absent(opened, 'stage.json') && stable() && absent(opened, 'stage.json')
      ? { ...base, execution: 'no-stage-record', liveness: 'unknown', receipt: null } : unavailable;
    const state = read('stage.json');
    if (state === null || state.schema !== 'figment/train-stage@1' || state.creator !== plan.creator
      || state.plan_sha256 !== markerPlanSha256 || !object(state.runs) || Object.keys(state.runs).length !== 1
      || !Object.hasOwn(state.runs, run.manifest) || !Array.isArray(state.completed_stages)) return unavailable;
    const attempt = state.runs[run.manifest], attemptStatus = attemptState(attempt);
    if (attemptStatus === null || !object(attempt)) return unavailable;
    const complete = attemptStatus === 'complete';
    if (complete ? state.completed_stages.length !== 1 || state.completed_stages[0] !== 'gen'
      || (state.status !== 'complete:gen' && state.status !== 'complete')
      : state.completed_stages.length !== 0 || state.status !== (attemptStatus === 'running' ? 'running:gen' : 'stopped:gen')) return unavailable;
    if ((attemptStatus !== 'failed' || attempt.started_utc !== undefined) && !iso(attempt.started_utc)) return unavailable;
    const receiptName = `${run.out}/run.json`;
    const receiptPath = file(opened, receiptName);
    if (receiptPath === null) {
      if (complete || !absent(opened, receiptName) || !stable() || !absent(opened, receiptName)) return unavailable;
      return { ...base, execution: attemptStatus === 'running' ? 'recorded-running' : 'recorded-failed', liveness: 'unknown', receipt: null };
    }
    const rawReceipt = read(receiptName), projected = output === null ? null : collectCloudExperiment(output.path);
    if (rawReceipt === null || projected === null || projected.status !== 'recorded' || projected.execution === 'started-pending-final'
      || attemptStatus === 'running' || (complete ? projected.execution !== 'completed' : projected.execution !== 'failed')
      || projected.maxMinutes !== minutes || projected.preflightEstimateUsd === null || projected.preflightEstimateUsd > ceiling
      || projected.finishedUtc === null || Date.parse(projected.finishedUtc) < Date.parse(projected.startedUtc)
      || (iso(attempt.started_utc) && Date.parse(projected.startedUtc) + 1000 < Date.parse(attempt.started_utc))) return unavailable;
    if (complete) {
      if (projected.terminationVerified !== true || !Array.isArray(rawReceipt.placement_attempts)
        || rawReceipt.placement_attempts.length < 1 || rawReceipt.placement_attempts.length > MAX_JOBS
        || rawReceipt.placement_attempts.some((row) => !object(row) || row.termination_verified !== true)
        || !Array.isArray(rawReceipt.jobs) || rawReceipt.jobs.length !== outputs.length) return unavailable;
      const names = new Set<string>();
      for (const [index, job] of rawReceipt.jobs.entries()) {
        if (!object(job) || job.output_name !== outputs[index] || !Array.isArray(job.files) || job.files.length !== 3) return unavailable;
        for (const item of job.files) {
          if (!object(item) || typeof item.path !== 'string' || !/^[A-Za-z0-9._-]{1,240}$/.test(item.path)
            || !item.path.toLowerCase().endsWith('.png') || names.has(item.path)
            || typeof item.bytes !== 'number' || !Number.isSafeInteger(item.bytes) || item.bytes <= 0) return unavailable;
          names.add(item.path);
        }
      }
      if (projected.outputCount !== names.size) return unavailable;
    }
    if (!stable()) return unavailable;
    const { startedUtc, finishedUtc, terminationVerified, outputCount, preflightEstimateUsd, estimatedActualUsd, failure } = projected;
    return { ...base, execution: complete ? 'recorded-completed' : 'recorded-failed', liveness: null,
      receipt: { startedUtc, finishedUtc, terminationVerified, outputCount, preflightEstimateUsd, estimatedActualUsd, failure } };
  } catch { return unavailable; }
}
