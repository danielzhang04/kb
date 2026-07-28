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

## Chapter cards — NOT retired (correction)

- What: chapter cards are LIVE — plan-level `cards[]` → `apply_cards` → opaque `chapter-card` overlays with the card-on-silence law (authoring home: render-builder `references/shots-motion-schema.md`).
- Only the sibling overlay components (`progressive-reveal`/type-on and the device cards) remain parked, covered by the engine-text entry above; an entry here previously misstated cards as retired.

## forge.py diff/crop helper commands

- What: `forge.py diff` and `forge.py crop` helper subcommands for comparing/cropping generated frames.
- Why retired: measurement moved to direct Pillow calls (mean-abs-diff, alpha histograms, crop-battery) inside the review procedure instead of a standalone CLI helper.
- Where parked: removed from forge.py; no equivalent script currently wraps Pillow for this.
- Re-verify: confirm the ad-hoc Pillow calls used in review still cover every case the old helpers handled before rebuilding a CLI wrapper.

## Hook-bar law

- What: VPW's named law requiring the hook shot (and each new-loop opening) to show something whose meaning is unexplained, posing the question the VO answers a beat later, held to a scroll-stop staging standard.
- Why retired: wave-3 ruling 1 drops it from the seven-named-laws apparatus; non-literal-default classification plus the densify-cadence guidance already drives an arresting opening without a dedicated named law and its own critic question.
- Where parked: nowhere — deleted from VPW SKILL.md, critics.md's Q5, and the never-flag list.
- Re-verify: if opening-shot strength regresses on a future video, check whether cadence/non-literal guidance alone is sufficient before restoring a named rule.

## Delta-decisiveness law

- What: VPW's named law requiring a world-flip delta to flip the whole frame (full palette turn, "paradise fully gone") — timid partial coexistence flagged as mushy.
- Why retired: wave-3 ruling 1 collapses it out of the named-law apparatus into one sentence of chain logic in visual-grammar.md (one element per delta; a world/register change is a hard cut) rather than a standalone law with its own critic check.
- Where parked: the rule survives compressed into visual-grammar.md's chain-logic line; the named-law framing and critics.md's dedicated question are gone.
- Re-verify: not applicable — a compression, not a capability loss; reopen only if the one-line version proves ambiguous in practice.

## Anti-slop guardrail + channel-translation step

- What: VPW Step 2.5's "anti-slop guardrail" (vary depiction content across videos, keep the relationship) and "channel translation" (cast on the locked rig, ironic-counterpoint as signature, humor dial, desaturated grim register) procedural items.
- Why retired: wave-3 ruling 1 drops both as separate named steps; the surviving substance now lives directly in visual-grammar.md §3's lever/register section instead of a VPW procedural checklist item.
- Where parked: content redistributed into visual-grammar.md; no standalone "anti-slop" or "channel translation" step remains in VPW SKILL.md.
- Re-verify: watch for depiction reuse across videos creeping back without a dedicated procedural check; restore an explicit critic question if it recurs.

## VPW-side needed_assets hard-stop

- What: VPW's pose/expression gate — a hard stop mid-authoring run when a shot needs a `pose_ref`/`expression_ref`/interaction the registry lacks, surfaced via `needed_assets` for human approve/veto before VPW proceeds.
- Why retired: wave-3 ruling 8 moves the missing-asset gate to image-generation Pass 1 (derive the full asset list from shots.json → surface gaps → STOP for human pre-gen approval), so VPW no longer owns a mid-run stop of its own.
- Where parked: the pre-gen approval step survives, relocated to image-generation SKILL.md Pass 1; shots.json v2 drops the `needed_assets` field, and VPW's no-re-request-after-veto convergence rule is absorbed into the Pass-1 gate.
- Re-verify: confirm Pass 1's vocab-name asset scan catches every case the old VPW-side `needed_assets` entries used to.

## Per-video house_style distillation

- What: VPW Step 2 — distilling `dna.md`'s visual style + niche conventions into a per-video `house_style` block and `global_prompt_suffix` string, committing to one lane (stylized/illustrated vs real-footage) each run.
- Why retired: wave-3 ruling 5 makes house style fixed channel data (texture/line-weight/art-style only); the one `global_prompt_suffix` string now lives once in visual-grammar.md's header, not re-distilled per video.
- Where parked: nowhere — the distillation step is deleted from VPW; palette and light stay per-shot facts authored per prompt, not part of the fixed suffix.
- Re-verify: if a future channel genuinely needs per-video style variation beyond per-shot palette/light, reopen a distillation step for that channel only.

## Metadata-writer thumbnail concepts

- What: metadata-writer Step 3 — authoring the long-form thumbnail's primary + 2 challenger concepts as part of its title/thumbnail A/B output.
- Why retired: wave-3 ruling 7 — VPW now derives thumbnail gen-prompts directly from `script.md` + `dna.md`, making metadata-writer's separate thumbnail-concept authoring redundant with the downstream visual step.
- Where parked: nowhere — removed from metadata-writer/SKILL.md frontmatter + Step 3; title/description/tags/chapters/pinned-comment output is unchanged.
- Re-verify: confirm VPW's script+dna-derived thumbnail prompts keep the CTR-teardown-grounded pattern discipline metadata-writer's Step 3 used to apply; re-add a metadata-side concept pass if quality regresses.

## shots.json v1 author-metadata fields

- What: the v1 shots.json fields `from_cue`, `beat`, `narration_type`, `hold_reason`, `cast` (+ `pose_ref`/`expression_ref`), `props`.
- Why retired: wave-3 ruling 9 drops these authoring/review-metadata fields (never engine-consumed); casting moves to inline registry-vocabulary names in `still_prompt` prose (ruling 3), and `shot_class` survives as the one audit tag in place of the beat/narration_type trail.
- Where parked: nowhere in the schema — engine-read fields are unchanged so v1 files still parse; `lint_shots.py` v2 adds an unknown-legacy-field WARNING (not an error) so v1 files stay valid but flagged.
- Re-verify: confirm no downstream script (motion-planner, render-builder, compliance-check) silently expects one of these keys before treating the removal as final.

## Seven-authoring-laws apparatus

- What: VPW SKILL.md's named "seven laws" framing (held tableau · scene facts · acting · casting · delta decisiveness · hook bar · disclosure order) as a canonical, critic-mapped taxonomy.
- Why retired: wave-3 ruling 1 dissolves the apparatus itself, not all its content — hook bar and delta decisiveness are cut outright (see their own entries above); held tableau demotes to one line of prompt guidance ("stage poses that hold; don't freeze mid-motion"), and scene facts + disclosure order continue as ordinary rules in grammar/VPW rather than a numbered law.
- Where parked: surviving content lives on in visual-grammar.md and VPW SKILL.md as plain procedure/prompt guidance; no numbered "seven laws" list or matching critics.md taxonomy remains.
- Re-verify: not applicable — a framing simplification; reopen only if critics.md's five-question charter proves to miss a check the old seven-law mapping used to guarantee.
