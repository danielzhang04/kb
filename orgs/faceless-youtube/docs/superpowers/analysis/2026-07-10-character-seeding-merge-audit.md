# Character seeding / merge — design audit (2026-07-10)

**Status:** analysis only — no changes made. Two independent auditors (mechanism + architecture) run in
parallel on the governing files; they **converged**. This doc is the finding; the DECISION (which fix) is
open, for Daniel. Triggered by the `_chain-test` L17 handshake runs exposing repeated seeding failures.

## The goal (what a good solution must do)
Render a **growing cast** of cartoon characters, **on-model**, across **many videos**, **cheaply** and
**reproducibly** — the channel's moat is a locked visual signature. Five required properties: (1) portable
identity, (2) composable pose+expression, (3) **on-tone / on-rig by construction** (no human correcting each
frame), (4) cheap+reproducible (on-model by attempt 1–2), (5) cast-scaling (character N+1 ≈ constant effort).

## Observed failures (this session)
Bald strip (patched), **skin-tone reverts to base cream** (unpatched), blank face on a weak seed, wrong-hand
handshake, figures not turned toward each other, hand-tone bleed (patched).

## Root cause (both auditors, independently)
The **posed-character merge (Pass 1b) and interactions stack a BALD + CREAM + NEUTRAL base-derived primitive**
(`pose_ref`, `expression_ref`, or a blank interaction template) **alongside the character canonical**, then use
**prose to route features** ("hair/tone from the CHARACTER ref; only mouth/eyes from the EXPRESSION ref"). But:

- **The API carries no per-image role, mask, or weight** — `forge.py:210` sends `[<img1>,<img2>,<img3>,{text}]`;
  every seed is an un-labelled blob, the delta never cites image position. The engine
  (`gemini-3-pro-image`) does **holistic blending, not slot-wise feature routing** — it has no operator to
  take scalp pixels from image 1 and jaw pixels from image 3.
- So base traits get fed in as a **majority vote**: an expression merge stacks **2 bald/cream/neutral seeds
  against 1 character canonical**. Two-thirds of the image conditioning says "bald, cream, blank-faced,
  front-facing." One line of prose tries to overturn that doubled pixel prior. The model obeys the majority →
  bald, cream tone, blank face, front orientation. Every failure is this one mechanism (or its seed-strength
  variant when the character seed is weak).

**The correlation that IS the diagnosis:** everything that WORKS shares one shape — *single dominant seed + a
small worded delta* (anchored iteration §8, the ≤3-hop delta-chain ~10× less drift, new-character creation, the
4-digit descriptor prior). Everything that FAILS is *balanced multi-seed + prose routing* (the merge, and worst
of all the 4–5-image interaction template). The tool rewards dominant-seed+delta; the merge bets on the shape
the tool doesn't support.

**"Character-agnostic primitive" is partly a fiction:** the primitive PNG carries a bald scalp + cream tone + a
face — all wrong for every non-base character — injected *by construction*. And the reuse it optimizes for
barely materializes at this cast size (few recurring leads; one-shot extras get no library slot), so a pose PNG
is reused only across one lead's own shots — which anchored iteration off that lead achieves anyway, without a
bald seed in the pot.

## Two sharp specific bugs
1. **`head_tone` is dead data at gen time.** It's stored (`registry.json` MacGregor `#d9ac82`) but **never read
   by `forge.py`**. Worse, the §2 LOCKED descriptor hard-codes **"SAME flat cream head colour (#f5ead6)"** as an
   INVARIANT and prepends it to **every** identity-mode gen — so the pipeline fights a tan character's real tone
   **even in the clean single-seed path**. Deterministically fixable.
2. **The protective clauses now contradict each other.** "hands from the POSE reference" vs the auto-appended
   §2c "SAME three-fingers-plus-thumb hands" (a redraw) = exactly the wrong-hand handshake. This is the
   `fix-generation-not-prohibitions` anti-pattern: an unbounded, diverging pile of self-checked prose rules;
   `retry-2-then-flag` means a *systematic* merge failure ships labeled, not fixed.

## What is sound (keep)
Single-canonical identity carry; the ≤3-hop delta-chain (drift-tested); the **4-digit hand as a
descriptor-level prior**; the **neutral-face rule in principle** (expression as an orthogonal axis — its intent
survives as a worded delta); the two-pass macro-structure; VPW's intent authoring + the `cast`-order slot
convention; the JPEG→PNG / `validate_png` / `place` / `manifest` I/O hardening. **The bones are good — one
cracked beam:** "compose a character by blending it with a bald generic primitive and routing features in prose."

## Recommendation (converged) — smallest change that kills the whole class
1. **Single-dominant-seed doctrine.** Resolve `pose_ref`/`expression_ref` as **worded deltas on the character's
   OWN canonical** (single-seed anchored iteration). **No bald primitive ever enters a character generation.**
   Cache per-character variant frames for heavy leads (A1); just-in-time words for light use (A2). VPW is
   unchanged — only *how image-gen resolves the slug* changes (slug → words on the character seed, not a
   competing image). The base pose/expression PNGs **demote to a phrasebook + human visual dictionary + the
   new-character seed** (still single-seed).
2. **Deterministic head-tone enforcement** (`forge.py tone-check` / `tone-fix` vs the registry hex; flat-cel
   makes the head region a near-constant color → measurable/fillable). Template §2's cream FROM `head_tone`
   instead of a literal. Fixes the tone class as a measured gate, not a prayer. **Worth doing regardless of the
   bigger decision.**
3. **Move two-figure contact interactions OFF the merge to the Remotion compositing layer** — "turned toward
   each other" + "right-to-right clasp" are **layout** problems, not generation problems. Interim: seed the two
   character canonicals only (no blank template), contact in words.

**This is a mechanism swap inside ONE skill** (image-gen's slug resolution) — invisible to VPW, render-builder,
and the schema.

## Honest caveats (Claude's, not the auditors')
- **The worded-pose-fidelity risk is real and under-tested.** The recommendation trades base-bleed for reliance
  on WORDS for body pose — and style-bible §8 itself warns worded deltas can be weak for hard gestures (open
  hands, big rotations). This needs a dogfood before fully committing (A1 cached sheets are the fallback for
  exactly those poses).
- **This reframes, but doesn't waste, this session's asset-base build.** The 19 primitives become the
  vocabulary + iteration seeds + human dictionary, not direct scene seeds. The interaction templates' value
  moves largely to compositing.
- **The merge is not 100% broken** — it worked in the clean staged case (the MacGregor+banker validation). It
  fails *under load* (weak seeds, many competing seeds, tone). So a pragmatic middle path exists: enforce
  clean-portrait seeds + staged order + deterministic tone-fix, and measure whether that's "reliable enough"
  before the full pivot.

## Open decision (Daniel)
- **A — Cheap fixes now, defer the pivot:** deterministic tone-fix + fix the §2 cream bug + a hard
  clean-portrait-seed rule; dogfood whether that makes the merge reliable enough. Lowest risk/effort.
- **B — Commit to the single-dominant-seed redesign** (brainstorm → spec → plan): the structural fix; validate
  the worded-pose risk first.
- **C — Both:** cheap fixes now AND open the redesign spec in parallel.
