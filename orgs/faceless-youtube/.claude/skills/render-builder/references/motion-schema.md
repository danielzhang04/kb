# motion.json — the per-video motion spec the Remotion engine renders

The contract between `scripts/build_motion.py` (writes it, one file per piece at
`videos/<slug>/assets/motion/<piece>.motion.json`) and the engine
(`engine/render-video.mjs` → the `Video` composition), which receives it verbatim as Remotion
`inputProps`. **Derivable-first:** almost every field is computed mechanically from `shots.json` +
the scenes manifest + `voiceover.manifest.json` + the channel's `motion-tokens.json`. `apply_motion_plan`
merges the `motion-planner`'s cutout layers (plate + cutouts) into the derived shots, never a schema change.

**Motion-tier legend** (referenced throughout): **T1** = camera + idle baseline over a still —
camera-as-furniture, built · **T2** = engine-drawn device overlays (stat/counter/chapter/meter/
definition cards) — **RETIRED from the flow (2026-07-15):** nothing authors or routes them; the Remotion
components are parked dormant (see §3). In-video text is now baked into the generated images · **T3** =
element-layer motion (a shot's `plate` + animated **cutout** `layers`: slide/path/bob/appear) —
**BUILT 2026-07-12**, the LIVE animation tier (the `layers[]` field below + the engine `LayerView`;
planned by the `motion-planner` skill, materialized by `image-generation`).

## 1. Shape

```json
{
  "schema": "faceless-youtube/motion@1",
  "piece": "long-form",
  "video_slug": "YYYY-MM-DD-slug",
  "fps": 30,
  "width": 1920, "height": 1080,
  "audio": "vo.mp3",
  "audio_seconds": 728.4,
  "tokens": { "<the channel visual-kit motion-tokens.json, copied in verbatim>": "…" },
  "captions": {
    "enabled": true,
    "style": "long-form",
    "words": [["In", 0.0], ["1822,", 0.24]]
  },
  "audioSpec": {
    "music_states": [{"track": "audio/beds/sneaky-1.mp3", "at_s": 0.0, "dur_s": 23.8, "base_db": 7, "fade_in_s": 0.5, "fade_out_s": 0.9}],
    "events": [{"sfx": "audio/sfx/boom.mp3", "at_s": 12.4}],
    "dips": [],
    "thin_spans": [{"at_s": 44.0, "dur_s": 5.5, "extra_db": 8}],
    "music_missing": 0,
    "sfx_missing": 0
  },
  "_audioSpec_note": "the music-lane + SFX layer, derived by build_audio.py from visual-kit/audio-tokens.json. Named audioSpec to not clash with `audio` (the VO mp3). null when --no-audio. Kit files are staged into assets/audio/ at build; each music-lane TRACK is TILED to the full video length (so the engine <Audio> never loop-wraps — else per-frame volume modulation past the track's length misfires). `music_states` is the PLACED music lane (Phase 3B, build_music_lane) — non-overlapping segments at a constant present level, dry on gravity/dry-spans, fade→gap→fade at track switches; absent music-cues.json → one full-length default-mood segment. `dips` (number-reveal / chapter full-stop) is LIVE — the music lane inherits it (lands in the render-inserted transition-breath gap; see §2).",
  "_captions_note": "enabled = !--no-captions AND (short piece OR tokens.caption.enabled_long_form, default true) — the measured 16:9 grade burns no word-captions; channels opt out via motion-tokens.json",
  "shots": [
    {
      "id": "L01",
      "start_s": 0.0,
      "duration_s": 3.42,
      "image": "scenes/L01.png",
      "placeholder": null,
      "stage": "guidebook-desk",
      "stage_role": "base",
      "camera": { "move": "none", "pan": null, "intensity": 0.0 },
      "entrance": "cut",
      "idle": "bob",
      "overlays": [],
      "plate": "plates/L01.png",
      "layers": [
        { "id": "macgregor", "src": "cutouts/L01-macgregor.png", "animation": { "type": "slide", "from_edge": "left", "to": [0.5, 0.9], "dur_s": 1.8, "height_frac": 0.6 } }
      ]
    }
  ]
}
```

The example shows the default locked camera (`move: none`, intensity `0.0`). A motion plan may now author
restrained `camera.move: "push"|"pull"` only on a stage-start/base shot; build_motion maps those to engine
`push-in`/`pull-back` and rejects a later delta whose stage camera would ignore it. The camera remains
punctuation, not a per-shot requirement; life still comes chiefly from cuts and cutout motion.

## 2. Field derivations (build_motion.py; all paths relative to `videos/<slug>/assets/`)

| field | derived from | rule |
| --- | --- | --- |
| `fps`/`width`/`height` | piece | 30; 1920×1080 long-form, 1080×1920 shorts |
| `audio`, `audio_seconds`, `captions.words` | `voiceover.manifest.json` | the piece's audio + `word_timings` (same stream `vo_ref` matches against) |
| `start_s`/`duration_s` | `retime_by_timings` / `retime` (imported from `render.py`, the shared timing/scene helpers) | cuts land on `vo_ref` words, proportional fallback |
| `image` | scenes-mode resolution (imported `resolve_scene_files`) | verified `scenes/<id>.png` (shorts: `<short-stem>-<id>.png`, where **short-stem** = `Path(shorts[].file).stem` — the same prefix render.py + the SKILL use). **Missing ai-gen/hybrid scene = HARD ERROR**; `--allow-missing` renders a placeholder + records it |
| `placeholder` | `source` ∈ chart/screencap/stock/archival, or allowed-missing | `{kind, label}` — the engine renders a styled placeholder card (the live `PlaceholderCard` component, distinct from the retired device cards) instead of an image; counted in the manifest |
| `stage`/`stage_role` | shots.json (intent fields, when present) | passed through; used to group a held set. Hard cuts remain universal; a stage shares its first camera arc |
| `camera.move`/`pan` | `--motion-plan` stage-start `camera` | locked `none`/`null` unless authored as `push`/`pull` + optional cardinal pan; maps to engine `push-in`/`pull-back`; later deltas hard-fail |
| `camera.intensity` | `--motion-plan` stage-start `camera` | `0.0` when locked; authored value in `(0,1]` |
| `entrance` | — (constant) | **Always `cut`** — the whip entrance was retired with the camera decouple (2026-07-12) |
| `idle` | tokens default or plan opt-in | legacy `tokens.idle` behavior is unchanged unless `shots.motion.json` has `baseline_life:true`; then the separate `tokens.baseline_life` block overrides idle for real scene and layered tableaux, never placeholders/cards |
| `overlays` | `--motion-plan` (`apply_cards`), else `[]` | **chapter CARDS only** (re-enabled 2026-07-17). `apply_cards` resolves the plan-level `cards[]` (`text` + verbatim VO `anchor` + `hold_s`/`fade_s`) to `chapter-card` overlays and attaches each to the shot whose span holds the resolved time; the end card (`end_card:true`) + plan-level `post_vo_hold_s` extend the last shot past the final word. The OTHER overlay types (`on_screen_text`→text, engine device-cards) stay retired — in-video text is baked into the images. Shots with no card keep `overlays: []` (see shots-motion-schema.md §Chapter cards, §3 below) |
| `plate` / `layers` | `--motion-plan` (`apply_motion_plan`) | **present only on a layered shot** (T3). `apply_motion_plan` merges a `shots.motion.json` (from the `motion-planner` skill) by id: `plate` = `plates/<id>.png` (the baked background), `layers[]` = `{id, src: cutouts/<id>-<layer>.png, animation}` (the menu animation). Absent = a plain baked shot (`image` path). The engine `LayerView` renders each layer; a shot with `layers` uses `plate` as its base instead of `image` |
| `audioSpec` | `build_audio.py` (reads `visual-kit/audio-tokens.json` + the resolved `audio-plan.json` cues) | Audio is AUTHORED by the `audio-director` skill as `audio-plan.json` (SFX · pause · music · dry); `build_motion` splits it (`audio_plan.split_plan`) and `build_audio` realizes it deterministically: a **placed music lane** (`music_states` — non-overlapping mood segments at a constant present level, NOT a wall-to-wall bed; authored `dry` spans + different-mood track-switch gaps carve silence, same-mood neighbours coalesce; `music_missing` counts an unsourced mood), **SFX `events`** (authored `sfx` cues → roles; an item-appearance sound with `sync:"element"` snaps to the cut/cutout-layer it punctuates; per-element chatter density-capped by `sfx_per_min_story_max`; a role with no sourced file is dropped + counted in `sfx_missing`), and **`dips` (the synchronized full-stop):** every `pause` gap cuts the bed to near-silence AND withholds SFX inside it, the intended hit landing at the gap end. A `pause` cue inserts its silence by splicing a derived `vo.breath.mp3` (VO untouched) + shifting the word-timings ONCE — the frame holds across it, separate from the writer's `[PAUSE]` prosody. Register pull-backs on human-cost are authored `dry` spans. **No overlay-driven SFX fire** (2026-07-15): the `text`→`tick` consumer went away with text overlays, and the device-card SFX roles (stat/counter/meter → pop/riser/pluck) are RETIRED, not dormant-pending — device cards never ship, so those roles have no producer. A deliberate, accepted behavior change. See `audio-plan-schema.md`. Kit files staged into `assets/audio/`; `--no-audio` skips it |

## 3. Overlays — chapter cards LIVE; the rest parked

**`ChapterCard` is LIVE again (2026-07-17)** via the plan-level `cards[]` → `apply_cards` →
`chapter-card` overlays (full-frame **FULLY OPAQUE** near-black `#151310` text beats that read as their
own scenes; see shots-motion-schema.md §Chapter cards). Card style: `#151310` ground, `palette.card_bg`
cream text, Ink Free, centered, quick ~0.15s fade, **no card chrome**. Because the card is opaque, each
in-video card's `dur_s` is AUTO-ALIGNED to a co-located spliced pause silence (the audio-director
authors a `pause` on each in-video card anchor) so it never covers VO; the end card is exempt and runs
to its post-VO-extended shot end.

The OTHER overlay components — `TextOverlay`, `StatCard`, `Counter`, `Meter`, `DefinitionCard`,
`ProgressiveReveal`, dispatched by the same `OverlayView` — stay **parked dormant (2026-07-15):**
compilable and findable if ever revived, but no live path emits them. In-video text (stats, labels,
definitions, enumerations) is baked into the generated scene/plate images by `image-generation` — the
engine draws no text except captions and chapter cards.

Captions are a **separate** track, not an overlay: they flow through the top-level `captions` field
(`captions.words`) into the `Captions` component, unaffected by this retirement.

## 4. Guarantees the engine keeps (parity with the legacy path)

- Cuts land on `vo_ref` words (same matcher semantics); Σ durations = VO length.
- Hard cuts only; no fades exist in the component set.
- Legacy motion remains unchanged unless opted in; baseline life never moves placeholders or opaque cards.
- One movie-level VO track; word-highlight captions from `captions.words` (no transcription);
  `--no-captions` supported.
- Output + `render.manifest.json` in the standard schema
  (`render_engine: "remotion"`, `watermark: false`), so compliance-check/publish-queue read it
  unchanged. Each rendered piece's record also carries the loudnorm result (`audio_lufs`,
  `audio_true_peak`) + a Phase-4 **`audio`** block from `audio_checker.check_audio` (deterministic,
  **warn-not-fail**): `{ok: bool, warnings: [str], measured: {lufs, true_peak, music_segments,
  sfx_count, sfx_missing, music_missing}}` — verifies the master hit `master_target`, no sound/mood was
  silently dropped, the register layer fired, and the music lane is sane. No model listening; FEEL stays
  the human ear-gate.

## 4a. Cutout layer render fields (engine `LayerView`)

Each `layers[]` entry is `{id, src, animation}`; `apply_motion_plan` copies the `animation` dict
verbatim (any field passes through), and the engine `LayerView` (`components.tsx`) renders it. Beyond
the animation-menu params, two render-only knobs the engine honors:

- **`animation.anchor_origin`** (`"center"` | `"bottom"`, optional, any type): overrides the vertical
  transform origin. Each type has a DEFAULT — `appear`/`path` = element **center** (`translate -50%`);
  `slide`/`bob` = element **bottom** (`translate -100%`, feet-on-ground). Unset = the default (zero
  regression). Set `"center"` so a non-figure `bob`/`slide` (a floating book, a gliding arrow) is
  placed by its center, not its bottom edge — the M16 "elements sit too high" fix. DISTINCT from
  `anchor` (verbatim VO words → `start_s`); horizontal origin is always `-50%`.
- **`animation.dot_count`** (int > 0, default 44) / **`animation.dot_r`** (px > 0, default 5): on a
  `path` with `draw_line`, the number and radius of the route dots the engine draws. Defaults reproduce
  the prior look (which reads solid on a short path); lower both for a clearly DOTTED route. Per-layer,
  so one route can be dotted without changing the ship/campaign trails.

## 5. Channel tokens (`channels/<name>/visual-kit/motion-tokens.json`)

Data, not code — the engine is niche-agnostic; the whole file is copied into `tokens` verbatim
(§1). It styles the engine-drawn elements — **captions** (the one live engine text) + camera feel;
character + in-image law lives in `style-bible.md`. The device-card / overlay styling blocks below
(`card`, `type_on`, the overlay half of `font_family`) now feed only **parked** components (§3) — kept
for a possible revival, read by nothing live. One row per top-level block below, with its exact sub-keys
and the engine element it drives. Missing file → engine built-in neutral defaults; every value
optional. Keys prefixed `_` (e.g. `_doc`, `_font_note`, `_drift_note`, `_note`) are documentation,
not read by the engine.

| block | sub-keys | drives |
| --- | --- | --- |
| `font_family` | *(one CSS font stack string)* | the face for engine-drawn text — captions (live) + the parked device-card/overlay components; in-image diegetic lettering is style-bible's, not this |
| `palette` | `ink`, `accent`, `card_bg`, `bg_default` | text ink, the shared red accent (= in-image red, see style-bible §4), the placeholder-card ground (`card_bg`/card ink now feed only the parked device cards) |
| `caption` | `enabled_long_form`, `size_frac_long`, `size_frac_short`, `color`, `highlight`, `outline`, `y_frac_long`, `y_frac_short`, `words_per_page_long`, `words_per_page_short`, `all_caps_short` | the word-highlight caption track (size/color/highlight/outline/vertical-position/words-per-page per aspect; `enabled_long_form:false` = the measured 16:9 grade burns no captions) |
| `card` | `border_px`, `radius_px`, `shadow`, `tilt_deg` | **parked** — the frame of the dormant device-card components (§3); no live consumer |
| `idle` | `bob_px`, `period_s`, `breathe_scale` | legacy idle baseline. **`bob_px: 0` = frames hold dead-still** (The Second Take's setting) unless a plan opts into `baseline_life` |
| `baseline_life` | `bob_px`, `period_s`, `breathe_scale` | Daniel-calibration block applied only for plan-level `baseline_life:true`; scene-backed and layered tableaux only, never placeholders/cards |
| `camera` | `push_scale`, `pull_from`, `whip_frames`, `pan_frac` | camera response for the rare authored stage-start `push`/`pull`; whip remains retired |
| `type_on` | `story_chars_per_s`, `card_chars_per_s` | **parked** — text type-on speed for the dormant overlay/device-card components (§3); no live consumer |
| `entrance` | `pop_settle_s`, `slide_s` | element-entrance timing (pop/settle spring vs slide ease-out) — used by the live cutout `LayerView` |
| `audio_layer` | *(legacy — superseded)* | The audio layer no longer reads `motion-tokens.json`. `build_audio.py` consumes a **separate** `visual-kit/audio-tokens.json` (`music_pools`, `music_present_db`, `music_default_mood`, `track_switch_gap_s`, `music_fade_s`, `sfx_pools`/`sfx_gain_db`, `sfx_per_min_story_max`, `thin_extra_db`, `dip_db`) for the `audioSpec` block + the engine `MusicLane`/`SfxTrack`. Any `audio_layer` block still present here is stale and ignored |
