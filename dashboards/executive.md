# Executive Dashboard
_Generated: 2026-10-01T06:19:57Z by dispatcher-cloud_

## Action required
- `65d8f246-8a461521` — **figment** — GATE A eye-gate: operator must rule creator-001
  expansion-02 blind board (seven axes) before curation to 40 can proceed — **T3**
- `6ab76543-b01ea7d5` — **kb** — `wake:human-decision` — **T1**
- Also waiting (inbox wake-me, not in approvals/): **14 open `sync-daemon-dirs` drift
  cards** (see Anomalies) and the Atlas Omni-interface review (diff > 400 lines, branch
  `codex/atlas-enhancements-20260820`).

## Queue
| state | count |
|-------|-------|
| inbox | 119 |
| working | 2 |
| approvals | 2 |
| done | 1620 |

(inbox includes tonight's in-flight `nightly-review` card `6abdfb26-99db0bc1` (state=working)
and 14 open `wake-daniel-*-sync-daemon-dirs` cards.)

## Last 24h
- **Cadences:** `nightly-review` dispatched 2026-09-30 (`6abca973`) and 2026-10-01
  (`6abdfb26`, this run). No other cadences fired.
- **Cost:** $0.00 billed (all steps subscription-billed, logged 0.0). Budget
  $30.00/day → **~$30.00 remaining**.
- **Notable:** daemon-dir drift gate ran in cloud refs-fallback mode; filed the 14th
  open drift wake-me card. `preamble.py` OK; `sync_skills --check` clean. Dashboards
  regenerated.

## Projects
- **atlas** — V1 "Hands" merged & live (PR #44, prod on 127.0.0.1:5317). Omni-interface
  foundation + adversarially-reviewed remediation sit on `codex/atlas-enhancements-20260820`
  awaiting Daniel review (diff > 400 lines); V2 "Trust" is Daniel's go/no-go.
- **faceless-youtube** — PARKED, no active work. STATE.md stale (2026-07-19); last real
  activity was the Bricks Variant-D arc in external clone `kb-clones/bricks-arc`.
- **figment** — one resumable `pipeline` command drives anchor→dataset→smoke→train→tester
  →gen→detail→video with per-stage gates; `detail`/`video` now real gradeable stages; single
  gate writer + prompt composer. GATE A eye-gate ruling pending (approvals).
- **kb-ops** — prod VM LIVE on release `e8ac49ad` (PR #203 merged 09-21, PR #204 merged
  09-23); daemon-internal 5-min schedule tick live; ops branch linear.
- **prospecting** — P1–P8 built across `kb-worktrees/prospecting-p{1..8}`, all branches
  UNPUSHED. P8 affinity gate 953/953; live-tested against real desktop store (campaign
  `camp_3147b42db58c4c15`), all Gate P8-B criteria green.

## Anomalies
- **sync_daemon_dirs drift (recurring).** `scripts/sync_daemon_dirs.py` is on `origin/main`
  but absent from `origin/ops`, so the literal step-2b check fails (EXIT 2); refs-fallback
  reports one ops-only file `orgs/kb-ops/workflows/acceptance-run.md`. **14 open** wake-me
  cards now track this; a desktop `--sync` from the dashboard-ops worktree is owed.
- **Stale working card.** `queue/working/d126c410-9bc54280.md` (figment track1 replicate)
  last touched 2026-09-07 — ~24 days in `working/`, far past the 48h window.
- **Terminal card parked in working/.** `queue/working/6a6bc3dd-5494006b.md` is state
  `halted` (codex iter-smoke) — housekeeping move to done/ owed.
- **Stale STATE.md.** `orgs/faceless-youtube/STATE.md` dated 2026-07-19; distilled note in
  "## Now" is current but the body is not.
- Preamble: OK. sync_skills: clean.
