# Audio generation system — design (from-scratch rebuild)

**Date:** 2026-07-09 · **Status (updated 2026-07-10):** V0–V2 built; the `beat_type` seam + V3 register
(the audible part — `gravity` thin + SFX withhold) built in `docs/superpowers/plans/2026-07-09-beat-type-seam-camera-and-audio.md`.
The number-reveal DIP + chapter `music_states` remain deferred (need the transition-breath + an engine
bed-switch respectively — see the audio-workstream handoff). This spec's V3 section is the design; that plan is the build.
**Supersedes:** the audio portions of `2026-07-09-remotion-audio-layer-and-beat-type-seam-design.md`
(that spec's `beat_type`-seam intent is reused; its ElevenLabs kit + `derive_audio` + engine audio
components are torn out per the blank-slate decision below).

## Progress & resume state (2026-07-09)

**Shipped + validated by ear:**
- **V0** — ElevenLabs music palette (4 register beds, seamless-looped: trim → hyper-compress LRA~4 →
  equal-power crossfade → −18 LUFS). License verified (ElevenLabs Music cleared for monetized YouTube).
  `audio-tokens.json` dials. All audio binaries are **gitignored** (repo `*.mp3`/`*.wav` convention) —
  `manifest.json` + `GENERATION-LOG.md` + scripts are the tracked, reproducible record.
- **V1 — DONE, user-approved.** One **flat, consistent** bed (`GAP_LIFT_DB=0`) ducked under VO, ffmpeg
  `loudnorm` −14 LUFS post-pass. `build_audio.py` (deterministic realizer) + engine `AudioBed` rewrite.
  Bed proven continuous + on-level by ear.

**Parked (ceiling hit — placeholder only):**
- **V2 — SFX = scene-change whoosh, kept as a low-value PLACEHOLDER.** ElevenLabs SFX **dropped**
  (generation gave water-droplets, not crisp transients) → **CC0/Mixkit** (whoosh = Mixkit #1491),
  hand-picked (I can't judge sound). Whoosh fires on `stage_role=='base'` (a new set-piece) + `whip`;
  `delta→pop` removed (a still hard-cut has no animated entrance for a pop to land on). Verdict: whooshes
  "sort of" match scene shifts but need (a) **better scene-selection logic** (→ `beat_type`), (b)
  **animation** of the transition (→ Phase-3), and (c) the **transition breath** (below). Not worth more
  investment until those exist. **CC0 SFX are human-curated, not scripted** — I fetch candidates, user picks.

**Blocked on `beat_type` (the shared foundation):** V3 register audio (mood-song changes, reveal dips,
human-cost thinning) AND the transition-breath both need `beat_type` to know where sections/moods/
transitions are. `beat_type` edits VPW/lint/shots-schema — **the parallel terminal's active files** — so
it's deferred until that work settles. **Resume the audio workstream by building `beat_type` first.**

## Deferred workstream — transition-aware timing (the "breath") [larger, cross-cutting]

**The problem (user-identified, 2026-07-09):** our VO is generated **wall-to-wall**, so a scene shift +
whoosh + cut land mid-sentence and feel **overlapping/rushed**. Real videos give a transition a **breath**
— the narrator pauses, the frame holds, the whoosh/music/cut land in that gap, then narration resumes on
the new scene. This is the *"beat authors the space; audio fills it"* principle (§ core design) — and we're
currently violating it. **Likely the highest-leverage pacing fix we have**, and bigger than any SFX.

**Why it's a larger lift:** it is cross-cutting — script (author a pause at the transition beat) → voiceover
(render real silence there) → build_motion (hold the outgoing frame) → build_audio (put the whoosh/music in
the gap). It is driven by `beat_type` (which marks the transitions), so it lands in the same era as V3.
**Not a V2 patch.** Scope it as its own step once `beat_type` exists.

## Why we're redoing this

The audio layer was built once and **never worked** — not because the plumbing was wrong, but because
of three upstream failures, none of which a rewrite of the player fixes:

1. **Blind derivation.** `build_motion.py::derive_audio` infers audio mechanically from overlay/device
   cards that a normal shot doesn't have → the last render produced a bed + one dip and **zero SFX**.
2. **No authored intent.** There's no structured field telling the builder what a shot *is* (a reveal? a
   human-cost beat? a chapter turn?), so register-driven audio (dips, thins, track changes) can't fire.
3. **The loop was never closed by listening.** All lanes were built at once; nobody validated by ear, so
   monotony (one bed, one of each SFX) and mix problems were never caught.

This design keeps the one thing that is measured and correct — the audio grammar in `universal.md
§13a-iii.8` + the beat-type table — and rebuilds everything downstream of it, **staged so we hear a real
render at every step.**

## Goals

1. Every rendered piece has a continuous, loudness-normalized (−14 LUFS) music bed that sits cleanly
   under the VO, plus element-coupled SFX and register-driven dynamics — all **deterministically derived**
   from authored intent, faithful to `§13a-iii.8`, at **$0 per-render** cost.
2. A **single authored field (`beat_type`)** drives motion *and* audio off the measured table, so the two
   lanes cannot disagree.
3. **Staged delivery** with a human listen-checkpoint at the end of each stage — so quality is validated
   incrementally, not discovered at the end.
4. A repeatable **checker** (deterministic measures + a thin generative listen-critique) that we iterate on.

## Non-goals

- A true sidechain-compressor mix (v1 uses VO-span envelope ducking + dips; revisit only if it reads flat).
- Shorts (9:16) audio grammar — unstudied; shorts inherit long-form treatment until a dedicated pass.
- Re-measuring the grammar — `§13a-iii.8` is the source of truth, implemented not re-derived.
- Phase-3 element compositing / the depicted element itself moving (separate track).
- Retiring the legacy JSON2Video path.

## Decided facts (verified 2026-07-09, not assumed)

- **Source = ElevenLabs for both music and SFX.** Only option meeting every clause of our constraint:
  custom house style, **perpetually-owned outputs that survive cancellation**, **no Content ID claims on
  our uploads**, one-time cost of a few dollars. Music API $0.15/min, SFX API $0.12/min; **commercial
  rights require a paid month** (we're on Creator — fine). Suno/Udio rejected (subscription-gated rights +
  training-data legal uncertainty); subscription libraries rejected (all register with Content ID).
- **License verify gate — RESOLVED 2026-07-09 (cleared).** Verified against ElevenLabs' official blog +
  help center: Eleven Music is "trained on licensed data and cleared for broad commercial use"; **all paid
  plans include a commercial license**; explicitly permitted to "score YouTube videos, podcasts, and social
  posts"; trained via Merlin + Kobalt partnerships (no third-party infringement exposure). Constraints that
  don't touch us: no music-streaming distribution, film/TV needs Enterprise. **Generate on the Creator
  (paid) tier; do NOT use Beta Services.** Residual (small): no explicit written zero-Content-ID guarantee,
  but original AI audio on licensed training data makes claims unlikely. YouTube-Audio-Library fallback no
  longer needed. Sources in the audio GENERATION-LOG.
- **Remotion 4.0.486** (engine's pinned version). Per-frame `volume` callback, `loop`,
  `trimBefore`/`trimAfter`, multi-track summing, 48 kHz render — all **confirmed** against current docs.
  `volume` is a 0..1 linear multiplier; `dbToGain = 10^(dB/20)` is correct.
- **Two capabilities Remotion does NOT provide → our job:**
  - **No loudness normalization on render.** Add an **ffmpeg `loudnorm` post-pass** on `final.mp4`
    (target `I=-14, TP=-1.5, LRA=11`). ffmpeg 8.1.2 confirmed present.
  - **No limiter; volume can't exceed 1.0.** A **gain budget** (bed peak, SFX peak, VO peak, worst-case
    simultaneous sum < 0 dBFS) must be designed into palette mastering + the token levels.
- The engine's existing `AudioBed`/`SfxTrack`/`dbToGain` already implement the correct shape; we
  clean-rewrite them (blank slate) **to that verified shape**. **`@remotion/media` migration DEFERRED
  (2026-07-09):** `Audio` is cleanly exported from it, but it uses a newer (mediabunny) decode path not
  render-validated for our stack, whereas `remotion`'s `Audio` is already proven in this engine. Keep the
  working `remotion` import for V1; the migration is a cosmetic future-proof for later (soft-deprecated,
  not removed).

## Architecture

```
universal §13a-iii.8 (MEASURED law — untouched)
        │  (constants: densities, dip depths, gain budget, beat→treatment)
        ▼
audio-tokens.json (channel dials — DATA, mirrors motion-tokens.json — NOT a prose grammar doc)
        │
shots.json ──(VPW authors beat_type; V3+)──►  build_audio.py  ◄── vo word-timings (speech spans)
                                                    │            ◄── chapter/act structure (from shots)
                                                    │  emits
                                                    ▼
                                            audioSpec  (bed lane · SFX events · dips · thins · music-state)
                                                    │
        engine: <AudioBed> + <SfxTrack>  (clean rewrite → @remotion/media, per-frame volume)
                                                    │  Remotion mixes VO + bed + SFX (48 kHz)
                                                    ▼
                              ffmpeg loudnorm post-pass (−14 LUFS / −1.5 dBTP)  →  final.mp4
                                                    │
                              audio-checker: deterministic measures + thin listen-critique  →  iterate
```

**No new prose grammar document.** The channel dials live in `audio-tokens.json` (same pattern as the
existing `motion-tokens.json`, which already reserves an `audio_layer` key). The grammar itself is the
already-measured `§13a-iii.8`; the constants are encoded in `build_audio.py` + the tokens.

## The staged plan (each stage ends in a listen-checkpoint)

| Stage | Build | Hear | `beat_type`? | Exit criterion |
|---|---|---|---|---|
| **V0** | Verify ElevenLabs Music license in-account; generate + master the **palette pool**; write `audio-tokens.json` | the raw beds/SFX in isolation | No | palette approved by ear; license clear (or fallback chosen) |
| **V1** | `build_audio.py` v1: one bed, looped, **VO-span ducked** + ffmpeg loudnorm; engine components clean-rewrite; render-builder post-pass | a finished video whose music sits under the voice | No | bed present, ducks under VO, −14 LUFS, no clipping; sounds clean on the `_chain-test` 56s slice |
| **V2** | element-coupled SFX derived from motion entrances (whoosh-on-drop, pop-per-element, tick-on-type, boom-on-card); density-capped; SFX pools + anti-repeat | SFX landing on entrances, at Crayon-style story density | No (reads motion data) | SFX land on-frame, feel intentional/deliberate (Crayon-grade, not gimmicky), density in the measured **story band ~4–20/min** |
| **V3** | `beat_type` seam: field + lint + VPW authoring; `build_audio` reads it → multiple beds, track-change at chapters, **dip→riser→hit on reveals**, **thin + SFX-withheld on human-cost**, dialogue bed-only | the emotional dial — reveal dips, music thinning | **Yes** | register audio fires on the right beats; a gravity beat thins; a number-reveal dips |
| **V4** | `audio-checker`: deterministic measures + thin generative listen-critique | pass/fail + "feels samey here" | — | checker catches a seeded defect; findings are actionable |

Rationale: V1+V2 ship fast and de-risk the whole thing **before** we touch VPW/lint/schema. V1 is the
foundation (a bed that sits under the voice), but this is an **animation/cartoon channel** (Crayon Capital
lineage) — SFX are part of the identity, so V2 is essential, not optional garnish. It targets the measured
**story band (~4–20 transients/min)**, coupled to the element layer and used deliberately (the Crayon
grade: not drowning in SFX, but clear, well-placed usage — per our own reference teardown). `beat_type`
only enters at V3, when register audio genuinely needs it.

## Components

### 1. Palette + `audio-tokens.json` (V0)
- **Purpose:** the fixed, reusable, monetization-clean source pool + the channel dials that give the
  deterministic builder room to vary without sounding robotic.
- **Palette (one-time, committed to `channels/the-second-take/visual-kit/audio/`):**
  - **Beds** (register-mapped): `neutral`, `tension`, `light`, `somber` — each instrumental, loopable,
    mastered to **LRA ~3.5 LU** and a fixed peak ceiling (gain-budget input). ~30–45 s loops.
  - **SFX pools** (2–3 variants of the common ones for anti-repeat): pop×3, tick×2, boom×2, whoosh×3,
    riser, pluck×2, sting — matched to the `§13a-iii.8` event vocabulary, dry, short, clean transients.
  - `audio/manifest.json` — every asset + its role + the generation prompt (the "why" survives).
- **`audio-tokens.json`** (new, beside `motion-tokens.json`): `bed_by_register` map, `sfx_pools`,
  `sfx_per_min_story` density cap, `bed_db_under_vo`, `duck_db`/`duck_ramp_s`, `dip_db`/`dip_s`,
  `thin_extra_db`, and the **gain budget** (per-lane peak ceilings). Data only; the engine + builder use
  neutral defaults if a key is absent.
- **Depends on:** ElevenLabs API (`gen_audio_kit.py`, rebuilt), the license verify gate.

### 2. `build_audio.py` — the deterministic realizer (V1→V3)
- **Purpose:** turn authored intent + timing into an `audioSpec`. The audio sibling of `build_motion.py`.
  Replaces the torn-out `derive_audio`.
- **Inputs:** the shot list (with `beat_type` at V3), VO word-timings (`voiceover.manifest.json` — for
  speech-span ducking + landing SFX/dips on the right word), the derived motion (entrances, for
  element-coupled SFX), `audio-tokens.json`.
- **Output:** an `audioSpec` (schema below), plus a `render.manifest` audio summary.
- **Determinism & variety:** picks within SFX pools by **feature-key first** (entrance type, run
  position), **index-rotation as tiebreaker** (anti-repeat within N seconds). Music state is a function of
  **act/register**, not per-shot randomness. Same inputs → same output (unit-testable, à la
  `test_build_motion.py`).
- **VO-span ducking (v1 improvement over constant offset):** read speech spans from word-timings; hold
  the bed at `bed_db_under_vo` during speech, lift toward `bed_lu_range` top in VO gaps, short ramps at
  span edges. Deterministic, no compressor needed.
- **Depends on:** `audio-tokens.json`, `voiceover.manifest.json`, the motion derivation.

### 3. Engine audio components (V1)
- **Purpose:** play the `audioSpec` — a movie-level ducked/looped bed + one-shot SFX at exact frames.
- **Interface:** `<AudioBed audio={audioSpec}>` (per-frame `volume` callback: base duck, dips, thins,
  ramps) + `<SfxTrack audio={audioSpec}>` (`<Sequence from>` + one `<Audio>` per event). `dbToGain =
  10^(dB/20)`. Absent bed → silent (warn, never throw — additive layer).
- **Change:** clean-rewrite to the verified shape; **standardize `Audio` on `@remotion/media`**.
- **Depends on:** Remotion 4.0.486, the staged asset dir.

### 4. Loudness + mix post-pass (V1) — in `render-builder`
- **Purpose:** hit YouTube's −14 LUFS target and guarantee no inter-sample clipping, which Remotion won't
  do.
- **Interface:** after Remotion writes the MP4, run ffmpeg `loudnorm` (`I=-14:TP=-1.5:LRA=11`, two-pass
  preferred) → the final file. Record measured LUFS/TP in `render.manifest`.
- **Depends on:** ffmpeg 8.1.2 (present).

### 5. `beat_type` seam (V3)
- **Field:** one required `beat_type` per shot ∈ the 11-value enum = the 10 measured rows + a labeled
  executor default **`narration`** (locked camera, micro-drift, one element/noun, bed-only). Codified in
  `§13a-iii`, authored by **VPW** (classification, "pick the row" guide), **retires** the frozen prose
  `ken_burns`/`within_shot_motion` (their treatment now derives from `beat_type`).
- **Lint:** `lint_shots.py` HARD-checks present + in-enum on every shot.
- **Audio-relevant collapse:** audio only distinguishes a handful — `number-reveal` (dip→riser→hit),
  `gravity/human-cost` (thin, SFX withheld), `chapter-boundary` (boom + bed track-change),
  `dialogue`/`aside` (SFX recede), everything else → default bed + element SFX. The field stays the full
  11 because it is **shared with `build_motion`** (motion needs all rows); audio adds no authoring cost.
- **Collision note:** this edits VPW / `lint_shots.py` / `shots-schema.md`. Stage explicit paths on every
  commit; never `git add -A` (parallel terminals). Do not start V3 until V1/V2 are landed and VPW is
  quiescent.

### 6. `audio-checker` (V4)
- **Purpose:** close the loop repeatably. Two layers:
  - **Deterministic measures** (cheap, run every render): final LUFS/true-peak within target;
    per-lane headroom (no clip); SFX events that collide with a VO word (should duck or move); SFX
    density vs the format dial; presence of expected register events (a gravity beat did thin).
  - **Generative listen-critique** (thin, on demand): a subagent that "listens" (or reads the audioSpec +
    spot samples) and flags repetition / flatness / a sting stepping on VO — the fresh-eyes critic
    pattern. Findings feed token/pool tuning. **v1 keeps this minimal**; deterministic measures carry the
    weight.
- **Depends on:** ffmpeg (measurement), the render output.

## `audioSpec` schema (additive, v1→v3 grows it)

```jsonc
{
  "bed": "audio/beds/neutral.mp3" | null,
  "bed_db_under_vo": 14,                 // base duck under VO
  "duck_spans": [{ "at_s": n, "dur_s": n, "to_db": -14 }],   // VO-span envelope (V1)
  "music_states": [{ "at_s": n, "bed": "tension" }],          // track changes at act/chapter (V3)
  "events": [{ "sfx": "whoosh", "at_s": n, "gain_db"?: n }],  // element-coupled SFX (V2)
  "dips":   [{ "at_s": n, "depth_db": -40, "dur_s": 0.6 }],   // silence-scalpel on reveal/gravity (V3)
  "thin_spans": [{ "at_s": n, "dur_s": n, "extra_db": 8 }]    // human-cost thinning (V3)
}
```
Additive → `render.manifest.json` stays compatible for compliance/publish (only an `audio` summary is
added: `{bed, sfx_count, dip_count, thin_count, lufs, true_peak}`).

## Data flow (end state)

`long-form-writer` (script + rare `[PAUSE]` beat cues) → `VPW` (shots.json + `beat_type`) → `voiceover`
(vo.mp3 + word-timings; pauses become real silence) → `image-generation` (stills) → **render-builder**:
`build_motion.py` (camera/element/timing) ∥ `build_audio.py` (bed/SFX/dips/thins) → engine mixes →
ffmpeg loudnorm → `final.mp4` → `audio-checker`.

## Testing / validation (per stage, by ear + by measure)

- **V0:** play each bed/SFX in isolation; confirm loops seamless, SFX transients clean; license verified.
- **V1:** render the `_chain-test` 56 s slice — bed present, ducks under VO, gaps lift, measured −14 LUFS,
  no clip. **Listen checkpoint.**
- **V2:** dry-run shows SFX on the right entrance frames; render — SFX land on-frame, sparse, intentional.
  **Listen checkpoint.**
- **V3:** `lint_shots.py` passes on a `beat_type`-annotated slice; dry-run diff shows a gravity beat
  thinning + a number-reveal dipping + a chapter boom/track-change; render. **Listen checkpoint.**
- **V4:** checker flags a deliberately-seeded defect (a clipping mix / a repeated SFX / a mis-normalized
  file); findings actionable.
- All stages: `render.manifest` audio summary present; schema unchanged for downstream consumers.

## What gets torn out (blank-slate inventory)

`build_motion.py::derive_audio` + `stage_audio_assets` + the `_SFX`/`_OVERLAY_SFX` maps; the current
`AudioBed`/`SfxTrack` (rewritten clean); the old single-bed + one-of-each ElevenLabs kit + its stale
`manifest.json`; the uncommitted `gen_audio_kit.py` SFX re-roll (superseded by the V0 palette build). The
measured grammar (`§13a-iii.8`) and the `beat_type` *intent* from the prior spec are **kept**.

## Risks / open items

- **License (V0, blocking):** ElevenLabs Music monetization/Content-ID terms — verify in-account; fallback
  ready.
- **Mix realism:** VO-span ducking + dips, not a true sidechain. Acceptable for the measured "flat bed,
  silence-as-scalpel" grade; the checker + checkpoints catch it if flat.
- **SFX taste:** this is a cartoon/animation channel where SFX are core identity (Crayon-style) — the risk
  is *random or excessive* SFX reading cheap, NOT SFX per se. Mitigation: feature-coupled placement (sound
  differs because the motion differs), the story-band density dial (~4–20/min), and the human checkpoint.
- **`beat_type` authoring accuracy:** an LLM classifying beats can mis-tag; low-stakes (mis-placed dip,
  not a crash), caught by checker/human.
- **Palette quality:** generative SFX/music can come out weak (prior kit needed a punch re-roll) — budget
  a prompt-iteration loop in V0; one-time cost.
- **Parallel-terminal collision (V3):** VPW/lint/schema are shared files — stage explicit paths, never
  `git add -A`, don't start V3 until VPW is quiescent.
- **Doc drift to fix in passing:** CLAUDE.md status + `motion-tokens.json` `audio_layer` (FUTURE) get
  reconciled as V1/V3 touch them.
```
