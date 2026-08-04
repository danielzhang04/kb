# Bricks-fresh rig/style/authoring audit — 2026-08-04

Scope: read-only inspection of `shots.json`, staged/canonical PNGs, forge slates and overlays, `tranche-a-genlog.md`, `vpw-log.md`, round-4/5 genlogs, the image-generation and VPW rules, and relevant git history. Daniel's nine observations are treated as confirmed failures; this report identifies their mechanisms. No generation, source edit, registration, promotion, or commit was performed.

Cost basis used below: a 1K STEP-1 call is **$0.039** and a 2K scene call is **$0.134**, as recorded throughout `round2-genlog-*.md`, `round4-genlog-{R,S,T,U}.md`, and `round5-genlog-{V,W,X}.md`.

## Bottom line

There is no single “deep chains cause drift” explanation. Scene chaining is an amplifier: L66's bad scale is preserved through L67/L68, L74's eye shape is carried into L75, and L100's wrong cast is carried into L101. But the defects originate in roots, STEP-1 remints, and authoring too: L66, L89, L93, and L100 are all scene roots. Smooth rendering also appears at every depth.

The cross-cutting mechanisms are:

1. `shots.json` and `style-bible.md` positively request “gentle soft cel shading,” while forge appends “NO gradients; NO gloss”; the assembled style instruction contradicts itself.
2. Character-seeded roots still receive smooth, shaded STEP-1 images, so removing a dedicated image style anchor did not make those requests text-only in practice.
3. VPW authored actions without physical support/contact, identity without visible place ownership, and named cast that changes the meaning of generic narration.
4. Forge treats an on-disk staged STEP-1 as reusable even when its recorded review missed a canonical face invariant.
5. The final 3-axis review did not execute its own forced-per-invariant procedure and overruled genlog style warnings with broad PASS sentences.

## A. Seed provenance for every defect scene

Classification: **canonical** means an approved `visual-kit/refs/**` figure/primitive; **staged remint** means a generated per-video `visual-kit/_staging/fig-*`; **parent scene** means a generated scene is used as the continuity/place input. Crowd exemplar is canonical but pins only the anonymous crowd tier.

| Scene | Exact provider seed files | Provenance and consequence | Evidence record |
|---|---|---|---|
| L66 (`L66-b5W-retry.png`) | `visual-kit/_staging/fig-qt-wiles--point-at-thing--expr-smug.png`; `visual-kit/_staging/fig-brick-foreman--expr-worried.png`; `visual-kit/refs/base/crowd-exemplar.png` | Two staged STEP-1 remints + canonical crowd; **no direct character canonical and no parent scene**. Root composition. Retry changed only the chart wording, so it preserved the bad scale topology. | `scratchpad/lane-W-L66-b5-retry.json`; `round5-genlog-W.md` |
| L67 (`L67-b5W.png`) | same two staged STEP-1 files; `visual-kit/_staging/L66-b5W-retry.png`; `visual-kit/refs/base/crowd-exemplar.png` | Staged remints + **parent L66** + canonical crowd. The prompt says “same locked framing,” so L66's scale error is an explicit hold. | `scratchpad/lane-W-L67-b5-generated.json`; `round5-genlog-W.md` |
| L68 (`L68-b5W.png`) | `visual-kit/_staging/fig-qt-wiles--action-armscrossed--expr-smug.png`; `visual-kit/_staging/fig-brick-foreman--sit--expr-worried.png`; `visual-kit/_staging/L67-b5W.png`; `visual-kit/refs/base/crowd-exemplar.png` | New staged STEP-1 pair + **parent L67** + canonical crowd. The parent preserves the established scale; the prompt further says Wiles is “the dominant vertical.” | `scratchpad/lane-W-L68-b5-generated.json`; `round5-genlog-W.md` |
| L75 (`L75-b5X.png`) | `visual-kit/_staging/L74-b4T.png`; `visual-kit/refs/brick-foreman/brick-foreman.png`; `visual-kit/refs/base/sign-with-pen.png` | **Parent L74** + canonical foreman + canonical pose. Crucially, there is **no `refs/base/expr-deadpan.png` seed** in B5X. Deadpan is requested only in prose while the strongest image input is the worried parent with fully open/circular eyes. | `scratchpad/round5-X-L75.generated.json`; `round5-genlog-X.md` |
| L89 (`L89-b4T.png`) | `visual-kit/_staging/fig-brick-foreman--sit--expr-deadpan.png` | One staged STEP-1 remint; **root, no parent and no direct canonical**. The remint supplies a seated body, while the prompt supplies no chair/stool/bench. | `scratchpad/round4-T.builder.json`; `round4-genlog-T.md` |
| L90 (`L90-b4T.png`) | `visual-kit/_staging/fig-brick-foreman--sit--expr-deadpan.png` | Same staged remint; **independent root**, despite prose saying “same open box.” The model independently invented a wooden bench, proving there is no held set. | same records |
| L91 (`L91-b4T.png`) | `visual-kit/_staging/fig-brick-foreman--action-shrug--expr-smug.png` | One staged STEP-1 remint; **independent root**. No listener, page, or prior scene is seeded. | same records |
| L93 (`L93-b4U-retry.png`) | `visual-kit/_staging/fig-brick-foreman--expr-deadpan-r3Q.png`; `visual-kit/refs/base/crowd-exemplar.png` | Staged STEP-1 remint + canonical crowd; **root, no direct foreman canonical and no parent**. The isolated STEP-1 is materially closer to the rig than the scene, so the off-rig face is introduced during scene recomposition. | `scratchpad/round4-U-L93-retry.json`; `round4-genlog-U.md`; `round3-genlog-Q.md` |
| L100 (`L100-b4R.png`) | `visual-kit/_staging/fig-brick-foreman--expr-worried.png`; `visual-kit/_staging/fig-qt-wiles--action-armscrossed--expr-smug.png`; `visual-kit/refs/base/crowd-exemplar.png` | Two staged STEP-1 remints + canonical crowd; **root**. Qt Wiles is not a seed leak: he is deliberately seeded because `shots.json` names him. | `scratchpad/round4-R-roots.slate.json`; `round4-genlog-R.md` |
| L101 (`L101-b4R.png`) | `visual-kit/_staging/L100-b4R.png`; `visual-kit/refs/brick-foreman/brick-foreman.png`; `visual-kit/refs/qt-wiles/qt-wiles.png`; `visual-kit/refs/base/crowd-exemplar.png` | **Parent L100** + both direct character canonicals + canonical crowd. The wrong cast is strongly locked four ways: the parent, two canonicals, and explicit prose. | `scratchpad/round4-R-L101.slate.json`; `round4-genlog-R.md` |

### Canonical versus derivative summary

- **Direct canonical figure refs in the final scene call:** L75 (foreman), L101 (foreman + Wiles). L75 also uses a canonical pose.
- **Staged figure remints:** L66, L67, L68, L89, L90, L91, L93, L100.
- **Parent scenes:** L67←L66, L68←L67, L75←L74, L101←L100.
- **No scene parent:** L66, L89, L90, L91, L93, L100. These root failures disprove a chain-depth-only cause.

## B. Drift versus chain depth

Two depths matter and should not be conflated:

- **Scene-parent depth:** number of scene-on-scene transforms, with a root at 0.
- **Longest generative lineage:** maximum image-generation hops from an approved canonical/primitive through STEP-1 and scene parents to the final scene. A staged STEP-1 is one hop; a root scene made from it is two.

| Rank | Staged scenes | Scene-parent depth | Longest lineage | Observed defect behavior |
|---|---|---:|---:|---|
| Root | L66, L89, L90, L91, L93, L100 | 0 | 2 | L66 already has miniaturized foreman; L89 already floats; L93 already has the off-rig face; L100 already has wrong cast. All are smoothly shaded. |
| One-deep | L67, L75, L101 | 1 | 3 | L67 propagates L66 scale; L75 propagates L74 eye geometry while prose-only deadpan loses; L101 propagates L100 cast. Smoothness persists. |
| Two-deep | L68 | 2 | 4 | Bad scale and smooth finish persist from L66→L67; “dominant vertical” reinforces Wiles. |

### Correlation verdict

**Smooth-shading drift does not correlate monotonically with chain depth.** It is visible in root L66 (hair/faces/table/glass), root L89 (face, shirt, floor), root L93 (face/corridor highlights), and root L100 (faces, wood, glass, lamps). It remains visible in L67/L68/L75/L101, but did not begin there. The round-4/5 genlogs independently say “smooth,” “softly blurred,” “polished,” “luminous,” “reflections,” or “gradients” for these frames.

**Rig/semantic drift also does not correlate monotonically with depth.** L93 is a root rig failure and L66 is a root scale failure. L75 is one-deep, but its mechanism is specifically a missing expression seed opposed by a worried parent. L100 is a root semantic-cast failure.

**Depth does correlate with propagation.** Three controlled pairs show that clearly:

1. `L66-b5W-retry.png` → `L67-b5W.png` → `L68-b5W.png`: scale is wrong at depth 0 and retained at depths 1–2 by the place parent and “same locked framing.”
2. `L74-b4T.png` → `L75-b5X.png`: the parent carries full open/circular eye geometry; B5X supplies no deadpan expression image, and L75 lands full eye circles.
3. `L100-b4R.png` → `L101-b4R.png`: Qt Wiles is authored and seeded in the root, then locked by the parent and his canonical.

Controls refute depth as the originating variable:

- `L60-b5V.png` (root) and `L63-b5V.png`/`L64-b5V.png` (one scene parent from L60) keep Wiles and the seated foreman at a believable shared human scale, although all remain smoothly shaded.
- L89 and L90 are both roots with the same seated STEP-1. L89 leaves the foreman visibly unsupported; L90 invents a bench. The variable is missing support authoring, not depth.
- The older `assets/scenes/L100.png` is a tranche-A root seeded only by the crowd exemplar and already has soft ceiling falloff, gradient heads, and cup shine. B4 L100 is more detailed, but the “detailed middle” was not absent from the earlier root era.

## C. How style and rig were anchored before

### Git-history finding

The proposed history is **partly true but materially overstated**.

What is true:

- In the `efe82d2` tranche-A era, recurring figures were minted as per-video STEP-1 frames from character canonicals + pose/expression primitives.
- The then-current image-generation rule said STEP 2 seeded `[step-1 figure(s)] > [the video's plate]`.
- At `efe82d2^`, every non-first environment/composed scene required an image style/place anchor, preferring the target plate or prior in-chain frame over a STEP-1 fallback.
- This gave each scene a video-local rendered input in addition to prose, which can explain better continuity/rig in some accepted frames.

What is false:

- Tranche A did **not** assemble every scene fresh from only rig-derived assets and plates.
- Scene-on-scene chains existed in the tranche-A specification itself: L50←L49, L61←L60, L101←L100, L108←L107, L109←L108, L161←L160, and L162←L161.
- `tranche-a-genlog.md` records final composites such as L67 seeded by the picked L66 place, L68 by L67, L101 by L100, L109 by L108, and L162 by L161.
- Therefore B4/B5 did not introduce scene chaining; they reused an existing legal technique.

The real August 4 change is commit `f4ca9b5`: it removed image seeds used only for style, allowed seedless roots, and appended `HARDENED_SCENE_STYLE` text to every scene. That block says “NO gloss; NO specular highlights; NO gradients,” but it is concatenated after the STYLE-ONLY descriptor, which says “simple flat colours with gentle soft cel shading.” `shots.json.global_prompt_suffix` repeats the same “gentle soft cel shading.” The system now sends both the permissive positive style and its negation.

Moreover, character scenes are not visually unanchored: their staged STEP-1 seeds already contain soft face gradients, hair/fabric highlights, and ground shadows. Provider behavior follows those pixels strongly. Thus the current failure is best described as **contradictory text + already-drifted figure inputs + review acceptance**, with chain depth acting only as a persistence multiplier.

Historical image comparison also prevents romanticizing tranche A: accepted `assets/scenes/L66.png` and `assets/scenes/L100.png` already contain smooth falloff/gradients. The earlier era can be called stronger at some rig and composition holds, not a uniformly hardened flat-cel era.

## D. L66–L68 size mechanism

The two L66 STEP-1 seeds do **not** have meaningfully different framing. Both are 2:3 full-body reference-sheet figures occupying nearly the same vertical proportion; Wiles is wider only because his pointing arm extends horizontally. The seed pair alone does not explain a much smaller foreman.

The scale failure is introduced by spatial/semantic authoring in the L66 root:

- exact clause: **“`qt-wiles` ... points across a long MiniScribe meeting table toward `brick-foreman` ... at the near end”**;
- exact crowd clause: **“the office-worker crowd occupies the rear zone beyond the table's far side ...; the management section rises together from its rear chairs under Wiles's accusation”**;
- exact framing clause: **“keeps Wiles, the foreman and the separated mass action together.”**

These clauses establish a long perspective axis and three separated groups but never state that the two named men share one primary table-side plane, equal head size, or aligned eye line. Wiles is the first subject, the only active pointing agent, and the owner of the accusation. “Management section” is also ambiguous after naming the foreman and lets the model visually group him toward the rear action. The rear-zone clause is formally about the crowd, not the foreman, but the combined long-table topology makes depth the easiest way to separate all parties.

L66's retry replaced only the chart clause and therefore could not repair scale. L67 then orders “same locked framing.” L68 seeds L67 and adds the exact clause **“makes Wiles the dominant vertical,”** so the inherited disparity is preserved/reinforced even though its new foreman STEP-1 is seated.

**Shot fix:** re-author L66 as a side-on two-shot with Wiles and the standing foreman on the same near table-side ground plane, aligned head size/eye line and neither at background scale; put the crowd alone beyond the glass. L67 may then hold that approved base. L68 must author the chair, same near plane, and same head scale while letting Wiles dominate by posture, not by body scale.

**Doctrine fix:** for two named co-stars separated by furniture, VPW must state shared/different plane, eye line, and intended relative head scale; “dominant” must name posture/composition rather than imply anatomical scale.

## E. Daniel's nine confirmed failures — mechanism and fix

### 1. L66–L68 foreman miniaturization

**Mechanism:** L66's root combines a long perspective table, first-subject/active-agent dominance for Wiles, an ambiguous management mass, and no same-plane/equal-head-scale constraint; L67/L68 then lock the defective parent, and L68 adds “dominant vertical.”

**Fix:** VPW spatial authoring + lint for co-star plane/relative scale; regenerate L66 fresh from approved STEP-1s, then L67/L68 from the corrected parent. Do not seed any of the defective L66–L68 scenes.

### 2. Seated figures with no authored/visible support

The selected staged images were inspected, not inferred only from prose.

| Scene | What is authored | What is visible | Verdict |
|---|---|---|---|
| L69 (`L69-b4S.png`) | “sits alone at the boardroom table”; no chair/stool/bench/seat contact | waist-cropped behind table; no chair or seat is established | FAIL — support omitted/cropped away |
| L74 (`L74-b4T.png`) | “sits alone at ... grey desks”; no chair | close crop behind desk; no seat is visible | FAIL — support omitted/cropped away |
| L75 (`L75-b5X.png`) | inherits “same fluorescent desk”; no support is added | same close crop; no seat is visible | FAIL — inherited support omission |
| L89 (`L89-b4T.png`) | “sits beside ... box”; no support | full bent-leg seated body visibly suspended with nothing under it | FAIL — unambiguous floating sit |

L68 has a visible chair; L60/L61/L63/L64 have boardroom chairs; L87/L88 have a timber stool; L90 invents a wooden bench. Those are not included as unsupported outputs, although L90 remains an authoring failure because its root prompt never declared the bench.

**Mechanism:** Round-2 VPW mechanically replaced forbidden kneeling/crouching prose at L89–L90 with registry-valid `sit` (`vpw-log.md`) without adding a support object/contact topology. The same omission exists at L69 and L74/L75. Forge validates seed recipes, not whether a seated pose has a physical seat.

**Fix:** VPW hard rule: every seated named figure must name the support and contact (“hips on timber stool,” “back against chair,” etc.); framing must show enough of it to establish support. Add a review-gate `support/contact` verdict. Restage/regenerate L69, L74–L75, and L89; make L90's bench authored if it remains.

### 3. L75 full eye circles

**Mechanism:** B5X seeds the worried L74 parent + foreman canonical + `sign-with-pen`; it omits `expr-deadpan.png`. The parent is the strongest composition/face input, while prose-only deadpan is the softest instruction. The output retains an enclosing circular/open-eye construction instead of the base deadpan's straight upper lid + lower U.

**Fix:** remint one clean combined foreman `sign-with-pen` + `expr-deadpan` STEP-1 from canonical/pose/expression, verify it beside canonical/base, then regenerate L74–L75 as a corrected support-bearing stage. Forge should fail a delta that authors a changed expression but supplies neither a verified combined STEP-1 nor the declared expression primitive.

### 4. L89–L91 narrative nonsense

**What the three shots actually declare:** L89 shows the foreman merely sitting beside a box that is already cracked, with tools laid down; L90 independently shows him sitting beside an open box after the sheet swap; L91 independently shows him shrugging beside a closed cabinet toward an unseen listener. None has `stage`/`stage_role`; all are root generations. “Same” in L89/L90 is prose without a continuity seed.

**Coherence verdict:** no. The actions “popped open,” “took out/put in,” and “blamed on a typo” have been reduced to three disconnected aftermath portraits. L91 contains neither the alleged typo nor a visible recipient, so the causal punchline is absent.

**Mechanism:** pose-inventory repair overrode narrative action; `sit` made the figure legal but passive. Missing stage metadata then prevented set/prop continuity, and review judged payload nouns rather than cause-effect readability.

**Fix:** author one lockbox stage: L89 standing/working at an explicit bench with the cracked box and tools; L90 a true delta on the same box/bench swapping the two sheets; L91 a held-set reaction with the red-marked sheet visibly presented to a visible auditor/manager or a concise supplied typo cue. Regenerate all three from the corrected base/deltas.

### 5. L93 foreman face off rig

**Mechanism:** the final scene is recomposed from the staged deadpan STEP-1 + crowd exemplar without a direct foreman canonical. The STEP-1 itself is substantially closer to the canonical; B4 scene recomposition changes face geometry/head read and adds smooth facial modeling. The retry addressed only crowd scale/hair, so the face was never the retry authority.

**Fix:** fresh scene from a newly verified flat-cel deadpan STEP-1 (or the existing STEP-1 only if it passes a new canonical crop gate), with the foreman canonical retained within the seed cap. Do not use L93-b4U as a repair seed. Review the face crop invariant-by-invariant.

### 6. Office ownership is invisible

**Mechanism:** `shots.json` repeatedly says “MiniScribe office/boardroom” in semantic prose but never authors a quoted `'MINISCRIBE'` sign, plaque, nameplate, or other visible ownership mark in the office sequences. Many prompts instead declare surfaces/glyph fields blank. A model cannot turn an organization name used as scene context into reliable diegetic ownership lettering unless that literal is supplied.

**Lettering-law verdict:** `'MINISCRIBE'` is allowed. It is one word (under the 4-word hard cap), 10 characters (under the 25-character hard cap), and the ≥9-character warning explicitly exempts script vocabulary; `lint_shots.py` names `MINISCRIBE` as the bricks example. L-1 requires it to be repeated character-for-character in every regenerated delta that redraws it.

**Fix:** author one stable ownership device per MiniScribe place base—e.g. a wall plaque or door glass lettered `'MINISCRIBE'`—and carry the exact literal through every delta. Add a VPW place-identity check: company-owned interiors must have a visible owner cue unless the VO intentionally withholds it.

### 7. L100–L101 show Qt Wiles instead of generic managers

**Mechanism:** this is authoring, not provider substitution. `shots.json` explicitly names both `brick-foreman` and `qt-wiles` in L100/L101 and lists both character assets. B4 L100 seeds both staged STEP-1s; L101 seeds the L100 parent and both canonicals. `vpw-log.md` shows the regression: Round 3 made the planning beat figure-free/crowd-based; B3 “restored full representative scenes” and the current file converted generic managers into the two named conspirators.

**Fix:** remove both named-proxy declarations unless the script establishes them as those managers. Author the manager crowd itself putting heads together at crowd scale, then make L101 a brick-only delta. Reuse the crowd exemplar; no Wiles/foreman seed belongs in either slate.

### 8. Auditor STEP-1 figures versus canonical

Canonical comparator: `visual-kit/refs/auditor-rep/auditor-rep.png` plus `visual-kit/refs/base/expr-deadpan.png` for expression geometry.

| Staged asset | Audit verdict | Mechanism / visible mismatch |
|---|---|---|
| `fig-auditor-rep--expr-skeptical.png` | **PASS / keep** | Identity, forehead spectacles, ledger case, round head, and skeptical asymmetry hold. |
| `fig-auditor-rep--sign-with-pen--expr-deadpan.png` | **FAIL / retire** | Loses both spectacles and ledger case; the original genlog already recorded this. |
| `fig-auditor-rep--sign-with-pen--expr-deadpan-r2M.png` | **FAIL / remint** | Spectacles/case return, but deadpan eyes are enclosing circular bowls with skin-filled upper arcs, not the base deadpan lid geometry. The prior PASS checked identity props but missed expression rig. |
| `fig-auditor-rep--action-powerstance--expr-deadpan.png` | **FAIL / retire** | Ear/hairline defect was already logged; also shows the off-register deadpan eye construction. |
| `fig-auditor-rep--action-powerstance--expr-deadpan-r2i.png` | **FAIL / retire** | Spectacles absent; prior genlog already failed it. |
| `fig-auditor-rep--action-powerstance--expr-deadpan-round3-P.png` | **FAIL / remint** | Props/identity are present, but both eyes use the same full enclosing circles/skin-filled upper halves; prior review falsely passed “restrained deadpan.” |

**Mechanism:** retries optimized the defect named by the previous review (ear, then missing props) without re-running every canonical/expression invariant. The final review's aggregate “rig holds” sentence did not expose that eye geometry was never separately ruled.

**Fix:** retain skeptical; remint one signing-deadpan and one powerstance-deadpan from canonical + exact primitive + `expr-deadpan`, then run a forced eye/brow/mouth/props/head/hair/hands matrix beside the canonical and expression base. Quarantine every failed variant so existence cannot imply reuse eligibility.

### 9. Global smooth/glossy style drift

**Mechanism:** four layers agree badly:

1. `style-bible.md` §2b positively requests “gentle soft cel shading.”
2. `shots.json.global_prompt_suffix` repeats it.
3. Forge then appends `HARDENED_SCENE_STYLE` saying no gloss/specular/gradients.
4. Staged STEP-1 seeds visibly contain gradients, soft highlights, and shaded ground planes.

The provider resolves the conflict toward a polished detailed-middle look. Genlogs repeatedly noticed the result, but `review-3axis-2026-08-04.md` marked the same frames Style PASS. This is a review-gate failure, not an unobserved stochastic surprise.

**Fix:** make §2b/global suffix/forge one non-contradictory positive recipe (“one flat base fill plus at most one hard-edged shadow shape; uniform highlight-free surfaces; no feathered transitions”), remint only the STEP-1s needed for blocked scenes, and add a style gate that explicitly rules face gradients, hair/furniture specular bands, glass/wood gloss, and soft atmospheric blur. A simple edge/gradient measurement can be a heads-up, but the final gate remains visual.

## Review-gate defect demonstrated

`review-3axis-2026-08-04.md` called L66–L68, L75, L93, and L100–L101 clean, despite Daniel's confirmed failures and the genlogs' own style warnings. It also used one aggregate identity sentence per shot, while the image-generation procedure requires a forced PASS/FAIL on **each** §3 invariant. The procedural law was sound; the delivered artifact did not operationalize it.

This explains why the same eye-construction mistake passed more than once: no structured row forced “eye outline/upper lid geometry” to receive an individual verdict, and no support/contact or visible-office-owner field existed at all.

## Numbered fix list

Costs are prospective estimates only. Overlapping scene fixes should be bundled; totals below avoid double-counting by separating remints from unique scene calls.

### (1) Doctrine / mechanism changes — 9 items, $0 generation

1. **Unify the style source.** Remove “gentle soft cel shading” from §2b and `global_prompt_suffix`, or remove the appended negation; ship one positive flat-cel descriptor from one source of truth. **Cost:** $0 gen.
2. **Seat/support feasibility lint.** Any named `sit`/“seated” figure must name a chair/stool/bench/surface plus contact, and framing must establish it. **Cost:** $0 gen.
3. **Two-cast spatial lint.** Across furniture/depth, require each named figure's plane, eye line, and relative head scale; “dominant” must resolve to pose/framing, not anatomical size. **Cost:** $0 gen.
4. **Narrative action-chain gate.** Consecutive VO actions using “same” props must have a `stage` base/delta plan or explicitly hard-cut; the critic must judge cause→effect, not only noun presence. **Cost:** $0 gen.
5. **Place-owner identity gate.** An institution-owned interior must author a visible owner cue or record intentional ambiguity; lettering must be literal and carried under L-1. **Cost:** $0 gen.
6. **Semantic cast gate.** A named character cannot stand in for a generic narrated group unless the script/research establishes that identity; compare `vo_text` role nouns with cast declarations. **Cost:** $0 gen.
7. **Verified-asset reuse gate in forge.** A staged STEP-1 is reusable only with a review record pinned to its canonical/expression SHA and per-invariant verdicts; file existence/genlog PASS is insufficient. **Cost:** $0 gen.
8. **Parent provenance/depth gate.** Record scene-parent depth and longest canonical lineage; prohibit a child from using a parent with any parked rig/style/topology defect, and force a re-base after a propagated failure. **Cost:** $0 gen.
9. **Operationalize review.** Structured forced verdicts for face subfeatures, relative scale, support/contact, semantic cast, place ownership, and flat-cel hazards; canonical side-by-side crops for every named figure; no aggregate “rig holds” shortcut. **Cost:** $0 gen.

### (2) Asset remints needed — 5 items, estimated $0.234

1. **Auditor signing + deadpan STEP-1:** replace both signing variants with one canonical-verified remint; retire originals. **1 × 1K = $0.039.**
2. **Auditor powerstance + deadpan STEP-1:** replace all three powerstance variants with one canonical-verified remint; retain none of the failed files as seeds. **1 × 1K = $0.039.**
3. **Foreman sign-with-pen + deadpan STEP-1 for L75:** include exact pose and expression in the isolated mint. **1 × 1K = $0.039.**
4. **Foreman flat-cel deadpan STEP-1 for L93:** remint under the unified descriptor and verify against canonical/base expression. **1 × 1K = $0.039.**
5. **L66 co-star STEP-1 pair:** remint/replace the Wiles point-smug and foreman worried figures only after the style descriptor is unified, so the repaired root is not re-seeded with polished gradients. **2 × 1K = $0.078.**

The skeptical auditor STEP-1 needs **no remint**. A broader style audit may quarantine additional STEP-1s, but its cost cannot be honestly estimated until the unified descriptor passes a small, human-reviewed probe; it is not included here.

### (3) Per-shot authoring corrections — 7 items, estimated $3.886 in unique 2K scene calls

1. **L66–L68 scale/topology:** re-author same-plane co-stars in L66, then rebuild L67/L68 from the corrected base. **3 × 2K = $0.402.**
2. **L69 support:** author/show the boardroom chair or restage as standing behind the table. **1 × 2K = $0.134.**
3. **L74–L75 support + L75 deadpan:** author/show the desk chair, rebuild the base and the pen-contact delta using the new combined STEP-1. **2 × 2K = $0.268.**
4. **L89–L91 causal sequence:** one explicit lockbox workbench stage, real swap delta, visible typo-blame recipient/evidence. **3 × 2K = $0.402.**
5. **L93 rig:** fresh scene from verified inputs; crowd remains background and cannot redraw the lead. **1 × 2K = $0.134.**
6. **L100–L101 cast:** manager crowd root + brick-only delta; remove Wiles/foreman seeds. **2 × 2K = $0.268.**
7. **Remaining MiniScribe office ownership pass:** after bundling the overlapping fixes above, 17 additional affected office stills remain in L60–L65, L70–L73, L86–L88/L92, and L94–L96. Add/carry one `'MINISCRIBE'` owner mark per place chain. **17 × 2K = $2.278.** Gross office-only scope is 28 stills/$3.752; the $2.278 figure excludes the 11 office stills already counted in items 1–4 and 6.

**Estimated paid total for the enumerated repair scope:** **$4.120** = $0.234 asset remints + $3.886 unique scene calls. This excludes any whole-video style rerender, which should not be authorized until the doctrine fix and a small human-reviewed probe prove the new descriptor.

## Evidence index

- Authoring: `videos/2026-07-28-bricks-fresh/shots.json`; `scratchpad/vpw-log.md`.
- Exact B4/B5 slates: `scratchpad/lane-W-L66-b5-retry.json`, `lane-W-L67-b5-generated.json`, `lane-W-L68-b5-generated.json`, `round5-X-L75.generated.json`, `round4-T.builder.json`, `round4-U-L93-retry.json`, `round4-R-roots.slate.json`, `round4-R-L101.slate.json`.
- Spend/verdict logs: `round4-genlog-{R,S,T,U}.md`, `round5-genlog-{V,W,X}.md`, `round2-genlog-{I,J,K,M}.md`, `round3-genlog-{P,Q}.md`, and `tranche-a-genlog.md`.
- False-negative gate: `scratchpad/review-3axis-2026-08-04.md`.
- Rig/style law: `visual-kit/refs/base/base.png`, `visual-kit/refs/brick-foreman/brick-foreman.png`, `visual-kit/refs/auditor-rep/auditor-rep.png`, `visual-kit/style-bible.md` §§2b–3, `.claude/skills/image-generation/SKILL.md`, and `.claude/skills/image-generation/scripts/forge.py`.
- Lettering law: `.claude/skills/visual-prompt-writer/references/shots-schema.md` §4 and `.claude/skills/visual-prompt-writer/scripts/lint_shots.py` (`LETTERING_CHAR_CAP`, `LONG_LITERAL_WORD`, and the script-vocabulary exemption naming `MINISCRIBE`).
- History: commits `efe82d2`, `d6d07bb`, and `f4ca9b5` via `git show`/`git log --follow` on image-generation `SKILL.md`, `forge.py`, and `tranche-a-spec.json`.
