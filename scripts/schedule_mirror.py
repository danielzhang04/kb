#!/usr/bin/env python3
"""Dashboard v3 P4 section 3.5 — the schedule-mirror renderer.

The mirror is a FIELD-LEVEL row updater, not a block renderer. A HEARTBEAT cadence entry is owned by
the file, not by the store: `scripts/dispatch.py` reads `prompt:`/`tier:`/`risk-tier:` out of it and
`server/schedules/seedImport.ts` derives every schedule id from the cadence `- name:`. So the mirror
locates each store row by that name and rewrites ONLY the `schedule:` and `armed:` values in place
(adding `armed:` when genuinely absent, and touching `agent:` only when the line already exists).
Every other byte of the file — prompt blocks, tiers, comments, blank lines — survives untouched.

A store row that did not originate from a seed import (no `launchPayload.cadenceName`, so `name` is
null here) has no identity in the file and is SKIPPED per-row; so is a row whose name matches nothing
in the file, or whose fields exceed the mirror bounds. A skip never rejects the batch.
(Write-boundary validation of these fields is W6.3's; here an over-bound field only loses its row.)

Each rendered file is re-parsed with a `parseHeartbeatSeeds`-compatible parser before it is returned:
the seed identity set and the `prompt:`/`tier:`/`risk-tier:` key counts must be unchanged, or the
whole path render is refused.

Input (stdin, JSON):  {"paths": [{"path", "bytes", "rows": [{id, name, schedule, agent, armed}]}]}
Output (stdout, JSON):
  {"ok": true,  "paths": [{"path", "content", "digest", "changed", "skipped": [...]}]}
  {"ok": false, "code": <reject code>, "path": <path or null>}
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from typing import Any

# The mirrored-row field set, in the order the protocol carries it. Both sides of the mirror pin the
# same tuple (tests/fixtures/dashboard-v3-p4-mirror-vectors.json enforces the parity).
MIRROR_ROW_FIELDS = ("id", "name", "schedule", "agent", "armed")
# The only field values the mirror ever writes into a HEARTBEAT file.
MIRROR_WRITTEN_FIELDS = ("schedule", "armed", "agent")
# Keys the mirror must never disturb; their per-file counts are asserted after every render.
PRESERVED_KEYS = ("prompt", "tier", "risk-tier")

MAX_CHANGED_FILES = 32
MAX_ROWS_PER_PATH = 200
MAX_FIELD_CHARS = 200
MAX_INPUT_BYTES = 1_048_576

SCHEDULE_ID = re.compile(r"^[0-9a-f]{64}$")
ORG_MIRROR_PATH = re.compile(r"^orgs/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?/HEARTBEAT\.md$")
FENCE_OPEN = re.compile(r"^```ya?ml[ \t]*$")
FENCE_CLOSE = re.compile(r"^```[ \t]*$")
ENTRY_LINE = re.compile(r"^(\s*)-\s+name:\s*([^\n#]+?)\s*$")
FIELD_LINE = re.compile(r"^(\s*)([a-z][\w-]*):\s*([^\n#]*?)\s*$", re.IGNORECASE)
BLOCK_INDICATORS = ("|", ">", "|-", ">-", "|+", ">+")
# A value the mirror may emit unquoted, matching the convention the real HEARTBEAT files already use
# (`daily`, `weekly:sat`); everything else — cron expressions above all — is double-quoted.
PLAIN_VALUE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]*(?::[A-Za-z0-9._/-]+)?$")
YAML_RESERVED_PLAIN = {"true", "false", "null", "yes", "no", "on", "off", "~"}


def body_of(line: str) -> str:
    """One source line without its terminator. Mirror files may be CRLF; the mirror preserves that."""
    return line.rstrip("\r\n")


def eol_of(line: str) -> str:
    return line[len(body_of(line)):] or "\n"


class Reject(Exception):
    def __init__(self, code: str, path: str | None = None) -> None:
        super().__init__(code)
        self.code = code
        self.path = path


def is_safe_value(value: str) -> bool:
    """A mirrored value is printable single-line ASCII with no YAML or Markdown escape hazard.

    `seedImport.parseSeedFile` strips quotes without unescaping, so an escaped scalar would not round
    trip through the real consumer. The mirror therefore refuses to write anything that would need an
    escape at all — the row is skipped instead.
    """
    if value == "" or value != value.strip():
        return False
    return all(0x20 <= ord(char) <= 0x7E and char not in '"\\`#' for char in value)


def render_value(value: str) -> str:
    if PLAIN_VALUE.match(value) and value.lower() not in YAML_RESERVED_PLAIN:
        return value
    return f'"{value}"'


def unquote(value: str) -> str:
    """Exactly `seedImport.ts#unquote`: strip one matching quote pair, no unescaping."""
    trimmed = value.strip()
    if len(trimmed) >= 2 and trimmed[0] == trimmed[-1] and trimmed[0] in ('"', "'"):
        return trimmed[1:-1]
    return trimmed


def validate_path(path: Any) -> str:
    if not isinstance(path, str) or path in ("", "."):
        raise Reject("invalid-mirror-path", path if isinstance(path, str) else None)
    if path == "HEARTBEAT.md":
        return path
    if ".." in path.split("/") or "\\" in path or path.startswith("/"):
        raise Reject("invalid-mirror-path", path)
    if not ORG_MIRROR_PATH.match(path):
        raise Reject("invalid-mirror-path", path)
    return path


def validate_row(entry: Any, path: str) -> dict:
    """Shape validation only. Bound and safety failures are per-row skips, decided by `plan_edits`."""
    if not isinstance(entry, dict):
        raise Reject("malformed-row-field", path)
    for key in entry:
        if key not in MIRROR_ROW_FIELDS:
            raise Reject("unknown-row-field", path)
    for key in MIRROR_ROW_FIELDS:
        if key not in entry:
            raise Reject("missing-row-field", path)
    if not isinstance(entry["schedule"], str):
        raise Reject("malformed-row-field", path)
    for key in ("name", "agent"):
        if entry[key] is not None and not isinstance(entry[key], str):
            raise Reject("malformed-row-field", path)
    if not isinstance(entry["armed"], bool):
        raise Reject("malformed-row-field", path)
    if not isinstance(entry["id"], str) or not SCHEDULE_ID.match(entry["id"]):
        raise Reject("malformed-schedule-id", path)
    return {key: entry[key] for key in MIRROR_ROW_FIELDS}


def locate_fence(lines: list[str], path: str) -> tuple[int, int]:
    """Return the (open, close) line indices of the single fenced YAML block."""
    opens = [index for index, line in enumerate(lines) if FENCE_OPEN.match(body_of(line))]
    if not opens:
        raise Reject("missing-cadences-block", path)
    if len(opens) > 1:
        raise Reject("duplicate-yaml-block", path)
    open_index = opens[0]
    for index in range(open_index + 1, len(lines)):
        if FENCE_CLOSE.match(body_of(lines[index])):
            return open_index, index
    raise Reject("unterminated-yaml-block", path)


class Entry:
    __slots__ = ("name", "indent", "child_indent", "start", "end", "fields")

    def __init__(self, name: str, indent: int, start: int) -> None:
        self.name = name
        self.indent = indent
        self.child_indent = indent + 2
        self.start = start
        self.end = start + 1
        self.fields: dict[str, int] = {}


def parse_entries(lines: list[str], open_index: int, close_index: int) -> list[Entry]:
    """Locate cadence entries and the line index of each of their scalar child fields.

    Block scalars (`prompt: |`) are consumed whole, so nothing inside a prompt can be mistaken for a
    field of the entry. The entry's own span ends at the next entry of the same indent.
    """
    entries: list[Entry] = []
    current: Entry | None = None
    index = open_index + 1
    while index < close_index:
        body = body_of(lines[index])
        match = ENTRY_LINE.match(body)
        if match:
            if current is not None:
                current.end = index
            current = Entry(unquote(match.group(2)), len(match.group(1)), index)
            entries.append(current)
            index += 1
            continue
        if current is not None:
            field = FIELD_LINE.match(body)
            if field and len(field.group(1)) == current.child_indent:
                key = field.group(2)
                value = field.group(3).strip()
                if key not in current.fields:
                    current.fields[key] = index
                if value in BLOCK_INDICATORS:
                    index += 1
                    while index < close_index:
                        inner = body_of(lines[index])
                        if inner.strip() != "" and len(inner) - len(inner.lstrip(" ")) <= current.child_indent:
                            break
                        index += 1
                    continue
        index += 1
    if current is not None:
        current.end = close_index
    return entries


def parse_seeds_compatible(text: str, path: str) -> list[dict]:
    """A `parseHeartbeatSeeds`-compatible read of a rendered file, used as the render self-check.

    Deliberately re-implements `seedImport.ts#parseSeedFile`'s rules — first fenced yaml block, entry
    per `- name:`, scalar children at exactly indent+2, block indicators excluded — so the self-check
    sees the file the way the real importer will.
    """
    fence = re.search(r"```ya?ml[ \t]*\r?\n([\s\S]*?)```", text)
    if not fence:
        return []
    normalized = fence.group(1).replace("\r\n", "\n").replace("\r", "\n")
    lines = normalized.split("\n")
    starts = []
    for index, line in enumerate(lines):
        match = ENTRY_LINE.match(line)
        if match:
            starts.append((index, len(match.group(1)), unquote(match.group(2))))
    seeds = []
    for position, (start, indent, name) in enumerate(starts):
        following = [item for item in starts[position + 1:] if item[1] == indent]
        end = following[0][0] if following else len(lines)
        fields: dict[str, str] = {}
        for line in lines[start + 1:end]:
            field = FIELD_LINE.match(line)
            if field and len(field.group(1)) == indent + 2 and field.group(3).strip() not in BLOCK_INDICATORS:
                fields.setdefault(field.group(2), unquote(field.group(3)))
        seeds.append({
            "path": path,
            "name": name,
            "schedule": fields.get("schedule"),
            "agent": fields.get("agent"),
            "armed": fields.get("armed"),
        })
    return seeds


def preserved_key_counts(text: str) -> dict[str, int]:
    counts = {key: 0 for key in PRESERVED_KEYS}
    for line in text.splitlines():
        field = FIELD_LINE.match(line)
        if field and field.group(2) in counts:
            counts[field.group(2)] += 1
    return counts


def plan_edits(
    rows: list[dict],
    entries: list[Entry],
    lines: list[str],
) -> tuple[dict[int, str], dict[int, list[str]], list[dict], dict[str, dict[str, Any]]]:
    """Decide the per-line replacements and `armed:` insertions for one file.

    Returns (replacements by line index, insertions after line index, skipped rows, expectations the
    self-check re-reads out of the rendered bytes).
    """
    by_name: dict[str, list[Entry]] = {}
    for entry in entries:
        by_name.setdefault(entry.name, []).append(entry)

    replacements: dict[int, str] = {}
    insertions: dict[int, list[str]] = {}
    skipped: list[dict] = []
    expected: dict[str, dict[str, Any]] = {}
    claimed: set[str] = set()

    def skip(row: dict, reason: str) -> None:
        skipped.append({"id": row["id"], "name": row["name"], "reason": reason})

    for row in sorted(rows, key=lambda candidate: candidate["id"]):
        name = row["name"]
        if not isinstance(name, str) or name == "":
            skip(row, "not-seed-originated")
            continue
        if len(name) > MAX_FIELD_CHARS or len(row["schedule"]) > MAX_FIELD_CHARS:
            skip(row, "field-too-long")
            continue
        if not is_safe_value(name) or not is_safe_value(row["schedule"]):
            skip(row, "unsafe-field-value")
            continue
        if name in claimed:
            skip(row, "duplicate-store-row")
            continue
        matches = by_name.get(name, [])
        if not matches:
            skip(row, "no-matching-cadence")
            continue
        if len(matches) > 1:
            skip(row, "ambiguous-cadence-name")
            continue
        entry = matches[0]
        schedule_line = entry.fields.get("schedule")
        if schedule_line is None:
            skip(row, "no-schedule-line")
            continue
        claimed.add(name)
        indent = " " * entry.child_indent

        eol = eol_of(lines[schedule_line])
        current = FIELD_LINE.match(body_of(lines[schedule_line]))
        if current is None or unquote(current.group(3)) != row["schedule"]:
            replacements[schedule_line] = f"{indent}schedule: {render_value(row['schedule'])}{eol}"

        armed_text = "true" if row["armed"] else "false"
        armed_line = entry.fields.get("armed")
        if armed_line is None:
            insertions.setdefault(schedule_line, []).append(f"{indent}armed: {armed_text}{eol}")
        else:
            current = FIELD_LINE.match(body_of(lines[armed_line]))
            if current is None or current.group(3).strip() != armed_text:
                replacements[armed_line] = f"{indent}armed: {armed_text}{eol_of(lines[armed_line])}"

        agent = row["agent"]
        agent_line = entry.fields.get("agent")
        if agent_line is not None and isinstance(agent, str) and is_safe_value(agent) and len(agent) <= MAX_FIELD_CHARS:
            current = FIELD_LINE.match(body_of(lines[agent_line]))
            if current is None or unquote(current.group(3)) != agent:
                replacements[agent_line] = f"{indent}agent: {render_value(agent)}{eol_of(lines[agent_line])}"
            expected[name] = {"schedule": row["schedule"], "armed": armed_text, "agent": agent}
        else:
            expected[name] = {"schedule": row["schedule"], "armed": armed_text, "agent": None}

    return replacements, insertions, skipped, expected


def render_path(entry: Any, seen_ids: set[str]) -> dict:
    if not isinstance(entry, dict) or set(entry) != {"path", "bytes", "rows"}:
        raise Reject("malformed-input")
    path = validate_path(entry.get("path"))
    source = entry.get("bytes")
    if not isinstance(source, str):
        raise Reject("malformed-input", path)
    if len(source.encode("utf-8")) > MAX_INPUT_BYTES:
        raise Reject("input-too-large", path)
    raw_rows = entry.get("rows")
    if not isinstance(raw_rows, list):
        raise Reject("malformed-input", path)
    if len(raw_rows) > MAX_ROWS_PER_PATH:
        raise Reject("too-many-rows", path)
    rows = [validate_row(candidate, path) for candidate in raw_rows]
    for candidate in rows:
        if candidate["id"] in seen_ids:
            raise Reject("duplicate-schedule-id", path)
        seen_ids.add(candidate["id"])

    lines = source.splitlines(keepends=True)
    open_index, close_index = locate_fence(lines, path)
    entries = parse_entries(lines, open_index, close_index)
    replacements, insertions, skipped, expected = plan_edits(rows, entries, lines)

    rendered: list[str] = []
    for index, line in enumerate(lines):
        rendered.append(replacements.get(index, line))
        for added in insertions.get(index, []):
            rendered.append(added)
    content = "".join(rendered)

    # Self-check: the rendered bytes must still read, through a parseHeartbeatSeeds-compatible
    # parser, as exactly the same set of seeds, and must not have gained or lost a preserved key.
    before = parse_seeds_compatible(source, path)
    after = parse_seeds_compatible(content, path)
    if [seed["name"] for seed in before] != [seed["name"] for seed in after]:
        raise Reject("render-identity-changed", path)
    if preserved_key_counts(source) != preserved_key_counts(content):
        raise Reject("render-identity-changed", path)
    read_back = {seed["name"]: seed for seed in after}
    for name, want in expected.items():
        seed = read_back.get(name)
        if seed is None or seed["schedule"] != want["schedule"] or seed["armed"] != want["armed"]:
            raise Reject("render-not-round-trippable", path)
        if want["agent"] is not None and seed["agent"] != want["agent"]:
            raise Reject("render-not-round-trippable", path)

    return {
        "path": path,
        "content": content,
        "digest": hashlib.sha256(content.encode("utf-8")).hexdigest(),
        "changed": content != source,
        "skipped": skipped,
    }


def render_batch(payload: Any) -> dict:
    try:
        if not isinstance(payload, dict) or set(payload) != {"paths"}:
            raise Reject("malformed-input")
        paths = payload["paths"]
        if not isinstance(paths, list):
            raise Reject("malformed-input")
        seen_paths: set[str] = set()
        seen_ids: set[str] = set()
        rendered = []
        for item in paths:
            result = render_path(item, seen_ids)
            if result["path"] in seen_paths:
                raise Reject("duplicate-path", result["path"])
            seen_paths.add(result["path"])
            rendered.append(result)
        # The cap counts CHANGED files only; a path the mirror left byte-identical costs nothing.
        if sum(1 for result in rendered if result["changed"]) > MAX_CHANGED_FILES:
            raise Reject("too-many-changed-files")
        return {"ok": True, "paths": rendered}
    except Reject as reject:
        return {"ok": False, "code": reject.code, "path": reject.path}


def main(argv: list[str]) -> int:
    if argv[1:] != ["--render"]:
        json.dump({"ok": False, "code": "unknown-invocation", "path": None}, sys.stdout)
        return 1
    source = sys.stdin.read()
    try:
        payload = json.loads(source)
    except (ValueError, UnicodeDecodeError):
        json.dump({"ok": False, "code": "malformed-input", "path": None}, sys.stdout)
        return 1
    result = render_batch(payload)
    json.dump(result, sys.stdout)
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
