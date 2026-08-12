/**
 * A real Windows share violation cannot be provoked on a test runner (it needs a second process
 * holding the destination open without FILE_SHARE_DELETE at the exact instant of the rename), so
 * both layers inject the failure instead: the unit tests pass a fake `rename`, and the end-to-end
 * tests replace ONLY `renameSync` in `node:fs` so the real control-plane save path runs otherwise
 * untouched against the real filesystem.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type Rename = (from: string, to: string) => void;

/** Swapped per test; when null every rename falls through to the real one. */
let renameBehavior: Rename | null = null;

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const renameSync: Rename = (from, to) => (renameBehavior ?? actual.renameSync)(from, to);
  return { ...actual, default: { ...actual, renameSync }, renameSync };
});

const realFs = await vi.importActual<typeof import('node:fs')>('node:fs');
const { ATOMIC_RENAME_ATTEMPTS, renameWithRetrySync } = await import('./atomicRename.ts');
const { createFileControlPlaneStore } = await import('./control/store.ts');

function fail(code: string): Error {
  return Object.assign(new Error(`${code}: operation not permitted, rename`), { code });
}

const roots: string[] = [];
beforeEach(() => {
  renameBehavior = null;
});
afterEach(() => {
  renameBehavior = null;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('renameWithRetrySync', () => {
  it('retries a transient share violation and then succeeds', () => {
    const calls: Array<[string, string]> = [];
    const sleeps: number[] = [];
    let remaining = 3;
    renameWithRetrySync('a.tmp', 'a', {
      rename: (from, to) => {
        calls.push([from, to]);
        if (remaining-- > 0) throw fail('EPERM');
      },
      sleep: (ms) => sleeps.push(ms),
    });
    expect(calls).toEqual([['a.tmp', 'a'], ['a.tmp', 'a'], ['a.tmp', 'a'], ['a.tmp', 'a']]);
    expect(sleeps).toEqual([5, 10, 20]);
  });

  it('gives up after the bounded attempts and rethrows the ORIGINAL error', () => {
    const original = fail('EPERM');
    const sleeps: number[] = [];
    let attempts = 0;
    expect(() => renameWithRetrySync('a.tmp', 'a', {
      rename: () => { attempts += 1; throw original; },
      sleep: (ms) => sleeps.push(ms),
    })).toThrow(original);
    expect(attempts).toBe(ATOMIC_RENAME_ATTEMPTS);
    expect(sleeps).toEqual([5, 10, 20, 40, 80, 160, 160, 160, 160]);
    // The bound stays under a second of waiting, so a genuinely stuck target still fails promptly.
    expect(sleeps.reduce((total, ms) => total + ms, 0)).toBeLessThan(1_000);
  });

  it('rethrows a non-transient error immediately without retrying', () => {
    for (const code of ['ENOENT', 'EXDEV', 'EISDIR']) {
      const original = fail(code);
      const sleeps: number[] = [];
      let attempts = 0;
      expect(() => renameWithRetrySync('a.tmp', 'a', {
        rename: () => { attempts += 1; throw original; },
        sleep: (ms) => sleeps.push(ms),
      })).toThrow(original);
      expect(attempts).toBe(1);
      expect(sleeps).toEqual([]);
    }
  });

  it('treats EBUSY and EACCES as transient as well', () => {
    for (const code of ['EBUSY', 'EACCES']) {
      let remaining = 1;
      let attempts = 0;
      renameWithRetrySync('a.tmp', 'a', {
        rename: () => { attempts += 1; if (remaining-- > 0) throw fail(code); },
        sleep: () => {},
      });
      expect(attempts).toBe(2);
    }
  });

  it('rethrows an error carrying no code without retrying', () => {
    const original = new Error('rename exploded');
    let attempts = 0;
    expect(() => renameWithRetrySync('a.tmp', 'a', {
      rename: () => { attempts += 1; throw original; },
      sleep: () => {},
    })).toThrow(original);
    expect(attempts).toBe(1);
  });

  it('sleeps for real between attempts when no sleep is injected', () => {
    let remaining = 2;
    const started = Date.now();
    renameWithRetrySync('a.tmp', 'a', {
      rename: () => { if (remaining-- > 0) throw fail('EPERM'); },
    });
    expect(Date.now() - started).toBeGreaterThanOrEqual(10);
  });
});

function temporaryRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

describe('control-plane save under a destination reader collision', () => {
  it('survives a transient collision: state lands, no temp residue', () => {
    const root = temporaryRoot('atomic-rename-transient-');
    const store = createFileControlPlaneStore(root);
    let remaining = 3;
    renameBehavior = (from, to) => {
      if (remaining-- > 0) throw fail('EPERM');
      realFs.renameSync(from, to);
    };
    const created = store.createProposalRevision('alice', {
      sourceComposerRef: 'composer-1',
      sourceTurnId: 'turn-1',
      title: 'Collision survivor',
      snapshot: { version: 1 },
    });
    expect(created.ok).toBe(true);
    expect(remaining).toBeLessThan(0);

    renameBehavior = null;
    const path = join(root, 'control', 'control-plane.json');
    const persisted = JSON.parse(readFileSync(path, 'utf8')) as { proposals: Array<{ title: string }> };
    expect(persisted.proposals.map((proposal) => proposal.title)).toEqual(['Collision survivor']);
    expect(readdirSync(join(root, 'control')).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('still fails loud when the collision never clears', () => {
    const root = temporaryRoot('atomic-rename-persistent-');
    const store = createFileControlPlaneStore(root);
    let attempts = 0;
    renameBehavior = () => { attempts += 1; throw fail('EPERM'); };
    expect(() => store.createProposalRevision('alice', {
      sourceComposerRef: 'composer-1',
      sourceTurnId: 'turn-1',
      title: 'Never lands',
      snapshot: { version: 1 },
    })).toThrow(/EPERM/);
    expect(attempts).toBe(ATOMIC_RENAME_ATTEMPTS);
    renameBehavior = null;
    expect(readdirSync(join(root, 'control')).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });
});
