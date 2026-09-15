import { describe, expect, it } from 'vitest';
import { outputHref, projectEventOutputRefs, projectOutputRef } from './outputs.ts';
import type { OperationalEvent } from '../control/types.ts';

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

  it('binds the projection-time digest AND the projecting entity into a scoped, hash-verified download href', () => {
    const digested = projectOutputRef(
      { kind: 'repository-file', label: 'Brief', rootId: 'kb', path: 'orgs/kb-ops/output/brief.md' },
      { kb: 'orgs/kb-ops' },
      (path) => (path === 'orgs/kb-ops/output/brief.md' ? 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' : null),
      { type: 'workflow', id: 'research-brief' },
    );
    expect(digested).toEqual({
      kind: 'repository-file', label: 'Brief', path: 'orgs/kb-ops/output/brief.md',
      digest: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      entity: { type: 'workflow', id: 'research-brief' },
    });
    expect(outputHref(digested)).toBe('/api/control/files?path=orgs%2Fkb-ops%2Foutput%2Fbrief.md&sha256=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb&entityType=workflow&entityId=research-brief');
  });

  it('R5: an output projected WITHOUT an entity yields an href the download route cannot scope', () => {
    // The href is still well-formed, but it names no entity, so `outputRootsForEntity` has nothing to
    // resolve and the route 404s. Both UI surfaces refuse to render a link for such an output at all.
    const orphan = projectOutputRef(
      { kind: 'repository-file', label: 'Brief', rootId: 'kb', path: 'orgs/kb-ops/output/brief.md' },
      { kb: 'orgs/kb-ops' },
      () => 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    );
    expect(orphan).not.toHaveProperty('entity');
    expect(outputHref(orphan)).not.toContain('entityType');
  });

  it('R5: every event-projected output carries the entity whose projection minted it', () => {
    const projected = projectEventOutputRefs(
      [{
        cursor: 1, runRef: 'run-1', kind: 'file', source: 'worker', stageRef: null, attemptRef: null, sessionRef: null,
        status: 'success', summary: null, command: null, toolName: null, path: 'orgs/kb-ops/output/brief.md',
        diff: null, checkpoint: null, createdAt: '2026-08-21T00:00:00.000Z',
      }],
      { kb: 'orgs/kb-ops' },
      undefined,
      { type: 'agent', id: 'researcher' },
    );
    expect(projected).toEqual([{ kind: 'repository-file', label: 'brief.md', path: 'orgs/kb-ops/output/brief.md', entity: { type: 'agent', id: 'researcher' } }]);
  });

  it('drops a malformed digest and links without one rather than shipping an unverifiable sha256', () => {
    const output = projectOutputRef(
      { kind: 'repository-file', label: 'Brief', rootId: 'kb', path: 'orgs/kb-ops/output/brief.md' },
      { kb: 'orgs/kb-ops' },
      () => 'NOT-A-DIGEST',
    );
    expect(output).toEqual({ kind: 'repository-file', label: 'Brief', path: 'orgs/kb-ops/output/brief.md' });
    expect(outputHref(output)).toBe('/api/control/files?path=orgs%2Fkb-ops%2Foutput%2Fbrief.md');
  });

  it('never offers the digest reader a path the roots map already refused', () => {
    const offered: string[] = [];
    projectEventOutputRefs(
      [{
        cursor: 1, runRef: 'run-1', kind: 'file', source: 'worker', stageRef: null, attemptRef: null, sessionRef: null,
        status: 'success', summary: null, command: null, toolName: null, path: '../secret', diff: null, checkpoint: null,
        createdAt: '2026-08-21T00:00:00.000Z',
      }],
      { kb: 'orgs/kb-ops' },
      (path) => { offered.push(path); return null; },
    );
    expect(offered).toEqual([]);
  });

  it('rejects an unmapped symbolic root as an unsafe output path', () => {
    expect(() => projectOutputRef(
      { kind: 'repository-file', label: 'Brief', rootId: 'missing-root', path: 'orgs/kb-ops/output/brief.md' },
      { kb: 'orgs/kb-ops' },
    )).toThrow('unsafe-output-path');
  });

  it('projects and deduplicates only safe file-bearing operational events', () => {
    const event = (cursor: number, kind: OperationalEvent['kind'], path: string | null): OperationalEvent => ({
      cursor, runRef: 'run-1', kind, source: 'worker', stageRef: null, attemptRef: null, sessionRef: null,
      status: 'success', summary: null, command: null, toolName: null, path, diff: null, checkpoint: null, createdAt: '2026-08-21T00:00:00.000Z',
    });
    expect(projectEventOutputRefs([
      event(1, 'file', 'orgs/kb-ops/output/brief.md'), event(2, 'diff', 'orgs/kb-ops/output/brief.md'),
      event(3, 'file', '../secret'), event(4, 'tool', 'orgs/kb-ops/output/not-a-file.md'),
    ], { kb: 'orgs/kb-ops' })).toEqual([{ kind: 'repository-file', label: 'brief.md', path: 'orgs/kb-ops/output/brief.md' }]);
  });
});
