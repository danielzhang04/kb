# Layered Motion — Phase 2: Image-gen Layered Output Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Give `forge.py` the ability to turn a generated image into a clean transparent **cutout** (rembg → alpha-harden → trim), and produce the hand-QC crops that gate it — so a layered shot's plate + cutout layers can be materialized from a `shots.motion.json` layer spec.

**Architecture:** Phase 2 of `docs/superpowers/specs/2026-07-12-layered-motion-system-design.md`. Plate/cutout **generation** already exists (`forge.py gen` in `environment` mode — proven in the spike). The new mechanic is **cutout extraction**: a `forge.py cutout` command. The pure post-processing (`harden_alpha`, `trim_to_alpha`) is unit-tested; the rembg call is human-smoke-tested (slow model load, matches the repo's audio-precompute pattern). Built + validated against hand-authored `shots.motion.json` fixtures for Poyais **L13** (character slide) and **L03** (ship path).

**Tech Stack:** Python 3 (`py -3`, plain-assert tests), Pillow (lazy import, already used by forge), rembg (lazy import, already installed), the `gemini-3-pro-image` engine (existing).

## Global Constraints

- Tests are **plain-assert Python** run with `py -3 <file>`; match `test_menu.py` shape.
- **Parallel terminals share this tree.** Stage explicit paths; never `git add -A`; never rewrite history.
- **Lazy-import heavy deps** (Pillow, rembg) INSIDE the command, never at module top — forge's other commands must keep running without them (mirrors forge's existing optional-Pillow pattern).
- **rembg model calls are NOT in the fast unit suite** — unit-test the pure alpha/trim logic; the rembg integration is a human SMOKE step (single image, eyeball + hand-crop).
- **Never self-certify finger counts** — the cutout QC gate publishes zoomed hand crops for the human to count (project rule). Reuse `forge.py crop`.
- **Cutout params from the spike (proven on MacGregor's hand):** alpha-matting `foreground_threshold=240, background_threshold=10, erode_size=10`; harden `lo=100, hi=175`.

---

### Task 1: `forge.py cutout` — rembg + alpha-harden + trim

**Files:**
- Modify: `.claude/skills/image-generation/scripts/forge.py` (add `cutout` to the subcommand list + `cmd_cutout` + two pure helpers + argparse wiring)
- Test: `.claude/skills/image-generation/scripts/test_cutout.py`

**Interfaces:**
- Produces: `forge.py::harden_alpha(rgba, lo=100, hi=175) -> Image` (pure; pushes soft alpha to a crisp edge), `forge.py::trim_to_alpha(rgba) -> Image` (pure; crops to the alpha bounding box), and `cmd_cutout(in_path, out_path, lo, hi)` (rembg wrapper). Later tasks/phases call `forge.py cutout --in <img> --out <png>`.

- [ ] **Step 1: Write the failing test** `test_cutout.py` (tests ONLY the pure helpers — no rembg)

```python
"""Unit tests for the cutout pure helpers (plain-assert; no rembg in the fast suite)."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from PIL import Image
from forge import harden_alpha, trim_to_alpha


def _rgba(w, h, alpha_fn):
    im = Image.new("RGBA", (w, h), (10, 20, 30, 0))
    px = im.load()
    for y in range(h):
        for x in range(w):
            px[x, y] = (10, 20, 30, alpha_fn(x, y))
    return im


def test_harden_pushes_soft_alpha_to_extremes():
    # a horizontal alpha ramp 0..255 -> after harden, only a thin transition band is mid-valued
    im = _rgba(256, 4, lambda x, y: x)
    out = harden_alpha(im, lo=100, hi=175)
    a = out.split()[3]
    assert a.getpixel((50, 0)) == 0, "below lo -> transparent"
    assert a.getpixel((240, 0)) == 255, "above hi -> opaque"


def test_trim_crops_to_content():
    # a 100x100 image with a 20x20 opaque block at (40,40) -> trims to 20x20
    im = _rgba(100, 100, lambda x, y: 255 if (40 <= x < 60 and 40 <= y < 60) else 0)
    out = trim_to_alpha(im)
    assert out.size == (20, 20), out.size


def main():
    for fn in [test_harden_pushes_soft_alpha_to_extremes, test_trim_crops_to_content]:
        fn(); print("ok", fn.__name__)
    print("OK")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `py -3 .claude/skills/image-generation/scripts/test_cutout.py`
Expected: FAIL — `ImportError: cannot import name 'harden_alpha' from 'forge'`.

- [ ] **Step 3: Add the pure helpers + `cmd_cutout` to `forge.py`** (place above `main()`; lazy-import Pillow/rembg inside)

```python
def harden_alpha(rgba, lo=100, hi=175):
    """Push a soft rembg matte to a crisp edge: alpha < lo -> 0, > hi -> 255, linear between."""
    r, g, b, a = rgba.split()
    a = a.point(lambda v: 0 if v < lo else (255 if v > hi else int((v - lo) / (hi - lo) * 255)))
    from PIL import Image
    return Image.merge("RGBA", (r, g, b, a))


def trim_to_alpha(rgba):
    """Crop to the alpha bounding box (drops fully-transparent margins)."""
    bbox = rgba.split()[3].getbbox()
    return rgba.crop(bbox) if bbox else rgba


def cmd_cutout(in_path, out_path, lo, hi):
    from PIL import Image
    from rembg import remove, new_session
    src = Image.open(in_path).convert("RGBA")
    rgba = remove(src, session=new_session("u2net"), alpha_matting=True,
                  alpha_matting_foreground_threshold=240, alpha_matting_background_threshold=10,
                  alpha_matting_erode_size=10).convert("RGBA")
    out = trim_to_alpha(harden_alpha(rgba, lo, hi))
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    out.save(out_path)
    print(f"cutout: {in_path} -> {out_path} {out.size}", flush=True)
```

- [ ] **Step 4: Wire the argparse subcommand** — in `main()`, add `"cutout"` to the `cmd` choices list, add args `--in`/`--out`/`--lo`/`--hi`, and a dispatch branch.

Add to the `choices=[...]` list: `"cutout"`. Add arguments (near the existing `--in`/`crop` args):

```python
    ap.add_argument("--lo", type=int, default=100, help="cutout: alpha-harden low threshold")
    ap.add_argument("--hi", type=int, default=175, help="cutout: alpha-harden high threshold")
```

Add the dispatch branch (alongside the other `if a.cmd == ...` branches):

```python
    if a.cmd == "cutout":
        if not a.in_path or not a.out:
            raise SystemExit("cutout needs --in <image> and --out <png>")
        cmd_cutout(a.in_path, a.out, a.lo, a.hi)
        return
```

(`--in` already exists as `dest="in_path"` for `crop`; `--out` already exists for `montage`. Reuse them.)

- [ ] **Step 5: Run the pure-helper test to verify it passes**

Run: `py -3 .claude/skills/image-generation/scripts/test_cutout.py`
Expected: PASS — `ok ...` then `OK`.

- [ ] **Step 6: HUMAN SMOKE (rembg integration)** — cut a real figure and eyeball the hand.

Run:
```bash
py -3 .claude/skills/image-generation/scripts/forge.py cutout \
  --kit channels/the-second-take/visual-kit \
  --in channels/the-second-take/videos/2026-07-04-poyais/assets/library/macgregor-base.png \
  --out /tmp/mg-cut.png
py -3 .claude/skills/image-generation/scripts/forge.py crop --kit channels/the-second-take/visual-kit \
  --in /tmp/mg-cut.png --regions "0.24,0.60,0.20,0.15;0.60,0.60,0.20,0.16"
```
Expected: a trimmed transparent `mg-cut.png` + two hand crops. **Human gate:** open the crops, confirm 4 digits intact, no eaten fingers. STOP if the matte eats the hand.

- [ ] **Step 7: Commit**

```bash
git add .claude/skills/image-generation/scripts/forge.py .claude/skills/image-generation/scripts/test_cutout.py
git commit -m "feat(image-gen): forge cutout command (rembg + alpha-harden + trim) (layered-motion phase 2)"
```

---

### Task 2: Hand-authored `shots.motion.json` fixtures (L13 + L03)

**Files:**
- Create: `channels/the-second-take/videos/2026-07-04-poyais/shots.motion.fixture.json`
- Test: `.claude/skills/render-builder/scripts/test_fixture_valid.py`

**Interfaces:**
- Consumes: `menu.py::load_menu`, `motion_plan.py::validate_plan` (Phase 1).
- Produces: a validated fixture the image-gen orchestration (Task 3) and Phase 3 (engine) build against.

- [ ] **Step 1: Write the fixture** (L13 character slide + L03 ship path, both real Poyais shots)

```json
{
  "video_slug": "2026-07-04-poyais",
  "_note": "Hand-authored Phase-2 fixture. Two layered shots to drive image-gen + engine dev before the motion-planner (Phase 4) automates this.",
  "shots": [
    {
      "id": "L13",
      "background": {"mode": "plate", "plate_prompt": "An empty stage: a plain warm field with a single soft warm spotlight pooling center on the floor; nothing else — no characters, no props, no text."},
      "layers": [
        {"id": "macgregor", "source": "cutout",
         "cutout_prompt": "macgregor (crimson hussar coat), full standing figure, front, on a plain plate",
         "animation": {"type": "slide", "from_edge": "left", "to": [0.5, 0.82], "dur_s": 1.8, "easing": "ease-out"}}
      ]
    },
    {
      "id": "L03",
      "background": {"mode": "plate", "plate_prompt": "A flat stylized Atlantic map, Britain small at the RIGHT edge, green Central-American coast at the LEFT edge, wide blue ocean between; NO ship, NO route line, NO text."},
      "layers": [
        {"id": "ship", "source": "cutout",
         "cutout_prompt": "a single tall-masted sailing ship, side profile, bow LEFT, on a plain pale plate",
         "animation": {"type": "path", "points": [[0.83, 0.24], [0.52, 0.14], [0.12, 0.72]], "dur_s": 4.0, "draw_line": true}},
        {"id": "route", "source": "engine", "kind": "text", "content": "",
         "animation": {"type": "draw-line", "points": [[0.83, 0.24], [0.52, 0.14], [0.12, 0.72]], "dur_s": 4.0}}
      ]
    }
  ]
}
```

- [ ] **Step 2: Write the failing test** `test_fixture_valid.py`

```python
"""The Poyais Phase-2 fixture must validate against the schema + menu (plain-assert)."""
import sys, os, json
sys.path.insert(0, os.path.dirname(__file__))
from menu import load_menu
from motion_plan import validate_plan

FIX = os.path.join(os.path.dirname(__file__), "..", "..", "..", "..",
                   "channels", "the-second-take", "videos", "2026-07-04-poyais", "shots.motion.fixture.json")


def test_fixture_is_valid():
    plan = json.load(open(FIX, encoding="utf-8"))
    errs = validate_plan(plan, load_menu())
    assert errs == [], errs


if __name__ == "__main__":
    test_fixture_is_valid(); print("OK")
```

- [ ] **Step 3: Run — expect FAIL** (fixture not created yet if run before Step 1; if Step 1 done, expect PASS). Run: `py -3 .claude/skills/render-builder/scripts/test_fixture_valid.py` → PASS once the fixture exists and validates. If it prints errors, fix the fixture until `errs == []`.

- [ ] **Step 4: Commit**

```bash
git add channels/the-second-take/videos/2026-07-04-poyais/shots.motion.fixture.json .claude/skills/render-builder/scripts/test_fixture_valid.py
git commit -m "test(layered-motion): Poyais L13/L03 shots.motion fixture (phase 2)"
```

---

### Task 3: image-gen orchestration — materialize a layered shot (GATED: spends gen tokens)

**Files:**
- Modify: `.claude/skills/image-generation/SKILL.md` (a "layered shot" procedure section — read `shots.motion.json`, gen plate, gen+cut each cutout layer, produce hand-QC crops)

**This task spends image-gen tokens. It is human-gated: first materialize ONE shot (L13), review the cutout + plate, THEN the second (L03).** It is orchestration (Claude runs `forge gen` + `forge cutout` per the fixture), documented in the SKILL — not a unit-tested script.

- [ ] **Step 1: Document the layered-shot procedure in `SKILL.md`** — a new subsection stating: for a shot in `shots.motion.json` with `layers`, (a) `forge gen` the `background.plate_prompt` → `_staging/<id>-plate.png`; (b) for each `cutout` layer, `forge gen` the `cutout_prompt` on a plain plate → `_staging/<id>-<layer>.raw.png`, then `forge cutout` → `<id>-<layer>.png`; (c) run `forge crop` on each cutout for the hand-QC gate; (d) `engine`-source layers need NO gen. Reference `shots-motion-schema.md` + `animation-menu.md`.

- [ ] **Step 2: Materialize L13 (GATE 1)** — run the procedure for L13 from the fixture. Produce `L13-plate.png` + `L13-macgregor.png` (cut) + hand crops. **Human reviews** the cutout artifact. STOP if rejected.

- [ ] **Step 3: Materialize L03 (GATE 2)** — run the procedure for L03. Produce `L03-plate.png` (empty map) + `L03-ship.png` (cut). **Human reviews.**

- [ ] **Step 4: Commit the SKILL doc** (assets are gitignored / staging — commit only the doc)

```bash
git add .claude/skills/image-generation/SKILL.md
git commit -m "docs(image-gen): layered-shot materialization procedure (phase 2)"
```

---

## Phase 2 done — what it produced

- `forge.py cutout` (rembg → harden → trim) + tested pure helpers + a proven-clean MacGregor hand.
- A validated Poyais `shots.motion.fixture.json` (L13 slide + L03 path) driving the next phases.
- The image-gen SKILL procedure to materialize a layered shot's plate + cutouts, hand-QC-gated.

## Next: Phase 3 (engine + build_motion) — the Family-A `renderLayer` dispatch + `layers[]` emission, built against this fixture + these assets. Phases 2 and 3 are the parallelizable pair.
