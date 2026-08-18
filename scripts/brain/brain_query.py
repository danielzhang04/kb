"""Query a locally built semantic-brain index without network access."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
from typing import NoReturn

from scripts.brain.embedder import Embedder, SentenceTransformerEmbedder
from scripts.brain.store import (
    DEFAULT_INDEX_DIR,
    IndexFormatError,
    ModelMismatchError,
    load,
    search,
)


SNIPPET_LIMIT = 200


class _StrictArgumentParser(argparse.ArgumentParser):
    """Exit with a code distinct from the documented result codes on a usage error.

    Stock ``argparse`` exits 2 on a parse failure, which collided with this CLI's own
    "index not built" exit code (also 2) — a caller could not tell a mistyped flag from
    a missing index by exit code alone. Usage errors now exit 4 so 2 always means
    "index not built" and nothing else.
    """

    def error(self, message: str) -> NoReturn:
        self.print_usage(sys.stderr)
        self.exit(4, f"{self.prog}: error: {message}\n")


def _snippet(text: object) -> str:
    stripped = str(text).strip()
    if len(stripped) <= SNIPPET_LIMIT:
        return stripped
    return stripped[:SNIPPET_LIMIT] + "…"


def _query(
    index_dir: Path, q: str, k: int, embedder: Embedder
) -> tuple[list[dict[str, object]], dict[str, object]]:
    """Embed ``q``, rank the store's nearest chunks, and return them with the index manifest."""
    index = load(index_dir, embedder)
    query_vector = embedder.embed([q])[0]
    matches = search(index, query_vector, embedder, limit=k)
    results = [
        {
            "source_path": match["source_path"],
            "heading_path": match["heading_path"],
            "score": round(float(match["score"]), 4),
            "start_line": match["start_line"],
            "end_line": match["end_line"],
            "snippet": _snippet(match["text"]),
        }
        for match in matches
    ]
    return results, index.manifest


def query_index(index_dir: Path, q: str, k: int, embedder: Embedder) -> list[dict[str, object]]:
    """Embed ``q`` and project the store's nearest chunks into the public result shape."""
    results, _manifest = _query(index_dir, q, k, embedder)
    return results


def _default_index_dir() -> Path:
    return Path(__file__).resolve().parents[2] / DEFAULT_INDEX_DIR


def _positive_k(value: str) -> int:
    parsed = int(value)
    if parsed < 1:
        raise argparse.ArgumentTypeError("--k must be at least 1")
    return parsed


def _plain_result(result: dict[str, object]) -> str:
    heading = " > ".join(str(part) for part in result["heading_path"])
    location = f"{result['source_path']}:{result['start_line']}-{result['end_line']}"
    return f"{float(result['score']):.4f}  {location}\n  {heading}\n  {result['snippet']}"


def _emit_json_error(as_json: bool, reason: str) -> None:
    """Under --json, errors also land on stdout as {"error": reason} — stderr text is unchanged.

    A caller parsing stdout as JSON (e.g. the dashboard route) needs a machine-readable
    shape even on failure; the human-readable stderr line stays for terminal use.
    """
    if as_json:
        print(json.dumps({"error": reason}))


def main(argv: list[str] | None = None) -> int:
    parser = _StrictArgumentParser(description=__doc__)
    parser.add_argument("query")
    parser.add_argument("--k", type=_positive_k, default=8)
    parser.add_argument("--index", type=Path, default=_default_index_dir())
    parser.add_argument("--json", action="store_true", dest="as_json")
    args = parser.parse_args(argv)
    index_dir = args.index if args.index.is_absolute() else Path.cwd() / args.index

    # Do this before constructing the model so an unbuilt machine receives the actionable
    # answer immediately rather than paying the initial model-load cost.
    if not index_dir.is_dir():
        print("index not built — run: py -3 -m scripts.brain.indexer build", file=sys.stderr)
        _emit_json_error(args.as_json, "index-not-built")
        return 2

    try:
        results, manifest = _query(index_dir, args.query, args.k, SentenceTransformerEmbedder())
    except FileNotFoundError:
        print("index not built — run: py -3 -m scripts.brain.indexer build", file=sys.stderr)
        _emit_json_error(args.as_json, "index-not-built")
        return 2
    except ModelMismatchError as exc:
        print(str(exc), file=sys.stderr)
        _emit_json_error(args.as_json, "model-mismatch")
        return 3
    except IndexFormatError as exc:
        print(str(exc), file=sys.stderr)
        _emit_json_error(args.as_json, "index-format-error")
        return 3
    except Exception as exc:
        print(f"brain query failed: {exc}", file=sys.stderr)
        _emit_json_error(args.as_json, "query-failed")
        return 1

    if args.as_json:
        print(json.dumps({
            "query": args.query,
            "k": args.k,
            "results": results,
            "model": manifest.get("model"),
            "created_at": manifest.get("created_at"),
            "chunk_count": manifest.get("chunk_count"),
        }))
    else:
        for result in results:
            print(_plain_result(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
