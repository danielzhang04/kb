---
name: render-builder
description: >-
  Assembles the finished video for a scripted + voiced + storyboarded + imaged video in this
  faceless-YouTube project — turns a videos/<slug>/shots.json + the verified assets/scenes/ stills +
  the voiceover audio into a rendered MP4 via the local Remotion motion engine — the only render
  engine, for the long-form AND every publish-tagged short. Use this whenever the user wants
  to render, assemble, build, or produce the actual video / final cut / MP4, "put it together",
  "make the video", stitch the B-roll to the voiceover, or run the render step for a video or its
  shorts — for ANY niche. Runs AFTER voiceover + visual-prompt-writer + image-generation and BEFORE
  compliance-check / publish-queue. Reads shots.json + assets/scenes/ (the verified pre-generated
  stills, when the channel style-locks its visuals) + assets/voiceover.manifest.json + the VO mp3s;
  writes assets/final.mp4, assets/shorts/short-NN.mp4, and assets/render.manifest.json. Do NOT use
  it to write the script (scriptwriter), plan visuals (visual-prompt-writer), generate the images
  (image-generation), generate the narration (voiceover), pick titles/tags (metadata-writer), or
  upload to YouTube (publish-queue).
---

# render-builder

Turn a fully-prepared video folder into a finished MP4 — locally, on the Remotion engine.

## Where this sits in the pipeline

`visual-prompt-writer` → `image-generation` ∥ `voiceover` → **render-builder** → `compliance-check` → `publish-queue`

- **Reads:** `channels/<name>/videos/<slug>/shots.json` (the shot list + house style),
  **`assets/scenes/`** — the verified, style-locked stills `image-generation` pass 2 produced (one
  PNG per shot + a manifest; the pipeline default whenever its manifest exists) — the channel's
  narration in `assets/vo.mp3` + `assets/shorts/short-NN.mp3`, and `assets/voiceover.manifest.json`
  (real audio durations, the source of truth for timing).
- **Writes:** `assets/final.mp4` (long-form), `assets/shorts/short-NN.mp4` (each `publish` short),
  the reproducible `assets/motion/<piece>.motion.json` specs, and `assets/render.manifest.json` —
  the contract `compliance-check` / `publish-queue` read (output paths + durations;
  `render_engine: remotion`, `watermark: false` — the local engine never watermarks).

The whole job is done by the scripts — there is no hand-authoring step. Motion is fixed mechanically:
the camera is always locked, every shot hard-cuts, and the layered cutout motion is merged from the
`motion-planner`'s `shots.motion.json` (via `--motion-plan`). You never hand-edit a derived motion.json.
(Audio is authored separately by the `audio-director` skill.)

## How to run it — the Remotion engine

The one path is `scripts/build_motion.py` (Python, derives the motion spec) + `engine/`
(the local Remotion component library that renders it — Node 24 (Remotion 4.x pinned), `npm install`
once inside `engine/`). It re-times the shots to the real voiceover, derives a per-piece
**`assets/motion/<piece>.motion.json`** (contract: `references/motion-schema.md`), renders locally
(≈1.5× faster than realtime on this machine), and writes the same `render.manifest.json` —
**no API, no credits, no watermark, no length cap**.

```bash
# 1. ALWAYS dry-run first — derives + saves the motion.json specs, renders nothing.
#    Inspect assets/motion/<piece>.motion.json (timings, stages, placeholders, cutout layers).
py -3 .claude/skills/render-builder/scripts/build_motion.py channels/<name>/videos/<slug> --dry-run

# 2. Real render — long-form + every publish-tagged short.
py -3 .claude/skills/render-builder/scripts/build_motion.py channels/<name>/videos/<slug>

# Useful flags:
#   --only long-form     just the long-form (or "shorts", or "short-02")
#   --all-shorts         render bench shorts too (default: publish only)
#   --chapter N          render ONLY long-form chapter N (boundaries auto-derived from
#                        metadata.json chapters, mapped onto the real VO timeline) to its own
#                        clip assets/final-chNN-<slug>.mp4 — section-by-section review, no
#                        full-length render. Add --dry-run to just LIST the resolved chapters.
#   --max-shots 6        cap shots/piece for a fast test slice
#   --allow-missing      placeholder-card shots whose scene file is missing instead of failing
#                        (test slices ONLY — the hard error is the style-lock guarantee)
#   --no-captions        skip the word-highlight caption track
```

**Standard operating procedure:** dry-run → read one motion.json (cut times on the right words?
stages grouped? placeholders only where expected? layered shots carry `plate`+`layers`?) → real
render. **Layered cutout motion is authored upstream, not here:** `motion-planner` emits it in
`shots.motion.json`, and `build_motion --motion-plan` merges each shot's `plate`+cutout `layers` (via
`apply_motion_plan`). There are no engine text/device overlays — `overlays[]` is always empty and
in-video text is baked into the generated images (see `references/motion-schema.md` §3). Never
hand-edit the derived timing fields; re-derive instead. Channel look =
`channels/<name>/visual-kit/motion-tokens.json` (data; engine defaults if absent).

## `scripts/render.py` — shared timing/scene helpers (not an engine)

`render.py` is **not runnable and has no `main()`** — it is the shared library that `build_motion.py`
(and `visual-prompt-writer/lint_shots.py`) import: the VO re-timing (`retime`, `retime_by_timings`),
the `vo_ref`→word-stream matcher, `resolve_scene_files`, and the voiceover-manifest readers. Both the
motion engine and the shot linter depend on one set of timing/scene semantics by sharing this code.
There is no second render engine.

## What the engine guarantees (so you don't re-check by hand)

- **Visuals sync to the REAL voiceover.** Each piece's shot durations are scaled so they sum to the
  measured VO length from `voiceover.manifest.json` (preserving each shot's cadence ratio). When
  per-line timings are present in the manifest it uses those instead (true per-line sync); when no VO
  audio exists yet (dry-run / a short that wasn't voiced) it falls back to the shots.json estimates
  and says so in the manifest. This replaces the earlier word-based runtime guess with ground truth.
- **The locked style reaches the screen (scenes mode).** When `assets/scenes/manifest.json` exists,
  every shot's visual is the verified PNG `image-generation` produced — seeded, rig-checked,
  taste-gated — hosted via the media seam and used as the scene image. A missing scene file for an
  ai-gen/hybrid shot is a **hard error** (run image-generation pass 2), never a silent fallback;
  chart/screencap/stock/archival shots (which image-generation deliberately skips) fall back to a
  visible placeholder card and are counted in the manifest (`scenes_from_files` / `inline_fallback`).
- **Camera is furniture; the cuts carry the life.** The camera is **always locked** (`move: none`) —
  build_motion never derives a move (decoupled 2026-07-12; the engine keeps `CameraStage` for a future
  explicit/authored move, but nothing emits one). Idle bob is a channel token (`idle.bob_px: 0` on The
  Second Take = frames hold dead-still); every shot hard-cuts. The old authored motion fields `ken_burns`
  and `within_shot_motion` are **deleted** — no longer authored, no longer read anywhere.
- **Publish gating.** Only shorts with `status: publish` in `shots.json` render by default — bench
  shorts don't render until promoted. `--all-shorts` overrides.
- **Captions.** A word-highlight caption track driven by our own ElevenLabs `word_timings` — exact
  word sync, no transcription — big and tight on shorts (silent-autoplay retention), a restrained
  band on long-form; styled by the channel's motion tokens. `--no-captions` opts out.
- **Handoff is a file.** `assets/render.manifest.json` lists every piece with its output path, real
  duration, and `render_engine`/`watermark: false` — the contract the gate + publisher read.

## Visual generation is an upstream step

Render-builder **assembles; it does not create the look.** The look arrives as the verified
`assets/scenes/<shot-id>.png` files `image-generation` produced (shorts: `<short-stem>-<shot-id>.png`);
`build_motion.py` auto-detects them via `assets/scenes/manifest.json` and uses each as its shot's
visual. A missing scene file for an ai-gen/hybrid shot is a **hard error**; chart/screencap/stock/
archival shots (which image-generation deliberately skips) render as a **visible placeholder card**
and are counted in the manifest.

`still_prompt` stays authored on every shot — it is `image-generation`'s input upstream. Field-level
mapping: `references/motion-schema.md`.

## After it runs

- Confirm `assets/render.manifest.json` exists and each expected piece has a non-null `render_url`
  and a sane `rendered_seconds`; the local `assets/final.mp4` / `assets/shorts/*.mp4` are present.
- The video's backlog status flips to **`produced`** once the video is fully assembled (files are the
  memory — this step is done because the MP4s + render manifest exist).
- Hand off to `compliance-check` (originality + policy + quality gate), then
  `publish-queue`. The thumbnail is owned upstream by `image-generation`, which generates the
  candidates into `assets/thumbs/` and, after the human picks a winner, finalizes the publishable
  `assets/thumbnail.png` (the file every downstream gate/publish step reads) — render-builder
  assembles the video only.

## Full field mapping + schema

`references/motion-schema.md` — the `motion.json` contract the engine renders: shots.json → motion
spec mapping, camera/entrance derivation, stage grouping, cutout layers + captions, placeholder cards,
and the `render.manifest.json` schema. Read it when a render looks wrong.
