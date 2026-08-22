import { describe, expect, it } from 'vitest';
import { validateTrustedLaunchIdentity } from './launch.ts';

describe('trusted launch identity', () => {
  it('accepts a closed server-resolved owner and boot host', () => {
    expect(validateTrustedLaunchIdentity({
      owner: { type: 'workflow', id: 'video-run', project: 'faceless-youtube', sourcePath: 'orgs/faceless-youtube/workflows/video-run.md' },
      executionHost: 'vm',
    })).toEqual({ ok: true, value: {
      owner: { type: 'workflow', id: 'video-run', project: 'faceless-youtube', sourcePath: 'orgs/faceless-youtube/workflows/video-run.md' },
      executionHost: 'vm',
    } });
  });

  it('refuses absent, forged, or extra identity before createRun', () => {
    expect(validateTrustedLaunchIdentity(null)).toEqual({ ok: false, code: 'runnable-owner-required' });
    expect(validateTrustedLaunchIdentity({ owner: { type: 'agent', id: 'grader', sourcePath: '../grader.md' }, executionHost: 'vm' }))
      .toEqual({ ok: false, code: 'runnable-owner-required' });
    expect(validateTrustedLaunchIdentity({ owner: { type: 'agent', id: 'grader', sourcePath: 'agents/grader.md' }, executionHost: 'vm', path: 'C:/tmp' }))
      .toEqual({ ok: false, code: 'runnable-owner-required' });
  });
});
