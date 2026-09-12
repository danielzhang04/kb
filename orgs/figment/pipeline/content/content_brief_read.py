"""Project current content-brief proof hashes without exposing source records.

This read-only adapter delegates all path, content, and dependency validation to
``content_brief.revalidate_content_brief``.  It does not build or revise briefs.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import re
import sys
from pathlib import Path
from types import ModuleType
from typing import Any


SCHEMA = "figment/content-brief-revalidation@1"
SHA256 = re.compile(r"[0-9a-f]{64}\Z")
CLI_REFUSAL = "content brief revalidation refused"

# Keep direct-script authority loading read-only by suppressing dependency bytecode.
sys.dont_write_bytecode = True


class ContentBriefReadError(RuntimeError):
    """A current brief proof cannot be safely projected."""


def _load_brief_authority() -> ModuleType:
    try:
        from . import content_brief as authority
    except ImportError:  # Direct script execution.
        authority_path = Path(__file__).with_name("content_brief.py")
        authority_spec = importlib.util.spec_from_file_location(
            "figment_content_brief_read_authority", authority_path,
        )
        if authority_spec is None or authority_spec.loader is None:
            raise ContentBriefReadError("content brief authority is unavailable")
        authority = importlib.util.module_from_spec(authority_spec)
        sys.modules[authority_spec.name] = authority
        try:
            authority_spec.loader.exec_module(authority)
        except Exception as exc:
            sys.modules.pop(authority_spec.name, None)
            raise ContentBriefReadError("content brief authority is unavailable") from exc
    return authority


try:
    briefs: ModuleType | None = _load_brief_authority()
except Exception:
    briefs = None


def _proof_hash(proof: object, name: str) -> str:
    if not isinstance(proof, dict):
        raise ContentBriefReadError("content brief authority returned an invalid proof")
    record = proof.get(name)
    if not isinstance(record, dict):
        raise ContentBriefReadError("content brief authority returned an invalid proof")
    digest = record.get("sha256")
    if not isinstance(digest, str) or SHA256.fullmatch(digest) is None:
        raise ContentBriefReadError("content brief authority returned an invalid proof")
    return digest


def revalidate_content_brief_projection(
    root: Path, request: str, brief: str,
) -> dict[str, str]:
    """Return only canonical public hashes from one authoritative revalidation."""
    if briefs is None:
        raise ContentBriefReadError("content brief authority is unavailable")
    proof: Any = briefs.revalidate_content_brief(root, request, brief)
    return {
        "schema": SCHEMA,
        "request_sha256": _proof_hash(proof, "request"),
        "brief_sha256": _proof_hash(proof, "brief"),
    }


class _ArgumentParser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        del message
        raise ContentBriefReadError("invalid command line")


def _canonical_json(value: dict[str, str]) -> str:
    return json.dumps(
        value,
        ensure_ascii=True,
        allow_nan=False,
        sort_keys=True,
        separators=(",", ":"),
    ) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = _ArgumentParser(
        description="Revalidate one Figment content brief and project its hashes.",
    )
    parser.add_argument("--root", required=True)
    parser.add_argument("--request", required=True)
    parser.add_argument("--brief", required=True)
    try:
        args = parser.parse_args(argv)
        projection = revalidate_content_brief_projection(
            Path(args.root), args.request, args.brief,
        )
        encoded = _canonical_json(projection).encode("utf-8")
        sys.stdout.buffer.write(encoded)
        sys.stdout.buffer.flush()
    except Exception:
        print(CLI_REFUSAL, file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
