"""Build a local semantic-brain index from the kb's Markdown corpus."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path
from time import perf_counter

import numpy as np

from scripts.brain.chunker import Chunk, chunk_file
from scripts.brain.embedder import Embedder, SentenceTransformerEmbedder
from scripts.brain import store


CORPUS_GLOBS = ("memory/**/*.md", "handoffs/**/*.md", "docs/**/*.md", "orgs/*/STATE.md")


@dataclass(frozen=True)
class IndexStats:
    files: int
    chunks: int
    seconds: float


def _visible(path: Path, repo_root: Path) -> bool:
    return not any(part.startswith(".") for part in path.relative_to(repo_root).parts)


def discover_files(repo_root: Path) -> list[Path]:
    """Return the exact configured corpus, in a reproducible order."""
    root = repo_root.resolve()
    files: set[Path] = set()
    for pattern in CORPUS_GLOBS:
        files.update(path for path in root.glob(pattern) if path.is_file() and _visible(path, root))
    return sorted(files, key=lambda path: path.relative_to(root).as_posix())


def _embed_input(chunk: Chunk) -> str:
    """Add structural context without changing the persisted source chunk."""
    if not chunk.heading_path:
        return chunk.text
    return f"{' > '.join(chunk.heading_path)}\n\n{chunk.text}"


def build_index(root: Path, out_dir: Path, embedder: Embedder) -> IndexStats:
    """Build and persist an index with a caller-provided embedding implementation."""
    started = perf_counter()
    repo_root = root.resolve()
    files = discover_files(repo_root)
    chunks: list[Chunk] = [
        chunk for path in files for chunk in chunk_file(path, repo_root)
    ]
    vectors = (
        embedder.embed([_embed_input(chunk) for chunk in chunks])
        if chunks
        else np.empty((0, embedder.dim), dtype=np.float32)
    )
    store.save(
        out_dir,
        chunks,
        vectors,
        model=embedder.model_name,
        dim=embedder.dim,
        roots=list(CORPUS_GLOBS),
    )
    return IndexStats(files=len(files), chunks=len(chunks), seconds=perf_counter() - started)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subcommands = parser.add_subparsers(dest="command", required=True)
    build = subcommands.add_parser("build", help="build a local vector index")
    build.add_argument("--root", type=Path, default=Path("."))
    build.add_argument("--out", type=Path, default=Path(store.DEFAULT_INDEX_DIR))
    args = parser.parse_args(argv)

    if args.command == "build":
        out_dir = args.out if args.out.is_absolute() else args.root / args.out
        stats = build_index(args.root, out_dir, SentenceTransformerEmbedder())
        print(f"files={stats.files} chunks={stats.chunks} seconds={stats.seconds:.2f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
