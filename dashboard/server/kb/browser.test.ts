import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileHistory, listTree, readFile, PathEscapeError, resolveWithinAllowedRoot } from './browser.ts';

const REPO_A = fileURLToPath(new URL('../__fixtures__/repo-a/', import.meta.url));

/**
 * Build a tiny REAL git repo in a temp dir so `fileHistory` exercises a genuine
 * `git log --follow` end-to-end while staying hermetic (self-contained, disposable,
 * global config / hooks / gpg neutralised). This is the "tiny real git repo created
 * by the test setup" allowed by the task.
 */
function makeGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kb-gitrepo-'));
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
  };
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=', ...args], {
      cwd: dir,
      env,
      encoding: 'utf-8',
    });
  git('init', '-q');
  mkdirSync(join(dir, 'docs'));
  writeFileSync(join(dir, 'docs', 'note.md'), '# v1\n');
  git('add', '.');
  git('commit', '-q', '-m', 'add note');
  writeFileSync(join(dir, 'docs', 'note.md'), '# v1\n\nmore\n');
  git('add', '.');
  git('commit', '-q', '-m', 'extend note');
  return dir;
}

let gitRepo: string;
beforeAll(() => {
  gitRepo = makeGitRepo();
});
afterAll(() => {
  // temp dirs are OS-reaped; nothing to persist.
});

describe('listTree', () => {
  it('lists tree under a subpath and refuses to escape repoRoot', () => {
    const tree = listTree(REPO_A, 'queue');
    const names = tree.entries.map((e) => e.name);
    expect(names).toContain('inbox');
    expect(tree.entries.find((e) => e.name === 'inbox')?.type).toBe('dir');

    // path-traversal guard: a `../../etc`-style relpath is rejected.
    expect(() => listTree(REPO_A, '../../etc')).toThrow(PathEscapeError);
  });

  it('rejects an absolute-path escape', () => {
    // Absolute paths (POSIX `/etc/passwd` and Windows `C:\Windows`) must be rejected
    // regardless of platform — they are never confined to repoRoot.
    expect(() => listTree(REPO_A, '/etc/passwd')).toThrow(PathEscapeError);
    expect(() => listTree(REPO_A, 'C:\\Windows\\System32')).toThrow(PathEscapeError);
  });
});

describe('readFile', () => {
  it('reads a tracked file confined to repoRoot', () => {
    const text = readFile(REPO_A, 'queue/inbox/card-inbox.md');
    expect(text).toContain('## Work order');
  });

  it('refuses a path outside the repo root', () => {
    expect(() => readFile(REPO_A, '../../../etc/passwd')).toThrow(PathEscapeError);
    expect(() => readFile(REPO_A, '/etc/passwd')).toThrow(PathEscapeError);
  });

  it.each(['CLAUDE.md', '.git/config', 'dashboard/server/index.ts', 'scripts/cards.py'])('refuses non-data path %s', (relpath) => {
    const root = mkdtempSync(join(tmpdir(), 'kb-read-roots-'));
    const file = join(root, ...relpath.split('/'));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, 'not browser data', 'utf8');
    expect(() => readFile(root, relpath)).toThrow(/approved KB read root/);
  });

  it('refuses an approved-root prefix that traverses into a platform path', () => {
    const root = mkdtempSync(join(tmpdir(), 'kb-read-prefix-'));
    const file = join(root, 'dashboard', 'server', 'index.ts');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, 'not browser data', 'utf8');
    expect(() => readFile(root, 'docs/../dashboard/server/index.ts')).toThrow(/approved KB read root/);
  });

  it.each(['docs/note.md', 'orgs/demo/STATE.md', 'queue/inbox/card.md', 'memory/agent.md'])('allows approved data path %s', (relpath) => {
    expect(() => resolveWithinAllowedRoot(REPO_A, relpath)).not.toThrow();
  });

  it.each([
    'orgs/demo/.git/config',
    'orgs/demo/node_modules/pkg/index.js',
    'orgs/demo/dist/bundle.js',
    'orgs/demo/.GIT/config',
  ])('refuses hidden platform directory inside an approved root: %s', (relpath) => {
    expect(() => resolveWithinAllowedRoot(REPO_A, relpath)).toThrow(/refused directory component/);
  });

  it.each(['approved-root', 'intermediate', 'final-file'])('rejects a symlink at the %s component', (position) => {
    const root = mkdtempSync(join(tmpdir(), 'kb-read-link-'));
    const outside = mkdtempSync(join(tmpdir(), 'kb-read-outside-'));
    writeFileSync(join(outside, 'secret.md'), 'secret', 'utf8');
    if (position === 'approved-root') symlinkSync(outside, join(root, 'docs'), process.platform === 'win32' ? 'junction' : 'dir');
    else if (position === 'intermediate') { mkdirSync(join(root, 'docs')); symlinkSync(outside, join(root, 'docs', 'linked'), process.platform === 'win32' ? 'junction' : 'dir'); }
    else { mkdirSync(join(root, 'docs')); symlinkSync(outside, join(root, 'docs', 'note.md'), process.platform === 'win32' ? 'junction' : 'dir'); }
    const relpath = position === 'approved-root' ? 'docs/secret.md' : position === 'intermediate' ? 'docs/linked/secret.md' : 'docs/note.md';
    expect(() => resolveWithinAllowedRoot(root, relpath)).toThrow(/symlink component/);
  });
});

describe('fileHistory', () => {
  it('returns commits for a tracked file via git log --follow (real fixture repo)', () => {
    const commits = fileHistory(gitRepo, 'docs/note.md');
    expect(commits).toHaveLength(2);
    expect(commits[0].subject).toBe('extend note'); // newest first
    expect(commits[1].subject).toBe('add note');
    expect(commits[0].hash).toMatch(/^[0-9a-f]{40}$/);
    expect(commits[0].author).toBe('Test');
    expect(commits[0].date).toBeTruthy();
  });

  it('confines the path before shelling git (traversal rejected)', () => {
    expect(() => fileHistory(gitRepo, '../../etc/passwd')).toThrow(PathEscapeError);
  });

  it('canonicalizes the confined path before passing it to the injectable git runner', () => {
    const calls: Array<{ repoRoot: string; args: string[] }> = [];
    const fakeRunner = (repoRoot: string, args: string[]): string => {
      calls.push({ repoRoot, args });
      return ['deadbeef\tAlice\tMon\tmocked subject'].join('\n');
    };
    const commits = fileHistory(REPO_A, './queue//inbox/card-inbox.md', fakeRunner);
    expect(commits).toEqual([
      { hash: 'deadbeef', author: 'Alice', date: 'Mon', subject: 'mocked subject' },
    ]);
    // proves the injected runner received a `git log --follow` invocation, confined path last.
    expect(calls[0].args[0]).toBe('log');
    expect(calls[0].args).toContain('--follow');
    expect(calls[0].args[calls[0].args.length - 1]).toBe('queue/inbox/card-inbox.md');
  });

  it.runIf(process.platform === 'win32')('canonicalizes Windows separators before passing a path to git', () => {
    const calls: string[][] = [];
    fileHistory(REPO_A, 'queue\\inbox\\card-inbox.md', (_repoRoot, args) => {
      calls.push(args);
      return '';
    });
    expect(calls[0].at(-1)).toBe('queue/inbox/card-inbox.md');
  });
});
