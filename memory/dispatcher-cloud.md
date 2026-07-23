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

## 2026-07-18 nightly run
- Preamble OK, pyyaml importable. `dispatch.py --tier cloud` emitted 2 cards:
  `6a5b178f-375f9872` (cadence:nightly-review) and `6a5b178f-c0723cf2` (cadence:weekly-audit,
  Saturday). BOTH stamped owner=`worker-desktop`, runtime=claude, model=sonnet.
- KEY CHANGE vs prior runs: `governance/model-routing.yaml` (human commit 1ae2d08, 2026-07-17
  04:46 — AFTER the 2026-07-17 nightly) sets runtimes.claude.default_worker=worker-desktop.
  dispatch.py now claims cloud cadences (no `agent:` key) to that default_worker. So the
  emitted cards are owned by worker-desktop, NOT dispatcher-cloud. In all prior runs the policy
  did not exist yet, so default_worker_for returned None and cards fell back to dispatcher-cloud
  ownership → the dispatcher self-executed per routines/nightly.md step 4.
- CONFLICT: routines/nightly.md step 4 still says the dispatcher self-executes emitted cards
  ("you are the owner"). CLAUDE.md forbids executing cards owned by another id / self-claiming.
  Owner is worker-desktop ≠ my id. Fail-closed: did NOT execute the two cards; left them in
  queue/inbox/ for worker-desktop; filed wake-me `6a5b182e-a5aaf9b0`
  (action wake-me:owner-routing-conflict) laying out options (a) add `agent: dispatcher-cloud`
  to the cadences, (b) update the routine to dispatch-only + confirm a desktop runner, or
  (c) adjust the routing default_worker/override. Human-owned files, so I must not self-resolve.
- Lesson: the routing policy silently changed who owns cloud-dispatched cards. Whenever a
  human-committed routing/policy file lands, re-check that the routine's execution assumptions
  ("you are the owner") still hold before self-executing. When owner != my id, never execute —
  flag and let the routed owner (or a human) act.
- Logged one cost ledger step (nightly-dispatch, usd 0.0). Committed queue/ ledgers/ memory/
  to ops.

## 2026-07-20 nightly-review (card 6a5dbb3e-295a9d2b)
- Ran clean: preamble OK, sync_skills --check exit 0 (no drift), pyyaml importable. Dispatcher
  emitted exactly one card (the nightly cadence self-card) which I owned and executed.
- Dashboards regenerated from live state: inbox 23 / working 3 / done 19 / approvals-dir 0.
  Budget $5.00 fully remaining ($0.00 today, all subscription-billed).
- WORKED: surfaced the 5 T3 human-operator approval cards (oauth-gate g1-g4 +
  governance-amendment-canaries) into the executive "Action required" section even though
  queue/approvals/ is empty — those cards sit in inbox/ with owner=human-operator and are the
  real thing blocking a human. Lesson: "Action required" isn't only queue/approvals/; scan
  inbox for owner==human-operator approve:* cards too.
- No stale working cards (oldest atlas 6a5c8ad2-1d991c23 ~21.6h). atlas V0 PAUSED awaiting live
  smoke; faceless-youtube pipeline queued under claude-boss.

## 2026-07-21 nightly-review (card 6a5f0cef-53d31df4)
- Ran clean: preamble OK, sync_skills --check exit 0 (no drift), pyyaml importable. Dispatcher
  emitted exactly one card (nightly cadence self-card), owned + executed.
- Dashboards regenerated: inbox 8 / working 4 / done 54 / approvals-dir 0. Budget: $0.94 spent
  today ($4.06 remaining) — first non-zero cost row I've seen: 7 gemini-image calls for Poyais
  thumbnail regen, ledgered under faceless-youtube. Yesterday $0.54.
- WORKED: read cost from ledgers/cost/ directly (grep + awk sum), not ledger.read_day('cost')
  — read_day returned 0 rows for today's cost kind while the tsv clearly had a row. The image
  cost rows use a different column layout than the subscription 0.0 rows; the raw-file sum is
  the trustworthy number. Lesson: cross-check ledger.read_day against the raw tsv for cost.
- ANOMALY surfaced: yesterday's nightly card 6a5dbb3e-295a9d2b sits in queue/inbox/ at
  state:done (never moved to queue/done/). Cosmetic, inflates inbox count. Noted, not "fixed"
  (didn't touch it — not in my work order).
- Action-required scan again pulled human-owned cards from inbox (4 oauth gates + the
  decide:budget-gate-measures-nothing T3 + the T2 delivery-gate flip), reaffirming last night's
  lesson that "Action required" != only queue/approvals/.
- Notable: Atlas V1 "Hands" wave COMPLETE + prod rollout (PR #44 merged, view live on :5317).

## 2026-07-22 nightly-dispatcher run
- WORKED: full nightly cycle green — preamble OK, sync_skills clean, dashboards regenerated,
  card 6a605e40 lifecycle inbox→working→done, cost step logged.
- FAILED/GOTCHA: routine step 2b `python scripts/sync_daemon_dirs.py --check` fails on the
  ops branch because that script lives only on origin/main, not ops (ops has only
  sync_skills.py). Workaround: `git show origin/main:scripts/sync_daemon_dirs.py` to a temp
  file and run that. Real drift also present (self-lint-report.md main vs ops). Filed wake-me
  card 6a605ebb-d86dff79 covering both; desktop `--sync` + a decision to mirror the script
  onto ops (or amend the routine) is owed.
- REMAINS: stale done-in-inbox cards 6a5dbb3e-295a9d2b, 6a5f0cef-53d31df4 (and now this run's
  6a605e40) sit at state:done in queue/inbox/, never swept to queue/done/. Recurring — worth a
  janitor step, but outside the nightly work order so left untouched.

## 2026-07-23 nightly-dispatcher run
- WORKED: full nightly cycle green — preamble OK, sync_skills clean, dashboards regenerated,
  card 6a61b00f lifecycle inbox→working→done, cost step logged. Quiet/healthy night; sent no
  push notification (nothing new broke; all pending items are carried-over with wake cards
  already filed — silence is correct for a "ran and all's well" run).
- RESOLVED SINCE 07-22: the daemon-dir drift on self-lint-report.md is now CLEAN
  (`sync_daemon_dirs --check` from the main copy reports ops matches main). So wake card
  6a605ebb-d86dff79 is now HALF stale — only its "missing script on ops" half still stands.
- STILL: `scripts/sync_daemon_dirs.py` exists on origin/main but not on ops; step-2b's literal
  invocation still file-not-founds on ops. Same workaround (extract from origin/main, run temp
  copy). Left for Daniel per the existing wake card — did not mirror it myself (governance/
  CLAUDE.md are human-edited; script-mirror is a desktop decision).
- REMAINS: stale done-in-inbox cards now number 3 (6a5dbb3e, 6a5f0cef, 6a605e40) — recurring;
  a janitor step to sweep state:done cards out of queue/inbox/ would help, but it's outside the
  nightly work order so left untouched again.
