"""Scaffold a new project in orgs/ from templates/ (spec s11 lifecycle)."""
from __future__ import annotations

import datetime
import re
import sys
from pathlib import Path

MARKER_END = "<!-- projects:end -->"
FILES = ("_index.md", "STATE.md", "contract.md", "HEARTBEAT.md", "CLAUDE.md")
DIRS = ("raw", "wiki", "output", "workflows", "scripts")


def create(repo_root: Path, name: str, today: datetime.date | None = None) -> Path:
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", name):
        raise ValueError("project name must be kebab-case: [a-z0-9-]")
    today = today or datetime.date.today()
    dest = Path(repo_root) / "orgs" / name
    if dest.exists():
        raise FileExistsError(f"project exists: {dest}")
    templates = Path(repo_root) / "templates"
    dest.mkdir(parents=True)
    for f in FILES:
        text = (templates / f).read_text(encoding="utf-8")
        text = text.replace("{{name}}", name).replace("{{date}}", today.isoformat())
        (dest / f).write_text(text, encoding="utf-8")
    for d in DIRS:
        (dest / d).mkdir()
        (dest / d / ".gitkeep").write_text("", encoding="utf-8")
    index = Path(repo_root) / "_index.md"
    entry = f"- [{name}](orgs/{name}/_index.md)\n"
    text = index.read_text(encoding="utf-8")
    if entry not in text:
        index.write_text(text.replace(MARKER_END, entry + MARKER_END), encoding="utf-8")
    return dest


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: new_project.py <kebab-case-name>")
        return 2
    dest = create(Path.cwd(), sys.argv[1])
    print(f"scaffolded {dest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
