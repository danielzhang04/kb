# Existing candidate: evaluation preflight

Read-only local verification on September 8 found all five checkpoints from the
successful September 7 training run. No retraining or new paid job was launched.
These are trained candidates, not approved models. The source dataset was selected
with numerical filters; its old ready marker does not establish operator curation.

Source directory on this machine:
`C:/Users/danie/kb-worktrees/figment/orgs/figment/runs/c001-tf2/train/runs/out/creator-001-tensor-train-first`.
The source receipt names pod `fn938tol6mgbtp`, records training from
`2026-09-07T09:15:24+00:00` to `2026-09-07T11:36:54+00:00`, and records verified
termination. Local file lengths match all five artifact lengths in that receipt.
Hashes below were computed from the files during this preflight; the old receipt
does not itself contain these hashes.

| Step | File | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| 250 | creator001krea2_000000250.safetensors | 228587792 | f07c7e4d01637c20992997ca1ab745aaed7ed504e815ca11452c23c9c48e18f1 |
| 500 | creator001krea2_000000500.safetensors | 228587792 | c9e0c41960fbffea027772bb09555ad4ea636f699e16c68316d772d53f2ebb8c |
| 750 | creator001krea2_000000750.safetensors | 228587792 | 1c37a1fd02b15fe687c07aefc598b4cdd7a00a1372c3838adde7c3156d4038ee |
| 1000 | creator001krea2_000001000.safetensors | 228587800 | b33301b32121bee5711b9b20fb1bcb72851da03e02c4e9d75fc18cea9b1d6b68 |
| 1250 | creator001krea2.safetensors | 228587800 | e1da52fbec917794d5dfccc99dbd7bdc48921efd955e9f4be6da065df54596b0 |

The plan records Krea2, trigger `creator001krea2`, 1,250 steps, save every 250,
provided captions, and differential output preservation enabled at multiplier 1.0
with class `woman`. The `c001-tf3` and `c001-tf4` training receipts are copies of
this same pod run; do not count them as additional training experiments or costs.

The last fixed tester manifest (`c001-tf4`) has five jobs, one per checkpoint, with
seed 1595. Its configured ceiling is $2.50 and 115 minutes. This is a diagnostic
ladder, not a held-out quality study. Its old absolute CLI paths and glob upload are
historical evidence, not a command to replay into an existing output directory.

The next experiment should first establish valid trigger invocation on this ladder,
then compare a selected candidate against an unchanged control with frozen held-out
prompts and seeds. Show raw and finished images separately. Operator review owns
identity, apparent adulthood, clothing integrity, gloss/texture, and final selection;
machine scores are filtering evidence. No checkpoint is selected in this document.

Historical costs were independently summed with decimal arithmetic:

| Local ledger | Rows | Recorded estimate USD |
| --- | ---: | ---: |
| figment-2026-09-02.tsv | 15 | 1.972622 |
| figment-2026-09-03.tsv | 17 | 5.181765 |
| figment-2026-09-04.tsv | 13 | 6.316118 |
| figment-2026-09-06.tsv | 4 | 2.822600 |
| figment-2026-09-07.tsv | 7 | 19.397146 |
| Total | 56 | 35.690251 |

This includes $16.025 of explicit orphan estimates. It is not a provider invoice
reconciliation. At the recorded estimate, $14.309749 remains against the existing
$50 arc cap, subject to provider reconciliation and any later ledger activity.
Fresh code worktrees lack some of these historical shards, so their local ledger
alone must not be used to authorize a run. A dry-run placeholder row is not spend.

The configured Python 3.13.7 runtime has `requests`; the default Python 3.12 runtime
does not. A read-only call using Python 3.13, the original harness client, and its
ambient authorization succeeded on September 8. The provider list contained zero
pods; GETs for `pmi9y2gsoaxkea` and `hvtovmusbx6a1t` each returned 404, independently
confirming their current absence. The earlier standard-library HTTP 403 did not
establish the availability of this configured client. No credential store was read.

All five historical shards in the ops proposal were compared as parsed TSV rows
with the original worktree and match exactly. Keep the conservative orphan estimates
in the budget. A $2.50 tester ceiling would
bring the recorded arc ceiling to $38.190251, below $50, before any later activity.

A subsequent read-only [provider billing API](https://docs.runpod.io/api-reference/billing/GET/billing/pods)
query for September 1 through the query time, grouped by pod ID and day, returned
records for all 53 real pod IDs named in the local ledgers. The 56 matched billing
rows sum to $22.9947359941215834977. The local estimate remains the spend guard;
this observation does not rewrite run receipts or double-book provider charges.
Filtered evidence is in `ledgers/audit/figment-provider-2026-09-08.json`
in the ops proposal, with the original local copy under the main workspace's
`_private/figment-provider-reconciliation-20260908.json`. Unrelated account records
were not retained.

| Historical attempt | Provider-reported USD |
| --- | ---: |
| Training fn938tol6mgbtp | 2.661973272683099 |
| No-trigger tester idb1hskq79h4l3 | 0.3053083874983713 |
| Interrupted tester pmi9y2gsoaxkea | 0.40566559694707394 |
| Interrupted tester hvtovmusbx6a1t | 3.22720715636387448 |

These are API-reported charges as of the query, not a claim that provider billing
can never adjust. Raw estimates and later billing observations are distinct facts.

Outstanding live prerequisites: reviewed recovery implementation and an isolated
bounded tester manifest, with daily and arc guards rechecked immediately before launch.
The old failed receipts remain unchanged; a recovery receipt must record subsequent
facts without rewriting their original failures. Generic paid-compute permission
was already granted by the operator and does not need to be requested again.
