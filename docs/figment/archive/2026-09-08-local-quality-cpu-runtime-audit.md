# Local quality CPU runtime audit — 2026-09-08

## Scope and outcome

This is a read-only audit of two completed CPU parser runs for the separately
frozen one-source quality diagnostic: the `current` caption branch and the
`concise` caption branch. It records parsing and bounded process-cleanup
evidence only. It does not admit GPU training, load a model for fitting, create
a checkpoint, render a sample, accept a LoRA, or change the one-observation
limit.

Both launch receipts have `status: complete`, parser exit code zero, and
`verified_stopped: true` with no unresolved processes. Their parser results are
CPU-only: `CUDA_VISIBLE_DEVICES=-1`, CUDA unavailable, zero CUDA devices, and
no CUDA initialization. Each found one source image, one unique source image,
one repeat, target resolution 768×768, and the effective 896×512 bucket.

This is preparation evidence for the two exact quality plans. It does not show
that either planned 100-step GPU fit will complete or that a resulting LoRA is
useful. The plans themselves retain `gpu_quality_allowed: false`,
`checkpoint_acceptance_allowed: false`, `sample_export_allowed: false`, and
`not_promotable: true` pending a separate hash-bound admission.

## Receipts and frozen bindings

`MAIN_PRIVATE` below denotes the configured private evidence root and
`STUDIO_PRIVATE` the Studio worktree's configured private evidence root. No
private filesystem location is a product or training input claim.

| Branch | Receipt raw SHA-256 | Plan raw / canonical SHA-256 | CPU duration | Receipt process evidence |
| --- | --- | --- | ---: | --- |
| current | `adf88bf630773f65e4c42976b4b2ea326c103020fd23ca5670588369e20d11c7` | `9f2246e727d992aab12ffdc1f256dde17487887b1dd108cbe5dc7fa770441b58` / `7cbc717c23100fb2d3542126babe01971f28fc3133674a1133bac9c6f2e24df5` | 6.986 s | process and wrapper PID 17328, recorded terminated |
| concise | `1f95f536bf2125d77cad171733d35905d0e7e3d8d1112cf8678d297a2b8d12c1` | `4fbbefbbdb9bf4883454be65e197716f559e29192843a2a4376c2c29790fb8d0` / `7a1f69fbf282fd0c7e874abf3d8ed45c7762d504cc7ee88d8c5efa19f785ce49` | 5.809 s | receipt process and wrapper PID 36380, recorded terminated; PID 28872, parent 36380, recorded already exited |

The final audit-time targeted process query, at
2026-09-08T13:30:47-04:00, returned no process objects for 17328, 28872, or
36380. This is a later absence observation for those numeric PIDs. It is not a
reconstruction of all process history and does not establish protection against
future PID reuse.

The two plans bind the same sole original `g01.jpg`: SHA-256
`e2f5cca280b7753a0d0d562c7f23f2ee0ea5322e9a82b2ac75f76397227536ed`,
737,366 bytes, 1408×768. Each plan declares one canonical-original-pixels
observation and one independent view. Their staged JPEG rehashes match that
same digest. The only staged data difference is the caption file: current is
331 bytes with SHA-256
`de34cde35290689f8b167bbfc2aa96cc79abf61db64e0e87a4e404719209c569`;
concise is 253 bytes with SHA-256
`677ccf120d7bea1ed9871dda7df51b096fbc65ef6aff3e0a38997d4fc60d7911`.

Both staged `local-quality.toml` files are 1,094 bytes with SHA-256
`3a29713ac392a6ebdbb844abc161e8f50378f33aa3407a00b4d9e614ba3affcf`.
They declare the fixed 100-step recipe, saving every ten steps with state saves
and sampling disabled. Each plan therefore carries the same eleven-file
checkpoint allowlist: periodic steps 10 through 100 and a final 100-step file.
This describes the later GPU quality experiment; neither CPU receipt created
any of those files.

The code digests in both receipts were independently rehashed at audit time:

| Bound source | SHA-256 |
| --- | --- |
| quality CPU parser | `9fa05358432cfecb4ccd6fdca000b2f9e8fc9ec8f0c3f2d812e8599d5268a96f` |
| quality-plan builder | `22965674bbe9f97205c6f631e1c39316c6709c4b6f5c40ac429e7393e9f68525` |
| accepted one-observation planner | `3fe3f1be0567da14b1be477724cc8a7ff8820e603a9e8efa1116f00b9296b094` |
| accepted CPU helper | `24317914b2a05790bcf887ab4941f67d623d2c18e73218f019d4f962a173336e` |
| ownership helper | `2997ba3185aabfb146b13f38d18c854615a7190064d30f14037570398bea7bac` |
| quality CPU launcher | `e890b68d64912e395dbfc3a3ef6e4f2719bcfe9ac1ec4d87a91c87a1ab8d43c4` |
| pinned `sdxl_train_network.py` source | `a0e415533fd9e39ad41d3fafeecc76794f97f612143cc3d356b7c0f70e8466be` |

## Parser and log evidence

The receipt log hashes were recomputed and match their recorded values:

| Branch | stdout SHA-256 | stderr SHA-256 |
| --- | --- | --- |
| current | `2d87ce06a666230e7ddcbd5fcea73f6004a3ccf0a1fb11ff71b025fb920ebcca` | `06588f32f83ed34d56ab42a0022c13876125eded940699fea95b204e6385837d` |
| concise | `5d8908afd255806de2dbf162c7d3bf231bdffa4d4389161d2f7db948a5a5d060` | `488c623927f1e6d735db4ad99e543cfa14761797ff42635e725d74b00a096576` |

Each bounded stdout record agrees with its receipt's branch-specific canonical
plan hash, caption, source/repeat counts, and CPU mask state. Each stderr log
reports discovery of one image, one repeat, no regularization images, and an
896×512 bucket. The stderr records an ordinary Transformers cache deprecation
warning and a missing Triton flop-counter warning; neither is a successful
model fit or a GPU availability claim.

## Relationship to the next controlled experiment

The frozen plan is the CPU gate for the quality schedule documented in the
[local quality-runner plan](2026-09-08-local-quality-runner-plan.md) and its
controlled caption comparison in the [one-source quality experiment](2026-09-08-one-source-quality-experiment.md).
It is distinct from the completed ten-step availability evidence in the
[local LoRA fit runtime audit](2026-09-08-local-lora-fit-runtime-audit.md) and
the earlier [local training preflight audit](2026-09-08-local-training-preflight-audit.md).

Before any GPU action, a later executor must bind the applicable raw CPU
receipt, canonical plan hash, staged inputs, source hashes, launcher and helper
hashes, and a fresh admission. Any GPU outcome still requires the separate
checkpoint validation and paired visual diagnostic protocol. Nothing in these
two CPU records resolves realism, reference resemblance, batch identity,
apparent age, clothing, quality, or production eligibility.
