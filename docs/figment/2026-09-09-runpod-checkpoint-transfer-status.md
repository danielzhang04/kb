# RunPod checkpoint transfer status

Recorded 2026-09-09 at the final V3 launch attempt. The attempted launch was rejected before the tool created a shell process. Root subsequently verified both `V3/launch` and `V3/compiled/run` are absent. No diagnostic pod, upload, output or cost row was created.

The reviewed ten-image preparation remains at `MAIN/_private/figment-builtin-heldout-control-20260909-v3/compiled/preparation.json`, SHA `88fe538e0cb33ec137efb6eeefac8a36d0112790d4e18f38e1b7fa80a1740cf8`. Independent code review is READY at committed source `f6f646e8`; actual native dry-run passed. Fresh preflight at 23:55:52 UTC verified all inputs, zero pods, arc $29.940724/$50 and local-governance-day spend $5.046053/$10. This preflight is now historical and cannot authorize a later launch without fresh checks.

Automatic approval review's stated reason was that general RunPod compute authorization did not specifically authorize export of the private LoRA checkpoint, which contains information learned from local reference data, to RunPod. It explicitly prohibited bypass or indirect execution. No retry or reroute occurred.

The exact pending question asks whether the user approves uploading `creator001krea2.safetensors`, SHA `070b0e639e68babaf7a650c0ac7e1b460a53ef8aca1fda7bfd73057e680cb9a0`, to one RunPod pod for ten clothed diagnostic images, capped at $2.50 / 115 minutes. Until an explicit answer arrives, that checkpoint transfer remains blocked. This question is separate from the earlier blocked external-Codex g01 self-comparison; neither approval implies the other.

Independent work continues. A bounded worker is preparing one public-base-only control at seed 1595 using the same public model pins, prompt and settings as the already-local final tester image. Its exported manifest must contain no reference images, LoRA checkpoint, private paths, uploads or LoRA loader. This is a safer independent control, not a substitute route for exporting blocked data. It tests only one matched condition, not the full five-seed comparison. It still requires code/artifact review, a native dry run, fresh budget/inventory checks and ordinary teardown before any live run.

The actual all-cull review was applied successfully at 23:50 UTC: five parked rows, no approval files, rejection lineage SHA `da60f6bef193f8be8bd31af63af3712e021ad729b03bcbf0d5d44371fa56261a`. Root's promising observations and independent rejection are both preserved; no checkpoint is selected.

A first preflight also stopped locally before its API read because root initially used Studio's raw harness byte hash for REVIEW. The Git blob matched, and a direct normalized-byte comparison proved CRLF/LF was the only difference. The successful preflight pins REVIEW's actual harness SHA `184535681d50b9e6e352a7f920b08154129fb799491f48f099a049999e8fc1de`; the harness implementation was not changed.
