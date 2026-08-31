import { describe, expect, it, vi } from 'vitest';
// Health may read the non-PTY host slice and nothing else: these two spies stand over the exact
// capability entry points a regression would reach for, so the assertion below can actually fail.
const { probeSpy, composeSpy } = vi.hoisted(() => ({ probeSpy: vi.fn(), composeSpy: vi.fn() }));
vi.mock('../runtime/capabilities.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../runtime/capabilities.ts')>();
  return {
    ...actual,
    probePublicPtyCapability: (...args: Parameters<typeof actual.probePublicPtyCapability>) => {
      probeSpy(...args);
      return actual.probePublicPtyCapability(...args);
    },
    runtimeCapabilities: (...args: Parameters<typeof actual.runtimeCapabilities>) => {
      composeSpy(...args);
      return actual.runtimeCapabilities(...args);
    },
  };
});
import { composeHealth, defaultHealthReaders } from './service.ts';
import type { Schedule } from '../control/p2Contracts.ts';
import type { MachineReaderPorts } from './machineReaders.ts';
import type { ReleaseActivationPort } from './releaseReader.ts';
import type { DeployStoreReadPort } from './deployReader.ts';

const now = () => '2026-08-21T12:00:00.000Z';
const SHA = '64fb3d02' + 'a'.repeat(32);
const DIGEST = 'b'.repeat(64);

function fakeMachinePorts(): MachineReaderPorts {
  return {
    cpu: vi.fn(() => ({ load1: 0.1, load5: 0.2, load15: 0.3 })),
    memory: vi.fn(() => ({ used: 100, total: 200, unit: 'bytes' })),
    disk: vi.fn(() => ({ used: 300, total: 400, unit: 'bytes' })),
    uptime: vi.fn(() => ({ seconds: 10 })),
    daemon: vi.fn(() => ({ unit: 'kb-dashboard.service', mainPid: 111, loadedRoot: '/opt/kb-releases/current', childCount: 2 })),
  };
}

function readyActivation(): ReleaseActivationPort {
  return { readActivation: async () => ({ revision: 'release:1', label: 'VM', sha: SHA, activatedAt: '2026-08-21T10:00:00.000Z', archiveSha256: DIGEST, rollbackAvailable: true }) };
}

function readers() {
  return {
    fleet: vi.fn(() => ({ agents: [{ id: 'worker-a', role: 'builder', status: 'working' as const, working: true, lastActive: '2026-08-21' }] })),
    stop: vi.fn(() => false),
    platform: vi.fn(() => 'win32' as const),
    connections: vi.fn(() => ({ items: [{ project: 'demo', server: 'files', tools: ['read'] }] })),
    usage: vi.fn(() => ({ stepCount: 4, dispatchCount: 2, cards: 1, models: [{ model: 'gpt-5', steps: 4, mix: 1 }] })),
    owners: vi.fn(() => [{ type: 'agent' as const, id: 'worker-a', sourcePath: 'agents/worker-a.md' as const }]),
    now,
    machine: fakeMachinePorts(),
  };
}

describe('defaultHealthReaders', () => {
  it('answers the platform row without ever probing or composing a PTY capability', async () => {
    expect(defaultHealthReaders.platform()).toBe(process.platform);
    // Red on regression: wiring Health to the composed capability instead of the host slice would
    // drag the composition-time host probe into a read route.
    expect(probeSpy).not.toHaveBeenCalled();
    expect(composeSpy).not.toHaveBeenCalled();
    await composeHealth('/repo', { ...readers(), platform: defaultHealthReaders.platform });
    expect(probeSpy).not.toHaveBeenCalled();
    expect(composeSpy).not.toHaveBeenCalled();
  });
});

describe('composeHealth', () => {
  it('composes the exact HealthResponse envelope and isolates reader failure with a closed unavailable row', async () => {
    const source = readers();
    source.connections.mockImplementation(() => { throw new Error('unavailable'); });
    const response = await composeHealth('repo', source);

    expect(response.sections.map((section) => section.id)).toEqual(['fleet', 'stop', 'daemon-machine', 'mcp', 'usage']);
    expect(response.sections[3]).toEqual({
      id: 'mcp', label: 'MCP',
      rows: [{ kind: 'unavailable', key: 'error:mcp', label: 'Unavailable', value: { status: 'unavailable', reason: 'Reader unavailable' }, observedAt: now(), source: 'error' }],
    });
    expect(response.sections[0].rows).toHaveLength(1);
  });

  it('calls indexConnections and ledger readers directly and emits no spend', async () => {
    const source = readers();
    const response = await composeHealth('repo', source);

    expect(source.connections).toHaveBeenCalledWith('repo');
    expect(source.usage).toHaveBeenCalledWith('repo');
    expect(response.sections[4].rows).toEqual([
      { kind: 'usage', key: 'steps', label: 'Steps', value: 4, observedAt: now(), source: 'usage' },
      { kind: 'usage', key: 'dispatches', label: 'Dispatches', value: 2, observedAt: now(), source: 'usage' },
      { kind: 'usage', key: 'cards', label: 'Cards', value: 1, observedAt: now(), source: 'usage' },
      { kind: 'usage', key: 'model:gpt-5', label: 'gpt-5', value: { steps: 4, mix: 1 }, observedAt: now(), source: 'usage' },
    ]);
  });

  it('carries the four \u00a73.5 daemon-machine row kinds, in order, with NO deferred ReleaseRow', async () => {
    const source = readers();
    source.connections.mockReturnValue({ items: [
      { project: 'demo', server: 'files', tools: ['read'] },
      { project: 'demo', server: 'search', tools: ['query'] },
    ] });
    const response = await composeHealth('repo', source, {
      scheduleSnapshot: () => ({ collectionRevision: 0, schedules: [] }),
      activation: readyActivation(),
      deployStore: { listDeployments: () => [{ deploymentRef: 'deployment:1', state: 'succeeded', targetCommit: 'c'.repeat(40), previousCommit: 'd'.repeat(40), error: null, requestedAt: '2026-08-21T00:00:00.000Z' }] },
    });

    expect(response.sections[2].rows.map((row) => row.key)).toEqual([
      'daemon-platform', 'cpu', 'memory', 'disk', 'uptime', 'service', 'release', 'deploy:deployment:1',
    ]);
    expect(response.sections[2].rows.map((row) => row.kind)).toEqual([
      'machine', 'machine', 'machine', 'machine', 'machine', 'daemon', 'release', 'deploy',
    ]);
    // Never the P1 deferred placeholder again — the `kind` equality above already proves no `'deferred'`
    // row kind survives in `daemon-machine` (the type system agrees: `HealthResponse`'s daemon-machine
    // row union no longer has a `'deferred'` member at all). The literal string itself is intentionally
    // not repeated here — the P5-C61 scan asserts it survives ONLY at the MCP availability rows.
    expect(response.sections[2].rows.find((row) => row.key === 'release')).toEqual({
      kind: 'release', key: 'release', label: 'Release',
      value: { sha: SHA, archiveSha256: DIGEST, activatedAt: '2026-08-21T10:00:00.000Z', rollbackAvailable: true },
      observedAt: now(), source: 'release',
    });
    expect(response.sections[3].rows.map((row) => row.key)).toEqual([
      'mcp:demo:files', 'mcp:demo:files:vm', 'mcp:demo:files:desktop',
      'mcp:demo:search', 'mcp:demo:search:vm', 'mcp:demo:search:desktop',
    ]);
  });

  it('produces no Deployment row when no Deployment exists yet \u2014 never a synthesized empty one', async () => {
    const response = await composeHealth('repo', readers(), {
      scheduleSnapshot: () => ({ collectionRevision: 0, schedules: [] }),
      activation: readyActivation(),
    });
    expect(response.sections[2].rows.some((row) => row.kind === 'deploy')).toBe(false);
  });

  it('a missing activation port degrades ONLY the Release row to a closed unavailable row', async () => {
    const response = await composeHealth('repo', readers());
    const releaseSlot = response.sections[2].rows[6];
    expect(releaseSlot).toMatchObject({ kind: 'unavailable', key: 'error:daemon-machine' });
    expect(response.sections[2].rows.filter((row) => row.kind === 'unavailable')).toHaveLength(1);
  });

  it('humanizes fleet labels while retaining raw ids in keys', async () => {
    const source = readers();
    source.fleet.mockReturnValue({ agents: [{
      id: 'fyt_api-worker', role: 'builder', status: 'working', working: true, lastActive: '2026-08-21',
    }] });
    const row = (await composeHealth('repo', source)).sections[0].rows[0];
    expect(row).toMatchObject({ key: 'agent:fyt_api-worker', label: 'FYT API Worker' });
  });

  it('projects a deleted schedule owner into the Health integrity row, never Unknown', async () => {
    const source = readers();
    const schedule: Schedule = {
      id: 'd'.repeat(64), owner: { type: 'agent', id: 'deleted-owner', sourcePath: 'agents/deleted-owner.md' },
      cadence: { source: '0 9 * * *', words: 'Daily \u00b7 9:00 AM' }, nextAt: null, lastOutcome: null,
      armed: true, origin: 'operator', mirroredAt: null, mirrorPath: 'HEARTBEAT.md', version: 1,
    };
    const fleet = (await composeHealth('repo', source, {
      scheduleSnapshot: () => ({ collectionRevision: 1, schedules: [schedule] }),
    })).sections[0];
    expect(fleet.rows).toContainEqual({
      kind: 'integrity', key: `schedule-owner:${schedule.id}`, label: 'Schedule owner',
      value: { status: 'error', code: 'schedule-owner-unresolvable', owner: schedule.owner },
      observedAt: now(), source: 'schedule-store',
    });
    expect(JSON.stringify(fleet)).not.toContain('Unknown');
  });
});

/**
 * P5 W6.2 [P5-C30] \u2014 the \u00a73.5 hung-disk / hanging-systemctl / throwing-release scenario. All five Health
 * sections still return within the 2500 ms `daemon-machine` section ceiling, with EXACTLY three closed
 * unavailable rows (disk, daemon, release) and every other row ready.
 */
describe('composeHealth \u2014 2500ms daemon-machine ceiling under simultaneous faults', () => {
  it('returns within 2500ms with exactly three unavailable rows and everything else ready', async () => {
    vi.useFakeTimers();
    try {
      const hang = <T,>(): Promise<T> => new Promise<T>(() => {});
      const machine: MachineReaderPorts = {
        cpu: () => ({ load1: 0.1, load5: 0.2, load15: 0.3 }),
        memory: () => ({ used: 1, total: 2, unit: 'bytes' }),
        disk: hang, // hung disk reader
        uptime: () => ({ seconds: 1 }),
        daemon: () => { throw new Error('systemctl unavailable'); }, // hanging systemctl stand-in
      };
      const activation: ReleaseActivationPort = { readActivation: () => Promise.reject(new Error('release manifest denied')) };
      const deployStore: DeployStoreReadPort = { listDeployments: () => [] };
      const source = { ...readers(), machine };

      const pending = composeHealth('repo', source, {
        scheduleSnapshot: () => ({ collectionRevision: 0, schedules: [] }),
        activation,
        deployStore,
      });
      await vi.advanceTimersByTimeAsync(2500);
      const response = await pending;

      const daemonMachine = response.sections[2].rows;
      expect(daemonMachine.filter((row) => row.kind === 'unavailable')).toHaveLength(3);
      expect(daemonMachine.filter((row) => row.kind !== 'unavailable').map((row) => row.key))
        .toEqual(['daemon-platform', 'cpu', 'memory', 'uptime']);
      expect(response.sections.map((section) => section.id)).toEqual(['fleet', 'stop', 'daemon-machine', 'mcp', 'usage']);
      expect(response.sections[0].rows.some((row) => row.kind === 'unavailable')).toBe(false);
      expect(response.sections[1].rows.some((row) => row.kind === 'unavailable')).toBe(false);
      expect(response.sections[3].rows.some((row) => row.kind === 'unavailable')).toBe(false);
      expect(response.sections[4].rows.some((row) => row.kind === 'unavailable')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * W6.3b — the PTY state migration is the one PTY fact Health reports. It is composed from a state the
 * store ALREADY reached (`migrationState()`), so the row costs no probe, no host and no filesystem read.
 */
describe('composeHealth — PTY state migration integrity row', () => {
  const fleetInput = (ptyMigrationState?: () => 'pending' | 'ok' | { refused: string }) => ({
    scheduleSnapshot: () => ({ collectionRevision: 0, schedules: [] as Schedule[] }),
    ...(ptyMigrationState ? { ptyMigrationState } : {}),
  });

  it('emits exactly ONE closed integrity row in Fleet when the migration refused', async () => {
    const response = await composeHealth('/repo', readers(), fleetInput(() => ({ refused: 'document-unavailable' })));

    const rows = response.sections[0].rows.filter((row) => row.key === 'pty-state-migration');
    expect(rows).toEqual([{
      kind: 'integrity',
      key: 'pty-state-migration',
      label: 'PTY state',
      value: {
        status: 'error',
        code: 'pty-state-migration-refused',
        detail: 'PTY state migration refused · terminals and session runs stay unavailable',
      },
      observedAt: now(),
      source: 'pty-store',
    }]);
  });

  it('says nothing while the migration is pending, has succeeded, or has no PTY stack at all', async () => {
    for (const input of [fleetInput(() => 'pending'), fleetInput(() => 'ok'), fleetInput()]) {
      const response = await composeHealth('/repo', readers(), input);
      expect(response.sections[0].rows.some((row) => row.key === 'pty-state-migration')).toBe(false);
    }
  });

  it('keeps the refusal visible even when the fleet reader itself fails', async () => {
    const failing = { ...readers(), fleet: vi.fn(() => { throw new Error('fleet reader down'); }) };

    const response = await composeHealth('/repo', failing, fleetInput(() => ({ refused: 'document-unavailable' })));

    expect(response.sections[0].rows.map((row) => row.key))
      .toEqual(['error:fleet', 'pty-state-migration']);
  });

  it('never probes or composes a PTY capability to answer it', async () => {
    probeSpy.mockClear();
    composeSpy.mockClear();

    await composeHealth('/repo', readers(), fleetInput(() => ({ refused: 'document-unavailable' })));

    expect(probeSpy).not.toHaveBeenCalled();
    expect(composeSpy).not.toHaveBeenCalled();
  });
});
/**
 * B1 closure - an optional launcher dropped by the pin validator is not fatal, so Health is the ONLY
 * surface on which an operator can see that one was dropped and why.
 */
describe('composeHealth - dropped PTY launcher integrity row', () => {
  const droppedInput = (ptyDroppedLaunchers?: () => readonly { launcher: string; refusal: string }[]) => ({
    scheduleSnapshot: () => ({ collectionRevision: 0, schedules: [] as Schedule[] }),
    ...(ptyDroppedLaunchers ? { ptyDroppedLaunchers } : {}),
  });

  it('emits exactly ONE closed integrity row naming every dropped launcher and its refusal', async () => {
    const response = await composeHealth('/repo', readers(), droppedInput(() => [
      { launcher: 'claude', refusal: 'launcher-changed' },
      { launcher: 'codex', refusal: 'launcher-unavailable' },
    ]));

    expect(response.sections[0].rows.filter((row) => row.key === 'pty-launcher-dropped')).toEqual([{
      kind: 'integrity',
      key: 'pty-launcher-dropped',
      label: 'PTY launchers',
      value: {
        status: 'error',
        code: 'pty-launcher-dropped',
        detail: 'Launcher dropped by the pin validator · claude (launcher-changed), '
          + 'codex (launcher-unavailable) · terminal offers the remaining launchers only',
      },
      observedAt: now(),
      source: 'pty-probe',
    }]);
  });

  it('says nothing when nothing was dropped, the reader is absent, or the reader throws', async () => {
    const throwing = droppedInput(() => { throw new Error('capability unavailable'); });
    for (const input of [droppedInput(() => []), droppedInput(), throwing]) {
      const response = await composeHealth('/repo', readers(), input);
      expect(response.sections[0].rows.some((row) => row.key === 'pty-launcher-dropped')).toBe(false);
    }
  });

  it('keeps the drop visible even when the fleet reader itself fails', async () => {
    const failing = { ...readers(), fleet: vi.fn(() => { throw new Error('fleet reader down'); }) };

    const response = await composeHealth('/repo', failing, droppedInput(() => [
      { launcher: 'claude', refusal: 'launcher-unavailable' },
    ]));

    expect(response.sections[0].rows.map((row) => row.key)).toEqual(['error:fleet', 'pty-launcher-dropped']);
  });
});
