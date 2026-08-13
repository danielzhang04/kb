## Verdict

The missing mechanism is a plate-only composition policy. Forge currently locks style, register, seeds, and payload order, but never tells the model to preserve an actor-ready staging plane. The smallest sound fix is one derived Forge clause, inserted only on cast-free place-first generations, plus a reviewer pin that reads the same constant.

Do not add another style rule or edit `visual-grammar.md`. Re-generate L65, L84, L198, and parked L86. Keep L28, L114, and L112.

## 1. Mechanism map

A place plate is assembled as follows:

1. `cmd_batch` loads `shots.json`, copies `global_prompt_suffix`, and walks every shot in file order. Non-`ai-gen|hybrid` shots are skipped before place selection. [forge.py:2011](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge.py:2011), [forge.py:2027](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge.py:2027), [forge.py:2088](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge.py:2088)

2. The authored `still_prompt` is copied verbatim into `prompt`; the seeding key is `place`, then `stage`, then shot ID. The first eligible shot of a place has no `place_first` parent. [forge.py:2091](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge.py:2091), [forge.py:2246](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge.py:2246)

3. Named cast and primitives are resolved from backticked vocabulary. For these plates there are none, so no STEP-1/canonical/crowd seed is introduced. [forge.py:2132](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge.py:2132)

4. Non-figure anchors are derived from content:

   - A quoted literal derives `lettering-marker-italic`.
   - Structurally cast-free output derives `scene-style-tile`.
   - The cast-free predicate uses resolved figure roles, not prose words. [forge.py:2263](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge.py:2263), [forge.py:2273](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge.py:2273), [forge.py:2297](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge.py:2297)

5. Seed-role prose is prepended to the authored prompt by `placement_delta`: `SEED ROLES …` then the untouched `still_prompt`. [forge.py:1372](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge.py:1372), [forge.py:1484](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge.py:1484)

6. `plate` is then derived from the final seed-role list: only the style-anchor role is ignored as non-content. No authored `plate` flag exists. [forge.py:2384](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge.py:2384)

7. The spec stores:

   - `payload`: original `still_prompt`
   - `delta`: generated role prose plus `still_prompt`
   - `prompt_suffix`: file-level suffix
   - seeds/roles, `plate`, provenance, and `why`. [forge.py:2394](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge.py:2394)

8. At generation, every scene uses `mode: environment`, therefore the style-bible §2b descriptor is selected. `prompt_for` assembles:

   `§2b descriptor → crowd block if declared → RIG-HOLD if triggered → delta → global suffix`. [forge.py:382](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge.py:382), [forge.py:277](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge.py:277), [forge.py:1283](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge.py:1283)

9. The style tile contributes an image plus ordinal prose granting only line weight, outline color, flat-cel rendering, and palette saturation; it explicitly grants no content, layout, camera, or place. [forge.py:1456](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge.py:1456), [style-bible.md:174](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/channels/the-second-take/visual-kit/style-bible.md:174)

### What W1/W2 actually assembled

- L65 and L84: style tile only, `plate: true`. [w1-L65.spec.json:6](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/taste-forensics/w1-L65.spec.json:6), [w1-L84.spec.json:6](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/taste-forensics/w1-L84.spec.json:6)
- L112 and L198: style tile only, `plate: true`. [w2-L112.spec.json:6](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/taste-forensics/w2-L112.spec.json:6), [w2-L198.spec.json:6](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/taste-forensics/w2-L198.spec.json:6)
- L86 and L114: lettering exemplar plus style tile, but `plate: false`, because lettering currently carries generic role `environment` and therefore counts as content. [w1-L86.spec.json:16](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/taste-forensics/w1-L86.spec.json:16), [w2-L114.spec.json:16](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/taste-forensics/w2-L114.spec.json:16)

That last point is important: a composition fix keyed naïvely to current `plate: true` would miss branded place-first frames L86 and L114.

The W2 `$0` dry record confirms the final provider order: §2b, RIG-HOLD, seed roles, authored prompt, suffix. [w2-forge-prompts.md:3](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/taste-forensics/w2-forge-prompts.md:3), [w2-forge-prompts.md:8](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/taste-forensics/w2-forge-prompts.md:8)

All six payloads say “empty of people.” The word `people` makes `should_hold()` append §2c even though structural cast detection correctly calls the frame cast-free. That is harmless existing prompt bloat, not causal here, and should not be changed in this patch. [forge.py:202](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge.py:202), [forge.py:211](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge.py:211)

## 2. Differential diagnosis

Percentages below mean continuous, correctly scaled, unobstructed standable ground—not every visible floor-colored pixel.

| Plate | Camera and usable ground | Furniture/blocker distribution | Register diagnosis | Ruling |
|---|---|---|---|---|
| [L28.png](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/assets/scenes/L28.png) | Eye-level, near-frontal one-point view; roughly 22–28% continuous actor-scale aisle/foreground | Dense work detail at sides/back; bench end is a corner cue, not a frame-wide barrier | Approved cool house register: restrained saturation, stable flat fills, background lines subordinate to cast | GOOD |
| [L114.png](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/assets/scenes/L114.png) | Eye-level, mildly oblique; roughly 30–35% connected dirt staging plane | Brick stock forms side/back walls; forklift and shed stay out of the interaction area | Warm/ochre and slightly sketchier than L28: fine brick grids, corrugation, and ground marks; nevertheless coherent and explicitly accepted as the detail/open-space exemplar | GOOD; stand |
| [L65.png](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/assets/scenes/L65.png) | Elevated three-quarter view despite “head-on”; raw floor is large, but only about 10–15% is a continuous correctly scaled actor plane | Oversized desk monopolizes midground; visitor chair blocks lower-left; later bodies must overlap the desk or inherit the look-down angle | Saturation/lighting skew: nearly uniform amber, unusually high contrast from the sun slab, sparse place detail. Outline is broadly sound after W11 | BAD; re-gen |
| [L84.png](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/assets/scenes/L84.png) | Elevated oblique view down the table; about 10–15% usable ground, split into peripheral pockets | Table and nine chairs occupy the interaction plane; the foreground chair further closes the near edge | Cool/desaturated and finer/greyer than the house anchor; furniture geometry reads more architectural than chunky | BAD, lesser degree; re-gen |
| [L198.png](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/assets/scenes/L198.png) | Near-frontal but from behind the gallery; under 8% usable ground | Pews wall off the lower frame, counsel tables block midground, bench blocks background. There is no full-body shared plane | Closest of the bad three to acceptable flat-cel rendering, but denser panel realism and cinematic side-light push it away from the simpler approved register | WORST; re-gen |
| [L112.png](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/assets/scenes/L112.png) | Frontal one-point view; roughly 30–35% usable central floor | Stair, stanchion, shutter, walls, trusses, and lights bound the open floor rather than blocking it | Slightly thin/cool and perspective-heavy, but the repaired floor is flat and prior register review passed | PASS; stand |
| [L86-w11-retry.png](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/channels/the-second-take/visual-kit/_staging/L86-w11-retry.png) | Frontal deep aisle; roughly 30–35% usable central floor | Racks stay at the sides; composition is already actor-ready | Repeated rack lines are busy, but the blocking failure is specific: soft white airbrushed sheen remains on every wrapped pallet face | Composition pass; register fail; re-gen |

The five promoted new plates also show a cross-plate palette split. On a uniform 344×192 HSV sample, mean saturation ranges from 0.147 on L84 to 0.401 on L65; L112 is 0.153, L114 0.386, and L198 0.356. That scalar is not itself a pass/fail because the house allows warm and cool scenes, but it confirms the visible inconsistency: the cool plates drift pale/grey and thin, while L65/L114 drift toward a strong monochrome wash. The approved L28 is 0.196 and remains colored through clearly separated teal/cream/blue fills rather than an overall wash.

The core composition discriminator is not “amount of floor” alone. It is:

- Camera: eye-level, frontal or mildly oblique; no elevated tabletop-dominant or deep-corner staging.
- Ground: one connected foreground-to-midground zone, approximately 25–35% of the frame.
- Capacity: two full-body house rigs can share one plane and face/interact without furniture overlap.
- Blockers: large furniture and foreground depth props stay outside that zone.
- Density: the remaining frame stays occupied by the real set. L114 and L28 demonstrate that rich detail and actor room coexist.

The existing prompts show the causal difference directly: L65’s “big desk across the midground,” L84’s “long table across the midground,” and L198’s pew back “across the bottom” all allocate the character plane to furniture. [shots.json:868](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/shots.json:868), [shots.json:1117](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/shots.json:1117), [shots.json:2672](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/shots.json:2672)

## 3. Minimal fixlist

### One exact generation clause

```text
PLATE COMPOSITION — this overrides generic depth framing: eye-level, frontal or only mildly oblique; reserve one continuous standable-ground zone from foreground into midground, roughly 25–35% of the frame and wide enough for two full-body rig silhouettes to share one plane without furniture overlap. Any foreground depth prop stays at one edge and never crosses that zone. Outside it, keep the set rich and working with its real furniture, stock, and machinery.
```

Why this shape:

- The 25–35% range is large enough for staging but does not authorize a half-empty frame.
- “One continuous zone” prevents L84-style fragmented pockets.
- “Two full-body rig silhouettes/share one plane” captures actual placement and interaction geometry.
- “Frontal or only mildly oblique” keeps L114 legal.
- The explicit depth override addresses L198’s frame-wide pew without abolishing the house depth prop.
- “Outside it, rich and working” preserves L114/L28-level detail and the current MID-WORK plate law.

### Code targets

In [forge.py:430](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge.py:430):

- Add one `PLATE_COMPOSITION` constant beside the other derived scene policies.

In [forge.py:2088](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge.py:2088) and [forge.py:2297](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge.py:2297):

- Derive a boolean such as `plate_composition` from:

```python
bool(declared_place and parent is None and place_frame is None and cast_free)
```

This is deliberately independent of the current `plate` flag, so branded L86/L114 receive the law despite the lettering exemplar making them `plate: false`. It also excludes no-place inserts, later cast-free deltas, and ordinary figure-bearing bases.

In [forge.py:277](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge.py:277), [forge.py:382](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge.py:382), and [forge.py:1283](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge.py:1283):

- Add an optional generated-policy argument and assemble it before the request’s `delta`, not after the authored payload.
- Resulting order:

```text
§2b style head
optional crowd/RIG-HOLD policy
PLATE COMPOSITION
seed-role prose
shot still_prompt
global style suffix
```

In [forge.py:2405](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge.py:2405):

- Persist the derived boolean on the spec item. `_retry_scene` already copies unknown item fields with `dict(item, ...)`, so a fresh exact-replace retry retains the law without another production branch. [forge.py:2701](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge.py:2701)

In [build_review_artifact.py:206](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/.claude/skills/image-generation/scripts/build_review_artifact.py:206):

- Strengthen the existing `insertability` row; do not add another review axis.
- Reference `forge.PLATE_COMPOSITION` directly so exact prose has one home. Retain its existing MID-WORK/scale/signage half. The current row is too qualitative—“a flat open floor plane … a rig figure could be stood on”—and did not distinguish L65/L84/L198. [build_review_artifact.py:214](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/.claude/skills/image-generation/scripts/build_review_artifact.py:214)

### Explicitly ruled out

- No `visual-grammar.md` duplication: that would make the law author-dependent and create two copies.
- No addition to `global_prompt_suffix`: it would affect every scene, not only place-first plates.
- No third style/register paragraph: style already has exactly two voices plus the style-tile seed.
- No new seed, exemplar, blank-room asset, or character placeholder: zero seed-cap cost and zero content bleed.
- No 50% “empty floor” instruction: it would manufacture cavernous frames.
- No per-shot “consider character angles” prose: not mechanical.
- No change to the lettering/`plate:false` role semantics in this patch; the dedicated derived boolean handles it without widening seed/gating behavior.
- No new files or schema family: one constant, one derived boolean, one optional prompt-policy parameter, and strengthened existing tests/review text.

## 4. Re-gen scope

- **L65 — re-gen.** Composition fails. Use the new plate law and retain the successful W11 flat-floor control so the prior weave does not return.
- **L84 — re-gen.** Composition fails at the lesser level: table/chair mass occupies the interaction plane.
- **L198 — re-gen.** Highest priority. The new clause’s generic-depth override must move the foreground pew to an edge or leave a clear aisle; do not delete the required courtroom furniture.
- **L86 — re-gen fresh.** Neither staged version should be promoted. The W11 attempt remains explicitly parked and still fails flat-cel/register. [w12-verdicts-B.json:9](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/taste-forensics/w12-verdicts-B.json:9), [w14_promote_stamp.py:104](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/taste-forensics/w14_promote_stamp.py:104)

  Fold the surface correction into the fresh payload as one positive replacement, not the failed appended negation list:

  ```text
  pallets of flat cartons filling the lower two tiers, the shrink wrap represented only by one flat pale cel band and two or three crisp hard-edged contour lines per pallet face
  ```

  The old retry appended five negative surface instructions and even contains `highlights.,`; it did not change the pixels. [w11-L86-retry.spec.json:6](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/taste-forensics/w11-L86-retry.spec.json:6)

- **L114 — stand.** It is the target behavior: detailed perimeter/background plus a broad connected staging area.
- **L112 — stand.** It sits near the open-space upper bound, but the place is authored as a bare rented unit; stair, stanchion, corrugated walls, trusses, shutter, and lights keep it built rather than empty. It also serves numerous later full-body/crowd scenes, and its central ground is usable.
- **L28 — stand as the indoor gold exemplar.**

## 5. Adjacent-law check

- **Depth:** A terminal depth clause is explicitly legal. The new policy retains it but forces a generic foreground prop to one edge and outside the staging zone. [visual-grammar.md:244](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/channels/the-second-take/visual-kit/visual-grammar.md:244)
- **Payload order:** The new clause is generated policy before `delta`; no Forge scene clause follows the authored payload. Lettered payloads still close their `still_prompt`, with only the existing global suffix afterward. [visual-grammar.md:234](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/channels/the-second-take/visual-kit/visual-grammar.md:234)
- **Lettering:** No quotes, copy, font, or ink instructions are introduced. The existing derived lettering exemplar and literal-last law remain unchanged. [style-bible.md:178](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/channels/the-second-take/visual-kit/style-bible.md:178)
- **Place fidelity:** Furniture and stock are redistributed, not removed. The authored `still_prompt` remains later and supplies exact place facts; the existing reviewer still checks MID-WORK occupancy and scale. [visual-grammar.md:153](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/channels/the-second-take/visual-kit/visual-grammar.md:153)
- **Register:** The clause contains no render/style vocabulary, so it creates no third look voice. §2b, the global suffix, and style tile remain the only register mechanisms. [style-bible.md:51](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/channels/the-second-take/visual-kit/style-bible.md:51), [visual-grammar.md:12](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/channels/the-second-take/visual-kit/visual-grammar.md:12)
- **Seed order/cap:** Text-only; no seed slot, seed reorder, or API behavior change.
- **RIG-HOLD:** The policy is injected after `should_hold` is evaluated, so its mention of “rig silhouettes” cannot make a cast-free frame trigger §2c.

## Verification plan

### Unit/pin suites

- [test_forge_style_tile.py:93](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_style_tile.py:93): add one test covering exact wording, exact-once insertion, lettered L114-shaped place-first coverage, and absence from a no-place root/chained cast-free scene. Current 14 functions → expected **15/15**.
- [test_forge_surgical_retry_and_zones.py:126](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_surgical_retry_and_zones.py:126): extend the existing ordering/retry assertions; policy precedes payload and survives an exact-replace retry. Expected **13/13**.
- [test_build_review_artifact.py:270](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_build_review_artifact.py:270): pin that the existing insertability row contains the shared constant and both percentage/angle bounds. Expected **41/41**.
- Focused expected total: **69 functions**.
- Full image-generation scripts currently contain 284 static test functions; with one new function, **285 before pytest parametrization**. Run the full suite and report the actual collected/pass count.

### `$0` dry evidence before any re-gen

1. Rebuild a scoped spec for L65/L84/L86/L112/L114/L198 with canonical `forge.py batch`.
2. Run `gen --dry-run`; Forge’s dry path resolves seeds and prints the final prompt without loading an API key or making a call. [forge.py:1239](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge.py:1239), [forge.py:1296](/C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge.py:1296)
3. Assert:

   - Clause appears exactly once on all six place-first items, including lettered L86/L114.
   - It does not appear on L66/L87 or a cast-free delta.
   - Existing seed paths/order and suffix bytes are unchanged.
   - Authored payload bytes are unchanged except the approved L86 surface replacement and retained L65 surface fix.
   - No API URL/key is constructed in dry mode.

### Pixel gate after generation

Use a 10×10 overlay grid and two translucent full-body house-rig silhouettes:

- 25–35 grid cells form one connected foreground-to-midground standable zone.
- Both silhouettes share one scale/plane, can face each other, and overlap no blocker.
- Camera is eye-level, frontal or mildly oblique.
- Foreground depth prop touches an edge and does not cross the zone.
- Remaining frame is materially occupied by real set detail.
- Run existing flat-cel, line-register, palette, place-fidelity, no-figures, and lettering checks.
- L86 additionally fails on any soft white sheen or varying-opacity streak; `MINISCRIBE` remains exact.

No files were changed and no API calls were made. The repository’s existing dirty/untracked work was left untouched. A read-only pytest collection attempt could not start because the sandbox exposed no writable temporary directory; that is an infrastructure limitation, not a product-test result.