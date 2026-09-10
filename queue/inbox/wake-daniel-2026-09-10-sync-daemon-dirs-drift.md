---
id: wake-daniel-2026-09-10-sync-daemon-dirs-drift
project: kb
action: wake:human-decision
target: scripts/sync_daemon_dirs.py
risk-tier: T1
owner: daniel
state: inbox
---

## Work order

WAKE-ME (nightly cloud dispatcher, 2026-09-10): the daemon-dir drift-check gate
(routines/nightly.md step 2b) reports drift AND its script is still absent from the
`ops` branch. Same root cause as the still-open cards
`wake-daniel-2026-08-15-sync-daemon-dirs-missing` and
`wake-daniel-2026-08-30-sync-daemon-dirs-drift` — the desktop fix is still owed. The
gate reports and never blocks dispatch, so the run continued. This card records
tonight's drift finding.

Two facts this run (unchanged from 2026-08-30):
1. `scripts/sync_daemon_dirs.py` is present on `origin/main` but NOT on `ops` HEAD, so
   the routine's literal `python scripts/sync_daemon_dirs.py --check` on the ops checkout
   still fails with "No such file or directory".
2. To run the gate this run, I invoked `main`'s copy of the script in its documented
   cloud refs-fallback mode (compares `origin/main` vs `origin/ops` directly). It found
   the same single-file drift as 2026-08-30 — see Evidence.

## Evidence

```
$ python <origin/main:scripts/sync_daemon_dirs.py> --check
sync_daemon_dirs --check (refs: origin/main vs origin/ops)
  ops-only (extra on ops) [run --sync --prune to remove]:
    - orgs/kb-ops/workflows/acceptance-run.md
EXIT=1
```

The drift is a single ops-only file — `orgs/kb-ops/workflows/acceptance-run.md` exists on
`ops` but not on `main`. `--sync` alone never deletes ops-only files; removing it requires
`--sync --prune`. Whether this file should be reconciled onto `main` or is intentionally
ops-only is a human decision, unchanged since 2026-08-30.

## Result

Because the checker script is absent from `ops`, the main→ops mirror for the daemon-read
dirs was verified only via `main`'s copy in refs-fallback mode this run, not by the
literal routine command. This drift finding is duplicated with the open 2026-08-30 card;
both remain owed.

Owed fix (desktop, dashboard-ops worktree):
1. Restore/re-add `scripts/sync_daemon_dirs.py` to the `ops` branch (the `--check` and
   `--sync` entry points routines/nightly.md step 2b depends on), so the literal gate
   command runs on the ops checkout without the refs-fallback workaround.
2. Decide on the `orgs/kb-ops/workflows/acceptance-run.md` drift: either reconcile it onto
   `main`, or `--sync --prune` from the dashboard-ops worktree to remove it from `ops` if
   it is not intended to be daemon-read.
