# memory: dispatcher-cloud

## 2026-07-15
- Ran nightly dispatch (tier: cloud). One card emitted: `cadence:nightly-review`
  (kb, T1). preamble + `sync_skills.py --check` both clean.
- Did NOT execute the card's dashboard-regeneration work order. `governance/risk-tiers.md`
  is unambiguous ("Wording is binding"): "v1: ALL task types start supervised
  (queues-for-me) regardless of tier." `ledgers/grades/` is empty (no task type has
  earned its 10-pass promotion yet), so this still applies even though the card's
  own risk-tier (T1) and the `dashboard-generator` skill's self-description
  ("this is a T1 acts-alone task") suggest otherwise — those describe the
  target end-state, not the current bootstrap phase. Filed the card into
  `queue/approvals/` instead of running it, per routine step 4 (queues-for-me
  items get an approval card, not execution).
- Lesson for future runs: don't trust a skill's or a HEARTBEAT cadence's own
  tier label at face value — cross-check `governance/risk-tiers.md` and
  `ledgers/grades/` before treating any task as acts-alone while v1's blanket
  supervised policy is still in effect. Worth flagging to a human: either
  amend risk-tiers.md to carve out dashboard-regen, or expect every nightly
  run to keep landing in approvals/ until that's resolved.
