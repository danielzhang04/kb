# Pickup — Poyais chunks 3–6 rework ROUND 4 EXECUTED (2026-07-17) — AT THE HUMAN BOARD GATE

**State: round 4 (Daniel's "simpler prompts, context-free regen" directive) ran end-to-end and is
DONE. Nothing generating. Board republished to the SAME artifact URL. Resume = read his ruling on
the 3 flags, then either (a) release chunks 3–6 → RENDER the full video (standing order: images +
motion + audio + SFX + VO → device-player link → his iteration loop), or (b) targeted follow-ups.**
Supersedes `2026-07-17-chunks36-round3-pickup.md` (round-3 outcome: his eye rejected battery-passed
frames — ear-holes + gestalt were the missing invariants).

Board (SAME url): https://claude.ai/code/artifact/07ac56e9-45fb-4a1f-b86a-3f6791935bd5

## What round 4 did (all agents Opus 4.8, model-verified; his prompt-table gate passed "Go as-is")

1. **VPW re-author, 15 shots** (L30 L48 L62 L63 L67 L76 L79 L86-88 L93 L111 L115-117): ≤80-word
   scene prompts, ALL rig-lawyering stripped, anonymous faces eliminated/structurally covered
   (backs, hoods, hats, named canonicals). Backup: `shots.pre-r4-vpw-2026-07-17.json`. Lint green.
2. **Context-free regen, 14 gens** (L79 = fresh-L76 plate reuse, no own gen): canonical/exemplar/env
   seeds ONLY, no prior-frame seeding, no defect language. Supersede → `_superseded-2026-07-17-r4\`.
3. **Hardened battery:** ear-HOLES blocking (any mark in the ear zone) + per-shot FULL-FRAME
   style-gestalt ruling (crops-only judging is why round 3's passes failed his eye).
   `crop_battery.py` gained an `ear_zones` part-type (committed change, backward-compatible).
4. **L75 by measurement:** root cause was OVERSIZED patches spilling into ocean, not centering.
   Final: colombia [.236,.30] hf.155 · peru [.217,.45] hf.205 · chile [.255,.735] hf.35.

## Result: 11/14 CLEAN (stamped) · 3 FLAGGED (retries spent, best-of-2 kept)

- **CLEAN:** L48 L63 L67 L76 L86 L87 L88 L93 L115 L116 L117 — including the beach chain + L93
  that failed rounds 1–3. L116 soft note: expression reads smug vs seeded worried (acting-pass
  option offered on the board).
- **FLAGGED:** L30 (MacGregor one flesh ear, both attempts) · L62 (kept a1: 4 distant-crowd
  nose-bumps; a2 regressed: foreground ears + 'DOYAIS' misspell, parked) · L111 (kept a1: 4
  blank-grey mannequin fillers; a2 emptied street but destroyed MacGregor bald+hoodie, parked).
  Parked frames in `_superseded-2026-07-17-r4\` (`-r4a`/`-r4b-*` suffixes).

## VALIDATED learnings (round-4 evidence; codify per §G after Daniel confirms)

1. **Simple prompts + structural composition WORK** — the ≤80-word prompts with faces
   eliminated/covered cleared 11 shots incl. three-round failures. The old accreted
   prohibition-block prompts were the defect driver.
2. **Identity starve countermeasures:** (a) two-gen identity pass should be CONDITIONAL on an
   observed starve (unconditional pass BALDED healthy frames twice — L62-genB, L111-a2);
   (b) "The ONLY people in the scene are those stated" kills engine-invented galleries/mannequins.
3. **Judge law:** ear-holes are a distinct blocking invariant; a per-shot full-frame gestalt
   ruling is mandatory (crop-passes ≠ frame-passes — proven by Daniel's round-3 rejections).
4. **Distant micro-figures still grow nose-bumps** (L62 ×2 rounds) — silhouette/featureless
   authoring for far-scale figures remains the open candidate fix.
5. **Agents ending turns to "wait" on background gens** stalled all three units — brief them
   foreground-sequential for forge runs (503 storms make background batches flaky).

## Key paths

- Session scratchpad (briefs-r4.md, logs-r4\, verdicts-r4\, crops\<sid>-r4[b]\, r4-prompt-table.md,
  board builder build_board_r3.py + board-flags-r4.json, l75-composite-check-r4.png):
  `C:\Users\danie\AppData\Local\Temp\claude\C--Users-danie-faceless-youtube\30e11bff-346b-4ec6-94a7-f342dc6ad105\scratchpad\`
- Manifest stamped `round4/<unit>` (backup `manifest.pre-r4-2026-07-17.json`);
  `rework36_round4` summary block inside. Motion backups: `shots.motion.pre-r3-2026-07-17.json`,
  scratchpad `shots.motion.pre-r4-l75.json`.
- Standing rules unchanged: Opus 4.8 grunts (model line verified) · same-URL board · supersede-first
  (next round: `_superseded-<date>-r5\`) · orchestrator-only manifest merges · UTF-8 by codepoint ·
  crop battery (now ear-holes + gestalt) is LAW.

## After the gate

Release → **RENDER full video** (render-builder scenes mode; VO + audio-plan exist; motion plan
lint-green incl. L75/L79/L107 edits) → device player (VS Code mp4 is muted for him) → iterate.
Open elsewhere: chunk-1 bugs (`--mode identity` bald head; head-turn NOSE), VPW prop-lettering
whitelist gap, dashboard timeline backfill.
