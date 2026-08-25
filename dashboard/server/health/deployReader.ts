// Dashboard v3 P5 — W4 Health deploy reader (§3.5). Fed by `control/store.ts#listDeployments` through a
// narrow injected read port — never the whole `ControlPlaneStore`. Bounded by the shared `withBudget`
// wrapper at the §3.5 `deploy` budget (250 ms). No deployment yet is not a failure: the row is simply
// absent (`null`), never a synthesized empty row. This is a display row only (ux-rule 11) — no spend
// field, no control.
import { DEPLOYMENT_STATES, type DeploymentState } from '../control/deploymentState.ts';
import type { UnavailableRow } from './service.ts';
import type { DeployRow, DeployRowValue } from './probeBudget.ts';
import { withBudget, type SchedulerPort } from './machineReaders.ts';

export interface DeployStoreDeploymentRecord {
  readonly deploymentRef: string;
  readonly state: string;
  readonly targetCommit: string;
  readonly previousCommit: string;
  readonly error: string | null;
  readonly requestedAt: string;
}

/** Narrow read-only slice of `ControlPlaneStore#listDeployments` — the deploy reader never sees any
 *  write method. */
export interface DeployStoreReadPort {
  listDeployments(): readonly DeployStoreDeploymentRecord[];
}

const DEPLOYMENT_STATE_SET: ReadonlySet<string> = new Set(DEPLOYMENT_STATES);

function isValidDeploymentList(value: readonly DeployStoreDeploymentRecord[]): boolean {
  if (!Array.isArray(value)) return false;
  return value.every((record) =>
    typeof record?.deploymentRef === 'string' && record.deploymentRef.length > 0
    && typeof record?.state === 'string' && DEPLOYMENT_STATE_SET.has(record.state)
    && typeof record?.targetCommit === 'string'
    && typeof record?.previousCommit === 'string'
    && (record.error === null || typeof record.error === 'string')
    && typeof record?.requestedAt === 'string' && record.requestedAt.length > 0);
}

/** The latest Deployment by `requestedAt`, most-recent first, deployment ref as a stable tie-break. */
function latestOf(deployments: readonly DeployStoreDeploymentRecord[]): DeployStoreDeploymentRecord | null {
  if (deployments.length === 0) return null;
  return [...deployments].sort((a, b) =>
    b.requestedAt.localeCompare(a.requestedAt) || b.deploymentRef.localeCompare(a.deploymentRef))[0]!;
}

function unavailableDaemonMachineRow(reason: 'timeout' | 'unavailable' | 'invalid', observedAt: string): UnavailableRow<'daemon-machine'> {
  return { kind: 'unavailable', key: 'error:daemon-machine', label: 'Unavailable', value: { status: 'unavailable', reason }, observedAt, source: 'error' };
}

/** The `DeployRow` for the latest Deployment, bounded at the §3.5 `deploy` budget. Returns `null` when
 *  no Deployment exists yet — a store that simply has nothing to report is not a failure. */
export async function readDeployRow(
  port: DeployStoreReadPort,
  now: () => string,
  scheduler?: SchedulerPort,
): Promise<DeployRow | UnavailableRow<'daemon-machine'> | null> {
  const observedAt = now();
  const result = await withBudget('deploy', () => port.listDeployments(), { scheduler, validate: isValidDeploymentList });
  if (!result.ok) return unavailableDaemonMachineRow(result.reason, observedAt);
  const latest = latestOf(result.value);
  if (!latest) return null;
  const value: DeployRowValue = {
    deploymentRef: latest.deploymentRef,
    state: latest.state as DeploymentState,
    targetCommit: latest.targetCommit,
    previousCommit: latest.previousCommit,
    error: latest.error,
  };
  return { kind: 'deploy', key: `deploy:${latest.deploymentRef}`, label: 'Deployment', value, observedAt, source: 'deploy' };
}
