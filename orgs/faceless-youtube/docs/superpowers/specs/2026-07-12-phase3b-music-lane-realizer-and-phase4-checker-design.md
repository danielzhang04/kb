# Phase 3B (Music-Lane Realizer + Placement) + Phase 4 (Audio Checker) — Design

**Date:** 2026-07-12 · **Status:** brainstormed, approved (design shape). **Scope:** the buildable
implementation design for **Phase 3B** (the music-lane realizer + the `music-cue-writer` placement
layer) at task-plan altitude, plus **Phase 4** (the deterministic audio checker) at design +
task-outline altitude. Phase 4 is task-detailed later, once 3B is ear-gated (its exact checks may
shift once the real lane is heard).

**Predecessors (read for the arc):**
- `2026-07-11-phase3-music-lane-arc-design.md` — the arc this executes; sub-project A (`music-forge`)
  is DONE, its A1 mood taxonomy (`casual-bed`/`upbeat`/`sneaky` + `dry`) is LOCKED, which is what
  unblocks this 3B task-plan.
- `2026-07-11-sfx-emission-2b-authored-cues-design.md` — the 2a/2b split (structural auto-fire +
  authored content layer + fresh-eyes critic + lint + ear-gate) that 3B mirrors exactly.
- `2026-07-10-audio-reference-analysis-and-emission-arc-design.md` — the measured model behind it.

---

## 1. Why this exists (the one-paragraph version)

The SFX layers are built and ear-gated; **music is still a flat placeholder** — the engine plays one
looped bed (`AudioBed` in `engine/src/components.tsx`) at a constant, over-attenuated level under the
whole video, and `build_audio.build_audio_spec` emits `music_states: []` (stubbed). The `music-forge`
library is sourced and wired (`music_pools`: `casual-bed`/`sneaky`/`upbeat`), but nothing places it.
3B replaces the single-looped-bed primitive with a **placed music lane**: per-section tracks (some
sections dry), held at a constant present level, dropping to silence only on inherited full-stops and
at track switches. 3B is authored-placement (a thin `music-cues.json`) driving a dumb realizer,
mirroring the proven 2a/2b split. Phase 4 then closes the loop with a deterministic audio checker.

## 2. The measured model (what 3B honors — and what it deliberately does NOT)

From `visual-kit/research/audio-logs/synthesis.md` (8 reference videos; comedic-history targets =
OverSimplified / Crayon / HeyHistorically; Kurzgesagt = the excluded restrained floor):

- **Music is PLACED, not wall-to-wall** — presence ~62–85% of runtime for the targets; 15–40% runs
  dry (VO + SFX only). **→ 3B honors this** via authored `dry` spans + track-switch gaps.
- **When playing it sits PRESENT under VO** (~2–3 dB duck vs its solo level; the current
  `bed_db_under_vo = 14` is 5–7× too much attenuation → "buried"). **→ 3B honors "present"** via a new
  `music_present_db` token, ear-tuned; but see the taste calls below — the 2–3 dB *per-phrase duck*
  is a knob, defaulted OFF.
- **Loudness** — references sit ~−18 LUFS but CLIP; our `master_target` (−15.5 LUFS / −1.0 dBTP /
  LRA 4) holds headroom. **→ Phase 4 enforces** (measure-only; not yet enforced).

**Two measured behaviors 3B DELIBERATELY does not reproduce (approved taste calls):**

- **(a) Constant present level, NOT per-phrase VO ducking.** References micro-duck ~2–3 dB under
  every phrase; that is constant modulation, which the channel's owner dislikes (calm > breathing —
  the same instinct as `camera-locked-by-default`). **Decision:** while a segment plays, hold music at
  a **constant** present level. The 2–3 dB VO duck is retained only as an available token
  (`music_vo_duck_db`), **default 0**. `[[camera-locked-by-default]]`
- **(b) No frequent on-beat dips.** References dip music ~19 dB roughly once per 5 s and use the dip
  itself as punchline emphasis (Crayon-Rockefeller 227 dips / 20 min). **Decision:** do NOT generate
  these — it reads as absurd constant pumping. Music drops to silence/near-silence **only** in the
  three cases in §3. This is the single biggest fidelity gap vs the references and is **named, not
  silently dropped**; if the B3 ear-gate finds the lane too static, the follow-up is a small
  `beat_type`-keyed dip generator or a lower present level — a later arc, not 3B.

## 3. When music drops (the complete list — there are exactly three)

Music plays at a **constant present level** within a segment and drops **only**:

1. **Inherited full-stops** — the existing `dips` timeline (−40 dB in every breath gap:
   number-reveal authored cues + chapter-boundary breaths) + the rare authored "crazy emphasis"
   pauses (~2×/video, `audio-cues.json pause_s` / breaths). Already built and on a shared shifted
   timeline; **the lane inherits them with zero new dip logic.** These are the "certain SFX boom"
   drops.
2. **Track switches** — a boundary between two **different** moods is **fade-out → short silence gap
   → fade-in** (NOT an overlapping crossfade). Gap length = `track_switch_gap_s` (token). This matches
   the intended feel ("run track, longish pause, run other track") and removes the crossfade
   implementation trap entirely.
3. **Authored dry spans + gravity/human-cost** — `music-cues.json` `dry` spans and `gravity` shots →
   no segment there (silence). `gravity`'s existing `thin_spans` still apply if a segment does overlap
   (belt-and-suspenders), but the primary human-cost mechanism is an authored `dry` span.

**Corollary:** adjacent segments of the **same** mood merge into **one continuous segment** (no gap,
no fade) — the realizer coalesces them so an unchanged mood stays seamless and calm across a chapter
boundary.

## 4. Architecture + data flow

```
[A · music-forge]  DONE — music_pools{ casual-bed|sneaky|upbeat → [track files] } in audio-tokens.json
        │                 audio/beds/*.mp3 (gitignored) + manifest + attribution
        ▼
[B2 · music-cue-writer skill]  reads script.md register (§2) + shots.json chapter-boundary structure
        │   authors videos/<slug>/music-cues.json = { cues:[{from_anchor, mood, level_db?}], dry:[…] }
        │   fresh-eyes critic (references/critics.md) → one revise → lint_music_cues.py (ONE matcher)
        ▼
[B1 · realizer]  build_audio.build_music_lane(cues, shots, tokens, words, audio_dir) → music_states[]
        │   resolve anchors (shared vo_ref matcher) → segments; subtract dry + gravity;
        │   merge same-mood neighbors; insert track_switch_gap between different-mood neighbors;
        │   per segment: track = deterministic music_pools rotation · base_db = level_db|music_present_db ·
        │   fade_in_s/fade_out_s (token) · loop-to-fit dur_s · missing pool/file → drop + music_missing++
        ▼
[engine · MusicLane]  (AudioBed rewritten) plays music_states as non-overlapping <Sequence>s;
        │   per-segment volume = presentGain × fadeEnvelope(t) × musicDuckEnv(t)
        │   musicDuckEnv(t) = MIN(inherited dips −40, thins) — applies to whatever plays
        ▼
[Phase 4 · audio_checker]  post-render deterministic measure → render.manifest.json.audio (warn-not-fail)
```

`build_audio_spec` already threads `music_states` through the spec dict (today `[]`); B1 fills it.
The `audioSpec` type and the engine both change from a single `bed` field to a `music_states` list.

## 5. SUB-PROJECT B1 — the realizer + engine (fully specified)

### 5.1 `music-cues.json` schema (single-sourced contract)

Contract doc: **`render-builder/references/music-cues-schema.md`** (the ONLY home for field
semantics; the skill and lint POINT to it, never copy — `[[keep-docs-structured]]`).

```jsonc
{
  "cues": [
    { "from_anchor": "<verbatim VO phrase, ≥4 words>", "mood": "casual-bed|sneaky|upbeat",
      "level_db": -8 }        // level_db optional: per-cue present-level override
  ],
  "dry": [
    { "from_anchor": "<verbatim VO phrase>", "to_anchor": "<verbatim VO phrase>" }  // to_anchor optional
  ]
}
```

- `from_anchor` / `to_anchor` resolve via the **shared** `render.match_shots_to_tokens` + `_NORM`
  (the one matcher — no second timing path). Verbatim, ≥4 words, in narration order (lint-enforced,
  mirroring `lint_audio_cues`/`lint_shots`).
- A cue runs from its resolved start until the next cue-or-dry start (or piece end).
- Every `mood` must exist in `music_pools` (lint-enforced).
- **Absent file → clean no-op:** no `music-cues.json` → the realizer emits one full-length default
  segment (§5.3 back-compat).

### 5.2 `build_music_lane(cues, shots, tokens, words, audio_dir=None) → music_states[]` (pure)

`music_states` element: `{ "track": "audio/beds/<name>.mp3", "at_s": float, "dur_s": float,
"base_db": float, "fade_in_s": float, "fade_out_s": float }`.

Algorithm (deterministic — no random, no clock; `[[derived-fields-not-generation-targets]]`):
1. Resolve every `from_anchor`/`to_anchor` to absolute times via the shared matcher; drop unresolved
   (lint catches these earlier — here it is defensive).
2. Build raw segments: each cue → `[start, next_boundary)`.
3. Subtract `dry` spans and `gravity`-shot spans (split/trim segments; a fully-covered segment
   vanishes).
4. **Coalesce** adjacent segments with the **same mood AND no intervening dry/gravity gap** into one
   (seamless, no fade between them).
5. Between two retained segments of **different** mood, shorten the earlier by `track_switch_gap_s`
   (the silence pause) so a gap exists; set the later segment's `fade_in_s` and the earlier's
   `fade_out_s` from tokens.
6. Per segment: `track` = deterministic rotation of `music_pools[mood]` (occurrence index, exactly
   like `_sfx_file`); `base_db` = cue `level_db` else `music_present_db`; `dur_s` = segment length
   (the engine loops-to-fit / tiles).
7. **Missing-file defense** (mirrors `sfx_missing`): if `music_pools[mood]` is empty OR the chosen
   file is absent under `audio_dir` → drop the segment, increment a returned `music_missing` count.
   `audio_dir=None` → no filtering (safe-when-absent).

### 5.3 Back-compat + the dead-path cleanup (logic change, NOT an append)

- Today `build_audio_spec` sets `bed = audio/beds/{bed_default}.mp3` with `bed_default: "neutral"` —
  **`neutral.mp3` does not exist**; the current default-bed path is effectively dead. 3B **removes**
  it. New back-compat: no `music-cues.json` → `build_music_lane` returns one full-length segment at a
  new **`music_default_mood: "casual-bed"`** token (the workhorse), at `music_present_db`.
- The spec dict loses `bed` + `bed_db_under_vo`; gains a filled `music_states`. `duck_spans` is
  removed if it is truly inert (it is, at `GAP_LIFT_DB = 0`) — verified by grep + a render diff, not
  assumed.
- **This is the file-sweep crux (§8):** `bed`, `bed_default`, `bed_db_under_vo`, `"neutral"`,
  `GAP_LIFT_DB`, and the `music_states: []` stub comment all get removed/replaced across
  `build_audio.py`, `components.tsx`, the `audioSpec` type, `audio-tokens.json`, and every doc — no
  stragglers (grep-verified).

### 5.4 Engine — `AudioBed` → `MusicLane`

Rewrite the single-`<Audio bed loop>` component to render `music_states`:

```
musicDuckEnv(t):                         // the inherited automation, applies to ANY playing music
  g = 1
  for d in dips:        if t in d:  g = min(g, dbToGain(d.depth_db))     // −40 full-stops
  for s in thin_spans:  if t in s:  g = min(g, dbToGain(-|s.extra_db|))  // human-cost thin
  return g

for seg in music_states:
  <Sequence from=round(seg.at_s*fps) durationInFrames=round(seg.dur_s*fps) layout="none">
    <Audio src=staticFile(seg.track) loop volume={ localFrame =>          // loop OR pre-tiled (§5.5)
        t = seg.at_s + localFrame/fps                                     // ABSOLUTE time — the trap
        base = dbToGain(-|seg.base_db|)
        fade = fadeEnv(localFrame/fps, seg.dur_s, seg.fade_in_s, seg.fade_out_s)  // linear ramp
        return clamp(base * fade * musicDuckEnv(t), 0, 1)
    }/>
  </Sequence>
```

**Two traps written into the plan as explicit steps:**
- **Sequence-local vs absolute frame:** inside `<Sequence from=X>` the `volume` callback frame is
  *local* (0 at the sequence start). The global `musicDuckEnv` must be looked up at **absolute** time
  `seg.at_s + localFrame/fps`, or every dip misaligns silently. A unit-ish assertion + a render
  observation guard this.
- **loop vs tile past the loop point:** CLAUDE.md claims the bed is "tiled to full length," but the
  live component still uses `<Audio loop>` — the 31s loop+volume-modulation bug class. Verify a
  >31 s segment modulates correctly under `loop`; if not, **tile** the track to the segment length in
  `build_music_lane`/build step (pre-concatenated mp3) and drop `loop`. Decide by observation, not
  assumption.

### 5.5 Tokens touched/added (DATA, not logic — `[[keep-docs-structured]]`)

In `audio-tokens.json` (one config home): **add** `music_present_db` (present level; start ~8–9,
ear-tuned toward "present" at B3), `music_default_mood` (`"casual-bed"`), `track_switch_gap_s`
(~0.6–1.0), `music_fade_s` (`{in, out}`), `music_vo_duck_db` (default 0 — the off-by-default knob).
**Remove** `bed_default`, `bed_db_under_vo` (+ resolve `_bed_db_note`), and repurpose `_dip_db_note`
(the −40 stays the full-stop; the "shallower general dips" language goes, since we deliberately don't
generate them). `music_pools` / `music_norm_lufs` already present.

### 5.6 B1 tests (hermetic; repo `assert`-style, matches `test_build_audio.py`)

`test_build_audio.py` additions — `build_music_lane` on hand-built shots + a fake matcher / injected
resolved times: anchors → correct segment boundaries · dry span carves a hole · gravity shot → no
segment · same-mood neighbors coalesce (one segment) · different-mood neighbors get a
`track_switch_gap_s` gap + fades · deterministic pool rotation (same input → same track) · empty
pool / absent file → dropped + `music_missing` incremented · **back-compat** (no cues → one
`casual-bed` full-length segment). Engine change validated by a real render + the B3 ear-gate (no
headless audio-DOM test — repo convention).

## 6. SUB-PROJECT B2 — `music-cue-writer` skill (fully specified)

Exact mirror of `audio-cue-writer` (`[[fix-generation-not-prohibitions]]` — critic + lint, not
self-checked rules; `[[skills-do-the-work]]`):

- **Reads:** `videos/<slug>/script.md` (register §2 — hot on money-absurdity, wry/sneaky on villainy,
  **dry on human cost**), `videos/<slug>/shots.json` (`chapter-boundary` shots = the natural section
  seams; `gravity` shots = keep-dry signal), `dna.md`, `music_pools` (available moods).
- **Authors:** `videos/<slug>/music-cues.json` — a **thin section plan** (~5–12 span cues + explicit
  `dry`), anchored to `chapter-boundary` `vo_ref` opening words. **Timid by default** (dry is a valid,
  common answer; a con-story defaults to `sneaky`, money-absurdity bits to `upbeat`, the workhorse to
  `casual-bed`, human cost to `dry`).
- **Flow:** grounded draft → **fresh-eyes critic** (new checks in `references/critics.md`: restraint /
  mood-fit-to-register / dry-on-human-cost / boundary-alignment / no-track-thrash) → **one** revise →
  **`lint_music_cues.py`** (reuses the one matcher; moods ∈ pools; anchors verbatim + in narration
  order; a cue that won't resolve at render fails here). Authors PLACEMENT; the **human ear-gates
  FEEL** on the render (`[[audio-taste-is-human-judged]]`).
- **Single-responsibility:** separate from `audio-cue-writer` (music = sustained sections; SFX =
  punctual hits). No overlap; no cue duplicated across the two files.

**B2 tests:** `lint_music_cues.py` hermetic tests (unresolved anchor fails · bad mood fails ·
out-of-order anchors fail · valid file passes), mirroring `test`-style lint coverage. The critic is
a fresh-context subagent (behavioral, not unit-tested).

## 7. SUB-PROJECT B3 — dogfood + ear-gate (the acceptance gate)

**Staged, two gates:**
1. **Mechanism gate — `_chain-test`** (deterministic, no VO dependency): `music-cue-writer` →
   `render-builder` → open in the Windows player (`[[review-video-in-device-player]]`). Proves the
   lane renders, segments place, dips inherit, track-switch gaps + fades work, back-compat holds.
2. **Acceptance ear-gate — a real script under real narration:** the `casual-bed` bucket is
   **PROVISIONAL** (the arc spec is explicit it can only be settled under real narration). Run the
   lane on a front-half script once it has VO + `shots.json` (Pearlman if available), ear-gate
   present-not-buried / placed / graceful track changes, and **settle `casual-bed` + tune
   `music_present_db` / `track_switch_gap_s` / `music_fade_s` by ear**. If no front-half script is
   render-ready, this is the **named follow-up**, not a 3B blocker.

`[[audio-taste-is-human-judged]]` — Claude runs the authoring + render; the feel verdict is the
user's.

## 8. File-sweep / anti-drift discipline (first-class tasks, per the explicit ask)

Baked into the plan as **real tasks + verification steps**, not footnotes:

- **Reconciliation task (integrate-don't-append):**
  - `universal.md §13a-iii.8` — correct the "bed is PLACED ~79%, wall-to-wall" / flat-bed language to
    the placed-lane model; the "shallower ~19 dB general dips" note must reflect that we deliberately
    do NOT generate them.
  - `components.tsx` — the `AudioBed` comment cites "the wall-to-wall bed of §13a-iii.8" (now false) —
    rewrite the comment WITH the logic.
  - `audio-tokens.json` — **resolve** `_bed_db_note` (flip to the lane model + delete the dangling
    "candidate change" note) and `_dip_db_note` (keep −40 full-stop; drop the generate-shallow-dips
    language). Don't leave both old + new.
  - `build_audio.py` — remove the `music_states: []` stub comment + the dead-bed path; update the
    module docstring (currently says "Scope today: V1 bed + ducking").
  - README + CLAUDE.md — bump skill count (13 → 14, `music-cue-writer`), cross-file-consistent
    (grep the count; verify against the current README list, don't trust this number blind).
- **Grep sweeps (verification steps in the plan):** after the change, `grep` the repo for
  `bed_db_under_vo`, `bed_default`, `"neutral"`, `wall-to-wall`, `music_states: []`, `GAP_LIFT_DB`,
  `AudioBed` → **zero stragglers** (or every hit is a deliberate historical note in decisions.md).
- **`curate-doc`** any file that has drifted (the audio handoff, the arc spec cross-refs).
- **Decisions + handoff:** one dated `decisions.md` entry (integrate, don't append a log pile); update
  the audio-workstream handoff `▶ RESUME` to point at Phase 4; bump `index.html` "Last updated".

## 9. PHASE 4 — deterministic audio checker (design + task outline)

**Nature (locked):** purely deterministic — **no model listening**. A general video/audio model
hallucinated the reference SFX inventory; the whole analysis arc exists because tools produce the
numbers. Phase 4 measures; any FEEL judgment stays the human ear-gate (`[[audio-taste-is-human-judged]]`).

**Shape:** `audio_checker.py`, run post-render by `render-builder`, **warn-not-fail** (writes an
`audio` block into `render.manifest.json`; a failing check is a loud warning, never a render abort —
the render already succeeded).

**Checks (deterministic; measured on `assets/final.mp4` audio + computed over the `audioSpec`):**
- **Loudness/peak:** integrated LUFS + true-peak within `master_target` (−15.5 LUFS / −1.0 dBTP /
  LRA 4) via ffmpeg `ebur128`/`loudnorm` print. (Phase 4 is where `master_target` first gets enforced.)
- **Gain budget:** worst-case simultaneous sum of VO + music present-level + concurrent SFX gains
  < 0 dBFS (static compute over the spec — catches a clip before it ships).
- **SFX↔VO collision:** an SFX `at_s` landing on a VO word onset (±Xms) that is NOT an intended
  `in_pause`/sync cue → flag.
- **SFX density:** events/min ≤ `sfx_per_min_story_max`.
- **Missing files = 0:** `sfx_missing == 0 && music_missing == 0` — **guards the A7 + B1 missing-file
  defenses from silently masking an unsourced role/mood in a real render.**
- **Register events present:** at least the expected structural evidence — a `gravity` beat produced
  a `thin_span`, a marked beat produced a dip. (Sanity that the register layer fired at all.)
- **Music-lane sanity:** no `music_states` segment overlaps a `dry`/`gravity` span; present level
  within a sane band; total music presence within a plausible % (not 0%, not 100%).

**Task outline (task-detailed later, after 3B ear-gate):**
- **C1** — `audio_checker.py` deterministic pass (measure final.mp4 + compute over spec) → an `audio`
  report dict. Hermetic tests on the pure computes (gain-budget sum, density, collision, missing,
  register-present) over hand-built specs; the ffmpeg loudness read exercised in a human `--smoke`.
- **C2** — seed a deliberate defect (a clipping mix / a repeated SFX / an unsourced mood) → the
  checker flags it (proves it isn't a rubber stamp).
- **C3** — wire into `render-builder` (write `render.manifest.json.audio`; warn-not-fail); doc + a
  dated `decisions.md` line.

## 10. Global constraints (guards — apply to every task)

- **G1 — Explicit-path commits.** Stage exact paths; never `git add -A`; never rewrite history.
  Parallel terminals share this tree (`[[parallel-terminals-stage-explicit-paths]]`).
- **G2 — Every checkpoint is a human EAR-GATE on real audio** (B3), or a taxonomy/scope approval.
  Claude runs the authoring/audition; the feel verdict is the user's (`[[audio-taste-is-human-judged]]`).
- **G3 — Data, not logic.** Mood→track (`music_pools`), present level, fades, switch gap, the default
  mood → DATA in `audio-tokens.json`. The realizer stays general; specifics tuned by ear in data.
- **G4 — One matcher, one timing path.** Anchors resolve via `render.match_shots_to_tokens` + `_NORM`.
  No second matcher, no second breath/timeline mechanism; the lane rides the existing dip/thin timeline.
- **G5 — Single-sourced schema.** `music-cues-schema.md` is the only home for field semantics; skills
  + lint point to it (`[[keep-docs-structured]]`). Integrate-don't-append on every doc edit.
- **G6 — Fix generation, not prohibitions.** The authored layer is guarded by a fresh-eyes critic + a
  mechanical lint, not self-checked "don't" rules (`[[fix-generation-not-prohibitions]]`).
- **G7 — Skills do the work.** Every artifact (library, cues, render) is produced by a skill; the
  `_chain-test` files stay fixtures/gold only (`[[skills-do-the-work]]`).
- **G8 — Back-compat + additive.** Absent `music-cues.json` → one present-level `casual-bed` segment,
  never a crash or regression. A missing track file → dropped + counted, never a broken render.
- **G9 — Cost-modest, goal-anchored.** Free/CC-BY monetization-safe libraries, reused across videos;
  spend near zero. This serves retention→revenue (music is *the* entertainment lever for
  comedic-history).

## 11. Sequencing

**B1 (realizer + engine) → B2 (`music-cue-writer`) → B3 (dogfood/ear-gate) → §8 reconciliation/sweep
→ Phase 4 (later arc).** B1 first because the engine + `music_states` contract must exist before a
cue file has anything to drive, and back-compat lets B1 be validated on the default lane before any
authoring exists. The §8 sweep runs as the closing task of 3B (so the docs reflect the shipped
reality), with per-task grep checks throughout. Phase 4 is task-detailed in its own plan once the B3
ear-gate settles the lane.

## 12. Self-review (author, against the requirements)

- **Placeholders:** none in 3B (task-plan altitude, buildable). Phase 4 is an explicit design +
  outline with a named re-plan trigger (3B ear-gate) — a stated taper, not a TODO.
- **Consistency:** mirrors the 2a/2b split throughout (structural auto + authored content + critic +
  lint + ear-gate); reuses the one matcher, the dip/full-stop timeline, the pool-rotation idiom, the
  missing-file defense, the audition/critic patterns. `music_states` already reserved in `audioSpec`.
- **Taste calls surfaced + approved:** constant present level (no per-phrase duck); no 19 dB
  frequent dips; track switch = fade→gap→fade (not crossfade); same-mood coalesce. All ruled on by
  the user.
- **Anti-drift:** the dead-bed path, the false "wall-to-wall" comments, and the dangling token notes
  are removed via a first-class reconciliation task + grep sweeps — the explicit ask.
- **Scope:** 3B = one implementation plan's worth; Phase 4 correctly deferred to its own plan.
- **Ambiguity:** "present level" pinned to `music_present_db` (ear-tuned, not the old 14); "placed"
  pinned to authored `dry` + track-switch gaps + `gravity`; "mood" pinned to `music_pools` buckets
  (data); "drops" pinned to exactly the three cases in §3.
```