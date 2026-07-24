import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { GitRunner } from '../write/branch.ts';
import type { PyRunner } from '../write/launch.ts';
import { workflowCardId } from '../write/workflowRun.ts';
import type { GitCommandRunner } from './adapters.ts';
import {
  CANONICAL_RESULT_CARD_SCRIPT,
  CANONICAL_RESULT_VERIFY_SCRIPT,
  createCanonicalGitResultIntegrator,
} from './canonicalResultIntegrator.ts';
import { canonicalStageResultHash, planAttemptWorktreePath, type ResultIntegrator } from './execution.ts';

const roots: string[] = [];

function root(): string {
  const value = mkdtempSync(join(tmpdir(), 'canonical-result-'));
  roots.push(value);
  return value;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(canonical(value), 'utf8').digest('hex');
}

afterEach(() => {
  for (const value of roots.splice(0)) rmSync(value, { recursive: true, force: true });
});

// Windows only permits symlink creation with Developer Mode or elevation; probe once so the
// TOCTOU regression skips (rather than falsely fails) where symlinks cannot be materialized.
const SYMLINKS_SUPPORTED = (() => {
  const probe = mkdtempSync(join(tmpdir(), 'canonical-symlink-probe-'));
  try {
    writeFileSync(join(probe, 'target'), 'x');
    symlinkSync(join(probe, 'target'), join(probe, 'link'));
    return true;
  } catch {
    return false;
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
})();

function fixture(options: {
  pushFails?: boolean; cardFails?: boolean; lineagePushFails?: boolean; coordinationIndexDirty?: boolean;
  verifyFails?: boolean; failAfterAttemptCommit?: boolean; failAfterCherryPick?: boolean; failAfterCardMutation?: boolean;
  pushFailsOnce?: boolean; changedAsSymlink?: boolean; changedAsIrregular?: boolean; nonReview?: boolean;
} = {}) {
  const workspace = root();
  const repoRoot = join(workspace, 'repo');
  const coordinationRoot = join(workspace, 'ops');
  const integrationRoot = join(workspace, 'lineages');
  const worktreeRoot = join(workspace, 'worktrees');
  const stateRoot = join(workspace, 'state');
  const runRef = 'run-1';
  const lineageBranch = `codex/managed-${createHash('sha256').update(runRef).digest('hex').slice(0, 24)}`;
  const stageId = 'stage-1';
  const attemptPath = planAttemptWorktreePath(worktreeRoot, runRef, 'attempt-1');
  for (const path of [repoRoot, coordinationRoot, integrationRoot, worktreeRoot, stateRoot, attemptPath]) mkdirSync(path, { recursive: true });
  const cardRef = workflowCardId(runRef, stageId);
  const changedPath = 'dashboard/server/result.txt';
  const content = 'bounded result\n';
  const changedAbs = join(attemptPath, ...changedPath.split('/'));
  mkdirSync(join(attemptPath, 'dashboard/server'), { recursive: true });
  if (options.changedAsSymlink) {
    // Emulate a worker swapping the approved regular file for a symlink whose dereferenced content
    // still hashes to the journaled digest — the TOCTOU the integrator must reject.
    const symlinkTarget = join(workspace, 'symlink-target.txt');
    writeFileSync(symlinkTarget, content);
    symlinkSync(symlinkTarget, changedAbs);
  } else if (options.changedAsIrregular) {
    // A non-regular file (here a directory) exercises the same regular-file guard as the symlink
    // swap without needing symlink privileges, so the guard is covered on every platform.
    mkdirSync(changedAbs, { recursive: true });
  } else {
    writeFileSync(changedAbs, content);
  }
  const digest = createHash('sha256').update(content).digest('hex');
  const reviewOutcome = {
    schema: 'kb.review-outcome/v1' as const,
    decision: 'pass' as const,
    summary: 'checker passed',
    criteria: [{ criterionId: 'criterion-1', verdict: 'pass' as const, findingIds: [] }],
    findings: [],
  };
  const canonical = {
    summary: 'stage complete',
    artifacts: [{ path: changedPath, digest }],
    changed: [{ path: changedPath, digest }],
    checkpoints: ['verified'],
    ...(options.nonReview ? {} : { reviewOutcome }),
  };
  const reviewContract = {
    review: {
      subjectStageId: 'subject', maxCreatorReworks: 1,
      criteria: [{ id: 'criterion-1', description: 'must pass' }],
    },
  };
  const input: Parameters<ResultIntegrator['integrate']>[0] = {
    operationKey: `result:${runRef}:${stageId}`,
    subject: 'operator',
    runRef,
    stageRef: 'stage-ref-1',
    stageId,
    attemptRef: 'attempt-1',
    canonicalCardRef: cardRef,
    worktreePath: attemptPath,
    ...canonical,
    ...(options.nonReview ? {} : { reviewContract }),
    resultHash: canonicalStageResultHash(canonical),
  };

  const sourceRel = `queue/working/${cardRef}.md`;
  const doneRel = `queue/done/${cardRef}.md`;
  mkdirSync(join(coordinationRoot, 'queue/working'), { recursive: true });
  mkdirSync(join(coordinationRoot, 'queue/done'), { recursive: true });
  writeFileSync(join(coordinationRoot, ...sourceRel.split('/')), [
    '---', `id: ${cardRef}`, `workflow: ${runRef}`, 'state: working', 'execution-controller: dashboard', '---', '', '# Managed stage', '',
  ].join('\n'));

  const attemptBase = 'a'.repeat(40);
  const attemptCommit = 'b'.repeat(40);
  const lineageBase = 'c'.repeat(40);
  const integrationCommit = 'd'.repeat(40);
  let attemptHead = attemptBase;
  let lineageHead = lineageBase;
  let staged = false;
  let failAttemptResolution = options.failAfterAttemptCommit ?? false;
  let failLineageResolution = options.failAfterCherryPick ?? false;
  const gitCalls: { cwd: string; args: readonly string[]; fullArgs: readonly string[] }[] = [];
  let lineagePushFails = options.lineagePushFails ?? false;
  const gitRunner: GitCommandRunner = {
    async run(fullArgs, cwd) {
      expect(fullArgs.slice(0, 3)).toEqual(['-c', 'protocol.allow=never', '-c']);
      expect(fullArgs).toContain('protocol.https.allow=always');
      expect(fullArgs).toContain('protocol.ssh.allow=always');
      // The daemon NEVER re-permits the `file` transport: the harness-only fix (permitting `file` for the
      // acceptance run's local bare mirror) lives in the throwaway repo's own config, not in this production
      // prefix. Prove on every integrator git op that file transport stays denied for the real remote.
      expect(fullArgs).not.toContain('protocol.file.allow=always');
      expect(fullArgs.some((a) => /^protocol\.file\./.test(String(a)))).toBe(false);
      expect(fullArgs).not.toContain('protocol.allow=always');
      expect(fullArgs).toContainEqual(expect.stringMatching(/^core\.hooksPath=/));
      expect(fullArgs).toContain('--literal-pathspecs');
      const args = fullArgs.slice(fullArgs.indexOf('--literal-pathspecs') + 1);
      gitCalls.push({ cwd, args: [...args], fullArgs: [...fullArgs] });
      if (args[0] === 'show-ref') return { exitCode: 1, stdout: Buffer.alloc(0), stderr: '' };
      if (args[0] === 'worktree' && args[1] === 'add') {
        mkdirSync(String(args[2] === '-b' ? args[4] : args[2]), { recursive: true });
        return { exitCode: 0, stdout: Buffer.alloc(0), stderr: '' };
      }
      if (args[0] === 'diff' && args[1] === '--cached') {
        return { exitCode: 0, stdout: Buffer.from(staged ? `${changedPath}\0` : ''), stderr: '' };
      }
      if (args[0] === 'status') {
        const stdout = cwd === attemptPath && attemptHead === attemptBase
          ? Buffer.from(`${staged ? 'A ' : '??'} ${changedPath}\0`)
          : Buffer.alloc(0);
        return { exitCode: 0, stdout, stderr: '' };
      }
      if (args[0] === 'add') {
        staged = true;
        return { exitCode: 0, stdout: Buffer.alloc(0), stderr: '' };
      }
      if (args[0] === 'commit') {
        attemptHead = attemptCommit;
        staged = false;
        return { exitCode: 0, stdout: Buffer.alloc(0), stderr: '' };
      }
      if (args[0] === 'cherry-pick') {
        lineageHead = integrationCommit;
        const lineageFile = join(cwd, ...changedPath.split('/'));
        mkdirSync(join(cwd, 'dashboard/server'), { recursive: true });
        writeFileSync(lineageFile, content);
        return { exitCode: 0, stdout: Buffer.alloc(0), stderr: '' };
      }
      if (args[0] === 'show' && args[1] === '-s') {
        return { exitCode: 0, stdout: Buffer.from(`chore(run): integrate ${stageId}\n`), stderr: '' };
      }
      if (args[0] === 'diff-tree') return { exitCode: 0, stdout: Buffer.from(`${changedPath}\0`), stderr: '' };
      if (args[0] === 'rev-parse') {
        if (args[1] === '--show-toplevel') return { exitCode: 0, stdout: Buffer.from(cwd), stderr: '' };
        if (args[1] === '--path-format=absolute') return { exitCode: 0, stdout: Buffer.from(repoRoot), stderr: '' };
        if (args[1] === '--abbrev-ref') return { exitCode: 0, stdout: Buffer.from(lineageBranch), stderr: '' };
        if (args[1] === 'HEAD^') return { exitCode: 0, stdout: Buffer.from(cwd === attemptPath ? attemptBase : lineageBase), stderr: '' };
        if (args[1]?.startsWith('refs/remotes/')) return { exitCode: 0, stdout: Buffer.from(integrationCommit), stderr: '' };
        if (cwd === attemptPath && attemptHead === attemptCommit && failAttemptResolution) {
          failAttemptResolution = false;
          return { exitCode: 1, stdout: Buffer.alloc(0), stderr: 'simulated daemon exit after attempt commit' };
        }
        if (cwd !== attemptPath && lineageHead === integrationCommit && failLineageResolution) {
          failLineageResolution = false;
          return { exitCode: 1, stdout: Buffer.alloc(0), stderr: 'simulated daemon exit after cherry-pick' };
        }
        return { exitCode: 0, stdout: Buffer.from(cwd === attemptPath ? attemptHead : lineageHead), stderr: '' };
      }
      if (args[0] === 'push' && lineagePushFails) return { exitCode: 1, stdout: Buffer.alloc(0), stderr: 'non-fast-forward' };
      return { exitCode: 0, stdout: Buffer.alloc(0), stderr: '' };
    },
  };

  let pushFails = options.pushFails ?? false;
  let remainingPushFailures = options.pushFailsOnce ? 1 : 0;
  let coordinationIndexDirty = options.coordinationIndexDirty ?? false;
  let coordinationCommitted = false;
  let coordinationPushed = false;
  let failCanonicalRecovery = options.failAfterCardMutation ?? false;
  const coordinationCalls: string[][] = [];
  const coordinationGit: GitRunner = (_cwd, fullArgs) => {
    expect(fullArgs.slice(0, 3)).toEqual(['-c', 'protocol.allow=never', '-c']);
    expect(fullArgs).toContain('protocol.https.allow=always');
    // Coordination pushes also keep the `file` transport denied on the daemon path (harness-only fix).
    expect(fullArgs).not.toContain('protocol.file.allow=always');
    expect(fullArgs.some((a) => /^protocol\.file\./.test(String(a)))).toBe(false);
    expect(fullArgs).not.toContain('protocol.allow=always');
    expect(fullArgs).toContainEqual(expect.stringMatching(/^core\.hooksPath=/));
    expect(fullArgs).toContain('--literal-pathspecs');
    const args = fullArgs.slice(fullArgs.indexOf('--literal-pathspecs') + 1);
    coordinationCalls.push([...args]);
    if (args[0] === 'rev-parse' && args[1] === '--verify') return `${'e'.repeat(40)}\n`;
    if (args[0] === 'rev-parse') return 'ops\n';
    if (args[0] === 'diff' && args[1] === '--cached') return coordinationIndexDirty ? 'queue/inbox/residue.md\0' : '';
    if (args[0] === 'diff' && args[1] === '--name-only') {
      if (failCanonicalRecovery) {
        failCanonicalRecovery = false;
        throw new Error('simulated daemon exit after canonical card mutation');
      }
      return existsSync(join(coordinationRoot, ...doneRel.split('/'))) && !coordinationCommitted ? `${sourceRel}\0` : '';
    }
    if (args[0] === 'ls-files') {
      return existsSync(join(coordinationRoot, ...doneRel.split('/'))) && !coordinationCommitted ? `${doneRel}\0` : '';
    }
    if (args[0] === 'commit') {
      coordinationCommitted = true;
      return '';
    }
    if (args[0] === 'push') {
      if (pushFails || remainingPushFailures > 0) {
        if (remainingPushFailures > 0) remainingPushFailures -= 1;
        throw new Error('push refused');
      }
      coordinationPushed = true;
      return '';
    }
    if (args[0] === 'show') return readFileSync(join(coordinationRoot, ...doneRel.split('/')), 'utf8');
    return '';
  };

  let cardFails = options.cardFails ?? false;
  let verifyFails = options.verifyFails ?? false;
  let cardMutations = 0;
  const runPy: PyRunner = (_cwd, code, jsonArg) => {
    if (code === CANONICAL_RESULT_VERIFY_SCRIPT) {
      if (verifyFails) return { exitCode: 1, stdout: '', stderr: 'committed canonical Result payload differs' };
      const verify = JSON.parse(jsonArg) as {
        cardRef: string; runRef: string; result: Record<string, unknown>; gitCommit?: string;
      };
      if (verify.gitCommit && !coordinationPushed) {
        return { exitCode: 1, stdout: '', stderr: 'published canonical result card is missing or ambiguous' };
      }
      const cardText = readFileSync(join(coordinationRoot, ...doneRel.split('/')), 'utf8');
      const marker = '```kb.canonical-stage-result/v1\n';
      const start = cardText.indexOf(marker) + marker.length;
      const end = cardText.indexOf('\n```', start);
      expect(verify).toEqual({
        cardRef, runRef, result: JSON.parse(cardText.slice(start, end)),
        ...(verify.gitCommit ? { gitCommit: 'e'.repeat(40) } : {}),
      });
      return { exitCode: 0, stdout: JSON.stringify({ path: doneRel }), stderr: '' };
    }
    expect(code).toBe(CANONICAL_RESULT_CARD_SCRIPT);
    if (cardFails) return { exitCode: 1, stdout: '', stderr: 'canonical card mismatch' };
    cardMutations += 1;
    const op = JSON.parse(jsonArg) as { runRef: string; cardRef: string; result: Record<string, unknown> };
    expect(op).toMatchObject({ runRef, cardRef });
    const done = join(coordinationRoot, ...doneRel.split('/'));
    if (!existsSync(done)) {
      writeFileSync(done, [
        '---', `id: ${cardRef}`, `workflow: ${runRef}`, 'state: done', 'execution-controller: dashboard', '---', '',
        '## Result', '', '```kb.canonical-stage-result/v1', JSON.stringify(op.result), '```', '',
      ].join('\n'));
      rmSync(join(coordinationRoot, ...sourceRel.split('/')));
      return { exitCode: 0, stdout: JSON.stringify({ oldPath: sourceRel, resultPath: doneRel, changed: true }), stderr: '' };
    }
    return { exitCode: 0, stdout: JSON.stringify({ oldPath: doneRel, resultPath: doneRel, changed: false }), stderr: '' };
  };

  const integrator = createCanonicalGitResultIntegrator({
    repoRoot, coordinationRoot, integrationRoot, worktreeRoot, stateRoot, baseCommit: 'a'.repeat(40),
    gitRunner, coordinationGit, runPy,
  });
  return {
    input, integrator, gitCalls, coordinationCalls, stateRoot, coordinationRoot, doneRel,
    setPushFails(value: boolean) { pushFails = value; },
    setCardFails(value: boolean) { cardFails = value; },
    setLineagePushFails(value: boolean) { lineagePushFails = value; },
    setCoordinationIndexDirty(value: boolean) { coordinationIndexDirty = value; },
    setVerifyFails(value: boolean) { verifyFails = value; },
    cardMutations: () => cardMutations,
  };
}

describe('canonical Git result integrator', () => {
  it('commits bounded attempt changes into lineage before the exact canonical card commit and replay', async () => {
    const item = fixture();
    expect(await item.integrator.lookup(item.input)).toBeNull();
    expect(await item.integrator.integrate(item.input)).toMatchObject({
      status: 'integrated', resultHash: item.input.resultHash,
      attemptBaseCommit: 'a'.repeat(40), integrationCommit: 'd'.repeat(40),
    });
    expect(await item.integrator.lookup(item.input)).toMatchObject({
      resultHash: item.input.resultHash,
      summary: 'stage complete',
      reviewOutcome: item.input.reviewOutcome,
      attemptBaseCommit: 'a'.repeat(40),
      integrationCommit: 'd'.repeat(40),
    });
    expect(await item.integrator.integrate(item.input)).toMatchObject({
      status: 'replayed', resultHash: item.input.resultHash,
      attemptBaseCommit: 'a'.repeat(40), integrationCommit: 'd'.repeat(40),
    });
    expect(item.cardMutations()).toBe(1);

    // Regression (Windows MAX_PATH): the integration worktree is created under the same deep state-root
    // path as the attempt worktree, so its `git worktree add` must carry `-c core.longpaths=true` or it
    // fails "Filename too long" (128) after the worker already succeeded. No-op off Windows; not a gate.
    const worktreeAdd = item.gitCalls.find((call) => call.args[0] === 'worktree' && call.args[1] === 'add');
    expect(worktreeAdd).toBeDefined();
    expect(worktreeAdd!.fullArgs).toContain('core.longpaths=true');
    expect(worktreeAdd!.fullArgs[worktreeAdd!.fullArgs.indexOf('core.longpaths=true') - 1]).toBe('-c');

    const cherryPick = item.gitCalls.findIndex((call) => call.args[0] === 'cherry-pick');
    const canonicalCommit = item.coordinationCalls.findIndex((args) => args[0] === 'commit');
    const push = item.coordinationCalls.findIndex((args) => args[0] === 'push');
    const reread = item.coordinationCalls.findIndex((args) =>
      args[0] === 'fetch' && args.includes('refs/heads/ops:refs/remotes/origin/ops'));
    expect(cherryPick).toBeGreaterThan(-1);
    expect(canonicalCommit).toBeGreaterThan(-1);
    expect(push).toBeGreaterThan(canonicalCommit);
    expect(reread).toBeGreaterThan(push);
  });

  it('refuses changed-content digest drift before creating a lineage', async () => {
    const item = fixture();
    await expect(item.integrator.integrate({
      ...item.input,
      changed: [{ ...item.input.changed[0], digest: 'd'.repeat(64) }],
      resultHash: canonicalStageResultHash({
        summary: item.input.summary,
        artifacts: item.input.artifacts,
        changed: [{ ...item.input.changed[0], digest: 'd'.repeat(64) }],
        checkpoints: item.input.checkpoints,
        reviewOutcome: item.input.reviewOutcome,
      }),
    })).rejects.toThrow('artifact digest changed');
    expect(item.gitCalls.some((call) => call.args[0] === 'cherry-pick')).toBe(false);
  });

  it.skipIf(!SYMLINKS_SUPPORTED)('refuses to hash or commit a changed path swapped for a symlink', async () => {
    const item = fixture({ changedAsSymlink: true });
    await expect(item.integrator.integrate(item.input)).rejects.toThrow('changed path is not a regular file');
    expect(item.gitCalls.some((call) => call.args[0] === 'cherry-pick')).toBe(false);
    expect(item.cardMutations()).toBe(0);
  });

  it('refuses to hash or commit a changed path that is not a regular file', async () => {
    const item = fixture({ changedAsIrregular: true });
    await expect(item.integrator.integrate(item.input)).rejects.toThrow('changed path is not a regular file');
    expect(item.gitCalls.some((call) => call.args[0] === 'cherry-pick')).toBe(false);
    expect(item.cardMutations()).toBe(0);
  });

  it('resumes a lineage commit after canonical card mismatch without duplicating worker integration', async () => {
    const item = fixture({ cardFails: true });
    await expect(item.integrator.integrate(item.input)).rejects.toThrow('canonical card mismatch');
    expect(JSON.parse(readFileSync(join(item.stateRoot, 'control/canonical-integration.json'), 'utf8')).records[0].state)
      .toBe('canonical-intent');
    item.setCardFails(false);
    await expect(item.integrator.integrate(item.input)).resolves.toMatchObject({ status: 'integrated' });
    expect(item.gitCalls.filter((call) => call.args[0] === 'cherry-pick')).toHaveLength(1);
  });

  it('refuses canonical completion until the work-product lineage is remotely durable', async () => {
    const item = fixture({ lineagePushFails: true });
    await expect(item.integrator.integrate(item.input)).rejects.toThrow('lineage publication failed');
    expect(item.cardMutations()).toBe(0);
    expect(JSON.parse(readFileSync(join(item.stateRoot, 'control/canonical-integration.json'), 'utf8')).records[0].state)
      .toBe('lineage-local');
    item.setLineagePushFails(false);
    await expect(item.integrator.integrate(item.input)).resolves.toMatchObject({ status: 'integrated' });
    expect(item.gitCalls.filter((call) => call.args[0] === 'cherry-pick')).toHaveLength(1);
  });

  it('fails closed on a partial or unrelated coordination index before card mutation', async () => {
    const item = fixture({ coordinationIndexDirty: true });
    await expect(item.integrator.integrate(item.input)).rejects.toThrow('coordination index is dirty');
    expect(item.cardMutations()).toBe(0);
    expect(JSON.parse(readFileSync(join(item.stateRoot, 'control/canonical-integration.json'), 'utf8')).records[0].state)
      .toBe('lineage-committed');
    item.setCoordinationIndexDirty(false);
    await expect(item.integrator.integrate(item.input)).resolves.toMatchObject({ status: 'integrated' });
  });

  it('does not resolve integration until the committed structured Result rereads exactly', async () => {
    const item = fixture({ verifyFails: true });
    await expect(item.integrator.integrate(item.input)).rejects.toThrow('committed canonical Result payload differs');
    await expect(item.integrator.resolveBase?.({
      operationKey: 'base:run-1:stage-2', subject: 'operator', runRef: 'run-1', stageId: 'stage-2', dependencyStageIds: ['stage-1'],
    })).rejects.toThrow('lacks a committed canonical result');
    item.setVerifyFails(false);
    await expect(item.integrator.integrate(item.input)).resolves.toMatchObject({ status: 'integrated' });
  });

  it('does not expose lookup or dependency base until canonical push and reread succeed', async () => {
    const item = fixture({ pushFails: true });
    await expect(item.integrator.integrate(item.input)).rejects.toThrow('push refused');
    await expect(item.integrator.lookup(item.input)).rejects.toThrow('published canonical result card is missing or ambiguous');
    await expect(item.integrator.resolveBase?.({
      operationKey: 'base:run-1:stage-2', subject: 'operator', runRef: 'run-1', stageId: 'stage-2', dependencyStageIds: ['stage-1'],
    })).rejects.toThrow('lacks a committed canonical result');
    item.setPushFails(false);
    await expect(item.integrator.integrate(item.input)).resolves.toMatchObject({ status: 'integrated' });
    await expect(item.integrator.resolveBase?.({
      operationKey: 'base:run-1:stage-2', subject: 'operator', runRef: 'run-1', stageId: 'stage-2', dependencyStageIds: ['stage-1'],
    })).resolves.toBe('d'.repeat(40));
  });

  it('recovers an exact attempt commit created after the durable intent but before phase persistence', async () => {
    const item = fixture({ failAfterAttemptCommit: true });
    await expect(item.integrator.integrate(item.input)).rejects.toThrow('simulated daemon exit after attempt commit');
    expect(JSON.parse(readFileSync(join(item.stateRoot, 'control/canonical-integration.json'), 'utf8')).records[0].state).toBe('intent');
    await expect(item.integrator.integrate(item.input)).resolves.toMatchObject({ status: 'integrated' });
    expect(item.gitCalls.filter((call) => call.args[0] === 'commit')).toHaveLength(1);
  });

  it('recovers an exact lineage cherry-pick completed before phase persistence', async () => {
    const item = fixture({ failAfterCherryPick: true });
    await expect(item.integrator.integrate(item.input)).rejects.toThrow('simulated daemon exit after cherry-pick');
    expect(JSON.parse(readFileSync(join(item.stateRoot, 'control/canonical-integration.json'), 'utf8')).records[0].state).toBe('attempt-committed');
    await expect(item.integrator.integrate(item.input)).resolves.toMatchObject({ status: 'integrated' });
    expect(item.gitCalls.filter((call) => call.args[0] === 'cherry-pick')).toHaveLength(1);
  });

  it('recovers an exact canonical card mutation recorded before its coordination commit', async () => {
    const item = fixture({ failAfterCardMutation: true });
    await expect(item.integrator.integrate(item.input)).rejects.toThrow('simulated daemon exit after canonical card mutation');
    expect(JSON.parse(readFileSync(join(item.stateRoot, 'control/canonical-integration.json'), 'utf8')).records[0].state)
      .toBe('canonical-intent');
    await expect(item.integrator.integrate(item.input)).resolves.toMatchObject({ status: 'integrated' });
    expect(item.coordinationCalls.filter((args) => args[0] === 'commit')).toHaveLength(1);
  });

  it('promotes a pushed canonical-intent result through lookup without replaying its mutable input', async () => {
    const item = fixture({ verifyFails: true });
    await expect(item.integrator.integrate(item.input)).rejects.toThrow('committed canonical Result payload differs');
    const path = join(item.stateRoot, 'control/canonical-integration.json');
    expect(JSON.parse(readFileSync(path, 'utf8')).records[0].state).toBe('canonical-intent');
    expect(item.coordinationCalls.filter((args) => args[0] === 'commit')).toHaveLength(1);
    expect(item.coordinationCalls.filter((args) => args[0] === 'push')).toHaveLength(1);

    item.setVerifyFails(false);
    await expect(item.integrator.lookup({
      operationKey: item.input.operationKey,
      subject: item.input.subject,
      runRef: item.input.runRef,
      stageId: item.input.stageId,
    })).resolves.toMatchObject({
      summary: item.input.summary,
      resultHash: item.input.resultHash,
      durability: 'canonical',
    });
    expect(JSON.parse(readFileSync(path, 'utf8')).records[0].state).toBe('canonical-committed');
    expect(item.cardMutations()).toBe(1);
    expect(item.coordinationCalls.filter((args) => args[0] === 'commit')).toHaveLength(1);
  });

  it('does not promote a local-only canonical-intent card through lookup', async () => {
    const item = fixture({ failAfterCardMutation: true });
    await expect(item.integrator.integrate(item.input)).rejects.toThrow('simulated daemon exit after canonical card mutation');
    await expect(item.integrator.lookup({
      operationKey: item.input.operationKey,
      subject: item.input.subject,
      runRef: item.input.runRef,
      stageId: item.input.stageId,
    })).rejects.toThrow();
    const path = join(item.stateRoot, 'control/canonical-integration.json');
    expect(JSON.parse(readFileSync(path, 'utf8')).records[0].state).toBe('canonical-intent');
  });

  it('rejects a direct caller that supplies a malformed review outcome before journaling', async () => {
    const item = fixture();
    await expect(item.integrator.integrate({
      ...item.input,
      reviewOutcome: { ...item.input.reviewOutcome!, summary: 'sk-abcdefghijklmnopqrstuvwxyz1234567890' },
    })).rejects.toThrow('invalid review outcome');
    expect(item.gitCalls).toHaveLength(0);
    expect(item.cardMutations()).toBe(0);
  });

  it('fails closed when a persisted review outcome no longer validates against its journaled contract', async () => {
    const item = fixture();
    await item.integrator.integrate(item.input);
    const path = join(item.stateRoot, 'control/canonical-integration.json');
    const stored = JSON.parse(readFileSync(path, 'utf8')) as { records: Array<{ result: { reviewOutcome: { summary: string } } }> };
    stored.records[0].result.reviewOutcome.summary = 'sk-abcdefghijklmnopqrstuvwxyz1234567890';
    writeFileSync(path, JSON.stringify(stored), 'utf8');
    await expect(item.integrator.lookup(item.input)).rejects.toThrow('canonical integration state is invalid');
  });

  it('accepts and exactly replays a legacy non-review record without rewriting its fingerprint', async () => {
    const item = fixture({ nonReview: true });
    await item.integrator.integrate(item.input);
    await expect(item.integrator.integrate(item.input)).resolves.toMatchObject({ status: 'replayed' });
    const path = join(item.stateRoot, 'control/canonical-integration.json');
    const stored = JSON.parse(readFileSync(path, 'utf8')) as {
      records: Array<Record<string, unknown> & { result: Record<string, unknown>; fingerprint: string }>;
    };
    const record = stored.records[0];
    delete record.reviewContract;
    const currentResultHash = String(record.result.resultHash);
    record.result.resultHash = canonicalStageResultHash(
      record.result as unknown as Parameters<typeof canonicalStageResultHash>[0],
      'legacy-non-review',
    );
    record.fingerprint = fingerprint({
      operationKey: item.input.operationKey,
      subject: item.input.subject,
      runRef: item.input.runRef,
      stageRef: item.input.stageRef,
      stageId: item.input.stageId,
      attemptRef: item.input.attemptRef,
      canonicalCardRef: item.input.canonicalCardRef,
      result: record.result,
    });
    writeFileSync(path, JSON.stringify(stored), 'utf8');
    const donePath = join(item.coordinationRoot, ...item.doneRel.split('/'));
    writeFileSync(
      donePath,
      readFileSync(donePath, 'utf8').replace(currentResultHash, String(record.result.resultHash)),
      'utf8',
    );

    await expect(item.integrator.lookup(item.input)).resolves.toMatchObject({
      summary: item.input.summary,
      resultHash: record.result.resultHash,
    });
    await expect(item.integrator.resolveBase?.({
      operationKey: 'base:run-1:stage-2',
      subject: item.input.subject,
      runRef: item.input.runRef,
      stageId: 'stage-2',
      dependencyStageIds: [item.input.stageId],
    })).resolves.toBe('d'.repeat(40));
    await expect(item.integrator.integrate(item.input)).resolves.toMatchObject({
      status: 'replayed',
      resultHash: record.result.resultHash,
    });
    const replayed = JSON.parse(readFileSync(path, 'utf8')) as { records: Array<{ reviewContract?: unknown }> };
    expect(replayed.records[0]).not.toHaveProperty('reviewContract');
  });

  it('resumes a legacy in-progress non-review record with its original fingerprint', async () => {
    const item = fixture({ nonReview: true, failAfterAttemptCommit: true });
    await expect(item.integrator.integrate(item.input)).rejects.toThrow('simulated daemon exit after attempt commit');
    const path = join(item.stateRoot, 'control/canonical-integration.json');
    const stored = JSON.parse(readFileSync(path, 'utf8')) as {
      records: Array<Record<string, unknown> & { result: Record<string, unknown>; fingerprint: string }>;
    };
    const record = stored.records[0];
    delete record.reviewContract;
    record.result.resultHash = canonicalStageResultHash(
      record.result as unknown as Parameters<typeof canonicalStageResultHash>[0],
      'legacy-non-review',
    );
    record.fingerprint = fingerprint({
      operationKey: item.input.operationKey,
      subject: item.input.subject,
      runRef: item.input.runRef,
      stageRef: item.input.stageRef,
      stageId: item.input.stageId,
      attemptRef: item.input.attemptRef,
      canonicalCardRef: item.input.canonicalCardRef,
      result: record.result,
    });
    writeFileSync(path, JSON.stringify(stored), 'utf8');

    await expect(item.integrator.integrate(item.input)).resolves.toMatchObject({
      status: 'integrated',
      resultHash: record.result.resultHash,
    });
  });

  it('resumes a legacy canonical-intent record against its immutable old card payload', async () => {
    const item = fixture({ nonReview: true, failAfterCardMutation: true });
    await expect(item.integrator.integrate(item.input)).rejects.toThrow('simulated daemon exit after canonical card mutation');
    const path = join(item.stateRoot, 'control/canonical-integration.json');
    const stored = JSON.parse(readFileSync(path, 'utf8')) as {
      records: Array<Record<string, unknown> & { result: Record<string, unknown>; fingerprint: string }>;
    };
    const record = stored.records[0];
    expect(record.state).toBe('canonical-intent');
    delete record.reviewContract;
    const currentResultHash = String(record.result.resultHash);
    record.result.resultHash = canonicalStageResultHash(
      record.result as unknown as Parameters<typeof canonicalStageResultHash>[0],
      'legacy-non-review',
    );
    record.fingerprint = fingerprint({
      operationKey: item.input.operationKey,
      subject: item.input.subject,
      runRef: item.input.runRef,
      stageRef: item.input.stageRef,
      stageId: item.input.stageId,
      attemptRef: item.input.attemptRef,
      canonicalCardRef: item.input.canonicalCardRef,
      result: record.result,
    });
    writeFileSync(path, JSON.stringify(stored), 'utf8');
    const donePath = join(item.coordinationRoot, ...item.doneRel.split('/'));
    writeFileSync(
      donePath,
      readFileSync(donePath, 'utf8').replace(currentResultHash, String(record.result.resultHash)),
      'utf8',
    );

    await expect(item.integrator.integrate(item.input)).resolves.toMatchObject({
      status: 'integrated',
      resultHash: record.result.resultHash,
    });
    const replayed = JSON.parse(readFileSync(path, 'utf8')) as {
      records: Array<{ state: string; reviewContract?: unknown; result: { resultHash: string } }>;
    };
    expect(replayed.records[0]).toMatchObject({
      state: 'canonical-committed',
      result: { resultHash: record.result.resultHash },
    });
    expect(replayed.records[0]).not.toHaveProperty('reviewContract');
  });

  it('rejects a legacy review outcome whose immutable review contract is absent', async () => {
    const item = fixture();
    await item.integrator.integrate(item.input);
    const path = join(item.stateRoot, 'control/canonical-integration.json');
    const stored = JSON.parse(readFileSync(path, 'utf8')) as { records: Array<Record<string, unknown>> };
    delete stored.records[0].reviewContract;
    writeFileSync(path, JSON.stringify(stored), 'utf8');

    await expect(item.integrator.lookup(item.input)).rejects.toThrow('canonical integration review contract is absent');
  });

  it('keeps a later generation distinct from g1 without rewriting the immutable stage card', async () => {
    const item = fixture();
    const input = {
      ...item.input,
      operationKey: 'result:run-1:stage-1:g2',
      canonicalCardRef: null,
    };
    const result = await item.integrator.integrate(input);
    expect(result).toMatchObject({
      status: 'integrated', resultHash: input.resultHash,
      attemptBaseCommit: 'a'.repeat(40), integrationCommit: 'd'.repeat(40),
    });
    expect(await item.integrator.lookup(input)).toMatchObject({ reviewOutcome: input.reviewOutcome });
    expect(item.cardMutations()).toBe(0);
    expect(item.gitCalls.some((call) => call.args[0] === 'fetch')).toBe(true);
  });

  it('rebases and re-verifies a journaled canonical commit after one concurrent ops advance', async () => {
    const item = fixture({ pushFailsOnce: true });
    await expect(item.integrator.integrate(item.input)).resolves.toMatchObject({ status: 'integrated' });
    expect(item.coordinationCalls.filter((args) => args[0] === 'push')).toHaveLength(2);
    expect(item.coordinationCalls.some((args) => args.join(' ') === 'pull --rebase origin ops')).toBe(true);
  });
});
