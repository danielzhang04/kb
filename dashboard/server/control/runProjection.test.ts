import { describe, expect, it } from 'vitest';
import { projectGateCounts, projectRunActivity, projectRunStatus, type ProjectableRun } from './runProjection.ts';
import { RUN_LIFECYCLE_KINDS } from './runLifecycle.ts';

const owner = { type: 'agent' as const, id: 'fyt-runner', sourcePath: 'agents/fyt-runner.md' as const };
function run(overrides: Partial<ProjectableRun> = {}): ProjectableRun {
  return {
    runRef: 'run-1', title: 'Run one', owner, lifecycle: 'running', createdAt: '2026-08-20T09:00:00.000Z',
    updatedAt: '2026-08-20T09:30:00.000Z', terminalOutcome: null, completedAt: null, archivedFrom: null,
    openHumanRequestCount: 0, events: [], ...overrides,
  };
}

describe('run projections', () => {
  it('exhaustively classifies lifecycles and produces elapsed/tool/result rows', () => {
    expect(projectRunActivity(run({ events: [{ kind: 'tool', summary: 'checked lint', createdAt: '2026-08-20T09:30:00.000Z' }] }), '2026-08-20T10:00:00.000Z')).toMatchObject({ category: 'active', elapsedMs: 3_600_000, toolsCalled: 1, lastLine: 'checked lint' });
    expect(projectRunActivity(run({ lifecycle: 'waiting-human' }), iso()).category).toBe('attention');
    expect(projectRunActivity(run({ lifecycle: 'interrupted', terminalOutcome: 'interrupted', completedAt: '2026-08-20T09:30:00.000Z' }), iso()).category).toBe('failed');
    expect(projectRunActivity(run({ lifecycle: 'archived', terminalOutcome: 'ok', completedAt: '2026-08-20T09:30:00.000Z' }), iso()).category).toBe('completed');
    expect(Object.fromEntries(RUN_LIFECYCLE_KINDS.map((lifecycle) => [lifecycle, projectRunActivity(run({ lifecycle }), iso()).category]))).toEqual({
      planned: 'active', recovering: 'active', running: 'active', 'waiting-human': 'attention', stopping: 'active',
      succeeded: 'completed', failed: 'completed', stopped: 'completed', interrupted: 'failed', archived: 'completed', 'paused-for-deploy': 'active',
    });
  });

  it('projects PTY and transcript stream identity from the run source', () => {
    expect(projectRunActivity(run({ source: { kind: 'pty', sessionId: 'pty-123' } }), iso()).row).toMatchObject({
      streamKind: 'pty', sessionId: 'pty-123',
    });
    const transcript = projectRunActivity(run(), iso()).row;
    expect(transcript.streamKind).toBe('transcript');
    expect('sessionId' in transcript).toBe(false);
  });

  it('uses needs-you, running, failed, scheduled, idle precedence without mutating concurrent runs', () => {
    const source = Object.freeze([
      run({ runRef: 'run-failed', lifecycle: 'failed', terminalOutcome: 'failed', completedAt: '2026-08-20T09:20:00.000Z' }),
      run({ runRef: 'run-live', lifecycle: 'running' }),
      run({ runRef: 'run-gate', lifecycle: 'waiting-human', openHumanRequestCount: 2 }),
    ]);
    expect(projectRunStatus(source, null)).toBe('needs-you');
    expect(projectRunStatus(source.slice(0, 2), null)).toBe('running');
    expect(projectRunStatus(source.slice(0, 1), null)).toBe('failed');
    expect(projectRunStatus([], { scheduleId: 'schedule-1', scheduledFor: iso(), nextAt: iso(), owner })).toBe('scheduled');
    expect(projectRunStatus([], null)).toBe('idle');
    expect(source[2].openHumanRequestCount).toBe(2);
  });

  it('counts each gated run once despite multiple requests and includes request-less waiting runs', () => {
    const counts = projectGateCounts('revision-1', [
      run({ runRef: 'run-1', lifecycle: 'waiting-human', openHumanRequestCount: 2 }),
      run({ runRef: 'run-1', lifecycle: 'waiting-human', openHumanRequestCount: 2 }),
      run({ runRef: 'run-2', lifecycle: 'running', openHumanRequestCount: 1 }),
      run({ runRef: 'run-3', lifecycle: 'waiting-human', openHumanRequestCount: 0 }),
    ]);
    expect(counts).toEqual({ revision: 'revision-1', pairs: [
      { runRef: 'run-1', owner }, { runRef: 'run-2', owner }, { runRef: 'run-3', owner },
    ], agents: { 'fyt-runner': 3 }, workflows: {} });
  });

  it('projects two concurrent runs deterministically without mutating either input', () => {
    const runs = [
      run({ runRef: 'run-b', lifecycle: 'failed', terminalOutcome: 'failed', completedAt: '2026-08-20T09:30:00.000Z' }),
      run({ runRef: 'run-a', lifecycle: 'succeeded', terminalOutcome: 'ok', completedAt: '2026-08-20T09:30:00.000Z' }),
    ];
    const clone = JSON.parse(JSON.stringify(runs));
    expect(projectRunStatus(runs, null)).toBe('idle');
    expect(projectRunStatus([...runs].reverse(), null)).toBe('idle');
    const gatedRuns = [
      run({ runRef: 'run-b', lifecycle: 'waiting-human', createdAt: '2026-08-20T09:00:00.000Z' }),
      run({ runRef: 'run-a', lifecycle: 'waiting-human', createdAt: '2026-08-20T09:00:00.000Z' }),
    ];
    const gatedClone = JSON.parse(JSON.stringify(gatedRuns));
    expect(projectGateCounts('revision-2', gatedRuns).pairs.map((item) => item.runRef)).toEqual(['run-a', 'run-b']);
    expect(runs).toEqual(clone);
    expect(gatedRuns).toEqual(gatedClone);
  });
});

function iso(): string { return '2026-08-20T10:00:00.000Z'; }
