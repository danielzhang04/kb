"""Private, source-bound provisional funding research for saved P15 intake.

This service imports operator-captured public pages.  Its rule outcomes are
provisional and never constitute semantic factcheck, human approval, or send
authority.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from hashlib import sha256
import ipaddress
import json
from pathlib import Path
import re
import sqlite3
from types import MappingProxyType
from typing import Callable, Mapping
from urllib.parse import SplitResult, urlsplit, urlunsplit
import uuid

from scripts.prospecting.affinity.source_review import plain_text
from scripts.prospecting.pipeline_service import FUNDING_STAGES, PipelineError, PipelineService
from scripts.prospecting.source_capture import (
    SourceCaptureError,
    cleanup_owned,
    copy_owned,
    read_capture,
    read_owned,
)


MAX_QUERIES_PER_COMPANY = 4
MAX_RESULTS_PER_QUERY = 20
MAX_PAGES_PER_COMPANY = 6
MAX_PAGE_BYTES = 2 * 1024 * 1024
MAX_BATCH_BYTES = 64 * 1024 * 1024
MAX_CANDIDATES = 200
IMPORTER_VERSION = "funding-import-v1"
CLASSIFIER_VERSION = "funding-rules-v1"
_IMPORTER_MANIFEST = {
    "version": IMPORTER_VERSION, "candidate_ceiling": MAX_CANDIDATES,
    "pool_multiplier": 3, "page_ceiling": MAX_PAGES_PER_COMPANY,
    "page_bytes": MAX_PAGE_BYTES, "batch_bytes": MAX_BATCH_BYTES,
    "capture_scope": "selected-snapshot-root-contained", "identity": "exact-host-or-exact-name",
    "collision": "conflicting-identity-snapshot-only",
}
_CLASSIFIER_MANIFEST = {
    "version": CLASSIFIER_VERSION, "funding_authority": sorted(("issuer", "participating_investor")),
    "coverage": "company-token-scoped-found-or-empty-current-capture",
    "latest": "actual-stage-date-pair", "conflict": "unknown",
    "semantic_state": "awaiting_qualification_factcheck",
}
IMPORTER_HASH = sha256(json.dumps(
    _IMPORTER_MANIFEST, sort_keys=True, separators=(",", ":"),
).encode()).hexdigest()
CLASSIFIER_HASH = sha256(json.dumps(
    _CLASSIFIER_MANIFEST, sort_keys=True, separators=(",", ":"),
).encode()).hexdigest()
SOURCE_KINDS = frozenset({
    "issuer", "participating_investor", "independent_report", "search_coverage",
})
COVERAGE_STATUSES = frozenset({"found", "empty", "blocked", "error"})
PRIMARY_KINDS = frozenset({"issuer", "participating_investor"})
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")
_RUN_ID = re.compile(r"prun_[0-9a-f]{32}\Z")
_DNS_LABEL = re.compile(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\Z")


class FundingResearchError(ValueError):
    """Stable-code refusal at the private funding import boundary."""


@dataclass(frozen=True, repr=False)
class CoverageInput:
    query: str
    searched_at: str
    status: str
    result_count: int
    result_cap: int


@dataclass(frozen=True, repr=False)
class CapturedPage:
    body_ref: str
    source_url: str
    source_kind: str
    captured_at: str
    coverage: CoverageInput | None = None
    expected_content_sha256: str | None = None


@dataclass(frozen=True, repr=False)
class FundingEventInput:
    page_ordinal: int
    stage: str
    announced_at: str
    excerpt: str


@dataclass(frozen=True, repr=False)
class CompanyCapture:
    name: str
    website_url: str | None
    location: str | None
    sector: str | None
    pages: tuple[CapturedPage, ...]
    events: tuple[FundingEventInput, ...]


@dataclass(frozen=True, repr=False)
class FundingResearchRequest:
    request_id: str
    run_id: str
    expected_intake_hash: str
    predecessor_batch_id: str | None
    predecessor_hash: str | None
    candidates: tuple[CompanyCapture, ...]


@dataclass(frozen=True, repr=False)
class FundingSourceProjection:
    source_url: str
    source_kind: str
    binding_kind: str
    retrieved_at: str


@dataclass(frozen=True, repr=False)
class CompanyFundingProjection:
    result_id: str
    ordinal: int
    company_id: str | None
    name: str
    rule_outcome: str
    reason_codes: tuple[str, ...]
    latest_stage: str | None
    latest_announced_at: str | None
    source_count: int
    sources: tuple[FundingSourceProjection, ...] = ()


@dataclass(frozen=True, repr=False)
class FundingResearchProjection:
    batch_id: str
    batch_hash: str
    run_id: str
    intake_id: str
    intake_hash: str
    predecessor_batch_id: str | None
    predecessor_hash: str | None
    state: str
    desired_companies: int
    candidate_count: int
    provisional_match_count: int
    provisional_excluded_count: int
    unknown_count: int
    collision_count: int
    provisional_shortfall: int
    companies: tuple[CompanyFundingProjection, ...]


@dataclass(frozen=True)
class FundingResearchSafeProjection:
    batch_id: str
    batch_hash: str
    run_id: str
    intake_hash: str
    state: str
    counts: Mapping[str, int]


@dataclass(frozen=True)
class FundingResearchResult:
    batch_id: str
    batch_hash: str
    run_id: str
    state: str
    counts: Mapping[str, int]
    replayed: bool = False


@dataclass(frozen=True)
class _Page:
    body_ref: str
    source_url: str
    canonical_url: str
    source_kind: str
    captured_at: str
    coverage: CoverageInput | None
    contents: bytes = field(repr=False)
    content_sha256: str = ""


@dataclass(frozen=True)
class _Candidate:
    name: str
    website_url: str | None
    location: str | None
    sector: str | None
    pages: tuple[_Page, ...]
    events: tuple[FundingEventInput, ...]
    candidate_key: str
    identity_hash: str


def _canonical(value: object) -> str:
    try:
        return json.dumps(
            value, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
            allow_nan=False,
        )
    except (TypeError, ValueError, UnicodeError):
        raise FundingResearchError("invalid_request") from None


def _digest(value: object) -> str:
    return sha256(_canonical(value).encode("utf-8")).hexdigest()


def _text(value: object, code: str, *, maximum: int, optional: bool = False) -> str | None:
    if optional and value is None:
        return None
    if type(value) is not str or not value.strip() or value != value.strip() or _CONTROL.search(value):
        raise FundingResearchError(code)
    try:
        if len(value.encode("utf-8")) > maximum:
            raise FundingResearchError(code)
    except UnicodeError:
        raise FundingResearchError(code) from None
    return value


def _uuid(value: object) -> str:
    if type(value) is not str:
        raise FundingResearchError("invalid_request_id")
    try:
        parsed = uuid.UUID(value)
    except (AttributeError, ValueError):
        raise FundingResearchError("invalid_request_id") from None
    if str(parsed) != value:
        raise FundingResearchError("invalid_request_id")
    return value


def _sha(value: object, code: str) -> str:
    if type(value) is not str or re.fullmatch(r"[0-9a-f]{64}", value) is None:
        raise FundingResearchError(code)
    return value


def _timestamp(value: object, code: str) -> datetime:
    if type(value) is not str:
        raise FundingResearchError(code)
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise ValueError
        return parsed.astimezone(timezone.utc)
    except ValueError:
        raise FundingResearchError(code) from None


def _date(value: object, code: str) -> datetime:
    if type(value) is not str:
        raise FundingResearchError(code)
    try:
        parsed = datetime.fromisoformat(value + "T00:00:00+00:00")
        if parsed.date().isoformat() != value:
            raise ValueError
        return parsed
    except ValueError:
        raise FundingResearchError(code) from None


def _url(value: object, code: str) -> str:
    raw = _text(value, code, maximum=2048)
    assert raw is not None
    try:
        parsed = urlsplit(raw)
        hostname = (parsed.hostname or "").casefold().rstrip(".")
        try:
            hostname.encode("ascii")
        except UnicodeError:
            raise ValueError
        labels = hostname.split(".")
        if (
            parsed.scheme.casefold() != "https" or not hostname or "." not in hostname
            or parsed.username is not None or parsed.password is not None
            or parsed.port not in (None, 443)
            or len(hostname) > 253 or any(_DNS_LABEL.fullmatch(label) is None for label in labels)
            or "\\" in raw
        ):
            raise ValueError
        try:
            address = ipaddress.ip_address(hostname)
            if not address.is_global:
                raise ValueError
        except ValueError as error:
            if hostname.replace(".", "").isdigit():
                raise error
        netloc = hostname
        path = parsed.path or "/"
        return urlunsplit(SplitResult("https", netloc, path, parsed.query, ""))
    except (TypeError, ValueError, UnicodeError):
        raise FundingResearchError(code) from None


def _normal(value: str) -> str:
    return " ".join(
        "".join(character.casefold() if character.isalnum() else " " for character in value).split()
    )


def _website_host(value: str | None) -> str:
    return (urlsplit(value).hostname or "").casefold().rstrip(".") if value else ""


def _snapshot_root(connection: sqlite3.Connection) -> Path:
    database = next(
        (str(row[2]) for row in connection.execute("PRAGMA database_list") if row[1] == "main"),
        "",
    )
    if not database:
        raise FundingResearchError("snapshot_store_required")
    return Path(database).parent / "snapshots"


def _read_capture(root: Path, body_ref: object) -> tuple[str, bytes]:
    try:
        captured = read_capture(root, body_ref, maximum=MAX_PAGE_BYTES)
        return captured.body_ref, captured.contents
    except SourceCaptureError as error:
        if str(error) == "invalid_ref":
            raise FundingResearchError("invalid_body_ref") from None
        if str(error) == "too_large":
            raise FundingResearchError("source_too_large") from None
        raise FundingResearchError("source_changed") from None


def _id(prefix: str, request_id: str, suffix: str) -> str:
    return prefix + uuid.uuid5(
        uuid.NAMESPACE_URL, f"kb:prospecting:funding:{request_id}:{suffix}",
    ).hex


def _literal_int(value: object, code: str, minimum: int, maximum: int) -> int:
    if type(value) is not int or not minimum <= value <= maximum:
        raise FundingResearchError(code)
    return value


def _json_array(value: object, code: str) -> tuple[str, ...]:
    try:
        decoded = json.loads(str(value))
    except (TypeError, json.JSONDecodeError):
        raise FundingResearchError(code) from None
    if not isinstance(decoded, list) or any(type(item) is not str for item in decoded):
        raise FundingResearchError(code)
    return tuple(decoded)


def _coverage(value: object) -> CoverageInput:
    if not isinstance(value, CoverageInput):
        raise FundingResearchError("invalid_coverage")
    query = _text(value.query, "invalid_coverage", maximum=512)
    searched = _timestamp(value.searched_at, "invalid_coverage")
    status = value.status
    count = _literal_int(value.result_count, "invalid_coverage", 0, MAX_RESULTS_PER_QUERY)
    cap = _literal_int(value.result_cap, "invalid_coverage", 1, MAX_RESULTS_PER_QUERY)
    if (
        type(status) is not str or status not in COVERAGE_STATUSES or count > cap
        or (status == "empty" and count != 0)
        or (status == "found" and count == 0)
        or (status in {"blocked", "error"} and count != 0)
    ):
        raise FundingResearchError("invalid_coverage")
    assert query is not None
    return CoverageInput(query, searched.isoformat(), status, count, cap)


def _prepare_request(
    request: object, root: Path,
) -> tuple[FundingResearchRequest, tuple[_Candidate, ...], str]:
    if not isinstance(request, FundingResearchRequest):
        raise FundingResearchError("invalid_request")
    request_id = _uuid(request.request_id)
    if type(request.run_id) is not str or _RUN_ID.fullmatch(request.run_id) is None:
        raise FundingResearchError("invalid_run_id")
    expected_intake_hash = _sha(request.expected_intake_hash, "invalid_intake_hash")
    if (request.predecessor_batch_id is None) != (request.predecessor_hash is None):
        raise FundingResearchError("invalid_predecessor")
    predecessor_id = None
    predecessor_hash = None
    if request.predecessor_batch_id is not None:
        predecessor_id = _text(request.predecessor_batch_id, "invalid_predecessor", maximum=80)
        predecessor_hash = _sha(request.predecessor_hash, "invalid_predecessor")
    if type(request.candidates) is not tuple or not request.candidates:
        raise FundingResearchError("invalid_candidate")
    if len(request.candidates) > MAX_CANDIDATES:
        raise FundingResearchError("candidate_pool_too_large")
    prepared: list[_Candidate] = []
    total_bytes = 0
    keys: set[str] = set()
    request_candidates: list[dict[str, object]] = []
    for capture in request.candidates:
        if not isinstance(capture, CompanyCapture):
            raise FundingResearchError("invalid_candidate")
        name = _text(capture.name, "invalid_candidate", maximum=240)
        website = None if capture.website_url is None else _url(capture.website_url, "invalid_candidate")
        location = _text(capture.location, "invalid_candidate", maximum=240, optional=True)
        sector = _text(capture.sector, "invalid_candidate", maximum=240, optional=True)
        if type(capture.pages) is not tuple or not 1 <= len(capture.pages) <= MAX_PAGES_PER_COMPANY:
            raise FundingResearchError("invalid_page")
        if type(capture.events) is not tuple:
            raise FundingResearchError("invalid_funding_event")
        pages: list[_Page] = []
        coverage_count = 0
        seen_refs: set[str] = set()
        seen_urls: set[str] = set()
        for page in capture.pages:
            if not isinstance(page, CapturedPage):
                raise FundingResearchError("invalid_page")
            ref, contents = _read_capture(root, page.body_ref)
            try:
                contents.decode("utf-8", errors="strict")
            except UnicodeError:
                raise FundingResearchError("invalid_page") from None
            content_sha256 = sha256(contents).hexdigest()
            if page.expected_content_sha256 is not None and _sha(
                page.expected_content_sha256, "invalid_page",
            ) != content_sha256:
                raise FundingResearchError("source_changed")
            source_url = _url(page.source_url, "invalid_source_url")
            kind = page.source_kind
            if type(kind) is not str or kind not in SOURCE_KINDS:
                raise FundingResearchError("invalid_source_kind")
            captured_at = _timestamp(page.captured_at, "invalid_page").isoformat()
            coverage = None if page.coverage is None else _coverage(page.coverage)
            if (kind == "search_coverage") != (coverage is not None):
                raise FundingResearchError("invalid_coverage")
            if (
                coverage is not None
                and _timestamp(coverage.searched_at, "invalid_coverage")
                > _timestamp(captured_at, "invalid_page")
            ):
                raise FundingResearchError("invalid_coverage")
            if coverage is not None:
                coverage_count += 1
            if coverage_count > MAX_QUERIES_PER_COMPANY or ref in seen_refs or source_url in seen_urls:
                raise FundingResearchError("invalid_page")
            seen_refs.add(ref)
            seen_urls.add(source_url)
            total_bytes += len(contents)
            if total_bytes > MAX_BATCH_BYTES:
                raise FundingResearchError("batch_too_large")
            pages.append(_Page(
                ref, str(page.source_url), source_url, kind, captured_at, coverage,
                contents, content_sha256,
            ))
        events: list[FundingEventInput] = []
        used_pages: set[int] = set()
        for event in capture.events:
            if not isinstance(event, FundingEventInput):
                raise FundingResearchError("invalid_funding_event")
            ordinal = _literal_int(
                event.page_ordinal, "invalid_funding_event", 0, len(pages) - 1,
            )
            if ordinal in used_pages or event.stage not in FUNDING_STAGES:
                raise FundingResearchError("invalid_funding_event")
            announced = _date(event.announced_at, "invalid_funding_event").date().isoformat()
            excerpt = _text(event.excerpt, "invalid_funding_event", maximum=1000)
            assert excerpt is not None
            if pages[ordinal].source_kind == "search_coverage":
                raise FundingResearchError("invalid_funding_event")
            page_text = _normal(plain_text(pages[ordinal].contents.decode("utf-8", errors="replace")))
            if not _normal(excerpt) or _normal(excerpt) not in page_text:
                raise FundingResearchError("invalid_funding_event")
            used_pages.add(ordinal)
            events.append(FundingEventInput(ordinal, event.stage, announced, excerpt))
        identity = {
            "name": name, "website_url": website, "location": location, "sector": sector,
        }
        candidate_key = _digest({
            "host": _website_host(website),
            "name": _normal(name), "location": _normal(location or ""),
        })
        if candidate_key in keys:
            raise FundingResearchError("invalid_candidate")
        keys.add(candidate_key)
        candidate = _Candidate(
            name, website, location, sector, tuple(pages), tuple(events),
            candidate_key, _digest(identity),
        )
        prepared.append(candidate)
        request_candidates.append({
            "identity": identity,
            "pages": [{
                "body_ref": page.body_ref, "source_url": page.canonical_url,
                "source_kind": page.source_kind, "captured_at": page.captured_at,
                "content_sha256": page.content_sha256,
                "coverage": None if page.coverage is None else page.coverage.__dict__,
            } for page in pages],
            "events": [event.__dict__ for event in events],
        })
    normalized = FundingResearchRequest(
        request_id, request.run_id, expected_intake_hash,
        predecessor_id, predecessor_hash, request.candidates,
    )
    request_hash = _digest({
        "operation": "import_funding_research", "request_id": request_id,
        "run_id": request.run_id, "expected_intake_hash": expected_intake_hash,
        "predecessor_batch_id": predecessor_id, "predecessor_hash": predecessor_hash,
        "candidates": request_candidates,
        "importer_hash": IMPORTER_HASH, "classifier_hash": CLASSIFIER_HASH,
    })
    return normalized, tuple(prepared), request_hash


def _matches_scope(value: str | None, mode: str, values: tuple[str, ...]) -> bool | None:
    if mode == "any":
        return True
    if mode == "unknown" or value is None:
        return None
    return _normal(value) in {_normal(item) for item in values}


def _query_scoped(query: str, candidate: _Candidate) -> bool:
    query_tokens = _normal(query).split()
    claims = (_normal(candidate.name).split(), _normal(_website_host(candidate.website_url)).split())
    return any(
        claim and any(query_tokens[index:index + len(claim)] == claim for index in range(len(query_tokens)))
        for claim in claims
    )


def _classify(
    candidate: _Candidate, intake: sqlite3.Row, now: datetime,
) -> tuple[str, tuple[str, ...], str | None, str | None]:
    as_of = _date(intake["as_of_date"], "store_state_invalid").date()
    cutoff = _date(intake["cutoff_date"], "store_state_invalid").date()
    events = sorted(candidate.events, key=lambda event: (event.announced_at, FUNDING_STAGES.index(event.stage)))
    if any(_date(event.announced_at, "invalid_funding_event").date() > as_of for event in events):
        return "unknown", ("future_funding_date",), None, None
    by_date: dict[str, set[str]] = {}
    for event in events:
        by_date.setdefault(event.announced_at, set()).add(event.stage)
    if any(len(stages) > 1 for stages in by_date.values()) or any(
        FUNDING_STAGES.index(left.stage) > FUNDING_STAGES.index(right.stage)
        for left, right in zip(events, events[1:])
    ):
        return "unknown", ("conflicting_funding_history",), None, None
    current_coverage = tuple(
        page.coverage for page in candidate.pages
        if page.coverage is not None
        and page.coverage.status in {"found", "empty"}
        and as_of <= _timestamp(page.coverage.searched_at, "invalid_coverage").date() <= now.date()
        and _query_scoped(page.coverage.query, candidate)
    )
    geo = _matches_scope(
        candidate.location, str(intake["geography_mode"]),
        _json_array(intake["geography_json"], "store_state_invalid"),
    )
    sector = _matches_scope(
        candidate.sector, str(intake["sector_mode"]),
        _json_array(intake["sector_json"], "store_state_invalid"),
    )
    if geo is None or sector is None:
        return "unknown", ("scope_claim_missing",), None, None
    if not geo or not sector:
        return "provisional_excluded", ("outside_requested_scope",), None, None
    if not events:
        return "unknown", ("funding_event_missing",), None, None
    if not current_coverage:
        return "unknown", ("current_coverage_missing",), None, None
    min_index = FUNDING_STAGES.index(str(intake["funding_stage_min"]))
    max_index = FUNDING_STAGES.index(str(intake["funding_stage_max"]))
    primary_pairs = {
        (event.stage, event.announced_at) for event in events
        if candidate.pages[event.page_ordinal].source_kind in PRIMARY_KINDS
    }
    eligible = tuple(
        event for event in events
        if cutoff <= _date(event.announced_at, "invalid_funding_event").date() <= as_of
        and min_index <= FUNDING_STAGES.index(event.stage) <= max_index
        and (event.stage, event.announced_at) in primary_pairs
    )
    latest = events[-1]
    latest_pair = (latest.stage, latest.announced_at)
    if str(intake["funding_stage_interpretation"]) == "any_eligible_within_window":
        if eligible:
            return "provisional_match", ("eligible_event_with_current_coverage",), *latest_pair
        if not primary_pairs:
            return "unknown", ("primary_funding_source_missing",), *latest_pair
        return "provisional_excluded", ("no_eligible_event_in_window",), *latest_pair
    if latest_pair not in primary_pairs:
        return "unknown", ("latest_event_primary_source_missing",), *latest_pair
    latest_date = _date(latest.announced_at, "invalid_funding_event").date()
    latest_index = FUNDING_STAGES.index(latest.stage)
    if latest_date < cutoff:
        return "provisional_excluded", ("latest_event_outside_window",), *latest_pair
    if latest_index > max_index:
        return "provisional_excluded", ("later_stage_known",), *latest_pair
    if latest_index < min_index:
        return "provisional_excluded", ("latest_stage_below_minimum",), *latest_pair
    return "provisional_match", ("latest_event_eligible_with_current_coverage",), *latest_pair


class FundingResearchService:
    """Atomic importer and deterministic provisional classifier."""

    def __init__(
        self, connection: sqlite3.Connection, *, now: Callable[[], str] | None = None,
    ) -> None:
        self.connection = connection
        self.connection.row_factory = sqlite3.Row
        self.now = now or (
            lambda: datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        )

    def _context(self, run_id: str, expected_hash: str | None = None) -> sqlite3.Row:
        try:
            validated = PipelineService(self.connection, now=self.now).get_projection(run_id)
        except PipelineError as error:
            code = str(error)
            raise FundingResearchError(
                "run_missing" if code == "run_missing" else "store_state_invalid"
            ) from None
        row = self.connection.execute(
            """SELECT run.run_id,run.intake_id AS run_intake_id,run.campaign_id AS run_campaign_id,
                       run.intake_hash AS run_intake_hash,run.campaign_policy_hash AS run_policy_hash,
                       run.state,run.pending_fields_json,
                       intake.intake_id,intake.campaign_id,intake.intake_hash,
                       intake.campaign_policy_hash,intake.as_of_date,intake.cutoff_date,
                       intake.funding_stage_min,intake.funding_stage_max,
                       intake.funding_stage_interpretation,intake.geography_mode,
                       intake.geography_json,intake.sector_mode,intake.sector_json,
                       intake.requested_companies,campaign.policy_hash AS current_policy_hash
                 FROM prospecting_pipeline_run AS run
                 JOIN prospecting_pipeline_intake AS intake ON intake.intake_id=run.intake_id
                 JOIN campaign ON campaign.campaign_id=run.campaign_id
                WHERE run.run_id=?""", (run_id,),
        ).fetchone()
        if row is None:
            raise FundingResearchError("run_missing")
        if (
            str(row["run_intake_id"]) != str(row["intake_id"])
            or str(row["run_campaign_id"]) != str(row["campaign_id"])
            or str(row["run_intake_hash"]) != str(row["intake_hash"])
            or str(row["run_policy_hash"]) != str(row["campaign_policy_hash"])
            or validated.intake_id != str(row["intake_id"])
            or validated.intake_hash != str(row["intake_hash"])
            or validated.campaign_id != str(row["campaign_id"])
            or validated.campaign_policy_hash != str(row["campaign_policy_hash"])
        ):
            raise FundingResearchError("store_state_invalid")
        latest = self.connection.execute(
            "SELECT intake_id FROM prospecting_pipeline_intake WHERE campaign_id=? ORDER BY intake_revision DESC LIMIT 1",
            (row["campaign_id"],),
        ).fetchone()
        if latest is None or str(latest[0]) != str(row["intake_id"]):
            raise FundingResearchError("intake_stale")
        if expected_hash is not None and str(row["intake_hash"]) != expected_hash:
            raise FundingResearchError("intake_stale")
        if (
            str(row["campaign_policy_hash"]) != str(row["current_policy_hash"])
            or str(row["state"]) == "input_pending"
            or _json_array(row["pending_fields_json"], "store_state_invalid")
        ):
            raise FundingResearchError(
                "input_pending" if str(row["state"]) == "input_pending" else "pipeline_context_stale"
            )
        return row

    def _resolve_company(self, candidate: _Candidate) -> tuple[str | None, bool]:
        rows = self.connection.execute(
            "SELECT company_id,name,website_url FROM company ORDER BY company_id",
        ).fetchall()
        host = _website_host(candidate.website_url)
        domains = [row for row in rows if host and row["website_url"] and _website_host(str(row["website_url"])) == host]
        names = [row for row in rows if _normal(str(row["name"])) == _normal(candidate.name)]
        resolved = {str(row["company_id"]) for row in (*domains, *names)}
        if (
            len(resolved) > 1 or len(domains) > 1 or len(names) > 1
            or (domains and _normal(str(domains[0]["name"])) != _normal(candidate.name))
            or (names and host and names[0]["website_url"] and _website_host(str(names[0]["website_url"])) != host)
        ):
            return None, True
        if resolved:
            return next(iter(resolved)), False
        return None, False

    def _copy_snapshot(
        self, root: Path, snapshot_id: str, contents: bytes,
        created: list[tuple[Path, tuple[int, int]]],
    ) -> str:
        try:
            return copy_owned(
                root, namespace="funding-research", snapshot_id=snapshot_id,
                contents=contents, maximum=MAX_PAGE_BYTES, created=created,
            )
        except SourceCaptureError:
            raise FundingResearchError("source_changed") from None

    def import_and_classify(self, request: FundingResearchRequest) -> FundingResearchResult:
        root = _snapshot_root(self.connection)
        normalized, candidates, request_hash = _prepare_request(request, root)
        if self.connection.in_transaction:
            raise FundingResearchError("transaction_active")
        created: list[tuple[Path, tuple[int, int]]] = []
        self.connection.execute("BEGIN IMMEDIATE")
        try:
            context = self._context(normalized.run_id, normalized.expected_intake_hash)
            if len(candidates) > min(MAX_CANDIDATES, 3 * int(context["requested_companies"])):
                raise FundingResearchError("candidate_pool_too_large")
            replay = self.connection.execute(
                "SELECT request_hash,batch_id FROM prospecting_funding_batch WHERE request_id=?",
                (normalized.request_id,),
            ).fetchone()
            if replay is not None:
                if str(replay["request_hash"]) != request_hash:
                    raise FundingResearchError("request_conflict")
                projection = self._projection(str(replay["batch_id"]), context)
                self.connection.commit()
                return self._result(projection, True)
            latest = self.connection.execute(
                "SELECT batch_id,batch_hash FROM prospecting_funding_batch WHERE run_id=? ORDER BY rowid DESC LIMIT 1",
                (normalized.run_id,),
            ).fetchone()
            wanted = None if latest is None else (str(latest["batch_id"]), str(latest["batch_hash"]))
            supplied = (normalized.predecessor_batch_id, normalized.predecessor_hash)
            if supplied != (None, None) and wanted != supplied or supplied == (None, None) and wanted is not None:
                raise FundingResearchError("predecessor_conflict")
            stamp_dt = _timestamp(self.now(), "store_state_invalid")
            stamp = stamp_dt.isoformat()
            for candidate in candidates:
                for page in candidate.pages:
                    captured = _timestamp(page.captured_at, "invalid_page")
                    if captured > stamp_dt or captured + timedelta(days=30) < stamp_dt:
                        raise FundingResearchError("source_stale")
            batch_id = _id("pfrb_", normalized.request_id, "batch")
            company_rows: list[dict[str, object]] = []
            claimed_company_ids: set[str] = set()
            for ordinal, candidate in enumerate(candidates):
                result_id = _id("pfrr_", normalized.request_id, f"result:{ordinal}")
                company_id, collision = self._resolve_company(candidate)
                if company_id in claimed_company_ids:
                    collision = True
                    company_id = None
                if not collision and company_id is None:
                    company_id = _id("co_", normalized.request_id, f"company:{ordinal}")
                    try:
                        self.connection.execute(
                            """INSERT INTO company(company_id,name,website_url,industry,location,source_lane,dedupe_key)
                               VALUES(?,?,?,?,?,'manual',?)""",
                            (company_id, candidate.name, candidate.website_url, candidate.sector,
                             candidate.location, "funding:" + candidate.candidate_key),
                        )
                    except sqlite3.IntegrityError:
                        company_id, collision = None, True
                if company_id is not None:
                    claimed_company_ids.add(company_id)
                if collision:
                    outcome, reasons, latest_stage, latest_at = (
                        "collision_refused", ("company_identity_collision",), None, None,
                    )
                else:
                    outcome, reasons, latest_stage, latest_at = _classify(candidate, context, stamp_dt)
                source_specs: list[dict[str, object]] = []
                event_map = {event.page_ordinal: event for event in candidate.events}
                for page_ordinal, page in enumerate(candidate.pages):
                    snapshot_id = _id("snap_", normalized.request_id, f"snapshot:{ordinal}:{page_ordinal}")
                    observation_id = None if collision else _id(
                        "obs_", normalized.request_id, f"observation:{ordinal}:{page_ordinal}",
                    )
                    event = event_map.get(page_ordinal)
                    binding_kind = "collision_capture" if collision else (
                        "funding_event" if event is not None else "coverage" if page.coverage else "company_identity"
                    )
                    observation_value = None if collision else {
                        "candidate_identity_hash": candidate.identity_hash,
                        "source_url": page.canonical_url,
                        "source_kind": page.source_kind,
                        "event": None if event is None else {
                            "stage": event.stage, "announced_at": event.announced_at,
                            "excerpt": event.excerpt,
                        },
                        "coverage": None if page.coverage is None else page.coverage.__dict__,
                    }
                    observation_hash = None if observation_value is None else _digest(observation_value)
                    source_specs.append({
                        "ordinal": page_ordinal, "binding_kind": binding_kind,
                        "page": page, "snapshot_id": snapshot_id,
                        "observation_id": observation_id, "observation_value": observation_value,
                        "observation_hash": observation_hash,
                        "excerpt_hash": None if event is None else sha256(event.excerpt.encode()).hexdigest(),
                    })
                source_set_hash = _digest([{
                    "ordinal": item["ordinal"], "binding_kind": item["binding_kind"],
                    "source_kind": item["page"].source_kind,
                    "source_url": item["page"].canonical_url,
                    "retrieved_at": item["page"].captured_at,
                    "content_sha256": item["page"].content_sha256,
                    "observation_hash": item["observation_hash"],
                    "excerpt_hash": item["excerpt_hash"],
                } for item in source_specs])
                company_rows.append({
                    "result_id": result_id, "ordinal": ordinal, "candidate": candidate,
                    "company_id": company_id, "outcome": outcome, "reasons": reasons,
                    "latest_stage": latest_stage, "latest_at": latest_at,
                    "sources": source_specs, "source_set_hash": source_set_hash,
                })
            batch_hash = _digest({
                "batch_id": batch_id, "run_id": normalized.run_id,
                "intake_hash": normalized.expected_intake_hash,
                "predecessor_batch_id": normalized.predecessor_batch_id,
                "predecessor_hash": normalized.predecessor_hash,
                "request_hash": request_hash,
                "results": [{
                    "result_id": item["result_id"], "ordinal": item["ordinal"],
                    "company_identity_hash": item["candidate"].identity_hash,
                    "outcome": item["outcome"], "reasons": item["reasons"],
                    "latest_stage": item["latest_stage"], "latest_at": item["latest_at"],
                    "source_set_hash": item["source_set_hash"],
                } for item in company_rows],
            })
            self.connection.execute(
                """INSERT INTO prospecting_funding_batch(
                       batch_id,request_id,request_hash,batch_hash,run_id,intake_id,intake_hash,
                       campaign_policy_hash,predecessor_batch_id,predecessor_hash,importer_version,
                       importer_hash,classifier_version,classifier_hash,created_at)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (batch_id, normalized.request_id, request_hash, batch_hash, normalized.run_id,
                 context["intake_id"], context["intake_hash"], context["campaign_policy_hash"],
                 normalized.predecessor_batch_id, normalized.predecessor_hash, IMPORTER_VERSION,
                 IMPORTER_HASH, CLASSIFIER_VERSION, CLASSIFIER_HASH, stamp),
            )
            root.mkdir(parents=True, exist_ok=True)
            for item in company_rows:
                candidate = item["candidate"]
                identity_json = _canonical({
                    "name": candidate.name, "website_url": candidate.website_url,
                    "location": candidate.location, "sector": candidate.sector,
                })
                self.connection.execute(
                    """INSERT INTO prospecting_funding_company(
                           result_id,batch_id,ordinal,company_id,candidate_name,candidate_identity_json,
                           candidate_key,company_identity_hash,rule_outcome,reason_codes_json,
                           latest_stage,latest_announced_at,source_set_hash,created_at)
                       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (item["result_id"], batch_id, item["ordinal"], item["company_id"],
                     candidate.name, identity_json, candidate.candidate_key, candidate.identity_hash,
                     item["outcome"], _canonical(list(item["reasons"])), item["latest_stage"],
                     item["latest_at"], item["source_set_hash"], stamp),
                )
                for spec in item["sources"]:
                    page = spec["page"]
                    body_ref = self._copy_snapshot(root, spec["snapshot_id"], page.contents, created)
                    expires = (_timestamp(page.captured_at, "invalid_page") + timedelta(days=30)).isoformat()
                    self.connection.execute(
                        """INSERT INTO source_snapshot(
                               snapshot_id,entity_id,source_url,source_domain,retrieved_at,content_type,
                               content_sha256,allowlist_version,body_ref,expires_at,retention_delete_at)
                           VALUES(?,?,?,?,?,'text/plain',?,'operator-public-capture-v1',?,?,?)""",
                        (spec["snapshot_id"], item["result_id"] if item["company_id"] is None else item["company_id"],
                         page.canonical_url, urlsplit(page.canonical_url).hostname, page.captured_at,
                         page.content_sha256, body_ref, expires, expires),
                    )
                    if spec["observation_id"] is not None:
                        self.connection.execute(
                            """INSERT INTO source_observation(
                                   observation_id,entity_type,entity_id,field,value,source,seen_at,
                                   retrieved_at,confidence,snapshot_id)
                               VALUES(?,'company',?,?,?,?,?,?,1.0,?)""",
                            (spec["observation_id"], item["company_id"],
                             "funding_event" if spec["binding_kind"] == "funding_event" else
                             "funding_coverage" if spec["binding_kind"] == "coverage" else "company_identity",
                             _canonical(spec["observation_value"]), spec["snapshot_id"], page.captured_at,
                             stamp, spec["snapshot_id"]),
                        )
                    coverage = None if item["company_id"] is None else page.coverage
                    self.connection.execute(
                        """INSERT INTO prospecting_funding_source(
                               result_id,ordinal,binding_kind,source_kind,snapshot_id,observation_id,
                               expected_source_url,expected_retrieved_at,expected_content_sha256,
                               expected_observation_hash,excerpt_sha256,
                               query_text,searched_at,coverage_status,result_count,result_cap)
                           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                        (item["result_id"], spec["ordinal"], spec["binding_kind"], page.source_kind,
                         spec["snapshot_id"], spec["observation_id"], page.canonical_url,
                         page.captured_at, page.content_sha256,
                         spec["observation_hash"], spec["excerpt_hash"],
                         None if coverage is None else coverage.query,
                         None if coverage is None else coverage.searched_at,
                         None if coverage is None else coverage.status,
                         None if coverage is None else coverage.result_count,
                         None if coverage is None else coverage.result_cap),
                    )
            projection = self._projection(batch_id, context)
            self.connection.commit()
            return self._result(projection, False)
        except BaseException as error:
            self.connection.rollback()
            cleanup_owned(created)
            if isinstance(error, FundingResearchError):
                raise
            if isinstance(error, sqlite3.Error):
                raise FundingResearchError("store_state_invalid") from None
            raise

    def _projection(self, batch_id: str, context: sqlite3.Row) -> FundingResearchProjection:
        batch = self.connection.execute(
            "SELECT * FROM prospecting_funding_batch WHERE batch_id=?", (batch_id,),
        ).fetchone()
        if batch is None:
            raise FundingResearchError("store_state_invalid")
        if (
            str(batch["intake_id"]) != str(context["intake_id"])
            or str(batch["intake_hash"]) != str(context["intake_hash"])
            or str(batch["campaign_policy_hash"]) != str(context["current_policy_hash"])
            or str(batch["importer_hash"]) != IMPORTER_HASH
            or str(batch["classifier_hash"]) != CLASSIFIER_HASH
        ):
            raise FundingResearchError("pipeline_context_stale")
        rows = self.connection.execute(
            "SELECT * FROM prospecting_funding_company WHERE batch_id=? ORDER BY ordinal",
            (batch_id,),
        ).fetchall()
        companies: list[CompanyFundingProjection] = []
        hash_results: list[dict[str, object]] = []
        root = _snapshot_root(self.connection)
        for row in rows:
            sources = self.connection.execute(
                "SELECT * FROM prospecting_funding_source WHERE result_id=? ORDER BY ordinal",
                (row["result_id"],),
            ).fetchall()
            source_summary: list[dict[str, object]] = []
            for source in sources:
                snapshot = self.connection.execute(
                    "SELECT * FROM source_snapshot WHERE snapshot_id=?", (source["snapshot_id"],),
                ).fetchone()
                if snapshot is None:
                    raise FundingResearchError("store_state_invalid")
                if (
                    str(snapshot["source_url"]) != str(source["expected_source_url"])
                    or str(snapshot["retrieved_at"]) != str(source["expected_retrieved_at"])
                    or str(snapshot["content_sha256"]) != str(source["expected_content_sha256"])
                    or str(snapshot["allowlist_version"]) != "operator-public-capture-v1"
                    or str(snapshot["content_type"]) != "text/plain"
                ):
                    raise FundingResearchError("store_state_invalid")
                try:
                    expiry = _timestamp(snapshot["expires_at"], "store_state_invalid")
                    if expiry < _timestamp(self.now(), "store_state_invalid"):
                        raise FundingResearchError("source_stale")
                except FundingResearchError:
                    raise
                try:
                    _, body = _read_stored_snapshot(root, str(snapshot["body_ref"]))
                except FundingResearchError:
                    raise
                if sha256(body).hexdigest() != str(source["expected_content_sha256"]):
                    raise FundingResearchError("source_changed")
                observation_hash = source["expected_observation_hash"]
                if source["observation_id"] is None:
                    if observation_hash is not None:
                        raise FundingResearchError("store_state_invalid")
                else:
                    observation = self.connection.execute(
                        "SELECT * FROM source_observation WHERE observation_id=? AND snapshot_id=?",
                        (source["observation_id"], source["snapshot_id"]),
                    ).fetchone()
                    if observation is None:
                        raise FundingResearchError("store_state_invalid")
                    expected_field = (
                        "funding_event" if str(source["binding_kind"]) == "funding_event" else
                        "funding_coverage" if str(source["binding_kind"]) == "coverage" else
                        "company_identity"
                    )
                    if (
                        str(observation["entity_type"]) != "company"
                        or str(observation["entity_id"]) != str(row["company_id"])
                        or str(observation["field"]) != expected_field
                        or str(observation["source"]) != str(source["snapshot_id"])
                    ):
                        raise FundingResearchError("store_state_invalid")
                    try:
                        value = json.loads(str(observation["value"]))
                    except json.JSONDecodeError:
                        raise FundingResearchError("store_state_invalid") from None
                    if _digest(value) != str(observation_hash):
                        raise FundingResearchError("store_state_invalid")
                source_summary.append({
                    "ordinal": int(source["ordinal"]), "binding_kind": str(source["binding_kind"]),
                    "source_kind": str(source["source_kind"]),
                    "source_url": str(source["expected_source_url"]),
                    "retrieved_at": str(source["expected_retrieved_at"]),
                    "content_sha256": str(source["expected_content_sha256"]),
                    "observation_hash": None if observation_hash is None else str(observation_hash),
                    "excerpt_hash": source["excerpt_sha256"],
                })
            if _digest(source_summary) != str(row["source_set_hash"]):
                raise FundingResearchError("store_state_invalid")
            reasons = _json_array(row["reason_codes_json"], "store_state_invalid")
            companies.append(CompanyFundingProjection(
                str(row["result_id"]), int(row["ordinal"]),
                None if row["company_id"] is None else str(row["company_id"]),
                str(row["candidate_name"]), str(row["rule_outcome"]), reasons,
                None if row["latest_stage"] is None else str(row["latest_stage"]),
                None if row["latest_announced_at"] is None else str(row["latest_announced_at"]),
                len(sources), tuple(FundingSourceProjection(
                    str(source["expected_source_url"]), str(source["source_kind"]),
                    str(source["binding_kind"]), str(source["expected_retrieved_at"]),
                ) for source in sources),
            ))
            hash_results.append({
                "result_id": str(row["result_id"]), "ordinal": int(row["ordinal"]),
                "company_identity_hash": str(row["company_identity_hash"]),
                "outcome": str(row["rule_outcome"]), "reasons": reasons,
                "latest_stage": row["latest_stage"], "latest_at": row["latest_announced_at"],
                "source_set_hash": str(row["source_set_hash"]),
            })
        expected_batch_hash = _digest({
            "batch_id": str(batch["batch_id"]), "run_id": str(batch["run_id"]),
            "intake_hash": str(batch["intake_hash"]),
            "predecessor_batch_id": batch["predecessor_batch_id"],
            "predecessor_hash": batch["predecessor_hash"],
            "request_hash": str(batch["request_hash"]), "results": hash_results,
        })
        if expected_batch_hash != str(batch["batch_hash"]):
            raise FundingResearchError("store_state_invalid")
        counts = {name: sum(item.rule_outcome == name for item in companies) for name in (
            "provisional_match", "provisional_excluded", "unknown", "collision_refused",
        )}
        desired = int(context["requested_companies"])
        return FundingResearchProjection(
            str(batch["batch_id"]), str(batch["batch_hash"]), str(batch["run_id"]),
            str(batch["intake_id"]), str(batch["intake_hash"]),
            None if batch["predecessor_batch_id"] is None else str(batch["predecessor_batch_id"]),
            None if batch["predecessor_hash"] is None else str(batch["predecessor_hash"]),
            "awaiting_qualification_factcheck", desired, len(companies),
            counts["provisional_match"], counts["provisional_excluded"], counts["unknown"],
            counts["collision_refused"], max(0, desired - counts["provisional_match"]),
            tuple(companies),
        )

    @staticmethod
    def _result(value: FundingResearchProjection, replayed: bool) -> FundingResearchResult:
        return FundingResearchResult(
            value.batch_id, value.batch_hash, value.run_id, value.state,
            MappingProxyType({
                "candidates": value.candidate_count,
                "provisional_matches": value.provisional_match_count,
                "provisional_excluded": value.provisional_excluded_count,
                "unknown": value.unknown_count,
                "collisions": value.collision_count,
                "provisional_shortfall": value.provisional_shortfall,
            }), replayed,
        )

    def get_projection(self, run_id: str) -> FundingResearchProjection | None:
        if type(run_id) is not str or _RUN_ID.fullmatch(run_id) is None:
            raise FundingResearchError("invalid_run_id")
        context = self._context(run_id)
        row = self.connection.execute(
            "SELECT batch_id FROM prospecting_funding_batch WHERE run_id=? ORDER BY rowid DESC LIMIT 1",
            (run_id,),
        ).fetchone()
        return None if row is None else self._projection(str(row["batch_id"]), context)

    def get_safe_projection(self, run_id: str) -> FundingResearchSafeProjection | None:
        projection = self.get_projection(run_id)
        if projection is None:
            return None
        return FundingResearchSafeProjection(
            projection.batch_id, projection.batch_hash, projection.run_id,
            projection.intake_hash, projection.state,
            MappingProxyType({
                "desired_companies": projection.desired_companies,
                "candidates": projection.candidate_count,
                "provisional_matches": projection.provisional_match_count,
                "provisional_excluded": projection.provisional_excluded_count,
                "unknown": projection.unknown_count,
                "collisions": projection.collision_count,
                "provisional_shortfall": projection.provisional_shortfall,
            }),
        )


def _read_stored_snapshot(root: Path, body_ref: str) -> tuple[str, bytes]:
    try:
        captured = read_owned(root, body_ref, maximum=MAX_PAGE_BYTES)
        return captured.body_ref, captured.contents
    except SourceCaptureError:
        raise FundingResearchError("source_changed") from None


__all__ = [
    "CapturedPage", "CompanyCapture", "CompanyFundingProjection", "CoverageInput",
    "FundingEventInput", "FundingResearchError", "FundingResearchProjection",
    "FundingResearchRequest", "FundingResearchResult", "FundingResearchSafeProjection",
    "FundingResearchService", "FundingSourceProjection",
]
