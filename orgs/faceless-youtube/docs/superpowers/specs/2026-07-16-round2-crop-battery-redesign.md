# Poyais chunks 3–6 rework ROUND 2 — gen/verify file-logic redesign ("crop battery")

**Date:** 2026-07-16 · **Status:** APPROVED by Daniel (design gate, this date) · **Scope:** the
round-2 rework of the ~21-shot ledger in `docs/handoffs/2026-07-16-chunks36-rework-round2-pickup.md`,
PLUS the standing law changes it codifies into the image-generation skill + style bible.

## 1. Why round 1 failed (evidence-grounded diagnosis)

Round 1's stack (unit self-check → 3-axis fresh-eyes zoom review → fix unit with zoom "verification"
→ orchestrator stamps `verified:true`) passed ~20 frames Daniel immediately failed for ears / noses /
5–6 fingers / proportion. Manifest + code evidence identified **four** mechanisms:

1. **Fix passes seed off the defective frame.** Identity/de-nose passes seeded
   `[current defective scene + canonical]` — the defect lives in the *strongest* seed. The bible
   already documents the ~50% sticky-ear rate; round 1 stacked such passes anyway (L61's eye bags
   appeared *inside* an identity pass; L63's pass seeded `scenes/L63.png` — the off-rig frame itself).
2. **Seed dilution.** Rework gens carried 4–5 seeds (L86: env + L22 + L24 + base.png; L115: five).
   Each added seed weakens the rig prior; `base.png` thrown in as an Nth "rig anchor" pins nothing.
3. **The review layer was structurally blind, per its own doc.** Bible §3 banned hand crops and
   admitted model eye-counts are unreliable "even at zoom" — then the stack relied on prose zoom
   claims with no evidence artifact. Fix-round outputs were self-checked, never re-reviewed.
4. **Board compositor bug (display-only).** `build_board_rework36.py::composite_for()` read
   nonexistent `layer.cutout`/`layer.asset` fields; the engine's real resolution
   (`build_motion.py:179`) is `layer.reuse` else `cutouts/<sid>-<layer-id>.png`. Every plate+layers
   card in L48–L125 (11 cards) rendered bare — L78/L79/L80/L107 assets are intact on disk;
   **board fix only, no regen.**

## 2. Gen-side law (new — codify into image-generation Pass 2 + bible)

- **Seed cap ≤4 per gen:** character canonical + ONE pose primitive + ONE expression frame +
  (style anchor OR crowd exemplar, only when the shot needs it). A figure needing the base rig gets
  `base.png` as one of the ≤4 with the prompt authored around it — never as a diluting extra.
- **Regen-first:** a "way off rig" / multi-defect frame is regenerated FRESH from canonicals with a
  re-authored prompt. An identity/fix pass over a defective frame is banned as a rig fix. Targeted
  2-pass fixes survive ONLY where the human explicitly kept a composition, and every fix pass gets a
  **before/after crop diff on EVERY figure** (regression gate), not just the targeted one.
- **Crowd exemplar:** `refs/base/crowd-exemplar.png` — a human-gated crowd sample frame (5–6
  anonymous figures, EXACT squat base-rig proportion, dot eyes, one simple mouth, varied
  era-appropriate dress) — is seeded into **every crowd-bearing gen** as the crowd's rig anchor.
  This mechanizes Daniel's directive: *"Don't generate characters that aren't based on asset base
  poses"* for the one tier that can't seed per-figure.

## 3. Verify-side law (new — REPLACES bible §3's "no hand crops" clause)

Pipeline per generated frame (deterministic where possible, fresh-context where not):

1. **Localizer agent** returns per-figure bounding boxes (face + each visible hand) as structured
   JSON. Localization is far more reliable than judgment; the localizer never rules.
2. **`crop_battery.py`** (PIL, deterministic) executes the crops at 3–4× into per-shot contact
   sheets + individual crop files.
3. **A SEPARATE fresh judge agent** rules per-crop: structured PASS/FAIL per invariant (round head ·
   no nose · no ears · four-digit hand · proportion · identity-match), **crop file path cited as
   evidence per ruling**. Prose claims ("zoomed 3–4x, verified") are inadmissible.
4. **Regression diff:** any fix pass re-enters the battery on before AND after frames, all figures.
5. **Stamping:** generating agents never stamp; the orchestrator alone merges manifest entries, and
   only after the battery + fresh-eyes review pass. Round-1 `verified:true` stamps on ledger shots
   are **voided at P0**.
6. **Human board:** crop sheets embed on the artifact board (collapsible per card) — the human
   finger/ear gate stays final authority, now at seconds per shot.

Honest limit: a model judge still misreads cartoon hands sometimes even on crops. The battery raises
the floor (structured verdicts + evidence + human crop sheets); the real rig win is gen-side (§2).

## 4. Execution phases

- **P0 — hygiene (no gen):** void ledger `verified` stamps; fix the board compositor to mirror
  `build_motion.py` resolution; verify L107's authored "officer on the ground" fact vs the existing
  cutout. L78/L79/L80 = board-only.
- **P1 — tooling (no gen):** `crop_battery.py`, localizer/judge protocol briefs, board builder v2
  (composited layers + crop sheets).
- **P2 — crowd exemplar (~3 gens):** 2–3 candidates → **Daniel gates one** → `refs/base/
  crowd-exemplar.png`. Crowd-heavy ledger shots block on this.
- **P3 — rework units (Opus 4.8 agents; model stated in each log's first line, orchestrator-checked):**
  full regens L48, L61, L62, L63, L67, L68, L77, L81, L86→L87 (chain), L93, L103, L108, L109, L115,
  L116+L117 (soldiers seeded from ONE shared source so they match), L118, **L30 (released chunk 1,
  now in scope)**; chain-content fixes L95 (remove leftover chest) → L96 (re-delta off fixed L95,
  tents held); targeted fix-pass ONLY L114 (human kept framing) with full regression diff.
- **P4 — verify + ship:** full-batch crop battery + 3-axis fresh-eyes review → republish the board
  to the SAME artifact URL (all frames, composited layers, crop sheets, re-surfaced taste calls:
  serif hull/map lettering L53/L57/L62/L112 · L54 'LAW' label · L102 squatness · L108 plaque ·
  L77 palette · L75 CHILE readability) → STATUS + pickup + decisions.md updated; §2/§3 law changes
  codified (this approval is the §G human confirmation; FEEL re-gates on the board).

## 5. Budget & risks

~40–50 gens ≈ **$6–8** (exemplar ~3; regens ~35–45 incl. two-gen identity passes where scene-heavy
and the one-retry budget). Crop battery is local/free. Risks: judge-on-crop still imperfect (human
sheet is the backstop); crowd exemplar could fail its own gate (budgeted one re-roll round);
regen-first loses round-1 compositions Daniel didn't flag as liked (accepted — he flagged rig, and
superseded PNGs survive in `_superseded-2026-07-16/`).

## 6. Codification routing (§G-route)

- Bible **§2d**: crowd-exemplar seeding sentence. Bible **§3**: replace the "no hand crops /
  full-frame only" hand clause with the crop-battery law (evidence-cited per-crop rulings; human
  sheet final). Bible **§5/§8**: seed cap; fix-pass-never-seeds-a-defective-frame-for-rig.
- **image-generation SKILL.md**: Pass-2 seeding rule (cap, regen-first), review section (localizer →
  battery → judge, regression diff, orchestrator-only stamping).
- `knowledge/decisions.md`: dated entry, alternatives rejected (ensemble voting; crops-to-human-only;
  fix-pass-only).
