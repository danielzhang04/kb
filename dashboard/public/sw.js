/*
 * kb Mission Control — service worker (D0.10). Hand-rolled, dependency-free.
 *
 * Scope: OFFLINE APP-SHELL CACHE ONLY. This worker precaches the static SPA shell so an installed
 * PWA opens instantly / offline, and it NEVER background-syncs fleet state:
 *   - iOS PWAs have no Background Sync / Periodic Background Sync, so there is deliberately no
 *     `sync` / `periodicsync` handler here.
 *   - Live fleet data (the SSE `/events` stream and the `/api/*` reads from the D0.4 hub) is
 *     FOREGROUND-ONLY per design §3.3 — this worker never caches or intercepts those paths.
 *
 * There is NO push subscription logic here. Declarative Web Push (approval/alert notifications) is a
 * v1+ concern whose endpoints land in D2; this file is only the installable shell + app-shell cache.
 *
 * Lives under public/ so Vite copies it verbatim into dist/ (it is not bundled/transpiled — it must
 * be runnable JS as-is in the browser's service-worker context).
 */

const CACHE_VERSION = 'kb-shell-v1';

// The static app shell. Live data is NOT listed here — it arrives over the foreground hub.
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
  '/apple-touch-icon.png',
];

// Precache the shell on install; activate immediately.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

// Drop stale shell caches on activate; take control of open clients.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

// App-shell-only fetch: serve same-origin GET shell/static assets cache-first, fall back to network.
// The live fleet channels are explicitly excluded so they always hit the network in the foreground.
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache/intercept the live fleet channels — foreground-only tails (SSE + API reads).
  if (url.pathname.startsWith('/events') || url.pathname.startsWith('/api')) return;

  event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
});
