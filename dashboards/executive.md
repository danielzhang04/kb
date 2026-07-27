# Executive Dashboard
_Generated: 2026-07-27 06:21 UTC by dispatcher-cloud_

## Action required
No cards in `queue/approvals/`. Items owned by / addressed to a human that cannot move without Daniel:
| id | project | action | risk-tier |
|----|---------|--------|-----------|
| wake-daniel-2026-07-22-engagement-fold | faceless-youtube | wake:human-decision (engagement-fold bridge) | T2 |
| 6a5e482a-3b8707b5 | kb-ops | decide:budget-gate-measures-nothing | T3 |
| 6a605ebb-d86dff79 | kb-ops | wake-me:daemon-dir-drift-and-missing-sync-script | T1 |
| 6a5c7274-635d84bf | kb-ops | flip delivery-gate warn→block after clean soak | T2 |

The engagement-fold wake asks Daniel to pick one of three paths (wire the queue bridge /
passkey+UI / claude-subagent fallback) to unpark the six staged `eng-fold-*` cards. The
budget-gate decision, delivery-gate flip, and the daemon-dir wake are all carried unchanged
from prior nights — none has moved.

## Queue
| state | count |
|-------|-------|
| inbox | 13 |
| working | 1 |
| done | 73 |
| approvals | 0 |

(`queue/inbox/` holds 17 files: 13 truly at `state:inbox` + 4 `state:done` nightly cards
physically stranded there — see Anomalies. The 13 = 4 human-owned items above + 6 `eng-fold-*`
cards owned by `dashboard-engine` awaiting the governed-worker bridge + 2 `wf-*` self-lint cards
owned by `worker-desktop` + the `weekly-audit` follow-up `6a645395`. working = tonight's
`nightly-review` card, in-flight. done 73 = 69 in `queue/done/` + 4 stranded in `inbox/`.)

## Last 24h
- **Cadences:** `nightly-review` dispatched tonight (2026-07-27, card `6a66f89c-3af8cac7`,
  executed by dispatcher-cloud this run — cloud self-executing carve-out). Yesterday
  (2026-07-26): `nightly-review` (1 dispatch row).
- **Cost:** $0.00 API-billed today vs **$5.00/day** cap → $5.00 remaining. All steps
  subscription-billed (logged 0.0).
- **Health:** preamble OK; `sync_skills --check` clean; `sync_daemon_dirs --check` clean —
  ops matches main for all daemon-read dirs (`agents/`, `orgs/*/workflows/`), run from a main
  copy in refs-fallback (script still absent on ops).
- **Notable:** no new approvals, no new drift, no stale working cards.

## Projects
- **atlas** — V1 "Hands" wave COMPLETE (2026-07-21): all three gates passed at the desk; PR #44
  MERGED + prod rolled out, Atlas view LIVE on 127.0.0.1:5317 with live worker passthrough. V2
  "Trust" planning awaits Daniel's go/no-go.
- **faceless-youtube** — PR #41 open (post-render tail + run-001 gate fixes + fyt-runner),
  reviewed READY TO MERGE, must merge with `claude/fyt-video-run-test`. Poyais parked at GATE 3
  awaiting Daniel (thumbnail, L17, publish approval). Engagement-doctrine fold staged (6
  `eng-fold-*` cards) but PARKED pending Daniel's bridge decision. fyt-run-001 (wells-fargo)
  fully parked (0 verified / 119 parked).
- **kb-ops** — Wave A COMPLETE (2026-07-21): governed executor proven live (self-lint-report
  run-7b0b8de8, all 4 checks). Daemon inert; daily `self-lint-report` cadence DORMANT (no
  scheduler; launches manual via dashboard Workflows UI in a watched session).

## Anomalies
- **Missing script on ops:** `scripts/sync_daemon_dirs.py` exists on `origin/main` but not on
  the `ops` branch, so the routine's literal step-2b invocation fails file-not-found on ops; ran
  from a main copy this run (result clean). Already filed in wake-me card `6a605ebb-d86dff79` —
  its drift half stays clean; the missing-script half remains and needs a desktop
  `sync_daemon_dirs.py --sync` (or amend step 2b). No new card filed — the existing wake-me
  still covers it.
- **Stale done-in-inbox:** four `nightly-review` cards (`6a5dbb3e-295a9d2b`, `6a5f0cef-53d31df4`,
  `6a605e40-ca81f0c8`, `6a65a3cd-dabf5d57`) sit in `queue/inbox/` at `state:done`, never moved to
  `queue/done/` (up from 3 last night — yesterday's nightly card joined them). Recurring pattern;
  candidate for a housekeeping sweep.
- No stale cards in `queue/working/` (only tonight's in-flight card). No preamble failures, no
  skill drift.
