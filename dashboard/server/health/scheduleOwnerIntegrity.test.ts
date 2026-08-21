import { describe, expect, it } from 'vitest';
import type { RunnableRef, Schedule } from '../control/p2Contracts.ts';
import { projectScheduleOwnerIntegrity } from './scheduleOwnerIntegrity.ts';

const hygiene = { type: 'agent', id: 'hygiene', sourcePath: 'agents/hygiene.md' } as const;
const schedule = (owner: RunnableRef, id = 'schedule-1'): Schedule => ({
  id, owner, cadence: { source: '15 3 * * 0', words: 'Sunday at 3:15 AM' }, nextAt: null,
  lastOutcome: null, armed: true, origin: 'seed', mirroredAt: null, mirrorPath: 'HEARTBEAT.md', version: 1,
});

describe('projectScheduleOwnerIntegrity', () => {
  it('emits no row for an owner that resolves to exactly one declaration', () => {
    expect(projectScheduleOwnerIntegrity([schedule(hygiene)], [hygiene], () => '2026-08-21T12:00:00.000Z')).toEqual([]);
  });

  it('emits one closed integrity row for a missing owner at the injected clock', () => {
    const missing = { type: 'workflow', id: 'video-run', project: 'faceless-youtube', sourcePath: 'orgs/faceless-youtube/workflows/video-run.md' } as const;
    const rows = projectScheduleOwnerIntegrity([schedule(missing, 'schedule-2')], [hygiene], () => '2026-08-21T12:00:00.000Z');

    expect(rows).toEqual([{
      kind: 'integrity',
      key: 'schedule-owner:schedule-2',
      value: { status: 'error', code: 'schedule-owner-unresolvable', owner: missing },
      observedAt: '2026-08-21T12:00:00.000Z',
      source: 'schedule-store',
    }]);
    expect(Object.keys(rows[0]).sort()).toEqual(['key', 'kind', 'observedAt', 'source', 'value']);
    expect(Object.keys(rows[0]?.value ?? {}).sort()).toEqual(['code', 'owner', 'status']);
  });

  it('emits one closed integrity row for a duplicate owner', () => {
    const duplicate = { type: 'agent', id: 'grader', sourcePath: 'agents/grader.md' } as const;
    const rows = projectScheduleOwnerIntegrity(
      [schedule(duplicate, 'schedule-3')],
      [duplicate, { ...duplicate, sourcePath: 'agents/grader-replacement.md' }],
      () => '2026-08-21T13:00:00.000Z',
    );

    expect(rows).toEqual([{
      kind: 'integrity',
      key: 'schedule-owner:schedule-3',
      value: { status: 'error', code: 'schedule-owner-unresolvable', owner: duplicate },
      observedAt: '2026-08-21T13:00:00.000Z',
      source: 'schedule-store',
    }]);
    expect(Object.keys(rows[0]).sort()).toEqual(['key', 'kind', 'observedAt', 'source', 'value']);
    expect(Object.keys(rows[0]?.value ?? {}).sort()).toEqual(['code', 'owner', 'status']);
  });
});
