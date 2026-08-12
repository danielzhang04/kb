# Executive Dashboard
_Generated: 2026-08-12 06:12 UTC by dispatcher-cloud_

## Action required
`queue/approvals/` is empty (0 cards). The following human-owned items are waiting in `queue/inbox/`:
- `6a5e482a-3b8707b5` — kb-ops — **decide:budget-gate-measures-nothing** (T3, owner human-operator)
- `6a7c0ebf-34bc783f` — kb-ops — wake-me:daemon-dir-drift-ops-only-acceptance-run-2026-08-12 (T1) — **NEW tonight**; back-port-or-prune decision on `orgs/kb-ops/workflows/acceptance-run.md`
- `6a718533-aa7e5382` — kb-ops — wake-me:daemon-dir-drift-grew-thin-slice-2026-08-04 (T1) — owed: desktop `sync_daemon_dirs.py --sync`
- `6a6c3d8e-08b1da38` — kb-ops — wake-me:daemon-dir-drift-fyt-2026-07-31 (T1)
- `6a605ebb-d86dff79` — kb-ops — wake-me:daemon-dir-drift-and-missing-sync-script (T1)
- `wake-daniel-2026-07-22-engagement-fold` — faceless-youtube — wake:human-decision (T2, owner daniel)

## Queue
| state | count |
|---|---|
| inbox | 28 |
| working | 2 (1 active: tonight's nightly-review; 1 halted-terminal codex card) |
| approvals | 0 |
| done | 352 |
| archived | 1 |

## Last 24h
- **Cadences:** `nightly-review` ran tonight (card `6a7c0e28-6011bcbb`); prior run 2026-08-11 (card `6a7abcc6-23bba869`).
- **Cost:** today 17 cost rows, all subscription-billed at $0.00 (codex workflow-platform smoke/acceptance runs, gpt-5.6-*); yesterday 42 rows, also all $0.00. Budget `daily_usd_limit: 30.00` → **~$30.00 remaining**. No API-billed spend.
- **Health:** `sync_skills --check` clean (in sync). `sync_daemon_dirs --check` = DRIFT (11 files) — see Anomalies. Preamble + pyyaml OK.
- **Notable:** codex-side workflow-platform P0 was active — 17 acceptance-run/smoke cards executed and moved to done today; a new `acceptance-run` workflow def was registered directly on ops. No new Claude-tier work cards beyond the nightly cadence.

## Projects
- **atlas** — V1 "HANDS" wave COMPLETE (2026-07-21), all 3 gates passed; PR #44 merged + prod rolled out; Atlas view LIVE on 127.0.0.1:5317 with live worker passthrough. V2 "Trust" planning awaits Daniel's go/no-go.
- **faceless-youtube** — Active run **bricks-fresh** on `claude/bricks-doctrine-reset` (dd22f97); Phase 6B first tenth 18/25 slots verified, PAUSED at P1–P5 human gate. Poyais published; wells-fargo parked.
- **kb-ops** — Wave A COMPLETE (governed executor proven live, run-7b0b8de8). Workflow-platform P0 active on codex: `acceptance-run` def registered + re-gated on ops (2026-08-11). Daily `self-lint-report` cadence DORMANT (no scheduler; manual dashboard launches only, gate held in a watched session).

## Anomalies
- **main→ops daemon-dir drift CHANGED tonight (now 11 files):** `sync_daemon_dirs --check` reports the same 10 as 2026-08-04 — 5 main-only (`agents/fyt-audio-render.md`, `agents/fyt-publish.md`, `agents/fyt-story.md`, `agents/fyt-visuals.md`, `orgs/faceless-youtube/workflows/thin-slice-run.md`) + 5 content-differs (`agents/fyt-checker.md`, `agents/fyt-preproduction.md`, `agents/fyt-production.md`, `agents/fyt-runner.md`, `orgs/faceless-youtube/workflows/video-run.md`) — **plus a NEW `ops-only` extra `orgs/kb-ops/workflows/acceptance-run.md`** (written directly to ops 2026-08-11 by workflow-platform P0; absent from main). Fresh wake-me card `6a7c0ebf` filed tonight because the drift set changed. The 10-file drift still needs desktop `python scripts/sync_daemon_dirs.py --sync` (dashboard-ops worktree); the new ops-only file needs a human back-port-or-prune decision (do NOT auto-prune legitimate ops content). Root cause: the dark desktop `daemon-dirs-sync` cadence (audit cards `6a6d8e1e`, `6a645395`). Also tracked by `6a605ebb`, `6a6c3d8e`, `6a718533`.
- **`scripts/sync_daemon_dirs.py` is absent from `ops`** (only mirrored on `main`), so routine step 2b's check was run from the `origin/main` copy in refs-fallback mode. Tracked by card `6a605ebb`.
- 1 card in `queue/working/` is `6a6bc3dd-5494006b` (codex iter-smoke) in terminal **halted** state — a record-only smoke result left in working/ since 2026-07-30 (known `codex exec resume --cd` defect, fixed in PR #103). Not stale/actionable work.
