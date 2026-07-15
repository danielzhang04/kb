# channel-forge — Phase 2: Conductor Skeleton — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `channel-forge` conductor skeleton — the thin skill that establishes context (Stage 0), walks a defined genesis stage sequence, enforces the structural gates, persists resumable run-state, and produces a channel scaffold — on top of the Phase-1 foundations.

**Architecture:** A `channel-forge` SKILL.md (the runtime procedure) + a stdlib run-state helper (`forge_state.py`) that makes the walk resumable and in-order, + a machine-readable genesis stage sequence. The conductor *reads* the Phase-1 Enforcement Contract and Capability-Map validator; it does NOT yet do rich per-stage option-generation (Phase 3).

**Tech Stack:** Markdown (SKILL.md, stage docs), Python 3 stdlib (`forge_state.py`), pytest (tests, run via `py -3 -m pytest`).

## Global Constraints

- **Worktree/branch:** all work in `C:/Users/danie/faceless-youtube-channel-forge` on branch `feat/channel-forge`.
- **Scripts:** Python 3 **stdlib only**; tests use **pytest** via `py -3 -m pytest` (pytest is installed under `py -3`).
- **Git hygiene:** stage **explicit paths** only, **never `git add -A`**, never rewrite history.
- **Commit trailer:** every commit ends with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Self-application (clause B):** the SKILL.md is authored following the skill-building discipline — real frontmatter + a clear trigger description; it is the product, not a throwaway.
- **Depends on Phase 1:** `validate_capability_map.py`, `prune_workspace.py`, `enforcement-contract.md`, the enriched template.
- **Scope:** skeleton only. Rich per-stage option-generation (research → generate → self-critique → present) is Phase 3 and must NOT be built here.

---

### Task 1: Genesis stage sequence (data + doc)

Pin the default genesis stages the conductor walks. Machine-readable list + a human doc of what each stage does.

**Files:**
- Create: `.claude/skills/channel-forge/references/genesis-stages.json`
- Create: `.claude/skills/channel-forge/references/genesis-stages.md`

**Interfaces:**
- Produces: a JSON array of `{"id": str, "title": str, "human_gate": bool}` objects, in walk order. `forge_state.load_default_stages()` (Task 2) reads it and returns the list of `id` strings.

- [ ] **Step 1: Write the stage sequence JSON**

Create `.claude/skills/channel-forge/references/genesis-stages.json`:

```json
[
  { "id": "niche", "title": "What the channel is about", "human_gate": true },
  { "id": "doctrine", "title": "One-lever positioning / doctrine", "human_gate": true },
  { "id": "format", "title": "Length, cadence, format mix", "human_gate": true },
  { "id": "visual-style", "title": "The locked look (style bible)", "human_gate": true },
  { "id": "voice", "title": "Narrator voice pick", "human_gate": true },
  { "id": "production-pipeline", "title": "Choose the production pipeline", "human_gate": true },
  { "id": "capability-map", "title": "Resolve each production slot", "human_gate": true },
  { "id": "storytelling-grammar", "title": "Writing-craft grammar", "human_gate": true },
  { "id": "guardrails", "title": "Channel-specific guardrails", "human_gate": true },
  { "id": "scaffold", "title": "Write the channel folder", "human_gate": true },
  { "id": "backlog", "title": "Seed the idea backlog", "human_gate": true }
]
```

- [ ] **Step 2: Write the stage doc**

Create `.claude/skills/channel-forge/references/genesis-stages.md` describing, one short paragraph each, what each stage decides and which existing artifact/skill it produces (niche→brief/dna Identity; doctrine→dna Doctrine; format→dna Format; visual-style→visual-kit/style-bible.md; voice→dna Voiceover config; production-pipeline→capability-map `production_pipeline`; capability-map→`capability-map.json` via Phase-1 validator; storytelling-grammar→`storytelling-grammar.md`; guardrails→dna Guardrails; scaffold→the channel folder from `_TEMPLATE/`; backlog→`idea-backlog.md` via `idea-generator`). State that all stages are human-gated (clause H) and that rich per-stage option-generation is Phase 3.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/channel-forge/references/genesis-stages.json .claude/skills/channel-forge/references/genesis-stages.md
git commit -m "feat(channel-forge): default genesis stage sequence

The ordered stages the conductor walks (spec §4/§10), all human-gated.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Run-state helper (`forge_state.py`)

The resumable, in-order state machine behind the walk. Persists `.forge-state.json` at the channel root (NOT under `.workspace/`, so `prune_workspace` never destroys progress).

**Files:**
- Create: `.claude/skills/channel-forge/scripts/forge_state.py`
- Test: `.claude/skills/channel-forge/scripts/test_forge_state.py`

**Interfaces:**
- Produces:
  - `STATE_FILENAME = ".forge-state.json"`
  - `load_default_stages() -> list[str]` — reads `references/genesis-stages.json`, returns the `id`s in order.
  - `init_state(channel_dir, stages) -> dict` — writes `.forge-state.json` with `{"stages": stages, "locked": [], "current": stages[0]}`; returns it.
  - `load_state(channel_dir) -> dict` — reads and returns the state.
  - `current_stage(channel_dir) -> str | None` — the stage awaiting work, or `None` if complete.
  - `lock_stage(channel_dir, stage) -> dict` — locks `stage` (must equal `current`, else `ValueError`), advances `current` to the next unlocked stage (or `None`); returns the new state.
  - `is_complete(channel_dir) -> bool`.

- [ ] **Step 1: Write the failing tests**

Create `.claude/skills/channel-forge/scripts/test_forge_state.py`:

```python
import pytest

from forge_state import (
    init_state,
    load_state,
    current_stage,
    lock_stage,
    is_complete,
    STATE_FILENAME,
)

STAGES = ["a", "b", "c"]


def test_init_writes_state_file(tmp_path):
    state = init_state(str(tmp_path), STAGES)
    assert (tmp_path / STATE_FILENAME).exists()
    assert state["stages"] == STAGES
    assert state["locked"] == []
    assert state["current"] == "a"


def test_load_returns_written_state(tmp_path):
    init_state(str(tmp_path), STAGES)
    assert load_state(str(tmp_path))["current"] == "a"


def test_current_stage(tmp_path):
    init_state(str(tmp_path), STAGES)
    assert current_stage(str(tmp_path)) == "a"


def test_lock_advances_current(tmp_path):
    init_state(str(tmp_path), STAGES)
    state = lock_stage(str(tmp_path), "a")
    assert state["locked"] == ["a"]
    assert state["current"] == "b"


def test_lock_out_of_order_raises(tmp_path):
    init_state(str(tmp_path), STAGES)
    with pytest.raises(ValueError):
        lock_stage(str(tmp_path), "b")


def test_full_walk_completes(tmp_path):
    init_state(str(tmp_path), STAGES)
    for s in STAGES:
        lock_stage(str(tmp_path), s)
    assert current_stage(str(tmp_path)) is None
    assert is_complete(str(tmp_path)) is True


def test_resumable_across_fresh_calls(tmp_path):
    init_state(str(tmp_path), STAGES)
    lock_stage(str(tmp_path), "a")
    # simulate a fresh terminal: only load_state / current_stage, no in-memory carryover
    assert current_stage(str(tmp_path)) == "b"
    assert load_state(str(tmp_path))["locked"] == ["a"]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd .claude/skills/channel-forge/scripts && py -3 -m pytest test_forge_state.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'forge_state'`.

- [ ] **Step 3: Write the state helper**

Create `.claude/skills/channel-forge/scripts/forge_state.py`:

```python
"""Resumable, in-order genesis run-state for channel-forge (spec §3)."""
import json
from pathlib import Path

STATE_FILENAME = ".forge-state.json"
_STAGES_JSON = Path(__file__).resolve().parent.parent / "references" / "genesis-stages.json"


def load_default_stages():
    """Return the default genesis stage ids, in walk order."""
    data = json.loads(_STAGES_JSON.read_text(encoding="utf-8"))
    return [s["id"] for s in data]


def _path(channel_dir):
    return Path(channel_dir) / STATE_FILENAME


def _write(channel_dir, state):
    _path(channel_dir).write_text(json.dumps(state, indent=2), encoding="utf-8")
    return state


def init_state(channel_dir, stages):
    """Create the state file at the start of a genesis run."""
    state = {"stages": list(stages), "locked": [], "current": stages[0] if stages else None}
    return _write(channel_dir, state)


def load_state(channel_dir):
    return json.loads(_path(channel_dir).read_text(encoding="utf-8"))


def current_stage(channel_dir):
    return load_state(channel_dir)["current"]


def lock_stage(channel_dir, stage):
    """Lock `stage` (must be the current stage) and advance to the next unlocked stage."""
    state = load_state(channel_dir)
    if stage != state["current"]:
        raise ValueError(f"cannot lock {stage!r}: current stage is {state['current']!r}")
    state["locked"].append(stage)
    remaining = [s for s in state["stages"] if s not in state["locked"]]
    state["current"] = remaining[0] if remaining else None
    return _write(channel_dir, state)


def is_complete(channel_dir):
    return load_state(channel_dir)["current"] is None
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd .claude/skills/channel-forge/scripts && py -3 -m pytest test_forge_state.py -q`
Expected: PASS (7 passed).

- [ ] **Step 5: Verify load_default_stages reads the real data file**

Run: `cd .claude/skills/channel-forge/scripts && py -3 -c "import forge_state; print(forge_state.load_default_stages())"`
Expected: prints `['niche', 'doctrine', 'format', 'visual-style', 'voice', 'production-pipeline', 'capability-map', 'storytelling-grammar', 'guardrails', 'scaffold', 'backlog']`

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/channel-forge/scripts/forge_state.py .claude/skills/channel-forge/scripts/test_forge_state.py
git commit -m "feat(channel-forge): resumable in-order run-state helper

.forge-state.json state machine behind the conductor walk (spec §3). 7 tests pass.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: The conductor SKILL.md

The runtime procedure. Authored per the skill-building discipline (clause B): real frontmatter + a trigger description, then the Stage-0 gate, the walk loop, the structural gates, and the human gates — wiring the Phase-1 + Task-1/2 pieces together.

**Files:**
- Create: `.claude/skills/channel-forge/SKILL.md`

**Interfaces:**
- Consumes: `enforcement-contract.md`, `genesis-stages.json`, `forge_state.py`, `validate_capability_map.py`, `prune_workspace.py`, `channels/_TEMPLATE/`.
- Produces: no code interface; a runtime procedure a future terminal follows.

- [ ] **Step 1: Write the SKILL.md**

Create `.claude/skills/channel-forge/SKILL.md` with YAML frontmatter and body:

````markdown
---
name: channel-forge
description: Guided channel-genesis conductor for this faceless-YouTube project — builds a NEW channel by walking a stage-by-stage conversation (niche → look → voice → production pipeline → guardrails → scaffold), driving research + converged options at each stage, with the human holding final say. Use when the user wants to create/start/spin-up a NEW channel, "make a new channel", set up another niche, or run channel genesis. Reuses/adapts existing skills per a per-channel capability map, enforces the Enforcement Contract, and keeps a clean, resumable file tree. Do NOT use for per-video work on an EXISTING channel (use idea-generator / long-form-writer / etc.), or to build a new production pipeline (its own brainstorm→plan→build project).
---

# channel-forge — the conductor

You are the **thin conductor** of channel genesis. You do NOT do the creative work yourself — you
**sequence** the stages, **enforce** the Enforcement Contract, and **route** each stage to the right skill,
while the human holds final say. Read this fully, then follow it.

## Binding law (read first — Stage 0 requires it)
Read `references/enforcement-contract.md` NOW. It is binding. In particular you will enforce, as gates:
context-first (A), right-tool + self-application (B), right-size (C), validate-before-effort (D),
converge-then-present (E), clean-as-a-verb (F), and human final say (H).

## Stage 0 — establish context (MANDATORY, before any suggestion)
1. Read `CLAUDE.md` routing, the latest handoff, and `knowledge/decisions.md`.
2. Confirm which channel is being created and whether a genesis is already in progress:
   `py -3 .claude/skills/channel-forge/scripts/forge_state.py`-backed state at
   `channels/<name>/.forge-state.json` (if present, RESUME at its `current` stage; do not restart).
3. Never propose what already exists or was already decided.

## The walk
1. If no state file: copy `channels/_TEMPLATE/` to `channels/<name>/`, then
   `init_state(channel_dir, load_default_stages())`.
2. Loop while not `is_complete`:
   a. `stage = current_stage(channel_dir)`. Announce it (from `genesis-stages.md`).
   b. **Do the stage's work** — route to the resolved skill (Phase 3 adds the rich
      research→generate→self-critique→present loop; until then, gather the decision with the human and
      draft the artifact). NEVER fire an expensive/generative step until its upstream inputs are locked (D).
   c. **Converge internally, THEN present** to the human (E): options in an Artifact for look/voice, files
      opened in VS Code for text.
   d. **Human gate** — the human approves/edits (H). Only on approval:
      - promote the locked artifact to its named home,
      - `prune_workspace(channel_dir)` (F — sweep the stage's scratch),
      - `lock_stage(channel_dir, stage)` (advances the walk; enforces order).
   e. For the `capability-map` stage, the artifact is `channels/<name>/capability-map.json`; validate it
      with `validate_capability_map.py` before the human gate — a `build` slot routes into
      brainstorm→plan→build (B, self-application) for that capability.
3. When complete: run the learning-loop harvest (Phase 4; for now, note friction in `decisions.md`),
   and report the finished channel.

## Gates you enforce (structural — do not skip)
- **Context read** before Stage 0 completes.
- **Upstream validated** before any generative step (D).
- **Critic/converge pass ran** before presenting (E).
- **Workspace pruned** on every stage lock (F).
- **Human approval** recorded before every lock (H).

## What you are NOT
- Not a creative skill — you route to them.
- Not a builder of new production pipelines — that's a separate brainstorm→plan→build project.
- Not permitted to auto-lock taste — the human owns it.
````

- [ ] **Step 2: Sanity-check the frontmatter parses**

Run: `cd .claude/skills/channel-forge && py -3 -c "import re,sys; t=open('SKILL.md',encoding='utf-8').read(); m=re.match(r'^---\n(.*?)\n---\n', t, re.S); print('frontmatter OK' if m and 'name: channel-forge' in m.group(1) and 'description:' in m.group(1) else 'BAD'); sys.exit(0 if m else 1)"`
Expected: prints `frontmatter OK`.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/channel-forge/SKILL.md
git commit -m "feat(channel-forge): conductor SKILL.md (skeleton)

Stage-0 context gate + resumable stage walk + structural gates + human gates,
wiring the Phase-1 foundations. Rich per-stage option-gen deferred to Phase 3.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: End-to-end dogfood of the state machine

Prove the walk backbone end-to-end: a full walk over the real default stages, with prune integration and resumability, on a throwaway channel dir. (The SKILL.md prose is validated by review + first real run; this task locks the mechanical backbone.)

**Files:**
- Test: `.claude/skills/channel-forge/scripts/test_conductor_walk.py`

**Interfaces:**
- Consumes: `forge_state` (Task 2), `prune_workspace` (Phase 1).

- [ ] **Step 1: Write the end-to-end test**

Create `.claude/skills/channel-forge/scripts/test_conductor_walk.py`:

```python
from forge_state import (
    load_default_stages,
    init_state,
    current_stage,
    lock_stage,
    is_complete,
)
from prune_workspace import prune


def test_full_default_walk_with_prune(tmp_path):
    ch = tmp_path / "new-channel"
    ch.mkdir()
    stages = load_default_stages()
    assert stages[0] == "niche"
    init_state(str(ch), stages)

    for expected in stages:
        assert current_stage(str(ch)) == expected
        # each stage explores in .workspace/, which is pruned on lock
        ws = ch / ".workspace" / expected
        ws.mkdir(parents=True)
        (ws / "scratch.txt").write_text("draft", encoding="utf-8")
        removed = prune(str(ch))
        assert removed  # workspace was swept
        lock_stage(str(ch), expected)

    assert is_complete(str(ch))
    # the resumable state file survives (it is NOT under .workspace/)
    assert (ch / ".forge-state.json").exists()


def test_prune_never_kills_state_file(tmp_path):
    ch = tmp_path / "c"
    ch.mkdir()
    init_state(str(ch), ["niche", "voice"])
    lock_stage(str(ch), "niche")
    prune(str(ch))
    assert (ch / ".forge-state.json").exists()
    assert current_stage(str(ch)) == "voice"
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd .claude/skills/channel-forge/scripts && py -3 -m pytest test_conductor_walk.py -q`
Expected: PASS (2 passed). (Implementation already exists from Tasks 1–2 + Phase 1; this test may pass immediately — that is fine, it is an integration check.)

- [ ] **Step 3: Run the FULL channel-forge suite**

Run: `cd .claude/skills/channel-forge/scripts && py -3 -m pytest -q`
Expected: PASS (all channel-forge tests, 21 total).

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/channel-forge/scripts/test_conductor_walk.py
git commit -m "test(channel-forge): end-to-end conductor walk + prune/resume

Full default-stage walk with workspace prune and a surviving state file.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase 2 done-when
- Genesis stage sequence exists (JSON + doc), 11 stages, all human-gated.
- `forge_state.py` + tests pass; resumable, in-order, state survives prune.
- The conductor `SKILL.md` exists with valid frontmatter, wiring Stage 0 + the walk + the gates.
- The end-to-end walk test passes; the full channel-forge suite is green.

## Deferred to later phases
- **Phase 3:** the rich per-stage option-generation (research → generate → self-critique → present as an Artifact); real routing into each resolved skill.
- **Phase 4:** the learning loop; broader housekeeping (retire resolved handoffs); harness hooks for mechanical clauses; the production-pipeline registry; compliance (spec §5.3).
- **First real dogfood:** running the conductor to genesis an actual channel (a Phase-3+ milestone; the target channel is the human's call).
