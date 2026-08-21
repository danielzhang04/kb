import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { projectRunAttention } from './attention.ts';
import type { RunnableRef } from './p2Contracts.ts';

const here = dirname(fileURLToPath(import.meta.url));
const agent = (id: string): RunnableRef => ({ type: 'agent', id, sourcePath: `agents/${id}.md` });
const workflow = (id: string, project = 'kb-ops'): RunnableRef => ({ type: 'workflow', id, project, sourcePath: `orgs/${project}/workflows/${id}.md` });

describe('projectRunAttention', () => {
  it('counts distinct runs once when two gates are open on one run', () => {
    const result = projectRunAttention({
      runs: [{ runRef: 'run-a', owner: agent('alpha'), lifecycle: 'running' }],
      humanRequests: [
        { requestRef: 'ask-1', runRef: 'run-a', state: 'open' },
        { requestRef: 'ask-2', runRef: 'run-a', state: 'open' },
      ],
    });
    expect(result.pairs).toEqual([{ runRef: 'run-a', owner: agent('alpha') }]);
    expect(result.agents).toEqual({ alpha: 1 });
  });

  it('includes a request-less waiting run and concurrent noun owners', () => {
    const result = projectRunAttention({
      runs: [
        { runRef: 'run-b', owner: workflow('release'), lifecycle: 'waiting-human' },
        { runRef: 'run-a', owner: agent('alpha'), lifecycle: 'running' },
      ],
      humanRequests: [{ requestRef: 'ask-1', runRef: 'run-a', state: 'open' }],
    });
    expect(result.pairs).toEqual([
      { runRef: 'run-a', owner: agent('alpha') },
      { runRef: 'run-b', owner: workflow('release') },
    ]);
    expect(result.agents).toEqual({ alpha: 1 });
    expect(result.workflows).toEqual({ 'workflow:kb-ops:release': 1 });
    expect(result.revision).toMatch(/^[a-f0-9]{64}$/);
  });

  it('matches the run-attention golden and qualifies same-id workflows by project', () => {
    const fixture = JSON.parse(readFileSync(resolve(here, '__fixtures__', 'dv3', 'run-attention.json'), 'utf8')) as {
      snapshot: Parameters<typeof projectRunAttention>[0];
      expected: ReturnType<typeof projectRunAttention>;
    };
    const result = projectRunAttention(fixture.snapshot);
    expect(result).toEqual(fixture.expected);
    expect(result.workflows).toEqual({
      'workflow:atlas-prep:release': 1,
      'workflow:kb-ops:release': 1,
    });
  });

  it('fails closed when one run is presented with conflicting immutable owners', () => {
    expect(() => projectRunAttention({
      runs: [
        { runRef: 'run-a', owner: agent('alpha'), lifecycle: 'waiting-human' },
        { runRef: 'run-a', owner: workflow('release'), lifecycle: 'waiting-human' },
      ],
      humanRequests: [],
    })).toThrow(/conflicting immutable owners/);
  });
});
