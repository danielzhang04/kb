# G2 change-list — the bricks taste-forensics proposals

Synthesis of Tracks A/B/C + Daniel's G0 answers into the smallest generalized set of changes that
FINALIZES the VPW + image-gen pipeline stages. Read-only forensics output: nothing here is
implemented, nothing is committed. Every row cites evidence that exists in the pack.

**Checked against Daniel's three binding laws on every proposal:**
1. *Rollback over addition* — each proposal states `class`, and every `new` carries a
   `why_no_rollback`. Where a rollback exists it is taken, and the guard the newer version bought
   for some OTHER factor is preserved explicitly rather than discarded.
2. *Generalized rules only* — no proposal is a per-shot patch. Every one is a rule over a class
   (a tier, a seed role, an asset class, a place), and the majority REDUCE function (2 rollbacks,
   2 removals, 1 keep-pin) rather than add it.
3. *Two-sided targets* — every H1/H3-derived target states both bounds.

## Summary

| # | proposal | class | blast radius | half |
| --- | --- | --- | --- | --- |
| P1 | Pin the liked qualities (test-pins, no behaviour change) | keep | 0 shots | both |
| P2 | Abolish the seeded-performer tier; an anonymous foreground story-bearer is CAST | rollback | 116/246 | both |
| P3 | Every asset class that seeds a scene earns a Pass-1 slot and the same reuse gate | remove | 246/246 | image-gen |
| P4 | Crowd figures carry varied flat head tones; hair + era attire are enforced, not re-legislated | new (1 clause) | 66/246 | image-gen |
| P5 | A plate is authored at working occupancy — cast-free never means content-free | new (1 clause) | 65 place shots / 8 places | VPW |
| P6 | A place's backdrop repetition is bounded by plate VARIANTS, not by new sets | new | 57 shots in 5 places | VPW |
| P7 | A figure-bearing shot inherits its environment from a pixel anchor, or is the anchor | new (lint) | 121/154 figure scenes | VPW |
| P8 | A figure card is minted in the beat's own ACT; prose may not re-pose a stance card | new | 91/154 figure scenes | both |
| P9 | Every seed role names which attribute class it owns — including the FACE on a delta | new (prose) | 31/44 deltas | image-gen |
| P10 | `pose` joins the STEP-1 retry defect enum | new (enum) | retry waves | image-gen |
| P11 | Restore per-shot warm-lean authoring density to a bounded middle | rollback | 246/246 | VPW |
| P12 | The vetoed expression asset is removed, identified from the judged pixel | remove | 1–62 shots (tag-dependent) | image-gen |
| P13 | The §5 register tile is derived on figure frames too (lowest confidence — droppable) | new | ≤154/246 | image-gen |

Dependency order: **P1 → P2 → P3 → {P4, P5, P6} → P7 → P8 → P9 → P10 → P11 → P12 → P13.**
Conflicts are listed in "Conflicts and how they resolve" after P13.

---

## P1 — Pin the qualities Daniel LIKED as explicit invariants before any other proposal lands

```
P1 — The liked behaviours are frozen as test-pins so no proposal below can silently trade them away.
class: keep
evidence:
  - money delta chain L40-43 + "hollowed out" + "rewind" liked (elicit-answers P01); measurements.json
    6c2 liked set includes L40/L41/L42/L43; chain evidence rests on ONE 3-beat sequence
    (separations.md H2: liked chain_depth mean 0.33 vs disliked 0.56 — chain depth does NOT
    generalize, so the pin is "don't break the chain recipe", never "chain more").
  - standalone concept shots liked: L32 "fun and unique" (P04), L35 "more going on… a more unique
    shot" (P02), L48 "shot is interesting. Depicts the scene" (P06).
  - warm liked frames: L47 "Named staging is better, lighting is good, warmer" (P06) — its prose is
    the only one of the three miniscribe-floor beats authoring warm light ("flat overcast light
    outside against warm strip light inside", shots.json L47) while the disliked L28/L29 siblings
    author "Cool grey-teal-cream palette"; L19 chosen "raking it in… Warmer" (P08).
  - rig discipline: four-digit hand law, NO nose / NO ears / NO teeth, squat head-to-body proportion,
    "base-cream bald head on a haired/toned character is an identity FAIL" (style-bible.md:20-24,
    60-64, 73-84, 113-115). Daniel: "without fucking up rigging" (P04-L33), "don't slip back into
    prior rig problems" (P01).
  - saturation floor: ea71f99 raised median saturation 0.089 -> 0.189 (dossier-notes H3 step 3) and
    median_sat is the ONE axis that separates liked from disliked (separations.md H3: 0.24 vs 0.13).
files_touched:
  - orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_seed_roles_and_delta.py
    (delta recipe = parent + canonical, <=4 seeds, unchanged by P9)
  - .../test_forge_figures.py (four-digit + crowd face-tier assertions unchanged by P4)
  - orgs/faceless-youtube/.claude/skills/visual-prompt-writer/scripts/test_shots_v2.py +
    test_doctrine_reset_guards.py (symbolic/abstract/object-insert classes stay place-exempt,
    lint_shots.py place_shot_class_exempt_check — so P5/P6/P7 can never force a plate onto a
    standalone concept shot)
  - orgs/faceless-youtube/channels/the-second-take/visual-kit/style-bible.md §2b saturation clause
    (ea71f99 wording) — pinned by fingerprint, not edited
rollback_target_commit: n/a
blast_radius: 0 shots (no behaviour change; adds/keeps assertions only)
test_impact: adds pin-tests to test_forge_figures.py, test_forge_seed_roles_and_delta.py,
  test_shots_v2.py; no existing test changes
ordering_dependency: FIRST — lands before P2..P13 so every later change is measured against it
```

Which liked quality each later proposal endangers, and where it is pinned:
- money chain → **P9** (delta face authority) must not change the delta seed recipe → pinned by
  test_forge_seed_roles_and_delta.py.
- standalone concept shots → **P5/P6/P7** (place/plate/anchor pressure) → pinned by the existing
  `place_shot_class_exempt_check` + `place_context_exempt_check` assertions.
- warm liked frames → **P11** is two-sided and beat-driven; the cool beats stay cool (27% of the
  current file authors cool/cold and L47's own "flat overcast light outside" is a liked cool
  exterior) → pinned by the band, not a global warm push.
- rig discipline → **P2/P4/P8** all touch figure law → pinned by the four-digit/proportion/face-tier
  assertions above; P4 edits ONE head-tone phrase and touches no face-simplification clause.

---

## P2 — Abolish the seeded-performer tier: an anonymous foreground story-bearer is CAST

```
P2 — A human who bears a beat is NAMED CAST or the beat is mass action; the bare rig template may
     never be cast as an on-screen figure.
class: rollback
evidence:
  - Daniel, P03-L27: "the character is cream and bald. It's not a cast character. Doesn't make sense."
  - Daniel, P05-L38: "the big guy in named is the COMPAQ character, in unnamed, he's nobody."
    (gen-A L34 = "`ibm-suit`, the customer institution personified"; gen-C L38 = "One seeded
    performer, `base`" — dossier.json L38 gen-A/gen-C, routing-trace L38.)
  - Daniel, P08-L19: "one center character foreground, can be character rig instead of crowd rig" —
    the current answer to that ask IS the performer tier, which he rejects at L27/L38.
  - routing-findings M1: the tier exists because ONE condition was deleted —
    ea71f99:469 `if n in chars and n != "base":` -> 27bc7e2:486 (current forge.py:495)
    `if n in chars:`; and visual-grammar ea71f99:148 "An anonymous foreground human does not exist;
    … is CAST or the beat becomes mass action" was replaced by the three-tier law.
  - Mechanism confirmed at the payload: forge.py:1287-1291 tells the engine the figure "is an
    ANONYMOUS figure, not a recurring identity: it claims no name and recurs nowhere"; the derived
    clause supplies GARMENTS only ("Take from that description ONLY the CLOTHING it implies",
    forge.py:1380-1383) so nothing in the route can give it hair or a head tone. `base`'s registry
    head_tone is #f5ead6 and its role reads "BASE TEMPLATE / rig anchor — not an on-screen
    character". Cream + bald is the tier working as specified.
  - Independent count on the current file: 116 of 246 `still_prompt`s name `` `base` ``
    (matches routing-trace blast radius M1 116/246).
files_touched:
  - image-generation/scripts/forge.py — `shot_cast` (472-501): restore `and n != BASE_TEMPLATE`;
    `seeding_law_violations` (751-767): re-point the EXISTING `figures.anon_foreground` refusal text
    at a `base` casting (rename of a refusal already in the file — this is the guard 27bc7e2 bought,
    kept); `seed_roles_text` (1270-1300) performer role prose + `canonical`-is-BASE_TEMPLATE branch:
    delete; `costume_clause` / `figure_card_payload`'s `costume` path (502-557, 1358-1389): retained
    ONLY as the carrier P8 re-uses (see P8) — otherwise stranded.
  - visual-kit/visual-grammar.md §2 (lines ~148-215): restore the anon-foreground law; delete the
    performer tier, the A-3 one-performer cap and the performer rows/wording in the figure-cap table.
    KEEP VERBATIM the anti-demotion clause ("A story-bearing foreground individual must not be
    replaced with an empty object, nor demoted to rear-zone crowd") with its fallback changed from
    "the seeded performer" back to "cast it, or stage the beat as mass action".
  - visual-kit/style-bible.md §2a (lines 25-31): delete the "seeded performer" branch of the
    SEEDED/CROWD split.
  - visual-prompt-writer/SKILL.md Step 2.3 (the seeded-performer paragraph + the one-performer cap +
    the "write era clothing in the SAME SENTENCE" mechanics) — delete; Step 3a cast-planning gains
    the sentence that anonymous story-bearers are planned INTO the cast list at 3a time.
  - visual-prompt-writer/scripts/lint_shots.py — `seeded_performer_singleton_check` (2304): becomes a
    flat refusal of any `` `base` `` casting (or is deleted in favour of the forge-side refusal);
    `_named_chars` (2175), `place_plate_check` (1627), `delta_entrance_check` (1776),
    `interaction_cast_check` (1971), `two_cast_presence_check` (2275), `semantic_cast_check` (2373):
    drop the "named cast and a `base` performer alike" clauses.
  - videos/2026-07-28-bricks-fresh/shots.json — 116 shots re-authored (each performer resolved to an
    existing cast member, a NEW registry cast member planned at 3a, or restaged as mass action).
rollback_target_commit: ea71f99 (forge.py:469 + visual-grammar.md:148). Offending commit: 27bc7e2.
why_no_rollback: n/a — this IS the rollback. The naked rollback re-opened one hole (naming `base`
  resolved to `[]`, so a performer minted no card, seeded nothing, and then measured `cast_free`);
  that hole is closed by re-pointing an existing refusal, not by keeping the tier.
blast_radius: 116/246 shots (routing-trace M1; reproduced by count). Of Daniel's 25 boarded beats,
  L27 and L38 are direct hits.
test_impact: test_forge_figures.py (shot_cast/base cases invert), test_forge_seed_requirement.py,
  test_forge_seed_roles_and_delta.py (performer role prose), test_forge_hold.py,
  test_forge_place_and_gates.py (plate law counts performers as seeded figures);
  lint side: test_doctrine_reset_guards.py, test_new_guards.py, test_round2_guards.py, test_shots_v2.py
ordering_dependency: after P1; BEFORE P3 (new cast members become Pass-1 gate items), P4 (crowd is
  the other half of the same tier decision — routing-findings: "M1 and M3 must be resolved
  together"), and P8 (the pose fix applies to whatever tier survives)
```

**Rejected alternative, stated because Law 1 requires it:** keeping the performer tier and giving it
per-shot hair + head tone would be "keep B whole and add function to replicate A" — explicitly
banned. It also cannot work as specified: a performer mints no canonical, so its hair and tone would
be re-invented per card and drift across a chain, which is the identity-FAIL condition style-bible
§3 already names.

**Cost that must be visible at G2:** casting is not free. The registry holds 12 characters today;
resolving 116 performer castings will mint some number of new named cast (each a Pass-1 canonical +
gate ruling under P3) and restage the rest. The pre-reset file's answer to the same problem was
demotion-to-crowd (19 of 26 idiom-puns, `scratchpad/authoring-audit.md` §1), which P2 forbids by
keeping the anti-demotion clause. **This is the single largest-cost proposal in the list.**

---

## P3 — Every asset class that seeds a scene earns a Pass-1 slot and passes the same reuse gate

```
P3 — Delete the asset classes carved OUT of the pre-gen gate: any asset whose pixels seed a scene
     (plate, environment, crowd exemplar, prop, pose/expression primitive, figure card) is listed at
     the Pass-1 gate and may not seed a scene without an all-pass review record for the bytes on disk.
class: remove
evidence:
  - Daniel, P04-L33: "Perhaps we should build, for image gen, a wave for human review of plates, all
    characters in poses and expressions, objects, and whatever, BEFORE actual image gen starts. If
    that isn't already the case, which I think it might be."
  - routing-findings question (b): the gate exists and the four classes he named are exactly the ones
    outside it. image-generation/SKILL.md:49 verbatim — "Environments, plates, one-off props and
    anonymous crowds get NO slot." Step 3 records an existing hit as `reused` with no human ruling,
    so a registered pose/expression is never re-gated.
  - Code confirms the coverage: the only review stores forge reads are FIGURE_REVIEW
    (`<kit>/_staging/review.json`, forge.py:1481-1527, figures only) and the scenes manifest;
    `vfile()` (cmd_batch:1639-1641) resolves every pose, expression, interaction template, prop and
    environment straight from the registry with no review record consulted.
  - The parked-parent refusal (forge.py:2069-2088) reads `assets/scenes/manifest.json`; every frame
    of this run lives in `visual-kit/_staging/`, which has no manifest record, so
    `_scene_manifest_entry` returns None and NO gate applies. The L28 plate that seeded 17 shots was
    reviewed by an operator, not by the pipeline (routing-findings (b)-3).
  - A card MINTED in the same batch is gated by no code at all — the 6c2 run's card-before-scene
    split was an operator convention in its genlog, not a forge law (routing-findings (b)-2).
  - Blast: 65 shots declare a `place` across 8 places; 66 shots declare crowd; expression tags appear
    on 197 shots, pose 94, action 91, prop 12, interaction 3 (counted on the current shots.json
    against registry.json: 18 expression + 17 pose + 13 action + 4 interaction + 2 prop + 3
    environment + 1 crowd-anchor assets).
files_touched:
  - image-generation/SKILL.md — Pass-1 step 1 final bullet (line 49): DELETE the exclusion; step 1
    gains plate/environment/crowd-exemplar/one-off-prop rows in the same slot table. Step 3 ("Reuse
    before regenerate") states that a reuse hit still requires a passing review record (it already
    does for figures — this makes the sentence class-agnostic).
  - image-generation/scripts/forge.py — call `figure_reuse_blocker(staging_dir, name, frame, store)`
    (1500-1527, already asset-agnostic and Kit-free BY DESIGN per its own docstring) at the plate /
    tagged-asset / crowd-exemplar resolution points inside `cmd_batch` (vfile 1639-1641,
    `place_anchor_for` 1466-1483, crowd exemplar), and at the in-batch card path so a card minted in
    the same batch is gated exactly like a reused one. Constant rename FIGURE_REVIEW -> ASSET_REVIEW
    (same file, same store).
  - image-generation/scripts/stamp_review.py + build_review_artifact.py — the existing `--figures`
    store carries the other classes' verdicts (no new store, no new wave).
why_no_rollback: the removal itself is a reduction (one exclusion bullet + one exemption), but two
  call-site additions are genuinely new: no prior commit ever gated a plate, prop, primitive or an
  in-batch card. There is nothing to roll back TO — the classes were excluded from the gate at
  85d60bd, when the gate was written. The alternative Daniel floated (a separate pre-gen review WAVE)
  is refused here precisely because it would duplicate a gate that already exists.
blast_radius: 246/246 shots (every scene resolves at least one gated asset once the exclusion is
  gone); newly gated classes: 8 plates, 1 crowd exemplar, 2 props, 30 body primitives, 18 expressions.
test_impact: test_forge_place_and_gates.py (plate/parked/gate coverage), test_stamp_review.py,
  test_build_review_artifact.py, test_forge_seed_requirement.py, test_forge_prop_guard.py
ordering_dependency: after P2 (P2's new cast members are Pass-1 gate items); BEFORE P4 (the per-video
  crowd exemplar is minted and gated through this path), P5/P6 (a revised plate is gated through it)
  and P12 (a vetoed expression is recorded as a FAIL verdict in this same store)
```

---

## P4 — Crowd figures carry varied flat head tones; hair and era attire are ENFORCED, not re-legislated

```
P4 — One phrase of the §2d crowd clause changes (cream-family -> a bounded set of flat head tones);
     everything else Daniel asked for on crowds is already law and is delivered by giving crowd a
     per-video seed through P3's gate instead of by writing new rules.
class: new (one doctrine clause) + enforcement of existing law
evidence:
  - Daniel, P01: "(1) Outfits should align with the setting and time. I.E Business room, should be
    business attire. Factory, should be factory worker attire. (2) I don't want crowd rig to all be
    just bald and cream. They should have hair and skin tone, and facial expressions that match the
    setting and time and situation. However, don't slip back into prior rig problems." Repeated
    P04-L33, P08-L07/L10/L19/L20.
  - ALREADY LAW, unrendered (routing-findings M3; style-bible.md:73-84, since aa576b9): "dress every
    crowd figure for THIS shot's own scene era and setting, not the seed's period dress, and vary
    hair/headwear across at most 2-3 repeating silhouettes for the whole group". Proposing new
    doctrine for these would add rules to fix an obedience problem.
  - ALREADY DECIDED against uniformity (dossier-notes H5): commit 240aed7 "crowd variety: bounded
    variety kept, uniform bald/cream rejected"; H5's premise has a NULL answer — no doctrine window
    ever mandated bald/cream crowds.
  - The one real blocker is one phrase: style-bible §2d "round cream-family heads" (line 73).
  - The mechanism for the obedience failure (routing-findings M3): a crowd frame's total figure
    authority is ONE channel-level exemplar granted "only its anonymous crowd proportion and face
    tier" (forge.py:1317) in its own period dress, plus prose. The dry-assembled p6b L19 request is
    one image, zero pose seeds, zero expression seeds — off-rig proportions (L07) and noses (L19
    unchosen) are that payload's predicted output.
files_touched:
  - visual-kit/style-bible.md §2d (line 73): "round cream-family heads" -> a bounded flat-tone rule
    (see target below). NOTHING else in §2d is touched — dot eyes, one simple mouth, NO noses, NO
    ears, NO teeth, the exact squat proportion, the four-digit hand and the "identical simplified
    face on EVERY crowd figure" rule all stay verbatim (P1 pins them).
  - visual-kit/style-bible.md §3 crowd review axis (lines 113-118): the crowd row gains the two
    already-legislated items as JUDGED axes — era-appropriate dress and 2-3 hair silhouettes — so the
    unhonoured clauses become review-decidable instead of merely written.
  - image-generation/SKILL.md Pass-1 step 1/4: the video's crowd exemplar is minted per video
    (era dress, the video's hair silhouettes and tone set) through P3's slot + gate.
  - image-generation/scripts/forge.py — crowd seed resolution prefers the video library's exemplar
    over `refs/base/crowd-exemplar.png` when one exists (same lookup shape `vfile()` already uses).
two-sided target: 2-3 repeating flat head tones per group drawn from the channel's existing head-tone
  set (registry cast tones, e.g. #f5ead6 / #e2b78c / #7a4f33) — NOT one uniform cream, and NOT a
  per-figure tone (that is the "distinct hairstyle invented per individual figure" failure §2d
  already refuses, one axis over). Same bound as the hair rule it sits beside, deliberately.
why_no_rollback: no earlier state described crowd head tone at all (style-bible has said "bald
  cream-headed" of the BASE TEMPLATE since c3c749d/ff36f63, never of crowds), so there is no version
  to roll back to. The change is one phrase, matched to the bound of the clause next to it.
blast_radius: 66/246 shots declare crowd (18 of them carry no cast seed at all — routing-trace
  M3 ids list). Daniel's hits: L07, L10, L19, L20, L27, L33.
test_impact: test_forge_figures.py (crowd clause fingerprint), test_forge_style_tile.py and
  test_forge_seed_requirement.py (crowd exemplar resolution), lint rig_clause_check fingerprint in
  test_doctrine_reset_guards.py / test_new_guards.py (clause text changes -> fingerprint changes)
ordering_dependency: after P2 (the tier decision) and P3 (the exemplar is minted/gated there)
```

**Deliberately NOT proposed here, against Track C's ledger:** rolling back the 27bc7e2 sentence that
exempts crowd expression from attribute-routing ("a crowd-rig figure names no asset and carries no
seeded pose or expression, so its expression and attitude are authored in plain prose",
visual-grammar.md:123 + VPW SKILL.md Step 2.3). It is an available rollback, but **no evidence in the
pack supports taking it**: none of Daniel's crowd complaints is about a prose-authored crowd
expression, and prose is currently the only channel delivering the crowd expressions he explicitly
asked for ("facial expressions that match the setting and time and situation"). Rolling it back would
delete his own ask and re-open the dead-crowd failure the exemption was written for. Recorded in
"Not proposed" with this reason.

---

## P5 — A plate is authored at working occupancy: cast-free never means content-free

```
P5 — The place-plate law states what a plate must CONTAIN, not only whom it must exclude: a plate is
     the set doing its work, at the scale the script implies, with its signage ink authored.
class: new (one clause in an existing law)
evidence:
  - Daniel, P01: "I just don't like the plate itself. I want space to be bigger/less cramped, text to
    be black, look a little more like a factory instead of a small room with nothing on the shelves."
    Also P02-L35 ("something like this background… could be a better plate"), P06-L47/L48 ("the plate
    inside, again"), P03-L29, P04-L33.
  - The defect is AUTHORED, not rendered (dossier-notes H1): gen-A L28 was a full figure scene
    (`miniscribe-rep`, `action-powerstance`, conveyor, four finished drives, factory windows); gen-B
    and gen-C re-authored it cast-free AND empty. Current L28 prose, verbatim: "entirely empty of
    people … a rack of EMPTY tote bins stage-left, a roller door shut at the far end"; its reuse child
    L47 says "the assembly floor runs away into the depth with its benches BARE". His words track the
    prose.
  - Measured: plate-linked dislike 7/8 = 87.5% vs the 6c2 baseline 16/25 = 64% (separations.md H1).
  - "Text to be black" is ALREADY LAW and simply unauthored: style-bible §5 fixes diegetic lettering
    ink at #241a12 in the marker hand (lines 158-166); L28's prose authors "a plain painted board
    carrying one word: 'MINISCRIBE'" with no ink stated, so the render chose a wood tone.
  - Detail: on 121 of 154 figure-bearing scenes nothing in the payload can carry background detail
    except adjectives (routing-findings M5) — the plate IS the detail carrier for the shots that seed
    it, which is why Daniel's "a little more detail in the backgrounds" (P03-L29) lands here and in
    P7 rather than on a per-shot prose-length rule (separations.md H6: prompt length is the wrong
    instrument and must not be cited against his stated preference).
files_touched:
  - visual-kit/visual-grammar.md, the plate law paragraph (the cast-free plate / reveal-seam block):
    add the occupancy + scale + signage-ink sentence.
  - visual-prompt-writer/SKILL.md Step 3a ("Places, stages + environments" bullet): the same sentence
    at the authoring end, where the plate is planned.
  - videos/2026-07-28-bricks-fresh/shots.json: the 8 plates re-authored (L28 first).
two-sided target (Amendment 1): a plate reads as the set MID-WORK — stock on the shelving, machines
  and materials in mid and background, depth filled edge-to-edge — at the scale the script implies (a
  factory floor reads as a floor, not one small room). NOT a cavernous empty hangar and NOT a
  cluttered prop-shop: the same "layered depth, filled edge-to-edge, name concrete elements, not
  categories" bar VPW SKILL.md Step 2.4 already sets for scenes, applied to plates. Cast-free
  continues to mean zero SEEDED FIGURES (the property that makes a plate reusable), never zero content.
why_no_rollback: the rollback target would be gen-A, which had no plate law at all — plates were
  figure scenes, and restoring that re-admits a figure into the frame that 17 shots seed, bleeding one
  identity across a whole place. The cast-free plate law is kept whole; one clause is added to the
  half it never stated.
blast_radius: 8 plates governing 65 place-declaring shots; miniscribe-floor alone is 17 shots — 8 in
  the judged window (L28, L29, L33, L34, L44, L46, L47, L48) and 9 NEVER boarded or judged (L169,
  L170, L171, L172, L232, L233, L234, L244, L245 — separations.md H1). A revised plate must remediate
  those 9 or they carry the defect forward silently; G4's stated test only names ">=2 place-children".
test_impact: test_forge_place_and_gates.py; lint place_plate_check / place_owner_check fixtures in
  test_shots_v2.py + test_new_guards.py (no rule-shape change — fixture prose only)
ordering_dependency: after P3 (a revised plate is gated before it seeds 17 shots); pairs with P6 —
  ship together, since P6 is what stops a better plate from failing the same way by repetition
```

**Refinement that must reach Daniel at G2 (separations.md H1, surfaced there, not buried):** the L28
plate as its OWN establishing shot is **liked**; every disliked verdict is the same pixels used as
anonymous backdrop behind a figure. So "the plate itself is the defect" is not literally true by the
boarded evidence — the failure mode is repetition of a generic backdrop. P5 (make the plate worth
looking at) and P6 (bound the repetition) are two halves of one fix, and P5 alone is predicted NOT to
clear the complaint.

---

## P6 — Backdrop repetition is bounded by plate VARIANTS of the same set, never by inventing new sets

```
P6 — A place that carries many shots mints 2-3 approved plate variants (different vantage/zone of the
     SAME set, each seeded from the first so the set stays one place), and shots distribute across
     them; one image never carries a whole act.
class: new
evidence:
  - Daniel, P01: "The six shots read as a little repetitive." P06-L47/L48: "the plate inside, again",
    "Unnamed place I don't like again."
  - Measured (separations.md H2, 6c2): liked mean plate_reuse_count 1.89 vs disliked 7.44 — the
    sharpest single split in the measurement track. Liked frames are standalones and the money chain;
    the disliked cluster is the reused-backdrop set.
  - Measured (separations.md H1 refinement): the plate reads FINE standing alone (L28 liked, same
    pixels, same plate_reuse_count 17) and reads wrong as repeated anonymous backdrop — so the
    quantity is the axis, not only the image.
  - Current distribution (counted on shots.json): 65 shots declare a place across 8 places —
    rented-warehouse 18, miniscribe-floor 17, jury-courtroom 10, audit-room 6, miniscribe-warehouse 6,
    wiles-office 4, colorado-brick-yard 4. Five places carrying 57 shots sit at or above 6.
files_touched:
  - visual-kit/visual-grammar.md, plate law: a place's plate is its first cast-free frame AND a place
    above the variant threshold declares its variants (same place id, each variant seeded from the
    plate, `place_anchor` selects which one a shot seeds — the field already exists,
    forge.py:1466-1483 / lint place_anchor_check:1199).
  - visual-prompt-writer/SKILL.md Step 3a: the variant decision joins the existing per-place plan
    ("decide now which sets recur"), so it is planned once, not improvised per shot.
  - visual-prompt-writer/scripts/lint_shots.py: `place_groups` (1575) gains the variant grouping;
    a SOFT heads-up when one plate frame anchors a place's whole run above the band.
two-sided target (Amendment 1): 2-3 plate variants for a place carrying more than ~5 shots, so no
  single backdrop image anchors more than roughly a third of a place's run — moving the reuse figure
  from today's 17-on-one toward (not below) the liked band's low single digits (liked mean 1.89).
  NOT one bespoke environment per shot: that is exactly the seedless-root state routing-findings M5
  measures as the environment defect, it deletes set continuity, and it multiplies plate cost.
why_no_rollback: places did not exist pre-reset (gen-A declares none; the 214-shot file ran 74
  seedless roots per `cmd_batch`'s own docstring), so there is no earlier state to restore. The change
  re-uses `place`, `place_anchor` and `place_groups` as they stand; it adds no field and no mechanism.
blast_radius: the 5 places at >=6 shots = 57/246 shots; miniscribe-floor's 9 unjudged cameos (P5) are
  inside that count. Cost: ~2 extra gated plate frames per affected place (~8-10 frames total).
test_impact: lint place_groups / place_plate_check / place_anchor_same_place_check fixtures in
  test_shots_v2.py + test_new_guards.py; forge test_forge_place_and_gates.py (same-place law)
ordering_dependency: with P5 (ship together); after P3 (variants are gated frames); BEFORE P7 —
  P7 pushes MORE shots onto anchors, so the repetition bound must exist first
```

---

## P7 — A figure-bearing shot inherits its environment from a pixel anchor, or IS the anchor

```
P7 — No figure scene is a seedless environment root by accident: consecutive shots on one set are
     authored as a stage (base + deltas) or declare the set's place, so exactly one frame per set is
     prose-only and every later one inherits pixels.
class: new (lint enforcement of an existing authoring law)
evidence:
  - routing-findings M5 (largest blast radius, 121/154 figure-bearing scenes): a scene that declares
    no `place` and has no chain parent seeds no plate and is excluded by design from the §5 style tile
    (`cast_free = not (fig_roles or canon_roles or crowd or anon_declared)`, forge.py:1834) — so the
    moment a shot contains a person, its set, depth, detail level and palette weight exist only as
    words. L30's whole payload is ONE seed, the Terry figure card (6c2-slate.json#L30); the breeze-block
    walls, trestle, stool and roller shutter are prose.
  - This is also the mechanical answer to Daniel's detail ask (P03-L29 "a little more detail in the
    backgrounds and just shots in general. Not too much detail, but a little more", scoped at P08-L10
    to environment/scene shots): on 121 of 154 figure shots nothing in the payload can carry detail
    except adjectives.
  - It is the mechanism for two more of his verdicts on the same frame — "characters are too big"
    (scale is prose-only with no set to scale against, routing-trace L30/L31) and "the cooler palette,
    staging is a little off" on L19-unchosen (routing-trace, M5 observation).
  - Counted on the current file: 181 of 246 shots declare no `place`.
  - `cmd_batch`'s own docstring says the pipeline was built to end this class ("74 of the audited 214
    shots run as independent seedless roots inside sets the video had already established") — it is
    now re-arriving from the authoring side.
files_touched:
  - visual-prompt-writer/SKILL.md Step 3a (places/stages bullet) + Step 3c self-audit: the act-close
    paragraph gains "unanchored figure-scene count" beside the existing red-ink and cadence counts —
    re-using the audit that already exists rather than adding a process step.
  - visual-prompt-writer/scripts/lint_shots.py: a SOFT check (it is a judgement about sets, not a
    mechanical fact) reporting figure-bearing shots with no `place`, no `stage` parent and no
    `place_anchor`, plus the per-act count; the file's existing `place`/`stage`/`stage_role` readers
    (place_groups 1575, delta_parent_of 1762, stage_check 289) supply everything it needs.
  - videos/2026-07-28-bricks-fresh/shots.json: consecutive same-set figure shots grouped into stages.
two-sided target (Amendment 1, and the H1/H2 counterweight): the target is ONE prose-only frame per
  set, not zero — a set's first frame is legitimately unanchored, and single-visit sets keep running
  as their own anchor (an unbroken visit is a `stage`, which lint already treats as anchored). NOT
  "declare a place on everything": lint already refuses invented places (`place_inventory_check`
  against `script_vocab`), and forcing declarations would manufacture the repetition P6 bounds.
why_no_rollback: no prior state anchored these frames — the pre-reset 214-shot file was worse
  (74 seedless roots) and had no `place` concept at all. The doctrine already exists (VPW's place/plate
  seed law); what is missing is enforcement, and it goes in the lint that already parses `place`.
blast_radius: up to 121/154 figure-bearing scenes carry no environment anchor today. How many are
  fixable by stage grouping vs how many are genuinely first-visits is NOT measured in this pack — it
  is an implementation-time count, and the honest G2 expectation is "a large fraction", not "all 121".
test_impact: lint fixtures in test_shots_v2.py, test_stage_check.py, test_new_guards.py (SOFT only —
  no HARD gate changes, so no existing file fails)
ordering_dependency: after P5+P6 (a better, variant-bounded plate must exist before more shots seed
  it); interacts with P13 (which restores the register anchor on the frames P7 cannot anchor)
```

---

## P8 — A figure card is minted in the beat's own ACT; scene prose never re-poses a stance card

```
P8 — The seeded pose must be able to carry what the shot asks the body to do: either the shot authors
     an act the bound primitive covers, or the card is minted holding that act. Prose stops re-posing
     bodies.
class: new (enforcement + one generalization of an existing derivation)
evidence:
  - Daniel, P03-L27: "It just has 5 fingers (in a pose that wasn't seeded from anything)";
    P05-L39: "character isn't seeded from any library pose, thus he's off rig … did we loosen
    character, expression, skin tone, poses, rigging"; P06-L48: "the expression isn't seeded off asset
    expressions and is thus off"; P04-L33: "hair is off rig"; P08-L19: "since the pose isn't seeded,
    the guy has four fingers".
  - routing-findings M2 (91/154 figure-bearing scenes, incl. 10 wholly pose-less cards): the channel
    owns 30 body primitives (17 pose + 13 action — reproduced against registry.json), all stances,
    none an act. `_split_primitives` binds the nearest stance, `figure_card_payload` mints the card on
    it (a pose-less card is told to stand "squarely at rest, arms relaxed at the sides",
    forge.py:1377-1378), and the scene then re-poses the figure in prose — which redraws the hands,
    and with them the head that sits on the body.
  - Per-beat table in routing-findings M2: L27 seeded `hold-one-hand` vs "hauling a grey dust sheet
    off a pallet stack"; L39 `hold-both-hands` vs "shoving the rear doors of an armoured cash truck
    shut"; L48 `action-slump` (card came back UPRIGHT) vs "a real SLUMP the drawing must execute";
    L33 no pose at all on either card vs two figures "clasped in `handshake`".
  - The law already exists and is simply unenforced — image-generation/SKILL.md:107 verbatim:
    "Exposed hands are seeded, never free-drawn … No library pose covers it -> that was a Pass-1 gate
    item, not an ad-hoc scene invention." Nothing in forge or lint compares the authored action to the
    seeded primitive. Track C's own note: the pre-reset authoring obeyed it by accident (old L26:
    "stands `action-powerstance`, `expr-smug`, at the head of an assembly line" — the prose IS the
    primitive).
files_touched:
  - visual-prompt-writer/scripts/lint_shots.py: a refusal in the exact shape of the existing
    `seat_support_check` (2225-2274) — that check already binds a primitive to the most-recently-named
    character by backtick order, mirroring forge's `shot_cast`, and already requires the SAME SENTENCE
    to supply the fact the seed cannot. Here: a figure sentence authoring a bodily act while the bound
    primitive is a stance is a finding (act verb list, closed and small, exactly as the seat check
    holds a closed support-noun list).
  - image-generation/scripts/forge.py `figure_card_payload` (1358-1389) + `costume_clause` (502-557):
    generalize the per-shot derived clause from CLOTHING-only to clothing + the beat's own act, so the
    card is minted doing what the scene asks. This RE-USES the derivation P2 would otherwise strand
    (P2 deletes its only current consumer, the performer's era dress) — net function goes DOWN, not up.
  - image-generation/SKILL.md Pass-1 step 1: an act no primitive covers is a Pass-1 gate item (already
    the stated law; it becomes an actual list row).
why_no_rollback: the primitive library was never richer — it holds 30 stances at every generation in
  this repo's history, so no earlier state carries the acts. The change enforces an existing written
  law and generalizes an existing derivation; it adds no tier, no asset class and no field.
blast_radius: 91/154 figure-bearing scenes seed a card carrying a static stance (routing-trace M2).
  Daniel's hits: L27, L33, L39, L48, L19.
test_impact: test_forge_figures.py + test_forge_seed_roles_and_delta.py (card payload text),
  test_forge_surgical_retry_and_zones.py (retry cards inherit the same payload), lint fixtures in
  test_new_guards.py / test_shots_v2.py
ordering_dependency: after P2 (which decides whose cards these are) and P3 (cards are gated before
  scenes spend on them); BEFORE P10 (a drifted card needs a re-mint route)
```

---

## P9 — Every seed role names the attribute class it owns — including the FACE on a delta

```
P9 — `seed_roles_text`'s role details enumerate what each seed grants; they must be complete, so no
     attribute (identity, face, pose, costume, set) is left unowned on any recipe shape.
class: new (prose forge already emits — one string per role)
evidence:
  - Daniel, P03-L30/31: "Terry eyes aren't seeded from the character itself, they are crowd rig bead
    eyes"; P03-L29: "the facial expression isn't seeded from any existing one".
  - routing-findings M4 (31/44 delta beats): a delta drops the verified STEP-1 card its base used and
    seeds parent + canonical (forge.py:1734-1750). Neither role owns the face — `canonical` grants
    "identity, head tone, hair and the pinned costume come from this image only" (1306-1307), `parent`
    grants "its held set and existing composition" (1309). The expression gate (913-920) fires only
    when a delta authors an expression DIFFERENT from the one its chain holds (1715-1718), so the
    common case — a delta restating the held expression — is ungated by design and the face is
    re-synthesized from a canonical.
  - The pipeline's own r2 verifier isolated and parked this on L34: "CANONICAL EXPRESSION LEAK — same
    L34 spec produced correct per-figure behaviour on `ibm-suit` … and incorrect on `miniscribe-rep`
    … because `seed_roles` never states which seed owns expression — a spec gap, not a generator
    lottery" (6c2-genlog.md STAGE 6b); place-seed diff on that frame measured 0.00-0.11% while the
    failure was 100% confined to one head.
  - The same completeness gap is why a base-tier expression asset can read wrong on a named face
    (dossier-notes H7: all 18 `expr-*` assets seed from `refs/base/base.png`, none from a cast
    canonical, and gen-C pairs them with named cast — e.g. L36 `miniscribe-rep`, `expr-greedy`).
files_touched:
  - image-generation/scripts/forge.py `seed_roles_text` (1270-1352): the `canonical`, `parent`,
    `expression` and `figure` role details each state their attribute ownership explicitly, including
    which seed owns eye/brow/mouth on a delta (the canonical's RENDER register vs the expression
    asset's SHAPE — the `expression` role already says "copy only eye/brow/mouth shape; ignore
    identity, head tone and hairline", so the missing half is the delta case).
why_no_rollback: no prior state ever stated expression authority — the gap has existed since
  `seed_roles_text` was written, and the delta recipe (parent + canonical, <=4 seeds) is the
  pipeline's founding shape. Rolling anything back cannot reach it. The change edits prose forge
  already emits; it adds no seed, no gate and no field, and P1 pins the delta recipe unchanged.
blast_radius: 31/44 delta beats (routing-trace M4). Daniel's hits: L29, L30/L31.
test_impact: test_forge_seed_roles_and_delta.py (role-detail strings are asserted there)
ordering_dependency: after P2 (the performer's role prose is deleted first, so the completeness pass
  is done once over the surviving roles)
```

---

## P10 — `pose` joins the STEP-1 retry defect enum

```
P10 — A card that came back in the wrong posture is re-minted through the sanctioned re-mint path,
      not argued with in scene prose.
class: new (one value in an existing enum)
evidence:
  - routing-findings M6: `_retry_scene` accepts defect in {content, seed, mechanism} (forge.py:2118-
    2119), hard-refuses additive `instruction` (2125-2127) and `_EXPRESSION_RETRY` (1981-1984) refuses
    any expression word in a scene retry; `_retry_step1` accepts {expression, rig} (2228). A
    pose/action drift is in NEITHER set.
  - The 6c2 run hit this wall and logged it verbatim: "a POSE/ACTION drift is neither, so the card
    itself cannot be re-minted through the sanctioned retry path."
  - Consequence on a judged frame: L48's card came back upright against `action-slump`, the only legal
    lever was scene prose, and the prose moved the face — Daniel: "the expression isn't seeded off
    asset expressions and is thus off" (routing-trace L48, M2+M6).
files_touched:
  - image-generation/scripts/forge.py `_retry_step1` (2222-2236): `defect` accepts `pose`; the
    re-mint path already rebuilds the card from its own recipe, so nothing else changes.
why_no_rollback: the retry enum has never carried `pose` in any commit; there is no earlier state to
  restore. This adds one value to an enum whose machinery already exists — the cheapest possible shape.
blast_radius: 0 shots directly; every future retry wave (the 6c2 wave parked 2 scenes on exactly this).
test_impact: test_forge_surgical_retry_and_zones.py
ordering_dependency: after P8 (P8 reduces how often a card comes back wrong; P10 is the repair route
  for the residue)
```

---

## P11 — Restore per-shot warm-lean authoring density to a bounded middle

```
P11 — Each shot's palette clause states a deliberate warm or cool lean for its beat, and the file's
      warm share returns to a bounded middle between today's floor and the Poyais era's ceiling.
class: rollback (partial, bounded — authoring density only)
evidence:
  - Daniel, P02-L35: "L35 palette may be a little too cool. It's fine for a shot, but I don't want the
    entire video to be cool palette. Perhaps we go back (a little bit back) to the slightly warm
    channel profile that we had back during Poyais." P03-L30/31: "these shots I think are too monotone
    almost". P06-L47: "Named staging is better, lighting is good, warmer … Again, I don't want really
    warm. I just don't like the monotone cool." P08-L19: "Warmer" as a chosen-virtue.
  - The era discipline was AUTHORED per shot, not emergent (dossier-notes H3, citing
    poyais-mechanism-archaeology.md and re-verified here): Poyais `shots.json` at ff36f63 = 117 shots,
    110 (94%) contain "warm", 102 (87%) carry a Palette clause, 24 (21%) cool/cold.
  - Current file, counted the same way: 246 shots, 44 (18%) "warm", 66 (27%) "cool/cold", 246 (100%)
    carry a Palette clause. **The clause half is already restored; the LEAN is the gap.**
  - The structural half of the rollback is already shipped and must NOT be re-rolled: d1f771a restored
    the era `global_prompt_suffix` verbatim (still live at HEAD — the 609-char era string including
    "warm brown-black" and the red-accent clause) and the §2b descriptor, and deleted
    HARDENED_SCENE_STYLE. Its own decisions.md banked the residual: "Era palettes were authored warm
    per shot (93% 'warm'); the fresh file's palette prose is cooler — board v2 renders are the
    evidence gate for a palette pass." This proposal IS that banked pass.
  - Per-shot proof on the judged beats: the liked L47 authors "flat overcast light outside against
    WARM strip light inside" while its disliked siblings L28/L29 both author "COOL grey-teal-cream
    palette" (shots.json, verbatim).
  - Measurement (separations.md H3): median_sat separates cleanly — liked 0.24 [IQR 0.16, 0.49] vs
    disliked 0.13 [0.11, 0.20]; 0/30 liked frames are cool-inverted. ink_r_minus_b does NOT separate
    (liked 18.36 [5.04, 28.88] vs disliked 15.14 [1.92, 29.91]) and CONTRADICTS Daniel on L39 (he
    called it "way too cool"; it measures rb=+16.8, hue 31.6deg — warm, inside the liked band). Treat
    desaturation/monotone as the real axis and shadow hue as the weak one.
files_touched:
  - visual-prompt-writer/SKILL.md Step 2.4 (the "committed scene palette" clause): the palette clause
    states the beat's LEAN, not only its colours.
  - visual-prompt-writer/SKILL.md Step 3c (per-act self-audit): a palette-lean count joins the
    existing red-ink count in the same paragraph — re-using an audit that already runs, adding no step.
  - videos/2026-07-28-bricks-fresh/shots.json: per-shot palette clauses re-leaned across 246 shots.
  - NOT touched: style-bible §2b (ea71f99 saturation clause) and `global_prompt_suffix` — both already
    correct, both pinned by P1.
rollback_target_commit: ff36f63 (the Poyais-era per-shot authoring discipline, measured above).
  Explicitly NOT rolled back: d1f771a (structural restoration, already live) and ea71f99 (saturation).
two-sided target (Amendment 1, verbatim scope "a little bit back… not as warm… I don't want really
  warm"): warm-leaning shots rise from today's 18% to roughly 45-60% of the file — a clear majority
  lean, NOT the era's 94%; the ~27% of beats the story wants cold stay cold (L47's liked overcast
  exterior is one of them). Render-side acceptance band, both sides stated: median_sat inside the
  liked IQR **[0.16, 0.49]** (not the liked maximum 0.72, not at or below the disliked median 0.13);
  ink_r_minus_b inside **[5, 29]** as a SECONDARY, weak indicator only, never as a sole gate, and with
  the L39 contradiction on the record.
blast_radius: 246/246 shots (authoring pass); no code change, no mechanism change.
test_impact: none in code. Lint fixtures unchanged (a SOFT lean-count check is optional and is NOT
  proposed here — the Step 3c audit is the lever).
ordering_dependency: after P5/P6/P7 (plates and anchors carry palette into the frames that seed them,
  so re-leaning the prose first would be measured through the wrong mechanism); independent of P8-P10
```

---

## P12 — The vetoed expression asset is removed, identified from the judged PIXEL, not from prose

```
P12 — An expression the human vetoes is removed from the library and recorded as a failed verdict in
      the review store, so no shot can re-seed it and no re-request can re-mint it.
class: remove
evidence:
  - Daniel, twice, unprompted: P02-L38 "I don't like that facial expression. Remove it from the
    expression asset library"; P04-L32 "I don't like that facial expression either. Get rid of it from
    the asset expression base library"; restated P05-L38.
  - Identification is a PIXEL question, not a prose one (dossier-notes H7): all 18 `expr-*` assets are
    provenance-identical — every one keyed to `"character": "base"`, all first appearing at
    c3c749d/ff36f63, all seeded from `refs/base/base.png`, never revised; no `expr-villain` or similar
    row exists. Current L38 prose carries `expr-deadpan` (the performer) and `expr-pleading`
    (`miniscribe-rep`); current L32 carries `expr-shock`. Track A found "no basis in the commit history
    to single out one of {deadpan, pleading, shock}" — the judged frame must be resolved through
    `_build_elicit_board.py`'s `board_ref`/`best_pool_match`, per Task 1's carried finding that
    beat-map render paths != judged pixels for 92/228 cards.
  - The intensity half is ALREADY LAW, twice: style-bible §3 "Expression register-fit — judged against
    the BEAT … an over-the-top expression for its beat is a defect"; image-generation/SKILL.md Pass-1
    step 4 "Expression frames are authored moderate … the big end is for a real comedic peak". Daniel's
    P04-L36 ("a little too strong … he could be celebrating instead of super smug … looks like he's a
    villain") is that law unenforced, not a missing rule — and P3 is what makes it enforceable, since
    expressions currently never re-enter a gate once registered.
files_touched:
  - visual-kit/registry/registry.json — the identified `expr-*` row removed (and its PNG left in place
    but unreferenced), plus a replacement minted through P3's Pass-1 slot if the beat still needs one.
  - `<kit>/_staging/review.json` via stamp_review.py — the veto recorded as a FAIL verdict, so P3's
    blocker refuses it by the same predicate that refuses any un-reviewed asset.
  - videos/2026-07-28-bricks-fresh/shots.json — the shots naming the removed tag re-authored.
  - NOT touched: the expression-intensity doctrine (already correct in two files).
why_no_rollback: n/a for the removal. Note the identification STEP is not a change to any file — it is
  a read of the judged pixel, and it must happen before this proposal is implemented.
blast_radius: tag-dependent, and the range must be visible before Daniel rules: `expr-deadpan` appears
  in 62 of 246 shots, `expr-shock` 9, `expr-pleading` 1 (counted on shots.json). Removing deadpan is a
  62-shot re-authoring; removing pleading is a 1-shot change. **Do not implement before the pixel
  identifies the tag.**
test_impact: test_stamp_review.py, test_forge_seed_requirement.py (a named-but-missing primitive is
  already refused by `seeding_law_violations` 819-822 / 936-939), lint registry-vocabulary fixtures in
  test_shots_v2.py
ordering_dependency: after P3 (the store that carries the veto); independent of everything else
```

---

## P13 — The §5 register tile is derived on figure frames too (LOWEST CONFIDENCE — droppable)

```
P13 — The scene style tile stops being conditional on a frame being cast-free: it is derived on every
      generated scene, and on a figure frame it enters as the LAST droppable seed in the existing
      ordered cap displacement.
class: new
evidence:
  - routing-trace L38, second observation: "no register anchor on a two-figure cast frame" ->
    Daniel, P05-L38: "the art style/color is a little off".
  - The exclusion is one condition: `cast_free = not (fig_roles or canon_roles or crowd or
    anon_declared)` (forge.py:1834), which gates the STYLE_TILE derivation at 1835-1839.
  - forge's own comment at that site argues the opposite of the gate: "The cheap failure here is the
    opposite one: the tile on a frame that turns out to hold people costs one seed slot and
    contributes register only, and it can never contradict a cast seed, because its role prose grants
    it nothing but line weight and palette."
  - Interacts with H3: the tile's role is line register + palette (STYLE_ANCHOR_ROLE prose,
    forge.py:1330+), i.e. the axis separations.md found actually separates liked from disliked.
files_touched:
  - image-generation/scripts/forge.py: the `cast_free` condition at 1834-1839 (derivation), and the
    cap-displacement priority list (1861-1906) — the tile keeps its LOCKED/never-dropped status on
    cast-free frames and becomes the FIRST drop on figure frames, ahead of the crowd exemplar, so it
    can never displace a cast card, a plate or a lettering exemplar.
why_no_rollback: the tile itself is newer than the era — it was introduced at d1f771a already gated to
  cast-free frames, so there is no state where figure frames had it. **Flagged against Law 1: this
  EXTENDS a d1f771a addition rather than reducing anything, and it rests on ONE observation.** The
  honest alternative is to do nothing here: the era anchored register through the §2b descriptor head
  and the suffix tail, both of which are already restored and reach every gen. Boss may drop P13
  without affecting any other proposal.
blast_radius: up to 154/246 shots (every figure-bearing scene would gain one derived seed, subject to
  the cap). Cost: one seed slot on frames that often already carry 3-4.
test_impact: test_forge_style_tile.py (the derivation condition is asserted there),
  test_forge_seed_requirement.py (cap displacement order)
ordering_dependency: last; after P7 (P7 removes the anchor gap on the frames it can reach, which
  shrinks P13's remaining justification — re-measure before implementing)
```

---

## Conflicts and how they resolve

1. **P7 (anchor more environments) vs P5/P6 (repetition is the top dislike correlate).** P7 pushes
   more figure shots onto plate/parent seeds; H1/H2 measured plate reuse as the sharpest liked/disliked
   split (1.89 vs 7.44). Resolution: P5+P6 land FIRST and P6's variant bound is what P7 anchors onto.
   Implementing P7 alone would raise the exact quantity Daniel disliked.
2. **P2 (abolish the performer) vs the anti-demotion clause the tier was built to serve.** The tier
   exists because 19 of 26 idiom-puns had staged their performer as background crowd
   (`scratchpad/authoring-audit.md` §1). P2 keeps that clause verbatim and changes only its fallback
   (cast it / mass action), so the rollback does not re-open the demotion failure.
3. **P2 vs P3 cost.** P2 converts an unknown share of 116 performer castings into named cast, each of
   which is a Pass-1 canonical and a gate ruling under P3 — the two proposals multiply each other's
   human-review load. This is the wave's single largest cost item and belongs in the G2 ruling, not in
   implementation.
4. **P4 (crowd tones) vs the rig-discipline pins.** The head-tone phrase sits inside the §2d clause
   whose neighbours are the no-nose/no-ear/proportion laws Daniel also insists on ("don't slip back
   into prior rig problems"). Resolution: P1's fingerprint pins hold every other clause byte-identical;
   P4 edits one phrase and adds two REVIEW axes, no rig text.
5. **P4 vs Track C's ledger.** Track C lists the crowd prose-expression exemption as an available
   rollback; P4 declines it on Daniel-evidence grounds (see the note under P4 and the Not-proposed
   list). Flagged because it is the one place this change-list departs from a track's own fix direction.
6. **P11 vs P1's saturation pin.** A warm re-lean must not be implemented by desaturating or by
   re-rolling ea71f99 — median_sat is the axis that actually separates the sets. P1 pins it; P11's
   acceptance band is stated on median_sat, so the two move in the same direction by construction.
7. **P13 vs Law 1.** Stated inside P13: it is an extension of an addition, on one observation. Listed
   last and explicitly droppable.

## Daniel's G0 directives — where each one lands

| directive (verbatim source) | treatment | proposal |
| --- | --- | --- |
| "Remove it from the expression asset library" (P02-L38, P04-L32) | removal, but the tag must be identified from the judged pixel first | P12 |
| expression "too strong … looks like he's a villain" (P04-L36) | **already law** (style-bible §3 register-fit; SKILL Pass-1 step 4 "authored moderate") — enforcement via the gate | P3 + P12 note |
| "reinstate the slightly warm channel palette … a little bit back … not as warm" (P02, P03, P06) | rollback of per-shot authoring density only; structural half already shipped at d1f771a | P11 |
| crowd "hair and skin tone" (P01) | skin tone = one clause edit; **hair = already law since aa576b9**, unrendered | P4 |
| crowd "outfits should align with the setting and time" (P01) | **already law since aa576b9** ("dress every crowd figure for THIS shot's own scene era and setting") — enforcement + a per-video exemplar | P4 (+P3) |
| crowd "facial expressions that match the setting and time and situation" (P01) | already authorable in prose today; kept, and the crowd exemption is deliberately NOT rolled back | P4 note |
| "don't slip back into prior rig problems" (P01), "without fucking up rigging" (P04) | test-pins on the four-digit / no-nose / proportion / identity-match laws | P1 |
| "a wave for human review of plates, all characters in poses and expressions, objects … BEFORE actual image gen" (P04-L33) | **half-built already**: the gate exists, four classes are excluded by one sentence — delete the exclusion, do not build a second wave | P3 |
| "You should take a look at the seeding logic" / "did we loosen character, expression, skin tone, poses, rigging?" (P03, P05) | answered mechanically: identity LOOSENED (P2), crowd+delta expression LOOSENED (P4 note, P9), rig TIGHTENED, skin tone PINNED, poses never sufficient (P8) | P2, P8, P9 |
| plate "bigger/less cramped … text to be black … more like a factory" (P01) | occupancy/scale clause; black ink is **already law** (§5 #241a12) and was simply unauthored | P5 |
| "six shots read as a little repetitive" (P01) | variant bound on backdrop reuse | P6 |
| "a little more detail in the backgrounds … Not too much detail" — scoped to environment/scene shots (P03-L29, P08-L10) | delivered by giving the environment a pixel carrier, NOT by a prose-length rule (H6's proxy is the wrong instrument) | P5, P7 |
| "one center character foreground, can be character rig instead of crowd rig" (P08-L19) | exactly what P2 restores: cast it, or stage the mass | P2 |
| "characters are too big" / scale (P03-L30/31) | mechanical: scale is prose-only on an unanchored set | P7 |

## Not proposed — insufficient evidence

- **Rolling back the crowd prose-expression exemption (27bc7e2, visual-grammar.md:123).** Available,
  but no Daniel evidence asks for it and it is the only channel currently delivering his "expressions
  that match the situation" ask; removing it re-opens the dead-crowd failure it was written for.
- **Any change to seed-cap displacement (0e7e8d8).** FALSIFIED at 0/246: max seed count 4, one shot at
  the cap (L33), `assets_omitted` empty on all 246 (routing-findings M8). Inert here — leave it alone.
- **"Chain more shots" as a fix.** H2's chain half rests on a single 3-beat sequence (liked chain_depth
  mean 0.33 vs disliked 0.56 — the wrong direction for clean separation; separations.md H2).
- **A prose-density / word-count rule for detail.** H6's proxy measures the prompt, not the pixels, and
  runs the WRONG way on the p6b subset (disliked mean 91.25 words vs liked 79.11). It must not be cited
  against Daniel's stated preference; a rendered-pixel detail measurement would be the right instrument
  and does not exist in this pack.
- **`ink_r_minus_b` as an acceptance gate on its own.** IQRs overlap almost entirely and it contradicts
  Daniel on L39 (he says "way too cool"; it measures warm, inside the liked band).
- **Restoring the era's red-accent density** (era 82% of shots named the accent; current file 9/246 =
  4%). Daniel never raised it, and VPW's own act self-audit warns that a rising red count means the
  accent is turning into decoration. No evidence either way.
- **A general "shot must match its text" rule.** One beat (L31, "the shot doesn't really match the
  text", verdict authored_boring); `vo_ref` + the Step-8 fresh-eyes critic already own this surface.
- **Per-cast-member expression variants** (an `expr-*` set per named character). The structural finding
  is real — every expression seeds from `refs/base/base.png`, none from a cast canonical (dossier-notes
  H7) — but the only symptom is one ambiguous beat (L36) that Track A could not disambiguate from
  history, and the fix would mint a whole new asset class. P9's attribute-ownership prose is the cheap
  test; re-open this only if G4 shows it failing.
- **Any change to the `parked` chain-parent refusal or the scenes-manifest gate.** Real coverage hole
  (staging frames have no manifest record) but it is subsumed by P3's store; no separate proposal.
- **L30/L31's "mountains in the back don't make sense".** Authored content on one beat
  (authored_boring); no mechanism, no class rule — an authoring correction, not doctrine.

