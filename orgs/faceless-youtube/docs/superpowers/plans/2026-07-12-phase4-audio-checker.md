# Phase 4 — Deterministic Audio Checker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the audio loop objectively — a deterministic post-render checker that verifies every render's audio (master hit target · no silently-dropped sound/mood · register layer fired · music lane sane) and writes a warn-not-fail `audio` block into the render manifest.

**Architecture:** A new pure `audio_checker.check_audio(audio_spec, shots, loudnorm, master_target)` returning `{ok, warnings, measured}`, wired into `build_motion.py` right after `loudnorm_pass`. NO model listening (tools produce the numbers — the audio-analyzer doctrine); FEEL stays the human ear-gate. Warn-not-fail: a failing check is a loud manifest warning, never a render abort (the render already succeeded).

**Tech Stack:** Python 3.13 (`py -3`), plain-`assert` tests (repo convention — matches `test_build_audio.py`). No new dependencies (LUFS/TP already measured by `loudnorm_pass` into the manifest).

**Design spec:** `docs/superpowers/specs/2026-07-12-phase3b-music-lane-realizer-and-phase4-checker-design.md §9`.

## Global Constraints

- **G1 — Explicit-path commits.** Stage exact paths; never `git add -A`; never rewrite history. Parallel terminals share this tree.
- **G2 — Deterministic, no model listening.** Every check is a computation over the audioSpec + shots + the loudnorm measurement. No "does it sound good" — that stays the human ear-gate.
- **G3 — Warn-not-fail.** The checker writes an `audio` block into the per-piece manifest record; a failed check is a `warnings[]` entry + `ok: false`, never a `SystemExit`. The audio layer is additive.
- **G4 — Lean scope (owner-approved cuts, named — no silent scope).** IN: missing-files, LUFS/TP-vs-target, register-events-present, music-lane sanity. OUT (with reasons): SFX↔VO collision (2b cues are *intentionally* word-synced → false positives), gain-budget<0dBFS (loudnorm TP-limiter already prevents output clip → redundant), density≤cap (build_audio already *enforces* it → testing the test).
- **G5 — Pure core, thin wiring.** `check_audio` is a pure function on plain dicts (hermetic tests, no I/O). `build_motion` only gathers the inputs + stashes the result.

---

### Task 1: `audio_checker.check_audio` (pure) + hermetic tests (incl. seed-a-defect)

**Files:**
- Create: `.claude/skills/render-builder/scripts/audio_checker.py`
- Create: `.claude/skills/render-builder/scripts/test_audio_checker.py`

**Interfaces:**
- Produces: `check_audio(audio_spec, shots, loudnorm, master_target, lufs_tol=1.0, tp_tol=0.3) -> dict`
  - `audio_spec`: `{music_states, events, dips, thin_spans, sfx_missing, music_missing}` (the motion.json `audioSpec`)
  - `shots`: `[{beat_type, start_s, duration_s}, …]` (the derived motion shots)
  - `loudnorm`: `{audio_lufs, audio_true_peak}` (from `loudnorm_pass`; may be `{}` if it soft-failed)
  - `master_target`: `{lufs, true_peak_max_dbfs, lra}`
  - Returns `{ok: bool, warnings: [str], measured: {lufs, true_peak, music_segments, sfx_count, sfx_missing, music_missing}}`

- [ ] **Step 1: Write the failing tests** `test_audio_checker.py`:

```python
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from audio_checker import check_audio

MT = {"lufs": -14.5, "true_peak_max_dbfs": -1.0, "lra": 4.0}
LN = {"audio_lufs": -14.3, "audio_true_peak": -1.1}


def _spec(**kw):
    base = {"music_states": [{"track": "audio/beds/casual-bed-1.mp3", "at_s": 0.0, "dur_s": 20.0,
                              "base_db": 7, "fade_in_s": 0.5, "fade_out_s": 0.9}],
            "events": [{"sfx": "audio/sfx/boom-1.mp3", "at_s": 5.0}],
            "dips": [{"at_s": 10.0, "depth_db": -40, "dur_s": 0.9}],
            "thin_spans": [{"at_s": 12.0, "dur_s": 4.0, "extra_db": 8}],
            "sfx_missing": 0, "music_missing": 0}
    base.update(kw); return base


SHOTS = [{"beat_type": "narration", "start_s": 0.0, "duration_s": 12.0},
         {"beat_type": "gravity", "start_s": 12.0, "duration_s": 4.0},
         {"beat_type": "narration", "start_s": 16.0, "duration_s": 4.0}]


def test_clean_render_passes():
    r = check_audio(_spec(), SHOTS, LN, MT)
    assert r["ok"] is True and r["warnings"] == [], r
    assert r["measured"]["lufs"] == -14.3


def test_missing_sfx_warns():
    r = check_audio(_spec(sfx_missing=2), SHOTS, LN, MT)
    assert r["ok"] is False and any("sfx_missing" in w for w in r["warnings"])


def test_missing_music_warns():
    r = check_audio(_spec(music_missing=1), SHOTS, LN, MT)
    assert r["ok"] is False and any("music_missing" in w for w in r["warnings"])


def test_loudness_off_target_warns():
    r = check_audio(_spec(), SHOTS, {"audio_lufs": -11.0, "audio_true_peak": -1.1}, MT)
    assert r["ok"] is False and any("LUFS" in w for w in r["warnings"])


def test_true_peak_over_warns():
    r = check_audio(_spec(), SHOTS, {"audio_lufs": -14.3, "audio_true_peak": -0.2}, MT)
    assert r["ok"] is False and any("true-peak" in w or "true_peak" in w for w in r["warnings"])


def test_loudnorm_soft_failed_warns():
    r = check_audio(_spec(), SHOTS, {}, MT)
    assert r["ok"] is False and any("loudnorm" in w.lower() for w in r["warnings"])


def test_gravity_beat_but_no_thin_warns():
    r = check_audio(_spec(thin_spans=[]), SHOTS, LN, MT)
    assert r["ok"] is False and any("thin" in w and "gravity" in w for w in r["warnings"])


def test_no_gravity_no_thin_is_fine():
    shots = [{"beat_type": "narration", "start_s": 0.0, "duration_s": 20.0}]
    r = check_audio(_spec(thin_spans=[]), shots, LN, MT)
    assert r["ok"] is True, r["warnings"]


def test_music_over_gravity_warns():
    # a segment spanning the gravity shot [12,16) -> the lane should be dry there
    over = _spec(music_states=[{"track": "audio/beds/casual-bed-1.mp3", "at_s": 0.0, "dur_s": 20.0,
                                "base_db": 7, "fade_in_s": 0.5, "fade_out_s": 0.9}])
    r = check_audio(over, SHOTS, LN, MT)
    assert r["ok"] is False and any("gravity" in w and "music" in w.lower() for w in r["warnings"])


def test_base_db_out_of_band_warns():
    bad = _spec(music_states=[{"track": "audio/beds/casual-bed-1.mp3", "at_s": 0.0, "dur_s": 10.0,
                               "base_db": 40, "fade_in_s": 0.5, "fade_out_s": 0.9}])
    r = check_audio(bad, [{"beat_type": "narration", "start_s": 0.0, "duration_s": 10.0}], LN, MT)
    assert r["ok"] is False and any("base_db" in w for w in r["warnings"])


print("running")
test_clean_render_passes(); test_missing_sfx_warns(); test_missing_music_warns()
test_loudness_off_target_warns(); test_true_peak_over_warns(); test_loudnorm_soft_failed_warns()
test_gravity_beat_but_no_thin_warns(); test_no_gravity_no_thin_is_fine()
test_music_over_gravity_warns(); test_base_db_out_of_band_warns()
print("PASS")
```

- [ ] **Step 2: Run → FAIL.** `py -3 .claude/skills/render-builder/scripts/test_audio_checker.py` → ModuleNotFound.

- [ ] **Step 3: Implement** `audio_checker.py`:

```python
#!/usr/bin/env python3
"""Phase 4 — deterministic post-render audio checker. Verifies a render's audio against the
audioSpec + the loudnorm measurement; returns warn-not-fail findings for the render manifest.
NO model listening (tools produce the numbers — the audio-analyzer doctrine); FEEL stays the human
ear-gate. Lean scope (spec 2026-07-12-phase3b §9 + the owner-approved cuts): missing-files,
LUFS/TP-vs-target, register-events-present, music-lane sanity."""


def _overlaps(a0, a1, b0, b1):
    return a0 < b1 and b0 < a1


def check_audio(audio_spec, shots, loudnorm, master_target, lufs_tol=1.0, tp_tol=0.3):
    """Deterministic (G2). Returns {ok, warnings, measured}. A warning never fails the render (G3)."""
    a = audio_spec or {}
    shots = shots or []
    ln = loudnorm or {}
    mt = master_target or {}
    warnings = []

    # 1. Missing files — a silently-dropped sound/mood (the #1 guard).
    sfx_missing = int(a.get("sfx_missing", 0) or 0)
    music_missing = int(a.get("music_missing", 0) or 0)
    if sfx_missing:
        warnings.append(f"sfx_missing={sfx_missing} — SFX role(s) had no sourced file (run sfx-forge)")
    if music_missing:
        warnings.append(f"music_missing={music_missing} — mood(s) had no sourced track (run music-forge)")

    # 2. Loudness / true-peak vs master_target (loudnorm can soft-fail -> empty dict).
    lufs = ln.get("audio_lufs")
    tp = ln.get("audio_true_peak")
    if lufs is None or tp is None:
        warnings.append("loudnorm did not run / soft-failed — master loudness unverified")
    else:
        tgt_lufs = mt.get("lufs")
        tgt_tp = mt.get("true_peak_max_dbfs")
        if tgt_lufs is not None and abs(float(lufs) - float(tgt_lufs)) > lufs_tol:
            warnings.append(f"LUFS {lufs} off target {tgt_lufs} (tol {lufs_tol})")
        if tgt_tp is not None and float(tp) > float(tgt_tp) + tp_tol:
            warnings.append(f"true-peak {tp} over target {tgt_tp} (tol {tp_tol})")

    # 3. Register events present — a gravity beat must have produced a thin_span (wiring regression guard).
    has_gravity = any(s.get("beat_type") == "gravity" for s in shots)
    if has_gravity and not (a.get("thin_spans") or []):
        warnings.append("a gravity beat produced no thin_span — register (human-cost thinning) did not fire")

    # 4. Music-lane sanity: no segment over a gravity shot; base_db in a sane band.
    grav_spans = [(float(s.get("start_s", 0.0)), float(s.get("start_s", 0.0)) + float(s.get("duration_s", 0.0)))
                  for s in shots if s.get("beat_type") == "gravity"]
    for m in a.get("music_states") or []:
        m0 = float(m.get("at_s", 0.0)); m1 = m0 + float(m.get("dur_s", 0.0))
        for g0, g1 in grav_spans:
            if _overlaps(m0, m1, g0, g1):
                warnings.append(f"music segment [{m0:.1f},{m1:.1f}] plays over a gravity span "
                                f"[{g0:.1f},{g1:.1f}] — the lane should be dry there")
                break
        base_db = float(m.get("base_db", 0.0))
        if not (0.0 <= base_db <= 25.0):
            warnings.append(f"music base_db {base_db} out of the sane 0–25 dB band")

    measured = {"lufs": lufs, "true_peak": tp,
                "music_segments": len(a.get("music_states") or []),
                "sfx_count": len(a.get("events") or []),
                "sfx_missing": sfx_missing, "music_missing": music_missing}
    return {"ok": not warnings, "warnings": warnings, "measured": measured}
```

- [ ] **Step 4: Run → PASS.** `py -3 .claude/skills/render-builder/scripts/test_audio_checker.py` → `PASS`. (The `*_warns` tests ARE the seed-a-defect coverage — a bad spec produces the warning; C2 satisfied at the unit level.)

- [ ] **Step 5: Commit.**

```bash
git add .claude/skills/render-builder/scripts/audio_checker.py .claude/skills/render-builder/scripts/test_audio_checker.py
git commit -m "feat(audio-checker): deterministic check_audio (Phase 4, pure + hermetic tests)"
```

---

### Task 2: Wire into build_motion + verify on a real render

**Files:**
- Modify: `.claude/skills/render-builder/scripts/build_motion.py` (import + call after loudnorm; stash `audio` block in the manifest record)

**Interfaces:**
- Consumes: `audio_checker.check_audio` (Task 1); `spec["audioSpec"]`, `spec["shots"]`, the `loudnorm_pass` result, `master_target` (from `load_audio_tokens`).
- Produces: `rec["audio"] = {ok, warnings, measured}` in `render.manifest.json`.

- [ ] **Step 1: Add the import** next to the other script imports (top of `build_motion.py`, near `from build_audio import …`):

```python
from audio_checker import check_audio  # noqa: E402  (Phase 4 deterministic audio checker)
```

- [ ] **Step 2: Call it after loudnorm** in the render loop. Replace the loudnorm block:

```python
            if not args.no_audio and not args.no_loudnorm:
                mt = (load_audio_tokens(video_dir) or {}).get("master_target") or {}
                ln = loudnorm_pass(video_dir / out_rel,
                                   i=float(mt.get("lufs", -14.0)),
                                   tp=float(mt.get("true_peak_max_dbfs", -1.5)),
                                   lra=float(mt.get("lra", 11.0)))
                rec.update(ln)
                audio_report = check_audio(spec.get("audioSpec") or {}, spec.get("shots") or [], ln, mt)
                rec["audio"] = audio_report
                if not audio_report["ok"]:
                    for w in audio_report["warnings"]:
                        print(f"  ⚠ audio-check: {w}")
            rec["state"] = "rendered"
```

(Note the old block set `rec.update(loudnorm_pass(...))` directly — this replaces it, keeping the same loudnorm call + adding the check.)

- [ ] **Step 3: Syntax check + real render.**

```bash
py -3 -c "import ast; ast.parse(open('.claude/skills/render-builder/scripts/build_motion.py').read()); print('parses OK')"
py -3 .claude/skills/render-builder/scripts/build_motion.py channels/the-second-take/videos/_chain-test
```

- [ ] **Step 4: Verify the manifest `audio` block is clean** on the good fixture:

```bash
py -3 -c "import json; a=json.load(open('channels/the-second-take/videos/_chain-test/assets/render.manifest.json'))['pieces'][0]['audio']; print('ok:', a['ok']); print('warnings:', a['warnings']); print('measured:', a['measured'])"
```
Expected: `ok: True`, `warnings: []`, `measured` shows lufs ≈ −14.1, music_segments 2, sfx_missing 0, music_missing 0. (If a warning fires on the known-good fixture, the checker is too strict — tune the tolerance, don't silence the check.)

- [ ] **Step 5: Commit.**

```bash
git add .claude/skills/render-builder/scripts/build_motion.py
git commit -m "feat(audio-checker): wire check_audio into build_motion (manifest audio block, warn-not-fail)"
```

---

### Task 3: Docs + reconcile (Phase 4 DONE)

**Files:**
- Modify: `knowledge/decisions.md` (one dated entry — integrate, don't append a pile)
- Modify: `CLAUDE.md` (status: Phase 4 DONE)
- Modify: `docs/handoffs/2026-07-10-sfx-library-and-audio-analysis-pickup.md` (▶ RESUME → the audio engine is complete; remaining = the named follow-ups)
- Modify: `.claude/skills/render-builder/references/motion-schema.md` (document the manifest `audio` block)

- [ ] **Step 1: Document the manifest `audio` block** in `motion-schema.md` — near the `render.manifest.json` description (or the audioSpec note), add: each rendered piece's manifest record gains an `audio: {ok, warnings[], measured{lufs,true_peak,music_segments,sfx_count,sfx_missing,music_missing}}` block from the Phase-4 `audio_checker` (deterministic, warn-not-fail).

- [ ] **Step 2: Log the decision** — one dated `decisions.md` entry: Phase 4 = deterministic audio checker (no model listening), the lean check-set (missing-files / LUFS-TP-vs-target / register-present / lane-sanity) + the named cuts (collision / gain-budget / density — with reasons), warn-not-fail into the manifest.

- [ ] **Step 3: Update `CLAUDE.md` status** — the audio workstream's `NEXT = Phase 4` becomes Phase 4 DONE; note the audio engine is now feature-complete (production + verification), remaining = the named follow-ups (partial-thin on human-cost drop; `casual-bed` settle under real narration; device-card SFX ride the visual work).

- [ ] **Step 4: Update the handoff ▶ RESUME** — the audio arc (analysis → SFX → music lane → mastering → checker) is complete; point at the remaining follow-ups, not a next phase.

- [ ] **Step 5: Final verification** (verification-before-completion):

```bash
py -3 .claude/skills/render-builder/scripts/test_audio_checker.py
py -3 .claude/skills/render-builder/scripts/test_build_audio.py
```
Expected: both PASS.

- [ ] **Step 6: Commit.**

```bash
git add knowledge/decisions.md CLAUDE.md docs/handoffs/2026-07-10-sfx-library-and-audio-analysis-pickup.md .claude/skills/render-builder/references/motion-schema.md
git commit -m "docs(audio-checker): Phase 4 done — deterministic checker, lean scope, audio arc complete"
```

---

## Phase 4 — NOT in scope (named, so it's not a silent cut)

Deferred (revisit only if a real need appears): SFX↔VO collision detection (noisy vs designed sync), gain-budget worst-case sum (loudnorm TP-limiter already guards output clip), standalone density check (build_audio enforces the cap), and any generative/model listening (violates the analyzer doctrine — FEEL is the human ear-gate).

## Self-Review (author, against the spec §9 + the lean-scope decision)

- **Coverage:** §9's IN checks — missing-files (Task 1 checks 1) · LUFS/TP-vs-target (check 2) · register-present (check 3) · lane-sanity (check 4). §9's C1 deterministic pass = Task 1; C2 seed-a-defect = the `*_warns` unit tests (a bad spec → the warning); C3 wire into render-builder = Task 2. Docs = Task 3.
- **Placeholder scan:** every code step carries real code; no TBD/"similar to".
- **Type consistency:** `check_audio(audio_spec, shots, loudnorm, master_target)` → `{ok, warnings, measured}` used identically in Task 1 tests + Task 2 wiring; `loudnorm` dict = the `loudnorm_pass` return (`{audio_lufs, audio_true_peak}`); `master_target` = the audio-tokens block (`{lufs, true_peak_max_dbfs, lra}`). `rec["audio"]` shape matches the manifest doc (Task 3 step 1).
- **Lean-scope honored:** the three cut checks are named here + in G4 + in the "NOT in scope" section (no silent cut).
- **Non-breaking:** Task 1 additive; Task 2 replaces the loudnorm block preserving the same loudnorm call (adds the check + a warn print); warn-not-fail so no render aborts.
```