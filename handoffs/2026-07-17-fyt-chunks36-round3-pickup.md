# Pickup — Poyais chunks 3–6 rework ROUND 3 EXECUTED (2026-07-17) — AT THE HUMAN BOARD GATE

**State: round 3 (Daniel's board feedback on round 2) ran end-to-end and is DONE. Nothing is
generating. Board republished to the SAME artifact URL; Daniel's feedback comes to a resuming
terminal. Resume = read his ruling, then either (a) release chunks 3–6 → RENDER the full video
(his standing order: images + motion + audio + SFX + VO, then his iteration loop), or (b) run the
targeted follow-ups he orders on the 6 flags below.**
Prior context: `2026-07-16-chunks36-rework-round2-done-pickup.md` → plan executed this round:
`docs/superpowers/plans/2026-07-17-round3-board-feedback-rework.md`.

Board (republish to SAME url): https://claude.ai/code/artifact/07ac56e9-45fb-4a1f-b86a-3f6791935bd5

## Daniel's round-2 board feedback → what ran (all grunt agents Opus 4.8, model line verified)

- **Scope ruling (2026-07-17):** everything he did NOT list is accepted as-is (L62 L95 L96 + the
  whole taste stack L61/L81/L109/L118/L53/L54/L57/L102/L112). Round 3 touched only his list.
- **No-gen fixes (orchestrator):** L30 RESTORED to the pre-round-2 frame ("go back to previous
  one") · L79 fine-print layer REMOVED (motion background → plate reuse scenes/L76.png) · L107
  anger-mark layer REMOVED + shot restaged (crowd itself angry/pointing; officer stays a cutout
  pop-on; background now a dedicated scenes/L107.png, motion → plate mode) · L75 country layers
  moved to TRUE map geography (engine `at` = layer CENTER, components.tsx:595/615; composite-
  verified; coords: colombia [.215,.285] peru [.215,.45] chile [.225,.735]). Both lints green.
- **12 fresh gens through the crop battery** (localizer → crop_battery.py → separate adversarial
  judge, evidence-cited): **6 verified clean + stamped** (L63 L73 L107 L111 L116 L117 — incl. L111
  skin-tone pixel-match dist 12.8, L116/L117 gendarme continuity, L107 angry+pointing ruled TRUE)
  and **6 FLAGGED, each retry spent** (L48 L86 L87 L88 L93 L115).

## The 6 flags (one category — Daniel rules on the board)

| Shot | Residual after retry |
| --- | --- |
| L48 | buyer bare ear survived a 4TH independent gen (smooth-contour geometry + 3q-away both failed) |
| L115 | investor ear persists + NEW MacGregor skin-tone drift (#f9c9a3 vs canonical #d6a77b) + unauthored on-topic 'POYAIS' on loan stack |
| L86 | front settler 3q face keeps a C-curl ear (hand fixed to 4 digits; rest clean) |
| L87/L88 | settler fully BACK-TO-VIEWER still grew two ears at the hat-brim line (chain otherwise clean+consistent) |
| L93 | worst: 'gaunt older man' pulls photorealism even seeded off clean L94 — nose/ear/shading/5-digit + 3 bg crowd noses |

## Candidate learnings — NOT codified (§G: need Daniel's confirm)

1. **Ears on §2e foreground anon figures cannot be prompt-suppressed** — 4 independent gens on
   L48, 2 on L115, 2 on the beach chain. Only COMPOSITION works: side-wrapping headwear/hair
   covering the ear zone, or a fully faceless treatment. (Extends round-2 candidates #2/#3, now
   proven from behind too — the hat-brim-line ear.)
2. **"Gaunt/aged" character wording pulls photorealism** (L93 twice) — grief/age must be authored
   as posture/silhouette (hooded, blanket-wrapped, back-to-viewer), never facial description.
3. **Units keep misreading a composed-shot still_prompt as "stale"** when the shot is
   plate+cutout hybrid (L107, twice) — the plate-vs-composed distinction may need an explicit
   field or a standard notes phrase.

## Key paths

- Session scratchpad (briefs `briefs-r3.md`, logs `logs-r3\`, verdicts `verdicts-r3\`, crops
  `crops\<sid>[-a2]\`, board `build_board_r3.py` + `board-flags-r3.json`, L75 evidence
  `l75-composite-check.png`):
  `C:\Users\danie\AppData\Local\Temp\claude\C--Users-danie-faceless-youtube\30e11bff-346b-4ec6-94a7-f342dc6ad105\scratchpad\`
- Video: `channels/the-second-take/videos/2026-07-04-poyais/` — manifest stamped `round3/<unit>`
  (backup `manifest.pre-r3-2026-07-17.json`); superseded frames in
  `assets/*/_superseded-2026-07-17-r3/`; motion backup `shots.motion.pre-r3-2026-07-17.json`.
- Standing rules unchanged (round-2 pickup §Standing rules): Opus 4.8 grunts + model line ·
  same-URL board republish · supersede-first (`_superseded-<date>-r4` next) · orchestrator-only
  manifest merges · UTF-8 by codepoint · crop battery is LAW for any regen.

## After the gate

Release → **RENDER the full video** (render-builder scenes mode; VO + audio-plan exist per
STATUS; motion plan lint-green incl. the L75/L79/L107 edits) → open in the device player for
Daniel (VS Code mp4 preview is muted on his machine) → his iteration → re-render. Still open
elsewhere: chunk-1 bugs (`--mode identity` bald head; head-turn NOSE), VPW prop-lettering
whitelist gap, dashboard timeline backfill.
