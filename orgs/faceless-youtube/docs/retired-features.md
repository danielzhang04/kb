# Retired Features

Retired pipeline capabilities — what/why/where the code is parked, for possible re-implementation. Governing files do not re-explain these.

## Engine text overlays + T2 device cards (+ `source:"engine"` motion layers)

- What: Remotion components for engine-drawn on-screen text — definition, meter/gauge, stat-callout, chapter, and escalating-counter cards — plus any `shots.motion.json` layer authored with `source:"engine"`.
- Why retired: all in-video text is now baked diegetic into the generated image (signs, ledgers, stamps); a render-time text layer added garble risk the baked image doesn't have.
- Where parked: component source sits dormant, out of the active render path; no `source: engine` layers are materialized, and `lint_motion_plan.py`/`motion_plan.py::validate_plan` hard-reject any layer whose `source != "cutout"`.
- Re-verify: whether baked-diegetic text still holds at higher output volume, and whether the dormant components still match the current Remotion engine version.

## Engine device-card token styling

- What: the `card` (`border_px`/`radius_px`/`shadow`/`tilt_deg`) and `type_on` (`story_chars_per_s`/`card_chars_per_s`) blocks in `motion-tokens.json`.
- Why retired: these style the same dormant device-card/overlay components as the entry above; with no live consumer, the token values have nothing to drive.
- Where parked: the blocks stay in `motion-tokens.json` (data, out of scope for doc trims) solely because the parked components still reference their shape.
- Re-verify: safe to delete once the parked components are formally removed, not before.

## Whip entrance

- What: a whip-pan shot-entrance style, driven by a `whip_frames` motion-token.
- Why retired: the camera decouple made every shot entrance a hard cut; `entrance` is now always `cut` and is never authored per-shot.
- Where parked: `whip_frames` remains in `motion-tokens.json` for parity; no code path selects a whip entrance.
- Re-verify: only if a future camera-authoring surface reintroduces entrance variation.

## `audio_layer` motion-tokens block

- What: an `audio_layer` block in `motion-tokens.json`, once read for audio dials.
- Why retired: superseded by a separate `visual-kit/audio-tokens.json` that `build_audio.py` now reads exclusively for the `audioSpec`/`MusicLane`/`SfxTrack` behavior.
- Where parked: any `audio_layer` block still present in a channel's `motion-tokens.json` is stale and silently ignored by the current audio path.
- Re-verify: safe to delete the stale block from any channel's `motion-tokens.json`; nothing reads it.

## Baked TTS pause tags

- What: `[PAUSE]`/`[BEAT]` inline tags authored directly in `script.md` to control TTS pacing.
- Why retired: this channel's rhythm now comes from VO prosody + the engine's automatic per-sentence gap splice + authored `pause` cues in `audio-plan.json` — a baked script tag can't coordinate with bed/SFX the way a cue can.
- Where parked: `voiceover.py` still carries the v3 tag-translation / v2 strip for portability; `script.md` is never authored with these tags on this channel.
- Re-verify: only if a future channel needs pacing control the sentence-gap + pause-cue system can't express.

## 2s SFX truncation

- What: a hard 2-second playback ceiling applied to every SFX file at render.
- Why retired: it chopped long sounds (applause, collapse) mid-ring; the engine now plays each SFX for its full ffprobe-measured file length.
- Where parked: removed from the realizer entirely; a long tail is now shaped with `fade_out_s` or a same-anchor `pause`, not a truncation window.
- Re-verify: not applicable — no truncation path remains; the realizer's overshoot WARN is the only remaining safeguard.

## Human-cost dry pull-back

- What: automatically cutting the music bed to full silence (`dry`) under human-cost narrative beats.
- Why retired: a full pull-back read heavier than intended; the bed now runs THROUGH human-cost sections, with register carried by track choice + level instead of silence.
- Where parked: `dry` stays available as a rare, deliberately-authored tool for a genuine big reveal, not an automatic human-cost response; comedic SFX are still withheld on human-cost beats.
- Re-verify: not applicable — this is a settled register decision, not a capability gap.

## VPW camera/motion authoring fields

- What: shots.json fields `ken_burns`, `within_shot_motion`, `motion_prompt`, `transition_in`, `render_pattern`, `on_screen_text`, `asset_type`, the beat-type treatment enum, and (motion.json) `transform_note` / sprite-walk / `at_scene`.
- Why retired: the engine derives camera and idle motion itself (locked camera, no authored moves); consumers ignore unknown keys, so old files with these fields still parse without a migration.
- Where parked: nowhere — dropped from the schema; no component or script reads them.
- Re-verify: confirm no downstream script silently expects one of these keys before reopening camera/motion authoring surface.

## Posed-character merge tier (Pass 1b)

- What: a pre-scene merge pass that composited character canonical + pose + expression into one posed frame before scene generation.
- Why retired: a 6-probe capability test proved one scene generation can multi-seed identity, pose, expression, and interaction directly; the merge added a pass without adding capability.
- Where parked: not implemented anywhere in the current image-generation skill; the base pose/expression/interaction primitives survive as direct scene seeds.
- Re-verify: the merge's cheap isolation gate (catching a bad blend before scene gen) is gone — seed-routing failures now surface only at the full batched review, at full gen cost; recheck that tradeoff at higher volume.

## Flash engine tier

- What: a cheaper `gemini-*-flash-image` generation tier alongside pro, selectable via forge.py's `--model`/alias logic and a skill technique-table switch.
- Why retired: flash rendered the off-recipe soft-gradient look with no outline and mangled baked text; pro held the recipe at an immaterial cost premium (~$15-30/video).
- Where parked: nowhere — the tier logic was deleted, not archived.
- Re-verify: only reconsider a cheap tier at daily-cadence volume, and then via the Batch API (half price, overnight), not flash.

## Chapter/title cards

- What: a dedicated on-screen chapter/title card marking a section boundary.
- Why retired: a chapter turn is realized as a hard cut plus palette shift on the next held stage, not a distinct card element; folds into the general device-card retirement above.
- Where parked: no separate component — its Remotion `progressive-reveal`/type-on/chapter-card overlays are the same dormant components covered under engine text overlays.
- Re-verify: whether a chapter needs a stronger signal than hard-cut + palette shift once longer or multi-chapter videos are attempted.

## forge.py diff/crop helper commands

- What: `forge.py diff` and `forge.py crop` helper subcommands for comparing/cropping generated frames.
- Why retired: measurement moved to direct Pillow calls (mean-abs-diff, alpha histograms, crop-battery) inside the review procedure instead of a standalone CLI helper.
- Where parked: removed from forge.py; no equivalent script currently wraps Pillow for this.
- Re-verify: confirm the ad-hoc Pillow calls used in review still cover every case the old helpers handled before rebuilding a CLI wrapper.
