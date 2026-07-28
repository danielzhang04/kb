# motion.json — the per-video motion spec the Remotion engine renders

The contract between `scripts/build_motion.py` (writes it, one file per piece at
`videos/<slug>/assets/motion/<piece>.motion.json`) and the engine
(`engine/render-video.mjs` → the `Video` composition), which receives it verbatim as Remotion
`inputProps`. **Derivable-first:** almost every field is computed mechanically from `shots.json` +
the scenes manifest + `voiceover.manifest.json` + the channel's `motion-tokens.json`.

The live animation tier is the **cutout layer** — a shot's baked `plate` plus animated `layers[]`
(`appear`/`bob`/`slide`/`path`), planned by `motion-planner`, materialized by `image-generation`,
rendered by the engine `LayerView`; `apply_motion_plan` merges them into the derived shots, never a
schema change. Camera + idle baseline over a still are the engine's own furniture. In-video text is
baked into the generated images — the engine draws text only as captions and chapter cards (§3).

## 1. Shape

```json
{
  "schema": "faceless-youtube/motion@1",
  "piece": "long-form",
  "video_slug": "YYYY-MM-DD-slug",
  "fps": 30, "width": 1920, "height": 1080,
  "audio": "vo.mp3", "audio_seconds": 728.4,
  "tokens": { "<the channel visual-kit motion-tokens.json, copied in verbatim>": "…" },
  "captions": { "enabled": true, "style": "long-form", "words": [["In", 0.0], ["1822,", 0.24]] },
  "audioSpec": {
    "music_states": [{"track": "audio/beds/sneaky-1.mp3", "at_s": 0.0, "dur_s": 23.8, "base_db": 7, "fade_in_s": 0.5, "fade_out_s": 0.9}],
    "events": [{"sfx": "audio/sfx/boom.mp3", "at_s": 12.4}],
    "dips": [],
    "thin_spans": [{"at_s": 44.0, "dur_s": 5.5, "extra_db": 8}],
    "music_missing": 0, "sfx_missing": 0
  },
  "shots": [
    {
      "id": "L01", "start_s": 0.0, "duration_s": 3.42,
      "image": "scenes/L01.png", "placeholder": null,
      "stage": "guidebook-desk", "stage_role": "base",
      "camera": { "move": "none", "pan": null, "intensity": 0.0 },
      "entrance": "cut", "idle": "bob", "overlays": [],
      "plate": "plates/L01.png",
      "layers": [
        { "id": "macgregor", "src": "cutouts/L01-macgregor.png", "animation": { "type": "slide", "from_edge": "left", "to": [0.5, 0.9], "dur_s": 1.8, "height_frac": 0.6 } }
      ]
    }
  ]
}
```

`audioSpec` is named so it never clashes with `audio` (the VO mp3); it is `null` under `--no-audio`.
Kit files stage into `assets/audio/` at build, and each music-lane TRACK is TILED to the full video
length so the engine `<Audio>` never loop-wraps (per-frame volume modulation past a track's own length
misfires). The skeleton shows the default locked camera (`move: none`, intensity `0.0`).

## 2. Field derivations (build_motion.py; all paths relative to `videos/<slug>/assets/`)

| field | derived from | rule |
| --- | --- | --- |
| `fps`/`width`/`height` | piece | 30; 1920×1080 long-form, 1080×1920 shorts |
| `audio`, `audio_seconds`, `captions.words` | `voiceover.manifest.json` | the piece's audio + `word_timings` (same stream `vo_ref` matches against) |
| `captions.enabled` | flags + tokens | `!--no-captions` AND (a short piece OR `tokens.caption.enabled_long_form`, default true) — a channel opts long-form out via `motion-tokens.json` |
| `start_s`/`duration_s` | `retime_by_timings` / `retime` (imported from `render.py`, the shared timing/scene helpers) | cuts land on `vo_ref` words, proportional fallback |
| `image` | scenes-mode resolution (imported `resolve_scene_files`) | verified `scenes/<id>.png` (shorts: `<short-stem>-<id>.png`, where **short-stem** = `Path(shorts[].file).stem` — the same prefix render.py + the SKILL use). **Missing ai-gen/hybrid scene = HARD ERROR**; `--allow-missing` renders a placeholder + records it |
| `placeholder` | `source` ∈ chart/screencap/stock/archival, or allowed-missing | `{kind, label}` — the engine renders a styled placeholder card (the `PlaceholderCard` component) instead of an image; counted in the manifest |
| `stage`/`stage_role` | shots.json (intent fields, when present) | passed through; used to group a held set. Hard cuts remain universal; a stage shares its first camera arc |
| `camera.move`/`pan` | `--motion-plan` stage-start `camera` | locked `none`/`null` unless authored as `push`/`pull` + optional cardinal pan; maps to engine `push-in`/`pull-back`; later deltas hard-fail |
| `camera.intensity` | `--motion-plan` stage-start `camera` | `0.0` when locked; authored value in `(0,1]` |
| `entrance` | — (constant) | **Always `cut`** — entrances are never authored per shot |
| `idle` | tokens default or plan opt-in | `tokens.idle` governs unless `shots.motion.json` sets `baseline_life:true`; then the separate `tokens.baseline_life` block overrides idle for real scene and layered tableaux, never placeholders/cards |
| `overlays` | `--motion-plan` (`apply_cards`), else `[]` | **chapter CARDS only.** `apply_cards` resolves the plan-level `cards[]` (`text` + verbatim VO `anchor` + `hold_s`/`fade_s`) to `chapter-card` overlays and attaches each to the shot whose span holds the resolved time; the end card (`end_card:true`) + plan-level `post_vo_hold_s` extend the last shot past the final word. Shots with no card keep `overlays: []`. Authoring law: `shots-motion-schema.md` §Chapter cards |
| `plate` / `layers` | `--motion-plan` (`apply_motion_plan`) | **present only on a layered shot.** Merged from `shots.motion.json` by id: `plate` = `plates/<id>.png` (the baked background), `layers[]` = `{id, src: cutouts/<id>-<layer>.png, animation}`. Absent = a plain baked shot (`image` path). The engine `LayerView` renders each layer; a shot with `layers` uses `plate` as its base instead of `image` |
| `audioSpec` | `build_audio.py` (reads `visual-kit/audio-tokens.json` + the resolved `audio-plan.json` cues) | Audio is AUTHORED by `audio-director` as `audio-plan.json` (SFX · pause · music · dry); `build_motion` splits it (`audio_plan.split_plan`) and `build_audio` realizes it deterministically: a **placed music lane** (`music_states` — non-overlapping mood segments at a constant present level, NOT a wall-to-wall bed; authored `dry` spans + different-bed track-switch gaps carve silence, same-bed neighbours coalesce; `music_missing` counts an unsourced mood; no plan → one full-length default-mood segment), **SFX `events`** (every SFX comes from an authored cue — a `sync:"element"` item-appearance sound snaps to the cut/cutout-layer it punctuates; per-element chatter is density-capped by `sfx_per_min_story_max`; a role with no sourced file is dropped + counted in `sfx_missing`), and **`dips`** (the synchronized full-stop: an authored `pause` gap cuts the bed to near-silence AND withholds SFX inside it, the intended hit landing at the gap end — empty when the channel sets `dip_in_pause:false`). A `pause` inserts its silence by splicing a derived `vo.breath.mp3` (VO untouched) + shifting the word-timings ONCE; the frame holds across it. Register pull-backs are authored `dry` spans. Fields + laws: `audio-plan-schema.md`. `--no-audio` skips it |

## 3. Overlays — chapter cards

`ChapterCard` is the one overlay component on a live path, emitted via the plan-level `cards[]` →
`apply_cards` → `chapter-card` overlays: full-frame **FULLY OPAQUE** near-black text beats that read
as their own scenes. Card style: `#151310` ground, `palette.card_bg` cream text, Ink Free, centered,
quick ~0.15s fade, **no card chrome**. Because the card is opaque, each in-video card's `dur_s` is
AUTO-ALIGNED to a co-located spliced pause silence (the audio-director authors a `pause` on each
in-video card anchor) so it never covers VO; the end card is exempt and runs to its post-VO-extended
shot end. Authoring law: `shots-motion-schema.md` §Chapter cards. All other in-video text (stats,
labels, definitions, enumerations) is baked into the scene/plate images by `image-generation`.
Captions are a **separate** track, not an overlay: they flow through the top-level `captions` field
into `Captions`. Other overlay components + their token blocks: `docs/retired-features.md`.

## 4. Guarantees the engine keeps

- Cuts land on `vo_ref` words; Σ durations = VO length; hard cuts only (no fades in the component set).
- Legacy motion remains unchanged unless opted in; baseline life never moves placeholders or opaque cards.
- One movie-level VO track; word-highlight captions from `captions.words` (no transcription);
  `--no-captions` supported.
- Output + `render.manifest.json` in the standard schema
  (`render_engine: "remotion"`, `watermark: false`), so compliance-check/publish-queue read it
  unchanged. Each rendered piece's record also carries the loudnorm result (`audio_lufs`,
  `audio_true_peak`) + an **`audio`** block from `audio_checker.check_audio` (deterministic,
  **warn-not-fail**): `{ok: bool, warnings: [str], measured: {lufs, true_peak, music_segments,
  sfx_count, sfx_missing, music_missing}}` — verifies the master hit `master_target`, no sound/mood was
  silently dropped, the register layer fired, and the music lane is sane. FEEL is the human ear-gate.

## 4a. Cutout layer render fields (engine `LayerView`)

Each `layers[]` entry is `{id, src, animation}`; `apply_motion_plan` copies `animation` verbatim (any
field passes through). Two render-only knobs beyond the menu params (when to use each:
`motion-planner/references/animation-rules.md`):

- **`animation.anchor_origin`** (`"center"` | `"bottom"`, optional, any type) — overrides the vertical
  transform origin. Per-type defaults: `appear`/`path` = element **center** (`translate -50%`);
  `slide`/`bob` = element **bottom** (`translate -100%`, feet-on-ground). Unset = the default.
  DISTINCT from `anchor` (verbatim VO words → `start_s`); horizontal origin is always `-50%`.
- **`animation.dot_count`** (int > 0, default 44) / **`animation.dot_r`** (px > 0, default 5) — on a
  `path` with `draw_line`, the number and radius of the route dots the engine draws. Per-layer, so one
  route can be dotted without changing the others.

## 5. Channel tokens (`channels/<name>/visual-kit/motion-tokens.json`)

Data, not code — the engine is niche-agnostic; the whole file is copied into `tokens` verbatim (§1).
It styles the engine-drawn elements — captions, chapter cards, camera feel; character + in-image law
lives in `style-bible.md`. One row per top-level block, with its exact sub-keys and the engine element
it drives. Missing file → engine built-in neutral defaults; every value optional. Keys prefixed `_`
(`_doc`, `_font_note`, `_drift_note`, `_note`) are documentation, not read by the engine. Blocks a file
may still carry that drive no live element (`card`, `type_on`, `whip_frames`, `audio_layer`) are
omitted below — see the §3 pointer.

| block | sub-keys | drives |
| --- | --- | --- |
| `font_family` | *(one CSS font stack string)* | the face for engine-drawn text — captions + chapter cards; in-image diegetic lettering is style-bible's, not this |
| `palette` | `ink`, `accent`, `card_bg`, `bg_default` | text ink, the shared red accent (= in-image red, see style-bible §4), the placeholder-card ground; `card_bg` is also the chapter card's cream text |
| `caption` | `enabled_long_form`, `size_frac_long`, `size_frac_short`, `color`, `highlight`, `outline`, `y_frac_long`, `y_frac_short`, `words_per_page_long`, `words_per_page_short`, `all_caps_short` | the word-highlight caption track (size/color/highlight/outline/vertical-position/words-per-page per aspect; `enabled_long_form:false` = a 16:9 grade that burns no captions) |
| `idle` | `bob_px`, `period_s`, `breathe_scale` | legacy idle baseline. **`bob_px: 0` = frames hold dead-still** (The Second Take's setting) unless a plan opts into `baseline_life` |
| `baseline_life` | `bob_px`, `period_s`, `breathe_scale` | the calibrated block applied only for plan-level `baseline_life:true`; scene-backed and layered tableaux only, never placeholders/cards |
| `camera` | `push_scale`, `pull_from`, `pan_frac` | camera response for the rare authored stage-start `push`/`pull` |
| `entrance` | `pop_settle_s`, `slide_s` | element-entrance timing (pop/settle spring vs slide ease-out) — used by the live cutout `LayerView` |
