import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { writeFileSync, readFileSync, symlinkSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mintSession } from '../auth/session.ts';
import type { SessionConfig } from '../auth/session.ts';
import { save } from './governedSave.ts';
import type { GitRunner, PrOpener } from './branch.ts';

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

describe('save — C7.6 agent id-collision / anti-impersonation guard', () => {
  // Seed the two governance files the guard READS (never writes): the human name/handle registry and the
  // runtime worker-identity registry.
  function seedGovernance(repo: string): void {
    mkdirSync(join(repo, 'governance'), { recursive: true });
    writeFileSync(join(repo, 'governance', 'humans.yaml'), 'humans:\n  - "Daniel Zhang"\n  - "danielzhang04"\n', 'utf-8');
    writeFileSync(
      join(repo, 'governance', 'model-routing.yaml'),
      'version: 1\nruntimes:\n  claude:\n    default_worker: worker-desktop\n  codex:\n    default_worker: codex-worker\n',
      'utf-8',
    );
  }

  it('refuses a NEW agents/<id>.md whose id collides with a humans.yaml handle (400, no write, no git)', async () => {
    const repo = await scratch();
    seedGovernance(repo);
    const { runner, calls } = recorder();
    const result = await save({
      repoRoot: repo,
      relpath: 'agents/danielzhang04.md',
      content: '---\nid: danielzhang04\nrole: work\nrunner-bound: false\n---\nforged\n',
      sessionToken: validToken(),
      sessionConfig: CONFIG,
      runGit: runner,
      openPr: noopPrOpener,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.reason).toMatch(/agent-id-collision/);
    }
    expect(calls).toHaveLength(0);
  });

  it('refuses a NEW agents/<id>.md colliding case-insensitively with a runtime worker identity (400)', async () => {
    const repo = await scratch();
    seedGovernance(repo);
    const { runner, calls } = recorder();
    const result = await save({
      repoRoot: repo,
      relpath: 'agents/Codex-Worker.md',
      content: '---\nid: Codex-Worker\n---\nforged\n',
      sessionToken: validToken(),
      sessionConfig: CONFIG,
      runGit: runner,
      openPr: noopPrOpener,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.reason).toMatch(/agent-id-collision/);
    }
    expect(calls).toHaveLength(0);
  });

  it('allows a FRESH non-colliding agents/<id>.md (durable, PR opened, file written)', async () => {
    const repo = await scratch();
    seedGovernance(repo);
    const { runner: runGit } = recorder();
    const prRequests: unknown[] = [];
    const openPr: PrOpener = (_repoRoot, req) => {
      prRequests.push(req);
    };
    const result = await save({
      repoRoot: repo,
      relpath: 'agents/research-worker.md',
      content: '---\nid: research-worker\nrole: work\nrunner-bound: false\n---\nnotes\n',
      sessionToken: validToken(),
      sessionConfig: CONFIG,
      runGit,
      openPr,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.target).toBe('durable');
    expect(prRequests).toHaveLength(1);
    expect(readFileSync(join(repo, 'agents', 'research-worker.md'), 'utf-8')).toContain('research-worker');
  });

  // HIGH (Finding 1): the edit-exemption bypass. The guard must refuse a reserved-id collision that is
  // NEWLY INTRODUCED by an edit, not just on file creation. Two-step forge: create a benign agents/foo.md
  // (id:foo passes — foo is not reserved), then EDIT it to a reserved runtime/human identity. The second
  // write must be refused 400 with no git activity — this is the impersonation forge C7.6 exists to stop.
  it('refuses a two-step edit that newly introduces a reserved-id collision (Finding 1, 400, no write, no git)', async () => {
    const repo = await scratch();
    seedGovernance(repo);
    // Step 1: benign create — foo is not reserved, lands on disk.
    const create = await save({
      repoRoot: repo,
      relpath: 'agents/foo.md',
      content: '---\nid: foo\nrole: work\nrunner-bound: false\n---\nbenign\n',
      sessionToken: validToken(),
      sessionConfig: CONFIG,
      runGit: recorder().runner,
      openPr: noopPrOpener,
    });
    expect(create.ok).toBe(true);
    expect(readFileSync(join(repo, 'agents', 'foo.md'), 'utf-8')).toContain('id: foo');

    // Step 2: forge — edit the same file to a reserved runtime worker identity. Must be REFUSED.
    const { runner, calls } = recorder();
    const forgeRuntime = await save({
      repoRoot: repo,
      relpath: 'agents/foo.md',
      content: '---\nid: worker-desktop\nrole: work\n---\nforged\n',
      sessionToken: validToken(),
      sessionConfig: CONFIG,
      runGit: runner,
      openPr: noopPrOpener,
    });
    expect(forgeRuntime.ok).toBe(false);
    if (!forgeRuntime.ok) {
      expect(forgeRuntime.status).toBe(400);
      expect(forgeRuntime.reason).toMatch(/agent-id-collision/);
    }
    expect(calls).toHaveLength(0);
    // The forged reserved id never reached disk; the on-disk file still declares the benign id.
    expect(readFileSync(join(repo, 'agents', 'foo.md'), 'utf-8')).toContain('id: foo');

    // Same forge, this time onto a humans.yaml handle — also refused.
    const forgeHuman = await save({
      repoRoot: repo,
      relpath: 'agents/foo.md',
      content: '---\nid: danielzhang04\n---\nforged\n',
      sessionToken: validToken(),
      sessionConfig: CONFIG,
      runGit: recorder().runner,
      openPr: noopPrOpener,
    });
    expect(forgeHuman.ok).toBe(false);
    if (!forgeHuman.ok) expect(forgeHuman.status).toBe(400);
  });

  // The corrected invariant's legitimate half: a real self-update that does NOT change the id still
  // succeeds (replacing the old test that canonized the vulnerable "any existing file is exempt" rule).
  it('allows a legitimate edit that does not change the (non-colliding) id', async () => {
    const repo = await scratch();
    seedGovernance(repo);
    mkdirSync(join(repo, 'agents'), { recursive: true });
    writeFileSync(join(repo, 'agents', 'foo.md'), '---\nid: foo\ndescription: old\n---\noriginal\n', 'utf-8');
    const { runner: runGit } = recorder();
    const result = await save({
      repoRoot: repo,
      relpath: 'agents/foo.md',
      content: '---\nid: foo\ndescription: new and improved\n---\nedited\n',
      sessionToken: validToken(),
      sessionConfig: CONFIG,
      runGit,
      openPr: noopPrOpener,
    });
    expect(result.ok).toBe(true);
  });

  // Grandfathering: a pre-existing agent file whose id ALREADY collides may still be edited (the reserved
  // id was not newly introduced by this write). Editing worker-desktop.md (id already worker-desktop) passes.
  it('still allows editing a pre-existing agent whose colliding id is unchanged (grandfathered)', async () => {
    const repo = await scratch();
    seedGovernance(repo);
    mkdirSync(join(repo, 'agents'), { recursive: true });
    writeFileSync(join(repo, 'agents', 'worker-desktop.md'), '---\nid: worker-desktop\n---\noriginal\n', 'utf-8');
    const { runner: runGit } = recorder();
    const result = await save({
      repoRoot: repo,
      relpath: 'agents/worker-desktop.md',
      content: '---\nid: worker-desktop\ndescription: still me\n---\nedited\n',
      sessionToken: validToken(),
      sessionConfig: CONFIG,
      runGit,
      openPr: noopPrOpener,
    });
    expect(result.ok).toBe(true);
  });

  it('does NOT affect a non-agents/ save whose filename matches a reserved identity', async () => {
    const repo = await scratch();
    seedGovernance(repo);
    const { runner: runGit } = recorder();
    const result = await save({
      repoRoot: repo,
      relpath: 'docs/notes/danielzhang04.md',
      content: 'plain notes, not an agent declaration',
      sessionToken: validToken(),
      sessionConfig: CONFIG,
      runGit,
      openPr: noopPrOpener,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.target).toBe('durable');
  });
});

describe('save — LOW (Finding 2): runner-bound is not client-settable on agents/*.md', () => {
  // The registry NEVER marks an agent runner-bound; only a human flips it true via a reviewed governance
  // action. A direct POST setting `runner-bound: true` on an agents/*.md file must be refused server-side
  // (no write, no git), while `false` / absent passes.
  it('refuses an agents/*.md save that sets runner-bound: true (400, no write, no git)', async () => {
    const repo = await scratch();
    const { runner, calls } = recorder();
    const result = await save({
      repoRoot: repo,
      relpath: 'agents/research-worker.md',
      content: '---\nid: research-worker\nrole: work\nrunner-bound: true\n---\nforged binding\n',
      sessionToken: validToken(),
      sessionConfig: CONFIG,
      runGit: runner,
      openPr: noopPrOpener,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.reason).toMatch(/runner-bound-not-permitted/);
    }
    expect(calls).toHaveLength(0);
    expect(existsSync(join(repo, 'agents', 'research-worker.md'))).toBe(false);
  });

  it('refuses runner-bound: true tolerant of quoting/whitespace/case on the value', async () => {
    const repo = await scratch();
    for (const line of ['runner-bound:   TRUE', 'runner-bound: "true"', "runner-bound: 'True'"]) {
      const { runner, calls } = recorder();
      const result = await save({
        repoRoot: repo,
        relpath: 'agents/x.md',
        content: `---\nid: x\n${line}\n---\nbody\n`,
        sessionToken: validToken(),
        sessionConfig: CONFIG,
        runGit: runner,
        openPr: noopPrOpener,
      });
      expect(result.ok, line).toBe(false);
      if (!result.ok) expect(result.status, line).toBe(400);
      expect(calls, line).toHaveLength(0);
    }
  });

  it('allows an agents/*.md save with runner-bound: false or absent', async () => {
    const repo = await scratch();
    const falseSave = await save({
      repoRoot: repo,
      relpath: 'agents/a-false.md',
      content: '---\nid: a-false\nrunner-bound: false\n---\nok\n',
      sessionToken: validToken(),
      sessionConfig: CONFIG,
      runGit: recorder().runner,
      openPr: noopPrOpener,
    });
    expect(falseSave.ok).toBe(true);

    const absentSave = await save({
      repoRoot: repo,
      relpath: 'agents/a-absent.md',
      content: '---\nid: a-absent\nrole: work\n---\nok\n',
      sessionToken: validToken(),
      sessionConfig: CONFIG,
      runGit: recorder().runner,
      openPr: noopPrOpener,
    });
    expect(absentSave.ok).toBe(true);
  });

  it('does NOT restrict runner-bound: true outside agents/*.md (e.g. a KB doc)', async () => {
    const repo = await scratch();
    const result = await save({
      repoRoot: repo,
      relpath: 'docs/notes.md',
      content: '---\nrunner-bound: true\n---\nplain doc, not an agent declaration\n',
      sessionToken: validToken(),
      sessionConfig: CONFIG,
      runGit: recorder().runner,
      openPr: noopPrOpener,
    });
    expect(result.ok).toBe(true);
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
