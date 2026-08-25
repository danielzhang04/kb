import { existsSync, statfsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { freemem, loadavg, totalmem, uptime as hostUptimeSeconds } from 'node:os';
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
import { serviceCgroupChildCount } from '../release/serviceCgroup.ts';
import { composeDaemonMachineRows, type MachineReaderPorts } from './machineReaders.ts';
import { readReleaseRow, type ReleaseActivationPort } from './releaseReader.ts';
import { readDeployRow, type DeployStoreReadPort } from './deployReader.ts';
import type { DaemonRow, DaemonRowValue, DeployRow, MachineRow, ReleaseRow } from './probeBudget.ts';

export type { DaemonRow, DeployRow, MachineRow, ReleaseRow } from './probeBudget.ts';

export type FleetRow = { kind: 'fleet'; key: `agent:${string}`; label: string; value: { status: 'working' | 'active' | 'stale' | 'idle'; role: string | null; working: boolean; lastActive: string | null }; observedAt: string; source: 'fleet' };
export type StopRow = { kind: 'stop'; key: 'stop-file'; label: 'STOP'; value: 'present' | 'clear'; observedAt: string; source: 'stop' };
export type McpRow = { kind: 'mcp'; key: `mcp:${string}:${string}`; label: string; value: { project: string; server: string; tools: string[] }; observedAt: string; source: 'mcp-config' };
export type UsageRow = { kind: 'usage'; key: 'steps' | 'dispatches' | 'cards'; label: string; value: number; observedAt: string; source: 'usage' } | { kind: 'usage'; key: `model:${string}`; label: string; value: { steps: number; mix: number }; observedAt: string; source: 'usage' };
export type McpAvailabilityRow = { kind: 'deferred'; key: `mcp:${string}:${string}:vm` | `mcp:${string}:${string}:desktop`; label: 'VM availability' | 'Desktop availability'; value: 'unavailable in P1'; observedAt: string; source: 'deferred' };
export type HealthSectionId = 'fleet' | 'stop' | 'daemon-machine' | 'mcp' | 'usage';
export type UnavailableRow<S extends HealthSectionId = HealthSectionId> = { kind: 'unavailable'; key: `error:${S}`; label: 'Unavailable'; value: { status: 'unavailable'; reason: string }; observedAt: string; source: 'error' };
export type ScheduleIntegrityRow = ScheduleOwnerIntegrityRow & { label: 'Schedule owner' };
/** The v1 -> v2 PTY state migration refused, so every PTY write is fail-closed for this daemon's lifetime.
 *  Exactly one row, present ONLY on refusal: a healthy or not-yet-attempted migration says nothing. */
export type PtyMigrationIntegrityRow = {
  kind: 'integrity';
  key: 'pty-state-migration';
  label: 'PTY state';
  value: { status: 'error'; code: 'pty-state-migration-refused'; detail: string };
  observedAt: string;
  source: 'pty-store';
};
/** One or more OPTIONAL launchers were dropped from an otherwise-available PTY host because their own
 *  tree failed the pin. Present ONLY when something was dropped: a host that advertised everything it
 *  found says nothing. This is the operator's only reading of "your Claude binary was tampered with"
 *  — the drop itself is deliberately not fatal, so without this row it would be invisible. */
export type PtyLauncherIntegrityRow = {
  kind: 'integrity';
  key: 'pty-launcher-dropped';
  label: 'PTY launchers';
  value: { status: 'error'; code: 'pty-launcher-dropped'; detail: string };
  observedAt: string;
  source: 'pty-probe';
};
export type HealthRow = FleetRow | ScheduleIntegrityRow | PtyMigrationIntegrityRow | PtyLauncherIntegrityRow | StopRow | MachineRow | DaemonRow | ReleaseRow | DeployRow | McpRow | UsageRow | McpAvailabilityRow | UnavailableRow;
export type HealthResponse = { sections: [
  { id: 'fleet'; label: 'Fleet'; rows: Array<FleetRow | ScheduleIntegrityRow | PtyMigrationIntegrityRow | PtyLauncherIntegrityRow | UnavailableRow<'fleet'>> },
  { id: 'stop'; label: 'STOP'; rows: Array<StopRow | UnavailableRow<'stop'>> },
  { id: 'daemon-machine'; label: 'Daemon and machine'; rows: Array<MachineRow | DaemonRow | ReleaseRow | DeployRow | UnavailableRow<'daemon-machine'>> },
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
  /** §3.5 machine + daemon probe ports (cpu/memory/disk/uptime/daemon). Host-level like `platform`, so a
   *  real default lives on `defaultHealthReaders`; every probe is bounded by `machineReaders.ts#withBudget`
   *  and degrades to one closed `UnavailableRow` rather than stalling the section. */
  machine: MachineReaderPorts;
}

/** Structural, not imported from `server/pty/`: Health composing this row must not pull the PTY module
 *  graph (and its host probe) into a read route. `SessionRunStore#migrationState` satisfies it by shape. */
export type PtyMigrationStateReader = () => 'pending' | 'ok' | { refused: string };
/** Structural for the same reason: the composed capability already holds the closed `{launcher, refusal}`
 *  pairs, so Health reads them as data and never constructs or re-probes a PTY host. */
export type PtyDroppedLauncherReader = () => readonly { launcher: string; refusal: string }[];

export interface HealthFleetInput {
  scheduleSnapshot: () => { collectionRevision: number; schedules: readonly Schedule[] };
  /** Absent on a daemon with no PTY stack (probe refused) — which is not a migration refusal, so no row. */
  ptyMigrationState?: PtyMigrationStateReader;
  /** Absent when the composed capability advertised no PTY host, or dropped nothing. */
  ptyDroppedLaunchers?: PtyDroppedLauncherReader;
  /** P5 W6.2 [P5-C30]: the SAME shared activation port Home reads (constructed once by W6.1, threaded
   *  through `SurfaceContext.activationReader`). Absent only in tests that don't exercise the Release row,
   *  in which case Release reports unavailable rather than this module constructing a reader of its own. */
  activation?: ReleaseActivationPort;
  /** Narrow read port over `ControlPlaneStore#listDeployments`. Absent only in tests that don't exercise
   *  the Deployment row, in which case no `DeployRow` is produced — never a synthesized empty one. */
  deployStore?: DeployStoreReadPort;
}

const noActivationPort: ReleaseActivationPort = {
  readActivation: () => Promise.reject(new Error('no activation reader configured')),
};
const noDeployStorePort: DeployStoreReadPort = { listDeployments: () => [] };

const emptyFleetInput: HealthFleetInput = {
  scheduleSnapshot: () => ({ collectionRevision: 0, schedules: [] }),
};

/** ONE row, and only when the migration actually refused. `pending` (nothing has written yet) and `ok` are
 *  both silent: a row that appeared on every boot would be noise the operator learns to ignore. */
function ptyMigrationRows(observedAt: string, reader: PtyMigrationStateReader | undefined): PtyMigrationIntegrityRow[] {
  if (reader === undefined) return [];
  let state: ReturnType<PtyMigrationStateReader>;
  try {
    state = reader();
  } catch {
    return [];
  }
  if (typeof state !== 'object' || state === null || typeof state.refused !== 'string') return [];
  return [{
    kind: 'integrity',
    key: 'pty-state-migration',
    label: 'PTY state',
    value: {
      status: 'error',
      code: 'pty-state-migration-refused',
      // The separator is written as an escape, never a literal middot byte.
      detail: 'PTY state migration refused \u00b7 terminals and session runs stay unavailable',
    },
    observedAt,
    source: 'pty-store',
  }];
}

/** ONE row listing every dropped launcher, and only when at least one was dropped. The detail names the
 *  launcher and its closed refusal code and nothing else — no path, no ACL, no SID. */
function ptyLauncherRows(observedAt: string, reader: PtyDroppedLauncherReader | undefined): PtyLauncherIntegrityRow[] {
  if (reader === undefined) return [];
  let dropped: readonly { launcher: string; refusal: string }[];
  try {
    dropped = reader();
  } catch {
    return [];
  }
  if (!Array.isArray(dropped) || dropped.length === 0) return [];
  // The separator is written as an escape, never a literal middot byte.
  const named = dropped.map((entry) => `${entry.launcher} (${entry.refusal})`).join(', ');
  return [{
    kind: 'integrity',
    key: 'pty-launcher-dropped',
    label: 'PTY launchers',
    value: {
      status: 'error',
      code: 'pty-launcher-dropped',
      detail: `Launcher dropped by the pin validator \u00b7 ${named} \u00b7 terminal offers the remaining launchers only`,
    },
    observedAt,
    source: 'pty-probe',
  }];
}

const deferredValue = 'unavailable in P1' as const;

/** Real §3.5 daemon reader: `systemctl show` for identity plus the existing cgroup walk. Throws freely —
 *  the shared `withBudget` wrapper (`machineReaders.ts`) turns any throw or hang into a closed
 *  `UnavailableRow`, so a non-systemd host (e.g. this daemon's Windows dev box) simply degrades this one
 *  row rather than the section. */
function realDaemonReader(): DaemonRowValue {
  const unit = process.env.DASHBOARD_SERVICE_UNIT ?? 'kb-dashboard.service';
  const show = (property: string) =>
    execFileSync('systemctl', ['show', '--property', property, '--value', unit], { encoding: 'utf8' }).trim();
  const mainPid = Number.parseInt(show('MainPID'), 10);
  const loadedRoot = show('FragmentPath');
  const childCount = serviceCgroupChildCount(unit);
  return { unit, mainPid, loadedRoot, childCount };
}

/** Real §3.5 machine ports. `os.loadavg()` is `[0,0,0]` on platforms without a load-average concept
 *  (Windows) — still a valid finite reading, never a fault. */
export const realMachineReaderPorts: MachineReaderPorts = {
  cpu: () => {
    const [load1, load5, load15] = loadavg();
    return { load1, load5, load15 };
  },
  memory: () => {
    const total = totalmem();
    return { used: total - freemem(), total, unit: 'bytes' };
  },
  disk: () => {
    const stats = statfsSync(process.cwd());
    const total = stats.blocks * stats.bsize;
    const used = total - stats.bfree * stats.bsize;
    return { used, total, unit: 'bytes' };
  },
  uptime: () => ({ seconds: Math.floor(hostUptimeSeconds()) }),
  daemon: realDaemonReader,
};

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
  machine: realMachineReaderPorts,
};

function unavailable<S extends HealthSectionId>(id: S, observedAt: string): UnavailableRow<S> {
  return {
    kind: 'unavailable', key: `error:${id}`, label: 'Unavailable',
    value: { status: 'unavailable', reason: 'Reader unavailable' }, observedAt, source: 'error',
  };
}

function isMachinePlatform(platform: NodeJS.Platform): platform is 'win32' | 'linux' {
  return platform === 'win32' || platform === 'linux';
}

function fleetRows(
  repoRoot: string,
  observedAt: string,
  reader: FleetReader,
  ownerReader: HealthReaders['owners'],
  scheduleSnapshot: HealthFleetInput['scheduleSnapshot'],
  ptyMigrationState: HealthFleetInput['ptyMigrationState'],
  ptyDroppedLaunchers: HealthFleetInput['ptyDroppedLaunchers'],
): Array<FleetRow | ScheduleIntegrityRow | PtyMigrationIntegrityRow | PtyLauncherIntegrityRow | UnavailableRow<'fleet'>> {
  // Composed OUTSIDE the fleet try: a PTY migration refusal is exactly the moment the operator needs the
  // row, and it must not be swallowed by (or swallow) an unrelated fleet-reader failure. The dropped-
  // launcher row is composed on the same terms and for the same reason.
  const ptyIntegrity = [
    ...ptyMigrationRows(observedAt, ptyMigrationState),
    ...ptyLauncherRows(observedAt, ptyDroppedLaunchers),
  ];
  try {
    const schedules = scheduleSnapshot().schedules;
    const fleet: FleetRow[] = reader(repoRoot).agents.map((agent) => ({
      kind: 'fleet', key: `agent:${agent.id}`, label: humanizeEntityId(agent.id),
      value: { status: agent.status, role: agent.role, working: agent.working, lastActive: agent.lastActive },
      observedAt, source: 'fleet',
    }));
    const integrity = projectScheduleOwnerIntegrity(schedules, ownerReader(repoRoot), () => observedAt)
      .map((row) => ({ ...row, label: 'Schedule owner' as const }));
    return [...fleet, ...integrity, ...ptyIntegrity];
  } catch {
    return [unavailable('fleet', observedAt), ...ptyIntegrity];
  }
}

function stopRows(repoRoot: string, observedAt: string, reader: HealthReaders['stop']): Array<StopRow | UnavailableRow<'stop'>> {
  try {
    return [{ kind: 'stop', key: 'stop-file', label: 'STOP', value: reader(repoRoot) ? 'present' : 'clear', observedAt, source: 'stop' }];
  } catch {
    return [unavailable('stop', observedAt)];
  }
}

function platformRow(observedAt: string, reader: HealthReaders['platform']): MachineRow | UnavailableRow<'daemon-machine'> {
  try {
    const platform = reader();
    if (!isMachinePlatform(platform)) return unavailable('daemon-machine', observedAt);
    return { kind: 'machine', key: 'daemon-platform', label: 'Daemon', value: platform, observedAt, source: 'machine' };
  } catch {
    return unavailable('daemon-machine', observedAt);
  }
}

/**
 * The full `daemon-machine` section (§3.5): the synchronous platform row plus the four bounded probe
 * groups — cpu/memory/disk/uptime + daemon (via `machineReaders.ts#composeDaemonMachineRows`, itself
 * wrapped at the 2500 ms section ceiling), the Release row (fed by the SAME injected activation port Home
 * uses — never a checkout read), and the latest Deployment (absent, never synthesized, when none exists
 * yet). Every probe resolves independently, so a hung disk read, a hanging `systemctl`, or a throwing
 * release reader degrade only their own row while the rest of the section — and the other four Health
 * sections entirely — stay ready.
 */
async function daemonMachineRows(
  observedAt: string,
  platformReader: HealthReaders['platform'],
  machinePorts: MachineReaderPorts,
  activation: ReleaseActivationPort,
  deployStore: DeployStoreReadPort,
): Promise<Array<MachineRow | DaemonRow | ReleaseRow | DeployRow | UnavailableRow<'daemon-machine'>>> {
  const fixedNow = () => observedAt;
  const [machineAndDaemon, release, deploy] = await Promise.all([
    composeDaemonMachineRows(machinePorts, fixedNow),
    readReleaseRow(activation, fixedNow),
    readDeployRow(deployStore, fixedNow),
  ]);
  return [platformRow(observedAt, platformReader), ...machineAndDaemon, release, ...(deploy ? [deploy] : [])];
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

/** Compose the closed Health response directly from its server readers. Async ONLY because the
 *  `daemon-machine` section now composes bounded probes (§3.5); every other section stays synchronous. */
export async function composeHealth(
  repoRoot: string,
  readers: HealthReaders = defaultHealthReaders,
  fleetInput: HealthFleetInput = emptyFleetInput,
): Promise<HealthResponse> {
  const observedAt = readers.now();
  const daemonMachine = await daemonMachineRows(
    observedAt, readers.platform, readers.machine,
    fleetInput.activation ?? noActivationPort, fleetInput.deployStore ?? noDeployStorePort,
  );
  return {
    sections: [
      { id: 'fleet', label: 'Fleet', rows: fleetRows(repoRoot, observedAt, readers.fleet, readers.owners, fleetInput.scheduleSnapshot, fleetInput.ptyMigrationState, fleetInput.ptyDroppedLaunchers) },
      { id: 'stop', label: 'STOP', rows: stopRows(repoRoot, observedAt, readers.stop) },
      { id: 'daemon-machine', label: 'Daemon and machine', rows: daemonMachine },
      { id: 'mcp', label: 'MCP', rows: mcpRows(repoRoot, observedAt, readers.connections) },
      { id: 'usage', label: 'Usage', rows: usageRows(repoRoot, observedAt, readers.usage) },
    ],
  };
}
