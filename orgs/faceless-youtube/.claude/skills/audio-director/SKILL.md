---
name: audio-director
description: Authors the complete audio plan for a scripted + storyboarded video in this project — SFX hits, deliberate pauses, music-bed placement, and dry/pull-back spans — as one unified videos/<slug>/audio-plan.json for the render engine. Use whenever the user wants to do the audio, "author the audio plan", place the SFX and music, "do the sound design", add pauses/silences, choose which bed plays where, or run the audio step after shots.json exists — for ANY channel with a visual-kit/audio setup (sfx_pools + music_pools). It merges what used to be two skills (SFX cues + music cues) into ONE director. It decides PLACEMENT (a judgment grounded in the script + shots.json + the measured audio grammar); the HUMAN ear-gates FEEL on the render. Timid by default. Runs AFTER visual-prompt-writer / motion-planner (needs shots.json), in parallel with voiceover, BEFORE render-builder. Do NOT use it to source/curate SFX or music files (sfx-forge / music-forge), to plan visual layers (motion-planner), to write the script (long-form-writer), or to assemble the video (render-builder).
---

# audio-director

Authors `videos/<slug>/audio-plan.json` — the ONE unified audio plan (SFX · pause · music · dry),
grounded in the script + `shots.json` + the measured audio grammar. **Timid by default;** authors
PLACEMENT, the human ear-gates FEEL. The render realizes the plan deterministically (`build_audio`/
`breath`); this skill never touches levels/fades/gaps mechanics — those are data in `audio-tokens.json`.

Read: `videos/<slug>/shots.json` + `script.md`, the channel `visual-kit/audio-tokens.json` (pools +
dials), `references/grammar-guidance.md`, and `render-builder/references/audio-plan-schema.md` (the format).

## The plan (one `cues` array, four kinds)
- `sfx` — a role from `sfx_pools` ON an anchor word.
- `pause` — inserts silence before an anchor (shifts the timeline); `in_pause` = interrupt vs landing.
- `music` — a `mood` from `music_pools` starting at a `from_anchor`, running to the next music/dry.
- `dry` — carves existing silence across a span (music pull-back; no timeline shift).
**Never conflate `pause` (inserts) with `dry` (carves).** Anchors are verbatim VO opening words.

## Procedure
1. **Read** the inputs above. Walk the script in narration order.
2. **Draft, timid-by-default** — two sectioned passes into the SAME `cues` list:
   - **SFX + pauses.** Place a hit only where content earns it: a money beat → `cash`, a hard pivot →
     `record_scratch` + `in_pause`, a punchline/number/reveal → a punch (`boom`/`ding`) often with a
     short `pause` before it. **Withhold** comedic SFX on human-cost / dialogue sections. Structural
     sounds (a scene-change `whoosh`, a chapter `boom`) are placed **selectively by judgment** — NOT on
     every instance (we don't want a whoosh on every cut). The one you must NOT miss: the number/reveal
     punch. Correct failure direction = too few.
   - **Music + dry.** Segment into mood sections (few switches — let one bed run); pick each section's
     `mood` for its register (wry `sneaky` is the con-story workhorse; `casual-bed` default; `upbeat`
     opt-in lift). **`dry`** across human-cost sections (music pulls back). The one you must NOT miss:
     dry on human cost.
3. **Fresh-eyes critic** — dispatch a fresh-context reviewer with `references/critics.md` + the draft +
   the script + `grammar-guidance.md`. Apply its findings in ONE revise pass.
4. **Write** `videos/<slug>/audio-plan.json` (schema: `audio-plan-schema.md`).
5. **Lint (HARD):** `py -3 ../render-builder/scripts/lint_audio_plan.py videos/<slug>/audio-plan.json <kit>/audio-tokens.json` → must be `0 error(s)`.
6. **Human ear-gate on the render** — the only human gate; FEEL (levels, pause lengths, mood fit,
   whether a structural sound should fire here) is tuned by ear on the actual render.

## Guardrails
- **Timid.** Fewer hits, one bed running; the correct failure is under-cueing, not a laugh-track.
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
