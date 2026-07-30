# fyt bricks slice pipeline overhaul handoff — 2026-07-29

**Topic:** VPW + image-gen prompting overhaul proven end-to-end on a 2-min bricks slice (authored →
generated → voiced → rendered), parked at Daniel's preview/board gate; iteration wave is next.

**Branch:** all work on `claude/boss-20260729`, PUSHED through `1b02155`. Five commits this arc:
`2ede5f2` (doctrine+lint+forge overhaul), `dd0ffad` (image-gen act batches), `72cf42a` (10 registered
canonicals), `1b02155` (--preview-parked + iteration list). Coordination/handoff on ops (this commit).
NOTHING is merged to main; no PR opened.

### What WORKED (with evidence)
- **`figures` declarations replacing §2d/§2e clause-pasting** — regen prompts 22.5% shorter (729 vs 940
  chars mean), zero rig text (lint fingerprint guard 0 hits), plural/binding/delta wording correct in
  forge dry outputs; committed with 4 green test suites + a cold authoring probe that produced a valid
  fragment from doctrine alone (`scratchpad/probe/`, lint 0 HARD).
- **Staged act-by-act VPW protocol** — regen run: 42 shots, 0 HARD, 97.6% non-literal, critic
  "ship-with-edits" fully dispositioned; the between-act re-read killed a lettered tally board the bar
  explicitly rejects (seg-log "F-14").
- **Image-gen slice run** — 42/42 scenes at 2K, honest 22 verified / 20 parked, $12.19 / 91 gens, 0 API
  failures; 12/12 authored strings letter-perfect; trademark risk (L03/L04 arcade sprite) caught and
  fixed via positively-divergent re-authoring; evidence in `_bricks-seg/assets/_review/` (521 DSG items,
  157 crops).
- **10 canonicals registered durably** (`refs/` + registry.json, commit 72cf42a): miniscribe-rep,
  ibm-suit, terry-johnson, pc-boxy, action-tugofwar, action-recoil, env-interior-warm/cool, and the
  registry's FIRST two `kind:"prop"` rows (prop-drive, prop-beige-pc).
- **VO + render** — vo.mp3 104.67s (168 wpm measured vs 175 assumed), final.mp4 + preview.mp4 1080p30
  106.5s, all 42/42 cuts at exactly 0.0ms from real word onsets (vo-render-log §6). TTS ~$0.30.
- **`--preview-parked` flag** — preview.mp4 shows all 42 real frames; manifest stamped
  `state: "preview-parked-included"` which compliance_check ALREADY hard-rejects (fails Gate-3 by
  construction); 191/191 tests, no-flag path proven identical.

### What Did NOT Work (and why)
- **§2e anonymous foreground figures are the pipeline's weakest surface** — no seed, prose-only rig
  enforcement; noses/proportions survived explicit prohibition (L17/L18 parked). Fix = seed base.png
  (iteration item 1).
- **forge §2c auto-append on personified objects** — forced "THREE fingers plus ONE thumb" onto handless
  pc-boxy → fists/human-ghost bleed; worker overrode per-retry; durable fix = registry `no_hands` flag
  (item 2, NOT yet built).
- **Single-gen shortcut on scene-heavy single-figure shots** — L29/L31/L40 fell back to the blank base
  template; L31/L40 had been CLEAN and the worker's "improvement" regression parked 4 frames (incl.
  cascaded deltas L32/L33). Two-gen identity pass is mandatory there (item 3).
- **forge skip-if-in-staging on retries** — a retry writing an existing filename NO-OPs and reports OK
  (silently fakes success); worker worked around by moving rejects to `_rejected-r1/` first (item 4).
- **Trademark-by-default** — "plain blue maze + small yellow dots" summoned the trademarked sprite;
  prohibition-based fix failed, positive divergence worked (item 5). Boss also flagged pc-boxy as
  Macintosh-trade-dress-adjacent — Daniel's call pending on the board.
- **My render diagnosis was wrong** — I blamed missing node_modules in `render/remotion` (an unused
  stub); the real engine lives in `.claude/skills/render-builder/engine` and the real failure was a
  missing SYSTEM ffmpeg at chunk-concat (fixed via Remotion's bundled ffmpeg.exe on PATH). Also
  build_motion.py hides the Node exception (surfaces stderr only).
- **API instability (morning)** — one 500 + two 529s killed the first seg worker mid-run; recovered via
  SendMessage resumes + findings-to-disk-immediately discipline.

### What Has NOT Been Tried Yet
- The 9-item iteration list at `orgs/faceless-youtube/docs/superpowers/plans/`
  `2026-07-29-vpw-image-prompting-integration.md` **§4b** (on the work branch) — approved direction,
  nothing applied yet. Includes the parked SPEED work (parallelize forge gens within a wave; batch the
  crop battery — the slice run's 3h wall clock was ~55min serial gen + ~1h crop evidence).
- VPW doctrine friction fixes F-1…F-14 (`_bricks-seg/seg-log.md`, regen section).
- music-forge for this channel (1 music segment dropped in render — no sourced beds at all).
- Full ffmpeg on PATH (closes 2 unverified audio QA checks; also un-breaks VO chunk probes).
- Phase 6 (full staged VPW on `2026-07-28-bricks-fresh`, thumbnails included, use MEASURED 168 wpm) and
  Phase 7 (full image gen, first live act-batched run) — blocked on Daniel's gate + iteration wave.

### Current State of Files
| File | Status | Notes |
| ---- | ------ | ----- |
| `orgs/faceless-youtube/.claude/skills/{visual-prompt-writer,image-generation,render-builder}/**` | DONE | overhauled + tested, commits 2ede5f2/dd0ffad/1b02155 (work branch) |
| `channels/the-second-take/visual-kit/{style-bible,visual-grammar}.md` + registry + refs/ | DONE | figures law + 10 canonicals + 2 prop rows (2ede5f2, 72cf42a) |
| `channels/the-second-take/videos/_bricks-seg/` | WIP, gitignored | shots.json (42, lint-clean), 42 scenes (22 verified/20 parked), board.html, vo.mp3, final.mp4 + preview.mp4, all logs |
| `docs/superpowers/plans/2026-07-29-vpw-image-prompting-integration.md` | DONE | the plan + §4b iteration list — the next wave's brief source |
| `knowledge/research/image-prompting/` (4 files) | DONE | research corpus + SYNTHESIS.md |
| `videos/2026-07-28-bricks-fresh/` | TODO | r4 script untouched; full VPW (Phase 6) pending |
| Task list (this session) | — | phases 1–4 complete; 5 in_progress at Daniel's gate; 6–7 pending |

### Exact Next Step
Get Daniel's verdict on `preview.mp4` + `board.html` (both under
`orgs/faceless-youtube/channels/the-second-take/videos/_bricks-seg/assets/`, gitignored — LOCAL DISK
ONLY, do not expect them from git). Merge his feedback into plan §4b, then run the iteration wave
(doctrine/forge/lint edits per §4b, workers ≤ Opus, model-verified at grading), then Phase 6 → Phase 7.
Spend rulings to date: slice was pre-approved; NEW spend needs Daniel (full-video gen ≈ 190+ shots).

### Load list
- `orgs/faceless-youtube/docs/superpowers/plans/2026-07-29-vpw-image-prompting-integration.md` (esp. §4b)
- `orgs/faceless-youtube/channels/the-second-take/videos/_bricks-seg/gen-log.md` (systemic findings, spend)
- `orgs/faceless-youtube/channels/the-second-take/videos/_bricks-seg/seg-log.md` (VPW friction F-1…F-14)
- `orgs/faceless-youtube/channels/the-second-take/videos/_bricks-seg/vo-render-log.md` (render + preview flag)
- `orgs/faceless-youtube/knowledge/research/image-prompting/SYNTHESIS.md`
- Skills to drive the next phases: `visual-prompt-writer`, `image-generation`, `render-builder` (read
  CURRENT versions on `claude/boss-20260729` — ops/main copies are pre-overhaul)
