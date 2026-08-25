// Dashboard v3 P5 W4 — deploy reader tests (§3.5). Fed only by a narrow injected `listDeployments` read
// port — never the whole `ControlPlaneStore`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROBE_BUDGETS_MS } from './probeBudget.ts';
import { readDeployRow, type DeployStoreDeploymentRecord, type DeployStoreReadPort } from './deployReader.ts';

const NOW = '2026-08-25T00:00:00.000Z';
const now = () => NOW;

function record(overrides: Partial<DeployStoreDeploymentRecord> = {}): DeployStoreDeploymentRecord {
  return {
    deploymentRef: 'deployment:1', state: 'succeeded', targetCommit: 'a'.repeat(40),
    previousCommit: 'b'.repeat(40), error: null, requestedAt: '2026-08-24T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('readDeployRow', () => {
  it('returns null (no failure) when no Deployment exists yet', async () => {
    const row = await readDeployRow({ listDeployments: () => [] }, now);
    expect(row).toBeNull();
  });

  it('reads the DeployRow for the single Deployment, keyed deploy:<ref>', async () => {
    const port: DeployStoreReadPort = { listDeployments: () => [record()] };
    const row = await readDeployRow(port, now);
    expect(row).toEqual({
      kind: 'deploy', key: 'deploy:deployment:1', label: 'Deployment',
      value: { deploymentRef: 'deployment:1', state: 'succeeded', targetCommit: 'a'.repeat(40), previousCommit: 'b'.repeat(40), error: null },
      observedAt: NOW, source: 'deploy',
    });
  });

  it('picks the LATEST Deployment by requestedAt, not list order', async () => {
    const older = record({ deploymentRef: 'deployment:1', requestedAt: '2026-08-20T00:00:00.000Z' });
    const newer = record({ deploymentRef: 'deployment:2', requestedAt: '2026-08-24T00:00:00.000Z', state: 'failed', error: 'swap failed' });
    const port: DeployStoreReadPort = { listDeployments: () => [older, newer] };
    const row = await readDeployRow(port, now);
    expect(row).toMatchObject({ key: 'deploy:deployment:2', value: { deploymentRef: 'deployment:2', state: 'failed', error: 'swap failed' } });
  });

  it('a hung store read degrades the deploy row alone with reason "timeout", never rejecting', async () => {
    const pending = readDeployRow({ listDeployments: () => new Promise(() => {}) as unknown as readonly DeployStoreDeploymentRecord[] }, now);
    await vi.advanceTimersByTimeAsync(PROBE_BUDGETS_MS.deploy);
    await expect(pending).resolves.toEqual({
      kind: 'unavailable', key: 'error:daemon-machine', label: 'Unavailable',
      value: { status: 'unavailable', reason: 'timeout' }, observedAt: NOW, source: 'error',
    });
  });

  it('a throwing store read degrades to reason "unavailable" without leaking the error text', async () => {
    const row = await readDeployRow(
      { listDeployments: () => { throw new Error('stderr: control document read denied at /var/lib/kb'); } },
      now,
    );
    expect(row).toEqual({
      kind: 'unavailable', key: 'error:daemon-machine', label: 'Unavailable',
      value: { status: 'unavailable', reason: 'unavailable' }, observedAt: NOW, source: 'error',
    });
    expect(JSON.stringify(row)).not.toContain('/var/lib/kb');
  });

  it('an unmapped deployment state degrades to reason "invalid"', async () => {
    const bad = { ...record(), state: 'not-a-real-state' } as unknown as DeployStoreDeploymentRecord;
    const row = await readDeployRow({ listDeployments: () => [bad] }, now);
    expect(row?.kind).toBe('unavailable');
    expect((row as { value: { reason: string } }).value.reason).toBe('invalid');
  });

  it('the DeployRow value carries no spend field and no control verb', async () => {
    const row = await readDeployRow({ listDeployments: () => [record()] }, now);
    expect(Object.keys((row as { value: object }).value).sort()).toEqual(['deploymentRef', 'error', 'previousCommit', 'state', 'targetCommit']);
  });
});
