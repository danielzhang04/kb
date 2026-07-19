# Audio Director — Phase 3: Absorb structural sounds into judgment

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Stop `build_audio`/`breath` from mechanically auto-firing the structural sounds (whoosh, boom/thud, enumeration pop, gravity thin/withhold, chapter breath). They become **director-authored cues**, placed selectively. This is the first phase that changes what you HEAR → it ends at a human ear-gate on a render.

**Architecture:** Phase 3 of `2026-07-12-audio-director-rework-design.md`. Surgical removal of the auto-fire branches in `sfx_events` / `register_audio` / `breath_gaps`; the realizer MECHANICS (density cap, full-stop, music lane, missing-file, pool rotation, tick device-kit) are untouched. `beat_type` still exists (Phase 4 deletes it) — it just stops driving audio.

**Scoping calls (ear-gate these):** `tick` stays (device-kit text-reveal, not sound design); gravity "thin" → the director authors a `dry` span (matches the grammar); `escalation`/`thud` disappears (not our idiom).

**Tech Stack:** Python 3 (`py -3`, plain-assert).

## Global Constraints

- Parallel terminals → explicit git paths, never `git add -A`.
- **Surgical:** remove ONLY the structural auto-fire branches. Keep density cap, full-stop, music lane, missing-file defense, pool rotation, the `tick` overlay path, dormant device-cards.
- **Audio FEEL is the human's ear-gate** — never self-certified. The phase "passes" only when Daniel ear-gates the render.

---

### Task 1: Gut the structural auto-fires

**Files:**
- Modify: `.claude/skills/render-builder/scripts/build_audio.py` (`sfx_events` + `register_audio`)
- Modify: `.claude/skills/render-builder/scripts/breath.py` (`breath_gaps`)
- Modify: `.claude/skills/render-builder/scripts/test_build_audio.py` (+ `test_breath.py`) — update expectations

- [ ] **Step 1: Update the tests first** to expect NO structural auto-fires.
  - In `test_build_audio.py`: the test asserting base/whip → whoosh (and delta → pop) must now assert those shots emit **nothing** on their own (only authored cues produce SFX). Rewrite `test_sfx_base_and_whip_whoosh_delta_and_plaincut_silent` → `test_sfx_no_structural_autofire` asserting `sfx_events([...structural shots...], tokens) == []`.
  - Any test asserting gravity `thin_spans` / `withhold` from `register_audio` → assert `register_audio(shots, tokens) == ([], [])`.
  - In `test_breath.py`: the test asserting a `chapter-boundary` shot yields a gap → assert `breath_gaps(shots, wt, {}) == []` (no beat_type breath; only cue `pause_s` gaps remain, which come via `audio_cues`).

- [ ] **Step 2: Run — expect FAIL** (old code still auto-fires).
Run: `py -3 .claude/skills/render-builder/scripts/test_build_audio.py`

- [ ] **Step 3: Edit `sfx_events`** — delete the three structural branches; keep the tick/overlay + dormant device-card loop and all the mechanics:

Remove:
```python
        # scene change ...
        if s.get("stage_role") == "base" or s.get("entrance") == "whip":
            emit(events, "whoosh", start, structural=True)
        # beat_type-driven structural hits ...
        for role in bt_sfx.get(s.get("beat_type", "narration"), []):
            emit(events, role, start, structural=True)
        # element accretion ...
        if s.get("beat_type") == "enumeration-within" and s.get("stage_role") == "delta":
            emit(events, "pop", start, structural=True, variant=sum(ord(c) for c in (s.get("stage") or "")))
```
Keep the `for o in s.get("overlays", [])` loop (tick + dormant) and everything after (density cap, withhold filter, cap-pop). Update the docstring: "Structural sounds (whoosh/boom/pop) are no longer auto-fired — the audio-director authors them as `sfx` cues (2026-07-12). This emits only the device-kit overlay sounds (tick live; riser/pluck dormant)." The `bt_sfx` variable + the `withhold` param become unused-by-structural but `withhold` still filters cue SFX in gravity spans if any are authored — keep the withhold filter.

- [ ] **Step 4: Gut `register_audio`** — it no longer reads `beat_type`. The director authors `dry` (human cost) + withholds SFX by not placing them. Return empties:
```python
def register_audio(shots, tokens):
    """Register is now AUTHORED by the audio-director (dry spans on human cost; SFX withheld by not
    being placed) — no longer derived from beat_type (2026-07-12). Kept as a stable seam returning
    ([], []) so build_audio_spec's call site is unchanged."""
    return [], []
```
(Leaves `_THIN_BEATS`/`_WITHHOLD_BEATS` unused — delete those two module constants.)

- [ ] **Step 5: Gut the `beat_type` breath in `breath_gaps`** — it now only emits gaps from cue `pause_s` (which arrive via the `audio_cues` path, unchanged). Remove the `beat_type ∈ breath_s_by_beat` branch so `breath_gaps(shots, wt, breath_s_by_beat)` returns `[]` for beat_type (the cue-pause gaps are added by the caller via `cue_pause_gaps`, unchanged). Update the docstring.

- [ ] **Step 6: Remove the gravity music-hole in `build_music_lane`** (build_audio.py ~line 245): delete the `if s.get("beat_type") == "gravity": holes.append(...)` branch — human-cost silence is now an authored `dry` span (`music_dry`), which already carves holes.

- [ ] **Step 7: Run — expect PASS.** `py -3 .claude/skills/render-builder/scripts/test_build_audio.py` + `test_breath.py` → PASS.

- [ ] **Step 8: Commit**

```bash
git add .claude/skills/render-builder/scripts/build_audio.py .claude/skills/render-builder/scripts/breath.py .claude/skills/render-builder/scripts/test_build_audio.py .claude/skills/render-builder/scripts/test_breath.py
git commit -m "refactor(audio): stop auto-firing structural sounds — director authors them (audio-director phase 3)"
```

---

### Task 2: Re-author `_chain-test` + the ear-gate render

**Files:**
- Modify: `channels/the-second-take/videos/_chain-test/audio-plan.json` (add the structural sounds selectively)

- [ ] **Step 1: Add the structural sounds to `_chain-test`'s plan, selectively** — as the audio-director would: a `whoosh` on the scene changes that want it (not all), the chapter `boom` (already an authored cue there), a `dry` span if `_chain-test` has a human-cost beat. Lint: `py -3 .../lint_audio_plan.py <plan> <audio-tokens.json>` → `0 error(s)`.

- [ ] **Step 2: Render `_chain-test`** (`build_motion` → the engine) and open the MP4 in the Windows player.

- [ ] **Step 3: HUMAN EAR-GATE (Daniel).** Confirm the structural sounds land where they should — now selectively, not on every instance — and the feel holds. Iterate the plan (add/remove/retune) by ear until approved. **The phase is not done until this passes.**

- [ ] **Step 4: Commit** (after approval)

```bash
git add channels/the-second-take/videos/_chain-test/audio-plan.json
git commit -m "test(audio): _chain-test structural sounds re-authored + ear-gated (audio-director phase 3)"
```

---

## Phase 3 done (on ear-gate) — structural sounds are director judgment, not auto-fire. Next: Phase 4 (delete beat_type) → Phase 5 (hygiene).
