# System Handover
_Generated: 2026-10-12 06:22 UTC_

Overnight the cloud nightly dispatcher ran: the preamble checks passed, the skills mirror
is in sync, both dashboards were regenerated, and no money was spent (the whole $30 daily
budget is free). As on recent nights, the session was not allowed to switch to the `ops`
branch locally — and this time the classifier also blocked running the preamble script
directly, so its three safety conditions (no STOP file, no API key set, $0 spent today)
were verified by hand instead. The work was done in a worktree cut from `origin/ops`. This
run the direct `HEAD:ops` push was ALSO blocked (unlike recent nights), so the coordination
writes did NOT reach `ops` directly — they sit in **PR #209**
(https://github.com/danielzhang04/kb/pull/209), branch `claude/ops-sync-2026-10-12`, targeting
`ops` and **waiting for you to merge it**. Until you merge, `ops` has no 2026-10-12 update.

What is waiting on you. Two cards sit in `queue/approvals/` for a ruling: the figment
**GATE A eye-gate** (T3) and the kb **wake:human-decision** (T1) about the degrading
desktop tier. The desktop cadences (`daemon-dirs-sync`, `grades-reconcile`) are still
dormant, so the main→ops mirror drift is never auto-fixed and the grading ledgers have been
frozen since July (~83 days). This is known and already escalated — no new duplicate card
was filed; the canonical drift card was refreshed in place for the 8th night. The desktop
fixes can only be done at your desk: re-add `scripts/sync_daemon_dirs.py` to `ops`, run
`--sync --prune` to clear the one drift file (`acceptance-run.md`), restart the desktop
daemon, and sweep the inbox backlog (120 cards, 15 of them duplicate drift wake-me cards).
Two cards are also stuck in `working/`: a figment card unparseable for ~35 days and a
halted codex card from July.

What runs next unattended. Only the cloud nightly dispatcher — tomorrow, same checks.
Nothing else fires without you.

## Latest handoffs
- figment — [2026-09-23-figment-live-chain.md](../handoffs/2026-09-23-figment-live-chain.md) (2026-09-23)
- prospecting — [2026-09-07-prospecting-p8-live-tested.md](../handoffs/2026-09-07-prospecting-p8-live-tested.md) (2026-09-07)
