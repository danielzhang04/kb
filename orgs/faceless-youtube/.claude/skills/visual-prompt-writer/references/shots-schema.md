# shots.json — schema, render mapping, prompt patterns

The exact contract `visual-prompt-writer` writes and `render-builder` (+ `publish-queue` for the
thumbnail) reads. One file per video at `channels/<name>/videos/<slug>/shots.json`. Follow this
exactly so `render-builder` maps onto its render call with **no interpretation**.

## Table of contents
1. Full JSON shape
2. Field → render-builder mapping (Remotion scenes)
3. Source-tag taxonomy (when to use which)
4. Prompt-writing patterns (still / thumbnail)
5. Limits, defaults, timing
6. Worked mini-example

---

## 1. Full JSON shape

```json
{
  "schema": "faceless-youtube/shots@1",
  "channel": "<channels/ folder slug, e.g. collapse — NOT the display name>",
  "video_slug": "YYYY-MM-DD-slug",
  "source_idea_id": "<id from idea-backlog.md>",
  "generated": "YYYY-MM-DD",
  "status": "shots-drafted",
  "shot_counts": { "_note": "informational only; not consumed downstream", "long_form_shots": 0, "thumbnail_prompts": 0, "shorts": 0, "shorts_shots": 0, "total_prompts": 0 },
  "timing_status": "estimated-from-script — re-time after render",

  "house_style": {
    "palette": "≤2–3 core colors + accent, from dna.md",
    "typography": "on-screen text font/treatment",
    "footage_type": "the dominant medium — motion-graphics / hybrid-stock / stylized-AI / 3D",
    "motion_feel": "default camera energy — slow-cinematic / snappy-doc / kinetic",
    "avoid": "off-style things to never render (e.g. real faces if faceless, stocky corporate clip-art)",
    "aspect": {"long_form": "16:9", "shorts": "9:16"}
  },
  "global_prompt_suffix": "",

  "long_form": {
    "aspect_ratio": "16:9",
    "shots": [
      {
        "id": "L01",
        "beat": "hook",
        "start_hint": "0:00",
        "duration_s": 4,
        "vo_ref": "VERBATIM opening words (≥4) of the VO line, copied exactly from script.md — never paraphrased/reordered",
        "vo_text": "DERIVED by lint_shots.py --write: the verbatim script span this shot covers (its anchor → the next shot's). Do NOT hand-author; not a depiction brief.",
        "from_cue": true,
        "stage": "OPTIONAL id shared by consecutive shots on ONE persistent set (e.g. \"guidebook-desk\"). Omit or unique = a standalone one-frame stage.",
        "stage_role": "base | delta — base establishes the set+subject; delta = ONE element added/moved on the SAME set. (Only meaningful when `stage` is shared.)",
        "changed_elements": ["+ golden city rises", "MacGregor gains epaulettes"],
        "narration_type": "abstract-force | deal | institution | number | comparison | event | mechanism | spatial | claim | aside | idiom | grim | scale | physical-action",
        "shot_class": "the chosen shot class — THIS is the canonical closed list of class names (SKILL Step 2.5 references it; map per universal §13a): personified-character, staged-interaction, symbolic-stand-in-object, number-glued-to-object, diegetic-device, map-plan-view, physicalized-imbalance, register-shift-infographic, ironic-counterpoint, reaction-shot, idiom-pun, aftermath-palette-turn, crowd-multiplication, literal",
        "cast": [
          { "character": "<registry character name>", "pose_ref": "<registry pose slug — OMIT if no specific pose>", "expression_ref": "<registry expression slug — OMIT if none>" }
        ],
        "props": ["<recurring-prop name, e.g. guidebook — parallel to cast; OMIT if none recur>"],
        "source": "hybrid",
        "still_prompt": "full image-gen prompt: subject, composition/framing + scale, lighting, palette + the shot's load-bearing scene FACTS (layout, who faces whom, what a gesture/highlight targets, each character's expression — see SKILL Step 2.5). Any in-video text is DIEGETIC + baked here — quote it VERBATIM, keep SHORT (1–4 words)",
        "stock_query": "search terms — only when source is stock|hybrid|archival, else omit",
        "synthetic": false,
        "notes": "policy/accuracy flags (analysis-not-gore, YMYL, borderline)"
      }
    ]
  },

  "needed_assets": [
    { "kind": "pose | expression | interaction",
      "_note": "an asset VPW needs that the registry LACKS; a HUMAN GATE — generate on the base + approve, or veto (VPW then restages onto existing assets). Interactions are just another kind.",
      "slug": "<new-asset-slug>",
      "wants": "<clear description of the pose/expression/interaction to draw>",
      "why": "<which shot/beat needs it>" }
  ],

  "thumbnail": {
    "thumbnail_source": "from-metadata.json",
    "primary": {
      "source": "hybrid",
      "text_overlay": "≤3 words or \"\"",
      "gen_prompt": "full prompt honoring §8 — dominant subject, ≥50% negative space, ≤2 colors, proof-of-human",
      "composition": "framing notes — rule-of-thirds, red-circle-on-anomaly, before/after split, number-as-object",
      "synthetic": true
    },
    "challengers": [
      {"source": "hybrid", "text_overlay": "…", "gen_prompt": "…", "composition": "…", "synthetic": true},
      {"source": "hybrid", "text_overlay": "…", "gen_prompt": "…", "composition": "…", "synthetic": true}
    ]
  },

  "shorts": [
    {
      "file": "shorts/short-01.md",
      "archetype": "string (from the short)",
      "status": "publish",
      "aspect_ratio": "9:16",
      "first_frame": {
        "source": "ai-gen",
        "still_prompt": "a pattern-interrupt tableau already carrying the beat's tension (a held pose, not a freeze of motion); any on-frame caption (3–7 words) is DIEGETIC + baked into the image — quote it verbatim",
        "synthetic": false
      },
      "shots": [
        {
          "id": "S01-01",
          "duration_s": 3,
          "vo_ref": "…",
          "narration_type": "claim",
          "shot_class": "ironic-counterpoint",
          "source": "ai-gen",
          "still_prompt": "…",
          "notes": ""
        }
      ]
    }
  ]
}
```

Notes:
- `thumbnail.challengers` is exactly 2 for long-form (mirrors metadata's 2 challengers). Shorts have no
  thumbnail block — their `first_frame` **is** the thumbnail (§8/§11).
- `stock_query` present only when `source` ∈ {stock, hybrid, archival}; omit otherwise.
- **Deleted fields — do not author.** `on_screen_text`, `render_pattern`, `transition_in`, `ken_burns`,
  `within_shot_motion`, `motion_prompt`, `asset_type`, the beat-type treatment enum, and (on the
  `motion.json` side) `transform_note` / sprite-walk / `at_scene` are all retired. Old files carrying any
  of them still parse (consumers ignore unknown keys). The Remotion engine is the only render path; the
  camera is **always locked**, every shot hard-cuts (no transition field), **all in-video text is diegetic
  and baked into the generated image** (no engine text overlay, no device kit), and audio is authored
  separately by the `audio-director` skill (VPW authors no audio/treatment field).
- **`stage` / `stage_role` / `changed_elements` — held evolving stages (INTENT ONLY).** Consecutive shots
  that share a `stage` id sit on ONE persistent set: the `base` frame establishes it; each `delta` frame
  adds/moves ONE element, named in `changed_elements` as a **world-change** (`"+ cathedral rises"`,
  `"- ship"`, `"MacGregor slumps"`). This is the still-era realization of §13a-i's progressive reveal.
  **The delta-vs-layer boundary (enforced law).** A held scene evolves one of two ways. **DELTA-CHAIN**
  when the change is **INTEGRATIVE** — the new element becomes part of the scene's architecture (a city
  grows a bank; gold threads the streets). **LAYER** when the change is **DISCRETE** — the added element
  sits on the scene without fusing into its architecture (a character enters the foreground; a stamp slams
  onto a page). You author the intent the same way for both (`stage` / `stage_role` / `changed_elements`);
  this boundary tells you what a delta CAN be versus what `motion-planner` will promote downstream to a
  moving cutout **layer**. **A re-base inside the SAME location seeds the prior stage's BASE frame** (never
  the last delta — the ≤3-delta cap must not throw the established set away, or the set drifts). **Author
  intent, never mechanism:** do NOT encode HOW a delta is produced (no "seed off the previous frame", no
  `chain_from`, no generation params) — the chain is derivable from the shared `stage` + shot order.
  `image-generation` owns the delta mechanism (its "seeded delta-chain" technique); `motion-planner` owns
  layer promotion. Cap a chain at **≤3 delta frames**, then a new `base` (re-seeded from the prior base) or
  a hard cut to a new `stage`. Each frame — delta included — is still **one shot with its own verbatim
  `vo_ref`** (the word its change lands on). **Timing:** delta frames run fast (1.5–3s); `base`/hold frames
  4–12s.
- **Transitions are HARD CUTS only — fades / cross-dissolves / fade-to-black are BANNED.** This is a
  flat-vector cartoon channel; blended transitions read as photo-documentary B-roll (not our idiom).
  There is **no transition field to author** — `render-builder` emits **no** scene transition, ever.
  Visual continuity comes from held/evolving stages, never from blending.
- `thumbnail_source` lives **inside the `thumbnail` block only** (`"from-metadata.json"`, or the
  derived-fallback flag). Do **not** duplicate it at the top level.
- `beat` uses a **fixed vocabulary** (narrative POSITION):
  `hook` · `second-gate` · `premise` · `body` · `mid-arm` · `climax` · `withheld-peak` · `close`.
  Free-text beats are a contract break. **`beat` is authoring/review metadata** (narrative structure;
  potential future mid-roll grouping) — it does not drive the camera (always locked).
- **`vo_ref` is load-bearing for timing.** `render-builder` matches its **first 4 normalized words**
  against the real VO word-stream (`render.py::retime_by_timings`) to place the cut, so it MUST be a
  verbatim copy of the script's wording, and shots MUST be in **narration order** (each anchor at/after
  the previous). Paraphrase or disorder → that shot mis-times, and enough misses collapse the whole
  piece to crude proportional timing. `scripts/lint_shots.py` mirrors this matcher and HARD-fails on
  either — run it (`--write`) as the last authoring step.
- **`vo_text` + `shot_counts` are DERIVED and review-only** — written by `lint_shots.py --write`, never
  by hand, and ignored by every downstream tool. `vo_text` lets a human see each shot's VO coverage; it
  is **not** a depiction brief (a long span means *densify*, not *cram*). `shot_counts` is a convenience
  tally.
- **`cast` + `pose_ref`/`expression_ref` — the figure's pose/expression come from SEEDED library assets, not the `still_prompt`.** VPW records each prominent figure's registry pose/expression (INTENT); `image-generation` seeds them **directly into the one scene generation** — the character canonical + expression frame + pose frame (+ any interaction template) all seed a single run (no separate pre-merge pass; Pass 1b retired). **The `still_prompt` therefore describes the scene + the figure's placement/action ONLY — never its hand/finger mechanics, body-pose mechanics, or facial expression** (those are the `pose_ref`/`expression_ref` assets' job; authoring them in prose too is the double-authoring trap). `pose_ref`/`expression_ref` are each optional (pose-only / expr-only / both / neither). `cast` is how image-gen enumerates a shot's figures — it replaces prose figure-parsing. Seed doctrine: `style-bible.md §5`. A `cast` entry may name an individual character OR a **recurring identifiable group** (a band/troupe whose canonical is a group frame — typically no `pose_ref`/`expression_ref`); image-gen locks it once and seeds it into each appearance. An anonymous crowd stays prose in the `still_prompt`, never cast.
- **`props` — recurring-prop lock (parallel to `cast`).** A **recurring identifiable prop** (a specific
  object whose look must MATCH across shots — the guidebook, a named banknote) is declared in a shot's
  optional `props` array by its library name. `image-generation` Pass 1 gives each such prop ONE canonical
  (`assets/library/prop-<name>.png`, `prop-` prefix required) and seeds/reuses it into every appearance —
  no pose/expression, no merge; per-shot placement is composed in Pass 2 off the seeded canonical. Omit
  `props` when nothing recurs; a one-off prop stays composed per-scene from the `still_prompt` (no slot). A
  recurring prop named in the `still_prompt` prose but absent from `props` is an authoring gap (image-gen
  flags it back, like an uncast figure). `render-builder` ignores `props` (upstream-authoring only).
- **`needed_assets` — surface-then-gate.** When a shot needs a pose/expression/interaction the registry lacks, VPW adds an entry (`kind` + `slug` + **`wants`** = what to draw + `why`) and **HARD-STOPS** (does not proceed to generation). The human approves+generates on the base, or vetoes → VPW restages that beat onto EXISTING assets only. **Interactions are just `kind: interaction`** — same path, no special-casing; the `wants` description is what makes the request actionable.

---

## 2. Field → render-builder mapping

`render-builder` builds one scene per shot. **The default path is the local Remotion engine in
scenes mode:** `image-generation` turns each shot's `still_prompt` into a verified
`assets/scenes/<shot-id>.png`; `build_motion.py` derives a per-piece `motion.json` (contract:
`render-builder/references/motion-schema.md`) and the engine renders it — a missing scene for an
ai-gen/hybrid shot is a render-time hard error. What the engine consumes from each shot:

| shot field | Remotion engine (default) |
| --- | --- |
| `still_prompt` | image-generation's input → the verified scene PNG the shot displays |
| *(scenes/manifest.json `verified:{scene,rig}`)* | image-generation stamps `verified:{scene:true,rig:true}` on a shot only after its batched review passes; render-builder's scenes gate treats an unstamped/false entry as NOT shippable (a present-but-unverified PNG hard-errors like a missing one). Authored by image-gen, not VPW. |
| `stage` / `stage_role` / `changed_elements` | consecutive same-`stage` shots share ONE held set; changes arrive AT the cut (the delta frame); a delta may be promoted downstream by `motion-planner` to a moving cutout layer |
| `beat` | *(authoring/review metadata — narrative position; not consumed by the engine)* |
| `vo_ref`, `duration_s`, `start_hint` | cut timing: first 4 normalized words matched against the real VO word-stream, durations re-timed to the VO track |
| `source: chart\|screencap\|stock\|archival` | rendered as a visible placeholder device card (counted in the manifest); image-generation skips these |
| `narration_type`, `shot_class` | *(authoring metadata — never consumed)* auditability + anti-slop review |
| `vo_text`, `shot_counts` | *(derived, human-review only; written by `lint_shots.py`)* |
| `synthetic: true` (any shot/thumb) | feeds the AI-disclosure flag in `metadata.json` |
| `thumbnail.primary.gen_prompt` | generated by image-generation + set via `thumbnails.set` at publish |
| `cast` (`pose_ref`/`expression_ref`) | *(upstream authoring — seeded by image-generation into the one-run multi-seed scene gen; render-builder ignores)* |
| `props` | *(upstream authoring — consumed by image-generation for the per-video prop lock; render-builder ignores)* |
| `needed_assets` (top-level) | *(upstream authoring/human-gate — not consumed by render-builder)* |

The Remotion scenes path auto-detects the render path via the scenes manifest. Old files carrying any
retired field (see the deleted-fields note in §1) still render — consumers ignore unknown keys.

The VO track comes from `voiceover` (reads `script.md`). Real durations exist only after the VO
renders — `render-builder` re-times against it; `duration_s`/`start_hint` here are estimates.

---

## 3. Source-tag taxonomy (when to use which)

Doctrine (§13 / tools.md): pure-AI B-roll reads uncanny; blend real stock; show the work with
data/receipts. Pick the tag that makes the shot look *authored and credible*, not synthetic:

| `source` | Use for | Notes |
| --- | --- | --- |
| `ai-gen` | stylized, impossible, illustrative, or metaphor shots | full generation; set `synthetic` per realism |
| `stock` | real places / people / events that must look real | give a `stock_query`; blends out the uncanny look |
| `hybrid` | real subject + AI/graphic background (default thumbnail) | best proof-of-human; `stock_query` for the real half |
| `chart` | data, numbers, timelines ("show the work", §1b) | render-builder builds the viz; prefer numbers-as-objects |
| `screencap` | filings, headlines, receipts, product UI | credibility artifact; provide/point to the capture |
| `archival` | historical footage/photos | `stock_query`; check licensing note in playbook |

---

## 4. Prompt-writing patterns

### The supplied-text law (lint-enforced, HARD)

**A prompt may never ask the engine to render text, a number, a name or a date without
supplying that value VERBATIM, inline, right next to the element it belongs to.** There is
no "the engine will work it out" — a diffusion model asked for *a number* renders **a**
number, and an invented one on a documentary about a real person is a fabricated fact.

```
BAD   "a large marker scorecard number painted on its face"     -> engine rendered  1
BAD   "a hand-lettered 'PRODUCTS PER HOUSEHOLD' label over one prominent number"
                                                                 -> engine rendered  3.5
BAD   "a customer's name marker-written across the top"          -> engine invented a name
GOOD  "the single marker numeral '8' painted large on its face"
GOOD  "a 'PRODUCTS PER HOUSEHOLD' label over the figure '8'"
GOOD  "a customer's name 'J. RAMIREZ' marker-written across the top"
```

Three ways out, in order of preference:
1. **Supply it** — quote the literal from `research.md`'s fact ledger, citing the `[F-NN]`
   id in `notes`. The value must sit *next to its own element*: a literal supplied for the
   header does not license an unsupplied number elsewhere in the sentence.
2. **Omit the element** — if the ledger has no such fact, cut it. A boulder is still a
   boulder without a number on it; the beat survives, the fabrication doesn't.
3. **Author it as deliberately blank** — "a single BLANK name line", "the metric field left
   COMPLETELY EMPTY". An empty surface is a legitimate composition and reads as intentional.

Never resolve it by inventing a plausible-looking value yourself: that is the same
fabrication with an extra step.

`scripts/lint_shots.py` HARD-fails this across every `still_prompt`, `first_frame`, and
thumbnail `gen_prompt` in the file. `motion-planner` carries the identical law for
`cutout_prompt` / `plate_prompt` — the same defect, one skill downstream.

### The lettering-fidelity laws (lint-enforced)

The supplied-text law above governs a value that was **never supplied**. These four govern a
value that *was* supplied and still rendered wrong. They were derived by measuring the Wells
Fargo shot list against the **Poyais reference implementation**
(`videos/2026-07-04-poyais/`) — 236 shots, 250 authored literals — and each is stated with the
evidence that produced it, so a later author can overturn it with better evidence rather than
guess at the intent.

**L-1. Re-quote a carried literal on EVERY frame that redraws it (HARD).**
A delta frame regenerates the whole image, so every glyph in it is drawn again. Referring to an
established string by lowercase description hands those glyphs back to the engine.

```
L11  "a checking-account passbook on a small marker card labelled 'CHECKING'"  -> CHECKING  OK
L13  "a coin savings-jar added on a small marker card labelled 'SAVINGS'"      -> SAVINGS   OK
L14  "a login-screen icon added on a marker card labelled 'ONLINE'"            -> ONLINE    OK
L12  "a marker card labelled 'CARD' beside THE CHECKING PASSBOOK"              -> CHECKIG   FAIL
```
L12 is the only frame in that chain that did not re-quote, and the only one that garbled.
Repeating the literal **character-for-character** is fine even unquoted ("stacked on top of the
CFPB slab" — L78, clean); what breaks is downgrading it to lowercase prose. Case is the
discriminator.

**L-2. Keep production-control vocabulary out of the scene body (HARD).**
The engine cannot always tell an instruction from a label, and has lettered instructions into
the artwork:

```
L100  "...hold ONLY the rig form."          -> a document lettered  `rig form`
L69   "...gravity register, comedy off..."  -> a register labelled  `COMEDY OFF`
L42   the prompt's own editorial gloss      -> a caption reading
                                               `THE QUIET DAMAGE OF A CARD NOBODY WANTED`
```
What leaks is the **bare noun phrase naming a production rule**. The same constraint stated as a
property of a depicted body never leaked — "figures on the CROWD RIG: round heads, dot eyes, NO
noses, NO ears" is legal and common. State constraints as facts about the thing in frame.

*Corollary (advisory, not lint-checked):* the one-sentence editorial gloss this channel likes
("The machine that got absorbed into the bigger bank.", "The person who actually carries the
pressure.") adds nothing the engine can draw and is pure leak surface. **Put it in `notes`.**

**L-3. Authored lettering is capped at 4 words (HARD).**
SKILL rule 9's "1–4 words proven" is now enforced. Across 250 authored literals in the two
videos the single string that exceeds it — Poyais L97's 7-word
`'Official Shoemaker to the Princess of Poyais'` — is also a documented lettering defect. Past
roughly four words the per-glyph error rate compounds into an unreadable render. The cap is
**uniform**, including a short's `first_frame` caption.

**L-4. Prefer the word form for big numbers (advisory only — and the restraint is the point).**
All four Wells Fargo numeral garbles carry punctuation (`1,44.27`, `77,000`, `100,000`, a red
accent splitting `565,000`), which invites a ban. The measurement does not support one: Poyais
authored `'8,000,000 ACRES'` on a flat deed face and it rendered clean, and Wells Fargo's own
`'$5.4 MILLION'`, `'$1.95T'`, `'2.1M'`/`'2.55M'` and `'5,300 FIRED'` all rendered correctly and
check out against the ledger. Controlling for supply, the garble rate among digit-bearing
literals is **~6% (Wells Fargo) vs ~7% (Poyais)** — indistinguishable. Punctuation is not the
cause; **volume** is: Wells Fargo authors 19 punctuated numerals to Poyais's 3, so it ships
proportionally more numeral defects in absolute terms. Only a numeral carrying **two or more
separators in one digit run** draws a heads-up. Hard-failing this would flag 19 correct frames
to catch none of the four defects.

**What the measurement also killed.** Two plausible hypotheses were tested and **rejected**:
*string length* — Wells Fargo has **zero** literals over the 4-word cap and Poyais has one, so
long strings are not what distinguishes them; and *substrate naming* — both files attach
lettering to a named physical surface at similar rates. The real distinguishing variable is
**lettering saturation**: Poyais letters **37%** of its shots (73 literals over 117), Wells
Fargo **77%** (177 over 119). Wells Fargo asks the engine for 2.4× as many strings and gets
proportionally more failures. *Authoring fewer, shorter strings is the highest-leverage lever
available* — every string you do not author cannot garble.

**Read the Poyais claim carefully before treating it as a target.** Its lower absolute defect
count is substantially a **review-coverage artifact**: Wells Fargo ran an axis-explicit
lettering sweep over 119/119 frames, while Poyais declared its review axes as
identity-rig / fidelity / style with **lettering absent**, carried explicit letter-by-letter
transcription on only **29 of 117 shots (24.8%)**, and skipped fresh-eyes review entirely on 6.
Per text-bearing shot the two videos' documented defect rates are ~35% and ~37% — statistically
the same. Poyais is the reference implementation for *how to author* a literal, not evidence
that its process catches more.

## 5. Limits, defaults, timing


- **Long-form density:** New long-form plans start at **2–5 seconds per shot**, with density heaviest in the first 60 seconds.
- **Duration coverage:** derive runtime from the script header's stated WPM/runtime, require at least `runtime ÷ 5s` shots, and keep Σ `duration_s` approximately equal to runtime. Densify; never stretch holds to fill.
- **Earned long holds:** a hold over roughly six seconds needs a real progressive reveal or a short `hold_reason` for legibility or gravity.
- **Shorts density:** a cut every 2–4s (§11c); `first_frame` mid-action.
- `duration_s` is an estimate; `timing_status` flags re-timing after render.
- `synthetic` drives AI disclosure — set `true` on any photoreal AI shot/thumbnail so the flag in
  `metadata.json` is honored.
- Thumbnail `text_overlay` ≤3 words, no all-caps (§8c).

---


## Modern transport and integrity fields

- **`place` / `place_owner` / `owner_ambiguity`.** `place` is a kebab-case recurring diegetic set id. The source-aware plate is the first generated shot for that place. Its owner choice is exact: one quoted `place_owner` literal or `owner_ambiguity: true`, never both.
- **`place_anchor`.** A non-delta shot may reference a verified, current-digest local scene from the same `place`. Cross-place, stale, missing, parked, or ambiguous provenance is refused.
- **Parent and provenance.** Delta parents, repaired predecessors, source shots, seed roles, digests, and manifest identity are recorded explicitly. Only verified frames may ship.
- **Closed-world catalogs.** Pose, expression, interaction, and costume tokens must resolve in the declared registry/library; an unresolved token blocks.
- **Semantic delta floor (HARD).** A delta must name one non-empty, visually distinct, story-needed transformation; cosmetic, detail-only, label-only, or reposition-only changes do not earn a regenerated frame.

## Canonical chain and disclosure contract

- **Stage the run — held evolving stages (the anti-choppiness lever).** After inventing the
  shots, group **consecutive shots that share ONE setting/subject** into a `stage`: give them a common
  `stage` id, mark the first `stage_role: "base"` and the rest `"delta"`, and on each delta author
  `changed_elements` — **exactly ONE** world-change vs the prior frame (`"+ cathedral rises"`, `"- ship"`,
  `"MacGregor gains epaulettes"`, `"MacGregor's smugness drops to alarm"`), **anchored to its own word**:
  if the VO introduces a bank on "bank" and a coin on "its own money", that is TWO deltas (each its own shot
  + verbatim `vo_ref` on the word its element lands on), never one delta that adds both — bundling two at
  one cut blurs the reveal and mis-times the second against its word. A beat that adds several things at
  once is several fast deltas or a hard cut to a new base. A delta is the still-era
  progressive reveal: the set persists, one thing changes — that continuity (not a new scene each cut)
  is what reads like the reference channels. **An ADDITIVE beat is a shared-`stage` delta — author the
  addition, not the whole scene:** when a beat adds a discrete element to a scene already established (a
  character entering the held swamp; a 5-STAR stamp landing on the guidebook), keep the SAME `stage`, mark
  the shot `stage_role: "delta"`, and name ONLY the added element in `changed_elements` (`"+ MacGregor
  enters, stage-left"`, `"+ red 5-STAR stamp on the guidebook"`) — do NOT re-describe the established set in
  the delta's `still_prompt`; it persists from the base frame, you are adding one layerable thing.
  (Downstream, the motion-planner may realize this as plate-reuse + a matted cutout rather than a full
  re-gen, from the same `stage` + `changed_elements` — you author only the intent.) **Deltas are DECISIVE:** if the beat is a world-flip, the
  frame flips (a full palette turn, the paradise fully gone) — never a timid partial coexistence that
  makes the reveal mushy. **Hard-cut to a NEW stage only when the setting/subject/register genuinely
  changes.** Cap a chain at **≤3 deltas**, then a fresh base or a hard cut. **Timing:** delta frames
  run fast (1.5–3s); the base/hold frame holds longer (4–12s). **Author INTENT only** — name *what
  changes*, never *how it's produced* (no "seed off the previous frame", no `chain_from`;
  `image-generation` owns the mechanism, and the same metadata later drives a Remotion layer-move
  unchanged). Each frame stays a full shot with its own verbatim `vo_ref`; a shot with no shared
  `stage` is a standalone hard cut, as before.
- **Disclosure order — an image never reveals ahead of the narration (plan-level law).** A shot may
  contain only what the VO has already introduced by that shot's `vo_ref` position. When the script
  **deliberately withholds** a payload for a later beat (a character's identity, a fate, a twist
  object/number/place), that entity does **not** appear in any earlier shot — in **any pose or form**;
  the fix is to re-author the shot (or rework its stage chain) with the entity absent, never to obscure
  it. It's a cross-shot sequencing property, so the Step-8 critic enforces it at plan level
  (`references/critics.md`); an ordinary first-introduction is not withholding and is not a defect.

> Also check the plan-level checks. **Delta decisiveness** (a world-flip delta must flip the frame —
> flag timid partial changes, e.g. a "paradise peels away" where paradise visibly remains). **Stage
> grouping** — here your job is the **SEMANTIC call only**: *are these really one held set?*
> (consecutive shots on one set that were NOT chained into a stage, or a chain whose set changes so
> much it isn't really held); the **mechanical caps** (exactly one `base`, ≤3 `delta`s, contiguity,
> delta timing, `stage_role` order) are `lint_shots.py`'s job — do **not** re-flag those.
> **Disclosure order** — does the script **deliberately withhold** a payload for a later beat (a
> setup→payoff: a character's identity, a fate, a twist object/number/place)? If so, flag the
> **earliest** shot that visually discloses it before the narration does. Fix direction: **re-author**
> that shot (or rework the chain if it's a `base`/`delta`) so the withheld entity is **absent
> entirely** — never merely obscured (back-to-viewer/silhouette still puts a recognizable figure in
> frame and dodges the rule).
