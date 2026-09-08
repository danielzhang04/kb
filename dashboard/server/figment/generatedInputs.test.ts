import { createHash } from 'node:crypto';
import { mkdtemp, rm, mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { PNG } from 'pngjs';
import { collectGeneratedInputs, readGeneratedInput } from './generatedInputs.ts';

const opened = vi.hoisted(() => ({ enabled: false, paths: [] as string[] }));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    openSync: (...args: Parameters<typeof actual.openSync>) => {
      if (opened.enabled) opened.paths.push(String(args[0]));
      return actual.openSync(...args);
    },
  };
});

const png = (): Buffer => Buffer.from(PNG.sync.write({ width: 4, height: 3, data: Buffer.alloc(4 * 3 * 4, 128) }));
const sha = (value: Buffer): string => createHash('sha256').update(value).digest('hex');

async function fixture(): Promise<{ repo: string; generated: string; name: string; image: Buffer }> {
  const base = await mkdtemp(join(tmpdir(), 'figment-generated-')); const repo = join(base, 'repo'); const generated = join(base, 'generated'); const image = png(); const name = 'g01-e01-shoulders-up-v1.png';
  await mkdir(join(repo, 'orgs', 'figment', 'personas', 'creator-001', 'anchors'), { recursive: true }); await mkdir(generated, { recursive: true });
  await writeFile(join(repo, 'orgs', 'figment', 'personas', 'creator-001', 'anchors', 'g01.jpg'), image);
  await writeFile(join(generated, name), image);
  await writeFile(join(generated, 'g01-e01-shoulders-up-v1.provenance.json'), JSON.stringify({ schema: 'figment/generated-input-experiment@1', creator: 'creator-001', source: { reference: 'anchors/g01.jpg', sha256: sha(image) }, output: { file: name, sha256: sha(image), bytes: image.length }, generation: { date: '2026-09-08' }, review: { status: 'experimental-unreviewed', identity: 'dated observation' } }));
  return { repo, generated, name, image };
}

async function addPair(generated: string, image: Buffer, index: number, sourceSha: string, valid = true): Promise<void> {
  const stem = `g01-candidate-${String(index).padStart(2, '0')}`; const name = `${stem}.png`;
  await writeFile(join(generated, name), image);
  await writeFile(join(generated, `${stem}.provenance.json`), JSON.stringify({ schema: 'figment/generated-input-experiment@1', creator: 'creator-001', source: { reference: 'anchors/g01.jpg', sha256: sourceSha }, output: { file: name, sha256: valid ? sha(image) : 'a'.repeat(64), bytes: image.length }, generation: { date: '2026-09-08' }, review: { status: 'experimental-unreviewed' } }));
}

describe('generated input inventory', () => {
  it('projects only a hash-bound declared pair and reads the requested asset at its projected hash', async () => {
    const item = await fixture(); try { const projection = collectGeneratedInputs(item.repo, item.generated); expect(projection).toMatchObject({ available: true, truncated: false, items: [{ name: item.name, sha256: sha(item.image), sourceReference: 'anchors/g01.jpg', reviewStatus: 'experimental-unreviewed' }] }); expect(JSON.stringify(projection)).not.toContain('training_eligible'); expect(readGeneratedInput(item.repo, item.generated, item.name, sha(item.image))?.bytes).toEqual(item.image); await writeFile(join(item.generated, item.name), Buffer.from(item.image).fill(7)); expect(readGeneratedInput(item.repo, item.generated, item.name, sha(item.image))).toBeNull(); } finally { await rm(join(item.repo, '..'), { recursive: true, force: true }); } });

  it('rejects a pair whose declared canonical source hash does not equal the live fixed g01', async () => {
    const item = await fixture(); try { const provenance = join(item.generated, 'g01-e01-shoulders-up-v1.provenance.json'); const value = JSON.parse(await (await import('node:fs/promises')).readFile(provenance, 'utf8')); value.source.sha256 = 'a'.repeat(64); await writeFile(provenance, JSON.stringify(value)); expect(collectGeneratedInputs(item.repo, item.generated).items).toEqual([]); } finally { await rm(join(item.repo, '..'), { recursive: true, force: true }); } });

  it('distinguishes an invalid seventeenth pair from a valid truncating seventeenth pair', async () => {
    const item = await fixture(); try {
      for (let index = 0; index < 15; index += 1) await addPair(item.generated, item.image, index, sha(item.image));
      await addPair(item.generated, item.image, 16, sha(item.image), false);
      expect(collectGeneratedInputs(item.repo, item.generated)).toMatchObject({ truncated: false });
      await addPair(item.generated, item.image, 16, sha(item.image));
      expect(collectGeneratedInputs(item.repo, item.generated)).toMatchObject({ truncated: true });
    } finally { await rm(join(item.repo, '..'), { recursive: true, force: true }); }
  });

  it('refuses physical overflow for both projection and binary read', async () => {
    const item = await fixture(); try {
      for (let index = 0; index < 33; index += 1) await writeFile(join(item.generated, `junk-${index}.txt`), 'x');
      expect(collectGeneratedInputs(item.repo, item.generated)).toMatchObject({ available: false });
      expect(readGeneratedInput(item.repo, item.generated, item.name, sha(item.image))).toBeNull();
    } finally { await rm(join(item.repo, '..'), { recursive: true, force: true }); }
  });


  it('refuses traversal names and an over-eight-megabyte real PNG payload', async () => {
    const item = await fixture(); try {
      expect(readGeneratedInput(item.repo, item.generated, '../outside.png', sha(item.image))).toBeNull();
      const oversized = Buffer.concat([item.image, Buffer.alloc(8 * 1024 * 1024)]);
      await writeFile(join(item.generated, item.name), oversized);
      const provenance = join(item.generated, 'g01-e01-shoulders-up-v1.provenance.json'); const row = JSON.parse(await (await import('node:fs/promises')).readFile(provenance, 'utf8')); row.output.sha256 = sha(oversized); row.output.bytes = oversized.length; await writeFile(provenance, JSON.stringify(row));
      expect(collectGeneratedInputs(item.repo, item.generated).items).toEqual([]);
    } finally { await rm(join(item.repo, '..'), { recursive: true, force: true }); }
  });


  it('enforces the aggregate image-byte cap', async () => {
    const item = await fixture(); try {
      const padded = Buffer.concat([item.image, Buffer.alloc(7 * 1024 * 1024 + 512 * 1024)]);
      await writeFile(join(item.generated, item.name), padded); const first = JSON.parse(await (await import('node:fs/promises')).readFile(join(item.generated, 'g01-e01-shoulders-up-v1.provenance.json'), 'utf8')); first.output.sha256 = sha(padded); first.output.bytes = padded.length; await writeFile(join(item.generated, 'g01-e01-shoulders-up-v1.provenance.json'), JSON.stringify(first));
      for (let index = 0; index < 8; index += 1) await addPair(item.generated, padded, index, sha(item.image));
      const result = collectGeneratedInputs(item.repo, item.generated); expect(result.items).toHaveLength(8);
    } finally { await rm(join(item.repo, '..'), { recursive: true, force: true }); }
  });


  it('refuses a real Windows junction configured as the generated-input root', async () => {
    const item = await fixture(); const outside = `${item.generated}-outside`; try {
      await mkdir(outside); await rm(item.generated, { recursive: true, force: true }); await symlink(outside, item.generated, 'junction');
      expect(collectGeneratedInputs(item.repo, item.generated)).toMatchObject({ available: false });
    } finally { await rm(join(item.repo, '..'), { recursive: true, force: true }); }
  });

  it('opens only the requested generated pair during a binary read', async () => {
    const item = await fixture(); try {
      await addPair(item.generated, item.image, 1, sha(item.image));
      opened.paths = []; opened.enabled = true;
      try {
        expect(readGeneratedInput(item.repo, item.generated, item.name, sha(item.image))?.bytes).toEqual(item.image);
      } finally { opened.enabled = false; }
      const observed = opened.paths.map((path) => path.replaceAll('\\', '/'));
      expect(observed.some((path) => path.endsWith('/g01-e01-shoulders-up-v1.png'))).toBe(true);
      expect(observed.some((path) => path.endsWith('/g01-e01-shoulders-up-v1.provenance.json'))).toBe(true);
      expect(observed.some((path) => path.endsWith('/g01-candidate-01.png'))).toBe(false);
      expect(observed.some((path) => path.endsWith('/g01-candidate-01.provenance.json'))).toBe(false);
    } finally { await rm(join(item.repo, '..'), { recursive: true, force: true }); }
  });


  it('accepts the current legacy provenance shape without output bytes', async () => {
    const item = await fixture(); try { const provenance = join(item.generated, 'g01-e01-shoulders-up-v1.provenance.json'); const row = JSON.parse(await (await import('node:fs/promises')).readFile(provenance, 'utf8')); delete row.output.bytes; delete row.output.dimensions; await writeFile(provenance, JSON.stringify(row)); expect(collectGeneratedInputs(item.repo, item.generated).items).toHaveLength(1); } finally { await rm(join(item.repo, '..'), { recursive: true, force: true }); }
  });

});

