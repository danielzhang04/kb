# Executive Dashboard
_Generated: 2026-09-05 06:09 UTC by dispatcher-cloud_

## Action required
- **figment / `65d8f246-8a461521` (T3)** — GATE A eye-gate: operator must rule creator-001
  expansion-02 blind board (seven axes) before curation to 40 can proceed. Human decision, parked
  in `queue/approvals/`.

## Queue
| state | count |
|---|---|
| inbox | 38 |
| working | 4 |
| approvals | 1 |
| done | 1541 |
| archived | 10 |

## Last 24h
- **Cadences dispatched:** `nightly-review` + `weekly-audit` today (2026-09-05, this run);
  `nightly-review` on 2026-09-04. All via the single cloud dispatcher.
- **Spend:** 2026-09-04 = **$6.32** of the **$30.00** daily ceiling (21%), entirely
  `runpod:l40s` pod-create charges (14 GPU pods for the figment replication run). 2026-09-05 =
  **$0.00** so far. All Claude/codex model steps ran on subscription billing ($0).
- **Notable:** ~34 codex subscription runs logged 2026-09-04 (gpt-5.6-terra/sol, all exit 0);
  figment track1 replication pods spun up and charged.

## Projects
- **atlas** — Omni-interface foundation complete locally (`codex/atlas-enhancements-20260820`
  @ `280a67a9`); an independently re-reviewed adversarial remediation diff (>400 lines) is
  **awaiting Daniel's review** before commit. Handoff `2026-08-20-atlas-omni-remediation-review`.
- **faceless-youtube** — bricks-fresh run; Variant D trial extended to L01–L25, **25/25 verified**
  ($4.96 cumulative) on `claude/bricks-variant-vd`. **Awaiting Daniel gate**: keep D / keep D with
  edits / iterate / revert. Handoff `2026-08-21-fyt-bricks-variant-d-L25`.
- **kb-ops** — Wave A complete (governed executor proven). `self-lint-report` cadence exists but is
  **dormant** (no scheduler; manual launch only while the gate is held in a watched session).
- **prospecting** — P1 human gate **PASSED 2026-09-04**; P2 list-builder live Snov run in progress
  (15 people / 7 emails / 20 credits, Daniel judging); P3–P7 pending, branches unpushed on desktop
  worktrees. Handoff `2026-09-04-prospecting-p1-p6-built-p7ui-planned`.
- **figment** — active work cards (track1 replication `d126c410` running; GATE A eye-gate above)
  but **no `orgs/figment/STATE.md`** exists — project runs without a coordination STATE view.

## Anomalies
- **Daemon-dir drift gate degraded.** `scripts/sync_daemon_dirs.py` is on `origin/main` but still
  **absent from `ops`**, so the routine's literal step-2b check cannot run from the ops checkout
  (owed since wake card `2026-08-15`). Running main's copy in refs-fallback mode reports **drift**:
  one ops-only file `orgs/kb-ops/workflows/acceptance-run.md` (identical to still-open wake card
  `2026-08-30`). Desktop `sync_daemon_dirs.py --sync` owed. Gate reports only; dispatch continued.
- **Stale/parked working cards.** `6a6bc3dd-5494006b` (kb-ops iter-smoke-t2) sits in `working/` with
  state `halted`; `d126c410-9bc54280` (figment track1 replicate, T2) is long-running `working`.
  Age not confirmable by mtime (fresh checkout reset timestamps).
- **Activity ledger empty** for 2026-09-04 and 2026-09-05 (0 rows) while dispatch/cost ledgers show
  work — activity logging may not be wired for these run paths.
- Preamble: **PASS**. sync_skills: **in sync**.
