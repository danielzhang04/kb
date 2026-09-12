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
STATE_HEADINGS = ["Now", "Current gate", "Decisions", "Next", "Blocked", "Findings", "Infra"]
STATE_MAX_LINES = 60
GOAL_MAX_LINES = 80
DECISIONS_MAX_BULLETS = 10
RULED_RE = re.compile(r"^_Ruled:\s*\d{4}-\d{2}-\d{2}_?\s*$", re.MULTILINE)
UPDATED_RE = re.compile(r"^_Updated:\s*\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?_?\s*$", re.MULTILINE)
HEADING_RE = re.compile(r"^##\s+(.+?)\s*$", re.MULTILINE)
# `- 2026-09-11 — ruling — why` (date, ruling, why). The em dash is the canonical separator; the
# en dash `–` (what most editors and several agents actually emit) and a plain ` - ` are accepted
# too. The date's own internal hyphens are consumed by the `\d{4}-\d{2}-\d{2}` literal before any
# separator alternative is tried, so there is no ambiguity between them.
DECISION_BULLET_RE = re.compile(r"^[-*]\s+\d{4}-\d{2}-\d{2}\s+(?:—|–|-)\s+\S.*(?:—|–|-)\s+\S")


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


def _section_body(text: str, wanted: str) -> str | None:
    """Body text between a heading matching `wanted` (by the same prefix rule as
    `_heading_matches`) and the next `## ` heading, or end of text. `None` if no such heading."""
    matches = list(HEADING_RE.finditer(text))
    for i, m in enumerate(matches):
        if _heading_matches(m.group(1).strip(), wanted):
            start = m.end()
            end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
            return text[start:end]
    return None


def _is_bullet(line: str) -> bool:
    """A BULLET is a line whose first non-whitespace character is `-` or `*`.

    Everything else inside `## Decisions` -- a wrapped continuation of the previous bullet, an
    indented sub-note, a stray sentence -- is not a bullet and is ignored entirely (fix wave I1).
    The previous version treated every non-empty line as a bullet, so one bullet wrapped across
    two lines reported a bogus "lacks the YYYY-MM-DD — ruling — why shape" for its own second half
    AND counted twice against DECISIONS_MAX_BULLETS, which is how a 10-bullet cap could fail on
    six decisions. The lint's job is the shape of the decisions, not the wrapping of the file.
    """
    return line.lstrip()[:1] in ("-", "*")


def _check_decisions(path: Path, text: str) -> list[str]:
    """Inside `## Decisions` only: every BULLET line (see `_is_bullet`) must match
    `DECISION_BULLET_RE`, and there must be no more than `DECISIONS_MAX_BULLETS` of them.
    Non-bullet lines are ignored for both the shape check and the count."""
    body = _section_body(text, "Decisions")
    if body is None:
        return []
    bullets = [line.strip() for line in body.splitlines() if _is_bullet(line)]
    problems = [
        f"{path}: Decisions bullet {i} lacks the YYYY-MM-DD — ruling — why shape"
        for i, bullet in enumerate(bullets, start=1)
        if not DECISION_BULLET_RE.match(bullet)
    ]
    if len(bullets) > DECISIONS_MAX_BULLETS:
        problems.append(f"{path}: Decisions has {len(bullets)} bullets > {DECISIONS_MAX_BULLETS} max")
    return problems


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
    problems.extend(_check_decisions(path, text))
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
