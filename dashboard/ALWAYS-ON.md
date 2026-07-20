# Running the dashboard always-on

Today the dashboard daemon also serves the built SPA directly (see `server/static/routes.ts`). The
raw development server defaults to `127.0.0.1:4317`; the PM2 always-on configuration sets it to
`127.0.0.1:5317`, matching the enrolled passkey origin. Once `dist/` exists, this one process IS the
whole dashboard. No separate `vite` dev server is needed day-to-day; `npm run dev` still works for UI
iteration (it proxies `/api/*` to the raw development server on `:4317`).

Localhost-only binding (`127.0.0.1`) is deliberate and unchanged — WebAuthn is armed for the
`localhost` RP origin, so the write surface only works from the same machine.

## Build

```
cd dashboard
npm run build
```

This produces `dashboard/dist/`. If `dist/` is missing, the daemon logs a one-line notice and falls
back to API-only mode (unchanged dev behavior) — it never fails to boot.

## One-time human setup (PM2)

Run once, from the repo root:

```
npm i -g pm2
pm2 start dashboard/pm2.config.cjs
pm2 save
```

`pm2 save` snapshots the running process list so it can be resurrected later (next step).

### Resurrect PM2 on Windows logon

PM2's own startup hook targets Linux/macOS init systems; on Windows the documented approach is the
`pm2-windows-startup` package, which adds a registry Run-key entry that calls `pm2 resurrect` at
user logon:

```
npm install -g pm2-windows-startup
pm2-startup install
```

(Re-run `pm2 save` any time the process list changes — `pm2-startup install` only wires the
resurrection *mechanism*; it does not itself capture which processes to restore.)

This runs at **user logon**, not as a background service independent of any signed-in session — if
that's insufficient (e.g. the machine should serve the dashboard before/without an interactive
logon), use a Task Scheduler entry triggered `At startup` (not `At log on`) running as the target
user, with action:

```
schtasks /create /tn "pm2-resurrect" /sc onstart /ru <username> /rl highest /tr "pm2 resurrect"
```

To remove the registry-based hook: `pm2-startup uninstall`.

## Updating after a merge

```
git pull
cd dashboard
npm run build
pm2 restart kb-dashboard
```

## Access

Once running under PM2: **http://localhost:5317**

(`127.0.0.1` and `localhost` are equivalent here; the RP origin WebAuthn is armed for is
`localhost`, so use that host if you're using a passkey.)
