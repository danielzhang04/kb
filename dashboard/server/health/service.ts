import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadOverride, loadPolicy } from '../routing/policy.ts';
import { indexConnections } from '../registry/connections.ts';
import { buildHealthPanel } from './fleet.ts';
import { buildUsagePanel } from './usage.ts';
import { runtimeHostCapabilities } from '../runtime/capabilities.ts';
import type { LivenessStatus } from './fleet.ts';
import { humanizeEntityId } from '../../src/entity/humanizeEntityId.ts';
import type { RunnableRef, Schedule } from '../control/p2Contracts.ts';
import type { ScheduleOwnerIntegrityRow } from '../home/contracts.ts';
import { projectScheduleOwnerIntegrity } from './scheduleOwnerIntegrity.ts';
import { declaredScheduleOwners } from '../schedules/owners.ts';

export type FleetRow = { kind: 'fleet'; key: `agent:${string}`; label: string; value: { status: 'working' | 'active' | 'stale' | 'idle'; role: string | null; working: boolean; lastActive: string | null }; observedAt: string; source: 'fleet' };
export type StopRow = { kind: 'stop'; key: 'stop-file'; label: 'STOP'; value: 'present' | 'clear'; observedAt: string; source: 'stop' };
export type MachineRow = { kind: 'machine'; key: 'daemon-platform'; label: 'Daemon'; value: 'win32' | 'linux'; observedAt: string; source: 'machine' };
export type McpRow = { kind: 'mcp'; key: `mcp:${string}:${string}`; label: string; value: { project: string; server: string; tools: string[] }; observedAt: string; source: 'mcp-config' };
export type UsageRow = { kind: 'usage'; key: 'steps' | 'dispatches' | 'cards'; label: string; value: number; observedAt: string; source: 'usage' } | { kind: 'usage'; key: `model:${string}`; label: string; value: { steps: number; mix: number }; observedAt: string; source: 'usage' };
export type ReleaseRow = { kind: 'deferred'; key: 'release'; label: 'Release'; value: 'unavailable in P1'; observedAt: string; source: 'deferred' };
export type McpAvailabilityRow = { kind: 'deferred'; key: `mcp:${string}:${string}:vm` | `mcp:${string}:${string}:desktop`; label: 'VM availability' | 'Desktop availability'; value: 'unavailable in P1'; observedAt: string; source: 'deferred' };
export type HealthSectionId = 'fleet' | 'stop' | 'daemon-machine' | 'mcp' | 'usage';
export type UnavailableRow<S extends HealthSectionId = HealthSectionId> = { kind: 'unavailable'; key: `error:${S}`; label: 'Unavailable'; value: { status: 'unavailable'; reason: string }; observedAt: string; source: 'error' };
export type ScheduleIntegrityRow = ScheduleOwnerIntegrityRow & { label: 'Schedule owner' };
export type HealthRow = FleetRow | ScheduleIntegrityRow | StopRow | MachineRow | McpRow | UsageRow | ReleaseRow | McpAvailabilityRow | UnavailableRow;
export type HealthResponse = { sections: [
  { id: 'fleet'; label: 'Fleet'; rows: Array<FleetRow | ScheduleIntegrityRow | UnavailableRow<'fleet'>> },
  { id: 'stop'; label: 'STOP'; rows: Array<StopRow | UnavailableRow<'stop'>> },
  { id: 'daemon-machine'; label: 'Daemon and machine'; rows: Array<MachineRow | ReleaseRow | UnavailableRow<'daemon-machine'>> },
  { id: 'mcp'; label: 'MCP'; rows: Array<McpRow | McpAvailabilityRow | UnavailableRow<'mcp'>> },
  { id: 'usage'; label: 'Usage'; rows: Array<UsageRow | UnavailableRow<'usage'>> },
] };

type FleetReader = (repoRoot: string) => { agents: Array<{ id: string; role: string | null; status: LivenessStatus; working: boolean; lastActive: string | null }> };
type ConnectionsReader = (repoRoot: string) => { items: Array<{ project: string; server: string; tools: string[] }> };
type UsageReader = (repoRoot: string) => { stepCount: number; dispatchCount: number; cards: number; models: Array<{ model: string; steps: number; mix: number }> };

export interface HealthReaders {
  fleet: FleetReader;
  stop: (repoRoot: string) => boolean;
  platform: () => NodeJS.Platform;
  connections: ConnectionsReader;
  usage: UsageReader;
  owners: (repoRoot: string) => RunnableRef[];
  now: () => string;
}

export interface HealthFleetInput {
  scheduleSnapshot: () => { collectionRevision: number; schedules: readonly Schedule[] };
}

const emptyFleetInput: HealthFleetInput = {
  scheduleSnapshot: () => ({ collectionRevision: 0, schedules: [] }),
};

const deferredValue = 'unavailable in P1' as const;

export const defaultHealthReaders: HealthReaders = {
  fleet: (repoRoot) => buildHealthPanel(repoRoot, loadPolicy(repoRoot), loadOverride(repoRoot)),
  stop: (repoRoot) => existsSync(join(repoRoot, 'STOP')),
  // Health reads the non-PTY host slice only: reporting the daemon platform must never construct or
  // probe a PTY capability.
  platform: () => runtimeHostCapabilities().platform,
  connections: indexConnections,
  usage: buildUsagePanel,
  owners: declaredScheduleOwners,
  now: () => new Date().toISOString(),
};

function unavailable<S extends HealthSectionId>(id: S, observedAt: string): UnavailableRow<S> {
  return {
    kind: 'unavailable', key: `error:${id}`, label: 'Unavailable',
    value: { status: 'unavailable', reason: 'Reader unavailable' }, observedAt, source: 'error',
  };
}

function isMachinePlatform(platform: NodeJS.Platform): platform is MachineRow['value'] {
  return platform === 'win32' || platform === 'linux';
}

function fleetRows(
  repoRoot: string,
  observedAt: string,
  reader: FleetReader,
  ownerReader: HealthReaders['owners'],
  scheduleSnapshot: HealthFleetInput['scheduleSnapshot'],
): Array<FleetRow | ScheduleIntegrityRow | UnavailableRow<'fleet'>> {
  try {
    const schedules = scheduleSnapshot().schedules;
    const fleet: FleetRow[] = reader(repoRoot).agents.map((agent) => ({
      kind: 'fleet', key: `agent:${agent.id}`, label: humanizeEntityId(agent.id),
      value: { status: agent.status, role: agent.role, working: agent.working, lastActive: agent.lastActive },
      observedAt, source: 'fleet',
    }));
    const integrity = projectScheduleOwnerIntegrity(schedules, ownerReader(repoRoot), () => observedAt)
      .map((row) => ({ ...row, label: 'Schedule owner' as const }));
    return [...fleet, ...integrity];
  } catch {
    return [unavailable('fleet', observedAt)];
  }
}

function stopRows(repoRoot: string, observedAt: string, reader: HealthReaders['stop']): Array<StopRow | UnavailableRow<'stop'>> {
  try {
    return [{ kind: 'stop', key: 'stop-file', label: 'STOP', value: reader(repoRoot) ? 'present' : 'clear', observedAt, source: 'stop' }];
  } catch {
    return [unavailable('stop', observedAt)];
  }
}

function machineRows(observedAt: string, reader: HealthReaders['platform']): Array<MachineRow | ReleaseRow | UnavailableRow<'daemon-machine'>> {
  const release: ReleaseRow = { kind: 'deferred', key: 'release', label: 'Release', value: deferredValue, observedAt, source: 'deferred' };
  try {
    const platform = reader();
    if (!isMachinePlatform(platform)) return [release, unavailable('daemon-machine', observedAt)];
    return [{ kind: 'machine', key: 'daemon-platform', label: 'Daemon', value: platform, observedAt, source: 'machine' }, release];
  } catch {
    return [release, unavailable('daemon-machine', observedAt)];
  }
}

function mcpRows(repoRoot: string, observedAt: string, reader: ConnectionsReader): Array<McpRow | McpAvailabilityRow | UnavailableRow<'mcp'>> {
  try {
    return [...reader(repoRoot).items]
      .sort((a, b) => a.project.localeCompare(b.project) || a.server.localeCompare(b.server))
      .flatMap((connection) => {
        const key = `mcp:${connection.project}:${connection.server}` as const;
        const configured: McpRow = {
          kind: 'mcp', key, label: `${connection.project} / ${connection.server}`,
          value: { project: connection.project, server: connection.server, tools: [...connection.tools] }, observedAt, source: 'mcp-config',
        };
        return [
          configured,
          { kind: 'deferred' as const, key: `${key}:vm` as const, label: 'VM availability' as const, value: deferredValue, observedAt, source: 'deferred' as const },
          { kind: 'deferred' as const, key: `${key}:desktop` as const, label: 'Desktop availability' as const, value: deferredValue, observedAt, source: 'deferred' as const },
        ];
      });
  } catch {
    return [unavailable('mcp', observedAt)];
  }
}

function usageRows(repoRoot: string, observedAt: string, reader: UsageReader): Array<UsageRow | UnavailableRow<'usage'>> {
  try {
    const usage = reader(repoRoot);
    return [
      { kind: 'usage', key: 'steps', label: 'Steps', value: usage.stepCount, observedAt, source: 'usage' },
      { kind: 'usage', key: 'dispatches', label: 'Dispatches', value: usage.dispatchCount, observedAt, source: 'usage' },
      { kind: 'usage', key: 'cards', label: 'Cards', value: usage.cards, observedAt, source: 'usage' },
      ...usage.models.map((model) => ({
        kind: 'usage' as const, key: `model:${model.model}` as const, label: model.model,
        value: { steps: model.steps, mix: model.mix }, observedAt, source: 'usage' as const,
      })),
    ];
  } catch {
    return [unavailable('usage', observedAt)];
  }
}

/** Compose the closed Health response directly from its server readers. */
export function composeHealth(
  repoRoot: string,
  readers: HealthReaders = defaultHealthReaders,
  fleetInput: HealthFleetInput = emptyFleetInput,
): HealthResponse {
  const observedAt = readers.now();
  return {
    sections: [
      { id: 'fleet', label: 'Fleet', rows: fleetRows(repoRoot, observedAt, readers.fleet, readers.owners, fleetInput.scheduleSnapshot) },
      { id: 'stop', label: 'STOP', rows: stopRows(repoRoot, observedAt, readers.stop) },
      { id: 'daemon-machine', label: 'Daemon and machine', rows: machineRows(observedAt, readers.platform) },
      { id: 'mcp', label: 'MCP', rows: mcpRows(repoRoot, observedAt, readers.connections) },
      { id: 'usage', label: 'Usage', rows: usageRows(repoRoot, observedAt, readers.usage) },
    ],
  };
}
