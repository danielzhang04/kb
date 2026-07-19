---
name: voiceover
description: >-
  Generates the narration audio for a scripted video in this faceless-YouTube project — turns a
  videos/<slug>/script.md (and every publish-tagged short) into ElevenLabs TTS mp3s plus a manifest
  that render-builder syncs visuals to. Use this whenever the user wants to voice a script, generate
  the voiceover / narration / audio / VO, "do the TTS", "record the audio", make the mp3, or run the
  voiceover step for a video or its shorts — for ANY niche. Runs AFTER long-form-writer + shorts-writer (and alongside
  visual-prompt-writer) and BEFORE render-builder. Reads script.md + shorts/*.md + the channel's
  dna.md voice config; writes assets/vo.mp3, assets/shorts/short-NN.mp3, and
  assets/voiceover.manifest.json. Do NOT use it to write the script (scriptwriter), pick titles/tags
  (metadata-writer), plan visuals (visual-prompt-writer), or assemble the final video (render-builder).
---

# voiceover

Convert a scripted video folder into finished narration audio, provider swap-able and pipeline-clean.

## Where this sits in the pipeline

`long-form-writer` + `shorts-writer` → **voiceover** ∥ `visual-prompt-writer` → `render-builder` → `compliance-check` → `publish-queue`

- **Reads:** `channels/<name>/videos/<slug>/script.md`, `shorts/short-NN.md`, and the channel
  `channels/<name>/dna.md` (voice config).
- **Writes:** `assets/vo.mp3` (long-form), `assets/shorts/short-NN.mp3` (each `publish` short),
  a readable `assets/*.txt` of exactly what was spoken, and `assets/voiceover.manifest.json` — the
  contract `render-builder` reads to sync visuals to real audio durations.

The whole job is done by one script; you almost never hand-transcribe or hand-call the API.

## How to run it

The engine is `scripts/voiceover.py` (Python 3, stdlib only — no pip install). It handles marker
stripping, chunking, the ElevenLabs call, retries, and the manifest. **Prefer it over ad-hoc curl/HTTP**
so every run is identical and resumable.

> **Interpreter note (Windows):** the API call needs an interpreter with a working TLS trust store.
> On this machine that is the native **`py -3`** launcher — the msys2 `python` ships no CA bundle and
> fails with a certificate error (the script says so and how to fix it). `--dry-run` needs no network,
> so any `python` works for it. Substitute `python`/`python3` on Linux/macOS.

```bash
# 1. ALWAYS dry-run first — parses + strips markers + writes the .txt transcripts + manifest,
#    but makes NO API call (zero TTS quota). Read the transcripts to confirm the spoken text is clean.
py -3 .claude/skills/voiceover/scripts/voiceover.py channels/<name>/videos/<slug> --dry-run

# 2. Full synthesis — long-form + every publish-tagged short.
py -3 .claude/skills/voiceover/scripts/voiceover.py channels/<name>/videos/<slug>

# Useful flags:
#   --only long-form            just the long-form (or "shorts", or "short-02")
#   --limit-chars 350           cap total chars sent to the API (cheap real smoke-test on the free tier)
#   --all-shorts                voice bench shorts too (default: publish only)
#   --pause-seconds 0.8         tune the [PAUSE] break length
```

**Standard operating procedure:** dry-run → read at least the long-form `assets/vo.txt` to confirm no
markup leaked and no `[B-ROLL]`/beat-header text is being spoken → then run the real synthesis. This
matters because TTS characters are metered (free tier = 10k/mo, no commercial license) and a bad parse
wastes real quota and money.

## What the engine guarantees (so you don't re-check by hand)

- **Only spoken words survive.** `[B-ROLL: …]` cue blocks (even multi-line), `### beat headers`,
  `> note blockquotes`, the `## SOURCES / ACCURACY NOTE` tail, and markdown emphasis are all stripped.
  `[PAUSE]` becomes a real TTS break tag, not the literal word "pause".
- **Long-form and shorts read from the right region.** Long-form = the `## LONG-FORM VOICEOVER`
  section only (so the header metadata and Sources note are never voiced). Shorts = the `## VO + cues`
  section only (so the burned-in Caption block is never voiced).
- **Publish gating.** Only shorts marked `**Status:** publish` are voiced by default — bench shorts are
  the deep bench and don't get spent quota until promoted. `--all-shorts` overrides.
- **Long scripts don't fail.** Text is chunked at paragraph boundaries under a safe per-request cap and
  stitched, with `previous_text`/`next_text` passed so prosody carries across chunk seams.
- **Durations + per-word timings for the next step.** Synthesis uses ElevenLabs' `/with-timestamps`
  endpoint, so the manifest records each piece's exact `est_duration_s` (alignment-derived, not a
  word-count guess) **and** a `word_timings` list (`[[word, start_s], …]` on the stitched timeline).
  render-builder keys visual timing off this — it places each shot at its `vo_ref`'s real timestamp
  (true per-line sync), falling back to proportional when timings are absent (e.g. `--dry-run`).

## Voice config lives in the channel's dna.md — never in this skill

One locked voice per channel is a project rule (a consistent narrator is load-bearing for the DNA and
for policy legibility). The skill reads a small **Voiceover-config block** from `dna.md`; the channel
owns the character choice, the model, and the delivery knobs. Any omitted knob falls back to a project
default. Full field list, defaults, and how to choose settings per niche/lever:
**`references/voiceover-contract.md`**. If a channel has only the legacy prose `**Voice ID (locked):**`
line, the engine still works (voice_id from prose + defaults for the rest) — but add the block when you
touch that channel.

## Choosing the voice for a new channel

Voice is a per-niche/per-lever decision, so make it deliberately when a real channel is set up (it is
intentionally NOT hardcoded here):
- Match the **locked emotional lever** in `dna.md`. Dread/morbid-awe → a calm, low, measured voice
  (let the scenario carry it, never campy). Wonder → warmer, brighter. Vindication/exposé →
  crisp, confident.
- Premium prosody tier minimum — `universal.md` documents stock/robotic TTS at ~35% drop-off in the
  first 45s. Pick a named ElevenLabs voice, lock its ID in `dna.md`, and keep it stable across videos.
- Set model + `stability`/`style` to fit: lower stability = more expressive/variable, higher =
  steadier. See `references/voiceover-contract.md` for starting points by lever.

## After it runs

- Confirm `assets/voiceover.manifest.json` exists and lists every expected piece with a non-null
  `audio` path and a sane `est_duration_s`.
- The video's backlog status stays `scripted`; it flips to `produced` only once the video is fully
  assembled (files are the memory — this step is done because the audio + manifest exist).
- Hand off to `render-builder`, which reads the manifest + `shots.json`.
