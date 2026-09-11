"""Validate every orgs/*/GOAL.md and orgs/*/STATE.md against the project-frame required shape.

Read-only. Exits 1 with one line per problem the moment any tracked GOAL.md/STATE.md fails a
check; exits 0 (including when zero such files exist -- an org that has not adopted the frame yet
is not a lint failure, only a malformed file that DOES exist is).
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

GOAL_HEADINGS = ["North star", "Success conditions", "Invariants", "Governing docs"]
STATE_HEADINGS = ["Now", "Current gate", "Next", "Blocked", "Findings", "Infra"]
STATE_MAX_LINES = 60
GOAL_MAX_LINES = 80
RULED_RE = re.compile(r"^_Ruled:\s*\d{4}-\d{2}-\d{2}_?\s*$", re.MULTILINE)
UPDATED_RE = re.compile(r"^_Updated:\s*\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?_?\s*$", re.MULTILINE)
HEADING_RE = re.compile(r"^##\s+(.+?)\s*$", re.MULTILINE)


def _heading_matches(actual: str, wanted: str) -> bool:
    """PREFIX match at a word boundary: `Current gate (P8)` satisfies `Current gate`,
    but `Nextsteps` does NOT satisfy `Next`."""
    if actual == wanted:
        return True
    if not actual.startswith(wanted):
        return False
    rest = actual[len(wanted):]
    return rest[:1] in (" ", "(")


def _missing_headings(text: str, wanted: list[str]) -> list[str]:
    have = HEADING_RE.findall(text)
    return [h for h in wanted if not any(_heading_matches(actual, h) for actual in have)]


def check_goal(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8")
    problems = [f"{path}: missing ## {h}" for h in _missing_headings(text, GOAL_HEADINGS)]
    if not RULED_RE.search(text):
        problems.append(f"{path}: missing or malformed _Ruled:_ line")
    lines = text.splitlines()
    if len(lines) > GOAL_MAX_LINES:
        problems.append(f"{path}: {len(lines)} lines > {GOAL_MAX_LINES} max")
    return problems


def check_state(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8")
    problems = [f"{path}: missing ## {h}" for h in _missing_headings(text, STATE_HEADINGS)]
    if not UPDATED_RE.search(text):
        problems.append(f"{path}: missing or malformed _Updated:_ line")
    lines = text.splitlines()
    if len(lines) > STATE_MAX_LINES:
        problems.append(f"{path}: {len(lines)} lines > {STATE_MAX_LINES} max")
    return problems


def lint(root: Path) -> list[str]:
    problems: list[str] = []
    for goal in sorted(root.glob("orgs/*/GOAL.md")):
        problems.extend(check_goal(goal))
    for state in sorted(root.glob("orgs/*/STATE.md")):
        problems.extend(check_state(state))
    return problems


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=".")
    args = parser.parse_args(argv)
    problems = lint(Path(args.root))
    for line in problems:
        print(line)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
