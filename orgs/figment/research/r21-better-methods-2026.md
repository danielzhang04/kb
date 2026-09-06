# R21 — Better Methods for the Consistent-Identity Pipeline (2026 web survey)

Scope: identity LoRA training (FLUX-family/Krea-2 via ai-toolkit), synthetic dataset
generation from an anchor, realism passes without pickle weights, automated
identity/age/quality gating, and cost/speed tricks on one L40S/4090 pod. Every
claim below is tagged **[measured/documented]** (a maintainer, official repo,
license text, or paper) or **[anecdote]** (forum/blog/community consensus, no
controlled measurement). Retrieved 2026-09-06 unless a source states its own date.

## Q1 — Identity LoRA training for FLUX-family/Krea-2

- **Dataset size/diversity** [anecdote]: Krea's own docs say 3 images minimum;
  practical guides converge on 15–40, with "20 high-quality is enough" and a
  mix of ~40% close-up / 30% half-body / 30% full-body to stop the LoRA from
  learning only one framing. — [Krea 2 LoRA training](https://www.krea.ai/blog/krea-2-lora-training) (2026); [chengyansen-ai/krea2-lora-training](https://github.com/chengyansen-ai/krea2-lora-training) v0.4.0 (2026)
- **Captioning** [anecdote, consistent across sources]: for FLUX-family, short/no
  captions beat long narrative captions — strip appearance words and let the
  trigger token carry identity; embed the trigger naturally ("photo of a
  person named X") rather than prepended. Krea 2's own trainer auto-captions
  but lets you edit before training. — [thefluxtrain.com noob's guide](https://thefluxtrain.com/blog/noobs-guide-to-flux-lora-training/) (2026); [Krea 2 LoRA training](https://www.krea.ai/blog/krea-2-lora-training)
- **Rank/alpha/lr/steps** [anecdote, converging]: rank 32 / alpha 32 (Krea-2
  exposes no conv rank), lr 1e-4 with 5e-5 as the stable fallback, ~2500 steps
  first run (3000–4000 with a lower lr), batch 1 with optional grad-accum 2.
  This matches (not exceeds) what the 10sorlabs package already uses. —
  [RunComfy Krea 2 Turbo trainer](https://www.runcomfy.com/trainer/ai-toolkit/krea-2-turbo-lora-training) (2026); [chengyansen-ai/krea2-lora-training](https://github.com/chengyansen-ai/krea2-lora-training)
- **Resolution buckets** [anecdote]: multi-bucket 512+768+1024 recommended for
  Krea-2; one independent guide claims 512-only trains faster and can look
  *better* than 1024, but gives no controlled comparison — treat as unverified.
  — [chengyansen-ai](https://github.com/chengyansen-ai/krea2-lora-training); [thefluxtrain.com](https://thefluxtrain.com/blog/noobs-guide-to-flux-lora-training/)
- **Regularization to fight age/skin drift — this is the strongest new lead**:
  - **Differential Output Preservation (DOP)** [measured/documented — official
    ai-toolkit feature]: Ostris added DOP to ai-toolkit — it re-runs the same
    input through the base model without the LoRA (or trigger blanked) and
    uses that as a target for untouched regions, preserving class knowledge
    and reducing overfitting; costs ~3x train time; requires a trigger word;
    incompatible with `train_text_encoder: true`. This is a known, exact
    mechanism for "don't let training drift into a different age/skin
    texture" that the 10sorlabs package does not appear to use. —
    [Ostris on X, 2026](https://x.com/ostrisai/status/1894588701449322884); [DeepWiki: Differential Output Preservation](https://deepwiki.com/ostris/ai-toolkit/17.3-differential-output-preservation)
  - **Perceptual/identity anchoring fork** [documented, third-party MIT fork,
    not upstream]: `ai-toolkit-perceptual` trains against frozen vision models
    (ArcFace for identity, Depth-Anything-V2 for geometry, ViTPose for body
    proportions) instead of pure pixel loss, explicitly to stop "washed-out
    colors, baked-in lighting, texture burn-in, identity drift." MIT license.
    — [BuffaloBuffaloBuffaloBuffalo/ai-toolkit-perceptual](https://github.com/BuffaloBuffaloBuffaloBuffalo/ai-toolkit-perceptual)
  - Community pitfall list explicitly names "face drifts at inference" and
    "concept bleeding into no-trigger prompts" as known Krea-2 failure modes,
    with `diff_output_preservation` + class `"person"` as the fix, plus
    antelopev2 face-alignment preprocessing. [anecdote, but structured/repeated
    findings] — [chengyansen-ai/krea2-lora-training](https://github.com/chengyansen-ai/krea2-lora-training)
- No better *official Ostris Krea-2 doc* than the ai-toolkit README/examples
  exists beyond DOP — no dedicated Krea-2 whitepaper found.

## Q2 — Building the dataset from a synthetic anchor

- **Qwen-Image-Edit-2511 gloss/age bias is a known, named, current complaint**,
  not something specific to our setup [anecdote, but widespread and repeated
  across independent threads]: "plastic skin" is called a "chronic problem" of
  Qwen Image Edit through the 2511 release; fixes in circulation are (a) a
  dedicated skin-realism LoRA trained on top of 2509/2511 with the trigger
  prompt "make the subject's skin details more prominent and natural", and
  (b) node/sampler-level workarounds (a "one-node fix" for plastic skin
  circulating on YouTube, unverified mechanism). — [Phr00t/Qwen-Image-Edit-Rapid-AIO discussion #270](https://huggingface.co/Phr00t/Qwen-Image-Edit-Rapid-AIO/discussions/270); [tlennon-ie/qwen-edit-skin](https://huggingface.co/tlennon-ie/qwen-edit-skin)
- **Identity claims for 2511 itself** [documented — model card language, not
  independently measured]: Qwen's own card claims 2511 improves character
  consistency and "mitigates image drift" over 2509, including multi-person
  fusion. No independent age/gloss benchmark found. —
  [Qwen/Qwen-Image-Edit-2511 on Hugging Face](https://huggingface.co/Qwen/Qwen-Image-Edit-2511)
- **Alternatives for identity-preserving variation**:
  - **FLUX.2 Klein (multi-reference)** [documented, vendor + community]: Klein
    takes 2–4 (up to 10 cited elsewhere) reference images and composes
    identity+outfit+scene from separate refs, rather than editing one anchor —
    structurally different from Qwen's single-image edit loop. A published
    ComfyUI workflow ("Consistent Character Creator 4.0") turns one reference
    into a 24-shot dataset (poses/expressions/lighting) with a manual identity
    check-and-keep step before captioning — same shape as our pipeline but one
    stage earlier (multi-ref instead of sequential edit). Worth a side-by-side
    test against the Qwen-edit anchor step. — [FLUX.2 Klein spec summary](https://studio.aifilms.ai/blog/flux-2-production-image-generation); [Consistent Character Creator 4.0](https://www.runcomfy.com/comfyui-workflows/consistent-character-creator-4-0-comfyui-flux-2-dataset)
  - **PuLID-Flux vs InstantID** [anecdote, consistent 2026 community framing]:
    "InstantID for stable, PuLID for fidelity"; PuLID-Flux is the maintained,
    FLUX-native option and is called 2026's SOTA for FLUX face-locking;
    InstantID is SDXL-only with unstable community FLUX ports. If we ever
    need an adapter-based identity lock instead of/alongside LoRA training,
    PuLID-Flux is the one to test, not InstantID. — [aiofm.info showdown](https://aiofm.info/en/guides/pulid-vs-instantid-vs-faceid); [MyAIForce comparison](https://myaiforce.com/flux-pulid-vs-ecomid-vs-instantid/)
  - No FLUX Kontext- or Z-Image-edit-specific identity-bias writeups found
    that add anything beyond the Qwen findings above.
- **Real photo anchor vs in-model anchor**: no evidence found either way — no
  source directly compares starting from a real photo vs a purely in-model
  passport anchor for downstream LoRA quality. Say plainly: **no better
  evidence than the package** on this specific question.

## Q3 — Realism passes without pickles

- **FaceDetailer (Impact Pack)** [documented]: license is **GPL-3.0**, not a
  permissive license — but GPL-3.0 (unlike AGPL) does not require source
  disclosure for running it as a service; using it to process images in a
  commercial pipeline without redistributing modified Impact-Pack code is
  fine. Standard technique: bbox/segm face detector → inpaint crop → optional
  face LoRA inside the detailer node; add "skin texture, pores, imperfections"
  to the positive prompt to fight over-smoothing. — [ltdrdata/ComfyUI-Impact-Pack](https://github.com/ltdrdata/ComfyUI-Impact-Pack); license file via HF mirror (2026)
- **SUPIR is licensed non-commercial-only** [documented — explicit repo
  language]: "strictly for non-commercial purposes." **Do not use it** given
  the commercial-hosting constraint. — [Fanghua-Yu/SUPIR](https://github.com/Fanghua-Yu/SUPIR)
- **SeedVR2 is Apache-2.0** [documented, official ByteDance-Seed repo],
  accepted at ICLR 2026, natively supported in ComfyUI, ships fp8/fp16
  safetensors and GGUF variants — this is the commercially-clean replacement
  for SUPIR-style restoration/upscale passes. — [ByteDance-Seed/SeedVR](https://github.com/ByteDance-Seed/SeedVR); [ByteDance-Seed/SeedVR2-7B](https://huggingface.co/ByteDance-Seed/SeedVR2-7B)
- **Skin-texture LoRA safetensors**: at least one purpose-built skin-realism
  LoRA for Qwen-Image-Edit-2509/2511 exists on HF as safetensors (license not
  independently confirmed on the model card — check before commercial use). —
  [tlennon-ie/qwen-edit-skin](https://huggingface.co/tlennon-ie/qwen-edit-skin)
- No dedicated film-grain-node license issue found; these are typically small
  ComfyUI custom nodes (MIT/BSD-style) layered after the detailer/upscale pass
  — not separately researched here as no controversy or gap surfaced.

## Q4 — Automated identity/age/realism scoring

- **ArcFace/InsightFace cosine gating** [documented practice, cross-source
  agreement]: cosine similarity is the standard identity metric; thresholds
  are dataset-specific and normally grid-searched, but concrete numbers
  circulating in practice are **>0.65 similarity to keep as "same person"**
  for a strict gate, and **>0.4 similarity as identity-leakage rejection**
  between *different* identities in dataset-curation contexts (these are two
  different use cases — same-identity retention vs cross-identity leakage —
  don't conflate the thresholds). — [insightface issue #2239](https://github.com/deepinsight/insightface/issues/2239); [didit.me ArcFace/CosFace explainer](https://didit.me/blog/face-matching-algorithms-arcface-cosface/)
- **Age estimation as a pre-training gate** [documented, 2026 industry
  framing]: facial age estimation is now described as "deployable as a first
  gate" with 2.5–3.5 year error bands, typically implemented as threshold
  classification rather than point regression. Good enough to flag
  "this cell reads meaningfully older than anchor" before it enters the
  training set. — [Xident: NIST FATE 2026 read](https://xident.io/blog/facial-age-estimation-accuracy-nist-fate-2026/)
- **Synthetic-data age bias is a documented, measured phenomenon** [measured —
  peer-reviewed]: a comparative study found text-to-image models preserve
  identity better than they preserve requested age, and that age-depiction
  bias is *more pronounced in synthetic data* than real faces — this directly
  supports why our "reads older" symptom needs an explicit age gate, not just
  better prompting. — [arXiv 2502.03420](https://arxiv.org/html/2502.03420v1), Feb 2025 (evaluated into 2026 discourse)
- **No-reference IQA (NIQE/BRISQUE/CLIP-IQA)** [documented technique, applied
  in face-dataset papers]: CLIP-IQA (positive/negative zero-shot prompt pairs)
  and NIQE (statistical naturalness) are both used in published face-dataset
  quality pipelines (e.g. curating FaceCaption-scale datasets) — a viable,
  license-clean automated pre-training filter for gloss/artifact cells. —
  [PerceptCLIP/PerceptCLIP_IQA](https://huggingface.co/PerceptCLIP/PerceptCLIP_IQA); [15M Multimodal Facial dataset paper, arXiv 2407.08515](https://arxiv.org/pdf/2407.08515)

## Q5 — Cheaper/faster on one pod

- **ai-toolkit's real VRAM ceiling** [anecdote, but specific and repeated]:
  as of mid-2026, ai-toolkit is reported to lack an effective mid-training
  VRAM-offload mechanism and is described as "only works for 24GB VRAM" for
  larger jobs — consistent with needing the L40S/4090 class card we already
  use; don't expect it to scale down further without a different trainer
  (Kohya/FluxGym support 12–20GB via different mechanisms). —
  [ostris/ai-toolkit issue #990](https://github.com/ostris/ai-toolkit/issues/990); [FluxGym](https://github.com/benjiyaya/fluxgym)
- **Latent/text-encoder caching** [documented, standard technique]: caching
  VAE latents and text-encoder outputs to disk removes repeated encode work
  from the training loop and is directly supported in ai-toolkit-family
  configs — cheap, no quality tradeoff, should already be on. —
  [Engineering Notes: Z-Image Turbo LoRA, HF blog 2026](https://huggingface.co/blog/content-and-code/training-a-lora-for-z-image-turbo)
- **Fewer steps via better data, not shortcuts** [anecdote]: community
  consensus (Krea-2 and FLUX guides alike) is that curated 15–40 image sets
  at ~2500 steps outperform larger noisy sets at more steps — this argues for
  spending compute on the cull/score step (Q4) rather than on more LoRA steps.
- **512-only training claim** [anecdote, single unverified source]: flagged
  above under Q1 resolution — plausible speed win but not corroborated.

## Adopt / Adapt / Keep-the-package's-way

| # | Area | Recommendation | Grade |
|---|------|------|-------|
| 1 | Regularization | **Adopt** `diff_output_preservation` (official ai-toolkit flag) with class `"person"` to fight age/identity drift and overfitting | measured/documented (Ostris official) |
| 2 | Regularization (stretch) | **Adapt**: trial `ai-toolkit-perceptual` fork's ArcFace/Depth-Anything identity+geometry anchoring if DOP alone doesn't fix drift | documented (third-party MIT fork) |
| 3 | Rank/alpha/lr/steps | **Keep** package's settings — independent 2026 guides converge on the same rank 32/alpha 32, lr 1e-4→5e-5, ~2500-3000 steps | anecdote, but convergent across 3+ sources |
| 4 | Captioning | **Adopt** short/no-caption + natural trigger placement if package uses long narrative captions; confirm current captioner behavior | anecdote, convergent |
| 5 | Anchor→dataset step | **Adapt**: A/B test FLUX.2 Klein multi-reference against Qwen-Image-Edit-2511 for the anchor→variation step; different mechanism (compose vs sequential edit) may reduce gloss/age drift at the source | documented (vendor + community workflow), not yet measured against our anchor |
| 6 | Qwen gloss bias | **Adopt** the skin-realism LoRA + explicit skin-texture prompt as a mitigation on the existing Qwen-edit step, cheaper than switching models | anecdote (widespread, repeated) |
| 7 | Identity adapter | **Adapt**: keep PuLID-Flux (not InstantID) on the shortlist if an adapter-based identity lock is ever added alongside LoRA | anecdote (consistent 2026 framing) |
| 8 | Face refinement | **Keep** FaceDetailer/Impact Pack; GPL-3.0 is fine for SaaS use (no redistribution of the pack itself) | documented (license text) |
| 9 | Restoration/upscale | **Adopt** SeedVR2 (Apache-2.0) over SUPIR (non-commercial-only license — a real licence violation risk under current SUPIR terms) | documented (license text, both sides) |
| 10 | Skin/quality gate | **Adopt** an ArcFace cosine gate (~>0.65 same-identity) + an age-estimator gate + CLIP-IQA/NIQE no-reference score before a cell enters training | documented technique, thresholds are anecdote |
| 11 | Real vs in-model anchor | **Keep** current in-model anchor approach — no evidence either way | no better evidence than the package |
| 12 | Compute | **Keep** current latent-caching if already on; **adopt** if not; treat "512-only training" as unverified, don't switch on this alone | anecdote (single source) |
