# Engagement overhaul — Daniel's video-1 feedback + Checkpoint-2 resolution (2026-07-21–22)

**Current state (2026-07-22):** N1 research was recovered; the overnight N2 cards were never claimed
because the queue bridge is not started by the production daemon. The governed run therefore made no
doctrine changes. Checkpoint 2 is now designed on `codex/fyt-engagement-design`, with Bricks first,
Pearlman second, Wells Fargo excluded, and no paid production authorized. Daniel's 2026-07-22 refinement
also makes the script voice itself an overhaul surface: personable/fun narration, causal scheme steps,
recurring modern analogies, and a visibly present narrator.

## The feedback (Daniel, verbatim intent — BINDING creative direction for video #2+)

> "The biggest feedback I received was that there should be **more happening**. More images and cuts,
> more SFX, more voice tone variation, more engaging script — right now it feels like **the flat
> reading of a book** and even though it's not bad, it's not engaging. It needs to be **much more
> engaging on every front**: the speed of the image changes, the narration humor, the pacing of the
> script and content. Also, I think the **content itself is just a bit boring**. We should find ways
> to spice it up. It's curious content, but it's not engaging."

Decomposed — six axes, each owned by a skill/doctrine surface:

| # | Axis | Owner surface | Current state (poyais) |
|---|---|---|---|
| 1 | Image/cut density | visual-prompt-writer + motion doctrine (§13a) | ~95 stills / 504s = 5.3s/still; cut rate in the broad reference band but still too slow by Daniel's eye; 90.6% dead-frame share |
| 2 | SFX density | audio-director + audio plan | sparse, restrained grade |
| 3 | Voice tone variation | voiceover (eleven_v3 delivery direction) | one flat setting for 8+ min — "reading a book" |
| 4 | Script pacing + narration humor | long-form-writer + storytelling-grammar | dry-wit dial exists but reads flat at length |
| 5 | Content spice (stakes/angle) | researcher + idea-generator + long-form-writer | "curious but not engaging" |
| 6 | Overall engagement grade | ALL — this is the standing bar | B-minus by Daniel's ear |

**Refinement (Daniel, same night) on axis 1:** two reference buckets — animation channels (things
continuously move; NOT our comp) vs stills-based channels (our comps): those get life from elements
PUSHING INTO frame + subtle within-shot movement + FASTER CUTS than ours. Implement both: within-shot
micro-motion (the engine already has entrances/pop/slide/path/bob; the idle float is zeroed by
Daniel's own 2026-07-10 "fully-locked look" directive — that directive is now UNDER REVISION with
better information) and a faster cut cadence (targets from the stills-bucket measurements: dead-frame
share + within-shot motion events/min + cuts/min are added N1a columns).

**2026-07-22 simplification:** do not build a bucket classifier or motion taxonomy. Because the channel has
limited meaningful animation, new plans cut faster by default (initial 2–5s guidance; holds over ~6s need a
reason), opt into the existing gentle idle path, keep motivated layers, and add restrained push capability.

## Context that must inform the fold (do NOT blindly overturn)

- The current restrained grade was MEASURED from reference channels (2026-07-08 motion teardown:
  locked camera, no 16:9 captions, hard cuts). The shorts-formula arc (same day as this handoff)
  proved the failure mode: imitating the winners' SURFACE while missing their ENGAGEMENT layer.
  The fix pattern that worked: measure the winners at the engagement level, calibrate against
  Daniel's taste in explicit rounds, codify, A/B where uncertain.
- The Poyais retention curve is not yet available in the recovered record. Read it when analytics has
  enough data; until then, do not claim topic/script dominance or exact retention effects.
- Locks that survive regardless (constitution-level, Daniel-set): one narrator, no viewer role-casting
  or voiced character dialogue, reported speech, near-zero exclamations, comedy off on human cost, and
  fact leash. First-person narrator asides and generic audience-facing `you` are allowed. Consequence
  beats stay concise and respectful, but narration, restrained music, and visual life continue unless a
  particular line earns a full stop. "More tone variation" means DYNAMICS within the register, not a
  narrator-identity change.

## The nighttime wave (launched 2026-07-21 late; results gate in the morning)

- **N1a MEASURE (agent, launched):** quantitative teardown — poyais final.mp4 vs top reference
  long-forms: cuts/min, distinct visuals/min, motion events/min, SFX events/min, music-change
  events, VO wpm + pitch/energy variance (tone flatness is measurable), humor beats/10min,
  mid-video pattern-interrupt cadence. Output: the gap table, per axis.
- **N1b CRAFT RESEARCH (agent, launched):** what makes 2025-26 doc long-forms *feel* alive at the
  script/content level — stakes engineering, character-led scenes, mid-video reveals, present-tense
  set pieces, humor cadence, "chapter as mini-episode" structure; plus eleven_v3 delivery-direction
  capabilities (audio tags / per-beat emotional direction) for axis 3.
- **N2 DOCTRINE FOLD (dispatch after N1):** route findings into universal.md §13a/motion doctrine,
  audio-director, voiceover (delivery-direction step), long-form-writer, storytelling-grammar.
  Every change cites N1 numbers or Daniel's feedback above.
- **N3 PRODUCTION PREP — RE-SCOPED (Daniel, 2026-07-22):** Wells Fargo is excluded. After the logic
  gates, use MiniScribe / Bricks for the first blind control/candidate run and Pearlman second. No image
  generation, voice spend, full render, or publication follows from doctrine approval alone.

## Current gates for Daniel

1. Review the consolidated Checkpoint-2 design: personable scheme narration, both faster cuts and more
   motion capability, plus voice delivery, audio, and QA changes. Approve/revise the candidate voice excerpt.
2. After approval, review the complete Checkpoint-3 production diff before calibration.
3. Review zero-spend Poyais cut-only, motion-only, and combined calibration variants.
4. Review the blind Bricks control/candidate opening-through-audit scripts and voice dry-run.
5. Separately approve any paid voice chapter, image generation, full render, and publication.

## §2am — The authorized night run (Daniel, 2026-07-21 ~11pm)

- **N1 DONE:** both records committed on `claude/engagement-overhaul`
  (knowledge/research/engagement-gap-2026-07.md + engagement-craft-2026-07.md). Headline: 90.6%
  dead-frame share vs winners' 6-25% is THE gap; cuts already in band; SFX 2-5x under; VO
  macro-dynamics flat (not pitch-monotone). Its SFX-rate and human-cost recommendations remain
  hypotheses and were reconciled in Checkpoint 2.
- **2am ET outcome:** six governed work cards were authored and the broad activation gate was left on,
  but zero cards were claimed in 80 minutes. The queue bridge is implemented and tested yet never
  constructed or started by production boot; N2 therefore did **not** execute. Queue wiring remains a
  separate default-off infrastructure change after the other terminal's control-plane PR.

## Timeline to video #2

The sequence is now design review → production-logic diff → zero-spend calibration → blind Bricks
script/dry-run → explicit paid gates. Dates follow the human checkpoints; no assumed image run or Studio
deadline overrides them.
