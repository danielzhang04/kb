"""Deterministic compiler from P23 captures into private P17/P18 requests.

This module turns operator *annotations over already-captured pages* into the
exact typed request objects the existing funding (P17) and person (P18)
importers accept.  It has exactly two outputs: a compiled
``FundingResearchRequest`` and a compiled ``PersonResearchRequest``.

Trust boundary
--------------

* Every source URL, body reference, retrieval time and content hash is copied
  from the exact ``CaptureService.resolve_capture`` result for one capture.
  Caller-supplied substitutes for those fields do not exist in the annotation
  types and can therefore never be honoured.
* Company/person metadata (name, site, location, sector, stage, date, coverage
  status and counts) is untrusted here.  The importers remain the authoritative
  semantic validators and qualifiers; this compiler only refuses shapes it
  cannot compile at all.
* Excerpts are exact half-open Unicode codepoint slices of the strict UTF-8
  decoded captured ``text/plain`` body.  There is no HTML parser, no
  normalization, no concatenation, no snippet reconstruction and no untrusted
  free-form excerpt string.

Honest limits
-------------

* ``compile_funding`` and ``compile_people`` are read-only: they open no
  transaction and write no row.  They are therefore **not** jointly atomic with
  the later import.  Integrity and expiry guarantees established here hold at
  compile time only; the importer re-checks retention and pipeline context at
  import time, and the ``expected_content_sha256`` stamped onto every produced
  page makes a file changed after compile fail *inside* the importer.
* The returned ``capture_refs`` tuple is an in-memory private mapping for the
  caller's own manifest export.  It is not yet a durable import receipt; wiring
  it into a private export record is a later slice.
* There is no invented unique join from (hash, url, time): different captures
  may legitimately share all three, so identity always travels as the exact
  task/receipt/snapshot identifiers.
* Within one compiled company, the same captured body or the same canonical
  source URL may not appear twice: the P17 importer refuses that shape, so it
  is refused here early with the fixed code ``duplicate_page``.  Sharing one
  page across *different* companies or different people stays permitted,
  exactly as the importers permit it.
* ``CompiledCaptureRef`` carries the exact ``body_ref`` and snapshot
  ``expires_at`` alongside the receipt/snapshot ids, so a later private export
  can pair one produced page with its receipt without zipping tuples or
  re-joining on (hash, url, time).  ``candidate_ordinal`` and ``page_ordinal``
  name the exact occurrence position the ref was produced at: for funding the
  company index and the page index inside that company, for people the person
  index and ``0`` (P18 binds exactly one page per candidate).  Those ordinals
  are occurrence identity *inside one compiled result only*; they are not a
  globally unique captured-page identity, and the same capture may legitimately
  occur at several ordinals.  ``compiler_version`` on each result envelope
  names the recipe that produced it; the P17/P18 request identity itself is
  unchanged -- the ordinals live only on this private envelope and never enter
  the emitted requests or their importer request hashes.
* ``locate_spans`` is a read-only *authoring aid* only.  It returns exact
  half-open Unicode codepoint spans of literal needle occurrences inside one
  already-verified capture, so an operator no longer has to count codepoints by
  hand before writing an annotation.  It performs **no** fuzzy matching, no
  case folding, no Unicode normalization, no whitespace collapsing and no
  HTML-aware search: a needle matches only where the decoded body contains it
  byte-for-byte after strict UTF-8 decoding.  It never chooses between
  ambiguous matches: every occurrence is returned, including occurrences that
  overlap each other, and a needle with several matches is reported as such
  rather than silently resolved to the first.  Locating confers no authority
  and produces no request: a located span is still an untrusted operator claim
  until it is compiled and imported.
* Repeated use of one page across different people is permitted.  No global
  dedupe is applied here; the importers enforce their own scoped duplicate
  rules.
* Capture resolution can surface a raw ``sqlite3.Error`` from below the capture
  service when stored rows are malformed.  That is mapped at this boundary onto
  the fixed code ``capture_unresolved`` with ``from None``, so private driver
  text never reaches the caller; established ``CaptureError`` codes are passed
  through unchanged and are never masked by that mapping.
"""

from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
import re
import sqlite3
from typing import Callable

from scripts.prospecting.affinity.source_review import (
    MAX_OPERATOR_SNAPSHOT_BYTES,
    MAX_SOURCE_BYTES,
)
from scripts.prospecting.funding_research_service import (
    MAX_BATCH_BYTES,
    MAX_CANDIDATES as MAX_FUNDING_CANDIDATES,
    MAX_PAGES_PER_COMPANY,
    MAX_PAGE_BYTES,
    MAX_QUERIES_PER_COMPANY,
    SOURCE_KINDS,
    CapturedPage,
    CompanyCapture,
    CoverageInput,
    FundingEventInput,
    FundingResearchRequest,
)
from scripts.prospecting.person_research_service import (
    MAX_CANDIDATES as MAX_PERSON_CANDIDATES,
    PersonCapture,
    PersonResearchRequest,
)
from scripts.prospecting.research_capture_service import (
    MAX_CAPTURE_BYTES,
    OPEN_KIND,
    SEARCH_KIND,
    CaptureError,
    CaptureService,
    ResolvedCapture,
)
from scripts.prospecting.source_capture import SourceCaptureError, read_owned


MAX_EXCERPT_BYTES = 1000
MAX_NAME_BYTES = 240
MAX_TITLE_BYTES = 240
MAX_IDENTIFIER_BYTES = 80
MAX_FIRST_NAME_BYTES = 120
MAX_METADATA_BYTES = 240
MAX_STAGE_BYTES = 64
MAX_URL_BYTES = 2048
MAX_RESEARCH_RESULT_IDS = MAX_PERSON_CANDIDATES
MAX_NEEDLES = 32
MAX_NEEDLE_BYTES = 1000
MAX_MATCHES_PER_NEEDLE = 64
MAX_TOTAL_MATCHES = 256
COMPILER_VERSION = "capture-import-compiler-v1"
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")
_SHA = re.compile(r"[0-9a-f]{64}\Z")
_DATE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}\Z")
_RESULT_PREFIX = "pfrr_"
_MATCH_STATES = ("no_match", "single_match", "multiple_matches")
_PASSTHROUGH_CODES = frozenset({
    "capture_missing", "capture_expired", "receipt_mismatch", "content_sha256_mismatch",
    "source_changed", "source_too_large", "invalid_body_ref", "store_state_invalid",
    "store_busy", "session_missing", "run_missing", "intake_stale", "input_pending",
    "pipeline_context_stale", "snapshot_store_required", "snapshot_store_unavailable",
    "invalid_expected_receipt_id", "invalid_expected_content_sha256",
})


class CaptureCompileError(ValueError):
    """Stable-code refusal at the private capture compilation boundary."""


@dataclass(frozen=True, repr=False)
class CaptureRef:
    """Exact identity of one already-verified capture."""

    task_id: str
    expected_receipt_id: str
    expected_content_sha256: str


@dataclass(frozen=True, repr=False)
class ExcerptSpan:
    """Half-open Unicode codepoint span over one exact captured body."""

    start: int
    end: int


@dataclass(frozen=True, repr=False)
class CoverageAnnotation:
    """Untrusted operator claim about one search page; P17 validates it."""

    status: str
    result_count: int
    result_cap: int


@dataclass(frozen=True, repr=False)
class PageAnnotation:
    capture: CaptureRef
    source_kind: str
    coverage: CoverageAnnotation | None = None


@dataclass(frozen=True, repr=False)
class FundingEventAnnotation:
    page_ordinal: int
    stage: str
    announced_at: str
    excerpt: ExcerptSpan


@dataclass(frozen=True, repr=False)
class CompanyAnnotation:
    name: str
    website_url: str | None
    location: str | None
    sector: str | None
    pages: tuple[PageAnnotation, ...]
    events: tuple[FundingEventAnnotation, ...]


@dataclass(frozen=True, repr=False)
class PersonAnnotation:
    capture: CaptureRef
    funding_result_id: str
    company_id: str
    first_name: str
    full_name: ExcerptSpan
    title: ExcerptSpan
    profile_url: str | None = None


@dataclass(frozen=True, repr=False)
class FundingCompileRequest:
    request_id: str
    session_id: str
    run_id: str
    expected_intake_hash: str
    predecessor_batch_id: str | None
    predecessor_hash: str | None
    companies: tuple[CompanyAnnotation, ...]


@dataclass(frozen=True, repr=False)
class PersonCompileRequest:
    request_id: str
    session_id: str
    run_id: str
    expected_intake_hash: str
    funding_batch_id: str
    funding_batch_hash: str
    predecessor_batch_id: str | None
    predecessor_hash: str | None
    research_result_ids: tuple[str, ...]
    people: tuple[PersonAnnotation, ...]


@dataclass(frozen=True, repr=False)
class LocateRequest:
    """One read-only request to locate literal needles in one exact capture."""

    session_id: str
    run_id: str
    expected_intake_hash: str
    capture: CaptureRef
    needles: tuple[str, ...]


@dataclass(frozen=True, repr=False)
class LocatedNeedle:
    """Every exact match of one needle, in ascending start order.

    ``ordinal`` is the needle's position in the caller's own request, so the
    caller can map a result back onto its private input without this type ever
    carrying the needle text itself.  ``state`` is exactly one of
    ``no_match``, ``single_match`` or ``multiple_matches``.
    """

    ordinal: int
    state: str
    spans: tuple[ExcerptSpan, ...]


@dataclass(frozen=True, repr=False)
class LocatedCapture:
    """Exact capture provenance plus per-needle spans, for private export."""

    task_id: str
    receipt_id: str
    snapshot_id: str
    content_sha256: str
    body_ref: str
    retrieved_at: str
    expires_at: str
    text_length: int
    needles: tuple[LocatedNeedle, ...]
    compiler_version: str = COMPILER_VERSION


@dataclass(frozen=True, repr=False)
class CompiledCaptureRef:
    """Exact capture identity behind one produced page, for private export."""

    task_id: str
    receipt_id: str
    snapshot_id: str
    content_sha256: str
    source_url: str
    retrieved_at: str
    body_ref: str = ""
    expires_at: str = ""
    candidate_ordinal: int = 0
    page_ordinal: int = 0


@dataclass(frozen=True, repr=False)
class CompiledFundingRequest:
    request: FundingResearchRequest
    capture_refs: tuple[CompiledCaptureRef, ...]
    compiler_version: str = COMPILER_VERSION


@dataclass(frozen=True, repr=False)
class CompiledPersonRequest:
    request: PersonResearchRequest
    capture_refs: tuple[CompiledCaptureRef, ...]
    compiler_version: str = COMPILER_VERSION


def _bounded_text(value: object, code: str, *, maximum: int) -> str:
    """Accept one non-empty, trimmed, control-free, byte-bounded string."""
    if (
        type(value) is not str or not value.strip() or value != value.strip()
        or _CONTROL.search(value)
    ):
        raise CaptureCompileError(code)
    try:
        if len(value.encode("utf-8")) > maximum:
            raise CaptureCompileError(code)
    except UnicodeError:
        raise CaptureCompileError(code) from None
    return value


def _identifier(value: object, code: str, *, maximum: int = MAX_IDENTIFIER_BYTES) -> str:
    return _bounded_text(value, code, maximum=maximum)


def _sha(value: object, code: str) -> str:
    if type(value) is not str or _SHA.fullmatch(value) is None:
        raise CaptureCompileError(code)
    return value


def _optional_text(value: object, code: str, *, maximum: int) -> str | None:
    """Optional untrusted metadata, bounded exactly as the importers bound it."""
    return None if value is None else _bounded_text(value, code, maximum=maximum)


def _span_text(text: str, span: object, *, maximum: int) -> str:
    """Return the exact codepoint slice named by one span, or refuse."""
    if not isinstance(span, ExcerptSpan):
        raise CaptureCompileError("invalid_span")
    start, end = span.start, span.end
    # ``type(x) is not int`` also rejects bool, which is never a valid index.
    if type(start) is not int or type(end) is not int:
        raise CaptureCompileError("invalid_span")
    if start < 0 or end <= start or end > len(text):
        raise CaptureCompileError("invalid_span")
    excerpt = text[start:end]
    if not excerpt or excerpt != excerpt.strip() or _CONTROL.search(excerpt):
        raise CaptureCompileError("invalid_span")
    try:
        if len(excerpt.encode("utf-8")) > maximum:
            raise CaptureCompileError("invalid_span")
    except UnicodeError:
        raise CaptureCompileError("invalid_span") from None
    return excerpt


def _snapshot_root(connection: sqlite3.Connection) -> Path:
    try:
        database = next(
            (str(row[2]) for row in connection.execute("PRAGMA database_list") if row[1] == "main"),
            "",
        )
    except sqlite3.Error:
        raise CaptureCompileError("store_state_invalid") from None
    if not database:
        raise CaptureCompileError("snapshot_store_required")
    return Path(database).parent / "snapshots"


def _compiled_ref(
    resolved: ResolvedCapture, candidate_ordinal: int, page_ordinal: int,
) -> CompiledCaptureRef:
    """Stamp one exact capture with its occurrence position in this result."""
    return CompiledCaptureRef(
        resolved.task_id, resolved.receipt_id, resolved.snapshot_id,
        resolved.content_sha256, resolved.source_url, resolved.retrieved_at,
        resolved.body_ref, resolved.expires_at, candidate_ordinal, page_ordinal,
    )


class CaptureImportCompiler:
    """Read-only, deterministic compiler of captures into typed requests."""

    def __init__(
        self, connection: sqlite3.Connection, *, now: Callable[[], str] | None = None,
    ) -> None:
        self.connection = connection
        self.connection.row_factory = sqlite3.Row
        self.captures = CaptureService(connection, now=now)
        self.now = self.captures.now

    def _resolve(
        self, ref: object, session_id: str, run_id: str, intake_hash: str,
        cache: dict[tuple[str, str, str], tuple[ResolvedCapture, str, int]],
        *, maximum: int,
    ) -> tuple[ResolvedCapture, str, int]:
        if not isinstance(ref, CaptureRef):
            raise CaptureCompileError("invalid_capture_ref")
        task_id = _identifier(ref.task_id, "invalid_capture_ref")
        receipt_id = _identifier(ref.expected_receipt_id, "invalid_capture_ref")
        content_sha = _sha(ref.expected_content_sha256, "invalid_capture_ref")
        key = (task_id, receipt_id, content_sha)
        if key in cache:
            return cache[key]
        try:
            resolved = self.captures.resolve_capture(
                task_id, expected_receipt_id=receipt_id,
                expected_content_sha256=content_sha,
            )
        except CaptureError as error:
            code = str(error)
            raise CaptureCompileError(
                code if code in _PASSTHROUGH_CODES else "capture_unresolved"
            ) from None
        except sqlite3.Error:
            # Malformed stored rows can fail below the capture service; the
            # driver's own message is private and must not reach the caller.
            raise CaptureCompileError("capture_unresolved") from None
        if (
            resolved.session_id != session_id or resolved.run_id != run_id
            or resolved.intake_hash != intake_hash
        ):
            raise CaptureCompileError("capture_scope_mismatch")
        text, size = self._read_owned_text(resolved, content_sha, maximum=maximum)
        cache[key] = (resolved, text, size)
        return cache[key]

    def _read_owned_text(
        self, resolved: ResolvedCapture, expected_sha: str, *, maximum: int,
    ) -> tuple[str, int]:
        """Re-read the owned body, recompute and compare before any slicing."""
        try:
            stored = read_owned(
                _snapshot_root(self.connection), resolved.body_ref, maximum=MAX_CAPTURE_BYTES,
            )
        except SourceCaptureError as error:
            code = str(error)
            raise CaptureCompileError(
                "source_too_large" if code == "too_large" else "source_changed"
            ) from None
        digest = sha256(stored.contents).hexdigest()
        if digest != resolved.content_sha256 or digest != expected_sha:
            raise CaptureCompileError("source_changed")
        if len(stored.contents) > maximum:
            raise CaptureCompileError("source_too_large")
        try:
            return stored.contents.decode("utf-8", errors="strict"), len(stored.contents)
        except UnicodeError:
            raise CaptureCompileError("invalid_capture_text") from None

    def compile_funding(self, request: object) -> CompiledFundingRequest:
        """Compile one funding-scope annotation set into a P17 typed request."""
        if not isinstance(request, FundingCompileRequest):
            raise CaptureCompileError("invalid_request")
        request_id = _identifier(request.request_id, "invalid_request_id")
        session_id = _identifier(request.session_id, "invalid_session")
        run_id = _identifier(request.run_id, "invalid_run_id")
        intake_hash = _sha(request.expected_intake_hash, "invalid_intake_hash")
        if (request.predecessor_batch_id is None) != (request.predecessor_hash is None):
            raise CaptureCompileError("invalid_predecessor")
        predecessor_id = (
            None if request.predecessor_batch_id is None
            else _identifier(request.predecessor_batch_id, "invalid_predecessor")
        )
        predecessor_hash = (
            None if request.predecessor_hash is None
            else _sha(request.predecessor_hash, "invalid_predecessor")
        )
        if type(request.companies) is not tuple or not request.companies:
            raise CaptureCompileError("invalid_company")
        if len(request.companies) > MAX_FUNDING_CANDIDATES:
            raise CaptureCompileError("candidate_pool_too_large")
        cache: dict[tuple[str, str, str], tuple[ResolvedCapture, str, int]] = {}
        refs: list[CompiledCaptureRef] = []
        candidates: list[CompanyCapture] = []
        total_bytes = 0
        for candidate_ordinal, company in enumerate(request.companies):
            if not isinstance(company, CompanyAnnotation):
                raise CaptureCompileError("invalid_company")
            _bounded_text(company.name, "invalid_company", maximum=MAX_NAME_BYTES)
            _optional_text(company.website_url, "invalid_company", maximum=MAX_URL_BYTES)
            for value in (company.location, company.sector):
                _optional_text(value, "invalid_company", maximum=MAX_METADATA_BYTES)
            if (
                type(company.pages) is not tuple
                or not 1 <= len(company.pages) <= MAX_PAGES_PER_COMPANY
            ):
                raise CaptureCompileError("invalid_page")
            if type(company.events) is not tuple or len(company.events) > len(company.pages):
                raise CaptureCompileError("invalid_funding_event")
            pages: list[CapturedPage] = []
            texts: list[str] = []
            coverage_count = 0
            seen_refs: set[str] = set()
            seen_urls: set[str] = set()
            for page_ordinal, page in enumerate(company.pages):
                if not isinstance(page, PageAnnotation):
                    raise CaptureCompileError("invalid_page")
                kind = page.source_kind
                if type(kind) is not str or kind not in SOURCE_KINDS:
                    raise CaptureCompileError("invalid_source_kind")
                resolved, text, size = self._resolve(
                    page.capture, session_id, run_id, intake_hash, cache, maximum=MAX_PAGE_BYTES,
                )
                if resolved.body_ref in seen_refs or resolved.source_url in seen_urls:
                    raise CaptureCompileError("duplicate_page")
                seen_refs.add(resolved.body_ref)
                seen_urls.add(resolved.source_url)
                if kind == "search_coverage":
                    if resolved.task_kind != SEARCH_KIND or resolved.query is None:
                        raise CaptureCompileError("capture_kind_mismatch")
                    if not isinstance(page.coverage, CoverageAnnotation):
                        raise CaptureCompileError("invalid_coverage")
                    coverage: CoverageInput | None = CoverageInput(
                        resolved.query, resolved.retrieved_at, page.coverage.status,
                        page.coverage.result_count, page.coverage.result_cap,
                    )
                    coverage_count += 1
                    if coverage_count > MAX_QUERIES_PER_COMPANY:
                        raise CaptureCompileError("invalid_coverage")
                else:
                    if resolved.task_kind != OPEN_KIND:
                        raise CaptureCompileError("capture_kind_mismatch")
                    if page.coverage is not None:
                        raise CaptureCompileError("invalid_coverage")
                    coverage = None
                total_bytes += size
                if total_bytes > MAX_BATCH_BYTES:
                    raise CaptureCompileError("batch_too_large")
                pages.append(CapturedPage(
                    resolved.body_ref, resolved.source_url, kind, resolved.retrieved_at,
                    coverage, resolved.content_sha256,
                ))
                texts.append(text)
                refs.append(_compiled_ref(resolved, candidate_ordinal, page_ordinal))
            events: list[FundingEventInput] = []
            used_ordinals: set[int] = set()
            for event in company.events:
                if not isinstance(event, FundingEventAnnotation):
                    raise CaptureCompileError("invalid_funding_event")
                ordinal = event.page_ordinal
                if type(ordinal) is not int or not 0 <= ordinal < len(pages):
                    raise CaptureCompileError("invalid_funding_event")
                if ordinal in used_ordinals:
                    raise CaptureCompileError("invalid_funding_event")
                used_ordinals.add(ordinal)
                if pages[ordinal].source_kind == "search_coverage":
                    raise CaptureCompileError("invalid_funding_event")
                _bounded_text(event.stage, "invalid_funding_event", maximum=MAX_STAGE_BYTES)
                if (
                    type(event.announced_at) is not str
                    or _DATE.fullmatch(event.announced_at) is None
                ):
                    raise CaptureCompileError("invalid_funding_event")
                excerpt = _span_text(texts[ordinal], event.excerpt, maximum=MAX_EXCERPT_BYTES)
                events.append(FundingEventInput(
                    ordinal, event.stage, event.announced_at, excerpt,
                ))
            candidates.append(CompanyCapture(
                company.name, company.website_url, company.location, company.sector,
                tuple(pages), tuple(events),
            ))
        return CompiledFundingRequest(
            FundingResearchRequest(
                request_id, run_id, intake_hash, predecessor_id, predecessor_hash,
                tuple(candidates),
            ),
            tuple(refs),
        )

    def compile_people(self, request: object) -> CompiledPersonRequest:
        """Compile one person annotation set into a P18 typed request."""
        if not isinstance(request, PersonCompileRequest):
            raise CaptureCompileError("invalid_request")
        request_id = _identifier(request.request_id, "invalid_request_id")
        session_id = _identifier(request.session_id, "invalid_session")
        run_id = _identifier(request.run_id, "invalid_run_id")
        intake_hash = _sha(request.expected_intake_hash, "invalid_intake_hash")
        funding_batch_id = _identifier(request.funding_batch_id, "invalid_funding_batch")
        funding_batch_hash = _sha(request.funding_batch_hash, "invalid_funding_batch")
        if (request.predecessor_batch_id is None) != (request.predecessor_hash is None):
            raise CaptureCompileError("invalid_predecessor")
        predecessor_id = (
            None if request.predecessor_batch_id is None
            else _identifier(request.predecessor_batch_id, "invalid_predecessor")
        )
        predecessor_hash = (
            None if request.predecessor_hash is None
            else _sha(request.predecessor_hash, "invalid_predecessor")
        )
        if type(request.research_result_ids) is not tuple or not request.research_result_ids:
            raise CaptureCompileError("invalid_research_scope")
        if len(request.research_result_ids) > MAX_RESEARCH_RESULT_IDS:
            raise CaptureCompileError("research_scope_too_large")
        scope: set[str] = set()
        for item in request.research_result_ids:
            result_id = _identifier(item, "invalid_research_scope")
            if not result_id.startswith(_RESULT_PREFIX) or result_id in scope:
                raise CaptureCompileError("invalid_research_scope")
            scope.add(result_id)
        research_result_ids = tuple(request.research_result_ids)
        if type(request.people) is not tuple:
            raise CaptureCompileError("invalid_person")
        if len(request.people) > MAX_PERSON_CANDIDATES:
            raise CaptureCompileError("candidate_pool_too_large")
        cache: dict[tuple[str, str, str], tuple[ResolvedCapture, str, int]] = {}
        refs: list[CompiledCaptureRef] = []
        people: list[PersonCapture] = []
        total_bytes = 0
        for candidate_ordinal, person in enumerate(request.people):
            if not isinstance(person, PersonAnnotation):
                raise CaptureCompileError("invalid_person")
            person_result_id = _identifier(person.funding_result_id, "invalid_person")
            _identifier(person.company_id, "invalid_person")
            _bounded_text(person.first_name, "invalid_person", maximum=MAX_FIRST_NAME_BYTES)
            _optional_text(person.profile_url, "invalid_person", maximum=MAX_URL_BYTES)
            if person_result_id not in scope:
                raise CaptureCompileError("person_scope_mismatch")
            resolved, text, size = self._resolve(
                person.capture, session_id, run_id, intake_hash, cache, maximum=MAX_SOURCE_BYTES,
            )
            if resolved.task_kind != OPEN_KIND:
                raise CaptureCompileError("capture_kind_mismatch")
            full_name = _span_text(text, person.full_name, maximum=MAX_NAME_BYTES)
            title = _span_text(text, person.title, maximum=MAX_TITLE_BYTES)
            total_bytes += size
            if total_bytes > MAX_OPERATOR_SNAPSHOT_BYTES:
                raise CaptureCompileError("batch_too_large")
            people.append(PersonCapture(
                person.funding_result_id, person.company_id, person.first_name,
                full_name, title, person.profile_url, resolved.source_url,
                resolved.body_ref, resolved.retrieved_at, resolved.content_sha256,
            ))
            refs.append(_compiled_ref(resolved, candidate_ordinal, 0))
        return CompiledPersonRequest(
            PersonResearchRequest(
                request_id, run_id, intake_hash, funding_batch_id, funding_batch_hash,
                predecessor_id, predecessor_hash, research_result_ids, tuple(people),
            ),
            tuple(refs),
        )

    def locate_spans(self, request: object) -> LocatedCapture:
        """Locate exact literal needles inside one already-verified capture.

        This reuses ``_resolve`` unchanged, so the capture must belong to the
        caller's exact session, run and intake hash, must match the caller's
        expected receipt id and content hash, must not have expired, and its
        owned body is re-read and re-hashed before a single character is
        searched.  The search itself is literal: ``str.find`` over the strict
        UTF-8 decoding of those exact bytes.  Overlapping occurrences are all
        returned (searching resumes one codepoint after each hit, not after the
        match), and no match is ever preferred over another.

        Returned spans are half-open Unicode codepoint offsets into that
        decoded text, i.e. exactly the offsets ``ExcerptSpan`` already means,
        so a located span can be pasted into an annotation unchanged.  Neither
        the needles nor any captured text is returned.
        """
        if not isinstance(request, LocateRequest):
            raise CaptureCompileError("invalid_request")
        session_id = _identifier(request.session_id, "invalid_session")
        run_id = _identifier(request.run_id, "invalid_run_id")
        intake_hash = _sha(request.expected_intake_hash, "invalid_intake_hash")
        if (
            type(request.needles) is not tuple or not request.needles
            or len(request.needles) > MAX_NEEDLES
        ):
            raise CaptureCompileError("invalid_needle")
        seen: set[str] = set()
        needles: list[str] = []
        for needle in request.needles:
            value = _bounded_text(needle, "invalid_needle", maximum=MAX_NEEDLE_BYTES)
            if value in seen:
                raise CaptureCompileError("invalid_needle")
            seen.add(value)
            needles.append(value)
        cache: dict[tuple[str, str, str], tuple[ResolvedCapture, str, int]] = {}
        resolved, text, _size = self._resolve(
            request.capture, session_id, run_id, intake_hash, cache,
            maximum=MAX_CAPTURE_BYTES,
        )
        located: list[LocatedNeedle] = []
        total = 0
        for ordinal, needle in enumerate(needles):
            spans: list[ExcerptSpan] = []
            index = text.find(needle)
            while index >= 0:
                # Refuse an over-wide result outright rather than truncating
                # it, which would silently claim a complete answer.
                if len(spans) >= MAX_MATCHES_PER_NEEDLE or total >= MAX_TOTAL_MATCHES:
                    raise CaptureCompileError("match_budget_exceeded")
                spans.append(ExcerptSpan(index, index + len(needle)))
                total += 1
                index = text.find(needle, index + 1)
            located.append(LocatedNeedle(
                ordinal, _MATCH_STATES[min(len(spans), 2)], tuple(spans),
            ))
        return LocatedCapture(
            resolved.task_id, resolved.receipt_id, resolved.snapshot_id,
            resolved.content_sha256, resolved.body_ref, resolved.retrieved_at,
            resolved.expires_at, len(text), tuple(located),
        )


__all__ = [
    "COMPILER_VERSION", "CaptureCompileError", "CaptureImportCompiler", "CaptureRef",
    "CompanyAnnotation", "CompiledCaptureRef", "CompiledFundingRequest",
    "CompiledPersonRequest", "CoverageAnnotation", "ExcerptSpan",
    "FundingCompileRequest", "FundingEventAnnotation", "LocateRequest",
    "LocatedCapture", "LocatedNeedle", "MAX_MATCHES_PER_NEEDLE",
    "MAX_NEEDLES", "MAX_NEEDLE_BYTES", "MAX_TOTAL_MATCHES", "PageAnnotation",
    "PersonAnnotation", "PersonCompileRequest",
]
