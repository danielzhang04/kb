# Executive Dashboard
_Generated: 2026-09-01T06:26Z by dispatcher-cloud_

## Action required
None — `queue/approvals/` is empty (0 cards awaiting human approval).

## Queue
| state     | count |
|-----------|-------|
| inbox     | 23    |
| working   | 2     |
| done      | 1163  |
| approvals | 0     |
| archived  | 10    |

## Last 24h
- **Cadences run:** `nightly-dispatch` (2026-08-31, model claude-opus-4-8) and `nightly-review`
  dispatched today (2026-09-01, card `6a966fc6-571f94b0`, project kb).
- **Cost:** $0.00 spent today; $0.00 yesterday (all 4 ledgered steps were subscription-billed
  codex runs, gpt-5.6-terra, exit 0). Budget remaining: **$30.00 / $30.00** daily limit.
- **Notable:** Skills mirror in sync (`sync_skills.py --check` exit 0). Preamble green.

## Projects
- **atlas** — Omni-interface foundation + adversarial remediation complete locally on
  `codex/atlas-enhancements-20260820` (280a67a9 + unstaged >400-line diff); awaiting Daniel
  review/commit and explicit `origin` push approval. V1 "Hands" shipped and live earlier (PR #44).
- **faceless-youtube** — Production run **bricks-fresh** paused at P1–P5 human gate; Variant D
  trial extended to L01–L25 (25/25 verified, board artifact filed) awaiting Daniel's
  keep/edit/iterate/revert decision.
- **kb-ops** — Wave A complete; governed executor proven live. `self-lint-report` cadence exists
  but is DORMANT (no scheduler; manual launch only while the gate is held in a watched session).

## Anomalies
- **Daemon-dir drift (main→ops):** `sync_daemon_dirs --check` reports 8 `agents/*.md` missing
  from ops, 3 content-differ, 1 ops-only extra under `orgs/kb-ops/workflows/`. Wake-me card
  `6a966fb0-614bc01e` filed; a desktop `python scripts/sync_daemon_dirs.py --sync` is owed. The
  sync script itself is also absent from the `ops` branch (present only on `origin/main`).
- **Stale working card:** `6a6bc3dd-5494006b` (kb-ops, `iter-smoke-t2`, owner codex-worker) has
  sat in `working/` since 2026-07-30 (>30 days) — well past the 48h window. Candidate for the
  stranded-archiver or manual reconciliation.
- **Inbox backlog:** 23 cards in `queue/inbox/`.
