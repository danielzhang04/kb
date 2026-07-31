# Executive Dashboard
_Generated: 2026-07-31 06:14 UTC by dispatcher-cloud_

## Action required
No cards in `queue/approvals/`. Items addressed to / owned by a human that cannot move without Daniel:
| id | project | action | risk-tier |
|----|---------|--------|-----------|
| 6a5e482a-3b8707b5 | kb-ops | decide:budget-gate-measures-nothing | T3 |
| 6a605ebb-d86dff79 | kb-ops | wake-me:daemon-dir-drift-and-missing-sync-script | T1 |
| _new this run_ | kb-ops | wake-me:daemon-dir-drift-fyt-2026-07-31 | T1 |
| 6a5c7274-635d84bf | kb-ops | flip delivery-gate warn→block after clean soak | T2 |
| wake-daniel-2026-07-22-engagement-fold | faceless-youtube | wake:human-decision | T2 |

**New tonight:** fresh daemon-dir drift from the 2026-07-31 fyt merge (9 daemon-read files out of sync between main and ops) — a fresh wake-me card filed this run; owed a desktop `--sync`. The budget-gate decision, delivery-gate flip, missing-sync-script wake, and the engagement-fold wake are all carried unchanged from prior nights. Project gates also awaiting Daniel: faceless-youtube `claude/fyt-writer-grammar-slim` scripting-doctrine branch (UNMERGED, review-gated), the maiden end-to-end run (deferred to Aug 1 weekly-cap reset), Poyais GATE 3 (thumbnail / L17 / publish), and the Atlas V2 "Trust" go/no-go.

## Queue
| state | count |
|-------|-------|
| inbox | 13 |
| working | 1 |
| halted | 1 |
| approvals | 0 |
| done | 122 |

(Counts are by card `state` field. `queue/inbox/` physically holds 17 files: 13 truly at `state:inbox` + 4 nightly cards at `state:done` stranded there — see Anomalies. `working` = tonight's in-flight `nightly-review` card; the `halted` card physically sits in `queue/working/`. `done` 122 = 118 in `queue/done/` + 4 stranded in `inbox/`.)

## Last 24h
- **Cadences:** `nightly-review` dispatched tonight (2026-07-31, card `6a6c3cb8-f0d1ec65`, self-executed by dispatcher-cloud — cloud carve-out) and yesterday (2026-07-30, card `6a6aea62-9fbf6365`).
- **Cost:** $0.00 API-billed vs **$5.00/day** cap → $5.00 remaining. All 47 logged steps over the two days (31 on 07-30, 16 on 07-31) are subscription-billed (`usd: 0.0`) — see the standing T3 card noting this gate measures nothing.
- **Health:** preamble OK; `sync_skills --check` clean; `sync_daemon_dirs --check` reports **NEW drift** (9 files, run from a main copy in refs-fallback — script still absent on ops).
- **Notable:** faceless-youtube gated multi-agent pipeline SHIPPED to `main` via PR #106 (13 stages / 6 agents / 6 gates); the daemon-read `agents/` + `orgs/*/workflows/` dirs were not mirrored to ops behind the merge → tonight's drift.

## Projects
- **atlas** — V1 "Hands" wave COMPLETE (2026-07-21): all three gates passed at the desk; PR #44 MERGED + prod rolled out, Atlas view LIVE on 127.0.0.1:5317. V2 "Trust" planning awaits Daniel's go/no-go.
- **faceless-youtube** — Gated multi-agent pipeline SHIPPED to `main` (2026-07-31, PR #106). Only open item: the full end-to-end maiden run, DEFERRED to Aug 1 (Fable-5 weekly cap ~84%). Scripting-doctrine branch `claude/fyt-writer-grammar-slim` UNMERGED, review-gated. Poyais parked at GATE 3 (thumbnail / L17 / publish). Engagement-fold staged (6 `eng-fold-*` cards) but PARKED on the queue-bridge decision. fyt-run-001 fully parked (0 verified / 119 parked).
- **kb-ops** — Wave A COMPLETE (2026-07-21): governed executor proven live. Daemon inert; daily `self-lint-report` cadence DORMANT (no scheduler; manual launches via dashboard Workflows UI in a watched session).

## Anomalies
- **Daemon-dir drift (NEW, 2026-07-31).** `sync_daemon_dirs.py --check` (main vs ops) reports 9 daemon-read files out of sync from the fyt merge: 4 main-only (`agents/fyt-audio-render.md`, `agents/fyt-publish.md`, `agents/fyt-story.md`, `agents/fyt-visuals.md`) + 5 content-differs (`agents/fyt-checker.md`, `agents/fyt-preproduction.md`, `agents/fyt-production.md`, `agents/fyt-runner.md`, `orgs/faceless-youtube/workflows/video-run.md`). A desktop `sync_daemon_dirs.py --sync` from the dashboard-ops worktree is owed. Fresh wake-me card filed this run.
- **Missing script on ops.** `scripts/sync_daemon_dirs.py` exists on `origin/main` but not on `ops`, so the routine's literal step-2b invocation fails file-not-found; ran from a main copy this run. Tracked by standing wake-me card `6a605ebb-d86dff79`.
- **Stale done-in-inbox.** Four `nightly-review` cards (`6a5dbb3e-295a9d2b`, `6a5f0cef-53d31df4`, `6a605e40-ca81f0c8`, `6a65a3cd-dabf5d57`) sit in `queue/inbox/` at `state:done`, never moved to `queue/done/`. Same four as prior nights; recurring housekeeping candidate (outside the nightly-review carve-out allow-list, so not fixed here).
- **Stranded halted card.** `queue/working/6a6bc3dd-5494006b` (kb-ops `iter-smoke-t2`) sits in `working/` in terminal state `halted` (since 2026-07-30 17:58, ~12h). Not yet >48h; sweep if it lingers.
- Preamble: PASS. No STOP file, no budget breach, no skill drift.
