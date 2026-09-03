#!/usr/bin/env python3
"""gates.py — the sole writer of a figment gate record (`gate.json`, design §2.2 /
finding 7). A gate record is a durable, SHA-bound human decision: it names exactly
which file it reviewed, at what hash, decided by whom, when, and (`verified` or
`parked`) what. A stale gate — one whose subject has since changed — is never
current; `gate_is_current` is how every downstream reader (starting with
`pipeline/expand/batch_state.py`'s `curated -> approved` transition) checks that
before trusting a gate record at all.

Not called tonight before the human eye decision (P1 step 1.7): this module exists
so the interface is tested and ready, not so it is exercised live in P1.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path
from typing import Any

VALID_DECISIONS = frozenset({"verified", "parked"})
_READ_CHUNK = 65536


def sha256_file(path: Path) -> str:
    """The sha256 hex digest of the file at `path`, streamed (never loads the whole
    file into memory at once — anchors and boards can be large)."""
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(_READ_CHUNK), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _atomic_write_json(path: Path, data: Any) -> None:
    """Write `data` as JSON to `path` atomically (temp file, then os.replace) —
    mirrors `qa_stamp.py`/`batch_state.py`'s own helper. A gate record is exactly the
    kind of artifact a half-written file must never masquerade as."""
    path = Path(path)
    tmp = path.with_name(path.name + ".tmp")
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=1)
            f.write("\n")
        os.replace(tmp, path)
    finally:
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass


def write_gate(
    path: Path,
    *,
    gate_id: str,
    subject_path: Path,
    decision: str,
    decided_by: str,
    decided_at: str,
    reasons: tuple = (),
    approval_token_ref: str | None = None,
) -> dict:
    """Write one gate record atomically to `path`. Fail-closed on everything a gate
    record cannot honestly omit: the decision must be exactly `verified` or `parked`
    (every other value is rejected — this is not a general-purpose enum, it is the
    two decisions a human gate can actually make), and a human `decided_by` +
    `decided_at` are mandatory (a gate with no named human and no timestamp is not a
    gate). `approval_token_ref` is the one genuinely optional field — an opaque
    pointer to a spend/approval card, never a secret itself."""
    if decision not in VALID_DECISIONS:
        raise ValueError(
            f"gate decision must be exactly one of {sorted(VALID_DECISIONS)}, got {decision!r}"
        )
    if not gate_id or not str(gate_id).strip():
        raise ValueError("write_gate requires a non-empty gate_id")
    if not decided_by or not str(decided_by).strip():
        raise ValueError("write_gate requires a non-empty human decided_by identity")
    if not decided_at or not str(decided_at).strip():
        raise ValueError("write_gate requires a non-empty decided_at timestamp")

    subject_path = Path(subject_path)
    subject_sha256 = sha256_file(subject_path)

    record = {
        "gate_id": gate_id,
        "subject_path": str(subject_path),
        "subject_sha256": subject_sha256,
        "decision": decision,
        "decided_by": decided_by,
        "decided_at": decided_at,
        "reasons": list(reasons),
        "approval_token_ref": approval_token_ref,
    }
    _atomic_write_json(Path(path), record)
    return record


def gate_is_current(gate: dict, subject_path: Path) -> bool:
    """A gate is current iff its recorded `subject_sha256` still matches the live
    file at `subject_path` right now. A gate whose subject has since been edited,
    regenerated, or replaced is stale and must never be treated as an approval for
    the new content — "a stale gate cannot approve changed content" (plan global
    constraints)."""
    if not isinstance(gate, dict):
        raise ValueError(f"gate must be a dict, got {type(gate).__name__}")
    subject_path = Path(subject_path)
    if not subject_path.is_file():
        return False
    return gate.get("subject_sha256") == sha256_file(subject_path)


def build_arg_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        prog="gates.py",
        description="Sole writer of a figment SHA-bound gate record (gate.json).",
    )
    ap.add_argument("--out", required=True, type=Path, help="path to write the gate record")
    ap.add_argument("--gate-id", required=True)
    ap.add_argument("--subject", required=True, type=Path, help="the reviewed file this gate is bound to")
    ap.add_argument("--decision", required=True, choices=sorted(VALID_DECISIONS))
    ap.add_argument("--decided-by", required=True, help="the human identity making this decision")
    ap.add_argument("--decided-at", required=True, help="ISO-8601 timestamp of the decision")
    ap.add_argument("--reason", action="append", default=[], dest="reasons")
    ap.add_argument("--approval-token-ref", default=None)
    return ap


def main(argv: list[str] | None = None) -> int:
    args = build_arg_parser().parse_args(argv)
    try:
        record = write_gate(
            args.out,
            gate_id=args.gate_id,
            subject_path=args.subject,
            decision=args.decision,
            decided_by=args.decided_by,
            decided_at=args.decided_at,
            reasons=tuple(args.reasons),
            approval_token_ref=args.approval_token_ref,
        )
    except (ValueError, OSError) as exc:
        print(f"gates error: {exc}", file=sys.stderr)
        return 1
    print(f"gate {record['gate_id']!r} written: {record['decision']} by {record['decided_by']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
