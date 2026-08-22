import { describe, expect, it } from 'vitest';
import type { AttentionEnvelope, RunRow, ScheduleOccurrence } from '../control/p2Contracts.ts';
import homeGolden from './__fixtures__/home.json';
import { projectHome } from './project.ts';
import type { HomeResponse } from './contracts.ts';

const agent = { type: 'agent', id: 'hygiene', sourcePath: 'agents/hygiene.md' } as const;
const run: RunRow = {
  runRef: 'run-1', title: 'Hygiene', owner: agent, lifecycle: 'running', streamKind: 'transcript', outcome: null,
  createdAt: '2026-08-21T10:00:00.000Z', completedAt: null,
};
const occurrence: ScheduleOccurrence = {
  scheduleId: 'schedule-1', scheduledFor: '2026-08-21T14:00:00.000Z', nextAt: '2026-08-21T14:00:00.000Z',
  owner: agent,
};

function ports(overrides: Partial<Parameters<typeof projectHome>[0]> = {}) {
  const attention: AttentionEnvelope = {
    revision: 'attention-1', pairs: [], agents: { hygiene: 2 }, workflows: { 'video-run': 1 },
  };
  return {
    runningNow: { read: async () => ({ revision: 'runs-1', data: [run] }) },
    attention: { read: async () => ({ revision: 'attention-1', data: attention }) },
    inboxCount: { read: async () => ({ revision: 'inbox-1', data: 3 }) },
    nextSchedules: { read: async () => ({ revision: 'schedules-1', data: [occurrence] }) },
    activation: { readActivation: async () => ({ revision: 'release-1', label: 'VM', sha: '64fb3d02', activatedAt: '2026-08-21T10:00:00.000Z' }) },
    recentRuns: { read: async () => ({ revision: 'outcomes-1', data: [] }) },
    ...overrides,
  };
}

describe('projectHome', () => {
  it('projects D13 in its exact order with a composite revision', async () => {
    const response = await projectHome(ports());

    expect(response.revision).toBe('home:runs-1:attention-1:inbox-1:schedules-1:release-1:outcomes-1');
    expect(response.sections.map((section) => section.state === 'ready' ? section.data.section : section.reason))
      .toEqual(['running-now', 'attention-counts', 'next-schedules', 'version', 'recent-outcomes']);
    expect(response.sections[1]).toEqual({ state: 'ready', data: { section: 'attention-counts', agents: 2, workflows: 1, inbox: 3 } });
    expect(response.sections[3]).toEqual({ state: 'ready', data: { section: 'version', label: 'VM', sha: '64fb3d02', activatedAt: '2026-08-21T10:00:00.000Z' } });
  });

  it('matches the checked-in D13 golden byte shape', async () => {
    const outcome: RunRow = {
      ...run,
      runRef: 'run-0',
      title: 'Grader',
      lifecycle: 'succeeded',
      outcome: 'ok',
      completedAt: '2026-08-21T09:00:00.000Z',
    };
    const response = await projectHome(ports({
      runningNow: { read: async () => ({ revision: 'runs', data: [run] }) },
      attention: { read: async () => ({ revision: 'attention', data: { revision: 'attention', pairs: [], agents: { hygiene: 2 }, workflows: { 'workflow:demo:video-run': 1 } } }) },
      inboxCount: { read: async () => ({ revision: 'inbox', data: 3 }) },
      nextSchedules: { read: async () => ({ revision: 'schedules', data: [occurrence] }) },
      activation: { readActivation: async () => ({ revision: 'release', label: 'VM', sha: '64fb3d02', activatedAt: '2026-08-21T10:00:00.000Z' }) },
      recentRuns: { read: async () => ({ revision: 'outcomes', data: [outcome] }) },
    }), '2026-08-21T12:00:00.000Z');

    expect(response).toEqual(homeGolden as unknown as HomeResponse);
  });

  it('keeps failures local and never fabricates a zero count', async () => {
    const response = await projectHome(ports({
      inboxCount: { read: async () => { throw new Error('unavailable'); } },
      recentRuns: { read: async () => { throw new Error('unavailable'); } },
    }));

    expect(response.sections[1]).toEqual({ state: 'unavailable', reason: 'inbox-unavailable' });
    expect(response.sections[4]).toEqual({ state: 'unavailable', reason: 'outcomes-unavailable' });
    expect(response.sections[0].state).toBe('ready');
  });

  it('orders the next three fires and the ten newest completed outcomes', async () => {
    const runs: RunRow[] = Array.from({ length: 11 }, (_, index) => ({
      ...run,
      runRef: `run-${index}`,
      title: `Run ${index}`,
      lifecycle: 'succeeded',
      outcome: index === 10 ? null : 'ok',
      completedAt: index === 10 ? null : `2026-08-${String(index + 1).padStart(2, '0')}T10:00:00.000Z`,
    }));
    const fires: ScheduleOccurrence[] = [3, 1, 2, 4].map((hour) => ({
      scheduleId: `schedule-${hour}`,
      scheduledFor: `2026-08-21T${String(hour).padStart(2, '0')}:00:00.000Z`,
      nextAt: `2026-08-21T${String(hour).padStart(2, '0')}:00:00.000Z`,
      owner: agent,
    }));
    const response = await projectHome(ports({
      recentRuns: { read: async () => ({ revision: 'outcomes-2', data: runs }) },
      nextSchedules: { read: async () => ({ revision: 'schedules-2', data: fires }) },
    }));

    expect(response.sections[2]).toEqual({ state: 'ready', data: { section: 'next-schedules', occurrences: [fires[1], fires[2], fires[0]] } });
    expect(response.sections[4].state === 'ready' && response.sections[4].data.outcomes.map((outcome) => outcome.runRef))
      .toEqual(['run-9', 'run-8', 'run-7', 'run-6', 'run-5', 'run-4', 'run-3', 'run-2', 'run-1', 'run-0']);
  });

  it('keeps exact empty data distinct from a failed activation read', async () => {
    const response = await projectHome(ports({
      runningNow: { read: async () => ({ revision: 'runs-empty', data: [] }) },
      nextSchedules: { read: async () => ({ revision: 'schedules-empty', data: [] }) },
      recentRuns: { read: async () => ({ revision: 'outcomes-empty', data: [] }) },
      activation: { readActivation: async () => { throw new Error('release unavailable'); } },
    }));

    expect(response.sections[0]).toEqual({ state: 'ready', data: { section: 'running-now', runs: [] } });
    expect(response.sections[2]).toEqual({ state: 'ready', data: { section: 'next-schedules', occurrences: [] } });
    expect(response.sections[3]).toEqual({ state: 'unavailable', reason: 'release-unavailable' });
    expect(response.sections[4]).toEqual({ state: 'ready', data: { section: 'recent-outcomes', outcomes: [] } });
  });
});
