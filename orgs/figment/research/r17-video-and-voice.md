# R17 — video + voice research

Research date: 2026-09-03. Scope: clothed Instagram-tier proof work only. No download,
installation, inference, account, or spend occurred. `PIN-ON-ADMISSION` is deliberate:
the source pages expose moving `main` refs and this research environment could not resolve
Git SHA refs. The harness must resolve each public Git `HEAD` and each HF file revision to a
full immutable SHA before accepting a manifest; reject a floating ref. Do not substitute an
unverified community workflow or installer for the cited source.

## 1. Recommended stage-6 chain

The decision is **Wan 2.2 TI2V-5B on a 24-GB 4090 for the base proof; Wan 2.2 Animate-14B on
48 GB for driver-video shots; Stand-In is the first identity-adapter experiment, not a quality
claim.** This follows R14 modules 08/14: make the persona-swapped first frame from the driving
clip, then animate it. The driver needs one visible adult, stable lighting/background, a
continuous 5–8 s movement, unobscured face/hands, no jump cuts/fast zooms/motion blur; reject
cuts, occlusions, crowd interaction, whip pans, or an implausible start frame. [R14](r14-10sorlabs-package.md)
§08, §14; [R2](r2-video.md) (2026-08-31).

| Pass / harness entry | Public source + immutable pin required | Licence / GPU | Start point (calibrate, do not treat as vendor optimum) | Decision and evidence |
|---|---|---|---|---|
| **Base I2V — ship candidate** | [Wan2.2 TI2V-5B](https://huggingface.co/Wan-AI/Wan2.2-TI2V-5B) `revision=PIN-ON-ADMISSION`; [ComfyUI Wan 2.2 template](https://docs.comfy.org/tutorials/video/wan/wan2_2) `git_ref=PIN-ON-ADMISSION` | Apache-2.0; 24 GB with model/T5 CPU offload (official); 48 GB preferred. | 480×832, 81 frames/16 fps (5.1 s) or 121 (7.6 s); portrait source at same ratio; 20 steps, CFG 4.5, shift 5, fixed seed. Export 16 fps; interpolate only after QA. | Official model card says 720p/24 fps and 4090 with offload; use lower first-pass resolution to leave headroom for identity/QC. Its 5B hybrid is the only recommended 24-GB backbone. [source](https://huggingface.co/Wan-AI/Wan2.2-TI2V-5B) (2026-09-03). |
| **Quality / 48-GB route** | [Wan2.2 I2V-A14B](https://huggingface.co/Wan-AI/Wan2.2-I2V-A14B) `revision=PIN-ON-ADMISSION`; [Wan repo](https://github.com/Wan-Video/Wan2.2) `git_ref=PIN-ON-ADMISSION` | Apache-2.0; official full-performance guidance is 80 GB; 48 GB is only an offload/quantized experiment, not a promise. | 480×832/81 frames first; 30 steps, CFG 5, shift 5; no speed LoRA until the baseline passes. | Native I2V MoE supports 480p/720p, but is not the 4090 default. Test only after 5B establishes the reference/QA path. [source](https://huggingface.co/Wan-AI/Wan2.2-I2V-A14B) (2026-09-03; claim-check corrected the source link 2026-09-03 — was pointing at the TI2V-5B card). |
| **Driver-video / character replacement** | [Wan2.2 Animate-14B](https://huggingface.co/Wan-AI/Wan2.2-Animate-14B) `revision=PIN-ON-ADMISSION`; [Kijai WanVideoWrapper](https://github.com/kijai/ComfyUI-WanVideoWrapper) `git_ref=PIN-ON-ADMISSION` | Apache-2.0; ~24 GB fp8 at 720p is community guidance, 48 GB safer. | Persona-swap a frame from the driver first; 480×832/81 or 121 frames, 20–30 steps, low CFG 3–5. Keep one face, no overlapping people. | The official model is for character animation/replacement; use it when the driver’s exact performance matters. Do not claim 24-GB production reliability until the proof run. [source](https://huggingface.co/Wan-AI/Wan2.2-Animate-14B) (2026-09-03). |
| **Pose/depth control alternative** | [Wan2.2 Fun Control ComfyUI workflow](https://docs.comfy.org/tutorials/video/wan/wan2-2-fun-control) `git_ref=PIN-ON-ADMISSION`; `alibaba-pai/Wan2.2-Fun-A14B-Control` weights, exact revision recorded in manifest | Apache-2.0; official 4090D result at 640²/81 frames consumed 83–89% of 24 GB. | Pre-extract DWPose or depth; 640×640/81 frames; use matched high/low-noise 4-step LightX2V LoRAs only after fp8 baseline. | Useful for pose fidelity, not the first face-preservation route. Official example: 4-step LoRA cut warm generation from ~524 s to ~138 s but may reduce dynamics. [source](https://docs.comfy.org/tutorials/video/wan/wan2-2-fun-control) (2026-09-03). |
| **Start/end repair** | [Wan2.2 Fun InP](https://docs.comfy.org/tutorials/video/wan/wan2-2-fun-inp) `git_ref=PIN-ON-ADMISSION`; matching official weight revision | Apache-2.0; budget 24–48 GB until measured. | Supply approved start/end stills only; 81/121 frames; use for loop closure or a damaged tail, never to hide a failed clip. | First/last-frame constraint is the cleanest reel-loop tool; it is not identity control. [source](https://docs.comfy.org/tutorials/video/wan/wan2-2-fun-inp) (2026-09-03). |
| **Identity experiment** | [Stand-In](https://github.com/WeChatCV/Stand-In) + [official preprocessor](https://github.com/WeChatCV/Stand-In_Preprocessor_ComfyUI), both `git_ref=PIN-ON-ADMISSION` | Apache-2.0; base Wan dominates VRAM (treat as 48-GB preferred). | One sharp frontal anchor; simple prompt (“woman”, no conflicting facial traits); run Stand-In alone before VACE. | Wan2.2 version exists and VACE+Stand-In needs scale balancing; its authors say VACE has face bias and the combined path remains harder. This is the best evidence-backed adapter trial, not proof it beats a persona LoRA. [source](https://github.com/WeChatCV/Stand-In) (2026-09-03). |
| **Persona LoRA** | [diffusion-pipe](https://github.com/tdrussell/diffusion-pipe) and [musubi-tuner](https://github.com/kohya-ss/musubi-tuner), `git_ref=PIN-ON-ADMISSION` | Check every Wan 2.2 target/base/LoRA licence at admission; training needs 48–80 GB class until a documented 24-GB recipe is reproduced. | Do not train before the stage-3 identity set and checkpoint-ranking harness exist. Train only clothed data on rented compute; hold fixed frame/prompt/driver grid to rank checkpoints. | Research found no official, reproducible diffusion-pipe Wan2.2 LoRA recipe sufficient to promise a 4090 training run. R14’s transferable lesson is fixed-prompt checkpoint selection, not its unobserved numeric settings. [R14](r14-10sorlabs-package.md) §11 (2026-09-03). |
| **Do not make FaceDetailer a video pass** | [Impact Pack warning](https://www.runcomfy.com/comfyui-nodes/ComfyUI-Impact-Pack/FaceDetailer) `git_ref=PIN-ON-ADMISSION` | Node/code and detector/checkpoint licences must all pass admission; frame batch needs 12–24 GB. | Detect/score every frame; permit low-denoise repairs only on quarantined still frames and compare adjacent-frame identity before accept. | FaceDetailer explicitly warns it is not a video-detail node. Per-frame repainting is likely to create flicker; use it as a reject/repair experiment, not the default. [source](https://www.runcomfy.com/comfyui-nodes/ComfyUI-Impact-Pack/FaceDetailer) (2026-09-03). |
| **Temporal QA / de-gloss** | Harness-owned OpenCV/ffmpeg cells; [RIFE](https://github.com/megvii-research/ECCV2022-RIFE) `git_ref=PIN-ON-ADMISSION` | RIFE code: MIT; 8–12 GB inference. | Save all decoded frames. Gate: face-detection coverage, ArcFace cosine per frame and slope, optical-flow residual/flicker score, hand/teeth masks, and a contact sheet. Apply subtle grain/phone-sensor LUT consistently to the full clip only; never frame-random noise or smoothing. | Interpolation can increase FPS but cannot repair identity or motion. RIFE supports arbitrary-time interpolation; de-gloss is a whole-clip texture treatment plus human QA, not “beauty” smoothing. [source](https://arxiv.org/abs/2011.06294) (2026-09-03). |
| **Upscale after acceptance** | [SeedVR2](https://github.com/IceClear/SeedVR2) + [ComfyUI path node](https://github.com/ethanfel/ComfyUI-SeedVR2_VideoPathUpscaler), `git_ref=PIN-ON-ADMISSION` | Apache-2.0; 3B fp8: start 24 GB with tiled/block swap; 7B/FP16: 48 GB preferred. | One 5-s accepted clip: 3B fp8, batch 1, tiled; compare 1080×1920 against source contact sheet. | SeedVR2 is a one-step video restoration model with released code/weights and ComfyUI support. It can hallucinate detail, so rerun the same face/flicker gates after upscale. [source](https://github.com/IceClear/SeedVR2) (2026-09-03). |

**Explicitly not a default chain:** Phantom/MAGREF/SkyReels-A2 remain optional identity bake-off arms. Phantom has Wan 1.3B/14B ComfyUI adaptation but targets Wan 2.1; SkyReels-A2’s documented preview is also Wan 2.1. VACE is a general editor, not the preferred face path. ReActor/FaceFusion-style video face swaps may hide drift but inherit face-recognition/model licence and consent risks; use neither until a component-by-component commercial licence review passes. [Phantom](https://github.com/Phantom-video/Phantom), [SkyReels-A2](https://github.com/SkyworkAI/SkyReels-A2) (2026-09-03).

### Required video gates

1. Decode frames; record frame count/fps/seed/workflow/model file SHA. Fail on decode or missing face.
2. Compute ArcFace anchor cosine at every detected face, median/minimum/slope and worst-frame thumbnails. Thresholds are **calibration values**, locked only after a 20-clip labeled set; never invent a universal pass score.
3. Measure adjacent-frame face-embedding delta and optical-flow warp residual; inspect the top five spikes for flicker, identity jump, hands, teeth, and skin gloss.
4. Only then RIFE (if required) and SeedVR2; repeat gates 1–3 and an eye gate. Quarantine, do not “repair until pass.”

## 2. Reel template manifest schema

```yaml
id: string
tier: instagram_clothed
aspect_ratio: "9:16"
duration_s: 5..15
hook: {start_s: 0, visual: string, text: string?}
beats: [{at_s: number, duration_s: number, shot: string, motion: string}]
driver: {asset: path, start_frame_index: int, control: pose|depth|animate}
identity: {anchor: path, lora: ref?, adapter: ref?, min_face_score: number}
generation: {workflow: path, model_sha: string, seed: int, frames: int, fps: int}
cuts: [{at_s: number, kind: hard|match|speed_ramp}]
loop: {enabled: bool, end_frame: reuse_start|inpainted_end|none}
overlay: {style: string, safe_area: string, captions: path?}
audio: {voice_manifest: path?, bed: ref?, duck_db: number, beat_marks: [number]}
qa: {identity: true, flicker: true, gloss: true, human_gate: true}
```

Grammar: hook in 0–1 s; use 1–3 readable beats in 5–8 s (not a cut every second); reserve 10–15 s for a second reveal; end on a visual that can plausibly return to the start. Audio bed and text are authored fields, never scraped trending audio. Format decisions need live cohort research before production; this is an executable shape, not a current Instagram performance claim.

## 3. Voice chain recommendation

FYT transfers directly: keep one locked voice per creator; dry-run/transcript/manifest before any
generation; collect word timings for visual sync; use punctuation first and sparse expressive controls;
measure actual silence before adding a pause; make route choice and QA explicit. Its breath code pads
only the shortfall to a measured target (rather than stacking a fixed pause on natural prosody), and
snaps visual timing to measured acoustic onset. Keep those rules; do not copy FYT’s paid ElevenLabs
provider route. [FYT voice contract](../../faceless-youtube/.claude/skills/voiceover/references/voiceover-contract.md),
[breath implementation](../../faceless-youtube/.claude/skills/render-builder/scripts/breath.py) (read 2026-09-03).

| Rank / harness entry | Public source + immutable pin required | Licence / VRAM | Mode, language, naturalness/cadence position | Recommendation / evidence |
|---|---|---|---|---|
| **1. Clone / production candidate: CosyVoice 3 0.5B** | [QwenAudio/CosyVoice](https://github.com/QwenAudio/CosyVoice) `git_ref=PIN-ON-ADMISSION`; `Fun-CosyVoice3-0.5B-2512`, `revision=PIN-ON-ADMISSION` | Apache-2.0 repository; **verify weight card separately**; ~8–12 GB inferred practical budget. | Zero-shot, multilingual/cross-lingual; English, Mandarin, and Guangdong/Cantonese dialect coverage; instruction control for emotion/speed/volume. | Best default because it combines cloning, Mandarin/Cantonese scope, prosody controls, and a permissive code licence. Naturalness ranking is a local blind-test result, not a vendor claim. [source](https://github.com/QwenAudio/CosyVoice) (2026-09-03). |
| **2. English / tag-rich candidate: Chatterbox Turbo or Multilingual V3** | [resemble-ai/chatterbox](https://github.com/resemble-ai/chatterbox) `git_ref=PIN-ON-ADMISSION`; exact HF weight revision | MIT; 350M Turbo / 500M V3; provision 6–10 GB. | Zero-shot reference; Turbo English with native paralinguistic tags; V3 23+ languages and cross-language clone. | First A/B competitor: V3 targets improved speaker similarity/conversational naturalness; Turbo exposes laughter/chuckle controls. Confirm Cantonese in its current language list before route selection. [source](https://github.com/resemble-ai/chatterbox) (2026-09-03). |
| **3. Controlled-duration candidate: IndexTTS-2/2.5** | [index-tts/index-tts](https://github.com/index-tts/index-tts) `git_ref=PIN-ON-ADMISSION`; exact weight revision | Bilibili Model Use License; commercial review required (separate licence above stated MAU/revenue thresholds); provision 14–24 GB. | Zero-shot clone; English, Mandarin, Japanese, Spanish, Arabic per the **vendor** model card; Cantonese (`yue`) is claimed only by the third-party vLLM-Omni serving recipe below, not by the vendor card — treat as unconfirmed until checked live. | Keep as an audition arm, not default, because its licence is conditional **and** its Cantonese capability is unconfirmed. vLLM recipe documents a `--lang yue` client flag; the vendor's own [HF model card](https://huggingface.co/IndexTeam/IndexTTS-2.5) lists Chinese/English/Japanese/Spanish/Arabic with no Cantonese mention — resolve this conflict before choosing IndexTTS for a Cantonese route. [recipe source](https://github.com/vllm-project/vllm-omni/blob/main/recipes/IndexTeam/IndexTTS-2_5.md) (2026-09-03; conflict flagged by claim-check 2026-09-03). |
| **4. Expressive candidate: Higgs Audio V2.5** | [boson-ai/higgs-audio](https://github.com/boson-ai/higgs-audio) `git_ref=PIN-ON-ADMISSION`; exact weights/tokenizer revision | Apache-2.0 repository, but audit tokenizer/weight terms; 1B V2.5, provision 16–24 GB. | Zero-shot reference, multi-speaker/dialogue, prosody and background-audio capability. | Audition only. It can overproduce sound/music; keep the output dry and let the reel manifest own the bed. [source](https://github.com/boson-ai/higgs-audio) (2026-09-03). |
| **Rejected for revenue use: F5-TTS** | [SWivid/F5-TTS](https://github.com/SWivid/F5-TTS) `git_ref=PIN-ON-ADMISSION` | Code MIT; released pretrained models CC-BY-NC / non-commercial. ~3–6 GB. | Zero-shot, English/Mandarin variants. | Strong research baseline, **not commercial route** without different rights-cleared weights. [source](https://github.com/SWivid/F5-TTS) (2026-09-03). |
| **Rejected for revenue use: Fish Speech / OpenAudio** | [fishaudio/fish-speech](https://github.com/fishaudio/fish-speech) `git_ref=PIN-ON-ADMISSION` | Fish Audio Research License: commercial use needs a separate written licence; ~12–24 GB. | Zero-shot multilingual clone. | Do not route production through it under current terms. [source](https://github.com/fishaudio/fish-speech/blob/main/LICENSE) (2026-09-03). |
| **Not a clone: Kokoro; experimental: VibeVoice/Dia/XTTS-v2** | [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M), [VibeVoice](https://github.com/vibevoice-community/VibeVoice), [Dia](https://github.com/nari-labs/dia), [XTTS-v2](https://huggingface.co/coqui/XTTS-v2), each exact revision at admission | Kokoro Apache-2.0, no reference clone; VibeVoice repo MIT; Dia/XTTS weight licences must pass separately. 0.5–12 GB depending model. | Use only for synthetic-reference design or a non-clone control; verify each language/capability live. | They are not ranked production candidates because a public claim/weight licence is insufficient for this persona-cloning route. [VibeVoice source](https://github.com/vibevoice-community/VibeVoice) (2026-09-03). |
| **Lip sync — quality default** | [LatentSync 1.6](https://github.com/bytedance/LatentSync) + [ComfyUI node](https://github.com/lvqunx/ComfyUI-LatentSync), both `git_ref=PIN-ON-ADMISSION` | Apache-2.0; official min inference: 18 GB for 1.6 (8 GB for 1.5). | Existing approved video + final WAV; 512 face crop; 20 steps, guidance 1.5, fixed seed. | Preferred for a close/medium talking reel: v1.6 targets 512² blur reduction and v1.5 added temporal layers. It edits mouths, so rerun face QA. [source](https://github.com/bytedance/LatentSync) (2026-09-03). |
| **Lip sync — speed fallback** | [MuseTalk](https://github.com/TMElyralab/MuseTalk) + [ComfyUI-MuseTalk](https://github.com/chaojie/ComfyUI-MuseTalk), `git_ref=PIN-ON-ADMISSION` | MIT code; project says trained models allowed commercially, but dependency terms still bind; minimum demonstrated 4 GB. | Existing video + final WAV; first-frame parameter audition, then whole 5–8 s clip. | Use only if LatentSync misses latency/cost target; quality gate decides. [source](https://github.com/TMElyralab/MuseTalk) (2026-09-03). |

### Synthetic reference voice and evaluation

1. Write a persona voice brief: age-appropriate fictional adult, language/accent, warmth, pace,
   brightness, laugh/breath restraint, and prohibited real-person resemblance. Generate 20 short
   **synthetic** candidate samples with a legally permitted non-cloning route; record model/file SHA,
   prompt, and output rights. Never upload a real person’s voice as a clone reference.
2. Human ear-gate 3 candidates, then make 10–20 s clean mono reference clips with exact transcripts.
   Clone each into CosyVoice 3 and Chatterbox. Persist `voice_id`, reference SHA, model SHA, seed,
   language, transcript, WAV, word timings, and QA scores in a creator-local manifest.
3. Script cadence: punctuation first; sparse approved breath/sigh/laugh tags only where the chosen
   engine supports them; measure low-RMS silence, then insert only the shortfall. Preserve actual word
   onset timing for captions/cuts/lip sync. This is the FYT transfer most likely to avoid metronomic VO.
4. Blind ABX: 20 matched, CC-licensed, consented adult phone-quality clips (same language, 4–12 s);
   normalise loudness and hide source/model. Each listener gets A/B then X, plus 1–5 naturalness,
   cadence, breath plausibility, intelligibility, and “would this pass as a phone voice note?”; randomise
   order, require ≥5 local raters, and report confidence intervals. Keep clips as evaluation material,
   never clone them. Automated companion scores: [UTMOS](https://github.com/sarulab-speech/UTMOSv2) and
   NISQA-TTS, plus WER from ASR, speaking-rate and pause-share distributions. Metrics triage; human ABX
   decides. [NISQA](https://github.com/gabrielmittag/NISQA) (2026-09-03) documents TTS naturalness
   estimation; UTMOSv2 source added by claim-check (2026-09-03) — was previously uncited.
5. Lip-sync only the winning final WAV into an already-approved face-motion clip; measure SyncNet
   confidence (LatentSync exposes an evaluation path), inspect consonant closures and teeth/mouth seams,
   then re-run identity/flicker QA. [source](https://github.com/bytedance/LatentSync) (2026-09-03).

## 4. Rejected alternatives

| Alternative | Reject / hold reason |
|---|---|
| Kling/Veo/other hosted video | Instagram-only fallback where current terms and human approval allow; never a rented-compute workaround, never explicit tier. R2’s policy/cost findings require live recheck. |
| Wan A14B as the first 4090 proof | Official guidance makes 5B the credible 24-GB path; A14B adds offload/quantisation uncertainty. |
| VACE as the identity default | General editor/control compositor; Stand-In’s own notes identify identity-vs-control balancing difficulty. |
| Per-frame FaceDetailer / automatic face swap | Temporal discontinuity plus checkpoint/consent licence uncertainty; it must not launder a failed generation. |
| Frame interpolation before QA | It multiplies a defect and obscures the generator’s actual motion quality. |
| Topaz-class proprietary enhancement | Spend and closed terms; SeedVR2 is the first open, licence-clean comparison arm. |
| F5-TTS, Fish Speech for monetised output | Weight/research licences are not commercial permissions. |
| Kokoro as a cloning chain | Useful non-cloning synthetic voice/control, but does not satisfy per-creator voice clone. |
| Wav2Lip/SadTalker/Hallo/EchoMimic/OmniHuman/InfiniteTalk/MultiTalk | Keep as research-only alternates: verify current model weights, commercial terms, VRAM and ComfyUI API workflow before any harness entry; no evidence here supports making one the default over LatentSync/MuseTalk. |

## 5. Two harness proof runs (clothed data only)

| Run | Manifest cells (all public sources pinned at admission) | Expected 4090 cost at $0.50/h | Acceptance |
|---|---|---:|---|
| **V1: I2V identity-motion proof** | `custom_nodes`: ComfyUI built-ins + Kijai WanVideoWrapper; `models`: Wan2.2-TI2V-5B, VAE/T5 exact filenames and HF SHAs; `workflow`: first-frame I2V → decode frames → ArcFace/flicker contact sheet → optional RIFE → SeedVR2 3B fp8 → repeat QA; `jobs`: two fixed-seed 480×832/81-frame drivers (held pan, simple gesture). | 25–45 min incl. bootstrap ⇒ **$0.21–$0.38**; model cache/cold start can make this a measured, not guaranteed, estimate. | Both clips decode; no QA hard failure; report pre/post-upscale cosine trend and flicker spikes; human eye gate selects/declines one. No retries that change the reference/driver. |
| **V2: voice-led talking reel** | `custom_nodes`: LatentSync ComfyUI node only; `models`: LatentSync 1.6 + Whisper tiny exact SHAs; `workflow`: approved V1 clip + 6-s synthetic-reference CosyVoice/Chatterbox WAV (generated locally/offline) → LatentSync 512 → decode → SyncNet/face/flicker QA; `jobs`: one fixed video/audio pair. | 20–35 min ⇒ **$0.17–$0.29**; TTS is not run on pod and adds no pod cost. | Audio is synthetic, clothed source only; lip closure/teeth pass eye gate; no identity floor breach; manifest contains WAV/transcript/word timings/model SHAs. |

Both manifests must set `max_usd: 0.50`, one pod/job, no auto-retry, a completion watchdog, and
the existing harness’ termination verification. They are **proposals** until a human approves spend;
the research result itself authorises neither run.

## 6. Claims table

| ID | Factual claim | Source (accessed) | Confidence |
|---|---|---|---|
| C1 | Wan TI2V-5B is Apache-2.0, supports T2V/I2V 720p at 24 fps, and its official instructions show 24-GB/4090 offload. | [HF model card](https://huggingface.co/Wan-AI/Wan2.2-TI2V-5B), 2026-09-03 | High |
| C2 | Wan I2V-A14B supports 480p/720p; its own official docs reserve full-speed single-GPU settings for 80-GB GPUs. | [HF model card](https://huggingface.co/Wan-AI/Wan2.2-I2V-A14B), 2026-09-03 | High |
| C3 | Fun Control is Apache-2.0/commercial and its 4090D 81-frame benchmark shows 4-step acceleration trades some dynamics for speed. | [ComfyUI guide](https://docs.comfy.org/tutorials/video/wan/wan2-2-fun-control), 2026-09-03 | High |
| C4 | Wan Animate-14B is Apache-2.0 and is released for character animation/replacement. | [HF model card](https://huggingface.co/Wan-AI/Wan2.2-Animate-14B), 2026-09-03 | High |
| C5 | Stand-In has Wan2.2 and VACE-compatible versions; its authors warn combined VACE control needs balancing. | [Stand-In](https://github.com/WeChatCV/Stand-In), 2026-09-03 | High |
| C6 | R14’s motion doctrine is persona-swapped driving-frame first, then animate; its numerical settings were not recoverable. | [R14 local research](r14-10sorlabs-package.md), 2026-09-03 | High |
| C7 | FaceDetailer warns it is not a video detailing node. | [Impact Pack node page](https://www.runcomfy.com/comfyui-nodes/ComfyUI-Impact-Pack/FaceDetailer), 2026-09-03 | Medium |
| C8 | RIFE supports arbitrary-timestep interpolation. | [RIFE paper](https://arxiv.org/abs/2011.06294), 2026-09-03 | High |
| C9 | SeedVR2 publishes Apache-2.0 code/weights and describes a one-step video restoration model with ComfyUI support. | [SeedVR2](https://github.com/IceClear/SeedVR2), 2026-09-03 | High |
| C10 | CosyVoice 3 reports zero-shot cross-lingual cloning, English/Chinese and Guangdong dialect coverage, plus instruction controls. | [CosyVoice](https://github.com/QwenAudio/CosyVoice), 2026-09-03 | High |
| C11 | Chatterbox V3 is 500M/23+ languages; Turbo is 350M English with paralinguistic tags; repo is MIT. | [Chatterbox](https://github.com/resemble-ai/chatterbox), 2026-09-03 | High |
| C12 | IndexTTS-2.5's vendor model card lists English, Mandarin, Japanese, Spanish, Arabic (no Cantonese); a third-party vLLM-Omni serving recipe separately exposes a `--lang yue` (Cantonese) flag not corroborated by the vendor. Its licence has scale conditions (100M MAU / RMB 1B annual revenue trigger a separate licence). | [vendor model card](https://huggingface.co/IndexTeam/IndexTTS-2.5), [vLLM recipe](https://github.com/vllm-project/vllm-omni/blob/main/recipes/IndexTeam/IndexTTS-2_5.md), [licence](https://github.com/index-tts/index-tts/blob/main/LICENSE), 2026-09-03 | Medium |
| C13 | F5 code is MIT but its released pretrained models are CC-BY-NC. | [F5-TTS](https://github.com/SWivid/F5-TTS), 2026-09-03 | High |
| C14 | Fish Audio’s current research licence requires separate written commercial permission. | [Fish licence](https://github.com/fishaudio/fish-speech/blob/main/LICENSE), 2026-09-03 | High |
| C15 | LatentSync 1.6 is 512², has an 18-GB inference minimum, Apache-2.0 code, and an evaluation path. | [LatentSync](https://github.com/bytedance/LatentSync), 2026-09-03 | High |
| C16 | MuseTalk code is MIT, project-trained models permit commercial use, and its demo was tested at 4 GB. | [MuseTalk](https://github.com/TMElyralab/MuseTalk), 2026-09-03 | High |
| C17 | NISQA-TTS estimates synthetic speech naturalness; automated MOS is not a replacement for listeners. | [NISQA](https://github.com/gabrielmittag/NISQA), 2026-09-03 | High / inference |
| C18 | FYT stores spoken transcript/word timing, dry-runs before spend, and its breath logic measures natural silence before padding. | [voice contract](../../faceless-youtube/.claude/skills/voiceover/references/voiceover-contract.md), [breath](../../faceless-youtube/.claude/skills/render-builder/scripts/breath.py), 2026-09-03 | High |

## Claim-check (2026-09-03, sonnet)

Every §6 row (C1–C18) plus the licence/VRAM/capability statements in §1 and §3 were re-fetched
against primary sources (HF model cards, GitHub repos/LICENSE files, `gh api`) or, for C18, the
local FYT files. **16 VERIFIED, 1 PARTLY (citation-URL fix), 1 WRONG (factual conflict), 1 not
externally checkable (C6, an internal claim about r14).** No named model/version was found to be
hallucinated — Chatterbox Turbo, Chatterbox Multilingual V3, IndexTTS-2.5, Higgs Audio V2.5,
LatentSync 1.6, and CosyVoice 3 all confirmed as real, currently-shipping releases.

Corrections applied in this file:
1. **C2 / §1 "Quality / 48-GB route"** — source link pointed at the TI2V-5B model card for a claim
   about the I2V-A14B model; fixed to link the I2V-A14B card.
2. **C12 / §3 IndexTTS row (WRONG)** — IndexTTS-2.5's own vendor model card
   ([IndexTeam/IndexTTS-2.5](https://huggingface.co/IndexTeam/IndexTTS-2.5)) lists supported
   languages as Chinese, English, Japanese, Spanish, Arabic — **no Cantonese**. The Cantonese
   (`yue`) claim traced only to a third-party vLLM-Omni community serving recipe's `--lang yue`
   flag, not to the vendor. Reworded to flag the conflict and downgraded confidence High → Medium.
   This matters because Cantonese capability is part of why CosyVoice 3 is ranked #1 in §3.
3. **§3.5 step 4** — added a missing citation for UTMOS
   ([sarulab-speech/UTMOSv2](https://github.com/sarulab-speech/UTMOSv2)); it was the only uncited
   factual assertion in the document.

Omissions vs. the brief (`briefs/r4-video-voice.md`), not corrected in-place (would require new
research, out of scope for a claim-check):
- **Uni3C** — never mentioned, despite being named in brief Q2 alongside VACE/pose-driven paths.
- **lightx2v/self-forcing distill LoRAs for I2V** — only scoped to the Fun Control row, never
  evaluated against the base TI2V-5B/I2V-A14B speed path the brief actually asked about.
- **MAGREF** — named once in §4 with zero licence/version/VRAM detail (Phantom and SkyReels-A2 each
  get a sentence; MAGREF gets none).
- **GIMM interpolation** — brief named "RIFE/GIMM"; GIMM never appears.
- **InfiniteTalk/MultiTalk** — explicitly named in brief Q7, but only deferred in §4's rejected-list
  ("verify... before any harness entry"), never actually researched for quality/licence/VRAM/ComfyUI
  support.
- **"TTS-of-TTS bootstrapping" / voice-design-prompt models** — brief Q6 named these techniques
  explicitly; §3.5's synthetic-voice steps do the equivalent procedurally but never name or cite them.

Full verdict table with per-claim source quotes: `scratchpad/reviews/claimcheck-r17.md` (this
session's scratchpad, not in this repo).
