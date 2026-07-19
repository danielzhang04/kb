# Visual Grammar Consolidation + Channel-Doc Deep-Clean — Design Spec

**Date:** 2026-07-07 · **Status:** design, awaiting user review before implementation. Companion to the
storytelling-grammar rebuild (`2026-07-07-storytelling-grammar-and-skill-restructure-design.md`) — same
discipline, applied to the visual pipeline, plus a systemic doc-sync pass.

## Problem

The visual side has the same rot as the writing side, plus a systemic one:

- **Two overlapping channel docs.** `content-language.md` (device catalog + motion/timing + build list) and
  `visual-narration-grammar.md` (narration→shot-class grammar + within-shot motion + cut cadence) are two
  lenses on the *same* channel-analysis study and **duplicate each other** on motion/cadence/register.
- **Scope-bleed.** Much of both is **universal** visual doctrine (hold-then-snap, within-shot motion,
  literalize-the-abstract, cut cadence, register-switch) living inside Second-Take-specific files.
- **The pacing learnings exist but aren't BINDING.** `visual-narration-grammar §4` (within-shot motion) and
  `§5` (cut cadence) already describe exactly the choreography we want — idle micro-motion + ONE meaningful
  VO-synced transform + pop-in/type-on on the narrated word + hold-then-hard-cut — but they're filed as
  "Phase-2, captured-now-build-later" *reference*, so the shot-writer treats them as optional. Result: static
  ~8s holds instead of a choreographed slate.
- **stretch-to-fill bug.** `visual-prompt-writer` under-produces shots → `render-builder` re-times to the VO
  and **stretches each shot** to fill the gap → one visual sits on screen 15–25s. (Its own doc admits this.)
- **Copy-not-point.** `visual-prompt-writer` Step 2.5 re-teaches the narration→shot grammar that lives in the
  grammar docs (same duplication disease as `long-form-writer`).
- **Ownership bug.** `long-form-writer` line 362 mislabels `[B-ROLL]` cues as "the shot list — one visual per
  beat," fighting `visual-prompt-writer`'s job of building the actual slate.
- **SYSTEMIC (user-named):** locked decisions get made but the docs that recorded the *old* decision are
  never updated, and they're **still referenced** — stale direction (old register, pre-lock visual
  directions, superseded flags) leaks back into runs. `dna.md`, `content-language.md`, and others carry this.

## Goals

Same as the writing rebuild — **rebuild, don't purge** (preserve every real learning; cut only noise) — plus:
1. **One home per capability;** universal visual grammar in `universal.md`, channel application in the kit.
2. **Make the pacing/choreography BINDING** so the shot-writer produces a *slate* (composed, internally
   animated, VO-synced), not static holds.
3. **Sync every doc to the current locked reality** (retroactive enforcement of CLAUDE.md operating rule 6).

## Non-goals

- Not changing the LOCKED style-bible spec VALUES (palette hexes, descriptors, invariant checklist) — form
  only, values verbatim.
- Not building the Phase-2 Remotion *motion-rendering* layer. The choreography is **authored now** (as
  `within_shot_motion` in `shots.json`); full motion rendering stays Phase-2.
- Not re-running the reference-channel visual analysis — the shot-logs + the two docs already synthesized it;
  raw `research/shot-logs/` stays as the evidence archive.

---

## Findings — the pacing model to make binding (the user's core ask)

A shot is **not** a static frame held for N seconds. It is a **composed slate** with internal choreography
synced to the VO. The rules (already in `visual-narration-grammar §4/§5`, `content-language §A/§C` — elevated
here from "reference" to binding):

1. **Idle micro-motion baseline** — every held frame breathes (globe spin, cash flutter, a subtle bob/blink)
   so no frame is dead.
2. **ONE meaningful transform per shot** — the single move that *is* the beat: a coin shrinks (debasement), a
   scale tips (over-printing), a chart draws itself, a ship sails toward frame, a plug pulls out.
3. **Pop-in / type-on synced to the narrated word** — for enumerations/lists, elements appear one at a time
   *on the word*. **User's example:** "no church, no paved roads, no rivers of gold" → hold the Poyais image,
   then drop an X / a bomb / a strike-through on each promised thing *as it's named*. This is one shot with
   internal choreography, not three cuts.
4. **Hold, then hard-cut on the payload word** — ~0.6–0.8s hold, snap to the reaction/reveal on the punch
   word; no easing into punchlines.
5. **Cut cadence 4–8s frame-swap, varied by role** — fast (1.5–3s) for jokes/enumerations, slow (5–12s) for
   dialogue/mechanism/emotional turns; a deliberate breath-beat at emotional turns. **A shot may exceed ~8s
   ONLY if it carries a progressive within-shot reveal** — otherwise cut. This kills stretch-to-fill.

The shot-writer AUTHORS all of this per shot now (`still_prompt` composed to move + a rich `within_shot_motion`
spec); `render-builder` carries it (informational under Pattern A, load-bearing in Phase-2 Remotion).

---

## Target structure (mirrors the writing side)

### 1. `universal.md` §13 / §13a — the universal visual grammar (BINDING, niche-agnostic)
Holds the general grammar every channel inherits: the **narration-type → shot-class** table (already in §13a),
**plus** the promoted-from-channel universal doctrine as *binding* rules — the **within-shot motion grammar**,
the **cut cadence**, hold-then-snap, literalize-the-abstract, register-switch-as-signal, motion-is-cheap. The
pacing/choreography model above lives here as law.

### 2. `channels/the-second-take/visual-kit/visual-grammar.md` — ONE merged channel doc
Merges `content-language.md` + `visual-narration-grammar.md` (both deleted; raw `research/shot-logs/` kept as
archive). Holds only **The Second Take's application** of the universal grammar:
- Our **locked-rig cast** (round-head, no nose, flat cel; institutions = cast + one identity tag).
- The **prop/device/expression library** (the finance concept-prop set, diegetic devices, the extreme-register
  expression set) + the **prioritized build list** for `asset-forge`.
- The **lever/register translation** (§8): ironic-counterpoint/unmasking as our *signature*; register set by
  topic gravity → `storytelling-grammar.md §2.1`; analysis-not-gore gate; money-stories-not-explainers.
- The **committed visual recipe** — fold in the locked dna.md recipe (2.5D vector cast + built environments +
  marker-style charts/title-cards + one red accent) as THE direction; **retire the stale §D A/B/C
  "directions open" prototype section** (superseded by the lock).
- Points to `universal.md §13a` for the general grammar; does not re-teach it.

### 3. `style-bible.md` — the identity lock (unchanged in substance)
Stays separate. Already form-cleaned; **spec values preserved verbatim.**

---

## Skill edits

### 4. `visual-prompt-writer/SKILL.md`
- **De-dup Step 2.5** against the grammar — point to `universal.md §13a` + the channel `visual-grammar.md`;
  keep the *procedure* (classify → pick class → invent → literal-check → record fields) and a tight checklist,
  not the re-taught class table.
- **Own the shot list + pacing, and make the slate BINDING** (surface as a load-bearing rule): each shot =
  `still_prompt` composed to move + a **required rich `within_shot_motion`** (idle + the one meaningful
  transform + any VO-synced pop-ins/progressive reveals). Enumerations/lists → progressive-reveal
  choreography (the "no X, no Y, no Z" pattern), authored as ONE shot, not silently dropped.
- **Enforce cadence:** min shots = `runtime ÷ 8s`; Σ`duration_s` ≈ runtime; a shot may exceed ~8s **only**
  with a progressive within-shot reveal. State the stretch-to-fill failure explicitly so a run avoids it.
- Reframe the Remotion note: choreography is authored NOW; motion *rendering* is Phase-2.

### 5. `long-form-writer/SKILL.md` (visual bullet — ownership fix)
Line 362: `[B-ROLL:]` cues are **meaning anchors only**; `visual-prompt-writer` owns the shot list, count,
pacing, and durations. Drop "this IS the shot list / one visual per beat."

### 6. `asset-forge/SKILL.md`
Re-verify its references point to the merged `visual-grammar.md` + `style-bible.md`; confirm the build-list
pointer resolves. Light — already cleaned this pass.

---

## 7. Deep-clean pass — sync docs to current locked reality (the systemic fix)

Apply the `curate-doc` discipline (CLAUDE.md rule 6) retroactively to the docs carrying stale/superseded
decisions that are still referenced:
- **`dna.md`** — full read; reconcile EVERY stale item to the current lock: the register block (done → verify),
  the **visual register/recipe** (ensure it states the locked 2.5D recipe, not an old TODO/variant), voice
  (Miles lock), pipeline flags, lever, length band. Remove superseded phrasing; keep one current source of
  truth per field.
- **`content-language.md`** — folded into the merge (its stale register block + §D directions + Phase-2
  framing are resolved by the merge).
- **Audit the rest** — `idea-backlog.md`, `performance.md`, `reference-channels.md` (partly done),
  `visual-kit/*`, and any doc a skill reads — for superseded decisions still stated as current. Reconcile
  clear supersessions; **flag ambiguous ones** for a human call rather than guessing. Report what was found.

## 8. Owed from the writing thread (do alongside)
The **craft de-dup** approved earlier: strip `long-form-writer` Step 3-shared's ~85 lines that re-teach
`storytelling-grammar.md` down to a §-anchored checklist + a hardened "bound to the grammar doc" instruction;
apply the same copy-vs-point audit to `researcher` + `shorts-writer`. (Adherence goes UP — the craft is cited
as law, not paraphrased.)

---

## Execution order + validation

1. `universal.md §13/§13a` — promote + make the pacing/choreography binding (everything references it).
2. Merge → `visual-grammar.md`; delete the two old visual docs; fold in the recipe.
3. `visual-prompt-writer` (de-dup + own pacing + bind the slate) → `long-form-writer` ownership fix →
   `asset-forge` re-verify.
4. Deep-clean pass (dna.md + audit) — reconcile to current reality, report findings.
5. The owed writing craft de-dup.
6. Log in `decisions.md`; bump `index.html`; repo-wide grep for stale references to the deleted visual docs.
7. **Validate on Poyais:** regenerate `script.md` (writing rebuild) AND `shots.json` (visual rebuild) — the
   script reads non-linear/witty-by-gravity/quote-free; the shot list is a **choreographed slate** (rich
   within-shot motion, no static 8s holds, no stretch-to-fill), on-lever (ironic-counterpoint), on-rig.

## Risks

- **Over-cut / losing pacing nuance** — mitigation: this spec embeds the pacing model; execution elevates
  `visual-narration-grammar §4/§5` into binding rules verbatim-in-substance, it doesn't re-derive them.
- **"And more" deep-clean scope creep** — mitigation: reconcile only *clear* supersessions; flag ambiguous
  ones for a human call; report the full audit.
- **universal/channel scope-bleed** — mitigation: universal grammar carries no Second-Take proper nouns; the
  channel doc carries no niche-agnostic rule it should inherit.
