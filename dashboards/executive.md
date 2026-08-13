# Executive Dashboard
_Generated: 2026-08-13 06:12 UTC by dispatcher-cloud_

## Action required
- **queue/approvals/**: None (0 cards).
- Awaiting Daniel at the desk (sitting in inbox):
  - `wake:human-decision` engagement-fold (faceless-youtube) — blocks 6 `eng-fold-*` draft cards.
  - `decide:budget-gate-measures-nothing` (kb-ops) — decision owed.
  - `flip delivery-gate warn->block after clean soak` (kb-ops) — decision owed.
  - Daemon-dir drift + missing sync script (kb-ops) — a desktop `python scripts/sync_daemon_dirs.py --sync` (from the dashboard-ops worktree) is owed; see Anomalies.

## Queue
| state | count |
|-------|-------|
| inbox | 25 (15 inbox + 10 blocked) |
| working | 2 (1 active nightly-review, 1 halted) |
| done | 437 |
| approvals | 0 |
| archived | 1 |

## Last 24h
- **Cadences**: `nightly-review` dispatched today (this run, card 6a7d5f9e) and yesterday (card 6a7c0e28).
- **Cost**: $0.00 of $30.00 daily budget — every step subscription-billed. Today 15 model steps (codex gpt-5.6 sol×6 / terra×8 / luna×1); yesterday 84 steps (incl. claude-sonnet-5×4).
- **Health**: `sync_skills --check` = in sync. `sync_daemon_dirs --check` ran in refs-fallback from the `main` copy (script absent on ops) → drift unchanged since 08-12; no new card filed.

## Projects
- **atlas** — V1 "Hands" wave COMPLETE + PROD LIVE (PR #44 merged 07-21); Atlas view live on 127.0.0.1:5317 with worker passthrough verified. V2 "Trust" planning awaits Daniel's go/no-go.
- **faceless-youtube** — Active run **bricks-fresh** (branch `claude/bricks-doctrine-reset`); Phase 6B first tenth 18/25 slots verified, PAUSED at the P1-P5 human gate. Poyais published; wells-fargo parked.
- **kb-ops** — Wave A complete; governed executor proven live. Daily `self-lint-report` cadence exists but is DORMANT (no scheduler; manual launch via dashboard Workflows UI while the gate is held in a watched session).

## Anomalies
- `scripts/sync_daemon_dirs.py` is absent from `ops` (present only on `main`); the nightly check runs the `main` copy in refs-fallback mode. Tracked by card `6a605ebb`.
- main→ops daemon-dir drift: 11 files (5 main-only + 5 content-differs + 1 ops-only `acceptance-run.md`), **unchanged since 08-12**. Desktop `--sync` owed; tracked by cards `6a6c3d8e`, `6a718533`, `6a7c0ebf`.
- Halted card `6a6bc3dd` (codex-worker, `iter-smoke-t2`) lingering in queue/working/ (state=halted, terminal).
- 10 blocked cards in inbox: 6 `eng-fold-*` drafts (faceless-youtube, waiting on the engagement-fold human decision) + 4 `acceptance-p0` reports (kb-ops).
