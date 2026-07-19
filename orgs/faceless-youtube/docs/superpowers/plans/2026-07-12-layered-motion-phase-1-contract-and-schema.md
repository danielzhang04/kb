# Layered Motion — Phase 1: Contract & Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lock the shared contract the whole layered-motion system reads from (the animation menu + the `shots.motion.json` schema) and decouple the camera from `beat_type`, so later phases build against a stable, validated foundation.

**Architecture:** Phase 1 of the design in `docs/superpowers/specs/2026-07-12-layered-motion-system-design.md`. It ships two machine-readable contract artifacts (a validated JSON menu + a validated JSON schema) plus one code change (stop deriving camera from `beat_type` in `build_motion.py`). No new pipeline behavior yet — this is the foundation Phases 2–5 consume.

**Tech Stack:** Python 3 (plain-assert tests, run via `py -3` — the repo has **no pytest**), JSON contract files, Markdown reference docs.

## Global Constraints

- Tests are **plain-assert Python** run with `py -3 <file>` (the repo has no pytest). Match the existing `test_build_motion.py` / `test_build_audio.py` convention — a `run()`/`main()` that calls `test_*` functions and prints `OK`.
- **Parallel terminals share this tree.** Stage explicit paths in every commit; never `git add -A`; never rewrite history.
- **Do NOT touch `build_audio.py`, `breath.py`, or any audio path** — audio is a deferred Step 2. The whip `entrance` stays (its whoosh is audio-coupled).
- **Integrate, don't append.** When editing a doc, rewrite the affected section; never stack a dated "added 2026-07-12" block or leave contradicting old text below new text.
- The animation menu is the **single source of truth**: `animation-menu.json` holds the data; every doc/script references it, never re-describes it.
- Camera is **locked by default** and the engine keeps its camera primitive — Phase 1 only stops *auto-deriving* a move from `beat_type`; it does not remove `CameraStage` from the engine.

---

### Task 1: Animation menu — the single source of truth

**Files:**
- Create: `.claude/skills/render-builder/references/animation-menu.json`
- Create: `.claude/skills/render-builder/references/animation-menu.md`
- Create: `.claude/skills/render-builder/scripts/menu.py`
- Test: `.claude/skills/render-builder/scripts/test_menu.py`

**Interfaces:**
- Produces: `menu.py::load_menu(path=None) -> dict` (loads + validates `animation-menu.json`; raises `ValueError` on a malformed entry), and `menu.py::valid_animation(menu, source, anim_type) -> bool`. Later phases (planner, build_motion) import these to validate an authored animation against the menu.

- [ ] **Step 1: Write `animation-menu.json`** — the closed vocabulary, each entry a triple.

```json
{
  "schema": "faceless-youtube/animation-menu@1",
  "_doc": "The closed animation vocabulary. Family A = generated-image cutout layers; Family B = engine-drawn. Each entry: author params, the asset image-gen must produce, the Remotion impl + build status. VPW/motion-planner may author ONLY these. Extend deliberately: prove in Remotion -> add the triple -> then author.",
  "families": {
    "cutout": {
      "_note": "Family A. source:'cutout' — a generated image asset composited over the plate. Rigid transforms + reveals only; NO articulation.",
      "animations": {
        "appear": {"params": ["at_s", "style"], "style_enum": ["pop", "fade", "slam"], "asset": "one cutout", "engine": "spring/opacity at t", "status": "proven"},
        "bob":    {"params": ["amp", "period"], "asset": "one cutout", "engine": "sine translate in place", "status": "trivial"},
        "slide":  {"params": ["from_edge", "to", "dur_s", "easing"], "asset": "one cutout", "engine": "ease-out translate", "status": "proven"},
        "path":   {"params": ["points", "dur_s", "draw_line"], "asset": "one cutout (line is engine-drawn)", "engine": "bezier sample + optional draw-on", "status": "proven"},
        "sprite-walk": {"params": ["direction", "dur_s"], "asset": "N pose-frame cutouts", "engine": "frame-cycle + translate", "status": "designed-not-built"}
      }
    },
    "engine": {
      "_note": "Family B. source:'engine' — code-drawn from DATA, no gen. Already implemented in the engine (the T2 device kit + text). This project generalizes them into layers[]; it does not rebuild them.",
      "animations": {
        "type-on":  {"params": ["at_s", "dur_s"], "asset": "none (text data)", "engine": "char-by-char type-on", "status": "built"},
        "appear":   {"params": ["at_s", "style"], "asset": "none (card/data)", "engine": "spring-pop", "status": "built"},
        "count":    {"params": ["from", "to", "at_s", "dur_s"], "asset": "none (number)", "engine": "ramp tabular digits", "status": "built"},
        "fill":     {"params": ["fraction", "at_s"], "asset": "none (meter data)", "engine": "bar fill", "status": "built"},
        "reveal":   {"params": ["items", "mark"], "asset": "none (list data)", "engine": "each item lands on its word", "status": "built"},
        "draw-line":{"params": ["points", "dur_s"], "asset": "none (route data)", "engine": "dotted path draw-on", "status": "built-in-spike"}
      }
    }
  }
}
```

- [ ] **Step 2: Write the failing test** `test_menu.py`

```python
"""Unit tests for the animation-menu loader/validator (plain-assert; repo has no pytest)."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from menu import load_menu, valid_animation


def test_loads_and_has_both_families():
    m = load_menu()
    assert set(m["families"]) == {"cutout", "engine"}, m["families"].keys()


def test_every_cutout_entry_declares_an_asset_contract():
    m = load_menu()
    for name, entry in m["families"]["cutout"]["animations"].items():
        assert entry.get("asset"), ("cutout animation missing asset contract", name)


def test_valid_animation_gate():
    m = load_menu()
    assert valid_animation(m, "cutout", "slide") is True
    assert valid_animation(m, "cutout", "teleport") is False   # not on the menu
    assert valid_animation(m, "engine", "type-on") is True


def test_malformed_menu_raises():
    import json, tempfile
    bad = {"schema": "x", "families": {"cutout": {"animations": {"x": {"engine": "y"}}}}}  # no asset
    p = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
    json.dump(bad, p); p.close()
    try:
        load_menu(p.name); assert False, "should have raised"
    except ValueError:
        pass


def main():
    for fn in [test_loads_and_has_both_families, test_every_cutout_entry_declares_an_asset_contract,
               test_valid_animation_gate, test_malformed_menu_raises]:
        fn(); print("ok", fn.__name__)
    print("OK")


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `py -3 .claude/skills/render-builder/scripts/test_menu.py`
Expected: FAIL — `ModuleNotFoundError: No module named 'menu'`.

- [ ] **Step 4: Write `menu.py`** (minimal loader + validator)

```python
"""Loads + validates the animation menu (the single source of truth). See references/animation-menu.json."""
import json, os

_DEFAULT = os.path.join(os.path.dirname(__file__), "..", "references", "animation-menu.json")


def load_menu(path=None):
    with open(path or _DEFAULT, encoding="utf-8") as f:
        m = json.load(f)
    fams = m.get("families", {})
    for fam_name, fam in fams.items():
        for anim_name, entry in fam.get("animations", {}).items():
            if fam_name == "cutout" and not entry.get("asset"):
                raise ValueError(f"cutout animation '{anim_name}' missing required 'asset' contract")
            if not entry.get("engine"):
                raise ValueError(f"animation '{anim_name}' missing required 'engine' impl")
    return m


def valid_animation(menu, source, anim_type):
    return anim_type in menu.get("families", {}).get(source, {}).get("animations", {})
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `py -3 .claude/skills/render-builder/scripts/test_menu.py`
Expected: PASS — prints `ok ...` per test then `OK`.

- [ ] **Step 6: Write `animation-menu.md`** (the human-facing reference — references the JSON, does not duplicate the data)

```markdown
# Animation menu — the shared contract (single source of truth)

The closed animation vocabulary for the layered-motion system. **The data lives in
`animation-menu.json`** (loaded/validated by `scripts/menu.py`); this doc explains it — it never
re-lists the entries (edit the JSON, not prose).

- **Family A — `source: "cutout"`** (generated image layers): rigid transforms + reveals only, NO
  articulation. Each animation declares the **asset** image-gen must produce.
- **Family B — `source: "engine"`** (code-drawn from data): the existing T2 device kit + text; no gen.

**The rule:** VPW / the motion-planner may author ONLY animations on the menu. Extending it is
deliberate — prove the animation in Remotion, add its triple (params × asset × engine) to the JSON,
then it becomes authorable. This is what prevents authoring a motion the engine can't render.
```

- [ ] **Step 7: Commit**

```bash
git add .claude/skills/render-builder/references/animation-menu.json .claude/skills/render-builder/references/animation-menu.md .claude/skills/render-builder/scripts/menu.py .claude/skills/render-builder/scripts/test_menu.py
git commit -m "feat(render): animation menu single-source-of-truth + validator (layered-motion phase 1)"
```

---

### Task 2: `shots.motion.json` schema + validator

**Files:**
- Create: `.claude/skills/render-builder/references/shots-motion-schema.md`
- Create: `.claude/skills/render-builder/scripts/motion_plan.py`
- Test: `.claude/skills/render-builder/scripts/test_motion_plan.py`

**Interfaces:**
- Consumes: `menu.py::load_menu`, `menu.py::valid_animation` (Task 1).
- Produces: `motion_plan.py::validate_plan(plan: dict, menu: dict) -> list[str]` (returns a list of human-readable errors; empty = valid). Phase 4's planner writes files this validates; Phases 2–3 read files this validates.

- [ ] **Step 1: Write the schema doc** `shots-motion-schema.md`

```markdown
# shots.motion.json — the derived production spec

A NEW derived file (`videos/<slug>/shots.motion.json`) the `motion-planner` emits from `shots.json`.
`shots.json` stays VPW's pristine visual truth; this is the machine-planned layer spec that
image-generation and build_motion consume. Validated by `scripts/motion_plan.py::validate_plan`.

## Per long-form shot
- `id` (str, required) — matches the `shots.json` shot id.
- `background` (object, required):
  - `mode`: `"plate"` | `"delta-chain"`.
  - `plate` (str) — the baked scene path, OR `plate_prompt` (str) when image-gen must generate a plate
    that omits the layer elements. `delta-chain` mode carries the existing stage fields, passed through.
- `layers` (array, required; `[]` for a simple/passthrough shot):
  - `id` (str), `source`: `"cutout"` | `"engine"`.
  - cutout: `cutout_prompt` (str) + `animation`.
  - engine: `kind` (text|stat-card|counter|meter|chapter-card|definition-card|reveal) + `content`
    (+ optional `at_scene: {x, y}` for diegetic in-scene text).
  - `animation` (object, optional; absent = static): `{ "type": <menu entry for this source>, ...params }`.

## Rules
- Every layer's `animation.type` MUST be on the menu for its `source` (menu.py::valid_animation).
- A simple shot = `{ "background": {"mode":"plate","plate":"scenes/L01.png"}, "layers": [] }` (passthrough).
```

- [ ] **Step 2: Write the failing test** `test_motion_plan.py`

```python
"""Unit tests for shots.motion.json validation (plain-assert; repo has no pytest)."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from menu import load_menu
from motion_plan import validate_plan


def _passthrough():
    return {"shots": [{"id": "L01", "background": {"mode": "plate", "plate": "scenes/L01.png"}, "layers": []}]}


def test_passthrough_is_valid():
    assert validate_plan(_passthrough(), load_menu()) == []


def test_layer_with_offmenu_animation_errors():
    plan = {"shots": [{"id": "L03", "background": {"mode": "plate", "plate_prompt": "map, no ship"},
            "layers": [{"id": "ship", "source": "cutout", "cutout_prompt": "a ship",
                        "animation": {"type": "teleport"}}]}]}
    errs = validate_plan(plan, load_menu())
    assert any("teleport" in e for e in errs), errs


def test_missing_background_errors():
    plan = {"shots": [{"id": "L01", "layers": []}]}
    errs = validate_plan(plan, load_menu())
    assert any("background" in e for e in errs), errs


def main():
    for fn in [test_passthrough_is_valid, test_layer_with_offmenu_animation_errors, test_missing_background_errors]:
        fn(); print("ok", fn.__name__)
    print("OK")


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `py -3 .claude/skills/render-builder/scripts/test_motion_plan.py`
Expected: FAIL — `ModuleNotFoundError: No module named 'motion_plan'`.

- [ ] **Step 4: Write `motion_plan.py`**

```python
"""Validates a shots.motion.json plan against the schema + the animation menu."""
from menu import valid_animation

_ENGINE_KINDS = {"text", "stat-card", "counter", "meter", "chapter-card", "definition-card", "reveal"}


def validate_plan(plan, menu):
    errors = []
    for shot in plan.get("shots", []):
        sid = shot.get("id", "<no id>")
        bg = shot.get("background")
        if not isinstance(bg, dict) or bg.get("mode") not in ("plate", "delta-chain"):
            errors.append(f"{sid}: background missing/invalid (need mode plate|delta-chain)")
        for layer in shot.get("layers", []):
            lid = layer.get("id", "<no id>")
            src = layer.get("source")
            if src not in ("cutout", "engine"):
                errors.append(f"{sid}/{lid}: source must be cutout|engine")
                continue
            if src == "engine" and layer.get("kind") not in _ENGINE_KINDS:
                errors.append(f"{sid}/{lid}: engine layer needs a valid kind")
            anim = layer.get("animation")
            if anim is not None:
                atype = anim.get("type")
                if not valid_animation(menu, src, atype):
                    errors.append(f"{sid}/{lid}: animation '{atype}' not on the {src} menu")
    return errors
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `py -3 .claude/skills/render-builder/scripts/test_motion_plan.py`
Expected: PASS — `ok ...` per test then `OK`.

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/render-builder/references/shots-motion-schema.md .claude/skills/render-builder/scripts/motion_plan.py .claude/skills/render-builder/scripts/test_motion_plan.py
git commit -m "feat(render): shots.motion.json schema + validator (layered-motion phase 1)"
```

---

### Task 3: Decouple the camera from `beat_type` in `build_motion.py`

**Files:**
- Modify: `.claude/skills/render-builder/scripts/build_motion.py:50-78` (remove the push derivation; the call at line 125 is unchanged — it still calls `camera_from_beat_type`, which now always returns locked)
- Modify: `.claude/skills/render-builder/scripts/test_build_motion.py` (fold gravity/escalation into the locked test; delete the push test)
- Modify: `.claude/skills/render-builder/references/motion-schema.md` (§2 `camera.move` row)
- Modify: `.claude/skills/visual-prompt-writer/references/shots-schema.md` (the `beat_type` note)
- Modify: `knowledge/research/niche-playbooks/universal.md` (§13a-iii.1 camera wording)

**Interfaces:**
- Consumes: nothing new.
- Produces: `camera_from_beat_type` now always returns the locked camera `{"move":"none","pan":None,"intensity":0.0}`. `derive_shots` therefore emits a locked camera for every shot. The whip `entrance` is UNCHANGED (kept — it is audio-coupled via build_audio's whoosh).

- [ ] **Step 1: Update the tests first.** The real file has three tests (`test_locked_by_default`, `test_only_gravity_and_escalation_move`, `test_card_always_locked`) and an inline `if __name__ == "__main__"` block calling all three. Make two edits:

(a) Add `"gravity"` and `"escalation"` to the `test_locked_by_default` beat-type list so they are asserted LOCKED:

```python
def test_locked_by_default():
    # Camera decoupled from beat_type (2026-07-12): every beat_type -> locked, incl. gravity/escalation.
    for bt in ["narration", None, "cold-open", "number-reveal", "dialogue",
               "mechanism", "chapter-boundary", "enumeration-within", "bogus",
               "gravity", "escalation"]:
        cam = camera_from_beat_type(bt, is_card=False)
        assert cam["move"] == "none" and cam["intensity"] == 0.0, (bt, cam)
```

(b) Delete the entire `test_only_gravity_and_escalation_move` function, and remove its call from the `__main__` block so it reads:

```python
if __name__ == "__main__":
    print("running")
    test_locked_by_default()
    test_card_always_locked()
    print("PASS")
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `py -3 .claude/skills/render-builder/scripts/test_build_motion.py`
Expected: FAIL — gravity/escalation still return `push-in` (the old code), so the new "always locked" assert fails on `bt="gravity"`.

- [ ] **Step 3: Make `camera_from_beat_type` always return locked**

Replace lines 50–53 (the constants + comment) and the body of `camera_from_beat_type` (lines 66–78). New:

```python
# Camera is DECOUPLED from beat_type (2026-07-12): build_motion never derives a move. The engine keeps
# its camera primitive (CameraStage) for a future manual/authored move; we simply always emit locked.
# The whip `entrance` is kept below (it is audio-coupled: build_audio fires a scene whoosh on it).


def camera_from_beat_type(beat_type: str, is_card: bool = False) -> dict:
    """The camera is locked. beat_type no longer drives it (2026-07-12). Kept as a stable seam so
    callers/tests don't change shape; a future camera-planning path can emit an explicit move."""
    return {"move": "none", "pan": None, "intensity": 0.0}
```

(This deletes `_CAMERA_PUSH`. Leave `WHIP_BEAT_TYPES` and the `entrance` derivation at lines 109–113 UNTOUCHED — the whip stays.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `py -3 .claude/skills/render-builder/scripts/test_build_motion.py`
Expected: PASS — `OK`.

- [ ] **Step 5: Run the audio tests to prove audio is unaffected**

Run: `py -3 .claude/skills/render-builder/scripts/test_build_audio.py`
Expected: PASS — the whip whoosh test still passes (the whip `entrance` is unchanged).

- [ ] **Step 6: Update the three docs (rewrite in place — do NOT append)**

- `motion-schema.md` §2: rewrite the `camera.move`/`camera.intensity` rows to: "**Locked — always `none`/`0.0`.** The camera is decoupled from `beat_type` (2026-07-12); build_motion never derives a move. The engine keeps `CameraStage` for a future explicit/authored move." Remove the "ONLY gravity/escalation push" text.
- `shots-schema.md`: in the `beat_type` note, remove "`build_motion.py` derives the camera from it (locked by default; only `gravity` and `escalation` push) and the entrance (whip on `dialogue`)" → replace with "`build_motion.py` no longer derives the camera from it (camera is always locked, 2026-07-12); `beat_type` still drives the whip entrance and all `build_audio` register/SFX."
- `universal.md` §13a-iii.1: change the camera law from "only `gravity`/`escalation` push" to "the camera is locked; deliberate moves (if ever) are authored explicitly, not derived from `beat_type`." Keep the "camera is furniture" framing.

- [ ] **Step 7: Commit**

```bash
git add .claude/skills/render-builder/scripts/build_motion.py .claude/skills/render-builder/scripts/test_build_motion.py .claude/skills/render-builder/references/motion-schema.md .claude/skills/visual-prompt-writer/references/shots-schema.md knowledge/research/niche-playbooks/universal.md
git commit -m "refactor(render): decouple camera from beat_type — always locked (layered-motion phase 1)"
```

---

## Phase 1 done — what it produced

- `animation-menu.json` + `menu.py` (validated) — the single source of truth every later phase reads.
- `shots-motion-schema.md` + `motion_plan.py::validate_plan` (validated) — the derived-spec contract.
- Camera decoupled from `beat_type` (locked always); whip entrance + all audio untouched and green.

## Next phases (own plans, written just-in-time as their contracts lock)

- **Phase 2 — image-gen layered output:** plate + cutout gen from a layer spec; rembg→threshold→cutout QC gate. Built + tested against **hand-authored** `shots.motion.json` fixtures for Poyais L13/L03.
- **Phase 3 — engine + build_motion:** the Family-A `renderLayer` dispatch (unified with Family-B overlays) + `layers[]` emission into motion.json. Spike `SlideTest.tsx`/`MapTest.tsx` are the seed.
- **Phase 4 — motion-planner skill:** ruleset + subtraction decomposition + fresh-eyes critic + human gate; emits `shots.motion.json`.
- **Phase 5 — cross-file hygiene sweep + `curate-doc`:** retire the T3/"Phase-2/3 deferred" ghosts, single-source the menu everywhere, update CLAUDE.md status.
