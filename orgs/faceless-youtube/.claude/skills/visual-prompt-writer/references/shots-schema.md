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
  "global_prompt_suffix": "copied VERBATIM from visual-grammar.md's header — texture / line weight / art style only",
  "long_form": { "aspect_ratio": "16:9", "shots": [
      {
        "id": "L01", "duration_s": 4, "synthetic": false,
        "vo_ref": "VERBATIM opening words of the VO line, copied exactly from script.md — ≥4 where the sentence has them, else its full text",
        "vo_text": "DERIVED by lint_shots.py --write; never hand-authored",
        "stage": "OPTIONAL id shared by consecutive shots on ONE persistent set (e.g. \"guidebook-desk\"); omit or unique = a standalone one-frame stage",
        "stage_role": "base | delta — base establishes the set + subject; delta = ONE element added or moved on the SAME set", "changed_elements": ["+ golden city rises"],
        "place_anchor": "OPTIONAL on a regenerated base: video-relative assets/scenes/<human-approved-frame>.png to preserve this video's approved place; never a cross-video env reference",
        "shot_class": "the canonical closed list (picked from visual-grammar.md's narration→shot-class table): personified-character, staged-interaction, symbolic-stand-in-object, number-glued-to-object, diegetic-device, map-plan-view, physicalized-imbalance, register-shift-infographic, ironic-counterpoint, reaction-shot, idiom-pun, aftermath-palette-turn, crowd-multiplication, literal",
        "source": "ai-gen | stock | hybrid | chart | screencap | archival (§3)",
        "still_prompt": "the image-gen prompt: subject, composition/framing + scale, lighting, palette, and the shot's load-bearing scene FACTS. Cast, poses, and expressions are named INLINE by their registry vocabulary name, backticked. In-video text is DIEGETIC + baked here, quoted VERBATIM and kept SHORT (1–4 words)",
        "figures": { "anon_foreground": ["the worker at the dock edge"], "crowd": true },
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
- **`stage` / `stage_role` / `changed_elements` — held evolving stages, INTENT ONLY.** Consecutive shots
  sharing a `stage` id sit on ONE persistent set: the `base` establishes it, each `delta` adds or moves
  exactly ONE element named in `changed_elements` (`"+ cathedral rises"`, `"- ship"`), each its own shot
  with its own verbatim `vo_ref`. **Delta-vs-layer boundary:** an INTEGRATIVE change (the element joins
  the scene's architecture) stays a delta frame; a DISCRETE one (a character enters, a stamp slams onto a
  page) is promoted downstream by `motion-planner` to a moving cutout LAYER. Lint enforces exactly one
  `base`, first, per stage · **≤3 deltas** per chain · contiguity.
- **`place_anchor` — an approved in-video place, only when regenerating a base composite.** Optional;
  write the human-picked frame as a non-empty normalized direct `assets/scenes/<id>.png` path, only on a
  `base` (no absolute, traversal, backslash, nested, or cross-video path). `lint_shots.py` checks that
  structural contract only; `forge.py batch` requires
  that exact existing file under this video's own `assets/scenes/` after resolving links/junctions,
  seeds it after any STEP-1 figure frames and before the crowd exemplar, and does not mark the base
  as a new `plate`; it can never import a
  cross-video environment. Omit it for ordinary first-place bases and every existing shot — their current
  place-first behavior is unchanged.
- **`figures` — anonymous figures are DECLARED here, never described in rig prose.** Optional; omit the
  whole key when a shot has none. **`anon_foreground`**: one entry per anonymous LARGE/foreground figure
  (style-bible §2e tier), each entry **the exact phrase the `still_prompt` uses for that figure** ("the
  worker at the dock edge") — omit the key if there are none. **`crowd`**: `true` when the shot stages
  background/crowd figures (§2d tier); omit when false. `forge.py` expands each declaration into the
  style-bible §2d/§2e clause at gen time — establishment wording on a `base`, held wording on a `delta` —
  so **no prompt ever contains that clause text**: `lint_shots.py` HARD-fails its fingerprint, HARD-fails a
  wrong shape or unknown key, and SOFT-flags an `anon_foreground` entry that appears nowhere in its shot's
  prompt. Named/recurring cast are never declared here (they are inline registry names, next bullet).
  Routing by figure size + the ≤5-must-stay-distinct cap: `visual-grammar.md §2`.
- **Casting is PROSE, by vocabulary name.** Every recurring figure, pose, expression, and already-built
  prop is named inline in the `still_prompt` by its exact `registry.json` name, backticked — there are no
  structured cast/pose/expression arrays. A prop making its FIRST appearance has no entry to name and is
  described in prose instead (`visual-grammar.md` §2 owns that rule). `image-generation` resolves names →
  files and surfaces any name the registry lacks at its Pass-1 human gate, before a token is spent.
- **`assets` (image-gen-owned, added in Pass 1).** `image-generation` writes a per-shot `assets` map
  (`{"<vocab name>": "<library path>"}`) back into this file after its gate passes and Pass 2 reads only
  those tags; VPW never authors it, and `lint_shots.py` + `render-builder` ignore it.
- **Transitions are HARD CUTS only** — no transition field exists; continuity comes from held stages.
- **`global_prompt_suffix` is copied verbatim** from `visual-grammar.md`'s header — never re-derived per
  video — and appended to every `still_prompt`, `first_frame`, and thumbnail `gen_prompt`.
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
3. **Author it as deliberately blank** — "a single BLANK name line", "the metric field left COMPLETELY
   EMPTY". An empty surface is a legitimate composition and reads as intentional.

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
