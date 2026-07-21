---
name: image-generation
description: >
  Generates ALL the verified, on-style images for a channel with a LOCKED style bible — the full
  visual production for a video (two passes: lock the video's recurring characters, then generate every
  scene), and one-off assets (characters, expressions, action poses, environments, props). Use whenever the
  user wants to generate the images/visuals/B-roll frames for a video, "do the image generation",
  build a video's asset library, run the visual production step after shots.json exists; OR wants a
  single asset — draw/generate/regenerate a character in a new expression, outfit, pose, or action;
  add a scene/environment/prop; iterate on an approved frame ("give me this one but ___"); extend the
  cast — for ANY channel whose visual-kit has a style-bible.md. Reads videos/<slug>/shots.json +
  visual-kit/style-bible.md + registry/registry.json + refs/; seeds every generation from the right
  canonical reference and VERIFIES every output against the bible in one batched review before shipping. Do NOT use
  it to plan the shots (visual-prompt-writer), design/lock a brand-new style from scratch (that's
  establishing the bible), write scripts, or assemble the final video (render-builder).
---

# image-generation

Turns a video's `shots.json` — or a one-off request — into **verified, on-model** PNGs, using the
channel's locked `style-bible.md` as the single source of law. The engine (`scripts/forge.py`) does the
mechanics; **you own the judgment**: derive the asset list, choose reuse-vs-generate, pick the technique
and seeds per scene, review every frame, and register/manifest only what passed. Accuracy comes from
**seed-from-reference + one batched review**, not one clever prompt.

**Engine reality:** Nano Banana is stochastic — expect 1–3 tries per image; the batched review is the
guarantee. Run scripts with native **`py -3`**.

**Log as you generate — files are the memory.** Every generation round records its reasoning beside its
outputs *while it runs*, never afterwards: what each file is, the seed(s) + mode + the delta used, why it
was chosen, and the verdict (shipped / flagged + reason / rejected). Always record **any ID needed to
recreate the pick** (the exact seed frame, the engine, a generated asset id) — a candidate you can't
regenerate is a dead end. The manifests below ARE that log — fill their `seed`, `technique`, and `notes`
fields for real rather than leaving them thin; an iterative round with no manifest (a one-off, a
candidate batch, library building) gets a **`<thing>-lab.md` beside the frames that appends per round**
(the `voice-lab.md` convention). Name every output descriptively (`macgregor--salute--smug.png`, never
`a3_v3.png`). A folder of PNGs with cryptic names and no notes is near-useless the moment the terminal
closes — the reasoning is unrecoverable, and ~20 undocumented candidate assets have been lost that way.

**Read the bible first, every session** (`<kit>/style-bible.md`): §2/§2b descriptors, §3 rig checklist,
§5 seed rules, §6 recipe, §7 library build spec, §8 protocols. Its spec values are the
human-editable source of truth — **never silently change one mid-run**; if a value looks wrong, surface
a proposed edit for approval and keep forging non-dependent assets.

## Mode selection

- **A video** ("generate the images for <slug>", a `shots.json` exists) → the **two-pass flow** below (preceded by **Pass 0** when `needed_assets` is non-empty).
- **A one-off** (new expression/pose/prop/cast member, "iterate on this frame", library building) →
  the **single-asset loop** at the bottom.

**The Pass-1 / Pass-2 split — the load-bearing rule.** Pass 1 locks *the video's recurring identifiable
people* — individual named CHARACTERS **and recurring identifiable GROUPS** (a specific named band/duo/
troupe that reappears across shots); each is a portable identity, so an isolated clean canonical is the
right anchor to seed from (a group's canonical is one frame of its members together). **Environments,
props, plates, and *anonymous* crowds are never pre-generated** — they are *composed inside their own
scene's gen* in Pass 2 (an environment is not portable; an anonymous crowd is different faces each time,
a composition, not a recurring identity, so its drift is invisible — both fight a pre-baked frame). Held sets continue across shots by
seeding each frame off the prior frame (technique (e)), never by a shared plate.

---

## Pass 0 — library coverage (the human gate is upstream, in VPW)

Before locking characters, ensure the pose/expression library covers this video. Read `needed_assets` from
`shots.json`. Each entry (`kind` ∈ pose | expression | interaction) has already passed the **human gate in
VPW** (approved, not vetoed — a vetoed one was restaged and is gone), and its `wants` says what to draw. For each:
1. Generate it **on the base** via the single-asset loop (`--mode new_character`/`identity` seeded off the
   template base), `2:3`. A `pose` asset shows the base figure in that gesture with clean four-digit hands; an
   `expression` asset shows the base face; an `interaction` asset shows TWO base figures in the interaction
   (both on the rig, correct hands) — same generation, just two figures.
2. **Human rig-gates** the generated frames (a base pose/expression is a channel asset — §10 approval).
3. `register` the approved frame into the registry (its `tag` = the `slug` VPW named). Now `pose_ref`/
   `expression_ref` resolves.
If `needed_assets` is empty, skip Pass 0. **Never** generate a pose ad-hoc inside a scene — poses come only
from the registry (bible §5/§7).

## Pass 1 — the character lock

Materialize each recurring **individual character or identifiable group** ONCE, verify it, then seed every appearance from it.
Output: `videos/<slug>/assets/library/` + `manifest.json`.

1. **Derive the character table from `cast`.** Read every shot's **`cast`** array (the authoritative figure
   list) across `long_form.shots`, shorts, and the thumbnail; per character record its registry name, the shot
   IDs it appears in, and the distinct `pose_ref`/`expression_ref` frames it uses (Pass 2 seeds those frames
   directly into each scene gen — there is no separate posed-character build).
   `script.md` is context only.
   - **Individual named characters AND recurring identifiable groups earn a library slot** — even
     single-shot individuals (a named character free-drawn inside a scene falls off the rig, so it needs a
     canonical seed regardless of count). A **recurring identifiable group** (a specific named band/duo/
     troupe appearing across shots) is a character whose canonical is a **group frame** — its N members
     together in their matching outfits; it locks IDENTITY (member count, matching costume, look, rig) and
     is seeded into every appearance so the group stays consistent. A group uses **no** `pose_ref`/
     `expression_ref` (those are single-figure) → it seeds its group canonical directly; its per-shot staging
     (performing / lined up / atop the pile) is composed in the Pass-2 scene gen off that seed. **If a
     member ever acts alone** in a hero shot, promote *that member* to an individual character (the normal
     path); don't force per-member identity on the ensemble otherwise.
   - **Story-referenced figures inside diegetic media count:** a brochure figure, portrait, or poster
     that IS a named character (the prince on the fake prospectus who is the con-man himself) is that
     character's appearance — seed it from their canonical, in the media's framing.
   - A character's registry entry pins their **canonical costume**; generate them in it unless the shot
     authors a change.
   - **A recurring identifiable PROP earns a per-video library slot** (mirrors the character lock). A
     specific object appearing across multiple shots whose look must MATCH (the guidebook, a named
     banknote) — every shot referencing it lists it in that shot's **`props` array** — gets ONE canonical
     generated ONCE (`assets/library/prop-<name>.png`, `prop-` prefix, `--mode environment`/`style`, no
     character seed), then seeded/reused into each appearance. A prop has no pose/expression → it seeds its
     prop canonical directly; its per-shot placement (held up, on a desk, stamped) is composed in the Pass-2
     scene gen off that seed. **`props` names each recurring prop by its library name — no prose
     guesswork** (a prop VPW referenced in the `still_prompt` but omitted from `props` is an authoring gap;
     flag it back).
   - **Environments, plates, one-off props, and *anonymous/nonrecurring* crowds do NOT earn a slot** —
     they're composed inside the scene's Pass-2 gen (an anonymous crowd is different people each time, a
     composition, not a recurring identity; an adjacent shot holding the same crowd/set carries it via
     technique (e)). *(A recurring identifiable GROUP is the exception above — it DOES earn a slot.)* A
     channel-SIGNATURE prop/environment recurring across MANY videos is a separate deliberate build (bible
     §7 standing kit + the single-asset loop + a `kind: environment` registry entry), never a per-video
     Pass-1 default.
   - **`cast` names each figure by its registry name — no prose-clustering or guesswork.** (A figure VPW
     referenced in the `still_prompt` but omitted from `cast` is an authoring gap — flag it back, don't infer.)
2. **Reuse before regenerate.** For each entity check the registry
   (`py -3 scripts/forge.py lookup --kit <kit> --character <c> --tag <tag>`, or read
   `registry/registry.json`). A hit → record it in the manifest as `reused`, no generation.
3. **Generate the missing** characters per the bible's seed rules (§5) and protocols (§8):
   - **New cast member** → `--mode new_character` seeded off the template base, `2:3`.
   - **Variant** of a character (young MacGregor, a wounded-later version) → anchored iteration: seed
     off that character's canonical, change only the variant trait, save as `<name>--<variant>`.
   Give each a descriptive kebab-case name (`macgregor-base`, `bolivar`, `miskito-king`). Batch what
   you can (`--batch <file.json>`, items `{name, character, mode, delta, aspect, seed?}`).
   `forge.py gen` stages everything into `<kit>/_staging/` (it creates the dir).
4. **Verify** every staged character against the bible's §3 rig checklist by looking at it (Pass 1 is a
   handful of characters and they are the seeds, so this one is checked inline; no hand crops).
   Pass → if it's being promoted to the channel (step 6), `register` it FIRST (register consumes
   staging → `refs/`), then copy into `videos/<slug>/assets/library/`; otherwise move it straight to the
   library. Fail → **ONE re-authored retry** (see the retry rule below), then surface it flagged.
5. **Write `assets/library/manifest.json`:** `{video_slug, generated, assets: [{name, kind: character|prop,
   file, source: reused|generated, seed: [<frames used>], shots: [<shot ids>], notes}]}` (the per-video
   library is recurring characters + recurring props — a prop entry is `kind: prop`, `file`
   `assets/library/prop-<name>.png`, no pose/expr; a deliberately-promoted channel-signature
   prop/environment additionally carries its own `kind: environment` registry entry, bible §9).
6. **Promote a recurring CHARACTER to the channel.** A character likely to recur in future videos also
   gets `register`ed into the channel registry/refs (bible §9), so later videos hit it via `lookup` →
   `reused` (the video library keeps its own copy). That is how the channel's cast grows video over
   video. A channel-signature *non-character* element is promoted deliberately via the single-asset loop
   / bible §8, not here.

**Worked example (Poyais).** The character table yields MacGregor (~26 shots → new cast member, pro,
seeded off base, era uniform), Bolívar (1 shot but NAMED → cast member anyway), and the local king
(≥2 shots → cast member). The guidebook, the London dock, and the *anonymous* settler crowd are **not**
locked here — they're composed inside their scenes' Pass-2 gens (the crowd carried across an adjacent hold
by technique (e)); had the story featured a recurring *named* troupe, THAT would lock as a group-character
(canonical = its members together, seeded into each appearance). On a later video a returning CHARACTER
hits the registry → `reused`, zero generation.

## Pass 2 — scene generation

Walk `long_form.shots` **in order** (then shorts, then the thumbnail). Each scene is generated as a
**complete image in ONE run** — there is no posed-character pre-build; a scene multi-seeds all of its
inputs at once. Output: `videos/<slug>/assets/scenes/<shot-id>.png` + `manifest.json`.

**Seeding (the load-bearing rule).** A scene generates in ONE run. Seeds, in order: **each cast figure's
character canonical + its `expression_ref` frame + its `pose_ref` frame** (+ the interaction template when
two figures interact), then a **style anchor / plate — MANDATORY on every scene/plate gen, not just
character-free ones** (the character seeds pin identity, NOT art style; pick the shot's continuity parent
frame — a prior in-stage/set frame or the plate this scene evolves — else a `refs/env/` register anchor,
else an approved on-style scene). **Cross-chunk ART-STYLE drift is the proven failure when scene gens run
unanchored** (a batch of cast-seeded-but-style-unanchored scenes drifted to different renders
chunk-to-chunk — a softer/detailed-middle look, mismatched line weight; human-caught 2026-07-16). Prompt
last. Attribute provenance still routes by seed: **identity / head-tone / hair / costume from the character canonical; body / hands from the
pose frame; eye / brow / mouth SHAPE only from the expression frame** (bible §5). The library primitives
(§7) are the seed source — a `pose_ref`/`expression_ref` names one and it is seeded straight into the scene,
never merged first. The environment + props are DESCRIBED in the delta and composed in the same gen.

**Seed cap ≤4, and regen-first on a rig defect (bible §5).** A scene gen carries **at most FOUR seeds** —
character canonical + ONE pose + ONE expression + one anchor/exemplar (a style anchor OR the crowd
exemplar, only when the shot needs it); beyond 4 every prior dilutes and a `base.png` tossed in as an Nth
"rig anchor" pins nothing (measured 2026-07-16: 4–5-seed rework gens lost identity). And a **way-off-rig /
multi-defect frame is REGENERATED FRESH from its canonicals**, never "fixed" by seeding an identity pass
off the defective frame — the defect lives in the strongest seed and rides it back ~half the time. The
only defective-seed exceptions are an **authored delta-chain parent** (technique (e)) and a **human-ordered
framing hold**, and BOTH take a **before/after crop-battery diff on EVERY figure** in the frame, not just
the targeted one. **Crowd-bearing gens also seed the crowd exemplar** (`refs/base/crowd-exemplar.png`,
bible §2d) as the crowd's proportion/face anchor — the §2d words stay in the `still_prompt`, but the
exemplar seed is what pins the crowd rig.

**Aspect ratio — pass it explicitly, every scene; NEVER 16:9 on a cutout.** Long-form scenes inherit
`long_form.aspect_ratio` (16:9 for The Second Take); each short's scenes inherit that short's ratio
(9:16). `forge.py`'s default gen aspect is portrait **`2:3`**, so 16:9 long-form work MUST pass
`--aspect 16:9` on every **scene / plate** gen — forget it and the scene generates portrait, silently
mis-framed against the video. **A gen whose output becomes a CUTOUT is the opposite — NEVER 16:9.** A
wide cutout gen squashes the object's proportions (a 16:9 ship cutout shipped at aspect 1.54 vs the
approved 1.22, human-caught); cutout gens use the default `2:3`, or `4:3`/`3:2` for a naturally-wide
object. This is now **mechanically enforced:** `forge.py cutout` HARD-ERRORS on an input whose
width/height ≥ 1.5 (regenerate the source at 2:3/4:3/3:2) unless `--allow-wide` is passed for a
legitimately wide object (a star row).

**Scope of a shot:** generate **stills** only for shots whose `source` is `ai-gen` or the generated half
of `hybrid`. `source: chart|screencap|stock|archival` belong to other pipelines — skip them and record
`skipped: source=<x>` in the manifest. **Ignore every motion/beat field** — `stage`/
`stage_role`/`changed_elements`, and any retired motion keys an old file still carries — motion is the
Remotion engine's business; you read only the visual fields. `synthetic` is consumed by metadata, not
here. **ALL in-video text is diegetic — designed into the scene and BAKED into the generated image** (a
stamp, a sign, a ledger, a banner). Engine-drawn text and device cards are retired, so there is no overlay
that draws type at render time — if a shot needs words on screen, they are an on-artifact element in this
still. Authored text is quoted verbatim in the `still_prompt`, kept SHORT (1–4 words proven; longer
unproven); the batched review transcribes it letter-by-letter and a garbled/partial render is a blocking
flag (bible §3). **Every text-bearing gen ALSO seeds the channel's lettering exemplar**
(`refs/env/lettering-marker-italic.png` for The Second Take — the locked type look, bible §6) so all
in-video lettering stays one family across videos; the review judges lettering FAMILY loosely (same
hand, not identical glyphs) and spelling strictly.

**Prompt assembly:** `forge.py` auto-prepends the bible descriptor (§2/§2b by mode); your delta is the
shot's `still_prompt` (which already carries the file's `global_prompt_suffix` AND the authored
framing/composition — VPW owns it) plus the seeds; do NOT re-compose the shot, add only minimal
technical placement. **Precedence:** the delta overrides the descriptor on exactly the variables it
names (an outfit change, era dress, a deliberately-authored stamp/counter) — everything it doesn't name,
the descriptor holds; where `global_prompt_suffix` and the bible disagree, **the bible wins**. Mode per
technique: **(b) composed scenes → `--mode environment`** (the style-only descriptor; **seed each `cast`
figure's frames** — canonical + `expression_ref` + `pose_ref` (+ the interaction template when two figures
interact) — so identity, pose, expression, hands, and tone route by seed; the delta describes ONLY the
environment + placement, NEVER the pose/expression/hands; `forge.py` auto-appends the §2c RIG-HOLD form
prior); **(c) character-free scene → `--mode environment`/`style`** (**carries a style-anchor seed** — see
the ENV rule below; forge hard-errors an unseeded environment/style gen); **(d) one-shot single-character
→ `--mode identity`** off that character's canonical (+ its expr/pose frames). (`--mode style` is the
explicit alias — the same §2b style-only descriptor as `environment`.)

**Figure index — the shot's `cast` names its figures.** Before generating shot `S`, read its `cast`: for
each figure, **seed its frames** — canonical + `pose_ref`/`expression_ref` (a `cast` entry with neither ref
→ the plain canonical). Seed via technique (a) only if an on-disk frame already IS that shot full-frame,
else as a placed figure via (b)/(d); never fresh-draw a figure that has a canonical — the seeded canonical
is what holds identity + the library hand across shots. (`cast` is authoritative; the library manifest maps
each character to its canonical, the registry maps each `pose_ref`/`expression_ref` tag to its frame.
Environments/props aren't figures — they're composed per shot from the `still_prompt`.)

Per shot, pick the **cheapest technique that holds the locked elements**:

| Technique | When | How |
| --- | --- | --- |
| **(a) Reuse / reframe** | an already-generated on-disk frame (a prior scene, or a canonical that already matches) IS this shot | copy that file to `scenes/<shot-id>.png` (the scenes folder stays the one complete render source); manifest notes the source + intended framing. No gen. |
| **(b) Seeded composition** (default for a scene with characters) | the locked character(s) present, in a composed environment | ONE generation multi-seeding each `cast` figure's frames (`--seed <char-canonical>,<expr-frame>,<pose-frame>[,<template>][,<char2…>]`) + any style anchor. The environment + props are DESCRIBED in the delta and composed in the gen. Delta = the `still_prompt`'s scene/placement facts only — pose, expression, hands and tone route by seed (bible §5); do NOT re-compose or re-describe them |
| **(c) Character-free scene** | a map, an empty plate, an object — no locked figure in frame | ONE style-only gen (`--mode environment`/`style`) **carrying a style-anchor seed** (target plate / prior-in-chain > a `refs/env/` register anchor > an approved on-style scene), composed from the shot's `still_prompt` |
| **(d) One-shot single-character** | a simple shot with a single prominent character | single gen seeding the character's canonical (+ its expr/pose frames); full rig check still applies |
| **(e) Seeded delta-chain** (a held STAGE, the DELTA-CHAIN arm of the BOUNDARY rule) | consecutive shots sharing a `stage` id where the change is INTEGRATIVE (the new element fuses into the scene's architecture — a city grows a bank, gold threads the streets) | the `base` uses (b)/(c)/(d); each `delta` seeds off the PREVIOUS frame's output (`assets/scenes/<prev-shot-in-stage>.png`) and changes ONLY that shot's `changed_elements`, holding the rest; **≤3 deltas** from the base, then re-base or hard-cut. A re-base to a NEW place seeds canonical; a re-base that stays in the **SAME location** seeds the **prior stage's BASE frame**, never a fresh canonical — canonical would throw the set away and return a different place (bible §8). *(A DISCRETE change — an element that sits on the scene without fusing into its architecture, a character entering, a stamp slamming onto a page — is LAYERED instead: keep the plate, composite an animated cutout. See the layered-shots section + the BOUNDARY rule.)* |

- **Two-gen identity pass — the DEFAULT for a scene-heavy single-character shot (not a fallback).** A
  *scene-heavy single-character shot* = **exactly ONE seeded cast figure** in a `still_prompt`
  **dominated by environment/scene content** (the figure is one element inside a built, filled scene,
  not the whole frame). On these the heavy environment delta reliably **starves the lone character
  seed** — the figure renders as the blank cream bald base template (it passes every §3 FORM check and
  is still the wrong character). So generate them in **TWO gens by default:** **gen A** composes the
  whole scene (technique (b)/(d)); **gen B** is an *identity pass* seeded `[gen-A scene frame +
  character canonical + expression frame]` that changes ONLY the figure's identity (head tone + hair +
  face), holding the environment gen A built. **Multi-character shots and character-light/character-free
  shots are UNCHANGED** — the starve needs a lone figure against a heavy environment. Cost: ~1 extra
  gen (~$0.13) on such shots — accepted (identity-starve hit 3× across the dogfood slice + chunk 2,
  two-gen fixed it 3/3; `decisions.md` 2026-07-16). This is the standing prevention for the bible §3
  identity-match invariant; it is distinct from the one re-authored retry below, which still applies if
  gen B itself comes back wrong.
- **De-nose / de-ear fix — a targeted identity-style pass, budgeted for TWO gens.** To strip a nose or ear
  off an otherwise-good frame (a rig defect the review flagged), run a **targeted identity pass seeded
  `[current frame + base-rig exemplar]` that changes ONLY the faces** — it lands the nose fix in one gen.
  But the engine **re-draws a sticky C-shaped ear or a residual nose ~half the time**, so the reliable
  shape of this fix is a **SECOND targeted pass seeded off the already-fixed frame** (not off the original
  — the original still has the defect). Budget both from the start; confirm the ear/nose is gone by a
  zoomed look at the face, not a glance. This two-pass shape is the FIX TECHNIQUE for nose/ear removal, not
  a loosening of the one-retry batched-review rule below — a targeted rework pass whose second gen cleans a
  known-sticky residual is the technique working as measured, not a grind.
- **One engine:** every generation uses `gemini-3-pro-image` (the registry `engine`) — there is no
  tier choice to make; `forge.py` routes every call to it.
- **Seeds — every generation is seeded (chunk-1 evidence: an unseeded gen invents its own register).** A
  scene seeds its cast frames (canonical + expr + pose + template), plus a **style anchor** for any
  environment/style gen. Never seed off a downstream character derivative for identity — trace identity to
  the approved canonical. **The `delta`-frame exception (technique (e))** seeds the *immediately previous
  frame in its stage*; scope it tightly — within-chain only, **≤3 hops** from the stage `base`, and a
  re-base in the same location seeds that stage's base frame (above). A new chain/place re-seeds canonical.
- **ENV rule — every environment/style generation carries a style-anchor seed; `forge.py` hard-errors
  otherwise** (an unseeded environment/style gen falls back to a stock-clipart prior, off the locked
  style). Preference order: **the target plate or prior-frame-in-chain > a `refs/env/` anchor matched by
  REGISTER (vivid exterior / muted exterior / parchment map-document) > an approved on-style scene.**
- **Maps — CROP the existing map canonical, never regen a new region.** A shot that needs a different
  region of an already-established 2D map (the same map zoomed to South America, Europe, one country) is a
  **deterministic PIL crop/zoom of the existing map canonical**, NOT a gen — a regen invents a new
  coastline/palette/lettering and two "same" maps read as two different maps (bible §5). Regen is the
  fallback ONLY when the canonical genuinely doesn't cover the region, and then seed the **map canonical +
  the parchment-map register anchor** (`refs/env/env-map-parchment`). Country borders, routes, and region
  reveals drawn onto the crop are motion LAYERS (motion-planner), not baked — the crop is the plate.
- **Expression-frame re-author invalidates only the scenes seeded from it (frames → scenes; there is no
  merge tier).** A scene seeds an `expression_ref` frame directly, so re-authoring an `expr-*.png` to a new
  register makes STALE only the scenes that seeded the old frame: **(1) re-author + human-gate the frames →
  (2) regen the affected scenes.** Never ship a video mixing old- and new-register faces.
- **Every human figure obeys the family, by TIER** (bible §3/§8 — the three-tier rig model §2e):
  a **named/recurring foreground** figure on the FULL rig (seeded + auto-appended §2c); an **anonymous
  LARGE/foreground** figure ALSO on the FULL rig via the **§2e base-rig clause** (VPW-authored into the
  shot's `still_prompt` — full rig, a generic fitting outfit/hair, **no seed, no canonical**); an
  **anonymous small/many/background** crowd on the **CROWD RIG (§2d)** (its clause is already in the
  `still_prompt`, and the gen **seeds the crowd exemplar** `refs/base/crowd-exemplar.png` — the seed pins
  the proportion + face that prompt words alone let drift — on the simplified rig: round heads, dot eyes,
  one simple mouth). Review each figure against the rig its tier names: a §2e foreground figure against the
  FULL rig (a prominent figure rendered on the simplified crowd rig is a FAIL), crowd figures against the
  crowd rig. Style/proportions/period never switch.
- **Crowd scene with ONE seeded lead — assert the lead's costume + contrast the competing figures.** When
  a single seeded named figure stands among an anonymous crowd, the crowd competes with the lead's seed
  and can starve its costume (the lead reverts toward a generic figure). Two proactive levers in the delta:
  (1) **restate the lead's pinned costume explicitly** even though it is seeded (belt-and-suspenders on a
  starve-prone shot), and (2) **give the anonymous crowd/rivals a CONTRASTING uniform/palette** so the
  lead reads as distinct at a glance (prevented a costume-starve proactively on a crowd-with-lead shot,
  2026-07-16). The lead is still judged against its canonical in the batched review.
- Generate the scene, move it to `assets/scenes/<shot-id>.png`, and record `{shot_id, file, technique,
  seeds, flagged: false, review_status: "unreviewed", parked_reasons: [], notes}` in
  `assets/scenes/manifest.json` (skipped shots get a `skipped` entry). `review_status` starts
  `"unreviewed"` and is set to `"verified"` or `"parked"` ONLY by `stamp_review.py` after the batched
  review below (a scene is NOT shippable until then).
  **`review_status` is the render gate:** `render-builder` ships only `"verified"` entries; a
  `"parked"` entry hard-errors with its `parked_reasons`, and `"unreviewed"`/unstamped hard-errors like a
  missing scene (`render.py::_entry_review_reason`).
- **Shorts:** same walk per short's `shots[]` (+ its `first_frame`), aspect `9:16`, files
  `scenes/<short-file-stem>-<shot-id>.png`.
- **Thumbnail:** generate `thumbnail.primary` AND each challenger — `16:9`, files
  `assets/thumbs/thumbnail-primary.png` / `thumbnail-challenger-N.png`, from each `gen_prompt` —
  seed any locked CHARACTER it features (most are character-free artifact thumbnails → compose fully, no
  seed). Do NOT bake the `text_overlay` into the image — it's applied at publish. The batched review applies.
  These candidates are NOT the publishable file — a thumb PNG straight out of the engine is whatever
  aspect/size the gen produced, and `compliance-check`'s Gate-3 mechanical check requires exactly
  1280x720. After the human picks a winner from the reviewed candidates, run
  `py -3 .claude/skills/image-generation/scripts/finalize_thumbnail.py <picked-candidate.png> <video_dir>`
  — it center-crops the pick to 16:9 (then LANCZOS-resizes to 1280x720) and writes
  `<video_dir>/assets/thumbnail.png`, the file every downstream gate/publish step reads. It refuses
  (exit 1) to upscale a candidate whose crop is narrower than 640px, and is idempotent — safe to re-run
  if a later round picks a different candidate. The unpicked challengers stay in `assets/thumbs/` for
  future A/B swaps; they are never deleted just because one was finalized.

**Worked example (Poyais L22, "MacGregor commissioned a guidebook…").** Technique (b) — seeds =
`library/macgregor-base.png` (identity) + his `sit` pose frame + a `smug` expression frame, in ONE gen;
delta = the shot's `still_prompt` + "MacGregor seated at the desk, centered; the guidebook held up in his
hand, foreground right" — the London office and the guidebook are described and composed in this gen (the
pose/expression/hands route by seed, not by words). It ships into the batch, then the
batched review judges it — identity/rig (MacGregor held + on-rig, no nose/ears, outline, four-digit
hands, by looking at the full frame), fidelity (seated, centered, guidebook in hand — every fact
realized, nothing extra), and style (reads as the con being manufactured — its `ironic-counterpoint`
class, on-recipe flat-cel).

**Render handoff:** `render-builder` consumes `assets/scenes/` directly (**scenes mode**, auto-detected
via this pass's manifest) — each verified PNG becomes its shot's visual in the MP4, and a missing scene
for an ai-gen/hybrid shot is a render-time hard error. The skipped sources (chart/screencap/stock) fall
back to the render's inline path, counted in its manifest.

**Layered shots (from `shots.motion.json`).** When the `motion-planner` output exists, each shot it marks
with a `cutout` `layers[]` is materialized into the fixed layout the engine reads (schema: render-builder
`references/shots-motion-schema.md`). Every layer is the DISCRETE (LAYER) arm of the BOUNDARY rule — an
element that sits on the scene without fusing into its architecture — so it is composited, not baked.
(Engine-drawn text + device cards are retired; there are no `source: engine` layers to materialize.)
- **plate** `plates/<id>.png` — the scene MINUS the moved element (`background.plate_prompt`), which must
  still read as a **complete** object — never a blank slot where the subtracted element was.
- **cutout layers** `cutouts/<id>-<layer>.png` — **every cutout is SEEDED** (from its character/prop
  canonical, or from the plate it lands on plus a style anchor — an unseeded cutout invents its own
  register). Gen the layer's `cutout_prompt` on a **solid MAGENTA chroma field** (the engine emits no
  alpha — transparency is always post-hoc keying; a *pale* field starves rembg on a pale subject), then
  `py -3 scripts/forge.py cutout` (rembg → alpha-harden → trim; the cutout gen is NOT 16:9 — forge
  hard-errors a wide input, bible §6/§8). **Judge the matte by MEASUREMENT, not by looking** — alpha
  histogram + corners **+ every enclosed interior region** (letter counters, rigging gaps — rembg keeps
  opaque pale interior holes), and composite it over its real destination plate before calling a halo or
  a colour defect (bible §8).
- **Hybrid** (a `delta-chain` shot carrying a cutout layer — a discrete overlay like a FICTION stamp): do
  **not** bake a full delta scene and do **not** gen a plate — `background.plate` already points at the
  prior in-stage `scenes/<prior-id>.png` (reuse it); materialize **only** the overlay cutout. Net less gen.

The batched review below judges every generated plate + cutout the same as a scene.

## Reviewing the batch (ONE pass, after every scene is generated)

Generate all of Pass 2 first — **do not gate mid-run.** When the batch is complete, run ONE review round
over the whole thing, then regen only what is genuinely wrong.

**This review is now the ONLY seed-routing gate.** The retired posed-character merge had a cheap
"isolation gate" that caught a bad blend (wrong-tone hands, a reverted-to-base face, an identity collapse)
on an isolated portrait BEFORE any scene gen. That gate is gone — a scene multi-seeds in one run — so those
seed-routing failures now surface HERE, on the full scene, at full gen cost. Watch for them explicitly:
hands off the character's tone, a weak/wrong expression (expression is the SOFTEST seed — it lands weak),
identity bleed between two co-present figures.

**Dispatch three concurrent review subagents**, each one tight mandate over the whole batch. Give each
the generated scene files + per shot its `still_prompt`, `vo_text` (the full narrated span — facts
often live in the tail like "…a cathedral, and a prince"), and `beat`/`shot_class`, plus the bible
**§3 rig checklist**, the **§6 recipe**, and `universal.md §13a` (shot-class definitions). `vo_ref` is
only the render timing anchor, not a fidelity source.

1. **Identity/rig** — return a FORCED verdict, never a silent pass, on **every seeded frame AND every
   anonymous LARGE/foreground (§2e) figure** (both are on the FULL rig). For each such figure, rule
   **PASS/FAIL on each invariant**: **round head · no nose · no ears · four-digit hand (three fingers + a
   thumb) · [pinned costume — seeded figures only]** — judging a **seeded** figure against its **character
   canonical**, and an **anonymous §2e** figure against the FULL-rig invariants (bible §3), since it has no
   seed. A prominent §2e figure rendered on the simplified crowd rig is a FAIL. (Anonymous
   small/many/background figures are the CROWD RIG (§2d) — judged against the crowd rig, not the full rig
   here.) For a **chain-delta** frame add one **held-set** line (is the set + identities consistent with
   this stage's `base` frame?). The **four-digit hand is judged like every other invariant** — the seed is
   4-digit, so a 5-digit render is a drift-from-seed FAIL, no different from a nose appearing; do not treat
   hands as a special "uncertain" case. (A hand PASS is *not* a certified count — an eye-count of a cartoon
   hand is unreliable even at zoom, so never word one as verified; the human board is the final finger
   authority, bible §3.) On any FAIL, name the shot id and quote the offending pixel in one
   clause. Judge against the channel's **approved canonical** (`refs/<char>/<char>-base.png`), NOT an
   idealized pure-round-head/articulated-finger rig. **Rig review runs on the CROP BATTERY, not full-frame
   eyeballing (2026-07-16):** (i) a **localizer** agent returns per-figure face + each-visible-hand bounding
   boxes as structured JSON (localization is far more reliable than judgment; the localizer never rules);
   (ii) **`scripts/crop_battery.py`** (PIL, deterministic) cuts those boxes at 3–4× into per-shot contact
   sheets + individual crop files; (iii) THIS judge rules PASS/FAIL per crop per invariant with the **crop
   file path cited as evidence** on every ruling — a prose "zoomed 3–4×, verified" claim with **no crop
   artifact is inadmissible**. A fix pass re-enters the battery on the before AND after frames, all figures
   (the regression diff). Silence on a seeded frame (or a §2e foreground figure) is not allowed; each gets
   an explicit per-invariant ruling.
   - **This FRESH-EYES review is the rig authority — a GENERATING agent's own self-verification does NOT
     substitute for it.** A unit that generated a frame under-reports its own rig defects: noses it called
     "within tolerance" / "minor" were ruled BLOCKING by fresh-eyes zoom review, **twice adjudicated real**
     (2026-07-16). A generator is invested in its output and anchored on the prompt it wrote, so it grades
     leniently; only a fresh-context reviewer zooming the faces catches the slip. Never let a generator's
     self-check stand in for this pass, and never downgrade a fresh-eyes nose/ear FAIL to "minor" — a nose
     on the no-nose rig is blocking regardless of size.
2. **Fidelity** — does each image assert **exactly the shot's load-bearing facts** (layout, geography,
   orientation / who faces whom, gesture + highlight targets, casting/costume) and **nothing extra that
   changes the read**? VPW authors prompts as checkable facts precisely so this has teeth; check the
   claims one by one against the pixels. **Transcribe any authored in-image text LETTER-BY-LETTER** against
   the words the `still_prompt` quotes — a garbled, misspelled, or partial render is a **blocking** flag
   (all in-video text is now baked diegetic — there is no engine overlay to fall back on).
3. **Style/taste** — does it read as its `beat` and `shot_class` at a glance, on-recipe (flat-cel 2.5D,
   built-but-flat, marker-honest per §6) **AND rich — committed scene palette, fore/mid/background depth,
   light/atmosphere, filled edge-to-edge (the "gold" bar, bible §6)** — or is it slop: generic, cluttered,
   off-register, drifting to the detailed middle, **or thin/sparse/basic (a lone object on dead air, no
   palette or depth commitment — the "looks like flat pixel-art" failure)**? **Check expression-register
   per beat** — expression is the softest seed and lands weak (a "thinking" seed reads flat), so verify each
   lead face is sized to its beat; an over-the-top face on an ordinary/grim beat AND a flat face on a real
   peak are both defects (bible §3).

Each returns a **flagged list keyed by shot id** — one sentence per defect, quoting the offending
fact. **Merge the three lists.** A frame no agent flagged ships as-is.

**Fix flagged frames — ONE re-authored retry, then surface:**
- **Exactly ONE auto-retry per frame.** Not two, not a ladder.
- **The retry is a FRESH gen off a RE-AUTHORED prompt — never prompt-accretion.** Do NOT append the
  flag onto the failed delta ("…and make sure the hand has four digits") and re-fire; that keeps the
  logic that just failed and stacks a patch on top of it. Instead **change the prompt logic**: rethink
  how the frame is described (a different composition strategy, a different phrasing of the load-bearing
  fact, a different emphasis), then generate clean. Seed from the canonical, not from the failed frame.
- **Re-author HOW an authored fact is depicted, never WHETHER it appears.** Deleting or softening a
  load-bearing authored fact to dodge a rendering defect — dropping an authored salute to avoid drawing
  the open hand — is a fidelity VIOLATION dressed as a fix, not a legal retry. The retry changes how the
  fact is drawn (seed the pose primitive, restate the digit fact); a fact that still won't render clean
  after the one retry is **flagged for the human**, never silently removed.
- **Self-check only the flagged points** on the new frame by looking at it — do NOT re-dispatch the
  review agents, do NOT re-review the whole batch.
- **Still failing after that one retry → STOP.** Keep the best attempt, mark it `flagged` in
  `assets/scenes/manifest.json` with the reason, and **surface it in the deliverable** (the human
  artifact) — the human decides. No third attempt, no technique-switch escalation ladder. A systematic
  failure (the same invariant missing both times) that looks like a bible value being off → surface a
  proposed fix, never self-apply, and keep forging the rest.
- **Stamp the gate — generating agents NEVER stamp; the ORCHESTRATOR alone runs the stamp**, and only
  after the crop battery + fresh-eyes review pass. A unit that generated a frame is invested in it and
  grades leniently, so it may not verify its own output. The orchestrator collects every agent's
  structured verdict, **merges the three lists into `assets/_review/merged.json`** (one ruling per shot id,
  each carrying the per-axis severities + `why`), then runs the honest stamp writer:

  ```
  py -3 .claude/skills/image-generation/scripts/stamp_review.py <video_dir>
  ```

  `stamp_review.py` is the ONLY writer of the render gate's verdict. It reads `merged.json` and writes
  **`review_status` + `parked_reasons`** onto each shot's `scenes/manifest.json` entry — the three honest
  states (Task 2, `render.py::_entry_review_reason`):
  - **`verified`** — a fully-clean ruling (no fidelity/style/rig defect on any axis). Shippable. This is
    the ONLY state render-builder ships.
  - **`parked`** — ANY defect ruling (even LOW). Reviewed, defects known, **honestly NOT shippable**; the
    ruling's defect strings become `parked_reasons`, which the render gate prints as `parked: <reasons>`.
  - **`unreviewed`** — no ruling covered the shot (never stamped). Gated, not shippable.

  Layered shots reviewed via their plate/cutout get an entry created; entries the review didn't cover are
  left untouched. It **never** writes a `verified: true` boolean — that shape is what let fyt-run-001's
  conductor falsely stamp 119 defective frames when "parked" had no representation. Prints
  `stamped: N verified, M parked`. This stamp IS what unblocks render-builder's gate — a shipped-but-
  unstamped manifest rejects every scene, and a parked one names why.

## Single-asset loop (one-offs, cast extension, library building)

1. `lookup` the registry — a hit means hand back the file, done.
2. Pick the seed by bible §5: existing character → its canonical `base`; **"iterate on THIS"** → that
   exact approved frame as seed, change ONLY the one requested variable; new character → the template
   base + new head tone (§4); environment/prop → style-only mode **with a style-anchor seed** (a `refs/env/`
   register anchor or an approved on-style frame — forge hard-errors an unseeded environment/style gen).
3. `gen` into staging → **check the §3 rig checklist** by looking at it → **ONE re-authored retry**, then
   flag + surface as above. Record the round (seed, mode, delta, settings, verdict) in a notes file beside
   the frames — a one-off has no manifest, so it needs its own log or the reasoning dies with the terminal.
4. `register` what passed (`--batch` for many; environments add `"environment": true`) — staging →
   `refs/`, indexed in the registry.
5. When building the channel's standing library, follow the bible §7 build order (expressions →
   concept props → device kit → plates → secondary cast → action poses).

## Report

What shipped (library counts, scenes by technique), what was reused, what the batched review caught per
category (identity / fidelity / style) and what it regenerated, any frames still **flagged** after the
one retry (with their reason), anything escalated for approval, and the render-wiring caveat. Publish
the generated images for human review via an Artifact link — full frames, **flagged ones marked with
their reason**, and the **crop-battery sheets embedded (collapsible per card)** so the human finger/ear
gate rules on evidence at seconds per shot — the human review is the final authority (the user can't see
them inline).

**Present it neutrally — the human calibrates the bar, not you.** Never declare the output "works" or
"clears the bar": the bar is the reference grade the human holds (bible §6's gold bar), and a premature
success claim skips real problems, reads as cheerleading, and burns iterations. **Name the batch's
weaknesses FIRST**, then hand it over and let them judge. When they reject a frame or the set, **diagnose
the root cause honestly instead of defending the work** — the true diagnoses are usually structural
(figures composed at the wrong scale against their plate read as paper-doll stickers; shots labelled
"non-literal" that in fact still draw the sentence literally), and naming one is worth more than a
defence.

## Not this skill

Planning the shots (`visual-prompt-writer` owns `shots.json`) · establishing/locking a brand-new channel
style · writing scripts · assembling the video (`render-builder`).
