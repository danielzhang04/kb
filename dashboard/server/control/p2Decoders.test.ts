import { describe, expect, it } from 'vitest';
import { decodeRunIdentityFields, decodeRunnableRef } from './p2Decoders.ts';

describe('P2 closed-shape runtime decoders', () => {
  it('accepts only server-shaped Agent and Workflow references', () => {
    expect(decodeRunnableRef({ type: 'agent', id: 'grader', sourcePath: 'agents/grader.md' }))
      .toEqual({ type: 'agent', id: 'grader', sourcePath: 'agents/grader.md' });
    expect(decodeRunnableRef({
      type: 'workflow', id: 'video-run', project: 'faceless-youtube',
      sourcePath: 'orgs/faceless-youtube/workflows/video-run.md',
    })).toEqual({
      type: 'workflow', id: 'video-run', project: 'faceless-youtube',
      sourcePath: 'orgs/faceless-youtube/workflows/video-run.md',
    });
    expect(decodeRunnableRef({ type: 'agent', id: 'grader', sourcePath: '../grader.md' })).toBeNull();
    expect(decodeRunnableRef({ type: 'agent', id: 'grader', sourcePath: 'agents/grader.md', host: 'vm' })).toBeNull();
  });

  it('rejects missing, malformed, and extra run identity fields', () => {
    const valid = {
      owner: { type: 'agent', id: 'grader', sourcePath: 'agents/grader.md' },
      executionHost: 'vm', terminalOutcome: null, completedAt: null, archivedFrom: null,
    };
    expect(decodeRunIdentityFields(valid)).toEqual(valid);
    expect(decodeRunIdentityFields({ ...valid, executionHost: 'browser' })).toBeNull();
    expect(decodeRunIdentityFields({ ...valid, terminalOutcome: 'ok', completedAt: null })).toBeNull();
    expect(decodeRunIdentityFields({ ...valid, sourcePath: 'agents/forged.md' })).toBeNull();
  });
});
