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
cast/crowd tiers, §2–§2e descriptors, **§3 rig checklist**, §4 colour, §5 recipe + lettering/stamp registers, §6
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
seed from. **Environments, plates, one-off props and *anonymous* crowds are never pre-generated** — not portable,
different faces each time, both fighting a pre-baked frame. They compose inside their own scene's gen in Pass 2, and
a held set carries by seeding the prior frame, never a plate.

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
   - Environments, plates, one-off props and anonymous crowds get NO slot.
2. **HUMAN PRE-GEN APPROVAL — the gate. STOP.** List every asset the registry and library LACK, each with the shots
   needing it and one line of what it would draw. **Generate nothing until the human rules.** Approved → build it.
   **Vetoed → never re-request it and never improvise it inside a scene: flag the beat back to
   `visual-prompt-writer` to restage against what exists.**
3. **Reuse before regenerate.** `forge.py lookup --kit <kit> --character <c> --tag <tag>` (or read `registry.json`);
   a hit is recorded `reused`, no generation.
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
   - **Prop / group / plate:** `--mode environment`/`style`; a new root uses forge's hardened scene descriptor,
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
| **Hardened scene descriptor; image seeds are continuity only** | Forge appends ONE hardened flat-cel/palette block to every scene request. A root with no chain parent and no `place_anchor` may run with zero image seeds; delta/chain/anchored scenes keep their continuity seeds and digest pins, and identity seeds remain mandatory. No image style anchor: hardened text was the probe winner, while a rendered-scene anchor catastrophically bled content (2026-08-04, probes F/G). |
| **Never seed off a downstream derivative** | Trace back to the exact frame the human approved; an "improved" copy can carry silent drift that then propagates as the lock. Exceptions: a delta-chain frame seeding its in-chain parent, and a re-base in the SAME location seeding the prior stage's base frame. |
| **A rig FIX never seeds the defective frame** | Regen FRESH from canonicals off a re-authored prompt — the defect lives in the strongest seed and rides it back about half the time. The only defective-seed exceptions are an authored delta-chain parent and a human-ordered framing hold, and BOTH require a before/after crop diff on EVERY figure in the frame. |
| **Match-prop** | A prop in more than one shot seeds its **first approved frame** as the prop canonical; later shots seed that exact frame and never re-describe the design in words. |
| **Maps are cropped, not regenerated** | A new region of an established map is a deterministic PIL crop; a regen invents a new coastline, palette and lettering hand. Regen only if the map canonical genuinely lacks the region, and then seed the map canonical + the parchment-map anchor. Borders and routes drawn onto the crop are motion layers. |
| **Crowd with one seeded lead** | The crowd starves the lead's costume: restate its pinned costume explicitly even though it is seeded, and give the crowd a contrasting uniform/palette. Every crowd-bearing gen also seeds the **crowd exemplar** (`refs/base/crowd-exemplar.png`), which is what pins crowd proportion and face. |

For a human-approved place that must survive a regenerated base composite, author its video-local
`assets/scenes/<frame>.png` as `place_anchor`. Forge resolves links/junctions before verifying the frame
is under that video's scenes, then seeds it instead of minting a new `plate`; it never accepts a cross-video environment frame.

**Aspect — pass it explicitly, every scene; NEVER 16:9 on a cutout.** Long-form scenes inherit
`long_form.aspect_ratio`, a short's `9:16`. `forge.py`'s default is portrait `2:3`, so 16:9 work MUST pass `--aspect
16:9` on every scene/plate gen — forget it and the scene generates portrait, silently mis-framed. A **CUTOUT is the
opposite**: wide squashes the object, so cutouts use `2:3` (or `4:3`/`3:2` for a naturally wide object); `forge.py
cutout` HARD-ERRORS on width/height ≥ 1.5 unless `--allow-wide`. **Resolution is the other engine dial:** `forge.py`
requests `imageSize: 2K` and takes `--image-size 1K|2K|4K` (or per-batch-item `image_size`). Leaving it unset — the
state of every gen before 2026-07-29 — takes the engine default **1K**, which is *below* the 1920×1080 delivery frame,
so full scenes were upscaled at render and the crop battery zoomed into interpolated pixels. **4K is the top tier at
~6× the 1K price**, so it is a per-run spend call raised at the Pass-1 gate, never a silent default.

**Scope.** Generate stills only for `source: ai-gen` or the generated half of `hybrid`;
`chart|screencap|stock|archival` belong to other pipelines — skip and record `skipped: source=<x>`. Ignore motion and
stage fields and any unknown key. **ALL in-video text is diegetic**, quoted verbatim from the `still_prompt`, 1–4
words; **every text-bearing gen seeds the lettering exemplar** (`refs/env/lettering-marker-italic.png`), and every
stamp/seal/mark gen seeds the stamp exemplar **plus its destination plate** for scale and palette (§5).

**Provider-text order is policy first, authored text last:** **[bible descriptor + generated seed-role/crowd/rig
policy] + [the shot's authored identity → scene → payload]**. The payload or exact replacement is literal final
provider text; no Forge clause follows it. This is an **amplifier fix pending controlled validation**, not an
established Class-A cure. **Anonymous-figure rig clauses are never written into a prompt.** The shot
DECLARES them in `figures` — `{"anon_foreground": ["the worker at the dock edge"], "crowd": true}`, one entry per
§2e-tier foreground figure, each phrased exactly as the prompt stages it — and forge expands the bible's §2d/§2e
blockquotes at gen time: §2e named over the entries and bound so it cannot leak onto named cast, `crowd: true` → the
§2d clause, and on a `stage_role: "delta"` shot the **held-figure** wording instead (§2e's "give them a distinct
outfit" is a FIRST-ESTABLISHMENT instruction and would redesign the very figure the chain is holding). A declared
`figures` field also forces the §2c append; without it Forge adds no anonymous-figure clause. The authored delta
changes only the variables it names while the style policy remains binding. **Pre-flight a batch with `forge.py
gen --dry-run`**: it prints every assembled prompt and resolves every seed with zero API calls — read the prompts
before paying for the batch.

**Batch specs come from `forge.py batch --batch <shots.json> --out <spec.json>`; a hand-rolled per-run batch script
is not a supported input.** It builds one deterministic slate per shot from the shot's own `assets` tags and
`figures`, orchestrates the two steps below, reuses an existing step-1 figure frame before generating one, records
every slate decision on the item (`why`) and on stdout, and **never truncates** — an over-cap or under-seeded shot is
a hard error naming the shot and the seed that did not fit, and that list is the re-authoring input. The retry path
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
| **(c) Character-free scene** | a map, an empty plate, an object | ONE `--mode environment`/`style` gen; a root may be zero-seed under the hardened descriptor, while a chain/anchored request keeps its continuity seed |
| **(d) One-shot single-character** | a simple shot, one prominent character | single gen `--mode identity` seeding that character's canonical (+ its expression/pose frames); full rig check still applies |
| **(e) Seeded delta-chain** (a held STAGE) | consecutive shots sharing a `stage` id where the change is INTEGRATIVE | the `base` uses (b)/(c)/(d); each `delta` seeds the PREVIOUS in-stage frame and changes ONLY that shot's `changed_elements`; **≤3 deltas**, then re-base or hard-cut |

**The BOUNDARY rule.** **DELTA-CHAIN when the change is INTEGRATIVE** (the element joins the scene's architecture):
technique (e), one element per delta, the carry-over holding the set. A **re-base inside the SAME location** seeds the
prior stage's BASE frame, never a fresh canonical, which would return a visibly different place. A **delta that
REMOVES a transient element seeds the pre-transient ancestor**, since the immediate predecessor drags it back.
**LAYER when the change is DISCRETE** (a character enters, a stamp slams onto a page): keep the plate, composite a
seeded cutout. Art style, proportions and period never switch mid-chain.

- **Two-step figure seeding — how a FRESH named-cast shot runs, and the only way it may.** The two-gen identity
  ladder (gen A composes the scene, gen B re-composes identity onto it) is **RETIRED**: a step-2 gen never
  re-composes identity from words, so the ladder's reason to exist is gone. **STEP 1** runs the unchanged seeding
  recipe — canonical + pose frame + expression frame — **in isolation**, no scene content, into one portable
  per-video figure frame (`fig-<character>--<pose>--<expression>`, the video's own asset, never channel `refs/`);
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
  retry_cause: null, notes}` in `assets/scenes/manifest.json` (skipped shots get a `skipped` entry); `review_status` is set ONLY by
  `stamp_review.py`. **Shorts** repeat the walk per short's `shots[]` + `first_frame`, aspect `9:16`, files
  `scenes/<short-file-stem>-<shot-id>.png`.
- **Thumbnail:** `thumbnail.primary` AND each challenger at `16:9` into `assets/thumbs/`, seeding any locked CHARACTER
  featured; never bake `text_overlay` in (applied at publish). After the human picks a winner, `py -3
  .claude/skills/image-generation/scripts/finalize_thumbnail.py <picked.png> <video_dir>` center-crops to 16:9,
  LANCZOS-resizes to 1280x720 and writes `assets/thumbnail.png` — the file every downstream gate reads (it refuses
  to upscale a crop narrower than 640px, and is idempotent).

**Layered shots (from `shots.motion.json`).** Each shot `motion-planner` marks with a `cutout` `layers[]` is
materialized into the layout the engine reads (render-builder `references/shots-motion-schema.md`). The **plate**
`plates/<id>.png` is the scene MINUS the moved element, still reading as a **complete** object, never a blank slot.
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

Pass 2 runs in **2–4 contiguous act batches snapped to stage boundaries** (a held stage never splits — batch on the
script's act turns like the writer and VPW do). **Within a batch, generate everything first — do not gate mid-batch —
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

The pass rules three axes together, per shot, at **ordinary viewing scale**:

1. **Identity/rig** — a **FORCED PASS/FAIL verdict on each §3 invariant**, never a silent pass, for **every seeded
   figure AND every anonymous LARGE/foreground (§2e) figure**, each judged against the tier §3 assigns it (seeded and
   §2e → FULL rig, against that character's approved canonical, not an idealized rig; anonymous small/background →
   CROWD rig). A chain-delta frame adds a **held-set** line (set + identities consistent with this stage's `base`?).
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
   palette, fore/mid/background depth, light/atmosphere, filled edge-to-edge** — or is it slop: generic, cluttered,
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
   mode with the hardened scene descriptor, seeding only a real canonical/continuity input; a pose/expression primitive
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
