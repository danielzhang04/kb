# Executive Dashboard
_Generated: 2026-10-05 06:27 UTC by dispatcher-cloud_

## Action required
- `65d8f246-8a461521` | figment | GATE A eye-gate — operator rules creator-001 expansion-02 blind board (seven axes) so curation to 40 can proceed | **T3**
- `6ab76543-b01ea7d5` | kb | wake:human-decision | T1
- (inbox) `6a605ebb-d86dff79` | kb-ops | wake-me: daemon-dir drift + missing sync script — desktop `--sync --prune` owed (see Anomalies)

## Queue
| state | count |
|---|---|
| inbox | 120 |
| working | 3 |
| approvals | 2 |
| done | 1621 |
| archived | 10 |

## Last 24h
- **Cadences run:** `nightly-review` — 2026-10-05 (card `6ac342db-3c8869e3`, this run) and 2026-10-04 (card `6ac1ef00-6cf806cf`).
- **Cost vs budget:** $0.00 spent today (all steps subscription-billed at 0.0); daily limit $30.00 → **$30.00 remaining**. Yesterday logged 3 cost rows (dispatch / nightly-review / dashboard-regen), all $0.00.
- **Notable:** dashboards regenerated; preamble OK; sync_skills in sync; daemon-dir drift **shrank from 11 paths (2026-08-18) to 1 (2026-10-05)** — the faceless-youtube agents/+workflows/ set reconciled on main→ops.

## Projects
- **atlas** — Omni-interface foundation + independently re-reviewed adversarial remediation complete locally on `codex/atlas-enhancements-20260820` (commit `280a67a9` + unstaged diff; Atlas 235 passed, security PASS). Diff >400 lines → awaiting Daniel review before commit/push.
- **faceless-youtube** — PARKED, no active work in flight. STATE.md stale (2026-07-19); last real activity the Bricks Variant-D arc in external clone `kb-clones/bricks-arc`.
- **figment** — `figment_train.py pipeline` drives anchor→dataset→smoke→train→tester→gen→detail→video with per-stage gates; `detail`/`video` now real gradeable stages. GATE A eye-gate card awaiting operator ruling (see Action required).
- **kb-ops** — Production VM (`kb`, `100.89.73.118`) LIVE on release `e8ac49ad`; daemon-internal schedule tick every 5 min; `cadence` execution profile live; ops history linear.
- **prospecting** — P1–P8 built across worktrees `prospecting-p{1..8}`, **all branches UNPUSHED**. P8 affinity gate 953/953 at HEAD `52067386`; live-tested against real desktop store (campaign `camp_3147b42db58c4c15`).

## Anomalies
- **Daemon-dir drift (1 path):** `orgs/kb-ops/workflows/acceptance-run.md` is ops-only — desktop `python scripts/sync_daemon_dirs.py --sync --prune` (from the dashboard-ops worktree) owed. Also `scripts/sync_daemon_dirs.py` is still absent from `ops` (nightly worked around it via the `origin/main` copy). Tracked in wake-me card `6a605ebb-d86dff79` (refreshed this run).
- **Stale working/ card:** `6a6bc3dd-5494006b` (kb-ops, iter-smoke-t2, owner codex-worker) sits in `queue/working/` in terminal state `halted`, stranded since 2026-07-30 — candidate for the stranded-archiver / human cleanup.
- **Unparseable working/ card:** `d126c410-9bc54280` (figment, `figment:track1:replicate`, owner figment-expand) fails `cards.py` parse (unquoted colon in `action:`), in `queue/working/` since ~2026-09-03.
- preamble: OK. sync_skills: in sync.
