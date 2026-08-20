# Recut-plan adversarial verdict

## VERDICT: REJECT

Finding counts: **CRITICAL 2 · HIGH 0 · MEDIUM 2 · LOW 0**.

No changes applied. `recut-plan.md` remains untouched: the two CRITICAL conflicts alter the
substance of the overnight variants and need a revised plan, not a reviewer-side patch.

## Blocking findings

### CRITICAL — restores the prohibited anonymous foreground tier

`recut-plan.md:58-64` directs the worker to move Poyais's anonymous size-routing and casting
text into Grammar, while `recut-plan.md:541-552` restores it there. The cited source actually
permits it:

> Anonymous LARGE / foreground -> the §2e clause (full rig, authored into the prompt, a generic
> fitting outfit + hair, no seed, no canonical needed).

That directly contradicts `goal-state.md:86-90` (current named/costumed performers must remain;
do not restore anonymous everyman foregrounds) and the explicit don't-keep rule at
`goal-state.md:179-181`. It reopens the goal-state's STRONG story-bearer/occupancy axis, even
though the plan deletes the modern guard that had prevented it. The restored historical text
cannot take precedence over the governing target.

Required revision: retain the named story-bearer versus genuine rearward crowd decision in
`visual-grammar.md`; do not restore or route any anonymous LARGE/foreground/full-base-rig
authoring path. Preserve only the closed-world and crowd-exemplar safeguards that the plan
already cites.

### CRITICAL — deletes the explicitly retained disjoint-wave process

`recut-plan.md:40-43`, `108-111`, and `349-352` delete the current act partition and concurrent
disjoint-partition procedure, restoring a single serial batch instead. `goal-state.md:172-174`
explicitly keeps **disjoint parallel waves and independent review as process machinery**.
The reconciliation record makes the same standing ruling (`reconciliation-plan.md:126-129` and
`317-320`). This is not an unvalidated taste layer: deleting it regresses the STRONG
editing-law/review-integrity axis and removes an owner-protected process control.

Required revision: retain disjoint contiguous partitions, whole-chain ownership, and independent
review as process machinery; remove only duplicated causal/taste claims about parallelism.

## Required audit results

### Survivor audit — PASS

All 23 modern-survivor bundles cite a real minimal-fix item or a real drift-ledger keep-list
commit. All 10 minimal fixes are accounted for in `recut-plan.md:736-752`; all 20 keep-list
commits have a surviving passage, behavior, or factual row in the 23-row budget. In particular,
the bundles cover cadence, text, RIG-HOLD, review state, seed/retry/provenance, asset integrity,
crowd correction, and the Daniel asset rulings. No uncited survivor found.

### Delete audit — FAIL

Sampled 15 deletion directives: `recut-plan.md:40, 52, 62, 81, 93, 103, 108, 147, 185, 234,
248, 269, 349, 475, 526`.

- 13 were indicted-list disposals or valid condensation casualties and did not remove a retained
  minimal fix.
- `:40/:108/:349` is the CRITICAL parallel-wave regression above.
- `:62/:185/:526` are otherwise correctly charged to indicted or duplicate doctrine, but their
  resulting Grammar restoration must be revised to avoid the separate anonymous-foreground
  regression above.

### Restore fidelity — PASS

Ten sampled `RESTORE-VERBATIM` ranges were present in the cited blobs with the stated inclusive
counts and matching boundary text: `57010f68` VPW L25-90, L189-246, L361-565; `ff36f637` Critic
L38-104; `57010f68` Schema L17-182 and L231-363; `d85b9f8a` Image-generation L18-61 and L368-477;
`ff36f637` Grammar L1-25; and `ff36f637` Bible L88-99. No paraphrased text was represented as a
verbatim restoration in this sample.

### Behavior-restoration determinism — FAIL

- **MEDIUM:** `recut-plan.md:227-229` names broad lint behavior and two source ranges, but not
  the exact functions retained/deleted nor a named regression per behavior. A worker cannot
  deterministically distinguish the retained matcher/write-back/text checks from adjacent legacy
  behavior while reducing the file by 1,204 lines.
- **MEDIUM:** `recut-plan.md:363-364` simultaneously says “poyais provider default behavior” and
  “keep 1K as the neutral default,” without specifying whether the request omits `imageSize` or
  sends an explicit 1K value. It also names no image-size regression. `forge.py` needs one exact
  request-shape rule and a named test before implementation.
- `stamp_review.py:430-443` is sufficiently determinate: three states, persistent parked
  reasons, atomic write, coordinator ownership, and missing f/s/r -> parked.

### Condensation — PASS, contingent on the two blockers

The planned homes match `contradiction-map.md:56-67`: Grammar for figure/depiction/crowd/pose/
composition; Bible for palette/style/review; Schema for chains and text; Forge for assembly order;
Registry for facts; executable validators without competing doctrine prose. The planned duplicate
deletions are coherent. It becomes non-compliant only where it deletes the retained parallel-wave
process and restores the prohibited anonymous tier.

### Open-question recommendations — PASS

All six recommendations are evidence-consistent: P1 supersedes only cadence numbers; the
text-descriptor collision is tested before deleting one sentence; explicit f/s/r supersedes
implicit clean; ordinary-scale review supersedes mandatory crops; prompt order stays Arm A pending
the blinded same-seed A/B; and the Git tree is the byte-level authority for the disputed helpers.

### Net-count plausibility — PASS

Sampled arithmetic: Schema 291 -> 350 = **+59**; Forge 3,208 -> 1,750 = **-1,458**; Bible
200 -> 300 = **+100**. The 14 listed targets sum to 6,197 from 9,728, yielding the claimed
**-3,531** stack net.

### Goal-state doctrine-diff rubric

| Axis | Result | Reason |
| --- | --- | --- |
| Scale/composition | PASS | Deletes compulsory fill/frontal/foreground formulae and retains payload-led air. |
| Palette | PASS | Deletes warm global tail; Bible is the single beat-local palette home. |
| Characters/crowds | FAIL | Restores anonymous LARGE/foreground, contrary to the named story-bearer rule. |
| Depiction mix | PASS | Retains the Poyais decision/pointer and removes literal-default overlays. |
| Chains | PASS | Keeps material semantic no-op refusal and reveal-only chain use. |
| Render register | PASS (OPEN) | Does not force flat-cel or claim recovery; pixel review remains required. |
| Lettering | PASS | Retains supplied/verbatim enforcement and the prose-named-prop probe. |
| Editing law/review integrity | FAIL | Deletes disjoint parallel waves that the target explicitly retains. |

## Verification

- `py -3 -m pytest .claude/skills/visual-prompt-writer/scripts/test_shots_v2.py .claude/skills/visual-prompt-writer/scripts/test_doctrine_reset_guards.py .claude/skills/visual-prompt-writer/scripts/test_lettering_fidelity.py -q` — **142 passed**.
- `py -3 -m pytest .claude/skills/image-generation/scripts/test_forge_figures.py .claude/skills/image-generation/scripts/test_forge_place_and_gates.py .claude/skills/image-generation/scripts/test_stamp_review.py -q` — **88 passed**.
