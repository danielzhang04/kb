# System Handover
_Generated: 2026-10-10 06:24 UTC_

Overnight the cloud nightly dispatcher ran cleanly: the preamble passed, the skills
mirror is in sync, and both dashboards were regenerated. Today is Saturday, so the
weekly system audit also ran. No money was spent (the whole $30 daily budget is free).

The weekly audit's verdict: the two cloud cadences are healthy — `nightly-review` fired
every day this week and `weekly-audit` fired today on schedule. The two **desktop**
cadences are dormant — `daemon-dirs-sync` and `grades-reconcile` have not run at all,
which is why the main→ops mirror drift is never auto-fixed and the grading ledgers have
been frozen since July. This is a known, already-escalated problem; the audit filed no
new duplicate cards for it.

What is waiting on you. Two cards sit in `queue/approvals/` for a ruling: the figment
**GATE A eye-gate** (T3) and the kb **wake:human-decision** (T1) about the degrading
desktop tier. The desktop fixes can only be done at your desk: re-add
`scripts/sync_daemon_dirs.py` to the `ops` branch, run `--sync` to clear the one drift
file, restart the desktop daemon so its cadences fire again, and sweep the inbox backlog
(120 cards, including 15 duplicate drift wake-me cards). Two cards are also stuck in
`working/`: a figment card unparseable for ~33 days and a codex card halted since July.

What the system will do unattended. Nothing beyond the next nightly dispatch. Most
project work (atlas remediation, prospecting P1–P8) is complete locally but **unpushed /
awaiting your review**; the kb-ops production VM keeps ticking its 5-minute schedule on
its own. No autonomous spend or merges happen without you.

## Latest handoffs
- figment — [2026-09-23-figment-live-chain.md](../handoffs/2026-09-23-figment-live-chain.md) (2026-09-23)
- prospecting — [2026-09-07-prospecting-p8-live-tested.md](../handoffs/2026-09-07-prospecting-p8-live-tested.md) (2026-09-07)
