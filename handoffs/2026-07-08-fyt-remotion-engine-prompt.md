# PROMPT: Build the Remotion 2.5D motion engine into render-builder

Execute this end-to-end. The strategy was brainstormed and settled 2026-07-08 (see
`knowledge/decisions.md` 2026-07-08 entries + `docs/handoffs/2026-07-08-stage-seeded-delta-scoping.md`
for the continuity model) — do NOT re-open the settled decisions below. Use
**superpowers:writing-plans** to plan the whole task first; **superpowers:brainstorming** for the
motion.json schema design in Phase 2 (schema only — the architecture is decided); **skill-creator**
when rebuilding render-builder's SKILL.md; the **context7** MCP (resolve `remotion`) + WebSearch for
current Remotion docs — do not code against training-data memory of its API; and
**superpowers:verification-before-completion** before declaring any phase done. Commit after each
phase with EXPLICIT `git add <paths>` only — other terminals work this repo in parallel; never
`git add -A`, never rewrite history.

## SETTLED DECISIONS (binding)

- **Remotion REPLACES JSON2Video** as render-builder's engine, and **renders video #1** — we never
  buy JSON2Video Pro. JSON2Video code stays behind a legacy flag until parity is proven, then its
  removal is a named follow-up.
- **render-builder grows the engine** (no new pipeline stage): Remotion becomes its second engine;
  motion authoring becomes a step + reference doc inside render-builder. The scenes-mode input
  contract (verified `assets/scenes/<shot-id>.png` + manifest; missing ai-gen scene = hard error;
  `--allow-missing` escape) is UNCHANGED.
- **Architecture: a fixed engine + per-video data.** One committed Remotion component library
  (written once, in `.claude/skills/render-builder/engine/` — `package.json` committed,
  `node_modules/` + build artifacts gitignored) rendering a per-video **`motion.json`** spec (pure
  data authored per video). Nobody writes React per video.
- **Continuity model (cheapest first):** move a layer in Remotion (zero drift) → seeded delta-chain
  a stage (≤3 hops, per the drift test; the stage/delta shots.json semantics are being added by a
  parallel terminal — consume them if present, degrade gracefully if not) → hard cut. NO fades ever.
- **Tier scope:** this task builds **T1** (springy camera moves, idle motion, impact shake,
  VO-word-synced overlays — stat pops, counters, progressive reveals — on flat scene PNGs) and
  **T2** (the diegetic device kit as CODE components: counter, stat card, chapter card,
  meter/gauge, definition card — real type, never generated text). **T3 (layered scenes/cutout
  compositing) is explicitly OUT of scope** — gated on the Poyais image dogfood; leave clean seams
  (a `Layer`-shaped element model in motion.json is fine, implementing compositing is not).
- **Captions come from our own `word_timings`** (ElevenLabs, in `voiceover.manifest.json`) — exact
  word-level sync, no re-transcription. Same for timing cuts: reuse the existing
  `vo_ref`-first-4-words matching logic (port `retime_by_timings` semantics; do NOT change the
  vo_ref/lint_shots.py contract).

## PHASE 0 — Environment + research (cheap, do first)

1. Check `node --version` (need a current LTS). If Node is missing, STOP and tell the user the one
   install command — don't install system-wide tooling silently.
2. Research via context7 + web: current Remotion major version + exact license terms (we are ≤3
   people — confirm the free tier covers us and note the trigger that would change that);
   `renderMedia`/CLI headless rendering on Windows; `<Img>`/`staticFile` for local PNGs; `spring()`
   / `interpolate()`; `<Audio>` sync; the current caption approach (`@remotion/captions` or
   equivalent) fed from our own word timestamps, NOT whisper; typical render throughput for
   1080p image-sequence content. Write findings into the plan.

## PHASE 1 — THE SPIKE (hard gate; timebox ~one session)

Goal: one rendered MP4 that proves toolchain + look + speed. Scaffold the engine dir and build a
2–3 "shot" composition using EXISTING assets (`channels/the-second-take/visual-kit/refs/base/*.png`
— base + an expression + an action frame; a scene-like backdrop is fine to fake with any 16:9
frame). Requirements:

- A springy push-in camera move (spring, not linear) on one still; a whip-pan hard cut into the
  next; idle micro-motion (gentle bob/breath ~1–2% scale oscillation) so no frame is dead.
- One VO-word-synced overlay: synthesize a REAL ~4-line VO slice through the voiceover engine
  (`.claude/skills/voiceover/scripts/voiceover.py` — read its skill first; a few hundred ElevenLabs
  chars, negligible quota) to get real `word_timings`, then pop a stat card on a specific word.
- Word-synced captions from those same timings.
- Render 1920×1080 MP4 locally; **measure and report wall-clock render time and output size.**
- Side-test (T3 feasibility data, ~10 min): run `rembg` (or equivalent local background removal)
  on one flat-cel character frame and save the cutout PNG — report edge quality honestly.
- **STOP at the gate:** report render time, file paths (the user plays the MP4 locally — give the
  path, don't embed), what worked, what fought you. The user reviews the clip and approves before
  Phase 2. If render time or toolchain friction is bad on this machine, say so plainly and
  recommend whether to proceed, optimize, or reassess — do not sand down a bad result.

## PHASE 2 — Engine v0 + motion.json + the render-builder swap (after gate approval)

1. **motion.json schema** (brainstorm this, then write it to
   `.claude/skills/render-builder/references/motion-schema.md`): per shot → components + params +
   timing anchors. Keep it derivable-first: most of it should be DERIVED mechanically from
   shots.json (`ken_burns` → camera component, `on_screen_text` → overlay, `within_shot_motion` →
   the one meaningful transform, word_timings → anchors), with a thin authoring/judgment layer on
   top documented as a step in SKILL.md. Honor the derived-fields lesson: derived data never
   changes how upstream skills conceive their work.
- 2. **Component library (T1+T2):** CameraRig (push/pull/pan/whip, spring-based), IdleMotion,
   ImpactShake, PaletteShift, PopIn/SlideIn/StampDown for overlay elements, ProgressiveReveal,
   Counter, StatCard, ChapterCard, Meter, DefinitionCard, SubtitleTrack (word-timings-fed),
   AudioTrack. Style tokens (font, colors, marker look) read from a per-channel config block —
   channels are data, the engine is niche-agnostic.
3. **Builder step:** shots.json + scenes manifest + voiceover manifest → motion.json → render via
   the engine. Long-form 16:9 + shorts 9:16. Reuse the scenes-mode resolution + hard-error rules
   verbatim from `render.py::resolve_scene_files` semantics.
4. **Parity checklist vs JSON2Video (all must pass before the swap):** per-line VO sync (vo_ref
   matching), movie-level VO track, captions, on_screen_text overlays, publish-short gating,
   dry-run-equivalent (build motion.json + validate without rendering), and
   `render.manifest.json` written in the SAME schema (engine field = "remotion",
   `watermark: false`, pieces records) so compliance-check/publish-queue need zero changes.
5. **Swap:** Remotion becomes the default engine; JSON2Video path stays behind `--engine json2video`
   (legacy). Rebuild SKILL.md (skill-creator; keep every surviving learning — free-tier notes move
   under the legacy flag section, TLS/py notes stay for the legacy path, SOP becomes
   validate-then-render). Update `references/render-schema.md`, the skills README row, CLAUDE.md
   status (integrate, don't append), decisions.md entry (root-cause → fix framing). Reference-sweep
   for stale JSON2Video-as-default claims in living docs only.
6. **Validate end-to-end:** render the spike slice through the FULL new path (shots.json →
   motion.json → MP4) and a 9:16 short-shaped slice. Report honestly; give file paths.

## GUARDRAILS

- Explicit `git add <paths>` only; commit per phase. Other terminals are active in this repo.
- Do not touch: the vo_ref/lint_shots.py anchor contract, image-generation's docs/flow,
  style-bible locked values, the scriptwriter system.
- Hard cuts only; no fades; every shot moves (idle baseline is law, universal.md §13a-i/-ii).
- The engine is niche-agnostic code; channel look lives in data (per-channel config), never in
  components.
- Honest reporting at every gate: render times, failures, and anything that fought the toolchain —
  the user decides trade-offs, not the prompt.
- Named follow-ups to record, not build: T3 layered compositing (gated on the Poyais dogfood);
  JSON2Video code removal after video #1 ships on Remotion; Remotion Lambda if local render time
  ever becomes the bottleneck.
