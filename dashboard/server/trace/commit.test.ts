import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commitTraceToOps, writeTrace, writeTraceFile } from './commit';
import type { OpsGitRunner } from './commit';

const tmpDirs: string[] = [];
async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'trace-commit-'));
  tmpDirs.push(dir);
  return dir;
}
afterEach(async () => {
  while (tmpDirs.length) {
    const dir = tmpDirs.pop()!;
    await rm(dir, { recursive: true, force: true });
  }
});

/** A recording git runner; each call is captured as its argv (after `git`). */
function recorder(): { runner: OpsGitRunner; calls: string[][] } {
  const calls: string[][] = [];
  const runner: OpsGitRunner = (_repoRoot, args) => {
    calls.push(args);
    return '';
  };
  return { runner, calls };
}

describe('writeTraceFile', () => {
  it('writes the distilled HTML under traces/<card-id>/index.html', async () => {
    const repo = await scratch();
    const abs = writeTraceFile(repo, 'card-w', '<!doctype html><html></html>');
    expect(abs.replace(/\\/g, '/')).toContain('traces/card-w/index.html');
    const onDisk = await readFile(join(repo, 'traces', 'card-w', 'index.html'), 'utf8');
    expect(onDisk).toContain('<!doctype html>');
  });
});

describe('commitTraceToOps (injectable git-runner, hermetic)', () => {
  it('commits via pull --rebase -> add -> commit -> push, in that order, on ops', () => {
    const repo = '/fake/repo';
    const { runner, calls } = recorder();
    commitTraceToOps(repo, 'card-c', runner);

    const verbs = calls.map((c) => c.slice(0, 2).join(' '));
    expect(verbs).toEqual(['pull --rebase', 'add --', 'commit -m', 'push origin']);
    // pull/push target the ops branch.
    expect(calls[0]).toEqual(['pull', '--rebase', 'origin', 'ops']);
    expect(calls[3]).toEqual(['push', 'origin', 'ops']);
    // Only the trace dir is staged (never `git add .`).
    expect(calls[1]).toEqual(['add', '--', 'traces/card-c']);
  });

  it('re-reads (pull --rebase) and retries when the push is rejected', () => {
    const repo = '/fake/repo';
    const calls: string[][] = [];
    let pushes = 0;
    const runner: OpsGitRunner = (_repoRoot, args) => {
      calls.push(args);
      if (args[0] === 'push') {
        pushes += 1;
        if (pushes === 1) throw new Error('! [rejected] ops -> ops (fetch first)');
      }
      return '';
    };

    commitTraceToOps(repo, 'card-retry', runner, { maxRetryPushes: 3 });

    // Two push attempts, with a reconciling pull --rebase between them.
    const pushIdx = calls.map((c, i) => (c[0] === 'push' ? i : -1)).filter((i) => i >= 0);
    expect(pushIdx).toHaveLength(2);
    expect(calls[pushIdx[0] + 1]).toEqual(['pull', '--rebase', 'origin', 'ops']);
  });

  it('gives up after maxRetryPushes exhausted, surfacing the push error', () => {
    const runner: OpsGitRunner = (_r, args) => {
      if (args[0] === 'push') throw new Error('rejected');
      return '';
    };
    expect(() => commitTraceToOps('/r', 'card-x', runner, { maxRetryPushes: 2 })).toThrow(/rejected/);
  });
});

describe('writeTrace orchestrator (D0: render-to-local by default, commit only on request)', () => {
  it('writes the file but does NOT invoke git when commit is not requested', async () => {
    const repo = await scratch();
    const { runner, calls } = recorder();
    writeTrace({ repoRoot: repo, cardId: 'card-local', html: '<!doctype html>', runGit: runner });
    expect(calls).toHaveLength(0);
    const onDisk = await readFile(join(repo, 'traces', 'card-local', 'index.html'), 'utf8');
    expect(onDisk).toContain('<!doctype html>');
  });

  it('runs the ops pull-rebase-push commit when commit: true', async () => {
    const repo = await scratch();
    const { runner, calls } = recorder();
    writeTrace({ repoRoot: repo, cardId: 'card-committed', html: '<!doctype html>', commit: true, runGit: runner });
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]).toEqual(['pull', '--rebase', 'origin', 'ops']);
    expect(calls.some((c) => c[0] === 'push')).toBe(true);
  });
});
