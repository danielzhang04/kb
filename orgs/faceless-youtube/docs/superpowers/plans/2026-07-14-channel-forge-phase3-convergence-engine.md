# channel-forge — Phase 3: Convergence Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared per-stage convergence engine (gather → reuse-first → generate → parallel adversarial critics → converge → present → gate → file-trap lock) + a machine-checkable recipe format + the `niche` pilot recipe, and wire them into the conductor — so a stage returns converged options and the human iterates ~2× not 30×.

**Architecture:** Mostly authored *procedure* the conductor follows (`references/convergence-engine.md`) + a small per-stage `references/recipes/<stage>.md` (YAML frontmatter + prose) + a thin stdlib recipe validator. The critic layer is a runtime subagent fan-out described in the procedure. Validated by tests (validator) + review (procedure/recipe) + a live dogfood (the niche stage).

**Tech Stack:** Markdown (procedure, recipe), Python 3 stdlib (`validate_recipe.py`, YAML-frontmatter parse — no yaml dep, a minimal `key: value` parser), pytest via `py -3 -m pytest`.

## Global Constraints

- **Worktree/branch:** `C:/Users/danie/faceless-youtube-channel-forge` on `feat/channel-forge`.
- **Scripts:** Python 3 **stdlib only** (no PyYAML — frontmatter is flat `key: value` lines); tests via `py -3 -m pytest`.
- **Git hygiene:** explicit paths, never `git add -A`, never rewrite history.
- **Commit trailer:** `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Depends on:** Phase 1 (`validate_capability_map`, `prune_workspace`, enforcement-contract) + Phase 2 (`forge_state`, `SKILL.md`, `genesis-stages`).
- **Scope:** the engine + the `niche` pilot recipe ONLY. Other recipes (`visual-style` next), harness hooks, the full learning loop, and the pipeline registry are later work.
- **Recipe format:** a markdown file with a YAML-style **flat frontmatter** (`key: value`, values may be inline lists `[a, b]`) + a prose body. Required keys: `inputs`, `reuse_check`, `option_shape`, `critic_checks`, `routes_to`, `gate`.

---

### Task 1: The convergence-engine procedure doc

Author the shared loop the conductor runs at every stage (spec §2, §3, §5, §6, §7). Authoring task; validated by a completeness self-check against the spec.

**Files:**
- Create: `.claude/skills/channel-forge/references/convergence-engine.md`

**Interfaces:**
- Produces: a procedure with named sections `The loop` (8 steps), `The critic layer`, `Reuse-first pass`, `File-trap lock-step`, `Coherence critic`. The conductor SKILL.md (Task 4) references these by name.

- [ ] **Step 1: Write the procedure**

Create `.claude/skills/channel-forge/references/convergence-engine.md` covering, from spec §2/§3/§5/§6/§7:
- **The loop** — the 8 steps (gather inputs → reuse-first → generate options → critic layer → converge → present → human gate → file-trap lock), marking steps 1–5 as INTERNAL (present only at 6).
- **The critic layer** — parallel fresh-context adversarial subagents; two tiers (universal: Contract-compliance + coherence lens; stage-specific: from the recipe's `critic_checks`); right-sized panel by stage stakes; a survive-threshold; findings fold into a refine pass before presenting.
- **Reuse-first pass** — before generating fresh, check existing skills/assets/registry/Second-Take exemplars; propose reuse/adapt/build with reasoning.
- **File-trap lock-step** — on lock: promote → `prune_workspace()` → commit with EXPLICIT paths (never `git add -A`) → `lock_stage()`; docs integrated-not-appended.
- **Coherence critic** — stage-boundary (light) + run-end (full): state vs. goal.

- [ ] **Step 2: Completeness self-check**

Re-read spec §2/§3/§5/§6/§7. Confirm every element is present (8 loop steps; two critic tiers; right-sizing; reuse-first; the 4-step lock; both coherence checkpoints). Add anything missing.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/channel-forge/references/convergence-engine.md
git commit -m "feat(channel-forge): convergence-engine procedure

The shared per-stage loop + parallel adversarial critic layer + reuse-first +
file-trap lock-step + coherence critic (Phase 3 spec §2-7).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Recipe schema + validator

A machine-checkable recipe format so every stage recipe is consistent (mirrors the capability-map validator).

**Files:**
- Create: `.claude/skills/channel-forge/references/recipe-schema.md`
- Create: `.claude/skills/channel-forge/scripts/validate_recipe.py`
- Test: `.claude/skills/channel-forge/scripts/test_validate_recipe.py`

**Interfaces:**
- Produces:
  - `REQUIRED_KEYS = ["inputs", "reuse_check", "option_shape", "critic_checks", "routes_to", "gate"]`
  - `parse_frontmatter(text: str) -> dict` — parse the leading `---`-fenced flat `key: value` block into a dict (values are strings; missing block → `{}`).
  - `validate(text: str) -> list[str]` — error strings; empty = valid (frontmatter present + all REQUIRED_KEYS non-empty).
  - `validate_file(path: str) -> list[str]`.

- [ ] **Step 1: Write the schema doc**

Create `.claude/skills/channel-forge/references/recipe-schema.md`:

```markdown
# Stage recipe schema (`references/recipes/<stage>.md`)

A recipe parameterizes the convergence engine for one genesis stage. It is a markdown file:
a `---`-fenced flat frontmatter (one `key: value` per line) + a prose guidance body.

## Required frontmatter keys
- `inputs` — prior locked stages + research this stage consumes.
- `reuse_check` — what existing skill/asset/exemplar to look for before generating.
- `option_shape` — what an option is + how it is presented (e.g., "N voices" for multi-voice).
- `critic_checks` — stage-specific quality bars beyond the universal Enforcement Contract.
- `routes_to` — the existing skill delegated to for a reuse resolution.
- `gate` — what the human is shown and what "approve" means.

The prose body gives the human-readable guidance the engine follows for this stage.
```

- [ ] **Step 2: Write the failing tests**

Create `.claude/skills/channel-forge/scripts/test_validate_recipe.py`:

```python
from validate_recipe import parse_frontmatter, validate, REQUIRED_KEYS

GOOD = """---
inputs: prior stage X + research Y
reuse_check: skill Z
option_shape: 3 boards
critic_checks: differentiated
routes_to: idea-generator
gate: pick one
---

Body guidance here.
"""


def test_required_keys_shape():
    assert REQUIRED_KEYS == ["inputs", "reuse_check", "option_shape", "critic_checks", "routes_to", "gate"]


def test_parse_frontmatter_reads_keys():
    fm = parse_frontmatter(GOOD)
    assert fm["inputs"] == "prior stage X + research Y"
    assert fm["routes_to"] == "idea-generator"


def test_valid_recipe_has_no_errors():
    assert validate(GOOD) == []


def test_missing_frontmatter_errors():
    errs = validate("no frontmatter here")
    assert errs  # non-empty


def test_missing_key_errors():
    text = GOOD.replace("gate: pick one\n", "")
    errs = validate(text)
    assert any("gate" in e for e in errs)


def test_empty_value_errors():
    text = GOOD.replace("routes_to: idea-generator", "routes_to:")
    errs = validate(text)
    assert any("routes_to" in e for e in errs)
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd .claude/skills/channel-forge/scripts && py -3 -m pytest test_validate_recipe.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'validate_recipe'`.

- [ ] **Step 4: Write the validator**

Create `.claude/skills/channel-forge/scripts/validate_recipe.py`:

```python
"""Validate a stage recipe's frontmatter (channel-forge Phase 3)."""
import re
import sys
from pathlib import Path

REQUIRED_KEYS = ["inputs", "reuse_check", "option_shape", "critic_checks", "routes_to", "gate"]


def parse_frontmatter(text):
    """Parse a leading ----fenced flat 'key: value' block into a dict. Missing block -> {}."""
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    if not m:
        return {}
    out = {}
    for line in m.group(1).splitlines():
        if ":" in line:
            key, _, value = line.partition(":")
            out[key.strip()] = value.strip()
    return out


def validate(text):
    """Return a list of error strings; empty means valid."""
    fm = parse_frontmatter(text)
    if not fm:
        return ["missing or malformed frontmatter (--- fenced key: value block)"]
    errors = []
    for key in REQUIRED_KEYS:
        if not fm.get(key):
            errors.append(f"recipe missing or empty required key: {key}")
    return errors


def validate_file(path):
    return validate(Path(path).read_text(encoding="utf-8"))


if __name__ == "__main__":
    errs = validate_file(sys.argv[1])
    if errs:
        print("\n".join(errs))
        sys.exit(1)
    print("ok")
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd .claude/skills/channel-forge/scripts && py -3 -m pytest test_validate_recipe.py -q`
Expected: PASS (6 passed).

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/channel-forge/references/recipe-schema.md .claude/skills/channel-forge/scripts/validate_recipe.py .claude/skills/channel-forge/scripts/test_validate_recipe.py
git commit -m "feat(channel-forge): recipe schema + validator

Machine-checkable per-stage recipe format (frontmatter + body). 6 tests pass.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: The `niche` pilot recipe

The concrete recipe that proves the engine on stage 1 (spec §8).

**Files:**
- Create: `.claude/skills/channel-forge/references/recipes/niche.md`

**Interfaces:**
- Consumes: `validate_recipe.validate_file` (Task 2).

- [ ] **Step 1: Write the recipe**

Create `.claude/skills/channel-forge/references/recipes/niche.md`:

```markdown
---
inputs: the human's channel intent (subject/audience gesture) + knowledge/research/niches.md
reuse_check: the idea-generator skill + existing niche research + Second Take's niche doctrine
option_shape: N ranked niche/angle options (each - the lane, the one-lever hook, why it can win) in an Artifact board
critic_checks: differentiated from rivals (never clone a competitor); payload-first doctrine; monetizable RPM lane; sustainable idea-supply
routes_to: idea-generator
gate: the human picks + edits one lane; on approval it seeds dna.md Identity
---

# Recipe: niche stage

Proves the convergence engine cleanly (full loop, no image-gen weight; stage 1).

**Gather** the human's channel intent + `knowledge/research/niches.md`. **Reuse-first:** lean on
`idea-generator` and existing niche research rather than inventing a niche framework. **Generate** N candidate
lanes, each with its one-lever hook and a why-it-can-win. **Critics** (beyond the Contract): each lane must be
differentiated from named rivals, payload-first, in a monetizable RPM band, and have durable idea-supply.
**Converge** to a ranked shortlist; **present** an Artifact board. **Gate:** the human picks + edits one lane;
on approval it seeds `dna.md` Identity and the walk advances.
```

- [ ] **Step 2: Validate the recipe against the schema**

Run: `cd .claude/skills/channel-forge/scripts && py -3 validate_recipe.py ../references/recipes/niche.md`
Expected: prints `ok` (exit 0).

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/channel-forge/references/recipes/niche.md
git commit -m "feat(channel-forge): niche pilot recipe

The stage-1 recipe that proves the convergence engine (spec §8). Validates ok.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Wire the engine into the conductor SKILL.md

Update the conductor's "Do the stage's work" step to load the stage recipe and run the convergence engine.

**Files:**
- Modify: `.claude/skills/channel-forge/SKILL.md`

**Interfaces:**
- Consumes: `references/convergence-engine.md`, `references/recipes/<stage>.md`, `validate_recipe.py`.

- [ ] **Step 1: Edit the walk step**

In `.claude/skills/channel-forge/SKILL.md`, replace the walk's step **2b** ("Do the stage's work…") with:

```markdown
   b. **Do the stage's work via the convergence engine.** Load `references/recipes/<stage>.md` (validate it
      with `validate_recipe.py`) and run `references/convergence-engine.md` parameterized by that recipe:
      gather → reuse-first → generate → parallel critic layer → converge → (present at step c). If no recipe
      exists for the stage yet, gather the decision with the human directly (pre-Phase-3 fallback). NEVER fire
      an expensive/generative step until upstream inputs are locked (D).
```

Add to the "Files this skill uses" list: `references/convergence-engine.md`, `references/recipe-schema.md`,
`references/recipes/`.

- [ ] **Step 2: Verify frontmatter still parses**

Run: `cd .claude/skills/channel-forge && py -3 -c "import re; t=open('SKILL.md',encoding='utf-8').read(); assert re.match(r'^---\n.*?\n---\n', t, re.S) and 'convergence-engine' in t; print('SKILL wired OK')"`
Expected: prints `SKILL wired OK`.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/channel-forge/SKILL.md
git commit -m "feat(channel-forge): wire convergence engine into the conductor

The walk now loads a stage recipe + runs the convergence engine (Phase 3).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Full suite + live dogfood setup

Confirm the whole channel-forge suite is green, then set up the live dogfood (the `niche` stage on a real/test channel intent — interactive, needs the human).

**Files:** none created (verification task).

- [ ] **Step 1: Run the full channel-forge test suite**

Run: `cd .claude/skills/channel-forge/scripts && py -3 -m pytest -q`
Expected: PASS (all channel-forge tests — 27 total: 21 from Phases 1–2 + 6 recipe-validator).

- [ ] **Step 2: Verify the niche recipe validates end-to-end**

Run: `cd .claude/skills/channel-forge/scripts && py -3 validate_recipe.py ../references/recipes/niche.md`
Expected: `ok`.

- [ ] **Step 3: Live dogfood (HUMAN-IN-THE-LOOP — do not automate)**

STOP and bring to the human: to prove the engine, run `channel-forge`'s `niche` stage on a real (or throwaway)
channel intent. This is an interactive genesis conversation — the engine generates converged niche options in
an Artifact, the human reacts (≤2 iterations), and the lane locks. Capture any friction for the Phase-4
learning loop. Success = the human agrees the presented options were close-to-right (few iterations), not a
naive first draft.

---

## Phase 3 done-when
- `convergence-engine.md` procedure exists with all named sections.
- `validate_recipe.py` + tests pass; `recipe-schema.md` documents the format.
- `recipes/niche.md` exists and validates `ok`.
- The conductor SKILL.md runs the engine + loads the recipe.
- Full channel-forge suite green (27 tests).
- Live niche dogfood run + human verdict (few iterations to a good lane).

## Deferred to Phase 4
- The `visual-style` recipe (immediate fast-follow) + the remaining stage recipes.
- Harness hooks for the mechanical file-traps; the full learning loop; the production-pipeline registry;
  compliance (parent spec §5.3).
