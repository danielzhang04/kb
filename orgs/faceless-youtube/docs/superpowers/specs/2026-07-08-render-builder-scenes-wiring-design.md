# Render-builder ← image-generation wiring — Design (2026-07-08)

**Status:** approved 2026-07-08 (follow-up #1 of the image-generation rebuild, same-day).
**Problem:** render Pattern A sends each shot's `still_prompt` as bare text to JSON2Video's bundled
image model — no seeds, no rig, no verify — so the locked style never reaches the rendered MP4. The
`image-generation` two-pass flow now produces verified `assets/scenes/<shot-id>.png` per shot; nothing
consumes them.

## Decisions

- **A third asset-resolution mode, `scenes` — the pipeline default.** Per shot, use the verified
  pre-generated file as the scene's image element, hosted via the existing presigned `upload_asset()`
  seam (the same one the VO uses; local files get a `__LOCAL__` sentinel resolved at submit).
  `ken_burns`, overlays, timing, captions unchanged.
- **Mode selection precedence:** explicit `--pattern` > auto-detect (`assets/scenes/manifest.json`
  exists → `scenes`) > `shots.json` `render_pattern` > `inline`. `A`/`B` remain accepted aliases for
  `inline`/`clips` (channels without a style bible keep working; B stays the dormant external-clips
  path).
- **Resolution ladder in scenes mode, per shot:**
  1. `assets/scenes/<shot-id>.png` (shorts: `<short-stem>-<shot-id>.png`) exists → use it.
  2. Missing, and the shot's `source` ∈ {chart, screencap, stock, archival} (the sources
     image-generation deliberately skips) → inline-gen fallback for that shot, counted in the manifest.
  3. Missing, and the shot is `ai-gen`/`hybrid` → **hard fail** listing every missing shot id ("run
     image-generation pass 2") — silent off-style inline gen is the bug this kills. `--allow-missing`
     is the explicit test-slice escape hatch (falls back inline + warns + records).
- **Manifest transparency:** each piece records `pattern`, `scenes_from_files`, `inline_fallback`
  counts (+ the allowed-missing list) so compliance-check can see exactly what was style-locked.
- **Out of scope:** thumbnail (publish-queue's file — it should read `scenes/thumbnail-primary.png`
  when present; noted in its build spec), Pattern-B/Kling motion, Remotion.

## Consequences

- `visual-prompt-writer` and `shots.json` need no changes — the convention (`<shot-id>.png`) + the
  scenes manifest carry the wiring. `still_prompt` remains authored for every shot: it is
  image-generation's input (and the inline fallback's).
- Scenes mode spends no JSON2Video gen credits (images are pre-made) — only render time.
- Pipeline order becomes: visual-prompt-writer → **image-generation (pass 1 + 2)** ∥ voiceover →
  render-builder → compliance → publish.
