---
name: render-builder
description: >-
  Assembles a scripted, voiced, storyboarded, and imaged video into long-form and short MP4s with
  the project's local Remotion engine. Use when asked to render, assemble, build, produce, make the
  final cut/MP4, stitch B-roll to voiceover, or run the render step for any channel. Reads a video's
  shots.json, verified scene assets, voiceover manifest, and VO audio; writes final.mp4, short MP4s,
  motion specs, and render.manifest.json. Runs after voiceover, visual-prompt-writer, and
  image-generation, and before compliance-check and publish-queue. Do not use it to write scripts,
  plan or generate visuals, generate narration, write metadata, or upload to YouTube.
---

# render-builder

Turn a fully-prepared video folder into a finished MP4 — locally, on the Remotion engine.

## Where this sits in the pipeline

`visual-prompt-writer` → `image-generation` ∥ `voiceover` → **render-builder** → `compliance-check` → `publish-queue`

- **Reads:** `channels/<name>/videos/<slug>/shots.json` (the shot list + house style),
  **`assets/scenes/`** — the verified, style-locked stills `image-generation` pass 2 produced (one PNG
  per shot + a manifest; the pipeline default whenever its manifest exists) — the narration in
  `assets/vo.mp3` + `assets/shorts/short-NN.mp3`, and `assets/voiceover.manifest.json` (real audio
  durations, the source of truth for timing).
- **Writes:** `assets/final.mp4` (long-form), `assets/shorts/short-NN.mp4` (each `publish` short), the
  reproducible `assets/motion/<piece>.motion.json` specs, and `assets/render.manifest.json` — the
  contract `compliance-check` / `publish-queue` read (output paths + durations; `render_engine:
  remotion`, `watermark: false` — the local engine never watermarks).

The scripts do the whole job — there is no hand-authoring step. Motion is mechanical: camera locked by
default, every shot hard-cuts, layered cutout motion merged from `motion-planner`'s `shots.motion.json`
(`--motion-plan`); never hand-edit a derived motion.json. Audio is authored by `audio-director`.

## How to run it — the Remotion engine

The one path is `scripts/build_motion.py` (Python, derives the motion spec) + `engine/` (the local
Remotion component library that renders it — Node 24, Remotion 4.x pinned, `npm install` once inside
`engine/`). It re-times the shots to the real voiceover, derives a per-piece
**`assets/motion/<piece>.motion.json`** (contract: `references/motion-schema.md`), renders locally
(≈1.5× faster than realtime on this machine), and writes `render.manifest.json` — **no API, no
credits, no watermark, no length cap**.

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
#   --preview-parked     HUMAN EYE-GATE ONLY: render `parked` shots' real best-attempt pixels
#                        instead of placeholder cards, so the human judges the actual defects.
#                        Writes a separate assets/preview.mp4 + preview.render.manifest.json
#                        stamped `state: "preview-parked-included"` (so it FAILS compliance-check
#                        by construction and never overwrites the shippable final.mp4). Rewrites
#                        no review_status; unreviewed/missing shots stay hard errors.
#   --no-captions        skip the word-highlight caption track
```

**Standard operating procedure:** dry-run → read one motion.json (cut times on the right words?
stages grouped? placeholders only where expected? layered shots carry `plate`+`layers`?) → real
render. **Layered cutout motion is authored upstream, not here:** `motion-planner` emits it in
`shots.motion.json`, and `build_motion --motion-plan` merges each shot's `plate`+cutout `layers` (via
`apply_motion_plan`). In-video text is baked into the generated images, so the engine draws text only
as captions and chapter cards — `overlays[]` holds chapter cards and nothing else
(`references/motion-schema.md` §3). Never hand-edit derived timing fields; re-derive instead. Channel
look = `channels/<name>/visual-kit/motion-tokens.json` (data; engine defaults if absent).

## `scripts/render.py` — shared timing/scene helpers (not an engine)

`render.py` is **not runnable and has no `main()`** — it is the shared library `build_motion.py` and
`visual-prompt-writer/lint_shots.py` import: VO re-timing (`retime`, `retime_by_timings`), the
`vo_ref`→word-stream matcher, `resolve_scene_files`, the voiceover-manifest readers. One set of
timing/scene semantics serves both; there is no second render engine.

## What the engine guarantees (so you don't re-check by hand)

- **Visuals sync to the REAL voiceover.** Shot durations are scaled to sum to the measured VO length
  from `voiceover.manifest.json` (each shot's cadence ratio preserved); per-line timings in the
  manifest are used when present (true per-line sync). With no VO audio yet (dry-run / an unvoiced
  short) it falls back to the shots.json estimates and says so in the manifest.
- **The locked style reaches the screen (scenes mode).** Render-builder **assembles; it does not create
  the look.** When `assets/scenes/manifest.json` exists, every shot's visual is the verified PNG
  `image-generation` produced — `assets/scenes/<shot-id>.png` (shorts: `<short-stem>-<shot-id>.png`),
  seeded, rig-checked, taste-gated — auto-detected via that manifest, hosted through the media seam. A
  missing scene file for an ai-gen/hybrid shot is a **hard error** (run image-generation pass 2), never
  a silent fallback; chart/screencap/stock/archival shots (which image-generation deliberately skips)
  render as a **visible placeholder card**, counted in the manifest (`scenes_from_files` /
  `inline_fallback`). A **`parked`** shot (reviewed, defects known) is likewise not shippable — and
  because a placeholder teaches the human nothing about the defect, `--preview-parked` renders its
  real pixels into a clearly-marked non-shippable `preview.mp4` for the eye-gate instead. `still_prompt` stays authored on every shot — image-generation's input upstream.
- **Camera is furniture; the cuts carry the life.** The camera is **locked by default** (`move: none`);
  only a motion-plan stage start may author restrained `push`/`pull` punctuation (mapped to engine
  `push-in`/`pull-back`). Baseline life is opt-in too: top-level `baseline_life:true` uses the channel's
  separate calibrated token block on real scene/layer tableaux only, never placeholders or opaque cards;
  absent/false retains legacy derived JSON and frames. Every shot hard-cuts.
- **Publish gating.** Only shorts with `status: publish` in `shots.json` render by default — bench
  shorts don't render until promoted. `--all-shorts` overrides.
- **Captions.** A word-highlight track driven by our own ElevenLabs `word_timings` — exact word sync,
  no transcription — big and tight on shorts (silent-autoplay retention), a restrained band on
  long-form; styled by the channel's motion tokens. `--no-captions` opts out.
- **Handoff is a file.** `assets/render.manifest.json` lists every piece with its output path, real
  duration, and `render_engine`/`watermark: false` — the contract the gate + publisher read.

## After it runs

- Confirm `assets/render.manifest.json` exists and each expected piece has a non-null `render_url`
  and a sane `rendered_seconds`; the local `assets/final.mp4` / `assets/shorts/*.mp4` are present.
- The backlog status flips to **`produced`** once the MP4s + render manifest exist (files are the memory).
- Hand off to `compliance-check` (originality + policy + quality gate), then `publish-queue`. The
  thumbnail is owned upstream by `image-generation` — it generates candidates into `assets/thumbs/`
  and, after the human picks a winner, finalizes the publishable `assets/thumbnail.png`.
- When a render looks wrong, read `references/motion-schema.md` — the full `motion.json` contract:
  shots.json → motion-spec mapping, camera/entrance derivation, stage grouping, cutout layers,
  captions, chapter cards, placeholder cards, and the `render.manifest.json` schema.
