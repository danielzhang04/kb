import { describe, it, expect, vi } from 'vitest';
import {
  isExecutionActivated,
  buildActivatedExecution,
  createProjectPolicyResolver,
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
  const engine = {
    runToBoundary: vi.fn().mockResolvedValue({ state: 'succeeded' }),
    cancelRun: vi.fn().mockResolvedValue({ state: 'stopped' }),
    containManagerStart: vi.fn().mockResolvedValue(undefined),
  };
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
    createAssignedAgentResolver: vi.fn().mockReturnValue({ resolve: vi.fn() }) as never,
    createWorkers: vi.fn().mockReturnValue({}) as never,
    createRegistry: vi.fn().mockReturnValue({ register: vi.fn(), cancel: vi.fn(), clear: vi.fn() }) as never,
    createManagers: vi.fn().mockReturnValue({ ensure: vi.fn() }) as never,
    createCancellation: vi.fn().mockReturnValue({ cancelManager: vi.fn(), cancelWorker: vi.fn() }) as never,
    createEngine: vi.fn().mockReturnValue(engine),
    settleLedgerForRun: vi.fn().mockReturnValue({ settled: true, emitted: 1, blocked: false }) as never,
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
  it('retains the held Wave-A policy but freshly loads each non-held project policy', () => {
    const deps = spyDeps();
    const held = {
      profiles: [], curatedSkills: new Set<string>(), contractText: 'kb',
      governanceContents: {
        'CLAUDE.md': 'c', 'governance/agent-rules.md': 'a', 'governance/risk-tiers.md': 'r',
        'orgs/kb-ops/contract.md': 'kb',
      },
    };
    const resolver = createProjectPolicyResolver('/repo', deps.loadPolicy, 'kb-ops', held);
    expect(resolver('kb-ops')).toBe(held);
    resolver('faceless-youtube');
    resolver('faceless-youtube');
    expect(deps.loadPolicy).toHaveBeenCalledTimes(2);
    expect(deps.loadPolicy).toHaveBeenCalledWith('/repo', 'faceless-youtube', [
      'CLAUDE.md', 'governance/agent-rules.md', 'governance/risk-tiers.md', 'orgs/faceless-youtube/contract.md',
    ]);
    expect(() => resolver('../faceless-youtube')).toThrow(/unsafe/);
  });

  it('returns every activated execution injection field', () => {
    const deps = spyDeps();
    const result = buildActivatedExecution(baseOptions(deps, { DASHBOARD_EXECUTION_ACTIVATED: '1' }));
    expect(result).not.toBeNull();
    expect(result?.controlBroker).toBeDefined();
    expect(typeof result?.runAutomatic).toBe('function');
    expect(typeof result?.cancelAutomatic).toBe('function');
    expect(typeof result?.containManagerStart).toBe('function');
  });

  it('constructs the assigned-agent resolver only behind the activation gate and passes it to the engine', () => {
    const off = spyDeps();
    buildActivatedExecution(baseOptions(off, {}));
    expect(off.createAssignedAgentResolver).not.toHaveBeenCalled();

    const on = spyDeps();
    buildActivatedExecution(baseOptions(on, { DASHBOARD_EXECUTION_ACTIVATED: '1' }));
    expect(on.createAssignedAgentResolver).toHaveBeenCalledWith('/repo');
    const engineOptions = (on.createEngine as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(engineOptions.assignedAgents).toBe((on.createAssignedAgentResolver as ReturnType<typeof vi.fn>).mock.results[0].value);
  });

  it('delegates run, stop, and recoverable Manager-start containment to the engine', async () => {
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
    const containInput = { subject: 's', runRef: 'r', idempotencyKey: 'contain-k' };
    await result?.containManagerStart?.(containInput);
    expect(engine.containManagerStart).toHaveBeenCalledWith(containInput);
  });

  it('runAutomatic settles the fleet ledger for the run AFTER driving it to the boundary (T6 wire-up, gated)', async () => {
    const deps = spyDeps();
    const settle = deps.settleLedgerForRun as ReturnType<typeof vi.fn>;
    const result = buildActivatedExecution(baseOptions(deps, { DASHBOARD_EXECUTION_ACTIVATED: '1' }));
    const engine = (deps.createEngine as ReturnType<typeof vi.fn>).mock.results[0].value;
    await result?.runAutomatic({ subject: 'dashboard-engine', runRef: 'run-9', proposal: {} } as never);
    // Settlement ran once, keyed to the run, against the surface's control store + ops repo root.
    expect(settle).toHaveBeenCalledTimes(1);
    expect(settle).toHaveBeenCalledWith(
      expect.objectContaining({ repoRoot: '/repo' }),
      expect.objectContaining({ subject: 'dashboard-engine', runRef: 'run-9' }),
    );
    // Order: the boundary drive happens before settlement (runToBoundary resolved first).
    expect(engine.runToBoundary.mock.invocationCallOrder[0]).toBeLessThan(settle.mock.invocationCallOrder[0]);
  });

  it('a fleet-ledger settlement throw is swallowed AND logged, never masking the executor outcome', async () => {
    const deps = spyDeps();
    (deps.settleLedgerForRun as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error('ledger blew up'); });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = buildActivatedExecution(baseOptions(deps, { DASHBOARD_EXECUTION_ACTIVATED: '1' }));
    await expect(result?.runAutomatic({ subject: 's', runRef: 'r', proposal: {} } as never)).resolves.toEqual({ state: 'succeeded' });
    // Swallowed for control flow, but surfaced for operator follow-up (an unpushed ledger row must not vanish).
    expect(errSpy).toHaveBeenCalledWith('fleet-ledger settlement failed', expect.any(Error));
    errSpy.mockRestore();
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
    expect(deps.createWorkers).toHaveBeenCalledWith(expect.objectContaining({
      registerCancellation: registry.register,
      deregisterCancellation: registry.clear,
      // C3: the canonical repo root is threaded so the worker adapter can emit the //-absolute deny companion.
      repoRoot: '/repo',
    }));
    expect(deps.createCancellation).toHaveBeenCalledWith(expect.objectContaining({ registry }));
  });

  it('C2: the worktree adapter is built with sparseReadScope OFF by default (no DASHBOARD_SPARSE_READSCOPE) and a resolveSparsePaths callback', () => {
    const deps = spyDeps();
    buildActivatedExecution(baseOptions(deps, { DASHBOARD_EXECUTION_ACTIVATED: '1' }));
    expect(deps.createWorktrees).toHaveBeenCalledWith(expect.objectContaining({
      sparseReadScope: false,
      resolveSparsePaths: expect.any(Function),
    }));
  });

  it('C2: DASHBOARD_SPARSE_READSCOPE="1" flips sparseReadScope ON (same env source as the activation gate)', () => {
    const deps = spyDeps();
    buildActivatedExecution(baseOptions(deps, { DASHBOARD_EXECUTION_ACTIVATED: '1', DASHBOARD_SPARSE_READSCOPE: '1' }));
    expect(deps.createWorktrees).toHaveBeenCalledWith(expect.objectContaining({ sparseReadScope: true }));
  });

  it.each([['empty', ''], ['zero', '0'], ['true-ish', 'true'], ['padded', ' 1 ']])(
    'C2: DASHBOARD_SPARSE_READSCOPE=%s keeps sparseReadScope OFF (only the exact literal "1" enables it)',
    (_label, value) => {
      const deps = spyDeps();
      buildActivatedExecution(baseOptions(deps, { DASHBOARD_EXECUTION_ACTIVATED: '1', DASHBOARD_SPARSE_READSCOPE: value }));
      expect(deps.createWorktrees).toHaveBeenCalledWith(expect.objectContaining({ sparseReadScope: false }));
    },
  );

  it('C2: resolveSparsePaths returns the run\'s approved effectiveRead ∪ writeScope (proposal.scope), keyed on runRef, without touching execution.ts', async () => {
    const deps = spyDeps();
    // A single build: runAutomatic and the captured resolveSparsePaths share ONE per-run registry map.
    const engine = { cancelRun: vi.fn().mockResolvedValue({ state: 'stopped' }), runToBoundary: vi.fn() };
    (deps.createEngine as ReturnType<typeof vi.fn>).mockReturnValue(engine);
    const built = buildActivatedExecution(baseOptions(deps, { DASHBOARD_EXECUTION_ACTIVATED: '1' }));
    const resolveSparsePaths = (deps.createWorktrees as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0].resolveSparsePaths as (input: { runRef: string }) => readonly string[] | undefined;
    // Invoke the callback DURING runToBoundary — the window in which the engine would provision the worktree.
    let observed: readonly string[] | undefined = ['unset'];
    engine.runToBoundary.mockImplementation(async (input: { runRef: string }) => {
      observed = resolveSparsePaths({ runRef: input.runRef });
      return { state: 'succeeded' };
    });
    await built?.runAutomatic({
      subject: 'dashboard-engine',
      runRef: 'run-42',
      proposal: { scope: { read: ['queue', 'orgs/kb-ops'], write: ['orgs/kb-ops/output'] } },
    } as never);
    expect(observed).toEqual(['queue', 'orgs/kb-ops', 'orgs/kb-ops/output']);
    // The registry is dropped after the run: the same lookup now returns undefined (falls back to full checkout).
    expect(resolveSparsePaths({ runRef: 'run-42' })).toBeUndefined();
  });

  it('C2: a duplicate-launch failure cannot drop the live run sparse registry entry (ownership-aware delete)', async () => {
    // Review race: run A registers and suspends inside runToBoundary; a duplicate call B for the
    // SAME runRef registers over it, throws synchronously ("already active"), and B's finally must
    // NOT delete the entry A (well, the current owner) still needs mid-provision.
    const deps = spyDeps();
    const engine = { cancelRun: vi.fn().mockResolvedValue({ state: 'stopped' }), runToBoundary: vi.fn() };
    (deps.createEngine as ReturnType<typeof vi.fn>).mockReturnValue(engine);
    const built = buildActivatedExecution(baseOptions(deps, { DASHBOARD_EXECUTION_ACTIVATED: '1' }));
    const resolveSparsePaths = (deps.createWorktrees as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0].resolveSparsePaths as (input: { runRef: string }) => readonly string[] | undefined;
    let releaseA!: () => void;
    const gate = new Promise<void>((resolve) => { releaseA = resolve; });
    engine.runToBoundary
      .mockImplementationOnce(async () => { await gate; return { state: 'succeeded' }; })
      .mockImplementationOnce(() => { throw new Error('run reconciliation is already active'); });
    const input = {
      subject: 'dashboard-engine', runRef: 'run-dup',
      proposal: { scope: { read: ['queue'], write: ['orgs/kb-ops/output'] } },
    } as never;
    const runA = built!.runAutomatic(input);
    await expect(built!.runAutomatic(input)).rejects.toThrow('already active');
    // B's finally has run — the entry must survive for the still-provisioning current owner.
    expect(resolveSparsePaths({ runRef: 'run-dup' })).toEqual(['queue', 'orgs/kb-ops/output']);
    releaseA();
    await runA;
    expect(resolveSparsePaths({ runRef: 'run-dup' })).toBeUndefined();
  });

  it('resolves the immutable baseCommit from the ops repo root when none is supplied', () => {
    const deps = spyDeps();
    buildActivatedExecution(baseOptions(deps, { DASHBOARD_EXECUTION_ACTIVATED: '1' }));
    expect(deps.resolveBaseCommit).toHaveBeenCalledWith('/repo');
  });
});
