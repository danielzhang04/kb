"""Small, advisory parser for the versioned portion of an agent definition.

This deliberately does not decide routing or execution eligibility.  It gives
the Python factory and direct-dispatch recorder the same backward-compatible
view of the three versioning fields that the dashboard roster exposes.
"""
from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
import re
import stat
from typing import Any

import yaml


@dataclass(frozen=True)
class AgentDefinitionMetadata:
    """The optional, advisory declaration metadata with legacy defaults applied."""

    version: int
    io: dict[str, Any] | None
    defaults: dict[str, str | int | float | None] | None


def _frontmatter(text: str) -> dict[str, Any]:
    opening = re.match(r"\A---\r?\n", text)
    if opening is None:
        raise ValueError("agent definition has no frontmatter")
    closing = re.search(r"(?m)^---\r?$", text[opening.end():])
    if closing is None:
        raise ValueError("agent definition frontmatter is not terminated")
    raw = text[opening.end():opening.end() + closing.start()]
    try:
        parsed = yaml.safe_load(raw)
    except yaml.YAMLError as err:
        raise ValueError("agent definition frontmatter is malformed") from err
    if not isinstance(parsed, dict):
        raise ValueError("agent definition frontmatter is not a mapping")
    return parsed


def _version(value: Any) -> int:
    # bool is an int subclass in Python but never a declaration version.
    return value if type(value) is int and value >= 1 else 1


def _io(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    return {"inputs": value.get("inputs"), "outputs": value.get("outputs")}


def _defaults(value: Any) -> dict[str, str | int | float | None] | None:
    if not isinstance(value, dict):
        return None
    out: dict[str, str | int | float | None] = {}
    for key in ("budget_usd", "max_retries", "escalation"):
        item = value.get(key)
        # bool is excluded even though it is an int subclass; these are advisory
        # strings/numbers, never executable policy.
        out[key] = item if isinstance(item, (str, int, float)) and not isinstance(item, bool) else None
    return out


def parse_agent_definition(text: str) -> AgentDefinitionMetadata:
    """Parse optional versioning fields, treating missing or malformed values as defaults."""
    meta = _frontmatter(text)
    return AgentDefinitionMetadata(
        version=_version(meta.get("version")),
        io=_io(meta.get("io")),
        defaults=_defaults(meta.get("defaults")),
    )


def _unsafe_link_component(repo_root: Path, relative: tuple[str, ...]) -> bool:
    """Reject symlinks and Windows reparse points in existing path components."""
    current = repo_root
    for part in relative:
        current = current / part
        try:
            metadata = os.lstat(current)
        except OSError:
            return True
        if stat.S_ISLNK(metadata.st_mode) or (
            getattr(metadata, "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT
        ):
            return True
    return False


def load_agent_definition(path: Path) -> AgentDefinitionMetadata:
    """Load only a direct, non-linked child of ``<repo>/agents``.

    Definitions are advisory metadata, but callers use them in dispatch and
    mutation paths.  Keep the same symlink/reparse-point wall those paths use
    elsewhere so a junction cannot redirect a supposedly local declaration.
    """
    requested = Path(path)
    if requested.name in {"", ".", ".."} or requested.parent.name != "agents":
        raise ValueError(f"agent definition must be a direct child of <repo>/agents: {requested}")
    repo_root = requested.parent.parent.resolve()
    agents_dir = repo_root / "agents"
    canonical = requested.resolve()
    if (
        _unsafe_link_component(repo_root, ("agents", requested.name))
        or canonical.parent != agents_dir
        or canonical.name != requested.name
    ):
        raise ValueError(f"agent definition path is linked or escapes <repo>/agents: {requested}")
    return parse_agent_definition(canonical.read_text(encoding="utf-8"))
