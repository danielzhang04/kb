# Executive Dashboard
_Generated: 2026-09-02 06:21 UTC by dispatcher-cloud_

## Action required
None — no cards in `queue/approvals/`.

Standing human-owned items awaiting Daniel in inbox (not approvals-gated, but blocking desktop reconciliation):
- **Daemon-dir drift** (umbrella card `6a7c0ebf`) — UNCHANGED since the 2026-09-01 refresh: 8 daemon-read agent specs main-only (incl. `agents/dispatcher-cloud.md`), 3 content-differ, 1 ops-only extra (`acceptance-run.md`). Owes a desktop `python scripts/sync_daemon_dirs.py --sync` from the dashboard-ops worktree, plus a back-port-or-prune call on `acceptance-run.md`. No refresh filed tonight (drift set identical → no card churn, per dispatcher-cloud memory rule).
- **Missing sync script** (`6a605ebb`) — `scripts/sync_daemon_dirs.py` still absent on ops; the nightly check runs the `main` copy in refs-fallback. Owes a script-mirror-to-ops decision.
- Older drift wake-me cards folded under the umbrella: `6a6c3d8e`, `6a718533`; human-decision wakes `wake-daniel-2026-08-15-sync-daemon-dirs-missing`, `wake-daniel-2026-08-30-sync-daemon-dirs-drift`.
- Decision cards: `2a6bdcc2` (vm-ops-checkout-refresh-ceremony), `6a5e482a` (budget-gate-measures-nothing).

## Queue
| state | count |
|-------|-------|
| inbox | 16 |
| working | 1 |
| blocked | 6 |
| halted | 1 |
| approvals | 0 |
| done | 1164 |
| archived | 10 |

(Counts by card `state:` field. The 6 `blocked` are the `dashboard-engine` engagement-fold draft cards; the 1 `halted` is a terminal working-dir card; the 1 `working` is tonight's `cadence:nightly-review`.)

## Last 24h
- Cadences run: **nightly-review** (this run, dispatcher-cloud, cloud tier). 1 card dispatched and self-executed.
- Cost: **$0.00** spent (all steps on subscription billing; 0 API-billed rows today). Budget remaining **~$30.00 / $30.00** daily limit.
- Health: `preamble.py` OK; `sync_skills.py --check` in sync (EXIT 0); `sync_daemon_dirs.py --check` reports drift (EXIT 1 — reported to card `6a605ebb`, non-blocking).
- Notable: no new work cards emitted beyond the cadence; inbox backlog is unchanged human-owned decisions/wake-me cards.

## Projects
- **atlas** — Omni-interface foundation complete locally on `codex/atlas-enhancements-20260820` (commit `280a67a9`) plus an adversarially re-reviewed remediation diff; Atlas 235 passed, security re-review PASS. Diff >400 lines, so awaiting Daniel review before commit (handoff `2026-08-20-atlas-omni-remediation-review.md`).
- **faceless-youtube** — Active run **bricks-fresh** on `claude/bricks-doctrine-reset` (dd22f97), Phase 6B paused at P1-P5 human gate (18/25 slots verified). Variant D trial on `claude/bricks-variant-vd` reached 25/25 (L01-L25, $4.96 cumulative) and awaits a Daniel keep/edit/iterate/revert gate.
- **kb-ops** — Wave A complete; governed executor proven live. Daily `self-lint-report` cadence exists but is DORMANT (no scheduler; manual launch only while the gate is held in a watched session).

## Anomalies
- **Daemon-dir drift** between `origin/main` and `origin/ops` for daemon-read dirs — UNCHANGED from the 09-01 report on umbrella card `6a7c0ebf` (routine step 2b ran the `main` copy of `sync_daemon_dirs.py` as a workaround since the script is absent on ops, `6a605ebb`). Standing, non-blocking; no new card filed because the drift set did not change.
- No stale (>48h) cards in `working/`; no preamble failures.
