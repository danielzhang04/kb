import { copyFile, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The study pins raw SHA-256 of three records and two 1024x1024 PNGs that are NOT in the repository.
// This mock only remaps digests of the synthetic PNG stand-ins to the pinned values.
// The three record fixtures use their REAL pinned raw-byte hashes. Any other input,
// including every mutated byte stream in the tests below, gets its REAL digest.
const emulated = vi.hoisted(() => new Map<string, string>());
vi.mock('node:crypto', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:crypto')>();
  return { ...original, createHash: (algorithm: string) => {
    const inner = original.createHash(algorithm);
    return { update(chunk: Buffer | string) { inner.update(chunk); return this; }, digest(encoding: 'hex') { const real = inner.digest(encoding); return emulated.get(real) ?? real; } };
  } };
});

import { collectProfileGallery, readProfileGalleryAsset } from './profileGallery.ts';
import { fileURLToPath } from 'node:url';

const actualCrypto = await vi.importActual<typeof import('node:crypto')>('node:crypto');

const PIN = { receipt: '26e2396b3247730f9124386beb32198fba12930b85fddd18297165e27b7bd44c', root: '8e79c86410942edcb406982c3dbc2f2dffdbdfa0e8b15cdb3e409bd7ea9bef65', independent: '952fb76424ddca547a4289951d63424321e84b73bb7768f38bb03d165f135403' };
const IMAGES = [
  { file: 'figment-local-lora-matched_00001_.png', sha256: '4235253ac57bbc22ef1d697fa453f938b38de5ba3946d5f2c8a433fbe91be1e1', bytes: 1394954 },
  { file: 'figment-local-lora-matched_00002_.png', sha256: '00aa9673edb2a9ae6aed1084fcbf977795420f41bbe197d51a649e25dd177ace', bytes: 1415024 },
] as const;
const FIXTURES = fileURLToPath(new URL('./fixtures/profile-base-20260908/', import.meta.url));
const temporary: string[] = [];
afterEach(async () => { emulated.clear(); while (temporary.length) await rm(temporary.pop()!, { recursive: true, force: true }); });

const realDigest = (value: Buffer): string => actualCrypto.createHash('sha256').update(value).digest('hex');
function png(size: number, width = 1024, salt = 0): Buffer { const value = Buffer.alloc(size); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(value); value.writeUInt32BE(13, 8); value.write('IHDR', 12, 'ascii'); value.writeUInt32BE(width, 16); value.writeUInt32BE(1024, 20); value[32] = salt; return value; }

async function study(): Promise<{ root: string; image: string }> {
  const root = await mkdtemp(join(tmpdir(), 'figment-profile-gallery-')); temporary.push(root); await mkdir(join(root, 'output'));
  for (const [name, pin] of [['receipt.json', PIN.receipt], ['review-root.json', PIN.root], ['review-independent.json', PIN.independent]] as const) { await copyFile(join(FIXTURES, name), join(root, name)); expect(realDigest(await readFile(join(root, name)))).toBe(pin); }
  for (const image of IMAGES) { const data = png(image.bytes); emulated.set(realDigest(data), image.sha256); await writeFile(join(root, 'output', image.file), data); }
  return { root, image: join(root, 'output', IMAGES[0].file) };
}
const unavailable = { status: 'unavailable', reason: 'evidence-unavailable' };

describe('profile-base historical gallery', () => {
  it('projects the fixed study with both reviews kept separate and nothing but bounded fields', async () => {
    const evidence = await study(); const projection = collectProfileGallery(evidence.root);
    expect(projection).toMatchObject({ status: 'recorded', stage: 'profile-base', historical: true, notPromotable: true, conditioning: 'no-pixel-reference-conditioning', selectedCheckpoint: null, rows: [{ seed: 481516234, asset: { assetId: 'profile-base-481516234', sha256: IMAGES[0].sha256, bytes: IMAGES[0].bytes, width: 1024, height: 1024 } }, { seed: 90210, asset: { assetId: 'profile-base-90210' } }] });
    if (projection.status !== 'recorded') throw new Error('unreachable');
    const second = projection.rows[1].reviews;
    expect(second.root.disposition).toBe('stop'); expect(second.independent.disposition).toBe('stop');
    expect(second.root.observations.pose).toContain('direct camera gaze'); expect(second.independent.observations.pose).toContain('direct camera gaze is absent');
    expect(second.root.reason).not.toBe(second.independent.reason);
    expect(Object.keys(second.independent.observations).sort()).toEqual(['apparent_adulthood', 'apparent_age_fit', 'clothing', 'defects', 'pose', 'realism', 'resemblance_to_g01']);
    const serialized = JSON.stringify(projection);
    for (const leak of [evidence.root, 'prompt_id', '2ccebf5a', 'pid', '42260', 'record_provenance', 'claude-opus-5', 'source_result', 'verified_graph', 'current20_checkpoint']) expect(serialized).not.toContain(leak);
  });
  it('serves only the two known assets by id plus matching pinned hash', async () => {
    const evidence = await study();
    expect(readProfileGalleryAsset(evidence.root, 'profile-base-481516234', IMAGES[0].sha256)?.equals(png(IMAGES[0].bytes))).toBe(true);
    expect(readProfileGalleryAsset(evidence.root, 'profile-base-481516234', IMAGES[1].sha256)).toBeNull();
    expect(readProfileGalleryAsset(evidence.root, 'profile-base-90210', '0'.repeat(64))).toBeNull();
    expect(readProfileGalleryAsset(evidence.root, '../receipt.json', IMAGES[0].sha256)).toBeNull();
    expect(readProfileGalleryAsset(evidence.root, 'profile-base-1', IMAGES[0].sha256)).toBeNull();
    expect(readProfileGalleryAsset(undefined, 'profile-base-481516234', IMAGES[0].sha256)).toBeNull();
  });
  it('fails closed on any raw byte change to a pinned record, even whitespace', async () => {
    for (const name of ['receipt.json', 'review-independent.json']) { const evidence = await study(); const path = join(evidence.root, name); await writeFile(path, Buffer.concat([await readFile(path), Buffer.from(' ')])); expect(collectProfileGallery(evidence.root)).toEqual(unavailable); expect(readProfileGalleryAsset(evidence.root, 'profile-base-90210', IMAGES[1].sha256)).toBeNull(); }
  });
  it('fails closed on a missing record', async () => { const evidence = await study(); await rm(join(evidence.root, 'review-root.json')); expect(collectProfileGallery(evidence.root)).toEqual(unavailable); });
  it('fails closed on a changed, wrong-size, or wrong-dimension PNG', async () => {
    const changed = await study(); await writeFile(changed.image, png(IMAGES[0].bytes, 1024, 7)); expect(collectProfileGallery(changed.root)).toEqual(unavailable); expect(readProfileGalleryAsset(changed.root, 'profile-base-481516234', IMAGES[0].sha256)).toBeNull();
    const short = await study(); await writeFile(short.image, png(33)); expect(collectProfileGallery(short.root)).toEqual(unavailable);
    const wide = await study(); const data = png(IMAGES[0].bytes, 512); emulated.set(realDigest(data), IMAGES[0].sha256); await writeFile(wide.image, data); expect(collectProfileGallery(wide.root)).toEqual(unavailable);
  });
  it('refuses a reparse point at the root or on the path to a record', async () => {
    const linkedRoot = await study(); const link = `${linkedRoot.root}-link`; await symlink(linkedRoot.root, link, 'junction'); temporary.push(link); expect(collectProfileGallery(link)).toEqual(unavailable);
    const linkedOutput = await study(); await rm(join(linkedOutput.root, 'output'), { recursive: true }); const aside = await mkdtemp(join(tmpdir(), 'figment-profile-aside-')); temporary.push(aside); for (const image of IMAGES) await writeFile(join(aside, image.file), png(image.bytes)); await symlink(aside, join(linkedOutput.root, 'output'), 'junction'); expect(collectProfileGallery(linkedOutput.root)).toEqual(unavailable);
  });
  it('distinguishes an omitted root from an invalid one', async () => {
    expect(collectProfileGallery()).toEqual({ status: 'not-configured' }); expect(collectProfileGallery(null)).toEqual({ status: 'not-configured' });
    expect(collectProfileGallery('.')).toEqual(unavailable); expect(collectProfileGallery('')).toEqual(unavailable); expect(collectProfileGallery(join(tmpdir(), 'figment-profile-gallery-does-not-exist'))).toEqual(unavailable);
    const evidence = await study(); expect(collectProfileGallery(join(evidence.root, 'receipt.json'))).toEqual(unavailable);
  });
});
