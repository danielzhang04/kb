---
name: audio-analyzer
description: Measures how reference videos actually USE audio — pacing/breath, music behavior, loudness, transient density — by running deterministic tools over Demucs-separated stems, then synthesizes a measured audio-grammar that sets the channel's audio dials. Use when the user wants to measure/teardown reference-channel audio, ground the SFX/music/mastering dials in data, "analyze the reference audio", refresh the audio grammar, or add a video to the measured set — for ANY channel with a visual-kit/audio setup. Claude runs the tools and STRUCTURES the numbers; it never "listens and guesses" (a general video model hallucinated the SFX inventory — this skill is the fix). Do NOT use it to author WHEN a sound fires (that's the audio-director + the emission layer in build_audio), to source/curate SFX files (that's sfx-forge), to generate music beds, or to judge audio FEEL by ear (that stays the human's call — audio-taste-is-human-judged).
---

# audio-analyzer

Turns reference videos into a **measured audio-grammar**: deterministic numbers (loudness, speech-gap
distribution, music presence/dips/ducking, breath-around-events, transient density) aggregated into
bands that set concrete dials in the channel's `audio-tokens.json` + `universal.md §13a-iii.8`.

## The load-bearing rule (why this skill exists)

**Deterministic tools produce the numbers; the model only structures/interprets them — it never "listens".**
An earlier teardown pointed a general video model at the audio and it **hallucinated an SFX inventory that
wasn't there.** Every number here comes from ffmpeg / librosa / Demucs. Findings are tagged:

- **`reliable`** — load-bearing, sets dials (loudness, speech gaps, music presence/dips/ducking, breath-by-
  acoustic-bucket).
- **`directional`** — low-confidence, **never a dial** (onset *density* + CLAP SFX-id: SFX and music are not
  separable in the residual; narrative beats: inferred from captions, caption-quality-dependent).

Audio FEEL (does this sting land, is the bed too loud) stays the **human's** call — see the
`audio-taste-is-human-judged` memory. This skill informs those calls with numbers; it does not make them.

## Scope guardrails

- **Audio-only, never video** (`yt-dlp -x`) — no size/timeout, and cuts aren't inferable from audio or
  load-bearing for us (we control our own render's cuts). Beat maps are **narrative** (transcript-derived).
- **Deterministic + idempotent** — no wall-clock/random in the measures; stems are content-addressed by
  video id and cached. Same audio → same numbers.
- **Binaries gitignored** (`*.mp3`/`*.wav`); the scripts + `report.json`/`.md` + `synthesis.md` are the record.

## How to run

1. **Precompute (heavy, sequential, once):** `py -3 scripts/fetch_stems.py --all` — `yt-dlp -x` audio →
   `htdemucs --two-stems=vocals` → cached `mix/vocal/residual.mp3` per id under `audio-logs/_stems/`. Demucs
   is CPU-bound (~0.5× realtime here) and **out of the fan-out** so analysis stays light. `videos.json` = the
   set (ids/urls + reused-transcript pointers). Requires `demucs` installed (`pip install demucs`). **mp3 out**
   (not wav) sidesteps a torchaudio/torchcodec save crash and is transparent to the measures.
   - **Smoke gate (do this on ONE video first):** confirm both stems are non-empty and the vocal stem's
     `speech_regions` align to the transcript timestamps (±0.5s). Misaligned → STOP (timebase off).
2. **Per video:** `py -3 scripts/analyze_audio.py <id>` → `audio-logs/<id>/report.{json,md}` (reliable/
   directional split). `--clap` adds the opt-in directional SFX-tag distribution (loads a ~500 MB model; off
   by default so the fan-out stays light).
3. **Fan out:** run step 2 over every `videos.json` id (stems cached → each is light).
4. **Synthesize:** `py -3 scripts/analyze_audio.py --synthesize` → `audio-logs/synthesis.md` + `.json`
   (cross-video bands; the restrained *floor* channel excluded from target bands; ducking dropped where the
   VO is near-continuous so the gap sample is untrustworthy). **This is the human SYNTHESIS GATE artifact.**
5. **On approval,** integrate the measured laws into `universal.md §13a-iii.8` (integrate-don't-append) and
   the concrete numbers into `audio-tokens.json`; log `decisions.md`.

## Files

- `scripts/measures.py` — pure measurement functions (the tested core). `scripts/io_tools.py` — thin ffmpeg/
  librosa wrappers (smoke-only). `scripts/beat_map.py` — narrative beat map from a transcript.
- `scripts/fetch_stems.py` — the precompute. `scripts/analyze_audio.py` — per-video runner + `--synthesize`.
- `scripts/test_measures.py`, `scripts/test_beat_map.py` — hermetic (synthesized signals + captured tool
  output; never Demucs/network/CLAP). Run both after touching `measures.py`/`beat_map.py`.
- `scripts/videos.json` — the reference set. Output: `channels/<ch>/visual-kit/research/audio-logs/`.

## Testing

`py -3 scripts/test_measures.py && py -3 scripts/test_beat_map.py` (both print PASS). The real tools run only
in the precompute/smoke path, never in the unit suite.
