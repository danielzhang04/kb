# SFX Emission (Audio Arc Phase 2) — Design

**Date:** 2026-07-10 · **Status:** brainstormed, approved (design). **Scope:** fully designs **Phase 2a**
(the deterministic structural-SFX rebuild, buildable + hearable now) and sketches **Phase 2b** (the authored
comedic layer) + **beyond** as a **loose, gated roadmap** — re-brainstormed at each gate. Follows Phase 1
(reference audio analysis, done: `…2026-07-10-audio-reference-analysis-and-emission-arc-design.md`).

## Why this exists / the goal

The SFX library is built but mostly **silent** — only whoosh (scene change) + tick (text) fire, because the
existing emission is keyed to **device-card overlays `build_motion` never produces**. The goal: audio that
feels alive to the human ear — SFX landing on the right moments, pauses for weight — **deterministic and
hand-tunable in files**, grounded in the Phase-1 measured grammar, without overloading any one skill.

## The model (settled during brainstorming)

**One emission layer** (`build_audio`), fed by trigger sources, all sharing the built mechanical knobs (gain,
pool rotation, density cap, register-withhold). Firing is **fully deterministic + condition-driven — no
percentages.** A SFX fires iff its condition holds.

- **Structural conditions** already in `shots.json` (`beat_type` + stage/entrance): reliable → **auto-fire**
  (Phase 2a).
- **Content-specific conditions** ("this line deflates → womp") not in the data: captured by an **authored
  cue** (Phase 2b). Firing these off a coarse `beat_type` (every `aside`→sting) is the "weird in the wrong
  spot" failure — so they are NOT automated; they are authored where the content warrants.

**Principled boundary — "does it touch the timeline?"** (not "audio vs visual"):
- **Touches the timeline (pauses):** a pause inserts silence AND holds the frame → it reshapes the shared
  timeline every shot hangs on, so it lives in the render **timing** step (`build_motion`/`breath.py`), one
  shared mechanism for `beat_type` breaths (2a) and authored cue-pauses (2b).
- **Doesn't (SFX events, dips, ducks):** pure audio → computed by `build_audio`, stitched by the engine.
- **`beat_type`** is the **shared narrative-function label** — the visual motion grammar (camera/entrance)
  and the audio layer both read it. Never scrapped, never duplicated.

**`audio-taste-is-human-judged`:** deterministic tools place SFX; the human gates FEEL by ear on a real
render. Every which-SFX / how-loud / how-long value is data in `audio-tokens.json`, tunable without code.

---

# PHASE 2A — Structural SFX rebuild (full design)

**One line:** re-key SFX emission off the *real* signals (`beat_type` + stage/entrance) instead of the
dormant overlay branches, add the reveal hit + the full-stop, prove it by ear on `_chain-test`. No new file,
no new skill, no engine change.

## What fires in 2a (reliable conditions only)

| Condition (in `shots.json` today) | SFX | Status |
| --- | --- | --- |
| stage `base` / `whip` entrance (a new scene) | whoosh | keep (already fires) |
| `on_screen_text` overlay present | tick | keep (already fires) |
| `beat_type: number-reveal` | bed **dip** in the breath gap (EXISTING — unchanged; no SFX hit today) | keep (no new hit) |
| `beat_type: chapter-boundary` | boom | NEW (beat_type-driven, no overlay needed) |
| `beat_type: escalation` (capper) | thud ("slap"; provisional role) | NEW |
| `beat_type: gravity` | bed **thins** + SFX **withheld** | keep (register) |
| `beat_type: dialogue` / `aside` | SFX **withheld** / recede | keep (register) |

2a only auto-fires conditions where "fires on **every** instance" is correct — scene changes, chapter
boundaries, and escalation cappers are **rare + always warrant** their sound. Chapter/escalation are safe;
`number-reveal` is NOT given a new audible hit because **not every number warrants a punch** — which numbers
land a hit is a **content/context** call, so the audible number hit is deferred to 2b (the author decides).
The existing riser+dip on `number-reveal` is kept (proven, and the dip is a bed move, not a punch).

**Explicitly NOT in 2a** (waits for 2b authored cues — content-nuanced, would misfire if automated):
`aside`→sting, money-word→cash, **the audible number-reveal impact hit (content-selective)**, `cold-open`
scored gags, any word-level comedic hit.

## The rebuild (what changes in `build_audio.py`)

1. **Re-key structural SFX off `beat_type` + stage/entrance**, not overlays. A single coherent walk over the
   shots produces the structural events (consolidating what `sfx_events` + `register_audio` do today).
2. **Dormant ≠ dead — park, don't delete.** The device-card overlay branches (`stat-card`/`counter`→pop,
   `meter`/`progressive-reveal`→riser/pluck) are the *correct* trigger for per-element SFX and have **no
   `beat_type` equivalent** — they simply have no producer until device-cards ship (deferred, needs Remotion
   T3 animation). Keep them, clearly commented `# dormant until Phase-2c device-cards author these overlays`.
   **Remove only `chapter-card→boom`** (now redundant — `beat_type: chapter-boundary` owns boom; keeping both
   would double-fire).
3. **The beat_type→SFX map is DATA** in `audio-tokens.json` (new `beat_type_sfx` block: role(s) + gain per
   beat_type), so which-sound / how-loud is ear-tunable without touching code. `sfx_pools`/`sfx_gain_db`
   already exist and are reused; rotation (by occurrence index) + the `sfx_per_min_story_max` density cap
   already exist and apply to the new events.
4. **Full-stop** (in `build_audio_spec`, which already receives `breath_gaps`): inside a breath-gap span,
   **withhold** structural SFX EXCEPT the intended hit for that breath-beat's shot — so the gap is a true
   synchronized stop (bed dips + others silent), the measured OverSimplified device.

## Pauses in 2a

Unchanged mechanism: the two proven `beat_type` breaths (`number-reveal`, `chapter-boundary`) stay as-is in
`breath.py` + `breath_s_by_beat`. **The generalized arbitrary-cue pause (a womp requesting its own gap) is
2b** — it needs the cue layer. So 2a adds no new pause triggers; it only adds the full-stop *read* of existing
gaps.

## Files touched + cross-file consistency (pitfall map — keep ALL in sync)

- `.claude/skills/render-builder/scripts/build_audio.py` — the emission rebuild (consolidate; re-key;
  full-stop). Module docstring + inline notes updated to match.
- `channels/the-second-take/visual-kit/audio-tokens.json` — new `beat_type_sfx` map; `_doc` updated.
- `.claude/skills/render-builder/references/motion-schema.md` — **§2 `audioSpec` row + `_audioSpec_note`
  currently describe the overlay-keyed emission** ("chapter-card→boom, stat/counter→pop…"). **Rewrite** to the
  beat_type-driven model + the dormant-overlay note (integrate, don't append).
- `knowledge/research/niche-playbooks/universal.md §13a-iii.8` — the "SFX couple to the element layer" bullet:
  align to "structural SFX fire off `beat_type`; per-element pop/pluck stay overlay-driven, dormant until
  device-cards." (§13a-iii.8 was rewritten in Phase 1; this is a small consistency edit.)
- `.claude/skills/render-builder/SKILL.md` — if it documents the audio emission, sync the one description.
- `engine/src/components.tsx` — **NO change.** Event schema `{sfx, at_s, gain_db?}` is stable; `SfxTrack`
  plays whatever `build_audio` emits. (Confirmed: verifying this stays true is a test, not an edit.)
- `knowledge/decisions.md` — dated entry. `CLAUDE.md` status — Phase 2a done. The audio handoff — resume→2b.

**Pitfall guardrails (per project discipline):** integrate-don't-append (rewrite the drifted rows, don't stack
notes); no dead refs (every doc that names the old overlay-keyed emission gets updated in the same change); no
redundancy (beat_type owns the structural hits; overlays own per-element; no double-fire); no dangling role
names (every role in `beat_type_sfx` must exist in `sfx_pools`); no "don't"-list dumps at file ends — changes
are DO-form rules in the right section.

## Testing (built into 2a)

- **Hermetic unit tests** (plain-`assert`, repo convention) in a new `test_build_audio.py`: synthesized shot
  lists → asserted events (a `number-reveal` shot → a hit event at its start; a `chapter-boundary` → boom; a
  `gravity` span → withhold; a SFX inside a breath gap → dropped by the full-stop; a role missing from
  `sfx_pools` → no crash). No engine, no render, no files.
- **Fixture ear-gate (human):** render `_chain-test` (which has varied `beat_type`s) → **you listen** in the
  device player ([[review-video-in-device-player]]) and tune `beat_type_sfx` gains/roles by ear. This is the
  Phase-2a acceptance gate.

## What 2a deliberately does NOT do

Comedic/content SFX + authored cues (2b); arbitrary-cue pauses (2b); device-cards / per-element pop-pluck
producers (2c, needs Remotion T3 animation); the bed-level/ducking change + active music lane (Phase 3);
the V4 audio checker (Phase 4). Each is named so it's deferred-on-purpose, not forgotten.

---

# PHASE 2B — Authored comedic/content layer

> **Now fully specified in its own design doc: `2026-07-11-sfx-emission-2b-authored-cues-design.md`.** The
> sketch below is retained as the arc summary; the detailed spec supersedes it.

Built only **after 2a sounds right by ear.** Adds the content-specific hits `beat_type` can't reach —
`aside`→sting, money-word→cash, **the audible number-reveal punch (only on the impactful numbers)**, and any
word-anchored comedic hit.

- **`audio-cues.json`** per video — the single authoring surface, separate from `shots.json` (keeps VPW
  focused on visuals). Each cue anchors to a shot + VO phrase (resolved by the **existing** `vo_ref` matcher):
  `{anchor, role, pause_s?, gain_db?, music?}`.
- **`build_motion` routes each field:** `pause_s` → the generalized `breath_gaps` (touches timeline, shifts
  downstream once — hand-tunable, ripples correctly); `role`/`gain_db` → events; `music` → volume automation.
- **Generalize `breath_gaps`** to fire at an arbitrary cue's word (not just `beat_type` shot-first-word) —
  the only real timing change, and `splice_silence` already handles arbitrary gap times.
- **Authoring owner:** a **dedicated, focused audio-cue step** (small skill/agent) that reads `shots.json` +
  `script.md` + the measured grammar and writes `audio-cues.json` — NOT bundled into VPW. Plus an **audio-cue
  critic** (fresh-eyes: "does this SFX belong, is it too much, does the pause help or stall?") — matches the
  project's gold-exemplar + critic pattern ([[fix-generation-not-prohibitions]]).
- Bounds from Phase 1: measured density (~20–40/min combined) caps authoring; dips-on-~⅓-punchlines is a norm.

Open Qs for its gate: cue schema exact shape; whether the authoring step is a skill vs an agent; how much the
critic gates vs advises; hand-author the fixture first to validate the mechanism before building the author.

# BEYOND 2B (LOOSE — each its own gate)

- **2c — Device-cards.** Wire `build_motion` to produce `stat-card`/`meter`/`progressive-reveal` overlays
  (unlocks the dormant pop/riser/pluck branches, deduped vs beat_type). **Gated on Remotion T3 element
  animation** — the cards read wrong without it, so there's nothing to ear-gate until then.
- **Phase 3 — Active music lane.** Make the bed MOVE: revisit `bed_db_under_vo=14` **by ear** (measured refs
  keep the bed ~2–3 dB present; 14 likely over-buries — the `_bed_db_note` candidate); consume `music_states`
  (chapter track-change, needs an engine bed-switch); placed cues that can go silent. Uses Phase-1's music
  presence % + dip depth/placement. **Bed-behavior principles surfaced at the 2a ear-gate (general, not a rule
  list — the *how the music breathes around a hit* that 2a's crude step-dip only approximates):**
  1. **Dips fade, they don't cut.** A hard bed drop→silence→hard return reads as a glitch; the bed should
     *fade* out into a stop and *fade* back, not step. (2a uses an instant `dips` step — replace with a ramp.)
  2. **A stop = fade → real pause (VO *and* bed silent) → resume DELAYED at the next scene.** The bed must not
     resume on the same frame the hit lands; the silence holds through the hit and the music re-enters a beat
     later, on the following scene. (2a's dip ends exactly at the hit — the "picks back up when the boom lands"
     artifact.)
  3. **A silence needs a PAYOFF.** A dip with nothing emphasized landing in/after it reads as anticlimax — so
     the number-reveal dip is incomplete until it's paired with the 2b audible punch AND word-anchored to the
     number itself (the reveal must land *on the number*, not at the shot's first word). Until then the
     number-reveal dip is a known-crude half-beat.
  4. **Selective, not every scene change.** Whoosh (and future between-beat cues) should fire only on
     *notable/higher-impact* scene changes, not every base — a `beat_type`/impact-driven refinement.
- **Phase 4 — V4 audio checker.** Deterministic mix measures per render (LUFS/true-peak vs `master_target`,
  gain budget, SFX↔VO collisions, density vs the measured band, missing-file=0, register-events-present) +
  a thin listen-critique. Uses Phase-1 targets as thresholds.

---

## Self-review

- **Placeholders:** none in 2a (fully specified). 2b/beyond intentionally loose (a stated scope decision, each
  with its re-plan trigger named), per the analysis-first arc's gating.
- **Consistency:** the "does it touch the timeline?" boundary is applied uniformly (pauses→timing, events→
  audio); the reliable-vs-authored split matches Phase-1's reliable-vs-directional discipline; the cross-file
  map lists every doc that currently describes the emission so none is left stale.
- **Scope:** 2a is one implementation plan's worth (one file rebuild + a config block + a full-stop + tests +
  a fixture gate). 2b+ correctly deferred.
- **Ambiguity:** "structural vs comedic" pinned to *reliable beat_type condition* vs *content-nuanced authored
  cue*; "dormant vs dead" pinned (overlay per-element branches kept + commented; only chapter-card→boom
  removed as redundant); "pause in 2a" pinned to the two existing beat_type breaths only.
