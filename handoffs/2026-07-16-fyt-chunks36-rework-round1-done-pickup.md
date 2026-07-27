# Pickup — Poyais chunks 3–6 rework round 1 DONE (2026-07-16) — AT THE HUMAN BOARD GATE

**State: the full rework round is EXECUTED and merged. Nothing is generating. The board is
republished to the SAME artifact URL and Daniel has been asked to gate it. Resume = read his board
feedback and either (a) release chunks 3–6 → move to RENDER, or (b) run rework round 2 off his
notes.** Prior context (verbatim feedback + ledger): `2026-07-16-chunks36-rework-round1-pickup.md`.

Board (republish to SAME url): https://claude.ai/code/artifact/07ac56e9-45fb-4a1f-b86a-3f6791935bd5

## What ran (all agents Opus 4.8, model-verified in their logs)

1. **Three human calls confirmed up front:** crowd rig = EXACT base-rig squat proportions (face
   differs) · L96 → exactly 10 crosses · L114 keeps framing (rig+fingers only).
2. **Crowd audit** (3 agents, every frame): tall-drift L53/L54/L73/L76/L115 in the window (ALL
   fixed) + **L30 in RELEASED chunk 1 (tall redcoat — surfaced, NOT reworked; his call)**.
3. **8 rework units + fix round:** ~41 manifest entries updated; kind changes L57/L62→scene,
   L74/L75/L112/L120→plate+layers (L74 = PIL crop of L15; L120 reuses L15 plate + L17 MacGregor
   cutout + draw_line arrow); L59 arrow slide-in; L60 ring deleted; L79 was a placement bug (motion
   fix only). 28 re-authored still_prompts merged into shots.json (backup
   `shots.pre-rework36-prompt-merge-2026-07-16.json`); shots.motion.json edited by one unit only
   (backup `shots.motion.pre-rework36-2026-07-16.json`); both lints green.
4. **3-axis fresh-eyes review + consolidated fix round:** 9 blocking flags found and ALL cleared
   (L96 count; noses/ears L68/L73/L76/L86–88/L122 — two reviewer-vs-reviewer disputes adjudicated
   real by zoom). Zero blocking remain; 11 taste/verify cards on the board.
5. **Learnings codified** (per §G-route; decisions.md has the dated entries): style-anchor mandatory
   on every scene/plate gen; exact-squat proportion law in bible §2d; arrows/routes/reveals = motion
   (animation-rules); maps = crop the canonical; match-prop seeding; two-gen de-nose pattern (sticky
   ear needs a 2nd pass off the fixed frame); zoom-face review mandate. 4 of the 6 pending G-route
   candidates codified, 2 already covered. **One routing gap:** the VPW-authoring half of the
   prop-lettering whitelist (visual-prompt-writer was out of the routing agent's scope) — small,
   route on next VPW touch.

## Open items for Daniel's gate (also flagged on the board)

- L96: verify the ten crosses with your own eye (it failed twice before landing).
- L30 (released chunk 1): tall redcoat — rework or leave?
- Taste calls: serif hull/map lettering (L53/L57/L62/L112) vs the marker register · L54 'LAW' book
  label · L102 slightly-less-squat figures · L108 plaque lettering register · L77 looser palette ·
  L75 CHILE banner readability.

## Key paths

- This session's scratchpad (unit briefs, unit/review/fix logs, board builder + merge tooling):
  `C:\Users\danie\AppData\Local\Temp\claude\C--Users-danie-faceless-youtube\1945d41a-6f2e-40b2-bc2e-253bcdac82a7\scratchpad\`
  (`rework-units-2026-07-16.md`, `units\*.md`, `review\*.md`, `build_board_rework36.py` +
  `board-flags.json`, `merge_prompts.py`, `merge_manifest_rework36.py`).
- Older tooling (pass2-brief v2 gen law, review-c36 axis briefs) survives at the PRIOR session
  scratchpad: `...\1037de8d-223e-44bc-b3ce-cbc5c6b1e82f\scratchpad\`.
- Video: `channels/the-second-take/videos/2026-07-04-poyais/` — manifest stamp
  `rework36_round1` (per-shot technique/seeds/attempts), `_rework-log-2026-07-16.md` (durable round
  record), superseded PNGs in `assets/*/_superseded-2026-07-16/`.
- Known caveat: two units reported "mojibake" in shots.json that a codepoint audit disproved —
  agents had decoded UTF-8 with the shell default (cp1252). Verify by codepoint before believing
  such reports (§F-encoding).

## After the gate

Chunks 3–6 released → next pipeline step is **RENDER** (render-builder scenes mode; VO exists;
audio-director plan exists per STATUS). Chunk-1 bugs still OPEN: `--mode identity` bald head,
head-turn NOSE (mitigated by the codified two-gen de-nose pattern).
