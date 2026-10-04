# Executive Dashboard
_Generated: 2026-10-04T06:17Z by dispatcher-cloud_

## Action required
Two cards sit in `queue/approvals/` awaiting Daniel:
- `6ab76543-b01ea7d5` — **kb** — `wake:human-decision` — T1
- `65d8f246-8a461521` — **figment** — GATE A eye-gate: operator rules creator-001 expansion-03 blind board (seven axes) so curation to 40 can proceed — T3

## Queue
| state | count |
|-------|-------|
| inbox | 119 |
| working | 3 |
| approvals | 2 |
| done | 1620 |

## Last 24h
- Cadences run: 1 dispatch today (`cadence:nightly-review`, this run). No dispatch, cost, or activity rows on 2026-10-03.
- Cost: $0.00 spent today vs. $30.00 daily budget — $30.00 remaining. All steps subscription-billed (0.0).
- Notable: fleet otherwise quiet overnight; no worker cost or activity logged in the last 24h.

## Projects
- **atlas** — Omni-interface foundation + adversarial remediation complete locally on `codex/atlas-enhancements-20260820`; remediation diff exceeds 400 lines so it awaits Daniel review before commit. V1 "Hands" shipped to prod (PR #44). V2 "Trust" is Daniel's go/no-go.
- **faceless-youtube** — PARKED. No active work; last real activity was the Bricks Variant-D arc in an external clone.
- **figment** — Active: resumable `figment_train.py pipeline` drives anchor→…→video with per-stage gates. GATE A eye-gate awaiting Daniel (see Action required). Note: its `track1:replicate` working card has been stranded since 2026-09-07 (see Anomalies).
- **kb-ops** — Production VM LIVE on release `e8ac49ad`; daemon schedule tick every 5 min (outbox mode). Ops history linear.
- **prospecting** — P1–P8 built across worktrees, all branches UNPUSHED. Live-tested against the real desktop store; Gate P8-B acceptance criteria green.

## Anomalies
- **Two long-stranded `working/` cards** (ages by git history, not file mtime — the checkout was freshly cloned so mtimes are meaningless):
  - `6a6bc3dd-5494006b` (**kb-ops** `iter-smoke-t2`, owner codex-worker) — state `halted`, untouched since **2026-07-30** (~66 days). Needs disposition (clear/archive).
  - `d126c410-9bc54280` (**figment** `track1:replicate`, owner figment-expand) — state `working`, untouched since **2026-09-07** (~27 days). Stranded.
- **Recurring `sync_daemon_dirs.py` gap.** Routine `routines/nightly.md` step 2b calls `python scripts/sync_daemon_dirs.py --check`, but that script is absent from the `ops` checkout (only `scripts/sync_skills.py` exists), so the main→ops daemon-dir mirror check cannot run from cloud. This has produced a backlog of ~14 `wake-daniel-*-sync-daemon-dirs-drift` cards in `queue/inbox/` (09-10, 09-11, 09-14, 09-17, 10-01, …). A human ruling on the keep-vs-dedup fork is **owed** and still not landed in the routine. The parallel `sync_skills --check` passed (in sync).
- `preamble.py` was transiently denied by the harness auto-mode classifier on first invocation (misclassified as "Modify Shared Resources"); verified green by direct read and on retry (no STOP file, `ANTHROPIC_API_KEY` unset, $0 < $30 budget).
- Inbox backlog of 119 cards (30 of them `wake*`) is high; worth a sweep to confirm none are due-and-unclaimed and to clear resolved wake cards.
