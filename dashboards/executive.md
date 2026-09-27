# Executive Dashboard
_Generated: 2026-09-27T06:18:36Z by dispatcher-cloud_

## Action required
- **figment / T3** — `65d8f246-8a461521`: GATE A eye-gate — operator to rule creator-001
  expansion-02 blind board (seven axes) before curation to 40 can proceed. Awaiting Daniel.
- **kb / T1** — `6ab76543-b01ea7d5`: `wake:human-decision` — a human-decision card sits in
  approvals. Awaiting Daniel.

## Queue
| state | count |
|-------|-------|
| inbox | 117 |
| working | 3 |
| approvals | 2 |
| blocked | 0 |
| done | 1616 |
| archived | 10 |

## Last 24h
- Cadences dispatched today (2026-09-27): `nightly-review` (`6ab8b4e3-b9fb4514`) by
  dispatcher-cloud, cloud tier. This run is executing it.
- Prior night (2026-09-26): `nightly-review` (`6ab7633d-038267ce`) and `weekly-audit`
  (`6ab7633d-543cd841`).
- Cost: $0.00 API-billed today (all steps subscription-billed, logged 0.0) against the
  $30.00/day ceiling → full budget remaining.
- Notable: this nightly run regenerated dashboards; preamble and `sync_skills --check` both
  passed clean.

## Projects
- **atlas** — Omni-interface foundation complete locally (`codex/atlas-enhancements-20260820`);
  the adversarial-remediation diff exceeds 400 lines and awaits Daniel's review before commit.
  V1 "Hands" wave merged (PR #44) and live in prod; V2 planning is Daniel's go/no-go.
- **faceless-youtube** — PARKED, no active work. STATE stale (2026-07-19); real last activity
  is the Bricks Variant-D arc in the external `bricks-arc` clone (pushed).
- **figment** — resumable `figment_train.py pipeline` drives anchor→…→video with per-stage
  gates. GATE A eye-gate open (see Action required). One stale working card (see Anomalies).
- **kb-ops** — production VM live on release `e8ac49ad`; daemon schedule tick runs every 5 min
  (outbox mode, dirty-checkout skip). Ops history linear; last drain 2026-09-22 (19 bundles).
- **prospecting** — P1–P8 built across worktrees, all branches UNPUSHED. P8 affinity gate
  953/953 at HEAD `52067386`; live-tested against the real desktop store (all P8-B green).

## Anomalies
- Stale working/ cards (>48h, no movement):
  - `6a6bc3dd-5494006b` (kb-ops, owner codex-worker) — ~8 weeks stale (last touched late July).
    Candidate for stranded-archiver / human triage.
  - `d126c410-9bc54280` (figment, owner figment-expand) — ~3 weeks stale (last touched
    2026-09-07).
- Large inbox backlog: 117 cards in queue/inbox/ — worth a human glance to confirm none are
  stranded awaiting dispatch.
- Daemon-dirs drift (chronic): `sync_daemon_dirs --check` run in the routine's cloud
  refs-fallback mode (`origin/main` vs `origin/ops`, since the script is main-only by design)
  reports exit 1 — one persistent ops-only extra, `orgs/kb-ops/workflows/acceptance-run.md`.
  This is already saturated across ~19 open inbox wake cards
  (`wake-me:daemon-dir-drift-and-missing-sync-script`, `wake-me:sync-daemon-dirs-drift`, and
  several dated `daemon-dir-drift-*`), so this run filed NO duplicate. Owed on desktop:
  `sync_daemon_dirs --sync --prune` from the dashboard-ops worktree to clear it. The gate is
  report-only and did not block dispatch.
- `preamble` (verified read-only: no STOP file, no ANTHROPIC_API_KEY, $0 spend vs $30 ceiling)
  and `sync_skills --check` both passed clean.
