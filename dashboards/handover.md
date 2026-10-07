# System Handover
_Generated: 2026-10-07 06:24 UTC_

**What happened.** The nightly dispatcher ran. It could not check out the `ops`
branch directly this time — the session's permission layer blocked it — so it
did the safe thing: worked on a branch cut from the latest `ops` and is routing
tonight's coordination writes to you as a pull request instead of pushing `ops`
itself. The health checks that could run passed: no STOP file, budget untouched
($0 of $30 spent today), and the skills-drift check is clean. The dispatcher
emitted and executed one `nightly-review` card, whose only lasting output is the
refreshed dashboards and this note.

**What is waiting on you.** Three things.
1. Two approval cards need a ruling: a figment GATE A "eye-gate" (T3) that gates
   curation of the creator-001 board, and a kb human-decision wake (T1).
2. A pull request titled "ops-sync 2026-10-07" will be open against `ops` with
   tonight's dashboard/ledger/queue changes — it needs your merge. Nothing merges
   itself.
3. atlas has a finished local remediation on `codex/atlas-enhancements-20260820`
   that exceeds the 400-line contract limit and so is held for your review before
   commit.

**Heads-up for maintenance.** The nightly routine calls a script that no longer
exists (`scripts/sync_daemon_dirs.py`), so one health gate silently can't run.
Two cards have been stuck in `working/` for months (one from July, one from
September), and the September one has broken YAML that no tool can parse. None of
these block the fleet, but they want a cleanup pass.

**What the system will do next unattended.** Nothing until the next scheduled
nightly tick. No cards are mid-flight that will act on their own; the production
VM continues its 5-minute schedule tick as normal. Everything else waits on your
rulings and the PR merge above.
