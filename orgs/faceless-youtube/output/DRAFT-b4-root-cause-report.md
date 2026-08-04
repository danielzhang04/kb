# DRAFT — B4 full-mechanism root-cause report

**Video:** `channels/the-second-take/videos/2026-07-28-bricks-fresh`  
**Date:** 2026-08-04  
**Scope:** VPW authoring → `shots.json` → retry overlay/spec → exact Forge/provider request  
**Spend:** **$0.000** in this audit. No new provider call or image was generated. The already-logged five-call L28 mechanism probe from 2026-08-03 is reused as evidence, not charged to this authorization.

## Executive verdict

**Class A is not a resolution or seed-count failure.** Forge sends every reference as an unlabelled, whole-frame PNG before one text prompt; it provides no mask, bounding box, coordinates, or per-image semantic role. Portrait STEP-1 sheets and the crowd exemplar therefore carry strong full-frame human occupancy priors, while the failed primary scene clauses put people on one interaction plane and try to correct scale later with adjectives. The closest positive controls use **structural depth in the primary scene clause** (L93: near lead / crowd behind glass or farther back; B4 L81: leads at table / crew at shelving), or simplify to one figure (round-3 L81). L28 also has a confirmed seed-role ordering bug and uses an occupied L26 frame as its place reference, but the earlier empty-plate ablation proves those are aggravators rather than the whole common cause.

**Class B is mostly authored-mechanism failure, not a run of unlucky samples.** L71 requests geometry that the locked parent does not reserve; L85 sends a grinning expression sheet and commands Forge to copy it exactly, then prose-overrules it; L87 asks a parent containing a standing foreman to remain otherwise unchanged while adding a seated foreman, without saying “replace/exactly one”; L96 asks a standing tower parent to “topple” without a completion quantifier. L75's “pen rests down” wording permits the observed lying pen. Re-rolling any of these unchanged would repeat the causal structure.

## 1. What Forge actually sends

The path is `batch` → canonical request builder → optional `_retry_scene()` → `preflight_batch()` → `cmd_gen()` → `ip()` for each seed → `nano()` ([`forge.py:54`](../.claude/skills/image-generation/scripts/forge.py#L54), [`:85`](../.claude/skills/image-generation/scripts/forge.py#L85), [`:824`](../.claude/skills/image-generation/scripts/forge.py#L824), [`:1293`](../.claude/skills/image-generation/scripts/forge.py#L1293)).

The provider receives one `generateContent` body of this shape:

```json
{
  "contents": [{"parts": [
    {"inlineData": {"mimeType": "image/png", "data": "<seed 1 bytes, base64>"}},
    {"inlineData": {"mimeType": "image/png", "data": "<seed N bytes, base64>"}},
    {"text": "<one assembled prompt>"}
  ]}],
  "generationConfig": {
    "responseModalities": ["IMAGE"],
    "imageConfig": {"aspectRatio": "16:9", "imageSize": "2K"}
  }
}
```

Current registry engine: `gemini-3-pro-image`. There is no system instruction, mask/edit region, coordinate, negative field, random seed, image-role field, temperature, or candidate-count control. `ip()` sends original bytes unchanged and labels them PNG; the audited inputs are real PNGs. Mixed source dimensions are not normalized.

### Seed order

- STEP-1 figure: canonical → expression → pose; output `2:3 / 1K`.
- Fresh/base scene: STEP-1 figures → no-hands canonicals → place/parent → primitives → crowd exemplar → tagged props/environments.
- Delta: canonical(s) → parent/place → pose primitives → expression primitives.
- Retry: stable-dedup of `prepend_seeds + native seeds (minus replaced parent) + extra_seeds`; a duplicated prepended seed moves to the front. More than four seeds hard-fails; nothing is silently truncated.

### Prompt order

`assemble_prompt()` joins:

1. STYLE-ONLY descriptor;
2. HARDENED SCENE STYLE;
3. canonical `still_prompt`/delta, then `PLACEMENT`, then any `RETRY OVERLAY`;
4. generated CROWD-RIG block when declared;
5. RIG-HOLD.

See [`forge.py:323`](../.claude/skills/image-generation/scripts/forge.py#L323). Consequently the authored “payload final” law in VPW ([`visual-prompt-writer/SKILL.md:74`](../.claude/skills/visual-prompt-writer/SKILL.md#L74)) is not literally true at provider time on figure/crowd shots: mechanical rig prose follows it. This may dilute precision, but it is **not a sufficient common cause**: L71 and L96 have no rig tail and still fail, while L93 passes with the tail.

### Confirmed positional-role defect

`placement_delta(prompt, cast, has_plate)` assumes cast occupy the first positions and, if a plate exists, calls the **last** image the destination place ([`forge.py:927`](../.claude/skills/image-generation/scripts/forge.py#L927)). That assumption is false whenever a tagged prop/crowd seed follows the plate, and retry prepending can also move the plate ahead of cast.

The final L28 retry's actual parts are:

1. L26 place, `2752×1536`;
2. Terry STEP-1, `848×1264`;
3. MiniScribe STEP-1, `848×1264`;
4. prop-drive, `2048×2048`.

Its text says “FIRST 2 images” are Terry/MiniScribe and “LAST image” is the place. Both statements are false. The place is also **higher**, not lower, resolution than the figure sheets, ruling out the proposed “low-resolution place loses weight” hypothesis. This is a real request bug, but not independently sufficient: full-population B4 L81 passed despite a weaker last-image/place mismatch.

## 2. Class A — figure scale

### L28

The third failure is systematic. The final request retained two portrait STEP-1 figures, the populated L26 scene, and prop-drive, then appended “16–20%” scale prose ([`round4-genlog-R.md:8-9`](../channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/round4-genlog-R.md#L8)). L26 itself contains a large MiniScribe figure, so it is not a neutral place plate. The seed-role prose is also corrupt as described above.

However, the earlier controlled probe already removed that confound. A clean empty L26 plate passed, yet compositing the same two figures against it still enlarged Terry to about 40% and MiniScribe to about one-third. A pre-scaled “distant pair” at about 45% was enlarged back to about 45%. Only a forced-perspective scene dominated by large foreground machinery got both figures to about 26–28%, and that materially restaged the set and duplicated props ([`round1-genlog-PROBE.md:15-19`](../channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/round1-genlog-PROBE.md#L15)). That recipe was explicitly removed from doctrine in [`knowledge/decisions.md:3747`](../knowledge/decisions.md#L3747).

**Verdict:** the whole-frame seeded-composite mechanism has not demonstrated reliable exact 16–20% occupancy. The occupied place and wrong role labels worsen the request, but adjective strength, empty-first, and a group intermediate were already ruled insufficient. L28 needs a different composition/technique, not another overlay.

### L60

Seed order is correct: Wiles STEP-1 → foreman STEP-1 → crowd exemplar; `16:9 / 2K`. The main clause seats Wiles, foreman, occupied chairs, and crowd around one long-table interaction plane. Only the later retry overlay calls the crowd background-scale. “Foreman seated opposite” does not pin a face-visible three-quarter view, so a back-of-head foreground occupant satisfies the geometry. Both attempts yielded foreground-large crowd; the retry additionally obscured the foreman ([`round4-genlog-R.md:10-11`](../channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/round4-genlog-R.md#L10)).

**Verdict:** authoring/layout conflict, not seed cap/order/resolution. The primary topology makes foreground people likely and does not protect the named foreman's visibility.

### L66

Seed order is likewise correct: Wiles STEP-1 → foreman STEP-1 → crowd exemplar. The main scene puts leads, office crowd, and “two managers standing by their chairs” on one table/chair plane, then uses a late overlay to request background scale. The two managers are individually countable and load-bearing but are neither named cast nor a supported foreground-anonymous tier; `figures` declares only `crowd:true`. The retry fixed text and the manager count while several people remained large/detailed ([`round4-genlog-S.md:9-10`](../channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/round4-genlog-S.md#L9)).

**Verdict:** two-tier authoring contradiction plus co-planar geometry. The crowd seed did not mysteriously fail; the request asks some anonymous people to behave like foreground actors while declaring only the background crowd tier.

### What worked — the differentiator, not vibes

| Comparator | Same mechanics | Mechanical difference | Outcome |
|---|---|---|---|
| Round-3 L93 | portrait named lead + same crowd exemplar; 16:9/2K; same crowd/RIG tails | Primary clause creates depth: foreground lead/case, crowd in a small line **behind a glass corridor wall**; seed roles explicitly bound | Crowd background-scale pass after hair-only retry |
| Round-4 L93 | same shot/seeds/config across attempts | “crowd gathers around him” failed; rewritten primary clause makes foreman alone near and 3–4 people **farther back, clearly smaller** | Scale pass |
| Round-3 L81 | portrait auditor + landscape L80; 16:9/2K | Removes crowd, foreman, crowd seed; uses huge pallet/rack landmarks and one “normal adult” | Pass, but it is a simplification proof, not a crowd proof |
| B4 L81 | four seeds including crowd, like L28's count | Separates leads at the count table from crew at racked shelves | Preliminary pass |

Therefore:

- seed count alone is not causal (four-seed B4 L81 passes);
- source aspect/resolution mix is not causal (portrait/landscape mixtures pass and fail; places are higher-res);
- the crowd exemplar is not sufficient cause (same exemplar passes L93);
- the strongest request-level differentiator is **positive spatial zoning in the primary authored scene**, plus lower human complexity when possible.

The crowd exemplar remains an aggravating prior: it is itself a 5-person, full-height, foreground lineup rather than a distant group. But the positive controls rule it out as the sole cause, so reminting it is not the first minimal fix.

## 3. Class B — precision misses

| Shot | Where the missed fact sits in the final prompt | Mechanism verdict |
|---|---|---|
| **L71** | Canonical gap relation is in the last third; retry repeats it in the literal final paragraph and forbids any belt/drive entering the light pool. No rig tail. | **Not buried.** L70's central light pool already occupies the floor where the new conveyor is told to run; no reserved disjoint corridor/gap or spatial control exists. Retry kept the same parent/config and appended duplicate prose, so it was an unchanged whole-frame relational edit. |
| **L85 expression** | `expr-caught` is early/mid-prompt, but PLACEMENT later says copy the sole STEP-1 seed's facial expression “EXACTLY”; that seed visibly has a broad toothy grin. Retry keeps both and appends “no grin/teeth,” followed by RIG-HOLD. | **Direct seed/text contradiction.** Initial grin is the stronger mechanism working as instructed, not bad luck. Retry is prompt accretion over the unchanged causal seed. |
| **L85 outline** | Source says only “empty chalk outline,” not rectangular/box-shaped. Retry echoes generic “chalk outline.” L85 is an unanchored root despite saying “same shelf bay.” | **Underspecified and ungrounded.** A body outline is semantically allowed; “keep same” cannot preserve pixels never supplied. |
| **L87** | “now sits” is followed immediately by “everything else exactly as established”; neither attempt says replace/remove standing foreman or exactly one person. Identity repair is followed by RIG-HOLD. | **Predictable duplication.** Parent L86 contains the standing foreman; the request preserves him and synthesizes another from canonical + generic sit/expression sheets. The first generic hoodie identity also tracks the last two visual seeds. |
| **L75** | “pen now rests down on the pad mid-stroke” is mid-prompt; no grip→pen→nib→page contact relation or pose seed. | **Authoring miss.** “Rests down” permits the observed pen lying on the pad; “mid-stroke” is also an unstable motion instant rather than a held pose. |
| **L96** | “tower ... has toppled, one single sheet...” is near the true prompt end; no rig tail. | **Not buried.** No “entire/all/nothing remains standing” quantifier counters the strongly seeded upright tower. Partial collapse satisfies the words. Rebase from the pre-tower ancestor rather than ask the L95 parent to erase/rearrange itself. |

L71 and L85 retries violate the binding no-accretion rule ([`image-generation/SKILL.md:287-300`](../.claude/skills/image-generation/SKILL.md#L287)): they retain the failed causal clause/seed and append another instruction. L87's identity sentence was genuinely replaced and the newly exposed duplicate defect correctly stopped the chain, although it bypassed the builder-owned overlay path and retained the ambiguous primitive seeds.

## 4. Ranked minimal mechanism fixes

### 1. Enforce seed-role truth after final seed merge — smallest definite code fix

**Files/functions:** `.claude/skills/image-generation/scripts/forge.py::placement_delta`, `_retry_scene`, base/delta seed builders; regression tests in `test_forge_figures.py` and `test_forge_seed_requirement.py`.

- Carry an ordered `{path, role, character}` list through assembly and emit actual ordinals: e.g. first=Terry, second=MiniScribe, third=place, fourth=prop. Give crowd exemplar, pose, and expression inputs explicit text roles too.
- When a retry prepends a seed already in the native list, preserve its native position or regenerate the role block after final merge/dedup.
- Preflight-fail when ordinal prose and actual parts disagree.

**Evidence:** L28's final role block is factually false. This fix removes a confirmed contradiction and makes future diagnoses trustworthy, though it is not sufficient to solve scale.

### 2. Add a VPW spatial-feasibility/tier gate before `shots.json`

**Files/clauses:** `.claude/skills/visual-prompt-writer/SKILL.md` Step 2/critic; `channels/the-second-take/visual-kit/visual-grammar.md` scene/payload ordering; shots-schema stage/place guidance.

- Background crowd must occupy a **positive rear zone in the primary scene clause**—far side of shelving/table, behind a divider, through a doorway, etc.—before payload detail. “Background-scale” appended to a co-planar gathering is not a mechanism.
- An anonymous person with an individual count/action/face requirement is cast, or the beat is restaged as a mass action. Do not encode L66's two managers through `crowd:true`.
- When a named face is load-bearing, require visible orientation/occlusion protection (L60).
- A place anchor must be figure-free or occupancy-compatible when downstream count/scale changes (L28).
- A delta must be physically feasible against its parent and change one **semantic transformation**, not merely have one array entry. “Same” requires an actual stage/place seed.

**Evidence:** L60/L66 vs both L93 controls; L71's unavailable floor corridor; L85's unanchored “same”; L87's bundled move+seat+desk+prop+expression change.

### 3. Route exact occupancy, boundary, removal, and full-collapse beats to the existing layered path

**Files/clauses:** `.claude/skills/image-generation/SKILL.md` technique menu and “Layered shots”; motion-planner/`shots.motion.json`; render-builder cutout placement.

Define a hard technique boundary: percentage-height scale, a required pixel-clear gap, replacing one person in a sticky parent, or removing/rearranging most of a seeded object is not a whole-frame prose delta. Use a figure-free approved plate plus deterministic cutout/layer geometry (or rebase from the pre-transient ancestor) so scale/position/count are measured, not sampled.

**Evidence:** the L28 probe ruled out empty-first and pre-scaled group seeds; only composition dominance changed scale, with unacceptable continuity damage. L71, L87, and L96 all ask prose to perform exact spatial deletion/replacement against a sticky parent. This is the minimal reliable mechanism change for exactness, even though it is broader than a wording edit.

### 4. Make the delta seed recipe match doctrine: parent + canonical identity; primitives only when proven necessary

**Files/functions:** `.claude/skills/image-generation/SKILL.md` delta seeding law; `forge.py` delta branch around the canonical/parent/primitive list.

- Bind pose/expression to the **same existing figure**, or omit generic full-frame primitive images from whole-scene deltas and express the held change through an approved replacement layer/STEP-1.
- An expression defect routes to rebuilding/re-authoring the expression/STEP-1 asset, never prose that opposes an “copy expression EXACTLY” seed.

**Evidence:** L87's last two full-frame primitive sheets are bald cream hoodie figures and the first result adopts that identity; L85 faithfully adopts its grinning STEP-1 seed.

### 5. Enforce surgical retries mechanically

**Files/functions:** `forge.py::_retry_scene`; overlay schema; `image-generation/SKILL.md` retry section; genlog template.

- Content retries must use exact `replace` (or a seed/mechanism replacement), with a dry-run diff showing one causal span changed. Reject an additive instruction that restates/opposes an existing clause.
- Record suspected layer—VPW, `shots.json`, seed recipe, assembly, provider limitation—in the exhausted genlog row.

**Evidence:** L71 and L85 appended contradictions while preserving the same causal inputs; their genlog stop rows do not record the suspected mechanism layer required by the current law.

### 6. Restore authored payload-final order — plausible, lower-confidence

**Files/functions:** `forge.py::assemble_prompt`; VPW payload-final law; prompt-order tests.

Move generated role/crowd/rig policy before the final authored payload/replacement clause, or make prompt zones structured so the payload is literally the last provider text. Do not treat this as the Class-A cure without a controlled test.

**Evidence:** L60/L66 scale overlays and L85/L87 precision clauses are followed by a 663-character crowd block and/or a 128-word rig tail, contrary to the VPW rule. Counterevidence: L93 passes with the same tails and L71/L96 fail without them; therefore tail order is an amplifier, not the established root.

## 5. Probe decision

**No new probes. Spend $0.000; no `rootcause-probe-*.png` or `round4-genlog-RC.md` was created.**

The only genuinely unisolated question is how much L28's false ordinal labels contribute. A corrected-order ablation could measure that, but it would not decide the operational question: the prior authorized probe already showed the scale failure with a clean empty plate and correct `[figure A, figure B, plate, prop]` order. It also ruled out a pre-scaled pair. Thus even a positive ordering effect would leave the whole-frame mechanism below the required exactness. Spending to re-prove that would violate the “probe only if needed to decide” constraint.

## Final per-class decision

- **Class A:** repair Forge role binding immediately; re-author crowd shots around explicit rear-plane topology and valid tiers; route L28-style exact-scale demands to simplification or deterministic layers. Do not revive the rejected forced-perspective foreground-props recipe and do not reroll the same whole-frame composite.
- **Class B:** repair upstream feasibility, seed contradictions, and replacement/completion semantics; use surgical replacement, rebase, or layering according to the defect. These are not adequately classified as stochastic misses.
