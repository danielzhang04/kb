# TENSOR-REPLICATION — 10sorLabs module 10 on our harness

Faithful port of `research/10sorlabs-package/10_dataset_generator_v2/10sorlabs_dataset_generator_v2.json`
(70 nodes, UI format) to `expand/workflows/tensor_dataset_v2_api.json` (55 nodes, API format) plus three
10-job shards in `expand/runs/creator-001-tensor-dataset-shard-{01,02,03}.yaml`. Settings come from the
JSON itself, cross-read against r15 §3f and r15b-training §"Module 10"; node ids are the package's own, so
every row below is checkable by id. No novel method — every substitution is recorded here.

## What the workflow actually does

Two mirrored branches. **Stage A (Qwen-Image-Edit):** the face branch resizes g01 to 1680², crops the face
with insightface `FaceBoundingBox` padding 15 and feeds that crop as `image1`; the body branch feeds
resized g07 as `image1` and the same face crop as `image2`. Both sample a fresh 1024×1440 latent at denoise
1.0 through `ClownsharKSampler_Beta` (4 steps, cfg 1.0, `linear/euler` / `beta57`, eta 0.31 face / 0.30
body, bongmath on) with `ClownOptions_DetailBoost_Beta` weight 1.0 over step windows 4→10 and 2→4; the
negative is the positive, zeroed. **Stage B (FLUX.2 klein refine):** decode → 1.0 MP → 4× upscale model →
×0.5 lanczos → `VAEEncode` → `KSampler` **denoise 0.23**, 4 steps, cfg 1.0, euler/beta, shift 3.0, prompted
with the short identity string only. 15 + 15 = ~30 images from 2 photos.

## Node mapping (module 10 → ours)

| Module 10 | Ours | Note |
|---|---|---|
| 701 `CheckpointLoaderSimple` (AIO NSFW) | 901 `UNETLoader` + 902 `CLIPLoader` + 903 `VAELoader` | D1 |
| 89 LoRA `bfs_head_v5` 0.6 → 723 LoRA `QWEN2512_…` 0.7 (bypassed) → 66 shift 3.1 | 89 LoRA Lightning-4steps **1.0** → 66 shift 3.1 | D1, D3 |
| 836/837 `LoadImage` | same ids, `creator-001/g01.jpg` (face) + `creator-001/g07.jpg` (body) | — |
| 679/645/678 `ImageResizeKJv2` 1680², 699 `FaceAnalysisModels`, 698 `FaceBoundingBox` pad 15 | same ids, identical widgets | — |
| 174/676 `TextEncodeQwenImageEditPlus` | same ids; `prompt` substituted per job | D2, D8 |
| 681/680 `ConditioningZeroOut`, 176/722 `EmptyLatentImage` 1024×1440, 647/675 `ClownOptions_DetailBoost_Beta`, 646/672 `ClownsharKSampler_Beta`, 8/673 `VAEDecode` (sampler slot 1, `denoised`) | same ids, identical widgets | — |
| 811/743 `ImpactImageBatchToImageList` → 785/771 1.0 MP → 782/767 upscale → 783/768 ×0.5 → 786/772 `VAEEncode` | same ids | D6 |
| 790/773 `UNETLoader`, 798/775 `CLIPLoader`, 799/769 `VAELoader`, 784/770 `UpscaleModelLoader`, 797/774 shift 3.0 | same ids, duplicated exactly as the package duplicates them | D4, D5 |
| 800/780 `CLIPTextEncode` (identity), 801/766 (empty negative), 789/777 `ReferenceLatent` (no latent), 788/778 `KSampler` denoise 0.23 | same ids; identity strings baked in | D8 |
| 791/776 `VAEDecode`, 832/833 `SaveImage` | 791/776 kept; **one** `SaveImage` 832, `images` selected per job | D10 |
| 179/697 `CR Prompt List`, 760/761 `PrimitiveStringMultiline`, 805–810 `Set/GetNode`, 652/700/830 `PreviewImage`, 834/835 `Note` | dropped | D8, D12 |

## Deviations, each with its reason

- **D1 — AIO checkpoint → official split stack.** `Qwen-Rapid-AIO-NSFW-v23.safetensors` is an unaudited
  community NSFW merge (r15 §2c). Replaced by Qwen-Image-Edit 2511 fp8mixed + Qwen2.5-VL-7B + qwen_image_vae
  + `Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16` at **1.0** — the package's *own* audited stack in
  module 04, so 4 steps / cfg 1.0 stay valid.
- **D2 — clothing-removal branch removed.** In the shipped artefact the removal instruction is a *stale
  widget value* on nodes 174/676, shadowed at runtime by the `CR Prompt List` link into `prompt`. It is
  carried nowhere in our files; `test_tensor_dataset.py` greps for it and for every weight that fed it.
- **D3 — both unaudited LoRAs dropped.** `bfs_head_v5…` (gravedigga, 0 downloads / 0 likes / no card) and
  `QWEN2512_…`, which the package already ships **bypassed** (mode 4). Identity comes from the references.
- **D4 — FLUX.2 klein 9B → klein 4B (distilled).** `black-forest-labs/FLUX.2-klein-9b-fp8` is gated;
  `Comfy-Org/flux2-klein-9B` holds only encoder+VAE, under `flux-non-commercial-license`; the one ungated
  9B mirror (`Kiro930`) is a licence-bypass re-upload (r15 §2c). `Comfy-Org/flux2-klein-4B` is Apache-2.0,
  ungated, and already ran live in composite-02. The harness gained `env_secret_refs` HF-token auth while
  this was being built, so the gated 9B is now *reachable* — but it is non-commercial: an operator call.
- **D5 — CLIPLoader `lumina2` → `flux2`, `qwen_3_8b_fp8mixed` → `qwen_3_4b`.** `lumina2` loads a Gemma2
  tokenizer; composite-02 ran green with `flux2` + Qwen3, and the encoder must match the 4B repackage.
- **D6 — `zit_upscaler` → `Phips/4xNomosWebPhoto_RealPLKSR`.** Source was gravedigga again; the substitute
  is ungated safetensors under CC-BY-4.0 and the net geometry (1 MP → 4× → ×0.5) is unchanged.
- **D7 — `sam_vit_b_01ec64.pth` not downloaded.** The installer pulls it; the graph has no SAM node and it
  is a pickle (arbitrary code on load). **D12 —** Preview/Note nodes dropped (UI-only).
- **D8 — prompt fan-out moved into the harness.** Their two `CR Prompt List` nodes concatenate
  `prepend_text` + one of 15 rows and emit a STRING list, running the graph 15×. We concatenate the same
  two strings per job in `expand/templates/tensor-dataset-prompts.yaml` order. Drops the Comfyroll pack.
- **D9 — custom-node set.** Kept: RES4LYF, Impact-Pack, Impact-Subpack, FaceAnalysis. Dropped: Comfyroll
  (D8), rgthree and SeedVR2 (no node of theirs appears in the graph). **Added: KJNodes** — the module-10
  installer omits it although the graph needs `ImageResizeKJv2`; pin from `krea2_model_installer.bat`.
  *(Correction, D24: Impact-Subpack was kept here on the strength of the package's own installer, but no
  node in either dataset workflow ever used a Subpack `class_type` — see D24 below, which removes it.)*
- **D10 — one SaveImage, selected per job.** Both their output nodes take the harness-forced
  `filename_prefix`, so a two-image job's `_01`/`_02` would follow ComfyUI's execution order, not face-then-body.
- **D11 — node commits recorded, not enforced.** The installer checks out pinned SHAs; `runpod_run.py`
  clones `--depth 1` from the default branch. Pins live in each manifest's `installer_pin`.
- **D13 — prompt language is ours, structure is theirs.** Only the short angle/pose/lighting phrases carry
  over; their strings say "youthful young woman" (a GUARDRAIL #2 defect) and carry wardrobe/anatomy
  language we do not reproduce. Register words come from look-spec-v2 §0, no §4a banned literal appears,
  age is stated per §4c, and the lesson's rule (@3:59) that the identity string match the input photo holds.
- **D14 — body reference shows a face.** The lesson prefers a faceless body photo; g07 is our body
  exemplar and does show one. The body branch re-specifies the face through `image2` regardless.

## Models and licences

| File | Source | Licence | Size |
|---|---|---|---|
| `qwen_image_edit_2511_fp8mixed.safetensors` | `Comfy-Org/Qwen-Image-Edit_ComfyUI` | Apache-2.0 | 20.5 GB |
| `qwen_2.5_vl_7b_fp8_scaled.safetensors` | `Comfy-Org/Qwen-Image_ComfyUI` | Apache-2.0 | 9.4 GB |
| `qwen_image_vae.safetensors` | `Comfy-Org/Qwen-Image_ComfyUI` | Apache-2.0 | 0.25 GB |
| `Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors` | `lightx2v/Qwen-Image-Edit-2511-Lightning` | Apache-2.0 | 0.85 GB |
| `flux-2-klein-4b.safetensors` | `Comfy-Org/flux2-klein-4B` | Apache-2.0 | 7.75 GB |
| `qwen_3_4b.safetensors` | `Comfy-Org/flux2-klein-4B` | Apache-2.0 | ~8 GB |
| `flux2-vae.safetensors` | `Comfy-Org/flux2-klein-4B` | Apache-2.0 | ~0.3 GB |
| `4xNomosWebPhoto_RealPLKSR.safetensors` | `Phips/4xNomosWebPhoto_RealPLKSR` | CC-BY-4.0 | 0.03 GB |

≈47 GB, against the package's own "~44 GB" template (lesson @0:45). All ungated safetensors, no pickle.

## Cost ceiling

`NVIDIA L40S` (48 GB, Ada, native fp8 — the 20.5 GB edit model plus the 9.4 GB VL encoder will not fit a
24 GB card), SECURE, `price_usd_per_hour` **1.30** (conservative; L40S secure lists near $1.03).
`max_minutes` **125** per the preflight formula: 2700 s readiness + 10 × 450 s jobs + 300 s teardown =
7500 s. **Per-pod ceiling $2.71; three shards $8.13 for the arc.** Expected actual is ~40 min per pod
(~20 min pulling 47 GB, then ten ~1.5 min jobs) ≈ **$0.87 per pod, ~$2.60 total**. Run with
`--max-usd 2.75`. If L40S SECURE is unavailable, `NVIDIA RTX 6000 Ada Generation` is the like-for-like
alternate; `NVIDIA RTX A6000` also has 48 GB but is Ampere, so fp8 is emulated and jobs run slower.

## Dependency smoke — required before shard-01 (finding 8)

`expand/runs/creator-001-tensor-smoke.yaml` is the same `custom_nodes`, same `models`, and same
`comfyui` as the three dataset shards, but ONE job — template row 1 of the face branch (a real
cell, not a stub) on the g01/g07 anchor pair — with `job_timeout_seconds 600`,
`readiness_timeout_seconds 2700`, `max_minutes 65`, `max_placement_attempts 1`. It answers the
"Open risks" below cheaply (≤$1.41 at `$1.30/h`) instead of finding out 125 minutes and $2.71
into shard-01.

**Shard-01 may run only after all three of the following hold, read from the smoke pod's own
output:**

1. `_bootstrap.log` shows `STEP node-deps-<n> rc=0` for every custom-node dependency install —
   `ComfyUI_FaceAnalysis` in particular (open risk 1: insightface/dlib can fail to compile).
2. Every declared model's sha256 check passes (once the harness model schema carries
   `revision`/`sha256` — review finding 5; until then, confirm each download completed at its
   expected byte size and the workflow's `/object_info` classes are all present, per open
   risk 2/3 below).
3. The one job succeeds and its image downloads and verifies — proving the ported graph
   actually executes on this ComfyUI/node/model combination, not just that the pod became
   ready.

Dry-run green (`--dry-run`) is a separate, weaker check: it proves the manifest shape and
harness plumbing, never that FaceAnalysis, insightface, spandrel, or RealPLKSR actually import
or execute on the pod.

## Grading protocol

Nothing is kept by a score. After each shard, view every image **at full resolution beside the anchor it
derives from** (g01 for `c001-tds-f*`, g07 for `c001-tds-b*`), one pair at a time, never as a contact
sheet. The operator grades the locked axes of look-spec-v2 §0 — face shape and fullness, features,
apparent age, makeup weight and finish, skin finish and tone, lip naturalness, body shape and proportions
— and culls, exactly as the lesson does (@4:45: "not every generated image is usable"). Automated
similarity numbers may annotate a card, never keep or cull one. A face reading under twenty is culled
outright, never relabelled (GUARDRAILS hard line 2). No adaptation is proposed before that verdict.

## Module 03 → anchor stage

Faithful port of `research/10sorlabs-package/03_generating_your_character/10sorlabs_image_generator.json`
(20 nodes, UI format) to `expand/workflows/zimage_passport_api.json` (9 nodes, API format) plus
`expand/templates/anchor-prompts.yaml`. Settings come from the JSON itself, cross-read against r15 §3a;
node ids `1`/`2`/`3`/`4`/`5`/`7`/`11`/`47`/`94` are the package's own, `103` is new. Continuing the
D-numbering above:

- **D15** — `realistic_snapshot_lora.safetensors` (gravedigga, unlicensed) → `suayptalha/Z-Image-Turbo-Realism-LoRA`
  `pytorch_lora_weights.safetensors`, Apache-2.0, same 0.66 strength (r22 §1).
- **D16** — `Power Lora Loader (rgthree)` → core `LoraLoader`; rgthree supplies nothing else the graph needs.
- **D17** — both `FaceDetailer` passes, `UltralyticsDetectorProvider` (`face_yolov8m.pt`), `SAMLoader`
  (`sam_vit_b_01ec64.pth`) and `zit_upscaler.safetensors` dropped here: all pickles or unlicensed (r20
  "could not replicate" table). The anchor is graded at native 1536×2048; the licence-clean detailer
  arrives in Phase D (generation, module 09).
- **D18** — `Image Comparer (rgthree)`, `Fast Groups Bypasser` and the two extra `SaveImage` nodes dropped
  (UI-only; the grading board is our comparer).
- **D19** — seed fan-out moved into the harness: `control_after_generate: increment` from 148 becomes 12
  explicit job seeds `148…159`, reproducible from `plan.json`.
- **D20** — camera clause keeps the phone/lens/aperture, drops "zero film grain" and "smooth skin" *(review
  LOW-14: also drops the CJK quality tokens (`细腻, 氛围感, 杰作, 光影`), "Sharp subject and background", and the
  `8k / max details / makeup on face / detailed face` tail — defensible under §4a (soft-glam/plastic-skin
  vocabulary), recorded here for the audit trail)*.
- **D21** — passport rows carry an explicit framing prefix (review HIGH-4). Package node `4`'s own text
  (quoted verbatim): *"A high-quality Instagram-style smartphone photo captures a stunning young woman
  posing confidently by a large window in a high-rise apartment overlooking a vibrant nighttime
  cityscape…"* — full-scene staging with no framing-distance instruction. At our own 1536×2048 canvas that
  puts the face far under `persona.yaml`'s `identity.floor.min_face_px` (600px); `identity-spec.md`'s "Rule
  for expansion" already ruled on exactly this case: *"generate the identity set at half-body/close framing
  where the face is large (clean identity)… rather than a single full-frame swap."* Every one of the 12
  passport rows is now prefixed with *"Close head-and-shoulders portrait framing, face centred and filling
  the upper half of the frame,"* ahead of the scene description (`anchor-prompts.yaml`'s
  `passport.framing_prefix`, applied in `_generalized_anchor_prompts`).
- **D22** — the edit arm's second `CLIPTextEncode` (node `800`, inherited from the dataset graph's
  face-repair resample at denoise 0.23) previously kept the *dataset* template's own makeup register while
  node `174` carried the anchor's persona-derived clause — two contradictory look registers graded in one
  job (review MED-6). Node `800`'s `text` is now substituted per job with the same
  `prompts["edit"]["identity"]` value node `174` uses.
- **D23** — `ComfyUI-Impact-Subpack` was pinned into `pins.anchor_edit.custom_nodes` (inherited from
  `pins.dataset`) but referenced by no node in either dataset workflow — the only Impact class either graph
  uses is `ImpactImageBatchToImageList`, base-pack. It is the exact class of exposure r22 §5 warns about
  (bootstrap pip-installs each node's `requirements.txt`, and the Subpack is the component that pulls
  `ultralytics` and `.pt` YOLO weights). Plan H4 says never re-add it; review MED-5 caught it reaching
  `pins.anchor_edit` a phase early (Task B1 was meant to remove it from `pins.dataset` first). Removed from
  `pins.anchor_edit.custom_nodes` now; `pins.dataset.custom_nodes` still carries it pending Task B1.

### Pins and licences (module 03 → anchor stage)

| File | Source | Licence | Notes |
|---|---|---|---|
| `z_image_turbo_bf16.safetensors` | `Comfy-Org/z_image_turbo` | Apache-2.0 | diffusion model |
| `qwen_3_4b.safetensors` | `Comfy-Org/z_image_turbo` | Apache-2.0 | text encoder |
| `ae.safetensors` | `Comfy-Org/z_image_turbo` | Apache-2.0 | VAE |
| `pytorch_lora_weights.safetensors` | `suayptalha/Z-Image-Turbo-Realism-LoRA` | Apache-2.0 (card-header claim, no LICENSE file in the repo — re-checked at pin time, r22 §4) | realism LoRA @ 0.66 |

Revisions and sha256 were resolved live against the HF API/CDN at pin time (2026-09-06) and are recorded
verbatim in `train/tensor-pins.yaml` under `pins.anchor` (review HIGH-1: the four digests as first
committed were wrong — every model download would have failed at bootstrap; corrected against a live
`x-linked-etag` HEAD, and `train/verify_pins.py` now checks this automatically as a `figment_train.py plan`
preflight); `pins.anchor_edit` is `pins.dataset` reused with one deviation, D23.

## Module 10 → dataset stage (Track-2 Task B1)

Half-body framing for the raw dataset cells, a face-repair second pass for the full-body ones, a
skin-texture clause, and the Impact-Subpack removal D23 deferred from Phase A. Continuing the
D-numbering above:

- **D24** — `ComfyUI-Impact-Subpack` removed from `pins.dataset.custom_nodes` (the deferred half of D23:
  Phase A removed it from `pins.anchor_edit` only, since `pins.dataset` is where it actually originated).
  Confirmed again directly on the live workflow files
  (`py -3 -c "import json,glob; ..."` over `expand/workflows/tensor_dataset*_api.json`): the only Impact
  class either graph uses is `ImpactImageBatchToImageList`, which lives in the base `ComfyUI-Impact-Pack`.
  It is the exact exposure Risk #1 and r22 §5 warn about — the bootstrap `pip install`s each node's
  `requirements.txt`, and the Subpack is the component that pulls `ultralytics` and `.pt` YOLO weights.
  Removed; never re-add it.
- **D25** — full-body cells (`body.rows[i].framing == "full"`, 5 of the 15 body rows: wide, low-angle, and
  walking framings) get a module-04-style face-repair second pass in-graph
  (`expand/workflows/tensor_dataset_fullbody_api.json`, new nodes `950`-`958`: `FaceBoundingBox` on the
  just-generated cell → `ImageResizeKJv2` to 1024² → a second small Qwen-Image-Edit-Plus touch-up at
  **denoise 0.23** on the same Lightning-LoRA model chain (node `66`) the graph's own first pass uses →
  `ImageScale` back to the crop's native size → `ImageCompositeMasked` pasted back onto the full-frame
  decode). This is our mitigation for `identity-spec.md`'s "Rule for expansion" finding (a full-frame swap
  reads mask-like when the face is small at native scale) applied to the *dataset* stage, not a port — the
  package has no equivalent. The other 10 body rows are reworded ("half" framing, no wider than mid-thigh,
  face reading large) instead of repaired after the fact — repair-in-graph is reserved for the framings
  that cannot be reworded away from being wide. No new model or custom-node pin: the repair tail reuses
  `pins.dataset`'s own models (Qwen-Image-Edit-2511 stack) and custom nodes (`ComfyUI_FaceAnalysis` for
  `FaceBoundingBox`, `ComfyUI-KJNodes` for `ImageResizeKJv2`; every other new node is core ComfyUI).
- **D26** — `training.skin_lora` (persona.yaml, default `null`) may name a key of
  `pins.skin_loras` (currently only `qwen-edit-skin`, `tlennon-ie/qwen-edit-skin`,
  Apache-2.0, r22 §3) to add a `LoraLoader` at strength 0.6 between node `89` (the Lightning LoRA) and
  node `66` (`ModelSamplingAuraFlow`) on the Qwen-Image-Edit pass. Left `null` for creator-001: the card
  demonstrates Qwen-Image-Edit-**2509**, not our 2511 pipeline, and r22 could not confirm 2511
  compatibility. Enabling it requires a single-cell live A/B check first (face row 1, LoRA on vs off, same
  seed, compared at full resolution by the operator) before it is turned on for a real dataset run.

### Skin-texture clause and framing policy (module 10 → dataset stage)

Per r21 Q2 (2511 "plastic skin" is a chronic, named complaint), `face.identity` and `body.identity` in
`expand/templates/tensor-dataset-prompts.yaml` both now carry, verbatim: *"skin with visible pores, fine
vellus hair, and natural micro-texture, no retouching"* — replacing the weaker "fair skin with visible
pores and texture" / "fair skin with visible texture" fragments so the strings do not double up. Every
`body.rows` entry is now `{"text", "framing": "half"|"full"}` (`face.rows` stay plain strings — they are
already close framings). `_dataset_manifests` (`figment_train.py`) partitions the 15 face rows + 10 half
body rows (25 cells) across three as-equal-as-possible shards on the unmodified `tensor_dataset_v2_api.json`
workflow, and the 5 full body rows into one `<id>-tensor-dataset-fullbody.yaml` manifest on
`tensor_dataset_fullbody_api.json` (new `dataset_fullbody` pod-class stage: `readiness 2700`,
`job_timeout_seconds 600`, `max_minutes 108`; `2700 + 600×5 + 300 = 6000 s` fits with headroom for a
future on-pod captioning artifact). 30 cells total, same as before the split.

## Open risks to check on the first pod, before committing the other two shards

1. **`ComfyUI_FaceAnalysis` requirements.** Bootstrap pip-installs its `requirements.txt` and a failure
   there is fatal. If it pulls something that must compile (insightface, dlib), shard-01 dies in
   readiness. Read `_bootstrap.log` for `STEP node-deps-4 rc=`.
2. **insightface model pack.** `FaceAnalysisModels` fetches `buffalo_l` at runtime from GitHub releases;
   it is in no `models` entry because the package's own installer does not fetch it either.
3. **spandrel and RealPLKSR.** If ComfyUI rejects the upscaler architecture, replace nodes 782/767 with
   `ImageScaleToTotalPixels` at 4.0 MP — same output geometry, one line each.
4. **Second reference pair.** g02 is unused but already uploaded; a pair-B run repoints nodes 836/837 at
   g02 + g07 in a new shard set. Only after the g01 verdict.
5. **`Comfy-Org/flux2-klein-4B` has been renamed on Hugging Face** (discovered 2026-09-06 running
   `train/verify_pins.py --stage anchor_edit --stage dataset` for real, after this phase A fix wave —
   **not** one of REVIEW-2026-09-06-phase-a.md's findings, and NOT fixed here to stay inside that review's
   scope). All three `flux2-klein-4B` model pins in `pins.dataset`/`pins.anchor_edit` now HEAD a 307 to
   `Comfy-Org/vae-text-encorder-for-flux-klein-4b` at the same revision, same filename, and the SAME
   `x-linked-etag`/`X-Repo-Commit` the pin already records — a pure repo rename, not a content change.
   `verify_pins.py` fails closed on the 307 (it never follows a redirect) until `repo_id` is updated to the
   new name in both stages. `pins.anchor`/`train`/`tester` verify clean today.

## Module 09 → gen stage (Track-2 Task D1+D2)

The generation graph's base → 4x upscale → refine chain (nodes `1`-`21`) is node-identical to the
committed `train/runs/creator-001-tensor-gen.yaml` (the hand-written manifest this task retires as the
sole producer). Two additions: a face-repair tail replacing the package's pickled FaceDetailer, and an
optional style-LoRA slot. Continuing the D-numbering above:

- **D27** — module 09's `FaceDetailer` pass (`UltralyticsDetectorProvider` `face_yolov8m.pt` +
  `SAMLoader` `sam_vit_b_01ec64.pth`, both pickles, already dropped once at the anchor stage as D17) is
  replaced here — where a detail pass is actually needed — by ComfyUI's native, pure-PyTorch
  `LoadMediaPipeFaceLandmarker` -> `MediaPipeFaceLandmarker` -> `MediaPipeFaceMask` (Apache-2.0
  `mediapipe_face_fp32.safetensors`, `models/detection/`, shipping since ComfyUI v0.23.0, no pip
  install) feeding `GrowMask` -> base Impact-Pack's `MaskToSEGS` -> `DetailerForEach` (`ltdrdata/ComfyUI-Impact-Pack`
  @ `429d0159`, the same installer pin already used for `pins.anchor_edit`/`pins.dataset` — **never**
  `Impact-Subpack`, per D23/D24/plan H4). Evidence: `research/r23-mediapipe-node-spike.md`, whose minimal
  API snippet this pin/graph follows verbatim. Detailer numbers match the package's own module-09 values
  (r23, r15 §3e): `guide_size 512`, `steps 4`, `cfg 1.0`, `euler`/`normal`, **`denoise 0.15`**,
  `feather 5`, `GrowMask.expand 10` (the package's `bbox_dilation`), `crop_factor 3.0`, `cycle 1`,
  `noise_mask_feather 100`. `mediapipe_face_fp32.safetensors`'s `revision`/`sha256` were not published in
  ComfyUI's own repo (r23) and were resolved live against the HF CDN at pin time (`x-repo-commit` /
  `x-linked-etag` on the un-followed 302, the same method `train/verify_pins.py` checks automatically).
- **D28** — the style-LoRA slot is a `LoraLoaderModelOnly` (model output only — it must not touch the
  CLIP the identity LoRA's text encoding already depends on) chained after the identity `LoraLoader`
  (node `4`, now `1.0`/`1.0` — the committed manifest's `0.8` was an unrecorded deviation, corrected
  here to match the package's own tester/generation strength). `training.style_lora` names a key of the
  new `pins.style_loras` (`null` by default) and `training.style_lora_strength` sets
  `LoraLoaderModelOnly.strength_model` (default `0.8`). Two CLEAN candidates pinned (r22 §2, revisions
  and sha256 resolved live the same way): `inline-skin` -> `inlineresearch/skin-lora-krea-2-raw`
  (`inline-skin-lora-krea-2-raw.safetensors`) and `gokay-realism` -> `gokaygokay/Krea-2-Realism-LoRA`
  (`krea2_realism_lora.safetensors`), both Krea 2 Community License (free commercially under $1M
  trailing-12-month revenue — the same ceiling `Comfy-Org/Krea-2` itself carries). `pawg_krea2` (the
  package's own body/style LoRA) has no licence-clean substitute found in r22 and is dropped outright —
  no pin, no placeholder. When `training.style_lora` is `null`, `figment_train.py` deletes node `40`
  from the planned workflow and rewires nodes `8`/`15`/`33`'s `model` input back to `["4", 0]` before the
  manifest is ever written — no bypassed node ever ships in a live manifest.
- **D29** — a second, cheap workflow, `train/workflows/krea2_detail_only_api.json`, ports only the
  MediaPipe-mask -> `MaskToSEGS` -> `DetailerForEach` tail (plus the identity `LoraLoader`, no style
  slot, no upscale/refine chain) against an *uploaded existing* cell (`LoadImage`) instead of a fresh
  generation. This is r25's ranked cause #2 experiment made durable: re-detail already-rendered Track-1
  tester/dataset cells at the package's own denoise band without spending a full regeneration. The
  `gen` stage's `--detail-images <glob>` plan-time option resolves local files, copies them into the
  plan's own upload tree (same `_uploads/<persona>/<name>` convention the anchor/dataset stages use —
  `pod/runpod_run.py`'s upload expansion refuses any path outside the manifest's own directory), and
  emits `<id>-tensor-detail.yaml` with **two** jobs per image — `denoise 0.15` and `denoise 0.27`, the
  full band r16 §1/r25 cause #2 name — both loading the same chosen checkpoint the `gen` manifest uses.

### Pins and licences (module 09 → gen stage)

| File | Source | Licence | Notes |
|---|---|---|---|
| `krea2_turbo_fp8_scaled.safetensors` / `qwen3vl_4b_fp8_scaled.safetensors` / `qwen_image_vae.safetensors` | `Comfy-Org/Krea-2` | krea-2-community-license | reused from `pins.tester` verbatim |
| `4xNomosWebPhoto_RealPLKSR.safetensors` | `Phips/4xNomosWebPhoto_RealPLKSR` | reused from `pins.anchor_edit`/`pins.dataset` | 4x upscale pass |
| `mediapipe_face_fp32.safetensors` | `Comfy-Org/mediapipe` | Apache-2.0 (r22 §4) | face mask source, `models/detection/` |
| `inline-skin-lora-krea-2-raw.safetensors` | `inlineresearch/skin-lora-krea-2-raw` | krea-2-community-license | style slot, key `inline-skin` |
| `krea2_realism_lora.safetensors` | `gokaygokay/Krea-2-Realism-LoRA` | krea-2-community-license | style slot, key `gokay-realism` |

Every model above (including the reused ones, re-checked) was HEAD-verified live against the HF
CDN at pin time (2026-09-06/09) the same way `train/verify_pins.py --stage gen` checks it automatically
as a `figment_train.py plan --stage gen` preflight. `pins.detail` is `pins.gen` minus the upscaler (the
detail-only workflow never upscales). No `Impact-Subpack`, no `.pt`/`.pth` weight, anywhere in either
pin group or either workflow file — the same guarantee D23/D24/H4 established for the anchor and
dataset stages, now proven for generation too.
