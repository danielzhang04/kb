# Retired Features

Retired pipeline capabilities — what/why/where the code is parked, for possible re-implementation. Governing files do not re-explain these.

## Engine text overlays + T2 device cards

- What: Remotion components for engine-drawn on-screen text — definition, meter/gauge, stat-callout, chapter, and escalating-counter cards.
- Why retired: all in-video text is now baked diegetic into the generated image (signs, ledgers, stamps); a render-time text layer added garble risk the baked image doesn't have.
- Where parked: component source sits dormant, out of the active render path; no `source: engine` layers are materialized.
- Re-verify: whether baked-diegetic text still holds at higher output volume, and whether the dormant components still match the current Remotion engine version.

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
