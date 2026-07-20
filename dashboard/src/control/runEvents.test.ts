import { describe, expect, it } from 'vitest';
import type { OperationalEventDto } from './controlClient';
import { changeEvents, checkpointInfo, eventClock, eventLabel, isChangeEvent, relativeAge } from './runEvents';

function event(overrides: Partial<OperationalEventDto> = {}): OperationalEventDto {
  return {
    cursor: 1, runRef: 'run-1', kind: 'message', source: 'manager', stageRef: null, attemptRef: null,
    sessionRef: null, status: null, summary: null, command: null, toolName: null, path: null,
    diff: null, checkpoint: null, createdAt: '2026-07-18T10:01:02.000Z',
    ...overrides,
  };
}

describe('checkpointInfo', () => {
  // The wire shape is the inverse of what it looks like: server/control/store.ts:916-919 puts the
  // NAME in `checkpoint` and the STATE in `summary`. The old `summary ?? ... ?? checkpoint` chain hit
  // summary first, so it rendered the bare word "reached" and lost the name entirely.
  it('keeps the name and the state as separate values on the broker path', () => {
    const info = checkpointInfo(event({
      kind: 'checkpoint', checkpoint: 'tests-green', summary: 'reached', status: 'success',
    }));

    expect(info).toEqual({ name: 'tests-green', state: 'reached', detail: null });
  });

  it('reads a blocked checkpoint as blocked, not as a generic success', () => {
    const info = checkpointInfo(event({
      kind: 'checkpoint', checkpoint: 'scope-review', summary: 'blocked', status: 'waiting',
    }));

    expect(info?.state).toBe('blocked');
    expect(info?.name).toBe('scope-review');
  });

  it('distinguishes released from reached', () => {
    const info = checkpointInfo(event({ kind: 'checkpoint', checkpoint: 'after-tests', summary: 'released' }));
    expect(info?.state).toBe('released');
  });

  it('recovers the state from status when summary carries operator text instead', () => {
    // The steering-enqueue path (store.ts:1981) puts the instruction in `summary` and leaves the
    // state implicit in `status`.
    const info = checkpointInfo(event({
      kind: 'checkpoint', checkpoint: 'after-tests', summary: 'Inspect the diff.', status: 'pending',
    }));

    expect(info).toEqual({ name: 'after-tests', state: 'queued', detail: 'Inspect the diff.' });
  });

  it('returns null for events that are not checkpoints', () => {
    expect(checkpointInfo(event({ kind: 'tool', toolName: 'apply_patch' }))).toBeNull();
  });
});

describe('change events', () => {
  it('recognises an event carrying a diff body', () => {
    expect(isChangeEvent(event({ kind: 'diff', diff: '@@ -1 +1 @@\n-a\n+b' }))).toBe(true);
  });

  it('does not treat an absent or blank diff as a change', () => {
    expect(isChangeEvent(event({ diff: null }))).toBe(false);
    expect(isChangeEvent(event({ diff: '   ' }))).toBe(false);
  });

  it('selects only the events that carry a diff', () => {
    const events = [
      event({ cursor: 1, kind: 'tool', toolName: 'apply_patch' }),
      event({ cursor: 2, kind: 'diff', path: 'src/a.ts', diff: '+one' }),
      event({ cursor: 3, kind: 'message', summary: 'done' }),
      event({ cursor: 4, kind: 'diff', path: 'src/b.ts', diff: '+two' }),
    ];

    expect(changeEvents(events).map((item) => item.cursor)).toEqual([2, 4]);
  });
});

describe('eventLabel', () => {
  it('labels a checkpoint by its name, which the old flattening dropped', () => {
    const label = eventLabel(event({ kind: 'checkpoint', checkpoint: 'tests-green', summary: 'reached' }));
    expect(label).toBe('tests-green');
  });

  it('labels a diff by its path and never inlines the diff body', () => {
    const label = eventLabel(event({ kind: 'diff', path: 'src/a.ts', diff: '@@ huge patch @@' }));
    expect(label).toBe('src/a.ts');
    expect(label).not.toContain('@@');
  });

  it('falls back through summary, command, tool, path, then kind', () => {
    expect(eventLabel(event({ summary: 'a summary', command: 'npm test' }))).toBe('a summary');
    expect(eventLabel(event({ command: 'npm test' }))).toBe('npm test');
    expect(eventLabel(event({ toolName: 'apply_patch' }))).toBe('apply_patch');
    expect(eventLabel(event({ kind: 'lifecycle' }))).toBe('lifecycle');
  });
});

describe('time formatting', () => {
  it('renders a stable clock and degrades safely on a malformed stamp', () => {
    expect(eventClock('2026-07-18T10:01:02.000Z')).toBe('10:01:02');
    expect(eventClock('not-a-date')).toBe('--:--:--');
  });

  it('renders coarse ages against an injected clock', () => {
    const now = Date.parse('2026-07-18T12:00:00.000Z');
    expect(relativeAge('2026-07-18T11:56:00.000Z', now)).toBe('4m ago');
    expect(relativeAge('2026-07-18T11:59:30.000Z', now)).toBe('30s ago');
    expect(relativeAge('2026-07-18T09:00:00.000Z', now)).toBe('3h ago');
    expect(relativeAge('2026-07-16T12:00:00.000Z', now)).toBe('2d ago');
  });
});
