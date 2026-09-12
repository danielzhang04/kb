from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path

import pytest

from scripts.prospecting.person_research_service import PersonCapture, PersonResearchService
from scripts.prospecting.qualification_service import (
    QualificationError,
    QualificationService,
    QualificationSupportedCandidate,
)
from scripts.prospecting.ranking_service import (
    RankingError,
    RankingService,
    RankingStartRequest,
    _role_match,
)
from scripts.prospecting.store import open_store
from scripts.prospecting.tests.test_person_research_service import _person, _request, _seed, _write
from scripts.prospecting.tests.test_qualification_service import (
    _Adapter,
    _qualification_request,
    _supported_payload,
)


NOW = datetime(2026, 9, 10, 12, tzinfo=timezone.utc)
STAMP = NOW.isoformat().replace("+00:00", "Z")


def _rank_request(started, qualification, *, request_id="dededede-dede-4ede-8ede-dededededede", predecessor=None):
    return RankingStartRequest(
        request_id, started.run_id, started.intake_hash,
        qualification.batch_id, qualification.batch_hash,
        None if predecessor is None else predecessor.batch_id,
        None if predecessor is None else predecessor.batch_hash,
    )


def _insert_unrelated_open_employment(connection, company_id: str) -> None:
    snapshot_id = connection.execute(
        "SELECT snapshot_id FROM source_snapshot ORDER BY snapshot_id LIMIT 1",
    ).fetchone()[0]
    connection.execute(
        "INSERT INTO person(person_id,first_name,full_name,linkedin_url,source_lane,dedupe_key) VALUES(?,?,?,?,?,?)",
        (
            "per_ffffffffffffffff", "Unrelated", "Unrelated Synthetic",
            "https://profile.test/unrelated", "manual", "person:unrelated-synthetic",
        ),
    )
    connection.execute(
        """INSERT INTO source_observation(
               observation_id,entity_type,entity_id,field,value,source,seen_at,
               retrieved_at,confidence,snapshot_id)
           VALUES(?,'person',?,'source_review_candidate',?,?,?,?,1.0,?)""",
        (
            "obs_unrelated", "per_ffffffffffffffff", '{"excerpt":"unrelated synthetic"}',
            snapshot_id, STAMP, STAMP, snapshot_id,
        ),
    )
    connection.execute(
        """INSERT INTO employment(
               employment_id,person_id,company_id,title,valid_from,valid_to,
               source_observation_id,confidence)
           VALUES(?,?,?,?,NULL,NULL,?,1.0)""",
        (
            "emp_ffffffffffffffff", "per_ffffffffffffffff", company_id,
            "Chief Operating Officer", "obs_unrelated",
        ),
    )


def test_supported_scope_rederives_artifact_and_preserves_original_employment_source(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started, funding, selected = _seed(connection, tmp_path)
    first = PersonResearchService(connection, now=lambda: STAMP).import_current_people(
        _request(started, funding, selected, (_person(tmp_path, selected),)),
    )
    replacement = PersonCapture(
        selected.result_id, selected.company_id, "Avery", "Avery Example", "Head of Operations",
        "https://profile.test/avery", "https://nimbus.test/about/avery",
        _write(
            tmp_path, "replacement-current.txt",
            "Current profile: Avery Example is Head of Operations at Nimbus Systems.",
        ),
        STAMP,
    )
    people = PersonResearchService(connection, now=lambda: STAMP).import_current_people(
        _request(
            started, funding, selected, (replacement,),
            request_id="abababab-abab-4bab-8bab-abababababab", predecessor=first,
        ),
    )
    service = QualificationService(
        connection, adapters={"qualification_factcheck": _Adapter(_supported_payload)},
        now=lambda: NOW,
    )
    service.start_or_resume(_qualification_request(started, funding, people))
    item_id = service.get_projection(started.run_id).items[0].item_id
    service.run_next(item_id, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")

    candidate = service.get_supported_scope(started.run_id).companies[0].candidates[0]
    assert candidate.outcome == "current_role_supported"
    assert candidate.candidate_observation_id != candidate.employment_observation_id
    assert candidate.title == "Head of Operations"


def test_ranking_remains_parked_until_qualification_artifact_exists(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started, funding, selected = _seed(connection, tmp_path)
    people = PersonResearchService(connection, now=lambda: STAMP).import_current_people(
        _request(started, funding, selected, (_person(tmp_path, selected),)),
    )
    qualification = QualificationService(connection, now=lambda: NOW).start_or_resume(
        _qualification_request(started, funding, people),
    )
    with pytest.raises(RankingError, match="qualification_incomplete"):
        RankingService(connection, now=lambda: NOW).start_or_resume(
            _rank_request(started, qualification),
        )
    assert connection.execute("SELECT count(*) FROM prospecting_ranking_batch").fetchone()[0] == 0


def test_role_policy_orders_supported_people_and_never_populates_p8_or_fill(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started, funding, selected = _seed(connection, tmp_path)
    captures = (
        _person(tmp_path, selected, full_name="Avery Example", title="Head of Operations", slug="avery"),
        _person(tmp_path, selected, first_name="Blair", full_name="Blair Example", title="Chief Operating Officer", slug="blair"),
        _person(tmp_path, selected, first_name="Casey", full_name="Casey Example", title="Sales Operations Director", slug="casey"),
    )
    people = PersonResearchService(connection, now=lambda: STAMP).import_current_people(
        _request(started, funding, selected, captures),
    )
    qualification_service = QualificationService(
        connection, adapters={"qualification_factcheck": _Adapter(_supported_payload)},
        now=lambda: NOW,
    )
    qualification = qualification_service.start_or_resume(
        _qualification_request(started, funding, people),
    )
    item_id = qualification_service.get_projection(started.run_id).items[0].item_id
    qualification_service.run_next(item_id, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")
    _insert_unrelated_open_employment(connection, selected.company_id)

    service = RankingService(connection, now=lambda: NOW)
    result = service.start_or_resume(_rank_request(started, qualification))
    projection = service.get_projection(started.run_id)
    company = projection.companies[0]
    selected_people = [person for person in company.people if person.selected]
    excluded = next(person for person in company.people if person.title == "Sales Operations Director")
    assert result.counts == {
        "companies": 1, "eligible_people": 2, "selected_people": 2,
        "people_shortfall": 0, "companies_with_shortfall": 0,
    }
    assert [person.title for person in selected_people] == [
        "Chief Operating Officer", "Head of Operations",
    ]
    assert [person.rank_ordinal for person in selected_people] == [0, 1]
    assert all("sender_background_not_scored" in person.reason_codes for person in selected_people)
    assert all("stable_tiebreak_p18_ordinal" in person.reason_codes for person in selected_people)
    assert excluded.match_kind == "excluded" and not excluded.selected
    assert connection.execute("SELECT count(*) FROM campaign_fit_spec").fetchone()[0] == 0
    assert connection.execute("SELECT count(*) FROM person_affinity").fetchone()[0] == 0
    assert connection.execute("SELECT count(*) FROM fill_person").fetchone()[0] == 0
    assert connection.execute("SELECT count(*) FROM fill_firm").fetchone()[0] == 0
    assert connection.execute(
        "SELECT count(*) FROM prospecting_ranking_person WHERE person_id='per_ffffffffffffffff'",
    ).fetchone()[0] == 0


@pytest.mark.parametrize(
    ("title", "requested", "family", "kind"),
    (
        ("VP, Corporate Strategy", frozenset({"strategy"}), "strategy", "direct"),
        ("Director, Strategy & Ops", frozenset({"strategy_operations"}), "strategy_operations", "compound"),
        ("Chief of Staff to the Chief Product Officer", frozenset({"chief_of_staff"}), "chief_of_staff", "direct"),
        ("COO", frozenset({"operations"}), "operations", "direct"),
        ("VP of Ops", frozenset({"operations"}), "operations", "generic"),
        ("Sales Ops", frozenset({"operations"}), None, "excluded"),
        ("Revenue Operations", frozenset({"operations"}), None, "excluded"),
        ("DevOps Lead", frozenset({"operations"}), None, "unknown"),
    ),
)
def test_role_policy_whole_phrases_and_function_exclusions(title, requested, family, kind) -> None:
    assert _role_match(title, requested)[:2] == (family, kind)


def test_deduplication_is_by_exact_person_id_and_preserves_all_candidate_ids(tmp_path: Path) -> None:
    del tmp_path
    first = QualificationSupportedCandidate(
        "pprc_aaaaaaaa", 2, "per_aaaaaaaaaaaaaaaa", "emp_aaaaaaaaaaaaaaaa",
        "obs_first", "obs_employment", "Head of Operations", "a" * 64,
        "current_role_supported",
    )
    second = replace(first, candidate_id="pprc_bbbbbbbb", ordinal=1, candidate_observation_id="obs_second")
    groups = RankingService._group_candidates((first, second))
    representative, values, outcome, reasons = groups[0]
    assert representative.candidate_id == second.candidate_id
    assert [value.candidate_id for value in values] == [second.candidate_id, first.candidate_id]
    assert outcome == "current_role_supported"
    assert reasons == ("duplicate_source_candidates",)


def test_unknown_company_or_role_preserves_shortfall_without_selection(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started, funding, selected = _seed(connection, tmp_path)
    people = PersonResearchService(connection, now=lambda: STAMP).import_current_people(
        _request(
            started, funding, selected,
            (_person(tmp_path, selected, title="Customer Success", slug="customer"),),
        ),
    )

    def uncertain_company(job):
        value = _supported_payload(job)
        value["company"]["funding_events"][0]["authority"] = "unknown"
        return value

    qualification_service = QualificationService(
        connection, adapters={"qualification_factcheck": _Adapter(uncertain_company)}, now=lambda: NOW,
    )
    qualification = qualification_service.start_or_resume(
        _qualification_request(started, funding, people),
    )
    item_id = qualification_service.get_projection(started.run_id).items[0].item_id
    qualification_service.run_next(item_id, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")
    projection = RankingService(connection, now=lambda: NOW).start_or_resume(
        _rank_request(started, qualification),
    )
    assert projection.counts["selected_people"] == 0
    assert projection.counts["people_shortfall"] == 2


def test_exact_replay_conflict_and_same_context_replacement(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started, funding, selected = _seed(connection, tmp_path)
    people = PersonResearchService(connection, now=lambda: STAMP).import_current_people(
        _request(started, funding, selected, (_person(tmp_path, selected),)),
    )
    qualification_service = QualificationService(
        connection, adapters={"qualification_factcheck": _Adapter(_supported_payload)}, now=lambda: NOW,
    )
    qualification = qualification_service.start_or_resume(
        _qualification_request(started, funding, people),
    )
    item_id = qualification_service.get_projection(started.run_id).items[0].item_id
    qualification_service.run_next(item_id, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")
    service = RankingService(connection, now=lambda: NOW)
    request = _rank_request(started, qualification)
    first = service.start_or_resume(request)
    assert service.start_or_resume(request).replayed
    with pytest.raises(RankingError, match="request_conflict"):
        service.start_or_resume(replace(request, qualification_batch_hash="b" * 64))
    with pytest.raises(RankingError, match="ranking_context_unchanged"):
        service.start_or_resume(_rank_request(
            started, qualification, request_id="acacacac-acac-4cac-8cac-acacacacacac",
            predecessor=first,
        ))


def test_current_projection_refuses_after_person_source_replacement_but_old_request_replays(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started, funding, selected = _seed(connection, tmp_path)
    people = PersonResearchService(connection, now=lambda: STAMP).import_current_people(
        _request(started, funding, selected, (_person(tmp_path, selected),)),
    )
    qualification_service = QualificationService(
        connection, adapters={"qualification_factcheck": _Adapter(_supported_payload)}, now=lambda: NOW,
    )
    qualification = qualification_service.start_or_resume(
        _qualification_request(started, funding, people),
    )
    item_id = qualification_service.get_projection(started.run_id).items[0].item_id
    qualification_service.run_next(item_id, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")
    service = RankingService(connection, now=lambda: NOW)
    request = _rank_request(started, qualification)
    first = service.start_or_resume(request)

    changed = PersonCapture(
        selected.result_id, selected.company_id, "Avery", "Avery Example", "Head of Operations",
        "https://profile.test/avery", "https://nimbus.test/leadership/avery",
        _write(
            tmp_path, "changed-after-ranking.txt",
            "Leadership listing: Avery Example is Head of Operations at Nimbus Systems.",
        ),
        STAMP,
    )
    PersonResearchService(connection, now=lambda: STAMP).import_current_people(
        _request(
            started, funding, selected, (changed,),
            request_id="bcbcbcbc-bcbc-4bcb-8bcb-bcbcbcbcbcbc", predecessor=people,
        ),
    )
    with pytest.raises(RankingError, match="pipeline_context_stale"):
        service.get_projection(started.run_id)
    replay = service.start_or_resume(request)
    assert replay.replayed and replay.batch_id == first.batch_id


def test_supported_scope_detects_artifact_derived_tamper(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started, funding, selected = _seed(connection, tmp_path)
    people = PersonResearchService(connection, now=lambda: STAMP).import_current_people(
        _request(started, funding, selected, (_person(tmp_path, selected),)),
    )
    service = QualificationService(
        connection, adapters={"qualification_factcheck": _Adapter(_supported_payload)}, now=lambda: NOW,
    )
    service.start_or_resume(_qualification_request(started, funding, people))
    item_id = service.get_projection(started.run_id).items[0].item_id
    service.run_next(item_id, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")
    connection.execute("DROP TRIGGER prospecting_qualification_artifact_no_update")
    connection.execute(
        "UPDATE prospecting_qualification_artifact SET derived_json=? WHERE item_id=?",
        ('{"company_outcome":"unknown","company_uncertainty_codes":[],"people":[]}', item_id),
    )
    with pytest.raises(QualificationError, match="store_state_invalid"):
        service.get_supported_scope(started.run_id)


def test_safe_projection_contains_no_person_title_or_company_identity(tmp_path: Path) -> None:
    connection = open_store(tmp_path / "store.sqlite")
    started, funding, selected = _seed(connection, tmp_path)
    people = PersonResearchService(connection, now=lambda: STAMP).import_current_people(
        _request(started, funding, selected, (_person(tmp_path, selected),)),
    )
    qualification_service = QualificationService(
        connection, adapters={"qualification_factcheck": _Adapter(_supported_payload)}, now=lambda: NOW,
    )
    qualification = qualification_service.start_or_resume(
        _qualification_request(started, funding, people),
    )
    item_id = qualification_service.get_projection(started.run_id).items[0].item_id
    qualification_service.run_next(item_id, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")
    service = RankingService(connection, now=lambda: NOW)
    service.start_or_resume(_rank_request(started, qualification))
    safe = service.get_safe_projection(started.run_id)
    rendered = repr(safe)
    assert selected.name not in rendered and "Avery" not in rendered and "Operations" not in rendered
    assert set(safe.counts) == {
        "companies", "eligible_people", "selected_people", "people_shortfall",
        "companies_with_shortfall",
    }
