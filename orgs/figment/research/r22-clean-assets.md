# R22 — Clean-licence asset substitutes for gravedigga LoRAs

Context: `gravedigga/loras` (anonymous, unlicensed HF account) is REJECT outright — no
licence stated on an anonymous account = never CLEAN, and commercial hosting of
outputs is required. Below are substitutes + scorers with sourced licences.

## 1. Realism/skin LoRAs — Z-Image Turbo (base: Tongyi-MAI/Z-Image-Turbo, Apache-2.0)

| Repo/file | Licence (as stated) | Format | Size | Verdict |
|---|---|---|---|---|
| [suayptalha/Z-Image-Turbo-Realism-LoRA](https://huggingface.co/suayptalha/Z-Image-Turbo-Realism-LoRA), `pytorch_lora_weights.safetensors` | "apache-2.0" (model card header) | safetensors | 85.1 MB | **CLEAN** |
| [Civitai: Realistic Snapshot (Z-Image-Turbo)](https://civitai.com/models/2268008/realistic-snapshot-z-image-turbo) by MonkeyForever, file `RealisticSnapshotKrea2.safetensors` | No licence/permissions block stated on the page | safetensors bf16 | 218 MB | **UNCLEAR** — no licence text found; filename oddly matches the Krea-2 naming from the rejected package, possible re-upload of the same lineage. Do not use without the creator confirming terms. |
| [Civitai: Z-Image Turbo Radiant Realism Pro](https://civitai.com/models/2395852) | Not checked in depth (page not fetched) | safetensors (assumed) | — | **UNCLEAR** — verify Civitai permissions toggles before use |

## 2. Realism/skin LoRAs — Krea-2 (base licence: Krea 2 Community License)

| Repo/file | Licence (as stated) | Format | Size | Verdict |
|---|---|---|---|---|
| [Comfy-Org/Krea-2](https://huggingface.co/Comfy-Org/Krea-2) (base checkpoint) | "krea-2-community-license", full text at `krea/Krea-2-Turbo/LICENSE.pdf`. Card states: "Fine-tuning and LoRAs are expressly permitted." "Commercial use is free under $1M revenue" (trailing-12-month company revenue); ≥$1M needs an enterprise licence from Krea. | safetensors (fp8-scaled diffusion model) | — | **CLEAN** for our scale, with the revenue ceiling noted |
| [inlineresearch/skin-lora-krea-2-raw](https://huggingface.co/inlineresearch/skin-lora-krea-2-raw), `inline-skin-lora-krea-2-raw.safetensors` | Krea 2 Community License (derivative, inherits terms) | safetensors | size not listed on card | **CLEAN** (same $1M ceiling) — trained 26 image/caption pairs, rank-16 PEFT, targets pores/vellus hair/subsurface scattering — direct substitute for the rejected `RealisticSnapshotKrea2` |
| [gokaygokay/Krea-2-Realism-LoRA](https://huggingface.co/gokaygokay/Krea-2-Realism-LoRA), `krea2_realism_lora.safetensors` | "krea-2-community-license" | safetensors | size not listed | **CLEAN** — natural/candid photography push, base `krea/Krea-2-Raw` |
| `pawg_krea2` substitute | No equivalent found | — | — | **NOT FOUND** — no licensed body-type/style LoRA located for Krea-2 under this name or description; flag as an open gap rather than force a match |
| FLUX.1-dev/Krea-family LoRAs cross-loaded onto Krea-2 | N/A | — | — | **UNCLEAR** — no documentation found confirming FLUX.1-dev LoRAs load cleanly on Krea-2's architecture; do not assume cross-compatibility without a maintainer statement |

## 3. Qwen-Image-Edit skin-realism LoRA

`tlennon-ie/qwen-edit-skin` — [HF repo](https://huggingface.co/tlennon-ie/qwen-edit-skin).
Licence: **Apache-2.0** (model card header: "License: apache-2.0"). Format: safetensors,
~295 MB per checkpoint (multiple training-step snapshots plus a final
`qwen-edit-skin.safetensors`; total repo ~3.4 GB across snapshots — only the final file
is needed). Provenance: community LoRA trained on an RTX 5090, 5000 steps, AI-Toolkit,
portrait images with modified skin detail.
**Base-model note:** the card's example code loads `Qwen/Qwen-Image-Edit-2509`, not
2511 — **not confirmed to work on 2511** (no compatibility statement found). Since our
pipeline targets Qwen-Image-Edit-2511, treat this as **UNCLEAR-for-our-stack** until
tested; licence itself is CLEAN. No alternative 2511-native skin LoRA was found.

## 4. Face detection without pickles

| Option | Licence | Format | ComfyUI wrap | Verdict |
|---|---|---|---|---|
| MediaPipe face detector, native ComfyUI (PR #14009) | Apache-2.0 (MediaPipe models) | `mediapipe_face_fp32.safetensors` — note: shipped as **safetensors**, not raw `.tflite`, via ComfyUI's own model repo | Built into core ComfyUI, no third-party node/install needed | **CLEAN — safest pin.** No ultralytics, no `.pt` |
| SCRFD (InsightFace) ONNX | Code MIT; **pretrained detection models (SCRFD/buffalo) are non-commercial-research-only** per InsightFace's own terms — commercial licence must be bought from InsightFace | onnx | Various unofficial nodes | **REJECT** for our commercial-hosting requirement unless a paid InsightFace commercial licence is obtained |
| YuNet (OpenCV Zoo) | MIT (all files in `models/face_detection_yunet/`) | onnx (`face_detection_yunet_2023mar.onnx` / `_2026may.onnx`) | No dedicated ComfyUI node found in this pass; usable via OpenCV DNN in a custom script node | **CLEAN**, small (~1-2 MB range typical for YuNet), good fallback if MediaPipe's ComfyUI packaging is unavailable |
| RetinaFace ONNX (yakhyo/retinaface-pytorch export, or biubug6/Pytorch_Retinaface) | MIT (`LICENSE.MIT` in biubug6 repo; yakhyo repo also MIT) | Pytorch source ships `.pth`; ONNX export path exists and produces `.onnx` | No ComfyUI node found | **CLEAN if you use/export the ONNX artifact only** — do not load the repo's `.pth` directly (pickle) |
| facenet-pytorch MTCNN | MIT (`LICENSE.md`, timesler/facenet-pytorch) | Weights auto-download as torch `state_dict` (**pickle-adjacent `.pt` cache**, loaded via `torch.load`) | No | **REJECT** — pickle weight format regardless of permissive code licence |

**Verdict: MediaPipe's native-ComfyUI safetensors path is the safest pin** — Apache-2.0, no pickle, zero extra installs. YuNet is the clean non-ComfyUI-native fallback.

## 5. ComfyUI-Impact-Pack (GPL-3.0)

Repo: [ltdrdata/ComfyUI-Impact-Pack](https://github.com/ltdrdata/ComfyUI-Impact-Pack), licence file states GPL-3.0.
`requirements.txt` (Main branch) lists: segment-anything, scikit-image, piexif,
transformers, opencv-python-headless, scipy, numpy, dill, matplotlib, and
`git+https://github.com/facebookresearch/sam2` — **no ultralytics, no `.pt` pin**.
As of v8.0 the `Impact-Subpack` (which supplies `UltralyticsDetectorProvider` and
pulls ultralytics/`.pt` YOLO weights) is **no longer auto-installed** — confirmed via
GitHub issue #843 and the Subpack repo description ("offers features not deemed
suitable for inclusion by default").
`MaskToSEGS` and `DetailerForEach` ("Detailer (SEGS)") are both registered in the base
Impact-Pack's `node_list.json` / `nodes.py` — **usable stand-alone with no Subpack
install**, so an ultralytics/YOLO-free detector→SEGS→detailer path is real.
**Verdict: CLEAN to install base Impact-Pack alone** for the MaskToSEGS +
DetailerForEach path; just never add Impact-Subpack.

## 6. Age estimation + no-reference quality scorers

| Asset | Licence | Format | Verdict |
|---|---|---|---|
| [nateraw/vit-age-classifier](https://huggingface.co/nateraw/vit-age-classifier) | No explicit licence text found on card | safetensors | **UNCLEAR** |
| [Civitai/age-vit](https://huggingface.co/Civitai/age-vit) (finetune of nateraw's, on FairFace) | Apache-2.0 stated on card | safetensors | **CLEAN** |
| [dima806/facial_age_image_detection](https://huggingface.co/dima806/facial_age_image_detection) | Apache-2.0 stated on card | safetensors | **CLEAN** |
| [prithivMLmods/Age-Classification-SigLIP2](https://huggingface.co/prithivMLmods/Age-Classification-SigLIP2) | Apache-2.0 stated on card | safetensors | **CLEAN** |
| [WildChlamydia/MiVOLO](https://github.com/WildChlamydia/MiVOLO) | Apache-2.0 (repo `license` file) | Checkpoints ship as **`.pth.tar`** (torch pickle, e.g. `mivolo_imbd.pth.tar`) | **REJECT** — pickle weight format despite clean code licence; ONNX export explicitly discouraged by the maintainers for batch use |
| [PerceptCLIP/PerceptCLIP_IQA](https://huggingface.co/PerceptCLIP/PerceptCLIP_IQA) | No licence stated on card | `.pth`, loaded via `torch.load` | **REJECT** — pickle AND no licence stated (double disqualifier) |
| pyiqa / IQA-PyTorch (chaofengc), source of CLIP-IQA + NIQE implementations | **PolyForm Noncommercial License 1.0.0** ("Any noncommercial purpose is a permitted purpose"; commercial use prohibited), per repo `LICENSE` | Python package; per-metric weights vary | **REJECT for our commercial pipeline** — the toolbox itself is noncommercial-only, this blocks using its CLIP-IQA/NIQE implementations as shipped |
| NIQE (statistical, no learned weights) reimplemented independently of pyiqa | N/A — algorithm itself (Mittal et al.) has no HF/GitHub licence blocker if you write your own MVG-fit implementation | No weight file needed | **CLEAN** if reimplemented outside pyiqa; do not vendor pyiqa's GPL/PolyForm code |

**Verdict:** age scoring — use `Civitai/age-vit`, `dima806/facial_age_image_detection`,
or `prithivMLmods/Age-Classification-SigLIP2` (all Apache-2.0, safetensors). Quality
scoring — do not ship pyiqa's CLIP-IQA/NIQE as a library dependency (noncommercial
licence); reimplement NIQE standalone, or find an Apache/MIT no-reference IQA
alternative in a follow-up pass (none confirmed clean in this pass).

## 7. Qwen/Qwen3-VL-8B-Instruct

[HF repo](https://huggingface.co/Qwen/Qwen3-VL-8B-Instruct) — licence **Apache-2.0**.
Weights: safetensors, sharded (`model-0000X-of-00004.safetensors`), **~17.5 GB total**
at bf16. An FP8 variant (`Qwen3-VL-8B-Instruct-FP8`) is also published. Reported
inference VRAM: **~19 GB at bf16/FP16**; FP8 commonly cited around **16-20 GB**
depending on context length and KV-cache overhead (figures from third-party
GPU-sizing pages, not an official Qwen spec — treat as approximate).
On a 48 GB L40S: bf16 Qwen3-VL-8B (~19 GB) alongside an idle Qwen-Image-Edit-2511
stack should fit if the Image-Edit stack's idle VRAM footprint stays under ~25-28 GB;
this was not independently verified against Qwen-Image-Edit-2511's own published VRAM
figures in this pass — confirm with a live `nvidia-smi` check before relying on it,
since "idle" footprint depends on whether the diffusion pipeline keeps weights
resident or offloads.

## Shortlist — pins to adopt

| Asset | Verdict | Pin |
|---|---|---|
| Z-Image Turbo realism LoRA | CLEAN | `suayptalha/Z-Image-Turbo-Realism-LoRA`, `pytorch_lora_weights.safetensors` |
| Krea-2 skin LoRA | CLEAN | `inlineresearch/skin-lora-krea-2-raw`, `inline-skin-lora-krea-2-raw.safetensors` (Krea 2 Community Licence, <$1M revenue) |
| Krea-2 realism LoRA (alt) | CLEAN | `gokaygokay/Krea-2-Realism-LoRA`, `krea2_realism_lora.safetensors` |
| Qwen-Image-Edit skin LoRA | CLEAN licence / UNCLEAR compat | `tlennon-ie/qwen-edit-skin`, `qwen-edit-skin.safetensors` — verify against Qwen-Image-Edit-2511 before relying on it |
| Face detector | CLEAN — safest | ComfyUI native MediaPipe, `mediapipe_face_fp32.safetensors` (Apache-2.0) |
| Face detector (non-ComfyUI fallback) | CLEAN | OpenCV Zoo YuNet ONNX, MIT |
| Detailer pipeline | CLEAN | `ltdrdata/ComfyUI-Impact-Pack` base only (GPL-3.0 code, no ultralytics) — never add Impact-Subpack |
| Age scorer | CLEAN | `dima806/facial_age_image_detection` or `Civitai/age-vit`, safetensors, Apache-2.0 |
| Quality scorer | GAP | pyiqa REJECTED (noncommercial); reimplement NIQE standalone or source a fresh Apache/MIT NR-IQA in a follow-up |
| VLM captioner | CLEAN | `Qwen/Qwen3-VL-8B-Instruct`, Apache-2.0, ~17.5 GB safetensors bf16 |
