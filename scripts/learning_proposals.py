"""The sole Markdown parser/renderer for kb learning-proposal records (P4 plan section 3.1).

One UTF-8 Markdown file under ``docs/proposals/learnings/`` is one record, named
``<created-date>-<id>.md``. The grammar is closed: exactly the eleven frontmatter keys in
exactly that order, one ``---`` delimiter, one ``## Evidence`` block of 1-20
``{path, locator}`` rows, and one non-empty ``## Proposed change`` block of at most 8 KiB.

``content-hash`` binds the id to the record body [P4 W1 review M2]. The plan pins the id
grammar (``<source-agent>-<source-run>-<two-digit ordinal>``, §3.1 + P4-C31), so the ordinal
stays positional and the body digest is carried explicitly instead: every read recomputes
``sha256`` over the canonical candidate body (kind, target, evidence, proposed change) and
refuses the record if the declared hash disagrees. A body edited under a reused id/path — the
same-run, same-date overwrite the positional ordinal cannot detect — fails closed at READ time.

Three properties this module guarantees, because server code depends on them:

* **JSON only.** The CLI prints one JSON document on stdout and nothing else; refusals print
  a JSON error object on stderr and exit 2.
* **No proposal-file write.** Rendering returns text. Publishing is the server-owned
  publisher's job; nothing here creates, mutates, or deletes a file.
* **Inert Evidence.** Evidence paths and locators are returned as plain strings. There is no
  callback, no shell, and no interpreter hook anywhere in the parse path, so imperative prose
  inside a record is data and can never become an instruction.

CLI::

    py -3 scripts/learning_proposals.py read  --root <coordinationRoot>
    py -3 scripts/learning_proposals.py parse --file <record.md>
    py -3 scripts/learning_proposals.py build            # candidate JSON on stdin
"""
from __future__ import annotations

import argparse
import datetime as _datetime
import hashlib
import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

SCHEMA = "kb.learning-proposal/v1"

KINDS: tuple[str, ...] = (
    "lesson", "agent-improvement", "grade-finding", "model-audit", "hygiene", "context-lifecycle",
)
IMPLEMENTABLE_KINDS: tuple[str, ...] = ("agent-improvement", "lesson")

FRONTMATTER_KEYS: tuple[str, ...] = (
    "schema", "id", "kind", "source-agent", "source-run", "created-at", "target", "status",
    "batch-id", "implemented-at", "content-hash",
)
WIRE_KEYS: tuple[str, ...] = (*FRONTMATTER_KEYS, "evidence", "proposed-change")

RECORD_DIR = "docs/proposals/learnings"
DELIMITER = "---"
EVIDENCE_HEADING = "## Evidence"
CHANGE_HEADING = "## Proposed change"
PATH_PREFIX = "- path: "
LOCATOR_PREFIX = "  locator: "

CANDIDATE_CAP = 5
MIN_EVIDENCE_ROWS = 1
MAX_EVIDENCE_ROWS = 20
MAX_PROPOSED_CHANGE_BYTES = 8192
MAX_RECORD_BYTES = 65536
MAX_RECORDS_PER_DIRECTORY = 500
MAX_PATH_BYTES = 256
MAX_LOCATOR_BYTES = 512

SOURCE_AGENT_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
SOURCE_RUN_RE = re.compile(r"^run[-_][A-Za-z0-9][A-Za-z0-9._-]{0,94}$")
UTC_SECOND_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
BATCH_ID_RE = re.compile(r"^learn-[0-9a-f]{24}$")
RELPATH_RE = re.compile(r"^[A-Za-z0-9._][A-Za-z0-9._/-]*$")
RECORD_NAME_RE = re.compile(r"^\d{4}-\d{2}-\d{2}-[A-Za-z0-9._-]+\.md$")
CONTENT_HASH_RE = re.compile(r"^[0-9a-f]{64}$")
YAML_SIGILS = "*&!|>%@`{}[]\"'#,?:"
# Anchored to line starts, and only consulted when line 1 is not this schema's frontmatter key,
# so a record whose proposed change QUOTES `## ADD ` or `operation: ADD` is not mistaken for the
# old multi-ADD format.
LEGACY_MARKERS = ("# Proposed lessons", "## ADD ", "operation: ADD")

# Characters refused in every decoded string field (locator, proposed change, frontmatter values):
# C0 controls, DEL, the JS line terminators, NEL, the zero-width/BOM pair, and the bidi overrides.
# `_reject_control_bytes` scans the RAW record, so this closed set is what stops the same bytes
# arriving JSON-escaped inside a quoted locator and decoding into live string content.
DISALLOWED_DECODED = frozenset(
    {*range(0x00, 0x20), 0x7F, 0x85, 0x200B, 0x2028, 0x2029, 0xFEFF,
     0x202A, 0x202B, 0x202C, 0x202D, 0x202E},
)


class ProposalError(ValueError):
    """A structural refusal. ``code`` names the rule that fired; the message stays bounded."""

    def __init__(self, code: str, detail: str, source: str = "") -> None:
        super().__init__(f"{code}: {detail}" + (f" [{source}]" if source else ""))
        self.code = code
        self.detail = detail
        self.source = source


def _fail(code: str, detail: str, source: str = "") -> ProposalError:
    return ProposalError(code, detail, source)


# --- scalar validation --------------------------------------------------------------


def content_digest(
    kind: str, target: str, evidence: Sequence[Mapping[str, str]], proposed_change: str,
) -> str:
    """sha256 over the canonical candidate body — the four fields an id is supposed to name.

    Excludes `status`, `batch-id` and `implemented-at`, which the publisher legitimately changes
    when a record is implemented, and the id inputs themselves (`source-agent`/`source-run`/
    `created-at`), which are fixed for a fire.
    """
    canonical = json.dumps(
        {"kind": kind, "target": target,
         "evidence": [{"path": row["path"], "locator": row["locator"]} for row in evidence],
         "proposed-change": proposed_change},
        sort_keys=True, separators=(",", ":"), ensure_ascii=False,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _reject_control_bytes(text: str, source: str) -> None:
    for character in text:
        codepoint = ord(character)
        if character != "\n" and (codepoint < 0x20 or codepoint == 0x7F):
            raise _fail("control-byte", f"U+{codepoint:04X} is not allowed in a record", source)


def _reject_decoded_controls(field: str, value: str, source: str, *, allow_newline: bool = False) -> str:
    """Refuse the closed disallowed set in an already-DECODED string.

    ``_reject_control_bytes`` only sees the raw record, so a JSON-escaped ``\\u0000`` or ``\\u001b``
    inside a quoted locator passes it and decodes into live content. Every decoded field runs
    through here, and the refusal names the offending codepoint only — never the attacker's bytes.
    """
    for character in value:
        codepoint = ord(character)
        if allow_newline and character == "\n":
            continue
        if codepoint in DISALLOWED_DECODED:
            raise _fail(field, f"U+{codepoint:04X} is not allowed in a record field", source)
    return value


def _plain_scalar(key: str, value: str, source: str) -> str:
    if value != value.strip() or not value:
        raise _fail("frontmatter", f"`{key}` needs one trimmed non-empty scalar", source)
    if value[0] in YAML_SIGILS:
        raise _fail("yaml-scalar", f"`{key}` may not start with `{value[0]}`", source)
    return _reject_decoded_controls("frontmatter", value, source)


def _relpath(kind: str, value: str, source: str) -> str:
    if not value or len(value.encode("utf-8")) > MAX_PATH_BYTES:
        raise _fail(kind, "one bounded repository-relative path required", source)
    _reject_decoded_controls(kind, value, source)
    if not RELPATH_RE.match(value) or value.endswith("/") or "//" in value:
        # The refused text is never echoed: a rejected path can carry bidi/zero-width bytes, and
        # this detail is spliced into a JS Error message and audit rows downstream.
        raise _fail(kind, f"a normalized repository-relative path is required ({len(value)} chars)", source)
    if any(segment in ("", ".", "..") for segment in value.split("/")):
        raise _fail(kind, "dot segments are not allowed in a path", source)
    return value


def _utc_second(key: str, value: str, source: str) -> str:
    if not UTC_SECOND_RE.match(value):
        raise _fail(key, "a canonical UTC second (YYYY-MM-DDTHH:MM:SSZ) is required", source)
    try:
        _datetime.datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ")
    except ValueError as error:
        raise _fail(key, "the timestamp is not a real UTC instant", source) from error
    return value


def _ordinal_of(record_id: str, source_agent: str, source_run: str, source: str) -> int:
    prefix = f"{source_agent}-{source_run}-"
    tail = record_id[len(prefix):] if record_id.startswith(prefix) else ""
    if not re.fullmatch(r"\d{2}", tail):
        raise _fail("id", "id must be <source-agent>-<source-run>-<two-digit ordinal>", source)
    ordinal = int(tail)
    if not 1 <= ordinal <= CANDIDATE_CAP:
        raise _fail("id", f"ordinal must be 1..{CANDIDATE_CAP}", source)
    return ordinal


# --- parse --------------------------------------------------------------------------


def _parse_evidence(lines: Sequence[str], start: int, source: str) -> tuple[list[dict[str, str]], int]:
    rows: list[dict[str, str]] = []
    index = start
    while index < len(lines) and lines[index].startswith(PATH_PREFIX):
        path = _relpath("evidence-path", lines[index][len(PATH_PREFIX):], source)
        index += 1
        if index >= len(lines) or not lines[index].startswith(LOCATOR_PREFIX):
            raise _fail("evidence", "every `- path:` row needs one `  locator:` row", source)
        raw = lines[index][len(LOCATOR_PREFIX):]
        if len(raw) < 2 or not raw.startswith('"') or not raw.endswith('"'):
            raise _fail("evidence", "a locator must be one double-quoted string", source)
        try:
            locator = json.loads(raw)
        except json.JSONDecodeError as error:
            raise _fail("evidence", "the locator is not a valid quoted string", source) from error
        if not isinstance(locator, str) or len(locator.encode("utf-8")) > MAX_LOCATOR_BYTES:
            raise _fail("evidence", "a locator must be one bounded string", source)
        _reject_decoded_controls("evidence-locator", locator, source)
        rows.append({"path": path, "locator": locator})
        index += 1
    if not MIN_EVIDENCE_ROWS <= len(rows) <= MAX_EVIDENCE_ROWS:
        raise _fail("evidence", f"{MIN_EVIDENCE_ROWS}..{MAX_EVIDENCE_ROWS} evidence rows required", source)
    return rows, index


def parse_record(text: str, source: str = "") -> dict[str, Any]:
    """Parse one record body into the closed wire dict. Anything else raises ``ProposalError``."""
    if not isinstance(text, str):
        raise _fail("record", "one UTF-8 string required", source)
    if len(text.encode("utf-8")) > MAX_RECORD_BYTES:
        raise _fail("record", f"a record is at most {MAX_RECORD_BYTES} bytes", source)
    if not text.startswith(f"schema: {SCHEMA}\n") and any(
        line.startswith(marker) for line in text.split("\n") for marker in LEGACY_MARKERS
    ):
        raise _fail("legacy-multi-add", "the old multi-ADD proposal format is not a record", source)
    _reject_control_bytes(text, source)
    if not text.endswith("\n") or text.endswith("\n\n"):
        raise _fail("record", "a record ends with exactly one newline", source)

    lines = text.split("\n")
    if len(lines) < len(FRONTMATTER_KEYS) + 5:
        raise _fail("record", "the record is shorter than the closed grammar", source)

    values: dict[str, str] = {}
    for index, key in enumerate(FRONTMATTER_KEYS):
        prefix = f"{key}: "
        if not lines[index].startswith(prefix):
            raise _fail("frontmatter", f"line {index + 1} must be `{key}: <value>`", source)
        values[key] = _plain_scalar(key, lines[index][len(prefix):], source)

    delimiter_index = len(FRONTMATTER_KEYS)
    if lines[delimiter_index] != DELIMITER:
        raise _fail("delimiter", "line 11 must be the single `---` delimiter", source)
    if DELIMITER in lines[delimiter_index + 1:]:
        raise _fail("delimiter", "a record carries exactly one `---` delimiter", source)
    if lines[delimiter_index + 1] != EVIDENCE_HEADING:
        raise _fail("evidence", f"line 12 must be `{EVIDENCE_HEADING}`", source)

    evidence, index = _parse_evidence(lines, delimiter_index + 2, source)
    if index >= len(lines) or lines[index] != CHANGE_HEADING:
        raise _fail("proposed-change", f"the evidence block is followed by `{CHANGE_HEADING}`", source)
    proposed_change = "\n".join(lines[index + 1:-1])
    if not proposed_change or proposed_change != proposed_change.strip():
        raise _fail("proposed-change", "one non-empty, trimmed proposed change required", source)
    if len(proposed_change.encode("utf-8")) > MAX_PROPOSED_CHANGE_BYTES:
        raise _fail("proposed-change", f"at most {MAX_PROPOSED_CHANGE_BYTES} bytes", source)
    _reject_decoded_controls("proposed-change", proposed_change, source, allow_newline=True)

    if values["schema"] != SCHEMA:
        raise _fail("schema", f"expected {SCHEMA}", source)
    if values["kind"] not in KINDS:
        raise _fail("kind", "one of the six closed kinds required", source)
    source_agent = values["source-agent"]
    if not SOURCE_AGENT_RE.match(source_agent) or len(source_agent.encode("utf-8")) > 64:
        raise _fail("source-agent", "a lowercase dash-separated token of 1-64 bytes required", source)
    if not SOURCE_RUN_RE.match(values["source-run"]):
        raise _fail("source-run", "run[-_]<ref> required", source)
    created_at = _utc_second("created-at", values["created-at"], source)
    target = _relpath("target", values["target"], source)
    if values["status"] not in ("proposed", "implemented"):
        raise _fail("status", "`proposed` or `implemented` required", source)
    batch_id = None if values["batch-id"] == "null" else values["batch-id"]
    if batch_id is not None and not BATCH_ID_RE.match(batch_id):
        raise _fail("batch-id", "`null` or learn-<24 hex> required", source)
    implemented_at = None if values["implemented-at"] == "null" else _utc_second(
        "implemented-at", values["implemented-at"], source,
    )
    if values["status"] == "proposed" and (batch_id is not None or implemented_at is not None):
        raise _fail("status", "a proposed record carries no batch-id or implemented-at", source)
    if values["status"] == "implemented" and (batch_id is None or implemented_at is None):
        raise _fail("status", "an implemented record carries both batch-id and implemented-at", source)
    _ordinal_of(values["id"], source_agent, values["source-run"], source)
    content_hash = values["content-hash"]
    if not CONTENT_HASH_RE.match(content_hash):
        raise _fail("content-hash", "64 lowercase hex characters required", source)
    expected = content_digest(values["kind"], target, evidence, proposed_change)
    if content_hash != expected:
        # The plan pins the id grammar, so the ordinal is positional: this is the only read-time
        # detector for a body changed under a reused id (same run, same date, same path).
        raise _fail("content-hash", "the declared body digest does not match the record body", source)

    return {
        "schema": SCHEMA, "id": values["id"], "kind": values["kind"], "source-agent": source_agent,
        "source-run": values["source-run"], "created-at": created_at, "target": target,
        "status": values["status"], "batch-id": batch_id, "implemented-at": implemented_at,
        "content-hash": content_hash, "evidence": evidence, "proposed-change": proposed_change,
    }


# --- render -------------------------------------------------------------------------


def record_relpath(record: Mapping[str, Any]) -> str:
    """``docs/proposals/learnings/<created-date>-<id>.md``; the date is created-at's first ten bytes."""
    created_at = _utc_second("created-at", str(record["created-at"]), "")
    return f"{RECORD_DIR}/{created_at[:10]}-{record['id']}.md"


def render_record(record: Mapping[str, Any]) -> str:
    """Render one record body. Deterministic, and re-parsed before it is returned."""
    missing = [key for key in WIRE_KEYS if key not in record]
    if missing or len(record) != len(WIRE_KEYS):
        raise _fail("record", "exactly the closed wire keys are required", "")
    lines = [
        f"{key}: {'null' if record[key] is None else record[key]}" for key in FRONTMATTER_KEYS
    ]
    lines.append(DELIMITER)
    lines.append(EVIDENCE_HEADING)
    for row in record["evidence"]:
        if set(row) != {"path", "locator"}:
            raise _fail("evidence", "an evidence row is exactly {path, locator}", "")
        lines.append(f"{PATH_PREFIX}{row['path']}")
        lines.append(f"{LOCATOR_PREFIX}{json.dumps(row['locator'], ensure_ascii=False)}")
    lines.append(CHANGE_HEADING)
    lines.append(str(record["proposed-change"]))
    text = "\n".join(lines) + "\n"
    parse_record(text, source=str(record.get("id", "")))
    return text


# --- deterministic candidate ordering ------------------------------------------------


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _normalize_candidate(candidate: Mapping[str, Any], source: str) -> dict[str, Any]:
    if set(candidate) != {"kind", "target", "evidence", "proposed-change"}:
        raise _fail("candidate", "a candidate is exactly {kind, target, evidence, proposed-change}", source)
    if candidate["kind"] not in KINDS:
        raise _fail("kind", "one of the six closed kinds required", source)
    rows = candidate["evidence"]
    if not isinstance(rows, list) or not MIN_EVIDENCE_ROWS <= len(rows) <= MAX_EVIDENCE_ROWS:
        raise _fail("evidence", f"{MIN_EVIDENCE_ROWS}..{MAX_EVIDENCE_ROWS} evidence rows required", source)
    evidence = []
    for row in rows:
        if not isinstance(row, Mapping) or set(row) != {"path", "locator"}:
            raise _fail("evidence", "an evidence row is exactly {path, locator}", source)
        if not isinstance(row["locator"], str):
            raise _fail("evidence", "a locator must be one string", source)
        evidence.append({"path": _relpath("evidence-path", str(row["path"]), source),
                         "locator": row["locator"]})
    change = candidate["proposed-change"]
    if not isinstance(change, str):
        raise _fail("proposed-change", "one string required", source)
    return {
        "kind": candidate["kind"], "target": _relpath("target", str(candidate["target"]), source),
        "evidence": evidence, "proposed-change": change,
    }


def _ordinal_sort_key(candidate: Mapping[str, Any]) -> tuple[str, str, str, str]:
    evidence = json.dumps(candidate["evidence"], sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return (candidate["kind"], candidate["target"], _digest(candidate["proposed-change"]), _digest(evidence))


def build_records(
    *, source_agent: str, source_run: str, created_at: str, candidates: Iterable[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    """Assign ordinals and ids deterministically. Rerunning one fire renders identical bytes."""
    listed = list(candidates)
    if len(listed) > CANDIDATE_CAP:
        raise _fail("candidate-cap", f"a fire emits at most {CANDIDATE_CAP} candidates", source_run)
    if not SOURCE_AGENT_RE.match(source_agent) or len(source_agent.encode("utf-8")) > 64:
        raise _fail("source-agent", "a lowercase dash-separated token of 1-64 bytes required", source_run)
    if not SOURCE_RUN_RE.match(source_run):
        raise _fail("source-run", "run[-_]<ref> required", source_run)
    _utc_second("created-at", created_at, source_run)

    normalized = sorted(
        (_normalize_candidate(candidate, source_run) for candidate in listed), key=_ordinal_sort_key,
    )
    keys = [_ordinal_sort_key(candidate) for candidate in normalized]
    if len(set(keys)) != len(keys):
        raise _fail("duplicate-candidate", "two candidates of one fire are indistinguishable", source_run)

    records: list[dict[str, Any]] = []
    for ordinal, candidate in enumerate(normalized, start=1):
        record = {
            "schema": SCHEMA, "id": f"{source_agent}-{source_run}-{ordinal:02d}",
            "kind": candidate["kind"], "source-agent": source_agent, "source-run": source_run,
            "created-at": created_at, "target": candidate["target"], "status": "proposed",
            "batch-id": None, "implemented-at": None,
            "content-hash": content_digest(
                candidate["kind"], candidate["target"], candidate["evidence"],
                candidate["proposed-change"],
            ),
            "evidence": candidate["evidence"], "proposed-change": candidate["proposed-change"],
        }
        render_record(record)
        records.append(record)
    return records


# --- bounded directory read ----------------------------------------------------------


def read_record_file(path: str) -> dict[str, Any]:
    """Parse one record file under the same walls `read_records` applies to a directory entry.

    A reparse point anywhere in the resolved path, an over-budget file, or unreadable UTF-8 fails
    closed before a single byte reaches the grammar.
    """
    if not path:
        raise _fail("record", "one record path is required", "")
    resolved = os.path.realpath(path)
    if resolved != os.path.abspath(path) or os.path.islink(path):
        raise _fail("reparse-point", "the record path must not traverse a symlink or reparse point", "")
    if not os.path.isfile(resolved):
        raise _fail("record", "the record path is not a file", "")
    if os.path.getsize(resolved) > MAX_RECORD_BYTES:
        raise _fail("record", f"a record is at most {MAX_RECORD_BYTES} bytes", "")
    try:
        text = Path(resolved).read_bytes().decode("utf-8")
    except (OSError, UnicodeDecodeError) as error:
        raise _fail("record", "a record must be readable UTF-8", "") from error
    return parse_record(text, source=os.path.basename(resolved))


def read_records(coordination_root: str) -> list[dict[str, Any]]:
    """Read every record under ``<coordination_root>/docs/proposals/learnings``, or fail closed.

    A missing directory is an empty result. A reparse point anywhere in the resolved path, a
    filename that disagrees with its record, a duplicate id, or one malformed record fails the
    whole read. Nothing is written.
    """
    if not coordination_root or not os.path.isabs(coordination_root):
        raise _fail("root", "an absolute coordination root is required", "")
    base = os.path.realpath(coordination_root)
    anchor = os.path.join(base, *RECORD_DIR.split("/"))
    if not os.path.lexists(anchor):
        return []
    if os.path.realpath(anchor) != anchor:
        raise _fail("reparse-point", "the learnings directory must resolve inside the root", "")
    if not os.path.isdir(anchor):
        raise _fail("root", "the learnings path is not a directory", "")

    names = sorted(os.listdir(anchor))
    if len(names) > MAX_RECORDS_PER_DIRECTORY:
        raise _fail("record-cap", f"at most {MAX_RECORDS_PER_DIRECTORY} records are read", "")
    records: list[dict[str, Any]] = []
    seen: set[str] = set()
    for name in names:
        full = os.path.join(anchor, name)
        if os.path.islink(full) or os.path.realpath(full) != full:
            raise _fail("reparse-point", f"`{name}` is a symlink or reparse point", name)
        if not RECORD_NAME_RE.match(name) or not os.path.isfile(full):
            raise _fail("record-name", f"`{name}` is not a `<created-date>-<id>.md` record", name)
        if os.path.getsize(full) > MAX_RECORD_BYTES:
            raise _fail("record", f"a record is at most {MAX_RECORD_BYTES} bytes", name)
        try:
            text = Path(full).read_bytes().decode("utf-8")
        except (OSError, UnicodeDecodeError) as error:
            raise _fail("record", "a record must be readable UTF-8", name) from error
        record = parse_record(text, source=name)
        if record_relpath(record) != f"{RECORD_DIR}/{name}":
            raise _fail("record-name", "the filename must be <created-date>-<id>.md", name)
        if record["id"] in seen:
            raise _fail("duplicate-id", f"id {record['id']} appears more than once", name)
        seen.add(record["id"])
        records.append(record)
    return sorted(records, key=lambda record: record["id"])


# --- JSON-only CLI --------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Learning-proposal parser/renderer; JSON only.")
    commands = parser.add_subparsers(dest="command", required=True)
    read = commands.add_parser("read", help="read every record under a coordination root")
    read.add_argument("--root", required=True)
    single = commands.add_parser("parse", help="parse one record file")
    single.add_argument("--file", required=True)
    commands.add_parser("build", help="build records from candidate JSON on stdin")
    args = parser.parse_args(argv)

    try:
        if args.command == "read":
            payload: Any = read_records(args.root)
        elif args.command == "parse":
            payload = read_record_file(args.file)
        else:
            request = json.loads(sys.stdin.read())
            records = build_records(
                source_agent=request["source-agent"], source_run=request["source-run"],
                created_at=request["created-at"], candidates=request.get("candidates", []),
            )
            payload = [
                {"path": record_relpath(record), "body": render_record(record), "record": record}
                for record in records
            ]
    except ProposalError as error:
        json.dump({"code": error.code, "detail": error.detail, "source": error.source}, sys.stderr)
        return 2
    except (OSError, UnicodeDecodeError, KeyError, TypeError, ValueError) as error:
        json.dump({"code": "input", "detail": type(error).__name__, "source": ""}, sys.stderr)
        return 2
    json.dump(payload, sys.stdout, ensure_ascii=False, sort_keys=False)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
