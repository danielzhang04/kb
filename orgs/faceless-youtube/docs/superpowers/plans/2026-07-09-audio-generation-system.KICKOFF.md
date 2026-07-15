# Kickoff prompt — Audio Generation System build

Paste the block below into a fresh Claude Code session in `C:\Users\danie\faceless-youtube` to run the build. It is self-contained.

---

Build the audio-generation system for the faceless-YouTube project, following the plan exactly.

**Read first (in order):**
1. `docs/superpowers/specs/2026-07-09-audio-generation-system-design.md` — the design + rationale.
2. `docs/superpowers/plans/2026-07-09-audio-generation-system.md` — the task-by-task plan. Follow it.

**How to execute:** Use the `superpowers:subagent-driven-development` skill — dispatch a fresh subagent per task, review between tasks. Work tasks strictly in order (0.1 → 2.4). Each task is TDD: write the failing test, see it fail, implement minimally, see it pass, commit.

**Non-negotiable rules (from the plan's Global Constraints):**
- `build_audio.py` is DETERMINISTIC — no `random`, no wall-clock; variety is feature-keys + index-rotation only.
- Blank-slate teardown: remove `build_motion.py::derive_audio`/`stage_audio_assets`/`_SFX`/`_OVERLAY_SFX`; rewrite `AudioBed`/`SfxTrack` clean on `@remotion/media`.
- Additive `render.manifest.json` (only an `audio` summary added); absent bed/SFX → engine silent, warn never throw.
- Loudness via ffmpeg `loudnorm I=-14:TP=-1.5:LRA=11`; dB→gain = `10^(dB/20)`; keep the simultaneous-lane sum < 0 dBFS (gain budget in Task 0.3).
- Python runs native: `py -3` (msys2 python lacks a CA bundle). Tests: `py -3 -m pytest`.
- **Parallel terminals on this repo:** stage EXPLICIT paths on every commit, never `git add -A`, never rewrite history.
- **STOP at V3/V4** — they are deferred to a later plan (they touch VPW/lint/schema, a shared-file collision, and need tuning from what V1/V2 sound like). Do not start them.

**The three HUMAN GATES — stop and hand back to the user, do not proceed past them yourself:**
1. **Task 0.1** — ElevenLabs Music license verification (the user must confirm in-account). Do not generate beds until the verdict is recorded.
2. **End of V0 (Task 0.3)** — the user listens to each bed/SFX in isolation and approves the palette.
3. **End of V1 (Task 1.6) and end of V2 (Task 2.3)** — the user listens to the rendered `_chain-test` slice and approves before the next phase.

At each gate: post what to listen for, what the manifest shows (bed, duck_count, sfx_count, audio_lufs), and wait. Record the verdict + any tuning in `knowledge/decisions.md`.

**Test bed:** the `_chain-test` 56s slice (`channels/the-second-take/videos/_chain-test/`). Preserve its current `assets/final.mp4` (copy before overwriting if the user wants the pre-audio cut kept).

**When done (through Task 2.4):** the channel has a working bed+SFX audio layer, loudness-normalized, verified by ear at two checkpoints; V3 (register/`beat_type`) and V4 (checker) remain as the next plan. Summarize what shipped, the two listen-verdicts, and what V3 needs.
