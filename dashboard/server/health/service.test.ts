import { describe, expect, it, vi } from 'vitest';
import { composeHealth } from './service.ts';
import type { Schedule } from '../control/p2Contracts.ts';

const now = () => '2026-08-21T12:00:00.000Z';

function readers() {
  return {
    fleet: vi.fn(() => ({ agents: [{ id: 'worker-a', role: 'builder', status: 'working' as const, working: true, lastActive: '2026-08-21' }] })),
    stop: vi.fn(() => false),
    platform: vi.fn(() => 'win32' as const),
    connections: vi.fn(() => ({ items: [{ project: 'demo', server: 'files', tools: ['read'] }] })),
    usage: vi.fn(() => ({ stepCount: 4, dispatchCount: 2, cards: 1, models: [{ model: 'gpt-5', steps: 4, mix: 1 }] })),
    owners: vi.fn(() => [{ type: 'agent' as const, id: 'worker-a', sourcePath: 'agents/worker-a.md' as const }]),
    now,
  };
}

describe('composeHealth', () => {
  it('composes the exact HealthResponse envelope and isolates reader failure with a closed unavailable row', () => {
    const source = readers();
    source.connections.mockImplementation(() => { throw new Error('unavailable'); });
    const response = composeHealth('repo', source);

    expect(response.sections.map((section) => section.id)).toEqual(['fleet', 'stop', 'daemon-machine', 'mcp', 'usage']);
    expect(response.sections[3]).toEqual({
      id: 'mcp', label: 'MCP',
      rows: [{ kind: 'unavailable', key: 'error:mcp', label: 'Unavailable', value: { status: 'unavailable', reason: 'Reader unavailable' }, observedAt: now(), source: 'error' }],
    });
    expect(response.sections[0].rows).toHaveLength(1);
  });

  it('calls indexConnections and ledger readers directly and emits no spend', () => {
    const source = readers();
    const response = composeHealth('repo', source);

    expect(source.connections).toHaveBeenCalledWith('repo');
    expect(source.usage).toHaveBeenCalledWith('repo');
    expect(response.sections[4].rows).toEqual([
      { kind: 'usage', key: 'steps', label: 'Steps', value: 4, observedAt: now(), source: 'usage' },
      { kind: 'usage', key: 'dispatches', label: 'Dispatches', value: 2, observedAt: now(), source: 'usage' },
      { kind: 'usage', key: 'cards', label: 'Cards', value: 1, observedAt: now(), source: 'usage' },
      { kind: 'usage', key: 'model:gpt-5', label: 'gpt-5', value: { steps: 4, mix: 1 }, observedAt: now(), source: 'usage' },
    ]);
  });

  it('renders one Release row in daemon and machine and VM then Desktop beside every MCP configuration', () => {
    const source = readers();
    source.connections.mockReturnValue({ items: [
      { project: 'demo', server: 'files', tools: ['read'] },
      { project: 'demo', server: 'search', tools: ['query'] },
    ] });
    const response = composeHealth('repo', source);

    expect(response.sections[2].rows.filter((row) => row.key === 'release')).toHaveLength(1);
    expect(response.sections[2].rows.map((row) => row.key)).toEqual(['daemon-platform', 'release']);
    expect(response.sections[2].rows.find((row) => row.key === 'release')?.value).toBe('unavailable in P1');
    expect(response.sections[3].rows.map((row) => row.key)).toEqual([
      'mcp:demo:files', 'mcp:demo:files:vm', 'mcp:demo:files:desktop',
      'mcp:demo:search', 'mcp:demo:search:vm', 'mcp:demo:search:desktop',
    ]);
  });

  it('humanizes fleet labels while retaining raw ids in keys', () => {
    const source = readers();
    source.fleet.mockReturnValue({ agents: [{
      id: 'fyt_api-worker', role: 'builder', status: 'working', working: true, lastActive: '2026-08-21',
    }] });
    const row = composeHealth('repo', source).sections[0].rows[0];
    expect(row).toMatchObject({ key: 'agent:fyt_api-worker', label: 'FYT API Worker' });
  });

  it('projects a deleted schedule owner into the Health integrity row, never Unknown', () => {
    const source = readers();
    const schedule: Schedule = {
      id: 'd'.repeat(64), owner: { type: 'agent', id: 'deleted-owner', sourcePath: 'agents/deleted-owner.md' },
      cadence: { source: '0 9 * * *', words: 'Daily \u00b7 9:00 AM' }, nextAt: null, lastOutcome: null,
      armed: true, origin: 'operator', mirroredAt: null, mirrorPath: 'HEARTBEAT.md', version: 1,
    };
    const fleet = composeHealth('repo', source, {
      scheduleSnapshot: () => ({ collectionRevision: 1, schedules: [schedule] }),
    }).sections[0];
    expect(fleet.rows).toContainEqual({
      kind: 'integrity', key: `schedule-owner:${schedule.id}`, label: 'Schedule owner',
      value: { status: 'error', code: 'schedule-owner-unresolvable', owner: schedule.owner },
      observedAt: now(), source: 'schedule-store',
    });
    expect(JSON.stringify(fleet)).not.toContain('Unknown');
  });
});
