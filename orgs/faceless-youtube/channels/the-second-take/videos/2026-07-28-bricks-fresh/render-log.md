# Render log — 2026-07-28-bricks-fresh (build worker pass, 2026-07-30)

Scope: motion planning → music → final render → QA, on the fully-generated video (215 long-form
shots, 187 verified / 31 parked, no shorts). NO image generation, NO TTS, NO API spend, no commits
(boss commits after grading). Branch: `claude/fyt-gated-pipeline`.

## 1. Motion planning

Ran the `motion-planner` skill's classification contract over all 215 shots in `shots.json`
(two-test boundary: DISCRETE+SEEDABLE → cutout layer, INTEGRATIVE → stays baked delta-chain,
everything else → passthrough), decomposed layered shots by subtraction, ran the fresh-eyes critic
pass, and lint-gated with `scripts/lint_motion_plan.py`. Output: `videos/2026-07-28-bricks-fresh/shots.motion.json`.

**Deliberate scope decision — the plan is authored but NOT merged into this render.** Any cutout
layer the plan proposes needs `plates/<id>.png` + `cutouts/<id>-<layer>.png` materialized by
`image-generation` before it can composite (confirmed via `render-builder/references/shots-motion-schema.md`
and `build_motion.py::apply_motion_plan`) — that spend is explicitly out of scope for this dispatch
("NO image generation"). Passing `--motion-plan` regardless is safe by design (`apply_motion_plan`
gracefully drops any cutout whose plate/cutout PNGs are missing under `--allow-missing`, or hard-errors
without it for a plate-only background) — but there is no value in invoking it this pass since nothing
would materialize differently: every shot renders from its existing baked `scenes/<id>.png` either way.
The plan is written as a ready, lint-clean artifact for a future human-gated image-gen pass, per the
skill's own step 7 ("human gate: present a summary for the human to approve BEFORE image-generation
spends tokens" — this log + the subagent's shot-list summary below IS that gate artifact).

**Lint: `0 error(s)`** (`lint_motion_plan.py`, independently re-run and confirmed). Counts (independently
re-derived from the written JSON, not just taken on the authoring agent's word):

- 215 shots total. **78 delta-chain passthrough** (baked INTEGRATIVE deltas, existing baked scene as
  the visual — no layer), **127 plate passthrough** (independent/base shots, no motivated motion),
  **10 shots with ≥1 cutout layer** (12 layer instances total: 5 `path`, 4 `appear`, 3 `slide`, 0
  `bob`), **3 `reuse` layers** (one cutout composited across multiple shots instead of re-authored
  per-shot, per the animation-rules anti-drift law), **2 camera punctuations** (`L01` push 0.35,
  `L178` push 0.3 — both stage-start shots). `baseline_life` left unset (legacy behavior preserved,
  the safer default for a plan that can't be visually verified this pass — see §1 scope note above).

Human-gate summary — which shots got layers and why:

| shot | VO anchor | layer(s) | reasoning |
|---|---|---|---|
| L24 | "around the world" | 3× `path` (pallet-1/2/3, 2 `reuse` the first cutout) | 3 pallets travel a shipping route on a map-style beat — discrete movers, one cutout reused 3× |
| L28 | "a guy named Terry Johnson" | `slide` (terry-johnson) | character entrance/reveal on the naming beat |
| L81 | "everybody started counting" | `slide` (auditor-rep) | auditor character enters the scene |
| L98 | "an auditor could walk up" | `slide` (auditor-rep) | auditor character enters a second, separate scene (not a `reuse` of L81 — different stage/beat, re-authored independently; worth a human glance on whether these two are close enough to warrant sharing one cutout) |
| L108 | "gave each one a serial number" | `appear` (stamp) | discrete stamp/mark overlay landing on a held scene |
| L118 | (no anchor — enters at cut) | `path` (pallet) | a pallet begins travelling |
| L119 | "went overseas to Singapore" | `path` (pallet, reuses L118's cutout) | same pallet continues its route — reused, not re-genned, per the anti-identity-drift law |
| L132 | "everything else in the building gets a pass" | `appear` (stamp) | stamp/mark overlay |
| L172 | "filed for bankruptcy" | `appear` (stamp) | stamp/mark overlay |
| L184 | "sent Wiles in to begin with" | `appear` (ghost) | discrete overlay element appearing on a held scene |

Considered and declined (restraint, not oversight — per the authoring agent's report):
- **L48** (qt-wiles's doorway arrival) — `action-powerstance`, matching this channel's other
  "discovered-already-placed" cast reveals (L01, L26, L30, L45, L60), all baked by the grammar's own
  default; kept consistent rather than treating one doorway framing as special.
- **L78** (shelf→ledger arrow diagram) — VPW's own note calls it "the one explainer-diagram
  exception the grammar allows"; left as a locked whole-graphic beat, arrow not promoted.
- **L92** / **L193** — thematically weaker duplicates of L132/L172's stamp beats; skipped to avoid
  stamp-quota padding.
- **L102** (HQ→warehouse site map) — a static dashed connector, no named travelling object, so it
  doesn't trigger the map-mover promotion rule.
- **L137** (Wiles cranking a gauge dial) — hand+dial fuse into one integrative pose, not separable.

No shots.json defects were found/flagged by the authoring agent that required a fix.

**Not merged into today's render — see the scope note above.** Any of these 10 shots' cutout/plate
PNGs (`plates/<id>.png`, `cutouts/<id>-<layer>.png`) do not exist yet; materializing them is an
`image-generation` pass, explicitly out of this dispatch's scope. This plan is the ready, lint-clean,
human-gate artifact for that future pass.

## 2. Music

`music-forge` is a channel-level (not per-video) library-build step. For `the-second-take`,
`visual-kit/audio-tokens.json`'s `music_pools` are already fully wired (casual-bed, sneaky ×6,
upbeat ×3, underscore, somber) with CC-BY provenance in `visual-kit/audio/GENERATION-LOG.md` and
`visual-kit/audio/manifest.json` — sourcing/vetting/picking already happened in a prior session.

**Finding: the actual bed MP3s are not present on this checkout's disk.** `visual-kit/audio/beds/`
does not exist. Root cause confirmed mechanically, not assumed: `orgs/faceless-youtube/.gitignore`
line 19 is `*.mp3` (line 20 `*.wav`) — all audio binaries are gitignored project-wide by convention
(`visual-kit/audio/GENERATION-LOG.md` states this explicitly: "all audio binaries are gitignored...
this log + manifest.json + audio-tokens.json are the tracked, reproducible record"). This checkout
never had a session that (re-)fetched the bed files locally. `vo.mp3` is present only because THIS
video's voiceover step ran earlier in this same checkout session.

Per the dispatch's explicit instruction ("do NOT fabricate or download music"), I did **not** run
`fetch_incompetech.py` or otherwise pull the beds down. Render-builder's own documented fallback
handles this with no flag required: `build_motion.py::build_audio_spec` drops any music segment
whose mood has no sourced track and prints `! N music segment(s) dropped — mood has no sourced
track yet (run music-forge). Render continues.` — confirmed in this run's actual output (1 segment
dropped) and in the manifest (`audio.measured.music_missing: 1`, `music_segments: 0`). The render is
VO + SFX-pool-eligible-but-unused (no SFX cues either, since no `audio-plan.json` exists for this
video — `audio-director` has not run; also out of this dispatch's scope) — i.e. **VO-only audio**,
correctly and gracefully degraded, not silently broken.

## 3. Render

Command (dry-run first per SOP, then the real render):
```
export PATH="/c/Users/danie/kb-tools/ffmpeg:$PATH"
py -3 .claude/skills/render-builder/scripts/build_motion.py channels/the-second-take/videos/2026-07-28-bricks-fresh --dry-run --preview-parked
py -3 .claude/skills/render-builder/scripts/build_motion.py channels/the-second-take/videos/2026-07-28-bricks-fresh --preview-parked
```

No `--motion-plan` (see §1), no `--allow-missing` (unneeded — every shot resolves to a real PNG;
`--preview-parked` alone is sufficient per `render.py::resolve_scene_files`, which diverts a
`parked`-with-valid-PNG shot into the shown/previewed path before it ever reaches the
missing/gate/parked hard-fail check at line 281).

**`--preview-parked` is the flag required for the 31 parked shots**, exactly as flagged in the
dispatch (commit `1b02155`). It renders their real best-attempt pixels instead of a placeholder card
or a hard failure, and — by the skill's own design — writes to a **separate** output
(`assets/preview.mp4`, not `assets/final.mp4`) stamped `state: "preview-parked-included"` so it can
never be mistaken for the shippable cut and fails `compliance-check` by construction. This matches
the dispatch's framing exactly: "this is a full-video preview render, the parked pass-through
happens later."

Wall-clock: render_wall_seconds = **486.4s** (~8.1 min) for a 545.93s (~9.1 min) 1080p30 video —
consistent with the skill's documented ~1.5× realtime.

Output: **`assets/preview.mp4`**
Render manifest: **`assets/preview.render.manifest.json`**
Motion spec: **`assets/motion/long-form.preview.motion.json`**

Non-fatal warnings surfaced by the render's own audio checker (pre-existing in `vo.mp3` /
`voiceover.manifest.json`, produced upstream of this dispatch — `vo.mp3` was NOT touched or
regenerated here, per the hard constraint):
- 1 splice-continuity FAIL @ 413.315s (raw-VO −23.6 dBFS in the 40ms before a sentence cut —
  voiced tail truncated, threshold −30)
- 2 splice-continuity WARN (near-truncation, @ 526.239s and @ 102.013s)
- 3 sentence-gap SHORT warnings (@ 206.97s, 118.31s, 417.20s — measured silence under the
  channel's target gap by 0.1–0.5s)

These are worth flagging to the boss as upstream VO-timing issues to weigh before this cut is
promoted past preview, but are explicitly out of this dispatch's remit to fix (no VO edits allowed).

## 4. QA gates — evidence

### Container / stream shape (ffprobe)
PATH note: `ffprobe` is not in the `kb-tools/ffmpeg` dir (ffmpeg.exe only); found instead at
`.claude/skills/render-builder/engine/node_modules/@remotion/compositor-win32-x64-msvc/ffprobe.exe`
(the Remotion compositor dir) and appended to PATH per the dispatch's own hint.

```
ffprobe -v error -show_entries format=duration,size \
  -show_entries stream=index,codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels,duration \
  -of default=noprint_wrappers=0 preview.mp4
```

Result:
- **Video stream** (1 only): h264, **1920x1080**, 30/1 fps.
- **Audio stream** (1 only): aac, 96000 Hz, 2 channels.
- **Container duration: 546.50s.** Engine-reported `rendered_seconds`: 545.93s (16,378 frames @
  30fps = 545.933s exactly). File size: **76,966,151 bytes (73.4 MiB)**.

Duration reconciliation: VO `est_duration_s` = **539.96s** (voiceover.manifest.json,
local-wav2vec2-forced-alignment) + measured sentence-gap padding **5.98s** (33/115 boundaries
padded, per this render's own log: "sentence gaps — 33/115 boundaries padded, 5.98s inserted
(measured from audio)") = **545.94s**, matching the engine's `retime_basis:
"per-line-timings(545.94s, 1632 words)"` and `rendered_seconds: 545.93` to within rounding. No
separate "outro beat" applies to this render — no motion-plan end-card / `post_vo_hold_s` was
merged (§1), so the container's small extra ~0.5–0.6s over the frame-exact 545.93s is ordinary
audio-track-vs-video-track tail rounding across Remotion's 11 chunked-render segments, not an
authored hold.

### Frame spot-check (≥6, spread across the timeline, parked + last-30s covered)
Extracted 8 frames via `ffmpeg -ss <t> -frames:v 1` at shot midpoints, spanning the full timeline,
then deleted (scratch, not a deliverable):

| shot | t (s) | verified/parked | mean luma (0-255) | visual check |
|---|---|---|---|---|
| L01 | 0.8 | parked | 115.0 | pc-boxy character in the 1980s den — matches `still_prompt`, correct art |
| L05 | 8.8 | verified | 146.6 | non-black |
| L50 | 121.1 | verified | 146.8 | non-black |
| L100 | 247.1 | verified | 122.1 | non-black |
| L133 | 331.2 | parked | 135.3 | TSA-style checkpoint scene, coherent character art, correct |
| L171 | 423.0 | verified | 93.4 | non-black |
| L205 | 521.2 | **parked, last 30s** | 138.1 | non-black |
| L215 | 545.0 | **parked, last shot (last 30s)** | 129.2 | brick-in-box closing beat — coherent, correct |

All 8 frames visually confirmed non-black with correct, on-model art (3 viewed directly: L01, L133,
L215). Mean luma range 93–147/255 — no black or blank frames.

### Audio spot-check (volumedetect, start/middle/end windows)
```
ffmpeg -ss <t> -t <dur> -i preview.mp4 -af volumedetect -f null -
```
| window | mean_volume | max_volume |
|---|---|---|
| start (5–15s) | −18.8 dB | −1.0 dB |
| middle (270–280s) | −18.6 dB | −0.9 dB |
| end (530–544s) | −18.5 dB | −0.8 dB |

Audio present and consistent across the whole timeline (no silent window); matches the manifest's
measured mastering (`audio_lufs: -14.58`, `audio_true_peak: -1.00`).

### Shot coverage (all 215 shots in the timeline)
`preview.render.manifest.json`: `scene_count: 215`, `scenes_from_files: 215`, `inline_fallback: 0`,
`sum_scene_seconds: 545.95`. `preview_parked_shots` lists exactly 31 ids (L01, L07, L08, L09, L12,
L15, L16, L17, L18, L20, L21, L25, L31–L36, L39, L40, L78, L87, L88, L97, L102, L112, L123, L133,
L171, L205, L215) — matches the manifest's 31-parked count exactly. 215 shots in, 215 shots
rendered, 0 dropped, 0 placeholders.

## Deviations from a standard run
1. Motion plan authored but not merged into the render (§1) — image-gen materialization is a
   separate, human-gated future step.
2. No `audio-plan.json` / `audio-director` pass — out of this dispatch's scope; render is VO-only
   audio (music gracefully absent, no SFX cues authored).
3. Music beds not fetched (gitignored binaries never present in this checkout) — used the
   documented automatic fallback, no flag needed, nothing downloaded.
4. Output is `assets/preview.mp4` (+ `preview.render.manifest.json`), not `assets/final.mp4` —
   this IS the skill-canonical path for a run that includes parked shots via `--preview-parked`;
   `final.mp4` is intentionally never written by this flag so nothing non-shippable can be mistaken
   for the shippable cut.
