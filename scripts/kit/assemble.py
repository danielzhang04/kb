"""Assemble routed kit blocks into a model-visible context artifact."""

from __future__ import annotations

import argparse
import subprocess
from dataclasses import dataclass
from pathlib import Path

import yaml


class KitFrontmatterError(ValueError):
    """A kit block does not have the required frontmatter shape."""


class KitBudgetError(ValueError):
    """A kit block body exceeds its declared byte budget."""


@dataclass(frozen=True)
class Block:
    name: str
    description: str
    when: str
    audience: str
    read_only: bool
    budget_bytes: int
    body: str
    path: Path


_REQUIRED_FIELDS = {
    "name",
    "description",
    "when",
    "audience",
    "read_only",
    "budget_bytes",
}


def _frontmatter(path: Path) -> tuple[dict[str, object], str]:
    text = path.read_text(encoding="utf-8").replace("\r\n", "\n").replace("\r", "\n")
    if not text.startswith("---\n"):
        raise KitFrontmatterError(f"{path}: frontmatter must start with ---")

    try:
        _, header, body = text.split("---\n", 2)
    except ValueError as exc:
        raise KitFrontmatterError(f"{path}: frontmatter closing fence is missing") from exc

    try:
        fields = yaml.safe_load(header)
    except yaml.YAMLError as exc:
        raise KitFrontmatterError(f"{path}: invalid frontmatter") from exc
    if not isinstance(fields, dict):
        raise KitFrontmatterError(f"{path}: frontmatter must be a mapping")

    missing = _REQUIRED_FIELDS - fields.keys()
    if missing:
        raise KitFrontmatterError(f"{path}: missing required fields: {', '.join(sorted(missing))}")
    return fields, body


def parse_block(path: Path) -> Block:
    """Parse and validate one kit markdown block."""
    fields, body = _frontmatter(path)

    for field in ("name", "description", "when", "audience"):
        if not isinstance(fields[field], str) or not fields[field].strip():
            raise KitFrontmatterError(f"{path}: {field} must be a non-empty string")
    if not isinstance(fields["read_only"], bool):
        raise KitFrontmatterError(f"{path}: read_only must be true or false")
    if isinstance(fields["budget_bytes"], bool) or not isinstance(fields["budget_bytes"], int):
        raise KitFrontmatterError(f"{path}: budget_bytes must be an integer")
    budget_bytes = fields["budget_bytes"]
    if budget_bytes < 0:
        raise KitFrontmatterError(f"{path}: budget_bytes must not be negative")
    if len(body.encode("utf-8")) > budget_bytes:
        raise KitBudgetError(
            f"{path}: body is {len(body.encode('utf-8'))} bytes, over {budget_bytes}-byte budget"
        )

    return Block(
        name=fields["name"],
        description=fields["description"],
        when=fields["when"],
        audience=fields["audience"],
        read_only=fields["read_only"],
        budget_bytes=budget_bytes,
        body=body,
        path=path,
    )


def _audience_matches(block: Block, audience: str) -> bool:
    return "all" in {item.strip() for item in block.audience.split(",")} or audience in {
        item.strip() for item in block.audience.split(",")
    }


def _when_matches(block: Block, tags: set[str]) -> bool:
    conditions = {item.strip() for item in block.when.split(",")}
    return "always" in conditions or bool(conditions & tags)


def select_blocks(blocks: list[Block], *, audience: str, tags: set[str]) -> list[Block]:
    """Return the L2 blocks whose audience and routing condition match."""
    return [
        block
        for block in blocks
        if _audience_matches(block, audience) and _when_matches(block, tags)
    ]


def _body_heading(block: Block) -> str:
    if block.name == "north-star":
        return "## North star"
    if block.name == "invariants":
        return "## Invariants"
    return f"## Kit: {block.name}"


def _body_sort_key(block: Block) -> tuple[int, str]:
    special = {"north-star": 0, "invariants": 1}
    return special.get(block.name, 2), block.name


def _render(index_blocks: list[Block], body_blocks: list[Block], audience: str) -> str:
    index = [f"# kb kit ({audience})", "", "## Index"]
    index.extend(f"- {block.name}: {block.description}" for block in index_blocks)

    sections = []
    for block in sorted(body_blocks, key=_body_sort_key):
        sections.append(f"{_body_heading(block)}\n\n{block.body.rstrip()}")
    return "\n".join(index) + "\n\n" + "\n\n".join(sections).rstrip() + "\n"


def render(blocks: list[Block], audience: str) -> str:
    """Render every supplied L1 description and its default-routed L2 bodies."""
    return _render(blocks, select_blocks(blocks, audience=audience, tags=set()), audience)


def assemble(repo_root: Path, audience: str, tags: set[str] | None = None) -> Path:
    """Render selected kit blocks to the ignored, audience-specific artifact path."""
    kit_dir = repo_root / "kit"
    blocks = [parse_block(path) for path in sorted(kit_dir.glob("*.md"))]
    selected = select_blocks(blocks, audience=audience, tags=tags or set())
    rendered_dir = kit_dir / ".rendered"
    rendered_dir.mkdir(parents=True, exist_ok=True)
    artifact = rendered_dir / f"{audience}.md"
    artifact.write_text(_render(blocks, selected, audience), encoding="utf-8")
    return artifact


def check_read_only(
    repo_root: Path, main_ref: str = "refs/remotes/origin/main"
) -> list[str]:
    """List read-only kit blocks absent from, or differing from, the main ref."""
    issues: list[str] = []
    for path in sorted((repo_root / "kit").glob("*.md")):
        block = parse_block(path)
        if not block.read_only:
            continue
        relpath = path.relative_to(repo_root).as_posix()
        result = subprocess.run(
            ["git", "show", f"{main_ref}:{relpath}"],
            cwd=repo_root,
            capture_output=True,
        )
        if result.returncode != 0:
            issues.append(f"absent-from-main: {relpath}")
        elif result.stdout.replace(b"\r\n", b"\n") != path.read_bytes().replace(b"\r\n", b"\n"):
            issues.append(f"differs: {relpath}")
    return issues


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--audience", required=True)
    parser.add_argument("--check-read-only", action="store_true")
    args = parser.parse_args()

    repo_root = Path.cwd()
    if args.check_read_only:
        issues = check_read_only(repo_root)
        if issues:
            absent = [issue.removeprefix("absent-from-main: ") for issue in issues
                      if issue.startswith("absent-from-main: ")]
            differing = [issue.removeprefix("differs: ") for issue in issues
                         if issue.startswith("differs: ")]
            if absent:
                print("Read-only kit blocks absent from main:")
                print("\n".join(absent))
            if differing:
                print("Read-only kit blocks differing from main:")
                print("\n".join(differing))
            return 1

    print(assemble(repo_root, args.audience))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
