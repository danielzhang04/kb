---
name: music-forge
description: Sources, objectively vets, and CLAP-ranks casual-comedic music beds (CC-BY, Incompetech / manual YouTube-Audio-Library drops) for a channel by mood bucket, then wires the human-picked finalists into the channel's `music_pools`. Use whenever the user wants to source/find/add music, build or expand the music library, "get a casual/comedic bed", run the music audition, or run the music sourcing step — for ANY channel with a `visual-kit/audio` setup. Claude does the curation (fetch CC-BY → vet loop-ability/loudness/duration → CLAP-rank); the HUMAN ear-gates the pick on the audition board. Do NOT use it to author WHEN music plays (that's the Phase-3B music-cue layer), to AI-generate music, to source SFX (`sfx-forge`), or to assemble the video (`render-builder`).
---

# music-forge — casual-comedic music sourcing, vetting, and ranking

**What it is.** A niche-agnostic pipeline that turns the channel's mood-bucket taxonomy into a curated,
monetization-safe music bed set. Same shape as `sfx-forge`, reused where it can be (G4): CC-BY source
(Incompetech, or a manual YouTube-Audio-Library drop) → **objective vetting** (loop-ability / loudness /
duration) → **CLAP** rank against the bucket's mood prompt → an **audition artifact** (embedded audio +
scores) that is the human checkpoint → picks loudness-normalized + wired into
`visual-kit/audio-tokens.json music_pools`.

**Division of labor (load-bearing — see [[audio-taste-is-human-judged]]).** Claude sources, vets, and
ranks — objective work it can own. CLAP narrows the field; it does not pick, and on full music clips it
is a *stronger* aid than it is on SFX transients but it's still a ranking aid, not a verdict. The
**human judges taste**, both on the isolated audition board and (better) later, in the Phase-3B render,
where the bed is judged looping under real narration.

## When it runs

A channel-setup / library-build step, same footing as `sfx-forge` — run it once (or re-run to widen a
thin bucket) to stock the channel's music library. It is a **prerequisite for the Phase-3B music-cue
lane** (which will decide *when* a bed plays); it does not itself place anything in a video.

## Inputs

- `music-buckets.json` (this skill's own config: the mood-bucket taxonomy, Incompetech seed names, CLAP
  prompts, duration bands, pick counts). This is the only sourcing-config home — read it, don't restate
  its contents here.
- `channels/<channel>/visual-kit/audio/incoming/<bucket>/` — the drop folder candidates are vetted from.
- The measured audio grammar (`universal.md §13a-iii.8` + `visual-kit/research/audio-logs/synthesis.md`)
  for target loudness/placement context — Phase-3B will lean on this more than this skill does.

## The flow

1. **Fetch** — `py -3 scripts/fetch_incompetech.py <channel>` populates `incoming/<bucket>/` from the
   seeds in `music-buckets.json` (CC-BY, Kevin MacLeod). And/or manually drop YouTube-Audio-Library
   "Comedy"-category tracks into `incoming/<bucket>/` and add a `sources.json` line for provenance.
2. **Board** — `py -3 scripts/music_forge.py board <channel>` vets every candidate (loop-ability,
   loudness, duration band) and CLAP-ranks it against the bucket's mood prompt, writing
   `visual-kit/audio/_audition/music/audition.html`.
3. **Audition (HUMAN GATE)** — publish `audition.html` via the Artifact tool (embedded audio plays
   in-browser; [[review-images-via-artifact-link]]). The human listens and replies with the track
   name(s) to keep per bucket.
4. **Pick + wire** — `py -3 scripts/music_forge.py pick <channel> --picks picks.json` loudness-normalizes
   the chosen tracks to `music_norm_lufs`, writes them to `audio/beds/`, wires `music_pools` in
   `audio-tokens.json`, and records CC-BY credits (Kevin MacLeod attribution). `picks.json` is
   `{ "<bucket>": ["<track name as shown on the audition board>", ...] }` — the board's displayed name
   (a stem) resolves to the real incoming file regardless of extension, so the human can reply with
   exactly what they see; an unresolved name is warned and excluded, never silently wired into the pool.
5. **In-context gate** — the eventual Phase-3B render re-gates the pick by ear, looping under real VO —
   the isolated audition is a pre-filter, not the final word.

## Two registers, both restrained — NOT cinematic

The channel carries two music registers, and the mood bucket names which one a scene draws from:

- **Casual-comedic idiom** (Crayon-Capital): a light, quirky groove that rides under narration —
  buckets `casual-bed` / `upbeat` / `sneaky`, sourced from Incompetech's comedic catalog.
- **Restrained exposé-underscore** (added 2026-07-17 retrack — decisions.md): a present, credible
  instrumental underscore that reads serious-but-not-dramatic — buckets `underscore` (the DEFAULT
  con-spine bed, replacing the meme-coded `sneaky` cues as default) and `somber` (the elegiac button
  tail). Understated pizzicato/strings/keys tension, soft mystery, noir investigation, dignified solo
  piano — present at ~2-3 dB under VO, never buried.

The hard boundary in BOTH registers: **NOT a movie score, NOT a big cinematic tension/stinger cue.**
The retrack widened the register toward credible restraint; it did not open the door to dramatic
scoring. If a candidate reads as a swelling cinematic stinger or a dramatic set-piece score, it
doesn't belong in any pool regardless of how well it loops. The `sneaky` and `Monkeys Spinning
Monkeys` meme cues STAY in the library for occasional *deliberate* comedic use — they are just no
longer the default.

## Objective vet, human taste (G6)

Claude runs the fetch, the objective vet, and the CLAP ranking — all mechanical or model-scored, none of
it a taste judgment. The *feel* pick is the human's call end to end
([[audio-taste-is-human-judged]]): CLAP is a semantic-match proxy that's usefully stronger on full music
clips than it is on short SFX transients, but it still only narrows the board — it never substitutes for
the ear-gate.

## Scope boundaries

music-forge sources, vets, and installs the BEDS into `music_pools`. It does **not**:

- author *when* a bed plays or which bucket a scene calls for — that's the Phase-3B music-cue layer
  (not yet built; parallel to `audio-cue-writer`'s SFX role);
- AI-generate music — everything here is a real CC-BY recording, sourced and credited, same
  monetization-safety posture as `sfx-forge`'s CC0 SFX;
- source sound effects — that's `sfx-forge`;
- assemble or render the video — that's `render-builder`.
