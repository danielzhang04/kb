---
name: audio-director
description: Authors the complete per-video audio plan for a scripted and storyboarded video in this project—SFX hits, deliberate pauses, music-bed placement, and dry/pull-back spans—for the render engine. Use whenever the user wants to author audio, place SFX or music, design sound, add pauses or silence, choose beds, or run the audio step after shots.json exists for a channel with visual-kit audio pools. It owns placement and leaves feel to the human ear gate; do not use it to source sounds, plan visuals, write scripts, or render video.
---

# audio-director

Authors `videos/<slug>/audio-plan.json` — the ONE unified audio plan (SFX · pause · music · dry),
grounded in the script + `shots.json` + the measured audio grammar. **Timid by default;** authors
PLACEMENT, the human ear-gates FEEL. The render realizes the plan deterministically (`build_audio`/
`breath`); this skill never touches levels/fades/gaps mechanics — those are data in `audio-tokens.json`.

Read: `videos/<slug>/shots.json` + `script.md`, the channel `visual-kit/audio-tokens.json` (pools +
dials), `references/grammar-guidance.md`, and `render-builder/references/audio-plan-schema.md` (the format).

## The plan (one `cues` array, four kinds)
- `sfx` — a role from `sfx_pools` ON an anchor word. Optional `variant:"<stem>"` PIN forces an exact file.
- `pause` — inserts silence before an anchor (shifts the timeline); `in_pause` = interrupt vs landing.
- `music` — a `mood` from `music_pools` starting at a `from_anchor`, running to the next music/dry.
  Optional `track:"<stem>"` PIN forces an exact bed.
- `dry` — carves existing silence across a span (music pull-back; no timeline shift).

Pins, the no-dip-in-pause law, and the SFX-tail convention: `references/grammar-guidance.md` +
`render-builder/references/audio-plan-schema.md`. Pin only a directed take; a missing pinned file HARD-errors.
**Never conflate `pause` (inserts) with `dry` (carves).** Anchors are verbatim VO opening words.

## Procedure
1. **Read** the inputs above. Walk the script in narration order.
2. **Draft, timid-by-default** — two sectioned passes into the SAME `cues` list:
   - **SFX + pauses.** Inspect material reveals, concrete numbers, pivots, visible entrances/draw-ons,
     chapter turns, punchlines, and gravity turns. Place a hit only where sound improves the landing: a
     money beat may earn `cash`, a hard pivot may earn `record_scratch` + `in_pause`, and a reveal may
     earn a punch or held `pause`. **Withhold** comedic SFX on human-cost sections. Structural sounds
     (a scene-change `whoosh`, a chapter `boom`) are selective, never automatic. A bed, visual/VO landing,
     or deliberate silence may be the correct treatment; there is no cue-count target.
   - **Music + dry.** Segment into mood sections (few switches — let one bed run); pick each section's
     `mood` for its register (wry `sneaky` is the con-story workhorse; `casual-bed` default; `upbeat`
     opt-in lift). Keep a restrained bed through concise human-cost sections unless a particular line
     earns a full pull-back. **`dry` is rare and line-specific**, not an automatic consequence treatment.
3. **Fresh-eyes critic** — dispatch a fresh-context reviewer with `references/critics.md` + the draft +
   the script + `grammar-guidance.md`. Apply its findings in ONE revise pass.
4. **Write** `videos/<slug>/audio-plan.json` (schema: `audio-plan-schema.md`).
5. **Lint (HARD):** `py -3 ../render-builder/scripts/lint_audio_plan.py videos/<slug>/audio-plan.json <kit>/audio-tokens.json` → must be `0 error(s)`.
6. **Human ear-gate on the render** — the only human gate; FEEL (levels, pause lengths, mood fit,
   whether a structural sound should fire here) is tuned by ear on the actual render.

## Guardrails
- **Timid.** Fewer earned hits and one bed running beat a laugh-track, but timid does not mean silently
  skipping a high-value reveal, pivot, entrance, or punchline. The fresh critic adjudicates the miss.
- **Judgment, gated** — placement is a judgment (like the old cue-writers), backstopped by the critic +
  the lint + your ear-gate. The RENDER is deterministic given the plan.
- **You CAN audition — don't under-claim it.** You never literally listen, but the tooling makes a real
  audition possible: **CLAP** semantic ranking (match a clip to a mood/genre brief — *stronger on full
  music clips than on sub-second SFX transients*), **librosa** (tempo/energy), **ffmpeg `ebur128`**
  (LUFS/dynamics), and seam/loop checks. So verify mechanics objectively and present an INFORMED
  shortlist (the proven `sfx-forge` loop that built the 16-role library). What stays the human's call is
  the final **FEEL/fit** verdict — "does this cue carry THIS channel's tone" is brand taste: you own the
  narrowing, they own the verdict. Open the rendered file / audition board for them to make it.
- **Never AI-generate a sound and ship it.** SFX and music come from CURATED real sources (SFX: CC0
  Freesound via `sfx-forge`; music: monetization-safe libraries — Incompetech / YouTube Audio Library /
  Uppbeat / Pixabay CC-BY via `music-forge`), auditioned through the loop above. Generated SFX are
  unreliable (shipped ElevenLabs "pops" landed as water-droplets and were caught by ear); for the music
  lane the lean is **PULL curated tracks, not AI-generate** — pro production nails the comedic-history
  idiom AI can't, iteration is cheap (known-good on first listen), and the licensing stays clean.
- **Judge a cue IN CONTEXT, never soloed** — under the narration, in the actual render. A cue that reads
  fine alone sounds completely different in the mix. When presenting candidates, name files by the
  **distinguishing part first** (`3_1.1s.mp3`, not `whoosh-cand-1491.mp3`) — file browsers truncate long
  common prefixes.
- Absent `audio-plan.json` → the render falls back cleanly (no audio authoring = default bed, no SFX).
