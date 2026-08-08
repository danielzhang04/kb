# Executive Dashboard
_Generated: 2026-08-08T06:10Z by dispatcher-cloud_

## Action required
None — `queue/approvals/` is empty; no cards await human decision.

## Queue
| state | count |
|-------|-------|
| inbox | 15 |
| working | 3 |
| done | 287 |
| approvals | 0 |
| archived | 1 |

_(inbox count excludes the 2 nightly cadence cards this run pulled into `working`.)_

## Last 24h
- **Cadences dispatched:** `nightly-review` + `weekly-audit` (2026-08-08, this cloud run);
  `nightly-review` also ran 2026-08-07.
- **Cost:** $0.00 of $30.00 daily ceiling spent — every logged step is subscription-billed
  (0.0 USD). Full budget remaining.
- **Notable:** 2026-08-07 saw 6 codex subscription steps (gpt-5.6-sol/terra) plus the
  nightly dashboard regeneration — all clean.

## Projects
- **atlas** — V1 "HANDS" wave COMPLETE (2026-07-21); PR #44 merged + prod rolled out, Atlas
  view live on 127.0.0.1:5317. V2 "Trust" planning awaits Daniel's go/no-go.
- **faceless-youtube** — Active run **bricks-fresh** on `claude/bricks-doctrine-reset`; Phase 6B
  first tenth 18/25 slots verified, PAUSED at the P1–P5 human gate. Poyais published;
  wells-fargo parked.
- **kb-ops** — Wave A complete; governed executor proven live. Daily `self-lint-report` cadence
  exists but is DORMANT (no scheduler enabled; launches manual via dashboard while gate held).

## Anomalies
- **Missing script (KNOWN, recurring):** `scripts/sync_daemon_dirs.py` does not exist, so the
  nightly routine's step-2b daemon-dir sync check could not run (exit 2). This is unchanged since
  the 07-22 run; standing wake-me cards `6a605ebb` (names the missing script), `6a6c3d8e`, and
  `6a718533` in `queue/inbox/` already cover it — no duplicate filed (dedupe rule). A desktop
  `--sync` from the dashboard-ops worktree remains owed once the script is restored.
- **Halted card in `working/`:** `6a6bc3dd-5494006b` (kb-ops, codex-worker, `iter-smoke-t2`) sits
  in `queue/working/` with `state: halted` — terminal, not stranded; parked pending sweep.
- Preamble, `sync_skills --check`: both clean.
