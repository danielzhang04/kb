---
name: image-generation
description: Generates all verified, on-style images for a channel with a locked style bible — full visual production for a video, plus one-off assets (characters, poses, environments, props). Use for "do the image generation", generating visuals/B-roll frames, building a video's asset library, or single-asset requests like "give me this one but ___". Reads shots.json + style-bible.md + registry.json + refs/. Do NOT use it to plan shots (visual-prompt-writer), lock a new style, write scripts, or assemble video (render-builder).
---

# image-generation

Turns a video's `shots.json` — or a one-off request — into **verified, on-model** PNGs, using the channel's
locked `style-bible.md` as the single source of law. `scripts/forge.py` does the mechanics; **you own the
judgment**: derive the asset list, choose reuse-vs-generate, pick the technique and seeds per scene, review
every frame, register/manifest only what passed. Accuracy comes from **seed-from-reference + one batched
review**, not one clever prompt. **Engine reality:** Nano Banana is stochastic — 1–3 tries per image, and
the batched review is the guarantee. Run scripts with `py -3`.

**Log as you generate — files are the memory.** Every round records, *while it runs*: what each file is,
the seed(s) + mode + delta used, why, the verdict (shipped / flagged / rejected), and **any ID needed to
recreate the pick**. The manifests below ARE that log, so fill their `seed`, `technique`, and `notes`
fields for real; a round with no manifest (a one-off, a candidate batch, library building) gets a
**`<thing>-lab.md` beside the frames that appends per round**. Name every output descriptively
(`macgregor--salute--smug.png`, never `a3_v3.png`).

**Read the bible first, every session** (`<kit>/style-bible.md`): §2/§2b descriptors, §3 rig checklist, §5
seed rules, §6 recipe, §7 library build spec, §8 protocols. Its values are human-editable law — **never
silently change one mid-run**; surface a proposed edit and keep forging non-dependent assets.

## Mode selection

**A video** (a `shots.json` exists) → the **two-pass flow** below, preceded by **Pass 0** when
`needed_assets` is non-empty. **A one-off** (new expression/pose/prop/cast member, "iterate on this
frame", library building) → the **single-asset loop** at the bottom.

**The Pass-1 / Pass-2 split — the load-bearing rule.** Pass 1 locks *the video's recurring identifiable
people* — individual named CHARACTERS **and recurring identifiable GROUPS**; each is a portable identity,
so an isolated clean canonical is the right anchor to seed from. **Environments, props, plates, and
*anonymous* crowds are never pre-generated** — an environment is not portable and an anonymous crowd is
different faces each time, so both fight a pre-baked frame and are composed inside their own scene's gen in
Pass 2. Held sets carry across shots by seeding the prior frame (technique (e)), never by a shared plate.

## Pass 0 — library coverage (the human gate is upstream, in VPW)

Read `needed_assets` from `shots.json`; each entry (`kind` ∈ pose | expression | interaction) has already
passed the **human gate in VPW**, and its `wants` says what to draw. Generate each **on the base** via the
single-asset loop (`--mode new_character`/`identity` seeded off the template base), `2:3` — a `pose` asset
shows the base figure in that gesture with clean four-digit hands, an `expression` asset the base face, an
`interaction` asset TWO base figures interacting. The **human rig-gates** the frames (bible §0.6), then
`register` the approved frame with its `tag` = the `slug` VPW named, and `pose_ref`/`expression_ref`
resolves. Empty `needed_assets` → skip. **Never** generate a pose ad-hoc inside a scene (bible §5/§7).

## Pass 1 — the character lock

Materialize each recurring **individual character or identifiable group** ONCE, verify it, then seed every
appearance from it. Output: `videos/<slug>/assets/library/` + `manifest.json`.

1. **Derive the character table from `cast`** — the authoritative figure list across `long_form.shots`,
   shorts, and the thumbnail (`script.md` is context only). Per character record its registry name, the
   shot IDs it appears in, and the distinct `pose_ref`/`expression_ref` frames it uses.
   - **Individual named characters AND recurring identifiable groups earn a library slot** — even
     single-shot individuals, because a named character free-drawn inside a scene falls off the rig. A
     **group**'s canonical is a **group frame** (its N members together in matching outfits), locking member
     count, costume, look, and rig; it uses **no** `pose_ref`/`expression_ref`, its per-shot staging composed
     in the Pass-2 gen off that seed. **If a member ever acts alone** in a hero shot, promote that member.
   - **Story-referenced figures inside diegetic media count** — a brochure figure, portrait, or poster that
     IS a named character is that character's appearance, seeded from their canonical in the media's
     framing, in the **canonical costume** their registry entry pins unless the shot authors a change.
   - **A recurring identifiable PROP earns a per-video slot:** an object appearing across shots whose look
     must MATCH, listed in each shot's **`props` array**, gets ONE canonical generated ONCE
     (`assets/library/prop-<name>.png`, `prop-` prefix required, `--mode environment`/`style`, no character
     seed), then seeded into each appearance; no pose/expression.
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
   (`--batch <file.json>`, items `{name, character, mode, delta, aspect, seed?}`); `forge.py gen` stages
   into `<kit>/_staging/`.
4. **Verify** every staged character against bible §3 by looking at it (inline, no crop battery — Pass 1 is
   a handful of seed frames). Pass → if it is being promoted to the channel, `register` it FIRST (register
   consumes staging → `refs/`), then copy into `assets/library/`; otherwise move it straight to the
   library. Fail → **ONE re-authored retry**, then surface it flagged.
5. **Write `assets/library/manifest.json`:** `{video_slug, generated, assets: [{name, kind: character|prop,
   file, source: reused|generated, seed: [<frames used>], shots: [<shot ids>], notes}]}`.
6. **Promote a recurring CHARACTER to the channel** — one likely to recur in future videos also gets
   `register`ed into the channel registry/refs (bible §9), so later videos hit it via `lookup` → `reused`.

## Pass 2 — scene generation

Walk `long_form.shots` **in order** (then shorts, then the thumbnail). Each scene is a **complete image
generated in ONE run** that multi-seeds all its inputs at once. Output:
`videos/<slug>/assets/scenes/<shot-id>.png` + `manifest.json`.

**Seeding — the whole doctrine is bible §5; follow it, don't restate it** (order, the ≤4-seed cap,
attribute routing, regen-fresh-on-defect, match-prop, crowd-with-lead, the mandatory style anchor). Order
in brief: each cast figure's **canonical + `expression_ref` + `pose_ref`** (+ the interaction template when
two figures interact), then the **style anchor / plate**, prompt last. **Crowd-bearing gens also seed the
crowd exemplar** (`refs/base/crowd-exemplar.png`).

**Aspect ratio — pass it explicitly, every scene; NEVER 16:9 on a cutout.** Long-form scenes inherit
`long_form.aspect_ratio` (16:9 here), a short's scenes `9:16`. `forge.py`'s default gen aspect is portrait
**`2:3`**, so 16:9 work MUST pass `--aspect 16:9` on every **scene / plate** gen — forget it and the scene
generates portrait, silently mis-framed. **A CUTOUT gen is the opposite**: wide squashes the object's
proportions, so cutout gens use `2:3`, or `4:3`/`3:2` for a naturally wide object. Mechanically enforced —
**`forge.py cutout` HARD-ERRORS on an input whose width/height ≥ 1.5** (regenerate the source at
2:3/4:3/3:2) unless `--allow-wide` is passed for a legitimately wide object.

**Scope of a shot:** generate stills only for `source: ai-gen` or the generated half of `hybrid`;
`chart|screencap|stock|archival` belong to other pipelines — skip them and record `skipped: source=<x>`.
**Ignore every motion/stage field** (`stage`/`stage_role`/`changed_elements` and any unknown keys) — motion
is the engine's business, `synthetic` is metadata's. **ALL in-video text is diegetic**, quoted verbatim
from the `still_prompt` and kept SHORT (1–4 words), and **every text-bearing gen seeds the lettering
exemplar** (`refs/env/lettering-marker-italic.png`, bible §6).

**Prompt assembly + precedence.** `forge.py` auto-prepends the bible descriptor (§2/§2b by mode); your
delta is the shot's `still_prompt` (already carrying the `global_prompt_suffix` and the authored framing)
plus the seeds — do NOT re-compose the shot, add only minimal technical placement. The **delta overrides
the descriptor on exactly the variables it names**, everything else the descriptor holds, and where
`global_prompt_suffix` and the bible disagree **the bible wins**.

Per shot, pick the **cheapest technique that holds the locked elements**:

| Technique | When | How |
| --- | --- | --- |
| **(a) Reuse / reframe** | an already-generated on-disk frame IS this shot | copy it to `scenes/<shot-id>.png`; manifest notes source + intended framing. No gen. |
| **(b) Seeded composition** (default with characters) | the locked character(s) in a composed environment | ONE gen, `--mode environment`, multi-seeding each `cast` figure's frames (`--seed <char-canonical>,<expr-frame>,<pose-frame>[,<template>][,<char2…>]`) + a style anchor. Delta = the `still_prompt`'s scene/placement facts only; pose, expression, hands, and tone route by seed, and `forge.py` auto-appends the §2c RIG-HOLD prior |
| **(c) Character-free scene** | a map, an empty plate, an object | ONE style-only gen (`--mode environment`/`style`) **carrying a style-anchor seed** — forge hard-errors an unseeded environment/style gen |
| **(d) One-shot single-character** | a simple shot, one prominent character | single gen `--mode identity` seeding the character's canonical (+ its expr/pose frames); full rig check still applies |
| **(e) Seeded delta-chain** (a held STAGE) | consecutive shots sharing a `stage` id where the change is INTEGRATIVE | the `base` uses (b)/(c)/(d); each `delta` seeds the PREVIOUS in-stage frame (`scenes/<prev-shot>.png`) and changes ONLY that shot's `changed_elements`; **≤3 deltas**, then re-base or hard-cut. A re-base to a NEW place seeds canonical; one staying in the **SAME location** seeds the **prior stage's BASE frame**. *(A DISCRETE change is LAYERED instead — keep the plate, composite a cutout.)* |

- **Two-gen identity pass — the DEFAULT for a scene-heavy single-character shot** (exactly ONE seeded cast
  figure in a `still_prompt` dominated by environment content), **not a fallback.** The heavy environment
  delta **starves the lone character seed**, rendering the figure as the blank cream bald base template —
  which passes every §3 FORM check and is still the wrong character. So **gen A** composes the scene
  (technique (b)/(d)) and **gen B** is an identity pass seeded `[gen-A frame + character canonical +
  expression frame]` changing ONLY identity (head tone + hair + face), holding gen A's environment.
  Multi-character and character-light shots are UNCHANGED.
- **De-nose / de-ear fix — a targeted identity pass, budgeted for TWO gens.** Seed `[current frame +
  base-rig exemplar]` and change ONLY the faces; the engine re-draws a sticky C-shaped ear or residual nose
  about half the time, so the reliable shape is a **SECOND targeted pass seeded off the already-fixed
  frame** (not the original, which still has the defect). Confirm by a zoomed look. This is the fix
  TECHNIQUE, not a loosening of the one-retry rule.
- **Re-authoring an `expr-*.png` invalidates only the scenes seeded from it** — re-author + human-gate the
  frames, then regen those scenes. Never ship a video mixing old- and new-register faces.
- **Review each figure against its tier's rig** — the three-tier model and its §2c/§2d/§2e clauses are
  bible §1–§3. Image-gen side: named/seeded figures **and** anonymous LARGE/foreground (§2e) figures are
  reviewed against the FULL rig; anonymous small/many/background crowd figures against the CROWD rig.
- **Maps** — a different region of an established 2D map is a **deterministic PIL crop/zoom, never a gen**
  (rule + regen fallback: bible §5).
- Generate the scene, move it to `assets/scenes/<shot-id>.png`, and record `{shot_id, file, technique,
  seeds, flagged: false, review_status: "unreviewed", parked_reasons: [], notes}` in
  `assets/scenes/manifest.json` (skipped shots get a `skipped` entry). `review_status` starts
  `"unreviewed"` and is set ONLY by `stamp_review.py` — it is the render gate (states below).
- **Shorts:** same walk per short's `shots[]` (+ its `first_frame`), aspect `9:16`, files
  `scenes/<short-file-stem>-<shot-id>.png`.
- **Thumbnail:** generate `thumbnail.primary` AND each challenger — `16:9`,
  `assets/thumbs/thumbnail-primary.png` / `thumbnail-challenger-N.png`, seeding any locked CHARACTER it
  features (most are character-free artifact thumbnails → compose fully, no seed). Do NOT bake the
  `text_overlay` in; it is applied at publish. These candidates are NOT the publishable file —
  `compliance-check`'s Gate-3 requires exactly 1280x720 — so after the human picks a winner run `py -3
  .claude/skills/image-generation/scripts/finalize_thumbnail.py <picked-candidate.png> <video_dir>`, which
  center-crops to 16:9, LANCZOS-resizes to 1280x720, and writes `<video_dir>/assets/thumbnail.png`, the
  file every downstream gate reads. It refuses (exit 1) to upscale a crop narrower than 640px and is
  idempotent; unpicked challengers stay in `assets/thumbs/` for A/B swaps.

**Render handoff:** `render-builder` consumes `assets/scenes/` directly (scenes mode, auto-detected via
this pass's manifest); a missing scene for an ai-gen/hybrid shot is a render-time hard error, and skipped
sources fall back to the render's inline path.

**Layered shots (from `shots.motion.json`).** Each shot `motion-planner` marks with a `cutout` `layers[]`
is materialized into the layout the engine reads (schema: render-builder
`references/shots-motion-schema.md`) — every layer is the DISCRETE arm of the BOUNDARY rule, composited.
- **plate** `plates/<id>.png` — the scene MINUS the moved element (`background.plate_prompt`), which must
  still read as a **complete** object, never a blank slot where the subtracted element was.
- **cutout layers** `cutouts/<id>-<layer>.png` — **every cutout is SEEDED** (from its character/prop
  canonical, or the plate it lands on plus a style anchor). Gen the `cutout_prompt` on a **solid MAGENTA
  chroma field** (the engine emits no alpha; a pale field starves rembg on a pale subject), then `py -3
  scripts/forge.py cutout` (rembg → alpha-harden → trim; forge hard-errors a wide input). **Judge the matte
  by MEASUREMENT** — alpha histogram + corners **+ every enclosed interior region** — compositing over the
  real destination plate before calling a halo or colour defect (bible §8).
- **Hybrid** (a delta-chain shot carrying a cutout layer, e.g. a FICTION stamp): do **not** bake a full
  delta scene and do **not** gen a plate — `background.plate` already points at the prior in-stage
  `scenes/<prior-id>.png`; materialize **only** the overlay cutout. The batched review judges every plate
  and cutout the same as a scene.

## Reviewing the batch (ONE pass, after every scene is generated)

Generate all of Pass 2 first — **do not gate mid-run** — then run ONE review round over the whole batch and
regen only what is genuinely wrong. **This review is the ONLY seed-routing gate**, so watch explicitly for
what one-run multi-seeding produces: hands off the character's tone, a weak or wrong expression (the
SOFTEST seed), identity bleed between two co-present figures.

**Dispatch three concurrent review subagents**, each with one tight mandate over the whole batch. Give each
the generated scene files + per shot its `still_prompt`, `vo_text` (the full narrated span — facts often
live in the tail), and `beat`/`shot_class`, plus bible **§3**, the **§6 recipe**, and `universal.md §13a`
(`vo_ref` is only the render timing anchor, not a fidelity source).

1. **Identity/rig** — a FORCED verdict, never a silent pass, on **every seeded frame AND every anonymous
   LARGE/foreground (§2e) figure**, ruling **PASS/FAIL on each invariant**: **round head · no nose · no
   ears · four-digit hand · [pinned costume — seeded figures only]**, judging a seeded figure against its
   **character canonical** and a §2e figure against the FULL-rig invariants. A prominent §2e figure on the
   simplified crowd rig is a FAIL; anonymous small/background figures are judged against the CROWD rig. For
   a **chain-delta** frame add one **held-set** line (is the set + identities consistent with this stage's
   `base`?). The **four-digit hand is judged like every other invariant** — the seed is 4-digit, so a
   5-digit render is a drift-from-seed FAIL, no different from a nose appearing — though a hand PASS is
   never worded as certified (the human board is the final finger authority). Judge against the **approved
   canonical**, not an idealized rig; on any FAIL name the shot id and quote the offending pixel. **Rig
   review runs on the CROP BATTERY, not full-frame eyeballing:** (i) a **localizer** agent returns
   per-figure face + each-visible-hand bounding boxes as structured JSON (it never rules); (ii)
   **`scripts/crop_battery.py`** (PIL, deterministic) cuts those boxes at 3–4× into per-shot contact sheets
   + individual crop files; (iii) THIS judge rules PASS/FAIL per crop per invariant with the **crop file
   path cited as evidence** — a prose "zoomed, verified" claim with **no crop artifact is inadmissible**. A
   fix pass re-enters the battery on the before AND after frames, all figures, and silence on a seeded or
   §2e figure is not allowed. **This FRESH-EYES review is the rig authority — a GENERATING agent's
   self-verification does NOT substitute for it:** a generator under-reports its own defects (noses it
   calls "within tolerance" have been ruled BLOCKING on fresh-eyes zoom), being invested in its output and
   anchored on the prompt it wrote. **Never downgrade a fresh-eyes nose/ear FAIL to "minor".**
2. **Fidelity** — does each image assert **exactly the shot's load-bearing facts** (layout, geography,
   orientation, gesture + highlight targets, casting/costume) and **nothing extra that changes the read**?
   Check the claims one by one against the pixels, and **transcribe any authored in-image text
   LETTER-BY-LETTER** against the words the `still_prompt` quotes — a garbled, misspelled, or partial render
   is **blocking**.
3. **Style/taste** — does it read as its `beat` and `shot_class` at a glance, on-recipe (flat-cel 2.5D,
   built-but-flat, marker-honest per §6) **AND rich — committed scene palette, fore/mid/background depth,
   light/atmosphere, filled edge-to-edge (the gold bar)** — or is it slop: generic, cluttered, off-register,
   drifting to the detailed middle, **or thin/sparse**? **Check expression-register per beat** — an
   over-the-top face on an ordinary or grim beat AND a flat face on a real peak are both defects (bible §3).

Each returns a **flagged list keyed by shot id**, one sentence per defect quoting the offending fact. A
frame no agent flagged ships as-is.

**Fix flagged frames — ONE re-authored retry, then surface:**
- **Exactly ONE auto-retry per frame.** Not two, not a ladder.
- **The retry is a FRESH gen off a RE-AUTHORED prompt — never prompt-accretion.** Do NOT append the flag
  onto the failed delta ("…and make sure the hand has four digits") and re-fire; that keeps the logic that
  just failed and stacks a patch on it. Change the prompt logic — a different composition strategy, a
  different phrasing of the fact — and generate clean, seeding from the canonical, not the failed frame.
- **Re-author HOW an authored fact is depicted, never WHETHER it appears.** Deleting or softening a
  load-bearing fact to dodge a rendering defect — dropping an authored salute to avoid drawing the open
  hand — is a fidelity VIOLATION dressed as a fix; a fact that still won't render clean after the one retry
  is **flagged for the human**, never silently removed.
- **Self-check only the flagged points** on the new frame by looking at it — do not re-dispatch the review
  agents or re-review the whole batch.
- **Still failing after that one retry → STOP.** Keep the best attempt, mark it `flagged` in
  `assets/scenes/manifest.json` with the reason, and **surface it in the deliverable**. A systematic failure
  (the same invariant missing both times) that looks like a bible value being off → surface a proposed fix,
  never self-apply, and keep forging the rest.
- **Stamp the gate — generating agents NEVER stamp; the ORCHESTRATOR alone does**, and only after the crop
  battery + fresh-eyes review pass. It collects every agent's structured verdict into
  `assets/_review/merged.json` (one ruling per shot id, with per-axis severities + `why`), then runs:

  ```
  py -3 .claude/skills/image-generation/scripts/stamp_review.py <video_dir>
  ```

  `stamp_review.py` is the **ONLY writer** of the render gate's verdict. It reads `merged.json` and writes
  **`review_status` + `parked_reasons`** onto each shot's `scenes/manifest.json` entry — three honest
  states: **`verified`** (a fully-clean ruling, no defect on any axis — the ONLY state render-builder
  ships), **`parked`** (ANY defect ruling, even LOW — reviewed, defects known, honestly not shippable; its
  defect strings become `parked_reasons`, which the gate prints, and the entry hard-errors the render),
  **`unreviewed`** (no ruling covered the shot — hard-errors like a missing scene). Layered shots reviewed
  via their plate/cutout get an entry created; entries the review didn't cover are left untouched. It
  **never** writes a `verified: true` boolean — that shape is what once let a conductor falsely stamp
  defective frames when "parked" had no representation. Prints `stamped: N verified, M parked`.

## Single-asset loop (one-offs, cast extension, library building)

1. `lookup` the registry — a hit means hand back the file, done.
2. Pick the seed by bible §5: existing character → its canonical `base`; **"iterate on THIS"** → that exact
   approved frame, changing ONLY the one requested variable; new character → the template base + a new head
   tone (§4); environment/prop → style-only mode **with a style-anchor seed**.
3. `gen` into staging → **check bible §3** by looking at it → **ONE re-authored retry**, then flag +
   surface as above. Record the round (seed, mode, delta, settings, verdict) in a notes file beside the
   frames — a one-off has no manifest, so it needs its own log.
4. `register` what passed (`--batch` for many; environments add `"environment": true`) — staging → `refs/`,
   indexed in the registry. Building the standing library follows the bible §7 build order.

## Report

What shipped (library counts, scenes by technique), what was reused, what the review caught per category
and what it regenerated, any frames still **flagged** after the one retry (with their reason), anything
escalated for approval, and the render-wiring caveat. Publish the images via an Artifact link — full
frames, **flagged ones marked with their reason**, and the **crop-battery sheets embedded (collapsible per
card)** so the human finger gate rules on evidence at seconds per shot.

**Present it neutrally — the human calibrates the bar, not you.** Never declare the output "works" or
"clears the bar": the bar is the reference grade the human holds (bible §6's gold bar), and a premature
success claim skips real problems and burns iterations. **Name the batch's weaknesses FIRST.** On a
rejection, **diagnose the root cause honestly instead of defending the work** — the true diagnoses are
usually structural (figures at the wrong scale against their plate read as paper-doll stickers; shots
labelled "non-literal" that still draw the sentence literally).

## Not this skill

Planning the shots (`visual-prompt-writer` owns `shots.json`) · locking a brand-new channel style ·
writing scripts · assembling the video (`render-builder`).
