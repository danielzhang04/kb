# Executive Dashboard
_Generated: 2026-09-03 06:21 UTC by dispatcher-cloud_

## Action required
None in `queue/approvals/` (0 cards). Two standing items await Daniel at the desk
(project gates, not approval cards):
- **atlas** — adversarial remediation diff on `codex/atlas-enhancements-20260820` (>400
  lines) needs Daniel review before commit (`handoffs/2026-08-20-atlas-omni-remediation-review.md`).
- **faceless-youtube** — bricks-fresh paused at the P1–P5 human gate, and the Variant D
  L01–L25 trial (25/25 verified) awaits the keep / edit / iterate / revert call
  (`handoffs/2026-08-21-fyt-bricks-variant-d-L25.md`).

## Queue
| state | count |
|-------|-------|
| inbox | 23 |
| working | 2 |
| approvals | 0 |
| done | 1211 |
| archived | 10 |

## Last 24h
- Cadences run: `nightly-review` dispatched today (card `6a9911bd-44f336fd`, this run).
- Cost: **$0.00** spent today of the **$30.00** daily ceiling (subscription steps log
  $0.00); yesterday logged 53 cost rows. Budget remaining today: $30.00.
- Notable: nightly-dispatcher run healthy — preamble OK, pyyaml OK, `sync_skills --check`
  clean (no drift). Daemon-dir mirror check run via the `origin/main` copy (script still
  absent on `ops`): main→ops drift has shrunk from 11 paths (08-18) to 1.

## Projects
- **atlas** — omni-interface foundation complete locally on `codex/atlas-enhancements-20260820`
  (`280a67a9`); independently re-reviewed remediation diff (durable ACTING state, fail-closed
  adapters, OAuth/ETag-bound proposals) ready; blocked on Daniel review (>400-line contract gate).
- **faceless-youtube** — bricks-fresh run paused at P6B first-tenth P1–P5 gate (18/25 slots
  verified); Variant D trial extended to L01–L25, 25/25 verified ($4.96 cumulative), Daniel gate open.
- **kb-ops** — Wave A complete; governed executor proven live. Daily `self-lint-report`
  cadence exists but is DORMANT (no scheduler; manual launches via the dashboard Workflows UI).

## Anomalies
- **Stale working card:** `6a6bc3dd-5494006b` (kb-ops, `iter-smoke-t2`, owner `codex-worker`,
  T1) has sat in `working/` for ~5 weeks with no activity — candidate for the stranded-archiver
  or a human walk-back.
- **Missing script on ops:** `scripts/sync_daemon_dirs.py` is absent on the `ops` branch
  (present on `origin/main`); the nightly step 2b check runs only via the `origin/main` copy
  workaround. Tracked by wake-me card `6a605ebb`.
- **Daemon-dir drift (shrinking):** 1 remaining ops-only path, `orgs/kb-ops/workflows/acceptance-run.md`,
  awaiting a human back-port-vs-`--prune` decision (card `6a7c0ebf`). Down from 11 paths on 08-18.
- preamble: OK. sync_skills: clean.
