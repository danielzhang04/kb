# PICKUP — pipeline integration test plan (2026-07-12)

> **▶ RESUME HERE.** The **T2 device-card producer is BUILT + committed** (motion-planner authors
> engine device-layers → `build_motion.apply_motion_plan` routes them to `motion.json` `overlays[]` →
> `OverlayView` renders; spec `…specs/2026-07-12-t2-device-card-producer-design.md`, plan
> `…plans/2026-07-12-t2-device-card-producer.md`). A **staleness audit** ran clean (27/28 tests; no
> beat_type/field drift). Now VALIDATE the pipeline via a **tiered integration test.** No formal plan —
> it's a diagnostic run, track with todos.

## The tiered test (run in this order)

### Tier 0 — device-card render smoke test (~10 min, $0) — DO FIRST
Hand-build a tiny motion.json THROUGH `apply_motion_plan` (all six device kinds over placeholder
scenes) → render with `engine/render-video.mjs` → open the MP4 (Windows player — VS Code preview is
muted). Confirms the T2 code just written actually DRAWS cards + the stitch holds, before spending on
VPW/VO. **(This is what's running now / next.)**

### Tier 1 — 3:30 mock pipeline run (~60–90 min + debugging; the real integration test)
Run the FULL front-to-back chain on a ~3:30 slice, **placeholder scenes + real VO**, checkpoint each
handoff:
`VPW → lint_shots → motion-planner → lint_motion_plan → voiceover (real ElevenLabs, small quota) →
audio-director → build_audio → build_motion --allow-missing → Remotion render → eye/ear-gate`.
- **Subject:** copy Poyais `script.md` (+ brief/research) into a **scratch slug** (e.g.
  `videos/_t2-tier1-test/`) so a fresh VPW run does NOT clobber the gold `shots.json`. Slice to ~3:30
  via script trim and/or `build_motion --max-shots`.
- **This run tests, in ONE pass:** T2 device cards (render/placement/timing); fresh VPW *authoring*
  (Poyais's shots.json is hand-tuned gold — this tests VPW generating clean); the whole schema-handoff
  chain; motion-planner rules across ~20 rule-picked shots (not 2 hand-picked); voiceover + per-word
  timings; cut-to-VO sync; the Remotion stitch at length.
- **DOUBLES AS the audio-director dogfood** (CLAUDE.md's #1 pending validation — audio only ever
  ear-gated on the synthetic `_chain-test`). Real VO → audio-director → audio-plan.json → build_audio →
  music lane + SFX + breath/pause + dry + master + audio_checker. Ear-gate FEEL.
- **Known Tier-1 limitation:** cutout layers reference `plates/`+`cutouts/` PNGs that don't exist
  without image-gen (Tier-2). Layered cutout shots will degrade/break in the mock — let them fall back
  to placeholder; eye-gate device cards + audio + timing + non-layered shots only. The cutout LOOK
  waits for Tier-2.

### Tier 2 — full real run (later)
Real image-gen (scenes + cutout materialization) + full-length. **Prereq (audit gap #1):**
`pip install pillow` (+ likely `rembg` + `onnxruntime`) — `test_cutout.py` fails today on missing PIL;
real `forge cutout` needs it. Then the full-length flat render → the render ops-envelope question
(chunk or not) gets answered empirically.

## Deferred drift (from the audit — non-blocking, fix when convenient)
- **#2:** `idea-generator` docs reference the retired **`scriptwriter`** (7 spots; should be
  researcher→long-form-writer/shorts-writer). A small `curate-doc` pass.
- **#3:** `motion-planner` SKILL description says "author audio/SFX (**audio-cue-writer**)" — should be
  **audio-director** (one-line fix).
- (Done in the audit: removed orphaned `__pycache__` dirs for the two retired cue-writer skills.)

## State on disk
- T2 code: `render-builder/scripts/{motion_plan.py, build_motion.py}` (+ tests green).
- Rules: `motion-planner/references/animation-rules.md` (device-card rule + diegetic parked).
- Reference (engine hand-fixture shape): `render-builder/engine/test-motion-layered.json`.
- **Parallel terminals share this tree** — stage explicit paths, never `git add -A`. `decisions.md`
  carries another terminal's WIP + this session's T2 entry (left unstaged on purpose).
