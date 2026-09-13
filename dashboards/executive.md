# Executive Dashboard
_Generated: 2026-09-13 06:08 UTC by dispatcher-cloud_

## Action required
- **65d8f246-8a461521** — figment — GATE A eye-gate: operator rules creator-001 expansion-02
  blind board (seven axes) so curation to 40 can proceed — **T3** (in `queue/approvals/`).
- **6 wake-me cards** open in `queue/inbox/` awaiting Daniel. Five track the same recurring
  daemon-dir issue (`sync_daemon_dirs.py` absent from `ops` + a single ops-only file
  `orgs/kb-ops/workflows/acceptance-run.md`): dated 08-15, 08-30, 09-10, 09-11, 09-13. Owed
  fix is a desktop `sync_daemon_dirs.py --sync[ --prune]` from the dashboard-ops worktree.

## Queue
| state     | count |
|-----------|-------|
| inbox     | 55    |
| working   | 3     |
| approvals | 1     |
| done      | 1580  |
| archived  | 10    |

(inbox 55 = 6 wake-me + 28 `wf-` workflow cards + 21 other.)

## Last 24h
- **Cadences run:** `nightly-review` (this run, card 6aa63d74-cbbcd1db, project kb).
  Yesterday's ledgers (2026-09-12) hold **zero** dispatch/cost/activity rows — the nightly
  cadence appears not to have run 09-12.
- **Cost:** $0.00 spent today, $0.00 yesterday → **$0.00 of $30.00** daily budget. Subscription
  steps log $0.00; no API-billed steps recorded.
- **Notable:** daemon-dir drift gate reported drift (refs-fallback mode) and continued;
  `sync_skills --check` clean; preamble OK. Dispatcher emitted 1 cadence card this run.

## Projects
- **atlas** — Omni-interface adversarial remediation READY FOR DANIEL REVIEW on
  `codex/atlas-enhancements-20260820` (unstaged diff > 400 lines, so contract requires review
  before commit); foundation `280a67a9` complete locally; V1 "Hands" merged + live (PR #44).
- **faceless-youtube** — PARKED, no active work; STATE.md stale (last real activity was the
  Bricks Variant-D arc, tracked in an out-of-checkout clone).
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
- **Stale working card (real age):** `d126c410-9bc54280` (figment:track1:replicate,
  figment-expand) — last committed 2026-09-07 (~6 days, > 48h) and still in `working/`.
- **Halted card parked in working/:** `6a6bc3dd-5494006b` (kb-ops iter-smoke-t2, codex-worker)
  — frontmatter `state: halted` but file sits in `queue/working/`; last committed 2026-07-30
  (~45 days). Terminal state stranded in the active queue.
- **Daemon-dir drift:** `orgs/kb-ops/workflows/acceptance-run.md` is ops-only (not on main),
  and `scripts/sync_daemon_dirs.py` is absent from `ops` HEAD (present on main); the routine's
  literal check falls back to refs mode. Tracked by 5 open wake-me cards.
- **kb-dashboard service down** since 2026-09-06 (see kb-ops above) — fix PR #173 unmerged.
- **Note:** file mtimes in this cloud checkout reflect the fresh clone (all ~06:05 UTC), not
  card age; working-card staleness above is measured from git commit dates, not mtime.
