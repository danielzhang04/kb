"""Flag stale/superseded/dead-Load handoffs for a human to delete on ops.

Read-only, always. `--delete` only PRINTS the `git rm handoffs/<file>` lines a boss runs by hand
on the ops branch (CLAUDE.md's coordination-write flow: pull --rebase origin ops, write, push) --
this script never deletes, never writes, never touches git state.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
STALE_DAYS = 14
GIT_TIMEOUT_S = 10
FILENAME_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})-([a-z0-9]+)-.+\.md$")
LOAD_HEADING_RE = re.compile(r"^##\s+Load(?:\s+list)?\s*$", re.MULTILINE | re.IGNORECASE)
NEXT_HEADING_RE = re.compile(r"^##\s+", re.MULTILINE)
BACKTICK_PATH_RE = re.compile(r"`([A-Za-z0-9_./-]+\.[A-Za-z0-9]+)`")


@dataclass
class Handoff:
    filename: str
    handoff_date: date | None
    scope: str | None
    text: str


def _git(root: Path, *args: str) -> subprocess.CompletedProcess | None:
    """Run git, decoding output as UTF-8 (never the OS locale codepage -- on Windows that's
    often cp1252, which mangles non-ASCII handoff content and raises UnicodeDecodeError on byte
    sequences cp1252 has no mapping for). Returns None if git hangs past the timeout, so a caller
    degrades to "unknown" instead of crashing."""
    try:
        return subprocess.run(
            ["git", "-C", str(root), *args],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=GIT_TIMEOUT_S,
        )
    except subprocess.TimeoutExpired:
        return None


def _now(env: dict) -> date:
    override = (env.get("KB_HANDOFFS_NOW") or "").strip()
    if override:
        return date.fromisoformat(override)
    return datetime.now(timezone.utc).date()


def _ops_handoff_names(root: Path) -> set[str]:
    result = _git(root, "ls-tree", "--name-only", "origin/ops:handoffs")
    if result is None or result.returncode != 0:
        return set()
    return {line.strip() for line in result.stdout.splitlines() if line.strip().endswith(".md")}


def _local_handoff_names(root: Path) -> set[str]:
    d = root / "handoffs"
    if not d.is_dir():
        return set()
    return {p.name for p in d.glob("*.md")}


def _read_handoff_text(root: Path, filename: str) -> str:
    local = root / "handoffs" / filename
    if local.is_file():
        try:
            return local.read_text(encoding="utf-8")
        except OSError:
            return ""
    result = _git(root, "show", f"origin/ops:handoffs/{filename}")
    return result.stdout if result is not None and result.returncode == 0 else ""


def collect_handoffs(root: Path) -> list[Handoff]:
    names = sorted((_ops_handoff_names(root) | _local_handoff_names(root)) - {"README.md"})
    out = []
    for name in names:
        m = FILENAME_RE.match(name)
        handoff_date = date.fromisoformat(m.group(1)) if m else None
        scope = m.group(2) if m else None
        out.append(Handoff(filename=name, handoff_date=handoff_date, scope=scope, text=_read_handoff_text(root, name)))
    return out


def _load_paths(text: str) -> list[str]:
    m = LOAD_HEADING_RE.search(text)
    if not m:
        return []
    rest = text[m.end():]
    nxt = NEXT_HEADING_RE.search(rest)
    body = rest[: nxt.start()] if nxt else rest
    return BACKTICK_PATH_RE.findall(body)


def _path_exists_on_ops_or_main(root: Path, rel_path: str) -> bool:
    """STRICT: a Load path is real only if it exists on origin/ops or origin/main.
    No working-tree fallback -- a path that exists only locally (uncommitted, or
    committed to a work branch that never reached ops/main) is dead."""
    for ref in ("origin/ops", "origin/main"):
        result = _git(root, "cat-file", "-e", f"{ref}:{rel_path}")
        if result is not None and result.returncode == 0:
            return True
    return False


def flag(root: Path, handoffs: list[Handoff], today: date) -> list[dict]:
    by_scope: dict[str, list[Handoff]] = {}
    for h in handoffs:
        if h.scope:
            by_scope.setdefault(h.scope, []).append(h)

    flags: list[dict] = []
    for h in handoffs:
        reasons: list[str] = []
        if h.handoff_date is not None:
            age_days = (today - h.handoff_date).days
            if age_days > STALE_DAYS:
                reasons.append(f"{age_days} days old (> {STALE_DAYS})")
        if h.scope and h.handoff_date:
            newer = [
                o for o in by_scope[h.scope]
                if o.filename != h.filename and o.handoff_date and o.handoff_date > h.handoff_date
            ]
            if newer:
                latest = sorted(newer, key=lambda o: o.handoff_date)[-1]
                reasons.append(f"superseded by {latest.filename}")
        dead = [p for p in _load_paths(h.text) if not _path_exists_on_ops_or_main(root, p)]
        if dead:
            reasons.append("dead Load path(s): " + ", ".join(dead))
        if reasons:
            flags.append({"file": h.filename, "reasons": reasons, "reason": "; ".join(reasons)})
    return flags


def render_table(flags: list[dict]) -> str:
    if not flags:
        return "No flagged handoffs."
    width = max(len(f["file"]) for f in flags)
    return "\n".join(f["file"].ljust(width) + "  " + f["reason"] for f in flags)


def render_delete(flags: list[dict]) -> str:
    return "\n".join(f"git rm handoffs/{f['file']}" for f in flags)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=str(REPO_ROOT))
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--delete", action="store_true")
    args = parser.parse_args(argv)

    root = Path(args.root)
    today = _now(os.environ)
    handoffs = collect_handoffs(root)
    flags = flag(root, handoffs, today)

    if args.json:
        print(json.dumps(flags))
    elif args.delete:
        print(render_delete(flags))
    else:
        print(render_table(flags))
    return 0


if __name__ == "__main__":
    sys.exit(main())
