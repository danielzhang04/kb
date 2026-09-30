# Executive Dashboard
_Generated: 2026-09-30T06:19:16Z by dispatcher-cloud_

## Action required
- `65d8f246-8a461521` — **figment** — GATE A eye-gate: operator rules creator-001 expansion-02 blind board (seven axes) so curation to 40 can proceed — **T3**
- `6ab76543-b01ea7d5` — **kb** — wake:human-decision — **T1**

## Queue
| state | count |
|-------|-------|
| inbox | 118 |
| working | 2 |
| approvals | 2 |
| done | 1619 |

## Last 24h
- **Cadences:** nightly-review dispatched and executed this run (card `6abca973-9da968a4`, dispatcher-cloud); 1 dispatch row today, 1 yesterday.
- **Cost:** $0.00 spent today / $0.00 yesterday (subscription steps log 0.0). Budget $30.00/day → **$30.00 remaining**.
- **Health:** preamble OK; `sync_skills --check` in sync; `sync_daemon_dirs --check` reports drift (see Anomalies).
- **Notable:** dashboards regenerated; nightly coordination writes pushed via the routine's configured path.

## Projects
- **atlas** — Omni-interface remediation ready for Daniel review on `codex/atlas-enhancements-20260820` (foundation `280a67a9` + unstaged re-reviewed remediation diff). Suites green (Atlas 235, dashboard 18); diff >400 lines so contract requires review before commit; remote push still blocked pending Daniel's approval of origin.
- **faceless-youtube** — PARKED, no active work. STATE.md stale (2026-07-19); real last activity was the Bricks Variant-D arc in external clone `bricks-arc` (`claude/bricks-variant-vd`, pushed).
- **figment** — One resumable `figment_train.py pipeline` command drives anchor→…→video with gate halts and on-disk receipts; `detail`/`video` are now real gradeable stages; single gate writer (`identity_gate.write_gate_document`). Live chain handoff 2026-09-23.
- **kb-ops** — Production VM (`kb`, `100.89.73.118`) LIVE on release `e8ac49ad` (PR #204 merged 2026-09-23, deployed 05:55Z). Daemon-internal 5-min schedule tick proven live; ops history linear.
- **prospecting** — P1–P8 built across worktrees, all branches **UNPUSHED**. P8 affinity gate 953/953 at `52067386`; live-tested against real desktop store (campaign `camp_3147b42db58c4c15`, all Gate P8-B criteria green).

## Anomalies
- **Stale working/ cards (>48h):**
  - `d126c410-9bc54280` — figment:track1:replicate — state `working` since 2026-09-07 (~3 weeks).
  - `6a6bc3dd-5494006b` — kb-ops iter-smoke-t2 — state `halted` but sitting in `working/` since 2026-07-30.
- **Daemon-dir drift (recurring):** `orgs/kb-ops/workflows/acceptance-run.md` is ops-only, and `scripts/sync_daemon_dirs.py` is still absent from `ops` (checked via main's copy in refs-fallback mode). Chronic finding; 13 open wake-me cards already track it (through 2026-09-25). Per the standing 09-24→09-29 decision (memory), no new duplicate was filed this run — health-line report only. Desktop `sync_daemon_dirs.py --sync` from the dashboard-ops worktree is owed. Gate reports only — never blocks dispatch.
