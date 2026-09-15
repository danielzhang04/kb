"""Tests for the P4e figment role declarations and the figment-creator workflow graph.

Covers Step 3.1 (the nine ``agents/figment-*.md`` declarations) and Step 3.2 (the
``orgs/figment/workflows/figment-creator.md`` stage DAG). Declarative only: nothing
here dispatches a card, spends, or touches a live account.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest
import yaml

import cards  # scripts/cards.py, on sys.path via the repo-root conftest.py

REPO_ROOT = Path(__file__).resolve().parents[4]
AGENTS = REPO_ROOT / "agents"
WORKFLOW = REPO_ROOT / "orgs" / "figment" / "workflows" / "figment-creator.md"

FRONTMATTER_RE = re.compile(r"\A---\r?\n(.*?)\r?\n---\r?\n", re.S)

# (role, model, default-profile, allowed-profiles) per agent id suffix, matching
# docs/superpowers/specs/2026-09-03-figment-creator-001-design.md §6's declaration
# matrix and docs/superpowers/plans/2026-09-03-figment-creator-001-p1.md Step 3.1.
EXPECTED = {
    "runner": ("manage", "claude-opus-5", "manager:claude:claude-opus-5",
               ("manager:claude:claude-opus-5", "manager:claude:claude-fable-5")),
    "checker": ("inspect", "claude-opus-5", "worker:claude:claude-opus-5",
                ("worker:claude:claude-opus-5", "worker:claude:claude-fable-5")),
    "expand": ("work", "claude-sonnet-5", "worker:claude:claude-sonnet-5",
               ("worker:claude:claude-sonnet-5", "worker:claude:claude-opus-5")),
    "train": ("work", "claude-sonnet-5", "worker:claude:claude-sonnet-5",
              ("worker:claude:claude-sonnet-5", "worker:claude:claude-opus-5")),
    "render": ("work", "claude-sonnet-5", "worker:claude:claude-sonnet-5",
               ("worker:claude:claude-sonnet-5", "worker:claude:claude-opus-5")),
    "content": ("work", "claude-sonnet-5", "worker:claude:claude-sonnet-5",
                ("worker:claude:claude-sonnet-5", "worker:claude:claude-opus-5")),
    "poster": ("work", "claude-opus-5", "worker:claude:claude-opus-5",
               ("worker:claude:claude-opus-5",)),
    "analyst": ("work", "claude-sonnet-5", "worker:claude:claude-sonnet-5",
                ("worker:claude:claude-sonnet-5", "worker:claude:claude-opus-5")),
    "researcher": ("work", "claude-sonnet-5", "worker:claude:claude-sonnet-5",
                   ("worker:claude:claude-sonnet-5", "worker:claude:claude-haiku-4-5")),
}

ROLE_ENUM = {"scout", "manage", "work", "inspect", "consolidate"}
RUNTIME_ENUM = {"claude", "codex"}

# The real figment_train.py CLI's own STAGES tuple (figment_train.py:85) -- the
# workflow's node ids are named after these directly except `smoke-and-train`, which
# is one node covering both (its workOrder literally runs `--stage smoke` then
# `--stage train`; neither is gradeable, so splitting it would add a checker node with
# nothing to check). Superseded the old design-phase ("S2".."S9") vocabulary once the
# consistency pass (p4h) put every node's id/phase on the CLI's own stage names.
CLI_STAGES = ("anchor", "dataset", "smoke", "train", "tester", "gen", "detail", "video")
STAGE_NODE_COVERAGE = {"smoke-and-train": ("smoke", "train")}


# --------------------------------------------------------------------------- #
# Shared parsing helpers
# --------------------------------------------------------------------------- #

def load_frontmatter(path: Path) -> tuple[dict, str]:
    text = path.read_text(encoding="utf-8")
    match = FRONTMATTER_RE.match(text)
    assert match, f"{path}: no terminated frontmatter block"
    fm = yaml.safe_load(match.group(1))
    assert isinstance(fm, dict), f"{path}: frontmatter is not a mapping"
    return fm, text[match.end():]


def load_workflow(path: Path) -> dict:
    fm, _ = load_frontmatter(path)
    return fm


def assert_decl(path: Path, expected: tuple) -> tuple[dict, str]:
    role, model, default_profile, allowed_profiles = expected
    fm, body = load_frontmatter(path)
    assert fm.get("id") == path.stem, f"{path}: id must equal the filename stem"
    assert fm.get("role") == role, f"{path}: role"
    assert fm.get("runtime") == "claude", f"{path}: runtime"
    assert fm.get("model") == model, f"{path}: model"
    assert fm.get("default-profile") == default_profile, f"{path}: default-profile"
    assert tuple(fm.get("allowed-profiles") or []) == allowed_profiles, f"{path}: allowed-profiles"
    assert fm.get("projects") == ["figment"], f"{path}: projects"
    assert fm.get("runner-bound") is True, f"{path}: runner-bound"
    assert fm.get("description"), f"{path}: description"
    assert fm.get("role") in ROLE_ENUM
    assert fm.get("runtime") in RUNTIME_ENUM
    return fm, body


# --------------------------------------------------------------------------- #
# Step 3.1 — declaration matrix
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize("agent_id,expected", sorted(EXPECTED.items()))
def test_agent_declaration_matrix(agent_id: str, expected: tuple) -> None:
    assert_decl(AGENTS / f"figment-{agent_id}.md", expected)


def test_checker_is_read_only() -> None:
    _, body = load_frontmatter(AGENTS / "figment-checker.md")
    assert "read-only" in body.lower()
    assert "never authors" in body.lower()


def test_runner_like_roles_are_runner_bound() -> None:
    for agent_id in EXPECTED:
        fm, _ = load_frontmatter(AGENTS / f"figment-{agent_id}.md")
        assert fm.get("runner-bound") is True, agent_id


def test_allowed_profiles_never_exceed_default_authority() -> None:
    for agent_id in EXPECTED:
        fm, _ = load_frontmatter(AGENTS / f"figment-{agent_id}.md")
        default_authority = fm["default-profile"].split(":", 1)[0]
        for profile in fm["allowed-profiles"]:
            assert profile.split(":", 1)[0] == default_authority, (
                f"figment-{agent_id}: allowed profile {profile!r} exceeds the "
                f"default profile's {default_authority!r} authority"
            )


def test_every_declaration_has_a_self_approval_non_goal() -> None:
    for agent_id in EXPECTED:
        _, body = load_frontmatter(AGENTS / f"figment-{agent_id}.md")
        assert "self-approv" in body.lower(), f"figment-{agent_id}: missing a self-approval non-goal"


def test_no_declaration_self_authorizes() -> None:
    # None of the nine declarations may claim spend, publication, account-change, or
    # explicit-work authority for itself in its own frontmatter description.
    for agent_id in EXPECTED:
        fm, _ = load_frontmatter(AGENTS / f"figment-{agent_id}.md")
        description = fm["description"].lower()
        assert "self-authoriz" not in description


# --------------------------------------------------------------------------- #
# Step 3.2 — workflow stage DAG
# --------------------------------------------------------------------------- #

def topological_sort(stages: list[dict]) -> list[str]:
    """Kahn's algorithm, tie-broken by declared order, over ``dependsOn`` edges."""
    index = {stage["id"]: i for i, stage in enumerate(stages)}
    assert len(index) == len(stages), "duplicate stage id"
    deps = {stage["id"]: list(stage.get("dependsOn") or []) for stage in stages}
    for stage_id, dep_ids in deps.items():
        for dep_id in dep_ids:
            assert dep_id in index, f"{stage_id} depends on unknown stage {dep_id!r}"
            assert index[dep_id] < index[stage_id], (
                f"{stage_id} depends on {dep_id!r}, which is declared later — not a valid DAG order"
            )

    indegree = {stage_id: len(dep_ids) for stage_id, dep_ids in deps.items()}
    children: dict[str, list[str]] = {stage_id: [] for stage_id in deps}
    for stage_id, dep_ids in deps.items():
        for dep_id in dep_ids:
            children[dep_id].append(stage_id)

    ready = sorted((sid for sid, deg in indegree.items() if deg == 0), key=lambda sid: index[sid])
    order: list[str] = []
    while ready:
        ready.sort(key=lambda sid: index[sid])
        current = ready.pop(0)
        order.append(current)
        for child in children[current]:
            indegree[child] -= 1
            if indegree[child] == 0:
                ready.append(child)

    assert len(order) == len(stages), "cycle or unresolved dependency in the stage graph"
    return order


def is_run_stage(stage: dict) -> bool:
    return stage.get("action") == "pipeline:run-stage"


def covered_cli_stages(stages: list[dict]) -> set[str]:
    """Every CLI_STAGES entry a `pipeline:run-stage` node actually covers, keyed by
    node id (`STAGE_NODE_COVERAGE` for the one node -- `smoke-and-train` -- covering
    two), not by prose: `detail` and `video` are always run automatically through
    `pipeline` (README: "gen is NEVER included in `--stage all`", extended to detail
    and video too) and so never say `run --stage detail`/`run --stage video` in their
    own workOrder text the way anchor/dataset/smoke/train/tester/gen do."""
    covered: set[str] = set()
    for stage in stages:
        if is_run_stage(stage):
            covered.update(STAGE_NODE_COVERAGE.get(stage["id"], (stage["id"],)))
    return covered


def named_run_stages(stage: dict) -> set[str]:
    """Every stage name this node's own workOrder names as `run --stage <name>` --
    the literal, spending subcommand (`grade --stage <name>` is free and never
    counted)."""
    return set(re.findall(r"run --stage (\w+)", stage.get("workOrder") or ""))


def is_checker_stage(stage: dict) -> bool:
    return stage.get("agentId") == "figment-checker"


def mutating_stages(workflow: dict) -> list[dict]:
    return [
        stage for stage in workflow["stages"]
        if not is_checker_stage(stage) and stage.get("mutating", True)
    ]


def has_review_or_gate(stage: dict, workflow: dict) -> bool:
    if stage.get("humanGates"):
        return True
    dependents = [s for s in workflow["stages"] if stage["id"] in (s.get("dependsOn") or [])]
    return any(is_checker_stage(dep) or dep.get("humanGates") for dep in dependents)


def materialize_test_card(stage: dict, workflow: dict) -> cards.Card:
    """A stage's fields must materialize into a schema-valid card (cards.new_card
    raises cards.ValidationError on anything that would not)."""
    return cards.new_card(
        workflow["project"], stage["action"], stage["target"], stage["riskTier"],
        body=stage["workOrder"], owner=stage["agentId"],
    )


def test_workflow_required_top_level_keys() -> None:
    workflow = load_workflow(WORKFLOW)
    for key in ("id", "project", "title", "profile", "governedBy", "manager", "parameters", "stages"):
        assert key in workflow, f"workflow missing required key {key!r}"
    assert workflow["project"] == "figment"
    assert workflow["manager"]["agentId"] == "figment-runner"


def test_workflow_stage_ids_unique_and_cover_the_eight_cli_stages() -> None:
    workflow = load_workflow(WORKFLOW)
    ids = [s["id"] for s in workflow["stages"]]
    assert len(ids) == len(set(ids)), "duplicate stage id"
    assert covered_cli_stages(workflow["stages"]) == set(CLI_STAGES)
    # Every node whose OWN workOrder names a real `run --stage <name>` really is a
    # spending (pipeline:run-stage) node -- never disguised as a grade-only or
    # downstream business-logic step (content-plan, analyst-insights).
    for stage in workflow["stages"]:
        named = named_run_stages(stage)
        if named:
            assert is_run_stage(stage), (
                f"{stage['id']!r} names run --stage {sorted(named)} in its workOrder "
                f"but is action {stage.get('action')!r}, not pipeline:run-stage"
            )


def test_workflow_stages_are_declared_in_topological_order() -> None:
    workflow = load_workflow(WORKFLOW)
    ids = [s["id"] for s in workflow["stages"]]
    assert topological_sort(workflow["stages"]) == ids


def test_every_mutating_stage_has_a_review_or_gate() -> None:
    workflow = load_workflow(WORKFLOW)
    offenders = [
        s["id"] for s in mutating_stages(workflow)
        if not has_review_or_gate(s, workflow)
    ]
    assert offenders == [], f"stages with no downstream review or human gate: {offenders}"


def test_no_stage_encodes_approval_as_a_successful_worker_exit() -> None:
    # Every human gate is its own object (kind: approval) distinct from stage
    # completion; a stage never claims its own DONE state satisfies a gate.
    workflow = load_workflow(WORKFLOW)
    for stage in workflow["stages"]:
        for gate in stage.get("humanGates") or []:
            assert gate.get("kind") == "approval"
            assert gate.get("id")
            assert gate.get("prompt")


def test_every_stage_materializes_a_schema_valid_card() -> None:
    workflow = load_workflow(WORKFLOW)
    for stage in workflow["stages"]:
        card = materialize_test_card(stage, workflow)
        assert card.meta["risk-tier"] == stage["riskTier"]
        assert card.meta["action"] == stage["action"]
        assert card.meta["target"] == stage["target"]


def test_review_stages_use_the_checker_declaration() -> None:
    workflow = load_workflow(WORKFLOW)
    for stage in workflow["stages"]:
        if stage["action"].startswith("review:"):
            assert stage["agentId"] == "figment-checker", stage["id"]
            assert stage["profileId"] == "worker:claude:claude-opus-5", stage["id"]


def test_stage_profile_ids_match_their_agents_default_profile() -> None:
    workflow = load_workflow(WORKFLOW)
    profile_by_suffix = {suffix: expected[2] for suffix, expected in EXPECTED.items()}
    for stage in workflow["stages"]:
        suffix = stage["agentId"].removeprefix("figment-")
        assert stage["profileId"] == profile_by_suffix[suffix], stage["id"]
