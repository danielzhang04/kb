# Crowd expression + restaging restoration — design

**Date:** 2026-08-06 · **Video:** `channels/the-second-take/videos/2026-07-28-bricks-fresh` ·
**Status:** Daniel-approved in session (boss terminal), supersedes nothing — first spec of this wave.
**Trigger:** Daniel's review of the Phase-6B first tenth (18/25 verified): crowd faces uniformly
indifferent, L07/L19/L20 off-rig or drained of comedy, shots reading literal/boring, delta chains too
long.

## Problem — measured, not assumed

1. **Crowd emotion was structurally starved, never explicitly blocked.** The poyais-era mechanism was
   plain emotion words in prompt prose ("smiling settlers", "hopeful families") — 60% of poyais
   crowd-ish shots carried one (25/42). Two later edits killed the channel without targeting it:
   - VPW figures-declaration overhaul (`2ede5f2`): "Never describe body pose, finger mechanics, or
     facial expression in words — naming the asset IS the authoring act." Written for cast identity
     discipline; registry expression slugs are all cast-tier (`character: base`), a crowd is a bare
     `"crowd": true`, so crowds lost their only expression channel. Authored crowd-emotion density:
     poyais 60% → old bricks file 36% → current file 10%.
   - §2d anti-individuation hardening (`aa576b9`): "identical simplified face … without exception"
     — correct against the individuated-face drift (the L07 defect), but with no authored emotion
     anywhere in the prompt the model defaults every mouth to neutral.
   The style-bible was never the blocker: §2d has allowed "one simple mouth (neutral / smile /
   downturn)" verbatim since the poyais era.
2. **The round-3 re-authoring drained comedy beats.** Old L19 (hero raking money, full rig, grin) and
   old L20 (deadpan gold-rush merchant) became crowd wides with an UNMANNED rake. The joke lived in a
   hero's face; the restaging deleted the actor. Both archived frames measure IN the current era
   register (ink 14.7°/+17.8 and 14.5°/+35.1, WARM; sat 0.26/0.48; 2K).
3. **Literal/boring drift.** Delta shots are literalism by construction ("the same frame plus one
   literal change" — 46 of 248 shots); the grammar's non-literal invention bar (§1 rule 2) has no
   compliance measurement; hero stagings became coverage wides.
4. **Delta chains too long — a boredom problem, not (per Daniel) a degradation one.** Current file:
   stage runs of 4 consecutive shots ×3 (base + 3 deltas, the existing cap's maximum), runs of 3 ×3.

## Changes (all restorations or single-number edits — NO new mechanisms)

### 1. Archive restore — L19/L20/L21 (this video, $0)
- `assets/_archive-pre-reset/scenes/L19.png` → serves slots **L19 and L20** (held still across both
  beats; VO "…were quietly / raking it in. They were" plays over the hero mid-rake).
- `assets/_archive-pre-reset/scenes/L20.png` → serves slot **L21** (gold rush).
- Current L19/L20/L21 frames archived per convention (move, never overwrite in place).
- Manifest entries rewritten via the sanctioned path: provenance notes name the archive source and
  Daniel's ruling (R5 archive-restore precedent); `stamp_review.py` remains the only verdict writer.
- Logged in `knowledge/decisions.md` (F-log). No chain impact: L22–25 seed off the L03 plate.
- 2K→1K: downscale at render; R2 precedent accepted 1K for this video.

### 2. Crowd expression/pose restoration (VPW skill, one clause)
- `visual-prompt-writer/SKILL.md` rule 3: the "Never describe body pose, finger mechanics, or facial
  expression in words" ban is **re-scoped to cast/seeded (registry-backed) figures** — its original
  purpose. Crowd figures return to plain scene prose: simple beat-fit expressions ("grinning",
  "worried", "deadpan") and whole-body group attitudes, exactly the poyais mechanism.
- **NO new bound/vocabulary/field.** The rig text + tiny scale is what kept crowds simple in the
  poyais era; the §2d rig-FAIL hardening already guards face individuation. (Daniel explicitly
  rejected a codified simplicity bound and a declared `crowd_mood` mechanism.)
- **§2d untouched.** Open risk: the "identical face without exception" hardening postdates poyais and
  may flatten authored emotion. Resolved empirically, not by pre-editing doctrine: the **L07 re-mint
  is the canary** ("eager grinning buyers"). Emotion survives → done. Flattens → one-phrase §2d
  clarification ("the scene's beat picks which, identical across the group") as a measured follow-up.
- Cast rules unchanged: ≤2 seeded figures per shot, 2–3 hair/headwear silhouettes, individuated
  crowd face = rig FAIL, §2d forge-expanded (never pasted), lint clause-fingerprint guard intact.

### 3. Crowd exemplar re-pick (merged with mechanism-queue item P5(e))
- Current exemplar carries a diegetic '1983' tent card (bled into L06) and models neutral faces.
- Re-pick/re-crop: content-free (no diegetic text/props) + livelier on-rig faces. One asset swap via
  the forge/registry path — never a hand edit.
- L07/L08 re-mint happens only after §2 + §3 land, so they inherit both fixes.

### 4. Delta-chain cap ≤3 → ≤2 (single number, existing homes)
- `visual-kit/visual-grammar.md` §1 chain logic: "≤3 deltas" → "≤2 deltas, then a re-base or a hard
  cut".
- `visual-prompt-writer/scripts/lint_shots.py` stage_check (`deltas > 3` → `> 2`, message text).
- `test_stage_check.py` pins updated (base + 2 passes clean; base + 3 HARD).
- shots-schema delta-chain contract wording wherever it states the number.
- Driver is variety/boredom, NOT pixel degradation — no forge parent-depth refusal is added; the
  verifier's standing re-base-over-extend practice covers degradation.
- Existing quads (3, incl. L22–25) become violations → routed to the audit fix-list, not hot-patched.

### 5. Authoring audit (read-only; BLOCKS Phase 6c)
One worker pass over the full 248-shot file vs the old 214-shot file, four lenses:
1. **Comedy drain** — every idiom-pun / ironic-counterpoint / comedy beat: hero actor retained? joke
   staged or deleted? (L19/L20/L21 class.)
2. **Literalism score** — per shot: literal-restatement vs invented staging, against grammar §1
   rule 2's own bar; flag boring stretches.
3. **Run lengths** — all stage runs > 3 consecutive shots (and the 3 quads now over the new cap) with
   a restage/split proposal each.
4. **Missing crowd emotion** — crowd beats whose energy lives in the VO but not the prompt.
Output: audit report + a concrete shots.json restage fix-list → **Daniel gates** → apply → then 6c.

### 6. Seeded performer tier (`decisions.md` 2026-08-06 ruling (4); design LOCKED by Daniel same day)
- The two-tier authoring law (NAMED CAST | CROWD) becomes THREE tiers: **named registry cast** ·
  **seeded performer** (the anonymous but story-bearing individual) · **background crowd**.
- A shot wanting a foreground performer MINTS it first: one STEP-1 card off the `base` rig wearing THAT
  scene's era costume and THAT beat's `expr-`/`action-` cards, rig-checked at card cost; the scene then
  seeds that card, two-step, exactly as named cast does. **Attribute-routing law:** any attribute not
  carried by the figure's own seed bleeds a base trait, so costume and expression live IN the card, never
  as loose prose over a bare `base`. The base template never renders as itself — `forge.py` refuses a
  bare-`base` slate by name.
- Cards are recorded in the VIDEO's own Pass-1 library for same-costume reuse; a performer enters
  `registry.json` only where the character genuinely recurs.
- The foreground cap's VALUE is unchanged at 2; its SCOPE widens from named cast to any seeded figure
  (2 named cast, or 1 named cast + the shot's one seeded performer, or the performer alone — capped at
  ONE seeded performer per shot; a second `` `base` `` casting is hard-refused, not a legal "2 performers"
  shape). Crowd stays uncapped and background-only.
- Homes: `visual-grammar.md` §2 (tier law, cap table), `style-bible.md` §1, `image-generation/SKILL.md`,
  `visual-prompt-writer/SKILL.md`, `shots-schema.md`, `critics.md`, plus `forge.py`/`lint_shots.py`, which
  both read `` `base` `` as a seeded figure.
- **Engine work — CLOSED 2026-08-06.** `forge.py` now authors the era costume INTO the card
  (`costume_clause` reads the opening era sentence plus the sentence naming the figure, control tokens and
  quoted literals stripped, into `figure_card_payload`) and keys a performer's card on that dress
  (`fig-base--<pose>--<expr>--<place>-<dress digest>`) — the same source a place plate takes its era from,
  on a key that shares a card only where the authored dress is identical. Named cast keys are unchanged:
  their costume is pinned in their canonical. The dated gate in `visual-grammar.md` §2 is deleted.

## Sequencing
1 (restore) and 5 (audit) run in parallel now; 2+4 are one doctrine-window task (doc + lint + tests
green); 3 follows; L07 canary re-mint after 2+3; P1/P3 rulings still owed by Daniel at the standing
board; P4 likely superseded if the audit restages L22–25 under the new cap.

## Non-goals
- No `crowd_mood` field, no crowd expression vocabulary, no pose-simplicity rulebook.
- No §2d edit in this wave (canary-gated follow-up only).
- No forge chain-depth enforcement.
- No re-mint of the restored L19/L20/L21 (restore-as-is was ruled; re-mint only if a later render
  slice shows a visible clash).
- No change to the foreground cap's VALUE (2) or to the seeding law's mechanism. The two-tier authoring
  law itself IS changed — see change 6: three tiers, cap scope widened from named cast to any seeded
  figure. (This non-goal read "no change to cast caps, seeding law, or the two-tier authoring law" until
  ruling (4) of the same day authorised the performer tier.)

## Acceptance
- Restored frames in `assets/scenes/` with honest manifest provenance + stamps; decisions.md entry.
- VPW rule-3 edit + cap edits land with the full VPW test suite green; lint HARD-fails a base+3 chain.
- New crowd exemplar registered; forge dry-run resolves it.
- L07 canary: crowd renders beat-fit expression while holding the rig (fresh-eyes verified).
- Audit report + fix-list delivered and gated by Daniel before any 6c generation spend.
