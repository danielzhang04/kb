# Remotion Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build the Remotion 2.5D motion engine into render-builder per
`docs/handoffs/2026-07-08-remotion-engine-prompt.md` — Phase 1 spike (hard human gate), then Phase 2
engine v0 + motion.json + the JSON2Video→Remotion swap.

**Architecture:** Fixed component library in `.claude/skills/render-builder/engine/` (npm project;
node_modules gitignored) rendering a per-video `motion.json`. SSR via `@remotion/bundler` +
`@remotion/renderer` (bundle once → selectComposition → renderMedia h264). Captions + word-synced
overlays driven by our own ElevenLabs `word_timings` (no transcription). Remotion pinned **4.x**
(free license ≤3 people confirmed; 5.0 changes terms — revisit then).

**Tech Stack:** Node 24 (present), Remotion 4.x, React 18, TypeScript (bundler-handled). Python
stdlib for glue. `rembg` for the cutout side-test only.

## Global Constraints

- Explicit `git add <paths>` only; other terminals are active. Commit per phase.
- Do not touch: vo_ref/lint_shots.py contract, image-generation, style-bible locked values.
- Hard cuts only; idle motion baseline on every shot; engine is niche-agnostic (channel look = data).
- Phase 1 ends at a HARD GATE: user reviews the MP4 + render-time numbers before Phase 2.

## Phase 1 — Spike

### Task 1: Scaffold engine
- [ ] `.claude/skills/render-builder/engine/`: package.json (remotion/@remotion/bundler/@remotion/
      renderer ^4.0.0, react/react-dom ^18), tsconfig, .gitignore (node_modules/, out/, public/*.mp3),
      src/index.ts (registerRoot), src/Root.tsx (Composition "Spike", 1920×1080@30), render.mjs (SSR
      script with wall-clock timing printed).
- [ ] `npm install` (background), verify versions.

### Task 2: Real VO slice + timings
- [ ] Reuse the voiceover engine's ElevenLabs call (read `voiceover.py`, mirror its
      /with-timestamps request; Miles voice + settings from dna.md) in a scratchpad one-off:
      ~27-word Poyais line → `engine/public/vo-spike.mp3` + generate `src/vo-timings.ts`
      (`export const WORDS: [string, number][]`). A few hundred chars of quota.

### Task 3: Spike composition (3 shots, inline components)
- [ ] Shot 1: `refs/base/base.png` copied to public/ — springy push-in + idle bob + StatCard
      popping on the word "thousand" ("£200,000").
- [ ] Shot 2: expression frame — whip-in entrance (spring overshoot), hard cut.
- [ ] Shot 3: action frame — slow pull-back. Cuts anchored to word timestamps.
- [ ] Word-highlight caption band across all shots from WORDS. `<Audio>` VO track.

### Task 4: Render + measure
- [ ] `node render.mjs` → out/spike.mp4; record wall-clock, fps throughput, file size.
- [ ] Play-path + numbers reported to user.

### Task 5: rembg side-test (T3 data)
- [ ] `py -3 -m pip install rembg[cpu]` (or onnxruntime path); run on one flat-cel character frame →
      cutout PNG; report edge quality honestly.

### Task 6: GATE
- [ ] Commit engine scaffold (explicit paths). Report: render time, paths, friction, recommendation.
      STOP for user approval.

## Phase 2 — Engine v0 + swap (after gate; plan detail written then, informed by spike findings)

- motion.json schema (brainstorm; derivable-first from shots.json/ken_burns/within_shot_motion/
  on_screen_text/word_timings) → `references/motion-schema.md`.
- T1+T2 component library (CameraRig, IdleMotion, ImpactShake, PaletteShift, PopIn/SlideIn/StampDown,
  ProgressiveReveal, Counter, StatCard, ChapterCard, Meter, DefinitionCard, SubtitleTrack, AudioTrack)
  + per-channel style tokens as data.
- Builder: shots.json + scenes manifest + voiceover manifest → motion.json → renderMedia. 16:9 + 9:16.
  Same scenes-mode resolution + hard-error rules as render.py.
- Parity checklist: per-line vo_ref sync, VO track, captions, overlays, publish gating,
  dry-run-equivalent validate, render.manifest.json same schema (engine: "remotion", watermark: false).
- Swap: Remotion default; `--engine json2video` legacy. SKILL.md rebuild (skill-creator), schema refs,
  README row, CLAUDE.md, decisions.md. End-to-end validation on the spike slice + a 9:16 slice.
