# OmniGen2 admission validation review — 2026-09-08

Root accepts the read-only admission validator. It verifies the real local model, reference, code, workflow and ComfyUI state before a separately reviewed controller may execute. It creates no admission, launches no GPU job and grants no image-quality or commercial-use approval.

`expand/local_omnigen2_admission.py` SHA-256 is `313b5b1269f738035f0ba9e979f9d748a0aecf02b48863fab90ed3110e7e7e51`. Its fixed paths identify one two-seed experiment. Strict JSON and full canonical reconstruction reject modified admissions even when an attacker recomputes their self-hashes. The validator loads the planner and preparer only from hash-checked source bytes. Dynamic controller, observer, engine and validator hashes must equal the root-created admission on every validation.

The model inventory is exactly three regular files in three fixed directories plus the preparation receipt. The verifier hashes each weight in chunks of at most 1 MiB; source, model and reference paths reject reparse ancestors and file identity changes. Source snapshots and installed ComfyUI inspection run before and after the long reads. The exact reviewed four-file untracked inventory is required; this does not claim to audit ignored dependency files or all installed packages.

Root verification:

- The initial suite had 12 passes and 24 failures because fixture template/doc bytes contradicted the real copied planner's pins. The fixtures now copy the actual small template and documents while retaining small test weights and synthetic reference pixels. Production cross-checks were preserved.
- The repaired 41-case suite passed in 6.81 seconds. After pinning the actual untracked inventory, 40 cases passed and one stale expected fixture value failed; correcting that value made its focused rerun pass in 0.59 seconds. Extra and missing untracked entries are tested.
- A 32 MiB streaming-hash test verified peak traced allocation below 4 MiB, and a separate test prevents `hash_file` from calling the byte-retaining reader.
- Actual read-only evidence verification completed in 34.517 seconds over all **15,779,025,788 model bytes**, with peak traced Python allocation **8,326,954 bytes** for the entire evidence operation. This is Python allocation telemetry, not total process or system memory. Reference, code, template, documents, prepared receipt, exact Comfy commit and four-file untracked inventory all verified. No admission or GPU run was created.

The actual evidence is preserved at MAIN `_private/figment-omnigen-evidence-preflight-20260908-v1`. Its canonical evidence SHA is `a9ad8c7d44a9511873a84dbcb2e7a5b625fa03c5901998893ea4f1c687949844`; `result.json` records duration, allocation peak and every code hash. It binds controller source `66b3739336bc6379bb5b34f7c8e88cc5e1f9bb19bbb8da80b33fc5140d76a7b4`, which was still under review. Later controller corrections require fresh evidence; this snapshot must not be silently relabeled as the final admission.

Actual Fable 5.1 authored and repaired the validator. Actual Opus 5 reviewed its full repaired source and tests. Root accepted the suggestion to constrain untracked inventory, using the four files in the actual preparation receipt. The review's assertion that custom nodes necessarily execute did not account for the engine's disabled-custom-node flag, and its suggested settings-file inventory came from a test fixture rather than the installed state. Those claims were not adopted. The exact inventory check was still a useful addition to the fixed experiment. Critical-file verification remains owned by the already pinned preparer, which checks the actual seven file hashes.

The most consequential root finding was the first implementation's whole-model byte retention. It would have allocated multiple gigabytes before resource monitoring began. Streaming fixed that behavior; the measured real verification confirms the correction. A passing small fixture alone would not have exposed it.

Remaining controller review, hardware preflight and explicit one-run admission are separate steps. Research-only licensing and unresolved identity consistency remain unchanged.

## Controller accepted after review

Actual Opus 5 subsequently returned READY for the thin controller and its tests. Root removed an unreachable PNG-reader fallback, clarified when an engine-owned failure receipt exists, and separated the planner's declared `manifest_sha256` from `manifest_record_sha256` of the whole stored record. The final 18 controller tests passed in 0.75 seconds, including distinct assertions for those two digests. Accepted controller SHA is `9ed5aa16aeecb86edecf390f57166bbe0447f1c2e35c121a4e68157f62569300`; its bootstrap binds the accepted admission source above.

Root retained failure on invalid PNG bytes once Comfy reports a completed output. The reviewed local `SaveImage` calls `img.save` before appending the output record and returning it; treating a corrupt reported output as a pending write would weaken the check. The output bound remains three directory entries because it includes the mandatory empty `loras` directory alongside two PNGs. Reparse checks continue through every ancestor. These decisions reject optional review suggestions that did not match the actual execution path.

The first root admission-preparation check stopped before evidence gathering because available RAM was below the 12 GiB floor. No run root, admission, or GPU process was created. That is a resource-readiness observation, not a failed image experiment. Further preparation must use fresh resource observations while preserving this failed diagnostic.
