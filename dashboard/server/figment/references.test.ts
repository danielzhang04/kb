import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectDeclaredReferences, readDeclaredReference } from './references.ts';

const roots: string[] = [];
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }); });

function png(width = 2, height = 3): Buffer {
  const value = Buffer.alloc(33); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(value); value.writeUInt32BE(13, 8); value.write('IHDR', 12); value.writeUInt32BE(width, 16); value.writeUInt32BE(height, 20); return value;
}
function jpeg(width = 4, height = 5): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0, 0xff, 0xc0, 0x00, 0x0b, 8, height >> 8, height & 255, width >> 8, width & 255, 1, 1, 0x11, 0, 0xff, 0xd9]);
}
async function fixture(references = ['anchors/g01.jpg']): Promise<{ root: string; anchor: string }> {
  const root = await mkdtemp(join(tmpdir(), 'figment-references-')); roots.push(root);
  const anchors = join(root, 'personas', 'creator-001', 'anchors'); await mkdir(anchors, { recursive: true });
  await writeFile(join(root, 'personas', 'creator-001', 'persona.yaml'), JSON.stringify({ identity: { references } }), 'utf8');
  const anchor = join(anchors, 'g01.jpg'); await writeFile(anchor, jpeg());
  return { root, anchor };
}

describe('declared persona references', () => {
  it('projects only declared JPEG/PNG anchors with their computed hash and dimensions', async () => {
    const { root } = await fixture(['anchors/g01.jpg', 'anchors/g02.png']);
    await writeFile(join(root, 'personas', 'creator-001', 'anchors', 'g02.png'), png());
    const result = collectDeclaredReferences(root);
    expect(result).toMatchObject({ truncated: false, items: [
      { creator: 'creator-001', name: 'g01.jpg', bytes: 23, width: 4, height: 5 },
      { creator: 'creator-001', name: 'g02.png', bytes: 33, width: 2, height: 3 },
    ] });
    expect(result.items[0].sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('uses bounded membership and hashes only the requested fresh asset for binary reads', async () => {
    const { root } = await fixture(['anchors/g01.jpg', 'anchors/g02.png']); const second = join(root, 'personas', 'creator-001', 'anchors', 'g02.png'); await writeFile(second, png());
    const projection = collectDeclaredReferences(root); const first = projection.items[0];
    await writeFile(second, Buffer.from('not an image'));
    const loaded = readDeclaredReference(root, 'creator-001', 'g01.jpg', first.sha256);
    expect(loaded).toMatchObject({ contentType: 'image/jpeg', width: 4, height: 5 });
    expect(readDeclaredReference(root, 'creator-001', 'g01.jpg', 'f'.repeat(64))).toBeNull();
  });

  it('rejects undeclared paths, traversal, symlinks, malformed headers, and invalid dimensions', async () => {
    const { root } = await fixture(['anchors/g01.jpg', '../outside.png']);
    expect(collectDeclaredReferences(root).items).toEqual([]);
    await writeFile(join(root, 'personas', 'creator-001', 'persona.yaml'), JSON.stringify({ identity: { references: ['anchors/g01.jpg'] } }));
    await writeFile(join(root, 'personas', 'creator-001', 'anchors', 'g01.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x08, 8, 0, 0, 0, 1]));
    expect(collectDeclaredReferences(root).items).toEqual([]);
    const outside = await mkdtemp(join(tmpdir(), 'figment-reference-outside-')); roots.push(outside); await writeFile(join(outside, 'g01.jpg'), jpeg());
    await rm(join(root, 'personas', 'creator-001', 'anchors', 'g01.jpg')); await symlink(join(outside, 'g01.jpg'), join(root, 'personas', 'creator-001', 'anchors', 'g01.jpg'), 'file');
    expect(collectDeclaredReferences(root).items).toEqual([]);
  });

  it('truthfully truncates at the sixteenth declared member before image reads beyond the cap', async () => {
    const references = Array.from({ length: 17 }, (_, index) => `anchors/g${String(index).padStart(2, '0')}.png`); const { root } = await fixture(references);
    for (const reference of references.slice(0, 16)) await writeFile(join(root, 'personas', 'creator-001', reference), png());
    const result = collectDeclaredReferences(root);
    expect(result.items).toHaveLength(16); expect(result.truncated).toBe(true); expect(result.items.some((item) => item.name === 'g16.png')).toBe(false);
  });
});
