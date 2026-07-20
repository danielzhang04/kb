# Poyais Round-3 Board-Feedback Rework — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute Daniel's 2026-07-17 board feedback on the round-2 chunks 3–6 board: 12 fresh
regens (L48 L63 L73 L86 L87 L88 L93 L107-bg L111 L115 L116 L117), 3 file-level fixes (L75 layer
geography, L79 layer removal, L30 restore), then republish the board to the SAME artifact URL for
the release-to-render gate.

**Architecture:** Same round-2 flow, now codified law: orchestrator dispatches Opus-4.8 grunt
units (model line verified first log line) → every gen follows the seed-cap/regen-first/mandatory-
anchor law → deterministic crop battery (localizer → `crop_battery.py` → separate evidence-citing
judge) → one re-authored retry max → orchestrator merges manifests → board republish.

**Tech Stack:** `forge.py` (gemini-3-pro-image, Windows `py -3` python — msys2 python fails SSL),
`crop_battery.py`, `build_motion.py` (layer semantics), board builder adapted from
`build_board_r2.py`.

## Global Constraints

- **All grunt agents = Opus 4.8** (`model: "opus"` on dispatch); each agent's FIRST log line is
  `MODEL: <exact model id>`; a Fable/Mythos line = stop the unit and re-dispatch.
- **Seed cap ≤4 per gen.** Style anchor mandatory on every scene/plate gen. Crowd-exemplar
  (`visual-kit/refs/base/crowd-exemplar.png`) seeded into every crowd-bearing gen (counts in cap).
- **Regen-first:** NEVER seed the current defective `scenes/<id>.png` to fix a rig defect. Chain
  deltas seed only non-defective fresh parents.
- **One re-authored retry per shot**, then flag for the board.
- **Supersede-first:** before overwriting any `assets/**/*.png`, move the existing file into a
  sibling `_superseded-2026-07-17-r3\` folder (create it; never touch the 07-16 folders).
- **Orchestrator-only manifest merges.** Units emit `proposed-manifest-<unit>.json` to scratchpad.
- **UTF-8 by codepoint** on every ad-hoc file edit (shell default is cp1252 — has mojibaked files).
- **Board republishes to the SAME url:** pass
  `url: https://claude.ai/code/artifact/07ac56e9-45fb-4a1f-b86a-3f6791935bd5` (new conversation
  otherwise mints a new one).
- Paths: `VID = channels\the-second-take\videos\2026-07-04-poyais` ·
  `KIT = channels\the-second-take\visual-kit` · scratchpad = this session's scratchpad dir.

---

### Task 1: P0 file-level fixes (orchestrator, no gen tokens)

**Files:**
- Modify: `VID\shots.motion.json` (L79, L107 layer lists)
- Modify: `VID\shots.json` (L79, L107 still_prompt + notes)
- Move: `VID\assets\scenes\L30.png` → `VID\assets\scenes\_superseded-2026-07-17-r3\L30.png`;
  copy `VID\assets\scenes\_superseded-2026-07-16-r2\L30.png` → `VID\assets\scenes\L30.png`
- Move: `VID\assets\cutouts\L79-fine-print.png` and `VID\assets\cutouts\L107-anger-mark.png`
  → `VID\assets\cutouts\_superseded-2026-07-17-r3\`

**Steps:**
- [ ] **L30 restore:** supersede the current round-2 `scenes/L30.png` into
  `_superseded-2026-07-17-r3\`, copy the pre-round-2 frame back from `_superseded-2026-07-16-r2\`.
  Daniel: "go back to previous one, that was fine." Board card notes the restore for his visual
  confirm.
- [ ] **L79 remove fine-print layer:** in `shots.motion.json` set L79 `layers: []` (background
  delta-chain plate `scenes/L76.png` unchanged). In `shots.json` L79, strip the fine-print scroll
  clauses from `still_prompt` + update `notes` (shot = the held L76 crowd, no cutout). Supersede
  the cutout PNG.
- [ ] **L107 scratch the anger mark:** in `shots.motion.json` remove the `anger-mark` layer (keep
  `poyais-officer`). In `shots.json` L107, remove the anger-mark clauses and rewrite the crowd
  direction: the crowd is ANGRY — downturned mouths, arms raised POINTING at the officer's spot
  (layer anchor 0.5, 0.72) — attention fully off the portrait. Supersede the anger-mark cutout PNG.
- [ ] **Lint:** run `lint_shots.py` (visual-prompt-writer scripts) + `lint_motion_plan.py`
  (motion-planner scripts) — both must pass green before any dispatch.
- [ ] Verify edited files byte-clean: re-read edited JSON via UTF-8 parse; no mojibake codepoints.

### Task 2: L75 layer-geography fix (one Opus agent, vision loop, no gen expected)

**Files:**
- Read: `.claude\skills\render-builder\...` / `build_motion.py` — confirm what layer `at` [x,y]
  anchors (center vs top-left) before moving anything
- Modify: `VID\shots.motion.json` L75 `layers[].animation.at` (+ `height_frac` if needed)
- Produce: `scratchpad\l75-composite-check.png` (board evidence)

**Steps:**
- [ ] Confirm `at` coordinate semantics from engine/build_motion source; log the cited line.
- [ ] Composite `cutouts/L75-colombia.png`, `L75-peru.png`, `L75-chile.png` onto `plates/L74.png`
  at current coords; VIEW the composite; move each until it sits on its true geographic region of
  the drawn map (Colombia NW, Peru central-west coast, Chile the long SW ribbon). Iterate
  composite→view→adjust until correct.
- [ ] Write final coords into `shots.motion.json` (UTF-8, via json load/dump); re-run
  `lint_motion_plan.py`; save final composite PNG for the board.

### Task 3: Gen unit U1-r3 — MacGregor solos: L63, L111

**Kill-list:** L63 EARS + FINGER COUNT (round-2 called it clean — the defect shipped; be
adversarial). L111 MacGregor EAR + SKIN TONE (head tone must match `macgregor-base.png` canonical).

**Steps:**
- [ ] Fresh regens per `shots.json` still_prompts. Seeds: `macgregor-base.png` + ONE pose
  primitive (`sit` / `walk-right`) + ONE expr frame + env style anchor if slot allows. Two-gen
  identity pass where scene-heavy (default for scene-heavy single-character shots).
- [ ] Emit `proposed-manifest-u1r3.json`; log every gen incrementally to `logs-r3\u1r3.md`.

### Task 4: Gen unit U2-r3 — office + courtroom chain: L48, L115→L116→L117

**Kill-list:** L48 EARS + FINGERS on both figures (third pass — Daniel: "Generate fresh. Stay on
rig"). L115 EARS + investor/gendarmes OFF-RIG. L116 + L117 EARS + off-rig figures; the flanking
gendarmes must MATCH across L116/L117 (gen L116 first, seed L117's gendarmes off the fresh L116
frame — legal, non-defective parent).

**Steps:**
- [ ] L48 fresh: seeds `refs/base/handoff.png` + `base.png` + lettering anchor
  (`refs/env/lettering-marker-italic.png` — price card is authored text). Never seed either prior
  failed L48 frame (`scenes/_l48-retry-u2b-2026-07-16.png` included).
- [ ] L115 fresh: macgregor canonical + `action-offering.png` + `base.png`; investor full §2e rig
  facts verbatim; gendarmes on crowd rig.
- [ ] L116 fresh → L117 seeded off L116 output + macgregor canonical.
- [ ] Emit `proposed-manifest-u2r3.json`; log to `logs-r3\u2r3.md`.

### Task 5: Gen unit U3-r3 — crowds + beach chain: L73, L86→L87→L88, L93, L107-bg

**Kill-list:** L73 crowd EARS. L86/L87/L88 OFF-RIG + OFF-ART-STYLE (whole arrival-beach chain
fresh: L86 base → L87 delta → L88 delta, each delta seeding the fresh parent). L93 foreground
settler EARS. L107 background: crowd must be ANGRY and POINTING at the officer anchor spot.

**Steps:**
- [ ] Every gen seeds `crowd-exemplar.png` + an env style anchor (chain deltas: fresh parent
  frame counts as the anchor).
- [ ] L93 primary = fresh gen per still_prompt. If the battery fails it, the ONE retry is Daniel's
  pre-approved alternative: seed the clean `scenes/L94.png`, author the SAME camp WITHOUT the
  three struck symbols, add the foreground settler (full §2e rig facts) — not the defective-L93
  seed path.
- [ ] L107 background: delta seeded off `scenes/L105.png` (non-defective parent) + crowd-exemplar;
  crowd turned angry/pointing per the Task-1 rewritten still_prompt; officer cutout unchanged
  (pops on at render).
- [ ] Emit `proposed-manifest-u3r3.json`; log to `logs-r3\u3r3.md`.

### Task 6: Crop battery over every new frame (LOC → crop_battery.py → JUDGE)

**Files:** boxes → `scratchpad\crops\<sid>\boxes.json`; crops via
`.claude\skills\image-generation\scripts\crop_battery.py`; verdicts →
`scratchpad\verdicts-r3\<unit>.json`.

**Steps:**
- [ ] Localizer agents (Opus): boxes for every figure (face + every visible hand) on all 12 new
  frames — including L107's regenerated background crowd.
- [ ] Run `crop_battery.py` per frame (localizer per its round-2 usage).
- [ ] Fresh judge agents (Opus, did not generate): per-crop verdicts citing crop paths — NO nose,
  NO ears (haired figures: hair FILLS the ear zone; skin gap = FAIL), exactly 3 fingers + 1 thumb
  counted aloud, squat proportion, identity-match for MacGregor (incl. L111 skin tone vs
  canonical). L86–L88 + L116/L117: also judge cross-frame consistency (same figures across chain).
- [ ] FAIL → the shot's one re-authored retry (re-brief the unit with the judge's evidence), then
  re-battery. Second FAIL → flag for the board.

### Task 7: Manifest merge + stamps (orchestrator only)

**Steps:**
- [ ] Merge `proposed-manifest-*.json` into `VID\assets\scenes\manifest.json` (UTF-8 json
  load/dump; back up manifest first as `manifest.pre-r3-2026-07-17.json`). Stamp battery-passed
  shots `verified:{scene:true,rig:true}` + `round3/<unit>`; flagged shots keep `verified:false`.
  L30 entry noted "restored pre-round-2 frame per Daniel 2026-07-17"; L75/L79 motion-only notes.

### Task 8: Board republish + handoff + hygiene

**Steps:**
- [ ] Rebuild the review board (adapt `build_board_r2.py` from the 07-16 session scratchpad —
  copy into this session's scratchpad first): all chunks 3–6 cards, plate+layers cards composited
  (bug-fixed logic: `layer.reuse` else `cutouts/<sid>-<layer-id>.png`), reworked cards carry "rig
  crops" evidence sheets + L75 composite check + restored L30. Big images + click-to-enlarge
  lightbox (Daniel's review preference). Publish with `url:` = the SAME artifact URL.
- [ ] Update `docs/handoffs/STATUS.md` queued-work block in place; write
  `docs/handoffs/2026-07-17-chunks36-round3-pickup.md` (append-only resume state); log the
  round-3 decisions (L79 layer cut, L107 anger-mark cut + angry-crowd restage, L30 revert) in
  `knowledge/decisions.md` with date 2026-07-17.
- [ ] §F-clean sweep: prune round-2 board/composite scratch files now superseded in the video
  root (`_composite-check-*.png`, `_chunk1-board-*.html`, `_dogfood-*` — confirm superseded
  before deleting); commit meaningful repo changes with explicit paths (never `git add -A`).

### After the gate

Daniel approves the board → chunks 3–6 RELEASED → next step per handoff: **full-video RENDER**
(render-builder scenes mode with motion + VO + audio-plan SFX/music) → device-player review link →
his iteration → re-render.
