# PICKUP — audio-director dogfood on a real video (2026-07-12)

> **▶ RESUME HERE.** The audio system is BUILT + the audio-director rework is DONE + committed
> (`4b1a0db`). It has only ever been ear-gated on the synthetic `_chain-test` fixture — it has **never run
> on a real full-length video.** That validation is the whole task now: run **`audio-director`** on a real
> video, render, and ear-gate the mix. No more building.

## The task (one thing)
Dogfood `audio-director` → `audio-plan.json` → render → **human ear-gate** on a REAL video. Recommended
video: **Poyais** (`channels/the-second-take/videos/2026-07-04-poyais/`) — it has `shots.json`, and its
con-story exercises the wry/`sneaky` register + a human-cost `dry` drop. A clean pass here also settles two
of the three named follow-ups (below).

## Steps
1. **Invoke the `audio-director` skill** on Poyais (it reads `shots.json` + `script.md` + the channel
   `audio-tokens.json` + `grammar-guidance.md`; timid-by-default → fresh-eyes critic → `lint_audio_plan.py`
   → writes `videos/2026-07-04-poyais/audio-plan.json`).
2. **Render + ear-gate.** `render-builder` picks up `audio-plan.json` automatically. **VO dependency:**
   Poyais has only `assets/preview-midsection.mp3`, NOT a full `vo.mp3`/`voiceover.manifest.json`. So either
   (a) cheap first pass — author + render the **midsection slice** that already has audio, or (b) render the
   full Poyais VO first (`voiceover` skill, costs ElevenLabs quota) for a whole-video gate. Start with (a).
3. **Ear-gate the render in the Windows player** (VS Code preview is muted on this machine). FEEL is the
   human's call — levels, pause lengths, whether a whoosh/boom should fire here, mood fit, the human-cost
   drop. Tune by ear; the dials are DATA in `audio-tokens.json` (don't change logic for a feel fix).

## What a clean dogfood resolves (the 3 named follow-ups)
- **Human-cost music drop** — does the FULL drop read weird on a real narration? (candidate: a partial-thin.)
- **`casual-bed` settle** — it's still PROVISIONAL; its real settle is under a full front-half narration.
- **Device-card SFX** (stat/counter/meter → pop/riser/pluck) — dormant until the visual/animation work ships
  those overlays; NOT part of this gate (a dependency, not a bug).

## Watch for (the rework's own top risk)
Structural sounds (whoosh/boom/pop) are now placed by **director judgment**, not auto-fired. On `_chain-test`
(3 beats) that was fine; a 10-min video has many more scene changes/chapters. Watch for **under-cueing** or an
inconsistent critic. Correct failure direction = too few. Whoosh is RARE (~0–2/video); pop = additive-only.

## State on disk
- `audio-director` skill: `.claude/skills/audio-director/` (SKILL.md + references/{grammar-guidance,critics}.md).
- Reference render (the approved feel): `videos/_chain-test/assets/final.mp4` + `_chain-test/audio-plan.json`.
- Poyais: `shots.json` ✓, `script.md` ✓, `shots.motion.json` ✓; assets = plates/cutouts/library +
  `preview-midsection.mp3` (partial VO) + `render/`.

## Depth pointers (read ONLY if needed)
- Rework spec: `docs/superpowers/specs/2026-07-12-audio-director-rework-design.md`.
- Decision log: `knowledge/decisions.md` → "2026-07-12 — Audio-director rework" entry.
- Schema: `render-builder/references/audio-plan-schema.md`. Grammar: `universal.md §13a-iii.8`.

## Housekeeping (not blocking)
- Two files are UNSTAGED on purpose (they carry another terminal's WIP "Growth research"): `knowledge/
  decisions.md` (has the rework entry) + `knowledge/research/growth-optimization.md`. They'll commit with
  that terminal's batch; the working-tree content is correct. Don't `git add -A`; stage explicit paths.
