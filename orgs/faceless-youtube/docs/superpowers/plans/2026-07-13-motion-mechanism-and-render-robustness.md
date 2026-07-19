# Motion Mechanism + Render Robustness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the render/engine/motion-planner mechanism honor per-element VO anchoring, a real stamp press-down, map-path routing, and validate animation params — plus stop the scene verify-gate from rejecting layered/hybrid shots — so the layered-motion pipeline runs without hand-bridging.

**Architecture:** Three layers move together. (1) The **contract** — `animation-menu.json` (the single-source vocabulary) documents param shapes + the `anchor` field; `motion_plan.validate_plan` enforces them. (2) The **Python render driver** — `build_motion.apply_motion_plan` resolves a cutout's VO `anchor` to a shot-relative `start_s`; `render.resolve_scene_files` exempts layered/hybrid shots from the `scenes/<id>.png` gate. (3) The **Remotion engine** — `LayerView` starts slide/path/appear on the resolved `start_s`, adds a `slam` press-down, and token-drives the route-dot colour. `motion-planner`'s rules (`animation-rules.md`) are relaxed so element layers fire wherever a beat has an entering/moving/accreting element (the **camera stays locked** throughout).

**Tech Stack:** Python 3 (plain-assert tests, no pytest), TypeScript + React + Remotion 4.x (Node 24), JSON contracts.

## Global Constraints

- **Tests are plain-assert Python**, run with `py -3 <file>.py` (repo has no pytest). Each test file has a `__main__`/`main()` that calls every test and prints `OK`.
- **The engine has no JS unit harness.** Verify TypeScript with `npx tsc` (engine `tsconfig.json` sets `noEmit`+`strict`), and behaviour with a **render-spike** (a tiny fixture `motion.json` → `node render-video.mjs` → extract a frame with ffmpeg → eyeball).
- **ELEMENT motion only — the CAMERA stays LOCKED.** No task derives or enables a camera move (`camera.move` stays `none`, `intensity` `0.0`). This is deliberate and unchanged.
- **One vocabulary, one home per concept.** Use exactly these terms: **`anchor`** (verbatim VO words an element lands on), **discrete overlay** (a cleanly-mattable element composited on a reused plate), **layered / hybrid** (a shot rendered as `plate` + cutout layers; a *hybrid* reuses the prior in-stage scene as its plate). Define each field once (the schema/menu), resolve once (`build_motion`), render once (engine), author once (`motion-planner`). Change stale rule text in place — never append.
- **Shared cross-plan contract (do NOT change here):** the scenes manifest carries `verified:{scene,rig}` per shot, and **a layered/hybrid shot has no `scenes/<id>.png`**. Fix #7 (Task 4) *reads* this — it exempts layered ids from the gate. The **separate visual-authoring plan** makes `image-generation` *write* `verified` and the `plates/`+`cutouts/` assets. This plan does not touch `image-generation`, `style-bible`, or `visual-prompt-writer`.
- **Scope:** Phase B (B0–B4) + the render-side of Phase C (C3, plus sweep fixes #2/#6; #3 is folded into B2). Phases A and D, and image-gen-side C1/C2, are the other plan.

---

### Task 1: Animation contract — param shapes in `animation-menu.json` + param validation in `validate_plan` (C3)

**Files:**
- Modify: `.claude/skills/render-builder/references/animation-menu.json` (cutout entries, lines 8–13)
- Modify: `.claude/skills/render-builder/scripts/motion_plan.py:16-46` (`validate_plan`)
- Test: `.claude/skills/render-builder/scripts/test_motion_plan.py` (extend)

**Interfaces:**
- Consumes: `menu.valid_animation(menu, source, atype)` (unchanged), `menu.load_menu()`.
- Produces: `validate_plan(plan, menu) -> list[str]` — now ALSO returns param-shape errors for `source:"cutout"` animations. New error strings contain the shot id, layer id, the param name, and the word `param`. Recognized cutout param shapes (the contract Task 3/Task 5 rely on): `slide.to`=`[x,y]` numeric, `slide.dur_s`>0; `path.points`=exactly three `[x,y]`, `path.dur_s`>0; `bob.at`=`[x,y]` (optional); `appear.at`=`[x,y]` (optional), `appear.at_s`=number (optional), `appear.style`∈`pop|fade|slam` (optional); `anchor`=non-empty string (optional, on slide/path/appear).

- [ ] **Step 1: Write the failing tests**

Add to `.claude/skills/render-builder/scripts/test_motion_plan.py` (before `def main()`):

```python
def test_slide_to_must_be_coord():
    plan = {"shots": [{"id": "L01", "background": {"mode": "plate", "plate_prompt": "x"},
            "layers": [{"id": "c", "source": "cutout", "cutout_prompt": "x",
                        "animation": {"type": "slide", "to": "center", "dur_s": 1.8}}]}]}
    errs = validate_plan(plan, load_menu())
    assert any("param" in e and "to" in e for e in errs), errs


def test_slide_needs_positive_dur():
    plan = {"shots": [{"id": "L01", "background": {"mode": "plate", "plate_prompt": "x"},
            "layers": [{"id": "c", "source": "cutout", "cutout_prompt": "x",
                        "animation": {"type": "slide", "to": [0.5, 0.9], "dur_s": 0}}]}]}
    errs = validate_plan(plan, load_menu())
    assert any("param" in e and "dur_s" in e for e in errs), errs


def test_path_needs_exactly_three_points():
    plan = {"shots": [{"id": "L03", "background": {"mode": "plate", "plate_prompt": "map"},
            "layers": [{"id": "ship", "source": "cutout", "cutout_prompt": "ship",
                        "animation": {"type": "path", "points": [[0, 0], [1, 1]], "dur_s": 3}}]}]}
    errs = validate_plan(plan, load_menu())
    assert any("param" in e and "points" in e for e in errs), errs


def test_appear_style_enum_and_anchor_type():
    plan = {"shots": [{"id": "L07", "background": {"mode": "delta-chain", "plate": "scenes/L06.png"},
            "layers": [{"id": "stamp", "source": "cutout", "cutout_prompt": "stamp",
                        "animation": {"type": "appear", "style": "explode", "anchor": ""}}]}]}
    errs = validate_plan(plan, load_menu())
    assert any("param" in e and "style" in e for e in errs), errs
    assert any("param" in e and "anchor" in e for e in errs), errs


def test_valid_cutout_params_ok():
    plan = {"shots": [{"id": "L13", "background": {"mode": "plate", "plate_prompt": "stage"},
            "layers": [{"id": "mac", "source": "cutout", "cutout_prompt": "man",
                        "animation": {"type": "slide", "from_edge": "left", "to": [0.5, 0.9],
                                      "dur_s": 1.8, "anchor": "MacGregor stepped forward"}}]}]}
    assert validate_plan(plan, load_menu()) == []
```

Add each new function name to the `main()` loop list in the same file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `py -3 .claude/skills/render-builder/scripts/test_motion_plan.py`
Expected: FAIL — `test_slide_to_must_be_coord` (and the others) `AssertionError` because `validate_plan` currently checks type only, not params.

- [ ] **Step 3: Add the param validator to `validate_plan`**

In `.claude/skills/render-builder/scripts/motion_plan.py`, add these module-level helpers after the `_DEVICE_CONTENT` dict (before `def validate_plan`):

```python
_SLIDE_EDGES = {"left", "right", "top", "bottom"}
_APPEAR_STYLES = {"pop", "fade", "slam"}


def _num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _coord(v):
    return isinstance(v, (list, tuple)) and len(v) == 2 and all(_num(x) for x in v)


def _cutout_param_errors(sid, lid, atype, anim):
    """Shape-check a cutout animation's params (type-check happened already). Every message
    contains the word 'param' + the offending key so lint/tests can assert on it."""
    e = []
    def bad(key, why):
        e.append(f"{sid}/{lid}: {atype} param '{key}' {why}")
    if "anchor" in anim and not (isinstance(anim["anchor"], str) and anim["anchor"].strip()):
        bad("anchor", "must be a non-empty string of verbatim VO words")
    if atype == "slide":
        if not _coord(anim.get("to")):
            bad("to", "must be a 2-element numeric [x,y] coord")
        if not (_num(anim.get("dur_s")) and anim["dur_s"] > 0):
            bad("dur_s", "must be a number > 0")
        if "from_edge" in anim and anim["from_edge"] not in _SLIDE_EDGES:
            bad("from_edge", f"must be one of {sorted(_SLIDE_EDGES)}")
    elif atype == "path":
        pts = anim.get("points")
        if not (isinstance(pts, (list, tuple)) and len(pts) == 3 and all(_coord(p) for p in pts)):
            bad("points", "must be exactly three 2-element numeric [x,y] coords")
        if not (_num(anim.get("dur_s")) and anim["dur_s"] > 0):
            bad("dur_s", "must be a number > 0")
    elif atype == "bob":
        if "at" in anim and not _coord(anim["at"]):
            bad("at", "must be a 2-element numeric [x,y] coord")
    elif atype == "appear":
        if "at" in anim and not _coord(anim["at"]):
            bad("at", "must be a 2-element numeric [x,y] coord")
        if "at_s" in anim and not _num(anim["at_s"]):
            bad("at_s", "must be a number (shot-relative seconds)")
        if "style" in anim and anim["style"] not in _APPEAR_STYLES:
            bad("style", f"must be one of {sorted(_APPEAR_STYLES)}")
    return e
```

Then, inside `validate_plan`, extend the `anim` block (the `if anim is not None:` branch at the end of the layer loop) so it calls the param checker after a valid cutout type:

```python
            anim = layer.get("animation")
            if anim is not None:
                atype = anim.get("type")
                if not valid_animation(menu, src, atype):
                    errors.append(f"{sid}/{lid}: animation '{atype}' not on the {src} menu")
                elif src == "cutout":
                    errors.extend(_cutout_param_errors(sid, lid, atype, anim))
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `py -3 .claude/skills/render-builder/scripts/test_motion_plan.py`
Expected: PASS — prints `ok test_slide_to_must_be_coord` … and `OK`.

- [ ] **Step 5: Document each param's SHAPE in `animation-menu.json`**

In `.claude/skills/render-builder/references/animation-menu.json`, replace the four cutout animation lines (currently lines 8–11) with these — adding `anchor` to the `params` of appear/slide/path and a `shapes` doc object to each cutout entry:

```json
        "appear": {"params": ["at_s", "style", "at", "anchor"], "style_enum": ["pop", "fade", "slam"], "shapes": {"at": "[x,y] 0-1 (opt, default [0.5,0.5])", "at_s": "shot-relative seconds (opt)", "style": "pop|fade|slam (opt, default pop)", "anchor": "verbatim VO words (opt) — resolved to a shot-relative start_s at build"}, "asset": "one cutout", "engine": "spring/opacity/slam at t", "status": "proven"},
        "bob":    {"params": ["amp", "period", "at"], "shapes": {"amp": "px (opt)", "period": "seconds (opt)", "at": "[x,y] 0-1 (opt)"}, "asset": "one cutout", "engine": "sine translate in place", "status": "trivial"},
        "slide":  {"params": ["from_edge", "to", "dur_s", "easing", "anchor"], "shapes": {"from_edge": "left|right|top|bottom", "to": "[x,y] 0-1 (required)", "dur_s": "seconds > 0 (required)", "easing": "css/remotion easing name (opt)", "anchor": "verbatim VO words (opt)"}, "asset": "one cutout", "engine": "ease-out translate", "status": "proven"},
        "path":   {"params": ["points", "dur_s", "draw_line", "anchor"], "shapes": {"points": "exactly three [x,y] 0-1 coords (bezier)", "dur_s": "seconds > 0 (required)", "draw_line": "bool (opt) — engine trails route dots", "anchor": "verbatim VO words (opt)"}, "asset": "one cutout (line is engine-drawn)", "engine": "bezier sample + optional draw-on", "status": "proven"},
```

- [ ] **Step 6: Verify the menu still loads (menu.py invariants intact)**

Run: `py -3 .claude/skills/render-builder/scripts/test_menu.py`
Expected: PASS (each cutout entry still has `asset` + `engine`; extra `shapes` key is ignored by `load_menu`).

- [ ] **Step 7: Commit**

```bash
git add .claude/skills/render-builder/scripts/motion_plan.py \
        .claude/skills/render-builder/scripts/test_motion_plan.py \
        .claude/skills/render-builder/references/animation-menu.json
git commit -m "feat(render): validate cutout animation params + document param shapes (C3)"
```

---

### Task 2: Lint guard — a delta-chain base must never be a hybrid (sweep fix #6)

**Files:**
- Modify: `.claude/skills/motion-planner/scripts/lint_motion_plan.py`
- Test: `.claude/skills/motion-planner/scripts/test_lint_motion_plan.py` (create)

**Interfaces:**
- Consumes: `motion_plan.validate_plan` + `menu.load_menu` (via the existing `sys.path` insert), the plan dict.
- Produces: `lint(plan, shots_ids) -> list[str]` — now also emits, for every **hybrid** shot (a `delta-chain` shot carrying ≥1 `cutout` layer), an error when its `background.plate` (`scenes/<base-id>.png`) names a base that is itself a hybrid. Error string contains the shot id + the word `hybrid`.

- [ ] **Step 1: Write the failing test**

Create `.claude/skills/motion-planner/scripts/test_lint_motion_plan.py`:

```python
"""Plain-assert tests for lint_motion_plan cross-shot checks (repo has no pytest)."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from lint_motion_plan import lint

IDS = {"L05", "L06", "L07"}


def _hybrid(sid, base):
    return {"id": sid, "background": {"mode": "delta-chain", "plate": f"scenes/{base}.png"},
            "layers": [{"id": "stamp", "source": "cutout", "cutout_prompt": "a stamp",
                        "animation": {"type": "appear", "style": "slam"}}]}


def test_hybrid_seeding_from_baked_base_is_ok():
    # L07 (hybrid) reuses L06, a normal baked scene -> fine.
    plan = {"shots": [
        {"id": "L06", "background": {"mode": "plate", "plate": "scenes/L06.png"}, "layers": []},
        _hybrid("L07", "L06")]}
    assert [e for e in lint(plan, IDS) if "hybrid" in e] == [], lint(plan, IDS)


def test_hybrid_seeding_from_a_hybrid_base_errors():
    # L06 is itself a hybrid (no baked composite); L07 reuses it -> must flag.
    plan = {"shots": [_hybrid("L06", "L05"), _hybrid("L07", "L06")]}
    errs = lint(plan, IDS)
    assert any("L07" in e and "hybrid" in e for e in errs), errs


if __name__ == "__main__":
    test_hybrid_seeding_from_baked_base_is_ok()
    test_hybrid_seeding_from_a_hybrid_base_errors()
    print("OK")
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `py -3 .claude/skills/motion-planner/scripts/test_lint_motion_plan.py`
Expected: FAIL — `test_hybrid_seeding_from_a_hybrid_base_errors` `AssertionError` (no such check yet).

- [ ] **Step 3: Add the hybrid-base guard to `lint`**

In `.claude/skills/motion-planner/scripts/lint_motion_plan.py`, add `import re` to the top imports (`import json, sys, re`), and add these before `def lint`:

```python
def _hybrid_ids(plan):
    """Shot ids that are HYBRIDS — a delta-chain shot carrying a discrete-overlay cutout. A hybrid
    composites plate+cutout only at render, so it produces NO baked composite for a later delta to
    seed from."""
    ids = set()
    for shot in plan.get("shots", []):
        bg = shot.get("background") or {}
        if bg.get("mode") == "delta-chain" and any(
                l.get("source") == "cutout" for l in shot.get("layers", [])):
            ids.add(shot.get("id"))
    return ids
```

Then inside `lint`, after the existing per-shot loop (before `return errors`), add:

```python
    hybrids = _hybrid_ids(plan)
    for shot in plan.get("shots", []):
        if shot.get("id") not in hybrids:
            continue
        plate = ((shot.get("background") or {}).get("plate")) or ""
        m = re.match(r"scenes/(.+)\.png$", plate)
        base_id = m.group(1) if m else None
        if base_id and base_id in hybrids:
            errors.append(
                f"{shot.get('id')}: delta-chain base '{base_id}' is itself a hybrid — "
                f"a hybrid produces no baked composite to seed from")
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `py -3 .claude/skills/motion-planner/scripts/test_lint_motion_plan.py`
Expected: PASS — prints `OK`.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/motion-planner/scripts/lint_motion_plan.py \
        .claude/skills/motion-planner/scripts/test_lint_motion_plan.py
git commit -m "feat(motion-planner): lint guard — a delta-chain base must not be a hybrid (fix #6)"
```

---

### Task 3: Per-element VO anchor for cutouts — build_motion resolution + schema (B2, folds sweep fix #3)

**Files:**
- Modify: `.claude/skills/render-builder/scripts/build_motion.py:144-196` (`apply_motion_plan`)
- Modify: `.claude/skills/render-builder/references/shots-motion-schema.md`
- Test: `.claude/skills/render-builder/scripts/test_motion_plan_merge.py` (extend)

**Interfaces:**
- Consumes: `render.anchor_time(anchor, word_timings) -> float | None` (already imported in build_motion); `word_timings` (the pause-shifted `[[word, start_s], …]` stream, already passed into `apply_motion_plan`).
- Produces: `apply_motion_plan(shots, plan, assets_dir=None, allow_missing=False, word_timings=None)` — the cutout branch now writes a **shot-relative `start_s`** (seconds) into a layer's `animation` when the animation carries an `anchor` that resolves against `word_timings` (`start_s = max(0, anchor_time − shot.start_s)`). Device-card anchoring (the `engine` branch) is unchanged. The engine (Task 5) reads `animation.start_s`.

- [ ] **Step 1: Write the failing test**

Add to `.claude/skills/render-builder/scripts/test_motion_plan_merge.py` (before `if __name__`):

```python
def test_cutout_anchor_resolves_to_shot_relative_start():
    wt = [["The", 100.0], ["ship", 100.4], ["left", 100.9], ["harbor", 101.3],
          ["that", 102.4], ["autumn", 102.7]]
    plan = {"shots": [{"id": "L03", "background": {"mode": "plate", "plate_prompt": "map"},
            "layers": [{"id": "ship", "source": "cutout", "cutout_prompt": "a ship",
                        "animation": {"type": "path", "points": [[0, 0.5], [0.5, 0.4], [1, 0.5]],
                                      "dur_s": 3.0, "anchor": "that autumn"}}]}]}
    out = apply_motion_plan([{"id": "L03", "start_s": 100.0, "duration_s": 5.0}],
                            plan, word_timings=wt)
    # "that autumn" starts at 102.4; shot starts at 100.0 -> start_s = 2.4
    assert out[0]["layers"][0]["animation"]["start_s"] == 2.4, out[0]["layers"][0]


def test_cutout_without_anchor_has_no_start_s():
    plan = {"shots": [{"id": "L13", "background": {"mode": "plate", "plate_prompt": "stage"},
            "layers": [{"id": "mac", "source": "cutout", "cutout_prompt": "man",
                        "animation": {"type": "slide", "to": [0.5, 0.9], "dur_s": 1.8}}]}]}
    out = apply_motion_plan([{"id": "L13", "start_s": 50.0, "duration_s": 4.0}],
                            plan, word_timings=[["x", 1.0]])
    assert "start_s" not in out[0]["layers"][0]["animation"], out[0]["layers"][0]
```

Add both names to the `__main__` call list at the bottom of the file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `py -3 .claude/skills/render-builder/scripts/test_motion_plan_merge.py`
Expected: FAIL — `test_cutout_anchor_resolves_to_shot_relative_start` `KeyError`/`AssertionError` (no `start_s` written).

- [ ] **Step 3: Add the anchor resolver + wire it into the cutout branch**

In `.claude/skills/render-builder/scripts/build_motion.py`, add this helper directly above `def apply_motion_plan` (near line 143):

```python
def _resolve_cutout_anim(anim, shot_start_s, word_timings):
    """Copy a cutout `animation`, resolving an optional VO `anchor` (verbatim words) to a
    SHOT-RELATIVE `start_s` (= anchor_time − shot_start), so LayerView starts the slide/path/appear
    window on the spoken word instead of the hardcoded frame-4 lead-in (the same word-timing matcher
    the device cards use). No anchor / no timings / no match → returned unchanged."""
    if not isinstance(anim, dict):
        return anim
    at = anchor_time(anim.get("anchor"), word_timings)
    if at is None:
        return anim
    out = dict(anim)
    out["start_s"] = round(max(0.0, at - (shot_start_s or 0.0)), 3)
    return out
```

Then, inside `apply_motion_plan`, move the `start_s` read to the top of the per-shot loop and use the resolver in the cutout-layer build. Replace the current cutout branch (the `if cutouts:` block, lines ~161-180, ending at the `shot["layers"] = [...]` list comp) so that:

Current:
```python
        sid = shot["id"]
        layers = entry.get("layers", [])
        cutouts = [l for l in layers if l.get("source") == "cutout"]
        if cutouts:
```
becomes:
```python
        sid = shot["id"]
        start_s = shot.get("start_s", 0.0)
        layers = entry.get("layers", [])
        cutouts = [l for l in layers if l.get("source") == "cutout"]
        if cutouts:
```

and the assignment inside that block:
```python
                shot["plate"] = plate_rel
                shot["layers"] = [{"id": l["id"], "src": rel,
                                   "animation": l.get("animation")} for l, rel in cut_rels]
```
becomes:
```python
                shot["plate"] = plate_rel
                shot["layers"] = [{"id": l["id"], "src": rel,
                                   "animation": _resolve_cutout_anim(
                                       l.get("animation"), start_s, word_timings)}
                                  for l, rel in cut_rels]
```

Then delete the now-duplicate `start_s = shot.get("start_s", 0.0)` line that currently sits just after the cutout block (was line ~181), keeping the single `dur = shot.get("duration_s", 0.0)` line and the engine loop below it unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `py -3 .claude/skills/render-builder/scripts/test_motion_plan_merge.py`
Expected: PASS — prints `OK` (existing tests, incl. `test_device_card_pins_to_anchor` and `test_hybrid_overlay_reuses_prior_scene_as_plate`, still pass).

- [ ] **Step 5: Document the cutout `anchor` in the schema**

In `.claude/skills/render-builder/references/shots-motion-schema.md`, replace the cutout bullet under "Per long-form shot → `layers`":

Current:
```
  - cutout: `cutout_prompt` (str) + `animation`.
```
New:
```
  - cutout: `cutout_prompt` (str) + `animation`. The `animation` MAY carry an **`anchor`** (verbatim VO
    words the element lands on) — the same convention device cards use. `build_motion.apply_motion_plan`
    resolves it (via `render.anchor_time`) to a **shot-relative `start_s`** written into the animation, and
    the engine `LayerView` starts the slide/path/appear window there instead of the default frame-4 lead-in.
    No `anchor` → the element enters at the shot cut (frame 4).
```

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/render-builder/scripts/build_motion.py \
        .claude/skills/render-builder/scripts/test_motion_plan_merge.py \
        .claude/skills/render-builder/references/shots-motion-schema.md
git commit -m "feat(render): resolve per-cutout VO anchor to a shot-relative start_s (B2, fix #3)"
```

---

### Task 4: Scene verify-gate exempts layered/hybrid shots (sweep fix #7)

**Files:**
- Modify: `.claude/skills/render-builder/scripts/render.py:192-245` (`resolve_scene_files`)
- Modify: `.claude/skills/render-builder/scripts/motion_plan.py` (add `cutout_layer_ids`)
- Modify: `.claude/skills/render-builder/scripts/build_motion.py:312-391` (`build_piece_spec` — load the plan once, compute layered ids, pass to `resolve_scene_files`, reuse for `apply_motion_plan`)
- Test: `.claude/skills/render-builder/scripts/test_resolve_scene_files.py` (create)

**Interfaces:**
- Consumes: `motion_plan.cutout_layer_ids(plan) -> set[str]` (new — ids of shots the plan materializes as plate+cutout, i.e. any shot with ≥1 `source:"cutout"` layer; these have no `scenes/<id>.png`).
- Produces: `resolve_scene_files(scenes_dir, piece, shots, is_short, allow_missing, layered_ids=None)` — a shot whose id is in `layered_ids` is treated like an INLINE-fallback source: it gets a `None` scene file, is **not** added to `missing`/`gate_failed`, and never triggers the hard error. `apply_motion_plan` (Task 3) then supplies its `plate`+`layers`. Engine-only device-card shots are NOT layered (they keep `scenes/<id>.png`) and stay gated.

- [ ] **Step 1: Write the failing test**

Create `.claude/skills/render-builder/scripts/test_resolve_scene_files.py`:

```python
"""resolve_scene_files exempts layered/hybrid shots from the scene gate (plain-assert)."""
import sys, os, tempfile
sys.path.insert(0, os.path.dirname(__file__))
from pathlib import Path
from render import resolve_scene_files


def test_layered_shot_is_exempt_non_layered_still_hard_errors():
    with tempfile.TemporaryDirectory() as d:
        scenes = Path(d) / "scenes"
        scenes.mkdir()
        shots = [{"id": "L07"}, {"id": "L08"}]   # neither has a PNG; both ai-gen
        # L07 is layered -> exempt; L08 is a normal ai-gen shot with no PNG -> hard error.
        raised = False
        try:
            resolve_scene_files(scenes, "long-form", shots, False, allow_missing=False,
                                layered_ids={"L07"})
        except SystemExit:
            raised = True
        assert raised, "expected a hard error for the un-materialized non-layered L08"


def test_all_layered_no_error_and_none_files():
    with tempfile.TemporaryDirectory() as d:
        scenes = Path(d) / "scenes"
        scenes.mkdir()
        shots = [{"id": "L07"}, {"id": "L09"}]
        files, allowed = resolve_scene_files(scenes, "long-form", shots, False,
                                             allow_missing=False, layered_ids={"L07", "L09"})
        assert files == [None, None], files
        assert allowed == [], allowed   # not counted as allow-missing fallbacks


if __name__ == "__main__":
    test_layered_shot_is_exempt_non_layered_still_hard_errors()
    test_all_layered_no_error_and_none_files()
    print("OK")
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `py -3 .claude/skills/render-builder/scripts/test_resolve_scene_files.py`
Expected: FAIL — `TypeError: resolve_scene_files() got an unexpected keyword argument 'layered_ids'`.

- [ ] **Step 3: Add `cutout_layer_ids` to motion_plan.py**

Append to `.claude/skills/render-builder/scripts/motion_plan.py`:

```python
def cutout_layer_ids(plan):
    """Shot ids the plan materializes as plate+cutout (a plain layered shot OR a hybrid). These have
    NO scenes/<id>.png — image-gen writes plates/<id>.png + cutouts/<id>-<layer>.png instead — so the
    render-builder scene gate (render.resolve_scene_files) must EXEMPT them."""
    ids = set()
    for shot in (plan or {}).get("shots", []):
        if any(l.get("source") == "cutout" for l in shot.get("layers", [])):
            ids.add(shot.get("id"))
    return ids
```

- [ ] **Step 4: Add the `layered_ids` exemption to `resolve_scene_files`**

In `.claude/skills/render-builder/scripts/render.py`, change the signature and the fallback test.

Signature (line ~192):
```python
def resolve_scene_files(scenes_dir: Path, piece: str, shots: list, is_short: bool,
                        allow_missing: bool):
```
becomes:
```python
def resolve_scene_files(scenes_dir: Path, piece: str, shots: list, is_short: bool,
                        allow_missing: bool, layered_ids=None):
```

Just inside the function body, before the loop (after `manifest = _load_scene_manifest(scenes_dir)`), add:
```python
    layered_ids = layered_ids or set()
```

Then change the per-shot fallback flag so a layered id is exempt exactly like an inline-fallback source. Current:
```python
        is_fallback = (shot.get("source") or "ai-gen") in INLINE_FALLBACK_SOURCES
```
becomes:
```python
        is_fallback = ((shot.get("source") or "ai-gen") in INLINE_FALLBACK_SOURCES
                       or sid in layered_ids)
```

(The rest of the loop already appends `None` for a fallback with no valid PNG and never records it in `missing`/`gate_failed`, so a layered shot yields `None` and no error. Update the docstring's gate sentence to add: "A shot whose id is in `layered_ids` — the motion plan materializes it as plate+cutout — is exempt (it has no scenes/<id>.png; apply_motion_plan supplies its plate+layers).")

- [ ] **Step 5: Run the test to verify it passes**

Run: `py -3 .claude/skills/render-builder/scripts/test_resolve_scene_files.py`
Expected: PASS — prints `OK`.

- [ ] **Step 6: Wire the plan into `build_piece_spec` (load once; feed the gate + apply_motion_plan)**

In `.claude/skills/render-builder/scripts/build_motion.py`, first extend the `render` import list (lines 30-40) — it already imports `resolve_scene_files`; add the new helper to the `motion_plan`/menu path. Add near the other `sys.path`-based imports (after the `render` import block):

```python
from motion_plan import cutout_layer_ids  # noqa: E402  (scene-gate exemption for layered shots)
```

Then in `build_piece_spec`, replace the scene-resolution lead-in. Current (lines ~315-318):
```python
    if args.max_shots:
        shots = shots[: args.max_shots]

    scene_files, missing = resolve_scene_files(scenes_dir, piece, shots, is_short, allow_missing)
```
becomes:
```python
    if args.max_shots:
        shots = shots[: args.max_shots]

    mp = getattr(args, "motion_plan", None)
    motion_plan = json.load(open(mp, encoding="utf-8")) if mp and Path(mp).exists() else None
    layered_ids = cutout_layer_ids(motion_plan)   # {} when no plan → no exemption
    scene_files, missing = resolve_scene_files(scenes_dir, piece, shots, is_short, allow_missing,
                                               layered_ids=layered_ids)
```

Then replace the later re-read of the plan (lines ~387-391):
```python
    mp = getattr(args, "motion_plan", None)
    if mp and Path(mp).exists():
        apply_motion_plan(spec["shots"], json.load(open(mp, encoding="utf-8")),
                          assets_dir=assets_dir, allow_missing=args.allow_missing,
                          word_timings=word_timings)
```
with (reuse the already-loaded `motion_plan`):
```python
    if motion_plan is not None:
        apply_motion_plan(spec["shots"], motion_plan,
                          assets_dir=assets_dir, allow_missing=args.allow_missing,
                          word_timings=word_timings)
```

- [ ] **Step 7: Verify the whole render-builder suite still passes (no regression)**

Run:
```bash
for t in test_motion_plan test_motion_plan_merge test_resolve_scene_files test_menu test_build_motion test_chapter_ranges; do py -3 ".claude/skills/render-builder/scripts/$t.py"; done
```
Expected: each prints `OK` (or `ok …` lines then `OK`).

- [ ] **Step 8: Commit**

```bash
git add .claude/skills/render-builder/scripts/render.py \
        .claude/skills/render-builder/scripts/motion_plan.py \
        .claude/skills/render-builder/scripts/build_motion.py \
        .claude/skills/render-builder/scripts/test_resolve_scene_files.py
git commit -m "feat(render): scene gate exempts layered/hybrid shots (fix #7)"
```

---

### Task 5: Engine — anchor start, stamp slam, token-driven route dots (B2 honor + B3 + B4 engine)

**Files:**
- Modify: `.claude/skills/render-builder/engine/src/tokens.ts:85-90` (`LayerAnimation` type)
- Modify: `.claude/skills/render-builder/engine/src/components.tsx:520-590` (`LayerView`)
- Modify: `.claude/skills/render-builder/engine/src/Video.tsx:75-77` (pass `tokens` to `LayerView`)
- Modify: `.claude/skills/render-builder/references/animation-menu.json` (note `slam` implemented)
- Verify: `npx tsc` + a render-spike (fixture `motion.json` → frame extract)

**Interfaces:**
- Consumes: `animation.start_s` (shot-relative seconds, written by Task 3), `animation.style` (`pop|fade|slam`), `MotionTokens.palette.ink` (route-dot colour).
- Produces: `LayerView: React.FC<{layer: LayerSpec; tokens: MotionTokens}>` — slide/path/appear windows start at `Math.round(start_s*fps)` when present (else frame 4 / appear's `at_s` / 0); `appear` honors `style:"slam"` (drop-down press) and `style:"fade"` (opacity-only); `path` `draw_line` dots use `tokens.palette.ink`.

- [ ] **Step 1: Extend the `LayerAnimation` type**

In `.claude/skills/render-builder/engine/src/tokens.ts`, replace the `LayerAnimation` union (lines 85-89) with (adds `anchor?` + `start_s?` to slide/path/appear):

```typescript
export type LayerAnimation =
  | {type: 'slide'; from_edge?: 'left' | 'right' | 'top' | 'bottom'; to: [number, number]; dur_s: number; easing?: string; height_frac?: number; anchor?: string; start_s?: number}
  | {type: 'path'; points: [number, number][]; dur_s: number; draw_line?: boolean; height_frac?: number; anchor?: string; start_s?: number}
  | {type: 'bob'; amp?: number; period?: number; at?: [number, number]; height_frac?: number}
  | {type: 'appear'; at_s?: number; style?: 'pop' | 'fade' | 'slam'; at?: [number, number]; height_frac?: number; anchor?: string; start_s?: number};
```

- [ ] **Step 2: Update `LayerView` — signature, start frame, slam, route-dot token**

In `.claude/skills/render-builder/engine/src/components.tsx`, change the `LayerView` signature (line 520) to take `tokens`:

```typescript
export const LayerView: React.FC<{layer: LayerSpec; tokens: MotionTokens}> = ({layer, tokens}) => {
```

Add a shared start-frame helper right after `const imgH = hf * height;` (line ~526):

```typescript
  // The entry window starts on the resolved VO anchor (a.start_s, shot-relative) when present,
  // else the default frame-4 lead-in. LayerView renders inside the shot's Sequence, so frames
  // are already shot-relative.
  const startF = a.start_s != null ? Math.max(0, Math.round(a.start_s * fps)) : 4;
```

In the `slide` branch, replace the interpolate window `[4, 4 + dur]` with `[startF, startF + dur]`:
```typescript
    const p = interpolate(frame, [startF, startF + dur], [0, 1], {
```

In the `path` branch, replace `[4, 4 + dur]` with `[startF, startF + dur]` the same way, and replace the hardcoded dot fill:
```typescript
        dots.push(<circle key={i} cx={d.x} cy={d.y} r={5} fill="#3a2a1a" opacity={0.9} />);
```
with:
```typescript
        dots.push(<circle key={i} cx={d.x} cy={d.y} r={5} fill={tokens.palette.ink} opacity={0.9} />);
```

Replace the whole `// appear` tail (lines ~580-589) with a style-aware version (honors `start_s`, adds `slam`, keeps `pop`/`fade`):

```typescript
  // appear — style: pop (default) | fade | slam. Entry frame = the resolved anchor (start_s),
  // else the authored at_s (shot-relative), else 0.
  const atF = Math.round(((a.start_s ?? a.at_s) ?? 0) * fps);
  const [x, y] = a.at ?? [0.5, 0.5];
  const style = a.style ?? 'pop';
  if (style === 'slam') {
    // A stamp pressing onto paper: enter slightly large + above, drop DOWN with a small overshoot.
    const s = spring({frame: frame - atF, fps, config: {damping: 9, mass: 0.5}});
    const dy = interpolate(s, [0, 1], [-height * 0.06, 0]);
    const sc = interpolate(s, [0, 0.7, 1], [1.25, 0.94, 1]);
    const op = interpolate(s, [0, 0.25], [0, 1], {extrapolateRight: 'clamp'});
    return (
      <Img
        src={src}
        style={{position: 'absolute', left: x * width, top: y * height + dy, height: imgH, width: 'auto', opacity: op, transform: `translate(-50%, -50%) scale(${sc})`}}
      />
    );
  }
  const pop = spring({frame: frame - atF, fps, config: {damping: 12}});
  const sc = style === 'fade' ? 1 : interpolate(pop, [0, 1], [0.8, 1]);
  return (
    <Img
      src={src}
      style={{position: 'absolute', left: x * width, top: y * height, height: imgH, width: 'auto', opacity: pop, transform: `translate(-50%, -50%) scale(${sc})`}}
    />
  );
```

- [ ] **Step 3: Pass `tokens` to `LayerView` at the call site**

In `.claude/skills/render-builder/engine/src/Video.tsx`, the layer map (lines 75-77):
```tsx
                        {shot.layers.map((ly) => (
                          <LayerView key={ly.id} layer={ly} />
                        ))}
```
becomes:
```tsx
                        {shot.layers.map((ly) => (
                          <LayerView key={ly.id} layer={ly} tokens={tokens} />
                        ))}
```

- [ ] **Step 4: Typecheck the engine**

Run: `cd .claude/skills/render-builder/engine && npx tsc`
Expected: no output, exit 0 (strict typecheck clean). If `tsc` isn't installed, run `npm install` first.

- [ ] **Step 5: Render-spike — build a fixture and eyeball the three behaviours**

Create the spike assets + fixture (run from repo root; uses ffmpeg to synth solid PNGs):

```bash
SPIKE="$TMPDIR/layerspike"; mkdir -p "$SPIKE/plates" "$SPIKE/cutouts"
ffmpeg -y -f lavfi -i color=c=0x88aa55:s=1920x1080 -frames:v 1 "$SPIKE/plates/spike.png"
ffmpeg -y -f lavfi -i color=c=0xcc2222:s=300x300 -frames:v 1 "$SPIKE/cutouts/spike-stamp.png"
ffmpeg -y -f lavfi -i color=c=0x2244cc:s=200x200 -frames:v 1 "$SPIKE/cutouts/spike-ship.png"
cat > "$SPIKE/fixture.motion.json" <<'JSON'
{
  "schema": "faceless-youtube/motion@1", "piece": "spike", "video_slug": "spike",
  "fps": 30, "width": 1920, "height": 1080, "audio": null, "audio_seconds": null,
  "tokens": {"palette": {"ink": "#241a12", "accent": "#c0392b", "card_bg": "#f5ead6", "bg_default": "#e3e1da"}},
  "captions": {"enabled": false, "style": "long-form", "words": []},
  "shots": [
    {"id": "S1", "start_s": 0, "duration_s": 3, "image": null, "placeholder": null,
     "camera": {"move": "none", "pan": null, "intensity": 0}, "entrance": "cut", "idle": "none",
     "overlays": [], "plate": "plates/spike.png",
     "layers": [{"id": "stamp", "src": "cutouts/spike-stamp.png",
                 "animation": {"type": "appear", "style": "slam", "at": [0.5, 0.5], "start_s": 1.0}}]},
    {"id": "S2", "start_s": 3, "duration_s": 4, "image": null, "placeholder": null,
     "camera": {"move": "none", "pan": null, "intensity": 0}, "entrance": "cut", "idle": "none",
     "overlays": [], "plate": "plates/spike.png",
     "layers": [{"id": "ship", "src": "cutouts/spike-ship.png",
                 "animation": {"type": "path", "points": [[0.1, 0.5], [0.5, 0.3], [0.9, 0.5]],
                               "dur_s": 3.0, "draw_line": true, "start_s": 0.5}}]}
  ]
}
JSON
RENDER_CHUNK_FRAMES=0 node .claude/skills/render-builder/engine/render-video.mjs \
  "$SPIKE/fixture.motion.json" "$SPIKE" "$SPIKE/out.mp4" 0-209
ffmpeg -y -i "$SPIKE/out.mp4" -vf "select=eq(n\,45)" -frames:v 1 "$SPIKE/frame_slam.png"     # ~1.5s: stamp mid-press
ffmpeg -y -i "$SPIKE/out.mp4" -vf "select=eq(n\,150)" -frames:v 1 "$SPIKE/frame_path.png"    # ~5s: ship mid-route + dots
```

Eyeball (open the two PNGs — user reviews in the Windows default viewer per project convention):
- `frame_slam.png`: the red stamp sits at centre, pressed down (settled, not tiny-popped) — it entered ~frame 30 (1.0 s), not frame 4.
- `frame_path.png`: the blue ship is partway along the arc with a **dark brown-black (`#241a12` ink)** dotted trail behind it — NOT the old `#3a2a1a`.

- [ ] **Step 6: Note `slam` as implemented in `animation-menu.json`**

In `.claude/skills/render-builder/references/animation-menu.json`, the Family-B `engine` `appear` line already reads `"engine": "spring-pop"`. Leave Family B as-is. For the Family-A cutout `appear` line edited in Task 1, its `"engine"` string is already `"spring/opacity/slam at t"` — confirm it reads that (it documents the now-live slam). No further JSON change if Task 1 shipped that string; otherwise update it to `"spring/opacity/slam at t"`.

- [ ] **Step 7: Commit**

```bash
git add .claude/skills/render-builder/engine/src/tokens.ts \
        .claude/skills/render-builder/engine/src/components.tsx \
        .claude/skills/render-builder/engine/src/Video.tsx \
        .claude/skills/render-builder/references/animation-menu.json
git commit -m "feat(engine): cutout anchor start, stamp slam, token-driven route dots (B2/B3/B4)"
```

---

### Task 6: Motion-planner rules — relax timidity, layer-as-default, map-path, authoring anchors/slam (B0/B1/B4 planner side)

**Files:**
- Modify: `.claude/skills/motion-planner/references/animation-rules.md`
- Modify: `.claude/skills/motion-planner/SKILL.md:9-26`

**Interfaces:**
- Consumes: nothing at runtime (guidance the planner model follows). References the contract in `render-builder/references/animation-menu.json` + `shots-motion-schema.md` (Tasks 1/3).
- Produces: rule text only. No code; verification is a coherence read + the existing lint still passing on a real plan.

- [ ] **Step 1: Relax the timidity framing (B0) — element motion only, camera stays locked**

In `.claude/skills/motion-planner/references/animation-rules.md`, replace the opening two lines (lines 3-4):

Current:
```
TIMID BY DEFAULT: a shot stays baked (`layers: []`) unless a rule below clearly fires. The measured
grammar says most shots don't move; a layer is spice, not structure.
```
New:
```
BAKED ONLY WHEN NOTHING MOVES: a shot stays baked (`layers: []`) only when nothing enters, moves, or
accretes in it. The moment a beat has a MOTIVATED element — a character entering, an object travelling,
a stamp landing, a discrete prop added to a held set, a chain accreting — that element gets its layer.
Add slides / paths / hybrids / appears wherever the logic below supports one; do not hold back out of
habit. This posture is about ELEMENT LAYERS only — the CAMERA stays LOCKED (camera restraint is
deliberate and unchanged; no rule here derives a camera move).
```

- [ ] **Step 2: Broaden the discrete-overlay hybrid to characters + props (B1)**

In the same file, replace the "A discrete element lands/stamps ON the frame" bullet (lines 13-16):

Current:
```
- **A discrete element lands/stamps ON the frame** (a stamp, a "SOLD" mark, a badge, a label that slaps
  down) → `appear` (slam). This fires **even on a delta-chain delta**: a flat overlay added to a held set
  is a **hybrid** — the plate REUSES the prior chain scene (`scenes/<prior-in-stage-id>.png`, no new plate
  gen) and the overlay is the cutout. (Contrast a seamless *integrated* accretion below, which stays baked.)
```
New:
```
- **A discrete element is added to a held scene** → layer it as a **hybrid** (reuse the prior scene as
  the plate). "Discrete element" is any cleanly-mattable addition — a **stamp / "SOLD" mark / badge / label**
  (→ `appear`, `style:"slam"` for a stamp pressing onto paper), a **CHARACTER entering** a set we already
  established (→ `slide`, anchored to the naming/entry word), or a **discrete PROP** placed into the scene
  (→ `appear`/`slide`). The plate REUSES the prior in-stage scene (`background.plate: scenes/<prior-id>.png`,
  no new plate gen) and only the added element's `cutout_prompt` is authored. This fires on a delta-chain
  delta AND on any shot that builds on an already-materialized scene. Only an element *fused into the
  scene's perspective/lighting* stays baked (the integrated accretion below).
```

- [ ] **Step 3: Sharpen map-path detection (B4)**

In the same file, replace the "A discrete object travels a route" bullet (lines 7-8):

Current:
```
- **A discrete object travels a route** (a ship/arrow crossing a map; `map-plan-view` with motion) →
  `path` (+ `draw_line` if a route is drawn). Strong signal — the reference-channel map idiom.
```
New:
```
- **A discrete object travels a route** → `path` + `draw_line`. **A `map-plan-view` (or any map/chart)
  shot whose content names a travelling object — a ship, an arrow, a marching line, a spreading tint —
  PROMOTES to a `path` cutout of that object on the baked map plate, with `draw_line: true` trailing its
  route.** Do not bake a map that has a mover in it: the map is the plate, the mover is the layer. This is
  a strong signal — the reference-channel map idiom. Author the `path` `anchor` on the VO words that name
  the journey.
```

- [ ] **Step 4: Add anchor authoring to the cutout-layer section**

In the same file, at the end of the "When to add a cutout layer (Family A)" section (after the discrete-overlay bullet, before the "## When to add a device card" header), add:

```
**Anchor every timed cutout to its word.** A `slide`/`path`/`appear` cutout SHOULD carry an **`anchor`**
(verbatim VO words the element lands on — same convention as a device card's `anchor`), so the element
enters ON the word instead of at the shot cut. Pick the phrase where the narration actually introduces
the element (a character's name, "the ship set out", the beat the stamp punctuates). No `anchor` → the
element enters at the cut (a frame-4 lead-in).
```

- [ ] **Step 5: Update the SKILL procedure to match (B0/B1)**

In `.claude/skills/motion-planner/SKILL.md`, replace the "Timid by default" sentence (lines 9-10):

Current:
```
production spec image-generation + build_motion consume). **Timid by default** — most shots stay baked;
a layer is added only where a rule clearly fires. Authors PLACEMENT; the human gates FEEL.
```
New:
```
production spec image-generation + build_motion consume). **Baked only when nothing moves** — a shot
stays baked when nothing enters/moves/accretes, but a motivated element (entrance, travel, stamp, added
prop, chain) gets its layer. ELEMENT motion only; the camera stays locked. Authors PLACEMENT; the human
gates FEEL.
```

Then replace the classify bullets (lines 22-26) to carry the broadened hybrid + anchors:

Current:
```
   passes through untouched **unless its delta adds a discrete overlay** — then it is a **hybrid**
   (prior-scene plate + an `appear`/slide cutout; see `animation-rules.md`). Add a layer ONLY where a rule fires:
   - character entrance/reveal → cutout `slide` (default OFF; only a deliberate entrance)
   - discrete object travels a route → cutout `path` (+ `draw_line` for a route)
   - live prop vibe → cutout `bob` (sparing) · thing lands on top → cutout/engine `appear`
   - diegetic on-object text/number → an `engine` `text` layer + `at_scene` (plate leaves the region blank)
```
New:
```
   passes through untouched **unless its delta adds a discrete element** — a stamp, a CHARACTER entering,
   or a discrete PROP — then it is a **hybrid** (prior-scene plate + an `appear`/`slide` cutout; see
   `animation-rules.md`). Add a layer wherever a beat has a moving/entering/accreting element:
   - character entrance/reveal → cutout `slide`, `anchor`ed to the naming/entry word
   - discrete object travels a route (incl. a mover on a `map-plan-view`) → cutout `path` (+ `draw_line`)
   - live prop vibe → cutout `bob` (sparing) · a discrete element lands on a held scene → cutout `appear`
     (`style:"slam"` for a stamp) as a hybrid
   - diegetic on-object text/number → an `engine` `text` layer + `at_scene` (still DEFERRED — do not author)
```

- [ ] **Step 6: Verify coherence + no vocabulary drift**

Run (confirm the old timid phrasing is gone from both files):
```bash
grep -rn "TIMID BY DEFAULT\|Timid by default" .claude/skills/motion-planner/ && echo "STALE FOUND" || echo "clean"
```
Expected: `clean`.

Run the existing lint against a real fixture plan to confirm the rules didn't break the schema contract (adjust the path to a present `shots.motion.json`):
```bash
py -3 .claude/skills/motion-planner/scripts/lint_motion_plan.py \
   channels/the-second-take/videos/2026-07-04-poyais/shots.motion.json \
   channels/the-second-take/videos/2026-07-04-poyais/shots.json
```
Expected: `0 error(s)` (or, if that fixture doesn't exist, skip — the lint code is unchanged by this task; this is a smoke check only).

- [ ] **Step 7: Commit**

```bash
git add .claude/skills/motion-planner/references/animation-rules.md \
        .claude/skills/motion-planner/SKILL.md
git commit -m "docs(motion-planner): layer-as-default, map-path, per-cutout anchors (B0/B1/B4)"
```

---

## Self-Review

**1. Spec coverage (Phase B + render-side C):**
- **B0** (relax timidity, element-only) → Task 6 Step 1 + Step 5. ✓
- **B1** (layer-as-default incl. character/prop hybrid, planner side) → Task 6 Step 2 + Step 5. ✓ (VPW/image-gen sides are the other plan — out of scope, noted.)
- **B2** (per-element cutout anchor) → schema Task 3 Step 5; `animation-menu.json` param Task 1 Step 5; `tokens.ts` type Task 5 Step 1; `build_motion` resolve Task 3 Step 3; `LayerView` honor Task 5 Step 2; planner authoring Task 6 Step 4. ✓
- **B3** (stamp slam) → `LayerView` slam Task 5 Step 2; `style` enum documented Task 1 Step 5 + Task 5 Step 6; planner authoring Task 6 Step 2/5. ✓
- **B4** (map path + draw-line token colour) → planner detection Task 6 Step 3; token-driven dot colour Task 5 Step 2. ✓
- **C3** (lint animation params) → `validate_plan` Task 1 Step 3; shapes in menu Task 1 Step 5. ✓
- **Sweep #2/#7** (gate exempts layered) → Task 4. ✓
- **Sweep #3** (shot-relative offset) → folded into B2 Task 3 (`start_s`). ✓
- **Sweep #6** (delta-chain base not a hybrid) → Task 2. ✓
- **Shared contract** (`verified:{scene,rig}`, "layered shot has no scenes/<id>.png") → read by Task 4; documented in Global Constraints; image-gen write side left to the other plan. ✓

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to Task N". Every code step shows full code; every doc step shows exact old→new snippets. ✓

**3. Type consistency:** `cutout_layer_ids` (motion_plan.py) defined Task 4 Step 3, consumed Task 4 Step 6 — same name. `_resolve_cutout_anim` defined + used Task 3. `anchor_time` signature matches render.py. `resolve_scene_files(..., layered_ids=None)` — new kwarg used identically in test (Task 4 Step 1) and call site (Task 4 Step 6). Engine `start_s` (number, shot-relative) written by `_resolve_cutout_anim` (Task 3) and read by `LayerView` `startF`/`atF` (Task 5) — same field, same units. `LayerView` gains `tokens` prop (Task 5 Step 2) and every call site passes it (Task 5 Step 3). `LayerAnimation` `anchor?`/`start_s?`/`style?` added Task 5 Step 1 match the JSON the Python writes. Error strings contain `param` (Task 1 checker) matching the test asserts (Task 1 Step 1). ✓

**Out of scope (other plan), confirmed untouched here:** `image-generation`, `style-bible`, `visual-prompt-writer`/`lint_shots.py`, C1 (manifest verified write), C2 (device-card background = scene), A1–A4, D1–D2.
