# R1 — Still-Image Generation Stack Survey

Scope: character-consistent, realistic (non-"AI-look") still generation for a fictional, disclosed-as-AI adult (18–27) female persona, bedroom/lifestyle glamour register, swimwear/lingerie-level maximum. No explicit-content generation performed or scoped — content-policy ceilings noted factually only. Facts current as of research date 2026-08-31; SaaS pricing/ToS/company facts change fast, re-verify before committing spend.

---

## SaaS tools

### Eromify
- **Consistency mechanism**: Markets "AI influencer training" / custom persona model, method (LoRA vs. embedding) not disclosed. Multiple user reviews report poor face consistency in practice. [eromify.com](https://www.eromify.com/), [tryclout.ai review](https://www.tryclout.ai/blog/eromify-review)
- **Realism reputation**: Weak. Trustpilot 2.2/5 (48 reviews, ~55% one-star); verbatim complaints "Images look very AI-generated" and "fake training." No Reddit threads found. [Trustpilot](https://www.trustpilot.com/review/eromify.com)
- **Pricing**: Credit packs, one-time, non-expiring: ₹499–₹3,999 (~$5.99–$47.99). 100 credits/image action, 1,500 credits/video.
- **API/automation**: MCP connector (`api.eromify.in/mcp`) for Claude/Cursor via Bearer API key — real automation path, not a conventional REST API/SDK. [eromify.in/mcp](https://www.eromify.in/mcp)
- **Content-policy ceiling**: Not documented in any indexed page found — unverifiable without direct on-site ToS check.
- **GPU/VRAM**: N/A (hosted only).
- **Maturity**: Founded ~2024 (single low-confidence source). Trustpilot shows support/refund failures, "complete scam" characterizations — weakest maturity signal of the SaaS set. [Trustpilot](https://www.trustpilot.com/review/eromify.com)

### Glambase
- **Consistency mechanism**: "Character Face Generator" using undisclosed "computer vision algorithms." [glambase.app](https://glambase.app/)
- **Realism reputation**: Review-site consensus calls output "ultra-realistic" / NSFW-leaning-realistic; no independent Reddit data found. Some trust-scanners flag likely-botted promotional engagement (marketing-credibility flag, not image-quality flag). [toosio.com](https://toosio.com/tool/glambase-ai-influencer-creation-platform), [gridinsoft scan](https://gridinsoft.com/online-virus-scanner/url/glambase-app)
- **Pricing**: From $14.99/mo; also a $347 one-time "lifetime" tier. [pineapplebuilder.com](https://www.pineapplebuilder.com/ai-tools/glambase)
- **API/automation**: Not found — likely UI-only.
- **Content-policy ceiling** (most explicit of all candidates surveyed): ToS **explicitly permits fictional nudity and sexually explicit material**, gated on legality, no NCII/underage/exploitative depiction, confirmed-adult subjects, no real person's likeness without consent. Public Discover/showcase page carries a stricter no-nudity/no-provocative-attire rule (explicit content allowed platform-wide, excluded from public discovery surface). Reported case of a 12-year-old completing signup with no visible age-verification gate despite 18+ requirement — an enforcement gap, not a policy gap. [ToS](https://glambase.app/legal/terms-of-service), [Discovery guidelines](https://glambase.app/guidelines/discovery), [gridinsoft](https://gridinsoft.com/online-virus-scanner/url/glambase-app)
- **GPU/VRAM**: N/A (hosted only).
- **Maturity**: Launched Dec 18 2023 (founder Ivan Starinin, Miami FL). No funding-round amounts found. Trust-score aggregators disagree (ScamAdviser "legit," Scam Detector "medium risk" 33.7/100) — mixed but not damning. [CB Insights](https://www.cbinsights.com/company/glambase), [Scam Detector](https://www.scam-detector.com/validator/glambase-app-review/), [ScamAdviser](https://www.scamadviser.com/check-website/glambase.app)

### Higgsfield (Soul / Soul ID)
- **Consistency mechanism**: "Soul ID" — trains a persistent per-identity model from ~20+ varied reference photos in ~3–5 min; identity reused across Soul 2.0 generations without re-upload. Closer to a lightweight fine-tune/embedding than single-reference conditioning (exact architecture undisclosed). [Higgsfield blog](https://higgsfield.ai/blog/sould-id-best-character-consistency), [Soul intro](https://higgsfield.ai/soul-intro)
- **Realism reputation**: Strongest of the SaaS set. Coverage describes output as "nearly indistinguishable from photos taken with a camera"; company ran a public realism benchmark vs. Sora 2. G2 reviews positive on output quality with some bugginess/support complaints. No adverse Reddit "looks fake" threads found either way (absence of evidence, not confirmed consensus). [Wikipedia](https://en.wikipedia.org/wiki/Higgsfield_AI), [realism-test press](https://markets.financialcontent.com/kelownadailycourier/article/abnewswire-2025-10-28-realism-test-higgsfield-pushed-sora-2-to-their-absolute-limits)
- **Pricing**: Credit subscriptions — Starter ~$19/mo (annual, 270 credits), Plus ~$47/mo annual or $59/mo (1,200 credits), Ultra ~$99/mo annual or $129/mo (3,000 credits). Top-up packs expire 90 days; subscription credits expire per cycle. Est. ~$0.009/image at 1K res (third-party estimate). [scopeful.org](https://www.scopeful.org/tools/higgsfield), [credits doc](https://higgsfield.ai/creator-hub/help-center/credits/how-credits-work)
- **API/automation**: Yes — official docs (`docs.higgsfield.ai`), submit-and-poll/webhook pattern, Text-to-Video/Image-to-Video/Soul Mode. Also via third-party aggregators (eachlabs.ai, Segmind) with Python/JS SDKs. Most automatable SaaS surveyed. [docs](https://docs.higgsfield.ai/docs), [eachlabs](https://www.eachlabs.ai/higgsfield)
- **Content-policy ceiling**: ToU bans "obscene, hateful, offensive, profane" content and any minor depiction (real or synthetic) that's lewd/objectionable, enforced at platform discretion. No published nudity threshold. **Important**: Higgsfield's own NSFW-troubleshooting page lists swimwear/revealing clothing, athletic/fitness content, and medical/anatomical imagery as common **false-positive** triggers — implying the automated filter is stricter/twitchier than the stated policy and directly overlaps this project's target register. Underlying routed models (Nano Banana, Seedream, Kling, Sora 2, MiniMax, Wan, Veo) each add their own opaque moderation on top. [ToU](https://higgsfield.ai/terms-of-use-agreement), [NSFW troubleshooting](https://higgsfield.ai/creator-hub/help-center/troubleshooting/content-flagged-as-nsfw)
- **GPU/VRAM**: N/A (cloud/API only).
- **Maturity**: Founded Oct 2023 (ex-Snap GenAI director Alex Mashrabov). Funding: $8.16M seed (Jan 2024) → $130M Series A ($1.3B valuation) → $400M Series B announced Aug 17 2026 ($5.4B valuation). Reported $700M annualized revenue, 30M users. Best-capitalized candidate; low shutdown risk but scaling toward brand-safety may tighten policy further. [Wikipedia](https://en.wikipedia.org/wiki/Higgsfield_AI), [TechCrunch](https://techcrunch.com/2026/08/17/higgsfield-raises-400m-series-b-quadrupling-its-valuation-in-8-months-to-5-4b/)

### Krea AI
- **Consistency mechanism**: Character LoRA training via "Krea Train" (closed beta, Krea 2 Medium/Large). Needs ~12 images of one face, varied framing; newer LoKr format reduces identity bleed with multiple characters. [InstaSD guide](https://www.instasd.com/post/krea-2-lora-training-lokr-guide), [Krea blog](https://www.krea.ai/blog/public-loras-krea-2-train)
- **Realism reputation**: Positioned as more photoreal/iterative than Midjourney's stylized default; some workflows use Krea for photoreal exploration then finish in Midjourney. No direct "looks fake" Reddit threads found. [Krea's own comparison](https://www.krea.ai/articles/midjourney-vs-krea)
- **Pricing**: Free (100 compute units/day). Basic $9/mo, Pro $35/mo (20,000 units), Max $70/mo, Business/Enterprise custom. [Tickerr](https://tickerr.ai/pricing/krea-ai)
- **API/automation**: Yes, official metered API billed in microdollars/generation, separate from app subscription; enterprise SLAs available. [API pricing](https://www.krea.ai/app/api/pricing)
- **Content-policy ceiling**: Acceptable Use Policy **explicitly prohibits "intimate or sexually suggestive imagery,"** enforced by input/output classifiers (open-source NSFW detectors + commercial moderation APIs) — prompt engineering does not bypass this. Also explicit NCII/deepfake and CSAM bans. No carve-out for fictional/disclosed-AI personas. Likely blocks the swimwear/lingerie register at the "suggestive" boundary. [AUP](https://www.krea.ai/krea-2-use-policy)
- **GPU/VRAM**: N/A (hosted, closed-beta training).
- **Maturity**: Founded 2022, SF-based. $82.7M total raised ($33M Series A 2023 a16z; $47M Series B April 2025 Bain Capital Ventures). ~103 employees, ~$500M valuation mid-2026. [a16z](https://a16z.com/announcement/investing-in-krea/), [Contrary Research](https://research.contrary.com/company/krea)

### Midjourney (Omni-Reference)
- **Consistency mechanism**: Reference-image based, no training. V7's Omni-Reference (`--oref` + `--ow` weight) supersedes legacy `--cref` (incompatible with V7). Single reference image only; fine details (freckles, logos) don't always reproduce. [ImaginePro guide](https://www.imaginepro.ai/blog/2025/7/midjourney-omni-reference-guide), [Danex guide](https://danex.ai/midjourney-character-reference)
- **Realism reputation**: Well-documented "plastic skin"/flat-lighting default bias. Community fix: `--style raw` + negative-style prompting (avoid "octane render," "airbrushed") + explicit texture cues (pores, freckles). V6.5+ reported improved skin/hand quality. [Rezience fix guide](https://andyhtu.com/fixing-plastic-ai-skin/), [Tom's Guide](https://tomsguide.com/ai/ai-image-video/midjourney-v65-could-be-out-by-the-end-of-the-month-with-improved-realism-and-skin-textures)
- **Pricing**: Basic $10/mo, Standard $30/mo, Pro $60/mo, Mega $120/mo (annual ~20% cheaper). [Vendr](https://www.vendr.com/marketplace/midjourney)
- **API/automation**: **No official public API** as of Aug 2026; enterprise-only dashboard access via application. Third-party unofficial-API wrappers exist around a paid subscription (ToS-risk, not sanctioned). [Unifically](https://unifically.com/blogs/midjourney-api)
- **Content-policy ceiling**: Guidelines require PG-13; explicit ban on nudity, sexual organs, sexualized/fetish imagery, showers/toilets, any minor sexualization. AI classifiers scan prompts and images including private mode. Rules out swimwear/lingerie register at "sexualized" boundary in practice for many prompts. [Community Guidelines](https://docs.midjourney.com/hc/en-us/articles/32013696484109-Community-Guidelines)
- **GPU/VRAM**: N/A (hosted only).
- **Maturity**: Long-established (pre-2022), self-funded/profitable, active iteration (V6→V6.5→V7, Omni-Reference). No public funding/headcount figures found.

### Leonardo AI (Character Reference)
- **Consistency mechanism**: Single anchor reference image + Low/Mid/High strength; composable with Style Reference, Multi-Style Reference, Elements. SDXL-family models only. [Leonardo guide](https://leonardo.ai/learn/core-feature/how-to-create-consistent-characters-with-character-reference)
- **Realism reputation**: Mixed — some reviewers note cheek/eye artifacts and sharp "branch-like" eyelashes (uncanny-valley); TechRadar review calls some outputs surprisingly realistic. Standard mitigation: negative-prompt against plastic/gloss/CGI + texture-forward positive prompts. [PiClumen review](https://www.piclumen.com/blog/leonardo-ai-review/), [TechRadar](https://www.techradar.com/computing/artificial-intelligence/i-used-leonardo-to-generate-some-ai-images-and-i-cant-believe-how-realistic-they-are)
- **Pricing**: Free (150 tokens/day). Apprentice $12/mo ($10 annual), Artisan $30/mo ($24 annual), Maestro $60/mo ($48 annual); Team plans $72–$144/mo. [Flowith](https://flowith.io/blog/leonardo-ai-pricing-2026-free-vs-apprentice-vs-artisan/)
- **API/automation**: Yes, official pay-as-you-go API, $5 non-expiring credit on new accounts, auto top-up. [eesel](https://www.eesel.ai/blog/leonardo-ai-pricing)
- **Content-policy ceiling**: ToS bans explicit/pornographic and non-consensual sexual content (immediate/permanent suspension). Some sources report "tasteful, non-sexualized artistic nudity" is tolerated but filter false-positives are common; free tier filtered more strictly than paid. [Safety commitment](https://leonardo.ai/news/our-commitment-to-ai-safety-and-creative-empowerment), [Aurascience](https://aurascience.blog/does-leonardo-ai-allow-nsfw)
- **GPU/VRAM**: N/A (hosted only).
- **Maturity**: Multi-year established product, active 2026 pricing/feature iteration; no funding/headcount figures found this pass.

### Makeinfluencer-class tools (survey, lower confidence — mostly vendor/affiliate sourcing)
| Tool | Consistency | Pricing | API | Content ceiling | Source |
|---|---|---|---|---|---|
| MakeInfluencer.ai | Persona design + generation, mechanism undisclosed | Not found | Not found | Explicitly supports NSFW; accepts crypto payment | [Toolify](https://www.toolify.ai/tool/makeinfluencer-ai) |
| The Influencer AI (theinfluencer.ai) | Custom character model from uploaded photos | Starter $19/mo (100 credits), Creator $39/mo, Professional $99/mo | **No API** (stated) | Not found | [Capterra](https://www.capterra.com/p/10031029/The-Influencer-AI/) |
| LucidPic | Text or single-photo generation, royalty-free framing | Credit tiers, Large ~$96/mo ($76 annual) | Bulk/API "by request," no public price | Not found | [PowerUsers.ai](https://powerusers.ai/ai-tool/lucidpic/) |
| Fannabe | Attribute-based generation, "Screenshot-to-Content" | Free tier + Premium $29–$199/mo | Not found | Explicit full NSFW support via "high-risk payment processor" | [fannabe.com](https://www.fannabe.com/) |
| Sozee AI | Likeness from 3 photos, no LoRA wait | From $14.99/mo, Creator $59.99/mo | Not found | Markets NSFW support + OnlyFans/Fansly monetization | [Sozee pricing](https://sozee.ai/resources/ai-influencer-platform-pricing-comparison-ai-influencer-generator/) (self-reported/affiliate-heavy sourcing, low confidence) |
| ZenCreator | Face-swap consistency across image/outfit/video | From $19.99/mo (200 non-expiring credits) | **Yes** — live REST API + MCP integration (Claude/ChatGPT/Cursor), 14 tools | Self-describes "unrestricted," explicit NSFW support for OnlyFans/Fansly workflows (unverified privacy claims) | [ZenCreator pricing](https://zencreatorai.com/pricing/) |
| Scenova / Influencer Studio | — | — | — | Both explicitly **SFW-only**, ban NSFW/nudity entirely — contrast point, not a fit for this project's register | aggregated search summary, not independently re-verified against primary ToS |

Caveat: most of this table traces to SEO/affiliate listicles and vendor marketing rather than independent review sites; company-maturity signals (funding, headcount) were not findable for any of these seven.

---

## Open-source stack

### ComfyUI (engine)
- **Maturity**: ~131k GitHub stars, ~15.4k forks, ~5,840+ commits, GPL-3.0. Last commit Aug 31 2026 — actively maintained same-day as this research; backed by Comfy-Org. [GitHub](https://github.com/comfyanonymous/ComfyUI), [Wikipedia](https://en.wikipedia.org/wiki/ComfyUI)

### Flux.1-dev (Black Forest Labs, base model)
- **License**: Non-Commercial License by default — commercial use requires a separately purchased BFL commercial license. Bars military/surveillance/biometric misuse, real-person "digital replica" violations, CSAM, non-consensual intimate imagery; requires AI-disclosure where legally mandated. No specific carve-out (positive or negative) for disclosed-AI fictional personas in swimwear/lingerie register. No runtime content filter ships with the weights — filtering is left to the deployer. [License](https://huggingface.co/black-forest-labs/FLUX.1-dev/blob/main/LICENSE.md), [BFL terms](https://bfl.ai/legal/non-commercial-license-terms)
- **Realism reputation**: Widely reported as current top open-weight photorealism model, "Midjourney-level," beats SDXL on composition/skin realism in most comparisons; weaker on celebrity likeness, can render body types "thicker than intended." [stable-diffusion-art.com](https://stable-diffusion-art.com/sdxl-vs-flux/)
- **VRAM**: ~26–33GB full FP16/BF16; ~24GB (RTX 4090) practical full-quality minimum at FP8; quantized down to ~12GB (FP8), ~10GB (Q4/NF4), ~7GB (Q4 GGUF). [Spheron](https://www.spheron.network/tools/gpu-recommender/black-forest-labs/FLUX.1-dev/), [localaimaster](https://localaimaster.com/blog/flux-vram-requirements-by-gpu)

### SDXL (base model) + realism fine-tunes
- **License**: CreativeML Open RAIL++-M — permissive, commercial + non-commercial, no revenue cap, subject to use-based restrictions (no illegal activity/harmful content/privacy violation) carried forward to derivatives. [License](https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/blob/main/LICENSE.md)
- **Realism reputation**: Behind Flux out-of-the-box, but community fine-tunes close/exceed the gap. **Juggernaut XL** — most-downloaded SDXL checkpoint, photorealism-focused, v9 has 6M+ HF downloads / 1.5M+ Civitai downloads, "Overwhelmingly Positive" (7,780+ reviews). **RealVisXL** — most "camera-like" output in class, edges Juggernaut on portrait/close-up facial detail. [RunDiffusion](https://www.rundiffusion.com/juggernaut-xl), [offlinecreator.com](https://offlinecreator.com/civitai-realistic-models)
- **VRAM**: ~8GB workable with optimization at 512px; ~12GB practical minimum at native 1024px; +LoRA+ControlNet ~12GB; +refiner 16GB+. [gigagpu.com](https://gigagpu.com/sdxl-vram-requirements-4/)

### Character LoRA training (on Flux or SDXL)
- **Mechanism**: LoRA freezes base weights, injects small trainable low-rank matrices into existing layers; only those matrices train on the reference set, teaching a specific identity without full retraining; loaded alongside the base model at inference. [arXiv DiffLoRA](https://arxiv.org/pdf/2408.06740)
- **Dataset size**: ~10 images can work; 10–30 is the common sweet spot — variety (pose/lighting/background) matters more than volume. Standard training resolution 1024×1024. [sanj.dev guide](https://sanj.dev/post/lora-training-2025-ultimate-guide/)
- **Params**: LR ~1e-4 for both; Flux more LR-sensitive (sweep 5e-5–2e-4), lower rank (16–32) vs. SDXL's 32–64.
- **VRAM/cost**: SDXL LoRA — 12GB min, 24GB recommended. Flux LoRA traditionally 24GB min (32GB+ comfortable); kohya's fused-backward-pass optimization (sd-scripts v0.9.0, Jan 2025) can bring it toward 4–8GB on optimized configs. [VRLA Tech](https://vrlatech.com/stable-diffusion-lora-training-hardware-requirements/)
- Training wall-clock not pinned to a hard benchmark in sources found — described in epochs/steps, not minutes; treat as unresolved pending an empirical run.

### kohya_ss (LoRA trainer)
- ~12.6k stars, ~1.6k forks, ~3,468 commits, Apache-2.0. Last commit Jul 10 2026, latest release v26.0.0 (Jul 9 2026) added Lumina Image 2.0 / Anima LoRA support — long-running, still actively updated. Supports LoRA/LoHa/LoKr/Dreambooth/fine-tune/Textual Inversion. [GitHub](https://github.com/bmaltais/kohya_ss)

### ostris/ai-toolkit (LoRA trainer, Flux-focused)
- ~11.9k stars, ~1.5k forks, ~1,484 commits, MIT. Last commit Aug 30 2026 — near-daily cadence. Supports FLUX.1/FLUX.2/FLUX.2 Klein; CLI + modern web UI + Gradio UI for train/caption/publish. Documented min ~24GB VRAM for local Flux LoRA training via its UI. [GitHub](https://github.com/ostris/ai-toolkit)

### InstantID
- **Mechanism**: IdentityNet — ControlNet-like module on facial landmarks + frozen InsightFace embedding, injected via IP-Adapter-style cross-attention into a frozen SDXL UNet. Tuning-free, single reference image. [GitHub](https://github.com/instantX-research/InstantID)
- **Maturity**: 11,988 stars, last push 2024-07-18 — stale (>1yr, appears unmaintained). ComfyUI port (cubiq): 1,835 stars, last push 2025-04-14.
- **License**: Code Apache-2.0, but dependency InsightFace antelopev2 face embedding is non-commercial-research-only — commercial use of the full pipeline is legally encumbered despite the Apache label. [HF discussion](https://huggingface.co/InstantX/InstantID/discussions/2)
- **Realism reputation**: Scored highest overall (38/45) in a third-party comparison, best "face luminosity"/natural lighting; but identity strength trades off against editability — raising "IdentityNet Strength" (recommended when similarity is low) pushes toward an overlaid/plastic look. An academic study flags InstantID's "polished look" as a distinguishing trait vs. techniques favoring raw identity accuracy. [myaiforce.com comparison](https://myaiforce.com/pulid-vs-instantid-vs-faceid/), [arXiv 2505.03557](https://arxiv.org/html/2505.03557v2)
- **VRAM**: One user reports full 24GB consumption with no confirmed low-VRAM fix; community ComfyUI ports report ~12–13GB with reduced settings.

### PuLID
- **Mechanism**: Contrastive alignment + accurate-ID loss during a lightweight training step; injects identity into cross-attention while preserving base-model background/lighting/style more than InstantID. Tuning-free at inference. [GitHub](https://github.com/ToTheBeginning/PuLID)
- **Maturity**: 3,549 stars, last push 2025-07-31 (~1yr old, low-but-not-dead activity). Flux ComfyUI port (balazik): 721 stars, last push 2024-10-03. License Apache-2.0.
- **Realism reputation**: Scored lowest of the three on face-detail/skin-texture/luminosity, but highest on prompt adherence/style preservation (least reference-photo "leakage"). Own paper claims better ID-fidelity/editability balance than InstantID/FaceID — a claimed-vs-tested discrepancy vs. third-party comparison. [myaiforce.com](https://myaiforce.com/pulid-vs-instantid-vs-faceid/)
- **VRAM**: PuLID-FLUX optimized to run on 16GB; 8-bit quantized ~12GB. SDXL-PuLID lighter than FLUX variant.

### IP-Adapter / IP-Adapter FaceID
- **Mechanism**: Base IP-Adapter injects a CLIP image-embedding as an added "image prompt" via cross-attention. FaceID variant swaps in an InsightFace face-recognition embedding, optionally + LoRA/CLIP embedding ("FaceID Plus/PlusV2") for likeness+background balance. [GitHub](https://github.com/tencent-ailab/IP-Adapter)
- **Maturity**: Base repo 6,680 stars, last push 2024-06-28 — >2yr stale, effectively unmaintained upstream. ComfyUI port (cubiq): 6,120 stars, last push 2025-04-14, GPL-3.0.
- **License**: Base code Apache-2.0; **FaceID weights are non-commercial-only** (trained on InsightFace embeddings whose license restricts to non-commercial research) — explicit on the model card. [HF model card](https://huggingface.co/h94/IP-Adapter-FaceID), [HF discussion](https://huggingface.co/h94/IP-Adapter-FaceID/discussions/18)
- **Realism reputation**: Scored second overall (30/45) — strongest raw face-similarity, weakest prompt adherence (can visually "paste" the identity at the cost of scene coherence). [myaiforce.com](https://myaiforce.com/pulid-vs-instantid-vs-faceid/)
- **VRAM**: Standard SDXL IP-Adapter is VRAM-heavy without quantization; some NF4/flash-attention community builds report ~6GB.

### ReActor (ComfyUI/A1111 face-swap node)
- **Mechanism**: Post-hoc face-swap (not diffusion-native) — InsightFace detect/align + `inswapper_128` ONNX swap model, optional GFPGAN/CodeFormer restoration pass.
- **Takedown history**: Original repo `Gourieff/comfyui-reactor-node` now returns 403 ("repository access blocked"), consistent with reports GitHub disabled it for ToS violation. Maintainer relocated as `Gourieff/ComfyUI-ReActor`, explicitly branded "(SFW)," mirrored on Codeberg. [Codeberg mirror](https://codeberg.org/Gourieff/comfyui-reactor-node), [current repo](https://github.com/Gourieff/ComfyUI-ReActor)
- **Maturity**: Current repo 1,329 stars, last push 2026-08-30 (actively maintained), GPL-3.0.
- **Content-policy baked in**: Ships a mandatory NSFW pre-filter (ViT-based classifier, `vit-base-nsfw-detector` by AdamCodd, threshold 0.96) that scans the source image and aborts the swap on a positive hit; no documented toggle in the maintained SFW-branded repo. Unofficial forks exist that strip this filter (e.g. `art1524/ComfyUI-ReActor-NSFW`) — outside the maintained line. [DeepWiki](https://deepwiki.com/Gourieff/ComfyUI-ReActor/3.4-nsfw-detection)
- **Realism reputation**: Bounded by 128px swap-model resolution and blend/alignment quality; generally treated as good for quick likeness transfer but more visible seams than diffusion-native identity conditioning without a strong restoration pass. No specific citable Reddit thread quantifying this found.

### Roop (predecessor lineage)
- **Status**: Archived by original author (s0md3v), `archived: true`, last push 2026-03-13, 3,559 stars, AGPL-3.0. Author cited concerns about non-consensual deepfake misuse as reason for discontinuation (secondhand-sourced via search snippets, not independently re-fetched). [repo](https://github.com/s0md3v/roop)
- **Successors**: Community forks continued the codebase — most notably `hacksider/Deep-Live-Cam` (96,222 stars, last push 2026-08-29, AGPL-3.0), now far larger/more active than any other repo in this survey; real-time face-swap.

---

## SHORTLIST — 3 stacks for bake-off

**1. Open-source: ComfyUI + Flux.1-dev (or SDXL/Juggernaut XL) + character LoRA via ostris/ai-toolkit or kohya_ss**
Best consistency-realism ceiling of anything surveyed (Flux's realism reputation + LoRA gives durable, reusable identity, not a per-session reference hack); zero external content-policy filter to fight since it's self-hosted (deployer sets their own line); fully automatable via ComfyUI's API/workflow-JSON. Downside: highest setup/iteration time-cost, Flux commercial-use requires a paid BFL license (verify before any monetized use), and LoRA training wall-clock is not empirically pinned yet.
- **Bake-off cost estimate** (40 stills + 1 LoRA train): GPU rental (24GB card, e.g. RTX 4090 pod) at ~$0.35–0.50/hr. LoRA training ~1–3 hrs (unconfirmed, needs empirical check) ≈ $0.50–1.50. Inference for 40 stills (~10–20 sec/image on a 4090) ≈ 15 min ≈ $0.10–0.15. **Total compute: ~$1–3**, plus BFL commercial-license fee if Flux is used commercially (amount not published, contact BFL) and several hours of engineer setup/iteration time.

**2. SaaS: Glambase**
Only candidate whose ToS explicitly names fictional adult nudity as permitted, so swimwear/lingerie register is unambiguously inside its stated ceiling (contrast with Higgsfield/Krea/Midjourney/Leonardo, which either explicitly ban "suggestive" imagery or flag swimwear as a filter false-positive risk). Cheapest SaaS entry price. Downside: no confirmed API (manual UI workflow), consistency mechanism undisclosed, thinner/mixed maturity signals.
- **Bake-off cost estimate**: 1 month at $14.99–~$30/mo tier (whichever unlocks enough generation volume for 40 stills) ≈ **$15–30**, plus manual-UI labor time (no automation confirmed).

**3. SaaS: Higgsfield (Soul ID)**
Best realism reputation and the most genuinely automatable SaaS (official API + docs + third-party SDKs), well-capitalized company (low platform-risk). Include specifically to empirically test whether the swimwear/lingerie register clears its filter in practice, since its own help docs flag swimwear as a common false-positive trigger — this is a live open question worth $19 to resolve before betting a production pipeline on it.
- **Bake-off cost estimate**: Starter tier $19/mo (270 credits) comfortably covers Soul ID training (one-time, ~3–5 min) + 40 stills at an estimated ~$0.009–0.07/image. **Total: ~$19–25.**

**Recommended bake-off spend**: ~$35–58 total across the three stacks (plus GPU time already counted in #1), before any BFL commercial-license fee. Run Higgsfield first (cheapest, fastest signal on the content-ceiling question) — if it fails swimwear/lingerie in practice, that resolves the biggest open risk cheaply before investing setup time in the open-source LoRA path.
