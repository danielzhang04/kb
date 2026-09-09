# Reference pair launch packet

Purpose: test whether OmniGen2 can preserve the single canonical fictional adult reference better than the rejected prior still-image attempts. This is research evidence; neither the images nor the model become production-approved automatically.

## Exact action

- One RunPod Secure Cloud L40S request, one placement, two 768-square images, seeds 481516234 and 90210, no LoRA, maximum runtime60 minutes, maximum approved harness estimate$1.30 against the existing$50 arc.
- Sole local asset transfer: `payload/g01.jpg` from MAIN `_private/figment-omnigen2-cloud-preparation-20260909-v1`,737366 bytes, SHA256 `e2f5cca280b7753a0d0d562c7f23f2ee0ea5322e9a82b2ac75f76397227536ed`. Destination is this owned RunPod's ComfyUI `input/omnigen2/g01.jpg`.
- Public model files are downloaded directly by the pod at the pinned revisions/hashes. Local model files, credentials, and unrelated project files are not payload members.
- Retrieve output artifacts locally; terminate the owned pod on completion/error and verify absence through the existing harness. No Instagram action or publication.

The reviewed private manifest is MAIN `_private/figment-omnigen2-cloud-preparation-20260909-v1/manifest.json`, SHA256 `82bea7beeb99ac68951d75a92b9568b9f2a7587ef99209c87095f871aedeec1e`.

## Provider and cost evidence

Read-only API inventory at05:58:37UTC confirms connected, zero pods. Canonical ledger at06:05:35UTC records$37.800385 of$50, remaining$12.199615; Sep9 daily0 of$10. These are experiment accounting figures, not account credit balance.

RunPod's [L40S page](https://www.runpod.io/gpu-models/l40s), checked Sep9, advertises48GB VRAM from$1.09/hour. This is not a placement quote. The manifest retains its conservative historical$1.30/hour estimate and the existing harness checks the actual READY pod rate against the approved ceiling. Availability and system RAM of an actual placement are not established by the marketing page. No paid placement has occurred.

Use the explicit canonical ledger directory `C:/Users/danie/kb/_private/codex-worktrees/figment-analysis-ops-2026-09-07/ledgers/cost` and `--arc-cap-usd 50`. Never allow an empty ledger, reset the arc, or silently raise the per-test ceiling.

## Review and next action

Independent final review returned READY after confirming graph/seed/upload integration and completing an offline harness dry run. The exact staged g01 hash and size are confirmed. The preparer overwrite/reparse-path flaw was repaired, with8 focused tests passing in the root's independent run (0.80seconds) and the reviewer's run. Existing reviewed v1 bytes are preserved and canonically match the current builder plus prepared-payload metadata. No new local memory watcher will compete with the remote experiment; the old watcher ended before admission with zero executions.

The harness verifies downloaded model hashes but does not independently attest the remote input hash or the server's queued graph hash. Preserve that limitation when interpreting receipts; it does not establish a production-grade attestation chain.

Existing user authorization covers bounded paid compute. Automatic approval previously rejected specific project-asset exports; do not use this provider as an alternate route around that decision. Explicit authorization for the exact g01-to-owned-RunPod transfer above remains the final user-dependent action after preparation review completes.

After execution, inspect the reference and both outputs together with an independent reviewer for same-person identity, intended adult age appearance, realism, pose/framing, and clothing integrity. Record failures honestly. Only accepted varied outputs can enter a proposed training dataset; no automatic promotion or larger retry.
