# Layered Motion — Phase 4: motion-planner Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build the `motion-planner` skill — reads a video's `shots.json`, applies an iterable animation ruleset, decomposes layered shots by subtraction, and emits a validated `shots.motion.json` (the derived layer spec) — so the layer plan is *generated + human-gated*, not hand-authored.

**Architecture:** Phase 4 of `docs/superpowers/specs/2026-07-12-layered-motion-system-design.md`. Mirrors the `audio-cue-writer` pattern: a SKILL that authors a per-video JSON grounded in `shots.json`, a fresh-eyes critic, a mechanical lint gate, timid-by-default. The DECISION of which shots get Family A is authored data (an iterable rules doc) the skill applies + a human gate — never a black-box whim. Validated by dogfooding on Poyais L13/L03 (should reproduce the Phase-2 fixture's intent).

**Tech Stack:** Python 3 (`py -3`, plain-assert) for the lint; Markdown for the skill + rules + critic.

## Global Constraints

- Plain-assert Python tests (`py -3`); parallel terminals → explicit git paths, never `git add -A`.
- The planner may author ONLY animations on the menu (`animation-menu.json`); the lint HARD-fails an off-menu animation (reuses `motion_plan.validate_plan`).
- **Timid by default:** most shots stay baked/passthrough (`layers: []`); a layer is added only where a rule clearly fires. Honors the measured-restraint doctrine.
- **Human-gated:** the planner emits a proposal + a human-readable summary; the human approves before image-gen spends tokens. The planner authors PLACEMENT; the human gates FEEL.
- Decomposition is BY SUBTRACTION (plate = still_prompt minus the layer elements; cutout_prompt = the element) — the fresh-eyes critic checks a plate prompt that still implies a removed element.

---

### Task 1: `lint_motion_plan.py` — the mechanical gate

**Files:**
- Create: `.claude/skills/motion-planner/scripts/lint_motion_plan.py`
- Test: `.claude/skills/motion-planner/scripts/test_lint_motion_plan.py`

**Interfaces:**
- Consumes: `render-builder/scripts/menu.py::load_menu`, `render-builder/scripts/motion_plan.py::validate_plan`.
- Produces: `lint_motion_plan.py::lint(plan, shots_ids) -> list[str]` — schema+menu errors (via `validate_plan`) PLUS: every plan shot id exists in `shots.json`; a cutout layer has a non-empty `cutout_prompt`; a `plate` background has `plate` or `plate_prompt`. CLI: `py -3 lint_motion_plan.py <shots.motion.json> <shots.json>` → prints errors, exit 1 if any.

- [ ] **Step 1: Write the failing test** `test_lint_motion_plan.py`

```python
"""Mechanical lint for shots.motion.json (plain-assert)."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from lint_motion_plan import lint


def test_clean_plan_passes():
    plan = {"shots": [{"id": "L01", "background": {"mode": "plate", "plate": "scenes/L01.png"}, "layers": []}]}
    assert lint(plan, {"L01"}) == []


def test_unknown_shot_id_fails():
    plan = {"shots": [{"id": "LZZ", "background": {"mode": "plate", "plate": "x"}, "layers": []}]}
    errs = lint(plan, {"L01"})
    assert any("LZZ" in e for e in errs), errs


def test_cutout_without_prompt_fails():
    plan = {"shots": [{"id": "L01", "background": {"mode": "plate", "plate_prompt": "stage, no figure"},
            "layers": [{"id": "c", "source": "cutout", "cutout_prompt": "",
                        "animation": {"type": "slide", "to": [0.5, 0.8], "dur_s": 1.5}}]}]}
    errs = lint(plan, {"L01"})
    assert any("cutout_prompt" in e for e in errs), errs


def main():
    for fn in [test_clean_plan_passes, test_unknown_shot_id_fails, test_cutout_without_prompt_fails]:
        fn(); print("ok", fn.__name__)
    print("OK")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run — expect FAIL** (`ModuleNotFoundError: No module named 'lint_motion_plan'`).
Run: `py -3 .claude/skills/motion-planner/scripts/test_lint_motion_plan.py`

- [ ] **Step 3: Write `lint_motion_plan.py`**

```python
#!/usr/bin/env python3
"""Mechanical lint for shots.motion.json. Reuses the render-builder menu + schema validator, then adds
cross-checks against shots.json. Derived check ONLY — no authoring semantics."""
import json, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "render-builder" / "scripts"))
from menu import load_menu           # noqa: E402
from motion_plan import validate_plan  # noqa: E402


def lint(plan, shots_ids):
    errors = list(validate_plan(plan, load_menu()))
    for shot in plan.get("shots", []):
        sid = shot.get("id", "<no id>")
        if sid not in shots_ids:
            errors.append(f"{sid}: not a shot id in shots.json")
        bg = shot.get("background") or {}
        if bg.get("mode") == "plate" and not (bg.get("plate") or bg.get("plate_prompt")):
            errors.append(f"{sid}: plate background needs plate or plate_prompt")
        for layer in shot.get("layers", []):
            if layer.get("source") == "cutout" and not (layer.get("cutout_prompt") or "").strip():
                errors.append(f"{sid}/{layer.get('id')}: cutout layer needs a non-empty cutout_prompt")
    return errors


def _shots_ids(shots_json):
    shots = shots_json.get("shots") or (shots_json.get("long_form") or {}).get("shots") or []
    return {s.get("id") for s in shots}


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: lint_motion_plan.py <shots.motion.json> <shots.json>")
    plan = json.load(open(sys.argv[1], encoding="utf-8"))
    ids = _shots_ids(json.load(open(sys.argv[2], encoding="utf-8")))
    errs = lint(plan, ids)
    for e in errs:
        print("ERR", e)
    print(f"{len(errs)} error(s)")
    sys.exit(1 if errs else 0)
```

- [ ] **Step 4: Run — expect PASS.** `py -3 .claude/skills/motion-planner/scripts/test_lint_motion_plan.py` → `OK`.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/motion-planner/scripts/lint_motion_plan.py .claude/skills/motion-planner/scripts/test_lint_motion_plan.py
git commit -m "feat(motion-planner): lint_motion_plan gate (layered-motion phase 4)"
```

---

### Task 2: The animation ruleset + the decomposition critic (references)

**Files:**
- Create: `.claude/skills/motion-planner/references/animation-rules.md`
- Create: `.claude/skills/motion-planner/references/critics.md`

- [ ] **Step 1: Write `animation-rules.md`** — the iterable ruleset (data the skill applies; the human tunes this)

```markdown
# Animation rules — which shots get Family A, and how (iterable; human-tuned)

TIMID BY DEFAULT: a shot stays baked (`layers: []`) unless a rule below clearly fires. The measured
grammar says most shots don't move; a layer is spice, not structure.

## When to add a cutout layer (Family A)
- **Character enters / is revealed** (a `personified-character` intro, "it started with…") → OPTIONAL
  `slide` (a glide-in reveal). Default OFF unless the beat is a deliberate entrance; a discovered-already-
  placed character stays baked (a hard cut is on-grammar).
- **A discrete object travels a route** (a ship/arrow crossing a map; `map-plan-view` with motion) →
  `path` (+ `draw_line` if a route is drawn). Strong signal — the reference-channel map idiom.
- **A single foreground prop has a live "vibe"** (a book/hands on a desk) → `bob` (in place). Sparing.
- **A thing lands/stamps on top** (a stamp, a "SOLD" mark, a label that slaps down) → `appear` (slam).

## When to make text engine-drawn (diegetic)
- Any diegetic text/number on an object (a map's "8M acres", a banknote value, a sign) → an `engine`
  `text` layer with an `at_scene` position; the plate prompt must LEAVE that region blank.

## Never layer
- A seamless integrated accretion (city→+bank→+cathedral) → stays a baked `delta-chain` (mode passthrough).
- A shot with no motivated motion → baked passthrough.

## Decomposition (by subtraction)
- `plate_prompt` = the shot's `still_prompt` MINUS the cutout elements and MINUS any diegetic text
  (state the blank region explicitly: "…no ship, no route line, no text").
- `cutout_prompt` = the single element alone, on a plain plate, framed for a clean matte.
```

- [ ] **Step 2: Write `critics.md`** — the fresh-eyes decomposition critic

```markdown
# motion-planner critic — fresh-eyes decomposition check

Run a fresh-context reviewer over the emitted `shots.motion.json` + the source `shots.json`. It flags,
per layered shot:

1. **Leaked element** — does the `plate_prompt` still imply/describe an element that was moved to a
   cutout layer or to engine text? (e.g. plate still says "a ship" when ship is a cutout). The #1 defect.
2. **Over-animation** — is a layer added where the measured grammar wants a hard cut? (timid check)
3. **Menu/asset mismatch** — an animation whose asset contract isn't satisfiable (e.g. `sprite-walk`,
   not built).
4. **Diegetic text** — is on-object text still baked in the plate instead of an engine `text` layer?

Output: a ranked list of concrete fixes. The planner applies them (one revise pass), then the human gate.
```

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/motion-planner/references/animation-rules.md .claude/skills/motion-planner/references/critics.md
git commit -m "feat(motion-planner): animation ruleset + decomposition critic (layered-motion phase 4)"
```

---

### Task 3: `SKILL.md` + register + dogfood on L13/L03

**Files:**
- Create: `.claude/skills/motion-planner/SKILL.md`
- Modify: `.claude/skills/README.md` (register the skill)
- Produce: `channels/the-second-take/videos/2026-07-04-poyais/shots.motion.json` (dogfood output — supersedes the hand-authored fixture)

- [ ] **Step 1: Write `SKILL.md`** — frontmatter (name: motion-planner; description covering: reads shots.json, emits shots.motion.json, applies the animation ruleset, decomposes by subtraction, critic + lint + human gate, runs AFTER visual-prompt-writer and BEFORE image-generation) + the procedure: (1) read shots.json + animation-rules.md + animation-menu.md; (2) for each shot apply the rules — default passthrough, add layers only where a rule fires; (3) decompose layered shots by subtraction; (4) run the critics.md fresh-eyes pass → one revise; (5) write shots.motion.json; (6) `lint_motion_plan.py` HARD gate; (7) present the human-readable summary (which shots got Family A + animations) for the human gate. Reference `shots-motion-schema.md`.

- [ ] **Step 2: Register in `.claude/skills/README.md`** — add a one-line entry for `motion-planner` in the skill list (near visual-prompt-writer / image-generation), noting it runs between them.

- [ ] **Step 3: Dogfood — run the planner on Poyais L13/L03.** Read those two shots' `still_prompt`/`shot_class` from `shots.json`, apply the ruleset (L13 personified-character intro → `slide`; L03 map-plan-view + ship → `path` + `draw_line`), decompose by subtraction, and write `shots.motion.json` (just those two shots for the dogfood). It should reproduce the Phase-2 fixture's intent.

- [ ] **Step 4: Lint + render-validate the dogfood output.**
Run: `py -3 .claude/skills/motion-planner/scripts/lint_motion_plan.py channels/the-second-take/videos/2026-07-04-poyais/shots.motion.json channels/the-second-take/videos/2026-07-04-poyais/shots.json`
Expected: `0 error(s)`. Then confirm it drives the engine (build a motion.json via `build_motion --motion-plan shots.motion.json`, or reuse the Phase-3 test path) — the layered render still works.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/motion-planner/SKILL.md .claude/skills/README.md channels/the-second-take/videos/2026-07-04-poyais/shots.motion.json
git commit -m "feat(motion-planner): SKILL + register + dogfood Poyais L13/L03 (layered-motion phase 4)"
```

---

## Phase 4 done — the layer plan is generated + gated, not hand-authored. Next: Phase 5 (hygiene sweep + unify layers/overlays + CLAUDE.md status).
