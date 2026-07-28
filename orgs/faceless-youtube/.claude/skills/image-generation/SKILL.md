---
name: image-generation
description: Generates all verified, on-style images for a channel with a locked style bible — full visual production for a video, plus one-off assets (characters, poses, environments, props). Use for "do the image generation", generating visuals/B-roll frames, building a video's asset library, or single-asset requests like "give me this one but ___". Reads shots.json + style-bible.md + registry.json + refs/. Do NOT use it to plan shots (visual-prompt-writer), lock a new style, write scripts, or assemble video (render-builder).
---

# image-generation

Turns a video's `shots.json` — or a one-off request — into **verified, on-model** PNGs, using the
channel's locked `style-bible.md` as the single source of law. `scripts/forge.py` does the mechanics;
**you own the judgment**: derive the asset list, choose reuse-vs-generate, pick the technique and seeds
per scene, review every frame, and register/manifest only what passed. Accuracy comes from
**seed-from-reference + one batched review**, not one clever prompt. **Engine reality:** Nano Banana is
stochastic — expect 1–3 tries per image, and the batched review is the guarantee. Run scripts with `py -3`.

**Log as you generate — files are the memory.** Every round records its reasoning beside its outputs
*while it runs*: what each file is, the seed(s) + mode + delta used, why, and the verdict (shipped /
flagged / rejected), including **any ID needed to recreate the pick**. The manifests below ARE that log, so
fill their `seed`, `technique`, and `notes` fields for real; a round with no manifest (a one-off, a
candidate batch, library building) gets a **`<thing>-lab.md` beside the frames that appends per round**.
Name every output descriptively (`macgregor--salute--smug.png`, never `a3_v3.png`).

**Read the bible first, every session** (`<kit>/style-bible.md`): §2/§2b descriptors, §3 rig checklist, §5
seed rules, §6 recipe, §7 library build spec, §8 protocols. Its values are the human-editable source of
truth — **never silently change one mid-run**; if one looks wrong, surface a proposed edit for approval and
keep forging non-dependent assets.

## Mode selection

**A video** (a `shots.json` exists) → the **two-pass flow** below, preceded by **Pass 0** when
`needed_assets` is non-empty. **A one-off** (new expression/pose/prop/cast member, "iterate on this
frame", library building) → the **single-asset loop** at the bottom.

**The Pass-1 / Pass-2 split — the load-bearing rule.** Pass 1 locks *the video's recurring identifiable
people* — individual named CHARACTERS **and recurring identifiable GROUPS**; each is a portable identity,
so an isolated clean canonical is the right anchor to seed from. **Environments, props, plates, and
*anonymous* crowds are never pre-generated** — they are composed inside their own scene's gen in Pass 2,
because an environment is not portable and an anonymous crowd is different faces each time (a composition,
not a recurring identity), so both fight a pre-baked frame. Held sets continue across shots by seeding
each frame off the prior frame (technique (e)), never by a shared plate.

## Pass 0 — library coverage (the human gate is upstream, in VPW)

Read `needed_assets` from `shots.json`; each entry (`kind` ∈ pose | expression | interaction) has already
passed the **human gate in VPW**, and its `wants` says what to draw. For each: generate it **on the base**
via the single-asset loop (`--mode new_character`/`identity` seeded off the template base), `2:3` — a
`pose` asset shows the base figure in that gesture with clean four-digit hands, an `expression` asset the
base face, an `interaction` asset TWO base figures in the interaction. The **human rig-gates** the frames
(a base pose/expression is a channel asset — bible §0.6), then `register` the approved frame with its
`tag` = the `slug` VPW named, and `pose_ref`/`expression_ref` resolves. Empty `needed_assets` → skip.
**Never** generate a pose ad-hoc inside a scene — poses come only from the registry (bible §5/§7).

## Pass 1 — the character lock

Materialize each recurring **individual character or identifiable group** ONCE, verify it, then seed every
appearance from it. Output: `videos/<slug>/assets/library/` + `manifest.json`.

1. **Derive the character table from `cast`** — the authoritative figure list across `long_form.shots`,
   shorts, and the thumbnail. Per character record its registry name, the shot IDs it appears in, and the
   distinct `pose_ref`/`expression_ref` frames it uses (Pass 2 seeds those frames directly into each scene
   gen). `script.md` is context only.
   - **Individual named characters AND recurring identifiable groups earn a library slot** — even
     single-shot individuals, because a named character free-drawn inside a scene falls off the rig. A
     **group**'s canonical is a **group frame** (its N members together in matching outfits), locking member
     count, costume, look, and rig; it uses **no** `pose_ref`/`expression_ref` and its per-shot staging is
     composed in the Pass-2 gen off that seed. **If a member ever acts alone** in a hero shot, promote
     *that member* to an individual character.
   - **Story-referenced figures inside diegetic media count** — a brochure figure, portrait, or poster that
     IS a named character is that character's appearance, seeded from their canonical in the media's
     framing. A character's registry entry pins their **canonical costume**; generate them in it unless the
     shot authors a change.
   - **A recurring identifiable PROP earns a per-video slot** (mirrors the character lock): an object
     appearing across shots whose look must MATCH, listed in each shot's **`props` array**, gets ONE
     canonical generated ONCE (`assets/library/prop-<name>.png`, `prop-` prefix required, `--mode
     environment`/`style`, no character seed), then seeded into each appearance; no pose/expression, and
     per-shot placement is composed in the Pass-2 gen.
   - **Environments, plates, one-off props, and anonymous crowds do NOT earn a slot** — composed inside
     their scene's Pass-2 gen (an adjacent shot holding the same crowd/set carries it via technique (e)). A
     channel-SIGNATURE prop/environment recurring across MANY videos is a separate deliberate build (bible
     §7 + the single-asset loop + a `kind: environment` registry entry).
   - **`cast`/`props` name each figure and prop by its registry or library name — no prose guesswork.** One
     referenced in the `still_prompt` but omitted from `cast`/`props` is an authoring gap: flag it back.
2. **Reuse before regenerate** — check the registry (`py -3 scripts/forge.py lookup --kit <kit> --character
   <c> --tag <tag>`, or read `registry.json`); a hit is recorded in the manifest as `reused`, no generation.
3. **Generate the missing** per bible §5/§8: a **new cast member** → `--mode new_character` seeded off the
   template base, `2:3`; a **variant** → anchored iteration (seed that character's canonical, change only
   the variant trait, save as `<name>--<variant>`). Descriptive kebab-case names; batch what you can
   (`--batch <file.json>`, items `{name, character, mode, delta, aspect, seed?}`). `forge.py gen` stages
   into `<kit>/_staging/`.
4. **Verify** every staged character against bible §3 by looking at it (Pass 1 is a handful of frames and
   they are the seeds, so this one is checked inline, no hand crops). Pass → if it is being promoted to the
   channel, `register` it FIRST (register consumes staging → `refs/`), then copy into `assets/library/`;
   otherwise move it straight to the library. Fail → **ONE re-authored retry**, then surface it flagged.
5. **Write `assets/library/manifest.json`:** `{video_slug, generated, assets: [{name, kind: character|prop,
   file, source: reused|generated, seed: [<frames used>], shots: [<shot ids>], notes}]}`.
6. **Promote a recurring CHARACTER to the channel** — one likely to recur in future videos also gets
   `register`ed into the channel registry/refs (bible §9), so later videos hit it via `lookup` → `reused`.

## Pass 2 — scene generation

Walk `long_form.shots` **in order** (then shorts, then the thumbnail). Each scene is a **complete image
generated in ONE run** that multi-seeds all of its inputs at once. Output:
`videos/<slug>/assets/scenes/<shot-id>.png` + `manifest.json`.

**Seeding.** Order and doctrine are bible §5: each cast figure's **character canonical + `expression_ref`
+ `pose_ref`** (+ the interaction template when two figures interact), then a **style anchor / plate —
mandatory on every scene/plate gen**, prompt last; **≤4 seeds** per gen; attributes route by seed. A
**way-off-rig / multi-defect frame is regenerated FRESH from its canonicals**, never "fixed" by seeding an
identity pass off the defective frame. **Crowd-bearing gens also seed the crowd exemplar**
(`refs/base/crowd-exemplar.png`) — the §2d words stay in the prompt, the seed pins the crowd rig.

**Aspect ratio — pass it explicitly, every scene; NEVER 16:9 on a cutout.** Long-form scenes inherit
`long_form.aspect_ratio` (16:9 here), a short's scenes `9:16`. `forge.py`'s default gen aspect is portrait
**`2:3`**, so 16:9 work MUST pass `--aspect 16:9` on every **scene / plate** gen — forget it and the scene
generates portrait, silently mis-framed. **A gen whose output becomes a CUTOUT is the opposite**: a wide
cutout gen squashes the object's proportions, so cutout gens use `2:3`, or `4:3`/`3:2` for a naturally wide
object. Mechanically enforced — **`forge.py cutout` HARD-ERRORS on an input whose width/height ≥ 1.5**
(regenerate the source at 2:3/4:3/3:2) unless `--allow-wide` is passed for a legitimately wide object.

**Scope of a shot:** generate stills only for `source: ai-gen` or the generated half of `hybrid`;
`chart|screencap|stock|archival` belong to other pipelines — skip them and record `skipped: source=<x>`.
**Ignore every motion/stage field** (`stage`/`stage_role`/`changed_elements` and any unknown keys) — motion
is the engine's business, `synthetic` is metadata's. **ALL in-video text is diegetic — designed into the
scene and BAKED into the image**, quoted verbatim from the `still_prompt` and kept SHORT (1–4 words); the
batched review transcribes it letter-by-letter and a garbled/partial render is blocking (bible §3).
**Every text-bearing gen ALSO seeds the lettering exemplar** (`refs/env/lettering-marker-italic.png`,
bible §6) so all lettering stays one family; the review judges FAMILY loosely, spelling strictly.

**Prompt assembly + precedence.** `forge.py` auto-prepends the bible descriptor (§2/§2b by mode); your
delta is the shot's `still_prompt` (which already carries the `global_prompt_suffix` and the authored
framing) plus the seeds — do NOT re-compose the shot, add only minimal technical placement. The **delta
overrides the descriptor on exactly the variables it names**; everything else the descriptor holds; and
where `global_prompt_suffix` and the bible disagree, **the bible wins**.

Per shot, pick the **cheapest technique that holds the locked elements**:

| Technique | When | How |
| --- | --- | --- |
| **(a) Reuse / reframe** | an already-generated on-disk frame IS this shot | copy it to `scenes/<shot-id>.png`; manifest notes source + intended framing. No gen. |
| **(b) Seeded composition** (default with characters) | the locked character(s) in a composed environment | ONE gen, `--mode environment`, multi-seeding each `cast` figure's frames (`--seed <char-canonical>,<expr-frame>,<pose-frame>[,<template>][,<char2…>]`) + a style anchor. Delta = the `still_prompt`'s scene/placement facts only; pose, expression, hands, and tone route by seed, and `forge.py` auto-appends the §2c RIG-HOLD prior |
| **(c) Character-free scene** | a map, an empty plate, an object | ONE style-only gen (`--mode environment`/`style`) **carrying a style-anchor seed** — forge hard-errors an unseeded environment/style gen |
| **(d) One-shot single-character** | a simple shot, one prominent character | single gen `--mode identity` seeding the character's canonical (+ its expr/pose frames); full rig check still applies |
| **(e) Seeded delta-chain** (a held STAGE) | consecutive shots sharing a `stage` id where the change is INTEGRATIVE | the `base` uses (b)/(c)/(d); each `delta` seeds the PREVIOUS in-stage frame (`scenes/<prev-shot>.png`) and changes ONLY that shot's `changed_elements`; **≤3 deltas**, then re-base or hard-cut. A re-base to a NEW place seeds canonical; one staying in the **SAME location** seeds the **prior stage's BASE frame**. *(A DISCRETE change is LAYERED instead — keep the plate, composite a cutout.)* |

- **Two-gen identity pass — the DEFAULT for a scene-heavy single-character shot, not a fallback:** exactly
  ONE seeded cast figure in a `still_prompt` dominated by environment content. The heavy environment delta
  reliably **starves the lone character seed**, rendering the figure as the blank cream bald base template
  — which passes every §3 FORM check and is still the wrong character. So **gen A** composes the whole
  scene (technique (b)/(d)) and **gen B** is an identity pass seeded `[gen-A frame + character canonical +
  expression frame]` changing ONLY the figure's identity (head tone + hair + face), holding gen A's
  environment. Multi-character and character-light shots are UNCHANGED.
- **De-nose / de-ear fix — a targeted identity pass, budgeted for TWO gens.** Seed `[current frame +
  base-rig exemplar]` and change ONLY the faces; the engine re-draws a sticky C-shaped ear or residual nose
  about half the time, so the reliable shape is a **SECOND targeted pass seeded off the already-fixed
  frame** (not the original, which still has the defect). Budget both and confirm by a zoomed look. This is
  the fix TECHNIQUE, not a loosening of the one-retry rule.
- **Re-authoring an `expr-*.png` invalidates only the scenes seeded from it** — re-author + human-gate the
  frames, then regen those scenes. Never ship a video mixing old- and new-register faces.
- **Every human figure obeys the family, by TIER** (bible §1/§3): a **named/recurring foreground** figure on
  the FULL rig (seeded + auto-appended §2c); an **anonymous LARGE/foreground** figure ALSO on the FULL rig
  via the **§2e clause** (VPW-authored into the `still_prompt` — no seed, no canonical); an **anonymous
  small/many/background** crowd on the **CROWD RIG (§2d)**, its clause already in the prompt and the gen
  seeding the crowd exemplar. Review each figure against the rig its tier names.
- **Crowd scene with ONE seeded lead:** the crowd competes with the lead's seed and can starve its costume,
  so **restate the lead's pinned costume explicitly** even though it is seeded, and give the crowd a
  **contrasting uniform/palette** so the lead reads as distinct at a glance.
- **Maps** — a different region of an established 2D map is a **deterministic PIL crop/zoom of the map
  canonical, NOT a gen** (bible §5); regen only if the canonical doesn't cover the region, then seeding the
  map canonical + `refs/env/env-map-parchment`.
- Generate the scene, move it to `assets/scenes/<shot-id>.png`, and record `{shot_id, file, technique,
  seeds, flagged: false, review_status: "unreviewed", parked_reasons: [], notes}` in
  `assets/scenes/manifest.json` (skipped shots get a `skipped` entry). `review_status` starts
  `"unreviewed"` and is set to `"verified"` or `"parked"` ONLY by `stamp_review.py` — **it is the render
  gate:** `render-builder` ships only `"verified"`, a `"parked"` entry hard-errors with its
  `parked_reasons`, and `"unreviewed"`/unstamped hard-errors like a missing scene.
- **Shorts:** same walk per short's `shots[]` (+ its `first_frame`), aspect `9:16`, files
  `scenes/<short-file-stem>-<shot-id>.png`.
- **Thumbnail:** generate `thumbnail.primary` AND each challenger — `16:9`,
  `assets/thumbs/thumbnail-primary.png` / `thumbnail-challenger-N.png`, seeding any locked CHARACTER it
  features (most are character-free artifact thumbnails → compose fully, no seed). Do NOT bake the
  `text_overlay` in; it is applied at publish. These candidates are NOT the publishable file —
  `compliance-check`'s Gate-3 requires exactly 1280x720 — so after the human picks a winner run `py -3
  .claude/skills/image-generation/scripts/finalize_thumbnail.py <picked-candidate.png> <video_dir>`, which
  center-crops to 16:9, LANCZOS-resizes to 1280x720, and writes `<video_dir>/assets/thumbnail.png`, the
  file every downstream gate reads. It refuses (exit 1) to upscale a candidate whose crop is narrower than
  640px and is idempotent; unpicked challengers stay in `assets/thumbs/` for A/B swaps.

**Render handoff:** `render-builder` consumes `assets/scenes/` directly (scenes mode, auto-detected via
this pass's manifest); a missing scene for an ai-gen/hybrid shot is a render-time hard error, and skipped
sources fall back to the render's inline path.

**Layered shots (from `shots.motion.json`).** Each shot `motion-planner` marks with a `cutout` `layers[]`
is materialized into the layout the engine reads (schema: render-builder
`references/shots-motion-schema.md`). Every layer is the DISCRETE arm of the BOUNDARY rule — composited,
not baked.
- **plate** `plates/<id>.png` — the scene MINUS the moved element (`background.plate_prompt`), which must
  still read as a **complete** object, never a blank slot where the subtracted element was.
- **cutout layers** `cutouts/<id>-<layer>.png` — **every cutout is SEEDED** (from its character/prop
  canonical, or the plate it lands on plus a style anchor). Gen the `cutout_prompt` on a **solid MAGENTA
  chroma field** (the engine emits no alpha — transparency is always post-hoc keying; a pale field starves
  rembg on a pale subject), then `py -3 scripts/forge.py cutout` (rembg → alpha-harden → trim; forge
  hard-errors a wide input). **Judge the matte by MEASUREMENT, not by looking** — alpha histogram + corners
  **+ every enclosed interior region** — and composite over the real destination plate before calling a
  halo or colour defect (bible §8).
- **Hybrid** (a delta-chain shot carrying a cutout layer, e.g. a FICTION stamp): do **not** bake a full
  delta scene and do **not** gen a plate — `background.plate` already points at the prior in-stage
  `scenes/<prior-id>.png`; materialize **only** the overlay cutout.

The batched review judges every generated plate + cutout the same as a scene.

## Reviewing the batch (ONE pass, after every scene is generated)

Generate all of Pass 2 first — **do not gate mid-run** — then run ONE review round over the whole batch and
regen only what is genuinely wrong. **This review is the ONLY seed-routing gate**, so watch explicitly for
what one-run multi-seeding can produce: hands off the character's tone, a weak or wrong expression
(expression is the SOFTEST seed), identity bleed between two co-present figures.

**Dispatch three concurrent review subagents**, each with one tight mandate over the whole batch. Give each
the generated scene files + per shot its `still_prompt`, `vo_text` (the full narrated span — facts often
live in the tail), and `beat`/`shot_class`, plus bible **§3**, the **§6 recipe**, and `universal.md §13a`.
`vo_ref` is only the render timing anchor, not a fidelity source.

1. **Identity/rig** — a FORCED verdict, never a silent pass, on **every seeded frame AND every anonymous
   LARGE/foreground (§2e) figure** (both on the FULL rig), ruling **PASS/FAIL on each invariant**: **round
   head · no nose · no ears · four-digit hand · [pinned costume — seeded figures only]**, judging a seeded
   figure against its **character canonical** and a §2e figure against the FULL-rig invariants. A prominent
   §2e figure rendered on the simplified crowd rig is a FAIL; anonymous small/background figures are judged
   against the CROWD rig instead. For a **chain-delta** frame add one **held-set** line (is the set +
   identities consistent with this stage's `base`?). The **four-digit hand is judged like every other
   invariant** — the seed is 4-digit, so a 5-digit render is a drift-from-seed FAIL, no different from a
   nose appearing — though a hand PASS is never worded as certified (the human board is the final finger
   authority). Judge against the **approved canonical**, not an idealized rig, and on any FAIL name the
   shot id and quote the offending pixel in one clause. **Rig review runs on the CROP BATTERY, not
   full-frame eyeballing:** (i) a **localizer** agent returns per-figure face + each-visible-hand bounding
   boxes as structured JSON (it never rules); (ii) **`scripts/crop_battery.py`** (PIL, deterministic) cuts
   those boxes at 3–4× into per-shot contact sheets + individual crop files; (iii) THIS judge rules
   PASS/FAIL per crop per invariant with the **crop file path cited as evidence** — a prose "zoomed,
   verified" claim with **no crop artifact is inadmissible**. A fix pass re-enters the battery on the
   before AND after frames, all figures. Silence on a seeded or §2e figure is not allowed.
   **This FRESH-EYES review is the rig authority — a GENERATING agent's self-verification does NOT
   substitute for it:** a unit that generated a frame under-reports its own defects (noses it calls "within
   tolerance" have been ruled BLOCKING on fresh-eyes zoom), because it is invested in its output and
   anchored on the prompt it wrote. Never let a self-check stand in for this pass, and **never downgrade a
   fresh-eyes nose/ear FAIL to "minor"** — a nose on the no-nose rig is blocking regardless of size.
2. **Fidelity** — does each image assert **exactly the shot's load-bearing facts** (layout, geography,
   orientation, gesture + highlight targets, casting/costume) and **nothing extra that changes the read**?
   Check the claims one by one against the pixels, and **transcribe any authored in-image text
   LETTER-BY-LETTER** against the words the `still_prompt` quotes — a garbled, misspelled, or partial
   render is **blocking**.
3. **Style/taste** — does it read as its `beat` and `shot_class` at a glance, on-recipe (flat-cel 2.5D,
   built-but-flat, marker-honest per §6) **AND rich — committed scene palette, fore/mid/background depth,
   light/atmosphere, filled edge-to-edge (the gold bar)** — or is it slop: generic, cluttered, off-register,
   drifting to the detailed middle, **or thin/sparse** (a lone object on dead air)? **Check
   expression-register per beat** — an over-the-top face on an ordinary or grim beat AND a flat face on a
   real peak are both defects (bible §3).

Each returns a **flagged list keyed by shot id**, one sentence per defect quoting the offending fact. A
frame no agent flagged ships as-is.

**Fix flagged frames — ONE re-authored retry, then surface:**
- **Exactly ONE auto-retry per frame.** Not two, not a ladder.
- **The retry is a FRESH gen off a RE-AUTHORED prompt — never prompt-accretion.** Do NOT append the flag
  onto the failed delta ("…and make sure the hand has four digits") and re-fire; that keeps the logic that
  just failed and stacks a patch on it. Change the prompt logic — a different composition strategy, a
  different phrasing of the load-bearing fact — and generate clean, seeding from the canonical, not from
  the failed frame.
- **Re-author HOW an authored fact is depicted, never WHETHER it appears.** Deleting or softening a
  load-bearing fact to dodge a rendering defect — dropping an authored salute to avoid drawing the open
  hand — is a fidelity VIOLATION dressed as a fix. A fact that still won't render clean after the one retry
  is **flagged for the human**, never silently removed.
- **Self-check only the flagged points** on the new frame by looking at it — do not re-dispatch the review
  agents or re-review the whole batch.
- **Still failing after that one retry → STOP.** Keep the best attempt, mark it `flagged` in
  `assets/scenes/manifest.json` with the reason, and **surface it in the deliverable** — the human decides.
  A systematic failure (the same invariant missing both times) that looks like a bible value being off →
  surface a proposed fix, never self-apply, and keep forging the rest.
- **Stamp the gate — generating agents NEVER stamp; the ORCHESTRATOR alone runs the stamp**, and only after
  the crop battery + fresh-eyes review pass. The orchestrator collects every agent's structured verdict
  into `assets/_review/merged.json` (one ruling per shot id, carrying per-axis severities + `why`), then
  runs the honest stamp writer:

  ```
  py -3 .claude/skills/image-generation/scripts/stamp_review.py <video_dir>
  ```

  `stamp_review.py` is the **ONLY writer** of the render gate's verdict. It reads `merged.json` and writes
  **`review_status` + `parked_reasons`** onto each shot's `scenes/manifest.json` entry — three honest
  states: **`verified`** (a fully-clean ruling, no defect on any axis; shippable, and the ONLY state
  render-builder ships), **`parked`** (ANY defect ruling, even LOW — reviewed, defects known, honestly not
  shippable, its defect strings becoming `parked_reasons`), **`unreviewed`** (no ruling covered the shot;
  gated, not shippable). Layered shots reviewed via their plate/cutout get an entry created; entries the
  review didn't cover are left untouched. It **never** writes a `verified: true` boolean — that shape is
  what once let a conductor falsely stamp defective frames when "parked" had no representation. Prints
  `stamped: N verified, M parked`, and this stamp is what unblocks render-builder's gate.

## Single-asset loop (one-offs, cast extension, library building)

1. `lookup` the registry — a hit means hand back the file, done.
2. Pick the seed by bible §5: existing character → its canonical `base`; **"iterate on THIS"** → that exact
   approved frame, changing ONLY the one requested variable; new character → the template base + a new head
   tone (§4); environment/prop → style-only mode **with a style-anchor seed** (forge hard-errors an
   unseeded environment/style gen).
3. `gen` into staging → **check bible §3** by looking at it → **ONE re-authored retry**, then flag +
   surface as above. Record the round (seed, mode, delta, settings, verdict) in a notes file beside the
   frames — a one-off has no manifest, so it needs its own log.
4. `register` what passed (`--batch` for many; environments add `"environment": true`) — staging → `refs/`,
   indexed in the registry. When building the standing library, follow the bible §7 build order.

## Report

What shipped (library counts, scenes by technique), what was reused, what the review caught per category
and what it regenerated, any frames still **flagged** after the one retry (with their reason), anything
escalated for approval, and the render-wiring caveat. Publish the images for human review via an Artifact
link — full frames, **flagged ones marked with their reason**, and the **crop-battery sheets embedded
(collapsible per card)** so the human finger gate rules on evidence at seconds per shot.

**Present it neutrally — the human calibrates the bar, not you.** Never declare the output "works" or
"clears the bar": the bar is the reference grade the human holds (bible §6's gold bar), and a premature
success claim skips real problems and burns iterations. **Name the batch's weaknesses FIRST**, then hand it
over. When they reject a frame or the set, **diagnose the root cause honestly instead of defending the
work** — the true diagnoses are usually structural (figures composed at the wrong scale against their plate
read as paper-doll stickers; shots labelled "non-literal" that still draw the sentence literally).

## Not this skill

Planning the shots (`visual-prompt-writer` owns `shots.json`) · establishing/locking a brand-new channel
style · writing scripts · assembling the video (`render-builder`).
