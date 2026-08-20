# desk ⇄ VM movement — goal decisions (Daniel, 2026-08-19)

Clarifications gathered before design; the spec builds on these. Source handoff:
`handoffs/2026-08-20-desk-vm-movement-design.md` (ops).

## Scope
ALL 8 handoff items in this arc. Atlas (7–8) is decoupled: this arc designs and
stabilizes the dashboard API surface Atlas will call (remote launch, status);
Atlas features themselves are a later build.

## Goal state (acceptance bar)
- **Bar:** (1+2) resume-safe deploys + one-click-or-better deploy live and verified,
  and (6) the unified approval inbox is THE approval surface (PRs, deploys, governed
  cards, review gates — one list, one action each).
- **Designed + partially built:** (3–5) VM production floor — assets-home step,
  memory/context parity, credential/MCP provisioning.
- **Stretch (may land next arc):** a full FYT video run executing on the VM with
  assets pulled home.

## Goal function (trade-off rules)
- **Deploy semantics: straight to resume-safe.** No deferred-deploy interim. Target is
  GitHub-like behavior — pushing/deploying never waits on running work; in-flight runs
  pause at a clean boundary and rehydrate after the swap ("merging main doesn't
  disturb running terminals"). Quiescence-waiting toil is eliminated, not automated.
- Key custody for the deploy trigger: PENDING (one-click desktop-signed vs unattended
  key holder) — asked 2026-08-19.

## Facts the design rests on (codex survey, card 6a867b1f-608a2099)
- All run/stage/attempt/session state persists in `DASHBOARD_STATE_ROOT/control/
  control-plane.json` (`dashboard/server/control/store.ts:267-282,4367-4397`); startup
  `normalizeCrash()` marks in-flight work `interrupted` — records, never resumes.
- Worker children die with the service (`KillMode=control-group`); no PID/reattach
  path exists — "pause" must mean finish-current-atomic-unit-then-park.
- Quiescence gate: 8 blockers in `[cutover] dashboard/server/release/quiescence.ts:14-24`,
  enforced by `activate_release.py:378-380` on swap and rollback.
- CI artifact `kb-platform-<sha>` is UNSIGNED; signing is desktop-local at deploy time
  (`deploy_platform_release.py` + VM-pinned pubkey verify). Arming = recomputed from
  `DASHBOARD_AUTH_MODE=tailnet` at boot; lock state is process-memory only.
