import { describe, expect, it } from 'vitest';
import {
  RUN_LIFECYCLE_KINDS, RUN_LIFECYCLE_SEMANTICS,
  canQuarantineRun, canTransitionRun, crashNormalizedLifecycle, isTerminalRun,
  lifecycleForKind, projectRunState,
} from './runLifecycle.ts';

const TEST_DEPLOY_PAUSE = {
  deploymentRef:'deploy-1', pausedAt:'2026-08-20T00:00:00.000Z', priorKind:'running',
  resumeStreak:0, lastResumeAttemptCursor:null, resumeClaim:null,
} as const;

describe('RunLifecycle exhaustiveness', () => {
  it('has exactly one semantics row for every lifecycle kind', () => {
    expect(Object.keys(RUN_LIFECYCLE_SEMANTICS).sort())
      .toEqual([...RUN_LIFECYCLE_KINDS].sort());
  });

  it.each(RUN_LIFECYCLE_KINDS)('handles %s in every predicate and projection', (kind) => {
    const lifecycle = lifecycleForKind(kind, kind === 'paused-for-deploy' ? TEST_DEPLOY_PAUSE : null);
    expect(projectRunState(lifecycle)).toBe(kind);
    expect(typeof isTerminalRun(lifecycle)).toBe('boolean');
    expect(typeof canQuarantineRun(lifecycle)).toBe('boolean');
    expect(RUN_LIFECYCLE_KINDS).toContain(crashNormalizedLifecycle(lifecycle, false).kind);
    expect(RUN_LIFECYCLE_KINDS).toContain(crashNormalizedLifecycle(lifecycle, true).kind);
    for (const target of RUN_LIFECYCLE_KINDS) {
      expect(typeof canTransitionRun(lifecycle, target)).toBe('boolean');
    }
  });
});
