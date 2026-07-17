import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { writeFileSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mintSession } from '../auth/session';
import type { SessionConfig } from '../auth/session';
import { save } from './governedSave';
import type { GitRunner, PrOpener } from './branch';

const SECRET = Buffer.from('unit-test-secret-do-not-reuse');
const CONFIG: SessionConfig = { secret: SECRET, now: () => 1_700_000_000_000 };

function validToken(): string {
  return mintSession('user-1', CONFIG).token;
}

function recorder(): { runner: GitRunner; calls: string[][] } {
  const calls: string[][] = [];
  const runner: GitRunner = (_repoRoot, args) => {
    calls.push(args);
    return '';
  };
  return { runner, calls };
}

const noopPrOpener: PrOpener = () => {};

const tmpDirs: string[] = [];
async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'governed-save-'));
  tmpDirs.push(dir);
  return dir;
}
afterEach(async () => {
  while (tmpDirs.length) {
    const dir = tmpDirs.pop()!;
    await rm(dir, { recursive: true, force: true });
  }
});

describe('save — session gate', () => {
  it('rejects a save without a valid WebAuthn session (401)', async () => {
    const repo = await scratch();
    const { runner, calls } = recorder();

    const result = await save({
      repoRoot: repo,
      relpath: 'docs/notes.md',
      content: 'hello',
      sessionToken: undefined,
      sessionConfig: CONFIG,
      runGit: runner,
      openPr: noopPrOpener,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
    // No write, no git call, on an unauthenticated save attempt.
    expect(calls).toHaveLength(0);

    const resultBadToken = await save({
      repoRoot: repo,
      relpath: 'docs/notes.md',
      content: 'hello',
      sessionToken: 'garbage.notasignature',
      sessionConfig: CONFIG,
      runGit: runner,
      openPr: noopPrOpener,
    });
    expect(resultBadToken.ok).toBe(false);
    if (!resultBadToken.ok) expect(resultBadToken.status).toBe(401);
  });
});

describe('save — path confinement', () => {
  it('confines the save path to the repo root, rejecting traversal and absolute paths', async () => {
    const repo = await scratch();
    const { runner, calls } = recorder();
    const token = validToken();

    const traversal = await save({
      repoRoot: repo,
      relpath: '../../etc/passwd',
      content: 'pwned',
      sessionToken: token,
      sessionConfig: CONFIG,
      runGit: runner,
      openPr: noopPrOpener,
    });
    expect(traversal.ok).toBe(false);
    if (!traversal.ok) expect(traversal.status).toBe(400);

    const absolute = await save({
      repoRoot: repo,
      relpath: '/etc/passwd',
      content: 'pwned',
      sessionToken: token,
      sessionConfig: CONFIG,
      runGit: runner,
      openPr: noopPrOpener,
    });
    expect(absolute.ok).toBe(false);
    if (!absolute.ok) expect(absolute.status).toBe(400);

    // Neither escape attempt reached git.
    expect(calls).toHaveLength(0);
  });
});

describe('save — sync_skills hook awareness', () => {
  it('a skills/** save lets the sync_skills pre-commit hook run and includes its staged .claude/skills mirror', async () => {
    const repo = await scratch();
    const { runner: runGit, calls } = recorder();
    const token = validToken();

    const result = await save({
      repoRoot: repo,
      relpath: 'skills/curated/alpha-skill/SKILL.md',
      content: '# alpha skill\n',
      sessionToken: token,
      sessionConfig: CONFIG,
      runGit,
      openPr: noopPrOpener,
    });

    expect(result.ok).toBe(true);
    // The commit call never disables hooks / never bypasses verification.
    const commitCall = calls.find((c) => c[0] === 'commit');
    expect(commitCall).toBeDefined();
    expect(commitCall).not.toContain('--no-verify');
    expect(calls.every((c) => !c.includes('--no-verify'))).toBe(true);
    // Content actually landed on disk before the commit, so the (real, active) pre-commit hook has a
    // populated skills/curated/ tree to mirror into .claude/skills.
    const onDisk = await readFile(join(repo, 'skills', 'curated', 'alpha-skill', 'SKILL.md'), 'utf-8');
    expect(onDisk).toContain('alpha skill');
  });

  it('a drifted .claude/skills mirror fails the save rather than being bypassed', async () => {
    const repo = await scratch();
    const token = validToken();
    // Simulate the sync_skills.py --check failure inside the pre-commit hook: `git commit` exits
    // non-zero (as it would for real when the mirror has drifted), never silently retried with
    // `--no-verify`.
    const runGit: GitRunner = (_repoRoot, args) => {
      if (args[0] === 'commit') {
        throw new Error(
          'commit blocked: .claude/skills drifted from skills/curated (run: python scripts/sync_skills.py)',
        );
      }
      return '';
    };

    const result = await save({
      repoRoot: repo,
      relpath: 'skills/curated/alpha-skill/SKILL.md',
      content: '# alpha skill\n',
      sessionToken: token,
      sessionConfig: CONFIG,
      runGit,
      openPr: noopPrOpener,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(500);
      expect(result.reason).toMatch(/drift/i);
    }
  });
});

describe('save — routes durable vs coordination via branch.ts', () => {
  it('reports the durable classification and opens a PR for a KB markdown save', async () => {
    const repo = await scratch();
    const { runner: runGit } = recorder();
    const prRequests: unknown[] = [];
    const openPr: PrOpener = (_repoRoot, req) => {
      prRequests.push(req);
    };
    const token = validToken();

    const result = await save({
      repoRoot: repo,
      relpath: 'docs/plans/notes.md',
      content: 'plan notes',
      sessionToken: token,
      sessionConfig: CONFIG,
      runGit,
      openPr,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.target).toBe('durable');
    expect(prRequests).toHaveLength(1);
  });

  it('reports the coordination classification and never opens a PR for a queue/** save', async () => {
    const repo = await scratch();
    const { runner: runGit } = recorder();
    const prRequests: unknown[] = [];
    const openPr: PrOpener = (_repoRoot, req) => {
      prRequests.push(req);
    };
    const token = validToken();

    const result = await save({
      repoRoot: repo,
      relpath: 'queue/inbox/card-x.md',
      content: '---\nid: card-x\n---\nbody',
      sessionToken: token,
      sessionConfig: CONFIG,
      runGit,
      openPr,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.target).toBe('coordination');
    expect(prRequests).toHaveLength(0);
  });
});

describe('save — governance/ is never writable through this path', () => {
  it('refuses a save targeting governance/** even with a valid session', async () => {
    const repo = await scratch();
    const { runner, calls } = recorder();
    const token = validToken();

    const result = await save({
      repoRoot: repo,
      relpath: 'governance/risk-tiers.md',
      content: 'tampered',
      sessionToken: token,
      sessionConfig: CONFIG,
      runGit: runner,
      openPr: noopPrOpener,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  // HIGH-2: the carve-out must hold case-INSENSITIVELY. On a case-insensitive FS (NTFS deploy target)
  // `claude.md` / `Governance/…` alias the real human-edited-only files, so a case variant must still
  // be refused 403 and must NOT overwrite the real file.
  it('refuses case-variant constitution/governance targets (case-insensitive carve-out)', async () => {
    const repo = await scratch();
    const token = validToken();
    writeFileSync(join(repo, 'CLAUDE.md'), 'REAL CONSTITUTION', 'utf-8');

    for (const relpath of ['claude.md', 'Claude.MD', 'AGENTS.md'.toLowerCase(), 'GOVERNANCE/risk-tiers.md', 'Governance/budget.yaml']) {
      const { runner, calls } = recorder();
      const result = await save({
        repoRoot: repo,
        relpath,
        content: 'pwned',
        sessionToken: token,
        sessionConfig: CONFIG,
        runGit: runner,
        openPr: noopPrOpener,
      });
      expect(result.ok, relpath).toBe(false);
      if (!result.ok) expect(result.status, relpath).toBe(403);
      expect(calls, relpath).toHaveLength(0);
    }
    // The real constitution file was never touched by any of the case-variant attempts.
    expect(readFileSync(join(repo, 'CLAUDE.md'), 'utf-8')).toBe('REAL CONSTITUTION');
  });
});

describe('save — path confinement is realpath, not lexical (symlink escape)', () => {
  // MED-2: resolveWithin is lexical; a symlinked directory planted under repoRoot could redirect the
  // real write outside the root. A save through such a link must be refused, and the external target
  // left untouched.
  it('rejects a save whose resolved parent dir escapes repoRoot via a symlink/junction', async () => {
    const repo = await scratch();
    const outside = await scratch();
    writeFileSync(join(outside, 'secret.md'), 'ORIGINAL', 'utf-8');
    // A directory link under repoRoot pointing OUTSIDE it. 'junction' works on Windows without admin;
    // on POSIX it resolves as a directory symlink.
    try {
      symlinkSync(outside, join(repo, 'escape'), 'junction');
    } catch {
      symlinkSync(outside, join(repo, 'escape'), 'dir');
    }
    const { runner, calls } = recorder();

    const result = await save({
      repoRoot: repo,
      relpath: 'escape/secret.md',
      content: 'pwned-through-symlink',
      sessionToken: validToken(),
      sessionConfig: CONFIG,
      runGit: runner,
      openPr: noopPrOpener,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
    // The escaping write never happened; the external file is intact and git was never invoked.
    expect(readFileSync(join(outside, 'secret.md'), 'utf-8')).toBe('ORIGINAL');
    expect(calls).toHaveLength(0);
  });
});
