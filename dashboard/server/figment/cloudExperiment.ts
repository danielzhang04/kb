/** Bounded, read-only status projection for one configured Figment cloud experiment. */
import { closeSync, fstatSync, lstatSync, openSync, opendirSync, readSync, realpathSync } from 'node:fs';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';

const MAX_JSON_BYTES = 256 * 1024, MAX_DEPTH = 64, MAX_JOBS = 32, MAX_FILES_PER_JOB = 32, MAX_OUTPUTS = 128, MAX_ROOT_ENTRIES = 32;
type Failure = 'bootstrap' | 'run';
export type CloudExperimentProjection =
  | { status: 'not-configured' }
  | { status: 'unavailable'; reason: 'evidence-unavailable' }
  | { status: 'recorded'; execution: 'started-pending-final' | 'failed' | 'completed'; liveness: 'unknown' | null; maxMinutes: number; maxUsd: number | null; preflightEstimateUsd: number | null; estimatedActualUsd: number | null; startedUtc: string; finishedUtc: string | null; terminationVerified: boolean | null; outputCount: number; quality: 'not-reviewed'; failure: Failure | null };

interface Root { path: string; real: string; }
function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function inside(root: string, candidate: string): boolean { const value = relative(root, candidate); return value === '' || (!value.startsWith(`..${sep}`) && value !== '..' && !isAbsolute(value)); }
function reparse(path: string): boolean { try { const info = lstatSync(path), real = realpathSync(path); return info.isSymbolicLink() || resolve(real) !== resolve(path); } catch { return true; } }
function root(value: string | null | undefined): Root | null { if (!value?.trim() || !isAbsolute(value)) return null; try { const path = resolve(value); return lstatSync(path).isDirectory() && !reparse(path) ? { path, real: realpathSync(path) } : null; } catch { return null; } }
function file(root: Root, name: string): string | null { const path = resolve(root.path, name); if (!inside(root.path, path)) return null; try { let cursor = root.path; for (const segment of relative(root.path, path).split(/[\\/]/).filter(Boolean)) { cursor = resolve(cursor, segment); if (reparse(cursor)) return null; } return lstatSync(path).isFile() && inside(root.real, realpathSync(path)) ? path : null; } catch { return null; } }
function bounded(path: string): Buffer | null { let descriptor: number | null = null; try { descriptor = openSync(path, 'r'); const before = fstatSync(descriptor); if (!before.isFile() || before.size < 1 || before.size > MAX_JSON_BYTES) return null; const bytes = Buffer.allocUnsafe(before.size); for (let offset = 0; offset < bytes.length;) { const count = readSync(descriptor, bytes, offset, bytes.length - offset, offset); if (count <= 0) return null; offset += count; } const after = fstatSync(descriptor); return after.isFile() && after.size === before.size ? bytes : null; } catch { return null; } finally { if (descriptor !== null) try { closeSync(descriptor); } catch { /* invalid above */ } } }
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
