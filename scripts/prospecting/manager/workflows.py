from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
import re

from scripts.prospecting.manager.p5_contracts import ENTRYPOINTS


AGENTS = {
    "prospecting-list-builder",
    "prospecting-personalizer",
    "prospecting-campaigner",
    "inspector",
    "human",
}
AGENT_CLI = {
    "prospecting-list-builder": "list-builder",
    "prospecting-personalizer": "personalizer",
    "prospecting-campaigner": "campaigner",
}
LOCAL_OPERATIONS = {"inspector": {"grade"}, "human": {"review"}}
SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
WORKFLOW_FIELDS = {"id", "default-manager", "version", "stages"}
STAGE_FIELDS = {"id", "agent", "operation", "needs", "inspect"}


@dataclass(frozen=True)
class Stage:
    id: str
    agent: str
    operation: str
    needs: tuple[str, ...]
    inspect: bool


@dataclass(frozen=True)
class Workflow:
    id: str
    manager: str
    version: int
    stages: tuple[Stage, ...]


def _load_frontmatter(path: Path) -> dict[str, object]:
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        raise ValueError("workflow_frontmatter_required")
    try:
        raw, _body = text[4:].split("\n---\n", 1)
    except ValueError as exc:
        raise ValueError("workflow_frontmatter_required") from exc
    try:
        values = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError("invalid_workflow_frontmatter") from exc
    if not isinstance(values, dict):
        raise ValueError("invalid_workflow_shape")
    return values


def _allowed_operations(agent: str) -> set[str]:
    if agent in AGENT_CLI:
        return set(ENTRYPOINTS[AGENT_CLI[agent]]["operations"])
    return LOCAL_OPERATIONS[agent]


def load_workflow(path: Path) -> Workflow:
    values = _load_frontmatter(path)
    if set(values) != WORKFLOW_FIELDS:
        raise ValueError("invalid_workflow_shape")

    workflow_id = values["id"]
    version = values["version"]
    manager = values["default-manager"]
    raw_stages = values["stages"]
    if (
        not isinstance(workflow_id, str)
        or not SLUG.fullmatch(workflow_id)
        or type(version) is not int
        or version < 1
    ):
        raise ValueError("invalid_workflow_identity")
    if manager != "prospecting-manager":
        raise ValueError("invalid_manager")
    if not isinstance(raw_stages, list):
        raise ValueError("invalid_workflow_shape")

    seen: set[str] = set()
    stages: list[Stage] = []
    for item in raw_stages:
        if not isinstance(item, dict) or set(item) != STAGE_FIELDS:
            raise ValueError("invalid_stage_shape")

        stage_id = item["id"]
        agent = item["agent"]
        operation = item["operation"]
        needs = item["needs"]
        inspect = item["inspect"]
        if (
            not isinstance(stage_id, str)
            or not SLUG.fullmatch(stage_id)
            or stage_id in seen
            or not isinstance(agent, str)
            or agent not in AGENTS
            or not isinstance(operation, str)
            or not isinstance(needs, list)
            or any(not isinstance(dependency, str) for dependency in needs)
            or not set(needs).issubset(seen)
        ):
            raise ValueError("invalid_stage_graph")
        if type(inspect) is not bool:
            raise ValueError("inspect_must_be_boolean")
        if operation not in _allowed_operations(agent):
            raise ValueError("unknown_operation")

        seen.add(stage_id)
        stages.append(Stage(stage_id, agent, operation, tuple(needs), inspect))

    return Workflow(workflow_id, manager, version, tuple(stages))
