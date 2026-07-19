# channel-forge — Phase 1: Foundations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the invariant foundations of `channel-forge` — the Enforcement Contract, the per-channel Capability-Map data model (schema + validator), the clean-workspace prune helper, and an enriched channel template — so the conductor skill (Phase 2) has a proven law + data model to build on.

**Architecture:** `channel-forge` is a skill package under `.claude/skills/channel-forge/`. Phase 1 delivers its *reference docs* (the Enforcement Contract, the Capability-Map schema) and two small stdlib *scripts* (a schema validator and a workspace-prune helper), plus an enriched `channels/_TEMPLATE/`. No conductor logic yet — this is the foundation the conductor reads and enforces.

**Tech Stack:** Markdown (docs/skill authoring), Python 3 stdlib (scripts), pytest (tests). No third-party deps.

## Global Constraints

- **Worktree/branch:** all work in `C:/Users/danie/faceless-youtube-channel-forge` on branch `feat/channel-forge` (off `master`).
- **Scripts:** Python 3 **stdlib only**; tests use **pytest**. Run with `python -m pytest` (or `py -3 -m pytest`).
- **Git hygiene:** stage **explicit paths** only, **never `git add -A`**, never rewrite history (parallel terminals share the repo).
- **Commit trailer:** every commit message ends with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Doc discipline:** integrate-don't-append; author at router altitude (a fresh terminal with zero context can use the file); source of truth is the spec `docs/superpowers/specs/2026-07-14-channel-forge-design.md`.
- **Self-application:** doc/skill authoring follows the skill-building discipline — do not treat authored docs as throwaway; they are the product.

---

### Task 1: Enforcement Contract reference doc

Author the standalone Enforcement Contract (spec §5) as `channel-forge`'s binding law, including its runtime **usage grammar**. This is an authoring task; its "test" is a fresh-eyes review against the spec + a completeness check (every spec §5 clause present).

**Files:**
- Create: `.claude/skills/channel-forge/references/enforcement-contract.md`

**Interfaces:**
- Consumes: spec `docs/superpowers/specs/2026-07-14-channel-forge-design.md` §5 (source of the clauses).
- Produces: a doc whose top-level sections are exactly `Usage grammar`, `A. Orient before acting`, `B. Use the right tool, the right way`, `C. Right-size the effort`, `D. Validate before you commit effort`, `E. Think critically`, `F. Files, git & housekeeping`, `G. Learn from every run`, `H. Human authority`, `Deferred`. Later tasks/phases reference these section letters (A–H) by name.

- [ ] **Step 1: Draft the doc from spec §5**

Create `.claude/skills/channel-forge/references/enforcement-contract.md`. Open with a one-paragraph purpose line ("The invariant operating law for `channel-forge` and every skill/sub-flow it runs"), then the **Usage grammar** section (verbatim intent from spec §5.1: standing invariant at a known path; read at Stage 0; relevant clauses injected into each stage brief; enforced structurally where checkable; a few mechanical clauses become hooks; evolves only via the learning loop with human confirmation; versioned). Then reproduce clauses **A–H** and **Deferred** from spec §5.2–5.3, one section each, as enforceable bullets (not vague advice).

- [ ] **Step 2: Completeness self-check against the spec**

Re-read spec §5.2. Confirm every clause (A context-first + know-what-exists; B named-skill + self-application + brainstorm-before-build + surface-progress + no-rotting-table; C right-size; D upstream-gate + no-redo + confirm-config + dogfood-before-lock; E push-back + options + converge-internally; F files/provenance + integrate-don't-append + parallel-git + clean-as-a-verb; G learning loop; H final-say + right-altitude + confirm-irreversible + review-medium) appears. Add any missing bullet.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/channel-forge/references/enforcement-contract.md
git commit -m "feat(channel-forge): enforcement contract reference doc

The invariant operating law (spec §5) + its runtime usage grammar.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Capability-Map schema + validator

Define the per-channel Capability-Map data model and a stdlib validator that enforces it. This is the machine-checkable form of §4 (slot resolution).

**Files:**
- Create: `.claude/skills/channel-forge/references/capability-map-schema.md`
- Create: `.claude/skills/channel-forge/scripts/validate_capability_map.py`
- Test: `.claude/skills/channel-forge/scripts/test_validate_capability_map.py`

**Interfaces:**
- Produces: `validate(data: dict) -> list[str]` (returns error strings; empty list = valid) and `validate_file(path: str) -> list[str]`. Module constant `VALID_RESOLUTIONS = {"reuse","reconfigure","adapt","build","n/a"}`. Later phases (the conductor) call `validate_file` before walking a channel.

- [ ] **Step 1: Write the schema doc**

Create `.claude/skills/channel-forge/references/capability-map-schema.md` documenting the JSON shape and rules:

```markdown
# Capability-Map schema (`channels/<name>/capability-map.json`)

Per-channel data: how each pipeline slot is satisfied (spec §4).

## Shape
{
  "channel": "<slug>",                 # required, string
  "production_pipeline": "<id>",       # required, string (a built pipeline, spec §8)
  "slots": {                           # required, object
    "<slot-name>": {
      "resolution": "reuse|reconfigure|adapt|build|n/a",   # required
      "skill": "<skill-name>",         # required for reuse|reconfigure|adapt
      "config": "<path>",              # optional (reconfigure|adapt)
      "plan": "<path-to-plan-doc>"     # required for build
    }
  }
}

## Rules (enforced by validate_capability_map.py)
- top-level `channel`, `production_pipeline`, `slots` are required.
- each slot's `resolution` must be in {reuse, reconfigure, adapt, build, n/a}.
- reuse|reconfigure|adapt require a non-empty `skill`.
- build requires a non-empty `plan`.
- n/a requires no other keys.
```

- [ ] **Step 2: Write the failing tests**

Create `.claude/skills/channel-forge/scripts/test_validate_capability_map.py`:

```python
from validate_capability_map import validate, VALID_RESOLUTIONS


def _base(slots):
    return {"channel": "x", "production_pipeline": "p", "slots": slots}


def test_valid_map_has_no_errors():
    data = _base({"research": {"resolution": "reuse", "skill": "researcher"}})
    assert validate(data) == []


def test_missing_top_level_key():
    errs = validate({"slots": {}})
    assert any("channel" in e for e in errs)
    assert any("production_pipeline" in e for e in errs)


def test_slots_must_be_object():
    errs = validate({"channel": "x", "production_pipeline": "p", "slots": []})
    assert any("slots" in e for e in errs)


def test_invalid_resolution():
    errs = validate(_base({"s": {"resolution": "bogus"}}))
    assert any("invalid resolution" in e for e in errs)


def test_reuse_requires_skill():
    errs = validate(_base({"s": {"resolution": "reuse"}}))
    assert any("requires 'skill'" in e for e in errs)


def test_reconfigure_requires_skill():
    errs = validate(_base({"s": {"resolution": "reconfigure"}}))
    assert any("requires 'skill'" in e for e in errs)


def test_build_requires_plan():
    errs = validate(_base({"s": {"resolution": "build"}}))
    assert any("requires 'plan'" in e for e in errs)


def test_na_slot_ok():
    assert validate(_base({"s": {"resolution": "n/a"}})) == []


def test_enum_constant_shape():
    assert VALID_RESOLUTIONS == {"reuse", "reconfigure", "adapt", "build", "n/a"}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd .claude/skills/channel-forge/scripts && python -m pytest test_validate_capability_map.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'validate_capability_map'`.

- [ ] **Step 4: Write the validator**

Create `.claude/skills/channel-forge/scripts/validate_capability_map.py`:

```python
"""Validate a channel's capability-map.json (channel-forge spec §4)."""
import json
import sys
from pathlib import Path

VALID_RESOLUTIONS = {"reuse", "reconfigure", "adapt", "build", "n/a"}
_SKILL_REQUIRED = {"reuse", "reconfigure", "adapt"}


def validate(data):
    """Return a list of human-readable error strings; empty list means valid."""
    errors = []
    for key in ("channel", "production_pipeline", "slots"):
        if key not in data:
            errors.append(f"missing top-level key: {key}")
    slots = data.get("slots")
    if not isinstance(slots, dict):
        errors.append("'slots' must be an object")
        return errors
    for name, slot in slots.items():
        if not isinstance(slot, dict):
            errors.append(f"slot '{name}' must be an object")
            continue
        res = slot.get("resolution")
        if res not in VALID_RESOLUTIONS:
            errors.append(f"slot '{name}': invalid resolution {res!r}")
            continue
        if res in _SKILL_REQUIRED and not slot.get("skill"):
            errors.append(f"slot '{name}': resolution '{res}' requires 'skill'")
        if res == "build" and not slot.get("plan"):
            errors.append(f"slot '{name}': resolution 'build' requires 'plan'")
    return errors


def validate_file(path):
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    return validate(data)


if __name__ == "__main__":
    errs = validate_file(sys.argv[1])
    if errs:
        print("\n".join(errs))
        sys.exit(1)
    print("ok")
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd .claude/skills/channel-forge/scripts && python -m pytest test_validate_capability_map.py -v`
Expected: PASS (9 passed).

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/channel-forge/references/capability-map-schema.md .claude/skills/channel-forge/scripts/validate_capability_map.py .claude/skills/channel-forge/scripts/test_validate_capability_map.py
git commit -m "feat(channel-forge): capability-map schema + validator

Per-channel slot-resolution data model (spec §4) with a stdlib validator.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Workspace-prune helper (clean-FS)

The enforceable teeth for §6 / clause F ("clean as a verb"): a helper that removes a channel's ephemeral `.workspace/` while leaving named locked assets untouched.

**Files:**
- Create: `.claude/skills/channel-forge/scripts/prune_workspace.py`
- Test: `.claude/skills/channel-forge/scripts/test_prune_workspace.py`

**Interfaces:**
- Produces: `prune(channel_dir: str) -> list[str]` (returns the removed paths; removes only `<channel_dir>/.workspace/`). Later phases call this on stage-lock and run-end.

- [ ] **Step 1: Write the failing tests**

Create `.claude/skills/channel-forge/scripts/test_prune_workspace.py`:

```python
from pathlib import Path

from prune_workspace import prune


def _make_channel(tmp_path):
    ch = tmp_path / "chan"
    (ch / ".workspace" / "style").mkdir(parents=True)
    (ch / ".workspace" / "style" / "scratch1.png").write_text("x", encoding="utf-8")
    (ch / "style-bible.md").write_text("locked", encoding="utf-8")  # a locked, named asset
    return ch


def test_prune_removes_workspace(tmp_path):
    ch = _make_channel(tmp_path)
    removed = prune(str(ch))
    assert not (ch / ".workspace").exists()
    assert any(".workspace" in r for r in removed)


def test_prune_keeps_locked_assets(tmp_path):
    ch = _make_channel(tmp_path)
    prune(str(ch))
    assert (ch / "style-bible.md").exists()
    assert (ch / "style-bible.md").read_text(encoding="utf-8") == "locked"


def test_prune_noop_when_no_workspace(tmp_path):
    ch = tmp_path / "chan"
    ch.mkdir()
    assert prune(str(ch)) == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd .claude/skills/channel-forge/scripts && python -m pytest test_prune_workspace.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'prune_workspace'`.

- [ ] **Step 3: Write the prune helper**

Create `.claude/skills/channel-forge/scripts/prune_workspace.py`:

```python
"""Remove a channel's ephemeral .workspace/ (channel-forge spec §6, clause F)."""
import shutil
import sys
from pathlib import Path


def prune(channel_dir):
    """Remove <channel_dir>/.workspace/. Return the list of removed paths."""
    ws = Path(channel_dir) / ".workspace"
    if not ws.exists():
        return []
    removed = [str(ws)]
    shutil.rmtree(ws)
    return removed


if __name__ == "__main__":
    removed = prune(sys.argv[1])
    print(f"pruned {len(removed)} workspace path(s)")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd .claude/skills/channel-forge/scripts && python -m pytest test_prune_workspace.py -v`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/channel-forge/scripts/prune_workspace.py .claude/skills/channel-forge/scripts/test_prune_workspace.py
git commit -m "feat(channel-forge): workspace-prune helper (clean-FS)

Removes the ephemeral .workspace/ while leaving locked assets (spec §6).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Enriched channel template + worked example

Give a new channel a tidy starting skeleton and prove the data model on a real-shaped example (spec §6 inheritance + §4). Validates end-to-end: the example map passes the Task-2 validator.

**Files:**
- Create: `channels/_TEMPLATE/capability-map.example.json`
- Create: `channels/_TEMPLATE/.workspace/.gitkeep`
- Create: `channels/_TEMPLATE/README.md`

**Interfaces:**
- Consumes: `validate_capability_map.validate_file` (Task 2).
- Produces: a schema-valid `capability-map.example.json` and a template README documenting the inheritance model (referenced-vs-fresh).

- [ ] **Step 1: Write the worked-example Capability Map**

Create `channels/_TEMPLATE/capability-map.example.json` (mirrors The Second Take's shape as the reference exemplar):

```json
{
  "channel": "example-channel",
  "production_pipeline": "stylized-compositing",
  "slots": {
    "research": { "resolution": "reuse", "skill": "researcher" },
    "script": { "resolution": "reconfigure", "skill": "long-form-writer", "config": "storytelling-grammar.md" },
    "shorts": { "resolution": "reuse", "skill": "shorts-writer" },
    "metadata": { "resolution": "reuse", "skill": "metadata-writer" },
    "visual_plan": { "resolution": "reuse", "skill": "visual-prompt-writer" },
    "visual": { "resolution": "reuse", "skill": "image-generation" },
    "motion": { "resolution": "reuse", "skill": "motion-planner" },
    "audio": { "resolution": "reuse", "skill": "audio-director" },
    "voice": { "resolution": "reuse", "skill": "voiceover" },
    "render": { "resolution": "reuse", "skill": "render-builder" },
    "publish": { "resolution": "n/a" }
  }
}
```

- [ ] **Step 2: Add the ephemeral-workspace marker**

Create `channels/_TEMPLATE/.workspace/.gitkeep` (empty file) so the ephemeral exploration dir exists in a fresh channel; its contents are pruned by Task 3's helper on lock.

- [ ] **Step 3: Write the template README (inheritance model)**

Create `channels/_TEMPLATE/README.md`:

```markdown
# Channel template

Copy this folder to `channels/<name>/` to start a channel. `channel-forge`
fills it in stage-by-stage.

## What lives here (channel-specific, freshly built)
- `dna.md`, `idea-backlog.md`, `performance.md`
- `capability-map.json` (copy from `capability-map.example.json`; how each
  pipeline slot is resolved — see the schema in the channel-forge skill)
- `visual-kit/`, `storytelling-grammar.md`, etc. (built during genesis)
- `.workspace/` — ephemeral exploration; pruned on lock, never committed with scratch

## What is NOT copied here (universal, referenced)
The skills, `knowledge/` playbook + `universal.md`, and the dna/style-bible/
guardrail *schemas* live at the repo root and are referenced, never duplicated
into a channel.
```

- [ ] **Step 4: Validate the example against the schema**

Run: `cd .claude/skills/channel-forge/scripts && python validate_capability_map.py ../../../../channels/_TEMPLATE/capability-map.example.json`
Expected: prints `ok` (exit 0).

- [ ] **Step 5: Commit**

```bash
git add channels/_TEMPLATE/capability-map.example.json channels/_TEMPLATE/.workspace/.gitkeep channels/_TEMPLATE/README.md
git commit -m "feat(channel-forge): enriched channel template + worked capability-map

Tidy channel skeleton + a schema-valid example map + inheritance README (spec §6).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase 1 done-when
- The Enforcement Contract doc exists with all A–H clauses + usage grammar.
- `validate_capability_map.py` + tests pass; `prune_workspace.py` + tests pass.
- The template has a schema-valid example map, a `.workspace/` marker, and an inheritance README; the validator prints `ok` on the example.

## Deferred to later phases (not this plan)
- **Phase 2:** the `channel-forge` conductor `SKILL.md` (Stage 0 context gate, reads the Capability Map, walks stages, enforces structural gates, resumable state) — authored via the skill-building tooling.
- **Phase 3:** the internal-convergence stage skills (research → generate → self-critique → present).
- **Phase 4:** the learning loop; broader housekeeping (retire resolved handoffs); harness hooks for the mechanical clauses; the production-pipeline registry; compliance (spec §5.3).
- **Dogfood target** (real channel genesis vs. re-deriving The Second Take) — a Phase-2+ decision.
