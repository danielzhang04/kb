import { describe, expect, it } from 'vitest';
import { outputHref, projectOutputRef } from './outputs.ts';

describe('output projectors', () => {
  it('projects only catalog-rooted files and pinned PRs', () => {
    expect(projectOutputRef({ kind: 'repository-file', label: 'Brief', rootId: 'kb', path: 'orgs/kb-ops/output/brief.md' }, { kb: 'orgs/kb-ops' }))
      .toEqual({ kind: 'repository-file', label: 'Brief', path: 'orgs/kb-ops/output/brief.md' });
    const pr = projectOutputRef({ kind: 'external-pr', label: 'Review', owner: 'openai', repository: 'kb', number: 42 }, {});
    expect(pr).toEqual({ kind: 'external-pr', label: 'Review', owner: 'openai', repository: 'kb', number: 42 });
    expect(outputHref(pr)).toBe('https://github.com/openai/kb/pull/42');
  });

  it('refuses traversal, absolute paths, unsafe links, and unpinned PR fields', () => {
    expect(() => projectOutputRef({ kind: 'artifact', label: 'Bad', rootId: 'kb', path: '../secret' }, { kb: 'orgs/kb-ops' })).toThrow('unsafe-output-path');
    expect(() => projectOutputRef({ kind: 'repository-file', label: 'Bad', rootId: 'kb', path: 'C:/secret' }, { kb: 'orgs/kb-ops' })).toThrow('unsafe-output-path');
    expect(() => projectOutputRef({ kind: 'external-pr', label: 'Bad', owner: 'openai/kb', repository: 'kb', number: 0 }, {})).toThrow('unsafe-pr');
  });

  it('rejects an unmapped symbolic root as an unsafe output path', () => {
    expect(() => projectOutputRef(
      { kind: 'repository-file', label: 'Brief', rootId: 'missing-root', path: 'orgs/kb-ops/output/brief.md' },
      { kb: 'orgs/kb-ops' },
    )).toThrow('unsafe-output-path');
  });
});
