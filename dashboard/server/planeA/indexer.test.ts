import { cpSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FSWatcher } from 'chokidar';
import { indexRepo, watchPlaneA } from './indexer.ts';

const REPO_A = fileURLToPath(new URL('../__fixtures__/repo-a/', import.meta.url));

/** Copy the read-only fixture into a scratch dir so watch-tests can write into it. */
function scratchRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'planeA-repo-'));
  cpSync(REPO_A, dir, { recursive: true });
  return dir;
}

let watcher: FSWatcher | undefined;
afterEach(async () => {
  if (watcher) {
    await watcher.close();
    watcher = undefined;
  }
});

const CARD = [
  '---',
  'id: bbbb0001-9999',
  'project: kb',
  'action: cadence:new',
  'target: .',
  'risk-tier: T1',
  'owner: null',
  'state: inbox',
  '---',
  '',
  '## Work order',
  '',
  'freshly written card',
  '',
].join('\n');

describe('indexRepo', () => {
  it('builds a full Plane-A index (cards grouped by state, ledger rollup, org states)', () => {
    const idx = indexRepo(REPO_A);
    expect(Object.keys(idx.cards).sort()).toEqual(
      ['approvals', 'approved', 'blocked', 'done', 'inbox', 'rejected', 'working'].sort(),
    );
    expect(idx.ledgers.dispatch.count).toBe(2);
    expect(idx.orgStates).toHaveLength(1);
    expect(idx.rejectedCards).toBe(0);
  });

  it('counts and warns for rejected cards without dropping valid cards', () => {
    const repo = scratchRepo();
    const malformed = join(repo, 'queue', 'inbox', 'malformed.md');
    writeFileSync(malformed, 'not frontmatter', 'utf-8');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const idx = indexRepo(repo);
      expect(idx.rejectedCards).toBe(1);
      expect(Object.values(idx.cards).flat()).toHaveLength(7);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(malformed));
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/frontmatter/i));
    } finally {
      warn.mockRestore();
    }
  });
});

describe('watchPlaneA', () => {
  it('fires onChange when a card file is written', async () => {
    const repo = scratchRepo();

    const changed = new Promise<{ kind: string; path: string }>((resolve) => {
      watchPlaneA(repo, (delta) => resolve(delta)).then((w) => {
        watcher = w;
        // write a brand-new card only after the watcher is ready (ignoreInitial)
        writeFileSync(join(repo, 'queue', 'inbox', 'card-new.md'), CARD, 'utf-8');
      });
    });

    const delta = await changed;
    expect(delta.kind).toBe('cards');
    expect(delta.path).toContain('card-new.md');
  }, 10_000);
});
