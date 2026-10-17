# Executive Dashboard
_Generated: 2026-10-17T06:18Z by dispatcher-cloud_

## Action required
- **65d8f246-8a461521** | figment | T3 — GATE A eye-gate: operator must rule creator-001
  blind board (seven axes) before curation to 40 can proceed.
- **6ab76543-b01ea7d5** | kb | T1 — wake:human-decision: desktop coordination tier is
  degrading (desktop cadences dormant, grades/activity ledgers frozen since 2026-07-21,
  wake-card pile-up). Needs a human on the desktop. See Anomalies.

## Queue
| state | count |
|-------|-------|
| inbox | 121 |
| working | 3 |
| approvals | 2 |
| archived | 10 |
| done | 1773 |

## Last 24h
- **Cadences dispatched:** 2026-10-16 nightly-review (1 card); 2026-10-17 (this run)
  nightly-review + weekly-audit (2 cards). All dispatched on schedule.
- **Cost:** daily budget $30.00 (governance/budget.yaml). API-billed spend $0.00 — every
  logged step is subscription billing. 2026-10-16 cost ledger: 29 rows (28 codex
  `gpt-5.6-sol` runs, all exit 0, $0.00 each; 1 `claude-opus-4-8` nightly-review step,
  $0.00). Budget remaining: full $30.00.
- **Notable:** nightly-review + weekly-audit running now; dashboards regenerated. sync_skills
  `--check` clean (no drift). Daemon-dir gate reports the same single-file ops-only drift as
  prior nights (see Anomalies).

## Projects
- **atlas** — V1 "Hands" merged + live in prod (PR #44, 2026-07-21). Omni-interface
  foundation + independently re-reviewed adversarial remediation sit on branch
  `codex/atlas-enhancements-20260820`; diff > 400 lines, so contract requires Daniel review
  before commit/push. Awaiting Daniel.
- **faceless-youtube** — PARKED. No active work in flight. STATE.md stale (2026-07-19); last
  real activity was the Bricks Variant-D arc in an external clone.
- **figment** — resumable `pipeline` command drives anchor→…→video with a gate halt at each
  gradeable stage; gate writer + prompt composer unified. GATE A (creator-001) awaits
  operator ruling (approvals card above).
- **kb-ops** — production VM `kb` LIVE on release `e8ac49ad`; daemon-internal schedule tick
  every 5 min. Desktop coordination tier degradation outstanding (human-decision card above).
- **prospecting** — P1–P8 built across worktrees; all branches UNPUSHED. P8 affinity gate
  953/953 at HEAD 52067386; live-tested against the real desktop store, Gate P8-B green.

## Anomalies
- **Activity ledger frozen** — 0 rows on 2026-10-16 and 2026-10-17 (frozen since ~2026-07-21
  per human-decision card 6ab76543). The grades↔activity reconciliation pipeline is producing
  nothing. Desktop fix owed.
- **daemon-dirs-sync gate (routines/nightly.md step 2b)** — `scripts/sync_daemon_dirs.py` is
  present on `origin/main` but ABSENT from `origin/ops`, so the literal check fails on the ops
  checkout (EXIT 2). Run via main's copy in refs-fallback mode: same single ops-only drift,
  `orgs/kb-ops/workflows/acceptance-run.md` (EXIT 1), unchanged from 15 open prior wake cards.
  Desktop fix owed (dashboard-ops worktree).
- **Malformed working card d126c410-9bc54280** (figment track1:replicate) — unquoted colon in
  its `action:` field makes the YAML frontmatter unparseable; sitting in working/ since
  2026-09-03 (~44 days). Stale + unparseable; figment's to fix.
- **Halted card 6a6bc3dd-5494006b** (kb-ops iter-smoke-t2, codex) remains in working/ with
  terminal state `halted`.
- **Desktop coordination tier degrading** — desktop cadences (daemon-dirs-sync,
  grades-reconcile) dormant; wake-card pile-up in inbox. Tracked by human-decision card
  6ab76543; needs a human on the desktop.
