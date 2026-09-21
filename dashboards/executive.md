# Executive Dashboard
_Generated: 2026-09-21T06:17Z by dispatcher-cloud_

## Action required
- **queue/approvals — figment `65d8f246-8a461521` (T3):** GATE A eye-gate — operator
  rulings for creator-001 expansion-02 blind board (seven axes) before curation to 40 can
  proceed. Open since 2026-09-03 (~18 days). T3 → dashboard/WebAuthn-signed channel only.
- **12 open wake-me cards in queue/inbox (owner: daniel):** the daemon-dir drift/missing
  gate — `wake-daniel-2026-08-15-sync-daemon-dirs-missing` plus eleven
  `…-sync-daemon-dirs-drift` cards (2026-08-30 → 2026-09-21). Desktop fix still owed (see
  Anomalies).

## Queue
| state | count |
|-------|-------|
| inbox | 111 |
| working | 3 |
| approvals | 1 |
| archived | 10 |
| done | 1603 |

## Last 24h
- **Cadence:** `nightly-review` dispatched and self-executed by dispatcher-cloud (card
  `6ab0cbac-04057314`, kb) — same as the 2026-09-20 run (`6aaf77cb-4191993d`).
- **Cost:** $0.00 spent today (subscription billing; steps log $0.0). Budget
  $30.00/day → ~$30.00 remaining.
- **Health:** preamble OK · `sync_skills --check` in sync (exit 0) · daemon-dir
  drift-check gate could NOT run its literal command (script absent from `ops`); ran via
  `main`'s copy in refs-fallback mode → same single-file drift as priors (exit 1).
- **Notable:** no worker cards emitted for cloud tier beyond the cadence card; nothing
  new merged.

## Projects
- **atlas** — Adversarial remediation READY FOR DANIEL REVIEW on
  `codex/atlas-enhancements-20260820` (foundation `280a67a9` + unstaged, re-reviewed
  remediation diff; Atlas 235 passed, security re-review PASS). Diff >400 lines → contract
  requires Daniel review before commit. Handoff `2026-08-20-atlas-omni-remediation-review.md`.
- **faceless-youtube** — PARKED, no active work. STATE.md stale (2026-07-19); real last
  activity was the Bricks Variant-D arc in external clone `kb-clones/bricks-arc`.
- **figment** — Resumable `pipeline` command drives anchor→…→video with per-stage gates.
  GATE A (creator-001 expansion) awaiting operator ruling; Track 1 replication card
  `d126c410` sits idle in working/ (see Anomalies).
- **kb-ops** — Production VM `kb` LIVE on release `8f71173e` (PR #202 merged 2026-09-17).
  v1 launch/acceptance arc closed; outbox drained to `origin/ops` (linear). Nine
  agent-owner cadences remain disarmed (rehearsal p8 snapshot).
- **prospecting** — P1–P8 built across worktrees, all branches UNPUSHED. P8 affinity gate
  953/953 at HEAD `52067386`; live-tested against real desktop store (campaign
  `camp_3147b42db58c4c15`), Gate P8-B criteria green.

## Anomalies
- **Daemon-dir sync gate broken + drifted (recurring, 12 open cards).**
  `scripts/sync_daemon_dirs.py` is present on `origin/main` but absent from `origin/ops`,
  so routines/nightly.md step 2b's literal `--check` fails (EXIT 2). Refs-fallback via
  main's copy finds one ops-only file `orgs/kb-ops/workflows/acceptance-run.md` (EXIT 1).
  Owed desktop fix: restore the script to `ops`, decide reconcile-vs-prune on the drift
  file, and amend step 2b to stop re-filing duplicate cards.
- **Stale working/ cards:**
  - `d126c410-9bc54280` (figment `figment:track1:replicate`, owner figment-expand, state
    working) — no commit since 2026-09-07 (~14 days).
  - `6a6bc3dd-5494006b` (`iter-smoke-t2`, owner codex-worker, state **halted**) — parked
    in working/ since 2026-07-30; terminal state, sweep candidate.
- **Preamble:** no failures this run.
