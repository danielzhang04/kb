import { describe, expect, it } from 'vitest';
import { projectAttemptSessions, projectGateCounts, projectRunActivity, projectRunStatus, selectAttemptSessionId, type ProjectableRun } from './runProjection.ts';
import type { AttemptBinding, SessionRecord } from '../pty/contracts.ts';
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

describe('[C-M4] run attempt-session projection', () => {
  function binding(attemptRef: string, sessionId: string): AttemptBinding {
    return { operator: 'operator', runRef: 'run-1', attemptRef, managedSessionRef: `managed-${attemptRef}`,
      sessionId, createdAt: '2026-08-20T09:00:00.000Z' };
  }
  function record(overrides: Partial<SessionRecord> & { sessionId: string }): SessionRecord {
    return {
      operationKey: `op-${overrides.sessionId}`, requestHash: 'hash', recipeDigest: 'digest',
      launcher: 'claude', host: 'desktop', rootId: 'worktrees', relativeCwd: 'a', name: 'Attempt',
      attachmentIds: [], transcript: { path: 'p', bytes: 4, truncated: false, lastSequence: 4 },
      startedAt: '2026-08-20T09:00:00.000Z', endedAt: null, revision: 1,
      provenance: 'run', controller: null, operator: 'operator', runRef: 'run-1',
      attemptRef: 'attempt-x', managedSessionRef: 'managed-x',
      state: 'live', epochId: 'epoch-1', exit: null, ...overrides,
    } as SessionRecord;
  }
  const exited = (sessionId: string, exitCode: number): SessionRecord => record({
    sessionId, state: 'exited', endedAt: '2026-08-20T09:10:00.000Z',
    exit: { sessionId, sequence: 12, exitCode, signal: null, reason: 'exited', observedAt: '2026-08-20T09:10:00.000Z' },
  } as Partial<SessionRecord> & { sessionId: string });

  it('keeps binding order, carries no internal field, and selects the running attempt', () => {
    const rows = projectAttemptSessions(
      [binding('attempt-2', 'pty-b'), binding('attempt-1', 'pty-a'), binding('attempt-3', 'pty-c')],
      [record({ sessionId: 'pty-c' }), exited('pty-a', 0), exited('pty-b', 1)],
    );
    expect(rows.map((row) => row.sessionId)).toEqual(['pty-b', 'pty-a', 'pty-c']);
    expect(rows.map((row) => row.attemptRef)).toEqual(['attempt-2', 'attempt-1', 'attempt-3']);
    expect(Object.keys(rows[0]!).sort()).toEqual([
      'attemptRef', 'controllerClaimed', 'endedAt', 'exit', 'launcher', 'liveControl', 'sessionId',
      'startedAt', 'state',
    ]);
    expect(rows[0]!.exit).toEqual({ exitCode: 1, reason: 'exited', observedAt: '2026-08-20T09:10:00.000Z' });
    expect(rows[0]!.liveControl).toBe(false);
    expect(rows[2]!.liveControl).toBe(true);
    expect(selectAttemptSessionId(rows)).toBe('pty-c');
  });

  it('selects the newest attempt when none is running, and null with no rows', () => {
    const rows = projectAttemptSessions(
      [binding('attempt-1', 'pty-a'), binding('attempt-2', 'pty-b')],
      [exited('pty-a', 0), exited('pty-b', 0)],
    );
    expect(selectAttemptSessionId(rows)).toBe('pty-b');
    expect(selectAttemptSessionId([])).toBeNull();
    // The LAST running attempt wins even when an earlier one is also live.
    const both = projectAttemptSessions(
      [binding('attempt-1', 'pty-a'), binding('attempt-2', 'pty-b')],
      [record({ sessionId: 'pty-a' }), record({ sessionId: 'pty-b', state: 'closing' })],
    );
    expect(selectAttemptSessionId(both)).toBe('pty-b');
  });

  it('drops a binding with no record and a non-agent launcher rather than inventing a row', () => {
    const rows = projectAttemptSessions(
      [binding('attempt-1', 'pty-gone'), binding('attempt-2', 'pty-shell'), binding('attempt-3', 'pty-c')],
      [record({ sessionId: 'pty-shell', launcher: 'shell' }), record({ sessionId: 'pty-c', launcher: 'codex' })],
    );
    expect(rows.map((row) => row.sessionId)).toEqual(['pty-c']);
    expect(rows[0]!.launcher).toBe('codex');
  });

  it('reports a claimed controller without turning it into live control', () => {
    const claimed = record({ sessionId: 'pty-a' });
    const rows = projectAttemptSessions([binding('attempt-1', 'pty-a')], [{
      ...claimed, controller: { operator: 'operator', browserSessionRef: 'browser-1' }, claimRevision: 3,
    } as SessionRecord]);
    expect(rows[0]!.controllerClaimed).toBe(true);
    expect(rows[0]!.liveControl).toBe(true);
    expect(JSON.stringify(rows)).not.toContain('browser-1');
    expect(JSON.stringify(rows)).not.toContain('managed-');
  });
});

function iso(): string { return '2026-08-20T10:00:00.000Z'; }
