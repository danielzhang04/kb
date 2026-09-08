# Architecture and operations

The hub should make state visible without hiding the gates. The first read-only implementation has Creators for persona metadata, Runs & review for receipts and evidence state, and Research for source metadata. Generation controls, original-asset review, and decision-writing remain later integrations; Instagram integration remains deferred.

Every run has an immutable manifest, an intent, an acquired resource ID, a receipt, output hashes, and a teardown record. The recovery path must persist the acquired ID before optional provider metadata parsing, refuse foreign or ambiguous resources, and verify absence independently. The timestamp correction's regression checks establish parser behavior. Separately, the completed retry followed that repair; its journal recorded the acquired ID and its teardown verified absence. The code/tests establish error-path behavior, while the successful retry supplies only live lifecycle evidence in [the live report](../2026-09-08-live-tester.md).

Budgeting has two layers: the configured daily limit and the experiment's arc cap. Numeric ledger rows are summed; missing native telemetry is represented by a metadata shard without a `usd` column so the harness skips it, while the unknown amount remains explicitly unknown. Blank numeric fields are invalid. Estimates are labeled as estimates and reconciled separately from invoices.

| Evidence/status | What it establishes | Limitation |
|---|---|---|
| Package evidence | Modules supply an anchor-to-output workflow chain and checkpoint comparison tools. | They do not establish a hosted creator controller, durable approval ledger or account-management API. |
| Current code | Approval lineage, recovery, receipts, hashes, and bounded execution are implemented. | The new read-only hub is undergoing integration review; no deployment or generation control is proven. |
| Live proof | The corrected retry completed, all five jobs succeeded, and both pods were absent afterward. The later paired diagnostic completed ten image jobs under a non-promotable protocol. | Lifecycle and bounded execution do not resolve visual disagreement or promote a checkpoint. |
| Hypothesis | A visible state machine will reduce accidental reruns and stale approvals. | Needs operator use and review. |

Decisions: keep lifecycle states explicit (`planned`, `running`, `ready`, `uploaded`, `generated`, `reviewed`, `accepted`, `rejected`, `teardown-verified`), attach evidence to each transition, and let only a human promote. Next tests: fresh-checkout recovery, stale-decision invalidation, and a two-person review of a held-out comparison. The hub should expose source dates, limitations, cost estimate, and provenance beside every decision.
