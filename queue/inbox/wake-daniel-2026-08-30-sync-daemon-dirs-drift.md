---
id: wake-daniel-2026-08-30-sync-daemon-dirs-drift
project: kb
action: wake:human-decision
target: scripts/sync_daemon_dirs.py
risk-tier: T1
owner: daniel
state: inbox
---

## Work order

WAKE-ME (nightly cloud dispatcher, 2026-08-30): the daemon-dir drift-check gate
(routines/nightly.md step 2b) reports drift AND its script is still absent from the
`ops` branch (root cause unchanged since card
`wake-daniel-2026-08-15-sync-daemon-dirs-missing`, still owed). The gate reports and
never blocks dispatch, so the run continued. This card records tonight's drift finding
and the still-owed desktop fix.

Two facts this run:
1. `scripts/sync_daemon_dirs.py` is present on `origin/main` but NOT on `ops` HEAD, so
   the routine's literal `python scripts/sync_daemon_dirs.py --check` on the ops checkout
   still fails with "No such file or directory" (same as 2026-08-15).
2. To actually run the gate this run, I invoked `main`'s copy of the script in its
   refs-fallback mode (its documented cloud path: compares `origin/main` vs `origin/ops`
   directly, no worktree needed). It found real drift — see Evidence.

## Evidence

```
$ python <main:scripts/sync_daemon_dirs.py> --check
sync_daemon_dirs --check (refs: origin/main vs origin/ops)
  ops-only (extra on ops) [run --sync --prune to remove]:
    - orgs/kb-ops/workflows/acceptance-run.md
EXIT=1
```

The drift is a single ops-only file — `orgs/kb-ops/workflows/acceptance-run.md` exists on
`ops` but not on `main`. `--sync` alone never deletes ops-only files; removing it requires
`--sync --prune`. Whether this file should be reconciled or is intentionally ops-only is a
human call.

## Result

Decision for Daniel (desktop, dashboard-ops worktree):
1. Restore/re-add `scripts/sync_daemon_dirs.py` to `ops` (or amend routines/nightly.md
   step 2b) so the nightly routine can run the gate without borrowing `main`'s copy —
   this half is a duplicate of card `wake-daniel-2026-08-15-sync-daemon-dirs-missing`,
   still unresolved.
2. Resolve the drift: run `python scripts/sync_daemon_dirs.py --sync` from the
   dashboard-ops worktree (add `--prune` only if `orgs/kb-ops/workflows/acceptance-run.md`
   should be removed from ops rather than kept). Until then the nightly health line keeps
   reporting this gate as drifted.
