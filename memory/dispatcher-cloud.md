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

## 2026-07-16
- Ran nightly dispatch (tier: cloud). One card emitted: `cadence:nightly-review`
  (kb, T1, card `6a593421-0a5a0c92`). preamble OK; `sync_skills.py --check` exit 0, no drift.
- The flag I raised on 2026-07-15 was actioned: `governance/risk-tiers.md` now carries a
  human-authored carve-out (dated 2026-07-16) letting `cadence:nightly-review` ACT ALONE at
  T1 for any trigger — so I executed the dashboard regeneration unattended this run instead of
  escalating. The carve-out unblocks the cadence.
- BUT the carve-out's write allow-list is NARROWER than the work order + `routines/nightly.md`
  direct. In-list: `dashboards/**`, the acting agent's OWN shard `memory/<agent-id>.md`
  (= `memory/dispatcher-cloud.md` for me), `ledgers/dispatch/**`, and own-card transition +
  wake-me cards. Out-of-list writes the work order/routine ask for: (a) work-order step 4 says
  append to `memory/nightly-reviewer.md` — a DIFFERENT role's shard, explicitly excluded as
  "any other agent's memory shard"; (b) routine step 5 says log to the cost ledger
  `ledgers/cost/**` — not enumerated. "Any write outside the enumerated allow-list voids the
  carve-out" and reverts the card to queues-for-me/approvals.
- Decision: stay strictly inside the allow-list. Wrote lessons to my OWN shard (this file),
  NOT `nightly-reviewer.md`; did NOT write the cost ledger. Regenerated both dashboards,
  transitioned my own card to done, and filed a wake-me card in `queue/inbox/` describing the
  mismatch. This preserves acting-alone authorization AND delivers the dashboards, versus
  either voiding the carve-out (whole card back to approvals — regressing to the stuck state
  the carve-out was created to fix) or silently violating governance by doing the out-of-list writes.
- Lesson: when a work order/routine directs writes beyond a carve-out's allow-list, the
  allow-list is binding and wins; do the in-list work, skip+flag the rest via wake-me. Do not
  assume `memory/nightly-reviewer.md` is "my" shard — `<agent-id>` is the acting agent
  (dispatcher-cloud), and role journals are separate, excluded shards.

## Run 2026-07-16 (nightly)
- Preamble OK, pyyaml importable. `dispatch.py --tier cloud` emitted 0 cards → no work orders,
  no approvals to verify this run.
- Logged one ledger step (nightly-dispatch, usd 0.0). Committed only ledgers/; direct push to
  ops succeeded (DIRECT-PUSH path, no branch restriction hit this run).
- Quiet run: nothing actionable, so no wake-me card.

## 2026-07-17 nightly run
- Preamble OK, pyyaml importable. `dispatch.py --tier cloud` emitted 1 card
  (`6a59c5fb-606586f8`, cadence:nightly-review) — executed its work order directly.
- `sync_skills.py --check` exit 0 (no drift); regenerated both dashboards from live state
  (queue: 1 working / 4 done, approvals empty; cost $0 of $5; 3 orgs idle).
- Prior executive.md carried rich PR history (waves/dashboard PRs) not reconstructable from
  live state alone — dashboard-generator says rebuild from queue+ledger+STATE, so I wrote a
  current-state-grounded version rather than carrying forward unverifiable claims.
- No approvals to verify this run; no wake-me needed.
