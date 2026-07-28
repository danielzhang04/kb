# shots.json — schema, render mapping, text laws

The exact contract `visual-prompt-writer` writes and `render-builder` (+ `publish-queue` for the
thumbnail) reads. One file per video at `channels/<name>/videos/<slug>/shots.json`. Follow it exactly
so `render-builder` maps onto its render call with **no interpretation**.

## 1. Full JSON shape

```json
{
  "schema": "faceless-youtube/shots@1", "channel": "<channels/ folder slug, e.g. collapse — NOT the display name>", "video_slug": "YYYY-MM-DD-slug",
  "source_idea_id": "<id from idea-backlog.md>", "generated": "YYYY-MM-DD", "status": "shots-drafted", "timing_status": "estimated-from-script — re-time after render",
  "shot_counts": { "_note": "derived tally; not consumed downstream", "long_form_shots": 0, "thumbnail_prompts": 0, "shorts": 0, "shorts_shots": 0, "total_prompts": 0 },
  "house_style": { "palette": "≤2–3 core colors + accent, from dna.md", "typography": "on-screen text treatment", "footage_type": "dominant medium — motion-graphics / hybrid-stock / stylized-AI / 3D", "motion_feel": "default camera energy — slow-cinematic / snappy-doc / kinetic", "avoid": "off-style things to never render", "aspect": {"long_form": "16:9", "shorts": "9:16"} },
  "global_prompt_suffix": "style string appended to EVERY still_prompt and thumbnail gen_prompt — palette, medium, lighting, texture, era",
  "long_form": { "aspect_ratio": "16:9", "shots": [
      {
        "id": "L01", "beat": "narrative POSITION, from the fixed vocabulary in the notes below", "start_hint": "0:00", "duration_s": 4, "from_cue": true, "synthetic": false,
        "hold_reason": "required once duration_s exceeds roughly 6s — the real progressive-reveal, legibility, or gravity reason, never a generic cadence exemption",
        "vo_ref": "VERBATIM opening words (≥4) of the VO line, copied exactly from script.md", "vo_text": "DERIVED by lint_shots.py --write; never hand-authored",
        "stage": "OPTIONAL id shared by consecutive shots on ONE persistent set (e.g. \"guidebook-desk\"); omit or unique = a standalone one-frame stage",
        "stage_role": "base | delta — base establishes the set + subject; delta = ONE element added or moved on the SAME set", "changed_elements": ["+ golden city rises"],
        "narration_type": "abstract-force | deal | institution | number | comparison | event | mechanism | spatial | claim | aside | idiom | grim | scale | physical-action",
        "shot_class": "the canonical closed list of class names (SKILL Step 2.5 maps onto it per universal §13a): personified-character, staged-interaction, symbolic-stand-in-object, number-glued-to-object, diegetic-device, map-plan-view, physicalized-imbalance, register-shift-infographic, ironic-counterpoint, reaction-shot, idiom-pun, aftermath-palette-turn, crowd-multiplication, literal",
        "cast": [ { "character": "<registry character name>", "pose_ref": "<registry pose slug — OMIT if none>", "expression_ref": "<registry expression slug — OMIT if none>" } ],
        "props": ["<recurring-prop library name — OMIT if none recur>"], "source": "ai-gen | stock | hybrid | chart | screencap | archival (§3)",
        "still_prompt": "the image-gen prompt: subject, composition/framing + scale, lighting, palette, and the shot's load-bearing scene FACTS. In-video text is DIEGETIC + baked here, quoted VERBATIM and kept SHORT (1–4 words)",
        "stock_query": "search terms — only when source is stock|hybrid|archival, else omit", "notes": "policy/accuracy flags (analysis-not-gore, YMYL, borderline) + the [F-NN] ledger ids behind any supplied literal"
      }
  ]},
  "needed_assets": [ { "kind": "pose | expression | interaction", "slug": "<new-asset-slug>", "wants": "<what the asset should draw>", "why": "<which shot/beat needs it>" } ],
  "thumbnail": { "thumbnail_source": "from-metadata.json",
    "primary": { "source": "hybrid", "text_overlay": "≤3 words or \"\"", "gen_prompt": "full prompt honoring §8 — dominant subject, ≥50% negative space, ≤2 colors, proof-of-human", "composition": "framing notes — rule-of-thirds, red-circle-on-anomaly, before/after split, number-as-object", "synthetic": true },
    "challengers": [ "exactly two more objects of the same shape as primary" ] },
  "shorts": [
    { "file": "shorts/short-01.md", "archetype": "string (from the short)", "status": "publish | bench", "aspect_ratio": "9:16",
      "first_frame": { "source": "ai-gen", "still_prompt": "a pattern-interrupt tableau already carrying the beat's tension (a held pose, not a freeze of motion); any on-frame caption is DIEGETIC + baked into the image, quoted verbatim, ≤4 words", "synthetic": false },
      "shots": [ { "id": "S01-01", "duration_s": 3, "vo_ref": "…", "narration_type": "claim", "shot_class": "ironic-counterpoint", "source": "ai-gen", "still_prompt": "…", "notes": "" } ] }
  ]
}
```

Notes:
- **`vo_ref` is load-bearing for timing.** `render-builder` matches its **first 4 normalized words**
  against the real VO word-stream (`render.py::retime_by_timings`) to place the cut, so it must be a
  verbatim copy of the script's wording (≥4 words, exact wording and order), and shots must be authored
  in **strict narration order** — each anchor at or after the previous. `lint_shots.py` mirrors that
  matcher and HARD-fails both defects; run it (`--write`) as the last authoring step.
- **`vo_text` + `shot_counts` are DERIVED, review-only** — written by `lint_shots.py --write`, never by
  hand, ignored downstream. A long `vo_text` span means *densify*, never cram one prompt.
- **`stage` / `stage_role` / `changed_elements` — held evolving stages, INTENT ONLY.** Consecutive shots
  sharing a `stage` id sit on ONE persistent set: the `base` establishes it, each `delta` adds or moves
  exactly ONE element named in `changed_elements` as a world-change (`"+ cathedral rises"`, `"- ship"`).
  **Delta-vs-layer boundary:** an INTEGRATIVE change (the element joins the scene's architecture — a city
  grows a bank) stays a delta frame; a DISCRETE one (the element sits on the scene without fusing — a
  character enters, a stamp slams onto a page) is promoted downstream by `motion-planner` to a moving
  cutout LAYER. **A re-base inside the SAME location seeds the prior stage's BASE frame**, so the set
  survives the hop. Author intent, never mechanism (no `chain_from`, no seed or generation params —
  `image-generation` owns it). Lint enforces exactly one `base`, first, per stage · **≤3 deltas** per
  chain · contiguity; then a fresh `base` or a hard cut. Each frame is one shot with its own verbatim
  `vo_ref` (the word its change lands on); deltas run 1.5–3s, `base`/hold frames 4–12s.
- **Transitions are HARD CUTS only.** There is no transition field and `render-builder` emits no scene
  transition; continuity comes from held/evolving stages.
- **`cast` + `pose_ref`/`expression_ref` record INTENT**; `image-generation` seeds the character
  canonical + expression frame + pose frame (+ an interaction template) into the one scene generation, so
  the `still_prompt` describes the scene and the figure's placement/action **only** — never hand/finger
  mechanics, body-pose mechanics, or facial expression (authoring those in prose too is the
  double-authoring trap). Each ref is optional. A `cast` entry names an individual character OR a
  **recurring identifiable group** (canonical = a group frame, normally no refs); anonymous crowds stay
  prose, never cast. **`props` is the same lock for a recurring identifiable object** (a guidebook, a
  named banknote): image-gen gives it ONE canonical (`assets/library/prop-<name>.png`, `prop-` prefix)
  and seeds it into every appearance, while one-off props stay prose. A recurring figure or prop named in
  prose but missing from `cast`/`props` is an authoring gap image-gen flags back. Seeding: style-bible §5.
- **`needed_assets` — surface-then-gate.** A pose/expression/interaction the registry lacks gets an entry
  and VPW **HARD-STOPS** there; a human approves and generates it on the base, or vetoes, in which case
  VPW restages that beat onto existing assets only.
- `beat` uses a fixed vocabulary (narrative POSITION): `hook` · `second-gate` · `premise` · `body` ·
  `mid-arm` · `climax` · `withheld-peak` · `close`. Free-text is a contract break; review metadata only.
- `thumbnail.challengers` is exactly 2 for long-form; `thumbnail_source` lives inside the `thumbnail`
  block only. Shorts have no thumbnail block — their `first_frame` **is** the thumbnail.
- **Deleted fields — do not author; consumers ignore unknown keys.** List + rationale:
  `docs/retired-features.md`. `on_screen_text`, `render_pattern`, `transition_in`, `ken_burns`,
  `within_shot_motion`, `motion_prompt`, `asset_type`, the beat-type treatment enum, and (on the
  `motion.json` side) `transform_note` / sprite-walk / `at_scene`.

## 2. Field → render-builder mapping

`render-builder` builds one scene per shot on the local Remotion engine in **scenes mode**, from the
verified `assets/scenes/<shot-id>.png` image-generation produces plus the per-piece `motion.json`
`build_motion.py` derives (contract: `render-builder/references/motion-schema.md`).

| shot field | Remotion engine |
| --- | --- |
| `still_prompt` | image-generation's input → the verified scene PNG the shot displays; a missing scene for an ai-gen/hybrid shot is a render-time hard error |
| *(`scenes/manifest.json` `review_status`)* | image-gen stamps `verified` only after its batched review passes; `parked` or unstamped hard-errors like a missing scene. Authored by image-gen, not VPW. |
| `stage` / `stage_role` / `changed_elements` | same-`stage` shots share ONE held set; changes arrive AT the cut; a delta may be promoted by `motion-planner` to a moving cutout layer |
| `vo_ref`, `duration_s`, `start_hint` | cut timing: first 4 normalized words matched against the real VO word-stream; durations re-timed to the VO track |
| `source: chart\|screencap\|stock\|archival` | rendered as a visible placeholder device card (counted in the manifest); image-generation skips these |
| `synthetic: true` (any shot/thumb) | feeds the AI-disclosure flag in `metadata.json` |
| `thumbnail.primary.gen_prompt` | generated by image-generation + set via `thumbnails.set` at publish |
| `cast` (+ refs), `props`, `needed_assets` | *(upstream authoring — image-generation seeds `cast`/`props`; `needed_assets` is a human gate; render-builder ignores all three)* |
| `beat`, `narration_type`, `shot_class`, `vo_text`, `shot_counts` | *(authoring/review metadata — never consumed; auditability + anti-slop review)* |

The VO track comes from `voiceover` (which reads `script.md`); real durations exist only after it
renders, so `duration_s`/`start_hint` here are estimates that `render-builder` re-times.

## 3. Source-tag taxonomy (when to use which)

Pick the tag that makes the shot look *authored and credible*, not synthetic (§13 / tools.md: pure-AI
B-roll reads uncanny; blend real stock; show the work with data and receipts).

| `source` | Use for | Notes |
| --- | --- | --- |
| `ai-gen` | stylized, impossible, illustrative, or metaphor shots | full generation; set `synthetic` per realism |
| `stock` | real places / people / events that must look real | give a `stock_query`; blends out the uncanny look |
| `hybrid` | real subject + AI/graphic background (default thumbnail) | best proof-of-human; `stock_query` for the real half |
| `chart` | data, numbers, timelines ("show the work", §1b) | render-builder builds the viz; prefer numbers-as-objects |
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
3. **Author it as deliberately blank** — "a single BLANK name line", "the metric field left COMPLETELY
   EMPTY". An empty surface is a legitimate composition and reads as intentional.

Never resolve it by inventing a plausible-looking value: that is the same fabrication with an extra
step. `scripts/lint_shots.py` HARD-fails this across every `still_prompt`, `first_frame`, and thumbnail
`gen_prompt`; `motion-planner` carries the identical law for `cutout_prompt` / `plate_prompt`.

**The lettering-fidelity laws (lint-enforced)** govern a value that *was* supplied and still rendered
wrong:
- **L-1. Re-quote a carried literal character-for-character on EVERY frame that redraws it (HARD).** A
  delta regenerates the whole image, so every glyph is drawn again; repeating the literal in the same
  case is enough, quoted or not, while downgrading an established string to lowercase description hands
  those glyphs back to the engine and garbles them. Case is the discriminator.
- **L-2. State a constraint as a property of the depicted thing (HARD).** The engine cannot always tell
  an instruction from a label and letters a bare noun phrase naming a production rule into the artwork.
  "Figures on the CROWD RIG: round heads, dot eyes, NO noses, NO ears" is legal; the one-sentence
  editorial gloss goes in `notes`, never in the prompt.
- **L-3. Authored lettering is capped at 4 words (HARD)** — past roughly four the per-glyph error rate
  compounds into an unreadable render. The cap is **uniform**, including a short's `first_frame` caption.
- **L-4. Prefer the word form for big numbers (advisory).** `'8 MILLION'` over `'8,000,000'` where the
  beat allows. Only a numeral carrying **two or more separators in one digit run** draws a heads-up —
  punctuation is not what garbles numerals; volume is.

**Author fewer strings — the highest-leverage lever there is.** A string you do not author cannot
garble, and lettering saturation (the share of shots carrying a literal) drives a file's absolute defect
count; before writing a literal, ask whether the composition can carry the meaning instead. The
prompt-writing craft itself — held tableau, load-bearing scene facts, the `global_prompt_suffix` on
every prompt, the §8 thumbnail spec — is authored per the VPW SKILL's Steps 2.5–5.

## 5. Limits, defaults, timing

- **Density:** new long-form plans start at 2–5s per cut, new stimulus every 30–45s (§10), heaviest in
  the first 60s. Shorts cut every 2–4s (§11c); `first_frame` mid-action.
- **Duration coverage:** Σ `duration_s` across `long_form.shots[]` must ≈ the script header's
  `Estimated runtime` (words ÷ **150** wpm, the project constant; compute it yourself if the header is
  absent), and the plan needs at least **`runtime ÷ 5s` shots**. A list that sums short gets stretched
  by `render-builder`'s re-time, destroying the cadence — densify, never lengthen holds to close a gap.
- **Holds:** any hold over roughly 6s requires `hold_reason` recording its progressive-reveal,
  legibility, or gravity justification; the critic decides whether it is earned. The **diagram-first
  exception:** an annotated schematic that progressively reveals (arrows, labels, callouts) may hold
  10–14s — the in-shot annotation is the stimulus refresh. Event/reveal/silence shots stay 2–5s; this is
  not a license for sparse static holds.
- `duration_s` is an estimate; `timing_status` flags re-timing after render.
- `synthetic` drives AI disclosure — set `true` on any photoreal AI shot or thumbnail so the flag in
  `metadata.json` is honored. Thumbnail `text_overlay` ≤3 words, no all-caps (§8c).
