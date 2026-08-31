/**
 * T6 — the gated real-daemon boot smoke.
 *
 * Vitest-green is NOT sufficient to call Wave A done: the daemon boot path has broken twice while the unit
 * suite stayed green. This smoke boots the REAL Fastify app (the same `buildApp` the daemon and pm2 entry
 * use) and asserts:
 *   - GATE OFF (production default): the daemon listens and is byte-for-byte inert — no broker, no engine,
 *     no `runAutomatic`; and the Wave-A bridge/observer modules, which are wired NOWHERE in the boot path,
 *     construct nothing merely by being imported.
 *   - GATE ON (smoke only, ephemeral state root, hermetic git/policy): the full production construction
 *     chain — every real adapter factory + the AutomaticExecutionEngine + the runAutomatic/fleet-ledger
 *     wrap — assembles cleanly without throwing and yields the injection triple. No real `claude` spawns
 *     (construction is lazy).
 *
 * The gate-ON *daemon* boot under real env is the human-supervised T7 acceptance (the real daemon, gate on,
 * watched); this smoke proves the construction chain hermetically so a boot break is caught in CI.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../index.ts';
import { makeSurfaceContext } from '../http/surface.ts';
import {
  buildActivatedExecution, createExecutionLatch, defaultWorktreeRoot, isExecutionActivated, type ActivationDeps,
} from './activation.ts';
import { isInternalServiceCaller, type InternalServiceCaller } from '../auth/session.ts';
import { createExistingRootFileStoreHarnessForTest } from './test-fixtures/controlStore.ts';
import { createQueueBridge, settleFleetLedgerForRun } from './queueBridge.ts';

/** A control store whose getRun always misses — the observer must treat it as a no-op, never throw. */
const missingRunStore = { getRun: () => ({ ok: false as const, reason: 'not-found' as const, detail: 'x' }) };
const fileStores = createExistingRootFileStoreHarnessForTest();
const createFileControlPlaneStore = fileStores.open;

describe('T6 gated boot smoke', () => {
  const savedEnv: Record<string, string | undefined> = {};
  let tempStateRoot: string;

  beforeEach(() => {
    for (const key of ['DASHBOARD_EXECUTION_ACTIVATED', 'DASHBOARD_STATE_ROOT']) savedEnv[key] = process.env[key];
    tempStateRoot = mkdtempSync(join(tmpdir(), 'wave-a-boot-'));
    process.env.DASHBOARD_STATE_ROOT = tempStateRoot;
  });

  afterEach(() => {
    fileStores.close();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(tempStateRoot, { recursive: true, force: true });
  });

  it('GATE OFF: the real daemon boots, listens, and is inert (no broker/engine/runAutomatic)', async () => {
    delete process.env.DASHBOARD_EXECUTION_ACTIVATED;
    expect(isExecutionActivated(process.env)).toBe(false);

    let app: FastifyInstance | null = null;
    try {
      app = buildApp({ controlStore: createFileControlPlaneStore(tempStateRoot) });
      await app.listen({ port: 0, host: '127.0.0.1' });
      const { port } = app.server.address() as AddressInfo;
      const res = await fetch(`http://127.0.0.1:${port}/healthz`);
      expect(res.status).toBe(200);
    } finally {
      if (app) await app.close();
    }

    // The core inert invariant, at the surface composition root: gate off ⇒ the three executor fields are
    // undefined (production constructs no attempt port/engine and can spawn no `claude`).
    const ctx = makeSurfaceContext({ controlStore: createFileControlPlaneStore(tempStateRoot) });
    expect(ctx.attemptPort).toBeUndefined();
    expect(ctx.runAutomatic).toBeUndefined();
    expect(ctx.cancelAutomatic).toBeUndefined();
  });

  it('GATE OFF: the un-wired bridge/observer modules construct nothing merely by being present', async () => {
    // createQueueBridge without .start() installs no timer and dispatches nothing.
    const bridge = createQueueBridge({ repoRoot: tempStateRoot, runPreamble: () => ({ exitCode: 0, stdout: 'OK', stderr: '' }) });
    expect(typeof bridge.tick).toBe('function');
    bridge.stop(); // idempotent no-op when never started

    // The post-run observer on a store that has no such run is a pure no-op — never throws, settles nothing
    // (and never reaches the ops-commit path, so it needs no git).
    const result = await settleFleetLedgerForRun({ controlStore: missingRunStore, repoRoot: tempStateRoot }, { runRef: 'run-absent' });
    expect(result).toEqual({ settled: false, emitted: 0, blocked: false });
  });

  it('GATE ON (ephemeral state root, hermetic git/policy): the real construction chain assembles cleanly', () => {
    process.env.DASHBOARD_EXECUTION_ACTIVATED = '1';
    const controlStore = createFileControlPlaneStore(tempStateRoot);
    // Only git (resolveBaseCommit) and policy load are stubbed — every adapter factory + the engine + the
    // runAutomatic/ledger wrap are the REAL production defaults, so a construction break surfaces here.
    const hermeticDeps: Partial<ActivationDeps> = {
      resolveBaseCommit: () => 'f'.repeat(40),
      loadPolicy: () => ({ profiles: [], curatedSkills: new Set<string>(), contractText: '', governanceContents: {} }) as never,
    };
    const activated = buildActivatedExecution({
      env: process.env,
      controlStore,
      repoRoot: process.cwd(),
      stateRoot: tempStateRoot,
      deps: hermeticDeps,
    });
    expect(activated).not.toBeNull();
    // No PTY host or binding store was supplied to this hermetic build, so no attempt can start.
    expect(activated?.attemptPort).toBeNull();
    expect(typeof activated?.runAutomatic).toBe('function');
    expect(typeof activated?.cancelAutomatic).toBe('function');
  });

  it('GATE ON: construction succeeds when the Linux worktree root does not exist and creates no directory', () => {
    process.env.DASHBOARD_EXECUTION_ACTIVATED = '1';
    // [C-S4] regression. On the VM `/var/lib/kb-shell/worktrees` is broker-owned (`kb-shell`, 02770,
    // created by the installer) and NOT creatable by the dashboard uid. W6.5 left an eager
    // `mkdirSync(worktreeRoot, …)` in the worktree adapter's and the result integrator's constructors, so
    // every gate-ON construction on Linux died with `EACCES: permission denied, mkdir
    // '/var/lib/kb-shell/worktrees'` before any attempt existed. The dashboard NEVER creates that root:
    // the production default path must be constructible on a host where the root is absent or unwritable,
    // and composition must touch the filesystem under it not at all. A missing root is the host's create
    // refusal at attempt time, not a composition crash.
    const linuxRoot = defaultWorktreeRoot(tempStateRoot, { DASHBOARD_HOST_PLATFORM: 'linux' });
    expect(linuxRoot).toBe('/var/lib/kb-shell/worktrees');
    const rootExistedBefore = existsSync(linuxRoot);
    const hermeticDeps: Partial<ActivationDeps> = {
      resolveBaseCommit: () => 'f'.repeat(40),
      loadPolicy: () => ({ profiles: [], curatedSkills: new Set<string>(), contractText: '', governanceContents: {} }) as never,
    };
    const activated = buildActivatedExecution({
      env: { ...process.env, DASHBOARD_HOST_PLATFORM: 'linux' },
      controlStore: createFileControlPlaneStore(tempStateRoot),
      repoRoot: process.cwd(),
      stateRoot: tempStateRoot,
      deps: hermeticDeps,
    });
    expect(activated).not.toBeNull();
    // Absence proof: the root is exactly as construction found it, and neither constructor materialized
    // the `.disabled-hooks` sibling both of them name in their git prefix.
    expect(existsSync(linuxRoot)).toBe(rootExistedBefore);
    expect(existsSync(join(linuxRoot, '.disabled-hooks'))).toBe(false);

    // Windows keeps the state-root tree as its default (behaviour unchanged) — and that tree is likewise
    // only created when an attempt is actually provisioned, never at composition.
    const windowsRoot = defaultWorktreeRoot(tempStateRoot, { DASHBOARD_HOST_PLATFORM: 'win32' });
    expect(windowsRoot).toBe(join(tempStateRoot, 'control', 'worktrees'));
    expect(buildActivatedExecution({
      env: { ...process.env, DASHBOARD_HOST_PLATFORM: 'win32' },
      controlStore: createFileControlPlaneStore(tempStateRoot),
      repoRoot: process.cwd(),
      stateRoot: tempStateRoot,
      deps: hermeticDeps,
    })).not.toBeNull();
    expect(existsSync(windowsRoot)).toBe(false);
  });

  it('PASSKEY LATCH: mints the internal service caller only through the armed latch path', () => {
    let caller: InternalServiceCaller | null = null;
    const latch = createExecutionLatch({
      env: {},
      buildOptions: {
        controlStore: createFileControlPlaneStore(tempStateRoot),
        repoRoot: process.cwd(),
        stateRoot: tempStateRoot,
        deps: {
          resolveBaseCommit: () => 'f'.repeat(40),
          loadPolicy: () => ({ profiles: [], curatedSkills: new Set<string>(), contractText: '', governanceContents: {} }) as never,
        },
      },
      onChange: (_execution, _state, nextCaller) => { caller = nextCaller; },
    });
    expect(latch.unlock({ subject: 'operator' }).ok).toBe(true);
    expect(isInternalServiceCaller(caller)).toBe(true);
  });

  it('GATE ON: exposes one attemptIo store and gives both worker factories the attempt port', () => {
    process.env.DASHBOARD_EXECUTION_ACTIVATED = '1';
    const createWorkers = vi.fn().mockReturnValue({ begin: vi.fn(), postMessage: () => false });
    const createCodexWorkers = vi.fn().mockReturnValue({ begin: vi.fn() });
    const activated = buildActivatedExecution({
      env: process.env,
      controlStore: createFileControlPlaneStore(tempStateRoot),
      repoRoot: process.cwd(),
      stateRoot: tempStateRoot,
      deps: {
        resolveBaseCommit: () => 'f'.repeat(40),
        loadPolicy: () => ({ profiles: [], curatedSkills: new Set<string>(), contractText: '', governanceContents: {} }) as never,
        createWorkers: createWorkers as never,
        createCodexWorkers: createCodexWorkers as never,
      },
    });
    expect(activated?.attemptIo).toEqual(expect.objectContaining({
      append: expect.any(Function), read: expect.any(Function), onAppend: expect.any(Function),
    }));
    // [C-S5]: the transcript sink is the attempt port's recorder, not a worker-factory option; the
    // factories now take only the attempt port and the server-owned worktree root.
    expect(createWorkers).toHaveBeenCalledWith(expect.objectContaining({ worktreeRoot: expect.any(String) }));
    expect(createCodexWorkers).toHaveBeenCalledWith(expect.objectContaining({ worktreeRoot: expect.any(String) }));
  });
});
