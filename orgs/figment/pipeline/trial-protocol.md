# W0 confirmation trial — protocol

Approved 2026-08-31, cap $40. Arms: (A) SDXL RealVisXL + persona LoRA, (B) Flux.1-dev
+ persona LoRA (comparison only — commercial use needs BFL license), (C) ZenCreator
head-to-head, (V) video micro-test: Kling multi-ref + Wan 2.2 i2v from arm-A stills.

## Test character ("trial-01" — throwaway, not persona A)

100% synthetic. Stated age 25; visual age unambiguously adult. Neutral identity:
East-Asian-diaspora register per board v4, no youth-coding, no named likeness.
Reference set: ~20 curated images — portraits + casual-clothed, varied angle
(front/three-quarter/profile), varied lighting (window/ambient/night-interior),
varied distance. Generated locally (SDXL, 768px), curated for same-face coherence,
upscaled on pod before training.

## Stills protocol (arms A, B, C)

- 40 stills per arm from the locked 10-prompt matrix below, 4 seeds each; swimwear
  ceiling; no re-prompting — failures are data.
- Prompt matrix (locked): 1 bedroom window-light portrait · 2 mirror selfie ·
  3 night-interior ambient close-up · 4 held-pose camisole mid-shot · 5 outdoor
  golden-hour street · 6 swimwear poolside mid-shot · 7 seated couch casual ·
  8 close-up face + hands visible · 9 full-body standing streetwear · 10 low-light
  phone-flash look.
- Blinded grading: all 120 shuffled, arm-stripped, graded by a fresh agent per the
  rubric; a second grader on disagreements.
- Rubric (3-state per image: pass / soft-fail / hard-fail) on: identity match vs
  reference sheet · skin/texture realism (anti-gloss) · hands + detail integrity ·
  lighting plausibility. Arm score = pass-rate + failure taxonomy.
- Regen stability: re-run prompts 1/6/8 next day, same seeds where supported; drift
  graded.
- Also record per arm: wall-clock, $ actual, throughput, ops friction notes.
  LoRA training wall-clock is a first-class result (the plan's unbounded quantity).

## Video micro-test (arm V)

From 2 approved arm-A stills: Kling multi-image-ref (2 takes × 2 shots: slow pan,
simple motion) + Wan 2.2 TI2V-5B on pod (same). Reject on identity change / hand warp
/ gloss / non-causal fabric-hair. n small — directional only, full video bake-off
deferred to W2 if needed.

## Compute + spend map

- Local (free): reference-candidate generation, curation, grading.
- RunPod 24GB (SFW workload only): LoRA trains + 40-still batches + upscales +
  Wan clips. Est. $8–15 wall-clock.
- ZenCreator: $19.99 credit pack. Kling: ~$3–6 API. Veo: skipped at trial.
- DANIEL-ONLY: account creation + payment for RunPod / ZenCreator / Kling.
  Keys land in runner env, never repo.

## Exit

Decision memo: winner per rubric, LoRA wall-clock pinned, SaaS-vs-own verdict,
explicit-lane hardware recommendation. Opus adversarial review → Daniel gate → W1.
