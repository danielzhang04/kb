/**
 * `registerHub`'s SHUTDOWN path. The production daemon's teardown was measured at 2.5-6 s per
 * `app.close()` because the onClose hook awaited `wirePlaneA`'s promise, which only settles on
 * chokidar's initial-scan `ready` — the very scan startup deliberately refuses to wait for. The fix
 * takes the watcher from the synchronous `onWatcher` handover instead; these are its regression tests.
 */
import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { FSWatcher } from 'chokidar';

/** A watcher that never becomes `ready`: `wirePlaneA`'s promise stays pending for the whole test. */
const watcherState = { handedOver: 0, closed: 0, readySettled: false, rejectClose: false };

vi.mock('./bus.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./bus.ts')>();
  return {
    ...actual,
    wirePlaneA: (_bus: unknown, _repoRoot: string, opts?: { onWatcher?: (watcher: FSWatcher) => void }) => {
      watcherState.handedOver += 1;
      opts?.onWatcher?.({
        async close() {
          watcherState.closed += 1;
          if (watcherState.rejectClose) throw new Error('watcher refused to close');
        },
      } as unknown as FSWatcher);
      // Never settles — a real initial scan of a large checkout, still walking when close() is called.
      return new Promise<FSWatcher>(() => {});
    },
  };
});

const hubOptions = () => ({
  repoRoot: process.cwd(),
  allowedOrigins: ['http://127.0.0.1:1234'],
  sessionConfig: { secret: randomBytes(32), ttlMs: 60_000 },
});

let app: FastifyInstance | undefined;
afterEach(async () => {
  if (app) {
    await app.close();
    app = undefined;
  }
  watcherState.handedOver = 0;
  watcherState.closed = 0;
  watcherState.readySettled = false;
  watcherState.rejectClose = false;
});

describe('registerHub teardown', () => {
  it('closes a repoRoot-configured hub inside a bound without waiting for the watcher ready', async () => {
    const { registerHub } = await import('./index.ts');
    app = Fastify();
    registerHub(app, hubOptions());
    await app.ready();
    expect(watcherState.handedOver).toBe(1);

    const started = Date.now();
    await app.close();
    app = undefined;
    const elapsed = Date.now() - started;

    // The whole point of the fix: teardown takes the watcher from the synchronous handover, so it does
    // not block on the initial scan (which here never finishes at all).
    expect(watcherState.readySettled).toBe(false);
    expect(watcherState.closed).toBe(1);
    expect(elapsed).toBeLessThan(2_000);
  }, 20_000);

  it('closes cleanly when the watcher close itself rejects', async () => {
    const { registerHub } = await import('./index.ts');
    watcherState.rejectClose = true;
    app = Fastify();
    registerHub(app, hubOptions());
    await app.ready();

    // Best-effort teardown: a watcher that refuses to close must not strand the daemon's shutdown.
    await expect(app.close()).resolves.toBeUndefined();
    app = undefined;
    expect(watcherState.closed).toBe(1);
  }, 20_000);
});
