/**
 * Hub composition. Wires the origin/Host guard, the SSE and read-WS transports, and the in-memory
 * event bus onto a Fastify instance, and (optionally) bridges the live Plane-A file-watch onto the
 * bus. This is the single entry point registered by the daemon (`server/index.ts`).
 *
 * Ordering law 4: Origin/Host validation is present from the first served byte — every hub route and
 * every WS upgrade is validated — even though no write surface exists in v0. It is the invariant the
 * later (write/steering) waves inherit.
 */
import type { FastifyInstance } from 'fastify';
import type { FSWatcher } from 'chokidar';
import { createBus } from './bus.ts';
import type { EventBus } from './bus.ts';
import { wirePlaneA } from './bus.ts';
import { registerSse } from './sse.ts';
import { registerReadWs } from './ws.ts';
import { originPlugin, resolveAllowedOrigins } from '../security/origin.ts';
import type { AllowedOrigins } from '../security/origin.ts';
import type { SessionConfig } from '../auth/session.ts';
import { requireSession } from '../http/middleware.ts';

// Make the bus reachable for later tasks/the daemon (e.g. wiring the live Plane-B tail).
declare module 'fastify' {
  interface FastifyInstance {
    hubBus: EventBus;
  }
}

export interface HubOptions {
  /** The allowlist the Origin/Host guard enforces. Defaults to {@link resolveAllowedOrigins}. */
  allowedOrigins?: AllowedOrigins;
  /** When set, the live Plane-A file-watch is bridged onto the bus for this repo checkout. */
  repoRoot?: string;
  /** Reuse the process-wide bus so hub events and the surface share one stream. */
  bus?: EventBus;
}

/**
 * Register the read-only hub. Returns the event bus (also decorated as `app.hubBus`).
 *
 * The origin guard and the two transports are mounted in an encapsulated child scope so `/healthz`
 * (a pre-auth liveness probe on the root) stays reachable while every hub data route and WS upgrade
 * is validated. Within that scope the WS plugin is registered BEFORE the guard so a refused upgrade's
 * raw socket is cleanly torn down by the plugin's own onResponse cleanup.
 */
export function registerHub(app: FastifyInstance, opts: HubOptions & { sessionConfig: SessionConfig }): EventBus {
  const allowedOrigins: AllowedOrigins = opts.allowedOrigins ?? resolveAllowedOrigins();
  const bus = opts.bus ?? createBus();
  app.decorate('hubBus', bus);

  app.register(async (scope) => {
    await registerReadWs(scope, bus, { allowedOrigins });
    originPlugin(scope, { allowedOrigins });
    scope.addHook('preValidation', requireSession(opts.sessionConfig));
    registerSse(scope, bus);
  });

  if (opts.repoRoot) {
    // Fire-and-forget so the daemon's `ready`/`listen` is not blocked on the initial repo scan; the
    // watcher is closed when the app closes.
    //
    // The teardown takes the watcher from `onWatcher` (handed over synchronously) rather than from the
    // returned promise, which only settles on chokidar's `ready`. Awaiting that promise made SHUTDOWN
    // block on the very initial repo scan STARTUP deliberately refused to wait for — measured at
    // 2.5–6 s per `app.close()` against a real checkout on the W6.6 Windows gate, which dominated
    // every server/index.test.ts case and pushed the /readyz ones past the 5 s default. Closing a
    // chokidar watcher before `ready` aborts the walk and returns immediately; the scan's result is
    // discarded on close either way, so nothing is lost by not waiting for it.
    const watcherRef: { current: FSWatcher | null } = { current: null };
    void wirePlaneA(bus, opts.repoRoot, { onWatcher: (watcher) => { watcherRef.current = watcher; } });
    app.addHook('onClose', async () => {
      try {
        await watcherRef.current?.close();
      } catch {
        // ignore — best-effort teardown
      }
    });
  }

  return bus;
}
