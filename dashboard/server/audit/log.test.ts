import { afterEach, describe, expect, it } from 'vitest';
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
});

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
  it('commits via pull --rebase -> add -> commit -> push, in that order, on ops', () => {
    const repo = '/fake/repo';
    const { runner, calls } = recorder();
    commitAuditToOps(repo, runner);

    const verbs = calls.map((c) => c.slice(0, 2).join(' '));
    expect(verbs).toEqual(['pull --rebase', 'add --', 'commit -m', 'push origin']);
    expect(calls[0]).toEqual(['pull', '--rebase', 'origin', 'ops']);
    expect(calls[3]).toEqual(['push', 'origin', 'ops']);
    // Only the audit ledger is staged (never `git add .`).
    expect(calls[1]).toEqual(['add', '--', AUDIT_REL_PATH]);
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

    commitAuditToOps(repo, runner, { maxRetryPushes: 3 });

    const pushIdx = calls.map((c, i) => (c[0] === 'push' ? i : -1)).filter((i) => i >= 0);
    expect(pushIdx).toHaveLength(2);
    expect(calls[pushIdx[0] + 1]).toEqual(['pull', '--rebase', 'origin', 'ops']);
  });

  it('gives up after maxRetryPushes exhausted, surfacing the push error', () => {
    const runner: OpsGitRunner = (_r, args) => {
      if (args[0] === 'push') throw new Error('rejected');
      return '';
    };
    expect(() => commitAuditToOps('/r', runner, { maxRetryPushes: 2 })).toThrow(/rejected/);
  });
});

describe('appendAudit (append + commit, end-to-end)', () => {
  it('appends exactly one local row, then commits on ops via pull-rebase-push, retrying on a rejected push', async () => {
    const repo = await scratch();
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

    const row = appendAudit(repo, { action: 'approve', cardId: 'card-a' }, { runGit: runner });

    // The commit sequence still opens with pull --rebase and reconciles before the retried push.
    expect(calls[0]).toEqual(['pull', '--rebase', 'origin', 'ops']);
    const pushIdx = calls.map((c, i) => (c[0] === 'push' ? i : -1)).filter((i) => i >= 0);
    expect(pushIdx).toHaveLength(2);
    expect(calls[pushIdx[0] + 1]).toEqual(['pull', '--rebase', 'origin', 'ops']);

    // The retried push never re-appended the row: exactly one row exists for this action.
    const rows = await readLedger(repo);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ ts: row.ts, action: 'approve', cardId: 'card-a' });
  });

  it('never invokes git before the row has already been appended to disk', async () => {
    const repo = await scratch();
    const order: string[] = [];
    const runner: OpsGitRunner = (_repoRoot, args) => {
      order.push(args[0]);
      return '';
    };
    appendAudit(repo, { action: 'launch' }, { runGit: runner });

    const rows = await readLedger(repo);
    expect(rows).toHaveLength(1);
    expect(order[0]).toBe('pull');
  });
});

describe('audit coverage', () => {
  it('every consequential action produces exactly one audit row', async () => {
    const repo = await scratch();
    const { runner } = recorder();
    const actions: AuditEvent[] = [
      { action: 'approve', cardId: 'card-1' },
      { action: 'steer', cardId: 'card-1' },
      { action: 'spawn', cardId: 'card-2' },
      { action: 'save', target: 'skills/foo/SKILL.md' },
      { action: 'launch', cardId: 'card-3' },
    ];

    for (const event of actions) {
      appendAudit(repo, event, { runGit: runner });
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
    let pushes = 0;
    const runner: OpsGitRunner = (_repoRoot, args) => {
      if (args[0] === 'push') {
        pushes += 1;
        if (pushes === 1) throw new Error('! [rejected] ops -> ops (fetch first)');
      }
      return '';
    };

    appendAudit(repo, { action: 'approve', cardId: 'card-retry' }, { runGit: runner });

    const rows = await readLedger(repo);
    const matches = rows.filter((r) => r.action === 'approve' && r.cardId === 'card-retry');
    expect(matches).toHaveLength(1);
  });
});
