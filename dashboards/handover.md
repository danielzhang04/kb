# System Handover
_Generated: 2026-09-13 06:08 UTC_

**What happened overnight.** The cloud nightly dispatcher ran cleanly: preamble OK, pyyaml
present, `sync_skills` in sync. The daemon-dir drift gate again reported drift and continued
(it never blocks dispatch): `scripts/sync_daemon_dirs.py` is still missing from the `ops`
branch, and one ops-only file (`orgs/kb-ops/workflows/acceptance-run.md`) sits on `ops` but
not `main`. The dispatcher emitted one cadence card (`nightly-review`), which this run
executed to regenerate these dashboards. Spend today: $0.00 of the $30 daily budget.

**What is waiting on you.**
1. **figment T3 approval** — GATE A eye-gate card `65d8f246-8a461521`: your seven-axis blind
   board on creator-001 expansion-02 so curation to 40 can proceed.
2. **Daemon-dir fix (desktop)** — from the dashboard-ops worktree, restore
   `sync_daemon_dirs.py` to `ops` and decide the `acceptance-run.md` drift (reconcile onto
   main, or `--sync --prune`). Six wake-me cards, five on this one issue, are stacking in the
   inbox; nightly keeps re-filing them because the routine has no dedup clause yet.
3. **atlas** — the omni-interface remediation diff (> 400 lines) is ready but needs your review
   before commit per the project contract.
4. **kb-ops** — the VM dashboard service has been down since 2026-09-06; fix PR **#173** is
   reviewed-mergeable but still open. Recovery hasn't been run.

**What the system will do unattended.** The nightly cloud dispatcher will run again next
schedule: preamble + drift checks, emit and execute cadence cards, regenerate dashboards, and
push coordination writes to `ops`. It will NOT merge PRs, run the daemon-dir `--sync`, or clear
the approvals card — all of those are human actions. Note: yesterday (09-12) recorded no
ledger rows, so confirm the nightly is firing on schedule. Two working cards are stale
(figment replicate ~6 days; a halted kb-ops card stranded in `working/` ~45 days) and will not
self-clear.
