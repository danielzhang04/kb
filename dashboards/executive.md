# Executive Dashboard
_Generated: 2026-07-20T06:09Z by dispatcher-cloud_

## Action required
5 T3 approval cards are parked in the queue awaiting the human operator:
- `6a5d6b23-12ddfee2` — kb-ops — approve:oauth-gate-g1 (T3)
- `6a5d6b23-05204b15` — kb-ops — approve:oauth-gate-g2 (T3)
- `6a5d6b23-4c98aec0` — kb-ops — approve:oauth-gate-g3 (T3)
- `6a5d6b23-17e8d1be` — kb-ops — approve:oauth-gate-g4 (T3)
- `6a5db96f-3c1e7a02` — kb-ops — approve:governance-amendment-canaries (T3)

(queue/approvals/ signed-approval folder: empty.)

## Queue
| state | count |
| --- | --- |
| inbox | 23 |
| working | 3 |
| approvals | 0 |
| done | 19 |

_(The nightly card `6a5dbb3e-295a9d2b` sits in `queue/inbox/` at state `working` — this
run. No card has been in `working/` >48h; oldest is atlas `6a5c8ad2-1d991c23` at ~21.6h.)_

## Last 24h
- **Nightly cadence:** `nightly-review` dispatched 2026-07-20 (card `6a5dbb3e-295a9d2b`,
  this run) and 2026-07-19 (card `6a5c68e2-dc0c5e32`).
- **Health:** `scripts/preamble.py` → PREAMBLE OK; `scripts/sync_skills.py --check` →
  exit 0, no registry drift.
- **Closed work:** 11 inspector grade rows logged 2026-07-19 — kb-ops hook/skill imports
  (delivery-gate, block-no-verify, config-protection, CI validators, GateGuard retarget,
  strategic-compact + save-session adoption) and two atlas MCP builds (kb-MCP fixture +
  queue_summary tool, remaining MCP read tools), graded by inspector@agents.local.
- **Cost:** $0.00 spent today (all steps subscription-billed, logged 0.0) vs daily ceiling
  $5.00 → **$5.00 remaining**.

## Projects
- **atlas** — V0 build PAUSED mid-wave; tasks 1–5 built + reviewed clean (T3/T4 96 PASS,
  T5 at ad5fa9a, 14/14 tests). Card `6a5c8ad2-1d991c23` in working awaiting live smoke.
  Resume map: docs/plans/2026-07-19-atlas-v0-HANDOFF.md on branch claude/atlas.
- **faceless-youtube** — scaffolded 2026-07-15, STATE "Now" empty. Two cards in working
  (build:video-run, draft:long-form-script) plus 7 inbox cards under claude-boss.
- **kb-ops** — scaffolded 2026-07-16, STATE "Now" empty. 5 human-operator approval cards
  pending (see Action required) plus dashboard-managed-workflows implement cards.

## Anomalies
None — no stale (>48h) `working/` cards, no skill-registry drift, preamble passing,
budget well under ceiling.
