# Executive Dashboard
_Generated: 2026-08-19 06:19 UTC by dispatcher-cloud_

## Action required
- **Approvals queue: None** (`queue/approvals/` empty — nothing awaiting a signed/possession approval).
- Standing wake-me cards still await Daniel at the desk (see Anomalies): the main→ops
  daemon-dir sync and a back-port-or-prune decision on `acceptance-run.md`.

## Queue
| state | count |
|-------|-------|
| inbox | 17 |
| blocked | 10 |
| working | 1 (this nightly-review card) |
| halted | 1 (misfiled in `queue/working/`) |
| done | 641 |
| approvals | 0 |

## Last 24h
- **Cadences:** `nightly-review` dispatched on schedule (08-19 card `6a854ae6`; 08-18 card `6a83f8dc`).
- **Cost:** ~$2.56 spent (boss-session bricks v2 image regen, gemini-3-pro-image, from raw
  `ledgers/cost/claude-boss-2026-08-19.tsv`; 13 codex rows all subscription $0). **Budget:
  ~$27.44 of $30.00/day remaining.** Note: `ledger.read_day` misses the boss TSV rows — trust
  the raw TSV last column for USD.
- **Notable:** faceless-youtube bricks v2 residual-taste regen (10/10 shots verified under v2
  doctrine); preamble + sync_skills checks green this run.

## Projects
- **atlas** — V1 "Hands" wave COMPLETE; PR #44 merged + prod rolled out (2026-07-21), Atlas
  view LIVE on 127.0.0.1:5317 with live worker passthrough. V2 "Trust" planning = Daniel's go/no-go.
- **faceless-youtube** — Active run `bricks-fresh`; overnight run left scene-tenth verification
  (17 verified / 8 parked) and a board artifact (5482e438) at Daniel's morning gate; branch
  `claude/bricks-taste-forensics`, handoff `2026-08-18-fyt-bricks-overnight-run.md`.
- **kb-ops** — Wave A complete (governed executor proven live 2026-07-21); daily
  `self-lint-report` cadence exists but is DORMANT (no scheduler; manual launches only).

## Anomalies
- **main→ops daemon-dir drift (11 files), unchanged.** 5 main-only + 5 content-differs + 1
  ops-only (`orgs/kb-ops/workflows/acceptance-run.md`). Tracked by standing cards `6a7c0ebf`,
  `6a6c3d8e`, `6a718533`; desktop `python scripts/sync_daemon_dirs.py --sync` (from dashboard-ops
  worktree) is owed, plus a back-port-or-prune decision on the ops-only file. No duplicate card
  filed this run (byte-identical drift).
- **`scripts/sync_daemon_dirs.py` absent on `ops`** (mirrored only on `main`) — step 2b's check
  had to run the `main` copy in refs-fallback. Tracked by card `6a605ebb`.
- **Halted card `6a6bc3dd` stranded in `queue/working/`** (state: halted, wrong directory) —
  queue hygiene; not touched by this T1 dashboard task.
- 10 blocked + 17 inbox cards accumulating (several are the standing wake-me/drift cards above).
