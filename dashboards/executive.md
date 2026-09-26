# Executive Dashboard
_Generated: 2026-09-26T06:19:57Z by dispatcher-cloud_

## Action required
- **figment / T3** — `65d8f246-8a461521`: GATE A eye-gate — operator to rule creator-001
  expansion-02 blind board (seven axes) before curation to 40 can proceed. Awaiting Daniel.

## Queue
| state | count |
|-------|-------|
| inbox | 117 |
| working | 3 |
| approvals | 1 |
| blocked | 0 |
| done | 1614 |
| archived | 10 |

## Last 24h
- Cadences dispatched today (2026-09-26): `nightly-review` (`6ab7633d-038267ce`),
  `weekly-audit` (`6ab7633d-543cd841`) — both by dispatcher-cloud, cloud tier.
- Prior nightly-review ran 2026-09-25 (`6ab6117a-b6c77610`).
- Cost: $0.00 API-billed (all steps subscription-billed, logged 0.0) against the
  $30.00/day ceiling → full budget remaining.
- Notable: this nightly run regenerated dashboards and is executing the weekly audit.

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
  - `6a6bc3dd-5494006b` (kb-ops, `iter-smoke-t2`, T1, owner codex-worker) — last touched
    2026-07-30, ~58 days stale. Candidate for stranded-archiver / human triage.
  - `d126c410-9bc54280` (figment, `track1:replicate`, T2, owner figment-expand) — last touched
    2026-09-07, ~19 days stale.
- Large inbox backlog: 117 cards in queue/inbox/ — worth a human glance to confirm none are
  stranded awaiting dispatch.
- Daemon-dirs drift (chronic): `sync_daemon_dirs --check` (run via the routine's cloud
  refs-fallback, `origin/main` vs `origin/ops`) reports exit 1 — one persistent ops-only extra,
  `orgs/kb-ops/workflows/acceptance-run.md`. Fix is a desktop `--sync --prune`.
- Wake-card pileup: ~19 open inbox cards already report this identical drift (14
  `wake-daniel-*-sync-daemon-dirs-drift` + several `wake-me:daemon-dir-drift-*`). This run did
  NOT file a 20th duplicate; it consolidated the issue into a single weekly-audit finding +
  one approval card instead. Step 2b needs amending to dedupe against an open card.
- `preamble` and `sync_skills --check` both passed clean.
