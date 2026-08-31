import { describe, expect, it } from 'vitest';
import { quiescence } from './quiescence.ts';

describe('quiescence', () => {
  it('is quiescent only when every side-effecting resource is idle', () => {
    expect(quiescence({ executionState: 'locked', bridgeStopped: true, queuedWork: 0, activeWorkers: 0, activeGit: 0, activePty: 0, activeComposer: 0, serviceCgroupChildren: 0 }))
      .toEqual({ ok: true, quiescent: true, blockers: [] });
    expect(quiescence({ executionState: 'locking', bridgeStopped: false, queuedWork: 2, activeWorkers: 1, activeGit: 0, activePty: 0, activeComposer: 0, serviceCgroupChildren: 1 }).blockers)
      .toEqual(['execution-locking', 'queue-bridge-running', 'work-queued', 'workers-active', 'service-cgroup-active']);
  });

  // [P5-C48] regression lock: `release/quiescence.ts` is a SHIPPED module whose only consumers
  // (`http/surface.ts:57,247`, `http/context.ts:54,83`) belong to W6.1. P5 W5 must not change its
  // signature or return shape — this pins the exact `{ ok: true; quiescent: boolean; blockers: string[] }`
  // envelope and the one live blocker P5's close-ptys-and-continue action cares about, `pty-active`.
  it('[P5-C48] keeps the shipped signature and return shape untouched, including the live-pty blocker', () => {
    const snapshot = { executionState: 'locked' as const, bridgeStopped: true, queuedWork: 0, activeWorkers: 0, activeGit: 0, activePty: 2, activeComposer: 0, serviceCgroupChildren: 0 };
    const result = quiescence(snapshot);

    expect(Object.keys(result).sort()).toEqual(['blockers', 'ok', 'quiescent']);
    expect(result).toEqual({ ok: true, quiescent: false, blockers: ['pty-active'] });
    expect(quiescence).toHaveLength(1);
  });
});
