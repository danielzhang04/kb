# R6 — Generation Stack Real-Output Evidence Audit

Scope: judge candidate image-generation stacks by their PUBLISHED, REAL OUTPUTS rather than marketing claims. All evidence below is public, SFW-to-swimwear-register showcase content. No explicit/NSFW material was sought or viewed; any target gated behind an 18+ click-through, login wall, or bot-detection challenge (Cloudflare, CAPTCHA, rate-limit) was treated as "evidence unavailable" and skipped rather than bypassed. Compiled 2026-08-31 via three parallel research passes (SaaS stack, open-source stack, known operator accounts). Builds on R1 (stack survey/reputation/pricing) and R4 (operator business facts) — this pass fills the visual-judgment gap neither of those covered.

**Method note / standing caveat that applies to every section below:** independent, organically-posted third-party evidence (Reddit remix posts, X posts, Trustpilot review photos, YouTube reviewer footage) was almost entirely unreachable this pass — Reddit and Trustpilot returned bot-detection walls on direct browse, `site:reddit.com` search returned nothing indexed for any of the open-source tools, X search timed out on a login/rate wall, and YouTube frame extraction returned 403s. Per the content/access guardrails, none of these walls were bypassed. As a result, **almost every score below rests on vendor-curated (company showcase page) or creator-curated (CivitAI model page / GitHub official demo) material** — the single most favorable version of each stack's output, not confirmed in-the-wild median quality. This is flagged per-stack below and is the single biggest evidence gap carried into the final section.

One research agent also flagged that the browser-automation tooling in this environment was connected to the operator's live desktop Chrome session rather than an isolated sandbox (it saw a real Gmail inbox, an open GitHub PR, and a live search tab, and its first action closed one of the operator's existing tabs). It caught this immediately and switched to downloading images from press-CDN URLs and viewing the files directly instead of live-navigating. No further desktop interaction occurred. Flagging here as an operational note for future browser-tool dispatches on this machine, not a finding about any stack.

---

## 1. Higgsfield Soul ID

**Evidence viewed:** [higgsfield.ai/soul-intro](https://higgsfield.ai/soul-intro) (vendor page, personally viewed via live screenshots). Hero carousel: an editorial paparazzi-style car scene and a candid street swimwear shot. Feature grid: a woman in a silk dress on a vintage sofa (genuinely photographic lighting/fabric texture) next to a deliberately grainy "iPhone snapshot"-style candid of two women on a street. The "Character Consistency with Soul ID" section shows a real 7–8 image set of **one** platinum-blonde/pale-featured model across: a car-seat selfie with a visible tattoo, a painted floral portrait, a Sailor Moon cosplay selfie, a plain front-facing portrait, a pink boudoir/couture editorial, a Chinatown-style street-fashion shot, and a fantasy mermaid/shell shot. Text-only corroboration: a Medium (302.AI) review and an independent roundup both describe Soul ID as "closer than most tools at this price point to solving character consistency," with the caveat that it degrades on extreme angles or poor source photos.

- **Non-AI realism: 4/5.** Real skin texture (visible pores/redness in the plain portrait), plausible environmental integration (real street signage, cars, background people), and a deliberately "candid photo" aesthetic rather than glossy CGI in several shots. More heavily styled editorial shots still read as professional photography rather than plastic AI output.
- **Identity consistency: 4/5.** The same distinctive face (pale brows, blue-grey eyes, thin lips, white-blonde hair) held up across 7–8 very different styles/lighting setups. Caveat: an unusually distinctive (albino-adjacent) look may be an easier case to hold consistent than an average face.
- **Confidence: Medium.** A real multi-image set was personally viewed, but it is 100% vendor-selected — zero independent Reddit/X/Trustpilot posts with photos were found to corroborate it.
- **Sample bias:** Small (~20 images, one landing page), all vendor-curated best-case material. No organic user evidence found.
- **Video:** None viewed this pass (Higgsfield's video product exists per R1 but was not sampled here).

---

## 2. ZenCreator

**Evidence viewed:** [zencreator.pro/ai-influencer-generator](https://zencreator.pro/ai-influencer-generator) (personally viewed) — only 3 example images exist on the entire marketing page: a before/after face-swap comparison (blonde woman), a studio portrait of a man in a suit, and a lifestyle/ad-creative thumbnail. No deeper gallery exists; further scrolling is text-only (stats, FAQ, pricing). [Trustpilot](https://www.trustpilot.com/review/zencreator.pro) was blocked by a Cloudflare "Verifying Connection" wall — no review photos could be viewed (R1's text-based sentiment stands, unverified visually here).

- **Non-AI realism: 3/5.** The 3 available images are competent but generic stock-headshot quality — noticeably more "AI-clean"/generic than Higgsfield's candid-style shots, without being obviously plastic.
- **Identity consistency: insufficient evidence.** No multi-image set of one character was findable anywhere accessible.
- **Confidence: Low.** Thinnest sample of any stack in this audit — no independent posts found at all.
- **Sample bias:** Only 3 vendor images total exist to examine on the whole site — effectively no real sample size to judge from.

---

## 3. Glambase

**Evidence viewed:** [glambase.app](https://glambase.app/) public Explore feed (personally viewed, no age-gate on this page) — ~9 distinct persona cards, single image each: a pink-hair/cowboy-hat/blonde trio in the hero, plus "Aphrodite," "Dora," "Aya," "Gothic Mel...," "Lola," "Cleopatra" cards (swimwear/corset/lingerie-adjacent register, within the project's stated ceiling). Deeper per-persona profile pages and the `/gallery` page both sit behind an 18+ age-verification click-through — **skipped without clicking through**, per the content-ceiling rule, so no multi-image identity set was obtained. An independent-ish review ([make-influencer.ai](https://make-influencer.ai/tools/glambase), text only) states "image quality below dedicated generators like Midjourney or RenderNet," which lines up with the direct visual read.

- **Non-AI realism: 2.5/5.** Consistently glossy/airbrushed, very smooth skin with a "digital doll" quality rather than photographic texture — competent for a chat-companion profile picture, the least photoreal of the SaaS tools actually viewed.
- **Identity consistency: not scored / insufficient evidence.** Every public-feed card shows only one image per persona; multi-image galleries sit behind the 18+ wall that was correctly not crossed.
- **Confidence: Low-medium.** ~9 real thumbnails were personally viewed plus one independent text corroboration, but zero multi-image or independent-post evidence exists in reach.
- **Sample bias:** The public feed itself is likely curated ("Legend" tier badges suggest featured/flagship personas) — even this is closer to a vendor showcase than random output.

---

## 4. Eromify

**Evidence viewed:** [eromify.com](https://www.eromify.com/) (personally viewed, full scroll) — two real multi-image sets of single characters, both marketing for a new "Claude MCP connector" feature: an 8-image "Lily" set labeled "trained LoRA" (red dress in an ornate room, black outfit lounging, sheer top on a wooden deck, an outfit at a beach pier, white loungewear on the floor, three mirror selfies in different rooms), and a 4-image "infinite canvas" blonde-character set (red dress on a Dubai-skyline beach, a car street scene, a fairy-light mirror selfie, a cropped bathroom/vanity shot). [Trustpilot](https://www.trustpilot.com/review/eromify.com) (fetched, text only, no photos attached to any review) confirms R1's finding: "image looks generated by AI and there is no consistency in face," "Images look very AI-generated!" alongside a couple of 4-star counter-reviews citing "high-quality results."

- **Non-AI realism: 3/5.** The vendor demo images are noticeably better than the Trustpilot text complaints imply — reasonably photographic skin texture, plausible phone-camera-selfie aesthetic, decent scene variety. But this is Eromify's own best-case marketing built to sell a new feature, and it directly contradicts real paying-customer complaints in text; there's no way to visually verify what an actual customer got.
- **Identity consistency: conflicting evidence, not confidently scored.** The vendor's own 8-image "Lily" demo shows plausible consistency; an actual Trustpilot reviewer explicitly complains "no consistency in face." These two sources disagree and there is no independent image to arbitrate.
- **Confidence: Low.** Vendor material and real customer sentiment are in direct tension — this tension is itself the most useful finding here.
- **Sample bias:** Heaviest vendor/reality gap of any stack surveyed — a polished marketing demo sits directly next to organic complaints saying the opposite.

**SaaS-cluster bottom line (per the research agent that ran all four):** ranked by what could actually be seen — **Higgsfield > Eromify's-vendor-demo ≈ ZenCreator > Glambase** — but confidence is medium-at-best across the board since organic/independent visual evidence was categorically unreachable this pass.

---

## 5. ComfyUI + Flux.1-dev + character LoRA

**Evidence viewed (all CivitAI model-page showcases, creator-curated, live-browsed):**
- [UltraRealistic Lora Project (Danrisi/FortranUA)](https://civitai.com/models/796382/ultrarealistic-lora-project) — 391K generations, "Overwhelmingly Positive" (3,143 reviews). Trigger words are literally "amateurish photo, low lighting, overexposed, GoPro lens" — engineered specifically to defeat the smooth "AI look." [Image 38865933](https://civitai.com/images/38865933): dark-haired woman with a handwritten "the most realistic LORA" sign — convincing amateur-flash aesthetic, visible skin grain, hands mostly anatomically sound (5 fingers, plausible bend) though the creator's own changelog admits ongoing anatomy issues. [Image 38271655](https://civitai.com/images/38271655), a car dashboard, shows garbled pseudo-text on button labels — a classic diffusion text-rendering weakness. **A user comment on this model explicitly reads "I can't make consistent models with the same face using this LoRA"** — it is a general realism/style LoRA, not a single-identity one, so it doesn't answer the consistency question on its own.
- [Chinese Girl Flux 1.d Lora (tagged CHARACTER)](https://civitai.com/models/715558/chinese-girl-flux-1d-lora-or-natural-realistic-photography) — [image 27491503](https://civitai.com/images/27491503) (red turtleneck, studio backdrop) and [image 27491573](https://civitai.com/images/27491573) (cream sweater, different pose): **identical bob haircut, eye shape, eyebrow, lip shape, skin tone across both** — solid identity-hold evidence, though skin reads smooth/editorial-retouched rather than raw-camera texture.
- One initially-selected Flux character LoRA ("Woman877 AI Influencer") redirected to a mature-content-gated mirror and was skipped without viewing, per content policy.

- **Non-AI realism: 4/5.** The amateur-style/realism LoRA is genuinely convincing when combined with the right trigger words; the glamour-style character LoRA trends toward an "influencer filter" smoothness rather than raw photo grain.
- **Identity consistency: 4/5** (based on the 2-image Chinese Girl character-LoRA set). Confidence caveat: identity-hold is highly LoRA/prompt-dependent — the far more popular general-realism LoRA explicitly does *not* hold a single face, so realism and consistency in this stack come from two different kinds of LoRA that would need to be stacked/combined in practice.
- **Confidence: Medium** on both scores — small n (2–8 images per model), all creator-curated CivitAI showcases, zero independent Reddit remix evidence found (Reddit was unreachable this pass).

---

## 6. ComfyUI + SDXL RealVisXL / Juggernaut XL + character LoRA

**Evidence viewed (CivitAI, creator-curated, live-browsed):**
- [Juggernaut Cinematic XL LoRA v2](https://civitai.com/models/120663/juggernaut-cinematic-xl-lora) — a general cinematic-style LoRA, not single-identity. [Image 1844260](https://civitai.com/images/1844260): man in sci-fi armor, strong bokeh, visible beard/pore texture, good catchlights — polished, borderline "movie poster." [Image 1844267](https://civitai.com/images/1844267): redhead woman in a lantern-lit street — heavy cinematic grading, natural-looking skin under warm light.
- [Spanish AI Influencer – Woman992 (tagged CHARACTER, SDXL)](https://civitai.com/models/1762264/spanish-ai-influencer-woman992-photorealistic-character-lora-sdxl) — [image 112833506](https://civitai.com/images/112833506): full-body studio shot, gray sweatsuit. [Image 112833040](https://civitai.com/images/112833040): same woman walking a Mediterranean street reading a book — dappled natural sunlight, believable shadows, but garbled pseudo-text carved into the pavement (same text-rendering weakness seen in the Flux stack). Same hair/build/skin tone across both shots, though faces are medium-distance in both so fine-feature confirmation is limited. **Caveat: could not confirm both gallery images were generated on the SDXL tab specifically** vs. the model's newer Z-Image-Turbo tab, which the page defaulted to.

- **Non-AI realism: 4/5.** Confidence **medium**.
- **Identity consistency: 3.5/5.** Confidence **low-medium** — only 2 images, neither a tight face close-up, and the base-model tab used for the samples is unconfirmed.

---

## 7. PuLID

**Evidence viewed (GitHub official repo assets — author-curated):**
- [ToTheBeginning/PuLID README grid](https://github.com/ToTheBeginning/PuLID) ("pulid_flux_results" image) — two reference identities (one woman, one man) each rendered across 5+ very different prompts/styles (sign-holding photo, candlelit portrait, blue top, cyberpunk-goggles illustration, oil painting, pencil sketch). **Facial identity clearly holds across all the photoreal renders for both people** — this is the authors' own proof of PuLID's core claim.
- [cubiq/PuLID_ComfyUI](https://github.com/cubiq/PuLID_ComfyUI) SDXL-port basic-workflow example: a Mona Lisa painting used as reference → a photoreal young woman with purple-streaked hair in an urban hoodie scene. Demonstrates identity transfer even from a non-photo reference; texture reads soft/SDXL-typical rather than richly detailed.

- **Non-AI realism: 3/5.** The photoreal renders look reasonably natural but soft, roughly matching R1's "lower skin-texture" claim from third-party comparisons. Confidence **low** — thumbnails inside a composite grid are too small for fine pore/hand inspection, and no hands are visible in any of the sampled crops.
- **Identity consistency: 4/5.** Confidence **medium** — directly visible and consistent with reputation, but it is the authors' own cherry-picked demo, not independent evidence.

---

## 8. InstantID

**Evidence viewed (GitHub official repo assets — author-curated):**
- [instantX-research/InstantID compare-a.png](https://github.com/instantX-research/InstantID/blob/main/assets/compare-a.png) — comparison grid vs. IPA / IPA-FaceID / IPA-FaceID-Plus / PhotoMaker across five art styles (line art, faded film, watercolor, oil painting, ink painting) for 5 reference people. The "faded film" row is closest to photoreal — InstantID's output looks smooth/soft-focus, matching its "polished" reputation from R1.
- [applications.png](https://github.com/instantX-research/InstantID/blob/main/assets/applications.png) — composite panel including a "Realistic Synthesis" section (most relevant): the same 2 reference faces rendered across ~5 photoreal variations each, identity clearly preserved (same facial structure/eye shape held), skin reads smooth/airbrushed with soft studio bokeh.

- **Non-AI realism: 3/5.** Confirms R1's "polished/plastic at high identity-strength" claim from direct viewing. Confidence **low-medium** — tiny thumbnails inside an official composite grid, no hands visible anywhere in the reachable samples, so hand-integrity is untested for this stack.
- **Identity consistency: 4/5.** Confidence **medium** — the official demo directly shows the claimed identity-hold, but it is author-curated.

**Open-source cluster bottom line:** every data point above is creator- or author-curated (CivitAI model-page showcase or official GitHub comparison asset). **Zero independently-verified third-party remix posts were found for any of the four open-source approaches** — Reddit blocked direct browsing and returned nothing via web search. A stack-agnostic, unprompted artifact worth flagging separately from face/skin scoring: garbled pseudo-text (gibberish button labels, gibberish pavement lettering) showed up in both the Flux and SDXL samples.

---

## 9. Known operator accounts (documented real-world stacks, multi-post evidence)

All evidence below comes from downloaded press-CDN images (BoredPanda, SuperCarBlondie, VirtualHumans.org, OdditiCentral, Cut The SaaS, Fortune, TotalProSports) viewed directly as files, since live Instagram/TikTok navigation was not used (see operational note at top). This is one hop more indirect than scrolling a live grid, but every image was actually viewed pixel-by-pixel, not inferred from text.

### Milla Sofia (Stable Diffusion + custom models, publicly disclosed by creator)
6 stills + 1 music-video thumbnail viewed: construction-hat/sunflower-field portrait pair, white-bra-top selfie in a field, brown bikini against snow-capped mountains, green bikini under palm trees, white lingerie top in Santorini, hot-pink bikini on a boat at sunset, plus the "Where I Begin" music-video stage still.
- **Realism: 3/5.** Clean, well-lit faces, but skin — especially chest/shoulders in bikini shots — has a distinct waxy/airbrushed sheen reading as "AI gloss" rather than phone-camera skin. Backgrounds are impressive but slightly "postcard-generic."
- **Identity consistency: 4/5.** Same blonde/blue-eyed face shape and nose across all 6 stills and the music-video still — no visible drift, though the sample doesn't span much time.
- **Confidence: Medium** (press-embedded only, single article, no direct account browsing).
- **Video:** Has an ongoing, real music career — released tracks "Where I Begin" and "What You Broke," uses Hedra AI for lipsync animation; the video thumbnail alone looks convincing (natural hand-on-mic pose, stage bokeh) but full-video frames were not sampled.

### Aitana López (agency "The Clueless," Barcelona — Stable-Diffusion-adjacent tooling per R4, exact stack undisclosed by agency)
2 images viewed across 2 eras: a 2023 pink-hair studio portrait and a gym mirror-selfie (likely more recent, per media-ID inference).
- **Realism: 4/5.** The most convincing set surveyed among operator accounts — the studio shot shows real skin texture (not glassy), matching the creators' stated intent of deliberately avoiding "impeccable" skin; the gym selfie has a believable phone-camera mirror-reflection look with real gym clutter and a city skyline through windows.
- **Identity consistency: 4/5** across the two time periods — same face structure, same pink-hair motif, no drift detected (though the phone partially obscures the face in the newer shot).
- **Confidence: Low-medium** — only 2 images total, from 2 different articles, not a scrolled grid.

### Emily Pellegrini (stack not publicly named, Fanvue-monetized per R4)
8 images viewed, all from a single Nov-2023 article: Dubai/Burj Khalifa rooftop in a black dress, a Venice street in a sports bra, a hotel lobby in a white blazer, a gym/bedroom-adjacent mirror selfie in a black sports bra, a Santorini clifftop in an olive dress, a night fountain portrait in white, and a Chichén Itzá selfie in a white cover-up.
- **Realism: 4/5.** The best "phone-photo" illusion found in this entire audit — genuine variety of real-world backdrops (Burj Khalifa, a Venetian alley, Mayan ruins with actual passersby in frame), natural-looking hand poses (hand on head, hands clasped), skin has some grain rather than pure gloss. Minor tell: slightly too-perfect eyebrow/lip symmetry.
- **Identity consistency: 5/5** across all 8 images/7 distinct settings — same face (thick brows, brown eyes, similar nose/lip shape) holds rock-solid.
- **Confidence: Medium** — strong sample size (8 images) but all from one article/time window (Nov 2023); no later (2025/26) comparison shot was findable to check multi-year drift. Two "later" images the source article had appended were, on inspection, an unrelated commenter's real selfie, not Emily — correctly excluded rather than mis-scored.

### Lil Miquela (Brud/Dapper Labs, CGI-render pipeline, not diffusion-photoreal)
4 images spanning 2018→2024: a dated real Instagram-post screenshot (10 July 2018, standing with three real humans in-frame), a 2024 editorial close-up, a 2024 studio fashion pose, plus a case-study cover graphic.
- **Realism: 2/5 in 2018, ~3.5/5 by 2024.** The 2018 post is unambiguously CGI/3D-rendered next to real humans — stylized, doll-like proportions, no camera grain. The 2024 images are a large step up (visible freckles, more natural skin shading) but still read as a high-end 3D render rather than a photo — eyes and hairline have CGI evenness. **This is the key counter-example/upper-bound data point: even the longest-running, best-funded operation in the space still reads as CGI, not photoreal, when a mismatched-technique pipeline is used.**
- **Identity consistency: 4/5** — distinctive bob-with-bangs and facial structure holds across 2018→2024, i.e. she reads as "the same character" even as render fidelity visibly improved — a rare, directly-documented long-lifespan technique-drift example.
- **Confidence: Medium** — the 2018 image is a genuine dated screenshot; the 2024 images are press-sourced, uncertain whether straight Instagram posts or campaign-only assets.

### Hailey Lopez (Stable Diffusion per R4, solo/anonymous creator)
Weakest evidence in this audit: 1 confirmed image (a beach close-up selfie, plausible skin/composition) plus 1 possibly-related collage image that could not be confirmed as the same account.
- **Realism: 3/5** (single-image judgment only).
- **Identity consistency: not assessable** — no second dated image of the same confirmed account was obtainable; her handle could not be reliably pinned down among several similarly-named accounts.
- **Confidence: Low.** Treated honestly as an unresolved gap rather than forced.

**Operator-account cluster bottom line:** Emily Pellegrini and Aitana López are the strongest "indistinguishable from phone-photo influencer" evidence found anywhere in this audit — deliberately imperfect skin texture plus varied real-world backdrops carry it. Milla Sofia shows the most "AI gloss" tell of the photoreal group. Miquela is the clearest counter-example, proving pipeline choice (CGI vs. diffusion-photoreal) matters more than production maturity/budget. Hailey Lopez is an honest gap, not a negative finding.

---

## Scorecard summary

| Stack | Realism (1-5) | Consistency (1-5) | Confidence | Evidence type |
|---|---|---|---|---|
| Higgsfield Soul ID | 4 | 4 | Medium | Vendor showcase only |
| ZenCreator | 3 | insufficient evidence | Low | Vendor (3 images total exist) |
| Glambase | 2.5 | not scored (gated) | Low-medium | Vendor public feed |
| Eromify | 3 (vendor) / conflicting w/ real complaints | conflicting, not scored | Low | Vendor demo vs. real Trustpilot text |
| ComfyUI + Flux.1-dev + character LoRA | 4 | 4 | Medium | CivitAI creator showcase |
| ComfyUI + SDXL RealVisXL/Juggernaut + LoRA | 4 | 3.5 | Low-medium | CivitAI creator showcase |
| PuLID | 3 | 4 | Low / Medium | GitHub author demo |
| InstantID | 3 | 4 | Low-medium / Medium | GitHub author demo |
| Milla Sofia (operator, SD-based) | 3 | 4 | Medium | Press-embedded real posts |
| Aitana López (operator, SD-adjacent) | 4 | 4 | Low-medium | Press-embedded real posts |
| Emily Pellegrini (operator, stack undisclosed) | 4 | 5 | Medium | Press-embedded real posts |
| Lil Miquela (operator, CGI pipeline) | 2 → 3.5 | 4 | Medium | Real + press-embedded posts |
| Hailey Lopez (operator, SD-based) | 3 | not assessable | Low | Single image |

---

## Ranking: which stack's real outputs best match "indistinguishable-from-phone-photo influencer content"

1. **Emily Pellegrini's actual deployed output** is the single best real-world proof point in this entire audit (realism 4, consistency 5, medium confidence, 8 real images across 7 settings). **Aitana López** is a close second. Neither, however, gives figment a directly reproducible recipe — the agency behind Aitana doesn't publicly name its exact stack, and Emily Pellegrini's tooling is entirely undisclosed. These prove the bar is achievable with *some* diffusion pipeline, not which one to copy.
2. Among stacks figment could actually **adopt and reproduce**, **ComfyUI + Flux.1-dev + character LoRA** and **Higgsfield Soul ID** are effectively tied at the top of the visual evidence (both 4/4, both medium confidence) — Flux+LoRA edges it on principle (fully self-hosted, no external content filter to fight, verified via independent-style CivitAI showcases even though not literally independent authors) while Higgsfield edges it on ease of getting there (turnkey, one clean multi-style consistency demo) but rests entirely on vendor-selected material with zero third-party corroboration found.
3. **ComfyUI + SDXL RealVisXL/Juggernaut + character LoRA** is a solid third (4/3.5), slightly behind Flux on consistency evidence quality (smaller, less certain sample).
4. **PuLID and InstantID** are best understood as *consistency-injection techniques* rather than full realism stacks — both hold identity well (4/5) in author-curated demos but trend toward a softer/more "polished" look (3/5 realism) that would likely need pairing with a strong photoreal base model + post-processing to hit the target register.
5. **Eromify, ZenCreator, Glambase** rank lowest on available evidence — Eromify's vendor demo vs. real customer complaints directly contradict each other, ZenCreator has almost no visual evidence to judge at all, and Glambase's own public-feed images are the most consistently glossy/plastic of anything viewed.
6. **Lil Miquela** is not a candidate stack but a useful cautionary data point: a CGI-render pipeline reads as CGI even after 6+ years of iteration and hundreds of millions in backing — reinforcing that photoreal diffusion (Flux/SDXL-family), not stylized 3D rendering, is the right technical direction for figment's stated goal.

## Evidence gaps that only a hands-on trial can close

- **No independently-posted (non-vendor, non-author) evidence exists for any candidate stack in this audit.** Reddit, X, Trustpilot review photos, and YouTube reviewer footage were all unreachable this pass (bot walls, login walls, 403s). Every score above is therefore a best-case/curated-case estimate, not a median-case one. This is the single largest gap — a real trial run (generating our own batch and grading it blind) is the only way to know true expected quality rather than cherry-picked quality.
- **Hand/finger integrity is essentially untested** across most stacks — CivitAI and GitHub demo thumbnails rarely show hands in frame at viewable resolution. This is a classic diffusion weak point and needs direct testing, not inference from face-focused showcase images.
- **Content-filter behavior at the swimwear/lingerie register is unverified in practice** for every SaaS tool — R1 already flagged that Higgsfield's own troubleshooting docs list swimwear as a common NSFW false-positive trigger, and Glambase gates its own galleries behind an 18+ wall that this pass correctly declined to cross. Only a live trial generation at the target register will show which tools actually pass or block it.
- **Multi-month/multi-year identity drift is unmeasured for every reproducible stack** (Flux LoRA, SDXL LoRA, PuLID, InstantID) — all CivitAI/GitHub evidence is a snapshot from one model version at one point in time. Only Milla Sofia, Aitana, and Miquela show any real time-spread, and none of those map to a documented, reproducible technical stack. A real trial would need to generate a character across many sessions/weeks to see if a LoRA or Soul ID identity holds as prompts, poses, and possibly base-model versions change.
- **Text/sign rendering artifacts (garbled pseudo-text) appeared unprompted in both Flux and SDXL samples** — worth a explicit pass/fail check in any hands-on trial for scenes with visible signage, labels, or lettering, since this is an "AI tell" independent of face/skin quality.
- **Video quality is essentially unassessed** across the whole audit — only Milla Sofia's music-video thumbnail was viewed (not full frames), and none of the open-source or other SaaS stacks were checked for video output at all. If figment's roadmap includes video, this needs its own dedicated hands-on pass.
- **Eromify's vendor-demo-vs-real-complaint contradiction is unresolved** — worth a direct $6–48 credit-pack trial to settle cheaply, since the disagreement between marketing and paying customers is stark and directly relevant if Eromify is ever considered.
