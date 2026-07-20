/**
 * Containment and provenance guards for the org-definition loader.
 *
 * `loadOrgDef` joins a caller-supplied path against this worktree AND every sibling worktree git
 * reports (~24 roots at differing depths on this machine), so one `../` payload gets many anchors.
 * Before these tests it was an arbitrary host file read: `loadOrgDef('../../../.gitconfig')` returned
 * the user's git config, and `loadOrgDef('../../../../Windows/win.ini')` returned win.ini. Only the
 * single hardcoded caller kept it safe. These tests pin the refusal instead of relying on that.
 */
import { existsSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  OrgDefNotFoundError,
  OrgDefPathError,
  assertRepoRelativePath,
  loadOrgDef,
  resolveContainedPath,
} from './orgDefSource.ts';

const temps: string[] = [];
afterAll(() => {
  while (temps.length > 0) rmSync(temps.pop() as string, { recursive: true, force: true });
});

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kb-orgdef-'));
  temps.push(dir);
  return dir;
}

describe('loadOrgDef path containment', () => {
  it.each([
    ['parent traversal', '../../../.gitconfig'],
    ['deep traversal to a host file', '../../../../Windows/win.ini'],
    ['traversal that re-enters', 'orgs/../../kb/_index.md'],
    ['single-dot segment', 'orgs/./_index.md'],
    ['posix absolute', '/etc/passwd'],
    ['drive-qualified', 'C:/Windows/win.ini'],
    ['backslash-separated drive path', 'C:\\Windows\\win.ini'],
    ['UNC path', '\\\\host\\share\\secret.md'],
    ['backslash separator', 'orgs\\faceless-youtube\\workflows\\video-run.md'],
    ['empty', ''],
    ['trailing separator', 'orgs/faceless-youtube/'],
    ['double separator', 'orgs//video-run.md'],
    ['leading separator', '/orgs/video-run.md'],
    ['whitespace in a segment', 'orgs/video run.md'],
    ['glob metacharacter', 'orgs/*/workflows/video-run.md'],
  ])('refuses %s', (_label, relPath) => {
    expect(() => loadOrgDef(relPath)).toThrow(OrgDefPathError);
  });

  it('refuses a newline payload, which is also the revision-spec injection vector', () => {
    // The deleted git-object tier interpolated relPath into `git cat-file --batch-check` stdin as
    // `<ref>:<relPath>`, so a newline injected extra specs and desynchronized the positional
    // lines[i] <-> refs[i] pairing: `loadOrgDef('nope/a.md\nHEAD:_index.md')` returned _index.md's
    // bytes while reporting `git:refs/heads/approval/6a5958cf-f01e6715` as their origin. That tier is
    // gone, so there is no stdin to inject into; validation closes the vector a second time.
    expect(() => loadOrgDef('nope/a.md\nHEAD:_index.md')).toThrow(OrgDefPathError);
    expect(() => loadOrgDef('a.md\r\nHEAD:_index.md')).toThrow(OrgDefPathError);
  });

  it('names the offending path and the reason in the refusal', () => {
    expect(() => loadOrgDef('../../../.gitconfig')).toThrow(/\.\./);
    expect(() => loadOrgDef('../../../.gitconfig')).toThrow(/Refusing to load workflow definition/);
  });

  it('accepts a plain repo-relative path shape', () => {
    expect(() => assertRepoRelativePath('orgs/faceless-youtube/workflows/video-run.md')).not.toThrow();
    expect(() => assertRepoRelativePath('_index.md')).not.toThrow();
    expect(() => assertRepoRelativePath('a/b-c/d_e.f.md')).not.toThrow();
  });

  it('fails loudly, not silently, when a well-formed path exists in no working tree', () => {
    expect(() => loadOrgDef('orgs/no-such-org/workflows/no-such-def.md')).toThrow(OrgDefNotFoundError);
    // The error must enumerate what it searched, so a broken checkout is diagnosable.
    expect(() => loadOrgDef('orgs/no-such-org/workflows/no-such-def.md')).toThrow(/worktree-local:/);
  });

  it('reports a live working-tree file as the origin, never a git ref', () => {
    // The deleted tier-3 searched every ref alphabetically and reported `git:<ref>` as the origin, so
    // a definition deleted at HEAD still resolved out of some stale approval branch. Every successful
    // resolution must now name a real file in a working tree.
    const source = loadOrgDef('_index.md');
    expect(['worktree-local', 'worktree-sibling']).toContain(source.via);
    expect(source.origin).not.toMatch(/^git:/);
    expect(existsSync(source.origin)).toBe(true);
  });
});

describe('resolveContainedPath', () => {
  it('resolves a file that really lives under the root', () => {
    const root = tempRoot();
    mkdirSync(join(root, 'orgs'));
    writeFileSync(join(root, 'orgs', 'def.md'), 'x');
    expect(resolveContainedPath(root, 'orgs/def.md')).toBe(join(root, 'orgs', 'def.md'));
  });

  it('returns null for a lexical escape even when the target exists', () => {
    const root = tempRoot();
    writeFileSync(join(root, 'outside.md'), 'x');
    const inner = join(root, 'inner');
    mkdirSync(inner);
    expect(resolveContainedPath(inner, '../outside.md')).toBeNull();
  });

  it('returns null for a symlink inside the root that points outside it', () => {
    // The regex cannot see this one: every segment is innocent. Only the post-resolution realpath
    // check catches it, which is why both layers exist.
    const root = tempRoot();
    const outside = tempRoot();
    writeFileSync(join(outside, 'secret.md'), 'secret');
    let linked = false;
    try {
      symlinkSync(join(outside, 'secret.md'), join(root, 'escape.md'), 'file');
      linked = true;
    } catch {
      // Windows requires Developer Mode or elevation to create symlinks; the guard is still compiled
      // and exercised by the lexical cases above.
    }
    if (!linked) return;
    expect(resolveContainedPath(root, 'escape.md')).toBeNull();
  });

  it('resolves a symlink that stays inside the root', () => {
    const root = tempRoot();
    writeFileSync(join(root, 'real.md'), 'ok');
    let linked = false;
    try {
      symlinkSync(join(root, 'real.md'), join(root, 'alias.md'), 'file');
      linked = true;
    } catch {
      // see above
    }
    if (!linked) return;
    expect(resolveContainedPath(root, 'alias.md')).toBe(join(root, 'alias.md'));
  });

  it('returns null for a path that does not exist', () => {
    expect(resolveContainedPath(tempRoot(), 'nope.md')).toBeNull();
  });
});
