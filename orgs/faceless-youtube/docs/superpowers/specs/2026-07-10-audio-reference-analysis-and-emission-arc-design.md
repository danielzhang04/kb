# Reference Audio Analysis → Emission Arc — Design

**Date:** 2026-07-10 · **Status:** brainstormed, approved (design). **Scope:** this spec fully designs
**Phase 1 (reference audio analysis)** and maps the downstream arc (emission → music lane → checker) as a
**gated sequence** — the downstream phases are deliberately left loose because Phase 1's measured output is
what will inform *how* they're built (analysis-first). Each downstream phase is re-brainstormed/re-planned at
its gate.

## Why this exists

The SFX library is built (16 roles, sourced/curated/baked) but **silent** — nothing fires most of it, and the
music is a flat placeholder. Before building the emission + music layers, we measure how the reference channels
actually *use* audio, so those layers are grounded in data, not guessed. A prior teardown tried this with a
general video model (Gemini) and it **hallucinated the SFX inventory** — the lesson baked in here: **deterministic
tools produce the numbers; the LLM only structures/interprets them, never "listens and guesses."**

## The full arc (loose downstream, gated)

1. **Phase 1 — Reference audio analysis** *(fully designed below)* → **SYNTHESIS GATE** (human approves the
   measured audio-grammar).
2. **Phase 2 — SFX emission** — wire the device-card overlays (unlocks boom/pop/riser) + the opt-in comedic
   `sfx` authoring layer (unlocks the rest). *Re-planned at the gate using the measured density/timing.* → gate.
3. **Phase 3 — Active music lane** — reframe the bed into placed cues with cut/fade/volume/track-switch on
   beats. *Re-planned using the measured music behavior.* → gate.
4. **Phase 4 — V4 audio-checker** — deterministic mix measures + a thin listen-critique. → gate.

Only Phase 1 is planned in detail now. Designing 2–4 in detail before Phase 1 delivers would bake in the guesses
analysis-first exists to avoid.

---

# PHASE 1 — Reference Audio Analysis (full design)

## Goal

Produce a **measured audio-grammar** — numbers + derived laws — that concretely sets `audio-tokens.json` dials,
the emission density/timing logic, and the music-lane behavior. Every measurement must land on a knob we will
actually turn; this is not open-ended data-gathering.

## What we measure (the battery)

Each measure is tagged **[reliable]** (deterministic, load-bearing) or **[directional]** (best-effort, labeled
low-confidence, never a hard input).

**A. Pacing / breath** → sets emission timing + transition-breath dials
- **[reliable]** Speech-gap distribution — silences between VO phrases from the Demucs vocal stem (median/p25/p75).
- **[reliable]** **Breath-around-events, bucketed by event acoustic character** — at each transient/beat, the VO
  silence before it and before speech resumes. **Bucketed by the event's *measurable* acoustics** (duration,
  sustain, loudness, spectral centroid) and by `beat_type` where the reused map provides it — NOT a global
  average (a sustained dramatic event commands a full stop; a short percussive one rides under speech). Also
  computed **backwards**: correlate VO-gap length against event features (which acoustics predict a pause).
- **[reliable]** Speech rate (wpm) — from the reused transcripts.

**B. Music behavior** → sets the active music lane
- **[reliable]** Music presence % — fraction of runtime with music-stem energy above floor (settles
  continuous-bed vs sparse-cue empirically).
- **[reliable]** Dropouts/dips — count · depth · duration · **where** (aligned to reused beat times: do they
  land on punchlines/reveals/act-turns?).
- **[reliable]** Music level under VO vs in VO-gaps (ducking depth).

**C. Dynamics / loudness** → sets mastering + the gain budget
- **[reliable]** Integrated LUFS · LRA · true-peak per video; VO-vs-music level balance; overall compression.

**D. Transient density** → sets the SFX density **band** (the "how often" for emission suggestions)
- **[directional]** Onset rate on the VO-stripped residual (transients/min) — a proxy for SFX+music-hit density
  (SFX and music hits are not cleanly separable), reported as a **band**, plus whether onsets cluster around
  cuts/beats.

**E. SFX identity** → best-effort, NOT load-bearing
- **[directional]** CLAP-tag residual onsets against our role vocabulary → a rough distribution ("lots of
  whoosh-like/pop-like"). Flagged, human-spot-checked, never a hard input.

## Tooling

- `yt-dlp -x` (audio only — **never pull video**; a ~20-min audio is ~20 MB → no size/timeout pitfall).
- **Demucs** (htdemucs) — isolates the vocal (VO) stem; the non-vocal residual carries music+SFX. The one new
  install (torch already present). **Runtime is the real pitfall** (minutes/track on CPU).
- `librosa` (onset detection + spectral/duration features), ffmpeg `ebur128` (loudness/true-peak), CLAP
  (best-effort onset tagging — reuses the sfx-forge stack), the **reused motion-teardown transcripts**
  (`visual-kit/research/motion-logs/`) for grounding + timestamp alignment.
- **Beat maps are NARRATIVE, not visual.** The beat signal every alignment measure uses (dip/breath on a
  punchline/reveal/act-turn) is derived from the **transcript** — act/chapter structure + punchline/reveal
  lines, cross-checked against the audio's loudness/silence structure. **Visual cuts are deliberately not
  used:** a cut cannot be inferred from audio, video is the only reliable cut source, and cut-timing is not
  load-bearing for our build (we control our own render's cuts; the reference alignment we need is narrative).
  So no video is pulled. The 6 reused videos supply transcripts; the 2 new OverSimplified videos get a narrative
  beat map built the same way from their own transcript.

## Architecture — precompute then fan-out (the timeout guard)

```
[precompute, sequential, once]  yt-dlp -x  →  Demucs stems (vocal + residual)  →  cache under audio-logs/_stems/
        │  (heavy lift is here, cached — NOT inside the fan-out)
        ▼
[fan-out, one light worker per video]  analyze_audio.py <video>  reads cached stems + transcript + beat map
        │  runs the battery (librosa/ebur128/CLAP) → structured per-video report (JSON + md)
        │  the worker RUNS THE TOOL and structures numbers — it never "listens"
        ▼
[synthesis, one pass]  aggregate all per-video reports → the measured audio-grammar (distributions/bands/laws)
```

- **`analyze_audio.py`** is the deterministic engine (the battery as reusable, unit-testable code). Same
  input → same output. It is the substance; the fan-out just parallelizes it per video.
- Demucs is pre-run + cached so the parallel workers are fast (no agent timeout on the heavy separation).

## The video set (~8)

Reuse the motion-teardown set (transcripts + beat maps already exist): **Crayon ×3** (Palantir, Rockefeller,
Singapore), **HeyHistorically** (disappeared-8x), **OverSimplified** (Prohibition), **Kurzgesagt** (scariest
place — the restrained/low-SFX *contrast floor*, not a target). **+ 2 more OverSimplified-style** videos (our
closest comedic-history target) picked at runtime via `yt-dlp` top-views. Audio re-extracted fresh (the
teardown's video files may not persist).

## Deliverable

- **Per-video reports** + a **synthesis** in `channels/the-second-take/visual-kit/research/audio-logs/`
  (mirrors `motion-logs/`).
- The **measured audio-grammar** integrated into `knowledge/research/niche-playbooks/universal.md §13a-iii`
  (extends the existing audio grammar) + concrete dials written to `audio-tokens.json`. This is the SYNTHESIS
  GATE artifact the human approves.

## Guardrails / pitfalls (baked in)

- **Deterministic tools produce data; the LLM structures, never listens/guesses** (the Gemini fix).
- **Audio-only, never video** → no size/timeout.
- **Demucs pre-computed + cached** → heavy lift sequential, fan-out light → no agent timeout.
- **Measurement-led** — `[reliable]` measures are load-bearing; `[directional]` (transient density, SFX-ID) are
  labeled low-confidence and never a hard input.
- **Breath bucketed by measurable event acoustics + beat_type**, never a blurred global average.
- **Reuse motion-teardown transcripts + beat maps** (grounding + shortcut; don't re-derive structure).
- **Every finding carries a confidence label + its evidence** (timestamps/measures).
- **Reproducible:** `analyze_audio.py` + extracted audio + structured logs are the record. **Audio binaries
  gitignored** (repo convention); reports/synthesis/scripts are tracked.
- **Parallel terminals:** stage explicit paths, never `git add -A`, never rewrite history.

## Testing / validation

- `analyze_audio.py` has **hermetic unit tests** on synthesized fixtures (ffmpeg-generated tones/silence/known
  onsets) — e.g., a clip with a known 1.0s gap measures a 1.0s gap; a −20 LUFS tone measures ~−20; N synthesized
  onsets → N detected. No live network / no Demucs in the unit suite.
- **Sanity gate:** on one real video, the measured LUFS matches an independent ffmpeg `ebur128` read; the
  vocal-stem speech regions align with the transcript timestamps (±tolerance).
- **Synthesis gate (human):** the measured grammar is coherent + actionable (each number maps to a dial); the
  `[directional]` findings are clearly quarantined from the `[reliable]` ones.

## Risks / open items

- **Demucs separation is imperfect** — SFX and music stay tangled in the residual, so transient-density + SFX-ID
  are directional (accepted, labeled). Vocal isolation (what pacing relies on) is the strong part.
- **Demucs install / CPU runtime** — the one new dependency + the slowest step; mitigated by pre-compute+cache.
- **Narrative beat labeling is inherently softer** than a measured signal (a "punchline" is inferred from the
  transcript, not measured) — so beat-*aligned* findings (dip-on-punchline) carry a confidence notch below the
  pure-audio measures (pacing/loudness/density), and are applied uniformly across all 8 videos. Acceptable: the
  load-bearing dials (breath, ducking, LUFS, density band) need no beat map at all.

---

# Downstream phases (loose — re-planned at each gate)

**Phase 2 — SFX emission.** Two halves: (a) wire the device-card overlays in `build_motion` (chapter-card→boom,
stat-card→pop, meter/progressive-reveal→riser — none exist today), (b) an **opt-in `sfx` authoring field** on a
shot (malleable, human-placed) with `beat_type` + the measured density/timing merely *suggesting* placements —
never `beatX = always sfxX` (predictability kills comedy; decided 2026-07-10). Element-coupled SFX stay
deterministic; comedic/semantic stay opt-in. Re-planned using Phase 1's measured density band + breath-by-event
buckets.

**Phase 3 — Active music lane.** Reframe the "bed" (continuous flat drone — rejected by the user) into placed
music cues with cut / fade / volume-automation / track-switch on beats, able to go silent. Re-planned using
Phase 1's measured music presence %, dip depth/placement, and ducking levels. The mechanism (per-frame volume
automation + `music_states`) largely exists; this is a generalization + the measured behavior.

**Phase 4 — V4 audio-checker.** Deterministic mix measures every render (LUFS/true-peak/gain-budget/SFX↔VO
collisions/density vs the measured band/missing-file=0/register-events-present) + a thin listen-critique.
Re-planned using Phase 1's measured targets as the pass/fail thresholds.

## Self-review

- **Placeholders:** none — Phase 1 fully specified; Phases 2–4 intentionally loose (a stated scope decision,
  not a TODO), each with its re-plan trigger named.
- **Consistency:** measurement-led throughout; `[reliable]`/`[directional]` split consistent battery→guardrails→
  risks; the arc's gates match the phase map.
- **Scope:** Phase 1 is one implementation plan's worth (a script + tests + a precompute step + a fan-out + a
  synthesis). Downstream correctly deferred.
- **Ambiguity:** "breath by event character" pinned to *measurable acoustics + beat_type* (not SFX-ID);
  "auto-roll" pinned to *gated re-plan at each seam*, not unattended.
