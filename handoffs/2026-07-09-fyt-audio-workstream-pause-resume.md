# Handoff — audio workstream state (updated 2026-07-10)

> **⚠ SUPERSEDED for "what's next" (2026-07-10):** A2 (the SFX pool) is DONE — the SFX library was built via the
> new `sfx-forge` skill, and the workstream pivoted to the **analysis-first emission arc**. Resume from
> `docs/handoffs/2026-07-10-sfx-library-and-audio-analysis-pickup.md`. The A1/beat_type detail below is still
> accurate history.

> **▶ RESUME HERE (fresh terminal):** the `beat_type` seam + camera fix + transition-breath (A1) are BUILT,
> committed, and verified clean (all tests green, no dead/stale refs, enum consistent). **`beat_type` is now
> the control layer over the music — cut/dip proven.** The next piece is **A2 — the SFX pool** (the
> riser/boom/hit buildups that fill the breath gap on a reveal); see "Remaining audio work" below. Everything
> remaining is *additive* on the A1 foundation, not architectural. No test/cleanup is pending.

**State:** V0–V2 + the `beat_type` seam + V3 register + **transition-breath (A1)** are BUILT. Camera drift fixed
in the same arc. See decisions.md (`2026-07-10 — beat_type seam built` + `2026-07-10 — Transition-breath (A1)`)
and the plans `docs/superpowers/plans/2026-07-09-beat-type-seam-camera-and-audio.md` +
`docs/superpowers/plans/2026-07-10-transition-breath-beat-type-driven.md`.
Full audio design detail: `docs/superpowers/specs/2026-07-09-audio-generation-system-design.md`.

## What's live now
- **V1 bed** — flat ElevenLabs bed, VO-span ducked, seamless-looped, −14 LUFS loudnorm post-pass.
- **V2 whoosh** — CC0/Mixkit whoosh on scene changes (`stage_role=='base'` + `whip`). Placeholder.
- **`beat_type` seam** — 12-slug enum (`universal.md §13a-iii`), authored by VPW, HARD-linted; drives camera
  (locked by default; gravity/escalation push) AND audio register from one signal.
- **V3 register** — `build_audio.py::register_audio`: `gravity` → sustained bed `thin_span` + SFX withheld;
  `dialogue`/`aside` → SFX recede.
- **Transition-breath (A1) — DONE 2026-07-10.** `build_motion`/`breath.py` inserts a `beat_type`-driven silence
  gap (config: `audio-tokens.json breath_s_by_beat`) before a breath-beat into a derived `vo.breath.mp3` (VO +
  the writer's `[PAUSE]` prosody untouched), shifts timings once, the frame holds, and the **number-reveal DIP
  cuts the bed to silence in the gap** (−56 vs −28 dB). `beat_type` is now the control layer over the music
  (cut proven). Also fixed the **bed-loop bug** (bed tiled to full length; modulation past 31s was misfiring).
  Plan/decision: `…2026-07-10-transition-breath-beat-type-driven.md` + decisions.md 2026-07-10.

## Remaining audio work (open) — all additive on the A1 control-layer foundation
1. **A2 — SFX pool expansion** (the buildups): the riser/boom/hit that fill the breath gap on a reveal, plus
   pop/tick for cards. Currently whoosh-only; re-source the CC0 pool (partly gated on Phase-3 for element pops).
2. **Chapter track-change** (`music_states`): an engine bed-switch so the bed can change mid-piece.
3. **Fade shapes** for the dip/cut (ramp vs hard drop) — a tuning of the existing modulation.
4. **V4 audio-checker** — deterministic LUFS/clip/density measures + a thin listen-critique.
5. **A real, present music bed** to replace the flat placeholder — that's when cut/dip/fade become dramatic.

## Test bed
`channels/the-second-take/videos/_chain-test` (56s). Render: `py -3 .claude/skills/render-builder/scripts/
build_motion.py <video_dir>`. Untracked scratch; card-thin (no chapter/reveal-heavy beats — a heavier slice
is needed to fully exercise register audio). Audio binaries are gitignored; `manifest.json` + `GENERATION-LOG.md`
+ scripts are the tracked record.
