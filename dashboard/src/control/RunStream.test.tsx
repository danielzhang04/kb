// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { RUN_LIFECYCLE_KINDS } from '../../server/control/runLifecycle.ts';
import type { OperationalEvent } from '../../server/control/types.ts';
import { RunStream } from './RunStream.tsx';

afterEach(cleanup);

function event(cursor: number, summary: string, stageRef: string | null = null): OperationalEvent {
  return {
    cursor, runRef: 'run-1', kind: 'lifecycle', source: 'system', stageRef,
    attemptRef: null, sessionRef: null, status: null, summary, command: null,
    toolName: null, path: null, diff: null, checkpoint: null,
    createdAt: `2026-08-21T00:00:${String(cursor).padStart(2, '0')}.000Z`,
  };
}

function structured(
  cursor: number,
  kind: OperationalEvent['kind'],
  overrides: Partial<OperationalEvent>,
): OperationalEvent {
  return { ...event(cursor, String(overrides.summary ?? kind)), kind, ...overrides };
}

describe('RunStream', () => {
  it('renders all eleven lifecycle kinds as one full-width ordered stream', () => {
    render(<RunStream events={RUN_LIFECYCLE_KINDS.map((kind, index) => event(index + 1, kind))} connection="live" />);
    for (const kind of RUN_LIFECYCLE_KINDS) expect(screen.getByText(kind)).toBeTruthy();
    expect(screen.getByTestId('run-stream').getAttribute('data-layout')).toBe('full-width');
  });

  it('filters the same stream by step and deduplicates concurrent cursor rows', () => {
    render(<RunStream events={[event(2, 'step b', 'b'), event(1, 'step a', 'a'), event(2, 'duplicate', 'b')]} selectedStageRef="b" connection="live" />);
    expect(screen.getByText('step b')).toBeTruthy();
    expect(screen.queryByText('step a')).toBeNull();
    expect(screen.queryByText('duplicate')).toBeNull();
  });

  it('preserves replayed content while reconnecting', () => {
    render(<RunStream events={[event(1, 'still visible')]} connection="reconnecting" />);
    expect(screen.getByText('Reconnecting…')).toBeTruthy();
    expect(screen.getByText('still visible')).toBeTruthy();
  });

  it('renders file, diff, checkpoint, lifecycle, and honest truncation as distinct rows', () => {
    render(<RunStream events={[
      structured(1, 'file', { path: 'src/run.ts', status: 'success', summary: 'Saved file' }),
      structured(2, 'diff', { path: 'src/run.ts', diff: `@@ -1 +1 @@\n-${'x'.repeat(2_500)}` }),
      structured(3, 'checkpoint', { checkpoint: 'tests-green', status: 'success' }),
      structured(4, 'lifecycle', { status: 'stopped', summary: 'Run stopped' }),
    ]} connection="replay" />);

    expect(screen.getByTestId('run-event-file').textContent).toContain('src/run.ts');
    expect(screen.getByTestId('run-event-diff').textContent).toContain('@@ -1 +1 @@');
    expect(screen.getByTestId('run-event-truncation').textContent).toContain('truncated');
    expect(screen.getByTestId('run-event-checkpoint').textContent).toContain('tests-green');
    expect(screen.getByTestId('run-event-lifecycle').textContent).toContain('Run stopped');
  });
});
