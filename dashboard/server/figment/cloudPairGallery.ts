/** Fixed-root, read-only projection of one reviewed cloud reference pair. */
import { createHash } from 'node:crypto';
import { closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

const DESCRIPTOR = 'docs/figment/2026-09-09-omnigen2-cloud-pair-gallery.json';
const MAX_JSON = 256 * 1024;
const MAX_DOC = 256 * 1024;
const MAX_IMAGE = 8 * 1024 * 1024;
const MAX_TOTAL = 16 * 1024 * 1024;
const MAX_DEPTH = 64;
const MAX_TEXT = 4096;
const SHA = /^[a-f0-9]{64}$/;
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
const DOC = /^docs\/figment\/[A-Za-z0-9][A-Za-z0-9._-]{0,159}\.md$/;
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const OBSERVATIONS = ['identity', 'realism', 'composition', 'clothing', 'safety'] as const;

type Observation = (typeof OBSERVATIONS)[number];
export interface CloudPairReview {
  disposition: 'stop'; source: string; observations: Record<Observation, string>;
}
export interface CloudPairAsset {
  assetId: string; sha256: string; bytes: number; width: number; height: number;
}
export interface CloudPairRow {
  seed: number; asset: CloudPairAsset;
  reviews: { root: CloudPairReview; independent: CloudPairReview };
}
export type CloudPairGalleryProjection =
  | { status: 'not-configured' }
  | { status: 'unavailable'; reason: 'evidence-unavailable' }
  | { status: 'recorded'; experimentId: string; modelFamily: string; notPromotable: true; trainingEligible: false; rows: CloudPairRow[] };

interface Root { path: string; real: string }
interface Evidence {
  runRoot: Root; rows: CloudPairRow[]; files: string[]; experimentId: string; modelFamily: string;
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function hash(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}
function inside(root: string, candidate: string): boolean {
  const value = relative(root, candidate);
  return value === '' || (!value.startsWith(`..${sep}`) && value !== '..' && !isAbsolute(value));
}
function reparse(path: string): boolean {
  try {
    const info = lstatSync(path);
    const real = realpathSync(path);
    return info.isSymbolicLink() || resolve(real) !== resolve(path);
  } catch { return true; }
}
function root(value: unknown): Root | null {
  if (typeof value !== 'string' || !value.trim() || !isAbsolute(value)) return null;
  try {
    const path = resolve(value);
    return lstatSync(path).isDirectory() && !reparse(path) ? { path, real: realpathSync(path) } : null;
  } catch { return null; }
}
function file(rootValue: Root, name: string): string | null {
  const path = resolve(rootValue.path, name);
  if (!inside(rootValue.path, path)) return null;
  try {
    let cursor = rootValue.path;
    for (const part of relative(rootValue.path, path).split(/[\\/]/).filter(Boolean)) {
      cursor = join(cursor, part);
      if (reparse(cursor)) return null;
    }
    return lstatSync(path).isFile() && inside(rootValue.real, realpathSync(path)) ? path : null;
  } catch { return null; }
}
function same(left: import('node:fs').Stats, right: import('node:fs').Stats): boolean {
  return left.isFile() && right.isFile() && left.size === right.size && left.dev === right.dev
    && left.ino === right.ino && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}
function bounded(path: string, maximum: number, expected?: number): Buffer | null {
  let descriptor: number | null = null;
  try {
    descriptor = openSync(path, 'r');
    const before = fstatSync(descriptor);
    const namedBefore = lstatSync(path);
    if (!same(before, namedBefore) || before.size < 1 || before.size > maximum
      || (expected !== undefined && before.size !== expected)) return null;
    const data = Buffer.allocUnsafe(before.size);
    for (let offset = 0; offset < data.length;) {
      const count = readSync(descriptor, data, offset, data.length - offset, offset);
      if (count <= 0) return null;
      offset += count;
    }
    const after = fstatSync(descriptor);
    const namedAfter = lstatSync(path);
    return same(before, after) && same(before, namedAfter) ? data : null;
  } catch { return null; }
  finally { if (descriptor !== null) try { closeSync(descriptor); } catch { /* failed reads remain invalid */ } }
}
function shallow(source: string): boolean {
  let depth = 0; let quoted = false; let escaped = false;
  for (const character of source) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === '{' || character === '[') { if (++depth > MAX_DEPTH) return false; }
    else if (character === '}' || character === ']') depth -= 1;
  }
  return !quoted && depth === 0;
}
function json(data: Buffer): Record<string, unknown> | null {
  try {
    const source = data.toString('utf8');
    const value: unknown = shallow(source) ? JSON.parse(source) : null;
    return object(value) ? value : null;
  } catch { return null; }
}
function text(value: unknown, maximum = MAX_TEXT): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum && !/[\x00-\x1f\x7f]/.test(value);
}
function png(data: Buffer, width: unknown, height: unknown): boolean {
  return Number.isSafeInteger(width) && Number.isSafeInteger(height)
    && Number(width) > 0 && Number(height) > 0 && Number(width) * Number(height) <= 32_000_000
    && data.length >= 33 && data.subarray(0, 8).equals(PNG) && data.readUInt32BE(8) === 13
    && data.subarray(12, 16).toString('ascii') === 'IHDR'
    && data.readUInt32BE(16) === width && data.readUInt32BE(20) === height;
}

function evidence(repoRootValue: string, runRootValue: string): Evidence | null {
  const repoRoot = root(repoRootValue);
  const runRoot = root(runRootValue);
  if (repoRoot === null || runRoot === null) return null;
  const descriptorPath = file(repoRoot, DESCRIPTOR);
  const runPath = file(runRoot, 'run.json');
  const descriptorRaw = descriptorPath === null ? null : bounded(descriptorPath, MAX_JSON);
  const runRaw = runPath === null ? null : bounded(runPath, MAX_JSON);
  const descriptor = descriptorRaw === null ? null : json(descriptorRaw);
  const run = runRaw === null ? null : json(runRaw);
  if (descriptor === null || run === null || runRaw === null
    || descriptor.schema !== 'figment/cloud-pair-gallery@1'
    || descriptor.not_promotable !== true || descriptor.training_eligible !== false
    || !text(descriptor.experiment_id, 80) || !SAFE.test(descriptor.experiment_id)
    || !text(descriptor.model_family, 80)
    || typeof descriptor.run_receipt_sha256 !== 'string' || !SHA.test(descriptor.run_receipt_sha256)
    || hash(runRaw) !== descriptor.run_receipt_sha256) return null;
  if (run.schema !== 'figment/runpod-run@1' || run.dry_run !== false
    || run.termination_verified !== true || run.error !== undefined
    || !Array.isArray(run.jobs) || run.jobs.length !== 2
    || !Array.isArray(descriptor.rows) || descriptor.rows.length !== 2) return null;

  const rows: CloudPairRow[] = [];
  const files: string[] = [];
  const seen = new Set<number>();
  let total = 0;
  for (let index = 0; index < 2; index += 1) {
    const row = descriptor.rows[index];
    const job = run.jobs[index];
    if (!object(row) || !object(job) || !Number.isSafeInteger(row.seed)
      || seen.has(row.seed as number) || job.seed !== row.seed
      || !Array.isArray(job.files) || job.files.length !== 1 || !object(job.files[0])) return null;
    seen.add(row.seed as number);
    if (typeof row.file !== 'string' || !SAFE.test(row.file) || !row.file.endsWith('.png')
      || job.files[0].path !== row.file || job.files[0].bytes !== row.bytes
      || typeof row.sha256 !== 'string' || !SHA.test(row.sha256)
      || !Number.isSafeInteger(row.bytes) || Number(row.bytes) < 1 || Number(row.bytes) > MAX_IMAGE) return null;
    const imagePath = file(runRoot, row.file);
    const image = imagePath === null ? null : bounded(imagePath, MAX_IMAGE, row.bytes as number);
    if (image === null || hash(image) !== row.sha256 || !png(image, row.width, row.height)
      || total + image.length > MAX_TOTAL) return null;
    total += image.length;
    if (!object(row.reviews)) return null;

    const reviews = {} as CloudPairRow['reviews'];
    for (const role of ['root', 'independent'] as const) {
      const review = row.reviews[role];
      if (!object(review) || review.disposition !== 'stop'
        || typeof review.source !== 'string' || !DOC.test(review.source)
        || typeof review.source_sha256 !== 'string' || !SHA.test(review.source_sha256)
        || !object(review.observations)) return null;
      const sourcePath = file(repoRoot, review.source);
      const source = sourcePath === null ? null : bounded(sourcePath, MAX_DOC);
      if (source === null || hash(source) !== review.source_sha256) return null;
      const observations = {} as Record<Observation, string>;
      for (const key of OBSERVATIONS) {
        if (!text(review.observations[key])) return null;
        observations[key] = review.observations[key];
      }
      reviews[role] = { disposition: 'stop', source: review.source, observations };
    }
    rows.push({
      seed: row.seed as number,
      asset: { assetId: `${descriptor.experiment_id}-${row.seed}`, sha256: row.sha256, bytes: row.bytes as number, width: row.width as number, height: row.height as number },
      reviews,
    });
    files.push(row.file);
  }
  return { runRoot, rows, files, experimentId: descriptor.experiment_id, modelFamily: descriptor.model_family };
}

export function collectCloudPairGallery(repoRoot: string, runRoot?: string | null): CloudPairGalleryProjection {
  if (runRoot == null) return { status: 'not-configured' };
  const found = evidence(repoRoot, runRoot);
  return found === null
    ? { status: 'unavailable', reason: 'evidence-unavailable' }
    : { status: 'recorded', experimentId: found.experimentId, modelFamily: found.modelFamily, notPromotable: true, trainingEligible: false, rows: found.rows };
}

export function readCloudPairGalleryAsset(repoRoot: string, runRoot: string | null | undefined, assetId: string, expectedSha256: string): Buffer | null {
  if (runRoot == null || !SHA.test(expectedSha256)) return null;
  const found = evidence(repoRoot, runRoot);
  if (found === null) return null;
  const index = found.rows.findIndex((row) => row.asset.assetId === assetId && row.asset.sha256 === expectedSha256);
  if (index < 0) return null;
  const path = file(found.runRoot, found.files[index]);
  const data = path === null ? null : bounded(path, MAX_IMAGE, found.rows[index].asset.bytes);
  return data !== null && hash(data) === expectedSha256
    && png(data, found.rows[index].asset.width, found.rows[index].asset.height) ? data : null;
}
