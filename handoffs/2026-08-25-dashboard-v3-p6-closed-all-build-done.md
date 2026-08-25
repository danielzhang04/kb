# Handoff — dashboard-v3 ALL BUILD PHASES DONE, P7 presented (2026-08-25 ~19:00)

**Branch:** `claude/dashboard-v3` — tip `a2fa5b24`. The overnight autonomous build (Daniel hands-off,
"run through the end of the plan") is COMPLETE through P6. Only **P7 remains — presented, not built**
(Daniel's hands-on acceptance batch). Boss session (started `c3b25381`, resumed `b837a9ae`).

## Load (read on resume)
- Auto-memory `dashboard-v3-arc.md` — PRIMARY resume point, P6-CLOSED block at top
- Ledger (boss scratchpad, session 833beb04): `dv3-p3-carried-deltas.md` — the full P4/P5/P6 running
  ledger + all boss rulings + the accumulated P7 fold list
- `docs/plans/2026-08-23-dv3-p6-plan.md` (SHIP a2e37af6) — the phase just closed
- Prior handoff (superseded): `2026-08-25-dashboard-v3-p5-closed-p6-w0.md`

## What shipped this overnight run
**P4 CLOSED @ `a96a00a7`** — coordination overhaul (proposal records, durable manifest, Inbox projection,
reconciliation Sweeper/publisher sole-mutator, schedule mirror, execution paths). P4-CLOSE-CLEAN.
**P5 CLOSED @ `4f98f429`** — one-click deploy from Inbox (deploy services, T3 helper protocol, inbox
projector, health readers, quiescence; W6.1-W6.5). §7 1014/1014, 12/12 mutation-verified attacks,
112/112 real-Edge browser cells. P5-CLOSE-CLEAN + P5-PHASE-CLEAN.
**P6 CLOSED @ `a2fa5b24`** — the `/api/v1` versioned API + host-advertisement/placement-leases +
root-owned node-identity map + attested node-proxy/WhoIs shim + Desktop daemon (24 commits, 111 files,
+11349/-521). Every vertical opus/sonnet-reviewed + fixed. **P6-CLOSE-CLEAN:** §7 focused SERIAL
**1406/1406** + pytest **211**; **21/21** attacks + assertP6GateResults require-exact; two-daemon **6/6**
real HTTPS; both §8 browser matrices **24/24** real-Edge; §4/§9 probes clean; NUL 0/745; both-platform
gate clean modulo proven load-flakes (Linux + Windows bad-alone:0). **P6-PHASE-CLEAN** (7 end-to-end
security seams). Every phase closed with a build → adversarial-review → fix → verify → both-platform-gate
→ whole-phase-review loop.

## P7 — Daniel's hands-on acceptance batch (PRESENTED, not built)
Per the standing ruling, P7 is Daniel's. The code paths for these fail CLOSED until he wires them:
1. **Live deploy (P5):** async ceremony-verify interface + real helper transport into the inbox action
   ports + `DASHBOARD_DESKTOP_HELPER_ORIGIN` required-env + the escalation-card publisher; then Daniel's
   passkey registration and one live deploy of a tested commit, comparing the Home chip SHA against
   `systemctl show --property MainPID` + the loaded platform root.
2. **Production node/placement wiring (P6):** the `ControlPlaneStore`→async lease/report/advertise port
   adapter under the writer lease (node scope + v1 operator reads currently fail-closed 503/404 in prod);
   route-level `v1Idempotency` replay dedup (CAS preconditions already cover the real safety); wire the 4
   live-fact validators (`validate_whois_runtime_dir/tailscaled_socket/no_operator_pref/node_listener_and_uid`)
   into `validate_vm_runtime.py` main().
3. **VM deployment (P6):** deploy the attested `kb-node-proxy` + `kb-whois` units on the VM (root-owned
   host-node map at `0444`, uid topology `DASHBOARD_NODE_PROXY_UID ∉ {0, tailnet uid}`), the two-listener
   `tailscale serve` (443 operator / 8444 node), then a real tailnet rotation + partition test.
4. **Carry-overs (P3/P4):** passkey registration, WSL sudo/native oracle, ACL-locked worktree deletes,
   CodexSandboxUsers ACL finding, /run/kb-shell checks, provider sign-ins, CI broker build step.
5. **Doc folds (low priority):** plan §1/§12 disposition for P4/P5/P6 closure items (all captured in the
   ledger); the §8 controlClient `src/control/` path in the plan text.

## Live worktrees
- `kb-worktrees/dv3-gate` — Windows gate oracle (at `a2fa5b24`; do not sweep)
- WSL `~/kb-v3` — Linux gate oracle (do not sweep)
- No agent worktrees remain (all swept at each vertical close).

## Keep-awake
`keep_awake.ps1 -Supervise -MaxHours 16` re-armed 2026-08-25 ~18:00. Renew before the cap if the session
continues (though the build is done — only Daniel's P7 review remains).
