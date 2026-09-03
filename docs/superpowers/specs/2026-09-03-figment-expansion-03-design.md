# figment expansion-03 — anchor-variation design (creator-001, klein 4B Base)

**v1, 2026-09-03**, branch `claude/figment`. Replaces expansion-02's free-generation method with an
anchor-anchored one. Binds under `orgs/figment/pipeline/GUARDRAILS.md`; obeys `CLAUDE.md`,
`governance/risk-tiers.md`. Deliverable graph: `orgs/figment/pipeline/expand/workflows/klein4b_anchor_variation_api.json`.

## 0. Why expansion-02 failed, and what the package actually does

| | expansion-02 (rejected) | expansion-03 (this design) |
|---|---|---|
| canvas | `EmptyFlux2LatentImage` 1024×1280, denoise 1.0 | `VAEEncode(anchor)`, partial denoise 0.20–0.35 |
| identity path | 3 × `ReferenceLatent` only | anchor is BOTH the initial latent AND `ReferenceLatent` #1 |
| prompt | ~180-word scene paragraphs | ≤40-word template: identity clause + register + one variation |
| measured result | 60 cells, face-cosine median **0.68**, p25 0.51, min **0.09**, 26.8% ≥0.75; operator "90% wrong" | acceptance gate at ≥0.75 per cell vs its OWN anchor |

Distribution above computed from `personas/creator-001/batches/expansion-02/scores.json` (56 of 60 cells
had a detectable face; DINOv2 cohesion median 0.711).

**Correction to the brief's premise — read before reviewing the graph.** The package's dataset generators
are *two-stage*, and the low denoise is not where identity comes from:

| module | stage 1 (identity) | stage 2 (the low-denoise pass) |
|---|---|---|
| 04 (`10sorlabs_dataset_generator.json`, nodes 5→6→10→21) | `TextEncodeQwenImageEditPlus` with the reference photo in `image1`, empty latent sized from `GetImageSize`, **denoise 1.0**, Qwen-Image-Edit + 4-step Lightning LoRA | Z-Image Turbo re-render of stage 1's output, generic prompt, **denoise 0.28** |
| 10 (`..._v2.json`, nodes 836→679→698→174→646 and 837→678→676→672) | `TextEncodeQwenImageEditPlus` on a `FaceBoundingBox` crop, `ClownsharKSampler_Beta`, **denoise 1.0** | zit-upscale → `VAEEncode` → klein 9B `KSampler` steps 4 / cfg 1 / euler / beta, **denoise 0.23** |

So `denoise 0.23` is a *finish pass over a generated frame*, not a small edit of the reference photo; and
both `ReferenceLatent` nodes in module 10 (789, 777) have an unconnected `latent` input — vestigial. This
design is therefore **not a port**: it fuses module 04's angle-template + identity-lock grammar with klein
4B Base's own reference path, and puts the anchor on the canvas as well. Module 10's clothing-removal
branch is out of bounds (GUARDRAIL #3) and is neither ported nor quoted.

## 1. The graph — `klein4b_anchor_variation_api.json`

Chain: `LoadImage ×3 → ImageScaleToTotalPixels(1.0 MP, resolution_steps 16) → VAEEncode ×3 → ReferenceLatent
×3 (pos) / ×3 (neg) → CFGGuider(cfg 4.0) → Flux2Scheduler(50, w/h from GetImageSize) →
SplitSigmasDenoise(denoise) → low_sigmas → SamplerCustomAdvanced(latent_image = anchor VAEEncode) →
VAEDecode → SaveImage`.

### 1a. Diff against the verified `train/workflows/klein4b_multiref_api.json`

| node | change | reason |
|---|---|---|
| `21` | `EmptyFlux2LatentImage` **removed**, replaced by `GetImageSize(["9",0])` | output size = the anchor's own 1 MP frame; no fixed 1024×1280 |
| `24` `Flux2Scheduler` | `width`/`height` now links `["21",0]`/`["21",1]`; `steps` stays **50** | schedule identical to the composite runs, only truncated |
| `29` `SplitSigmasDenoise` | **new**, `sigmas ← ["24",0]`, `denoise` widget | see 1b |
| `26` `SamplerCustomAdvanced` | `sigmas ← ["29",1]` (low_sigmas), `latent_image ← ["12",0]` | partial denoise from the anchor latent |
| `9`/`10`/`11` | `resolution_steps` 1 → **16** | `VAEEncode` crops to the VAE downscale ratio; 16 keeps `GetImageSize` == the real latent |
| `6` | is now the **anchor slot** (canvas + reference #1); `7`/`8` are supporting refs | "reference order = canvas" (identity-spec §Composite findings) satisfied structurally, not by prompt |
| `4` | short template prompt | §2 |
| `5` | unchanged from `composite-02.yaml` (carries the underage + §4a families) | strongest negative already in evidence |

### 1b. Mechanism for partial denoise on klein Base (verified against ComfyUI v0.20.1 source)

`Flux2Scheduler` (`comfy_extras/nodes_flux.py:213`) takes **only** `steps`, `width`, `height` — **there is no
denoise input**, and `BasicScheduler` (which has one) cannot produce the flux2 resolution-shifted schedule.
The denoise equivalent is `SplitSigmasDenoise` (`nodes_custom_sampler.py:226`): `total_steps = round(steps *
denoise)`, output 0 = `high_sigmas`, **output 1 = `low_sigmas` = `sigmas[-(total_steps+1):]`**.
`SamplerCustomAdvanced` (`:948`) passes `latent_image` straight into `guider.sample(...)`, where the sampler
adds `noise * sigmas[0]` to it — the standard ComfyUI img2img path. Cross-checked against the official
template `image_flux2_klein_image_edit_4b_base.json`, which uses `ReferenceLatent + EmptyFlux2LatentImage` at
`Flux2Scheduler(steps 20)` / `CFGGuider(cfg 5)`; we keep our own measured cfg 4.0 and steps 50 so exactly one
variable changes versus the runs that held identity.

| denoise | effective steps of 50 | used for |
|---|---|---|
| 0.20 | 10 | small deviations (turn ±15°, gaze, expression) |
| 0.28 | 14 | medium (turn ±30°, lighting) |
| 0.35 | 18 | large (camera height, tight crop, wardrobe) |

### 1c. Harness contract

| requirement | satisfied by |
|---|---|
| `seed_fields: ["noise_seed"]` | node `22` `RandomNoise.noise_seed` |
| prompt substitution | node `4`, field `text` |
| denoise substitution | node `29`, field `denoise` |
| anchor / reference substitution | nodes `6`/`7`/`8`, field `image` |
| `uploads` | `{"files": ["_uploads/creator-001/g01.jpg", "…g02.jpg", "…g07.jpg"], "subfolder": "creator-001", "type": "input", "overwrite": true}` — identical to expansion-02 shard-01 |
| manifest envelope | copy `expansion-02-shard-01.yaml` wholesale; change `workflow`, `jobs`, `max_minutes` 82→60 |

Output size is the anchor's 1 MP frame: **g01 1392×752** (that anchor is landscape 1408×768), **g02 and g07
768×1376**. There is no `EmptyFlux2LatentImage` width/height left to keep in sync.

## 2. Variation grammar — 12 templates × 3 anchors = 36 cells

Every prompt is `<identity clause> <register clause> <variation clause> <capture clause>`, ≤40 words.

- identity + register (fixed, 18 words): *"The same woman as the reference, identical face. Winged black liner, defined lashes, glossy pink-nude lips, jet-black hair."*
- capture (fixed, 4 words): *"Candid phone photo, chest-up."* — on T11 only: *"Candid phone photo."*

| id | axis | variation clause | denoise |
|---|---|---|---|
| T01 | control | She faces the camera front-on, eyes on the lens. | 0.20 |
| T02 | turn −15° | Her head is turned fifteen degrees to her left, eyes still on the lens. | 0.20 |
| T03 | turn +15° / gaze | Her head is turned fifteen degrees to her right, looking slightly past the lens. | 0.20 |
| T04 | expression | Her mouth is relaxed and slightly open, eyes half-lidded, not performing. | 0.20 |
| T05 | expression | A small closed-mouth smile, eyes on the lens. | 0.20 |
| T06 | turn −30° | Her head is turned thirty degrees to her left, eyes still on the lens. | 0.28 |
| T07 | turn +30° | Her head is turned thirty degrees to her right, chin a little lower. | 0.28 |
| T08 | light | Late-afternoon light through one window, nothing else lit. | 0.28 |
| T09 | light | One lamp across the room; the far side of her face falls into shadow. | 0.28 |
| T10 | camera height | The phone is held just above eye level and she looks up into it. | 0.35 |
| T11 | crop | Tight head-and-shoulders crop, her head near the top edge. | 0.35 |
| T12 | wardrobe | per-anchor clothed family, below | 0.35 |

T12 clauses (three clothed families from `persona.yaml.grammar.wardrobe_families`, one per anchor):
g01 *"She is wearing a black ribbed cami and two thin silver chains."* · g02 *"She is wearing an oversized
cream knit cardigan over a plain top."* · g07 *"She is wearing a plain oversized grey tee."*

Excluded by design: profiles, over-shoulder and near-back views, and any new room — the anchor's composition
is frozen by the initial latent, so `persona.yaml.grammar.angles` entries `profile-l` and `near-back` are
**not traversed in expansion-03**. Framing variety comes from anchor variety, not from prompts.

Ids and seeds: cell `exp03-<anchor>-t<NN>`, output `c001-exp03-<anchor>-t<NN>`, seed `530000 + 1000·anchorIdx
+ templateIdx` (g01=0, g02=1, g07=2) — fixed per cell, per `persona.yaml.grammar.allocation.seed_policy`.

### 2a. Register conflict — recorded, not silently resolved

`look-spec-v2` **§4a bans** "winged eyeliner", "dramatic lashes", "glossy nude lip", "full lips".
`look-spec-v2` **§0 operator taste anchor (2026-09-03)** requires "sharp winged black liner, long defined
lashes, glossy pink-nude full lips … jet-black hair" and states "where §2 and this note disagree, this note
wins". `composite-02.yaml` already shipped `"winged black liner, glossy pink-nude lips, jet-black hair"` in a
run that held identity. **§0 wins for these four tokens only.** Every other §4a family (soft-glam,
bronzer/contour, plastic-skin, body, light, age) stays fully banned, and §4c's no-bare-numeral rule holds —
the adult read is inherited from the anchor plus node `5`'s negative, never asserted in the positive prompt.

## 3. Pilot — 6 cells, 1 pod, before the other 30

Widest deviations first, 2 per anchor, 2 per denoise rung, so a method failure shows in one shard.

| # | anchor | template | denoise | what it decides |
|---|---|---|---|---|
| P1 | g01 | T06 turn −30° | 0.20 | is 0.20 enough to move a head 30°? (floor probe) |
| P2 | g01 | T12 wardrobe | 0.35 | does a clothed-family swap survive at the top rung? |
| P3 | g02 | T07 turn +30° | 0.28 | the set's intended mid-rung setting on its widest pose |
| P4 | g02 | T11 tight crop | 0.35 | can the prompt change composition at all? (expected NO) |
| P5 | g07 | T10 camera height | 0.28 | perspective change without composition change |
| P6 | g07 | T06 turn −30° | 0.20 | replicate of P1 on a portrait anchor |

Shape: one manifest, 6 jobs (harness and ComfyUI cap at 10 outputs per pod; expansion-02 ran 6 × 10).
Cost model: expansion-02 measured **159 s/cell at 50 steps**; sampling is ~linear in effective steps, so
10/14/18 steps ≈ 32/45/57 s plus ~12 s fixed (four VAE encodes, decode, save) → **45 / 57 / 70 s per cell**,
mean ≈ 55 s. Pilot ≈ 6 min of sampling; the full 36 cells ≈ 33 min across 4 shards (10/10/10/6).
`max_minutes: 60`, `job_timeout_seconds: 360`, `readiness_timeout_seconds: 900`; envelope otherwise unchanged.

**Zero-cost calibration to run before the pilot.** `persona.yaml.identity.floor.anchor_cosine_p5` is
`uncalibrated`. Score each anchor against the other two with `identity_check.py` legacy mode
(`--anchor <g0X> --images <dir holding the other two> --out <dir>`): that yields the
same-woman-different-photo band for this exact metric on this exact person, at $0, and either confirms 0.75
or moves it before any pod spend.

## 4. Acceptance

| rule | value |
|---|---|
| primary gate | per-cell face cosine **≥ 0.75 against its OWN anchor** |
| operator gate | eye-gate on the grading board; the operator's verdict outranks the number in both directions |
| failure handling | a failing cell is **dropped, never repaired** (module 10 narration: "we're gonna remove that from the dataset") |
| pilot pass bar | ≥ 4 of 6 cells ≥ 0.75 **and** the operator reads all 6 as the same woman; otherwise stop and re-cut the ladder |
| duplicate guard | any accepted cell with pairwise DINOv2 cosine > 0.95 to another accepted cell is a duplicate; keep one |
| control cells | T01 × 3 are metrology only — excluded from the LoRA training set |

**Why 0.75.** Negative baseline: expansion-02's own distribution puts 0.75 at its **p75** — the threshold
admits roughly the top quarter of a run the operator called 90% wrong, so it is not a lax bar, and it sits
0.07 above that run's median and 0.24 above its p25. Positive baseline: **none exists numerically** —
`scores.json` is the only scoring artefact in the repo and composite-01/02/03 were never scored, so "the
composite runs held identity" is an operator eye-verdict, not a number. 0.75 is therefore a *provisional*
floor, to be replaced by the anchor-vs-anchor band from §3 and then written into `persona.yaml`'s
`anchor_cosine_p5` with a `calibration_set_sha`.

**Scoring defect that must be handled (blocking).** `identity_check.py` in `--persona/--batch` mode resolves
the anchor from `persona.identity.references[0]` — g01 — for **every** image; expansion-02's `scores.json`
records `"anchor": …/g01.jpg` for all 60 cells. "Cosine vs its OWN anchor" therefore cannot be produced by a
single `--persona/--batch` run. Do it as **three legacy-mode runs** over per-anchor image subdirectories
(`--anchor anchors/g0X.jpg --images <subset>`) and merge, or add a per-cell anchor to the raw-only path.
Until one of those exists, the acceptance criterion is not measurable.

## 5. What we adopt after this step, and what stays deferred

| adopted unchanged | source | note |
|---|---|---|
| Qwen3-VL descriptive auto-captions (`Qwen/Qwen3-VL-8B-Instruct`, float8, max res 512, 128 tokens) | module 11 | the operator retired single-word "woman" captions himself ("no longer necessary") |
| Ostris values: LoRA rank 32, LR 1e-4, 3000 steps, save every 250, buckets 512/768/1024, cache-text-embeddings ON, sampling disabled | module 11 | raise "max step saves to keep" to ≥ the number of checkpoints you intend to rank, before launch |
| dataset-tester ranking: N parallel branches, one fixed prompt + fixed seed + fixed sampler, checkpoint the only free variable | module 11 / r15 §3g | the strongest single idea in the package |
| curation as an explicit step; ≤10 outputs per pod | module 10 narration | already matches our shard size |
| "match the prompts to your input images" | module 10 narration | why §2's register clause is pinned to the anchors' actual makeup and hair |

| deferred | blocker |
|---|---|
| `ClownOptions_DetailBoost_Beta`, `ClownsharKSampler_Beta` (RES4LYF) | licence not established — r16 closes with RES4LYF recorded as an unanswered brief question |
| `FaceBoundingBox` + `FaceAnalysisModels` (insightface face-crop pack) | licence not established in r15/r16; deferring keeps `custom_nodes: []` and the pod dependency-free |
| `zit_upscaler`, `Qwen-Rapid-AIO-NSFW-v23`, klein 9B | out of stack (4B Base) and/or unlicensed |
| module 10's clothing-removal branch | GUARDRAIL #3 — operator-only; not ported, not quoted |

## 6. Open risks

| # | risk | evidence | mitigation |
|---|---|---|---|
| 1 | klein 4B **Base** may not be a competent img2img editor at 0.20–0.35. The package's 0.23 runs on klein **9B** and only as a finish pass over a Qwen-Image-Edit render; the official 4B Base edit template uses `ReferenceLatent` at full denoise, never a partial one. | §0, official template | the pilot is exactly this test; P1/P6 at 0.20 and P2/P4/P5 at 0.35 bracket it |
| 2 | Composition is frozen by the initial latent — T10/T11 (camera height, tight crop) may not move at any rung ≤0.35. | mechanism | both sit at 0.35 and are in the pilot; if they fail, framing comes from anchor variety plus a downstream crop, not from prompts |
| 3 | **Over-similar cells → LoRA overfit.** The package spreads ~30 images over 15 face-angle + 15 body-pose prompts including profiles, over-shoulder, low and high angles; we hold 36 cells within ±30° of three frames, 15 of them at denoise 0.20. | r15b module 10 | duplicate guard (§4), control cells excluded, DINOv2 cohesion tracked against expansion-02's 0.711 median as the spread reference |
| 4 | The 0.75 gate is provisional and the positive baseline does not exist as a number. | §4 | anchor-vs-anchor calibration first, at $0 |
| 5 | g01 is landscape 1408×768, so all 12 of its cells are landscape; the set's aspect spread is decided by the anchors. | measured | acceptable for 512/768/1024 bucket training, but flag to the operator before the run |
| 6 | Per-cell own-anchor scoring is not implemented. | §4 | blocking; three legacy-mode runs or a raw-only patch |
| 7 | `resolution_steps` 1→16 and cfg 4.0 vs the official template's 5 are two unforced differences from prior art. | §1a | both deliberate and recorded; only the latent path is meant to vary versus the composite runs |
