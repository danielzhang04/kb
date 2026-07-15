# Image-gen checking — slim to one batched category-review (design)

**Date:** 2026-07-09 · **Status:** approved, pre-implementation
**Owner files:** `.claude/skills/image-generation/SKILL.md`, `channels/the-second-take/visual-kit/style-bible.md`
**Out of scope:** the visual-prompt-writer pre-gen shot critic (`critics.md`, VPW Step 8 — a different, planning-time stage); `forge.py` (untouched).

## Problem

Running image-gen on the ~20-shot `_chain-test` slice took ~30 minutes, most of it spent
**re-checking images that were already fine.** Root causes, from reading the five governing docs:

1. **Three separate checking layers per run** — a per-image rig LOOK grind (open + eyeball every
   figure in every scene), a per-batch scene gate (taste + fidelity), and a per-delta held-set
   diff-gate — plus a hand-crop-and-count sub-procedure.
2. **A self-contradiction that makes the agent loop.** The finger check says, in the same docs,
   both "the human is the authority, don't grind a subagent through per-hand counting" AND "the gate
   mandates native-tile counting or a counting subagent." Facing the contradiction, an agent does
   both — crop, count, still unsure, re-verify. That is the re-checking-fine-images loop.
3. **Cross-file duplication that bred the contradiction.** The rig gate is fully specified in BOTH
   `image-generation/SKILL.md` (the "two gates" section) AND `style-bible.md` §3. The finger rule
   appears in ~4 places (both descriptors, the §3 gate, two change-log entries) and drifted into
   contradiction. Two sources of the same procedure must agree; they stopped agreeing.
4. **Finger-counting weight is archaeological, not principled.** Two real misses (2026-07-08,
   2026-07-09) each bolted a fix into whatever file was open (integrate-don't-append violated), so
   finger-counting accreted weight far out of proportion to its actual failure rate — even though the
   Pass-1 library is verified-accurate and seeded generation inherits identity from it.

**Quality target:** same output bar, far less time. Not a looser bar — remove the loop mechanics
(contradiction, duplication, three passes) so the pipeline stops re-litigating fine images.

## Principle

The **generation machine is already good and stays unchanged.** Identity is carried by seeding from
verified Pass-1 refs; finger correctness is baked into the prompt descriptor. So checking should be a
**batched, problem-hunting review** — let generation finish, then hunt the *categories* of real
failure once over the whole batch and regen only genuine defects — not a per-image checklist grind.

## Design

### 1. Generation — unchanged

The two-pass flow (Pass 1 locks recurring individual characters; Pass 2 composes each scene seeded
from them), the technique menu (a–e), model tiers (flash style-only / pro identity), and the §2/§2b
prompt descriptors — **including the "three fingers + a thumb / Mickey-Simpsons" finger enforcement**
— all stay exactly as they are. Finger correctness remains a *generation-side* prior (cheap, works),
never a check-side grind.

### 2. Checking — three gates collapse into ONE batched review stage

- Pass 2 generates **all** scenes first. **No per-image gating mid-run**, no per-delta diff-gate.
- Then **one review round**: **3 concurrent subagents**, each a single tight mandate over the whole
  batch of generated frames:
  - **Identity/rig** — every seeded character held its identity and is on-rig (round head, no nose,
    no ears, four-digit hands, correct pinned costume). **Absorbs the old held-set diff-gate** — drift
    across a chain is an identity failure and is judged by looking at the full frames, not a pixel
    diff. Judged against the channel's *approved canonical*, not an idealized rig. **No crops.**
  - **Fidelity** — the image asserts the shot's load-bearing facts (geography, orientation / who
    faces whom, gesture and highlight targets, casting/costume) and adds nothing that changes the
    read. Given each shot's `still_prompt` + `vo_text` (the full narrated span) + `beat`/`shot_class`.
  - **Style/taste** — on-recipe (flat-cel 2.5D, built-but-flat, marker-honest), reads as its beat and
    shot_class at a glance, not slop and not drifting toward the banned "detailed middle."
- Each subagent returns a **flagged list keyed by shot id** (defect in one sentence, quoting the
  offending prompt fact where relevant). The skill merges the three lists.

### 3. Retry-then-flag — no grind

For each flagged shot:
1. **Regen once**, folding the flag(s) into the delta.
2. The **skill self-checks only the flagged points** on the new frame (targeted and fast — NOT a
   re-spin of the 3 subagents).
3. **≤2 regen tries total.** If still flagged after 2, **keep the best frame, mark it `flagged` in the
   scenes manifest with the reason, and push it through.**

No technique-switch escalation ladder, no ~6-attempt cap, no re-spinning the review per retry.

### 4. The human gate = the final artifact

A single Artifact review link of the **full images** (the human can't see them inline), with **flagged
frames marked and their reason shown.** This is the authority — not any per-image agent verdict.
**No hand crops** are produced or published, ever.

## Doc rebuild (rebuild-in-place, cross-file, no append / no leftover)

This is a `curate-doc`-discipline rebuild: map every genuine learning, rewrite each affected section
structured-by-concern, and **delete superseded content across all files** — no dated log-blocks, no
orphaned old rules, no "fixed here but left the contradiction there."

- **`image-generation/SKILL.md`** — owns the **mechanism** (portable to any channel). The "two gates
  / diff gate / crop procedure / retry-budget-with-switch" prose is **replaced**, not amended, by: the
  one batched 3-agent review + retry-2-then-flag + the flagged-artifact report. Tighten any
  generation-flow duplication encountered while in there; do NOT rewrite the (validated) gen flow.
- **`style-bible.md`** — §3 shrinks to a **flat channel-invariant checklist (values only, no
  procedure)**: what "on-rig for The Second Take" means. The finger *procedure*, crop instructions, and
  the stacked/contradictory change-log entries **consolidate into single clean statements**. §2/§2b
  descriptors (the prompt-side finger enforcement) stay untouched. §0's "verify every output" step and
  §8's verify-loop language reconcile to the single new gate.
- **`forge.py`** — untouched. `crop`/`diff` stay in the code as available tools; the flow just stops
  mandating them.
- **Cross-file consistency sweep** — the finger rule, the rig-gate definition, and the "verify" language
  must each say ONE consistent thing in ONE governing place, everywhere they appear (§0, §3, §8, the
  change-log, and this skill's report section). Verify no contradiction survives.

## Non-goals

- No change to generation quality, the two-pass architecture, model tiers, or the descriptors.
- No change to the VPW pre-gen shot critic (separate stage).
- Not a looser quality bar — the human artifact review remains the final gate; we removed *redundant
  automated re-checking*, not the standard.

## Success criteria

- A full `_chain-test`-scale run (~20 shots) spends materially less time in checking, with no
  re-checking of already-fine images.
- The finger rule, rig gate, and "verify" instruction each exist in exactly one governing location;
  no surviving contradiction across the files.
- Genuine defects (identity drift, wrong facts, off-style) are still caught and regenerated; residual
  defects after ≤2 tries are flagged and surfaced in the artifact rather than silently shipped or
  ground on indefinitely.
