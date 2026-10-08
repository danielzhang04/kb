# Executive Dashboard
_Generated: 2026-10-08 06:20 UTC by dispatcher-cloud_

## Action required
Two cards await a human ruling in `queue/approvals/`:
- `65d8f246-8a461521` — **figment** — GATE A eye-gate: operator rules creator-001 expansion-02 blind board (seven axes) before curation to 40 can proceed — **T3**
- `6ab76543-b01ea7d5` — **kb** — wake:human-decision: desktop coordination tier degrading (dormant desktop cadences; daemon-dirs-sync not running; grades/activity ledgers frozen since 2026-07-21) — **T1**

Also piling up in `queue/inbox/` (not auto-actioned): 15 open `wake-daniel-*-sync-daemon-dirs-*` cards (plus the canonical `6a605ebb`, refreshed in place tonight) tracking the same single-file ops drift. One desktop fix + the step-2b dedup amendment ends the pile-up (see Anomalies).

## Queue
| state | count |
|-------|-------|
| inbox | 120 |
| working | 2 |
| approvals | 2 |
| done | 1626 |
| archived | 10 |

## Last 24h
- **Cadences run:** `nightly-review` dispatched both nights — card `6ac5e503-b0dd66b8` (2026-10-07) and `6ac735bb-6d8d3533` (2026-10-08, this run). No other cadences fired.
- **Cost:** 2026-10-08 cost ledger $0.00 (subscription steps log 0.0); 2026-10-07 logged 1 step (`nightly-review`, claude-opus-4-8, $0.00). Budget remaining today: **$30.00 / $30.00** daily ceiling.
- **Activity ledger:** 0 rows today and yesterday — the inspector grading/activity pipeline remains frozen (see the kb approvals card).
- **Notable:** nightly run healthy — preamble OK, `sync_skills --check` in sync; `sync_daemon_dirs --check` reports the known single-file drift (refs-fallback). This run took the **DIRECT-PUSH** path to ops (or the PR fallback if ops push is restricted — see run summary).

## Projects
- **atlas** — Omni-interface foundation + adversarially-reviewed remediation complete locally on `codex/atlas-enhancements-20260820`; diff >400 lines, awaiting Daniel review before commit/push. V1 "Hands" merged & live (PR #44). V2 "Trust" is Daniel's go/no-go.
- **faceless-youtube** — PARKED, no active work. STATE.md stale (2026-07-19); real last activity was the Bricks Variant-D arc in an external clone.
- **figment** — Resumable `figment_train.py pipeline` drives anchor→…→video with gate halts; one gate writer, one prompt composer per era. Live replication card `d126c410` still in working/ (see Anomalies). GATE A board awaiting operator ruling (approvals).
- **kb-ops** — Prod VM LIVE on release `e8ac49ad` (daemon schedule tick every 5 min, cadence execution profile, bridge admits `cadence:<agent>` cards). Ops history linear; next drain chain base `052c8355`.
- **prospecting** — P1–P8 built across worktrees, all branches UNPUSHED. P8 affinity gate 953/953 at HEAD `52067386`; live-tested against real desktop store (campaign `camp_3147b42db58c4c15`), all Gate P8-B criteria green.

## Anomalies
- **Daemon-dir drift (recurring, unchanged 4th night).** `orgs/kb-ops/workflows/acceptance-run.md` is ops-only; `scripts/sync_daemon_dirs.py` is absent from `ops` so the literal gate command only runs via main's copy in refs-fallback mode. Tonight's run refreshed the canonical card `6a605ebb` in place (dedup decision) rather than minting a new dated duplicate; 15 older dated wake cards still open in inbox. Owed: desktop `--sync --prune`/ruling + a step-2b dedup amendment. Escalated in approvals card `6ab76543`.
- **Stale working/ cards.** `d126c410-9bc54280` (figment track1 replicate, T2) last touched 2026-09-07 — ~31 days idle in working/. `6a6bc3dd-5494006b` (kb-ops iter-smoke-t2) sits in working/ in terminal state `halted` since 2026-07-30. Both exceed the 48h staleness window; candidates for the stranded-archiver or a human walk-back.
- **Grading pipeline frozen.** grades + activity ledgers show no rows since 2026-07-21 (~79 days); desktop grades-reconcile cadence dormant. Tracked in approvals card `6ab76543`.
