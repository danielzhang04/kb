# System Handover
_Generated: 2026-09-14 06:18 UTC_

**What happened overnight.** The cloud nightly dispatcher ran cleanly: preamble OK, pyyaml
present, `sync_skills` in sync. The daemon-dir drift gate was the same as the last several
nights: its script (`scripts/sync_daemon_dirs.py`) is absent from the `ops` branch but present
on `main`, so I ran `main`'s copy in refs-fallback mode — it reports one ops-only file
(`orgs/kb-ops/workflows/acceptance-run.md`) that isn't on `main`. That gate only reports and
never blocks, so the run continued and filed a wake-me card. The dispatcher emitted one cadence
card (`nightly-review`), which this run executed to regenerate these dashboards. Yesterday's
ledgers now show rows, so the nightly is firing on schedule. Spend today: $0.00 of the $30
daily budget.

**What is waiting on you.**
1. **figment T3 approval** — GATE A eye-gate card `65d8f246-8a461521`: your seven-axis blind
   board on creator-001 (now batch expansion-03) so curation to 40 can proceed.
2. **Daemon-dir fix (desktop)** — from the dashboard-ops worktree, restore
   `sync_daemon_dirs.py` to the `ops` branch (so the literal step-2b check runs without the
   refs-fallback workaround), then decide the one ops-only file: reconcile
   `orgs/kb-ops/workflows/acceptance-run.md` onto `main`, or `--sync --prune` to drop it from
   `ops`. Six wake-me cards on this one issue are stacking in the inbox; nightly keeps re-filing
   them because the routine has no dedup clause yet.
3. **atlas** — the omni-interface remediation diff (> 400 lines) is ready but needs your review
   before commit per the project contract.
4. **kb-ops** — the VM dashboard service has been down since 2026-09-06; fix PR **#173** is
   reviewed-mergeable but still open. Recovery hasn't been run.

**What the system will do unattended.** The nightly cloud dispatcher will run again next
schedule: preamble + drift checks, emit and execute cadence cards, regenerate dashboards, and
push coordination writes to `ops`. It will NOT merge PRs, restore or `--sync` the daemon-dir
script, or clear the approvals card — all human actions. Two working cards are stale (figment
replicate ~1 week; a halted kb-ops card stranded in `working/`) and will not self-clear.
