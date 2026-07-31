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
- **Engagement overhaul — TECHNICALLY READY, HUMAN-GATED (2026-07-22):** the six-axis production-logic
  candidate is isolated on `codex/poyais-engagement-overhaul-final`, based on current main, and independently
  reviewed READY (411 broad local tests plus renderer-level camera coverage). Human review of the complete
  diff comes next, followed by the zero-spend Poyais calibration; paid voice/image work, full render,
  publication, and queue transitions remain separately gated.

## Gated multi-agent pipeline (dashboard-orchestrated) — BUILT, NOT YET RUN (2026-07-30)

`video-run` now compiles to a **13-stage executable DAG across 6 real agents**, replacing the prior
100%-display, 0%-executable definition: `fyt-runner` (conductor, manager-profile), `fyt-story`
(idea→research→script→shorts→metadata), `fyt-visuals` (shots→motion→images), `fyt-audio-render`
(narration→audio-plan→render), `fyt-publish` (publish-private), and `fyt-checker` (cross-cutting
fresh-context gate service — judge-gate, image-review, render-verify, compliance, **and** the two
staging→root merge nodes) — all five non-runner agents worker-profile. **6 human gates**, not 5:
G0 idea-pick, G1 script, G2 visual-plan (spend authorization), G3 image-board, `g3b-narration-cost`
(spend authorization, added because G2 alone left the ElevenLabs call authorized only by DAG
reachability), G4 publish-private (a net-new `publicationAuthorization` gate axis the approved
design never named — required for G4 to be approvable at all rather than a permanent refuse).
Gates are born at the stage boundary they block, never pre-registered at launch. Full stage/gate
table: `orgs/faceless-youtube/workflows/video-run.md`. Full as-built-vs-designed deviation catalog,
with reasoning and the two items still awaiting Daniel's ruling (fyt-checker executing the merge
nodes; the `publicationAuthorization` axis): `docs/specs/2026-07-30-fyt-gated-pipeline-design.md`
§As-built deviations.

- **Proven, on a live daemon with an isolated state root:** inert boot; the execution-locked launch
  refusal; launch compiling to a runnable workflow; roster spawn of six real pty sessions; G0's
  structural halt; the spend gate staying shut; retire; the canvas rendering with its Inbox
  deep-link.
- **NOT yet proven at time of writing:** the completion-marker round-trip through a real
  interactive Claude terminal, and expand-to-interact on a live session. A run is in flight to
  establish both — pending, no result claimed here yet.
- **Owed:** Daniel's PR review and merge (PR #102, unmerged); his ruling on the two flagged
  deviations above; the maiden run itself (fresh idea → full script → 2-minute slice → G0–G4/G3b
  live-fired in order → publish-private). Real image/voiceover spend (G2/`g3b`) and the private
  upload (G4) are human authorizations no agent can self-grant.
- **Test state:** `dashboard/` suite 207 files / 2336 passed / 0 failed with `tsc` clean; 158
  Python tests across the three touched skills (`visual-prompt-writer`, `image-generation`,
  `render-builder`).
- **KNOWN BUG:** `canonicalResultIntegrator.ts` still runs an unguarded `git push origin ops`
  behind `createResults`. The `appendAudit` guard (`2fdb2ca`, see `decisions.md` 2026-07-30) closed
  the same coordination-write-off-`ops` incident class on the audit-ledger path only — this second
  path is NOT guarded. Do not point `DASHBOARD_REPO_ROOT` at a live work-branch worktree until it
  is; the incident that motivated the first guard is fully reproducible on this one.

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
  on money-absurdity, wry+sparse on villainy, and **OFF on human cost**. Consequence beats stay concise
  and respectful, while narration, restrained music, and visual life continue unless a particular line
  earns a full stop. The channel is storytelling-first, more comedic than any pure finance/history
  channel, **not** a comedy channel. Cross-cutting toolkit
  (board-state / park-and-cut / ensemble / mirror / irony) + a transition seam-kit answers linearity.
  **Hard locks:** ONE narrator; no viewer role-casting or voiced character dialogue. First-person narrator
  asides and generic audience-facing `you` are allowed. No quotes — all character speech is narrator-reported.
  Reconciled across `long-form-writer`, `universal.md` §5c/§5d/§1d-V,
  `dna.md`, `researcher`, `shorts-writer`, `reference-channels.md`, and the visual grammar.
- **Scriptwriter — REBUILT + PROVEN (2026-07-08, extended 07-09); scripting overhaul LANDED 2026-07-28
  on `claude/fyt-writer-grammar-slim`, round 2 LANDED same day:** the flat/buttoned-script problem was
  root-caused (a model self-checking prohibitions shares its own blind spot) and fixed architecturally.
  The voice bar is now `channels/the-second-take/example-scripts.md` (Daniel's approved excerpts;
  replaces the retired `personable-calibration.md` and the earlier Poyais-as-gold framing, seven excerpts
  now approved). The blind fixture/candidate protocol is retired: acceptance is a fresh writer run
  Daniel reviews directly. The writer now runs a cultural-pull sweep inside Step 3a (era anchors,
  comparisons, joke angles, WebSearch-licensed for era texture and the universality bar). Voice dials
  moved to `stability: 0.20` / `style: 0.6`. `long-form-writer` generates **casual-first, leash-second**
  (spine → casual draft → leash-check), then a **critic layer** (Step 3d, `references/critics.md`): taste
  ∥ leash critics + a **coherence critic** (first-time-viewer pass, capped one-bounce structural rewrite;
  bar = grammar §3.7 "non-linear but followable") → in-voice editor + `scripts/lint_script.py`. On
  research channels the writer is LEASHED to the fact-ledger; the `researcher` now captures
  relational/connective facts (not just atoms). Length norm centered on **~10 min**. **Round 2 (Daniel,
  same session): the fresh Bricks script from round 1 was rejected** ("pretty terrible across the
  board") for rule-shaped dryness (clipped one-liner monotone, concept-prose, audible hedges, a
  still-life hook); the doctrine, not the artifact, was rebuilt. Landed: the paragraph-as-idea-block
  doctrine (short-punch rule deleted); humor recalibrated to warm/irreverent/pop-culture-loaded with a
  hit-or-miss bar; a hedge ban (hedging happens in fact selection, never narration) plus a transparent-
  speculation move for record gaps; a past-default tense doctrine; hook = actor + event + familiar
  anchor; endings as tone, not formula (the "one earned ironic image" requirement deleted); the wink
  doctrine scrapped; rise-before-fall with every escalation motivated out loud (`storytelling-grammar
  §2.7`). **`script.md` is now pure voiceover prose:** no `[B-ROLL]`, no pause/beat cues; deliberate
  pauses are `audio-director`'s job and visual beat segmentation moves downstream entirely; runtime lint
  reverts to words ÷ measured wpm. **Deferred debt (recorded, not built):** `visual-prompt-writer` +
  `image-generation` still assume cue-bearing scripts and need a rework to consume pure prose, and
  `shorts-writer` still authors its own short-script cues (Daniel flagged it for the same later rework);
  this is intentionally NOT fixed yet (see *Visual system* + *Audio system* below for the stale references it
  leaves behind). Full rationale: `knowledge/decisions.md` 2026-07-28 round-2 entry. **Round 3 (Daniel,
  same session): script #2 line-reviewed, better but below the bar.** Landed: metaphor species (pulls
  skew heavily to NAMED cultural references, setup-then-apply licensed, drawn-out generic metaphor is
  the defect); stock-idiom default with contraction default (fragment-punch and paired aphorism dead);
  detail budget (one rounded number per beat, precision only where precision IS the story);
  viewer-staging and historiography kills; motivate-once escalation + the namesake rule; the one-source
  color license for witnessed scenes; the voice bar reframed as a register (no-lift language deleted);
  3b now drafts act-by-act with a voice-bar re-read between acts (the drift fix); taste judging is
  comparative with judge-side tripwires. Voice bar grew to ten sections (Ramsay fixer, fear regime,
  break-in, it-kept-going, second ending shape). Full rationale + plan:
  `knowledge/decisions.md` round-3 entry / `docs/superpowers/plans/2026-07-28-scripting-overhaul-r3-plan.md`.
  **Round 4 (Daniel, 2026-07-29): script #3 line-reviewed; DOCTRINE LANDED, REGEN PENDING.** Verdicts
  live in `channels/the-second-take/videos/2026-07-28-bricks-fresh/verdict.r3.md` (the binding overlay).
  Root cause of the round-3 miss was **the unstaged reveal**: the spoiler-frame hook's reveal was treated
  as audience knowledge, so the mechanism (test-count/TSA audit lecture) was taught before the bricks
  existed and two winks fired before any brick scene. Landed: grammar §3.2 rewritten as **the staging
  law** (pressure → the corner → the decision as a moment → the act → mechanism as the punchline;
  **mystery order beats textbook order**), with §3.6/§3.7 cohered and the coherence critic + writer
  structural pass bound to it so the bounce cannot re-teach explanation-first; the **orphaned callback**
  named as a defect; the generic-metaphor bar re-specified from sentence count to **one short clause**;
  an abundant-but-SHORT banter law with the **aftermath/legal stretch** named as the flat-stretch decay
  zone; **elegant variation** banned (bricks stay bricks); **one climb owns the numbers**; the
  **excerpt-covered-beat default**; and a **verdict-regen mode** in `long-form-writer` (Step 0.4 + the
  critics' verdict-overlay rule) that archives `script.rN.md`, locks Daniel-verbatim lines against every
  downstream agent, and requires generalizable lessons to land in doctrine before a regen runs. Endings
  stay formula-free (Daniel declined to codify the counterfactual close). Full rationale:
  `knowledge/decisions.md` round-4 entry. The round-4 Bricks regen was then **accepted** by Daniel
  (`videos/2026-07-28-bricks-fresh/script.md`).
  **Blind-generation experiment (2026-07-29): COMPLETE; doctrine wave LANDED.** Two uncontaminated blind
  drafts of the same story were measured against the accepted script across 36 lenses. Historic defects
  are dead in both (block rhythm, orphaned callbacks, viewer-staging, hedging, leash, format); staging
  reproduced only 1-of-2; and doctrine that pairs a ban with a licensed replacement transmits **only the
  ban** (both blinds used zero heat mechanisms). Landed in response: grammar §1.6 heat inversion, §3.1
  named shapes (the peak-first rewind), §1.4 pull-first at a mechanism beat, §2.2 precision-is-opt-in,
  §1.1 unconditional gloss, §2.4 minor-character payoff, the preamble quarry-guard; critics gained the
  coherence **pre-authorization** flaw, hook-overspend, the quiet-script tripwire, and precision/
  speculation leash rules; `long-form-writer` 3a.3 became a **spine gate**. The accepted round-4 blocks
  are now banked in `example-scripts.md`. Full rationale: `knowledge/decisions.md` 2026-07-29 entry.
  **Next: the next fresh story is the live test** of whether the wave transmits.
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
- **Visual pipeline REDESIGNED 2026-07-28 (wave 3)** — VPW = thin procedure over visual-grammar +
  example-shots (the depiction bar, gate-B approved); shots.json v2 (lint warns on legacy fields);
  image-gen Pass1(build+tag)→Pass2(consume), missing-asset pre-gen gate; style-bible = LOOK law only.
  Waves 1–2 trimmed all visual+audio/motion/render doctrine; retired capabilities live only in
  `docs/retired-features.md`. Specs: 2026-07-28-visual-{stack-trim,pipeline-redesign}-design.md +
  2026-07-28-audio-motion-stack-trim-design.md.
- **Generation system:** per-channel **`visual-kit/style-bible.md`** is THE single image-gen doc (rig
  lock + descriptors + verify gate + committed recipe + asset-library build spec) + `registry.json` (the
  LIVE asset vocabulary) + the **`image-generation`** skill running a **two-pass flow**: pass 1 derives a
  per-video asset library from `shots.json` (recurring entities materialized ONCE, reuse-before-
  regenerate); pass 2 assembles every scene generation-based from it (multi-seed composition; technique
  menu). **Pass 1b (the separate expression-merge sub-step) RETIRED 2026-07-15:** a scene is now
  **one-run multi-seed** — character canonical + expression + pose (+ a two-slot interaction template)
  composed in a single gen — proven by a **6/6 capability probe** (incl. the two-identity
  handshake-over-a-pot the old staging law forbade; caveat: **expression is the softest seed**, an N=1
  existence proof). **`forge` now hard-errors on an unseeded `environment`/`style` gen** (killing the old
  silent stock-clipart fallback — the cause of every chunk-1 blocking flag); `refs/env/` is populated with
  **three human-gated Poyais frames** as style anchors. All generation runs on a **single engine —
  `gemini-3-pro-image`** (the flash tier was removed 2026-07-09; it drifted off-recipe). Specs:
  `2026-07-04-visual-style-lock-system-design.md` + `2026-07-08-image-generation-rebuild-design.md`.
- **Visual grammar (binding law):** `universal.md §13/§13a` — §13a-i (a shot is a COMPOSED SLATE: idle
  motion + one VO-synced transform + progressive-reveal enumerations) + §13a-ii (cut cadence + the HARD
  RULE that kills the stretch-to-fill dead-hold bug). Core rule: **non-literal is default; literal only
  for physical action/objects.** `visual-prompt-writer` OWNS the shot list and must author a choreographed
  slate. **KNOWN STALE (round-2, 2026-07-28):** `script.md` is now pure prose with no `[B-ROLL]` cues at
  all, so `visual-prompt-writer` can no longer anchor shots to writer-authored cues; the rework to plan
  shots straight off prose is DEFERRED (recorded debt, see *Front half* above), so this section still
  describes the pre-round-2 contract until that rework lands. The channel
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
  fields (`stage`/`stage_role`/`changed_elements`); `image-generation` owns the seeded delta-chain (the
  old `forge.py diff`/crop held-set gate was DELETED 2026-07-15). The **layer-vs-delta boundary is now
  canon** (`universal.md §13a`): a **LAYER** = a discrete, non-integrated cutout on a persistent plate
  (seeded); a **DELTA-CHAIN** = integrative growth of one scene's own architecture (regenerated seeded off
  the prior frame). Law: **layer only what has a canonical; delta-chain what must be invented in-scene.**
  Continuity hierarchy: **layer-move (LIVE) > delta-chain > hard-cut.** Spec:
  `2026-07-08-scene-chaining-design.md`. **Re-base rule (now codified in §13a):** a re-base inside the
  *same* location must seed the prior stage's **BASE** frame — the ≤3-delta cap otherwise throws the set
  away (produced two different swamps). **KNOWN BUG: `motion-planner` still has this.**
- **Character asset base — DONE (2026-07-10):** grew from solo/front-facing to **52 assets** (19 new
  primitives): 6 poses (sit/facepalm/surrender/whisper-aside/kneel-beg/point-at-thing), 4 angle+movement
  (back-to-viewer/3q-turn-right/walk-left/walk-right), 6 object-agnostic grips (hold-one/both,
  hold-paper, carry-by-handle, sign-with-pen, reach-to-take), 3 two-slot interaction templates
  (handshake/handoff/fistbump — blank base mannequins; a scene inserts two identities by `cast` order).
  **Hard rule:** every pose/angle/grip/interaction carries the base NEUTRAL face (expression is composed
  at scene-time as a seed in the one-run multi-seed gen). Two-slot interaction templates validated E2E
  (two identities inserted by `cast` order). The old **Pass-1b expression-merge path** — and its two known
  failure modes (haired characters merged bald; iris colour leaking from the expression ref) — is **moot
  with Pass 1b retired.** Learnings: a strong static 3/4 resists the front seed (walking is the real turn;
  true profile DEFERRED); seed exactly off `base`; regen fresh, never prompt-accretion. Docs single-sourced
  across image-gen / VPW / `style-bible §5,§7`.
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
  baseline (dead frames unrepresentable), channel look via `visual-kit/motion-tokens.json`. ~1.5× faster
  than realtime locally, zero API cost, no watermark. E2E-proven on a fixture (16:9 + 9:16). **Engine-drawn
  text overlays — word-anchored `on_screen_text` + the T2 device kit (stat/counter/progressive-reveal/
  chapter/meter/definition) — are RETIRED (2026-07-15); those components are parked dormant (not
  deleted). Still LIVE and distinct: the route line** (`draw_line` on a cutout path), **word-highlight
  captions (shorts), and the `PlaceholderCard`** (chart/screencap/stock/archival fallback, counted in
  the manifest). All in-video content text is **baked diegetic** in the generated image.
- **Layered-motion system — BUILT + PROVEN (2026-07-12):** a shot = a `plate` + animated **cutout layers**
  (slide/path/bob/appear) rendered by the engine **`LayerView`**, planned by **`motion-planner`** (reads
  `shots.json` → emits `shots.motion.json`; iterable ruleset + subtraction decomposition + fresh-eyes
  critic + `lint_motion_plan.py` + human gate; timid-by-default), materialized by `image-generation`'s
  **`forge cutout`** (rembg → alpha-harden → trim; MacGregor's 4-digit hand survives the matte). The
  layered flow **NEVER cuts a figure from a busy scene** — it generates the plate empty + the cutout on a
  clean plate, then composites. The **animation menu** (`animation-menu.json`) is the single-source
  contract binding planner↔image-gen↔engine and is now **cutout-only** (2026-07-15: the `source:"engine"`
  layer type is invalid in lint; the lone engine-drawn survivor is the route line on a cutout path).
  Camera is **fully locked** (decoupled from the retired beat-type seam). Proven E2E on Poyais L13
  (MacGregor slides onto a stage plate) + L03 (ship paths across a map drawing its route). Spec + 5 phase
  plans: `2026-07-12-layered-motion-system-design.md`.
- **T2 device kit — RETIRED (2026-07-15).** The engine device cards (stat/counter/meter/chapter/
  definition/reveal) — briefly wired 2026-07-12 as `source:"engine"` device-layers routed into
  `motion.json` `overlays[]` — are **removed from the pipeline** along with all engine-drawn text
  (`on_screen_text` word-anchored overlays + `at_scene` diegetic positioning). In-video text is now **baked
  diegetic** in the generated image; the Remotion components are **parked dormant** (not deleted). This
  **supersedes** the earlier device-card follow-ups: the old double-draw KNOWN BUG (engine-only device-card
  shots keeping a baked still) and the `at_scene`-positioning DEFERRAL are both **moot** — no engine text
  ships. Spec (now historical): `2026-07-12-t2-device-card-producer-design.md`.
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
  `vo.breath.mp3`; the −40 dB dip lands in the gap; deliberate pauses are entirely `audio-director`'s
  call as of round-2, 2026-07-28 (the writer authors no pause cues at all) ·
  **register** (human-cost = an authored `dry` pull-back) · **mastering** (`loudnorm_pass` reads
  `master_target`, ear-gated to **−14.5 LUFS / −1.0 dBTP / LRA 4**).
- **Measured-grammar anchors:** bed PLACED ~79% (not wall-to-wall); the default register is **wry/dry, NOT
  cheerful** (the `sneaky` family is the con-story workhorse; `upbeat` = an opt-in lift). Structural
  sounds fire by **selective director judgment** (guided by the audio-director SKILL's Placement laws ←
  measured `universal.md §13a-iii.8`), not mechanical auto-fire.
- **Files + measurement:** SFX/music sourced by **`sfx-forge`** (16-role CC0/CC-BY library) +
  **`music-forge`** (Incompetech CC-BY beds); the measured grammar came from **`audio-analyzer`** (8
  references, audio-only, tools-measured — the model-listening-hallucination fix). Ear-gated + approved by
  Daniel on `_chain-test`, and dogfooded on real VO in the Tier-1 test (12 cues, master −14.35 LUFS).
- **PROVISIONAL follow-ups:** partial-thin the human-cost music drop (the full drop reads slightly weird);
  `casual-bed` settle under a full front-half narration is still provisional. (The device-card SFX roles —
  stat/counter/meter → pop/riser/pluck — are **retired with the device cards**; element SFX now anchor to
  cutout appearances via `sync:"element"`, which is live.)
- Specs: `2026-07-12-audio-director-rework-design.md` +
  `2026-07-12-phase3b-music-lane-realizer-and-phase4-checker-design.md`. Resume:
  `docs/handoffs/2026-07-12-layered-motion-and-audio-director-pickup.md` +
  `docs/handoffs/2026-07-10-sfx-library-and-audio-analysis-pickup.md`.

## Production state

- **Poyais — PUBLIC (2026-07-21): the channel's first live video.** `J5KU-4IEGEQ`
  (https://www.youtube.com/watch?v=J5KU-4IEGEQ) — v3 upload, verified logged-out: playable, all 8
  measured chapters live, our thumbnail at maxres, clean description (no AI line — Daniel's ruling —
  no hashtags, alt-titles block), 20 tags, comments ENABLED (made-for-kids mis-flag fixed in Studio;
  root cause = the uploader MCP's Go zero-value bug omits MadeForKids:false, so YouTube's classifier
  filled the blank; channel-page.md step 0 sets the channel default). YouTube auto-applied its
  "Made with AI" info label (its detector, not our declaration — harmless). **Still open on this
  video:** upload assets/captions/long-form.en.srt (script-exact, generated) in Studio; pin the
  comment; Test & Compare. Superseded private uploads 8Rv5SwFiZ4Y + tVmQR0pfp-Q deleted by Daniel.
  Channel-page Studio pass (rename to "The Second Take", About, art, email) still pending —
  `channels/the-second-take/channel-page.md`. Analytics: start pulling J5KU-4IEGEQ next cycle. Opening lead-in idea measured and REJECTED (first-word 0.16–0.48s is
  the genre norm; see decisions 2026-07-21). Teardown:
  `channels/the-second-take/research/metadata-teardown-2026-07-21.md`.
- **Channel PAGE — drafted, awaiting the same Studio pass (2026-07-21):** live page confirmed empty
  (no About, no keywords; display name "Second Takes" ≠ locked "The Second Take" — rename flagged).
  `channels/the-second-take/channel-page.md` = the copy + ordered Studio checklist (About ≈210
  chars, zero links, optional keywords, avatar/banner spec-verified, trailer deliberately empty).
  `channel-forge` now has stage 12 `channel-page` so future channels get this at genesis.
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
  materialization) → the cutout LOOK, guidebook pops landing on visible elements, a full real render.
  (Seams #5 and #7 — device-card early-pop and engine-only double-draw — are now **moot: the T2 device kit
  is retired**, see *Motion & render engine*.) Pickup:
  `docs/handoffs/2026-07-13-tier1-integration-test-pickup.md`.
- **Poyais Pass 2 — chunk 1 RENDERED, PAUSED (2026-07-15).** First real Pass-2 chunk (L01–L26, 21 shots,
  ~40 gens ≈ $5.4) run **parallelized** — the `image-generation` Pass 2 cut into agent units (unit = one
  dependency family, or a ~4-gen bundle of independents; one agent per unit so chains stay serial inside
  it) → one batched 3-agent review → human gate → a watchable **77s MP4 with real VO**
  (`videos/_poyais-chunk1/assets/final.mp4`; VO only, no SFX/music). **Chunk 2 (L27–L47) is FULLY
  GENERATED through the simplified pipeline (2026-07-15)** — 15 shots + 6 human-directed reworks, all
  stamped; the human is **mid-iteration on the rework board** (paused; pickup:
  `docs/handoffs/2026-07-15-chunk2-board-iteration-pickup.md`, board URL inside). New locks landed en
  route: style-bible §3 **identity-match invariant**; the **STAMP lettering register**
  (`refs/env/stamp-block-outlined.png`, the one exception to the marker-italic family, §6); stamp
  overlays default to **slam**; `build_motion.py` honors an authored per-shot **camera pull** (L44 is
  the single authorized move, guard enforces plan⇔render equality). **Chunks 3–6 (~85 gens ≈ $12)
  queued** — chunk-5 blocker: `hastie-wife` has no canonical yet.
  Run-book: `channels/the-second-take/videos/2026-07-04-poyais/_image-gen-plan-2026-07-14.md`; pickup:
  `docs/handoffs/2026-07-15-poyais-chunk1-pass2-pickup.md`. The review earned its cost: all 8 generating
  agents called their own work clean; fresh eyes returned **24 flags, 4 blocking** (a generator
  self-checking shares its blind spot).
  - **The four chunk-1 skill bugs — status after the 2026-07-15 redesign:**
    1. **`mode=environment` unseeded → stock-clipart fallback** (cause of every chunk-1 blocking flag). ✅
       **FIXED:** `forge` now hard-errors on an unseeded `environment`/`style` gen, and `refs/env/` is
       populated with three human-gated Poyais style anchors.
    2. **`--mode identity` hard-codes a bald head** → unusable for haired cast. **OPEN.**
    3. **Pass-1b leaked iris COLOUR from the expression ref.** **Mechanism MOOT** (Pass 1b retired;
       expression is now a scene-time seed in one-run multi-seed). **CAUTION:** the stale
       `macgregor--sit--expr-thinking` asset is still on disk — do not reuse it.
    4. **head-turn language grows a NOSE.** **OPEN.**
  - **Law proven:** *layer only what has a canonical; delta-chain what must be invented* (every seeded
    figure cutout passed; every unseeded invented-environment cutout flagged) — now codified as the
    layer-vs-delta boundary in `universal.md §13a`. Plus the scene-chaining re-base rule above.
  - **Craft:** measure mattes/colours, never eyeball; a pale isolation field starves rembg on a pale
    subject; `--aspect 16:9` is scenes/plates ONLY (a 16:9 cutout invites variant sheets); the
    scenes-manifest key is **`shots`**, not `scenes`.
  - **Data integrity RESOLVED (2026-07-16):** the L05/L08/L22 `verified:false` inconsistency turned out
    already-flipped at the chunk-1 gate (audit notes added); the "Simón Bolívar" mojibake is fixed
    byte-surgically (11 glyphs incl. an L65 `£200,000` case; both lints green; the VO anchor matcher was
    never at risk — its normalizer strips accents and mojibake alike).
- **Pipeline-simplification redesign — IN FLIGHT (branch `feat/pipeline-simplification`, 2026-07-15).**
  Retires all engine-drawn text + device cards (baked-diegetic only; components parked dormant), retires
  Pass 1b (→ one-run multi-seed scene gen), hard-errors unseeded environment/style gens, and codifies the
  layer-vs-delta boundary + the re-base rule (all reflected in the sections above). **Phases 0–3 DONE:**
  (0) a **6/6 capability probe** of one-run multi-seed; (1) code removals (producers gone, `source:"engine"`
  invalid in lint, menu cutout-only, `forge` seed requirement + tests, hook paths → `${CLAUDE_PROJECT_DIR}`);
  (2) `refs/env/` style anchors from three human-gated frames; (3) this doc rewrite (`universal.md §13a`,
  audio-director `SKILL.md`, this STATUS, one `operating-law.md` clause). **(4) DOGFOOD DONE
  (2026-07-15): 7-shot slice + full chunk 2 ran through the simplified pipeline** — multi-seed identity
  hold STRONG, baked-text spelling STRONG, env-anchor style MOSTLY-HELD. **Identity-starve failure —
  RESOLVED to a DEFAULT (human-confirmed 2026-07-16):** a scene-heavy delta renders the blank base
  template (hit 3×, fixed 3/3), so the **two-gen identity pass** (gen the scene, then an identity pass
  seeded off the character canonical) is now the DEFAULT for scene-heavy single-character shots —
  codified in image-generation Pass 2 + style-bible §3 + `decisions.md` (~$0.13/shot accepted;
  multi-character + character-light shots unchanged). Also surfaced: `forge cutout --key-white`
  candidate (rembg groups lettering blocks).

## Open decisions & queue

- **Open decisions:** validation path; format mix; final channel name/handle. (Voice ID is locked — see
  *Channel & infrastructure*.) Rationale in `knowledge/decisions.md`.
- **Queued work:**
  - **Poyais: R10 RENDERED + VERIFIED (2026-07-18) — awaiting Daniel's gate (watch-through №6).**
    **Render: 492.8s (~8:13, −35s of removed silence), −14.2 LUFS, 117 shots, cues_unresolved=0,
    6 cards, all 10 probe frames correct.** First run of the splice-continuity gate initially
    reported 4 FAILs — a false alarm (the gate measured at nominal onsets because breathGaps
    lacked the valley cut_s; resolve_cut_points returns a copy). Fixed in audio_checker (6830095):
    gate re-run at true cuts = ok, 0 warnings, worst −36.4 dBFS; spot-checks at Daniel's cited
    sites confirm intact tails + zero digital-silence holes. Minor flags: independent true-peak
    −0.7 dBTP (loudnorm claimed −1.0; inaudible), 96 kHz AAC (known parked bug).
    A/B: final.pre-r10-2026-07-18.mp4 (R9) · final.pre-r9-2026-07-17.mp4 (R8).
    R10 landed all 12 W-notes (`_watch-through-5-notes-2026-07-17.md` / `_r10-fix-plan-2026-07-18.md`).
    **Headline: the VO "cuts" Daniel heard were root-caused by measurement** — the R8-B additive
    sentence-gap law truncated voiced word tails ("spo—t") and spliced −120 dBFS digital silence at
    all 83 sentence boundaries (raw vo.mp3 clean; TTS fine). Engine fix (breath.py): valley cut +
    PAD-TO-TARGET sentence law (0.65s/0.45s totals; insertion 41.5s→5.65s; VO 524→488.5s) +
    room-tone gap fill + NEW splice-continuity gate in audio_checker, wired into render QA
    (build_motion). Audio: LONG fades are now channel doctrine (music_fade_s 1.2/2.5,
    switch gap 1.2, card fades 2.5, post-prince bed 3.0s); music_present_db 10 (−1 dB); halo pool
    reverted to halo_vocal-1; floating-book ahh = ONE 5-link composite (halo_vocal_book-1, 4.44s,
    L36 only — 6-link rang past the shrunken L36, caught by the M20 warn); 5-star boom removed.
    Visual (through visual-prompt-writer + seeded forge.py): L11 + L54 crowd-rig regens; L75 trio
    regenerated FRESH on the base rig (R9 "REUSE - on-rig" was a mis-inspection, struck); slim
    flat-cel L27 arrow at [0.302,0.42] hf 0.085 (label overlap cleared); Chile neck chroma
    despilled deterministically. Reviewer disagreements (nose claim, glossy-vs-flat direction)
    tiebroken by orchestrator pixel-scan + eyeball. Dry-run: 117 shots, 488.3s, cues_unresolved=0,
    4 known warn-only ring-tails. Commits: b36ddcd/0309e9e (engine) · cb00a55 (audio+doctrine) ·
    e0a3fa1 (visual+decisions) · 6f5c789/c167af6 (notes+plan). Full render + verify in flight →
    then board republish + watch-through №6.
  - Previous round (superseded by R10): **R9 (watch-through №4, 34 Q-notes)** — all landed
    (`_r9-fix-plan-2026-07-17.md`): script edits + whole-VO re-synth, stamp freeze, post-card flash
    fix, 104px-bold Ink Free cards ("How to Sell a Fake Country" + "…pt.2"), Prince block+arrow,
    stars slam, rig regens, pixel-surgery signature (§G candidate), 53-cue audio plan, −2 dB, Marty
    Gots a Plan bed, music-through-human-cost = CHANNEL DEFAULT. Rendered 528.13s clean; commits
    5f7b2f0/82aac98/55fa0fb. R9 ear-gate flags carried into №6: end-card music exemption, removed
    death-onset buzzer, halo density, cha-ching tail.
  - Previous round (superseded by R9): **R8 (watch-through №3, 30 P-notes).**
    Two same-day rounds: **R7** landed all 35 watch-through-2 M-notes (`_r7-fix-plan-2026-07-17.md`
    — paradise chain re-integrated, deterministic 252-figure L103, dotted routes, `anchor_origin`,
    no-dip-in-pause, per-cue track/variant pins, upbeat-3, choir halo; rendered 499.6s clean);
    Daniel watch-through-3'd it same day → **R8** landed all 30 P-notes + rulings
    (`_watch-through-3-notes` / `_r8-fix-plan-2026-07-17.md`): 3 script cuts + closing VO line →
    whole-piece re-synth (118 shots, prosody re-rolled); **universal sentence-gap law** (0.5s/0.3s
    stacking — engine-wide, all future videos; baked [PAUSE] tags retired); **5 opaque chapter
    SCENES** (Daniel-titled: How to Invent a Country / How to Sell Nowhere / How it Fell Apart /
    The Getaway / Thanks for Watching; gap-aligned, end scene +4s hold); paradise reveals fixed
    ON-WORD (the delta-shot plate-overwrite bug); slams FREEZE (durationInFrames); trio redesigned
    in national dress on a shared town plate (L75 blank-slot → L81 + MacGregor, despilled);
    Venezuela burial; de-nose passes (R7 nose flag dead); Europe-only offices map (Stockholm
    placard ink-transplant); heavier crack-2, higher halo_vocal-2, **vocal-free Cheery Monday**
    middle bed (demucs-measured — Ascending the Vale had real vocals), **Monkeys to the very end**
    (somber tail + final dry span deleted; Daniel-ruled register override), SFX `fade_out_s` +
    real-duration windows. **Render: 544.6s (~9:04), −14.58 LUFS / −1.00 dBTP, checker green, ALL
    preflight gates + 20 probe groups PASS.** A/B chain: final.pre-r7 / final.pre-r8. Board = the
    shared review artifact (R8 content). Commits: R7 6dbc783/2a9f85b/a89bfad · R8
    4a49ef2/baf87bd/e421181. **Resume: `docs/handoffs/2026-07-17-poyais-r9-pickup.md` — Daniel's
    watch-through-№4 feedback → one more iteration (R9, round pattern in the pickup), then his
    gate → the tail (metadata-writer check /
    thumbnail / CC-BY credit block: Incompetech beds incl. upbeat-4 + crack-3/halo-1/collapse-1 /
    compliance / publish-queue) + the §G codification session (R6 candidates 1–15 + R7/R8: per-cue
    pins · cumulative-chain re-base seeds LAST delta · deterministic-composite lever ·
    sentence-gap law · card-on-silence idiom · foreground-render-in-subagent ·
    verify-the-artifact-before-declaring-a-background-job-dead).** Remaining OPEN chunk-1 bugs:
    `--mode identity` bald head, head-turn NOSE; follow-ups: forge.py pick path-id crash, AAC
    96 kHz residual.
  - **Mint the VISUAL GOLD EXEMPLAR** — the deferred enforcement behind the composition-variety logic:
    re-author a Poyais slice through the class-drives-composition VPW → regen all-pro → user approves the
    varied set → lock it. Pickup: `docs/handoffs/2026-07-09-composition-variety-gold-exemplar-pickup.md`.
  - Harden the image-gen identity review (a nose slipped).
  - Font-audition pick → `motion-tokens.json`; A/B the motion grammar on the 56s slice → a motion gold
    exemplar.
  - Validate the writer end-to-end on a *fresh* topic (generalization beyond Poyais).
  - Then the tail: compliance / publish / analytics + a `content-manager` orchestrator.
