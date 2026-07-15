# Audio Director Rework — design spec (2026-07-12)

Status: **DRAFT — awaiting user review.** This is "Step 2" deferred from the layered-motion arc
(`2026-07-12-layered-motion-system-design.md §13`). It is a **cleanliness/consolidation** rework of a
working, ear-gated audio system — so it is phased to stay regression-safe throughout.

## 1. Problem & goal

Audio today is governed by ~6 pieces, one of them mis-homed in a *visual* skill:
- **`beat_type`** — a 12-slug enum authored by **VPW** (a visual skill), whose only live consumers are
  audio + a tiny whip entrance. It conflates *structural facts* with *register/treatment judgments* and
  rigidly auto-fires sounds on *every* instance.
- `build_audio.py` + `breath.py` (mechanical realizers), `audio-cue-writer` + `music-cue-writer` (two
  separate authoring skills), `audio-tokens.json` (data).

**Goal (user-set):** get audio/structure work *out of the visual skill*, and *reduce the number of things
governing audio*, so that when we iterate on real videos the feedback lands in a clean structure instead
of compounding complexity. Concretely:
- **Delete `beat_type`.** VPW is fully freed of audio.
- **One `audio-director` skill** authors **one unified audio plan** by judgment (SFX / pause / music /
  dry-pullback), replacing the two cue-writers AND absorbing what the mechanical structural auto-fires did.
- **No rigid "fires on every instance" layer.** Structural facts (scene changes, chapter boundaries,
  deltas) are *context the director reads*, not triggers. The director places sounds *selectively* (a
  whoosh here, a boom there, or nothing), guided by the grammar — "we don't want a whoosh or a pause on
  *every* chapter boundary."
- **Determinism stays in the realizer.** Given the plan, the render is 100% reproducible; the *placement*
  is judgment (as every authored cue already is).

## 2. Non-goals / what must be preserved

- **The measured audio grammar (`universal.md §13a-iii.8`)** — reference-channel knowledge (bed placed
  ~79%, two ducking regimes, silence-as-scalpel, selective breath, density caps, ~⅓-of-punchlines dips).
  It is INDEPENDENT of `beat_type` and must survive verbatim as the director's guidance.
- **The ear-gated behavior** — the current render's feel (levels, breath lengths, the full-stop dip, the
  music lane) is ear-gated on `_chain-test`. The rework must be able to **reproduce it**, then improve —
  never silently regress it. Phasing + an A/B render at each checkpoint guarantees this.
- **Determinism of realization** — `build_audio`/`breath` stay model-free and deterministic.
- **No new audio capability** — this is consolidation, not features. (New selectivity logic is a later
  iteration, refined into the grammar.)

## 3. Architecture (the naming parallel with the visual side)

| Visual side | Audio side (after) |
| --- | --- |
| `visual-prompt-writer` (skill → `shots.json`) | **`audio-director`** (skill → `audio-plan.json`) |
| `motion-tokens.json` (data) | `audio-tokens.json` (data) |
| `universal.md §13a` (law) | `universal.md §13a-iii.8` (law) |
| `build_motion.py` + engine (realizer) | `build_audio.py` + `breath.py` (realizer) |

- **`audio-director`** reads `script.md` + `shots.json` (for *structural context*: scene changes via
  `stage_role`, chapter boundaries, deltas, on-screen text, the register of each section) + the audio
  grammar (`audio-tokens.json` + `§13a-iii.8`), and authors **`audio-plan.json`** by judgment:
  timid-by-default → fresh-eyes critic → `lint_audio_plan.py` → **human ear-gate on the render**.
- **`build_audio.py` / `breath.py`** deterministically realize the plan into the render's `audioSpec` +
  the breathed timeline. **No `beat_type`, no auto-fire layer.**
- **`audio-tokens.json` + `§13a-iii.8`** hold the data + law the director consults (the "logic lives
  elsewhere"). Selectivity guidance ("scene changes usually whoosh unless the register pulls back";
  "dips on ~⅓ of punchlines, never all") lives here + in the director's `references/`.

## 4. The unified `audio-plan.json` schema

One ordered cue array; each cue is `{ kind, anchor(s), …params }`, sharing the **one** anchor-matcher
(`render.match_shots_to_tokens`, cursor-advancing, `[…]`-stripped `vo_text` stream), **one** pool
validator, **one** lint, and **one** merged critic. Two anchoring shapes (the single real fork):

**Punctual cues** (single `anchor`):
- `{ kind: "sfx", anchor, role, gain_db? }` — `role` ∈ `sfx_pools`; a sound ON the anchor word.
- `{ kind: "pause", anchor, pause_s, in_pause? }` — INSERTS silence before the anchor (shifts the
  timeline); `in_pause` = interrupt-vs-landing timing. (Absorbs today's breath.)

**Span cues** (`from_anchor` + optional `to_anchor`):
- `{ kind: "music", from_anchor, to_anchor?, mood, level_db? }` — `mood` ∈ `music_pools`.
- `{ kind: "dry", from_anchor, to_anchor? }` — CARVES existing silence (no timeline shift; the register
  pull-back / human-cost drop).

**Hard rule — do NOT conflate `pause` and `dry`:** `pause` *inserts* time and shifts the timeline; `dry`
*carves* existing time. Same word "silence," opposite mechanism. They stay distinct `kind`s. (The
agents flagged this as the single most dangerous merge.) `in_pause` is `sfx`/`pause`-only;
coalesce/track-switch-gap/fades stay music-span realizer behaviors, never authored.

## 5. `beat_type` removal — what re-homes where

Deleting `beat_type` changes 3 SFX + 2 register behaviors + 1 breath (the other 2 SFX already key off
non-beat_type structure). Each re-homes:

| Today (beat_type) | After |
| --- | --- |
| `whoosh` on scene change | **not broken by beat_type removal** (already keys off `stage_role`); like all structural sounds it moves into director judgment in Phase 2 (placed selectively, not on every scene) |
| `tick` on text overlay | same — never used beat_type; joins director judgment in Phase 2 |
| `boom` on chapter-boundary | director judgment — chapter boundary is *context* (derivable from chapter structure); the director places a boom/pause/track-change there *when the content warrants*, not always |
| `thud` on escalation | **deleted** — `escalation` is a film idiom, not our channel; no replacement |
| `pop` on enumeration delta | director judgment — the `stage_role: delta` context is visible; the director places a per-element pop when it's an accretion (not on narration deltas) |
| `gravity` → thin + withhold + music silence | a `dry`/pull-back span the director authors on human-cost sections (music-cue-writer already does "dry on human cost") |
| `dialogue`/`aside` → SFX withhold | director judgment (it simply doesn't place comedic SFX there) — a *withhold*, i.e. the absence of a cue |
| `chapter-boundary` → 0.9s breath | a `pause` cue the director authors *when* a boundary wants a beat of silence (not every boundary) |
| whip `entrance` (build_motion, dialogue) | **deleted** — a camera-ish snap we don't want with a locked camera; its whoosh folds into the director |

Net: the structural sounds all become **selectively-placed director judgments**, with `stage_role` /
chapter structure / overlays as *context*. The critic backstops "a scene change or boundary that clearly
wanted a sound got skipped." `beat_type` and `escalation` disappear entirely.

## 6. File-touch map (grounded in the footprint)

| File | Change |
| --- | --- |
| **`audio-director/` (NEW skill)** | merges `audio-cue-writer` + `music-cue-writer`; SKILL.md + `references/{grammar-guidance,critics}.md` + `scripts/lint_audio_plan.py` (+ test). Emits `audio-plan.json`. |
| `audio-cue-writer/`, `music-cue-writer/` | **retired** (folded into `audio-director`). Remove from README. |
| `render-builder/references/audio-cues-schema.md` + `music-cues-schema.md` | replaced by one `audio-plan-schema.md`. |
| `build_audio.py` | read `audio-plan.json`; DELETE `beat_type` consumption (`register_audio`'s beat_type branches, `beat_type_sfx` in `sfx_events`, the gravity music-hole); the structural sounds now arrive as authored cues. Keep the realizer mechanics (density cap, full-stop, missing-file, music lane, pool rotation). |
| `breath.py` | `breath_gaps` reads `pause` cues (not `beat_type`); the shift/splice/dip chain is unchanged. |
| `visual-prompt-writer/SKILL.md` + `shots-schema.md` + `lint_shots.py` (+ its beat_type test) | **DELETE `beat_type`** authoring, the schema field, the HARD lint, the enum. VPW freed of audio. |
| `build_motion.py` | remove the `beat_type` whip-entrance derivation + `WHIP_BEAT_TYPES`; `beat_type` no longer copied into motion.json. |
| `audio-tokens.json` | drop `beat_type_sfx` + `breath_s_by_beat` (dead keys); keep pools/gains/music dials; add any selectivity-guidance data the director needs. |
| `universal.md §13a-iii` | retire the 12-slug beat_type→treatment **table** (dead); PRESERVE §13a-iii.8 (measured grammar) — re-frame it as the director's guidance, not a beat_type map. |
| `motion-planner/SKILL.md`, `motion-schema.md`, `audio_checker.py`, `README.md`, `CLAUDE.md`, `decisions.md` | drop beat_type references; update the audio-skill roster (2 skills → 1). |

## 7. File-editing hygiene (named requirement)

- **Single source of truth:** one `audio-plan-schema.md`, one lint, one matcher (reuse `render.py`'s).
  The grammar law stays single-sourced in `§13a-iii.8`; tokens hold data; nothing re-describes them.
- **Edit logic in place, retire the dead:** `beat_type` and its tables/enums/keys are *deleted*, not
  left as contradicting ghosts. The measured grammar is *re-framed*, not appended-to.
- **More do's than don'ts** in the `audio-director` doc; **`curate-doc`** pass on every touched doc.
- **Cross-file consistency sweep** as a final phase (the `beat_type` footprint from §6 is the checklist;
  a grep for `beat_type` must return zero live references at the end).
- **Derived-not-authored preserved:** the director authors *intent*; the realizer derives the render.

## 8. Determinism & the critic backstop

Realization is deterministic (no model in `build_audio`/`breath`). Placement is judgment — but gated:
timid-by-default → a merged fresh-eyes critic (restraint · right role/mood · sync/boundary-alignment ·
withhold/dry on human-cost · no-double-fire · **"missed a structural sound that clearly wanted one"**) →
`lint_audio_plan.py` (mechanical: anchors resolve, roles/moods in pools, `pause`≠`dry`, field validity)
→ the human ear-gate on the render. This is the *same* determinism level as today (the cue-writers were
already judgment); we've only stopped special-casing 3 sounds as mechanical auto-fires.

## 9. Build decomposition (regression-safe phases; ear-gate each)

Each phase leaves the system rendering + ear-gated — never a big-bang rewrite.

1. **Unified plan + `audio-director` skill (additive).** Define `audio-plan.json` + `lint_audio_plan.py`;
   build `audio-director` merging the two cue-writers; teach `build_audio`/`breath` to read the unified
   plan **alongside** the existing cue files. `beat_type` still works. **Checkpoint:** re-render
   `_chain-test` from a converted plan → A/B identical-or-better vs the current render (ear-gate).
2. **Absorb the structural sounds into judgment.** Move whoosh/boom/pop/withhold/breath from mechanical
   auto-fire into director-authored cues (guided by the grammar, selective). `build_audio` stops
   auto-firing them. **Checkpoint:** re-render → the structural sounds still land where they should, now
   selectively (ear-gate).
3. **Delete `beat_type`.** Remove authoring (VPW/lint), consumption (build_motion whip, build_audio,
   breath), the enum, the tokens keys, the whip entrance. **Checkpoint:** full test suite + a render
   with zero `beat_type` in the pipeline.
4. **Hygiene sweep + `curate-doc`.** Retire the beat_type table in `§13a-iii`, re-frame §13a-iii.8,
   update all docs/README/CLAUDE.md; grep `beat_type` → zero live refs.

## 10. Open questions / risks

1. **Naming** — `audio-director` + `audio-plan.json`? (my recommendation). Confirm.
2. **The one merged skill vs two:** merging `audio-cue-writer` + `music-cue-writer` into one director — is
   the combined SKILL.md too long? Fallback: one skill, but keep SFX and music as two clearly-sectioned
   procedures inside it. (I think one clean skill is fine.)
3. **The biggest risk — reproducing the ear-gated feel** when the 3 structural sounds move from
   guaranteed to judgment. Mitigated by the phased A/B ear-gate at each checkpoint (Phase 1 must
   reproduce today's render before Phase 2 changes placement).
4. **Timing** — this touches VPW, the shot schema, the audio realizers, two skills, and ~8 docs. It is a
   genuine multi-file rework of *working* code; the phasing is what keeps it safe.
