import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ExecutionProfile } from './policy.ts';
import { canonicalStageResultHash } from './execution.ts';
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
    expect(first).toEqual({ ok: true, value: { reservationRef: 'reservation-id-1', replayed: false } });
    const replay = await create().reserve(input);
    expect(replay).toEqual({ ok: true, value: { reservationRef: 'reservation-id-1', replayed: true } });
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

function canonicalInput() {
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

describe('file result integrator', () => {
  it('commits, durably looks up, and exactly replays a canonical result', async () => {
    const stateRoot = temporaryRoot();
    const first = createFileResultIntegrator({ stateRoot, now: () => new Date('2026-07-18T12:00:00.000Z') });
    const input = canonicalInput();
    expect(await first.lookup(input)).toBeNull();
    expect(await first.integrate(input)).toEqual({ status: 'integrated', resultHash: input.resultHash, durability: 'inactive' });

    const restarted = createFileResultIntegrator({ stateRoot });
    expect(await restarted.lookup(input)).toEqual({
      resultHash: input.resultHash,
      summary: input.summary,
      artifacts: input.artifacts,
      changed: input.changed,
      checkpoints: input.checkpoints,
      reviewOutcome: input.reviewOutcome,
      durability: 'inactive',
      attemptBaseCommit: null,
      integrationCommit: null,
    });
    expect(await restarted.integrate(input)).toEqual({ status: 'replayed', resultHash: input.resultHash, durability: 'inactive' });
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

  it('rejects malformed or secret-bearing review outcomes before persisting and while replaying', async () => {
    const stateRoot = temporaryRoot();
    const integrator = createFileResultIntegrator({ stateRoot });
    const input = canonicalInput();
    await expect(integrator.integrate({
      ...input,
      reviewOutcome: { ...input.reviewOutcome, criteria: [] },
    })).rejects.toThrow('invalid review outcome');
    await expect(integrator.integrate({
      ...input,
      reviewOutcome: { ...input.reviewOutcome, summary: 'sk-abcdefghijklmnopqrstuvwxyz1234567890' },
    })).rejects.toThrow('invalid review outcome');

    await integrator.integrate(input);
    const path = join(stateRoot, 'control', 'execution-results.json');
    const stored = JSON.parse(readFileSync(path, 'utf8')) as { results: Array<{ result: { reviewOutcome: { summary: string } } }> };
    stored.results[0].result.reviewOutcome.summary = 'sk-abcdefghijklmnopqrstuvwxyz1234567890';
    writeFileSync(path, JSON.stringify(stored), 'utf8');
    await expect(createFileResultIntegrator({ stateRoot }).lookup(input)).rejects.toThrow('invalid review outcome');
  });

  it('persists a later generation separately without reusing the g1 card identity', async () => {
    const stateRoot = temporaryRoot();
    const integrator = createFileResultIntegrator({ stateRoot });
    const first = canonicalInput();
    const second = {
      ...first,
      operationKey: 'result:run-1:stage-1:g2',
      canonicalCardRef: null,
      reviewOutcome: {
        schema: 'kb.review-outcome/v1' as const,
        decision: 'fail' as const,
        summary: 'checker found a defect',
        criteria: [{ criterionId: 'criterion-1', verdict: 'fail' as const, findingIds: ['finding-1'] }],
        findings: [{
          id: 'finding-1', criterionId: 'criterion-1', severity: 'blocking' as const,
          summary: 'defect', evidencePaths: ['dashboard/server/result.txt'],
        }],
      },
    };
    second.resultHash = canonicalStageResultHash({
      summary: second.summary,
      artifacts: second.artifacts,
      changed: second.changed,
      checkpoints: second.checkpoints,
      reviewOutcome: second.reviewOutcome,
    });
    expect(await integrator.integrate(first)).toMatchObject({ status: 'integrated' });
    expect(await integrator.integrate(second)).toMatchObject({ status: 'integrated', resultHash: second.resultHash });
    expect(await integrator.lookup(second)).toMatchObject({ reviewOutcome: second.reviewOutcome });
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
