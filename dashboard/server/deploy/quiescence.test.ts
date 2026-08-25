import { describe, expect, it, vi } from 'vitest';
import type { ControlResult, Deployment } from '../control/types.ts';
import { closePtysAndContinue, type CloseAndContinuePorts, type DeploymentTransitionStore } from './quiescence.ts';

const PINNED = ['pty-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'pty-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'];

function deployment(overrides: Partial<Deployment> = {}): Deployment {
  return {
    deploymentRef: 'deploy-1',
    revision: 5,
    targetCommit: 'a'.repeat(40),
    previousCommit: 'b'.repeat(40),
    state: 'swapping',
    requestedAt: '2026-08-25T10:00:00.000Z',
    parkWarnAt: '2026-08-25T10:05:00.000Z',
    swapDeadlineAt: null,
    fenceRevision: 0,
    drainAcks: {},
    blockers: [],
    progress: { kind: 'swapping', attemptRef: null, since: '2026-08-25T10:10:00.000Z', detail: null },
    abortRequestedAt: null,
    error: null,
    terminalOutcome: null,
    acknowledgedBy: null,
    ...overrides,
  };
}

function ports(overrides: Partial<CloseAndContinuePorts> = {}): CloseAndContinuePorts & {
  store: DeploymentTransitionStore & { transitionDeployment: ReturnType<typeof vi.fn> };
} {
  const transitionDeployment = vi.fn(
    (): ControlResult<Deployment> => ({ ok: true, value: deployment() }),
  );
  return {
    store: { transitionDeployment },
    liveSessions: { listLiveSessionIds: () => PINNED },
    closeSessions: vi.fn(async () => ({ ok: true as const, value: { closed: [...PINNED] } })),
    now: () => '2026-08-25T10:10:00.000Z',
    ...overrides,
  } as CloseAndContinuePorts & { store: DeploymentTransitionStore & { transitionDeployment: ReturnType<typeof vi.fn> } };
}

describe('closePtysAndContinue', () => {
  it('advances parked -> swapping under the human-operator actor only on an exact confirmed close', async () => {
    const p = ports();
    const result = await closePtysAndContinue(p, { deploymentRef: 'deploy-1', expectedRevision: 4, sessionIds: PINNED });

    expect(result).toMatchObject({ ok: true, closed: PINNED });
    expect(p.store.transitionDeployment).toHaveBeenCalledTimes(1);
    expect(p.store.transitionDeployment).toHaveBeenCalledWith('human-operator', 'deploy-1', expect.objectContaining({
      expectedRevision: 4,
      expectedState: 'parked',
      nextState: 'swapping',
      patch: { blockers: [], progress: { kind: 'swapping', attemptRef: null, since: '2026-08-25T10:10:00.000Z', detail: null } },
    }));
  });

  it('refuses 409 pty-set-changed when the live set differs by one id, and never calls the store', async () => {
    const p = ports({ liveSessions: { listLiveSessionIds: () => [PINNED[0], 'pty-cccccccccccccccccccccccccccccccc'] } });
    const result = await closePtysAndContinue(p, { deploymentRef: 'deploy-1', expectedRevision: 4, sessionIds: PINNED });

    expect(result).toEqual({ ok: false, refusal: 'pty-set-changed', detail: expect.any(String) });
    expect(p.closeSessions).not.toHaveBeenCalled();
    expect(p.store.transitionDeployment).not.toHaveBeenCalled();
  });

  it('refuses 409 pty-set-changed for a superset (one extra live id) as well as a subset', async () => {
    const superset = ports({ liveSessions: { listLiveSessionIds: () => [...PINNED, 'pty-dddddddddddddddddddddddddddddddd'] } });
    await expect(closePtysAndContinue(superset, { deploymentRef: 'deploy-1', expectedRevision: 4, sessionIds: PINNED }))
      .resolves.toMatchObject({ ok: false, refusal: 'pty-set-changed' });

    const subset = ports({ liveSessions: { listLiveSessionIds: () => [PINNED[0]] } });
    await expect(closePtysAndContinue(subset, { deploymentRef: 'deploy-1', expectedRevision: 4, sessionIds: PINNED }))
      .resolves.toMatchObject({ ok: false, refusal: 'pty-set-changed' });
  });

  it('refuses 409 pty-not-confirmed on a non-ok closeAndWait (including a timeout refusal) and leaves the revision untouched', async () => {
    const p = ports({ closeSessions: vi.fn(async () => ({ ok: false as const, refusal: 'internal' as const, detail: 'closeAndWait timed out' })) });
    const result = await closePtysAndContinue(p, { deploymentRef: 'deploy-1', expectedRevision: 4, sessionIds: PINNED });

    expect(result).toEqual({ ok: false, refusal: 'pty-not-confirmed', detail: expect.any(String) });
    expect(p.store.transitionDeployment).not.toHaveBeenCalled();
  });

  it('refuses 409 pty-not-confirmed on a partial close (closed set is not the exact pinned set)', async () => {
    const p = ports({ closeSessions: vi.fn(async () => ({ ok: true as const, value: { closed: [PINNED[0]] } })) });
    const result = await closePtysAndContinue(p, { deploymentRef: 'deploy-1', expectedRevision: 4, sessionIds: PINNED });

    expect(result).toEqual({ ok: false, refusal: 'pty-not-confirmed', detail: expect.any(String) });
    expect(p.store.transitionDeployment).not.toHaveBeenCalled();
  });

  it('never closes a re-derived or superset id list — it closes exactly the pinned ids it was given', async () => {
    const p = ports();
    await closePtysAndContinue(p, { deploymentRef: 'deploy-1', expectedRevision: 4, sessionIds: PINNED });

    expect(p.closeSessions).toHaveBeenCalledWith(PINNED);
  });

  it('passes through a store CAS conflict (stale revision or wrong state) as a refusal, calling the store exactly once', async () => {
    const p = ports({
      store: {
        transitionDeployment: vi.fn((): ControlResult<Deployment> => ({ ok: false, reason: 'conflict', detail: 'deployment revision, state, or transition changed' })),
      },
    });
    const result = await closePtysAndContinue(p, { deploymentRef: 'deploy-1', expectedRevision: 4, sessionIds: PINNED });

    expect(result).toEqual({ ok: false, refusal: 'conflict', detail: expect.any(String) });
    expect(p.store.transitionDeployment).toHaveBeenCalledTimes(1);
  });

  it('refuses invalid input for an empty or duplicated pinned set before reading anything live', async () => {
    const p = ports();
    await expect(closePtysAndContinue(p, { deploymentRef: 'deploy-1', expectedRevision: 4, sessionIds: [] }))
      .resolves.toMatchObject({ ok: false, refusal: 'invalid' });
    await expect(closePtysAndContinue(p, { deploymentRef: 'deploy-1', expectedRevision: 4, sessionIds: [PINNED[0], PINNED[0]] }))
      .resolves.toMatchObject({ ok: false, refusal: 'invalid' });
    expect(p.closeSessions).not.toHaveBeenCalled();
    expect(p.store.transitionDeployment).not.toHaveBeenCalled();
  });
});
