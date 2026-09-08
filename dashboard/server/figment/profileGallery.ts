/** Fixed-root, read-only projection of ONE completed historical study: the C3 profile-base run of 2026-09-08. */
import { createHash } from 'node:crypto';
import { closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

const SHA256 = /^[a-f0-9]{64}$/;
const MAX_JSON_BYTES = 256 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 16 * 1024 * 1024;
const MAX_JSON_DEPTH = 64;
const MAX_OBSERVATION_CHARS = 4096;
const MAX_REASON_CHARS = 2048;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const STAGE = 'profile-base';
/** Raw-byte pins of the immutable study records; verified before any parse. */
const PIN = {
  receipt: '26e2396b3247730f9124386beb32198fba12930b85fddd18297165e27b7bd44c',
  reviewRoot: '8e79c86410942edcb406982c3dbc2f2dffdbdfa0e8b15cdb3e409bd7ea9bef65',
  reviewIndependent: '952fb76424ddca547a4289951d63424321e84b73bb7768f38bb03d165f135403',
} as const;
const ROWS = [
  { seed: 481516234, file: 'figment-local-lora-matched_00001_.png', sha256: '4235253ac57bbc22ef1d697fa453f938b38de5ba3946d5f2c8a433fbe91be1e1', bytes: 1394954 },
  { seed: 90210, file: 'figment-local-lora-matched_00002_.png', sha256: '00aa9673edb2a9ae6aed1084fcbf977795420f41bbe197d51a649e25dd177ace', bytes: 1415024 },
] as const;
const OBSERVATIONS = ['realism', 'resemblance_to_g01', 'pose', 'apparent_adulthood', 'apparent_age_fit', 'clothing', 'defects'] as const;
const ROLES = ['root', 'independent'] as const;

type Seed = (typeof ROWS)[number]['seed'];
type Role = (typeof ROLES)[number];
export interface ProfileGalleryAsset { assetId: string; sha256: string; bytes: number; width: 1024; height: 1024; }
export interface ProfileGalleryReview { disposition: 'stop'; reason: string; observations: Record<(typeof OBSERVATIONS)[number], string>; }
export interface ProfileGalleryRow { seed: Seed; asset: ProfileGalleryAsset; reviews: Record<Role, ProfileGalleryReview>; }
export type ProfileGalleryProjection =
  | { status: 'not-configured' }
  | { status: 'unavailable'; reason: 'evidence-unavailable' }
  | { status: 'recorded'; stage: typeof STAGE; historical: true; notPromotable: true; conditioning: 'no-pixel-reference-conditioning'; selectedCheckpoint: null; rows: ProfileGalleryRow[] };

interface Root { path: string; real: string; }
interface Evidence { root: Root; rows: ProfileGalleryRow[]; }

function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function inside(root: string, candidate: string): boolean { const value = relative(root, candidate); return value === '' || (!value.startsWith(`..${sep}`) && value !== '..' && !isAbsolute(value)); }
function reparse(path: string): boolean { try { const info = lstatSync(path); const real = realpathSync(path); return info.isSymbolicLink() || resolve(real) !== resolve(path); } catch { return true; } }
function root(value: unknown): Root | null {
  if (typeof value !== 'string' || !value.trim() || !isAbsolute(value)) return null;
  try { const path = resolve(value); if (!lstatSync(path).isDirectory() || reparse(path)) return null; return { path, real: realpathSync(path) }; } catch { return null; }
}
/** Resolves a fixed relative name under the root, refusing escapes and any reparse point on the walk from root to file. */
function file(root: Root, name: string): string | null {
  const path = resolve(root.path, name); if (!inside(root.path, path)) return null;
  try {
    let cursor = root.path;
    for (const segment of relative(root.path, path).split(/[\\/]/).filter(Boolean)) { cursor = join(cursor, segment); if (reparse(cursor)) return null; }
    return lstatSync(path).isFile() && inside(root.real, realpathSync(path)) ? path : null;
  } catch { return null; }
}
function sameFile(left: import('node:fs').Stats, right: import('node:fs').Stats): boolean { return left.isFile() && right.isFile() && left.size === right.size && left.dev === right.dev && left.ino === right.ino && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs; }
function bounded(path: string, maximum: number, expected?: number): Buffer | null {
  let descriptor: number | null = null;
  try {
    descriptor = openSync(path, 'r'); const before = fstatSync(descriptor); const namedBefore = lstatSync(path);
    if (!sameFile(before, namedBefore) || before.size < 1 || before.size > maximum || (expected !== undefined && before.size !== expected)) return null;
    const data = Buffer.allocUnsafe(before.size);
    for (let offset = 0; offset < data.length;) { const count = readSync(descriptor, data, offset, data.length - offset, offset); if (count <= 0) return null; offset += count; }
    const after = fstatSync(descriptor); const namedAfter = lstatSync(path);
    return sameFile(before, after) && sameFile(before, namedAfter) ? data : null;
  } catch { return null; } finally { if (descriptor !== null) try { closeSync(descriptor); } catch { /* a failed close never validates a read */ } }
}
function depth(source: string): boolean { let value = 0, quoted = false, escaped = false; for (const character of source) { if (quoted) { if (escaped) escaped = false; else if (character === '\\') escaped = true; else if (character === '"') quoted = false; continue; } if (character === '"') quoted = true; else if (character === '{' || character === '[') { value += 1; if (value > MAX_JSON_DEPTH) return false; } else if (character === '}' || character === ']') value -= 1; } return !quoted && value === 0; }
function hash(data: Buffer): string { return createHash('sha256').update(data).digest('hex'); }
function validSha(value: unknown): value is string { return typeof value === 'string' && SHA256.test(value); }
function plain(value: string): boolean { for (let index = 0; index < value.length; index += 1) { const code = value.charCodeAt(index); if (code < 32 || code === 127) return false; } return true; }
function text(value: unknown, maximum: number): string | null { return typeof value === 'string' && value.length > 0 && value.length <= maximum && plain(value) ? value : null; }
function png(data: Buffer): boolean { return data.length >= 33 && data.subarray(0, 8).equals(PNG_SIGNATURE) && data.readUInt32BE(8) === 13 && data.subarray(12, 16).toString('ascii') === 'IHDR' && data.readUInt32BE(16) === 1024 && data.readUInt32BE(20) === 1024; }

/** Reads a bounded record and parses it only after its raw bytes match the pinned study hash. */
function pinned(root: Root, name: string, pin: string): Record<string, unknown> | null {
  const path = file(root, name); const raw = path === null ? null : bounded(path, MAX_JSON_BYTES); if (raw === null || hash(raw) !== pin) return null;
  try { const source = raw.toString('utf8'); const value: unknown = depth(source) ? JSON.parse(source) : null; return object(value) ? value : null; } catch { return null; }
}

function receipt(root: Root): ProfileGalleryAsset[] | null {
  const value = pinned(root, 'receipt.json', PIN.receipt); if (value === null) return null;
  const inputs = object(value.inputs) ? value.inputs : null; const teardown = object(value.teardown) ? value.teardown : null; const lora = object(value.lora_application) ? value.lora_application : null;
  if (value.schema !== 'figment/local-lora-profile-runtime@1' || value.stage !== STAGE || value.status !== 'complete' || value.not_promotable !== true || inputs === null || inputs.selected_checkpoint !== null || inputs.profile_base_receipt_sha256 !== null || inputs.profile_admission_id !== 'figment-local-lora-profile-base-20260908-v1' || teardown?.verified_stopped !== true || lora?.header_unet_keys !== 0 || lora.comfy_missing_lora_key_warnings !== 0 || !Array.isArray(value.rows) || value.rows.length !== ROWS.length) return null;
  const assets: ProfileGalleryAsset[] = [];
  for (let index = 0; index < ROWS.length; index += 1) {
    const expected = ROWS[index]; const row = value.rows[index]; const output = object(row) ? row.output : null;
    if (!object(row) || !object(output) || row.seed !== expected.seed || row.row_id !== `${STAGE}-seed-${expected.seed}` || output.filename !== expected.file || output.sha256 !== expected.sha256 || output.bytes !== expected.bytes || !Array.isArray(output.dimensions) || output.dimensions.length !== 2 || output.dimensions[0] !== 1024 || output.dimensions[1] !== 1024) return null;
    assets.push({ assetId: `${STAGE}-${expected.seed}`, sha256: expected.sha256, bytes: expected.bytes, width: 1024, height: 1024 });
  }
  return assets;
}

function review(root: Root, role: Role): ProfileGalleryReview[] | null {
  const value = pinned(root, `review-${role}.json`, role === 'root' ? PIN.reviewRoot : PIN.reviewIndependent); if (value === null) return null;
  const reason = text(value.reason, MAX_REASON_CHARS);
  if (value.schema !== 'figment/local-lora-profile-pair-review@1' || value.stage !== STAGE || value.reviewer_role !== role || value.receipt_sha256 !== PIN.receipt || value.not_promotable !== true || value.human_qa !== false || value.disposition !== 'stop' || reason === null || !Array.isArray(value.rows) || value.rows.length !== ROWS.length) return null;
  const result: ProfileGalleryReview[] = [];
  for (let index = 0; index < ROWS.length; index += 1) {
    const expected = ROWS[index]; const row = value.rows[index]; const source = object(row) ? row.observations : null;
    if (!object(row) || !object(source) || row.seed !== expected.seed || row.output_sha256 !== expected.sha256) return null;
    const observations = {} as ProfileGalleryReview['observations'];
    for (const key of OBSERVATIONS) { const item = text(source[key], MAX_OBSERVATION_CHARS); if (item === null) return null; observations[key] = item; }
    result.push({ disposition: 'stop', reason, observations });
  }
  return result;
}

/** Metadata projection: pinned receipt plus BOTH per-role reviews, kept separate (never merged into a consensus). */
function evidence(value: unknown): Evidence | null {
  const rootValue = root(value); if (rootValue === null) return null;
  const assets = receipt(rootValue); const rootReviews = review(rootValue, 'root'); const independentReviews = review(rootValue, 'independent');
  if (assets === null || rootReviews === null || independentReviews === null) return null;
  return { root: rootValue, rows: ROWS.map((row, index) => ({ seed: row.seed, asset: assets[index], reviews: { root: rootReviews[index], independent: independentReviews[index] } })) };
}
function load(root: Root, index: number): Buffer | null {
  const row = ROWS[index]; const path = file(root, join('output', row.file)); const data = path === null ? null : bounded(path, MAX_IMAGE_BYTES, row.bytes);
  return data !== null && png(data) && hash(data) === row.sha256 ? data : null;
}

/** Reads the fixed study root; requires pinned records AND both pinned PNGs. Never scans, never mutates. */
export function collectProfileGallery(root?: string | null): ProfileGalleryProjection {
  if (root == null) return { status: 'not-configured' };
  const records = evidence(root); if (records === null) return { status: 'unavailable', reason: 'evidence-unavailable' };
  let total = 0;
  for (let index = 0; index < ROWS.length; index += 1) { const data = load(records.root, index); if (data === null || total + data.length > MAX_TOTAL_IMAGE_BYTES) return { status: 'unavailable', reason: 'evidence-unavailable' }; total += data.length; }
  return { status: 'recorded', stage: STAGE, historical: true, notPromotable: true, conditioning: 'no-pixel-reference-conditioning', selectedCheckpoint: null, rows: records.rows };
}

/** Revalidates records and returns the original pinned PNG, including its recorded generation metadata.
 * Only the JSON projection redacts internal record fields; this is not a sanitized media export. */
export function readProfileGalleryAsset(root: string | null | undefined, assetId: string, expectedSha256: string): Buffer | null {
  if (root == null || !validSha(expectedSha256)) return null;
  const index = ROWS.findIndex((row) => `${STAGE}-${row.seed}` === assetId); if (index < 0 || ROWS[index].sha256 !== expectedSha256) return null;
  const records = evidence(root); return records === null ? null : load(records.root, index);
}
