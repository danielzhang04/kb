---
name: image-generation
description: Generates all verified, on-style images for a channel with a locked style bible — full visual production for a video, plus one-off assets (characters, poses, environments, props). Use for "do the image generation", generating visuals/B-roll frames, building a video's asset library, or single-asset requests like "give me this one but ___". Reads shots.json + style-bible.md + registry.json + refs/. Do NOT use it to plan shots (visual-prompt-writer), lock a new style, write scripts, or assemble video (render-builder).
---

# image-generation

Turns a video's `shots.json` — or a one-off request — into **verified, on-model** PNGs. `scripts/forge.py` does the
mechanics (`py -3`); **you own the judgment**: resolve the asset list, choose reuse-vs-generate, pick technique and
seeds per scene, review every frame, register only what passed. Accuracy comes from **seed-from-reference + one
batched review**, not one clever prompt; the single engine (`gemini-3-pro-image`, no tiers) is stochastic, so the
review is the guarantee.

**The channel's `style-bible.md` is the LOOK law; this skill is the procedure.** Read it every session: §1 identity +
seeded/crowd tiers, §2–§2d descriptors, **§3 rig checklist**, §4 colour, §5 recipe + lettering/stamp registers, §6
registry. Its values are human-editable law — **never silently change one mid-run**; surface a proposed edit and keep
forging non-dependent assets. **Log as you generate — files are the memory:** every round records, while it runs,
what the file is, its seed(s) + mode + delta, why, the verdict (shipped / flagged / rejected), and any ID needed to
recreate the pick. The manifests below ARE that log; a round with no manifest (a one-off, a candidate batch, library
building) gets a `<thing>-lab.md` beside the frames. Name outputs descriptively, never `a3_v3.png`.

## Mode selection

**A video** (a `shots.json` exists) → **Pass 1 → Pass 2 → the batched review**, in that order. **A one-off** (new
expression/pose/prop/cast member, "iterate on this frame", library building) → the **single-asset loop**.

**The Pass-1 / Pass-2 split — load-bearing.** Pass 1 locks the video's **recurring identifiable people and objects**
(named CHARACTERS, GROUPS, PROPS): each is a portable identity, so an isolated clean canonical is the right anchor to
seed from. **Environments, plates, one-off props and *anonymous* crowds are never pre-generated as portable
canonicals** — not portable, different faces each time, both fighting a pre-baked frame. That is a statement about
WHERE they are drawn, never about whether they are ruled on: each is still listed at the Pass-1 gate and each still
carries a review record before its pixels seed anything (step 1, step 3). They compose inside their own scene's gen in Pass 2:
**within a stage**, a held set carries by seeding its delta's in-chain parent frame; **across a place**,
continuity carries by seeding the place's derived plate (§Seed law, below) — never a freshly re-authored
plate.

## Pass 1 — resolve the asset list, gate it, build it, tag it

Output: `assets/library/` + `manifest.json`, plus the per-shot asset tags Pass 2 reads.

1. **Resolve the list.** Walk `long_form.shots`, every short's `shots[]` (+ its `first_frame`) and the thumbnail
   prompts. VPW names each figure, pose, expression and recurring prop **inline in the `still_prompt` as backticked
   registry vocabulary**; resolve every name against `registry.json` and the video's library, recording its kind
   (character | group | prop | pose | expression | interaction), the shot ids needing it, and the satisfying file.
   - A **named character** earns a slot even for one shot — free-drawn in a scene it falls off the rig. So does a
     **figure inside diegetic media** (a brochure figure, portrait, poster), in its registry-pinned costume unless
     the shot authored a change. A **group**'s canonical is a group frame (N members together, matching outfits)
     locking member count, costume, look and rig, no pose/expression; a member who ever acts alone is promoted to
     its own slot. A **recurring identifiable prop** — an object across shots whose look must MATCH — gets ONE
     canonical (`assets/library/prop-<name>.png`, prefix required) seeding every appearance, no pose/expression.
   - A **place plate** (the frame that establishes a place and seeds every later shot in it), an **environment
     reference**, the video's **crowd exemplar** and a **one-off prop** each earn a slot too — not because they are
     pre-generated as portable canonicals (they are not; see the Pass-1/Pass-2 split above), but because their
     PIXELS seed other scenes, and nothing seeds a scene on a ruling nobody made. A **pose / expression /
     interaction primitive** the shots name is listed on the same terms.
   - The ONE exemption: a **named cast member minted through the standard cast-generation wave from the asset base**
     needs no per-item human slot of its own — its own canonical is trusted (G2 ruling, 2026-08-12); everything it is
     seeded WITH (pose, expression, plate, prop) is still listed here.
2. **HUMAN PRE-GEN APPROVAL — the gate. STOP.** List every asset the registry and library LACK, each with the shots
   needing it and one line of what it would draw. **Generate nothing until the human rules.** Approved → build it.
   **Vetoed → never re-request it and never improvise it inside a scene: flag the beat back to
   `visual-prompt-writer` to restage against what exists.**
3. **Reuse before regenerate.** `forge.py lookup --kit <kit> --character <c> --tag <tag>` (or read `registry.json`);
   a hit is recorded `reused`, no generation. **A hit still needs a PASSING review record for the bytes on disk** —
   an all-pass, digest-current entry in `<kit>/_staging/review.json` — whatever the asset's class is: card, plate,
   environment, prop, crowd exemplar or primitive. A frame nobody ruled on, one that failed an invariant, and one
   re-minted since it was ruled on are the same answer: `forge.py batch` refuses it, `build_review_artifact.py`
   boards it, `stamp_review.py --figures` records the ruling, and only then does it seed.
4. **Build the missing — base-then-fan-out.** The canonical `base` is generated, approved and verified FIRST; only
   then fan out, each frame seeded off it (an unverified base multiplies its drift across every child).
   - **New cast member:** `--mode new_character` seeded off the template base for line, render and proportion only,
     plus a new head tone (§4) and identity. Head shape follows CONTENT, not the shape word, so a detail-rich
     character also needs an **anti-realism clause** ("flat stylized cartoon skull — no jaw, no cheekbones, no
     realistic face structure"). A **variant** is anchored iteration instead: seed its canonical, change only the
     variant trait, save `<name>--<variant>`.
   - **Pose / angle / grip / interaction primitives:** on the base, `2:3`, holding the base **NEUTRAL face** — a
     baked-in expression is a build reject (sole exception: a pose whose own hand occludes the face). A **grip**
     stores the grip with a generic grey placeholder object. An **interaction template** is two blank base mannequins
     carrying clasp geometry + eye-line; **eye-line is PUPILS-only** (a turned head grows a nose and jaw), contact
     interactions only.
   - **Expression frames** are authored **moderate**: the scene gen copies their eye/brow/mouth shape directly, so a
     frame flat on its own lands flat in the scene; the big end is for a real comedic peak.
   - **Prop / group / plate:** `--mode environment`/`style`; a new root uses the bible's §2b descriptor,
     while any established identity/continuity input stays seeded (Pass 2's seed law). Kebab-case
     names; batch what you can (`--batch <file.json>`, items `{name, character, mode, delta, aspect, seed?, figures?,
     stage_role?, image_size?}`);
     `forge.py gen` stages into `<kit>/_staging/`. Standing-library build order (most-reused first): expressions →
     concept props → diegetic screen devices → environment plates → secondary cast → action poses.
5. **Verify** every staged asset against **bible §3** by looking at it (inline — Pass 1 is a handful of frames). Pass
   → `register` FIRST if it is being promoted to the channel (register consumes staging → `refs/`), then copy into
   `assets/library/`; otherwise straight to the library. Fail → **ONE re-authored retry**, then surface it flagged.
   Register any character likely to recur later. **No cross-video environment lock exists (fix 2):** a place lives
   only inside the video that mints it. A NON-character OBJECT recurring across MANY videos (a ship, a period
   device) is a recurring PROP — `register` with `kind: "prop"` under `refs/env/`, seeded by every later use
   exactly like `prop-beige-pc`/`prop-drive` — never `"environment": true`, which is reserved for the two
   register exemplars (lettering, stamp hands).
6. **Write `assets/library/manifest.json`:** `{video_slug, generated, assets: [{name, kind, file, source:
   reused|generated, seed: [<frames used>], shots: [<shot ids>], notes}]}`.
7. **Write the asset tags into `shots.json`.** Each shot gains `"assets": {"<vocab name>": "<file path>", …}` — every
   character, group, prop, pose and expression its prose named, resolved to a file. **Pass 2 reads only the tags**,
   never re-resolves prose. The tags are image-gen-owned; `lint_shots.py` and the render engine ignore them, so
   writing them cannot break a lint or a render.

## Pass 2 — scene generation

Walk `long_form.shots` in order, then shorts, then the thumbnail. Each scene is a **complete image generated in ONE
run**, multi-seeding all its inputs at once → `assets/scenes/<shot-id>.png` + `manifest.json`.

**Seed roles are structural and describe the final deduplicated provider parts in actual order.** For a fresh base,
STEP-1 owns each figure and the place owns continuity. For a delta, seed the in-chain parent then each held figure's
canonical; add a raw pose/expression primitive only through the image-generation-owned batch declaration
`delta_primitives: {"<character>": ["<primitive>"]}` after that exact route proved necessary. It must bind one
primitive already authored for that cast member. Forge rebuilds and preflights ordinal role prose after every merge;
every seeded composite, including a direct spec, must carry ordered `{path, role, character}` truth.

| Seed law | The rule, and why it is not negotiable |
| --- | --- |
| **Cap: ≤4 seeds per gen** | canonical + ONE pose primitive + ONE expression frame + one anchor/exemplar. Past four, dilution weakens every prior; a `base.png` added as an Nth "rig anchor" pins nothing. A figure that needs the base rig spends one of the four on it. |
| **Attribute routing** | Base-derived seeds are bald, cream, neutral-faced and hoodied, so **any attribute not sourced from the CHARACTER seed bleeds a base trait**. CHARACTER seed → identity, head/skin tone, hair + facial hair, costume, face. POSE / interaction-template seed (geometry only) → body pose, hands, clasp geometry, placement, eye-line. EXPRESSION seed (shape only) → eye/brow/mouth shape, never tone, hairline or identity. Every skin patch, **including both hands**, renders in the CHARACTER's head tone. Expression is the SOFTEST seed and can land weak — the review checks register per beat. |
| **Exposed hands are seeded, never free-drawn** | A salute, wave, open palm or point is the five-finger drift point: seed the matching pose frame AND state the digit fact in the delta. No library pose covers it → that was a Pass-1 gate item, not an ad-hoc scene invention. |
| **Place/plate seed law; image seeds are continuity only** | Forge states the LOOK in exactly TWO voices per scene request — the bible's §2b descriptor at the HEAD and the file's `global_prompt_suffix` at the TAIL — and generates no third. Zero-seed is legal ONLY for a derived place plate (the first-in-file generated shot of a qualifying place with no seeded figures — forge skips any shot whose `source` is outside `ai-gen`\|`hybrid` before picking it, same as lint's `place_groups`) or a no-place root — symbolic/abstract/standalone-object-insert shot classes, a short's `first_frame`, and the thumbnail never declare `place`. Every OTHER in-place shot seeds its own place's first approved frame; delta/chain/anchored scenes keep their continuity seeds and digest pins, and identity seeds remain mandatory. **Cross-place image seeding is a hard refusal**, never an authoring option: a `place_anchor` (or derived place seed) whose source shot's `place` differs from the consuming shot's is the probe-refuted style-anchor failure under another name (2026-08-04, probes F/G). The §5 scene style tile is the ONE registered image style anchor (a content-thin register exemplar, derived by forge onto cast-free gens); no other exists, and a narrative scene from another place is the probe-refuted failure. **"Plate" here is the PLACE plate — a whole shot, the place's first approved frame. The layered-shot plate (`plates/<id>.png`, §Layered shots) is a different object: a subtraction from one scene, not a place's establishing frame.** |
| **Never seed off a downstream derivative** | Trace back to the exact frame the human approved; an "improved" copy can carry silent drift that then propagates as the lock. Exceptions: a delta-chain frame seeding its in-chain parent, and a re-base in the SAME location seeding the prior stage's base frame. |
| **A rig FIX never seeds the defective frame** | Regen FRESH from canonicals off a re-authored prompt — the defect lives in the strongest seed and rides it back about half the time. The only defective-seed exceptions are an authored delta-chain parent and a human-ordered framing hold, and BOTH are re-ruled by the next fresh-eyes pass at ordinary viewing scale, like every other frame. **`crop_battery.py` is RETIRED** — no review procedure calls it and no verdict depends on it (2026-08-03 ruling: "I don't need a super crazy review process… it just burns time"). The file stays on disk as a historical tool only. |
| **Match-prop** | A prop in more than one shot seeds its **first approved frame** as the prop canonical; later shots seed that exact frame and never re-describe the design in words. |
| **Maps are cropped, not regenerated** | A new region of an established map is a deterministic PIL crop; a regen invents a new coastline, palette and lettering hand. Regen only if the map canonical genuinely lacks the region, and then seed the map canonical + the parchment-map anchor. Borders and routes drawn onto the crop are motion layers. |
| **Crowd with one seeded lead** | The crowd starves the lead's costume: restate its pinned costume explicitly even though it is seeded, and give the crowd a contrasting uniform/palette. Every crowd-bearing gen also seeds the **crowd exemplar** (`refs/base/crowd-exemplar.png`), which is what pins crowd proportion and face. |

`place_anchor` is legal on any non-delta shot whose `place` is already established — not restricted to a
regenerated `base`. Author the human-approved video-local `assets/scenes/<frame>.png` frame; Forge resolves
links/junctions, verifies the frame is under that video's scenes AND carries the SAME `place` as the
anchoring shot, then seeds it instead of minting a new plate. A source frame from a different place is
refused (same-place law, above); a cross-video environment frame is never accepted.

**Aspect — pass it explicitly, every scene; NEVER 16:9 on a cutout.** Long-form scenes inherit
`long_form.aspect_ratio`, a short's `9:16`. `forge.py`'s default is portrait `2:3`, so 16:9 work MUST pass `--aspect
16:9` on every scene/plate gen — forget it and the scene generates portrait, silently mis-framed. A **CUTOUT is the
opposite**: wide squashes the object, so cutouts use `2:3` (or `4:3`/`3:2` for a naturally wide object); `forge.py
cutout` HARD-ERRORS on width/height ≥ 1.5 unless `--allow-wide`. **Resolution is the other engine dial:** `forge.py`
requests `imageSize: 1K` and takes `--image-size 1K|2K|4K` (or per-batch-item `image_size`). **1K is the DEFAULT
because it is the ERA REGISTER:** the poyais board this channel is judged against sent no `imageSize` at all (= 1K),
and at 2K the same "medium-thick" outline instruction renders a proportionally FINER stroke while the model spends
the extra budget on detail the era never had room for — a 2K run is not the same instrument. The cost is real and
accepted: 1K at 16:9 is ~1344×768, *below* the 1920×1080 delivery frame, so full scenes are upscaled at render
(the battery that zoomed into those pixels is retired — §Seed law). **4K is the top tier at
~6× the 1K price**, so it is a per-run spend call raised at the Pass-1 gate, never a silent default.

**Scope.** Generate stills only for `source: ai-gen` or the generated half of `hybrid`;
`chart|screencap|stock|archival` belong to other pipelines — skip and record `skipped: source=<x>`. Ignore motion and
stage fields and any unknown key. **ALL in-video text is diegetic**, quoted verbatim from the `still_prompt`, 1–4
words; **every text-bearing gen seeds the lettering exemplar** (`refs/env/lettering-marker-italic.png`), and every
stamp/seal/mark gen seeds the stamp exemplar **plus its destination plate** for scale and palette (§5).
**Every CAST-FREE gen seeds the scene style tile** (`refs/env/scene-style-tile.png`, §5) — forge DERIVES this and
the lettering exemplar from the frame itself (no figure in frame; a quoted literal), never from an authored field.
The tile is the pixel anchor for line register and palette on a frame with no cast to carry it, and its seed-role
prose grants it **nothing else** — not content, not layout, not the place it depicts. A figure-bearing gen does not
take it: its cast seeds already draw the register.

**Provider-text order is policy first, authored text last:** **[bible descriptor + generated seed-role/crowd/rig
policy] + [the shot's authored identity → scene → payload]**. The payload or exact replacement is literal final
provider text; no Forge clause follows it. This is an **amplifier fix pending controlled validation**, not an
established Class-A cure. **Anonymous-figure rig clauses are never written into a prompt.** The shot
DECLARES crowd presence in `figures` — `{"crowd": true}` — and forge expands the bible's §2d blockquote at gen
time when it is set. **Figures are NAMED CAST or CROWD; there is no third tier and no unseedable
foreground tier.** Named cast seeds from its Pass-1 canonical; crowd gets the §2d clause. An anonymous
foreground human does not exist: `shot_cast` never resolves the bare `` `base` `` rig as a figure, and
`seeding_law_violations` refuses a shot that casts it, by name.
`figures.anon_foreground` is a known-but-abolished key, refused by the same law with the same remedy —
cast the figure (an existing cast member where the story says it IS one, otherwise a NEW named cast member
minted through the standard cast-generation waves at VPW step 3a), or stage the beat as mass action
(crowd exemplar). A declared `figures` field also forces the §2c append; without it Forge adds no
anonymous-figure clause. The authored delta
changes only the variables it names while the style policy remains binding. **Pre-flight a batch with `forge.py
gen --dry-run`**: it prints every assembled prompt and resolves every seed with zero API calls — read the prompts
before paying for the batch.

**Batch specs come from `forge.py batch --batch <shots.json> --out <spec.json>`; a hand-rolled per-run batch script
is not a supported input.** It builds one deterministic slate per shot from the shot's own `assets` tags and
`figures`, orchestrates the two steps below, **reuses an existing step-1 figure frame before generating one — but only
one carrying an all-pass, digest-current review record** (the C-6 gate, §Reviewing the run), records
every slate decision on the item (`why`) and on stdout, and **never truncates**. Over the cap, displacement runs an
**ORDERED, one-drop-at-a-time** walk — (1) crowd exemplar, when the place plate carries the rear mass; (2)
interaction template, whose contact geometry survives in the shot's own prose and in the two named figures' own
STEP-1 cards; (3) a tagged prop, since the prompt already names it and forge's derived seed is a reinforcement, not
its only carrier — stopping the instant the slate fits, never dropping more than the overage requires. **Never
droppable, at any step:** the place plate/chain parent, the LOCKED §5 lettering exemplar, or any character STEP-1.
Every drop is recorded in `why` AND `assets_omitted` — the one displacement ledger, not a parallel one. If the slate
still exceeds the cap once that order is exhausted, it is a hard error naming the shot and the **true bind — cast
count against the cap** — never a locked seed, and never advice to restage with fewer cast (a mechanism steering a
casting decision, which the doctrine forbids); that count is the re-authoring input. The retry path
reuses the same builder, so a retry cannot invent a seed the original never had. Behind it, **the SEEDING LAW is
structural in `forge.py` and no caller can opt out**: a gen that cannot inherit a named figure's rig — a step-1 frame
when fresh, the canonical plus an in-chain parent when a delta — hard-errors before the API call, at $0.

### Builder-owned retry overlays

An approved surgical retry is authored as a versioned `forge-retry-overlay@2` JSON manifest and passed to
`forge.py batch --retry <manifest>` with the canonical `shots.json`. It never edits `shots.json` or a generated
batch: each entry names its canonical `shot`, a distinct safe output `name`, and is rebuilt by forge before its
overlay applies. The envelope is `{schema, video_slug, entries}`; unknown keys are hard errors.

- A `scene` entry has `{kind: "scene", shot, name, defect, replace?, prepend_seeds?, extra_seeds?}` and exactly ONE authority:
  an exact `{from, to}` replacement occurring once in the canonical authored payload, or a seed/mechanism swap with
  no content append. `defect` is `content`, `seed`, or `mechanism`; `expression` is rejected here and routes to
  STEP-1. A seed/mechanism swap must reorder an existing provider part or name-replace its in-chain parent; an
  unrelated addition is not a swap. `instruction` is forbidden for scene retries; Forge preserves every byte outside
  the replaced span, then rebuilds and preflights roles from the final merge/dedup. Each seed is a relative string or the narrow
  `{path, sha256?}` object; a supplied `sha256` is a lowercase SHA-256 digest required at preflight and again on the
  exact bytes read into a live provider request. A live exact-read mismatch aborts the remaining batch at non-zero
  status after releasing its reservation; it is an integrity failure, unlike an ordinary per-item provider error.
  Seeds are resolved existing files contained in this video or its kit,
  prepended/appended in that order, then re-run through the normal cap and seeding law. A retry is fresh: its name
  cannot equal its shot or collide with staging/library/scenes, and it cannot seed an old scene output.
- A `step1` entry has `{kind: "step1", shot, character, name, defect, instruction?}`, where `defect` is `expression`
  or `rig`. Forge derives that named cast
  member's canonical + pose + expression recipe from the specified canonical shot and emits only that distinct STEP-1
  request; it never emits the source scene or another cast member. The optional instruction is appended to the
  reference-sheet delta.

Use `batch` only to build the final retry slate, then `gen --dry-run` to inspect it; the dry run prints the retry
authority and `changed_spans: 1`. Both stay $0; a live `gen`
without `--force` cannot overwrite a staged survivor, and retry-overlay collision checks reject such a request before
the generator sees it. Live forge reserves each target with an exclusive PID-owned sidecar before calling the provider,
then atomically publishes a complete PNG without replacing a concurrent survivor; failed calls clean their lock and
temporary output. A later run reclaims a recorded lock immediately only when its owner PID is dead (legacy/unreadable
or ownerless locks retain the one-hour fallback lease); a valid live PID is never reclaimed by timestamp, so a killed
worker does not block the next retry behind the transport ceiling without risking a live concurrent owner.

Per shot, pick the **cheapest technique that holds the locked elements**:

| Technique | When | How |
| --- | --- | --- |
| **(a) Reuse / reframe** | an on-disk frame already IS this shot | copy it to `scenes/<shot-id>.png`; manifest notes source + intended framing. No gen. |
| **(b) Seeded composition** (default with characters) | locked character(s) in a composed environment | ONE gen, `--mode environment`, multi-seeding the shot's tagged figure frames plus any true continuity/place input. Delta = the `still_prompt`'s scene/placement facts only; pose, expression, hands and tone route by seed |
| **(c) Character-free scene** | a map, an empty plate, an object | ONE `--mode environment`/`style` gen; a root may be zero-seed under the bible descriptor + style suffix, while a chain/anchored request keeps its continuity seed |
| **(d) One-shot single-character** | a simple shot, one prominent character | single gen `--mode identity` seeding that character's canonical (+ its expression/pose frames); full rig check still applies |
| **(e) Seeded delta-chain** (a held STAGE) | consecutive shots sharing a `stage` id where the change is INTEGRATIVE | the `base` uses (b)/(c)/(d); each `delta` seeds the PREVIOUS in-stage frame and changes ONLY that shot's `changed_elements`; **≤2 deltas**, then re-base or hard-cut |

**The BOUNDARY rule.** **DELTA-CHAIN when the change is INTEGRATIVE** (the element joins the scene's architecture):
technique (e), one element per delta, the carry-over holding the set. A **re-base inside the SAME location** seeds the
prior stage's BASE frame, never a fresh canonical, which would return a visibly different place. A **delta that
REMOVES a transient element seeds the pre-transient ancestor**, since the immediate predecessor drags it back.
**LAYER when the change is DISCRETE** (a character enters, a stamp slams onto a page): keep the plate, composite a
seeded cutout. Art style, proportions and period never switch mid-chain.

- **Two-step figure seeding — how a FRESH seeded-figure shot runs, and the only way it may.** The two-gen identity
  ladder (gen A composes the scene, gen B re-composes identity onto it) is **RETIRED**: a step-2 gen never
  re-composes identity from words, so the ladder's reason to exist is gone. **STEP 1** runs the unchanged seeding
  recipe — canonical + pose frame + expression frame — **in isolation**, no scene content, into one portable
  per-video figure frame (`fig-<character>--<pose>--<expression>`, the video's own asset, never channel `refs/`).
  Every card is a named character's, and its costume is pinned in its own canonical, so the key carries no
  dress dimension. (`forge.py::costume_clause` and `figure_card_payload`'s `costume` path — a clause derived
  from the minting shot's own prose — are RETAINED unreferenced for P8, which re-uses them to mint a card
  holding the beat's own act.)
  **STEP 2**, the scene gen, seeds `[step-1 figure(s)] > [the video's plate]` and never the raw triple again.
  Splitting the recipe out of the scene gen is the fix: scene complexity competing with rig-hold inside one call is
  what throws a figure off rig. A **delta beat is single-step:** in-chain parent first, then each held figure's
  canonical. Omit raw primitives unless `delta_primitives` names the proved mechanism for that same figure's one
  change; an expression defect re-mints STEP-1 instead of opposing its seed with scene prose.
- **De-nose / de-ear fix — a targeted identity pass budgeted for TWO gens.** Seed `[current frame + base-rig
  exemplar]`, change ONLY the faces; the engine re-draws a sticky ear or residual nose about half the time, so the
  reliable shape is a **SECOND targeted pass seeded off the already-fixed frame**. A fix TECHNIQUE, not a loosening
  of the one-retry rule. **Re-authoring an expression frame** invalidates only the scenes seeded from it — re-author,
  human-gate, regen those; never ship a video mixing old- and new-register faces.
- Record `{shot_id, file, technique, seeds, flagged: false, review_status: "unreviewed", parked_reasons: [],
  retry_cause: null, parent_depth, lineage, notes}` in `assets/scenes/manifest.json` (skipped shots get a `skipped`
  entry); `review_status` is set ONLY by `stamp_review.py`. **`parent_depth` / `lineage` are C-11's provenance
  ledger and are COPIED from the `batch` spec item, never re-derived by eye** — `parent_depth` counts image-parent
  hops back to the frame that started the chain, `lineage` counts hops back to the nearest APPROVED frame (it resets
  to 1 under a `verified` parent and keeps climbing while a chain runs on pixels no human has ruled on, so a drifting
  chain is visible in the manifest). Emit the manifest with `py -3 .../forge.py manifest --kind scenes --batch
  <entries.json> --from-batch <the spec `batch` wrote> --to <video>/assets/scenes`: `--from-batch` copies both
  counters onto each entry (spec `name` == entry `shot_id`); an entry stating its own counters keeps them, and a
  present counter must be a non-negative hop count or forge refuses the manifest. **Shorts** repeat the walk per
  short's `shots[]` + `first_frame`, aspect `9:16`, files `scenes/<short-file-stem>-<shot-id>.png`.
- **Thumbnail:** `thumbnail.primary` AND each challenger at `16:9` into `assets/thumbs/`, seeding any locked CHARACTER
  featured; never bake `text_overlay` in (applied at publish). After the human picks a winner, `py -3
  .claude/skills/image-generation/scripts/finalize_thumbnail.py <picked.png> <video_dir>` center-crops to 16:9,
  LANCZOS-resizes to 1280x720 and writes `assets/thumbnail.png` — the file every downstream gate reads (it refuses
  to upscale a crop narrower than 640px, and is idempotent).

**Layered shots (from `shots.motion.json`).** Each shot `motion-planner` marks with a `cutout` `layers[]` is
materialized into the layout the engine reads (render-builder `references/shots-motion-schema.md`). The **plate**
`plates/<id>.png` is the scene MINUS the moved element, still reading as a **complete** object, never a blank slot.
**Two different objects share the word "plate": this LAYERED-SHOT plate is a subtraction from ONE shot's scene, while
a PLACE plate (§Seed law) is a whole shot — the place's first approved frame, the thing every later shot in that
place seeds.** Materializing "the plate" for a layered shot in an established place means the subtraction, never a
re-minted place frame.
**Cutout layers** `cutouts/<id>-<layer>.png` are **always seeded** — use the layer's own **`seed`** when the plan
names one (a reference path or a registry vocabulary name, resolved like any Pass-1 tag); otherwise fall back to the
character/prop canonical, or the destination plate (the video's own plate carries scene continuity; never add an
image only for style, and no separate cross-video `refs/env/` anchor exists). **The engine emits no alpha, so transparency
is always post-hoc keying** — the `cutout_prompt` describes the OBJECT ALONE, and YOU add the field here: gen it on a
**solid MAGENTA chroma field** (*"one solid uniform FLAT magenta background, NO glow, NO
gradient, NO vignette"*, since fringe and halo failures are generation-side glows), then `forge.py cutout` (rembg →
alpha-harden → trim). On a **hybrid** shot (a delta-chain frame carrying a cutout layer) do not bake a full delta
scene and do not gen a plate: `background.plate` already points at the prior in-stage frame, so materialize only the
overlay cutout. **Render handoff:** `render-builder` consumes `assets/scenes/` directly (scenes mode, auto-detected
via this pass's manifest); a missing scene for an ai-gen/hybrid shot is a render-time hard error.

## Reviewing the run (per ACT batch — generate, review, fix, then the next act)

Pass 2 runs in **contiguous batches whose COUNT is set by the run's gate cadence** (2–4 act batches on an ordinary
run, or a different count set by the run's own gate plan — e.g. five gated fifths) — the boundary rule is fixed
regardless of count: **a slice boundary always falls on a stage boundary, and a held stage never splits.** **Within
a batch, generate everything first — do not gate mid-batch —
then run the review round below on that batch and fix its flags before the next batch generates.** One whole-video
round finds a systemic defect (a bible value off, a bad seed route, palette drift) only after the entire budget is
spent, and a reviewer's eye decays across a 90-frame round; the act boundary is where systemics get caught cheap.
Two things carry forward between batches: **(a)** a defect class flagged **≥2** in a batch review → its surgical
prompt-fix is applied to the NEXT batch's assembled prompts before generating (a suspected bible-value defect is
still *surfaced*, never self-applied); **(b)** a **verified** frame from an earlier batch is a legal extra seed for a
scene-continuous shot in a later one, alongside its canonicals.

**The rules this review judges by are `style-bible.md` §3 — the exact values the generator
generated against**; there is no separate reviewer rulebook, and what lives here is the PROCEDURE. This is also the
ONLY seed-routing gate, so watch for what one-run multi-seeding produces: hands off the character's tone, a weak or
wrong expression, identity bleed between co-present figures.

**Run ONE fresh-eyes review pass per act batch** (not three concurrent subagent dispatches), given the scene files +
per shot its `still_prompt`, `vo_text` (the full narrated span — facts often live in the tail) and `shot_class`, plus
bible **§3**, the **§5 recipe** and the channel's `visual-grammar.md` (`vo_ref` is only the render timing anchor,
never a fidelity source). **End the pass with an `N/N covered` line** (shots ruled / shots in the batch) — a pass
that stops short reports exactly how short, never silently.

**The verdict rows are machine-emitted, not human-invented.** `build_review_artifact.py` pre-renders one empty
verdict row per (shot × applicable invariant), pre-filtered by what the shot actually declares — support/contact
only where a seated primitive is authored, place-owner only on branded interiors, relative-scale only on 2-cast
shots, crowd only where declared, flat-cel hazards on every shot whose pixels this pipeline generates or composites
(`source: ai-gen | hybrid`, and an absent `source` is `ai-gen` — only pure library reuse is exempt, since nothing
generated those pixels) — so cost moves from typing the row set to eyeing it, and
an aggregate "rig holds" sentence stays structurally impossible. **Canonical-vs-candidate comparison images render
only on named-figure shots**, at **ordinary viewing scale** — the zoomed crop battery is retired (§Seed law).

**The same pass also rules the batch's SEEDING ASSETS — this is what closes the reuse loop, and a run that skips it
hard-stops on the next batch.** `batch` refuses to seed from ANY asset that lacks an **all-pass, digest-current
review record** in the channel-wide store `<kit>/_staging/review.json` — STEP-1 card, place plate, environment
reference, prop, crowd exemplar, pose/expression primitive alike; an asset minted in slice N is seedable in
slice N+1 **only** because that slice's review recorded a verdict for it. (The one exemption stays the named cast
member's own canonical — Pass 1, step 1.) The loop, in order:

1. **Build the board with the staging dir**: `py -3 .../build_review_artifact.py --video <video-dir> --out
   <board.html> --staging <kit>/_staging [--assets <frame.png> ...]`. Alongside the scene cards it renders one card
   per STEP-1 figure forge would refuse (its refusal reason is the card's badge, and the pending list IS forge's own
   gate, so the two can never disagree). The other classes live outside staging, so forge's refusal prints each
   frame's path and you pass them to `--assets`; each is boarded through that same predicate and asked only the
   invariants its class can answer (no rig row on a plate). It writes an **asset-verdicts skeleton** to
   `<video>/assets/_review/figure-verdicts.json` (override with `--figures-out`) — pre-keyed by asset id with
   `canonical_sha256` already computed from the bytes on disk, and every verdict left EMPTY.
2. **The fresh-eyes pass rules those cards too**, on the same three axes, at the same ordinary viewing scale. Its
   scene rulings merge into `assets/_review/merged.json` as always; its ASSET rulings fill in the skeleton's
   verdicts (`"pass"` / `"fail"` per invariant — an asset needs every one to read `pass`).
3. **The ORCHESTRATOR records them, before the next batch generates**: `py -3 .../stamp_review.py --figures
   <figure-verdicts.json> <kit>/_staging`. Same single-writer law as the scene path — `stamp_review.py` is the ONLY
   writer of a verdict anywhere in this pipeline; the board writes only the skeleton, and forge only ever reads.

The record shape the store keeps, per asset id — the frame's FILE STEM
(`fig-<character>--<pose>--<expression>`, `prop-drive`, `L28`):
`{canonical_sha256, expression_sha256, verdicts: {"<invariant-slug>": "pass"|"fail", …}, reviewer, date}`. A
re-review of the same id REPLACES the record wholesale; ids absent from an input are untouched (additive merge).
**An asset with no record, with no per-invariant verdicts, with any `fail`, or whose `canonical_sha256` no
longer matches the bytes on disk is refused as a seed** — the refusal names which of the four it is; for a STEP-1
card it prints the builder invocation that re-mints it (delete the frame, re-run this same `batch --shots <id>`, `gen --batch` the
spec, review, stamp). **Never hand-mint a STEP-1 with `gen --seed a,b,c`:** the `gen` CLI can only build
`reference` seed roles, so the figure would be generated with role prose that lies about what each seed is for —
the exact root cause the truthful roles exist to remove. One minter, one truth.

The pass rules three axes together, per shot, at **ordinary viewing scale**:

1. **Identity/rig** — a **FORCED PASS/FAIL verdict on each §3 invariant**, never a silent pass, for **every seeded
   figure**, judged against the tier §3 assigns it (named cast → FULL rig, against that character's approved
   canonical, not an idealized rig; crowd → CROWD rig). A chain-delta frame adds a **held-set** line (set + identities
   consistent with this stage's `base`?).
   On any FAIL name the shot id and quote the offending pixel; a hand PASS is never worded as certified, because the
   human board is the final finger authority. **This FRESH-EYES review is the rig authority — a GENERATING agent's
   self-verification does NOT substitute for it** (a generator under-reports its own defects, anchored on the prompt
   it wrote). **Never downgrade a fresh-eyes nose/ear FAIL to "minor".**
2. **Fidelity** — does the image assert **exactly the shot's load-bearing facts** (layout, geography, orientation,
   gesture + highlight targets, casting/costume) and **nothing extra that changes the read**? A **lettering-bearing
   shot** additionally runs **DSG-lite**, scoped here to the one class it demonstrably earns (it caught L172's
   garbled stamp): **(a) one call decomposes** the **ASSEMBLED prompt** — what forge actually sent, which `gen
   --dry-run` prints — into its diegetic text items, each naming its `parent`; **(b) one multimodal call transcribes
   them LETTER-BY-LETTER** against the words the `still_prompt` quotes; a garbled, misspelled or partial render is
   **blocking** (§3 sets which text is legal). Log lettering items as `dsg: [{id, parent, q, verdict:
   pass|fail|skipped, note}]`; **`stamp_review.py` parks any shot carrying a failed item even when the axis
   severities came back clean**.
3. **Style/taste** — does it read as its `shot_class` at a glance, on-recipe per §5 **AND rich — committed scene
   palette, layered depth by overlap and scale (§5), light/atmosphere, filled edge-to-edge** — or is it slop: generic, cluttered,
   off-register, drifting to the detailed middle, thin, sparse? **Check expression register per beat** (§3).

Returns a **flagged list keyed by shot id**, one sentence per defect quoting the offending fact. A frame no axis
flagged ships as-is. **Then fix flagged frames — ONE re-authored retry, then surface:**

- **Exactly ONE auto-retry per frame.** Not two, not a ladder. **It is a FRESH gen off a SURGICALLY re-authored prompt
  — never prompt-accretion**: appending the flag onto the failed delta keeps the logic that just failed and stacks a
  patch on it, while re-writing the whole prompt discards every clause that rendered CORRECTLY and re-rolls the frame's
  passing half. **Rewrite only the clause(s) the flags name** — a failed `dsg` item points at the exact atomic fact —
  hold every other clause byte-identical, and generate clean off the canonical, not the failed frame. Tactics by
  defect: a **garbled literal** → spell it out inside that clause (*the word BRICKS — B, R, I, C, K, S*), still ≤4
  words; a **fact the composition buried** → exact-replace that one span with a changed composition strategy; a
  **rig defect** → the targeted identity / de-nose pass above. **Log the cause**
  on the manifest entry as `retry_cause` (the flag string that triggered it, plus which clause was rewritten), so a
  second failure reads as systematic rather than random.
- **After the single sanctioned content retry fails, STOP and root-cause VPW authoring → `shots.json` → exact Forge request before any new generation. The exhausted genlog row records `suspected_mechanism_layer` as `vpw_authoring`, `shots_json`, `seed_recipe`, `forge_assembly`, or `provider_limitation`, plus the failed invariant and exact retry authority. Re-rolling an unchanged mechanism is forbidden.**
- **Re-author HOW an authored fact is depicted, never WHETHER it appears.** Deleting or softening a load-bearing fact
  to dodge a rendering defect is a fidelity VIOLATION dressed as a fix; a fact that still won't render clean after the
  one retry is flagged for the human, never silently removed.
- **Sequencing replaces self-check — no agent ever clears its own park.** The retry above generates immediately; it
  is ruled by the **next act batch's fresh-eyes pass**, already running (a final mini-pass rules the last batch's
  retries, since there is no next batch to piggyback on). **Still flagged by that ruling → STOP:** keep the best
  attempt, mark it `flagged` in `assets/scenes/manifest.json` with the reason, surface it in the deliverable. A
  systematic failure (the same invariant missing both times) that looks like a bible value being off → surface a
  proposed fix, never self-apply.
- **Stamp the gate — generating agents NEVER stamp; the ORCHESTRATOR alone does**, and only after the fresh-eyes
  pass. It merges the pass's structured verdict into `assets/_review/merged.json` (one ruling per shot id, per-axis
  severities + `why`, plus any lettering shot's `dsg` checklist), then runs `py -3
  .claude/skills/image-generation/scripts/stamp_review.py <video_dir>` — the **ONLY writer** of the render gate's
  verdict. It writes **`review_status` + `parked_reasons`** onto each `scenes/manifest.json` entry in three honest
  states: **`verified`** (a fully-clean ruling on every axis AND no failed `dsg` item — the ONLY state render-builder
  ships), **`parked`** (ANY defect ruling, even LOW, or any failed `dsg` item: reviewed, defects known, honestly not
  shippable — its defect strings become
  `parked_reasons`, which the gate prints, and the entry hard-errors the render), **`unreviewed`** (no ruling covered
  the shot — hard-errors like a missing scene). Uncovered entries are untouched; it never writes a `verified: true`.
  **The same orchestrator step also records the batch's FIGURE verdicts** (`stamp_review.py --figures
  <figure-verdicts.json> <kit>/_staging`, the loop above) — run it before the next batch generates, or every STEP-1
  the next batch would reuse is refused.

## Prove it by measurement, never by eye

- **Anchored iteration ("iterate on THIS")** pins the exact approved frame as the seed, restates the descriptor and
  changes ONLY the requested variable — then **proves the change landed with Pillow**. Seeded gen is sticky: a worded
  delta on a small detail is often **silently ignored**, so compute the **mean-abs-diff** (0 = identical) and sample
  the changed region; near-zero means ignored, not subtle. Then **escalate the MECHANISM instead of re-wording** —
  open or replace the pose so the feature is unambiguous, mask and regenerate that region, or restate the subject.
- **A matte, a colour or a geometry is a measurement, not an opinion.** Reach for Pillow before a verdict: the **alpha
  histogram + corner pixels**, the disputed **pixel against its canonical's value**, **tilt from the alpha bbox** —
  and **composite over the ACTUAL destination plate**, never a neutral field (a defect invisible on cream is glaring
  on green). **Matte verification samples the ENCLOSED INTERIOR regions** (letter counters, rigging gaps, frame
  holes), not only silhouette and corners — rembg keeps opaque pale interior holes.
- A relaxed or half-closed feature (a closed hand) is ambiguous — never assert a digit count off one. Where engine
  variance is the constraint, generate a small **candidate batch and pick** instead of re-rolling one prompt serially.

## Single-asset loop (one-offs, cast extension, library building)

1. `lookup` the registry — a hit means hand back the file, done.
2. Pick the seed: existing character → its canonical; **"iterate on THIS"** → that exact approved frame, changing ONLY
   the one requested variable; new character → the template base + a new head tone (§4); environment/prop → style-only
   mode with the bible's §2b descriptor + the style suffix, seeding only a real canonical/continuity input; a pose/expression primitive
   → the base, neutral face, `2:3`.
3. `gen` into staging → **check bible §3** by looking at it → **ONE re-authored retry**, then flag + surface. Record
   the round (seed, mode, delta, settings, verdict) in a notes file beside the frames, then `register` what passed
   (`--batch` for many; environments add `"environment": true`) — staging → `refs/`, indexed in the registry.

## Report

What shipped (library counts, scenes by technique), what was reused, what the review caught per category and what it
regenerated, any frames still **flagged** after the one retry (with their reason), anything escalated for approval,
and the render-wiring caveat. Publish the images via an Artifact link — full frames, flagged ones marked with their
reason, and each batch's **`N/N covered`** line, so the human finger gate rules on the same full frames the
fresh-eyes pass judged, at seconds per shot.

**Present it neutrally — the human calibrates the bar, not you.** Never declare the output "works" or "clears the
bar": the bar is the reference grade the human holds, and a premature success claim skips real problems and burns
iterations. **Name the batch's weaknesses FIRST.** On a rejection, **diagnose the root cause honestly instead of
defending the work** — the true diagnoses are usually structural (figures at the wrong scale against their plate read
as paper-doll stickers; shots labelled non-literal that still draw the sentence literally).

## Not this skill

Planning the shots (`visual-prompt-writer` owns `shots.json`) · locking a brand-new channel style · writing scripts ·
assembling the video (`render-builder`).
