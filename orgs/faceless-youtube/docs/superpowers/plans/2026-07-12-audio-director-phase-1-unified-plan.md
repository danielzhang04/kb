# Audio Director — Phase 1: Unified Plan (additive) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a single unified `audio-plan.json` format + its lint, and teach `build_motion` to read it **as an additive alternative** to today's two cue files — reproducing the current ear-gated render exactly. Nothing is removed; `beat_type` and the two cue-writers keep working.

**Architecture:** Phase 1 of `docs/superpowers/specs/2026-07-12-audio-director-rework-design.md`. A unified cue of `kind: sfx|pause` is byte-equivalent to a `audio-cues.json` cue; `kind: music|dry` to a `music-cues.json` cue/dry. So the whole phase is a **thin adapter** (`split_plan`) that re-buckets the unified plan into the *existing* internal shapes, feeding the *existing* resolvers (`resolve_cues`, `resolve_music_cues`) — realizers unchanged. Regression-safety = the `_chain-test` A/B render at the end.

**Tech Stack:** Python 3 (`py -3`, plain-assert tests). Reuses `audio_cues.py`, `music_cues.py`, `render.py`'s matcher.

## Global Constraints

- Plain-assert Python tests (`py -3`); parallel terminals → explicit git paths, never `git add -A`.
- **Additive only.** No file is removed, no `beat_type` touched. Absent `audio-plan.json` → today's exact behavior (loads the two separate cue files).
- **`pause` ≠ `dry`.** `pause` (punctual, inserts silence, shifts timeline) buckets with SFX cues; `dry` (span, carves existing silence) buckets with music dry-spans. Never merge them.
- Reuse the ONE shared matcher (`render.match_shots_to_tokens`) via the existing resolvers — do not reimplement anchor resolution.

---

### Task 1: `audio-plan-schema.md` + `audio_plan.py` (load + split)

**Files:**
- Create: `.claude/skills/render-builder/references/audio-plan-schema.md`
- Create: `.claude/skills/render-builder/scripts/audio_plan.py`
- Test: `.claude/skills/render-builder/scripts/test_audio_plan.py`

**Interfaces:**
- Produces: `audio_plan.py::split_plan(plan) -> (audio_cues, music_cues, music_dry)` where the three lists are in the EXISTING shapes `resolve_cues` / `resolve_music_cues` already accept; and `load_audio_plan(video_dir) -> plan|None` (reads `videos/<slug>/audio-plan.json`).

- [ ] **Step 1: Write the schema doc** `audio-plan-schema.md`

```markdown
# audio-plan.json — the unified audio plan (audio-director output)

One ordered `cues` array, each cue `{kind, …}`. Merges today's audio-cues.json + music-cues.json into
one file. `build_motion` splits it back into the existing internal shapes (audio_plan.split_plan) and
feeds the existing resolvers — so the realizers are unchanged.

## Cue kinds
- `{ "kind": "sfx",   "anchor": "<verbatim VO words>", "role": "<sfx_pools role>", "gain_db"?: n }`
- `{ "kind": "pause", "anchor": "<verbatim VO words>", "pause_s": n, "in_pause"?: true }`
- `{ "kind": "music", "from_anchor": "<≥4 verbatim VO words>", "mood": "<music_pools mood>", "level_db"?: n }`
- `{ "kind": "dry",   "from_anchor": "<verbatim VO words>", "to_anchor"?: "<verbatim VO words>" }`

## Rules
- `sfx`/`pause` are PUNCTUAL (single `anchor`); `music`/`dry` are SPANS (`from_anchor` [+ `to_anchor`]).
- `pause` INSERTS silence + shifts the timeline; `dry` CARVES existing silence (no shift). NEVER conflate.
- Anchors resolve via the shared `render.match_shots_to_tokens` matcher (cursor-advancing, narration order).
- Absent file = no-op (build_motion falls back to the separate cue files, or none).
```

- [ ] **Step 2: Write the failing test** `test_audio_plan.py`

```python
"""Unit tests for the unified audio-plan splitter (plain-assert)."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from audio_plan import split_plan


def test_splits_by_kind_into_existing_shapes():
    plan = {"cues": [
        {"kind": "sfx", "anchor": "the whole thing", "role": "cash", "gain_db": -6},
        {"kind": "pause", "anchor": "never came home", "pause_s": 0.6, "in_pause": True},
        {"kind": "music", "from_anchor": "It all started with", "mood": "sneaky", "level_db": 7},
        {"kind": "dry", "from_anchor": "people started to die", "to_anchor": "made it home"},
    ]}
    a_cues, m_cues, m_dry = split_plan(plan)
    assert a_cues == [
        {"anchor": "the whole thing", "role": "cash", "gain_db": -6},
        {"anchor": "never came home", "pause_s": 0.6, "in_pause": True},
    ], a_cues
    assert m_cues == [{"from_anchor": "It all started with", "mood": "sneaky", "level_db": 7}], m_cues
    assert m_dry == [{"from_anchor": "people started to die", "to_anchor": "made it home"}], m_dry


def test_empty_plan_yields_empty_lists():
    assert split_plan({"cues": []}) == ([], [], [])


def main():
    for fn in [test_splits_by_kind_into_existing_shapes, test_empty_plan_yields_empty_lists]:
        fn(); print("ok", fn.__name__)
    print("OK")


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Run — expect FAIL** (`ModuleNotFoundError: No module named 'audio_plan'`).
Run: `py -3 .claude/skills/render-builder/scripts/test_audio_plan.py`

- [ ] **Step 4: Write `audio_plan.py`**

```python
"""The unified audio plan (audio-director output). Splits one cue list into the EXISTING internal shapes
so the current resolvers/realizers stay unchanged. See references/audio-plan-schema.md."""
import json, os

_SFX_KEYS = ("anchor", "role", "pause_s", "in_pause", "gain_db")
_MUSIC_KEYS = ("from_anchor", "mood", "level_db")
_DRY_KEYS = ("from_anchor", "to_anchor")


def split_plan(plan):
    """Re-bucket the unified cue list into (audio_cues, music_cues, music_dry) — the shapes
    resolve_cues / resolve_music_cues already accept. `sfx`+`pause` -> audio_cues; `music` -> music_cues;
    `dry` -> music_dry."""
    audio_cues, music_cues, music_dry = [], [], []
    for c in plan.get("cues", []):
        kind = c.get("kind")
        if kind in ("sfx", "pause"):
            audio_cues.append({k: c[k] for k in _SFX_KEYS if k in c})
        elif kind == "music":
            music_cues.append({k: c[k] for k in _MUSIC_KEYS if k in c})
        elif kind == "dry":
            music_dry.append({k: c[k] for k in _DRY_KEYS if k in c})
    return audio_cues, music_cues, music_dry


def load_audio_plan(video_dir):
    p = os.path.join(str(video_dir), "audio-plan.json")
    if not os.path.exists(p):
        return None
    with open(p, encoding="utf-8") as f:
        return json.load(f)
```

- [ ] **Step 5: Run — expect PASS.** `py -3 .claude/skills/render-builder/scripts/test_audio_plan.py` → `OK`.

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/render-builder/references/audio-plan-schema.md .claude/skills/render-builder/scripts/audio_plan.py .claude/skills/render-builder/scripts/test_audio_plan.py
git commit -m "feat(render): unified audio-plan schema + splitter (audio-director phase 1)"
```

---

### Task 2: `lint_audio_plan.py` — the unified gate

**Files:**
- Create: `.claude/skills/render-builder/scripts/lint_audio_plan.py`
- Test: `.claude/skills/render-builder/scripts/test_lint_audio_plan.py`

**Interfaces:**
- Produces: `lint_audio_plan.py::lint(plan, sfx_pools, music_pools) -> list[str]` — field validity per kind, `role`∈`sfx_pools`, `mood`∈`music_pools`, `in_pause`→`pause_s`, and the `pause`≠`dry` kind rules. (Anchor RESOLUTION is validated at build time by the existing resolvers; this is field/vocabulary validity.)

- [ ] **Step 1: Write the failing test** `test_lint_audio_plan.py`

```python
"""Unit tests for the unified audio-plan lint (plain-assert)."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from lint_audio_plan import lint

POOLS_SFX = {"cash": ["cash-1"], "boom": ["boom-1"]}
POOLS_MUSIC = {"sneaky": ["sneaky-1"], "casual-bed": ["casual-bed-1"]}


def test_clean_plan_passes():
    plan = {"cues": [
        {"kind": "sfx", "anchor": "a b c d", "role": "cash"},
        {"kind": "pause", "anchor": "e f g h", "pause_s": 0.6},
        {"kind": "music", "from_anchor": "i j k l", "mood": "sneaky"},
        {"kind": "dry", "from_anchor": "m n o p"},
    ]}
    assert lint(plan, POOLS_SFX, POOLS_MUSIC) == []


def test_bad_role_and_mood_and_kind():
    plan = {"cues": [
        {"kind": "sfx", "anchor": "x", "role": "kaboom"},          # role not in pools
        {"kind": "music", "from_anchor": "y", "mood": "techno"},   # mood not in pools
        {"kind": "pause", "anchor": "z", "in_pause": True},        # in_pause without pause_s
        {"kind": "teleport", "anchor": "q"},                       # unknown kind
    ]}
    errs = lint(plan, POOLS_SFX, POOLS_MUSIC)
    assert any("kaboom" in e for e in errs), errs
    assert any("techno" in e for e in errs), errs
    assert any("in_pause" in e for e in errs), errs
    assert any("teleport" in e for e in errs), errs


def main():
    for fn in [test_clean_plan_passes, test_bad_role_and_mood_and_kind]:
        fn(); print("ok", fn.__name__)
    print("OK")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run — expect FAIL** (`ModuleNotFoundError`).
Run: `py -3 .claude/skills/render-builder/scripts/test_lint_audio_plan.py`

- [ ] **Step 3: Write `lint_audio_plan.py`**

```python
#!/usr/bin/env python3
"""Field/vocabulary lint for audio-plan.json. Anchor RESOLUTION is checked at build time by the shared
resolvers; this validates kinds, required fields, and pool membership. Derived check only."""
import json, sys
from pathlib import Path


def lint(plan, sfx_pools, music_pools):
    errors = []
    for i, c in enumerate(plan.get("cues", [])):
        tag = f"cue[{i}]"
        kind = c.get("kind")
        if kind == "sfx":
            if not c.get("anchor"):
                errors.append(f"{tag}: sfx needs anchor")
            if not c.get("role"):
                errors.append(f"{tag}: sfx needs role")
            elif c["role"] not in sfx_pools:
                errors.append(f"{tag}: role '{c['role']}' not in sfx_pools")
        elif kind == "pause":
            if not c.get("anchor"):
                errors.append(f"{tag}: pause needs anchor")
            if not c.get("pause_s"):
                errors.append(f"{tag}: pause needs pause_s")
            if c.get("in_pause") and not c.get("pause_s"):
                errors.append(f"{tag}: in_pause requires pause_s")
        elif kind == "music":
            if not c.get("from_anchor"):
                errors.append(f"{tag}: music needs from_anchor")
            if not c.get("mood"):
                errors.append(f"{tag}: music needs mood")
            elif c["mood"] not in music_pools:
                errors.append(f"{tag}: mood '{c['mood']}' not in music_pools")
        elif kind == "dry":
            if not c.get("from_anchor"):
                errors.append(f"{tag}: dry needs from_anchor")
        else:
            errors.append(f"{tag}: unknown kind '{kind}' (expected sfx|pause|music|dry)")
    return errors


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: lint_audio_plan.py <audio-plan.json> <audio-tokens.json>")
    plan = json.load(open(sys.argv[1], encoding="utf-8"))
    tokens = json.load(open(sys.argv[2], encoding="utf-8"))
    errs = lint(plan, tokens.get("sfx_pools") or {}, tokens.get("music_pools") or {})
    for e in errs:
        print("ERR", e)
    print(f"{len(errs)} error(s)")
    sys.exit(1 if errs else 0)
```

- [ ] **Step 4: Run — expect PASS.** `py -3 .claude/skills/render-builder/scripts/test_lint_audio_plan.py` → `OK`.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/render-builder/scripts/lint_audio_plan.py .claude/skills/render-builder/scripts/test_lint_audio_plan.py
git commit -m "feat(render): lint_audio_plan gate for the unified plan (audio-director phase 1)"
```

---

### Task 3: Wire `build_motion` (additive) + `_chain-test` A/B checkpoint

**Files:**
- Modify: `.claude/skills/render-builder/scripts/build_motion.py:211-221` (prefer `audio-plan.json` when present)
- Create (test data): `channels/the-second-take/videos/_chain-test/audio-plan.json` (converted from its existing cue files)

**Interfaces:**
- Consumes: `audio_plan.load_audio_plan`, `audio_plan.split_plan` (Task 1); the existing `resolve_cues`, `resolve_music_cues`, `cue_role_events`, `breath_gaps`.

- [ ] **Step 1: Add the import + the additive branch in `build_piece_spec`.** Add near the other audio imports:

```python
from audio_plan import load_audio_plan, split_plan  # noqa: E402  (unified plan, additive)
```

Then replace the cue-loading (the block that calls `load_cues(video_dir)` and `load_music_cues(video_dir)`) so a present `audio-plan.json` supplies the three lists, else the existing separate files do:

```python
    _plan = load_audio_plan(video_dir)
    if _plan is not None:
        _a_cues, _m_cues_raw, _m_dry_raw = split_plan(_plan)
    else:
        _a_cues = load_cues(video_dir)
        _m_cues_raw, _m_dry_raw = load_music_cues(video_dir)
    # then feed the EXISTING resolvers with these three (unchanged downstream):
    #   resolve_cues(_a_cues, word_timings) ; resolve_music_cues(_m_cues_raw, _m_dry_raw, word_timings)
```

(Wire `_a_cues` into the existing `resolve_cues(...)` call and `_m_cues_raw`/`_m_dry_raw` into the existing `resolve_music_cues(...)` call at lines ~213/221 — replacing the inline `load_cues(video_dir)` / `load_music_cues(video_dir)` calls. Everything after is unchanged.)

- [ ] **Step 2: Regression check — no plan present = identical behavior.** Run the audio unit tests (they exercise the realizers with no plan):

Run: `py -3 .claude/skills/render-builder/scripts/test_build_audio.py`
Expected: PASS (unchanged — the additive branch is dormant without a plan file).

- [ ] **Step 3: Convert `_chain-test`'s existing cues to one `audio-plan.json`.** Read `channels/the-second-take/videos/_chain-test/audio-cues.json` + `music-cues.json`; write `audio-plan.json` = each audio cue as `{kind: sfx|pause, …}` (pause if it has `pause_s` and no `role`; sfx otherwise; a cue with both stays one sfx cue carrying `pause_s`) + each music cue as `{kind: music, …}` + each dry as `{kind: dry, …}`. Lint it:

Run: `py -3 .claude/skills/render-builder/scripts/lint_audio_plan.py channels/the-second-take/videos/_chain-test/audio-plan.json channels/the-second-take/visual-kit/audio-tokens.json`
Expected: `0 error(s)`.

- [ ] **Step 4: A/B render (the ear-gate checkpoint).** Render `_chain-test` twice — once with the separate cue files (temporarily move `audio-plan.json` aside) and once with the unified `audio-plan.json` — and confirm the `audioSpec` is byte-identical (the plan is a faithful conversion). Diff the emitted `assets/motion/long-form.motion.json` `audioSpec` blocks. **Human ear-gate:** the render with the unified plan sounds identical to before. STOP if it differs.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/render-builder/scripts/build_motion.py channels/the-second-take/videos/_chain-test/audio-plan.json
git commit -m "feat(render): build_motion reads unified audio-plan (additive) + _chain-test A/B (audio-director phase 1)"
```

---

## Phase 1 done — the unified plan exists + round-trips identically. `beat_type` + both cue-writers still work (untouched).

## Next phases (own plans, just-in-time):
- **Phase 2** — build the `audio-director` skill (merge the two cue-writers' procedures → author `audio-plan.json`); retire the old cue-writers.
- **Phase 3** — absorb the structural sounds (whoosh/boom/pop/withhold/breath) into director judgment; `build_audio` stops auto-firing them.
- **Phase 4** — delete `beat_type` (VPW/lint/build_motion/docs); the sweep.
- **Phase 5** — hygiene sweep + `curate-doc` + grep `beat_type` → zero.
