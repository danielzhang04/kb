# Adversarial review — vd-palette-forensics.md (emitted via follow-up after the review run timed out; reviewer = codex sol)

## Verdict

**REJECT.** The measurements reproduce, but the “blue/teal” detector excludes visible teal, the visual flags poorly predict taste, the causal ranking exceeds the controls, and several remedies are wired to the wrong pipeline stage.

## Your own great/off sort of the 24 vb+vc frames

- **vb L01 — GREAT:** warm den and cool night are physically grounded light fields.
- **vb L02 — OFF:** cobalt/peach is decorative “era” shorthand.
- **vb L03 — GREAT:** teal office and warm plinth have distinct material roles.
- **vb L04 — GREAT:** reads neutral fluorescent retail, not gaudy complement.
- **vb L05 — GREAT:** oak, green panels, and cream device form a clear hierarchy.
- **vb L06 — GREAT:** teal trusses, wood bench, and cream hall are structurally assigned.
- **vb L07 — OFF:** blue field plus cream/walnut/brass is the repeated “smart” formula.
- **vb L08 — OFF:** the held formula expands into broad bilateral fields.
- **vb L09 — GREAT:** varied wardrobe prevents the measured pair owning the frame.
- **vb L10 — GREAT:** warm shop and blue exterior daylight have a physical cause.
- **vb L11 — GREAT:** green-window workshop gains depth from localized red and metal.
- **vb L12 — GREAT:** green/cream workshop and copper mechanism are materially grounded.
- **vc L01 — GREAT:** varied warm mall with olive foliage; warm, not collapsed.
- **vc L02 — GREAT:** mustard/rust belongs to the graphic arcade hero.
- **vc L03 — OFF:** cream/brass/tobacco collapses into amber wash.
- **vc L04 — GREAT:** teal glass, charcoal floor, and brass case create restrained hierarchy.
- **vc L05 — GREAT:** first teal/tobacco/cream use is materially assigned and legible.
- **vc L06 — OFF:** beige wash swallows the nominal contrast.
- **vc L07 — OFF:** the teal/tobacco template spreads indiscriminately into people and fixtures.
- **vc L08 — OFF:** orange shelves plus teal wall reads as reused complementary styling.
- **vc L09 — OFF:** the same formula repeats with little focal distinction.
- **vc L10 — OFF:** another arbitrary teal/brown retail split.
- **vc L11 — GREAT:** pale teal museum, cream hero, and semantic red rope separate roles.
- **vc L12 — GREAT:** workshop wood, teal bins, and steel drive are physically assigned.

The discriminant is **role-grounding plus sequence repetition**, not pair presence. Off prompts either use colour decoratively—vb L02 says cobalt/peach/cream “convey the era” (`spec-vb-retry1.json:33-34`)—or repeat a template: vb L07→L08 explicitly holds blue/cream/walnut (`spec-vb-retry1.json:122-123`; `spec-vb-L08.json:6-7`), while vc repeats “beige, muted teal, and tobacco brown” across L05–L10 (`claude/bricks-variant-vc:V/shots.json:62,72,82,95,105,115`).

## Findings table

| id | severity | claim attacked | evidence | required fix |
|---|---|---|---|---|
| F1 | HIGH | “Blue/teal” measurement and “vc orange-only” | `B=[180°,240°)` excludes visible 165–180° teal (`vd_palette_metrics.py:22-23`). Widening only B to 165° changes va/vb/vc/liked from `1/6/0/3` to `5/8/3/3`; vc L04/L10/L11 then flag. | Rename the band strict cyan-blue or use a perceptually justified clustered cool band; rerun every count and conclusion. |
| F2 | HIGH | Flags identify objectionable palettes | Only vb L02/L07/L08 are both flagged and visually off. Flagged vb L01/L04/L09 look good; all six off vc frames are unflagged. | Treat pixel metrics as recurrence evidence, never taste verdicts; calibrate against human-labelled great/off frames. |
| F3 | HIGH | vb L04 proves provider prior | L04 is not colourless: its assembled request includes the warm-brown descriptor, “beige boxy computer,” and a warm/neutral `pc-boxy` seed (`style-bible.md:77-81`; `spec-vb-retry1.json:59-73`; report `:100`). The manifest does confirm no tile (`manifest.json:52-64`). | Say only the cool field is unprompted; label provider prior an unisolated residual, not a ranked finding. |
| F4 | HIGH | Registry-pair seeding is “disproved” | No seed containing both hues proves only that no seed directly supplies both. An orange-biased seed may induce a complementary completion; no repeated same-payload controls were run. | Replace “disproved” with “not directly supplied”; require replicated tile/no-tile and canonical/no-canonical controls for causal ranking. |
| F5 | HIGH | Cause trace covers restoration loss | Liked-era VPW required a committed scene palette (`30d2b7e8:.../visual-prompt-writer/SKILL.md:83-89`), grammar repeated it (`30d2b7e8:.../visual-grammar.md:19-23`), Forge enforced it (`30d2b7e8:.../forge.py:283-310`), and image review checked it (`30d2b7e8:.../image-generation/SKILL.md:344-346`). Current VPW has no palette plan-lock criterion. | Restore per-stage palette commitment and board-level review without restoring the liked-era warm bias. |
| F6 | MED | Exact 6/12 convergence magnitude | The requested top-two complementary-bin alternative flags va L01; vb L02/L04/L07; liked L10/L24—cutting vb from 6/12 to 3/12. There is no variant-conditional code, so deliberate tuning is unsupported. | Publish sensitivity results; retain only the weaker conclusion that vb converges more under both definitions. |
| F7 | MED | S<0.15 safely removes neutrals | The threshold hides low-chroma cool fields: liked L23 ≈38%, vb L04 ≈37%, liked L24 ≈35% of frame. Threshold changes materially alter flags. “Neutral” means low-chroma, not perceptually neutral. | Rename the field and use chroma-weighted/perceptual measurements plus threshold sensitivity. |
| F8 | MED | Proposed bible clause changes author behaviour | It is an in-place criterion change, but “blue/cream retail” can still be justified by skylight plus cream/walnut materials. “Adjacent beats” also catches required stage holds. | Put the decision at plan lock: dominant field + light/material/story basis per distinct stage; review recurrence across stages, exempt holds. |
| F9 | MED | Hue-angle lint measures palette | Mapping prose such as cream, walnut, slate, or paper to hue angles is lexical guesswork. L04 is unscorable; L07→L08 would false-positive despite required continuity. | Lint structured plan fields only; leave semantic adequacy to the critic and exempt same-stage chains. |
| F10 | HIGH | `critics.md` can consume render rows | The critic runs after lint and before generation (`critics.md:11-14`), judges plans rather than renders (`:43`), and is told not to police palette choices (`:52-56`). | VPW critic reviews planned recurrence/rationale; image-generation fresh-eyes review consumes rendered metrics. |
| F11 | MED | Editing `build_review_artifact.py` completes enforcement | The scene-card collector exists at `build_review_artifact.py:214-271`, but current image-review instructions do not invoke it, and cards omit `still_prompt` and palette rationale. | Wire the helper into the canonical review gate and carry prompt/rationale metadata into each card. |
| F12 | MED | Tile replacement follows from evidence | Current contract is saturation-only, not hue-neutral (`style-bible.md:271-273`; `forge.py:928-936`), and tests pin that wording (`test_forge_style_tile.py:211-220`; `test_forge_seed_roles_and_delta.py:404-406`). | Keep tile replacement outside Variant D unless a replicated A/B demonstrates causality; update tests if semantics later change. |
| F13 | MED | “Liked all 17” is representative | The measured set silently skips L13–L20 although the archive continues far beyond L25; L16 itself flags under the report’s metric. L01–L25 yields 4/25, not 3/17. | Declare and justify the sample or measure a contiguous/representative liked set; do not label the subset “all.” |
| F14 | MED | Citations support all interpretations | Spot-checks passed for era-map `:5`, va/vc plans, vc genlog, Forge assembly, style-bible descriptor/suffix/palette/tile, vb manifest/spec, historical L10/L11/L24 prompts, schema, critic, and scene-card collector. Unsupported interpretations remain: VPW→DNA palette delegation when DNA has no scene-palette rule, hue-neutral tile “intent,” provider causality, and registry “disproof.” | Separate locator accuracy from inferential support; correct the four unsupported claims. |

## Missed items

- The **plan-lock choice is the primary lever**: both vb and vc committed coarse palette trajectories before shot prompts existed.
- Current VPW’s palette router points to DNA, but DNA supplies no operative scene-palette trajectory or calibration examples.
- `image-generation/SKILL.md` needs the rendered-palette rubric; changing the helper alone is unreachable.
- Existing tests that pin review rows and style-tile semantics must be named and changed with doctrine.
- The critic needs plan-level recurrence wording, not impossible rendered-row consumption.
- General complementary-axis recurrence is the doctrine problem; hard-coded O/B should remain only a regression fixture.
- Controlled tile/no-tile testing is evidence work, not automatically a Variant D obligation.

## What survives

- The script reproduces all published rows and aggregate counts exactly.
- vb still shows more convergence than va/vc under the strict alternative, but not at the claimed magnitude.
- Blue/orange must remain legal; liked L10/L11/L24 prove justified pair use.
- The bible clause belongs in the existing palette section, with plan-lock as the operative enforcement point.
- Rendered-pixel diagnostics belong in image-generation review, surfaced rather than auto-rejected.
- Keep `global_prompt_suffix` empty; do not impose third-colour quotas.

