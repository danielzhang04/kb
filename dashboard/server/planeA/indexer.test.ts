import { cpSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
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

  it('projects the card file mtime as an optional ISO updatedAt outside frontmatter', () => {
    const repo = scratchRepo();
    const path = join(repo, 'queue', 'inbox', 'card-new.md');
    const modified = new Date('2026-08-26T14:23:45.000Z');
    writeFileSync(path, CARD, 'utf-8');
    utimesSync(path, modified, modified);

    const projected = Object.values(indexRepo(repo).cards).flat()
      .find((card) => card.meta.id === 'bbbb0001-9999');
    expect(projected?.updatedAt).toBe(modified.toISOString());
    expect(projected?.meta.updatedAt).toBeUndefined();
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

  it('hands the watcher over SYNCHRONOUSLY, before the returned promise settles', async () => {
    // The teardown contract `registerHub` depends on: a caller that only needs to CLOSE the watch must
    // never have to await the initial repo scan first.
    const repo = scratchRepo();
    let handed: FSWatcher | undefined;
    let settled = false;

    const ready = watchPlaneA(repo, () => {}, { onWatcher: (w) => { handed = w; } });
    // Synchronously after the call, with no await in between.
    expect(handed).toBeDefined();
    expect(settled).toBe(false);

    void ready.then(() => { settled = true; });
    watcher = await ready;
    expect(watcher).toBe(handed);
  }, 10_000);

  it('publishes nothing after close, even for a change queued while the watch was open', async () => {
    // The armed debounce timer: a write landing just before close used to flush 50 ms later, onto a
    // torn-down consumer.
    const repo = scratchRepo();
    const deltas: string[] = [];
    const open = await watchPlaneA(repo, (delta) => { deltas.push(delta.path); }, { debounceMs: 50 });

    writeFileSync(join(repo, 'queue', 'inbox', 'card-late.md'), CARD, 'utf-8');
    await open.close();
    await new Promise((settle) => { setTimeout(settle, 250); });

    expect(deltas).toEqual([]);
  }, 10_000);
});
