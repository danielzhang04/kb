import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectMatchedGallery, readMatchedGalleryAsset, type FigmentMatchedGalleryRoots } from './matchedGallery.ts';

const temporary: string[] = [];
afterEach(async () => { while (temporary.length) await rm(temporary.pop()!, { recursive: true, force: true }); });
const digest = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex');
const pin = { c1: 'bca8be929852fe19eab724f878f8985e4b3f6146050e564af91d0c83e6570d6f', plan: '7cbc717c23100fb2d3542126babe01971f28fc3133674a1133bac9c6f2e24df5', planFile: '9f2246e727d992aab12ffdc1f256dde17487887b1dd108cbe5dc7fa770441b58', producerAdmission: '029c8e730db2844cce692b49127cacac358594703f5ef0e3ea97ccf9b1fc42d4', producerReceipt: 'd0f162618f51b6eae4dd4a814947fd1b32768b8c0abb5fdf0c739a3742fb9847', model: '6a35a7855770ae9820a3c931d4964c3817b6d9e3c6f9c4dabb5b3a94e5643b80', commit: '95d755cd8107a72258d452b5d3657273d571f07d', nodes: '5ab70a74109118256934b63675ed620a47becb54343a77daa66b4fe20a4d0ee7', sd: '3b71a1a71a78ee327c24201f8d522393eb111264b3569d8b3a24bd9149d77f4f', ownership: '2997ba3185aabfb146b13f38d18c854615a7190064d30f14037570398bea7bac', runtime: 'ce9341824349072f5172e3fe7e161f13963e082d1c8e6fc3208cba02985994e0', baseAdmission: '57b026768d69d8b7add2b781a6228d9e9ea432b5617612a40553ef7e0fe95536', currentAdmission: '407dc2945413e7bda99e2bfab2a9cafe13781c9c507729aa7431bace4bd7768d', checkpoint: 'fc3222248dd317270f975f34828f5376751114584d443eebeae0112deb3e473f', checkpointHeader: '334341d2b46823ddb21f5da99b42797d785975c5e547bf22c7a9fff00efa74dc' };
const png = (salt: number): Buffer => { const value = Buffer.alloc(33); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(value); value.writeUInt32BE(13, 8); value.write('IHDR', 12, 'ascii'); value.writeUInt32BE(1024, 16); value.writeUInt32BE(1024, 20); value[32] = salt; return value; };
async function json(path: string, value: unknown): Promise<Buffer> { const raw = Buffer.from(JSON.stringify(value)); await writeFile(path, raw); return raw; }
function observation(seed: number): Record<string, unknown> { return { seed, realism: 'recorded realism', resemblance_to_g01: 'recorded resemblance', pose: 'recorded pose', apparent_adulthood: 'recorded adulthood', apparent_age_fit: 'recorded age', clothing: 'recorded clothing', defects: 'recorded defects' }; }
async function fixture(): Promise<{ roots: FigmentMatchedGalleryRoots; baseReceipt: string; currentReceipt: string; currentReview: string; image: string }> {
  const root = await mkdtemp(join(tmpdir(), 'figment-matched-gallery-')); temporary.push(root); const base = join(root, 'base'), current = join(root, 'current'); await Promise.all([mkdir(join(base, 'output'), { recursive: true }), mkdir(join(current, 'output'), { recursive: true })]);
  const baseImages = [png(1), png(2)], currentImages = [png(3), png(4)];
  for (let index = 0; index < 2; index += 1) { await writeFile(join(base, 'output', `figment-local-lora-matched_0000${index + 1}_.png`), baseImages[index]); await writeFile(join(current, 'output', `figment-local-lora-matched_0000${index + 1}_.png`), currentImages[index]); }
  const makeReceipt = (stage: 'base' | 'current-20', images: Buffer[], baseHash?: string) => ({ schema: 'figment/local-lora-matched-runtime@1', stage, status: 'complete', not_promotable: true, deadline_seconds: 600, teardown: { verified_stopped: true }, inputs: { c1_sha256: pin.c1, plan_sha256: pin.plan, plan_file_sha256: pin.planFile, matched_admission_sha256: stage === 'base' ? pin.baseAdmission : pin.currentAdmission, producer_admission_sha256: pin.producerAdmission, producer_receipt_sha256: pin.producerReceipt, comfy_base_model_sha256: pin.model, comfy_nodes_sha256: pin.nodes, comfy_sd_sha256: pin.sd, comfy_commit: pin.commit, ownership_sha256: pin.ownership, runtime_sha256: pin.runtime, matched_admission_id: `figment-local-lora-matched-${stage}-20260908-v1`, checkpoint: stage === 'base' ? null : { filename: 'figmentlocalg01quality-current-100-step00000020.safetensors', ss_steps: '20', sha256: pin.checkpoint, header_sha256: pin.checkpointHeader, unet_tensor_keys: 2166, bytes: 170540948 }, base_receipt_sha256: stage === 'base' ? null : baseHash, base_png_sha256_by_seed: stage === 'base' ? null : { '481516234': digest(baseImages[0]), '90210': digest(baseImages[1]) } }, lora_application: { comfy_missing_lora_key_warnings: 0, header_unet_keys: stage === 'base' ? 0 : 2166 }, rows: [481516234, 90210].map((seed, index) => ({ seed, row_id: `${stage}-seed-${seed}`, prompt_id: `prompt-${seed}`, output: { filename: `figment-local-lora-matched_0000${index + 1}_.png`, sha256: digest(images[index]), bytes: images[index].length, dimensions: [1024, 1024] } })) });
  const baseReceipt = join(base, 'receipt.json'); const baseRaw = await json(baseReceipt, makeReceipt('base', baseImages)); const currentReceipt = join(current, 'receipt.json'); await json(currentReceipt, makeReceipt('current-20', currentImages, digest(baseRaw)));
  for (const [stage, directory, receiptHash] of [['base', base, digest(baseRaw)], ['current-20', current, digest(await (await import('node:fs/promises')).readFile(currentReceipt))]] as const) for (const role of ['root', 'independent'] as const) await json(join(directory, `review-${role}.json`), { schema: 'figment/local-lora-matched-pair-review@1', stage, reviewer_role: role, reviewer_id: role, receipt_sha256: receiptHash, rows: [481516234, 90210].map((seed, index) => ({ seed, output_sha256: digest((stage === 'base' ? baseImages : currentImages)[index]) })), disposition: stage === 'current-20' && role === 'independent' ? 'stop' : 'continue', not_promotable: true, human_qa: false, observations: [observation(481516234), observation(90210)] });
  return { roots: { base, current20: current }, baseReceipt, currentReceipt, currentReview: join(current, 'review-independent.json'), image: join(current, 'output', 'figment-local-lora-matched_00001_.png') };
}

async function rebindCurrentReviews(evidence: Awaited<ReturnType<typeof fixture>>): Promise<void> {
  const receiptHash = digest(await readFile(evidence.currentReceipt));
  for (const role of ['root', 'independent'] as const) {
    const path = join(evidence.roots.current20, `review-${role}.json`);
    const value = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    value.receipt_sha256 = receiptHash;
    await json(path, value);
  }
}

describe('matched diagnostic gallery', () => {
  it('projects exactly two historical same-seed pairs and recorded disagreement without paths', async () => { const evidence = await fixture(); const projection = collectMatchedGallery(evidence.roots); expect(projection).toMatchObject({ status: 'recorded', historical: true, notPromotable: true, conditioning: 'no-pixel-reference-conditioning', pairs: [{ seed: 481516234, base: { assetId: 'base-481516234' }, current20: { assetId: 'current-20-481516234' }, reviews: { root: { current20: { disposition: 'continue' } }, independent: { current20: { disposition: 'stop' } } } }, { seed: 90210 }] }); expect(JSON.stringify(projection)).not.toContain(evidence.image); });
  it('serves only a fixed asset after revalidating its hash-bound evidence', async () => { const evidence = await fixture(); const projection = collectMatchedGallery(evidence.roots); if (projection.status !== 'recorded') throw new Error('fixture unavailable'); const asset = projection.pairs[0].current20; expect(readMatchedGalleryAsset(evidence.roots, asset.assetId, asset.sha256)).toEqual(png(3)); expect(readMatchedGalleryAsset(evidence.roots, 'current-20-481516234', '0'.repeat(64))).toBeNull(); expect(readMatchedGalleryAsset(evidence.roots, 'current-20-../x', asset.sha256)).toBeNull(); });
  it('fails closed for a changed base binding even when both receipt-review hashes are rebound', async () => {
    const evidence = await fixture(); const current = JSON.parse(await readFile(evidence.currentReceipt, 'utf8')) as Record<string, unknown>;
    (current.inputs as Record<string, unknown>).base_receipt_sha256 = '0'.repeat(64);
    await json(evidence.currentReceipt, current); await rebindCurrentReviews(evidence);
    expect(collectMatchedGallery(evidence.roots)).toEqual({ status: 'unavailable', reason: 'evidence-unavailable' });
  });
  it('fails closed for a changed pinned runtime even when both receipt-review hashes are rebound', async () => {
    const evidence = await fixture(); const current = JSON.parse(await readFile(evidence.currentReceipt, 'utf8')) as Record<string, unknown>;
    (current.inputs as Record<string, unknown>).runtime_sha256 = '0'.repeat(64);
    await json(evidence.currentReceipt, current); await rebindCurrentReviews(evidence);
    expect(collectMatchedGallery(evidence.roots)).toEqual({ status: 'unavailable', reason: 'evidence-unavailable' });
  });
  it('refuses reversed receipt rows despite correspondingly rebound review rows', async () => {
    const evidence = await fixture(); const current = JSON.parse(await readFile(evidence.currentReceipt, 'utf8')) as Record<string, unknown>;
    current.rows = [...(current.rows as unknown[])].reverse(); await json(evidence.currentReceipt, current); await rebindCurrentReviews(evidence);
    for (const role of ['root', 'independent'] as const) {
      const path = join(evidence.roots.current20, `review-${role}.json`); const review = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
      review.rows = [...(review.rows as unknown[])].reverse(); review.observations = [...(review.observations as unknown[])].reverse(); await json(path, review);
    }
    await rebindCurrentReviews(evidence);
    expect(collectMatchedGallery(evidence.roots)).toEqual({ status: 'unavailable', reason: 'evidence-unavailable' });
  });
  it('fails closed for malformed review, changed image, or reparse root', async () => { const second = await fixture(); const review = JSON.parse(await readFile(second.currentReview, 'utf8')) as Record<string, unknown>; review.reviewer_role = 'root'; await json(second.currentReview, review); expect(collectMatchedGallery(second.roots)).toEqual({ status: 'unavailable', reason: 'evidence-unavailable' }); const third = await fixture(); await writeFile(third.image, png(9)); expect(collectMatchedGallery(third.roots)).toEqual({ status: 'unavailable', reason: 'evidence-unavailable' }); const fourth = await fixture(); const linked = `${fourth.roots.base}-link`; await symlink(fourth.roots.base, linked, 'dir'); temporary.push(linked); expect(collectMatchedGallery({ ...fourth.roots, base: linked })).toEqual({ status: 'unavailable', reason: 'evidence-unavailable' }); });
  it('refuses relative roots', async () => { const evidence = await fixture(); expect(collectMatchedGallery({ ...evidence.roots, base: '.' })).toEqual({ status: 'unavailable', reason: 'evidence-unavailable' }); });
  it('rejects a same-size path mutation during a bounded read', async () => {
    const evidence = await fixture(); let calls = 0; let changed = false;
    vi.resetModules();
    vi.doMock('node:fs', async (importOriginal) => {
      const original = await importOriginal<typeof import('node:fs')>();
      return { ...original, readSync: (...args: Parameters<typeof original.readSync>) => {
        const count = original.readSync(...args);
        calls += 1;
        // The fourth bounded read is the current-stage receipt after the three base JSON records.
        if (!changed && calls === 4) { changed = true; const raw = original.readFileSync(evidence.currentReceipt); raw[raw.length - 1] = 0x20; original.writeFileSync(evidence.currentReceipt, raw); }
        return count;
      } };
    });
    const mocked = await import('./matchedGallery.ts');
    expect(mocked.collectMatchedGallery(evidence.roots)).toEqual({ status: 'unavailable', reason: 'evidence-unavailable' });
    vi.doUnmock('node:fs'); vi.resetModules();
  });
  it('distinguishes an omitted configuration from invalid configured evidence', () => { expect(collectMatchedGallery()).toEqual({ status: 'not-configured' }); expect(collectMatchedGallery({} as FigmentMatchedGalleryRoots)).toEqual({ status: 'unavailable', reason: 'evidence-unavailable' }); });
});
