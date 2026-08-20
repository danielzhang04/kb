# Doctrine era map — governing stack × era

Scope: 14 doctrine-bearing text/code files named in the commission.  Image-generation “related” means the three review/generation helpers that enforce doctrine (`build_review_artifact.py`, `crop_battery.py`, `finalize_thumbnail.py`), not tests, fixtures, media, or unrelated audio/motion files.  The only production channel with a `visual-kit/` is `channels/the-second-take/`; `_TEMPLATE` and test channels have none.  Thus the layer findings below are architectural findings, not a claim of demonstrated cross-channel breakage.

Era anchors: E1 is the poyais-final working state at `fa104c60` (2026-07-20); E2 is the requested liked-bricks anchor `30d2b7e8` (2026-08-04); E3 is doctrine-reset completion `52b17ab2` (2026-08-06); E4 ends at `f8aa5e52` (2026-08-19); E5 is current `f1c3b1aa` (2026-08-19).  A snapshot identifier below is the last commit touching that *file* reachable from that era anchor, not a claim that all files changed at the era commit.

Evidence labels are deliberately non-exclusive: **+past** means a past-era mechanism has direct positive evidence; **+present** means a present mechanism has direct successful verification/critic evidence; **−present** means current/fresh output or a current-plan critic directly records the failure; **none** means no evidence tied to this section.  “Verified” alone is not taste evidence.  Citations are local repository paths and headings/lines are given where useful.

Layer flags: **O→C** = channel taste hard-coded in an org skill; **C→O** = reusable process/enforcement only in the Second Take kit; **—** = no wrong-layer passage found.  These are inventory flags, not proposed moves.

## 1. `.claude/skills/visual-prompt-writer/SKILL.md`

Snapshots: E1 `57010f68`; E2 `30d2b7e8`; E3 `52b17ab2`; E4 `f8aa5e52`; E5 `f1c3b1aa`.

| Functional section | E1 → E2 → E3 → E4 → E5 (load-bearing text) | Change / stated reason | Evidence | Layer flag |
|---|---|---|---|---|
| Procedure and source hierarchy | E1 complete plan, “**script.md is pure prose**”; E2 adds schema/lint closure; E3 adds cast/plate planning; E4 act partitions and “**parallel-by-default**”; E5 still reads grammar/examples/registry before authoring. | `33676421`: approved parallel authoring; E5 retained. | none on procedure throughput or quality apart from VPW3’s plan-level critique. | — |
| Depiction-class choice | E1 “**Depiction is a DECISION, not a transcription**”; E2 preserves literal-check; E3 figures/plates dominate; E4 restores class spread; E5 says “**Reach first for… symbolic stand-in… empty-world/aftermath**.” | `f1c3b1aa`: poyais revert: non-literal first-class. | **+past, −present:** `poyais-register-audit.md` §2: 28 symbolic and 48 cast-free Poyais beats vs fresh 4 and 55; `taste-ground-truth.md` says current v2 still misses the mark. | — |
| Figure law / story bearer | E1 three sizes incl. unseeded foreground; E2 two-tier figure declarations; E3 three-tier then one seeded performer cap; E4 merges subject rule; E5 “**one seeded figure is the default… Crowd is the exception**.” | `f1c3b1aa` R2′ removed anonymous everyman and made single-figure default. | **+past, −present:** `poyais-visual-audit.md` synthesis: poyais has six true single-character beats; fresh human frames default to crowds and individuate them. No post-E5 render establishes this new sentence’s result. | — |
| Closed-world poses / interaction | E1 prose action allowed; E2 named figures + staged authoring; E3 primitives/cards; E4 interaction and seed-cap rules; E5 “**pose, expression, interaction… are CLOSED-WORLD**.” | `f1c3b1aa` R5; stated aim is no invented pose/prose collision. | **+present:** `6c2-genlog.md` Stage 3 reports 8/8 surgical content retries passed; also records the former expression-authority defect. No taste proof. | **O→C (1):** org-wide VPW embeds Second Take’s primitive/registry implementation vocabulary (`action-*`, `expr-*`, `crowd-exemplar`). |
| Prompt assembly / three planes | E1 facts, palette/light; E2 formal payload zone; E3 seed/plate prose; E4 “**payload-driven THREE-PLANE read**”; E5 unchanged. | `33676421`: three-plane read replaces rote template. | **−present:** `vpw3/critic-verdict-r1.md` §Convergence finds 202/243 cropped+foreground and only 6/70 named-cast bases explicitly small; words asserted depth rather than staged it. `taste-ground-truth.md` identifies the same scale gestalt. | — |
| Chain / delta authoring | E1 ≤3 deltas; E2 staged chain enforcement; E3 ≤2; E4 chain-as-default; E5 “**genuine progressive reveal**”, ≤2 and re-base/hard-cut. | `f1c3b1aa` R1: reveal-only chains plus HARD no-op deltas. | **+past, −present:** `poyais-register-audit.md` §3: Poyais 0/22 no-ops, fresh 26/109 (23.9%); `poyais-visual-audit.md` credits L23→25 as a good fresh chain. No current-E5 render evidence. | — |
| Per-scene palette and suffix avoidance | E1 prompt carries committed palette; E2 global/style voices; E3 reset locked palette; E4 warm re-lean and suffix de-recipe; E5 “**committed scene palette**” but no in-shot style prose. | `f8aa5e52` removes recipe-like suffix; `f1c3b1aa` per-scene palettes. | **+past, −present:** `poyais-register-audit.md` §4: poyais 102 explicit per-beat palette clauses; fresh 1/245 and cream/charcoal repetition. `vpw3-r2` says its repaired candidate palette has no batch collapse, but it was rejected on other grounds. | **O→C (2):** generic skill names the channel’s `global_prompt_suffix` as a universal required field. |
| Act partition / anti-convergence | E1 whole-file authoring; E2 lint/critic; E3 refresh waves; E4 act partitions are default; E5 retained. | `33676421`: “parallel-by-default skills.” | **+present:** `vpw3-r2.md` §Convergence: `commit the palette` and repeated terminal palettes reduced to 0 after re-authoring. **−present:** same candidate remains REJECT for five repair groups. | — |
| Critic gate and scoped repair | E1 pre-pixel fresh-eyes critic; E2 lint semantics; E3 no bypass; E4 critic questions; E5 “**re-author, never substitute**.” | `30d2b7e8` closure; `f1c3b1aa` preserves. | **+present:** VPW3 r1/r2 caught systemic template and disclosure defects before generation. **none** for final audience/taste result. | — |

## 2. `.claude/skills/visual-prompt-writer/references/critics.md`

Snapshots: E1 `ff36f637`; E2 `5b1a9b76`; E3 `52b17ab2`; E4 `f8aa5e52`; E5 `f1c3b1aa`.

| Functional section | E1 → E2 → E3 → E4 → E5 | Change / stated reason | Evidence | Layer flag |
|---|---|---|---|---|
| Story/held-tableau test | E1 critic asks whether still carries narration; E2 adds calibrated lint questions; E3 casts/plates; E4 adds monotony/vantage; E5 tests “**what the beat’s true subject is**.” | `33676421` subject-rule merge; `f1c3b1aa` single figure/non-literal restoration. | **+present:** VPW3 r2’s 12-shot audit finds most sampled beats serve VO; it identifies five concrete contrary groups. | — |
| Chain necessity, disclosure and no-op test | E1 generic chain check; E2 VO-keyed action chain; E3 delta cap; E4 chain-as-default; E5 reveal-only and no-op HARD posture. | `30d2b7e8` residual closure; `f1c3b1aa` R1. | **+past, −present:** `poyais-register-audit.md` §3 gives 0% Poyais no-ops vs 23.9% fresh. VPW3 r2 catches repeat-reveal and premature-number chains. | — |
| Scale / crowd / monotony rubric | E1 no measured crowd rubric; E2 crowd checks; E3 three-tier; E4 adds “**vantage/depth/temperature repetition**”; E5 single-figure/crowd exception retained. | `33676421`, `f8aa5e52`, `f1c3b1aa`. | **−present:** `poyais-register-audit.md` §1 finds 37/55 fresh crowds subject-led; `vpw3-r1` finds only 6/70 small/tiny named leads. | **O→C (3):** Second Take scale gestalt and its Poyais comparison are encoded in an org critic. |
| Review independence | E1 fresh-eyes before pixels; E2 calibrated questions; E3 enforced review rows; E4 retained; E5 retained. | `849679f0` added critic questions; no later reversal. | **+present:** VPW3 r1 and r2 independently REJECT, including after the surface repair. | — |

## 3. `.claude/skills/visual-prompt-writer/references/shots-schema.md`

Snapshots: E1 `57010f68`; E2 `30d2b7e8`; E3 `52b17ab2`; E4 `abd3ed95`; E5 `f1c3b1aa`.

| Functional section | E1 → E2 → E3 → E4 → E5 | Change / stated reason | Evidence | Layer flag |
|---|---|---|---|---|
| Shot/VO/text contract | E1 `vo_ref`, supplied text and diegetic lettering; E2 hard owner/place fields; E3 figure tiers; E4 repair vocabulary; E5 still requires “**verbatim**” supplied text. | `30d2b7e8`: source-aware plate and schema closure. | **+present:** known fixed `prop-text bake` class: E1–E5 lint/text contract and image review require letter-for-letter verdict. No taste evidence. | — |
| Figure declaration schema | E1 size/prose tiers; E2 `figures`; E3 named/crowd/seeded performer; E4 removes bad primitives; E5 named cast or `crowd`, no anonymous foreground. | `52b17ab2`; then `db0ffd14` abolishes seeded performer. | **+present:** commit history/test notes close unseedable foreground and primitive no-op failure classes. **none** for performance. | **O→C (4):** org schema owns a channel-specific `crowd` rig policy rather than a channel capability declaration. |
| Stage/place/plate fields | E1 base/delta; E2 one plate definition + owner choice; E3 plate occupancy; E4 existing schema; E5 reveal-only delta constraints. | `5b1a9b76`, `3d2aea26`, `f1c3b1aa`. | **+present:** known stale-collision/cross-place protections are fail-loud in current tooling; `6c2-genlog.md` documents a detected scope/plate missing-seed hazard rather than a silent ship. | **C→O (1):** portable provenance fields (`place`, parent/lineage, review status) appear only in this channel’s kit/schema. |
| Cadence / coverage fields | E1 duration and coverage; E2 header-rate refinements; E3 retained; E4 retained; E5 unchanged. | `94eafe49` cadence dial; no material later doc change. | **−present:** VPW3 r1 finds 21 shots >4s and L243 8.88s real; schema existence did not prevent it. | — |

## 4. `.claude/skills/visual-prompt-writer/scripts/lint_shots.py`

Snapshots: E1 `57010f68`; E2 `30d2b7e8`; E3 `52b17ab2`; E4 `f8aa5e52`; E5 `f1c3b1aa`.

| Functional section | E1 → E2 → E3 → E4 → E5 | Change / stated reason | Evidence | Layer flag |
|---|---|---|---|---|
| VO/text/coverage lint | E1 hard text and VO matcher; E2 “**one splitter**” and source-aware plate; E3 retains; E4 retains; E5 retains. | `30d2b7e8`: 222+162+17 green. | **+present:** prop-text unsupplied/bake failure is mechanically caught; no audience/taste evidence. | — |
| Figure/crowd and primitive lint | E1 rig prose; E2 declarations; E3 tier/cap hard checks; E4 crowd `figures?` guard; E5 current checks no-op/tier law. | `46076bff`: latent L75/L174 crowd class caught; `f1c3b1aa`. | **+present:** known rig drift/no-op primitive classes have tests and hard refusals; `poyais-visual-audit.md` still records current crowd individuation defects in rendered fresh material. | **O→C (5):** Second Take’s four-digit/cartoon crowd distinctions are hard-coded in an org linter. |
| Chain/stage lint | E1 base-first/≤3; E2 semantic action-chain; E3 ≤2; E4 fixes crowd lint; E5 “**HARD no-op deltas**.” | `f1c3b1aa` R1. | **+past, −present:** 0/22 Poyais no-ops vs 26/109 fresh (`poyais-register-audit.md` §3). No run after current code demonstrates the new hard guard closes all semantic no-ops. | — |
| Place/owner/seed-lint parity | E1 absent; E2 forced owner choice and cross-place semantics; E3 plates; E4 retained; E5 retained. | `5b1a9b76`; `30d2b7e8`. | **+present:** stale-collision and cross-place seed failure classes are explicitly fixed; `6c2-genlog.md` demonstrates scope preflight caught a missing-place-seed path. | — |

## 5. `.claude/skills/image-generation/SKILL.md`

Snapshots: E1 `d85b9f8a`; E2 `30d2b7e8`; E3 `52b17ab2`; E4 `f8aa5e52`; E5 `f1c3b1aa`.

| Functional section | E1 → E2 → E3 → E4 → E5 | Change / stated reason | Evidence | Layer flag |
|---|---|---|---|---|
| Style assembly / suffix | E1 bible descriptor and tail suffix; E2 two voices; E3 era restoration “**2-voice style**”, 1K; E4 suffix de-recipe; E5 uses poyais descriptor and tail. | `d1f771a7`: deletes HARDENED third voice; `f8aa5e52`; `f1c3b1aa`. | **+past, −present:** `poyais-visual-audit.md` records painterly gradients/atmospheric light in liked Poyais vs thinner current flat-cel light; `taste-ground-truth.md` says current v2 is still majorly off. | **O→C (6):** Poyais-specific style mechanism, 1K rationale, and Second Take style tile live in an org skill. |
| Seed law / continuity | E1 character seed based; E2 plate/source-aware rules; E3 fresh/inherited step cards; E4 refined roles; E5 compulsory reviewed seed / same-place lineage. | `30d2b7e8`, `52b17ab2`, `f1c3b1aa`. | **+present:** known rig drift and stale-collision are fail-loud; `6c2-genlog.md` Stage 5 proves lineage reset under verified L33 before L34 mint. | **C→O (2):** general seed provenance and retry safety are only documented in channel-facing image doctrine. |
| Figure staging / cards | E1 canonical seeds; E2 two-tier; E3 three-tier/costumed performer; E4 residual primitive repairs; E5 named cast/crowd, closed-world cards. | `52b17ab2`, `db0ffd14`, `f1c3b1aa`. | **+present:** `6c2-genlog.md` has 8/8 verified corrective retries and records a real prior expression-role hole; no direct taste win. | **O→C (7):** specific Second Take registry/action-card architecture resides in cross-channel generator instructions. |
| Chain generation | E1 staged deltas; E2 recipe and surgical retry; E3 ≤2; E4 default chaining; E5 reveal-only / hard no-op. | `703b5dc8`; `f1c3b1aa`. | **+past, −present:** Poyais 0 no-op delta record, fresh 23.9%; current code itself has not generated a comparative current wave. | — |
| Prompt ordering and content-only authoring | E1 concrete prompt; E2 payload-final zones; E3 seed-role prose; E4 no recipe suffix; E5 “**policy first, authored text last**.” | `703b5dc8`, `f8aa5e52`. | **+present:** VPW3 r2 confirms authoring-rationale/template phrases were removed. **−present:** VPW3 r1 rejected prior late prompt-register collapse. | — |
| Review, retry, park gate | E1 image review and honest stamp; E2 retry overlays; E3 machine rows/reviewed assets; E4 parallel partitions; E5 all-pass current-digest seed gate. | `3d01b45b`; `703b5dc8`; `f1c3b1aa`. | **+present:** `6c2-genlog.md` ends 23/25 verified, 2 parked with mechanism diagnoses; no false PASS asserted. | **C→O (3):** generic, reusable single-writer review/stamp procedure is described only around this channel kit. |
| Parallel wave process | E1 batch review; E2 DAG parallel; E3 partitions; E4 “**concurrent workers on disjoint contiguous partitions**”; E5 retained. | `7658d689`, `33676421`. | **+present:** stated tests/green counters and partitioned gen logs show process use; no measured performance or taste effect. | — |

## 6. `.claude/skills/image-generation/scripts/forge.py`

Snapshots: E1 `6460ff3e`; E2 `dc61405a`; E3 `52b17ab2`; E4 `f8aa5e52`; E5 `f1c3b1aa`.

| Functional section | E1 → E2 → E3 → E4 → E5 | Change / stated reason | Evidence | Layer flag |
|---|---|---|---|---|
| Render size/style constants | E1 default engine behavior; E2 2K; E3 `IMAGE_SIZE_DEFAULT = "1K"`; E4 keeps 1K; E5 unchanged. | `d1f771a7`: poyais restoration claims 2K made stroke read too fine. | **+past:** restoration decision cites poyais register. **none:** no controlled current taste result; ground truth explicitly says resolution is not a taste factor. | **O→C (8):** Poyais/Second Take resolution rationale hard-coded in shared forge. |
| Style/rig/prompt assembly | E1 rig hold based on prompt content; E2 seed roles; E3 bible/crowd expansion; E4 suffix changes; E5 figure declaration expansion and two style voices. | Changes `6460ff3e`, `d1f771a7`, `f8aa5e52`. | **+present:** known rig drift fixed from content-based hold; E1 source comment identifies four bad frames. **−present:** poyais audit finds current flat-cel rendering lacks atmospheric register. | **O→C (9):** hard-coded Second Take rig and scene-style tile paths/semantics. |
| Seeding law / cap displacement | E1 seed selection; E2 source-aware plate; E3 enforced named/crowd rules; E4 ordered seed cap; E5 current true-bind refusal. | `0e7e8d8c`: ordered drops and never-drop inputs. | **+present:** `6c2-genlog.md` catches L28 scope seed loss before a paid re-mint; known stale-collision addressed. | — |
| Batch/stage/lineage | E1 generation batch; E2 source-aware first generated plate; E3 stage cap/lineage; E4 retained; E5 derived parent/verified lineage. | `30d2b7e8`, `52b17ab2`. | **+present:** Stage 5 lineage 2→1 reset on verified L33 is direct evidence of control behavior. | — |
| Surgical retry overlays | E1 no formal overlay; E2 overlay@2; E3 constrained content/seed mechanism; E4 retained; E5 one authority, no additive instruction. | `703b5dc8`. | **+present:** 8/8 retry pass in `6c2-genlog.md`; it also correctly stops after an outage and documents 2 parked rather than rerolling. | — |

## 7. `.claude/skills/image-generation/scripts/stamp_review.py`

Snapshots: E1 `3d01b45b`; E2 `dc61405a`; E3 `52b17ab2`; E4 `46076bff`; E5 `46076bff` (UNCHANGED-SINCE-E4).

| Functional section | E1 → E2 → E3 → E4 → E5 | Change / stated reason | Evidence | Layer flag |
|---|---|---|---|---|
| Scene verdict classification | E1 “**honest three-state verdict**” (`verified`/`parked`/`unreviewed`); E2/E3 retain; E4 requires explicit f/s/r; E5 unchanged. | `3d01b45b`; `46076bff` closes missing-axis false pass. | **+present:** 6c2 ends exactly 23 verified / 2 parked; no manufacture of a clean status. | — |
| Seeding-asset records | E1 absent; E2/E3 figure records added; E4 digest/current record enforcement; E5 unchanged. | E3-era asset review expansion. | **+present:** current all-pass asset records prevent unreviewed reuse; no taste evidence. | **C→O (4):** reusable truth-preserving review-state mechanism is only operationalized against this one kit. |

## 8. `.claude/skills/image-generation/scripts/build_review_artifact.py`

Snapshots: E1 `ff36f637` (file absent); E2 `5693318b`; E3 `52b17ab2`; E4 `f8aa5e52`; E5 `f8aa5e52` (UNCHANGED-SINCE-E4).

| Functional section | E1 → E2 → E3 → E4 → E5 | Change / stated reason | Evidence | Layer flag |
|---|---|---|---|---|
| Board/card collection | E1 absent; E2 collects shot/motion/manifest cards; E3 adds assets; E4 retains; E5 unchanged. | Added in review-system wave. | **+present:** review artifact is the shared surface for the 6c2 fresh-eyes pass. | — |
| Machine-emitted invariant rows | E1 absent; E2 manual rows; E3 prefiltered invariant skeleton; E4 inherits; E5 unchanged. | `52b17ab2` and decisions 2026-08-04: avoid hand-typed row collapse. | **+present:** review procedure identifies/carries f/s/r and applicable invariant rows; no taste evidence. | **C→O (5):** generic review-row emission is channel-kit-only process logic. |
| Ordinary-scale canonical comparison | E1 absent; E2 crop battery use; E3 named figures only/ordinary scale; E4 unchanged; E5 unchanged. | 2026-08-03/04 decision: crop burden removed. | **none:** no comparative evidence that ordinary scale is better/worse; policy reason is review load. | — |

## 9. `.claude/skills/image-generation/scripts/crop_battery.py`

Snapshots: E1 `ff36f637` (file absent); E2 `dc61405a`; E3 `dc61405a`; E4 `dc61405a`; E5 `dc61405a` (UNCHANGED-SINCE-E2; retired in procedure).

| Functional section | E1 → E2 → E3 → E4 → E5 | Change / stated reason | Evidence | Layer flag |
|---|---|---|---|---|
| Crop/sheet renderer | E1 absent; E2 `MIN_SIDE=360`, battery+sheet helpers; unchanged E2–E5. | `30d2b7e8` locates final site; later skill says “**crop_battery.py is RETIRED**.” | **none:** it is historical tooling; no verdict depends on it after review slimming. | — |

## 10. `.claude/skills/image-generation/scripts/finalize_thumbnail.py`

Snapshots: E1 `d85b9f8a`; E2 `d85b9f8a`; E3 `d85b9f8a`; E4 `d85b9f8a`; E5 `d85b9f8a` (UNCHANGED-SINCE-E1).

| Functional section | E1 → E2 → E3 → E4 → E5 | Change / stated reason | Evidence | Layer flag |
|---|---|---|---|---|
| Crop-to-1280×720 finalizer | E1 enforces target ratio/min crop width; **UNCHANGED-SINCE-E1** through E5. | `d85b9f8a` thumbnail finalizer; no doctrine-era change. | **none:** no supplied thumbnail performance verdict bears on this section. | — |

## 11. `channels/the-second-take/visual-kit/visual-grammar.md`

Snapshots: E1 `ff36f637`; E2 `b55fe0ad`; E3 `52b17ab2`; E4 `f8aa5e52`; E5 `f1c3b1aa`.

| Functional section | E1 → E2 → E3 → E4 → E5 | Change / stated reason | Evidence | Layer flag |
|---|---|---|---|---|
| Depiction-class table | E1 staging conventions/lever translation; E2 depiction law; E3 class constraints; E4 warm/non-literal adjustment; E5 §1 “**classify, then invent**,” non-literal first-class. | `f1c3b1aa` R4. | **+past, −present:** Poyais’s 28 symbolic / 48 cast-free beats vs fresh 4 / 55 (`poyais-register-audit.md` §2); current ground truth still says a major gap remains. | — |
| Stage/chain law | E1 staging; E2 staged authoring; E3 ≤2 deltas; E4 chain-as-default; E5 only meaningful reveal changes / no-op HARD. | `f1c3b1aa` R1. | **+past, −present:** Poyais 0 no-op delta vs fresh 26. Fresh L23–25 is an audited positive counterexample. | **C→O (6):** stage/delta validation rules are reusable process logic confined to channel grammar. |
| Figure / crowd staging | E1 cast staging; E2 two-tier; E3 three-tier/performer; E4 revised subjects; E5 “**one seeded figure default**,” crowd mass-only. | `f1c3b1aa` R2′. | **+past, −present:** poyais uses people as subject/dressing with single-character relief; fresh crowd subject share is 67.3% and visual audit sees individuation creep. No post-E5 output. | — |
| Composition / camera / scale | E1 “composition… driven by payload”; E2 composition law; E3 anti-perspective rules; E4 vantage unlock, three-plane; E5 no forced vantage and composition is decision. | `33676421` unlock; `f1c3b1aa` retains. | **−present:** `vpw3-r1` finds foreground/recession template dominance; `taste-ground-truth.md` specifies figures 10–30% and 30–50% open space, says v2 is still majorly off. | — |
| Palette / light | E1 lever/register; E2 global suffix; E3 hard style reset; E4 warm re-lean/era chroma; E5 per-scene palettes. | `f8aa5e52`, `f1c3b1aa` R3. | **+past, −present:** Poyais mixes warm/cool/desaturated story turns; fresh sample has no cool-dominant emotional passage (`poyais-visual-audit.md` §b). VPW3 r2 has good planned palette variation but is not a render verdict. | — |
| Policy/source constraints | E1 pipeline feed; E2 policy language; E3 schemas; E4 retained; E5 §6 constraints. | No independently stated change reason. | **none:** no performance evidence. | — |

## 12. `channels/the-second-take/visual-kit/style-bible.md`

Snapshots: E1 `ff36f637`; E2 `a4bbe9ab`; E3 `52b17ab2`; E4 `f8aa5e52`; E5 `f1c3b1aa`.

| Functional section | E1 → E2 → E3 → E4 → E5 | Change / stated reason | Evidence | Layer flag |
|---|---|---|---|---|
| Style-only descriptor | E1 “**simple flat colours with gentle soft cel shading**”; E2 one-voice C-1 recipe; E3 reset/then era restoration; E4 de-recipe/era chroma; E5 restores the soft-cel phrase and per-scene palette. | `d1f771a7`, `f8aa5e52`, `f1c3b1aa`. | **+past, −present:** Poyais audit observes painterly texture, soft gradients, volumetric light; fresh flat-cel reads thinner/flatter. `taste-ground-truth.md` names render register as still unresolved. | — |
| Full rig / identity | E1 full rig + base/crowd tiers; E2 auto append; E3 cards/three tiers; E4 resting face and current registry truth; E5 channel canonical comparison. | `52b17ab2`, `e2a955f0`. | **+present:** known rig drift (noses/ears/digits) has mechanically enforced full-rig and review axes; 6c2 retry verification fixes specified content/hand issues. | **C→O (7):** reusable rig/review invariant and seed-routing procedure is channel-only rather than org process. |
| Crowd rig / bounded variety | E1 simplified crowd; E2 expansion; E3 bounds; E4 exemplar proportion and lint; E5 2–3 tones/hair silhouettes, every face simplified. | `c4ab957b`, `46076bff`. | **−present:** Poyais-vs-fresh audit shows foreground crowd individuation recurring despite crowd doctrine. **+present:** L09-type latent guard caught; no later pixel proof of the present text. | — |
| Palette | E1 palette lock/semantic red; E2 style local; E3 reset palette rules; E4 “warm re-lean”; E5 “**warm, cool, mixed, and desaturated passages are equally normal**.” | `33676421`, `f8aa5e52`, `f1c3b1aa`. | **+past, −present:** poyais local warm/cool narrative turns; fresh dominated narrow warm cream/amber in sampled first 24. | — |
| Committed recipe/environment | E1 built flat environments; E2 one voice; E3 style tile; E4 tile temperature limited; E5 tile is line/saturation only and environments need three planes. | `d1f771a7`; `33676421`; `f1c3b1aa`. | **−present:** ground truth says world-with-people ratio remains missed; VPW3 critic finds prose template/convergence. | **C→O (8):** generic environment review/seed semantics live only in a channel taste bible. |
| Registry use | E1 asset library/build protocols; E2 live index; E3 per-video refs; E4 repair; E5 §6 current index. | `f233bd70` initially moves depiction law out; subsequent commits update. | **+present:** canonical/asset review records prevent stale or unruled seed reuse. | — |

## 13. `channels/the-second-take/visual-kit/registry/registry.json`

Snapshots: E1 `ff36f637`; E2 `6735796d`; E3 `d1f771a7`; E4 `693b0fff`; E5 `f1c3b1aa`.

| Functional section | E1 → E2 → E3 → E4 → E5 | Change / stated reason | Evidence | Layer flag |
|---|---|---|---|---|
| Character canonical/costume entries | E1 initial register; E2 bricks cast; E3 era restoration and de-badged miniscribe; E4 new/repaired canonicals; E5 current canonical set. | `240aed74`: badge was doctrine-caused and removed at root; `e110a961`; `df962f98`. | **+present:** root costume rewrite prevents the known prop-text/badge bake recurrence; canonical promotions carry review status. | — |
| Primitive/action/expression entries | E1 base refs; E2 initial cards; E3 removes shock/pleading and mints cards holding beat; E4 asset rulings; E5 closed-world active set. | `e088c455`, `78dbc47c`, `abd3ed95`. | **+present:** known no-op/dropped primitive classes are removed or blocked. `6c2` records one expression-authority gap as diagnosed, not silently hidden. | — |
| Environment/prop/style anchors | E1 small refs; E2 plates/crowd/props; E3 style tile; E4 warm plates/rival PC; E5 current. | `d1f771a7`, `224b204c`, `693b0fff`. | **+present:** registry exists as provenance source; 6c2 catches a plate scope failure before ship. **none** for taste impact. | — |
| Doctrine-bearing notes in rows | E1 minimal; E2 seed and costume notes; E3 poyais-era restoration notes; E4 current status; E5 updated chain/palette/pose entries. | `f1c3b1aa` applies current doctrine to registry. | **−present:** registry can faithfully propagate a bad rule (miniscribe badge was explicit); the source gives a direct root-cause example. | — |

## 14. `channels/the-second-take/example-shots.md`

Snapshots: E1 **ABSENT**; E2 `b55fe0ad`; E3 `d1f771a7`; E4 `f8aa5e52`; E5 `f1c3b1aa`.

| Functional section | E1 → E2 → E3 → E4 → E5 | Change / stated reason | Evidence | Layer flag |
|---|---|---|---|---|
| Calibration preamble | E1 absent; E2 depiction bar approved; E3 era restoration; E4 grammar repair; E5 says “**match the DEPICTION THINKING, never clone**.” | `edfb340c` gate-B approval; `f1c3b1aa`. | **+past:** examples mine Poyais, whose approved/liked visual evidence is documented in `poyais-visual-audit.md`. **none** that current authors followed them. | — |
| Non-literal move set (sections 1–7) | E1 absent; E2 approved examples; E3 retains; E4 repair; E5 physicalized imbalance, interaction, irony, idiom, number-object, symbolic, literal-correct. | E5 poyais restoration re-elevates classes. | **+past, −present:** Poyais audit and register audit show broad non-literal range; current fresh has only four symbolic stand-ins. | — |
| Delta-chain exemplar | E1 absent; E2 chain trio; E3 retained; E4 repaired; E5 “**one story-bearing element changes per cut**.” | E5 R1. | **+past, −present:** 0 Poyais no-ops vs 26 fresh. | — |
| Place/plate exemplar | E1 absent; E2 mechanism sample; E3 plate law; E4 retained; E5 recurring place pair. | E2/E3 seed/plate evolution. | **+present:** preflight/lineage controls catch stale/place collision; **none** that it improves taste. | **C→O (9):** generic place/plate provenance mechanics are taught only by a channel-specific exemplar. |

## Evidence totals and provenance notes

Section count: **60**.  Tag counts (non-exclusive): **+past 18; +present 31; −present 26; none 11**.  These counts are of the table rows above; a row may have both +past and −present (and several rows give both a process-control positive and a current taste negative).  The archive-to-current comparison is constrained: the poyais scene PNGs were swept, so `poyais-visual-audit.md` uses 20 recovered Gate-2 board frames; the report never upgrades that limitation to a claim of a controlled experiment.

Known-fixed failure-class coverage: rig drift (content-derived rig hold, reviewed card/scene gate), no-op deltas (E5 hard guard but no post-E5 comparative run), template convergence (VPW3 r2 removes repeated prompt families but remains REJECT), prop-text bake (supplied/verbatim text plus review), stale-collision (verified lineage/retry refusal).  These are process/control results, not blanket taste positives.

## Top ten evidence correlations: past-positive × present-negative

Ordered by directness of the cited contrast, not by a recommendation score.

| # | Section | Past-positive evidence | Present-negative evidence |
|---:|---|---|---|
| 1 | Style bible §2b / image-gen style assembly | Liked Poyais uses soft cel shading, gradients and atmospheric light (`poyais-visual-audit.md` §c). | Current v2 is “still missing the mark in a MAJOR way”; render register remains an open candidate (`taste-ground-truth.md`, 2026-08-19). |
| 2 | VPW/grammar non-literal depiction | Poyais: 28 symbolic + 48 cast-free beats. | Fresh: 4 symbolic, literal re-enactment rises to 43 (`poyais-register-audit.md` §2). |
| 3 | VPW/grammar chain law | Poyais: 0/22 cosmetic/sub-visible no-op deltas. | Fresh: 26/109 (23.9%) (`poyais-register-audit.md` §3). |
| 4 | Palette authoring (VPW + bible) | Poyais: 102 local palette clauses, 93.2% warm with meaningful cool turns. | Fresh: 1 explicit palette clause, repeated cream/charcoal; no cool-dominant beat in first-24 visual sample. |
| 5 | Figure/crowd staging | Poyais combines 10 cast-free sample shots with six single-character beats. | Fresh human material defaults to 8–40-person crowd scenes and recurring individuation creep (`poyais-visual-audit.md` synthesis). |
| 6 | Composition / world scale | Liked Poyais includes layered empty worlds and figures in structured space. | Fresh prompts repeatedly assert, rather than build, depth: 6/70 small/tiny named leads; dominant cropped foreground template (`vpw3-r1`). |
| 7 | Example-shots non-literal calibration | Poyais-mined examples embody symbolic/ironic/object-led moves. | Fresh evidence says the class spread has collapsed toward literal re-enactment; no evidence current examples corrected that. |
| 8 | Crowd-rig rendering | Poyais crowd examples use distant/hazy/blank-rig devices. | Fresh audit identifies near-camera individual faces across L01–03, L07–08, L16–17 and L22. |
| 9 | Prompt register / palette assembly | Poyais uses beat-specific prose and palette. | VPW3 r1 finds 58 author-rationale phrases and mass terminal palette repetition; the r2 repair is positive but candidate still rejected. |
| 10 | Review/critic gate | Past Poyais Gate-2 frames are the available liked reference set. | Current independent critic rejects candidate twice (r1 systemic convergence; r2 five remaining repair groups), so present plan is not performance-validated. |

## Layering audit index

**18 flagged wrong-layer passages:** O→C 9 and C→O 9.  The count treats a passage in each listed table row as one occurrence (not a unique concept).  No production sibling kit exists to demonstrate inheritance impact; the comparison set is `channels/_TEMPLATE`, `_test-eng`, `_test-metadata`, and `_test-pipeline`, none of which supplies a `visual-kit/`.
