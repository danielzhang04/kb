# bricks-fresh rendered — full-video preview.mp4 + end pass-through owed — 2026-07-30

## Context

The Second Take video #1 rebuild (`2026-07-28-bricks-fresh`, MiniScribe bricks story) ran
straight through Daniel's no-checkpoint directive: full image gen → board → voiceover-manifest
recovery → motion plan → render. The mp4 EXISTS and is QA-verified; what remains is the
human pass-through Daniel already scheduled ("we can do a pass through at the end" on rig/outfit
nits) plus the parked-shot repairs, music, and motion-layer merge that separate `preview.mp4`
from a shippable `final.mp4`. All work on branch `claude/fyt-gated-pipeline` (pushed, head
`14fc06f`); binaries (mp4, vo.mp3, scenes/, board.html) are disk-only in the video's `assets/`
per the gitignore convention — they exist ONLY on this machine.

## Done (evidence)

- **preview.mp4** at `orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/assets/preview.mp4`
  — 546.50s (9:06.5 = VO 539.96s + 5.98s measured sentence-gap padding), 1920×1080 h264
  29.97fps + AAC stereo, 73.4 MB, all 215 shots in timeline (`scenes_from_files: 215`,
  0 dropped), 31 parked shots included via `--preview-parked`. QA (ffprobe, 8 frame
  spot-checks incl. parked + last-30s, 3-window volumedetect) in `render-log.md`.
  Boss re-probed independently. NOTE: parked-included renders emit `preview.mp4` by design,
  stamped `state: "preview-parked-included"`, and fail compliance-check on purpose — `final.mp4`
  only exists once parked shots are resolved and a clean render runs.
- **Image gen complete** (commit `309b341`): 215 shots + 3 thumbnails, **187 verified / 31
  parked**, $47.44 of $60 cap (354 gens), ~3h03 wall = per-shot wall 119s (slice run) → ~51s
  (2.3× faster) through the new DAG-parallel forge (`--concurrency 4`) + escalation review
  (12 dispatches). 4 new cast canonicals registered (qt-wiles, hq-banker, brick-foreman,
  auditor-rep) + 2 pose primitives. Full run log: video's `gen-log.md`.
- **Voiceover manifest RECOVERED** after a dry-run clobber (a mis-addressed instruction hit a
  finished subagent, which ran `voiceover --dry-run` over the production manifest):
  rebuilt via LOCAL forced alignment (faster-whisper ASR + wav2vec2 CTC refine, ground-truth
  mapped to vo.txt) — 1,632/1,632 words byte-equal, monotonic, 5 audio spot-checks ≤162ms,
  consumers proven (render.py readers exact; lint_shots byte-identical to baseline).
  `dry_run: false`, provenance recorded in the manifest's `reconstructed` field.
  vo.mp3 (539.96s) and vo.txt were never touched.
- **Motion plan authored, NOT merged** (commit `14fc06f`): `shots.motion.json` — 215 shots,
  lint-clean, 10 shots with cutout layers (12 layers), 2 camera punctuations (L01, L178).
  Deliberately excluded from this render: the cutout layers need image-gen to materialize
  plate/cutout PNGs. It is the ready human-gate artifact for that pass.
- **Board built**: `assets/board.html` (5.88 MB, 215 cards, honest badges). Daniel waived the
  live gate; the board is the surface for his end pass-through.
- Speed wave (commit `7658d68`) + VPW artifacts (`38e0426`) landed earlier in the arc.

## Remaining (ordered)

1. **Daniel's end pass-through** at `assets/board.html`: 31 parked shots
   (L01,07,08,09,12,15,16,17,18,20,21,25,31,32,33,34,35,36,39,40 = slice carryovers;
   L78,87,88,97,102,112,123,133,171,205,215 = new, reasons in scenes/manifest.json — incl. a
   recurring "Victorian drawing room" hallucination attractor on 5) + rig/outfit nits he
   flagged on the slice. Also owed at this board: pc-boxy Macintosh trade-dress ruling +
   F-12 prop-slug asymmetry (plan §4b residuals).
2. **Repair wave** for whatever the pass-through condemns (forge `reject` → regen; budget cap
   needed from Daniel — $12.56 headroom left under the original $60).
3. **Music**: music-forge pools are wired at channel level (`audio-tokens.json`) but the bed
   MP3s are NOT on this machine — fetch/regen them, then an audio-director pass (none exists
   yet; render is VO-only with graceful silence).
4. **Motion merge**: image-gen pass to materialize the 10 layered shots' plates/cutouts, then
   re-render with `shots.motion.json` merged.
5. **Final render**: clean `final.mp4` (no `--preview-parked`), compliance-check green, then
   the GATE 3 flow (thumbnail pick from 3 candidates in `assets/thumbs/`, metadata, upload).
6. **Known VO-timing flags** (pre-existing, untouched): render's audio checker reports 1
   splice-continuity FAIL at 413.3s + 2 near-truncation warnings + 3 short sentence-gaps —
   listen at 413s during the pass-through before deciding whether to re-splice.
7. **ElevenLabs key lacks `forced_alignment` scope** (401) — Daniel: tick the permission in
   the dashboard so future manifest rebuilds don't need the local-alignment fallback.
8. Housekeeping: image-gen spend for this run is ledgered in `gen-log.md` only (no
   `ledgers/cost/` row — decide if fyt gen spend should mirror there).

## Gotchas

- faster-whisper/PyAV silently truncates concatenated-TTS mp3s (~102s of 540s) — decode via
  `whisperx.load_audio` (ffmpeg subprocess) and pass the array, never the path.
- git-bash PATH for ffmpeg must be MSYS-style (`/c/Users/danie/kb-tools/ffmpeg`); only
  `ffmpeg.exe` exists there (no ffprobe — use `ffmpeg -i` or Remotion's ffprobe).
- Named-character base-template regression (bald/cream/hoodie) is the channel's known systemic
  defect class; identity-lock retry prose fixes most (109/120 in one wave).

## Load list

- `orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/render-log.md`
- `orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/gen-log.md`
- `orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/assets/board.html` (open in browser, with Daniel)
- `orgs/faceless-youtube/docs/superpowers/plans/2026-07-29-vpw-image-prompting-integration.md` (§4b residuals)
- `orgs/faceless-youtube/STATE.md`
- Skill to invoke for repairs/re-render: `image-generation` (forge reject flow), `render-builder`
