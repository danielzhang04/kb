# Project status — rolling

> The live state of the project. A fresh terminal reads this to know where things are.
> This is a **doc**, not a log (operating-law §F): **integrate each change in place** and delete what
> it supersedes — never stack dated entries here, or it becomes the changelog it was extracted from.
> Decisions + rationale → `knowledge/decisions.md` (append-only). Resume state for in-flight work →
> the newest dated pickup in `docs/handoffs/`.

Status markers below are load-bearing: **LOCKED / BUILT / PROVEN** = done and trusted;
**PROVISIONAL** = works but unvalidated; **DEFERRED** = deliberately not built yet; **KNOWN BUG** = a
defect that will recur until fixed.

## Phase & autonomy

- **Phase:** Infrastructure + doctrine established 2026-07-01; full production pipeline BUILT and
  proven end-to-end on a partial real video (see *Production state*). Now in first real production.
- **Doctrine (LOCKED):** entertainment-not-education; 10-lever taxonomy; per-niche length + shorts
  cadence bands; compliant AI-gen playbook. Primary axis is **payload-before-emotion** (info first;
  §1-P). Default register is **plain-concrete** with a banned trailer-voice list (§1d-R). Shorts are
  **self-contained** (closed loop, not teaser; §11-0). **Visual register is locked per niche**
  (stylized-signature vs real footage; the uncanny middle is banned; §13). idea-generator rubric:
  Payload /20 (top weight), emotion /10.
- **Autonomy: Stage 0** — full human gate; a human approves every publish. (Ramp + gate criteria in
  CLAUDE.md → *Autonomy*.)

## Channel & infrastructure

- **Channel (committed 2026-07-02):** `channels/the-second-take/` — finance/economics explainer, niche
  `business-money`, "lever vindication" angle, stylized-2.5D look. First video = the Poyais draft under
  `videos/`.
- **Voice — LOCKED 2026-07-06 → "Miles":** ElevenLabs library **"Miles"** (`vSjOBQp24DUB2COr2xI9`) on
  `eleven_v3` @ **stability 0.25** (Creative-leaning for pitch-life; replaced Jake). Validated by a
  consistency proof (F0 148.1/148.1/144.1 Hz across 2 rolls + a 2nd passage; ~175 wpm; ~18% pause).
  Injected-pause tiers were shortened engine-wide (`voiceover.py`) since human voices already breathe.
  Settings + round history: `dna.md` + `voice-lab/voice-lab.md`.
- **Render/TTS infra connected:** ElevenLabs TTS (**creator tier**, ~125k chars/cycle; `voiceover`
  drives it end-to-end, `/with-timestamps` → per-word timings) + the **local Remotion render engine**
  (Node 24 + Remotion 4.x pinned, free license ≤3 people). Remotion is render-builder's **only** engine.
  JSON2Video (the original cloud path) was **removed 2026-07-10**; `render.py` survives only as shared
  timing/scene helpers that `build_motion.py` imports.
- **Pipeline architecture:** research-driven front+middle — one human gate at the idea pick, then
  `researcher` (wraps native `deep-research`) → a format-split scriptwriter. Routed per-niche by the
  `dna.md` `Pipeline` block (`research`/`topic_scouting`/`long_form`). Spec:
  `docs/superpowers/specs/2026-07-03-research-driven-pipeline-design.md`.
- **Skills built (14, all niche-agnostic):** `idea-generator` · `researcher` · `long-form-writer` ·
  `shorts-writer` · `metadata-writer` · `visual-prompt-writer` · `voiceover` · `render-builder` ·
  `image-generation` (renamed from `asset-forge`) · `motion-planner` · `sfx-forge` · `music-forge` ·
  `audio-analyzer` · `audio-director`. (The old `scriptwriter` was retired and split into
  `long-form-writer` + `shorts-writer`; the retired `audio-cue-writer` + `music-cue-writer` merged into
  `audio-director`.) Doc-structure discipline is enforced by operating rule 6 (integrate-don't-append)
  + the invokable `curate-doc` skill (project-wide, since 2026-07-07).

## Front half — research & script craft

- **Storytelling craft (LOCKED):** one merged doc `channels/the-second-take/storytelling-grammar.md`
  (§0 gold exemplar + before→after bank + §1 architecture · §2 register incl. §2.5 color-vs-dwell · §3
  constraint re-routing · §4 staging · §5 our-edges). Register is a **DIAL set by topic gravity** — hot
  on money-absurdity, wry+sparse on villainy, **OFF on human cost**. The channel is storytelling-first,
  more comedic than any pure finance/history channel, **not** a comedy channel. Cross-cutting toolkit
  (board-state / park-and-cut / ensemble / mirror / irony) + a transition seam-kit answers linearity.
  **Two hard locks: NO second person; ONE narrator.** No quotes — all narrator reported speech.
  Reconciled across `long-form-writer`, `universal.md` §5c/§5d/§1d-V, `watchability-rubric.md` (/36),
  `dna.md`, `researcher`, `shorts-writer`, `reference-channels.md`, and the visual grammar.
- **Scriptwriter — REBUILT + PROVEN (2026-07-08, extended 07-09):** the flat/buttoned-script problem was
  root-caused (a model self-checking prohibitions shares its own blind spot) and fixed architecturally.
  The Poyais `script.md` is the hand-locked **GOLD exemplar** (voice + accuracy benchmark).
  `long-form-writer` generates **casual-first, leash-second** (spine → casual draft → leash-check), then
  a **critic layer** (Step 3d, `references/critics.md`): taste ∥ leash critics + a **coherence critic**
  (first-time-viewer pass, capped one-bounce structural rewrite; bar = grammar §3.8 "non-linear but
  followable") → in-voice editor + `scripts/lint_script.py`. On research channels the writer is LEASHED
  to the fact-ledger; the `researcher` now captures relational/connective facts (not just atoms). Length
  norm centered on **~10 min**. Proven on a blind regen (critics caught all leaked buttons + a subtle
  leash error). **Still open:** validate the writer on a *fresh* topic (generalization beyond Poyais).
- **proxy-judge ("taste me") — BUILT + PAUSED (2026-07-09):** additive, advisory-only acceptance gate
  after `humanize` proxying Daniel's accept/revise/reject + `/36`. On branch
  `feat/proxy-judge-story-editor-me` (NOT merged; changes nothing until invoked). Verdict agreement 3/3;
  substance-match a converging long tail. Two open threads: real-pipeline validation; a finding that
  near-perfect drafts came from almost no pipeline → maybe cut the staged writers-room. Resume:
  `docs/handoffs/2026-07-09-proxy-judge-and-pipeline-simplification-findings.md`.

## Visual system — still authoring & image generation

- **Visual identity — LOCKED (2026-07-04):** The Second Take template = round cream `#f5ead6` head,
  dark brown-black `#241a12` outline, calm no-nose face; canonical frame set in `visual-kit/refs/base/`.
  MacGregor canonical = red/gold, ear-free, costume PINNED (`refs/macgregor/`). Diegetic art = flat-cel.
- **Generation system:** per-channel **`visual-kit/style-bible.md`** is THE single image-gen doc (rig
  lock + descriptors + verify gate + committed recipe + asset-library build spec) + `registry.json` (the
  LIVE asset vocabulary) + the **`image-generation`** skill running a **two-pass flow**: pass 1 derives a
  per-video asset library from `shots.json` (recurring entities materialized ONCE, reuse-before-
  regenerate); pass 2 assembles every scene generation-based from it (multi-seed composition; technique
  menu). All generation runs on a **single engine — `gemini-3-pro-image`** (the flash tier was removed
  2026-07-09; it drifted off-recipe). Specs: `2026-07-04-visual-style-lock-system-design.md` +
  `2026-07-08-image-generation-rebuild-design.md`.
- **Visual grammar (binding law):** `universal.md §13/§13a` — §13a-i (a shot is a COMPOSED SLATE: idle
  motion + one VO-synced transform + progressive-reveal enumerations) + §13a-ii (cut cadence + the HARD
  RULE that kills the stretch-to-fill dead-hold bug). Core rule: **non-literal is default; literal only
  for physical action/objects.** `visual-prompt-writer` OWNS the shot list and must author a choreographed
  slate; `long-form-writer`'s `[B-ROLL]` cues are meaning-anchors only. The channel
  `visual-kit/visual-grammar.md` is **staging law only** (staging conventions + composition menu + lever
  translation); recipe + library build spec live in `style-bible.md`.
- **Still-side authoring — REBUILT (2026-07-08):** `visual-prompt-writer` rebuilt on a Remotion-reality
  model — **author intent, never mechanism**; six laws (held tableau · scene facts · acting · casting
  pull-through · delta decisiveness · hook bar). `motion_prompt`/`asset_type`/`ken_burns`/
  `within_shot_motion` were DELETED (the intent-taxonomy briefly became a beat-type enum, since
  **retired** 2026-07-12). **Composition-variety pass (2026-07-09):** the shot-class now DRIVES
  composition (VPW step 2); framing/scale/expression are stated facts; `visual-grammar §2` is
  payload-driven guidance (vary scale/angle/literalness); image-gen EXECUTES the `still_prompt`'s framing
  (VPW owns composition, authored once). Channel staging law (tableau menu, expression-by-beat, eye-line,
  role legibility) is in `visual-grammar.md`. Specs:
  `2026-07-08-still-side-visual-authoring-rebuild-design.md` + `2026-07-09-shot-composition-variety-design.md`.
- **Still-side QA — two fresh-eyes layers:** (1) a **pre-gen shot critic** (VPW Step 8 +
  `references/critics.md`, runs before any gen token is spent — its first cycle caught 10 real defects
  pre-pixels); (2) the **post-gen batched review** (slimmed 2026-07-09): ONE review — 3 concurrent agents
  (identity/rig · fidelity · style/taste), **ONE re-authored retry then flag** (2026-07-14; replaced
  retry-≤2), flagged frames pushed to the human artifact, **no hand
  crops** — replacing the old rig-grind + scene-gate + diff-gate + crop stack. Values-only checklist in
  `style-bible §3`; procedure in the skill. Artifact builder =
  `image-generation/scripts/build_review_artifact.py` (inlined `data:` URIs, checkerboard under real
  transparency, ←/→ lightbox). **KNOWN follow-up:** the identity review still lets a nose slip — harden it.
- **Shot↔script anchor contract — HARDENED + `lint_shots.py` (2026-07-08):** `render-builder` times
  every cut by matching a shot's `vo_ref` (first 4 normalized words) to the real VO word-stream. `vo_ref`
  must be a **verbatim** copy of the VO line's opening words (≥4) and shots in **strict narration order**,
  enforced by `.claude/skills/visual-prompt-writer/scripts/lint_shots.py` (mirrors render-builder's
  matcher; HARD-fails on either). `--write` derives two review-only fields: `vo_text` (each shot's
  verbatim VO span — derived, never authored, never a depiction brief) + a top-level `shot_counts`.
- **Scene chaining — held evolving stages, PROVEN (2026-07-08):** hard cuts only (no fades, killed at the
  render root); **hands LOCKED to 4 digits (3+thumb)** + a rig-gate check (no regen — the engine is
  seed-sticky). A drift test proved **seeding each still off the prior still holds the set (~10× less
  drift than independent per-shot gen)**, so continuity comes from a **STAGE** = a `base` frame + **≤3
  `delta`** frames, then re-base/hard-cut. Intent/mechanism split: VPW/`shots.json` author intent-only
  fields (`stage`/`stage_role`/`changed_elements`); `image-generation` owns the seeded delta-chain +
  a `forge.py diff` held-set gate. Continuity hierarchy (executor-agnostic, in `universal.md §13a`):
  **layer-move (LIVE) > delta-chain > hard-cut.** Spec: `2026-07-08-scene-chaining-design.md`.
  **KNOWN BUG:** a re-base inside the *same* location must seed the prior stage's **BASE** frame — the
  ≤3-delta cap currently throws the set away (produced two different swamps). **`motion-planner` still
  has this.**
- **Character asset base — DONE (2026-07-10):** grew from solo/front-facing to **52 assets** (19 new
  primitives): 6 poses (sit/facepalm/surrender/whisper-aside/kneel-beg/point-at-thing), 4 angle+movement
  (back-to-viewer/3q-turn-right/walk-left/walk-right), 6 object-agnostic grips (hold-one/both,
  hold-paper, carry-by-handle, sign-with-pen, reach-to-take), 3 two-slot interaction templates
  (handshake/handoff/fistbump — blank base mannequins; a scene inserts two identities by `cast` order).
  **Hard rule:** every pose/angle/grip/interaction carries the base NEUTRAL face (expression is a
  separate scene-time seed layer). Two-slot merge validated E2E; fixed a bug where the expression merge
  stripped haired characters bald (the binding template now keeps head+hair from the character, only
  mouth/eyes from the expression). Learnings: a strong static 3/4 resists the front seed (walking is the
  real turn; true profile DEFERRED); seed exactly off `base`; regen fresh, never prompt-accretion. Docs
  single-sourced across image-gen / VPW / `style-bible §5,§7`.
- **Render wiring — scenes mode (DONE 2026-07-08):** `render-builder` scenes mode is the pipeline default
  (auto-detected via the scenes manifest, whose key is **`shots`**). Each verified
  `assets/scenes/<shot-id>.png` is hosted and used as its shot's visual; a **missing ai-gen scene is a
  HARD error** (no silent off-style inline fallback); chart/screencap/stock shots fall back inline and are
  counted; `inline`(A)/`clips`(B) modes survive for non-style-locked channels. Spec:
  `2026-07-08-render-builder-scenes-wiring-design.md`.

## Motion & render engine

- **Remotion motion engine — BUILT + PROVEN (the render default):** a fixed component library
  (`render-builder/engine/`) renders a per-piece **`motion.json`** derived by `build_motion.py` (contract:
  `references/motion-schema.md`). Spring camera with **one arc per STAGE** (held-set grammar), idle
  baseline (dead frames unrepresentable), **word-anchored overlays + word-highlight captions from our own
  ElevenLabs timings** (no transcription), the **T2 device kit as CODE** (stat / counter /
  progressive-reveal / chapter / meter / definition cards — real type, zero garbled gen-text), chart/stock
  shots as visible placeholder cards, channel look via `visual-kit/motion-tokens.json`. ~1.5× faster than
  realtime locally, zero API cost, no watermark. E2E-proven on a fixture (16:9 + 9:16).
- **Layered-motion system — BUILT + PROVEN (2026-07-12):** a shot = a `plate` + animated element
  **layers** — a cutout (slide/path/bob/appear) or engine-drawn — rendered by the engine **`LayerView`**,
  planned by **`motion-planner`** (reads `shots.json` → emits `shots.motion.json`; iterable ruleset +
  subtraction decomposition + fresh-eyes critic + `lint_motion_plan.py` + human gate; timid-by-default),
  materialized by `image-generation`'s **`forge cutout`** (rembg → alpha-harden → trim; MacGregor's
  4-digit hand survives the matte). The layered flow **NEVER cuts a figure from a busy scene** — it
  generates the plate empty + the cutout on a clean plate, then composites. The **animation menu**
  (`animation-menu.json`) is the single-source contract binding planner↔image-gen↔engine. Camera is
  **fully locked** (decoupled from the retired beat-type seam). Proven E2E on Poyais L13 (MacGregor
  slides onto a stage plate) + L03 (ship paths across a map drawing its route). Spec + 5 phase plans:
  `2026-07-12-layered-motion-system-design.md`.
- **T2 device kit — WIRED (2026-07-12):** the engine device cards (stat/counter/meter/chapter/
  definition/reveal), long built but dark, are now authored by `motion-planner` as `source:"engine"`
  device-layers and ROUTED by `build_motion.apply_motion_plan` into `motion.json` `overlays[]` (a
  subtraction rule avoids duplicating baked-in still text; `reveal` items stagger, v1). Each card carries
  a VO **`anchor`** resolved to `at_s` via the shared `render.anchor_time` / `match_shots_to_tokens`
  matcher (this replaced the earlier fire-at-shot-start timing, which popped cards ~2.5s early). The
  never-built hand-augment-overlays path was killed. Spec: `2026-07-12-t2-device-card-producer-design.md`.
  **DEFERRED:** true `at_scene` diegetic positioning (rule disabled so image-gen stops leaving holes);
  **KNOWN BUG (→ Tier-2):** engine-only device-card shots double-draw with a real still (they keep the
  baked `scenes/<id>.png`).
- **Motion + audio grammar — MEASURED (2026-07-08):** frame-burst teardown of Crayon ×3 + HeyHistorically
  + OverSimplified + Kurzgesagt (~90 verified events, ~1,000 measured cuts; logs in
  `visual-kit/research/motion-logs/`) → the measured law in **`universal.md §13a-iii`** (camera =
  furniture / element layer = the life / cut = the verb, + the treatment grammar). Channel dials in
  `visual-grammar.md §4` + `motion-tokens.json` (story mode; **long-form burned captions OFF**; **idle bob
  OFF** — fully-locked look).

## Audio system — feature-complete (2026-07-12)

- **Flow:** authored → realized → verified. **`audio-director`** authors ONE unified
  **`audio-plan.json`** (SFX · pause · music · dry) by judgment (timid-by-default → fresh-eyes critic →
  `lint_audio_plan.py` → human ear-gate). `build_audio.py`/`breath.py` realize it deterministically. The
  **`audio_checker`** verifies the render (missing-files · LUFS/TP-vs-`master_target` · music-lane sanity;
  warn-not-fail, no model listening). It authors PLACEMENT; the human ear-gates FEEL.
- **What it produces:** VO · a **placed music lane** (`build_music_lane` → engine `MusicLane`: per-section
  mood segments at a CONSTANT present level — no per-phrase duck; drops only on inherited full-stops,
  authored `dry` spans, and fade→silence→fade track switches; same-mood neighbours coalesce) · structural
  + authored **SFX** (item-appearance sounds snap to the cut via `sync:"element"`; whoosh/pop use ONE
  fixed variant — `consistent_sfx`) · **breath/full-stop** (a `pause` cue splices a derived
  `vo.breath.mp3`; the −40 dB dip lands in the gap; distinct from the writer's `[PAUSE]` prosody) ·
  **register** (human-cost = an authored `dry` pull-back) · **mastering** (`loudnorm_pass` reads
  `master_target`, ear-gated to **−14.5 LUFS / −1.0 dBTP / LRA 4**).
- **Measured-grammar anchors:** bed PLACED ~79% (not wall-to-wall); the default register is **wry/dry, NOT
  cheerful** (the `sneaky` family is the con-story workhorse; `upbeat` = an opt-in lift). Structural
  sounds fire by **selective director judgment** (guided by `references/grammar-guidance.md` ← measured
  `universal.md §13a-iii.8`), not mechanical auto-fire.
- **Files + measurement:** SFX/music sourced by **`sfx-forge`** (16-role CC0/CC-BY library) +
  **`music-forge`** (Incompetech CC-BY beds); the measured grammar came from **`audio-analyzer`** (8
  references, audio-only, tools-measured — the model-listening-hallucination fix). Ear-gated + approved by
  Daniel on `_chain-test`, and dogfooded on real VO in the Tier-1 test (12 cues, master −14.35 LUFS).
- **PROVISIONAL follow-ups:** partial-thin the human-cost music drop (the full drop reads slightly weird);
  `casual-bed` settle under a full front-half narration is still provisional; device-card SFX
  (stat/counter/meter → pop/riser/pluck) light up automatically once those overlays ship.
- Specs: `2026-07-12-audio-director-rework-design.md` +
  `2026-07-12-phase3b-music-lane-realizer-and-phase4-checker-design.md`. Resume:
  `docs/handoffs/2026-07-12-layered-motion-and-audio-director-pickup.md` +
  `docs/handoffs/2026-07-10-sfx-library-and-audio-analysis-pickup.md`.

## Production state

- **Front-half batch — IN PROGRESS (started 2026-07-09):** first real front-half run (idea → research →
  long-form → metadata; **shorts skipped this batch**), one video at a time with a checkpoint per step.
  **Video 1 = ST-004 "The Backstreet Boys Were Built to Hide a Fraud" (Lou Pearlman), slug
  `2026-07-09-pearlman` — DONE through metadata, at the USER REVIEW GATE. Next up: ST-006 (bricks).**
  Resume: `docs/handoffs/2026-07-09-fronthalf-production-batch-pickup.md`.
- **Pipeline integration test — Tier-1 ✅ PASSED (2026-07-13).** A fresh `VPW → lint_shots →
  motion-planner → lint_motion_plan → voiceover (real ElevenLabs) → audio-director → build_motion
  --allow-missing --motion-plan → chunked Remotion render` ran end-to-end on a **~4:25 first-act Poyais
  slice** (scratch slug `videos/_poyais-test-slice/`, placeholder scenes + real VO) → a watchable MP4;
  device cards + audio human-gated by Daniel. Seven seams found, **6 fixed:** (1) voiceover read the
  `## Sources` bibliography aloud → fallback now stops at the next `## `; (2) `--motion-plan` crashed on a
  missing `import os` → `Path().exists()`; (3) a missing cutout PNG 404-crashed the render → now dropped
  under `--allow-missing`; (4) **flat full-length render OOMs the Chromium tab** → `render-video.mjs` now
  renders frame-range **CHUNKS** (`RENDER_CHUNK_FRAMES`=1500) + ffmpeg concat (settles the "chunk or not?"
  question — flat can't do full length); (5) device cards popped ~2.5s early → the VO-`anchor` fix above
  (counter default climb 1.5→1.0s). **Left open:** (6) `--max-shots` doesn't shorten the composition
  (noted); (7) engine-only device-card shots double-draw with real stills → **deferred to Tier-2.**
  **Tier-2 (later):** `pip install pillow rembg onnxruntime` → real image-gen (scenes + cutout
  materialization) → the cutout LOOK, guidebook pops landing on visible elements, finding #7, a full real
  render. Pickup: `docs/handoffs/2026-07-13-tier1-integration-test-pickup.md`.
- **Poyais Pass 2 — chunk 1 RENDERED, PAUSED (2026-07-15).** First real Pass-2 chunk (L01–L26, 21 shots,
  ~40 gens ≈ $5.4) run **parallelized** — the `image-generation` Pass 2 cut into agent units (unit = one
  dependency family, or a ~4-gen bundle of independents; one agent per unit so chains stay serial inside
  it) → one batched 3-agent review → human gate → a watchable **77s MP4 with real VO**
  (`videos/_poyais-chunk1/assets/final.mp4`; VO only, no SFX/music). **Chunks 2–6 (97 shots ≈ 109 gens ≈
  $15) untouched.** Run-book (chunk table, unit method, invariants):
  `channels/the-second-take/videos/2026-07-04-poyais/_image-gen-plan-2026-07-14.md`; pickup:
  `docs/handoffs/2026-07-15-poyais-chunk1-pass2-pickup.md`. The review earned its cost: all 8 generating
  agents called their own work clean; fresh eyes returned **24 flags, 4 blocking** (a generator
  self-checking shares its blind spot).
  - **FOUR skill bugs — DEFERRED by the user; all will recur across the remaining 97 shots:**
    1. **`mode=environment` cites a seed that doesn't exist** — forge passes no seed for
       `environment`/`style` while the §2b descriptor says *"the SAME art style as the reference image"* →
       stock-clipart fallback. **Cause of every blocking flag**, contradicts style-bible §5; `refs/env/`
       is already exempted in `_is_char_seed` but never populated. **~82 gens exposed — fix before chunk 2.**
    2. **`--mode identity` hard-codes a bald head** → unusable for haired cast.
    3. **Pass-1b leaks iris COLOUR from the expression ref** (`macgregor--sit--expr-thinking` still stale
       → L63).
    4. **head-turn language grows a NOSE.**
  - **Law proven:** *layer only what has a canonical; delta-chain what must be invented* (every seeded
    figure cutout passed; every unseeded invented-environment cutout flagged). Plus the scene-chaining
    re-base bug above (a re-base inside a location must seed the prior stage's BASE frame).
  - **Craft:** measure mattes/colours, never eyeball; a pale isolation field starves rembg on a pale
    subject; `--aspect 16:9` is scenes/plates ONLY (a 16:9 cutout invites variant sheets); the
    scenes-manifest key is **`shots`**, not `scenes`.

## Open decisions & queue

- **Open decisions:** validation path; format mix; final channel name/handle. (Voice ID is locked — see
  *Channel & infrastructure*.) Rationale in `knowledge/decisions.md`.
- **Queued work:**
  - Fix the four Poyais Pass-2 skill bugs (esp. `mode=environment`), then run chunks 2–6.
  - **Mint the VISUAL GOLD EXEMPLAR** — the deferred enforcement behind the composition-variety logic:
    re-author a Poyais slice through the class-drives-composition VPW → regen all-pro → user approves the
    varied set → lock it. Pickup: `docs/handoffs/2026-07-09-composition-variety-gold-exemplar-pickup.md`.
  - Harden the image-gen identity review (a nose slipped).
  - Font-audition pick → `motion-tokens.json`; A/B the motion grammar on the 56s slice → a motion gold
    exemplar.
  - Validate the writer end-to-end on a *fresh* topic (generalization beyond Poyais).
  - Then the tail: compliance / publish / analytics + a `content-manager` orchestrator.
