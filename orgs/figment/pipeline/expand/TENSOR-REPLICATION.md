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
