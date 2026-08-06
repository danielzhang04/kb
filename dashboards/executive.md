# Executive Dashboard
_Generated: 2026-08-06 06:15 UTC by dispatcher-cloud_

## Action required
No cards in `queue/approvals/` (0). Items owned by / addressed to a human that cannot move
without Daniel (currently parked in `queue/inbox/`):
| id | project | action | risk-tier |
|----|---------|--------|-----------|
| 6a5e482a-3b8707b5 | kb-ops | decide:budget-gate-measures-nothing | T3 |
| 6a5c7274-635d84bf | kb-ops | flip delivery-gate warn→block after clean soak | T2 |
| 6a605ebb-d86dff79 | kb-ops | wake-me:daemon-dir-drift-and-missing-sync-script | T1 |
| 6a6c3d8e-08b1da38 | kb-ops | wake-me:daemon-dir-drift-fyt-2026-07-31 | T1 |
| 6a718533-aa7e5382 | kb-ops | wake-me:daemon-dir-drift-grew-thin-slice-2026-08-04 | T1 |
| wake-daniel-2026-07-22-engagement-fold | faceless-youtube | wake:human-decision | T2 |

**Unowned audit findings still needing a decision:** `6a6d8e1e-ed8c8bdf` (weekly-audit
2026-08-01) and `6a645395-d5322124` (weekly-audit 2026-07-25). Root theme persists: the
**desktop scheduler is down** — the desktop cadences (`grades-reconcile`, `daemon-dirs-sync`,
`self-lint-report`) have produced nothing since 2026-07-22, and it is the root cause of the
daemon-dir drift that re-reports every night. Two engine/worker-owned card sets are parked only
because their runners are dark: six `eng-fold-*` drafts (owner `dashboard-engine`) and two
`report:self-lint` cards (`wf-0f499ff9…`, `wf-d46c12d5…`, owner `worker-desktop`). Fix is
Daniel's (HEARTBEAT.md is human-edited only). Project gates also open: faceless-youtube PR #109
HELD (live 7/7 rerun after the Aug 1 cap reset), `claude/fyt-writer-grammar-slim` (UNMERGED,
review-gated), PR #41 (READY, must merge with its dashboard companion), and Atlas V2 "Trust"
go/no-go.

## Queue
| state (by directory) | count |
|----------------------|-------|
| inbox | 17 |
| working | 1 |
| approvals | 0 |
| done | 259 |

(This run's nightly card `6a74262f-b725d54c` sits in `queue/inbox/` at `state:working` — the
17th inbox file — and completes to `queue/done/` before this cycle ends. `queue/working/` holds
one card, `6a6bc3dd-5494006b` at `state:halted` — terminal, see Anomalies.)

## Last 24h
- **Cadences:** `nightly-review` dispatched + self-executed tonight (2026-08-06, card
  `6a74262f-b725d54c`, dispatcher-cloud). Prior run's card `6a72d607-c1b57318` (2026-08-05)
  completed to `queue/done/`. Two `codex-dispatch` cards (`6a74076b-f46c82fa`,
  `6a742062-146aef86`, kb-ops) also completed, subscription-billed.
- **Cost:** $0.00 API-billed today (both codex steps `gpt-5.6-sol` / `gpt-5.6-terra` logged
  `usd: 0.0`) vs the **$30.00/day** limit → **$30.00 remaining today**. The trailing 24h window
  also captures 2026-08-05's real spend of **$3.94** (five `gemini-3-pro-image` image-gen steps,
  `bricks-fresh` remint/sweep work) — well under budget.
- **Notable results:** preamble passed; `sync_skills --check` clean (no skill drift). The
  main→ops daemon-dir check still reports 10 out-of-sync daemon-read files — **unchanged** from
  the 2026-08-04 report (card `6a718533`), so no new wake-me card was filed this run (the
  standing cards already record the current, complete state).

## Projects
- **atlas** — V1 "HANDS" wave COMPLETE (2026-07-21): all three gates passed, PR #44 merged +
  prod rolled out; Atlas view live on 127.0.0.1:5317 with live worker passthrough. V2 "Trust"
  awaits Daniel's go/no-go.
- **faceless-youtube** — Gated multi-agent pipeline SHIPPED to `main` (2026-07-31). PR #109
  OPEN/HELD at `claude/fyt-full-run`; only remaining action is the live 7/7 rerun after the
  Aug 1 cap reset — do not merge before Daniel's gate. Scripting-doctrine branch
  `claude/fyt-writer-grammar-slim` UNMERGED (review-gated); PR #41 READY (merge with its
  dashboard companion).
- **kb-ops** — Wave A COMPLETE (2026-07-21): governed executor proven live. Daemon returned to
  inert; the daily `self-lint-report` cadence stays DORMANT (no scheduler enabled — launches are
  manual from a watched desk session).

## Anomalies
- **Daemon-dir drift persists (unchanged).** `sync_daemon_dirs.py --check` reports 10 daemon-read
  files out of sync main→ops: 5 main-only (`agents/fyt-audio-render.md`, `agents/fyt-publish.md`,
  `agents/fyt-story.md`, `agents/fyt-visuals.md`, `orgs/faceless-youtube/workflows/thin-slice-run.md`)
  and 5 content-differs (`agents/fyt-checker.md`, `agents/fyt-preproduction.md`,
  `agents/fyt-production.md`, `agents/fyt-runner.md`, `orgs/faceless-youtube/workflows/video-run.md`).
  Identical set to the 2026-08-04 report — no new card this run. Owed: a desktop
  `python scripts/sync_daemon_dirs.py --sync` from the dashboard-ops worktree. Root cause: the dark
  desktop `daemon-dirs-sync` cadence.
- **`sync_daemon_dirs.py` absent on `ops`.** The script lives on `origin/main` but not `ops`, so
  the nightly routine's literal step-2b command file-not-founds; this run extracted the `main` copy
  and ran it in refs-fallback mode (as designed). Standing card `6a605ebb`.
- **Stale working card.** `6a6bc3dd-5494006b` (kb-ops `iter-smoke-t2`, codex-worker) has sat in
  `queue/working/` at `state:halted` for 7 days (since 2026-07-30). Its `## Result` shows it was
  already resolved by the boss (known `codex exec resume --cd` defect, fixed in PR #103); terminal
  — wants a one-time desk sweep to `queue/done/`.
- **No preamble failures; no skill drift; no budget breach.**
