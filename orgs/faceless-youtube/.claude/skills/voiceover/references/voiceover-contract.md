# voiceover — config & output contract

Two things the rest of the pipeline depends on: the **Voiceover-config block** read from `dna.md`, and the **manifest** written for `render-builder`.

## 1. The dna.md Voiceover-config block

Put this fenced block inside the channel's `## Voice & style` section of `dna.md`. The engine finds the
first fenced code block containing `voice_id:` and reads simple `key: value` lines (no YAML library
needed); every field except `voice_id` is optional and falls back to the project default shown.

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

### Starting points by locked lever (defaults to adjust, not rules — match delivery to the channel's one lever)

| Lever (dna.md) | Feel | stability | style | speed |
| --- | --- | --- | --- | --- |
| Morbid awe / dread | calm, low, clinical — let the scenario carry it | 0.55–0.65 | 0.05–0.15 | 0.95–1.0 |
| Wonder / awe | warm, bright, unhurried | 0.4–0.5 | 0.2–0.35 | 1.0 |
| Vindication / exposé | crisp, confident, deliberate | 0.5–0.6 | 0.15–0.3 | 1.0–1.05 |
| Righteous anger | urgent, weighted | 0.35–0.5 | 0.3–0.45 | 1.0–1.1 |

Model note: `eleven_multilingual_v2` is the reliable default (full voice-settings support); `eleven_v3`
is more expressive but newer — verify on the channel's key first; `eleven_turbo_v2_5` is cheapest/fastest for high-volume shorts.

### Expressive delivery markers and dry-run review

The script may use only these exact writer-facing markers, each immediately before a sentence, never
adjacent to another, never mid-sentence: `[emote: curious]`, `[emote: knowingly]`, `[emote: sternly]`,
`[emote: sighs]`, `[emote: exhales]`, `[aside: dry]`. Use them sparsely, at a real chapter, reveal, or
mood turn — punctuation remains the main rhythm tool. Unknown, malformed, adjacent, or mid-sentence
markup is a hard error before any provider request. On `eleven_v3` the engine translates them to Eleven
audio tags `[curious]`, `[knowingly]`, `[sternly]`, `[sighs]`, `[exhales]`, `[deadpan]`; on v2 it strips
every approved marker, preserving the spoken sentence and v2's existing pause behavior. No v3 setting
change follows from a marker — a stability audition still needs one chapter and a human ear gate.

`--dry-run` is the zero-spend request-shape review: it writes the normal transcript and manifest while
reporting effective settings, the cleaned v3/v2 request chunks, cleanup, and seam locations, without
altering the channel's paid config or making a request. v3 has no `previous_text`/`next_text`, so the
planner prefers a substantial chapter/mood-turn paragraph for a forced seam, else the nearest paragraph
or sentence boundary — flagged for ear review either way.

### Delivery-target rules

**The goal is NOT a flat AI read, but the fix is not what people assume:**

- **Liveliness is pitch + sentence-variance, never volume.** Loudness stays flat across a video — don't
  fake loudness dynamics; life comes from an expressive voice and the script's varied sentence lengths.
  Pick a voice with genuine pitch life (not a flat news-reader); set **stability ~0.4–0.5** so pitch
  actually moves, with **style ~0.15–0.3** — low enough to stay stable, high enough to not be monotone.
  Monotone *pitch* is the enemy; flat *loudness* is fine.
- **Pace is persona-dependent, never a fixed wpm target.** Perceived pace comes from articulation rate
  + pause share, not gross wpm — a voice can talk fast and feel relaxed at ~20–30% pause share (measure
  with ffmpeg `silencedetect`). Match pace to persona feel plus that pause share at **speed 1.0** unless
  clearly too fast/slow; an energetic persona can comfortably sit at **~180–200 gross wpm**.
- **Pauses are rare, structural, and short.** Punctuation carries most of the cadence (periods = full
  stops, commas = catches); spend the tiered pause cues sparingly and short — human/library voices
  already breathe at punctuation, so an unkept-short injected pause stacks on top and reads too long.
  Engine mapping (v3): `[BEAT]` → natural (no tag), `[PAUSE]` → short, `[PAUSE:LONG]` → normal. A wall
  of identical `[PAUSE]`s reads as a metronome, and dense breaks destabilize ElevenLabs.
- **Flat, compressed loudness is correct** — the industry norm, and what lets a deadpan line land;
  don't post-process volume drama in.

This channel's `script.md` is never authored with literal `[PAUSE]`/`[BEAT]` text tags — rhythm comes
from prosody + the engine's automatic sentence-gap + authored `audio-plan.json` pause cues (see
`docs/retired-features.md`); the marker/pause mapping above is project-wide engine behavior and stays
live for any channel that does author those tags.

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
- **`est_duration_s`** — from the real mp3 when synthesized (CBR-bitrate size estimate; render-builder/ffprobe may re-measure exactly), or word-count ÷ 150 wpm in `--dry-run`.
- **`long_form_est_runtime_s`** — cross-check against the script header's `Estimated runtime`; a large
  gap means the script word count and spoken text diverged (markers, edits) — worth a look before rendering.
- **`state`** — `synthesized` | `dry-run` | `skipped-budget`.
- **`transcript`** — the exact spoken text; the QA artifact and what a human reviews at the audit gate.

## 3. Failure modes the engine surfaces (not silent)
- Missing `ELEVENLABS_API_KEY` → hard error naming the `.env` path (use `--dry-run` to work offline).
- No `voice_id` anywhere in `dna.md` → hard error (voice is a required channel decision).
- ElevenLabs `401` → "check ELEVENLABS_API_KEY"; other HTTP errors surface the response body.
- Transient `429/5xx`/network → retried with exponential backoff before failing.
