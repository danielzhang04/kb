"""Fail-closed PII checks for repo staging and VM-bound runtime values."""

from __future__ import annotations

import argparse
import html
import ipaddress
import json
import re
import subprocess
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Any
from urllib.parse import unquote


class PIIClass(str, Enum):
    NAME = "name"
    EMAIL = "email"
    PHONE = "phone"
    PROFILE_URL = "profile_url"
    NOTE = "note"
    EXCERPT = "excerpt"
    BODY = "body"


VM_SINKS = frozenset({
    "process_arguments", "process_results", "stdout", "stderr",
    "logs", "cards", "ledgers", "exceptions", "vm_policy",
})
SENSITIVE_FIELDS = {
    "name": PIIClass.NAME,
    "first_name": PIIClass.NAME,
    "full_name": PIIClass.NAME,
    "email": PIIClass.EMAIL,
    "phone": PIIClass.PHONE,
    "profile_url": PIIClass.PROFILE_URL,
    "linkedin_url": PIIClass.PROFILE_URL,
    "person_note": PIIClass.NOTE,
    "note": PIIClass.NOTE,
    "excerpt": PIIClass.EXCERPT,
    "body": PIIClass.BODY,
    "message_body": PIIClass.BODY,
}
EMAIL_RE = re.compile(r"(?i)(?<![\w.+-])[\w.+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+")
PHONE_RE = re.compile(
    r"(?<!\d)(?:(?:\+?1[ .-]?)?(?:\(?\d{3}\)?[ .-]?)\d{3}[ .-]\d{4}"
    r"|(?:\+\d{1,3}|00\d{1,3})[ .()\-]*(?:\d[ .()\-]*){6,12}\d)(?!\d)"
)
PROFILE_RE = re.compile(r"(?i)https?://(?:www\.)?linkedin\.com/in/[a-z0-9_%./-]+")
OPAQUE_TOKEN_RE = re.compile(
    r"(?<![0-9A-Za-z_])(?:"
    r"[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"
    r"|(?:cmp|per|cp|obs|emp|mr|pa|cr|pol|camp|req|apr|rev|rt|run|list|job|snap|del|enr|inb)_[0-9a-f]{8,64}"
    r"|[0-9a-f]{16,64}"
    r"|\d{4}-\d{2}-\d{2}(?:[Tt ][0-2]\d:[0-5]\d(?::[0-5]\d(?:[.,]\d+)?)?(?:[Zz]|[+-][0-2]\d(?::?[0-5]\d)?)?)?"
    r")(?![0-9A-Za-z_])",
    re.IGNORECASE,
)
FIXTURE_OPAQUE_ID_RE = re.compile(
    r"(?<![0-9A-Za-z_])"
    r"(?:cmp|per|cp|obs|emp|mr|pa|cr|pol|camp|req|apr|rev|rt|run|list|job|snap|del|enr|inb)"
    r"_[0-9a-f]{8,64}(?![0-9A-Za-z_])",
    re.IGNORECASE,
)
NOTE_RE = re.compile(r"(?i)\[\[person-note:[^\]]+\]\]")
EXCERPT_RE = re.compile(r"(?i)\[\[source-excerpt:[^\]]+\]\]")
BODY_RE = re.compile(r"(?i)\[\[message-body:[^\]]+\]\]")
JSON_STRING_RE = re.compile(r'"(?:\\.|[^"\\])*"')
STAGING_SSH_IPV4_RE = re.compile(
    r"(?P<quote>['\"])kb@(?P<host>(?:\d{1,3}\.){3}\d{1,3})(?P=quote)"
)
STAGING_SSH_NETWORK = ipaddress.ip_network("100.64.0.0/10")
STAGING_SSH_PATH = "scripts/prospecting/dev_vm.py"
STAGING_NODEIDS_FIXTURE = (
    "orgs/prospecting/fixtures/staging-synthetic-nodeids.json"
)
T1_SYNTHETIC_FIXTURE = "orgs/prospecting/fixtures/t1-synthetic-10.json"
GATE_MANIFEST_PATHS = frozenset({
    "scripts/prospecting/gate_manifest.json",
    "scripts/prospecting/gate_manifest_p2.json",
    "scripts/prospecting/gate_manifest_p3.json",
    "scripts/prospecting/gate_manifest_p4.json",
    "scripts/prospecting/gate_manifest_p5.json",
    "scripts/prospecting/gate_manifest_p6.json",
    "scripts/prospecting/gate_manifest_p8.json",
})
AFFINITY_SENTINEL_PREFIX = (
    "scripts/prospecting/tests/test_affinity_pii_guard.py::"
    "test_the_shared_stdout_boundary_rejects_every_pii_class"
)
STAGING_SENTINEL_PREFIX = (
    "scripts/prospecting/tests/test_pii_guard.py::"
    "test_39b_precommit_blocks_all_marker_classes"
)
FIXTURE_ALLOWLIST = frozenset({
    "orgs/prospecting/fixtures/synthetic.json",
    "orgs/prospecting/fixtures/pii-cases.json",
    "orgs/prospecting/fixtures/conflicting-providers.json",
    "orgs/prospecting/fixtures/job-change.json",
    "orgs/prospecting/fixtures/review-synthetic.json",
    "orgs/prospecting/fixtures/legacy-synthetic.json",
    T1_SYNTHETIC_FIXTURE,
    "orgs/prospecting/fixtures/vendor/snov/email-search-complete.json",
    STAGING_NODEIDS_FIXTURE,
})


class PIIGuardError(ValueError):
    def __init__(self, pii_class: PIIClass, sink: str) -> None:
        self.pii_class = pii_class
        self.sink = sink
        super().__init__(f"VM sink blocked: {sink}:{pii_class.value}")


@dataclass(frozen=True)
class PIIViolation:
    path: str
    line: int
    pii_class: PIIClass | str


class _DuplicateJsonKey(ValueError):
    pass


def _reject_duplicate_json_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, child in pairs:
        if key in value:
            raise _DuplicateJsonKey
        value[key] = child
    return value


def _decoded_forms(text: str) -> tuple[str, ...]:
    forms = [text]
    for _ in range(3):
        decoded = html.unescape(unquote(forms[-1]))
        decoded = re.sub(
            r"\\u([0-9a-fA-F]{4})",
            lambda match: chr(int(match.group(1), 16)),
            decoded,
        )
        if decoded == forms[-1]:
            break
        forms.append(decoded)
    return tuple(forms)


def _mask_opaque_tokens(text: str) -> str:
    return OPAQUE_TOKEN_RE.sub(lambda match: " " * len(match.group(0)), text)


def find_text_classes(
    text: str,
    known_names: tuple[str, ...] = (),
    *,
    mask_opaque_tokens: bool = True,
) -> frozenset[PIIClass]:
    found: set[PIIClass] = set()
    for form in _decoded_forms(text):
        pii_scan_form = _mask_opaque_tokens(form) if mask_opaque_tokens else form
        if EMAIL_RE.search(pii_scan_form):
            found.add(PIIClass.EMAIL)
        if PHONE_RE.search(pii_scan_form):
            found.add(PIIClass.PHONE)
        if PROFILE_RE.search(pii_scan_form):
            found.add(PIIClass.PROFILE_URL)
        if NOTE_RE.search(form):
            found.add(PIIClass.NOTE)
        if EXCERPT_RE.search(form):
            found.add(PIIClass.EXCERPT)
        if BODY_RE.search(form):
            found.add(PIIClass.BODY)
        folded = form.casefold()
        if any(name and name.casefold() in folded for name in known_names):
            found.add(PIIClass.NAME)
    return frozenset(found)


def _walk(
    value: object,
    known_names: tuple[str, ...],
    *,
    mask_opaque_tokens: bool,
) -> PIIClass | None:
    if isinstance(value, dict):
        for key, child in value.items():
            key_violation = _walk(
                key, known_names, mask_opaque_tokens=mask_opaque_tokens
            )
            if key_violation is not None:
                return key_violation
            sensitive = SENSITIVE_FIELDS.get(str(key).casefold())
            if sensitive is not None and child not in (None, "", [], {}):
                return sensitive
            nested = _walk(
                child, known_names, mask_opaque_tokens=mask_opaque_tokens
            )
            if nested is not None:
                return nested
    elif isinstance(value, (list, tuple, set)):
        for child in value:
            nested = _walk(
                child, known_names, mask_opaque_tokens=mask_opaque_tokens
            )
            if nested is not None:
                return nested
    elif isinstance(value, str):
        found = find_text_classes(
            value, known_names, mask_opaque_tokens=mask_opaque_tokens
        )
        if found:
            return sorted(found, key=lambda item: item.value)[0]
    return None


def assert_vm_safe(
    value: object, sink: str, known_names: tuple[str, ...] = ()
) -> None:
    if sink not in VM_SINKS:
        raise ValueError("unknown VM sink")
    typed = (
        isinstance(value, dict)
        and set(value) == {"kind", "fields"}
        and value.get("kind") == sink
        and isinstance(value.get("fields"), dict)
    )
    inspected = value["fields"] if typed else value  # type: ignore[index]
    pii_class = _walk(inspected, known_names, mask_opaque_tokens=typed)
    if pii_class is not None:
        raise PIIGuardError(pii_class, sink)
    if not typed:
        raise ValueError("typed VM sink envelope is required")


def _staged_paths(repo: Path) -> tuple[str, ...]:
    result = subprocess.run(
        ["git", "diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"],
        cwd=repo, check=True, capture_output=True,
    )
    return tuple(
        item.decode("utf-8", "strict").replace("\\", "/")
        for item in result.stdout.split(b"\0") if item
    )


def _staged_text(repo: Path, path: str) -> str:
    result = subprocess.run(
        ["git", "show", f":{path}"], cwd=repo, check=True, capture_output=True
    )
    return result.stdout.decode("utf-8", "replace")


def _fixture_is_synthetic(
    text: str, *, allow_opaque_entity_ids: bool = False
) -> bool:
    try:
        value = json.loads(text, object_pairs_hook=_reject_duplicate_json_keys)
    except (json.JSONDecodeError, _DuplicateJsonKey):
        return False
    strings: list[str] = []

    def collect(item: object) -> None:
        if isinstance(item, dict):
            for key, child in item.items():
                collect(key)
                collect(child)
        elif isinstance(item, list):
            for child in item:
                collect(child)
        elif isinstance(item, str):
            strings.append(item)

    collect(value)
    for item in strings:
        for form in _decoded_forms(item):
            for match in EMAIL_RE.finditer(form):
                if not match.group(0).casefold().endswith(".test"):
                    return False
            phone_scan_form = (
                FIXTURE_OPAQUE_ID_RE.sub(
                    lambda match: " " * len(match.group(0)), form
                )
                if allow_opaque_entity_ids
                else form
            )
            for match in PHONE_RE.finditer(phone_scan_form):
                if re.fullmatch(
                    r"(?:\+?1[ .-]?)?202[ .-]?555[ .-]?01\d{2}", match.group(0)
                ) is None:
                    return False
            if PROFILE_RE.search(form):
                return False
            if "linkedin." in form.casefold() and ".example.test/" not in form.casefold():
                return False
    return True


def _validated_synthetic_nodeids(text: str) -> frozenset[str] | None:
    if not _fixture_is_synthetic(text):
        return None
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        return None
    if not isinstance(value, dict) or set(value) != {"version", "nodeids"}:
        return None
    nodeids = value.get("nodeids")
    if value.get("version") != 1 or not isinstance(nodeids, list) or not nodeids:
        return None
    if any(
        not isinstance(nodeid, str)
        or not nodeid.startswith("scripts/prospecting/tests/")
        or ".py::" not in nodeid
        or "\n" in nodeid
        or "\r" in nodeid
        or not find_text_classes(nodeid)
        or not _synthetic_nodeid_shape_is_valid(nodeid)
        for nodeid in nodeids
    ):
        return None
    unique = frozenset(nodeids)
    return unique if len(unique) == len(nodeids) else None


def _marker_content(value: str, label: str) -> str | None:
    marker_re = {
        "body": BODY_RE,
        "note": NOTE_RE,
        "excerpt": EXCERPT_RE,
    }.get(label)
    marker_key = {
        "body": "message-body",
        "note": "person-note",
        "excerpt": "source-excerpt",
    }.get(label)
    if marker_re is None or marker_key is None or marker_re.fullmatch(value) is None:
        return None
    start = "[[" + marker_key + ":"
    if not value.startswith(start):
        return None
    return value[len(start):-2].strip()


def _synthetic_nodeid_shape_is_valid(nodeid: str) -> bool:
    if nodeid.startswith(AFFINITY_SENTINEL_PREFIX):
        parameter = nodeid[len(AFFINITY_SENTINEL_PREFIX):]
        if not parameter.startswith("[") or not parameter.endswith("]"):
            return False
        label, separator, value = parameter[1:-1].partition("-")
        if not separator:
            return False
        if label in {"body", "note", "excerpt"}:
            return _marker_content(value, label) == "synthetic"
        if label == "email" and EMAIL_RE.fullmatch(value) is not None:
            local, domain = value.rsplit("@", 1)
            return local == "sample" and domain == "prospect.test"
        if label == "phone":
            return value.split("-") == ["202", "555", "0101"]
        return False
    if nodeid.startswith(STAGING_SENTINEL_PREFIX):
        parameter = nodeid[len(STAGING_SENTINEL_PREFIX):]
        if not parameter.startswith("[") or not parameter.endswith("]"):
            return False
        value, separator, label = parameter[1:-1].rpartition("-")
        if not separator:
            return False
        expected = {
            "body": "synthetic-message-body",
            "note": "synthetic-private-note",
            "excerpt": "synthetic-source-excerpt",
        }.get(label)
        return expected is not None and _marker_content(value, label) == expected
    return False


def _top_level_value_span(text: str, target: str) -> tuple[int, int] | None:
    decoder = json.JSONDecoder()
    index = 0

    def skip_space(position: int) -> int:
        while position < len(text) and text[position].isspace():
            position += 1
        return position

    index = skip_space(index)
    if index >= len(text) or text[index] != "{":
        return None
    index += 1
    while True:
        index = skip_space(index)
        if index >= len(text) or text[index] == "}":
            return None
        try:
            key, index = decoder.raw_decode(text, index)
        except json.JSONDecodeError:
            return None
        if not isinstance(key, str):
            return None
        index = skip_space(index)
        if index >= len(text) or text[index] != ":":
            return None
        value_start = skip_space(index + 1)
        try:
            _, value_end = decoder.raw_decode(text, value_start)
        except json.JSONDecodeError:
            return None
        if key == target:
            return value_start, value_end
        index = skip_space(value_end)
        if index >= len(text) or text[index] != ",":
            return None
        index += 1


def _mask_approved_manifest_nodeids(
    text: str, approved_nodeids: frozenset[str]
) -> str:
    if not approved_nodeids:
        return text
    try:
        manifest = json.loads(text)
    except json.JSONDecodeError:
        return text
    if not isinstance(manifest, dict):
        return text
    tests = manifest.get("tests")
    if not isinstance(tests, list) or any(not isinstance(item, str) for item in tests):
        return text
    span = _top_level_value_span(text, "tests")
    if span is None:
        return text
    start, end = span
    masked = list(text)
    for match in JSON_STRING_RE.finditer(text, start, end):
        try:
            value = json.loads(match.group(0))
        except json.JSONDecodeError:
            continue
        if value in approved_nodeids:
            masked[match.start():match.end()] = " " * len(match.group(0))
    return "".join(masked)


def _mask_staging_ssh_destination(text: str) -> str:
    def replace(match: re.Match[str]) -> str:
        try:
            address = ipaddress.ip_address(match.group("host"))
        except ValueError:
            return match.group(0)
        if isinstance(address, ipaddress.IPv4Address) and address in STAGING_SSH_NETWORK:
            return " " * len(match.group(0))
        return match.group(0)

    return STAGING_SSH_IPV4_RE.sub(replace, text)


def scan_staged(repo: Path = Path.cwd()) -> tuple[PIIViolation, ...]:
    violations: list[PIIViolation] = []
    try:
        nodeid_fixture = _staged_text(repo, STAGING_NODEIDS_FIXTURE)
    except subprocess.CalledProcessError:
        approved_nodeids: frozenset[str] = frozenset()
    else:
        approved_nodeids = _validated_synthetic_nodeids(nodeid_fixture) or frozenset()
    for path in _staged_paths(repo):
        if path in FIXTURE_ALLOWLIST:
            staged_text = _staged_text(repo, path)
            valid = (
                _validated_synthetic_nodeids(staged_text) is not None
                if path == STAGING_NODEIDS_FIXTURE
                else _fixture_is_synthetic(
                    staged_text,
                    allow_opaque_entity_ids=path == T1_SYNTHETIC_FIXTURE,
                )
            )
            if not valid:
                violations.append(PIIViolation(path, 1, "fixture_not_synthetic"))
            continue
        staged_text = _staged_text(repo, path)
        if path in GATE_MANIFEST_PATHS:
            staged_text = _mask_approved_manifest_nodeids(
                staged_text, approved_nodeids
            )
        for line_number, line in enumerate(staged_text.splitlines(), start=1):
            if path == STAGING_SSH_PATH:
                line = _mask_staging_ssh_destination(line)
            classes = find_text_classes(line)
            for pii_class in sorted(classes, key=lambda item: item.value):
                violations.append(PIIViolation(path, line_number, pii_class))
    return tuple(violations)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--staged", action="store_true")
    args = parser.parse_args(argv)
    if not args.staged:
        parser.error("--staged is required")
    violations = scan_staged()
    for violation in violations:
        code = (
            violation.pii_class.value
            if isinstance(violation.pii_class, PIIClass)
            else violation.pii_class
        )
        print(f"{violation.path}:{violation.line}:{code}")
    return 1 if violations else 0


if __name__ == "__main__":
    raise SystemExit(main())
