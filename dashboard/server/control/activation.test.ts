import { describe, it, expect, vi } from 'vitest';
import {
  isExecutionActivated,
  buildActivatedExecution,
  DASHBOARD_EXECUTOR_SUBJECT,
  type ActivationDeps,
  type BuildActivatedExecutionOptions,
} from './activation.ts';

describe('isExecutionActivated (the whole gate)', () => {
  it('is true only for the exact literal "1"', () => {
    expect(isExecutionActivated({ DASHBOARD_EXECUTION_ACTIVATED: '1' })).toBe(true);
  });
  it.each([
    ['unset', {}],
    ['empty', { DASHBOARD_EXECUTION_ACTIVATED: '' }],
    ['zero', { DASHBOARD_EXECUTION_ACTIVATED: '0' }],
    ['true-ish', { DASHBOARD_EXECUTION_ACTIVATED: 'true' }],
    ['whitespace', { DASHBOARD_EXECUTION_ACTIVATED: ' 1 ' }],
    ['one-plus', { DASHBOARD_EXECUTION_ACTIVATED: '11' }],
  ])('is false when %s', (_label, env) => {
    expect(isExecutionActivated(env as Record<string, string | undefined>)).toBe(false);
  });
});

/** A deps object whose every factory is a spy, so we can assert the gate-off path touches none of them. */
function spyDeps(): ActivationDeps {
  const engine = { runToBoundary: vi.fn().mockResolvedValue({ state: 'succeeded' }), cancelRun: vi.fn().mockResolvedValue({ state: 'stopped' }) };
  const broker = { __brand: 'broker' } as never;
  return {
    loadPolicy: vi.fn().mockReturnValue({ profiles: [], curatedSkills: new Set<string>(), contractText: '', governanceContents: {} }),
    resolveBaseCommit: vi.fn().mockReturnValue('f'.repeat(40)),
    createSessionAdapter: vi.fn().mockReturnValue({ start: vi.fn() }) as never,
    createBrokerPersistence: vi.fn().mockReturnValue({}) as never,
    createBroker: vi.fn().mockReturnValue(broker),
    createWorktrees: vi.fn().mockReturnValue({}) as never,
    createSkills: vi.fn().mockReturnValue({}) as never,
    createAccounting: vi.fn().mockReturnValue({}) as never,
    createResults: vi.fn().mockReturnValue({}) as never,
    createToolPolicyResolver: vi.fn().mockReturnValue(() => ({ allowedTools: ['Read'], permissionMode: 'default' })) as never,
    createWorkers: vi.fn().mockReturnValue({}) as never,
    createRegistry: vi.fn().mockReturnValue({ register: vi.fn(), cancel: vi.fn(), clear: vi.fn() }) as never,
    createManagers: vi.fn().mockReturnValue({ ensure: vi.fn() }) as never,
    createCancellation: vi.fn().mockReturnValue({ cancelManager: vi.fn(), cancelWorker: vi.fn() }) as never,
    createEngine: vi.fn().mockReturnValue(engine),
  };
}

function baseOptions(deps: ActivationDeps, env: Record<string, string | undefined>): BuildActivatedExecutionOptions {
  return {
    env,
    controlStore: {} as never,
    repoRoot: '/repo',
    stateRoot: '/state',
    deps,
  };
}

describe('buildActivatedExecution — gate OFF (core inert invariant)', () => {
  it('returns null and constructs NOTHING: every factory is untouched', () => {
    const deps = spyDeps();
    const result = buildActivatedExecution(baseOptions(deps, {}));
    expect(result).toBeNull();
    for (const [name, fn] of Object.entries(deps)) {
      expect((fn as ReturnType<typeof vi.fn>), `factory '${name}' must not be called when the gate is off`).not.toHaveBeenCalled();
    }
  });

  it('returns null for every non-"1" gate value without constructing anything', () => {
    for (const value of ['', '0', 'true', undefined]) {
      const deps = spyDeps();
      const result = buildActivatedExecution(baseOptions(deps, { DASHBOARD_EXECUTION_ACTIVATED: value }));
      expect(result).toBeNull();
      expect(deps.createEngine).not.toHaveBeenCalled();
      expect(deps.resolveBaseCommit).not.toHaveBeenCalled();
    }
  });
});

describe('buildActivatedExecution — gate ON', () => {
  it('returns all three injection fields', () => {
    const deps = spyDeps();
    const result = buildActivatedExecution(baseOptions(deps, { DASHBOARD_EXECUTION_ACTIVATED: '1' }));
    expect(result).not.toBeNull();
    expect(result?.controlBroker).toBeDefined();
    expect(typeof result?.runAutomatic).toBe('function');
    expect(typeof result?.cancelAutomatic).toBe('function');
  });

  it('runAutomatic delegates to engine.runToBoundary and cancelAutomatic to engine.cancelRun', async () => {
    const deps = spyDeps();
    const engineFactory = deps.createEngine as ReturnType<typeof vi.fn>;
    const result = buildActivatedExecution(baseOptions(deps, { DASHBOARD_EXECUTION_ACTIVATED: '1' }));
    const engine = engineFactory.mock.results[0].value;
    const runInput = { subject: 's', runRef: 'r', proposal: {} } as never;
    await result?.runAutomatic(runInput);
    expect(engine.runToBoundary).toHaveBeenCalledWith(runInput);
    const cancelInput = { subject: 's', runRef: 'r', idempotencyKey: 'k', reason: 'x' } as never;
    await result?.cancelAutomatic(cancelInput);
    expect(engine.cancelRun).toHaveBeenCalledWith(cancelInput);
  });

  it('constructs under the single dashboard-engine subject (D1) and the CANONICAL result integrator (D4)', () => {
    const deps = spyDeps();
    buildActivatedExecution(baseOptions(deps, { DASHBOARD_EXECUTION_ACTIVATED: '1' }));
    // D1: broker persistence bound to the one executor subject.
    expect(deps.createBrokerPersistence).toHaveBeenCalledWith(expect.anything(), DASHBOARD_EXECUTOR_SUBJECT);
    // D4: the engine's result integrator is the canonical git integrator, keyed to the ops repo root.
    expect(deps.createResults).toHaveBeenCalledWith(expect.objectContaining({ repoRoot: '/repo', coordinationRoot: '/repo' }));
    // D5: worktree + integration roots live under the state root, never inside the repo.
    expect(deps.createWorktrees).toHaveBeenCalledWith(expect.objectContaining({ worktreeRoot: expect.stringContaining('worktrees') }));
    const engineOptions = (deps.createEngine as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(engineOptions.results).toBe((deps.createResults as ReturnType<typeof vi.fn>).mock.results[0].value);
  });

  it('wires the worker cancellation registry.register into the worker adapter and the same registry into cancellation', () => {
    const deps = spyDeps();
    buildActivatedExecution(baseOptions(deps, { DASHBOARD_EXECUTION_ACTIVATED: '1' }));
    const registry = (deps.createRegistry as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(deps.createWorkers).toHaveBeenCalledWith(expect.objectContaining({ registerCancellation: registry.register }));
    expect(deps.createCancellation).toHaveBeenCalledWith(expect.objectContaining({ registry }));
  });

  it('resolves the immutable baseCommit from the ops repo root when none is supplied', () => {
    const deps = spyDeps();
    buildActivatedExecution(baseOptions(deps, { DASHBOARD_EXECUTION_ACTIVATED: '1' }));
    expect(deps.resolveBaseCommit).toHaveBeenCalledWith('/repo');
  });
});
