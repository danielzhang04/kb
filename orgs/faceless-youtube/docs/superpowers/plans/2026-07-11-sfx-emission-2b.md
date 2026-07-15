# SFX Emission Phase 2b — Authored Content Cues — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `audio-cues.json` — a hand-authored per-video layer that places content-specific SFX + pauses on precise VO words (the number-reveal punch, aside→sting, money→cash, womp) — resolved and rendered deterministically, with the number-reveal breath migrated from automatic to authored.

**Architecture:** A new `audio_cues.py` loads `audio-cues.json` and resolves each cue's verbatim-VO-phrase `anchor` to a word time via the SHARED matcher (`render.match_shots_to_tokens`, a cue = a pseudo-shot with `vo_ref=anchor`). `build_motion` merges cue-pauses into the existing breath gaps (so `shift_timings`/`splice_silence` handle them unchanged) and passes cue role-events to `build_audio_spec`, which merges them into the event stream (inheriting the 2a full-stop / density / missing-file defense). `breath.py` and the engine are untouched.

**Tech Stack:** Python 3.13 (`py -3`), plain-`assert` tests (repo convention). No engine (Remotion/TS) change.

## Global Constraints

- **G1 — One matcher.** Cue anchors resolve via `render.match_shots_to_tokens` (a cue = pseudo-shot `{vo_ref: anchor}`), the SAME cursor-advancing first-4-word match shots use. No second matcher.
- **G2 — Pause semantic (pinned).** `pause_s` inserts silence BEFORE the anchor word; the cue's SFX (`role`) lands ON the anchor word = at the gap END (after the silence, survives the full-stop). Uniform; nails the reveal.
- **G3 — Additive-only timeline.** Cue-pauses reuse the exact additive-gap primitive as beat_type breaths (merged, one `shift_timings`, one `splice_silence`). VO stays the master clock.
- **G4 — Back-compat / clean no-op.** A missing `audio-cues.json` changes nothing (every existing video still renders identically).
- **G5 — Deterministic.** No random/wall-clock. Same cues → same output. A role absent from `sfx_pools` (or file) is dropped by the existing `sfx_missing` defense.
- **G6 — Docs in sync (integrate-don't-append).** New `audio-cues-schema.md`; `motion-schema.md` notes the new input + the number-reveal migration.
- **G7 — Parallel terminals.** Explicit-path commits on `master`; never `git add -A`.

## File Structure

- Create `.claude/skills/render-builder/scripts/audio_cues.py` — load + resolve + split (pure logic + thin loader).
- Modify `.claude/skills/render-builder/scripts/build_audio.py` — `build_audio_spec(cue_events=…)` merges cue role-events; new `cue_sfx_events` helper.
- Modify `.claude/skills/render-builder/scripts/build_motion.py` — read cues, merge cue-pauses into gaps, pass cue-events.
- Modify `channels/the-second-take/visual-kit/audio-tokens.json` — drop `number-reveal` from `breath_s_by_beat`.
- Create `.claude/skills/render-builder/references/audio-cues-schema.md`; Modify `.claude/skills/render-builder/references/motion-schema.md`.
- Create `.claude/skills/render-builder/scripts/test_audio_cues.py`; Modify `test_build_audio.py`.
- `breath.py` + `engine/` — **NO change** (shift/splice already generic; event schema stable).

---

## Task 1: `audio_cues.py` — load, resolve, split

**Files:** Create `.claude/skills/render-builder/scripts/audio_cues.py`, `.claude/skills/render-builder/scripts/test_audio_cues.py`

**Interfaces:**
- Produces: `load_cues(video_dir) -> list` (reads `audio-cues.json`; `[]` if absent) · `resolve_cues(cues, word_timings) -> list` (each cue + `at_s` on the ORIGINAL timeline via the shared matcher; unresolved anchors dropped) · `cue_pause_gaps(resolved) -> list[{at_s,dur_s,source}]` · `cue_role_events(resolved, gaps) -> list[{at_s,role,gain_db?}]` (SFX at the anchor word SHIFTED past all gaps ≤ it — lands at the gap end, G2).

- [ ] **Step 1: Write the failing test** `test_audio_cues.py`:
```python
import sys; from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from audio_cues import resolve_cues, cue_pause_gaps, cue_role_events

WT = [["in", 0.0], ["1822", 0.3], ["eight", 5.0], ["million", 5.3], ["acres", 5.6],
      ["eight", 9.0], ["million", 9.3], ["gone", 12.0]]

def test_resolve_anchor_to_word_time():
    r = resolve_cues([{"anchor": "eight million acres", "role": "cash"}], WT)
    assert len(r) == 1 and abs(r[0]["at_s"] - 5.0) < 1e-6, r     # first occurrence of "eight ..."

def test_repeated_anchor_hits_successive_occurrence():
    r = resolve_cues([{"anchor": "eight million", "role": "cash"},
                      {"anchor": "eight million", "role": "ding"}], WT)
    assert abs(r[0]["at_s"] - 5.0) < 1e-6 and abs(r[1]["at_s"] - 9.0) < 1e-6, r   # cursor advances

def test_unresolved_anchor_dropped():
    assert resolve_cues([{"anchor": "no such words here", "role": "cash"}], WT) == []

def test_cue_pause_gaps():
    r = resolve_cues([{"anchor": "eight million acres", "role": "cash", "pause_s": 0.5}], WT)
    assert cue_pause_gaps(r) == [{"at_s": 5.0, "dur_s": 0.5, "source": "cue"}], cue_pause_gaps(r)

def test_cue_role_event_lands_at_gap_end():
    r = resolve_cues([{"anchor": "eight million acres", "role": "cash", "pause_s": 0.5}], WT)
    gaps = cue_pause_gaps(r)                       # a 0.5s gap at 5.0
    ev = cue_role_events(r, gaps)
    # the cash lands at 5.0 + 0.5 (its own pause) = 5.5 = the gap end (after the silence)
    assert ev == [{"at_s": 5.5, "role": "cash"}], ev

def test_role_event_shifts_for_earlier_gap():
    r = resolve_cues([{"anchor": "gone", "role": "womp"}], WT)   # role only, no pause
    gaps = [{"at_s": 5.0, "dur_s": 0.5, "source": "cue"}]        # an earlier gap
    assert cue_role_events(r, gaps) == [{"at_s": 12.5, "role": "womp"}], cue_role_events(r, gaps)

print("running"); test_resolve_anchor_to_word_time(); test_repeated_anchor_hits_successive_occurrence()
test_unresolved_anchor_dropped(); test_cue_pause_gaps(); test_cue_role_event_lands_at_gap_end()
test_role_event_shifts_for_earlier_gap(); print("PASS")
```

- [ ] **Step 2: Run → FAIL** (`audio_cues` not found).

- [ ] **Step 3: Implement `audio_cues.py`:**
```python
#!/usr/bin/env python3
"""Authored content-cue layer (Phase 2b). Loads audio-cues.json + resolves each cue's verbatim VO-phrase
`anchor` to a word time via the SHARED matcher (a cue = a pseudo-shot with vo_ref=anchor), then splits into
pause-gaps (silence BEFORE the anchor) + role-events (SFX ON the anchor = the gap end). Pure resolve + a thin
loader; build_motion does the wiring. See references/audio-cues-schema.md."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from render import _NORM, match_shots_to_tokens   # noqa: E402  (the ONE shared vo_ref matcher, G1)


def load_cues(video_dir) -> list:
    p = Path(video_dir) / "audio-cues.json"
    if not p.exists():
        return []
    data = json.loads(p.read_text(encoding="utf-8"))
    return data.get("cues") or []


def resolve_cues(cues, word_timings) -> list:
    """Each cue + `at_s` (ORIGINAL timeline). Cursor-advancing (repeated anchors hit successive words);
    an unresolved anchor is dropped. Cues stay in authored (narration) order."""
    toks = [(_NORM(w), float(t)) for w, t in (word_timings or [])]
    toks = [(w, t) for w, t in toks if w]
    pseudo = [{"id": f"cue{i}", "vo_ref": c.get("anchor", "")} for i, c in enumerate(cues)]
    matched = match_shots_to_tokens(pseudo, toks)
    out = []
    for c, m in zip(cues, matched):
        if m["start"] is not None:
            out.append({**c, "at_s": round(float(m["start"]), 3)})
    return out


def cue_pause_gaps(resolved) -> list:
    """Silence gaps at each cue with a pause_s (inserted BEFORE the anchor word). ORIGINAL-timeline at_s."""
    return [{"at_s": c["at_s"], "dur_s": float(c["pause_s"]), "source": "cue"}
            for c in resolved if c.get("pause_s")]


def cue_role_events(resolved, gaps) -> list:
    """SFX role-events at the anchor word, SHIFTED past every gap at/at-or-before it (G2: the SFX lands at
    the gap END — on the word, after any silence). Role-less cues (pure pauses) emit nothing here."""
    out = []
    for c in resolved:
        if not c.get("role"):
            continue
        at = c["at_s"] + sum(g["dur_s"] for g in (gaps or []) if g["at_s"] <= c["at_s"])
        e = {"at_s": round(at, 3), "role": c["role"]}
        if c.get("gain_db") is not None:
            e["gain_db"] = c["gain_db"]
        out.append(e)
    return out
```

- [ ] **Step 4: Run → PASS.** `py -3 .claude/skills/render-builder/scripts/test_audio_cues.py` → `PASS`.
- [ ] **Step 5: Commit** `git add .claude/skills/render-builder/scripts/audio_cues.py .claude/skills/render-builder/scripts/test_audio_cues.py && git commit -m "feat(render-audio): audio_cues.py — load + resolve + split authored content cues (2b)"`

---

## Task 2: `build_audio` merges cue role-events

**Files:** Modify `.claude/skills/render-builder/scripts/build_audio.py`, `.claude/skills/render-builder/scripts/test_build_audio.py`

**Interfaces:**
- Consumes: `cue_events` = `[{at_s, role, gain_db?}]` (from `audio_cues.cue_role_events`).
- Produces: `cue_sfx_events(cue_events, tokens) -> [{sfx, at_s, gain_db?}]`; `build_audio_spec(..., cue_events=None)` merges them into `events` (before the full-stop + missing-file filter, so they inherit both).

- [ ] **Step 1: Add the failing test** to `test_build_audio.py` (add the call in the run block):
```python
def test_cue_events_merge_and_inherit_fullstop():
    cue_events = [{"at_s": 8.0, "role": "boom", "gain_db": -5},      # standalone -> kept
                  {"at_s": 5.3, "role": "cash"}]                     # inside a gap [5.0,5.9] -> withheld
    gaps = [{"at_s": 5.0, "dur_s": 0.9, "beat_type": "cue"}]
    spec = build_audio_spec([], TOK2, words=[], has_vo=False, breath_gaps=gaps,
                            cue_events=cue_events, audio_dir=None)
    at = {round(e["at_s"], 2): e for e in spec["events"]}
    assert at[8.0]["sfx"] == "audio/sfx/boom-1.mp3" and at[8.0]["gain_db"] == -5, at   # cue role+gain
    assert 5.3 not in at, at                                          # withheld by the full-stop
```

- [ ] **Step 2: Run → FAIL** (`build_audio_spec` has no `cue_events` param).

- [ ] **Step 3: Implement.** In `build_audio.py`, add after `sfx_events` (before `build_audio_spec`):
```python
def cue_sfx_events(cue_events, tokens):
    """Authored cue role-events {at_s, role, gain_db?} -> playable {sfx, at_s, gain_db} (2b). Per-role
    anti-repeat rotation; gain = the cue override else sfx_gain_db. A role with no pool falls back to
    '<role>-1' (the missing-file defense drops it later if unsourced)."""
    t = tokens or {}
    pool = t.get("sfx_pools") or {}
    gain = t.get("sfx_gain_db") or {}
    idx, out = {}, []
    for c in cue_events or []:
        role = c.get("role")
        if not role:
            continue
        i = idx.get(role, 0); idx[role] = i + 1
        e = {"sfx": _sfx_file(pool, role, i), "at_s": round(float(c["at_s"]), 3)}
        g = c.get("gain_db", gain.get(role))
        if g is not None:
            e["gain_db"] = g
        out.append(e)
    return out
```
Then change the `build_audio_spec` signature and the events line. Signature:
```python
def build_audio_spec(shots, tokens, words, has_vo, breath_gaps=None, audio_dir=None, cue_events=None):
```
And replace `events = sfx_events(shots, t, withhold=withhold)` with:
```python
    events = sfx_events(shots, t, withhold=withhold) + cue_sfx_events(cue_events, t)   # 2a structural + 2b authored
    events.sort(key=lambda e: e["at_s"])
```
(The existing full-stop loop + missing-file filter below already run over `events`, so cue events inherit both.) Update the `build_audio_spec` docstring to note `cue_events` (the 2b authored content SFX; merged, then full-stop + missing-file apply).

- [ ] **Step 4: Run → PASS** (`py -3 test_build_audio.py`).
- [ ] **Step 5: Commit** (build_audio.py + test_build_audio.py).

---

## Task 3: `build_motion` wiring + number-reveal migration

**Files:** Modify `.claude/skills/render-builder/scripts/build_motion.py`, `channels/the-second-take/visual-kit/audio-tokens.json`

- [ ] **Step 1: Drop the auto number-reveal breath.** In `audio-tokens.json` `breath_s_by_beat`, remove the `"number-reveal": 0.7` entry (keep `"chapter-boundary": 0.9`). Update the `_breath_note` to: "chapter-boundary breaths are automatic (a structural boundary); the number-reveal emphasis is now an AUTHORED cue (audio-cues.json), word-anchored to the number." Verify JSON parses.

- [ ] **Step 2: Wire cues into `build_motion.build_piece_spec`.** Add the import at the top:
```python
from audio_cues import load_cues, resolve_cues, cue_pause_gaps, cue_role_events  # noqa: E402  (2b authored cues)
```
Then, in `build_piece_spec`, find the breath block:
```python
    gaps = []
    if not args.no_audio and word_timings:
        gaps = breath_gaps(shots, word_timings, (audio_tokens or {}).get("breath_s_by_beat") or {})
        if gaps:
            word_timings = shift_timings(word_timings, gaps)
            vo_s = (vo_s or 0.0) + sum(g["dur_s"] for g in gaps)
```
and replace it with (resolve cues on the ORIGINAL word-timings, merge their pauses into the gaps, compute cue-events shifted, THEN shift once):
```python
    gaps, cue_events = [], []
    if not args.no_audio and word_timings:
        resolved = resolve_cues(load_cues(video_dir), word_timings)     # 2b, on ORIGINAL timeline
        beat_gaps = breath_gaps(shots, word_timings, (audio_tokens or {}).get("breath_s_by_beat") or {})
        gaps = sorted(beat_gaps + cue_pause_gaps(resolved), key=lambda g: g["at_s"])
        cue_events = cue_role_events(resolved, gaps)                    # SFX at anchor, shifted past gaps
        if gaps:
            word_timings = shift_timings(word_timings, gaps)
            vo_s = (vo_s or 0.0) + sum(g["dur_s"] for g in gaps)
```
Then find the `build_audio_spec(...)` call and add `cue_events=cue_events`:
```python
        audio_spec = build_audio_spec(spec["shots"], audio_tokens, word_timings or [],
                                      has_vo=bool(audio_rel), breath_gaps=gaps, cue_events=cue_events,
                                      audio_dir=video_dir.parent.parent / "visual-kit")
```

- [ ] **Step 3: Smoke — no cues = no change (G4).** With no `audio-cues.json` present, run
`py -3 build_motion.py channels/the-second-take/videos/_chain-test --dry-run --allow-missing` → completes; the
`audioSpec.events` are the same set as before this task (cue_events empty). Confirm no error.

- [ ] **Step 4: Smoke — a hand cue fires.** Create a temp `channels/the-second-take/videos/_chain-test/audio-cues.json` with one cue whose `anchor` is a real VO phrase from `_chain-test` + `{role: "cash", pause_s: 0.5}`; dry-run; confirm a `cash` event appears at the resolved (shifted) word time and a dip covers the pause gap. Delete the temp file after (or keep for the Task-5 ear-gate).

- [ ] **Step 5: Commit** (build_motion.py + audio-tokens.json).

---

## Task 4: Docs — the cue schema + motion-schema note

**Files:** Create `.claude/skills/render-builder/references/audio-cues-schema.md`; Modify `.claude/skills/render-builder/references/motion-schema.md`

- [ ] **Step 1: Write `audio-cues-schema.md`** — the contract: the JSON shape (`{cues:[{anchor, role?, pause_s?, gain_db?}]}`); `anchor` = a verbatim VO phrase resolved by the shared matcher (cursor-advancing; put cues in narration order; a repeated phrase hits the next occurrence); the pinned semantic (pause = silence BEFORE the anchor, SFX = ON the anchor at the gap end); at least one of role/pause required; a role must exist in `sfx_pools`; missing file / unresolved anchor drop cleanly; this is the home of the number-reveal punch + comedic hits (aside→sting, money→cash, womp); music control is Phase-3, not a cue field. Include 2 worked examples.

- [ ] **Step 2: Note it in `motion-schema.md`.** In §2, add a one-row note (or extend the `audioSpec` row) that `audio-cues.json` is an optional per-video input: its cue-pauses join the beat_type breaths in the render's ONE breath mechanism, and its role-events merge into `audioSpec.events`; the `number-reveal` breath is now authored there (removed from `breath_s_by_beat`). Integrate, don't append.

- [ ] **Step 3: Commit** (both docs).

---

## Task 5: Ear-gate — hand-author cues on `_chain-test`

**Files:** Create `channels/the-second-take/videos/_chain-test/audio-cues.json` (untracked scratch)

- [ ] **Step 1: Hand-author** an `audio-cues.json` with a few real cues against `_chain-test`'s VO — e.g. a `cash` (+ small pause) on the money/number line, a `womp` on a deflating line, a `sting` on a reveal. Anchors must be verbatim VO phrases (check `voiceover.manifest.json word_timings`).
- [ ] **Step 2: Render** `py -3 build_motion.py channels/the-second-take/videos/_chain-test --allow-missing`; open `assets/final.mp4` in the Windows default player ([[review-video-in-device-player]]).

> **CHECKPOINT (human — the 2b acceptance gate):** LISTEN. Do the authored SFX land on the right words? Do the pauses help or stall? Tune `role`/`gain_db`/`pause_s` in `audio-cues.json` (and `sfx_gain_db`) by ear and re-render. [[audio-taste-is-human-judged]]. Do NOT proceed until the user signs off.

---

## Task 6: Status + decision log

**Files:** Modify `knowledge/decisions.md`, `CLAUDE.md`, `docs/handoffs/2026-07-10-sfx-library-and-audio-analysis-pickup.md`

- [ ] **Step 1: Log** a dated `decisions.md` entry: 2b mechanism done — `audio-cues.json` authored layer (anchor→word via the shared matcher; pause→generalized breath; role→merged event); number-reveal migrated structural→authored; music/author-step/critic deferred; ear-gated on `_chain-test`.
- [ ] **Step 2: Update `CLAUDE.md`** audio bullet: Phase 2b mechanism DONE; NEXT = the 2b fast-follow (LLM cue-author + audio critic) then Phase 3 music lane.
- [ ] **Step 3: Update the handoff** resume pointer → the 2b fast-follow.
- [ ] **Step 4: Commit** (explicit paths).

---

## Self-Review (author, against the spec)

- **Spec coverage:** `audio-cues.json` schema + resolver (Task 1) · anchor via the shared matcher, G1 (Task 1) · pause→generalized breath merge, G2/G3 (Tasks 1+3) · role→merged event inheriting full-stop/density/missing-file (Task 2) · number-reveal migration (Task 3) · back-compat no-op, G4 (Task 3 Step 3) · schema + motion-schema docs, G6 (Task 4) · hermetic tests (Tasks 1–2) · ear-gate (Task 5) · author-step/critic + music deferred (not built). `breath.py`/engine untouched as designed.
- **Placeholder scan:** none — every code + doc step is spelled out; the only human step (Task 5) is the deliberate ear-gate.
- **Type consistency:** `resolved` cue dict carries `at_s`+authored fields through `cue_pause_gaps`/`cue_role_events`; gap dict `{at_s,dur_s}` matches `breath_gaps` + `shift_timings`/`splice_silence` + the 2a full-stop `_gap_start`; `cue_events {at_s,role,gain_db?}` consumed identically in `cue_sfx_events`; event `{sfx,at_s,gain_db?}` matches the engine (unchanged).
