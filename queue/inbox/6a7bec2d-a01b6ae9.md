---
id: 6a7bec2d-a01b6ae9
project: kb-ops
action: report:acceptance-p0-launch
target: orgs/kb-ops/output
risk-tier: T1
owner: dashboard-engine
claim-token: null
state: inbox
approval: null
workflow: null
depends-on: []
variant-group: null
role: work
session-id: null
runtime: null
model: null
execution-controller: dashboard
profile: scanner
workflow-def: acceptance-run
---

## Work order

Launch the registered `kb-ops` workflow definition `acceptance-run`
(`orgs/kb-ops/workflows/acceptance-run.md`) via the dashboard queue bridge (W7 def-card path).

This card's own body is advisory only — the queue bridge reads `workflow-def` and the card's meta,
maps this card to that definition, and drives its three stages (`draft` -> `revise` -> `signoff`)
under their own per-stage `workOrder`s. This card carries no `parameters` because `acceptance-run`
declares none.

This is the GATED rerun: the definition now declares two approval humanGates (`g1-review-draft`
blocking stage `revise`, `g2-review-revise` blocking stage `signoff`), so the run must park twice
for the operator. Purpose: the full P0 live-fire evidence — stage chaining, both gates answered
from the dashboard (run tab and Inbox), run visible in the Workflows graph, per-stage output under
`orgs/kb-ops/output/`. See `docs/superpowers/specs/2026-08-11-workflow-platform-design.md` Phase 0
for the acceptance criteria this run exists to satisfy.

## Evidence

(none — this card originates the run; it carries no external/untrusted input)
