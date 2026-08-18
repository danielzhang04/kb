# Adversarial audit — crowd-rig standards and enforcement (bricks)

**Verdict:** Primary cause buckets are **(a) exemplar defect + (c) enforcement gap**, confidence **0.94**. **(b) payload/prompt defect** is also primary for L87 and contributory for L244, confidence **0.88**. **(d) engine-specific behavior** explains the different costume/count/mouth/hair manifestations, but not the cross-arm defect class, confidence **0.93**.

## Scope and decision rule

This audit read the crowd and family-rig law, `forge.py`, `lint_shots.py`, `build_review_artifact.py`, `stamp_review.py`, the review store, the five authored shot payloads, the frozen A/B requests, both crowd exemplars, representative cast canonicals, the verified crowd scenes, and all 15 Round-2 images. No image was regenerated.

For image evidence, crop boxes below are `[x1,y1,x2,y2]` in native pixels. Pro frames are 1376×768, Flash frames 1344×768, Codex frames 1672×941. Rows group figures only when every figure in the group has the same defect and cause; counts are explicit so no visibly bad figure is omitted.

The user-supplied causal rule is decisive: a materially identical defect across Pro, Flash, and Codex with the same frozen prompt and seeds is ours, not one engine's. The frozen request records prove the crowd scenes all used `[place, video-local crowd exemplar]` with no cap displacement (`ab2-test-items.json:150-160`, `:192-202`, `:234-244`).

## Executive finding

Daniel's “off/weird” reaction is not one defect:

1. **The crowd anchor is not actually at the family-rig proportion.** The doctrine says the crowd rig differs from the full rig only in the face and uses the exact base proportion. The approved base is about 3.14 head-heights tall; all five video-exemplar figures are about 2.42–2.54. That chibi silhouette recurs in all three L244 arms.
2. **The dot-eye face is intentionally a different face language.** It is compliant with the written crowd tier, not engine drift. It becomes conspicuously off-family when crowd figures are rendered large or story-bearing, as in L87 and the foreground of L244.
3. **The verification contract is not enforced by code.** A crowd scene gets one coarse row, the crowd exemplar is automatically treated as a generic non-figure asset, and `stamp_review.py` accepts `worst: clean` without requiring any crowd invariant. The already-verified L46 is concrete proof of the escape.
4. **L87 is authored into the wrong tier.** Counted accountants perform separate actions in the middle of frame, yet the shot declares them as crowd. The current lint intends to reject that shape but its noun regex omits `figure(s)`, so the exact wording passes with zero HARD violations.

The engines add their own errors, but they are secondary: Pro copies exemplar clothing and opens mouths; Flash under-counts L87 and over-homogenizes L169; Codex over-varies hair. Those do not explain the shared chibi/dot-eye family mismatch.

---

## 1. What exactly is the standard on paper?

### The three-tier figure law is actually a two-tier law

There is no generic anonymous foreground tier:

- **Named/seeded cast:** full family rig and canonical identity.
- **Crowd:** anonymous mass only, simplified face tier.
- **No third tier:** an individually counted, acting, or story-bearing person must be cast, or the beat must be restaged as mass action.

This is explicit in `visual-kit/style-bible.md:24-38` and `visual-kit/visual-grammar.md:173-206`. The latter also requires crowd to occupy a positive rear zone behind real geometry and says an anonymous person with an individual count, action, or face requirement is cast (`visual-grammar.md:183-198`).

### Full family rig

The locked family invariants are:

- near-circle head, only slightly taller than wide, never egg/oval;
- fixed eye style/size/position and facial map;
- no nose and no ears;
- exactly three fingers plus one thumb;
- even medium-thick warm brown-black `#241a12` outline;
- clean flat-cel rendering;
- same base head-to-body proportion.

Sources: `visual-kit/style-bible.md:24-30`, `:62-76`, `:103-129`.

### Crowd rig

The crowd tier changes **only the face**, not the proportion (`style-bible.md:93-101`):

- round heads;
- exactly 2–3 repeating flat head tones from the cast set, neither uniform cream nor a per-person invention;
- dot eyes;
- one consistent simple mouth: neutral, smile, or downturn;
- no nose, ears, or teeth;
- **exact same** squat head/body proportion as the base; not taller/lanky;
- four-digit hands where visible;
- scene-era dress, never exemplar dress by default;
- 2–3 repeating hair/headwear silhouettes;
- the rule applies to every figure; one individuated face is a rig fail.

Sources: `visual-kit/style-bible.md:78-101`, with the review checklist repeated at `:109-146`.

### Is it precise enough?

**Yes for categorical failures; no for reproducible geometry.** Nose/ear/teeth absence, dot eyes, one mouth family, digit count, tone-cardinality, silhouette-cardinality, and tier selection are concrete enough to fail a frame. “Round near-circle,” “medium-thick,” and “exact same proportion” lack numeric tolerances. The comparator is nevertheless unambiguous: the approved base, not another crowd exemplar.

The ambiguity has already produced two incompatible measurement methods. The accepted exemplar review compared the candidate against the old crowd exemplar using head width and leg span (`t18-verdicts-B.json:16`); the core law says crowd proportion is identical to the base (`style-bible.md:93-94`, `:127-130`). A suspect anchor was therefore allowed to certify its replacement.

## 2. Is the crowd exemplar itself on-rig?

### Identity/provenance first

There are two different files:

- video-local exemplar: `assets/library/crowd-exemplar.png`, 1200×896, SHA-256 `d0476658…ec01`, modern/1980s dress;
- channel fallback: `visual-kit/refs/base/crowd-exemplar.png`, 1200×896, SHA-256 `8453e25e…b299`, Victorian dress.

The manifest is stale: it calls the asset reused and points to the channel fallback (`assets/library/manifest.json:207-219`). Forge deliberately ignores that row for this special route and prefers the on-disk video-local file (`forge.py:2090-2100`). The frozen A/B requests pin the video-local SHA (`ab2-test-items.json:157-160`, `:199-202`, `:241-244`).

The video-local bytes inherit an all-pass record by digest from `_staging/crowd-exemplar-reroll-r3-candidate.png` (`visual-kit/_staging/review.json:686-703`; digest fallback in `forge.py:1738-1768`). That record does not prove the right comparator was used.

### Measurement against the actual base canonical

Approximate tight visual boxes:

| Figure | Full bbox | Head bbox | Head H/W | Full height / head height | Ruling |
|---|---:|---:|---:|---:|---|
| approved base | 225,143,637,1144 | 252,143,602,462 | 0.91 | **3.14** | reference |
| exemplar F1 | 39,247,234,770 | 44,248,223,456 | **1.16** | **2.51** | proportion fail; head borderline eggy |
| exemplar F2 | 271,239,483,771 | 272,239,482,458 | 1.04 | **2.43** | proportion fail |
| exemplar F3 | 503,238,716,771 | 505,238,712,458 | 1.06 | **2.42** | proportion fail |
| exemplar F4 | 725,238,937,771 | 726,238,935,457 | 1.05 | **2.43** | proportion fail |
| exemplar F5 | 961,248,1163,771 | 962,249,1162,455 | 1.03 | **2.54** | proportion fail |

The exemplar is therefore roughly **19–23% squatter** than the base in total head-height ratio. That is not a subtle tolerance dispute under “EXACT same” and “crowd differs only in the FACE.” It is a separate chibi body rig.

Visual sources: [video exemplar](../../assets/library/crowd-exemplar.png), [approved base](../../../../visual-kit/refs/base/base.png), [candidate grid](candidate_gridlines.png), [F1 head crop](cand_fig0_head_zoom.png).

### Per-axis ruling

| Axis | Ruling | Evidence |
|---|---|---|
| head roundness | 4 pass; F1 borderline/fail | F1 H/W ≈1.16; others 1.03–1.06 |
| eye style | pass **for crowd tier** | all five use plain dots; this deliberately differs from full cast eyes |
| nose/ears/teeth | pass | no unambiguous glyph on any face |
| proportion | **fail all five** | 2.42–2.54 vs base 3.14 |
| visible hands | pass at ordinary scale | simplified four-digit-family mitts; exact count is partly occluded |
| tone bound | pass | three tones, distributed 2-2-1 (`t18-verdicts-A.json:10-15`) |
| hair bound | pass | three silhouettes, distributed 2-2-1 (`t18-verdicts-A.json:12-13`) |
| outer outline | pass | warm-dark and consistent at figure scale |
| frame-wide line register | **fail F1 garment** | the left blazer carries a field of repeated lines much finer than the rig outline; the literal checklist says repeated thin stripes fail (`style-bible.md:118-122`). See [jacket crop](cand_fig0_jacket_zoom.png). The stored review called this construction detail a pass (`t18-verdicts-B.json:17`), contradicting the locked rule. |

**Exemplar conclusion:** the face simplification, tones, hair bounds, and outer contour are competent. The exemplar is still off-rig on the most visually consequential axis—body proportion—and contains one line-register defect. It is also an over-specified five-person lineup, so engines can treat its people as identities/costumes even though role prose says not to.

## 3. End-to-end pipeline trace — L169

### Authored input

L169 declares `figures.crowd: true` and places a subdued queue on the far side of benches (`shots.json:2275-2289`). This is a legitimate crowd-tier payload, unlike L87.

### Seed resolution and order

1. `cmd_batch` loads `shots.json`, the global suffix, and video-local vocabulary (`forge.py:2041-2050`).
2. The video-local exemplar wins over the channel fallback when the file exists (`forge.py:2090-2100`).
3. L169 is a fresh base in an established place, so L28 is the place seed.
4. For a non-delta scene, Forge orders figure/canonical assets first, then place, primitives, crowd, and tagged assets (`forge.py:2339-2345`). With no named cast, the slate is exactly:
   - first: L28, role `place`;
   - second: video-local crowd exemplar, role `crowd`.
5. The frozen record confirms both paths and hashes (`ab2-test-items.json:192-202`). There are two seeds, below `SEED_CAP = 4` (`forge.py:414`), so no seed is displaced.

### Provider-visible prompt

Forge reads the four descriptors directly from the style bible (`forge.py:315-324`). A crowd declaration forces §2d, and any figure signal forces §2c (`forge.py:211-226`, `:267-274`). Seed-role prose gives the exemplar proportion, face tier, and 2–3 head tones, but explicitly withholds clothing/period/setting (`forge.py:1450-1462`).

The actual provider order is:

`STYLE descriptor → CROWD-RIG → RIG-HOLD → seed-role prose → authored scene payload → global style suffix`

Sources: `forge.py:277-294`, `:382-394`, `:1498-1500`, `:1295-1305`. Image parts are sent in the final seed order before the text (`forge.py:1326-1330`).

### Where drift can enter

- **Bad strongest visual anchor:** the exemplar itself carries the wrong proportion and a lineup of distinct full outfits.
- **Attribute compartmentalization is prose-only:** the model sees all exemplar pixels; “take nothing of its dress” cannot physically mask costume pixels. L87 Pro copies the exemplar's brown striped blazer, tan-cardigan/blue-shirt woman, and grey-suit/red-tie man.
- **Payload comes after rig policy:** the last content-specific wording can win. L244's “chatting and cheerful” invites varied/open mouths; L87's counted separate actions invite individuated actors.
- **Global set constraints are hard for a single image call:** 2–3 tones and 2–3 hair silhouettes must be counted over many generated figures. Pro/Codex over-diversify L169 hair; Flash tends toward uniformity.
- **Latent, not active here:** over the four-seed cap, Forge drops the crowd exemplar first whenever a place seed exists (`forge.py:2358-2365`), and the law accepts the recorded omission (`forge.py:877-881`). A cast-free place plate often carries no crowd, so the stated rationale can be false.

## 4. What verification actually checks

### Authoring lint

Crowd lint checks only:

- `figures` object shape and boolean type;
- the abolished anonymous-foreground key;
- a narrow rear-zone phrase pattern;
- a narrow countable-anonymous noun pattern.

Sources: `lint_shots.py:1233-1271`, `:1281-1329`.

It does not inspect pixels and cannot check head shape, eyes, nose/ears/teeth, hands, proportions, tones, hair bounds, dress, or outlines. More importantly, `_ANON_INDIVIDUAL` includes `worker/person/manager/...` but not `figure/figures` (`lint_shots.py:1291-1295`). L87's exact “three overcoated figures” therefore evades the intended tier failure. A read-only run over the current file reports **zero HARD violations**.

Named cast has authoring checks with no crowd analogue: seated support/contact, two-cast plane/eye-line/relative-scale, interaction eligibility, delta entrance, and semantic-cast checks.

### Scene review board

The machine-emitted crowd question is only:

> “Crowd reads as background rig, not named cast.”

`build_review_artifact.py:206-213`, selected by one boolean at `:278-285`. Generic flat-cel and line-register rows also appear. There is no required row for:

- each figure's head shape;
- dot-eye style/position;
- no nose/ears/teeth;
- one consistent mouth;
- four-digit hands;
- base-matched proportion;
- head-tone count;
- hair/headwear count;
- era dress;
- every-figure coverage.

Named figure shots additionally receive canonical-vs-candidate comparison images; crowd scenes do not (`image-generation/SKILL.md:348-355`). This contradicts the doctrine's promise of a forced verdict on each §3 invariant for every figure (`SKILL.md:402-411`).

### Exemplar/asset review

Automatic asset classification asks STEP-1 named figures for `rig`, `expression-register`, and flat-cel. Every other asset—including `crowd-exemplar.png`—gets only flat-cel and line-register (`build_review_artifact.py:313-341`). The present exemplar happens to have a hand-expanded eleven-axis record, but that is not reproduced by the core skeleton.

The store gate checks only that a non-empty verdict dictionary exists, every supplied value is `pass`, and the digest matches (`forge.py:1797-1839`). It does not require the right invariant names for the asset class. `stamp_review.py` likewise accepts arbitrary verdict slugs (`stamp_review.py:216-249`).

### Stamp/render gate

This is the decisive escape. `stamp_review.py` defines only `fidelity/style/rig` aggregate axes and immediately accepts `worst == "clean"` (`stamp_review.py:96-138`). It never requires the board's applicable invariant rows.

The real L169 record contains only `id`, `worst: clean`, and a prose assertion that all axes passed (`assets/_review/merged.json:33-35`); the scene manifest is then `verified` (`assets/scenes/manifest.json:614-617`). L46 is also `verified` with a fallback crowd seed (`manifest.json:413-435`) despite visible crowd defects below. A checklist can be displayed to a reviewer and still have no effect on the gate.

### Cast checks present vs crowd checks absent

| Enforcement surface | Named cast | Crowd |
|---|---|---|
| authoring identity | backticked ID resolves to canonical | boolean declaration only |
| fresh seed | isolated STEP-1 figure card | full crowd drawn in scene call |
| canonical comparison strip | yes | no |
| support/contact | conditional forced row | absent |
| relative head scale | conditional forced row | absent |
| asset rig axes | rig + expression + flat-cel | generic non-figure axes only |
| scene anatomy | aggregate rig judgment | one coarse whole-crowd sentence |
| per-figure coverage required at stamp | no | no |

## 5. Defect table — all 15 Round-2 images

### Controls and shared design defect

| Figure/group | Scene and arms | Defect | Cause bucket | Evidence |
|---|---|---|---|---|
| none | L96 Pro/Flash/Codex | Correctly empty; no crowd or occluded figure. | pass/control | authored “entirely empty” at `shots.json:1283-1294` |
| none | L232 Pro/Flash/Codex | Correctly empty; the blazer is a prop, not a headless person. | pass/control | authored “entirely empty” at `shots.json:3160-3171` |
| every visible L87 person (6 Pro / 4 Flash / 6 Codex) | L87 all arms | Wrong **tier**: counted midground accountants perform separate actions and a second group holds another pose/attitude. The dot-eye crowd face is compliant but visibly wrong on readable story-bearing actors. | **(b)** + **(c)**; shared/ours | payload `shots.json:1164-1168`; positive rear-zone/tier law `visual-grammar.md:173-198` |
| all readable crowd faces | L87/L169/L244, all arms | Dot eyes differ from full family eyes. This is not provider drift or an exemplar failure; it is compliant with the written crowd tier. It becomes a visible defect only when composition makes crowd figures readable story actors. | no defect in a true rear crowd; **(b)** + **(c)** when used outside that tier | crowd face law `style-bible.md:31-38`, `:78-101` |

### Visible off figures/groups

| Figure/group | Scene → arm(s) | Defect type | Cause bucket(s) | Image evidence |
|---|---|---|---|---|
| three table workers | L87 → Pro | **Costume/identity bleed:** blazer/cardigan/suit trio rather than three collars-up overcoats; the trio closely reproduces exemplar F1/F2/F3 clothing, including striped brown blazer and red tie. | **(a)** seed over-specification + **(d)** Pro transfer + **(c)** | [image](ab-out/ab2-L87__pro.png), crop `[770,200,1315,595]` |
| entire four-person group | L87 → Flash | **Count/fidelity:** only two overcoated workers plus two watchers; the third accountant and larger watcher knot disappear. Core face rig is otherwise clean. | **(d)** + **(c)** | [image](ab-out/ab2-L87__flash.png), crop `[680,200,1260,550]` |
| six-person group | L87 → Codex | Best payload and core-rig compliance; no confident per-figure rig failure. It still inherits the shared wrong-tier problem. | shared **(b)** only | Codex image crop `[466,215,1600,712]` |
| entire queue | L169 → Pro | **Hair/headwear bound:** bald, side-part, afro, beanie, bun/bob/curly exceed three silhouettes. Core dot-eye/no-nose face passes. | **(d)** + **(c)** | [image](ab-out/ab2-L169__pro.png), crop `[0,320,885,722]` |
| entire queue | L169 → Flash | **Bounded-variety/costume pressure:** crowd is overwhelmingly one pale head tone and most bodies read as uniform grey workwear rather than winter coats. Core face and repeated hair are the cleanest arm. | **(d)** + **(c)** | [image](ab-out/ab2-L169__flash.png), crop `[790,328,1152,559]` |
| entire queue | L169 → Codex | **Hair/headwear bound:** side-parts, afro, multiple beanies, bob/long hair, swept hair exceed three silhouettes. | **(d)** + **(c)** | Codex image crop `[848,375,1672,751]` |
| prominent centre worker | L244 → Pro | **Proportion:** ≈2.4 head-heights, reproducing exemplar chibi body instead of 3.14-head base. | **(a)** + **(c)**; cross-arm class | [image](ab-out/ab2-L244__pro.png), crop `[710,342,834,610]` |
| prominent centre worker and laughing worker right of centre | L244 → Pro | **Mouth/teeth/individuation:** open laughing mouths mixed with simple closed smiles, contrary to one consistent simple mouth. | **(b)** “chatting and cheerful” pressure + **(d)** + **(c)** | same image; crops `[710,342,834,610]`, `[1090,340,1170,455]` |
| front-left, front-centre, paired middle, and every other fully visible full-body worker | L244 → Flash | **Proportion:** ≈2.2–2.6 head-heights; severe exemplar-like chibi body. Faces otherwise use clean dots/simple smiles. | **(a)** + **(c)**; cross-arm class | [image](ab-out/ab2-L244__flash.png), crops `[105,399,260,724]`, `[445,388,596,727]`, `[735,370,926,649]` |
| front-left and front-centre; same construction on readable rear workers | L244 → Codex | **Proportion:** ≈2.2–2.5 head-heights; same chibi body. Faces are the most internally consistent arm. | **(a)** + **(c)**; cross-arm class | Codex image crops `[465,382,680,824]`, `[790,390,994,835]` |

### Negative findings

- No unambiguous nose appears in the 15 frames.
- No high-confidence inner-ear glyph appears; ambiguous hair/cheek side lobes were not counted.
- No clear five-digit hand is visible; many hands are occluded or too small to count.
- No blocking outer-outline failure appears in the scenes. Codex is generally heavier; Pro/Flash finer.
- L169's core round-head/dot-eye/no-nose face is mostly compliant in all arms. Its failure is group-level bounded variety, not individual anatomy.

### Cross-arm cause reading

- **L244 chibi proportion in all three arms:** ours; direct exemplar/spec evidence.
- **L87 wrong-tier readable actors in all three arms:** ours; payload/authoring evidence.
- **L169 bounded-variety failure in every arm, but in opposite directions:** ours at the capability/enforcement level; the exact manifestation is engine-specific.
- **Pro-only costume bleed/open mouths, Flash-only under-count/homogenization, Codex-only excess hair:** engine-specific manifestations.

## Wave-1 verified crowd frames: what they prove

The intersection of crowd-declared shots and clean merged rulings yields L46 and L169. Only L46 retains full seed provenance in the manifest; L169's manifest row is minimal.

### L46

[Verified L46](../../assets/scenes/L46.png), crowd crop `[700,280,1376,640]`:

- near subgroup body ratios vary roughly 2.7–3.7 heads; the distant subgroup reaches about four;
- hair/headwear exceeds three silhouettes;
- multiple outfits and faces read as individuals rather than one bounded anonymous group.

Yet L46 is `verified`, with the old channel crowd exemplar explicitly recorded as its crowd seed (`assets/scenes/manifest.json:413-435`). This proves the gate did not enforce per-figure proportion or group bounds.

### L169

[Verified L169](../../assets/scenes/L169.png) is also stamped clean (`merged.json:33-35`, `manifest.json:614-617`). Its generation spec used the old channel fallback, not today's video-local exemplar (`g4-slice.spec.json:579-603`), and the verifier's entire rig ruling was one sentence about dots, mouth line, and no named costume (`g4-round2-verdicts-A.json:6`). It did not report a base-proportion measurement or tone/hair cardinality.

Therefore the verified history proves the enforcement gap; it does **not** prove the current exemplar was approved against the correct base.

## 6. Steelman, then break the design

### Steelman

The architecture is coherent in intent:

- a categorical two-tier law prevents unseeded foreground humans;
- a visual exemplar gives tiny anonymous faces a stronger anchor than prose alone;
- a per-video exemplar carries era, tones, and bounded hair variety;
- Forge derives the declaration, seed, role prose, prompt clauses, and digest gate rather than trusting operators;
- the two-seed Round-2 slates are simple and under cap;
- fresh-eyes review is supposed to turn stochastic output into a reliable pipeline.

That is a sound design if the anchor is canonical, the payload stays within the tier, and the review rows are actually required.

### Three most damaging holes, ranked

#### 1. Review is advisory UI, not an enforced contract — systemic

**Break:** a whole crowd gets one vague row, an exemplar gets generic non-figure rows, and `worst: clean` verifies without any applicable-invariant evidence.

**Concrete proof:** verified L46 visibly exceeds proportion/silhouette bounds; its manifest still says `verified`. L169's clean row contains no axes.

**Why this ranks first:** it lets every upstream defect—bad exemplar, bad payload, engine miss—ship. No prompt can substitute for a real gate.

#### 2. The anchor is measured against another anchor, not the family base — current shared defect

**Break:** all five video-exemplar figures are 2.42–2.54 head-heights against the base's 3.14, yet the approval measured candidate versus fallback. Both crowd anchors can drift together while appearing mutually consistent.

**Concrete proof:** L244 Pro, Flash, and Codex independently reproduce ≈2.2–2.6-head bodies.

**Why this ranks second:** the strongest common visual input tells every engine to draw a different body family. The prompt says “exact same,” but pixels dominate.

#### 3. Authoring can fight the tier clause, and the fighting payload comes later — recurring

**Break:** L87 declares crowd while specifying three separately acting accountants plus a second posed group. L244 asks figures to be “chatting,” encouraging varied/open mouths after the policy already asked for one consistent mouth. Lint misses L87 because `figure(s)` is absent from its countable-actor nouns.

**Concrete proof:** every L87 arm makes readable individual actors; Pro copies exemplar costumes, Flash drops actors, Codex is best but still uses the wrong face tier. Pro L244 opens mouths while other arms do not.

**Why this ranks third:** it reliably turns a background simplification into an uncanny foreground character system, then hands the contradiction to provider preference.

## Minimal fix-list (core changes only)

| Priority | Core change | Why this is minimal | Blast radius |
|---|---|---|---|
| P0 | **Re-mint both the video-local and standing crowd exemplars from the actual base canonical at the base's body ratio (~3.1 head-heights), with no sub-outline garment pattern.** Keep dot eyes, 3 tones, and 3 repeated hair silhouettes. Prefer a small rear-zone mass composition over five isolated “character card” lineups if probes show less identity/costume copying. | Fixes the strongest shared pixel cause rather than adding another prose prohibition. | All future crowd-bearing generations; existing approved scenes change only if regenerated. Both fallback and video-local hashes/reviews/manifests must refresh. |
| P0 | **Make crowd a first-class review class and make stamp enforce the emitted invariant set.** Exemplar axes: base-proportion, head, dot-face/no anatomy, hands, tone count, silhouette count, era dress, line register. Scene axes: the same per readable figure plus every-figure coverage and group bounds. Reject `worst: clean` without required rows. | Replaces the advisory checklist with the contract the doctrine already claims. | All future crowd scenes and exemplar reviews; old scenes need an explicit migration/grandfather decision before re-stamping, not silent acceptance. Named-cast behavior need not change. |
| P1 | **Fix tier authoring at the source.** Add `figure/figures` to the countable-anonymous guard; reject individual action/count under `figures.crowd`; restrict crowd expression prose to the closed neutral/smile/downturn vocabulary. Restage L87 as named group/cast or genuine rear mass. | Prevents contradictions before a paid call, using the existing tier law rather than a new downstream patch. | Crowd-authored shots. L87 will fail lint and require re-authoring; ordinary mass crowds remain unchanged. |
| P1 | **Move the crowd's hard anatomy/proportion clause after the authored payload, or validate an equivalent payload-last experiment before adopting it.** Keep seed-role truth before the payload and the style suffix at the tail. | Addresses the known payload-over-clause mechanism instead of accreting wording. | Every crowd prompt; requires a controlled A/B because ordering can affect composition. No seed routing change. |
| P2 | **Do not drop the crowd exemplar over cap unless the retained parent/place frame is itself verified crowd-bearing; otherwise hard-refuse the slate.** | Makes the current displacement rationale true. | Only over-cap mixed cast+crowd scenes; none of these 15 images. |
| P2 | **Regenerate the library manifest row from the actual routed file.** | Restores one provenance truth; does not change pixels. | Video-local manifest/reporting only. |

Do not “fix” this by adding more adjectives to each shot. The current prompt already contains the right categorical rules. The necessary changes are: correct the anchor, keep crowd out of foreground actor work, and make the existing invariants structurally required.

## Final verdict

**Primary cause: (a) exemplar defect + (c) enforcement gap, 0.94 confidence.** The current exemplar is a different 2.4–2.5-head body rig from the 3.14-head family base, and L244 reproduces it across all engines. The dot-eye mismatch is intentional doctrine rather than bucket (a), but payloads amplify it by rendering crowd figures too large. The gate would not reliably catch either problem.

**Secondary primary for L87: (b) payload/prompt defect, 0.93 confidence.** L87 authors individually counted/action-bearing midground people as crowd; lint misses its exact noun. L244's “chatting” wording is a weaker payload conflict, 0.75 confidence.

**Not primary: (d) engine-specific, 0.93 confidence.** Engine choice controls how the shared problem presents—costume copying, missing actors, open mouths, hair variety—not whether the shared crowd-rig weirdness exists.
