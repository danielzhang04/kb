# Local SDXL LoRA fit-probe launcher design - 2026-09-08

## Scope and decision boundary

This is a design for one local, no-more-than-ten-step GPU **fit probe**. Its
only useful success signal is that the fixed local stack reached the final
training step and produced one bounded local checkpoint under controlled
ownership. It cannot establish useful training, resemblance, identity, quality,
training eligibility, or an export decision.

The existing one-observation planner and CPU preflight are the starting point:
`local_single_observation.py` snapshots exactly canonical `g01.jpg`, one
persona-derived caption, and `fit-probe.toml`; the CPU preflight verifies the
snapshot and asks sd-scripts to parse it without CUDA. The current plan sets
`gpu_fit_probe_allowed: false`. A future GPU run must therefore require a
**fresh parent admission** bound to that unchanged plan and its CPU receipt; it
must not alter a frozen CPU plan in place or treat a CPU receipt as GPU
permission.

The current planning evidence is the frozen plan
`e9de0980ae27f8fb1e98398a685f81a18bdb6dd27e70d07ec4dff38d2aac75ea` under
`_private/local-lora-single-observation-20260908-v1/`. It remains planning
evidence only; its CPU admission does not open a GPU execution path.

## Fixed input and runtime admission

Before a subprocess is created, a future launcher should require all of the
following in one fresh private run directory, for example
`_private/figment-local-lora-fit-probe-<fresh-id>/`:

1. A self-hashed planner plan naming one `creator-001` observation only. It must
   bind the original JPEG hash, bytes, dimensions, exact staged `g01.jpg` and
   `g01.txt` hashes, persona hash, caption, and the copied probe TOML hash.
2. A fresh `figment/local-cpu-preflight-launch@1` receipt for that exact plan
   hash. Its outer record must be `complete`, exit zero, and show verified
   process teardown; its nested `local-single-observation-cpu-preflight@1`
   result must show one resolved image and observation, CUDA uninitialized, and
   no parser output directory. The launcher binds the raw outer-receipt hash.
3. A separately created parent admission binding the plan and CPU-receipt hashes,
   an explicit one-time GPU-fit permission, the ten-step ceiling, one local GPU,
   the wall-time ceiling, and `not_promotable: true`. It must reject a reused admission dispatch marker across every output directory
   and a stale snapshot.
4. Current revalidation immediately before launch: the canonical source and
   persona bytes; staged inventory (exactly JPEG, caption, and TOML); the
   template hash; fixed trainer checkout HEAD and clean state; trainer script
   hash; venv Python identity; and the pinned local base-model hash and bytes.
   Any mismatch fails before GPU initialization.

The trainer checkout currently resolves to
`37a1cbbc5725ed2a3575506e7bd2001c9908ac92`; it is a local pin, not a license,
model, or quality claim. The intended script remains
`sdxl_train_network.py`, invoked as a `Popen` argument list with `shell=False`.
No network, model download, credential, provider, browser, or external export
path belongs in the launcher.

The required local tokenizer *files* are now located and their candidate
regular-blob hashes are recorded in
`2026-09-08-local-tokenizer-cache-readiness.md`: five assets for each of
`openai/clip-vit-large-patch14` and
`laion/CLIP-ViT-bigG-14-laion2B-39B-b160k`. The Hugging Face snapshot entries
are symlinks to those regular blobs. That layout is permitted only when a
bounded inventory binds the declared snapshot entry, its resolved regular blob,
its byte count, and its SHA-256; a blanket rejection of all snapshot symlinks
would incorrectly reject the known local cache layout. The launcher must never
follow an undeclared link, a reparse point below the resolved blob, or a
changed resolved target.

Runtime loading is now evidenced by the completed frozen
`figment/local-tokenizer-prepared@1` and
`figment/local-tokenizer-load@1` receipts recorded in the local training
preflight audit. They bind the prepared raw hash, frozen inventory, copied
files, offline local-only loads, the second tokenizer's effective pad token of
zero, and CUDA uninitialized. The executor still revalidates those receipts and
copies the prepared assets into a fresh private cache before passing it through
`--tokenizer_cache_dir`; it never falls back to the mutable shared cache or
attempts a network lookup.

## Recipe and 8 GB fit posture

The current fixed TOML already supplies the conservative probe shape:
SDXL RealVisXL base, 768-square bucketed input, batch size 1, ten steps,
bfloat16, SDPA, gradient checkpointing, UNet-only network training, rank 32
with alpha 16, AdamW8bit, and disk-backed latent and text-encoder-output caches.
A later GPU-specific copy should retain those values unless a separately frozen
change and a new CPU preflight justify a change. This is a memory-fit posture
for an approximately 8 GB GPU, not evidence that a useful LoRA can be trained
at those settings.

The generated command should supply only the fixed trainer script, staged data
root, pinned base-model path, fresh output directory, fixed output name, and
fresh bounded logging directory. It should disable sampling (`sample_every_n_steps
= 0`), state saves, and intermediate checkpoint saves. The completed condition
allows exactly one final `.safetensors` checkpoint, which is streamed through a bounded SHA-256 reader rather than loaded into memory; it creates no sample image,
no image export, and no hub publication. If the configured TensorBoard logging
cannot be disabled by a verified local option, it remains confined to the fresh
logging directory and is covered by its own small file-count and byte cap; its
contents are not copied into the receipt.

Use one absolute wall-time ceiling of 20 minutes from process creation,
including model load, cache preparation, and all ten steps. This is an
availability bound, not a performance prediction. The output directory must
have an exact allowlist: one final checkpoint (at most 1 GiB), the structured
journal/receipt, and bounded log files. Unexpected files, samples, checkpoints
at intermediate steps, symlinks, or reparse points fail the run closed.

## Isolation, ownership, and bounded reporting

Reuse the *pattern* in `expand/local_comfy_input.py`, without changing or
calling its Comfy runner: create a fresh direct child of `_private`; run with a
minimal environment; capture the retained `Popen` handle; record Windows process
identity as PID plus creation FILETIME; discover only fresh descendants; and
stop only identities that still match both values. The trainer launcher should
not kill by image name, broad parent PID, or a guessed process tree.

Its environment should be constructed from a small system allowlist and set
fresh run-owned `TEMP`, `TMP`, `HOME`, `USERPROFILE`, `LOCALAPPDATA`, `APPDATA`,
`HF_HOME`, `TRANSFORMERS_CACHE`, `TORCH_HOME`, `TORCHINDUCTOR_CACHE_DIR`, and
`XDG_CACHE_HOME` paths. Set the offline Hugging Face/Transformers/Diffusers
variables and explicitly select the one admitted GPU. This avoids inheriting
shared caches while keeping the GPU setting distinct from the CPU preflight's
documented no-device sentinel `CUDA_VISIBLE_DEVICES=-1`. The CPU receipt must
also bind `PYTORCH_NVML_BASED_CUDA_CHECK=1`, unavailable CUDA, zero visible
devices, and no CUDA initialization; a GPU admission cannot reinterpret those
schema-@1 fields as an available device.

Stream stdout and stderr to run-owned files with a combined 256 KiB cap; record
truncation and hashes, not arbitrary process text, in the structured journal.
The journal is written before launch, updated on owned-process discovery, and
contains only bounded status, exit code, elapsed time, validated artifact
hashes, and sanitized failure class.

On timeout, nonzero exit, malformed output, or ownership-inspection failure,
write a failure receipt with `completed: false`, the known identities, cleanup
result, and `verified_stopped` truthfully set. An OOM-like error may be marked
`oom_suspected` only when a bounded log-tail classifier finds a known local OOM
signature; otherwise report `nonzero` or `timeout`. It must never create a
success receipt, adopt a checkpoint, or retry automatically. If a descendant
cannot be inspected, record it as unresolved and fail; root recovery can act
only on independently verified identities.

On normal exit, validate the exact final checkpoint allowlist and hashes before
writing a completed fit-probe receipt. The receipt remains
`not_promotable: true`; it is a runtime artifact, not an accepted LoRA.

## Follow-up implementation test matrix

## Implemented executor boundary

### V1 execution finding

The separately admitted `figment-local-lora-fit-20260908-v1` reached CUDA,
model/cache preparation, LoRA setup, and AdamW setup, then failed before step
1 after 110.283 seconds.  `sd-scripts/train_network.py:1394` attempted to print
Japanese text through a Windows cp1252 pipe and raised `UnicodeEncodeError`.
The preserved private failure receipt and bounded logs record exit 1; no
checkpoint or sample was produced. The private stage contains the completed
latent and text-encoder caches. The executor now starts its exact child
interpreter with `-X utf8` before `-B -m sdxl_train_network`, and a new
pipe-output regression covers that interpreter boundary.  This documents a
failed availability probe, not a training result or authority to retry; a new
admission is required for any later execution.

`local_single_observation_fit.py` now implements this as a validation-first
executor.  The admission must bind the current launcher, planner, CPU parser,
Comfy ownership helper, and tokenizer-preflight source hashes before any helper
is imported; it binds the plan, completed CPU receipt, and separate raw
prepared/load tokenizer receipt hashes as well.  Execution repeats that full
validation immediately before `Popen`, so a caller-provided evidence dictionary
is never treated as authorization.

All evidence locations are contained below the fixed Studio `_private` root,
apart from the named completed CPU receipt under the workspace `_private` root.
Tokenizer copy records must use their exact pinned two-component,
identifier-derived path.  A stable admission-id marker is exclusively created
under the fixed private root before the fresh output tree is made, preventing a
single admission from being replayed to a different `--out` directory.

The owned trainer uses the accepted Windows ownership helper with the retained
wrapper handle, a clean minimal environment and run-owned HOME, AppData, Temp,
Hugging Face, Torch, and Inductor paths.  Normal wrapper exit racing descendant
discovery is accepted only through that retained handle; missing wrapper
identity receives direct-handle cleanup and a truthful unresolved cleanup
record if that fails.  Success requires verified teardown, bounded stream and
TensorBoard files, and exactly one bounded real safetensors checkpoint.  Its
header must contain at least one valid tensor entry and LoRA `ss_steps: "10"`.
No resulting checkpoint is accepted, sampled, exported, or promoted.

A later implementation should prove, without a model download, that it refuses:
stale plan/CPU/admission bindings; changed source, persona, template, trainer,
venv, or model; missing tokenizer-cache attestation; a reused marker; reparse
paths; extra staged files; sample/intermediate output; output over bounds; and
unowned or uninspectable descendants. Isolated fake-trainer fixtures should
cover timeout, nonzero/OOM-like failure, log truncation, final-only success, and
PID reuse. A real run, if separately admitted, is one bounded local fit probe
only and still needs independent visual and training review before any later
work.
