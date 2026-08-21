import type { OperationalEventDto } from '../controlClient';

/** Ordered server events shared by replay and reconnect adapter coverage. */
export const RUN_LIFECYCLE_FIXTURE: OperationalEventDto[] = [
  {
    cursor: 1, runRef: 'run-1', kind: 'lifecycle', source: 'worker', stageRef: 'stage-1', attemptRef: 'attempt-1',
    sessionRef: 'session-1', status: 'running', summary: 'Started work', command: null, toolName: null,
    path: null, diff: null, checkpoint: null, createdAt: '2026-08-21T12:00:00.000Z',
  },
  {
    cursor: 2, runRef: 'run-1', kind: 'tool', source: 'worker', stageRef: 'stage-1', attemptRef: 'attempt-1',
    sessionRef: 'session-1', status: 'success', summary: null, command: null, toolName: 'Read',
    path: null, diff: null, checkpoint: null, createdAt: '2026-08-21T12:00:01.000Z',
  },
  {
    cursor: 3, runRef: 'run-1', kind: 'governance', source: 'human', stageRef: null, attemptRef: null,
    sessionRef: null, status: 'waiting', summary: 'Awaiting review', command: null, toolName: null,
    path: null, diff: null, checkpoint: null, createdAt: '2026-08-21T12:00:02.000Z',
  },
];
