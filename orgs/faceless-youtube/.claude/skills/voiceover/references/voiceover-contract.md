# voiceover — config & output contract

Two things the rest of the pipeline depends on: the **Voiceover-config block** the skill reads from
`dna.md`, and the **manifest** it writes for `render-builder`.

## 1. The dna.md Voiceover-config block

Put this fenced block inside the channel's `## Voice & style` section of `dna.md`. The engine finds the
first fenced code block containing `voice_id:` and reads simple `key: value` lines (no YAML library
needed). Every field except `voice_id` is optional and falls back to the project default shown.

````markdown
### Voiceover config (machine-read by the `voiceover` skill)
```yaml
voice_id: JBFqnCBsd6RMkjVDRZzb   # REQUIRED — the channel's one locked ElevenLabs voice
model_id: eleven_multilingual_v2 # default; eleven_v3 = most expressive, turbo = cheapest/fastest
stability: 0.45                  # 0–1. lower = more expressive/variable, higher = steadier/flatter
similarity_boost: 0.8            # 0–1. adherence to the original voice timbre
style: 0.15                      # 0–1. style exaggeration; keep low for calm narration
use_speaker_boost: true          # clarity/consistency boost
speed: 1.0                       # 0.7–1.2. narration pace
output_format: mp3_44100_128     # mp3 sample-rate_bitrate; bitrate also drives duration estimate
```
````

### Starting points by locked lever
These are defaults to adjust, not rules — the point is to match delivery to the channel's one lever.

| Lever (dna.md) | Feel | stability | style | speed |
| --- | --- | --- | --- | --- |
| Morbid awe / dread | calm, low, clinical — let the scenario carry it | 0.55–0.65 | 0.05–0.15 | 0.95–1.0 |
| Wonder / awe | warm, bright, unhurried | 0.4–0.5 | 0.2–0.35 | 1.0 |
| Vindication / exposé | crisp, confident, deliberate | 0.5–0.6 | 0.15–0.3 | 1.0–1.05 |
| Righteous anger | urgent, weighted | 0.35–0.5 | 0.3–0.45 | 1.0–1.1 |

Model note: `eleven_multilingual_v2` is the reliable default (full voice-settings support). `eleven_v3`
is more expressive but newer — prefer it only once verified on the channel's key. `eleven_turbo_v2_5`
is cheapest/fastest for high-volume shorts.

### Expressive delivery markers and dry-run review

The script may use only these exact writer-facing markers, each immediately before a sentence:

`[emote: curious]`; `[emote: knowingly]`; `[emote: sternly]`; `[emote: sighs]`;
`[emote: exhales]`; `[aside: dry]`

Use them sparsely at a real chapter, reveal, or mood turn. Never put them next to each other; punctuation
remains the main rhythm tool. Unknown, malformed, adjacent, or mid-sentence expressive markup is a hard
error before any provider request. On `eleven_v3`, the engine translates the markers to Eleven audio tags
`[curious]`, `[knowingly]`, `[sternly]`, `[sighs]`, `[exhales]`, and `[deadpan]`. On v2 it strips every
approved expressive marker, preserving the spoken sentence and existing v2 pause behavior. No v3 setting
change follows from a marker: any stability audition remains one chapter and a human ear gate.

`--dry-run` is the zero-spend request-shape review. It writes the normal transcript and manifest while
reporting the configured effective settings, v3 and v2 cleaned request chunks, cleanup, and seam locations.
v3 cannot use `previous_text`/`next_text`, so the planner prefers a substantial chapter/mood-turn paragraph
for a forced seam; otherwise it uses the nearest paragraph or sentence boundary and marks the seam for ear
review. The report is planning only: it does not alter the channel's paid configuration or make a request.

### Measured delivery targets (2026-07-04 reference-channel audio analysis)

A measured pass on 5 reference channels (Crayon Capital, Patrick Boyle, Casually Explained, Half as
Interesting, HeyHistorically — full audio via ffmpeg `ebur128`/`silencedetect`) drives these settings.
**The goal is NOT a flat AI read** — but the fix is not what people assume:

- **Liveliness is PITCH + sentence-variance, never VOLUME.** Every channel's loudness range was *flat*
  (1.8–3.7 LU) — none of them manufacture energy with volume swings. So don't expect or fake loudness
  dynamics; the life comes from an expressive *voice* and the *script's* varied sentence lengths.
  Practically: **pick a voice with genuine pitch life** (not a flat news-reader), set **stability
  moderate-to-low (~0.4–0.5)** so pitch actually moves, with **some style (~0.15–0.3)** — low enough to
  stay stable, high enough to not be monotone. Tune on the real voice; monotone *pitch* is the enemy,
  flat *loudness* is fine.
- **Pace is persona-dependent — don't chase a single wpm number.** *(2026-07-05 correction, from The Second
  Take voice audition.)* The old "≈145–150 wpm" default was measured off **dry/calm** channels (Crayon/Boyle/
  HeyHistorically ~144); it is **wrong for a young/energetic persona**, which can sit at **~180–200 gross wpm**
  and still feel comfortable. The real driver of *perceived* pace is **articulation rate + pause share**, NOT
  gross wpm: a voice can rattle words off fast yet feel relaxed if it pauses ~25% of the time (measure silence
  with ffmpeg `silencedetect`). **Set pace by matching the persona's feel + ~20–30% pause share**, and let the
  chosen voice run at **speed 1.0** unless it's clearly too fast/slow. (The Second Take locked "Jake" at ~195
  gross / ~26% pause — energetic but breathing; do not slow it to 145.)
- **Pauses are rare, structural, AND short.** The admired channels run near wall-to-wall with only
  a handful of real pauses (a reveal, an act break). Let **punctuation carry most of the cadence**
  (periods = full stops, commas = catches — scripts are written this way), and spend the tiered pause
  cues sparingly. **Keep them short** *(2026-07-06 correction, from the v3 Poyais auditions):* human/library
  voices already breathe at punctuation, so an injected pause **stacks on top** of a natural one and reads
  too long. Our pauses punctuate, they don't stall. Current engine mapping (v3): **`[BEAT]` → natural (no
  tag; the voice's own micro-pause carries it) · `[PAUSE]` → a short pause · `[PAUSE:LONG]` → a normal pause**
  (dialled down from a "long pause"). A wall of identical `[PAUSE]`s is its own metronome, and dense breaks
  make ElevenLabs unstable.
- **Flat, compressed loudness is CORRECT** — it's the industry norm and it's what lets a deadpan line
  land; don't post-process volume drama in.

## 2. The manifest (assets/voiceover.manifest.json)

`render-builder` reads this to sync visuals to the real audio. Shape:

```json
{
  "generated_by": "voiceover",
  "video_dir": "2026-07-02-car-sinks",
  "channel_dna": "channels/_test-pipeline/dna.md",
  "voice_id": "JBFqnCBsd6RMkjVDRZzb",
  "model_id": "eleven_multilingual_v2",
  "output_format": "mp3_44100_128",
  "voice_settings": { "stability": 0.55, "similarity_boost": 0.8, "style": 0.1, "use_speaker_boost": true, "speed": 1.0 },
  "wpm_constant": 150,
  "long_form_est_runtime_s": 601.2,
  "total_char_count": 9421,
  "dry_run": false,
  "pieces": [
    {
      "piece": "long-form",
      "source": "script.md",
      "audio": "assets/vo.mp3",
      "transcript": "assets/vo.txt",
      "short_status": "-",
      "char_count": 9012,
      "est_duration_s": 601.2,
      "duration_basis": "cbr-mp3-size",
      "chunk_count": 5,
      "state": "synthesized"
    }
  ]
}
```

Field notes for downstream skills:
- **`audio`** — path relative to the video dir. `null` if the piece was dry-run or budget-skipped.
- **`est_duration_s`** — from the real mp3 when synthesized (CBR-bitrate size estimate; render-builder
  or ffprobe may re-measure exactly), or a word-count ÷ 150 wpm estimate in `--dry-run`.
- **`long_form_est_runtime_s`** — cross-check against the script header's `Estimated runtime`. A large
  gap means the script word count and the spoken text diverged (markers, edits) — worth a look before
  rendering.
- **`state`** — `synthesized` | `dry-run` | `skipped-budget`.
- **`transcript`** — the exact spoken text; the QA artifact and what a human reviews at the audit gate.

## 3. Failure modes the engine surfaces (not silent)
- Missing `ELEVENLABS_API_KEY` → hard error naming the `.env` path (use `--dry-run` to work offline).
- No `voice_id` anywhere in `dna.md` → hard error (voice is a required channel decision).
- ElevenLabs `401` → "check ELEVENLABS_API_KEY"; other HTTP errors surface the response body.
- Transient `429/5xx`/network → retried with exponential backoff before failing.
