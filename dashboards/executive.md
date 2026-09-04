# Executive Dashboard
_Generated: 2026-09-04 06:21 UTC by dispatcher-cloud_

## Action required
One card in `queue/approvals/` (1 card):
- **figment** — `65d8f246-8a461521` · GATE A eye-gate (T3, `role: inspect`, workflow
  `figment-creator`). Operator must rule creator-001 **expansion-03** blind board (seven
  axes) so curation to 40 can proceed. Board is local + gitignored
  (`.../expansion-03/board.html`); expansion-02 is quarantined evidence and must not be
  graded. Awaiting Daniel's blind ruling.

Standing items awaiting Daniel at the desk (project gates, not approval cards):
- **atlas** — adversarial remediation diff on `codex/atlas-enhancements-20260820` (>400
  lines) needs Daniel review before commit
  (`handoffs/2026-08-20-atlas-omni-remediation-review.md`).
- **faceless-youtube** — bricks-fresh Variant D gate: keep D / keep D with edits / iterate
  / revert (`handoffs/2026-08-21-fyt-bricks-variant-d-L25.md`).
- **prospecting** — P2-P7 human gates pending (list-builder run, 20 drafts, ten-email
  draft run, VM outreach run, live T1 run, P7-UI plan approval).

## Queue
| state | count |
|---|---|
| inbox | 39 |
| working | 2 (1 genuinely working, 1 `halted`) |
| approvals | 1 |
| done | 1506 |

## Last 24h
- **Cadences run:** nightly cloud dispatcher fired (this run); it emitted 1 card —
  `6a9a62f9-27d08fd0` (`cadence:nightly-review`, T1, claude/sonnet-5), executed here.
- **Cost vs budget:** today (2026-09-04) **$0.00** of $30.00 daily limit (model steps are
  subscription-billed = $0.00). Yesterday (2026-09-03): **$4.68** — entirely
  `runpod:rtx-4090` GPU compute (15 rows, the figment Track-1 replication); the 294
  subscription-billed model steps logged $0.00.
- **Notable:** 312 cost rows yesterday (gpt-5.6-terra 250, gpt-5.6-sol 41, opus-4-8 2,
  sonnet-5 3, runpod 16) — a heavy figment/prospecting build day.

## Projects
- **atlas** — Omni-interface foundation complete locally (`codex/atlas-enhancements-20260820`
  @ `280a67a9`); adversarial remediation diff (>400 lines) re-reviewed PASS, awaiting Daniel
  review before commit. V1 "Hands" merged + in prod since 2026-07-21.
- **faceless-youtube** — bricks-fresh in production; Variant D trial extended to L01-L25 (25/25
  verified, board `12e75c13`), PAUSED at Daniel's keep/iterate/revert gate.
- **kb-ops** — Wave A complete; governed executor proven. `self-lint-report` cadence exists but
  is DORMANT (no scheduler; manual launch only inside a watched session).
- **prospecting** — P1 human gate PASSED 2026-09-04 (Datasette read-only, PII hook rejected
  planted email). P2-P6 built and fully recorded; P7-UI plan v2.1 drafted. Branches unpushed
  in local worktrees (`handoffs/2026-09-04-prospecting-p1-p6-built-p7ui-planned.md`).

## Anomalies
- **Daemon-dir drift gate (routines/nightly.md step 2b):** `scripts/sync_daemon_dirs.py` is
  present on `origin/main` but MISSING on `ops`, so the routine's literal invocation fails;
  ran `main`'s copy in refs-fallback mode, which reports drift — `orgs/kb-ops/workflows/
  acceptance-run.md` is ops-only (unchanged since 08-12). Already covered by two open umbrella
  wake-me cards owned by human-operator: `6a7c0ebf` (drift: back-port-vs-prune, human call) and
  `6a605ebb` (script absent on ops + missing-sync-script). Actionable core UNCHANGED this run,
  so NO new card filed (per dispatcher-cloud memory rule: never churn drift cards). Report-only
  gate; dispatch was not blocked.
- **Stale working/ cards:** none >48h. `d126c410` (figment replication) is genuinely working
  from 2026-09-03 (~1 day). `6a6bc3dd` (kb-ops iter-smoke-t2, codex) is state `halted`
  (terminal), resident in working/ only because halted resolves there.
- preamble: OK. sync_skills --check: in sync (exit 0).
