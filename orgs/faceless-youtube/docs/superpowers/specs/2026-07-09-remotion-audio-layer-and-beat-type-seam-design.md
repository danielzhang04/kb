# Remotion next: engine audio layer + the `beat_type` seam (combined design)

> **⚠️ SUPERSEDED 2026-07-10** by `docs/superpowers/plans/2026-07-09-beat-type-seam-camera-and-audio.md`
> (built) + the `beat_type` decision-log entry. This doc's framing is stale in two ways the new work
> reversed: `beat_type` is NOT a fallback for `beat` (it's the primary treatment signal; `beat` demoted
> to metadata), and its `REVEAL_BEATS = {climax, withheld-peak, number-reveal}` **conflated `beat` values
> with a `beat_type` value** — do not reuse it. Kept for history only.

**Date:** 2026-07-09 · **Status:** SUPERSEDED (see banner) — was: design, awaiting review → plan
**Scope:** the two named Remotion follow-ups, as ONE gameplan because they are driven by the same
signal. Workstream **A (audio)** executes now; Workstream **B (`beat_type`)** starts once the
`_chain-test` still-side validation settles (it edits VPW / `lint_shots.py` / the shots schema —
the files a parallel terminal is exercising).

## Why these two are one design

The measured motion grammar lives in `universal.md §13a-iii`. Its **beat-type → treatment table**
(§13a-iii, rows 1512–1524) has a **Camera** column *and* an **Audio** column. So one authored field,
`beat_type`, is meant to drive BOTH how a shot moves and how it is scored. Today neither is wired:

- **Audio:** the engine renders VO only. `motion-tokens.json` defines an `audio_layer` block that is
  documented as **FUTURE — not yet consumed** (`motion-schema.md §5`). Nothing produces a music bed
  or SFX.
- **Camera intent:** `build_motion.py` drives the camera off a `ken_burns` + `beat` **proxy**;
  `ken_burns` / `within_shot_motion` are **FROZEN** pending the taxonomy enum (decisions 2026-07-09,
  "Deferred: S6 — the `beat_type` seam").

The interlock: the **bed + element-coupled SFX** key off signals that already exist in `motion.json`
(overlay types, entrances, stage boundaries, chapter-cards) and need **no** `beat_type` — buildable
now. Only the **register-driven** audio (gravity-word dips, music-thins-on-human-cost) needs the beat
signal. So we build the audio *mechanisms* in A, and B's `beat_type` is what finally *drives* them
correctly. A5 (audio dynamics) and B4 (`beat_type`→audio) are the same feature from two sides.

## Goals

1. Every rendered piece has a continuous, ducked music bed + element-coupled SFX, obeying the
   measured audio grammar (§13a-iii.8), at zero API cost per render (assets generated once, reused).
2. Land `beat_type` as a first-class authored field so the engine derives camera **and** audio from
   the taxonomy table instead of the `ken_burns`/`beat` proxy — unfreezing/retiring `ken_burns` +
   `within_shot_motion`.
3. No regression to the proven `_chain-test` render path (same `render.manifest.json` contract;
   compliance/publish read it unchanged).

## Non-goals

- **Phase 3 (T3) element compositing** — the depicted element itself moving. Separate, gated on the
  dogfood, has the unsolved rembg-matting issue. Out of scope here.
- **Shorts (9:16) audio/motion grammar** — unstudied; shorts inherit long-form treatment until a
  dedicated shorts pass. Out of scope.
- **Retiring the legacy JSON2Video path** — a later cleanup after video #1 ships on Remotion.
- Re-measuring the grammar. Both workstreams *implement* the already-measured §13a-iii; they do not
  re-derive it.

## Audio source (decided)

**ElevenLabs** — the vendor already wired (`ELEVENLABS_API_KEY` in `.env`; `voiceover.py` is the
integration pattern; Windows interpreter note: native `py -3`, msys2 python lacks a CA bundle).
Generate a small **bed set** (via the music API) + an **SFX kit** (via the sound-effects API) ONCE,
commit them under the channel's `visual-kit/audio/`, and reuse them across renders — so per-render
audio cost is $0 and the palette is fixed and on-brand. **License check (blocking A1):** confirm the
ElevenLabs music/SFX commercial-use + YouTube-monetization terms before committing generated beds;
if the music terms are restrictive, fall back to a CC0 bed with generated SFX (a hybrid) — the
engine/derivation design below is source-agnostic.

---

## Workstream A — engine audio layer (execute now)

Chain-test-independent: touches only `render-builder/engine/`, `build_motion.py`, the channel
`motion-tokens.json` + a new `visual-kit/audio/` asset dir, and the motion schema. Does NOT touch
VPW / lint / shots authoring.

### A1 — audio assets + license gate
- Confirm ElevenLabs commercial/monetization terms (blocking). 
- Generate & commit to `channels/the-second-take/visual-kit/audio/`: a small **bed set**
  (`beds/<name>.mp3`, e.g. story-neutral, tension, light) hyper-compressed to LRA ~3.5 LU, and an
  **SFX kit** (`sfx/<event>.mp3`: pop, tick, boom, whoosh, riser, pluck, sting) matched to the
  §13a-iii.8 event vocabulary. Add an `audio/manifest.json` naming each asset + its role.
- Log the generation recipe alongside the assets (the "why" survives — per the log-generation-
  reasoning practice).

### A2 — bed track in the engine
- New `<AudioBed>` component: a movie-level Remotion `<Audio>` of the selected bed, looped to piece
  length, volume automated to sit `bed_db_under_vo` under VO and inside `bed_lu_range`. Simple VO
  ducking v1 = a constant offset with short dips (A5); no true sidechain compressor needed.
- Consumes new `audio_layer` tokens (below). Absent bed → silent (engine default), warn-not-throw
  (mirrors `mergeTokens` [A18]).

### A3 — element-coupled SFX (no `beat_type`)
- New `<SfxTrack>` component: renders a `<Audio>` one-shot per audio event at its `at_s`.
- `build_motion.py` derives events **mechanically from data already in `motion.json`**:
  card-pop → `pop`; type-on/`text` overlay → `tick`; `chapter-card` → `boom`; `whip` entrance →
  `whoosh`; `progressive-reveal` → `riser` + `pluck` per item; `counter`/number → part of A5's
  dip→riser→hit. Density capped by `audio_layer.sfx_per_min_story` (the format dial); camera
  crawls + idle stay silent (§13a-iii.8).

### A4 — schema + derivation
- Extend `motion@1` additively with an `audio` block:
  `{ "bed": "audio/beds/<name>.mp3" | null, "bed_db_under_vo": n, "events": [{ "sfx": "boom",
  "at_s": n, "gain_db"?: n }], "dips": [{ "at_s": n, "depth_db": -40, "dur_s": 0.6 }] }`.
  Additive → existing consumers (compliance/publish) still read the manifest unchanged.
- `build_motion.py` gains an `derive_audio(...)` that emits the block; `motion-schema.md` gets an
  `audio` row + an audio-events table. `render.manifest.json` records `audio: {bed, sfx_count,
  dip_count}` per piece for the gate.

### A5 — register dynamics (mechanism now, `beat_type`-wired in B4)
- The **sub-second −40 dB full-mix dip** (VO + bed + SFX ducked together, 0.5–0.7s) and the
  **music-thins / SFX-withheld** state. Engine renders both from the `audio.dips` + a per-shot
  `audio_mode: "full" | "thin"` field.
- v1 trigger is **provisional**: derive dips/thin from the existing `beat` field (or an authored
  `on_screen_text`/number marker). B4 re-homes the trigger onto `beat_type` with no engine change —
  only the derivation source changes.

### A engine type debt to fix in passing
`engine/src/tokens.ts::MotionTokens` is already **behind** `motion-schema.md §5`: it lacks
`type_on`, `entrance`, `camera.drift_intensity`, and `audio_layer`. A adds `audio_layer` (and, while
there, the two missing camera/entrance keys) to the type + `DEFAULT_TOKENS` so the schema doc and the
code agree.

### `audio_layer` tokens (channel `motion-tokens.json`, already reserved)
`bed_lu_range`, `bed_db_under_vo`, `sfx_per_min_story`, `gravity_dip_db`, `gravity_dip_s` (present as
FUTURE today) + new: `bed_default` (bed name), `thin_bed` (the human-cost bed or `null` = drop to
bed-only). Data, not code; engine neutral defaults if absent.

---

## Workstream B — the `beat_type` seam (after `_chain-test` settles)

Gated because it edits VPW + `lint_shots.py` + `shots-schema.md` — the parallel terminal's files.

### B1 — define the enum + cardinality
- `beat_type` = the 11 rows of the §13a-iii table: `cold-open`, `thesis-pivot`, `enumeration-within`,
  `enumeration-across`, `mechanism`, `number-reveal`, `escalation`, `chapter-boundary`,
  `gravity-human-cost`, `dialogue`, `aside-joke`. **One per shot**, required. **Default** = a new
  plain-narrative row (`narration`) the table currently lacks — add it (locked camera, micro-drift
  floor, one element per noun, bed-only audio) so a normal expository shot has a home. Codify the
  field in `universal.md §13a-iii`.

### B2 — author + lint
- Add `beat_type` to `visual-prompt-writer` authoring (SKILL + `shots-schema.md`) with a short
  "pick the row" guide.
- `lint_shots.py`: HARD check — present + in-enum on every shot.

### B3 — camera/element derivation
- `build_motion.py::camera_from_ken_burns` → `camera_from_beat_type`: read the table's Camera +
  Cut/energy columns off `beat_type`. Keep the peak-beat/whip logic where the table agrees.
- **Retire or repurpose** `ken_burns` (the direction hint can survive as an *optional* override on
  `number-reveal`/`escalation` where the table allows a move) and `within_shot_motion` (becomes T3
  intent, still frozen for the engine). Update `motion-schema.md` derivation rows.

### B4 — audio derivation onto `beat_type`
- Re-home A5's dip/thin trigger from `beat` → `beat_type`: `gravity-human-cost` → thin + no SFX;
  `number-reveal` → dip→riser→hit; `chapter-boundary` → boom + optional bed drop; `dialogue` →
  bed-only (SFX silent); `thesis-pivot` → thin + ticks. Pure derivation change; no engine change.

### B5 — image-gen seam
- The rows that touch the still inform VPW/image-gen authoring: `dialogue` → expression swaps
  per line; `gravity-human-cost` → comedy vocabulary withheld. Documented, not a new mechanism.

---

## Data flow (after both land)

`shots.json` (VPW authors `beat_type`) → `lint_shots.py` (HARD gate) → `build_motion.py`
(`derive_shots` reads `beat_type` → camera/element; `derive_audio` reads `beat_type` + overlays →
bed/SFX/dips) → `motion.json` (`+audio` block) → engine (`Video.tsx` mounts `<AudioBed>` +
`<SfxTrack>` + existing layers) → `final.mp4` + unchanged `render.manifest.json` (`+audio` summary).

## Testing / validation

- **A:** `--dry-run` shows the `audio` block (bed chosen, SFX events on the right words, dips on
  gravity words); a real render of the `_chain-test` 56s slice — listen for: bed present + ducked,
  a pop/boom/whoosh landing ON its event, a −40 dB dip on a gravity word, no SFX under idle/crawl.
  This render doubles as the **motion+audio gold exemplar** (the named 56s A/B follow-up).
- **B:** `lint_shots.py` HARD-passes on a `beat_type`-annotated `_chain-test`; `--dry-run` diff shows
  camera/audio now derived from `beat_type` (spot-check a `gravity` shot thins, a `number-reveal`
  dips, a `chapter-boundary` booms); `tsc` clean; full re-render matches or beats the pre-B cut.
- Both: `render.manifest.json` schema unchanged for compliance/publish (only additive `audio`).

## Risks / open items

- **License (A1, blocking):** ElevenLabs music monetization terms. Fallback = CC0 bed + generated
  SFX; design is source-agnostic.
- **Bed loudness/ducking realism:** v1 is constant-offset + dips, not a true sidechain compressor.
  Acceptable for the measured "flat bed, silence-as-scalpel" grade; revisit only if it reads flat.
- **B collision window:** do not start B until the `_chain-test` validation verdict lands and VPW is
  quiescent. Stage explicit paths on every commit; never `git add -A` (parallel terminals).
- **`beat_type` default row:** adding `narration` to the taxonomy is a real edit to the measured-law
  doc — keep it a labeled "executor default," not a claimed measurement.
- **Doc drift to fix in passing:** CLAUDE.md status still lists "font-audition pick" as pending; the
  log has Ink Free **locked + embedded**. Correct the status block when A touches it.
