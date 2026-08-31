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

  it('never spawns a subprocess: the adapter takes no process authority to construct', async () => {
    // P3 removed the supervisor the adapter could once have been handed. There is no longer any
    // injectable that could start a child, which is the point: metadata-only is now structural.
    const managers = createBrokerManagerAdapter({});
    await expect(managers.ensure(managerEnsureInput())).resolves.toBeUndefined();
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

  it('validates supplied assigned-manager provenance and instructions without spawning', async () => {
    const managers = createBrokerManagerAdapter();
    const assignment = {
      agentId: 'fyt-manager', declarationPath: 'agents/fyt-manager.md', declarationHash: 'a'.repeat(64),
      profileId: managerProfile.id, runtime: managerProfile.runtime, model: managerProfile.model,
    };
    await expect(managers.ensure(managerEnsureInput({ assignment, instructionMarkdown: '# Bound manager\nNever publish.' }))).resolves.toBeUndefined();
    await expect(managers.ensure(managerEnsureInput({ assignment }))).rejects.toThrow(/together/);
    await expect(managers.ensure(managerEnsureInput({
      assignment: { ...assignment, model: 'different' }, instructionMarkdown: '# Bound manager',
    }))).rejects.toThrow(/verified assignment/);
  });
});

describe('createBrokerCancellationController', () => {
  it('cancelWorker maps attemptRef to the automatic-attempt operationKey on BOTH the port and the registry', async () => {
    const cancelled: string[] = [];
    const portKeys: string[] = [];
    const registry = { cancel(operationKey: string) { cancelled.push(operationKey); } };
    const attemptPort = {
      async cancel(input: { operationKey: string; reason: string }) {
        portKeys.push(input.operationKey);
        return { ok: false as const, refusal: 'not-found' as const, detail: null };
      },
    };
    const controller = createBrokerCancellationController({ attemptPort, registry });
    await controller.cancelWorker(cancellationInput({ attemptRef: 'attempt-42' }) as never);
    expect(cancelled).toEqual(['automatic-attempt:attempt-42']);
    expect(portKeys).toEqual(['automatic-attempt:attempt-42']);
  });

  it('cancelManager signals nothing: the metadata-only manager owns no child', async () => {
    const registry = { cancel() {} };
    let portCalls = 0;
    const attemptPort = {
      async cancel() {
        portCalls += 1;
        return { ok: false as const, refusal: 'not-found' as const, detail: null };
      },
    };
    const controller = createBrokerCancellationController({ attemptPort, registry });
    await expect(controller.cancelManager(cancellationInput({ sessionRef: 'session-9' }))).resolves.toBeUndefined();
    await expect(controller.cancelManager(cancellationInput())).resolves.toBeUndefined();
    expect(portCalls).toBe(0);
  });

  it('cancelWorker on an unknown attempt, and with no attempt port at all, is a no-op', async () => {
    const registry = createWorkerCancellationRegistry();
    const attemptPort = {
      async cancel() { return { ok: false as const, refusal: 'not-found' as const, detail: null }; },
    };
    await expect(createBrokerCancellationController({ attemptPort, registry })
      .cancelWorker(cancellationInput({ attemptRef: 'ghost' }) as never)).resolves.toBeUndefined();
    await expect(createBrokerCancellationController({ attemptPort: null, registry })
      .cancelWorker(cancellationInput({ attemptRef: 'ghost' }) as never)).resolves.toBeUndefined();
  });
});
