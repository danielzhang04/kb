/**
 * D0.10 — service-worker registration guard + app-shell-cache assertions.
 *
 * `registerSw` is the only browser-side glue for the PWA: it registers the hand-rolled service
 * worker (`public/sw.js`) but ONLY over a secure context (https / the ts.net origin), so a plain
 * localhost-http dev boot never installs one. The environment is injected (mirroring the sseClient
 * DI seam) so the guard is testable under jsdom, which has no real `navigator.serviceWorker`.
 *
 * The third test reads the shipped service worker source and asserts it caches the static app shell
 * and performs NO background fleet sync — iOS PWAs have no background sync; live tails stay
 * foreground over the SSE/WS hub (design §3.3).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { registerSw } from './registerSw';
import type { SwEnv } from './registerSw';

describe('registerSw', () => {
  it('registers the service worker only over a secure context', async () => {
    const register = vi.fn(() => Promise.resolve({}));
    const insecure: SwEnv = { isSecureContext: false, serviceWorker: { register } };

    await expect(registerSw(insecure)).resolves.toBe(false);
    expect(register).not.toHaveBeenCalled();

    const secure: SwEnv = { isSecureContext: true, serviceWorker: { register } };
    await expect(registerSw(secure)).resolves.toBe(true);
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
  });

  it('no-ops when the runtime has no service worker support', async () => {
    const noSw: SwEnv = { isSecureContext: true, serviceWorker: undefined };
    await expect(registerSw(noSw)).resolves.toBe(false);
  });

  it('service worker caches the app shell and does not background-sync fleet state', () => {
    const swPath = fileURLToPath(new URL('../../public/sw.js', import.meta.url));
    const sw = readFileSync(swPath, 'utf8');

    // Caches the static app shell (precache via caches.open(...).addAll(APP_SHELL)).
    expect(sw).toContain('APP_SHELL');
    expect(sw).toMatch(/caches\s*\.open/);
    expect(sw).toMatch(/addAll\(APP_SHELL\)/);

    // No background fleet sync: the SW registers NO Periodic Background Sync / background `sync`
    // handler (iOS PWAs have none). Behavioral assertion on the registered event listeners.
    expect(sw).not.toMatch(/addEventListener\(\s*['"](?:periodicsync|sync)['"]/i);

    // The live fleet channels (SSE `/events`, `/api/*`) are never cached/intercepted — foreground only.
    expect(sw).toContain('/events');
    expect(sw).toContain('/api');
  });
});
