# R9 — Broad adult-capable generation market sweep

**Scope and date.** Research only; no content was generated, requested, viewed, or tested. Facts are from public terms, docs, pricing pages, and independent (non-vendor) coverage checked **2026-08-31**. This extends r7 (which covered the narrow "AI-influencer persona SaaS" corner: Glambase, ZenCreator, Eromify, Fannabe, Sozee, MakeInfluencer.ai — not repeated here) plus r7's open-weight stack, banned-inference-host findings (fal.ai, Replicate, RunPod, Modal), video state-of-play, and platform/legal context, which also stand and are not repeated. "Permits" below means the publisher's currently published text does not prohibit the stated fictional-adult use; it is not a promise that a filter, payment rail, or local law will allow it in practice. Where a review site's claim contradicts the vendor's own primary text, the primary text wins and the contradiction is flagged — this market has a documented pattern of marketing claiming more permissiveness than the actual terms allow (Mage.space, TensorArt's main site) and of platforms being forced into sudden restructuring under processor/regulator pressure (TensorArt, SeaArt, Unstable Diffusion, Civitai's own 2024 Mastercard episode per r7).

Four parallel research passes fed this report: large community generation platforms, dedicated adult-image generators, adult-capable video APIs, and adult-permitting GPU/inference hosts.

---

## 1. Comparison table — all credible entries

| Service | Category | Adult content per published terms | Own-LoRA upload? | API | Pricing | Durability read |
|---|---|---|---|---|---|---|
| **Civitai** (site) | Community platform | Permitted under opt-in X/XXX rating tiers (explicit nudity/sexual acts), layered with absolute bans (minors, non-consent, real people, incest) | **Yes** — Orchestration API, upload dataset, train SDXL/SD1.5/Flux LoRA | **Yes**, documented Site API + Orchestration API, Bearer auth | "Buzz" credits; LoRA training ≈2000 Buzz/run | Long-running, large community, real dev infra; had a 2024 Mastercard-pressure episode (r7); ToS §9.6 vs. rating-tier system reads in tension — verify live |
| **SeaArt** | Community platform | Permitted but actively tightening (Sept 2025 restriction announcement); CSAM/deepfake content found by investigators June 2025 | Yes, UI-only LoRA training with 70% creator revenue share | Not found (UI/ComfyUI-style workflow, no third-party API product) | Free daily "Stamina" + non-expiring credits; $4.79–$75/mo tiers | **Weak.** Google pulled its Play Store app after a CSAM investigation; policy actively tightening since |
| **TensorArt** (main site) | Community platform | **SFW-only since 2025-11-27** — NSFW split off to sister site TensorHub, reportedly under processor/regulator pressure | Not confirmed for TensorHub | Not found | Free daily credits (Tensor.Art); paid Token currency (TensorHub) | **Weak-to-mixed.** The forced split itself is the clearest documented precedent in this sweep of processor/regulatory pressure reshaping a platform |
| **PixAI** | Community platform | Permitted for stylized/anime content only; **"sensitive content using realistic models is not allowed"** | Yes (LoRA upload/training, UI) | Referenced in ToS but docs/endpoints not reached | Credits/membership, exact pricing not confirmed | Evidence unavailable on age/ownership/traffic |
| **Yodayo / Moescape** | Community platform | Capped at R-rating; **explicit nudity/lewd content banned** in the ToS text, despite reputation as NSFW-friendly | Not confirmed | Not found | Not confirmed | Moescape spun off as an SFW app-store-safe sibling — same "forced split" pattern seen elsewhere |
| **OpenArt** | Community platform | **Explicitly prohibited** (sexually explicit/pornographic content banned) | Own "Character Training" feature exists but not confirmed as raw exportable LoRA | **No public API** ("No public API is available currently" — vendor's own words) | $13–$175/mo tiers | Not a fit; ruled out |
| **NovelAI** | Community platform | No explicit clause found either way in primary ToS/FAQ; reputation (not verified terms) is NSFW-permissive for anime images | **No** — vendor FAQ states explicitly no user-created image modules/personal finetunes | No official supported API (only reverse-engineered community wrappers, one now archived) | $10–$25/mo tiers + Anlas | Long-running brand; not usable for a compliant own-LoRA pipeline |
| **Shakker** | Community platform | Evidence unavailable (ToS not reached); NSFW LoRAs are hosted, implying some tolerance | Yes — strong LoRA training/fine-tuning is its core positioning | Not confirmed | Free 200 tokens/day; paid from $12/mo | **Unconfirmed shutdown flag** — a possible "closes 30 Sept 2026" banner appeared on some fetches but not the live homepage; verify directly in-browser before relying on it |
| **Liblib** | Community platform | **Prohibited** — "all pornographic or sexually explicit content" banned under Chinese platform/regulatory policy, with escalating enforcement | Yes, strong LoRA training | Yes, documented, tiered ($50–100+/mo), rate-limited | Credit-based | Not a fit despite strong technical stack; ruled out by its own ban |
| **Mage.space** | Community platform | **Prohibited in the actual legal text** ("pornographic content is prohibited... where the primary intention is sexual arousal"), **contradicting** third-party review claims that a paid tier "enables NSFW" | Third-party reviews mention "custom model import" on a $30/mo tier, unconfirmed against primary docs | Referenced (API licensing clause + SDKs mentioned) but no pricing/rate-limit docs reached | ~$15–$30/mo per reviews | Marketing/reality gap is itself a red flag — don't rely on Mage without a written confirmation |
| **Prodia** | Community/infra platform | **Prohibited, broadly and explicitly**; even sells its own NSFW-detection API as a product | Not evident — built around pre-built third-party models, not custom fine-tunes | Yes, real documented REST API | Pure pay-per-generation, $0.001–$0.05/output | Infra-vendor profile, but explicitly not usable for adult content |
| **Sinkin** | Community/infra platform | No explicit NSFW clause; only a vague discretionary "objectionable content" standard | Evidence unavailable | Markets an API, pay-as-you-go (~$0.0015/credit), but ToS itself has no API-specific terms | ~$0.0015/credit | Evidence unavailable on ownership/scale |
| **PornPen** | Dedicated adult generator | Evidence unavailable (site unreachable; no primary ToS retrieved) | Not evident (tag-menu generation; "custom characters" feature undocumented) | Not found | $2/24h trial; ongoing price opaque to logged-out visitors | **Weak** — Patreon banned all AI-porn sites and deleted PornPen's page without warning (vendor's own account) |
| **SoulGen** | Dedicated adult generator | Own ToS text **prohibits** "pornographic, indecent, lewd" content, contradicting its market positioning as an NSFW generator | Not evident (built-in character creator + face-reference "Portrait" feature only) | Yes — live site lists an API Center (details unconfirmed) | ~$10–13/mo | Operated by Synapse AI Limited, Hong Kong; no funding/age data found |
| **Candy.ai** | Dedicated adult generator | ToS defers adult-content rules to separate community/blocked-content policies; output restricted to personal, non-commercial use | Not evident (built-in character builder only) | Not found | Hybrid subscription ($19.99/mo) + token metering | **Weak-to-mixed.** Operated by EverAI Limited (Malta); accepts crypto alongside cards; masks card charges under a neutral merchant name; ToS threatens to blacklist chargeback filers — defensive posture typical of processor friction |
| **Seduced.com** (formerly Seduced.ai) | Dedicated adult generator | Explicitly permits explicit/sexual content under "Model Verification," gated tiers for hardcore | **Only for verified adult performers** — general customers get no open LoRA upload | Not found | ~$10–50/mo tiers | Operated by Undresso Media Group SRL (Romania); pays via **CCBill and Epoch** (adult-specific high-risk processors) + crypto — a clear fragility tell |
| **Unstable Diffusion** | Dedicated adult generator (case study) | N/A — durability case study | N/A | N/A | $14.99–$59.99/mo (unstability.ai) | **Textbook fragility case.** Kickstarter shut its campaign (raised $56k, refunded); Stripe and Patreon both later suspended it; revenue has *shrunk* from ~$2.5k/mo (2022) to ~$2k/mo (2026) despite a 300k-member community |
| **Promptchan** | Dedicated adult generator | Prohibits minors and non-consensual deepfakes; otherwise permits generated adult content, does not use "private mode" output for training | **No** — built-in character creator + community "clone" feature only, no raw LoRA upload | **Yes — the strongest documented API of any dedicated adult generator surveyed** (`/api/external/create`, `/chat`, `/video_v4/submit`, key-based auth) | $14.99–$33.99/mo + gem currency | No ownership/funding data found; no controversy history found either — thin but not negative |
| **DreamGF.ai** | Dedicated adult generator (companion/chat) | Not directly confirmed, but operates openly as an adult companion product | Not evident | Not found | $9.99–$99.99/mo | Operated by DreamAI SRL (Romania); **card-only (Visa/Mastercard), no crypto** — the one dedicated adult vendor in this sweep using only mainstream rails |
| **Nectar.ai** | Dedicated adult generator (companion/chat) | Not directly confirmed | Not evident | Not found | From ~$5/mo (partial data) | Entities in Delaware and London; publishes an Anti-Trafficking Policy and Content Removal Policy — unusually mature compliance posture for this category |
| **Pirr** | Category mismatch | N/A | N/A | N/A | N/A | Text/story roleplay app, not an image generator — drop from shortlist consideration |

Video-generation and inference-host findings are broken out in their own sections below because they answer different questions than the image-generation table.

---

## 2. Per-entry detail — top candidates

### Civitai (the standout)

Civitai's core ToS (§9.6) reads, in isolation, like a ban on pornography and nudity. But its actual operative system is a five-tier content-rating scheme users opt into after 18+ confirmation — PG, PG-13, R, **X** ("graphic nudity, genitalia, adult objects and settings"), and **XXX** ("sexual acts, disturbing or graphic content") — and its "Policy & Content Adjustments" article confirms the on-site generator enforces X/XXX rules directly (mandatory generation metadata on X/XXX uploads, blocked celebrity names when X/XXX browsing is enabled, forced 50% denoise on bring-your-own-image inputs). Read together, explicit sexual content and nudity **are** permitted platform-wide under the X/XXX ratings, layered under absolute bans on minors, non-consent, real people/celebrities, incest, self-harm, and specific fetish categories. [ToS](https://civitai.com/content/tos) · [Policy & Content Adjustments](https://civitai.com/articles/13632/policy-and-content-adjustments) · [Guide](https://education.civitai.com/using-civitai-a-guide/)

Character consistency is the strongest of anything found in this sweep: a documented **Orchestration API** lets a user upload a training image set (zip) and submit an SDXL/SD1.5 or Flux.1-dev/schnell LoRA training job; the resulting LoRA is referenced by its "AIR" identifier directly in generation calls. This is a genuine, general-purpose, own-LoRA-via-API workflow — not a platform-only identity feature. [Training docs](https://developer.civitai.com/orchestration/recipes/training-flux1)

API access is real: a Site API (`civitai.com/api/v1/`, metadata only) plus the separate Orchestration API for generation/training jobs, both Bearer-token authenticated, with automated access contractually permitted under ToS §11.4 "subject to applicable rate limits" (specific numeric limits not published). Pricing runs on a "Buzz" credit currency — a default LoRA training run (2000 steps / 10 epochs) costs roughly 2000 Buzz.

Durability: Civitai is a long-running, large community hub with real developer infrastructure investment (a dedicated `developer.civitai.com` program), which is a stronger continuity signal than any single-purpose adult SaaS in this sweep. It also has a track record of reactive-but-survived policy tightening rather than shutdown — including the 2024 Mastercard-pressure episode already noted in r7. The one open item: the tension between the absolute-ban clause language and the rating-tier system in practice should be verified live (a real X/XXX generation call) before any production commitment, since policy has shifted before.

### TensorArt / TensorHub — a documented forced restructuring

The main Tensor.Art site went fully SFW-only on 2025-11-27, reportedly under payment-processor and regulatory pressure specifically about non-consensual imagery; NSFW capability was spun out to a separate paid sister platform, TensorHub, with its own token currency and an 18+ gate of unverified strictness. This is the clearest single dated precedent in this sweep of an adult-AI-image platform being forced to restructure specifically over adult-content compliance risk — treat it as a live warning of what can happen to any platform in this space, including ones currently permissive. [Policy summary](https://goongen.ai/blog/tensor-art-nsfw-policy) — primary ToS text could not be fetched directly (repeated 403s), so exact clause wording is unverified; the restructuring event itself is corroborated by multiple secondary sources.

### SeaArt — capability exists, durability is the worst in the community-platform group

SeaArt permits adult content (gated, tightening as of Sept 2025) and supports on-platform LoRA training with a 70% creator revenue share — but a June 2025 investigative report (Núcleo, Pulitzer Center-affiliated) found CSAM and non-consensual celebrity deepfakes on the platform, and Google pulled the SeaArt app from the Play Store shortly after. SeaArt responded with a public zero-tolerance statement and tightened NSFW policy in September 2025. [Pulitzer Center report](https://pulitzercenter.org/stories/after-pulitzer-center-supported-report-google-removes-ai-app-child-abuse-content) — Any operator using SeaArt inherits reputational-association risk from this history regardless of how lawful and disclosed our own use would be, on top of the platform's own trend toward restriction.

### Promptchan — best API among dedicated adult generators, weak on LoRA portability

Promptchan has the most complete documented REST API of any dedicated adult-image service found (`/api/external/create` for text-to-image, `/api/external/chat`, `/api/external/video_v4/submit` for async video, key-based auth). Its published position explicitly bans minors and non-consensual deepfakes while otherwise permitting generated adult content, and states private-mode output isn't used for training or public display. Its weakness against our stated priority: character consistency runs through a built-in character creator plus a community "clone" feature, not a general-purpose own-LoRA upload — so persona identity is *not* portable off the platform the way Civitai's is. No company/ownership/funding information was found, but no controversy history was found either. (Confidence note: the terms summary here comes from aggregated search snippets, not a direct fetch of the vendor's terms page, which returned DNS/404 errors — slightly lower confidence than the Civitai/SeaArt/TensorArt findings above.)

### Seduced.com — LoRA training exists but is gated to verified performers, not us

Seduced.com (the current name; `seduced.ai` now redirects here) explicitly permits explicit content under a "Model Verification" framework and lets **verified adult performers** train and publish their own AI model — but this is not available to a general business/API customer wanting to train a persona LoRA. Payment runs through CCBill and Epoch (adult-industry-specific high-risk processors) plus crypto, rather than mainstream card rails — a fragility signal consistent with the rest of this market. [Terms](https://www.seduced.com/terms)

---

## 3. Which platforms let us bring our own LoRA

This was the operator's specific, highest-value capability question — being able to train identity once and run it portably across compute, rather than being locked into one platform's built-in character feature.

**Confirmed general-purpose own-LoRA upload/training (any user, via documented workflow):**
- **Civitai** — full workflow via Orchestration API (upload dataset → train → reference by AIR ID in generation calls). The only entry in this entire sweep offering own-LoRA training *and* documented API access *and* an explicit permission for adult content.
- **SeaArt** — LoRA training supported, UI-only (no API found), 70% creator revenue share on paid use of published LoRAs.
- **PixAI** — LoRA upload/training supported, but the platform's own content policy bans "sensitive content using realistic models," which likely rules out a photoreal adult persona even though the LoRA mechanism itself exists.
- **Shakker** — LoRA training/fine-tuning is core to its positioning, but adult-content policy and current operating status are both unconfirmed (see the shutdown-banner flag above) — verify directly before relying on it.
- **Liblib** — full LoRA training + documented rate-limited API, but the platform bans all pornographic/sexually explicit content outright, ruling it out regardless of its technical strength.

**Own identity feature only, no general LoRA upload:** Candy.ai, SoulGen, Promptchan (built-in creator/clone), NovelAI (explicitly rules out user finetunes/image modules by its own FAQ).

**LoRA training exists but gated to a narrow group, not us:** Seduced.com (verified performers only).

**Net finding:** Civitai is the only platform in this sweep combining an explicit adult-content permission, a documented API, and open own-LoRA training/upload — exactly the "keep identity portable while using their compute" requirement the operator flagged. Every other platform requires trading away one of those three.

---

## 4. Adult-permitting inference/GPU hosts

This was flagged as the single highest-value open question: is there a counterpart to r7's finding that fal.ai, Replicate, RunPod, and Modal all explicitly ban adult workloads? Fifteen additional GPU/inference/ComfyUI-hosting providers were checked against their actual published terms.

**Finding: no counterpart exists.** None of the fifteen providers researched publish a clause that affirmatively *permits* lawful adult content generation. The landscape splits three ways:

**Explicitly prohibit adult content** (confirmed via primary ToS/AUP text):
- **Novita.ai** — AUP §5(7) bans "sexually explicit" content outright, directly contradicting its community reputation as NSFW-permissive. Reputation is not terms.
- **Getimg.ai** — explicit, broad ban on intimate/sexual/pornographic content.
- **Runware** — bans "obscene, lewd, lascivious... or otherwise objectionable (as determined by us)" — a sole-discretion clause that functions as a ban even without using the word "pornography."
- **ComfyICU** — bans "explicit pornography" alongside CSAM and other prohibited categories, despite being a hosted-ComfyUI-as-a-service model where the workflow itself is user-controlled.
- **InstaSD** — explicitly lists "pornography or graphic adult content" among unauthorized marketplace offerings — notable because it's a Stable Diffusion/ComfyUI workflow marketplace, where one might assume more permissiveness.
- **Civitai's own hosted generation API terms (§9.6)** — bans pornography/explicit sexual content in the same document that (per section 2 above) also operates the X/XXX rating system that permits it on-site. This internal tension is exactly why Civitai needs live verification before being relied on for the paid tier, despite being the most promising candidate found.
- **RunDiffusion** — has a *dedicated* NSFW policy page (rare in this list) but it only permits "artistic expression... when it remains legal, respectful, and within policy" for stylized/classical nudity, and explicitly bans "pornographic or sexually explicit material" and "fetish or sexually suggestive imagery" — i.e., it addresses the topic directly only to rule out the paid-tier use case.

**Silent or narrow-scope (no adult-content ban found, but also no permission — absence of a ban is not a safe harbor)**:
- **TensorDock** — narrowest prohibition found: its AUP explicitly bans only CSAM and non-consensual/"revenge" pornography, with no general ban on lawful consensual adult content.
- **SaladCloud** — similarly narrow: only CSAM/trafficking explicitly banned in the text retrieved.
- **ThinkDiffusion** — no adult-content clause at all found; only generic "comply with applicable law" language.
- **DeepInfra** — no dedicated content clause found; only generic illegal/fraudulent-use and "high-risk use" (nuclear, aircraft, medical, weapons) restrictions.
- **Vast.ai** — bare-metal GPU rental; ToS bars "obscene" content generically with no dedicated adult clause and no explicit statement that the renter bears full compliance responsibility.
- **Segmind** — no dedicated NSFW clause; generic fraud/illegality/third-party-rights language only.

**Evidence unavailable**: Massed Compute (terms page would not render through automated fetch) and Comfy Deploy (no live terms URL located).

**Conclusion: treat all fifteen as non-safe-harbor for explicit content.** The closest things to a workable gap are the narrow-prohibition providers (TensorDock, SaladCloud) and the silent providers (ThinkDiffusion, DeepInfra, Vast.ai, Segmind) — but silence or a narrow ban is not the same as a written permission, and most of these same documents carry separate general "objectionable content" catch-alls elsewhere that could still be invoked. **A specific written confirmation from the provider, not inference from an absent clause, is the only way to actually clear one of these for the paid tier.** This reinforces r7's original recommendation: self-operated ComfyUI on controlled hardware (or a provider that gives written confirmation) remains the safer infrastructure path for the paid explicit lane, since no hosted inference API in either sweep offers an affirmative adult-content permission.

---

## 5. Adult-capable video generation

Covered briefly here since it bears on backbone choice; not the primary deliverable of this sweep.

Every mainstream video-gen API checked (Runway, Pika, Luma Dream Machine, Kling, Hailuo/MiniMax, PixVerse, Stability AI's hosted video API) explicitly bans adult/sexually-explicit content in its published terms — confirmed via primary ToS text for all but Kling (converging secondary sources only). A handful of niche "uncensored" video API vendors exist (SpicyAPI, A2E.ai, NoCensorAI, ZenCreator) but none disclose company age, funding, or payment-processor type on their public pages — itself a durability red flag typical of this market. The most credible option found is **Sogni AI's "Wan 3 Uncensored" model** — a real, documented API on an established multi-model platform (not a single-purpose adult site), explicit about requiring lawful, 18+ subject matter, gated behind a "Sensitive Content Filter" toggle, priced $0.0845–$0.338 per output-second. **Civitai's Orchestration API** also supports third-party video models (Wan, Kling, Hailuo, Hunyuan, LTX, Veo 3) as a multi-model gateway, but its own on-site content-moderation boundary for video specifically wasn't confirmed as permitting explicit output. **Net finding: no well-documented, durable, purpose-built adult-video API clearly exists** — this matches and extends r7's video-state-of-play finding that the credible route remains self-hosted I2V (Wan/HunyuanVideo in ComfyUI).

---

## 6. Ranked shortlist — 2 SaaS candidates for a paid head-to-head trial

Ranked primarily on durability + capability match to "keep identity portable via own-LoRA," not marketing polish, per the operator's brief.

### #1 — Civitai (Orchestration API)

**Why it's #1:** It is the only service found across both r7 and this sweep that combines all three things the paid tier needs — an explicit, on-record permission for adult content (X/XXX rating tiers), a documented API for both LoRA training and generation, and long-running community/infrastructure durability signals stronger than any single-purpose adult SaaS. It directly answers the operator's "let us bring our own LoRA" requirement, which nothing else in the dedicated-adult-generator category offers at all.

**What the trial needs to resolve:** the tension between ToS §9.6's blanket prohibition language and the rating-tier system's actual permission — this should be tested with a live, disclosed-fictional-persona X-rated generation call (not our stated deliverable, so this is a next-step recommendation, not something executed in this pass) before any production commitment.

**Estimated trial cost:** Low. Buzz-credit pricing puts a single LoRA training run at roughly 2000 Buzz; combined with generation-call testing, a meaningful trial (train one persona LoRA + generate a representative output set across rating tiers) should run in the **low tens of dollars** (an exact Buzz-to-USD rate wasn't independently verified in this pass and should be confirmed against Civitai's current credit-purchase page before budgeting precisely).

### #2 — Promptchan

**Why it's #2, over SeaArt:** SeaArt technically satisfies the own-LoRA requirement (Civitai's advantage), but its durability signals are the weakest in this entire sweep — a documented CSAM investigation, a resulting Play Store removal, and an active trend toward tightening restrictions. Given the operator's instruction to weight durability heavily, that combination outweighs SeaArt's LoRA capability: using it risks reputational association regardless of how lawful and disclosed our own use is, and its own trajectory suggests less runway, not more. Promptchan instead offers the most complete, stable, currently-documented API of any dedicated adult-image generator surveyed, an explicit and specific adult-content permission (not just marketing), and no negative durability signals found (though also no positive ones — the evidence is thin, not damaging).

**What it costs us:** Promptchan's character-consistency mechanism (built-in creator + clone feature) is not a portable LoRA — this is the honest trade-off against Civitai and against the operator's stated preference. It's included as the #2 trial candidate specifically to test whether its in-platform consistency is "good enough" as a fallback path if the Civitai ToS-ambiguity resolution goes badly, not as an equal alternative on capability grounds.

**Estimated trial cost:** Low. Subscription tiers run **$14.99–$33.99/month**; a one-month Premium/Pro-tier trial plus contacting the vendor for API pricing/rate-limit terms (not publicly listed) should land in the **$25–$50** range for the subscription itself, before any per-call API costs the vendor discloses on inquiry.

### Not shortlisted, but noted for completeness

- **SeaArt** — real capability (LoRA + adult permission) but ranked out specifically on durability per the reasoning above; could be reconsidered only if the operator wants a third comparison point specifically to stress-test our risk tolerance for platform-reputation exposure.
- **TensorHub / Liblib / Mage.space / OpenArt / NovelAI / Prodia** — each ruled out above on a specific written-terms basis (SFW-only, outright content ban, marketing-vs-terms gap, no API, no LoRA support, or explicit prohibition) rather than durability.

**Bottom line for the backbone decision:** this sweep does not change r7's core structural recommendation — no hosted inference API (in either survey) offers a clean, affirmative adult-content permission, so self-operated ComfyUI on controlled hardware remains the safest default for the paid lane. What this sweep adds is that **Civitai is a legitimate, cheap, low-commitment SaaS candidate to test head-to-head against that self-hosted build**, specifically because it is the only service that lets us keep a portable persona LoRA while borrowing someone else's compute and content-moderation liability. Promptchan is a reasonable second data point on API completeness and stability, with the explicit caveat that it costs us LoRA portability to get it.
