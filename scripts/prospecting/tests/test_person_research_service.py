from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path
import sqlite3

import pytest

from scripts.prospecting.affinity.evidence_bridge import (
    attested_current_role_source,
    current_role_source_proof,
)
from scripts.prospecting.affinity.source_review import verify_snapshot
from scripts.prospecting.funding_research_service import (
    CapturedPage,
    CompanyCapture,
    CoverageInput,
    FundingEventInput,
    FundingResearchRequest,
    FundingResearchService,
)
from scripts.prospecting.person_research_service import (
    PersonCapture,
    PersonResearchError,
    PersonResearchRequest,
    PersonResearchService,
)
from scripts.prospecting.pipeline_service import PipelineService, PipelineStartRequest, ScopeSpec
from scripts.prospecting.review_service import ReviewService, VerifyIdentitySourceRequest
from scripts.prospecting.store import open_store


STAMP = "2026-09-10T12:00:00Z"
NOW = datetime(2026, 9, 10, 12, tzinfo=timezone.utc)
CAMPAIGN_ID = "camp_aaaabbbbccccdddd"
POLICY_HASH = "a" * 64


def _write(root: Path, name: str, text: str) -> str:
    folder = root / "snapshots" / "captures"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / name).write_text(text, encoding="utf-8")
    return f"captures/{name}"


def _seed(connection: sqlite3.Connection, root: Path, *, requested_companies: int = 1):
    connection.execute(
        "INSERT INTO sender_profile VALUES(?,?,?,?,?,?,?)",
        ("sender-synthetic", "Synthetic Sender", None, "software", "operations", "tools", "{}"),
    )
    connection.execute(
        """INSERT INTO campaign(
               campaign_id,intent,sender_profile_id,policy_json,ask_type,ask_minutes,tone,
               template_family,cadence,send_window,timezone,daily_cap,hourly_cap,
               firm_collision_cap,approval_tier,mailbox_id,evidence_rules,credit_budget,status,policy_hash)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (CAMPAIGN_ID, "networking", "sender-synthetic", "{}", "informational_call", 15,
         "warm", "networking-v1", "[]", "09:00-17:00", "America/New_York", 25, 6,
         2, "T0", "mailbox-synthetic", "{}", 0, "draft", POLICY_HASH),
    )
    started = PipelineService(connection, now=lambda: STAMP).start_or_resume(PipelineStartRequest(
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", CAMPAIGN_ID, "2026-09-09",
        "series_a", "series_c", 3, "latest_known", ScopeSpec("any"), ScopeSpec("any"),
        requested_companies, 2, ("operations", "strategy", "chief_of_staff"),
        "Synthetic current people research", "Coffee chat",
    ))
    companies = []
    for slug, name in (("nimbus", "Nimbus Systems"), ("cirrus", "Cirrus Labs"))[:requested_companies]:
        event = f"{name} announced series_b on 2025-05-01."
        event_ref = _write(root, f"funding-event-{slug}.txt", event)
        search_ref = _write(root, f"funding-search-{slug}.txt", f"{name} funding results.")
        companies.append(CompanyCapture(
            name, f"https://{slug}.test/", "United States", "software",
            (
                CapturedPage(event_ref, f"https://{slug}.test/funding", "issuer", STAMP),
                CapturedPage(
                    search_ref, f"https://search.test/{slug}", "search_coverage", STAMP,
                    CoverageInput(f"{name} funding", STAMP, "found", 1, 20),
                ),
            ),
            (FundingEventInput(0, "series_b", "2025-05-01", event),),
        ))
    funding = FundingResearchService(connection, now=lambda: STAMP).import_and_classify(
        FundingResearchRequest(
            "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", started.run_id,
            started.intake_hash, None, None, tuple(companies),
        ),
    )
    projection = FundingResearchService(connection, now=lambda: STAMP).get_projection(started.run_id)
    selected = projection.companies[0]
    return started, funding, selected


def _person(
    root: Path, selected, *, first_name: str = "Avery", full_name: str = "Avery Example",
    title: str = "Head of Operations", slug: str = "avery",
):
    text = f"{full_name} is {title} at {selected.name}."
    return PersonCapture(
        selected.result_id, selected.company_id, first_name, full_name, title,
        f"https://profile.test/{slug}", f"https://{selected.name.split()[0].casefold()}.test/team/{slug}",
        _write(root, f"person-{slug}.txt", text), STAMP,
    )


def _request(started, funding, selected, candidates, *, request_id="cccccccc-cccc-4ccc-8ccc-cccccccccccc", predecessor=None):
    return PersonResearchRequest(
        request_id, started.run_id, started.intake_hash, funding.batch_id, funding.batch_hash,
        None if predecessor is None else predecessor.batch_id,
        None if predecessor is None else predecessor.batch_hash,
        (selected.result_id,), tuple(candidates),
    )


def test_zero_candidate_scope_persists_honest_shortfall_without_downstream_authority(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started, funding, selected = _seed(connection, tmp_path)
    result = PersonResearchService(connection, now=lambda: STAMP).import_current_people(
        _request(started, funding, selected, ()),
    )
    assert result.state == "awaiting_person_qualification_factcheck"
    assert result.counts == {
        "research_companies": 1, "candidates": 0, "imported": 0, "collisions": 0,
        "source_unknown": 0, "requested_people_total": 2, "provisional_shortfall": 2,
    }
    for table in ("person", "employment", "fill_person", "contact_point", "revision", "approval"):
        assert connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0] == 0
    connection.close()


def test_import_creates_exact_p13_compatible_source_but_no_selection(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started, funding, selected = _seed(connection, tmp_path)
    service = PersonResearchService(connection, now=lambda: STAMP)
    service.import_current_people(_request(started, funding, selected, (_person(tmp_path, selected),)))
    projection = service.get_projection(started.run_id)
    candidate = projection.candidates[0]
    assert candidate.outcome == "provisional_import"
    snapshot = connection.execute(
        "SELECT body_ref,allowlist_version FROM source_snapshot WHERE snapshot_id=?", (candidate.snapshot_id,),
    ).fetchone()
    assert snapshot["body_ref"] == f"{candidate.snapshot_id}.body"
    assert snapshot["allowlist_version"] == "operator-local-v1"
    assert connection.execute("SELECT count(*) FROM fill_person").fetchone()[0] == 0

    # Simulate a separately authorized future selection; P18 never performs these writes.
    connection.execute(
        "INSERT INTO fill_firm VALUES(?,?,?,?,?,?,?)",
        (CAMPAIGN_ID, selected.company_id, 2, 6, "selected", None, STAMP),
    )
    connection.execute(
        "INSERT INTO fill_person VALUES(?,?,?,?,?)",
        (CAMPAIGN_ID, candidate.person_id, selected.company_id, 0, STAMP),
    )
    proof = current_role_source_proof(connection, CAMPAIGN_ID, candidate.person_id, NOW)
    assert proof.snapshot_id == candidate.snapshot_id and proof.attested is False
    reviewer = ReviewService(
        connection, now=lambda: STAMP,
        source_verifier=lambda value: verify_snapshot(tmp_path / "snapshots", value, now=NOW),
    )
    verified = reviewer.verify_current_role_source(VerifyIdentitySourceRequest(
        "dddddddd-dddd-4ddd-8ddd-dddddddddddd", CAMPAIGN_ID, candidate.person_id,
        candidate.observation_id, candidate.observation_id, True,
    ))
    assert verified.state == "source_confirmed"
    attested = attested_current_role_source(connection, CAMPAIGN_ID, candidate.person_id)
    assert attested.snapshot_id == candidate.snapshot_id
    connection.close()


def test_first_name_or_identity_not_structurally_present_is_source_unknown(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started, funding, selected = _seed(connection, tmp_path)
    person = _person(tmp_path, selected, first_name="Unrelated")
    service = PersonResearchService(connection, now=lambda: STAMP)
    service.import_current_people(_request(started, funding, selected, (person,)))
    candidate = service.get_projection(started.run_id).candidates[0]
    assert candidate.outcome == "source_unknown"
    assert candidate.person_id is None and candidate.observation_id is None
    assert connection.execute("SELECT count(*) FROM person").fetchone()[0] == 0
    snapshot = connection.execute("SELECT entity_id FROM source_snapshot WHERE snapshot_id=?", (candidate.snapshot_id,)).fetchone()
    assert snapshot[0] == candidate.candidate_id
    connection.close()


def test_caller_supplied_first_name_may_be_nonleading_full_name_tokens(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started, funding, selected = _seed(connection, tmp_path)
    person = _person(
        tmp_path, selected, first_name="Avery", full_name="Example Avery", slug="family-first",
    )
    service = PersonResearchService(connection, now=lambda: STAMP)
    service.import_current_people(_request(started, funding, selected, (person,)))
    candidate = service.get_projection(started.run_id).candidates[0]
    assert candidate.outcome == "provisional_import"
    assert tuple(connection.execute(
        "SELECT first_name,full_name FROM person WHERE person_id=?", (candidate.person_id,),
    ).fetchone()) == ("Avery", "Example Avery")
    connection.close()


def test_existing_conflicting_current_title_is_collision_without_rewrite(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started, funding, selected = _seed(connection, tmp_path)
    connection.execute(
        "INSERT INTO person(person_id,first_name,full_name,linkedin_url,source_lane,dedupe_key) VALUES(?,?,?,?,?,?)",
        ("per_existingperson", "Avery", "Avery Example", "https://profile.test/avery", "manual", "existing-person"),
    )
    connection.execute(
        "INSERT INTO source_observation VALUES(?,?,?,?,?,?,?,?,?,?)",
        ("obs_existingrole", "employment", "emp_existingrole", "company_id",
         f'"{selected.company_id}"', "synthetic", STAMP, STAMP, 1.0, None),
    )
    connection.execute(
        "INSERT INTO employment VALUES(?,?,?,?,?,?,?,?)",
        ("emp_existingrole", "per_existingperson", selected.company_id, "Finance Lead", None, None,
         "obs_existingrole", 1.0),
    )
    service = PersonResearchService(connection, now=lambda: STAMP)
    service.import_current_people(_request(started, funding, selected, (_person(tmp_path, selected),)))
    candidate = service.get_projection(started.run_id).candidates[0]
    assert candidate.outcome == "identity_collision" and candidate.person_id is None
    assert connection.execute("SELECT title FROM employment WHERE employment_id='emp_existingrole'").fetchone()[0] == "Finance Lead"
    assert connection.execute("SELECT count(*) FROM person").fetchone()[0] == 1
    connection.close()


def test_exact_replay_conflict_predecessor_and_source_tamper(tmp_path: Path) -> None:
    database = tmp_path / "store.sqlite"
    connection = open_store(database)
    started, funding, selected = _seed(connection, tmp_path)
    request = _request(started, funding, selected, (_person(tmp_path, selected),))
    service = PersonResearchService(connection, now=lambda: STAMP)
    first = service.import_current_people(request)
    connection.close()
    reopened = open_store(database)
    service = PersonResearchService(reopened, now=lambda: STAMP)
    assert service.import_current_people(request).replayed is True
    with pytest.raises(PersonResearchError, match="^request_conflict$"):
        service.import_current_people(replace(request, candidates=()))
    replacement = _request(
        started, funding, selected, (_person(tmp_path, selected),),
        request_id="eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        predecessor=first,
    )
    second = service.import_current_people(replacement)
    assert second.counts["provisional_shortfall"] == 1
    snapshot_ref = reopened.execute(
        "SELECT body_ref FROM source_snapshot WHERE allowlist_version='operator-local-v1' ORDER BY rowid DESC LIMIT 1",
    ).fetchone()[0]
    (tmp_path / "snapshots" / snapshot_ref).write_text("changed", encoding="utf-8")
    with pytest.raises(PersonResearchError, match="^source_changed$"):
        service.get_projection(started.run_id)
    reopened.close()


def test_wrong_p17_scope_refuses_without_rows(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started, funding, selected = _seed(connection, tmp_path)
    request = _request(started, funding, selected, ())
    request = replace(request, research_result_ids=("pfrr_ffffffffffffffffffffffffffffffff",))
    with pytest.raises(PersonResearchError, match="^invalid_research_scope$"):
        PersonResearchService(connection, now=lambda: STAMP).import_current_people(request)
    assert connection.execute("SELECT count(*) FROM prospecting_person_batch").fetchone()[0] == 0
    connection.close()


def test_non_string_research_scope_has_fixed_error(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started, funding, selected = _seed(connection, tmp_path)
    request = replace(_request(started, funding, selected, ()), research_result_ids=([],))
    with pytest.raises(PersonResearchError, match="^invalid_research_scope$"):
        PersonResearchService(connection, now=lambda: STAMP).import_current_people(request)
    assert connection.execute("SELECT count(*) FROM prospecting_person_batch").fetchone()[0] == 0
    connection.close()


@pytest.mark.parametrize(("at_first", "at_second", "expected_shortfall"), ((4, 0, 2), (1, 3, 1)))
def test_shortfall_is_per_company_and_counts_distinct_people(
    tmp_path: Path, at_first: int, at_second: int, expected_shortfall: int,
) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started, funding, _selected = _seed(connection, tmp_path, requested_companies=2)
    selected = FundingResearchService(connection, now=lambda: STAMP).get_projection(started.run_id).companies
    names = (
        ("Avery", "Avery Alpha"), ("Blake", "Blake Beta"),
        ("Casey", "Casey Gamma"), ("Devon", "Devon Delta"),
    )
    candidates = tuple(
        _person(tmp_path, selected[0], first_name=first, full_name=full, slug=f"first-{first.casefold()}")
        for first, full in names[:at_first]
    ) + tuple(
        _person(tmp_path, selected[1], first_name=first, full_name=full, slug=f"second-{first.casefold()}")
        for first, full in names[:at_second]
    )
    request = PersonResearchRequest(
        "ffffffff-ffff-4fff-8fff-ffffffffffff", started.run_id, started.intake_hash,
        funding.batch_id, funding.batch_hash, None, None,
        tuple(item.result_id for item in selected), candidates,
    )
    result = PersonResearchService(connection, now=lambda: STAMP).import_current_people(request)
    assert result.counts["imported"] == at_first + at_second
    assert result.counts["provisional_shortfall"] == expected_shortfall
    connection.close()


def test_existing_first_name_conflict_is_snapshot_only_collision(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started, funding, selected = _seed(connection, tmp_path)
    connection.execute(
        "INSERT INTO person(person_id,first_name,full_name,linkedin_url,source_lane,dedupe_key) VALUES(?,?,?,?,?,?)",
        ("per_existingperson", "Avery", "Avery Example", "https://profile.test/avery", "manual", "existing-person"),
    )
    connection.execute(
        "INSERT INTO source_observation VALUES(?,?,?,?,?,?,?,?,?,?)",
        ("obs_existingrole", "employment", "emp_existingrole", "company_id",
         f'"{selected.company_id}"', "synthetic", STAMP, STAMP, 1.0, None),
    )
    connection.execute(
        "INSERT INTO employment VALUES(?,?,?,?,?,?,?,?)",
        ("emp_existingrole", "per_existingperson", selected.company_id, "Head of Operations",
         None, None, "obs_existingrole", 1.0),
    )
    supplied = _person(tmp_path, selected, first_name="Example", slug="avery")
    service = PersonResearchService(connection, now=lambda: STAMP)
    service.import_current_people(_request(started, funding, selected, (supplied,)))
    candidate = service.get_projection(started.run_id).candidates[0]
    assert candidate.outcome == "identity_collision"
    assert candidate.person_id is None
    connection.close()


def test_changed_bound_profile_fails_closed(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started, funding, selected = _seed(connection, tmp_path)
    service = PersonResearchService(connection, now=lambda: STAMP)
    service.import_current_people(_request(started, funding, selected, (_person(tmp_path, selected),)))
    candidate = service.get_projection(started.run_id).candidates[0]
    connection.execute(
        "UPDATE person SET linkedin_url='https://profile.test/changed' WHERE person_id=?",
        (candidate.person_id,),
    )
    with pytest.raises(PersonResearchError, match="^store_state_invalid$"):
        service.get_projection(started.run_id)
    connection.close()


def test_candidate_cap_refuses_before_any_p18_write(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started, funding, selected = _seed(connection, tmp_path)
    names = (
        ("Avery", "Avery Alpha"), ("Blake", "Blake Beta"), ("Casey", "Casey Gamma"),
        ("Devon", "Devon Delta"), ("Emery", "Emery Epsilon"), ("Flynn", "Flynn Foxtrot"),
        ("Gray", "Gray Gamma"),
    )
    candidates = tuple(
        _person(tmp_path, selected, first_name=first, full_name=full, slug=first.casefold())
        for first, full in names
    )
    with pytest.raises(PersonResearchError, match="^candidate_pool_too_large$"):
        PersonResearchService(connection, now=lambda: STAMP).import_current_people(
            _request(started, funding, selected, candidates),
        )
    assert connection.execute("SELECT count(*) FROM prospecting_person_batch").fetchone()[0] == 0
    assert connection.execute("SELECT count(*) FROM person").fetchone()[0] == 0
    connection.close()


def test_candidate_insert_failure_rolls_back_rows_and_owned_source(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started, funding, selected = _seed(connection, tmp_path)
    baseline = {
        table: connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
        for table in ("source_snapshot", "source_observation", "person", "employment")
    }
    connection.execute(
        """CREATE TEMP TRIGGER reject_person_candidate
           BEFORE INSERT ON prospecting_person_candidate
           BEGIN SELECT RAISE(ABORT,'synthetic rejection'); END""",
    )
    with pytest.raises(PersonResearchError, match="^store_state_invalid$"):
        PersonResearchService(connection, now=lambda: STAMP).import_current_people(
            _request(started, funding, selected, (_person(tmp_path, selected),)),
        )
    assert connection.in_transaction is False
    assert {
        table: connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
        for table in baseline
    } == baseline
    assert connection.execute("SELECT count(*) FROM prospecting_person_batch").fetchone()[0] == 0
    assert not tuple((tmp_path / "snapshots").glob("snap_*.body"))
    connection.close()


def test_safe_projection_has_only_aggregate_fields(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started, funding, selected = _seed(connection, tmp_path)
    service = PersonResearchService(connection, now=lambda: STAMP)
    service.import_current_people(_request(started, funding, selected, (_person(tmp_path, selected),)))
    safe = service.get_safe_projection(started.run_id)
    assert safe is not None and safe.counts["imported"] == 1
    rendered = repr(safe)
    assert "Avery" not in rendered and "https://" not in rendered and "body" not in rendered
    connection.close()


def test_distinct_people_may_share_one_exact_source_page(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started, funding, selected = _seed(connection, tmp_path)
    shared_ref = _write(
        tmp_path, "person-shared-team.txt",
        "Avery Alpha is Head of Operations at Nimbus Systems. "
        "Blake Beta is VP Strategy at Nimbus Systems.",
    )
    people = (
        PersonCapture(
            selected.result_id, selected.company_id, "Avery", "Avery Alpha", "Head of Operations",
            "https://profile.test/avery-alpha", "https://nimbus.test/team", shared_ref, STAMP,
        ),
        PersonCapture(
            selected.result_id, selected.company_id, "Blake", "Blake Beta", "VP Strategy",
            "https://profile.test/blake-beta", "https://nimbus.test/team", shared_ref, STAMP,
        ),
    )
    service = PersonResearchService(connection, now=lambda: STAMP)
    result = service.import_current_people(_request(started, funding, selected, people))
    assert result.counts["imported"] == 2 and result.counts["provisional_shortfall"] == 0
    projections = service.get_projection(started.run_id).candidates
    assert len({candidate.snapshot_id for candidate in projections}) == 2
    assert all(candidate.outcome == "provisional_import" for candidate in projections)
    connection.close()
