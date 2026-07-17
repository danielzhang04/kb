/**
 * D3.3 — PM2 supervision for the Broker daemon.
 *
 * PM2 keeps the session-owner long-lived: restart-on-crash (bounded), a generous `kill_timeout` so an
 * in-flight STOP-drain can finish its interrupt→SIGTERM→SIGKILL ladder before PM2 itself reaps the
 * process, and a single instance (the handle table is in-process and MUST NOT be forked — two Brokers
 * would each think they own the fleet's sessions).
 *
 * CREDENTIAL RULE (hard ceiling): this file contains NO token. `CLAUDE_CODE_OAUTH_TOKEN` is provisioned
 * by a human into the daemon's runtime environment (e.g. a PM2 ecosystem env file that is NOT committed,
 * or the launching shell) — never hard-coded here, never printed, never persisted by the Broker. Listing
 * the var name below documents that it is READ from the environment; it is intentionally left unset in
 * this committed file. `ANTHROPIC_API_KEY` is deliberately absent (subscription billing only; the
 * preamble gate refuses to spawn if it is ever set).
 *
 * Runtime: Node 24 runs TypeScript natively, so `index.ts` is the entry with the plain `node`
 * interpreter — no build step, matching the dashboard's `node server/index.ts` convention.
 */
module.exports = {
  apps: [
    {
      name: 'kb-broker',
      script: 'broker/index.ts',
      interpreter: 'node',
      // Single instance only — the handle table is in-process; never cluster/fork the session owner.
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      // Give an in-flight STOP-drain (60s grace + 30s escalate = 90s Q8 ladder) room to complete before
      // PM2 hard-kills the daemon out from under it.
      kill_timeout: 95_000,
      // Restart if memory runs away (a leaked handle table would show here first).
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        // CLAUDE_CODE_OAUTH_TOKEN: <-- provisioned by a human into the runtime env, NEVER committed here.
        // ANTHROPIC_API_KEY: <-- MUST remain unset (subscription billing only; preamble gate enforces).
      },
    },
  ],
};
