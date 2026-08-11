# Executive Dashboard
_Generated: 2026-08-11 06:12 UTC by dispatcher-cloud_

## Action required
`queue/approvals/` is empty (0 cards). The following human-owned items are waiting in `queue/inbox/`:
- `6a5e482a-3b8707b5` — kb-ops — **decide:budget-gate-measures-nothing** (T3, owner human-operator)
- `6a718533-aa7e5382` — kb-ops — wake-me:daemon-dir-drift-grew-thin-slice-2026-08-04 (T1) — owed: desktop `sync_daemon_dirs.py --sync`
- `6a6c3d8e-08b1da38` — kb-ops — wake-me:daemon-dir-drift-fyt-2026-07-31 (T1)
- `6a605ebb-d86dff79` — kb-ops — wake-me:daemon-dir-drift-and-missing-sync-script (T1)
- `wake-daniel-2026-07-22-engagement-fold` — faceless-youtube — wake:human-decision (T2, owner daniel)

## Queue
| state | count |
|---|---|
| inbox | 18 |
| working | 2 (1 active: tonight's nightly-review; 1 halted-terminal codex card) |
| approvals | 0 |
| done | 291 |
| archived | 1 |

## Last 24h
- **Cadences:** `nightly-review` ran tonight (card `6a7abcc6-23bba869`); prior run 2026-08-10 (card `6a796f91-0539653e`).
- **Cost:** today $0.00 logged (subscription steps log 0.0); yesterday 1 cost row (nightly-review, $0.0). Budget `daily_usd_limit: 30.00` → **~$30.00 remaining**.
- **Health:** `sync_skills --check` clean (in sync). `sync_daemon_dirs --check` = DRIFT (10 files) — see Anomalies. Preamble + pyyaml OK.
- **Notable:** no new work cards dispatched beyond the nightly cadence; queue steady.

## Projects
- **atlas** — V1 "HANDS" wave COMPLETE (2026-07-21), all 3 gates passed; PR #44 merged + prod rolled out; Atlas view LIVE on 127.0.0.1:5317 with live worker passthrough. V2 "Trust" planning awaits Daniel's go/no-go.
- **faceless-youtube** — Active run **bricks-fresh** on `claude/bricks-doctrine-reset` (dd22f97); Phase 6B first tenth 18/25 slots verified, PAUSED at P1–P5 human gate. Poyais published; wells-fargo parked.
- **kb-ops** — Wave A COMPLETE (governed executor proven live, run-7b0b8de8). Daily `self-lint-report` cadence DORMANT (no scheduler; manual dashboard launches only, gate held in a watched session).

## Anomalies
- **main→ops daemon-dir drift persists, unchanged since 2026-08-04:** `sync_daemon_dirs --check` reports 10 out-of-sync daemon-read files — 5 main-only (`agents/fyt-audio-render.md`, `agents/fyt-publish.md`, `agents/fyt-story.md`, `agents/fyt-visuals.md`, `orgs/faceless-youtube/workflows/thin-slice-run.md`) + 5 content-differs (`agents/fyt-checker.md`, `agents/fyt-preproduction.md`, `agents/fyt-production.md`, `agents/fyt-runner.md`, `orgs/faceless-youtube/workflows/video-run.md`). Owed: desktop `python scripts/sync_daemon_dirs.py --sync` from the dashboard-ops worktree. Already tracked by inbox cards `6a605ebb`, `6a6c3d8e`, `6a718533`; **no new card filed tonight** because the drift set did not change. Root cause: the dark desktop `daemon-dirs-sync` cadence (audit cards `6a6d8e1e`, `6a645395`).
- **`scripts/sync_daemon_dirs.py` is absent from `ops`** (only mirrored on `main`), so routine step 2b's check was run from the `main` copy in refs-fallback mode. Tracked by card `6a605ebb`.
- 1 card in `queue/working/` is `6a6bc3dd-5494006b` (codex iter-smoke) in terminal **halted** state — resolved record-only by the boss (known `codex exec resume --cd` defect, fixed in PR #103). Not stale/actionable.
