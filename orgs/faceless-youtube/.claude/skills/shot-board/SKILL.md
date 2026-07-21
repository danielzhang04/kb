---
name: shot-board
description: >-
  Builds the Gate-2 shot board — the single self-contained HTML page a HUMAN reviews before
  approving a video's generated stills in this faceless-YouTube project. Use this whenever a
  storyboarded + imaged video folder needs its Gate-2 review surface: "build the shot board",
  "the Gate-2 surface", "let me review the stills", "show me every shot against the script", or
  the runner reaches the shot-review gate. Reads the video's shots.json (story order + script
  lines), shots.motion.json (motion intent), assets/library + assets/scenes and their manifests
  (the still + the review_status honesty), and writes ONE gitignored file,
  videos/<slug>/assets/board.html — every shot card shows the downscaled still, the covered
  script lines, the motion intent, and the machine's honest review badge (verified / parked +
  reasons / unreviewed) so a parked or unreviewed frame can never hide behind a nice thumbnail.
  Runs AFTER image-generation (and motion-planner) and BEFORE the human's Gate-2 sign-off. The
  orchestrator publishes the file as the per-video Claude artifact; this skill only writes it.
  Does NOT generate, edit, review, or approve any still — it is read-only over the video and only
  writes the board. Do NOT use it to generate the images (image-generation), plan motion
  (motion-planner), or run the pre-publish compliance gate (compliance-check).
---

# shot-board

Render the **Gate-2 human review surface**: one self-contained `board.html` that lays every
generated still beside the script line it covers, its motion intent, and — the whole point — the
machine's **honest** `review_status` badge. This skill is a **read-only surface generator**: it
reads a finished-storyboard video folder and writes exactly one file. It never generates, edits,
reviews, or approves a frame. **The board makes the human's Gate-2 decision fast and well-grounded
— it does not replace it.**

## Where this sits in the pipeline

`image-generation` (+ `motion-planner`) → **shot-board** → *human Gate-2 sign-off* → `render-builder`

- **Reads (all in `channels/<name>/videos/<slug>/`):** `shots.json` (long-form shots, story order,
  `vo_text`/`on_screen_text` coverage), `shots.motion.json` (per-shot `background` mode + animated
  `layers` = motion intent), `assets/library/manifest.json` (+ ref images), `assets/scenes/*.png`,
  `assets/scenes/manifest.json` (Task-2 `review_status` / legacy `verified` booleans).
- **Writes:** `assets/board.html` — `<title>` = video slug; a `## Cast & props` section
  (`id="cast-props"`, every library ref as a data-URI image + id + description); shot cards in
  `shots.json` story order, each carrying `data-shot-id`, a downscaled JPEG data-URI still, the
  covered script lines, the motion intent, and the review badge + parked reasons / lint flags.
- **Gitignored, media-derived.** `board.html` is regenerable output — it stays untracked (the
  `channels/*/videos/*/assets/**` gitignore covers `.html`). Never commit a `board.html`.

## How to run it

The engine is `scripts/build_board.py` (Python 3; stdlib + **Pillow** for the downscaled JPEG
thumbnails — no network, ever). Use `py -3` on this machine.

```
py -3 scripts/build_board.py <video_dir> [-o out.html]
```

- `<video_dir>` — path to `channels/<name>/videos/<slug>/`.
- `-o/--output` — output path; **default `<video_dir>/assets/board.html`**.

The **orchestrator** publishes the resulting file as the per-video Claude artifact (a stable URL
per video, republished each review round). This script only writes the file to disk.

## The review badge — mirrors `render.py::_entry_review_reason`

The badge is the honesty of the board, so it **must** agree with the render gate. The logic is
**restated here, never imported** (the two are a checked pair — if one changes, change both):

- **`review_status` is authoritative when present:** `"verified"` → **verified** (shippable);
  `"parked"` → **parked** + its `parked_reasons` (defects known, honestly NOT shippable);
  anything else (`"unreviewed"` / unknown) → **unreviewed**.
- **`review_status` absent → legacy boolean gate:** `verified.scene` AND `verified.rig` both true
  → **verified**, else **unreviewed**.
- **No manifest entry at all → unreviewed** (the human surface is deliberately conservative: an
  unrecorded frame reads as "not yet reviewed", never as verified — this is the one intentional
  divergence from render's layered/fallback compat carve-out, which lets a *no-entry* layered shot
  pass the render gate; the board still shows it as unreviewed so the human notices).

`flagged` / `blocking` manifest signals render as extra lint chips next to the badge. A shot whose
still is absent or unreadable renders a visible **MISSING** placeholder — never a crash.

## Design notes

- **Self-contained, offline.** Every image (shot stills + library refs) is inlined as a downscaled
  (~480px, PIL quality 70) JPEG `data:` URI; CSS is embedded; there is **no JS and no external
  `http` `src`/`href`**. The page opens anywhere with no network.
- **Size budget < 20 MB.** JPEG quality 70 at 480px keeps a ~120-shot video well under budget
  (poyais: 117 shots → ~5.6 MB). If a future video exceeds 20 MB, drop `JPEG_QUALITY` /
  `THUMB_WIDTH` at the top of `build_board.py`.
- **Pure derivation.** Reads inputs, writes HTML, touches nothing else. Degrades gracefully: a
  missing/unparseable input yields an empty section, not a crash.

## Schema notes (pinned against real poyais data 2026-07-20)

- **shots.json:** `long_form.shots` is the story-ordered list; each shot's `vo_text` (fallback
  `vo_ref`) is the covered script line, `on_screen_text` the burned-in text, `beat` the section.
- **shots.motion.json:** `shots` list; per shot `background.mode` (`plate` = static / `delta-chain`
  = moving) + `layers[]` (each `id` + `animation.type`). Camera is always locked here, so "motion"
  == element-layer motion + background mode.
- **assets/scenes/manifest.json:** `shots` list keyed by `shot_id`; carries `review_status` /
  `parked_reasons` (Task-2) OR legacy `verified.{scene,rig}` booleans, plus `file`, `flagged`.
- **assets/library/manifest.json:** `assets` list; ref id is **`name`**, description is **`notes`**,
  image is **`file`** (relative to the video dir) — mapped to the board's id / description / image.

## Tests

`scripts/test_build_board.py` — network-free, tmp-dir fixtures with tiny PIL-made PNGs (2 shots +
1 library ref; one `verified`, one `parked` with no PNG). Asserts: output exists, single-file (no
external `http` refs), both `data-shot-id`s in story order, the parked badge + its reasons, the
cast section id, the MISSING placeholder for the pngless shot, and unit-tests `review_badge`'s
tri-state against the `_entry_review_reason` contract. Run `py -3 -m pytest test_build_board.py -q`.
