# Image-gen identity/rig adherence — a calibrated tightening (design)

**Date:** 2026-07-10 · **Status:** approved, pre-implementation
**Owner files:** `.claude/skills/image-generation/scripts/forge.py`,
`channels/the-second-take/visual-kit/style-bible.md`, `.claude/skills/image-generation/SKILL.md`
**Untouched (deliberately):** `visual-prompt-writer/*` (composition/fidelity are fine — this is identity/rig
only); the shots schema; the fidelity + style review agents; `forge.py diff`/`crop` (stay dormant — no
objective gate re-added this pass).

## Problem

A fresh review of the `_chain-test` v2 slice surfaced identity/rig drift the current single batched review
let through: **five-finger hands (shots 17–19)** and **characters straying from their canonical base** in
busy composed scenes. Fidelity and style were NOT the failures — this is narrowly the identity/rig axis.

Root cause, read from the actual flow (not asserted as a discipline failure):

1. **The per-character identity-hold is soft prose, and it is missing exactly where drift is worst.**
   Composed scenes (technique (b)) generate with `--mode environment`, so `forge.py` auto-prepends only the
   **style-only §2b descriptor** — never the §2 identity descriptor. The "keep each seeded character EXACTLY
   as its reference: round head, no nose, no ears, four-digit hands" assertion is therefore **manual delta
   text an operator must remember**, precisely in the busy multi-figure scenes where §3 already warns "the
   rig drifts most." When it is forgotten, nothing regenerates it — the seed prior alone carries identity,
   and in a crowded composition it loses.
2. **The identity review agent is omission-permissive.** Its charter says "flag if you notice drift," so it
   can wave a frame through by silence — which is how noses (L18) and five-finger hands (L19) shipped.

**Deliberate constraint (this system was slimmed 2026-07-09):** the per-image rig grind, per-batch scene
gate, per-delta diff-gate, and crop-and-count were removed on purpose (~30 min/slice, self-contradiction).
This pass **re-adds teeth without re-inflating that grind** — the user chose the lightest option: prevention
+ a sharper single agent, and **no objective gate (`diff`/`crop`) re-wired.**

## Principle

- **Prevention over detection.** The cheapest, highest-leverage fix is a generation-side prior, not more
  review. §8 already proves drift is fought with an explicit hold/anti-realism clause + the seed path, not
  by looking harder afterward.
- **Fingers ride general adherence — they are not a separate gate.** Every canonical base pose/expression is
  already four-digit-correct, so "hold the seed harder" *is* the finger fix. The four-digit hand is named in
  the hold clause and the review verdict as one invariant among the rest, never carved out as its own
  mechanism.
- **Surgical to identity/rig.** No change to composition, fidelity, or style — those did not fail.
- **No new prohibitions, no new step, no new field.** Move 1 is a positive generation-side default; Move 2
  sharpens an existing critic's *verdict format*, not its rule count. (Consistent with
  `fix-generation-not-prohibitions`.)

## Changes (each concept, one home)

### Move 1 — Prevention: auto-apply the EXISTING rig-invariant hold text on any character-bearing gen

**This is not new doctrine.** The identity-hold instruction already exists in the bible — §2's invariant
list, §2b's "for a new character, add… round head, no nose, no ears, 3+1 hands" clause, and the §3
checklist. The gap is purely **mechanical**: `forge.py::prompt_for` prepends the identity descriptor (§2)
only for `mode=identity`; composed scenes run `mode=environment`, which prepends only the **style-only**
§2b paragraph — so on exactly the busy multi-character scenes where the rig drifts, the rig-invariant hold
text is **never attached** (the SKILL tells the operator to hand-type it, which is what gets forgotten).

The fix reuses that existing text; the only new artifact is a small **extractable** home for the rig-only
subset (so `forge.py::blockquote_after` can pull it):

- **`style-bible.md` — make the rig-invariant hold text an extractable blockquote.** §2 cannot be reused
  verbatim because it hard-codes the *base's* specifics ("SAME bald, SAME cream `#f5ead6`") — wrong for a
  cast member (MacGregor is `#d9ac82` + hair + hussar coat). So carve the **rig-only subset** — round
  near-circle head · no nose · no ears · **four-digit hand (three fingers + a thumb)** · even `#241a12`
  outline · flat cel — into a dedicated blockquote (reusing §2b's already-written family-form words, not
  new prose), holding ONLY the rig, never costume/pose/expression/tone. Prefer restructuring §2b's existing
  "add:" clause into this extractable block over inventing a parallel §2c with duplicate wording — **no
  duplicated invariant text across §2/§2b/§3/the new block; each states its slice once.**
- **`forge.py` — attach that block whenever the gen is character-bearing.** In `cmd_gen`/`prompt_for`, when
  a resolved seed is a character canonical (path under `refs/<char>/`, `char != env`, or a video
  `assets/library/`), append the rig-hold block after the delta. This makes the identity-hold automatic on
  technique (b) composed scenes and (d) single-character shots — closing the "operator forgot the manual
  assertion" hole at zero review cost.
  - **Chain-delta edge (technique (e)):** a delta frame seeds off the *prior scene output*
    (`assets/scenes/<prev>.png`), which will not match the `refs/<char>/` path test. So character-bearing
    chain deltas need the clause too, via an **explicit signal** — the plan decides the exact mechanism
    (e.g. a `--hold-identity` flag the skill sets on chain deltas, or a `hold_identity: true` batch-item
    key). Default-on-by-path for canonical seeds; explicit for chain deltas. The requirement is: **every
    character-bearing gen gets the hold clause; no character-bearing gen relies on remembered prose.**
- **`image-generation/SKILL.md` — update the technique-(b) prompt-assembly note** to state the hold clause
  is now auto-applied by the engine (remove the instruction to hand-type "keep each seeded character
  EXACTLY as in its reference…" — it is no longer manual), and document the chain-delta signal.

### Move 2 — Detection: give the identity agent a forced per-frame verdict (same agent, same cost)

- **`image-generation/SKILL.md`, "Reviewing the batch" §1 (Identity/rig)** — change the charter from
  "flag if you notice drift" to a **forced ruling on every seeded frame**: an explicit PASS/FAIL on each
  invariant of a named shortlist — **round head · no nose · no ears · four-digit hand · pinned costume** —
  plus, for a chain-delta frame, one **held-set line** ("consistent with this stage's `base` frame?"). The
  agent may not stay silent on a seeded frame; it must rule per invariant, quoting the offending pixel when
  it fails. Everything else about the review is unchanged (still ONE batched pass, three concurrent agents,
  retry-≤2-then-flag, no re-review loop, no crops, judge-against-approved-canonical per §3).
- The shortlist is the *values* already in §3 (values-only checklist); §3 is unchanged — the SKILL owns the
  HOW (the verdict format), §3 owns the WHAT. No duplication.

## What this deliberately does NOT do

- **No `diff` HOLD/DRIFT gate re-wired** — chaining is tightened via Move 1 (hold clause on deltas) + Move 2
  (held-set verdict line) only. The tool stays dormant.
- **No hand crops / per-digit count re-added** — the human review of the final artifact board remains the
  final finger authority (`dont-self-certify-finger-counts`); Move 1 does the generation-side work.
- **No second review pass, no mandatory recheck loop** — explicitly the "super super tight" the user ruled
  out.
- **No VPW / composition / fidelity / style change** — those did not fail.

## Success criteria

- A character-bearing gen (composed scene, single-character shot, or chain delta) **always** carries the
  identity-hold clause without any operator remembering to type it — verifiable by reading the assembled
  prompt `forge.py` sends (the rig-hold block is present whenever a character seed is).
- The identity review returns a **per-invariant PASS/FAIL per seeded frame** (no silent pass), so a
  nose/ear/five-finger/costume drift cannot ship un-flagged by omission.
- A re-gen of the 17–19 hand-forward shots (and the straying frames) holds four digits + base adherence
  materially better than the v2 slice — judged at the human artifact board.
- Cross-file read confirms **one home per concept**: the rig-hold text in its one extractable block, its
  application in `forge.py`, the verdict format in the SKILL, the invariant values still only in §3, no
  invariant text duplicated across §2/§2b/§3/the block. No new prohibition, no new step, no new field.

## Testing / validation (separate, after the edits)

Re-gen only the affected `_chain-test` shots (17–19 + the straying frames) through the tightened path →
human artifact board → user verdict on adherence. **NOTE: `_chain-test/` is the audio terminal's active
test bed** — coordinate before touching it, or validate on a copy. This is the same slice whose gold
exemplar is still un-minted; a clean tightened re-gen could double as the exemplar candidate.
