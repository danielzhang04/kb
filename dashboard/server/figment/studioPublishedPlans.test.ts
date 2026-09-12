import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, open, rm, symlink, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { safeRoot, studioPlanRoots, readPublishedStudioPlans, assertPublishedStudioCapacity, assertInventoryRoots } from './studioPublishedPlans.ts';

const owned: string[] = [];
afterEach(async () => { while (owned.length) await rm(owned.pop()!, { recursive: true, force: true }); });
async function repository() { const repo = await mkdtemp(join(tmpdir(), 'figment-shared-plan-index-')); owned.push(repo); const root = await safeRoot(repo); if (root === null) throw new Error('fixture root unavailable'); return { repo, root, roots: studioPlanRoots(repo) }; }
async function sparse(path: string, bytes: number) { const handle = await open(path, 'w'); try { await handle.truncate(bytes); } finally { await handle.close(); } }

describe('shared published-plan inventory boundaries', () => {
  it('counts bytes across both roots without doubling the 512 MiB allowance', async () => {
    const { root, roots } = await repository();
    const directories = [join(roots.legacy, '00000000-0000-4000-8000-000000000001'), join(roots.legacy, '00000000-0000-4000-8000-000000000002'), join(roots.allocation, '00000000-0000-4000-8000-000000000003')];
    for (const directory of directories) { await mkdir(directory, { recursive: true }); await sparse(join(directory, 'bounded-output.dat'), 170 * 1024 * 1024); }
    const inventory = await readPublishedStudioPlans(root);
    expect(inventory.published).toEqual([]); expect(inventory.unmarked).toBe(true); expect(inventory.directories).toHaveLength(3);
    // Every allocation is below 256 MiB and each root is below 512 MiB.
    // At 510 MiB combined capacity succeeds; 513 MiB must fail globally.
    await expect(assertPublishedStudioCapacity(root, inventory)).resolves.toBeUndefined();
    await sparse(join(directories[2], 'bounded-output.dat'), 173 * 1024 * 1024);
    await expect(assertPublishedStudioCapacity(root, inventory)).rejects.toThrow('unsafe-capacity');
  });

  it.each(['legacy', 'allocation'] as const)('detects a previously absent %s root appearing after collection', async (which) => {
    const { root, roots } = await repository(); const inventory = await readPublishedStudioPlans(root);
    expect(inventory.roots).toEqual([]);
    await mkdir(roots[which], { recursive: true });
    await expect(assertInventoryRoots(root, inventory)).rejects.toThrow('changed-root');
    await expect(assertPublishedStudioCapacity(root, inventory)).rejects.toThrow('changed-root');
  });

  it.each(['legacy', 'allocation'] as const)('does not interpret an existing file at %s as an absent root', async (which) => {
    const { root, roots } = await repository(); await mkdir(join(roots[which], '..'), { recursive: true }); await writeFile(roots[which], 'not a directory');
    await expect(readPublishedStudioPlans(root)).rejects.toThrow();
    expect(await readFile(roots[which], 'utf8')).toBe('not a directory');
  });

  it('refuses a link in the new root ancestry and preserves its external target', async () => {
    const { repo, root } = await repository(); const external = await mkdtemp(join(tmpdir(), 'figment-index-external-')); owned.push(external);
    await writeFile(join(external, 'sentinel'), 'untouched'); await mkdir(join(repo, 'orgs', 'figment'), { recursive: true });
    await symlink(external, join(repo, 'orgs', 'figment', '_private'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(readPublishedStudioPlans(root)).rejects.toThrow();
    expect(await readFile(join(external, 'sentinel'), 'utf8')).toBe('untouched');
  });
});
