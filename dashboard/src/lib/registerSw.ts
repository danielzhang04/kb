/**
 * D0.10 — service-worker registration guard.
 *
 * Registers the hand-rolled service worker (`/sw.js`) that offline-caches the static app shell,
 * making the SPA an installable standalone PWA (Add-to-Home-Screen on iPhone over the ts.net
 * secure-context origin). Registration is guarded to a **secure context** so a plain localhost-http
 * dev boot never installs a worker (Service Workers require https or localhost; we gate on
 * `isSecureContext` and skip otherwise). The environment is injected so the guard is unit-testable
 * under jsdom, which ships no real `navigator.serviceWorker` — the same DI seam `sseClient` uses.
 *
 * There is NO push/subscription logic here: Declarative Web Push (approval/alert notifications) is a
 * v1+ concern that lands in D2. This task ships only the installable shell + SW registration.
 */

/** The slice of `ServiceWorkerContainer` this module uses — kept minimal so tests can fake it. */
export interface ServiceWorkerLike {
  register(url: string, options?: { scope?: string }): Promise<unknown>;
}

/** Injected runtime surface: whether the context is secure + the (optional) SW container. */
export interface SwEnv {
  isSecureContext: boolean;
  serviceWorker?: ServiceWorkerLike;
}

/** Path of the shipped service worker (copied verbatim from `public/` into `dist/` by Vite). */
export const SW_URL = '/sw.js';

/**
 * Register the service worker iff the context is secure and the runtime supports service workers.
 * Resolves `true` when a registration was attempted and succeeded, `false` when skipped or failed —
 * it never rejects, so a boot failure can never take down the SPA.
 */
export function registerSw(env: SwEnv, swUrl: string = SW_URL): Promise<boolean> {
  if (!env.isSecureContext || !env.serviceWorker) {
    return Promise.resolve(false);
  }
  return env.serviceWorker.register(swUrl, { scope: '/' }).then(
    () => true,
    () => false,
  );
}

/** Convenience wrapper for `main.tsx`: reads the real browser globals and registers post-load. */
export function registerSwFromWindow(): Promise<boolean> {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return Promise.resolve(false);
  }
  const serviceWorker =
    'serviceWorker' in navigator
      ? (navigator.serviceWorker as unknown as ServiceWorkerLike)
      : undefined;
  return registerSw({ isSecureContext: window.isSecureContext, serviceWorker });
}
