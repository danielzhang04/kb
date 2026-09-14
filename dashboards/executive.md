# Executive Dashboard
_Generated: 2026-09-14 06:18 UTC by dispatcher-cloud_

## Action required
- **65d8f246-8a461521** — figment — GATE A eye-gate: operator rules creator-001 expansion-03
  blind board (seven axes) so curation to 40 can proceed — **T3** (in `queue/approvals/`).
  (Work order note: subject is now batch expansion-03; expansion-02 is quarantined evidence.)
- **7 wake-me cards** open in `queue/inbox/` awaiting Daniel. Six track the same recurring
  daemon-dir issue (`sync_daemon_dirs.py`): dated 08-15, 08-30, 09-10, 09-11, 09-13, and
  09-14 (filed this run). The seventh (07-22) is the unrelated engagement-fold card. Owed fix
  is restoring `sync_daemon_dirs.py` to `ops` plus deciding the single ops-only file drift.

## Queue
| state     | count |
|-----------|-------|
| inbox     | 57    |
| working   | 2     |
| approvals | 1     |
| done      | 1581  |
| archived  | 10    |
| paused    | 0     |

(inbox 57 = 6 daemon-dir wake-me + 1 engagement-fold wake-me + 28 `wf-` workflow cards +
6 `eng-fold-` cards + 1 cadence card this run + 15 other. By frontmatter state the inbox dir
holds 34 `inbox`, 21 `blocked`, 1 `working`, 1 `done`.)

## Last 24h
- **Cadences run:** `nightly-review` this run (card `6aa79134-afb1f906`, project kb) and
  yesterday (card `6aa63d74-cbbcd1db`, 2026-09-13). Yesterday's ledgers now hold dispatch +
  cost rows, so the nightly is firing on schedule — the 09-12 gap flagged in the prior
  dashboard appears to have been a one-off, not an ongoing outage.
- **Cost:** $0.00 spent today, $0.00 yesterday → **$0.00 of $30.00** daily budget. Subscription
  steps log $0.00; no API-billed steps recorded.
- **Notable:** `sync_skills --check` clean; preamble OK. Daemon-dir gate unchanged from the
  last several nights: `sync_daemon_dirs.py` is absent from `ops` so the literal check exits 2,
  and running `main`'s copy in refs-fallback reports the same single ops-only file drift
  (`orgs/kb-ops/workflows/acceptance-run.md`). Gate reports and never blocks; dispatcher
  emitted 1 cadence card this run.

## Projects
- **atlas** — Omni-interface adversarial remediation READY FOR DANIEL REVIEW on
  `codex/atlas-enhancements-20260820` (unstaged diff > 400 lines, so contract requires review
  before commit); foundation `280a67a9` complete locally. Unchanged since 2026-08-20.
- **faceless-youtube** — PARKED, no active work; STATE.md stale (last real activity was the
  Bricks Variant-D arc, tracked in an out-of-checkout clone `kb-clones/bricks-arc`).
- **figment** — Overnight slim gated pipeline + creator-002 acceptance delivered (964 tests,
  HEAD abc91610, pushed). Train-first LoRA trained ($2.57) but tester rendered the BASE model
  (missing trigger word) — fixed, NOT yet re-tested. DNS outage orphaned a pod ~08:37–23:16;
  worst-case ~$16, unverified vs RunPod billing.
- **kb-ops** — VM dashboard `kb-dashboard.service` STOPPED (failed, 6 restarts) since
  2026-09-06 — every boot dies at hydrate on release 39197cf5. Fix is PR **#173**
  (`claude/provenance-fix`, reviewed mergeable) — confirmed OPEN/unmerged; recovery not run.
- **prospecting** — P1–P8 built across worktrees, all branches **UNPUSHED**. P8 affinity gate
  953/953 at HEAD 52067386; live-tested against the real desktop store (campaign
  camp_3147b42db58c4c15), all Gate P8-B criteria green.

## Anomalies
- **Daemon-dir drift (persistent):** `scripts/sync_daemon_dirs.py` is present on `origin/main`
  but absent from `origin/ops`, so the routine's literal `--check` on the ops checkout exits 2.
  Running `main`'s copy in the documented refs-fallback mode reports a single ops-only file,
  `orgs/kb-ops/workflows/acceptance-run.md` (exit 1) — the same drift as 08-30/09-10/09-11/09-13.
  Root cause is stable, not flapping; the desktop fix (restore the script to `ops`, then decide
  reconcile-to-main vs `--sync --prune`) is owed. 6 wake-me cards now stacked; nightly keeps
  re-filing because the routine has no dedup clause.
- **Stale working card (real age):** `d126c410-9bc54280` (figment:track1:replicate,
  figment-expand) — last committed 2026-09-07 (> 48h) and still in `queue/working/`.
- **Halted card parked in working/:** `6a6bc3dd-5494006b` (kb-ops iter-smoke-t2, codex-worker)
  — frontmatter `state: halted` but the file sits in `queue/working/`; terminal state stranded
  in the active queue.
- **kb-dashboard service down** since 2026-09-06 (see kb-ops above) — fix PR #173 unmerged.
- **Note:** file mtimes in this cloud checkout reflect the fresh clone (all ~06:15 UTC), not
  card age; working-card staleness above is measured from git commit dates, not mtime.
