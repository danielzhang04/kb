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
dials), and `render-builder/references/audio-plan-schema.md` (the format + every field semantic).

## The plan (one `cues` array, four kinds)
- `sfx` — a role from `sfx_pools` ON an anchor word. Optional `variant:"<stem>"` PIN forces an exact file.
- `pause` — inserts silence before an anchor (shifts the timeline); `in_pause` = interrupt vs landing.
- `music` — a `mood` from `music_pools` starting at a `from_anchor`, running to the next music/dry.
  Optional `track:"<stem>"` PIN forces an exact bed.
- `dry` — carves existing silence across a span (music pull-back; no timeline shift).

Field semantics, the SFX-tail mechanism, sentence-gap engine behavior, and everything the realizer owns:
`audio-plan-schema.md`. **Never conflate `pause` (inserts) with `dry` (carves).** Anchors are verbatim
VO opening words.

## Procedure
1. **Read** the inputs above. Walk the script in narration order.
2. **Draft, timid-by-default** — two sectioned passes into the SAME `cues` list:
   - **SFX + pauses.** Inspect material reveals, concrete numbers, pivots, visible entrances/draw-ons,
     chapter turns, punchlines, and gravity turns. Place a hit only where sound improves the landing: a
     money beat may earn `cash`, a hard pivot may earn `record_scratch` + `in_pause`, a reveal a punch or
     held `pause`. A bed, a visual/VO landing, or deliberate silence may be the correct treatment; there
     is no cue-count target.
   - **Music + dry.** Segment into mood sections (few switches — let one bed run) and pick each section's
     `mood` by the register dial below.
3. **Fresh-eyes critic** — dispatch a fresh-context reviewer with `references/critics.md` + the draft +
   the script + the Placement laws below. Apply its findings in ONE revise pass.
4. **Write** `videos/<slug>/audio-plan.json` (schema: `audio-plan-schema.md`).
5. **Lint (HARD):** `py -3 ../render-builder/scripts/lint_audio_plan.py videos/<slug>/audio-plan.json <kit>/audio-tokens.json` → must be `0 error(s)`.
6. **Human ear-gate on the render** — the only human gate; FEEL (levels, pause lengths, mood fit,
   whether a structural sound should fire here) is tuned by ear on the actual render.

## Placement laws

Apply these as JUDGMENT, timid-by-default. The measured grammar they distil is single-sourced in
`knowledge/research/niche-playbooks/universal.md` §13a-iii.8; the numeric dials (levels, pools, fades,
master target) are data in `audio-tokens.json`.

- **Music is PLACED, not wall-to-wall.** Let one bed run and keep it present under VO (a light ~2–3 dB
  duck, held constant — the data does that, not you).
- **A bed always fades OUT into a chapter card — never plays over one, never hard-cuts into one.** End
  the segment at the card, let the card run in **silence**, start the next `music` cue on the first
  post-card anchor. Exempt: a card in a cold-open / no-bed region, and the **END card** (the finale bed
  carries the outro).
- **Fades are LONG by default.** Every bed ENTERS on a ~1.2s swell and LEAVES on a ~2.5s fade that starts
  earlier — never a hard cut, never an abrupt tail; a track switch also carries a ~1.2s silence gap. The
  engine applies these to every segment (`music_fade_s.in`/`.out`, `track_switch_gap_s`) as a FLOOR:
  author a LONGER tail per cue with `fade_out_s` (e.g. 3.0s to dissolve a bed before a scene change).
- **Rotate the bed at major pivots — never let one loop run 3+ minutes.** Change track at a new location,
  a new act, or the scheme's next move, even within one register; a droning tiled loop reads as stale.
- **Silence is a scalpel.** A full `dry` pull-back is reserved for the rare big reveal and stays
  line-specific; ordinary emphasis is a small dip, not silence.
- **Human cost keeps a PRESENT, restrained bed.** Music runs THROUGH human-cost sections — the register
  shift comes from track choice + level (a restrained `underscore`), not from cutting the bed. Withhold
  *comedic* SFX on those beats; keep the *bed* playing.
- **No-dip-in-pause.** Where the channel sets `dip_in_pause:false`, an authored `pause` does not punch the
  bed — music keeps playing at its present level through the breath, and full music cuts stay reserved for
  `dry` spans and track switches (including the fade into every card). So author `pause` generously and
  reach for `dry` only when you truly want the bed gone.
- **Dips are selective, never metronomic** (on a channel that keeps pause-dips on). Predictability kills
  the gag: use one only where the landing improves, never because a fraction or count is owed.
- **The sentence-gap floor is automatic — author only EXTRA silence.** The engine pads every sentence
  boundary up to its target on every video, so the piece already breathes; a `pause` cue is for silence
  BEYOND that beat (a held reveal, a long-SFX ring-out, an image held before a cut), and it STACKS on the
  gap. Mechanism + dials: `audio-plan-schema.md`.
- **Breath is selective above that floor** — a sustained hit earns ~0.55s (range 0.3–0.8) of EXTRA VO
  silence via a `pause` cue, but only on ~20% of events. Most beats ride the floor with no added pause.
- **Density is diagnostic, not a target.** Reference rates may reveal an under- or over-authored plan, but
  acceptance follows semantic coverage and the human ear, never SFX/min.
- **Register dial** — the bed mood tracks topic gravity: restrained `underscore` is the DEFAULT con-spine
  bed, `casual-bed` the neutral bucket, `somber` the elegiac tail, `upbeat` a deliberate lift, `sneaky`
  (with the meme-coded comedic tracks) OCCASIONAL deliberate comedy.
- **Item-appearance SFX sync to the item.** Any sound that enunciates a specific thing showing up
  (cha-ching↔cash, a pound↔the FICTION stamp, a whoosh↔a scene cut, a pop↔a small element) is authored
  with **`sync: "element"`** so it lands on the frame the item appears, not a drifted VO word. VO-moment
  sounds (a verbal-pivot scratch, an aside sting) omit `sync` and stay on their word.
- **Hold an image longer before a cut** — put a pure `pause` cue (no `role`) on the NEXT shot's opening
  words: the inserted silence extends the current image, then the next image drops.
- **Shape a long SFX tail.** A long SFX (`boom`, `crack`, `womp`, `collapse`, `applause`, choir
  `halo_vocal`) plays its FULL file length over whatever cut comes next, so either ramp it with
  `fade_out_s` or pair it with a same-anchor `pause` holding the frame while it rings out. Each realizer
  tail WARN means "add a `fade_out_s`, or add/lengthen a same-anchor pause." Levers:
  `audio-plan-schema.md` §SFX-tail law.
- **Pin a variant/track only when the take is a directed choice.** Use `variant:"<stem>"` (sfx) or
  `track:"<stem>"` (music) when a SPECIFIC take carries intent the pool can't express; otherwise let the
  deterministic rotation choose. A pinned file that isn't on disk is a HARD render error.
- **Structural sounds are judgment, not every instance** (seed rules — refine by ear over real videos):
  - **`whoosh` is RARE** — a sparing accent for a **major** section break, **~0–2 per video**, NOT per
    scene change and **never inside a delta chain**; when unsure, don't. It reads as a recurring motif,
    so all scene whooshes are the **same** sound (`consistent_sfx`).
  - **`pop`** fires on each **additive small item** entering an accretion (bank → money → cathedral) —
    NOT the establishing base frame of the chain (it isn't additive), NOT a character appearing, NOT a
    costume change. All pops use the same sound (`consistent_sfx`).

## Guardrails
- **Timid.** Fewer earned hits and one bed running beat a laugh-track, but timid never means silently
  skipping a high-value reveal, pivot, entrance, or punchline — the fresh critic adjudicates the miss.
- **You CAN audition — don't under-claim it.** You never literally listen, but **CLAP** semantic ranking
  (stronger on full music clips than on sub-second SFX transients), **librosa** (tempo/energy), **ffmpeg
  `ebur128`** (LUFS/dynamics) and seam/loop checks make a real audition possible: verify mechanics and
  present an INFORMED shortlist, then open the render / audition board for the human's FEEL verdict.
- **Never AI-generate a sound and ship it.** SFX and music come from CURATED real sources (SFX: CC0
  Freesound via `sfx-forge`; music: monetization-safe libraries — Incompetech / YouTube Audio Library /
  Uppbeat / Pixabay CC-BY via `music-forge`), auditioned through the loop above. Generated SFX are
  unreliable — synthesized "pops" landed as water-droplets, caught by ear — and pro production nails the
  comedic-history idiom AI can't, with cleaner licensing.
- **Judge a cue IN CONTEXT, never soloed** — under the narration, in the actual render. Name candidate
  files by the **distinguishing part first** (`3_1.1s.mp3`, not `whoosh-cand-1491.mp3`).
- Absent `audio-plan.json` → the render falls back cleanly (no audio authoring = default bed, no SFX).
