import { describe, expect, it } from 'vitest';
import { createInMemoryControlPlaneStore } from '../control/store.ts';
import type { DeployReadyCandidate } from './contracts.ts';
import { DeploymentService, DeploymentServiceError, deployReadyRef } from './deploymentService.ts';

const TARGET = 'a'.repeat(40);
const OTHER = 'c'.repeat(40);
const PREVIOUS = 'b'.repeat(40);
const NOW = '2026-08-20T00:00:00.000Z';
const green: DeployReadyCandidate = { sha: TARGET, attestationDigest: 'd'.repeat(64), breaking: false };
const breaking: DeployReadyCandidate = { ...green, breaking: true };

function service() {
  const store = createInMemoryControlPlaneStore();
  return { store, svc: new DeploymentService({ store, now: () => new Date(NOW) }) };
}

describe('DeploymentService create', () => {
  it('creates green Deploy at requested, pinning all seven CREATE_KEYS from the candidate', () => {
    const { store, svc } = service();
    const { deployment, replayed } = svc.deploy(green, PREVIOUS);
    expect(replayed).toBe(false);
    expect(deployment).toMatchObject({
      deploymentRef: deployReadyRef(TARGET),
      state: 'requested',
      targetCommit: TARGET,
      previousCommit: PREVIOUS,
      requestedAt: NOW,
      parkWarnAt: '2026-08-20T00:01:30.000Z', // requestedAt + 90 s
      revision: 1,
    });
    expect(store.listDeployments()).toHaveLength(1);
  });

  it('creates breaking Confirm at requested too — never at waiting-confirmation', () => {
    const { svc } = service();
    const { deployment } = svc.confirm(breaking, PREVIOUS);
    expect(deployment.state).toBe('requested');
    expect(deployment.deploymentRef).toBe(deployReadyRef(TARGET));
  });

  it('refuses the crossed verb/candidate pair', () => {
    const { svc } = service();
    expect(() => svc.deploy(breaking, PREVIOUS)).toThrow(
      expect.objectContaining({ code: 'confirm-required', status: 409 }),
    );
    expect(() => svc.confirm(green, PREVIOUS)).toThrow(
      expect.objectContaining({ code: 'deploy-required', status: 409 }),
    );
  });

  it('converges a double-clicked Deploy on one record via idempotencyKey deploy:<targetSha>', () => {
    const { store, svc } = service();
    const first = svc.deploy(green, PREVIOUS);
    const second = svc.deploy(green, PREVIOUS);
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.deployment).toEqual(first.deployment);
    expect(store.listDeployments()).toHaveLength(1);
  });

  it('refuses a second active deployment for a different candidate', () => {
    const { svc } = service();
    svc.deploy(green, PREVIOUS);
    expect(() => svc.deploy({ ...green, sha: OTHER }, PREVIOUS)).toThrow(
      expect.objectContaining({ code: 'conflict', status: 409 }),
    );
  });
});

describe('DeploymentService transitions go through the store CAS', () => {
  it('aborts from requested and records the terminal outcome', () => {
    const { store, svc } = service();
    const { deployment } = svc.deploy(green, PREVIOUS);
    const aborted = svc.abort(deployment.deploymentRef, deployment.revision, 'requested');
    expect(aborted.state).toBe('aborted');
    expect(store.getDeployment(deployment.deploymentRef)).toMatchObject({ ok: true, value: { state: 'aborted' } });
  });

  it('refuses Abort outside requested|parked without touching the record', () => {
    const { svc } = service();
    const { deployment } = svc.deploy(green, PREVIOUS);
    expect(() => svc.abort(deployment.deploymentRef, deployment.revision, 'swapping')).toThrow(
      expect.objectContaining({ code: 'abort-not-allowed' }),
    );
  });

  it('rejects a stale revision as a conflict with no side effect', () => {
    const { store, svc } = service();
    const { deployment } = svc.deploy(green, PREVIOUS);
    const before = store.getControlDocumentMetadata().documentRevision;
    expect(() => svc.abort(deployment.deploymentRef, deployment.revision + 5, 'requested')).toThrow(
      DeploymentServiceError,
    );
    expect(store.getControlDocumentMetadata().documentRevision).toBe(before);
    expect(store.getDeployment(deployment.deploymentRef)).toMatchObject({ ok: true, value: { state: 'requested' } });
  });

  it('acknowledges a terminal deployment', () => {
    const { svc } = service();
    const { deployment } = svc.deploy(green, PREVIOUS);
    const aborted = svc.abort(deployment.deploymentRef, deployment.revision, 'requested');
    const acknowledged = svc.acknowledge(aborted.deploymentRef, aborted.revision, 'aborted', 'operator');
    expect(acknowledged.state).toBe('acknowledged');
  });
});
