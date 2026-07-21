# Proposal: document `execution-controller` in `governance/card-schema.md`

Status: REQUESTED (human governance edit)
Raised by: Wave A activation build (T3), 2026-07-20
Decision reference: plan `docs/plans/2026-07-20-wave-a-activation.md` §D6

## Why this is a proposal, not an edit

`governance/` and `CLAUDE.md` are **human-edited only** (constitution, "Branch rules"). This build
must not touch them. This note requests the edit and states exactly what to add, so a human can apply
it verbatim.

## The gap

The card frontmatter field `execution-controller` is **load-bearing but undocumented**. It is the sole
arbiter of the double-execution guard between the two executors:

- `scripts/agent_runner.ps1` (step 6) claims a card iff
  `execution-controller != "dashboard"` AND `owner == <agent>` AND `state ∈ {inbox, working}`.
- The Wave-A queue→engine bridge (`dashboard/server/control/queueBridge.ts#bridgeClaimsCard` /
  `scripts/queue_bridge_select.py#claims_card`) claims a card iff
  `execution-controller == "dashboard"` (the exact literal) AND `owner == <dashboard subject>` AND
  `state ∈ {inbox, working}`.

These two predicates PARTITION the owner/state-matched card space with no overlap and no gap: an
absent/null controller belongs to the legacy runner, the literal `"dashboard"` belongs to the governed
engine. If a card were ever claimed by both, it would be executed twice. The field that prevents this is
absent from `governance/card-schema.md` (verified 2026-07-20), so a schema reader has no way to know it
exists or that its value is a hard routing boundary.

## Requested edit (verbatim)

Add to the field table / frontmatter section of `governance/card-schema.md`:

> - `execution-controller`: `dashboard` \| _null_ (default/absent). Routing boundary between the two
>   executors and the double-execution guard. Absent or null ⇒ the legacy `scripts/agent_runner.ps1`
>   runtime runner owns the card. The exact literal `dashboard` ⇒ the governed dashboard control plane
>   (`dashboard/server/control/queueBridge.ts`) owns it; no other executor may claim it. Set by the
>   dispatcher/control-plane server-side only — never parsed from untrusted card body text (same rule as
>   `action`/`target`/`risk-tier`). The comparison is an exact string equality on both sides; any value
>   other than `dashboard` is treated as "not dashboard".

## Verification anchors (for the human applying the edit)

- ps1 predicate: `scripts/agent_runner.ps1`, step 6 owner scan (`execution-controller != "dashboard"`).
- bridge predicate: `scripts/queue_bridge_select.py#claims_card`,
  `dashboard/server/control/queueBridge.ts#bridgeClaimsCard`.
- partition test (no overlap/gap): `tests/test_queue_bridge_select.py`,
  `dashboard/server/control/queueBridge.test.ts`.
- canonical minting also stamps `execution-controller: dashboard`:
  `dashboard/server/write/workflowRun.ts` (`publishBlocked`) and
  `dashboard/server/control/canonicalResultIntegrator.ts` (identity checks).
