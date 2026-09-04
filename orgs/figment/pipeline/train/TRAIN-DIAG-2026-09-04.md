# Training pod diagnosis — 2026-09-04

Status: code hardened; no third pod was launched. Attempt 2 does not identify one proven OOM
mechanism because the old failure path destroyed its own evidence channel.

## Actual process sequence

```mermaid
sequenceDiagram
    participant H as local harness
    participant B as bootstrap.sh
    participant W as training wrapper
    participant C as ComfyUI transport
    participant T as ai-toolkit trainer
    H->>B: create pod (wrapper embedded)
    B->>B: install ComfyUI v0.20.1; download Krea checkpoint
    B->>W: start comfyui.start_command in background
    W->>W: install pinned ai-toolkit; restore Comfy requirements; pre-warm
    W->>C: start ComfyUI in background
    B->>C: wait for /system_stats
    H->>C: upload 31 PNG + 31 TXT + training.json + _dataset.ready
    W->>T: nohup run.py; stream log; heartbeat every 30 s
    H->>C: snapshot heartbeat/log; poll failed then complete marker
    T-->>W: exit status
    W->>C: publish result marker and keep transport alive
    H->>B: download artifacts or terminate after bounded failure
```

The wrapper runs *as* `comfyui.start_command`; bootstrap starts it as `COMFY_PID`, checks the
nested Comfy server, then waits on the wrapper. Toolkit install, Comfy-requirements restore,
and pre-warm all precede nested Comfy launch. There is no live-process package swap.

## Attempt evidence

- Attempt 1 failed before readiness when ai-toolkit downgraded PyAV and ComfyUI v0.34.0 could
  not import `ColorPrimaries`. Commit `7fbda213` pinned transport to v0.20.1 and restores its
  requirements after toolkit install.
- Attempt 2 acquired `xzpb5t5a9afbar` at 16:42:01, became ready at 16:52:57, and finished the
  upload at 16:53:47. The first recorded post-upload `/view` 502 was 16:59:26: 5m39s later,
  not about 17:24. Later artifact-marker 502 lines imply the preceding failed-marker request
  sometimes returned an unlogged 404, so the log does not prove one continuous outage.
- `run.json` records no artifacts, verified termination, 3109.688 seconds, and $0.941545 at the
  measured READY rate. Neither `_training.log` nor container stdout was recovered.
- In the old wrapper, trainer nonzero wrote `_training.failed`, exited, and the EXIT trap killed
  ComfyUI immediately. Thus a 502 while reading `_training.failed` is compatible with a plain
  trainer exception or trainer OOM; it does **not** prove the whole container died.
- RunPod says a proxy 502 means the service on the exposed port is not answering, not why it
  stopped ([502 guide](https://docs.runpod.io/pods/troubleshooting/troubleshooting-502-errors)).

## Root-cause ranking

| Rank | Candidate | What the evidence supports |
|---|---|---|
| 1 | Trainer failed during Krea load/cache/first steps | Best fit to timing and old wrapper semantics. Python/config error or CUDA OOM is fully compatible. |
| 2 | Container cgroup RAM OOM | Plausible, unproved. Krea materializes a 26.3 GB bf16 transformer before qfloat8, then loads the bf16 Qwen3-VL-4B encoder. No cgroup value or OOM record was captured. |
| 3 | Container restart/crash loop | Possible, unproved. No Pod status transition or restart timestamp was recorded. |
| 4 | ComfyUI consumed trainer VRAM | Weak. No workflow/model was loaded into Comfy, though the old server could initialize CUDA. CPU-only transport removes even that contention. |

A clean restart would re-run the entire bootstrap and normally reproduce the roughly 11-minute
readiness interval. The intermittent reachability and missing control-plane history do not
establish that sequence; restart/crash-loop remains possible, not demonstrated.

## Pinned ai-toolkit audit

At commit `b36bb3998ae596a566d85513299696a3a78f0dcb`, `arch: krea2`, qfloat8 transformer/text-
encoder quantization, `low_vram: true`, `layer_offloading: false`, and every dataset key are
accepted. The pinned [model schema](https://github.com/ostris/ai-toolkit/blob/b36bb3998ae596a566d85513299696a3a78f0dcb/toolkit/config_modules.py#L617-L657)
and [dataset schema](https://github.com/ostris/ai-toolkit/blob/b36bb3998ae596a566d85513299696a3a78f0dcb/toolkit/config_modules.py#L835-L944)
confirm the names. `caption_ext: txt` is normalized to `.txt`; no dataset key is ignored.
`noise_scheduler: flowmatch` is harmless because Krea supplies its own flow scheduler. The
`sample` block is parsed but inactive under `disable_sampling: true`. The manifest's 8B caption
model is inactive in `caption_mode: provided`; Krea training uses its own 4B text encoder.
`reinstall_torch: "0"` also makes the manifest's `torch_spec` inert: the smoke deliberately
tests the image's Torch 2.8 runtime rather than the pinned toolkit README's Torch 2.13 install.

Quantization is not load-time RAM avoidance: the pinned Krea loader builds the bf16 transformer
before post-load quantization ([loader](https://github.com/ostris/ai-toolkit/blob/b36bb3998ae596a566d85513299696a3a78f0dcb/extensions_built_in/diffusion_models/krea2/krea2.py#L192-L238));
the pinned artifact is [26.3 GB](https://huggingface.co/Comfy-Org/Krea-2/blob/5ea0b6cb7e43749e5202aed076e8ecbe04d2deee/diffusion_models/krea2_raw_bf16.safetensors).
`cache_text_embeddings: true` moves the transformer aside, caches with the encoder, then
unloads the encoder. The renderer now rejects drift in all these memory-sensitive settings.

There is no published numeric Krea-2 LoRA RAM/VRAM floor. RunPod currently lists L40S as
48 GB VRAM / 94 GB RAM at $0.99/h; the manifest retains its conservative $1.30/h ceiling
([pricing](https://www.runpod.io/pricing)). That nominal capacity should fit the staged weights,
but transient duplication and the actual cgroup cap remain unmeasured. A larger class is not
yet evidence-required. If the next log proves RAM OOM, RTX 6000 Ada is 48/167 GB at $0.84/h;
if it proves GPU OOM, A100 PCIe is the least-cost listed 80 GB step at $1.39/h. Both require a
fresh human-approved manifest/budget decision.

## Hardening and next proof

- Both training manifests use ComfyUI v0.20.1 with `--cpu --disable-all-custom-nodes`; both
  flags exist in the pinned [CLI](https://github.com/Comfy-Org/ComfyUI/blob/64b8457f55cd7fb54ca7a956d9c73b505e903e0c/comfy/cli_args.py#L123-L155).
- The wrapper records cgroup/host/GPU/disk/ulimit snapshots at start and pre-train, streams
  trainer output continuously, writes a 30-second heartbeat, records rc plus the last 40 lines
  on failure, and leaves Comfy alive for retrieval. `expandable_segments:True` mitigates CUDA
  allocator fragmentation but cannot fix weight residency or host OOM.
- Every marker cycle snapshots redacted `_training.heartbeat` and `_training.log` locally.
  Five continuous minutes of marker HTTP 502 now fail early and trigger verified teardown.
- The live RunPod [REST OpenAPI](https://rest.runpod.io/v1/openapi.json) has no Pod container-log
  endpoint. The harness therefore cannot legitimately create `_harness/pod.log`; RunPod only
  documents logs in its [console](https://docs.runpod.io/pods/manage-pods#view-logs).
- Smoke job timeout is 1500 s; readiness remains 3600 s; `max_minutes` is 98 (96-minute
  computed floor plus two minutes), for a $2.1233 conservative preflight estimate.

The next L40S smoke will distinguish: advancing heartbeat + log means trainer alive; a failure
marker with tail gives the trainer exception; a frozen heartbeat plus live Comfy isolates the
trainer; loss of all `/view` after recorded limits supports container/server failure. No full
training run is approved until 50 steps save, publish, and return clean state-dict evidence.
