---
id: wake-daniel-2026-08-15-sync-daemon-dirs-missing
project: kb
action: wake:human-decision
target: scripts/sync_daemon_dirs.py
risk-tier: T1
owner: daniel
state: inbox
---

## Work order

WAKE-ME (nightly cloud dispatcher, 2026-08-15 ~06:11 UTC): the routine's daemon-dir
drift-check gate (routines/nightly.md step 2b) could not run — its script is missing
from the repo. The gate reports and never blocks dispatch, so the run continued; this
card records the owed desktop fix.

## Evidence

```
$ python scripts/sync_daemon_dirs.py --check
python: can't open file '/home/user/kb/scripts/sync_daemon_dirs.py': [Errno 2] No such file or directory
EXIT=2
```

`scripts/` on `ops` HEAD contains: approvals.py, assert_runtime.py, cards.py, dispatch.py,
grade.py, ledger.py, new_project.py, notify.py, preamble.py, promotion.py, reconcile.py,
routing.py, scan_skill.py, stage_approval.py, stamp_session.py, sync_skills.py,
telegram_poll.py, telegram_send.py, webauthn_verify.py, queue_bridge_select.py,
pty_host_assertion_verify.py, and several .ps1/.cmd/.md helpers. No `sync_daemon_dirs.py`.

## Result

Because the script is absent, the main→ops mirror for the daemon-read dirs (`agents/`
and `orgs/*/workflows/`) was NOT verified this run. This is distinct from a drift
finding — there is no drift report, the checker itself is gone.

Owed fix (desktop, dashboard-ops worktree): restore/re-add `scripts/sync_daemon_dirs.py`
(the `--check` and `--sync` entry points routines/nightly.md step 2b depends on), then
run `python scripts/sync_daemon_dirs.py --sync` from the dashboard-ops worktree to
reconcile any accumulated drift. Until then the nightly run's health line will keep
reporting this gate as unrun. Decision for Daniel: restore the script, or amend
routines/nightly.md step 2b if this check has been intentionally retired.
