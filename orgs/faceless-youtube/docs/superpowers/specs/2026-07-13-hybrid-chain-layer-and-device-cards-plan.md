# Hybrid chain+layer + selective device cards — implementation plan

**Date:** 2026-07-13 · **Status:** plan, awaiting approval to execute
**Follows:** `2026-07-13-pipeline-chain-layer-nonliteral-test-design.md` (the act-1 pipeline test that surfaced these gaps)

## The unifying idea

A delta's `changed_elements` is *"what's new in this shot."* motion-planner already decides, for
non-chain shots, whether a new element is a **separable animated layer** or **baked into the scene**.
Both fixes extend that *same* decision to cases it currently refuses:

- **(1)** a chain delta whose new element is a **discrete overlay** (a stamp/badge/flat element ON the
  frame — the FICTION stamp) → promote to a cutout `appear`/slide layer; the plate **reuses the prior
  chain scene**. An **integrated** accretion (a bank rising in the lit cityscape) stays baked (correct —
  it can't be cut as a clean layer).
- **(3)** a **payoff/emphasis number** VPW baked into a still → subtract it from the plate and promote it
  to an animated engine **card** (`counter`/`stat-card`). Incidental in-art numbers stay diegetic.

Neither is a special case bolted on; both **remove an over-broad prohibition** and replace it with the
real "is this element separable?" judgment.

## Grounding facts (verified in the code)

- `appear` is a valid **cutout** animation (`animation-menu.json`) — no menu change.
- `validate_plan` / `lint_motion_plan` already iterate `layers` for **any** shot and never reject a
  `delta-chain` shot that carries layers — **no validator change**.
- `apply_motion_plan` hardcodes `plate = f"plates/{sid}.png"` — the single build_motion change.
- The engine (`Video.tsx` → `LayerView`) already renders `plate` + cutout layers; `plate` is just a path
  — **no engine change**.
- VPW already casts both interaction figures + surfaces a missing interaction asset (SKILL.md:246-249) —
  **#2 needs no change** (one optional clarity nudge, below).

## (1) Hybrid overlay — the changes

**a. `motion-planner/references/animation-rules.md` — change the actual rule (not append a caveat).**
The "Never layer" bullet currently reads *"A seamless integrated accretion (city→+bank→+cathedral) →
stays a baked delta-chain."* Rewrite it to split the two cases:
> - A chain delta that adds a **seamless INTEGRATED** element (perspective/lit — a bank in the cityscape,
>   a farm bursting, gold rivers) → stays a baked `delta-chain`. It cannot be cut as a clean layer.
> - A chain delta that adds a **discrete OVERLAY** (a flat element sitting ON the frame — a stamp, a
>   "SOLD" mark, a badge) → a **hybrid**: the plate **reuses the prior chain scene**
>   (`scenes/<prior-in-stage-id>.png`), and the overlay is an `appear`/slide **cutout** layer. (The
>   existing "thing lands/stamps on top → `appear`" rule fires here too — a chain frame is no exception.)

Extend the **Decomposition** section: for a hybrid, there is **no `plate_prompt`** — the plate is the
prior scene, reused; only `cutout_prompt` (the overlay alone) is authored.

**b. `motion-planner/SKILL.md` procedure (step 2).** *"A `delta-chain` (shared `stage`/`stage_role`)
passes through untouched (never decomposed)."* → *"…passes through untouched **unless its delta adds a
discrete overlay** — then it becomes a hybrid (prior-scene plate + an `appear`/slide cutout; see
animation-rules)."* One sentence, the real logic.

**c. `render-builder/references/shots-motion-schema.md`.** Document the hybrid shape (the validator
already permits it): a `delta-chain` shot MAY carry `layers`, and then `background.plate` =
`scenes/<prior-in-stage-id>.png` (the reused prior frame — no new plate gen). Add the one-line example.

**d. `image-generation/SKILL.md` (Pass-2 / technique (e)).** For a shot the motion plan marks as a
delta-chain **with a cutout layer**: do **not** bake a full delta scene. The plate is the prior in-stage
scene (already materialized — reuse it, zero gen); generate **only** the overlay `cutout_prompt` on a
plain plate → `forge cutout` → `cutouts/<id>-<layer>.png`. (Net *less* generation than baking the delta.)
Edge case to state once: a hybrid overlay delta produces **no baked composite**, so if a *later* delta in
the same stage exists, it seeds the **prior baked frame** (the plate), not the overlay — in practice a
hybrid overlay is the terminal beat of its stage (e.g. the FICTION stamp ends `promise-unmasked`).

**e. `render-builder/scripts/build_motion.py` (`apply_motion_plan`).** Replace the hardcoded
`plate_rel = f"plates/{sid}.png"` with `plate_rel = (entry.get("background") or {}).get("plate") or
f"plates/{sid}.png"` — so a hybrid's plan-specified `background.plate` (the prior scene) is honored, and
plain layered shots still default to their generated plate. The existing missing-asset / `--allow-missing`
handling is unchanged (a hybrid's plate = the prior scene, which exists once the chain is materialized).
Add a `test_motion_plan_merge.py` case locking the plate-override.

## (3) Selective device cards — the changes

**a. `motion-planner/references/animation-rules.md` — the subtraction rule.** Currently *"never card a
number/term/text the still already depicts."* Rewrite to allow selective promotion:
> A **payoff/emphasis number** — one the narration lands on as a reveal or a gut-punch (a headline sum, a
> shocking count) — MAY be promoted to a `counter` (climbs) or `stat-card` (lands). When promoted,
> **subtract it from the plate** so it is not double-drawn — but the plate must still render a
> **complete, natural object** (a deed / map / ledger that reads as *whole*); the number's absence must
> **never leave a conspicuous blank slot** (no one holds a blank page). The `plate_prompt` composes the
> region so the missing figure isn't a hole, and the card supplies the real figure over it, anchored to
> the VO words where it's spoken. **Incidental** in-art numbers (dates, page counts, quantities that are
> scenery not payload) stay diegetic — do not card them.

This also fixes the Tier-1 **finding #7** (engine-only device-card shots double-drawing a baked number):
a carded number is now always subtracted from its plate.

**b. The criterion — ONE open decision for the human (this is the "which numbers" fork).** Proposed
default, to confirm/tune: card a number when **all** hold — (i) it is a *quantity that is the point of the
sentence* (the sum defrauded, the death toll, the acreage), not a date/label; (ii) the narration
*emphasizes* it (a reveal, a "…and it was £200,000", a climb); (iii) at most **~1 card per ~30-45s** (the
measured device cadence — cards are spice). Everything else stays diegetic. `motion-planner`'s human gate
still shows every proposed card for approval before image-gen.

No schema/menu/engine change for (3) — `counter`/`stat-card` engine layers already exist and render; this
is purely the ruleset flip + the subtraction it triggers.

## (2) Interaction — no change (optional one-line nudge)

VPW already does what was intended. **Optional:** one clause in VPW's cast rule making explicit that a
cast figure *need not be a pre-registered channel character* — a one-off named figure earns its canonical
in image-gen Pass 1 — so a fresh-slug run doesn't misread "only macgregor is registered" as "describe the
others in prose." Include only if it reads cleanly; skip if it risks bloat.

## File-editing discipline (the traps to avoid)

- **Change logic, don't append don'ts.** Each edit *replaces* the over-broad rule with the real decision —
  no "BUT NOTE…" riders stacked under the old rule.
- **Cross-file alignment.** The hybrid shape is defined once in the schema doc; animation-rules, the SKILLs,
  and build_motion all *refer to that one shape* (prior-scene plate + overlay cutout) with identical wording
  ("discrete overlay" vs "integrated accretion"). No divergent vocabularies.
- **No redundancy.** The "discrete overlay vs integrated" test lives in animation-rules (the ruleset);
  other files point to it, they don't restate the criterion.
- **Derived stays derived.** shots.motion.json is still 100% derived by motion-planner; no hand-authoring.

## Test plan

1. **Re-run motion-planner on `_act1-test`** (the existing slice) → verify **L07 (FICTION stamp) becomes a
   hybrid** (delta-chain + an `appear` cutout, plate = `scenes/L06.png`), the guidebook/promise fills
   **stay baked**, and lint passes (0 errors).
2. Verify motion-planner promotes **≥1 payoff number** to a card (e.g. £200,000 at L55, or 8M acres) with
   the number subtracted from that shot's plate; confirm the human-gate summary lists it.
3. `py -3 test_motion_plan_merge.py` — new case: a hybrid shot's `plate` resolves to `background.plate`
   (prior scene), not `plates/<id>.png`.
4. Re-generate the act-1 **plan board** artifact so the human sees L07 flip to a layer + the carded numbers.
   (Image-gen + render remain the NEXT step, after the plan is approved — not part of this change.)

## Out of scope

Running image-gen / render on act 1 (the next milestone, once this plan lands + the plan board is
re-approved); the full 125-shot video; any at_scene diegetic-text work (still deferred).
