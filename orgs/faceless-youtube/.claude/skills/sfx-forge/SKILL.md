---
name: sfx-forge
description: Sources, vets, and CLAP-ranks CC0 sound effects for a channel and wires human-picked finalists into its audio pools. Use for "get a whoosh/boing/riser/sting", building/expanding the SFX set, or running the SFX audition loop, for any channel with visual-kit/audio/. Claude curates and ranks; the HUMAN judges finalists by ear on the audition and in-context render. Do NOT use it to author WHEN a sound fires (audio-director), source music beds (music-forge), or assemble video (render-builder).
---

# sfx-forge — CC0 SFX sourcing, vetting, and ranking

**What it is.** A niche-agnostic pipeline that turns a role brief into a curated, monetization-safe SFX
set. Three ready-made pieces + thin glue: **Freesound API** (CC0 source) → **objective vetting**
(ffmpeg: duration/clip/loudness/silence) → **CLAP** (a pre-trained audio-text model that ranks a clip
against a text concept — the "ear") → an **audition artifact** (embedded audio + scores) that is the
human checkpoint → picks normalized + wired into `visual-kit/audio-tokens.json sfx_pools`.

**Division of labor (load-bearing — see [[audio-taste-is-human-judged]]).** Claude sources, vets, and
ranks — objective work it can own. CLAP is a *proxy* that narrows ~40 → ~4; it does not pick. The
**human judges taste**, both on the isolated audition and (better) on the in-context render.

## The loop

1. **Configure** — roles live in `vocabulary.json` (queries · CLAP prompts · duration band · scene-use ·
   `fires_now`). This is the ONLY sourcing-config home. Widen a thin role's queries here.
2. **Run** — `py -3 scripts/forge.py run <channel> --roles a,b,c --run-id r1`
   → per role: CC0 search → duration pre-filter → download previews (cached by id) → objective vet →
   CLAP rank → top-N. Writes `visual-kit/audio/_audition/<run>/audition.html` + `candidates.json`.
3. **Audition (HUMAN GATE)** — publish `audition.html` via the Artifact tool (embedded audio plays
   in-browser; [[review-images-via-artifact-link]]). The human plays each and replies with one
   Freesound id per role (or "widen").
4. **Pick + wire** — `py -3 scripts/forge.py pick <channel> --picks picks.json` (`{role:[id,...]}`;
   multiple ids = pool variants for anti-repeat). Each is **peak-normalized to −1 dBFS** (so a pick's
   raw loudness never matters — only `sfx_gain_db` sets mix level), written to `audio/sfx/<role>-<n>.mp3`,
   its pool REPLACED in `audio-tokens.json`, and CC0 provenance recorded in `audio/manifest.json`.
5. **In-context gate** — render a piece that fires the roles; the human tunes `sfx_gain_db` by ear.

## Guarantees / traps handled

- **CC0 only** — filtered at query AND re-verified per result before a sound is eligible; provenance
  (id/license/url/uploader) logged in `manifest.json`. A non-CC0 sound in production is a Content-ID /
  whole-channel-demonetization risk.
- **Deterministic** — CLAP in eval + no_grad + pinned model; downloads content-addressed by id; no
  random / wall-clock. Same brief + cached corpus → same ranking.
- **Objective vetting is mechanical, not taste** — duration band, clip (peak > −0.1 dB), near-silent,
  long lead silence. `quality` is only a CLAP tiebreaker.
- **48 kHz normalize on ingest** (previews are assorted lossy rates).
- **Secrets in `.env`** (`FREESOUND_API_KEY`) — never in a committed file, log, or artifact.
- **Hermetic tests** — `test_*.py` use recorded fixtures + injected scorers; live network / model only
  in the human-run smoke. Audio binaries gitignored; `manifest.json` is the durable record.

## Dependencies

- `FREESOUND_API_KEY` in `.env` (token auth — instant, no OAuth for search+preview).
- `torch` + `transformers` (CLAP: `laion/clap-htsat-unfused`, ~2 GB, one-time), `librosa`, `soundfile`,
  `certifi`, `ffmpeg`/`ffprobe`.

## Scope boundary

Sourcing a role is step one; placement is a separate job. sfx-forge never decides **when** a sound
fires — `audio-director` places SFX cues by judgment (money→cash, a pivot→record_scratch, the reveal
punch, an aside→sting), realized deterministically by `render-builder/build_audio.py`.
