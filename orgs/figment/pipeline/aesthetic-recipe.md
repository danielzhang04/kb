# Aesthetic recipe — derived from research, model search, and controlled testing (2026-09-01)

Six casting rounds (personas/trial-02/candidates-v1 through v6) missed the target look using
the same method every time: write a longer text description, generate 8 women, miss. This
document is the result of doing it properly instead — studying the reference register
directly, searching for models that already encode it, and running controlled A/B tests
rather than guessing at prompt wording. Read this before starting any future round; it
exists so the same ground is never re-covered from scratch.

**Superseding note (2026-09-01, attribute-calibration study):** the prose prompt wording
below (heritage as a main-clause demographic noun, skin/makeup phrasing, hourglass clauses)
has been superseded by a reproducible single-variable grid study — see
`orgs/figment/pipeline/lever-table.md`. Headline result: putting the heritage noun in the
main clause causes a confirmed, reproducible wardrobe/scene cascade (3/3 seeds); moving it
to a trailing low-weight clause fixes it (not 100%, see the lever table's honest caveat).
Read the lever table before writing any new persona prompt — it also documents which skin/
makeup/body levers actually move the needle versus which don't (several don't).

## 1. The register spec (Phase 1 — derived from reference accounts)

Studied as a SET, read-only, low-volume, in the operator's own browser: `murayunaki`,
`wox4ever`, `yunareix`, `r.evrii`, `ellllybaby`, `shirleypunn`. `r.evrii` and `shirleypunn`
were previously documented in `personas/trial-02/candidates-v4/NOTES.md`; this pass
re-confirmed both and studied the other four fresh. Full per-account notes are in this
session's scratchpad; this section is the cross-set synthesis.

**Face shape — the most important finding.** All six accounts share a ROUND/SOFT face
shape. None read as hard-editorial (blade cheekbones, angular jaw) — not even `yunareix`,
whose makeup is the hardest of the six but whose underlying bone structure is still round.
**This means face SHAPE is not the axis that needs correcting.** The operator's "too hard
editorial" complaint is not about bone structure drifting sharp; it is almost certainly
about makeup intensity and skin finish (see below), which prompts alone have been pushing
too far toward "editorial" language (`striking editorial face, sharp cheekbones` appears
literally in the current `portrait_refined.json` / `fullbody_refined.json` template prompts
— this is a direct, fixable cause of the hard-editorial drift and should be removed).

**Skin.** Warm-to-tan finish on 4/6 accounts, cooler-fair on 2/6. Visible texture/pores at
close range on ALL SIX — none read as glass-skin/K-beauty-airbrushed. The "generically soft
East-Asian" failure mode is a pale, blurred, textureless skin finish — none of these six
accounts actually look like that.

**Makeup.** Spans a spectrum: bare-faced (`murayunaki`) → soft glam (`r.evrii`, `wox4ever`,
`shirleypunn`, `ellllybaby`) → defined/harder (`yunareix`). **The target sits in the
soft-glam middle**: visible but not heavy liner, glossy or soft-matte lip, bronzer/warmth on
the warmer accounts, full groomed brow (never thin-flat, which reads K-beauty-generic).

**Hair.** Predominantly dark. Balayage/money-piece highlighting over dark-brown-to-black is
the single most consistent "Asian-American vs Asian-domestic" marker (`wox4ever`,
`ellllybaby`, `shirleypunn`); flat jet-black is the cooler/moodier pole (`murayunaki`,
`r.evrii`, `yunareix`).

**Jewelry.** Delicate gold or silver, worn sparingly — pendant necklace, small hoops. Never
costume-heavy.

**Photography.** Universally phone-camera. Never studio strobe or seamless backdrop — this
means the current templates' negative-prompt line banning studio backdrops is correct and
should stay. Framing is close-to-mid distance (selfie arm's-length to half-body) far more
often than full-body across all six accounts — full-body shots are the rarer format in the
real reference material.

**Body (thinner evidence).** Slim-to-slender frame is the baseline across all six. Waist
definition/curve reads in seated or hip-cocked poses, not from an overtly
athletic/muscular build — none of the six show gym-toned muscularity. This argues the
"genuine waist-hip contrast" the operator wants should come from POSE and GARMENT FIT
(fitted/cinched waist, hip-cocked stance) more than from an exaggerated muscular hourglass,
and it argues AGAINST round 4's "Western fitness culture / gym-toned" hypothesis, which this
fresh evidence does not support.

**Wardrobe.** Fitted going-out or home-intimate registers — slip dresses, cami/bodysuits,
corset tops, crop tops, bikini/loungewear at home. Not activewear/gym-fit.

**Where the target sits on the operator's stated axis** (between generic-soft-East-Asian and
hard-editorial): round/soft face shape is CORRECT and shared by the whole reference set —
keep it. The miss is in (a) prompts that literally say "editorial," "sharp cheekbones" —
remove; (b) skin finish trending pale/glossy/blurred instead of warm-toned with visible
texture — needs a texture-restoring intervention (see LoRA below); (c) makeup dialed to
either bare or too-heavy instead of the soft-glam middle.

**Evidence honesty.** Well-grounded: hair/makeup/jewelry/photography/skin — directly
observed across 6 live profile grids in this pass. Thinner: body type as a type — full-body
shots are rare in the real reference content, so the body conclusion leans more on this
project's own prior rounds' negative results (see §4) and the operator's repeated verbal
complaint than on fresh visual evidence of full bodies in the wild.

## 2. Model search (Phase 2 — CivitAI / HuggingFace, SDXL-compatible, free/local)

No sub-agent chain reliably returned this phase's findings (one dispatched fork
sub-delegated to a further agent that never reported back — a process failure, noted here
so a future session doesn't repeat the same delegation pattern and lose the work again).
Redone directly. All figures below are as reported on each model's own CivitAI page at
search time; verify before download since ratings/download counts change.

**DOWNLOAD-ACCESS REALITY CHECK (tested, not assumed).** Most CivitAI assets below cannot
actually be fetched by an agent: the API returns `401 Unauthorized — "The creator of this
asset requires you to be logged in to download it"` for anonymous requests. Confirmed
login-gated: **Skin Realism (248951)**, **FameGrid (1368634)**, **Realism LoRA by Stable
Yogi (1100721)**. These are therefore NOT testable by an agent and are the operator's to
download with his own CivitAI account (already flagged as blocked-on-Daniel in RESUME.md).
Confirmed anonymously downloadable and pulled locally this session:
**Instagram Selfie SDXL (1001573)** → `models/loras/instagram_selfie_sdxl.safetensors`, and
**Juggernaut XL Ragnarok (133005)** → `models/checkpoints/juggernautXL_ragnarok.safetensors`.
HuggingFace assets download freely without login, which is why the real ControlNet (§3) was
obtainable where the CivitAI LoRAs were not — **prefer HuggingFace-hosted resources for
anything an agent must fetch unattended.**

### Aesthetic / skin candidates (highest priority)
1. **Skin Realism (Acne, Skin Details, Imperfections) SDXL** —
   civitai.com/models/248951 — SDXL 1.0 — CreativeML Open RAIL++-M — Overwhelmingly
   Positive, ~359K downloads, 1,146 reviews, actively used. Adds visible pores/texture,
   explicitly moves away from airbrushed skin. Recommended weight ~0.4-0.5 (avoid max
   strength, creator warns of distortion). **This is the single most directly relevant find
   for this project's specific complaint** (glossy/glass skin vs. the reference set's warm
   textured skin) and is the first thing to A/B test.
2. **FameGrid XL** — civitai.com/models/1368634 — SDXL — CreativeML Open RAIL++-M w/
   addendum — Very Positive, 22.6K downloads, 359 reviews, updated mid-2025. General
   Instagram-influencer-polish LoRA, not Asian-specific. CAUTION: its own showcase language
   ("polished, refined, clarity") risks reintroducing the gloss the operator dislikes — test
   at low weight (~0.3) as a styling nudge only, not full strength.
3. **Better Faces Cultures** — civitai.com/models/119376 — licence is FLUX.1-dev
   Non-Commercial for the current upload; page references older SDXL/Pony variants but the
   currently-listed file is Flux-first. LOWER CONFIDENCE — verify an actual SDXL file exists
   before use, and the non-commercial licence term matters if this project ever monetizes
   directly through image sales (it would not block Instagram posting, but flag it before
   any licensing-sensitive use).
4. **Instagram Baddie Babe** — civitai.com/models/1225440 — SDXL — licence/rating could not
   be confirmed this pass. Its own description ("high-glam, bold") skews toward the
   hard-editorial pole the operator has rejected — do not prioritize without a direct visual
   check of its gallery first.
5. **Gap, stated honestly**: no well-documented, actively-maintained SDXL-native
   "Asian-aesthetic face" LoRA matching this specific register (round/soft + warm skin +
   soft glam, not K-beauty, not editorial) was found. The handful of "Asian girl face" LoRAs
   surfaced by search are SD1.5, not SDXL-compatible, and out of scope for this checkpoint.
   **The register likely has to come from prompt language + Skin Realism + checkpoint
   choice, not from an ethnicity-specific face LoRA** — treat that as a standing fact, not a
   gap to keep re-searching for.

### Body-shape candidates
1. **Hourglass Body Shape by olaz** — civitai.com/models/129130 — has an SDXL v2 version
   (primary listed version is now FLUX.1) — Overwhelmingly Positive, 401.6K downloads, 926
   reviews. **Creator explicitly states "this version has no major impact on faces"** — the
   exact failure mode that killed both `bodyproportion.safetensors` and
   `contourluxe.safetensors` in round 6 (both degraded face/proportion quality at every
   weight tested). This is the highest-priority fresh, isolated body-LoRA test this project
   has not yet run. CAVEAT: the licence terms confirmed this pass (FLUX.1-dev
   Non-Commercial) were for the Flux release — verify the SDXL v2 file's own licence at
   download time, don't assume it inherits the Flux terms.
2. **Venus Body [Concept] SDXL** — civitai.com/models/159584 — v0.9 Alpha, trained on 1,052
   images, targets thick thighs/wide hips without exaggerating bust. Lower-confidence
   secondary candidate (alpha/unfinished) — test only if olaz's LoRA disappoints.
3. Everything else surfaced ("slim thick bimbo," "Thick Hourglass Body Shape [Illustrious],"
   assorted Pony/anime-ecosystem body sliders) is off-base-model (SD1.5/Illustrious/Pony,
   not photoreal SDXL) or explicitly bimbo/exaggerated-framed, which fights the brief's
   "genuine, not exaggerated" waist-hip contrast. Not worth testing.

### Alternative base checkpoints
1. **Juggernaut XL (latest: Ragnarok)** — civitai.com/models/133005 — CreativeML Open
   RAIL++-M w/ addendum (explicitly permits selling outputs) — Overwhelmingly Positive,
   8,499 reviews, 1.9M downloads, actively updated (July 2026). The single most validated
   alternative to RealVisXL found — worth a same-prompt/same-seed A/B.
2. **epiCRealism XL** — civitai.com/models/277058 — licence not directly confirmed this
   pass — widely cited in secondary sources as the best all-round SDXL photorealism
   checkpoint. Secondary, not primary.
3. **Honest counter-finding, important**: multiple secondary review sources independently
   rank **RealVisXL V5.0 as the strongest SDXL checkpoint specifically for face/pore detail
   in portraits** — better than Juggernaut on that specific axis. This tempers the
   dispatch brief's hypothesis that "RealVisXL may simply hold the wrong prior." **The base
   checkpoint is probably not the primary defect** — test Juggernaut anyway since it's free
   and well-supported, but don't expect a checkpoint swap alone to fix the register miss.
   The higher-leverage fix is the Skin Realism LoRA plus prompt-language changes (§1, §3).

## 3. The proportion defect (Phase 3 — confirmed mechanism and fix)

**Established facts going in** (not re-litigated): file dimensions are correct (generated
832×1216, upscaled 1.5× uniformly to 1248×1824, no stretching); portraits (no ControlNet)
are correctly proportioned; only ControlNet-guided full-bodies were reported distorted.

This section reflects two independent, parallel diagnostic passes run the same session
(one isolating IPAdapter as a variable, one isolating skeleton geometry and ControlNet
type) that converged on a single, coherent mechanism and a confirmed fix. Findings are
merged here rather than kept as two competing accounts.

### 3.1 Isolating the variables, one at a time

1. **ControlNet ON vs OFF**, same seed (424242), same short neutral prompt, same skeleton
   (`trial02_pose_standing.png`, T2I-Adapter strength 0.65): both correctly proportioned.
   Directly contradicts the leading hypothesis that the hand-drawn skeletons are inherently
   bad-ratio in a way that shows up unconditionally.
2. **Full production refine chain** (upscale → denoise-0.4 pass → FaceDetailer), same short
   prompt, ControlNet on: still correctly proportioned. Rules out the two-pass
   upscale/refine/FaceDetailer mechanism.
3. **The actual round-6 `person01` production prompt** (~350-word positive, 4 heavily
   weighted clauses, extracted verbatim from the delivered PNG's embedded workflow
   metadata), run with the SAME short-prompt-tested ControlNet setup, no IPAdapter: still
   correctly proportioned, full head-to-feet framing. This shows the giant prompt is not
   sufficient on its own to cause the defect either.
4. **Adding IPAdapter Plus-Face back in** (weight 0.65, `linear`, `start_at 0.0, end_at
   1.0`, referencing a face-only close-up crop) — everything else identical to test 3 —
   **reproduced the defect immediately**: head pushed to the top of frame, torso dominant,
   legs cut short by the frame edge, matching the delivered `person01_fullbody.png` almost
   exactly. This is the one variable that, added alone, flips a correctly-proportioned
   result into the complained-about one.
5. **Real joint geometry, measured rather than eyeballed.** Real keypoints were extracted
   (`OpenposePreprocessor` over a free-licence, fully-clothed, plain-background full-body
   studio photo — Pexels #6856000, Pexels License, saved as
   `ComfyUI/input/refphoto_studio_dress.jpg`) and compared numerically against the
   hand-drawn skeletons already in `ComfyUI/input/`. Real photo torso:leg ratio
   (neck→mid-hip vs mid-hip→ankle) = **1:1.48**. The hand-drawn `v6` skeleton ≈ **1:1.30** —
   measurably leg-short/torso-long relative to a real adult body. The skeletons are not
   innocent; they are quantifiably wrong. A corrected skeleton (`figment_pose_corrected_v1.png`)
   was built from the real measured geometry (arms re-posed to hang at the sides, uniformly
   rescaled, with headroom above the eye keypoints and floor allowance below the ankle
   keypoints — omitting either crops the render at the scalp or the calves).
6. **Corrected skeleton alone, same T2I-Adapter, same seed, IPAdapter present**: did NOT
   fix framing — came back a seated, thigh-cropped composition. **Correct joint geometry
   alone is not sufficient** while IPAdapter's compositional pull and a weak adapter are
   both still in play.
7. **Compression is stochastic, not deterministic**, once IPAdapter is in the graph: the
   same skeleton and strength produced acceptable framing on some seeds and badly
   compressed framing on others. A single-seed test is not evidence of absence for this
   defect — this is why item 3 alone (one seed, no IPAdapter) looked clean while production
   (many seeds, IPAdapter present) intermittently failed across rounds 4-6.

### 3.2 The mechanism

Two things compound, and either alone is close to survivable:

- **IPAdapter's face-reference conditioning bleeds composition, not just identity**, from
  the reference image into the generation. This is a documented IPAdapter behavior (its own
  `weight_type` options include `composition` and `style transfer` variants specifically
  because plain `linear` mode carries compositional bias by default). Round 6's face
  references are close-up bust shots; that framing pulls the full-body generation toward a
  tighter, closer camera distance than the prompt explicitly requests.
- **`t2i-adapter-openpose-sdxl-1.0` is a T2I-Adapter, not a true ControlNet** — a
  deliberately lightweight mechanism that *hints* at structure rather than enforcing it.
  It is too weak to override IPAdapter's compositional pull, which is why turning it off,
  correcting its skeleton's geometry, or raising its strength (see below) all failed to
  fix the framing on their own — a weak signal fighting a strong one loses regardless of
  how correct the weak signal's content is.
- Prompt length/weighting also plausibly matters at the margin (the production prompt
  stacks 3-4 heavily weighted `:1.2`-`:1.3` clauses, none of which is the framing
  instruction itself) but is a secondary contributor, not the dominant one — test 3 above
  shows the giant prompt alone, without IPAdapter, does not reproduce the defect.
- Raising T2I-Adapter strength to compensate makes things WORSE, not better: at strength
  1.0 (vs production's 0.7) compression got markedly worse (wider/shorter torso, stubbier
  arms) AND that run separately triggered the recurring silent-clothing-failure mode
  (rendered topless despite full-weight negative-prompt terms). **Raising ControlNet
  strength to fight compression is not a safe lever.**

### 3.3 The confirmed fix

Replace the T2I-Adapter with a real SDXL ControlNet — **xinsir/controlnet-openpose-sdxl-1.0**
(Apache-2.0 licence, ~110K downloads on HuggingFace, free anonymous download, 2.4 GB vs the
adapter's 302 MB) — at strength 0.8, paired with the geometry-corrected skeleton
(`figment_pose_corrected_v1.png`), with IPAdapter left at full strength (`start_at 0.0`, no
delay needed — a strong enough competing signal simply wins instead of needing to dodge the
timing window). **This replicated clean, correctly-proportioned, full head-to-feet framing
on 3 of 3 tested seeds**, including two seeds that had reliably produced the
seated/thigh-cropped failure under every other tested combination (T2I-Adapter with
RealVisXL, with Juggernaut, with a body LoRA, and with the corrected skeleton). A lighter
mitigation — delaying IPAdapter's onset (`start_at 0.3`, keeping the T2I-Adapter) — was
independently tested and also produced a correctly-proportioned result, confirming the
mechanism from a second angle, but costs some identity strength during the early
composition-defining steps since IPAdapter is silent then; **the xinsir swap is the
recommended fix** because it does not trade away identity hold. Caveat stated honestly: n=3
seeds for the xinsir fix, not exhaustive — treat as strong, not certain, and keep watching
for recurrence at scale.

**Practical note**: `comfyui_controlnet_aux` (Fannovel16) supplies both `OpenposePreprocessor`
and `DWPreprocessor` nodes for future skeleton extraction from real photos or the project's
own non-squashed renders — install it if a given ComfyUI instance doesn't already have it
(`git clone https://github.com/Fannovel16/comfyui_controlnet_aux` into `custom_nodes/`,
`pip install -r requirements.txt` with the ComfyUI server stopped since it locks `cv2.pyd`
while running, then restart).


## 4. Negative-results list (do not repeat these)

- **`bodyproportion.safetensors` / `contourluxe.safetensors`** (both in
  `ComfyUI/models/loras/`) — degrade face and proportion quality AT EVERY WEIGHT TESTED, not
  just when over-applied. Confirmed round 6. Not part of the working recipe; do not re-wire
  without a fresh, isolated A/B test against a specific better-documented alternative (see
  olaz's Hourglass Body Shape LoRA, §2, as that fresh test).
- **Literal "editorial" language in prompts** (`striking editorial face, sharp cheekbones`,
  present in the committed `portrait_refined.json`/`fullbody_refined.json` templates) —
  directly contradicts the Phase 1 finding that all six reference accounts share a
  round/soft face shape. This is a likely direct cause of the "hard editorial-model" miss
  the operator named three times. Remove from any template going forward.
- **Gym/athletic body-language prompting** ("Western fitness culture," "gym-toned,"
  "trained soft muscle tone") — round 4's hypothesis, not supported by this round's direct
  study of the reference accounts (none show gym-toned muscularity). Curve should come from
  pose + garment fit + prompt weighting, not an athletic-build descriptor.
- **Stacking 3+ heavily-weighted (`:1.2`-`:1.3`) clauses in one positive prompt** — see §3;
  plausible direct cause of the framing/proportion complaint. Keep positive prompts shorter
  and put the compositional instruction itself at high weight rather than adding more
  clauses on top.
- **Hand-drawn OpenPose skeletons based on guessed ratios** — not actually confirmed as the
  cause of the proportion complaint (see §3), but replaced anyway with real-geometry
  extraction since it is strictly better practice and was cheap to do.
- **Silent clothing-render failures on full-body ControlNet+IPAdapter generations** —
  recurred in rounds 4, 5, and 6 (bare-hips/garbled-cover-object; bikini/thong-reading
  underweight bodies; full topless) even with strong negative prompting. Every full-body
  output must be visually inspected before delivery — this is not solved by prompt wording
  alone and there is no evidence a stronger negative prompt alone will ever fully close it.

## 5. Winning recipe of record (as of this document)

- **Checkpoint**: RealVisXL_V5.0_fp16 (kept as baseline; Juggernaut XL Ragnarok tested as
  an alternative per §2, but evidence suggests the checkpoint is not the primary defect).
- **Face/skin LoRA**: Skin Realism SDXL (civitai.com/models/248951), weight ~0.4-0.5 —
  test first, directly targets the register's skin-finish gap.
- **Body**: no body-shape LoRA in the working recipe (both prior attempts failed). Curve
  comes from prompt weighting alone, per the v6 recipe's already-proven approach — plus,
  optionally, a fresh isolated test of olaz's Hourglass Body Shape SDXL LoRA (§2) since its
  "no major impact on faces" claim is untested by this project and directly answers the
  open question.
- **Identity hold**: IP-Adapter Plus-Face SDXL (`ip-adapter-plus-face_sdxl_vit-h.safetensors`)
  + CLIP-ViT-H, weight 0.65, portrait generated first then referenced into the full-body
  generation, `start_at 0.0` (full strength from the first step) — the v6 weight is
  unchanged, but see the pose line below: it now needs a real ControlNet to hold framing
  against this adapter's compositional bleed.
- **Pose — UPDATED, this is the confirmed fix, not the old T2I-Adapter setup**: swap
  `t2i-adapter-openpose-sdxl-1.0.safetensors` for a real ControlNet,
  `xinsir/controlnet-openpose-sdxl-1.0` (Apache-2.0, HuggingFace, anonymously
  downloadable), strength 0.8, with the real-geometry-extracted skeleton
  (`figment_pose_corrected_v1.png`, §3). This combination held correct head-to-feet
  proportions on 3/3 tested seeds, including two seeds that reliably failed under every
  T2I-Adapter variant tried (RealVisXL, Juggernaut, with/without a body LoRA, with/without
  the corrected skeleton). The T2I-Adapter is a lightweight "hint" mechanism, too weak to
  hold framing against IPAdapter's compositional pull — do not revert to it. If a real
  ControlNet is ever unavailable, a fallback mitigation (weaker, costs some identity
  strength) is delaying IPAdapter's onset: keep the T2I-Adapter but set IPAdapter
  `start_at 0.3` — independently tested and also produced correct proportions, confirming
  the mechanism from a second angle.
- **Prompt discipline**: remove "editorial"/"sharp cheekbones" language; keep the
  compositional/framing instruction short and itself weighted; do not stack more than
  ~2 heavily-weighted clauses in one positive prompt; keep the three proven
  content-ceiling enforcement clauses (closed neckline, opaque high-waisted bottom,
  standing-both-feet-planted) from the v6 recipe, since those demonstrably fixed real
  clothing-exposure failures across rounds 4-6.
- **Makeup/skin register**: soft-glam middle (visible but not heavy liner, glossy/soft-matte
  lip, full groomed brow, warm-toned skin with visible texture) — not bare, not
  heavily-contoured.
