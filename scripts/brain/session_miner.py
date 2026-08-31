"""Deterministically mine a Claude JSONL transcript into candidate lessons.

Usage: ``py -3 -m scripts.brain.session_miner mine TRANSCRIPT`` -- JSON on stdout.

The miner is JSON-only: it holds no file-write path at all, and rendering/publishing a
learning-proposal record belongs to ``scripts/learning_proposals.py`` and the server-owned
publisher.  A human or a future trusted Dream intake must accept these candidate facts.

Small deterministic signals only: a failed tool call retried with changed inputs
and later success, plus explicit assistant lesson markers. They generate
candidates, not conclusions.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Iterable


@dataclass(frozen=True)
class Candidate:
    """A proposed Dream ``ADD`` with transcript-line provenance."""

    lesson: str
    confidence: str
    evidence: str
    source_session: str
    reason: str
    date: str


@dataclass(frozen=True)
class _ToolCall:
    tool_id: str
    name: str
    signature: str
    input: dict[str, Any]
    line: int
    date: str


@dataclass(frozen=True)
class _ToolResult:
    tool_id: str
    is_error: bool
    line: int
    content: object


_EXPLICIT_LESSON = re.compile(
    r"^[-*]?\s*(WORKED|LEARNED|HAZARD|FRICTION|DECIDED|REMAINS):\s*(.+)"
)


def _content_blocks(record: dict[str, Any]) -> Iterable[dict[str, Any]]:
    message = record.get("message")
    if not isinstance(message, dict):
        return ()
    content = message.get("content")
    if not isinstance(content, list):
        return ()
    return (block for block in content if isinstance(block, dict))


def _one_line(value: object) -> str:
    if not isinstance(value, str):
        return ""
    return " ".join(value.split())


def _date(record: dict[str, Any]) -> str:
    value = record.get("timestamp")
    return value[:10] if isinstance(value, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", value[:10]) else ""


def _clip(value: str, limit: int) -> str:
    if len(value) <= limit:
        return value
    head = (limit - 1) // 2
    return value[:head] + "…" + value[-(limit - head - 1):]


def _input_delta(before: dict[str, Any], after: dict[str, Any]) -> str:
    for key in sorted(set(before) | set(after)):
        if before.get(key) != after.get(key):
            old = _clip(json.dumps(before.get(key), ensure_ascii=False, default=str), 60)
            new = _clip(json.dumps(after.get(key), ensure_ascii=False, default=str), 60)
            return f"{key} {old} → {new}"
    return "arguments changed"


def _error_excerpt(content: object) -> str:
    if isinstance(content, str):
        text = _one_line(content)
    elif isinstance(content, list):
        text = " ".join(
            _one_line(block.get("text"))
            for block in content if isinstance(block, dict)
        )
    else:
        text = _one_line(str(content))
    return _clip(text, 120)


def _records(path: Path) -> list[tuple[int, dict[str, Any]]]:
    records: list[tuple[int, dict[str, Any]]] = []
    for line_number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        try:
            value = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            records.append((line_number, value))
    return records


def _tool_activity(records: list[tuple[int, dict[str, Any]]]) -> tuple[dict[str, _ToolCall], dict[str, _ToolResult]]:
    calls: dict[str, _ToolCall] = {}
    results: dict[str, _ToolResult] = {}
    for line, record in records:
        for block in _content_blocks(record):
            if record.get("type") == "assistant" and block.get("type") == "tool_use":
                tool_id, name = block.get("id"), block.get("name")
                if isinstance(tool_id, str) and isinstance(name, str):
                    input_value = block.get("input", {})
                    tool_input = input_value if isinstance(input_value, dict) else {}
                    signature = json.dumps(tool_input, sort_keys=True, separators=(",", ":"), default=str)
                    calls[tool_id] = _ToolCall(tool_id, name, signature, tool_input, line, _date(record))
            if record.get("type") == "user" and block.get("type") == "tool_result":
                tool_id = block.get("tool_use_id")
                if isinstance(tool_id, str):
                    results[tool_id] = _ToolResult(
                        tool_id, block.get("is_error") is True, line, block.get("content")
                    )
    return calls, results


def _retry_candidates(records: list[tuple[int, dict[str, Any]]], source_session: str, source_file: str) -> list[Candidate]:
    calls, results = _tool_activity(records)
    ordered_calls = sorted(calls.values(), key=lambda call: call.line)
    candidates: list[Candidate] = []
    for failed in ordered_calls:
        failed_result = results.get(failed.tool_id)
        if failed_result is None or not failed_result.is_error:
            continue
        recovery = next(
            (
                later for later in ordered_calls[ordered_calls.index(failed) + 1:ordered_calls.index(failed) + 4]
                if later.line > failed_result.line
                and later.name == failed.name
                and later.signature != failed.signature
                and (result := results.get(later.tool_id)) is not None
                and not result.is_error
            ),
            None,
        )
        if recovery is None:
            continue
        success = results[recovery.tool_id]
        delta = _input_delta(failed.input, recovery.input)
        error = _error_excerpt(failed_result.content)
        candidates.append(Candidate(
            lesson=(f"WORKED: retry {failed.name} after an error; changed {delta}. "
                    f"ERROR: {error}."),
            confidence="med",
            evidence=f"{source_file}:L{failed.line}-L{success.line}",
            source_session=source_session,
            reason="inferred bounded retry with changed input",
            date=failed.date,
        ))
    return candidates


def _explicit_candidates(records: list[tuple[int, dict[str, Any]]], source_session: str, source_file: str) -> list[Candidate]:
    candidates: list[Candidate] = []
    for line, record in records:
        if record.get("type") != "assistant":
            continue
        for block in _content_blocks(record):
            if block.get("type") != "text":
                continue
            text = block.get("text")
            if not isinstance(text, str):
                continue
            for text_line in text.splitlines():
                match = _EXPLICIT_LESSON.match(_one_line(text_line))
                if match is None:
                    continue
                prefix, detail = match.groups()
                detail = _one_line(detail).rstrip("?.")
                if detail:
                    candidates.append(Candidate(
                        lesson=f"{prefix}: {detail}.", confidence="high",
                        evidence=f"{source_file}:L{line}", source_session=source_session,
                        reason="explicit assistant-stated lesson", date=_date(record),
                    ))
    return candidates


def mine_transcript(transcript: Path | str) -> list[Candidate]:
    """Return unique candidate ADDs from a JSONL transcript; reads only."""
    path = Path(transcript)
    records = _records(path)
    source_session = path.stem
    source_file = path.name
    candidates = _retry_candidates(records, source_session, source_file)
    candidates.extend(_explicit_candidates(records, source_session, source_file))
    unique: list[Candidate] = []
    seen: set[str] = set()
    for candidate in candidates:
        if candidate.lesson not in seen:
            seen.add(candidate.lesson)
            unique.append(candidate)
    return unique


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    mine = commands.add_parser("mine", help="mine a transcript into candidate lessons as JSON")
    mine.add_argument("transcript", type=Path)
    args = parser.parse_args(argv)
    if args.command == "mine":
        json.dump([asdict(candidate) for candidate in mine_transcript(args.transcript)], sys.stdout)
        sys.stdout.write("\n")
        return 0
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
