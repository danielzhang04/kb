# PICKUP — Tier-1 integration test DONE; Tier-2 next (2026-07-13)

> **▶ RESUME HERE.** The pipeline integration test's **Tier-1 PASSED** — the full skill-handoff chain
> ran end-to-end on a real Poyais slice and produced a watchable MP4 (device cards + audio gated by
> Daniel). 7 seams found, 6 fixed (all committed). **Tier-2 is the next milestone** (needs a pip install;
> see below). Full reasoning: `knowledge/decisions.md` 2026-07-13.

## What Tier-1 proved
Fresh run of `VPW → lint_shots → motion-planner → lint_motion_plan → voiceover (real ElevenLabs) →
audio-director → build_motion --allow-missing --motion-plan → chunked Remotion render` on a **~4:25
first-act Poyais slice**, scratch slug **`channels/the-second-take/videos/_poyais-test-slice/`** (placeholder
scenes + real VO). Device-card placement + timing + audio feel human-approved. Doubled as the
audio-director dogfood (12 cues, master −14.35 LUFS — approved).

### Reproduce / re-render the Tier-1 slice
The scratch slug's artifacts are on disk (script.md, shots.json, shots.motion.json, audio-plan.json,
assets/vo.mp3 + manifest). It is **not committed** (matches the repo's untracked-video-folder pattern;
mp3/mp4 are gitignored). To re-render:
```
RENDER_CONCURRENCY=2 RENDER_CHUNK_FRAMES=1500 py -3 .claude/skills/render-builder/scripts/build_motion.py \
  channels/the-second-take/videos/_poyais-test-slice --allow-missing \
  --motion-plan channels/the-second-take/videos/_poyais-test-slice/shots.motion.json --only long-form
```
Open the result: `powershell -NoProfile -Command "Start-Process '<path>\assets\final.mp4'"` (VS Code
preview is muted on this machine).

## Fixes shipped this session (committed)
- **voiceover.py** — fallback extractor stops at the trailing `## ` appendix (no more reading `## Sources`).
- **build_motion.py** — `--motion-plan` NameError fixed (`Path().exists()`); cutout layers drop under
  `--allow-missing` when their PNGs are absent; **device cards VO-anchored** (`anchor` → `at_s` via
  `render.anchor_time`, fallback shot-start).
- **render.py** — new `anchor_time()` (reuses the one `match_shots_to_tokens` matcher).
- **render-video.mjs** — **chunked rendering** (`RENDER_CHUNK_FRAMES`, default 1500, 0=off) + ffmpeg
  concat; `RENDER_TIMEOUT_MS` env. This is REQUIRED for full-length renders (flat OOMs the Chromium tab).
- **components.tsx** — counter default climb 1.5→1.0s.
- **animation-rules.md / shots-motion-schema.md** — document the device-card `anchor`.
- **test_motion_plan_merge.py** — locks anchor-pin + fallback.

## ▶ Tier-2 — the next milestone (do later)
1. **Prereq install (was audit gap #1):** `pip install pillow rembg onnxruntime` — `test_cutout.py` fails
   today on missing PIL; real `forge cutout` needs it. (Confirmed absent on this box: numpy/scipy/PIL/rembg
   not installed; the pipeline SCRIPTS are stdlib+ffmpeg so Tier-1 didn't need them — Tier-2 image-gen does.)
2. **Run image-generation** on the slice (or the full Poyais) → materializes `assets/scenes/*.png` (pass 2)
   + the layered `plates/` + `cutouts/` PNGs for L03/L13/L68. Then re-render: the grey placeholders become
   real art, the ship/MacGregor/SOLD cutouts animate, and the guidebook pops finally land on the *visible*
   accreting elements (they're already correctly timed to the delta cuts — just invisible in Tier-1).
3. **Fix finding #7 (device-card double-draw) BEFORE the real render:** `apply_motion_plan` keeps the baked
   `scenes/<id>.png` for engine-only device-card shots, so a carded number (e.g. £200,000) would appear on
   BOTH the still and the card. Fix path: either VPW omits the carded number from the device-card shot's
   `still_prompt`, OR build_motion honors a subtracted `plate_prompt` for engine-only shots. Decide + implement.
4. **Full-length real render** — the chunked engine should handle it (Tier-1 proved chunking holds memory);
   confirm on the full ~9.5-min Poyais.

## Also still queued (unchanged)
- Deferred doc drift: `idea-generator` docs still reference retired `scriptwriter`; `motion-planner` SKILL
  description says `audio-cue-writer` (should be `audio-director`). Small `curate-doc` passes.
- Audio: Daniel said the audio is "good for now, may iterate later" — no changes needed yet.
- The older queue (composition-variety gold exemplar, `_chain-test` validation, font pick, motion A/B) is
  unchanged — see the CLAUDE.md "Also queued" bullet.

## Warnings
- **Parallel terminals share this tree.** `knowledge/decisions.md` had another terminal's uncommitted WIP
  this session — my 2026-07-13 entry was added to the working tree but LEFT UNSTAGED (not in my commit) to
  avoid sweeping their WIP. Stage explicit paths; never `git add -A`; never rewrite history.
- The scratch slug `_poyais-test-slice/` is intentionally uncommitted (test fixture; regenerable via the
  command above).
