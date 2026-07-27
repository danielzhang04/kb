# PICKUP — pose/expression seeding (two-step) + identity-adherence tightening (2026-07-10)

**Status: BUILT + committed + audited clean; NOT yet run end-to-end. PAUSED while Daniel rebuilds the
image/char library (poses/expressions) and works audio in parallel.** Resume this once the updated library is
in. Everything below is committed on `master` (docs/skills only — no library or audio files touched).

## TL;DR

Two infra workstreams shipped this session, both on the image pipeline:
1. **Identity/rig adherence tightening** — a calibrated re-add of teeth after the 2026-07-09 slim.
2. **Pose/expression seeding (the two-step character build)** — the BIG one: the channel's pose/expression
   library is now actually SEEDED into scene generation (it never was), which is the real fix for the
   5-finger-hand drift.

The mechanism is **validated in isolation** (see Findings); the **full pipeline has not run on a real video**
yet — that's the next step, and it's gated on the library rebuild (a real video will request poses the library
must have).

## Workstream 1 — identity/rig adherence tightening (DONE)

Spec/plan: `docs/superpowers/specs|plans/2026-07-10-image-gen-identity-adherence-tightening*`.
- **Prevention:** style-bible **§2c RIG-HOLD** block (form-only, identity-agnostic) that `forge.py`
  **auto-appends** to any character-bearing gen (seed under `refs/<char>/`, `assets/library/`, or
  `assets/scenes/`) on non-identity modes. Closed the "operator forgot the rig assertion" hole.
- **Detection:** the image-gen identity review is now a **forced PASS/FAIL per invariant per seeded frame**
  (round head · no nose · no ears · four-digit hand · pinned costume + held-set line), not "flag if noticed."
- **Honest limit proven:** even with all this, the review still MISSED a 5-finger hand + an ear on the
  `_chain-test` L17/L19 reruns — **Daniel caught them by eye.** LLM vision can't be trusted on digits;
  the human count from the full frame stays the backstop (`dont-self-certify-finger-counts`). No hand crops
  needed — Daniel reads fingers from the full frame.

## Workstream 2 — pose/expression seeding, the two-step build (DONE, the main event)

Spec: `docs/superpowers/specs/2026-07-10-pose-expression-seeding-two-step-design.md`
Plan: `docs/superpowers/plans/2026-07-10-pose-expression-seeding-two-step.md` (READ BOTH — they hold the detail).

**Root problem found:** the channel was built on "a pose/expression, built once, maps onto any character"
(style-bible §1/§3), and a library exists (18 expressions + 13 action poses on the base) — **but the pipeline
never seeded it.** Scene gen seeded only the character IDENTITY and drove pose/expression from WORDS in the
`still_prompt`, so the correct 4-digit library hand was thrown away and re-synthesized (→ the engine's
5-finger prior). Prompt text can't beat that prior (proven repeatedly).

**The fix — how the pipeline now works (once the library is ready):**
1. **VPW** authors the scene first, then **selects** each figure's `pose_ref`/`expression_ref` from the
   registry (mirrors how Step 4 casts characters) and records them on a per-shot **`cast`** array. The
   `still_prompt` no longer describes pose/hands/expression (single-home). If a needed pose/expression/
   interaction isn't in the registry, VPW lists it in **`needed_assets`** (`kind`+`slug`+`wants`+`why`) and
   **HARD-STOPS** — it does not proceed to generation.
2. **Human gate:** approve a surfaced asset → generate on the base + rig-gate + register; or **veto** →
   VPW restages that beat onto EXISTING assets only (convergence rule; no endless loop). Interactions are
   just `kind: interaction` — same path, no special-casing.
3. **image-gen Pass 0** generates any approved `needed_assets` on the base. **Pass 1a** locks character
   canonicals (unchanged). **Pass 1b** MERGES each `(character, pose_ref, expression_ref)` combo →
   `assets/library/<character>--<pose|none>--<expr|none>.png` (seed the 3 refs; binding delta;
   **hand-tone rule = hands in the character's tone, not the pose ref's**). **Pass 2** PLACES the
   posed-character (single-seed) into the scene + composes environment.

**Chaining note:** delta-chains seed the whole PRIOR FRAME (not per-character), so the base frame's hand
quality propagates through the chain — fix the base (via pose-seed) and the chain holds.

## Findings that this is built on (all validated with EXISTING assets, MacGregor + the King)

- **Seed [pose + identity] in one gen works** (identity from one ref, 4-digit pose/hands from the other).
- **3-seed [pose + expression + identity] works** too.
- **Two-step chosen** (merge posed-character → place in scene) over one-step — for **isolation +
  validate-before-spend**: the delicate binding is resolved in ONE reviewable merge before any scene gen;
  the scene gen is then a safe single-seed.
- **Hand-tone learning:** the pose seed drags the pose frame's SKIN TONE unless the delta forces hands =
  character tone. Canonical rule now in style-bible §5.
- **Generalizes to a 2nd character:** the Miskito-King merge (deeper tone + robe) held identity + pose +
  expression + hand-tone. So the mechanism is not MacGregor-specific — safe to build the library on it.

## Files changed (all committed on master)

- **Schema:** `.claude/skills/visual-prompt-writer/references/shots-schema.md` (+`cast`, +`needed_assets`).
- **Seed doctrine:** `channels/the-second-take/visual-kit/style-bible.md` §5 rewrite (two-step + hand-tone),
  §7 (poses = seed source), §8 (place posed-character), §2c (rig-hold, workstream 1), §10 log.
- **VPW:** `.claude/skills/visual-prompt-writer/SKILL.md` Step 5 (select refs) / Step 6 (scene-only) / the
  pose-expression gate / output-to-user stop.
- **image-gen:** `.claude/skills/image-generation/SKILL.md` Pass 0 / Pass 1b / Pass 2 / figure-index-reads-cast;
  `scripts/forge.py` + `scripts/test_forge_hold.py` (workstream 1; forge otherwise unchanged).
- **Channel grammar:** `channels/the-second-take/visual-kit/visual-grammar.md` (expression bullet → seeded
  `expression_ref`; the one alignment fix the cross-file audit caught).

## Resume here (next steps, in order)

1. **[GATED on the library rebuild]** Full **end-to-end validation** — run the real pipeline on one
   hand-forward shot: VPW emits `cast`/`needed_assets` → the gate → Pass 0/1b/2 → count hands + check tone
   on the full frame. This is the real proof the wiring works, not just the mechanism.
2. **Two-character INTERACTION merge** — the one "validate on first use" gap: seed `[interaction-pose frame +
   char A + char B]`, bind each identity to its position. Needs an interaction pose asset (part of the library
   rebuild). This is what fixes L17-type clasps.
3. **NOTED TODO — extend `lint_shots.py` to validate `cast` + `needed_assets`** (structure + resolution:
   `pose_ref`/`expression_ref` must resolve in the registry OR appear in `needed_assets`; `needed_assets`
   entries well-formed). Closes the contract gap the new fields opened (currently a bad ref fails mid-Pass-1b
   instead of at lint time). Small, TDD, mirrors `test_lint_beat_type.py`. Not built yet — Daniel deferred it.
4. **CLAUDE.md status block** is stale — it doesn't mention either workstream. Update it (self-maintain rule)
   — but it's collision-prone across terminals, so do it when no other terminal is in it.

## Warnings for the next terminal

- **Parallel terminals active** (Daniel on the char/image library + audio). **Stage explicit paths only;
  never `git add -A`; never rewrite history.**
- **`knowledge/decisions.md` was NOT touched** this session — it had another terminal's uncommitted edits at
  session start. The durable record of both workstreams is the style-bible **§10 log**. Add decisions.md
  lines only once that file is safe to stage.
- The `_chain-test/` tree + the visual-kit library/registry are Daniel's active rebuild surface — don't
  regenerate into them.
- Test scratch (pose-seed / 3-seed / King artifacts) is in this session's scratchpad (gone next session).
  Artifact boards (still live): `_chain-test` board `76cc981b-e1c4-4d00-a2c0-f1d96243aa50`; pose-seed test
  `2db86d77-11bd-4042-8dd7-37037a62c614`; one-step-vs-two-step `83af85ab-6518-4d75-9102-3d54894deaf4`;
  King merge `7c9ab589-4a24-4d5a-94cc-72a9a491a2f4`.
