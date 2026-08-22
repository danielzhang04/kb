---
id: wake-daniel-2026-08-22-daemon-dirs-drift
project: kb
action: wake:human-decision
target: orgs/kb-ops/workflows/acceptance-run.md
risk-tier: T1
owner: daniel
state: inbox
---

## Work order

WAKE-ME (nightly cloud dispatcher, 2026-08-22 run): the daemon-dir drift-check gate
(routines/nightly.md step 2b) found DRIFT between main and ops. The gate reports and
never blocks dispatch, so the run continued (dispatch emitted 0 cards); this card
records the owed desktop reconcile.

Note on how the check ran: `scripts/sync_daemon_dirs.py` is still absent from the `ops`
working tree (same root cause as card wake-daniel-2026-08-15-sync-daemon-dirs-missing —
the routine checks out ops in step 1, but the script is main-authored). So the naive
step-2b invocation `python scripts/sync_daemon_dirs.py --check` still fails with EXIT 2.
This run instead executed main's copy of the script in refs-fallback mode
(`origin/main` vs `origin/ops`), which routines/nightly.md step 2b explicitly says is
the cloud VM path. That run succeeded and produced the drift report below.

## Evidence

```
$ git show origin/main:scripts/sync_daemon_dirs.py > /tmp/.../sync_daemon_dirs.py
$ python /tmp/.../sync_daemon_dirs.py --check
sync_daemon_dirs --check (refs: origin/main vs origin/ops)
  ops-only (extra on ops) [run --sync --prune to remove]:
    - orgs/kb-ops/workflows/acceptance-run.md
EXIT=1
```

sync_skills --check this run: EXIT 0 (in sync).

## Result

Drift is one ops-only file — `orgs/kb-ops/workflows/acceptance-run.md` exists on ops but
not on main. `--sync` alone will NOT remove it (sync never deletes ops-only files);
removing it requires `--sync --prune`. Before pruning, decide whether this file is
legitimately ops-only (then leave it and it will keep showing as drift), or stale and
should be removed (then prune), or belongs on main (then add it to main).

Owed fix (desktop, dashboard-ops worktree):
1. Restore/re-add `scripts/sync_daemon_dirs.py` to ops so step 2b's naive invocation
   works on the cloud without the refs-fallback workaround (or amend routines/nightly.md
   step 2b to invoke main's copy explicitly). This is the still-open ask from the
   2026-08-15 card.
2. Decide the fate of `orgs/kb-ops/workflows/acceptance-run.md`, then run
   `python scripts/sync_daemon_dirs.py --sync` (add `--prune` only if the file should be
   removed) from the dashboard-ops worktree to reconcile.

Until then the nightly health line will keep reporting this gate as drifted.
