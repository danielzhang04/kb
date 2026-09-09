import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { collectCloudPairGallery, readCloudPairGalleryAsset } from './cloudPairGallery.ts';

const temporary: string[] = [];
afterEach(async () => { while (temporary.length) await rm(temporary.pop()!, { recursive: true, force: true }); });
const digest = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex');
function png(width: number, height: number, salt: number): Buffer { const value = Buffer.alloc(64, salt); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(value); value.writeUInt32BE(13, 8); value.write('IHDR', 12, 'ascii'); value.writeUInt32BE(width, 16); value.writeUInt32BE(height, 20); return value; }
const observations = { identity: 'geometry differs from the reference', realism: 'skin is over-smoothed', composition: 'turn is absent and crop is tight', clothing: 'crew-neck target is inconsistent', safety: 'clothed adult with no quarantine failure' };

async function fixture(): Promise<{ repo: string; run: string; image: string; receipt: string; rootReview: string; independentReview: string; descriptor: string }> {
  const repo = await mkdtemp(join(tmpdir(), 'figment-cloud-pair-repo-')), run = await mkdtemp(join(tmpdir(), 'figment-cloud-pair-run-')); temporary.push(repo, run);
  const docs = join(repo, 'docs', 'figment'); await mkdir(docs, { recursive: true });
  const rootReview = join(docs, 'root.md'), independentReview = join(docs, 'independent.md'); await writeFile(rootReview, 'root STOP review'); await writeFile(independentReview, 'independent STOP review');
  const specs = [{ seed: 481516234, file: 'pair-481516234.png', data: png(768, 768, 1) }, { seed: 90210, file: 'pair-90210.png', data: png(768, 768, 2) }];
  for (const spec of specs) await writeFile(join(run, spec.file), spec.data);
  const receipt = join(run, 'run.json'); const runValue = { schema: 'figment/runpod-run@1', dry_run: false, termination_verified: true, jobs: specs.map((spec) => ({ seed: spec.seed, files: [{ path: spec.file, bytes: spec.data.length }] })), artifacts: [{ path: 'must-not-project' }], pod_id: 'must-not-project' }; await writeFile(receipt, JSON.stringify(runValue));
  const review = (source: string, sourceSha256: string) => ({ disposition: 'stop', source, source_sha256: sourceSha256, observations });
  const descriptor = { schema: 'figment/cloud-pair-gallery@1', experiment_id: 'test-v1', model_family: 'Qwen test fixture', run_receipt_sha256: digest(await readFile(receipt)), not_promotable: true, training_eligible: false, rows: specs.map((spec) => ({ seed: spec.seed, file: spec.file, sha256: digest(spec.data), bytes: spec.data.length, width: 768, height: 768, reviews: { root: review('docs/figment/root.md', digest('root STOP review')), independent: review('docs/figment/independent.md', digest('independent STOP review')) } })) };
  const descriptorPath = join(docs, '2026-09-09-omnigen2-cloud-pair-gallery.json');
  await writeFile(descriptorPath, JSON.stringify(descriptor));
  return { repo, run, image: join(run, specs[0].file), receipt, rootReview, independentReview, descriptor: descriptorPath };
}
const unavailable = { status: 'unavailable', reason: 'evidence-unavailable' };

describe('cloud pair gallery', () => {
  it('projects exactly two producer files with separate STOP reviews and serves only hash-bound originals', async () => { const item = await fixture(); const projection = collectCloudPairGallery(item.repo, item.run); expect(projection).toMatchObject({ status: 'recorded', experimentId: 'test-v1', modelFamily: 'Qwen test fixture', notPromotable: true, trainingEligible: false, rows: [{ seed: 481516234, asset: { width: 768, height: 768 }, reviews: { root: { disposition: 'stop' }, independent: { disposition: 'stop' } } }, { seed: 90210 }] }); if (projection.status !== 'recorded') throw new Error('unreachable'); const asset = projection.rows[0].asset; expect(readCloudPairGalleryAsset(item.repo, item.run, asset.assetId, asset.sha256)?.equals(await readFile(item.image))).toBe(true); expect(readCloudPairGalleryAsset(item.repo, item.run, asset.assetId, '0'.repeat(64))).toBeNull(); expect(JSON.stringify(projection)).not.toContain(item.run); expect(JSON.stringify(projection)).not.toContain('must-not-project'); });
  it('invalidates the whole pair after image, receipt, or either review changes', async () => { for (const target of ['image', 'receipt', 'rootReview', 'independentReview'] as const) { const item = await fixture(); await writeFile(item[target], Buffer.concat([await readFile(item[target]), Buffer.from('x')])); expect(collectCloudPairGallery(item.repo, item.run)).toEqual(unavailable); } });
  it('fails closed for malformed, deep, oversized, and reparse evidence', async () => { const malformed = await fixture(); await writeFile(malformed.receipt, '['.repeat(65) + '0' + ']'.repeat(65)); expect(collectCloudPairGallery(malformed.repo, malformed.run)).toEqual(unavailable); const oversized = await fixture(); const oversizedReview = Buffer.alloc(256 * 1024 + 1, 65); await writeFile(oversized.independentReview, oversizedReview); const descriptor = JSON.parse(await readFile(oversized.descriptor, 'utf8')); for (const row of descriptor.rows) row.reviews.independent.source_sha256 = digest(oversizedReview); await writeFile(oversized.descriptor, JSON.stringify(descriptor)); expect(collectCloudPairGallery(oversized.repo, oversized.run)).toEqual(unavailable); const linked = await fixture(); const link = `${linked.run}-link`; temporary.push(link); let linkCreated = false; try { await symlink(linked.run, link, 'junction'); linkCreated = true; } catch (cause) { const code = (cause as NodeJS.ErrnoException).code; if (code !== 'EPERM' && code !== 'EACCES' && code !== 'ENOSYS') throw cause; } if (linkCreated) expect(collectCloudPairGallery(linked.repo, link)).toEqual(unavailable); expect(collectCloudPairGallery(linked.repo)).toEqual({ status: 'not-configured' }); });
});
