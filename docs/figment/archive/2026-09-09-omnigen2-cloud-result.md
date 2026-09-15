# OmniGen2 reference pair: execution succeeded, quality rejected

The two-image V3 cloud experiment completed on September 9 at 08:16:25 UTC. Both root and the [independent reviewer](2026-09-09-omnigen2-pair-independent-review.md) rejected expanding these outputs into a six-row pilot. Reference conditioning preserves recognizable styling and broad resemblance, but the face geometry varies and the skin looks excessively smooth. This is an execution proof, not an accepted identity or dataset.

## Execution evidence

The single L40S placement reached ComfyUI readiness at08:15:24UTC after a long startup, uploaded the737366-byte fictional-adult g01 reference, then rendered seeds481516234 and90210 in31.909s and23.828s. Both PNGs are768×768. The existing harness terminated the pod and verified absence at08:16:25UTC; a separate read-only provider check confirmed absence at08:16:51UTC. Total elapsed1074.887s, estimatedcost$0.325452 at the observed$1.09/hour rate. The full arc is$38.248267/$50, leaving$11.751733. These are reconciled harness estimates, not an invoice or account balance.

Canonical private evidence is MAIN `_private/figment-omnigen2-cloud-run-20260909-v3/run.json`, the two original PNGs beside it, and `_private/figment-omnigen2-v3-output-verification.json`. Image hashes are in the independent review. The [launch packet](2026-09-09-reference-pair-launch-packet.md) preserves the manifest and source pins. V1's archive-fetch failure and V2's graph-validation failure remain immutable historical receipts; both also have verified teardown.

The post-run metadata check first failed raw graph equality, then isolated the sole difference: ComfyUI added node16 `is_changed` containing the exact g01 SHA-256. The pinned `LoadImage.IS_CHANGED` implementation computes that value from image bytes. After checking that exact value and removing only this server-generated field, each embedded graph equals the manifest's actual per-job graph, including seed, reference path, output prefix, and required resize input. This is useful server-produced provenance; no independent remote input read or cryptographic server attestation was performed.

## Root quality judgment

Both images retain long black hair, eye makeup, necklaces and adult presentation. They plausibly read as young adults, but that does not establish an exact age. The narrow jaw/face shape, altered mouth and eye appearance, and variation between the two outputs are insufficient for a stable same-person claim. Smooth skin and strong beauty rendering miss the photographic target. Both are tightly framed and largely frontal, missing the requested waist-up turn toward her own right/image-left. Seed481516234 also misses the plain crew-neck clothing instruction; both remain clothed with no observed garment exposure failure.

Disposition: preserve both as rejected research evidence, with no training eligibility, approval, checkpoint selection or production promotion. Root agrees with the independent STOP-before-pilot recommendation. The next bounded hypothesis is the materially different official Qwen conditioning assembly found in the [fallback audit](2026-09-09-reference-model-fallback-readiness.md), subject to offline construction, source-schema review and harness checks. It is not a repeat of the failed Omni pair or a claim that Qwen will solve identity.
