"""Private-file CLI exporting compiled P23 captures as ordinary P17/P18 requests.

In its compile modes (``--compile-funding`` / ``--compile-people``) this
desktop-only adapter turns one private annotation file into exactly two
durable private files under the selected store's own ``snapshots/`` directory:

* one *ordinary* P17 or P18 import request JSON, in exactly the schema the
  existing ``pipeline_cli`` import parsers already accept (including the
  ``expected_content_sha256`` stamped by the compiler), and
* one private provenance manifest naming the compiler recipe, the compiled
  request identity, the exact bytes of the emitted request file, and the exact
  capture task/receipt/snapshot/hash/body-ref/expiry behind every occurrence.

Honest scope and limits
-----------------------

* This is **not** a browser adapter and **not** an importer.  It never
  browses, never calls a model or provider, never leases a capture task, never
  reaches any network destination, and never writes a pipeline row.  The
  compile step runs read-only through ``CaptureImportCompiler``; the store is
  opened only through the existing ``open_store`` (whose existing migration
  behaviour is unchanged) and is closed again before anything is exported.
* The two exported files are a durable *export*, not an import receipt.
  Importing them remains a separate, explicit invocation of the existing
  ``pipeline_cli`` (``--funding-import`` / ``--person-import``), and that CLI
  keeps its own idempotency, source-hash and pipeline-context checks.  Nothing
  here claims an import happened.
* The manifest is published **last** and is therefore the completion record
  for one paired export: a manifest exists only if the request file it names
  was already written in full.  If the manifest write fails, the request file
  created moments earlier is removed through the existing ``cleanup_owned``
  identity-checked helper, a fixed ``export_failed`` code is reported, and no
  manifest is claimed.  A hard crash between the two writes can still leave an
  orphan request file with no manifest; such an orphan is inert (no row, no
  claim) and is deliberately *not* swept here, because this CLI never deletes
  anything it did not itself create in this invocation and never touches the
  shared snapshots root.
* Identity is never inferred from (hash, url, time): every capture travels as
  its exact task/receipt/snapshot identifiers plus the occurrence ordinals the
  compiler stamped.  Captures shared across companies or people are exported
  once per occurrence and are never deduplicated.
* The compiled ``request_id`` is the stable downstream idempotency key: the
  same input file compiles to the same request identity, so a retried import
  replays instead of duplicating.  That guarantee is enforced, not merely
  asserted: both P17 and P18 importers require a *canonical* UUID request id,
  so a non-canonical id is refused here, before the store is opened, rather
  than exported as a file the importers would later reject.
* A retried *export*, by contrast, writes a fresh pair of files with fresh
  opaque artefact names; artefact identity is deliberately not stable across
  retries, and earlier files are never overwritten or mutated.

Byte bounds
-----------

Both serialized artefacts are built and measured *before either file is
created*, so an over-large pair is refused with the fixed ``export_too_large``
code having written nothing at all:

* The request bound is the downstream parser's own bound
  (``pipeline_cli.MAX_FUNDING_IMPORT_BYTES`` / ``MAX_PERSON_IMPORT_BYTES``).
  This CLI therefore never emits a request file the existing importer could
  not read back.  It is not an independent invented ceiling.
* The manifest allowance is scaled by the maximum occurrence count this
  manifest can ever hold (``MAX_FUNDING_CANDIDATES * MAX_PAGES_PER_COMPANY``
  for funding, ``MAX_CANDIDATES`` for people) times a generous per-entry byte
  allowance, plus a fixed header allowance.  That allowance is not a
  mathematically derived worst-case guarantee for every field the compiler
  can emit; both the request's and the manifest's actual serialized byte
  sizes are measured and validated against their bounds before either file
  is created, and an oversized pair is refused with the fixed
  ``export_too_large`` code having written no files at all.
* ``MAX_COMPILE_INPUT_BYTES`` bounds the *annotation* file only.  It is a
  deliberate local limit and is smaller than a maximum-width batch of capture
  references would need, so the compiler's full candidate ceiling is not
  reachable through this CLI.  That is a stated limit, not a claim of parity.

Span location (``--locate``)
----------------------------

``--locate FILE`` answers exactly one authoring question: *where, in this one
already-verified capture, does this exact literal string occur?*  It exists so
an operator no longer has to count Unicode codepoints by hand before writing an
``excerpt``/``full_name``/``title`` span.

The input file is a strict JSON object with exactly these keys::

    {"session_id": str, "run_id": str, "expected_intake_hash": str,
     "capture": {"task_id": str, "expected_receipt_id": str,
                 "expected_content_sha256": str},
     "needles": [str, ...]}

``capture`` is exactly the existing ``CaptureRef`` shape the compile modes
already accept, and the scope triple is checked against the resolved capture by
the same ``_resolve`` path the compile modes use: wrong session, wrong run,
stale intake hash, wrong receipt or wrong content hash all refuse with their
existing fixed codes, and an expired capture refuses with ``capture_expired``.

Limits, all validated before the store is opened: 1..32 needles, each needle
1..1000 UTF-8 bytes, trimmed, non-empty, control-character free and distinct.
Matching is literal: no case folding, no Unicode normalization, no whitespace
collapsing, no fuzzy or regular-expression matching, no HTML awareness.  Every
occurrence is reported, including occurrences that overlap each other; a needle
that matches more than once is reported as ``multiple_matches`` and this CLI
never picks one of them for the operator.  At most 64 matches per needle and
256 matches in total: an over-wide result is *refused* with the fixed code
``match_budget_exceeded``, before any artefact is written, rather than being
truncated and presented as complete.

The result is written as exactly one fresh, opaque, never-overwritten private
artefact under ``snapshots/capture-imports/``, using the same ``copy_owned``
primitive and the same measure-then-write discipline as the compile modes: the
serialized artefact is sized against ``MAX_LOCATE_ARTEFACT_BYTES`` before the
file is created, and an over-large one is refused with ``export_too_large``
having written nothing.  The artefact records the exact capture provenance
(task/receipt/snapshot/content hash/body ref/retrieval time/expiry), the
decoded body's codepoint length, and one entry per needle carrying its input
ordinal, its ``no_match``/``single_match``/``multiple_matches`` state and all
its half-open ``{"start","end"}`` codepoint spans.  It deliberately does **not**
carry the needle text or any captured text: the operator maps ordinals back
onto their own input file.  No pipeline, import, session, task or authority row
is written, and no other CLI mode is affected.

Storage and quota
-----------------

Exported artefacts live under ``snapshots/capture-imports/`` and are retained:
two files per successful invocation, never swept, never garbage-collected
here.  They do **not** consume the P18 operator-snapshot quota: that cap is
computed by ``affinity.source_review._owned_snapshot_usage`` from *database
rows* whose ``allowlist_version`` is ``operator-local-v1``, and this CLI
writes no row at all, so repeated exports cannot starve the person importer.

No private *value* reaches stdout or stderr: queries, URLs, captured text,
needles, names and spans stay inside the private files.  The one private thing
that does travel as a process argument is the operator-chosen path of the
private input file itself, which this CLI reads and never echoes; earlier
wording here claimed that file paths never reach arguments, which was wrong.
stdout carries only a fixed status, the export kind, the ``exported`` flag, the
store-relative artefact references (private paths, but opaque random names that
name no company, person, query or URL), their SHA-256 digests and plain
counters.  Failures print one fixed code with no traceback.

The manifest does not bind a digest of the annotation file.  The reused
``_read_private_json`` helper returns parsed JSON rather than the exact bytes
it read under its own identity checks, and re-opening the file here to hash it
would hash *different* bytes across a TOCTOU window while claiming to name the
compiled source.  Rather than publish such a claim, this limit is stated.
"""

from __future__ import annotations

from hashlib import sha256
import json
import os
from pathlib import Path
import sqlite3
import sys
from typing import Any
import uuid

from .capture_import_compiler import (
    CaptureCompileError,
    CaptureImportCompiler,
    CaptureRef,
    CompanyAnnotation,
    CoverageAnnotation,
    ExcerptSpan,
    FundingCompileRequest,
    FundingEventAnnotation,
    LocateRequest,
    MAX_NEEDLES,
    MAX_NEEDLE_BYTES,
    PageAnnotation,
    PersonAnnotation,
    PersonCompileRequest,
)
from .funding_research_service import (
    MAX_CANDIDATES as MAX_FUNDING_CANDIDATES,
    MAX_PAGES_PER_COMPANY,
)
from .person_research_service import MAX_CANDIDATES as MAX_PERSON_CANDIDATES
from .pipeline_cli import (
    MAX_FUNDING_IMPORT_BYTES,
    MAX_PERSON_IMPORT_BYTES,
    CliError,
    _Parser,
    _approved_store,
    _read_private_json,
    _safe_existing_directory,
    _safe_existing_file,
)
from .source_capture import SourceCaptureError, cleanup_owned, copy_owned
from .store import open_store


MAX_COMPILE_INPUT_BYTES = 256 * 1024
MAX_LOCATE_INPUT_BYTES = 64 * 1024
# The emitted request must be readable by the existing import parsers, so its
# bound is theirs rather than an independent ceiling invented here.
MAX_FUNDING_REQUEST_BYTES = MAX_FUNDING_IMPORT_BYTES
MAX_PERSON_REQUEST_BYTES = MAX_PERSON_IMPORT_BYTES
# The manifest holds exactly one entry per compiled occurrence.  Each entry is
# two small ordinals, three bounded identifiers, one hex digest, one bounded
# body ref and one timestamp.  This per-entry allowance is generous but not a
# mathematically derived worst-case bound for every field the compiler can
# emit; the manifest's actual serialized byte size is measured and validated
# against MAX_MANIFEST_BYTES before it is written, and an oversized manifest
# is refused (export_too_large) with no files written.
MAX_MANIFEST_OCCURRENCES = max(
    MAX_FUNDING_CANDIDATES * MAX_PAGES_PER_COMPANY, MAX_PERSON_CANDIDATES,
)
MAX_MANIFEST_ENTRY_BYTES = 1536
MAX_MANIFEST_HEADER_BYTES = 8 * 1024
MAX_MANIFEST_BYTES = (
    MAX_MANIFEST_HEADER_BYTES + MAX_MANIFEST_OCCURRENCES * MAX_MANIFEST_ENTRY_BYTES
)
# One locate artefact holds at most MAX_NEEDLES entries; each entry is one
# ordinal, one fixed state word and at most MAX_MATCHES_PER_NEEDLE two-integer
# span objects.  This per-entry allowance is generous rather than a derived
# worst case: the artefact's actual serialized size is measured against
# MAX_LOCATE_ARTEFACT_BYTES before the file is created, and an oversized
# artefact is refused (export_too_large) with nothing written.
MAX_LOCATE_ENTRY_BYTES = 4 * 1024
MAX_LOCATE_HEADER_BYTES = 8 * 1024
MAX_LOCATE_ARTEFACT_BYTES = (
    MAX_LOCATE_HEADER_BYTES + MAX_NEEDLES * MAX_LOCATE_ENTRY_BYTES
)
EXPORT_NAMESPACE = "capture-imports"
FUNDING_KIND = "funding"
PEOPLE_KIND = "people"
LOCATE_KIND = "locate"
LOCATE_ARTEFACT_KIND = "capture-locate-report"
MANIFEST_KIND = "capture-import-manifest"
_FUNDING_INPUT_FIELDS = frozenset({
    "request_id", "session_id", "run_id", "expected_intake_hash",
    "predecessor_batch_id", "predecessor_hash", "companies",
})
_COMPANY_FIELDS = frozenset({
    "name", "website_url", "location", "sector", "pages", "events",
})
_PAGE_FIELDS = frozenset({"capture", "source_kind", "coverage"})
_COVERAGE_FIELDS = frozenset({"status", "result_count", "result_cap"})
_EVENT_FIELDS = frozenset({"page_ordinal", "stage", "announced_at", "excerpt"})
_CAPTURE_FIELDS = frozenset({
    "task_id", "expected_receipt_id", "expected_content_sha256",
})
_SPAN_FIELDS = frozenset({"start", "end"})
_PERSON_INPUT_FIELDS = frozenset({
    "request_id", "session_id", "run_id", "expected_intake_hash",
    "funding_batch_id", "funding_batch_hash", "predecessor_batch_id",
    "predecessor_hash", "research_result_ids", "people",
})
_PERSON_FIELDS = frozenset({
    "capture", "funding_result_id", "company_id", "first_name", "full_name",
    "title", "profile_url",
})
_LOCATE_INPUT_FIELDS = frozenset({
    "session_id", "run_id", "expected_intake_hash", "capture", "needles",
})
_CLI_CODES = frozenset({
    "compile_input_duplicate_key", "compile_input_invalid",
    "compile_input_json_invalid", "compile_input_json_too_deep",
    "compile_input_schema_invalid", "compile_input_snapshot_required",
    "compile_input_too_large", "export_failed", "export_too_large",
    "invalid_arguments", "locate_input_duplicate_key", "locate_input_invalid",
    "locate_input_json_invalid", "locate_input_json_too_deep",
    "locate_input_schema_invalid", "locate_input_snapshot_required",
    "locate_input_too_large", "store_invalid", "store_private_root_required",
    "verify_export_invalid", "verify_export_snapshot_required",
})
_COMPILE_CODES = frozenset({
    "batch_too_large", "candidate_pool_too_large", "capture_expired",
    "capture_kind_mismatch", "capture_missing", "capture_scope_mismatch",
    "capture_unresolved", "content_sha256_mismatch", "duplicate_page",
    "input_pending", "intake_stale", "invalid_body_ref", "invalid_capture_ref",
    "invalid_capture_text", "invalid_company", "invalid_coverage",
    "invalid_expected_content_sha256", "invalid_expected_receipt_id",
    "invalid_funding_batch", "invalid_funding_event", "invalid_intake_hash",
    "invalid_needle", "invalid_page", "invalid_person", "invalid_predecessor",
    "invalid_request",
    "invalid_request_id", "invalid_research_scope", "invalid_run_id",
    "invalid_session", "invalid_source_kind", "invalid_span",
    "match_budget_exceeded", "person_scope_mismatch", "pipeline_context_stale",
    "receipt_mismatch",
    "research_scope_too_large", "run_missing", "session_missing",
    "snapshot_store_required", "snapshot_store_unavailable", "source_changed",
    "source_too_large", "store_busy", "store_state_invalid",
})
_VERIFY_CODES = frozenset({
    "capture_expired", "capture_missing", "capture_mismatch",
    "capture_occurrences_mismatch", "capture_unavailable", "content_sha256_mismatch",
    "candidate_company_mismatch", "candidate_outside_scope", "candidate_pool_too_large",
    "funding_batch_stale",
    "input_pending", "intake_stale", "invalid_body_ref", "invalid_expected_content_sha256",
    "invalid_expected_receipt_id", "invalid_manifest_ref", "manifest_duplicate_key",
    "manifest_json_invalid", "manifest_json_too_deep", "manifest_schema_invalid",
    "manifest_too_large", "manifest_unavailable", "invalid_candidate", "invalid_candidates",
    "invalid_coverage", "invalid_funding_batch", "invalid_funding_event", "invalid_page",
    "invalid_research_scope", "invalid_source_kind", "invalid_source_url", "pipeline_context_stale",
    "person_evidence_mismatch",
    "receipt_mismatch", "request_duplicate_key", "request_hash_mismatch",
    "request_identity_mismatch", "request_json_invalid", "request_json_too_deep",
    "request_schema_invalid", "request_semantics_invalid", "request_too_large", "request_unavailable",
    "research_scope_too_large", "run_missing", "session_missing", "snapshot_store_required",
    "source_changed", "source_stale", "source_too_large",
    "store_busy", "store_state_invalid",
})


def _object(
    value: Any, fields: frozenset[str], code: str = "compile_input_schema_invalid",
) -> dict[str, Any]:
    """Accept exactly one JSON object with exactly the named keys."""
    if type(value) is not dict or set(value) != set(fields):
        raise CliError(code)
    return value


def _text(
    value: Any, *, optional: bool = False,
    code: str = "compile_input_schema_invalid",
) -> str | None:
    if optional and value is None:
        return None
    if type(value) is not str:
        raise CliError(code)
    return value


def _request_uuid(value: Any) -> str:
    """Require the canonical UUID form both import parsers already demand.

    ``funding_research_service._uuid`` and ``person_research_service._uuid``
    accept only ``str(uuid.UUID(value)) == value``.  Enforcing that here, ahead
    of the compile and the store open, keeps this CLI from reporting a
    successful export for an artefact the importers would refuse.
    """
    if type(value) is not str:
        raise CliError("compile_input_schema_invalid")
    try:
        parsed = uuid.UUID(value)
    except (AttributeError, TypeError, ValueError):
        raise CliError("compile_input_schema_invalid") from None
    if str(parsed) != value:
        raise CliError("compile_input_schema_invalid")
    return value


def _whole(value: Any) -> int:
    """Accept one literal JSON integer.

    ``type(value) is not int`` is what rejects ``bool`` here: ``True`` is an
    ``int`` subclass instance, so an ``isinstance`` test would admit it.
    """
    if type(value) is not int:
        raise CliError("compile_input_schema_invalid")
    return value


def _bounded_list(
    value: Any, maximum: int, code: str = "compile_input_schema_invalid",
) -> list[Any]:
    """Bound one collection *before* any element is looked at or iterated."""
    if type(value) is not list or len(value) > maximum:
        raise CliError(code)
    return value


def _span(value: Any) -> ExcerptSpan:
    item = _object(value, _SPAN_FIELDS)
    return ExcerptSpan(_whole(item["start"]), _whole(item["end"]))


def _capture_ref(value: Any, code: str = "compile_input_schema_invalid") -> CaptureRef:
    item = _object(value, _CAPTURE_FIELDS, code)
    return CaptureRef(
        _text(item["task_id"], code=code),
        _text(item["expected_receipt_id"], code=code),
        _text(item["expected_content_sha256"], code=code),
    )


def _coverage(value: Any) -> CoverageAnnotation | None:
    if value is None:
        return None
    item = _object(value, _COVERAGE_FIELDS)
    return CoverageAnnotation(
        _text(item["status"]), _whole(item["result_count"]),
        _whole(item["result_cap"]),
    )


def _page(value: Any) -> PageAnnotation:
    item = _object(value, _PAGE_FIELDS)
    return PageAnnotation(
        _capture_ref(item["capture"]), _text(item["source_kind"]),
        _coverage(item["coverage"]),
    )


def _event(value: Any) -> FundingEventAnnotation:
    item = _object(value, _EVENT_FIELDS)
    return FundingEventAnnotation(
        _whole(item["page_ordinal"]), _text(item["stage"]),
        _text(item["announced_at"]), _span(item["excerpt"]),
    )


def _company(value: Any) -> CompanyAnnotation:
    item = _object(value, _COMPANY_FIELDS)
    pages = _bounded_list(item["pages"], MAX_PAGES_PER_COMPANY)
    events = _bounded_list(item["events"], MAX_PAGES_PER_COMPANY)
    return CompanyAnnotation(
        _text(item["name"]), _text(item["website_url"], optional=True),
        _text(item["location"], optional=True), _text(item["sector"], optional=True),
        tuple(_page(page) for page in pages),
        tuple(_event(event) for event in events),
    )


def _person(value: Any) -> PersonAnnotation:
    item = _object(value, _PERSON_FIELDS)
    return PersonAnnotation(
        _capture_ref(item["capture"]), _text(item["funding_result_id"]),
        _text(item["company_id"]), _text(item["first_name"]),
        _span(item["full_name"]), _span(item["title"]),
        _text(item["profile_url"], optional=True),
    )


def _private_json(
    store: Path, input_path: Path, *, prefix: str = "compile_input",
    limit: int = MAX_COMPILE_INPUT_BYTES,
) -> Any:
    return _read_private_json(
        store, input_path,
        invalid_code=f"{prefix}_invalid",
        snapshot_code=f"{prefix}_snapshot_required",
        too_large_code=f"{prefix}_too_large",
        duplicate_code=f"{prefix}_duplicate_key",
        json_code=f"{prefix}_json_invalid",
        depth_code=f"{prefix}_json_too_deep",
        limit=limit,
    )


def _read_funding_input(store: Path, input_path: Path) -> FundingCompileRequest:
    value = _object(_private_json(store, input_path), _FUNDING_INPUT_FIELDS)
    companies = _bounded_list(value["companies"], MAX_FUNDING_CANDIDATES)
    return FundingCompileRequest(
        _request_uuid(value["request_id"]), _text(value["session_id"]),
        _text(value["run_id"]), _text(value["expected_intake_hash"]),
        _text(value["predecessor_batch_id"], optional=True),
        _text(value["predecessor_hash"], optional=True),
        tuple(_company(company) for company in companies),
    )


def _read_person_input(store: Path, input_path: Path) -> PersonCompileRequest:
    value = _object(_private_json(store, input_path), _PERSON_INPUT_FIELDS)
    result_ids = _bounded_list(value["research_result_ids"], MAX_PERSON_CANDIDATES)
    people = _bounded_list(value["people"], MAX_PERSON_CANDIDATES)
    return PersonCompileRequest(
        _request_uuid(value["request_id"]), _text(value["session_id"]),
        _text(value["run_id"]), _text(value["expected_intake_hash"]),
        _text(value["funding_batch_id"]), _text(value["funding_batch_hash"]),
        _text(value["predecessor_batch_id"], optional=True),
        _text(value["predecessor_hash"], optional=True),
        tuple(_text(result_id) for result_id in result_ids),
        tuple(_person(person) for person in people),
    )


def _needle(value: Any) -> str:
    """Accept one literal needle, bounded and shaped before the store opens."""
    text = _text(value, code="locate_input_schema_invalid")
    if (
        not text or text != text.strip()
        or any(character < " " or character == "\x7f" for character in text)
    ):
        raise CliError("locate_input_schema_invalid")
    try:
        if not 1 <= len(text.encode("utf-8")) <= MAX_NEEDLE_BYTES:
            raise CliError("locate_input_schema_invalid")
    except UnicodeError:
        raise CliError("locate_input_schema_invalid") from None
    return text


def _read_locate_input(store: Path, input_path: Path) -> LocateRequest:
    """Validate the whole locate request's shape and limits before any DB open."""
    value = _object(
        _private_json(store, input_path, prefix="locate_input", limit=MAX_LOCATE_INPUT_BYTES),
        _LOCATE_INPUT_FIELDS, "locate_input_schema_invalid",
    )
    raw = _bounded_list(value["needles"], MAX_NEEDLES, "locate_input_schema_invalid")
    if not raw:
        raise CliError("locate_input_schema_invalid")
    needles: list[str] = []
    for item in raw:
        needle = _needle(item)
        if needle in needles:
            raise CliError("locate_input_schema_invalid")
        needles.append(needle)
    return LocateRequest(
        _text(value["session_id"], code="locate_input_schema_invalid"),
        _text(value["run_id"], code="locate_input_schema_invalid"),
        _text(value["expected_intake_hash"], code="locate_input_schema_invalid"),
        _capture_ref(value["capture"], "locate_input_schema_invalid"),
        tuple(needles),
    )


def _verify_manifest_ref(store: Path, input_path: Path) -> str:
    """Bind one existing, unlinked manifest below this store's snapshots root."""
    source, _identity = _safe_existing_file(input_path, "verify_export_invalid")
    snapshots = _safe_existing_directory(
        store.parent / "snapshots", "verify_export_snapshot_required",
    )
    try:
        reference = source.relative_to(snapshots).as_posix()
    except ValueError:
        raise CliError("verify_export_snapshot_required") from None
    if not reference.startswith(f"{EXPORT_NAMESPACE}/man_") or not reference.endswith(".body"):
        raise CliError("verify_export_invalid")
    return reference


def _page_payload(page: object) -> dict[str, object]:
    """Emit exactly the page shape ``pipeline_cli._funding_request`` accepts.

    ``coverage`` is omitted rather than nulled for non-search pages: that
    parser treats a present ``coverage`` key as a required object.
    """
    payload: dict[str, object] = {
        "body_ref": page.body_ref,
        "source_url": page.source_url,
        "source_kind": page.source_kind,
        "captured_at": page.captured_at,
        "expected_content_sha256": page.expected_content_sha256,
    }
    if page.coverage is not None:
        payload["coverage"] = {
            "query": page.coverage.query,
            "searched_at": page.coverage.searched_at,
            "status": page.coverage.status,
            "result_count": page.coverage.result_count,
            "result_cap": page.coverage.result_cap,
        }
    return payload


def _funding_payload(request: object) -> dict[str, object]:
    return {
        "request_id": request.request_id,
        "run_id": request.run_id,
        "expected_intake_hash": request.expected_intake_hash,
        "predecessor_batch_id": request.predecessor_batch_id,
        "predecessor_hash": request.predecessor_hash,
        "candidates": [
            {
                "name": candidate.name,
                "website_url": candidate.website_url,
                "location": candidate.location,
                "sector": candidate.sector,
                "pages": [_page_payload(page) for page in candidate.pages],
                "events": [
                    {
                        "page_ordinal": event.page_ordinal,
                        "stage": event.stage,
                        "announced_at": event.announced_at,
                        "excerpt": event.excerpt,
                    }
                    for event in candidate.events
                ],
            }
            for candidate in request.candidates
        ],
    }


def _person_payload(request: object) -> dict[str, object]:
    return {
        "request_id": request.request_id,
        "run_id": request.run_id,
        "expected_intake_hash": request.expected_intake_hash,
        "funding_batch_id": request.funding_batch_id,
        "funding_batch_hash": request.funding_batch_hash,
        "predecessor_batch_id": request.predecessor_batch_id,
        "predecessor_hash": request.predecessor_hash,
        "research_result_ids": list(request.research_result_ids),
        "candidates": [
            {
                "funding_result_id": candidate.funding_result_id,
                "company_id": candidate.company_id,
                "first_name": candidate.first_name,
                "full_name": candidate.full_name,
                "title": candidate.title,
                "profile_url": candidate.profile_url,
                "source_url": candidate.source_url,
                "body_ref": candidate.body_ref,
                "captured_at": candidate.captured_at,
                "expected_content_sha256": candidate.expected_content_sha256,
            }
            for candidate in request.candidates
        ],
    }


def _counts(kind: str, compiled: object) -> dict[str, int]:
    candidates = compiled.request.candidates
    pages = (
        sum(len(candidate.pages) for candidate in candidates)
        if kind == FUNDING_KIND else len(candidates)
    )
    return {
        "candidates": len(candidates),
        "pages": pages,
        "captures": len(compiled.capture_refs),
    }


def _request_cap(kind: str) -> int:
    """The downstream parser's own bound for this export kind."""
    return MAX_FUNDING_REQUEST_BYTES if kind == FUNDING_KIND else MAX_PERSON_REQUEST_BYTES


def _canonical(payload: object) -> bytes:
    try:
        return json.dumps(
            payload, sort_keys=True, separators=(",", ":"), allow_nan=False,
        ).encode("utf-8")
    except (TypeError, UnicodeError, ValueError):
        raise CliError("export_failed") from None


def _write_owned(
    root: Path, name: str, contents: bytes, maximum: int,
    created: list[tuple[Path, tuple[int, int]]],
) -> str:
    """Create one fresh, exclusive, opaque owned file; never overwrite."""
    try:
        return copy_owned(
            root, namespace=EXPORT_NAMESPACE, snapshot_id=name, contents=contents,
            maximum=maximum, created=created,
        )
    except (SourceCaptureError, OSError, TypeError, ValueError):
        raise CliError("export_failed") from None


def _manifest_payload(
    kind: str, compiled: object, session_id: str, request_ref: str,
    request_sha256: str, request_bytes: int, counts: dict[str, int],
) -> dict[str, object]:
    return {
        "kind": MANIFEST_KIND,
        "export_kind": kind,
        "compiler_version": compiled.compiler_version,
        "request_id": compiled.request.request_id,
        "session_id": session_id,
        "run_id": compiled.request.run_id,
        "expected_intake_hash": compiled.request.expected_intake_hash,
        "request_ref": request_ref,
        "request_sha256": request_sha256,
        "request_byte_count": request_bytes,
        "counts": dict(counts),
        "captures": [
            {
                "candidate_ordinal": ref.candidate_ordinal,
                "page_ordinal": ref.page_ordinal,
                "task_id": ref.task_id,
                "receipt_id": ref.receipt_id,
                "snapshot_id": ref.snapshot_id,
                "content_sha256": ref.content_sha256,
                "body_ref": ref.body_ref,
                "expires_at": ref.expires_at,
            }
            for ref in compiled.capture_refs
        ],
    }


def _export(
    root: Path, kind: str, compiled: object, session_id: str,
    request_payload: dict[str, object],
) -> dict[str, object]:
    """Size both artefacts, then write the request, then the manifest.

    The request artefact's opaque name is minted before either write so the
    manifest can name it exactly and both serialized sizes can be checked
    against their bounds *before* any file exists.  An over-large pair is
    therefore refused with nothing written and nothing to clean up.
    """
    counts = _counts(kind, compiled)
    contents = _canonical(request_payload)
    request_sha256 = sha256(contents).hexdigest()
    request_name = "req_" + uuid.uuid4().hex
    request_ref = f"{EXPORT_NAMESPACE}/{request_name}.body"
    manifest = _canonical(_manifest_payload(
        kind, compiled, session_id, request_ref, request_sha256,
        len(contents), counts,
    ))
    if len(contents) > _request_cap(kind) or len(manifest) > MAX_MANIFEST_BYTES:
        raise CliError("export_too_large")

    created: list[tuple[Path, tuple[int, int]]] = []
    written_ref = _write_owned(root, request_name, contents, _request_cap(kind), created)
    try:
        if written_ref != request_ref:
            raise CliError("export_failed")
        manifest_created: list[tuple[Path, tuple[int, int]]] = []
        manifest_ref = _write_owned(
            root, "man_" + uuid.uuid4().hex, manifest, MAX_MANIFEST_BYTES,
            manifest_created,
        )
    except BaseException:
        # Only this invocation's own first file is removed, by exact identity.
        try:
            cleanup_owned(created)
        except OSError:
            pass
        raise
    return {
        "status": "exported",
        "kind": kind,
        "exported": True,
        "request_ref": request_ref,
        "request_sha256": request_sha256,
        "manifest_ref": manifest_ref,
        "manifest_sha256": sha256(manifest).hexdigest(),
        "counts": counts,
    }


def _locate_counts(located: object) -> dict[str, int]:
    states = [item.state for item in located.needles]
    return {
        "needles": len(states),
        "no_match": states.count("no_match"),
        "single_match": states.count("single_match"),
        "multiple_matches": states.count("multiple_matches"),
        "matches": sum(len(item.spans) for item in located.needles),
    }


def _locate_payload(located: object, request: LocateRequest) -> dict[str, object]:
    """Private artefact: exact provenance and spans, never needles or text."""
    return {
        "kind": LOCATE_ARTEFACT_KIND,
        "compiler_version": located.compiler_version,
        "session_id": request.session_id,
        "run_id": request.run_id,
        "expected_intake_hash": request.expected_intake_hash,
        "capture": {
            "task_id": located.task_id,
            "receipt_id": located.receipt_id,
            "snapshot_id": located.snapshot_id,
            "content_sha256": located.content_sha256,
            "body_ref": located.body_ref,
            "retrieved_at": located.retrieved_at,
            "expires_at": located.expires_at,
        },
        "text_codepoints": located.text_length,
        "needles": [
            {
                "ordinal": item.ordinal,
                "state": item.state,
                "match_count": len(item.spans),
                "spans": [
                    {"start": span.start, "end": span.end} for span in item.spans
                ],
            }
            for item in located.needles
        ],
    }


def _export_locate(
    root: Path, located: object, request: LocateRequest,
) -> dict[str, object]:
    """Size the single locate artefact, then write it once, never overwriting."""
    contents = _canonical(_locate_payload(located, request))
    if len(contents) > MAX_LOCATE_ARTEFACT_BYTES:
        raise CliError("export_too_large")
    created: list[tuple[Path, tuple[int, int]]] = []
    artefact_ref = _write_owned(
        root, "loc_" + uuid.uuid4().hex, contents, MAX_LOCATE_ARTEFACT_BYTES, created,
    )
    return {
        "status": "located",
        "kind": LOCATE_KIND,
        "exported": True,
        "artefact_ref": artefact_ref,
        "artefact_sha256": sha256(contents).hexdigest(),
        "counts": _locate_counts(located),
    }


def _error_code(error: BaseException) -> str:
    value = str(error)
    if isinstance(error, CliError) and value in _CLI_CODES:
        return value
    if isinstance(error, CaptureCompileError) and value in _COMPILE_CODES:
        return value
    if value in _VERIFY_CODES:
        return value
    return "operation_failed"


def _open_verify_store(
    path: Path, expected: os.stat_result,
) -> sqlite3.Connection:
    """Open an existing store read-only without invoking migrations."""
    connection: sqlite3.Connection | None = None
    try:
        connection = sqlite3.connect(
            f"{path.as_uri()}?mode=ro", uri=True, timeout=5.0,
        )
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA query_only=ON")
        database = next(
            (row[2] for row in connection.execute("PRAGMA database_list") if row[1] == "main"),
            None,
        )
        if type(database) is not str:
            raise CliError("verify_export_invalid")
        _opened, opened_identity = _safe_existing_file(
            Path(database), "verify_export_invalid", expected=expected,
        )
        if (opened_identity.st_dev, opened_identity.st_ino) != (
            expected.st_dev, expected.st_ino,
        ):
            raise CliError("verify_export_invalid")
        return connection
    except (CliError, OSError, RuntimeError, ValueError, sqlite3.Error):
        if connection is not None:
            try:
                connection.close()
            except sqlite3.Error:
                pass
        raise CliError("verify_export_invalid") from None


def main(argv: list[str] | None = None) -> int:
    parser = _Parser(add_help=False, allow_abbrev=False)
    parser.add_argument("--store", required=True)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--compile-funding")
    mode.add_argument("--compile-people")
    mode.add_argument("--locate")
    mode.add_argument("--verify-export")
    try:
        args = parser.parse_args(argv)
        store, identity = _approved_store(Path(args.store))
        if args.compile_funding is not None:
            kind = FUNDING_KIND
            compile_request = _read_funding_input(store, Path(args.compile_funding))
        elif args.compile_people is not None:
            kind = PEOPLE_KIND
            compile_request = _read_person_input(store, Path(args.compile_people))
        elif args.locate is not None:
            kind = LOCATE_KIND
            compile_request = _read_locate_input(store, Path(args.locate))
        else:
            kind = "verify_export"
            manifest_ref = _verify_manifest_ref(store, Path(args.verify_export))
        root = _safe_existing_directory(store.parent / "snapshots", "export_failed")
        store, current_identity = _safe_existing_file(
            store, "store_invalid", expected=identity,
        )
        connection = (
            _open_verify_store(store, current_identity)
            if kind == "verify_export" else open_store(store)
        )
        try:
            if kind == "verify_export":
                # Deliberately lazy: the verifier imports this module's export
                # constants, so importing it at module load would be circular.
                from .capture_export_verifier import CaptureExportVerifier
                try:
                    verification = CaptureExportVerifier(connection).verify(manifest_ref)
                except sqlite3.Error:
                    raise CliError("verify_export_invalid") from None
            else:
                compiler = CaptureImportCompiler(connection)
                if kind == FUNDING_KIND:
                    compiled = compiler.compile_funding(compile_request)
                    request_payload = _funding_payload(compiled.request)
                elif kind == PEOPLE_KIND:
                    compiled = compiler.compile_people(compile_request)
                    request_payload = _person_payload(compiled.request)
                else:
                    located = compiler.locate_spans(compile_request)
        finally:
            connection.close()
        if kind == "verify_export":
            output = {
                "status": verification.status,
                "kind": verification.kind,
                "request_id": verification.request_id,
                "capture_count": verification.capture_count,
                "request_sha256": verification.request_sha256,
            }
        elif kind == LOCATE_KIND:
            output = _export_locate(root, located, compile_request)
        else:
            output = _export(
                root, kind, compiled, compile_request.session_id, request_payload,
            )
        sys.stdout.write(
            json.dumps(output, sort_keys=True, separators=(",", ":")) + "\n"
        )
        return 0
    except (CaptureCompileError, CliError) as error:
        code = _error_code(error)
    except ValueError as error:
        code = _error_code(error)
    except (
        OSError, OverflowError, RecursionError, RuntimeError, sqlite3.Error,
        TypeError,
    ):
        code = "operation_failed"
    sys.stderr.write(f"capture_import_cli_error:{code}\n")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
