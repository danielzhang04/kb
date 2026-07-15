# T2 Device-Card Producer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the engine's T2 device kit (stat-card / counter / meter / chapter-card / definition-card / progressive-reveal) actually render in the pipeline by having `motion-planner` author them as engine device-layers and `build_motion` route them into `motion.json` `overlays[]`.

**Architecture:** No new skill, no engine code. `motion-planner` writes `source:"engine"` device-layers into `shots.motion.json` (a schema surface that already lists these kinds). `build_motion.apply_motion_plan` — which today drops every non-cutout layer — is changed to *route by source*: cutout → `layers[]` (unchanged), engine device-kind → a mapped `overlays[]` entry (rendered by the existing `OverlayView`). Diegetic `at_scene` text is deferred and its authoring rule disabled so image-gen stops leaving unfilled plate holes.

**Tech Stack:** Python 3 (stdlib only) for `build_motion.py` / `motion_plan.py`; plain-assert test scripts; Remotion/TypeScript engine (unchanged). Markdown docs.

## Global Constraints

- **No pytest in this repo.** Tests are plain-assert scripts with a `main()` (or direct call), run as `python <path>/test_x.py` and printing `OK`. Do NOT introduce pytest. Match `test_motion_plan.py` / `test_motion_plan_merge.py` style.
- **Windows shell.** Run Python as `python` from the repo root; test files self-insert their dir on `sys.path`, so cwd doesn't matter.
- **Parallel terminals share this tree.** Stage explicit paths only — never `git add -A`, never rewrite history. `knowledge/decisions.md` is currently unstaged WIP from another terminal; edit in place and add only that file by explicit path.
- **Integrate, don't append (docs).** Edit docs in place — replace the superseded text, never stack a dated block at the bottom. The device-card story must read as ONE path afterward.
- **Device kind vs animation type are different axes.** A device layer sets `kind` (the card type) and omits `animation` (it self-animates). The `reveal` kind maps to the `progressive-reveal` overlay type.
- **Spec:** `docs/superpowers/specs/2026-07-12-t2-device-card-producer-design.md`.

---

## File Structure

- `.claude/skills/render-builder/scripts/motion_plan.py` — add device-`content` validation to `validate_plan`.
- `.claude/skills/render-builder/scripts/build_motion.py` — rewrite `apply_motion_plan` to route engine device-layers → overlays; add a `_device_overlay` mapper + `_DEVICE_KIND_TO_TYPE`.
- `.claude/skills/render-builder/scripts/test_motion_plan.py` — device validation tests.
- `.claude/skills/render-builder/scripts/test_motion_plan_merge.py` — device→overlay routing tests.
- `.claude/skills/motion-planner/references/animation-rules.md` — add device rule; park diegetic.
- `.claude/skills/render-builder/references/{motion-schema.md, shots-motion-schema.md}` — reconcile.
- `.claude/skills/render-builder/SKILL.md` — kill the never-built "hand-augment overlays" path.
- `CLAUDE.md`, `knowledge/decisions.md` — status + decision entry.

---

## Task 1: Device-`content` validation in `motion_plan.py`

**Files:**
- Modify: `.claude/skills/render-builder/scripts/motion_plan.py`
- Test: `.claude/skills/render-builder/scripts/test_motion_plan.py`

**Interfaces:**
- Consumes: `validate_plan(plan, menu)` (existing) → `list[str]` of error strings.
- Produces: unchanged signature; now also errors when an engine device-layer omits required `content`.

- [ ] **Step 1: Write the failing tests.** Append to `test_motion_plan.py` (before `def main()`), and add both names to the `main()` loop list:

```python
def test_device_layer_missing_content_errors():
    plan = {"shots": [{"id": "L14", "background": {"mode": "plate", "plate_prompt": "desk"},
            "layers": [{"id": "raised", "source": "engine", "kind": "counter",
                        "content": {"from": 0}}]}]}  # missing 'to'
    errs = validate_plan(plan, load_menu())
    assert any("to" in e and "counter" in e for e in errs), errs


def test_valid_device_layer_ok():
    plan = {"shots": [{"id": "L14", "background": {"mode": "plate", "plate_prompt": "desk"},
            "layers": [{"id": "raised", "source": "engine", "kind": "stat-card",
                        "content": {"text": "£1.3M", "sub": "in bonds"}}]}]}
    assert validate_plan(plan, load_menu()) == []
```

Update `main()`'s list to include both: `test_device_layer_missing_content_errors, test_valid_device_layer_ok`.

- [ ] **Step 2: Run to verify it fails.**

Run: `python .claude/skills/render-builder/scripts/test_motion_plan.py`
Expected: FAIL — `test_device_layer_missing_content_errors` raises AssertionError (no error is produced yet because content isn't validated).

- [ ] **Step 3: Implement the validation.** In `motion_plan.py`, add the required-fields map below `_ENGINE_KINDS`:

```python
_DEVICE_CONTENT = {
    "stat-card": ["text"],
    "counter": ["from", "to"],
    "meter": ["label", "fraction"],
    "chapter-card": ["text"],
    "definition-card": ["term", "def"],
    "reveal": ["items"],
}
```

Then replace the `if src == "engine" ...` block inside `validate_plan` with:

```python
            if src == "engine":
                kind = layer.get("kind")
                if kind not in _ENGINE_KINDS:
                    errors.append(f"{sid}/{lid}: engine layer needs a valid kind")
                elif kind in _DEVICE_CONTENT:
                    content = layer.get("content")
                    if not isinstance(content, dict):
                        errors.append(f"{sid}/{lid}: {kind} needs a content object")
                    else:
                        for f in _DEVICE_CONTENT[kind]:
                            if f not in content:
                                errors.append(f"{sid}/{lid}: {kind} content missing '{f}'")
```

(The existing `anim` check that follows stays unchanged.)

- [ ] **Step 4: Run to verify it passes.**

Run: `python .claude/skills/render-builder/scripts/test_motion_plan.py`
Expected: PASS — prints `ok` for each test then `OK`. (Existing `test_missing_background_errors` / `test_layer_with_offmenu_animation_errors` still pass.)

- [ ] **Step 5: Commit.**

```bash
git add .claude/skills/render-builder/scripts/motion_plan.py .claude/skills/render-builder/scripts/test_motion_plan.py
git commit -m "feat(motion): validate device-card content in shots.motion.json plans

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Route engine device-layers → overlays in `build_motion.apply_motion_plan`

**Files:**
- Modify: `.claude/skills/render-builder/scripts/build_motion.py` (`apply_motion_plan`, ~L114-129)
- Test: `.claude/skills/render-builder/scripts/test_motion_plan_merge.py`

**Interfaces:**
- Consumes: `apply_motion_plan(shots, plan)` — `shots` are the derived motion shots (each may carry `start_s`, `duration_s`, `overlays`); `plan` is a parsed `shots.motion.json`.
- Produces: `apply_motion_plan` now also appends device overlays to `shot["overlays"]`. New module-level helpers: `_DEVICE_KIND_TO_TYPE` (dict) and `_device_overlay(layer, start_s, duration_s) -> dict`.

- [ ] **Step 1: Write the failing tests.** Append to `test_motion_plan_merge.py` (before the `__main__` block), and add the calls to `__main__`:

```python
def test_routes_engine_counter_to_overlay():
    shots = [{"id": "L14", "start_s": 88.2, "duration_s": 4.0, "overlays": []}]
    plan = {"shots": [{"id": "L14", "background": {"mode": "plate", "plate_prompt": "desk"},
            "layers": [{"id": "raised", "source": "engine", "kind": "counter",
                        "content": {"from": 0, "to": 8000000, "suffix": " acres", "duration_s": 1.6}}]}]}
    out = apply_motion_plan(shots, plan)
    ov = out[0]["overlays"]
    assert len(ov) == 1 and ov[0]["type"] == "counter", ov
    assert ov[0]["to"] == 8000000 and ov[0]["suffix"] == " acres"
    assert ov[0]["at_s"] == 88.2, ov
    assert "layers" not in out[0] and "plate" not in out[0], out[0]  # no cutouts -> no plate


def test_reveal_items_stagger_across_shot():
    shots = [{"id": "L20", "start_s": 10.0, "duration_s": 6.0, "overlays": []}]
    plan = {"shots": [{"id": "L20", "background": {"mode": "plate", "plate_prompt": "poster"},
            "layers": [{"id": "amenities", "source": "engine", "kind": "reveal",
                        "content": {"items": [{"text": "Opera house"}, {"text": "National bank"},
                                              {"text": "Boulevards"}], "mark": "x"}}]}]}
    out = apply_motion_plan(shots, plan)
    ov = out[0]["overlays"][0]
    assert ov["type"] == "progressive-reveal" and ov["mark"] == "x", ov
    ats = [it["at_s"] for it in ov["items"]]
    assert ats == [10.0, 12.0, 14.0], ats  # 3 items across 6s from t=10


def test_diegetic_text_layer_is_skipped():
    shots = [{"id": "L03", "start_s": 5.0, "duration_s": 3.0, "overlays": []}]
    plan = {"shots": [{"id": "L03", "background": {"mode": "plate", "plate_prompt": "map"},
            "layers": [{"id": "acres", "source": "engine", "kind": "text",
                        "content": {"text": "8M acres"}, "at_scene": {"x": 0.4, "y": 0.5}}]}]}
    out = apply_motion_plan(shots, plan)
    assert out[0]["overlays"] == [], out[0]  # deferred: skipped, no crash
```

Add to the `if __name__ == "__main__":` block: `test_routes_engine_counter_to_overlay(); test_reveal_items_stagger_across_shot(); test_diegetic_text_layer_is_skipped(); print("OK")`.

- [ ] **Step 2: Run to verify it fails.**

Run: `python .claude/skills/render-builder/scripts/test_motion_plan_merge.py`
Expected: FAIL — the new tests raise AssertionError (current `apply_motion_plan` drops engine layers, so `overlays` stays `[]` for the counter/reveal tests).

- [ ] **Step 3: Implement the routing.** In `build_motion.py`, add above `apply_motion_plan`:

```python
_DEVICE_KIND_TO_TYPE = {
    "stat-card": "stat-card", "counter": "counter", "meter": "meter",
    "chapter-card": "chapter-card", "definition-card": "definition-card",
    "reveal": "progressive-reveal",
}


def _device_overlay(layer, start_s, duration_s):
    """Map a shots.motion.json engine device-layer to a motion.json overlay dict (at_s = shot start).
    Reveal items stagger evenly across the shot (v1); other kinds copy content through verbatim
    (content fields mirror the engine OverlayView props)."""
    kind = layer.get("kind")
    content = layer.get("content") or {}
    otype = _DEVICE_KIND_TO_TYPE[kind]
    ov = {"type": otype, "at_s": round(start_s, 3)}
    if otype == "progressive-reveal":
        items = content.get("items") or []
        n = max(1, len(items))
        span = duration_s if duration_s and duration_s > 0 else float(n)
        step = span / n
        ov["items"] = [{"text": (it.get("text") if isinstance(it, dict) else str(it)),
                        "at_s": round(start_s + i * step, 3)} for i, it in enumerate(items)]
        ov["mark"] = content.get("mark", "pop")
    else:
        for k, v in content.items():
            ov[k] = v
    return ov
```

Then replace the body of `apply_motion_plan` with:

```python
def apply_motion_plan(shots, plan):
    """Merge a shots.motion.json layer spec into the derived motion shots, by id.
    Cutout layers -> render paths (plates/<id>.png + cutouts/<id>-<layer>.png) on shot['layers'].
    Engine device-layers (stat-card/counter/meter/chapter-card/definition-card/reveal) -> shot['overlays']
    (rendered by OverlayView; at_s = the shot's start). An engine 'text' (diegetic at_scene) layer is
    DEFERRED and skipped with a warning. Shots absent from the plan are untouched."""
    by_id = {s.get("id"): s for s in (plan or {}).get("shots", [])}
    for shot in shots:
        entry = by_id.get(shot.get("id"))
        if not entry:
            continue
        sid = shot["id"]
        layers = entry.get("layers", [])
        cutouts = [l for l in layers if l.get("source") == "cutout"]
        if cutouts:
            shot["plate"] = f"plates/{sid}.png"
            shot["layers"] = [{"id": l["id"], "src": f"cutouts/{sid}-{l['id']}.png",
                               "animation": l.get("animation")} for l in cutouts]
        start_s = shot.get("start_s", 0.0)
        dur = shot.get("duration_s", 0.0)
        for l in layers:
            if l.get("source") != "engine":
                continue
            kind = l.get("kind")
            if kind in _DEVICE_KIND_TO_TYPE:
                shot.setdefault("overlays", []).append(_device_overlay(l, start_s, dur))
            elif kind == "text":
                print(f"  ! {sid}/{l.get('id','?')}: diegetic at_scene text deferred — layer skipped")
    return shots
```

- [ ] **Step 4: Run to verify it passes.**

Run: `python .claude/skills/render-builder/scripts/test_motion_plan_merge.py`
Expected: PASS — prints `OK`. The pre-existing `test_merges_cutout_layers_and_leaves_others` still passes (L13 cutout → plate+layers; L99 untouched).

- [ ] **Step 5: Run the broader build_motion tests (regression).**

Run: `python .claude/skills/render-builder/scripts/test_build_motion.py`
Expected: PASS (no regression in derive/audio paths).

- [ ] **Step 6: Commit.**

```bash
git add .claude/skills/render-builder/scripts/build_motion.py .claude/skills/render-builder/scripts/test_motion_plan_merge.py
git commit -m "feat(motion): route engine device-layers -> motion.json overlays (T2 device kit reaches render)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Author device cards in `motion-planner` + park diegetic text

**Files:**
- Modify: `.claude/skills/motion-planner/references/animation-rules.md`

**Interfaces:**
- Consumes: nothing (doc). Produces: the authoring ruleset that makes motion-planner emit device-layers this build validates + routes.

- [ ] **Step 1: Replace the diegetic section with the device rule.** In `animation-rules.md`, replace the whole `## When to make text engine-drawn (diegetic)` section (its heading + the two bullet lines) with:

```markdown
## When to add a device card (Family B — engine-drawn, screen-space)
A device card renders REAL type over the scene (the engine draws it; image-gen can't render legible
text). Timid by default — most shots get none. Author as an `engine` layer with a device `kind` +
`content` (no `animation` — it self-animates); it pops at the shot's start. **Subtraction rule (hard):
never card a number/term/text the shot's `still_prompt` already depicts** — the card is for data the
still deliberately omits.
- A stated **number/amount** the still doesn't legibly show → `stat-card` (a fixed figure) or
  `counter` (a value dramatized by climbing).
- A **term the viewer needs defined** → `definition-card` (sparing).
- An **enumerated list** (esp. one being debunked) → `reveal` (`mark:"x"` = struck-through debunk,
  `"pop"` = a plain build).
- A **section turn** → `chapter-card`. A **proportion/ratio** ("50 of 250") → `meter`.

## Deferred — diegetic in-scene text (`at_scene`)
Text positioned ON an object (a map's "8M acres") is PARKED: it needs OverlayView scene-coordinate
positioning that isn't built. Do NOT author `kind:"text"`/`at_scene` layers — they'd leave an
unfilled plate hole (image-gen omits the text expecting a fill that never comes). Revisit when
at_scene lands.
```

- [ ] **Step 2: Verify a hand-written example plan lints clean.** Create a scratch plan and validate it end-to-end (proves the rule's output shape passes Task 1's validation). Run:

```bash
python -c "import sys; sys.path.insert(0,'.claude/skills/render-builder/scripts'); from menu import load_menu; from motion_plan import validate_plan; plan={'shots':[{'id':'L14','background':{'mode':'plate','plate_prompt':'desk, no numbers'},'layers':[{'id':'raised','source':'engine','kind':'stat-card','content':{'text':'£1.3M','sub':'in bonds'}}]}]}; errs=validate_plan(plan, load_menu()); print('ERRORS' if errs else 'CLEAN', errs)"
```

Expected: `CLEAN []`.

- [ ] **Step 3: Commit.**

```bash
git add .claude/skills/motion-planner/references/animation-rules.md
git commit -m "docs(motion-planner): add device-card authoring rule; park diegetic at_scene text

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Reconcile render-builder docs (kill the double path)

**Files:**
- Modify: `.claude/skills/render-builder/SKILL.md` (~L68-75)
- Modify: `.claude/skills/render-builder/references/motion-schema.md` (L8, L87 overlays row)
- Modify: `.claude/skills/render-builder/references/shots-motion-schema.md` (engine-layer bullet + a content table)

**Interfaces:** docs only. After this, exactly one device-card story exists: `on_screen_text`→plain text; motion-planner engine device-layers→device overlays; diegetic `at_scene`→deferred.

- [ ] **Step 1: SKILL.md — replace the never-built manual path.** Replace the sentence beginning "The **motion authoring step** (the thin judgment layer): after the dry-run you MAY augment …" through "… wherever a shot's `on_screen_text` calls for one — then render." with:

```markdown
**T2 device cards are authored upstream, not here:** `motion-planner` emits them as `source:"engine"`
device-layers in `shots.motion.json`, and `build_motion` routes them into `motion.json` `overlays[]`
(via `apply_motion_plan`) — render-builder never hand-edits overlays.
```

(Keep the following "Never hand-edit the derived timing fields; re-derive instead. Channel look = …" text intact.)

- [ ] **Step 2: motion-schema.md L8 — fix the pointer.** Replace `the thin judgment layer on top is documented in SKILL.md (augmenting \`overlays\`), never a schema change.` with:

```markdown
device-card overlays are authored upstream by `motion-planner` (engine device-layers in
`shots.motion.json`) and routed here by `apply_motion_plan`, never a schema change.
```

- [ ] **Step 3: motion-schema.md — rewrite the `overlays` derivation row (L87).** Replace that table row with:

```markdown
| `overlays` | `on_screen_text` → `{type:"text", at_s: start}`; **device cards** ← `shots.motion.json` engine device-layers via `apply_motion_plan` | `on_screen_text` yields a plain `text` overlay. A `motion-planner` engine device-layer (`kind` ∈ stat-card/counter/meter/chapter-card/definition-card/reveal) routes to its overlay (`reveal`→`progressive-reveal`), `at_s` = the shot's start; reveal items stagger across the shot duration (v1) |
```

- [ ] **Step 4: shots-motion-schema.md — clarify engine device vs deferred text + add content table.** Replace the two `- engine:` / `- \`animation\`` bullet lines under "Per long-form shot" with:

```markdown
  - engine **device card** (`kind` ∈ stat-card | counter | meter | chapter-card | definition-card |
    reveal): a `content` object (fields below), **no `animation`** (self-animates by kind). Routed to
    `motion.json` `overlays[]` by `build_motion.apply_motion_plan`, `at_s` = the shot's start.
  - engine **diegetic text** (`kind: "text"` + `at_scene: {x, y}`): **DEFERRED** — needs OverlayView
    scene-coordinate positioning that does not exist yet; not authored today (build_motion skips it).
  - `animation` (object, optional; cutout only): `{ "type": <cutout-menu entry>, ...params }`.
```

Then add, immediately after the `## Rules` section:

```markdown
## Device-card `content` (per `kind`)
| kind | required | optional |
| --- | --- | --- |
| stat-card | `text` | `sub` |
| counter | `from`, `to` | `prefix`, `suffix`, `duration_s` |
| meter | `label`, `fraction` (0–1) | — |
| chapter-card | `text` | — |
| definition-card | `term`, `def` | — |
| reveal | `items` (`[{text}]`) | `mark` (`x`\|`pop`) |

Fields mirror the engine `OverlayView` props; `motion_plan.py` enforces the required set.
```

- [ ] **Step 5: Verify no stale manual-overlay language remains.**

Run: `grep -rniE "augment.*overlays|on_screen_text calls for|hand-?edit.*overlays|thin judgment layer" .claude/skills/render-builder`
Expected: no matches (or only the audio-plan `dry`/`thin_spans` usages, which are unrelated — confirm none mention overlays/devices).

- [ ] **Step 6: Commit.**

```bash
git add .claude/skills/render-builder/SKILL.md .claude/skills/render-builder/references/motion-schema.md .claude/skills/render-builder/references/shots-motion-schema.md
git commit -m "docs(render-builder): one device-card path (motion-planner authors, build_motion routes); kill never-built manual overlay step

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Log status + decision

**Files:**
- Modify: `CLAUDE.md` (Current status — the motion/audio block)
- Modify: `knowledge/decisions.md` (append one dated entry — see the parallel-terminal caution)

**Interfaces:** docs only.

- [ ] **Step 1: decisions.md — add the entry.** Add this as a new dated bullet in the appropriate 2026-07-12 area (do NOT reflow other terminals' unstaged edits around it):

```markdown
- **2026-07-12 — T2 device-card producer (motion-planner authors, build_motion routes).** The engine
  T2 device kit (stat-card/counter/meter/chapter-card/definition-card/progressive-reveal) was built +
  schema-declared but DARK — nothing authored it and `apply_motion_plan` dropped all engine layers.
  Wired it the integrated way: `motion-planner` authors device cards as `source:"engine"` device-layers
  in `shots.motion.json` (kinds already in the schema; a subtraction rule avoids duplicating baked-in
  still text), and `build_motion.apply_motion_plan` now ROUTES engine device-layers → `motion.json`
  `overlays[]` (OverlayView renders them, `at_s`=shot start; reveal items stagger v1). No new skill, no
  engine code — activated an existing surface. Diegetic `at_scene` text deferred (needs OverlayView
  scene positioning); its authoring rule disabled so image-gen stops leaving holes. Killed the
  never-built "hand-augment motion.json overlays" path in render-builder SKILL/motion-schema. Device-card
  SFX auto-fires once cards render. Spec:
  `docs/superpowers/specs/2026-07-12-t2-device-card-producer-design.md`.
```

- [ ] **Step 2: CLAUDE.md — update the motion status.** In the "MOTION ENGINE / LAYERED-MOTION" status area, integrate one clause noting the T2 device kit is now wired (motion-planner authors engine device-layers → build_motion routes to overlays; diegetic at_scene deferred). Replace any wording that implies the device kit is unbuilt/dark; do NOT append a dated block.

- [ ] **Step 3: Commit (explicit paths only).**

```bash
git add CLAUDE.md knowledge/decisions.md
git commit -m "docs: log T2 device-card producer (status + decision)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

- **Spec coverage:** authoring home (Task 3), routing code change (Task 2), content contract + validation (Tasks 1, 4), timing/stagger (Task 2 `_device_overlay`), neutralize B (Task 3 + Task 2 skip-with-warning), doc reconciliation incl. the exact stale lines (Task 4), status/decision log (Task 5). Device-card SFX auto-fire = documented as out-of-scope side effect (Task 5 entry). Covered.
- **Placeholder scan:** every code step shows full code; every doc step shows exact replacement text; test commands are concrete. None outstanding.
- **Type consistency:** `_DEVICE_CONTENT` (motion_plan) and `_DEVICE_KIND_TO_TYPE` (build_motion) both key on the same six kinds; `reveal`→`progressive-reveal` mapping is consistent across Task 2 code, tests, and docs. `_device_overlay(layer, start_s, duration_s)` signature matches its one call site.
- **Post-implementation validation:** the real integration proof is the **Tier-1 mock render** (placeholder scenes + real VO on a Poyais slice) after these tasks — device cards should render as real type, timed to VO, with device SFX auto-firing. That belongs to the pipeline test run, not this plan.
