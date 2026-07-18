/**
 * Always-on — PM2 supervision for the dashboard daemon, mirroring broker/pm2.config.cjs's
 * documented style so the same `pm2 start`/`pm2 save`/logon-resurrection story covers both apps.
 *
 * `server/index.ts` builds the built SPA (dist/) into the same Fastify process that already served
 * `/api/*` and the hub's /events + /ws (see server/static/routes.ts) — after `npm run build`, this
 * one PM2-supervised process is the whole dashboard: http://localhost:4317. No separate `vite` dev
 * server is needed for always-on use; `npm run dev` remains available for UI iteration.
 *
 * CREDENTIAL RULE (hard ceiling, same as the broker): this file contains NO token/secret. The
 * dashboard daemon needs none to serve reads; the WebAuthn write surface's session secret and RP
 * origin are provisioned separately (see dashboard/server/auth/session.ts, security/origin.ts) and
 * are never hard-coded here. `ANTHROPIC_API_KEY` is deliberately absent (subscription billing only;
 * the preamble gate refuses to spawn if it is ever set) — do NOT add it to `env` below.
 *
 * Runtime: Node 24 runs TypeScript natively, so `server/index.ts` is the entry with the plain `node`
 * interpreter — no build step for the server itself (only the SPA needs `vite build`), matching the
 * broker's `node broker/daemon.ts` convention.
 */
module.exports = {
  apps: [
    {
      name: 'kb-dashboard',
      script: 'server/index.ts',
      interpreter: 'node',
      cwd: __dirname,
      // Single instance — Fastify owns one loopback listener (127.0.0.1:4317); no reason to cluster
      // a local-only read/write surface, and clustering would just contend for the same port.
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      // Fastify shuts down quickly (no long-lived session-owner drain like the broker's); a short
      // grace is enough before PM2 escalates to SIGKILL.
      kill_timeout: 10_000,
      // Restart if memory runs away.
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        // ANTHROPIC_API_KEY: <-- MUST remain unset (subscription billing only; preamble gate enforces).
      },
    },
  ],
};
