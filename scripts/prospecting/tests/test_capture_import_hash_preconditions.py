"""Optional exact source-byte preconditions at the private importer boundary.

These tests exercise the real funding and person importers against synthetic
`.test` captures.  A matching precondition never changes request identity; a
changed file, a malformed hash, or a mismatching hash refuses before any row or
owned snapshot file is written.  Nothing here claims send authority, semantic
factcheck, or that a (hash, url, time) triple uniquely identifies a receipt.
"""

from __future__ import annotations

from dataclasses import replace
from hashlib import sha256
from pathlib import Path

import pytest

from scripts.prospecting import pipeline_cli
from scripts.prospecting.funding_research_service import (
    CapturedPage,
    CompanyCapture,
    CoverageInput,
    FundingEventInput,
    FundingResearchError,
    FundingResearchRequest,
    FundingResearchService,
)
from scripts.prospecting.person_research_service import (
    PersonResearchError,
    PersonResearchService,
)
from scripts.prospecting.store import open_store
from scripts.prospecting.tests.test_funding_research_service import (
    STAMP,
    _capture,
    _seed,
)
from scripts.prospecting.tests.test_person_research_service import (
    _person as _person_capture,
    _request as _person_request,
    _seed as _seed_person,
)


REQUEST_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
FRESH_REQUEST_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
RUN_PLACEHOLDER = "prun_" + "a" * 32
HASH_PLACEHOLDER = "a" * 64
SENTINEL = "PRIVATE-CANARY-SENTINEL"
FUNDING_TABLES = (
    "prospecting_funding_batch", "prospecting_funding_company",
    "source_snapshot", "source_observation", "company",
)


def _sha_of(root: Path, body_ref: str) -> str:
    return sha256((root / "snapshots" / body_ref).read_bytes()).hexdigest()


def _counts(connection) -> tuple[int, ...]:
    return tuple(
        connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
        for table in FUNDING_TABLES
    )


def _candidate(root: Path) -> CompanyCapture:
    event_text = "Nimbus Systems announced series_b on 2025-05-01."
    event_ref = _capture(root, "nimbus-test-event.txt", event_text)
    coverage_ref = _capture(
        root, "nimbus-test-coverage.txt", "Search results for Nimbus Systems funding.",
    )
    return CompanyCapture(
        "Nimbus Systems", "https://nimbus.test/", "United States", "software",
        (
            CapturedPage(event_ref, "https://nimbus.test/funding", "issuer", STAMP),
            CapturedPage(
                coverage_ref, "https://search.test/nimbus", "search_coverage", STAMP,
                CoverageInput("Nimbus Systems funding", STAMP, "found", 1, 20),
            ),
        ),
        (FundingEventInput(0, "series_b", "2025-05-01", event_text),),
    )


def _with_preconditions(root: Path, candidate: CompanyCapture) -> CompanyCapture:
    return replace(candidate, pages=tuple(
        replace(page, expected_content_sha256=_sha_of(root, page.body_ref))
        for page in candidate.pages
    ))


def _request(started, candidate: CompanyCapture, *, request_id: str = REQUEST_ID):
    return FundingResearchRequest(
        request_id, started.run_id, started.intake_hash, None, None, (candidate,),
    )


def test_matching_precondition_imports_and_replays_with_or_without_the_hash(
    tmp_path: Path,
) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started = _seed(connection)
    service = FundingResearchService(connection, now=lambda: STAMP)
    plain = _candidate(tmp_path)
    bound = _with_preconditions(tmp_path, plain)

    first = service.import_and_classify(_request(started, bound))
    assert first.replayed is False
    assert first.counts["candidates"] == 1
    assert first.counts["provisional_matches"] == 1

    replay_bound = service.import_and_classify(_request(started, bound))
    replay_plain = service.import_and_classify(_request(started, plain))

    assert replay_bound.replayed is True and replay_plain.replayed is True
    assert replay_bound.batch_id == replay_plain.batch_id == first.batch_id
    assert replay_bound.batch_hash == replay_plain.batch_hash == first.batch_hash
    assert connection.execute(
        "SELECT count(*) FROM prospecting_funding_batch",
    ).fetchone()[0] == 1
    connection.close()


def test_old_request_without_the_optional_field_keeps_its_stored_identity(
    tmp_path: Path,
) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started = _seed(connection)
    service = FundingResearchService(connection, now=lambda: STAMP)
    plain = _candidate(tmp_path)

    legacy = service.import_and_classify(_request(started, plain))
    after_legacy = _counts(connection)
    replay = service.import_and_classify(
        _request(started, _with_preconditions(tmp_path, plain)),
    )

    assert replay.replayed is True
    assert replay.batch_hash == legacy.batch_hash
    assert _counts(connection) == after_legacy
    connection.close()


def test_file_replaced_between_request_creation_and_import_is_refused(
    tmp_path: Path,
) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started = _seed(connection)
    service = FundingResearchService(connection, now=lambda: STAMP)
    candidate = _with_preconditions(tmp_path, _candidate(tmp_path))
    before = _counts(connection)

    changed_path = tmp_path / "snapshots" / candidate.pages[0].body_ref
    replacement = "Nimbus Systems announced series_c on 2026-01-01."
    changed_path.write_text(replacement, encoding="utf-8")

    with pytest.raises(FundingResearchError, match="^source_changed$"):
        service.import_and_classify(_request(started, candidate))

    assert _counts(connection) == before
    assert changed_path.read_text(encoding="utf-8") == replacement
    imported = tmp_path / "snapshots" / "funding-research"
    assert not imported.exists() or not tuple(imported.iterdir())
    assert service.get_projection(started.run_id) is None
    connection.close()


@pytest.mark.parametrize("value", ("not-a-hash", "A" * 64, "a" * 63, 17, [], True))
def test_malformed_precondition_is_a_fixed_code_without_echoing_the_value(
    tmp_path: Path, value: object,
) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started = _seed(connection)
    service = FundingResearchService(connection, now=lambda: STAMP)
    candidate = _candidate(tmp_path)
    candidate = replace(candidate, pages=(
        replace(candidate.pages[0], expected_content_sha256=value), candidate.pages[1],
    ))
    before = _counts(connection)

    with pytest.raises(FundingResearchError) as error:
        service.import_and_classify(_request(started, candidate))

    assert str(error.value) == "invalid_page"
    assert str(value) not in str(error.value)
    assert _counts(connection) == before
    connection.close()


def test_mismatching_precondition_with_a_fresh_request_id_also_refuses(
    tmp_path: Path,
) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started = _seed(connection)
    service = FundingResearchService(connection, now=lambda: STAMP)
    candidate = _candidate(tmp_path)
    candidate = replace(candidate, pages=(
        replace(candidate.pages[0], expected_content_sha256="b" * 64),
        candidate.pages[1],
    ))
    before = _counts(connection)

    with pytest.raises(FundingResearchError, match="^source_changed$"):
        service.import_and_classify(
            _request(started, candidate, request_id=FRESH_REQUEST_ID),
        )

    assert _counts(connection) == before
    connection.close()


def test_person_matching_precondition_imports_and_legacy_request_replays(
    tmp_path: Path,
) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started, funding, selected = _seed_person(connection, tmp_path)
    service = PersonResearchService(connection, now=lambda: STAMP)
    person = _person_capture(tmp_path, selected)
    bound = replace(
        person, expected_content_sha256=_sha_of(tmp_path, person.body_ref),
    )

    first = service.import_current_people(
        _person_request(started, funding, selected, (bound,)),
    )
    replay = service.import_current_people(
        _person_request(started, funding, selected, (person,)),
    )

    assert first.replayed is False and first.counts["imported"] == 1
    assert replay.replayed is True
    assert replay.batch_id == first.batch_id
    assert replay.batch_hash == first.batch_hash
    connection.close()


def test_person_source_replaced_before_import_is_refused_without_rows(
    tmp_path: Path,
) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started, funding, selected = _seed_person(connection, tmp_path)
    person = _person_capture(tmp_path, selected)
    bound = replace(
        person, expected_content_sha256=_sha_of(tmp_path, person.body_ref),
    )
    snapshots_before = connection.execute(
        "SELECT count(*) FROM source_snapshot",
    ).fetchone()[0]
    (tmp_path / "snapshots" / person.body_ref).write_text(
        "Replaced private page.", encoding="utf-8",
    )

    with pytest.raises(PersonResearchError, match="^source_changed$"):
        PersonResearchService(connection, now=lambda: STAMP).import_current_people(
            _person_request(started, funding, selected, (bound,)),
        )

    assert connection.execute(
        "SELECT count(*) FROM source_snapshot",
    ).fetchone()[0] == snapshots_before
    assert connection.execute(
        "SELECT count(*) FROM prospecting_person_batch",
    ).fetchone()[0] == 0
    assert connection.execute("SELECT count(*) FROM person").fetchone()[0] == 0
    connection.close()


@pytest.mark.parametrize(
    ("value", "code"),
    (
        ("b" * 64, "source_changed"),
        ("nope", "invalid_candidate"),
        ("C" * 64, "invalid_candidate"),
        (17, "invalid_candidate"),
    ),
)
def test_person_precondition_refusals_are_fixed_and_leave_no_rows(
    tmp_path: Path, value: object, code: str,
) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started, funding, selected = _seed_person(connection, tmp_path)
    person = replace(
        _person_capture(tmp_path, selected), expected_content_sha256=value,
    )

    with pytest.raises(PersonResearchError) as error:
        PersonResearchService(connection, now=lambda: STAMP).import_current_people(
            _person_request(started, funding, selected, (person,)),
        )

    assert str(error.value) == code
    assert str(value) not in str(error.value)
    assert connection.execute(
        "SELECT count(*) FROM prospecting_person_batch",
    ).fetchone()[0] == 0
    assert connection.execute("SELECT count(*) FROM person").fetchone()[0] == 0
    connection.close()


def _funding_manifest(page_extra: dict) -> dict:
    page = {
        "body_ref": "browser-acceptance/nimbus-test-event.txt",
        "source_url": "https://nimbus.test/funding",
        "source_kind": "issuer",
        "captured_at": STAMP,
    }
    page.update(page_extra)
    return {
        "request_id": REQUEST_ID,
        "run_id": RUN_PLACEHOLDER,
        "expected_intake_hash": HASH_PLACEHOLDER,
        "predecessor_batch_id": None,
        "predecessor_hash": None,
        "candidates": [{
            "name": "Nimbus Systems",
            "website_url": "https://nimbus.test/",
            "location": "United States",
            "sector": "software",
            "pages": [page],
            "events": [],
        }],
    }


def _person_manifest(candidate_extra: dict) -> dict:
    candidate = {
        "funding_result_id": "pfrr_" + "a" * 32,
        "company_id": "co_" + "a" * 32,
        "first_name": "Avery",
        "full_name": "Avery Example",
        "title": "Head of Operations",
        "profile_url": None,
        "source_url": "https://nimbus.test/team/avery",
        "body_ref": "captures/person-avery.txt",
        "captured_at": STAMP,
    }
    candidate.update(candidate_extra)
    return {
        "request_id": REQUEST_ID,
        "run_id": RUN_PLACEHOLDER,
        "expected_intake_hash": HASH_PLACEHOLDER,
        "funding_batch_id": "pfrb_" + "a" * 32,
        "funding_batch_hash": HASH_PLACEHOLDER,
        "predecessor_batch_id": None,
        "predecessor_hash": None,
        "research_result_ids": ["pfrr_" + "a" * 32],
        "candidates": [candidate],
    }


def test_cli_parsing_accepts_the_optional_field_and_keeps_exact_key_guards() -> None:
    legacy = pipeline_cli._funding_request(_funding_manifest({}))
    assert legacy.candidates[0].pages[0].expected_content_sha256 is None

    bound = pipeline_cli._funding_request(
        _funding_manifest({"expected_content_sha256": HASH_PLACEHOLDER}),
    )
    assert bound.candidates[0].pages[0].expected_content_sha256 == HASH_PLACEHOLDER

    # A wrong-typed value is passed through unchanged and refused later by the
    # importer with the fixed `invalid_page` code (see the malformed test above).
    wrong = pipeline_cli._funding_request(
        _funding_manifest({"expected_content_sha256": 17}),
    )
    assert wrong.candidates[0].pages[0].expected_content_sha256 == 17

    for extra in ({"sentinel": SENTINEL}, {"coverage": None}):
        with pytest.raises(pipeline_cli.CliError) as error:
            pipeline_cli._funding_request(_funding_manifest(extra))
        assert str(error.value) == "funding_import_schema_invalid"
        assert SENTINEL not in str(error.value)

    legacy_person = pipeline_cli._person_request(_person_manifest({}))
    assert legacy_person.candidates[0].expected_content_sha256 is None

    bound_person = pipeline_cli._person_request(
        _person_manifest({"expected_content_sha256": HASH_PLACEHOLDER}),
    )
    assert bound_person.candidates[0].expected_content_sha256 == HASH_PLACEHOLDER

    wrong_person = pipeline_cli._person_request(
        _person_manifest({"expected_content_sha256": 17}),
    )
    assert wrong_person.candidates[0].expected_content_sha256 == 17

    with pytest.raises(pipeline_cli.CliError) as person_error:
        pipeline_cli._person_request(_person_manifest({"sentinel": SENTINEL}))
    assert str(person_error.value) == "person_import_schema_invalid"
    assert SENTINEL not in str(person_error.value)
