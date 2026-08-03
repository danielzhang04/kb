# Executive Dashboard
_Generated: 2026-08-03 06:12 UTC by dispatcher-cloud_

## Action required
No cards in `queue/approvals/`. Items addressed to / owned by a human that cannot move without Daniel:
| id | project | action | risk-tier |
|----|---------|--------|-----------|
| 6a5e482a-3b8707b5 | kb-ops | decide:budget-gate-measures-nothing | T3 |
| 6a605ebb-d86dff79 | kb-ops | wake-me:daemon-dir-drift-and-missing-sync-script | T1 |
| 6a6c3d8e-08b1da38 | kb-ops | wake-me:daemon-dir-drift-fyt-2026-07-31 | T1 |
| 6a5c7274-635d84bf | kb-ops | flip delivery-gate warn→block after clean soak | T2 |
| wake-daniel-2026-07-22-engagement-fold | faceless-youtube | wake:human-decision | T2 |

**Unowned audit findings still needing a decision:** `6a6d8e1e-ed8c8bdf` (weekly-audit
2026-08-01) and `6a645395-d5322124` (weekly-audit 2026-07-25). The root theme persists: the
**desktop scheduler is down** — all three desktop cadences (`grades-reconcile` weekly,
`daemon-dirs-sync` daily, `self-lint-report` daily) have produced nothing since 2026-07-22. The
dark `daemon-dirs-sync` is the root cause of the daemon-dir drift that re-reports every night.
Fix is Daniel's (HEARTBEAT.md is human-edited only). Project gates also open: faceless-youtube
PR #109 HELD (live 7/7 rerun after the Aug 1 cap reset), `claude/fyt-writer-grammar-slim`
(UNMERGED, review-gated), PR #41 (READY, must merge with its dashboard companion), Poyais GATE 3,
and Atlas V2 "Trust" go/no-go.

## Queue
| state (by directory) | count |
|----------------------|-------|
| inbox | 15 |
| working | 2 |
| done | 137 |
| approvals | 0 |

(Counts are by physical directory, taken at generation. `queue/working/` holds two cards:
`6a6bc3dd-5494006b` at `state:halted` — terminal, see Anomalies — and this run's own nightly card
`6a703143-21e1b608`, which completes to `queue/done/` before this cycle ends, leaving working at
one halted card.)

## Last 24h
- **Cadences:** `nightly-review` dispatched + self-executed tonight (2026-08-03, card
  `6a703143-21e1b608`, dispatcher-cloud). Prior run 2026-08-02: `nightly-review` (`6a6ede8d-25b45492`).
- **Cost:** $0.00 API-billed today vs **$5.00/day** cap → $5.00 remaining. Yesterday logged one
  step (`nightly-dispatch-and-dashboards`) at `usd: 0.0` (subscription billing, claude-opus-4-8).
- **Health:** preamble OK; `sync_skills --check` clean (exit 0); step-2b daemon-dir gate reports
  drift **unchanged from 07-31** (same 9 files) — run from an `origin/main` copy in refs-fallback
  because `scripts/sync_daemon_dirs.py` is still absent on ops.

## Projects
- **atlas** — V1 "Hands" wave COMPLETE (2026-07-21): all three gates passed at the desk; PR #44
  MERGED + prod rolled out, Atlas view LIVE on 127.0.0.1:5317. V2 "Trust" planning awaits Daniel's
  go/no-go.
- **faceless-youtube** — Gated multi-agent pipeline SHIPPED to `main` (2026-07-31). PR #109
  OPEN/HELD at `claude/fyt-full-run` `051de9e` (mechanical fixes + boot handshake; 88/88 tests,
  tsc clean, security APPROVED) — **only next action: live 7/7 rerun after the Aug 1 9pm cap
  reset; do not merge before Daniel's gate.** Scripting-doctrine branch
  `claude/fyt-writer-grammar-slim` UNMERGED, review-gated. PR #41 (post-render tail) READY, must
  merge with its dashboard companion. Poyais parked at GATE 3 (thumbnail / L17 / publish).
- **kb-ops** — Wave A COMPLETE (2026-07-21): governed executor proven live. Daemon inert; daily
  `self-lint-report` cadence DORMANT (manual launch only via dashboard Workflows UI in a watched
  session).

## Anomalies
- **Desktop scheduler down (weekly-audit finding).** All three declared desktop cadences have
  produced nothing since 2026-07-22 (no desktop/`codex-worker` dispatch rows). Concrete harm:
  `daemon-dirs-sync` not firing means the main→ops daemon-dir drift is never auto-reconciled, so
  it re-reports every night. Tracked in audit cards `6a6d8e1e-ed8c8bdf` and `6a645395-d5322124`;
  decision is Daniel's (HEARTBEAT.md is human-edited only).
- **Daemon-dir drift (unchanged since 2026-07-31).** `sync_daemon_dirs.py --check` (origin/main vs
  origin/ops) reports the same 9 daemon-read files out of sync from the 07-31 fyt merge: 4
  main-only (`agents/fyt-audio-render.md`, `agents/fyt-publish.md`, `agents/fyt-story.md`,
  `agents/fyt-visuals.md`) + 5 content-differs (`agents/fyt-checker.md`,
  `agents/fyt-preproduction.md`, `agents/fyt-production.md`, `agents/fyt-runner.md`,
  `orgs/faceless-youtube/workflows/video-run.md`). A desktop `sync_daemon_dirs.py --sync` from the
  dashboard-ops worktree is owed. Tracked by wake card `6a6c3d8e-08b1da38`; no duplicate filed.
- **Missing script on ops.** `scripts/sync_daemon_dirs.py` exists on `origin/main` but not on
  `ops`, so the routine's literal step-2b invocation fails file-not-found; ran from an `origin/main`
  copy this run. Tracked by standing wake card `6a605ebb-d86dff79`.
- **Halted card in working/.** `6a6bc3dd-5494006b` (codex `iter-smoke-t2`, state:halted) parked in
  `queue/working/` since ~07-30 (>48h). Terminal — confirm + archive, or re-dispatch. Tracked in
  audit card `6a6d8e1e-ed8c8bdf`. NOTE: file mtimes in this cloud checkout read as fresh-clone
  time, so working-card staleness is judged by ULID/history, not mtime.
- Preamble: PASS. No STOP file, no budget breach, no skill drift. No other working card >48h.
