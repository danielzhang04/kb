import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assertCoordinationRoot, parseGitHubRemote, RepositoryPinError, resolveRepositoryPin } from './repoPin.ts';

interface ContractVectors {
  readonly repoPin: {
    readonly accept: readonly { readonly url: string; readonly owner: string; readonly repo: string }[];
    readonly refuse: readonly { readonly url: string; readonly reason: string }[];
  };
}
const vectors = JSON.parse(readFileSync(
  new URL('../../../tests/fixtures/dashboard-v3-p4-contract-vectors.json', import.meta.url),
  'utf8',
)) as ContractVectors;

const ROOT = process.platform === 'win32' ? 'C:\\Users\\danie\\kb-worktrees\\dashboard-ops' : '/var/lib/kb/ops';

describe('composition-time repository pin [P4-C35, P4-C40]', () => {
  for (const vector of vectors.repoPin.accept) {
    it(`parses ${vector.url}`, () => {
      expect(parseGitHubRemote(vector.url)).toEqual({ owner: vector.owner, repo: vector.repo });
      expect(resolveRepositoryPin(ROOT, () => `${vector.url}\n`)).toEqual({ owner: vector.owner, repo: vector.repo });
    });
  }

  for (const vector of vectors.repoPin.refuse) {
    it(`refuses ${JSON.stringify(vector.url)} as ${vector.reason}`, () => {
      expect(() => parseGitHubRemote(vector.url)).toThrow(RepositoryPinError);
      expect(() => resolveRepositoryPin(ROOT, () => vector.url)).toThrow(RepositoryPinError);
    });
  }

  it('refuses a repository with no origin remote', () => {
    expect(() => resolveRepositoryPin(ROOT, () => '')).toThrow(/missing/);
    expect(() => resolveRepositoryPin(ROOT, () => {
      throw new Error("fatal: No such remote 'origin'");
    })).toThrow(/missing/);
  });

  it('refuses two origin urls as ambiguous', () => {
    expect(() => resolveRepositoryPin(ROOT, () => 'https://github.com/danielzt/kb.git\ngit@github.com:other/kb.git\n'))
      .toThrow(/ambiguous/);
  });

  it('refuses a relative or absent coordination root before reading any remote', () => {
    let reads = 0;
    const reader = (): string => {
      reads += 1;
      return 'https://github.com/danielzt/kb.git';
    };
    expect(() => resolveRepositoryPin('kb-worktrees/dashboard-ops', reader)).toThrow(RepositoryPinError);
    expect(() => resolveRepositoryPin('', reader)).toThrow(RepositoryPinError);
    expect(reads).toBe(0);
  });

  it('reads the remote exactly once per resolution', () => {
    let reads = 0;
    const pin = resolveRepositoryPin(ROOT, () => {
      reads += 1;
      return 'https://github.com/danielzt/kb.git';
    });
    expect(pin).toEqual({ owner: 'danielzt', repo: 'kb' });
    expect(reads).toBe(1);
  });
});

describe('coordination root composition check [P4-C39]', () => {
  it('requires an absolute root that contains queue/', () => {
    const seen: string[] = [];
    const probe = (path: string): boolean => {
      seen.push(path);
      return true;
    };
    expect(assertCoordinationRoot(ROOT, probe)).toBe(ROOT);
    expect(seen).toEqual([`${ROOT}${process.platform === 'win32' ? '\\' : '/'}queue`]);
  });

  it('refuses a relative root and a root with no queue/ directory', () => {
    expect(() => assertCoordinationRoot('ops', () => true)).toThrow(RepositoryPinError);
    expect(() => assertCoordinationRoot('', () => true)).toThrow(RepositoryPinError);
    expect(() => assertCoordinationRoot(ROOT, () => false)).toThrow(/queue/);
  });
});
