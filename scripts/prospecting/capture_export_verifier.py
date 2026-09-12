"""Read-only verification for one completed capture-import export pair.

An export manifest is a completion record, not a signature.  This module only
establishes that the manifest, request bytes, and still-retained capture rows
are mutually consistent in the selected store *now*.  It never imports a
request, creates a capture, or writes a database row.
"""

from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
import json
from pathlib import Path
import re
import sqlite3
from typing import Callable
import uuid

from .capture_import_cli import (
    EXPORT_NAMESPACE,
    MANIFEST_KIND,
    MAX_MANIFEST_BYTES,
    MAX_PERSON_REQUEST_BYTES,
    MAX_FUNDING_REQUEST_BYTES,
)
from .capture_import_compiler import COMPILER_VERSION
from .funding_research_service import (
    MAX_CANDIDATES as MAX_FUNDING_CANDIDATES, MAX_PAGES_PER_COMPANY,
    FundingResearchError, FundingResearchService, _prepare_request,
)
from .person_research_service import (
    MAX_CANDIDATES as MAX_PERSON_CANDIDATES, PersonResearchError, PersonResearchService,
    _contains_token_sequence, _prepare as _prepare_people, identity_excerpt,
)
from .pipeline_cli import CliError, _funding_request, _person_request, _reject_excess_depth
from .research_capture_service import (
    OPEN_KIND, SEARCH_KIND, CaptureError, CaptureService, ResolvedCapture,
)
from .source_capture import SourceCaptureError, read_owned


_SHA = re.compile(r"[0-9a-f]{64}\Z")
_ARTEFACT = re.compile(r"capture-imports/(man|req)_[0-9a-f]{32}\.body\Z")
_MANIFEST_FIELDS = frozenset({
    "kind", "export_kind", "compiler_version", "request_id", "session_id", "run_id",
    "expected_intake_hash", "request_ref", "request_sha256", "request_byte_count",
    "counts", "captures",
})
_COUNT_FIELDS = frozenset({"candidates", "pages", "captures"})
_CAPTURE_FIELDS = frozenset({
    "candidate_ordinal", "page_ordinal", "task_id", "receipt_id", "snapshot_id",
    "content_sha256", "body_ref", "expires_at",
})
_FUNDING_FIELDS = frozenset({
    "request_id", "run_id", "expected_intake_hash", "predecessor_batch_id",
    "predecessor_hash", "candidates",
})
_FUNDING_CANDIDATE_FIELDS = frozenset({
    "name", "website_url", "location", "sector", "pages", "events",
})
_FUNDING_PAGE_REQUIRED = frozenset({
    "body_ref", "source_url", "source_kind", "captured_at",
})
_FUNDING_PAGE_OPTIONAL = frozenset({"coverage", "expected_content_sha256"})
_COVERAGE_FIELDS = frozenset({"query", "searched_at", "status", "result_count", "result_cap"})
_EVENT_FIELDS = frozenset({"page_ordinal", "stage", "announced_at", "excerpt"})
_PEOPLE_FIELDS = frozenset({
    "request_id", "run_id", "expected_intake_hash", "funding_batch_id",
    "funding_batch_hash", "predecessor_batch_id", "predecessor_hash",
    "research_result_ids", "candidates",
})
_PERSON_FIELDS = frozenset({
    "funding_result_id", "company_id", "first_name", "full_name", "title",
    "profile_url", "source_url", "body_ref", "captured_at",
})
_PERSON_OPTIONAL = frozenset({"expected_content_sha256"})
_PASSTHROUGH = frozenset({
    "capture_expired", "capture_missing", "content_sha256_mismatch", "input_pending",
    "intake_stale", "invalid_body_ref", "invalid_expected_content_sha256",
    "invalid_expected_receipt_id", "pipeline_context_stale", "receipt_mismatch",
    "run_missing", "session_missing", "snapshot_store_required",
    "source_changed", "source_too_large", "store_busy", "store_state_invalid",
    "funding_batch_stale", "invalid_candidate", "invalid_candidates", "invalid_coverage",
    "invalid_funding_batch", "invalid_funding_event", "invalid_page", "invalid_research_scope",
    "invalid_source_kind", "invalid_source_url", "candidate_outside_scope",
    "candidate_company_mismatch", "candidate_pool_too_large", "research_scope_too_large",
    "source_stale",
})


class CaptureExportVerificationError(ValueError):
    """Stable-code refusal from capture export recovery verification."""


@dataclass(frozen=True, repr=False)
class CaptureExportVerification:
    status: str
    kind: str
    request_id: str
    capture_count: int
    request_sha256: str


def _snapshot_root(connection: sqlite3.Connection) -> Path:
    try:
        database = next(
            (str(row[2]) for row in connection.execute("PRAGMA database_list") if row[1] == "main"),
            "",
        )
    except sqlite3.Error:
        raise CaptureExportVerificationError("store_state_invalid") from None
    if not database:
        raise CaptureExportVerificationError("snapshot_store_required")
    return Path(database).parent / "snapshots"


def _object(value: object, fields: frozenset[str], code: str) -> dict[str, object]:
    if type(value) is not dict or set(value) != set(fields):
        raise CaptureExportVerificationError(code)
    return value


def _text(value: object, code: str) -> str:
    if (
        type(value) is not str or not value or value != value.strip()
        or any(character < " " or character == "\x7f" for character in value)
    ):
        raise CaptureExportVerificationError(code)
    return value


def _optional_text(value: object, code: str) -> str | None:
    return None if value is None else _text(value, code)


def _whole(value: object, code: str, *, minimum: int = 0) -> int:
    if type(value) is not int or value < minimum:
        raise CaptureExportVerificationError(code)
    return value


def _sha(value: object, code: str) -> str:
    if type(value) is not str or _SHA.fullmatch(value) is None:
        raise CaptureExportVerificationError(code)
    return value


def _uuid(value: object, code: str) -> str:
    text = _text(value, code)
    try:
        if str(uuid.UUID(text)) != text:
            raise ValueError
    except (AttributeError, ValueError):
        raise CaptureExportVerificationError(code) from None
    return text


def _artefact_ref(value: object, expected: str, code: str) -> str:
    ref = _text(value, code)
    matched = _ARTEFACT.fullmatch(ref)
    if matched is None or matched.group(1) != expected:
        raise CaptureExportVerificationError(code)
    return ref


def _json(contents: bytes, *, prefix: str) -> object:
    try:
        _reject_excess_depth(contents, f"{prefix}_json_too_deep")
        return json.loads(
            contents.decode("utf-8"),
            object_pairs_hook=lambda pairs: _duplicates(pairs, f"{prefix}_duplicate_key"),
            parse_constant=lambda _value: _invalid_json(f"{prefix}_json_invalid"),
            parse_float=lambda _value: _invalid_json(f"{prefix}_json_invalid"),
        )
    except CaptureExportVerificationError:
        raise
    except (UnicodeDecodeError, json.JSONDecodeError, OverflowError, RecursionError, ValueError):
        raise CaptureExportVerificationError(f"{prefix}_json_invalid") from None


def _duplicates(pairs: list[tuple[str, object]], code: str) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise CaptureExportVerificationError(code)
        result[key] = value
    return result


def _invalid_json(code: str) -> object:
    raise CaptureExportVerificationError(code)


def _owned(root: Path, ref: str, maximum: int, *, prefix: str) -> bytes:
    try:
        return read_owned(root, ref, maximum=maximum).contents
    except SourceCaptureError as error:
        if str(error) == "too_large":
            raise CaptureExportVerificationError(f"{prefix}_too_large") from None
        raise CaptureExportVerificationError(f"{prefix}_unavailable") from None


def _manifest(value: object) -> dict[str, object]:
    item = _object(value, _MANIFEST_FIELDS, "manifest_schema_invalid")
    if (
        item["kind"] != MANIFEST_KIND or type(item["export_kind"]) is not str
        or item["export_kind"] not in {"funding", "people"}
    ):
        raise CaptureExportVerificationError("manifest_schema_invalid")
    if item["compiler_version"] != COMPILER_VERSION:
        raise CaptureExportVerificationError("manifest_schema_invalid")
    _uuid(item["request_id"], "manifest_schema_invalid")
    for name in ("session_id", "run_id", "expected_intake_hash"):
        _text(item[name], "manifest_schema_invalid")
    _sha(item["expected_intake_hash"], "manifest_schema_invalid")
    _artefact_ref(item["request_ref"], "req", "manifest_schema_invalid")
    _sha(item["request_sha256"], "manifest_schema_invalid")
    _whole(item["request_byte_count"], "manifest_schema_invalid", minimum=1)
    counts = _object(item["counts"], _COUNT_FIELDS, "manifest_schema_invalid")
    for name in _COUNT_FIELDS:
        _whole(counts[name], "manifest_schema_invalid")
    captures = item["captures"]
    if type(captures) is not list or len(captures) != counts["captures"]:
        raise CaptureExportVerificationError("manifest_schema_invalid")
    return item


def _request_funding(value: object) -> list[tuple[int, int, dict[str, object]]]:
    item = _object(value, _FUNDING_FIELDS, "request_schema_invalid")
    for name in ("request_id", "run_id", "expected_intake_hash"):
        _text(item[name], "request_schema_invalid")
    _uuid(item["request_id"], "request_schema_invalid")
    _sha(item["expected_intake_hash"], "request_schema_invalid")
    for name in ("predecessor_batch_id", "predecessor_hash"):
        _optional_text(item[name], "request_schema_invalid")
    candidates = item["candidates"]
    if type(candidates) is not list or not candidates or len(candidates) > MAX_FUNDING_CANDIDATES:
        raise CaptureExportVerificationError("request_schema_invalid")
    occurrences: list[tuple[int, int, dict[str, object]]] = []
    for candidate_ordinal, candidate_value in enumerate(candidates):
        candidate = _object(candidate_value, _FUNDING_CANDIDATE_FIELDS, "request_schema_invalid")
        for name in ("name",):
            _text(candidate[name], "request_schema_invalid")
        for name in ("website_url", "location", "sector"):
            _optional_text(candidate[name], "request_schema_invalid")
        pages = candidate["pages"]
        events = candidate["events"]
        if type(pages) is not list or not 1 <= len(pages) <= MAX_PAGES_PER_COMPANY or type(events) is not list:
            raise CaptureExportVerificationError("request_schema_invalid")
        for page_ordinal, page_value in enumerate(pages):
            if type(page_value) is not dict:
                raise CaptureExportVerificationError("request_schema_invalid")
            page = page_value
            if not (_FUNDING_PAGE_REQUIRED <= set(page) <= _FUNDING_PAGE_REQUIRED | _FUNDING_PAGE_OPTIONAL):
                raise CaptureExportVerificationError("request_schema_invalid")
            for name in _FUNDING_PAGE_REQUIRED:
                _text(page[name], "request_schema_invalid")
            if "expected_content_sha256" not in page:
                raise CaptureExportVerificationError("request_schema_invalid")
            _sha(page["expected_content_sha256"], "request_schema_invalid")
            if "coverage" in page:
                coverage = _object(page["coverage"], _COVERAGE_FIELDS, "request_schema_invalid")
                for name in ("query", "searched_at", "status"):
                    _text(coverage[name], "request_schema_invalid")
                _whole(coverage["result_count"], "request_schema_invalid")
                _whole(coverage["result_cap"], "request_schema_invalid", minimum=1)
            occurrences.append((candidate_ordinal, page_ordinal, page))
        for event_value in events:
            event = _object(event_value, _EVENT_FIELDS, "request_schema_invalid")
            _whole(event["page_ordinal"], "request_schema_invalid")
            for name in ("stage", "announced_at", "excerpt"):
                _text(event[name], "request_schema_invalid")
    return occurrences


def _request_people(value: object) -> list[tuple[int, int, dict[str, object]]]:
    item = _object(value, _PEOPLE_FIELDS, "request_schema_invalid")
    for name in ("request_id", "run_id", "expected_intake_hash", "funding_batch_id", "funding_batch_hash"):
        _text(item[name], "request_schema_invalid")
    _uuid(item["request_id"], "request_schema_invalid")
    for name in ("expected_intake_hash", "funding_batch_hash"):
        _sha(item[name], "request_schema_invalid")
    for name in ("predecessor_batch_id", "predecessor_hash"):
        _optional_text(item[name], "request_schema_invalid")
    if type(item["research_result_ids"]) is not list or type(item["candidates"]) is not list:
        raise CaptureExportVerificationError("request_schema_invalid")
    if not item["candidates"] or len(item["candidates"]) > MAX_PERSON_CANDIDATES:
        raise CaptureExportVerificationError("request_schema_invalid")
    for identifier in item["research_result_ids"]:
        _text(identifier, "request_schema_invalid")
    occurrences: list[tuple[int, int, dict[str, object]]] = []
    for candidate_ordinal, candidate_value in enumerate(item["candidates"]):
        if type(candidate_value) is not dict:
            raise CaptureExportVerificationError("request_schema_invalid")
        candidate = candidate_value
        if not (_PERSON_FIELDS <= set(candidate) <= _PERSON_FIELDS | _PERSON_OPTIONAL):
            raise CaptureExportVerificationError("request_schema_invalid")
        for name in _PERSON_FIELDS - {"profile_url"}:
            _text(candidate[name], "request_schema_invalid")
        _optional_text(candidate["profile_url"], "request_schema_invalid")
        if "expected_content_sha256" not in candidate:
            raise CaptureExportVerificationError("request_schema_invalid")
        _sha(candidate["expected_content_sha256"], "request_schema_invalid")
        occurrences.append((candidate_ordinal, 0, candidate))
    return occurrences


class CaptureExportVerifier:
    """Verify an existing export from one live, caller-owned SQLite connection."""

    def __init__(self, connection: sqlite3.Connection, *, now: Callable[[], str] | None = None) -> None:
        self.connection = connection
        self.connection.row_factory = sqlite3.Row
        self.captures = CaptureService(connection, now=now)

    def verify(self, manifest_ref: object) -> CaptureExportVerification:
        manifest_ref = _artefact_ref(manifest_ref, "man", "invalid_manifest_ref")
        root = _snapshot_root(self.connection)
        manifest_bytes = _owned(root, manifest_ref, MAX_MANIFEST_BYTES, prefix="manifest")
        manifest = _manifest(_json(manifest_bytes, prefix="manifest"))
        request_ref = str(manifest["request_ref"])
        request_limit = MAX_FUNDING_REQUEST_BYTES if manifest["export_kind"] == "funding" else MAX_PERSON_REQUEST_BYTES
        request_bytes = _owned(root, request_ref, request_limit, prefix="request")
        if len(request_bytes) != manifest["request_byte_count"] or sha256(request_bytes).hexdigest() != manifest["request_sha256"]:
            raise CaptureExportVerificationError("request_hash_mismatch")
        request = _json(request_bytes, prefix="request")
        occurrences = _request_funding(request) if manifest["export_kind"] == "funding" else _request_people(request)
        if (
            request.get("request_id") != manifest["request_id"]
            or request.get("run_id") != manifest["run_id"]
            or request.get("expected_intake_hash") != manifest["expected_intake_hash"]
        ):
            raise CaptureExportVerificationError("request_identity_mismatch")
        counts = manifest["counts"]
        if counts["candidates"] != len(request["candidates"]) or counts["pages"] != len(occurrences):
            raise CaptureExportVerificationError("capture_occurrences_mismatch")
        self._captures(manifest, occurrences)
        self._semantic_request(request, str(manifest["export_kind"]), root)
        return CaptureExportVerification(
            "verified", str(manifest["export_kind"]), str(manifest["request_id"]),
            len(occurrences), str(manifest["request_sha256"]),
        )

    def _semantic_request(self, request: object, kind: str, root: Path) -> None:
        """Run the importers' non-mutating preparation and current-context checks.

        The DTOs are built from the already read and hashed request object.  We
        deliberately stop before either importer's transaction-opening method.
        """
        try:
            if kind == "funding":
                normalized, candidates, _request_hash = _prepare_request(
                    _funding_request(request), root,
                )
                context = FundingResearchService(
                    self.connection, now=self.captures.now,
                )._context(normalized.run_id, normalized.expected_intake_hash)
                if len(candidates) > min(MAX_FUNDING_CANDIDATES, 3 * int(context["requested_companies"])):
                    raise FundingResearchError("candidate_pool_too_large")
            else:
                normalized, prepared, _request_hash = _prepare_people(
                    _person_request(request), root,
                )
                _intake, _funding, selected = PersonResearchService(
                    self.connection, now=self.captures.now,
                )._context(normalized)
                names = {item.result_id: item.name for item in selected}
                for candidate in prepared:
                    supplied = candidate.supplied
                    excerpt = identity_excerpt(
                        candidate.contents.decode("utf-8"), supplied.full_name,
                        names[supplied.funding_result_id], supplied.title,
                    )
                    if (
                        excerpt is None
                        or not _contains_token_sequence(supplied.full_name, supplied.first_name)
                        or not _contains_token_sequence(candidate.contents.decode("utf-8"), supplied.first_name)
                    ):
                        raise PersonResearchError("person_evidence_mismatch")
        except CliError:
            raise CaptureExportVerificationError("request_schema_invalid") from None
        except (FundingResearchError, PersonResearchError) as error:
            code = str(error)
            raise CaptureExportVerificationError(
                code if code in _PASSTHROUGH or code == "person_evidence_mismatch"
                else "request_semantics_invalid",
            ) from None

    def _captures(self, manifest: dict[str, object], occurrences: list[tuple[int, int, dict[str, object]]]) -> None:
        by_ordinal = {(candidate, page): payload for candidate, page, payload in occurrences}
        entries = manifest["captures"]
        assert type(entries) is list
        seen: set[tuple[int, int]] = set()
        for raw in entries:
            entry = _object(raw, _CAPTURE_FIELDS, "manifest_schema_invalid")
            candidate = _whole(entry["candidate_ordinal"], "manifest_schema_invalid")
            page = _whole(entry["page_ordinal"], "manifest_schema_invalid")
            ordinal = (candidate, page)
            if ordinal in seen or ordinal not in by_ordinal:
                raise CaptureExportVerificationError("capture_occurrences_mismatch")
            seen.add(ordinal)
            for name in ("task_id", "receipt_id", "snapshot_id", "body_ref", "expires_at"):
                _text(entry[name], "manifest_schema_invalid")
            _sha(entry["content_sha256"], "manifest_schema_invalid")
            try:
                resolved = self.captures.resolve_capture(
                    entry["task_id"], expected_receipt_id=entry["receipt_id"],
                    expected_content_sha256=entry["content_sha256"],
                )
            except CaptureError as error:
                code = str(error)
                raise CaptureExportVerificationError(code if code in _PASSTHROUGH else "capture_unavailable") from None
            self._capture_matches(manifest, entry, by_ordinal[ordinal], resolved)
        if seen != set(by_ordinal):
            raise CaptureExportVerificationError("capture_occurrences_mismatch")

    @staticmethod
    def _capture_matches(manifest: dict[str, object], entry: dict[str, object], page: dict[str, object], resolved: ResolvedCapture) -> None:
        if (
            resolved.session_id != manifest["session_id"] or resolved.run_id != manifest["run_id"]
            or resolved.intake_hash != manifest["expected_intake_hash"]
            or resolved.snapshot_id != entry["snapshot_id"] or resolved.body_ref != entry["body_ref"]
            or resolved.expires_at != entry["expires_at"] or resolved.content_sha256 != entry["content_sha256"]
            or page["body_ref"] != resolved.body_ref or page["source_url"] != resolved.source_url
            or page["captured_at"] != resolved.retrieved_at
            or page["expected_content_sha256"] != resolved.content_sha256
        ):
            raise CaptureExportVerificationError("capture_mismatch")
        if "coverage" in page:
            coverage = page["coverage"]
            assert type(coverage) is dict
            if (
                resolved.task_kind != SEARCH_KIND or coverage["query"] != resolved.query
                or coverage["searched_at"] != resolved.retrieved_at
            ):
                raise CaptureExportVerificationError("capture_mismatch")
        elif resolved.task_kind != OPEN_KIND:
            raise CaptureExportVerificationError("capture_mismatch")


__all__ = [
    "CaptureExportVerification", "CaptureExportVerificationError", "CaptureExportVerifier",
]
