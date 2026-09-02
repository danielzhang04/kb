# System Handover
_Generated: 2026-09-02 06:21 UTC_

**What happened overnight.** The cloud nightly dispatcher ran cleanly. The preamble
passed (no STOP file, no leaked API key, budget in bounds), skills are in sync, and
the dispatcher emitted a single `nightly-review` cadence card, which self-executed:
health checks, dashboard regeneration, and a memory note. Cost for the day is $0.00
against the $30 limit — everything ran on subscription billing.

**What is waiting on you.** Nothing is blocked on an approval, but several items in the
inbox need a human hand at the desktop:
1. **Daemon-dir drift + a missing script.** `scripts/sync_daemon_dirs.py` is still not on
   the `ops` branch, so the nightly check keeps running a copy pulled from `main`. It
   reports real drift, unchanged from last night: eight daemon-read agent specs (including
   this routine's own `agents/dispatcher-cloud.md`) exist only on `main`, three differ, one
   is extra on `ops`. From the `dashboard-ops` worktree, run `python
   scripts/sync_daemon_dirs.py --sync` for the main→ops paths, make a back-port-or-prune
   call on the ops-only `acceptance-run.md`, and decide whether to mirror the script onto
   `ops`. Tracked by umbrella card `6a7c0ebf` (drift) and `6a605ebb` (missing script); no
   new card was filed tonight because the drift set did not change.
2. **faceless-youtube** has two open gates: the bricks-fresh Phase-6B shot board (P1-P5)
   and the Variant-D vs LIKED decision (keep / edit / iterate / revert).
3. **atlas** omni-interface remediation is complete and green locally but exceeds the
   400-line contract threshold, so it needs your review before it can be committed.
4. Two decision cards remain open: the vm-ops checkout ceremony and the budget-gate
   measures-nothing question.

**What the system will do next, unattended.** The cloud dispatcher will run again on its
schedule and repeat these checks. It reports drift but never fixes it, never merges, and
never spends real money. The kb-ops `self-lint-report` cadence stays dormant until you
launch it from a watched session. Until you act on the drift, expect the same non-blocking
warning each night.
