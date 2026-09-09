# Qwen reference launch status

As of September 9, 16:19:29 UTC, the reviewed Qwen pair has **launched**. The user explicitly approved the exact g01 upload to the connected RunPod account for two images within $1.30 and 60 minutes inside the existing $50 arc. The reviewed one-shot launcher succeeded at `2026-09-09T16:19:29.652043Z` and started child Python PID 48516. Launch evidence is MAIN `_private/figment-qwen-reference-launch-20260909-v1/launch.json`; the run root is MAIN `_private/figment-qwen-reference-run-20260909-v1`.

The first rejection said the user had authorized bounded RunPod research but had not explicitly authorized this sensitive payload to the specific destination/account. Root then performed a read-only check: the existing ambient RunPod connection returned zero pods; the new g01 bytes matched the earlier completed upload exactly; the earlier run's termination was verified; the current budget could cover the bound. The second review still required explicit approval of this reference and the currently connected account. Those checks did not clear the block.

Root then left a precise asynchronous request for permission to upload g01 to a pod in the currently connected RunPod account for two Qwen images, capped at $1.30 and 60 minutes inside the existing $50 arc. The user's later “Yes approved” answered that exact request. The two earlier automatic-review rejections remain historical evidence of why the launcher had not run before this approval.

Launch is not completion. No final receipt, image count, quality result, cost reconciliation, or verified teardown is claimed here. Root owns lifecycle monitoring, final receipt review, and provider-absence verification.

## Prepared evidence

- Local reviewed source commit: `8f8938ec`; root focused verification: five tests passed in 0.44 seconds.
- Sole reference: g01.jpg, 737,366 bytes, SHA-256 `e2f5cca280b7753a0d0d562c7f23f2ee0ea5322e9a82b2ac75f76397227536ed`.
- Actual runner-account manifest SHA-256: `48d54e9e0479eff020913bac1579d52ef02140a3ff277bac4741572922764a15`.
- Manifest under MAIN `_private/figment-qwen-reference-user-staging-20260909-v1/figment-qwen-reference-cloud-preparation-20260909-v1/manifest.json`.
- Executed one-shot launcher: MAIN `_private/launch-figment-qwen-reference-20260909-v1.py`; launch receipt MAIN `_private/figment-qwen-reference-launch-20260909-v1/launch.json`; active run root MAIN `_private/figment-qwen-reference-run-20260909-v1`.
- The launcher checks exact manifest/reference/harness hashes, the canonical ledger, an empty pod inventory, and fresh directories before spawning the unchanged bounded harness.
- Pre-launch arc $38.248267/$50; pre-launch daily provider estimate $0.447882/$10. The live harness reserves a provisional $1.30 row until final reconciliation. These are ledger estimates, not account credit or an invoice.

The graph uses one logical reference, both reference-conditioned prompt branches, the official latent method and encoded reference initialization. Expected canvas is 1392×752, two fixed seeds, 40 steps. The changed assembly is a composite research hypothesis, not a promise of identity quality. Actual outputs still require original-resolution inspection before any varied pilot or dataset decision.
