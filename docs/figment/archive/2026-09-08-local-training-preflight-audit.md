# Local training preflight audit — 2026-09-08

This records the completed local readiness checks for the one-observation LoRA plan. It does not authorize GPU fitting, checkpoint acceptance, LoRA export, or any production path.

`MAIN_PRIVATE` below is `C:\Users\danie\kb\_private`. `STUDIO_PRIVATE` is
`C:\Users\danie\kb\_private\codex-worktrees\figment-studio-20260908\_private`.

## Frozen inputs

The plan at `STUDIO_PRIVATE/local-lora-single-observation-20260908-v1/local-single-observation-plan.json` currently has raw SHA-256 `cba60c9b1157ee90f322f5bdd13382fb27a99de7e2d0245a8ce033baf198fa9d` and canonical frozen hash `e9de0980ae27f8fb1e98398a685f81a18bdb6dd27e70d07ec4dff38d2aac75ea`. The staged `g01.jpg`, `g01.txt`, and `fit-probe.toml` still match the plan's declared hashes: respectively `e2f5…27536ed`, `de34…092c569`, and `9ab8…960119`.

## CPU dataset/config parsing

The completed V3 receipt is `MAIN_PRIVATE/figment-local-cpu-preflight-20260908-v3/receipt.json`, raw SHA-256 `8a9831fd42b173af2cd7bfb2fbe9239a56b4a4618eb46d147cff3bbf02da8bb0`. It is a `figment/local-cpu-preflight-launch@1` completion bound to the frozen plan, parser hash `243179…7336e`, planner hash `3fe3…b094`, and V3 launcher `MAIN_PRIVATE/run-figment-local-cpu-preflight-20260908-v3.py` at hash `100b…2b310`. The parser returned one unique observation, one repeat, the frozen 331-byte caption file, target resolution 768×768, and effective bucket 896×512.

The process exited 0 after 5.451 seconds. Its result recorded `CUDA_VISIBLE_DEVICES=-1`, NVML-based CUDA checking, CUDA unavailable, zero visible CUDA devices, and no CUDA initialization. The receipt's retained wrapper PID 40192 and child PID 37776 were verified stopped; a later local process/listener check found neither PID. The planned `no-output` and `no-logs` directories are absent. This is a parser result, not a model load, fit, checkpoint, sample, or export.

V1 and V2 remain failure evidence, not erased retries. V1 (`failure.json` raw SHA-256 `e518f48031fd0f3d4aa49f2bc317e74b4b9bbfb4cb183c41fa81e851b2bf2380`) failed with parser exit 2 after 9.984 seconds before the causal diagnostic was preserved. V2 (`failure.json` raw SHA-256 `bed41207e6d3b2047e3bee4f87cf38cded56d7ecd5e31843299328c1b1e5415b`) failed with parser exit 2 after 7.215 seconds; its bounded error named a Diffusers AutoencoderKL import failure ending in `Invalid device id`. Both receipts record verified owned-process teardown.

The support for the V3 mask was separately tested under the fixed local venv in `MAIN_PRIVATE/figment-cuda-mask-probe-20260908-v1/result.json` (raw SHA-256 `34d9224c13f6660fb524cee23c8420f47ae18053e4d9fdf52cba07424f00db86`). With `CUDA_VISIBLE_DEVICES=-1` and `PYTORCH_NVML_BASED_CUDA_CHECK=1` set before torch import, it reported CUDA unavailable, zero devices, and no initialization. The installed torch source documents its NVML availability branch; the exact xFormers import route behind V2 is an inference from the bounded V2 cause and local import-source inspection, not a captured traceback.

## Local tokenizer loading

The completed launcher receipt is `MAIN_PRIVATE/figment-local-tokenizer-load-20260908-v1/receipt.json`, raw SHA-256 `30ea57c86eb4d473ddc6f325f19d5fb6712a203542cd34ca1e238173359f5ffd`. It binds the tokenizer-load receipt at `STUDIO_PRIVATE/local-lora-tokenizers-20260908-v1/local-tokenizer-load.json`, raw SHA-256 `16b3ea1e97ec6e6918c26f135f5409bc785c0f6d70625417e37bd8c86ce513e4` and canonical frozen hash `59bb4ec29fac75b65230d904d0f3a3e05b5c2e452eeee78483fb504ec44f0f81`. The separately prepared receipt remains distinct: raw SHA-256 `c0c2208edafd7c57dbc2df5361176125c2465e1bf41ee691e9ba8ac593179518`, frozen hash `7708c8187943c8e210371c12294398787115fa788d307e26dab9ef085b45f9d1`.

The launcher exited 0 after 3.456 seconds and verified teardown of wrapper PID 17328 and child PID 7660; neither PID remained in a later local process/listener check. It loaded both local-only tokenizer inventories, each producing 19 tokens for the fixed availability-probe `CAPTION_PROBE`, not for the 330-byte training-caption content. `openai/clip-vit-large-patch14` used effective pad token 49407; `laion/CLIP-ViT-bigG-14-laion2B-39B-b160k` used effective pad token 0. A read-only rehash found all ten copied tokenizer files in `STUDIO_PRIVATE` present with matching declared bytes and SHA-256 values. Torch was imported under the same no-device mask and reported unavailable CUDA, zero devices, and no initialization.

This proves only local tokenizer material and caption parsing for this frozen request. It does not prove a GPU trainer can fit in memory, that a useful LoRA will result, or that the one-observation dataset is eligible for production.
