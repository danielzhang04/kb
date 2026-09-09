# Reference pair launch packet

Purpose: test whether OmniGen2 can preserve the single canonical fictional adult reference better than the rejected prior still-image attempts. This is research evidence; neither the images nor the model become production-approved automatically.

## Final disposition

V3 completed two images at 08:16:25 UTC for an estimated $0.325452, with verified
pod termination. Root and independent visual reviews both stopped before expansion;
see the [final result](2026-09-09-omnigen2-cloud-result.md). The original launch
record below is retained as a timestamped preparation and execution snapshot.

## Historical execution record (08:05 UTC)

The user explicitly authorized the exact g01-to-owned-RunPod transfer with “Continue.” This
packet’s original proposed action is now historical. V1 failed during archive fetch before any
upload or image: 53.63 seconds, $0.019366, termination verified. V2 successfully bootstrapped,
downloaded pinned models, reached ComfyUI readiness, and uploaded exact g01, then received HTTP
400. It made zero jobs/images; a later pinned-source audit diagnosed omitted `resolution_steps`,
but the server body was not retained. It ran 340.394 seconds at $0.103064 and terminated
verified at 07:47:44 UTC.

V3 launched 07:58:29.643929 UTC on owned pod `hqvmfy3lccj8nl`, one placement, two 768 images,
and the same $1.30/60-minute bound. Its runner-readable manifest SHA-256 is
`5419590e7624a39c297f8d3761897257fd73cab6c29117d69badf1323ebac611`. It adds only node 17
`resolution_steps: 1` to the frozen source graph; provenance retains both graph records. At
08:09 UTC the provider reported 188 GB RAM, 16 vCPU, $1.09/hour and ComfyUI proxy 502. There is
no final receipt or image. Do not claim a completed cost, output quality, or completion until
finalization and verified teardown.

## Historical proposed action (V1 preparation packet)

- One RunPod Secure Cloud L40S request, one placement, two 768-square images, seeds 481516234 and 90210, no LoRA, maximum runtime60 minutes, maximum approved harness estimate$1.30 against the existing$50 arc.
- Sole local asset transfer: `payload/g01.jpg` from MAIN `_private/figment-omnigen2-cloud-preparation-20260909-v1`,737366 bytes, SHA256 `e2f5cca280b7753a0d0d562c7f23f2ee0ea5322e9a82b2ac75f76397227536ed`. Destination is this owned RunPod's ComfyUI `input/omnigen2/g01.jpg`.
- Public model files are downloaded directly by the pod at the pinned revisions/hashes. Local model files, credentials, and unrelated project files are not payload members.
- Retrieve output artifacts locally; terminate the owned pod on completion/error and verify absence through the existing harness. No Instagram action or publication.

The reviewed private V1 manifest is MAIN `_private/figment-omnigen2-cloud-preparation-20260909-v1/manifest.json`, SHA256 `82bea7beeb99ac68951d75a92b9568b9f2a7587ef99209c87095f871aedeec1e`. The actual runner-readable V3 manifest is MAIN `_private/figment-omnigen2-cloud-user-staging-20260909-v3/figment-omnigen2-cloud-preparation-20260909-v3/manifest.json`, SHA256 `5419590e7624a39c297f8d3761897257fd73cab6c29117d69badf1323ebac611`.

## Provider and cost evidence

Read-only API inventory at05:58:37UTC confirms connected, zero pods. Canonical ledger at06:05:35UTC records$37.800385 of$50, remaining$12.199615; Sep9 daily0 of$10. These are experiment accounting figures, not account credit balance.

RunPod's [L40S page](https://www.runpod.io/gpu-models/l40s), checked Sep9, advertises48GB VRAM from$1.09/hour. This is not a placement quote. V2’s observed READY rate was $1.09/hour; V3’s final rate and cost are pending. Availability and system RAM of an actual placement are not established by the marketing page.

Use the explicit canonical ledger directory `C:/Users/danie/kb/_private/codex-worktrees/figment-analysis-ops-2026-09-07/ledgers/cost` and `--arc-cap-usd 50`. Never allow an empty ledger, reset the arc, or silently raise the per-test ceiling.

## Review and next action

Independent final review returned READY after confirming graph/seed/upload integration and completing an offline harness dry run. The exact staged g01 hash and size are confirmed. The preparer overwrite/reparse-path flaw was repaired, with8 focused tests passing in the root's independent run (0.80seconds) and the reviewer's run. The actual Windows runner required a fresh exclusive payload under its own account; the V2 sandbox-created packet was unreadable to that runner. Preserve V1 and V2 packets as history. V3’s manifest carries the one-field graph adapter described above. No new local memory watcher competes with the remote experiment.

The harness verifies downloaded model hashes but does not independently attest the remote input hash or the server's queued graph hash. Preserve that limitation when interpreting receipts; it does not establish a production-grade attestation chain.

Existing user authorization covers this bounded g01-to-owned-RunPod transfer and has already
been exercised. Automatic approval previously rejected other specific project-asset exports;
do not use this provider as an alternate route around those decisions.

After execution, inspect the reference and both outputs together with an independent reviewer for same-person identity, intended adult age appearance, realism, pose/framing, and clothing integrity. Record failures honestly. Only accepted varied outputs can enter a proposed training dataset; no automatic promotion or larger retry.
