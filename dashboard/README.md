# kb Mission Control (`dashboard/`)

An **optional** local web daemon that projects the fleet's live state. If the dashboard is off, the
fleet coordinates through git exactly as today. **Git stays the database**; the dashboard is a
projection over files (Plane A = the kb repo, Plane B = local Claude Code JSONL transcripts) plus a
thin authenticated GUI over `scripts/*`.

This directory is scaffolded by **Task D0.1** of `docs/plans/2026-07-16-dashboard-implementation.md`:
one Node/TS Fastify backend (`server/`) + a Vite/React SPA (`src/`).

## Pinned toolchain (decided up front — D0.1)

- **Node `24.18.0`** — pinned in `.nvmrc` and `package.json` `engines`. The daemon's Node version is
  pinned so a `node-pty` native rebuild is never forced silently by an out-of-band Node upgrade.
- **npm `11.16.0`** — the box's package manager. **No pnpm** — use `npm` for all installs.
- `dashboard/node_modules/` and `dashboard/dist/` are gitignored (root `.gitignore`).

## Scripts

| command             | what it does                                                        |
| ------------------- | ------------------------------------------------------------------ |
| `npm test`          | vitest run (unit tests, `server/**` + `src/**`)                    |
| `npm run test:watch`| vitest watch mode                                                  |
| `npm run build`     | `vite build` → `dashboard/dist/`                                    |
| `npm run dev`       | Vite dev server (localhost) proxying `/api` + `/events` to Fastify  |
| `npm run dev:server`| Fastify backend (`node server/index.ts`, native TS via Node 24)     |
| `npm run typecheck` | `tsc --noEmit`                                                      |

The Fastify backend binds **`127.0.0.1` only** and exposes `/healthz`. The Vite dev server proxies
`/api` and `/events` (WebSocket) to the backend on port `4317`.

## node-pty ABI / prebuild strategy (DECIDED in D0.1; node-pty ships in D3.1)

`node-pty` is **not a dependency yet** — it is added in **Task D3.1** (the v2 PTY pane), which is
gated on an SDK-on-subscription ToS re-verification and a Broker threat review. Deciding the native
strategy now (against the pinned Node ABI) means a bare box is **never** a from-scratch native build
at D3 time:

1. **Primary — vendor a known-good ConPTY prebuild matching the pinned ABI.** Node `24.18.0` fixes
   the V8/N-API ABI (`process.versions.modules`). At D3.1 we pin an exact `node-pty` version and vendor
   its prebuilt Windows ConPTY binary for that ABI, so `npm install` resolves to a prebuild and performs
   **no** compilation on this box. Pinning Node up front is what makes a stable prebuild target exist.
2. **Fallback — `node-gyp` + Visual Studio Build Tools rebuild.** If no matching prebuild is available
   for the pinned ABI, rebuild from source via `node-gyp` against the installed VS Build Tools
   (C++ workload + Windows SDK). This is the fallback only; the primary path avoids it.

Because Node is pinned, the ABI target is stable and the prebuild remains valid across daemon restarts
— an out-of-band Node upgrade is the one thing that would invalidate it, which the pin prevents.

## Status

- **D0.1 (this task):** scaffold only — Fastify `/healthz` + empty Control shell. No writes, no fleet
  coupling. Feature waves (Plane-A/Plane-B indexers, SSE/WS hub, registries, timeline, traces) follow
  in D0.2–D0.11.
