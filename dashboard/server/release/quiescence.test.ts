import { describe, expect, it } from 'vitest';
import { quiescence } from './quiescence.ts';

describe('quiescence', () => {
  it('is quiescent only when every side-effecting resource is idle', () => {
    expect(quiescence({ executionState: 'locked', bridgeStopped: true, queuedWork: 0, activeWorkers: 0, activeGit: 0, activePty: 0, activeComposer: 0, serviceCgroupChildren: 0 }))
      .toEqual({ ok: true, quiescent: true, blockers: [] });
    expect(quiescence({ executionState: 'locking', bridgeStopped: false, queuedWork: 2, activeWorkers: 1, activeGit: 0, activePty: 0, activeComposer: 0, serviceCgroupChildren: 1 }).blockers)
      .toEqual(['execution-locking', 'queue-bridge-running', 'work-queued', 'workers-active', 'service-cgroup-active']);
  });
});
