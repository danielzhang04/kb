from __future__ import annotations

from dataclasses import replace
from pathlib import Path
import sqlite3
import uuid

import pytest

from scripts.prospecting.capture_import_compiler import (
    COMPILER_VERSION,
    CaptureCompileError,
    CaptureImportCompiler,
    CaptureRef,
    CompanyAnnotation,
    CoverageAnnotation,
    ExcerptSpan,
    FundingCompileRequest,
    FundingEventAnnotation,
    PageAnnotation,
    PersonAnnotation,
    PersonCompileRequest,
)
from scripts.prospecting.funding_research_service import (
    FundingResearchError,
    FundingResearchService,
)
from scripts.prospecting.person_research_service import (
    MAX_CANDIDATES as MAX_PERSON_CANDIDATES,
    PersonResearchService,
)
from scripts.prospecting.pipeline_service import (
    PipelineService,
    PipelineStartRequest,
    ScopeSpec,
)
from scripts.prospecting.research_capture_service import (
    OPEN_KIND,
    SEARCH_KIND,
    CaptureClaimRequest,
    CaptureFinishRequest,
    CaptureService,
    CaptureSessionRequest,
    CaptureSubmitRequest,
    CaptureTaskRequest,
)
from scripts.prospecting.store import open_store


STAMP = "2026-09-10T12:00:00Z"
CAMPAIGN_ID = "camp_aaaabbbbccccdddd"
POLICY_HASH = "a" * 64
SKILL_HASH = "c" * 64
EVENT_TEXT = "Nimbus Systems announced series_b on 2025-05-01."
SEARCH_TEXT = "Results for Nimbus Systems funding: one announcement."
TEAM_TEXT = (
    "Avery Alpha is Head of Operations at Nimbus Systems. "
    "Blake Beta is VP Strategy at Nimbus Systems."
)


class _Clock:
    def __init__(self, value: str = STAMP) -> None:
        self.value = value

    def __call__(self) -> str:
        return self.value


class _Ids:
    """Deterministic distinct request identifiers for the real services."""

    def __init__(self) -> None:
        self.counter = 0

    def next(self) -> str:
        self.counter += 1
        return str(uuid.UUID(fields=(self.counter, 0, 0x4000, 0x80, 0x00, 0)))


def _seed(connection: sqlite3.Connection):
    connection.execute(
        "INSERT INTO sender_profile VALUES(?,?,?,?,?,?,?)",
        ("sender-synthetic", "Synthetic Sender", None, "software", "operations", "tools", "{}"),
    )
    connection.execute(
        """INSERT INTO campaign(
               campaign_id,intent,sender_profile_id,policy_json,ask_type,ask_minutes,tone,
               template_family,cadence,send_window,timezone,daily_cap,hourly_cap,
               firm_collision_cap,approval_tier,mailbox_id,evidence_rules,credit_budget,
               status,policy_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (CAMPAIGN_ID, "networking", "sender-synthetic", "{}", "informational_call", 15,
         "warm", "networking-v1", "[]", "09:00-17:00", "America/New_York", 25, 6,
         2, "T0", "mailbox-synthetic", "{}", 0, "draft", POLICY_HASH),
    )
    return PipelineService(connection, now=lambda: STAMP).start_or_resume(PipelineStartRequest(
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", CAMPAIGN_ID, "2026-09-09",
        "series_a", "series_c", 3, "latest_known", ScopeSpec("any"), ScopeSpec("any"),
        2, 2, ("operations", "strategy"), "Synthetic capture compilation", "Coffee chat",
    ))


def _capture(
    service: CaptureService, session, ids: _Ids, tmp_path: Path, *,
    name: str, text: str, url: str | None = None, query: str | None = None,
    submitted_url: str | None = None,
) -> CaptureRef:
    """Run the real capture lifecycle once and return its exact reference."""
    kind = OPEN_KIND if url is not None else SEARCH_KIND
    task = service.enqueue_task(CaptureTaskRequest(
        ids.next(), session.session_id, kind, query, url,
    ))
    lease = service.claim_task(CaptureClaimRequest(session.session_id, 60))
    assert lease is not None and lease.task_id == task.task_id
    folder = tmp_path / "snapshots" / "incoming"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / f"{name}.txt").write_text(text, encoding="utf-8")
    receipt = service.submit_capture(CaptureSubmitRequest(
        task.task_id, lease.lease_token, f"incoming/{name}.txt",
        url if url is not None else (submitted_url or "https://search.test/nimbus"), STAMP,
    ))
    return CaptureRef(task.task_id, receipt.receipt_id, receipt.content_sha256)


def _fixture(tmp_path: Path, clock: _Clock | None = None):
    connection = open_store(tmp_path / "store.sqlite")
    started = _seed(connection)
    ids = _Ids()
    captures = CaptureService(connection, now=clock or _Clock())
    session = captures.start_session(CaptureSessionRequest(
        ids.next(), started.run_id, started.intake_hash, SKILL_HASH,
    ))
    return connection, started, ids, captures, session


def _funding_annotation(event_ref: CaptureRef, search_ref: CaptureRef, text: str = EVENT_TEXT):
    return CompanyAnnotation(
        "Nimbus Systems", "https://nimbus.test/", "United States", "software",
        (
            PageAnnotation(event_ref, "issuer"),
            PageAnnotation(search_ref, "search_coverage", CoverageAnnotation("found", 1, 20)),
        ),
        (FundingEventAnnotation(0, "series_b", "2025-05-01", ExcerptSpan(0, len(text))),),
    )


def _funding_request(started, session, ids: _Ids, company: CompanyAnnotation, *, request_id=None):
    return FundingCompileRequest(
        request_id or ids.next(), session.session_id, started.run_id,
        started.intake_hash, None, None, (company,),
    )


def _funding_pair(captures, session, ids, tmp_path, *, suffix: str = "one", text: str = EVENT_TEXT):
    event_ref = _capture(
        captures, session, ids, tmp_path, name=f"event-{suffix}", text=text,
        url="https://nimbus.test/funding",
    )
    search_ref = _capture(
        captures, session, ids, tmp_path, name=f"search-{suffix}", text=SEARCH_TEXT,
        query="Nimbus Systems funding",
    )
    return event_ref, search_ref


def _table_counts(connection: sqlite3.Connection) -> dict[str, int]:
    tables = [
        str(row[0]) for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
        )
    ]
    return {name: connection.execute(f"SELECT count(*) FROM {name}").fetchone()[0] for name in tables}


def test_compiled_funding_request_imports_and_derives_fields_from_captures(tmp_path: Path) -> None:
    connection, started, ids, captures, session = _fixture(tmp_path)
    event_ref, search_ref = _funding_pair(captures, session, ids, tmp_path)
    compiler = CaptureImportCompiler(connection, now=_Clock())
    before = _table_counts(connection)
    compiled = compiler.compile_funding(
        _funding_request(started, session, ids, _funding_annotation(event_ref, search_ref)),
    )
    assert _table_counts(connection) == before
    assert connection.in_transaction is False

    page = compiled.request.candidates[0].pages[0]
    coverage_page = compiled.request.candidates[0].pages[1]
    assert page.source_url == "https://nimbus.test/funding"
    assert page.captured_at == compiled.capture_refs[0].retrieved_at
    assert page.expected_content_sha256 == event_ref.expected_content_sha256
    assert coverage_page.coverage.query == "Nimbus Systems funding"
    assert coverage_page.coverage.searched_at == compiled.capture_refs[1].retrieved_at
    assert compiled.request.candidates[0].events[0].excerpt == EVENT_TEXT
    assert tuple(item.task_id for item in compiled.capture_refs) == (
        event_ref.task_id, search_ref.task_id,
    )
    assert all(item.snapshot_id and item.receipt_id for item in compiled.capture_refs)

    result = FundingResearchService(connection, now=lambda: STAMP).import_and_classify(
        compiled.request,
    )
    assert result.counts["provisional_matches"] == 1
    connection.close()


def test_recompiling_the_same_captures_is_byte_identical_and_import_replays(tmp_path: Path) -> None:
    connection, started, ids, captures, session = _fixture(tmp_path)
    event_ref, search_ref = _funding_pair(captures, session, ids, tmp_path)
    compiler = CaptureImportCompiler(connection, now=_Clock())
    request = _funding_request(started, session, ids, _funding_annotation(event_ref, search_ref))
    first = compiler.compile_funding(request)
    second = compiler.compile_funding(request)
    assert first.request == second.request
    assert first.capture_refs == second.capture_refs
    importer = FundingResearchService(connection, now=lambda: STAMP)
    original = importer.import_and_classify(first.request)
    replayed = importer.import_and_classify(second.request)
    assert replayed.replayed is True and replayed.batch_hash == original.batch_hash
    connection.close()


def test_tamper_before_compile_is_refused_at_compile_time(tmp_path: Path) -> None:
    connection, started, ids, captures, session = _fixture(tmp_path)
    event_ref, search_ref = _funding_pair(captures, session, ids, tmp_path)
    body_ref = connection.execute(
        """SELECT s.body_ref FROM source_snapshot AS s
             JOIN prospecting_capture_receipt AS r ON r.snapshot_id=s.snapshot_id
            WHERE r.task_id=?""", (event_ref.task_id,),
    ).fetchone()[0]
    (tmp_path / "snapshots" / body_ref).write_text("tampered", encoding="utf-8")
    compiler = CaptureImportCompiler(connection, now=_Clock())
    with pytest.raises(CaptureCompileError, match="^source_changed$"):
        compiler.compile_funding(
            _funding_request(started, session, ids, _funding_annotation(event_ref, search_ref)),
        )
    connection.close()


def test_tamper_between_compile_and_import_fails_inside_the_importer(tmp_path: Path) -> None:
    connection, started, ids, captures, session = _fixture(tmp_path)
    event_ref, search_ref = _funding_pair(captures, session, ids, tmp_path)
    compiled = CaptureImportCompiler(connection, now=_Clock()).compile_funding(
        _funding_request(started, session, ids, _funding_annotation(event_ref, search_ref)),
    )
    (tmp_path / "snapshots" / compiled.request.candidates[0].pages[0].body_ref).write_text(
        "changed after compile", encoding="utf-8",
    )
    with pytest.raises(FundingResearchError, match="^source_changed$"):
        FundingResearchService(connection, now=lambda: STAMP).import_and_classify(compiled.request)
    assert connection.execute(
        "SELECT count(*) FROM prospecting_funding_batch",
    ).fetchone()[0] == 0
    connection.close()


def test_wrong_receipt_hash_session_and_run_are_refused(tmp_path: Path) -> None:
    connection, started, ids, captures, session = _fixture(tmp_path)
    event_ref, search_ref = _funding_pair(captures, session, ids, tmp_path)
    compiler = CaptureImportCompiler(connection, now=_Clock())

    wrong_receipt = replace(event_ref, expected_receipt_id="pcr_" + "0" * 32)
    with pytest.raises(CaptureCompileError, match="^receipt_mismatch$"):
        compiler.compile_funding(_funding_request(
            started, session, ids, _funding_annotation(wrong_receipt, search_ref),
        ))
    wrong_hash = replace(event_ref, expected_content_sha256="0" * 64)
    with pytest.raises(CaptureCompileError, match="^content_sha256_mismatch$"):
        compiler.compile_funding(_funding_request(
            started, session, ids, _funding_annotation(wrong_hash, search_ref),
        ))

    other_session = captures.start_session(CaptureSessionRequest(
        ids.next(), started.run_id, started.intake_hash, SKILL_HASH,
    ))
    scoped = _funding_request(started, session, ids, _funding_annotation(event_ref, search_ref))
    with pytest.raises(CaptureCompileError, match="^capture_scope_mismatch$"):
        compiler.compile_funding(replace(scoped, session_id=other_session.session_id))
    with pytest.raises(CaptureCompileError, match="^capture_scope_mismatch$"):
        compiler.compile_funding(replace(scoped, run_id="prun_" + "0" * 32))
    with pytest.raises(CaptureCompileError, match="^capture_scope_mismatch$"):
        compiler.compile_funding(replace(scoped, expected_intake_hash="b" * 64))
    connection.close()


def test_spans_are_exact_unicode_codepoint_slices(tmp_path: Path) -> None:
    connection, started, ids, captures, session = _fixture(tmp_path)
    text = "🚀 Nimbus Systems announced series_b on 2025-05-01."
    event_ref, search_ref = _funding_pair(captures, session, ids, tmp_path, text=text)
    company = replace(
        _funding_annotation(event_ref, search_ref),
        events=(FundingEventAnnotation(0, "series_b", "2025-05-01", ExcerptSpan(2, len(text))),),
    )
    compiled = CaptureImportCompiler(connection, now=_Clock()).compile_funding(
        _funding_request(started, session, ids, company),
    )
    excerpt = compiled.request.candidates[0].events[0].excerpt
    assert excerpt == text[2:]
    # A byte-oriented slice of the same offsets would not agree.
    assert excerpt != text.encode("utf-8")[2:].decode("utf-8", errors="replace")
    result = FundingResearchService(connection, now=lambda: STAMP).import_and_classify(
        compiled.request,
    )
    assert result.counts["provisional_matches"] == 1
    connection.close()


@pytest.mark.parametrize(
    "span",
    (
        ExcerptSpan(5, 5),
        ExcerptSpan(-1, 4),
        ExcerptSpan(0, len(EVENT_TEXT) + 1),
        ExcerptSpan(True, 4),
        ExcerptSpan(0, True),
        ExcerptSpan("0", 4),
        "0:4",
    ),
)
def test_invalid_spans_have_one_fixed_code(tmp_path: Path, span) -> None:
    connection, started, ids, captures, session = _fixture(tmp_path)
    event_ref, search_ref = _funding_pair(captures, session, ids, tmp_path)
    company = replace(
        _funding_annotation(event_ref, search_ref),
        events=(FundingEventAnnotation(0, "series_b", "2025-05-01", span),),
    )
    with pytest.raises(CaptureCompileError, match="^invalid_span$"):
        CaptureImportCompiler(connection, now=_Clock()).compile_funding(
            _funding_request(started, session, ids, company),
        )
    connection.close()


@pytest.mark.parametrize(
    "ref",
    (
        "pct_not_a_ref",
        CaptureRef(b"bytes", "pcr_x", "0" * 64),
        CaptureRef("pct_x", "   ", "0" * 64),
        CaptureRef("pct_x", "pcr_x", "not-hex"),
    ),
)
def test_invalid_capture_references_are_refused(tmp_path: Path, ref) -> None:
    connection, started, ids, captures, session = _fixture(tmp_path)
    _event_ref, search_ref = _funding_pair(captures, session, ids, tmp_path)
    company = CompanyAnnotation(
        "Nimbus Systems", "https://nimbus.test/", "United States", "software",
        (
            PageAnnotation(ref, "issuer"),
            PageAnnotation(search_ref, "search_coverage", CoverageAnnotation("found", 1, 20)),
        ),
        (),
    )
    with pytest.raises(CaptureCompileError, match="^invalid_capture_ref$"):
        CaptureImportCompiler(connection, now=_Clock()).compile_funding(
            _funding_request(started, session, ids, company),
        )
    connection.close()


def test_search_and_open_kinds_may_not_be_swapped(tmp_path: Path) -> None:
    connection, started, ids, captures, session = _fixture(tmp_path)
    event_ref, search_ref = _funding_pair(captures, session, ids, tmp_path)
    compiler = CaptureImportCompiler(connection, now=_Clock())
    open_as_search = CompanyAnnotation(
        "Nimbus Systems", "https://nimbus.test/", "United States", "software",
        (PageAnnotation(event_ref, "search_coverage", CoverageAnnotation("found", 1, 20)),), (),
    )
    with pytest.raises(CaptureCompileError, match="^capture_kind_mismatch$"):
        compiler.compile_funding(_funding_request(started, session, ids, open_as_search))
    search_as_open = CompanyAnnotation(
        "Nimbus Systems", "https://nimbus.test/", "United States", "software",
        (PageAnnotation(search_ref, "issuer"),), (),
    )
    with pytest.raises(CaptureCompileError, match="^capture_kind_mismatch$"):
        compiler.compile_funding(_funding_request(started, session, ids, search_as_open))
    connection.close()


def test_a_failed_task_never_becomes_empty_search_coverage(tmp_path: Path) -> None:
    connection, started, ids, captures, session = _fixture(tmp_path)
    task = captures.enqueue_task(CaptureTaskRequest(
        ids.next(), session.session_id, SEARCH_KIND, "Nimbus Systems funding", None,
    ))
    for _attempt in range(3):
        lease = captures.claim_task(CaptureClaimRequest(session.session_id, 60))
        assert lease is not None
        captures.finish_attempt(CaptureFinishRequest(lease.task_id, lease.lease_token, "no_result"))
    assert captures.get_progress(session.session_id).counts["failed"] == 1
    company = CompanyAnnotation(
        "Nimbus Systems", "https://nimbus.test/", "United States", "software",
        (
            PageAnnotation(
                CaptureRef(task.task_id, "pcr_" + "0" * 32, "0" * 64),
                "search_coverage", CoverageAnnotation("empty", 0, 20),
            ),
        ),
        (),
    )
    with pytest.raises(CaptureCompileError, match="^capture_missing$"):
        CaptureImportCompiler(connection, now=_Clock()).compile_funding(
            _funding_request(started, session, ids, company),
        )
    connection.close()


def _imported_company(connection, started, ids, captures, session, tmp_path):
    event_ref, search_ref = _funding_pair(captures, session, ids, tmp_path)
    compiled = CaptureImportCompiler(connection, now=_Clock()).compile_funding(
        _funding_request(started, session, ids, _funding_annotation(event_ref, search_ref)),
    )
    funding = FundingResearchService(connection, now=lambda: STAMP)
    result = funding.import_and_classify(compiled.request)
    selected = funding.get_projection(started.run_id).companies[0]
    assert selected.rule_outcome == "provisional_match"
    return result, selected


def test_person_identity_and_title_come_from_exact_spans_of_a_shared_page(tmp_path: Path) -> None:
    connection, started, ids, captures, session = _fixture(tmp_path)
    funding, selected = _imported_company(connection, started, ids, captures, session, tmp_path)
    team_ref = _capture(
        captures, session, ids, tmp_path, name="team", text=TEAM_TEXT,
        url="https://nimbus.test/team",
    )

    def _span(value: str) -> ExcerptSpan:
        start = TEAM_TEXT.index(value)
        return ExcerptSpan(start, start + len(value))

    people = (
        PersonAnnotation(
            team_ref, selected.result_id, selected.company_id, "Avery",
            _span("Avery Alpha"), _span("Head of Operations"),
            "https://profile.test/avery-alpha",
        ),
        PersonAnnotation(
            team_ref, selected.result_id, selected.company_id, "Blake",
            _span("Blake Beta"), _span("VP Strategy"),
            "https://profile.test/blake-beta",
        ),
    )
    compiler = CaptureImportCompiler(connection, now=_Clock())
    before = _table_counts(connection)
    compiled = compiler.compile_people(PersonCompileRequest(
        ids.next(), session.session_id, started.run_id, started.intake_hash,
        funding.batch_id, funding.batch_hash, None, None,
        (selected.result_id,), people,
    ))
    assert _table_counts(connection) == before

    first, second = compiled.request.candidates
    assert (first.full_name, first.title) == ("Avery Alpha", "Head of Operations")
    assert (second.full_name, second.title) == ("Blake Beta", "VP Strategy")
    assert first.source_url == second.source_url == "https://nimbus.test/team"
    assert first.body_ref == second.body_ref
    assert first.expected_content_sha256 == team_ref.expected_content_sha256
    assert first.captured_at == compiled.capture_refs[0].retrieved_at
    assert len(compiled.capture_refs) == 2
    # One shared page, two people: distinct occurrence ordinals, same capture.
    first_ref, second_ref = compiled.capture_refs
    assert (first_ref.candidate_ordinal, first_ref.page_ordinal) == (0, 0)
    assert (second_ref.candidate_ordinal, second_ref.page_ordinal) == (1, 0)
    assert first_ref.task_id == second_ref.task_id == team_ref.task_id
    assert first_ref.receipt_id == second_ref.receipt_id == team_ref.expected_receipt_id
    assert first_ref.snapshot_id == second_ref.snapshot_id
    assert first_ref.body_ref == second_ref.body_ref
    assert first_ref.content_sha256 == second_ref.content_sha256
    assert first_ref.expires_at == second_ref.expires_at
    # Every other field is preserved exactly: only the ordinal differs.
    assert replace(second_ref, candidate_ordinal=0) == first_ref

    result = PersonResearchService(connection, now=lambda: STAMP).import_current_people(
        compiled.request,
    )
    assert result.counts["imported"] == 2
    connection.close()


def test_person_compile_refuses_a_search_capture_and_invalid_shapes(tmp_path: Path) -> None:
    connection, started, ids, captures, session = _fixture(tmp_path)
    funding, selected = _imported_company(connection, started, ids, captures, session, tmp_path)
    search_ref = _capture(
        captures, session, ids, tmp_path, name="people-search", text=TEAM_TEXT,
        query="Nimbus Systems team",
    )
    compiler = CaptureImportCompiler(connection, now=_Clock())

    def _request(people):
        return PersonCompileRequest(
            ids.next(), session.session_id, started.run_id, started.intake_hash,
            funding.batch_id, funding.batch_hash, None, None,
            (selected.result_id,), people,
        )

    with pytest.raises(CaptureCompileError, match="^capture_kind_mismatch$"):
        compiler.compile_people(_request((PersonAnnotation(
            search_ref, selected.result_id, selected.company_id, "Avery",
            ExcerptSpan(0, 11), ExcerptSpan(15, 33), None,
        ),)))
    with pytest.raises(CaptureCompileError, match="^invalid_person$"):
        compiler.compile_people(_request(("not-a-person",)))
    with pytest.raises(CaptureCompileError, match="^invalid_research_scope$"):
        compiler.compile_people(replace(_request(()), research_result_ids=()))
    connection.close()


def test_compiled_outputs_keep_private_reprs(tmp_path: Path) -> None:
    connection, started, ids, captures, session = _fixture(tmp_path)
    event_ref, search_ref = _funding_pair(captures, session, ids, tmp_path)
    compiled = CaptureImportCompiler(connection, now=_Clock()).compile_funding(
        _funding_request(started, session, ids, _funding_annotation(event_ref, search_ref)),
    )
    for rendered in (
        repr(compiled), repr(compiled.request), repr(compiled.capture_refs[0]),
        repr(event_ref), repr(ExcerptSpan(0, 4)),
    ):
        assert "Nimbus" not in rendered
        assert "nimbus.test" not in rendered
        assert event_ref.expected_content_sha256 not in rendered
    connection.close()


def test_non_request_input_and_predecessor_pairing_have_fixed_codes(tmp_path: Path) -> None:
    connection, started, ids, captures, session = _fixture(tmp_path)
    event_ref, search_ref = _funding_pair(captures, session, ids, tmp_path)
    compiler = CaptureImportCompiler(connection, now=_Clock())
    with pytest.raises(CaptureCompileError, match="^invalid_request$"):
        compiler.compile_funding({"request_id": "x"})
    with pytest.raises(CaptureCompileError, match="^invalid_request$"):
        compiler.compile_people({"request_id": "x"})
    request = _funding_request(started, session, ids, _funding_annotation(event_ref, search_ref))
    with pytest.raises(CaptureCompileError, match="^invalid_predecessor$"):
        compiler.compile_funding(replace(request, predecessor_batch_id="pfrb_x"))
    with pytest.raises(CaptureCompileError, match="^invalid_company$"):
        compiler.compile_funding(replace(request, companies=()))
    connection.close()


def test_one_company_may_not_reuse_the_same_captured_page_twice(tmp_path: Path) -> None:
    connection, started, ids, captures, session = _fixture(tmp_path)
    event_ref, search_ref = _funding_pair(captures, session, ids, tmp_path)
    duplicate = CompanyAnnotation(
        "Nimbus Systems", "https://nimbus.test/", "United States", "software",
        (PageAnnotation(event_ref, "issuer"), PageAnnotation(event_ref, "independent_report")),
        (),
    )
    with pytest.raises(CaptureCompileError, match="^duplicate_page$"):
        CaptureImportCompiler(connection, now=_Clock()).compile_funding(
            _funding_request(started, session, ids, duplicate),
        )
    # The same page remains compilable once per company.
    compiled = CaptureImportCompiler(connection, now=_Clock()).compile_funding(
        _funding_request(started, session, ids, _funding_annotation(event_ref, search_ref)),
    )
    assert len(compiled.request.candidates[0].pages) == 2
    connection.close()


def test_two_events_may_not_claim_the_same_page_ordinal(tmp_path: Path) -> None:
    connection, started, ids, captures, session = _fixture(tmp_path)
    event_ref, search_ref = _funding_pair(captures, session, ids, tmp_path)
    company = replace(
        _funding_annotation(event_ref, search_ref),
        events=(
            FundingEventAnnotation(0, "series_b", "2025-05-01", ExcerptSpan(0, len(EVENT_TEXT))),
            FundingEventAnnotation(0, "series_a", "2024-05-01", ExcerptSpan(0, len(EVENT_TEXT))),
        ),
    )
    with pytest.raises(CaptureCompileError, match="^invalid_funding_event$"):
        CaptureImportCompiler(connection, now=_Clock()).compile_funding(
            _funding_request(started, session, ids, company),
        )
    connection.close()


@pytest.mark.parametrize(
    ("field", "value", "code"),
    (
        ("name", "", "invalid_company"),
        ("location", " United States ", "invalid_company"),
        ("sector", "soft\tware", "invalid_company"),
        ("website_url", "https://nimbus.test/" + "a" * 4096, "invalid_company"),
    ),
)
def test_company_metadata_bounds_have_fixed_codes(tmp_path: Path, field, value, code) -> None:
    connection, started, ids, captures, session = _fixture(tmp_path)
    event_ref, search_ref = _funding_pair(captures, session, ids, tmp_path)
    company = replace(_funding_annotation(event_ref, search_ref), **{field: value})
    with pytest.raises(CaptureCompileError, match=f"^{code}$"):
        CaptureImportCompiler(connection, now=_Clock()).compile_funding(
            _funding_request(started, session, ids, company),
        )
    connection.close()


@pytest.mark.parametrize(
    "event",
    (
        FundingEventAnnotation(0, "s" * 65, "2025-05-01", ExcerptSpan(0, len(EVENT_TEXT))),
        FundingEventAnnotation(0, " series_b", "2025-05-01", ExcerptSpan(0, len(EVENT_TEXT))),
        FundingEventAnnotation(0, "series_b", "2025-5-1", ExcerptSpan(0, len(EVENT_TEXT))),
        FundingEventAnnotation(0, "series_b", 20250501, ExcerptSpan(0, len(EVENT_TEXT))),
    ),
)
def test_funding_event_stage_and_date_are_bounded_and_typed(tmp_path: Path, event) -> None:
    connection, started, ids, captures, session = _fixture(tmp_path)
    event_ref, search_ref = _funding_pair(captures, session, ids, tmp_path)
    company = replace(_funding_annotation(event_ref, search_ref), events=(event,))
    with pytest.raises(CaptureCompileError, match="^invalid_funding_event$"):
        CaptureImportCompiler(connection, now=_Clock()).compile_funding(
            _funding_request(started, session, ids, company),
        )
    connection.close()


def test_person_outside_the_declared_research_scope_is_refused(tmp_path: Path) -> None:
    connection, started, ids, captures, session = _fixture(tmp_path)
    funding, selected = _imported_company(connection, started, ids, captures, session, tmp_path)
    team_ref = _capture(
        captures, session, ids, tmp_path, name="team-scope", text=TEAM_TEXT,
        url="https://nimbus.test/team",
    )
    person = PersonAnnotation(
        team_ref, "pfrr_" + "0" * 32, selected.company_id, "Avery",
        ExcerptSpan(0, 11), ExcerptSpan(15, 33), None,
    )
    with pytest.raises(CaptureCompileError, match="^person_scope_mismatch$"):
        CaptureImportCompiler(connection, now=_Clock()).compile_people(PersonCompileRequest(
            ids.next(), session.session_id, started.run_id, started.intake_hash,
            funding.batch_id, funding.batch_hash, None, None,
            (selected.result_id,), (person,),
        ))
    connection.close()


@pytest.mark.parametrize(
    ("result_ids", "code"),
    (
        (("pfrr_" + "0" * 32, "pfrr_" + "0" * 32), "invalid_research_scope"),
        (("not_a_result_id",), "invalid_research_scope"),
        ((" pfrr_" + "0" * 32,), "invalid_research_scope"),
        ((b"pfrr_",), "invalid_research_scope"),
        (tuple(f"pfrr_{index:032x}" for index in range(MAX_PERSON_CANDIDATES + 1)),
         "research_scope_too_large"),
    ),
)
def test_bad_research_scopes_are_refused_before_any_capture_is_read(
    tmp_path: Path, result_ids, code,
) -> None:
    connection, started, ids, captures, session = _fixture(tmp_path)
    funding, selected = _imported_company(connection, started, ids, captures, session, tmp_path)
    # A capture reference that could never resolve: the scope refusal must win.
    unusable = PersonAnnotation(
        CaptureRef("pct_missing", "pcr_" + "0" * 32, "0" * 64), selected.result_id,
        selected.company_id, "Avery", ExcerptSpan(0, 11), ExcerptSpan(15, 33), None,
    )
    with pytest.raises(CaptureCompileError, match=f"^{code}$"):
        CaptureImportCompiler(connection, now=_Clock()).compile_people(PersonCompileRequest(
            ids.next(), session.session_id, started.run_id, started.intake_hash,
            funding.batch_id, funding.batch_hash, None, None, result_ids, (unusable,),
        ))
    connection.close()


def test_person_first_name_and_profile_url_bounds_have_fixed_codes(tmp_path: Path) -> None:
    connection, started, ids, captures, session = _fixture(tmp_path)
    funding, selected = _imported_company(connection, started, ids, captures, session, tmp_path)
    team_ref = _capture(
        captures, session, ids, tmp_path, name="team-bounds", text=TEAM_TEXT,
        url="https://nimbus.test/team",
    )
    compiler = CaptureImportCompiler(connection, now=_Clock())

    def _request(person):
        return PersonCompileRequest(
            ids.next(), session.session_id, started.run_id, started.intake_hash,
            funding.batch_id, funding.batch_hash, None, None,
            (selected.result_id,), (person,),
        )

    base = PersonAnnotation(
        team_ref, selected.result_id, selected.company_id, "Avery",
        ExcerptSpan(0, 11), ExcerptSpan(15, 33), None,
    )
    for broken in (
        replace(base, first_name="a" * 121),
        replace(base, first_name=" Avery"),
        replace(base, first_name="Ave\x01ry"),
        replace(base, profile_url="https://profile.test/" + "a" * 4096),
        replace(base, company_id=""),
    ):
        with pytest.raises(CaptureCompileError, match="^invalid_person$"):
            compiler.compile_people(_request(broken))
    connection.close()


def test_a_receipt_expired_at_compile_time_is_refused(tmp_path: Path) -> None:
    connection, started, ids, captures, session = _fixture(tmp_path)
    event_ref, search_ref = _funding_pair(captures, session, ids, tmp_path)
    # Captures retain for 30 days; compile well past that point.
    late = CaptureImportCompiler(connection, now=_Clock("2026-10-20T12:00:00Z"))
    with pytest.raises(CaptureCompileError, match="^capture_expired$"):
        late.compile_funding(
            _funding_request(started, session, ids, _funding_annotation(event_ref, search_ref)),
        )
    connection.close()


def test_funding_capture_refs_pair_body_ref_and_expiry_and_name_the_compiler(
    tmp_path: Path,
) -> None:
    connection, started, ids, captures, session = _fixture(tmp_path)
    event_ref, search_ref = _funding_pair(captures, session, ids, tmp_path)
    compiled = CaptureImportCompiler(connection, now=_Clock()).compile_funding(
        _funding_request(started, session, ids, _funding_annotation(event_ref, search_ref)),
    )
    row = connection.execute(
        """SELECT s.body_ref,s.expires_at FROM source_snapshot AS s
             JOIN prospecting_capture_receipt AS r ON r.snapshot_id=s.snapshot_id
            WHERE r.task_id=?""", (event_ref.task_id,),
    ).fetchone()
    ref = compiled.capture_refs[0]
    assert ref.body_ref == str(row[0]) == compiled.request.candidates[0].pages[0].body_ref
    assert ref.expires_at == str(row[1])
    assert ref.receipt_id == event_ref.expected_receipt_id
    assert compiled.compiler_version == COMPILER_VERSION
    assert tuple(
        (item.candidate_ordinal, item.page_ordinal) for item in compiled.capture_refs
    ) == ((0, 0), (0, 1))
    # Ordinals stay on the private envelope, never on the emitted P17 request.
    assert not any(
        hasattr(page, name)
        for page in compiled.request.candidates[0].pages
        for name in ("candidate_ordinal", "page_ordinal")
    )
    connection.close()


def test_person_capture_refs_pair_body_ref_and_expiry_and_name_the_compiler(
    tmp_path: Path,
) -> None:
    connection, started, ids, captures, session = _fixture(tmp_path)
    funding, selected = _imported_company(connection, started, ids, captures, session, tmp_path)
    team_ref = _capture(
        captures, session, ids, tmp_path, name="team-provenance", text=TEAM_TEXT,
        url="https://nimbus.test/team",
    )

    def _span(value: str) -> ExcerptSpan:
        start = TEAM_TEXT.index(value)
        return ExcerptSpan(start, start + len(value))

    people = CaptureImportCompiler(connection, now=_Clock()).compile_people(PersonCompileRequest(
        ids.next(), session.session_id, started.run_id, started.intake_hash,
        funding.batch_id, funding.batch_hash, None, None,
        (selected.result_id,),
        (PersonAnnotation(
            team_ref, selected.result_id, selected.company_id, "Avery",
            _span("Avery Alpha"), _span("Head of Operations"), None,
        ),),
    ))
    row = connection.execute(
        """SELECT s.body_ref,s.expires_at FROM source_snapshot AS s
             JOIN prospecting_capture_receipt AS r ON r.snapshot_id=s.snapshot_id
            WHERE r.task_id=?""", (team_ref.task_id,),
    ).fetchone()
    ref = people.capture_refs[0]
    assert people.compiler_version == COMPILER_VERSION
    assert ref.body_ref == str(row[0]) == people.request.candidates[0].body_ref
    assert ref.expires_at == str(row[1])
    assert ref.receipt_id == team_ref.expected_receipt_id
    assert (ref.candidate_ordinal, ref.page_ordinal) == (0, 0)
    assert not any(
        hasattr(people.request.candidates[0], name)
        for name in ("candidate_ordinal", "page_ordinal")
    )
    connection.close()


def test_two_companies_may_share_one_capture_with_distinct_ordinals(tmp_path: Path) -> None:
    """Sharing one capture across companies stays permitted and stays identified.

    The compiler only refuses reuse *within* one company.  Whether two companies
    may cite the same page is the importer's separate semantic judgement; here we
    check only that the compiled refs keep exact occurrence identity.
    """
    connection, started, ids, captures, session = _fixture(tmp_path)
    event_ref, search_ref = _funding_pair(captures, session, ids, tmp_path)
    shared = CompanyAnnotation(
        "Stratus Labs", "https://stratus.test/", "United States", "software",
        (PageAnnotation(event_ref, "independent_report"),), (),
    )
    compiled = CaptureImportCompiler(connection, now=_Clock()).compile_funding(
        FundingCompileRequest(
            ids.next(), session.session_id, started.run_id, started.intake_hash,
            None, None, (_funding_annotation(event_ref, search_ref), shared),
        ),
    )
    assert tuple(
        (item.candidate_ordinal, item.page_ordinal) for item in compiled.capture_refs
    ) == ((0, 0), (0, 1), (1, 0))
    first, coverage, reused = compiled.capture_refs
    assert first.task_id == reused.task_id == event_ref.task_id
    assert first.receipt_id == reused.receipt_id == event_ref.expected_receipt_id
    assert first.snapshot_id == reused.snapshot_id
    assert first.body_ref == reused.body_ref
    assert first.content_sha256 == reused.content_sha256 == event_ref.expected_content_sha256
    assert first.expires_at == reused.expires_at
    assert replace(reused, candidate_ordinal=0) == first
    assert coverage.task_id == search_ref.task_id
    # No dedupe: the shared capture is compiled onto both companies' pages.
    assert compiled.request.candidates[1].pages[0].body_ref == first.body_ref
    assert compiled.request.candidates[0].pages[0].body_ref == first.body_ref
    connection.close()


def test_store_failure_during_capture_resolution_keeps_one_fixed_code(tmp_path: Path) -> None:
    connection, started, ids, captures, session = _fixture(tmp_path)
    event_ref, search_ref = _funding_pair(captures, session, ids, tmp_path)
    compiler = CaptureImportCompiler(connection, now=_Clock())
    private = "no such table: prospecting_capture_task /private/operator/store.sqlite"

    def _broken_resolver(*_args, **_kwargs):
        raise sqlite3.OperationalError(private)

    compiler.captures.resolve_capture = _broken_resolver
    with pytest.raises(CaptureCompileError) as caught:
        compiler.compile_funding(
            _funding_request(started, session, ids, _funding_annotation(event_ref, search_ref)),
        )
    assert str(caught.value) == "capture_unresolved"
    assert private not in repr(caught.value)
    assert "sqlite" not in repr(caught.value).casefold()
    assert caught.value.__cause__ is None
    assert caught.value.__suppress_context__ is True
    connection.close()
