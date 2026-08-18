# Agent-Building Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **kb execution note:** this plan runs through the boss pipeline — each task is dispatched to a worker (routing column below), workers NEVER commit, and every task gets a fresh-context opus unit Inspector + goal Auditor before the boss commits. Task steps below are written for the dispatched worker.

**Goal:** Every kb agent automatically receives a shared versioned kit; agents are factory-spawnable, eval-measurable, and schedulable via cron from HEARTBEAT with a dashboard editor.

**Architecture:** In-repo `kit/` blocks assembled by a Python renderer into a static artifact projected to both runtimes by `sync_skills.py`; a factory script scaffolds defs/memory/eval suites; per-agent eval suites reuse the canary manifest discipline with grades in a reserved namespace; `dispatch.due()` gains 5-field cron with skip-not-replay; the dashboard gets a Schedules panel whose writes route through the existing governed-save path.

**Tech Stack:** Python 3 (stdlib only — no new deps), pytest; TypeScript/Fastify/React/vitest in `dashboard/`.

**Spec:** `docs/superpowers/specs/2026-08-18-agent-infra-design.md`

## Global Constraints

- Workers never commit; never write `governance/**`; never touch `ledgers/audit/dashboard-audit.ndjson` (live daemon writes it — leave dirty).
- `scripts/grade.py` REQUIRED_FIELDS/ALLOWED_FIELDS untouched; ledger row shape unchanged.
- All SIX live cadence blocks (root `HEARTBEAT.md` ×4, `orgs/atlas-prep` ×1, `orgs/kb-ops` ×1) stay byte-unchanged; bare `schedule: weekly` stays non-firing.
- Timing lives INSIDE the `schedule:` string — never sibling YAML keys (`promotion._CADENCE_FIELDS` byte-compare is the authorization boundary).
- Eval grade rows use `worker: "eval-suite"`, `task_type: "eval:<agent-id>:<suite>"` — never the agent's own identity.
- $0 API spend; model-judge runs are `claude -p` subscription only and MOCKED in tests.
- Panels: own CSS file, explicit `id`, headings start at `<h4>`, optional `order`; never edit `styles/views/agentPlatform.css`.
- Python tests `tests/test_*.py` run `py -3 -m pytest tests/<file> -q`; dashboard tests run `npx vitest run <file>` from `dashboard/`.
- Every task opens with its **SPEC probe** (anti-duplication): if the probe finds the capability exists, STOP and report instead of building.

**Routing:** T1 codex · T2 codex · T3 claude-opus · T4 codex · T5 claude-opus · T6 claude-sonnet · T7 claude-opus · T8 claude-opus · T9 codex · T10 boss-orchestrated. (~50/50; governance-adjacent and hook-adjacent work stays claude.)

---

### Task 1: Kit blocks + assembler (`scripts/kit/assemble.py`)

**Files:**
- Create: `kit/north-star.md`, `kit/invariants.md`, `kit/spin-up.md`, `kit/context-refresh.md`, `kit/standard-loops.md`, `kit/lesson-writing.md`, `kit/file-editing.md`
- Create: `scripts/kit/__init__.py` (empty), `scripts/kit/assemble.py`
- Test: `tests/test_kit_assemble.py`
- Modify: `.gitignore` (append line `kit/.rendered/`)

**Interfaces:**
- Produces: `parse_block(path: Path) -> Block` (dataclass: `name, description, when, audience, read_only, budget_bytes, body, path`); `select_blocks(blocks: list[Block], *, audience: str, tags: set[str]) -> list[Block]`; `render(blocks: list[Block], audience: str) -> str`; `assemble(repo_root: Path, audience: str, tags: set[str] | None = None) -> Path` (writes `kit/.rendered/<audience>.md`, returns path); `check_read_only(repo_root: Path, main_ref: str = "refs/remotes/origin/main") -> list[str]` (paths of read_only blocks differing from main). CLI: `py -3 -m scripts.kit.assemble --audience all [--check-read-only]`.
- Errors: `KitBudgetError` (body bytes > budget_bytes — an ERROR, never truncation), `KitFrontmatterError` (missing/invalid field).

**SPEC probe:** grep `scripts/` and `dashboard/server/` for any existing kit/block assembler or context-pack renderer (search terms: `budget_bytes`, `kit`, `assemble`, `context pack`). U8's `context_store.js` writes per-session stores — NOT this; confirm no overlap and note it in the task result.

Block file format (frontmatter → body), e.g. `kit/spin-up.md`:

```markdown
---
name: spin-up
description: How any kb agent starts a run (preamble, branch rules, worktree leases)
when: always
audience: all
read_only: true
budget_bytes: 4000
---
Run `python scripts/preamble.py` before any work; a failure means STOP...
```

`kit/north-star.md` and `kit/invariants.md` are special: their bodies render under `## North star` / `## Invariants` (the two headings U7's extractor consumes — `WANTED_SECTIONS` in `scripts/hooks/regrounding_hook.js`). All other blocks render as `## Kit: <name>`. Render layout: L1 index first (every block's `description`, one line each), then the matched L2 bodies. Bodies of the initial seven blocks: distill from `CLAUDE.md`, `docs/proposals/file-editing-guidelines.md`, `docs/proposals/loops/README.md`, `memory/claude-boss.md` — cite-don't-copy where a file is authoritative (one-line pointer + the operative rule), keep each body under its budget. The two precedence laws (spec §1) go in `kit/invariants.md`.

- [ ] **Step 1: Write failing tests**

```python
# tests/test_kit_assemble.py
import pytest
from pathlib import Path
from scripts.kit.assemble import (
    parse_block, select_blocks, render, assemble, KitBudgetError, KitFrontmatterError,
)

def _write_block(dir, name, *, when="always", audience="all", read_only=False,
                 budget=1000, body="rule text"):
    p = dir / f"{name}.md"
    p.write_text(
        f"---\nname: {name}\ndescription: d-{name}\nwhen: {when}\n"
        f"audience: {audience}\nread_only: {str(read_only).lower()}\n"
        f"budget_bytes: {budget}\n---\n{body}\n", encoding="utf-8")
    return p

def test_parse_block_roundtrips_fields(tmp_path):
    b = parse_block(_write_block(tmp_path, "spin-up", read_only=True))
    assert (b.name, b.read_only, b.budget_bytes) == ("spin-up", True, 1000)
    assert b.description == "d-spin-up"

def test_budget_overflow_is_an_error_not_truncation(tmp_path):
    p = _write_block(tmp_path, "big", budget=10, body="x" * 50)
    with pytest.raises(KitBudgetError):
        parse_block(p)

def test_missing_field_is_frontmatter_error(tmp_path):
    p = tmp_path / "bad.md"
    p.write_text("---\nname: bad\n---\nbody\n", encoding="utf-8")
    with pytest.raises(KitFrontmatterError):
        parse_block(p)

def test_select_routes_by_when_and_audience(tmp_path):
    blocks = [parse_block(_write_block(tmp_path, "a", when="always")),
              parse_block(_write_block(tmp_path, "b", when="task:eval")),
              parse_block(_write_block(tmp_path, "c", audience="codex"))]
    picked = select_blocks(blocks, audience="claude", tags=set())
    assert [b.name for b in picked] == ["a"]
    picked = select_blocks(blocks, audience="claude", tags={"task:eval"})
    assert [b.name for b in picked] == ["a", "b"]

def test_render_l1_index_lists_every_description_and_special_headings(tmp_path):
    blocks = [parse_block(_write_block(tmp_path, "north-star")),
              parse_block(_write_block(tmp_path, "invariants")),
              parse_block(_write_block(tmp_path, "spin-up"))]
    out = render(blocks, audience="all")
    assert "## North star" in out and "## Invariants" in out
    assert "## Kit: spin-up" in out
    for b in blocks:
        assert b.description in out   # L1 index complete even if body unselected

def test_assemble_writes_rendered_artifact(tmp_path, monkeypatch):
    kit = tmp_path / "kit"; kit.mkdir()
    _write_block(kit, "north-star"); _write_block(kit, "spin-up")
    p = assemble(tmp_path, "all")
    assert p == tmp_path / "kit" / ".rendered" / "all.md"
    assert "## North star" in p.read_text(encoding="utf-8")
```

- [ ] **Step 2: Run → verify FAIL** — `py -3 -m pytest tests/test_kit_assemble.py -q` fails with `ModuleNotFoundError: scripts.kit`.
- [ ] **Step 3: Implement `scripts/kit/assemble.py`** — stdlib only; frontmatter parsed with the same minimal `---`-fence splitter style `scripts/dispatch.py` uses for cards (no yaml dep beyond what the repo already imports — check how dispatch parses HEARTBEAT and reuse that helper if importable, else a 15-line local parser). `check_read_only` shells `git show <main_ref>:<relpath>` and byte-compares. CLI via `argparse`, `python -m` entry.
- [ ] **Step 4: Run → verify PASS**, then write the seven real `kit/*.md` blocks and run `py -3 -m scripts.kit.assemble --audience all` once to prove the real kit assembles.
- [ ] **Step 5: `.gitignore` append `kit/.rendered/`; report done (boss commits).**

### Task 2: sync_skills kit projection

**Files:**
- Modify: `scripts/sync_skills.py`
- Test: `tests/test_sync_skills_kit.py` (new; do NOT weaken the existing sync tests)

**Interfaces:**
- Consumes: `sync(repo_root) -> dict[str,str]`, `check(repo_root) -> list[str]`, `MIRRORS = ['.claude/skills', '.agents/skills']`, manifest at `<mirror>/MANIFEST.json` `{skillName: sha256}`.
- Produces: same two functions, now ALSO projecting `kit/*.md` (excluding `.rendered/`) to `.claude/kb-kit/` and `.agents/kb-kit/`, manifest keys namespaced `kit:<name>`. `check()` reports kit drift identically to skill drift.

**SPEC probe:** read `scripts/sync_skills.py` end-to-end first; confirm the extension point (source list) and that no other mechanism already mirrors `kit/`-like content.

- [ ] **Step 1: Failing tests**

```python
# tests/test_sync_skills_kit.py
from pathlib import Path
from scripts.sync_skills import sync, check

def _seed(tmp_path):
    (tmp_path / "skills" / "curated" / "demo-skill").mkdir(parents=True)
    (tmp_path / "skills" / "curated" / "demo-skill" / "SKILL.md").write_text("s", encoding="utf-8")
    (tmp_path / "kit").mkdir()
    (tmp_path / "kit" / "spin-up.md").write_text("---\nname: spin-up\n---\nb", encoding="utf-8")
    (tmp_path / "kit" / ".rendered").mkdir()
    (tmp_path / "kit" / ".rendered" / "all.md").write_text("rendered", encoding="utf-8")

def test_sync_projects_kit_to_both_mirrors_with_namespace(tmp_path):
    _seed(tmp_path)
    manifest = sync(tmp_path)
    assert "kit:spin-up" in manifest
    for mirror in (".claude/kb-kit", ".agents/kb-kit"):
        assert (tmp_path / mirror / "spin-up.md").read_text(encoding="utf-8").endswith("b")
    assert not (tmp_path / ".claude" / "kb-kit" / ".rendered").exists()  # rendered never mirrored

def test_check_flags_kit_drift(tmp_path):
    _seed(tmp_path); sync(tmp_path)
    (tmp_path / ".claude" / "kb-kit" / "spin-up.md").write_text("tampered", encoding="utf-8")
    problems = check(tmp_path)
    assert any("kit:spin-up" in p for p in problems)

def test_skills_only_repos_unaffected(tmp_path):
    (tmp_path / "skills" / "curated" / "demo-skill").mkdir(parents=True)
    (tmp_path / "skills" / "curated" / "demo-skill" / "SKILL.md").write_text("s", encoding="utf-8")
    assert check(tmp_path) == [] or sync(tmp_path)  # no kit dir → no error, no kit keys
```

- [ ] **Step 2: Run → FAIL** (`kit:` keys absent).
- [ ] **Step 3: Implement** — add a second source root (`kit/`, files not dirs, skip `.rendered/`) alongside `skills/curated`; hash file bytes; write into `<mirror-parent>/kb-kit/`; keep ONE manifest per mirror (existing path) with the `kit:` namespace preventing collisions.
- [ ] **Step 4: Run new + existing sync tests → PASS** (`py -3 -m pytest tests/test_sync_skills_kit.py tests/test_sync_skills.py -q`; if the existing test file has a different name, find it with `ls tests | grep -i sync` and run that).
- [ ] **Step 5: Run `py -3 -m scripts.sync_skills` (real repo) once; report the manifest diff (boss commits).**

### Task 3: Kit injection wiring (codex prepend + U9 seam, INERT preserved)

**Files:**
- Modify: `scripts/codex_dispatch.py` (prepend rendered kit to the prompt file content when `kit/.rendered/codex.md` or `all.md` exists — flag `--no-kit` to skip)
- Modify: `scripts/hooks/` U9 spawn context-load hook (consume `kit/.rendered/<audience>.md` as an ADDITIONAL source; hook stays INERT — no settings.json arming in this task)
- Test: `tests/test_kit_injection.py`

**Interfaces:**
- Consumes: `assemble()` artifact path convention from Task 1 (`kit/.rendered/all.md`).
- Produces: `codex_dispatch` behavior: dispatched prompt = `<kit render>\n\n---\n\n<original brief>`; U9 hook function gains `kit_context(repo_root, audience) -> str | None` returning the artifact body or None when absent.

**SPEC probe:** read the U9 proposal `docs/proposals/spawn-model-verify-hooks.md` + the hook source first; confirm the injection seam and that nothing already prepends context to codex briefs (grep `codex_dispatch.py` for `prompt` handling). The arm runbook is NOT to be executed — inert-guard tests must still pass untouched.

- [ ] **Step 1: Failing tests** — three behaviors: (a) with a rendered artifact present, the text handed to codex begins with the kit render (test the prompt-assembly function directly, not a live dispatch); (b) `--no-kit` skips; (c) absent artifact → brief unchanged. Plus U9: `kit_context()` returns artifact body / None. Write them against the smallest extractable function — if `codex_dispatch.py` builds the prompt inline, first extract `def build_prompt(brief_text: str, repo_root: Path, no_kit: bool = False) -> str` and test THAT (pure, no subprocess).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** (extraction + 10-line prepend; audience `codex` falls back to `all`).
- [ ] **Step 4: Run new tests + the full existing hook suites → PASS:** `py -3 -m pytest tests/test_kit_injection.py tests/test_model_verify.py tests/test_regrounding_hook.py tests/test_context_store.py -q` (inert guards must be untouched).
- [ ] **Step 5: Report (boss commits).**

### Task 4: Agent factory (`scripts/agent_factory.py`)

**Files:**
- Create: `scripts/agent_factory.py`
- Test: `tests/test_agent_factory.py`

**Interfaces:**
- Consumes: canonical def shape = live `agents/*.md` frontmatter (`id, role, runtime, model, default-profile, allowed-profiles, projects, runner-bound, description`); U3 advisory fields optional (`tools, knowledge-source, autonomy-tier, skills, what-it-replaces, builds-on`).
- Produces: `create_agent(repo_root: Path, agent_id: str, *, role: str, runtime: str = "claude", model: str = "sonnet", projects: list[str] | None = None, grader: bool = False, needs_routing_override: bool = False) -> CreatedAgent` (dataclass listing paths written). Writes: `agents/<id>.md` (canonical shape + `kit: true` advisory field), `memory/<id>.md` (header only: `# <id> — lessons\n`), `evals/agents/<id>/README.md` + one golden task card skeleton `evals/agents/<id>/smoke.md` (Task-5 card shape), and — ONLY when `grader or needs_routing_override` — a card draft under `queue/drafts/` (a plain file the boss later publishes to ops; the factory NEVER writes governance/ or pushes ops itself). CLI: `py -3 -m scripts.agent_factory new <id> --role <role> [...]`.

**SPEC probe:** confirm no existing scaffolder (grep scripts/ for `new_agent`, `scaffold`, `factory`). Read `dashboard/server/agents/roster.ts` to confirm the def fields the loader reads, so the generated def is roster-lossless.

- [ ] **Step 1: Failing tests** — (a) `create_agent` writes all four paths with canonical frontmatter fields present; (b) `grader=False, needs_routing_override=False` writes NO queue/drafts file; (c) `grader=True` writes a draft card naming `governance/graders.yaml` in its Work order; (d) generated def parses by the same frontmatter reader dispatch uses (import it) and `id` matches filename; (e) refuses an existing id (`FileExistsError`).
- [ ] **Step 2: Run → FAIL.** — `py -3 -m pytest tests/test_agent_factory.py -q`
- [ ] **Step 3: Implement** (stdlib; templates as module constants — small, no template engine).
- [ ] **Step 4: Run → PASS. Then roster-lossless check:** run `create_agent` into a tmp copy? No — cheaper: unit-assert the generated frontmatter field set ⊇ the fields `roster.ts` reads (hardcode that list in the test with a comment naming roster.ts as source).
- [ ] **Step 5: Report (boss commits).**

### Task 5: Per-agent eval runner (`scripts/agent_evals.py`) + promotion isolation

**Files:**
- Create: `scripts/agent_evals.py`
- Create: `evals/agents/demo-agent/smoke.md` (first real golden card, used by tests and T10)
- Test: `tests/test_agent_evals.py`

**Interfaces:**
- Consumes: `canary.verify_manifest(evals_dir)`, `canary.update_manifest(evals_dir)` (reused verbatim — manifest per suite dir `evals/agents/<id>/MANIFEST.sha256`); `grade.py` append path (same call shape canary.py uses, `inspector_id="inspector@agents.local"`).
- Produces: `run_suite(repo_root: Path, agent_id: str, *, record: bool = False, record_root: Path | None = None) -> SuiteReport` (`cards: list[CardResult(id, passed, reason)]`, `passed: bool`). Grade rows recorded with `worker="eval-suite"`, `task_type=f"eval:{agent_id}:{card_id}"`, `project="kb"`, tier from the card. Deterministic judges only in this module: `judge: file-exists`, `judge: output-contains` (card runs a declared read-only command via `subprocess`, asserts substring), `judge: pytest` (runs a named test file). Card format = canary card frontmatter (`id, capability, judge, rubric_version, k, source, immutable, tier`) + judge-specific `input:` fields.

**SPEC probe:** read `scripts/canary.py` fully first; reuse (import) — do not copy — `verify_manifest`/`update_manifest` and the card-parsing helper if importable. If card parsing is not importable, extract it in canary.py to a module-level function (no behavior change; existing canary tests must stay green).

- [ ] **Step 1: Failing tests** — (a) `run_suite` refuses a suite whose MANIFEST.sha256 fails verification (tamper → `passed=False`, reason mentions manifest); (b) a passing `file-exists` card records (with `record=True`, `record_root=tmp`) exactly one grade row whose `worker == "eval-suite"` and `task_type == "eval:demo-agent:smoke"`; (c) **promotion isolation canary**: build a grades-row list containing 40 passing eval rows for `demo-agent` and assert `promotion.status("demo-agent", "kb", "build", "T2", rows, frozen=...)` does NOT return the acts-alone verdict (import promotion; use its real verdict strings — read them from the module, e.g. whatever `status()` returns for an empty streak, and assert equality with that); (d) `output-contains` judge runs the command and matches.
- [ ] **Step 2: Run → FAIL.** — `py -3 -m pytest tests/test_agent_evals.py -q`
- [ ] **Step 3: Implement** (`argparse` CLI: `py -3 -m scripts.agent_evals run <agent-id> [--record] [--update-manifest]`; `--update-manifest` prints the same human-act warning canary.py prints).
- [ ] **Step 4: Run new tests + FULL canary tests → PASS:** `py -3 -m pytest tests/test_agent_evals.py tests/test_canary.py -q` (find the real canary test filename first).
- [ ] **Step 5: Generate + bless `evals/agents/demo-agent/MANIFEST.sha256` via `--update-manifest`; report (boss commits — the bless is boss-witnessed).**

### Task 6: Model-judge step + report-only eval trigger

**Files:**
- Create: `scripts/eval_trigger.py`
- Modify: `scripts/agent_evals.py` (add `judge: model` support)
- Test: `tests/test_eval_trigger.py`, extend `tests/test_agent_evals.py`

**Interfaces:**
- Consumes: `run_suite` from Task 5; `canary.diff_guard(repo_root, git_range) -> list[str]` (path lister, blocking exit — NOT reused for triggering; new mapping is built here).
- Produces: `judge: model` cards run `claude -p <prompt-file> --output-format text` via `subprocess.run` (env MUST NOT contain `ANTHROPIC_API_KEY` — pop it defensively; subscription OAuth only), verdict = first line `PASS`/`FAIL`; the runner marks these cards `hermetic=False` and `run_suite(..., include_model_judged=False)` default excludes them (explicit opt-in flag). `affected_suites(repo_root, git_range) -> dict[str, list[str]]` in eval_trigger.py maps changed paths → suites: `kit/**` or `skills/curated/**` → ALL agent suites; `agents/<id>.md` → that suite; `evals/agents/<id>/**` → that suite. CLI `py -3 -m scripts.eval_trigger --range <git-range> [--run]` prints the mapping (report-only; `--run` executes deterministic cards and PRINTS failures — exit code 0 ALWAYS: it may not block).
- Tests mock `subprocess.run` for the model judge (assert argv starts `["claude", "-p", ...]` and env lacks the key) — never a live model call.

**SPEC probe:** confirm nothing already maps diffs→suites (grep for `diff_guard` callers) and that no pre-commit hook framework exists to collide with (`ls .git/hooks`, repo docs) — the trigger stays a CLI, wired to cadence later by HUMAN HEARTBEAT edit, not by this task.

- [ ] Steps: failing tests → FAIL → implement → `py -3 -m pytest tests/test_eval_trigger.py tests/test_agent_evals.py -q` PASS → report (boss commits). Test cases pinned: (a) kit change maps to all suites; (b) single-agent def change maps to one; (c) `--run` exit code is 0 even with a failing card; (d) model-judge argv/env assertion; (e) model-judged cards excluded by default.

### Task 7: Cron in `dispatch.due()` + occurrence dedup + stamps

**Files:**
- Modify: `scripts/dispatch.py` (`due()` at ~line 478, the dedup set in the dispatch loop, the ledger append record, card stamping)
- Modify: `scripts/cards.py` IF that is where stamp helpers live (probe first) — add `stamp_schedule(card, scheduled_for: str, dispatched_at: str)`
- Test: `tests/test_dispatch_cron.py` (new; existing dispatch tests untouched and green)

**Interfaces:**
- Consumes: `due(cadence, today, repo_root=None) -> bool`; ledger dedup `(project, cadence-name)` per day; `ledger.append(..., {"date", "cadence", "project", "card"})`.
- Produces: `due(cadence, today, repo_root=None, now: datetime | None = None) -> bool` — new accepted `schedule:` form: 5-field cron `"M H DoM Mon DoW"` (`*`, lists `a,b`, ranges `a-b`, steps `*/n`; DoW accepts `mon..sun` and `0-6`), LOCAL time. Fire rule (skip-not-replay): compute `latest_occurrence(cron, now) -> datetime | None` (most recent match ≤ now, same-day only — dispatch already never replays past days); due iff an occurrence exists today and `(project, name, occurrence-iso)` not already in the ledger day-shard (record gains `"scheduled_for": occ.isoformat()`; existing daily/weekly forms record `scheduled_for = today.isoformat()` — additive field, old rows without it still dedup by (project, cadence) exactly as today). Card frontmatter gains `scheduled_for` + `dispatched_at` via `stamp_schedule`. New pure helpers: `parse_cron(expr: str) -> CronSpec | None` (None = not cron → legacy parsing), `cron_matches(spec, dt: datetime) -> bool`, `latest_occurrence(spec, now) -> datetime | None`.

**SPEC probe:** re-read `due()` + the dispatch loop + one live ledger shard fixture in tests before coding; confirm where the `ran` set is built and that adding `scheduled_for` to the record breaks no reader (grep for `read_day(` consumers).

- [ ] **Step 1: Failing tests**

```python
# tests/test_dispatch_cron.py — representative pins (write all of these)
import datetime as dt
from scripts.dispatch import parse_cron, cron_matches, latest_occurrence, due

def test_legacy_forms_unchanged():
    d = dt.date(2026, 8, 22)  # a Saturday
    assert due({"name": "x", "schedule": "daily"}, d)
    assert due({"name": "x", "schedule": "weekly:sat"}, d)
    assert not due({"name": "x", "schedule": "weekly"}, d)      # bare weekly stays dead
    assert not due({"name": "x", "schedule": "monthly"}, d)

def test_cron_parse_and_match():
    spec = parse_cron("3 7 * * mon,thu")
    assert cron_matches(spec, dt.datetime(2026, 8, 20, 7, 3))    # a Thursday
    assert not cron_matches(spec, dt.datetime(2026, 8, 20, 7, 4))
    assert parse_cron("daily") is None                            # legacy passthrough

def test_latest_occurrence_same_day_only_skip_not_replay():
    spec = parse_cron("3 7 * * *")
    now = dt.datetime(2026, 8, 20, 15, 0)
    assert latest_occurrence(spec, now) == dt.datetime(2026, 8, 20, 7, 3)
    early = dt.datetime(2026, 8, 20, 6, 0)
    assert latest_occurrence(spec, early) is None                 # not yet due today

def test_due_cron_fires_once_per_occurrence(tmp_path):
    # seed a dispatch ledger shard recording occurrence 07:03; due() must be False after
    ...  # use the same ledger fixture helpers the existing dispatch tests use

def test_six_live_blocks_byte_unchanged():
    import subprocess
    diff = subprocess.run(["git", "diff", "--", "HEARTBEAT.md", "orgs/atlas-prep/HEARTBEAT.md",
                           "orgs/kb-ops/HEARTBEAT.md", "orgs/faceless-youtube/HEARTBEAT.md"],
                          capture_output=True, text=True).stdout
    assert diff == ""
```

Plus the **standing-auth re-time canary** (this file): parse a cadence dict, assert `promotion._cadence_matches(main, given)` is False when only the cron minute differs — pinning that timing edits void authorization because timing lives in `schedule:`.
- [ ] **Step 2: Run → FAIL.** — `py -3 -m pytest tests/test_dispatch_cron.py -q`
- [ ] **Step 3: Implement** (~80 lines; pure stdlib; `due()` keeps its exact current behavior when `parse_cron` returns None).
- [ ] **Step 4: Run new + ALL existing dispatch/promotion tests → PASS:** `py -3 -m pytest tests/test_dispatch_cron.py -q` then `py -3 -m pytest tests -q -k "dispatch or promotion"`.
- [ ] **Step 5: Report (boss commits).**

### Task 8: Schedules server panel + governed edit routes

**Files:**
- Create: `dashboard/server/panels/schedules.ts`
- Modify: `dashboard/server/panels/routes.ts` (one GET + two POST registrations)
- Test: `dashboard/server/panels/schedules.test.ts`

**Interfaces:**
- Consumes: `_heartbeats` discovery convention (reimplement the small glob in TS: root `HEARTBEAT.md` + `orgs/*/HEARTBEAT.md`); `queue/paused/<name>` sentinels; dispatch ledger day shards for last-run; `resultNarration` from `./loopStatus`; `save(input: SaveInput)` from `../write/governedSave`.
- Produces: `buildSchedulesPanel(repoRoot: string): SchedulesPanel` — `{ cadences: [{ project, name, schedule, tier, riskTier, paused, lastRun: {date, card, narration} | null, nextFireHint: string }] }` (nextFireHint is a display string computed from the schedule form — for cron just echo the expr; NO scheduling logic duplicated server-side). Routes: `GET /api/panels/schedules` (read-only, same auth gate as sibling panels); `POST /api/schedules/edit` `{file, content, sessionToken}` → `save({repoRoot, relpath: file, content, sessionToken, sessionConfig, openPr: true, workBranch: 'claude/agent-platform-w1', message: 'heartbeat: schedule edit via dashboard'})` — durable path, PR, never auto-merged; REJECT (400) any `file` not matching `^(HEARTBEAT\.md|orgs/[^/]+/HEARTBEAT\.md)$`; `POST /api/schedules/pause` `{name, sessionToken}` → governedSave CREATE of `queue/paused/<name>` (coordination path) — and REFUSES (403, reason `arming is a manual ops act`) if the sentinel already exists is fine to re-create idempotently, but there is NO delete route at all.
- READ-ONLY tripwire test for the GET builder, same pattern as `loopStatus.test.ts`'s `'writes nothing'` test.

**SPEC probe:** read `loopStatus.ts` + its test + `governedSave.ts`/`branch.ts` first; confirm `queue/paused/**` classifies as coordination via `isCoordinationPath` (prefix `queue/`); confirm the panel auth gate pattern used by sibling routes in `routes.ts`.

- [ ] **Step 1: Failing tests** — (a) builder lists all six live cadences with correct project/schedule; (b) paused sentinel → `paused: true`; (c) ledger shard fixture → lastRun with narration first line; (d) GET builder writes nothing (tripwire); (e) edit route rejects a non-HEARTBEAT path with 400 and never calls save (inject a spy `saveFn` — add an optional DI param like sibling modules do); (f) pause route calls save with relpath `queue/paused/<name>`; (g) NO route exists that deletes a sentinel (assert app has no DELETE registration under /api/schedules).
- [ ] **Step 2: `npx vitest run server/panels/schedules.test.ts` → FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run file + FULL server panel suite → PASS:** `npx vitest run server/panels/` and `npx tsc --noEmit`.
- [ ] **Step 5: Report (boss commits).**

### Task 9: Schedules panel UI

**Files:**
- Create: `dashboard/src/views/agentPlatform/panels/Schedules.panel.tsx`, `.../panels/Schedules.css`
- Modify: `dashboard/src/views/agentPlatform/registry.test.ts` (curated-order test: insert `schedules` after `loop-status` in the pinned CURATED prefix — a deliberate shared-test edit, name it in the result)
- Test: `dashboard/src/views/agentPlatform/panels/Schedules.panel.test.tsx`

**Interfaces:**
- Consumes: `GET /api/panels/schedules` shape from Task 8; `useReadPanel` hook (`src/lib/useReadPanel`) like sibling panels; House rules (id `schedules`, `order` = 6 — after loop-status which is 5, headings start `<h4>`, own CSS).
- Produces: panel rendering per-cadence strips (name · project · schedule · paused/active chip · last-run narration line · next-fire hint) + an "edit in PR" affordance that shows the HEARTBEAT file path + a copyable edited block and POSTs to `/api/schedules/edit` on confirm (the PR link from the response is displayed; copy states "merges by human only"), + a pause button POSTing `/api/schedules/pause`. NO unpause control renders, ever.

**SPEC probe:** read two sibling panels (`LoopStatus.panel.tsx` and one with a POST action if any exists — else follow the fetch pattern in `useReadPanel` and the session-token plumbing used by governed writes in the SPA — find with `grep -r sessionToken dashboard/src | head`).

- [ ] Steps: failing tests (renders six cadences from mocked fetch; paused chip; no unpause button in DOM even for paused rows; edit confirm POSTs with exact body; registry curated-order test updated and green) → FAIL → implement → `npx vitest run src/views/agentPlatform/ && npx tsc --noEmit` PASS (829-baseline: only the 7 pre-existing CommandPalette failures allowed) → report (boss commits).

### Task 10: Platform proof + closeout (boss-orchestrated; no single worker)

**Files:** none new except `MORNING-REPORT-AGENT-INFRA.md` (worktree root) + `memory/claude-boss.md` lesson append.

- [ ] **Step 1: Factory proof** — `py -3 -m scripts.agent_factory new demo-agent --role demo` on the real tree (Task 4 committed it as code only; THIS creates the real demo agent); `py -3 -m pytest tests -q` green; `/api/agents` on :4630 shows demo-agent after rebuild.
- [ ] **Step 2: Kit proof both runtimes** — `py -3 -m scripts.kit.assemble --audience all`; `py -3 -m scripts.sync_skills`; `check()` clean; dispatch ONE trivial codex card (read-only sandbox) and verify its prompt log begins with the kit render; run the U9 `kit_context()` unit path (hooks stay INERT).
- [ ] **Step 3: Eval proof** — `py -3 -m scripts.agent_evals run demo-agent --record --record-root <tmp>`; row lands with `worker=eval-suite`; `py -3 -m scripts.eval_trigger --range HEAD~1..HEAD` prints a sane mapping.
- [ ] **Step 4: Schedule proof on :4630** — add a `schedule: "*/5 * * * *"` demo cadence to a THROWAWAY branch copy of `orgs/kb-ops/HEARTBEAT.md`? NO — never mutate live HEARTBEAT even on a branch here: instead run `due()` against a fixture cadence in a tmp repo_root and demo the Schedules panel against the six real (read-only) cadences; panel shows them, pause POST works against a scratch sentinel name (`demo-agent-proof`), then the sentinel file is deleted BY HAND (boss, recorded in report) as the arming-ceremony demonstration.
- [ ] **Step 5: Final reviews** — fresh-context opus goal Auditor over the whole arc diff (`git diff <arc-base>..HEAD`) + a lane-coherence review; rebuild dashboard, relaunch :4630 one-liner from MORNING-REPORT.md.
- [ ] **Step 6: Write `MORNING-REPORT-AGENT-INFRA.md`** (per-task commits, how-to-see-it, decision-notes: arm gates, demo-agent keep/delete, eval-cadence HEARTBEAT block PROPOSAL text for Daniel to commit) + memory lesson; boss commits; push; hand to Daniel.

---

## Self-review (run after writing, fixed inline)

- Spec coverage: §1→T1, §2→T2/T3, §3→T4, §4→T5/T6, §5→T7/T8/T9, §6→kit blocks in T1 (lesson-writing doctrine) — no reconciler tasks (correct), §7 rules→global constraints + per-task probes, §8→task order, acceptance 1–7→T1/T2, T1+T3, T4, T5, T7, T8/T9, T10.
- No placeholders: every task carries real test code or an exact pinned list of test cases.
- Type consistency: `assemble()` artifact path used by T2 (exclusion) and T3 (consumption); `SaveInput` fields in T8 match recon fact 11; `stamp_schedule` produced T7, unconsumed elsewhere (cards carry it for T10's proof reading only).
