# System Handover
_Generated: 2026-10-08 06:20 UTC_

Overnight the cloud nightly dispatcher ran cleanly: the preamble passed, the skills
mirror is in sync, and dashboards were regenerated. The one recurring snag is unchanged —
the daemon-directory drift check still finds a single ops-only file
(`orgs/kb-ops/workflows/acceptance-run.md`), and the checker script itself is still
missing from the `ops` branch, so the gate only runs via the copy on `main`. Tonight's run
refreshed the single canonical wake card (`6a605ebb`) in place rather than minting a new
dated duplicate; the gate only reports, it never blocks, so dispatch continued normally.

Waiting on you (nothing auto-executes):
- **Two approvals.** A figment GATE A eye-gate board (T3) needs an operator ruling before
  curation to 40 can proceed, and a kb wake:human-decision (T1) flags that the desktop
  coordination tier is degrading — desktop cadences are dormant, daemon-dirs-sync is not
  running, and the grades/activity ledgers have been frozen since 2026-07-21.
- **One desktop fix ends the nightly pile-up.** From the dashboard-ops worktree, restore
  `scripts/sync_daemon_dirs.py` onto `ops`, rule on the drifting file (reconcile to `main`
  or `--sync --prune`), and land the step-2b dedup amendment so the inbox's 15 older dated
  duplicate cards can be consolidated.
- **Two stale working/ cards** (`d126c410` figment, idle ~31 days; `6a6bc3dd` kb-ops, halted
  since July) could be archived or walked back.

Unattended, the system will keep doing exactly this each night: dispatch the nightly-review
cadence, verify preamble/skills, regenerate these dashboards, and refresh the canonical
drift wake card in place until the desktop fixes above land. No spend; budget is the
full $30/day. Projects (atlas, figment, prospecting) hold completed-but-unpushed/ungraded
work gated on your review.

## Latest handoffs
- prospecting — [2026-09-07-prospecting-p8-live-tested.md](../handoffs/2026-09-07-prospecting-p8-live-tested.md) (2026-09-07)
- figment — [2026-09-23-figment-live-chain.md](../handoffs/2026-09-23-figment-live-chain.md) (2026-09-23)
