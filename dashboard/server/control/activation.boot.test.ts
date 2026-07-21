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
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../index.ts';
import { makeSurfaceContext } from '../http/surface.ts';
import { buildActivatedExecution, isExecutionActivated, type ActivationDeps } from './activation.ts';
import { createFileControlPlaneStore } from './store.ts';
import { createQueueBridge, settleFleetLedgerForRun } from './queueBridge.ts';

/** A control store whose getRun always misses — the observer must treat it as a no-op, never throw. */
const missingRunStore = { getRun: () => ({ ok: false as const, reason: 'not-found' as const, detail: 'x' }) };

describe('T6 gated boot smoke', () => {
  const savedEnv: Record<string, string | undefined> = {};
  let tempStateRoot: string;

  beforeEach(() => {
    for (const key of ['DASHBOARD_EXECUTION_ACTIVATED', 'DASHBOARD_STATE_ROOT']) savedEnv[key] = process.env[key];
    tempStateRoot = mkdtempSync(join(tmpdir(), 'wave-a-boot-'));
    process.env.DASHBOARD_STATE_ROOT = tempStateRoot;
  });

  afterEach(() => {
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
      app = buildApp();
      await app.listen({ port: 0, host: '127.0.0.1' });
      const { port } = app.server.address() as AddressInfo;
      const res = await fetch(`http://127.0.0.1:${port}/healthz`);
      expect(res.status).toBe(200);
    } finally {
      if (app) await app.close();
    }

    // The core inert invariant, at the surface composition root: gate off ⇒ the three executor fields are
    // undefined (production constructs no broker/engine and can spawn no `claude`).
    const ctx = makeSurfaceContext();
    expect(ctx.controlBroker).toBeUndefined();
    expect(ctx.runAutomatic).toBeUndefined();
    expect(ctx.cancelAutomatic).toBeUndefined();
  });

  it('GATE OFF: the un-wired bridge/observer modules construct nothing merely by being present', () => {
    // createQueueBridge without .start() installs no timer and dispatches nothing.
    const bridge = createQueueBridge({ repoRoot: tempStateRoot, runPreamble: () => ({ exitCode: 0, stdout: 'OK', stderr: '' }) });
    expect(typeof bridge.tick).toBe('function');
    bridge.stop(); // idempotent no-op when never started

    // The post-run observer on a store that has no such run is a pure no-op — never throws, settles nothing.
    const result = settleFleetLedgerForRun({ controlStore: missingRunStore, repoRoot: tempStateRoot }, { runRef: 'run-absent' });
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
    expect(activated?.controlBroker).toBeDefined();
    expect(typeof activated?.runAutomatic).toBe('function');
    expect(typeof activated?.cancelAutomatic).toBe('function');
  });
});
