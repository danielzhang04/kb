/**
 * P4 W2 — manifest construction, derived branches, and worktree preparation (plan §3.2, §5 W2 row).
 *
 * This module is deliberately NOT publish-capable: the §3.2 capability table [P4-C21] grants it
 * `worktree add` and `checkout` and nothing else. Only `write/branch.ts#routeDurable` may commit,
 * push, or open a PR, and `write/asyncGit.ts` is the subprocess floor beneath it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildGovernedSaveManifest,
  buildLearningImplementationManifest,
  buildLearningProposalManifest,
  buildLearningRecordRetireManifest,
  buildScheduleMirrorManifest,
  buildWorkflowAmendmentManifest,
  prepareDurableWorktree,
  ServiceCapabilityError,
  SERVICE_PERMITTED_SUBCOMMANDS,
} from './durableManifestService.ts';
import { derivedDurableBranch, ContractDecodeError } from './durableManifest.ts';
import type { GitRunner } from './branch.ts';

const BASE = 'b'.repeat(40);
const MERGE = 'c'.repeat(40);

function batch(): Parameters<typeof buildLearningImplementationManifest>[0] {
  return {
    batchId: 'learn-0123456789abcdef01234567',
    baseCommit: BASE,
    implementedAt: '2026-08-20T06:00:00Z',
    targetPaths: ['agents/alpha.md'],
    recordPaths: ['docs/proposals/learnings/2026-08-20-lessons-miner-run_01HXYZ-01.md'],
  };
}

function recorder(): { runner: GitRunner; calls: string[][] } {
  const calls: string[][] = [];
  return { calls, runner: (_repoRoot, args) => { calls.push(args); return ''; } };
}

describe('manifest builders — closed operation keys and purpose-legal path sets', () => {
  it('builds the coordination proposal manifest with the purpose-scoped key and record paths only', () => {
    const manifest = buildLearningProposalManifest({
      sourceAgent: 'lessons-miner',
      sourceRun: 'run_01HXYZ',
      baseCommit: BASE,
      recordPaths: ['docs/proposals/learnings/2026-08-20-lessons-miner-run_01HXYZ-01.md'],
    });
    expect(manifest.purpose).toBe('learning-proposal');
    expect(manifest.operationKey).toBe('learning-proposal:lessons-miner:run_01HXYZ');
    expect(derivedDurableBranch(manifest)).toBeNull();
    expect(() => buildLearningProposalManifest({
      sourceAgent: 'lessons-miner', sourceRun: 'run_01HXYZ', baseCommit: BASE, recordPaths: ['agents/alpha.md'],
    })).toThrow(ContractDecodeError);
  });

  it('builds the implementation manifest from the validated targets plus the batch records, sorted and unique', () => {
    const manifest = buildLearningImplementationManifest(batch());
    expect(manifest.purpose).toBe('learning-implementation');
    expect(manifest.operationKey).toBe('learning-implementation:learn-0123456789abcdef01234567');
    expect(manifest.relpaths).toEqual([
      'agents/alpha.md', 'docs/proposals/learnings/2026-08-20-lessons-miner-run_01HXYZ-01.md',
    ]);
    expect(derivedDurableBranch(manifest)).toMatch(/^dv3-p4\/learning-implementation-[0-9a-f]{16}$/);
  });

  it('refuses an implementation manifest carrying any other docs/proposals path', () => {
    expect(() => buildLearningImplementationManifest({
      ...batch(), recordPaths: ['docs/proposals/decisions/2026-08-20-x.md'],
    })).toThrow(ContractDecodeError);
  });

  it('refuses more than thirty-two paths', () => {
    const many = Array.from({ length: 33 }, (_value, index) => `agents/a${String(index).padStart(2, '0')}.md`);
    expect(() => buildGovernedSaveManifest({ operationKey: 'save-1', baseCommit: BASE, relpaths: many }))
      .toThrow(/at most 32 paths/);
  });

  it('binds the retire manifest to a proven merge commit and to the batch record paths only', () => {
    const manifest = buildLearningRecordRetireManifest({ ...batch(), mergeCommit: MERGE, merged: true });
    expect(manifest.purpose).toBe('learning-record-retire');
    expect(manifest.operationKey).toBe(`learning-record-retire:learn-0123456789abcdef01234567:${MERGE}`);
    expect(manifest.relpaths).toEqual(batch().recordPaths);
    expect(derivedDurableBranch(manifest)).toBeNull();
    expect(() => buildLearningRecordRetireManifest({ ...batch(), mergeCommit: 'not-a-sha', merged: true }))
      .toThrow(ContractDecodeError);
    expect(() => buildLearningRecordRetireManifest({
      ...batch(), mergeCommit: MERGE, merged: false as unknown as true,
    })).toThrow(/merge/i);
  });

  it('keeps the existing caller purposes and prefixes their existing request key with the purpose', () => {
    expect(buildGovernedSaveManifest({ operationKey: 'req-7', baseCommit: BASE, relpaths: ['docs/notes.md'] }).operationKey)
      .toBe('governed-save:req-7');
    expect(buildWorkflowAmendmentManifest({ operationKey: 'req-7', baseCommit: BASE, relpaths: ['orgs/demo/workflows/w.md'] }).operationKey)
      .toBe('workflow-amendment:req-7');
    expect(buildScheduleMirrorManifest({ batchId: 'learn-0123456789abcdef01234567', baseCommit: BASE, paths: ['HEARTBEAT.md'] }).operationKey)
      .toBe('schedule-mirror:learn-0123456789abcdef01234567');
    expect(() => buildScheduleMirrorManifest({ batchId: 'learn-0123456789abcdef01234567', baseCommit: BASE, paths: ['agents/alpha.md'] }))
      .toThrow(ContractDecodeError);
  });
});

describe('prepareDurableWorktree — derived branch, no publish capability [P4-C21]', () => {
  it('derives the branch from the operation key and prepares a worktree at the manifest base commit', async () => {
    const git = recorder();
    const manifest = buildLearningImplementationManifest(batch());
    const prepared = await prepareDurableWorktree({
      repoRoot: '/repo', manifest, worktreePath: '/work/wt-1', runGit: git.runner, worktreeRoot: '/work',
    });
    expect(prepared.branch).toBe(derivedDurableBranch(manifest));
    expect(prepared.path).toBe('/work/wt-1');
    expect(git.calls).toEqual([
      ['worktree', 'add', '--no-checkout', '/work/wt-1', BASE],
      ['checkout', '-b', prepared.branch, BASE],
    ]);
    for (const call of git.calls) expect(SERVICE_PERMITTED_SUBCOMMANDS).toContain(call[0]);
  });

  it('refuses a worktree path that is relative, option-like, or outside the state root, before any git', async () => {
    const manifest = buildLearningImplementationManifest(batch());
    for (const worktreePath of ['relative/wt', '--upload-pack=evil', '/elsewhere/wt', '/work/../evil/wt']) {
      const git = recorder();
      await expect(prepareDurableWorktree({
        repoRoot: '/repo', manifest, worktreePath, runGit: git.runner, worktreeRoot: '/work',
      })).rejects.toBeInstanceOf(ServiceCapabilityError);
      expect(git.calls).toEqual([]);
    }
  });

  it('never accepts a caller-supplied head branch and refuses the coordination purposes', async () => {
    const git = recorder();
    await expect(prepareDurableWorktree({
      repoRoot: '/repo',
      manifest: buildLearningRecordRetireManifest({ ...batch(), mergeCommit: MERGE, merged: true }),
      worktreePath: '/work/wt-2',
      runGit: git.runner,
    })).rejects.toBeInstanceOf(ServiceCapabilityError);
    expect(git.calls).toEqual([]);
  });

  it('throws rather than running any subcommand outside `worktree add` and `checkout`', async () => {
    const attempted: string[][] = [];
    const guarded = await prepareDurableWorktree({
      repoRoot: '/repo',
      manifest: buildLearningImplementationManifest(batch()),
      worktreePath: '/work/wt-3',
      worktreeRoot: '/work',
      runGit: (_repoRoot, args) => { attempted.push(args); return ''; },
    });
    expect(guarded.branch).toMatch(/^dv3-p4\//);
    // The guard wraps the injected runner: a future edit that adds a commit/push call fails loudly.
    const escape = (guarded as unknown as { runGuarded: (args: string[]) => Promise<string> }).runGuarded;
    await expect(escape(['commit', '-m', 'x'])).rejects.toBeInstanceOf(ServiceCapabilityError);
    await expect(escape(['push', 'origin', 'HEAD'])).rejects.toBeInstanceOf(ServiceCapabilityError);
    await expect(escape(['worktree', 'remove', '/work/wt-3'])).rejects.toBeInstanceOf(ServiceCapabilityError);
  });
});

describe('the permitted-subcommand table across the three allowlisted files [P4-C21]', () => {
  const read = (relative: string) => readFileSync(resolve(import.meta.dirname, relative), 'utf8');
  const service = read('./durableManifestService.ts');
  const branch = read('./branch.ts');
  const asyncGit = read('./asyncGit.ts');

  it('leaves durableManifestService.ts with no commit, push, or PR capability at all', () => {
    expect(service).not.toMatch(/'commit'|"commit"|`commit`/);
    expect(service).not.toMatch(/'push'|"push"/);
    expect(service).not.toMatch(/pr create|openPr|PrOpener|createAsyncPrOpener/);
    expect(service).not.toMatch(/runTrackedProcess|spawn\(|execFile/);
  });

  it('keeps `gh` confined to asyncGit.ts, refused outside an ops transaction, and reached only through routeDurable', () => {
    expect(asyncGit).toMatch(/runTrackedProcess\('gh'/);
    expect(asyncGit).toMatch(/gh pr create invoked outside withOpsTransaction/);
    expect(branch).not.toMatch(/runTrackedProcess\('gh'/);
    expect(service).not.toMatch(/'gh'/);
    // `push` and `commit` argv literals live only in the publisher and the coordination path of branch.ts.
    expect(branch).toMatch(/\['push', 'origin'/);
  });
});
