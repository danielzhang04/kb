import { describe, it, expect } from 'vitest';
import type { ExecutionProfile } from './policy.ts';
import {
  createWorkerCancellationRegistry,
  createBrokerManagerAdapter,
  createBrokerCancellationController,
} from './managedExecution.ts';

const managerProfile: ExecutionProfile = {
  id: 'manager:claude:claude-opus',
  role: 'manager',
  runtime: 'claude',
  model: 'claude-opus',
  capabilities: ['read', 'emit-events'],
};

// A well-formed proposal content hash is a sha256 hex digest (proposal.ts#proposalContentHash).
const proposalHash = 'a'.repeat(64);

function managerEnsureInput(overrides: Record<string, unknown> = {}) {
  return {
    operationKey: 'automatic-manager-session:session-1',
    subject: 'dashboard-engine',
    runRef: 'run-1',
    sessionRef: 'session-1',
    generation: 0,
    predecessorSessionRef: null,
    proposalHash,
    profile: managerProfile,
    ...overrides,
  } as Parameters<ReturnType<typeof createBrokerManagerAdapter>['ensure']>[0];
}

function cancellationInput(overrides: Record<string, unknown> = {}) {
  return {
    operationKey: 'cancel:idem:session-1',
    subject: 'dashboard-engine',
    runRef: 'run-1',
    sessionRef: 'session-1',
    attemptRef: 'attempt-1',
    intent: 'run-cancel' as const,
    ...overrides,
  };
}

describe('createWorkerCancellationRegistry', () => {
  it('invokes a registered cancel exactly once and treats double-cancel as a no-op', () => {
    const registry = createWorkerCancellationRegistry();
    let calls = 0;
    registry.register('automatic-attempt:attempt-1', () => { calls += 1; });
    registry.cancel('automatic-attempt:attempt-1');
    registry.cancel('automatic-attempt:attempt-1');
    expect(calls).toBe(1);
  });

  it('is a no-op when cancelling an unknown operationKey', () => {
    const registry = createWorkerCancellationRegistry();
    expect(() => registry.cancel('automatic-attempt:missing')).not.toThrow();
  });

  it('clear removes a registration so a later cancel does not fire it', () => {
    const registry = createWorkerCancellationRegistry();
    let calls = 0;
    registry.register('automatic-attempt:attempt-1', () => { calls += 1; });
    registry.clear('automatic-attempt:attempt-1');
    registry.cancel('automatic-attempt:attempt-1');
    expect(calls).toBe(0);
  });

  it('a re-registration for the same operationKey replaces the prior cancel', () => {
    const registry = createWorkerCancellationRegistry();
    const fired: string[] = [];
    registry.register('automatic-attempt:attempt-1', () => fired.push('first'));
    registry.register('automatic-attempt:attempt-1', () => fired.push('second'));
    registry.cancel('automatic-attempt:attempt-1');
    expect(fired).toEqual(['second']);
  });
});

describe('createBrokerManagerAdapter (D3 realization b — no subprocess)', () => {
  it('ensure resolves and is idempotent across repeated calls with the same sessionRef', async () => {
    const managers = createBrokerManagerAdapter();
    await expect(managers.ensure(managerEnsureInput())).resolves.toBeUndefined();
    await expect(managers.ensure(managerEnsureInput())).resolves.toBeUndefined();
  });

  it('never spawns a subprocess: no broker is required or touched to ensure a manager', async () => {
    let started = 0;
    const broker = { start() { started += 1; return { ok: true, started: true } as const; }, stop() { return false; } };
    const managers = createBrokerManagerAdapter({ broker: broker as never });
    await managers.ensure(managerEnsureInput());
    expect(started).toBe(0);
  });

  it('throws when the manager execution profile is missing', async () => {
    const managers = createBrokerManagerAdapter();
    await expect(managers.ensure(managerEnsureInput({ profile: undefined }))).rejects.toThrow();
  });

  it('throws when handed a worker profile instead of a manager profile', async () => {
    const managers = createBrokerManagerAdapter();
    const workerProfile: ExecutionProfile = { ...managerProfile, role: 'worker' };
    await expect(managers.ensure(managerEnsureInput({ profile: workerProfile }))).rejects.toThrow();
  });

  it('throws when the proposal hash is missing or empty', async () => {
    const managers = createBrokerManagerAdapter();
    await expect(managers.ensure(managerEnsureInput({ proposalHash: '' }))).rejects.toThrow();
  });
});

describe('createBrokerCancellationController', () => {
  it('cancelWorker maps attemptRef to the automatic-attempt operationKey and fires its registered cancel', async () => {
    const cancelled: string[] = [];
    const registry = { cancel(operationKey: string) { cancelled.push(operationKey); } };
    const broker = { stop() { return false; } };
    const controller = createBrokerCancellationController({ broker: broker as never, registry });
    await controller.cancelWorker(cancellationInput({ attemptRef: 'attempt-42' }) as never);
    expect(cancelled).toEqual(['automatic-attempt:attempt-42']);
  });

  it('cancelManager calls broker.stop with the session reference', async () => {
    const stopped: string[] = [];
    const registry = { cancel() {} };
    const broker = { stop(sessionRef: string) { stopped.push(sessionRef); return true; } };
    const controller = createBrokerCancellationController({ broker: broker as never, registry });
    await controller.cancelManager(cancellationInput({ sessionRef: 'session-9' }));
    expect(stopped).toEqual(['session-9']);
  });

  it('cancelManager is idempotent when broker.stop reports nothing live to stop', async () => {
    const registry = { cancel() {} };
    const broker = { stop() { return false; } };
    const controller = createBrokerCancellationController({ broker: broker as never, registry });
    await expect(controller.cancelManager(cancellationInput())).resolves.toBeUndefined();
    await expect(controller.cancelManager(cancellationInput())).resolves.toBeUndefined();
  });

  it('cancelWorker on an unknown attempt is a no-op (idempotent stop authority)', async () => {
    const registry = createWorkerCancellationRegistry();
    const broker = { stop() { return false; } };
    const controller = createBrokerCancellationController({ broker: broker as never, registry });
    await expect(controller.cancelWorker(cancellationInput({ attemptRef: 'ghost' }) as never)).resolves.toBeUndefined();
  });
});
