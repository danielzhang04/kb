# R10 — Prior art on AI-influencer / consistent-character pipelines

Web research only (no image generation, no GPU), read-only browsing, human pace. Compiled
2026-09-01 across four parallel research passes: (A) published build workflows + casting/
face-lock methods, (B) prompt-lever taxonomies for photoreal humans, (C) ComfyUI consistent-
character repos + identity tech beyond IP-Adapter + regional prompting + LoRA sliders, (D)
community discourse on aesthetic-register steering + A/B methodology. Boundaries respected:
no real-named-individual likeness material sought, nothing explicit, no bot-wall workarounds
(several blocks hit and recorded as "evidence unavailable" rather than bypassed — see Section 4).

This document reads against `orgs/figment/pipeline/aesthetic-recipe.md` (already-established
findings from rounds 1-7) and does not re-derive what that document already closed: face shape
(round/soft, correct), the IPAdapter/ControlNet proportion bug (solved via xinsir ControlNet
swap), or the basic recipe of record. It focuses on what those seven rounds have not yet tried:
systematic attribute-level control, better casting methodology, and identity-tech alternatives.

---

## 1. Methods and tools worth adopting, ranked

### Rank 1 — Adopt now: API-driven grid-search testing (replaces ad hoc "generate 8, eyeball")

Source: followfoxai.substack.com, "Mass Produce XY Plots with ComfyUI API" (primary, fetched
directly). What it is: export your working ComfyUI graph via dev-mode "Save (API Format)" to
JSON, define a parameter matrix in a spreadsheet (prompt term, LoRA, weight — one column per
axis), export to CSV, run a Python loop that fires one ComfyUI API request per row. Their
worked example queued roughly 4,000 images (45 prompts x 15 LoRA versions x 6 weights)
unattended. A companion post covers the same pattern against the A1111 API.

Why rank 1: this is the single most directly actionable finding across all four research
passes, and it exists because of a confirmed gap — native ComfyUI has no first-class XYZ-Plot
equivalent (confirmed via a GitHub maintainer discussion, comfyanonymous/ComfyUI discussion
#3907 — sparse thread, 2 comments, the only concrete answer was "use SwarmUI instead," which
confirms the gap rather than closing it inside plain ComfyUI). Every prior round of this
project has been "generate N, eyeball, guess at the responsible term" — this is a documented,
reproducible replacement, directly compatible with the existing ComfyUI stack, requiring no
new install beyond a Python script and a spreadsheet. See Section 2 for a concrete study built
on this method. Secondary tool options if the from-scratch script is more setup than wanted:
third-party ComfyUI grid nodes exist (psdwizzard/Comfyui-XYZ-stitch, Nolasaurus/ComfyUI-nodes-
xyz_plot, hnmr293/ComfyUI-nodes-hnmr) — not independently verified by direct fetch, treat as a
faster-but-less-controlled fallback.

### Rank 2 — Adopt now: prefer part-specific/direct-adjective prompt terms over archetype or demographic nouns

Source: dav.one, "Using prompts to modify face and body in Stable Diffusion XL" (primary,
fetched directly — the single most useful prompt-engineering source found in this research).
Finding, quoted/paraphrased: profession/archetype words ("bodybuilder") and demographic or
nationality nouns ("Japanese") reliably cause a cascade effect — they shift the intended
attribute AND drag in unrelated wardrobe and background changes the operator didn't ask for.
Part-specific and direct-adjective terms ("long legs," "oval face shape," "muscular arms")
change the intended attribute in isolation, without the cascade. Unnatural color words can also
misfire into object interference (a hair-color term pulling in a literal fruit prop).

Why rank 2, and why this matters specifically for this project: this is a plausible direct
mechanism for exactly the failure this project keeps hitting. Every persona prompt in the v6
recipe encodes heritage as a demographic noun ("Korean-American," "Vietnamese-American," etc.)
sitting in the same clause as face/skin/style language — per this finding, that noun is not
attribute-isolated and is a candidate cause of unwanted co-drift toward stereotyped/generic
"Asian" output whenever it fires strongly. The actionable fix: decouple the aesthetic register
from the heritage noun — specify heritage via neutral phenotypic descriptors (skin undertone,
eye shape, hair texture) and keep the demographic noun light or absent, then separately and
explicitly pin wardrobe/scene so they can't drift. This is a hypothesis worth testing directly
(see Section 2, axis C) before being treated as fact — dav.one's own findings are self-
described as "qualitative observations, no systematic A/B" — but it is the most concrete,
falsifiable lead in the whole research pass and costs nothing to test.

### Rank 3 — Adopt for the casting stage: DINOv2-embed to cluster to cohesion-select loop

Source: "The Chosen One: Consistent Characters in Text-to-Image Diffusion Models" (arXiv
2311.10093, SIGGRAPH-track, primary, fetched and read directly). Method: generate N candidates
from one prompt across seeds, embed each with DINOv2 (tested against DINOv1 and CLIP; DINOv2
won), run K-Means++ clustering on the embeddings, compute per-cluster cohesion (mean squared
distance to centroid) and discard undersized clusters, select the most cohesive surviving
cluster as "this is the character," train (textual inversion + LoRA) on that cluster, then
repeat with the updated model until convergence. Built on SDXL. The paper itself is CC BY-NC-
ND (no code repo confirmed reachable this pass — the algorithm is reimplementable regardless
since DINOv2 embeddings and K-means are both freely available and simple to run).

Companion tool: FaceScore (arXiv 2406.17100, OPPO-Mente-Lab, code at github.com/OPPO-Mente-
Lab/FaceScore, primary, fetched and read). A learned face-quality scorer (fine-tuned
ImageReward via auto-generated ranking pairs, no human annotation needed), 81.15% agreement
with human preference versus 75.32% for the next-best baseline tested, confirmed tested on
SDXL. Scores face quality and deformity — complementary to the clustering step above, not a
substitute: use it as a cheap first-pass filter to kill malformed candidates before either a
human or the clustering step sees them.

Judgment: this is the actual, principled answer to "is there a better casting method than
generate-N-and-eyeball" — confirmed by a second source (mythicalai Substack, 2023, primary,
fetched) that manual eyeballing really is the documented community default, meaning this
represents a genuine step up, not reinventing an already-standard practice. Recommend
prototyping the DINOv2-cluster step specifically for future casting rounds once this round's
immediate aesthetic-register problem is settled — it is a process improvement, not a fix for
the current miss, so it should not block the current work.

### Rank 4 — Adopt selectively: mask-based skin/makeup separation over attention-coupling

Source: multiple ComfyUI custom-node repos, cross-checked (PM_FaceSkin inside ComfyUI-Portrait-
Maker; Impact-Pack's RegionalPrompt; Inspire-Pack's RegionalPromptColorMask) plus a concrete
applied workflow, myaiforce.com "fix-plastic-skin" (primary, fetched). Why not attention-
coupling instead: the entire Attention-Couple family (Danand/ComfyUI-ComfyCouple and forks —
verified via direct GitHub fetch, 97 stars, GPL-3.0) is built and documented for separate
subjects side by side in one scene, and the ecosystem's own documentation states regions
"bleed into each other" when they overlap or touch — which describes a single face's sub-
regions (skin vs. makeup vs. the rest of the face) exactly. This is a structural mismatch, not
a maturity problem, so raising Attention-Couple's weight or picking a better fork will not fix
it.

The more promising path found: PM_FaceSkin generates a skin-only mask with blurred edges
specifically for makeup-transfer/skin-retouching use, feeding a masked inpaint/regional-prompt
pass (Impact-Pack RegionalPrompt) rather than an attention-level conditioning trick. The
myaiforce workflow demonstrates the applied pattern concretely: generate, then a smooth pass,
then a separate ControlNet-guided texture-detail pass, then a mask-based detail transfer back
onto the clean generation (preserving eyes/mouth from the clean pass, reinjecting texture
everywhere else). SD1.5-era in that specific writeup and gatekept behind a paid community for
the full graph, but the technique itself (separately process a texture pass, transfer it back
in via mask rather than fighting the base generation with more prompt weight) is directly
portable to SDXL and answers this project's stated skin-finish problem more surgically than
either prompt language or a flat LoRA weight can. Worth a scoped prototype if Skin Realism
LoRA at 0.4-0.5 (already in the recipe) doesn't fully close the texture gap.

### Rank 5 — Know about, do not adopt yet: PhotoMaker v2 as an editability-preserving identity method

Five face-identity technologies beyond IP-Adapter were checked (PuLID, InstantID, PhotoMaker
v1/v2, ConsistentID, InfiniteYou — all primary GitHub fetches). Comparison:

| Method | Base model | Licence | ID-lock strength | Editability after lock | Adoption verdict |
|---|---|---|---|---|---|
| IP-Adapter (current baseline) | SDXL | Apache-2.0 | Moderate | Good | Keep — known-working |
| PuLID | SDXL / Flux | Apache-2.0 | High | Documented poor ("generally lack editability") | Do not adopt |
| InstantID | SDXL only | Apache-2.0 | High | Reduced vs IPAdapter per multiple sources | Do not adopt |
| PhotoMaker v2 | SDXL | Apache-2.0 | Moderate-high, tunable "style strength" dial | Explicitly designed to preserve editability | Candidate, untested |
| ConsistentID | SD1.5 mature / SDXL (Dec 2024, newer) | MIT | High, claims fine-grained attribute editing | Claimed, not benchmarked | Promising, unverified |
| InfiniteYou | Flux only | Apache-2.0 code / CC BY-NC 4.0 model | Very high | Two fixed variants | Not usable — wrong base model, non-commercial licence |

PuLID and InstantID are both in maintainer-declared maintenance-only mode since April 2025
(same maintainer, cubiq, for both ComfyUI ports) — even setting the editability finding aside,
treat any bug hit in either as unlikely to be fixed upstream.

The editability finding is the one worth internalizing: multiple independent sources converge
that PuLID/InstantID's harder identity lock comes at the direct cost of the exact thing this
project needs (freedom to vary makeup/skin/body on top of a locked face) — "current ID
customization methods generally prioritize character consistency, overlooking editability."
This is a caution against reaching for a "stronger" identity-lock tool as a fix for anything —
stronger identity lock and freer attribute control are in tension, not aligned, per the
published record. Recommendation: do not switch off IP-Adapter. It is already the better
choice on the axis that matters here. PhotoMaker v2's built-in style-strength dial is worth a
future isolated test only if IP-Adapter's identity hold ever becomes the limiting factor, not
before.

### Rank 6 — Do not adopt without independent testing: CivitAI slider LoRAs

Concept Sliders (rohitgandikota/sliders, MIT, SDXL-native training scripts, ECCV 2024 —
primary, fetched) is a real, peer-reviewed, different training methodology (learns an
attribute direction from paired data or text, rather than an ordinary contrastive LoRA
finetune) with genuine SDXL support. Most Civitai "slider" LoRAs (age sliders, body-weight
sliders, etc.) are not built this way — they share only the naming convention and a "-N to +N"
UX. No primary evidence was retrievable (Civitai model pages were login-walled for every fetch
attempted) that any of them behave better than the two body-shape LoRAs this project already
rejected for degrading face quality at every weight. Every model card's own "no degradation"
claim is exactly what a marketing blurb would say regardless of truth. Blunt judgment: treat
Civitai slider LoRAs as no better than already-rejected evidence until independently tested
against this project's own face-quality bar. If a slider mechanism is wanted, training one via
the Concept Sliders codebase is the more credible path, though it is a real engineering
investment, not a download.

### Not adopted, with reasoning

- ChilloutMix + `ulzzang-6500` embedding (secondhand-verified as the 2023-era community default
  recipe for "photo-quality Asian female," explicitly built "to create K-pop girls," per
  multiple independent model-hub descriptions): not a tool to adopt — the opposite. This is
  flagged as the likely causal origin of the exact failure mode being fought (generic-soft-
  East-Asian/K-natural). Worth a direct check: confirm nothing in this project's current
  checkpoint/LoRA lineage traces back to ChilloutMix or ulzzang-derived training data, since
  that lineage would explain a structural pull toward the wrong pole regardless of prompt-
  wording fixes.
- Open-source "AI-influencer pipeline" GitHub repos (SamurAIGPT/AI-Influencer-Generator,
  verified: MIT, 302 stars, only 15 commits, no casting logic at all — "consistency" means "use
  similar prompts"; several other repos found were lower-signal hobbyist scripts, one candidly
  self-described in its own README as built "to attract male followers on Instagram"): none
  solve any open problem this project has — not worth adopting as scaffolding.
- Attention-coupling / GLIGEN for per-attribute facial control: structurally mismatched to a
  single face's overlapping sub-regions, per its own community's documented limitations — see
  Rank 4 for the better-matched alternative.

---

## 2. Proposed attribute-calibration study

Goal: replace guess-and-eyeball prompt tuning with the followfoxai-style API grid method
(Section 1 Rank 1), producing a reusable lever table instead of another round of impressionistic
notes. This section is deliverable, not just direction — it can be handed to whoever builds
the study.

### 2.1 Attributes to test, and why each is in scope

| Axis | Why it's in scope | What "done" looks like |
|---|---|---|
| A. Skin finish | Named as the leading suspected cause of the "generic soft" pole (aesthetic-recipe.md); Skin Realism LoRA is in the recipe untested at multiple weights | A weight/term to visible-texture-level mapping, at minimum "still glossy / correct / over-blemished" |
| B. Makeup intensity | Named as the leading suspected cause of the "hard editorial" pole | A term to position-on-spectrum mapping (bare / soft-glam / hard-defined) |
| C. Heritage/register wording | Tests the dav.one cascade hypothesis (Section 1 Rank 2) directly — does swapping a demographic noun for phenotypic descriptors reduce unwanted wardrobe/scene drift and register drift | Confirms or falsifies the cascade hypothesis for this specific pipeline, with example images as evidence either way |
| D. Waist/curve definition | Two body-shape LoRAs already rejected; recipe currently relies on prompt weighting plus pose/garment alone, per aesthetic-recipe.md Section 1 | Confirms whether prompt-weighting-alone is sufficient across a range of outfits, or needs a supplementary lever |
| E. Hair styling | Balayage vs. flat identified as the clearest Asian-American-vs-domestic marker; lower priority since already fairly well understood | Confirms the marker holds under this pipeline's specific checkpoint/LoRA stack |
| F. Prompt-weight ceiling | aesthetic-recipe.md Section 3 already found that stacking 3+ heavily-weighted clauses is implicated in the (separate) proportion defect; worth confirming it does not also degrade attribute fidelity | A "how many 1.2-plus-weighted clauses before quality/attribute-fidelity degrades" threshold specific to this pipeline |

### 2.2 Candidate terms per axis (starting set — expand after round 1 results)

- A. Skin finish: (i) baseline recipe prompt, no skin LoRA; (ii) plus Skin Realism LoRA at
  weights 0.3 / 0.4 / 0.5 / 0.6 (bracketing the model author's own recommended 0.4-0.5, per
  aesthetic-recipe.md Section 2 and the model's own trigger phrase "detailed natural skin and
  blemishes without-makeup and acne"); (iii) prompt-only terms with no LoRA, for comparison:
  "visible pores, subtle skin texture, matte-warm skin, natural skin texture" versus "glossy
  dewy skin, radiant glass skin" (the pole to avoid) — this isolates whether prompt language
  alone moves the needle at all versus needing the LoRA, per the finding that prompt terms are
  "necessary but weak," needing LoRA reinforcement to beat base-model smoothing bias.
- B. Makeup intensity: "bare-faced, no makeup, minimal makeup" / "soft glam makeup, defined
  liner, glossy or soft-matte lip, groomed full brow" (the target middle, per aesthetic-recipe
  Section 1) / "full glam, bold contour, matte lip, sharp winged liner" (the pole to avoid) —
  three discrete rungs, not a continuous slider, since makeup is inherently more categorical
  than continuous in how these models render it.
- C. Heritage/register wording (the cascade-hypothesis test): (i) current recipe form,
  demographic noun in the main clause ("Korean-American woman..."); (ii) demographic noun
  moved to a low-weight trailing clause with phenotypic descriptors doing the main work ("warm-
  toned skin, monolid eyes, straight dark hair..., (Korean-American heritage:0.8)"); (iii)
  phenotypic descriptors only, no demographic noun at all. Hold wardrobe and scene prompt
  language byte-for-byte identical across all three variants — any wardrobe/scene drift
  observed between (i) and (iii) is direct evidence for or against the cascade hypothesis.
- D. Waist/curve: (i) current recipe's two stacked weighted hourglass clauses, unchanged; (ii)
  the same clauses split across two different garment fits (fitted vs. looser) per the existing
  observation in NOTES.md that curve reads stronger in jeans-based than trouser-based outfits —
  this axis is more "confirm an existing observation systematically" than "discover something
  new." Do NOT include a body-shape or slider LoRA in this axis without a prior isolated face-
  quality check per Section 1 Rank 6 — do not fold an unverified LoRA into a multi-axis grid
  where a face-quality drop could get misattributed to a different axis.
- E. Hair: balayage-over-dark-brown vs. flat jet-black vs. balayage-over-black, three terms,
  low priority — run this axis last, or fold into whichever grid row is already producing an
  accepted image, since aesthetic-recipe.md already treats this as fairly settled.
- F. Weight ceiling: fixed prompt content, vary only the number of 1.2-or-higher weighted
  clauses stacked (0, 1, 2, 3, 4) at fixed seed — this is a structural test, not a content test.

### 2.3 Grid structure, for attributability

- One axis varied per grid run. Never vary two axes in the same batch — this is the discipline
  the field's own literature confirms almost nobody actually follows (no source found had run
  true single-variable grids; the "single-variable teaches you what each token does" advice
  was found only as an aggregator paraphrase, unverified against its original page). This
  project can do what the published record apparently does not.
- Fix 3 seeds per axis (not 1) and run every term-variant across all 3 fixed seeds. This
  directly answers the stochasticity concern already raised in aesthetic-recipe.md Section 3.1
  item 7 ("compression is stochastic, not deterministic... a single-seed test is not evidence
  of absence") — that finding was about the proportion defect but the same caution applies to
  any attribute claim. A term that looks decisive on one seed and washes out on the other two
  is noise, not a finding.
- Hold the full rest of the graph identical to the current recipe of record (checkpoint,
  IPAdapter weight/reference, ControlNet+skeleton, negative prompt, the three content-ceiling
  enforcement clauses) — changing anything outside the tested axis invalidates attribution.
- Build via the followfoxai method (Section 1 Rank 1): export the current working graph as
  API-format JSON once, drive a CSV of {axis, term/weight, seed} rows through a small Python
  loop, land outputs in a per-axis contact-sheet folder auto-labeled by term plus seed so
  visual review doesn't require re-deriving which image came from which cell.
- Visual QA per GUARDRAILS.md still applies to every generated image in the study — this does
  not relax the mandatory-inspection rule.

### 2.4 Recording findings as a reusable lever table

Store as `orgs/figment/pipeline/lever-table.md` (or `.csv` if preferred for future scripted
lookups), one row per {axis, term/LoRA+weight, seed} cell tested, columns:

`axis | term_or_lora | weight | seed | observed_attribute_result | cascade_side_effects | pass_fail_vs_target | contact_sheet_path | notes`

Two properties this table needs that a prose NOTES.md doesn't give you: (1) it should be
possible to look up "what happens if I add term X at weight Y" without re-reading a narrative
writeup, and (2) it should record combinations, not just single terms in isolation — per the
project's own key insight (the target is a set of valid combinations, not one ideal value per
axis). After the single-variable grids close out each axis independently, run a small
combination pass explicitly pairing rows that independently passed (e.g. one accepted skin
finding, one accepted makeup finding, and one accepted heritage-wording approach in the same
generation) to confirm they still hold together — single-axis findings do not automatically
compose, and this project's own history (the proportion defect only appeared when IPAdapter and
a weak ControlNet combined; neither alone caused it) is a direct precedent for combinations
misbehaving in ways single-axis tests can't catch.

---

## 3. Does anything suggest the current approach is fundamentally wrong?

No — the core architecture (SDXL + IPAdapter for identity + ControlNet for pose + LoRA
additions + prompt engineering) matches what the field's own most credible practitioners and
published tools use; nothing found argues for a different base architecture. What the research
does suggest needs to change, not because the architecture is wrong but because the method of
finding settings within it has been under-rigorous compared to what's actually achievable:

1. Guess-and-eyeball prompt tuning has a documented, practical replacement (Section 1 Rank 1)
   and this project has not used it. Every round so far has been closer to the field's own
   confirmed default (manual generate-and-pick) than to its best-documented alternative
   (systematic API-driven grids). This is the highest-leverage single change available.
2. Treating "the target" as one ideal value per attribute, when the project's own stated
   insight is that it's a set of valid combinations, has no direct precedent in the published
   literature to copy — every prompt guide and every "AI-influencer build" writeup found treats
   each attribute as one descriptive string. OneActor's cluster-conditioned-guidance framing
   (arXiv 2404.10267, primary) is the closest academic validation that "represent a character
   as a cluster of acceptable appearances rather than a single point" is the right mental model
   — but it is a training-time research method, not a drop-in tool, so this project will likely
   need to build its own version of that idea (structured attribute-bundle presets, tested in
   combination per Section 2.4) rather than adopt an existing implementation. That's a genuine,
   unclaimed piece of methodology work, not a sign anything is broken.
3. The demographic-noun cascade hypothesis (Section 1 Rank 2) is the one lead that, if
   confirmed, would mean a structural prompt-writing habit across all eight v6 personas needs
   to change — not the pipeline architecture, but the convention of putting heritage nouns in
   the main descriptive clause. This is testable cheaply (Section 2.2 axis C) before committing
   to a rewrite.
4. One structural risk worth a direct check rather than a prompt fix: if any checkpoint or LoRA
   currently in the stack has ChilloutMix/`ulzzang`-family lineage, that would be a training-
   data-level pull toward the wrong pole that no amount of prompt-language correction would
   fully overcome — worth confirming RealVisXL_V5.0 and Juggernaut XL Ragnarok's own training
   lineage doesn't touch this family (not investigated this pass — flagged as a follow-up, see
   Section 4).

Nothing found argues for abandoning IP-Adapter, abandoning the ControlNet-based pose fix
already locked in, or switching base checkpoints as a fix for the aesthetic-register miss —
multiple independent sources (already noted in aesthetic-recipe.md Section 2) converge that
checkpoint choice is not the primary lever here, and this research did not surface anything to
contradict that.

---

## 4. Honest gaps — what could not be verified

- Reddit was categorically inaccessible this session. Both direct fetch (www.reddit.com,
  old.reddit.com) and web search failed to surface real thread content across roughly 14
  queries targeting r/StableDiffusion, r/comfyui, r/aiinfluencers, r/SDForAll — this is a real
  gap against the original brief's explicit ask for Reddit threads with real detail. Per
  GUARDRAILS.md this was recorded as evidence-unavailable rather than worked around (no login
  attempted, no bot-check bypass attempted).
- No source anywhere in roughly 50 total searches/fetches directly addresses how to steer
  toward a diaspora-specific aesthetic register (e.g. "Asian-American Instagram" as distinct
  from both "K-beauty" and "generic Western beauty standard") without stereotype/caricature
  risk. Two independent research passes searched for this directly and confirmed the absence
  rather than merely failing to find it. This appears to be genuinely undocumented in public
  practitioner literature (possibly addressed only in paywalled/gated creator content that
  could not be verified — several Gumroad prompt-pack listings surfaced repeatedly across
  passes but their contents are unconfirmable without purchase). Treat this project's own
  eventual findings here as original documentation, not a gap-fill of existing work.
- CivitAI model detail pages were frequently login-walled for the fetch tool, blocking
  independent verification of review/rating content for several models named in this report
  (Body Weight Slider PONY; the "Definitive Guide to High-Fidelity Character LoRA Training"
  article; others noted inline above). Ratings/download-count figures quoted from search
  snippets should be treated as secondhand, not independently confirmed.
- PuLID's and InstantID's comparative benchmark numbers (Face-Sim/CLIP-T/CLIP-I scores cited
  against IP-Adapter) were retrieved via aggregator summaries of the PuLID paper, not by
  independently reading the primary arXiv PDF (arxiv.org/abs/2404.16022) — confirm before
  citing these numbers as fact in any future decision document.
- Whether ConsistentID has a maintained ComfyUI-native node was not confirmed either way — only
  InstantID and PhotoMaker turned up ComfyUI ports in search results.
- No independent verification that ChilloutMix/`ulzzang` lineage exists (or doesn't) in any
  checkpoint currently in this project's stack — the causal-mechanism finding (Section 1, "not
  adopted" list) is high-confidence as a general community fact, but its applicability to this
  specific pipeline's specific checkpoints was not checked this pass.
- fofr/cog-consistent-character's internal identity mechanism (IPAdapter vs. InstantID vs.
  something else) could not be confirmed from its README — would need the repo's actual
  workflow_ui.json inspected directly to know what it does.
- One NBC News article and one MachineLearningMastery "same actress" technique claim, both
  surfaced via search snippets, could not be confirmed on full fetch (403 error and absent
  content respectively) — explicitly flagged inline above as unverified/false leads, not to be
  cited as fact.
