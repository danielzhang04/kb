# R2 — short-form video-generation survey

Research snapshot: 2026-08-31. Scope is 5–30 s vertical reels from a fixed fictional,
disclosed-AI adult persona; the intended ceiling is swimwear/lingerie, not nudity or
sexual content. “API” means a documented submit/poll/download interface, not browser
automation. Prices exclude tax and are current list prices where published.

## What the evidence can and cannot say

There is no public benchmark for the actual acceptance criterion: a supplied identity
must remain recognisable through a close-up, hands, hair/fabric motion and a slow camera
move. The [Video Arena methodology](https://artificialanalysis.ai/video/methodology)
uses first-frame image-to-video and pairwise human preference, but it does not isolate
identity drift, hands, or synthetic-looking skin. It is useful as a broad outside
quality signal only. All candidates therefore need the same four-render acceptance test;
vendor claims and community comments below are not a substitute for it.

All hosted services below prohibit explicit sexual material. “Swimwear/lingerie may be
accepted” is **not** a policy guarantee: conservative image moderation can reject a
non-explicit frame. Use only wholly fictional adults, keep the disclosure in the
distribution workflow, and re-check policy at production launch.

## API / SaaS

### Kling 2.x / current Kling video

- **I2V and consistency:** documented image-to-video API; current product also accepts
  multiple reference images/element binding (the Video O1 guide permits up to seven
  images). That is an identity-conditioning mechanism, rather than a guarantee of
  identity retention. [API reference](https://kling.ai/document-api/apiReference/model/imageToVideo),
  [O1 guide](https://kling.ai/quickstart/klingai-video-o1-user-guide).
- **Limit / format:** current API pricing page advertises 3–15 s, 720p/1080p/4K and
  9:16. [Kling pricing](https://kling.ai/explore/klingai_api_pricing).
- **Quality signal:** a frequently represented frontier I2V system in public arenas;
  no independently published score specifically supports portrait consistency. Treat
  “cinematic/realistic” creator language as subjective.
- **Cost / automation:** official multi-image video rate is $0.056–$0.098/s (model/tier
  dependent), so four 5-s trials are **$1.12–$1.96**. Documented API supports
  automation. [Billing](https://kling.ai/document-api/productBilling/billingMethod).
- **Policy / maintenance:** terms prohibit pornographic/sexually explicit material and
  require rights/consent for supplied content. API and billing docs were updated in
  August 2026; an official 2.5 Turbo release is a current maintenance signal.
  [Terms](https://kling.ai/docs/user-policy), [release](https://ir.kuaishou.com/node/10961/pdf).

### Hailuo / MiniMax

- **I2V and consistency:** `first_frame_image` is a documented API input; it anchors
  the first frame only. The cited public API does not promise a persistent character
  embedding. [I2V API](https://platform.minimax.io/docs/api-reference/video-generation-i2v).
- **Limit / format:** Hailuo 2.3 supports 6 or 10 s at 768p; 1080p is 6 s. Vertical
  output needs confirmation in the live model options before use.
- **Quality signal:** available in public video arenas; no portrait-identity benchmark
  found. Public creator discussion is mixed enough that it should not be converted into
  a realism claim.
- **Cost / automation:** async bearer-token API. API resource packs disclose 0.7 units
  for 768p/6s Fast and 1 unit for standard; the smallest published API pack is $1,000
  for 3,760 units, implying roughly **$0.74** for four Fast 6-s attempts at that pack
  rate, but with a **$1,000 minimum commitment**. [Video packages](https://platform.minimax.io/docs/guides/pricing-video).
- **Policy / maintenance:** the platform classifies pornography as sensitive content;
  policy enforcement may reject inputs/outputs. Hailuo 2.3 is in the current API docs.
  [Moderation fields](https://platform.minimax.io/docs/api-reference/text-post).

### Runway Gen-4 Turbo

- **I2V and consistency:** documented Gen-4 Turbo image-to-video endpoint, with the
  supplied image as first frame. It is a first-frame workflow, not character-memory
  across separate renders. [Endpoint](https://dev.runwayml.com/endpoints/image_to_video?modelId=gen4_turbo&modelid=gen3a_turbo&modelid=gen4_turbo).
- **Limit / format:** 5 or 10 s at 720p; explicitly supports 720×1280 (9:16).
- **Quality signal:** a long-running public I2V entrant, but no public evidence found
  that establishes its face/hand stability for this exact use case.
- **Cost / automation:** official API is 5 credits/s at $0.01/credit = **$0.05/s**;
  four 5-s trials cost **$1.00**. [Billing](https://docs.dev.runwayml.com/usage/billing/).
- **Policy / maintenance:** explicit content, adult nudity, and sometimes lingerie are
  prohibited/limited. This makes the requested ceiling operationally uncertain even
  when legal and non-explicit. Active developer docs and current API pricing signal
  maintenance. [Usage policy](https://runway.com/safety/usage-policy).

### Google Veo 3 / 3.1

- **I2V and consistency:** Gemini API accepts an image input; Veo 3.1’s
  “Ingredients to Video” is documented as preserving character identity/background
  detail across videos. [API docs](https://ai.google.dev/gemini-api/docs/video?authuser=6),
  [3.1 announcement](https://blog.google/innovation-and-ai/technology/developers-tools/veo-3-1-gemini-api/).
- **Limit / format:** API output is 4, 6, or 8 s, including 9:16; 1080p vertical was
  announced for Veo 3 / Fast. The 8-s ceiling means longer reels require editorial
  assembly rather than a single generation. [Google update](https://developers.googleblog.com/veo-3-and-veo-3-fast-new-pricing-new-configurations-and-better-resolution/).
- **Quality signal:** public arena coverage is broad; it remains only a general
  preference signal, not evidence of fixed-persona reliability.
- **Cost / automation:** Gemini API / Vertex are automatable. Published list price is
  $0.40/s for Veo 3 and $0.15/s for Fast; four 8-s trials are **$12.80 / $4.80**.
- **Policy / maintenance:** sexual safety filters are applied to prompts and source
  media; Gemini policy disallows pornography/erotic content. Current 3.1 API updates
  are the maintenance signal. [Veo guidance](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/video/responsible-ai-and-usage-guidelines?authuser=00),
  [Gemini policy](https://gemini.google/policy-guidelines/).

### ByteDance Seedance 2.x

- **I2V and consistency:** API documentation exposes one/two-image I2V (first or
  first+last frame) and a reference-to-video mode with up to nine images, three videos,
  and three audio references. This is unusually broad conditioning, but not an identity
  guarantee. [API schema](https://seedance2.ai/api-docs).
- **Limit / format:** 4–15 s, 480p/720p/1080p/4K and 9:16 are listed by that API.
- **Quality signal:** included in public I2V arenas; no third-party portrait-drift
  result located. Do not infer human-looking close-up performance from general Elo.
- **Cost / automation:** async API and callback are documented. The accessible pricing
  interface returns credits by model/resolution/duration rather than a stable public
  USD rate, so a defensible pre-purchase per-take estimate is **not available**; obtain
  a quote/credit preview for the four-render test.
- **Policy / maintenance:** policy ceiling must be confirmed with the actual regional
  API contract before testing. The public 2.0 paper and live docs show recent activity.
  [Technical report](https://arxiv.org/abs/2604.14148).

### Pika 2.5

- **I2V and consistency:** documented I2V API plus first/last-frame `Pikaframes` on
  the product. This can constrain a transition; no character-memory mechanism is
  documented. [API](https://dev.pika.art/models/pika/pika-2.5/image-to-video),
  [FAQ](https://pika.art/faq).
- **Limit / format:** I2V supports 5/10 s at 480p/720p/1080p; Pikaframes reaches 25 s.
  Confirm the production API’s 9:16 option before committing.
- **Quality signal:** creator-facing social-effects positioning; no independent
  evidence found for the requested photorealistic-persona criterion.
- **Cost / automation:** public API pricing lists I2V from **$0.051/s at 480p**;
  resolution/model-dependent. Four 5-s 480p trials: **$1.02**. [API pricing](https://dev.pika.art/pricing).
- **Policy / maintenance:** sexually explicit/pornographic content and real-person
  portraits without explicit consent are prohibited. Current API docs/pricing are the
  maintenance signal. [Acceptable use](https://pika.art/acceptable-use-policy).

### Luma Ray 3.2

- **I2V and consistency:** API supports a start/end image and multi-keyframes; up to
  16 keyframes are advertised, giving concrete within-clip visual constraints rather
  than a cross-clip character model. [API overview](https://lumalabs.ai/api),
  [quickstart](https://docs.agents.lumalabs.ai/).
- **Limit / format:** 5/10 s I2V at 540p/720p/1080p and native 9:16; 10 s requires
  multi-keyframes. [I2V schema](https://fal.ai/models/luma/agent/ray/v3.2/image-to-video/api).
- **Quality signal:** public arena/creator commentary exists, but no identity-drift
  benchmark supports a stronger statement.
- **Cost / automation:** documented Agents API. 5-s SDR I2V costs $0.15/$0.30/$1.20
  at 540p/720p/1080p; four 5-s 720p trials: **$1.20**. [Pricing](https://lumalabs.ai/api).
- **Policy / maintenance:** explicitly blocks pornography, sexually explicit content,
  NCII, and real-person deepfakes; moderation cannot be disabled. This ceiling is
  narrower than a lingerie-oriented workflow can safely assume. [Moderation FAQ](https://docs.agents.lumalabs.ai/guides/faq/).

### Higgsfield

- **I2V and consistency:** creator studio fronts several models and supports media
  references; official CLI documentation shows start-image, duration and resolution
  arguments for Kling-based generation. It is an orchestration layer, so identity and
  policy behavior vary by the chosen underlying model. [Model reference](https://github.com/higgsfield-ai/cli/blob/main/MODELS.md).
- **Limit / format:** its own marketing-studio workflow advertises up to 15 s; model
  limits/9:16 must be read at generation time.
- **Quality signal:** designed around creator/UGC camera conventions, not a published
  fixed-character realism benchmark.
- **Cost / automation:** no stable public per-second table; credits vary by selected
  model/resolution/duration and are quoted in-product. Automation is available via its
  tooling, but get the job quote before a test. [Credits](https://higgsfield.ai/creator-hub/help-center/credits/how-credits-work).
- **Policy / maintenance:** no separate public ceiling was located in this pass; the
  delegated model’s terms remain controlling. Current help/CLI pages show activity.

### Eromify (persona-niche SaaS)

- **I2V and consistency:** markets fictional AI influencers with image/video creation;
  a public technical API/conditioning specification was not located. Treat as
  UI-operated until an API contract says otherwise.
- **Limit / format / cost:** no public, sourceable duration, resolution, per-clip rate,
  or queue SLA found; obtain these in writing before integrating.
- **Quality signal:** no independent public benchmark located.
- **Policy ceiling:** its safety policy says generative features are for fictional AI
  influencers and are moderated. It is not evidence that every lingerie reference will
  pass. [Safety policy](https://www.eromify.in/ai-safety).
- **Maintenance:** public policy page is current, but the absent public developer docs
  make maintenance/automation difficult to verify.

## Open weights / self-hosted

For these models there is no provider moderation layer in local inference; that is not
permission to make prohibited content. The model/license, hosting provider terms,
app-store rules and law still apply. GPU figures are minimum/inference guidance, not a
throughput promise. A current RTX 4090 secure-cloud reference price is $0.69/h
([Runpod rate card](https://www.runpod.io/articles/guides/ai-server-cost)); cold starts,
model download and retries can dominate four short clips.

### Wan 2.1 / 2.2

- **I2V and consistency:** Wan 2.2 has native I2V and TI2V; the source image fixes the
  starting appearance, not a reusable persona embedding. ComfyUI has official Wan 2.2
  templates. [Wan repo](https://github.com/Wan-Video/Wan2.2), [ComfyUI workflow](https://docs.comfy.org/tutorials/video/wan/wan2_2).
- **Limit / hardware:** I2V A14B supports 480p/720p and the input aspect ratio; official
  guidance says 80 GB VRAM for A14B, while TI2V-5B can run with offloading on 24 GB and
  ComfyUI describes 8 GB with native offloading (expect slow inference).
- **Quality signal:** open weights are represented in public arena/community testing;
  no hard identity/morph benchmark. Community reports regularly trade VRAM/speed for
  quality, so use the exact checkpoint/workflow in the test.
- **Cost / automation / maintenance:** local ComfyUI/API workflow is automatable; model
  cost is GPU time. A conservative four-render exploration allowance is **one to two
  billed RTX-4090 hours ($0.69–$1.38), plus storage/egress**, because setup/retries are
  not known until the workflow is installed. Active official repo and first-party
  ComfyUI tutorial are maintenance signals.
- **Policy:** local operation has no hosted filter; observe the Wan license and hosting
  terms independently.

### HunyuanVideo 1.5

- **I2V and consistency:** supports first-frame, key-frame, reference-to-video and
  multi-image workflows; ComfyUI publishes a 720p I2V template. These are conditioning
  controls, not identity guarantees. [Official repo](https://github.com/Tencent-Hunyuan/HunyuanVideo-1.5),
  [ComfyUI template](https://github.com/Tencent-Hunyuan/HunyuanVideo-1.5/blob/main/ComfyUI/README.md).
- **Limit / hardware:** 720p I2V template available; repo-linked tooling cites very low
  VRAM configurations, but exact feasible hardware depends on quantisation/offload.
- **Quality signal:** current public open-model I2V arena lists HunyuanVideo 1.5; the
  Arena result remains a general preference measure, not a portrait test. [Arena](https://arena.ai/leaderboard/image-to-video?license=open-source).
- **Cost / automation / maintenance:** ComfyUI/self-host API possible; cost is GPU-time,
  not license fee. Budget a billable GPU-hour until measured; active official repo and
  ComfyUI template are positive maintenance evidence.
- **Policy:** local weights are not a moderation service; review the model license and
  downstream platform rules.

### LTX-Video / LTX-2.x

- **I2V and consistency:** native I2V, keyframe animation and extension; current docs
  provide a ComfyUI I2V workflow. [LTX guide](https://docs.ltx.io/open-source-model/usage-guides/image-to-video),
  [official repo](https://github.com/Lightricks/LTX-Video).
- **Limit / hardware:** older LTX Video reports real-time 30fps at 1216×704; current
  LTX 2.5 I2V template is supported in ComfyUI. Small 2B variants target lower VRAM;
  confirm model/checkpoint requirements before deployment.
- **Quality signal:** listed in public open I2V arena; no fixed-identity result found.
- **Cost / automation / maintenance:** self-hosted/ComfyUI and therefore automatable;
  GPU-time pricing. Plan a one-hour GPU reservation for installation plus four outputs
  unless an existing image is available. Docs and repo are actively maintained.
- **Policy:** no hosted moderation in local use; model license and distribution rules
  require separate review.

### CogVideoX

- **I2V and consistency:** official CogVideoX lineage supports I2V through released
  weights/community ComfyUI integration; source image is the practical identity anchor.
  [CogVideoX paper](https://arxiv.org/abs/2408.06072), [ComfyUI wrapper](https://github.com/kijai/ComfyUI-CogVideoXWrapper).
- **Limit / hardware:** paper reports 10 s, 16 fps, 768×1360 for the base model;
  community 4090 reports are around 2–3 minutes/generation and ~24 GB VRAM, not an
  official SLA.
- **Quality signal:** older-generation option; no current independent I2V portrait
  benchmark found.
- **Cost / automation / maintenance:** ComfyUI scripting possible; reserve at least
  **one billable 24-GB-GPU hour** for a four-take test after setup. Community wrapper
  activity is the main maintenance signal.
- **Policy:** local model; license and hosting/distribution policy still apply.

## Helpers (not replacements for base I2V)

- **LivePortrait:** source portrait + driving video/motion template; can preserve a
  face while reenacting head/expression motion. Its own repository notes deepfake risk
  and visible artifacts. Use for a deliberately constrained talking/selfie shot, not
  walking/full-body physics. [Official repo](https://github.com/KlingAIResearch/LivePortrait).
- **MuseTalk 1.5:** post-process a generated clip for audio-driven mouth motion; source
  repo reports 30fps+ on V100 and an MIT code license/commercial model use. It changes
  the mouth region, so include it in identity/artifact QC. [Repo](https://github.com/TMElyralab/MuseTalk).
- **LatentSync 1.6:** diffusion lip-sync; published minimum inference is 18 GB VRAM
  (8 GB for 1.5) and the repository describes temporal-consistency work. Apache-2.0
  code; check checkpoint terms. [Repo](https://github.com/bytedance/LatentSync).
- **Wav2Lip:** established lip-sync baseline, but not a motion/identity generator; its
  official project provides the model/code rather than a current hosted production API.
  [Repo](https://github.com/Sdata0605/Wav2Lip).

## Shortlist for the bake-off

Run the same controlled test on **Kling**, **Runway Gen-4 Turbo**, and **Wan 2.2
TI2V-5B**. This is a deliberately mixed test set—two documented APIs and one
self-hosted model—not a claim that any is superior. It includes the required API and
open-weight paths, offers native I2V for all three, and has sourceable initial cost
ceilings.

Test exactly four outputs per candidate: 5-s 9:16 held-pose/slow-pan and 5-s simple
motion, two independent takes each. Lock the same reference still, seed where exposed,
prompt template, output duration and QC rubric. Reject any clip with face identity
change, extra/missing fingers, warped hands, gloss-like skin, or non-causal fabric/hair
motion; record failures rather than re-prompting them away.

| Candidate | Four-take estimate | Basis / caveat |
|---|---:|---|
| Kling | $1.12–$1.96 | Official multi-image rate × 20 output seconds; exact tier/model changes it. |
| Runway Gen-4 Turbo | $1.00 | $0.05/s × 20 output seconds. |
| Wan 2.2 TI2V-5B | $0.69–$1.38 | One–two 4090 GPU-hours including setup/retries; measure after model download. |

If all three fail the non-AI realism QC, repeat the unchanged test protocol with Veo
3.1 Ingredients-to-Video and Luma Ray 3.2 multi-keyframe rather than widening prompts
or altering the character reference. Their sourceable four-take list costs are $12.80
(Veo 3 8-s) / $4.80 (Fast) and $1.20 (Luma 720p, 5-s), respectively.
