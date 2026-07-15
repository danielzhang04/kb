# motion.json — the per-video motion spec the Remotion engine renders

The contract between `scripts/build_motion.py` (writes it, one file per piece at
`videos/<slug>/assets/motion/<piece>.motion.json`) and the engine
(`engine/render-video.mjs` → the `Video` composition), which receives it verbatim as Remotion
`inputProps`. **Derivable-first:** almost every field is computed mechanically from `shots.json` +
the scenes manifest + `voiceover.manifest.json` + the channel's `motion-tokens.json` — the thin
device-card overlays are authored upstream by `motion-planner` (engine device-layers in
`shots.motion.json`) and routed here by `apply_motion_plan`, never a schema change.

**Motion-tier legend** (referenced throughout): **T1** = camera + idle baseline over a still —
camera-as-furniture, built · **T2** = engine-drawn device overlays as code (stat/counter/chapter/
meter/definition cards, real type), built · **T3** = element-layer motion (a shot's `plate` + animated
cutout/engine **layers**: slide/path/bob/appear) — **BUILT 2026-07-12** (the `layers[]` field below + the
engine `LayerView`; planned by the `motion-planner` skill, materialized by `image-generation`).

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
      "overlays": [
        { "type": "text", "text": "…", "at_s": 0.0 }
      ],
      "transform_note": "",
      "plate": "plates/L01.png",
      "layers": [
        { "id": "macgregor", "src": "cutouts/L01-macgregor.png", "animation": { "type": "slide", "from_edge": "left", "to": [0.5, 0.9], "dur_s": 1.8, "height_frac": 0.6 } }
      ]
    }
  ]
}
```

The example shows the camera **locked** (`move: none`, intensity `0.0`) — which is now ALWAYS the case.
The camera is always locked (2026-07-12): build_motion never derives a move. The engine keeps its
`CameraStage` primitive for a future explicit/authored move, but nothing emits one today. The camera is
furniture; life comes from cuts, overlays, and (later) element-layer motion.

## 2. Field derivations (build_motion.py; all paths relative to `videos/<slug>/assets/`)

| field | derived from | rule |
| --- | --- | --- |
| `fps`/`width`/`height` | piece | 30; 1920×1080 long-form, 1080×1920 shorts |
| `audio`, `audio_seconds`, `captions.words` | `voiceover.manifest.json` | the piece's audio + `word_timings` (same stream `vo_ref` matches against) |
| `start_s`/`duration_s` | `retime_by_timings` / `retime` (imported from `render.py`, the shared timing/scene helpers) | cuts land on `vo_ref` words, proportional fallback |
| `image` | scenes-mode resolution (imported `resolve_scene_files`) | verified `scenes/<id>.png` (shorts: `<short-stem>-<id>.png`, where **short-stem** = `Path(shorts[].file).stem` — the same prefix render.py + the SKILL use). **Missing ai-gen/hybrid scene = HARD ERROR**; `--allow-missing` renders a placeholder + records it |
| `placeholder` | `source` ∈ chart/screencap/stock/archival, or allowed-missing | `{kind, label}` — the engine renders a styled device card instead of an image; counted in the manifest |
| `stage`/`stage_role` | shots.json (intent fields, when present) | passed through; used to group a held set. Every shot is locked + hard-cuts (the held-set camera arc + non-cut entrance were retired 2026-07-12) |
| `camera.move`/`pan` | — (constant) | **Always locked** (`none`/`null`) — build_motion never derives a move (2026-07-12). `CameraStage` remains in the engine for a future explicit/authored move; nothing emits one today |
| `camera.intensity` | — (constant) | **Always `0.0`** |
| `entrance` | — (constant) | **Always `cut`** — the whip entrance was retired with the camera decouple (2026-07-12) |
| `idle` | tokens default | `bob`, amplitude from `tokens.idle.bob_px` — **`bob_px: 0` holds the frame dead-still** (The Second Take's setting; life comes from cuts + overlays + the rare gravity/escalation push) |
| `overlays` | `on_screen_text` → `{type:"text", at_s: start}`; **device cards** ← `shots.motion.json` engine device-layers via `apply_motion_plan` | `on_screen_text` yields a plain `text` overlay. A `motion-planner` engine device-layer (`kind` ∈ stat-card/counter/meter/chapter-card/definition-card/reveal) routes to its overlay (`reveal`→`progressive-reveal`), `at_s` = the shot's start; reveal items stagger across the shot duration (v1) |
| `transform_note` | — | **always `""`** — vestigial; superseded by `layers` (T3 now ships via the `layers[]` field, not this) |
| `plate` / `layers` | `--motion-plan` (`apply_motion_plan`) | **present only on a layered shot** (T3). `apply_motion_plan` merges a `shots.motion.json` (from the `motion-planner` skill) by id: `plate` = `plates/<id>.png` (the baked background), `layers[]` = `{id, src: cutouts/<id>-<layer>.png, animation}` (the menu animation). Absent = a plain baked shot (`image` path). The engine `LayerView` renders each layer; a shot with `layers` uses `plate` as its base instead of `image` |
| `audioSpec` | `build_audio.py` (reads `visual-kit/audio-tokens.json` + the resolved `audio-plan.json` cues) | Audio is AUTHORED by the `audio-director` skill as `audio-plan.json` (SFX · pause · music · dry); `build_motion` splits it (`audio_plan.split_plan`) and `build_audio` realizes it deterministically: a **placed music lane** (`music_states` — non-overlapping mood segments at a constant present level, NOT a wall-to-wall bed; authored `dry` spans + different-mood track-switch gaps carve silence, same-mood neighbours coalesce; `music_missing` counts an unsourced mood), **SFX `events`** (authored `sfx` cues → roles; an item-appearance sound with `sync:"element"` snaps to the cut/overlay it punctuates; per-element chatter density-capped by `sfx_per_min_story_max`; a role with no sourced file is dropped + counted in `sfx_missing`), and **`dips` (the synchronized full-stop):** every `pause` gap cuts the bed to near-silence AND withholds SFX inside it, the intended hit landing at the gap end. A `pause` cue inserts its silence by splicing a derived `vo.breath.mp3` (VO untouched) + shifting the word-timings ONCE — the frame holds across it, separate from the writer's `[PAUSE]` prosody. Register pull-backs on human-cost are authored `dry` spans. The only mechanical overlay SFX is a `text` overlay → `tick` (device-card roles dormant until the Phase-2c producers). See `audio-plan-schema.md`. Kit files staged into `assets/audio/`; `--no-audio` skips it |

## 3. Overlay types the engine implements (T2 — devices as code, real type)

| type | params | renders |
| --- | --- | --- |
| `text` | `text, at_s` | the authored on-screen overlay (top on shorts, bottom-third long-form) |
| `stat-card` | `text, sub?, at_s` | the marker card, spring-pop + settle |
| `counter` | `from, to, prefix?, suffix?, at_s, duration_s` | escalating number, tabular digits |
| `chapter-card` | `text, at_s` | full-frame card on the ink ground |
| `meter` | `label, fraction, at_s` | gauge fill animation |
| `definition-card` | `term, def, at_s` | boxed definition, sparing use |
| `progressive-reveal` | `items: [{text, at_s}], mark: "x"\|"pop"` | the enumeration pattern — each item lands on its word |

`at_s` is **piece-absolute seconds** (word-anchored: look the word up in `captions.words`). The
engine positions overlays from tokens, clamps them inside the safe area, and never overlaps the
caption band.

## 4. Guarantees the engine keeps (parity with the legacy path)

- Cuts land on `vo_ref` words (same matcher semantics); Σ durations = VO length.
- Hard cuts only; no fades exist in the component set.
- Every shot moves: spring camera + idle baseline; a static dead frame is unrepresentable.
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

## 5. Channel tokens (`channels/<name>/visual-kit/motion-tokens.json`)

Data, not code — the engine is niche-agnostic; the whole file is copied into `tokens` verbatim
(§1). It styles **only ENGINE-drawn elements** (captions, device cards, camera feel); character +
in-image law lives in `style-bible.md`. One row per top-level block below, with its exact sub-keys
and the engine element it drives. Missing file → engine built-in neutral defaults; every value
optional. Keys prefixed `_` (e.g. `_doc`, `_font_note`, `_drift_note`, `_note`) are documentation,
not read by the engine.

| block | sub-keys | drives |
| --- | --- | --- |
| `font_family` | *(one CSS font stack string)* | the face for ALL engine-drawn text — device cards, overlays, shorts captions (in-image diegetic lettering is style-bible's, not this) |
| `palette` | `ink`, `accent`, `card_bg`, `bg_default` | card/text ink, the shared red accent (= in-image red, see style-bible §4), card fill, placeholder-card ground |
| `caption` | `enabled_long_form`, `size_frac_long`, `size_frac_short`, `color`, `highlight`, `outline`, `y_frac_long`, `y_frac_short`, `words_per_page_long`, `words_per_page_short`, `all_caps_short` | the word-highlight caption track (size/color/highlight/outline/vertical-position/words-per-page per aspect; `enabled_long_form:false` = the measured 16:9 grade burns no captions) |
| `card` | `border_px`, `radius_px`, `shadow`, `tilt_deg` | the frame of every T2 device card (border weight, corner radius, drop shadow, resting tilt) |
| `idle` | `bob_px`, `period_s`, `breathe_scale` | the idle baseline — figure bob amplitude/period + subtle breathe scale. **`bob_px: 0` = frames hold dead-still** (The Second Take's setting) |
| `camera` | `push_scale`, `pull_from`, `whip_frames`, `pan_frac` | **all dormant** — the camera is always locked (2026-07-12) and the whip entrance was retired, so build_motion emits no move; the engine `CameraStage`/whip read them only if a future explicit move is authored |
| `type_on` | `story_chars_per_s`, `card_chars_per_s` | text type-on speed (story overlays vs device cards) — text animates on at speech pace |
| `entrance` | `pop_settle_s`, `slide_s` | element-entrance timing (pop/settle spring vs slide ease-out) |
| `audio_layer` | *(legacy — superseded)* | The audio layer no longer reads `motion-tokens.json`. `build_audio.py` consumes a **separate** `visual-kit/audio-tokens.json` (`music_pools`, `music_present_db`, `music_default_mood`, `track_switch_gap_s`, `music_fade_s`, `sfx_pools`/`sfx_gain_db`, `sfx_per_min_story_max`, `thin_extra_db`, `dip_db`) for the `audioSpec` block + the engine `MusicLane`/`SfxTrack`. Any `audio_layer` block still present here is stale and ignored |
