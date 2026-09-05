import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_ATTEMPT_BUDGET, DEFAULT_BUDGET } from './activation.ts';
import type { ExecutionProfile } from './policy.ts';
import { canonicalStageResultHash, iterationResultOperationKey } from './execution.ts';
import {
  ExecutionAdapterError,
  createCuratedSkillResolver,
  createFileAccountingAdapter,
  createFileResultIntegrator,
  createGitWorktreeAdapter,
  createInactiveExecutionAdapters,
  type GitCommandRunner,
} from './adapters.ts';

const tempDirs: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'control-adapters-'));
  tempDirs.push(root);
  return root;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

function documentFingerprint(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function legacyNonIterationResultHash(result: Parameters<typeof canonicalStageResultHash>[0]): string {
  const payload = {
    summary: result.summary,
    artifacts: [...result.artifacts].map(({ path, digest }) => ({ path, digest })).sort((a, b) => a.path.localeCompare(b.path)),
    changed: [...result.changed].map(({ path, digest }) => ({ path, digest })).sort((a, b) => a.path.localeCompare(b.path)),
    checkpoints: [...result.checkpoints].sort(),
  };
  return createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex');
}

afterEach(() => {
  for (const path of tempDirs.splice(0)) rmSync(path, { recursive: true, force: true });
});

function fakeGit(repoRoot: string, commonDir: string): {
  runner: GitCommandRunner;
  calls: { args: readonly string[]; cwd: string }[];
  setStatus(value: Buffer): void;
} {
  const calls: { args: readonly string[]; cwd: string }[] = [];
  let status: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  return {
    calls,
    setStatus(value) { status = value; },
    runner: {
      async run(args, cwd) {
        calls.push({ args, cwd });
        if (args.includes('worktree') && args.includes('add')) {
          // The worktree path always follows `--detach`, in both the full and the C2 --no-checkout forms.
          mkdirSync(args[args.indexOf('--detach') + 1], { recursive: true });
          return { exitCode: 0, stdout: Buffer.alloc(0), stderr: '' };
        }
        if (args.includes('worktree') && args.includes('remove')) {
          return { exitCode: 0, stdout: Buffer.alloc(0), stderr: '' };
        }
        // C2 sparse-checkout provisioning commands (init/set) and the deferred bare checkout.
        if (args.includes('sparse-checkout') || args.includes('checkout')) {
          return { exitCode: 0, stdout: Buffer.alloc(0), stderr: '' };
        }
        if (args.includes('--show-toplevel')) return { exitCode: 0, stdout: Buffer.from(`${resolve(cwd)}\n`), stderr: '' };
        if (args.includes('--git-common-dir')) return { exitCode: 0, stdout: Buffer.from(`${commonDir}\n`), stderr: '' };
        if (args.includes('rev-parse') && args.at(-1) === 'HEAD') return { exitCode: 0, stdout: Buffer.from(`${'a'.repeat(40)}\n`), stderr: '' };
        if (args.includes('status')) return { exitCode: 0, stdout: status, stderr: '' };
        return { exitCode: 1, stdout: Buffer.alloc(0), stderr: `unexpected git invocation from ${cwd || repoRoot}` };
      },
    },
  };
}

describe('Git worktree adapter', () => {
  it('idempotently creates only the planned attempt worktree at a pinned commit', async () => {
    const root = temporaryRoot();
    const repoRoot = join(root, 'repo');
    const commonDir = join(repoRoot, '.git');
    const worktreeRoot = join(root, 'worktrees');
    mkdirSync(commonDir, { recursive: true });
    const fake = fakeGit(repoRoot, commonDir);
    const adapter = createGitWorktreeAdapter({
      repoRoot,
      worktreeRoot,
      baseCommit: 'a'.repeat(40),
      runner: fake.runner,
    });
    const path = join(worktreeRoot, 'run-1', 'attempt-1');

    await adapter.ensure({ operationKey: 'worktree:attempt-1', runRef: 'run-1', path });
    await adapter.ensure({ operationKey: 'worktree:attempt-1', runRef: 'run-1', path });

    const additions = fake.calls.filter((call) => call.args.includes('worktree') && call.args.includes('add'));
    expect(additions).toHaveLength(1);
    expect(additions[0].args).toContain('protocol.allow=never');
    expect(additions[0].args.slice(-2)).toEqual([path, 'a'.repeat(40)]);
    expect(fake.calls.some((call) => call.args.includes('remove') || call.args.includes('prune'))).toBe(false);
  });

  it(
    'chmods the run dir and attempt worktree to 02770 so the kb-shell-group broker can open them (Linux)',
    async () => {
      // Regression: run-d7232476 — the broker (uid kb-shell, group-only access) got
      // "pinned component open refused" because `mkdirSync(dirname(path), { mode: 0o700 })` and
      // `git worktree add`'s umask-derived mode never gave the shell group access. Both the run-<ref>
      // parent and the attempt directory must land on exactly 02770 for the broker's launch validator
      // (fdPinnedPaths.ts) to accept them.
      const root = temporaryRoot();
      const repoRoot = join(root, 'repo');
      const commonDir = join(repoRoot, '.git');
      const worktreeRoot = join(root, 'worktrees');
      mkdirSync(commonDir, { recursive: true });
      const fake = fakeGit(repoRoot, commonDir);
      const adapter = createGitWorktreeAdapter({ repoRoot, worktreeRoot, baseCommit: 'a'.repeat(40), runner: fake.runner });
      const path = join(worktreeRoot, 'run-1', 'attempt-1');

      await adapter.ensure({ operationKey: 'worktree:attempt-1', runRef: 'run-1', path });

      // Windows has no POSIX mode bits: the call must succeed there, the mode assertions are Linux-only
      // (the manifest gate forbids skipIf in this file, so the branch lives inside the test).
      if (process.platform === 'win32') return;
      const runDirMode = statSync(join(worktreeRoot, 'run-1')).mode & 0o7777;
      const attemptDirMode = statSync(path).mode & 0o7777;
      expect(runDirMode).toBe(0o2770);
      expect(attemptDirMode).toBe(0o2770);

      // Re-`ensure` on the already-existing worktree (the existsSync early-return branch) must also
      // normalise the mode, not just leave whatever `git worktree add` left behind.
      await adapter.ensure({ operationKey: 'worktree:attempt-1', runRef: 'run-1', path });
      expect(statSync(path).mode & 0o7777).toBe(0o2770);
    },
  );

  it(
    'refuses to chmod through a symlinked run dir and never touches the symlink target (Linux)',
    async () => {
      // Regression: chmodSync(path) follows symlinks. The run-<ref> tree is group-writable by the
      // kb-shell-sandboxed broker child, so if that child plants a symlink where a run/attempt
      // directory is expected, a path-based chmod would silently re-mode whatever the symlink
      // points at. The fd-based (O_NOFOLLOW) rewrite must refuse instead, and must never mutate
      // the symlink's target.
      if (process.platform === 'win32') return;
      const root = temporaryRoot();
      const repoRoot = join(root, 'repo');
      const commonDir = join(repoRoot, '.git');
      const worktreeRoot = join(root, 'worktrees');
      mkdirSync(commonDir, { recursive: true });
      const fake = fakeGit(repoRoot, commonDir);
      const adapter = createGitWorktreeAdapter({ repoRoot, worktreeRoot, baseCommit: 'a'.repeat(40), runner: fake.runner });

      // A sibling directory outside the worktree tree, with a known mode that must survive untouched.
      const sibling = join(root, 'sibling-target');
      mkdirSync(sibling, { recursive: true, mode: 0o755 });
      chmodSync(sibling, 0o755); // pin exactly, independent of the process umask
      mkdirSync(worktreeRoot, { recursive: true });
      // `run-1` (the parent component `ensure` must chmod) is a symlink to the sibling, not a real dir.
      symlinkSync(sibling, join(worktreeRoot, 'run-1'));
      const path = join(worktreeRoot, 'run-1', 'attempt-1');

      await expect(
        adapter.ensure({ operationKey: 'worktree:attempt-1', runRef: 'run-1', path }),
      ).rejects.toThrow('worktree component is not a directory');

      expect(statSync(sibling).mode & 0o7777).toBe(0o755);
    },
  );

  it('creates the attempt worktree with core.longpaths=true so deep state-root paths clear Windows MAX_PATH', async () => {
    // Regression: the Wave-A acceptance run parked at waiting-human because `git worktree add` failed
    // (128) "Filename too long" — the server-owned worktree lives at a deep state-root path
    // (…/control/worktrees/run-…/attempt-…, ~164 chars) and a repo fixture at ~98 chars pushed the
    // absolute path to 263 > Windows MAX_PATH (260). core.longpaths=true on the invocation is the fix;
    // it must ride on the worktree-creation git call, not just be documented.
    const root = temporaryRoot();
    const repoRoot = join(root, 'repo');
    const commonDir = join(repoRoot, '.git');
    const worktreeRoot = join(root, 'worktrees');
    mkdirSync(commonDir, { recursive: true });
    const fake = fakeGit(repoRoot, commonDir);
    const adapter = createGitWorktreeAdapter({ repoRoot, worktreeRoot, baseCommit: 'a'.repeat(40), runner: fake.runner });
    const path = join(worktreeRoot, 'run-1', 'attempt-1');

    await adapter.ensure({ operationKey: 'worktree:attempt-1', runRef: 'run-1', path });

    const addition = fake.calls.find((call) => call.args.includes('worktree') && call.args.includes('add'));
    expect(addition).toBeDefined();
    // `-c core.longpaths=true` must appear as an adjacent -c/value pair on the worktree-add invocation.
    const args = addition!.args;
    expect(args).toContain('core.longpaths=true');
    expect(args[args.indexOf('core.longpaths=true') - 1]).toBe('-c');
  });

  it('C2: with sparseReadScope OFF, provisioning is byte-identical to full checkout even if sparsePaths is passed', async () => {
    const root = temporaryRoot();
    const repoRoot = join(root, 'repo');
    const commonDir = join(repoRoot, '.git');
    const worktreeRoot = join(root, 'worktrees');
    mkdirSync(commonDir, { recursive: true });
    const fake = fakeGit(repoRoot, commonDir);
    const adapter = createGitWorktreeAdapter({ repoRoot, worktreeRoot, baseCommit: 'a'.repeat(40), runner: fake.runner });
    const path = join(worktreeRoot, 'run-1', 'attempt-1');

    // sparsePaths is present but the flag is off — it must be ignored entirely.
    await adapter.ensure({ operationKey: 'worktree:attempt-1', runRef: 'run-1', path, sparsePaths: ['queue', 'orgs/kb-ops/output'] });

    const additions = fake.calls.filter((call) => call.args.includes('worktree') && call.args.includes('add'));
    expect(additions).toHaveLength(1);
    // The exact pre-change add form: no --no-checkout.
    expect(additions[0].args.slice(-3)).toEqual(['--detach', path, 'a'.repeat(40)]);
    expect(additions[0].args).not.toContain('--no-checkout');
    // No sparse-checkout machinery was issued at all.
    expect(fake.calls.some((call) => call.args.includes('sparse-checkout'))).toBe(false);
  });

  it('C2: with sparseReadScope ON, materializes exactly readScope ∪ writeScope via sparse-checkout set', async () => {
    const root = temporaryRoot();
    const repoRoot = join(root, 'repo');
    const commonDir = join(repoRoot, '.git');
    const worktreeRoot = join(root, 'worktrees');
    mkdirSync(commonDir, { recursive: true });
    const fake = fakeGit(repoRoot, commonDir);
    const adapter = createGitWorktreeAdapter({ repoRoot, worktreeRoot, baseCommit: 'a'.repeat(40), runner: fake.runner, sparseReadScope: true });
    const path = join(worktreeRoot, 'run-1', 'attempt-1');
    const sparsePaths = ['queue', 'dashboards', 'orgs/kb-ops', 'orgs/kb-ops/output'];

    await adapter.ensure({ operationKey: 'worktree:attempt-1', runRef: 'run-1', path, sparsePaths });

    const addition = fake.calls.find((call) => call.args.includes('worktree') && call.args.includes('add'))!;
    // The worktree is created WITHOUT a checkout, then the sparse set is written and checked out.
    expect(addition.args).toContain('--no-checkout');
    expect(addition.args.slice(-3)).toEqual(['--detach', path, 'a'.repeat(40)]);
    const init = fake.calls.find((call) => call.args.includes('sparse-checkout') && call.args.includes('init'))!;
    expect(init.args.slice(-2)).toEqual(['init', '--no-cone']);
    expect(init.cwd).toBe(path);
    const set = fake.calls.find((call) => call.args.includes('sparse-checkout') && call.args.includes('set'))!;
    // The set list is EXACTLY effectiveRead ∪ writeScope, in order, deduped, and ROOT-ANCHORED (leading
    // '/'). Anchoring is load-bearing: unanchored no-cone patterns match a name at any depth (a `_index.md`
    // or `dashboards` would leak other orgs / nested fixtures — live-verified 2026-07-22).
    expect(set.args.slice(set.args.indexOf('set'))).toEqual(['set', '/queue', '/dashboards', '/orgs/kb-ops', '/orgs/kb-ops/output']);
    expect(set.cwd).toBe(path);
    // Every emitted pattern is root-anchored.
    for (const pattern of set.args.slice(set.args.indexOf('set') + 1)) expect(pattern.startsWith('/')).toBe(true);
    // A path outside the sparse set (e.g. dashboard/server) is never named to git → never materialized.
    expect(set.args).not.toContain('dashboard/server');
    expect(set.args).not.toContain('/dashboard/server');
    // The deferred bare checkout populates the sparse working tree.
    expect(fake.calls.some((call) => call.args.at(-1) === 'checkout' && call.cwd === path)).toBe(true);
  });

  it('C2: sparse provisioning still lets inspect detect an in-write-scope change', async () => {
    const root = temporaryRoot();
    const repoRoot = join(root, 'repo');
    const commonDir = join(repoRoot, '.git');
    const worktreeRoot = join(root, 'worktrees');
    const path = join(worktreeRoot, 'run-1', 'attempt-1');
    mkdirSync(commonDir, { recursive: true });
    const fake = fakeGit(repoRoot, commonDir);
    const adapter = createGitWorktreeAdapter({ repoRoot, worktreeRoot, baseCommit: 'c'.repeat(40), runner: fake.runner, sparseReadScope: true });

    // Provision first (the fake creates the worktree dir), THEN place an in-write-scope change.
    await adapter.ensure({ operationKey: 'worktree:attempt-1', runRef: 'run-1', path, sparsePaths: ['orgs/kb-ops', 'orgs/kb-ops/output'] });
    mkdirSync(join(path, 'orgs', 'kb-ops', 'output'), { recursive: true });
    writeFileSync(join(path, 'orgs', 'kb-ops', 'output', 'report.md'), 'findings');
    fake.setStatus(Buffer.from('?? orgs/kb-ops/output/report.md\0'));
    const inspected = await adapter.inspect({ operationKey: 'inspect:attempt-1', runRef: 'run-1', path });
    expect(inspected.changed).toEqual([
      { path: 'orgs/kb-ops/output/report.md', digest: createHash('sha256').update('findings').digest('hex') },
    ]);
  });

  it('C2: rejects an unsafe sparse read-scope path before checkout', async () => {
    const root = temporaryRoot();
    const repoRoot = join(root, 'repo');
    const worktreeRoot = join(root, 'worktrees');
    mkdirSync(join(repoRoot, '.git'), { recursive: true });
    const fake = fakeGit(repoRoot, join(repoRoot, '.git'));
    const adapter = createGitWorktreeAdapter({ repoRoot, worktreeRoot, baseCommit: 'a'.repeat(40), runner: fake.runner, sparseReadScope: true });
    const path = join(worktreeRoot, 'run-1', 'attempt-1');
    await expect(adapter.ensure({ operationKey: 'worktree:attempt-1', runRef: 'run-1', path, sparsePaths: ['../../etc'] }))
      .rejects.toThrow('sparse read-scope path');
  });

  it('C2 wiring: when the engine passes no sparsePaths, the construction resolveSparsePaths callback supplies them (keyed on runRef)', async () => {
    const root = temporaryRoot();
    const repoRoot = join(root, 'repo');
    const commonDir = join(repoRoot, '.git');
    const worktreeRoot = join(root, 'worktrees');
    mkdirSync(commonDir, { recursive: true });
    const fake = fakeGit(repoRoot, commonDir);
    const seen: string[] = [];
    const adapter = createGitWorktreeAdapter({
      repoRoot,
      worktreeRoot,
      baseCommit: 'a'.repeat(40),
      runner: fake.runner,
      sparseReadScope: true,
      // The live engine call site (execution.ts) passes NO sparsePaths — this callback is the only source.
      resolveSparsePaths: (input) => { seen.push(input.runRef); return input.runRef === 'run-1' ? ['queue', 'orgs/kb-ops'] : undefined; },
    });
    const path = join(worktreeRoot, 'run-1', 'attempt-1');

    await adapter.ensure({ operationKey: 'worktree:attempt-1', runRef: 'run-1', path });

    expect(seen).toEqual(['run-1']);
    const set = fake.calls.find((call) => call.args.includes('sparse-checkout') && call.args.includes('set'))!;
    expect(set.args.slice(set.args.indexOf('set'))).toEqual(['set', '/queue', '/orgs/kb-ops']);
  });

  it('C2 wiring: resolveSparsePaths is NOT consulted when sparseReadScope is off (byte-identical full checkout)', async () => {
    const root = temporaryRoot();
    const repoRoot = join(root, 'repo');
    const commonDir = join(repoRoot, '.git');
    const worktreeRoot = join(root, 'worktrees');
    mkdirSync(commonDir, { recursive: true });
    const fake = fakeGit(repoRoot, commonDir);
    let consulted = false;
    const adapter = createGitWorktreeAdapter({
      repoRoot,
      worktreeRoot,
      baseCommit: 'a'.repeat(40),
      runner: fake.runner,
      // Flag OFF (default). The callback must never be consulted and no sparse machinery may run.
      resolveSparsePaths: () => { consulted = true; return ['queue']; },
    });
    const path = join(worktreeRoot, 'run-1', 'attempt-1');

    await adapter.ensure({ operationKey: 'worktree:attempt-1', runRef: 'run-1', path });

    expect(consulted).toBe(false);
    const additions = fake.calls.filter((call) => call.args.includes('worktree') && call.args.includes('add'));
    expect(additions[0].args.slice(-3)).toEqual(['--detach', path, 'a'.repeat(40)]);
    expect(fake.calls.some((call) => call.args.includes('sparse-checkout'))).toBe(false);
  });

  it('rejects unplanned paths and mutable refs before invoking Git', () => {
    const root = temporaryRoot();
    const repoRoot = join(root, 'repo');
    mkdirSync(repoRoot, { recursive: true });
    const fake = fakeGit(repoRoot, join(repoRoot, '.git'));
    expect(() => createGitWorktreeAdapter({ repoRoot, worktreeRoot: join(root, 'trees'), baseCommit: 'HEAD', runner: fake.runner }))
      .toThrow('baseCommit must be a full immutable object id');

    const adapter = createGitWorktreeAdapter({
      repoRoot,
      worktreeRoot: join(root, 'trees'),
      baseCommit: 'b'.repeat(40),
      runner: fake.runner,
    });
    expect(adapter.ensure({ operationKey: 'worktree:x', runRef: 'run-1', path: join(root, 'escape') }))
      .rejects.toThrow('escapes the server-owned root');
  });

  it('hashes regular changed files server-side and rejects deletion-shaped results', async () => {
    const root = temporaryRoot();
    const repoRoot = join(root, 'repo');
    const commonDir = join(repoRoot, '.git');
    const worktreeRoot = join(root, 'worktrees');
    const path = join(worktreeRoot, 'run-1', 'attempt-1');
    mkdirSync(commonDir, { recursive: true });
    mkdirSync(join(path, 'dashboard', 'server'), { recursive: true });
    writeFileSync(join(path, 'dashboard', 'server', 'a.txt'), 'alpha');
    writeFileSync(join(path, 'dashboard', 'server', 'b.txt'), 'beta');
    const fake = fakeGit(repoRoot, commonDir);
    fake.setStatus(Buffer.from(' M dashboard/server/a.txt\0?? dashboard/server/b.txt\0'));
    const adapter = createGitWorktreeAdapter({
      repoRoot,
      worktreeRoot,
      baseCommit: 'c'.repeat(40),
      runner: fake.runner,
    });

    const inspected = await adapter.inspect({ operationKey: 'inspect:attempt-1', runRef: 'run-1', path });
    expect(inspected.changed).toEqual([
      { path: 'dashboard/server/a.txt', digest: createHash('sha256').update('alpha').digest('hex') },
      { path: 'dashboard/server/b.txt', digest: createHash('sha256').update('beta').digest('hex') },
    ]);

    fake.setStatus(Buffer.from(' D dashboard/server/a.txt\0'));
    await expect(adapter.inspect({ operationKey: 'inspect:attempt-1', runRef: 'run-1', path }))
      .rejects.toThrow("unsupported changed-file status ' D'");
  });

  it('rejects porcelain add/add conflicts without weakening ordinary M/A states', async () => {
    const root = temporaryRoot();
    const repoRoot = join(root, 'repo');
    const commonDir = join(repoRoot, '.git');
    const worktreeRoot = join(root, 'worktrees');
    const path = join(worktreeRoot, 'run-1', 'attempt-1');
    mkdirSync(commonDir, { recursive: true });
    mkdirSync(join(path, 'dashboard', 'server'), { recursive: true });
    const files = ['unstaged.md', 'staged.md', 'both.md', 'added.md', 'added-modified.md'];
    for (const file of files) writeFileSync(join(path, 'dashboard', 'server', file), file);
    const fake = fakeGit(repoRoot, commonDir);
    const adapter = createGitWorktreeAdapter({
      repoRoot,
      worktreeRoot,
      baseCommit: 'c'.repeat(40),
      runner: fake.runner,
    });

    fake.setStatus(Buffer.from([
      ' M dashboard/server/unstaged.md',
      'M  dashboard/server/staged.md',
      'MM dashboard/server/both.md',
      'A  dashboard/server/added.md',
      'AM dashboard/server/added-modified.md',
      '',
    ].join('\0')));
    const inspected = await adapter.inspect({ operationKey: 'inspect:ordinary', runRef: 'run-1', path });
    expect(inspected.changed.map((item) => item.path)).toEqual(files.map((file) => `dashboard/server/${file}`).sort());

    fake.setStatus(Buffer.from('AA dashboard/server/added.md\0'));
    await expect(adapter.inspect({ operationKey: 'inspect:add-add', runRef: 'run-1', path }))
      .rejects.toThrow("unsupported changed-file status 'AA'");
  });

  it('removes only the planned worktree through the hardened runner and rejects out-of-root paths', async () => {
    const root = temporaryRoot();
    const repoRoot = join(root, 'repo');
    const commonDir = join(repoRoot, '.git');
    const worktreeRoot = join(root, 'worktrees');
    mkdirSync(commonDir, { recursive: true });
    const fake = fakeGit(repoRoot, commonDir);
    const adapter = createGitWorktreeAdapter({ repoRoot, worktreeRoot, baseCommit: 'a'.repeat(40), runner: fake.runner });
    const path = join(worktreeRoot, 'run-1', 'attempt-1');

    await adapter.remove({ operationKey: 'worktree-remove:attempt-1', runRef: 'run-1', path });
    await adapter.remove({ operationKey: 'worktree-remove:attempt-1', runRef: 'run-1', path });

    const removals = fake.calls.filter((call) => call.args.includes('worktree') && call.args.includes('remove'));
    expect(removals).toHaveLength(2);
    expect(removals[0].cwd).toBe(repoRoot);
    expect(removals[0].args).toContain('protocol.allow=never');
    expect(removals[0].args).toContain('--literal-pathspecs');
    expect(removals[0].args.slice(-4)).toEqual(['worktree', 'remove', '--force', path]);
    expect(fake.calls.some((call) => call.args.includes('prune'))).toBe(false);

    await expect(adapter.remove({ operationKey: 'worktree-remove:x', runRef: 'run-1', path: join(root, 'escape') }))
      .rejects.toThrow('escapes the server-owned root');
  });

  it('treats a missing worktree as already removed but rethrows unexpected removal failures', async () => {
    const root = temporaryRoot();
    const repoRoot = join(root, 'repo');
    const worktreeRoot = join(root, 'worktrees');
    mkdirSync(join(repoRoot, '.git'), { recursive: true });
    let removeStderr = "fatal: '<path>' is not a working tree";
    const runner: GitCommandRunner = {
      async run(args) {
        if (args.includes('worktree') && args.includes('remove')) {
          return { exitCode: 1, stdout: Buffer.alloc(0), stderr: removeStderr };
        }
        return { exitCode: 1, stdout: Buffer.alloc(0), stderr: 'unexpected git invocation' };
      },
    };
    const adapter = createGitWorktreeAdapter({ repoRoot, worktreeRoot, baseCommit: 'a'.repeat(40), runner });
    const path = join(worktreeRoot, 'run-1', 'attempt-1');

    await expect(adapter.remove({ operationKey: 'worktree-remove:attempt-1', runRef: 'run-1', path })).resolves.toBeUndefined();

    removeStderr = 'fatal: unable to access repository';
    await expect(adapter.remove({ operationKey: 'worktree-remove:attempt-1', runRef: 'run-1', path }))
      .rejects.toThrow('worktree removal failed');
  });
});

const globalBudget = { maxAttempts: 3, maxInputTokens: 100, maxOutputTokens: 100, maxCostUsdMicros: 1_000 };

describe('file accounting adapter', () => {
  it('persists exact reservation and settlement replay across adapter restarts', async () => {
    const stateRoot = temporaryRoot();
    let ids = 0;
    const create = () => createFileAccountingAdapter({
      stateRoot,
      windowId: '2026-07-18',
      maxConcurrency: 1,
      globalBudget,
      newId: () => `id-${++ids}`,
      now: () => new Date('2026-07-18T12:00:00.000Z'),
    });
    const input = {
      operationKey: 'reserve:attempt-1', subject: 'operator', runRef: 'run-1', attemptRef: 'attempt-1',
      limits: { maxAttempts: 1, maxInputTokens: 60, maxOutputTokens: 40, maxCostUsdMicros: 600 },
    };
    const first = await create().reserve(input);
    // A reservation reference carries the window it was minted in, ahead of the generated id: that is
    // how a settlement after UTC midnight still finds its record in the window it was RESERVED in.
    expect(first).toEqual({ ok: true, value: { reservationRef: 'reservation-2026-07-18:id-1', replayed: false } });
    const replay = await create().reserve(input);
    expect(replay).toEqual({ ok: true, value: { reservationRef: 'reservation-2026-07-18:id-1', replayed: true } });
    if (!first.ok) throw new Error(first.reason);
    await create().settle({
      operationKey: 'settle:attempt-1', reservationRef: first.value.reservationRef,
      usage: { inputTokens: 20, outputTokens: 10, costUsdMicros: 200 },
    });
    await create().settle({
      operationKey: 'settle:attempt-1', reservationRef: first.value.reservationRef,
      usage: { inputTokens: 20, outputTokens: 10, costUsdMicros: 200 },
    });
    await expect(create().settle({
      operationKey: 'settle:attempt-1', reservationRef: first.value.reservationRef,
      usage: { inputTokens: 21, outputTokens: 10, costUsdMicros: 200 },
    })).rejects.toThrow('settlement replay differs');
  });

  it('atomically refuses concurrency and projected global budget overflow', async () => {
    const stateRoot = temporaryRoot();
    let ids = 0;
    const adapter = createFileAccountingAdapter({
      stateRoot,
      windowId: 'window-1',
      maxConcurrency: 1,
      globalBudget,
      newId: () => `id-${++ids}`,
    });
    const reserve = (operationKey: string, attemptRef: string, tokens: number) => adapter.reserve({
      operationKey, subject: 'operator', runRef: 'run-1', attemptRef,
      limits: { maxAttempts: 1, maxInputTokens: tokens, maxOutputTokens: tokens, maxCostUsdMicros: tokens * 10 },
    });
    const first = await reserve('reserve:1', 'attempt-1', 60);
    expect(first.ok).toBe(true);
    expect(await reserve('reserve:2', 'attempt-2', 10)).toEqual({ ok: false, reason: 'global concurrency limit reached' });
    if (!first.ok) throw new Error(first.reason);
    await adapter.settle({
      operationKey: 'settle:1', reservationRef: first.value.reservationRef,
      usage: { inputTokens: 50, outputTokens: 50, costUsdMicros: 500 },
    });
    expect(await reserve('reserve:3', 'attempt-3', 60)).toEqual({ ok: false, reason: 'global token or cost budget exhausted' });
  });

  it('admits a multi-stage chain under the production window/attempt budget split, and still closes at the ceiling', async () => {
    const stateRoot = temporaryRoot();
    let ids = 0;
    const adapter = createFileAccountingAdapter({
      stateRoot,
      windowId: 'window-chain',
      maxConcurrency: 1,
      globalBudget: DEFAULT_BUDGET,
      newId: () => `id-${++ids}`,
    });
    const reserveAttempt = (attempt: number) => adapter.reserve({
      operationKey: `reserve:attempt-${attempt}`, subject: 'operator', runRef: 'run-1',
      attemptRef: `attempt-${attempt}`, limits: DEFAULT_ATTEMPT_BUDGET,
    });
    const settleAttempt = async (attempt: number, reservationRef: string, inputTokens: number) => {
      await adapter.settle({
        operationKey: `settle:attempt-${attempt}`, reservationRef,
        usage: { inputTokens, outputTokens: 1_024, costUsdMicros: 250_000 },
      });
    };
    // Measured acceptance baseline: the draft stage settles at ~180k input tokens / ~$0.25.
    const draft = await reserveAttempt(1);
    expect(draft).toEqual({ ok: true, value: { reservationRef: 'reservation-window-chain:id-1', replayed: false } });
    if (!draft.ok) throw new Error(draft.reason);
    await settleAttempt(1, draft.value.reservationRef, 180_177);

    // The regression: a second stage in the same window must still be admissible after that settlement.
    const revise = await reserveAttempt(2);
    expect(revise).toEqual({ ok: true, value: { reservationRef: 'reservation-window-chain:id-2', replayed: false } });
    if (!revise.ok) throw new Error(revise.reason);
    await settleAttempt(2, revise.value.reservationRef, 180_177);

    // And a third (a three-stage chain), plus a fourth (one retry) — the sizing claim in activation.ts.
    const finalStage = await reserveAttempt(3);
    expect(finalStage.ok).toBe(true);
    if (!finalStage.ok) throw new Error(finalStage.reason);
    await settleAttempt(3, finalStage.value.reservationRef, 180_177);
    const retry = await reserveAttempt(4);
    expect(retry.ok).toBe(true);
    if (!retry.ok) throw new Error(retry.reason);

    // The window ceiling is NOT loosened. Settle every remaining attempt at the FULL per-attempt input
    // limit and the window still closes, on tokens rather than on the attempt count: 540,531 (three
    // measured stages) + 1,500,000 x 3 settled + 1,500,000 held = 6,540,531 > 6,000,000.
    for (const attempt of [4, 5, 6]) {
      const reservation = attempt === 4 ? retry : await reserveAttempt(attempt);
      expect(reservation.ok).toBe(true);
      if (!reservation.ok) throw new Error(reservation.reason);
      await adapter.settle({
        operationKey: `settle:attempt-${attempt}`, reservationRef: reservation.value.reservationRef,
        usage: { inputTokens: DEFAULT_ATTEMPT_BUDGET.maxInputTokens, outputTokens: 1_024, costUsdMicros: 250_000 },
      });
    }
    expect(await reserveAttempt(7)).toEqual({ ok: false, reason: 'global token or cost budget exhausted' });
  });

  /**
   * W67 wall 1, the live Gate 4b refusal. Two workers run concurrently (`maxConcurrency: 2`) and a
   * prior stage has already settled. With the pre-W67 1,000,000-input attempt budget the second of the
   * two concurrent reservations was refused - 180,177 settled + 1,000,000 + 1,000,000 > 2,000,000 - and
   * the stage stalled. Under the shipped budgets both are admitted with room to spare.
   */
  it('admits two concurrent reservations on top of a settled row', async () => {
    const stateRoot = temporaryRoot();
    let ids = 0;
    const adapter = createFileAccountingAdapter({
      stateRoot,
      windowId: 'window-concurrent-pair',
      maxConcurrency: 2,
      globalBudget: DEFAULT_BUDGET,
      newId: () => `id-${++ids}`,
    });
    const reserveAttempt = (attempt: number) => adapter.reserve({
      operationKey: `reserve:attempt-${attempt}`, subject: 'operator', runRef: 'run-1',
      attemptRef: `attempt-${attempt}`, limits: DEFAULT_ATTEMPT_BUDGET,
    });
    const settled = await reserveAttempt(1);
    expect(settled.ok).toBe(true);
    if (!settled.ok) throw new Error(settled.reason);
    await adapter.settle({
      operationKey: 'settle:attempt-1', reservationRef: settled.value.reservationRef,
      usage: { inputTokens: 180_177, outputTokens: 1_024, costUsdMicros: 250_000 },
    });
    const left = await reserveAttempt(2);
    const right = await reserveAttempt(3);
    expect(left.ok).toBe(true);
    expect(right.ok).toBe(true);
    // The third concurrent one is still refused - the concurrency slot cap is untouched.
    expect(await reserveAttempt(4)).toEqual({ ok: false, reason: 'global concurrency limit reached' });
  });

  /**
   * W67 wall 1, second half. The window id used to be computed ONCE at activation, so a daemon started
   * on the 3rd was still writing the 3rd's file at 00:11 on the 4th (observed on the VM in
   * control/execution-accounting/2026-09-03.json). With a resolver the file follows the clock, and a
   * reservation made before midnight still SETTLES into its own window's file.
   */
  it('rolls the accounting window at UTC midnight and settles into the reserving window', async () => {
    const stateRoot = temporaryRoot();
    let ids = 0;
    let clock = new Date('2026-09-03T23:59:12.000Z');
    const adapter = createFileAccountingAdapter({
      stateRoot,
      windowId: (at: Date) => at.toISOString().slice(0, 10),
      maxConcurrency: 2,
      globalBudget: DEFAULT_BUDGET,
      newId: () => `id-${++ids}`,
      now: () => clock,
    });
    const reserveAttempt = (attempt: number) => adapter.reserve({
      operationKey: `reserve:attempt-${attempt}`, subject: 'operator', runRef: 'run-1',
      attemptRef: `attempt-${attempt}`, limits: DEFAULT_ATTEMPT_BUDGET,
    });
    const before = await reserveAttempt(1);
    expect(before).toEqual({ ok: true, value: { reservationRef: 'reservation-2026-09-03:id-1', replayed: false } });
    if (!before.ok) throw new Error(before.reason);

    clock = new Date('2026-09-04T00:11:58.000Z');
    const after = await reserveAttempt(2);
    expect(after).toEqual({ ok: true, value: { reservationRef: 'reservation-2026-09-04:id-2', replayed: false } });
    // Settled AFTER midnight, but written into the window it was reserved in.
    await adapter.settle({
      operationKey: 'settle:attempt-1', reservationRef: before.value.reservationRef,
      usage: { inputTokens: 180_177, outputTokens: 1_024, costUsdMicros: 250_000 },
    });

    // A reserve RETRIED across the boundary replays its own reservation instead of opening a second
    // one in the new window - the idempotency guarantee is not allowed to lapse at midnight.
    expect(await reserveAttempt(1)).toEqual({ ok: true, value: { reservationRef: 'reservation-2026-09-03:id-1', replayed: true } });

    const read = (windowId: string) => JSON.parse(
      readFileSync(join(stateRoot, 'control', 'execution-accounting', `${windowId}.json`), 'utf8'),
    ) as { windowId: string; reservations: { attemptRef: string; state: string }[] };
    const third = read('2026-09-03');
    const fourth = read('2026-09-04');
    expect(third.windowId).toBe('2026-09-03');
    expect(third.reservations.map((item) => [item.attemptRef, item.state])).toEqual([['attempt-1', 'settled']]);
    expect(fourth.windowId).toBe('2026-09-04');
    expect(fourth.reservations.map((item) => [item.attemptRef, item.state])).toEqual([['attempt-2', 'active']]);
  });

  /**
   * Review item 3. An attempt that started at 23:50 is still running at 00:05: it holds a worker and
   * can still spend its full limit. Reading only the new window's file made it invisible at midnight -
   * its concurrency slot was handed out a second time and its held limit counted against nothing.
   */
  it('carries a prior window active hold into the new window concurrency and headroom', async () => {
    const stateRoot = temporaryRoot();
    let ids = 0;
    let clock = new Date('2026-09-03T23:50:00.000Z');
    const adapter = createFileAccountingAdapter({
      stateRoot,
      windowId: (at: Date) => at.toISOString().slice(0, 10),
      maxConcurrency: 2,
      globalBudget: DEFAULT_BUDGET,
      newId: () => `id-${++ids}`,
      now: () => clock,
    });
    const reserveAttempt = (attempt: number) => adapter.reserve({
      operationKey: `reserve:attempt-${attempt}`, subject: 'operator', runRef: 'run-1',
      attemptRef: `attempt-${attempt}`, limits: DEFAULT_ATTEMPT_BUDGET,
    });
    const straddling = await reserveAttempt(1);
    expect(straddling.ok).toBe(true);
    if (!straddling.ok) throw new Error(straddling.reason);

    clock = new Date('2026-09-04T00:05:00.000Z');
    // One slot is still occupied by yesterday's live attempt, so only ONE more fits, not two.
    expect((await reserveAttempt(2)).ok).toBe(true);
    expect(await reserveAttempt(3)).toEqual({ ok: false, reason: 'global concurrency limit reached' });

    // The straddling reservation settles into ITS OWN window, not the current one.
    await adapter.settle({
      operationKey: 'settle:attempt-1', reservationRef: straddling.value.reservationRef,
      usage: { inputTokens: 180_177, outputTokens: 1_024, costUsdMicros: 250_000 },
    });
    const third = JSON.parse(readFileSync(join(stateRoot, 'control', 'execution-accounting', '2026-09-03.json'), 'utf8')) as
      { reservations: { attemptRef: string; state: string }[] };
    expect(third.reservations.map((item) => [item.attemptRef, item.state])).toEqual([['attempt-1', 'settled']]);
    // Settled, so no longer carried: the freed slot is available again in the new window.
    expect((await reserveAttempt(4)).ok).toBe(true);
  });

  /**
   * The held half of the same carry-over: a prior window's live hold counts against the NEW window's
   * token headroom, not only against its concurrency slots.
   */
  it('counts a prior window active hold against the new window token headroom', async () => {
    const stateRoot = temporaryRoot();
    let ids = 0;
    let clock = new Date('2026-09-03T23:50:00.000Z');
    const adapter = createFileAccountingAdapter({
      stateRoot,
      windowId: (at: Date) => at.toISOString().slice(0, 10),
      // Concurrency 3, so the refusal below can only come from the token projection.
      maxConcurrency: 3,
      globalBudget: DEFAULT_BUDGET,
      newId: () => `id-${++ids}`,
      now: () => clock,
    });
    const straddling = await adapter.reserve({
      operationKey: 'reserve:straddle', subject: 'operator', runRef: 'run-1', attemptRef: 'attempt-straddle',
      limits: DEFAULT_ATTEMPT_BUDGET,
    });
    expect(straddling.ok).toBe(true);

    clock = new Date('2026-09-04T00:05:00.000Z');
    // Exactly the window ceiling minus the carried hold still fits...
    const room = DEFAULT_BUDGET.maxInputTokens - DEFAULT_ATTEMPT_BUDGET.maxInputTokens;
    expect((await adapter.reserve({
      operationKey: 'reserve:fits', subject: 'operator', runRef: 'run-1', attemptRef: 'attempt-fits',
      limits: { ...DEFAULT_ATTEMPT_BUDGET, maxInputTokens: room },
    })).ok).toBe(true);
    // ...and one token more than the whole window would fit without the carry-over does not.
    expect(await adapter.reserve({
      operationKey: 'reserve:overruns', subject: 'operator', runRef: 'run-1', attemptRef: 'attempt-overruns',
      limits: { ...DEFAULT_ATTEMPT_BUDGET, maxInputTokens: 1 },
    })).toEqual({ ok: false, reason: 'global token or cost budget exhausted' });
  });

  /**
   * Review item 4. A corrupt or oversized file for a window that is already OVER must not park every
   * run for the whole of the new day. The read falls through and the current window is still fully
   * enforced - what is lost is only the carry-over, bounded by maxConcurrency.
   */
  it('falls through to the current window when the prior window file cannot be read', async () => {
    const stateRoot = temporaryRoot();
    let ids = 0;
    let clock = new Date('2026-09-03T23:50:00.000Z');
    const adapter = createFileAccountingAdapter({
      stateRoot,
      windowId: (at: Date) => at.toISOString().slice(0, 10),
      maxConcurrency: 2,
      globalBudget: DEFAULT_BUDGET,
      newId: () => `id-${++ids}`,
      now: () => clock,
    });
    const reserveAttempt = (attempt: number) => adapter.reserve({
      operationKey: `reserve:attempt-${attempt}`, subject: 'operator', runRef: 'run-1',
      attemptRef: `attempt-${attempt}`, limits: DEFAULT_ATTEMPT_BUDGET,
    });
    expect((await reserveAttempt(1)).ok).toBe(true);
    writeFileSync(join(stateRoot, 'control', 'execution-accounting', '2026-09-03.json'), 'not json at all', 'utf8');

    clock = new Date('2026-09-04T00:05:00.000Z');
    // Both slots are available again (the carry-over is what was lost), and the new window's own
    // accounting is untouched: a third concurrent reservation is still refused.
    expect((await reserveAttempt(2)).ok).toBe(true);
    expect((await reserveAttempt(3)).ok).toBe(true);
    expect(await reserveAttempt(4)).toEqual({ ok: false, reason: 'global concurrency limit reached' });
  });

  it('serializes concurrent reservations through the durable global CAS', async () => {
    const stateRoot = temporaryRoot();
    let ids = 0;
    const adapter = createFileAccountingAdapter({
      stateRoot,
      windowId: 'window-concurrent',
      maxConcurrency: 1,
      globalBudget,
      newId: () => `id-${++ids}`,
    });
    const outcomes = await Promise.all([1, 2].map((number) => adapter.reserve({
      operationKey: `reserve:${number}`,
      subject: 'operator',
      runRef: 'run-1',
      attemptRef: `attempt-${number}`,
      limits: { maxAttempts: 1, maxInputTokens: 10, maxOutputTokens: 10, maxCostUsdMicros: 100 },
    })));
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    expect(outcomes.filter((outcome) => !outcome.ok)).toEqual([{ ok: false, reason: 'global concurrency limit reached' }]);
  });

  it('rejects a changed server policy for an existing durable accounting window', async () => {
    const stateRoot = temporaryRoot();
    const original = createFileAccountingAdapter({ stateRoot, windowId: 'window-1', maxConcurrency: 1, globalBudget });
    await original.reserve({
      operationKey: 'reserve:1', subject: 'operator', runRef: 'run-1', attemptRef: 'attempt-1',
      limits: { maxAttempts: 1, maxInputTokens: 1, maxOutputTokens: 1, maxCostUsdMicros: 1 },
    });
    const changed = createFileAccountingAdapter({ stateRoot, windowId: 'window-1', maxConcurrency: 2, globalBudget });
    await expect(changed.reserve({
      operationKey: 'reserve:2', subject: 'operator', runRef: 'run-1', attemptRef: 'attempt-2',
      limits: { maxAttempts: 1, maxInputTokens: 1, maxOutputTokens: 1, maxCostUsdMicros: 1 },
    })).rejects.toThrow('accounting policy differs');
  });
});

function legacyReviewCanonicalInput() {
  const canonical = {
    summary: 'stage complete',
    artifacts: [{ path: 'dashboard/server/result.txt', digest: 'a'.repeat(64) }],
    changed: [{ path: 'dashboard/server/result.txt', digest: 'a'.repeat(64) }],
    checkpoints: ['verified'],
    reviewOutcome: {
      schema: 'kb.review-outcome/v1' as const,
      decision: 'pass' as const,
      summary: 'checker passed',
      criteria: [{ criterionId: 'criterion-1', verdict: 'pass' as const, findingIds: [] }],
      findings: [],
    },
  };
  const reviewContract = {
    review: {
      subjectStageId: 'subject', maxCreatorReworks: 1,
      criteria: [{ id: 'criterion-1', description: 'must pass' }],
    },
  };
  return {
    operationKey: 'result:run-1:stage-1',
    subject: 'operator',
    runRef: 'run-1',
    stageRef: 'stage-ref-1',
    stageId: 'stage-1',
    attemptRef: 'attempt-1',
    canonicalCardRef: 'card-1',
    worktreePath: 'C:\\managed-worktrees\\attempt-1',
    ...canonical,
    reviewContract,
    resultHash: canonicalStageResultHash(canonical),
  };
}

function nonReviewCanonicalInput() {
  const reviewed = legacyReviewCanonicalInput();
  const {
    reviewOutcome: _reviewOutcome,
    reviewContract: _reviewContract,
    resultHash: _resultHash,
    ...input
  } = reviewed;
  const canonical = {
    summary: input.summary,
    artifacts: input.artifacts,
    changed: input.changed,
    checkpoints: input.checkpoints,
  };
  return { ...input, resultHash: canonicalStageResultHash(canonical) };
}

function iterationCanonicalInput() {
  const legacy = legacyReviewCanonicalInput();
  const request = {
    schema: 'kb.iteration-request/v1' as const, requestRef: 'request-1', iterationLoopRef: 'loop-1',
    stepId: 'review', routeId: 'to-judge', senderParticipantId: 'producer', recipientParticipantId: 'judge',
    kind: 'review' as const, cycle: 1, inputGenerationRefs: ['generation-1'], baseCommit: 'b'.repeat(40),
    artifactHashes: { draft: 'd'.repeat(64) }, criteria: [{ id: 'criterion-1', description: 'must pass' }],
    unresolvedFindingRefs: [], preservedInvariants: [], nextAcceptanceCheck: 'Apply criterion-1.', instructions: 'Review the draft.',
  };
  const iterationContract = {
    request,
    iterationGroup: {
      iterationGroupId: 'draft-loop', participants: [
        { participantId: 'producer', stageRef: 'subject', role: 'contributor' as const, perspective: 'Create.', mandate: 'Create.' },
        { participantId: 'judge', stageRef: 'stage-1', role: 'judge' as const, perspective: 'Judge.', mandate: 'Judge.' },
      ],
      routes: [{ routeId: 'to-judge', senderParticipantId: 'producer', recipientParticipantId: 'judge', requestKinds: ['review' as const], baseResolutionStageIds: ['subject'] }],
      activation: { seedParticipantId: 'producer', seedArtifactIds: ['draft'] }, initialStepId: 'review',
      schedule: [{ stepId: 'review', routeId: 'to-judge', cycle: 'current' as const }], artifacts: ['draft'],
      criteria: request.criteria, maxCycles: 2, cycleUnit: 'One verdict.', terminalAuthorities: [{ participantId: 'judge', verdict: 'pass' as const }],
    },
  };
  const iterationOutcome = {
    schema: 'kb.iteration-outcome/v1' as const, requestRef: request.requestRef, iterationLoopRef: request.iterationLoopRef,
    participantId: 'judge', cycle: 1, verdict: 'pass' as const, inputGenerationRefs: [...request.inputGenerationRefs],
    criteria: [{ criterionId: 'criterion-1', verdict: 'pass' as const, findingIds: [] }], findings: [],
    positions: [], recordedDissent: [], summary: 'checker passed',
  };
  const { reviewOutcome: _reviewOutcome, reviewContract: _reviewContract, resultHash: _resultHash, ...base } = legacy;
  const canonical = {
    summary: base.summary, artifacts: base.artifacts, changed: base.changed, checkpoints: base.checkpoints, iterationOutcome,
  };
  return {
    ...base,
    operationKey: iterationResultOperationKey(base.runRef, base.stageId, request.requestRef),
    canonicalCardRef: null,
    iterationContract,
    iterationOutcome,
    resultHash: canonicalStageResultHash(canonical),
  };
}

function canonicalInput() {
  return iterationCanonicalInput();
}

describe('file result integrator', () => {
  it('writes and replays only iteration contract and outcome properties after cutover', async () => {
    const legacyRoot = temporaryRoot();
    const legacyIntegrator = createFileResultIntegrator({ stateRoot: legacyRoot });
    const legacy = legacyReviewCanonicalInput();
    await expect(legacyIntegrator.integrate(legacy as never)).rejects.toThrow(/current schema/i);

    const genericRoot = temporaryRoot();
    const genericIntegrator = createFileResultIntegrator({ stateRoot: genericRoot });
    const generic = iterationCanonicalInput();
    await expect(genericIntegrator.integrate(generic)).resolves.toMatchObject({ status: 'integrated' });
    const document = JSON.parse(readFileSync(join(genericRoot, 'control', 'execution-results.json'), 'utf8')) as {
      results: Array<Record<string, unknown> & { result: Record<string, unknown> }>;
    };
    expect(document.results[0]).toHaveProperty('iterationContract');
    expect(document.results[0]).not.toHaveProperty('reviewContract');
    expect(document.results[0].result).toHaveProperty('iterationOutcome');
    expect(document.results[0].result).not.toHaveProperty('reviewOutcome');
    await expect(genericIntegrator.lookup(generic)).resolves.toMatchObject({
      iterationOutcome: expect.objectContaining({ schema: 'kb.iteration-outcome/v1', verdict: 'pass' }),
    });
    await expect(genericIntegrator.integrate(generic)).resolves.toMatchObject({ status: 'replayed' });
  });


  it('refuses a mismatched hash, payload replay, and lookup identity', async () => {
    const stateRoot = temporaryRoot();
    const integrator = createFileResultIntegrator({ stateRoot });
    const input = canonicalInput();
    await expect(integrator.integrate({ ...input, resultHash: 'b'.repeat(64) })).rejects.toThrow('hash does not match');
    await integrator.integrate(input);
    await expect(integrator.integrate({ ...input, summary: 'different' })).rejects.toThrow('hash does not match');
    await expect(integrator.lookup({ ...input, stageId: 'other-stage' })).rejects.toThrow('lookup identity differs');
  });



  it('rejects a legacy hash on a current explicit-null non-review receipt', async () => {
    const stateRoot = temporaryRoot();
    const integrator = createFileResultIntegrator({ stateRoot });
    const input = nonReviewCanonicalInput();
    await integrator.integrate(input);
    const path = join(stateRoot, 'control', 'execution-results.json');
    const stored = JSON.parse(readFileSync(path, 'utf8')) as {
      results: Array<Record<string, unknown> & {
        fingerprint: string;
        result: Parameters<typeof canonicalStageResultHash>[0] & { resultHash: string };
      }>;
    };
    const record = stored.results[0];
    record.result.resultHash = legacyNonIterationResultHash(record.result);
    const { fingerprint: _fingerprint, integratedAt: _integratedAt, ...fingerprintInput } = record;
    record.fingerprint = documentFingerprint(fingerprintInput);
    writeFileSync(path, JSON.stringify(stored), 'utf8');

    await expect(createFileResultIntegrator({ stateRoot }).lookup(input))
      .rejects.toThrow('stored canonical result hash does not match its payload');
  });


});

describe('curated skill and closed adapter factories', () => {
  const workerProfile: ExecutionProfile = {
    id: 'worker:codex:safe', role: 'worker', runtime: 'codex', model: 'safe',
    capabilities: ['read', 'write-approved-scope', 'run-approved-commands', 'emit-events'],
  };

  it('resolves only exact, unique curated skill ids', async () => {
    const resolver = createCuratedSkillResolver(new Set(['tests', 'review']));
    expect(await resolver.resolve({ operationKey: 'skills:1', profile: workerProfile, requested: ['tests'] }))
      .toEqual({ ok: true, skills: ['tests'] });
    expect(await resolver.resolve({ operationKey: 'skills:2', profile: workerProfile, requested: ['unknown'] }))
      .toEqual({ ok: false, reason: 'skill is not curated: unknown' });
    expect(await resolver.resolve({ operationKey: 'skills:3', profile: workerProfile, requested: ['tests', 'tests'] }))
      .toEqual({ ok: false, reason: 'requested skills contain duplicates' });
  });

  it('builds no process-spawning Manager or Worker adapter', () => {
    const root = temporaryRoot();
    const repoRoot = join(root, 'repo');
    const commonDir = join(repoRoot, '.git');
    mkdirSync(commonDir, { recursive: true });
    const fake = fakeGit(repoRoot, commonDir);
    const adapters = createInactiveExecutionAdapters({
      repoRoot,
      worktreeRoot: join(root, 'worktrees'),
      stateRoot: join(root, 'state'),
      baseCommit: 'd'.repeat(40),
      accountingWindowId: '2026-07-18',
      maxConcurrency: 2,
      globalBudget,
      curatedSkills: new Set(['tests']),
      gitRunner: fake.runner,
    });
    expect(Object.keys(adapters).sort()).toEqual(['accounting', 'results', 'skills', 'worktrees']);
    expect('workers' in adapters).toBe(false);
    expect('managers' in adapters).toBe(false);
    expect(adapters.worktrees).toBeDefined();
  });
});

it('uses a typed fail-closed adapter error', async () => {
  await expect(createCuratedSkillResolver(new Set()).resolve({
    operationKey: '',
    profile: { id: 'worker', role: 'worker', runtime: 'codex', model: 'safe', capabilities: [] },
    requested: [],
  })).rejects.toBeInstanceOf(ExecutionAdapterError);
});
