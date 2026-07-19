# Phase 3 — Active Music Lane Arc — Design

**Date:** 2026-07-11 · **Status:** brainstormed, approved (design shape). **Scope:** the full Phase 3 arc
of the audio workstream — replacing the flat, buried, single-looped placeholder bed with a **placed music
lane** grounded in the measured reference behavior. This spec is **full-breadth but altitude-tapered**:
sub-project A (music sourcing) is fully specified; sub-project B (the lane realizer + authored placement)
is specified to the interface/design level, its task-plan re-planned the moment A's mood taxonomy locks
(the only real upstream dependency). Phase 4 (audio checker) is out of scope — the next arc.

Predecessors: `2026-07-10-audio-reference-analysis-and-emission-arc-design.md` (the arc this continues) ·
`2026-07-11-sfx-emission-2b-authored-cues-design.md` (the 2a/2b split this mirrors).

---

## Why this exists

The SFX layers (2a structural + 2b authored cues) are built and ear-gated, but the **music is a flat
placeholder**: one bed mp3, looped, held at a constant, over-attenuated level under the whole video. The
reference channels do none of that. Before Phase 1 we would have guessed at the fix; now we have the
measured model (`visual-kit/research/audio-logs/synthesis.md`, 8 videos), and it points somewhere specific.

### The measured model (how the references actually run non-SFX audio)

Target set = the comedic-history channels (OverSimplified / Crayon / HeyHistorically). Kurzgesagt is the
restrained *floor*, explicitly excluded.

- **Music is PLACED, not wall-to-wall.** Presence ~**62–85%** of runtime for our targets (OverSimplified
  prohibition 61.5% · cold-war 62.3% · WW2 80.8% · Crayon 72–85% · HeyHistorically 85%). So **15–40% of the
  video has no music at all** — music enters and exits by section; passages play dry (VO + SFX only). Only
  the excluded floor (Kurzgesagt) runs near-continuous (94%).
- **When playing, music sits PRESENT under the voice — it barely ducks.** Ducking depth ~**2–3 dB**
  (trusted median 1.9). The bed is a clearly audible musical presence, dropping only slightly under speech.
  **The current `bed_db_under_vo = 14` is 5–7× too much attenuation** — the root cause of "buried."
- **Music breathes constantly — frequent on-beat dips.** Dips are NOT rare dramatic events (Crayon-Rockefeller
  227 dips / 20 min ≈ one per 5s; OverSimplified-Prohibition 370). Depth ~**16–26 dB** (median 19). In the
  comedic channels **~30–50% of dips land on a punchline/reveal** — the dip *is* the emphasis mechanism.
- **The full-stop.** On marked beats (number-reveal, act turn) music + SFX + VO drop to silence *together*,
  then resume. Already built as the −40 dip on `breath_gaps`; the references just lean on it harder.
- **Loudness.** References sit ~−18 LUFS but CLIP (true-peak often >0). Our master target already holds
  headroom: −15.5 LUFS / −1.0 dBTP / LRA 4 (`audio-tokens.json master_target`; enforced in Phase 4).

**Consequence:** the primitive is wrong. Not "tune the bed level" — replace the constant-looped-bed with a
**timeline of placed music cues**: per-section tracks (some sections dry), present under VO, dipping on
beats, full-stopping on marked beats, changing track at boundaries.

---

## The decision: authored placement, not structural

### The finding that forces it

Structural placement needs a signal for a section's *sustained mood/tone*. **No such signal exists in
structured data:**

- `shots.json` has **no chapter/section grouping and no mood field**. `beat_type` is per-shot and
  *treatment*-oriented (narration / enumeration-within / gravity / number-reveal / cold-open …) — it
  describes how to punctuate a *moment*, not the tone of a multi-minute stretch.
- **"Register" (the mood dial) lives only as prose doctrine** (`storytelling-grammar.md §2`: hot on
  money-absurdity, wry on villainy, off on human cost) — never as machine-readable data.

So a purely structural engine **cannot pick a fitting track** — a chapter could be a comedic caper or a
somber human-cost passage, and `beat_type`/`chapter-boundary` won't say which. **Choosing the mood for a
stretch is inherently a content judgment.** This is forced by the data model, not a preference.

### What we build: a dumb realizer + a THIN authored section plan

Mirror the proven 2a/2b split (structural auto-fire + authored content layer + fresh-eyes critic + lint +
human ear-gate):

- **The authored file (`music-cues.json`) is a short *section plan*, not a dense cue list.** Music decisions
  per video are few (~5–12), unlike per-word SFX. Each cue is a **span**: `{from_anchor, mood, level?}` plus
  explicit "go dry here" gaps, anchored to VO phrases via the **same `vo_ref` matcher** already built
  (typically anchored at `chapter-boundary` shots). The only thing authored: **which mood plays over which
  stretch, and where silence.**
- **The engine does everything mechanical automatically**, and critically **inherits the beat machinery we
  already built**: the on-beat dips (~20 dB) and full-stops (−40) already fire on a shared timeline, so
  whatever track is playing rides those same dips — we do **not** re-author them for music. New engine work
  is only: present-level ducking (~2–3 dB, not 14), crossfade at cue boundaries, and loop-to-fit a section.
- **Structural assists stay automatic** (no authoring): `gravity`/human-cost → music thins or drops (extends
  the existing `thin_spans`); `chapter-boundary` gives section *boundaries* for free.
- **Mood→track is DATA, not logic:** a `music_pools` map in `audio-tokens.json` (mood-bucket → [track files]),
  filled by the sourcing skill, rotated by the realizer exactly like `sfx_pools`.

### Why not the alternatives

- **Pure structural** — dead on arrival: cannot pick mood (the finding above).
- **A unified per-chapter `register` field threaded through writer → VPW → shots** — elegant (music, camera,
  and register key off one signal) but bigger, riskier, and over-couples three concerns onto one field before
  we know we need it (YAGNI). The isolated `music-cues.json` layer is self-contained; unify later only if it
  proves redundant. **Documented as a future option, not built now.**

---

## Architecture (the three pieces + data flow)

```
[A · music-forge skill]  fetch by mood brief → vet (loop/tempo/LUFS/license) → CLAP-rank → audition board
        │  HUMAN ear-gate picks per bucket
        ▼
   audio-tokens.json  music_pools{ mood → [track files] }   +   audio/beds/*.mp3   +   manifest/attribution
        │  (DATA — the realizer is file-agnostic, rotates a pool like sfx_pools)
        ▼
[B2 · music-cue-writer skill]  reads script register + shots.json chapter-boundary structure
        │  authors videos/<slug>/music-cues.json  = { cues:[ {from_anchor, mood, level?} … ], dry:[…] }
        │  fresh-eyes critic → revise → lint_music_cues.py (reuses the ONE vo_ref matcher)
        ▼
[B1 · realizer]  build_audio.build_music_lane(cues, shots, tokens, words)
        │  → music_states[] : placed segments {track, at_s, dur_s, base_db, fade_in_s, fade_out_s}
        │  present-level duck under VO · crossfade at boundaries · loop-to-fit · gravity→dry
        │  dips + full-stops INHERITED from the existing breath/beat timeline (not re-authored)
        ▼
[engine AudioBed]  plays music_states as a lane (per-frame volume automation, MIN across lanes)
```

Today's `audioSpec` already carries `music_states: []` (stubbed) — B fills it. The engine's `AudioBed`
today plays a single `bed` src; B generalizes it to render the `music_states` segment list.

---

## SUB-PROJECT A — Music sourcing (`music-forge`) *(fully specified)*

### Goal
A niche-agnostic skill in the `sfx-forge` mold that builds the channel's **mood-tagged music library** and
wires it into `audio-tokens.json music_pools`. Claude runs a real audition (fetch → objective vet → CLAP
rank → shortlist); the **human ear-gates the feel** per bucket.

### A1 — Mood-bucket taxonomy *(checkpoint)*
Define the channel's music moods, grounded in `storytelling-grammar.md §2` register + the reference. The
music is the **Crayon-Capital casual-comedic idiom** — a light quirky groove that rides under narration —
**NOT cinematic scoring** (no tension-build / somber-orchestral / triumphant-fanfare; those were the movie
model, rejected). So a small casual set: **casual-bed** (the default light wry walking-pace groove, the
workhorse) · **upbeat** (energetic playful lift for fun/absurd money bits) · **sneaky** (light comedic
tiptoe/mischief for the "here's the con" stretches) · **dry** (human cost → no music, not a bucket). Kept
small (3 + dry) — reused across videos = the channel's sonic signature. **🔒 CHECKPOINT: user approves the
buckets.** Locking this also unlocks sub-project B's task-plan (the only real A→B dependency).

### A2 — Build `music-forge`
Source-agnostic core (`board` / `pick` over `audio/incoming/<bucket>/`) fed by fetchers:
- **fetch** — **source SETTLED 2026-07-11:** a spike proved **Freesound is the wrong catalog** (rich in
  lo-fi/cinematic, empty on the quirky-comedic-production idiom Crayon uses). The right catalog is
  **Incompetech (Kevin MacLeod, CC-BY)** — direct-mp3-downloadable (`…/mp3-royaltyfree/<Track>.mp3`,
  verified), with a "Feel: Humorous/Bouncy" catalog; `fetch_incompetech.py` pulls curated seed tracks per
  bucket. **YouTube Audio Library** ("Comedy" mood, no-attribution) is reachable by manual drop into the same
  `incoming/` folder. License = CC-BY/CC0 only; NC excluded; the CC-BY credit line is captured in `pick`.
- **vet (objective, deterministic)** — tempo/energy (librosa), integrated LUFS + dynamics (ffmpeg ebur128),
  duration ≥ a usable section length, **loop-ability** (seam continuity — energy/spectral match at head vs
  tail), reject clipped/over-compressed.
- **rank** — CLAP (reuse the `sfx-forge` stack, `laion/clap-htsat-unfused`) semantic match of the full clip
  against the bucket's mood text → shortlist ~5/bucket. (CLAP is *stronger* on full music clips than on the
  sub-second SFX transients we flagged directional — but findings still carry a confidence note.)
- **board** — an audition artifact per bucket (samples + measured descriptors + why-ranked), same format as
  the SFX audition boards. Filenames lead with the distinguishing part (register truncates common prefixes).
- **pick** — normalize the human's chosen track(s), write into `audio/beds/<mood>-N.mp3`, register in
  `audio-tokens.json music_pools`, `audio/manifest.json`, `audio/attribution.txt`.

**TDD:** hermetic tests on the mechanical parts (loop-seam metric on a synthesized loop vs a hard-cut clip;
LUFS of a −20 tone ≈ −20; duration/license filters). No live network / no CLAP in the unit suite.

### A3 — Run → audition → pick *(checkpoint)*
Run per bucket → boards. **🔒 CHECKPOINT (ear-gate): the user picks the track(s) per bucket** — this is where
the **channel's music identity is approved**. [[audio-taste-is-human-judged]]

### A4 — Wire + register
Picks → `music_pools` + `manifest.json` + `attribution.txt`. Register the skill in `.claude/skills/README.md`
+ `CLAUDE.md` (bump count, cross-file-consistent). **Guards:** data-not-logic; integrate-don't-append;
explicit-path commit.

---

## SUB-PROJECT B — The lane (realizer + authored placement) *(design-to-interface)*

Re-brainstormed and task-planned once the A1 taxonomy locks. Interfaces fixed here so A doesn't strand B.

### B1 — `music-cues.json` schema + the realizer
- **Contract doc** `render-builder/references/music-cues-schema.md` (single-sourced; the skill POINTS to it).
  Shape (draft): `{ "cues": [ {"from_anchor": "<verbatim VO phrase>", "mood": "<bucket>", "level_db"?: n},
  … ], "dry": [ {"from_anchor": "…", "to_anchor"?: "…"} ] }`. `from_anchor` resolved by the shared
  `vo_ref` matcher; a cue runs until the next cue/dry span. **Validity:** every `mood` ∈ `music_pools`;
  anchors verbatim + in narration order.
- **Realizer** `build_audio.build_music_lane(cues, shots, tokens, words) → music_states[]`
  (`{track, at_s, dur_s, base_db, fade_in_s, fade_out_s}`): resolve anchors → segment boundaries; pick a
  track per segment from `music_pools[mood]` (deterministic rotation); **loop-to-fit** the segment length;
  `base_db` = the present-under-VO level (measured ~2–3 dB duck, ear-tuned — replaces `bed_db_under_vo = 14`);
  **crossfade** at boundaries (`fade_*_s`); `dry` spans + `gravity` shots → no segment.
- **Engine** `AudioBed` generalized from one `bed` to render `music_states` (per-frame volume automation,
  MIN across dips/thins as today). **Dips + full-stops are INHERITED** — the existing `dips`/`thin_spans`
  timeline already lowers whatever plays; the lane needs no dip logic of its own.
- **Guards:** reuse the ONE `vo_ref` matcher (no second timing path); deterministic; back-compat (no
  `music-cues.json` → a single default-mood bed, i.e. today's behavior but at the corrected present level).

### B2 — `music-cue-writer` skill
Authors `music-cues.json` grounded in the script's register (§2) + `shots.json` `chapter-boundary` structure:
segment the video at chapter boundaries, assign each segment a mood (or `dry`), keep human-cost dry. **Fresh-eyes
critic** (`references/critics.md`: restraint / mood-fit / dry-on-human-cost / boundary-alignment) → one revise →
**`lint_music_cues.py`** (mirrors the matcher; validates moods ∈ pools, anchors resolve in order). Timid by
default (dry is a valid, common answer). **Guards:** [[fix-generation-not-prohibitions]] (critic+lint, not
self-checked rules); [[derived-fields-not-generation-targets]]; single-responsibility (separate from
`audio-cue-writer` — music = sustained sections; SFX = punctual hits; final split confirmed at B0).

### B3 — Dogfood *(checkpoint)*
On `_chain-test`: `music-cue-writer` → `render-builder` → open in the Windows player ([[review-video-in-device-player]]).
**🔒 CHECKPOINT (ear-gate): the user judges the whole music lane in context** — present-not-buried, placed
(dry stretches), dips on beats, full-stops, graceful track changes.

### B4 — Register + docs
Register the skill (README + CLAUDE.md); log `decisions.md`; update the audio handoff + `index.html`;
`curate-doc` anything that drifted; `verification-before-completion` before done.

---

## Global constraints (guards — apply to every step)

- **G1 — Explicit-path commits.** Stage exact paths; never `git add -A`; never rewrite history. Parallel
  terminals share this tree ([[parallel-terminals-stage-explicit-paths]]).
- **G2 — Every checkpoint is a human EAR-GATE (or taxonomy approval) on real audio.** Claude runs the
  audition/authoring; the feel/fit verdict is the user's ([[audio-taste-is-human-judged]]).
- **G3 — Data, not logic.** Mood→track (`music_pools`), levels, fade lengths, the mood taxonomy → DATA in
  `audio-tokens.json`. The realizer stays general; specifics are tuned in data by ear.
- **G4 — One matcher, one timing path.** Anchors resolve via the shared `render.match_shots_to_tokens` +
  `_NORM`. No second matcher, no second breath/timeline mechanism.
- **G5 — Single-sourced schema.** Field semantics live once in `music-cues-schema.md`; skills point to it,
  never copy ([[keep-docs-structured]]). Integrate-don't-append on every doc edit.
- **G6 — Fix generation, not prohibitions.** The authored layer is guarded by a fresh-eyes critic + a
  mechanical lint, not a wall of self-checked "don't" rules ([[fix-generation-not-prohibitions]]).
- **G7 — Skills do the work.** Every artifact (library, cues, render) is produced by a skill; no hand-authored
  one-offs. The `_chain-test` files stay fixtures/gold only ([[skills-do-the-work]]).
- **G8 — Back-compat + additive.** Absent `music-cues.json` → a clean default (one present-level bed), never a
  crash or a regression. A missing track file is dropped + counted, never a broken render.
- **G9 — Cost-modest, goal-anchored.** Free/CC monetization-safe libraries, reused across videos. This serves
  retention→revenue (music is *the* entertainment lever for comedic-history); keep spend near zero.

## Sequencing / taper

**A first, then B.** A is the prerequisite (nothing to place without tracks), the most proven pattern
(near-clone of `sfx-forge`), and the piece that gets the **channel music identity** approved. **A1 (taxonomy)
is the only real A→B dependency** — once it locks, B's task-plan is written; B's *dogfood* still waits for A's
finished library. Phase 4 (audio checker) is the next arc, not this one.

## Testing / validation

- **A:** hermetic unit tests on loop-seam / LUFS / duration / license filters. Sanity gate: a real fetched
  track's measured LUFS matches an independent ffmpeg read.
- **B:** hermetic tests on the realizer (anchors → segments; loop-to-fit length; rotation determinism;
  crossfade math; dry/gravity → no segment; back-compat default). Lint tests mirror the `lint_audio_cues`
  pattern (unresolved anchor / bad mood / out-of-order fail).
- **Both:** the load-bearing gate is the **human ear-gate** at A3 and B3 on real audio in the player.

## Self-review

- **Placeholders:** none. A fully specified; B specified to the interface with its re-plan trigger named
  (A1 taxonomy lock) — a stated taper, not a TODO.
- **Consistency:** mirrors the 2a/2b split throughout (structural auto + authored content + critic + lint +
  ear-gate); reuses the one matcher, the dip/full-stop timeline, the pool-rotation idiom, the audition-board
  pattern; `music_states` already reserved in `audioSpec`.
- **Scope:** two sub-projects, each one implementation-plan's worth. Phase 4 correctly deferred.
- **Ambiguity:** "present level" pinned to the measured ~2–3 dB duck (ear-tuned in data), not the old 14;
  "placed" pinned to authored `dry` spans + `gravity`; "mood" pinned to `music_pools` buckets (data), not a
  guessed field.
</content>
</invoke>
