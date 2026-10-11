# System Handover
_Generated: 2026-10-11 06:20 UTC_

Overnight the cloud nightly dispatcher ran: the preamble passed, the skills mirror is in
sync, both dashboards were regenerated, and no money was spent (the whole $30 daily budget
is free). One wrinkle this run: the session was not allowed to switch to the `ops` branch
locally, so it did the work in a worktree cut from `origin/ops` and is handing the
coordination writes to you as a pull request instead of pushing `ops` directly.

What is waiting on you. Two cards sit in `queue/approvals/` for a ruling: the figment
**GATE A eye-gate** (T3) and the kb **wake:human-decision** (T1) about the degrading
desktop tier. The desktop cadences (`daemon-dirs-sync`, `grades-reconcile`) are still
dormant, so the main→ops mirror drift is never auto-fixed and the grading ledgers have
been frozen since July (~82 days). This is a known, already-escalated problem — no new
duplicate card was filed; the canonical drift card was refreshed in place for the 7th
night. The desktop fixes can only be done at your desk: re-add `scripts/sync_daemon_dirs.py`
to the `ops` branch, run `--sync` to clear the one drift file, restart the desktop daemon,
and sweep the inbox backlog (120 cards, including 15 duplicate drift wake-me cards). Two
cards are also stuck in `working/`: a figment card unparseable for ~34 days and a codex
card halted since July. And there is this run's **ops-sync PR** to merge.

What the system will do unattended. Nothing beyond the next nightly dispatch. Most project
work (atlas remediation, prospecting P1–P8) is complete locally but **unpushed / awaiting
your review**; the kb-ops production VM keeps ticking its 5-minute schedule on its own. No
autonomous spend or merges happen without you.

## Latest handoffs
- figment — [2026-09-23-figment-live-chain.md](../handoffs/2026-09-23-figment-live-chain.md) (2026-09-23)
- prospecting — [2026-09-07-prospecting-p8-live-tested.md](../handoffs/2026-09-07-prospecting-p8-live-tested.md) (2026-09-07)
