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
   IDs it appears in, and the distinct `pose_ref`/`expression_ref` combos it uses (those drive Pass 1b).
   `script.md` is context only.
   - **Individual named characters AND recurring identifiable groups earn a library slot** — even
     single-shot individuals (a named character free-drawn inside a scene falls off the rig, so it needs a
     canonical seed regardless of count). A **recurring identifiable group** (a specific named band/duo/
     troupe appearing across shots) is a character whose canonical is a **group frame** — its N members
     together in their matching outfits; it locks IDENTITY (member count, matching costume, look, rig) and
     is seeded into every appearance so the group stays consistent. A group uses **no** `pose_ref`/
     `expression_ref` (those are single-figure) → no Pass-1b merge; its per-shot staging (performing /
     lined up / atop the pile) is composed in the Pass-2 scene gen off the seeded group canonical. **If a
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
     character seed), then seeded/reused into each appearance. A prop has no pose/expression → **no Pass-1b
     merge**; its per-shot placement (held up, on a desk, stamped) is composed in the Pass-2 scene gen off
     the seeded prop canonical. **`props` names each recurring prop by its library name — no prose
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

### Pass 1b — posed-character merge

For each DISTINCT `(character, pose_ref, expression_ref)` combo appearing in the shots' `cast`, build ONE
posed-character asset (a combo used by many shots is merged once, reused). A `cast` entry with neither ref →
the plain identity canonical (Pass 1a above), no merge.

- **Merge gen:** seed `[<character canonical>, <pose_ref frame>, <expression_ref frame>]` (drop a seed a combo
  omits), `--mode environment`, plain background. Delta = the **binding template**, which executes the
  **attribute-provenance split (bible §5)** — base-derived seeds are bald/cream/neutral, so route every
  attribute explicitly: *"Combine the references into ONE `<character>`. From the CHARACTER reference: identity,
  head/skin TONE, HAIR and facial hair, COSTUME, and face (do NOT restate the costume — it lives in that
  reference). From the POSE reference: ONLY the body pose and hands. From the EXPRESSION reference: ONLY the
  eye/brow/mouth SHAPE — never its tone, head, or hairline. Every skin patch, INCLUDING BOTH HANDS, renders in
  the CHARACTER's head tone."* (`forge.py` auto-appends the §2c rig-hold — the shared FORM prior: round head /
  no nose / four-digit. It is character-agnostic, so it sets hand FORM while the POSE seed sets hand POSE — the
  two don't conflict.)
- **Seed quality + staging (keep the provenance split honest against the blend).** The engine BLENDS seeds by
  field weight, so two rules stop base traits winning by majority: (1) **Clean-portrait seed** — seed a
  character from a clean, ISOLATED single-character frame (its canonical, or a prior posed-character portrait on
  a plain background), NEVER a busy scene frame where the figure is small / one-of-many (a weak identity signal
  a base seed overrides — the measured blank-face). (2) **Stage 1-to-1** — a merge step carries at most ONE
  base-derived seed against the character; never stack a pose AND an expression base frame against one canonical
  (2-against-1, the base wins). Run `[character + expression]` then `[+ pose]` as separate steps, each the
  character vs a single base frame.
- **Verify the portrait** against §3 + the combo's intent: 4-digit hands, hands on the CHARACTER's tone, the
  right expression, identity held. **ONE re-authored retry** (see the retry rule in the batched-review
  section), then flag + surface. This is the isolation gate — a bad merge is caught HERE, cheaply,
  before any scene gen.
- Save as `assets/library/<character>--<pose|none>--<expr|none>.png`; record it in the library manifest with
  its `character`, `pose_ref`, `expression_ref`, and the `cast`-matching shot ids.
- **Interactions apply the same provenance split + staging.** An interaction `pose_ref` shared by two `cast`
  figures → a posed-INTERACTION asset (both figures, each identity in its slot). **Pre-merge each character to a
  clean portrait FIRST** (identity + its `expression_ref`, per the staging above — a clean single-character
  portrait, NOT a scene frame), THEN seed `[interaction template + portrait A + portrait B]` into ONE
  interaction gen — **never** `[template + A + B + exprA + exprB]` in a single pot (it mis-routes: expressions
  and identities collapse or revert to the bald base). Slot binding = the shot's `cast` order (first = left,
  second = right — VPW owns that convention). The **template carries the clasp geometry + the eye-line** (baked
  into the asset), so a scene inherits both by seeding it — do not re-specify them in words. **Eye-line is
  PUPILS-only:** heads stay front-facing and round — NEVER turn a head toward the other figure to force the
  gaze; a profile head-turn grows a nose/jaw and breaks the no-nose rig (the same profile limit as §7). The
  eyes cut sideways; the head does not.
- **Expression-frame re-author invalidates every posed-character asset built from it (dependency, not
  optional).** A posed-character asset (`<char>--<pose>--<expr>.png`) BAKES the `expression_ref` frame's
  eye/brow/mouth shape at merge time; a scene then seeds that posed-character. So if the `expr-*.png`
  library is re-authored to a new register, every posed-character asset merged from an old frame — and
  every scene seeded from those — is STALE and must be regenerated in order: **(1) re-author + human-gate
  the frames → (2) regen the affected posed-character merges → (3) regen the scenes that seeded them.**
  Never ship a video with a mix of old-register and new-register faces; do the cascade top-down.

## Pass 2 — scene generation

Walk `long_form.shots` **in order** (then shorts, then the thumbnail). Each scene is generated as a
**complete image**: the library (characters only) supplies the identities you seed, and the environment
+ props are composed in the gen from the shot's `still_prompt`. Output:
`videos/<slug>/assets/scenes/<shot-id>.png` + `manifest.json`.

**Aspect ratio — pass it explicitly, every scene.** Long-form scenes inherit `long_form.aspect_ratio`
(16:9 for The Second Take); each short's scenes inherit that short's ratio (9:16). `forge.py`'s default
gen aspect is portrait **`2:3`**, so 16:9 long-form work MUST pass `--aspect 16:9` on every scene gen —
forget it and the scene generates portrait, silently mis-framed against the video.

**Scope of a shot:** generate **stills** only for shots whose `source` is `ai-gen` or the generated half
of `hybrid`. `source: chart|screencap|stock|archival` belong to other pipelines — skip them and record
`skipped: source=<x>` in the manifest. **Ignore every motion/beat field** — `stage`/
`stage_role`/`changed_elements`, and any retired motion keys an old file still carries — motion is the
Remotion engine's business; you read only the visual fields. `synthetic` is consumed by metadata, not
here. **Ignore `on_screen_text`** — it's a motion overlay the engine draws as real
type; do NOT bake it into the still. Render text into the artifact ONLY where `still_prompt` names it as
an on-artifact element (a stamp, a banknote's engraving, a signboard).

**Prompt assembly:** `forge.py` auto-prepends the bible descriptor (§2/§2b by mode); your delta is the
shot's `still_prompt` (which already carries the file's `global_prompt_suffix` AND the authored
framing/composition — VPW owns it) plus the seeds; do NOT re-compose the shot, add only minimal
technical placement. **Precedence:** the delta overrides the descriptor on exactly the variables it
names (an outfit change, era dress, a deliberately-authored stamp/counter) — everything it doesn't name,
the descriptor holds; where `global_prompt_suffix` and the bible disagree, **the bible wins**. Mode per
technique: **(b) composed scenes → `--mode environment`** (the style-only descriptor; **seed the
POSED-CHARACTER asset** for each of the shot's `cast` figures — `assets/library/<character>--<pose|none>--<expr|none>.png`
(Pass 1b) — so the pose, expression, hands, and tone are already baked in; the delta describes ONLY the
environment + placement, NEVER the pose/expression/hands — those are in the seed; `forge.py` still
auto-appends the §2c RIG-HOLD form prior); **(c) character-free scene → `--mode
environment`/`style`** (no identity seed); **(d) one-shot single-character → `--mode identity`** off that
character's canonical. (`--mode style` is the explicit alias — the same §2b style-only descriptor as
`environment`.)

**Figure index — the shot's `cast` names its figures.** Before generating shot `S`, read its `cast`: for
each figure, **seed its POSED-CHARACTER asset** — the Pass-1b merge of its canonical + `pose_ref`/
`expression_ref` (a `cast` entry with neither ref → the plain canonical). Seed via technique (a) if the shot
IS that figure full-frame, else as a placed figure via (b)/(d); never fresh-draw a figure that has a
posed-character/canonical — that is what holds identity + the library hand across shots. (`cast` is
authoritative; Pass-1b's manifest maps each combo to its file. Environments/props aren't figures — they're
composed per shot from the `still_prompt`.)

Per shot, pick the **cheapest technique that holds the locked elements**:

| Technique | When | How |
| --- | --- | --- |
| **(a) Reuse / reframe** | the shot IS a full-frame of a locked CHARACTER (a reaction close-up) | copy the library file to `scenes/<shot-id>.png` (the scenes folder stays the one complete render source); manifest notes the source + intended framing |
| **(b) Seeded composition** (default for a scene with characters) | the locked character(s) present, in a composed environment | ONE generation seeded on the **posed-character asset(s)** (`--seed <char--pose--expr>[,<char2--…>]`) for the shot's `cast`. The environment + props are DESCRIBED in the delta and composed in the gen. Delta = the `still_prompt`'s scene/placement facts only — the pose, expression, hands and tone are baked into the seeded posed-character (bible §5); do NOT re-compose or re-describe them |
| **(c) Character-free scene** | a map, an empty plate, an object — no locked figure in frame | ONE style-only gen (`--mode environment`/`style`), composed from the shot's `still_prompt`; no identity seed needed |
| **(d) One-shot single-character** | a simple shot with a single prominent character | single gen seeded off the character's canonical ref; full rig check still applies |
| **(e) Seeded delta-chain** (a held STAGE) | consecutive shots sharing a `stage` id — a `base` frame then `delta` frames | the `base` uses (b)/(c)/(d) off canonical; each `delta` seeds off the PREVIOUS frame's output (`assets/scenes/<prev-shot-in-stage>.png`) and changes ONLY that shot's `changed_elements`, holding the rest; **≤3 deltas** from the base, then re-base or hard-cut to a new stage. A re-base to a NEW place seeds canonical; a re-base that stays in the **same location** seeds the **prior stage's base frame** instead — canonical would throw the set away and return a different place (bible §8). (A future motion engine will move element layers from the same `changed_elements`.) |

- **One engine:** every generation uses `gemini-3-pro-image` (the registry `engine`) — there is no
  tier choice to make; `forge.py` routes every call to it.
- **Seeds:** always the Pass-1 character canonical frames — never a downstream derivative, never a prior
  scene output. **The ONE exception is a `delta` frame in a chain (technique (e))**, which seeds the
  *immediately previous frame in its stage*; that carry-over is what holds the set. Scope it tightly:
  within-chain only, **≤3 hops** from the stage `base` — a new chain or stage ALWAYS re-seeds canonical
  (that re-seed is what contains drift).
- **Every human figure obeys the family, by TIER** (bible §3/§8 — the three-tier rig model §2e):
  a **named/recurring foreground** figure on the FULL rig (seeded + auto-appended §2c); an **anonymous
  LARGE/foreground** figure ALSO on the FULL rig via the **§2e base-rig clause** (VPW-authored into the
  shot's `still_prompt` — full rig, a generic fitting outfit/hair, **no seed, no canonical**); an
  **anonymous small/many/background** crowd on the **CROWD RIG (§2d)** (its clause is already in the
  `still_prompt`, so render the crowd from it, no seed, on the simplified rig — round heads, dot eyes, one
  simple mouth). Review each figure against the rig its tier names: a §2e foreground figure against the
  FULL rig (a prominent figure rendered on the simplified crowd rig is a FAIL), crowd figures against the
  crowd rig. Style/proportions/period never switch.
- Generate the scene, move it to `assets/scenes/<shot-id>.png`, and record `{shot_id, file, technique,
  seeds, flagged: false, verified: {scene: false, rig: false}, notes}` in `assets/scenes/manifest.json`
  (skipped shots get a `skipped` entry). `verified` starts false and is stamped true only by the batched
  review below (a scene is NOT shippable until then) — `flagged` and `verified` are both set there.
  **`verified` is the render gate:** `render-builder` treats a scene present on disk but with
  `verified.scene`/`verified.rig` != true as NOT shippable (`render.py::resolve_scene_files`), so an
  unstamped scene hard-errors the render exactly like a missing one.
- **Shorts:** same walk per short's `shots[]` (+ its `first_frame`), aspect `9:16`, files
  `scenes/<short-file-stem>-<shot-id>.png`.
- **Thumbnail:** generate `thumbnail.primary` AND each challenger — `16:9`, files
  `scenes/thumbnail-primary.png` / `thumbnail-challenger-N.png`, from each `gen_prompt` —
  seed any locked CHARACTER it features (most are character-free artifact thumbnails → compose fully, no
  seed). Do NOT bake the `text_overlay` into the image — it's applied at publish. The batched review applies.

**Worked example (Poyais L22, "MacGregor commissioned a guidebook…").** Technique (b) — seed =
`library/macgregor-base.png` (the only locked identity); delta = the shot's `still_prompt` + "MacGregor
seated at the desk, centered; the guidebook held up in his hand, foreground right" — the London office
and the guidebook are described and composed in this gen. It ships into the batch, then the
batched review judges it — identity/rig (MacGregor held + on-rig, no nose/ears, outline, four-digit
hands, by looking at the full frame), fidelity (seated, centered, guidebook in hand — every fact
realized, nothing extra), and style (reads as the con being manufactured — its `ironic-counterpoint`
class, on-recipe flat-cel).

**Render handoff:** `render-builder` consumes `assets/scenes/` directly (**scenes mode**, auto-detected
via this pass's manifest) — each verified PNG becomes its shot's visual in the MP4, and a missing scene
for an ai-gen/hybrid shot is a render-time hard error. The skipped sources (chart/screencap/stock) fall
back to the render's inline path, counted in its manifest.

**Layered shots (from `shots.motion.json`).** When the `motion-planner` output exists, each shot it marks
with `layers[]` is materialized into the fixed layout the engine reads (schema: render-builder
`references/shots-motion-schema.md`):
- **plate** `plates/<id>.png` — **only for a shot that carries a `cutout` layer.** Gen
  `background.plate_prompt` (the scene MINUS the moved element), which must still read as a **complete**
  object — never a blank slot where the subtracted element was. A card-ONLY shot (engine layers, no
  cutout) does NOT get a `plates/` file — its number-subtracted background is a `scenes/<id>.png` (see the
  engine-layers bullet).
- **cutout layers** `cutouts/<id>-<layer>.png` — gen the layer's `cutout_prompt` on a plain plate, then
  `py -3 scripts/forge.py cutout` (rembg → alpha-harden → trim); human-QC on the hand crop. **Judge the
  matte by MEASUREMENT, not by looking** — alpha histogram + corners, and composite it over its real
  destination plate before calling a halo or a colour defect (bible §8).
- **engine layers** (`source: engine` — device cards) need no cutout asset; the engine draws the card
  itself. **But when a card REPLACES a baked number/label** in the scene (a stat/counter card standing in
  for a figure the still would otherwise render as garbled gen-text), generate the **number-subtracted
  background as a normal `scenes/<id>.png`** — the ordinary scene with that one number/label omitted, still
  a COMPLETE frame (never a blank hole where the number was). It is a scene, not a plate: a card-only shot
  (engine layer(s), NO `cutout` layer) has a `scenes/<id>.png` and NO `plates/<id>.png`. Only a
  cutout-bearing shot writes `plates/`.
- **Hybrid** (a `delta-chain` shot carrying a cutout layer — a discrete overlay like a FICTION stamp): do
  **not** bake a full delta scene and do **not** gen a plate — `background.plate` already points at the
  prior in-stage `scenes/<prior-id>.png` (reuse it); materialize **only** the overlay cutout. Net less gen.

The batched review below judges every generated plate + cutout the same as a scene.

## Reviewing the batch (ONE pass, after every scene is generated)

Generate all of Pass 2 first — **do not gate mid-run, and run no per-delta diff-gate.** When the
batch is complete, run ONE review round over the whole thing, then regen only what is genuinely wrong.

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
   idealized pure-round-head/articulated-finger rig. Look at the **FULL frame; never crop hands, never
   grind a per-hand count.** Silence on a seeded frame (or a §2e foreground figure) is not allowed; each
   gets an explicit per-invariant ruling.
2. **Fidelity** — does each image assert **exactly the shot's load-bearing facts** (layout, geography,
   orientation / who faces whom, gesture + highlight targets, casting/costume) and **nothing extra that
   changes the read**? VPW authors prompts as checkable facts precisely so this has teeth; check the
   claims one by one against the pixels.
3. **Style/taste** — does it read as its `beat` and `shot_class` at a glance, on-recipe (flat-cel 2.5D,
   built-but-flat, marker-honest per §6) **AND rich — committed scene palette, fore/mid/background depth,
   light/atmosphere, filled edge-to-edge (the "gold" bar, bible §6)** — or is it slop: generic, cluttered,
   off-register, drifting to the detailed middle, **or thin/sparse/basic (a lone object on dead air, no
   palette or depth commitment — the "looks like flat pixel-art" failure)**?

Each returns a **flagged list keyed by shot id** — one sentence per defect, quoting the offending
fact. **Merge the three lists.** A frame no agent flagged ships as-is.

**Fix flagged frames — ONE re-authored retry, then surface:**
- **Exactly ONE auto-retry per frame.** Not two, not a ladder.
- **The retry is a FRESH gen off a RE-AUTHORED prompt — never prompt-accretion.** Do NOT append the
  flag onto the failed delta ("…and make sure the hand has four digits") and re-fire; that keeps the
  logic that just failed and stacks a patch on top of it. Instead **change the prompt logic**: rethink
  how the frame is described (a different composition strategy, a different phrasing of the load-bearing
  fact, a different emphasis), then generate clean. Seed from the canonical, not from the failed frame.
- **Self-check only the flagged points** on the new frame by looking at it — do NOT re-dispatch the
  review agents, do NOT re-review the whole batch.
- **Still failing after that one retry → STOP.** Keep the best attempt, mark it `flagged` in
  `assets/scenes/manifest.json` with the reason, and **surface it in the deliverable** (the human
  artifact) — the human decides. No third attempt, no technique-switch escalation ladder. A systematic
  failure (the same invariant missing both times) that looks like a bible value being off → surface a
  proposed fix, never self-apply, and keep forging the rest.
- **Stamp the gate.** After the batch settles, write each shot's manifest entry: a scene that ends with
  NO identity/rig flag AND no fidelity/style flag → `verified: {scene: true, rig: true}`, `flagged: false`.
  A scene still flagged after its one retry → keep `flagged: true` and leave `verified.scene`/`verified.rig`
  **false on the axis that failed** (an identity/rig flag → `rig: false`; a fidelity/style flag → `scene:
  false`). Only a fully-passed shot is `{scene: true, rig: true}`. This stamp IS what unblocks
  render-builder's gate — a shipped-but-unstamped manifest rejects every scene.

## Single-asset loop (one-offs, cast extension, library building)

1. `lookup` the registry — a hit means hand back the file, done.
2. Pick the seed by bible §5: existing character → its canonical `base`; **"iterate on THIS"** → that
   exact approved frame as seed, change ONLY the one requested variable; new character → the template
   base + new head tone (§4); environment/prop → style-only mode.
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
their reason** — the human review is the final authority (the user can't see them inline). No hand crops.

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
