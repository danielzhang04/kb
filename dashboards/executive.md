# Executive Dashboard
_Generated: 2026-10-14T06:20:35Z by dispatcher-cloud_

## Action required
- `65d8f246-8a461521` — **figment** — GATE A eye-gate: operator rules creator-001 expansion-02 blind board (seven axes) so curation to 40 can proceed — **T3**
- `6ab76543-b01ea7d5` — **kb** — wake:human-decision — **T1**

Plus **16 open `wake-daniel-*` cards + the canonical `6a605ebb` drift card in `queue/inbox/`** awaiting human decision — see Anomalies (15 dated + the canonical are the same sync-daemon-dirs issue).

## Queue
| state | count |
|-------|-------|
| inbox | 120 |
| working | 3 |
| approvals | 2 |
| done | 1645 |

## Last 24h
- **Cadences run:** `nightly-review` (this cloud run) — dispatched 1 card (`6acf1eca-69d62e58`, cadence:nightly-review).
- **Cost:** $0.00 billed today — all 12 cost rows are subscription billing (codex `gpt-5.6-sol`, one with exit=1). Budget `governance/budget.yaml` = $30.00/day → **$30.00 remaining**.
- **Health:** `preamble.py` OK; `sync_skills.py --check` clean (in sync); `sync_daemon_dirs --check` runs only via cloud refs-fallback (script absent on `ops`) and reports the same single-file drift as all priors.
- **Notable:** dashboards regenerated; no new project work landed on `ops` since the prior nightly run.

## Projects
- **atlas** — Omni-interface foundation + independently re-reviewed adversarial remediation complete locally on `codex/atlas-enhancements-20260820`; diff >400 lines so the contract requires Daniel review before commit. (V1 "Hands" already shipped — PR #44 merged, live on 127.0.0.1:5317.)
- **faceless-youtube** — PARKED, no active work in flight. STATE.md stale (2026-07-19); real last activity was the Bricks Variant-D arc on `claude/bricks-variant-vd` (tracked outside the main checkout).
- **figment** — One resumable `figment_train.py pipeline` command drives `anchor → … → video` with gate halts and on-disk receipts; `detail`/`video` are now real gradeable stages; single gate writer and single per-era prompt composer consolidations landed.
- **kb-ops** — Production VM (`kb`, 100.89.73.118) LIVE on release `e8ac49ad` (PR #203/#204 merged, deployed 2026-09-23); daemon 5-min schedule tick + `cadence` execution profile in prod; ops history linear.
- **prospecting** — P1–P8 built across `kb-worktrees/prospecting-p{1..8}`, **all branches UNPUSHED**; P8 affinity gate 953/953, live-tested against the real desktop store (campaign `camp_3147b42db58c4c15`, batch 1 all Gate P8-B criteria green).

## Anomalies
- **Recurring (15 duplicate cards + 1 canonical):** `scripts/sync_daemon_dirs.py` is present on `origin/main` but **absent on `origin/ops`**, so routines/nightly.md step 2b runs only in refs-fallback mode. The gate reports but never blocks. Per the standing dispatcher-cloud dedup decision (and open approval `6ab76543`), this run did **not** file a dated duplicate; it refreshed the canonical card `6a605ebb` in place (8th recorded consecutive unchanged finding). **15 older dated `sync-daemon-dirs` cards (08-15 → 10-04)** still sit in `queue/inbox/` awaiting a human consolidation sweep. The single recurring drift is one ops-only file, `orgs/kb-ops/workflows/acceptance-run.md`. One human ruling ends the pile-up: (1) restore the script to `ops`, (2) reconcile or `--sync --prune` the file, (3) land the step-2b dedup amendment (owed since ~2026-09-30), (4) sweep the 15 dated duplicates — all four are already captured in open approval `6ab76543`.
- **Stale working card:** `d126c410-9bc54280` (figment:track1:replicate, owner `figment-expand`) has sat in `queue/working/` since 2026-09-07 (>48h) — likely stranded; candidate for the archiver or a human walk-back.
- **Terminal card in working/ (benign):** `6a6bc3dd-5494006b` (kb-ops iter-smoke) is `state: halted` (terminal) but lives under `working/` per the state→dir map; no action needed.
- **Large inbox (121):** mostly `wf-*` workflow cards plus the 17 wake-me cards; worth a human sweep but not blocking.
