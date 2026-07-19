# Transition-Breath — beat_type-driven render-time pause + audio — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** At render time, insert a deliberate **breath** (a silence gap) before the shots whose `beat_type` calls for one (`number-reveal`, `chapter-boundary` to start), with the gap length + the sound that fills it driven **entirely by the beat_type table** — so a reveal lands with a real beat of silence + a bed dip, without the writer authoring anything and without `voiceover.py` changing.

**Architecture:** The manual `[PAUSE]`/`[BEAT]` prosody stays baked in the VO (voiceover unchanged). A new **render-time** step (`breath.py`, called by `build_motion`) reads each shot's `beat_type`, finds its first VO word in the word-timings via the shared `render.py` matcher, and — for a breath-beat — **splices `breath_s` of silence into a *derived* `vo.breath.mp3`** and **shifts the word-timings after that point** by `breath_s`. Everything downstream (retime, captions, `build_audio`) reads the shifted timings + plays the gapped mp3, so the frame holds across the gap and `build_audio` lands the dip **in** the gap (re-enabling the number-reveal dip we deferred). `voiceover.py` and its outputs are never touched.

**Tech Stack:** Python 3 (`py -3` native on Windows), stdlib `assert` tests, ffmpeg (silence splice), the local Remotion engine (plays the gapped mp3 — no engine change).

**Depends on / relates to:** the `beat_type` seam (`2026-07-09-beat-type-seam-camera-and-audio.md`, built) which this extends; the audio-workstream handoff (this is the "transition-breath" item + it re-enables the deferred number-reveal dip). **A2 (SFX-pool expansion) is a SEPARATE follow-on** — A1 ships the *gap + bed dip + existing whoosh*; the richer buildup sounds (riser/boom/hit) that fill the gap come with A2.

---

## Global Constraints (trap-avoidance — the user asked for this explicitly)

- **ONE config home.** The breath *intent* (which beats, what happens) is documented in `universal.md §13a-iii`; the tunable *numbers* (`breath_s` per beat) live in `audio-tokens.json` only (same split as `dip_db`/`thin_extra_db`). Do NOT duplicate the numbers in `motion-tokens.json`, the schema, or code literals.
- **NOT a parallel pause system.** The manual `[PAUSE]`/`[BEAT]` markers (voiceover prosody) are untouched and stay the writer's tool. The breath is a *distinct, render-time, beat_type-driven* layer. Every doc must state the two are separate so no future reader conflates them.
- **voiceover.py and its outputs are READ-ONLY here.** The breath derives a NEW `assets/vo.breath.mp3` + in-memory shifted timings for THIS render; it never rewrites `vo.mp3` or `voiceover.manifest.json`. voiceover gains no dependency on `shots.json`.
- **Deterministic + idempotent.** Always derive the breath from the ORIGINAL `vo.mp3` + original manifest word-timings (never from an already-gapped file). Same inputs → same `vo.breath.mp3`. No `random`, no wall-clock.
- **Single offset point.** The word-timings are shifted in exactly ONE place (`breath.py`, in `build_piece_spec`); every downstream consumer (retime, `captions.words`, `build_audio`) reads the already-shifted list. Never let two consumers each apply the offset (double-shift bug).
- **Additive + safe when absent.** No breath-beats, no `breath_s`, no `vo.mp3`, or `--no-audio` → the step is a no-op and render is byte-for-byte what it is today. A missing ffmpeg → warn + fall back to the un-gapped VO (breath is additive, never a hard render failure).
- **Parallel terminals:** stage explicit paths; never `git add -A`; never rewrite history. Leave the other terminal's `long-form-writer`/`researcher`/`_pearlman`/`bricks` files alone.
- **Paths:** render scripts `.claude/skills/render-builder/scripts/`. Channel dials `channels/the-second-take/visual-kit/audio-tokens.json`. Test bed `_chain-test` (its L11 = `gravity`, L19 = `number-reveal`).

---

## Design decisions (locked; review at plan approval)

**D1 — Render-time insertion (not voiceover).** The breath is produced at render by `build_motion`→`breath.py`. voiceover stays independent. This is the ONLY design that lets `beat_type` (in `shots.json`) drive the gap while keeping voiceover free of `shots.json`.

**D2 — Config split.** `§13a-iii` documents the breath per beat (intent); `audio-tokens.json` gets a `breath_s_by_beat` map (data) — the single iteration surface. Default when a beat isn't listed: no breath.

**D3 — Initial breath set: `number-reveal` + `chapter-boundary`.** Everything else = no breath. Tunable/expandable purely by editing the `audio-tokens.json` map + the table (no code change to add a beat once the mechanism exists).

**D4 — The gap sits BEFORE the breath-shot's cut.** Silence lands on the *outgoing* frame; the cut to the reveal lands on the reveal's first (shifted) word. (Chapter-card "cut then hold" is a later refinement — start with before-cut for both; it's a one-line placement change.)

**D5 — The number-reveal dip is RE-ENABLED, scoped to the gap.** `build_audio` emits a dip covering exactly the breath gap (bed → near-silence during the real silence). This is the payoff the deferred dip was waiting for.

**D6 — A1 audible payoff = the gap + bed dip (+ existing whoosh on chapter).** The riser-buildup / boom / hit that would further fill the gap need SFX assets we don't have (pool is whoosh-only) → **A2**. A1 is complete and demonstrable without them (a silent beat + dip before a reveal is the core effect); A2 enriches later.

---

## File Structure

- **Create** `.claude/skills/render-builder/scripts/breath.py` — the breath realizer: `breath_gaps(...)`, `shift_timings(...)`, `splice_silence(...)`. One responsibility: turn shots+timings+config into (shifted timings, gap list, gapped-mp3).
- **Create** `.claude/skills/render-builder/scripts/test_breath.py` — unit tests (plain-assert).
- **Modify** `.claude/skills/render-builder/scripts/build_motion.py` — call `breath.py` in `build_piece_spec` (shifted timings + `vo.breath.mp3` + pass gaps to `build_audio`).
- **Modify** `.claude/skills/render-builder/scripts/build_audio.py` — accept `breath_gaps`; emit the gap dips (re-enable number-reveal dip).
- **Modify** `.claude/skills/render-builder/scripts/test_build_audio.py` — dip-in-gap test.
- **Modify** `channels/the-second-take/visual-kit/audio-tokens.json` — `breath_s_by_beat` map.
- **Modify** `knowledge/research/niche-playbooks/universal.md §13a-iii` — document the breath (intent) in the treatment table.
- **Modify** `.claude/skills/render-builder/references/motion-schema.md` — the breath step + `vo.breath.mp3` + shifted-timings note.
- **Modify** `CLAUDE.md` + `knowledge/decisions.md` + `docs/handoffs/2026-07-09-audio-workstream-pause-resume.md` — status/decision/handoff.

---

## Stage 1 — Breath config (the one iteration surface)

### Task 1.1: `audio-tokens.json` breath map + `§13a-iii` intent

**Files:**
- Modify: `channels/the-second-take/visual-kit/audio-tokens.json`
- Modify: `knowledge/research/niche-playbooks/universal.md` (§13a-iii table)

- [ ] **Step 1:** Add to `audio-tokens.json`: `"breath_s_by_beat": { "number-reveal": 0.9, "chapter-boundary": 1.2 }` with a one-line `_breath_note` that this is the render-inserted deliberate pause (separate from the writer's `[PAUSE]` prosody), the single place to tune breath lengths.
- [ ] **Step 2:** In `§13a-iii`, add a short paragraph under the treatment table: the render inserts a `beat_type`-driven **breath** (a silence gap) before `number-reveal`/`chapter-boundary` shots — length from `audio-tokens.json breath_s_by_beat` — into which the dip/boom lands; it is DISTINCT from the manual `[PAUSE]`/`[BEAT]` prosody (which stays in the VO). One home; don't restate the numbers.
- [ ] **Step 3: Commit** `git add channels/the-second-take/visual-kit/audio-tokens.json knowledge/research/niche-playbooks/universal.md && git commit -m "feat(audio): beat_type breath config — breath_s_by_beat + §13a-iii intent (A1)"`

> **CHECKPOINT (author review):** the two breath beats + lengths read right before anything consumes them.

---

## Stage 2 — The breath mechanism (gap + shifted timings + spliced VO)

### Task 2.1: `breath.py` — gaps + timing shift (pure, TDD)

**Files:**
- Create: `.claude/skills/render-builder/scripts/breath.py`
- Create: `.claude/skills/render-builder/scripts/test_breath.py`

**Interfaces:**
- Produces:
  - `breath_gaps(shots, word_timings, breath_s_by_beat) -> list[{shot_id, beat_type, at_s, dur_s}]` — for each shot whose `beat_type` is in the map, find its first vo_ref word's time via `render.match_shots_to_tokens`, and emit a gap at that ORIGINAL time. `at_s` is the NEW-timeline gap start (= original time, since earlier words don't move); returned in narration order.
  - `shift_timings(word_timings, gaps) -> list[[word, start]]` — every word at/after a gap's `at_s` shifts later by that gap's `dur_s` (cumulative over multiple gaps).

- [ ] **Step 1: Write failing tests:**
```python
import sys; from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from breath import breath_gaps, shift_timings

WT = [["The", 0.0], ["deal", 0.3], ["was", 0.6], ["Eight", 1.0], ["million", 1.4], ["acres", 1.8]]
SHOTS = [{"id": "L1", "beat_type": "narration", "vo_ref": "The deal was"},
         {"id": "L2", "beat_type": "number-reveal", "vo_ref": "Eight million acres"}]

def test_gap_only_on_breath_beat_at_its_first_word():
    g = breath_gaps(SHOTS, WT, {"number-reveal": 0.9})
    assert len(g) == 1 and g[0]["shot_id"] == "L2" and g[0]["at_s"] == 1.0 and g[0]["dur_s"] == 0.9

def test_shift_pushes_words_after_the_gap():
    g = breath_gaps(SHOTS, WT, {"number-reveal": 0.9})
    s = shift_timings(WT, g)
    assert s[2] == ["was", 0.6]          # before the gap — unmoved
    assert s[3] == ["Eight", 1.9]        # 1.0 + 0.9 breath
    assert s[5] == ["acres", 2.7]

def test_no_breath_beats_is_noop():
    assert breath_gaps(SHOTS, WT, {}) == []
    assert shift_timings(WT, []) == WT
print("running"); test_gap_only_on_breath_beat_at_its_first_word(); test_shift_pushes_words_after_the_gap(); test_no_breath_beats_is_noop(); print("PASS")
```
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** `breath_gaps` (import `match_shots_to_tokens`, `_NORM` from `render`; normalize word-timings to `(norm, idx)`, match each shot's vo_ref, map a matched breath-beat shot → a gap at `float(word_timings[idx][1])`; skip shots whose `beat_type` isn't in the map or whose match is None) and `shift_timings` (for each `[w, t]`, add the total `dur_s` of gaps whose `at_s <= t`).
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `git add .claude/skills/render-builder/scripts/breath.py .claude/skills/render-builder/scripts/test_breath.py && git commit -m "feat(breath): beat_type breath gaps + timing shift (pure) (A1)"`

### Task 2.2: `breath.py` — the ffmpeg silence splice

**Files:**
- Modify: `.claude/skills/render-builder/scripts/breath.py`

**Interfaces:**
- Produces: `splice_silence(vo_path: Path, gaps: list, out_path: Path) -> bool` — writes a copy of `vo_path` with `dur_s` of silence inserted at each gap's ORIGINAL time (= `at_s`); returns True on success, False (leave `out_path` absent) on ffmpeg failure/absence. Idempotent (always reads `vo_path`, the original).

- [ ] **Step 1: Implement** with a single ffmpeg `filter_complex`: split the source into segments at the gap boundaries (`atrim`/`asetpts`), generate `anullsrc`/`aevalsrc` silence of each `dur_s`, and `concat` segments+silences in order → `out_path` (48 kHz, same codec). No gaps → just copy. Wrap in try/except; on `FileNotFoundError`/non-zero exit, `sys.stderr.write` a warning and return False.
- [ ] **Step 2: Manual integration test** on the real slice VO (produces audible silence at ~L19):
```bash
py -3 -c "import sys;sys.path.insert(0,r'.claude/skills/render-builder/scripts');from pathlib import Path;import json,breath;d=r'channels/the-second-take/videos/_chain-test';wt=json.load(open(d+'/assets/voiceover.manifest.json'))['pieces'][0]['word_timings'];import json as j;sh=json.load(open(d+'/shots.json'))['long_form']['shots'];g=breath.breath_gaps(sh,wt,{'number-reveal':0.9});print('gaps',g);print('spliced',breath.splice_silence(Path(d+'/assets/vo.mp3'),g,Path(d+'/assets/vo.breath.mp3')))"
```
Expected: one gap at ~L19; `vo.breath.mp3` written ~0.9s longer than `vo.mp3`.
- [ ] **Step 3: Commit** `git add .claude/skills/render-builder/scripts/breath.py && git commit -m "feat(breath): ffmpeg silence-splice into a derived vo.breath.mp3 (A1)"`

### Task 2.3: Wire the breath into `build_motion.build_piece_spec`

**Files:**
- Modify: `.claude/skills/render-builder/scripts/build_motion.py`

**Interfaces:**
- Consumes: `breath.breath_gaps/shift_timings/splice_silence`, `audio_tokens["breath_s_by_beat"]`.
- Produces: `build_piece_spec` uses shifted `word_timings` + `vo_s += Σdur` + `audio_rel = vo.breath.mp3` (when spliced) + passes `breath_gaps` to `build_audio_spec`.

- [ ] **Step 1:** After loading `word_timings`/`vo_s` (line ~179) and `audio_tokens`, compute gaps and shift — BEFORE `retime_by_timings`:
```python
from breath import breath_gaps, shift_timings, splice_silence   # top of file
# ... in build_piece_spec, after word_timings + audio_tokens load, before retime:
audio_tokens = load_audio_tokens(video_dir)
gaps = []
if not args.no_audio and word_timings:
    gaps = breath_gaps(shots, word_timings, (audio_tokens or {}).get("breath_s_by_beat") or {})
    if gaps:
        word_timings = shift_timings(word_timings, gaps)
        vo_s = (vo_s or 0.0) + sum(g["dur_s"] for g in gaps)
```
- [ ] **Step 2:** When a real VO exists and gaps were found, splice + point `audio_rel` at the gapped file:
```python
vo_path = vo_audio_path(video_dir, piece)
audio_rel = None
if vo_path.exists():
    used = vo_path
    if gaps and not args.dry_run:
        breathed = vo_path.with_name(vo_path.stem + ".breath.mp3")
        if splice_silence(vo_path, gaps, breathed):
            used = breathed
    audio_rel = str(used.relative_to(assets_dir)).replace("\\", "/")
```
- [ ] **Step 3:** Pass gaps into audio: `build_audio_spec(spec["shots"], audio_tokens, word_timings or [], has_vo=bool(audio_rel), breath_gaps=gaps)` (Task 3.1 adds the param). Add `"breath_count": len(gaps)` to `meta["audio"]` + the per-piece print.
- [ ] **Step 4: Dry-run** `py -3 .../build_motion.py <_chain-test> --dry-run` → the motion.json's `captions.words` show L19's words shifted ~0.9s later; `audio_seconds` grew ~0.9s; `breath_count: 1`. **FRAME-HOLD CHECK (the user's concern):** confirm the shot *immediately before* L19 gained ~`breath_s` in its `duration_s` (a duration floor / `_renormalize_to_vo` did NOT eat the gap) — that expanded duration IS the held frame across the silence. If it didn't expand, STOP and fix the retime before Stage 3.
- [ ] **Step 5: Commit** `git add .claude/skills/render-builder/scripts/build_motion.py && git commit -m "feat(motion): insert beat_type breaths at render — shifted timings + vo.breath.mp3 (A1)"`

### Task 2.4: Render + breath checkpoint (silence only, dip comes next)

- [ ] **Step 1:** `py -3 .../build_motion.py <_chain-test>` → open `assets/final.mp4` in the **device player** (audio review — not VS Code).

> **HUMAN CHECKPOINT:** at the "Eight million acres" reveal there's now a real ~0.9s beat of silence before the line, and the outgoing frame holds across it (cut lands after the silence). Everything else unchanged. Confirm the gap length feels right (tune `breath_s_by_beat`), then proceed to the dip.

---

## Stage 3 — Land the dip in the gap (re-enable the number-reveal dip)

### Task 3.1: `build_audio` emits the gap dip

**Files:**
- Modify: `.claude/skills/render-builder/scripts/build_audio.py`
- Modify: `.claude/skills/render-builder/scripts/test_build_audio.py`

**Interfaces:**
- Consumes: `build_audio_spec(..., breath_gaps=None)`.
- Produces: a dip covering each `number-reveal` gap (`{at_s, depth_db, dur_s}`), replacing the previously-deferred (empty) dips.

- [ ] **Step 1: Write failing test:**
```python
def test_number_reveal_gap_gets_a_dip():
    spec = build_audio_spec(shots=[{"id":"L1","start_s":0,"duration_s":2,"beat_type":"number-reveal"}],
                            tokens={"bed_default":"neutral","dip_db":-40}, words=[], has_vo=True,
                            breath_gaps=[{"shot_id":"L1","beat_type":"number-reveal","at_s":5.0,"dur_s":0.9}])
    assert spec["dips"] == [{"at_s":5.0,"depth_db":-40,"dur_s":0.9}], spec["dips"]
```
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement:** add `breath_gaps=None` to `build_audio_spec`; build `dips = [{"at_s":g["at_s"],"depth_db":float(t.get("dip_db",-40)),"dur_s":g["dur_s"]} for g in (breath_gaps or []) if g["beat_type"]=="number-reveal"]`; set `"dips": dips`. Update the module note: the number-reveal dip is now LIVE (it lands in the render-inserted breath gap) — no longer deferred. (chapter-boundary gap: leave for A2's boom; the whoosh already fires on scene change.)
- [ ] **Step 4: Run → PASS** (+ existing 11 tests still green).
- [ ] **Step 5: Commit** `git add ...build_audio.py ...test_build_audio.py && git commit -m "feat(audio): number-reveal dip lands in the breath gap (re-enabled) (A1)"`

### Task 3.2: Render + listen checkpoint

- [ ] **Step 1:** Render + open in the device player.

> **HUMAN LISTEN CHECKPOINT:** at the reveal, the bed dips to near-silence across the ~0.9s breath, then the number lands — a real "beat of silence → reveal." Tune `dip_db`/`breath_s`. (The riser/boom that would further fill the gap = A2.) Record verdict in `decisions.md`.

---

## Stage 4 — Docs + reconcile

### Task 4.1: schema + status + decision + handoff

**Files:**
- Modify: `.claude/skills/render-builder/references/motion-schema.md` (the breath step: `vo.breath.mp3` derived at render, timings shifted once, `audioSpec.dips` now populated from breath gaps; note voiceover untouched)
- Modify: `CLAUDE.md` (audio status: transition-breath BUILT for number-reveal/chapter — gap+dip; buildup SFX = A2)
- Modify: `knowledge/decisions.md` (dated entry: the layered design — prosody kept, beat_type breath render-inserted, config in audio-tokens, voiceover independent, dip re-enabled; A2 named)
- Modify: `docs/handoffs/2026-07-09-audio-workstream-pause-resume.md` (transition-breath → done for the gap+dip; remaining = SFX-pool buildups, chapter boom, bed track-change, V4)

- [ ] **Step 1:** Edit each, integrate-don't-append; state the prosody-vs-breath separation in every doc that mentions either. 
- [ ] **Step 2: Grep** `breath` across the live docs — one intent home (§13a-iii), one data home (audio-tokens), no duplicated numbers, no doc calling the number-reveal dip "deferred" anymore.
- [ ] **Step 3: Commit** (explicit paths).

> **FINAL CHECKPOINT:** cold re-read — the manual-pause system and the beat_type breath are clearly two separate things everywhere; `breath_s` lives in exactly one place; nothing says the dip is still deferred.

---

## Self-Review notes (author)

- **Spec coverage:** config one-home (S1); pure gap+shift TDD + ffmpeg splice + non-destructive wiring (S2); dip re-enabled in the gap (S3); docs reconciled + prosody/breath separation stated everywhere (S4). voiceover untouched ✓. Single offset point ✓. Deterministic/idempotent (always from original vo.mp3) ✓. Safe-when-absent no-op ✓.
- **Type consistency:** `breath_gaps` returns `{shot_id, beat_type, at_s, dur_s}` used identically in `build_motion` (shift + audio_rel + meta) and `build_audio` (dip). `breath_s_by_beat` key identical in audio-tokens + `breath_gaps` + docs.
- **Known real-world risks:** (1) the ffmpeg concat filter for N gaps — integration-tested on the real slice in 2.2 before wiring; (2) double-offset — prevented by shifting in exactly one place; (3) chapter-boundary breath ships but its *boom* needs A2 (flagged, not silently broken — the gap + whoosh still land).
- **Out of scope (named, not smuggled):** A2 SFX-pool (riser/boom/hit buildups), chapter bed track-change (engine bed-switch), V4 audio-checker, cut-then-hold chapter-card placement (D4 refinement).
```
