# Executive Dashboard
_Generated: 2026-10-16 06:26 UTC by dispatcher-cloud_

## Action required

- **figment** · `65d8f246-8a461521` · T3 · GATE A eye-gate — operator rules
  creator-001 expansion-02 blind board (seven axes) so curation to 40 can proceed.
- **kb** · `6ab76543-b01ea7d5` · T1 · wake:human-decision.

Plus the long-standing daemon-dir drift: 15 legacy `wake-daniel-*-sync-daemon-dirs-*`
cards + the canonical card `6a605ebb` (refreshed in place tonight) all await ONE human
ruling (see Anomalies).

## Queue

| state     | count |
|-----------|-------|
| inbox     | 121   |
| working   | 3     |
| blocked   | 0     |
| approvals | 2     |
| done      | 1757  |
| archived  | 10    |

## Last 24h

- **Cadences:** `nightly-review` dispatched 2026-10-16 (card `6ad1c321-6da5beb9`) and
  2026-10-15 (card `6ad06fbb-5c83ba4e`). Single-scheduler dispatcher healthy.
- **Cost:** $0.00 spent today, $0.00 yesterday — every logged step is subscription
  billing ($0.0). Budget remaining **$30.00 / $30.00** (governance/budget.yaml).
- **Worker throughput:** codex workers logged 13 cost rows today and 72 yesterday
  (all `gpt-5.6-sol`, subscription). Yesterday: 70 clean exits, one `codex_exit: 1`
  (`6ad0a211-3c912e83`) and one blank-exit row (`6ad0a201-...`); today all 13 clean.
- **Health line:** preamble OK · pyyaml OK · sync_skills `--check` clean ·
  sync_daemon_dirs `--check` DRIFT (reports-only gate, see Anomalies).

## Projects

- **atlas** — Omni-interface foundation + adversarial remediation complete locally on
  `codex/atlas-enhancements-20260820` (`280a67a9` + unstaged diff >400 lines); awaiting
  Daniel review before commit/push. V1 "Hands" shipped to prod 2026-07-21 (PR #44).
- **faceless-youtube** — PARKED, no active work. STATE.md stale (2026-07-19); real last
  activity was the Bricks Variant-D arc in clone `bricks-arc` (`claude/bricks-variant-vd`).
- **figment** — One resumable `figment_train.py pipeline` drives anchor→…→video with gates
  at each gradeable stage; `detail`/`video` now first-class stages; single gate writer and
  single per-era prompt composer. GATE A eye-gate awaiting operator ruling (see above).
- **kb-ops** — Prod VM `kb` LIVE on release `e8ac49ad` (daemon-internal 5-min schedule
  tick, cadence execution profile, bridge admits `cadence:<agent>` cards). Ops linear.
- **prospecting** — P1–P8 built across worktrees, all branches UNPUSHED. P8 affinity gate
  953/953 at `52067386`; live-tested against real desktop store (campaign
  `camp_3147b42db58c4c15`), all Gate P8-B criteria green.

## Anomalies

- **sync_daemon_dirs drift (persistent; 10th consecutive unchanged night).**
  `scripts/sync_daemon_dirs.py` is on `origin/main` but absent from `origin/ops`, so the
  literal step-2b command fails (EXIT 2); run via `main`'s copy in refs-fallback mode it
  reports one ops-only file, `orgs/kb-ops/workflows/acceptance-run.md`. Gate reports-only;
  run continued. Per the dispatcher dedup practice, the canonical card `6a605ebb` was
  refreshed in place tonight rather than filing a new dated duplicate; 15 legacy dated
  cards (`wake-daniel-2026-08-15` … `2026-10-04`) still await human consolidation. Owed
  desktop fix + step-2b dedup amendment (unlanded since ~2026-09-30); both bundled in
  approval `6ab76543-b01ea7d5`.
- **2 stale `working/` cards (>48h).** `6a6bc3dd-5494006b` (`iter-smoke-t2`, codex-worker,
  state `halted`, since 2026-07-30) and `d126c410-9bc54280` (`figment:track1:replicate`,
  figment-expand, since 2026-09-07). Neither shows recent activity.
- **preamble:** no failure this run.
