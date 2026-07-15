# The Second Take — audio kit generation log

Reusable bed + SFX **pool** for the Remotion engine audio layer (§13a-iii.8 grammar; realized by
`build_audio.py`). Generated ONCE via ElevenLabs and committed; the engine reuses these files at
render time (per-render cost $0). Pools (variants per role + register-mapped beds) give the
deterministic builder room to vary without sounding robotic.

## Run — 2026-07-09 (pool rebuild)
- Script: `py -3 .claude/skills/render-builder/scripts/gen_audio_kit.py channels/the-second-take`
- Account: paid **Creator** tier (commercial rights attach only on paid tiers; do NOT use Beta Services).
- Output: **14 SFX** (`sfx/<role>-<n>.mp3`) + **4 beds** (`beds/{neutral,tension,light,somber}.mp3`, ~40s) + `manifest.json`.
- Re-roll a weak asset in place: `--only pop-2,whoosh-1` (or a bed name). Names/roles stable → manifest untouched.

## Confirmed endpoints
- **SFX:** `POST https://api.elevenlabs.io/v1/sound-generation` — body `{text, duration_seconds, prompt_influence}`, returns mp3. **`duration_seconds` floored at 0.5s.** Short transients (pop/tick/whoosh/pluck) at 0.5s still read as hits.
- **Bed:** `POST https://api.elevenlabs.io/v1/music` — body `{prompt, music_length_ms}` (3,000–600,000 ms), returns mp3.

## License — RESOLVED 2026-07-09 (cleared for our use)
Verified against ElevenLabs' official blog + help center:
- Eleven Music is *"trained on licensed data and cleared for broad commercial use"*; **all paid plans include a commercial license**; explicitly permitted to *"score YouTube videos, podcasts, and social posts."* Trained via **Merlin + Kobalt** partnerships → no third-party infringement exposure.
- Constraints that don't touch us: no redistribution to music-streaming platforms (Spotify/Apple); film/TV needs Enterprise.
- **Residual (small):** no explicit written zero-Content-ID *guarantee*, but original AI audio on licensed data makes claims unlikely; creator reports are clean. Monitor as YouTube's AI policy evolves.
- Sources: [Eleven Music in the API](https://elevenlabs.io/blog/eleven-music-now-available-in-the-api) · [Can I publish content I generate?](https://help.elevenlabs.io/hc/en-us/articles/13313564601361-Can-I-publish-the-content-I-generate-on-the-platform) · [Music Terms](https://elevenlabs.io/music-terms) · [licensed-AI-music analysis](https://www.mindstudio.ai/blog/elevenlabs-music-v2-commercial-content-licensed-ai-music)

## Gain budget (measured 2026-07-09 — no bed mastering needed)
- VO source: **−18.28 LUFS**, TP −1.78. Bed source (raw ElevenLabs): **−17.19 LUFS**, TP −5.82.
- Bed ≈ VO loudness with good peak headroom → the engine's −14 dB duck gain places the bed ~13–14 dB
  under the voice as intended, and VO+bed peaks sum under 0 dBFS (no clip). Beds are used **as generated**
  (no pre-mastering). Final mix is loudness-normalized to −14 LUFS / −1.5 dBTP by the ffmpeg post-pass in
  `build_motion.py::loudnorm_pass`.
- V1 render (`_chain-test`, 2026-07-09): final −13.57 LUFS, TP −1.14; bed verified present in VO gaps
  (gap energy −20.6 dB vs raw-VO −83.3 dB), ducks under speech. Mechanically correct; taste checkpoint = user.

## SFX — CC0, hand-picked (NOT generated)
ElevenLabs SFX generation was dropped 2026-07-09 (produced water-droplets/dings, not crisp
transients). SFX are curated CC0/free-commercial sounds, human-picked (I can't judge sound).
- **whoosh-1** = Mixkit sfx #1491 (free commercial use). Re-fetch:
  `curl -L https://assets.mixkit.co/active_storage/sfx/1491/1491-preview.mp3 -o whoosh-1.mp3`
  then trim leading silence + resample 48k (see the render-builder audio_loop/stage step).
- Scope: **whooshes only** for now (still-cut scene changes). pop/tick/boom/riser/pluck deferred
  until card-content exists to validate them.
- **NOTE:** all audio binaries are gitignored (repo `*.mp3`/`*.wav` convention) — this log +
  `manifest.json` + `audio-tokens.json` are the tracked, reproducible record.

## Prompts used
See `SFX_KIT` / `BED_KIT` in `gen_audio_kit.py`. Regenerate any single asset by editing its prompt there
and re-running with `--only <name>` (idempotent overwrite).
