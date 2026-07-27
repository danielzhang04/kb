/**
 * Always-on — PM2 supervision for the dashboard daemon, mirroring broker/pm2.config.cjs's
 * documented style so the same `pm2 start`/`pm2 save`/logon-resurrection story covers both apps.
 *
 * `server/index.ts` builds the built SPA (dist/) into the same Fastify process that already served
 * `/api/*` and the hub's /events + /ws (see server/static/routes.ts) — after `npm run build`, this
 * one PM2-supervised process is the whole dashboard: http://localhost:5317 (the origin the passkey is
 * enrolled against; see the env block below). No separate `vite` dev
 * server is needed for always-on use; `npm run dev` remains available for UI iteration.
 *
 * CREDENTIAL RULE (hard ceiling, same as the broker): this file contains NO token/secret. The
 * dashboard daemon needs none to serve reads; the WebAuthn write surface's session SECRET is
 * provisioned separately (see dashboard/server/auth/session.ts) and is never hard-coded here. The RP
 * ORIGIN is NOT a secret — it is a fixed localhost value and IS set in the env block below so
 * logon-resurrection serves the enrolled origin (empty allowlist otherwise 403s all auth; see
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
        // Localhost always-on origin (NON-SECRET) — committed so logon-resurrection always serves the
        // SAME origin the passkey is enrolled against. governance/webauthn-credentials.yaml pins
        // http://localhost:5317, and the frozen Factor C verifier anchors that origin (cfg_origin), so
        // PORT and RP origin MUST stay in lockstep here. Without DASHBOARD_RP_ORIGIN the origin allowlist
        // is empty and every auth request + the /api/pty upgrade 403s (no-allowlist).
        DASHBOARD_PORT: '5317',
        DASHBOARD_RP_ORIGIN: 'http://localhost:5317',
        // One Windows Hello / device-passkey ceremony unlocks an operator workday. The bearer remains
        // tab-scoped in the browser and every consequential request still verifies it server-side.
        // A daemon restart invalidates it because the signing secret remains ephemeral unless Daniel
        // provisions DASHBOARD_SESSION_SECRET out-of-band.
        DASHBOARD_SESSION_TTL_MS: '28800000',
        // Code stays on its reviewed work branch while all Plane-A reads and governed coordination
        // writes use a dedicated ops worktree. This prevents normal dashboard development from making
        // Launch fail (or switching the developer checkout behind the IDE).
        DASHBOARD_REPO_ROOT: 'C:\\Users\\danie\\kb-worktrees\\dashboard-ops',
        // Durable Composer artifacts use a separate reviewed work-branch checkout. Keeping this root
        // distinct from DASHBOARD_REPO_ROOT makes it impossible for a save commit to contaminate ops.
        DASHBOARD_DURABLE_REPO_ROOT: 'C:\\Users\\danie\\kb-worktrees\\dashboard-durable',
        // Local operational state for persistent Composer workspaces. This is deliberately outside
        // every git worktree: workspace metadata and resumability are private daemon state, not
        // coordination truth and never something a runner should commit or merge.
        DASHBOARD_STATE_ROOT: 'C:\\Users\\danie\\AppData\\Local\\kb-dashboard',
        DASHBOARD_CODEX_RUNNER_TASK: 'kb-codex-runner',
        // Stranded-archiver DRY-RUN clock (rollout gate step 1, policy ratified 2026-07-22): daily
        // sweep that only REPORTS would-archive picks. Both live-MOVE locks stay off
        // (STRANDED_ARCHIVE_LIVE_MOVE_ALLOWED=false compile-time; DASHBOARD_STRANDED_ARCHIVE_LIVE unset),
        // so this is fail-safe to commit — unlike the execution gate below, which stays Daniel-only.
        DASHBOARD_STRANDED_ARCHIVE_INTERVAL_MS: '86400000',
        // Enrolled PUBLIC credential (NON-SECRET), mirrored from governance/webauthn-credentials.yaml.
        // The server's login path (simplewebauthn) reads the credential store from THIS env as
        // [{id, publicKey}] where publicKey is base64url COSE bytes; the yaml stores the same P-256 key
        // as x/y coords (what the frozen Factor C verifier reads). Without this the store is empty, the
        // browser is offered no allowCredentials, and even the correct passkey 401s ("no registered
        // credential"). Re-derive on re-enroll: COSE = {1:2,3:-7,-1:1,-2:x,-3:y} → base64url.
        DASHBOARD_WEBAUTHN_CREDENTIALS:
          '[{"id":"g4zK1F_rS_ZauyemvAFQWWb5TNPQ4bfpglzawiijdjg","publicKey":"pQECAyYgASFYIEOv6xhWUq94qhoksPdQ8JP0Vuh6LObq-Rmtzh90i-whIlggfMfBGbfriPARlQ3WdcjGRJqi502qkSZyW7-5uYyTzQ8"}]',
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
