# shots.json — schema v2, text laws

The exact contract `visual-prompt-writer` writes and `render-builder` (+ `publish-queue` for the
thumbnail) reads — one file per video at `channels/<name>/videos/<slug>/shots.json`. Follow it exactly so
`render-builder` maps onto its render call with **no interpretation**; the field → engine mapping lives in
`render-builder/references/motion-schema.md §2`.

## 1. Full JSON shape

```json
{
  "schema": "faceless-youtube/shots@2", "channel": "<channels/ folder slug, e.g. the-second-take — NOT the display name>", "video_slug": "YYYY-MM-DD-slug",
  "source_idea_id": "<id from idea-backlog.md>", "generated": "YYYY-MM-DD", "status": "shots-drafted",
  "global_prompt_suffix": "copied VERBATIM from visual-grammar.md's header — the LETTERING clause only; the style recipe lives in style-bible.md §2b and is never restated here",
  "long_form": { "aspect_ratio": "16:9", "shots": [
      {
        "id": "L01", "duration_s": 4, "synthetic": false,
        "vo_ref": "VERBATIM opening words of the VO line, copied exactly from script.md — ≥4 where the sentence has them, else its full text",
        "vo_text": "DERIVED by lint_shots.py --write; never hand-authored",
        "place": "OPTIONAL kebab-case recurring diegetic SET id (e.g. \"miniscribe-boardroom\") — distinct from `stage`; omit on the exempt shot_class values, a short's `first_frame`, and the thumbnail block",
        "stage": "OPTIONAL id shared by consecutive shots on ONE persistent set (e.g. \"guidebook-desk\"); omit or unique = a standalone one-frame stage",
        "stage_role": "base | delta — base establishes the set + subject; delta = ONE element added or moved on the SAME set", "changed_elements": ["+ golden city rises"],
        "place_anchor": "OPTIONAL on a non-delta shot: video-relative assets/scenes/<human-approved-frame>.png to preserve this video's approved place; never a cross-video env reference, never a shot outside its own `place`",
        "hard_cut": "OPTIONAL true — this shot's action deliberately does NOT continue the previous shot's, even though it reads like it might (see `place` §2's action-chain law)",
        "place_owner": "ON A PLACE'S PLATE ONLY: the owner literal drawn on this frame (e.g. \"MINISCRIBE\"), quoted verbatim in this shot's still_prompt too — see the place-owner law; mutually exclusive with `owner_ambiguity`",
        "owner_ambiguity": "ON A PLACE'S PLATE ONLY: true — this place's ownership is intentionally left unmarked (see the place-owner law); mutually exclusive with `place_owner`",
        "shot_class": "the canonical closed list (picked from visual-grammar.md's narration→shot-class table): personified-character, staged-interaction, symbolic-stand-in-object, number-glued-to-object, diegetic-device, map-plan-view, physicalized-imbalance, register-shift-infographic, ironic-counterpoint, reaction-shot, idiom-pun, aftermath-palette-turn, crowd-multiplication, literal",
        "source": "ai-gen | stock | hybrid | chart | screencap | archival (§3)",
        "still_prompt": "the image-gen prompt: subject, composition/framing + scale, lighting, palette, and the shot's load-bearing scene FACTS. Cast, poses, and expressions are named INLINE by their registry vocabulary name, backticked. In-video text is DIEGETIC + baked here, quoted VERBATIM and kept SHORT (1–4 words)",
        "figures": { "crowd": true },
        "stock_query": "search terms — only when source is stock|hybrid|archival, else omit",
        "notes": "policy/accuracy flags (analysis-not-gore, YMYL, borderline) + the [F-NN] ledger ids behind any supplied literal"
      }
  ]},
  "thumbnail": { "thumbnail_source": "derived-from-script+dna",
    "primary": { "source": "per the channel's LOCKED register in dna.md — an illustrated channel's thumbnail is ai-gen; hybrid/stock only where a real photographic subject is on-register", "text_overlay": "≤3 words or \"\"", "gen_prompt": "full prompt — one hero with one loud emotion, ONE dominant thing legible at 168px, the red accent pointing", "composition": "framing notes — rule-of-thirds, red-circle-on-anomaly, number-as-object", "synthetic": "true ONLY when the render is photoreal (it drives the AI-disclosure flag); false for a drawn/animated register" },
    "challengers": [ "exactly two more objects of the same shape as primary" ] },
  "shorts": [
    { "file": "shorts/short-01.md", "archetype": "string (from the short)", "status": "publish | bench", "aspect_ratio": "9:16",
      "first_frame": { "source": "ai-gen", "still_prompt": "a pattern-interrupt tableau already carrying the beat's tension (a held pose, not a freeze of motion); any on-frame caption is DIEGETIC + baked into the image, quoted verbatim, ≤4 words", "synthetic": false },
      "shots": [ { "id": "S01-01", "duration_s": 3, "vo_ref": "…", "shot_class": "ironic-counterpoint", "source": "ai-gen", "still_prompt": "…", "notes": "" } ] }
  ]
}
```

## 2. Field semantics

- **`vo_ref` is load-bearing for timing.** `render-builder` matches its **first 4 normalized words** —
  or all of them when the line is shorter — against the real VO word-stream
  (`render.py::retime_by_timings`) to place the cut, so it is a verbatim copy of the script's wording
  (**≥4 words where the sentence has them; a shorter sentence anchors on its full text**, exact order)
  and shots run in **strict narration order**; `lint_shots.py` mirrors that matcher and HARD-fails both
  defects. The stream is SPOKEN text only — a whole-line italic authoring note is excluded from it, so
  nothing can anchor there.
- **`vo_text` is DERIVED, review-only** — written by `lint_shots.py --write`, never by hand; a long span
  means *densify*.
- **`place` — a recurring diegetic SET identity, distinct from `stage`.** `place` names the SET
  (`miniscribe-boardroom`, `brick-co-yard`); `stage` is a continuity CHAIN *within* one place (still capped
  1 base + ≤2 deltas). A place can host many stage chains — the boardroom's fear beat, firing beat, and
  planning beat are three `stage`s inside one `place`. **The plate of a place is the FIRST-IN-FILE GENERATED
  shot declaring that place** (`source: ai-gen | hybrid`, absent defaults to `ai-gen`) — one definition,
  decidable from the authored file alone (`lint_shots.py`'s `place_groups`). A stock/chart/screencap/archival
  shot is skipped, mirroring `forge.py cmd_batch`'s own skip of non-generated shots before it ever picks a
  plate; a place with no generated shot has no plate at all. **Conditional plate law (lint-enforced, HARD):**
  a place QUALIFIES when it RECURS, or its plate declares `place_owner`; a qualifying place's plate
  must declare **zero SEEDED figures (named cast) and no `stage_role: delta`**, because every
  other shot in the place seeds it and whatever it contains bleeds into all of them. Cast-free is a
  rule about seeded FIGURES and never about content: a plate is authored at working occupancy, and a
  place carrying a long run declares 2-3 plate VARIANTS that `place_anchor` selects between — both
  stated once, with their bounds, in `visual-grammar.md` §2's plate bullet. **A place RECURS when the file REVISITS it after
  leaving** — its shots form two or more NON-CONTIGUOUS runs. An unbroken single visit, however many shots
  long, is a STAGE: its chain base already IS the frame every later shot of the run seeds, so declaring a
  place there buys nothing and demanding a dedicated cast-free plate for a set the video never returns to is
  pure generation cost. (That is the decidable reading of "recurring set". The old "≥2 shots declare it"
  test was circular — whether a set qualified depended on whether the author had declared it — and it read
  two adjacent shots as a recurrence.) A single-visit, unbranded place needs no plate: its first generated
  shot is its own place-first frame and runs seedless, same as today. `forge.py
  cmd_batch` derives the same frame MECHANICALLY (the slate that ended up with zero seeds is the one it
  marks `plate`; VPW never authors `plate` itself), so lint asserts on the authoring side, at $0, the
  coincidence forge assumes at gen time.
  **Place-inventory law (lint-enforced,
  HARD):** every declared `place` must anchor to a word `script.md` itself uses (`script_vocab`) — an
  invented place is the same class of error as an invented lettering literal. **Exempt (never declare
  `place`):** the symbolic/abstract/object-insert `shot_class` values — `symbolic-stand-in-object`,
  `number-glued-to-object`, `map-plan-view`, `physicalized-imbalance`, `register-shift-infographic`
  (`visual-grammar.md §1`'s table: each depicts a floating object or abstraction, never a set) — plus a
  short's `first_frame` and the thumbnail block; these run as seedless roots under the bible descriptor + style suffix
  regardless of place. A beat that genuinely wants BOTH an exempt class and its set may be authored in a
  non-exempt class instead (`literal`, `ironic-counterpoint`, `staged-interaction`) to keep it on the set —
  a class is a depiction decision, and losing the setting to a schema rule is the worse trade. Record the
  swap in `notes` so the critic reads it as a choice.
- **Place-owner law (lint-enforced, HARD = a FORCED CHOICE).** Every place's plate declares **exactly one**
  of `place_owner: "<LITERAL>"` or `owner_ambiguity: true` — neither is a hard failure, both is a hard
  failure, and neither field may be declared on any other shot of the place. Silence is not an option
  precisely because a forgotten owner cue leaves no trace to detect: ownership invisible on the establishing
  frame is audit failure #6. A declared `place_owner` must also be **quoted verbatim in the plate's own
  `still_prompt`** — it is a DRAWN cue, so it is an ordinary authored literal and every lettering law
  already applies to it unchanged (the 1–4-word/25-glyph caps, the 3-literals-per-prompt cap, script-vocab
  sourcing, and L-1 carry — `carried_literal_check` treats it as established for the whole PLACE, across
  stage runs, so any later in-place shot that redraws the sign must re-quote it verbatim). The literal is
  per-video DATA sourced from the shot's `place` + `script_vocab`, never a skill constant.
  **`owner_ambiguity: true` is a FIRST-CLASS answer, not the weak branch.** It is the HONEST default
  wherever the script does not establish visible branding — a rented warehouse, a period shopfront, a
  stockroom, a market stall. Reaching for `place_owner` because ambiguity "looks like the lesser answer"
  produces INVENTED SIGNAGE, which is exactly the fabrication the text laws exist to stop; and unmarked
  ownership is often the authored read (a warehouse that is anonymous, off-site and rented, where the
  anonymity is the point). The forced choice exists so an ownership DECISION is on the record, never to
  push a place toward a drawn name. **This narrows
  the supplied-text law's "omit" escape (§4 resolution 3):** blanking an owner-branded surface with no cue
  is legal ONLY paired with `owner_ambiguity: true` — a silent blank no longer satisfies the place-owner law
  the way it satisfies an ordinary unsupported-glyph field.
- **Action-chain law (lint-enforced, HARD = presence).** Fires on exactly one shape, all four conditions at
  once: two shots ADJACENT IN FILE declare the same `place`, both shots' `vo_text` name a shared concrete
  prop noun, the later shot declares no `stage`/`stage_role` chain **at all**, and it does not declare
  `hard_cut: true`. That is an unlinked continuation — three shots visibly continuing one action (pry the
  box, swap the sheet, get caught) must not run as three independent seedless roots. The test reads the
  NARRATION, never `still_prompt` idioms: "the same X" is routinely intra-frame English ("at the same
  eye-line" is the clause the two-figure law itself demands), and a lint that cries wolf gets routed around.
  A shot that declares any chain of its own has made a positive continuity statement and stays silent —
  whether that chain reads as coherent CAUSE→EFFECT is the shot critic's judgment (`critics.md`), never
  lint's, and no author is ever pushed into declaring `hard_cut: true` about an action that does continue.
- **`stage` / `stage_role` / `changed_elements` — held evolving stages, INTENT ONLY.** Consecutive shots
  sharing a `stage` id sit on ONE persistent set: the `base` establishes it, each `delta` adds or moves
  exactly ONE element named in `changed_elements` (`"+ cathedral rises"`, `"- ship"`), each its own shot
  with its own verbatim `vo_ref`. **Delta-vs-layer boundary:** an INTEGRATIVE change (the element joins
  the scene's architecture) stays a delta frame; a DISCRETE one (a character enters, a stamp slams onto a
  page) is promoted downstream by `motion-planner` to a moving cutout LAYER. Lint enforces exactly one
  `base`, first, per stage · **≤2 deltas** per chain · contiguity.
- **Delta character-entrance law (lint-enforced, HARD).** A seeded figure's FIRST appearance on a set is
  never a `delta`. The delta seeding path supplies [in-chain parent + canonical] and nothing else, so a
  figure absent from the parent FRAME has no pixels to inherit: its pose and expression become prose
  against an image that does not contain it, and prose loses to the strongest image input. Declaring the
  primitives does not rescue it — a delta may prove exactly ONE, so an entrance can carry pose *or*
  expression, never both, and dropping the expression to clear the gate silently loses register on the
  beats that carry the emotion. Author an entrance as a stage `base` (the figure's step-1 card is seeded,
  carrying pose AND expression) or open a new stage on that shot. The parent is forge's own binding: the
  previous shot in file order sharing this shot's `place or stage or id`, not simply the previous line.
- **Interaction-template law (lint-enforced, HARD; forge refuses in parallel).** An `interaction`-kind
  registry slug (`handshake`, `handoff`, `fistbump`, `action-tugofwar`) is a TWO-FIGURE geometry
  reference — two blank mannequins carrying clasp geometry and eye-line — and seeds the SCENE alongside
  both figures' step-1 cards, never one figure's pose slot. Legal only on a shot naming exactly 2 SEEDED
  figures (2 named cast), and never on a `stage_role: delta` (that slate is parent +
  both canonicals + one proved primitive, with no slot left). Solo, or on a delta: stage the gesture in
  prose and drop the slug, or move the contact to the stage base. `visual-grammar.md §2` carries the
  figure-cap slate.
- **Payload-last law (lint-enforced, HARD).** A NON-delta shot carrying a quoted literal must END on that
  literal's clause (`visual-grammar.md §2` ordering law). Deltas are exempt — their final clause is the
  one change plus the sanctioned closing formula. A literal the shot merely carries under L-1 (a place's
  owner sign, redrawn) is not that shot's payload and is exempt too, so the carry rule can never push a
  sign into the payload slot. The commonest break is a trailing "Framing: … Palette: …": author those
  facts BEFORE the lettered element.
- **Lettering route (forge-DERIVED; lint-enforced, HARD, after Pass 1).** `style-bible.md §5` is LOCKED —
  `lettering-marker-italic` seeds every text-bearing gen. `forge.py` DERIVES that seed from the prompt
  (any supplied quoted literal), the same way it derives the crowd rig from `figures.crowd`, so a LOCKED
  style law never depends on an author remembering a field. VPW authors nothing for it. Once
  image-generation's Pass 1 has written an `assets` block, lint HARD-fails a text-bearing shot whose block
  omits the exemplar or lists it in `assets_omitted`. Backticked registry `prop`/`environment` slugs are
  derived the same way, so a named prop can no longer ship as an unresolved control token.
- **Real-cadence heads-up (lint, HEADS-UP).** When `assets/voiceover.manifest.json` exists, lint computes
  each shot's REAL hold from the forced-alignment word timings `render-builder` cuts on, and flags any
  hold outside the §5 band (1.5–3s, 4s earned). `duration_s` is an ESTIMATE and the real hold is the
  truth: on the reset's first fifth the two diverged by up to +2.36s and 11 of 41 real holds fell outside
  the band while the declared average read "in band". Heads-up rather than HARD because the author sizes
  before any VO exists and the fix is a re-author (split an anchor, merge two), not a field edit.
- **`place_anchor` — an approved in-video place seed, legal on any non-delta shot with an established
  `place`.** Optional; write the human-picked frame as a non-empty normalized direct `assets/scenes/<id>.png`
  path (no absolute, traversal, backslash, nested, or cross-video path), never on a `stage_role: delta` (a
  delta continues its own base's held scene — a different seed, already covered by the chain parent).
  `lint_shots.py` checks that structural contract; `forge.py batch` requires that exact existing file under
  this video's own `assets/scenes/` after resolving links/junctions, seeds it after any STEP-1 figure frames
  and before the crowd exemplar, and does not mark the base as a new `plate`; it can never import a
  cross-video environment. **Same-place law (HARD, both lint and forge):** the anchor's source shot (its
  filename stem is that shot's own `id`) and the anchoring shot must declare the SAME `place` — cross-place
  image seeding is the probe-refuted style-anchor failure under another name (`decisions.md` 2026-08-04); a
  plate may only seed shots in its own place. Omit it for ordinary first-place bases and every existing shot
  — their current place-first behavior is unchanged.
- **`figures` — crowd is DECLARED here, never described in rig prose.** Optional; omit the whole key when
  a shot has none. **`crowd`**: `true` when the shot stages crowd figures (§2d tier); omit when false.
  `forge.py` expands the declaration into the style-bible §2d clause at gen time, so **no prompt ever
  contains that clause text**: `lint_shots.py` HARD-fails its fingerprint, wrong shape, or unknown key.
  Seeded figures are never declared here (they are inline registry names, next bullet).
- **Casting is PROSE, by vocabulary name.** Every recurring figure, pose, expression, and already-built
  prop is named inline in the `still_prompt` by its exact `registry.json` name, backticked — there are no
  structured cast/pose/expression arrays. **THE RIG TEMPLATE `` `base` `` IS NEVER CAST:** it is not a
  character (`style-bible.md` §1: it never appears as ITSELF), `forge.py`'s `shot_cast` does not resolve
  it as a figure, and `seeding_law_violations` refuses a shot that names it. An anonymous foreground
  story-bearer is CAST — resolved to an existing cast member where the story says it IS one, otherwise
  planned at VPW step 3a as a NEW named cast member and minted through the standard cast-generation waves
  — or the beat is restaged as mass action (`figures.crowd`). A prop making its FIRST appearance has
  no entry to name and is described in prose instead (`visual-grammar.md` §2 owns that rule).
  `image-generation` resolves names → files and surfaces any name the registry lacks at its Pass-1 human
  gate, before a token is spent.
- **Seat/support law (lint-enforced, HARD).** A seeded figure carrying the registry `sit` pose primitive
  (the binding is the backtick order — a `sit` token bound to the most-recently-named character, mirroring
  `forge.py`'s `shot_cast` — **never the English verb "sits"**, which this project's own prose uses
  constantly for OBJECTS: "the metal desk sits pushed aside", "a brick sits on its end") must name, in the
  SAME SENTENCE, a support from `chair | stool | bench | seat | crate | step | ledge | desk edge | sill`
  plus a contact phrase. This is presence only; whether the FRAMING actually shows the support is a soft
  heads-up plus a forced review row, never lint-decidable.
- **Two-figure presence law (lint-enforced, HARD = presence).** A shot naming 2 SEEDED figures (named
  cast) must state a plane clause, an eye-line clause, and a relative-head-scale clause (`"dominant"` legally resolves
  a scale clause via posture/framing). Presence only — whether the stated clauses actually cohere into the
  right topology is the shot critic's judgment (`critics.md`), not lint's.
- **Semantic-cast law (lint-enforced, HARD, narrow).** Fails ONLY the decidable case: a shot's VO span
  names a generic PLURAL role ("managers", "executives") while the shot casts a named character whose slug
  fragment appears nowhere in that VO span or its immediate neighbours. A shot where the VO itself names the
  role ("the foreman told his crew") is a legitimately justified lead and stays silent — the comparison is
  singularized on both sides, so a plural role justifies a singular slug ("the bankers" ⇒ `hq-banker`). Whether a *cast*
  choice is dramatically right beyond that narrow test is the critic's call.
- **`assets` (image-gen-owned, added in Pass 1).** `image-generation` writes a per-shot `assets` map
  (`{"<vocab name>": "<library path>"}`) back into this file after its gate passes; VPW never authors it and
  `render-builder` ignores it. Pass 2 reads those tags UNIONED with what it derives from the prompt (the
  lettering route, above), so a missing tag no longer silently drops a seed. `lint_shots.py` reads the block
  for one thing only: the post-Pass-1 lettering assertion.
- **Transitions are HARD CUTS only** — no transition field exists; continuity comes from held stages.
- **`global_prompt_suffix` is copied verbatim** from `visual-grammar.md`'s header — never re-derived per
  video — and appended to every `still_prompt`, `first_frame`, and thumbnail `gen_prompt`. **One-voice law
  (lint-enforced, HARD):** the suffix carries **no style vocabulary at all** — it is the lettering clause
  and nothing else. Three refusals, one per way of breaking it: a banned render-technique term (below),
  soft/gradient-permissive wording ("gentle", "soft", "blended"/"feathered"), or the style RECIPE's own
  terms restated here (cel shading, flat colour fills, hard-edged single-step shadow, outline, line weight,
  palette, a hex colour…). The last one is architecture, not taste: the recipe has exactly one home —
  `style-bible.md` §2b, which `forge.py` assembles onto every generation — and a suffix that also carries it
  is a second COPY of a living document, which becomes a second VOICE the moment either side is edited.
  That divergence is how the global smooth/glossy drift happened. **Banned
  render-technique terms (lint-enforced, HARD, prompts AND suffix, case-insensitive, exact list):**
  `gradient`, `gloss`/`glossy`, `specular`, `bloom`, `depth-of-field`/`depth of field`, `blurred
  background`/`blurred behind`, `soft focus`, `photoreal*`, `subsurface`, `rim light`. Scene-light NOUNS —
  `warm`, `amber`, `glow`, `lit`, `lamp` — are never flagged; they describe committed scene lighting, not a
  render technique, and are common in correct prompts ("warm lamp amber").
- `thumbnail.challengers` is exactly 2 for long-form; shorts have no thumbnail block — `first_frame` IS it.
- **Deleted fields — do not author.** Consumers ignore unknown keys and `lint_shots.py` warns rather than
  errors on a legacy file; list + rationale in `docs/retired-features.md`.

## 3. Source-tag taxonomy (when to use which)

| `source` | Use for | Notes |
| --- | --- | --- |
| `ai-gen` | stylized, impossible, illustrative, or metaphor shots | full generation; set `synthetic` per realism |
| `stock` | real places / people / events that must look real | give a `stock_query`; blends out the uncanny look |
| `hybrid` | real subject + AI/graphic background | best proof-of-human, and the usual thumbnail pick on a channel whose locked register admits a photographic subject; `stock_query` for the real half |
| `chart` | data, numbers, timelines | render-builder builds the viz; prefer numbers-as-objects |
| `screencap` | filings, headlines, receipts, product UI | credibility artifact; provide or point to the capture |
| `archival` | historical footage/photos | `stock_query`; check the licensing note in playbook |

## 4. Text laws

**The supplied-text law (lint-enforced, HARD).** A prompt may never ask the engine to render text, a
number, a name, or a date without supplying that value **verbatim, inline, right next to the element it
belongs to.** A diffusion model asked for *a number* renders **a** number, and an invented one on a
documentary about a real person is a fabricated fact. Three resolutions, in order of preference:
1. **Supply it** — quote the literal from `research.md`'s fact ledger and cite the `[F-NN]` id in
   `notes`. Each value sits next to its own element; a literal supplied for the header does not license
   an unsupplied number elsewhere in the sentence.
2. **Omit the element** — no ledger fact, cut it. The beat survives; the fabrication doesn't.
3. **Blank or omit only the unsupported glyph field; retain the diegetic object and the surrounding full set.**

Never resolve it by inventing a plausible-looking value: that is the same fabrication with an extra step.
`scripts/lint_shots.py` HARD-fails this across every `still_prompt`, `first_frame`, and thumbnail
`gen_prompt`; `motion-planner` carries the identical law for `cutout_prompt` / `plate_prompt`.

**The lettering-fidelity laws (lint-enforced)** govern a value that *was* supplied and still rendered
wrong:
- **L-1. Re-quote a carried literal character-for-character on EVERY frame that redraws it (HARD).** A
  delta regenerates the whole image, so every glyph is drawn again; repeating the literal in the same
  case is enough, quoted or not, while downgrading an established string to lowercase description hands
  those glyphs back to the engine and garbles them. Case is the discriminator.
- **L-2. State a constraint as a property of the depicted thing (HARD).** The engine cannot always tell
  an instruction from a label and letters a bare noun phrase naming a production rule into the artwork.
  "the ledger's columns ruled but blank and unlettered" is legal; a production-rule name ("CROWD RIG") or
  a bare directive ("NO TEXT") is not — it gets drawn. Rig wording belongs in `figures`, never in the
  prose; the one-sentence editorial gloss goes in `notes`, never in the prompt.
- **L-3. Authored lettering is capped at 4 words (HARD)** — past roughly four the per-glyph error rate
  compounds into an unreadable render. The cap is **uniform**, including a short's `first_frame` caption.
- **L-4. Prefer the word form for big numbers (advisory).** `'8 MILLION'` over `'8,000,000'` where the
  beat allows. Only a numeral carrying **two or more separators in one digit run** draws a heads-up.

**Author fewer strings — the highest-leverage lever there is.** A string you do not author cannot garble,
and lettering saturation drives a file's absolute defect count; before writing a literal, ask whether the
composition can carry the meaning instead.

## 5. Limits, defaults, timing

- **Density:** a new shot every **1.5–3s**, up to 4s only where the beat earns it, weighted heaviest in
  the first 60s; shorts cut every 2–4s.
- **Duration coverage:** Σ `duration_s` across `long_form.shots[]` ≈ the script header's `Estimated
  runtime`, sized off **the rate that header states** ("N words ÷ M wpm" — the channel's measured voice,
  not a fixed constant; 150 wpm is only the fallback when the header states no rate), with at least
  **`runtime ÷ 4s` shots**. A short-summing list gets stretched by `render-builder`'s re-time, destroying
  the cadence — densify, never lengthen holds to close a gap.
- **Holds:** deltas run 1.5–3s, a base/hold frame 4–12s; a diagram-first shot that progressively reveals
  may hold 10–14s (the in-shot annotation is the stimulus refresh). Event/reveal/silence shots stay
  1.5–3s.
- `duration_s` is an estimate; `render-builder` re-times against the real VO track.
- `synthetic` drives AI disclosure — set `true` on any photoreal AI shot or thumbnail so the flag in
  `metadata.json` is honored. Thumbnail `text_overlay` ≤3 words, no all-caps.
