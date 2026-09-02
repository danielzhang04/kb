# Attribute-calibration lever table

API-driven single-variable grid study, per `orgs/figment/research/r10-prior-art.md` §2.
Local ComfyUI HTTP API (`http://127.0.0.1:8188`), RealVisXL_V5.0_fp16, RTX 4070 8GB, no
accounts, no spend. 3 fixed seeds (100001 / 200002 / 300003) per axis unless noted;
one axis varied per grid, everything else held byte-identical. Driver script and raw
prompts: `orgs/figment/pipeline/calibration-study/` (raw images per axis in `raw/`,
labeled contact sheets in `sheets/`, `raw/phase1_manifest.json` / `raw/COMBO/phase2_manifest.json`
record the exact prompt text and seed for every cell).

**Methodology deviation, stated up front:** the grid used a fast base-generation-only
graph (single KSampler pass + ControlNet for full-body, no second upscale/denoise pass,
no FaceDetailer) rather than the full `portrait_refined.json` / `fullbody_refined.json`
production chain, to keep the study bounded. Attribute presence and cascade effects are
visible at base resolution; the two final proof images (Section 6) use the identical
prompt cores but were still generated via this same base graph, matching the grid exactly
for a fair before/after read — a further pass through the full refine chain is a follow-up,
not part of this study's claim. No IP-Adapter identity lock is used anywhere in this study
(no face reference exists yet for this round); this is an attribute study, not a casting
round, so that is an intentional scope choice, not an oversight. **Skin Realism LoRA
remains untested** — still CivitAI login-gated, never downloaded (confirmed again this
session); the only locally-available skin-adjacent LoRA is Instagram Selfie SDXL.

---

## 1. Headline finding: the demographic-noun cascade effect — CONFIRMED

**Axis C** (contact sheet: `calibration-study/sheets/axis_C_sheet.jpg`), fullbody, wardrobe
clause held byte-identical across all 3 variants: `"...wearing a fitted olive-green sweater
and dark wide-leg jeans, delicate gold pendant necklace, standing in a plain sunlit
bedroom..."`

| variant | heritage wording | seeds | result |
|---|---|---|---|
| C1 (current recipe) | demographic noun in main clause: `"a 25 year old east asian american woman"` | 3/3 | Jeans rendered **olive/dark-green, color-matched to the sweater** — not the literally-specified dark denim — on **3 of 3** seeds. Scenes also skewed toward a brighter, more "catalog/editorial" bedroom (art prints, potted plants) consistently. |
| C2 | phenotypic descriptors as main clause, heritage moved to a trailing `(...:0.8)` clause | 3/3 | Jeans rendered as **correct dark blue denim** on 3/3 seeds. Scene mood shifted moodier/richer (deep jewel-tone walls). |
| C3 | phenotypic descriptors only, no demographic noun anywhere | 3/3 | Jeans rendered as **correct dark blue denim** on 3/3 seeds. Scene lighter/airier, neutral walls. |

**Verdict: confirmed, not just plausible.** The single wardrobe-color variable moved in
lockstep with heritage-noun placement across all 3 seeds in both directions — this is a
clean single-variable result, not seed noise. Putting the demographic noun in the main
clause measurably drags an unrelated wardrobe attribute (garment color) off its explicit
instruction; moving it to a trailing low-weight clause or dropping it for phenotypic
language removes that specific drag.

**Caveat found in the combination pass (Section 5):** the fix reduces but does not
*eliminate* the tendency — one of three COMBO-pass seeds (using the C2-style fix) still
produced a monochrome, matchy top+bottom outfit. Report this as a strong mitigation, not a
total cure — residual wardrobe-color drift should still be visually checked per generation.

**Recommendation:** adopt C2's pattern for all future persona prompts — phenotypic
descriptors (skin undertone, eye shape, hair texture) carry the main clause; the heritage/
demographic term moves to a trailing clause at reduced weight (`:0.8`) only if register
targeting still needs it explicitly.

---

## 2. Skin finish (Axis A)

Contact sheet: `sheets/axis_A_sheet.jpg`, portrait, 5 variants x 3 seeds.

| term | weight | result | side effects | verdict |
|---|---|---|---|---|
| baseline recipe wording (current) | — | Visible pores/natural texture already present by default on RealVisXL; not glossy. | none observed | **PASS — keep as-is** |
| `"visible pores, subtle skin texture, matte-warm skin, natural unretouched skin texture"` (texture-plus, prompt-only) | — | Marginally more matte than baseline; hard to distinguish at a glance across 3/3 seeds. | none observed | Weak positive, optional insurance |
| `"glossy dewy skin, radiant glass skin, luminous poreless skin"` (glossy pole, prompt-only) | — | **Did not reliably produce glass/poreless skin** — texture stayed close to baseline on most seeds. | none | Confirms r10's caution: prompt language alone is a **weak lever** for skin finish on this checkpoint, in both directions. |
| Instagram Selfie SDXL LoRA | 0.3 | Visibly smoother/softer skin, slightly fuller/glossier lips, softer brows — a step toward the gloss pole. | pushes toward the exact "generic-soft"/gloss failure mode the project is fighting | **NEGATIVE RESULT** |
| Instagram Selfie SDXL LoRA | 0.5 | Same direction, more pronounced — visibly less pore texture, more "retouched influencer" look. | same, stronger | **NEGATIVE RESULT, do not use for skin goals** |

**Recommendation:** keep the current baseline skin wording (no LoRA). Instagram Selfie
LoRA is not a skin-texture fix — it actively works against the register. Skin Realism LoRA
(the one purpose-built tool for this, per r10 §2 and aesthetic-recipe.md §2) is still
untested — this remains the single largest open gap in the recipe, blocked on Daniel's
CivitAI login.

---

## 3. Makeup intensity (Axis B)

Contact sheet: `sheets/axis_B_sheet.jpg`, portrait, 3 rungs x 3 seeds (soft-glam middle =
same cells as Axis A's baseline, reused).

| rung | seeds | result |
|---|---|---|
| bare-faced / no makeup | 3/3 | Clean, natural, no liner, natural lip — visibly and consistently distinct from the other two rungs. |
| soft-glam (current recipe) | 3/3 | Subtle liner, soft-matte/glossy lip, groomed full brow — sits correctly in the middle, as targeted. |
| full glam | 3/3 | Visible contour, winged liner (clearly winged on 1/3, present on 3/3), bolder lip, more polished brow. |

**Verdict: confirmed as a genuinely categorical/discrete axis, not continuous** — the three
rungs are visually distinct on every seed, no overlap. **Current recipe wording is correct;
no change needed.**

---

## 4. Waist/curve (Axis D) and weight ceiling (Axis F)

Contact sheets: `sheets/axis_D_sheet.jpg`, `sheets/axis_F_sheet.jpg`.

**Axis D** — same weighted hourglass clauses (`"(slim build with a defined waist and gentle
hip curve:1.2), (subtle hourglass silhouette:1.1)"`) tested against fitted vs. loose
garments, 3 seeds each:

| garment fit | seeds | result |
|---|---|---|
| fitted top + fitted jeans | 3/3 | Waist/hip curve clearly visible. |
| oversized sweater + wide-leg trousers | 3/3 | Curve essentially invisible — silhouette reads straight/boxy despite the identical weighted clause. |

**Verdict: confirmed — garment fit dominates over the prompt-weighted body-shape clause.**
The identical hourglass language produced curve or didn't purely as a function of wardrobe
fit. This matches the project's existing NOTES.md observation and extends it: the hourglass
clause is not harmful, but it is not sufficient on its own either — **fitted garments are
the primary lever, the weighted clause is optional reinforcement.**

**Axis F** — stacked count of `:1.2`-weighted clauses (0 to 4), single seed (100001),
structural test:

| clauses stacked | anatomy/proportion | styling side effects |
|---|---|---|
| 0 | correct | — |
| 1 | correct | top garment style shifted (crew-neck → zip top) |
| 2 | correct | pose/hand position shifted |
| 3 | correct | garment color shifted darker, pose shifted |
| 4 | correct | hair volume/texture shifted, garment style changed again |

**Verdict: no anatomical/proportion distortion up to 4 stacked `:1.2` clauses** at this
seed, in this graph (no IP-Adapter present) — the proportion defect documented in
`aesthetic-recipe.md` §3 was tied to IP-Adapter's compositional bleed, not to weighted-clause
count in general. **But** each added clause visibly nudged wardrobe/hair/pose details beyond
its literal semantic content — a second, milder cascade, distinct from the heritage-noun
cascade in Section 1. Caveat: single-seed test per the axis's own design (F is explicitly a
structural check, not an attribute-fidelity claim) — do not over-read into "4 clauses is
always safe."

---

## 5. Combination pass

Fullbody, 3 seeds, winning single-axis choices combined: heritage moved to trailing clause
(C2), texture-plus skin (A2), soft-glam makeup with an added explicit lip-color fix (new,
see below), fitted wardrobe + hourglass clauses (D1), one hair term folded in per seed
(Axis E, folded per r10's own instruction rather than given a dedicated grid). Contact
sheet: `sheets/axis_COMBO_sheet.jpg`.

**New finding surfaced only here:** full-body scene prompts default to **bold red
lipstick** regardless of makeup-intensity wording (visible across nearly every fullbody
cell in axes C/D/F) — portrait bust shots did not show this. Added an explicit
`"soft-matte nude-pink lip, no red lipstick"` clause for the combination pass; it worked on
3/3 combo seeds (no red lipstick recurred).

| seed | hair term | result |
|---|---|---|
| 100001 | balayage over dark brown | Correct dark denim jeans, visible waist curve, natural lip, good register match. |
| 200002 | flat jet-black | **Cascade residual**: top and trousers both rendered sage/olive — a matchy, monochrome outfit despite the C2-style heritage fix. Curve still visible, lip fix held. |
| 300003 | subtle balayage over black | Correct dark jeans, best overall register match, natural lip, curve visible. |

**Honest verdict on composition:** single-axis findings mostly held together — no
anatomical degradation, the lip fix generalized, the curve finding generalized — but the
heritage-cascade fix is a **strong mitigation, not a total fix** (1/3 seeds still drifted).
Single-axis findings do not automatically compose to 100%, confirming the study's own
starting premise.

---

## 6. Winning prompt core (recommended)

```
[fullbody framing prefix,] a 25 year old woman with warm-toned skin, monolid-leaning eyes,
straight dark hair, round soft face shape, soft contoured cheeks, full groomed natural
eyebrows, warm-toned skin, visible pores, subtle skin texture, matte-warm skin, natural
unretouched skin texture, soft glam makeup, subtle visible eyeliner not heavy, soft-matte
nude-pink lip, no red lipstick, balayage highlights over dark brown hair,
(slim build with a defined waist and gentle hip curve:1.2), (subtle hourglass silhouette:1.1),
[fitted wardrobe clause + content-ceiling clauses,] candid phone photograph, amateur
photography, unedited, film grain, adult woman in her mid-20s, [framing suffix,]
(east asian american heritage:0.8)
```

Held constant, not tested here (unchanged from the recipe of record):
RealVisXL_V5.0_fp16, xinsir ControlNet openpose 0.8 + `figment_pose_corrected_v1.png` for
full-body, negative prompt (plus the nudity-guard terms added for this study's fullbody
cells — recommend folding these into the committed negative prompt permanently, see
Section 7).

## 7. Proof images and honest assessment

`personas/trial-02/calibration-proof/proof_portrait.png` and `proof_fullbody.png`, seed
424242, generated from the winning prompt core above (exact prompts in
`proof_prompts.json` / `proof_prompts_fullbody.json` in that folder).

- **Portrait**: round/soft face, warm visible-texture skin, soft-glam makeup with a natural
  nude-pink lip (the lip fix held on an unseen seed), hair reads dark/uniform — the balayage
  term did not visibly manifest in this specific lighting. Reads candid and warm, not
  editorial, not glossy-generic, not campaign-produced. **This lands in the target register.**
- **Full body**: correct round/soft face and natural lip carried over; waist/hip curve
  visible via the fitted sweater; no anatomical distortion; fully clothed, no exposure
  failure (GUARDRAILS visual QA passed). **New residual miss**: "dark wide-leg jeans"
  rendered as **cream/khaki tailored trousers** — a wardrobe-fidelity failure, though
  notably *not* the same color-matches-the-sweater cascade from Section 1 (sweater is dark
  green, trousers are cream — different colors, not matched). This suggests wardrobe-color
  fidelity remains seed-dependent even after the heritage-cascade fix, and needs its own
  follow-up (try weighting the color term itself, or an explicit negative-prompt ban on
  cream/beige/khaki when denim is requested) — flagged honestly as unresolved, not
  papered over.
- **Which of the four failure poles, if any**: neither image reads as generic-soft-pale-
  East-Asian, hard-editorial, generic-Western-natural, or beauty-campaign-glossy. The
  portrait is a clean hit. The full-body is a hit on face/makeup/skin/curve with one
  distinct, newly-surfaced wardrobe-fidelity defect (not a repeat of the four named poles).

---

## 8. Negative-results list (do not repeat)

- Instagram Selfie SDXL LoRA at 0.3 or 0.5 for skin texture goals — pushes toward gloss/
  over-smoothing, the opposite of the target. (New this session.)
- Prompt-only "glossy dewy skin" language to deliberately test the failure pole — didn't even
  reliably produce the pole; the checkpoint's texture bias is stickier than pure prompt
  language can move in either direction. Confirms prompt terms are a weak lever for skin
  finish specifically (LoRA-level intervention is needed either direction) — this project
  still lacks a working LoRA for the "more texture" direction (Skin Realism remains
  login-gated).
- Loose/oversized garments plus a weighted hourglass clause, expecting the clause to carry
  curve on its own — it doesn't; garment fit dominates.
- Relying on makeup-intensity wording alone to control lip color in full-body prompts — it
  doesn't; full-body context defaults to red lipstick regardless, needs its own explicit
  clause.
- Treating the heritage-cascade fix (Section 1) as a complete cure — it is a strong,
  reproducible mitigation (2/3 → cleaner in the combination pass) but not 100%; still
  requires the mandatory per-image visual check already required by GUARDRAILS.
- Previously documented, reconfirmed no new evidence against: `bodyproportion.safetensors` /
  `contourluxe.safetensors` (still not used in this study), gym/athletic body-language
  prompting (not tested again, no reason found to revisit).

## 9. Open gaps for a future round

- Skin Realism LoRA still untested (CivitAI login-gated) — the single highest-value
  remaining unknown for the skin-finish axis.
- Wardrobe-color fidelity for specific fabric/color combinations (Section 7) needs its own
  small follow-up grid — this session found it seed-dependent, not solved by the
  heritage-cascade fix alone.
- Hair axis (balayage marker) was folded into the combination pass per r10's instruction
  rather than given a dedicated grid — it did not clearly manifest in the final proof
  portrait's lighting; worth a small dedicated 3-seed check if the balayage marker matters
  for a specific persona.

---

## Defect-fix round (2026-09-02) — recovered from disk after agent crash

The agent fixing these crashed on a network error while writing up findings, so this
section was reconstructed by the boss session from the workflow files and proof JSONs.
Settings below are verified from disk; the agent's own reasoning is lost.

### FIXED: full-body face rendering (was the blocking defect)

`proof_fullbody.png` in `calibration-proof/` had a mangled face; `calibration-proof-v2/`
renders it cleanly at the same framing. Verified working FaceDetailer config now in
`workflows/fullbody_refined.json`:

- detector `bbox/face_yolov8m.pt`
- `guide_size` 768, `guide_size_for` true, `max_size` 1024
- `denoise` 0.35 — low enough to refine without drifting facial geometry
- `bbox_crop_factor` 3.0, `bbox_dilation` 10, `feather` 8
- `force_inpaint` true, `noise_mask` true, `bbox_threshold` 0.5
- 20 steps, cfg 6.0, dpmpp_2m/karras

The likely operative change is the crop factor plus `force_inpaint` — a small face at
full-body framing needs enough surrounding context to re-render coherently, and must be
forced rather than skipped when detection confidence is marginal.

### FIXED: apparent age and squashed proportions (full-body)

Styling and wardrobe did the work, as predicted — fitted black tank, blue jeans, white
sneakers, apartment hallway reads early-twenties casual, where the prior cream wide-leg
trousers + dark sweater in a hotel-style bedroom read 30-something corporate. Proportions
in v2 are natural (leg length correct, no vertical compression).

### STILL OPEN (as of the crash) — both closed below, 2026-09-02

1. **Body shape.** v2 full-body is straight-slim with no waist-hip contrast. The
   slim-thick target remains unmet despite fitted garments, which the earlier study said
   were the primary curve lever. Needs its own investigation — garment fit alone is not
   sufficient.
2. **Portrait regressed on age.** `calibration-proof-v2/proof_portrait.png` reads late
   twenties and editorial/sophisticated (pearl earrings, styled bob), older than the
   v1 proof and well off the early-twenties target. Portrait and full-body prompts have
   diverged — they are no longer producing the same register, or the same woman.
3. **Wardrobe colour fidelity** — a specified garment colour still renders wrong on some
   seeds (`proof_fullbody_seedA_colorfidelity_miss.png` retained as the example).
4. Skin Realism LoRA still untested — CivitAI login-gated, needs Daniel.

---

## Defect-fix round 2 (2026-09-02) — items 1 and 2 above, both CLOSED

Full narrative and per-seed evidence in `personas/trial-02/calibration-proof-v3/NOTES.md`;
summarized here for the lever table's own record. Items 3 and 4 above are untouched by
this round (still open).

### FIXED: portrait/full-body divergence (item 2)

**Root cause, found by diffing the two v2 prompt JSONs directly**: the skin/makeup/hair/
age wording was already byte-identical between portrait and full-body — the divergence
was not a wording mismatch, it was an *absence*. The portrait prompt carried no wardrobe,
jewelry, or environment anchor at all, while the full-body prompt anchored hard on
casual-youth context (fitted tank, jeans, sneakers, gold pendant, sunlit apartment). An
ungrounded "close-up portrait, bust shot" instruction on this checkpoint defaults to a
studio beauty-editorial prior (grey seamless backdrop, styled blowout, pearl earrings,
dramatic side light) even with "editorial" already sitting in the negative prompt —
negative-prompt terms alone could not out-compete a missing positive anchor.

**Fix**: gave the portrait the same casual anchors as the full-body (black fitted tank
top, gold pendant necklace, blurred casual apartment hallway, "hair down and loose... not
salon-styled"), reduced the bust-shot framing clause from `:1.3` to `:1.1`, and added
negative terms for the specific failure observed (studio backdrop, pearl earrings, styled
blowout, beauty-campaign photography, "late twenties/thirties/mature woman"). Now baked
into the committed `workflows/portrait_refined.json`.

**Verified**: portrait and full-body now read as the same early-twenties woman in the
same casual register at two framings — the literal success test from the defect brief.
See `calibration-proof-v3/proof_portrait.png` vs `proof_fullbody.png`.

### FIXED: body shape / slim-thick (item 1) — the longest-running unsolved problem

**What finally moved it**: the **olaz Hourglass Body Shape SDXL LoRA**
(`civitai.com/models/129130`, SDXL v2 file, version id 911708) — confirmed **anonymously
downloadable** (a plain HTTPS GET 307-redirects to a signed download URL, no CivitAI
login), unlike every previously-tried CivitAI body/skin asset in this project (Skin
Realism, FameGrid, Stable Yogi Realism, all 401 for anonymous requests). At **strength
0.6**, model+clip, inserted right after the checkpoint loader (rewiring every downstream
node): genuine, moderate waist-hip contrast — narrower waist, fuller bust/hip line, still
reads slim rather than heavy or muscular — with **no visible face distortion or anatomy
defect**, unlike `bodyproportion.safetensors` / `contourluxe.safetensors`, which degraded
faces at every weight tested. This is the first body-shape lever in this project's history
that has actually worked cleanly.

**Reproducibility**: 3/3 tested seeds (the workflow's default 51005 family, 700001 — the
same seed as the v2 straight-slim baseline, enabling a clean before/after — and a fresh
900001 family) all showed genuine curve at 0.6. At **1.0** the effect is stronger but bust
size pushes toward the "exaggerated hourglass" pole the brief explicitly excludes — 0.6 is
the chosen production weight, not 1.0.

**Untested candidates, and why they weren't needed this round**: the brief's own top
hypothesis was pose/contrapposto (a hip-cocked stance) or camera-angle changes, on the
theory that the existing straight-on symmetric skeleton (`figment_pose_corrected_v1.png`,
unchanged by this fix) structurally can't show waist-hip contrast. The LoRA produced a
working fix without needing that — **pose was not tested this round because a fix was
found first**, not because it was tried and failed. If the LoRA's cascade side effect (see
next paragraph) ever needs correcting via pose instead, that investigation is still
available and this project already has a promising untested asset for it:
`ComfyUI/input/pose_fullbody_threequarter.png`, an existing (never-yet-tested-for-this)
skeleton with genuine shoulder/hip asymmetry and weight shifted onto one leg.

**Negative/honest caveat — a real cascade, not a clean isolated result**: on 2 of 3 tested
seeds, the LoRA also nudged the wardrobe from the prompt's literal "fitted white tank top"
toward a cropped/racerback style, and gave the hair more volume/wave than requested —
same *class* of effect as the heritage-noun cascade in Section 1 above (one lever change
dragging unrelated attributes with it). Stayed inside guardrails (crop tops already
whitelisted for this project, no exposure below the waistband, non-suggestive standing
pose) but is named honestly rather than hidden. A future round wanting a strictly
non-cropped top alongside this LoRA should expect to need to reinforce the wardrobe
clause, the same way the heritage-cascade fix needed reinforcement and still wasn't 100%.

**Now baked into the committed recipe**: both `workflows/fullbody_refined.json` and
`workflows/portrait_refined.json` carry a `LoraLoader` node
(`olaz_hourglass_v2_sdxl.safetensors`, strength 0.6/0.6) wired ahead of every downstream
model/clip consumer. It is included in the portrait workflow too for recipe parity even
though its effect is invisible on a bust-only framing.
