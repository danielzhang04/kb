# Executive Dashboard
_Generated: 2026-10-15T06:19:56Z by dispatcher-cloud_

## Action required
- `65d8f246-8a461521` — **figment** — GATE A eye-gate: operator rules creator-001 expansion-02 blind board (seven axes) so curation to 40 can proceed — **T3**
- `6ab76543-b01ea7d5` — **kb** — wake:human-decision (bundles the sync-daemon-dirs desktop fix + step-2b amendment + duplicate-card sweep) — **T1**

Plus **15 older `wake-daniel-*-sync-daemon-dirs-*` cards (08-15 missing + 14 drift, newest 10-04) in `queue/inbox/`** awaiting a human consolidation sweep — all the same recurring drift, captured in approval `6ab76543` (see Anomalies).

## Queue
| state | count |
|-------|-------|
| inbox | 120 |
| working | 3 |
| approvals | 2 |
| done | 1678 |

## Last 24h
- **Cadences:** `nightly-review` ran 2026-10-14 and 2026-10-15 (dispatcher-cloud; this run dispatched + self-executed card `6ad06fbb-5c83ba4e`). codex-direct processed 38 cards on 10-14 and 6 on 10-15.
- **Cost:** $0.00 billed — every step is `subscription` billing ($0.0; codex `gpt-5.6-sol`). Budget `governance/budget.yaml` = $30.00/day → **$30.00 remaining**.
- **Notable:** codex-direct 10-14 saw one `exit 124` (timeout, card `6acfbf0a`) and one `exit 1` (card `6acfc07e`); all 10-15 codex steps exited 0. No new project work landed on `ops` since the prior nightly run.
- **Health:** `preamble.py` OK; `sync_skills.py --check` clean (in sync); `sync_daemon_dirs --check` runs only via cloud refs-fallback (script absent on `ops`) and reports the same single-file drift as all priors.

## Projects
- **atlas** — Omni-interface foundation + independently re-reviewed adversarial remediation complete locally on `codex/atlas-enhancements-20260820` (commit `280a67a9` + unstaged diff); diff >400 lines, so the contract requires Daniel review before commit.
- **faceless-youtube** — PARKED, no active work in flight. STATE.md stale (2026-07-19); real last activity was the Bricks Variant-D arc on `claude/bricks-variant-vd` (tracked outside the main checkout).
- **figment** — One resumable `figment_train.py pipeline` command drives `anchor → dataset → smoke → train → tester → gen → detail → video` with gate halts and on-disk receipts; `detail`/`video` are now real gradeable stages.
- **kb-ops** — Production VM (`kb`, 100.89.73.118) LIVE on release `e8ac49ad` (PR #203 merged 2026-09-21, PR #204 merged 2026-09-23, deployed 2026-09-23); daemon-internal 5-min schedule tick + `cadence` execution profile in prod.
- **prospecting** — P1–P8 built across `kb-worktrees/prospecting-p{1..8}`, **all branches UNPUSHED**; P8 affinity gate 953/953 at HEAD `52067386`, live-tested against the real desktop store (campaign `camp_3147b42db58c4c15`, batch 1 all Gate P8-B criteria green).

## Anomalies
- **Recurring daemon-dir drift (dedup'd):** `sync_daemon_dirs --check` reports one ops-only extra file, `orgs/kb-ops/workflows/acceptance-run.md` (unchanged from 2026-10-14; 9th consecutive recorded night). `scripts/sync_daemon_dirs.py` is present on `origin/main` but **absent on `origin/ops`**, so routine step 2b runs only in refs-fallback mode via the main copy. The gate reports, never blocks. Per the standing dispatcher-cloud dedup decision this run refreshed the canonical card `6a605ebb` in place rather than filing a dated duplicate. One human ruling ends the pile-up: (1) restore/mirror the script to `ops` or amend step 2b, (2) desktop `--sync --prune` to drop the ops-only file, (3) sweep the 15 dated duplicates — all bundled in open approval `6ab76543`.
- **Stale working card:** `d126c410-9bc54280` (figment:track1:replicate, owner `figment-expand`) has sat in `queue/working/` since 2026-09-07 (>48h) — likely stranded; candidate for the archiver or a human walk-back.
- **Terminal card in working/ (benign):** `6a6bc3dd-5494006b` (kb-ops iter-smoke-t2) is `state: halted` (terminal) but lives under `working/` per the state→dir map; no action needed.
- **Large inbox (120):** mostly `wf-*`/cadence cards plus the sync-daemon-dirs wake pile; worth a human sweep but not blocking.
