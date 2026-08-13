from __future__ import annotations
import argparse
from pathlib import Path


def migrate_card_text(text: str) -> str:
    if not text.startswith("---\n"):
        raise ValueError("card must start with YAML frontmatter")
    head, marker, body = text[4:].partition("\n---")
    if not marker:
        raise ValueError("card frontmatter is not closed")
    if any(line.startswith("schema-version:") for line in head.splitlines()):
        return text
    return f"---\nschema-version: 1\n{head}\n---{body}"


def migrate_workflow_text(text: str) -> str:
    if not text.startswith("---\n"):
        raise ValueError("workflow must start with YAML frontmatter")
    head, marker, _body = text[4:].partition("\n---")
    if not marker:
        raise ValueError("workflow frontmatter is not closed")
    if any(line.startswith("schemaVersion:") for line in head.splitlines()):
        return text
    return "---\nschemaVersion: 1\n" + text[4:]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("kind", choices=("card", "workflow"))
    parser.add_argument("path", type=Path)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    original = args.path.read_text(encoding="utf-8")
    migrated = migrate_card_text(original) if args.kind == "card" else migrate_workflow_text(original)
    if args.check:
        return 0 if migrated == original else 1
    args.path.write_text(migrated, encoding="utf-8", newline="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
