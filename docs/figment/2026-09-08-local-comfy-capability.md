# Local ComfyUI capability record — 2026-09-08

## Scope

This is a read-only inventory of an existing local ComfyUI installation. No
server was started, no workflow was queued, no image was generated or exported,
and no model or package was downloaded. At observation time, no listener used
port 8188.

The NVIDIA GeForce RTX 4070 Laptop GPU reported 8,188 MiB total memory, 0 MiB
used, and 0% utilization. The existing ComfyUI virtual environment reported
`torch 2.11.0+cu128`, CUDA 12.8, and one available CUDA device. This establishes
that this machine can be considered for a bounded local experiment; it does not
establish image quality, identity preservation, clothing quality, or a result.

## Installed code and weights

| Component | Observed local pin or SHA-256 | Evidence and limitation |
| --- | --- | --- |
| ComfyUI | Git `95d755cd8107a72258d452b5d3657273d571f07d` | Local checkout identity only. |
| `ComfyUI_IPAdapter_plus` | Git `a0f451a5113cf9becb0847b92884cb10cbdec0ef`; clean worktree | Its local `pyproject.toml` and `LICENSE` identify GPL-3.0. Private execution is distinct from redistributing it; any bundled or distributed use needs a separate license review. |
| RealVisXL V5 fp16 | `6a35a7855770ae9820a3c931d4964c3817b6d9e3c6f9c4dabb5b3a94e5643b80`; 6,938,065,488 bytes | The parent independently matched this local hash to [SG161222/RealVisXL_V5.0 at Hugging Face](https://huggingface.co/SG161222/RealVisXL_V5.0/blob/main/RealVisXL_V5.0_fp16.safetensors), which reports OpenRAIL++. |
| JuggernautXL Ragnarok | `dd08fa32f98d05a2443ca1419e46df1575a0811f6e3b246d9dd47ff20f5eb66a`; 7,105,350,162 bytes | Present locally; its upstream source, revision, and license were not verified in this record. It is not a selected model. |
| IP-Adapter Plus-Face SDXL ViT-H | `677ad8860204f7d0bfba12d29e6c31ded9beefdf3e4bbd102518357d31a292c1`; 847,517,512 bytes | The parent independently matched this hash to fixed revision `018e402774aeeddd60609b4ecdb7e298259dc729` of [h94/IP-Adapter](https://huggingface.co/h94/IP-Adapter/blob/018e402774aeeddd60609b4ecdb7e298259dc729/sdxl_models/ip-adapter-plus-face_sdxl_vit-h.safetensors), Apache-2.0. |
| IP-Adapter Plus SDXL ViT-H | `3f5062b8400c94b7159665b21ba5c62acdcd7682262743d7f2aefedef00e6581`; 847,517,512 bytes | Present locally; not selected or independently licensed in this record. |
| CLIP ViT-H image encoder | `6ca9667da1ca9e0b0f75e46bb030f7e011f44f86cbfb8d5a36590fcd7507b030`; 2,528,373,448 bytes | The parent independently matched this hash to the same fixed h94/IP-Adapter revision's `models/image_encoder/model.safetensors`, Apache-2.0. |

The installed node describes the selected IP-Adapter Plus-Face path as
CLIP-vision conditioning. Its README says FaceID models require InsightFace;
this record does not select or require a FaceID/InsightFace path.

## Historical evidence is not a current result

`orgs/figment/pipeline/RESUME.md` and `orgs/figment/research/arm-a-findings.md`
describe an earlier local recipe using RealVisXL, IP-Adapter Plus-Face, and
CLIP-ViT-H. They record approximately 6.8 GB peak VRAM as reported at the time and historical visual
observations. They also record repeated full-body clothing-render failures and
describe identity as partial. Those reports are useful setup history, not a
current quality claim or authority to reuse the earlier approximate identity
figure.

## Safe bounded runtime shape if separately admitted

A future local builder should use a new private run root and explicitly set
ComfyUI's `--input-directory`, `--output-directory`, `--temp-directory`, and
`--user-directory` there. It should bind an unused loopback port with
`--listen 127.0.0.1`, disable browser launch, API nodes, and all custom nodes,
then allow only `ComfyUI_IPAdapter_plus` with
`--whitelist-custom-nodes ComfyUI_IPAdapter_plus`. The installed CLI exposes
those switches.

Before a run, the builder should hash-check the selected node and all selected
weights, copy and hash the canonical g01 only into the new private input root,
and validate a static workflow. A later run must have its own bounded local
admission, owned process/PID record, original-resolution visual inspection, and
exact teardown. This capability note neither admits nor starts that work.
