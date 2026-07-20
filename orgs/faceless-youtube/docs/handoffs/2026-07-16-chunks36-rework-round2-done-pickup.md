# Pickup — Poyais chunks 3–6 rework ROUND 2 EXECUTED (2026-07-16) — AT THE HUMAN BOARD GATE

**State: round 2 ran end-to-end through the REDESIGNED crop-battery flow and is DONE. Nothing is
generating. The board is republished to the SAME artifact URL and Daniel will give his feedback to
THIS (a new) terminal. Resume = read his board feedback, then either (a) release chunks 3–6 → next
pipeline step is RENDER, or (b) run the targeted follow-ups he orders (5 flagged shots below).**
Prior context: `2026-07-16-chunks36-rework-round2-pickup.md` (his verbatim round-2 feedback + the
systemic diagnosis) → design: `docs/superpowers/specs/2026-07-16-round2-crop-battery-redesign.md`
(human-approved) → plan: `docs/superpowers/plans/2026-07-16-round2-crop-battery-rework.md`.

Board (republish to SAME url): https://claude.ai/code/artifact/07ac56e9-45fb-4a1f-b86a-3f6791935bd5

## What ran (all grunt agents Opus 4.8, model line verified in every log)

1. **Board bug fixed, no regen needed for L78/L79/L80/L107** — the round-1 board compositor read
   nonexistent `layer.cutout`/`layer.asset`; real resolution is `layer.reuse` else
   `cutouts/<sid>-<layer-id>.png` (build_motion.py:179). All plate+layers cards now composite.
   L107's "officer on the ground" = *in-country* per the VO; the authored hunched officer cutout is
   correct.
2. **New gen law executed** (spec §2, now codified): seed cap ≤4 · regen-first (a rig fix NEVER
   seeds the defective frame) · **crowd exemplar** — Daniel gated candidate C →
   `refs/base/crowd-exemplar.png` (+ registry row), seeded into every crowd-bearing gen.
3. **New verify law executed** (spec §3, now codified): localizer agent → deterministic
   `image-generation/scripts/crop_battery.py` (face/hand crops at 3–4×, contact sheets, --diff
   regression mode) → separate fresh judge with per-crop verdicts citing crop paths. ~180 crop
   rulings; every reworked card on the board has a "rig crops" evidence sheet. The battery caught
   defects the generating units self-called clean **four separate times** (L95 noses ×2, L48 ears,
   L86/L87 ears/noses) — the round-1 failure mode, now detected pre-human.
4. **22 shots reworked** (the full ledger + L30): 17 verified clean + stamped
   `verified:{scene:true,rig:true}` (L30 L61 L63 L67 L68 L77 L81 L93 L96 L103 L108 L109 L114 L115
   L116 L117 L118); 5 flagged (below). L114 held framing per Daniel's order (regression diff PASS).
   L116/L117 soldiers match (shared seed). L96 = exactly 10 crosses, machine-verified twice.
   Supersede-first: round-2 originals in `assets/*/_superseded-2026-07-16-r2/`.

## The 5 flagged shots (each spent its ONE retry — Daniel's call on the board)

| Shot | Residual | Options on the table |
| --- | --- | --- |
| L48 | EARS both figures (retry regressed: 1 ear cleared but noses appeared → kept nose-free 2-ear frame) | keep · use alt `<video-root>/_l48-retry-u2b-2026-07-16.png` (1-ear/2-noses) · order pass 3 |
| L62 | garbled fluttering POYAIS banknotes (fidelity); rig/crowd CLEAN | accept at flutter scale · regen notes only · drop the swarm |
| L86 | ONE nose-dot on back-turned top-hat man (all other noses/ears cleared by backs-to-viewer re-author) | accept (micro) · targeted pass |
| L87 | EAR on flat-cap near-back man (chain retry spent on L86) | accept · targeted pass off L86 |
| L95 | pin-stroke noses on the two tiny distant settlers (survived exemplar-seeded retry) | accept · author them featureless (see candidates) |

## Taste calls needing Daniel's ruling (non-blocking, flagged on the board)

NEW: L61 garbled decorative note lettering · L81 grey lineup background + split proportion ruling
(crop judge PASS vs style reviewer "slightly tall" — his eye decides) · L109/L115 glossy-eye drift
on non-MacGregor foreground figures · L115 'FRANCE' thin font · L118 faint frieze squiggles.
CARRIED (unruled since round 1): L53/L57 serif hull lettering · L54 'LAW' book label · L102
squatness · L112 serif map labels · L75 CHILE banner readability.

## Codification state

- **Codified (human-approved via the design gate; edits landed, orchestrator committed):** bible
  §2d crowd-exemplar law, §3 crop-battery replaces the no-hand-crops clause, §5 seed cap +
  never-seed-defective-frame, §8 crowd-seeding consistency fix; image-generation SKILL.md Pass-2 +
  review rewiring; decisions.md dated entry.
- **Candidates NOT yet codified (need Daniel's confirmation, §G):**
  1. Distant micro-figures should be authored featureless/silhouette (dot-eye faces at that scale
     reliably grow pin-noses — survived exemplar seeding twice).
  2. PROFILE faces are the ear-drift hotspot; backs-to-viewer/3q-away composition beats prohibition
     wording (proven on L86/L87).
  3. A hatted/short-haired man seen from BEHIND grows ears at the hat-brim line; only side-wrapping
     headwear/hair suppresses it (prompt text does not) — candidate fix belongs in the
     crowd-exemplar rig or a forge guard.
  4. Small/decorative background lettering (note swarms, friezes) garbles routinely — candidate VPW
     law: don't author legible text at flutter/frieze scale.

## Key paths

- Session scratchpad (briefs `briefs-r2.md`, logs `logs-r2\`, verdicts `verdicts-r2\`, crops
  `crops\<sid>\`, board builder `build_board_r2.py` + `board-flags-r2.json`, merge/stamp
  `merge_manifests_r2.py` + `stamp-clean-r2.json`, run log `run-log-r2.md`):
  `C:\Users\danie\AppData\Local\Temp\claude\C--Users-danie-faceless-youtube\ce0c259c-1ce8-48b3-bae0-550f28bc08e6\scratchpad\`
- Crowd-exemplar gate artifact: https://claude.ai/code/artifact/b5e698ef-1d95-42b8-8efd-f5b703da99b8
- New standing tool: `.claude/skills/image-generation/scripts/crop_battery.py` (committed).
- Video: `channels/the-second-take/videos/2026-07-04-poyais/` — manifest entries stamped
  `round2/<unit>`; 5 flagged entries keep `verified:false`.
- Gen environment note: forge needs the Windows `py -3` python (has certifi); msys2 `python` fails SSL.

## Standing rules for the resuming terminal

All grunt work → Opus 4.8 agents (model line verified in logs, first line) · board republishes to
the SAME url (pass `url:` since a new conversation otherwise mints a new one) · supersede-first
(new folder per round: `_superseded-<date>-r3\` next) · orchestrator-only manifest merges ·
UTF-8 by codepoint · the crop battery is now LAW for any regen (localizer → crop_battery.py →
separate judge; evidence-cited verdicts only).

## After the gate

Chunks 3–6 released → next pipeline step is **RENDER** (render-builder scenes mode; VO + audio plan
exist per STATUS). Also still open: chunk-1 bugs (`--mode identity` bald head; head-turn NOSE),
VPW prop-lettering whitelist routing gap, dashboard 07-05→07-15 timeline backfill.
