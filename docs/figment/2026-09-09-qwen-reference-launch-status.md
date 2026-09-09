# Qwen reference launch status

The reviewed Qwen pair is **complete and rejected for expansion**. It launched at `2026-09-09T16:19:29.652043Z`, finished at `2026-09-09T16:48:42Z`, and produced two verified 1392×752 PNGs. Termination was verified, and root's independent read-only provider inventory returned zero pods at `2026-09-09T16:50:06Z`. Estimated actual cost was $0.530662, bringing the Figment arc to $38.778929/$50 and the September 9 provider estimate to $0.978544.

The first rejection said the user had authorized bounded RunPod research but had not explicitly authorized this sensitive payload to the specific destination/account. Root then performed a read-only check: the existing ambient RunPod connection returned zero pods; the new g01 bytes matched the earlier completed upload exactly; the earlier run's termination was verified; the current budget could cover the bound. The second review still required explicit approval of this reference and the currently connected account. Those checks did not clear the block.

Root then left a precise asynchronous request for permission to upload g01 to a pod in the currently connected RunPod account for two Qwen images, capped at $1.30 and 60 minutes inside the existing $50 arc. The user's later “Yes approved” answered that exact request. The two earlier automatic-review rejections remain historical evidence of why the launcher had not run before this approval.

Root and independent original-resolution reviews both recorded STOP before the six-row pilot. The completed receipt and images do not establish dataset eligibility, a production identity, or a promoted LoRA. See the [root result](2026-09-09-qwen-reference-cloud-result.md) and [independent review](2026-09-09-qwen-reference-pair-independent-review.md).

## Prepared evidence

- Local reviewed source commit: `8f8938ec`; root focused verification: five tests passed in 0.44 seconds.
- Sole reference: g01.jpg, 737,366 bytes, SHA-256 `e2f5cca280b7753a0d0d562c7f23f2ee0ea5322e9a82b2ac75f76397227536ed`.
- Actual runner-account manifest SHA-256: `48d54e9e0479eff020913bac1579d52ef02140a3ff277bac4741572922764a15`.
- Manifest under MAIN `_private/figment-qwen-reference-user-staging-20260909-v1/figment-qwen-reference-cloud-preparation-20260909-v1/manifest.json`.
- Executed one-shot launcher: MAIN `_private/launch-figment-qwen-reference-20260909-v1.py`; launch receipt MAIN `_private/figment-qwen-reference-launch-20260909-v1/launch.json`; final run root MAIN `_private/figment-qwen-reference-run-20260909-v1`.
- The launcher checks exact manifest/reference/harness hashes, the canonical ledger, an empty pod inventory, and fresh directories before spawning the unchanged bounded harness.
- Pre-launch arc was $38.248267/$50 and the pre-launch daily provider estimate was $0.447882/$10. The final measured estimate replaced the provisional reservation with $0.530662. These are ledger estimates, not account credit or an invoice.

The graph used one logical reference, both reference-conditioned prompt branches, the official latent method and encoded reference initialization. It ran at 1392×752 with two fixed seeds and 40 steps. The changed assembly was a composite research hypothesis; both reviews stopped it for identity, realism, and composition shortcomings.
