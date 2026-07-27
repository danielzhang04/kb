# Pickup — Poyais R6 RENDERED (2026-07-17) — PAUSED AT DANIEL'S WATCH-THROUGH №2

**State: the R6 fix round is COMPLETE and re-rendered. `assets/final.mp4` (489.2s, −14.50 LUFS /
−1.00 dBTP exact, audio_checker green, 117 shots) was opened in Daniel's device player. Nothing is
generating or rendering. Resume = take Daniel's R6 watch-through verdicts (4 open rulings below +
general notes), apply via owning skills, re-render.** Supersedes
`2026-07-17-poyais-full-render-pickup.md` (its watch-through happened; all 34 notes landed).

## What R6 was

Daniel's first full watch-through produced 34 notes → `videos/2026-07-04-poyais/`
`_watch-through-notes-2026-07-17.md` (stable IDs N01–N34). All executed via
`_r6-fix-plan-2026-07-17.md` (10 workstreams W1–W10, status column current — READ IT, it is the
detailed record). Orchestration: Fable-5 terminal + Opus 4.8 grunt agents (model verified by live
probe first, then per-agent first-log-line checks — all confirmed `claude-opus-4-8`). Four
read-only mapping agents (shots / audio+pause diagnosis / engine feasibility / music-grammar
audit) → plan → 8 execution agents → orchestrator-only merge → render agent.

**Highlights:**
- **Word-pop conversions (the big structural change):** paradise chain L06/L07/L08/L10, L88
  strike, L94 strike — baked delta-chains re-authored to word-anchored cutout layers over held
  plates (12 gens, all battery-clean first pass). Bank+money and cathedral+prince split into
  separate cutouts; prince re-matted clean + larger (N04/N05).
- **Engine:** slam de-bounced (LayerView: damping 9→200, scale monotone) — stamps land dead.
- **Motion edits:** L03 ship stops on open water; L25 bubble at MacGregor's head; L75 country
  labels on true map positions; L120 red arrow deleted, MacGregor (0.18 ship-scale) paths
  Europe→Venezuela on the same L15 plate ("first map" per Daniel); L42 stars hf 0.16; L112 Italy
  route reuses the Paris carriage; L91 deed-holding-king slide lands matched to L92.
- **L60 DELETED** (N20, Daniel-confirmed; VO rides held L59 end-state). 118→117 shots.
- **Regens:** L36 warm-lit library plate (book was already centered — old plate was the
  illusion); L42 = deterministic composite of new L36+book; SOLD borderless; FAKE stamps
  re-keyed (interior white 0.0000%); L103 overlap fixed (~176 figures — see rulings).
- **Audio rebuilt on the measured grammar (Option A, Daniel-locked):** new `underscore` bucket
  (Crypto default, curated to ONE track for consistency) replaces meme-MacLeod as con-spine;
  `upbeat-2` Fig Leaf Times Two = mania lift (index 0; Monkeys retained for deliberate use);
  `somber-1` piano button tail; dry cold open until "It all started with a soldier named" (N07).
  47 cues resolver-proof (zero warnings), pauses ≥0.8s ×7 (breath_count 3→7), SFX 1.4→4.4/min.
  New SFX roles sourced: crack (CC0), halo (CC-BY, credit), collapse (CC-BY, credit), vanish
  (CC0). `boom` added to consistent_sfx (all 4 stamps identical).
- **Two pipeline bugs found+fixed:** (1) same-anchor pause+SFX cue pairs were SILENTLY dropped by
  the cursor matcher (`audio_cues.py::resolve_cues` — cost 2 of 13 SFX in the first render); now
  same-anchor groups fan the beat to all siblings + unresolved cues WARN + `cues_unresolved` in
  meta; 45 tests green. (2) The no-pauses mystery = a 3-way compound: 0.4–0.5s authored pauses
  (below the 0.6 min), the bed playing over the TTS's own [short pause] silences (dip fires only
  in authored gaps), + the dropped SFX.

**Commits (feat/pipeline-simplification):** 06e4c5b engine+resolver · fceb281 music/SFX library ·
3eb4e6d Poyais R6 artifacts · a50c6b6 docs. Render verified: preflight dry-run exit 0, engine
382s (~1.28× realtime, 10 chunks), duration 489.20s (= old 484.9 + pauses − L60, as computed),
4 frame probes real, AAC 96 kHz residual unchanged (known, YouTube-safe).

## Daniel's 4 OPEN rulings for watch-through №2

1. **L103 infographic:** renders ~176 figures vs the ~250 in VO (overlap fixed; <50-solid ratio
   reads right). Accept or regen denser?
2. **L94 "no shelter/supplies/help" pops are SILENT** — audio-director withheld SFX inside the
   human-cost act (withhold-on-human-cost law beat the densify directive; visuals still pop).
   Keep or add pops?
3. **MacGregor Venezuela travel scale 0.18** (ship-scale, per "smaller"; the L15/16/17 campaign
   giant is 0.42). Too small?
4. **Fig Leaf Times Two** mania lift — the one pick with mild meme-residual recognizability.
   Boarded alternates ready: Exhilarate / Ascending the Vale (also underscore + somber alternates
   — see `scratchpad\exec-music-retrack.md` table and
   `channels/the-second-take/visual-kit/audio/_audition/`).
Plus the general ear/eye-gate: underscore bed feel, pause lengths, slam feel, word-pop timing,
whoosh count (~4–8 major cuts).

## Learning candidates awaiting Daniel's §G gate (route per G-route on confirm)

The 8 pre-R6 candidates (see superseded full-render pickup §Learning candidates — still valid).
**New from R6:**
9. **Pause audibility law:** an authored pause must be ≥0.8s to read; the music dip fires ONLY in
   authored gaps — TTS-baked [short pause] silences get bed played over them, so beats needing
   silence must be AUTHORED as pause cues (audio-director doc).
10. **Same-anchor beats:** pause+SFX on one beat now supported in logic; authoring convention =
   pair them on the identical verbatim anchor (in_pause:true to land inside the silence).
11. **Persisted-layer idiom:** a layer carried across shots uses `at_s:-2.0` + style fade
   (spring pre-settled); `at_s:0` RE-POPS at every cut (engine fact; motion-planner doc).
12. **Meme-track register law** (already routed into music-forge SKILL.md two-register doc):
   recognizable comedy cues undercut an exposé register at ANY coverage; retrack beats re-cover.
13. **Single-track con-spine:** a mood pool re-pick mid-video reads inconsistent → curate the
   bucket to one track per video (or add a per-cue pin mechanism to the music lane).
14. **Word-pop conversion pattern:** enumerations narrated as N items want N word-anchored
   cutout layers over a held plate, never a baked delta-chain (VPW/motion-planner default?
   — needs Daniel's confirm; it cost a full re-author round to retrofit).
15. **Shared-config single-writer:** two parallel agents both writing `audio-tokens.json`
   collided (music pools briefly reverted; caught by post-hoc grep). Extend the sole-writer rule
   from artifacts to CHANNEL CONFIG files — one owner per file per round.

## Key paths & housekeeping

- **Session scratchpad** (mapping reports map-visual/map-audio/engine-feasibility/music-audit.md,
  exec reports exec-*.md, merge_r6.py, manifest_r6.py, render frame probes):
  `C:\Users\danie\AppData\Local\Temp\claude\C--Users-danie-faceless-youtube\ad79397e-0f8e-40f2-9b89-89f5a2d15d59\scratchpad\`
- **Backups (sweep at video lock, F-clean):** shots.pre-r6-2026-07-17.json,
  shots.motion.pre-r6-2026-07-17.json, audio-plan.pre-r6-2026-07-17.json (+ the pre-r3/r4/r5
  set), `assets/_superseded-2026-07-17-r6/` (old L33/L68/L91 cutouts, L36/L42 plates, L103
  scene), `assets/_superseded-2026-07-16/`, `assets/final.pre-r6-2026-07-17.mp4` (A/B copy),
  `assets/r6-staging/` (now only _dbg-*.png composites + the 3 applied patch JSONs — keep for
  board evidence until lock).
- **Manifest:** `assets/scenes/manifest.json` — `rework_r6` block (scope 13 shots, released:
  PENDING watch-through №2); L60 entry marked deleted; per-entry R6 audit notes.
- **Music/SFX audition boards:** `visual-kit/audio/_audition/` (music/audition.html playable
  board + r6-sourcing + r6-halo SFX boards). CC-BY credits REQUIRED in video description for:
  halo-1, collapse-1, all Incompetech beds (attribution.txt is current).
- **Follow-ups (open):** forge.py `pick` crashes on path-style ids in a shared _audition dir;
  SFX normalizer left collapse/vanish ~3 dB below siblings (per-role gain compensates); AAC
  96 kHz normalize-to-48k someday; dashboard 07-05→07-15 timeline backfill; chunk-1 bugs
  (`--mode identity` bald head, head-turn NOSE); GateGuard hook fires on every first Write/Edit
  per file (present facts inline + retry same op — it passes on the second attempt).
- **Standing rules unchanged:** Opus 4.8 grunts, model verified (probe + first log line) ·
  orchestrator-only merges (manifest + shots + motion + channel config) · supersede-first ·
  battery law on any regen · UTF-8 by codepoint · forge via `py -3` · foreground-sequential
  forge runs · agents write reports incrementally to scratchpad.

## After watch-through №2

Verdicts → targeted fixes via owning skills (pool swaps are one-line audio-tokens edits +
re-realize; visual rulings → the usual VPW/image-gen/motion path) → localized re-render → then
the tail: metadata (CHECK whether metadata-writer ever ran for Poyais), thumbnail (VPW prompt →
image-gen), compliance + QA gate (incl. the CC-BY credit block in the description), publish-queue
(Stage-0 human publish gate). Then the §G codification session over candidates 1–15.
