import { describe, it, expect, vi } from 'vitest';
import {
  isExecutionActivated,
  isExecutionUnlockGrant,
  buildActivatedExecution,
  createExecutionLatch,
  createProjectPolicyResolver,
  DASHBOARD_EXECUTOR_SUBJECT,
  type ActivationDeps,
  type BuildActivatedExecutionOptions,
  type ExecutionLatchState,
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
    loadPolicy: vi.fn().mockReturnValue({
      profiles: [
        { id: 'manager:claude:claude-opus', role: 'manager', runtime: 'claude', model: 'claude-opus', capabilities: ['read', 'emit-events'] },
        { id: 'manager:codex:gpt-5.6-sol', role: 'manager', runtime: 'codex', model: 'gpt-5.6-sol', capabilities: ['read', 'emit-events'] },
        { id: 'worker:claude:claude-sonnet', role: 'worker', runtime: 'claude', model: 'claude-sonnet', capabilities: ['read', 'emit-events'] },
        { id: 'worker:codex:gpt-5.6-sol', role: 'worker', runtime: 'codex', model: 'gpt-5.6-sol', capabilities: ['read', 'emit-events'] },
      ],
      curatedSkills: new Set<string>(), contractText: '', governanceContents: {},
    }),
    resolveBaseCommit: vi.fn().mockReturnValue('f'.repeat(40)),
    createSessionAdapter: vi.fn().mockReturnValue({ start: vi.fn() }) as never,
    createCodexSessionAdapter: vi.fn().mockReturnValue({ start: vi.fn() }) as never,
    createBrokerPersistence: vi.fn().mockReturnValue({}) as never,
    createBroker: vi.fn().mockReturnValue(broker),
    createWorktrees: vi.fn().mockReturnValue({}) as never,
    createSkills: vi.fn().mockReturnValue({}) as never,
    createAccounting: vi.fn().mockReturnValue({}) as never,
    createResults: vi.fn().mockReturnValue({ lookup: vi.fn().mockResolvedValue(null) }) as never,
    createToolPolicyResolver: vi.fn().mockReturnValue(() => ({ allowedTools: ['Read'], permissionMode: 'default' })) as never,
    createAssignedAgentResolver: vi.fn().mockReturnValue({ resolve: vi.fn() }) as never,
    createWorkers: vi.fn().mockReturnValue({}) as never,
    createCodexWorkers: vi.fn().mockReturnValue({}) as never,
    createSessionChains: vi.fn().mockReturnValue({ get: vi.fn().mockReturnValue(null), record: vi.fn().mockResolvedValue(undefined) }) as never,
    createRegistry: vi.fn().mockReturnValue({ register: vi.fn(), cancel: vi.fn(), clear: vi.fn() }) as never,
    createManagers: vi.fn().mockReturnValue({ ensure: vi.fn() }) as never,
    createCancellation: vi.fn().mockReturnValue({ cancelManager: vi.fn(), cancelWorker: vi.fn() }) as never,
    createEngine: vi.fn().mockReturnValue(engine),
    createRoster: vi.fn().mockReturnValue({
      ensureRoster: vi.fn().mockReturnValue({ runRef: 'run-1', spawned: [], existing: [] }),
      hasRoster: vi.fn().mockReturnValue(false),
      deliver: vi.fn(),
      retire: vi.fn().mockReturnValue([]),
      retireAll: vi.fn().mockReturnValue([]),
      state: vi.fn().mockReturnValue([]),
    }) as never,
    createRosterWorkers: vi.fn().mockReturnValue({ execute: vi.fn() }) as never,
    loadProfiles: vi.fn().mockReturnValue([]) as never,
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
    expect(typeof result?.verifyCanonicalResult).toBe('function');
  });

  it('delegates terminal-root proof to the existing exact g1 canonical result lookup', async () => {
    const deps = spyDeps();
    const lookup = vi.fn().mockResolvedValue({ durability: 'canonical' });
    (deps.createResults as ReturnType<typeof vi.fn>).mockReturnValue({ lookup });
    const built = buildActivatedExecution(baseOptions(deps, { DASHBOARD_EXECUTION_ACTIVATED: '1' }));
    await expect(built?.verifyCanonicalResult({ subject: 'operator', runRef: 'run-1', stageId: 'report' })).resolves.toBe(true);
    expect(lookup).toHaveBeenCalledWith(expect.objectContaining({
      operationKey: 'result:run-1:report', subject: 'operator', runRef: 'run-1', stageId: 'report',
    }));
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

/**
 * The runtime unlock latch. Boot posture is LOCKED: nothing is constructed until a verified passkey
 * assertion asks for it, or the headless/testing env override is set.
 */
describe('createExecutionLatch (runtime unlock)', () => {
  function latchHarness(env: Record<string, string | undefined> = {}) {
    const deps = spyDeps();
    const build = vi.fn(buildActivatedExecution);
    const changes: Array<{ execution: unknown; state: ExecutionLatchState }> = [];
    const latch = createExecutionLatch({
      build: build as unknown as typeof buildActivatedExecution,
      env,
      now: () => 1_700_000_000_000,
      buildOptions: { controlStore: {} as never, repoRoot: '/repo', stateRoot: '/state', deps },
      onChange: (execution, state) => changes.push({ execution, state }),
    });
    return { deps, build, latch, changes };
  }

  it('boots LOCKED and constructs nothing (the core inert invariant, now runtime-scoped)', () => {
    const { deps, build, latch, changes } = latchHarness();
    expect(latch.snapshot()).toEqual({ state: 'locked', source: null, unlockedAt: null, unlockedBy: null });
    expect(latch.current()).toBeNull();
    expect(build).not.toHaveBeenCalled();
    expect(changes).toEqual([]);
    for (const [name, fn] of Object.entries(deps)) {
      expect(fn as ReturnType<typeof vi.fn>, `factory ${name} must not be called while locked`).not.toHaveBeenCalled();
    }
  });

  it('unlock constructs the wiring, is idempotent, and reports who unlocked it', () => {
    const { deps, latch, changes } = latchHarness();
    const first = latch.unlock({ subject: 'operator' });
    expect(first.ok).toBe(true);
    expect(latch.snapshot()).toEqual({
      state: 'unlocked', source: 'passkey',
      unlockedAt: new Date(1_700_000_000_000).toISOString(), unlockedBy: 'operator',
    });
    expect(latch.current()).not.toBeNull();
    expect(deps.createEngine).toHaveBeenCalledTimes(1);
    expect(changes).toHaveLength(1);

    const wiring = latch.current();
    expect(latch.unlock({ subject: 'operator' }).ok).toBe(true);
    expect(deps.createEngine).toHaveBeenCalledTimes(1); // not rebuilt
    expect(latch.current()).toBe(wiring);
  });

  it('lock drops the wiring, retires every roster session, and can be re-unlocked', () => {
    const { deps, latch, changes } = latchHarness();
    latch.unlock({ subject: 'operator' });
    const roster = (deps.createRoster as ReturnType<typeof vi.fn>).mock.results[0]?.value;
    expect(latch.lock({ subject: 'operator' })).toEqual({ state: 'locked', source: null, unlockedAt: null, unlockedBy: null });
    expect(latch.current()).toBeNull();
    // Nothing constructed stays reachable, and roster terminals are reaped rather than orphaned.
    expect(changes.at(-1)?.execution).toBeNull();
    if (roster) expect(roster.retireAll).toHaveBeenCalledWith('execution locked');
    // A locked latch locks idempotently, then unlocks again on a fresh assertion.
    expect(latch.lock({ subject: 'operator' }).state).toBe('locked');
    expect(latch.unlock({ subject: 'operator' }).ok).toBe(true);
    expect(deps.createEngine).toHaveBeenCalledTimes(2);
  });

  it('the env override unlocks at construction (headless/testing posture) and is reported as such', () => {
    const { deps, latch } = latchHarness({ DASHBOARD_EXECUTION_ACTIVATED: '1' });
    expect(latch.snapshot()).toMatchObject({ state: 'unlocked', source: 'env-override', unlockedBy: DASHBOARD_EXECUTOR_SUBJECT });
    expect(latch.current()).not.toBeNull();
    expect(deps.createEngine).toHaveBeenCalledTimes(1);
    // Lock still works against an env-overridden daemon; a restart re-applies the override.
    expect(latch.lock({ subject: 'operator' }).state).toBe('locked');
  });

  it('refuses an unsafe unlock subject and leaves the daemon locked when construction throws', () => {
    const { latch } = latchHarness();
    expect(latch.unlock({ subject: '../../etc' })).toEqual({ ok: false, reason: 'unsafe-unlock-subject' });
    expect(latch.current()).toBeNull();

    const deps = spyDeps();
    (deps.resolveBaseCommit as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error('git is unavailable'); });
    const failing = createExecutionLatch({
      env: {}, buildOptions: { controlStore: {} as never, repoRoot: '/repo', stateRoot: '/state', deps },
    });
    const attempt = failing.unlock({ subject: 'operator' });
    expect(attempt).toEqual({ ok: false, reason: 'git is unavailable' });
    expect(failing.snapshot().state).toBe('locked');
    expect(failing.current()).toBeNull();
  });
});

describe('buildActivatedExecution — unlock grants and the roster substrate', () => {
  it('constructs with a latch-minted grant and NOTHING with a forged one', () => {
    const forged = spyDeps();
    expect(buildActivatedExecution({
      ...baseOptions(forged, {}),
      unlockGrant: { subject: 'operator', unlockedAt: 1, 'kb.execution-unlock-grant': true },
    })).toBeNull();
    for (const [name, fn] of Object.entries(forged)) {
      expect(fn as ReturnType<typeof vi.fn>, `factory ${name} must not run for a forged grant`).not.toHaveBeenCalled();
    }
    expect(isExecutionUnlockGrant({ subject: 'operator' })).toBe(false);
    expect(isExecutionUnlockGrant(null)).toBe(false);

    // Only the latch can produce an accepted grant; observe it through the latch's own construction.
    const real = spyDeps();
    const latch = createExecutionLatch({
      env: {}, buildOptions: { controlStore: {} as never, repoRoot: '/repo', stateRoot: '/state', deps: real },
    });
    expect(latch.unlock({ subject: 'operator' }).ok).toBe(true);
    expect(real.createEngine).toHaveBeenCalledTimes(1);
  });

  it('keeps headless-primary delivery even when the daemon shares its legacy PTY stack', () => {
    const without = spyDeps();
    const headlessOnly = buildActivatedExecution(baseOptions(without, { DASHBOARD_EXECUTION_ACTIVATED: '1' }));
    expect(without.createRoster).not.toHaveBeenCalled();
    expect(without.createRosterWorkers).not.toHaveBeenCalled();
    expect(headlessOnly?.rosterSessions).toBeUndefined();
    const headlessEngine = (without.createEngine as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(headlessEngine.workers).toEqual(expect.objectContaining({ execute: expect.any(Function) }));

    const withPty = spyDeps();
    const built = buildActivatedExecution({
      ...baseOptions(withPty, { DASHBOARD_EXECUTION_ACTIVATED: '1' }),
      ptyHost: { open: vi.fn(), stop: vi.fn(), stopAll: vi.fn(), sessions: () => [] } as never,
      ptySessions: {} as never,
    });
    expect(withPty.createRoster).not.toHaveBeenCalled();
    expect(withPty.createRosterWorkers).not.toHaveBeenCalled();
    expect(built?.rosterSessions).toBeUndefined();
    const rosterEngine = (withPty.createEngine as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(rosterEngine.workers).toEqual(expect.objectContaining({ execute: expect.any(Function) }));
  });

  it('drives and cancels without constructing or retiring a roster', async () => {
    const deps = spyDeps();
    const built = buildActivatedExecution({
      ...baseOptions(deps, { DASHBOARD_EXECUTION_ACTIVATED: '1' }),
      ptyHost: { open: vi.fn(), stop: vi.fn(), stopAll: vi.fn(), sessions: () => [] } as never,
      ptySessions: {} as never,
    });
    const engine = (deps.createEngine as ReturnType<typeof vi.fn>).mock.results[0].value;
    const proposal = { project: 'faceless-youtube', stages: [{ id: 'idea', assignment: { agentId: 'fyt-story' } }] };
    await built?.runAutomatic({ subject: 'operator', runRef: 'run-7', proposal } as never);
    expect(deps.createRoster).not.toHaveBeenCalled();
    expect(engine.runToBoundary).toHaveBeenCalledWith({ subject: 'operator', runRef: 'run-7', proposal });
    // The fake engine reports succeeded, so the terminals are retired with the run.

    // A cancellation retires them too — a stopped run must never leave live agent REPLs behind.
    await built?.cancelAutomatic({ subject: 'operator', runRef: 'run-7', idempotencyKey: 'k', reason: 'stop' } as never);
    expect(engine.cancelRun).toHaveBeenCalled();
  });

  it('allows a Codex route without a legacy roster assignment', async () => {
    const deps = spyDeps();
    const built = buildActivatedExecution(baseOptions(deps, { DASHBOARD_EXECUTION_ACTIVATED: '1' }));
    const engine = (deps.createEngine as ReturnType<typeof vi.fn>).mock.results[0].value;
    const proposal = {
      manager: { runtime: 'claude', model: 'claude-opus', requiredSkills: [] },
      stages: [{ id: 'codex-stage', worker: { runtime: 'codex', model: 'gpt-5.6-sol' } }],
    };

    await expect(built?.runAutomatic({ subject: 'operator', runRef: 'run-codex-unmanaged', proposal } as never))
      .resolves.toEqual({ state: 'succeeded' });
    expect(engine.runToBoundary).toHaveBeenCalled();
  });

  it('allows a resolved Codex assignment when the PTY substrate is absent', async () => {
    const deps = spyDeps();
    const built = buildActivatedExecution(baseOptions(deps, { DASHBOARD_EXECUTION_ACTIVATED: '1' }));
    const engine = (deps.createEngine as ReturnType<typeof vi.fn>).mock.results[0].value;
    const assignment = {
      agentId: 'fyt-codex', declarationPath: 'agents/fyt-codex.md', declarationHash: 'a'.repeat(64),
      profileId: 'worker:codex:gpt-5.6-sol', runtime: 'codex', model: 'gpt-5.6-sol',
    };
    const proposal = {
      manager: { runtime: 'claude', model: 'claude-opus', requiredSkills: [] },
      stages: [{ id: 'codex-stage', worker: { runtime: 'codex', model: 'gpt-5.6-sol' }, assignment }],
    };

    await expect(built?.runAutomatic({ subject: 'operator', runRef: 'run-codex-no-pty', proposal } as never))
      .resolves.toEqual({ state: 'succeeded' });
    expect(engine.runToBoundary).toHaveBeenCalled();
  });

  it('keeps a resolved Codex manager off the legacy persistent roster', async () => {
    const deps = spyDeps();
    const built = buildActivatedExecution({
      ...baseOptions(deps, { DASHBOARD_EXECUTION_ACTIVATED: '1' }),
      ptyHost: { open: vi.fn(), stop: vi.fn(), stopAll: vi.fn(), sessions: () => [] } as never,
      ptySessions: {} as never,
    });
    const assignment = {
      agentId: 'fyt-manager-codex', declarationPath: 'agents/fyt-manager-codex.md', declarationHash: 'a'.repeat(64),
      profileId: 'manager:codex:gpt-5.6-sol', runtime: 'codex', model: 'gpt-5.6-sol',
    };
    const proposal = {
      manager: { runtime: 'codex', model: 'gpt-5.6-sol', requiredSkills: [], assignment },
      stages: [{ id: 'legacy-claude', worker: { runtime: 'claude', model: 'claude-opus' } }],
    };

    await built?.runAutomatic({ subject: 'operator', runRef: 'run-codex-manager', proposal } as never);
    expect(deps.createRoster).not.toHaveBeenCalled();
  });

  it('leaves a run WITHOUT assigned stages entirely on the headless path (no roster spawn)', async () => {
    const deps = spyDeps();
    const built = buildActivatedExecution({
      ...baseOptions(deps, { DASHBOARD_EXECUTION_ACTIVATED: '1' }),
      ptyHost: { open: vi.fn(), stop: vi.fn(), stopAll: vi.fn(), sessions: () => [] } as never,
      ptySessions: {} as never,
    });
    await built?.runAutomatic({ subject: 'operator', runRef: 'run-8', proposal: { stages: [{ id: 'brief' }] } } as never);
    expect(deps.createRoster).not.toHaveBeenCalled();
  });

  it('routes worker execution by ExecutionProfile.runtime', async () => {
    const deps = spyDeps();
    const claudeExecute = vi.fn().mockResolvedValue({ state: 'succeeded' });
    const codexExecute = vi.fn().mockResolvedValue({ state: 'succeeded' });
    (deps.createWorkers as ReturnType<typeof vi.fn>).mockReturnValue({ execute: claudeExecute });
    (deps.createCodexWorkers as ReturnType<typeof vi.fn>).mockReturnValue({ execute: codexExecute });
    buildActivatedExecution(baseOptions(deps, { DASHBOARD_EXECUTION_ACTIVATED: '1' }));
    const workers = (deps.createEngine as ReturnType<typeof vi.fn>).mock.calls[0][0].workers;
    await workers.execute({ profile: { runtime: 'claude' } } as never);
    await workers.execute({ profile: { runtime: 'codex' } } as never);
    expect(claudeExecute).toHaveBeenCalledOnce();
    expect(codexExecute).toHaveBeenCalledOnce();
  });

  it('routes managed sessions by their server-owned profile runtime', () => {
    const deps = spyDeps();
    const claudeStart = vi.fn().mockReturnValue({ stop: vi.fn() });
    const codexStart = vi.fn().mockReturnValue({ stop: vi.fn() });
    (deps.createSessionAdapter as ReturnType<typeof vi.fn>).mockReturnValue({ start: claudeStart });
    (deps.createCodexSessionAdapter as ReturnType<typeof vi.fn>).mockReturnValue({ start: codexStart });
    buildActivatedExecution(baseOptions(deps, { DASHBOARD_EXECUTION_ACTIVATED: '1' }));
    const adapter = (deps.createBroker as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const observer = { onEvent: vi.fn(), onExit: vi.fn() };
    adapter.start({ runRef: 'run-1', sessionRef: 'manager-1', role: 'manager', profileId: 'manager:claude:claude-opus', approvedPrompt: 'x' }, observer);
    adapter.start({ runRef: 'run-1', sessionRef: 'manager-2', role: 'manager', profileId: 'manager:codex:gpt-5.6-sol', approvedPrompt: 'x' }, observer);
    expect(claudeStart).toHaveBeenCalledOnce();
    expect(codexStart).toHaveBeenCalledOnce();
  });

  it('wires the async chain store into both worker adapters and rejects runtime mismatch', async () => {
    const deps = spyDeps();
    const chains = {
      get: vi.fn((_runRef: string, agentId: string) => agentId === 'claude-agent'
        ? { runtime: 'claude', sessionId: 'claude-session', updatedAt: new Date().toISOString() }
        : null),
      record: vi.fn().mockResolvedValue(undefined),
    };
    (deps.createSessionChains as ReturnType<typeof vi.fn>).mockReturnValue(chains);
    buildActivatedExecution(baseOptions(deps, { DASHBOARD_EXECUTION_ACTIVATED: '1' }));
    const claudeOptions = (deps.createWorkers as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const codexOptions = (deps.createCodexWorkers as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(claudeOptions.resolveSession('run-1', 'claude-agent')).toBe('claude-session');
    expect(codexOptions.resolveThread('run-1', 'codex-agent')).toBeNull();
    await claudeOptions.recordSession('run-1', 'claude-agent', 'next-claude');
    await codexOptions.recordThread('run-1', 'codex-agent', 'next-codex');
    expect(chains.record).toHaveBeenCalledWith('run-1', 'claude-agent', { runtime: 'claude', sessionId: 'next-claude' });
    expect(chains.record).toHaveBeenCalledWith('run-1', 'codex-agent', { runtime: 'codex', sessionId: 'next-codex' });
    expect(() => codexOptions.resolveThread('run-1', 'claude-agent')).toThrow(/runtime differs/);
  });
});
