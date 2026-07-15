# PICKUP — still-side visual rebuild: image-gen + render DONE; **awaiting user verdict**

**Updated 2026-07-09 (session 2). DELETE once the user gives verdict + Task 8 close-out lands.**
Everything durable from the rebuild is committed; this file carries only the session state a fresh
terminal needs to finish Task 7 Step 5 + Task 8.

## TL;DR
The still-side visual authoring rebuild (spec `docs/superpowers/specs/2026-07-08-still-side-visual-
authoring-rebuild-design.md`, plan `docs/superpowers/plans/2026-07-08-still-side-visual-authoring-
rebuild.md`) is implemented and validated end-to-end on `_chain-test`. Tasks 1–7 of 8 are DONE:
Task 7 Step 3 (image-gen) + Step 4 (render) both landed cleanly. **Only Step 5 (user verdict) +
Task 8 close-out remain.** The user's default MP4 player has been opened on the fresh cut; the
render board is republished at the same URL used across the rebuild.

## Committed in session 1 (2026-07-08, all on master)
- `2780dbb` spec · `344e1eb` plan
- `be03b73` `shots-schema.md` — motion_prompt/asset_type legacy-optional; Remotion mapping = contract
- `581ac50` VPW `SKILL.md` — full rebuild: Remotion-reality model, six authoring laws, mandatory Step 8 critic
- `78cc023` `visual-prompt-writer/references/critics.md` — pre-gen shot critic
- `e2687ae` `image-generation/SKILL.md` — scene gate = taste + prompt-fidelity; counting-scale verify; diegetic casting
- `41271a9` `visual-grammar.md` — staging law (tableau, expression-by-beat, eye-line, role legibility)
- `da0aa68` `style-bible.md` §3 (user-approved): counting-scale verify procedure
- `1259e5a` MacGregor canonical registered: red/gold hussar, ears removed, tan `#d9ac82`, costume pinned
- `dd6a65d` close-out logging: decisions.md + CLAUDE.md status (still-side rebuild)

## On disk, UNCOMMITTED (untracked scratch by design — DO NOT commit)
`channels/the-second-take/videos/_chain-test/`:
- `shots.json` — 16-shot plan (4 held stages), critic-edited, lint clean (from session 1)
- `assets/library/` (NEW) — 8 pass-1 library assets + `manifest.json` (bolivar, local-king,
  emigrant-family-planted, plate-harbour-dock, plate-poyais-poster, plate-spotlight-stage,
  plate-worldmap-parchment, plate-mosquito-coast). MacGregor reused from `refs/macgregor/`.
- `assets/scenes/` — 16 verified scene stills + `manifest.json`
- `assets/final.mp4` — 56.20s @ 1920×1080 30fps (~50 MB), rendered locally in 40.9s (~1.5× realtime)
- `assets/render.manifest.json`

## Pass 2 results (16/16 verified)
- **Techniques used:** 2 reuse-reframe (L03/L08), 5 seeded composition (L01/L02/L07/L10/L13),
  9 seeded delta-chain (L04–L06, L09, L11, L12, L14–L16). Every stage stayed under the ≤3-delta cap.
- **Identity holds:** MacGregor identity + pinned canonical outfit held across 9 appearances
  (including the diegetic-media prince inside L04's medallion, with authored prince-regalia costume
  override). Bolívar + local king pulled cleanly through delta chains.
- **On-artifact text VERBATIM:** "POYAIS" (L03–L06) + "8,000,000 ACRES" (L15/L16) both render
  legible on their host artifacts.
- **Critic-caught defects that HELD in the render:** map TRUE orientation (Americas left, Europe
  right); L02→L07 continuity (loss as absence, dock truly empty); world-flip decisive on L06 (full
  palette turn); no in-frame element pops the engine can't render.

## Soft notes flagged HONESTLY on the render board (all beat-preserving, none shot-killers)
1. **L01** — the emigrant family faces the viewer instead of profile-right. Beat still lands via
   pile + ship + horizon glow orientation.
2. **L04** — 5 promise medallions floated onto the wall AROUND the poster frame instead of
   clockwise INSIDE the vista border. Enumeration + prince-as-MacGregor reveal still legible.
3. **L13** — two-shot eye-lines don't fully converge (both figures face mostly forward). Deed
   presenting on L14 pulls the beat back into focus.
4. **L15** — unrolled deed lands as a chest-height banner between the two men rather than laid
   across the sand foreground. "8,000,000 ACRES" verbatim + tiny-cluster imbalance on L16 carry
   the beat.

## Motion side (free win)
The parallel motion-teardown terminal committed its grammar update between sessions 1 and 2. This
render picked it up automatically via `build_motion.py` (fixed POV unless motivated, overt arcs
only on peak beats, micro-drift floor, cards frozen, long-form burned captions OFF). **This 56s
slice is now also the 56s A/B validation of the measured motion grammar** — the named follow-up
from the teardown, satisfied incidentally.

## Session 2 rig-gate correction (worth carrying forward)
An overzealous first-pass rig gate flagged bolivar/local-king/emigrant-family for "jaw" and "mitten
hands" and queued regens. The user corrected: MacGregor's approved canonical shows the same mild
lower-face structure and same simplified 4-digit-implied hands. The bible §3 rule is "not five, not
six, not a mitten" — mittens meaning undifferentiated blobs, not the channel's simplified flat cel
hand. The three assets stand as generated. The regen batch was cancelled before firing (bolivar.png
was zero-byte truncated and restored from a scratchpad backup mid-call). **Learning:** the rig gate
must judge against the channel's approved level of flex, not against an idealized-pure-circle
straw man.

## Resume here (in order)
1. **[USER GATE — OPEN]** verdict on the fresh 56s cut. Render board (updated in place):
   https://claude.ai/code/artifact/5c652760-a2f6-437b-be7a-4caf5e908869 · MP4 opened locally
   (`channels/the-second-take/videos/_chain-test/assets/final.mp4`).
2. **PASS →** finish Task 8:
   - Step 3 disposition — delete this pickup file + note the artifact URL in `decisions.md` under
     the 2026-07-08 still-side entry (validation-complete addendum).
   - Update CLAUDE.md status: strike "Validation half-done" language, note the slice is validated
     end-to-end + the motion 56s A/B satisfied for free.
   - Commit **explicit paths only** — `docs/handoffs/2026-07-08-still-side-rebuild-pickup.md`
     (deletion), `knowledge/decisions.md`, `CLAUDE.md`. NEVER `git add -A`.
   - Fixture disposition = user's call: delete `channels/the-second-take/videos/_chain-test/` or
     keep it around as reference material.
3. **FAIL →** the finding routes to the responsible file, not this fixture:
   - Rig-gate over-strictness → `image-generation/SKILL.md` gate wording (already largely correct
     per the session-2 learning; if a specific miss surfaces, capture it there).
   - Compositional drift (L04 medallions outside frame; L13 eye-line; L15 deed placement) → these
     are seed-stochastic drifts on tight composition specs. If the user wants stricter enforcement,
     the escalation is either richer seed-frames (a "poster with medallions inside" library asset
     rather than a delta) or a rerun with the delta hardened. Do NOT hand-edit shots.json or
     silently re-run without approval.
   - Any authoring/law defect → the relevant skill file (VPW/visual-grammar/style-bible-§3).
   - Rebuild `assets/scenes/*` from `shots.json` + updated skills; do not rebuild `shots.json`
     without cause.

## Warnings for the next terminal
- **Parallel motion-teardown session's territory:** `universal.md` (incl. §13a-iii), `visual-
  grammar.md` MOTION section, `motion-tokens.json`, `build_motion.py`, `engine/`, VPW's motion-
  intent vocabulary. Stage explicit paths only; never `git add -A`.
- **Scratch fixture is untracked by design.** `_chain-test/` (whole tree, incl. library +
  scenes + MP4) must not be `git add`ed. Even on Task 8's commit, ONLY the doc paths above.
- **Session 1 pickup warned an account session-limit reset around 11:10pm ET**; session 2 hit no
  limits. If subagents die mid-run in a future session, check disk before redoing.
- **Artifact URLs** — render board: `…5c652760…` (kept across the rebuild). MacGregor board:
  `…9b142adc-aedf-4ba4-b40b-a67c56073d06` (session 1). Old playable cut: `…0010db9e…` (superseded).
  Pass-1 rig-gate board (session 2, honest-to-history): `…17970556-f603-4a59-a049-fa2efddd838e`.
