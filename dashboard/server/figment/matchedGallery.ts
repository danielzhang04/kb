/** Fixed-root, historical projection of the base/current-20 local diagnostic pairs. */
import { createHash } from 'node:crypto';
import { closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

const SHA256 = /^[a-f0-9]{64}$/;
const MAX_JSON_BYTES = 256 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_JSON_DEPTH = 64;
const MAX_OBSERVATION_CHARS = 4096;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ROWS = [
  { seed: 481516234, output: 'figment-local-lora-matched_00001_.png' },
  { seed: 90210, output: 'figment-local-lora-matched_00002_.png' },
] as const;
const CURRENT_CHECKPOINT = 'figmentlocalg01quality-current-100-step00000020.safetensors';
const PIN = {
  c1: 'bca8be929852fe19eab724f878f8985e4b3f6146050e564af91d0c83e6570d6f', plan: '7cbc717c23100fb2d3542126babe01971f28fc3133674a1133bac9c6f2e24df5', planFile: '9f2246e727d992aab12ffdc1f256dde17487887b1dd108cbe5dc7fa770441b58', producerAdmission: '029c8e730db2844cce692b49127cacac358594703f5ef0e3ea97ccf9b1fc42d4', producerReceipt: 'd0f162618f51b6eae4dd4a814947fd1b32768b8c0abb5fdf0c739a3742fb9847', model: '6a35a7855770ae9820a3c931d4964c3817b6d9e3c6f9c4dabb5b3a94e5643b80', commit: '95d755cd8107a72258d452b5d3657273d571f07d', nodes: '5ab70a74109118256934b63675ed620a47becb54343a77daa66b4fe20a4d0ee7', sd: '3b71a1a71a78ee327c24201f8d522393eb111264b3569d8b3a24bd9149d77f4f', ownership: '2997ba3185aabfb146b13f38d18c854615a7190064d30f14037570398bea7bac', runtime: 'ce9341824349072f5172e3fe7e161f13963e082d1c8e6fc3208cba02985994e0', baseAdmission: '57b026768d69d8b7add2b781a6228d9e9ea432b5617612a40553ef7e0fe95536', currentAdmission: '407dc2945413e7bda99e2bfab2a9cafe13781c9c507729aa7431bace4bd7768d', checkpoint: 'fc3222248dd317270f975f34828f5376751114584d443eebeae0112deb3e473f', checkpointHeader: '334341d2b46823ddb21f5da99b42797d785975c5e547bf22c7a9fff00efa74dc', checkpointBytes: 170540948,
} as const;
const OBSERVATIONS = ['realism', 'resemblance_to_g01', 'pose', 'apparent_adulthood', 'apparent_age_fit', 'clothing', 'defects'] as const;

export interface FigmentMatchedGalleryRoots { base: string; current20: string; }
export interface MatchedGalleryAsset { assetId: string; sha256: string; bytes: number; width: 1024; height: 1024; }
export interface MatchedGalleryReview { disposition: 'continue' | 'stop'; observations: Record<(typeof OBSERVATIONS)[number], string>; }
export type MatchedGalleryProjection =
  | { status: 'not-configured' }
  | { status: 'unavailable'; reason: 'evidence-unavailable' }
  | { status: 'recorded'; historical: true; notPromotable: true; conditioning: 'no-pixel-reference-conditioning'; pairs: Array<{ seed: (typeof ROWS)[number]['seed']; base: MatchedGalleryAsset; current20: MatchedGalleryAsset; reviews: { root: { base: MatchedGalleryReview; current20: MatchedGalleryReview }; independent: { base: MatchedGalleryReview; current20: MatchedGalleryReview } } }> };

interface Root { path: string; real: string; }
interface JsonRecord { value: Record<string, unknown>; raw: Buffer; }
interface Row { seed: (typeof ROWS)[number]['seed']; asset: MatchedGalleryAsset; file: string; }
interface StageEvidence { root: Root; rawHash: string; inputs: Record<string, unknown>; rows: Row[]; reviews: { root: MatchedGalleryReview[]; independent: MatchedGalleryReview[] }; }

function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function inside(root: string, candidate: string): boolean { const value = relative(root, candidate); return value === '' || (!value.startsWith(`..${sep}`) && value !== '..' && !isAbsolute(value)); }
function reparse(path: string): boolean { try { const info = lstatSync(path); const real = realpathSync(path); return info.isSymbolicLink() || resolve(real) !== resolve(path); } catch { return true; } }
function root(value: unknown): Root | null { if (typeof value !== 'string' || !value.trim() || !isAbsolute(value)) return null; try { const path = resolve(value); if (!lstatSync(path).isDirectory() || reparse(path)) return null; return { path, real: realpathSync(path) }; } catch { return null; } }
function file(root: Root, name: string): string | null {
  const path = resolve(root.path, name); if (!inside(root.path, path)) return null;
  try { let cursor = root.path; for (const segment of relative(root.path, path).split(/[\\/]/).filter(Boolean)) { cursor = join(cursor, segment); if (reparse(cursor)) return null; } return lstatSync(path).isFile() && inside(root.real, realpathSync(path)) ? path : null; } catch { return null; }
}
function sameFile(left: import('node:fs').Stats, right: import('node:fs').Stats): boolean { return left.isFile() && right.isFile() && left.size === right.size && left.dev === right.dev && left.ino === right.ino && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs; }
function bounded(path: string, maximum: number, expected?: number): Buffer | null {
  let descriptor: number | null = null;
  try { descriptor = openSync(path, 'r'); const before = fstatSync(descriptor); const namedBefore = lstatSync(path); if (!sameFile(before, namedBefore) || before.size < 1 || before.size > maximum || (expected !== undefined && before.size !== expected)) return null; const data = Buffer.allocUnsafe(before.size); for (let offset = 0; offset < data.length;) { const count = readSync(descriptor, data, offset, data.length - offset, offset); if (count <= 0) return null; offset += count; } const after = fstatSync(descriptor); const namedAfter = lstatSync(path); return sameFile(before, after) && sameFile(before, namedAfter) && (expected === undefined || after.size === expected) ? data : null; } catch { return null; } finally { if (descriptor !== null) try { closeSync(descriptor); } catch { /* a failed close never validates a read */ } }
}
function depth(source: string): boolean { let value = 0, quoted = false, escaped = false; for (const character of source) { if (quoted) { if (escaped) escaped = false; else if (character === '\\') escaped = true; else if (character === '"') quoted = false; continue; } if (character === '"') quoted = true; else if (character === '{' || character === '[') { value += 1; if (value > MAX_JSON_DEPTH) return false; } else if (character === '}' || character === ']') value -= 1; } return !quoted && value === 0; }
function json(root: Root, name: string): JsonRecord | null { const path = file(root, name); const raw = path === null ? null : bounded(path, MAX_JSON_BYTES); if (raw === null) return null; try { const source = raw.toString('utf8'); const value: unknown = depth(source) ? JSON.parse(source) : null; return object(value) ? { value, raw } : null; } catch { return null; } }
function png(data: Buffer): boolean { return data.length >= 33 && data.subarray(0, 8).equals(PNG_SIGNATURE) && data.readUInt32BE(8) === 13 && data.subarray(12, 16).toString('ascii') === 'IHDR' && data.readUInt32BE(16) === 1024 && data.readUInt32BE(20) === 1024; }
function hash(data: Buffer): string { return createHash('sha256').update(data).digest('hex'); }
function validSha(value: unknown): value is string { return typeof value === 'string' && SHA256.test(value); }

function review(record: JsonRecord, stage: 'base' | 'current-20', role: 'root' | 'independent', receiptHash: string, rows: Row[]): MatchedGalleryReview[] | null {
  const value = record.value; const disposition = value.disposition;
  if (value.schema !== 'figment/local-lora-matched-pair-review@1' || value.stage !== stage || value.reviewer_role !== role || typeof value.reviewer_id !== 'string' || !value.reviewer_id || value.receipt_sha256 !== receiptHash || value.not_promotable !== true || value.human_qa !== false || (disposition !== 'continue' && disposition !== 'stop') || !Array.isArray(value.rows) || !Array.isArray(value.observations) || value.rows.length !== ROWS.length || value.observations.length !== ROWS.length) return null;
  const result: MatchedGalleryReview[] = [];
  for (let index = 0; index < ROWS.length; index += 1) { const row = value.rows[index]; const observation = value.observations[index]; const expected = rows[index]; if (!object(row) || !object(observation) || row.seed !== expected.seed || row.output_sha256 !== expected.asset.sha256 || observation.seed !== expected.seed) return null; const observations = {} as Record<(typeof OBSERVATIONS)[number], string>; for (const key of OBSERVATIONS) { const text = observation[key]; if (typeof text !== 'string' || !text || text.length > MAX_OBSERVATION_CHARS) return null; observations[key] = text; } result.push({ disposition, observations }); }
  return result;
}

function stage(rootValue: Root, stageName: 'base' | 'current-20'): StageEvidence | null {
  const receipt = json(rootValue, 'receipt.json'); if (receipt === null) return null; const value = receipt.value; const inputs = object(value.inputs) ? value.inputs : null; const teardown = object(value.teardown) ? value.teardown : null; const lora = object(value.lora_application) ? value.lora_application : null;
  if (value.schema !== 'figment/local-lora-matched-runtime@1' || value.stage !== stageName || value.status !== 'complete' || value.not_promotable !== true || value.deadline_seconds !== 600 || inputs === null || teardown?.verified_stopped !== true || lora === null || inputs.c1_sha256 !== PIN.c1 || inputs.plan_sha256 !== PIN.plan || inputs.plan_file_sha256 !== PIN.planFile || inputs.matched_admission_sha256 !== (stageName === 'base' ? PIN.baseAdmission : PIN.currentAdmission) || inputs.producer_admission_sha256 !== PIN.producerAdmission || inputs.producer_receipt_sha256 !== PIN.producerReceipt || inputs.comfy_base_model_sha256 !== PIN.model || inputs.comfy_nodes_sha256 !== PIN.nodes || inputs.comfy_sd_sha256 !== PIN.sd || inputs.comfy_commit !== PIN.commit || inputs.ownership_sha256 !== PIN.ownership || inputs.runtime_sha256 !== PIN.runtime || inputs.matched_admission_id !== `figment-local-lora-matched-${stageName}-20260908-v1` || !Array.isArray(value.rows) || value.rows.length !== ROWS.length) return null;
  if (lora.comfy_missing_lora_key_warnings !== 0 || lora.header_unet_keys !== (stageName === 'base' ? 0 : 2166)) return null;
  const rows: Row[] = [];
  for (let index = 0; index < ROWS.length; index += 1) { const expected = ROWS[index]; const row = value.rows[index]; const output = object(row) ? row.output : null; const bytes = object(output) ? output.bytes : null; if (!object(row) || !object(output) || typeof bytes !== 'number' || row.seed !== expected.seed || row.row_id !== `${stageName}-seed-${expected.seed}` || typeof row.prompt_id !== 'string' || !row.prompt_id || output.filename !== expected.output || !validSha(output.sha256) || !Number.isSafeInteger(bytes) || bytes < 1 || bytes > MAX_IMAGE_BYTES || !Array.isArray(output.dimensions) || output.dimensions.length !== 2 || output.dimensions[0] !== 1024 || output.dimensions[1] !== 1024) return null; rows.push({ seed: expected.seed, file: expected.output, asset: { assetId: `${stageName}-${expected.seed}`, sha256: output.sha256, bytes, width: 1024, height: 1024 } }); }
  if (stageName === 'base') { if (inputs.checkpoint !== null || inputs.base_receipt_sha256 !== null || inputs.base_png_sha256_by_seed !== null) return null; } else { const checkpoint = object(inputs.checkpoint) ? inputs.checkpoint : null; const checkpointBytes = checkpoint?.bytes; const baseMap = object(inputs.base_png_sha256_by_seed) ? inputs.base_png_sha256_by_seed : null; if (checkpoint === null || typeof checkpointBytes !== 'number' || checkpoint.filename !== CURRENT_CHECKPOINT || checkpoint.ss_steps !== '20' || checkpoint.sha256 !== PIN.checkpoint || checkpoint.header_sha256 !== PIN.checkpointHeader || checkpoint.unet_tensor_keys !== 2166 || checkpointBytes !== PIN.checkpointBytes || baseMap === null || Object.keys(baseMap).length !== ROWS.length || !ROWS.every((row) => validSha(baseMap[String(row.seed)])) || !validSha(inputs.base_receipt_sha256)) return null; }
  const receiptHash = hash(receipt.raw); const rootReview = json(rootValue, 'review-root.json'); const independentReview = json(rootValue, 'review-independent.json'); if (rootReview === null || independentReview === null) return null;
  const rootReviews = review(rootReview, stageName, 'root', receiptHash, rows); const independentReviews = review(independentReview, stageName, 'independent', receiptHash, rows); if (rootReviews === null || independentReviews === null) return null;
  return { root: rootValue, rawHash: receiptHash, inputs, rows, reviews: { root: rootReviews, independent: independentReviews } };
}

function evidence(roots: FigmentMatchedGalleryRoots | null | undefined): { base: StageEvidence; current: StageEvidence } | null {
  if (roots == null || !object(roots) || !('base' in roots) || !('current20' in roots)) return null; const baseRoot = root(roots.base); const currentRoot = root(roots.current20); if (baseRoot === null || currentRoot === null) return null; const base = stage(baseRoot, 'base'); const current = stage(currentRoot, 'current-20'); if (base === null || current === null) return null;
  const map = object(current.inputs.base_png_sha256_by_seed) ? current.inputs.base_png_sha256_by_seed : null;
  if (map === null || current.inputs.base_receipt_sha256 !== base.rawHash || !base.rows.every((row) => map[String(row.seed)] === row.asset.sha256)) return null;
  return { base, current };
}
function load(stage: StageEvidence, row: Row): Buffer | null { const path = file(stage.root, join('output', row.file)); const data = path === null ? null : bounded(path, MAX_IMAGE_BYTES, row.asset.bytes); return data !== null && png(data) && hash(data) === row.asset.sha256 ? data : null; }

/** Reads two fixed stage records. It neither scans directories nor changes diagnostic state. */
export function collectMatchedGallery(roots?: FigmentMatchedGalleryRoots | null): MatchedGalleryProjection {
  if (roots == null) return { status: 'not-configured' }; const records = evidence(roots); if (records === null) return { status: 'unavailable', reason: 'evidence-unavailable' };
  let total = 0; const pairs: Extract<MatchedGalleryProjection, { status: 'recorded' }>['pairs'] = [];
  for (let index = 0; index < ROWS.length; index += 1) { const base = records.base.rows[index]; const current20 = records.current.rows[index]; const baseData = load(records.base, base); const currentData = load(records.current, current20); if (baseData === null || currentData === null || total + baseData.length + currentData.length > MAX_TOTAL_IMAGE_BYTES) return { status: 'unavailable', reason: 'evidence-unavailable' }; total += baseData.length + currentData.length; pairs.push({ seed: base.seed, base: base.asset, current20: current20.asset, reviews: { root: { base: records.base.reviews.root[index], current20: records.current.reviews.root[index] }, independent: { base: records.base.reviews.independent[index], current20: records.current.reviews.independent[index] } } }); }
  return { status: 'recorded', historical: true, notPromotable: true, conditioning: 'no-pixel-reference-conditioning', pairs };
}

/** Revalidates fixed record bindings, then opens and hashes only the requested known PNG. */
export function readMatchedGalleryAsset(roots: FigmentMatchedGalleryRoots | null | undefined, assetId: string, expectedSha256: string): Buffer | null {
  if (!validSha(expectedSha256) || !/^(?:base|current-20)-(?:481516234|90210)$/.test(assetId)) return null; const records = evidence(roots); if (records === null) return null; const [stageName, seedText] = assetId.startsWith('current-20-') ? ['current', assetId.slice('current-20-'.length)] : ['base', assetId.slice('base-'.length)]; const stageRecord = stageName === 'base' ? records.base : records.current; const row = stageRecord.rows.find((item) => item.asset.assetId === assetId && String(item.seed) === seedText); if (row === undefined || row.asset.sha256 !== expectedSha256) return null; return load(stageRecord, row);
}
