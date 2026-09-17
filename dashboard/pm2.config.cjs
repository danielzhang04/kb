/**
 * Always-on — PM2 supervision for the dashboard daemon, mirroring broker/pm2.config.cjs's
 * documented style so the same `pm2 start`/`pm2 save`/logon-resurrection story covers both apps.
 *
 * `server/index.ts` builds the built SPA (dist/) into the same Fastify process that already served
 * `/api/*` and the hub's /events + /ws (see server/static/routes.ts) — after `npm run build`, this
 * one PM2-supervised process is the whole dashboard: http://localhost:5317 (the only origin on this
 * host's allowlist; see the env block below). No separate `vite` dev
 * server is needed for always-on use; `npm run dev` remains available for UI iteration.
 *
 * CREDENTIAL RULE (hard ceiling, same as the broker): this file contains NO token/secret. The
 * dashboard daemon needs none to serve reads; the write surface's session SECRET is
 * provisioned separately (see dashboard/server/auth/session.ts) and is never hard-coded here. The
 * ORIGIN is NOT a secret — it is a fixed localhost value and IS set in the env block below so
 * logon-resurrection serves the allowlisted origin (empty allowlist otherwise 403s everything; see
 * security/origin.ts). `ANTHROPIC_API_KEY` is deliberately absent (subscription billing only;
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
      // pm2Entry (not index.ts): PM2's fork container require()s the script rather than running it
      // as the main module, so index.ts's run-directly guard never fires there — see server/pm2Entry.ts.
      script: 'server/pm2Entry.ts',
      interpreter: 'node',
      cwd: __dirname,
      // Single instance — Fastify owns one loopback listener (127.0.0.1:5317); no reason to cluster
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
        // Localhost always-on origin (NON-SECRET). Despite the name, DASHBOARD_RP_ORIGIN is NOT a
        // relying-party setting any more — the browser credential mechanism it was named for is gone.
        // It is read by `security/origin.ts` as the win32-desktop ORIGIN ALLOWLIST and nothing else, so
        // PORT and this value must stay in lockstep: without it the allowlist is empty and every
        // governed request + the /api/pty upgrade 403s (no-allowlist).
        //
        // TRAP, stated because it has already caught one cleanup: the SAME variable is REFUSED on the VM
        // (`deploy/validate_vm_runtime.py`). Required on this host, forbidden on that one. Renaming it
        // is a follow-up; deleting it here would ground the local daemon.
        DASHBOARD_PORT: '5317',
        DASHBOARD_RP_ORIGIN: 'http://localhost:5317',
        // How long an operator session bearer stays valid. The bearer remains tab-scoped in the browser
        // and every consequential request still verifies it server-side. A daemon restart invalidates it
        // because the signing secret remains ephemeral unless Daniel provisions
        // DASHBOARD_SESSION_SECRET out-of-band.
        DASHBOARD_SESSION_TTL_MS: '28800000',
        // Code stays on its reviewed work branch while all Plane-A reads and governed coordination
        // writes use a dedicated ops worktree. This prevents normal dashboard development from making
        // Launch fail (or switching the developer checkout behind the IDE).
        DASHBOARD_REPO_ROOT: 'C:\\Users\\danie\\kb-worktrees\\dashboard-ops',
        // Immutable platform assets (schemas, scripts, and dashboard/config) come from the pinned main
        // checkout, never whichever feature worktree happened to launch PM2.
        DASHBOARD_PLATFORM_ROOT: 'C:\\Users\\danie\\kb-worktrees\\dashboard-prod',
        // Durable Composer artifacts use a separate reviewed work-branch checkout. Keeping this root
        // distinct from DASHBOARD_REPO_ROOT makes it impossible for a save commit to contaminate ops.
        DASHBOARD_DURABLE_REPO_ROOT: 'C:\\Users\\danie\\kb-worktrees\\dashboard-durable',
        // Local operational state for persistent Composer workspaces. This is deliberately outside
        // every git worktree: workspace metadata and resumability are private daemon state, not
        // coordination truth and never something a runner should commit or merge.
        DASHBOARD_STATE_ROOT: 'C:\\Users\\danie\\AppData\\Local\\kb-dashboard',
        DASHBOARD_CODEX_RUNNER_TASK: 'kb-codex-runner',
        // The enrolled browser-credential env var was REMOVED here (security review 2026-09-16,
        // MEDIUM-6). Its reader (`auth/credentialStore.ts`) was deleted with the credential mechanism
        // itself, so the value was dead env — harmless public material, but live config for a mechanism
        // that no longer exists, in the one file the anti-regression grep did not scan. That grep (in
        // `dashboard/server/authority/`) now names this file, which is why neither the deleted variable
        // nor the mechanism is spelled out above: either name would trip it.
        //
        // The SESSION SECRET stays OUT of this file (ephemeral per-process unless DASHBOARD_SESSION_SECRET
        // is provisioned out-of-band); ANTHROPIC_API_KEY MUST remain unset (subscription billing only;
        // preamble gate enforces).
        //
        // WAVE-A EXECUTOR ACTIVATION GATE (D3/D5) — deliberately UNSET so the committed daemon is inert:
        // with this variable absent, buildActivatedExecution returns null, no automatic engine/broker is
        // constructed, and no `claude` worker can spawn (the daemon behaves byte-for-byte as today). The
        // LIVE flip is Daniel's alone, in a watched session, per the acceptance runbooks — uncomment the
        // one line below to arm it, restart, and re-comment to roll back:
        // DASHBOARD_EXECUTION_ACTIVATED: '1',  // Daniel-only live flip; keep commented/unset by default
      },
    },
  ],
};
