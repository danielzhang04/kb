from __future__ import annotations
import argparse
from pathlib import Path
import re
import sys


_OPENING_FENCE = re.compile(r"^---(\r\n|\n|\r)")
_CLOSING_FENCE = re.compile(r"(?:\r\n|\n|\r)---(?=\r\n|\n|\r|$)")


def _dominant_terminator(text: str, fallback: str) -> str:
    crlf = text.count("\r\n")
    lf = text.count("\n") - crlf
    cr = text.count("\r") - crlf
    counts = {"\r\n": crlf, "\n": lf, "\r": cr}
    dominant = max(counts, key=counts.get)
    return dominant if counts[dominant] else fallback


def _insert_frontmatter_version(text: str, key: str, label: str) -> str:
    opening = _OPENING_FENCE.match(text)
    if opening is None:
        raise ValueError(f"{label} must start with YAML frontmatter")
    closing = _CLOSING_FENCE.search(text, opening.end())
    if closing is None:
        raise ValueError(f"{label} frontmatter is not closed")
    head = text[opening.end():closing.start()]
    if any(line.startswith(f"{key}:") for line in head.splitlines()):
        return text
    terminator = _dominant_terminator(text, opening.group(1))
    return f"{text[:opening.end()]}{key}: 1{terminator}{text[opening.end():]}"


def migrate_card_text(text: str) -> str:
    return _insert_frontmatter_version(text, "schema-version", "card")


def migrate_workflow_text(text: str) -> str:
    return _insert_frontmatter_version(text, "schemaVersion", "workflow")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("kind", choices=("card", "workflow"))
    parser.add_argument("path", type=Path)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args(argv)
    try:
        with args.path.open("r", encoding="utf-8", newline="") as handle:
            original = handle.read()
        migrated = migrate_card_text(original) if args.kind == "card" else migrate_workflow_text(original)
    except (OSError, ValueError) as exc:
        print(f"cannot migrate {args.path}: {exc}", file=sys.stderr)
        return 2
    if args.check:
        return 0 if migrated == original else 1
    try:
        with args.path.open("w", encoding="utf-8", newline="") as handle:
            handle.write(migrated)
    except OSError as exc:
        print(f"cannot write migrated file {args.path}: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
