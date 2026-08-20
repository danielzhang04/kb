"""Fleet baseline card (a): `def-parses-in-roster-shape`.

Parameterized pytest test backing `evals/agents/_fleet/def-parses-in-roster-shape.md`.
Every `agents/<id>.md` file must have YAML frontmatter that (1) parses, (2) has
`id` matching its filename, and (3) carries the canonical roster-shape field set
the agent-infra plan documents (`docs/superpowers/plans/2026-08-18-agent-infra.md`
Task 4 Interfaces: "canonical def shape = live `agents/*.md` frontmatter (id,
role, runtime, model, default-profile, allowed-profiles, projects, runner-bound,
description)").

A def marked `status: superseded` is a deliberately trimmed pointer (see
`agents/fyt-preproduction.md` / `agents/fyt-production.md`) — it is exempt from
the full field set but must still parse and self-identify correctly.

Runs standalone via `py -3 -m pytest evals/agents/_fleet/test_def_parses_in_roster_shape.py`
(pytest collects an explicit file path regardless of `testpaths`); the repo-root
`conftest.py` already puts `scripts/` on `sys.path`, and this file adds the same
path itself so it also works if collected some other way.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import canary  # noqa: E402  (shared frontmatter splitter, reused not copied)

CANONICAL_FIELDS = ("id", "role", "runtime", "model", "default-profile",
                    "allowed-profiles", "projects", "runner-bound", "description")
ALWAYS_REQUIRED = ("id", "role", "runtime", "model", "runner-bound", "description")


def _agent_files():
    d = REPO_ROOT / "agents"
    return sorted(d.glob("*.md")) if d.is_dir() else []


@pytest.mark.parametrize("path", _agent_files(), ids=lambda p: p.stem)
def test_def_parses_in_roster_shape(path):
    meta, _body = canary.split_frontmatter(path)
    assert isinstance(meta, dict), f"{path}: frontmatter is not a mapping"
    assert meta.get("id") == path.stem, f"{path}: id must match filename"
    required = ALWAYS_REQUIRED if meta.get("status") == "superseded" else CANONICAL_FIELDS
    missing = [f for f in required if f not in meta]
    assert not missing, f"{path}: missing roster-shape fields {missing}"


def test_at_least_one_agent_def_exists():
    # A green suite with zero parametrized cases would be a silent no-op, not a
    # pass — guard against that directly.
    assert _agent_files(), f"no agents/*.md files found under {REPO_ROOT / 'agents'}"
