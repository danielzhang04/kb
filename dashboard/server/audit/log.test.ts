import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AUDIT_REL_PATH,
  appendAudit,
  appendAuditRowLocal,
  commitAuditToOps,
} from './log.ts';
import type { AuditEvent, OpsGitRunner } from './log.ts';

const tmpDirs: string[] = [];
async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'audit-log-'));
  tmpDirs.push(dir);
  return dir;
}
afterEach(async () => {
  while (tmpDirs.length) {
    const dir = tmpDirs.pop()!;
    await rm(dir, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

/**
 * Build a REAL, minimal git repo at a fresh scratch dir, checked out on `branch` — the branch-guard
 * tests exercise the real `git symbolic-ref` read (per this repo's convention of controlling test state
 * via real fixtures, not a fake resolver seam), while every MUTATING call (pull/add/commit/push) still
 * goes through the injected {@link OpsGitRunner} fake, so no test ever touches the network.
 */
function initRepo(dir: string, branch: string): void {
  execFileSync('git', ['init', '-q', '-b', branch], { cwd: dir });
  execFileSync('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=test', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: dir });
}

/** Detach HEAD at the repo's current commit — `symbolic-ref` fails on a detached HEAD (no branch name). */
function detachHead(dir: string): void {
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir }).toString().trim();
  execFileSync('git', ['checkout', '-q', sha], { cwd: dir });
}

/** A recording git runner; each call is captured as its argv (after `git`). Never rejects. */
function recorder(): { runner: OpsGitRunner; calls: string[][] } {
  const calls: string[][] = [];
  const runner: OpsGitRunner = (_repoRoot, args) => {
    calls.push(args);
    return '';
  };
  return { runner, calls };
}

/** Read the ledger back as parsed NDJSON rows (empty array if the file does not exist yet). */
async function readLedger(repoRoot: string): Promise<Record<string, unknown>[]> {
  try {
    const text = await readFile(join(repoRoot, ...AUDIT_REL_PATH.split('/')), 'utf8');
    return text
      .split('\n')
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l));
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') return [];
    throw err;
  }
}

describe('appendAuditRowLocal (pure local append)', () => {
  it('is append-only: never rewrites prior rows', async () => {
    const repo = await scratch();
    const first = appendAuditRowLocal(repo, { action: 'approve', cardId: 'card-1' }, () => new Date('2026-01-01T00:00:00Z'));
    const second = appendAuditRowLocal(repo, { action: 'steer', cardId: 'card-2' }, () => new Date('2026-01-01T00:00:01Z'));

    const rows = await readLedger(repo);
    expect(rows).toHaveLength(2);
    // The first row is byte-for-byte unchanged by the second append — no rewrite occurred.
    expect(rows[0]).toEqual({ ts: first.ts, action: 'approve', cardId: 'card-1' });
    expect(rows[1]).toEqual({ ts: second.ts, action: 'steer', cardId: 'card-2' });
  });

  it('a third append still leaves the first two rows untouched', async () => {
    const repo = await scratch();
    appendAuditRowLocal(repo, { action: 'approve' }, () => new Date('2026-01-01T00:00:00Z'));
    appendAuditRowLocal(repo, { action: 'steer' }, () => new Date('2026-01-01T00:00:01Z'));
    const before = await readLedger(repo);

    appendAuditRowLocal(repo, { action: 'spawn' }, () => new Date('2026-01-01T00:00:02Z'));
    const after = await readLedger(repo);

    expect(after).toHaveLength(3);
    expect(after[0]).toEqual(before[0]);
    expect(after[1]).toEqual(before[1]);
  });
});

describe('commitAuditToOps (injectable git-runner, hermetic)', () => {
  it('commits via pull --rebase -> add -> commit -> push, in that order, on ops', async () => {
    const repo = '/fake/repo';
    const { runner, calls } = recorder();
    await commitAuditToOps(repo, runner);

    const verbs = calls.map((c) => c.slice(0, 2).join(' '));
    expect(verbs).toEqual(['diff --cached', 'pull --rebase', 'add --', 'commit -m', 'push origin']);
    expect(calls[0]).toEqual(['diff', '--cached', '--name-only', '-z']);
    expect(calls[1]).toEqual(['pull', '--rebase', '--autostash', 'origin', 'ops']);
    expect(calls[4]).toEqual(['push', 'origin', 'ops']);
    // Only the audit ledger is staged (never `git add .`).
    expect(calls[2]).toEqual(['add', '--', AUDIT_REL_PATH]);
    expect(calls[3]).toContain('--only');
  });

  it('re-reads (pull --rebase) and retries when the push is rejected', async () => {
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

    await commitAuditToOps(repo, runner, { maxRetryPushes: 3 });

    const pushIdx = calls.map((c, i) => (c[0] === 'push' ? i : -1)).filter((i) => i >= 0);
    expect(pushIdx).toHaveLength(2);
    expect(calls[pushIdx[0] + 1]).toEqual(['pull', '--rebase', '--autostash', 'origin', 'ops']);
  });

  it('gives up after maxRetryPushes exhausted, surfacing the push error', async () => {
    const runner: OpsGitRunner = (_r, args) => {
      if (args[0] === 'push') throw new Error('rejected');
      return '';
    };
    await expect(commitAuditToOps('/r', runner, { maxRetryPushes: 2 })).rejects.toThrow(/rejected/);
  });
});

describe('appendAudit (append + commit, end-to-end)', () => {
  it('appends exactly one local row, then commits on ops via pull-rebase-push, retrying on a rejected push', async () => {
    const repo = await scratch();
    initRepo(repo, 'ops');
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

    const row = await appendAudit(repo, { action: 'approve', cardId: 'card-a' }, { runGit: runner });

    // The commit sequence still opens with pull --rebase and reconciles before the retried push.
    expect(calls[0]).toEqual(['diff', '--cached', '--name-only', '-z']);
    expect(calls[1]).toEqual(['pull', '--rebase', '--autostash', 'origin', 'ops']);
    const pushIdx = calls.map((c, i) => (c[0] === 'push' ? i : -1)).filter((i) => i >= 0);
    expect(pushIdx).toHaveLength(2);
    expect(calls[pushIdx[0] + 1]).toEqual(['pull', '--rebase', '--autostash', 'origin', 'ops']);

    // The retried push never re-appended the row: exactly one row exists for this action.
    const rows = await readLedger(repo);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ ts: row.ts, action: 'approve', cardId: 'card-a' });
  });

  it('never invokes git before the row has already been appended to disk', async () => {
    const repo = await scratch();
    initRepo(repo, 'ops');
    const order: string[] = [];
    const runner: OpsGitRunner = (_repoRoot, args) => {
      order.push(args[0]);
      return '';
    };
    await appendAudit(repo, { action: 'launch' }, { runGit: runner });

    const rows = await readLedger(repo);
    expect(rows).toHaveLength(1);
    expect(order[0]).toBe('diff');
  });
});

describe('audit coverage', () => {
  it('every consequential action produces exactly one audit row', async () => {
    const repo = await scratch();
    initRepo(repo, 'ops');
    const { runner } = recorder();
    const actions: AuditEvent[] = [
      { action: 'approve', cardId: 'card-1' },
      { action: 'steer', cardId: 'card-1' },
      { action: 'spawn', cardId: 'card-2' },
      { action: 'save', target: 'skills/foo/SKILL.md' },
      { action: 'launch', cardId: 'card-3' },
    ];

    for (const event of actions) {
      await appendAudit(repo, event, { runGit: runner });
    }

    const rows = await readLedger(repo);
    expect(rows).toHaveLength(actions.length);
    for (const event of actions) {
      const matches = rows.filter((r) => r.action === event.action && r.cardId === event.cardId);
      expect(matches).toHaveLength(1);
    }
  });

  it('a rejected-then-retried push still yields exactly one row for that action', async () => {
    const repo = await scratch();
    initRepo(repo, 'ops');
    let pushes = 0;
    const runner: OpsGitRunner = (_repoRoot, args) => {
      if (args[0] === 'push') {
        pushes += 1;
        if (pushes === 1) throw new Error('! [rejected] ops -> ops (fetch first)');
      }
      return '';
    };

    await appendAudit(repo, { action: 'approve', cardId: 'card-retry' }, { runGit: runner });

    const rows = await readLedger(repo);
    const matches = rows.filter((r) => r.action === 'approve' && r.cardId === 'card-retry');
    expect(matches).toHaveLength(1);
  });
});

// The 2026-07-30 incident: `appendAudit` ran `pull --rebase --autostash origin ops` against a repo root
// checked out on a FEATURE branch, starting a 549-step interactive rebase that jammed mid-rebase. These
// tests prove the structural fix — every non-"ops" outcome takes the local-only path and the injected
// (mutating) git runner is invoked ZERO times, using real repos/branches per this repo's test convention
// rather than a fake branch-resolver seam.
describe('appendAudit — coordination-write branch guard (fail closed on anything but "ops")', () => {
  it('an ops repo root still takes the full git path (asserted against the injected git runner)', async () => {
    const repo = await scratch();
    initRepo(repo, 'ops');
    const { runner, calls } = recorder();

    const row = await appendAudit(repo, { action: 'approve', cardId: 'card-ops' }, { runGit: runner });

    const verbs = calls.map((c) => c.slice(0, 2).join(' '));
    expect(verbs).toEqual(['diff --cached', 'pull --rebase', 'add --', 'commit -m', 'push origin']);
    expect(row.synced).toBe(true);
  });

  it('a feature-branch repo root takes local-only: appends the row and never invokes the git runner', async () => {
    const repo = await scratch();
    initRepo(repo, 'claude/fyt-pipeline-boss');
    const { runner, calls } = recorder();

    const row = await appendAudit(repo, { action: 'approve', cardId: 'card-feature' }, { runGit: runner });

    // The load-bearing assertion: the mutating git runner was never called, not even once.
    expect(calls).toHaveLength(0);
    expect(row.synced).toBe(false);
    const rows = await readLedger(repo);
    expect(rows.filter((r) => r.cardId === 'card-feature')).toHaveLength(1);
  });

  it('a detached HEAD takes local-only and never invokes the git runner', async () => {
    const repo = await scratch();
    initRepo(repo, 'ops');
    detachHead(repo);
    const { runner, calls } = recorder();

    const row = await appendAudit(repo, { action: 'approve', cardId: 'card-detached' }, { runGit: runner });

    expect(calls).toHaveLength(0);
    expect(row.synced).toBe(false);
  });

  it('a non-git directory takes local-only and never invokes the git runner', async () => {
    const repo = await scratch(); // deliberately never `git init`-ed
    const { runner, calls } = recorder();

    const row = await appendAudit(repo, { action: 'approve', cardId: 'card-nongit' }, { runGit: runner });

    expect(calls).toHaveLength(0);
    expect(row.synced).toBe(false);
  });

  it('the branch resolution itself failing (repo root does not exist) takes local-only', async () => {
    // A path that was never created: the git child fails to spawn (ENOENT-shaped), a distinct failure
    // mode from "exists but isn't a repo" and from "detached" — resolveCheckedOutBranch must collapse
    // this to null too.
    const repo = join(tmpdir(), `audit-log-missing-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const { runner, calls } = recorder();

    const row = await appendAudit(repo, { action: 'approve', cardId: 'card-missing' }, { runGit: runner });

    expect(calls).toHaveLength(0);
    expect(row.synced).toBe(false);
    // The local append still succeeded despite the repo root not existing beforehand (appendAuditRowLocal
    // creates it via mkdirSync recursive) — losing the row is worse than skipping the push.
    tmpDirs.push(repo);
    const rows = await readLedger(repo);
    expect(rows.filter((r) => r.cardId === 'card-missing')).toHaveLength(1);
  });

  it('logs one loud, greppable warning naming the branch and repo root on every local-only path', async () => {
    const repo = await scratch();
    initRepo(repo, 'claude/some-other-branch');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await appendAudit(repo, { action: 'approve' }, { runGit: recorder().runner });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const message = errorSpy.mock.calls[0]?.[0] as string;
    expect(message).toMatch(/AUDIT-GIT-GUARD/);
    expect(message).toContain(repo);
    expect(message).toContain('claude/some-other-branch');
    expect(message).toMatch(/SKIPPED/);
  });

  it('the row written on the local-only path is byte-identical (module content) to the row the git path would have appended', async () => {
    const gitRepo = await scratch();
    initRepo(gitRepo, 'ops');
    const localRepo = await scratch();
    initRepo(localRepo, 'claude/not-ops');
    const event: AuditEvent = { action: 'approve', cardId: 'card-parity', owner: 'operator-1', result: 'ok', detail: { foo: 'bar' } };
    const fixedNow = () => new Date('2026-07-30T00:00:00Z');

    await appendAudit(gitRepo, event, { runGit: recorder().runner, now: fixedNow });
    await appendAudit(localRepo, event, { runGit: recorder().runner, now: fixedNow });

    const gitRows = await readLedger(gitRepo);
    const localRows = await readLedger(localRepo);
    // Same event, same clock -> the persisted row is identical whichever path ran. Neither ledger row
    // carries a `synced` key (that field only ever lives on the return value, never on disk).
    expect(gitRows[0]).toEqual(localRows[0]);
    expect(gitRows[0]).toEqual({ ts: fixedNow().toISOString(), ...event });
    expect(Object.keys(gitRows[0] as object)).not.toContain('synced');
  });
});
