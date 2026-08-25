// Dashboard v3 P5 — W0 Health contracts: the four new `daemon-machine` row kinds (§3.5) and the bounded
// probe-budget table. Types, budget constants, and strict decoders ONLY — the readers are W4 and the
// `valueFor`/CSS cutover is W6.2 (plan §5 W0). Nothing here runs a probe or touches the filesystem.
//
// The budgets are STRUCTURAL, not advisory (§3.5): W4 invokes each reader through one `withBudget`
// wrapper that RESOLVES (never rejects) and turns a timeout, throw, or malformed value into the shipped
// closed `UnavailableRow` with a `reason` from `PROBE_UNAVAILABLE_REASONS`.
import {
  ContractDecodeError, closedObject, isCommitSha, isDigestSha256, requireString,
} from '../write/durableManifest.ts';
import { DEPLOYMENT_STATES } from '../control/deploymentState.ts';
import type { DeploymentState } from '../control/deploymentState.ts';

// ---------------------------------------------------------------------------------------------------
// Probe-budget table (§3.5). Hard per-probe ceilings plus one section ceiling.
// ---------------------------------------------------------------------------------------------------

export type ProbeKind = 'cpu' | 'memory' | 'uptime' | 'disk' | 'release' | 'daemon' | 'deploy';

export const PROBE_BUDGETS_MS = {
  cpu: 250,
  memory: 250,
  uptime: 250,
  disk: 750,
  release: 1000,
  daemon: 1500,
  deploy: 250,
} as const satisfies Record<ProbeKind, number>;

/** The whole `daemon-machine` composition is additionally wrapped at this ceiling (§3.5). */
export const DAEMON_MACHINE_SECTION_BUDGET_MS = 2500;

export function probeBudgetMs(kind: ProbeKind): number {
  const ms = PROBE_BUDGETS_MS[kind];
  if (ms === undefined) throw new ContractDecodeError('probeBudget', `unknown probe kind ${JSON.stringify(kind)}`);
  return ms;
}

/** The closed reason union the `withBudget` wrapper draws from; raw stderr never reaches a row (§3.5). */
export type ProbeUnavailableReason = 'timeout' | 'unavailable' | 'invalid';
export const PROBE_UNAVAILABLE_REASONS: readonly ProbeUnavailableReason[] = ['timeout', 'unavailable', 'invalid'];

export function isProbeUnavailableReason(value: unknown): value is ProbeUnavailableReason {
  return typeof value === 'string' && PROBE_UNAVAILABLE_REASONS.includes(value as ProbeUnavailableReason);
}

// ---------------------------------------------------------------------------------------------------
// The four `daemon-machine` row kinds (§3.5). All carry `observedAt`.
// ---------------------------------------------------------------------------------------------------

export type MachineRow =
  | { kind: 'machine'; key: 'daemon-platform'; label: 'Daemon'; value: 'win32' | 'linux'; observedAt: string; source: 'machine' }
  | { kind: 'machine'; key: 'cpu'; label: string; value: { load1: number; load5: number; load15: number }; observedAt: string; source: 'machine' }
  | { kind: 'machine'; key: 'memory' | 'disk'; label: string; value: { used: number; total: number; unit: string }; observedAt: string; source: 'machine' }
  | { kind: 'machine'; key: 'uptime'; label: string; value: { seconds: number }; observedAt: string; source: 'machine' };

export interface DaemonRowValue {
  readonly unit: string;
  readonly mainPid: number;
  readonly loadedRoot: string;
  readonly childCount: number;
}
export type DaemonRow = {
  kind: 'daemon'; key: 'service'; label: 'Service'; value: DaemonRowValue; observedAt: string; source: 'daemon';
};

export interface ReleaseRowValue {
  readonly sha: string;
  readonly archiveSha256: string;
  readonly activatedAt: string;
  readonly rollbackAvailable: boolean;
}
export type ReleaseRow = {
  kind: 'release'; key: 'release'; label: 'Release'; value: ReleaseRowValue; observedAt: string; source: 'release';
};

export interface DeployRowValue {
  readonly deploymentRef: string;
  readonly state: DeploymentState;
  readonly targetCommit: string;
  readonly previousCommit: string;
  readonly error: string | null;
}
export type DeployRow = {
  kind: 'deploy'; key: `deploy:${string}`; label: 'Deployment'; value: DeployRowValue; observedAt: string; source: 'deploy';
};

/** The four P5 `daemon-machine` rows. W6.2 folds these into the shipped `HealthRow` union. */
export type P5DaemonMachineRow = MachineRow | DaemonRow | ReleaseRow | DeployRow;

// ---------------------------------------------------------------------------------------------------
// Strict decoders. Object-valued rows verify every field; the deploy row's key is `deploy:<ref>`.
// ---------------------------------------------------------------------------------------------------

function requireInteger(record: Record<string, unknown>, key: string, field: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ContractDecodeError(`${field}.${key}`, 'integer required');
  }
  return value;
}
function requireObservedAt(record: Record<string, unknown>, field: string): string {
  return requireString(record, 'observedAt', field);
}

const MACHINE_KEYS = ['kind', 'key', 'label', 'value', 'observedAt', 'source'] as const;

export function decodeMachineRow(value: unknown): MachineRow {
  const record = closedObject(value, MACHINE_KEYS, 'machineRow');
  if (record['kind'] !== 'machine') throw new ContractDecodeError('machineRow.kind', "'machine' required");
  if (record['source'] !== 'machine') throw new ContractDecodeError('machineRow.source', "'machine' required");
  const observedAt = requireObservedAt(record, 'machineRow');
  const key = record['key'];
  const rawValue = record['value'];
  switch (key) {
    case 'daemon-platform': {
      if (rawValue !== 'win32' && rawValue !== 'linux') {
        throw new ContractDecodeError('machineRow.value', "'win32' | 'linux' required");
      }
      if (record['label'] !== 'Daemon') throw new ContractDecodeError('machineRow.label', "'Daemon' required");
      return { kind: 'machine', key, label: 'Daemon', value: rawValue, observedAt, source: 'machine' };
    }
    case 'cpu': {
      const v = closedObject(rawValue, ['load1', 'load5', 'load15'], 'machineRow.value');
      const load1 = numberField(v, 'load1', 'machineRow.value');
      const load5 = numberField(v, 'load5', 'machineRow.value');
      const load15 = numberField(v, 'load15', 'machineRow.value');
      return { kind: 'machine', key, label: requireString(record, 'label', 'machineRow'), value: { load1, load5, load15 }, observedAt, source: 'machine' };
    }
    case 'memory':
    case 'disk': {
      const v = closedObject(rawValue, ['used', 'total', 'unit'], 'machineRow.value');
      const used = numberField(v, 'used', 'machineRow.value');
      const total = numberField(v, 'total', 'machineRow.value');
      const unit = requireString(v, 'unit', 'machineRow.value');
      return { kind: 'machine', key, label: requireString(record, 'label', 'machineRow'), value: { used, total, unit }, observedAt, source: 'machine' };
    }
    case 'uptime': {
      const v = closedObject(rawValue, ['seconds'], 'machineRow.value');
      const seconds = requireInteger(v, 'seconds', 'machineRow.value');
      return { kind: 'machine', key, label: requireString(record, 'label', 'machineRow'), value: { seconds }, observedAt, source: 'machine' };
    }
    default:
      throw new ContractDecodeError('machineRow.key', 'closed machine key required');
  }
}

function numberField(record: Record<string, unknown>, key: string, field: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new ContractDecodeError(`${field}.${key}`, 'finite number required');
  return value;
}

const DAEMON_KEYS = ['kind', 'key', 'label', 'value', 'observedAt', 'source'] as const;
export function decodeDaemonRow(value: unknown): DaemonRow {
  const record = closedObject(value, DAEMON_KEYS, 'daemonRow');
  if (record['kind'] !== 'daemon') throw new ContractDecodeError('daemonRow.kind', "'daemon' required");
  if (record['key'] !== 'service') throw new ContractDecodeError('daemonRow.key', "'service' required");
  if (record['label'] !== 'Service') throw new ContractDecodeError('daemonRow.label', "'Service' required");
  if (record['source'] !== 'daemon') throw new ContractDecodeError('daemonRow.source', "'daemon' required");
  const v = closedObject(record['value'], ['unit', 'mainPid', 'loadedRoot', 'childCount'], 'daemonRow.value');
  return {
    kind: 'daemon', key: 'service', label: 'Service',
    value: {
      unit: requireString(v, 'unit', 'daemonRow.value'),
      mainPid: requireInteger(v, 'mainPid', 'daemonRow.value'),
      loadedRoot: requireString(v, 'loadedRoot', 'daemonRow.value'),
      childCount: requireInteger(v, 'childCount', 'daemonRow.value'),
    },
    observedAt: requireObservedAt(record, 'daemonRow'), source: 'daemon',
  };
}

const RELEASE_KEYS = ['kind', 'key', 'label', 'value', 'observedAt', 'source'] as const;
export function decodeReleaseRow(value: unknown): ReleaseRow {
  const record = closedObject(value, RELEASE_KEYS, 'releaseRow');
  if (record['kind'] !== 'release') throw new ContractDecodeError('releaseRow.kind', "'release' required");
  if (record['key'] !== 'release') throw new ContractDecodeError('releaseRow.key', "'release' required");
  if (record['label'] !== 'Release') throw new ContractDecodeError('releaseRow.label', "'Release' required");
  if (record['source'] !== 'release') throw new ContractDecodeError('releaseRow.source', "'release' required");
  const v = closedObject(record['value'], ['sha', 'archiveSha256', 'activatedAt', 'rollbackAvailable'], 'releaseRow.value');
  const sha = requireString(v, 'sha', 'releaseRow.value');
  if (!isCommitSha(sha)) throw new ContractDecodeError('releaseRow.value.sha', '40 lowercase hex required');
  if (!isDigestSha256(v['archiveSha256'])) throw new ContractDecodeError('releaseRow.value.archiveSha256', '64 lowercase hex required');
  if (typeof v['rollbackAvailable'] !== 'boolean') throw new ContractDecodeError('releaseRow.value.rollbackAvailable', 'boolean required');
  return {
    kind: 'release', key: 'release', label: 'Release',
    value: {
      sha, archiveSha256: v['archiveSha256'] as string,
      activatedAt: requireString(v, 'activatedAt', 'releaseRow.value'),
      rollbackAvailable: v['rollbackAvailable'],
    },
    observedAt: requireObservedAt(record, 'releaseRow'), source: 'release',
  };
}

const DEPLOY_ROW_KEYS = ['kind', 'key', 'label', 'value', 'observedAt', 'source'] as const;
const DEPLOYMENT_STATE_SET: ReadonlySet<string> = new Set(DEPLOYMENT_STATES);
export function decodeDeployRow(value: unknown): DeployRow {
  const record = closedObject(value, DEPLOY_ROW_KEYS, 'deployRow');
  if (record['kind'] !== 'deploy') throw new ContractDecodeError('deployRow.kind', "'deploy' required");
  if (record['label'] !== 'Deployment') throw new ContractDecodeError('deployRow.label', "'Deployment' required");
  if (record['source'] !== 'deploy') throw new ContractDecodeError('deployRow.source', "'deploy' required");
  const key = record['key'];
  if (typeof key !== 'string' || !key.startsWith('deploy:') || key.length <= 'deploy:'.length) {
    throw new ContractDecodeError('deployRow.key', "'deploy:<ref>' required");
  }
  const v = closedObject(record['value'], ['deploymentRef', 'state', 'targetCommit', 'previousCommit', 'error'], 'deployRow.value');
  const state = v['state'];
  if (typeof state !== 'string' || !DEPLOYMENT_STATE_SET.has(state)) {
    throw new ContractDecodeError('deployRow.value.state', 'closed deployment state required');
  }
  const error = v['error'];
  if (error !== null && typeof error !== 'string') throw new ContractDecodeError('deployRow.value.error', 'string or null required');
  return {
    kind: 'deploy', key: key as `deploy:${string}`, label: 'Deployment',
    value: {
      deploymentRef: requireString(v, 'deploymentRef', 'deployRow.value'),
      state: state as DeploymentState,
      targetCommit: requireString(v, 'targetCommit', 'deployRow.value'),
      previousCommit: requireString(v, 'previousCommit', 'deployRow.value'),
      error: error as string | null,
    },
    observedAt: requireObservedAt(record, 'deployRow'), source: 'deploy',
  };
}
